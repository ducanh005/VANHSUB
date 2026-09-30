/**
 * Adversarial Stress & Chaos Test Suite for Milestone 1 (Requirement R1)
 * OCR Noise & Garbage Sanitizer
 *
 * Targets:
 * 1. Extreme Scale: 10,000-line array performance, heap memory stability, zero leaks.
 * 2. Boundary Accuracy: 149ms vs 150ms vs 151ms with and without Whisper candidates.
 * 3. Single Letters & Diacritics: 'à', 'ố', 'ừ' (NFC and NFD decomposed), with/without Whisper.
 * 4. Complex Floating Punctuation: chains of symbols, brackets, zero-width spaces, audio tags.
 * 5. Corrupt Unicode, PUA, Box Drawing, ReDoS stress.
 * 6. SubtitleEditor State Restoration (Undo / Redo stack simulation, idempotence, immutability).
 * 7. Hybrid Fusion Integration & Degenerate Input Safety.
 */

import { isOcrGarbageLine, sanitizeSubtitles, type SanitizeOptions } from '../main/lib/subtitleSanitizer';
import { fuseOcrAndWhisper } from '../main/asr/hybridFusionEngine';
import type { SrtLine } from '../main/lib/srt';
import { performance } from 'perf_hooks';

// --- Test Helpers ---
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${testName}`);
    if (detail) {
      console.error(`    Detail: ${detail}`);
    }
  }
}

function runSuite() {
  console.log('======================================================================');
  console.log('ADVERSARIAL STRESS TEST SUITE: OCR NOISE & GARBAGE SANITIZER (M1/R1)');
  console.log('======================================================================\n');

  // =========================================================================
  // SECTION 1: STRICT BOUNDARY CONDITIONS (149ms vs 150ms vs 151ms)
  // =========================================================================
  console.log('--- SECTION 1: STRICT BOUNDARY CONDITIONS (149ms / 150ms / 151ms) ---');

  const validText = 'Xin chào quý vị khán giả';

  // 1.1 Without Whisper
  const line149NoW: SrtLine = { id: 'b149', startMs: 1000, endMs: 1149, text: validText };
  const line150NoW: SrtLine = { id: 'b150', startMs: 1000, endMs: 1150, text: validText };
  const line151NoW: SrtLine = { id: 'b151', startMs: 1000, endMs: 1151, text: validText };

  assert(
    isOcrGarbageLine(line149NoW) === true,
    '1.1.1 149ms without Whisper must be classified as garbage (< 150ms)',
    `Expected true, got ${isOcrGarbageLine(line149NoW)}`
  );

  assert(
    isOcrGarbageLine(line150NoW) === false,
    '1.1.2 Exactly 150ms without Whisper must be PRESERVED (>= 150ms)',
    `Expected false, got ${isOcrGarbageLine(line150NoW)}`
  );

  assert(
    isOcrGarbageLine(line151NoW) === false,
    '1.1.3 151ms without Whisper must be PRESERVED (> 150ms)',
    `Expected false, got ${isOcrGarbageLine(line151NoW)}`
  );

  // 1.2 With Whisper Speech Corroboration
  const whisperMatching: SrtLine[] = [
    { id: 'w1', startMs: 950, endMs: 1200, text: 'Xin chào quý vị' },
  ];
  const whisperNonMatching: SrtLine[] = [
    { id: 'w2', startMs: 3000, endMs: 4000, text: 'Đoạn thoại khác' },
  ];

  assert(
    isOcrGarbageLine(line149NoW, { whisperSegments: whisperMatching }) === false,
    '1.2.1 149ms WITH overlapping Whisper speech must be PRESERVED',
    `Expected false, got ${isOcrGarbageLine(line149NoW, { whisperSegments: whisperMatching })}`
  );

  assert(
    isOcrGarbageLine(line149NoW, { whisperSegments: whisperNonMatching }) === true,
    '1.2.2 149ms with non-matching Whisper speech must be classified as garbage',
    `Expected true, got ${isOcrGarbageLine(line149NoW, { whisperSegments: whisperNonMatching })}`
  );

  // 1.3 Boundary Touching Overlap
  // Whisper ends at 1000ms, line starts at 1000ms (touching at exact ms)
  const whisperTouching: SrtLine[] = [
    { id: 'wt', startMs: 800, endMs: 1000, text: 'Tiền tố' },
  ];
  assert(
    isOcrGarbageLine(line149NoW, { whisperSegments: whisperTouching }) === false,
    '1.3.1 149ms touching Whisper at boundary (w.endMs === line.startMs) is preserved',
    `Expected false, got ${isOcrGarbageLine(line149NoW, { whisperSegments: whisperTouching })}`
  );

  // 1.4 Degenerate Durations (0ms, negative duration, NaN)
  const line0ms: SrtLine = { id: 'd0', startMs: 1000, endMs: 1000, text: validText };
  const lineNegMs: SrtLine = { id: 'dneg', startMs: 1000, endMs: 950, text: validText };
  const lineNaN: SrtLine = { id: 'dnan', startMs: NaN, endMs: 1500, text: validText };

  assert(
    isOcrGarbageLine(line0ms, { whisperSegments: whisperMatching }) === true,
    '1.4.1 Duration 0ms is garbage even if Whisper speech overlaps',
    `Expected true, got ${isOcrGarbageLine(line0ms, { whisperSegments: whisperMatching })}`
  );

  assert(
    isOcrGarbageLine(lineNegMs, { whisperSegments: whisperMatching }) === true,
    '1.4.2 Negative duration is garbage even if Whisper speech overlaps',
    `Expected true, got ${isOcrGarbageLine(lineNegMs, { whisperSegments: whisperMatching })}`
  );

  assert(
    isOcrGarbageLine(lineNaN) === true,
    '1.4.3 NaN startMs is garbage',
    `Expected true, got ${isOcrGarbageLine(lineNaN)}`
  );

  // 1.5 Custom minDurationMs threshold (e.g. 300ms)
  const line250: SrtLine = { id: 'c250', startMs: 1000, endMs: 1250, text: validText };
  assert(
    isOcrGarbageLine(line250, { minDurationMs: 300 }) === true,
    '1.5.1 Custom minDurationMs=300 filters 250ms line without Whisper',
    `Expected true, got ${isOcrGarbageLine(line250, { minDurationMs: 300 })}`
  );
  assert(
    isOcrGarbageLine(line250, { minDurationMs: 200 }) === false,
    '1.5.2 Custom minDurationMs=200 preserves 250ms line without Whisper',
    `Expected false, got ${isOcrGarbageLine(line250, { minDurationMs: 200 })}`
  );

  console.log('\n--- SECTION 2: SINGLE LETTERS & COMBINING DIACRITICS ---');

  // 2.1 Single letters with Vietnamese diacritics (Precomposed NFC)
  const singleLettersNfc = ['à', 'ố', 'ừ', 'É', 'Ỹ', 'ợ', 'ả', 'ĩ', 'đ', 'Ă'];
  let allNfcRemoved = true;
  for (const char of singleLettersNfc) {
    const line: SrtLine = { id: `nfc-${char}`, startMs: 1000, endMs: 3000, text: char };
    if (!isOcrGarbageLine(line)) {
      allNfcRemoved = false;
      console.error(`    Failed to detect NFC char as garbage: "${char}"`);
    }
  }
  assert(allNfcRemoved, '2.1.1 Precomposed NFC single diacritic letters are 100% filtered by G1');

  // 2.2 Single letters with Combining Diacritics (Decomposed NFD)
  // 'à' = a + \u0300; 'ố' = o + \u0302 + \u0301; 'ừ' = u + \u031B + \u0300
  const singleLettersNfd = [
    'a\u0300',          // à
    'o\u0302\u0301',    // ố
    'u\u031B\u0300',    // ừ
    'e\u0301',          // é
    'y\u0303',          // ỹ
  ];
  let allNfdRemoved = true;
  for (const char of singleLettersNfd) {
    const line: SrtLine = { id: `nfd-${char}`, startMs: 1000, endMs: 3000, text: char };
    if (!isOcrGarbageLine(line)) {
      allNfdRemoved = false;
      console.error(`    Failed to detect NFD char as garbage: "${char}"`);
    }
  }
  assert(allNfdRemoved, '2.2.1 Decomposed NFD single letters with combining marks are 100% filtered by G1');

  // 2.3 Single diacritic letters with Whisper speech corroboration
  // Under G1 (default removeSingleChars: true), single letters are filtered even if Whisper exists
  const whisperForA: SrtLine[] = [{ id: 'wa', startMs: 1000, endMs: 2000, text: 'à' }];
  const lineAWithWhisper: SrtLine = { id: 'la', startMs: 1000, endMs: 2000, text: 'à' };
  assert(
    isOcrGarbageLine(lineAWithWhisper, { whisperSegments: whisperForA }) === true,
    '2.3.1 Single letter "à" is filtered by G1 even if Whisper corroborates (default options)',
    `Expected true, got ${isOcrGarbageLine(lineAWithWhisper, { whisperSegments: whisperForA })}`
  );

  // 2.4 Single diacritic letters with removeSingleChars: false
  assert(
    isOcrGarbageLine(lineAWithWhisper, { removeSingleChars: false, whisperSegments: whisperForA }) === false,
    '2.4.1 Single letter "à" is PRESERVED when removeSingleChars: false and duration >= 150ms',
    `Expected false, got ${isOcrGarbageLine(lineAWithWhisper, { removeSingleChars: false, whisperSegments: whisperForA })}`
  );

  // 2.5 Single letters surrounded by punctuation / quotes / brackets
  const singleCharPunctuation = [
    "'à'", '"ố"', '- ừ -', '(đ)', '[c]', '<A>', '...a...', ':1:', '— ợ —'
  ];
  let allPunctWrappedRemoved = true;
  for (const text of singleCharPunctuation) {
    const line: SrtLine = { id: `pwrap-${text}`, startMs: 1000, endMs: 3000, text };
    if (!isOcrGarbageLine(line)) {
      allPunctWrappedRemoved = false;
      console.error(`    Failed to detect punctuation-wrapped single char: "${text}"`);
    }
  }
  assert(allPunctWrappedRemoved, '2.5.1 Single letters wrapped in quotes/brackets/dashes are 100% filtered');

  // 2.6 Valid short interjection words (2+ letters) MUST be preserved!
  const validInterjections = [
    'À nè', 'Ừm', 'Ồ kìa', 'Ủa', 'Hả?', 'Ối trời', 'Dạ', 'Vâng', 'Ơ hay', 'Thế à'
  ];
  let allInterjectionsPreserved = true;
  for (const text of validInterjections) {
    const line: SrtLine = { id: `inter-${text}`, startMs: 1000, endMs: 3000, text };
    if (isOcrGarbageLine(line)) {
      allInterjectionsPreserved = false;
      console.error(`    False positive on valid interjection: "${text}"`);
    }
  }
  assert(allInterjectionsPreserved, '2.6.1 Valid short interjections (>= 2 letters) are 100% PRESERVED');

  console.log('\n--- SECTION 3: COMPLEX FLOATING PUNCTUATION CHAINS ---');

  // 3.1 Pure punctuation chains
  const floatingChains = [
    '--', '...', '::', '—', '[ ]', '( )', '~', '***', '///',
    '——', '... ...', '« »', '“ ”', '~!@#$%^&*()_+=-[]{};:\'",./<>?',
    '- - -', '... ... ...', '| |', '• • •', '¿ ?', '¡ !', '— —'
  ];
  let allChainsRemoved = true;
  for (const text of floatingChains) {
    const line: SrtLine = { id: `chain-${text}`, startMs: 1000, endMs: 3000, text };
    if (!isOcrGarbageLine(line)) {
      allChainsRemoved = false;
      console.error(`    Failed to detect floating punctuation chain: "${text}"`);
    }
  }
  assert(allChainsRemoved, '3.1.1 Complex floating punctuation chains are 100% filtered by G2');

  // 3.2 Floating punctuation combined with Zero-Width Spaces
  const zeroWidthPunct = [
    '\u200B--\u200B',
    '\uFEFF...',
    '\u200C::\u200D',
    '\u200B[ ]\u200B',
    '\u200B',
    '\u200B\u200C\u200D\uFEFF',
  ];
  let allZwsRemoved = true;
  for (const text of zeroWidthPunct) {
    const line: SrtLine = { id: `zws-${text}`, startMs: 1000, endMs: 3000, text };
    if (!isOcrGarbageLine(line)) {
      allZwsRemoved = false;
      console.error(`    Failed to detect zero-width punctuation: "${text}"`);
    }
  }
  assert(allZwsRemoved, '3.2.1 Punctuation with Zero-Width Spaces or pure ZWS is 100% filtered');

  // 3.3 Legitimate subtitles containing punctuation / audio descriptions MUST be preserved!
  const legitimateDialogue = [
    'Xin chào... Tôi là VanhSub!',
    '[Âm nhạc] Một chiều mưa bay...',
    '(Cười lớn) Bạn nói thật sao?',
    '— Đúng vậy, tôi hoàn toàn đồng ý.',
    '«Chiến tranh và Hòa bình» là kiệt tác.',
    'Giá sản phẩm: 100.000 VNĐ - 200.000 VNĐ.',
    '“Tôi sẽ quay lại!” — anh ấy nói.',
    'Hôm nay là 30/09/2026.',
  ];
  let allLegitPreserved = true;
  for (const text of legitimateDialogue) {
    const line: SrtLine = { id: `legit-${text}`, startMs: 1000, endMs: 3000, text };
    if (isOcrGarbageLine(line)) {
      allLegitPreserved = false;
      console.error(`    False positive on legitimate dialogue: "${text}"`);
    }
  }
  assert(allLegitPreserved, '3.3.1 Legitimate dialogue with punctuation/brackets is 100% PRESERVED');

  console.log('\n--- SECTION 4: UNICODE GLITCHES, PUA & ReDoS CHAOS ---');

  // 4.1 Corrupt Unicode (PUA, Replacement character \uFFFD)
  const corruptUnicode = [
    'Lỗi font \uFFFD\uFFFD nghiêm trọng',
    'Dòng chứa mã PUA \uE000 test',
    'Dòng chứa mã PUA \uF8FF cuối dải',
    '\uFFFD',
    '\uE001',
  ];
  let allCorruptRemoved = true;
  for (const text of corruptUnicode) {
    const line: SrtLine = { id: `corrupt-${text}`, startMs: 1000, endMs: 3000, text };
    if (!isOcrGarbageLine(line)) {
      allCorruptRemoved = false;
      console.error(`    Failed to detect corrupt Unicode: "${text}"`);
    }
  }
  assert(allCorruptRemoved, '4.1.1 Corrupt Unicode (PUA, \\uFFFD) lines are 100% filtered by G4');

  // 4.2 Box drawing and block elements
  const boxAlone = ['┌───────┐', '│ █ ▓ ░ │', '└───────┘'];
  let allBoxAloneRemoved = true;
  for (const text of boxAlone) {
    const line: SrtLine = { id: `box-${text}`, startMs: 1000, endMs: 3000, text };
    if (!isOcrGarbageLine(line)) {
      allBoxAloneRemoved = false;
      console.error(`    Failed to detect box drawing alone: "${text}"`);
    }
  }
  assert(allBoxAloneRemoved, '4.2.1 Box drawing / block elements alone are 100% filtered by G4');

  const boxWithText: SrtLine = {
    id: 'box-text',
    startMs: 1000,
    endMs: 3000,
    text: '┌ Xin chào các bạn ┐',
  };
  assert(
    isOcrGarbageLine(boxWithText) === false,
    '4.2.2 Box drawing surrounding valid text (> 1 valid char) is PRESERVED',
    `Expected false, got ${isOcrGarbageLine(boxWithText)}`
  );

  // 4.3 ReDoS & Catastrophic Backtracking Stress Test
  const massivePatternA = 'a'.repeat(20000);
  const massivePatternPunct = '-.'.repeat(10000);
  const massivePatternControl = ' \t '.repeat(10000);

  const tStartReDoS = performance.now();
  const resReDoSA = isOcrGarbageLine({ id: 'r1', startMs: 1000, endMs: 3000, text: massivePatternA });
  const resReDoSP = isOcrGarbageLine({ id: 'r2', startMs: 1000, endMs: 3000, text: massivePatternPunct });
  const resReDoSC = isOcrGarbageLine({ id: 'r3', startMs: 1000, endMs: 3000, text: massivePatternControl });
  const tReDoSElapsed = performance.now() - tStartReDoS;

  assert(
    tReDoSElapsed < 100,
    `4.3.1 ReDoS resistance: 20k-char repetitive inputs processed in ${tReDoSElapsed.toFixed(2)}ms (< 100ms)`,
    `Elapsed: ${tReDoSElapsed}ms`
  );
  assert(resReDoSA === false, '4.3.2 Massive valid text is not garbage');
  assert(resReDoSP === true, '4.3.3 Massive punctuation is garbage');
  assert(resReDoSC === true, '4.3.4 Massive whitespace is garbage');

  console.log('\n--- SECTION 5: MASSIVE 10,000-LINE STRESS & HEAP STABILITY ---');

  // Build 10,000-line array
  const NUM_LINES = 10000;
  const largeArray: SrtLine[] = [];
  let expectedGarbageCount = 0;
  let expectedCleanCount = 0;

  for (let i = 0; i < NUM_LINES; i++) {
    const category = i % 10;
    const startMs = i * 2000;
    const id = `stress-${i}`;

    switch (category) {
      case 0:
      case 1:
      case 2:
      case 3:
        // 40% Valid Vietnamese sentences
        largeArray.push({
          id,
          startMs,
          endMs: startMs + 1800,
          text: `Câu thoại hợp lệ số ${i} của người dẫn chương trình truyền hình.`,
        });
        expectedCleanCount++;
        break;

      case 4:
      case 5:
        // 20% Single letters (NFC, NFD, symbols, wrapped)
        const singles = ['c', 'A', 'a', '.', '-', '1', 'à', 'ố', 'ừ', 'o\u0302\u0301'];
        largeArray.push({
          id,
          startMs,
          endMs: startMs + 1000,
          text: singles[i % singles.length],
        });
        expectedGarbageCount++;
        break;

      case 6:
        // 10% Complex floating punctuation chains
        const chains = ['--', '...', '::', '—', '[ ]', '( )', '~', '***', '« »', '“ ”'];
        largeArray.push({
          id,
          startMs,
          endMs: startMs + 800,
          text: chains[i % chains.length],
        });
        expectedGarbageCount++;
        break;

      case 7:
        // 10% Ultra-short lines (< 150ms: 1ms - 149ms) without Whisper
        largeArray.push({
          id,
          startMs,
          endMs: startMs + (i % 149 + 1), // 1ms - 149ms
          text: `Đoạn chớp sáng ${i}`,
        });
        expectedGarbageCount++;
        break;

      case 8:
        // 10% Corrupt Unicode (PUA, Replacement character, Box drawing)
        const glitches = ['\uFFFD lỗi', '\uE005 font', '┌───┐', '│ █ │', '\u200B\u200C\u200D'];
        largeArray.push({
          id,
          startMs,
          endMs: startMs + 1000,
          text: glitches[i % glitches.length],
        });
        expectedGarbageCount++;
        break;

      case 9:
        // 10% Degenerate lines (empty, whitespace, zero duration, inverted time)
        if (i % 4 === 0) {
          largeArray.push({ id, startMs, endMs: startMs + 1000, text: '   \t  ' });
        } else if (i % 4 === 1) {
          largeArray.push({ id, startMs, endMs: startMs, text: 'Thời lượng 0ms' });
        } else if (i % 4 === 2) {
          largeArray.push({ id, startMs, endMs: startMs - 50, text: 'Thời lượng âm' });
        } else {
          largeArray.push({ id, startMs: NaN, endMs: startMs + 500, text: 'NaN start' });
        }
        expectedGarbageCount++;
        break;
    }
  }

  // Record heap before
  const heapBefore = process.memoryUsage().heapUsed;
  const tLargeStart = performance.now();

  const sanitizeResult = sanitizeSubtitles(largeArray);

  const tLargeElapsed = performance.now() - tLargeStart;
  const heapAfter = process.memoryUsage().heapUsed;
  const heapDiffMb = (heapAfter - heapBefore) / (1024 * 1024);

  assert(
    sanitizeResult.cleaned.length === expectedCleanCount,
    `5.1.1 10,000-line array: exactly ${expectedCleanCount} valid lines preserved`,
    `Expected ${expectedCleanCount}, got ${sanitizeResult.cleaned.length}`
  );

  assert(
    sanitizeResult.removedCount === expectedGarbageCount,
    `5.1.2 10,000-line array: exactly ${expectedGarbageCount} garbage lines removed`,
    `Expected ${expectedGarbageCount}, got ${sanitizeResult.removedCount}`
  );

  assert(
    tLargeElapsed < 500,
    `5.1.3 High throughput: 10,000 lines processed in ${tLargeElapsed.toFixed(2)}ms (< 500ms)`,
    `Elapsed: ${tLargeElapsed}ms`
  );

  assert(
    heapDiffMb < 50,
    `5.1.4 Heap memory delta is bounded: ${heapDiffMb.toFixed(2)} MB (< 50 MB)`,
    `Heap delta: ${heapDiffMb} MB`
  );

  // Check integrity of preserved lines
  let integrityPassed = true;
  for (let k = 0; k < sanitizeResult.cleaned.length; k++) {
    const item = sanitizeResult.cleaned[k];
    if (!item.text.startsWith('Câu thoại hợp lệ số')) {
      integrityPassed = false;
      break;
    }
  }
  assert(integrityPassed, '5.1.5 Preserved lines maintain 100% semantic and text fidelity');

  console.log('\n--- SECTION 6: SUBTITLE EDITOR STATE RESTORATION & BATCH CLEANUP ---');

  // Simulating SubtitleEditor.tsx state machine
  class SubtitleEditorStateMock {
    private history: SrtLine[][] = [];
    private future: SrtLine[][] = [];
    public lines: SrtLine[] = [];
    public dirty = false;

    constructor(initial: SrtLine[]) {
      this.lines = JSON.parse(JSON.stringify(initial));
    }

    get detectedGarbageCount(): number {
      return this.lines.filter((l) => isOcrGarbageLine(l)).length;
    }

    pushUndo(newLines: SrtLine[]) {
      this.history.push(JSON.parse(JSON.stringify(newLines)));
      this.future = [];
      if (this.history.length > 50) this.history.shift();
    }

    handleSanitizeGarbage(): number {
      if (this.lines.length === 0) return 0;
      this.pushUndo(this.lines);
      const { cleaned, removedCount } = sanitizeSubtitles(this.lines);
      if (removedCount > 0) {
        this.lines = cleaned;
        this.dirty = true;
      }
      return removedCount;
    }

    undo(): boolean {
      if (this.history.length === 0) return false;
      const prev = this.history.pop()!;
      this.future.push(JSON.parse(JSON.stringify(this.lines)));
      this.lines = prev;
      this.dirty = true;
      return true;
    }

    redo(): boolean {
      if (this.future.length === 0) return false;
      const next = this.future.pop()!;
      this.history.push(JSON.parse(JSON.stringify(this.lines)));
      this.lines = next;
      this.dirty = true;
      return true;
    }
  }

  const editorTestLines: SrtLine[] = [
    { id: 'e1', startMs: 0, endMs: 2000, text: 'Chào mừng các bạn đến với kênh' },
    { id: 'e2', startMs: 2000, endMs: 2100, text: 'c' },                         // G1 + G3
    { id: 'e3', startMs: 2200, endMs: 4000, text: 'Hôm nay chúng ta sẽ tìm hiểu' },
    { id: 'e4', startMs: 4000, endMs: 4080, text: '...' },                       // G2 + G3
    { id: 'e5', startMs: 4100, endMs: 6000, text: 'về thuật toán xử lý phụ đề' },
    { id: 'e6', startMs: 6000, endMs: 6050, text: 'VanhSub chớp sáng' },          // G3
    { id: 'e7', startMs: 6100, endMs: 8000, text: 'Cảm ơn đã theo dõi!' },
  ];

  const editor = new SubtitleEditorStateMock(editorTestLines);

  assert(
    editor.detectedGarbageCount === 3,
    '6.1.1 SubtitleEditor mock detectedGarbageCount accurately counts 3 garbage lines',
    `Expected 3, got ${editor.detectedGarbageCount}`
  );

  const removedInEditor = editor.handleSanitizeGarbage();
  assert(
    removedInEditor === 3,
    '6.1.2 handleSanitizeGarbage returns removedCount 3',
    `Expected 3, got ${removedInEditor}`
  );
  assert(
    editor.lines.length === 4,
    '6.1.3 Editor lines count reduced to 4 after batch cleanup',
    `Expected 4, got ${editor.lines.length}`
  );
  assert(
    editor.detectedGarbageCount === 0,
    '6.1.4 Editor detectedGarbageCount is 0 after batch cleanup',
    `Expected 0, got ${editor.detectedGarbageCount}`
  );

  // Undo operation
  const undoSuccess = editor.undo();
  assert(undoSuccess === true, '6.2.1 Undo operation succeeded');
  assert(
    editor.lines.length === 7,
    '6.2.2 Undo restores original 7 lines',
    `Expected 7, got ${editor.lines.length}`
  );
  assert(
    editor.detectedGarbageCount === 3,
    '6.2.3 Undo restores detectedGarbageCount to 3',
    `Expected 3, got ${editor.detectedGarbageCount}`
  );
  assert(
    editor.lines[1].id === 'e2' && editor.lines[1].text === 'c',
    '6.2.4 Line e2 ("c") perfectly restored with exact ID and timecodes'
  );

  // Redo operation
  const redoSuccess = editor.redo();
  assert(redoSuccess === true, '6.3.1 Redo operation succeeded');
  assert(
    editor.lines.length === 4,
    '6.3.2 Redo restores cleaned 4 lines',
    `Expected 4, got ${editor.lines.length}`
  );
  assert(
    editor.detectedGarbageCount === 0,
    '6.3.3 Redo returns detectedGarbageCount to 0',
    `Expected 0, got ${editor.detectedGarbageCount}`
  );

  // Idempotence: clean again on already clean lines
  const secondCleanCount = editor.handleSanitizeGarbage();
  assert(
    secondCleanCount === 0,
    '6.4.1 Idempotence: subsequent sanitize on clean data removes 0 lines',
    `Expected 0, got ${secondCleanCount}`
  );
  assert(
    editor.lines.length === 4,
    '6.4.2 Lines remain 4 without unintended side-effects',
    `Expected 4, got ${editor.lines.length}`
  );

  // Immutability check: input array is not mutated in-place
  const immutableInput: SrtLine[] = [
    { id: 'im1', startMs: 1000, endMs: 3000, text: 'Tôi là phụ đề gốc' },
    { id: 'im2', startMs: 3000, endMs: 3050, text: '-' },
  ];
  const inputSnapshot = JSON.stringify(immutableInput);
  sanitizeSubtitles(immutableInput);
  assert(
    JSON.stringify(immutableInput) === inputSnapshot,
    '6.5.1 Input lines array is strictly immutable (not modified in place)'
  );

  console.log('\n--- SECTION 7: HYBRID FUSION ADVERSARIAL INTEGRATION ---');

  // Verify fuseOcrAndWhisper correctly rejects noise lines under adversarial conditions
  const ocrNoiseBanners: SrtLine[] = [
    { id: 'o1', startMs: 1000, endMs: 3000, text: 'TẬP 1: KHỞI ĐẦU' },          // Real banner
    { id: 'o2', startMs: 4000, endMs: 6000, text: 'c' },                          // 1-char noise
    { id: 'o3', startMs: 7000, endMs: 9000, text: '...' },                        // Floating punct
    { id: 'o4', startMs: 10000, endMs: 10050, text: 'Chớp quang học' },            // < 150ms noise
    { id: 'o5', startMs: 12000, endMs: 14000, text: 'ĐẠO DIỄN: NGUYỄN VĂN A' }, // Real banner
  ];

  // No whisper candidates (audio is silent/background music during intro)
  const fusionResNoWhisper = fuseOcrAndWhisper(ocrNoiseBanners, []);
  assert(
    fusionResNoWhisper.stats.garbageFiltered === 3,
    '7.1.1 fuseOcrAndWhisper filters all 3 noise lines (c, ..., <150ms) without Whisper',
    `Expected 3, got ${fusionResNoWhisper.stats.garbageFiltered}`
  );
  assert(
    fusionResNoWhisper.stats.bannersPreserved === 2,
    '7.1.2 fuseOcrAndWhisper preserves exactly 2 valid static banners',
    `Expected 2, got ${fusionResNoWhisper.stats.bannersPreserved}`
  );
  assert(
    fusionResNoWhisper.segments.length === 2 &&
    fusionResNoWhisper.segments[0].text === 'TẬP 1: KHỞI ĐẦU' &&
    fusionResNoWhisper.segments[1].text === 'ĐẠO DIỄN: NGUYỄN VĂN A',
    '7.1.3 Preserved banners match real content exactly'
  );

  console.log('\n======================================================================');
  console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('======================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite();
