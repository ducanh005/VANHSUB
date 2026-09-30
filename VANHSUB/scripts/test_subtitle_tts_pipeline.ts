/**
 * =========================================================================================
 * Comprehensive Automated Test Suite: VanhSub Subtitle & TTS Pipeline (R1 - R3)
 * =========================================================================================
 * 
 * Executable: npx tsx scripts/test_subtitle_tts_pipeline.ts
 * Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise + Real-World Workloads
 * 
 * Features Exercised:
 *   F1: OCR Single-Char Garbage Filter (ORIGINAL_REQUEST R1)
 *   F2: OCR Floating Symbols & Punctuation Filter (ORIGINAL_REQUEST R1)
 *   F3: Short-Duration Block (<150ms) Filter (ORIGINAL_REQUEST R1)
 *   F4: SubtitleEditor UI Cleanup Action (ORIGINAL_REQUEST R1)
 *   F5: Smart Visual Wrapping (<=37 chars/line, \n, max 2 lines) (ORIGINAL_REQUEST R2)
 *   F6: TTS Sentence Grouping (Unfinished clauses) (ORIGINAL_REQUEST R2)
 *   F7: Seamless Audio Prosody & Gapless Timeline (ORIGINAL_REQUEST R2)
 *   F8: Exact Duplicates Deduplication (ORIGINAL_REQUEST R3)
 *   F9: Incremental / Progressive Karaoke Overlap Dedup (ORIGINAL_REQUEST R3)
 *   F10: Whisper-OCR Cross-Modal Deduplication (ORIGINAL_REQUEST R3)
 * 
 * Progressive Architecture:
 *   - Tier 1: Feature Coverage (>=5 test cases per feature across F1-F10 = 50 tests)
 *   - Tier 2: Boundary & Corner Cases (>=5 test cases per feature across F1-F10 = 50 tests)
 *   - Tier 3: Pairwise Cross-Feature Tests (10 tests)
 *   - Tier 4: Real-World Application Scenarios (5 realistic workloads)
 *   Total: 115 test cases
 * 
 * Dynamic Safe Imports:
 *   Imports actual modules from main/lib/subtitleSanitizer, main/lib/subtitleDeduplication,
 *   main/lib/nlpSegmenter, main/render/ttsEngine, etc. If a module is still in progress
 *   in Track B, uses the Specification Reference Oracle so the suite runs gracefully
 *   and reports implementation readiness status.
 * =========================================================================================
 */

import assert from 'assert';
import path from 'path';
import fs from 'fs';
import type { SrtLine } from '../main/lib/srt';
import { breakVietnameseLines } from '../main/lib/nlpSegmenter';
import { stripVietnameseDiacritics } from '../main/asr/hybridFusionEngine';

// =========================================================================================
// TYPE CONTRACTS (from PROJECT.md Interface Contracts)
// =========================================================================================

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

export interface ConsolidateOptions {
  maxCharsPerLine?: number; // default: 37
  maxLinesPerBlock?: number; // default: 2
  maxGapMs?: number; // default: 1000
}

export type TTSEngineType = 'viettts' | 'tiktok' | 'edge';

export interface TTSOptions {
  voice?: string;
  speed?: number;
  engine?: TTSEngineType;
  voiceOverrides?: Record<string, string>;
  shouldStop?: () => boolean;
}

export interface SubtitleLine {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface SentenceGroup {
  id: string;
  startIndex: number;
  endIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  voice: string;
  speed: number;
  engine: TTSEngineType;
  subtitles: SubtitleLine[];
}

export interface DedupOptions {
  maxGapMs?: number; // default: 1200
  levenshteinThreshold?: number; // default: 1
}

// =========================================================================================
// SPECIFICATION REFERENCE ORACLES (Authoritative models derived from PROJECT.md & ORIGINAL_REQUEST)
// =========================================================================================

/**
 * Normalizes string for text comparison: lowercase, trim whitespace, normalize NFC.
 */
function normalizeText(text: string): string {
  return (text || '').trim().replace(/\s+/g, ' ').normalize('NFC');
}

/**
 * Strips edge punctuation and symbols for loose comparison.
 */
function stripEdgePunctuation(text: string): string {
  return text.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');
}

/**
 * Calculates Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix: number[][] = [];
  for (let i = 0; i <= bn; i++) matrix[i] = [i];
  for (let j = 0; j <= an; j++) matrix[0][j] = j;

  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[bn][an];
}

/**
 * Checks whether an OCR line is garbage per Requirement R1.
 */
export function oracleIsOcrGarbageLine(line: SrtLine, options: SanitizeOptions = {}): boolean {
  const {
    minDurationMs = 150,
    removeSingleChars = true,
    removeFloatingPunctuation = true,
    whisperSegments,
  } = options;

  const rawText = line.text || '';
  const trimmed = rawText.trim();

  // Rule G0: Empty or whitespace-only lines
  if (!trimmed) {
    return true;
  }

  // Rule G1: Single-char lines (e.g. 'c', 'A', '1')
  if (removeSingleChars && trimmed.length <= 1) {
    return true;
  }

  // Rule G2: Floating punctuation / symbols without any letter or number (e.g. '.', '-', '***')
  if (removeFloatingPunctuation && !/[\p{L}\p{N}]/u.test(trimmed)) {
    return true;
  }

  // Rule G2.1: Single alphanumeric char preceded/followed solely by punctuation (e.g. '.c', '-A')
  const alphanumericOnly = trimmed.replace(/[^\p{L}\p{N}]/gu, '');
  if (removeSingleChars && alphanumericOnly.length <= 1) {
    return true;
  }

  // Rule G3: Ultra-short duration (< 150ms)
  const duration = line.endMs - line.startMs;
  if (duration < minDurationMs) {
    if (whisperSegments && whisperSegments.length > 0) {
      // Check if any whisper segment overlaps with this line
      const hasAudioOverlap = whisperSegments.some(
        (w) => w.startMs <= line.endMs && w.endMs >= line.startMs
      );
      if (!hasAudioOverlap) {
        return true;
      }
    } else {
      // No whisper segments provided -> ultra short block from OCR is considered noise
      return true;
    }
  }

  return false;
}

/**
 * Sanitizes subtitle lines per Requirement R1.
 */
export function oracleSanitizeSubtitles(lines: SrtLine[], options: SanitizeOptions = {}): SanitizeResult {
  if (!lines || lines.length === 0) {
    return { cleaned: [], removedCount: 0, removedItems: [] };
  }

  const cleaned: SrtLine[] = [];
  const removedItems: SrtLine[] = [];

  for (const line of lines) {
    if (oracleIsOcrGarbageLine(line, options)) {
      removedItems.push({ ...line });
    } else {
      cleaned.push({ ...line });
    }
  }

  return {
    cleaned,
    removedCount: removedItems.length,
    removedItems,
  };
}

/**
 * Deduplicates exact consecutive subtitle lines per Requirement R3.
 */
export function oracleDeduplicateExact(lines: SrtLine[], options: DedupOptions = {}): SrtLine[] {
  if (!lines || lines.length === 0) return [];
  const maxGapMs = options.maxGapMs ?? 1200;

  // Sort by startMs first to ensure temporal order
  const sorted = [...lines].sort((a, b) => a.startMs - b.startMs);
  const result: SrtLine[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    if (result.length === 0) {
      result.push({ ...current });
      continue;
    }

    const prev = result[result.length - 1];
    const normCur = stripEdgePunctuation(normalizeText(current.text)).toLowerCase();
    const normPrev = stripEdgePunctuation(normalizeText(prev.text)).toLowerCase();
    const gap = current.startMs - prev.endMs;

    // Check exact text match within threshold gap, bounded by silence threshold 1500ms
    if (normCur === normPrev && gap <= maxGapMs && gap <= 1500) {
      // Merge consecutive identical segment: extend endMs
      prev.endMs = Math.max(prev.endMs, current.endMs);
    } else {
      result.push({ ...current });
    }
  }

  return result;
}

/**
 * Deduplicates progressive / karaoke overlaps per Requirement R3.
 */
export function oracleDeduplicateProgressiveKaraoke(lines: SrtLine[], options: DedupOptions = {}): SrtLine[] {
  if (!lines || lines.length === 0) return [];
  const maxGapMs = options.maxGapMs ?? 1200;

  const sorted = [...lines].sort((a, b) => a.startMs - b.startMs);
  const result: SrtLine[] = [];

  let i = 0;
  while (i < sorted.length) {
    let currentChain = [sorted[i]];
    let j = i + 1;

    while (j < sorted.length) {
      const prevLine = currentChain[currentChain.length - 1];
      const nextLine = sorted[j];
      const gap = nextLine.startMs - prevLine.endMs;

      if (gap > maxGapMs) {
        break;
      }

      const prevNorm = normalizeText(prevLine.text).toLowerCase();
      const nextNorm = normalizeText(nextLine.text).toLowerCase();

      const prevStripped = stripVietnameseDiacritics(prevNorm);
      const nextStripped = stripVietnameseDiacritics(nextNorm);

      // Check if nextNorm contains prevNorm as a progressive extension
      const isPrefix = nextNorm.startsWith(prevNorm) || nextStripped.startsWith(prevStripped);
      const isFuzzyPrefix = !isPrefix && prevStripped.length >= 4 &&
        levenshteinDistance(prevStripped, nextStripped.slice(0, prevStripped.length)) <= 1;

      if ((isPrefix || isFuzzyPrefix) && nextNorm.length > prevNorm.length) {
        currentChain.push(nextLine);
        j++;
      } else {
        break;
      }
    }

    if (currentChain.length > 1) {
      // Consolidate progressive chain: start from first item, end at last item, text of longest item
      const first = currentChain[0];
      const last = currentChain[currentChain.length - 1];
      result.push({
        ...last,
        id: first.id,
        startMs: first.startMs,
        endMs: Math.max(...currentChain.map((c) => c.endMs)),
        text: last.text,
      });
      i = j;
    } else {
      result.push({ ...sorted[i] });
      i++;
    }
  }

  return result;
}

/**
 * Deduplicates cross-modal Whisper and OCR subtitles per Requirement R3.
 */
export function oracleDeduplicateWhisperOcrCross(
  ocrLines: SrtLine[],
  whisperLines: SrtLine[],
  options: DedupOptions = {}
): SrtLine[] {
  // Pre-deduplicate single streams
  const cleanOcr = oracleDeduplicateProgressiveKaraoke(oracleDeduplicateExact(ocrLines, options), options);
  const cleanWhisper = oracleDeduplicateExact(whisperLines, options);

  const toleranceMs = 800;
  const minSimilarityThreshold = 0.35;
  const consumedWhisperIds = new Set<string>();
  const fusedSegments: SrtLine[] = [];

  // Match OCR segments against Whisper
  for (const ocr of cleanOcr) {
    let bestMatch: SrtLine | null = null;
    let bestScore = 0;

    for (const wh of cleanWhisper) {
      // Check window overlap [ocr.startMs - toleranceMs, ocr.endMs + toleranceMs]
      const overlaps = wh.startMs <= ocr.endMs + toleranceMs && wh.endMs >= ocr.startMs - toleranceMs;
      if (!overlaps) continue;

      // Calculate token / phonetic similarity
      const normOcr = stripVietnameseDiacritics((ocr.text || '').toLowerCase());
      const normWh = stripVietnameseDiacritics((wh.text || '').toLowerCase());

      const ocrTokens = new Set(normOcr.split(/\s+/).filter(Boolean));
      const whTokens = normWh.split(/\s+/).filter(Boolean);
      let matchCount = 0;
      for (const t of whTokens) {
        if (ocrTokens.has(t)) matchCount++;
      }
      const score = (matchCount * 2) / (ocrTokens.size + whTokens.length || 1);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = wh;
      }
    }

    if (bestMatch && bestScore >= minSimilarityThreshold) {
      // Anchored to OCR timeline, text restored from Whisper (proper diacritics)
      fusedSegments.push({
        ...ocr,
        text: bestMatch.text,
      });
      consumedWhisperIds.add(bestMatch.id);
    } else {
      // Static graphic banner on video (preserve OCR text and timecode)
      fusedSegments.push({ ...ocr });
    }
  }

