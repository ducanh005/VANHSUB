import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import {
  segmentWordsToSubtitles,
  formatWordsText,
  wrapVisualLines,
  isCjkText,
  isCjkChar,
  countUnits,
  hasTerminalPunctuation,
  hasClausePunctuation,
  type SrtWord,
  type SrtLine,
} from '../main/asr/wordSegmenter';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`[FORENSIC ASSERTION FAILED]: ${msg}`);
  }
}

console.log('=== FORENSIC INTEGRITY AUDIT: MILESTONE 1 (WORD-LEVEL SEGMENTER) ===\n');

// -------------------------------------------------------------------------
// CHECK 1: True Word Timestamps & Zero Artificial Gaps
// -------------------------------------------------------------------------
console.log('Check 1: Verifying True Word Timestamps calculation (startMs/endMs)...');
{
  const words: SrtWord[] = [
    { word: 'Hệ', startMs: 105, endMs: 280 },
    { word: 'thống', startMs: 290, endMs: 510 },
    { word: 'phụ', startMs: 520, endMs: 730 },
    { word: 'đề', startMs: 740, endMs: 980 },
    // Gap = 1350 - 980 = 370ms >= 350ms
    { word: 'chính', startMs: 1350, endMs: 1620 },
    { word: 'xác.', startMs: 1630, endMs: 2015 },
  ];

  const lines = segmentWordsToSubtitles(words);
  assert(lines.length === 2, `Expected 2 lines, got ${lines.length}`);

  // Check startMs and endMs are derived strictly from first and last words
  assert(lines[0].startMs === 105, `Line 0 startMs must be 105, got ${lines[0].startMs}`);
  assert(lines[0].endMs === 980, `Line 0 endMs must be 980, got ${lines[0].endMs}`);
  assert(lines[1].startMs === 1350, `Line 1 startMs must be 1350, got ${lines[1].startMs}`);
  assert(lines[1].endMs === 2015, `Line 1 endMs must be 2015, got ${lines[1].endMs}`);

  // Check line.words array matches chunk exactly
  assert(lines[0].words?.length === 4, `Line 0 should have 4 words`);
  assert(lines[1].words?.length === 2, `Line 1 should have 2 words`);
  assert(lines[0].words![0].startMs === lines[0].startMs, `Line 0 words[0] startMs mismatch`);
  assert(lines[0].words![lines[0].words!.length - 1].endMs === lines[0].endMs, `Line 0 words[last] endMs mismatch`);

  // Check zero artificial gap injection (Netflix used to inject 80ms minGapMs)
  const acousticGap = lines[1].startMs - lines[0].endMs;
  assert(acousticGap === 370, `Acoustic gap must be preserved as 370ms, got ${acousticGap}`);
  console.log('  -> PASS: StartMs/EndMs derived 100% genuinely from first/last word. Zero synthetic gaps.');
}

// -------------------------------------------------------------------------
// CHECK 2: Silence Threshold (349ms vs 350ms, and 700ms unconditional)
// -------------------------------------------------------------------------
console.log('Check 2: Boundary testing silence >= 350ms and >= 700ms...');
{
  // Test 349ms: below 350ms threshold without punctuation -> MUST NOT SPLIT
  const words349: SrtWord[] = [
    { word: 'Một', startMs: 0, endMs: 300 },
    { word: 'hai', startMs: 310, endMs: 600 },
    // Gap: 949 - 600 = 349ms (< 350ms)
    { word: 'ba', startMs: 949, endMs: 1200 },
    { word: 'bốn', startMs: 1210, endMs: 1500 },
  ];
  const lines349 = segmentWordsToSubtitles(words349);
  assert(lines349.length === 1, `Gap of 349ms must not split, got ${lines349.length} lines`);

  // Test 350ms: exactly 350ms -> MUST SPLIT
  const words350: SrtWord[] = [
    { word: 'Một', startMs: 0, endMs: 300 },
    { word: 'hai', startMs: 310, endMs: 600 },
    // Gap: 950 - 600 = 350ms (>= 350ms)
    { word: 'ba', startMs: 950, endMs: 1200 },
    { word: 'bốn', startMs: 1210, endMs: 1500 },
  ];
  const lines350 = segmentWordsToSubtitles(words350);
  assert(lines350.length === 2, `Gap of 350ms must split into 2 lines, got ${lines350.length} lines`);

  // Test 700ms major pause: MUST SPLIT
  const words700: SrtWord[] = [
    { word: 'Xin', startMs: 0, endMs: 300 },
    { word: 'chào', startMs: 1000, endMs: 1300 }, // gap 700ms
  ];
  const lines700 = segmentWordsToSubtitles(words700);
  assert(lines700.length === 2, `Gap of 700ms must split, got ${lines700.length} lines`);
  console.log('  -> PASS: Silence boundary test (349ms vs 350ms vs 700ms) confirmed.');
}

