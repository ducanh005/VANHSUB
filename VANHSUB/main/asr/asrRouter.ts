import fs from 'fs';
import { SettingsStore } from '../store/settingsStore';
import { isCancelledError } from '../lib/cancel';
import { checkFasterWhisperAvailable } from '../lib/pythonEnv';
import { runFasterWhisper } from './fasterWhisperEngine';
import { transcribe as transcribeWhisperCpp } from './whisperEngine';

export interface AsrOptions {
  model?: string;
  language?: string;
  asrEngine?: 'faster-whisper' | 'whisper-cpp';
  device?: 'auto' | 'cuda' | 'cpu';
  enableDiarization?: boolean;
  speakerCount?: number;
  hfToken?: string;
  onProgress?: (progress: number, stage?: string) => void;
  shouldStop?: () => boolean;
  /** Cho phép tuỳ biến hàm kiểm tra khả dụng (hỗ trợ testing & mocking) */
  customFwChecker?: () => Promise<{ available: boolean; useCuda: boolean; reason?: string }>;
  /** Cho phép tuỳ biến runner thực thi (hỗ trợ testing & mocking) */
  customFwRunner?: (audioPath: string, options: any) => Promise<any>;
}

export interface AsrResult {
  srtPath: string;
  engineUsed: 'faster-whisper' | 'whisper-cpp';
  fallbackTriggered: boolean;
  speakers?: string[];
  words?: Array<{ word: string; startMs: number; endMs: number; speaker?: string }>;
}

/**
 * Điều phối phiên âm đa tầng (Unified ASR Dispatcher)
 * Hỗ trợ Faster-Whisper (mặc định) và Whisper.cpp với cơ chế 2-Tier Fallback tự động.
 */
export async function transcribeUnified(
  audioPath: string,
  options: AsrOptions = {}
): Promise<AsrResult> {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Không tìm thấy file audio cần phiên âm: ${audioPath}`);
  }

  const requestedEngine =
    options.asrEngine ||
    (SettingsStore.get('asrEngine') as 'faster-whisper' | 'whisper-cpp') ||
    'faster-whisper';

  // 1. Nếu người dùng chọn đích danh whisper-cpp
  if (requestedEngine === 'whisper-cpp') {
    const result = await transcribeWhisperCpp(audioPath, {
      modelName: options.model,
      language: options.language,
      onProgress: (percent) => options.onProgress?.(percent, `Đang phiên âm whisper.cpp (${percent}%)...`),
      shouldStop: options.shouldStop,
    });
    return {
      srtPath: result.srtPath,
      engineUsed: 'whisper-cpp',
      fallbackTriggered: false,
    };
  }

  // 2. Chế độ Faster-Whisper: Kiểm tra môi trường (Tier 1 Pre-flight check)
  const fwCheck = options.customFwChecker
    ? await options.customFwChecker()
    : await checkFasterWhisperAvailable();

  if (!fwCheck.available) {
    console.warn(
      `[ASR Router] Faster-Whisper không khả dụng (${fwCheck.reason}). Đang tự động chuyển sang whisper.cpp...`
    );
    options.onProgress?.(5, 'Faster-Whisper không khả dụng, đang tự động fallback về whisper.cpp...');

    const result = await transcribeWhisperCpp(audioPath, {
      modelName: options.model,
      language: options.language,
      onProgress: (percent) =>
        options.onProgress?.(percent, `[Fallback whisper.cpp] Đang phiên âm (${percent}%)...`),
      shouldStop: options.shouldStop,
    });

    return {
      srtPath: result.srtPath,
      engineUsed: 'whisper-cpp',
      fallbackTriggered: true,
    };
  }

  // 3. Thực thi Faster-Whisper với cơ chế phục hồi lỗi thời gian chạy (Tier 2 Runtime Fallback)
  try {
    const fwResult = options.customFwRunner
      ? await options.customFwRunner(audioPath, options)
      : await runFasterWhisper(audioPath, {
          modelName: options.model,
          language: options.language,
          device: options.device || (SettingsStore.get('asrDevice') as 'auto' | 'cuda' | 'cpu'),
          enableDiarization: options.enableDiarization,
          speakerCount: options.speakerCount,
          hfToken: options.hfToken || (SettingsStore.get('hfToken') as string),
          onProgress: options.onProgress,
          shouldStop: options.shouldStop,
        });

    return {
      srtPath: fwResult.srtPath,
      engineUsed: 'faster-whisper',
      fallbackTriggered: false,
      speakers: fwResult.speakers,
      words: fwResult.words,
    };
  } catch (err: any) {
    // Không fallback nếu người dùng chủ động huỷ tác vụ
    if (isCancelledError(err)) {
      throw err;
    }

    console.warn(
      `[ASR Router] Faster-Whisper gặp lỗi khi chạy: ${err?.message || String(err)}. Tự động fallback sang whisper.cpp...`
    );
    options.onProgress?.(5, 'Faster-Whisper gặp lỗi runtime, đang tự động fallback về whisper.cpp...');

    const result = await transcribeWhisperCpp(audioPath, {
      modelName: options.model,
      language: options.language,
      onProgress: (percent) =>
        options.onProgress?.(percent, `[Fallback whisper.cpp] Đang phiên âm (${percent}%)...`),
      shouldStop: options.shouldStop,
    });

    return {
      srtPath: result.srtPath,
      engineUsed: 'whisper-cpp',
      fallbackTriggered: true,
    };
  }
}
