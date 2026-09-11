import assert from 'assert';
import {
  checkMergeMatch,
  buildSubtitleSegments,
  deduplicateSubtitleSegments,
} from '../main/ocr/subtitleBuilder';
import type { OcrFrameResult } from '../main/ocr/ocrEngine';

console.log('Testing subtitle deduplication & similarity logic...');

// Test 1: Identical strings
const m1 = checkMergeMatch('Xin chào các bạn', 'Xin chào các bạn');
assert.strictEqual(m1.matched, true);
console.log('✓ Test 1 passed: Identical strings');

// Test 2: 1-accent jitter on short/medium sentence (16 chars)
const m2 = checkMergeMatch('Xin chào các bạn', 'Xin chao các bạn');
assert.strictEqual(m2.matched, true);
console.log('✓ Test 2 passed: 1-accent jitter merged');

// Test 3: Cumulative / Karaoke prefix matching
const m3 = checkMergeMatch('Hôm nay tôi', 'Hôm nay tôi đi học');
assert.strictEqual(m3.matched, true);
assert.strictEqual(m3.bestText, 'Hôm nay tôi đi học');
console.log('✓ Test 3 passed: Cumulative / Karaoke merged with longer text');

// Test 4: Completely different short sentences should NOT merge
const m4 = checkMergeMatch('Xin chào', 'Tạm biệt');
assert.strictEqual(m4.matched, false);
console.log('✓ Test 4 passed: Distinct sentences not merged');

// Test 5: deduplicateSubtitleSegments merges adjacent duplicate segments with small gap
const rawSegs = [
  { startMs: 1000, endMs: 2500, text: 'Tôi là kỹ sư phần mềm' },
  { startMs: 2700, endMs: 4000, text: 'Tôi là ky su phần mềm' }, // gap 200ms, minor typo
  { startMs: 5000, endMs: 7000, text: 'Rất vui được gặp bạn' },
];
const deduped = deduplicateSubtitleSegments(rawSegs, 500);
assert.strictEqual(deduped.length, 2, `Expected 2 segments but got ${deduped.length}`);
assert.strictEqual(deduped[0].startMs, 1000);
assert.strictEqual(deduped[0].endMs, 4000);
assert.strictEqual(deduped[1].text, 'Rất vui được gặp bạn');
console.log('✓ Test 5 passed: Deduplication merged adjacent duplicate segments');

// Test 6: buildSubtitleSegments with flickering frames
const frames: OcrFrameResult[] = [
  { text: 'Xin chào các bạn', confidence: 95, lines: [] },
  { text: 'Xin chao các bạn', confidence: 90, lines: [] },
  { text: 'Xin chào các bạn', confidence: 98, lines: [] },
  { text: '', confidence: 0, lines: [] }, // 1 noise gap
  { text: 'Xin chào các bạn', confidence: 95, lines: [] },
  { text: '', confidence: 0, lines: [] },
  { text: '', confidence: 0, lines: [] },
  { text: 'Tạm biệt nha', confidence: 95, lines: [] },
  { text: 'Tạm biệt nha', confidence: 95, lines: [] },
];
const srtLines = buildSubtitleSegments(frames, 500);
console.log('Built SRT lines:', srtLines);
assert.strictEqual(srtLines.length, 2, `Expected 2 lines but got ${srtLines.length}`);
assert.strictEqual(srtLines[0].text, 'Xin chào các bạn');
assert.strictEqual(srtLines[1].text, 'Tạm biệt nha');
console.log('✓ Test 6 passed: Consecutive flickering frames merged into exactly 1 line');

console.log('ALL DEDUPLICATION TESTS PASSED SUCCESSFULLY! 🎉');
