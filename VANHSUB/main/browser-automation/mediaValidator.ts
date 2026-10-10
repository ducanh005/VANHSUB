/**
 * main/browser-automation/mediaValidator.ts
 *
 * Comprehensive media format detection, dimension decoding, and validation module.
 *
 * Capabilities:
 * - Detects true binary format (JPEG, PNG, WebP, GIF, MP4, WebM) via magic headers.
 * - Decodes image dimensions (width, height, format) via fast binary header parsing.
 * - Deep validation of video streams, duration, dimensions, and playability using ffprobe.
 * - Extension normalization: fixes mismatched file extensions (e.g. JPEG saved as .png -> .jpg).
 * - Rejects empty, corrupted, truncated, or placeholder media files.
 */

import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { spawn, ChildProcess } from 'child_process';

// Ensure ffprobe and ffmpeg paths are initialized
const rawFfprobePath = (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';
if (rawFfprobePath) {
  ffmpeg.setFfprobePath(rawFfprobePath.replace('app.asar', 'app.asar.unpacked'));
}
const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
if (rawFfmpegPath) {
  ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));
}

export type SupportedImageFormat = 'jpeg' | 'png' | 'webp' | 'gif';
export type SupportedVideoFormat = 'mp4' | 'webm';
export type DetectedMediaFormat = SupportedImageFormat | SupportedVideoFormat | 'unknown';

export interface ImageDimensionResult {
  format: SupportedImageFormat;
  extension: '.jpg' | '.png' | '.webp' | '.gif';
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface VideoValidationResult {
  format: SupportedVideoFormat;
  extension: '.mp4' | '.webm';
  mimeType: string;
  codec: string;
  width: number;
  height: number;
  duration: number;
  sizeBytes: number;
  hasAudio: boolean;
  isValid: boolean;
}

export interface NormalizedMediaResult {
  originalPath: string;
  finalPath: string;
  wasRenamed: boolean;
  type: 'image' | 'video';
  format: DetectedMediaFormat;
  extension: string;
  width: number;
  height: number;
  duration?: number;
  codec?: string;
  sizeBytes: number;
}

/**
 * Detects the binary media format from the first 32 bytes of a buffer.
 */
export function detectFormatFromBuffer(buffer: Buffer): {
  format: DetectedMediaFormat;
  extension: string;
  mimeType: string;
} {
  if (!buffer || buffer.length < 4) {
    return { format: 'unknown', extension: '.bin', mimeType: 'application/octet-stream' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { format: 'png', extension: '.png', mimeType: 'image/png' };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { format: 'jpeg', extension: '.jpg', mimeType: 'image/jpeg' };
  }

  // WebP: RIFF (4 bytes) + file size (4 bytes) + WEBP (4 bytes)
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { format: 'webp', extension: '.webp', mimeType: 'image/webp' };
  }

  // GIF: GIF87a or GIF89a
  if (
    buffer.length >= 6 &&
    (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')
  ) {
    return { format: 'gif', extension: '.gif', mimeType: 'image/gif' };
  }

  // WebM: 1A 45 DF A3
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return { format: 'webm', extension: '.webm', mimeType: 'video/webm' };
  }

  // MP4: offset 4 contains 'ftyp'
  if (buffer.length >= 8 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    return { format: 'mp4', extension: '.mp4', mimeType: 'video/mp4' };
  }

  return { format: 'unknown', extension: '.bin', mimeType: 'application/octet-stream' };
}

/**
 * Fast pure-binary decoding of image dimensions for PNG, JPEG, and WebP.
 */
export function decodeImageDimensions(buffer: Buffer): ImageDimensionResult {
  const { format, extension, mimeType } = detectFormatFromBuffer(buffer);

  if (format === 'unknown') {
    throw new Error('Unknown or unsupported image format (expected PNG, JPEG, WebP, or GIF)');
  }

  let width = 0;
  let height = 0;

  if (format === 'png') {
    // PNG IHDR chunk starts at byte 16: width (4 bytes BE), height (4 bytes BE)
    if (buffer.length < 24) {
      throw new Error('Truncated PNG buffer: insufficient bytes for IHDR header');
    }
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
  } else if (format === 'jpeg') {
    // JPEG marker scan for SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
    let offset = 2; // Skip FF D8
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      // SOF markers: 0xC0..0xC3, 0xC5..0xC7, 0xC9..0xCB, 0xCD..0xCF (excluding 0xC4 DHT, 0xC8 JPG)
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        height = buffer.readUInt16BE(offset + 5);
        width = buffer.readUInt16BE(offset + 7);
        break;
      }
      // Skip marker payload
      const markerLength = buffer.readUInt16BE(offset + 2);
      offset += 2 + markerLength;
    }
  } else if (format === 'webp') {
    // WebP has 3 variants: VP8 (lossy), VP8L (lossless), VP8X (extended)
    if (buffer.length >= 30) {
      const chunkType = buffer.toString('ascii', 12, 16);
      if (chunkType === 'VP8 ') {
        // Lossy VP8: frame header at byte 26
        // Keyframe signature: 9d 01 2a
        if (buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
          width = buffer.readUInt16LE(26) & 0x3fff;
          height = buffer.readUInt16LE(28) & 0x3fff;
        }
      } else if (chunkType === 'VP8L') {
        // Lossless VP8L: 1-byte signature 0x2f, then 14 bits width-1, 14 bits height-1
        if (buffer[20] === 0x2f) {
          const b1 = buffer[21];
          const b2 = buffer[22];
          const b3 = buffer[23];
          const b4 = buffer[24];
          width = 1 + (((b2 & 0x3f) << 8) | b1);
          height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
        }
      } else if (chunkType === 'VP8X') {
        // Extended VP8X: canvas width at 24 (24 bits LE), height at 27 (24 bits LE)
        width = 1 + buffer.readUIntLE(24, 3);
        height = 1 + buffer.readUIntLE(27, 3);
      }
    }
  } else if (format === 'gif') {
    // GIF screen descriptor: width at 6 (2 bytes LE), height at 8 (2 bytes LE)
    if (buffer.length >= 10) {
      width = buffer.readUInt16LE(6);
      height = buffer.readUInt16LE(8);
    }
  }

  if (width <= 0 || height <= 0) {
    throw new Error(`Failed to decode valid dimensions for ${format} image (got ${width}x${height})`);
  }

  return {
    format: format as SupportedImageFormat,
    extension: extension as any,
    mimeType,
    width,
    height,
    sizeBytes: buffer.length,
  };
}

