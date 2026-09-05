import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';
import { SettingsStore } from '../store/settingsStore';
import { VoiceSampleStore } from '../store/voiceSampleStore';

interface TTSOptions {
  voice?: string;
  speed?: number;
  /** Giọng riêng cho từng dòng phụ đề: key = số dòng SRT (chuỗi), đè lên giọng chung */
  voiceOverrides?: Record<string, string>;
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
 * Gọi VietTTS API để tạo audio từ text
 */
async function generateAudio(
  text: string,
  voice: string = 'default',
  speed: number = 1.0
): Promise<Buffer> {
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

  // Đảm bảo thư mục output tồn tại
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const subtitles = parseSrtFile(srtPath);
  const audioFiles = new Map<number, string>();
  let totalDuration = 0;

  console.log(`[TTS] Bắt đầu tạo audio từ ${subtitles.length} dòng phụ đề`);

  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    onProgress?.(i + 1, subtitles.length);

    try {
      // Dòng được gán giọng riêng trong voiceOverrides sẽ đè lên giọng chung
      const lineVoice = options?.voiceOverrides?.[String(sub.index)] || voice;
      console.log(`[TTS] Đang xử lý dòng ${i + 1}/${subtitles.length} (${lineVoice}): "${sub.text.slice(0, 50)}..."`);

      // Generate audio từ text subtitle
      const audioBuffer = await generateAudio(sub.text, lineVoice, speed);

      // Lưu file audio với tên định dạng: subtitle_XXX.mp3
      const audioFileName = `subtitle_${String(sub.index).padStart(4, '0')}.mp3`;
      const audioPath = path.join(outputDir, audioFileName);

      fs.writeFileSync(audioPath, audioBuffer);
      audioFiles.set(sub.index, audioPath);
      totalDuration += sub.durationMs;

      console.log(`[TTS] ✓ Đã tạo ${audioFileName} (${audioBuffer.length} bytes)`);
    } catch (err) {
      console.error(`[TTS] ✗ Lỗi tạo audio cho dòng ${i + 1}:`, err);
      throw err;
    }
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
    const response = await fetch(`${endpoint}/v1/voices`, {
      method: 'GET',
      timeout: 5000,
    } as any);
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
  speed?: number
): Promise<{ audioBase64: string; mimeType: string }> {
  const buffer = await generateAudio(text, voice, speed);
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
      timeout: 5000,
    } as any);
    return response.ok;
  } catch {
    return false;
  }
}
