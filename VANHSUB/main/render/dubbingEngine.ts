import { readTtsSubtitles as parseSrtFile } from '../lib/ttsSubtitles';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID, createHash } from 'node:crypto';
import { CancelledError, isCancelledError } from '../lib/cancel';
import { runFfmpeg } from '../lib/ffmpegProcess';
export { runFfmpeg } from '../lib/ffmpegProcess';
import ffmpeg from 'fluent-ffmpeg';
import { parseSrt, serializeSrt, type SrtLine } from '../lib/srt';
import { getMediaDurationSec, extractFullQualityAudio } from '../asr/audioExtractor';
import { separateVocals } from '../audio/vocalSeparation';
import { groupSubtitlesForTts, type SubtitleLine } from './ttsEngine';

/**
 * Escape đường dẫn cho file list của ffmpeg concat demuxer (quoting kiểu shell)
 */
function escapeConcatPath(p: string): string {
  return `file '${p.replace(/'/g, "'\\''")}'`;
}

type DurationCache = Map<string, number>;
const sharedDurationCache = new Map<string, { size: number; mtime: number; duration: number }>();

async function probeAudioDurationSec(file: string, cache: DurationCache): Promise<number> {
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const stat = fs.statSync(file),
    shared = sharedDurationCache.get(file);
  const duration =
    shared?.size === stat.size && shared.mtime === stat.mtimeMs ? shared.duration : await getMediaDurationSec(file);
  cache.set(file, duration);
  sharedDurationCache.set(file, { size: stat.size, mtime: stat.mtimeMs, duration });
  if (sharedDurationCache.size > 512) sharedDurationCache.delete(sharedDurationCache.keys().next().value!);
  return duration;
}

export type SyncMode = 'strict' | 'flexible' | 'video-stretch';
const MAX_DRIFT_MS = 3000;
const TEMPO_THRESHOLD = 1.05;
const MAX_TEMPO = 1.5;
const MAX_STRETCH_FACTOR = 1.25;
const TAIL_MS = 120;

export function scaleSrtLines(lines: SrtLine[], factor: number): SrtLine[] {
  return lines.map((line) => ({
    ...line,
    startMs: Math.round(line.startMs * factor),
    endMs: Math.round(line.endMs * factor),
  }));
}

/** Stretch uses the same group masters as timeline assembly, including regenerated files. */
export async function computeVideoStretchFactor(
  srtPath: string,
  ttsAudioDir: string,
  cache: DurationCache = new Map()
): Promise<number> {
  const groups = buildAudioGroups(parseSrtFile(srtPath), ttsAudioDir, readAudioManifest(ttsAudioDir));
  const durations = new Map<number, number>();
  for (let base = 0; base < groups.length; base += 8)
    await Promise.all(
      groups.slice(base, base + 8).map(async (group) => {
        if (fs.existsSync(group.audioFile))
          durations.set(group.startIndex, await probeAudioDurationSec(group.audioFile, cache));
      })
    );
  let maxFactor = 1;
  groups.forEach((group, i) => {
    const duration = durations.get(group.startIndex);
    const slot = Math.max(((groups[i + 1]?.startMs ?? group.endMs) - group.startMs) / 1000, 0.2);
    if (duration) maxFactor = Math.max(maxFactor, duration / slot / TEMPO_THRESHOLD);
  });
  return maxFactor <= 1 ? 1 : Math.min(MAX_STRETCH_FACTOR, Math.round(maxFactor * 100) / 100);
}

async function buildSegment(
  audioFile: string | null,
  segDurationSec: number,
  segPath: string,
  opts?: { tempo?: number; delayMs?: number; shouldStop?: () => boolean }
): Promise<{ tempo: number; truncated: boolean }> {
  const t = segDurationSec.toFixed(3),
    tempo = opts?.tempo ?? 1,
    delayMs = Math.max(0, Math.round(opts?.delayMs ?? 0));
  if (audioFile && fs.existsSync(audioFile)) {
    const filters: string[] = [];
    if (tempo > 1.0001) filters.push(`atempo=${tempo.toFixed(4)}`);
    if (delayMs > 0) filters.push(`adelay=${delayMs}|${delayMs}`);
    filters.push('apad');
    await runFfmpeg(
      [
        '-i',
        audioFile,
        '-af',
        filters.join(','),
        '-t',
        t,
        '-ar',
        '44100',
        '-ac',
        '2',
        '-c:a',
        'pcm_s16le',
        '-y',
        segPath,
      ],
      opts
    );
    return { tempo, truncated: false };
  }
  await runFfmpeg(
    ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', t, '-c:a', 'pcm_s16le', '-y', segPath],
    opts
  );
  return { tempo: 1, truncated: false };
}

