import fs from 'node:fs';
import { parseSrt, formatMs } from './srt';
import type { SubtitleLine } from '../render/ttsEngine';

/** TTS numbering follows the editor's 1-based positions, including non-sequential imported SRTs. */
export function readTtsSubtitles(file: string): SubtitleLine[] {
  return parseSrt(fs.readFileSync(file, 'utf8')).map((line, i) => ({
    index: i + 1,
    startTime: formatMs(line.startMs),
    endTime: formatMs(line.endMs),
    startMs: line.startMs,
    endMs: line.endMs,
    durationMs: line.endMs - line.startMs,
    text: line.text,
    speaker: line.speaker,
  }));
}
