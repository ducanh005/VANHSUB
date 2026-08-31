import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

// Thiết lập đường dẫn ffmpeg binary — cùng pattern phòng thủ với audioExtractor.ts
// (hỗ trợ cả môi trường dev và packaged asar)
const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
try {
  if (rawFfmpegPath) {
    ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));
  }
} catch (err) {
  console.error('Lỗi khi thiết lập đường dẫn ffmpeg:', err);
}

/**
 * Escape đường dẫn phụ đề cho filter ffmpeg subtitles trên Windows:
 * đổi \ thành /, escape dấu hai chấm của ổ đĩa (C:/ -> C\:/).
 * Phần caller chịu trách nhiệm bọc nháy đơn quanh giá trị để chịu được dấu cách.
 */
function escapeFfmpegSubtitlesPath(srtPath: string): string {
  // Thay đổi dấu gạch chéo ngược thành gạch chéo xuôi
  let escaped = srtPath.replace(/\\/g, '/');
  // Escape dấu hai chấm của ổ đĩa bằng MỘT backslash: C:/abc -> C\:/abc
  // (ffmpeg filter chỉ unescape đúng 1 cấp; '\\:' sẽ thành đường dẫn sai)
  escaped = escaped.replace(/^([A-Za-z]):/, '$1\\:');
  return escaped;
}

export interface RenderOptions {
  videoPath: string;
  srtPath: string;
  outputPath: string;
  onProgress?: (percent: number) => void;
}

/**
 * Trích xuất thời lượng video (giây) bằng ffmpeg.ffprobe hoặc fallback.
 */
function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err || !metadata || !metadata.format || !metadata.format.duration) {
        resolve(0);
      } else {
        resolve(Number(metadata.format.duration) || 0);
      }
    });
  });
}

/**
 * Chuyển đổi chuỗi timemark (HH:MM:SS.ms) sang giây.
 */
function timemarkToSeconds(timemark: string): number {
  if (!timemark) return 0;
  const parts = timemark.split(':');
  if (parts.length === 3) {
    const h = Number(parts[0]) || 0;
    const m = Number(parts[1]) || 0;
    const s = Number(parts[2]) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = Number(parts[0]) || 0;
    const s = Number(parts[1]) || 0;
    return m * 60 + s;
  }
  return Number(timemark) || 0;
}

/**
 * Ghi cứng phụ đề (Hardsub) vào video.
 */
export async function burnHardsub(options: RenderOptions): Promise<void> {
  const { videoPath, srtPath, outputPath, onProgress } = options;

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video gốc không tồn tại: ${videoPath}`);
  }
  if (!fs.existsSync(srtPath)) {
    throw new Error(`File phụ đề không tồn tại: ${srtPath}`);
  }

  // Để an toàn tuyệt đối với tiếng Việt/Unicode và ký tự lạ trong đường dẫn trên Windows:
  // Copy SRT ra một file tạm có tên ASCII thuần trong thư mục temp của OS.
  const tempSrtPath = path.join(os.tmpdir(), `vanhsub_temp_${Date.now()}_render.srt`);
  fs.copyFileSync(srtPath, tempSrtPath);

  const escapedSubPath = escapeFfmpegSubtitlesPath(tempSrtPath);
  const duration = await getVideoDuration(videoPath);

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      try {
        if (fs.existsSync(tempSrtPath)) {
          fs.unlinkSync(tempSrtPath);
        }
      } catch (e) {
        console.error('Lỗi dọn dẹp file phụ đề tạm:', e);
      }
    };

    ffmpeg(videoPath)
      .videoFilters(`subtitles=filename='${escapedSubPath}'`)
      .videoCodec('libx264')
      .outputOptions([
        '-crf 23',
        '-preset veryfast',
        '-pix_fmt yuv420p'
      ])
      .audioCodec('aac')
      .output(outputPath)
      .on('start', (cmd) => {
        console.log('Bắt đầu ffmpeg burn hardsub với command:', cmd);
      })
      .on('progress', (progress) => {
        if (!onProgress) return;
        let percent = progress.percent;
        if (percent === undefined || isNaN(percent) || percent < 0) {
          if (duration > 0 && progress.timemark) {
            const currentSec = timemarkToSeconds(progress.timemark);
            percent = Math.min(99.9, (currentSec / duration) * 100);
          } else {
            percent = 0;
          }
        }
        onProgress(Math.round(percent * 10) / 10);
      })
      .on('end', () => {
        cleanup();
        if (onProgress) onProgress(100);
        resolve();
      })
      .on('error', (err) => {
        cleanup();
        reject(new Error(`Lỗi render ffmpeg: ${err.message}`));
      })
      .run();
  });
}

/**
 * Đóng gói phụ đề mềm (Softsub) vào container MP4.
 */
export async function muxSoftsub(options: Omit<RenderOptions, 'onProgress'>): Promise<void> {
  const { videoPath, srtPath, outputPath } = options;

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video gốc không tồn tại: ${videoPath}`);
  }
  if (!fs.existsSync(srtPath)) {
    throw new Error(`File phụ đề không tồn tại: ${srtPath}`);
  }

  return new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .input(srtPath)
      .outputOptions([
        '-c:v copy',
        '-c:a copy',
        '-c:s mov_text',
        '-map 0:v',
        '-map 0:a',
        '-map 1:s'
      ])
      .output(outputPath)
      .on('start', (cmd) => {
        console.log('Bắt đầu ffmpeg mux softsub với command:', cmd);
      })
      .on('end', () => {
        resolve();
      })
      .on('error', (err) => {
        reject(new Error(`Lỗi muxing ffmpeg: ${err.message}`));
      })
      .run();
  });
}
