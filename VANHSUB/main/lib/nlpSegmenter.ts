import { SrtLine } from './srt';

export interface NlpSegmentOptions {
  maxCharsPerLine?: number;    // default: 37
  maxLinesPerBlock?: number;   // default: 2
  targetCps?: number;          // default: 18 (range 15-21)
  minDurationMs?: number;      // default: 1000
  minGapMs?: number;           // default: 80
  autoPadDuration?: boolean;   // default: true
}

export interface SegmentationAnalysis {
  cps: number;
  lineCount: number;
  maxLineLength: number;
  isCompliant: boolean;
  warnings: string[];
}

/**
 * Danh sách từ nối / giới từ / từ hư tiếng Việt không được đứng treo ở cuối dòng 1 (Dangling words)
 */
const DANGLING_WORDS = new Set([
  'của', 'và', 'với', 'trong', 'tại', 'cho', 'để', 'là', 'rằng',
  'những', 'các', 'về', 'từ', 'đến', 'do', 'bởi', 'nhưng', 'mà',
  'nếu', 'thì', 'sẽ', 'đang', 'đã', 'bị', 'được', 'ra', 'vào',
  'lên', 'xuống', 'qua', 'lại', 'như', 'vì', 'do đó', 'tuy', 'nhằm'
]);

/**
 * Liên từ phụ thuộc / từ chuyển tiếp ở đầu dòng 2 được cộng điểm thưởng
 */
const CONJUNCTION_HEADS = new Set([
  'nhưng', 'mặc dù', 'bởi vì', 'tuy nhiên', 'trong khi', 'do đó',
  'vì thế', 'cho nên', 'đồng thời', 'hơn nữa', 'ngược lại', 'thậm chí'
]);

/**
 * Regex phát hiện cụm số liệu + đơn vị đo lường / tiền tệ / thời gian / nhân sự
 * Tuyệt đối không ngắt dòng giữa con số và đơn vị đi kèm
 */
const UNIT_AND_NUMBER_REGEX = /(?<!\p{L})\d+(?:[.,]\d+)?\s*(?:%|phần trăm|(?:tỷ|triệu|nghìn|ngàn|trăm)?\s*(?:USD|EUR|VND|đồng|km\/h|m\/s|km|m|cm|mm|kg|g|tấn|tạ|yến|lít|ml|ha|m²|m2|m³|m3|kW|kWh|W|V|A|Hz|GB|MB|KB|TB|năm|tháng|tuần|ngày|giờ|phút|giây|h|m|s|kỹ sư|chuyên gia|người|bác sĩ|học sinh|sinh viên|thành viên|công nhân|hành khách))(?!\p{L})/giu;

/**
 * Regex tên riêng viết hoa nhiều âm tiết (Proper Nouns)
 */
const PROPER_NOUN_REGEX = /[A-ZÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬĐÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ][a-zàáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]+(?:\s+[A-ZÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬĐÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ][a-zàáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]+)+/gu;

/**
 * Từ điển từ ghép tiếng Việt thông dụng (~450 từ) gồm chính trị, kinh tế, công nghệ, địa danh và đời sống
 */
