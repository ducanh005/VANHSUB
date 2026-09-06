import path from 'path';
import fs from 'fs';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

// Thiết lập đường dẫn ffmpeg binary (hỗ trợ cả môi trường dev và packaged asar)
const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
if (rawFfmpegPath) {
  ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));
}

/** Vùng quét phụ đề trong khung hình: đáy khung (mặc định) hoặc toàn khung */
export type OcrRegion = 'bottom' | 'full';

/** Phần trăm chiều cao khung hình dành cho vùng phụ đề ở đáy */
const BOTTOM_CROP_RATIO = 0.3;

export interface FrameExtractResult {
  /** Thư mục chứa các khung hình PNG đã trích */
  framesDir: string;
  /** Danh sách đường dẫn khung hình, đã sắp xếp theo thứ tự thời gian */
  framePaths: string[];
  /** Khoảng thời gian giữa 2 khung liên tiếp (ms) — dùng để tính timestamp phụ đề */
  frameIntervalMs: number;
}

/**
 * Trích xuất khung hình từ video phục vụ OCR phụ đề cứng.
 *
 * Tối ưu cho OCR:
 * - Lấy mẫu thưa theo fps (mặc định 2 khung/giây) thay vì quét từng khung
 * - Crop vùng phụ đề (đáy khung) để bỏ nền video → nhanh hơn và nhiễu ít hơn
 * - Chuyển xám (gray) — Tesseract phân biệt chữ/nền tốt hơn trên ảnh 1 kênh
 * - Phóng to video hẹp lên 1280px để chữ đạt độ cao đủ lớn cho Tesseract
 */
export function extractFrames(
  inputPath: string,
  fps: number,
  region: OcrRegion,
  onProgress?: (percent: number) => void,
): Promise<FrameExtractResult> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) {
      return reject(new Error(`Không tìm thấy file video đầu vào: ${inputPath}`));
    }

    const framesDir = path.join(
      os.tmpdir(),
      `vanhsub-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(framesDir, { recursive: true });

    // Thứ tự filter: lấy mẫu thưa trước rồi mới crop/đổi màu → xử lý ít khung hơn
    const filters: string[] = [`fps=${fps}`];
    if (region === 'bottom') {
      filters.push(`crop=iw:ih*${BOTTOM_CROP_RATIO}:0:ih*(1-${BOTTOM_CROP_RATIO})`);
    }
    // Chỉ phóng to khi khung hẹp hơn 1280px; -2 giữ bội số chẵn cho codec PNG
    filters.push("scale=w='if(lt(iw,1280),1280,iw)':h=-2");
    filters.push('format=gray');

    ffmpeg(inputPath)
      .videoFilters(filters)
      .output(path.join(framesDir, 'frame_%06d.png'))
      .on('progress', (progress) => {
        if (progress && progress.percent !== undefined && onProgress) {
          onProgress(Math.min(99, Math.max(0, Math.round(progress.percent))));
        }
      })
      .on('end', () => {
        const framePaths = fs
          .readdirSync(framesDir)
          .filter((f) => f.endsWith('.png'))
          .sort()
          .map((f) => path.join(framesDir, f));

        if (framePaths.length === 0) {
          return reject(
            new Error('Không trích được khung hình nào — file có thể không phải video hoặc đã hỏng.'),
          );
        }
        resolve({
          framesDir,
          framePaths,
          frameIntervalMs: Math.round(1000 / fps),
        });
      })
      .on('error', (err) => {
        reject(new Error(`Lỗi trích xuất khung hình bằng ffmpeg: ${err.message}`));
      })
      .run();
  });
}

/** Xoá thư mục khung hình tạm (bỏ qua nếu đã bị xoá). */
export function cleanupFrames(framesDir: string): void {
  try {
    fs.rmSync(framesDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[OCR] Không xoá được thư mục khung tạm ${framesDir}:`, err);
  }
}
