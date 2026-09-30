/**
 * Kinetic Subtitles Engine for VANHSUB (R3)
 * Provides viral kinetic typography presets (Hormozi, MrBeast, Minimalist Glow)
 * with precise word timings, ASS override tags (\k, \c, \t, \fscx, \fscy, \blur, \p1),
 * emotion keyword analysis, and dynamic vector progress bars.
 */

import type { SrtLine, SrtWord } from '../lib/srt';
import { hexToAssColor, formatAssTime } from './assCompiler';

export type KineticPreset = 'none' | 'hormozi' | 'mrbeast' | 'minimalist_glow';

export interface KineticConfig {
  preset: KineticPreset;
  activeColor?: string;       // Hex color for highlight/karaoke, e.g. "#FFE500"
  enableEmoji?: boolean;      // For MrBeast preset
  emojiFrequency?: 'high' | 'medium' | 'low';
  enableProgressBar?: boolean;// For Minimalist Glow
  glowBlur?: number;          // \blur amount (default: 4)
  fontScale?: number;         // Scale factor (default: 1.0)
}

export interface WordTiming {
  word: string;
  startMs: number;            // Relative to subtitle line startMs
  endMs: number;              // Relative to subtitle line startMs
  durationMs: number;
  durationCs: number;         // Centiseconds (1 cs = 10 ms) for \k tags
}

export interface KineticCompiledLine {
  dialogueEvents: string[];   // Formatted ASS Dialogue: lines
  styles: string[];           // Additional ASS Style: lines required by preset
}

export interface EmojiRule {
  category: string;
  keywords: string[];
  emoji: string;
  highlightColor: string;
  priority: number;
}

export const EMOJI_RULES: EmojiRule[] = [
  {
    category: 'Money & Wealth',
    keywords: [
      'tiền', 'đô', 'triệu', 'tỷ', 'tỉ', 'giàu', 'thưởng', 'mua', 'usd', 'vnd',
      'cash', 'dollar', 'dollars', 'rich', 'prize', 'million', 'billion', 'jackpot', 'coin', 'coins',
    ],
    emoji: '💰',
    highlightColor: '#00FF66',
    priority: 10,
  },
  {
    category: 'Energy & Boom',
    keywords: [
      'cháy', 'đỉnh', 'siêu', 'bùng nổ', 'điên rồ', 'hot', 'cực phẩm',
      'fire', 'insane', 'crazy', 'huge', 'epic', 'boom', 'lit',
    ],
    emoji: '🔥',
    highlightColor: '#FF4500',
    priority: 9,
  },
  {
    category: 'Shock & Wonder',
    keywords: [
      'trời ơi', 'bất ngờ', 'sốc', 'kinh ngạc', 'ôi trời', 'kinh hoàng', 'sửng sốt',
      'omg', 'wow', 'unbelievable', 'shocked', 'impossible', 'no way',
    ],
    emoji: '😱',
    highlightColor: '#FFE600',
    priority: 8,
  },
  {
    category: 'Danger & Warning',
    keywords: [
      'nguy hiểm', 'cảnh báo', 'chú ý', 'dừng lại', 'tử vong', 'cẩn thận', 'tai nạn',
      'danger', 'warning', 'alert', 'trap', 'stop', 'caution',
    ],
    emoji: '⚠️',
    highlightColor: '#FF1E27',
    priority: 8,
  },
  {
    category: 'Speed & Time',
    keywords: [
      'nhanh', 'giây', 'phút', 'giờ', 'hết giờ', 'đếm ngược', 'tốc độ', 'khẩn cấp',
      'fast', 'quick', 'timer', 'countdown', 'hurry', 'speed',
    ],
    emoji: '⚡',
    highlightColor: '#00E5FF',
    priority: 7,
  },
  {
    category: 'Victory & Champion',
    keywords: [
      'thắng', 'vô địch', 'kỷ lục', 'thành công', 'top 1', 'chiến thắng', 'hạng nhất',
      'win', 'winner', 'champion', 'victory', 'best', 'record',
    ],
    emoji: '🏆',
    highlightColor: '#FFD700',
    priority: 7,
  },
  {
    category: 'Humor & Laugh',
    keywords: [
      'haha', 'cười', 'hài hước', 'vui', 'buồn cười', 'hài',
      'funny', 'laugh', 'lol', 'lmao',
    ],
    emoji: '😂',
    highlightColor: '#FFE135',
    priority: 6,
  },
  {
    category: 'Love & Heart',
    keywords: [
      'yêu', 'thương', 'cảm ơn', 'biết ơn', 'tình yêu', 'trân trọng',
      'love', 'heart', 'thank', 'thanks', 'grateful',
    ],
    emoji: '❤️',
    highlightColor: '#FF3366',
    priority: 5,
  },
];

