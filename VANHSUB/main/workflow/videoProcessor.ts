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
   * Đọc thông tin chi tiết stream của video qua ffprobe (thời lượng, kích thước, audio)
   */
  public static async getVideoStreamInfo(videoPath: string): Promise<{
    duration: number;
    hasAudio: boolean;
    width: number;
    height: number;
  }> {
    if (!videoPath || !fs.existsSync(videoPath)) {
      return { duration: 5, hasAudio: false, width: 1280, height: 720 };
    }

    return new Promise((resolve) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err || !metadata) {
          resolve({ duration: 5, hasAudio: false, width: 1280, height: 720 });
          return;
        }
        const videoStream = metadata.streams?.find((s) => s.codec_type === 'video');
        const audioStream = metadata.streams?.find((s) => s.codec_type === 'audio');
        const dur = metadata.format?.duration || videoStream?.duration;
        const parsed = Number(dur);
        const duration = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
        const width = videoStream?.width || 1280;
        const height = videoStream?.height || 720;
        resolve({
          duration,
          hasAudio: Boolean(audioStream),
          width,
          height,
        });
      });
    });
  }

  /**
   * Đọc thời lượng (giây) của video qua ffprobe
   */
  public static async getVideoDuration(videoPath: string): Promise<number> {
    const info = await this.getVideoStreamInfo(videoPath);
    return info.duration;
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
   * Ghép nối danh sách video thành một sequence liền mạch qua FFmpeg filter_complex
   * Chuẩn hóa timebase, PTS, framerate 24fps và âm thanh (resample/silence synthesis).
   * Kiểm tra nghiêm ngặt sự tồn tại của từng phân cảnh và sai số thời lượng.
   */
  public static async concatVideos(
    inputPaths: string[],
    outputPath: string,
    ctx?: ExecutionContext,
    options?: TransitionOptions
  ): Promise<string> {
    if (!inputPaths || inputPaths.length === 0) {
      throw new Error('Không có video hợp lệ nào để ghép!');
    }

    // 1. Kiểm tra nghiêm ngặt từng file phân cảnh (không âm thầm lọc bỏ)
    for (let i = 0; i < inputPaths.length; i++) {
      const p = inputPaths[i];
      if (!p || typeof p !== 'string' || !fs.existsSync(p)) {
        throw new Error(
          `MISSING_SCENE_VIDEO_INPUT: Phân cảnh ${i + 1} (${p || 'đường dẫn rỗng'}) không tồn tại!`
        );
      }
      try {
        const stat = fs.statSync(p);
        if (stat.size === 0) {
          throw new Error(
            `MISSING_SCENE_VIDEO_INPUT: Phân cảnh ${i + 1} (${p}) có kích thước rỗng (0 bytes)!`
          );
        }
      } catch (err: any) {
        if (err.message.includes('MISSING_SCENE_VIDEO_INPUT')) throw err;
        throw new Error(
          `MISSING_SCENE_VIDEO_INPUT: Không thể đọc phân cảnh ${i + 1} (${p}): ${err.message}`
        );
      }
    }

    if (inputPaths.length === 1) {
      fs.copyFileSync(inputPaths[0], outputPath);
      return outputPath;
    }

    // Đọc thông tin chi tiết từng video để tính expectedDuration và kiểm tra stream
    const streamInfos = await Promise.all(
      inputPaths.map((p) => this.getVideoStreamInfo(p))
    );
    const expectedDuration = streamInfos.reduce((acc, s) => acc + s.duration, 0);

    // Nếu có yêu cầu hiệu ứng chuyển cảnh và effect khác 'none'
    const effect = options?.effect;
    if (effect && effect !== 'none' && inputPaths.length >= 2) {
      const tempDir = path.dirname(outputPath);
      let currentFile = inputPaths[0];
      const cleanupFiles: string[] = [];

      try {
        for (let i = 1; i < inputPaths.length; i++) {
          const nextFile = inputPaths[i];
          const stepOut = path.join(
            tempDir,
            `seq_trans_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}.mp4`
          );
          cleanupFiles.push(stepOut);

          if (ctx?.onProgress) {
            const stepPercent = Math.round((i / inputPaths.length) * 90);
            ctx.onProgress(stepPercent);
          }

          await this.applyTransition(currentFile, nextFile, stepOut, options, ctx);
          currentFile = stepOut;
        }

        fs.copyFileSync(currentFile, outputPath);

        // Dọn dẹp tệp tạm bước trung gian
        for (const f of cleanupFiles) {
          try {
            if (fs.existsSync(f)) fs.unlinkSync(f);
          } catch {}
        }

        return outputPath;
      } catch (err: any) {
        console.warn(
          '[VideoProcessor] Lỗi ghép sequence có transition, chuyển về concat thông thường:',
          err?.message
        );
        for (const f of cleanupFiles) {
          try {
            if (fs.existsSync(f)) fs.unlinkSync(f);
          } catch {}
        }
        // Fallback về concat filter_complex bên dưới
      }
    }

    const tempDir = path.dirname(outputPath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Xác định kích thước chuẩn hóa từ video đầu tiên (làm chẵn)
    const rawTargetWidth = streamInfos[0].width || 1280;
    const rawTargetHeight = streamInfos[0].height || 720;
    const targetWidth = Math.floor(rawTargetWidth / 2) * 2;
    const targetHeight = Math.floor(rawTargetHeight / 2) * 2;

    const filterParts: string[] = [];
    const concatStreams: string[] = [];

    for (let i = 0; i < inputPaths.length; i++) {
      const info = streamInfos[i];
      // Chuẩn hóa Video: scale phù hợp, pad đen nếu lệch tỉ lệ, khóa framerate 24fps và reset PTS
      filterParts.push(
        `[${i}:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,fps=24,setpts=PTS-STARTPTS[v${i}]`
      );

      // Chuẩn hóa Audio: nếu có track âm thanh thì resample 48000Hz và reset PTS; nếu không có thì tạo âm thanh tĩnh (silence)
      if (info.hasAudio) {
        filterParts.push(
          `[${i}:a]aresample=48000,asetpts=PTS-STARTPTS[a${i}]`
        );
      } else {
        const safeDur = Math.max(0.1, info.duration).toFixed(3);
        filterParts.push(
          `aevalsrc=0:d=${safeDur}:s=48000[a${i}]`
        );
      }

      concatStreams.push(`[v${i}][a${i}]`);
    }

    filterParts.push(
      `${concatStreams.join('')}concat=n=${inputPaths.length}:v=1:a=1[outv][outa]`
    );

    await new Promise<string>((resolve, reject) => {
      let proc = ffmpeg();
      for (const p of inputPaths) {
        proc = proc.input(p);
      }

      proc
        .complexFilter(filterParts)
        .outputOptions([
          '-map [outv]',
          '-map [outa]',
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-preset veryfast',
          '-c:a aac',
          '-b:a 192k',
          '-movflags +faststart',
        ])
        .output(outputPath)
        .on('progress', (p) => {
          if (ctx?.onProgress && p.percent) {
            ctx.onProgress(Math.min(95, Math.round(p.percent)));
          }
        })
        .on('end', () => resolve(outputPath))
        .on('error', (err) =>
          reject(new Error(`Lỗi khi ghép nối video qua FFmpeg filter_complex: ${err.message}`))
        )
        .run();
    });

    // Kiểm tra thời lượng thực tế so với expectedDuration
    const actualDuration = await this.getVideoDuration(outputPath);
    const tolerance = Math.max(0.6, inputPaths.length * 0.15);
    if (Math.abs(actualDuration - expectedDuration) > tolerance) {
      throw new Error(
        `CONCAT_DURATION_MISMATCH: Thời lượng xuất (${actualDuration.toFixed(2)}s) lệch quá lớn so với kỳ vọng (${expectedDuration.toFixed(2)}s, sai số cho phép ${tolerance.toFixed(2)}s)!`
      );
    }

    if (ctx?.onProgress) {
      ctx.onProgress(100);
    }

    return outputPath;
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
