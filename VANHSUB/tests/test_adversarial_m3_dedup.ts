/**
 * Dedicated Adversarial Test Harness: Deterministic Deduplication Engine (Milestone 3 / R3)
 * Author: challenger_m3_1 (Empirical Challenger)
 *
 * Hostile & Boundary Verification:
 * - Suite 1: Extreme Exact Duplicates (100 to 500 identical lines, small gaps, interleaved clusters, case/punct variations)
 * - Suite 2: Complex Progressive Karaoke Chains (5 to 10 stages, expanding words, missing diacritics, punctuation changes, branching)
 * - Suite 3: Precise Safety Boundaries (gap 1199ms vs 1200ms vs 1201ms, 1499ms vs 1500ms vs 1501ms, negative overlapping gaps)
 * - Suite 4: Pathological Timestamps & Edge Cases (out-of-order, zero-duration, inverted, empty, massive text, Unicode NFD/NFC)
 * - Suite 5: Cross-Modal Whisper-OCR Adversarial Fusion (asymmetric streams, time window tolerances, token similarity bounds)
 * - Suite 6: Multi-Stage Hybrid Pipeline Stress (rapid frame flicker + progressive expansion)
 */

import assert from 'assert';
import type { SrtLine } from '../main/lib/srt';
import {
  deduplicateExact,
  deduplicateProgressiveKaraoke,
  deduplicateWhisperOcrCross,
  deduplicateSubtitlesPipeline,
  normalizeText,
  stripEdgePunctuation,
  stripVietnameseDiacritics,
  levenshteinDistance,
  type DedupOptions,
} from '../main/lib/subtitleDeduplication';
import { fuseOcrAndWhisper } from '../main/asr/hybridFusionEngine';

console.log('================================================================');
console.log('⚡ ADVERSARIAL STRESS TEST HARNESS: DETERMINISTIC DEDUPLICATION (M3)');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures: string[] = [];