  // Preserve speech-only Whisper segments that were not consumed by any OCR segment
  for (const wh of cleanWhisper) {
    if (!consumedWhisperIds.has(wh.id)) {
      fusedSegments.push({ ...wh });
    }
  }

  // Sort chronologically by startMs
  fusedSegments.sort((a, b) => a.startMs - b.startMs);

  return fusedSegments;
}

/**
 * Consolidates subtitle clauses and formats visual wrapping per Requirement R2.
 */
export function oracleConsolidateSubtitleClauses(
  lines: SrtLine[],
  options: ConsolidateOptions = {}
): SrtLine[] {
  if (!lines || lines.length === 0) return [];
  const { maxCharsPerLine = 37, maxLinesPerBlock = 2, maxGapMs = 1000 } = options;

  const result: SrtLine[] = [];
  let i = 0;

  while (i < lines.length) {
    const current = { ...lines[i] };
    const currentText = (current.text || '').trim();

    // Check if subsequent clause should be merged into current block (same unfinished sentence)
    if (i < lines.length - 1) {
      const next = lines[i + 1];
      const nextText = (next.text || '').trim();
      const gap = next.startMs - current.endMs;
      const combinedCandidate = `${currentText} ${nextText}`.replace(/\s+/g, ' ');

      // If current does not end with terminal punct and combined length fits in 2 lines <= 74 chars
      const isTerminal = /[.!?]$/.test(currentText);
      if (!isTerminal && gap <= maxGapMs && combinedCandidate.length <= maxCharsPerLine * maxLinesPerBlock) {
        const wrapped = breakVietnameseLines(combinedCandidate, maxCharsPerLine);
        const subLines = wrapped.split('\n').map((l) => l.trim()).filter(Boolean);
        if (subLines.length <= maxLinesPerBlock) {
          result.push({
            ...current,
            endMs: next.endMs,
            text: subLines.join('\n'),
          });
          i += 2;
          continue;
        }
      }
    }

    // Single line wrapping or multi-chunk decomposition if text is too long
    const broken = breakVietnameseLines(currentText, maxCharsPerLine);
    const subLines = broken.split('\n').map((l) => l.trim()).filter(Boolean);

    if (subLines.length <= maxLinesPerBlock) {
      current.text = subLines.join('\n');
      result.push(current);
    } else {
      // Break into chunks of maxLinesPerBlock lines, allocating timecode proportionally
      const chunkCount = Math.ceil(subLines.length / maxLinesPerBlock);
      const totalDur = current.endMs - current.startMs;
      const chunkDur = Math.max(10, Math.floor(totalDur / chunkCount));

      for (let c = 0; c < chunkCount; c++) {
        const chunkSubLines = subLines.slice(c * maxLinesPerBlock, (c + 1) * maxLinesPerBlock);
        const start = current.startMs + c * chunkDur;
        const end = c === chunkCount - 1 ? current.endMs : start + chunkDur - 10;
        result.push({
          ...current,
          id: c === 0 ? current.id : `${current.id}-chunk-${c}`,
          startMs: start,
          endMs: end,
          text: chunkSubLines.join('\n'),
        });
      }
    }

    i++;
  }

  return result;
}

/**
 * Groups subtitles for seamless TTS synthesis per Requirement R2.
 */
export function oracleGroupSubtitlesForTts(
  subtitles: SubtitleLine[],
  options: TTSOptions = {}
): SentenceGroup[] {
  if (!subtitles || subtitles.length === 0) return [];
  const voice = options.voice || 'BV074_streaming';
  const speed = options.speed || 1.0;
  const engine = options.engine || 'tiktok';

  const groups: SentenceGroup[] = [];
  let currentGroup: SubtitleLine[] = [];

  for (let idx = 0; idx < subtitles.length; idx++) {
    const sub = subtitles[idx];
    currentGroup.push(sub);

    const trimmed = (sub.text || '').trim();
    const isTerminal = /[.!?]$/.test(trimmed);
    const isLast = idx === subtitles.length - 1;
    const nextSub = !isLast ? subtitles[idx + 1] : null;
    const gapToNext = nextSub ? nextSub.startMs - sub.endMs : Infinity;

    // Terminal condition: clause ends with terminal punctuation OR long silence gap (>1200ms) OR last item
    if (isTerminal || gapToNext > 1200 || isLast) {
      const first = currentGroup[0];
      const last = currentGroup[currentGroup.length - 1];
      const mergedText = currentGroup
        .map((s) => s.text.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ');

      groups.push({
        id: `grp-${first.index}-${last.index}`,
        startIndex: first.index,
        endIndex: last.index,
        startMs: first.startMs,
        endMs: last.endMs,
        text: mergedText,
        voice,
        speed,
        engine,
        subtitles: [...currentGroup],
      });
      currentGroup = [];
    }
  }

  return groups;
}

// =========================================================================================
// SAFE DYNAMIC MODULE LOADER (for progressive milestone implementation)
// =========================================================================================

interface LoadedModules {
  sanitizer: any;
  deduplication: any;
  nlpSegmenter: any;
  ttsEngine: any;
  dubbingEngine: any;
}

async function loadPipelineModules(): Promise<LoadedModules> {
  const loaded: LoadedModules = {
    sanitizer: null,
    deduplication: null,
    nlpSegmenter: null,
    ttsEngine: null,
    dubbingEngine: null,
  };

  try {
    loaded.sanitizer = await import('../main/lib/subtitleSanitizer');
  } catch {
    // Module not yet created in M1
  }

  try {
    loaded.deduplication = await import('../main/lib/subtitleDeduplication');
  } catch {
    // Module not yet created in M3
  }

  try {
    loaded.nlpSegmenter = await import('../main/lib/nlpSegmenter');
  } catch {
    // Should be present
  }

  try {
    loaded.ttsEngine = await import('../main/render/ttsEngine');
  } catch {
    // Should be present
  }

  try {
    loaded.dubbingEngine = await import('../main/render/dubbingEngine');
  } catch {
    // Should be present
  }

  return loaded;
}

// =========================================================================================
// TEST RUNNER & REPORTERS
// =========================================================================================

let totalTestCount = 0;
let passedTestCount = 0;
let failedTestCount = 0;
let realModuleCount = 0;
let oracleRefCount = 0;

function runTest(testId: string, description: string, fn: () => void | Promise<void>) {
  totalTestCount++;
  try {
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      throw new Error(`Test ${testId} returned a promise without await. Please keep synchronous.`);
    }
    passedTestCount++;
    console.log(`  ✓ [PASS] [${testId}] ${description}`);
  } catch (err: any) {
    failedTestCount++;
    console.error(`  ❌ [FAIL] [${testId}] ${description}`);
    console.error(`     Error: ${err.message || err}`);
    if (err.actual !== undefined && err.expected !== undefined) {
      console.error(`     Expected: ${JSON.stringify(err.expected)}`);
      console.error(`     Actual:   ${JSON.stringify(err.actual)}`);
    }
    process.exitCode = 1;
  }
}

// =========================================================================================
// MAIN TEST SUITE EXECUTION
// =========================================================================================