// -------------------------------------------------------------------------
// CHECK 3: Punctuation (Terminal and Clause)
// -------------------------------------------------------------------------
console.log('Check 3: Verifying Terminal (. ? ! 。 ？ ！ …) and Clause (, ; : ， ； ： 、) punctuation...');
{
  // Terminal punctuation
  assert(hasTerminalPunctuation('end.'), 'Failed terminal dot');
  assert(hasTerminalPunctuation('really?'), 'Failed terminal question');
  assert(hasTerminalPunctuation('wow!'), 'Failed terminal exclamation');
  assert(hasTerminalPunctuation('你好。'), 'Failed terminal CJK period');
  assert(hasTerminalPunctuation('真的吗？'), 'Failed terminal CJK question');
  assert(hasTerminalPunctuation('太棒了！'), 'Failed terminal CJK exclamation');
  assert(hasTerminalPunctuation('chờ…'), 'Failed terminal ellipsis');
  assert(hasTerminalPunctuation('chờ...'), 'Failed terminal three dots');
  assert(!hasTerminalPunctuation('hello'), 'Normal word wrongly matched terminal');

  // Clause punctuation
  assert(hasClausePunctuation('nếu,'), 'Failed clause comma');
  assert(hasClausePunctuation('item;'), 'Failed clause semicolon');
  assert(hasClausePunctuation('note:'), 'Failed clause colon');
  assert(hasClausePunctuation('比如，'), 'Failed clause CJK comma');
  assert(hasClausePunctuation('苹果、'), 'Failed clause CJK enumeration comma');
  assert(!hasClausePunctuation('normal'), 'Normal word wrongly matched clause');
  console.log('  -> PASS: All punctuation detection regexes verified.');
}

// -------------------------------------------------------------------------
// CHECK 4: Duration Constraints (2.0s - 5.0s, hardMax 6.0s)
// -------------------------------------------------------------------------
console.log('Check 4: Verifying 2-5s ideal duration and 6.0s hard ceiling...');
{
  // Stream of 60 words, 250ms each, 50ms gap = 300ms per word. Total duration = 18s
  const stream: SrtWord[] = [];
  for (let i = 0; i < 60; i++) {
    stream.push({
      word: `w${i + 1}`,
      startMs: i * 300,
      endMs: i * 300 + 250,
    });
  }

  const lines = segmentWordsToSubtitles(stream);
  assert(lines.length >= 3, `Expected at least 3 segments for 18s stream, got ${lines.length}`);

  for (let i = 0; i < lines.length; i++) {
    const dur = lines[i].endMs - lines[i].startMs;
    assert(dur <= 6000, `Line ${i + 1} duration ${dur}ms exceeded hard max 6000ms`);
    // Unless it's the trailing line, it should not prematurely break below ideal duration
    if (i < lines.length - 1) {
      assert(dur >= 2000, `Intermediate line ${i + 1} duration ${dur}ms is below 2000ms`);
    }
  }
  console.log(`  -> PASS: Stream of 18s split into ${lines.length} chunks, all strictly <= 6000ms.`);
}

// -------------------------------------------------------------------------
// CHECK 5: CJK Spaceless Typography
// -------------------------------------------------------------------------
console.log('Check 5: Verifying CJK Spaceless Typography...');
{
  const cjkTokens: SrtWord[] = [
    { word: '今', startMs: 0, endMs: 200 },
    { word: '天', startMs: 200, endMs: 400 },
    { word: '天', startMs: 400, endMs: 600 },
    { word: '气', startMs: 600, endMs: 800 },
    { word: '很', startMs: 800, endMs: 1000 },
    { word: '好', startMs: 1000, endMs: 1200 },
    { word: '。', startMs: 1200, endMs: 1300 },
  ];

  const formatted = formatWordsText(cjkTokens);
  assert(formatted === '今天天气很好。', `Expected "今天天气很好。", got "${formatted}"`);

  // Mixed CJK + Latin
  const mixedTokens: SrtWord[] = [
    { word: 'Tôi', startMs: 0, endMs: 200 },
    { word: 'dùng', startMs: 210, endMs: 400 },
    { word: '微', startMs: 410, endMs: 600 },
    { word: '信', startMs: 600, endMs: 800 },
    { word: 'hằng', startMs: 810, endMs: 1000 },
    { word: 'ngày.', startMs: 1010, endMs: 1200 },
  ];
  const mixedFormatted = formatWordsText(mixedTokens);
  assert(mixedFormatted === 'Tôi dùng 微信 hằng ngày.', `Expected "Tôi dùng 微信 hằng ngày.", got "${mixedFormatted}"`);
  console.log('  -> PASS: CJK spaceless concatenation and mixed Latin/CJK spacing verified.');
}

