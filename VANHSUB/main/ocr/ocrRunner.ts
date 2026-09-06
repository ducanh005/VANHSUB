import path from 'path';
import fs from 'fs';
import { app } from 'electron';

import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { CancelledError, isCancelledError } from '../lib/cancel';
import { nextAvailablePath } from '../lib/paths';
import { TranslateRunner } from '../translate/translateRunner';
import { OcrPool } from './ocrEngine';
import { extractFrames, cleanupFrames, type OcrRegion } from './frameExtractor';
import { buildSubtitleSegments, segmentsToSrt } from './subtitleBuilder';

/** File audio thuần không có khung hình — OCR chỉ áp dụng cho video */
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg', '.opus', '.wma']);

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.webm', '.m4v', '.ts']);

export class OcrRunner {
  private static runningTasks = new Set<string>();
  private static cancelRequested = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  /** Yêu cầu huỷ — có hiệu lực trước khung OCR kế tiếp (hợp tác). */
  static cancel(taskId: string): boolean {
    if (!this.runningTasks.has(taskId)) return false;
    this.cancelRequested.add(taskId);
    return true;
  }

  static async runOcr(taskId: string, onUpdate?: () => void): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    if (this.runningTasks.has(taskId)) {
      return task;
    }

    const ext = path.extname(task.filePath).toLowerCase();
    if (AUDIO_EXTENSIONS.has(ext)) {
      throw new Error('Tác vụ này là file audio — OCR phụ đề chỉ hỗ trợ file video.');
    }
    if (!VIDEO_EXTENSIONS.has(ext)) {
      throw new Error(`Định dạng không hỗ trợ OCR: ${ext || '(không rõ)'}`);
    }

    this.runningTasks.add(taskId);
    let framesDir: string | undefined;

    try {
      const language = SettingsStore.get('ocrLanguage') || 'vie';
      const fps = clampNumber(Number(SettingsStore.get('ocrFps')) || 2, 0.5, 5);
      const region = (SettingsStore.get('ocrRegion') || 'bottom') as OcrRegion;
      const shouldStop = () => this.cancelRequested.has(taskId);

      // Giai đoạn 1: trích khung hình vùng phụ đề
      TaskStore.update(taskId, {
        status: 'ocr',
        progress: 2,
        errorMessage: undefined,
        stageDescription: 'Đang trích khung hình vùng phụ đề...',
      });
      onUpdate?.();

      const { framesDir: dir, framePaths, frameIntervalMs } = await extractFrames(
        task.filePath,
        fps,
        region,
        (percent) => {
          TaskStore.update(taskId, { progress: Math.min(24, 2 + Math.round(percent * 0.22)) });
          onUpdate?.();
        },
      );
      framesDir = dir;
      console.log(`[OCR] Đã trích ${framePaths.length} khung hình (${fps} fps, vùng ${region})`);

      // Giai đoạn 2: nhận diện chữ trên các khung bằng Tesseract
      TaskStore.update(taskId, {
        progress: 25,
        stageDescription: `Đang quét chữ (${language}) trên ${framePaths.length} khung...`,
      });
      onUpdate?.();

      const pool = await OcrPool.create(language, path.join(app.getPath('userData'), 'tessdata'));
      let frameResults;
      try {
        frameResults = await pool.recognizeFiles(
          framePaths,
          (done, total) => {
            TaskStore.update(taskId, {
              progress: 25 + Math.round((done / total) * 65), // 25% -> 90%
            });
            onUpdate?.();
          },
          shouldStop,
        );
      } finally {
        await pool.terminate();
      }

      if (shouldStop()) throw new CancelledError();

      // Giai đoạn 3: ghép khung trùng nội dung thành dòng phụ đề
      TaskStore.update(taskId, {
        progress: 93,
        stageDescription: 'Đang ghép dòng phụ đề từ kết quả quét...',
      });
      onUpdate?.();

      const segments = buildSubtitleSegments(frameResults, frameIntervalMs);
      const srtContent = segmentsToSrt(segments);
      if (!srtContent) {
        throw new Error(
          'Không nhận diện được phụ đề nào — kiểm tra ngôn ngữ quét trong Cài đặt hoặc thử vùng quét "Toàn khung".',
        );
      }

      // Giai đoạn 4: ghi file .srt cạnh video (không ghi đè file có sẵn)
      const videoDir = path.dirname(task.filePath);
      const base = path.basename(task.filePath, path.extname(task.filePath));
      const targetPath = nextAvailablePath(path.join(videoDir, `${base}_ocr.srt`));
      fs.writeFileSync(targetPath, srtContent, 'utf-8');
      console.log(`[OCR] Đã ghi ${segments.length} dòng phụ đề vào ${targetPath}`);

      // Dump từng khung cạnh file srt — đối chiếu được OCR đọc gì ở giây nào,
      // khung nào bị lọc (conf 0) để chẩn đoán font/nhiễu/vị trí phụ đề
      const dumpPath = targetPath.replace(/\.srt$/i, '.frames.txt');
      const dumpLines = frameResults.map((r, i) => {
        const t = ((i * frameIntervalMs) / 1000).toFixed(1);
        const conf = r.confidence.toFixed(0).padStart(3);
        const text = r.text.replace(/\s+/g, ' ').trim();
        return `${String(i).padStart(5)}  ${t.padStart(7)}s  ${conf}  ${text}`;
      });
      fs.writeFileSync(
        dumpPath,
        `# VANHSUB OCR frame dump — ${task.fileName}\n` +
          `# idx   time      conf  text (conf 000 = khung trống/bị lọc)\n` +
          `${dumpLines.join('\n')}\n`,
        'utf-8',
      );
      console.log(`[OCR] Dump chi tiết từng khung: ${dumpPath}`);

      const updated = TaskStore.update(taskId, {
        status: 'done',
        progress: 100,
        srtPath: targetPath,
        stageDescription: `Đã quét OCR được ${segments.length} dòng phụ đề`,
      });
      onUpdate?.();

      // Nhất quán với phiên âm: tự động dịch nếu người dùng bật tùy chọn này
      if (SettingsStore.get('autoTranslateAfterAsr') && SettingsStore.hasGeminiKey()) {
        await TranslateRunner.runTranslate(taskId, undefined, onUpdate);
      }

      return updated ?? TaskStore.getById(taskId);
    } catch (err: any) {
      const cancelled = isCancelledError(err);
      console.error(`[OCR] Lỗi khi quét task ${taskId}:`, err);
      const updated = TaskStore.update(taskId, {
        status: cancelled ? 'cancelled' : 'error',
        errorMessage: cancelled ? undefined : err.message || 'Lỗi không xác định khi quét OCR',
        stageDescription: cancelled ? 'Đã huỷ quét OCR' : 'Quét OCR thất bại',
      });
      onUpdate?.();
      return updated;
    } finally {
      if (framesDir) cleanupFrames(framesDir);
      this.runningTasks.delete(taskId);
      this.cancelRequested.delete(taskId);
    }
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
