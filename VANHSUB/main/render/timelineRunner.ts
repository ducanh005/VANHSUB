// Cắt ghép video 1 track: giữ các đoạn (segment) theo thứ tự tuỳ ý rồi render
// thành video mới bằng MỘT lệnh ffmpeg (filter trim + concat — decode/encode
// một pass, frame-exact thay vì -ss/-c copy bị leap keyframe).
//
// Mô hình dữ liệu: Task.timelineSegments = mảng {startMs, endMs} theo thứ tự
// GIỮ LẠI (có thể đảo thứ tự cảnh, chồng lấn thời gian gốc không sao — mỗi
// đoạn trim độc lập). Rỗng/undefined = video nguyên bản.

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpeg from 'fluent-ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { TaskStore, type Task } from '../store/taskStore';
import { getMediaDurationSec } from '../asr/audioExtractor';
import { nextAvailablePath } from '../lib/paths';

const execFileAsync = promisify(execFile);

export interface TimelineSegment {
  id: string;
  startMs: number;
  endMs: number;
}

function getFfprobeBin(): string {
  const raw = (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';
  return String(raw).replace('app.asar', 'app.asar.unpacked');
}

/** Video có track audio không — quyết định concat có ghép audio hay không */
async function hasAudioStream(videoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(getFfprobeBin(), [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=index',
      '-of', 'csv=p=0',
      videoPath,
    ]);
    return stdout.trim().length > 0;
  } catch {
    return true; // probe lỗi thì cứ ghép audio — ffmpeg tự bỏ track nếu không có... an toàn hơn là thử
  }
}

/** Dựng filter_complex cắt N đoạn rồi concat theo thứ tự mảng */
function buildConcatFilter(segments: TimelineSegment[], withAudio: boolean): string {
  const chains: string[] = [];
  const labels: string[] = [];

  segments.forEach((seg, i) => {
    const start = (Math.max(0, seg.startMs) / 1000).toFixed(3);
    const end = (Math.max(seg.startMs + 100, seg.endMs) / 1000).toFixed(3);
    chains.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);
    labels.push(`[v${i}]`);
    if (withAudio) {
      chains.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`);
      labels.push(`[a${i}]`);
    }
  });

  const concat = withAudio
    ? `concat=n=${segments.length}:v=1:a=1[vout][aout]`
    : `concat=n=${segments.length}:v=1:a=0[vout]`;

  return [...chains, `${labels.join('')}${concat}`].join(';');
}

export class TimelineRunner {
  private static runningTasks = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  static async runRender(
    taskId: string,
    segments: TimelineSegment[],
    onUpdate?: () => void,
  ): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);
    if (!fs.existsSync(task.filePath)) {
      throw new Error(`File gốc không tồn tại: ${task.filePath}`);
    }

    const cleaned = segments
      .map((s, i) => ({
        id: s.id || `seg-${i}`,
        startMs: Math.max(0, Math.round(s.startMs)),
        endMs: Math.max(0, Math.round(s.endMs)),
      }))
      .filter((s) => s.endMs - s.startMs >= 200); // bỏ đoạn quá ngắn (< 0.2s)

    if (cleaned.length === 0) {
      throw new Error('Không có đoạn nào để giữ lại (mỗi đoạn cần dài tối thiểu 0.2 giây).');
    }

    if (this.runningTasks.has(taskId)) return task;
    this.runningTasks.add(taskId);

    try {
      TaskStore.update(taskId, {
        status: 'exporting',
        progress: 1,
        stageDescription: 'Đang đọc thông tin video...',
      });
      onUpdate?.();

      const durationSec = await getMediaDurationSec(task.filePath);
      if (durationSec > 0) {
        cleaned.forEach((s) => {
          s.endMs = Math.min(s.endMs, Math.round(durationSec * 1000));
        });
      }
      const invalid = cleaned.findIndex((s) => s.endMs - s.startMs < 200);
      if (invalid >= 0) {
        throw new Error(`Đoạn ${invalid + 1} không hợp lệ sau khi kiểm tra thời lượng video.`);
      }

      const withAudio = await hasAudioStream(task.filePath);
      const filter = buildConcatFilter(cleaned, withAudio);

      const totalMs = cleaned.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
      TaskStore.update(taskId, {
        progress: 3,
        stageDescription: `Đang cắt ghép ${cleaned.length} đoạn (${(totalMs / 1000).toFixed(1)}s) — encode lại video...`,
      });
      onUpdate?.();

      const dir = path.dirname(task.filePath);
      const base = path.basename(task.filePath, path.extname(task.filePath));
      const outputPath = nextAvailablePath(path.join(dir, `${base}_cut.mp4`));

      await new Promise<void>((resolve, reject) => {
        const command = ffmpeg(task.filePath).outputOptions([
          '-filter_complex', filter,
          '-map', '[vout]',
          ...(withAudio ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k'] : []),
          '-c:v', 'libx264',
          '-crf', '23',
          '-preset', 'veryfast',
          '-pix_fmt', 'yuv420p',
        ]);

        command
          .output(outputPath)
          .on('progress', (progress) => {
            let percent = progress.percent;
            if ((percent === undefined || Number.isNaN(percent)) && progress.timemark) {
              const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(progress.timemark);
              if (m && totalMs > 0) {
                const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
                percent = Math.min(99, (sec / (totalMs / 1000)) * 100);
              }
            }
            if (typeof percent === 'number' && !Number.isNaN(percent)) {
              TaskStore.update(taskId, {
                progress: Math.min(99, 3 + Math.round(percent * 0.96)),
              });
              onUpdate?.();
            }
          })
          .on('end', () => resolve())
          .on('error', (err) => reject(new Error(`Lỗi cắt ghép video: ${err.message}`)))
          .run();
      });

      const updated = TaskStore.update(taskId, {
        status: 'done',
        progress: 100,
        outputPath,
        stageDescription: `Đã cắt ghép xong: ${path.basename(outputPath)} (${cleaned.length} đoạn, ${(totalMs / 1000).toFixed(1)}s)`,
      });
      onUpdate?.();
      console.log(`[Timeline] ✓ Đã render ${cleaned.length} đoạn → ${outputPath}`);
      return updated;
    } catch (err: any) {
      console.error(`[Timeline] Lỗi cắt ghép task ${taskId}:`, err);
      const updated = TaskStore.update(taskId, {
        status: 'error',
        errorMessage: err?.message || 'Lỗi không xác định khi cắt ghép',
        stageDescription: 'Cắt ghép thất bại',
      });
      onUpdate?.();
      return updated;
    } finally {
      this.runningTasks.delete(taskId);
    }
  }
}
