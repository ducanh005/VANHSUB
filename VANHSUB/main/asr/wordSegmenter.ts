import type { SrtLine, SrtWord } from '../lib/srt';
import { breakVietnameseLines } from '../lib/nlpSegmenter';

export type { SrtLine, SrtWord };

export interface WordSegmenterOptions {
  /** Split short complete sentences when the next word starts a new sentence. */
  splitShortTerminalBeforeCapital?: boolean;
  /** Khoảng lặng tối thiểu giữa hai từ liên tiếp để ngắt phân đoạn (ms). Mặc định 350ms */
  minPauseMs?: number;
  /** Khoảng lặng lớn ngắt vô điều kiện (ms). Mặc định 700ms */
  majorPauseMs?: number;
  /** Thời lượng tối thiểu lý tưởng cho một phân đoạn phụ đề (ms). Mặc định 2000ms (2.0s) */
  idealMinDurationMs?: number;
  /** Thời lượng tối đa lý tưởng cho một phân đoạn phụ đề (ms). Mặc định 5000ms (5.0s) */
  idealMaxDurationMs?: number;
  /** Giới hạn thời lượng trần tuyệt đối (ms). Mặc định 6000ms (6.0s) */
  hardMaxDurationMs?: number;
  /** Số từ tối thiểu để ngắt khi gặp dấu câu kết thúc (. ? !). Mặc định 4 */
  minTerminalWords?: number;
  /** Thời lượng tối thiểu (ms) để ngắt khi gặp dấu câu kết thúc. Mặc định 1500ms */
  minTerminalDurationMs?: number;
  /** Số từ tối thiểu để ngắt khi gặp dấu ngắt vế (, ; :). Mặc định 6 */
  minClauseWords?: number;
  /** Số ký tự CJK tối thiểu để ngắt khi gặp dấu ngắt vế. Mặc định 12 */
  minClauseCjkChars?: number;
  /** Giới hạn ký tự trên một dòng hiển thị (Visual line wrap). Mặc định 37 */
  maxCharsPerLine?: number;
  /** Bật tự động ngắt dòng hiển thị (\n) khi vượt quá maxCharsPerLine. Mặc định true */
  enableVisualWrap?: boolean;
}

const CJK_REGEX = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
const TERMINAL_PUNCT_REGEX = /[.?!。？！…]+$/;
const CLAUSE_PUNCT_REGEX = /[,;:\uff0c\uff1b\uff1a\u3001]+$/;

/** Kiểm tra ký tự có thuộc khối CJK (Trung - Nhật - Hàn) hay không */
export function isCjkChar(char: string): boolean {
  if (!char) return false;
  return CJK_REGEX.test(char);
}

/** Kiểm tra văn bản có chứa ký tự CJK hay không */
export function isCjkText(text: string): boolean {
  if (!text) return false;
  return CJK_REGEX.test(text);
}

/** Kiểm tra từ có kết thúc bằng dấu ngắt câu kết thúc (. ? ! 。 ？ ！ …) */
export function hasTerminalPunctuation(word: string): boolean {
  if (!word) return false;
  const trimmed = word.trim();
  return TERMINAL_PUNCT_REGEX.test(trimmed) || trimmed.endsWith('...');
}

/** Kiểm tra từ có kết thúc bằng dấu ngắt vế (, ; : ， ； ： 、) */
export function hasClausePunctuation(word: string): boolean {
  if (!word) return false;
  const trimmed = word.trim();
  return CLAUSE_PUNCT_REGEX.test(trimmed);
}

/** Đếm số đơn vị nội dung (số từ với Latin/Việt, số ký tự CJK với CJK) */
export function countUnits(words: SrtWord[]): number {
  let count = 0;
  for (const w of words) {
    const text = (w.word || '').trim();
    let cjkCount = 0;
    for (const ch of text) {
      if (isCjkChar(ch)) cjkCount++;
    }
    count += cjkCount > 0 ? cjkCount : 1;
  }
  return count;
}

/**
 * Ghép danh sách từ thành chuỗi văn bản tự nhiên:
 * - Chèn dấu cách giữa các từ Latin / tiếng Việt / số.
 * - Ghép liền không dấu cách giữa các ký tự CJK.
 * - Gắn liền các ký tự dấu câu vào từ đứng trước.
 */
