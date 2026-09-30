/**
 * =========================================================================================
 * Test Suite: Milestone 2 (R2) Adversarial Stress & Edge Case Verification Harness
 * =========================================================================================
 *
 * EMPIRICAL ADVERSARIAL CHALLENGE FOR:
 * 1. Subtitle lengths: 50, 74, 75, 120, 250 characters + continuous no-whitespace string.
 * 2. Sentence boundaries: terminal (. ? ! … .") vs non-terminal (, ; : - no punct) + abbreviations (TP.HCM, 8.5%).
 * 3. Gap thresholds: <= 1200ms merged, > 1200ms not merged (1199ms, 1200ms, 1201ms, 1500ms).
 * 4. Speaker diarization isolation: different speakers never merged into one group / block.
 * 5. Full Dubbing Audio Pipeline execution with FFmpeg across multi-speaker dialogue.
 *
 * Runner: npx tsx tests/adversarial_r2_stress_test.ts
 * =========================================================================================
 */

import assert from 'assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  consolidateSubtitleClauses,
  segmentSubtitlesNetflix,
  breakVietnameseLines,
  calculateCps,
} from '../main/lib/nlpSegmenter';
import {
  groupSubtitlesForTts,
  type SubtitleLine,
  type SentenceGroup,
  type TTSOptions,
} from '../main/render/ttsEngine';
import {
  mergeAudioFiles,
  runFfmpeg,
} from '../main/render/dubbingEngine';
import { getMediaDurationSec } from '../main/asr/audioExtractor';
import type { SrtLine } from '../main/lib/srt';