const VIETNAMESE_COMPOUND_WORDS: string[] = [
  // Chính trị, Pháp luật & Hành chính
  'chính phủ', 'thủ tướng', 'chủ tịch', 'quốc hội', 'ban hành', 'nghị định', 'chính sách', 'nhà nước',
  'bộ trưởng', 'trung ương', 'lãnh đạo', 'quản lý', 'cơ quan', 'đại biểu', 'hội đồng', 'pháp luật',
  'tư pháp', 'hành pháp', 'lập pháp', 'địa phương', 'quy định', 'chỉ thị', 'thông tư', 'thanh tra',
  'ban chấp hành', 'bộ ngoại giao', 'bộ tài chính', 'bộ công thương', 'ngân hàng nhà nước', 'viện kiểm sát',
  'tòa án', 'thẩm phán', 'luật sư', 'công lý', 'quy chế', 'điều lệ', 'hiến pháp', 'chủ quyền',

  // Kinh tế, Tài chính & Doanh nghiệp
  'kinh tế', 'thị trường', 'doanh nghiệp', 'đầu tư', 'ngân sách', 'tài chính', 'chứng khoán', 'tiền tệ',
  'ngân hàng', 'lạm phát', 'tăng trưởng', 'xuất khẩu', 'nhập khẩu', 'thương mại', 'sản xuất', 'tiêu dùng',
  'dịch vụ', 'thu nhập', 'thuế quan', 'lợi nhuận', 'chi phí', 'giá cả', 'cổ phần', 'tập đoàn', 'tỷ giá',
  'đối tác', 'thương gia', 'chuỗi cung ứng', 'bất động sản', 'kinh tế số', 'kinh tế xanh', 'kinh tế biển',
  'tổng giám đốc', 'phó thủ tướng', 'phó chủ tịch', 'khởi nghiệp', 'đổi mới', 'sáng tạo', 'cạnh tranh',
  'thị phần', 'doanh thu', 'vốn đầu tư', 'tín dụng', 'lãi suất', 'nợ xấu', 'thanh khoản', 'trái phiếu',
  'cổ phiếu', 'hợp đồng', 'thỏa thuận', 'cam kết', 'thương lượng', 'đàm phán', 'sáp nhập', 'giải thể',

  // Khoa học, Công nghệ & Chuyển đổi số
  'công nghệ', 'trí tuệ', 'trí tuệ nhân tạo', 'công nghệ thông tin', 'chuyển đổi số', 'phần mềm', 'phần cứng',
  'thông tin', 'dữ liệu', 'kỹ sư', 'nghiên cứu', 'phát triển', 'mạng xã hội', 'điện toán', 'thuật toán',
  'máy tính', 'ứng dụng', 'viễn thông', 'bảo mật', 'an ninh mạng', 'bán dẫn', 'vi mạch', 'hệ thống',
  'nền tảng', 'thiết bị', 'tự động hóa', 'năng lượng tái tạo', 'cơ sở dữ liệu', 'kỹ thuật số', 'trực tuyến',
  'điện toán đám mây', 'học máy', 'thị giác máy tính', 'xử lý ngôn ngữ', 'robot học', 'viễn thám',

  // Địa danh & Quốc gia
  'việt nam', 'hà nội', 'thành phố hồ chí minh', 'đà nẵng', 'hải phòng', 'cần thơ', 'đồng bằng',
  'miền bắc', 'miền nam', 'miền trung', 'tây nguyên', 'đông nam bộ', 'đồng bằng sông cửu long',
  'quảng ninh', 'thanh hóa', 'nghệ an', 'huế', 'nha trang', 'vũng tàu', 'quy nhơn', 'biển đông',

  // Xã hội, Giáo dục, Y tế & Đời sống
  'đất nước', 'nhân dân', 'xã hội', 'giáo dục', 'y tế', 'văn hóa', 'du lịch', 'lịch sử', 'truyền thống',
  'gia đình', 'thanh niên', 'phụ nữ', 'trẻ em', 'học sinh', 'sinh viên', 'người dân', 'cộng đồng',
  'môi trường', 'khí hậu', 'biến đổi khí hậu', 'phát triển bền vững', 'giao thông', 'hạ tầng', 'nông thôn',
  'thành thị', 'chuyên gia', 'quốc tế', 'toàn cầu', 'khu vực', 'chất lượng', 'tiêu chuẩn', 'quy chuẩn',
  'an toàn', 'an ninh', 'quốc phòng', 'tài nguyên', 'khoáng sản', 'năng lượng', 'điện lực', 'dầu khí',
  'nông nghiệp', 'công nghiệp', 'thủy sản', 'lâm nghiệp', 'chế biến', 'vận tải', 'logistics', 'truyền thông',
  'báo chí', 'phát thanh', 'truyền hình', 'điện ảnh', 'nghệ thuật', 'thể thao', 'khách sạn', 'nhà hàng',
  'ẩm thực', 'sức khỏe', 'bệnh viện', 'bác sĩ', 'y sĩ', 'dược phẩm', 'vắc xin', 'điều trị', 'phòng ngừa',
  'trường học', 'đại học', 'cao đẳng', 'học viện', 'đào tạo', 'kiến thức', 'kỹ năng', 'kinh nghiệm',
  'khoa học', 'giảng viên', 'giáo viên', 'giáo sư', 'tiến sĩ', 'thạc sĩ', 'cử nhân', 'lao động', 'việc làm',
  'tiền lương', 'bảo hiểm', 'đời sống', 'sinh hoạt', 'tài sản', 'trách nhiệm', 'văn minh', 'hiện đại',

  // Động từ & Tính từ ghép thông dụng
  'phát triển', 'hợp tác', 'thúc đẩy', 'xây dựng', 'thực hiện', 'nâng cao', 'cải cách', 'hoàn thành',
  'tổ chức', 'tham gia', 'phối hợp', 'bảo đảm', 'đảm bảo', 'quan trọng', 'cần thiết', 'hiệu quả',
  'tiềm năng', 'tương lai', 'hiện tại', 'vừa qua', 'hôm nay', 'ngày mai', 'thời gian', 'cơ hội',
  'thách thức', 'giải pháp', 'chiến lược', 'kế hoạch', 'mục tiêu', 'thành công', 'đột phá', 'đóng góp',
  'ảnh hưởng', 'kết quả', 'tình hình', 'kết nối', 'chia sẻ', 'giúp đỡ', 'hỗ trợ', 'bảo vệ', 'tôn vinh',
  'đánh giá', 'dự báo', 'dự kiến', 'kỳ vọng', 'mong muốn', 'nhận thức', 'tư duy', 'định hướng',
  'tầm nhìn', 'sứ mệnh', 'giá trị', 'nghị lực', 'quyết tâm', 'nỗ lực', 'phấn đấu', 'chinh phục',
  'khám phá', 'kiểm tra', 'phê duyệt', 'công bố', 'triển khai', 'vận hành', 'bảo trì', 'nâng cấp',
  'sửa chữa', 'báo cáo', 'chỉ đạo', 'điều hành', 'giám sát', 'động viên', 'khích lệ', 'bứt phá',
  'bền vững', 'toàn diện', 'đồng bộ', 'nhất quán', 'chặt chẽ', 'liên tục', 'lâu dài', 'cấp bách',
  'trọng tâm', 'then chốt', 'tiên phong', 'phục hồi', 'ổn định', 'chủ động', 'tích cực', 'sẵn sàng',
  'đồng thuận', 'nhất trí', 'đoàn kết'
];

