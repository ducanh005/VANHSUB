import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';
import { SettingsStore } from '../store/settingsStore';
import { VoiceSampleStore } from '../store/voiceSampleStore';
import { getSharedTikTokProvider } from '../tts-providers/tiktok/sessionStores';
import { EdgeTTSClient } from '../tts-providers/edge/EdgeTTSClient';
import { CancelledError } from '../lib/cancel';

/** Engine tạo audio cho lồng tiếng */
export type TTSEngine = 'viettts' | 'tiktok' | 'edge';

export interface TTSOptions {
  voice?: string;
  speed?: number;
  /** Engine dùng cho lần chạy này (mặc định 'viettts') */
  engine?: TTSEngine;
  /** Giọng riêng cho từng dòng phụ đề: key = số dòng SRT (chuỗi), đè lên giọng chung */
  voiceOverrides?: Record<string, string>;
  /** Trả về true để dừng giữa chừng (huỷ bởi người dùng) — kiểm tra trước mỗi dòng */
  shouldStop?: () => boolean;
}

export interface SubtitleLine {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  speaker?: string;
}

export interface SentenceGroup {
  id: string;
  startIndex: number;
  endIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  voice: string;
  speed: number;
  engine: TTSEngine;
  subtitles: SubtitleLine[];
}

/**
 * Quét danh sách phụ đề và gom các block liên tiếp thuộc cùng một câu thoại chưa dứt
 * (không kết thúc bằng dấu chấm, hỏi, than, lửng; khoảng cách <= 1200ms; cùng giọng)
 * thành một SentenceGroup thống nhất để sinh audio liền mạch.
 */
