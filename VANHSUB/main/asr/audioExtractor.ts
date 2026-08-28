import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

// Thiết lập đường dẫn ffmpeg binary (hỗ trợ cả môi trường dev và packaged asar)
const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
if (rawFfmpegPath) {
  ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));
}

export interface AudioExtractResult {
  wavPath: string;
  duration?: number;
}

/**
 * Trích xuất hoặc chuyển đổi file media (video/audio) thành file WAV 16kHz 16-bit mono
 * chuẩn đầu vào của Whisper ASR.
 */
export function extract16kHzWav(
  inputPath: string,
  outputWavPath?: string,
  onProgress?: (percent: number) => void,
): Promise<AudioExtractResult> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) {
      return reject(new Error(`Không tìm thấy file đầu vào: ${inputPath}`));
    }

    const targetPath =
      outputWavPath ||
      path.join(
        path.dirname(inputPath),
        `${path.parse(inputPath).name}_temp_16k.wav`,
      );

    // Nếu file đầu vào đã là WAV 16k và cùng đường dẫn
    if (inputPath === targetPath && fs.existsSync(targetPath)) {
      return resolve({ wavPath: targetPath });
    }

    ffmpeg(inputPath)
      .noVideo()
      .audioFrequency(16000)
      .audioChannels(1)
      .audioCodec('pcm_s16le')
      .format('wav')
      .output(targetPath)
      .on('progress', (progress) => {
        if (progress && progress.percent && onProgress) {
          onProgress(Math.min(99, Math.round(progress.percent)));
        }
      })
      .on('end', () => {
        resolve({ wavPath: targetPath });
      })
      .on('error', (err) => {
        reject(new Error(`Lỗi trích xuất audio bằng ffmpeg: ${err.message}`));
      })
      .run();
  });
}
