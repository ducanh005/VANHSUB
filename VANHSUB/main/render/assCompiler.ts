/**
 * ASS Subtitle Compiler cho VANHSUB
 * Chuyển đổi phụ đề kèm cấu hình style (global + per-entry override)
 * sang định dạng Advanced SubStation Alpha (.ass) chuẩn libass.
 */

export interface SubtitleEntryStyle {
  textColorHex?: string;      // Ví dụ: "#FFE500"
  outlineColorHex?: string;   // Ví dụ: "#000000"
  outlineWidth?: number;      // 0..8
  shadowDepth?: number;       // 0..6
  fontSize?: number;          // Đơn vị điểm ảnh theo PlayResY (14..60)
  fontName?: string;          // Tên font
  bold?: boolean;
  italic?: boolean;
  alignment?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; // Numpad: 2 đáy-giữa, 4 giữa-trái, 8 đỉnh-giữa...
  marginV?: number;           // Khoảng cách lề dọc (0..120)
  marginH?: number;           // Khoảng cách lề ngang (0..150)
  isVertical?: boolean;       // Chữ xếp dọc (cho nhạc Douyin/TikTok)
  opacity?: number;           // 0..100
  posPercent?: { x: number; y: number }; // Tọa độ tương đối 0..100%
  fadeInMs?: number;
  fadeOutMs?: number;
}

export interface CompileSubtitleItem {
  startMs: number;
  endMs: number;
  text: string;
  style?: SubtitleEntryStyle | null;
}

export interface GlobalAssStyle {
  fontName: string;
  fontSize: number;
  primaryColour: string;     // Hex #RRGGBB
  outlineColour: string;     // Hex #RRGGBB
  opacity: number;           // 0..100
  outline: number;           // 0..8
  shadow: number;            // 0..6
  bold: boolean;
  borderStyle: 1 | 3;        // 1: outline, 3: opaque box
  alignment: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  marginV: number;
  marginH?: number;
  isVertical?: boolean;
  posPercent?: { x: number; y: number };
}

export const DEFAULT_GLOBAL_STYLE: GlobalAssStyle = {
  fontName: 'Arial',
  fontSize: 22,
  primaryColour: '#FFFFFF',
  outlineColour: '#000000',
  opacity: 100,
  outline: 2.5,
  shadow: 1,
  bold: false,
  borderStyle: 1,
  alignment: 2,
  marginV: 25,
  marginH: 20,
  isVertical: false,
};

/** Chuyển mã màu hex #RRGGBB hoặc #RRGGBBAA sang định dạng ASS &HAABBGGRR */
export function hexToAssColor(hex: string, opacityPercent: number = 100): string {
  const cleanHex = String(hex || '').replace(/[^0-9a-fA-F]/g, '');
  let r = 255;
  let g = 255;
  let b = 255;

  if (cleanHex.length >= 6) {
    r = parseInt(cleanHex.slice(0, 2), 16) || 0;
    g = parseInt(cleanHex.slice(2, 4), 16) || 0;
    b = parseInt(cleanHex.slice(4, 6), 16) || 0;
  }

  const alphaFrac = Math.max(0, Math.min(100, opacityPercent)) / 100;
  // Trong ASS: alpha 0 = hoàn toàn đặc (opaque), 255 = trong suốt
  const assAlpha = Math.round((1 - alphaFrac) * 255);

  const toHex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return `&H${toHex2(assAlpha)}${toHex2(b)}${toHex2(g)}${toHex2(r)}&`;
}

