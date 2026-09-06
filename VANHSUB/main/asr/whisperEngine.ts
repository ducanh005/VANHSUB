// Module xử lý ASR (Speech-to-Text) bằng whisper.cpp qua package nodejs-whisper.
// Đây là "domain logic" thuần túy — KHÔNG import gì từ electron, để có thể test
// độc lập qua script terminal (scripts/test-asr.ts) mà không cần mở app lên.

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { nodewhisper } from 'nodejs-whisper';
import { parseSrt, serializeSrt, type SrtLine } from '../lib/srt';
import { CancelledError } from '../lib/cancel';
import { getFfmpegBinPath, getMediaDurationSec } from './audioExtractor';

const execFileAsync = promisify(execFile);

export interface TranscribeOptions {
  /**
   * Tên model whisper cần dùng, vd: 'base', 'small', 'medium'.
   * nodejs-whisper hỗ trợ sẵn định dạng ggml của Whisper (đa ngôn ngữ),
   * gồm cả tiếng Việt — không cần model riêng như PhoWhisper.
   */
  modelName?: string;

  /**
   * Thư mục lưu model đã tải — để tách khỏi thư mục mặc định của package,
   * dễ quản lý dung lượng và đường dẫn khi đóng gói app.
   */
  modelRootPath?: string;

  /** Tiến trình 0-100 (đo theo chunk khi audio dài — whisper.cpp không có event progress) */
  onProgress?: (percent: number) => void;

  /** Trả về true để huỷ — dừng giữa các chunk audio (hợp tác) */
  shouldStop?: () => boolean;
}

export interface TranscribeResult {
  /** Đường dẫn file .srt vừa được tạo ra */
  srtPath: string;
}

const DEFAULT_MODEL = 'base';

// =========================================================================
// CHUNKING CHO AUDIO DÀI — whisper.cpp nạp toàn bộ mel-spectrogram vào RAM,
// audio nhiều giờ sẽ chậm/oom. Chia thành chunk ~10 phút (chồng lấp 2s ở
// biên để không cắt cụt từ), phiên âm từng chunk rồi gộp về 1 file .srt.
// =========================================================================

/** Ngưỡng chuyển sang chia chunk (giây) */
const CHUNK_THRESHOLD_SEC = 900; // 15 phút
/** Độ dài mỗi chunk (giây) */
const CHUNK_SEC = 600; // 10 phút
/** Phần chồng lấp giữa 2 chunk liên tiếp (giây) — tránh cắt cụt từ ở biên */
const CHUNK_OVERLAP_SEC = 2;

export interface ChunkTranscript {
  /** Vị trí bắt đầu của chunk trong audio gốc (ms) */
  offsetMs: number;
  /** Các dòng phụ đề của chunk (timestamp tính theo thời gian local của chunk) */
  lines: SrtLine[];
}

/**
 * Gộp phụ đề các chunk về 1 timeline duy nhất (hàm thuần — test được độc lập).
 *
 * Vùng có thể trùng lặp giữa chunk trước và chunk này có bề rộng 2×overlap:
 * chunk trước được kéo dài thêm `overlap` giây ở đuôi, chunk này bắt đầu sớm
 * `overlap` giây ở đầu. Dòng của chunk này bắt đầu trong vùng đó sẽ bị bỏ nếu
 * chunk trước đang "có tiếng" lúc đó (dòng cuối của chunk trước kết thúc SAU
 * điểm bắt đầu dòng này) — tức là câu thoại kéo dài qua biên, chunk trước đã
 * ghi rồi. Ngược lại (chunk trước im lặng ở vùng đó) thì giữ nguyên dòng.
 */
export function mergeChunkTranscripts(chunks: ChunkTranscript[], overlapMs: number): SrtLine[] {
  const merged: SrtLine[] = [];
  let lastKeptEndMs = 0;

  chunks.forEach((chunk, chunkIndex) => {
    const overlapEndAbs = chunk.offsetMs + overlapMs * 2;

    for (const line of chunk.lines) {
      if (!line.text?.trim()) continue;
      const startMs = chunk.offsetMs + line.startMs;
      const endMs = Math.max(chunk.offsetMs + line.endMs, startMs + 200);

      // Câu thoại kéo dài qua biên chunk — chunk trước đã ghi phần này rồi
      if (chunkIndex > 0 && startMs < overlapEndAbs - 250 && lastKeptEndMs > startMs) {
        continue;
      }

      merged.push({ id: `line-${merged.length}`, startMs, endMs, text: line.text.trim() });
      lastKeptEndMs = endMs;
    }
  });

  return merged.sort((a, b) => a.startMs - b.startMs).map((l, i) => ({ ...l, id: `line-${i}` }));
}

/** Cắt 1 đoạn WAV từ file audio gốc (stream copy — rất nhanh với WAV/PCM) */
async function extractChunkWav(
  inputPath: string,
  outputPath: string,
  startSec: number,
  durationSec: number,
): Promise<void> {
  await execFileAsync(getFfmpegBinPath(), [
    '-ss', String(startSec),
    '-i', inputPath,
    '-t', String(durationSec),
    '-c', 'copy',
    '-y',
    outputPath,
  ]);
}

