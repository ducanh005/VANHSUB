// Xuất 2 stem nhạc/giọng ra file mp3 cạnh video gốc:
//   <tên_file>.nhacnen.mp3 — nhạc nền/SFX KHÔNG lời (làm BGM cho video khác)
//   <tên_file>.giong.mp3   — giọng hát/thoại đã tách riêng
// Chạy qua Demucs AI (cùng engine với tách thoại khi lồng tiếng).

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { TaskStore, type Task } from '../store/taskStore';
import { checkDemucs, separateVocals } from './vocalSeparation';
import { extractFullQualityAudio, getFfmpegBinPath } from '../asr/audioExtractor';

const execFileAsync = promisify(execFile);

export class StemExportRunner {
  private static runningTasks = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  static async runStemExport(taskId: string, onUpdate?: () => void): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    if (this.runningTasks.has(taskId)) {
      return task;
    }
    this.runningTasks.add(taskId);

    let tempWav: string | null = null;
    let tempOutDir: string | null = null;

    const setStage = (progress: number, stageDescription: string) => {
      TaskStore.update(taskId, { status: 'exporting', progress, stageDescription });
      onUpdate?.();
    };

    try {
      setStage(2, 'Đang trích audio gốc (44.1kHz stereo)...');
      tempWav = path.join(os.tmpdir(), `vanhsub_stem_${Date.now()}.wav`);
      await extractFullQualityAudio(task.filePath, tempWav, (p) => {
        setStage(2 + Math.min(8, Math.round(p * 0.08)), 'Đang trích audio gốc (44.1kHz stereo)...');
      });

      setStage(12, 'Kiểm tra môi trường Demucs...');
      const demucs = await checkDemucs();
      if (!demucs.ok) throw new Error(demucs.detail);

      setStage(15, 'Đang tách lời thoại bằng AI (Demucs) — xấp xỉ thời lượng video...');
      tempOutDir = path.join(os.tmpdir(), `vanhsub_stems_${Date.now()}`);
      const { noVocals, vocals } = await separateVocals(tempWav, tempOutDir);

      setStage(78, 'Đang xuất file MP3 (320kbps)...');
      const dir = path.dirname(task.filePath);
      const base = path.basename(task.filePath, path.extname(task.filePath));
      const noVocalsMp3 = await convertToMp3(noVocals, path.join(dir, `${base}.nhacnen.mp3`));
      const vocalsMp3 = await convertToMp3(vocals, path.join(dir, `${base}.giong.mp3`));

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
        status: 'error',
        errorMessage: err?.message || 'Lỗi không xác định khi tách nhạc nền',
        stageDescription: 'Tách nhạc nền thất bại',
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
  }
}

/** Chuyển stem WAV sang MP3 320kbps — đè nextAvailable nếu file trùng tên */
async function convertToMp3(sourceWav: string, targetMp3: string): Promise<string> {
  let target = targetMp3;
  if (fs.existsSync(target)) {
    target = target.replace(/\.mp3$/i, `_${Date.now().toString(36)}.mp3`);
  }
  await execFileAsync(getFfmpegBinPath(), [
    '-i', sourceWav,
    '-codec:a', 'libmp3lame',
    '-b:a', '320k',
    '-y',
    target,
  ]);
  if (!fs.existsSync(target)) {
    throw new Error(`Không tạo được file MP3: ${target}`);
  }
  return target;
}
