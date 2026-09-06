import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

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

// ffprobe đi kèm app (trước đây phụ thuộc ffprobe trong PATH hệ thống —
// máy sạch sẽ khiến progress hardsub kẹt 0% vì không đọc được duration)
const rawFfprobePath =
  (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';
try {
  if (rawFfprobePath) {
    ffmpeg.setFfprobePath(rawFfprobePath.replace('app.asar', 'app.asar.unpacked'));
  }
} catch (err) {
  console.error('Lỗi khi thiết lập đường dẫn ffprobe:', err);
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

/**
 * Style phụ đề hardsub — chuyển thành chuỗi force_style (ASS) của libass.
 * Màu người dùng nhập dạng #RRGGBB; ASS dùng &HAABBGGRR (BGR + alpha 00=đục).
 */
export interface SubtitleStyle {
  fontName: string;
  /** Cỡ chữ theo đơn vị ASS (PlayResY 288) — 14-40 là hợp lý */
  fontSize: number;
  primaryColour: string;
  outlineColour: string;
  /** 30-100 (100 = chữ đục hoàn toàn) */
  opacity: number;
  outline: number;
  shadow: number;
  bold: boolean;
  /** 1 = viền + bóng, 3 = nền box đặc */
  borderStyle: 1 | 3;
  /** 2 = đáy khung, 5 = giữa, 8 = đỉnh */
  alignment: 2 | 5 | 8;
  marginV: number;
}

const clampNum = (n: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;

function sanitizeFontName(name: string): string {
  const cleaned = String(name || '').replace(/[^A-Za-z0-9 _-]/g, '').trim();
  return cleaned || 'Arial';
}

function hexToAss(hex: string, opacityPct: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''));
  const valid = m ? m[1] : 'ffffff';
  const r = parseInt(valid.slice(0, 2), 16);
  const g = parseInt(valid.slice(2, 4), 16);
  const b = parseInt(valid.slice(4, 6), 16);
  const alpha = Math.round(((100 - clampNum(opacityPct, 0, 100, 100)) / 100) * 255);
  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return `&H${toHex(alpha)}${toHex(b)}${toHex(g)}${toHex(r)}`;
}

/** Dựng giá trị force_style — các trường số/màu tự sinh nên không lo escape */
export function buildForceStyle(style: SubtitleStyle): string {
  const parts = [
    `FontName=${sanitizeFontName(style.fontName)}`,
    `FontSize=${clampNum(style.fontSize, 8, 99, 18)}`,
    `PrimaryColour=${hexToAss(style.primaryColour, style.opacity)}`,
    `OutlineColour=${hexToAss(style.outlineColour, 100)}`,
    `BorderStyle=${style.borderStyle === 3 ? 3 : 1}`,
    `Outline=${clampNum(style.outline, 0, 8, 2)}`,
    `Shadow=${clampNum(style.shadow, 0, 6, 1)}`,
    `Bold=${style.bold ? 1 : 0}`,
    `Alignment=${style.alignment === 5 || style.alignment === 8 ? style.alignment : 2}`,
    `MarginV=${clampNum(style.marginV, 0, 200, 25)}`,
  ];
  return parts.join(',');
}

/**
 * Vùng che phụ đề cũ (hardsub gốc in sẵn trong video):
 * áp dụng filter che TRƯỚC filter subtitles để phụ đề mới không đè lên chữ cũ.
 */
export interface MaskRegion {
  /** Vị trí dải che — phụ đề phim thường nằm ở đáy khung hình */
  position: 'bottom' | 'top';
  /** Chiều cao dải che theo % chiều cao khung hình (5-50) */
  heightPercent: number;
  /** solid = tô đen, blur = làm mờ vùng đó (vẫn lộ mờ khung hình gốc) */
  mode: 'solid' | 'blur';
}

export interface RenderOptions {
  videoPath: string;
  srtPath: string;
  outputPath: string;
  /** Che vùng phụ đề cũ trước khi ghi phụ đề mới (mặc định: không che) */
  mask?: MaskRegion | null;
  /** Style phụ đề tùy chỉnh (force_style ASS) — bỏ qua nếu không truyền */
  style?: SubtitleStyle | null;
  onProgress?: (percent: number) => void;
}

/** Chuẩn hoá chiều cao dải che về khoảng hợp lệ */
function clampMaskHeight(heightPercent: number): number {
  return Math.min(50, Math.max(5, Math.round(heightPercent || 22)));
}

/**
 * Sinh đoạn filter che dải phụ đề cũ (dùng trong filter_complex).
 * Dùng biến ih/iw của ffmpeg nên tự scale theo mọi độ phân giải video.
 */
function buildMaskFilter(mask: MaskRegion): string {
  const height = clampMaskHeight(mask.heightPercent);
  const bandH = `ih*${height}/100`;
  const bandY = mask.position === 'top' ? '0' : `ih-${bandH}`;

  if (mask.mode === 'blur') {
    // Tách dải phụ đề ra làm mờ rồi chồng lại đúng vị trí.
    // Lưu ý: filter overlay KHÔNG có biến `ih` — biểu thức y phải dùng `main_h`.
    const overlayY = mask.position === 'top' ? '0' : `main_h-main_h*${height}/100`;
    return (
      `[0:v]split=2[base][bandsrc];` +
      `[bandsrc]crop=iw:${bandH}:0:${bandY},boxblur=16:2[band];` +
      `[base][band]overlay=0:${overlayY}`
    );
  }
  return `drawbox=x=0:y=${bandY}:w=iw:h=${bandH}:color=black@1:t=fill`;
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

    const maskFilter = options.mask ? buildMaskFilter(options.mask) : null;
    const styleSuffix = options.style
      ? `:force_style='${buildForceStyle(options.style)}'`
      : '';

    const command = ffmpeg(videoPath);
    if (maskFilter) {
      // Có che phụ đề cũ: dựng chain filter_complex — che TRƯỚC rồi mới ghi phụ đề mới
      command.outputOptions([
        '-filter_complex',
        `${maskFilter},subtitles=filename='${escapedSubPath}'${styleSuffix}[vout]`,
        '-map', '[vout]',
        '-map', '0:a:0?',
      ]);
    } else {
      command.videoFilters(`subtitles=filename='${escapedSubPath}'${styleSuffix}`);
    }

    command
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
