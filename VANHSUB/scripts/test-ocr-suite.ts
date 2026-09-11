import assert from 'assert';
import { buildSubtitleSegments } from '../main/ocr/subtitleBuilder';
import type { OcrFrameResult } from '../main/ocr/ocrEngine';

console.log('====================================================');
console.log('RUNNING COMPREHENSIVE 7-SCENARIO OCR TEST SUITE');
console.log('====================================================\n');

// ---------------------------------------------------------------------------
// TEST 1: Same subtitle across 20 frames -> 1 event
// ---------------------------------------------------------------------------
console.log('TEST 1: Same subtitle across 20 frames -> 1 event');
const test1Frames: OcrFrameResult[] = Array.from({ length: 20 }, (_, i) => ({
  text: 'Đây là phụ đề thử nghiệm',
  confidence: 92,
  lines: [
    {
      text: 'Đây là phụ đề thử nghiệm',
      confidence: 92,
      y0: 620,
      h: 30,
      classification: 'SUBTITLE',
    },
  ],
}));

const res1 = buildSubtitleSegments(test1Frames, 500);
assert.strictEqual(res1.length, 1, `Expected 1 event, got ${res1.length}`);
assert.strictEqual(res1[0].text, 'Đây là phụ đề thử nghiệm');
assert.strictEqual(res1[0].startMs, 0);
assert.strictEqual(res1[0].endMs, 10000);
assert.strictEqual(res1[0].frames, 20);
assert.strictEqual(res1[0].confidence, 92);
assert.strictEqual(res1[0].stable, true);
assert.strictEqual(res1[0].needsReview, false);
console.log('✓ PASS Test 1: Exactly 1 event generated from 20 continuous frames [0ms - 10000ms]\n');

// ---------------------------------------------------------------------------
// TEST 2: Same subtitle with OCR typo in some frames -> 1 event (stable text chosen)
// ---------------------------------------------------------------------------
console.log('TEST 2: Same subtitle with OCR typo in some frames -> 1 event (stable text chosen)');
const test2Frames: OcrFrameResult[] = Array.from({ length: 20 }, (_, i) => {
  // 16 frames accurate, 4 frames have typo
  const isTypo = i === 3 || i === 7 || i === 12 || i === 18;
  const text = isTypo ? 'Thành phó Hồ Chí M1nh' : 'Thành phố Hồ Chí Minh';
  const conf = isTypo ? 75 : 94;
  return {
    text,
    confidence: conf,
    lines: [
      {
        text,
        confidence: conf,
        y0: 620,
        h: 30,
        classification: 'SUBTITLE',
      },
    ],
  };
});

const res2 = buildSubtitleSegments(test2Frames, 500);
assert.strictEqual(res2.length, 1, `Expected 1 event, got ${res2.length}`);
assert.strictEqual(res2[0].text, 'Thành phố Hồ Chí Minh', `Expected stable text, got: ${res2[0].text}`);
assert.strictEqual(res2[0].frames, 20);
assert.strictEqual(res2[0].stable, true);
console.log(`✓ PASS Test 2: Majority text consensus resolved typo to: "${res2[0].text}"\n`);

// ---------------------------------------------------------------------------
// TEST 3: Two different subtitles -> 2 events
// ---------------------------------------------------------------------------
console.log('TEST 3: Two different subtitles -> 2 events');
const test3Frames: OcrFrameResult[] = [
  ...Array.from({ length: 6 }, () => ({
    text: 'Xin chào quý khán giả',
    confidence: 90,
    lines: [{ text: 'Xin chào quý khán giả', confidence: 90, y0: 620, h: 30, classification: 'SUBTITLE' as const }],
  })),
  ...Array.from({ length: 6 }, () => ({
    text: 'Hôm nay chúng ta cùng học lập trình',
    confidence: 95,
    lines: [{ text: 'Hôm nay chúng ta cùng học lập trình', confidence: 95, y0: 620, h: 30, classification: 'SUBTITLE' as const }],
  })),
];

