# Project: Nâng cấp Pipeline Phụ đề & TTS VanhSub (R1 - R3)

## Architecture
VanhSub subtitle and speech synthesis pipeline spans 3 core processing phases:
1. **Subtitle Acquisition & Optical Cleaning (R1)**:
   - Audio transcription via Faster-Whisper / whisper.cpp (`main/asr/`).
   - Video optical text extraction via PaddleOCR PP-OCRv5 (`main/ocr/`).
   - Garbage & Noise Sanitizer (`main/lib/subtitleSanitizer.ts`) detecting and removing single-char noise (`'c'`, `'A'`, `'.'`), floating symbols (`!/[\p{L}\p{N}]/u`), and ultra-short blocks (< 150ms).
   - Interactive cleanup trigger in `SubtitleEditor.tsx` with undo history and count notification.
2. **Visual Formatting & Prosodic Speech Synthesis (R2)**:
   - Clause consolidation & visual line breaking in `main/lib/nlpSegmenter.ts` (`consolidateSubtitleClauses` + `breakVietnameseLines`, max 37 chars/line, max 2 lines/block with `\n`).
   - Seamless TTS Sentence Grouping (`main/render/ttsEngine.ts`) grouping incomplete clauses (ending without `.`, `?`, `!`) into `SentenceGroup` for a single unified TTS generation call.
   - Gapless Timeline Muxing (`main/render/dubbingEngine.ts`) aligning audio over the full group slot without inserting artificial `apad` silence between clauses.
3. **Deterministic Deduplication & Cross-Modal Fusion (R3)**:
   - Deduplication Engine (`main/lib/subtitleDeduplication.ts`):
     - Exact duplicates merging consecutive identical lines within threshold gap.
     - Incremental / Progressive Karaoke overlap resolution (longest complete text from first start to final end).
     - Cross-modal Whisper-OCR deduplication and phonetic alignment with speech-only preservation.
   - Frame stability optimization in `main/ocr/subtitleBuilder.ts` (`selectStableText`).

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1.1 | Subtitle Sanitizer Module | Core rules (G1: single chars, G2: floating punctuation, G3: <150ms without Whisper audio, G4: Unicode glitches) | M1 | Survey R1 |
| F1.2 | Hybrid Fusion Garbage Rejection | Fix `fuseOcrAndWhisper` in `hybridFusionEngine.ts` to reject noise lines instead of classifying them as static banners | M1 | Survey R1 |
| F1.3 | SubtitleEditor Sanitizer Action | Add "Lọc rác & Làm sạch" button on `SubtitleEditor.tsx` toolbar with count badge and `pushUndo` support | M1 | Survey R1 |
| F2.1 | Smart Visual Line Wrapping | Implement `consolidateSubtitleClauses` in `nlpSegmenter.ts` to wrap long clauses into 2 lines (`\n`) under 74 chars without fragmenting timecodes | M2 | Survey R2 |
| F2.2 | Seamless TTS Sentence Grouping | Implement `groupSubtitlesForTts` and `SentenceGroup` in `ttsEngine.ts` to synthesize smooth sentences without pitch drops | M2 | Survey R2 |
| F2.3 | Audio Timeline Gapless Alignment | Update `mergeAudioFiles` in `dubbingEngine.ts` to stream sentence audio continuously without artificial padding gaps between clauses | M2 | Survey R2 |
| F3.1 | Deterministic Deduplication Engine | Implement `deduplicateExact`, `deduplicateProgressiveKaraoke`, and `deduplicateWhisperOcrCross` in `subtitleDeduplication.ts` | M3 | Survey R3 |
| F3.2 | OCR Subtitle Builder Stability Fix | Revise `selectStableText` in `subtitleBuilder.ts` to favor complete suffixes in progressive text over short prefixes | M3 | Survey R3 |
| F3.3 | Hybrid Fusion Cross-Dedup Integration | Integrate pre-deduplication and speech-only Whisper segment ingestion into `hybridFusionEngine.ts` and `hybridRunner.ts` | M3 | Survey R3 |
| F4.1 | Automated 4-Tier Test Suite | Comprehensive automated tests (Tiers 1-4) in `scripts/test_subtitle_tts_pipeline.ts` running via `npx tsx` | M-TEST | Acceptance Criteria |
| F4.2 | 100% E2E Pass & Hardening | Full integration pass across R1, R2, R3, Tier 5 Adversarial Hardening, and zero `npx tsc --noEmit` errors | M4 | Acceptance Criteria |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M-TEST | E2E Testing Suite (Tiers 1-4) | F4.1 | none | DONE |
| M1 | OCR Noise & Garbage Sanitizer (R1) | F1.1, F1.2, F1.3 | none | DONE |
| M2 | Smart Visual Wrapping & Seamless TTS (R2) | F2.1, F2.2, F2.3 | M1 | DONE |
| M3 | Deterministic Deduplication Engine (R3) | F3.1, F3.2, F3.3 | M1 | DONE |
| M4 | Final Integration, Hardening & Zero-Error Gate | F4.2 | M-TEST, M1, M2, M3 | DONE |

