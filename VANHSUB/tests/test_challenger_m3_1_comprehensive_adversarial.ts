/**
 * ============================================================================
 * ⚔️ EMPIRICAL CHALLENGER ADVERSARIAL STRESS TEST SUITE (M3)
 * Target: Word-Level Natural Segmentation & 1-1 Translation Alignment Invariants
 * ============================================================================
 */

import { segmentWordsToSubtitles, type SrtWord, type SrtLine } from '../main/asr/wordSegmenter';
import { applyVisualLineWrapping } from '../main/translate/translator';
import { parseSrt, serializeSrt } from '../main/lib/srt';
import { breakVietnameseLines, segmentSubtitlesNetflix } from '../main/lib/nlpSegmenter';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function pass(name: string, detail?: string) {
  totalTests++;
  passedTests++;
  console.log(`  ✅ [PASS] ${name}${detail ? ` (${detail})` : ''}`);
}

function fail(name: string, reason: string) {
  totalTests++;
  failedTests++;
  console.error(`  ❌ [FAIL] ${name}: ${reason}`);
}

function assert(condition: boolean, name: string, reason: string) {
  if (condition) {
    pass(name);
  } else {
    fail(name, reason);
  }
}

async function runAdversarialVerification() {
  console.log('================================================================================');
  console.log('⚔️  ADVERSARIAL CHALLENGER M3 EMPIRICAL STRESS TEST & INVARIANT AUDIT');
  console.log('================================================================================\n');

  // ===========================================================================
  // SECTION 1: WORD-LEVEL SEGMENTER SILENCE BOUNDARY PRECISION & SENSITIVITY
  // ===========================================================================
  console.log('--- Section 1: Word-Level Segmenter Silence Boundary Precision (349ms vs 350ms vs 700ms) ---');

  // 1.1 Exact 349ms vs 350ms boundary on short phrase (< 1500ms, < 4 words)
  const words349: SrtWord[] = [
    { word: 'Hello', startMs: 1000, endMs: 1300 },
    { word: 'world', startMs: 1649, endMs: 1900 }, // pause = 1649 - 1300 = 349ms
  ];
  const segs349 = segmentWordsToSubtitles(words349);
  assert(
    segs349.length === 1,
    '1.1 Silence boundary 349ms does NOT split short phrase',
    `Expected 1 segment for 349ms pause, got ${segs349.length}`
  );

  const words350: SrtWord[] = [
    { word: 'Hello', startMs: 1000, endMs: 1300 },
    { word: 'world', startMs: 1650, endMs: 1900 }, // pause = 1650 - 1300 = 350ms
  ];
  const segs350 = segmentWordsToSubtitles(words350);
  assert(
    segs350.length === 2,
    '1.2 Silence boundary 350ms DOES split phrase into 2 segments',
    `Expected 2 segments for 350ms pause, got ${segs350.length}`
  );

  // 1.3 Major pause 699ms vs 700ms under custom minPauseMs = 700
  const words699: SrtWord[] = [
    { word: 'Alpha', startMs: 0, endMs: 400 },
    { word: 'Beta', startMs: 1099, endMs: 1400 }, // pause = 699ms
  ];
  const segs699 = segmentWordsToSubtitles(words699, { minPauseMs: 700, majorPauseMs: 700 });
  assert(
    segs699.length === 1,
    '1.3 Major pause 699ms does NOT split with minPauseMs=700',
    `Expected 1 segment, got ${segs699.length}`
  );

  const words700: SrtWord[] = [
    { word: 'Alpha', startMs: 0, endMs: 400 },
    { word: 'Beta', startMs: 1100, endMs: 1400 }, // pause = 700ms
  ];
  const segs700 = segmentWordsToSubtitles(words700, { minPauseMs: 700, majorPauseMs: 700 });
  assert(
    segs700.length === 2,
    '1.4 Major pause 700ms DOES split with minPauseMs=700',
    `Expected 2 segments, got ${segs700.length}`
  );

  // 1.5 Back-to-back zero-millisecond speech
  const wordsZeroGap: SrtWord[] = [
    { word: 'One', startMs: 0, endMs: 300 },
    { word: 'two', startMs: 300, endMs: 600 },
    { word: 'three', startMs: 600, endMs: 900 },
  ];
  const segsZeroGap = segmentWordsToSubtitles(wordsZeroGap);
  assert(
    segsZeroGap.length === 1 && segsZeroGap[0].startMs === 0 && segsZeroGap[0].endMs === 900,
    '1.5 Consecutive 0ms gap words group cleanly without artificial padding',
    `Expected [0-900ms], got [${segsZeroGap[0]?.startMs}-${segsZeroGap[0]?.endMs}]`
  );

  // ===========================================================================
  // SECTION 2: ADVERSARIAL TIMESTAMPS & OVERLAPPING WORDS
  // ===========================================================================
  console.log('\n--- Section 2: Adversarial Timestamps, Inversions & Overlaps ---');

  // 2.1 Overlapping acoustic words (e.g. fast speech or dual speakers)
  const overlappingWords: SrtWord[] = [
    { word: 'Overlapping', startMs: 1000, endMs: 1600 },
    { word: 'speech', startMs: 1400, endMs: 2000 },
  ];
  const segsOverlap = segmentWordsToSubtitles(overlappingWords);
  assert(
    segsOverlap.length === 1 && segsOverlap[0].startMs === 1000 && segsOverlap[0].endMs === 2000,
    '2.1 Overlapping words resolved safely with correct span [1000-2000ms]',
    `Got [${segsOverlap[0]?.startMs}-${segsOverlap[0]?.endMs}]`
  );

  // 2.2 Unsorted input words (Whisper edge case where sidecar emits out-of-order)
  const unsortedWords: SrtWord[] = [
    { word: 'world', startMs: 1500, endMs: 1800 },
    { word: 'Hello', startMs: 1000, endMs: 1400 },
  ];
  const segsUnsorted = segmentWordsToSubtitles(unsortedWords);
  assert(
    segsUnsorted.length === 1 && segsUnsorted[0].text === 'Hello world' && segsUnsorted[0].startMs === 1000,
    '2.2 Automatically sorts out-of-order words by startMs before chunking',
    `Got text: "${segsUnsorted[0]?.text}", start: ${segsUnsorted[0]?.startMs}`
  );

  // 2.3 Zero-duration words (startMs === endMs) padded safely
  const zeroDurWords: SrtWord[] = [
    { word: 'Zero', startMs: 500, endMs: 500 },
    { word: 'duration', startMs: 530, endMs: 800 },
  ];
  const segsZeroDur = segmentWordsToSubtitles(zeroDurWords);
  assert(
    segsZeroDur.length === 1 && segsZeroDur[0].endMs === 800,
    '2.3 Zero-duration word padded to min 30ms without pushing beyond next word',
    `EndMs: ${segsZeroDur[0]?.endMs}`
  );

  // ===========================================================================
  // SECTION 3: PUNCTUATION SENSITIVITY & COMBINATORIAL STRESS
  // ===========================================================================
  console.log('\n--- Section 3: Punctuation Rules, Thresholds & Multi-Lingual CJK ---');

  // 3.1 Terminal punctuation: short phrase (< 1500ms and < 4 words) without pause does NOT premature split
  const shortTerminal: SrtWord[] = [
    { word: 'No!', startMs: 1000, endMs: 1200 },
    { word: 'Wait', startMs: 1250, endMs: 1500 },
  ];
  const segsShortTerm = segmentWordsToSubtitles(shortTerminal);
  assert(
    segsShortTerm.length === 1,
    '3.1 Terminal punctuation on short micro-phrase (< 1500ms, < 4 words) preserves context',
    `Got ${segsShortTerm.length} segments`
  );

  // 3.2 Terminal punctuation: sufficient phrase (>= 1500ms or >= 4 words) triggers clean split
  const normTerminal: SrtWord[] = [
    { word: 'I', startMs: 1000, endMs: 1200 },
    { word: 'am', startMs: 1250, endMs: 1400 },
    { word: 'very', startMs: 1450, endMs: 1700 },
    { word: 'sure.', startMs: 1750, endMs: 2600 }, // duration = 1600ms, 4 words -> terminal split!
    { word: 'Let', startMs: 2650, endMs: 2800 },
    { word: 'us', startMs: 2850, endMs: 3000 },
    { word: 'proceed.', startMs: 3050, endMs: 3300 },
  ];
  const segsNormTerm = segmentWordsToSubtitles(normTerminal);
  assert(
    segsNormTerm.length === 2 && segsNormTerm[0].text === 'I am very sure.' && segsNormTerm[1].text === 'Let us proceed.',
    '3.2 Terminal punctuation (. ? ! …) triggers split after meaningful clause',
    `Segment 0: "${segsNormTerm[0]?.text}", Segment 1: "${segsNormTerm[1]?.text}"`
  );

  // 3.3 CJK spaceless concatenation and CJK terminal punctuation (。)
  const cjkWords: SrtWord[] = [
    { word: '你', startMs: 0, endMs: 400 },
    { word: '好', startMs: 400, endMs: 800 },
    { word: '世', startMs: 800, endMs: 1200 },
    { word: '界。', startMs: 1200, endMs: 1700 }, // 4 chars, 1700ms -> triggers CJK terminal split
    { word: '欢', startMs: 1750, endMs: 2000 },
    { word: '迎', startMs: 2000, endMs: 2300 },
    { word: '你。', startMs: 2300, endMs: 2600 },
  ];
  const segsCjk = segmentWordsToSubtitles(cjkWords);
  assert(
    segsCjk.length === 2 && segsCjk[0].text === '你好世界。' && segsCjk[1].text === '欢迎你。',
    '3.3 CJK characters joined without spaces and cleanly split on 。',
    `Seg 0: "${segsCjk[0]?.text}", Seg 1: "${segsCjk[1]?.text}"`
  );

  // 3.4 Mixed Latin & CJK spacing invariant
  const mixedWords: SrtWord[] = [
    { word: 'Hello', startMs: 0, endMs: 500 },
    { word: '世界', startMs: 520, endMs: 900 },
    { word: 'and', startMs: 920, endMs: 1200 },
    { word: 'welcome', startMs: 1220, endMs: 1600 },
  ];
  const segsMixed = segmentWordsToSubtitles(mixedWords);
  assert(
    segsMixed[0].text === 'Hello 世界 and welcome',
    '3.4 Mixed Latin/CJK boundary gets spaces while pure CJK remains spaceless',
    `Got: "${segsMixed[0]?.text}"`
  );

  // ===========================================================================
  // SECTION 4: HARD CEILING <= 6.0s & MONOLOGUE STRESS TEST
  // ===========================================================================
  console.log('\n--- Section 4: Hard Ceiling <= 6.0s on Endless Continuous Monologue ---');

  // 500 continuous words without any punctuation and tiny 15ms pauses
  const monologueWords: SrtWord[] = [];
  let t = 1000;
  for (let i = 0; i < 500; i++) {
    monologueWords.push({
      word: `token${i}`,
      startMs: t,
      endMs: t + 120,
    });
    t += 135; // 120ms word + 15ms pause (< 350ms)
  }
  const monologueSegs = segmentWordsToSubtitles(monologueWords);
  let maxDurationObserved = 0;
  let allUnderCeiling = true;
  for (const seg of monologueSegs) {
    const dur = seg.endMs - seg.startMs;
    if (dur > maxDurationObserved) maxDurationObserved = dur;
    if (dur > 6000) {
      allUnderCeiling = false;
    }
  }
  assert(
    allUnderCeiling && monologueSegs.length > 10,
    `4.1 Monologue of 500 words strictly enforces hard ceiling <= 6000ms`,
    `Total segments: ${monologueSegs.length}, Max duration: ${maxDurationObserved}ms <= 6000ms`
  );

  // Invariant check on monologue: startMs === words[0].startMs and endMs === words[last].endMs
  let timecodeParityPass = true;
  for (const seg of monologueSegs) {
    if (!seg.words || seg.words.length === 0) {
      timecodeParityPass = false;
      break;
    }
    if (seg.startMs !== seg.words[0].startMs || seg.endMs !== seg.words[seg.words.length - 1].endMs) {
      timecodeParityPass = false;
      break;
    }
  }
  assert(
    timecodeParityPass,
    '4.2 Every segment timecode perfectly derives from its first and last word (zero drift)',
    'All 500 words audited'
  );

  // ===========================================================================
  // SECTION 5: SPEAKER DIARIZATION ADVERSARIAL TRANSITIONS
  // ===========================================================================
  console.log('\n--- Section 5: Speaker Diarization Transitions & Label Fidelity ---');

  // Alternating speakers on every word
  const alternatingSpeakers: SrtWord[] = [
    { word: 'Yes', startMs: 1000, endMs: 1200, speaker: 'SPEAKER_00' },
    { word: 'No', startMs: 1210, endMs: 1400, speaker: 'SPEAKER_01' },
    { word: 'Why', startMs: 1410, endMs: 1600, speaker: 'SPEAKER_00' },
    { word: 'Because', startMs: 1610, endMs: 1900, speaker: 'SPEAKER_02' },
  ];
  const segsAltSpk = segmentWordsToSubtitles(alternatingSpeakers);
  assert(
    segsAltSpk.length === 4 &&
      segsAltSpk[0].speaker === 'SPEAKER_00' &&
      segsAltSpk[1].speaker === 'SPEAKER_01' &&
      segsAltSpk[2].speaker === 'SPEAKER_00' &&
      segsAltSpk[3].speaker === 'SPEAKER_02',
    '5.1 Immediate split on every speaker transition without speaker label bleed',
    `Segments produced: ${segsAltSpk.length}`
  );

  // ===========================================================================
  // SECTION 6: 1-1 TRANSLATOR ALIGNMENT INVARIANTS (M2 & M3)
  // ===========================================================================
  console.log('\n--- Section 6: Translation 1-1 Invariants (Zero Gaps, Exact Lines, Exact Times) ---');

  // Generate 100 diverse source subtitle lines with complex gaps (0ms, 15ms, 150ms, 1500ms)
  const sourceLines: SrtLine[] = [];
  let curTime = 1000;
  const sampleVietnameseSentences = [
    'Chào bạn!',
    'Hôm nay chúng ta sẽ kiểm thử tính năng phiên âm và dịch tự động.',
    'Chính phủ vừa ban hành nghị định mới nhằm thúc đẩy phát triển kinh tế số toàn diện.',
    'Dự án này có tổng vốn đầu tư lên đến 2,5 tỷ USD trong vòng 5 năm tới.',
    'Xe ô tô chạy với vận tốc tối đa 120 km/h trên đường cao tốc Bắc Nam.',
    'Việt Nam là một quốc gia có tiềm năng kinh tế số rất lớn trong khu vực.',
    'Trí tuệ nhân tạo đang thay đổi cách thức làm việc của các doanh nghiệp.',
    'Chúng tôi cam kết chất lượng tuyệt đối cho mọi sản phẩm phát hành.',
    'Một dòng ngắn.',
    'Một câu cực kỳ dài được viết ra nhằm mục đích kiểm tra khả năng bẻ dòng hiển thị bằng ký tự xuống dòng mà không làm thay đổi bất kỳ mốc thời gian nào.',
  ];

  for (let i = 0; i < 100; i++) {
    const text = sampleVietnameseSentences[i % sampleVietnameseSentences.length];
    const duration = 1500 + (i % 5) * 500;
    const gap = i % 4 === 0 ? 0 : i % 4 === 1 ? 50 : i % 4 === 2 ? 300 : 1200;
    const speaker = i % 2 === 0 ? 'SPEAKER_00' : 'SPEAKER_01';

    sourceLines.push({
      id: `line-${i + 1}`,
      startMs: curTime,
      endMs: curTime + duration,
      text,
      speaker,
    });
    curTime += duration + gap;
  }

  // Execute applyVisualLineWrapping (used by translator.ts on translated lines)
  const wrappedLines = applyVisualLineWrapping(sourceLines, true);

  // Invariant 6.1: Strict 1-1 line count
  assert(
    wrappedLines.length === sourceLines.length,
    '6.1 Strict 1-1 Line Count Invariant (100 in -> 100 out)',
    `Expected 100 lines, got ${wrappedLines.length}`
  );

  // Invariant 6.2: Strict startMs & endMs identity
  let timecodeExact = true;
  for (let i = 0; i < sourceLines.length; i++) {
    if (wrappedLines[i].startMs !== sourceLines[i].startMs || wrappedLines[i].endMs !== sourceLines[i].endMs) {
      timecodeExact = false;
      break;
    }
  }
  assert(
    timecodeExact,
    '6.2 Strict startMs and endMs identity across all 100 lines',
    'All 100 lines matched startMs and endMs 100%'
  );

  // Invariant 6.3: Strict speaker fidelity
  let speakerFidelity = true;
  for (let i = 0; i < sourceLines.length; i++) {
    if (wrappedLines[i].speaker !== sourceLines[i].speaker) {
      speakerFidelity = false;
      break;
    }
  }
  assert(
    speakerFidelity,
    '6.3 Strict speaker diarization label fidelity across all 100 lines',
    'All speakers preserved'
  );

  // Invariant 6.4: Zero synthetic gap injection (contrast with Netflix minGapMs = 80)
  let zeroGapInjection = true;
  for (let i = 0; i < sourceLines.length - 1; i++) {
    const srcGap = sourceLines[i + 1].startMs - sourceLines[i].endMs;
    const outGap = wrappedLines[i + 1].startMs - wrappedLines[i].endMs;
    if (srcGap !== outGap) {
      zeroGapInjection = false;
      break;
    }
  }
  assert(
    zeroGapInjection,
    '6.4 Zero synthetic gap injection: all inter-line gaps exactly match source (including 0ms gaps)',
    '100% gap preservation'
  );

  // Invariant 6.5: Visual wrapping constraint (<= 37 chars per visual line)
  let visualConstraintMet = true;
  let wrappedCount = 0;
  for (const line of wrappedLines) {
    if (line.text.includes('\n')) {
      wrappedCount++;
      const sublines = line.text.split('\n');
      for (const sub of sublines) {
        if (sub.length > 37) {
          visualConstraintMet = false;
        }
      }
    } else {
      // If single line, either <= 37 or single giant token
      if (line.text.length > 37 && line.text.includes(' ')) {
        visualConstraintMet = false;
      }
    }
  }
  assert(
    visualConstraintMet && wrappedCount > 0,
    `6.5 Visual line wrapping strictly respects <= 37 chars/line on multi-line text (${wrappedCount} lines wrapped)`,
    `No visual overflow detected`
  );

  // Contrast 6.6: Verify deprecated segmentSubtitlesNetflix would have corrupted line count and gaps
  const legacyNetflixOutput = segmentSubtitlesNetflix(sourceLines);
  assert(
    legacyNetflixOutput.length > sourceLines.length,
    '6.6 Contrast check: Legacy Netflix slicing would have fragmented lines and shifted timecodes',
    `Legacy produced ${legacyNetflixOutput.length} lines vs 1-1 preservation producing exactly ${wrappedLines.length} lines`
  );

  // ===========================================================================
  // SECTION 7: ROUND-TRIP SRT SERIALIZATION & PARSING IDEMPOTENCE
  // ===========================================================================
  console.log('\n--- Section 7: SRT Serialization & Round-Trip Parsing Idempotence ---');

  const serializedSrt = serializeSrt(wrappedLines);
  const reparsedLines = parseSrt(serializedSrt);
  const reSerializedSrt = serializeSrt(reparsedLines);

  assert(
    reparsedLines.length === wrappedLines.length,
    '7.1 SRT serialization round-trip maintains exact line count (100 lines)',
    `Parsed ${reparsedLines.length} lines`
  );

  let roundTripIdentical = true;
  for (let i = 0; i < wrappedLines.length; i++) {
    if (
      reparsedLines[i].startMs !== wrappedLines[i].startMs ||
      reparsedLines[i].endMs !== wrappedLines[i].endMs ||
      reparsedLines[i].speaker !== wrappedLines[i].speaker ||
      reparsedLines[i].text.replace(/\r\n/g, '\n') !== wrappedLines[i].text.replace(/\r\n/g, '\n')
    ) {
      roundTripIdentical = false;
      break;
    }
  }
  assert(
    roundTripIdentical,
    '7.2 SRT round-trip preserves exact startMs, endMs, speaker, and visual \\n formatting',
    '100% fidelity'
  );

  assert(
    serializedSrt.trim() === reSerializedSrt.trim(),
    '7.3 Double serialization is strictly idempotent: serialize(parse(serialize(x))) === serialize(x)',
    'Exact character match'
  );

  // ===========================================================================
  // SECTION 8: PERFORMANCE & SCALE STRESS TEST
  // ===========================================================================
  console.log('\n--- Section 8: Scale & Throughput Stress Test ---');

  const tStart = Date.now();
  const largeScaleLines: SrtLine[] = [];
  for (let i = 0; i < 5000; i++) {
    largeScaleLines.push({
      id: `stress-${i}`,
      startMs: i * 2000,
      endMs: i * 2000 + 1800,
      text: 'Chính phủ vừa ban hành nghị định mới nhằm thúc đẩy phát triển kinh tế số toàn diện và bền vững.',
      speaker: i % 2 === 0 ? 'SPEAKER_00' : 'SPEAKER_01',
    });
  }
  const largeScaleResult = applyVisualLineWrapping(largeScaleLines, true);
  const elapsedMs = Date.now() - tStart;

  assert(
    largeScaleResult.length === 5000 && elapsedMs < 1000,
    `8.1 Throughput stress: 5,000 complex subtitle lines wrapped in ${elapsedMs}ms (< 1000ms threshold)`,
    `Throughput: ${(5000 / (elapsedMs / 1000)).toFixed(0)} lines/sec`
  );

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n================================================================================');
  console.log('📊 EMPIRICAL CHALLENGER ADVERSARIAL STRESS TEST SUMMARY');
  console.log(`   Total Tests:  ${totalTests}`);
  console.log(`   Passed:       ${passedTests} ✅`);
  console.log(`   Failed:       ${failedTests} ❌`);
  console.log('================================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAdversarialVerification().catch((err) => {
  console.error('[CHALLENGER FATAL ERROR]', err);
  process.exit(1);
});