/** Tạo Trie và Set phục vụ tra cứu nhanh */
const COMPOUND_WORDS_SET = new Set<string>();
for (const phrase of VIETNAMESE_COMPOUND_WORDS) {
  COMPOUND_WORDS_SET.add(phrase.trim().toLowerCase());
}

/** Interface đoạn văn bản cần bảo vệ ranh giới (Forbidden Span) */
interface ProtectedSpan {
  start: number;
  end: number;
  type: string;
}

interface TextToken {
  word: string;
  raw: string;
  start: number;
  end: number;
}

/** Tách từ kèm vị trí index trong chuỗi */
function tokenizeWithOffsets(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  const regex = /\S+/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const word = raw.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    tokens.push({
      word,
      raw,
      start: match.index,
      end: match.index + raw.length,
    });
  }

  return tokens;
}

/**
 * Tìm tất cả các khoảng ký tự KHÔNG được phép ngắt dòng:
 * 1. Cụm số + đơn vị đo / tiền tệ / thời gian
 * 2. Tên riêng nhiều từ viết hoa
 * 3. Từ ghép tiếng Việt (2-4 tiếng)
 */
function findProtectedSpans(text: string): ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];

  // 1. Cụm số và đơn vị
  const unitRegex = new RegExp(UNIT_AND_NUMBER_REGEX.source, 'giu');
  let unitMatch: RegExpExecArray | null;
  while ((unitMatch = unitRegex.exec(text)) !== null) {
    spans.push({
      start: unitMatch.index,
      end: unitMatch.index + unitMatch[0].length,
      type: 'unit_number',
    });
  }

  // 2. Tên riêng
  const properRegex = new RegExp(PROPER_NOUN_REGEX.source, 'gu');
  let properMatch: RegExpExecArray | null;
  while ((properMatch = properRegex.exec(text)) !== null) {
    spans.push({
      start: properMatch.index,
      end: properMatch.index + properMatch[0].length,
      type: 'proper_noun',
    });
  }

  // 3. Từ ghép tiếng Việt qua Token Windows
  const tokens = tokenizeWithOffsets(text);
  const n = tokens.length;

  for (let i = 0; i < n; i++) {
    // Thử window 4 từ
    if (i + 3 < n) {
      const phrase4 = `${tokens[i].word} ${tokens[i + 1].word} ${tokens[i + 2].word} ${tokens[i + 3].word}`;
      if (COMPOUND_WORDS_SET.has(phrase4)) {
        spans.push({
          start: tokens[i].start,
          end: tokens[i + 3].end,
          type: 'compound_4',
        });
      }
    }
    // Thử window 3 từ
    if (i + 2 < n) {
      const phrase3 = `${tokens[i].word} ${tokens[i + 1].word} ${tokens[i + 2].word}`;
      if (COMPOUND_WORDS_SET.has(phrase3)) {
        spans.push({
          start: tokens[i].start,
          end: tokens[i + 2].end,
          type: 'compound_3',
        });
      }
    }
    // Thử window 2 từ
    if (i + 1 < n) {
      const phrase2 = `${tokens[i].word} ${tokens[i + 1].word}`;
      if (COMPOUND_WORDS_SET.has(phrase2)) {
        spans.push({
          start: tokens[i].start,
          end: tokens[i + 1].end,
          type: 'compound_2',
        });
      }
    }
  }

  return spans;
}