/**
 * Calculates word-level timing breakdown for a subtitle line.
 * Uses exact Whisper word timestamps if available; otherwise performs
 * proportional character-length interpolation across the line's duration.
 */
export function calculateWordTimings(line: SrtLine): WordTiming[] {
  const lineDuration = Math.max(100, line.endMs - line.startMs);

  // Mode 1: Exact word timestamps from Whisper/CTranslate2
  if (line.words && line.words.length > 0) {
    const timings: WordTiming[] = [];
    for (const w of line.words) {
      const trimmed = w.word.trim();
      if (!trimmed) continue;

      let relStart = w.startMs >= line.startMs ? w.startMs - line.startMs : w.startMs;
      let relEnd = w.endMs >= line.startMs ? w.endMs - line.startMs : w.endMs;
      if (relStart < 0) relStart = 0;
      if (relEnd <= relStart) relEnd = relStart + 80;

      const durMs = Math.max(50, relEnd - relStart);
      const durCs = Math.max(1, Math.round(durMs / 10));

      timings.push({
        word: trimmed,
        startMs: relStart,
        endMs: relStart + durMs,
        durationMs: durMs,
        durationCs: durCs,
      });
    }

    if (timings.length > 0) {
      return timings;
    }
  }

  // Mode 2: Proportional character-length interpolation
  const rawWords = line.text
    .trim()
    .replace(/\\N/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (rawWords.length === 0) {
    return [];
  }

  // Weighted by character count (longer words take more phonation time)
  const charWeights = rawWords.map((w) => Math.max(1, Array.from(w).length));
  const totalWeight = charWeights.reduce((acc, curr) => acc + curr, 0);

  let accumulatedMs = 0;
  const result: WordTiming[] = [];

  for (let i = 0; i < rawWords.length; i++) {
    const isLast = i === rawWords.length - 1;
    const word = rawWords[i];
    const weight = charWeights[i];

    const durMs = isLast
      ? Math.max(50, lineDuration - accumulatedMs)
      : Math.max(50, Math.round((lineDuration * weight) / totalWeight));

    const durCs = Math.max(1, Math.round(durMs / 10));

    result.push({
      word,
      startMs: accumulatedMs,
      endMs: accumulatedMs + durMs,
      durationMs: durMs,
      durationCs: durCs,
    });

    accumulatedMs += durMs;
  }

  return result;
}

/**
 * Detects emotion keywords in a text line and returns matching emoji & highlight color.
 * Throttled according to emojiFrequency and priority ranking.
 */
export function detectEmoji(
  text: string,
  frequency: 'high' | 'medium' | 'low' = 'medium',
  lineIndex?: number
): { emoji: string; matchedKeyword: string; highlightColor: string; priority: number } | null {
  if (!text || !text.trim()) return null;

  // Throttling check
  if (lineIndex !== undefined) {
    if (frequency === 'medium' && lineIndex % 2 !== 0) return null;
    if (frequency === 'low' && lineIndex % 3 !== 0) return null;
  }

  const normalized = text.toLowerCase();
  let bestMatch: { emoji: string; matchedKeyword: string; highlightColor: string; priority: number } | null = null;

  for (const rule of EMOJI_RULES) {
    for (const kw of rule.keywords) {
      // Regex check: word boundary or surrounded by spaces/punctuation/start/end
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|\\s|[,.!?:;\\-–—"'\`\\(\\)])${escaped}($|\\s|[,.!?:;\\-–—"'\`\\(\\)])`, 'i');
      if (re.test(normalized)) {
        if (!bestMatch || rule.priority > bestMatch.priority) {
          bestMatch = {
            emoji: rule.emoji,
            matchedKeyword: kw,
            highlightColor: rule.highlightColor,
            priority: rule.priority,
          };
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Cleans text for ASS output (escapes backslashes, converts newlines to \N)
 */
function cleanAssText(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\\N')
    .replace(/[\r\n]/g, '\\N')
    .trim();
}

/**
 * Preset 1: Hormozi Style
 * - Uppercase bold typography with heavy black border.
 * - Word-level active neon karaoke highlight using ASS \k tags.
 * - Spotlight pulse using \t transformation (\fscx112\fscy112 -> \fscx100\fscy100).
 */
export function compileHormozi(
  line: SrtLine,
  config: KineticConfig,
  index: number,
  options: { videoWidth: number; videoHeight: number; defaultStyleName?: string; baseFontSize?: number }
): KineticCompiledLine {
  const fontScale = config.fontScale ?? 1.0;
  const baseSize = options.baseFontSize || 26;
  const fontSize = Math.round(baseSize * 1.35 * fontScale);

  const activeColor = config.activeColor || '#FFE500';
  const activeColAss = hexToAssColor(activeColor, 100);
  const normalColAss = hexToAssColor('#FFFFFF', 100);
  const outlineColAss = hexToAssColor('#000000', 100);

  const styleName = 'Hormozi';
  const marginV = Math.round(Math.min(120, Math.max(30, (options.videoHeight / 1080) * 45)));

  // Style definition for Hormozi:
  // PrimaryColour: highlight colour after/during \k sweep
  // SecondaryColour: normal colour before \k sweep
  // Outline: 6, Shadow: 1, Alignment: 2 (bottom center)
  const styleLine = `Style: ${styleName},Arial Black,${fontSize},${activeColAss},${normalColAss},${outlineColAss},&H00000000&,-1,0,0,0,100,100,0,0,1,6,1,2,20,20,${marginV},1`;

  const wordTimings = calculateWordTimings(line);
  const startStr = formatAssTime(line.startMs);
  const endStr = formatAssTime(line.endMs);

  let formattedWords: string[];
  if (wordTimings.length > 0) {
    formattedWords = wordTimings.map((w) => {
      const upper = w.word.toUpperCase();
      const popDuration = Math.min(80, Math.round(w.durationMs * 0.35));
      const popEnd = w.startMs + popDuration;
      // Combines \k duration in centiseconds with spotlight \t scaling
      return `{\\k${w.durationCs}\\t(${w.startMs},${popEnd},\\fscx112\\fscy112)\\t(${popEnd},${w.endMs},\\fscx100\\fscy100)}${upper}`;
    });
  } else {
    formattedWords = [cleanAssText(line.text).toUpperCase()];
  }

  const dialogueEvent = `Dialogue: 0,${startStr},${endStr},${styleName},,0,0,0,,${formattedWords.join(' ')}`;

  return {
    dialogueEvents: [dialogueEvent],
    styles: [styleLine],
  };
}

/**
 * Preset 2: MrBeast Style
 * - Explosive pop-in bounce animation (\fscx130\fscy130\t(0, 100, \fscx95\fscy95)\t(100, 180, \fscx100\fscy100)).
 * - Emotion keyword detection and dynamic emoji insertion.
 * - Heavy border (\bord6) and high-contrast typography.
 */
export function compileMrBeast(
  line: SrtLine,
  config: KineticConfig,
  index: number,
  options: { videoWidth: number; videoHeight: number; defaultStyleName?: string; baseFontSize?: number }
): KineticCompiledLine {
  const fontScale = config.fontScale ?? 1.0;
  const baseSize = options.baseFontSize || 26;
  const fontSize = Math.round(baseSize * 1.45 * fontScale);

  const styleName = 'MrBeast';
  const defaultHighlight = config.activeColor || '#00DEFF';
  const primaryColAss = hexToAssColor(defaultHighlight, 100);
  const outlineColAss = hexToAssColor('#000000', 100);
  const marginV = Math.round(Math.min(120, Math.max(35, (options.videoHeight / 1080) * 50)));

  const styleLine = `Style: ${styleName},Impact,${fontSize},${primaryColAss},&H000000FF&,${outlineColAss},&H00000000&,-1,0,0,0,100,100,0,0,1,6,2,2,25,25,${marginV},1`;

  const startStr = formatAssTime(line.startMs);
  const endStr = formatAssTime(line.endMs);

  let renderedText = cleanAssText(line.text).toUpperCase();

  // Keyword emotion matching & emoji badge
  if (config.enableEmoji !== false) {
    const match = detectEmoji(line.text, config.emojiFrequency ?? 'medium', index);
    if (match) {
      // Highlight matched keyword with specialized color
      const kwUpper = match.matchedKeyword.toUpperCase();
      const kwIdx = renderedText.indexOf(kwUpper);
      if (kwIdx !== -1) {
        const kwColAss = hexToAssColor(match.highlightColor, 100);
        renderedText =
          renderedText.substring(0, kwIdx) +
          `{\\c${kwColAss}}` +
          kwUpper +
          `{\\c${primaryColAss}}` +
          renderedText.substring(kwIdx + kwUpper.length);
      }
      renderedText += ` ${match.emoji}`;
    }
  }

  // Pop-in bounce formula: 130% -> 95% at 100ms -> 100% at 180ms
  const bounceTag = '{\\fscx130\\fscy130\\t(0,100,\\fscx95\\fscy95)\\t(100,180,\\fscx100\\fscy100)}';
  const dialogueEvent = `Dialogue: 0,${startStr},${endStr},${styleName},,0,0,0,,${bounceTag}${renderedText}`;

  return {
    dialogueEvents: [dialogueEvent],
    styles: [styleLine],
  };
}

/**
 * Preset 3: Minimalist Glow Style
 * - Elegant geometric sans-serif font (Segoe UI / Montserrat).
 * - Soft Gaussian blur aura (\blur4\bord2\3c...).
 * - Smooth animated reading progress bar via ASS vector drawing (\p1) with \fscx0 -> \fscx100 transformation.
 */
export function compileMinimalistGlow(
  line: SrtLine,
  config: KineticConfig,
  index: number,
  options: { videoWidth: number; videoHeight: number; defaultStyleName?: string; baseFontSize?: number }
): KineticCompiledLine {
  const fontScale = config.fontScale ?? 1.0;
  const baseSize = options.baseFontSize || 24;
  const fontSize = Math.round(baseSize * 1.1 * fontScale);

  const styleName = 'MinimalGlow';
  const glowColor = config.activeColor || '#00F5FF';
  const glowAssCol = hexToAssColor(glowColor, 100);
  const textAssCol = hexToAssColor('#FFFFFF', 100);
  const blurVal = config.glowBlur !== undefined ? Math.max(1, Math.min(10, config.glowBlur)) : 4;
  const marginV = Math.round(Math.min(120, Math.max(25, (options.videoHeight / 1080) * 40)));

  const styleLine = `Style: ${styleName},Segoe UI,${fontSize},${textAssCol},${textAssCol},${glowAssCol},&H80000000&,0,0,0,0,100,100,0,0,1,2,0,2,20,20,${marginV},1`;

  const startStr = formatAssTime(line.startMs);
  const endStr = formatAssTime(line.endMs);
  const durationMs = Math.max(150, line.endMs - line.startMs);

  const dialogueEvents: string[] = [];

  // Animated vector progress bar
  if (config.enableProgressBar !== false) {
    const barWidth = Math.round(Math.min(options.videoWidth * 0.55, Math.max(260, (options.videoWidth / 1920) * 480)));
    const barHeight = Math.round(Math.max(3, (options.videoHeight / 1080) * 4));
    const barX = Math.round((options.videoWidth - barWidth) / 2);
    const barY = Math.round(options.videoHeight - marginV + 15);

    // Layer 0: Background track (semi-transparent)
    dialogueEvents.push(
      `Dialogue: 0,${startStr},${endStr},${styleName},,0,0,0,,{\\an4\\pos(${barX},${barY})\\alpha&HAA&\\p1}m 0 0 l ${barWidth} 0 l ${barWidth} ${barHeight} l 0 ${barHeight}{\\p0}`
    );

    // Layer 1: Animated active fill (\fscx0 -> \fscx100)
    dialogueEvents.push(
      `Dialogue: 1,${startStr},${endStr},${styleName},,0,0,0,,{\\an4\\pos(${barX},${barY})\\1c${glowAssCol}\\fscx0\\t(0,${durationMs},\\fscx100)\\p1}m 0 0 l ${barWidth} 0 l ${barWidth} ${barHeight} l 0 ${barHeight}{\\p0}`
    );

    // Layer 2: Main subtitle text with glowing aura
    dialogueEvents.push(
      `Dialogue: 2,${startStr},${endStr},${styleName},,0,0,0,,{\\an2\\blur${blurVal}\\bord2\\3c${glowAssCol}}${cleanAssText(line.text)}`
    );
  } else {
    // Only glow subtitle text
    dialogueEvents.push(
      `Dialogue: 0,${startStr},${endStr},${styleName},,0,0,0,,{\\an2\\blur${blurVal}\\bord2\\3c${glowAssCol}}${cleanAssText(line.text)}`
    );
  }

  return {
    dialogueEvents,
    styles: [styleLine],
  };
}

/**
 * Main dispatcher: Compiles an SrtLine into ASS events & styles according to KineticConfig.
 */
export function compileKineticDialogue(
  line: SrtLine,
  config: KineticConfig,
  index: number,
  options: { videoWidth: number; videoHeight: number; defaultStyleName?: string; baseFontSize?: number }
): KineticCompiledLine {
  if (!config || config.preset === 'none') {
    return {
      dialogueEvents: [],
      styles: [],
    };
  }

  switch (config.preset) {
    case 'hormozi':
      return compileHormozi(line, config, index, options);
    case 'mrbeast':
      return compileMrBeast(line, config, index, options);
    case 'minimalist_glow':
      return compileMinimalistGlow(line, config, index, options);
    default:
      return { dialogueEvents: [], styles: [] };
  }
}
