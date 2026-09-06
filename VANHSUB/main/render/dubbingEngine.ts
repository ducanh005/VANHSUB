import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpeg from 'fluent-ffmpeg';
import { parseSrt, serializeSrt, type SrtLine } from '../lib/srt';
import { getFfmpegBinPath, getMediaDurationSec } from '../asr/audioExtractor';

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
  await execFileAsync(getFfmpegBinPath(), args);
}

/** Cache duration audio theo đường dẫn — 1 file chỉ probe 1 lần mỗi lần dub */
type DurationCache = Map<string, number>;

async function probeAudioDurationSec(audioFile: string, cache: DurationCache): Promise<number> {
  const cached = cache.get(audioFile);
  if (cached !== undefined) return cached;
  const dur = await getMediaDurationSec(audioFile);
  cache.set(audioFile, dur);
  return dur;
}

// =========================================================================
// CHẾ ĐỘ ĐỒNG BỘ AUDIO-VIDEO
// - 'strict'        : audio nén/pad theo đúng timeline SRT (như trước đây)
// - 'flexible'      : câu dài được tràn vào khoảng lặng phía sau, các câu sau
//                     tự động dịch lùi — tổng trượt tối đa MAX_DRIFT_MS,
//                     vượt ngưỡng mới nén atempo (giảm cảm giác đọc gấp)
// - 'video-stretch' : kéo giãn toàn bộ video (setpts) để mỗi khung phụ đề
//                     đủ chỗ cho audio ở tốc độ đọc tự nhiên, hệ số ≤ 1.25
// =========================================================================

export type SyncMode = 'strict' | 'flexible' | 'video-stretch';

const MAX_DRIFT_MS = 3000;
/** Chỉ tăng tốc khi tràn quá 5% — sai số vài chục ms không đáng đổi tốc độ đọc */
const TEMPO_THRESHOLD = 1.05;
/** Tăng tốc tối đa trước khi cắt bớt audio */
const MAX_TEMPO = 1.5;
/** Hệ số kéo giãn video tối đa (quá làm video chậm khó chịu) */
const MAX_STRETCH_FACTOR = 1.25;
/** Đuôi thêm sau mỗi câu trước khi sang câu kế */
const TAIL_MS = 120;

/**
 * Kéo giãn toàn bộ timestamp SRT theo hệ số (hàm thuần — dùng cho video-stretch)
 */
export function scaleSrtLines(lines: SrtLine[], factor: number): SrtLine[] {
  return lines.map((l) => ({
    ...l,
    startMs: Math.round(l.startMs * factor),
    endMs: Math.round(l.endMs * factor),
  }));
}

/**
 * Tính hệ số kéo giãn video tối thiểu để câu nào cũng đủ chỗ chứa audio
 * (ở tốc độ đọc tự nhiên). Xét từng câu: slot = từ start câu này tới start câu kế.
 * Trả về 1 nếu audio đã vừa (không cần giãn).
 */
export async function computeVideoStretchFactor(
  srtPath: string,
  ttsAudioDir: string,
  cache?: DurationCache,
): Promise<number> {
  const subtitles = parseSrtFile(srtPath);
  const durations = new Map<number, number>();
  const durationCache = cache ?? new Map<string, number>();

  // Probe duration các file audio song song theo lô 8 để không nghẽn đĩa/CPU
  for (let base = 0; base < subtitles.length; base += 8) {
    const batch = subtitles.slice(base, base + 8);
    await Promise.all(
      batch.map(async (sub) => {
        const audioFile = path.join(ttsAudioDir, `subtitle_${String(sub.index).padStart(4, '0')}.mp3`);
        if (!fs.existsSync(audioFile)) return;
        durations.set(sub.index, await probeAudioDurationSec(audioFile, durationCache));
      })
    );
  }

  let maxFactor = 1;
  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    const next = subtitles[i + 1];
    const slotSec = Math.max(((next ? next.startMs : sub.endMs) - sub.startMs) / 1000, 0.2);
    const audioDur = durations.get(sub.index);
    if (!audioDur) continue;
    // Cho phép tràn nhẹ 5% như ngưỡng atempo hiện hành, tránh giãn oan
    const factor = audioDur / slotSec / TEMPO_THRESHOLD;
    if (factor > maxFactor) maxFactor = factor;
  }

  if (maxFactor <= 1) return 1;
  return Math.min(MAX_STRETCH_FACTOR, Math.round(maxFactor * 100) / 100);
}