/** Kiểm tra vị trí splitIndex có nằm bên trong bất kỳ khoảng được bảo vệ nào không */
function isInsideProtectedSpan(splitIndex: number, spans: ProtectedSpan[]): boolean {
  for (const span of spans) {
    if (splitIndex > span.start && splitIndex < span.end) {
      return true;
    }
  }
  return false;
}

/**
 * Tính trọng số âm vị học (Phonetic Syllable Weight) phục vụ nội suy timecode
 */
export function calculatePhoneticWeight(text: string): number {
  const tokens = tokenizeWithOffsets(text);
  let weight = 0;

  for (const tok of tokens) {
    let w = tok.word.length || 3;
    if (/[,;—\-]/.test(tok.raw)) {
      w += 3; // dấu phẩy tương đương khoảng lặng ngắn
    } else if (/[.!?:]/.test(tok.raw)) {
      w += 6; // dấu chấm tương đương khoảng lặng dài hơn
    }
    weight += w;
  }

  return Math.max(1, weight);
}

/**
 * Tính chỉ số CPS (Characters Per Second) của 1 dòng phụ đề
 */
export function calculateCps(line: SrtLine): number {
  const durationSec = (line.endMs - line.startMs) / 1000;
  if (durationSec <= 0) return 0;
  const chars = line.text.replace(/\r?\n/g, '').trim().length;
  return Number((chars / durationSec).toFixed(1));
}

/**
 * Phân tích độ tuân thủ tiêu chuẩn Netflix của 1 dòng phụ đề
 */
export function analyzeSubtitleLine(line: SrtLine): SegmentationAnalysis {
  const cps = calculateCps(line);
  const rawLines = line.text.split(/\r?\n/);
  const lineCount = rawLines.length;
  const maxLineLength = Math.max(0, ...rawLines.map((l) => l.trim().length));
  const warnings: string[] = [];

  if (lineCount > 2) {
    warnings.push(`Vượt quá 2 dòng (${lineCount} dòng)`);
  }
  rawLines.forEach((l, idx) => {
    if (l.trim().length > 37) {
      warnings.push(`Dòng ${idx + 1} vượt 37 ký tự (${l.trim().length} ký tự)`);
    }
  });
  if (cps > 21) {
    warnings.push(`Tốc độ đọc quá nhanh (${cps} CPS > 21)`);
  } else if (cps < 10 && line.text.trim().length > 0) {
    warnings.push(`Tốc độ đọc chậm (${cps} CPS < 10)`);
  }

  const isCompliant = lineCount <= 2 && maxLineLength <= 37 && cps <= 21;
  return {
    cps,
    lineCount,
    maxLineLength,
    isCompliant,
    warnings,
  };
}

/**
 * Đánh giá chi phí cắt chuỗi văn bản tại 1 vị trí spaceIndex thành 2 dòng
 */
