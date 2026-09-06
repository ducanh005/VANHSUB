// Kiểu dữ liệu dùng chung cho TikTok TTS provider.
// File này KHÔNG import electron — module core test được độc lập qua tsx
// (scripts/test-tiktok-tts.ts) và giữ nguyên khi thay endpoint/backend.

export interface TikTokVoice {
  /** Voice ID gửi lên endpoint, vd: 'BV074_streaming', 'en_us_001' */
  id: string;
  /** Tên hiển thị cho người dùng */
  label: string;
  /** Ngôn ngữ chính của giọng (mã ISO vd 'vi', 'en', hoặc 'effect') */
  language: string;
  gender?: 'male' | 'female' | 'unknown';
}

/**
 * Phân loại lỗi TikTok TTS — renderer/main dựa vào `code` để hiển thị hướng
 * dẫn phù hợp (session hết hạn → hướng dẫn lấy sessionid mới, rate limit →
 * đợi, ENDPOINT_CHANGED → TikTok đã đổi API, cần cập nhật endpointConfig).
 */
export type TikTokTTSErrorCode =
  | 'SESSION_MISSING'
  | 'SESSION_INVALID_OR_EXPIRED'
  | 'AUTH_FORBIDDEN'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'BAD_REQUEST'
  | 'TEXT_TOO_LONG'
  | 'INVALID_VOICE'
  | 'ENDPOINT_CHANGED'
  | 'UNKNOWN';

export class TikTokTTSError extends Error {
  readonly code: TikTokTTSErrorCode;
  readonly httpStatus?: number;

  constructor(code: TikTokTTSErrorCode, message: string, httpStatus?: number) {
    super(message);
    this.name = 'TikTokTTSError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Nguồn đọc/ghi sessionid. Tách interface để test script dùng biến môi trường
 * (không lưu) còn app chính dùng safeStorage mã hoá DPAPI (sessionStores.ts).
 */
export interface TikTokSessionStore {
  load(): string;
  save(sessionId: string): void;
  clear(): void;
}

export interface TikTokValidateResult {
  valid: boolean;
  /** Mô tả kết quả cho người dùng — không bao giờ chứa sessionid */
  detail: string;
}

export interface SynthesisResult {
  /** Audio mp3 đã decode từ base64 */
  audio: Buffer;
  contentType: string;
  byteLength: number;
}

/** Facade chính — các method theo đúng spec TiktokTTSProvider */
export interface TiktokTTSProvider {
  /** Kiểm tra session còn hạn không (probe 1 request TTS nhỏ) */
  validateSession(): Promise<TikTokValidateResult>;
  /** Danh sách voice khả dụng */
  getVoices(): Promise<TikTokVoice[]>;
  /** Tổng hợp audio từ text — trả Buffer mp3 */
  synthesize(text: string, voice: string): Promise<SynthesisResult>;
  /** Tổng hợp và ghi ra file — trả về đường dẫn file đã ghi */
  saveAudio(text: string, voice: string, outputPath: string): Promise<string>;
}
