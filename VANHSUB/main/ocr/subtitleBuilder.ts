import { serializeSrt, type SrtLine } from '../lib/srt';
import type { OcrFrameResult } from './ocrEngine';

/**
 * Ngưỡng tin cậy tối thiểu để giữ text của 1 khung. Bộ lọc chính là
 * MIN_LINE_CONFIDENCE trong ocrEngine (theo từng dòng) — đây chỉ là cửa
 * phụ trên mean của các dòng đã được lọc nên đặt ngang mức đó.
 */
const MIN_CONFIDENCE = 40;

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
  const rawSegments: RawSegment[] = [];

  for (let i = 0; i < usable.length; i++) {
    const { text, confidence } = usable[i];
    if (!isUsableText(text, confidence)) continue;

    const timeMs = i * frameIntervalMs;
    const last = rawSegments[rawSegments.length - 1];

    // Khung này khớp khung trước (trong thời gian cho phép) → kéo dài dòng hiện tại.
    // Dùng checkMergeMatch: hỗ trợ trùng khớp, sai số nhẹ ký tự (1-2 ký tự) và chữ hiện dần (karaoke)
    const match = last ? checkMergeMatch(last.text, text) : { matched: false };
    if (
      last &&
      timeMs - last.endMs <= mergeGapMs &&
      match.matched
    ) {
      last.endMs = timeMs + frameIntervalMs;
      if (match.bestText && match.bestText.length >= last.text.length) {
        last.text = match.bestText;
      }
      continue;
    }

    rawSegments.push({ startMs: timeMs, endMs: timeMs + frameIntervalMs, text });
  }

  return deduplicateSubtitleSegments(rawSegments, frameIntervalMs);
}

/**
 * Hậu xử lý loại bỏ phụ đề lặp:
 * 1. Gộp các segment kế tiếp có nội dung giống nhau hoặc tương đồng cao (gap <= 1000ms).
 * 2. Gộp các câu phụ đề tích lũy dạng karaoke còn sót lại (A là tiền tố của B).
 * 3. Lọc bỏ các dòng chớp tắt siêu ngắn (< 250ms) có nội dung quá bé (dấu chấm, 1 chữ rác).
 */