export interface TtsOverrun {
  index: number;
  tempo: number;
  truncated: boolean;
}
interface SentenceAudioGroup {
  startIndex: number;
  endIndex: number;
  startMs: number;
  endMs: number;
  audioFile: string;
  subtitles: SubtitleLine[];
}

function readAudioManifest(dir: string): Record<string, any> {
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) return {};
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
    throw new Error('Manifest TTS không hợp lệ. Hãy tạo lại TTS.');
  return manifest;
}

function buildAudioGroups(subtitles: SubtitleLine[], dir: string, manifest: Record<string, any>): SentenceAudioGroup[] {
  if (!Object.keys(manifest).length)
    return groupSubtitlesForTts(subtitles).map((group) => ({
      ...group,
      audioFile: path.join(dir, `subtitle_${String(group.startIndex).padStart(4, '0')}.mp3`),
    }));
  const byIndex = new Map(subtitles.map((sub) => [sub.index, sub])),
    handled = new Set<number>(),
    groups: SentenceAudioGroup[] = [];
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  for (const sub of subtitles) {
    if (handled.has(sub.index)) continue;
    const entry = manifest[String(sub.index)];
    if (!entry) throw new Error(`Thiếu dữ liệu TTS dòng ${sub.index}. Hãy tạo lại TTS.`);
    if (entry.isGroupMember) continue;
    const indices: number[] = entry.isGroupLeader ? entry.groupIndices : [sub.index];
    if (!Array.isArray(indices) || !indices.length || indices[0] !== sub.index)
      throw new Error('Nhóm TTS không hợp lệ. Hãy tạo lại TTS.');
    const members = indices.map((index) => byIndex.get(index));
    if (members.some((member) => !member)) throw new Error('Phụ đề không khớp nhóm TTS. Hãy tạo lại TTS.');
    const memberSubs = members as SubtitleLine[];
    if (
      typeof entry.text !== 'string' ||
      normalize(entry.text) !== normalize(memberSubs.map((member) => member.text).join(' '))
    )
      throw new Error('Nội dung phụ đề đã thay đổi. Hãy tạo lại TTS.');
    for (const member of memberSubs) {
      const item = manifest[String(member.index)];
      if (
        handled.has(member.index) ||
        (member.index !== sub.index && (!item?.isGroupMember || item.leaderIndex !== sub.index))
      )
        throw new Error('Quan hệ nhóm TTS không hợp lệ. Hãy tạo lại TTS.');
      handled.add(member.index);
    }
    const filename = entry.audioFile || `subtitle_${String(sub.index).padStart(4, '0')}.mp3`;
    if (typeof filename !== 'string' || filename !== path.basename(filename))
      throw new Error('Tên file audio TTS không hợp lệ.');
    const last = memberSubs[memberSubs.length - 1];
    groups.push({
      startIndex: sub.index,
      endIndex: last.index,
      startMs: sub.startMs,
      endMs: last.endMs,
      audioFile: path.join(dir, filename),
      subtitles: memberSubs,
    });
  }
  if (handled.size !== subtitles.length) throw new Error('Nhóm TTS thiếu leader. Hãy tạo lại TTS.');
  return groups;
}

