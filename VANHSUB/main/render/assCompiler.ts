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
  alignment?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; // Numpad: 2 đáy-giữa, 8 đỉnh-giữa, 5 chính-giữa
  marginV?: number;           // Khoảng cách lề dọc
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
  marginV: 30,
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

/**
 * Biên dịch danh sách câu thoại thành chuỗi nội dung file ASS hoàn chỉnh
 */
export function compileToAss(
  items: CompileSubtitleItem[],
  options?: {
    globalStyle?: Partial<GlobalAssStyle>;
    videoWidth?: number;
    videoHeight?: number;
    title?: string;
  }
): string {
  const width = options?.videoWidth || 1920;
  const height = options?.videoHeight || 1080;
  const g = { ...DEFAULT_GLOBAL_STYLE, ...options?.globalStyle };

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

  const stylesHeader = [
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${g.fontName},${g.fontSize},${primaryColAss},&H000000FF&,${outlineColAss},${backColAss},${g.bold ? 1 : 0},0,0,0,100,100,0,0,${g.borderStyle},${effectiveOutline},${effectiveShadow},${g.alignment},20,20,${g.marginV},1`,
    '',
  ].join('\n');

  const dialogueLines = items.map((item) => {
    const startStr = formatAssTime(item.startMs);
    const endStr = formatAssTime(item.endMs);
    const overrides = buildEntryOverrideTags(item.style, width, height);
    const textStr = escapeAssText(item.text);
    return `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${overrides}${textStr}`;
  });

  const events = ['[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...dialogueLines].join('\n');

  return `${scriptInfo}\n${stylesHeader}\n${events}\n`;
}
