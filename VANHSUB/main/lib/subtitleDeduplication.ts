import type { SrtLine } from './srt';

export interface DedupOptions {
  /**
   * Khoảng cách tối đa (mili-giây) giữa 2 dòng để được coi là liên tiếp.
   * Mặc định: 1200ms.
   */
  maxGapMs?: number;

  /**
   * Ngưỡng dung sai Levenshtein khi so khớp tiền tố phụ đề hiện dần (karaoke).
   * Mặc định: 1.
   */
  levenshteinThreshold?: number;
}

/**
 * Chuẩn hóa chuỗi văn bản: trim khoảng trắng, chuẩn hóa khoảng trắng bên trong thành 1 space, NFC unicode.
 */
export function normalizeText(text: string): string {
  return (text || '').trim().replace(/\s+/g, ' ').normalize('NFC');
}

/**
 * Xóa dấu câu và ký hiệu ở biên (đầu và cuối chuỗi) để so sánh nội dung lặp lỏng.
 */
export function stripEdgePunctuation(text: string): string {
  return (text || '').replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');
}

/**
 * Xóa dấu thanh tiếng Việt (chuẩn hóa về ASCII không dấu).
 */
export function stripVietnameseDiacritics(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (m) => (m === 'Đ' ? 'D' : 'd'));
}

/**
 * Đếm số lượng dấu thanh và ký tự đặc thù tiếng Việt (đ/Đ, dấu phụ).
 */
export function countDiacritics(text: string): number {
  if (!text) return 0;
  const nfd = text.normalize('NFD');
  const marks = (nfd.match(/[\u0300-\u036f]/g) || []).length;
  const dMarks = (text.match(/[đĐ]/g) || []).length;
  return marks + dMarks;
}

/**
 * Tính khoảng cách Levenshtein giữa 2 chuỗi ký tự.
 */
export function levenshteinDistance(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix: number[][] = [];
  for (let i = 0; i <= bn; i++) matrix[i] = [i];
  for (let j = 0; j <= an; j++) matrix[0][j] = j;

  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[bn][an];
}

/**
 * Khử trùng lặp nguyên văn liên tiếp (Requirement R3 - Exact Duplicates):
 * - Sắp xếp theo startMs.
 * - Chuẩn hóa text (case-insensitive, trims, punctuation normalization).
 * - Gộp các dòng liên tiếp có nội dung giống nhau hoặc biến thể không dấu:
 *   startMs = first.startMs, endMs = last.endMs, giữ bản có nhiều dấu thanh hơn.
 * - Giới hạn an toàn: không gộp qua khoảng cách > maxGapMs (mặc định 1200ms) hoặc khoảng lặng > 1500ms.
 */
export function deduplicateExact(lines: SrtLine[], options?: DedupOptions): SrtLine[] {
  if (!lines || lines.length === 0) return [];

  const maxGapMs = options?.maxGapMs ?? 1200;

  // Sắp xếp thứ tự thời gian trước khi khử lặp
  const sorted = [...lines].sort((a, b) => a.startMs - b.startMs);
  const result: SrtLine[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    if (result.length === 0) {
      result.push({ ...current });
      continue;
    }

    const prev = result[result.length - 1];
    const normCur = stripEdgePunctuation(normalizeText(current.text)).toLowerCase();
    const normPrev = stripEdgePunctuation(normalizeText(prev.text)).toLowerCase();
    const stripCur = stripVietnameseDiacritics(normCur);
    const stripPrev = stripVietnameseDiacritics(normPrev);
    const gap = current.startMs - prev.endMs;

    const isExactMatch = normCur === normPrev;
    const isDiacriticVariant = stripCur === stripPrev && stripCur.length > 0;

    // So khớp nội dung nguyên văn hoặc biến thể không dấu trong ngưỡng maxGapMs và ngưỡng khoảng lặng đứt đoạn 1500ms
    if ((isExactMatch || isDiacriticVariant) && gap <= maxGapMs && gap <= 1500) {
      // Gộp: giữ startMs của dòng đầu, cập nhật endMs theo dòng sau
      const curDiacritics = countDiacritics(current.text);
      const prevDiacritics = countDiacritics(prev.text);
      // Giữ phiên bản có nhiều dấu thanh hơn hoặc độ dài dài hơn
      if (
        curDiacritics > prevDiacritics ||
        (curDiacritics === prevDiacritics && (current.text || '').length > (prev.text || '').length)
      ) {
        prev.text = current.text;
      }
      prev.endMs = Math.max(prev.endMs, current.endMs);
    } else {
      result.push({ ...current });
    }
  }

  return result;
}

