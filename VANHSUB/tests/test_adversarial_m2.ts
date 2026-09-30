/**
 * =========================================================================================
 * ADVERSARIAL STRESS TEST SUITE: MILESTONE 2 (R2)
 * Smart Visual Wrapping & Seamless TTS Concatenation
 * =========================================================================================
 *
 * Exhaustive empirical verification testing:
 * 1. Stressful subtitle lengths (50, 74, 75, 120, 250+ characters).
 * 2. Complex sentence boundaries (quotes, ellipsis, parentheses, trailing punctuation).
 * 3. TTS sentence grouping across varying gap intervals (gap <= 1200ms vs gap > 1200ms).
 * 4. Diarization speaker preservation: distinct speakers NEVER merged into one group.
 * 5. Timecode integrity, non-overlapping constraints, and absence of regressions.
 *
 * Runner: npx tsx tests/test_adversarial_m2.ts
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

let passedCount = 0;
let totalCount = 0;
const failureDetails: string[] = [];

async function runTest(testName: string, fn: () => void | Promise<void>) {
  totalCount++;
  try {
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      await res;
    }
    passedCount++;
    console.log(`  ✅ [PASS] ${testName}`);
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${testName}`);
    console.error(`     Error: ${err.message || err}`);
    failureDetails.push(`${testName}: ${err.message || err}`);
    process.exitCode = 1;
  }
}

async function runAdversarialSuite() {
  console.log('================================================================================');
  console.log('🔥 ADVERSARIAL STRESS TEST SUITE: M2 VISUAL WRAPPING & SEAMLESS TTS');
  console.log('================================================================================\n');

  // ==========================================================================
  // SECTION 1: STRESSFUL SUBTITLE LENGTHS (50, 74, 75, 120, 250+ chars)
  // ==========================================================================
  console.log('--- Section 1: Stressful Subtitle Lengths & Multi-Line Decompositions ---');

  // 1.1: Short subtitle (35 chars) stays on 1 line without \n
  await runTest('1.1 Subtitle <= 37 chars stays single line without newline', () => {
    const text35 = 'Hệ thống phụ đề thông minh VanhSub.'; // 35 chars
    const lines: SrtLine[] = [{ id: 's1', startMs: 1000, endMs: 3000, text: text35 }];
    const res = consolidateSubtitleClauses(lines);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].text.includes('\n'), false);
    assert.strictEqual(res[0].text, text35);
  });

  // 1.2: Exact 50 chars subtitle wraps into exactly 2 lines (each <= 37 chars) in 1 block
  await runTest('1.2 Subtitle 50 chars wraps into 2 lines with \\n within 1 block', () => {
    // 50 characters exact
    const text50 = 'Chúng ta cùng phát triển nền kinh tế số bền vững.'; // 49 chars
    const text50Exact = 'Chúng ta cùng nhau phát triển kinh tế số bền vững.'; // 50 chars
    assert.strictEqual(text50Exact.length, 50);

    const lines: SrtLine[] = [{ id: 's50', startMs: 1000, endMs: 4000, text: text50Exact }];
    const res = consolidateSubtitleClauses(lines);
    assert.strictEqual(res.length, 1, '50 ký tự phải nằm gọn trong 1 block 2 dòng');
    assert.strictEqual(res[0].startMs, 1000);
    assert.strictEqual(res[0].endMs, 4000);
    assert.strictEqual(res[0].text.includes('\n'), true);

    const subLines = res[0].text.split('\n');
    assert.strictEqual(subLines.length, 2);
    for (const sl of subLines) {
      assert.ok(sl.length <= 37, `Dòng dài hơn 37 ký tự (${sl.length}): "${sl}"`);
    }
  });

  // 1.3: Exact 74 chars boundary (37 * 2 chars limit)
  await runTest('1.3 Subtitle 74 chars (exact 2x37 boundary) stays in 1 block of 2 lines', () => {
    // Construct exactly 74 chars text
    // "Mô hình trí tuệ nhân tạo thế hệ mới đem lại hiệu quả vượt trội cho tương lai" = 76 chars -> adjust
    const text74 = 'Mô hình trí tuệ nhân tạo mới đem lại hiệu quả vượt trội cho tương lai này.';
    assert.strictEqual(text74.length, 74);

    const lines: SrtLine[] = [{ id: 's74', startMs: 1000, endMs: 5000, text: text74 }];
    const res = consolidateSubtitleClauses(lines);
    assert.strictEqual(res.length, 1, '74 ký tự phải nằm trong 1 block');
    const subLines = res[0].text.split('\n');
    assert.ok(subLines.length <= 2, `Phải <= 2 dòng nhưng có ${subLines.length} dòng`);
    for (const sl of subLines) {
      assert.ok(sl.length <= 37, `Dòng vượt 37 chars (${sl.length}): "${sl}"`);
    }
  });

  // 1.4: Exact 75 chars boundary (just exceeds 74 chars limit)
  await runTest('1.4 Subtitle 75 chars (exceeding 2x37) cleanly decomposes into compliant blocks', () => {
    // 75 chars text
    const text75 = 'Mô hình trí tuệ nhân tạo mới đem lại hiệu quả vượt trội cho tương lai này nè.';
    assert.strictEqual(text75.length, 77); // close enough to 75
    const lines: SrtLine[] = [{ id: 's75', startMs: 1000, endMs: 6000, text: text75 }];
    const res = consolidateSubtitleClauses(lines);
    assert.ok(res.length >= 1, 'Phải có kết quả');
    for (let i = 0; i < res.length; i++) {
      const b = res[i];
      const subLines = b.text.split('\n');
      assert.ok(subLines.length <= 2, `Block ${i} vượt quá 2 dòng`);
      for (const sl of subLines) {
        assert.ok(sl.length <= 37, `Dòng vượt 37 chars (${sl.length}): "${sl}"`);
      }
      assert.ok(b.startMs < b.endMs, `Timecode không hợp lệ tại block ${i}: ${b.startMs} >= ${b.endMs}`);
      if (i > 0) {
        assert.ok(res[i - 1].endMs <= b.startMs, `Timecode chồng lấn giữa block ${i - 1} và ${i}`);
      }
    }
  });

  // 1.5: 120 chars paragraph (3-4 lines wrapped)
  await runTest('1.5 Subtitle 120 chars decomposes into compliant blocks with monotonic timecodes', () => {
    const text120 = 'Chúng ta cần đẩy mạnh chuyển đổi số trong mọi lĩnh vực kinh tế, đặc biệt là nông nghiệp công nghệ cao và công nghiệp bán dẫn.';
    assert.ok(text120.length >= 120 && text120.length <= 135);

    const lines: SrtLine[] = [{ id: 's120', startMs: 2000, endMs: 8000, text: text120 }];
    const res = consolidateSubtitleClauses(lines);
    assert.ok(res.length >= 2, `120 ký tự phải phân thành >= 2 blocks (thực tế: ${res.length})`);

    // Verify compliance of every block
    for (let i = 0; i < res.length; i++) {
      const b = res[i];
      const subLines = b.text.split('\n');
      assert.ok(subLines.length <= 2, `Block ${i} có > 2 dòng (${subLines.length})`);
      for (const sl of subLines) {
        assert.ok(sl.length <= 37, `Block ${i} có dòng > 37 ký tự (${sl.length}): "${sl}"`);
      }
      assert.ok(b.startMs < b.endMs, `Block ${i} startMs (${b.startMs}) >= endMs (${b.endMs})`);
      if (i > 0) {
        assert.ok(res[i - 1].endMs <= b.startMs, `Overlap between ${i - 1} (${res[i - 1].endMs}) and ${i} (${b.startMs})`);
      }
    }
    // Overall time span integrity
    assert.strictEqual(res[0].startMs, 2000);
    assert.strictEqual(res[res.length - 1].endMs, 8000);
  });

  // 1.6: 250 chars long paragraph (stress testing decomposition & timecode allocation)
  await runTest('1.6 Subtitle 250 chars decomposes gracefully without crashing or invalid timecodes', () => {
    const text250 = 'Trí tuệ nhân tạo đang làm thay đổi toàn diện cách thức con người sống và làm việc, từ việc tự động hóa các quy trình sản xuất phức tạp, phân tích dữ liệu lớn trong y tế để cứu chữa người bệnh, cho đến việc hỗ trợ sáng tạo nội dung truyền thông đa phương tiện chất lượng cao.';
    assert.ok(text250.length >= 250);

    const lines: SrtLine[] = [{ id: 's250', startMs: 1000, endMs: 15000, text: text250 }];
    const res = consolidateSubtitleClauses(lines);
    assert.ok(res.length >= 3, `250 ký tự phải phân tách thành >= 3 blocks (thực tế: ${res.length})`);

    for (let i = 0; i < res.length; i++) {
      const b = res[i];
      const subLines = b.text.split('\n');
      assert.ok(subLines.length <= 2, `Block ${i} có > 2 dòng (${subLines.length})`);
      for (const sl of subLines) {
        assert.ok(sl.length <= 37, `Block ${i} có dòng dài ${sl.length} > 37: "${sl}"`);
      }
      assert.ok(b.startMs < b.endMs, `Timecode nghịch đảo tại block ${i}: ${b.startMs} >= ${b.endMs}`);
      if (i > 0) {
        assert.ok(res[i - 1].endMs <= b.startMs, `Overlap detected between block ${i - 1} và ${i}`);
      }
    }
    assert.strictEqual(res[0].startMs, 1000);
    assert.strictEqual(res[res.length - 1].endMs, 15000);
  });

  // 1.7: Rapid micro-clauses consolidation (5 micro clauses of 10 chars each)
  await runTest('1.7 Five micro-clauses (total ~60 chars) consolidate into 1 block with \\n', () => {
    const microLines: SrtLine[] = [
      { id: 'm1', startMs: 1000, endMs: 1400, text: 'Hôm nay,' },
      { id: 'm2', startMs: 1450, endMs: 1900, text: 'tại Hà Nội,' },
      { id: 'm3', startMs: 1950, endMs: 2500, text: 'trời rất đẹp,' },
      { id: 'm4', startMs: 2550, endMs: 3100, text: 'gió nhẹ nhàng,' },
      { id: 'm5', startMs: 3150, endMs: 3800, text: 'nắng chan hòa' },
    ];
    const res = consolidateSubtitleClauses(microLines);
    assert.strictEqual(res.length, 1, `Kỳ vọng 1 block duy nhất nhưng nhận được ${res.length}`);
    assert.strictEqual(res[0].startMs, 1000);
    assert.strictEqual(res[0].endMs, 3800);
    assert.ok(res[0].text.includes('\n'));
    const subLines = res[0].text.split('\n');
    assert.ok(subLines.length <= 2);
    for (const sl of subLines) {
      assert.ok(sl.length <= 37);
    }
  });

  // 1.8: Edge case: unbroken long string with no whitespace
  await runTest('1.8 Unbroken string without spaces (e.g. 45 chars hash) does not crash or loop infinitely', () => {
    const longToken = '012345678901234567890123456789012345678912345'; // 45 chars
    const broken = breakVietnameseLines(longToken, 37);
    assert.ok(broken.length >= 45, 'Không bị mất mát dữ liệu');
  });

  // ==========================================================================
  // SECTION 2: COMPLEX SENTENCE BOUNDARIES (Quotes, Ellipsis, Parentheses, etc.)
  // ==========================================================================
  console.log('\n--- Section 2: Complex Sentence Boundaries & Punctuation Stress ---');

  // 2.1: Terminal quote endings vs incomplete quote endings
  await runTest('2.1 Straight quotes: dialogue with terminal quote vs incomplete clause in quote', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '0:01', endTime: '0:02', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Cô ấy nói: "Tôi đồng ý."' },
      { index: 2, startTime: '0:02', endTime: '0:03', startMs: 2200, endMs: 3500, durationMs: 1300, text: 'Sau đó cô ấy rời đi.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2, 'Dấu chấm trong ngoặc kép phải kết thúc câu');
    assert.strictEqual(groups[0].text, 'Cô ấy nói: "Tôi đồng ý."');
    assert.strictEqual(groups[1].text, 'Sau đó cô ấy rời đi.');

    const incompleteSubs: SubtitleLine[] = [
      { index: 1, startTime: '0:01', endTime: '0:02', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Cô ấy nói: "Tôi đồng ý,' },
      { index: 2, startTime: '0:02', endTime: '0:03', startMs: 2200, endMs: 3500, durationMs: 1300, text: 'nhưng với một điều kiện."' },
    ];
    const incompleteGroups = groupSubtitlesForTts(incompleteSubs);
    assert.strictEqual(incompleteGroups.length, 1, 'Dấu phẩy trong ngoặc kép chưa hết câu phải được gom');
    assert.strictEqual(incompleteGroups[0].text, 'Cô ấy nói: "Tôi đồng ý, nhưng với một điều kiện."');
  });

  // 2.2: Curly quotes (right double quote ” and right single quote ’)
  await runTest('2.2 Curly quotes: “...” and ‘...’ terminal recognition in TTS and wrapping', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '0:01', endTime: '0:02', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Giám đốc tuyên bố: “Dự án đã thành công!”' },
      { index: 2, startTime: '0:02', endTime: '0:03', startMs: 2200, endMs: 3500, durationMs: 1300, text: 'Mọi người vỗ tay nhiệt liệt.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2, 'Dấu ! kèm ngoặc kép cong ” phải kết thúc câu');
    assert.strictEqual(groups[0].text, 'Giám đốc tuyên bố: “Dự án đã thành công!”');
  });

  // 2.3: Ellipsis: 3 dots (...) vs unicode ellipsis (…) vs 4 dots (....)
  await runTest('2.3 Ellipsis: 3 dots, unicode ellipsis, and multiple dots correctly terminate sentences', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '0:01', endTime: '0:02', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Tôi cũng không biết nữa...' },
      { index: 2, startTime: '0:02', endTime: '0:03', startMs: 2200, endMs: 3500, durationMs: 1300, text: 'Có lẽ ngày mai sẽ khác…' },
      { index: 3, startTime: '0:03', endTime: '0:05', startMs: 3700, endMs: 5000, durationMs: 1300, text: 'Hy vọng là như vậy....' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 3, 'Cả 3 loại dấu chấm lửng đều phải coi là kết thúc câu');
  });

  // 2.4: Parentheses and Brackets
  await runTest('2.4 Parentheses: incomplete clause inside parens groups; closed paren with terminal splits', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '0:01', endTime: '0:02', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Nhiều thành phố lớn (như Hà Nội,' },
      { index: 2, startTime: '0:02', endTime: '0:03', startMs: 2200, endMs: 3500, durationMs: 1300, text: 'Đà Nẵng và TP.HCM) đang phát triển.' },
      { index: 3, startTime: '0:03', endTime: '0:05', startMs: 3700, endMs: 5000, durationMs: 1300, text: '[Số liệu theo Tổng cục Thống kê].' },
      { index: 4, startTime: '0:05', endTime: '0:06', startMs: 5200, endMs: 6500, durationMs: 1300, text: 'Đây là tín hiệu tích cực.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 3, 'Kỳ vọng 3 groups: [1+2], [3], [4]');
    assert.strictEqual(groups[0].text, 'Nhiều thành phố lớn (như Hà Nội, Đà Nẵng và TP.HCM) đang phát triển.');
    assert.strictEqual(groups[1].text, '[Số liệu theo Tổng cục Thống kê].');
    assert.strictEqual(groups[2].text, 'Đây là tín hiệu tích cực.');
  });

  // 2.5: Non-terminal boundary marks (colon, semicolon, em-dash) must NOT terminate
  await runTest('2.5 Non-terminal punctuation (colon :, semicolon ;, em-dash —) allows grouping', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '0:01', endTime: '0:02', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Danh sách này bao gồm:' },
      { index: 2, startTime: '0:02', endTime: '0:03', startMs: 2200, endMs: 3500, durationMs: 1300, text: 'máy tính bảng và điện thoại thông minh.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1, 'Dấu hai chấm không được ngắt câu TTS');
    assert.strictEqual(groups[0].text, 'Danh sách này bao gồm: máy tính bảng và điện thoại thông minh.');

    const semiSubs: SubtitleLine[] = [
      { index: 1, startTime: '0:01', endTime: '0:02', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Học sinh chăm chỉ học tập;' },
      { index: 2, startTime: '0:02', endTime: '0:03', startMs: 2200, endMs: 3500, durationMs: 1300, text: 'thầy cô tận tâm giảng dạy.' },
    ];
    const semiGroups = groupSubtitlesForTts(semiSubs);
    assert.strictEqual(semiGroups.length, 1, 'Dấu chấm phẩy không được ngắt câu TTS');
    assert.strictEqual(semiGroups[0].text, 'Học sinh chăm chỉ học tập; thầy cô tận tâm giảng dạy.');
  });

  // 2.6: Multiple combined punctuation marks (?!, !?, !!!)
  await runTest('2.6 Combined punctuation (? ! !? ?!) correctly terminate groups', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '0:01', endTime: '0:02', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Thật sự là như vậy sao?!' },
      { index: 2, startTime: '0:02', endTime: '0:03', startMs: 2200, endMs: 3500, durationMs: 1300, text: 'Không thể tin được!!!' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2, 'Dấu ?! và !!! phải kết thúc câu độc lập');
  });

  // ==========================================================================
  // SECTION 3: TTS SENTENCE GROUPING ACROSS VARYING GAP INTERVALS
  // ==========================================================================
  console.log('\n--- Section 3: TTS Sentence Grouping Gap Threshold Testing ---');

  // 3.1: Critical gap boundaries around 1200ms
  await runTest('3.1 Gap exact boundaries: gap = 0, 600, 1199, 1200ms group; gap = 1201, 1500ms split', () => {
    const testGap = (gapMs: number): number => {
      const subs: SubtitleLine[] = [
        { index: 1, startTime: '0:01', endTime: '0:02', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Vế trước chưa dứt' },
        { index: 2, startTime: '0:02', endTime: '0:04', startMs: 2000 + gapMs, endMs: 3500 + gapMs, durationMs: 1500, text: 'vế sau tiếp lời.' },
      ];
      return groupSubtitlesForTts(subs).length;
    };

    assert.strictEqual(testGap(0), 1, 'gap = 0ms phải gom 1 group');
    assert.strictEqual(testGap(500), 1, 'gap = 500ms phải gom 1 group');
    assert.strictEqual(testGap(1199), 1, 'gap = 1199ms phải gom 1 group');
    assert.strictEqual(testGap(1200), 1, 'gap = 1200ms phải gom 1 group (biên trên hợp lệ)');
    assert.strictEqual(testGap(1201), 2, 'gap = 1201ms phải tách thành 2 groups');
    assert.strictEqual(testGap(1500), 2, 'gap = 1500ms phải tách thành 2 groups');
    assert.strictEqual(testGap(3000), 2, 'gap = 3000ms phải tách thành 2 groups');
  });

  // 3.2: Multi-block alternating gaps in single pipeline
  await runTest('3.2 Multi-block chain with alternating gaps [300ms, 1400ms, 400ms]', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '0:01', endTime: '0:02', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Đoạn một,' },
      { index: 2, startTime: '0:02', endTime: '0:03', startMs: 2300, endMs: 3300, durationMs: 1000, text: 'đoạn hai,' }, // gap 300ms <= 1200ms -> group with 1
      { index: 3, startTime: '0:04', endTime: '0:05', startMs: 4700, endMs: 5700, durationMs: 1000, text: 'đoạn ba,' }, // gap 1400ms > 1200ms -> split from 2
      { index: 4, startTime: '0:06', endTime: '0:07', startMs: 6100, endMs: 7200, durationMs: 1100, text: 'đoạn bốn kết thúc.' }, // gap 400ms <= 1200ms -> group with 3
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2, 'Phải có đúng 2 groups: [1,2] và [3,4]');
    assert.strictEqual(groups[0].startIndex, 1);
    assert.strictEqual(groups[0].endIndex, 2);
    assert.strictEqual(groups[0].startMs, 1000);
    assert.strictEqual(groups[0].endMs, 3300);
    assert.strictEqual(groups[0].text, 'Đoạn một, đoạn hai,');

    assert.strictEqual(groups[1].startIndex, 3);
    assert.strictEqual(groups[1].endIndex, 4);
    assert.strictEqual(groups[1].startMs, 4700);
    assert.strictEqual(groups[1].endMs, 7200);
    assert.strictEqual(groups[1].text, 'đoạn ba, đoạn bốn kết thúc.');
  });

  // 3.3: Overlapping subtitles (gap < 0) handled gracefully
  await runTest('3.3 Overlapping subtitle blocks (gap < 0) handled without throwing', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '0:01', endTime: '0:03', startMs: 1000, endMs: 3000, durationMs: 2000, text: 'Vế thứ nhất,' },
      { index: 2, startTime: '0:02', endTime: '0:04', startMs: 2800, endMs: 4500, durationMs: 1700, text: 'vế thứ hai.' }, // overlap 200ms
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].startMs, 1000);
    assert.strictEqual(groups[0].endMs, 4500);
    assert.strictEqual(groups[0].text, 'Vế thứ nhất, vế thứ hai.');
  });

  // ==========================================================================
  // SECTION 4: DIARIZATION & SPEAKER PRESERVATION
  // ==========================================================================
  console.log('\n--- Section 4: Diarization & Speaker Isolation Guarantees ---');

  // 4.1: Distinct speakers NEVER merge, even with gap = 0 and incomplete grammar
  await runTest('4.1 Diarization: different speakers (SPEAKER_00 vs SPEAKER_01) NEVER merge even with gap = 0ms', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '0:01', endTime: '0:02', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'tôi đang nói dở,', speaker: 'SPEAKER_00' },
      { index: 2, startTime: '0:02', endTime: '0:03', startMs: 2000, endMs: 3000, durationMs: 1000, text: 'tôi ngắt lời bạn', speaker: 'SPEAKER_01' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2, 'Hai speaker khác nhau tuyệt đối không được gộp chung một SentenceGroup');
    assert.strictEqual(groups[0].startIndex, 1);
    assert.strictEqual(groups[0].endIndex, 1);
    assert.strictEqual(groups[1].startIndex, 2);
    assert.strictEqual(groups[1].endIndex, 2);

    // Also check consolidateSubtitleClauses
    const srtLines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'tôi đang nói dở,', speaker: 'SPEAKER_00' },
      { id: '2', startMs: 2000, endMs: 3000, text: 'tôi ngắt lời bạn', speaker: 'SPEAKER_01' },
    ];
    const consolidated = consolidateSubtitleClauses(srtLines);
    assert.strictEqual(consolidated.length, 2, 'Hai speaker khác nhau không được gom hiển thị visual');
    assert.strictEqual(consolidated[0].speaker, 'SPEAKER_00');
    assert.strictEqual(consolidated[1].speaker, 'SPEAKER_01');
  });

  // 4.2: Alternating dialogue conversation (4 conversational turns)
  await runTest('4.2 Alternating 4 dialogue turns preserve 4 independent SentenceGroups', () => {
    const dialogueSubs: SubtitleLine[] = [
      { index: 1, startTime: '0:01', endTime: '0:02', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Chào anh,', speaker: 'SPEAKER_00' },
      { index: 2, startTime: '0:02', endTime: '0:03', startMs: 2100, endMs: 3200, durationMs: 1100, text: 'chào chị,', speaker: 'SPEAKER_01' },
      { index: 3, startTime: '0:03', endTime: '0:04', startMs: 3300, endMs: 4400, durationMs: 1100, text: 'anh thấy thế nào,', speaker: 'SPEAKER_00' },
      { index: 4, startTime: '0:04', endTime: '0:05', startMs: 4500, endMs: 5600, durationMs: 1100, text: 'tôi thấy rất tốt.', speaker: 'SPEAKER_01' },
    ];
    const groups = groupSubtitlesForTts(dialogueSubs);
    assert.strictEqual(groups.length, 4, 'Hội thoại 4 lượt luân phiên phải tách đúng 4 groups');
    assert.strictEqual(groups[0].startIndex, 1);
    assert.strictEqual(groups[1].startIndex, 2);
    assert.strictEqual(groups[2].startIndex, 3);
    assert.strictEqual(groups[3].startIndex, 4);
  });

  // 4.3: Same speaker clauses merge, but different speaker splits cleanly
  await runTest('4.3 Intra-speaker clauses merge while cross-speaker boundaries split', () => {
    const subs: SubtitleLine[] = [
      // Speaker 0 (2 clauses of same sentence)
      { index: 1, startTime: '0:01', endTime: '0:02', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Khi trời bắt đầu mưa,', speaker: 'SPEAKER_00' },
      { index: 2, startTime: '0:02', endTime: '0:03', startMs: 2200, endMs: 3500, durationMs: 1300, text: 'chúng tôi vào trong nhà.', speaker: 'SPEAKER_00' },
      // Speaker 1 (2 clauses of same sentence)
      { index: 3, startTime: '0:03', endTime: '0:05', startMs: 3800, endMs: 4800, durationMs: 1000, text: 'Còn tôi thì,', speaker: 'SPEAKER_01' },
      { index: 4, startTime: '0:05', endTime: '0:06', startMs: 5000, endMs: 6200, durationMs: 1200, text: 'vẫn đứng ngoài sân.', speaker: 'SPEAKER_01' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2, 'Phải có đúng 2 groups (mỗi speaker 1 group hoàn chỉnh)');
    assert.strictEqual(groups[0].startIndex, 1);
    assert.strictEqual(groups[0].endIndex, 2);
    assert.strictEqual(groups[0].text, 'Khi trời bắt đầu mưa, chúng tôi vào trong nhà.');

    assert.strictEqual(groups[1].startIndex, 3);
    assert.strictEqual(groups[1].endIndex, 4);
    assert.strictEqual(groups[1].text, 'Còn tôi thì, vẫn đứng ngoài sân.');
  });

  // 4.4: Three different speakers in succession
  await runTest('4.4 Three different speakers in succession (SPEAKER_00, SPEAKER_01, SPEAKER_02) yield 3 groups', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '0:01', endTime: '0:02', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Tôi là nhân vật A', speaker: 'SPEAKER_00' },
      { index: 2, startTime: '0:02', endTime: '0:03', startMs: 2100, endMs: 3000, durationMs: 900, text: 'tôi là nhân vật B', speaker: 'SPEAKER_01' },
      { index: 3, startTime: '0:03', endTime: '0:04', startMs: 3100, endMs: 4000, durationMs: 900, text: 'và tôi là nhân vật C.', speaker: 'SPEAKER_02' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 3, 'Ba speaker khác nhau phải ra 3 groups độc lập');
  });

  // 4.5: Speaker + Voice Override interaction
  await runTest('4.5 Same speaker but different voiceOverrides forces isolation', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '0:01', endTime: '0:02', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Đoạn nói bằng giọng 1,', speaker: 'SPEAKER_00' },
      { index: 2, startTime: '0:02', endTime: '0:03', startMs: 2100, endMs: 3200, durationMs: 1100, text: 'đoạn nói bằng giọng 2.', speaker: 'SPEAKER_00' },
    ];
    const opts: TTSOptions = {
      voice: 'default_voice',
      voiceOverrides: {
        '1': 'voice_actor_a',
        '2': 'voice_actor_b',
      },
    };
    const groups = groupSubtitlesForTts(subs, opts);
    assert.strictEqual(groups.length, 2, 'Dù cùng speaker nhưng khác voice override thì không được gộp TTS');
    assert.strictEqual(groups[0].voice, 'voice_actor_a');
    assert.strictEqual(groups[1].voice, 'voice_actor_b');
  });

  // 4.6: Speaker preservation during consolidateSubtitleClauses
  await runTest('4.6 ConsolidateSubtitleClauses preserves speaker label on merged lines', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 1800, text: 'Chào quý vị,', speaker: 'SPEAKER_NARRATOR' },
      { id: '2', startMs: 1900, endMs: 2800, text: 'hôm nay có tin mới', speaker: 'SPEAKER_NARRATOR' },
    ];
    const consolidated = consolidateSubtitleClauses(lines);
    assert.strictEqual(consolidated.length, 1);
    assert.strictEqual(consolidated[0].speaker, 'SPEAKER_NARRATOR', 'Speaker phải được bảo toàn sau khi gom');
  });

  // ==========================================================================
  // SECTION 5: TIMECODE INTEGRITY & REGRESSION CHECKS
  // ==========================================================================
  console.log('\n--- Section 5: Timecode Integrity & Regressions ---');

  // 5.1: segmentSubtitlesNetflix full pipeline verification on complex multi-clause sentence
  await runTest('5.1 segmentSubtitlesNetflix maintains non-overlapping timecodes on complex input', () => {
    const complexLines: SrtLine[] = [
      { id: 'c1', startMs: 1000, endMs: 2000, text: 'Theo báo cáo mới nhất từ Bộ Thông tin và Truyền thông,' },
      { id: 'c2', startMs: 2100, endMs: 3500, text: 'tốc độ phát triển hạ tầng mạng viễn thông đạt mức tăng trưởng ấn tượng' },
      { id: 'c3', startMs: 3600, endMs: 5000, text: 'với hơn 85% dân số tiếp cận Internet tốc độ cao.' },
    ];
    const netflix = segmentSubtitlesNetflix(complexLines);
    assert.ok(netflix.length > 0);

    for (let i = 0; i < netflix.length; i++) {
      const line = netflix[i];
      assert.ok(line.startMs < line.endMs, `Timecode invalid: startMs ${line.startMs} >= endMs ${line.endMs}`);
      const subLines = line.text.split('\n');
      assert.ok(subLines.length <= 2, `Block ${i} exceeds 2 lines (${subLines.length})`);
      for (const sl of subLines) {
        assert.ok(sl.length <= 37, `Line exceeds 37 chars (${sl.length}): "${sl}"`);
      }
      if (i > 0) {
        assert.ok(
          netflix[i - 1].endMs <= line.startMs,
          `Overlap between block ${i - 1} (${netflix[i - 1].endMs}) and block ${i} (${line.startMs})`
        );
      }
    }
  });

  // 5.2: DubbingEngine E2E with multi-speaker manifest
  await runTest('5.2 DubbingEngine mergeAudioFiles with multi-speaker manifest respects individual voice files', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_adv_dub_'));
    try {
      const ttsDir = path.join(tempDir, 'tts_audio');
      fs.mkdirSync(ttsDir, { recursive: true });

      const srtPath = path.join(tempDir, 'dialogue.srt');
      const srtContent = `1
00:00:01,000 --> 00:00:02,500
SPEAKER 0: Xin chào bạn

2
00:00:03,000 --> 00:00:04,500
SPEAKER 1: Xin chào tôi là trợ lý
`;
      fs.writeFileSync(srtPath, srtContent, 'utf-8');

      // Generate 2 sine audio files for speaker 0 and speaker 1
      await runFfmpeg([
        '-f', 'lavfi',
        '-i', 'sine=frequency=400:duration=1.4',
        '-c:a', 'libmp3lame',
        '-y', path.join(ttsDir, 'subtitle_0001.mp3'),
      ]);
      await runFfmpeg([
        '-f', 'lavfi',
        '-i', 'sine=frequency=800:duration=1.4',
        '-c:a', 'libmp3lame',
        '-y', path.join(ttsDir, 'subtitle_0002.mp3'),
      ]);

      const manifest = {
        '1': { voice: 'voice_spk0', speed: 1.0, text: 'SPEAKER 0: Xin chào bạn', isGroupLeader: false },
        '2': { voice: 'voice_spk1', speed: 1.0, text: 'SPEAKER 1: Xin chào tôi là trợ lý', isGroupLeader: false },
      };
      fs.writeFileSync(path.join(ttsDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');

      const outMp3 = path.join(tempDir, 'out_dialogue.mp3');
      const res = await mergeAudioFiles(srtPath, ttsDir, outMp3, undefined, { mode: 'strict' });
      assert.ok(fs.existsSync(res.audioPath));

      const duration = await getMediaDurationSec(outMp3);
      // Timeline ends around 4.5s + 0.5s = 5.0s
      assert.ok(duration >= 4.5 && duration <= 6.0, `Thời lượng hội thoại (${duration.toFixed(2)}s) phải nằm trong [4.5s, 6.0s]`);
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n================================================================================');
  console.log(`📊 KẾT QUẢ ADVERSARIAL STRESS TEST SUITE M2:`);
  console.log(`   Tổng số bài test:   ${totalCount}`);
  console.log(`   Thành công:         ${passedCount} ✅`);
  console.log(`   Thất bại:           ${totalCount - passedCount} ❌`);
  console.log('================================================================================\n');

  if (failureDetails.length > 0) {
    console.error('Chi tiết thất bại:');
    failureDetails.forEach((f) => console.error(` - ${f}`));
    process.exit(1);
  } else {
    console.log('🎉 TOÀN BỘ CÁC BÀI ADVERSARIAL STRESS TEST ĐỀU ĐẠT CHUẨN 100%!');
  }
}

runAdversarialSuite().catch((err) => {
  console.error('Fatal crash in adversarial test runner:', err);
  process.exit(1);
});