---

## Interface Contracts

### 1. `subtitleSanitizer.ts` (R1 - DONE)
```typescript
export interface SanitizeOptions {
  whisperSegments?: SrtLine[];
  minDurationMs?: number; // default: 150
  removeSingleChars?: boolean; // default: true
  removeFloatingPunctuation?: boolean; // default: true
}

export interface SanitizeResult {
  cleaned: SrtLine[];
  removedCount: number;
  removedItems: SrtLine[];
}

export function isOcrGarbageLine(line: SrtLine, options?: SanitizeOptions): boolean;
export function sanitizeSubtitles(lines: SrtLine[], options?: SanitizeOptions): SanitizeResult;
```

### 2. `nlpSegmenter.ts` (R2 Visual Wrapping - DONE)
```typescript
export interface ConsolidateOptions {
  maxCharsPerLine?: number; // default: 37
  maxLinesPerBlock?: number; // default: 2
  maxGapMs?: number; // default: 1000
}

export function consolidateSubtitleClauses(lines: SrtLine[], options?: ConsolidateOptions): SrtLine[];
```

### 3. `ttsEngine.ts` & `dubbingEngine.ts` (R2 Seamless TTS - DONE)
```typescript
export interface SentenceGroup {
  id: string;
  startIndex: number;
  endIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  voice: string;
  speed: number;
  engine: TTSEngine;
  subtitles: SubtitleLine[];
}

export function groupSubtitlesForTts(subtitles: SubtitleLine[], options: TTSOptions): SentenceGroup[];
```

### 4. `subtitleDeduplication.ts` (R3 Deduplication)
```typescript
export interface DedupOptions {
  maxGapMs?: number; // default: 1200
  levenshteinThreshold?: number; // default: 1
}

export function deduplicateExact(lines: SrtLine[], options?: DedupOptions): SrtLine[];
export function deduplicateProgressiveKaraoke(lines: SrtLine[], options?: DedupOptions): SrtLine[];
export function deduplicateWhisperOcrCross(ocrLines: SrtLine[], whisperLines: SrtLine[], options?: DedupOptions): SrtLine[];
export function deduplicateSubtitlesPipeline(lines: SrtLine[], options?: DedupOptions): SrtLine[];
```

---

## Code Layout
- `main/lib/subtitleSanitizer.ts`: Core OCR garbage detection and sanitizer algorithm. (DONE)
- `renderer/lib/subtitleSanitizer.ts`: Frontend re-export for React components. (DONE)
- `main/lib/subtitleDeduplication.ts`: Deterministic exact, progressive karaoke, and cross-modal deduplication. (NEXT)
- `renderer/lib/subtitleDeduplication.ts`: Frontend re-export for React components. (NEXT)
- `main/lib/nlpSegmenter.ts`: Visual clause consolidation and Vietnamese line wrapping. (DONE)
- `main/render/ttsEngine.ts`: TTS sentence grouping and prosodic audio synthesis. (DONE)
- `main/render/dubbingEngine.ts`: Gapless audio timeline concatenation. (DONE)
- `main/asr/hybridFusionEngine.ts`: Cross-modal fusion with garbage rejection & cross-deduplication.
- `main/asr/hybridRunner.ts`: Post-processing pipeline coordination.
- `main/ocr/subtitleBuilder.ts`: Frame text voting and prefix stability fix.
- `renderer/components/SubtitleEditor.tsx`: SubtitleEditor UI toolbar with "Lọc rác & Làm sạch" button. (DONE)
- `scripts/test_subtitle_tts_pipeline.ts`: 4-tier automated test suite. (DONE)
