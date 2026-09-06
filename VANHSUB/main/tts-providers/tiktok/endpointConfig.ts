// =========================================================================
// ENDPOINT CONFIG — ĐIỂM DUY NHẤT biết TikTok TTS API "sống" ở đâu.
//
// Nguồn xác minh (tháng 9/2026): mã nguồn công khai của các client TikTok TTS
// đang hoạt động — Steve0929/tiktok-tts (npm), oscie57/tiktok-voice,
// Weilbyte/tiktok-tts. Endpoint là API NỘI BỘ (không có tài liệu chính thức),
// TikTok có thể đổi bất cứ lúc nào. Khi đó chỉ cần sửa file này, phần còn lại
// của module (client/provider/UI) giữ nguyên.
//
// Những gì ĐÃ xác minh từ mã nguồn công khai:
//   - Method: POST, body rỗng, tham số nằm trên query string
//   - Query: text_speaker (voice), req_text (text), speaker_map_type=0, aid=1233
//   - Header: Cookie "sessionid=<...>" + User-Agent app TikTok Android
//   - Response: JSON { status_code: 0, data: { v_str: "<base64 mp3>" } }
//   - status_code lỗi: 1 = session sai/hết hạn, 2 = text quá dài,
//     4 = voice không hợp lệ, 5 = thiếu sessionid
//
// Những gì là GIẢ ĐỊNH (đã ghi chú tại chỗ dùng):
//   - Các base URL dự phòng theo khu vực (từ README, chưa test từng cái)
//   - Giới hạn ~300 ký tự của req_text (không có tài liệu, chỉ là báo cáo
//     từ các client công khai — xử lý qua status_code 2, không hard-code)
//
// Module CHỊU THUA có chủ đích: KHÔNG có ký số request, không qua msToken,
// không qua challenge/captcha — nếu TikTok đòi hỏi thêm, client báo lỗi
// AUTH_FORBIDDEN / ENDPOINT_CHANGED thay vì cố giả mạo client khác.
// =========================================================================

/** Base URL mặc định (từ mã nguồn npm tiktok-tts) */
export const TIKTOK_TTS_DEFAULT_BASE = 'https://api16-normal-v6.tiktokv.com';

/**
 * Các base dự phòng theo khu vực — dùng khi base mặc định lỗi mạng/404.
 * (GIẢ ĐỊNH: danh sách lấy từ README của các client công khai, chưa test
 * từng cái — client thử lần lượt và dừng ở cái đầu tiên trả lời đúng format.)
 */
export const TIKTOK_TTS_FALLBACK_BASES = [
  'https://api16-normal-c-useast1a.tiktokv.com',
  'https://api22-normal-c-useast2a.tiktokv.com',
  'https://api16-core-c-useast1a.tiktokv.com',
  'https://api-core.tiktokv.com',
];

export const TIKTOK_TTS_PATH = '/media/api/text/speech/invoke/';

/** aid là app-id cố định mà các client công khai dùng */
const AID = '1233';

/**
 * User-Agent mà các client công khai dùng để endpoint trả lời. Chỉ là header
 * tĩnh — module không giả mạo TLS fingerprint hay qua bất kỳ challenge nào.
 */
const USER_AGENT =
  'com.zhiliaoapp.musically/2022600030 (Linux; U; Android 7.1.2; es_ES; SM-G988N; Build/NRD90M;tt-ok/3.12.13.1)';

export interface TikTokTTSRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  /** POST body rỗng — tham số nằm hết trên query string */
  body: undefined;
}

/**
 * Dựng request cho 1 lần tổng hợp.
 *
 * req_text: client công khai encode thô (thay space bằng '+'). Ở đây encode
 * chuẩn encodeURIComponent sau khi thay '&'/'+' bằng chữ — cần thiết để text
 * TIẾNG VIỆT (dấu tiếng Việt) đi qua URL an toàn; %20 tương đương space khi
 * server decode query.
 */
export function buildTikTokTTSRequest(
  baseUrl: string,
  text: string,
  voice: string,
  sessionId: string,
): TikTokTTSRequest {
  const safeText = text.replace(/&/g, 'and').replace(/\+/g, 'plus');
  const query = new URLSearchParams({
    text_speaker: voice,
    req_text: safeText,
    speaker_map_type: '0',
    aid: AID,
  });

  return {
    url: `${baseUrl}${TIKTOK_TTS_PATH}?${query.toString()}`,
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Cookie: `sessionid=${sessionId}`,
    },
    body: undefined,
  };
}

/**
 * Xoá mọi dấu vết sessionid khỏi chuỗi (log, error message) — phòng trường
 * hợp nội dung response của TikTok vô tình echo lại header/cookie.
 */
export function redactSession(input: string): string {
  return input.replace(/(sessionid=)[^;\s"']+/gi, '$1[REDACTED]');
}
