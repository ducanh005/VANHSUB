import type { SrtLine } from '../lib/srt';

export interface HybridFusionOptions {
  /**
   * Cửa sổ thời gian tìm kiếm ứng viên Whisper xung quanh phân đoạn OCR.
   * [startMs - toleranceMs, endMs + toleranceMs]. Mặc định: 800ms.
   */
  toleranceMs?: number;

  /**
   * Ngưỡng độ tương đồng tối thiểu để xác định OCR segment có khớp với lời thoại Whisper.
   * Dưới ngưỡng này segment được bảo toàn nguyên vẹn dưới dạng banner đồ họa. Mặc định: 0.35.
   */
  minSimilarityThreshold?: number;

  /**
   * Tùy chọn sử dụng Gemini AI để làm mượt văn bản bổ sung (khi có API key). Mặc định: false.
   */
  useGeminiAi?: boolean;
  geminiApiKey?: string;
}

export interface HybridFusionStats {
  totalOcrSegments: number;
  totalWhisperSegments: number;
  matchedSegments: number;
  bannersPreserved: number;
  typosRepaired: number;
  diacriticsRestored: number;
  wordsRestored: number;
  aiAssisted?: boolean;
}

export interface HybridFusionResult {
  segments: SrtLine[];
  stats: HybridFusionStats;
}

// =========================================================================
// TIỆN ÍCH XỬ LÝ NGỮ ÂM & QUANG HỌC TIẾNG VIỆT
// =========================================================================

const VIETNAMESE_NUMBERS: Record<string, string> = {
  '0': 'không',
  '1': 'một',
  '2': 'hai',
  '3': 'ba',
  '4': 'bốn',
  '5': 'năm',
  '6': 'sáu',
  '7': 'bảy',
  '8': 'tám',
  '9': 'chín',
  '10': 'mười',
};

/**
 * Xóa dấu tiếng Việt (chuẩn hóa về ký tự ASCII không dấu).
 */
export function stripVietnameseDiacritics(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (m) => (m === 'Đ' ? 'D' : 'd'));
}

/**
 * Chuẩn hóa các ký tự quang học thường bị OCR nhận diện nhầm:
 * - Số 0 và chữ O/o
 * - Số 1 và chữ l, I, i, |
 * - Số 5 và chữ S/s
 * - Số 8 và chữ B
 * - 'vv' và 'w'
 * - 'rn' và 'm'
 * - 'cl' và 'd'
 */
export function normalizeOpticalConfusions(str: string): string {
  return str
    .replace(/[0oO]/g, 'o')
    .replace(/[1l|I]/g, 'l')
    .replace(/[5sS]/g, 's')
    .replace(/[8bB]/g, 'b')
    .replace(/vv/gi, 'w')
    .replace(/rn/gi, 'm')
    .replace(/cl/gi, 'd');
}

/**
 * Tách từ thành các token, loại bỏ dấu câu ngoại vi nhưng lưu lại để phục hồi.
 */
export function cleanPunctuation(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Tính khoảng cách Levenshtein giữa 2 chuỗi.
 */
export function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // xóa
        dp[i][j - 1] + 1, // chèn
        dp[i - 1][j - 1] + cost // thay thế
      );
    }
  }
  return dp[m][n];
}

/**
 * Độ tương đồng Levenshtein từ 0.0 đến 1.0.
 */
export function stringSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  return 1.0 - levenshteinDistance(s1, s2) / maxLen;
}

export type WordMatchType = 'exact' | 'diacritic' | 'optical' | 'numWord' | 'fuzzy' | 'none';

export interface WordMatchEvaluation {
  score: number;
  type: WordMatchType;
}

/**
 * So sánh 2 từ đơn lẻ giữa OCR và Whisper:
 * Đánh giá xem từ Whisper có phải là bản sửa lỗi chính tả / dấu / quang học của từ OCR không.
 */