/**
 * Khử trùng lặp kiểu Karaoke / Chữ hiện dần (Requirement R3 - Progressive Overlap):
 * - Phát hiện chuỗi dòng mở rộng theo từng khung hình:
 *   Line 1: "chụp ảnh được"
 *   Line 2: "chụp ảnh được, livestream được"
 *   Line 3: "chụp ảnh được, livestream được, tái hiện lại..."
 * - Đối chiếu tiền tố từ vựng (Token prefix), tiền tố chuẩn hoá (Normalized prefix),
 *   kèm dung sai Levenshtein thích ứng chống lỗi OCR quang học.
 * - Lan truyền chuỗi (Chain propagation): gom toàn bộ tiến trình thành 1 câu duy nhất.
 * - Gán startMs = thời điểm từ đầu tiên xuất hiện (first.startMs),
 *   endMs = thời điểm câu hoàn chỉnh kết thúc (Math.max(...endMs)).
 */
export function deduplicateProgressiveKaraoke(
  lines: SrtLine[],
  options?: DedupOptions
): SrtLine[] {
  if (!lines || lines.length === 0) return [];

  const maxGapMs = options?.maxGapMs ?? 1200;
  const levenshteinThreshold = options?.levenshteinThreshold ?? 1;

  const sorted = [...lines].sort((a, b) => a.startMs - b.startMs);
  const result: SrtLine[] = [];

  const cleanTrailingPunct = (s: string) => s.replace(/[\p{P}\p{S}\s]+$/gu, '').trim();
  const cleanAllPunct = (s: string) =>
    (s || '').replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();

  let i = 0;
  while (i < sorted.length) {
    const currentChain = [sorted[i]];
    let j = i + 1;

    while (j < sorted.length) {
      const prevLine = currentChain[currentChain.length - 1];
      const nextLine = sorted[j];
      const gap = nextLine.startMs - prevLine.endMs;

      // Không gộp qua khoảng cách lớn hơn maxGapMs
      if (gap > maxGapMs) {
        break;
      }

      const prevNorm = normalizeText(prevLine.text).toLowerCase();
      const nextNorm = normalizeText(nextLine.text).toLowerCase();

      const prevStripped = stripVietnameseDiacritics(prevNorm);
      const nextStripped = stripVietnameseDiacritics(nextNorm);

      const prevClean = cleanTrailingPunct(prevNorm);
      const nextClean = cleanTrailingPunct(nextNorm);

      const prevStrippedClean = cleanTrailingPunct(prevStripped);
      const nextStrippedClean = cleanTrailingPunct(nextStripped);

      const prevWordsClean = cleanAllPunct(prevStripped);
      const nextWordsClean = cleanAllPunct(nextStripped);

      const prevWords = prevWordsClean.split(/\s+/).filter(Boolean);
      const nextWords = nextWordsClean.split(/\s+/).filter(Boolean);

      // 1. Kiểm tra tiền tố trực tiếp (nguyên văn hoặc không dấu)
      const isDirectPrefix =
        nextNorm.startsWith(prevNorm) ||
        nextStripped.startsWith(prevStripped) ||
        (prevClean.length >= 2 && nextClean.startsWith(prevClean)) ||
        (prevStrippedClean.length >= 2 && nextStrippedClean.startsWith(prevStrippedClean));

      // 2. Kiểm tra tiền tố không phụ thuộc dấu câu nội dòng (Punctuation-agnostic string prefix)
      const isPunctAgnosticPrefix =
        prevWordsClean.length >= 2 &&
        (nextWordsClean.startsWith(prevWordsClean + ' ') ||
          nextWordsClean === prevWordsClean ||
          nextWordsClean.startsWith(prevWordsClean));

      // 3. Kiểm tra mảng token từ vựng (Word tokens prefix)
      const isTokenPrefix =
        prevWords.length > 0 &&
        prevWords.length <= nextWords.length &&
        prevWords.every((w, idx) => {
          if (idx < prevWords.length - 1) {
            return w === nextWords[idx];
          }
          return w === nextWords[idx] || (w.length >= 2 && nextWords[idx]?.startsWith(w));
        });

      // 4. Kiểm tra tiền tố mờ với sai số Levenshtein (chống lỗi OCR mất dấu/nhảy 1 ký tự ở frame đầu)
      const isFuzzyPrefix =
        !isDirectPrefix &&
        !isPunctAgnosticPrefix &&
        !isTokenPrefix &&
        prevStrippedClean.length >= 4 &&
        levenshteinDistance(
          prevStrippedClean,
          nextStrippedClean.slice(0, prevStrippedClean.length)
        ) <= levenshteinThreshold;

      const isFuzzyWordsPrefix =
        !isDirectPrefix &&
        !isPunctAgnosticPrefix &&
        !isTokenPrefix &&
        !isFuzzyPrefix &&
        prevWordsClean.length >= 4 &&
        levenshteinDistance(
          prevWordsClean,
          nextWordsClean.slice(0, prevWordsClean.length)
        ) <= levenshteinThreshold;

      const isPrefix =
        isDirectPrefix ||
        isPunctAgnosticPrefix ||
        isTokenPrefix ||
        isFuzzyPrefix ||
        isFuzzyWordsPrefix;

      // 5. Điều kiện tiến triển:
      // a) Chuỗi sau mở rộng dài hơn chuỗi trước (Progressive expansion)
      const isLengthExpansion =
        nextWords.length > prevWords.length ||
        nextWordsClean.length > prevWordsClean.length ||
        nextClean.length > prevClean.length ||
        nextNorm.length > prevNorm.length;

      // b) Hoặc chuỗi sau có độ dài tương đương nhưng là biến thể hoàn thiện dấu / sửa lỗi OCR
      const isEqualLengthDiacriticVariant =
        stripVietnameseDiacritics(nextClean) === stripVietnameseDiacritics(prevClean) ||
        prevWordsClean === nextWordsClean;

      const isProgressiveExtension =
        isPrefix && (isLengthExpansion || isEqualLengthDiacriticVariant);

      if (isProgressiveExtension) {
        currentChain.push(nextLine);
        j++;
      } else {
        break;
      }
    }

    if (currentChain.length > 1) {
      // Thu gọn chuỗi tiến trình: lấy startMs của phần tử đầu, endMs lớn nhất của chuỗi, câu hoàn chỉnh đầy đủ nhất
      const first = currentChain[0];
      const last = currentChain[currentChain.length - 1];

      let bestLine = last;
      for (const item of currentChain) {
        const itemLen = (item.text || '').length;
        const bestLen = (bestLine.text || '').length;
        const itemDiacritics = countDiacritics(item.text);
        const bestDiacritics = countDiacritics(bestLine.text);

        if (
          itemLen > bestLen ||
          (itemLen === bestLen && itemDiacritics > bestDiacritics)
        ) {
          bestLine = item;
        }
      }

      result.push({
        ...bestLine,
        id: first.id,
        startMs: first.startMs,
        endMs: Math.max(...currentChain.map((c) => c.endMs)),
        text: bestLine.text,
      });
      i = j;
    } else {
      result.push({ ...sorted[i] });
      i++;
    }
  }

  return result;
}