function evaluateSplitCost(
  text: string,
  spaceIndex: number,
  spans: ProtectedSpan[],
  tokens: TextToken[],
  maxCharsPerLine: number
): number {
  let cost = 0;

  // 1. Phạt cực nặng nếu ngắt giữa từ ghép hoặc số + đơn vị (+40,000)
  if (isInsideProtectedSpan(spaceIndex, spans)) {
    cost += 40000;
  }

  const line1 = text.slice(0, spaceIndex).trim();
  const line2 = text.slice(spaceIndex + 1).trim();
  const len1 = line1.length;
  const len2 = line2.length;

  // 2. Ràng buộc cứng độ dài (<= 37 ký tự)
  if (len1 > maxCharsPerLine) {
    cost += 100000 + (len1 - maxCharsPerLine) * 15000;
  }
  if (len2 > maxCharsPerLine) {
    cost += 100000 + (len2 - maxCharsPerLine) * 15000;
  }

  // 3. Từ nối / Giới từ treo ở cuối dòng 1 (Dangling Word Penalty)
  // Lấy từ cuối cùng của dòng 1
  let lastWordOfLine1 = '';
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].end <= spaceIndex) {
      lastWordOfLine1 = tokens[i].word;
      break;
    }
  }
  if (DANGLING_WORDS.has(lastWordOfLine1)) {
    cost += 12000;
  }

  // 4. Từ mồ côi (Orphan word penalty) ở dòng 2 (< 8 ký tự hoặc chỉ 1 từ)
  if (len2 < 8 || !line2.includes(' ')) {
    cost += 6000;
  }
  if (len1 < 6 || !line1.includes(' ')) {
    cost += 4000;
  }

  // 5. Thưởng dấu câu tự nhiên ở cuối dòng 1
  const charBefore = text[spaceIndex - 1];
  if (charBefore === ',' || charBefore === ';' || charBefore === '—') {
    cost -= 3500;
  } else if (charBefore === '.' || charBefore === '!' || charBefore === '?') {
    cost -= 4500;
  }

  // 6. Thưởng liên từ phụ thuộc ở đầu dòng 2
  let firstWordOfLine2 = '';
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].start > spaceIndex) {
      firstWordOfLine2 = tokens[i].word;
      break;
    }
  }
  if (CONJUNCTION_HEADS.has(firstWordOfLine2)) {
    cost -= 2500;
  }

  // 7. Cân bằng độ dài và quy tắc hình tháp (Pyramid Rule: dòng 1 <= dòng 2)
  cost += Math.abs(len1 - len2) * 12;
  if (len1 <= len2 && len2 - len1 <= 14) {
    cost -= 500; // Thưởng hình tháp đáy rộng
  } else if (len1 > len2) {
    cost += 400; // Phạt hình tháp ngược (đỉnh rộng)
  }

  return cost;
}

/**
 * Ngắt một chuỗi văn bản thành các dòng tuân thủ tối đa maxCharsPerLine (mặc định 37)
 * Sử dụng giải thuật tối ưu hóa chi phí ngữ pháp tiếng Việt và chuẩn Netflix
 */
export function breakVietnameseLines(text: string, maxCharsPerLine = 37): string {
  const clean = (text || '').trim().replace(/[ \t]+/g, ' ');
  if (!clean || clean.length <= maxCharsPerLine) {
    return clean;
  }

  const spans = findProtectedSpans(clean);
  const tokens = tokenizeWithOffsets(clean);

  // Tìm tất cả các vị trí khoảng trắng có thể ngắt dòng
  const spaceIndices: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === ' ' || clean[i] === '\n') {
      spaceIndices.push(i);
    }
  }

  if (spaceIndices.length === 0) {
    return clean;
  }

  // Trường hợp 1: Nếu chuỗi có thể chứa vừa vặn trong 2 dòng (độ dài <= maxCharsPerLine * 2)
  // Ta tìm điểm cắt đôi tối ưu nhất
  let bestIndex = -1;
  let minCost = Infinity;

  for (const idx of spaceIndices) {
    const cost = evaluateSplitCost(clean, idx, spans, tokens, maxCharsPerLine);
    if (cost < minCost) {
      minCost = cost;
      bestIndex = idx;
    }
  }

  if (bestIndex !== -1) {
    const l1 = clean.slice(0, bestIndex).trim();
    const l2 = clean.slice(bestIndex + 1).trim();

    // Nếu cả 2 dòng đều thoả <= maxCharsPerLine, trả về ngay 2 dòng
    if (l1.length <= maxCharsPerLine && l2.length <= maxCharsPerLine) {
      return `${l1}\n${l2}`;
    }
  }

  // Trường hợp 2: Câu dài hơn 2 dòng (> 74 ký tự) hoặc chia đôi chưa thoả
  // Sử dụng Dynamic Programming (Knuth-Plass / Word Wrap thích ứng)
  const n = tokens.length;
  if (n <= 1) return clean;

  // dp[i] lưu { minCost, prevIndex } cho tiền tố gồm i tokens (0..i-1)
  const dp: Array<{ cost: number; prev: number }> = new Array(n + 1).fill(null).map(() => ({
    cost: Infinity,
    prev: -1,
  }));
  dp[0] = { cost: 0, prev: -1 };

  for (let i = 1; i <= n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      // Dòng ứng với tokens từ j đến i-1
      const lineStart = tokens[j].start;
      const lineEnd = tokens[i - 1].end;
      const lineText = clean.slice(lineStart, lineEnd).trim();
      const lineLen = lineText.length;

      // Nếu dòng vượt quá maxCharsPerLine và j < i - 1 thì không thể mở rộng thêm về trước
      if (lineLen > maxCharsPerLine && j < i - 1) {
        break;
      }

      let stepCost = 0;
      if (lineLen > maxCharsPerLine) {
        stepCost += 100000 + (lineLen - maxCharsPerLine) * 15000;
      } else {
        // Càng gần maxCharsPerLine càng tốt
        stepCost += Math.pow(maxCharsPerLine - lineLen, 2);
      }

      // Kiểm tra ranh giới cắt giữa token j-1 và token j
      if (j > 0) {
        const splitPos = tokens[j - 1].end;
        if (isInsideProtectedSpan(splitPos, spans)) {
          stepCost += 35000;
        }
        if (DANGLING_WORDS.has(tokens[j - 1].word)) {
          stepCost += 10000;
        }
        const prevRaw = tokens[j - 1].raw;
        if (/[,;—]/.test(prevRaw)) {
          stepCost -= 3000;
        }
      }

      const totalCost = dp[j].cost + stepCost;
      if (totalCost < dp[i].cost) {
        dp[i] = { cost: totalCost, prev: j };
      }
    }
  }

  // Tái dựng lại các dòng
  const lines: string[] = [];
  let curr = n;
  while (curr > 0) {
    const prev = dp[curr].prev;
    if (prev === -1) break;
    const lineText = clean.slice(tokens[prev].start, tokens[curr - 1].end).trim();
    lines.unshift(lineText);
    curr = prev;
  }

  return lines.length > 0 ? lines.join('\n') : clean;
}

