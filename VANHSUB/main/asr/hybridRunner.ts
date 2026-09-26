import fs from 'fs';
import path from 'path';
import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { extract16kHzWav } from './audioExtractor';
import { transcribe } from './whisperEngine';
import { OcrRunner } from '../ocr/ocrRunner';
import { TaskRunner } from './taskRunner';
import { nextAvailablePath } from '../lib/paths';
import { parseSrt, serializeSrt, type SrtLine } from '../lib/srt';
import { fuseOcrAndWhisper } from './hybridFusionEngine';
import { TranslateRunner } from '../translate/translateRunner';
import { CancelledError, isCancelledError } from '../lib/cancel';
import { getProjectArtifactPaths } from '../utils/projectFolder';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg', '.opus', '.wma']);

export interface HybridRunOptions {
  asrModel?: string;
  ocrMode?: 'auto' | 'bottom' | 'full' | 'custom';
  ocrFps?: number;
  ocrLanguage?: string;
  ocrCustomRegion?: { x: number; y: number; w: number; h: number } | null;
  dualEngine?: boolean;
  useGeminiAi?: boolean;
}

export class HybridRunner {
  private static runningTasks = new Set<string>();
  private static cancelledTasks = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  static cancel(taskId: string): boolean {
    if (!this.runningTasks.has(taskId)) return false;
    this.cancelledTasks.add(taskId);
    // Lan truyền lệnh huỷ sang cả Whisper và OCR nếu đang trong tiến trình con
    TaskRunner.cancel(taskId);
    OcrRunner.cancel(taskId);
    return true;
  }

  static async runHybrid(
    taskId: string,
    options?: HybridRunOptions,
    onUpdate?: () => void
  ): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    if (this.runningTasks.has(taskId)) {
      return task;
    }

    const ext = path.extname(task.filePath).toLowerCase();
    if (AUDIO_EXTENSIONS.has(ext)) {
      throw new Error('Chế độ Kết hợp Whisper + OCR yêu cầu file video (cần hình ảnh để quét chữ).');
    }

    this.runningTasks.add(taskId);
    this.cancelledTasks.delete(taskId);