/**
 * Trợ giúp căn chỉnh các từ từ văn bản OCR với phân đoạn tương ứng từ Whisper
 * để phục hồi dấu tiếng Việt và ngữ pháp chuẩn mà không làm nhân bản toàn câu Whisper.
 */
export function alignOcrToWhisperText(ocrText: string, whisperText: string): string {
  const ocrWords = (ocrText || '').trim().split(/\s+/).filter(Boolean);
  const whWords = (whisperText || '').trim().split(/\s+/).filter(Boolean);
  if (ocrWords.length === 0) return whisperText;
  if (whWords.length === 0) return ocrText;

  const stripWord = (w: string) =>
    stripVietnameseDiacritics(w)
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      .toLowerCase();

  const ocrClean = ocrWords.map(stripWord);
  const whClean = whWords.map(stripWord);

  let bestStart = 0;
  let bestMatches = -1;

  const maxStart = Math.max(0, whClean.length - ocrClean.length);
  for (let k = 0; k <= maxStart; k++) {
    let matches = 0;
    for (let m = 0; m < ocrClean.length; m++) {
      if (whClean[k + m] === ocrClean[m]) {
        matches++;
      }
    }
    if (matches > bestMatches) {
      bestMatches = matches;
      bestStart = k;
    }
  }

  // Nếu ít nhất một nửa số từ khớp với phân đoạn trong Whisper, trích xuất phân đoạn từ Whisper
  if (bestMatches >= Math.ceil(ocrClean.length / 2)) {
    const sliceWords = whWords.slice(bestStart, bestStart + ocrClean.length);
    if (sliceWords.length > 0) {
      let resultText = sliceWords.join(' ');
      // Nếu OCR ban đầu không kết thúc bằng dấu phẩy/chấm phẩy, xóa dấu phẩy/chấm phẩy dư ở cuối lát cắt
      if (!/[,;]$/.test(ocrText.trim())) {
        resultText = resultText.replace(/[,;\s]+$/, '');
      }
      return resultText;
    }
  }

  return ocrText;
}