export function deduplicateSubtitleSegments(
  segments: Array<{ startMs: number; endMs: number; text: string }>,
  frameIntervalMs: number = 500,
): SrtLine[] {
  if (segments.length === 0) return [];

  const maxGapMs = Math.max(1000, frameIntervalMs * 2);
  const result: Array<{ startMs: number; endMs: number; text: string }> = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const text = normalizeText(seg.text);
    if (!text) continue;

    // Lọc nhiễu quá ngắn: thời lượng < 250ms và độ dài <= 2 ký tự (ví dụ: '.', '-', 'a')
    if (seg.endMs - seg.startMs < 250 && text.length <= 2) {
      continue;
    }

    const prev = result[result.length - 1];
    if (!prev) {
      result.push({ ...seg, text });
      continue;
    }

    const gap = seg.startMs - prev.endMs;
    if (gap <= maxGapMs) {
      const match = checkMergeMatch(prev.text, text);
      if (match.matched) {
        // Gộp vào dòng trước đó
        prev.endMs = Math.max(prev.endMs, seg.endMs);
        if (match.bestText && match.bestText.length >= prev.text.length) {
          prev.text = match.bestText;
        }
        continue;
      }
    }

    result.push({ ...seg, text });
  }

  // Đảm bảo không chồng timestamp lên nhau
  for (let i = 0; i < result.length - 1; i++) {
    if (result[i].endMs > result[i + 1].startMs) {
      result[i].endMs = result[i + 1].startMs;
    }
  }

  return result.map((s, index) => ({
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

/**
 * Bỏ dòng "lớp phủ tĩnh" ở 1/4 TRÊN khung: watermark/logo/tên kênh in cố định
 * xuất hiện từ đầu đến cuối video. Chỉ áp dụng cho vùng y < 25% chiều cao —
 * phụ đề (dù đứng yên suốt video) nằm ở vùng dưới không bao giờ bị đụng tới.
 * Cần biết height video (ffprobe); height = 0 thì bỏ qua lọc.
 */
export function filterPersistentTopLines(
  frames: OcrFrameResult[],
  frameIntervalMs: number,
  videoHeight: number,
): OcrFrameResult[] {
  if (!videoHeight || frames.length === 0) return frames;
  const topLimit = videoHeight * 0.25;
  const totalMs = frames.length * frameIntervalMs;
  if (totalMs <= 0) return frames;

  // Band = nhóm dòng theo y0 (bucket 64px) — watermark OCR chênh vài px giữa các khung
  const bandKeyOf = (y0: number) => Math.round(y0 / 64);
  const firstSeen = new Map<number, number>();
  const lastSeen = new Map<number, number>();
  frames.forEach((f, i) => {
    const t = i * frameIntervalMs;
    for (const line of f.lines) {
      if (line.y0 < 0 || line.y0 >= topLimit) continue;
      const band = bandKeyOf(line.y0);
      if (!firstSeen.has(band)) firstSeen.set(band, t);
      lastSeen.set(band, t);
    }
  });

  // Band bị coi là lớp phủ tĩnh nếu xuất hiện cả ở 25% đầu và 25% cuối video
  // (watermark có thể bị OCR bỏ sót vài khung — cửa sổ 10% là hụt)
  const staticBands = new Set<number>();
  for (const [band, first] of firstSeen) {
    const last = lastSeen.get(band) ?? first;
    if (first <= totalMs * 0.25 && last >= totalMs * 0.75) staticBands.add(band);
  }
  if (staticBands.size === 0) return frames;

  return frames.map((f) => {
    const kept = f.lines.filter(
      (l) => !(l.y0 >= 0 && l.y0 < topLimit && staticBands.has(bandKeyOf(l.y0))),
    );
    if (kept.length === f.lines.length) return f;
    if (kept.length === 0) return { text: '', confidence: 0, lines: [] };
    return {
      text: kept.map((l) => l.text).join(' '),
      confidence: kept.reduce((s, l) => s + l.confidence, 0) / kept.length,
      lines: kept,
    };
  });
}

function isUsableText(text: string, confidence: number): boolean {
  if (!text) return false;
  if (confidence < MIN_CONFIDENCE) return false;
  return true;
}

/** Khóa so sánh khi gộp khung: bỏ space/dấu câu, lowercase — chỉ còn "chữ cái" */
function mergeKey(text: string): string {
  return text
    .replace(/[\s.,!?;:、。，！？…·'"“”‘’()（）[\]{}<>《》—–\-]+/g, '')
    .toLowerCase();
}

export interface MergeMatch {
  matched: boolean;
  bestText?: string;
}

/**
 * Kiểm tra xem hai đoạn text có nên gộp thành cùng một dòng phụ đề không:
 * 1. Giống hệt nhau (sau khi chuẩn hoá bỏ dấu/khoảng trắng).
 * 2. Phụ đề tích lũy dạng karaoke (chuỗi này là tiền tố bắt đầu của chuỗi kia).
 * 3. Sai số ký tự nhỏ do OCR nhiễu (Levenshtein thích ứng theo độ dài và ngôn ngữ).
 */
export function checkMergeMatch(a: string, b: string): MergeMatch {
  if (a === b) return { matched: true, bestText: a };
  const ka = mergeKey(a);
  const kb = mergeKey(b);
  if (!ka || !kb) return { matched: false };

  // Trùng khớp hoàn toàn sau chuẩn hoá
  if (ka === kb) {
    return { matched: true, bestText: b.length >= a.length ? b : a };
  }

  // 1. Phụ đề tích lũy (Cumulative / Karaoke text):
  // Một chuỗi là tiền tố của chuỗi kia (tối thiểu 3 ký tự)
  if (ka.length >= 3 && kb.length >= 3) {
    if (kb.startsWith(ka)) {
      return { matched: true, bestText: b };
    }
    if (ka.startsWith(kb)) {
      return { matched: true, bestText: a };
    }
  }

  // 2. Kiểm tra ngôn ngữ CJK:
  const isCjk = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(ka);
  if (isCjk) {
    // Với chữ Hán/Nhật: mỗi ký tự là một từ, chỉ cho phép sai khác 1 ký tự khi câu đủ dài (>= 10 ký tự)
    if (ka.length >= 10 && kb.length >= 10 && levenshteinWithin(ka, kb, 1)) {
      return { matched: true, bestText: b.length >= a.length ? b : a };
    }
    return { matched: false };
  }

  // 3. Với chữ Latin (Tiếng Việt, Anh):
  // Sai lệch 1-2 ký tự do dấu thanh, nhầm l/1, o/0
  const maxLen = Math.max(ka.length, kb.length);
  const minLen = Math.min(ka.length, kb.length);
  const lenDiff = maxLen - minLen;

  if (minLen >= 4 && lenDiff <= 2) {
    const maxDist = maxLen >= 12 ? 2 : 1;
    if (levenshteinWithin(ka, kb, maxDist)) {
      return { matched: true, bestText: b.length >= a.length ? b : a };
    }
  }

  return { matched: false };
}

export function isSimilarMerge(a: string, b: string): boolean {
  return checkMergeMatch(a, b).matched;
}

/** Levenshtein với giới hạn — vượt maxDist trả false sớm, không tính hết */
function levenshteinWithin(a: string, b: string, maxDist: number): boolean {
  if (Math.abs(a.length - b.length) > maxDist) return false;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    // Cả hàng đều vượt ngưỡng → không bao giờ hội tụ về <= maxDist
    if (rowMin > maxDist) return false;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] <= maxDist;
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
