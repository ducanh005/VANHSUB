import os from 'os';
import fs from 'fs';
import { createWorker, type Worker } from 'tesseract.js';
import { CancelledError } from '../lib/cancel';

export interface OcrFrameResult {
  text: string;
  confidence: number;
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
      Array.from({ length: workerCount }, () =>
        createWorker(language, 1, { cachePath, logger: () => {} }),
      ),
    );
    return pool;
  }

  /**
   * Nhận diện tuần tự từng khung trên pool, chia đều khung cho các worker.
   * Trả về mảng kết quả cùng thứ tự đầu vào. Huỷ mang tính hợp tác — kiểm tra
   * shouldStop trước mỗi khung, khung đang chạy sẽ chạy xong rồi mới dừng.
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

        const { data } = await worker.recognize(files[index]);
        results[index] = {
          text: (data.text || '').trim(),
          confidence: data.confidence ?? 0,
        };

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
