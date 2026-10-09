// Shared SRT Parser/Serializer — dùng chung cho main process và renderer

export interface SrtWord {
  word: string;
  startMs: number;
  endMs: number;
  speaker?: string;
}

export interface SrtLine {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;          // e.g. "SPEAKER_00"
  words?: SrtWord[];         // word-level timestamps
  confidence?: number;
  frames?: number;
  stable?: boolean;
  needsReview?: boolean;
  /** In-memory evidence; SRT itself cannot serialize these fields. */
  source?: 'asr' | 'ocr' | 'hybrid';
  originalText?: string;
  speechStartMs?: number;
  speechEndMs?: number;
  displayStartMs?: number;
  displayEndMs?: number;
  sourceIds?: string[];
  evidenceConfidence?: { asr?: number; ocr?: number };
}

const SRT_TIME_RE = /^(\d{1,3}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/;
const SRT_TIME_RE_SHORT = /^(\d{1,3}):(\d{1,2})[,.](\d{1,3})$/;
const SRT_TIME_RE_SECONDS = /^(\d+)(?:[.,](\d{1,3}))?$/;

export function parseMsString(raw: string | number): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : 0;
  }
  const s = (raw || '').trim();
  if (!s) return 0;
  if (s.length === 1) {
    const n = Number(s);
    return Number.isFinite(n) ? n * 100 : 0;
  }
  if (s.length === 2) {
    const n = Number(s);
    return Number.isFinite(n) ? n * 10 : 0;
  }
  const n = Number(s.slice(0, 3));
  return Number.isFinite(n) ? n : 0;
}

/** @deprecated Dùng parseMsString thay thế để tránh mất số 0 ở đầu (leading zeros). */
export function padMs(value: number | string): number {
  return parseMsString(value);
}

/** Chuyển chuỗi thời gian ('00:01:05,500' | '01:05.5' | '65.5') sang mili-giây. Trả về null nếu không hợp lệ. */
export function parseTimecode(raw: string): number | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\s/g, '');

  const full = s.match(SRT_TIME_RE);
  if (full) {
    const [, h, m, sec, ms] = full;
    return (Number(h) * 3600 + Number(m) * 60 + Number(sec)) * 1000 + parseMsString(ms);
  }

  const short = s.match(SRT_TIME_RE_SHORT);
  if (short) {
    const [, m, sec, ms] = short;
    return (Number(m) * 60 + Number(sec)) * 1000 + parseMsString(ms);
  }

  const seconds = s.match(SRT_TIME_RE_SECONDS);
  if (seconds) {
    return Number(seconds[1]) * 1000 + (seconds[2] ? parseMsString(seconds[2]) : 0);
  }

  return null;
}

/** Chuyển mili-giây sang định dạng SRT 'HH:MM:SS,mmm'. */
export function formatMs(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const milli = clamped % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

const BLOCK_TIME_RE = /(\d{1,3}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d{1,3}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

/** Parse nội dung file .srt thành danh sách dòng phụ đề (ms), tự động phát hiện [SPEAKER_XX]:. */
export function parseSrt(srtText: string): SrtLine[] {
  const cleaned = srtText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const blocks = cleaned.trim().split(/\n\s*\n/);
  const result: SrtLine[] = [];

  for (const block of blocks) {
    const rows = block.split('\n');
    const timeRowIndex = rows.findIndex((row) => row.includes('-->'));
    if (timeRowIndex === -1) continue;

    const timeMatch = rows[timeRowIndex].match(BLOCK_TIME_RE);
    if (!timeMatch) continue;

    const startMs =
      (Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3])) * 1000 +
      parseMsString(timeMatch[4]);
    const endMs =
      (Number(timeMatch[5]) * 3600 + Number(timeMatch[6]) * 60 + Number(timeMatch[7])) * 1000 +
      parseMsString(timeMatch[8]);

    const rawText = rows.slice(timeRowIndex + 1).join('\n').trim();
    let speaker: string | undefined;
    let text = rawText;

    const speakerMatch = rawText.match(/^\[([A-Za-z0-9_ -]+)\]:\s*([\s\S]*)$/);
    if (speakerMatch) {
      speaker = speakerMatch[1].trim();
      text = speakerMatch[2].trim();
    }

    result.push({
      id: `line-${result.length}`,
      startMs,
      endMs,
      text,
      ...(speaker ? { speaker } : {}),
    });
  }

  return result;
}

/** Strict import for stages that must never silently drop or re-time speech. */
export function parseSrtStrict(srtText: string): SrtLine[] {
  const expected = srtText.replace(/\r\n/g, '\n').split('\n').filter((row) => row.includes('-->')).length;
  const lines = parseSrt(srtText);
  if (lines.length !== expected) {
    throw new Error(`Malformed SRT: parsed ${lines.length} of ${expected} timecoded events`);
  }
  for (const line of lines) {
    if (!Number.isFinite(line.startMs) || !Number.isFinite(line.endMs) ||
        line.startMs < 0 || line.endMs <= line.startMs) {
      throw new Error(`Malformed SRT timestamp at ${line.id}: ${line.startMs}..${line.endMs}`);
    }
  }
  return lines;
}

/** Ghép danh sách dòng phụ đề thành nội dung file .srt chuẩn, bao gồm nhãn speaker nếu có. */
export function serializeSrt(lines: SrtLine[]): string {
  return (
    lines
      .map((line, index) => {
        let text = line.text.trim();
        if (line.speaker && !text.startsWith(`[${line.speaker}]:`)) {
          text = `[${line.speaker}]: ${text}`;
        }
        return `${index + 1}\n${formatMs(line.startMs)} --> ${formatMs(line.endMs)}\n${text}`;
      })
      .join('\n\n') + '\n'
  );
}