export function formatWordsText(words: SrtWord[]): string {
  if (!words || words.length === 0) return '';
  let result = '';
  for (let i = 0; i < words.length; i++) {
    const raw = words[i].word;
    if (!raw) continue;
    const w = raw.trim();
    if (!w) continue;
    if (result.length === 0) {
      result = w;
      continue;
    }
    const prevChar = result[result.length - 1];
    const nextChar = w[0];
    const prevIsCjk = isCjkChar(prevChar);
    const nextIsCjk = isCjkChar(nextChar);
    const isPunctuationToken = /^[,.!?:;，。？！；：、…)]+$/.test(w);

    if (isPunctuationToken) {
      result += w;
    } else if (prevIsCjk && nextIsCjk) {
      result += w;
    } else {
      result += ' ' + w;
    }
  }
  return result;
}

/**
 * Ngắt dòng hiển thị thuần túy (\n, tối đa maxCharsPerLine ký tự/dòng).
 * Tuyệt đối không xé vụn khối phụ đề hay thay đổi timecode.
 */
export function wrapVisualLines(text: string, maxCharsPerLine = 37): string {
  const clean = (text || '').trim();
  if (!clean || clean.length <= maxCharsPerLine) {
    return clean;
  }

  // Nếu đã chứa dấu xuống dòng, xử lý từng dòng
  if (clean.includes('\n')) {
    return clean
      .split('\n')
      .map((line) => wrapVisualLines(line, maxCharsPerLine))
      .join('\n');
  }

  const hasWhitespace = /\s/.test(clean);

  // Nếu văn bản có chứa khoảng trắng (tiếng Việt, Latin, hoặc CJK hỗn hợp có khoảng trắng)
  // Ưu tiên sử dụng ngắt dòng theo ranh giới từ (word boundaries) để không bao giờ cắt đôi từ
  if (hasWhitespace) {
    // Với tiếng Việt / Latin / câu có khoảng trắng: sử dụng bộ tối ưu breakVietnameseLines sẵn có
    const broken = breakVietnameseLines(clean, maxCharsPerLine);
    if (broken !== clean && !broken.split('\n').some((l) => l.length > maxCharsPerLine)) {
      return broken;
    }

    // Dự phòng tìm vị trí khoảng trắng gần giữa nhất sao cho cả 2 vế đều <= maxCharsPerLine
    const mid = Math.floor(clean.length / 2);
    let bestSpace = -1;
    let minDiff = Infinity;
    for (let i = 0; i < clean.length; i++) {
      if (clean[i] === ' ') {
        const l1 = clean.slice(0, i).trim();
        const l2 = clean.slice(i + 1).trim();
        if (l1.length <= maxCharsPerLine && l2.length <= maxCharsPerLine) {
          const diff = Math.abs(i - mid);
          if (diff < minDiff) {
            minDiff = diff;
            bestSpace = i;
          }
        }
      }
    }
    if (bestSpace !== -1) {
      return `${clean.slice(0, bestSpace).trim()}\n${clean.slice(bestSpace + 1).trim()}`;
    }

    // Nếu không thể chia đôi hoàn hảo <= maxCharsPerLine, cắt ở khoảng trắng cuối cùng trước maxCharsPerLine
    const spaceIdx = clean.lastIndexOf(' ', maxCharsPerLine);
    if (spaceIdx > 0) {
      return `${clean.slice(0, spaceIdx).trim()}\n${clean.slice(spaceIdx + 1).trim()}`;
    }

    // Nếu không có khoảng trắng trước maxCharsPerLine, cắt ở khoảng trắng đầu tiên sau maxCharsPerLine
    const nextSpaceIdx = clean.indexOf(' ', maxCharsPerLine);
    if (nextSpaceIdx > 0) {
      return `${clean.slice(0, nextSpaceIdx).trim()}\n${clean.slice(nextSpaceIdx + 1).trim()}`;
    }
  }

  // Chỉ áp dụng ngắt dòng ký tự spaceless khi văn bản hoàn toàn không chứa khoảng trắng (Pure CJK)
  if (isCjkText(clean)) {
    // Tìm dấu câu CJK gần vị trí nửa câu hoặc trước maxCharsPerLine
    const cjkPunct = /[，；：、。？！]/g;
    let match: RegExpExecArray | null;
    let bestSplit = -1;
    const mid = Math.floor(clean.length / 2);

    while ((match = cjkPunct.exec(clean)) !== null) {
      const idx = match.index + 1; // cắt ngay sau dấu câu
      if (idx <= maxCharsPerLine && clean.length - idx <= maxCharsPerLine) {
        if (bestSplit === -1 || Math.abs(idx - mid) < Math.abs(bestSplit - mid)) {
          bestSplit = idx;
        }
      }
    }

    if (bestSplit !== -1) {
      return `${clean.slice(0, bestSplit).trim()}\n${clean.slice(bestSplit).trim()}`;
    }

    // Nếu không có dấu câu phù hợp, cắt ở vị trí tối đa maxCharsPerLine hoặc giữa câu
    const splitPoint = clean.length <= maxCharsPerLine * 2 ? mid : maxCharsPerLine;
    return `${clean.slice(0, splitPoint).trim()}\n${clean.slice(splitPoint).trim()}`;
  }

  return clean;
}