export function evaluateWordMatch(ocrWordRaw: string, whisperWordRaw: string): WordMatchEvaluation {
  const ocrClean = cleanPunctuation(ocrWordRaw).toLowerCase();
  const whisperClean = cleanPunctuation(whisperWordRaw).toLowerCase();

  if (!ocrClean || !whisperClean) {
    return { score: 0, type: 'none' };
  }

  // 1. Khớp chính xác hoàn toàn
  if (ocrClean === whisperClean) {
    return { score: 1.0, type: 'exact' };
  }

  // 2. Đối chiếu số và chữ tiếng Việt (ví dụ OCR: '1', Whisper: 'một')
  if (VIETNAMESE_NUMBERS[ocrClean] === whisperClean || VIETNAMESE_NUMBERS[whisperClean] === ocrClean) {
    return { score: 0.95, type: 'numWord' };
  }

  // 3. Khớp sau khi xóa dấu tiếng Việt (lỗi OCR mất dấu hoặc gõ sai dấu)
  const ocrNoAccents = stripVietnameseDiacritics(ocrClean);
  const whisperNoAccents = stripVietnameseDiacritics(whisperClean);
  if (ocrNoAccents === whisperNoAccents) {
    return { score: 0.95, type: 'diacritic' };
  }

  // 3.1. Khớp biến thể nguyên âm i/y trong tiếng Việt (ví dụ ki vs kỹ/kỳ, hi vs hy, lí vs lý)
  const ocrIY = ocrNoAccents.replace(/y/g, 'i');
  const whisperIY = whisperNoAccents.replace(/y/g, 'i');
  if (ocrIY === whisperIY) {
    return { score: 0.94, type: 'diacritic' };
  }

  // 4. Khớp sau khi chuẩn hóa nhầm lẫn ký tự quang học (ví dụ 2O26 vs 2026, 1àm vs làm)
  const ocrOptical = normalizeOpticalConfusions(ocrNoAccents);
  const whisperOptical = normalizeOpticalConfusions(whisperNoAccents);
  if (ocrOptical === whisperOptical) {
    return { score: 0.92, type: 'optical' };
  }

  // 5. Khoảng cách Levenshtein nhỏ trên chuỗi đã xóa dấu
  const sim = stringSimilarity(ocrNoAccents, whisperNoAccents);
  if (sim >= 0.65) {
    return { score: sim * 0.88, type: 'fuzzy' };
  }

  // Thử nghiệm thêm khoảng cách Levenshtein trên chuỗi quang học
  const opticalSim = stringSimilarity(ocrOptical, whisperOptical);
  if (opticalSim >= 0.7) {
    return { score: opticalSim * 0.85, type: 'optical' };
  }

  return { score: 0, type: 'none' };
}

// =========================================================================
// THUẬT TOÁN ĐỐI CHIẾU DÃY TOKEN (TOKEN SEQUENCE ALIGNMENT)
// =========================================================================

interface AlignmentStep {
  ocrIdx: number; // -1 nếu chèn từ Whisper
  whisperIdx: number; // -1 nếu bỏ sót từ Whisper
  matchType: WordMatchType;
}

/**
 * Thuật toán Quy hoạch động tìm phân đoạn con Whisper khớp nhất với danh sách token OCR.
 * Cho phép Whisper chứa nhiều từ hơn OCR (local sequence alignment).
 */