/**
 * Khử trùng lặp chéo giữa Whisper và OCR (Requirement R3 - Cross-Modal Deduplication):
 * 1. Tiền xử lý đơn luồng: khử lặp progressive karaoke và exact trên cả hai luồng.
 * 2. Đối chiếu trong cửa sổ thời gian 800ms với độ tương đồng âm vị/token (>= 0.35)
 *    hoặc độ phủ OCR (OCR coverage >= 0.6) chống phạt câu Whisper dài.
 * 3. Hợp nhất: neo thời gian tuyệt đối theo khung OCR, sử dụng văn bản chuẩn xác từ Whisper
 *    (hoặc căn chỉnh token nếu thẻ OCR chỉ đại diện cho một phần câu thoại dài).
 * 4. Bảo toàn các đoạn thoại Whisper độc lập (speech-only segments).
 * 5. Bảo toàn các banner đồ họa tĩnh OCR (graphic banners).
 * 6. Sắp xếp lại timeline theo startMs.
 */
export function deduplicateWhisperOcrCross(
  ocrLines: SrtLine[],
  whisperLines: SrtLine[],
  options?: DedupOptions
): SrtLine[] {
  // Pre-deduplicate cả hai luồng
  const cleanOcr = deduplicateProgressiveKaraoke(
    deduplicateExact(ocrLines, options),
    options
  );
  const cleanWhisper = deduplicateExact(whisperLines, options);

  // Nếu không có OCR -> bảo toàn toàn bộ Whisper thoại
  if (cleanOcr.length === 0) {
    return [...cleanWhisper].sort((a, b) => a.startMs - b.startMs);
  }

  // Nếu không có Whisper -> bảo toàn toàn bộ OCR dưới dạng banner
  if (cleanWhisper.length === 0) {
    return [...cleanOcr].sort((a, b) => a.startMs - b.startMs);
  }

  const toleranceMs = 800;
  const minSimilarityThreshold = 0.35;
  const consumedWhisper = new Set<SrtLine>();
  const fusedSegments: SrtLine[] = [];

  for (const ocr of cleanOcr) {
    let bestMatch: SrtLine | null = null;
    let bestScore = 0;
    let bestOcrCoverage = 0;

    for (const wh of cleanWhisper) {
      // 1. Loại trừ các câu thoại Whisper đã được tiêu thụ (Consumed Whisper Filtering)
      if (consumedWhisper.has(wh)) continue;

      // Kiểm tra cửa sổ dung sai [ocr.startMs - 800ms, ocr.endMs + 800ms]
      const overlaps =
        wh.startMs <= ocr.endMs + toleranceMs &&
        wh.endMs >= ocr.startMs - toleranceMs;
      if (!overlaps) continue;

      // Tính điểm tương đồng token / âm vị học
      const normOcr = stripVietnameseDiacritics((ocr.text || '').toLowerCase());
      const normWh = stripVietnameseDiacritics((wh.text || '').toLowerCase());

      const ocrTokens = new Set(normOcr.split(/\s+/).filter(Boolean));
      const whTokens = normWh.split(/\s+/).filter(Boolean);
      const whTokenSet = new Set(whTokens);

      let ocrMatchCount = 0;
      for (const t of ocrTokens) {
        if (whTokenSet.has(t)) ocrMatchCount++;
      }

      // Độ phủ OCR: tỷ lệ từ của OCR xuất hiện trong Whisper
      const ocrCoverage = ocrMatchCount / (ocrTokens.size || 1);

      // Điểm Sorensen-Dice tiêu chuẩn
      const diceScore = (ocrMatchCount * 2) / (ocrTokens.size + whTokens.length || 1);

      // Điểm hiệu dụng: nếu ocrCoverage >= 0.6 thì công nhận khớp ngay cả khi Whisper dài hơn nhiều
      const score = ocrCoverage >= 0.6 ? Math.max(diceScore, ocrCoverage) : diceScore;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = wh;
        bestOcrCoverage = ocrCoverage;
      }
    }

    if (bestMatch && (bestScore >= minSimilarityThreshold || bestOcrCoverage >= 0.6)) {
      const normWh = stripVietnameseDiacritics((bestMatch.text || '').toLowerCase());
      const whTokens = normWh.split(/\s+/).filter(Boolean);
      const normOcr = stripVietnameseDiacritics((ocr.text || '').toLowerCase());
      const ocrTokens = normOcr.split(/\s+/).filter(Boolean);

      // Nếu thẻ OCR chỉ đại diện cho một phần câu Whisper (e.g. ocrTokens.length < whTokens.length * 0.7)
      const isPartialCard = ocrTokens.length < whTokens.length * 0.7;

      let finalText = bestMatch.text;
      if (isPartialCard) {
        finalText = alignOcrToWhisperText(ocr.text, bestMatch.text);
      }

      // Neo thời gian theo OCR, phục hồi văn bản từ Whisper (hoặc phân đoạn căn chỉnh)
      fusedSegments.push({
        ...ocr,
        text: finalText,
      });
      consumedWhisper.add(bestMatch);
    } else {
      // Banner đồ họa tĩnh trên màn hình (không có âm thanh khớp)
      fusedSegments.push({ ...ocr });
    }
  }

  // Bảo toàn các đoạn thoại Whisper chưa được tiêu thụ (nói vo không có chữ trên hình)
  for (const wh of cleanWhisper) {
    if (!consumedWhisper.has(wh)) {
      fusedSegments.push({ ...wh });
    }
  }

  // Sắp xếp lại toàn bộ dòng phụ đề theo trục thời gian tăng dần
  fusedSegments.sort((a, b) => a.startMs - b.startMs);

  return fusedSegments;
}

/**
 * Pipeline khử trùng lặp toàn diện cho danh sách phụ đề:
 * Thực hiện deduplicateExact sau đó deduplicateProgressiveKaraoke.
 */
export function deduplicateSubtitlesPipeline(
  lines: SrtLine[],
  options?: DedupOptions
): SrtLine[] {
  if (!lines || lines.length === 0) return [];
  const exact = deduplicateExact(lines, options);
  const progressive = deduplicateProgressiveKaraoke(exact, options);
  return progressive;
}