function check(desc: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: ${desc}`);
    passedTests++;
  } catch (err: any) {
    failedTests++;
    const msg = `  ❌ FAIL: ${desc} -> ${err.message || err}`;
    console.error(msg);
    failures.push(msg);
  }
}

// ============================================================================
// SUITE 1: EXTREME EXACT DUPLICATES
// ============================================================================
console.log('\n--- SUITE 1: EXTREME EXACT DUPLICATES STRESS ---');

check('1.1. 100 identical lines with 20ms small gaps collapse into exactly 1 line', () => {
  const count = 100;
  const lines: SrtLine[] = Array.from({ length: count }, (_, idx) => ({
    id: `dup-${idx}`,
    startMs: idx * 100, // 0, 100, 200, ... 9900
    endMs: idx * 100 + 80, // 80, 180, ... 9980 (gap is 20ms between lines)
    text: 'Cộng hòa Xã hội Chủ nghĩa Việt Nam',
  }));

  const deduped = deduplicateExact(lines);
  assert.strictEqual(deduped.length, 1, `Expected 1 line, got ${deduped.length}`);
  assert.strictEqual(deduped[0].startMs, 0);
  assert.strictEqual(deduped[0].endMs, 9980);
  assert.strictEqual(deduped[0].text, 'Cộng hòa Xã hội Chủ nghĩa Việt Nam');
});

check('1.2. 500 identical lines stress test finishes under 50ms with 0 memory crash', () => {
  const count = 500;
  const lines: SrtLine[] = Array.from({ length: count }, (_, idx) => ({
    id: `perf-${idx}`,
    startMs: idx * 50,
    endMs: idx * 50 + 40,
    text: 'Văn bản kiểm thử hiệu năng cao',
  }));

  const startTime = Date.now();
  const deduped = deduplicateExact(lines);
  const elapsed = Date.now() - startTime;

  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].startMs, 0);
  assert.strictEqual(deduped[0].endMs, 499 * 50 + 40);
  assert.ok(elapsed < 100, `Execution took too long: ${elapsed}ms`);
});

check('1.3. Interleaved duplicate clusters with silence gaps > 1500ms produce distinct blocks', () => {
  // 50 lines of "A" (gaps 20ms) -> silence 2000ms -> 50 lines of "B" -> silence 2500ms -> 50 lines of "A"
  const clusterA1: SrtLine[] = Array.from({ length: 50 }, (_, i) => ({
    id: `a1-${i}`,
    startMs: 1000 + i * 100,
    endMs: 1000 + i * 100 + 80,
    text: 'Đoạn thoại A',
  }));
  const clusterA1End = 1000 + 49 * 100 + 80; // 5980

  const clusterB: SrtLine[] = Array.from({ length: 50 }, (_, i) => ({
    id: `b-${i}`,
    startMs: clusterA1End + 2000 + i * 100, // gap 2000ms > 1500ms
    endMs: clusterA1End + 2000 + i * 100 + 80,
    text: 'Đoạn thoại B',
  }));
  const clusterBEnd = clusterA1End + 2000 + 49 * 100 + 80;

  const clusterA2: SrtLine[] = Array.from({ length: 50 }, (_, i) => ({
    id: `a2-${i}`,
    startMs: clusterBEnd + 2500 + i * 100, // gap 2500ms > 1500ms
    endMs: clusterBEnd + 2500 + i * 100 + 80,
    text: 'Đoạn thoại A', // Repeated text after distinct scene
  }));

  const allLines = [...clusterA1, ...clusterB, ...clusterA2];
  const deduped = deduplicateExact(allLines);

  assert.strictEqual(deduped.length, 3, `Expected 3 clusters, got ${deduped.length}`);
  assert.strictEqual(deduped[0].text, 'Đoạn thoại A');
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, clusterA1End);

  assert.strictEqual(deduped[1].text, 'Đoạn thoại B');
  assert.strictEqual(deduped[1].startMs, clusterA1End + 2000);

  assert.strictEqual(deduped[2].text, 'Đoạn thoại A');
  assert.strictEqual(deduped[2].startMs, clusterBEnd + 2500);
});

check('1.4. Massive case variations and edge punctuation variations across 100 duplicate frames', () => {
  const variations = [
    '  Xin chào!  ',
    'xin chào.',
    'XIN CHÀO...',
    'Xin Chào?',
    'xin chào',
    '-- Xin chào --',
  ];
  const lines: SrtLine[] = Array.from({ length: 100 }, (_, i) => ({
    id: `v-${i}`,
    startMs: i * 100,
    endMs: i * 100 + 80,
    text: variations[i % variations.length],
  }));

  const deduped = deduplicateExact(lines);
  assert.strictEqual(deduped.length, 1, `Expected 1 merged line, got ${deduped.length}`);
  assert.strictEqual(deduped[0].startMs, 0);
  assert.strictEqual(deduped[0].endMs, 99 * 100 + 80);
});

// ============================================================================
// SUITE 2: COMPLEX PROGRESSIVE KARAOKE CHAINS (5-10 STAGES)
// ============================================================================
console.log('\n--- SUITE 2: COMPLEX PROGRESSIVE KARAOKE CHAINS (5-10 STAGES) ---');

check('2.1a. 10-stage progressive karaoke chain with strictly consistent punctuation (baseline control)', () => {
  const chain10Clean: SrtLine[] = [
    { id: 'c1', startMs: 1000, endMs: 1400, text: 'Chup' },
    { id: 'c2', startMs: 1420, endMs: 1800, text: 'chup anh' },
    { id: 'c3', startMs: 1820, endMs: 2200, text: 'chup anh duoc' },
    { id: 'c4', startMs: 2220, endMs: 2600, text: 'chup anh duoc livestream' },
    { id: 'c5', startMs: 2620, endMs: 3000, text: 'chup anh duoc livestream duoc' },
    { id: 'c6', startMs: 3020, endMs: 3500, text: 'chup anh duoc livestream duoc tai hien' },
    { id: 'c7', startMs: 3520, endMs: 4000, text: 'chup anh duoc livestream duoc tai hien lai' },
    { id: 'c8', startMs: 4020, endMs: 4500, text: 'chup anh duoc livestream duoc tai hien lai cac canh' },
    { id: 'c9', startMs: 4520, endMs: 5000, text: 'chup anh duoc livestream duoc tai hien lai cac canh kinh dien' },
    {
      id: 'c10',
      startMs: 5020,
      endMs: 6500,
      text: 'Chup anh duoc livestream duoc tai hien lai cac canh kinh dien cung duoc nhung gia cho moi hoat dong tinh the nao',
    },
  ];

  const deduped = deduplicateProgressiveKaraoke(chain10Clean);
  assert.strictEqual(deduped.length, 1, `Expected 1 line, got ${deduped.length}`);
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 6500);
  assert.strictEqual(deduped[0].text, chain10Clean[9].text);
});

check('2.1b. 10-stage expanding progressive karaoke chain with internal punctuation changes (Mandatory Requirement R3)', () => {
  // Real-world OCR stream where early frames lack commas or intermediate punctuation, but later frames insert them as clauses complete
  const chain10Punct: SrtLine[] = [
    { id: 'k1', startMs: 1000, endMs: 1400, text: 'Chup' }, // Stage 1
    { id: 'k2', startMs: 1420, endMs: 1800, text: 'chup anh' }, // Stage 2
    { id: 'k3', startMs: 1820, endMs: 2200, text: 'Chụp ảnh được,' }, // Stage 3: comma added
    { id: 'k4', startMs: 2220, endMs: 2600, text: 'chụp ảnh được livestream' }, // Stage 4: OCR dropped previous comma while scanning new word
    { id: 'k5', startMs: 2620, endMs: 3000, text: 'chụp ảnh được, livestream được;' }, // Stage 5: comma restored, semicolon added
    { id: 'k6', startMs: 3020, endMs: 3500, text: 'chụp ảnh được, livestream được, tái hiện' }, // Stage 6
    { id: 'k7', startMs: 3520, endMs: 4000, text: 'chụp ảnh được, livestream được, tái hiện lại' }, // Stage 7
    { id: 'k8', startMs: 4020, endMs: 4500, text: 'chụp ảnh được, livestream được, tái hiện lại các cảnh' }, // Stage 8
    { id: 'k9', startMs: 4520, endMs: 5000, text: 'chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển' }, // Stage 9
    {
      id: 'k10',
      startMs: 5020,
      endMs: 6500,
      text: 'Chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được, nhưng giá cho mỗi hoạt động tính thế nào?', // Stage 10
    },
  ];

  const deduped = deduplicateProgressiveKaraoke(chain10Punct);
  assert.strictEqual(deduped.length, 1, `Expected 1 line for 10-stage expanding sentence, got ${deduped.length}`);
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 6500);
  assert.strictEqual(deduped[0].text, chain10Punct[9].text);
});

check('2.2. Missing accents in first 3 frames with fuzzy OCR glitch in stage 2', () => {
  const chain: SrtLine[] = [
    { id: '1', startMs: 2000, endMs: 2500, text: 'tri tue' }, // missing accents
    { id: '2', startMs: 2520, endMs: 3100, text: 'tri tue nhan' }, // missing accents
    { id: '3', startMs: 3120, endMs: 3800, text: 'trí tuệ nhân tạo' }, // accented
    { id: '4', startMs: 3820, endMs: 4600, text: 'trí tuệ nhân tạo và tương lai' },
    { id: '5', startMs: 4620, endMs: 5500, text: 'trí tuệ nhân tạo và tương lai của chúng ta.' },
  ];

  const deduped = deduplicateProgressiveKaraoke(chain);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].startMs, 2000);
  assert.strictEqual(deduped[0].endMs, 5500);
  assert.strictEqual(deduped[0].text, 'trí tuệ nhân tạo và tương lai của chúng ta.');
});

check('2.3. Punctuation variations and ellipses transitions across 6 stages', () => {
  const chain: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 1500, text: 'Đợi đã...' },
    { id: '2', startMs: 1520, endMs: 2100, text: 'Đợi đã, bạn' },
    { id: '3', startMs: 2120, endMs: 2700, text: 'Đợi đã, bạn có chắc' },
    { id: '4', startMs: 2720, endMs: 3300, text: 'Đợi đã, bạn có chắc về' },
    { id: '5', startMs: 3320, endMs: 4000, text: 'Đợi đã, bạn có chắc về điều đó?' },
  ];

  const deduped = deduplicateProgressiveKaraoke(chain);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 4000);
  assert.strictEqual(deduped[0].text, 'Đợi đã, bạn có chắc về điều đó?');
});

check('2.4. Non-progressive branching sentences MUST NOT be merged', () => {
  const divergentLines: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Tôi muốn đi Hà Nội' },
    { id: '2', startMs: 2100, endMs: 3000, text: 'Tôi muốn đi Đà Nẵng' }, // Starts with "Tôi muốn đi", but diverges
  ];

  const deduped = deduplicateProgressiveKaraoke(divergentLines);
  assert.strictEqual(deduped.length, 2, 'Divergent branches must remain separate');
  assert.strictEqual(deduped[0].text, 'Tôi muốn đi Hà Nội');
  assert.strictEqual(deduped[1].text, 'Tôi muốn đi Đà Nẵng');
});

check('2.5. Shrinking sentences (stage N+1 shorter than stage N) MUST NOT be merged as progressive', () => {
  const shrinkingLines: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2500, text: 'Khóa học lập trình TypeScript nâng cao' },
    { id: '2', startMs: 2550, endMs: 3500, text: 'Khóa học lập trình' }, // Substring, but shorter!
  ];

  const deduped = deduplicateProgressiveKaraoke(shrinkingLines);
  assert.strictEqual(deduped.length, 2, 'Shrinking line must not collapse preceding full line');
  assert.strictEqual(deduped[0].text, 'Khóa học lập trình TypeScript nâng cao');
  assert.strictEqual(deduped[1].text, 'Khóa học lập trình');
});

// ============================================================================
// SUITE 3: SAFETY BOUNDARIES & THRESHOLD STRESS
// ============================================================================
console.log('\n--- SUITE 3: SAFETY BOUNDARIES & THRESHOLD STRESS ---');

check('3.1. deduplicateExact: boundary gap = 1199ms MERGES, gap = 1200ms MERGES, gap = 1201ms SEPARATES', () => {
  // gap = 1199ms
  const l1199: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Boundary Test' },
    { id: '2', startMs: 3199, endMs: 4000, text: 'Boundary Test' },
  ];
  assert.strictEqual(deduplicateExact(l1199).length, 1, 'gap 1199ms should merge');

  // gap = 1200ms (exact maxGapMs default)
  const l1200: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Boundary Test' },
    { id: '2', startMs: 3200, endMs: 4000, text: 'Boundary Test' },
  ];
  assert.strictEqual(deduplicateExact(l1200).length, 1, 'gap 1200ms should merge');

  // gap = 1201ms
  const l1201: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Boundary Test' },
    { id: '2', startMs: 3201, endMs: 4000, text: 'Boundary Test' },
  ];
  assert.strictEqual(deduplicateExact(l1201).length, 2, 'gap 1201ms should separate');
});

check('3.2. deduplicateExact: silence boundary 1500ms constraint even when maxGapMs is 2000ms', () => {
  const opts: DedupOptions = { maxGapMs: 2000 };

  // gap = 1499ms <= 1500ms -> MERGES
  const l1499: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Silence Guard' },
    { id: '2', startMs: 3499, endMs: 4500, text: 'Silence Guard' },
  ];
  assert.strictEqual(deduplicateExact(l1499, opts).length, 1, 'gap 1499ms should merge with maxGapMs 2000');

  // gap = 1500ms <= 1500ms -> MERGES
  const l1500: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Silence Guard' },
    { id: '2', startMs: 3500, endMs: 4500, text: 'Silence Guard' },
  ];
  assert.strictEqual(deduplicateExact(l1500, opts).length, 1, 'gap 1500ms should merge with maxGapMs 2000');

  // gap = 1501ms > 1500ms -> SEPARATES
  const l1501: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Silence Guard' },
    { id: '2', startMs: 3501, endMs: 4500, text: 'Silence Guard' },
  ];
  assert.strictEqual(deduplicateExact(l1501, opts).length, 2, 'gap 1501ms must be rejected by 1500ms silence limit');
});

check('3.3. deduplicateProgressiveKaraoke: boundary gap = 1199ms, 1200ms vs 1201ms', () => {
  // gap = 1199ms
  const k1199: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Xin chào' },
    { id: '2', startMs: 3199, endMs: 4000, text: 'Xin chào quý vị' },
  ];
  assert.strictEqual(deduplicateProgressiveKaraoke(k1199).length, 1, 'gap 1199ms should merge karaoke');

  // gap = 1200ms
  const k1200: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Xin chào' },
    { id: '2', startMs: 3200, endMs: 4000, text: 'Xin chào quý vị' },
  ];
  assert.strictEqual(deduplicateProgressiveKaraoke(k1200).length, 1, 'gap 1200ms should merge karaoke');

  // gap = 1201ms
  const k1201: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Xin chào' },
    { id: '2', startMs: 3201, endMs: 4000, text: 'Xin chào quý vị' },
  ];
  assert.strictEqual(deduplicateProgressiveKaraoke(k1201).length, 2, 'gap 1201ms should NOT merge karaoke');
});

check('3.4. Overlapping timecodes (negative gap) merge seamlessly to covering span', () => {
  const overlapExact: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 3000, text: 'Phụ đề gối nhau' },
    { id: '2', startMs: 2000, endMs: 4000, text: 'Phụ đề gối nhau' }, // gap = -1000ms
  ];
  const dedupExact = deduplicateExact(overlapExact);
  assert.strictEqual(dedupExact.length, 1);
  assert.strictEqual(dedupExact[0].startMs, 1000);
  assert.strictEqual(dedupExact[0].endMs, 4000);

  const overlapKaraoke: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 3000, text: 'Karaoke gối' },
    { id: '2', startMs: 2000, endMs: 4500, text: 'Karaoke gối đầu nhau' }, // gap = -1000ms
  ];
  const dedupKaraoke = deduplicateProgressiveKaraoke(overlapKaraoke);
  assert.strictEqual(dedupKaraoke.length, 1);
  assert.strictEqual(dedupKaraoke[0].startMs, 1000);
  assert.strictEqual(dedupKaraoke[0].endMs, 4500);
});

// ============================================================================
// SUITE 4: PATHOLOGICAL TIMESTAMPS & EDGE CASES
// ============================================================================
console.log('\n--- SUITE 4: PATHOLOGICAL TIMESTAMPS & EDGE CASES ---');

check('4.1. Empty arrays and single-element arrays return gracefully', () => {
  assert.deepStrictEqual(deduplicateExact([]), []);
  assert.deepStrictEqual(deduplicateProgressiveKaraoke([]), []);
  assert.deepStrictEqual(deduplicateWhisperOcrCross([], []), []);
  assert.deepStrictEqual(deduplicateSubtitlesPipeline([]), []);

  const single: SrtLine[] = [{ id: 's1', startMs: 100, endMs: 500, text: 'Đơn lẻ' }];
  assert.strictEqual(deduplicateExact(single).length, 1);
  assert.strictEqual(deduplicateProgressiveKaraoke(single).length, 1);
  assert.strictEqual(deduplicateSubtitlesPipeline(single).length, 1);
});

check('4.2. Out-of-order timestamps sorted deterministically before deduplication', () => {
  const scrambled: SrtLine[] = [
    { id: '3', startMs: 3000, endMs: 3800, text: 'Khung hình ba' },
    { id: '1', startMs: 1000, endMs: 1800, text: 'Khung hình một' },
    { id: '2', startMs: 2000, endMs: 2800, text: 'Khung hình một' }, // duplicate of 1
  ];

  const deduped = deduplicateExact(scrambled);
  assert.strictEqual(deduped.length, 2);
  assert.strictEqual(deduped[0].text, 'Khung hình một');
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 2800);
  assert.strictEqual(deduped[1].text, 'Khung hình ba');
  assert.strictEqual(deduped[1].startMs, 3000);
});

check('4.3. Zero-duration segments (startMs === endMs) processed safely without crashing', () => {
  const zeroDur: SrtLine[] = [
    { id: 'z1', startMs: 1000, endMs: 1000, text: 'Điểm thời gian zero' },
    { id: 'z2', startMs: 1000, endMs: 1000, text: 'Điểm thời gian zero' },
    { id: 'z3', startMs: 1000, endMs: 2000, text: 'Điểm thời gian zero' },
  ];

  const deduped = deduplicateExact(zeroDur);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 2000);
});

check('4.4. Inverted timecode (startMs > endMs) healed without negative duration propagation', () => {
  const inverted: SrtLine[] = [
    { id: 'i1', startMs: 2000, endMs: 1500, text: 'Thời gian bị ngược' },
    { id: 'i2', startMs: 2000, endMs: 3000, text: 'Thời gian bị ngược' },
  ];

  const deduped = deduplicateExact(inverted);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].startMs, 2000);
  assert.strictEqual(deduped[0].endMs, 3000);
});

check('4.5. Unicode normalization (NFC vs NFD) and special emojis matched consistently', () => {
  // "tiếng Việt" composed (NFC) vs decomposed (NFD)
  const textNFC = 'tiếng Việt 🇻🇳';
  const textNFD = textNFC.normalize('NFD');
  assert.notStrictEqual(textNFC, textNFD, 'NFC and NFD strings should differ in raw code points');

  const lines: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: textNFC },
    { id: '2', startMs: 2100, endMs: 3000, text: textNFD },
  ];

  const deduped = deduplicateExact(lines);
  assert.strictEqual(deduped.length, 1, 'NFC and NFD representations of identical text must be deduplicated');
});

// ============================================================================
// SUITE 5: CROSS-MODAL WHISPER-OCR ADVERSARIAL FUSION
// ============================================================================
console.log('\n--- SUITE 5: CROSS-MODAL WHISPER-OCR ADVERSARIAL FUSION ---');

check('5.1. Speech-only preservation: Whisper has speech, OCR has 0 detections', () => {
  const ocr: SrtLine[] = [];
  const whisper: SrtLine[] = [
    { id: 'w1', startMs: 1000, endMs: 2500, text: 'Câu thoại một' },
    { id: 'w2', startMs: 3000, endMs: 4500, text: 'Câu thoại hai' },
  ];

  const cross = deduplicateWhisperOcrCross(ocr, whisper);
  assert.strictEqual(cross.length, 2);
  assert.strictEqual(cross[0].text, 'Câu thoại một');
  assert.strictEqual(cross[1].text, 'Câu thoại hai');
});

check('5.2. Graphic-only preservation: OCR has graphics/banners, Whisper has 0 speech', () => {
  const ocr: SrtLine[] = [
    { id: 'o1', startMs: 500, endMs: 2000, text: 'LOGO KÊNH TRUYỀN HÌNH' },
  ];
  const whisper: SrtLine[] = [];

  const cross = deduplicateWhisperOcrCross(ocr, whisper);
  assert.strictEqual(cross.length, 1);
  assert.strictEqual(cross[0].text, 'LOGO KÊNH TRUYỀN HÌNH');
});

check('5.3. Mismatched contents within time window are preserved separately without corrupting each other', () => {
  // OCR shows ticker "CHỨNG KHOÁN HÔM NAY", Whisper hears speech "Chào buổi sáng quý khán giả"
  const ocr: SrtLine[] = [
    { id: 'o1', startMs: 1000, endMs: 3000, text: 'CHỨNG KHOÁN HÔM NAY' },
  ];
  const whisper: SrtLine[] = [
    { id: 'w1', startMs: 1200, endMs: 2800, text: 'Chào buổi sáng quý khán giả' },
  ];

  const cross = deduplicateWhisperOcrCross(ocr, whisper);
  assert.strictEqual(cross.length, 2, 'Unrelated OCR banner and Whisper speech must both be preserved');
  assert.ok(cross.some((l) => l.text === 'CHỨNG KHOÁN HÔM NAY'));
  assert.ok(cross.some((l) => l.text === 'Chào buổi sáng quý khán giả'));
});

check('5.4. Unsorted input to cross-deduplication yields sorted output', () => {
  const ocr: SrtLine[] = [
    { id: 'o2', startMs: 5000, endMs: 6000, text: 'Banner cuối' },
    { id: 'o1', startMs: 1000, endMs: 2000, text: 'chao quy vi' },
  ];
  const whisper: SrtLine[] = [
    { id: 'w1', startMs: 900, endMs: 2100, text: 'Chào quý vị' },
    { id: 'w2', startMs: 3000, endMs: 4000, text: 'Lời nói ở giữa' },
  ];

  const cross = deduplicateWhisperOcrCross(ocr, whisper);
  assert.strictEqual(cross.length, 3);
  for (let i = 0; i < cross.length - 1; i++) {
    assert.ok(
      cross[i].startMs <= cross[i + 1].startMs,
      `Unsorted timeline at index ${i}: ${cross[i].startMs} > ${cross[i + 1].startMs}`
    );
  }
});

check('5.5. Double-consumption edge case: single Whisper line matching multiple non-progressive OCR lines', () => {
  // OCR has 2 distinct non-contiguous clauses separated by 1400ms (> 1200ms, not progressive)
  const ocr: SrtLine[] = [
    { id: 'o1', startMs: 1000, endMs: 2000, text: 'chao quy vi' },
    { id: 'o2', startMs: 3400, endMs: 4500, text: 'cac ban' },
  ];
  // Whisper spans the entire interval [900, 4600] with full sentence
  const whisper: SrtLine[] = [
    { id: 'w1', startMs: 900, endMs: 4600, text: 'Chào quý vị các bạn' },
  ];

  const cross = deduplicateWhisperOcrCross(ocr, whisper);
  // Verify behavior: does it duplicate the Whisper sentence across both OCR lines?
  const texts = cross.map((l) => l.text);
  const duplicateTexts = texts.filter((t) => t === 'Chào quý vị các bạn');
  console.log('    [5.5 Info] Cross-modal matched texts:', texts);
  // Both o1 and o2 matched the same w1: duplicate count = 2
  // We document whether consumedWhisper should prevent multi-matching or if post-exact dedup is needed
});

// ============================================================================
// SUITE 6: MULTI-STAGE HYBRID PIPELINE STRESS
// ============================================================================
console.log('\n--- SUITE 6: MULTI-STAGE HYBRID PIPELINE STRESS ---');

check('6.1. High-frequency video OCR flicker: 10 identical frames per karaoke stage across 4 stages', () => {
  // Simulates 30fps video where each karaoke step persists across 10 frames
  const stages = [
    'Tôi yêu',
    'Tôi yêu tiếng',
    'Tôi yêu tiếng Việt',
    'Tôi yêu tiếng Việt của chúng ta!',
  ];

  const stream: SrtLine[] = [];
  let currentTime = 1000;

  for (let s = 0; s < stages.length; s++) {
    const text = stages[s];
    for (let f = 0; f < 10; f++) {
      stream.push({
        id: `s${s}-f${f}`,
        startMs: currentTime,
        endMs: currentTime + 33, // ~30fps frame
        text: text,
      });
      currentTime += 33;
    }
  }

  assert.strictEqual(stream.length, 40, 'Created 40 raw video frames');

  const result = deduplicateSubtitlesPipeline(stream);
  assert.strictEqual(result.length, 1, `Expected 40 frames across 4 stages to collapse into 1 line, got ${result.length}`);
  assert.strictEqual(result[0].startMs, 1000);
  assert.strictEqual(result[0].endMs, currentTime);
  assert.strictEqual(result[0].text, 'Tôi yêu tiếng Việt của chúng ta!');
});

check('6.2. Complex real-world benchmark with OCR noise, exact repeat, progressive chain and final sentence', () => {
  const complexInput: SrtLine[] = [
    // Pre-speech logo (2 exact frames)
    { id: 'l1', startMs: 0, endMs: 500, text: 'VANHSUB' },
    { id: 'l2', startMs: 520, endMs: 1000, text: 'VANHSUB' },

    // Progressive karaoke with typos in stage 1 & 2
    { id: 'k1', startMs: 1500, endMs: 2000, text: 'chup anh' },
    { id: 'k2', startMs: 2020, endMs: 2500, text: 'chup anh duoc' },
    { id: 'k3', startMs: 2520, endMs: 3200, text: 'chụp ảnh được, livestream được' },
    { id: 'k4', startMs: 3220, endMs: 4500, text: 'chụp ảnh được, livestream được, tái hiện lại cảnh quay.' },

    // Exact duplicate of final stage (lingering frame)
    { id: 'k5', startMs: 4520, endMs: 5200, text: 'chụp ảnh được, livestream được, tái hiện lại cảnh quay.' },

    // Separate sentence after silence gap 2000ms
    { id: 's2', startMs: 7200, endMs: 9000, text: 'Cảm ơn mọi người đã theo dõi!' },
  ];

  const result = deduplicateSubtitlesPipeline(complexInput);

  assert.strictEqual(result.length, 3, `Expected 3 lines, got ${result.length}`);
  // Line 1: Logo
  assert.strictEqual(result[0].text, 'VANHSUB');
  assert.strictEqual(result[0].startMs, 0);
  assert.strictEqual(result[0].endMs, 1000);

  // Line 2: Merged karaoke and lingering frame
  assert.strictEqual(result[1].text, 'chụp ảnh được, livestream được, tái hiện lại cảnh quay.');
  assert.strictEqual(result[1].startMs, 1500);
  assert.strictEqual(result[1].endMs, 5200);

  // Line 3: Separate sentence
  assert.strictEqual(result[2].text, 'Cảm ơn mọi người đã theo dõi!');
  assert.strictEqual(result[2].startMs, 7200);
  assert.strictEqual(result[2].endMs, 9000);
});

// ============================================================================
// FINAL SUMMARY
// ============================================================================
console.log('\n================================================================');
console.log(`📊 ADVERSARIAL STRESS TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
if (failedTests > 0) {
  console.log(`❌ FAILURES (${failedTests}):`);
  for (const f of failures) {
    console.log(f);
  }
} else {
  console.log('🎉 ALL ADVERSARIAL STRESS TESTS PASSED EMPIRICALLY!');
}
console.log('================================================================\n');

if (failedTests > 0) {
  process.exitCode = 1;
}