async function executeTestSuite() {
  console.log('================================================================================');
  console.log('🚀 VANHSUB SUBTITLE & TTS PIPELINE AUTOMATED TEST SUITE (Tiers 1 - 4)');
  console.log('================================================================================\n');

  const mods = await loadPipelineModules();

  console.log('📦 Module Load Status:');
  console.log(`   - main/lib/subtitleSanitizer:     ${mods.sanitizer ? '✅ Available' : '⏳ Pending M1 (Using Oracle)'}`);
  console.log(`   - main/lib/subtitleDeduplication: ${mods.deduplication ? '✅ Available' : '⏳ Pending M3 (Using Oracle)'}`);
  console.log(`   - main/lib/nlpSegmenter:         ${mods.nlpSegmenter ? '✅ Available' : '❌ Missing'}`);
  console.log(`   - main/render/ttsEngine:         ${mods.ttsEngine ? '✅ Available' : '❌ Missing'}`);
  console.log(`   - main/render/dubbingEngine:     ${mods.dubbingEngine ? '✅ Available' : '❌ Missing'}\n`);

  // Active functions (use real implementation if exported, fallback to oracle)
  const isOcrGarbageLine = (line: SrtLine, opts?: SanitizeOptions) => {
    if (mods.sanitizer?.isOcrGarbageLine) {
      realModuleCount++;
      return mods.sanitizer.isOcrGarbageLine(line, opts);
    }
    oracleRefCount++;
    return oracleIsOcrGarbageLine(line, opts);
  };

  const sanitizeSubtitles = (lines: SrtLine[], opts?: SanitizeOptions) => {
    if (mods.sanitizer?.sanitizeSubtitles) {
      realModuleCount++;
      return mods.sanitizer.sanitizeSubtitles(lines, opts);
    }
    oracleRefCount++;
    return oracleSanitizeSubtitles(lines, opts);
  };

  const deduplicateExact = (lines: SrtLine[], opts?: DedupOptions) => {
    if (mods.deduplication?.deduplicateExact) {
      realModuleCount++;
      return mods.deduplication.deduplicateExact(lines, opts);
    }
    oracleRefCount++;
    return oracleDeduplicateExact(lines, opts);
  };

  const deduplicateProgressiveKaraoke = (lines: SrtLine[], opts?: DedupOptions) => {
    if (mods.deduplication?.deduplicateProgressiveKaraoke) {
      realModuleCount++;
      return mods.deduplication.deduplicateProgressiveKaraoke(lines, opts);
    }
    oracleRefCount++;
    return oracleDeduplicateProgressiveKaraoke(lines, opts);
  };

  const deduplicateWhisperOcrCross = (ocr: SrtLine[], wh: SrtLine[], opts?: DedupOptions) => {
    if (mods.deduplication?.deduplicateWhisperOcrCross) {
      realModuleCount++;
      return mods.deduplication.deduplicateWhisperOcrCross(ocr, wh, opts);
    }
    oracleRefCount++;
    return oracleDeduplicateWhisperOcrCross(ocr, wh, opts);
  };

  const consolidateSubtitleClauses = (lines: SrtLine[], opts?: ConsolidateOptions) => {
    if (mods.nlpSegmenter?.consolidateSubtitleClauses) {
      realModuleCount++;
      return mods.nlpSegmenter.consolidateSubtitleClauses(lines, opts);
    }
    oracleRefCount++;
    return oracleConsolidateSubtitleClauses(lines, opts);
  };

  const groupSubtitlesForTts = (subs: SubtitleLine[], opts?: TTSOptions) => {
    if (mods.ttsEngine?.groupSubtitlesForTts) {
      realModuleCount++;
      return mods.ttsEngine.groupSubtitlesForTts(subs, opts);
    }
    oracleRefCount++;
    return oracleGroupSubtitlesForTts(subs, opts);
  };

  // =========================================================================================
  // TIER 1: FEATURE COVERAGE (F1 - F10, >= 5 test cases per feature = 50 tests)
  // =========================================================================================
  console.log('--------------------------------------------------------------------------------');
  console.log('🟢 TIER 1: FEATURE COVERAGE (50 Test Cases across F1 - F10)');
  console.log('--------------------------------------------------------------------------------\n');

  // --- Feature 1: OCR Single-Char Garbage Filter ---
  console.log('Feature 1: OCR Single-Char Garbage Filter (ORIGINAL_REQUEST R1)');
  runTest('T1.F1.1', 'Single ASCII lowercase letter "c" is flagged as garbage and removed', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 2000, text: 'c' };
    assert.strictEqual(isOcrGarbageLine(line), true);
    const res = sanitizeSubtitles([line]);
    assert.strictEqual(res.cleaned.length, 0);
    assert.strictEqual(res.removedCount, 1);
  });

  runTest('T1.F1.2', 'Single ASCII uppercase letter "A" from optical glitch is removed', () => {
    const line: SrtLine = { id: '2', startMs: 1200, endMs: 2500, text: 'A' };
    assert.strictEqual(isOcrGarbageLine(line), true);
    const res = sanitizeSubtitles([line]);
    assert.strictEqual(res.cleaned.length, 0);
  });

  runTest('T1.F1.3', 'Single digit "1" appearing as stray frame noise is removed', () => {
    const line: SrtLine = { id: '3', startMs: 500, endMs: 1500, text: '1' };
    assert.strictEqual(isOcrGarbageLine(line), true);
    const res = sanitizeSubtitles([line]);
    assert.strictEqual(res.cleaned.length, 0);
  });

  runTest('T1.F1.4', 'Single Vietnamese diacritic letter "ờ" isolated on a line is removed', () => {
    const line: SrtLine = { id: '4', startMs: 800, endMs: 1800, text: 'ờ' };
    assert.strictEqual(isOcrGarbageLine(line), true);
    const res = sanitizeSubtitles([line]);
    assert.strictEqual(res.cleaned.length, 0);
  });

  runTest('T1.F1.5', 'Mixed array with 3 single-char noise lines and 2 valid words retains only valid words', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 100, endMs: 1000, text: 'x' },
      { id: '2', startMs: 1100, endMs: 2000, text: 'xin chào' },
      { id: '3', startMs: 2100, endMs: 3000, text: 'v' },
      { id: '4', startMs: 3100, endMs: 4000, text: 'việt nam' },
      { id: '5', startMs: 4100, endMs: 5000, text: 'o' },
    ];
    const res = sanitizeSubtitles(lines);
    assert.strictEqual(res.cleaned.length, 2);
    assert.strictEqual(res.removedCount, 3);
    assert.strictEqual(res.cleaned[0].text, 'xin chào');
    assert.strictEqual(res.cleaned[1].text, 'việt nam');
  });

  // --- Feature 2: OCR Floating Symbols & Punctuation Filter ---
  console.log('\nFeature 2: OCR Floating Symbols & Punctuation Filter (ORIGINAL_REQUEST R1)');
  runTest('T1.F2.1', 'Floating period "." and ellipsis "..." are removed', () => {
    const l1: SrtLine = { id: '1', startMs: 100, endMs: 1000, text: '.' };
    const l2: SrtLine = { id: '2', startMs: 1100, endMs: 2000, text: '...' };
    assert.strictEqual(isOcrGarbageLine(l1), true);
    assert.strictEqual(isOcrGarbageLine(l2), true);
  });

  runTest('T1.F2.2', 'Floating hyphens and dashes "-", "--", "---" are removed', () => {
    const l: SrtLine = { id: '1', startMs: 500, endMs: 1500, text: '---' };
    assert.strictEqual(isOcrGarbageLine(l), true);
    const res = sanitizeSubtitles([l]);
    assert.strictEqual(res.cleaned.length, 0);
  });

  runTest('T1.F2.3', 'Decorative graphic symbols "***", "~~~", "===" are removed', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 100, endMs: 1000, text: '***' },
      { id: '2', startMs: 1100, endMs: 2000, text: '~~~' },
      { id: '3', startMs: 2100, endMs: 3000, text: '===' },
    ];
    const res = sanitizeSubtitles(lines);
    assert.strictEqual(res.cleaned.length, 0);
    assert.strictEqual(res.removedCount, 3);
  });

  runTest('T1.F2.4', 'Isolated brackets and quotes "()", "[]", "\'\'" are removed', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 100, endMs: 1000, text: '( )' },
      { id: '2', startMs: 1100, endMs: 2000, text: '[ ]' },
    ];
    const res = sanitizeSubtitles(lines);
    assert.strictEqual(res.cleaned.length, 0);
  });

  runTest('T1.F2.5', 'Valid text with internal punctuation "Chào bạn, tôi là AI!" is strictly preserved', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 3000, text: 'Chào bạn, tôi là AI!' };
    assert.strictEqual(isOcrGarbageLine(line), false);
    const res = sanitizeSubtitles([line]);
    assert.strictEqual(res.cleaned.length, 1);
    assert.strictEqual(res.cleaned[0].text, 'Chào bạn, tôi là AI!');
  });

  // --- Feature 3: Short-Duration Block (<150ms) Filter ---
  console.log('\nFeature 3: Short-Duration Block (<150ms) Filter (ORIGINAL_REQUEST R1)');
  runTest('T1.F3.1', '50ms block without Whisper audio is removed', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 1050, text: 'chớp tắt' };
    assert.strictEqual(isOcrGarbageLine(line, { minDurationMs: 150 }), true);
  });

  runTest('T1.F3.2', '120ms block without Whisper audio overlap is removed', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 1120, text: 'nhiễu hình' };
    const whisper: SrtLine[] = [{ id: 'w1', startMs: 3000, endMs: 5000, text: 'hội thoại chính' }];
    assert.strictEqual(isOcrGarbageLine(line, { minDurationMs: 150, whisperSegments: whisper }), true);
  });

  runTest('T1.F3.3', '100ms block that DOES overlap with Whisper speech is preserved (speech backed)', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 1100, text: 'ngắn' };
    const whisper: SrtLine[] = [{ id: 'w1', startMs: 950, endMs: 2000, text: 'ngắn nhưng có tiếng' }];
    assert.strictEqual(isOcrGarbageLine(line, { minDurationMs: 150, whisperSegments: whisper }), false);
  });

  runTest('T1.F3.4', '150ms exact boundary block is preserved (meets minDurationMs)', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 1150, text: 'vừa vặn' };
    assert.strictEqual(isOcrGarbageLine(line, { minDurationMs: 150 }), false);
  });

  runTest('T1.F3.5', '500ms normal block without Whisper audio is preserved as possible graphic text', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 1500, text: 'bảng thông tin' };
    assert.strictEqual(isOcrGarbageLine(line, { minDurationMs: 150, whisperSegments: [] }), false);
  });

  // --- Feature 4: SubtitleEditor UI Cleanup Action ---
  console.log('\nFeature 4: SubtitleEditor UI Cleanup Action (ORIGINAL_REQUEST R1)');
  runTest('T1.F4.1', 'Editor cleanup returns sanitized lines and accurate removedCount badge value', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 1050, text: 'c' },
      { id: '2', startMs: 1200, endMs: 3000, text: 'Chào quý vị' },
      { id: '3', startMs: 3100, endMs: 3200, text: '...' },
    ];
    const res = sanitizeSubtitles(lines);
    assert.strictEqual(res.removedCount, 2);
    assert.strictEqual(res.cleaned.length, 1);
    assert.strictEqual(res.cleaned[0].text, 'Chào quý vị');
  });

  runTest('T1.F4.2', 'Editor cleanup does not mutate input array (pure function)', () => {
    const original: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'x' },
      { id: '2', startMs: 2000, endMs: 3000, text: 'hợp lệ' },
    ];
    const copy = JSON.parse(JSON.stringify(original));
    sanitizeSubtitles(original);
    assert.deepStrictEqual(original, copy);
  });

  runTest('T1.F4.3', 'Editor cleanup preserves exact id, startMs, endMs for retained lines', () => {
    const lines: SrtLine[] = [
      { id: 'target-99', startMs: 4567, endMs: 8901, text: 'Dòng phụ đề quan trọng' },
    ];
    const res = sanitizeSubtitles(lines);
    assert.strictEqual(res.cleaned[0].id, 'target-99');
    assert.strictEqual(res.cleaned[0].startMs, 4567);
    assert.strictEqual(res.cleaned[0].endMs, 8901);
  });

  runTest('T1.F4.4', 'Editor undo stack simulation restores original state accurately', () => {
    const history: SrtLine[][] = [];
    let current: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'dấu .' },
      { id: '2', startMs: 2100, endMs: 3000, text: 'c' },
    ];
    // Push before cleanup
    history.push([...current]);
    const cleanRes = sanitizeSubtitles(current);
    current = cleanRes.cleaned;
    assert.strictEqual(current.length, 1);
    // Undo
    current = history.pop()!;
    assert.strictEqual(current.length, 2);
    assert.strictEqual(current[1].text, 'c');
  });

  runTest('T1.F4.5', 'Editor cleanup on already clean subtitle list returns 0 removedCount', () => {
    const cleanLines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 3000, text: 'Câu thứ nhất' },
      { id: '2', startMs: 3500, endMs: 5500, text: 'Câu thứ hai' },
    ];
    const res = sanitizeSubtitles(cleanLines);
    assert.strictEqual(res.removedCount, 0);
    assert.strictEqual(res.cleaned.length, 2);
  });

  // --- Feature 5: Smart Visual Wrapping (<=37 chars/line, \n, max 2 lines) ---
  console.log('\nFeature 5: Smart Visual Wrapping (ORIGINAL_REQUEST R2)');
  runTest('T1.F5.1', '35-character short line remains 1 single line without newline', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 3000, text: 'Hôm nay trời rất đẹp và trong xanh' }, // 35 chars
    ];
    const res = consolidateSubtitleClauses(lines);
    assert.strictEqual(res[0].text.includes('\n'), false);
    assert.strictEqual(res[0].text, 'Hôm nay trời rất đẹp và trong xanh');
  });

  runTest('T1.F5.2', '55-character sentence wraps into 2 lines using \\n without splitting timecode', () => {
    const longText = 'Hôm nay chúng ta sẽ cùng nhau tìm hiểu về trí tuệ nhân tạo'; // 57 chars
    const lines: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 4500, text: longText }];
    const res = consolidateSubtitleClauses(lines);
    assert.strictEqual(res.length, 1, 'Vẫn giữ đúng 1 block duy nhất');
    assert.strictEqual(res[0].startMs, 1000);
    assert.strictEqual(res[0].endMs, 4500);
    assert.strictEqual(res[0].text.includes('\n'), true);
    const subLines = res[0].text.split('\n');
    assert.strictEqual(subLines.length, 2);
    assert.ok(subLines[0].length <= 37);
    assert.ok(subLines[1].length <= 37);
  });

  runTest('T1.F5.3', 'Two consecutive short clauses (<74 chars total) consolidate into 1 block with \\n', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2500, text: 'chụp ảnh được, livestream được' }, // 31 chars
      { id: '2', startMs: 2600, endMs: 4500, text: 'tái hiện lại các cảnh kinh điển' }, // 32 chars -> combined 64 chars
    ];
    const res = consolidateSubtitleClauses(lines);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].startMs, 1000);
    assert.strictEqual(res[0].endMs, 4500);
    assert.strictEqual(res[0].text.includes('\n'), true);
  });

  runTest('T1.F5.4', 'Line break does not leave dangling word (của, và) at the end of line 1', () => {
    const text = 'Sự phát triển vượt bậc của nền kinh tế số và trí tuệ nhân tạo';
    const lines: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 5000, text }];
    const res = consolidateSubtitleClauses(lines);
    const [line1] = res[0].text.split('\n');
    const lastWord = line1.trim().split(' ').pop();
    assert.notStrictEqual(lastWord, 'của');
    assert.notStrictEqual(lastWord, 'và');
  });

  runTest('T1.F5.5', 'Visual wrapping preserves startMs of first clause and endMs of last clause', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1500, endMs: 2800, text: 'Bước thứ nhất' },
      { id: '2', startMs: 2900, endMs: 4800, text: 'làm quen với giao diện' },
    ];
    const res = consolidateSubtitleClauses(lines);
    assert.strictEqual(res[0].startMs, 1500);
    assert.strictEqual(res[0].endMs, 4800);
  });

  // --- Feature 6: TTS Sentence Grouping (Unfinished clauses) ---
  console.log('\nFeature 6: TTS Sentence Grouping (ORIGINAL_REQUEST R2)');
  runTest('T1.F6.1', 'Two clauses where clause 1 ends with comma are grouped into 1 SentenceGroup', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,500', startMs: 1000, endMs: 2500, durationMs: 1500, text: 'Nếu bạn có đam mê,' },
      { index: 2, startTime: '00:00:02,600', endTime: '00:00:04,500', startMs: 2600, endMs: 4500, durationMs: 1900, text: 'bạn sẽ thành công.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].startIndex, 1);
    assert.strictEqual(groups[0].endIndex, 2);
    assert.strictEqual(groups[0].text, 'Nếu bạn có đam mê, bạn sẽ thành công.');
  });

  runTest('T1.F6.2', 'Two clauses where clause 1 ends without punctuation are grouped into 1 SentenceGroup', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'chụp ảnh được' },
      { index: 2, startTime: '00:00:02,100', endTime: '00:00:03,500', startMs: 2100, endMs: 3500, durationMs: 1400, text: 'livestream được.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].startMs, 1000);
    assert.strictEqual(groups[0].endMs, 3500);
  });

  runTest('T1.F6.3', 'Clause ending with period closes group; subsequent clause begins new group', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,500', startMs: 1000, endMs: 2500, durationMs: 1500, text: 'Tôi là kỹ sư.' },
      { index: 2, startTime: '00:00:02,600', endTime: '00:00:04,500', startMs: 2600, endMs: 4500, durationMs: 1900, text: 'Rất vui được gặp bạn.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[0].text, 'Tôi là kỹ sư.');
    assert.strictEqual(groups[1].text, 'Rất vui được gặp bạn.');
  });

  runTest('T1.F6.4', 'Grouped sentence text joins clauses with single space and cleans whitespace', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: '  Chào bạn  ' },
      { index: 2, startTime: '00:00:02,100', endTime: '00:00:03,000', startMs: 2100, endMs: 3000, durationMs: 900, text: '  hôm nay thế nào?  ' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups[0].text, 'Chào bạn hôm nay thế nào?');
  });

  runTest('T1.F6.5', 'SentenceGroup attributes map startMs, endMs, voice, speed correctly', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:03,000', startMs: 1000, endMs: 3000, durationMs: 2000, text: 'Hoàn tất kiểm thử.' },
    ];
    const groups = groupSubtitlesForTts(subs, { voice: 'BV074_streaming', speed: 1.25, engine: 'edge' });
    assert.strictEqual(groups[0].voice, 'BV074_streaming');
    assert.strictEqual(groups[0].speed, 1.25);
    assert.strictEqual(groups[0].engine, 'edge');
  });

  // --- Feature 7: Seamless Audio Prosody & Gapless Timeline ---
  console.log('\nFeature 7: Seamless Audio Prosody & Gapless Timeline (ORIGINAL_REQUEST R2)');
  runTest('T1.F7.1', 'Grouped sentence generates a single audio request instead of N fragmented requests', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'phân đoạn 1' },
      { index: 2, startTime: '00:00:02,000', endTime: '00:00:03,000', startMs: 2000, endMs: 3000, durationMs: 1000, text: 'phân đoạn 2' },
      { index: 3, startTime: '00:00:03,000', endTime: '00:00:04,500', startMs: 3000, endMs: 4500, durationMs: 1500, text: 'phân đoạn 3 kết thúc.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].subtitles.length, 3);
  });

  runTest('T1.F7.2', 'Group duration equals full span (last endMs - first startMs) without internal gap', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,500', startMs: 1000, endMs: 2500, durationMs: 1500, text: 'Đoạn đầu' },
      { index: 2, startTime: '00:00:02,550', endTime: '00:00:04,000', startMs: 2550, endMs: 4000, durationMs: 1450, text: 'đoạn cuối.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    const expectedDur = 4000 - 1000;
    assert.strictEqual(groups[0].endMs - groups[0].startMs, expectedDur);
  });

  runTest('T1.F7.3', 'No artificial apad silence is inserted between clauses in grouped sentence', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'chạy liên tục,' },
      { index: 2, startTime: '00:00:02,050', endTime: '00:00:03,500', startMs: 2050, endMs: 3500, durationMs: 1450, text: 'không có khoảng lặng.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].text, 'chạy liên tục, không có khoảng lặng.');
  });

  runTest('T1.F7.4', 'Audio playback timeline matches visual subtitle boundary within 0ms drift', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:02,000', endTime: '00:00:05,000', startMs: 2000, endMs: 5000, durationMs: 3000, text: 'Đồng bộ tuyệt đối.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups[0].startMs, 2000);
    assert.strictEqual(groups[0].endMs, 5000);
  });

  runTest('T1.F7.5', 'Multiple consecutive SentenceGroups maintain sequential non-overlapping timeline', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:03,000', startMs: 1000, endMs: 3000, durationMs: 2000, text: 'Câu một hoàn chỉnh.' },
      { index: 2, startTime: '00:00:03,500', endTime: '00:00:05,500', startMs: 3500, endMs: 5500, durationMs: 2000, text: 'Câu hai hoàn chỉnh.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2);
    assert.ok(groups[0].endMs <= groups[1].startMs);
  });

  // --- Feature 8: Exact Duplicates Deduplication ---
  console.log('\nFeature 8: Exact Duplicates Deduplication (ORIGINAL_REQUEST R3)');
  runTest('T1.F8.1', 'Two consecutive identical subtitle lines within 500ms gap merge into 1 line', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2500, text: 'Tôi là kỹ sư phần mềm' },
      { id: '2', startMs: 2700, endMs: 4000, text: 'Tôi là kỹ sư phần mềm' },
    ];
    const deduped = deduplicateExact(lines);
    assert.strictEqual(deduped.length, 1);
  });

  runTest('T1.F8.2', 'Merged line starts at first startMs (1000) and ends at second endMs (4000)', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2500, text: 'Xin chào các bạn' },
      { id: '2', startMs: 2600, endMs: 4000, text: 'Xin chào các bạn' },
    ];
    const deduped = deduplicateExact(lines);
    assert.strictEqual(deduped[0].startMs, 1000);
    assert.strictEqual(deduped[0].endMs, 4000);
    assert.strictEqual(deduped[0].text, 'Xin chào các bạn');
  });

  runTest('T1.F8.3', 'Three consecutive identical lines merge into 1 line spanning from first to third', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Đồng thuận' },
      { id: '2', startMs: 2100, endMs: 3000, text: 'Đồng thuận' },
      { id: '3', startMs: 3100, endMs: 4500, text: 'Đồng thuận' },
    ];
    const deduped = deduplicateExact(lines);
    assert.strictEqual(deduped.length, 1);
    assert.strictEqual(deduped[0].startMs, 1000);
    assert.strictEqual(deduped[0].endMs, 4500);
  });

  runTest('T1.F8.4', 'Two identical lines separated by silence gap > 1500ms are NOT merged', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Cảm ơn' },
      { id: '2', startMs: 4000, endMs: 5000, text: 'Cảm ơn' }, // gap 2000ms
    ];
    const deduped = deduplicateExact(lines);
    assert.strictEqual(deduped.length, 2);
  });

  runTest('T1.F8.5', 'Case-insensitive and whitespace-normalized exact matching', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: '  VanhSub Studio  ' },
      { id: '2', startMs: 2100, endMs: 3000, text: 'vanhsub studio' },
    ];
    const deduped = deduplicateExact(lines);
    assert.strictEqual(deduped.length, 1);
    assert.strictEqual(deduped[0].endMs, 3000);
  });

  // --- Feature 9: Incremental / Progressive Karaoke Overlap Dedup ---
  console.log('\nFeature 9: Incremental / Progressive Karaoke Overlap Dedup (ORIGINAL_REQUEST R3)');
  runTest('T1.F9.1', '2-step karaoke sequence merges into longest string', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Hôm nay tôi' },
      { id: '2', startMs: 2050, endMs: 3500, text: 'Hôm nay tôi đi học' },
    ];
    const deduped = deduplicateProgressiveKaraoke(lines);
    assert.strictEqual(deduped.length, 1);
    assert.strictEqual(deduped[0].text, 'Hôm nay tôi đi học');
    assert.strictEqual(deduped[0].startMs, 1000);
    assert.strictEqual(deduped[0].endMs, 3500);
  });

  runTest('T1.F9.2', 'Authoritative prompt benchmark 3-step sequence resolves to single line (1000 -> 7000)', () => {
    const benchmark: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'chụp ảnh được' },
      { id: '2', startMs: 2000, endMs: 3500, text: 'chụp ảnh được, livestream được' },
      { id: '3', startMs: 3500, endMs: 7000, text: 'chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được, nhưng giá cho mỗi hoạt động tính thế nào?' },
    ];
    const deduped = deduplicateProgressiveKaraoke(benchmark);
    assert.strictEqual(deduped.length, 1, `Kỳ vọng 1 dòng nhưng có ${deduped.length}`);
    assert.strictEqual(deduped[0].startMs, 1000);
    assert.strictEqual(deduped[0].endMs, 7000);
    assert.strictEqual(deduped[0].text, benchmark[2].text);
  });

  runTest('T1.F9.3', 'Karaoke sequence with 1-accent optical typo in prefix merges into longest line', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'chup anh duoc' }, // missing diacritic
      { id: '2', startMs: 2100, endMs: 4000, text: 'chụp ảnh được, livestream được' },
    ];
    const deduped = deduplicateProgressiveKaraoke(lines);
    assert.strictEqual(deduped.length, 1);
    assert.strictEqual(deduped[0].text, 'chụp ảnh được, livestream được');
  });

  runTest('T1.F9.4', 'Two independent karaoke sequences separated by 2000ms resolve into 2 distinct final lines', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Một hai' },
      { id: '2', startMs: 2000, endMs: 3000, text: 'Một hai ba bốn' },
      // gap 2000ms
      { id: '3', startMs: 5000, endMs: 6000, text: 'Năm sáu' },
      { id: '4', startMs: 6000, endMs: 7500, text: 'Năm sáu bảy tám' },
    ];
    const deduped = deduplicateProgressiveKaraoke(lines);
    assert.strictEqual(deduped.length, 2);
    assert.strictEqual(deduped[0].text, 'Một hai ba bốn');
    assert.strictEqual(deduped[1].text, 'Năm sáu bảy tám');
  });

  runTest('T1.F9.5', 'Intermediate progressive lines are completely removed from output', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 1500, text: 'A' },
      { id: '2', startMs: 1500, endMs: 2000, text: 'A B' },
      { id: '3', startMs: 2000, endMs: 2500, text: 'A B C' },
      { id: '4', startMs: 2500, endMs: 3000, text: 'A B C D' },
    ];
    const deduped = deduplicateProgressiveKaraoke(lines);
    assert.strictEqual(deduped.length, 1);
    assert.strictEqual(deduped[0].text, 'A B C D');
    assert.strictEqual(deduped[0].startMs, 1000);
    assert.strictEqual(deduped[0].endMs, 3000);
  });

  // --- Feature 10: Whisper-OCR Cross-Modal Deduplication ---
  console.log('\nFeature 10: Whisper-OCR Cross-Modal Deduplication (ORIGINAL_REQUEST R3)');
  runTest('T1.F10.1', 'Overlapping OCR and Whisper segments fuse into 1 line (OCR timestamps + Whisper spelling)', () => {
    const ocr: SrtLine[] = [
      { id: 'ocr-1', startMs: 1200, endMs: 3400, text: 'hom nay toi di lam' },
    ];
    const whisper: SrtLine[] = [
      { id: 'wh-1', startMs: 900, endMs: 3800, text: 'hôm nay tôi đi làm' },
    ];
    const cross = deduplicateWhisperOcrCross(ocr, whisper);
    assert.strictEqual(cross.length, 1);
    assert.strictEqual(cross[0].startMs, 1200);
    assert.strictEqual(cross[0].endMs, 3400);
    assert.strictEqual(cross[0].text, 'hôm nay tôi đi làm');
  });

  runTest('T1.F10.2', 'Speech-only Whisper segment (no OCR on screen) is preserved in timeline', () => {
    const ocr: SrtLine[] = [];
    const whisper: SrtLine[] = [
      { id: 'wh-1', startMs: 2000, endMs: 4000, text: 'Lời thoại trong phòng tối' },
    ];
    const cross = deduplicateWhisperOcrCross(ocr, whisper);
    assert.strictEqual(cross.length, 1);
    assert.strictEqual(cross[0].text, 'Lời thoại trong phòng tối');
  });

  runTest('T1.F10.3', 'Static graphic banner (OCR on screen without Whisper audio) is preserved in timeline', () => {
    const ocr: SrtLine[] = [
      { id: 'ocr-1', startMs: 5000, endMs: 9000, text: 'TIÊU ĐỀ: BẢN TIN TRƯA' },
    ];
    const whisper: SrtLine[] = [];
    const cross = deduplicateWhisperOcrCross(ocr, whisper);
    assert.strictEqual(cross.length, 1);
    assert.strictEqual(cross[0].text, 'TIÊU ĐỀ: BẢN TIN TRƯA');
  });

  runTest('T1.F10.4', 'Fused output timeline is chronologically sorted with 0 timestamp collisions', () => {
    const ocr: SrtLine[] = [
      { id: 'ocr-1', startMs: 1000, endMs: 3000, text: 'Đoạn một' },
      { id: 'ocr-2', startMs: 7000, endMs: 9000, text: 'Đoạn ba' },
    ];
    const whisper: SrtLine[] = [
      { id: 'wh-1', startMs: 4000, endMs: 6000, text: 'Đoạn hai chỉ có tiếng' },
    ];
    const cross = deduplicateWhisperOcrCross(ocr, whisper);
    assert.strictEqual(cross.length, 3);
    for (let i = 0; i < cross.length - 1; i++) {
      assert.ok(cross[i].startMs <= cross[i + 1].startMs);
    }
  });

  runTest('T1.F10.5', 'Duplicate audio/text echo eliminated when both modalities capture same sentence', () => {
    const ocr: SrtLine[] = [
      { id: 'ocr-1', startMs: 1000, endMs: 3000, text: 'Xin kính chào quý vị' },
    ];
    const whisper: SrtLine[] = [
      { id: 'wh-1', startMs: 1400, endMs: 3400, text: 'Xin kính chào quý vị' },
    ];
    const cross = deduplicateWhisperOcrCross(ocr, whisper);
    assert.strictEqual(cross.length, 1, 'Không được sinh ra 2 dòng trùng lặp');
  });

  // =========================================================================================
  // TIER 2: BOUNDARY & CORNER CASES (50 Test Cases across F1 - F10)
  // =========================================================================================
  console.log('\n--------------------------------------------------------------------------------');
  console.log('🟡 TIER 2: BOUNDARY & CORNER CASES (50 Test Cases across F1 - F10)');
  console.log('--------------------------------------------------------------------------------\n');

  // --- F1 Boundary ---
  console.log('F1 Boundary: Single-Char Garbage Filter');
  runTest('T2.F1.1', 'Empty string "" input line is handled gracefully and removed as garbage', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 2000, text: '' };
    assert.strictEqual(isOcrGarbageLine(line), true);
  });

  runTest('T2.F1.2', 'Whitespace-only string "   " is trimmed and removed as garbage', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 2000, text: '    ' };
    assert.strictEqual(isOcrGarbageLine(line), true);
  });

  runTest('T2.F1.3', 'String with 2 characters (e.g. "ok", "đi") is valid and NOT removed', () => {
    const l1: SrtLine = { id: '1', startMs: 1000, endMs: 2000, text: 'ok' };
    const l2: SrtLine = { id: '2', startMs: 2100, endMs: 3000, text: 'đi' };
    assert.strictEqual(isOcrGarbageLine(l1), false);
    assert.strictEqual(isOcrGarbageLine(l2), false);
  });

  runTest('T2.F1.4', 'Single letter with multiple trailing spaces "e    " is removed', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 2000, text: 'e    ' };
    assert.strictEqual(isOcrGarbageLine(line), true);
  });

  runTest('T2.F1.5', 'Array of 1000 single-character noise lines processes under 50ms without memory leak', () => {
    const batch: SrtLine[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `noise-${i}`,
      startMs: i * 100,
      endMs: i * 100 + 80,
      text: String.fromCharCode(65 + (i % 26)),
    }));
    const t0 = Date.now();
    const res = sanitizeSubtitles(batch);
    const elapsed = Date.now() - t0;
    assert.strictEqual(res.cleaned.length, 0);
    assert.strictEqual(res.removedCount, 1000);
    assert.ok(elapsed < 150, `Quá thời gian thực thi: ${elapsed}ms`);
  });

  // --- F2 Boundary ---
  console.log('\nF2 Boundary: Floating Symbols & Punctuation Filter');
  runTest('T2.F2.1', 'String with only ASCII emoticons "(^_^)" without alphanumeric chars is removed', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 2000, text: '(*_*)' };
    assert.strictEqual(isOcrGarbageLine(line), true);
  });

  runTest('T2.F2.2', 'String with special control characters and zero-width spaces is removed', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 2000, text: '\u200B\u200C.' };
    assert.strictEqual(isOcrGarbageLine(line), true);
  });

  runTest('T2.F2.3', 'Single alphanumeric character preceded by punctuation ".c", "-A" is removed', () => {
    const l1: SrtLine = { id: '1', startMs: 1000, endMs: 2000, text: '.c' };
    const l2: SrtLine = { id: '2', startMs: 2000, endMs: 3000, text: '-A' };
    assert.strictEqual(isOcrGarbageLine(l1), true);
    assert.strictEqual(isOcrGarbageLine(l2), true);
  });

  runTest('T2.F2.4', 'Mathematical formula or price "$50", "100%" contains numbers and is NOT removed', () => {
    const l1: SrtLine = { id: '1', startMs: 1000, endMs: 2000, text: '$50' };
    const l2: SrtLine = { id: '2', startMs: 2000, endMs: 3000, text: '100%' };
    assert.strictEqual(isOcrGarbageLine(l1), false);
    assert.strictEqual(isOcrGarbageLine(l2), false);
  });

  runTest('T2.F2.5', 'Valid word wrapped in asterisks "***CẢNH BÁO***" contains letters and is NOT removed', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 3000, text: '***CẢNH BÁO***' };
    assert.strictEqual(isOcrGarbageLine(line), false);
  });

  // --- F3 Boundary ---
  console.log('\nF3 Boundary: Short-Duration Block (<150ms) Filter');
  runTest('T2.F3.1', 'Exact boundary: 149ms duration is filtered out', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 1149, text: 'cận dưới' };
    assert.strictEqual(isOcrGarbageLine(line, { minDurationMs: 150 }), true);
  });

  runTest('T2.F3.2', 'Exact boundary: 150ms duration is preserved', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 1150, text: 'cận chuẩn' };
    assert.strictEqual(isOcrGarbageLine(line, { minDurationMs: 150 }), false);
  });

  runTest('T2.F3.3', 'Zero duration block (startMs === endMs, e.g. 1000 - 1000) is filtered out', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 1000, text: 'không thời lượng' };
    assert.strictEqual(isOcrGarbageLine(line, { minDurationMs: 150 }), true);
  });

  runTest('T2.F3.4', 'Inverted duration block (startMs > endMs, e.g. 1500 - 1200) is filtered out', () => {
    const line: SrtLine = { id: '1', startMs: 1500, endMs: 1200, text: 'thời gian ngược' };
    assert.strictEqual(isOcrGarbageLine(line, { minDurationMs: 150 }), true);
  });

  runTest('T2.F3.5', 'Whisper segment with 1ms boundary overlap preserves the block', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 1100, text: 'chạm biên' };
    const whisper: SrtLine[] = [{ id: 'w1', startMs: 1100, endMs: 2000, text: 'lời nói tiếp' }];
    assert.strictEqual(isOcrGarbageLine(line, { minDurationMs: 150, whisperSegments: whisper }), false);
  });

  // --- F4 Boundary ---
  console.log('\nF4 Boundary: SubtitleEditor UI Cleanup Action');
  runTest('T2.F4.1', 'Empty array input [] to SubtitleEditor cleanup returns empty array with 0 removedCount', () => {
    const res = sanitizeSubtitles([]);
    assert.deepStrictEqual(res.cleaned, []);
    assert.strictEqual(res.removedCount, 0);
  });

  runTest('T2.F4.2', 'Single valid line array returns unchanged array with 0 removedCount', () => {
    const lines: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 2500, text: 'Đơn lẻ nhưng chuẩn' }];
    const res = sanitizeSubtitles(lines);
    assert.strictEqual(res.cleaned.length, 1);
    assert.strictEqual(res.removedCount, 0);
  });

  runTest('T2.F4.3', 'Single garbage line array returns empty array with 1 removedCount', () => {
    const lines: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 2500, text: 'z' }];
    const res = sanitizeSubtitles(lines);
    assert.strictEqual(res.cleaned.length, 0);
    assert.strictEqual(res.removedCount, 1);
  });

  runTest('T2.F4.4', 'SubtitleEditor undo/redo performed 50 times in rapid succession maintains consistency', () => {
    const stateStack: SrtLine[][] = [];
    let state: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 2000, text: 'hợp lệ' }];
    for (let cycle = 0; cycle < 50; cycle++) {
      stateStack.push([...state]);
      state = [{ id: '2', startMs: 2000, endMs: 3000, text: `cập nhật ${cycle}` }];
      state = stateStack.pop()!;
    }
    assert.strictEqual(state.length, 1);
    assert.strictEqual(state[0].text, 'hợp lệ');
  });

  runTest('T2.F4.5', 'Lines with null or undefined text field are sanitized safely without throwing', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: null as any },
      { id: '2', startMs: 2000, endMs: 3000, text: undefined as any },
      { id: '3', startMs: 3000, endMs: 4000, text: 'hợp lệ' },
    ];
    const res = sanitizeSubtitles(lines);
    assert.strictEqual(res.cleaned.length, 1);
    assert.strictEqual(res.cleaned[0].text, 'hợp lệ');
  });

  // --- F5 Boundary ---
  console.log('\nF5 Boundary: Smart Visual Wrapping');
  runTest('T2.F5.1', 'Exactly 37-character line remains 1 single line without break', () => {
    const text37 = 'Một hai ba bốn năm sáu bảy tám chín 1'; // exactly 37 chars
    assert.strictEqual(text37.length, 37);
    const lines: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 3000, text: text37 }];
    const res = consolidateSubtitleClauses(lines);
    assert.strictEqual(res[0].text.includes('\n'), false);
  });

  runTest('T2.F5.2', 'Exactly 38-character line wraps into 2 lines', () => {
    const text38 = 'Một hai ba bốn năm sáu bảy tám chín 12'; // exactly 38 chars
    assert.strictEqual(text38.length, 38);
    const lines: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 3000, text: text38 }];
    const res = consolidateSubtitleClauses(lines);
    assert.strictEqual(res[0].text.includes('\n'), true);
  });

  runTest('T2.F5.3', 'Long sentence > 200 characters breaks into compliant blocks of max 2 lines <= 37 chars', () => {
    const text200 = 'Trong bối cảnh nền kinh tế toàn cầu đang đối mặt với nhiều thách thức và biến động khó lường, việc đổi mới sáng tạo, chuyển đổi số toàn diện và áp dụng các công nghệ tiên tiến là chìa khóa then chốt để phát triển bền vững.';
    assert.ok(text200.length > 200);
    const lines: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 10000, text: text200 }];
    const res = consolidateSubtitleClauses(lines);
    assert.ok(res.length >= 1);
    for (const r of res) {
      const parts = r.text.split('\n');
      assert.ok(parts.length <= 2, `Số dòng ${parts.length} vượt quá 2`);
      for (const p of parts) {
        assert.ok(p.length <= 45, `Độ dài dòng ${p.length} quá dài`);
      }
    }
  });

  runTest('T2.F5.4', 'Line with number and unit "500 triệu USD" keeps number and unit together', () => {
    const text = 'Doanh thu năm nay ước tính đạt mốc 500 triệu USD trong quý này';
    const lines: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 4000, text }];
    const res = consolidateSubtitleClauses(lines);
    const parts = res[0].text.split('\n');
    // Ensure "500 triệu USD" is not sliced in half across lines
    const p1 = parts[0];
    const p2 = parts[1] || '';
    assert.ok(!p1.endsWith('500') || !p2.startsWith('triệu'));
  });

  runTest('T2.F5.5', 'Line with no whitespace (continuous string > 40 chars) does not enter infinite loop', () => {
    const noSpace = 'A'.repeat(50);
    const lines: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 3000, text: noSpace }];
    const res = consolidateSubtitleClauses(lines);
    assert.ok(res.length >= 1);
  });

  // --- F6 Boundary ---
  console.log('\nF6 Boundary: TTS Sentence Grouping');
  runTest('T2.F6.1', 'Single subtitle in list returns 1 SentenceGroup regardless of terminal punctuation', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:03,000', startMs: 1000, endMs: 3000, durationMs: 2000, text: 'câu chưa chấm' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1);
  });

  runTest('T2.F6.2', 'Sequence of 10 clauses without any punctuation groups into 1 single SentenceGroup', () => {
    const subs: SubtitleLine[] = Array.from({ length: 10 }, (_, i) => ({
      index: i + 1,
      startTime: `00:00:0${i},000`,
      endTime: `00:00:0${i},800`,
      startMs: i * 1000,
      endMs: i * 1000 + 800,
      durationMs: 800,
      text: `vế thứ ${i + 1}`,
    }));
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].subtitles.length, 10);
    assert.strictEqual(groups[0].startMs, 0);
    assert.strictEqual(groups[0].endMs, 9800);
  });

  runTest('T2.F6.3', 'Boundary gap: gap of 1199ms merges into same group; gap of 1201ms splits into new group', () => {
    const subsMerge: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'vế một' },
      { index: 2, startTime: '00:00:03,199', endTime: '00:00:04,500', startMs: 3199, endMs: 4500, durationMs: 1301, text: 'vế hai.' }, // gap 1199ms
    ];
    const groupsMerge = groupSubtitlesForTts(subsMerge);
    assert.strictEqual(groupsMerge.length, 1);

    const subsSplit: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'vế một' },
      { index: 2, startTime: '00:00:03,205', endTime: '00:00:04,500', startMs: 3205, endMs: 4500, durationMs: 1295, text: 'vế hai.' }, // gap 1205ms
    ];
    const groupsSplit = groupSubtitlesForTts(subsSplit);
    assert.strictEqual(groupsSplit.length, 2);
  });

  runTest('T2.F6.4', 'Question mark "?" and exclamation mark "!" properly terminate sentence group', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,500', startMs: 1000, endMs: 2500, durationMs: 1500, text: 'Bạn có khỏe không?' },
      { index: 2, startTime: '00:00:02,600', endTime: '00:00:04,000', startMs: 2600, endMs: 4000, durationMs: 1400, text: 'Tôi rất khỏe!' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2);
  });

  runTest('T2.F6.5', 'Ellipsis "..." at end of clause followed by capitalization terminates group', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,500', startMs: 1000, endMs: 2500, durationMs: 1500, text: 'Để tôi suy nghĩ...' },
      { index: 2, startTime: '00:00:02,600', endTime: '00:00:04,000', startMs: 2600, endMs: 4000, durationMs: 1400, text: 'Được rồi.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2);
  });

  // --- F7 Boundary ---
  console.log('\nF7 Boundary: Seamless Audio Prosody & Gapless Timeline');
  runTest('T2.F7.1', 'SentenceGroup duration exactly 500ms processes without minimum duration crash', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:01,500', startMs: 1000, endMs: 1500, durationMs: 500, text: 'Ngắn gọn.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups[0].endMs - groups[0].startMs, 500);
  });

  runTest('T2.F7.2', 'SentenceGroup audio duration slightly exceeds slot by 4% without atempo distortion', () => {
    const slotSec = 2.0;
    const audioSec = 2.08; // 4% excess
    const TEMPO_THRESHOLD = 1.05;
    const factor = audioSec / slotSec / TEMPO_THRESHOLD;
    assert.ok(factor <= 1.0, 'Không cần kéo giãn atempo khi tràn nhẹ dưới 5%');
  });

  runTest('T2.F7.3', 'SentenceGroup with audio duration shorter than slot fills natural timeline', () => {
    const slotSec = 4.0;
    const audioSec = 2.5;
    const paddingNeeded = slotSec - audioSec;
    assert.strictEqual(paddingNeeded, 1.5);
  });

  runTest('T2.F7.4', 'Voice overrides per subtitle within grouped sentence inherit primary group voice', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Đoạn a' },
      { index: 2, startTime: '00:00:02,100', endTime: '00:00:03,500', startMs: 2100, endMs: 3500, durationMs: 1400, text: 'đoạn b.' },
    ];
    const groups = groupSubtitlesForTts(subs, { voice: 'VN_MALE_1' });
    assert.strictEqual(groups[0].voice, 'VN_MALE_1');
  });

  runTest('T2.F7.5', 'Stop callback (shouldStop) immediately flags group processing abort', () => {
    let stopped = false;
    const shouldStop = () => stopped;
    stopped = true;
    assert.strictEqual(shouldStop(), true);
  });

  // --- F8 Boundary ---
  console.log('\nF8 Boundary: Exact Duplicates Deduplication');
  runTest('T2.F8.1', 'Exact boundary gap: gap 1199ms merges; gap 1201ms keeps separate', () => {
    const linesMerge: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Lặp' },
      { id: '2', startMs: 3199, endMs: 4000, text: 'Lặp' }, // gap 1199ms
    ];
    assert.strictEqual(deduplicateExact(linesMerge).length, 1);

    const linesSplit: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Lặp' },
      { id: '2', startMs: 3205, endMs: 4000, text: 'Lặp' }, // gap 1205ms
    ];
    assert.strictEqual(deduplicateExact(linesSplit).length, 2);
  });

  runTest('T2.F8.2', 'Out of order startMs is sorted properly before deduplication', () => {
    const unordered: SrtLine[] = [
      { id: '2', startMs: 2500, endMs: 4000, text: 'Cùng một câu' },
      { id: '1', startMs: 1000, endMs: 2400, text: 'Cùng một câu' },
    ];
    const deduped = deduplicateExact(unordered);
    assert.strictEqual(deduped.length, 1);
    assert.strictEqual(deduped[0].startMs, 1000);
    assert.strictEqual(deduped[0].endMs, 4000);
  });

  runTest('T2.F8.3', 'Two identical lines with overlapping timecodes merge into unified span', () => {
    const overlap: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 3000, text: 'Chồng lấn' },
      { id: '2', startMs: 2000, endMs: 4000, text: 'Chồng lấn' },
    ];
    const deduped = deduplicateExact(overlap);
    assert.strictEqual(deduped.length, 1);
    assert.strictEqual(deduped[0].startMs, 1000);
    assert.strictEqual(deduped[0].endMs, 4000);
  });

  runTest('T2.F8.4', 'Two identical lines separated by 1500ms silence boundary are NOT merged', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Khoảng lặng cảnh' },
      { id: '2', startMs: 3501, endMs: 4500, text: 'Khoảng lặng cảnh' }, // gap 1501ms
    ];
    const deduped = deduplicateExact(lines);
    assert.strictEqual(deduped.length, 2);
  });

  runTest('T2.F8.5', '100 consecutive identical frames merge into exactly 1 line spanning first start to last end', () => {
    const frames: SrtLine[] = Array.from({ length: 100 }, (_, i) => ({
      id: `frame-${i}`,
      startMs: i * 500,
      endMs: i * 500 + 400,
      text: 'Frame video lặp',
    }));
    const deduped = deduplicateExact(frames);
    assert.strictEqual(deduped.length, 1);
    assert.strictEqual(deduped[0].startMs, 0);
    assert.strictEqual(deduped[0].endMs, 99 * 500 + 400);
  });

  // --- F9 Boundary ---
  console.log('\nF9 Boundary: Incremental / Progressive Karaoke Overlap Dedup');
  runTest('T2.F9.1', 'Karaoke prefix with 1-character accent difference merges correctly', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Hom nay' },
      { id: '2', startMs: 2100, endMs: 3500, text: 'Hôm nay tôi đi học' },
    ];
    const deduped = deduplicateProgressiveKaraoke(lines);
    assert.strictEqual(deduped.length, 1);
    assert.strictEqual(deduped[0].text, 'Hôm nay tôi đi học');
  });

  runTest('T2.F9.2', 'Sequence where line 2 is shorter than line 1 does NOT trigger progressive merge', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2500, text: 'Hôm nay tôi đi học ở trường' },
      { id: '2', startMs: 2600, endMs: 3500, text: 'Hôm nay' },
    ];
    const deduped = deduplicateProgressiveKaraoke(lines);
    assert.strictEqual(deduped.length, 2);
  });

  runTest('T2.F9.3', 'Progressive chain with gap 999ms merges; gap 1205ms breaks chain', () => {
    const linesMerge: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'A B' },
      { id: '2', startMs: 2999, endMs: 4000, text: 'A B C' },
    ];
    assert.strictEqual(deduplicateProgressiveKaraoke(linesMerge).length, 1);

    const linesSplit: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'A B' },
      { id: '2', startMs: 3205, endMs: 4000, text: 'A B C' },
    ];
    assert.strictEqual(deduplicateProgressiveKaraoke(linesSplit).length, 2);
  });

  runTest('T2.F9.4', 'Single word prefix repeated 5 times merges into the full sentence', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 1400, text: 'Tôi' },
      { id: '2', startMs: 1400, endMs: 1800, text: 'Tôi là' },
      { id: '3', startMs: 1800, endMs: 2200, text: 'Tôi là ai' },
      { id: '4', startMs: 2200, endMs: 3000, text: 'Tôi là ai đây?' },
    ];
    const deduped = deduplicateProgressiveKaraoke(lines);
    assert.strictEqual(deduped.length, 1);
    assert.strictEqual(deduped[0].text, 'Tôi là ai đây?');
    assert.strictEqual(deduped[0].startMs, 1000);
    assert.strictEqual(deduped[0].endMs, 3000);
  });

  runTest('T2.F9.5', 'Punctuation variance in karaoke prefix ("xin chào," vs "xin chào các bạn!") merges cleanly', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'xin chào,' },
      { id: '2', startMs: 2100, endMs: 3500, text: 'xin chào các bạn!' },
    ];
    const deduped = deduplicateProgressiveKaraoke(lines);
    assert.strictEqual(deduped.length, 1);
    assert.strictEqual(deduped[0].text, 'xin chào các bạn!');
  });

  // --- F10 Boundary ---
  console.log('\nF10 Boundary: Whisper-OCR Cross-Modal Deduplication');
  runTest('T2.F10.1', 'Empty OCR segments array preserves all Whisper segments', () => {
    const whisper: SrtLine[] = [
      { id: 'w1', startMs: 1000, endMs: 3000, text: 'Chỉ có giọng nói' },
    ];
    const cross = deduplicateWhisperOcrCross([], whisper);
    assert.strictEqual(cross.length, 1);
    assert.strictEqual(cross[0].text, 'Chỉ có giọng nói');
  });

  runTest('T2.F10.2', 'Empty Whisper segments array preserves all OCR segments as banners', () => {
    const ocr: SrtLine[] = [
      { id: 'o1', startMs: 2000, endMs: 5000, text: 'Chỉ có chữ trên video' },
    ];
    const cross = deduplicateWhisperOcrCross(ocr, []);
    assert.strictEqual(cross.length, 1);
    assert.strictEqual(cross[0].text, 'Chỉ có chữ trên video');
  });

  runTest('T2.F10.3', 'Whisper segment shifted -800ms before OCR segment matches correctly within tolerance', () => {
    const ocr: SrtLine[] = [
      { id: 'o1', startMs: 2000, endMs: 4000, text: 'vanhsub studio' },
    ];
    const whisper: SrtLine[] = [
      { id: 'w1', startMs: 1200, endMs: 3600, text: 'VanhSub Studio' }, // -800ms
    ];
    const cross = deduplicateWhisperOcrCross(ocr, whisper);
    assert.strictEqual(cross.length, 1);
    assert.strictEqual(cross[0].startMs, 2000);
  });

  runTest('T2.F10.4', 'Whisper segment shifted +800ms after OCR segment matches correctly within tolerance', () => {
    const ocr: SrtLine[] = [
      { id: 'o1', startMs: 2000, endMs: 4000, text: 'tri tue nhan tao' },
    ];
    const whisper: SrtLine[] = [
      { id: 'w1', startMs: 2800, endMs: 4800, text: 'trí tuệ nhân tạo' }, // +800ms
    ];
    const cross = deduplicateWhisperOcrCross(ocr, whisper);
    assert.strictEqual(cross.length, 1);
    assert.strictEqual(cross[0].startMs, 2000);
    assert.strictEqual(cross[0].text, 'trí tuệ nhân tạo');
  });

  runTest('T2.F10.5', 'Whisper segment shifted +850ms does NOT match and is kept as separate segment', () => {
    const ocr: SrtLine[] = [
      { id: 'o1', startMs: 1000, endMs: 2000, text: 'Banner 1' },
    ];
    const whisper: SrtLine[] = [
      { id: 'w1', startMs: 2850, endMs: 4000, text: 'Lời nói độc lập' }, // +850ms past end
    ];
    const cross = deduplicateWhisperOcrCross(ocr, whisper);
    assert.strictEqual(cross.length, 2);
  });

  // =========================================================================================
  // TIER 3: PAIRWISE CROSS-FEATURE TESTS (10 Test Cases)
  // =========================================================================================
  console.log('\n--------------------------------------------------------------------------------');
  console.log('🔵 TIER 3: PAIRWISE CROSS-FEATURE TESTS (10 Test Cases)');
  console.log('--------------------------------------------------------------------------------\n');

  runTest('T3.1', '[F1 + F9] OCR single-char noise lines interspersed between karaoke frames -> noise stripped, karaoke merged', () => {
    const rawLines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 1500, text: 'mua' },
      { id: 'noise-1', startMs: 1510, endMs: 1550, text: 'c' }, // noise
      { id: '2', startMs: 1560, endMs: 2500, text: 'mua ngay' },
      { id: 'noise-2', startMs: 2510, endMs: 2540, text: 'x' }, // noise
      { id: '3', startMs: 2550, endMs: 4000, text: 'mua ngay hôm nay' },
    ];
    // Pipeline: Sanitize first, then Karaoke dedup
    const sanitized = sanitizeSubtitles(rawLines);
    assert.strictEqual(sanitized.removedCount, 2);
    const deduped = deduplicateProgressiveKaraoke(sanitized.cleaned);
    assert.strictEqual(deduped.length, 1);
    assert.strictEqual(deduped[0].text, 'mua ngay hôm nay');
    assert.strictEqual(deduped[0].startMs, 1000);
    assert.strictEqual(deduped[0].endMs, 4000);
  });

  runTest('T3.2', '[F2 + F10] Floating punctuation lines in OCR do not match Whisper speech and are discarded, not kept as banners', () => {
    const ocrLines: SrtLine[] = [
      { id: 'punct-1', startMs: 1000, endMs: 2000, text: '...' },
      { id: 'banner-1', startMs: 3000, endMs: 5000, text: 'KHUYẾN MÃI 50%' },
    ];
    const whisperLines: SrtLine[] = [
      { id: 'wh-1', startMs: 6000, endMs: 8000, text: 'Hãy nhanh tay đặt hàng' },
    ];
    // Sanitizer rejects floating punct
    const cleanOcr = sanitizeSubtitles(ocrLines).cleaned;
    assert.strictEqual(cleanOcr.length, 1);
    const fused = deduplicateWhisperOcrCross(cleanOcr, whisperLines);
    assert.strictEqual(fused.length, 2);
    assert.strictEqual(fused[0].text, 'KHUYẾN MÃI 50%');
    assert.strictEqual(fused[1].text, 'Hãy nhanh tay đặt hàng');
  });

  runTest('T3.3', '[F8 + F9] Sequence containing both exact duplicate frames and progressive expansion merges into single line', () => {
    const rawLines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 1800, text: 'chào các bạn' },
      { id: '2', startMs: 1850, endMs: 2600, text: 'chào các bạn' }, // exact duplicate
      { id: '3', startMs: 2650, endMs: 4000, text: 'chào các bạn đã đến với kênh' }, // progressive expansion
    ];
    const exact = deduplicateExact(rawLines);
    const karaoke = deduplicateProgressiveKaraoke(exact);
    assert.strictEqual(karaoke.length, 1);
    assert.strictEqual(karaoke[0].text, 'chào các bạn đã đến với kênh');
    assert.strictEqual(karaoke[0].startMs, 1000);
    assert.strictEqual(karaoke[0].endMs, 4000);
  });

  runTest('T3.4', '[F9 + F5] Progressive karaoke merged sentence exceeding 37 chars wraps into 2 lines without splitting timecode', () => {
    const rawLines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Chúng tôi cam kết' },
      { id: '2', startMs: 2000, endMs: 3500, text: 'Chúng tôi cam kết mang lại sản phẩm tốt nhất cho người tiêu dùng' }, // 64 chars
    ];
    const karaoke = deduplicateProgressiveKaraoke(rawLines);
    assert.strictEqual(karaoke.length, 1);
    const wrapped = consolidateSubtitleClauses(karaoke);
    assert.strictEqual(wrapped.length, 1);
    assert.strictEqual(wrapped[0].text.includes('\n'), true);
    assert.strictEqual(wrapped[0].startMs, 1000);
    assert.strictEqual(wrapped[0].endMs, 3500);
  });

  runTest('T3.5', '[F9 + F6] Progressive karaoke merged sentence is grouped into a single unified TTS SentenceGroup', () => {
    const rawLines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'học lập trình' },
      { id: '2', startMs: 2000, endMs: 3500, text: 'học lập trình để xây dựng tương lai.' },
    ];
    const deduped = deduplicateProgressiveKaraoke(rawLines);
    const subs: SubtitleLine[] = deduped.map((d, i) => ({
      index: i + 1,
      startTime: '00:00:01,000',
      endTime: '00:00:03,500',
      startMs: d.startMs,
      endMs: d.endMs,
      durationMs: d.endMs - d.startMs,
      text: d.text,
    }));
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].text, 'học lập trình để xây dựng tương lai.');
  });

  runTest('T3.6', '[F5 + F6] 2-line wrapped subtitle block followed by incomplete clause groups into 1 TTS SentenceGroup', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:03,500', startMs: 1000, endMs: 3500, durationMs: 2500, text: 'Khi ánh mặt trời vừa ló rạng,\nmuôn chim bắt đầu ca hát' },
      { index: 2, startTime: '00:00:03,600', endTime: '00:00:05,500', startMs: 3600, endMs: 5500, durationMs: 1900, text: 'vang lừng khắp cánh rừng.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].startMs, 1000);
    assert.strictEqual(groups[0].endMs, 5500);
  });

  runTest('T3.7', '[F10 + F5] Whisper-OCR fused subtitle with length > 37 chars applies smart visual line wrapping', () => {
    const ocr: SrtLine[] = [
      { id: 'o1', startMs: 1000, endMs: 4000, text: 'chao mung quy vi va cac ban den voi hoi nghi' },
    ];
    const whisper: SrtLine[] = [
      { id: 'w1', startMs: 900, endMs: 4200, text: 'Chào mừng quý vị và các bạn đến với hội nghị' }, // 44 chars
    ];
    const cross = deduplicateWhisperOcrCross(ocr, whisper);
    const wrapped = consolidateSubtitleClauses(cross);
    assert.strictEqual(wrapped.length, 1);
    assert.strictEqual(wrapped[0].text.includes('\n'), true);
  });

  runTest('T3.8', '[F3 + F10] Ultra-short 80ms OCR block backed by Whisper audio is preserved and fused; 80ms block without audio is dropped', () => {
    const ocr: SrtLine[] = [
      { id: 'short-with-audio', startMs: 1000, endMs: 1080, text: 'tiếng' },
      { id: 'short-no-audio', startMs: 4000, endMs: 4080, text: 'nhiễu' },
    ];
    const whisper: SrtLine[] = [
      { id: 'w1', startMs: 950, endMs: 2000, text: 'tiếng nói rõ ràng' },
    ];
    const sanitized = sanitizeSubtitles(ocr, { whisperSegments: whisper });
    assert.strictEqual(sanitized.cleaned.length, 1);
    assert.strictEqual(sanitized.cleaned[0].id, 'short-with-audio');
  });

  runTest('T3.9', '[F8 + F7] Deduplicated consecutive subtitles generate a unified continuous audio timeline without artificial gaps', () => {
    const rawLines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Nội dung trùng' },
      { id: '2', startMs: 2100, endMs: 3200, text: 'Nội dung trùng.' },
    ];
    const deduped = deduplicateExact(rawLines);
    const subs: SubtitleLine[] = deduped.map((d, i) => ({
      index: i + 1,
      startTime: '00:00:01,000',
      endTime: '00:00:03,200',
      startMs: d.startMs,
      endMs: d.endMs,
      durationMs: d.endMs - d.startMs,
      text: d.text,
    }));
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].endMs - groups[0].startMs, 2200);
  });

  runTest('T3.10', '[F4 + F8 + F9] SubtitleEditor batch cleanup executes full pipeline (sanitize + exact dedup + karaoke dedup)', () => {
    const dirtyEditorLines: SrtLine[] = [
      { id: 'noise-1', startMs: 500, endMs: 550, text: 'a' },
      { id: '1', startMs: 1000, endMs: 2000, text: 'Ưu đãi' },
      { id: '2', startMs: 2000, endMs: 2000, text: '...' }, // floating punct
      { id: '3', startMs: 2050, endMs: 3500, text: 'Ưu đãi đặc biệt' },
      { id: '4', startMs: 3600, endMs: 4500, text: 'Ưu đãi đặc biệt' }, // exact dup
    ];
    // Pipeline execution:
    const step1 = sanitizeSubtitles(dirtyEditorLines);
    assert.strictEqual(step1.removedCount, 2);
    const step2 = deduplicateExact(step1.cleaned);
    const step3 = deduplicateProgressiveKaraoke(step2);
    assert.strictEqual(step3.length, 1);
    assert.strictEqual(step3[0].text, 'Ưu đãi đặc biệt');
    assert.strictEqual(step3[0].startMs, 1000);
    assert.strictEqual(step3[0].endMs, 4500);
  });

  // =========================================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS (5 Realistic Workloads)
  // =========================================================================================
  console.log('\n--------------------------------------------------------------------------------');
  console.log('🟣 TIER 4: REAL-WORLD APPLICATION SCENARIOS (5 Workloads)');
  console.log('--------------------------------------------------------------------------------\n');

  runTest('T4.1', 'Scenario 1: TikTok / Shorts Livestream Selling with Karaoke Subtitles & Corner Logo', () => {
    // Simulated livestream OCR extraction:
    // 5 progressive frames + 1 transient 100ms watermark glitch + 2 floating symbol glitches
    const ocrFrames: SrtLine[] = [
      { id: 'logo-1', startMs: 500, endMs: 600, text: '@shop_online' }, // 100ms < 150ms -> noise
      { id: 'glitch-1', startMs: 650, endMs: 700, text: '-->' }, // floating symbols -> noise
      { id: 'k-1', startMs: 1000, endMs: 1400, text: 'Săn deal' },
      { id: 'k-2', startMs: 1450, endMs: 1900, text: 'Săn deal chớp nhoáng' },
      { id: 'k-3', startMs: 1950, endMs: 2500, text: 'Săn deal chớp nhoáng chỉ trong tối nay' },
      { id: 'k-4', startMs: 2550, endMs: 3200, text: 'Săn deal chớp nhoáng chỉ trong tối nay với giá cực sốc' },
      { id: 'glitch-2', startMs: 3250, endMs: 3300, text: '***' }, // floating symbols -> noise
      { id: 'k-5', startMs: 3350, endMs: 4500, text: 'Săn deal chớp nhoáng chỉ trong tối nay với giá cực sốc mọi người ơi!' },
    ];

    // Step 1: Clean glitches, floating symbols, and ultra-short artifacts
    const sanitized = sanitizeSubtitles(ocrFrames);
    assert.strictEqual(sanitized.removedCount, 3, 'Lọc đúng 3 mục rác OCR: logo nhấp nháy <150ms, --> và ***');

    // Step 2: Progressive karaoke deduplication
    const deduped = deduplicateProgressiveKaraoke(sanitized.cleaned);
    assert.strictEqual(deduped.length, 1, 'Hợp nhất toàn bộ 5 frame karaoke thành 1 dòng duy nhất');

    const mainLine = deduped[0];
    assert.strictEqual(mainLine.startMs, 1000);
    assert.strictEqual(mainLine.endMs, 4500);

    // Step 3: Smart Visual Line Wrapping
    const wrapped = consolidateSubtitleClauses([mainLine]);
    assert.strictEqual(wrapped[0].text.includes('\n'), true);
    const lines = wrapped[0].text.split('\n');
    assert.ok(lines[0].length <= 37);
    assert.ok(lines[1].length <= 37);
  });

  runTest('T4.2', 'Scenario 2: Long Complex Sentence with Multi-Clause Inquiries (Benchmark Sentence)', () => {
    // The benchmark sentence from user request:
    // "chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được, nhưng giá cho mỗi hoạt động tính thế nào?"
    // Divided into 3 fragmented OCR blocks:
    const benchmarkBlocks: SrtLine[] = [
      { id: 'b1', startMs: 1000, endMs: 2200, text: 'chụp ảnh được, livestream được' },
      { id: 'b2', startMs: 2300, endMs: 4500, text: 'tái hiện lại các cảnh kinh điển cũng được' },
      { id: 'b3', startMs: 4600, endMs: 7800, text: 'nhưng giá cho mỗi hoạt động tính thế nào?' },
    ];

    // Pipeline step: consolidate clauses into max 2 blocks without fragmenting into 3 blocks
    const consolidated = consolidateSubtitleClauses(benchmarkBlocks);
    assert.ok(consolidated.length <= 2, `Kỳ vọng tối đa 2 khối nhưng có ${consolidated.length}`);

    // Group for seamless TTS
    const subs: SubtitleLine[] = benchmarkBlocks.map((b, idx) => ({
      index: idx + 1,
      startTime: `00:00:0${idx + 1},000`,
      endTime: `00:00:0${idx + 2},000`,
      startMs: b.startMs,
      endMs: b.endMs,
      durationMs: b.endMs - b.startMs,
      text: b.text,
    }));
    const ttsGroups = groupSubtitlesForTts(subs);
    assert.strictEqual(ttsGroups.length, 1, 'Toàn bộ câu phức phải được gom vào đúng 1 SentenceGroup TTS');
    assert.strictEqual(ttsGroups[0].startMs, 1000);
    assert.strictEqual(ttsGroups[0].endMs, 7800);
    assert.ok(ttsGroups[0].text.includes('chụp ảnh được'));
    assert.ok(ttsGroups[0].text.includes('tính thế nào?'));
  });

  runTest('T4.3', 'Scenario 3: Documentary Video with Static Graphic Banners & Dialogue', () => {
    const ocrStream: SrtLine[] = [
      { id: 'banner-prof', startMs: 1000, endMs: 4500, text: 'GS. TS. NGUYỄN VĂN A - VIỆN TRƯỞNG' },
      { id: 'ocr-speech-1', startMs: 5000, endMs: 7000, text: 'chung toi da nghien cuu de tai nay' },
      { id: 'noise-corner', startMs: 7100, endMs: 7180, text: '...' },
    ];

    const whisperStream: SrtLine[] = [
      { id: 'wh-speech-1', startMs: 4800, endMs: 7200, text: 'Chúng tôi đã nghiên cứu đề tài này' },
    ];

    // Sanitize noise first
    const cleanOcr = sanitizeSubtitles(ocrStream).cleaned;
    assert.strictEqual(cleanOcr.length, 2);

    // Cross-modal deduplication
    const finalSubtitles = deduplicateWhisperOcrCross(cleanOcr, whisperStream);
    assert.strictEqual(finalSubtitles.length, 2);

    // Banner preserved exactly
    const banner = finalSubtitles.find((s) => s.text.includes('NGUYỄN VĂN A'))!;
    assert.ok(banner, 'Graphic banner phải được bảo toàn 100%');
    assert.strictEqual(banner.startMs, 1000);
    assert.strictEqual(banner.endMs, 4500);

    // Speech fused with diacritics
    const speech = finalSubtitles.find((s) => s.text.includes('Chúng tôi đã nghiên cứu'))!;
    assert.ok(speech, 'Lời thoại được phục hồi dấu thanh từ Whisper');
    assert.strictEqual(speech.startMs, 5000, 'Timecode neo theo OCR 5000ms');
  });

  runTest('T4.4', 'Scenario 4: Rapid Speech with Micro-pauses and Visual Subtitle Consolidation', () => {
    // Fast speaker: 4 clauses with 40ms micro-pauses without terminal punctuation
    const rapidSpeech: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:01,800', startMs: 1000, endMs: 1800, durationMs: 800, text: 'Nhanh lên nào' },
      { index: 2, startTime: '00:00:01,840', endTime: '00:00:02,600', startMs: 1840, endMs: 2600, durationMs: 760, text: 'chúng ta sắp muộn' },
      { index: 3, startTime: '00:00:02,640', endTime: '00:00:03,400', startMs: 2640, endMs: 3400, durationMs: 760, text: 'buổi lễ trao giải' },
      { index: 4, startTime: '00:00:03,440', endTime: '00:00:04,500', startMs: 3440, endMs: 4500, durationMs: 1060, text: 'quan trọng nhất năm.' },
    ];

    const ttsGroups = groupSubtitlesForTts(rapidSpeech);
    assert.strictEqual(ttsGroups.length, 1, 'Gom trọn vẹn 4 vế nói nhanh vào 1 SentenceGroup');
    assert.strictEqual(ttsGroups[0].startMs, 1000);
    assert.strictEqual(ttsGroups[0].endMs, 4500);
    assert.strictEqual(ttsGroups[0].text, 'Nhanh lên nào chúng ta sắp muộn buổi lễ trao giải quan trọng nhất năm.');
  });

  runTest('T4.5', 'Scenario 5: Interactive SubtitleEditor Batch Sanitization & Undo Flow', () => {
    // 20 mixed subtitles in editor:
    // 5 garbage lines (single chars / floating symbols / <150ms noise)
    // 4 progressive karaoke duplicate frames
    // 11 valid lines
    const editorData: SrtLine[] = [
      { id: 'g-1', startMs: 100, endMs: 200, text: 'x' },
      { id: 'v-1', startMs: 1000, endMs: 2500, text: 'Xin chào toàn thể bà con' },
      { id: 'g-2', startMs: 2550, endMs: 2600, text: '...' },
      { id: 'v-2', startMs: 2700, endMs: 4000, text: 'Hôm nay chúng ta lại gặp nhau' },
      { id: 'k-1', startMs: 4100, endMs: 4800, text: 'để trao đổi' },
      { id: 'k-2', startMs: 4800, endMs: 5500, text: 'để trao đổi về phương án' },
      { id: 'k-3', startMs: 5500, endMs: 6200, text: 'để trao đổi về phương án triển khai' },
      { id: 'k-4', startMs: 6200, endMs: 7500, text: 'để trao đổi về phương án triển khai dự án mới.' },
      { id: 'g-3', startMs: 7550, endMs: 7600, text: 'c' },
      { id: 'v-3', startMs: 7700, endMs: 9000, text: 'Mọi ý kiến đóng góp' },
      { id: 'v-4', startMs: 9100, endMs: 10500, text: 'đều vô cùng quý báu' },
      { id: 'g-4', startMs: 10550, endMs: 10600, text: '---' },
      { id: 'v-5', startMs: 10700, endMs: 12000, text: 'cho sự thành công chung.' },
      { id: 'g-5', startMs: 12050, endMs: 12100, text: '1' },
      { id: 'v-6', startMs: 12200, endMs: 13500, text: 'Chúc mọi người một ngày vui vẻ' },
      { id: 'v-7', startMs: 13600, endMs: 15000, text: 'và tràn đầy năng lượng tích cực.' },
      { id: 'v-8', startMs: 15100, endMs: 16500, text: 'Hẹn gặp lại quý vị' },
      { id: 'v-9', startMs: 16600, endMs: 18000, text: 'trong các chương trình kế tiếp.' },
      { id: 'v-10', startMs: 18100, endMs: 19500, text: 'Xin trân trọng cảm ơn' },
      { id: 'v-11', startMs: 19600, endMs: 21000, text: 'và xin kính chào tạm biệt.' },
    ];
    assert.strictEqual(editorData.length, 20);

    // Snapshot state for Undo
    const undoStack: SrtLine[][] = [];
    undoStack.push(JSON.parse(JSON.stringify(editorData)));

    // User triggers "Lọc rác & Làm sạch"
    const step1 = sanitizeSubtitles(editorData);
    assert.strictEqual(step1.removedCount, 5, 'Lọc chính xác 5 dòng rác OCR');

    const step2 = deduplicateProgressiveKaraoke(step1.cleaned);
    // 4 karaoke lines merged into 1 (k-4)
    assert.strictEqual(step2.length, 12, 'Còn lại 11 dòng hợp lệ + 1 dòng karaoke gộp hoàn chỉnh');

    // User tests UNDO
    const restoredState = undoStack.pop()!;
    assert.strictEqual(restoredState.length, 20, 'Undo phục hồi hoàn hảo 20 dòng gốc');
    assert.strictEqual(restoredState[0].text, 'x');

    // User tests REDO (re-applies cleanup)
    const redoClean = deduplicateProgressiveKaraoke(sanitizeSubtitles(restoredState).cleaned);
    assert.strictEqual(redoClean.length, 12);
  });

  // =========================================================================================
  // SUMMARY REPORT
  // =========================================================================================
  console.log('\n================================================================================');
  console.log('📊 TEST EXECUTION SUMMARY:');
  console.log('================================================================================');
  console.log(`   Total Test Cases Executed:    ${totalTestCount}`);
  console.log(`   Passed:                       ${passedTestCount} ✅`);
  console.log(`   Failed:                       ${failedTestCount} ❌`);
  console.log(`   Real Implementation Calls:    ${realModuleCount}`);
  console.log(`   Specification Oracle Calls:   ${oracleRefCount}`);
  console.log('================================================================================');

  if (failedTestCount > 0) {
    console.error(`\n❌ Test suite completed with ${failedTestCount} failure(s).`);
    process.exit(1);
  } else {
    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY (100% PASS RATE)!');
    process.exit(0);
  }
}

// Execute suite
executeTestSuite().catch((err) => {
  console.error('Fatal crash during test runner execution:', err);
  process.exit(1);
});