/**
 * Thuật toán Phân đoạn Phụ đề Tự nhiên theo Mốc Từ (Word-Level Natural Segmentation).
 * Nhóm các từ thành các khối phụ đề ngắn tự nhiên (2–5s / 6–10 từ) dựa trên dữ liệu âm thanh thực:
 * 1. Ngắt khi có khoảng lặng giữa hai từ liên tiếp >= 350ms (vô điều kiện khi >= 700ms).
 * 2. Ngắt khi gặp dấu câu kết thúc (. ? ! 。 ？ ！ …) khi phân đoạn >= 1500ms hoặc >= 4 từ.
 * 3. Ngắt khi gặp dấu ngắt vế (, ; : ， ； ： 、) khi phân đoạn >= 2000ms hoặc >= 6 từ (12 ký tự CJK).
 * 4. Giới hạn độ dài lý tưởng 2.0s - 5.0s, trần cứng tối đa 6.0s.
 * 5. Mốc thời gian chính xác 100%: startMs của từ đầu tiên, endMs của từ cuối cùng.
 * 6. Tách phân đoạn ngay lập tức khi đổi người nói (Diarization speaker transition).
 */
export function segmentWordsToSubtitles(
  words: SrtWord[],
  options: WordSegmenterOptions = {}
): SrtLine[] {
  if (!words || words.length === 0) {
    return [];
  }

  const {
    minPauseMs = 350,
    majorPauseMs = 700,
    idealMinDurationMs = 2000,
    idealMaxDurationMs = 5000,
    hardMaxDurationMs = 6000,
    minTerminalWords = 4,
    minTerminalDurationMs = 1500,
    minClauseWords = 6,
    minClauseCjkChars = 12,
    maxCharsPerLine = 37,
    enableVisualWrap = true,
    splitShortTerminalBeforeCapital = true,
  } = options;

  // Lọc và chuẩn hóa dữ liệu từ
  const rawWords: SrtWord[] = [];
  for (const w of words) {
    if (!w || typeof w.word !== 'string') continue;
    const text = w.word.trim();
    if (!text) continue;

    const startMs = Math.max(0, Math.round(w.startMs || 0));
    const rawEnd = typeof w.endMs === 'number' && !isNaN(w.endMs) ? Math.round(w.endMs) : startMs;
    const endMs = Math.max(startMs, rawEnd);

    rawWords.push({
      ...w,
      word: text,
      startMs,
      endMs,
    });
  }

  if (rawWords.length === 0) {
    return [];
  }

  // Sắp xếp tuần tự theo thời gian bắt đầu
  rawWords.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const sanitizedWords: SrtWord[] = [];
  for (let i = 0; i < rawWords.length; i++) {
    const cur = { ...rawWords[i] };
    const next = rawWords[i + 1];
    // Đảm bảo thời lượng tối thiểu của từ nếu từ có thời lượng 0 hoặc âm, nhưng không vượt quá startMs của từ tiếp theo
    if (cur.endMs < cur.startMs + 30) {
      let paddedEnd = cur.startMs + 30;
      if (next && next.startMs > cur.startMs && paddedEnd > next.startMs) {
        paddedEnd = next.startMs;
      }
      cur.endMs = Math.max(cur.endMs, paddedEnd);
    }
    sanitizedWords.push(cur);
  }

  const lines: SrtLine[] = [];
  let currentChunk: SrtWord[] = [];

  const flushChunk = () => {
    if (currentChunk.length === 0) return;

    const startMs = currentChunk[0].startMs;
    const maxWordEndMs = Math.max(...currentChunk.map((w) => w.endMs));
    const endMs = Math.max(maxWordEndMs, currentChunk[currentChunk.length - 1].endMs);

    // Đồng bộ mốc kết thúc của từ cuối cùng với mốc kết thúc của phân đoạn
    currentChunk[currentChunk.length - 1].endMs = endMs;

    const speaker = currentChunk[0].speaker;
    const rawText = formatWordsText(currentChunk);
    const displayText = enableVisualWrap ? wrapVisualLines(rawText, maxCharsPerLine) : rawText;

    lines.push({
      id: `line-${lines.length + 1}`,
      startMs,
      endMs,
      text: displayText,
      ...(speaker ? { speaker } : {}),
      words: [...currentChunk],
    });

    currentChunk = [];
  };

  for (let i = 0; i < sanitizedWords.length; i++) {
    const currentWord = sanitizedWords[i];
    currentChunk.push(currentWord);

    // Nếu là từ cuối cùng, đóng khối
    if (i === sanitizedWords.length - 1) {
      flushChunk();
      break;
    }

    const nextWord = sanitizedWords[i + 1];
    const chunkStartMs = currentChunk[0].startMs;
    const currentDuration = currentWord.endMs - chunkStartMs;
    const projectedDuration = nextWord.endMs - chunkStartMs;
    const pause = Math.max(0, nextWord.startMs - currentWord.endMs);
    const unitCount = countUnits(currentChunk);
    const isCJK = isCjkText(formatWordsText(currentChunk));

    // Tiêu chí 1: Đổi người nói (Speaker Transition)
    if (
      currentWord.speaker &&
      nextWord.speaker &&
      currentWord.speaker !== nextWord.speaker
    ) {
      flushChunk();
      continue;
    }

    // Tiêu chí 2: Khoảng lặng âm thanh giữa hai từ liên tiếp >= minPauseMs (350ms)
    // (Bao gồm cả khoảng lặng lớn >= majorPauseMs 700ms ngắt vô điều kiện)
    if (pause >= minPauseMs) {
      flushChunk();
      continue;
    }

    // Tiêu chí 3: Giới hạn trần cứng thời lượng (Hard Max Ceiling: 6.0s)
    // Nếu thêm từ tiếp theo làm phân đoạn vượt quá 6.0s thì ngắt ngay
    if (projectedDuration > hardMaxDurationMs) {
      flushChunk();
      continue;
    }

    // Tiêu chí 4: Dấu câu kết thúc câu (. ? ! 。 ？ ！ …)
    // Ngắt khi phân đoạn đã đạt >= 1500ms HOẶC >= 4 từ/ký tự
    if (hasTerminalPunctuation(currentWord.word)) {
      const abbreviation = /^(?:mr|mrs|ms|dr|prof|st|jr|sr|vs|etc|e\.g|i\.e|tp|ts|pgs)\.$/i.test(currentWord.word);
      const nextStartsSentence = /^[\p{Lu}\u3000-\u9fff]/u.test(nextWord.word.trim());
      if (
        (splitShortTerminalBeforeCapital && nextStartsSentence && !abbreviation) ||
        currentDuration >= minTerminalDurationMs ||
        unitCount >= minTerminalWords ||
        projectedDuration > idealMaxDurationMs ||
        pause >= 200
      ) {
        flushChunk();
        continue;
      }
    }

    // Tiêu chí 5: Dấu ngắt vế câu (, ; : ， ； ： 、)
    // Ngắt khi phân đoạn đã đạt thời lượng tối thiểu lý tưởng (>= 2000ms) HOẶC đạt đủ số từ (>= 6 từ / 12 ký tự CJK)
    if (hasClausePunctuation(currentWord.word)) {
      const requiredUnits = isCJK ? minClauseCjkChars : minClauseWords;
      if (
        currentDuration >= idealMinDurationMs ||
        unitCount >= requiredUnits ||
        projectedDuration > idealMaxDurationMs ||
        (pause >= 200 && currentDuration >= 1500)
      ) {
        flushChunk();
        continue;
      }
    }

    // Tiêu chí 6: Thời lượng lý tưởng tối đa (Ideal Max Duration: 5.0s)
    if (currentDuration >= idealMaxDurationMs) {
      flushChunk();
      continue;
    }

    // Tiêu chí 7: Độ dài câu đã dài vừa phải (>= 3.5s) kết hợp với số lượng từ lớn và có nhịp nghỉ nhỏ
    const thresholdUnits = isCJK ? 16 : 8;
    if (currentDuration >= 3500 && unitCount >= thresholdUnits && pause >= 150) {
      flushChunk();
      continue;
    }
  }

  // Đảm bảo bất biến lines[i].endMs <= lines[i+1].startMs luôn đúng (chống subtitle overlap)
  for (let i = 0; i < lines.length - 1; i++) {
    const curLine = lines[i];
    const nextLine = lines[i + 1];
    if (curLine && nextLine && curLine.endMs > nextLine.startMs &&
        (!curLine.speaker || !nextLine.speaker || curLine.speaker === nextLine.speaker)) {
      curLine.endMs = nextLine.startMs;
      const wList = curLine.words;
      if (wList && wList.length > 0) {
        const lastW = wList[wList.length - 1];
        if (lastW) {
          lastW.endMs = curLine.endMs;
        }
      }
    }
  }

  return lines;
}