export function alignTokens(
  ocrTokens: string[],
  whisperTokens: string[]
): {
  steps: AlignmentStep[];
  averageScore: number;
} {
  const M = ocrTokens.length;
  const N = whisperTokens.length;

  if (M === 0 || N === 0) {
    return { steps: [], averageScore: 0 };
  }

  // Bảng DP: dp[i][j] = điểm cao nhất khi so khớp ocr[0..i-1] với whisper[0..j-1]
  // Khởi tạo hàng 0 = 0 cho phép điểm bắt đầu của Whisper linh hoạt (local alignment).
  const dp: number[][] = Array.from({ length: M + 1 }, () => new Array(N + 1).fill(0));
  const backtrack: Array<Array<{ pi: number; pj: number; type: WordMatchType }>> = Array.from(
    { length: M + 1 },
    () => Array.from({ length: N + 1 }, () => ({ pi: 0, pj: 0, type: 'none' }))
  );

  for (let i = 1; i <= M; i++) {
    dp[i][0] = -i * 0.6; // phạt khi OCR không tìm thấy từ trong Whisper
    backtrack[i][0] = { pi: i - 1, pj: 0, type: 'none' };
  }

  for (let i = 1; i <= M; i++) {
    for (let j = 1; j <= N; j++) {
      const evalRes = evaluateWordMatch(ocrTokens[i - 1], whisperTokens[j - 1]);
      const matchScore = evalRes.score > 0 ? evalRes.score * 1.5 : -1.2;

      // 3 hướng chuyển trạng thái:
      // 1. Khớp từ
      const scoreMatch = dp[i - 1][j - 1] + matchScore;
      // 2. Bỏ qua từ OCR (từ trong OCR không có trong Whisper)
      const scoreDeleteOcr = dp[i - 1][j] - 0.6;
      // 3. Chèn từ Whisper (từ được nói trong Whisper nhưng OCR bỏ sót)
      const scoreInsertWhisper = dp[i][j - 1] - 0.35;

      let bestScore = scoreMatch;
      let bestStep = { pi: i - 1, pj: j - 1, type: evalRes.type };

      if (scoreDeleteOcr > bestScore) {
        bestScore = scoreDeleteOcr;
        bestStep = { pi: i - 1, pj: j, type: 'none' };
      }
      if (scoreInsertWhisper > bestScore) {
        bestScore = scoreInsertWhisper;
        bestStep = { pi: i, pj: j - 1, type: 'none' };
      }

      dp[i][j] = bestScore;
      backtrack[i][j] = bestStep;
    }
  }

  // Tìm vị trí kết thúc tối ưu trong hàng cuối cùng M
  let bestEndJ = N;
  let maxFinalScore = -Infinity;
  for (let j = 1; j <= N; j++) {
    if (dp[M][j] > maxFinalScore) {
      maxFinalScore = dp[M][j];
      bestEndJ = j;
    }
  }

  // Truy vết ngược lại đường đi tối ưu
  const rawSteps: AlignmentStep[] = [];
  let currI = M;
  let currJ = bestEndJ;

  while (currI > 0 || currJ > 0) {
    if (currI === 0 && currJ === 0) break;
    const step = backtrack[currI][currJ];
    if (step.pi === currI - 1 && step.pj === currJ - 1) {
      rawSteps.push({ ocrIdx: currI - 1, whisperIdx: currJ - 1, matchType: step.type });
    } else if (step.pi === currI - 1 && step.pj === currJ) {
      rawSteps.push({ ocrIdx: currI - 1, whisperIdx: -1, matchType: 'none' });
    } else if (step.pi === currI && step.pj === currJ - 1) {
      rawSteps.push({ ocrIdx: -1, whisperIdx: currJ - 1, matchType: 'none' });
    } else {
      break;
    }
    currI = step.pi;
    currJ = step.pj;
  }

  rawSteps.reverse();

  // Tính điểm tương đồng trung bình trên các từ của OCR
  let matchedScoresSum = 0;
  for (const step of rawSteps) {
    if (step.ocrIdx >= 0 && step.whisperIdx >= 0 && step.matchType !== 'none') {
      const evalRes = evaluateWordMatch(ocrTokens[step.ocrIdx], whisperTokens[step.whisperIdx]);
      matchedScoresSum += evalRes.score;
    }
  }
  const averageScore = M > 0 ? matchedScoresSum / M : 0;

  return { steps: rawSteps, averageScore };
}

// =========================================================================
// CROSS-MODAL FUSION CORE ENGINE
// =========================================================================

/**
 * Hợp nhất dữ liệu phụ đề giữa Quét OCR và Phiên âm Whisper ASR:
 * 1. Neo mốc thời gian startMs, endMs 100% THEO OCR (khớp tuyệt đối từng khung hình video).
 * 2. Đối chiếu các đoạn văn bản Whisper trong cửa sổ [startMs - 800ms, endMs + 800ms].
 * 3. Sửa lỗi chính tả quang học (1/l, 0/O), phục hồi dấu tiếng Việt và bổ sung từ bị khuất.
 * 4. Bảo toàn nguyên vẹn các banner đồ họa / chữ trên màn hình không có tiếng nói.
 */
