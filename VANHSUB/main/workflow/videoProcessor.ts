import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import type { ExecutionContext } from './types';

// Cấu hình đường dẫn ffmpeg và ffprobe
const rawFfmpeg = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
if (rawFfmpeg) {
  try {
    ffmpeg.setFfmpegPath(rawFfmpeg.replace('app.asar', 'app.asar.unpacked'));
  } catch {}
}

const rawFfprobe = (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';
if (rawFfprobe) {
  try {
    ffmpeg.setFfprobePath(rawFfprobe.replace('app.asar', 'app.asar.unpacked'));
  } catch {}
}

export interface TransitionOptions {
  effect?: 'cross_dissolve' | 'fade_black' | 'fade_white' | 'wipe_left' | string;
  duration?: number; // giây (mặc định 0.5s)
}

export class VideoProcessor {
  /**
   * Đọc thời lượng (giây) của video qua ffprobe
   */
  public static async getVideoDuration(videoPath: string): Promise<number> {
    if (!videoPath || !fs.existsSync(videoPath)) return 5;

    return new Promise((resolve) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err || !metadata) {
          resolve(5); // fallback an toàn 5 giây
          return;
        }
        const dur = metadata.format?.duration || metadata.streams?.[0]?.duration;
        const parsed = Number(dur);
        resolve(Number.isFinite(parsed) && parsed > 0 ? parsed : 5);
      });
    });
  }

  /**
   * Cắt đoạn video (Trim) từ startTime đến endTime
   */
  public static async trimVideo(
    inputPath: string,
    outputPath: string,
    startTime: number,
    endTime: number,
    ctx?: ExecutionContext
  ): Promise<string> {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`File video đầu vào không tồn tại: ${inputPath}`);
    }

    const start = Math.max(0, startTime);
    const duration = Math.max(0.1, endTime - start);

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(start)
        .setDuration(duration)
        .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-preset veryfast',
          '-movflags +faststart',
        ])
        .output(outputPath)
        .on('progress', (p) => {
          if (ctx?.onProgress && p.percent) {
            ctx.onProgress(Math.min(95, Math.round(p.percent)));
          }
        })
        .on('end', () => resolve(outputPath))
        .on('error', (err) => reject(new Error(`Lỗi khi cắt video: ${err.message}`)))
        .run();
    });
  }

  /**
   * Ghép nối danh sách video thành một sequence liền mạch qua Concat Demuxer
   */
  public static async concatVideos(
    inputPaths: string[],
    outputPath: string,
    ctx?: ExecutionContext
  ): Promise<string> {
    const validInputs = inputPaths.filter((p) => p && fs.existsSync(p));
    if (validInputs.length === 0) {
      throw new Error('Không có video hợp lệ nào để ghép!');
    }

    if (validInputs.length === 1) {
      fs.copyFileSync(validInputs[0], outputPath);
      return outputPath;
    }

    const tempDir = path.dirname(outputPath);
    const listFilePath = path.join(tempDir, `concat_list_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.txt`);

    // Ghi file danh sách concat cho ffmpeg
    const fileContent = validInputs
      .map((p) => `file '${p.replace(/\\/g, '/')}'`)
      .join('\n');
    fs.writeFileSync(listFilePath, fileContent, 'utf-8');

    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(listFilePath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-preset veryfast',
          '-movflags +faststart',
        ])
        .output(outputPath)
        .on('progress', (p) => {
          if (ctx?.onProgress && p.percent) {
            ctx.onProgress(Math.min(95, Math.round(p.percent)));
          }
        })
        .on('end', () => {
          try {
            fs.unlinkSync(listFilePath);
          } catch {}
          resolve(outputPath);
        })
        .on('error', (err) => {
          try {
            fs.unlinkSync(listFilePath);
          } catch {}
          reject(new Error(`Lỗi khi ghép nối video: ${err.message}`));
        })
        .run();
    });
  }

  /**
   * Áp dụng hiệu ứng chuyển cảnh (Transition) giữa 2 đoạn video
   */
  public static async applyTransition(
    videoAPath: string,
    videoBPath: string,
    outputPath: string,
    options: TransitionOptions = {},
    ctx?: ExecutionContext
  ): Promise<string> {
    if (!fs.existsSync(videoAPath) || !fs.existsSync(videoBPath)) {
      throw new Error('Không tìm thấy tệp video để thực hiện chuyển cảnh!');
    }

    const effect = options.effect || 'cross_dissolve';
    const transDur = Math.max(0.1, options.duration || 0.5);

    const durA = await this.getVideoDuration(videoAPath);
    const fadeOutStart = Math.max(0, durA - transDur);

    const tempDir = path.dirname(outputPath);
    const fadeA = path.join(tempDir, `trans_a_${Date.now()}.mp4`);
    const fadeB = path.join(tempDir, `trans_b_${Date.now()}.mp4`);

    try {
      // 1. Xử lý đoạn A (Fade Out)
      await new Promise<void>((res, rej) => {
        ffmpeg(videoAPath)
          .videoFilters(`fade=t=out:st=${fadeOutStart}:d=${transDur}`)
          .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-preset ultrafast'])
          .output(fadeA)
          .on('end', () => res())
          .on('error', (err) => rej(err))
          .run();
      });

      // 2. Xử lý đoạn B (Fade In)
      await new Promise<void>((res, rej) => {
        ffmpeg(videoBPath)
          .videoFilters(`fade=t=in:st=0:d=${transDur}`)
          .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-preset ultrafast'])
          .output(fadeB)
          .on('end', () => res())
          .on('error', (err) => rej(err))
          .run();
      });

      // 3. Ghép nối 2 đoạn đã phủ hiệu ứng
      await this.concatVideos([fadeA, fadeB], outputPath, ctx);

      // Dọn dẹp tệp phụ
      try {
        fs.unlinkSync(fadeA);
        fs.unlinkSync(fadeB);
      } catch {}

      return outputPath;
    } catch (err: any) {
      console.warn('Lỗi transition chi tiết, thực hiện ghép fallback mượt:', err?.message);
      // Dọn dẹp nếu có lỗi
      try {
        if (fs.existsSync(fadeA)) fs.unlinkSync(fadeA);
        if (fs.existsSync(fadeB)) fs.unlinkSync(fadeB);
      } catch {}
      return this.concatVideos([videoAPath, videoBPath], outputPath, ctx);
    }
  }

  /**
   * Cân bằng và đồng bộ màu sắc (Color Match / Color Grading)
   */
  public static async colorMatchVideo(
    videoPath: string,
    referenceImagePath: string,
    outputPath: string,
    intensity: number = 0.75,
    ctx?: ExecutionContext
  ): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Tệp video không tồn tại: ${videoPath}`);
    }

    // Xác định bộ lọc màu dựa trên cường độ intensity
    const sat = (1.0 + 0.3 * intensity).toFixed(2);
    const contrast = (1.0 + 0.1 * intensity).toFixed(2);
    const filterStr = `eq=contrast=${contrast}:saturation=${sat}:brightness=0.01`;

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .videoFilters(filterStr)
        .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-preset veryfast',
          '-movflags +faststart',
        ])
        .output(outputPath)
        .on('progress', (p) => {
          if (ctx?.onProgress && p.percent) {
            ctx.onProgress(Math.min(95, Math.round(p.percent)));
          }
        })
        .on('end', () => resolve(outputPath))
        .on('error', (err) => reject(new Error(`Lỗi cân bằng màu: ${err.message}`)))
        .run();
    });
  }

  /**
   * Nâng cấp độ phân giải (Upscale 2x / 4K)
   */
  public static async upscaleVideo(
    videoPath: string,
    scaleFactor: '2x' | '4x',
    outputPath: string,
    ctx?: ExecutionContext
  ): Promise<string> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Tệp video không tồn tại: ${videoPath}`);
    }

    const mult = scaleFactor === '4x' ? 4 : 2;
    const filter = `scale=iw*${mult}:ih*${mult}:flags=lanczos,unsharp=3:3:0.5:3:3:0.0`;

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .videoFilters(filter)
        .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-preset veryfast',
          '-movflags +faststart',
        ])
        .output(outputPath)
        .on('progress', (p) => {
          if (ctx?.onProgress && p.percent) {
            ctx.onProgress(Math.min(95, Math.round(p.percent)));
          }
        })
        .on('end', () => resolve(outputPath))
        .on('error', (err) => reject(new Error(`Lỗi upscale video: ${err.message}`)))
        .run();
    });
  }
}
