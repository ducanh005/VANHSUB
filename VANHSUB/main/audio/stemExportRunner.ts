import { cancelTaskRun } from '../lib/taskExecution';
import { runFfmpeg } from '../lib/ffmpegProcess';
import { isCancelledError } from '../lib/cancel';
import { getOrCreateProjectDir } from '../utils/projectFolder';
import { randomUUID } from 'node:crypto';
import { runTaskStage, isTaskRunCancelled, throwIfTaskCancelled } from '../lib/taskExecution';
// Xuất 2 stem nhạc/giọng ra file mp3 cạnh video gốc:
//   <tên_file>.nhacnen.mp3 — nhạc nền/SFX KHÔNG lời (làm BGM cho video khác)
//   <tên_file>.giong.mp3   — giọng hát/thoại đã tách riêng
// Chạy qua Demucs AI (cùng engine với tách thoại khi lồng tiếng).

import fs from 'fs';
import os from 'os';
import path from 'path';
import { TaskStore, type Task } from '../store/taskStore';
import { separateVocals } from './vocalSeparation';
import { extractFullQualityAudio } from '../asr/audioExtractor';

export class StemExportRunner {
  private static runningTasks = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  static cancel(taskId: string): boolean {
    return this.runningTasks.has(taskId) && cancelTaskRun(taskId);
  }

  static async runStemExport(taskId: string, onUpdate?: () => void): Promise<Task | undefined> {
    return runTaskStage(taskId, 'stems', async () => {
      const task = TaskStore.getById(taskId);
      if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

      if (this.runningTasks.has(taskId)) {
        return task;
      }
      this.runningTasks.add(taskId);

      let tempWav: string | null = null;
      let tempOutDir: string | null = null;

      const setStage = (progress: number, stageDescription: string) => {
        if (isTaskRunCancelled(taskId)) return;
        TaskStore.update(taskId, { status: 'exporting', progress, stageDescription });
        onUpdate?.();
      };

      try {
        setStage(2, 'Đang trích audio gốc (44.1kHz stereo)...');
        tempWav = path.join(os.tmpdir(), `vanhsub_stem_${randomUUID()}.wav`);
        await extractFullQualityAudio(
          task.filePath,
          tempWav,
          (p) => {
            setStage(2 + Math.min(8, Math.round(p * 0.08)), 'Đang trích audio gốc (44.1kHz stereo)...');
          },
          () => isTaskRunCancelled(taskId)
        );

        setStage(12, 'Kiểm tra môi trường tách giọng...');
        tempOutDir = path.join(os.tmpdir(), `vanhsub_stems_${randomUUID()}`);
        const { noVocals, vocals } = await separateVocals(
          tempWav,
          tempOutDir,
          () => isTaskRunCancelled(taskId),
          (backend) => {
            setStage(
              15,
              backend === 'demucs'
                ? 'Đang tách lời thoại bằng AI (Demucs)...'
                : 'Đang tách lời thoại bằng FFmpeg DSP (nhanh, offline)...'
            );
          }
        );

        setStage(78, 'Đang xuất file MP3 (320kbps)...');
        const dir = getOrCreateProjectDir(task);
        const base = path.basename(task.filePath, path.extname(task.filePath));
        const noVocalsMp3 = await convertToMp3(noVocals, path.join(dir, `${base}.nhacnen.mp3`), () =>
          isTaskRunCancelled(taskId)
        );
        const vocalsMp3 = await convertToMp3(vocals, path.join(dir, `${base}.giong.mp3`), () =>
          isTaskRunCancelled(taskId)
        );

        throwIfTaskCancelled(taskId);
        const updated = TaskStore.update(taskId, {
          status: 'done',
          progress: 100,
          stageDescription: `Đã tách xong: ${path.basename(noVocalsMp3)} + ${path.basename(vocalsMp3)}`,
        });
        onUpdate?.();
        console.log(`[Stems] ✓ Nhạc nền: ${noVocalsMp3}`);
        console.log(`[Stems] ✓ Giọng tách: ${vocalsMp3}`);
        return updated;
      } catch (err: any) {
        console.error(`[Stems] Lỗi khi tách nhạc nền task ${taskId}:`, err);
        const updated = TaskStore.update(taskId, {
          status: isCancelledError(err) ? 'cancelled' : 'error',
          errorMessage: isCancelledError(err) ? undefined : err?.message || 'Lỗi không xác định khi tách nhạc nền',
          stageDescription: isCancelledError(err) ? 'Đã huỷ tách nhạc nền' : 'Tách nhạc nền thất bại',
        });
        onUpdate?.();
        return updated;
      } finally {
        try {
          if (tempWav && fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
          if (tempOutDir && fs.existsSync(tempOutDir)) fs.rmSync(tempOutDir, { recursive: true, force: true });
        } catch {
          // bỏ qua — temp trong os.tmpdir, hệ thống tự dọn
        }
        this.runningTasks.delete(taskId);
      }
    });
  }
}

/** Chuyển stem WAV sang MP3 320kbps — đè nextAvailable nếu file trùng tên */
async function convertToMp3(sourceWav: string, targetMp3: string, shouldStop?: () => boolean): Promise<string> {
  let target = targetMp3;
  if (fs.existsSync(target)) {
    target = target.replace(/\.mp3$/i, `_${Date.now().toString(36)}.mp3`);
  }
  await runFfmpeg(['-i', sourceWav, '-codec:a', 'libmp3lame', '-b:a', '320k', '-y', target], { shouldStop });
  if (!fs.existsSync(target)) {
    throw new Error(`Không tạo được file MP3: ${target}`);
  }
  return target;
}