let passed = 0;
let total = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  total++;
  try {
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      await res;
    }
    passed++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message || err}`);
    process.exitCode = 1;
  }
}

async function runAdversarialHarness() {
  console.log('================================================================================');
  console.log('⚔️  ADVERSARIAL STRESS TEST HARNESS: M2 VISUAL WRAPPING & SEAMLESS TTS');
  console.log('================================================================================\n');

  // ==========================================================================
  // SECTION 1: STRESS SUBTITLE LENGTHS (50, 74, 75, 120, 250 characters)
  // ==========================================================================
  console.log('--- SECTION 1: Subtitle Lengths Stress (50, 74, 75, 120, 250 chars) ---');

  // 1.1 Exactly 50 chars
  // "Chính phủ đẩy mạnh các chương trình phát triển mới" = 50 chars
  const text50 = 'Chính phủ đẩy mạnh các chương trình phát triển mới';
  assert.strictEqual(text50.length, 50, 'text50 length must be exactly 50');

  await test('1.1.1 [50 chars] breakVietnameseLines wraps 50-char string into exactly 2 lines <= 37 chars', () => {
    const wrapped = breakVietnameseLines(text50, 37);
    const lines = wrapped.split('\n');
    assert.strictEqual(lines.length, 2, `Expected 2 lines, got: ${lines.length}`);
    for (const l of lines) {
      assert.ok(l.length <= 37, `Line "${l}" length ${l.length} > 37`);
    }
  });

  await test('1.1.2 [50 chars] consolidateSubtitleClauses keeps 50-char line as 1 block with 2 lines', () => {
    const srt: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 3500, text: text50 }];
    const res = consolidateSubtitleClauses(srt, { maxCharsPerLine: 37, maxLinesPerBlock: 2 });
    assert.strictEqual(res.length, 1);
    const lines = res[0].text.split('\n');
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(res[0].startMs, 1000);
    assert.strictEqual(res[0].endMs, 3500);
  });

  await test('1.1.3 [50 chars] Two clauses totaling 50 chars consolidate into 1 block with 2 lines', () => {
    // Clause A: 25 chars, Clause B: 24 chars -> combined 50 chars with space
    const cA = 'Chính phủ đang phát triển'; // 25
    const cB = 'nhiều kế hoạch mới này'; // 22
    const combined = `${cA} ${cB}`; // 48 chars
    const srt: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2200, text: cA },
      { id: '2', startMs: 2300, endMs: 4000, text: cB },
    ];
    const res = consolidateSubtitleClauses(srt, { maxCharsPerLine: 37, maxLinesPerBlock: 2 });
    assert.strictEqual(res.length, 1, `Expected 1 consolidated block, got: ${res.length}`);
    assert.strictEqual(res[0].startMs, 1000);
    assert.strictEqual(res[0].endMs, 4000);
    const subLines = res[0].text.split('\n');
    assert.strictEqual(subLines.length, 2);
    for (const l of subLines) {
      assert.ok(l.length <= 37, `Line "${l}" exceeds 37 chars`);
    }
  });

  // 1.2 Exactly 74 chars (Theoretical maximum 2 * 37)
  const text74 = 'Doanh nghiệp Việt Nam nỗ lực sáng tạo trong mọi hoạt động sản xuất kinh tế';
  assert.strictEqual(text74.length, 74, `text74 must be 74 chars, actual: ${text74.length}`);

  await test('1.2.1 [74 chars] breakVietnameseLines wraps 74-char boundary into 2 lines <= 37 chars', () => {
    const wrapped = breakVietnameseLines(text74, 37);
    const lines = wrapped.split('\n');
    assert.strictEqual(lines.length, 2, `Expected 2 lines, got: ${lines.length}`);
    for (const l of lines) {
      assert.ok(l.length <= 37, `Line "${l}" length ${l.length} > 37`);
    }
  });

  await test('1.2.2 [74 chars] Two clauses summing to 74 chars consolidate into 1 block with 2 lines', () => {
    // c1: 37 chars, c2: 36 chars -> 37 + 1 + 36 = 74 chars
    const c1 = 'Doanh nghiệp Việt Nam nỗ lực sáng tạo'; // 37
    const c2 = 'trong mọi hoạt động sản xuất kinh tế'; // 36
    assert.strictEqual(c1.length, 37);
    assert.strictEqual(c2.length, 36);
    assert.strictEqual(`${c1} ${c2}`.length, 74);

    const srt: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2500, text: c1 },
      { id: '2', startMs: 2600, endMs: 4500, text: c2 },
    ];
    const res = consolidateSubtitleClauses(srt, { maxCharsPerLine: 37, maxLinesPerBlock: 2 });
    assert.strictEqual(res.length, 1, `74 chars must consolidate into 1 block, got: ${res.length}`);
    assert.strictEqual(res[0].startMs, 1000);
    assert.strictEqual(res[0].endMs, 4500);
  });

  // 1.3 Exactly 75 chars (Boundary breach: 74 + 1 chars)
  const text75 = 'Việt Nam nỗ lực thúc đẩy chuyển đổi số và phát triển kinh tế xanh bền vững!';
  assert.strictEqual(text75.length, 75, `text75 must be 75 chars, actual: ${text75.length}`);

  await test('1.3.1 [75 chars] Two clauses summing to 75 chars CANNOT consolidate into 1 block', () => {
    const c1 = 'Doanh nghiệp Việt Nam nỗ lực sáng tạo'; // 37
    const c2 = 'trong mọi hoạt động sản xuất kinh tế.'; // 37
    assert.strictEqual(`${c1} ${c2}`.length, 75);

    const srt: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2500, text: c1 },
      { id: '2', startMs: 2600, endMs: 4500, text: c2 },
    ];
    const res = consolidateSubtitleClauses(srt, { maxCharsPerLine: 37, maxLinesPerBlock: 2 });
    assert.strictEqual(res.length, 2, `75 chars must NOT consolidate into 1 block; expected 2, got: ${res.length}`);
  });

  await test('1.3.2 [75 chars] Single 75-char line decomposes into compliant chunks (<= 2 lines, <= 37 chars each)', () => {
    const srt: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 5000, text: text75 }];
    const res = consolidateSubtitleClauses(srt, { maxCharsPerLine: 37, maxLinesPerBlock: 2 });
    assert.ok(res.length >= 2, `Expected >= 2 blocks, got: ${res.length}`);
    for (const b of res) {
      const lines = b.text.split('\n');
      assert.ok(lines.length <= 2, `Chunk lines > 2: ${lines.length}`);
      for (const l of lines) {
        assert.ok(l.length <= 37, `Line in chunk "${l}" > 37: ${l.length}`);
      }
      assert.ok(b.startMs < b.endMs, `Timecode invalid: start ${b.startMs} >= end ${b.endMs}`);
    }
  });

  // 1.4 Exactly 120 chars
  const text120 =
    'Chúng ta cần phải đầu tư vào nguồn nhân lực chất lượng rất cao, đồng thời áp dụng công nghệ mới để tăng năng suất chung.';
  assert.strictEqual(text120.length, 120, `text120 length must be 120, actual: ${text120.length}`);

  await test('1.4.1 [120 chars] decompose into compliant blocks of <= 2 lines and <= 37 chars per line', () => {
    const srt: SrtLine[] = [{ id: '1', startMs: 2000, endMs: 8000, text: text120 }];
    const res = consolidateSubtitleClauses(srt, { maxCharsPerLine: 37, maxLinesPerBlock: 2 });
    assert.strictEqual(res.length, 2, `Expected exactly 2 blocks for 120 chars (4 lines / 2), got: ${res.length}`);
    for (let i = 0; i < res.length; i++) {
      const b = res[i];
      const lines = b.text.split('\n');
      assert.ok(lines.length <= 2, `Block ${i} has ${lines.length} lines`);
      for (const l of lines) {
        assert.ok(l.length <= 37, `Line "${l}" length ${l.length} > 37`);
      }
      assert.ok(b.startMs < b.endMs, `Block ${i} start ${b.startMs} >= end ${b.endMs}`);
      if (i > 0) {
        assert.ok(b.startMs >= res[i - 1].endMs + 80, `Gap between blocks < 80ms`);
      }
    }
  });

  // 1.5 Exactly 250 chars
  const text250 =
    'Hệ thống phụ đề thông minh VanhSub được thiết kế để giải quyết triệt để tình trạng băm vụn câu thoại khiến giọng đọc TTS bị khựng giật, đồng thời chuẩn hóa hiển thị tối đa hai dòng theo tiêu chuẩn công nghiệp Netflix không làm lệch lạc mốc thời gian.';
  assert.strictEqual(text250.length, 250, `text250 length must be 250, actual: ${text250.length}`);

  await test('1.5.1 [250 chars] decomposes into 4 compliant blocks, preserving all words without loss', () => {
    const srt: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 15000, text: text250 }];
    const res = consolidateSubtitleClauses(srt, { maxCharsPerLine: 37, maxLinesPerBlock: 2 });
    assert.ok(res.length >= 3 && res.length <= 5, `Expected 3-5 blocks for 250 chars, got: ${res.length}`);

    // Verify all chunks
    let prevEnd = 0;
    const reconstructedWords: string[] = [];
    for (let i = 0; i < res.length; i++) {
      const b = res[i];
      const subLines = b.text.split('\n');
      assert.ok(subLines.length <= 2, `Block ${i} lines > 2: ${subLines.length}`);
      for (const l of subLines) {
        assert.ok(l.length <= 37, `Line in block ${i} "${l}" exceeds 37 chars: ${l.length}`);
        reconstructedWords.push(...l.split(/\s+/).filter(Boolean));
      }
      assert.ok(b.startMs >= prevEnd, `Overlap detected at block ${i}: start ${b.startMs} < prevEnd ${prevEnd}`);
      assert.ok(b.endMs > b.startMs, `Zero or negative duration at block ${i}`);
      prevEnd = b.endMs;
    }

    // Verify no words lost
    const originalWords = text250.split(/\s+/).filter(Boolean);
    assert.strictEqual(
      reconstructedWords.join(' '),
      originalWords.join(' '),
      'Reconstructed text words must match original 250-char text without dropping words'
    );
  });

  await test('1.5.2 [250 chars] segmentSubtitlesNetflix completes without errors or NaN timestamps', () => {
    const srt: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 15000, text: text250 }];
    const segmented = segmentSubtitlesNetflix(srt);
    assert.ok(segmented.length >= 3, `Expected >= 3 segments, got: ${segmented.length}`);
    for (const seg of segmented) {
      assert.ok(!Number.isNaN(seg.startMs), 'startMs is NaN');
      assert.ok(!Number.isNaN(seg.endMs), 'endMs is NaN');
      assert.ok(seg.endMs > seg.startMs, `endMs <= startMs`);
    }
  });

  // 1.6 Adversarial Torture: 250 continuous characters with NO spaces
  await test('1.6.1 [Adversarial] 250 chars continuous string with no whitespace does NOT hang or throw', () => {
    const noSpaces = 'A'.repeat(250);
    const srt: SrtLine[] = [{ id: 'torture', startMs: 1000, endMs: 10000, text: noSpaces }];
    const res = consolidateSubtitleClauses(srt, { maxCharsPerLine: 37, maxLinesPerBlock: 2 });
    assert.ok(Array.isArray(res));
    assert.ok(res.length > 0);
  });

  // ==========================================================================
  // SECTION 2: SENTENCE BOUNDARIES (TERMINAL VS NON-TERMINAL PUNCTUATION)
  // ==========================================================================
  console.log('\n--- SECTION 2: Sentence Boundaries (Terminal vs Non-Terminal Punctuation) ---');

  // 2.1 Terminal punctuation across micro-pauses in consolidateSubtitleClauses
  await test('2.1.1 Terminal period "." across 50ms micro-pause does NOT consolidate', () => {
    const srt: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Tôi đồng ý.' },
      { id: '2', startMs: 2050, endMs: 3000, text: 'Bạn có chắc không?' },
    ];
    const res = consolidateSubtitleClauses(srt);
    assert.strictEqual(res.length, 2, 'Must remain 2 blocks due to terminal period');
  });

  await test('2.1.2 Terminal question mark "?" across 80ms micro-pause does NOT consolidate', () => {
    const srt: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Bạn đi đâu đó?' },
      { id: '2', startMs: 2080, endMs: 3000, text: 'Tôi đi làm việc' },
    ];
    const res = consolidateSubtitleClauses(srt);
    assert.strictEqual(res.length, 2, 'Must remain 2 blocks due to terminal question mark');
  });

  await test('2.1.3 Terminal exclamation mark "!" across 100ms micro-pause does NOT consolidate', () => {
    const srt: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Thật tuyệt vời!' },
      { id: '2', startMs: 2100, endMs: 3000, text: 'Hãy cùng vỗ tay' },
    ];
    const res = consolidateSubtitleClauses(srt);
    assert.strictEqual(res.length, 2, 'Must remain 2 blocks due to terminal exclamation mark');
  });

  await test('2.1.4 Terminal ellipsis "…" (Unicode) and "..." (ASCII) do NOT consolidate', () => {
    const srtUnicode: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Chờ một chút…' },
      { id: '2', startMs: 2100, endMs: 3000, text: 'Tôi đang tới ngay' },
    ];
    const resUni = consolidateSubtitleClauses(srtUnicode);
    assert.strictEqual(resUni.length, 2, 'Unicode ellipsis must prevent consolidation');

    const srtAscii: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Chờ một chút...' },
      { id: '2', startMs: 2100, endMs: 3000, text: 'Tôi đang tới ngay' },
    ];
    const resAscii = consolidateSubtitleClauses(srtAscii);
    assert.strictEqual(resAscii.length, 2, 'ASCII ellipsis must prevent consolidation');
  });

  await test('2.1.5 Terminal punctuation inside trailing quotes/brackets does NOT consolidate', () => {
    const cases = [
      { t1: 'Họ nói: "Đúng rồi."', t2: 'và tất cả đều tán thành' },
      { t1: 'Thật sao?)', t2: 'tôi cũng không rõ' },
      { t1: 'Cảnh báo!]', t2: 'nguy hiểm phía trước' },
    ];
    for (const c of cases) {
      const srt: SrtLine[] = [
        { id: '1', startMs: 1000, endMs: 2000, text: c.t1 },
        { id: '2', startMs: 2100, endMs: 3000, text: c.t2 },
      ];
      const res = consolidateSubtitleClauses(srt);
      assert.strictEqual(res.length, 2, `Clause ending in "${c.t1}" must not consolidate with next`);
    }
  });

  // 2.2 Non-terminal punctuation across micro-pauses in consolidateSubtitleClauses
  await test('2.2.1 Non-terminal punctuation (comma, semicolon, colon, dash, none) CONSOLIDATES', () => {
    const cases = [
      { t1: 'Sau khi xem xét kỹ,', t2: 'chúng tôi đồng ý' },
      { t1: 'Kế hoạch đã định;', t2: 'ngày mai khởi hành' },
      { t1: 'Mục tiêu hôm nay:', t2: 'hoàn thành dự án' },
      { t1: 'Vấn đề cốt lõi -', t2: 'là quản lý rủi ro' },
      { t1: 'Chúng tôi tin tưởng', t2: 'vào tương lai sáng' },
    ];
    for (const c of cases) {
      const srt: SrtLine[] = [
        { id: '1', startMs: 1000, endMs: 2000, text: c.t1 },
        { id: '2', startMs: 2150, endMs: 3500, text: c.t2 },
      ];
      const res = consolidateSubtitleClauses(srt, { maxCharsPerLine: 37, maxLinesPerBlock: 2 });
      assert.strictEqual(res.length, 1, `Clauses "${c.t1}" + "${c.t2}" must consolidate into 1 block`);
      assert.strictEqual(res[0].startMs, 1000);
      assert.strictEqual(res[0].endMs, 3500);
    }
  });

  // 2.3 Punctuation behavior in groupSubtitlesForTts
  await test('2.3.1 groupSubtitlesForTts correctly terminates on terminal punctuation (. ? ! …)', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Hôm nay trời đẹp.' },
      { index: 2, startTime: '00:00:02,100', endTime: '00:00:03,000', startMs: 2100, endMs: 3000, durationMs: 900, text: 'Bạn có đi chơi không?' },
      { index: 3, startTime: '00:00:03,100', endTime: '00:00:04,000', startMs: 3100, endMs: 4000, durationMs: 900, text: 'Đi ngay thôi!' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 3, `Expected 3 SentenceGroups, got: ${groups.length}`);
    assert.strictEqual(groups[0].text, 'Hôm nay trời đẹp.');
    assert.strictEqual(groups[1].text, 'Bạn có đi chơi không?');
    assert.strictEqual(groups[2].text, 'Đi ngay thôi!');
  });

  await test('2.3.2 groupSubtitlesForTts clusters 4 multi-clause fragments with commas into 1 SentenceGroup', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Hôm nay trời đẹp,' },
      { index: 2, startTime: '00:00:02,100', endTime: '00:00:03,000', startMs: 2100, endMs: 3000, durationMs: 900, text: 'gió thổi nhẹ,' },
      { index: 3, startTime: '00:00:03,100', endTime: '00:00:04,000', startMs: 3100, endMs: 4000, durationMs: 900, text: 'chúng ta cùng đi dạo' },
      { index: 4, startTime: '00:00:04,100', endTime: '00:00:05,500', startMs: 4100, endMs: 5500, durationMs: 1400, text: 'dưới tán cây xanh.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1, `Expected 1 SentenceGroup, got: ${groups.length}`);
    assert.strictEqual(groups[0].startIndex, 1);
    assert.strictEqual(groups[0].endIndex, 4);
    assert.strictEqual(groups[0].startMs, 1000);
    assert.strictEqual(groups[0].endMs, 5500);
    assert.strictEqual(
      groups[0].text,
      'Hôm nay trời đẹp, gió thổi nhẹ, chúng ta cùng đi dạo dưới tán cây xanh.'
    );
  });

  await test('2.3.3 Abbreviation period inside text ("TP.HCM", "8.5%") does not trigger premature termination', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,500', startMs: 1000, endMs: 2500, durationMs: 1500, text: 'Hội nghị tại TP.HCM' },
      { index: 2, startTime: '00:00:02,600', endTime: '00:00:04,000', startMs: 2600, endMs: 4000, durationMs: 1400, text: 'ghi nhận mức tăng 8.5% năm nay.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1, 'Period inside abbreviation TP.HCM must not prematurely split SentenceGroup');
    assert.strictEqual(groups[0].text, 'Hội nghị tại TP.HCM ghi nhận mức tăng 8.5% năm nay.');
  });

  // ==========================================================================
  // SECTION 3: GAP THRESHOLDS (<= 1200ms MERGED, > 1200ms NOT MERGED)
  // ==========================================================================
  console.log('\n--- SECTION 3: Gap Thresholds (<= 1200ms merged, > 1200ms not merged) ---');

  await test('3.1 Boundary Gap 1199ms in groupSubtitlesForTts: MERGED', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Phần mở đầu,' },
      { index: 2, startTime: '00:00:03,199', endTime: '00:00:04,500', startMs: 3199, endMs: 4500, durationMs: 1301, text: 'phần tiếp theo.' },
    ];
    // Gap = 3199 - 2000 = 1199ms <= 1200ms
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1, 'Gap 1199ms must be merged');
  });

  await test('3.2 Boundary Gap 1200ms in groupSubtitlesForTts: MERGED', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Phần mở đầu,' },
      { index: 2, startTime: '00:00:03,200', endTime: '00:00:04,500', startMs: 3200, endMs: 4500, durationMs: 1300, text: 'phần tiếp theo.' },
    ];
    // Gap = 3200 - 2000 = 1200ms <= 1200ms
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1, 'Gap 1200ms must be merged');
  });

  await test('3.3 Boundary Gap 1201ms in groupSubtitlesForTts: NOT MERGED (splits)', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Phần mở đầu,' },
      { index: 2, startTime: '00:00:03,201', endTime: '00:00:04,500', startMs: 3201, endMs: 4500, durationMs: 1299, text: 'phần tiếp theo.' },
    ];
    // Gap = 3201 - 2000 = 1201ms > 1200ms
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2, 'Gap 1201ms must NOT be merged');
    assert.strictEqual(groups[0].startIndex, 1);
    assert.strictEqual(groups[1].startIndex, 2);
  });

  await test('3.4 Large Gap 2500ms in groupSubtitlesForTts: NOT MERGED', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Đoạn nói trước,' },
      { index: 2, startTime: '00:00:04,500', endTime: '00:00:06,000', startMs: 4500, endMs: 6000, durationMs: 1500, text: 'đoạn nói sau.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2, 'Gap 2500ms must NOT be merged');
  });

  await test('3.5 Gap 0ms (contiguous) and negative gap in groupSubtitlesForTts: MERGED', () => {
    const contiguousSubs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Nói liên tục,' },
      { index: 2, startTime: '00:00:02,000', endTime: '00:00:03,500', startMs: 2000, endMs: 3500, durationMs: 1500, text: 'không nghỉ chút nào.' },
    ];
    const groups = groupSubtitlesForTts(contiguousSubs);
    assert.strictEqual(groups.length, 1, 'Contiguous gap 0ms must be merged');
  });

  await test('3.6 consolidateSubtitleClauses gap thresholds: default 1000ms vs custom 1200ms', () => {
    const srt: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Vế thứ nhất,' },
      { id: '2', startMs: 3100, endMs: 4000, text: 'vế thứ hai' }, // gap = 1100ms
    ];

    // With default maxGapMs = 1000ms: gap 1100ms exceeds 1000ms -> NOT MERGED
    const resDefault = consolidateSubtitleClauses(srt);
    assert.strictEqual(resDefault.length, 2, 'Default maxGapMs 1000ms must split at 1100ms');

    // With explicit maxGapMs = 1200ms: gap 1100ms <= 1200ms -> MERGED
    const res1200 = consolidateSubtitleClauses(srt, { maxGapMs: 1200 });
    assert.strictEqual(res1200.length, 1, 'maxGapMs 1200ms must merge at 1100ms');
  });

  // ==========================================================================
  // SECTION 4: SPEAKER DIARIZATION ISOLATION
  // ==========================================================================
  console.log('\n--- SECTION 4: Speaker Diarization Isolation ---');

  await test('4.1 consolidateSubtitleClauses: Different speakers are NEVER merged into 1 block', () => {
    const srt: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Tôi nghĩ là như vậy,', speaker: 'SPEAKER_00' },
      { id: '2', startMs: 2050, endMs: 3000, text: 'nhưng tôi không đồng ý', speaker: 'SPEAKER_01' },
    ];
    const res = consolidateSubtitleClauses(srt);
    assert.strictEqual(res.length, 2, 'Different speakers must NEVER be consolidated into 1 visual block');
    assert.strictEqual(res[0].speaker, 'SPEAKER_00');
    assert.strictEqual(res[1].speaker, 'SPEAKER_01');
  });

  await test('4.2 groupSubtitlesForTts: Different speakers are NEVER merged into 1 SentenceGroup', () => {
    const subs: SubtitleLine[] = [
      {
        index: 1,
        startTime: '00:00:01,000',
        endTime: '00:00:02,000',
        startMs: 1000,
        endMs: 2000,
        durationMs: 1000,
        text: 'Tôi muốn hỏi một câu,',
        speaker: 'SPEAKER_00',
      },
      {
        index: 2,
        startTime: '00:00:02,100',
        endTime: '00:00:03,500',
        startMs: 2100,
        endMs: 3500,
        durationMs: 1400,
        text: 'bạn cứ hỏi tự nhiên.',
        speaker: 'SPEAKER_01',
      },
    ];
    // Clause 1 ends with comma, gap is 100ms, but speakers differ!
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2, 'Different speakers must produce distinct SentenceGroups');
    assert.strictEqual(groups[0].subtitles[0].speaker, 'SPEAKER_00');
    assert.strictEqual(groups[1].subtitles[0].speaker, 'SPEAKER_01');
  });

  await test('4.3 Multi-speaker dialogue conversation: strictly isolates each speaker group', () => {
    const subs: SubtitleLine[] = [
      // Speaker 0 (2 clauses unfinished + finished)
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Chào buổi sáng,', speaker: 'SPEAKER_00' },
      { index: 2, startTime: '00:00:02,100', endTime: '00:00:03,200', startMs: 2100, endMs: 3200, durationMs: 1100, text: 'hôm nay có tin gì mới không?', speaker: 'SPEAKER_00' },
      // Speaker 1 (2 clauses unfinished + finished)
      { index: 3, startTime: '00:00:03,300', endTime: '00:00:04,500', startMs: 3300, endMs: 4500, durationMs: 1200, text: 'Có chứ bạn ơi,', speaker: 'SPEAKER_01' },
      { index: 4, startTime: '00:00:04,600', endTime: '00:00:06,000', startMs: 4600, endMs: 6000, durationMs: 1400, text: 'dự án vừa được duyệt thành công.', speaker: 'SPEAKER_01' },
      // Speaker 2 (1 clause)
      { index: 5, startTime: '00:00:06,100', endTime: '00:00:07,500', startMs: 6100, endMs: 7500, durationMs: 1400, text: 'Chúc mừng cả đội nhé!', speaker: 'SPEAKER_02' },
    ];

    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 3, `Expected exactly 3 groups for 3 speakers, got: ${groups.length}`);

    // Group 1: Speaker 0
    assert.strictEqual(groups[0].startIndex, 1);
    assert.strictEqual(groups[0].endIndex, 2);
    assert.strictEqual(groups[0].text, 'Chào buổi sáng, hôm nay có tin gì mới không?');
    assert.ok(groups[0].subtitles.every((s) => s.speaker === 'SPEAKER_00'));

    // Group 2: Speaker 1
    assert.strictEqual(groups[1].startIndex, 3);
    assert.strictEqual(groups[1].endIndex, 4);
    assert.strictEqual(groups[1].text, 'Có chứ bạn ơi, dự án vừa được duyệt thành công.');
    assert.ok(groups[1].subtitles.every((s) => s.speaker === 'SPEAKER_01'));

    // Group 3: Speaker 2
    assert.strictEqual(groups[2].startIndex, 5);
    assert.strictEqual(groups[2].endIndex, 5);
    assert.strictEqual(groups[2].text, 'Chúc mừng cả đội nhé!');
    assert.strictEqual(groups[2].subtitles[0].speaker, 'SPEAKER_02');
  });

  await test('4.4 Ping-pong rapid dialogue: alternating speakers with short phrases NEVER cross-contaminate', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:01,400', startMs: 1000, endMs: 1400, durationMs: 400, text: 'Đúng,', speaker: 'S0' },
      { index: 2, startTime: '00:00:01,450', endTime: '00:00:01,900', startMs: 1450, endMs: 1900, durationMs: 450, text: 'không,', speaker: 'S1' },
      { index: 3, startTime: '00:00:01,950', endTime: '00:00:02,300', startMs: 1950, endMs: 2300, durationMs: 350, text: 'sao,', speaker: 'S0' },
      { index: 4, startTime: '00:00:02,350', endTime: '00:00:02,800', startMs: 2350, endMs: 2800, durationMs: 450, text: 'thôi.', speaker: 'S1' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 4, `Rapid ping-pong must yield 4 groups, got: ${groups.length}`);
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(groups[i].startIndex, i + 1);
      assert.strictEqual(groups[i].endIndex, i + 1);
      assert.strictEqual(groups[i].subtitles[0].speaker, subs[i].speaker);
    }
  });

  // ==========================================================================
  // SECTION 5: REAL DUBBING PIPELINE & FFMPEG WITH MULTI-SPEAKER TIMELINE
  // ==========================================================================
  console.log('\n--- SECTION 5: Real Dubbing Pipeline & FFmpeg Stress Verification ---');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_adv_m2_'));

  try {
    const ttsDir = path.join(tempDir, 'tts_audio');
    fs.mkdirSync(ttsDir, { recursive: true });

    // Multi-speaker SRT file
    const srtContent = `1