/** Tạo ID duy nhất cho dòng phụ đề mới */
function generateLineId(prefix = 'line'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Phân rã văn bản dài thành các khối độc lập (Chunks) sao cho mỗi khối
 * chứa tối đa maxLinesPerBlock (mặc định 2 dòng) và mỗi dòng <= maxCharsPerLine (mặc định 37).
 */
function decomposeIntoCompliantChunks(
  text: string,
  maxCharsPerLine = 37,
  maxLinesPerBlock = 2
): string[] {
  const clean = (text || '').trim().replace(/[ \t]+/g, ' ');
  if (!clean) return [];

  // Thử ngắt dòng trực tiếp
  const broken = breakVietnameseLines(clean, maxCharsPerLine);
  const lines = broken.split('\n').map((l) => l.trim()).filter(Boolean);

  if (lines.length <= maxLinesPerBlock) {
    return [lines.join('\n')];
  }

  // Nếu số dòng > maxLinesPerBlock, gom nhóm thành từng khối tối đa maxLinesPerBlock dòng
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += maxLinesPerBlock) {
    const group = lines.slice(i, i + maxLinesPerBlock);
    chunks.push(group.join('\n'));
  }

  return chunks;
}

/**
 * Cắt đôi thông minh 1 câu phụ đề tại vị trí ngữ pháp tối ưu nhất gần cursorMs
 */