/**
 * Validates a video file using ffprobe.
 * Confirms existence of a video stream, width/height > 0, duration > 0, and non-corrupt structure.
 */
export function validateVideoWithFfprobe(filePath: string): Promise<VideoValidationResult> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`Video file does not exist: ${filePath}`));
    }
    const stat = fs.statSync(filePath);
    if (stat.size < 512) {
      return reject(new Error(`Video file is too small or truncated (${stat.size} bytes): ${filePath}`));
    }

    const header = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);

    const { format, extension, mimeType } = detectFormatFromBuffer(header);
    if (format !== 'mp4' && format !== 'webm') {
      return reject(
        new Error(`Unsupported video format header: expected MP4 (ftyp) or WebM, got ${format} for ${filePath}`)
      );
    }

    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        return reject(new Error(`FFprobe failed to inspect video file ${filePath}: ${err.message}`));
      }

      if (!data || !data.streams || data.streams.length === 0) {
        return reject(new Error(`No media streams found in video file: ${filePath}`));
      }

      const videoStream = data.streams.find((s) => s.codec_type === 'video');
      if (!videoStream) {
        return reject(new Error(`No valid video stream found in file: ${filePath}`));
      }

      const width = videoStream.width || 0;
      const height = videoStream.height || 0;
      const codec = videoStream.codec_name || 'unknown';

      // Duration from stream or format container
      let duration = parseFloat(String(videoStream.duration || data.format?.duration || 0));
      if (!Number.isFinite(duration) || duration <= 0) {
        // Fallback: duration in container format
        duration = parseFloat(String(data.format?.duration || 0));
      }

      if (width <= 0 || height <= 0) {
        return reject(new Error(`Invalid video dimensions: ${width}x${height} in ${filePath}`));
      }

      if (duration <= 0) {
        return reject(new Error(`Invalid video duration: ${duration}s (expected > 0) in ${filePath}`));
      }

      const hasAudio = data.streams.some((s) => s.codec_type === 'audio');

      resolve({
        format: format as SupportedVideoFormat,
        extension: extension as any,
        mimeType,
        codec,
        width,
        height,
        duration,
        sizeBytes: stat.size,
        hasAudio,
        isValid: true,
      });
    });
  });
}

export interface FullDecodeOptions {
  timeoutMs?: number;
  ffmpegPathOverride?: string;
}

/**
 * Fully decodes all video frames or image data using ffmpeg to guarantee
 * that the media file is non-truncated, complete, and free of corruption.
 *
 * Strict error handling:
 * - Rejects if media file does not exist or size < 64 bytes.
 * - Rejects if FFmpeg fails to spawn (e.g. invalid binary, ENOENT).
 * - Rejects if FFmpeg exits non-zero (decoding error, broken stream, truncated file).
 * - Rejects on timeout and terminates hanging processes.
 * - Guarantees Promise settles only once.
 * - NEVER resolves with fullyDecoded: true on error.
 */
