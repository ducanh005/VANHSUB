/**
 * =========================================================================================
 * COMPREHENSIVE TEST SUITE: SRT OCR NORMALIZER & CONTEXT-PRESERVING TRANSLATION
 * VANHSUB Core Subtitle Integrity, Audio Alignment & Gemini API Translation Verification
 *
 * Requirements Covered:
 * - R1: SRT OCR Normalizer (Exact duplicates, Progressive karaoke, Sentence fragments, Timeline anomalies)
 * - R2: Audio Alignment (High-precision timeline alignment with Whisper speech)
 * - R3: Context-Preserving Translation (Sliding window context, 1-1 ID mapping, 0% drop rate, Checkpointing)
 *
 * Acceptance Criteria Covered:
 * - 100% monotonic valid timeline: startMs < endMs and endMs[i-1] <= startMs[i]
 * - 0 duplicate / karaoke within gap <= 1200ms
 * - Broken sentence fragments merged with CPS-compliant duration
 * - 100% translation coverage without dropped lines (0% drop rate)
 * - Exact 1-1 ID mapping
 * =========================================================================================
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import assert from 'assert';
import OpenAI from 'openai';
import { parseSrt, serializeSrt, type SrtLine } from '../main/lib/srt';
import {
  normalizeSrtLines,
  normalizeSrt,
  normalizeSrtFile,
  alignTimelineWithAudio,
  calculateDurationForCps,
  isBrokenSentenceFragment,
  combineSentenceFragments,
} from '../main/lib/srtNormalizer';
import {
  translateSubtitlesWithContext,
  translateSrtFile,
  getCheckpointPath,
  saveCheckpoint,
  loadCheckpoint,
  buildSystemPrompt,
  buildRetrySystemPrompt,
} from '../main/translate/translator';
import { SettingsStore } from '../main/store/settingsStore';

let totalTests = 0;
let passedTests = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      await res;
    }
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message || err}`);
    failures.push(`${name}: ${err.message || err}`);
    process.exitCode = 1;
  }
}

async function runAllTests() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   VANHSUB SRT OCR NORMALIZER & TRANSLATION PIPELINE TEST SUITE (R1-R3)   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');

  // =========================================================================
  // SECTION 1: R1 - SRT OCR NORMALIZER (CORE TIMELINE & DEFECT CORRECTION)
  // =========================================================================
  console.log('\n--- Section 1: R1 - SRT OCR Normalizer Defect Correction ---');

  await test('1.1. Exact duplicates in adjacent lines (gap <= 1200ms) are merged into single timeline', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Xin chào quý vị' },
      { id: '2', startMs: 2200, endMs: 3500, text: 'Xin chào quý vị' },
      { id: '3', startMs: 3600, endMs: 4800, text: 'Xin chào quý vị.' },
    ];
    const { lines: out, stats } = normalizeSrtLines(lines, { maxGapMs: 1200 });
    assert.strictEqual(out.length, 1, `Expected 1 merged line, got ${out.length}`);
    assert.strictEqual(out[0].startMs, 1000, 'startMs must match first line');
    assert.strictEqual(out[0].endMs, 4800, 'endMs must match last line');
    assert.ok(stats.exactDuplicatesMerged >= 2, 'exactDuplicatesMerged stat recorded');
  });

  await test('1.2. Exact duplicates with gap > 1200ms are preserved as independent events', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Cảm ơn bạn' },
      { id: '2', startMs: 4000, endMs: 5000, text: 'Cảm ơn bạn' }, // gap = 2000ms > 1200ms
    ];
    const { lines: out } = normalizeSrtLines(lines, { maxGapMs: 1200 });
    assert.strictEqual(out.length, 2, 'Both lines must be preserved since gap > 1200ms');
    assert.strictEqual(out[0].startMs, 1000);
    assert.strictEqual(out[1].startMs, 4000);
  });

  await test('1.3. Progressive karaoke / text expansion frames are collapsed into single full sentence', () => {
    const lines: SrtLine[] = [
      { id: 'k1', startMs: 500, endMs: 900, text: 'Hôm nay' },
      { id: 'k2', startMs: 950, endMs: 1500, text: 'Hôm nay tôi' },
      { id: 'k3', startMs: 1550, endMs: 2200, text: 'Hôm nay tôi đi' },
      { id: 'k4', startMs: 2250, endMs: 3800, text: 'Hôm nay tôi đi làm việc tại cơ quan.' },
    ];
    const { lines: out, stats } = normalizeSrtLines(lines);
    assert.strictEqual(out.length, 1, `Expected 1 collapsed line, got ${out.length}`);
    assert.strictEqual(out[0].startMs, 500, 'startMs must be the beginning of progressive sequence');
    assert.strictEqual(out[0].endMs, 3800, 'endMs must be the end of the final completed sentence');
    assert.strictEqual(out[0].text, 'Hôm nay tôi đi làm việc tại cơ quan.');
    assert.ok(stats.karaokeMerged >= 3, 'karaokeMerged stat recorded');
  });

  await test('1.4. Broken sentence fragments without terminal punctuation are merged cleanly', () => {
    const lines: SrtLine[] = [
      { id: 'f1', startMs: 1000, endMs: 2200, text: 'Tôi đang đi trên con đường quen thuộc' }, // no terminal punctuation
      { id: 'f2', startMs: 2400, endMs: 3600, text: 'thì bất ngờ gặp lại người bạn thân cũ.' }, // starts with connector / lowercase
    ];
    assert.ok(isBrokenSentenceFragment(lines[0], lines[1]), 'Should detect broken fragment');
    const { lines: out, stats } = normalizeSrtLines(lines);
    assert.strictEqual(out.length, 1, `Expected 1 merged sentence, got ${out.length}`);
    assert.strictEqual(out[0].startMs, 1000);
    assert.ok(out[0].endMs >= 3600);
    assert.strictEqual(out[0].text, 'Tôi đang đi trên con đường quen thuộc thì bất ngờ gặp lại người bạn thân cũ.');
    assert.strictEqual(stats.fragmentsMerged, 1);
  });

  await test('1.5. Hyphenated word wrap breaks are cleanly repaired during fragment merge', () => {
    const lines: SrtLine[] = [
      { id: 'h1', startMs: 1000, endMs: 1800, text: 'Hệ thống đem lại hiệu quả cao-' },
      { id: 'h2', startMs: 1900, endMs: 2800, text: 'nhất cho quy trình sản xuất.' },
    ];
    const { lines: out } = normalizeSrtLines(lines);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].text, 'Hệ thống đem lại hiệu quả cao nhất cho quy trình sản xuất.');
  });

  await test('1.6. Merged sentence duration is adjusted according to reading speed (CPS)', () => {
    // Very long sentence in short raw duration
    const longText = 'Đây là một câu thoại có độ dài tương đối dài để kiểm tra việc điều chỉnh thời lượng hiển thị theo tốc độ đọc.';
    const lines: SrtLine[] = [
      { id: 'cps1', startMs: 1000, endMs: 1200, text: 'Đây là một câu thoại có độ dài tương đối dài' },
      { id: 'cps2', startMs: 1300, endMs: 1500, text: 'để kiểm tra việc điều chỉnh thời lượng hiển thị theo tốc độ đọc.' },
    ];
    const { lines: out } = normalizeSrtLines(lines, { targetCps: 20 });
    assert.strictEqual(out.length, 1);
    const duration = out[0].endMs - out[0].startMs;
    const expectedMinDuration = calculateDurationForCps(out[0].text, 20);
    assert.ok(
      duration >= expectedMinDuration,
      `Duration (${duration}ms) must be >= CPS expectation (${expectedMinDuration}ms)`
    );
  });

  await test('1.7. Inverted timestamps (startMs >= endMs) are automatically corrected', () => {
    const lines: SrtLine[] = [
      { id: 'inv1', startMs: 5000, endMs: 3000, text: 'Câu có timeline bị nghịch đảo' }, // reversed
      { id: 'inv2', startMs: 6000, endMs: 6000, text: 'Câu có startMs bằng endMs' }, // equal
    ];
    const { lines: out, stats } = normalizeSrtLines(lines);
    assert.strictEqual(out.length, 2);
    for (const line of out) {
      assert.ok(line.startMs < line.endMs, `Line ${line.id} must have startMs < endMs (${line.startMs} < ${line.endMs})`);
      assert.ok(line.endMs - line.startMs >= 200, 'Duration must be >= 200ms');
    }
    assert.ok(stats.invertedTimelinesFixed >= 2, 'Inverted timestamps count recorded');
  });

  await test('1.8. Ultra-short display duration (< 200ms) is extended to satisfy readability', () => {
    const lines: SrtLine[] = [
      { id: 'short1', startMs: 1000, endMs: 1080, text: 'Nhanh quá!' }, // 80ms
    ];
    const { lines: out, stats } = normalizeSrtLines(lines, { minDisplayDurationMs: 200 });
    assert.strictEqual(out.length, 1);
    assert.ok(out[0].endMs - out[0].startMs >= 200, 'Must be at least 200ms');
    assert.ok(stats.shortDurationsExtended >= 1);
  });

  await test('1.9. Overlapping timestamps between consecutive lines are strictly resolved', () => {
    const lines: SrtLine[] = [
      { id: 'o1', startMs: 1000, endMs: 3500, text: 'Dòng thứ nhất kéo dài' },
      { id: 'o2', startMs: 3000, endMs: 5000, text: 'Dòng thứ hai bị đè lên dòng một' }, // overlaps 3000-3500
    ];
    const { lines: out, stats } = normalizeSrtLines(lines);
    assert.strictEqual(out.length, 2);
    assert.ok(out[0].startMs < out[0].endMs, 'out[0].startMs < out[0].endMs');
    assert.ok(out[1].startMs < out[1].endMs, 'out[1].startMs < out[1].endMs');
    assert.ok(out[0].endMs <= out[1].startMs, `out[0].endMs (${out[0].endMs}) <= out[1].startMs (${out[1].startMs})`);
    assert.ok(stats.overlapsResolved >= 1);
  });

  await test('1.10. OCR garbage lines (glyphs, single noise characters) are safely removed', () => {
    const lines: SrtLine[] = [
      { id: 'g1', startMs: 500, endMs: 800, text: 'c' }, // single character
      { id: 'g2', startMs: 900, endMs: 1200, text: '...' }, // punctuation only
      { id: 'g3', startMs: 1500, endMs: 2500, text: 'Nội dung phụ đề thực tế rất rõ ràng.' },
      { id: 'g4', startMs: 2600, endMs: 2900, text: '\uFFFD\uE001' }, // Unicode glitch
    ];
    const { lines: out, stats } = normalizeSrtLines(lines);
    assert.strictEqual(out.length, 1, `Expected only 1 valid line, got ${out.length}`);
    assert.strictEqual(out[0].text, 'Nội dung phụ đề thực tế rất rõ ràng.');
    assert.ok(stats.garbageRemoved >= 3);
  });

  await test('1.11. 100% Monotonic Strict Timeline Invariant verified on complex messy dataset', () => {
    const complexMessyLines: SrtLine[] = [
      { id: 'm1', startMs: 12000, endMs: 10000, text: 'Ngược thời gian ở vị trí đầu' },
      { id: 'm2', startMs: 1000, endMs: 1500, text: 'Câu A bắt đầu' },
      { id: 'm3', startMs: 1400, endMs: 2000, text: 'Câu A bắt đầu' }, // duplicate + overlap
      { id: 'm4', startMs: 2100, endMs: 2150, text: 'Siêu ngắn' }, // 50ms
      { id: 'm5', startMs: 2200, endMs: 3000, text: 'Đoạn này bị ngắt' },
      { id: 'm6', startMs: 3100, endMs: 4000, text: 'và tiếp tục ở đây.' }, // fragment
      { id: 'm7', startMs: 3800, endMs: 4200, text: 'chồng chéo một' },
      { id: 'm8', startMs: 3900, endMs: 5000, text: 'chồng chéo hai' },
      { id: 'm9', startMs: 7000, endMs: 7000, text: 'Thời lượng bằng không' },
    ];
    const { lines: out } = normalizeSrtLines(complexMessyLines);

    // Verify Invariant: 100% output lines strictly have startMs < endMs AND endMs[i-1] <= startMs[i]
    assert.ok(out.length > 0, 'Must produce valid lines');
    for (let i = 0; i < out.length; i++) {
      assert.ok(
        out[i].startMs < out[i].endMs,
        `Line ${i} (${out[i].text}): startMs (${out[i].startMs}) must be < endMs (${out[i].endMs})`
      );
      if (i > 0) {
        assert.ok(
          out[i - 1].endMs <= out[i].startMs,
          `Monotonic ordering violated at line ${i}: prev.endMs (${out[i - 1].endMs}) > cur.startMs (${out[i].startMs})`
        );
      }
    }
  });

  await test('1.12. Missing or zero endMs does NOT collapse startMs to 00:00:00', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 5000, endMs: 7000, text: 'Câu thoại bình thường' },
      { id: '2', startMs: 25000, endMs: 0, text: 'Câu thoại ở giây 25 bị mất mốc kết thúc' },
    ];
    const { lines: out, stats } = normalizeSrtLines(lines);
    assert.strictEqual(out.length, 2);
    const line2 = out.find((l) => l.text.includes('giây 25'));
    assert.ok(line2, 'Line 2 must exist');
    assert.ok(line2.startMs >= 24000, `Line 2 startMs must remain around 25000ms, got ${line2.startMs}`);
    assert.ok(line2.endMs > line2.startMs, 'Line 2 endMs must be > startMs');
    assert.ok(stats.invertedTimelinesFixed >= 1);
  });

  await test('1.13. Optical bogus endMs with startMs - endMs > maxDurationMs preserves startMs', () => {
    const lines: SrtLine[] = [
      { id: 'bogus1', startMs: 60000, endMs: 500, text: 'Câu thoại ở phút 1 dính endMs quang học rác' },
    ];
    const { lines: out } = normalizeSrtLines(lines);
    assert.strictEqual(out.length, 1);
    assert.ok(out[0].startMs >= 59000, `startMs must stay near 60000ms, got ${out[0].startMs}`);
    assert.ok(out[0].endMs - out[0].startMs <= 7000, 'Duration must be constrained by CPS budget, not 59.5 seconds');
  });

  await test('1.14. Single CJK dialogue characters (Hanzi, Kana) are preserved and not dropped as garbage', () => {
    const lines: SrtLine[] = [
      { id: 'c1', startMs: 1000, endMs: 2000, text: '好！' },
      { id: 'c2', startMs: 3000, endMs: 4000, text: '谁？' },
    ];
    const { lines: out } = normalizeSrtLines(lines);
    assert.strictEqual(out.length, 2, 'Must preserve meaningful single CJK dialogue utterances');
    assert.strictEqual(out[0].text, '好！');
    assert.strictEqual(out[1].text, '谁？');
  });

  await test('1.15. Dialogue dash ("- ") is recognized as speaker turn, not merged as sentence fragment', () => {
    const line1 = { id: '1', startMs: 1000, endMs: 2000, text: 'Tôi đi đây' };
    const line2 = { id: '2', startMs: 2200, endMs: 3200, text: '- Chúc bạn may mắn.' };
    const isFrag = isBrokenSentenceFragment(line1, line2);
    assert.strictEqual(isFrag, false, 'Dialogue dash must not be merged as a continuation fragment');
  });

  await test('1.16. Sentence fragment continuation starting with quotes or brackets is merged cleanly', () => {
    const line1 = { id: '1', startMs: 1000, endMs: 2000, text: 'Họ đồng thanh hô to rằng' };
    const line2 = { id: '2', startMs: 2200, endMs: 3200, text: '"chúng tôi đã sẵn sàng!"' };
    const isFrag = isBrokenSentenceFragment(line1, line2);
    assert.strictEqual(isFrag, true, 'Leading quote followed by lowercase must be recognized as fragment');
    const { lines: out } = normalizeSrtLines([line1, line2]);
    assert.strictEqual(out.length, 1);
  });

  await test('1.17. Sentence fragment ending with preposition/connector before proper noun is merged cleanly', () => {
    const lineVi1 = { id: 'v1', startMs: 1000, endMs: 2000, text: 'Tôi sinh ra tại' };
    const lineVi2 = { id: 'v2', startMs: 2200, endMs: 3200, text: 'Hà Nội năm 1990.' };
    assert.strictEqual(isBrokenSentenceFragment(lineVi1, lineVi2), true, 'Vietnamese connector before proper noun must merge');
    const { lines: outVi } = normalizeSrtLines([lineVi1, lineVi2]);
    assert.strictEqual(outVi.length, 1);
    assert.strictEqual(outVi[0].text, 'Tôi sinh ra tại Hà Nội năm 1990.');

    const lineEn1 = { id: 'e1', startMs: 1000, endMs: 2000, text: 'I am traveling to' };
    const lineEn2 = { id: 'e2', startMs: 2200, endMs: 3200, text: 'London tomorrow.' };
    assert.strictEqual(isBrokenSentenceFragment(lineEn1, lineEn2), true, 'English preposition before proper noun must merge');
    const { lines: outEn } = normalizeSrtLines([lineEn1, lineEn2]);
    assert.strictEqual(outEn.length, 1);
    assert.strictEqual(outEn[0].text, 'I am traveling to London tomorrow.');
  });

  await test('1.18. Ellipsis suspension (...) trailing off into lowercase continuation is merged cleanly', () => {
    const line1 = { id: '1', startMs: 1000, endMs: 2000, text: 'Tôi nghĩ rằng...' };
    const line2 = { id: '2', startMs: 2200, endMs: 3200, text: 'chúng ta nên dừng lại.' };
    assert.strictEqual(isBrokenSentenceFragment(line1, line2), true, 'Ellipsis followed by lowercase must be recognized as continuation');
    const { lines: out } = normalizeSrtLines([line1, line2]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].text, 'Tôi nghĩ rằng... chúng ta nên dừng lại.');
  });

  await test('1.19. Step 6 resolves short CJK containment without truncation or overlapping', () => {
    const lines: SrtLine[] = [
      { id: 'c1', startMs: 1000, endMs: 3000, text: '你好' },
      { id: 'c2', startMs: 2500, endMs: 4500, text: '你好世界' },
    ];
    const { lines: out } = normalizeSrtLines(lines);
    assert.strictEqual(out.length, 1, 'Sub-phrase containment in CJK must merge overlapping frames');
    assert.strictEqual(out[0].text, '你好世界');
    assert.strictEqual(out[0].startMs, 1000);
    assert.strictEqual(out[0].endMs, 4500);
  });

  await test('1.20. Multi-fragment chaining (3+ lines) merges completely even when CPS extends prior endMs', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Hôm nay chúng ta cùng nhau thảo luận về các giải pháp' },
      { id: '2', startMs: 2100, endMs: 3100, text: 'phát triển phần mềm chất lượng cao và' },
      { id: '3', startMs: 3200, endMs: 4200, text: 'xây dựng hệ thống hoàn chỉnh.' },
    ];
    const { lines: out, stats } = normalizeSrtLines(lines);
    assert.strictEqual(out.length, 1, 'All 3 fragments must merge into 1 single sentence');
    assert.strictEqual(
      out[0].text,
      'Hôm nay chúng ta cùng nhau thảo luận về các giải pháp phát triển phần mềm chất lượng cao và xây dựng hệ thống hoàn chỉnh.'
    );
    assert.strictEqual(stats.fragmentsMerged, 2, 'Must record 2 fragment merges');
  });

  await test('1.21. Broken sentence fragment ending with abbreviation (Dr., TP., Mr.) merges with following proper noun', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: 'Chúng tôi đã liên hệ với Dr.' },
      { id: '2', startMs: 2200, endMs: 3200, text: 'Watson tại bệnh viện.' },
      { id: '3', startMs: 3500, endMs: 4500, text: 'Hội nghị sẽ diễn ra tại TP.' },
      { id: '4', startMs: 4700, endMs: 5700, text: 'Hồ Chí Minh vào tuần tới.' },
    ];
    const { lines: out, stats } = normalizeSrtLines(lines);
    assert.strictEqual(out.length, 2, 'Both abbreviation-broken sentences must be repaired');
    assert.strictEqual(out[0].text, 'Chúng tôi đã liên hệ với Dr. Watson tại bệnh viện.');
    assert.strictEqual(out[1].text, 'Hội nghị sẽ diễn ra tại TP. Hồ Chí Minh vào tuần tới.');
    assert.strictEqual(stats.fragmentsMerged, 2);
  });

  await test('1.22. Quoted terminal punctuation (!", ?") preserves sentence boundary and avoids false merge', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: '"Tuyệt đối không!"' },
      { id: '2', startMs: 2200, endMs: 3200, text: 'và anh ấy lập tức rời đi.' },
    ];
    const { lines: out } = normalizeSrtLines(lines);
    assert.strictEqual(out.length, 2, 'Quoted terminal punctuation must not be merged with next line');
    assert.strictEqual(out[0].text, '"Tuyệt đối không!"');
    assert.strictEqual(out[1].text, 'và anh ấy lập tức rời đi.');
  });

  await test('1.23. Step 6 resolves progressive overlap when earlier line contains trailing punctuation', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2500, text: 'Xin chào.' },
      { id: '2', startMs: 1500, endMs: 3500, text: 'Xin chào mọi người.' },
    ];
    const { lines: out } = normalizeSrtLines(lines, { deduplicateKaraoke: false });
    assert.strictEqual(out.length, 1, 'Trailing period on earlier frame must not prevent containment collapse');
    assert.strictEqual(out[0].text, 'Xin chào mọi người.');
    assert.strictEqual(out[0].startMs, 1000);
    assert.strictEqual(out[0].endMs, 3500);
  });

  await test('1.24. Fragment chaining respects maxDurationMs (7000ms limit)', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2800, text: 'Phần mở đầu câu chuyện này' },
      { id: '2', startMs: 2900, endMs: 4800, text: 'tiếp tục được diễn giải chi tiết và' },
      { id: '3', startMs: 4900, endMs: 6800, text: 'kéo dài thêm qua nhiều nội dung và' },
      { id: '4', startMs: 6900, endMs: 8800, text: 'cuối cùng đi đến kết luận quan trọng.' },
    ];
    const { lines: out } = normalizeSrtLines(lines, { maxDurationMs: 7000 });
    // Duration must not exceed 7000ms for any single line
    for (const l of out) {
      assert.ok(l.endMs - l.startMs <= 7000, `Line duration (${l.endMs - l.startMs}ms) must not exceed 7000ms`);
    }
  });

  // =========================================================================
  // SECTION 2: R2 - AUDIO ALIGNMENT VERIFICATION
  // =========================================================================
  console.log('\n--- Section 2: R2 - High-Precision Audio Alignment ---');

  await test('2.1. OCR line with timeline drift is accurately aligned to Whisper speech timestamps', () => {
    // OCR optical detector caught subtitle late (startMs drifted from 1200ms to 1800ms)
    const ocrLines: SrtLine[] = [
      { id: 'ocr-1', startMs: 1800, endMs: 4500, text: 'Chào mừng các bạn đến với chương trình ngày hôm nay' },
    ];
    // True speech uttered at 1200ms to 4100ms
    const whisperLines: SrtLine[] = [
      { id: 'wh-1', startMs: 1200, endMs: 4100, text: 'Chào mừng các bạn đến với chương trình ngày hôm nay' },
    ];

    const { alignedLines, alignedCount } = alignTimelineWithAudio(ocrLines, whisperLines);
    assert.strictEqual(alignedCount, 1, 'Should find 1 aligned match');
    assert.strictEqual(alignedLines[0].startMs, 1200, 'startMs must snap to speech timestamp (1200ms)');
    assert.strictEqual(alignedLines[0].endMs, 4100, 'endMs must snap to speech timestamp (4100ms)');
  });

  await test('2.2. Visual banners/graphics without speech preserve original OCR timestamps', () => {
    const ocrLines: SrtLine[] = [
      { id: 'banner-1', startMs: 5000, endMs: 9000, text: 'KÊNH YOUTUBE CHÍNH THỨC: VANHSUB STUDIO' },
      { id: 'speech-1', startMs: 10000, endMs: 13000, text: 'Tôi xin thông báo kết quả cuộc họp' },
    ];
    const whisperLines: SrtLine[] = [
      { id: 'wh-1', startMs: 9800, endMs: 12900, text: 'Tôi xin thông báo kết quả cuộc họp' },
    ];

    const { alignedLines, alignedCount } = alignTimelineWithAudio(ocrLines, whisperLines);
    assert.strictEqual(alignedCount, 1, 'Only speech segment is aligned');
    // Banner preserved exactly
    assert.strictEqual(alignedLines[0].startMs, 5000);
    assert.strictEqual(alignedLines[0].endMs, 9000);
    // Speech aligned to Whisper
    assert.strictEqual(alignedLines[1].startMs, 9800);
    assert.strictEqual(alignedLines[1].endMs, 12900);
  });

  await test('2.3. End-to-end normalizeSrtLines with audioSegments satisfies all integrity constraints', () => {
    const ocrLines: SrtLine[] = [
      { id: '1', startMs: 1500, endMs: 3500, text: 'Chào buổi sáng' },
      { id: '2', startMs: 3600, endMs: 5000, text: 'mọi người thân mến.' },
      { id: '3', startMs: 8000, endMs: 12000, text: 'BANNER ĐỒ HỌA' },
    ];
    const whisperLines: SrtLine[] = [
      { id: 'w1', startMs: 1100, endMs: 4800, text: 'Chào buổi sáng mọi người thân mến.' },
    ];

    const { lines: out, stats } = normalizeSrtLines(ocrLines, { audioSegments: whisperLines });
    assert.ok(stats.audioAlignedCount >= 1, 'Audio aligned recorded');
    assert.strictEqual(out.length, 2, 'Fragments merged into 1 + banner = 2 lines');
    assert.strictEqual(out[0].startMs, 1100, 'First line aligned with speech');
    assert.strictEqual(out[0].text, 'Chào buổi sáng mọi người thân mến.');

    // Invariant check
    for (let i = 0; i < out.length; i++) {
      assert.ok(out[i].startMs < out[i].endMs);
      if (i > 0) assert.ok(out[i - 1].endMs <= out[i].startMs);
    }
  });

  await test('2.4. Multiple OCR speech lines matching single Whisper segment are partitioned within speech bounds', () => {
    const ocrLines: SrtLine[] = [
      { id: '1', startMs: 1200, endMs: 2800, text: 'Chào mừng quý vị.' },
      { id: '2', startMs: 3000, endMs: 4800, text: 'Tôi là người dẫn chương trình.' },
    ];
    const whisperLines: SrtLine[] = [
      { id: 'w1', startMs: 1000, endMs: 5000, text: 'Chào mừng quý vị. Tôi là người dẫn chương trình.' },
    ];

    const { lines: out, stats } = normalizeSrtLines(ocrLines, { audioSegments: whisperLines });
    assert.strictEqual(out.length, 2, 'Preserves both distinct sentences');
    assert.strictEqual(stats.audioAlignedCount, 2, 'Both lines aligned');
    assert.ok(out[0].startMs >= 1000, `Line 0 start >= 1000ms (got ${out[0].startMs})`);
    assert.ok(out[0].endMs <= out[1].startMs, `Line 0 end (${out[0].endMs}) <= Line 1 start (${out[1].startMs})`);
    assert.ok(out[1].endMs <= 5000, `Line 1 end must be within speech window 5000ms (got ${out[1].endMs})`);
  });

  await test('2.5. Audio alignment with punctuation in OCR lines correctly matches Whisper tokens', () => {
    const ocrLines: SrtLine[] = [
      { id: 'ocr-1', startMs: 2000, endMs: 4000, text: 'Hello.' },
    ];
    const whisperLines: SrtLine[] = [
      { id: 'wh-1', startMs: 1000, endMs: 5000, text: 'Hello how are you' },
    ];
    const { alignedLines, alignedCount } = alignTimelineWithAudio(ocrLines, whisperLines);
    assert.strictEqual(alignedCount, 1, 'Punctuation in OCR line should not prevent audio alignment match');
    assert.strictEqual(alignedLines[0].startMs, 1000);
    assert.strictEqual(alignedLines[0].endMs, 5000);
  });

  await test('2.6. Audio alignment with CJK Chinese/Japanese text accurately matches Whisper speech', () => {
    const ocrLines: SrtLine[] = [
      { id: 'ocr-cjk', startMs: 2000, endMs: 4000, text: '欢迎大家' },
    ];
    const whisperLines: SrtLine[] = [
      { id: 'wh-cjk', startMs: 1000, endMs: 5000, text: '欢迎大家来到这里' },
    ];
    const { alignedLines, alignedCount } = alignTimelineWithAudio(ocrLines, whisperLines);
    assert.strictEqual(alignedCount, 1, 'CJK unspaced text must match spoken Whisper speech');
    assert.strictEqual(alignedLines[0].startMs, 1000);
    assert.strictEqual(alignedLines[0].endMs, 5000);
  });

  await test('2.7. Interleaved unvoiced banners between multi-line OCR matches partition speech without collision', () => {
    const ocrLines: SrtLine[] = [
      { id: '1', startMs: 1200, endMs: 2500, text: 'Xin chào quý vị' },
      { id: 'banner', startMs: 2600, endMs: 3200, text: 'BẢN QUYỀN VANHSUB' },
      { id: '2', startMs: 3300, endMs: 4500, text: 'và các bạn' },
    ];
    const whisperLines: SrtLine[] = [
      { id: 'wh', startMs: 1000, endMs: 5000, text: 'Xin chào quý vị và các bạn' },
    ];
    const { lines: out, stats } = normalizeSrtLines(ocrLines, { audioSegments: whisperLines });
    assert.strictEqual(stats.audioAlignedCount, 2, 'Both speech lines must be aligned');
    assert.strictEqual(out.length, 3, 'Must maintain speech 1, banner, speech 2 as 3 separate clean lines');
    // Ensure the banner was not mashed into speech
    assert.strictEqual(out[1].text, 'BẢN QUYỀN VANHSUB');
    // Ensure strict monotonic timestamps
    for (let i = 0; i < out.length; i++) {
      assert.ok(out[i].startMs < out[i].endMs);
      if (i > 0) assert.ok(out[i - 1].endMs <= out[i].startMs);
    }
  });

  // =========================================================================
  // SECTION 3: R3 - CONTEXT-PRESERVING TRANSLATION VIA GEMINI API
  // =========================================================================
  console.log('\n--- Section 3: R3 - Context-Preserving Translation via Gemini API ---');

  await test('3.1. System prompts contain sliding window context rules and strict 1-1 mapping', () => {
    const sysPrompt = buildSystemPrompt('vi');
    assert.ok(sysPrompt.includes('CỬA SỔ NGỮ CẢNH TRƯỢT'), 'Must specify sliding window context in system prompt');
    assert.ok(sysPrompt.includes('context'), 'Must mention context field');
    assert.ok(sysPrompt.includes('BẢO TOÀN ID'), 'Must enforce ID preservation');

    const retryPrompt = buildRetrySystemPrompt('vi', 5);
    assert.ok(retryPrompt.includes('chính xác 5 câu'), 'Retry prompt specifies exact count');
  });

  await test('3.2. Mocked Gemini API translates 100% lines with sliding window context and 1-1 ID mapping', async () => {
    const sourceLines: SrtLine[] = [
      { id: 'line-0', startMs: 1000, endMs: 2000, text: 'Xin chào anh.' },
      { id: 'line-1', startMs: 2200, endMs: 3200, text: 'Rất vui được gặp lại.' },
      { id: 'line-2', startMs: 3500, endMs: 4500, text: 'Hôm nay chúng ta bàn về dự án mới.' },
      { id: 'line-3', startMs: 4800, endMs: 5800, text: 'Mọi thứ đã sẵn sàng chưa?' },
      { id: 'line-4', startMs: 6000, endMs: 7000, text: 'Vâng, tất cả tài liệu đều ở đây.' },
    ];

    let contextHistory: Array<{ original: string; translated: string }[]> = [];

    // Mock Gemini API client
    const customClient = {
      model: 'gemini-3.8-flash',
      client: {
        chat: {
          completions: {
            create: async (params: any) => {
              const userMsg = params.messages?.find((m: any) => m.role === 'user');
              const payload = JSON.parse(userMsg.content);

              if (payload.context && payload.context.length > 0) {
                contextHistory.push(payload.context);
              }

              const items = payload.items || [];
              const trans = items.map((it: any) => ({
                i: it.i,
                text: `[Dịch vi] ${it.text}`,
              }));

              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify(trans),
                    },
                  },
                ],
              };
            },
          },
        },
      },
    };

    // Run with small batchSize = 2 to test cross-batch sliding window context
    const translated = await translateSubtitlesWithContext(sourceLines, {
      targetLanguage: 'vi',
      batchSize: 2,
      concurrency: 1,
      customClient: customClient as any,
    });

    assert.strictEqual(translated.length, sourceLines.length, '100% line count preserved');
    for (let i = 0; i < sourceLines.length; i++) {
      assert.strictEqual(translated[i].id, sourceLines[i].id, `Line ${i} ID must be preserved 1-1`);
      assert.strictEqual(translated[i].startMs, sourceLines[i].startMs, `Line ${i} startMs preserved`);
      assert.strictEqual(translated[i].endMs, sourceLines[i].endMs, `Line ${i} endMs preserved`);
      assert.ok(translated[i].text.startsWith('[Dịch vi]'), 'Text must be translated');
    }

    // Verify sliding window context was supplied in later batches
    assert.ok(contextHistory.length > 0, 'Context was passed to subsequent batches');
    const lastContext = contextHistory[contextHistory.length - 1];
    assert.ok(lastContext.length >= 1 && lastContext.length <= 3, 'Context has 2-3 previous translated lines');
  });

  await test('3.3. Escalated retry + single-line fallback guarantees 0% drop rate when model omits lines', async () => {
    const sourceLines: SrtLine[] = [
      { id: 'line-0', startMs: 1000, endMs: 2000, text: 'Câu số 0 đầu file' },
      { id: 'line-1', startMs: 2500, endMs: 3500, text: 'Câu số 1 ở giữa' },
      { id: 'line-2', startMs: 4000, endMs: 5000, text: 'Câu số 2 cuối file' },
    ];

    let callAttempts = 0;

    // Simulate AI model that drops line-1 on first attempt, then returns it on retry
    const flakyClient = {
      model: 'gemini-3.8-flash',
      client: {
        chat: {
          completions: {
            create: async (params: any) => {
              callAttempts++;
              const userMsg = params.messages?.find((m: any) => m.role === 'user');
              const payload = JSON.parse(userMsg.content);
              const items = payload.items || [];

              if (callAttempts === 1) {
                // First call: drop line-1!
                const partial = items
                  .filter((it: any) => it.i !== 'line-1')
                  .map((it: any) => ({ i: it.i, text: `[Dịch] ${it.text}` }));
                return { choices: [{ message: { content: JSON.stringify(partial) } }] };
              }

              // Retry call: return requested items
              const full = items.map((it: any) => ({ i: it.i, text: `[Dịch khôi phục] ${it.text}` }));
              return { choices: [{ message: { content: JSON.stringify(full) } }] };
            },
          },
        },
      },
    };

    const translated = await translateSubtitlesWithContext(sourceLines, {
      targetLanguage: 'vi',
      batchSize: 5,
      customClient: flakyClient as any,
    });

    assert.ok(callAttempts >= 2, 'Triggered escalated retry for dropped line');
    assert.strictEqual(translated.length, 3, '0% drop rate: all 3 lines translated');
    assert.strictEqual(translated[0].id, 'line-0');
    assert.strictEqual(translated[1].id, 'line-1');
    assert.strictEqual(translated[2].id, 'line-2');
    assert.strictEqual(translated[1].text, '[Dịch khôi phục] Câu số 1 ở giữa');
  });

  await test('3.4. Batch checkpointing saves progress to disk and supports resumption', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_ckpt_test_'));
    const tempSrt = path.join(tempDir, 'sample_test.srt');

    const sourceLines: SrtLine[] = [
      { id: 'line-0', startMs: 1000, endMs: 2000, text: 'Dòng một' },
      { id: 'line-1', startMs: 2500, endMs: 3500, text: 'Dòng hai' },
    ];
    fs.writeFileSync(tempSrt, serializeSrt(sourceLines), 'utf-8');

    // Save checkpoint manually
    saveCheckpoint(
      tempSrt,
      'vi',
      {
        'line-0': { source: 'Dòng một', target: 'Bản dịch dòng một' },
      },
      sourceLines.length
    );

    const ckptFile = getCheckpointPath(tempSrt);
    assert.ok(fs.existsSync(ckptFile), 'Checkpoint file must exist on disk');

    const loaded = loadCheckpoint(tempSrt, 'vi', sourceLines.length);
    assert.ok(loaded.has('line-0'), 'Checkpoint loaded line-0');

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await test('3.5. Single-line fallback successfully uses customClient when all batch retries omit a line', async () => {
    const sourceLines: SrtLine[] = [
      { id: 'line-0', startMs: 1000, endMs: 2000, text: 'Dòng thứ nhất' },
      { id: 'line-1', startMs: 2500, endMs: 3500, text: 'Dòng thứ hai bị bỏ rơi' },
    ];

    let batchCalls = 0;
    let singleCalls = 0;

    const stubbornClient = {
      model: 'gemini-3.8-flash',
      client: {
        chat: {
          completions: {
            create: async (params: any) => {
              const userMsg = params.messages?.find((m: any) => m.role === 'user');
              const sysMsg = params.messages?.find((m: any) => m.role === 'system');

              // Single-line fallback call
              if (sysMsg?.content?.includes('Dịch DUY NHẤT câu sau')) {
                singleCalls++;
                return {
                  choices: [{ message: { content: '[Dịch đơn lẻ] Dòng thứ hai bị bỏ rơi' } }],
                };
              }

              // Batch calls: always omit line-1
              batchCalls++;
              const payload = JSON.parse(userMsg.content);
              const items = payload.items || [];
              const partial = items
                .filter((it: any) => it.i !== 'line-1')
                .map((it: any) => ({ i: it.i, text: `[Dịch batch] ${it.text}` }));
              return { choices: [{ message: { content: JSON.stringify(partial) } }] };
            },
          },
        },
      },
    };

    const translated = await translateSubtitlesWithContext(sourceLines, {
      targetLanguage: 'vi',
      batchSize: 5,
      customClient: stubbornClient as any,
    });

    assert.ok(batchCalls >= 3, 'Tried batch translation 3 times');
    assert.strictEqual(singleCalls, 1, 'Triggered single-line fallback via customClient');
    assert.strictEqual(translated.length, 2, '0% drop rate achieved');
    assert.strictEqual(translated[0].text, '[Dịch batch] Dòng thứ nhất');
    assert.strictEqual(translated[1].text, '[Dịch đơn lẻ] Dòng thứ hai bị bỏ rơi');
  });

  // =========================================================================
  // SECTION 4: FILE ROUND-TRIP AND PROGRAMMATIC INTEGRATION
  // =========================================================================
  console.log('\n--- Section 4: File Round-Trip and Full Pipeline Integration ---');

  await test('4.1. normalizeSrtFile normalizes an SRT file on disk with full report', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_file_test_'));
    const inputSrt = path.join(tempDir, 'raw_ocr.srt');
    const outputSrt = path.join(tempDir, 'clean_ocr.srt');

    const dirtySrtContent = `1
00:00:05,000 --> 00:00:03,000
Câu bị ngược timeline

2
00:00:06,000 --> 00:00:07,000
Câu lặp nguyên văn

3
00:00:07,200 --> 00:00:08,500
Câu lặp nguyên văn

4
00:00:08,700 --> 00:00:09,800
Đây là phần mở đầu của câu

5
00:00:10,000 --> 00:00:11,500
và đây là phần kết thúc có ý nghĩa.
`;
    fs.writeFileSync(inputSrt, dirtySrtContent, 'utf-8');

    const res = normalizeSrtFile(inputSrt, outputSrt);
    assert.ok(fs.existsSync(outputSrt), 'Output SRT file created');
    assert.ok(res.lines.length >= 1, 'Normalized lines returned');
    assert.ok(res.stats.invertedTimelinesFixed >= 1, 'Inverted timeline fixed');
    assert.ok(res.stats.exactDuplicatesMerged >= 1, 'Exact duplicate merged');
    assert.ok(res.stats.fragmentsMerged >= 1, 'Sentence fragments merged');

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await test('4.2. Empty array and single line edge cases handled safely', () => {
    const emptyRes = normalizeSrtLines([]);
    assert.strictEqual(emptyRes.lines.length, 0);
    assert.strictEqual(emptyRes.stats.inputCount, 0);

    const singleRes = normalizeSrtLines([
      { id: 's1', startMs: 1000, endMs: 1500, text: 'Một câu duy nhất' },
    ]);
    assert.strictEqual(singleRes.lines.length, 1);
    assert.strictEqual(singleRes.lines[0].text, 'Một câu duy nhất');
  });

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n================================================================================');
  console.log(`📊 TEST SUITE SUMMARY: ${passedTests}/${totalTests} TESTS PASSED (100% TARGET)`);
  if (failures.length > 0) {
    console.error(`❌ FAILURES (${failures.length}):`);
    failures.forEach((f) => console.error(`   - ${f}`));
    process.exit(1);
  } else {
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! ZERO REGRESSIONS DETECTED.');
    console.log('================================================================================\n');
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
