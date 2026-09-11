import path from 'path';
import fs from 'fs';
import { app } from 'electron';

import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { CancelledError, isCancelledError } from '../lib/cancel';
import { nextAvailablePath } from '../lib/paths';
import { TranslateRunner } from '../translate/translateRunner';
import { OcrPool, MIN_LINE_CONFIDENCE } from './ocrEngine';
import { BOTTOM_CROP_RATIO, extractFrames, cleanupFrames, type OcrRegion } from './frameExtractor';
import { buildSubtitleSegments, filterPersistentTopLines, segmentsToSrt } from './subtitleBuilder';
import {
  checkRapidOcr,
  mapRecLangNames,
  runPaddleOcr,
  type PaddleOcrFrame,
} from './paddleEngine';
import {
  mergeOcrResults,
  mergedToFrameResults,
  type CropOcrResult,
  type MergedOcrFrame,
} from './resultMerge';

/** File audio thuần không có khung hình — OCR chỉ áp dụng cho video */
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg', '.opus', '.wma']);

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.webm', '.m4v', '.ts']);

/**
 * Pipeline quét phụ đề cứng (hardsub):
 *
 *   Video → ffmpeg trích khung (fps + crop vùng phụ đề, giữ màu)
 *        → PaddleOCR PP-OCRv5: detect hộp chữ → crop → upscale/denoise/deblur
 *           → nhận diện từng crop
 *        → Lượt OCR 2 bằng Tesseract đọc CÙNG crop đã enhance
 *        → So sánh kết quả 2 engine + confidence (resultMerge.ts)
 *        → Ghép khung trùng thành dòng phụ đề → .srt
 */
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
      const dualEngine = SettingsStore.get('ocrDualEngine') !== false;
      const shouldStop = () => this.cancelRequested.has(taskId);

      // Giai đoạn 1: trích khung hình vùng phụ đề (giữ màu cho model PP-OCRv5)
      TaskStore.update(taskId, {
        status: 'ocr',
        progress: 2,
        errorMessage: undefined,
        stageDescription: 'Đang trích khung hình vùng phụ đề...',
      });
      onUpdate?.();

      const {
        framesDir: dir,
        framePaths,
        frameIntervalMs,
        width: videoWidth,
        height: videoHeight,
      } = await extractFrames(task.filePath, fps, region, (percent) => {
        TaskStore.update(taskId, { progress: Math.min(24, 2 + Math.round(percent * 0.22)) });
        onUpdate?.();
      });
      framesDir = dir;
      console.log(`[OCR] Đã trích ${framePaths.length} khung hình (${fps} fps, vùng ${region})`);

      // Giai đoạn 2: PaddleOCR PP-OCRv5 qua sidecar Python (rapidocr)
      const env = await checkRapidOcr();
      if (!env.ok) throw new Error(env.detail);

      TaskStore.update(taskId, {
        progress: 25,
        stageDescription: `Đang nạp model PaddleOCR PP-OCRv5 (${language})...`,
      });
      onUpdate?.();

      const paddleFrames: PaddleOcrFrame[] = await runPaddleOcr(
        {
          frames: framePaths,
          cropsDir: path.join(dir, 'crops'),
          outPath: path.join(dir, 'paddle_out.jsonl'),
          recLangNames: mapRecLangNames(language),
          detVersion: 'PPOCRV5',
          recVersion: 'PPOCRV5',
          modelType: 'MOBILE',
          textScore: 0.25,
          videoWidth,
          videoHeight,
          regionOffsetRatio: region === 'bottom' ? 1 - BOTTOM_CROP_RATIO : 0,
        },
        {
          onReady: () => {
            TaskStore.update(taskId, {
              stageDescription: `Đang quét chữ PaddleOCR PP-OCRv5 (${language}) trên ${framePaths.length} khung...`,
            });
            onUpdate?.();
          },
          onProgress: (done, total) => {
            TaskStore.update(taskId, { progress: 25 + Math.round((done / total) * 40) }); // 25% -> 65%
            onUpdate?.();
          },
          shouldStop,
        },
      );

      if (shouldStop()) throw new CancelledError();

      // Giai đoạn 3: lượt OCR thứ hai bằng Tesseract trên cùng crop đã enhance
      const cropFiles: string[] = [];
      for (const f of paddleFrames) for (const l of f.lines) cropFiles.push(l.crop);

      let cropMap = new Map<string, CropOcrResult>();
      if (dualEngine && cropFiles.length > 0) {
        TaskStore.update(taskId, {
          progress: 66,
          stageDescription: `Đang đối chiếu bằng Tesseract trên ${cropFiles.length} vùng chữ...`,
        });
        onUpdate?.();

        const pool = await OcrPool.create(
          language,
          path.join(app.getPath('userData'), 'tessdata'),
          undefined,
          'line',
        );
        let cropResults: CropOcrResult[];
        try {
          cropResults = await pool.recognizeCrops(
            cropFiles,
            (done, total) => {
              TaskStore.update(taskId, { progress: 66 + Math.round((done / total) * 19) }); // 66% -> 85%
              onUpdate?.();
            },
            shouldStop,
          );
        } finally {
          await pool.terminate();
        }
        cropMap = new Map(cropFiles.map((file, i) => [file, cropResults[i]]));
      }

      if (shouldStop()) throw new CancelledError();

      // Giai đoạn 4: so sánh 2 engine + confidence → chốt từng dòng
      TaskStore.update(taskId, {
        progress: 87,
        stageDescription: 'Đang so sánh kết quả 2 engine OCR...',
      });
      onUpdate?.();

      const merged: MergedOcrFrame[] = mergeOcrResults(paddleFrames, cropMap, MIN_LINE_CONFIDENCE);
      const frameResults = mergedToFrameResults(merged);

      // Giai đoạn 5: ghép khung trùng nội dung thành dòng phụ đề
      TaskStore.update(taskId, {
        progress: 93,
        stageDescription: 'Đang ghép dòng phụ đề từ kết quả quét...',
      });
      onUpdate?.();

      // Bỏ lớp phủ tĩnh ở 1/4 trên khung (watermark/logo in cố định suốt video)
      // trước khi ghép dòng phụ đề — dump ở trên vẫn giữ nguyên để đối chiếu
      const cleanedResults = filterPersistentTopLines(frameResults, frameIntervalMs, videoHeight);
      const segments = buildSubtitleSegments(cleanedResults, frameIntervalMs);
      const srtContent = segmentsToSrt(segments);
      if (!srtContent) {
        throw new Error(
          'Không nhận diện được phụ đề nào — kiểm tra ngôn ngữ quét trong Cài đặt hoặc thử vùng quét "Toàn khung".',
        );
      }

      // Giai đoạn 6: ghi file .srt cạnh video (không ghi đè file có sẵn)
      const videoDir = path.dirname(task.filePath);
      const base = path.basename(task.filePath, path.extname(task.filePath));
      const targetPath = nextAvailablePath(path.join(videoDir, `${base}_ocr.srt`));
      fs.writeFileSync(targetPath, srtContent, 'utf-8');
      console.log(`[OCR] Đã ghi ${segments.length} dòng phụ đề vào ${targetPath}`);

      writeDiagnosticDump(
        targetPath.replace(/\.srt$/i, '.frames.txt'),
        task.fileName,
        merged,
        frameIntervalMs,
      );

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

