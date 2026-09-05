import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const execFileAsync = promisify(execFile);

interface SubtitleLine {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

// Dùng ffmpeg binary đi kèm app (@ffmpeg-installer) thay vì gọi lệnh `ffmpeg`
// trần từ PATH — máy user và bản packaged không có ffmpeg trong PATH.
let _ffmpegBin: string | null = null;

function getFfmpegPath(): string {
  if (_ffmpegBin) return _ffmpegBin;
  const raw =
    (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || 'ffmpeg';
  _ffmpegBin = String(raw).replace('app.asar', 'app.asar.unpacked');
  return _ffmpegBin;
}

/**
 * Chuyển đổi định dạng timecode SRT (HH:MM:SS,mmm) sang milliseconds
 */
function timeToMs(timeStr: string): number {
  const [time, ms] = timeStr.split(',');
  const [h, m, s] = time.split(':').map(Number);
  return h * 3600000 + m * 60000 + s * 1000 + (ms ? Number(ms) : 0);
}

/**
 * Parse file SRT thành mảng subtitle lines
 */
function parseSrtFile(srtPath: string): SubtitleLine[] {
  const content = fs.readFileSync(srtPath, 'utf-8');
  const blocks = content.split(/\n\s*\n/);
  const lines: SubtitleLine[] = [];

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
 * Escape đường dẫn cho file list của ffmpeg concat demuxer (quoting kiểu shell)
 */
function escapeConcatPath(p: string): string {
  return `file '${p.replace(/'/g, "'\\''")}'`;
}

/**
 * Chạy ffmpeg với danh sách tham số (không qua shell nên không lo escape space/unicode)
 */
async function runFfmpeg(args: string[]): Promise<void> {
  await execFileAsync(getFfmpegPath(), args);
}

/**
 * Đọc duration của file audio bằng ffmpeg (không cần ffprobe riêng):
 * ffmpeg in "Duration: HH:MM:SS.ms" vào stderr rồi thoát lỗi vì không có output —
 * ta chỉ quan tâm stderr. Lỗi → trả 0 (caller coi như không biết duration).
 */
function getAudioDurationSec(audioFile: string): Promise<number> {
  return new Promise((resolve) => {
    execFile(getFfmpegPath(), ['-i', audioFile], (_err, _stdout, stderr) => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr || '');
      if (m) {
        resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
      } else {
        resolve(0);
      }
    });
  });
}

/**
 * Tạo 1 segment WAV có độ dài CHÍNH XÁC bằng khoảng từ startMs của dòng hiện tại
 * đến startMs của dòng kế tiếp:
 * - Audio ngắn hơn → apad lấp đầy bằng im lặng (giữ đúng timing SRT)
 * - Audio dài hơn (câu TTS tràn thời lượng) → tự tăng tốc atempo để vừa khung
 *   (tối đa MAX_TEMPO), phần vượt quá giới hạn mới cắt bớt — tránh mất chữ.
 * - Thiếu file audio → tạo segment im lặng toàn phần (timeline không bị trôi)
 */
const MAX_TEMPO = 1.5;
/** Chỉ tăng tốc khi tràn quá 5% — sai số vài chục ms không đáng đổi tốc độ đọc */
const TEMPO_THRESHOLD = 1.05;

async function buildSegment(
  audioFile: string | null,
  segDurationSec: number,
  segPath: string
): Promise<{ tempo: number; truncated: boolean }> {
  const t = segDurationSec.toFixed(3);
  if (audioFile && fs.existsSync(audioFile)) {
    const audioDur = await getAudioDurationSec(audioFile);
    const filters: string[] = [];
    let tempo = 1;
    let truncated = false;

    if (audioDur > segDurationSec * TEMPO_THRESHOLD) {
      const rawTempo = audioDur / segDurationSec;
      tempo = Math.min(rawTempo, MAX_TEMPO);
      filters.push(`atempo=${tempo.toFixed(4)}`);
      truncated = rawTempo > MAX_TEMPO;
    }
    filters.push('apad');

    await runFfmpeg([
      '-i', audioFile,
      '-af', filters.join(','),
      '-t', t,
      '-ar', '44100',
      '-ac', '2',
      '-c:a', 'pcm_s16le',
      '-y', segPath,
    ]);
    return { tempo, truncated };
  }

  await runFfmpeg([
    '-f', 'lavfi',
    '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', t,
    '-c:a', 'pcm_s16le',
    '-y', segPath,
  ]);
  return { tempo: 1, truncated: false };
}

/**
 * Ghép các audio files thành 1 file audio duy nhất đúng timeline SRT:
 * mỗi dòng được pad/cắt về đúng độ dài đoạn của nó rồi nối lại (concat),
 * nhờ đó audio đầu ra khớp tuyệt đối với phụ đề kể cả khi có khoảng lặng dài.
 */
export async function mergeAudioFiles(
  srtPath: string,
  ttsAudioDir: string,
  outputAudioPath: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  const subtitles = parseSrtFile(srtPath);
  if (subtitles.length === 0) {
    throw new Error('File SRT không có dòng phụ đề hợp lệ để ghép audio.');
  }

  const workDir = path.join(
    path.dirname(outputAudioPath),
    `.vanhsub_dub_${Date.now()}`
  );
  const tempListFile = path.join(workDir, 'concat.txt');

  try {
    fs.mkdirSync(workDir, { recursive: true });
    console.log(`[Dubbing] Ghép audio ${subtitles.length} dòng theo timeline SRT...`);

    const segPaths: string[] = [];
    let speedUpCount = 0;
    let truncatedLines: number[] = [];
    for (let i = 0; i < subtitles.length; i++) {
      const sub = subtitles[i];
      const next = subtitles[i + 1];

      // Độ dài segment = khoảng cách tới start của dòng kế (dòng cuối +0.5s đuôi).
      // Chặn tối thiểu 200ms để câu không bị cắt mất hoàn toàn khi SRT bị overlap.
      const segEndMs = next ? Math.max(next.startMs, sub.startMs + 200) : sub.endMs + 500;
      const segDurationSec = Math.max((segEndMs - sub.startMs) / 1000, 0.05);

      const audioFile = path.join(ttsAudioDir, `subtitle_${String(sub.index).padStart(4, '0')}.mp3`);
      const segPath = path.join(workDir, `seg_${String(i).padStart(5, '0')}.wav`);

      const { tempo, truncated } = await buildSegment(
        fs.existsSync(audioFile) ? audioFile : null,
        segDurationSec,
        segPath
      );
      if (tempo > TEMPO_THRESHOLD) {
        speedUpCount++;
        console.log(
          `[Dubbing] Dòng ${sub.index} tràn thời lượng → tăng tốc ${tempo.toFixed(2)}x` +
            (truncated ? ' (vượt 1.5x, phần cuối bị cắt)' : '')
        );
      }
      if (truncated) truncatedLines.push(sub.index);
      segPaths.push(segPath);

      if (i % 10 === 0 || i === subtitles.length - 1) {
        onProgress?.(Math.round(((i + 1) / subtitles.length) * 95));
      }
    }

    fs.writeFileSync(tempListFile, segPaths.map(escapeConcatPath).join('\n'));

    await runFfmpeg([
      '-f', 'concat',
      '-safe', '0',
      '-i', tempListFile,
      '-c:a', 'aac',
      '-b:a', '192k',
      '-y', outputAudioPath,
    ]);
    onProgress?.(100);

    if (speedUpCount > 0) {
      console.log(
        `[Dubbing] Đã tăng tốc ${speedUpCount}/${subtitles.length} câu để vừa timeline` +
          (truncatedLines.length > 0
            ? ` — ${truncatedLines.length} câu tràn quá 1.5x còn bị cắt phần cuối: dòng ${truncatedLines.join(', ')}. Nên rút gọn text những dòng này rồi tạo lại audio.`
            : '')
      );
    }
    console.log(`[Dubbing] ✓ Audio merge successful: ${outputAudioPath}`);
    return outputAudioPath;
  } catch (err) {
    console.error(`[Dubbing] ✗ Audio merge failed:`, err);
    throw new Error(`Không thể ghép audio: ${err}`);
  } finally {
    try {
      if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn('[Dubbing] Không xoá được thư mục tạm:', cleanupErr);
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

    let args: string[];
    if (replace) {
      // Thay thế audio track gốc
      args = [
        '-i', videoPath,
        '-i', audioPath,
        '-c:v', 'copy', // Copy video codec (không re-encode)
        '-c:a', 'aac', // Audio codec
        '-map', '0:v:0', // Lấy video stream từ file gốc
        '-map', '1:a:0', // Lấy audio stream từ audio dubbed
        '-shortest', // Dùng độ dài file ngắn nhất
        '-y', // Overwrite
        outputVideoPath,
      ];
    } else {
      // Thêm audio track mới (bilingual)
      args = [
        '-i', videoPath,
        '-i', audioPath,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-map', '0:v:0', // Video từ file gốc
        '-map', '0:a:0', // Audio gốc
        '-map', '1:a:0', // Audio dubbed
        '-disposition:a:0', 'default', // Audio gốc là default
        '-disposition:a:1', 'alternate', // Audio dubbed là alternate
        '-shortest',
        '-y',
        outputVideoPath,
      ];
    }

    await runFfmpeg(args);
    onProgress?.(95);

    console.log(`[Dubbing] ✓ Video mux successful: ${outputVideoPath}`);
    return outputVideoPath;
  } catch (err) {
    console.error(`[Dubbing] ✗ Video mux failed:`, err);
    throw new Error(`Không thể kết hợp audio vào video: ${err}`);
  }
}

/**
 * Full dubbing pipeline: TTS audio → merge (đúng timeline) → mux video
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
