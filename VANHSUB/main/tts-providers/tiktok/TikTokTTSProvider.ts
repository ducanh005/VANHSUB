// Facade TiktokTTSProvider — tầng duy nhất mà app (IPC/pipeline) nhìn thấy.
// Đổi endpoint/thay backend khác (vd server tự host) chỉ cần viết lại tầng
// TikTokTTSClient/endpointConfig, interface này giữ nguyên.

import { TikTokSessionManager } from './TikTokSessionManager';
import { TikTokTTSClient } from './TikTokTTSClient';
import { TikTokVoiceService } from './TikTokVoiceService';
import {
  TikTokTTSError,
  type SynthesisResult,
  type TikTokSessionStore,
  type TikTokValidateResult,
  type TikTokVoice,
  type TiktokTTSProvider as ITiktokTTSProvider,
} from './types';

/** Text probe ngắn cho validateSession — đủ để server xác thực, rẻ bandwidth */
const PROBE_TEXT = 'Hi.';
const PROBE_VOICE = 'en_us_001';

export class TikTokTTSProvider implements ITiktokTTSProvider {
  constructor(
    private readonly session: TikTokSessionManager,
    private readonly client: TikTokTTSClient,
  ) {}

  /**
   * Kiểm tra session: chưa lưu → false ngay; đã lưu → probe 1 request TTS nhỏ.
   * Probe thành công = session còn hiệu lực; các lỗi auth/session → false kèm
   * hướng dẫn; lỗi khác (mạng/đổi API) → false kèm chi tiết để phân biệt.
   */
  async validateSession(): Promise<TikTokValidateResult> {
    if (!this.session.hasSession()) {
      return { valid: false, detail: 'Chưa lưu sessionid — dán session TikTok của bạn vào ô phía trên.' };
    }

    try {
      await this.client.synthesizeRaw(
        PROBE_TEXT,
        PROBE_VOICE,
        this.session.getSessionId(),
      );
      return { valid: true, detail: 'Session TikTok hoạt động bình thường.' };
    } catch (err) {
      if (err instanceof TikTokTTSError) {
        return { valid: false, detail: err.message };
      }
      return { valid: false, detail: 'Không kiểm tra được session: lỗi không xác định.' };
    }
  }

  async getVoices(): Promise<TikTokVoice[]> {
    return TikTokVoiceService.getCatalog();
  }

  async synthesize(text: string, voice: string): Promise<SynthesisResult> {
    if (!this.session.hasSession()) {
      throw new TikTokTTSError('SESSION_MISSING', 'Chưa lưu sessionid TikTok trong Cài đặt.');
    }
    const voiceId = voice.trim() || TikTokVoiceService.defaultVoice;
    return this.client.synthesizeRaw(text, voiceId, this.session.getSessionId());
  }

  async saveAudio(text: string, voice: string, outputPath: string): Promise<string> {
    const result = await this.synthesize(text, voice);
    const fs = await import('fs');
    const path = await import('path');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, result.audio);
    return outputPath;
  }

  // ---- Quản lý session (qua SessionManager — session không rời main process) ----

  hasSession(): boolean {
    return this.session.hasSession();
  }

  /** Ném TikTokTTSError nếu format sai — message không chứa giá trị đầu vào */
  saveSession(sessionId: string): void {
    this.session.save(sessionId);
  }

  clearSession(): void {
    this.session.clear();
  }
}

export function createTikTokProvider(store: TikTokSessionStore): TikTokTTSProvider {
  return new TikTokTTSProvider(
    new TikTokSessionManager(store),
    new TikTokTTSClient(),
  );
}