export async function mergeAudioFiles(
  srtPath: string,
  ttsAudioDir: string,
  outputAudioPath: string,
  onProgress?: (percent: number) => void,
  opts?: { mode?: SyncMode; shouldStop?: () => boolean }
): Promise<{ audioPath: string; overruns: TtsOverrun[] }> {
  if (opts?.shouldStop?.()) throw new CancelledError();
  const manifest = readAudioManifest(ttsAudioDir);
  const groups = buildAudioGroups(parseSrtFile(srtPath), ttsAudioDir, manifest);
  const signature = groups.map((group) => {
    const stat = fs.existsSync(group.audioFile) ? fs.statSync(group.audioFile) : undefined;
    if (Object.keys(manifest).length && !stat) throw new Error('Thiếu file audio TTS. Hãy tạo lại TTS.');
    return [group.startMs, group.endMs, group.audioFile, stat?.size, stat?.mtimeMs];
  });
  const key = createHash('sha256')
    .update(JSON.stringify(['timeline-v2', opts?.mode ?? 'strict', signature]))
    .digest('hex');
  const metadataPath = path.join(ttsAudioDir, `.timeline-${key}.json`);
  let cached: { file: string; overruns: TtsOverrun[] } | undefined;
  try {
    cached = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch {}
  if (!cached || cached.file !== path.basename(cached.file) || !fs.existsSync(path.join(ttsAudioDir, cached.file))) {
    const file = `.timeline-${key.slice(0, 16)}-${randomUUID().slice(0, 8)}.wav`;
    let result: Awaited<ReturnType<typeof assembleTimeline>>;
    try {
      result = await assembleTimeline(srtPath, ttsAudioDir, path.join(ttsAudioDir, file), onProgress, opts);
    } catch (error) {
      if (fs.existsSync(path.join(ttsAudioDir, file))) fs.unlinkSync(path.join(ttsAudioDir, file));
      throw error;
    }
    cached = { file, overruns: result.overruns };
    const temporary = `${metadataPath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(cached));
      fs.renameSync(temporary, metadataPath);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  const extension = path.extname(outputAudioPath) || '.m4a';
  const temporaryOutput = path.join(path.dirname(outputAudioPath), `.audio-${randomUUID().slice(0, 16)}${extension}`);
  try {
    const codec =
      extension.toLowerCase() === '.mp3' ? 'libmp3lame' : extension.toLowerCase() === '.wav' ? 'pcm_s16le' : 'aac';
    await runFfmpeg(
      [
        '-i',
        path.join(ttsAudioDir, cached.file),
        '-c:a',
        codec,
        ...(codec === 'pcm_s16le' ? [] : ['-b:a', '192k']),
        '-y',
        temporaryOutput,
      ],
      opts
    );
    if (opts?.shouldStop?.()) throw new CancelledError();
    fs.renameSync(temporaryOutput, outputAudioPath);
    onProgress?.(100);
    return { audioPath: outputAudioPath, overruns: cached.overruns };
  } finally {
    if (fs.existsSync(temporaryOutput)) fs.unlinkSync(temporaryOutput);
  }
}

async function assembleTimeline(
  srtPath: string,
  ttsAudioDir: string,
  outputAudioPath: string,
  onProgress?: (percent: number) => void,
  opts?: { mode?: SyncMode; shouldStop?: () => boolean }
): Promise<{ audioPath: string; overruns: TtsOverrun[] }> {
  const mode = opts?.mode ?? 'strict';
  const checkCancelled = () => {
    if (opts?.shouldStop?.()) throw new CancelledError();
  };
  checkCancelled();
  const subtitles = parseSrtFile(srtPath);
  if (subtitles.length === 0) {
    throw new Error('File SRT không có dòng phụ đề hợp lệ để ghép audio.');
  }

  // Đọc manifest.json nếu có để nhận diện SentenceGroup
  let manifest: Record<string, any> = {};
  try {
    const manifestPath = path.join(ttsAudioDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    }
  } catch {
    // Không có manifest hoặc hỏng — fallback sang groupSubtitlesForTts
  }

  const groups = buildAudioGroups(subtitles, ttsAudioDir, manifest);

  const workDir = path.join(path.dirname(outputAudioPath), `.vanhsub_dub_${randomUUID()}`);
  const tempListFile = path.join(workDir, 'concat.txt');
  const durationCache: DurationCache = new Map();

  try {
    fs.mkdirSync(workDir, { recursive: true });
    console.log(`[Dubbing] Ghép audio ${subtitles.length} dòng (${groups.length} nhóm câu, mode ${mode})...`);

    const segPaths: string[] = [];
    const overruns: TtsOverrun[] = [];
    let cursorMs = 0; // thời điểm kết thúc segment trước (mode flexible)
    let driftMs = 0; // tổng độ trượt đã dùng

    for (let i = 0; i < groups.length; i++) {
      checkCancelled();
      const group = groups[i];
      const next = groups[i + 1];
      const slotEndMs = next ? Math.max(next.startMs, group.startMs + 200) : group.endMs + 500;

      const audioFile = group.audioFile;
      const hasAudio = fs.existsSync(audioFile);
      const audioDurMs = hasAudio ? (await probeAudioDurationSec(audioFile, durationCache)) * 1000 : 0;

      const segPath = path.join(workDir, `seg_${String(i).padStart(5, '0')}.wav`);
      let tempo = 1;
      let truncated = false;

      if (mode === 'flexible') {
        // Audio bắt đầu tại max(start SRT, điểm trượt tới) — câu trước tràn
        // sang thì câu này bắt đầu ngay sau đó (dịch lùi tự nhiên)
        const audioStartMs = Math.max(group.startMs, cursorMs);
        const naturalEndMs = audioStartMs + audioDurMs + TAIL_MS;

        if (naturalEndMs <= slotEndMs) {
          // Vừa slot → pad im lặng tới slotEnd (không đổi rhythm)
          const segDurationSec = Math.max((slotEndMs - cursorMs) / 1000, 0.05);
          await buildSegment(hasAudio ? audioFile : null, segDurationSec, segPath, {
            shouldStop: opts?.shouldStop,
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
              shouldStop: opts?.shouldStop,
              delayMs: audioStartMs - cursorMs,
            });
            driftMs += naturalEndMs - slotEndMs;
            cursorMs = naturalEndMs;
          } else {
            // Vượt ngưỡng trượt → nén audio để vừa vùng cho phép
            const targetAudioDurSec = Math.max((allowedEndMs - audioStartMs - TAIL_MS) / 1000, 0.05);
            const rawTempo = audioDurMs / 1000 / targetAudioDurSec;
            tempo = Math.min(Math.max(rawTempo, 1), MAX_TEMPO);
            truncated = rawTempo > MAX_TEMPO;
            const segDurationSec = Math.max((allowedEndMs - cursorMs) / 1000, 0.05);
            await buildSegment(audioFile, segDurationSec, segPath, {
              shouldStop: opts?.shouldStop,
              tempo,
              delayMs: audioStartMs - cursorMs,
            });
            driftMs = MAX_DRIFT_MS;
            cursorMs = allowedEndMs;
          }
          if (tempo > TEMPO_THRESHOLD) {
            overruns.push({ index: group.startIndex, tempo, truncated });
          }
        }
      } else {
        // strict: segment = [segStart, slotEnd) cố định, audio nén nếu tràn.
        // Câu ĐẦU TIÊN phải phủ cả khoảng lặng [0, start) trước câu 1 (audio
        // được adelay tới đúng start) — nếu không, toàn bộ timeline bị dí sớm
        // lên đầu video đúng bằng start của câu 1, voice lệch sớm so với phụ đề.
        const segStartMs = i === 0 ? 0 : group.startMs;
        const segDurationSec = Math.max((slotEndMs - segStartMs) / 1000, 0.05);
        // Khung thời gian cho audio vẫn tính từ start của câu (im lặng đầu không
        // tính vào khung — tempo không bị nén oan vì khoảng lặng)
        const audioWindowSec = Math.max((slotEndMs - group.startMs) / 1000, 0.05);
        const audioDurSec = audioDurMs / 1000;
        if (hasAudio && audioDurSec > audioWindowSec * TEMPO_THRESHOLD) {
          const rawTempo = audioDurSec / audioWindowSec;
          tempo = Math.min(Math.max(rawTempo, 1), MAX_TEMPO);
          truncated = rawTempo > MAX_TEMPO;
          overruns.push({ index: group.startIndex, tempo, truncated });
        }
        await buildSegment(hasAudio ? audioFile : null, segDurationSec, segPath, {
          shouldStop: opts?.shouldStop,
          tempo,
          delayMs: group.startMs - segStartMs,
        });
        cursorMs = group.startMs + audioWindowSec * 1000;
      }

      segPaths.push(segPath);

      if (i % 10 === 0 || i === groups.length - 1) {
        onProgress?.(Math.round(((i + 1) / groups.length) * 95));
      }
    }

    fs.writeFileSync(tempListFile, segPaths.map(escapeConcatPath).join('\n'));

    const isMp3 = outputAudioPath.toLowerCase().endsWith('.mp3');
    const audioCodecArgs = isMp3
      ? ['-c:a', 'libmp3lame', '-b:a', '192k']
      : outputAudioPath.toLowerCase().endsWith('.wav')
        ? ['-c:a', 'pcm_s16le']
        : ['-c:a', 'aac', '-b:a', '192k'];

    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', tempListFile, ...audioCodecArgs, '-y', outputAudioPath], opts);
    checkCancelled();
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
    if (isCancelledError(err)) throw err;
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
    onCommandCreated?: (command: ffmpeg.FfmpegCommand) => void;
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
      options?.onCommandCreated?.(command);

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
          '-c:a',
          'aac',
          '-map',
          '0:a:0',
          '-map',
          '1:a:0',
          '-disposition:a:0',
          'default',
          '-disposition:a:1',
          'alternate'
        );
      } else if (mixOriginal) {
        // Mix: nhạc nền/SFX gốc nhỏ lại (0.22) dưới lời thoại lồng tiếng
        outputOptions.push(
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-filter_complex',
          '[0:a]volume=0.22[bg];[bg][1:a]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.97[aout]',
          '-map',
          '[aout]'
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
    /** Tách lời thoại gốc khỏi nhạc nền bằng AI (demucs) — nền giữ nguyên, giọng người gốc bị loại */
    vocalSeparation?: boolean;
    onCommandCreated?: (command: ffmpeg.FfmpegCommand) => void;
    shouldStop?: () => boolean;
  },
  onProgress?: (percent: number) => void
): Promise<{ outputPath: string; mergedAudioPath: string; overruns: TtsOverrun[]; stretchFactor: number }> {
  const tempAudioPath = path.join(path.dirname(outputVideoPath), `.dubbed_audio_${randomUUID().slice(0, 16)}.m4a`);
  const syncMode = options?.syncMode ?? 'strict';
  let stretchFactor = 1;
  let scaledSrtPath: string | null = null;
  const separationDir = path.join(os.tmpdir(), `vanhsub_separate_${randomUUID()}`);
  let backgroundAudioPath: string | null = null;
  let mixedAudioPath: string | null = null;

  try {
    if (options?.shouldStop?.()) {
      throw new Error('Đã huỷ bởi người dùng');
    }

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
          scaledSrtPath = path.join(os.tmpdir(), `vanhsub_scaled_${randomUUID()}.srt`);
          fs.writeFileSync(scaledSrtPath, serializeSrt(scaled), 'utf-8');
          mergeSrtPath = scaledSrtPath;
        }
      } else {
        console.log('[Dubbing] Video-stretch: audio đã vừa — dùng timeline gốc');
      }
    }

    // Tách lời thoại gốc bằng AI: giữ nhạc nền/SFX, loại hẳn giọng người gốc
    if (options?.vocalSeparation) {
      onProgress?.(1);
      fs.mkdirSync(separationDir, { recursive: true });
      const origWav = path.join(separationDir, 'original.wav');
      console.log('[Dubbing] Trích audio gốc (44.1kHz stereo) cho AI tách lời...');
      await extractFullQualityAudio(videoPath, origWav, undefined, options?.shouldStop);
      onProgress?.(3);
      backgroundAudioPath = (await separateVocals(origWav, separationDir, options?.shouldStop)).noVocals;
      onProgress?.(14);
    }

    if (options?.shouldStop?.()) {
      throw new Error('Đã huỷ bởi người dùng');
    }

    // Bước 1: Ghép audio
    onProgress?.(backgroundAudioPath ? 15 : 5);
    const { audioPath, overruns } = await mergeAudioFiles(
      mergeSrtPath,
      ttsAudioDir,
      tempAudioPath,
      (p) => {
        onProgress?.(Math.round((backgroundAudioPath ? 15 : 5) + p * (backgroundAudioPath ? 0.35 : 0.4)));
      },
      { mode: syncMode === 'flexible' ? 'flexible' : 'strict', shouldStop: options?.shouldStop }
    );

    if (options?.shouldStop?.()) {
      throw new Error('Đã huỷ bởi người dùng');
    }

    // Trộn nhạc nền không lời (từ AI tách) với audio TTS — lời thoại thay giọng
    // người gốc, nhạc/SFX giữ nguyên bản gốc
    let muxAudioInput = audioPath;
    if (backgroundAudioPath) {
      mixedAudioPath = path.join(path.dirname(outputVideoPath), `.dubbed_mix_${randomUUID()}.m4a`);
      console.log('[Dubbing] Trộn audio TTS + nhạc nền không lời...');
      await runFfmpeg(
        [
          '-i',
          audioPath,
          '-i',
          backgroundAudioPath,
          '-filter_complex',
          '[0:a]volume=1.0[tts];[1:a]volume=1.0[bg];[tts][bg]amix=inputs=2:duration=longest:normalize=0[aout]',
          '-map',
          '[aout]',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-y',
          mixedAudioPath,
        ],
        { shouldStop: options?.shouldStop }
      );
      muxAudioInput = mixedAudioPath;
    }

    if (options?.shouldStop?.()) {
      throw new Error('Đã huỷ bởi người dùng');
    }

    // Bước 2: Mux vào video
    onProgress?.(50);
    const finalPath = await muxAudioToVideo(
      videoPath,
      muxAudioInput,
      outputVideoPath,
      {
        replaceAudio: options?.replaceAudio,
        mixOriginalAudio: options?.mixOriginalAudio && !options.vocalSeparation,
        syncMode,
        stretchFactor,
        onCommandCreated: options?.onCommandCreated,
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
      if (mixedAudioPath && fs.existsSync(mixedAudioPath)) fs.unlinkSync(mixedAudioPath);
    } catch {
      // bỏ qua
    }
    try {
      if (fs.existsSync(separationDir)) fs.rmSync(separationDir, { recursive: true, force: true });
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