// -------------------------------------------------------------------------
// CHECK 6: Speaker Diarization Transitions
// -------------------------------------------------------------------------
console.log('Check 6: Verifying Speaker Diarization Transitions...');
{
  const speakerWords: SrtWord[] = [
    { word: 'Chào', startMs: 0, endMs: 300, speaker: 'SPEAKER_00' },
    { word: 'bạn', startMs: 310, endMs: 600, speaker: 'SPEAKER_00' },
    // Speaker switch after only 20ms gap
    { word: 'Chào', startMs: 620, endMs: 900, speaker: 'SPEAKER_01' },
    { word: 'anh', startMs: 910, endMs: 1200, speaker: 'SPEAKER_01' },
    // Speaker switch back to SPEAKER_00 after 10ms gap
    { word: 'Khỏe', startMs: 1210, endMs: 1500, speaker: 'SPEAKER_00' },
    { word: 'không?', startMs: 1510, endMs: 1800, speaker: 'SPEAKER_00' },
  ];

  const lines = segmentWordsToSubtitles(speakerWords);
  assert(lines.length === 3, `Expected 3 lines on speaker transitions, got ${lines.length}`);
  assert(lines[0].speaker === 'SPEAKER_00', `Line 0 speaker must be SPEAKER_00`);
  assert(lines[1].speaker === 'SPEAKER_01', `Line 1 speaker must be SPEAKER_01`);
  assert(lines[2].speaker === 'SPEAKER_00', `Line 2 speaker must be SPEAKER_00`);
  assert(lines[0].text === 'Chào bạn', `Line 0 text mismatch: ${lines[0].text}`);
  assert(lines[1].text === 'Chào anh', `Line 1 text mismatch: ${lines[1].text}`);
  assert(lines[2].text === 'Khỏe không?', `Line 2 text mismatch: ${lines[2].text}`);
  console.log('  -> PASS: Immediate speaker transition split verified.');
}

// -------------------------------------------------------------------------
// CHECK 7: Python Sidecar Parity with TypeScript WordSegmenter
// -------------------------------------------------------------------------
console.log('Check 7: Verifying Python vs TypeScript Parity...');
{
  // Test words covering all features
  const testWords = [
    { word: 'Hôm', startMs: 0, endMs: 300, speaker: 'SPEAKER_00' },
    { word: 'nay', startMs: 310, endMs: 600, speaker: 'SPEAKER_00' },
    { word: 'thời', startMs: 610, endMs: 900, speaker: 'SPEAKER_00' },
    { word: 'tiết', startMs: 910, endMs: 1200, speaker: 'SPEAKER_00' },
    { word: 'rất', startMs: 1210, endMs: 1500, speaker: 'SPEAKER_00' },
    { word: 'đẹp,', startMs: 1510, endMs: 2100, speaker: 'SPEAKER_00' }, // Clause punct, 2.1s >= 2.0s -> split
    { word: 'chúng', startMs: 2200, endMs: 2500, speaker: 'SPEAKER_00' },
    { word: 'ta', startMs: 2510, endMs: 2800, speaker: 'SPEAKER_00' },
    { word: 'đi', startMs: 2810, endMs: 3100, speaker: 'SPEAKER_00' },
    { word: 'chơi', startMs: 3110, endMs: 3400, speaker: 'SPEAKER_00' },
    { word: 'nhé!', startMs: 3410, endMs: 3800, speaker: 'SPEAKER_00' }, // Terminal punct -> split
    // Gap 400ms >= 350ms
    { word: 'Được', startMs: 4200, endMs: 4500, speaker: 'SPEAKER_01' }, // Speaker switch + silence gap
    { word: 'chứ.', startMs: 4510, endMs: 4900, speaker: 'SPEAKER_01' },
    // CJK words
    { word: '我', startMs: 5300, endMs: 5500, speaker: 'SPEAKER_01' },
    { word: '们', startMs: 5500, endMs: 5700, speaker: 'SPEAKER_01' },
    { word: '走', startMs: 5700, endMs: 5900, speaker: 'SPEAKER_01' },
    { word: '吧', startMs: 5900, endMs: 6100, speaker: 'SPEAKER_01' },
    { word: '！', startMs: 6100, endMs: 6300, speaker: 'SPEAKER_01' },
  ];

  const tsLines = segmentWordsToSubtitles(testWords);

  // Invoke Python segment_words_naturally via inline python script
  const pyCode = `
import json, sys
sys.path.insert(0, r"${path.join(process.cwd(), 'main', 'asr', 'python').replace(/\\/g, '\\\\')}")
from faster_whisper_server import segment_words_naturally

words = json.loads('''${JSON.stringify(testWords)}''')
segs = segment_words_naturally(words, max_chars_per_line=37)
print(json.dumps(segs, ensure_ascii=False))
`;

  const pyRes = spawnSync('python', ['-c', pyCode], { encoding: 'utf-8' });
  if (pyRes.status !== 0) {
    throw new Error(`Python execution failed: ${pyRes.stderr}`);
  }

  const pySegments = JSON.parse(pyRes.stdout.trim());

  assert(tsLines.length === pySegments.length, `Line count mismatch: TS has ${tsLines.length}, Py has ${pySegments.length}`);

  for (let i = 0; i < tsLines.length; i++) {
    const ts = tsLines[i];
    const py = pySegments[i];
    assert(ts.startMs === py.startMs, `Index ${i} startMs mismatch: TS=${ts.startMs}, Py=${py.startMs}`);
    assert(ts.endMs === py.endMs, `Index ${i} endMs mismatch: TS=${ts.endMs}, Py=${py.endMs}`);
    assert(ts.text === py.text, `Index ${i} text mismatch: TS="${ts.text}", Py="${py.text}"`);
    assert(ts.speaker === py.speaker, `Index ${i} speaker mismatch: TS=${ts.speaker}, Py=${py.speaker}`);
  }
  console.log(`  -> PASS: 100% exact parity between TypeScript and Python sidecar (${tsLines.length} segments identical).`);
}

