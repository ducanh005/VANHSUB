import { CancelledError } from '../lib/cancel';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

const execFileAsync = promisify(execFile);

// Thiết lập đường dẫn ffmpeg binary (hỗ trợ cả môi trường dev và packaged asar)
const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
if (rawFfmpegPath) {
  ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));
}

import type { OcrCustomRegion, OcrMode } from '../store/settingsStore';

export type { OcrMode, OcrCustomRegion };

/** Chiều cao vùng đáy dành cho chế độ 'bottom' */
export const BOTTOM_CROP_RATIO = 0.35;

export interface FrameExtractResult {
  /** Thư mục chứa các khung hình PNG đã trích */
  framesDir: string;
  /** Danh sách đường dẫn khung hình, đã sắp xếp theo thứ tự thời gian */
  framePaths: string[];
  /** Khoảng thời gian giữa 2 khung liên tiếp (ms) — dùng để tính timestamp phụ đề */
  frameIntervalMs: number;
  /** Kích thước video GỐC (px) — sidecar map toạ độ y từ khung crop/scale về đây */
  width: number;
  height: number;
  /** Tỷ lệ offset dải cắt từ đỉnh khung hình (0 nếu toàn khung, 0.65 nếu bottom) */
  offsetRatio: number;
}

/** Đọc kích thước video bằng ffprobe đi kèm app — lỗi trả 0 (caller bỏ qua lọc theo y) */
async function getVideoSize(inputPath: string): Promise<{ width: number; height: number }> {
  try {
    const rawFfprobe =
      (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';
    if (!rawFfprobe) return { width: 0, height: 0 };
    const { stdout } = await execFileAsync(rawFfprobe.replace('app.asar', 'app.asar.unpacked'), [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      inputPath,
    ], { timeout: 15000, maxBuffer: 65536, windowsHide: true });
    const parts = String(stdout).trim().split(',');
    const width = parseInt(parts[0], 10);
    const height = parseInt(parts[1], 10);
    return {
      width: Number.isFinite(width) && width > 0 ? width : 0,
      height: Number.isFinite(height) && height > 0 ? height : 0,
    };
  } catch {
    return { width: 0, height: 0 };
  }
}

/**
 * Trích xuất khung hình từ video phục vụ OCR phụ đề cứng.
 *
 * Hỗ trợ 4 chế độ:
 * - auto: Toàn khung hình (Full-screen) để model tự phát hiện & phân loại phụ đề
 * - bottom: Cắt 35% dải đáy màn hình
 * - full: Toàn khung hình (nhận diện mọi text)
 * - custom: Toàn khung hình và truyền bounding box cho thuật toán lọc
 */
export async function extractFrames(
  inputPath: string,
  fps: number,
  mode: OcrMode = 'auto',
  customRegion?: OcrCustomRegion | null,
  onProgress?: (percent: number) => void,
  shouldStop?: () => boolean,
): Promise<FrameExtractResult> {
  if (shouldStop?.()) throw new CancelledError();
  if (!fs.existsSync(inputPath)) throw new Error(`Không tìm thấy file video đầu vào: ${inputPath}`);
  const { width, height } = await getVideoSize(inputPath);
  if (shouldStop?.()) throw new CancelledError();
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-ocr-'));
  let stopTimer: ReturnType<typeof setInterval> | undefined;
  try {
    return await new Promise<FrameExtractResult>((resolve, reject) => {
      const filters: string[] = [`fps=${fps}`];
      let offsetRatio = 0, cancelled = false;
      if (mode === 'bottom') {
        offsetRatio = 1 - BOTTOM_CROP_RATIO;
        filters.push(`crop=iw:ih*${BOTTOM_CROP_RATIO}:0:ih*${offsetRatio}`);
      }
      filters.push("scale=w='if(lt(iw,1280),1280,iw)':h=-2", 'format=rgb24');
      const command = ffmpeg(inputPath).videoFilters(filters).output(path.join(framesDir, 'frame_%06d.png'));
      const maybeStop = () => {
        if (shouldStop?.()) { cancelled = true; command.kill('SIGKILL'); }
      };
      if (shouldStop) stopTimer = setInterval(maybeStop, 200);
      command.on('start', maybeStop)
        .on('progress', (progress) => {
          if (progress?.percent !== undefined) onProgress?.(Math.min(99, Math.max(0, Math.round(progress.percent))));
          maybeStop();
        })
        .on('end', () => {
          if (cancelled || shouldStop?.()) { reject(new CancelledError()); return; }
          try {
            const framePaths = fs.readdirSync(framesDir).filter(file => file.endsWith('.png')).sort().map(file => path.join(framesDir, file));
            if (!framePaths.length) throw new Error('Không trích được khung hình nào — file có thể không phải video hoặc đã hỏng.');
            resolve({ framesDir, framePaths, frameIntervalMs: 1000 / fps, width, height, offsetRatio });
          } catch (error) { reject(error); }
        })
        .on('error', (error) => reject(cancelled || shouldStop?.() ? new CancelledError() : new Error(`Lỗi trích xuất khung hình bằng ffmpeg: ${error.message}`)))
        .run();
    });
  } catch (error) {
    // The caller receives no framesDir on rejection; extractor owns its cleanup.
    cleanupFrames(framesDir);
    throw error;
  } finally {
    if (stopTimer) clearInterval(stopTimer);
  }
}

/** Xoá thư mục khung hình tạm (bỏ qua nếu đã bị xoá). */
export function cleanupFrames(framesDir: string): void {
  try {
    fs.rmSync(framesDir, { recursive: true, force: true });
  } catch (err: any) {
    console.warn(`[OCR] Không xoá được thư mục khung tạm ${framesDir}:`, err?.message ?? err);
  }
}
