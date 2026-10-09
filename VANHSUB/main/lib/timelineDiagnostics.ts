import type { SrtLine } from './srt';

export interface TimelineIssue {
  severity: 'error' | 'warning';
  code: 'invalid_time' | 'duplicate' | 'duplicate_id' | 'overlap' | 'long_event' |
    'merged_speakers' | 'asr_ocr_offset' | 'offset_drift';
  segmentId: string;
  relatedId?: string;
  detail: string;
}

/** Evidence-only checks. No event is moved or merged without source evidence. */
export function validateSubtitleTimeline(
  lines: SrtLine[],
  options: { mediaDurationMs?: number; longEventMs?: number } = {},
): TimelineIssue[] {
  const issues: TimelineIssue[] = [];
  const sorted = [...lines].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const seen = new Map<string, SrtLine>();
  const seenIds = new Map<string, SrtLine>();
  let firstHybridOffset: number | undefined;
  for (const line of sorted) {
    const earlierId = seenIds.get(line.id);
    if (earlierId) issues.push({ severity: 'error', code: 'duplicate_id', segmentId: line.id,
      relatedId: earlierId.id, detail: 'Segment identifier is reused' });
    else seenIds.set(line.id, line);
    const speakers = new Set(line.words?.map((word) => word.speaker).filter(Boolean));
    if (speakers.size > 1) issues.push({ severity: 'warning', code: 'merged_speakers', segmentId: line.id,
      detail: `Word evidence contains ${speakers.size} speakers` });
    if (line.source === 'hybrid' && Number.isFinite(line.speechStartMs) &&
        Number.isFinite(line.displayStartMs)) {
      const offset = line.speechStartMs! - line.displayStartMs!;
      if (Math.abs(offset) > 2000) issues.push({ severity: 'warning', code: 'asr_ocr_offset',
        segmentId: line.id, detail: `ASR/OCR start offset ${offset} ms` });
      if (firstHybridOffset === undefined) firstHybridOffset = offset;
      else if (Math.abs(offset - firstHybridOffset) > 500) {
        issues.push({ severity: 'warning', code: 'offset_drift', segmentId: line.id,
          detail: `ASR/OCR offset changed ${offset - firstHybridOffset} ms from first matched event` });
      }
    }
    const invalid = !Number.isFinite(line.startMs) || !Number.isFinite(line.endMs) ||
      line.startMs < 0 || line.endMs <= line.startMs ||
      (options.mediaDurationMs !== undefined && line.endMs > options.mediaDurationMs + 1);
    if (invalid) issues.push({ severity: 'error', code: 'invalid_time', segmentId: line.id,
      detail: `${line.startMs}..${line.endMs} ms` });
    if (!invalid && line.endMs - line.startMs > (options.longEventMs ?? 7000)) {
      issues.push({ severity: 'warning', code: 'long_event', segmentId: line.id,
        detail: `${line.endMs - line.startMs} ms` });
    }
    const key = `${line.startMs}|${line.endMs}|${line.text.trim().toLocaleLowerCase()}`;
    const duplicate = seen.get(key);
    if (duplicate) issues.push({ severity: 'warning', code: 'duplicate', segmentId: line.id,
      relatedId: duplicate.id, detail: 'Same text and interval' });
    else seen.set(key, line);
  }
  let active: SrtLine[] = [];
  for (const cur of sorted) {
    active = active.filter((prev) => Number.isFinite(prev.endMs) && prev.endMs > cur.startMs);
    for (const prev of active) {
      if (!prev.speaker || !cur.speaker || prev.speaker === cur.speaker) {
        issues.push({ severity: 'warning', code: 'overlap', segmentId: cur.id,
          relatedId: prev.id, detail: `${prev.endMs - cur.startMs} ms overlap` });
      }
    }
    if (Number.isFinite(cur.endMs)) active.push(cur);
  }
  return issues;
}
