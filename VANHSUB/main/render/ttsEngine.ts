import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';
import { SettingsStore } from '../store/settingsStore';
import { VoiceSampleStore } from '../store/voiceSampleStore';
import { getSharedTikTokProvider } from '../tts-providers/tiktok/sessionStores';
import { CancelledError } from '../lib/cancel';

/** Engine tạo audio cho lồng tiếng */
export type TTSEngine = 'viettts' | 'tiktok';

interface TTSOptions {
  voice?: string;
  speed?: number;
  /** Engine dùng cho lần chạy này (mặc định 'viettss' — lỗi chính tả sẽ thành 'viettts') */
  engine?: TTSEngine;
  /** Giọng riêng cho từng dòng phụ đề: key = số dòng SRT (chuỗi), đè lên giọng chung */
  voiceOverrides?: Record<string, string>;
  /** Trả về true để dừng giữa chừng (huỷ bởi người dùng) — kiểm tra trước mỗi dòng */
  shouldStop?: () => boolean;
}

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
 * - 'viettss'→'viettts': VietTTS local (voice clone qua /v1/tts hoặc voice built-in)
 * - 'tiktok': TikTok TTS (cần session đã lưu trong Cài đặt) — không hỗ trợ speed
 */
async function generateAudio(
  text: string,
  voice: string = 'default',
  speed: number = 1.0,
  engine: TTSEngine = 'viettts'
): Promise<Buffer> {
  if (engine === 'tiktok') {
    try {
      const result = await getSharedTikTokProvider().synthesize(text, voice);
      return result.audio;
    } catch (err) {
      console.error('TikTok TTS error:', err instanceof Error ? err.message : err);
      throw new Error(
        `TikTok TTS: ${err instanceof Error ? err.message : 'lỗi không xác định'}`,
      );
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

interface TtsManifestEntry {
  voice: string;
  speed: number;
  text: string;
  /** Engine tạo ra file — đổi engine phải regenerate, không tái sử dụng chéo */
  engine: string;
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

  const voiceToUse = voice || SettingsStore.get('ttsVoice') || 'default';
  const speedToUse = speed || SettingsStore.get('ttsSpeed') || 1.0;
  const engineToUse: TTSEngine = engine || 'viettts';

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

  console.log(`[TTS] Bắt đầu tạo audio từ ${subtitles.length} dòng phụ đề`);

  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    onProgress?.(i + 1, subtitles.length);

    if (options?.shouldStop?.()) {
      saveManifest(outputDir, manifest);
      throw new CancelledError();
    }

    try {
      // Dòng được gán giọng riêng trong voiceOverrides sẽ đè lên giọng chung.
      // Tra theo 2 khoá: số thứ tự GHI TRONG file SRT (sub.index) và vị trí
      // dòng trong mảng (i+1) — file SRT chỉnh tay có thể đánh số lệch/gap
      // khiến 1 trong 2 khoá lệch dòng.
      const lineVoice =
        options?.voiceOverrides?.[String(sub.index)] ||
        options?.voiceOverrides?.[String(i + 1)] ||
        voice;
      if (lineVoice !== voice) {
        console.log(`[TTS] Dòng ${sub.index} dùng giọng riêng: ${lineVoice}`);
      }
      const audioFileName = `subtitle_${String(sub.index).padStart(4, '0')}.mp3`;
      const audioPath = path.join(outputDir, audioFileName);

      // Cache hit: file đã tồn tại và tạo bằng cùng engine/giọng/tốc độ/text → bỏ qua
      const manifestEntry = manifest[String(sub.index)];
      if (
        manifestEntry &&
        (manifestEntry.engine || 'viettts') === engine &&
        manifestEntry.voice === lineVoice &&
        Number(manifestEntry.speed) === Number(speed) &&
        manifestEntry.text === sub.text &&
        fs.existsSync(audioPath) &&
        fs.statSync(audioPath).size > 0
      ) {
        audioFiles.set(sub.index, audioPath);
        totalDuration += sub.durationMs;
        cacheHits++;
        continue;
      }

      console.log(
        `[TTS] Đang xử lý dòng ${i + 1}/${subtitles.length} (${lineVoice}): "${sub.text.slice(0, 50)}..."`
      );

      // Generate audio từ text subtitle (có retry — server TTS đôi lúc hỏng 1 câu)
      const audioBuffer = await withRetry(() =>
        generateAudio(sub.text, lineVoice, speed, engine)
      );

      fs.writeFileSync(audioPath, audioBuffer);
      manifest[String(sub.index)] = {
        voice: lineVoice,
        speed: speed,
        text: sub.text,
        engine,
      };
      // Ghi manifest sau mỗi câu — app đóng giữa chừng vẫn giữ cache phần đã tạo
      if (++cacheSkipped % 10 === 0) saveManifest(outputDir, manifest);
      audioFiles.set(sub.index, audioPath);
      totalDuration += sub.durationMs;

      console.log(`[TTS] ✓ Đã tạo ${audioFileName} (${audioBuffer.length} bytes)`);
    } catch (err) {
      console.error(`[TTS] ✗ Lỗi tạo audio cho dòng ${i + 1}:`, err);
      throw err;
    }
  }

  saveManifest(outputDir, manifest);
  if (cacheHits > 0) {
    console.log(
      `[TTS] Tái sử dụng ${cacheHits}/${subtitles.length} file audio từ cache (không gọi lại server)`
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
  const buffer = await generateAudio(text, voice, speed, engine || 'viettts');
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