/** Phiên âm 1 file qua nodejs-whisper và kiểm tra file .srt đầu ra */
async function whisperToSrt(
  audioPath: string,
  options: TranscribeOptions,
): Promise<string> {
  const modelName = options.modelName ?? DEFAULT_MODEL;

  await nodewhisper(audioPath, {
    modelName,
    autoDownloadModelName: modelName,
    ...(options.modelRootPath ? { modelRootPath: options.modelRootPath } : {}),
    whisperOptions: {
      outputInSrt: true,
      outputInText: false,
      outputInVtt: false,
      outputInCsv: false,
      translateToEnglish: false,
      wordTimestamps: false,
      splitOnWord: true,
    },
  });

  // nodejs-whisper tạo file SRT bằng cách nối ".srt" vào toàn bộ tên file:
  // video.wav -> video.wav.srt
  const srtPath = `${audioPath}.srt`;
  if (!fs.existsSync(srtPath)) {
    throw new Error(
      `nodejs-whisper chạy xong nhưng không thấy file srt tại: ${srtPath}. ` +
      `Kiểm tra lại output của whisper.cpp.`,
    );
  }
  return srtPath;
}

/**
 * Chuyển 1 file audio/video thành phụ đề .srt.
 *
 * Audio ngắn (<= 15 phút): gửi cả file cho whisper.cpp như cũ.
 * Audio dài: chia chunk ~10 phút có chồng lấp 2s, phiên âm từng chunk có
 * báo tiến trình + cho phép huỷ, rồi gộp timestamp về 1 file .srt duy nhất.
 *
 * @param audioPath  Đường dẫn TUYỆT ĐỐI tới file audio (WAV 16kHz đã trích).
 * @param options    Tùy chọn model / tiến trình / huỷ.
 */
export async function transcribe(
  audioPath: string,
  options: TranscribeOptions = {},
): Promise<TranscribeResult> {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Không tìm thấy file audio: ${audioPath}`);
  }

  const durationSec = await getMediaDurationSec(audioPath);

  // Audio ngắn hoặc không đọc được duration → đi đường 1 file như cũ
  if (durationSec <= CHUNK_THRESHOLD_SEC) {
    const srtPath = await whisperToSrt(audioPath, options);
    options.onProgress?.(100);
    return { srtPath };
  }

  // ---------- Đường chunked cho audio dài ----------
  const totalChunks = Math.ceil(durationSec / CHUNK_SEC);
  const chunkDir = `${audioPath}.chunks`;
  console.log(
    `[ASR] Audio dài ${durationSec.toFixed(0)}s → chia ${totalChunks} chunk (~${CHUNK_SEC}s, chồng lấp ${CHUNK_OVERLAP_SEC}s)`
  );

  fs.rmSync(chunkDir, { recursive: true, force: true });
  fs.mkdirSync(chunkDir, { recursive: true });

  try {
    const chunks: ChunkTranscript[] = [];

    for (let i = 0; i < totalChunks; i++) {
      if (options.shouldStop?.()) {
        throw new CancelledError();
      }

      const startSec = Math.max(0, i * CHUNK_SEC - CHUNK_OVERLAP_SEC);
      const durSec = Math.min(CHUNK_SEC + CHUNK_OVERLAP_SEC, durationSec - startSec);
      const chunkPath = path.join(chunkDir, `chunk_${String(i).padStart(4, '0')}.wav`);

      await extractChunkWav(audioPath, chunkPath, startSec, durSec);

      const chunkSrtPath = await whisperToSrt(chunkPath, options);
      const chunkLines = parseSrt(fs.readFileSync(chunkSrtPath, 'utf-8'));
      chunks.push({ offsetMs: Math.round(startSec * 1000), lines: chunkLines });

      // Dọn ngay chunk vừa phiên âm xong để tiết kiệm đĩa với video nhiều giờ
      try {
        fs.unlinkSync(chunkPath);
        fs.unlinkSync(chunkSrtPath);
      } catch {
        // bỏ qua — cleanup tổng ở finally sẽ xử lý phần còn lại
      }

      options.onProgress?.(Math.round(((i + 1) / totalChunks) * 100));
      console.log(`[ASR] Xong chunk ${i + 1}/${totalChunks}`);
    }

    const merged = mergeChunkTranscripts(chunks, CHUNK_OVERLAP_SEC * 1000);
    console.log(`[ASR] Gộp ${chunks.length} chunk → ${merged.length} dòng phụ đề`);

    const srtPath = `${audioPath}.srt`;
    fs.writeFileSync(srtPath, merged.length > 0 ? serializeSrt(merged) : '', 'utf-8');
    return { srtPath };
  } finally {
    try {
      fs.rmSync(chunkDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn('[ASR] Không xoá được thư mục chunk tạm:', cleanupErr);
    }
  }
}