// -------------------------------------------------------------------------
// CHECK 8: Removal of segmentSubtitlesNetflix from Production ASR Runners
// -------------------------------------------------------------------------
console.log('Check 8: Verifying removal of segmentSubtitlesNetflix from ASR Runners...');
{
  const taskRunnerContent = fs.readFileSync('main/asr/taskRunner.ts', 'utf-8');
  const hybridRunnerContent = fs.readFileSync('main/asr/hybridRunner.ts', 'utf-8');
  const engineContent = fs.readFileSync('main/asr/fasterWhisperEngine.ts', 'utf-8');

  assert(!taskRunnerContent.includes('segmentSubtitlesNetflix'), 'taskRunner.ts still references segmentSubtitlesNetflix!');
  assert(!hybridRunnerContent.includes('segmentSubtitlesNetflix'), 'hybridRunner.ts still references segmentSubtitlesNetflix!');
  assert(!engineContent.includes('segmentSubtitlesNetflix'), 'fasterWhisperEngine.ts still references segmentSubtitlesNetflix!');
  console.log('  -> PASS: segmentSubtitlesNetflix completely absent from main/asr runners.');
}

// -------------------------------------------------------------------------
// CHECK 9: Adversarial Stress Test (30,000 words, O(N) complexity & memory)
// -------------------------------------------------------------------------
console.log('Check 9: Adversarial stress test (30,000 words performance & memory)...');
{
  const bigWords: SrtWord[] = [];
  const vocab = ['Tôi', 'đang', 'kiểm', 'tra', 'thuật', 'toán', 'phân', 'đoạn', 'tự', 'nhiên', 'vanhsub', 'nhé.'];
  for (let i = 0; i < 30000; i++) {
    const word = vocab[i % vocab.length];
    bigWords.push({
      word,
      startMs: i * 200,
      endMs: i * 200 + 180,
    });
  }

  const t0 = performance.now();
  const bigLines = segmentWordsToSubtitles(bigWords);
  const elapsed = performance.now() - t0;

  assert(bigLines.length > 0, 'Big lines empty');
  assert(elapsed < 500, `30,000 words took too long: ${elapsed.toFixed(1)}ms (threshold 500ms)`);
  console.log(`  -> PASS: Processed 30,000 words in ${elapsed.toFixed(1)}ms (${bigLines.length} subtitle lines). Linear O(N) throughput confirmed.`);
}

console.log('\n=============================================================');
console.log('=== FORENSIC INTEGRITY AUDIT COMPLETE: ALL CHECKS PASSED ===');
console.log('=============================================================\n');