const res3 = buildSubtitleSegments(test3Frames, 500);
assert.strictEqual(res3.length, 2, `Expected 2 events, got ${res3.length}`);
assert.strictEqual(res3[0].text, 'Xin chào quý khán giả');
assert.strictEqual(res3[1].text, 'Hôm nay chúng ta cùng học lập trình');
assert.ok(res3[0].endMs <= res3[1].startMs, 'Events must not overlap');
console.log('✓ PASS Test 3: Two distinct consecutive subtitles created 2 separate events\n');

// ---------------------------------------------------------------------------
// TEST 4: Same text appears again after 5 seconds -> 2 events
// ---------------------------------------------------------------------------
console.log('TEST 4: Same text appears again after 5 seconds -> 2 events');
const test4Frames: OcrFrameResult[] = [
  // Event 1: frames 0-3 (0s - 2s)
  ...Array.from({ length: 4 }, () => ({
    text: 'Đăng ký kênh ủng hộ nhé',
    confidence: 95,
    lines: [{ text: 'Đăng ký kênh ủng hộ nhé', confidence: 95, y0: 620, h: 30, classification: 'SUBTITLE' as const }],
  })),
  // 10 empty frames (5 seconds gap)
  ...Array.from({ length: 10 }, () => ({
    text: '',
    confidence: 0,
    lines: [],
  })),
  // Event 2: frames 14-17 (7s - 9s)
  ...Array.from({ length: 4 }, () => ({
    text: 'Đăng ký kênh ủng hộ nhé',
    confidence: 95,
    lines: [{ text: 'Đăng ký kênh ủng hộ nhé', confidence: 95, y0: 620, h: 30, classification: 'SUBTITLE' as const }],
  })),
];

const res4 = buildSubtitleSegments(test4Frames, 500);
assert.strictEqual(res4.length, 2, `Expected 2 events due to 5s gap, got ${res4.length}`);
assert.strictEqual(res4[0].text, 'Đăng ký kênh ủng hộ nhé');
assert.strictEqual(res4[1].text, 'Đăng ký kênh ủng hộ nhé');
assert.strictEqual(res4[0].startMs, 0);
assert.strictEqual(res4[0].endMs, 2000);
assert.strictEqual(res4[1].startMs, 7000);
assert.strictEqual(res4[1].endMs, 9000);
console.log('✓ PASS Test 4: Same text repeated after 5s was preserved as 2 distinct events\n');

// ---------------------------------------------------------------------------
// TEST 5: OCR misses 1 frame in between -> Still 1 event
// ---------------------------------------------------------------------------
console.log('TEST 5: OCR misses 1 frame in between -> Still 1 event');
const test5Frames: OcrFrameResult[] = [
  // Frame 0, 1, 2
  ...Array.from({ length: 3 }, () => ({
    text: 'Khoa học và công nghệ vũ trụ',
    confidence: 92,
    lines: [{ text: 'Khoa học và công nghệ vũ trụ', confidence: 92, y0: 620, h: 30, classification: 'SUBTITLE' as const }],
  })),
  // Frame 3: missed frame / flicker
  { text: '', confidence: 0, lines: [] },
  // Frame 4, 5, 6
  ...Array.from({ length: 3 }, () => ({
    text: 'Khoa học và công nghệ vũ trụ',
    confidence: 94,
    lines: [{ text: 'Khoa học và công nghệ vũ trụ', confidence: 94, y0: 620, h: 30, classification: 'SUBTITLE' as const }],
  })),
];

const res5 = buildSubtitleSegments(test5Frames, 500);
assert.strictEqual(res5.length, 1, `Expected 1 merged event, got ${res5.length}`);
assert.strictEqual(res5[0].text, 'Khoa học và công nghệ vũ trụ');
assert.strictEqual(res5[0].startMs, 0);
assert.strictEqual(res5[0].endMs, 3500);
console.log('✓ PASS Test 5: Flickering frame bridged smoothly into 1 event [0ms - 3500ms]\n');

