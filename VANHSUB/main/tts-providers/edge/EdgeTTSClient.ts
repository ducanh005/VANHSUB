import { MsEdgeTTS, OUTPUT_FORMAT, type ProsodyOptions } from 'msedge-tts';

export interface EdgeVoiceInfo {
  id: string;
  name: string;
  gender: 'Female' | 'Male';
  locale: string;
}

export const EDGE_VIETNAMESE_VOICES: EdgeVoiceInfo[] = [
  {
    id: 'vi-VN-HoaiMyNeural',
    name: 'Hoài My (Nữ - Truyền cảm, Tự nhiên)',
    gender: 'Female',
    locale: 'vi-VN',
  },
  {
    id: 'vi-VN-NamMinhNeural',
    name: 'Nam Minh (Nam - Trầm ấm, Phóng sự)',
    gender: 'Male',
    locale: 'vi-VN',
  },
];

/**
 * EdgeTTSClient: Client tổng hợp tiếng Việt qua Microsoft Edge Speech API
 * - Miễn phí 100%, không cần tài khoản, không cần sessionid/cookie
 * - Tốc độ nhanh, ổn định, giọng đọc tự nhiên chuẩn Azure Neural
 */
export class EdgeTTSClient {
  private static instance: EdgeTTSClient | null = null;

  public static getInstance(): EdgeTTSClient {
    if (!EdgeTTSClient.instance) {
      EdgeTTSClient.instance = new EdgeTTSClient();
    }
    return EdgeTTSClient.instance;
  }

  public getVoices(): EdgeVoiceInfo[] {
    return EDGE_VIETNAMESE_VOICES;
  }

  /**
   * Tổng hợp văn bản thành MP3 Buffer
   * @param text Nội dung cần đọc
   * @param voice Tên voice (mặc định 'vi-VN-HoaiMyNeural')
   * @param speed Tốc độ đọc (0.5 đến 2.0, mặc định 1.0)
   */
  public async synthesize(
    text: string,
    voice: string = 'vi-VN-HoaiMyNeural',
    speed: number = 1.0
  ): Promise<{ audio: Buffer }> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Văn bản cần đọc đang trống.');
    }

    // Chuẩn hóa voice name: nếu người dùng truyền voice TikTok hoặc tên ngắn, fallback về Hoài My
    let targetVoice = voice;
    const isKnownEdgeVoice = EDGE_VIETNAMESE_VOICES.some((v) => v.id === voice);
    if (!isKnownEdgeVoice) {
      if (voice.toLowerCase().includes('nam') || voice.toLowerCase().includes('male')) {
        targetVoice = 'vi-VN-NamMinhNeural';
      } else {
        targetVoice = 'vi-VN-HoaiMyNeural';
      }
    }

    // Chuyển đổi speed (1.0 -> 0%, 1.2 -> +20%, 0.8 -> -20%)
    const ratePercent = Math.round((Math.max(0.5, Math.min(2.0, speed)) - 1.0) * 100);
    const rateStr = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;

    const prosodyOptions: ProsodyOptions = {
      rate: rateStr,
      pitch: '+0Hz',
      volume: '+0%',
    };

    let lastError: any = null;
    const maxRetries = 2;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const tts = new MsEdgeTTS();

      try {
        await tts.setMetadata(targetVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

        const { audioStream } = tts.toStream(trimmed, prosodyOptions);

        const result = await new Promise<{ audio: Buffer }>((resolve, reject) => {
          const chunks: Buffer[] = [];
          const timer = setTimeout(() => {
            try {
              tts.close();
            } catch {}
            reject(new Error('Edge TTS Timeout sau 25 giây.'));
          }, 25_000);

          audioStream.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });

          audioStream.on('end', () => {
            clearTimeout(timer);
            try {
              tts.close();
            } catch {}
            const audioBuffer = Buffer.concat(chunks);
            if (audioBuffer.length === 0) {
              reject(new Error('Edge TTS trả về dữ liệu âm thanh rỗng.'));
              return;
            }
            resolve({ audio: audioBuffer });
          });

          audioStream.on('error', (err: any) => {
            clearTimeout(timer);
            try {
              tts.close();
            } catch {}
            reject(err);
          });
        });

        return result;
      } catch (err: any) {
        lastError = err;
        try {
          tts.close();
        } catch {}

        if (attempt < maxRetries) {
          console.warn(`[EdgeTTSClient] Lần thử ${attempt}/${maxRetries} thất bại (${err?.message || err}). Đang thử lại sau 800ms...`);
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    }

    console.error('[EdgeTTSClient] Lỗi tổng hợp giọng nói sau các lần thử:', lastError);
    throw new Error(`Edge TTS: ${lastError?.message || String(lastError)}`);
  }
}
