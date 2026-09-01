import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';
import { SettingsStore } from '../store/settingsStore';

interface TTSOptions {
  voice?: string;
  speed?: number;
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
 * Gọi VietTTS API để tạo audio từ text
 */
async function generateAudio(
  text: string,
  voice: string = 'default',
  speed: number = 1.0
): Promise<Buffer> {
  const endpoint = SettingsStore.get('vietTtsEndpoint');

  try {
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
      console.log(`[TTS] Đang xử lý dòng ${i + 1}/${subtitles.length}: "${sub.text.slice(0, 50)}..."`);

      // Generate audio từ text subtitle
      const audioBuffer = await generateAudio(sub.text, voice, speed);

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
 * Lấy danh sách giọng nói có sẵn trên VietTTS
 * (Trong triển khai đơn giản, trả về danh sách cố định)
 */
export async function getAvailableVoices(): Promise<string[]> {
  // TODO: Call VietTTS endpoint để lấy danh sách voice động
  // Hiện tại trả về danh sách mặc định
  return ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
}

/**
 * Kiểm tra kết nối VietTTS
 */
export async function checkVietTtsConnection(): Promise<boolean> {
  const endpoint = SettingsStore.get('vietTtsEndpoint');
  try {
    const response = await fetch(`${endpoint}/v1/models`, {
      method: 'GET',
      timeout: 5000,
    } as any);
    return response.ok;
  } catch {
    return false;
  }
}
