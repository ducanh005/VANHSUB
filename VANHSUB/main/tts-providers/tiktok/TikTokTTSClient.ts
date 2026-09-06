// HTTP client cho TikTok TTS endpoint nội bộ:
// - Timeout mỗi request (AbortSignal.timeout)
// - Retry có backoff cho lỗi mạng/5xx (không retry 4xx)
// - Đổi base URL dự phòng theo khu vực khi base mặc định chết
// - Phân loại lỗi thành TikTokTTSErrorCode để UI hiển thị đúng hướng dẫn
// - KHÔNG BAO GIỜ đưa sessionid vào log/error (redactSession chặn mọi lối thoát)

import {
  TIKTOK_TTS_DEFAULT_BASE,
  TIKTOK_TTS_FALLBACK_BASES,
  buildTikTokTTSRequest,
  redactSession,
} from './endpointConfig';
import { TikTokTTSError, type SynthesisResult } from './types';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS_PER_BASE = 2;
const RETRY_DELAY_MS = 1200;

/** Chờ backoff — dùng setTimeout, không giữ session trong closure nào cả */
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Map status_code JSON của TikTok sang lỗi có ý nghĩa (đã xác minh từ client công khai) */
function mapTikTokStatusCode(code: number): TikTokTTSError {
  switch (code) {
    case 1:
      return new TikTokTTSError(
        'SESSION_INVALID_OR_EXPIRED',
        'Session TikTok không hợp lệ hoặc đã hết hạn — lấy sessionid mới từ trình duyệt rồi lưu lại trong Cài đặt.',
        undefined,
      );
    case 2:
      return new TikTokTTSError(
        'TEXT_TOO_LONG',
        'Văn bản quá dài — TikTok giới hạn mỗi request khoảng 300 ký tự. Hãy rút gọn hoặc chia nhỏ câu.',
      );
    case 4:
      return new TikTokTTSError(
        'INVALID_VOICE',
        'Voice ID không tồn tại hoặc không còn được hỗ trợ — chọn voice khác trong danh sách.',
      );
    case 5:
      return new TikTokTTSError(
        'SESSION_MISSING',
        'TikTok báo không có sessionid — kiểm tra lại session đã lưu trong Cài đặt.',
      );
    default:
      return new TikTokTTSError(
        'ENDPOINT_CHANGED',
        `TikTok trả về status_code không mong muốn (${code}) — API có thể đã thay đổi, cần cập nhật endpointConfig.`,
      );
  }
}

/** Map HTTP status sang lỗi */
function mapHttpStatus(status: number, retryAfterHeader: string | null): TikTokTTSError {
  if (status === 401 || status === 403) {
    return new TikTokTTSError(
      'AUTH_FORBIDDEN',
      'TikTok từ chối request (HTTP ' + status + ') — session có thể hết hạn, hoặc TikTok đã siết endpoint này.',
      status,
    );
  }
  if (status === 429) {
    const retryAfter = retryAfterHeader ? ` Đợi ~${retryAfterHeader}s rồi thử lại.` : '';
    return new TikTokTTSError(
      'RATE_LIMITED',
      'Vượt giới hạn tần suất của TikTok.' + retryAfter,
      status,
    );
  }
  if (status === 400) {
    return new TikTokTTSError('BAD_REQUEST', 'TikTok từ chối tham số request (HTTP 400).', status);
  }
  return new TikTokTTSError(
    'ENDPOINT_CHANGED',
    `TikTok trả về HTTP ${status} thay vì JSON audio — endpoint có thể đã thay đổi.`,
    status,
  );
}