/** Chuyển đổi mili-giây sang định dạng timecode ASS H:MM:SS.cs (centiseconds) */
export function formatAssTime(ms: number): string {
  const totalCs = Math.floor(Math.max(0, ms) / 10);
  const cs = totalCs % 100;
  const totalS = Math.floor(totalCs / 100);
  const s = totalS % 60;
  const totalM = Math.floor(totalS / 60);
  const m = totalM % 60;
  const h = Math.floor(totalM / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Chuẩn hoá chuỗi text trong ASS: đổi ký tự xuống dòng thành \N */
function escapeAssText(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\\N')
    .replace(/[\r\n]/g, '\\N')
    .trim();
}

/**
 * Chuyển đổi văn bản thành dạng chữ xếp dọc (Vertical layout) bằng cách chèn ký tự \N ngắt dòng.
 * - Với Hán tự / CJK (tiếng Trung, Nhật, Hàn): ngắt sau từng ký tự (như câu đối / Douyin lyric).
 * - Với tiếng Việt / Latinh: ngắt theo từng từ để giữ nguyên nghĩa, hoặc ngắt theo từng chữ cái nếu là từ đơn.
 */
export function formatVerticalText(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  const hasCJK = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(trimmed);
  if (hasCJK) {
    return trimmed
      .split('')
      .filter((c) => c !== '\r' && c !== '\n')
      .join('\\N');
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words.join('\\N');
  }
  return trimmed
    .split('')
    .filter((c) => c !== '\r' && c !== '\n')
    .join('\\N');
}

/**
 * Tạo thẻ ghi đè (override tags) cho từng câu thoại
 */
export function buildEntryOverrideTags(
  style: SubtitleEntryStyle | undefined | null,
  videoWidth: number = 1920,
  videoHeight: number = 1080
): string {
  if (!style) return '';

  const tags: string[] = [];

  // Màu chữ chính
  if (style.textColorHex) {
    tags.push(`\\c${hexToAssColor(style.textColorHex, style.opacity ?? 100)}`);
  }

  // Màu viền
  if (style.outlineColorHex) {
    tags.push(`\\3c${hexToAssColor(style.outlineColorHex, 100)}`);
  }

  // Độ dày viền
  if (style.outlineWidth !== undefined && Number.isFinite(style.outlineWidth)) {
    tags.push(`\\bord${Math.max(0, Math.min(10, style.outlineWidth))}`);
  }

  // Bóng đổ
  if (style.shadowDepth !== undefined && Number.isFinite(style.shadowDepth)) {
    tags.push(`\\shad${Math.max(0, Math.min(8, style.shadowDepth))}`);
  }

  // Cỡ chữ
  if (style.fontSize !== undefined && Number.isFinite(style.fontSize)) {
    tags.push(`\\fs${Math.max(10, Math.min(99, Math.round(style.fontSize)))}`);
  }

  // Tên font
  if (style.fontName) {
    const safeFont = style.fontName.replace(/[^A-Za-z0-9 _-]/g, '').trim();
    if (safeFont) tags.push(`\\fn${safeFont}`);
  }

  // In đậm
  if (style.bold !== undefined) {
    tags.push(`\\b${style.bold ? 1 : 0}`);
  }

  // In nghiêng
  if (style.italic !== undefined) {
    tags.push(`\\i${style.italic ? 1 : 0}`);
  }

  // Căn lề Numpad (1..9)
  if (style.alignment !== undefined && style.alignment >= 1 && style.alignment <= 9) {
    tags.push(`\\an${style.alignment}`);
  }

  // Tọa độ tự do (pos)
  if (style.posPercent && Number.isFinite(style.posPercent.x) && Number.isFinite(style.posPercent.y)) {
    const px = Math.round((style.posPercent.x / 100) * videoWidth);
    const py = Math.round((style.posPercent.y / 100) * videoHeight);
    tags.push(`\\pos(${px},${py})`);
  }

  // Hiệu ứng mờ dần vào/ra
  if (style.fadeInMs || style.fadeOutMs) {
    tags.push(`\\fad(${style.fadeInMs || 0},${style.fadeOutMs || 0})`);
  }

  return tags.length > 0 ? `{${tags.join('')}}` : '';
}

export interface CompileToAssOptions {
  globalStyle?: Partial<GlobalAssStyle>;
  videoWidth?: number;
  videoHeight?: number;
  title?: string;
  /** Track phụ đề thứ 2 (Ví dụ: Lời bài hát gốc hoặc song ngữ) */
  secondaryItems?: CompileSubtitleItem[];
  secondaryStyle?: Partial<GlobalAssStyle>;
}

/**
 * Biên dịch danh sách câu thoại thành chuỗi nội dung file ASS hoàn chỉnh
 */
export function compileToAss(
  items: CompileSubtitleItem[],
  options?: CompileToAssOptions
): string {
  const width = options?.videoWidth || 384;
  const height = options?.videoHeight || 288;
  const g = { ...DEFAULT_GLOBAL_STYLE, ...options?.globalStyle };
  const safeMarginV = Math.min(120, Math.max(0, g.marginV ?? 25));
  const safeMarginH = Math.min(150, Math.max(0, g.marginH ?? 20));

  const isBox = g.borderStyle === 3;
  const primaryColAss = hexToAssColor(g.primaryColour, g.opacity);
  const outlineColAss = hexToAssColor(g.outlineColour, 100);
  const backColAss = isBox ? hexToAssColor(g.outlineColour, 95) : '&H80000000&';
  const effectiveOutline = isBox && g.outline === 0 ? 3 : g.outline;
  const effectiveShadow = isBox ? 0 : g.shadow;

  const scriptInfo = [
    '[Script Info]',
    `Title: ${options?.title || 'VANHSUB Mini CapCut Export'}`,
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.601',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    '',
  ].join('\n');

  const styles = [
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${g.fontName},${g.fontSize},${primaryColAss},&H000000FF&,${outlineColAss},${backColAss},${g.bold ? 1 : 0},0,0,0,100,100,0,0,${g.borderStyle},${effectiveOutline},${effectiveShadow},${g.alignment},${safeMarginH},${safeMarginH},${safeMarginV},1`,
  ];

  // Track phụ đề thứ 2 (Song ngữ / Lời nhạc gốc)
  const hasSecondary = options?.secondaryItems && options.secondaryItems.length > 0;
  let secGlobal: GlobalAssStyle | null = null;
  if (hasSecondary) {
    secGlobal = {
      ...DEFAULT_GLOBAL_STYLE,
      fontName: 'Arial',
      fontSize: 18,
      primaryColour: '#FFE135',
      outlineColour: '#000000',
      alignment: 4, // Mặc định: Giữa trái (Cạnh trái)
      marginV: 25,
      marginH: 35,
      isVertical: true, // Mặc định: Xếp dọc
      ...options?.secondaryStyle,
    };
    const sMarginH = Math.min(150, Math.max(0, secGlobal.marginH ?? 35));
    const sMarginV = Math.min(120, Math.max(0, secGlobal.marginV ?? 25));
    const sIsBox = secGlobal.borderStyle === 3;
    const sPrimaryCol = hexToAssColor(secGlobal.primaryColour, secGlobal.opacity);
    const sOutlineCol = hexToAssColor(secGlobal.outlineColour, 100);
    const sBackCol = sIsBox ? hexToAssColor(secGlobal.outlineColour, 95) : '&H80000000&';
    const sOutline = sIsBox && secGlobal.outline === 0 ? 3 : secGlobal.outline;
    const sShadow = sIsBox ? 0 : secGlobal.shadow;

    styles.push(
      `Style: Secondary,${secGlobal.fontName},${secGlobal.fontSize},${sPrimaryCol},&H000000FF&,${sOutlineCol},${sBackCol},${secGlobal.bold ? 1 : 0},0,0,0,100,100,0,0,${secGlobal.borderStyle},${sOutline},${sShadow},${secGlobal.alignment},${sMarginH},${sMarginH},${sMarginV},1`
    );
  }
  styles.push('');

  interface OutputLine {
    startMs: number;
    endMs: number;
    styleName: string;
    text: string;
    overrides: string;
  }

  const allLines: OutputLine[] = [];

  // Track 1 (Chính: Thường là bản dịch)
  items.forEach((item) => {
    const isVert = item.style?.isVertical !== undefined ? item.style.isVertical : !!g.isVertical;
    let textStr = escapeAssText(item.text);
    if (isVert) {
      textStr = formatVerticalText(textStr);
    }
    const overrides = buildEntryOverrideTags(item.style, width, height);
    allLines.push({
      startMs: item.startMs,
      endMs: item.endMs,
      styleName: 'Default',
      text: textStr,
      overrides,
    });
  });

  // Track 2 (Phụ: Thường là lời bài hát gốc)
  if (hasSecondary && secGlobal && options?.secondaryItems) {
    const secStyleRef = secGlobal;
    options.secondaryItems.forEach((item) => {
      const isVert = item.style?.isVertical !== undefined ? item.style.isVertical : !!secStyleRef.isVertical;
      let textStr = escapeAssText(item.text);
      if (isVert) {
        textStr = formatVerticalText(textStr);
      }
      const overrides = buildEntryOverrideTags(item.style, width, height);
      allLines.push({
        startMs: item.startMs,
        endMs: item.endMs,
        styleName: 'Secondary',
        text: textStr,
        overrides,
      });
    });
  }

  // Sắp xếp các dòng theo thời gian bắt đầu
  allLines.sort((a, b) => a.startMs - b.startMs);

  const dialogueLines = allLines.map((line) => {
    const startStr = formatAssTime(line.startMs);
    const endStr = formatAssTime(line.endMs);
    return `Dialogue: 0,${startStr},${endStr},${line.styleName},,0,0,0,,${line.overrides}${line.text}`;
  });

  const events = ['[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...dialogueLines].join('\n');

  return `${scriptInfo}\n${styles.join('\n')}\n${events}\n`;
}