/**
 * Dump từng dòng/khung cạnh file srt — đối chiếu được MỖI ENGINE đọc gì ở giây
 * nào, độ tin cậy bao nhiêu, engine nào thắng sau khi so sánh.
 */
function writeDiagnosticDump(
  dumpPath: string,
  fileName: string,
  merged: MergedOcrFrame[],
  frameIntervalMs: number,
): void {
  const rows: string[] = [];
  merged.forEach((f, i) => {
    const t = ((i * frameIntervalMs) / 1000).toFixed(1);
    if (f.lines.length === 0) {
      rows.push(`${String(i).padStart(5)}  ${t.padStart(7)}s  (không phát hiện chữ)`);
      return;
    }
    for (const l of f.lines) {
      const alt = l.altText
        ? ` | tess ${String(Math.round(l.altConfidence ?? 0)).padStart(3)} sim=${(l.similarity ?? 0).toFixed(2)} "${l.altText}"`
        : '';
      rows.push(
        `${String(i).padStart(5)}  ${t.padStart(7)}s  ${l.chosen === 'paddle' ? 'pad' : 'tes'} ${String(l.confidence).padStart(3)}  y=${String(Math.round(l.y0)).padStart(4)}  "${l.text}"${alt}`,
      );
    }
  });
  fs.writeFileSync(
    dumpPath,
    `# VANHSUB OCR frame dump — ${fileName}\n` +
      `# idx   time      eng conf    y  text (pad = PaddleOCR PP-OCRv5, tes = Tesseract thắng so sánh)\n` +
      `${rows.join('\n')}\n`,
    'utf-8',
  );
  console.log(`[OCR] Dump chi tiết từng khung: ${dumpPath}`);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