export class TikTokTTSClient {
  /**
   * Tổng hợp text → mp3. Thử base mặc định rồi lần lượt các base dự phòng;
   * lỗi xác định (auth/rate limit/status code) dừng ngay vì các base đều
   * trả cùng kết quả; lỗi mạng/5xx mới chuyển base.
   */
  async synthesizeRaw(text: string, voice: string, sessionId: string): Promise<SynthesisResult> {
    if (!sessionId) {
      throw new TikTokTTSError('SESSION_MISSING', 'Chưa lưu sessionid TikTok trong Cài đặt.');
    }
    if (!text.trim()) {
      throw new TikTokTTSError('BAD_REQUEST', 'Văn bản cần đọc đang trống.');
    }

    const bases = [TIKTOK_TTS_DEFAULT_BASE, ...TIKTOK_TTS_FALLBACK_BASES];
    let lastError: TikTokTTSError = new TikTokTTSError(
      'NETWORK',
      'Không gọi được endpoint TikTok nào.',
    );

    for (const base of bases) {
      try {
        return await this.requestOnce(base, text, voice, sessionId);
      } catch (err) {
        const ttsErr = err instanceof TikTokTTSError ? err : toTtsError(err);
        // Lỗi "chắc chắn" — đổi base cũng vậy, dừng luôn
        if (
          ttsErr.code === 'SESSION_INVALID_OR_EXPIRED' ||
          ttsErr.code === 'AUTH_FORBIDDEN' ||
          ttsErr.code === 'RATE_LIMITED' ||
          ttsErr.code === 'TEXT_TOO_LONG' ||
          ttsErr.code === 'INVALID_VOICE' ||
          ttsErr.code === 'SESSION_MISSING' ||
          ttsErr.code === 'ENDPOINT_CHANGED'
        ) {
          throw ttsErr;
        }
        // Lỗi mạng/timeout — thử base kế tiếp
        lastError = ttsErr;
      }
    }
    throw lastError;
  }

  /** 1 base URL: tối đa MAX_ATTEMPTS_PER_BASE lần, retry chỉ cho lỗi tạm thời */
  private async requestOnce(
    base: string,
    text: string,
    voice: string,
    sessionId: string,
  ): Promise<SynthesisResult> {
    let lastError: TikTokTTSError | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_BASE; attempt++) {
      // Signal phải tạo MỖI lần thử — tái dùng signal đã abort sẽ fail tức thì
      const request = buildTikTokTTSRequest(base, text, voice, sessionId);
      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          const err = mapHttpStatus(response.status, response.headers.get('retry-after'));
          // 5xx có thể tạm thời → retry; 4xx dừng ngay
          if (response.status >= 500 && attempt < MAX_ATTEMPTS_PER_BASE) {
            lastError = err;
            await sleep(RETRY_DELAY_MS * attempt);
            continue;
          }
          throw err;
        }

        const bodyText = await response.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(bodyText);
        } catch {
          // Không phải JSON — TikTok trả HTML (blocked/đổi API) → đổi base/thử lại
          throw new TikTokTTSError(
            'ENDPOINT_CHANGED',
            `Response không phải JSON (HTTP ${response.status}) — endpoint có thể đã thay đổi.`,
            response.status,
          );
        }

        const envelope = parsed as { status_code?: number; data?: { v_str?: unknown } };
        const statusCode = typeof envelope.status_code === 'number' ? envelope.status_code : 0;
        if (statusCode !== 0) {
          throw mapTikTokStatusCode(statusCode);
        }

        const vStr = envelope.data?.v_str;
        if (typeof vStr !== 'string' || vStr.length === 0) {
          throw new TikTokTTSError(
            'ENDPOINT_CHANGED',
            'JSON hợp lệ nhưng thiếu data.v_str — TikTok đã đổi format response.',
            response.status,
          );
        }

        const audio = Buffer.from(vStr, 'base64');
        if (audio.length === 0) {
          throw new TikTokTTSError('ENDPOINT_CHANGED', 'Audio trả về rỗng.', response.status);
        }

        return { audio, contentType: 'audio/mpeg', byteLength: audio.length };
      } catch (err) {
        const ttsErr = err instanceof TikTokTTSError ? err : toTtsError(err);
        // Lỗi xác định không retry
        if (ttsErr.code !== 'NETWORK' && ttsErr.code !== 'TIMEOUT') throw ttsErr;
        lastError = ttsErr;
        if (attempt < MAX_ATTEMPTS_PER_BASE) {
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        throw ttsErr;
      }
    }

    throw lastError ?? new TikTokTTSError('NETWORK', 'Không gọi được endpoint.');
  }
}

/** Bọc lỗi ngoài dự đoán — redact sessionid phòng hờ trước khi message đi đâu đó */
function toTtsError(err: unknown): TikTokTTSError {
  const raw = err instanceof Error ? err.message : String(err);
  const safe = redactSession(raw);
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new TikTokTTSError('TIMEOUT', 'TikTok không phản hồi trong thời gian cho phép (30s).');
  }
  if (err instanceof Error && (err.name === 'AbortError' || /abort/i.test(raw))) {
    return new TikTokTTSError('TIMEOUT', 'Request tới TikTok đã bị huỷ/hết thời gian.');
  }
  return new TikTokTTSError('NETWORK', `Lỗi kết nối tới TikTok: ${safe}`);
}