export function fullDecodeMediaWithFfmpeg(
  filePath: string,
  options?: FullDecodeOptions
): Promise<{
  fullyDecoded: boolean;
  error?: string;
}> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`Media file does not exist: ${filePath}`));
    }
    const stat = fs.statSync(filePath);
    if (stat.size < 64) {
      return reject(new Error(`Media file is too small (${stat.size} bytes): ${filePath}`));
    }

    let isSettled = false;
    let timer: NodeJS.Timeout | null = null;
    let proc: ChildProcess | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (proc && !proc.killed) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore error if process already exited
        }
      }
    };

    const settleReject = (err: Error) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      reject(err);
    };

    const settleResolve = (result: { fullyDecoded: boolean; error?: string }) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      resolve(result);
    };

    const timeoutMs = options?.timeoutMs ?? 30000;
    timer = setTimeout(() => {
      settleReject(new Error(`Full frame media decoding timed out after ${timeoutMs}ms: ${filePath}`));
    }, timeoutMs);

    const execPath =
      options?.ffmpegPathOverride ||
      (rawFfmpegPath ? rawFfmpegPath.replace('app.asar', 'app.asar.unpacked') : 'ffmpeg');

    try {
      proc = spawn(execPath, ['-v', 'error', '-xerror', '-i', filePath, '-f', 'null', '-'], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (spawnErr: any) {
      settleReject(new Error(`FFmpeg spawn exception (${spawnErr?.message || spawnErr}): ${filePath}`));
      return;
    }

    let stderr = '';
    proc.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('error', (err: any) => {
      settleReject(new Error(`FFmpeg process failed to spawn (${err?.message || err}): ${filePath}`));
    });

    proc.on('close', (code, signal) => {
      if (code === 0) {
        settleResolve({ fullyDecoded: true });
      } else {
        const cleanErr = stderr.trim().slice(0, 300) || `Exit code ${code}${signal ? `, signal ${signal}` : ''}`;
        settleReject(new Error(`Full frame media decoding failed: ${cleanErr} (${filePath})`));
      }
    });
  });
}

export interface NormalizeMediaOptions {
  fullDecode?: boolean;
  decodeTimeoutMs?: number;
  ffmpegPathOverride?: string;
}

/**
 * Normalizes file extension and validates the media file.
 * If a file has an incorrect extension (e.g. JPEG image saved as .png), it renames it to match
 * the true detected format (.jpg).
 */
export async function normalizeAndValidateMediaFile(
  filePath: string,
  expectedType: 'image' | 'video',
  options?: NormalizeMediaOptions
): Promise<NormalizedMediaResult> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Media file not found: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  if (stat.size < 64) {
    throw new Error(`Media file too small (${stat.size} bytes): ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  const detected = detectFormatFromBuffer(buffer);

  if (expectedType === 'image') {
    if (detected.format !== 'jpeg' && detected.format !== 'png' && detected.format !== 'webp' && detected.format !== 'gif') {
      throw new Error(`File is not a valid image format (detected: ${detected.format}): ${filePath}`);
    }

    const decoded = decodeImageDimensions(buffer);
    const currentExt = path.extname(filePath).toLowerCase();
    const correctExt = decoded.extension;

    let finalPath = filePath;
    let wasRenamed = false;

    // Normalize extension if mismatched (e.g. .png but actually .jpg)
    if (currentExt !== correctExt && (currentExt === '.png' || currentExt === '.jpg' || currentExt === '.jpeg' || currentExt === '.webp')) {
      finalPath = filePath.slice(0, -currentExt.length) + correctExt;
      fs.renameSync(filePath, finalPath);
      wasRenamed = true;
    }

    if (options?.fullDecode && stat.size >= 512) {
      await fullDecodeMediaWithFfmpeg(finalPath, {
        timeoutMs: options.decodeTimeoutMs,
        ffmpegPathOverride: options.ffmpegPathOverride,
      });
    }

    return {
      originalPath: filePath,
      finalPath,
      wasRenamed,
      type: 'image',
      format: decoded.format,
      extension: decoded.extension,
      width: decoded.width,
      height: decoded.height,
      sizeBytes: decoded.sizeBytes,
    };
  } else {
    // Video
    if (detected.format !== 'mp4' && detected.format !== 'webm') {
      throw new Error(`File is not a valid video format (detected: ${detected.format}): ${filePath}`);
    }

    const videoValidation = await validateVideoWithFfprobe(filePath);
    const currentExt = path.extname(filePath).toLowerCase();
    const correctExt = videoValidation.extension;

    let finalPath = filePath;
    let wasRenamed = false;

    if (currentExt !== correctExt && (currentExt === '.mp4' || currentExt === '.webm')) {
      finalPath = filePath.slice(0, -currentExt.length) + correctExt;
      fs.renameSync(filePath, finalPath);
      wasRenamed = true;
    }

    if (options?.fullDecode && stat.size >= 512) {
      await fullDecodeMediaWithFfmpeg(finalPath, {
        timeoutMs: options.decodeTimeoutMs,
        ffmpegPathOverride: options.ffmpegPathOverride,
      });
    }

    return {
      originalPath: filePath,
      finalPath,
      wasRenamed,
      type: 'video',
      format: videoValidation.format,
      extension: videoValidation.extension,
      width: videoValidation.width,
      height: videoValidation.height,
      duration: videoValidation.duration,
      codec: videoValidation.codec,
      sizeBytes: videoValidation.sizeBytes,
    };
  }
}
