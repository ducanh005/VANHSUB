import { serializeSrt, type SrtLine } from '../lib/srt';
import type { OcrFrameResult } from './ocrEngine';

/** Ngưỡng tin cậy tối thiểu để giữ text của 1 khung (tesseract 0-100) */
const MIN_CONFIDENCE = 45;

/**
 * Ghép kết quả OCR từng khung thành dòng phụ đề có timestamp.
 *
 * Phụ đề cứng hiển thị nhiều khung liên tiếp → các khung liền nhau cùng nội dung
 * được gộp thành 1 dòng duy nhất (start = khung đầu, end = khung cuối + 1 khoảng lấy mẫu).
 * Một khung bị đọc hụt giữa dòng (nhiễu) cũng được vá nếu nội dung trước/sau trùng nhau.
 */
export function buildSubtitleSegments(
  frames: OcrFrameResult[],
  frameIntervalMs: number,
): SrtLine[] {
  const cleaned = frames.map((f) => normalizeText(f.text));
  const usable = cleaned.map((text, i) => ({
    text,
    confidence: frames[i].confidence,
  }));

  // Ngưỡng vá hụt: 1-2 khung nhiễu giữa dòng phụ đề thì nối continu, xa hơn thì ngắt dòng
  const mergeGapMs = frameIntervalMs * 2 + 50;

  interface RawSegment {
    startMs: number;
    endMs: number;
    text: string;
  }
  const segments: RawSegment[] = [];

  for (let i = 0; i < usable.length; i++) {
    const { text, confidence } = usable[i];
    if (!isUsableText(text, confidence)) continue;

    const timeMs = i * frameIntervalMs;
    const last = segments[segments.length - 1];

    // Khung này khớp khung trước (trong thời gian cho phép) → kéo dài dòng hiện tại
    if (last && last.text === text && timeMs - last.endMs <= mergeGapMs) {
      last.endMs = timeMs + frameIntervalMs;
      continue;
    }

    segments.push({ startMs: timeMs, endMs: timeMs + frameIntervalMs, text });
  }

  // Không cho 2 dòng chồng timestamp lên nhau (khi có khung nhiễu chen giữa)
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].endMs > segments[i + 1].startMs) {
      segments[i].endMs = segments[i + 1].startMs;
    }
  }

  return segments.map((s, index) => ({
    id: `line-${index}`,
    startMs: Math.max(0, s.startMs),
    endMs: s.endMs,
    text: s.text,
  }));
}

/** Ghép các dòng phụ đề thành nội dung file .srt (trả về null nếu không có dòng nào) */
export function segmentsToSrt(segments: SrtLine[]): string | null {
  if (segments.length === 0) return null;
  return serializeSrt(segments);
}

function isUsableText(text: string, confidence: number): boolean {
  if (!text) return false;
  if (confidence < MIN_CONFIDENCE) return false;
  return true;
}

/** Chuẩn hoá text OCR: gộp dòng/khoảng trắng, sửa dấu câu dính khoảng trắng */
function normalizeText(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:…])/g, '$1')
    // Tesseract chèn space giữa từng chữ Hán/Nhật — ghép lại thành từ liên tiếp
    // (chỉ áp dụng cho CJK; tiếng Hàn giữ nguyên space giữa các từ như bản gốc)
    .replace(/([\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff])\s+(?=[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff])/g, '$1')
    .trim();
}