export function fuseOcrAndWhisper(
  ocrSegments: SrtLine[],
  whisperSegments: SrtLine[],
  options?: HybridFusionOptions
): HybridFusionResult {
  const toleranceMs = Math.max(0, options?.toleranceMs ?? 800);
  const minSimilarityThreshold = options?.minSimilarityThreshold ?? 0.35;

  const stats: HybridFusionStats = {
    totalOcrSegments: ocrSegments.length,
    totalWhisperSegments: whisperSegments.length,
    matchedSegments: 0,
    bannersPreserved: 0,
    typosRepaired: 0,
    diacriticsRestored: 0,
    wordsRestored: 0,
  };

  if (!ocrSegments || ocrSegments.length === 0) {
    return { segments: [], stats };
  }

  // Trường hợp Whisper rỗng: bảo toàn 100% các dòng OCR như banner hình ảnh
  if (!whisperSegments || whisperSegments.length === 0) {
    stats.bannersPreserved = ocrSegments.length;
    const cloned = ocrSegments.map((line, idx) => ({
      id: line.id || `line-${idx}`,
      startMs: line.startMs,
      endMs: line.endMs,
      text: line.text,
      confidence: line.confidence,
    }));
    return { segments: cloned, stats };
  }

  const resultSegments: SrtLine[] = [];

  for (let idx = 0; idx < ocrSegments.length; idx++) {
    const ocr = ocrSegments[idx];

    // QUY TẮC BẤT DI BẤT DỊCH: Neo thời gian 100% khớp mốc OCR
    const anchoredStartMs = ocr.startMs;
    const anchoredEndMs = ocr.endMs;

    // Tìm các ứng viên Whisper trong cửa sổ thời gian [ocr.startMs - toleranceMs, ocr.endMs + toleranceMs]
    const windowStart = anchoredStartMs - toleranceMs;
    const windowEnd = anchoredEndMs + toleranceMs;

    const candidates = whisperSegments.filter(
      (w) => w.endMs >= windowStart && w.startMs <= windowEnd
    );

    // Không có ứng viên Whisper nào trong khung thời gian -> Banner video tĩnh
    if (candidates.length === 0) {
      stats.bannersPreserved++;
      resultSegments.push({
        id: ocr.id || `line-${idx}`,
        startMs: anchoredStartMs,
        endMs: anchoredEndMs,
        text: ocr.text,
        confidence: ocr.confidence,
      });
      continue;
    }

    // Tách từ từ OCR
    const ocrWords = ocr.text.trim().split(/\s+/).filter(Boolean);
    if (ocrWords.length === 0) {
      resultSegments.push({
        id: ocr.id || `line-${idx}`,
        startMs: anchoredStartMs,
        endMs: anchoredEndMs,
        text: ocr.text,
      });
      continue;
    }

    // Gom toàn bộ token Whisper từ các ứng viên trong cửa sổ
    const candidateWhisperTokens: string[] = [];
    for (const c of candidates) {
      const words = c.text.trim().split(/\s+/).filter(Boolean);
      candidateWhisperTokens.push(...words);
    }

    // So khớp chuỗi token
    const { steps, averageScore } = alignTokens(ocrWords, candidateWhisperTokens);

    // Nếu độ tương đồng quá thấp (< minSimilarityThreshold), xác định là banner hình ảnh không khớp tiếng
    if (averageScore < minSimilarityThreshold) {
      stats.bannersPreserved++;
      resultSegments.push({
        id: ocr.id || `line-${idx}`,
        startMs: anchoredStartMs,
        endMs: anchoredEndMs,
        text: ocr.text,
        confidence: ocr.confidence,
      });
      continue;
    }

    // Có sự tương đồng tốt -> Hợp nhất nội dung & sửa lỗi văn bản
    stats.matchedSegments++;
    const repairedTokens: string[] = [];
    let segmentTypos = 0;
    let segmentDiacritics = 0;
    let segmentWordsRestored = 0;

    for (const step of steps) {
      if (step.ocrIdx >= 0 && step.whisperIdx >= 0) {
        const ocrW = ocrWords[step.ocrIdx];
        const whisperW = candidateWhisperTokens[step.whisperIdx];

        if (step.matchType === 'exact') {
          // Giữ từ gốc (bảo toàn chữ hoa/thường ban đầu)
          repairedTokens.push(ocrW);
        } else if (step.matchType === 'diacritic') {
          // Phục hồi dấu tiếng Việt từ giọng nói Whisper
          repairedTokens.push(whisperW);
          segmentDiacritics++;
        } else if (step.matchType === 'optical' || step.matchType === 'fuzzy' || step.matchType === 'numWord') {
          // Sửa lỗi quang học (1/l, 0/O, 1 -> một)
          repairedTokens.push(whisperW);
          segmentTypos++;
        } else {
          // Fallback giữ từ OCR
          repairedTokens.push(ocrW);
        }
      } else if (step.ocrIdx === -1 && step.whisperIdx >= 0) {
        // Từ có trong lời thoại Whisper nhưng bị khuất/bỏ sót trong OCR -> Bổ sung vào câu!
        const restoredW = candidateWhisperTokens[step.whisperIdx];
        repairedTokens.push(restoredW);
        segmentWordsRestored++;
      } else if (step.ocrIdx >= 0 && step.whisperIdx === -1) {
        // Từ có trong OCR nhưng không có trong Whisper -> Giữ từ OCR
        repairedTokens.push(ocrWords[step.ocrIdx]);
      }
    }

    stats.typosRepaired += segmentTypos;
    stats.diacriticsRestored += segmentDiacritics;
    stats.wordsRestored += segmentWordsRestored;

    let repairedText = repairedTokens.join(' ').trim();
    if (!repairedText) repairedText = ocr.text;

    // Giữ viết hoa chữ cái đầu câu nếu ban đầu viết hoa
    if (ocr.text.trim().length > 0 && /^\p{Lu}/u.test(ocr.text.trim())) {
      repairedText = repairedText.charAt(0).toUpperCase() + repairedText.slice(1);
    }

    resultSegments.push({
      id: ocr.id || `line-${idx}`,
      startMs: anchoredStartMs,
      endMs: anchoredEndMs,
      text: repairedText,
      confidence: Math.max(ocr.confidence || 0, 0.95), // Được ASR củng cố độ tin cậy
    });
  }

  return {
    segments: resultSegments,
    stats,
  };
}