/**
 * Tạo 1 segment WAV cho 1 dòng phụ đề:
 * - audio nén atempo (nếu tempo > 1) rồi ĐẶT VÀO VỊ TRÍ adelay trong segment
 *   (giữ đúng timeline kể cả khi câu trước tràn sang — mode flexible)
 * - apad lấp đầy bằng im lặng, thiếu file → segment im lặng toàn phần
 * - cắt đúng -t để tổng timeline không trôi
 */
async function buildSegment(
  audioFile: string | null,
  segDurationSec: number,
  segPath: string,
  opts?: { tempo?: number; delayMs?: number }
): Promise<{ tempo: number; truncated: boolean }> {
  const t = segDurationSec.toFixed(3);
  const tempo = opts?.tempo ?? 1;
  const delayMs = Math.max(0, Math.round(opts?.delayMs ?? 0));

  if (audioFile && fs.existsSync(audioFile)) {
    const filters: string[] = [];
    let truncated = false;

    if (tempo > 1.0001) filters.push(`atempo=${tempo.toFixed(4)}`);
    if (delayMs > 0) filters.push(`adelay=${delayMs}|${delayMs}`);
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

/** Thông tin 1 câu TTS tràn thời lượng khung của nó */
export interface TtsOverrun {
  /** Số dòng phụ đề */
  index: number;
  /** Hệ số tăng tốc đã áp dụng (1.0 = không tăng tốc) */
  tempo: number;
  /** true nếu tràn quá 1.5x và vẫn bị cắt phần cuối */
  truncated: boolean;
}

/**
 * Ghép các audio files thành 1 file audio duy nhất đúng timeline SRT.
 *
 * mode 'strict': mỗi dòng chiếm đúng [start, start dòng kế) — audio dài hơn
 * bị nén atempo (≤1.5x) rồi cắt, ngắn hơn được lấp im lặng.
 *
 * mode 'flexible': câu dài được tràn qua khoảng lặng phía sau (các câu sau
 * tự động dịch lùi theo cursor), tổng trượt tối đa MAX_DRIFT_MS; vượt ngưỡng
 * mới nén atempo. Audio đầu ra có thể dài hơn video tối đa ~3s.
 */
export async function mergeAudioFiles(
  srtPath: string,
  ttsAudioDir: string,
  outputAudioPath: string,
  onProgress?: (percent: number) => void,
  opts?: { mode?: SyncMode }
): Promise<{ audioPath: string; overruns: TtsOverrun[] }> {
  const mode = opts?.mode ?? 'strict';
  const subtitles = parseSrtFile(srtPath);
  if (subtitles.length === 0) {
    throw new Error('File SRT không có dòng phụ đề hợp lệ để ghép audio.');
  }

  const workDir = path.join(
    path.dirname(outputAudioPath),
    `.vanhsub_dub_${Date.now()}`
  );
  const tempListFile = path.join(workDir, 'concat.txt');
  const durationCache: DurationCache = new Map();

  try {
    fs.mkdirSync(workDir, { recursive: true });
    console.log(`[Dubbing] Ghép audio ${subtitles.length} dòng (mode ${mode})...`);

    const segPaths: string[] = [];
    const overruns: TtsOverrun[] = [];
    let cursorMs = 0; // thời điểm kết thúc segment trước (mode flexible)
    let driftMs = 0; // tổng độ trượt đã dùng

    for (let i = 0; i < subtitles.length; i++) {
      const sub = subtitles[i];
      const next = subtitles[i + 1];
      const slotEndMs = next ? Math.max(next.startMs, sub.startMs + 200) : sub.endMs + 500;

      const audioFile = path.join(ttsAudioDir, `subtitle_${String(sub.index).padStart(4, '0')}.mp3`);
      const hasAudio = fs.existsSync(audioFile);
      const audioDurMs = hasAudio
        ? (await probeAudioDurationSec(audioFile, durationCache)) * 1000
        : 0;

      const segPath = path.join(workDir, `seg_${String(i).padStart(5, '0')}.wav`);
      let tempo = 1;
      let truncated = false;

      if (mode === 'flexible') {
        // Audio bắt đầu tại max(start SRT, điểm trượt tới) — câu trước tràn
        // sang thì câu này bắt đầu ngay sau đó (dịch lùi tự nhiên)
        const audioStartMs = Math.max(sub.startMs, cursorMs);
        const naturalEndMs = audioStartMs + audioDurMs + TAIL_MS;

        if (naturalEndMs <= slotEndMs) {
          // Vừa slot → pad im lặng tới slotEnd (không đổi rhythm)
          const segDurationSec = Math.max((slotEndMs - cursorMs) / 1000, 0.05);
          await buildSegment(hasAudio ? audioFile : null, segDurationSec, segPath, {
            delayMs: audioStartMs - cursorMs,
          });
          cursorMs = slotEndMs;
        } else {
          const budgetMs = Math.max(0, MAX_DRIFT_MS - driftMs);
          const allowedEndMs = slotEndMs + budgetMs;
          if (naturalEndMs <= allowedEndMs) {
            // Tràn vào khoảng lặng phía sau (drift)
            const segDurationSec = Math.max((naturalEndMs - cursorMs) / 1000, 0.05);
            await buildSegment(audioFile, segDurationSec, segPath, {
              delayMs: audioStartMs - cursorMs,
            });
            driftMs += naturalEndMs - slotEndMs;
            cursorMs = naturalEndMs;
          } else {
            // Vượt ngưỡng trượt → nén audio để vừa vùng cho phép
            const targetAudioDurSec = Math.max(
              (allowedEndMs - audioStartMs - TAIL_MS) / 1000,
              0.05
            );
            const rawTempo = audioDurMs / 1000 / targetAudioDurSec;
            tempo = Math.min(Math.max(rawTempo, 1), MAX_TEMPO);
            truncated = rawTempo > MAX_TEMPO;
            const segDurationSec = Math.max((allowedEndMs - cursorMs) / 1000, 0.05);
            await buildSegment(audioFile, segDurationSec, segPath, {
              tempo,
              delayMs: audioStartMs - cursorMs,
            });
            driftMs = MAX_DRIFT_MS;
            cursorMs = allowedEndMs;
          }
          if (tempo > TEMPO_THRESHOLD) {
            overruns.push({ index: sub.index, tempo, truncated });
          }
        }
      } else {
        // strict: segment = [start, slotEnd) cố định, audio nén nếu tràn
        const segDurationSec = Math.max((slotEndMs - sub.startMs) / 1000, 0.05);
        if (hasAudio && audioDurMs > segDurationSec * TEMPO_THRESHOLD) {
          const rawTempo = audioDurMs / 1000 / segDurationSec;
          tempo = Math.min(rawTempo, MAX_TEMPO);
          truncated = rawTempo > MAX_TEMPO;
          overruns.push({ index: sub.index, tempo, truncated });
        }
        await buildSegment(hasAudio ? audioFile : null, segDurationSec, segPath, { tempo });
        cursorMs = sub.startMs + segDurationSec * 1000;
      }

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

    if (overruns.length > 0) {
      const truncatedList = overruns.filter((o) => o.truncated);
      console.log(
        `[Dubbing] Đã tăng tốc ${overruns.length}/${subtitles.length} câu để vừa timeline` +
          (truncatedList.length > 0
            ? ` — ${truncatedList.length} câu tràn quá 1.5x còn bị cắt phần cuối: dòng ${truncatedList.map((o) => o.index).join(', ')}. Nên rút gọn text những dòng này rồi tạo lại audio.`
            : '')
      );
    }
    console.log(`[Dubbing] ✓ Audio merge successful: ${outputAudioPath}`);
    return { audioPath: outputAudioPath, overruns };
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
 * Mux (kết hợp) audio dubbed vào video file.
 *
 * - replaceAudio = true : thay audio gốc (hoặc mix nhỏ nhạc nền nếu bật mixOriginalAudio)
 * - replaceAudio = false: giữ cả 2 track (song ngữ)
 * - stretchFactor > 1   : video bị kéo giãn (setpts) → phải re-encode libx264
 * - mode 'flexible'     : bỏ -shortest để không cắt mất đuôi câu cuối (video
 *                         giữ khung cuối vài giây nếu audio dài hơn)
 */
export async function muxAudioToVideo(
  videoPath: string,
  audioPath: string,
  outputVideoPath: string,
  options?: {
    replaceAudio?: boolean;
    mixOriginalAudio?: boolean;
    syncMode?: SyncMode;
    stretchFactor?: number;
  },
  onProgress?: (percent: number) => void
): Promise<string> {
  const replace = options?.replaceAudio ?? true;
  const mixOriginal = Boolean(options?.mixOriginalAudio) && replace;
  const mode = options?.syncMode ?? 'strict';
  const stretchFactor = options?.stretchFactor && options.stretchFactor > 1.001 ? options.stretchFactor : 0;
  const needReencode = stretchFactor > 0;
  const flexible = mode === 'flexible';

  try {
    console.log(
      `[Dubbing] Starting video mux: ${videoPath} + ${audioPath} -> ${outputVideoPath}` +
        (stretchFactor > 0 ? ` (video giãn ${stretchFactor}x)` : '') +
        (mixOriginal ? ' (mix nhạc nền gốc)' : '')
    );
    onProgress?.(10);

    const videoDurationSec = await getMediaDurationSec(videoPath);

    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg(videoPath).input(audioPath);

      const outputOptions: string[] = ['-map', '0:v:0'];
      let videoFilters: string | null = null;

      // Video: copy (nhanh) hoặc kéo giãn setpts + re-encode (video-stretch)
      if (needReencode) {
        videoFilters = `setpts=PTS*${stretchFactor}`;
        outputOptions.push('-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p');
      } else {
        outputOptions.push('-c:v', 'copy');
      }

      if (!replace) {
        // Bilingual: giữ audio gốc + thêm track lồng tiếng
        outputOptions.push(
          '-c:a', 'aac',
          '-map', '0:a:0',
          '-map', '1:a:0',
          '-disposition:a:0', 'default',
          '-disposition:a:1', 'alternate',
        );
      } else if (mixOriginal) {
        // Mix: nhạc nền/SFX gốc nhỏ lại (0.22) dưới lời thoại lồng tiếng
        outputOptions.push(
          '-c:a', 'aac',
          '-b:a', '192k',
          '-filter_complex',
          '[0:a]volume=0.22[bg];[bg][1:a]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.97[aout]',
          '-map', '[aout]',
        );
      } else {
        // Thay thế hoàn toàn audio gốc
        outputOptions.push('-c:a', 'aac', '-b:a', '192k', '-map', '1:a:0');
      }

      // KHÔNG dùng -shortest: audio ghép kết thúc ở câu phụ đề cuối (+0.5s đệm),
      // -shortest sẽ cắt mất toàn bộ video phía sau đó (credit, outro...).
      // Giới hạn output bằng -t theo thời lượng video; nếu không đọc được
      // thời lượng thì bỏ qua — lệch tối đa 0.5s đuôi audio là vô hại.
      if (!flexible && !needReencode && videoDurationSec > 0) {
        outputOptions.push('-t', videoDurationSec.toFixed(3));
      }

      if (videoFilters) command.videoFilters(videoFilters);
      command.outputOptions(outputOptions).output(outputVideoPath);

      command
        .on('progress', (progress) => {
          if (!onProgress) return;
          let percent = progress.percent;
          if ((percent === undefined || Number.isNaN(percent)) && progress.timemark && videoDurationSec > 0) {
            const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(progress.timemark);
            if (m) {
              const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
              percent = Math.min(99, (sec / videoDurationSec) * 100);
            }
          }
          if (typeof percent === 'number' && !Number.isNaN(percent)) {
            onProgress(10 + Math.max(0, Math.min(85, percent)) * 0.85); // 10-95%
          }
        })
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`Không thể kết hợp audio vào video: ${err.message}`)))
        .run();
    });

    onProgress?.(95);
    console.log(`[Dubbing] ✓ Video mux successful: ${outputVideoPath}`);
    return outputVideoPath;
  } catch (err: any) {
    console.error(`[Dubbing] ✗ Video mux failed:`, err);
    throw new Error(err?.message || 'Không thể kết hợp audio vào video');
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
    syncMode?: SyncMode;
    mixOriginalAudio?: boolean;
  },
  onProgress?: (percent: number) => void
): Promise<{ outputPath: string; mergedAudioPath: string; overruns: TtsOverrun[]; stretchFactor: number }> {
  const tempAudioPath = path.join(
    path.dirname(outputVideoPath),
    `.dubbed_audio_${Date.now()}.m4a`
  );
  const syncMode = options?.syncMode ?? 'strict';
  let stretchFactor = 1;
  let scaledSrtPath: string | null = null;

  try {
    console.log(`[Dubbing] Starting full dubbing pipeline (mode ${syncMode})...`);

    let mergeSrtPath = srtPath;

    // video-stretch: tính hệ số giãn, ghi SRT đã scale ra tạm rồi merge theo đó
    if (syncMode === 'video-stretch') {
      onProgress?.(2);
      stretchFactor = await computeVideoStretchFactor(srtPath, ttsAudioDir);
      if (stretchFactor > 1.001) {
        console.log(`[Dubbing] Video-stretch: giãn video ${stretchFactor}x để vừa audio`);
        const scaled = scaleSrtLines(parseSrt(srtPath), stretchFactor);
        if (scaled.length > 0) {
          scaledSrtPath = path.join(os.tmpdir(), `vanhsub_scaled_${Date.now()}.srt`);
          fs.writeFileSync(scaledSrtPath, serializeSrt(scaled), 'utf-8');
          mergeSrtPath = scaledSrtPath;
        }
      } else {
        console.log('[Dubbing] Video-stretch: audio đã vừa — dùng timeline gốc');
      }
    }

    // Bước 1: Ghép audio
    onProgress?.(5);
    const { audioPath, overruns } = await mergeAudioFiles(
      mergeSrtPath,
      ttsAudioDir,
      tempAudioPath,
      (p) => {
        onProgress?.(Math.round(5 + p * 0.4)); // 5-45%
      },
      { mode: syncMode === 'flexible' ? 'flexible' : 'strict' }
    );

    // Bước 2: Mux vào video
    onProgress?.(50);
    const finalPath = await muxAudioToVideo(
      videoPath,
      tempAudioPath,
      outputVideoPath,
      {
        replaceAudio: options?.replaceAudio,
        mixOriginalAudio: options?.mixOriginalAudio,
        syncMode,
        stretchFactor,
      },
      (p) => {
        onProgress?.(50 + Math.round(p * 0.5)); // 50-100%
      }
    );

    console.log(`[Dubbing] ✓ Full dubbing complete: ${finalPath}`);
    return { outputPath: finalPath, mergedAudioPath: tempAudioPath, overruns, stretchFactor };
  } catch (err) {
    console.error(`[Dubbing] ✗ Dubbing pipeline failed:`, err);
    throw err;
  } finally {
    // Dọn file audio tạm (trước đây bị leak sau mỗi lần dub)
    try {
      if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
    } catch {
      // bỏ qua
    }
    try {
      if (scaledSrtPath && fs.existsSync(scaledSrtPath)) fs.unlinkSync(scaledSrtPath);
    } catch {
      // bỏ qua
    }
  }
}