export function splitLineSmart(
  line: SrtLine,
  cursorMs?: number
): { line1: SrtLine; line2: SrtLine } {
  const fullText = (line.text || '').trim();
  const newId = generateLineId();

  if (!fullText) {
    return {
      line1: { ...line },
      line2: { id: newId, startMs: line.endMs, endMs: line.endMs, text: '', speaker: line.speaker },
    };
  }

  const spans = findProtectedSpans(fullText);
  const tokens = tokenizeWithOffsets(fullText);

  const spaceIndices: number[] = [];
  for (let i = 0; i < fullText.length; i++) {
    if (fullText[i] === ' ' || fullText[i] === '\n') {
      spaceIndices.push(i);
    }
  }

  if (spaceIndices.length === 0) {
    // Không có khoảng trắng để cắt
    const midMs = Math.round(line.startMs + (line.endMs - line.startMs) / 2);
    return {
      line1: { ...line, endMs: midMs },
      line2: { id: newId, startMs: midMs + 80, endMs: line.endMs, text: '', speaker: line.speaker },
    };
  }

  // Tính vị trí ký tự mục tiêu từ cursorMs nếu có
  let targetCharIndex = Math.floor(fullText.length / 2);
  const dur = line.endMs - line.startMs;
  if (
    cursorMs !== undefined &&
    dur > 0 &&
    cursorMs > line.startMs + 200 &&
    cursorMs < line.endMs - 200
  ) {
    const ratio = (cursorMs - line.startMs) / dur;
    targetCharIndex = Math.round(fullText.length * ratio);
  }

  let bestIndex = -1;
  let minCost = Infinity;

  for (const idx of spaceIndices) {
    // Chi phí vị trí so với cursor / midpoint
    const distanceCost = Math.abs(idx - targetCharIndex) * 18;
    // Chi phí ngữ pháp và ranh giới
    const grammarCost = evaluateSplitCost(fullText, idx, spans, tokens, 37);
    const totalCost = distanceCost + grammarCost;

    if (totalCost < minCost) {
      minCost = totalCost;
      bestIndex = idx;
    }
  }

  if (bestIndex === -1) {
    bestIndex = spaceIndices[Math.floor(spaceIndices.length / 2)];
  }

  const rawText1 = fullText.slice(0, bestIndex).trim();
  const rawText2 = fullText.slice(bestIndex + 1).trim();

  const text1 = breakVietnameseLines(rawText1, 37);
  const text2 = breakVietnameseLines(rawText2, 37);

  // Tính toán mốc thời gian dựa trên trọng số âm vị học và clearance gap 80ms
  const w1 = calculatePhoneticWeight(rawText1);
  const w2 = calculatePhoneticWeight(rawText2);
  const totalW = w1 + w2;
  const clearanceGap = 80;

  let actualGap = clearanceGap;
  let effectiveDur = dur - actualGap;
  if (effectiveDur <= 0) {
    actualGap = dur > 2 ? 1 : 0;
    effectiveDur = Math.max(0, dur - actualGap);
  }

  let splitMs: number;
  if (effectiveDur < 600) {
    if (
      cursorMs !== undefined &&
      cursorMs > line.startMs &&
      cursorMs < line.endMs - actualGap
    ) {
      splitMs = Math.round(cursorMs);
    } else {
      const r = Math.max(
        0.2,
        Math.min(0.8, text1.length / (text1.length + text2.length || 1))
      );
      splitMs = Math.round(line.startMs + effectiveDur * r);
    }
    const minSplit = line.startMs + (effectiveDur > 2 ? 1 : 0);
    const maxSplit = line.endMs - actualGap - (effectiveDur > 2 ? 1 : 0);
    splitMs = Math.max(minSplit, Math.min(splitMs, maxSplit));
  } else {
    if (
      cursorMs !== undefined &&
      cursorMs >= line.startMs + 300 &&
      cursorMs <= line.endMs - 300 - actualGap
    ) {
      splitMs = Math.round(cursorMs);
    } else {
      const ratio = totalW > 0 ? w1 / totalW : 0.5;
      splitMs = Math.round(line.startMs + effectiveDur * ratio);
    }
    splitMs = Math.max(line.startMs + 300, Math.min(splitMs, line.endMs - 300 - actualGap));
  }

  const startMs2 = splitMs + actualGap;

  const line1: SrtLine = {
    ...line,
    endMs: splitMs,
    text: text1,
  };

  const line2: SrtLine = {
    id: newId,
    startMs: startMs2,
    endMs: line.endMs,
    text: text2,
    speaker: line.speaker,
  };

  return { line1, line2 };
}

/**
 * Chuẩn hoá toàn bộ danh sách phụ đề theo tiêu chuẩn Netflix:
 * 1. Giới hạn tối đa 37 ký tự/dòng.
 * 2. Tối đa 2 dòng/khung phụ đề.
 * 3. Bảo toàn cụm từ ghép, số liệu & đơn vị tính, không để từ nối treo cuối dòng 1.
 * 4. Tốc độ đọc 15-21 CPS kèm Duration Padding nới vào khoảng lặng (khoảng cách tối thiểu 80ms).
 * 5. Tái phân bổ timecode theo trọng số âm vị học không chồng lấn.
 */