export function groupSubtitlesForTts(
  subtitles: SubtitleLine[],
  options?: TTSOptions
): SentenceGroup[] {
  if (!subtitles || subtitles.length === 0) return [];

  const defaultVoice = options?.voice || SettingsStore.get('ttsVoice') || 'BV074_streaming';
  const speed = options?.speed ?? SettingsStore.get('ttsSpeed') ?? 1.0;
  const engine: TTSEngine = options?.engine || 'tiktok';

  const getVoiceForLine = (sub: SubtitleLine, idx: number): string => {
    return (
      options?.voiceOverrides?.[String(sub.index)] ||
      options?.voiceOverrides?.[String(idx + 1)] ||
      defaultVoice
    );
  };

  const groups: SentenceGroup[] = [];
  let currentGroup: SubtitleLine[] = [];
  let currentVoice = '';

  for (let idx = 0; idx < subtitles.length; idx++) {
    const sub = subtitles[idx];
    const lineVoice = getVoiceForLine(sub, idx);

    if (currentGroup.length === 0) {
      currentGroup.push(sub);
      currentVoice = lineVoice;
    } else {
      currentGroup.push(sub);
    }

    const trimmed = (sub.text || '').trim();
    const isTerminal = /[.?!…][”"'\)\]}]*$/u.test(trimmed);
    const isLast = idx === subtitles.length - 1;
    const nextSub = !isLast ? subtitles[idx + 1] : null;
    const nextVoice = nextSub ? getVoiceForLine(nextSub, idx + 1) : '';
    const gapToNext = nextSub ? nextSub.startMs - sub.endMs : Infinity;
    const voiceDiffers = nextSub ? nextVoice !== currentVoice : false;
    const speakerDiffers = Boolean(
      nextSub && sub.speaker && nextSub.speaker && sub.speaker !== nextSub.speaker
    );

    // Terminal condition: clause ends with terminal punctuation OR long silence gap (>1200ms) OR different voice/speaker OR last item
    if (isTerminal || gapToNext > 1200 || voiceDiffers || speakerDiffers || isLast) {
      const first = currentGroup[0];
      const last = currentGroup[currentGroup.length - 1];
      const mergedText = currentGroup
        .map((s) => (s.text || '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ');

      groups.push({
        id: `grp-${first.index}-${last.index}`,
        startIndex: first.index,
        endIndex: last.index,
        startMs: first.startMs,
        endMs: last.endMs,
        text: mergedText,
        voice: currentVoice,
        speed,
        engine,
        subtitles: [...currentGroup],
      });
      currentGroup = [];
      currentVoice = '';
    }
  }

  return groups;
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
 * Gọi VietTTS API để tạo audio từ text bằng giọng clone từ file mẫu
 * (zero-shot voice cloning qua POST /v1/tts — server trả về mp3)
 */
async function generateAudioFromSample(
  text: string,
  samplePath: string,
  speed: number
): Promise<Buffer> {
  const endpoint = SettingsStore.get('vietTtsEndpoint');

  try {
    const form = new FormData();
    form.append('text', text);
    form.append('speed', String(speed));
    form.append(
      'audio_file',
      new Blob([fs.readFileSync(samplePath)]),
      path.basename(samplePath)
    );

    const response = await fetch(`${endpoint}/v1/tts`, {
      method: 'POST',
      body: form,
      // fetch của Node không có timeout mặc định — không đặt giới hạn thì server
      // treo sẽ làm TTS đứng vĩnh viễn. 2 phút là đủ cho 1 câu dài nhất.
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${detail}`.trim());
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.error('VietTTS voice clone error:', err);
    throw new Error(`Không thể tạo audio từ giọng mẫu: ${err}`);
  }
}

/**
 * Gọi engine để tạo audio từ text.
 * - 'viettts': VietTTS local (voice clone qua /v1/tts hoặc voice built-in)
 * - 'tiktok': TikTok TTS (cần session đã lưu trong Cài đặt)
 * - 'edge': Microsoft Edge TTS (miễn phí, không cần token/session, giọng Hoài My / Nam Minh)
 */
async function generateAudio(
  text: string,
  voice: string = 'BV074_streaming',
  speed: number = 1.0,
  engine: TTSEngine = 'tiktok'
): Promise<Buffer> {
  if (engine === 'edge') {
    try {
      const result = await EdgeTTSClient.getInstance().synthesize(text, voice, speed);
      return result.audio;
    } catch (err: any) {
      console.error('[TTS] Edge TTS error:', err?.message || err);
      throw new Error(`Edge TTS: ${err?.message || 'Lỗi không xác định'}`);
    }
  }

  if (engine === 'tiktok') {
    try {
      const result = await getSharedTikTokProvider().synthesize(text, voice);
      return result.audio;
    } catch (err: any) {
      console.warn(
        `[TTS] TikTok TTS gặp lỗi ("${err?.message || err}"). Tự động chuyển sang Edge TTS tiếng Việt dự phòng...`
      );
      try {
        const fallback = await EdgeTTSClient.getInstance().synthesize(text, 'vi-VN-HoaiMyNeural', speed);
        return fallback.audio;
      } catch (fallbackErr: any) {
        throw new Error(
          `TikTok TTS lỗi (${err?.message || err}) và Edge TTS dự phòng cũng gặp lỗi (${fallbackErr?.message || fallbackErr})`
        );
      }
    }
  }

  const endpoint = SettingsStore.get('vietTtsEndpoint');

  try {
    // Giọng clone từ file mẫu: đi đường /v1/tts thay vì voice built-in
    const samplePath = VoiceSampleStore.getPath(voice);
    if (samplePath) {
      return await generateAudioFromSample(text, samplePath, speed);
    }

    // Chặn lỗi 404 "Voice not found": nếu voice cấu hình không có trên server
    // (vd cài đặt cũ 'alloy' của OpenAI) thì dùng voice đầu tiên server có.
    const availableVoices = await getAvailableVoices();
    if (availableVoices.length > 0 && !availableVoices.includes(voice)) {
      console.warn(
        `Voice "${voice}" không có trên VietTTS, dùng "${availableVoices[0]}" thay thế`
      );
      voice = availableVoices[0];
    }

    const client = new OpenAI({
      apiKey: 'not-used', // VietTTS local không cần key
      baseURL: `${endpoint}/v1`,
      timeout: 120_000, // server treo → ném lỗi để withRetry thử lại thay vì treo vĩnh viễn
      maxRetries: 0,
    });

    const response = await client.audio.speech.create({
      model: 'tts-1',
      voice: (voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer') || 'alloy',
      input: text,
      speed: Math.max(0.25, Math.min(4.0, speed)), // OpenAI range
    });

    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.error('VietTTS generation error:', err);
    throw new Error(`Không thể tạo audio qua VietTTS: ${err}`);
  }
}

/**
 * Chạy tác vụ có retry — server TTS local đôi lúc 500/timeout, thử lại vài
 * lần trước khi bỏ cuộc (dùng cho từng câu phụ đề để 1 câu hỏng không giết
 * cả hàng nghìn câu còn lại vô lý).
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number = 3,
  baseDelayMs: number = 1200,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        const delay = baseDelayMs * attempt;
        console.warn(`[TTS] Lỗi (lần ${attempt}/${attempts}) — thử lại sau ${delay}ms`);
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }
  throw lastError;
}

// =========================================================================
// CACHE AUDIO TỪNG CÂU — manifest JSON trong thư mục audio ghi lại mỗi dòng
// đã tạo với giọng/tốc độ/text nào. Chạy lại TTS (đổi 1 câu, giật server,
// đóng app giữa chừng...) sẽ bỏ qua các file còn hợp lệ thay vì regenerate
// toàn bộ — điều kiện cần để chạy batch video dài qua đêm.
// =========================================================================

export interface TtsManifestEntry {
  voice: string;
  speed: number;
  text: string;
  /** Engine tạo ra file — đổi engine phải regenerate, không tái sử dụng chéo */
  engine: string;
  isGroupLeader?: boolean;
  isGroupMember?: boolean;
  leaderIndex?: number;
  groupIndices?: number[];
}

const MANIFEST_FILE = 'manifest.json';

function loadManifest(outputDir: string): Record<string, TtsManifestEntry> {
  const manifestPath = path.join(outputDir, MANIFEST_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (data && typeof data === 'object') return data;
  } catch {
    // chưa có / hỏng — coi như cache rỗng
  }
  return {};
}

function saveManifest(outputDir: string, manifest: Record<string, TtsManifestEntry>): void {
  try {
    fs.writeFileSync(path.join(outputDir, MANIFEST_FILE), JSON.stringify(manifest), 'utf-8');
  } catch (err) {
    console.warn('[TTS] Không ghi được manifest cache:', err);
  }
}

/**
 * Tạo lại audio cho MỘT dòng phụ đề (sau khi người dùng sửa text hoặc đổi giọng)
 * và ghi đè file audio cũ trong ttsAudioDir. Dùng đúng nguồn SRT mà lần TTS
 * trước đã đọc (ưu tiên bản dịch).
 */
export async function regenerateTtsLine(
  srtPath: string,
  ttsAudioDir: string,
  lineIndex: number,
  voice?: string,
  speed?: number,
  engine?: TTSEngine
): Promise<void> {
  const subtitles = parseSrtFile(srtPath);
  // Tìm theo số dòng ghi trong file; không thấy thì theo vị trí (file đánh số lệch)
  const sub = subtitles.find((s) => s.index === lineIndex) ?? subtitles[lineIndex - 1];
  if (!sub) {
    throw new Error(`Không tìm thấy dòng ${lineIndex} trong file phụ đề.`);
  }

  const voiceToUse = voice || SettingsStore.get('ttsVoice') || 'BV074_streaming';
  const speedToUse = speed || SettingsStore.get('ttsSpeed') || 1.0;
  const engineToUse: TTSEngine = engine || 'tiktok';

  console.log(`[TTS] Tạo lại audio dòng ${lineIndex} (${engineToUse}/${voiceToUse}): "${sub.text.slice(0, 50)}..."`);
  const audioBuffer = await withRetry(() => generateAudio(sub.text, voiceToUse, speedToUse, engineToUse));

  if (!fs.existsSync(ttsAudioDir)) {
    fs.mkdirSync(ttsAudioDir, { recursive: true });
  }
  const audioPath = path.join(ttsAudioDir, `subtitle_${String(lineIndex).padStart(4, '0')}.mp3`);
  fs.writeFileSync(audioPath, audioBuffer);

  // Cập nhật manifest cache để lần TTS chạy lại không regenerate dòng này
  const manifest = loadManifest(ttsAudioDir);
  manifest[String(lineIndex)] = { voice: voiceToUse, speed: speedToUse, text: sub.text, engine: engineToUse };
  saveManifest(ttsAudioDir, manifest);

  console.log(`[TTS] ✓ Đã ghi đè ${audioPath}`);
}

/**
 * Tạo audio files từ file SRT
 * Trả về danh sách đường dẫn file audio đã tạo (1 file/subtitle line)
 */
export async function generateTtsFromSrt(
  srtPath: string,
  outputDir: string,
  options?: TTSOptions,
  onProgress?: (current: number, total: number) => void
): Promise<{ audioFiles: Map<number, string>; totalDuration: number }> {
  const voice = options?.voice || SettingsStore.get('ttsVoice') || 'default';
  const speed = options?.speed || SettingsStore.get('ttsSpeed') || 1.0;
  const engine: TTSEngine = options?.engine || 'viettts';

  // Đảm bảo thư mục output tồn tại
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const subtitles = parseSrtFile(srtPath);
  const audioFiles = new Map<number, string>();
  let totalDuration = 0;
  const manifest = loadManifest(outputDir);
  let cacheHits = 0;
  let cacheSkipped = 0;

  const groups = groupSubtitlesForTts(subtitles, options);
  console.log(
    `[TTS] Bắt đầu tạo audio từ ${subtitles.length} dòng phụ đề (${groups.length} nhóm câu, engine: ${engine}, giọng: ${voice})`
  );

  for (let gIdx = 0; gIdx < groups.length; gIdx++) {
    const group = groups[gIdx];
    onProgress?.(group.endIndex, subtitles.length);

    if (options?.shouldStop?.()) {
      saveManifest(outputDir, manifest);
      throw new CancelledError();
    }

    try {
      const masterFileName = `subtitle_${String(group.startIndex).padStart(4, '0')}.mp3`;
      const masterPath = path.join(outputDir, masterFileName);

      // Cache hit: master file đã tồn tại và khớp cấu hình + text
      const manifestEntry = manifest[String(group.startIndex)];
      const isCacheHit =
        manifestEntry &&
        (manifestEntry.engine || 'viettts') === group.engine &&
        manifestEntry.voice === group.voice &&
        Number(manifestEntry.speed) === Number(group.speed) &&
        manifestEntry.text === group.text &&
        fs.existsSync(masterPath) &&
        fs.statSync(masterPath).size > 0;

      if (!isCacheHit) {
        console.log(
          `[TTS] Đang xử lý nhóm câu ${gIdx + 1}/${groups.length} (dòng ${group.startIndex}-${group.endIndex}, ${group.voice}): "${group.text.slice(0, 50)}..."`
        );

        // Generate audio từ trọn vẹn group.text trong 1 API call
        const audioBuffer = await withRetry(() =>
          generateAudio(group.text, group.voice, group.speed, group.engine)
        );

        fs.writeFileSync(masterPath, audioBuffer);
        console.log(`[TTS] ✓ Đã tạo ${masterFileName} (${audioBuffer.length} bytes)`);
      } else {
        cacheHits++;
      }

      // Cập nhật manifest cho leader
      manifest[String(group.startIndex)] = {
        voice: group.voice,
        speed: group.speed,
        text: group.text,
        engine: group.engine,
        isGroupLeader: group.subtitles.length > 1,
        groupIndices: group.subtitles.map((s) => s.index),
      };

      // Cho từng member trong group: ghi nhận manifest và copy audio file
      for (const sub of group.subtitles) {
        const memberFileName = `subtitle_${String(sub.index).padStart(4, '0')}.mp3`;
        const memberPath = path.join(outputDir, memberFileName);

        if (sub.index !== group.startIndex) {
          manifest[String(sub.index)] = {
            voice: group.voice,
            speed: group.speed,
            text: sub.text,
            engine: group.engine,
            isGroupMember: true,
            leaderIndex: group.startIndex,
          };

          if (!fs.existsSync(memberPath) || fs.statSync(memberPath).size === 0) {
            fs.copyFileSync(masterPath, memberPath);
          }
        }

        audioFiles.set(sub.index, memberPath);
        totalDuration += sub.durationMs;
      }

      // Ghi manifest sau mỗi câu — app đóng giữa chừng vẫn giữ cache phần đã tạo
      if (++cacheSkipped % 10 === 0) saveManifest(outputDir, manifest);
    } catch (err) {
      console.error(
        `[TTS] ✗ Lỗi tạo audio cho nhóm câu ${gIdx + 1} (dòng ${group.startIndex}-${group.endIndex}):`,
        err
      );
      throw err;
    }
  }

  saveManifest(outputDir, manifest);
  if (cacheHits > 0) {
    console.log(
      `[TTS] Tái sử dụng ${cacheHits}/${groups.length} nhóm câu từ cache (không gọi lại server)`
    );
  }
  console.log(`[TTS] Hoàn tất! Tạo ${audioFiles.size} file audio`);
  return { audioFiles, totalDuration };
}

/**
 * Lấy danh sách giọng nói có sẵn: giọng clone từ file mẫu (ưu tiên hiển thị trước)
 * + giọng built-in trên server VietTTS qua GET /v1/voices.
 * Server không phản hồi → chỉ trả về danh sách giọng mẫu (UI tự dùng fallback).
 */
// Cache kết quả server 60s để không gọi /v1/voices cho từng dòng phụ đề
let serverVoicesCache: { at: number; voices: string[] } | null = null;
const SERVER_VOICES_CACHE_MS = 60_000;

export async function getAvailableVoices(): Promise<string[]> {
  const sampleVoices = VoiceSampleStore.list().map((s) => s.name);

  if (
    serverVoicesCache &&
    Date.now() - serverVoicesCache.at < SERVER_VOICES_CACHE_MS
  ) {
    return [...sampleVoices, ...serverVoicesCache.voices];
  }

  const endpoint = SettingsStore.get('vietTtsEndpoint');
  try {
    // LƯU Ý: fetch của Node không hỗ trợ option `timeout` (axios-style) — phải
    // dùng signal để request treo không làm kẹt caller vô thời hạn.
    const response = await fetch(`${endpoint}/v1/voices`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const voices = await response.json();
      if (Array.isArray(voices) && voices.length > 0) {
        serverVoicesCache = { at: Date.now(), voices };
        return [...sampleVoices, ...voices];
      }
    }
  } catch {
    // server không chạy — chỉ trả về giọng mẫu
  }
  return sampleVoices;
}

/**
 * Tạo 1 đoạn audio ngắn để nghe thử giọng đọc trong UI
 * Trả về base64 (mp3) để renderer phát trực tiếp qua <audio>
 */
export async function previewTts(
  text: string,
  voice?: string,
  speed?: number,
  engine?: TTSEngine
): Promise<{ audioBase64: string; mimeType: string }> {
  const buffer = await generateAudio(text, voice || 'BV074_streaming', speed, engine || 'tiktok');
  return { audioBase64: buffer.toString('base64'), mimeType: 'audio/mpeg' };
}

/**
 * Kiểm tra kết nối VietTTS
 */
export async function checkVietTtsConnection(): Promise<boolean> {
  const endpoint = SettingsStore.get('vietTtsEndpoint');
  try {
    const response = await fetch(`${endpoint}/v1/voices`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Lấy danh sách giọng đọc Edge TTS tiếng Việt
 */
export function getEdgeVoices() {
  return EdgeTTSClient.getInstance().getVoices();
}