    try {
      const { projectDir, audioWavPath } = getProjectArtifactPaths(task);
      const asrModel = options?.asrModel || task.asrModel || SettingsStore.get('asrModel') || 'base';

      // -----------------------------------------------------------------------
      // GIAI ĐOẠN 1: PHIÊN ÂM WHISPER ASR (0% -> 35%)
      // -----------------------------------------------------------------------
      let whisperSegments: SrtLine[] = [];

      TaskStore.update(taskId, {
        status: 'transcribing',
        progress: 5,
        projectDir,
        stageDescription: '[Hybrid 1/3] Đang trích xuất audio 16kHz cho Whisper...',
      });
      onUpdate?.();

      if (this.cancelledTasks.has(taskId)) throw new CancelledError();

      const { wavPath } = await extract16kHzWav(task.filePath, audioWavPath, (percent) => {
        TaskStore.update(taskId, {
          progress: 5 + Math.round(percent * 0.1), // 5% -> 15%
        });
        onUpdate?.();
      });

      if (this.cancelledTasks.has(taskId)) throw new CancelledError();

      TaskStore.update(taskId, {
        progress: 15,
        audioPath: wavPath,
        stageDescription: `[Hybrid 1/3] Đang nhận diện giọng nói Whisper (${asrModel})...`,
      });
      onUpdate?.();

      console.log(`[HybridRunner] Bắt đầu phiên âm Whisper (${asrModel})...`);
      const whisperResult = await transcribe(wavPath, {
        modelName: asrModel,
        onProgress: (percent) => {
          TaskStore.update(taskId, {
            progress: 15 + Math.round(percent * 0.2), // 15% -> 35%
            stageDescription:
              percent < 100
                ? `[Hybrid 1/3] Đang phiên âm Whisper (${percent}%)...`
                : '[Hybrid 1/3] Hoàn tất phiên âm Whisper, chuyển sang quét OCR...',
          });
          onUpdate?.();
        },
        shouldStop: () => this.cancelledTasks.has(taskId),
      });

      if (this.cancelledTasks.has(taskId)) throw new CancelledError();

      if (fs.existsSync(whisperResult.srtPath)) {
        const whisperSrtContent = fs.readFileSync(whisperResult.srtPath, 'utf-8');
        whisperSegments = parseSrt(whisperSrtContent);
      }
      console.log(`[HybridRunner] Whisper ASR hoàn tất: ${whisperSegments.length} dòng lời thoại.`);

      // -----------------------------------------------------------------------
      // GIAI ĐOẠN 2: QUÉT CHỮ KHUNG HÌNH BẰNG OCR (35% -> 85%)
      // -----------------------------------------------------------------------
      TaskStore.update(taskId, {
        status: 'ocr',
        progress: 35,
        stageDescription: '[Hybrid 2/3] Bắt đầu quét phụ đề khung hình video (OCR)...',
      });
      onUpdate?.();

      console.log(`[HybridRunner] Bắt đầu quét chữ video qua OcrRunner...`);
      await OcrRunner.runOcr(
        taskId,
        {
          mode: options?.ocrMode,
          fps: options?.ocrFps,
          language: options?.ocrLanguage,
          customRegion: options?.ocrCustomRegion,
          dualEngine: options?.dualEngine,
        },
        onUpdate
      );

      if (this.cancelledTasks.has(taskId)) throw new CancelledError();

      // Đọc file SRT vừa được OCR tạo ra từ task
      const updatedTask = TaskStore.getById(taskId);
      const ocrSrtPath = updatedTask?.srtPath;
      if (!ocrSrtPath || !fs.existsSync(ocrSrtPath)) {
        throw new Error('Quá trình OCR không tạo ra file phụ đề nào.');
      }

      const ocrSrtContent = fs.readFileSync(ocrSrtPath, 'utf-8');
      const ocrSegments = parseSrt(ocrSrtContent);
      console.log(`[HybridRunner] OCR hoàn tất: ${ocrSegments.length} phân đoạn khung hình.`);

      // -----------------------------------------------------------------------
      // GIAI ĐOẠN 3: HỢP NHẤT ĐA PHƯƠNG THỨC (CROSS-MODAL FUSION) (85% -> 95%)
      // -----------------------------------------------------------------------
      TaskStore.update(taskId, {
        status: 'ocr',
        progress: 88,
        stageDescription: '[Hybrid 3/3] Đang hợp nhất thời gian theo OCR & sửa lỗi chữ bằng Whisper...',
      });
      onUpdate?.();

      console.log(`[HybridRunner] Đang thực thi Cross-Modal Fusion Engine...`);
      const fusionResult = fuseOcrAndWhisper(ocrSegments, whisperSegments, {
        toleranceMs: 800,
        minSimilarityThreshold: 0.35,
        useGeminiAi: options?.useGeminiAi,
      });

      console.log(
        `[HybridRunner] Fusion hoàn tất: ${fusionResult.segments.length} dòng. Sửa ${fusionResult.stats.typosRepaired} lỗi chính tả, phục hồi ${fusionResult.stats.diacriticsRestored} dấu, khôi phục ${fusionResult.stats.wordsRestored} từ, bảo toàn ${fusionResult.stats.bannersPreserved} banner.`
      );

      // Ghi file .srt kết quả [base]_hybrid.srt
      const videoDir = path.dirname(task.filePath);
      const base = path.basename(task.filePath, path.extname(task.filePath));
      const hybridTargetPath = nextAvailablePath(path.join(videoDir, `${base}_hybrid.srt`));
      const hybridSrtContent = serializeSrt(fusionResult.segments);
      fs.writeFileSync(hybridTargetPath, hybridSrtContent, 'utf-8');

      // Cập nhật TaskStore hoàn thành
      const finalTask = TaskStore.update(taskId, {
        status: 'done',
        progress: 100,
        srtPath: hybridTargetPath,
        stageDescription: `Hoàn tất kết hợp Whisper + OCR: ${fusionResult.segments.length} dòng (${fusionResult.stats.typosRepaired + fusionResult.stats.diacriticsRestored} sửa lỗi, ${fusionResult.stats.bannersPreserved} banner)`,
      });
      onUpdate?.();

      // Tự động dịch nếu đã cấu hình
      if (SettingsStore.get('autoTranslateAfterAsr') && SettingsStore.hasGeminiKey()) {
        await TranslateRunner.runTranslate(taskId, undefined, onUpdate);
      }

      return finalTask;
    } catch (err: any) {
      if (isCancelledError(err)) {
        console.log(`[HybridRunner] Tác vụ ${taskId} đã được huỷ.`);
        TaskStore.update(taskId, {
          status: 'cancelled',
          stageDescription: 'Đã huỷ tác vụ Kết hợp Whisper + OCR',
        });
      } else {
        console.error(`[HybridRunner] Lỗi kết hợp Whisper + OCR trên tác vụ ${taskId}:`, err);
        TaskStore.update(taskId, {
          status: 'error',
          errorMessage: err?.message || String(err),
          stageDescription: `Lỗi kết hợp: ${err?.message || String(err)}`,
        });
      }
      onUpdate?.();
      return TaskStore.getById(taskId);
    } finally {
      this.runningTasks.delete(taskId);
      this.cancelledTasks.delete(taskId);
      onUpdate?.();
    }
  }
}