// ---------------------------------------------------------------------------
// TEST 6: Top overlay + bottom subtitle -> Detects both separately without merging
// ---------------------------------------------------------------------------
console.log('TEST 6: Top overlay + bottom subtitle -> Detects both separately without merging');
const test6Frames: OcrFrameResult[] = Array.from({ length: 8 }, () => ({
  text: 'BẢN TIN BUỔI SÁNG Thời tiết hôm nay nắng ráo',
  confidence: 92,
  lines: [
    {
      text: 'BẢN TIN BUỔI SÁNG',
      confidence: 95,
      y0: 45,
      h: 28,
      classification: 'OVERLAY',
    },
    {
      text: 'Thời tiết hôm nay nắng ráo',
      confidence: 90,
      y0: 650,
      h: 32,
      classification: 'SUBTITLE',
    },
  ],
}));

const res6 = buildSubtitleSegments(test6Frames, 500);
assert.strictEqual(res6.length, 2, `Expected 2 separate events, got ${res6.length}`);
const overlay = res6.find((s) => s.text === 'BẢN TIN BUỔI SÁNG');
const subtitle = res6.find((s) => s.text === 'Thời tiết hôm nay nắng ráo');
assert.ok(overlay, 'Overlay text should exist separately');
assert.ok(subtitle, 'Subtitle text should exist separately');
console.log('✓ PASS Test 6: Top overlay and bottom subtitle kept in separate parallel tracks\n');

// ---------------------------------------------------------------------------
// TEST 7: Low confidence OCR -> needsReview === true
// ---------------------------------------------------------------------------
console.log('TEST 7: Low confidence OCR -> needsReview === true');
// Sub-case 7a: Low confidence
const test7aFrames: OcrFrameResult[] = Array.from({ length: 4 }, () => ({
  text: 'Chữ mờ khó đọc',
  confidence: 58,
  lines: [{ text: 'Chữ mờ khó đọc', confidence: 58, y0: 620, h: 30, classification: 'SUBTITLE' as const }],
}));
const res7a = buildSubtitleSegments(test7aFrames, 500);
assert.strictEqual(res7a.length, 1);
assert.strictEqual(res7a[0].needsReview, true, 'Confidence < 65 must have needsReview === true');
assert.strictEqual(res7a[0].confidence, 58);

// Sub-case 7b: Single frame only (frames === 1)
const test7bFrames: OcrFrameResult[] = [
  {
    text: 'Chớp tắt 1 frame',
    confidence: 88,
    lines: [{ text: 'Chớp tắt 1 frame', confidence: 88, y0: 620, h: 30, classification: 'SUBTITLE' as const }],
  },
];
const res7b = buildSubtitleSegments(test7bFrames, 500);
assert.strictEqual(res7b.length, 1);
assert.strictEqual(res7b[0].needsReview, true, 'Single frame must have needsReview === true');
assert.strictEqual(res7b[0].frames, 1);

// Sub-case 7c: High confidence & multi-frame (stable)
const test7cFrames: OcrFrameResult[] = Array.from({ length: 6 }, () => ({
  text: 'Chữ nét và rõ ràng',
  confidence: 95,
  lines: [{ text: 'Chữ nét và rõ ràng', confidence: 95, y0: 620, h: 30, classification: 'SUBTITLE' as const }],
}));
const res7c = buildSubtitleSegments(test7cFrames, 500);
assert.strictEqual(res7c.length, 1);
assert.strictEqual(res7c[0].needsReview, false);
assert.strictEqual(res7c[0].stable, true);
console.log('✓ PASS Test 7: needsReview and stable flags evaluated accurately for all confidence levels\n');

console.log('====================================================');
console.log('ALL 7 OCR TEST SCENARIOS PASSED WITH 100% SUCCESS! 🎉');
console.log('====================================================');
