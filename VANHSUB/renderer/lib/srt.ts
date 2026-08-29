// Parser/serializer file .srt tự viết — chấp nhận cả dấu ',' và '.' phần mili-giây,
// text mỗi khối có thể gồm nhiều dòng, không bắt buộc có số thứ tự.

export interface SrtLine {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

const SRT_TIME_RE = /^(\d{1,3}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/;
const SRT_TIME_RE_SHORT = /^(\d{1,3}):(\d{1,2})[,.](\d{1,3})$/;
const SRT_TIME_RE_SECONDS = /^(\d+)(?:[.,](\d{1,3}))?$/;

// Người dùng gõ ".5" nghĩa là 500ms (mili-giây luôn ghi đủ 3 chữ số trong SRT)
function padMs(value: number): number {
  return value < 10 ? value * 100 : value < 100 ? value * 10 : value;
}

/** Chuyển chuỗi thời gian ('00:01:05,500' | '01:05.5' | '65.5') sang mili-giây. Trả về null nếu không hợp lệ. */
export function parseTimecode(raw: string): number | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\s/g, '');

  const full = s.match(SRT_TIME_RE);
  if (full) {
    const [, h, m, sec, ms] = full;
    return (Number(h) * 3600 + Number(m) * 60 + Number(sec)) * 1000 + padMs(Number(ms));
  }

  const short = s.match(SRT_TIME_RE_SHORT);
  if (short) {
    const [, m, sec, ms] = short;
    return (Number(m) * 60 + Number(sec)) * 1000 + padMs(Number(ms));
  }

  const seconds = s.match(SRT_TIME_RE_SECONDS);
  if (seconds) {
    return Number(seconds[1]) * 1000 + (seconds[2] ? padMs(Number(seconds[2])) : 0);
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

/** Parse nội dung file .srt thành danh sách dòng phụ đề (ms). */
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
      padMs(Number(timeMatch[4]));
    const endMs =
      (Number(timeMatch[5]) * 3600 + Number(timeMatch[6]) * 60 + Number(timeMatch[7])) * 1000 +
      padMs(Number(timeMatch[8]));

    const text = rows.slice(timeRowIndex + 1).join('\n').trim();
    result.push({
      id: `line-${result.length}`,
      startMs,
      endMs,
      text,
    });
  }

  return result;
}

/** Ghép danh sách dòng phụ đề thành nội dung file .srt chuẩn. */
export function serializeSrt(lines: SrtLine[]): string {
  return (
    lines
      .map((line, index) => `${index + 1}\n${formatMs(line.startMs)} --> ${formatMs(line.endMs)}\n${line.text.trim()}`)
      .join('\n\n') + '\n'
  );
}
