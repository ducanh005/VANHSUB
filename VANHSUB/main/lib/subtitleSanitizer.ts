import type { SrtLine } from './srt';

export interface SanitizeOptions {
  /**
   * Danh sách phân đoạn Whisper đối chiếu âm thanh.
   * Nếu cung cấp, các phân đoạn có thời lượng ngắn (< minDurationMs) nhưng khớp với
   * âm thanh lời thoại Whisper sẽ được bảo toàn thay vì bị loại bỏ.
   */
  whisperSegments?: SrtLine[];

  /**
   * Thời lượng tối thiểu (mili-giây) của một khối phụ đề hợp lệ.
   * Mặc định: 150ms.
   */
  minDurationMs?: number;

  /**
   * Loại bỏ các khối chỉ chứa 1 ký tự đơn lẻ hoặc 1 ký tự kèm dấu câu (ví dụ: 'c', 'A', 'a', '.', '-').
   * Mặc định: true.
   */
  removeSingleChars?: boolean;

  /**
   * Loại bỏ các khối chỉ chứa dấu câu hoặc ký hiệu trôi nổi không có chữ cái (\p{L}) hay số (\p{N}).
   * Mặc định: true.
   */
  removeFloatingPunctuation?: boolean;
}

export interface SanitizeResult {
  cleaned: SrtLine[];
  removedCount: number;
  removedItems: SrtLine[];
}

/**
 * Regex phát hiện ký tự dị thường / Unicode glitches:
 * - Ký tự thay thế lỗi giải mã: \uFFFD ()
 * - Vùng mã riêng tư Private Use Area: \uE000-\uF8FF
 * - Ký tự vẽ khung Box Drawing: \u2500-\u257F
 * - Khối hình học Block Elements: \u2580-\u259F
 * - Ký tự điều khiển (Control chars): \u0000-\u0008, \u000B, \u000C, \u000E-\u001F
 */
const UNICODE_GLITCH_REGEX = /[\uFFFD\uE000-\uF8FF\u2500-\u259F\u0000-\u0008\u000B\u000C\u000E-\u001F]/u;
const PUA_OR_REPLACEMENT_REGEX = /[\uFFFD\uE000-\uF8FF]/u;

/**
 * Kiểm tra xem một dòng phụ đề có phải là rác OCR hay không dựa trên 4 quy tắc:
 * - Rule G1: Ký tự đơn lẻ ('c', 'A', 'a', '.', '-', v.v.).
 * - Rule G2: Dấu câu / ký hiệu trôi nổi không chứa chữ cái (\p{L}) hoặc chữ số (\p{N}).
 * - Rule G3: Thời lượng siêu ngắn (< 150ms) không khớp với bất kỳ âm thanh lời thoại nào từ Whisper.
 * - Rule G4: Ký tự Unicode dị thường / lỗi decode (PUA, Box Drawing, Block Elements, \uFFFD).
 */
export function isOcrGarbageLine(line: SrtLine, options?: SanitizeOptions): boolean {
  if (!line || typeof line.text !== 'string') {
    return true;
  }

  const trimmed = line.text.trim();
  if (trimmed.length === 0) {
    return true;
  }

  // Mốc thời gian không hợp lệ
  if (isNaN(line.startMs) || isNaN(line.endMs) || line.startMs < 0 || line.endMs <= line.startMs) {
    return true;
  }

  const minDurationMs = Math.max(0, options?.minDurationMs ?? 150);
  const removeSingleChars = options?.removeSingleChars ?? true;
  const removeFloatingPunctuation = options?.removeFloatingPunctuation ?? true;

  // Rule G4: Ký tự Unicode dị thường (PUA, Replacement character )
  if (PUA_OR_REPLACEMENT_REGEX.test(trimmed)) {
    return true;
  }

  // Rule G2: Dấu câu & ký hiệu trôi nổi không chứa bất kỳ chữ cái (\p{L}) hoặc chữ số (\p{N}) nào
  if (removeFloatingPunctuation && !/[\p{L}\p{N}]/u.test(trimmed)) {
    return true;
  }

  // Tách riêng chữ và số để kiểm tra Rule G1
  const alphanumericOnly = trimmed.replace(/[^\p{L}\p{N}]/gu, '');

  // Rule G1: 1 ký tự đơn lẻ (hoặc chỉ có 1 ký tự chữ/số bị bao quanh bởi dấu câu/ký hiệu)
  if (removeSingleChars) {
    if (trimmed.length <= 1 || alphanumericOnly.length <= 1) {
      return true;
    }
  }

  // Rule G4: Box Drawing hoặc Block Elements không có đủ nội dung chữ/số hợp lệ
  if (UNICODE_GLITCH_REGEX.test(trimmed)) {
    const stripped = trimmed.replace(new RegExp(UNICODE_GLITCH_REGEX.source, 'gu'), '').trim();
    if (stripped.length <= 1 || !/[\p{L}\p{N}]/u.test(stripped)) {
      return true;
    }
  }

  // Rule G3: Thời lượng hiển thị siêu ngắn (< 150ms)
  const duration = line.endMs - line.startMs;
  if (duration <= 0) {
    return true;
  }

  if (duration < minDurationMs) {
    if (options?.whisperSegments !== undefined && options.whisperSegments.length > 0) {
      const hasWhisperAudio = options.whisperSegments.some(
        (w) => w.endMs >= line.startMs && w.startMs <= line.endMs
      );
      if (!hasWhisperAudio) {
        return true;
      }
    } else {
      // Không có tín hiệu Whisper chứng thực âm thanh -> xác định là nhiễu chớp khung hình
      return true;
    }
  }

  return false;
}

/**
 * Lọc sạch danh sách phụ đề, loại bỏ các dòng rác OCR theo tiêu chuẩn.
 */
export function sanitizeSubtitles(lines: SrtLine[], options?: SanitizeOptions): SanitizeResult {
  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    return {
      cleaned: [],
      removedCount: 0,
      removedItems: [],
    };
  }

  const cleaned: SrtLine[] = [];
  const removedItems: SrtLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isOcrGarbageLine(line, options)) {
      removedItems.push(line);
    } else {
      cleaned.push(line);
    }
  }

  return {
    cleaned,
    removedCount: removedItems.length,
    removedItems,
  };
}
