import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { parseSrt } from '../../renderer/lib/srt';

const execAsync = promisify(exec);

interface SubtitleLine {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

/**
 * Chuyển đổi milliseconds sang định dạng HH:MM:SS.mmm (ffmpeg format)
 */
function msToTimeString(ms: number): string {
  const totalSeconds = ms / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${seconds.toFixed(3)}`;
}

/**
 * Parse file SRT thành mảng subtitle lines
 */
function parseSrtFile(srtPath: string): SubtitleLine[] {
  const content = fs.readFileSync(srtPath, 'utf-8');
  const blocks = content.split(/\n\s*\n/);
  const lines: SubtitleLine[] = [];

  function timeToMs(timeStr: string): number {
    const [time, ms] = timeStr.split(',');
    const [h, m, s] = time.split(':').map(Number);
    return h * 3600000 + m * 60000 + s * 1000 + (ms ? Number(ms) : 0);
  }

  for (const block of blocks) {
    const lines_in_block = block.trim().split('\n');
    if (lines_in_block.length < 3) continue;

    const index = Number(lines_in_block[0]);
    const timeLine = lines_in_block[1];
    const [startTime, endTime] = timeLine.split(' --> ');
    const text = lines_in_block.slice(2).join('\n').trim();

    if (!startTime || !endTime || !text) continue;

    const startMs = timeToMs(startTime);
    const endMs = timeToMs(endTime);

    lines.push({
      index,
      startTime,
      endTime,
      text,
      startMs,
      endMs,
      durationMs: endMs - startMs,
    });
  }

  return lines;
}

/**
 * Tạo file danh sách audio (ffmpeg concat demuxer format)
 * Dùng để ghép các audio files theo thứ tự với timing đúng
 */
async function createAudioConcatList(
  srtPath: string,
  ttsAudioDir: string,
  outputListFile: string
): Promise<void> {
  const subtitles = parseSrtFile(srtPath);
  let lines: string[] = [];
  let currentTime = 0; // in milliseconds

  for (const sub of subtitles) {
    // Audio file name theo pattern của ttsEngine: subtitle_XXXX.mp3
    const audioFile = path.join(ttsAudioDir, `subtitle_${String(sub.index).padStart(4, '0')}.mp3`);

    if (!fs.existsSync(audioFile)) {
      console.warn(`[Dubbing] Missing audio file: ${audioFile}`);
      continue;
    }

    // Nếu có khoảng cách giữa subtitle hiện tại và cái trước, thêm silence
    if (currentTime < sub.startMs) {
      const gapMs = sub.startMs - currentTime;
      console.log(`[Dubbing] Gap detected: ${gapMs}ms, adding silence`);
      // TODO: Có thể thêm silence file nếu cần
    }

    // Thêm audio file vào danh sách
    lines.push(`file '${audioFile}'`);
    currentTime = sub.endMs;
  }

  fs.writeFileSync(outputListFile, lines.join('\n'));
  console.log(`[Dubbing] Created concat list: ${outputListFile}`);
}

/**
 * Ghép các audio files thành 1 file audio duy nhất
 * Sử dụng ffmpeg concat demuxer
 */
export async function mergeAudioFiles(
  srtPath: string,
  ttsAudioDir: string,
  outputAudioPath: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  const tempListFile = path.join(path.dirname(outputAudioPath), `.concat_${Date.now()}.txt`);

  try {
    console.log(`[Dubbing] Starting audio merge: ${srtPath} -> ${outputAudioPath}`);
    onProgress?.(10);

    // Tạo danh sách audio files
    await createAudioConcatList(srtPath, ttsAudioDir, tempListFile);
    onProgress?.(30);

    // Ghép audio bằng ffmpeg concat demuxer
    const command = [
      'ffmpeg',
      '-f', 'concat',
      '-safe', '0',
      '-i', tempListFile,
      '-c:a', 'aac', // Output codec
      '-b:a', '192k', // Bitrate
      '-q:a', '4',
      '-y', // Overwrite output file
      `"${outputAudioPath}"`,
    ].join(' ');

    console.log(`[Dubbing] Running ffmpeg merge: ${command}`);
    await execAsync(command);
    onProgress?.(90);

    console.log(`[Dubbing] ✓ Audio merge successful: ${outputAudioPath}`);
    return outputAudioPath;
  } catch (err) {
    console.error(`[Dubbing] ✗ Audio merge failed:`, err);
    throw new Error(`Không thể ghép audio: ${err}`);
  } finally {
    // Xoá temp file
    if (fs.existsSync(tempListFile)) {
      fs.unlinkSync(tempListFile);
    }
  }
}

/**
 * Mux (kết hợp) audio dubbed vào video file
 * Có thể thay thế audio track gốc hoặc thêm track mới
 */
export async function muxAudioToVideo(
  videoPath: string,
  audioPath: string,
  outputVideoPath: string,
  options?: {
    replaceAudio?: boolean; // true = thay thế audio gốc, false = thêm track mới
  },
  onProgress?: (percent: number) => void
): Promise<string> {
  const replace = options?.replaceAudio ?? true;

  try {
    console.log(`[Dubbing] Starting video mux: ${videoPath} + ${audioPath} -> ${outputVideoPath}`);
    onProgress?.(10);

    let command: string;
    if (replace) {
      // Thay thế audio track gốc
      command = [
        'ffmpeg',
        '-i', `"${videoPath}"`,
        '-i', `"${audioPath}"`,
        '-c:v', 'copy', // Copy video codec (không re-encode)
        '-c:a', 'aac', // Audio codec
        '-map', '0:v:0', // Lấy video stream từ file gốc
        '-map', '1:a:0', // Lấy audio stream từ audio dubbed
        '-shortest', // Dùng độ dài file ngắn nhất
        '-y', // Overwrite
        `"${outputVideoPath}"`,
      ].join(' ');
    } else {
      // Thêm audio track mới (bilingual)
      command = [
        'ffmpeg',
        '-i', `"${videoPath}"`,
        '-i', `"${audioPath}"`,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-map', '0:v:0', // Video từ file gốc
        '-map', '0:a:0', // Audio gốc
        '-map', '1:a:0', // Audio dubbed
        '-disposition:a:0', 'default', // Audio gốc là default
        '-disposition:a:1', 'alternate', // Audio dubbed là alternate
        '-shortest',
        '-y',
        `"${outputVideoPath}"`,
      ].join(' ');
    }

    console.log(`[Dubbing] Running ffmpeg mux: ${command}`);
    await execAsync(command);
    onProgress?.(95);

    console.log(`[Dubbing] ✓ Video mux successful: ${outputVideoPath}`);
    return outputVideoPath;
  } catch (err) {
    console.error(`[Dubbing] ✗ Video mux failed:`, err);
    throw new Error(`Không thể kết hợp audio vào video: ${err}`);
  }
}

/**
 * Full dubbing pipeline: TTS audio → merge → mux video
 */
export async function dubVideo(
  videoPath: string,
  srtPath: string,
  ttsAudioDir: string,
  outputVideoPath: string,
  options?: {
    replaceAudio?: boolean;
  },
  onProgress?: (percent: number) => void
): Promise<{ outputPath: string; mergedAudioPath: string }> {
  const tempAudioPath = path.join(
    path.dirname(outputVideoPath),
    `.dubbed_audio_${Date.now()}.m4a`
  );

  try {
    console.log(`[Dubbing] Starting full dubbing pipeline...`);

    // Bước 1: Ghép audio
    onProgress?.(0);
    await mergeAudioFiles(srtPath, ttsAudioDir, tempAudioPath, (p) => {
      onProgress?.(Math.round(p * 0.45)); // 0-45%
    });

    // Bước 2: Mux vào video
    onProgress?.(50);
    const finalPath = await muxAudioToVideo(
      videoPath,
      tempAudioPath,
      outputVideoPath,
      options,
      (p) => {
        onProgress?.(50 + Math.round(p * 0.5)); // 50-100%
      }
    );

    console.log(`[Dubbing] ✓ Full dubbing complete: ${finalPath}`);
    return { outputPath: finalPath, mergedAudioPath: tempAudioPath };
  } catch (err) {
    console.error(`[Dubbing] ✗ Dubbing pipeline failed:`, err);
    throw err;
  }
}
