import os from 'os';
import fs from 'fs';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { CancelledError } from '../lib/cancel';

/** Ngưỡng tin cậy tối thiểu của TỪNG DÒNG chữ để được giữ (0-100) */
export const MIN_LINE_CONFIDENCE = 40;

export interface OcrFrameResult {
  /** Text của khung = các dòng đạt ngưỡng ghép lại */
  text: string;
  /** Tin cậy trung bình của các dòng đã giữ (0 nếu không giữ dòng nào) */
  confidence: number;
}

/** 1 dòng chữ Tesseract trả về trong khung */
interface RecognizedLine {
  text: string;
  confidence: number;
}

/** Gom các dòng từ cấu trúc blocks của tesseract.js — bỏ qua nếu version không trả blocks */
function extractLines(data: unknown): RecognizedLine[] {
  const lines: RecognizedLine[] = [];
  const blocks = (data as { blocks?: unknown[] } | null)?.blocks;
  if (!Array.isArray(blocks)) return lines;
  for (const block of blocks) {
    const paragraphs = (block as { paragraphs?: unknown[] })?.paragraphs;
    if (!Array.isArray(paragraphs)) continue;
    for (const para of paragraphs) {
      for (const line of (para as { lines?: Array<{ text?: string; confidence?: number }> })?.lines ?? []) {
        const text = (line.text || '').trim();
        if (!text) continue;
        lines.push({ text, confidence: line.confidence ?? 0 });
      }
    }
  }
  return lines;
}

/**
 * Pool worker Tesseract dùng chung cho 1 lần quét OCR.
 *
 * Mỗi worker nạp ngôn ngữ đúng 1 lần rồi nhận liên tiếp nhiều khung hình
 * (nạp lại ngôn ngữ cho từng khung sẽ chậm gấp nhiều lần). Số worker được
 * giới hạn thấp vì OCR chạy trên CPU — quá nhiều worker tranh hạt nhân
 * với Whisper/TTS đang chạy nền.
 */
export class OcrPool {
  private workers: Worker[] = [];

  static async create(
    language: string,
    cachePath: string,
    size?: number,
  ): Promise<OcrPool> {
    const workerCount =
      size ?? Math.max(1, Math.min(3, os.cpus().length - 1));

    fs.mkdirSync(cachePath, { recursive: true });

    const pool = new OcrPool();
    pool.workers = await Promise.all(
      Array.from({ length: workerCount }, async () => {
        const worker = await createWorker(language, 1, { cachePath, logger: () => {} });
        // PSM 6 (khối văn bản) quét được cả dải phụ đề crop lẫn toàn khung —
        // trả về nhiều dòng kèm confidence riêng từng dòng để lọc nhiễu nền
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
        return worker;
      }),
    );
    return pool;
  }

  /**
   * Nhận diện tuần tự từng khung trên pool, chia đều khung cho các worker.
   * Trả về mảng kết quả cùng thứ tự đầu vào. Huỷ mang tính hợp tác — kiểm tra
   * shouldStop trước mỗi khung, khung đang chạy sẽ chạy xong rồi mới dừng.
   *
   * Lọc theo confidence TỪNG DÒNG chứ không phải mean cả khung: video thật
   * có nền bận (người/cảnh vật) kéo mean cả khung xuống dưới ngưỡng dù dòng
   * phụ đề in rõ vẫn conf 60-90 — lọc theo khung sẽ làm mất gần hết kết quả.
   */
  async recognizeFiles(
    files: string[],
    onProgress?: (done: number, total: number) => void,
    shouldStop?: () => boolean,
  ): Promise<OcrFrameResult[]> {
    const results: OcrFrameResult[] = new Array(files.length);
    let nextIndex = 0;
    let done = 0;

    const runWorker = async (worker: Worker): Promise<void> => {
      while (true) {
        if (shouldStop?.()) throw new CancelledError();
        const index = nextIndex++;
        if (index >= files.length) return;

        const { data } = await worker.recognize(files[index], {}, { text: true, blocks: true });

        // Fallback chỉ dành cho trường hợp tesseract KHÔNG trả cấu trúc blocks
        // (version khác). Nếu blocks có mà không dòng nào đạt ngưỡng thì trả
        // khung rỗng — tuyệt đối không bơm lại text nguyên khung đầy nhiễu nền.
        if (!Array.isArray((data as { blocks?: unknown } | null)?.blocks)) {
          const whole = ((data as { text?: string } | null)?.text || '').trim();
          const conf = (data as { confidence?: number } | null)?.confidence ?? 0;
          results[index] = { text: whole, confidence: conf };
        } else {
          const kept = extractLines(data)
            .filter((l) => l.confidence >= MIN_LINE_CONFIDENCE)
            .map((l) => ({ text: l.text, confidence: l.confidence }));

          if (kept.length > 0) {
            const meanConf = kept.reduce((s, l) => s + l.confidence, 0) / kept.length;
            results[index] = { text: kept.map((l) => l.text).join(' '), confidence: meanConf };
          } else {
            results[index] = { text: '', confidence: 0 };
          }
        }

        done++;
        onProgress?.(done, files.length);
      }
    };

    await Promise.all(this.workers.map((w) => runWorker(w)));
    return results;
  }

  async terminate(): Promise<void> {
    await Promise.allSettled(this.workers.map((w) => w.terminate()));
    this.workers = [];
  }
}