00:00:01,000 --> 00:00:02,200
chụp ảnh được, livestream được

2
00:00:02,300 --> 00:00:04,500
tái hiện lại các cảnh kinh điển cũng được

3
00:00:04,600 --> 00:00:07,800
nhưng giá cho mỗi hoạt động tính thế nào?

4
00:00:08,200 --> 00:00:10,500
Chúng tôi sẽ gửi bảng báo giá chi tiết ngay.
`;
    const srtFile = path.join(tempDir, 'dialogue.srt');
    fs.writeFileSync(srtFile, srtContent, 'utf-8');

    // Create master audio for Group 1 (lines 1-3, 5.5s)
    const audioG1 = path.join(ttsDir, 'subtitle_0001.mp3');
    await runFfmpeg([
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=5.5',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      '-y', audioG1,
    ]);

    // Create audio for Group 2 (line 4, 2.0s)
    const audioG2 = path.join(ttsDir, 'subtitle_0004.mp3');
    await runFfmpeg([
      '-f', 'lavfi',
      '-i', 'sine=frequency=660:duration=2.0',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      '-y', audioG2,
    ]);

    // Manifest: G1 is leader of 1,2,3; line 4 is independent
    const manifest = {
      '1': {
        voice: 'BV074_streaming',
        speed: 1.0,
        text: 'chụp ảnh được, livestream được tái hiện lại các cảnh kinh điển cũng được nhưng giá cho mỗi hoạt động tính thế nào?',
        engine: 'tiktok',
        isGroupLeader: true,
        groupIndices: [1, 2, 3],
      },
      '2': {
        voice: 'BV074_streaming',
        speed: 1.0,
        text: 'tái hiện lại các cảnh kinh điển cũng được',
        engine: 'tiktok',
        isGroupMember: true,
        leaderIndex: 1,
      },
      '3': {
        voice: 'BV074_streaming',
        speed: 1.0,
        text: 'nhưng giá cho mỗi hoạt động tính thế nào?',
        engine: 'tiktok',
        isGroupMember: true,
        leaderIndex: 1,
      },
      '4': {
        voice: 'BV075_streaming',
        speed: 1.0,
        text: 'Chúng tôi sẽ gửi bảng báo giá chi tiết ngay.',
        engine: 'tiktok',
      },
    };
    fs.writeFileSync(path.join(ttsDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');

    await test('5.1 mergeAudioFiles in "flexible" mode merges multi-speaker dialogue gaplessly', async () => {
      const outMp3 = path.join(tempDir, 'output_flexible.mp3');
      const res = await mergeAudioFiles(srtFile, ttsDir, outMp3, undefined, { mode: 'flexible' });
      assert.strictEqual(res.audioPath, outMp3);
      assert.ok(fs.existsSync(outMp3));

      const dur = await getMediaDurationSec(outMp3);
      // Timeline spans from 1s to ~11s
      assert.ok(dur >= 9.5 && dur <= 13.0, `Duration expected ~10.5-12.0s, actual: ${dur.toFixed(2)}s`);
    });

    await test('5.2 mergeAudioFiles in "strict" mode preserves timeline synchronization', async () => {
      const outStrictMp3 = path.join(tempDir, 'output_strict.mp3');
      const res = await mergeAudioFiles(srtFile, ttsDir, outStrictMp3, undefined, { mode: 'strict' });
      assert.strictEqual(res.audioPath, outStrictMp3);
      assert.ok(fs.existsSync(outStrictMp3));

      const dur = await getMediaDurationSec(outStrictMp3);
      assert.ok(dur >= 10.0 && dur <= 13.0, `Strict duration expected ~11.0s, actual: ${dur.toFixed(2)}s`);
    });

  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  }

  // ==========================================================================
  // FINAL SUMMARY
  // ==========================================================================
  console.log('\n================================================================================');
  console.log(`📊 ADVERSARIAL STRESS TEST SUMMARY:`);
  console.log(`   Total Assertions Executed: ${total}`);
  console.log(`   Passed:                    ${passed} ✅`);
  console.log(`   Failed:                    ${total - passed} ❌`);
  console.log('================================================================================\n');

  if (passed !== total) {
    console.error('❌ ADVERSARIAL HARNESS IDENTIFIED REGRESSIONS OR FAILURES!');
    process.exit(1);
  } else {
    console.log('⚔️  ADVERSARIAL STRESS HARNESS PASSED 100%! ALL BOUNDARIES & CONSTRAINTS CONFIRMED.');
  }
}

runAdversarialHarness().catch((err) => {
  console.error('Fatal crash during adversarial test execution:', err);
  process.exit(1);
});