export function segmentSubtitlesNetflix(
  lines: SrtLine[],
  options: NlpSegmentOptions = {}
): SrtLine[] {
  if (!lines || lines.length === 0) return [];

  const {
    maxCharsPerLine = 37,
    maxLinesPerBlock = 2,
    targetCps = 18,
    minDurationMs = 1000,
    minGapMs = 80,
    autoPadDuration = true,
  } = options;

  // Bước 1: Phân tách các khối quá dài thành các khối tuân thủ <= 2 dòng & <= 37 ký tự/dòng
  const expanded: SrtLine[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const originalLine = lines[idx];
    const rawText = (originalLine.text || '').trim();
    if (!rawText) continue;

    const chunks = decomposeIntoCompliantChunks(rawText, maxCharsPerLine, maxLinesPerBlock);

    if (chunks.length <= 1) {
      expanded.push({
        ...originalLine,
        text: chunks[0] || rawText,
      });
      continue;
    }

    // Nếu bị tách thành nhiều khối con: phân bổ timecode theo trọng số âm vị học không vượt quá maxEnd
    const weights = chunks.map((c) => calculatePhoneticWeight(c));
    const totalWeight = weights.reduce((acc, w) => acc + w, 0);

    // Xác định cận trên thời gian khả dụng để không đè lên câu kế tiếp
    let maxEnd = originalLine.endMs;
    for (let nextIdx = idx + 1; nextIdx < lines.length; nextIdx++) {
      if ((lines[nextIdx].text || '').trim()) {
        maxEnd = Math.min(originalLine.endMs, lines[nextIdx].startMs - minGapMs);
        break;
      }
    }
    maxEnd = Math.max(originalLine.startMs + chunks.length, maxEnd);

    let gap = minGapMs;
    const totalGaps = (chunks.length - 1) * gap;
    let availableDur = maxEnd - originalLine.startMs - totalGaps;

    if (availableDur < chunks.length) {
      // Trường hợp khoảng thời gian quá hẹp, thu hẹp gap để bảo đảm tính đơn điệu
      const totalWindow = maxEnd - originalLine.startMs;
      gap = Math.max(1, Math.floor((totalWindow * 0.2) / Math.max(1, chunks.length - 1)));
      availableDur = Math.max(chunks.length, totalWindow - (chunks.length - 1) * gap);
    }

    const chunkDurs: number[] = [];
    let allocatedDur = 0;
    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      const ratio = totalWeight > 0 ? weights[cIdx] / totalWeight : 1 / chunks.length;
      const durShare = Math.max(1, Math.floor(availableDur * ratio));
      chunkDurs.push(durShare);
      allocatedDur += durShare;
    }

    let diff = availableDur - allocatedDur;
    let dIdx = 0;
    while (diff > 0) {
      chunkDurs[dIdx % chunks.length]++;
      diff--;
      dIdx++;
    }
    while (diff < 0) {
      const targetIdx = chunks.length - 1 - ((-diff) % chunks.length);
      if (chunkDurs[targetIdx] > 1) {
        chunkDurs[targetIdx]--;
        diff++;
      } else {
        break;
      }
    }

    let curStart = originalLine.startMs;
    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      const isLast = cIdx === chunks.length - 1;
      const chunkDur = isLast ? Math.max(1, maxEnd - curStart) : chunkDurs[cIdx];
      const chunkEnd = curStart + chunkDur;

      expanded.push({
        ...originalLine,
        id: cIdx === 0 ? originalLine.id : generateLineId(),
        startMs: curStart,
        endMs: chunkEnd,
        text: chunks[cIdx],
      });

      curStart = chunkEnd + gap;
    }
  }

  // Bước 2: Duration Padding & Kiểm soát CPS vào khoảng lặng kế tiếp
  for (let i = 0; i < expanded.length; i++) {
    const curr = expanded[i];
    const nextStart = i < expanded.length - 1 ? expanded[i + 1].startMs : Infinity;
    const availableSilenceGap = nextStart === Infinity ? 2000 : nextStart - curr.endMs;

    const charCount = curr.text.replace(/\r?\n/g, '').trim().length;
    const currentDur = curr.endMs - curr.startMs;

    if (autoPadDuration && availableSilenceGap > minGapMs) {
      // Thời lượng mong muốn để đạt targetCps (hoặc minDurationMs cho câu ngắn)
      const desiredDur = Math.max(
        minDurationMs,
        Math.ceil((charCount / targetCps) * 1000)
      );

      if (currentDur < desiredDur) {
        const needed = desiredDur - currentDur;
        const maxExtend = Math.max(0, availableSilenceGap - minGapMs);
        const padAmount = Math.min(needed, maxExtend);
        curr.endMs += padAmount;
      }
    }

    // Đảm bảo không đè lên câu tiếp theo và duy trì clearance gap >= minGapMs
    if (i < expanded.length - 1 && curr.endMs > expanded[i + 1].startMs - minGapMs) {
      const targetEnd = expanded[i + 1].startMs - minGapMs;
      if (targetEnd > curr.startMs) {
        curr.endMs = Math.max(curr.startMs + 10, targetEnd);
      } else {
        curr.endMs = Math.max(curr.startMs + 1, expanded[i + 1].startMs - 1);
      }
    }

    // Đánh giá lại CPS và gán cờ needsReview nếu tốc độ đọc vẫn quá nhanh
    const finalCps = calculateCps(curr);
    if (finalCps > 21) {
      curr.needsReview = true;
    }
  }

  return expanded;
}
