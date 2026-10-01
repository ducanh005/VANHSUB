import {
  segmentWordsToSubtitles,
  formatWordsText,
  wrapVisualLines,
  isCjkText,
  isCjkChar,
  type SrtWord,
  type SrtLine,
} from '../main/asr/wordSegmenter';

interface TestResult {
  category: string;
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(category: string, name: string, fn: () => void) {
  try {
    fn();
    results.push({ category, name, passed: true });
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    results.push({ category, name, passed: false, error: err.message });
    console.error(`  [FAIL] ${name}\n         Error: ${err.message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

console.log('================================================================');
console.log('CHALLENGER M1 ROUND 2 EMPIRICAL ADVERSARIAL VERIFICATION SUITE');
console.log('Target: main/asr/wordSegmenter.ts');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// 1. Invariant: line.endMs === words[last].endMs
// -----------------------------------------------------------------------------
console.log('>>> 1. INVARIANT AUDIT: line.endMs === words[last].endMs <<<');

test('Invariant', '1.1 Micro-duration word (1ms) preserves line.endMs === words[last].endMs', () => {
  const words: SrtWord[] = [{ word: 'Ê!', startMs: 500, endMs: 501 }];
  const lines = segmentWordsToSubtitles(words);
  assert(lines.length === 1, `Expected 1 line, got ${lines.length}`);
  const lastWord = lines[0].words[lines[0].words.length - 1];
  assert(
    lines[0].endMs === lastWord.endMs,
    `Contract broken: line.endMs (${lines[0].endMs}) !== lastWord.endMs (${lastWord.endMs})`
  );
  assert(lines[0].endMs >= 501, `line.endMs should be at least 501ms`);
});

test('Invariant', '1.2 Zero-duration word (startMs === endMs) preserves invariant', () => {
  const words: SrtWord[] = [{ word: 'Ơ!', startMs: 2000, endMs: 2000 }];
  const lines = segmentWordsToSubtitles(words);
  assert(lines.length === 1, `Expected 1 line, got ${lines.length}`);
  const lastWord = lines[0].words[lines[0].words.length - 1];
  assert(
    lines[0].endMs === lastWord.endMs,
    `Contract broken: line.endMs (${lines[0].endMs}) !== lastWord.endMs (${lastWord.endMs})`
  );
});

test('Invariant', '1.3 Negative duration word (endMs < startMs) normalized and invariant holds', () => {
  const words: SrtWord[] = [{ word: 'Lỗi', startMs: 3000, endMs: 2500 }];
  const lines = segmentWordsToSubtitles(words);
  assert(lines.length === 1, `Expected 1 line, got ${lines.length}`);
  const lastWord = lines[0].words[lines[0].words.length - 1];
  assert(
    lines[0].endMs === lastWord.endMs,
    `Contract broken: line.endMs (${lines[0].endMs}) !== lastWord.endMs (${lastWord.endMs})`
  );
  assert(lines[0].startMs === 3000, `startMs must be 3000`);
  assert(lines[0].endMs >= 3000, `endMs must be >= 3000`);
});

test('Invariant', '1.4 Multi-word chunk invariant check across 500 generated randomized words', () => {
  const words: SrtWord[] = [];
  let curTime = 1000;
  for (let i = 0; i < 500; i++) {
    const dur = Math.floor(Math.random() * 200) + 1; // 1ms to 200ms
    const pause = Math.random() < 0.2 ? Math.floor(Math.random() * 500) + 350 : Math.floor(Math.random() * 50);
    const startMs = curTime;
    const endMs = startMs + dur;
    words.push({
      word: `w${i}${i % 7 === 0 ? '.' : ''}`,
      startMs,
      endMs,
      speaker: i % 25 === 0 ? `SPK_${Math.floor(i / 25)}` : undefined,
    });
    curTime = endMs + pause;
  }

  const lines = segmentWordsToSubtitles(words);
  assert(lines.length > 0, 'Must produce lines');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    assert(line.words.length > 0, `Line ${i} must have words`);
    const lastWord = line.words[line.words.length - 1];
    assert(
      line.endMs === lastWord.endMs,
      `Invariant violation on line ${i}: line.endMs (${line.endMs}) !== lastWord.endMs (${lastWord.endMs})`
    );
    assert(
      line.startMs === line.words[0].startMs,
      `Invariant violation on line ${i}: line.startMs (${line.startMs}) !== firstWord.startMs (${line.words[0].startMs})`
    );
    if (i > 0) {
      assert(
        lines[i - 1].endMs <= line.startMs,
        `Overlap collision between line ${i - 1} endMs (${lines[i - 1].endMs}) and line ${i} startMs (${line.startMs})`
      );
    }
  }
});

// -----------------------------------------------------------------------------
// 2. Speaker Transitions Without Subtitle Overlaps
// -----------------------------------------------------------------------------
console.log('\n>>> 2. SPEAKER TRANSITION & OVERLAP COLLISION AUDIT <<<');

test('Speaker Transition', '2.1 Rapid speaker change after short interjection does NOT overlap', () => {
  const words: SrtWord[] = [
    { word: 'Ơ!', startMs: 1000, endMs: 1010, speaker: 'SPEAKER_00' },
    { word: 'Gì', startMs: 1020, endMs: 1100, speaker: 'SPEAKER_01' },
    { word: 'đấy?', startMs: 1105, endMs: 1200, speaker: 'SPEAKER_01' },
  ];
  const lines = segmentWordsToSubtitles(words);
  assert(lines.length === 2, `Expected 2 lines for 2 speakers, got ${lines.length}`);
  assert(
    lines[0].endMs <= lines[1].startMs,
    `Overlap bug: Line 0 endMs (${lines[0].endMs}) > Line 1 startMs (${lines[1].startMs})`
  );
  assert(
    lines[0].endMs === lines[0].words[lines[0].words.length - 1].endMs,
    `Contract broken: line[0].endMs (${lines[0].endMs}) !== lastWord.endMs (${lines[0].words[lines[0].words.length - 1].endMs})`
  );
});

test('Speaker Transition', '2.2 Abutting speaker transition (gap = 0ms) preserves boundary with zero overlap', () => {
  const words: SrtWord[] = [
    { word: 'Được', startMs: 1000, endMs: 1050, speaker: 'SPEAKER_00' },
    { word: 'rồi', startMs: 1050, endMs: 1100, speaker: 'SPEAKER_01' },
  ];
  const lines = segmentWordsToSubtitles(words);
  assert(lines.length === 2, `Expected 2 lines, got ${lines.length}`);
  assert(
    lines[0].endMs <= lines[1].startMs,
    `Overlap bug: Line 0 endMs (${lines[0].endMs}) > Line 1 startMs (${lines[1].startMs})`
  );
  assert(lines[0].endMs === 1050, `Line 0 endMs expected 1050, got ${lines[0].endMs}`);
  assert(lines[1].startMs === 1050, `Line 1 startMs expected 1050, got ${lines[1].startMs}`);
});

test('Speaker Transition', '2.3 Multi-speaker rapid-fire cascade with sub-20ms spacing', () => {
  const words: SrtWord[] = [
    { word: 'A', startMs: 1000, endMs: 1010, speaker: 'SPK_A' },
    { word: 'B', startMs: 1015, endMs: 1025, speaker: 'SPK_B' },
    { word: 'C', startMs: 1030, endMs: 1040, speaker: 'SPK_C' },
    { word: 'D', startMs: 1045, endMs: 1055, speaker: 'SPK_D' },
  ];
  const lines = segmentWordsToSubtitles(words);
  assert(lines.length === 4, `Expected 4 lines for 4 speakers, got ${lines.length}`);
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    assert(cur.words.length === 1, `Line ${i} should have 1 word`);
    assert(
      cur.endMs === cur.words[0].endMs,
      `Line ${i} invariant violation: line.endMs (${cur.endMs}) !== word.endMs (${cur.words[0].endMs})`
    );
    if (i < lines.length - 1) {
      assert(
        cur.endMs <= lines[i + 1].startMs,
        `Overlap between line ${i} endMs (${cur.endMs}) and line ${i + 1} startMs (${lines[i + 1].startMs})`
      );
    }
  }
});

// -----------------------------------------------------------------------------
// 3. Mixed CJK + Latin Sentence Wrapping
// -----------------------------------------------------------------------------
console.log('\n>>> 3. MIXED CJK & LATIN WORD-WRAPPING AUDIT <<<');

test('Visual Wrap', '3.1 Mixed CJK + Latin sentence does not slice English words', () => {
  const sentence = 'We are testing word segmentation with 你 here today';
  const wrapped = wrapVisualLines(sentence, 37);
  const lines = wrapped.split('\n');
  assert(lines.length === 2, `Expected 2 lines, got ${lines.length}: ${JSON.stringify(lines)}`);
  for (const l of lines) {
    assert(l.length <= 37, `Line exceeds 37 chars: "${l}" (len=${l.length})`);
  }
  assert(!wrapped.includes('segme\nntation'), `Word segmentation was sliced across newline: "${wrapped}"`);
  assert(wrapped.includes('segmentation'), `Full word segmentation must be intact`);
});

test('Visual Wrap', '3.2 Long Vietnamese + English + CJK mixed string wraps cleanly at spaces', () => {
  const text = 'Hệ thống AI xử lý Faster-Whisper và 中文模型 tự động nhận diện giọng nói rất chuẩn xác';
  const wrapped = wrapVisualLines(text, 37);
  const lines = wrapped.split('\n');
  for (const l of lines) {
    assert(l.length <= 37, `Line exceeds 37 chars: "${l}" (len=${l.length})`);
    assert(!l.startsWith(' '), 'Line must not have leading space');
    assert(!l.endsWith(' '), 'Line must not have trailing space');
  }
  assert(wrapped.includes('Faster-Whisper'), 'Faster-Whisper must not be broken');
});

test('Visual Wrap', '3.3 Pure CJK string without spaces wraps by character/punctuation <= 37 chars', () => {
  const cjkText = '这是一个完全没有空格的超长中文字符串用于测试在没有空格的情况下是否能够正确地根据标点符号或者字数进行折行';
  const wrapped = wrapVisualLines(cjkText, 37);
  const lines = wrapped.split('\n');
  assert(lines.length >= 2, `Expected multiple lines, got ${lines.length}`);
  for (const l of lines) {
    assert(l.length <= 37, `Pure CJK line exceeds 37 chars: "${l}" (len=${l.length})`);
  }
});

test('Visual Wrap', '3.4 Single long word exceeding maxCharsPerLine does not crash or infinite loop', () => {
  const superLongWord = 'SupercalifragilisticexpialidociousAntidisestablishmentarianismExtra';
  const wrapped = wrapVisualLines(superLongWord, 37);
  assert(typeof wrapped === 'string' && wrapped.length > 0, 'Must return valid string');
});

// -----------------------------------------------------------------------------
// 4. Overlapping Words Within a Chunk
// -----------------------------------------------------------------------------
console.log('\n>>> 4. OVERLAPPING WORDS WITHIN CHUNK AUDIT <<<');

test('Overlapping Words', '4.1 Earlier word ending after later word expands chunk endMs to max', () => {
  // Word 0: [1000 - 2000], Word 1: [1200 - 1500]
  const words: SrtWord[] = [
    { word: 'Thứ', startMs: 1000, endMs: 2000 },
    { word: 'nhất', startMs: 1200, endMs: 1500 },
  ];
  const lines = segmentWordsToSubtitles(words);
  assert(lines.length === 1, `Expected 1 line, got ${lines.length}`);
  assert(lines[0].startMs === 1000, `Expected startMs 1000, got ${lines[0].startMs}`);
  assert(lines[0].endMs === 2000, `Expected endMs 2000 (max of chunk), got ${lines[0].endMs}`);
  const lastWord = lines[0].words[lines[0].words.length - 1];
  assert(
    lines[0].endMs === lastWord.endMs,
    `line.endMs (${lines[0].endMs}) must equal lastWord.endMs (${lastWord.endMs})`
  );
});

test('Overlapping Words', '4.2 Outer word enclosing multiple inner words', () => {
  // Word 0 spans [1000 - 3000], Word 1: [1100 - 1800], Word 2: [1900 - 2500]
  const words: SrtWord[] = [
    { word: 'Tổng', startMs: 1000, endMs: 3000 },
    { word: 'thể', startMs: 1100, endMs: 1800 },
    { word: 'lớn', startMs: 1900, endMs: 2500 },
  ];
  const lines = segmentWordsToSubtitles(words);
  assert(lines.length === 1, `Expected 1 line, got ${lines.length}`);
  assert(lines[0].endMs === 3000, `Chunk endMs must be 3000, got ${lines[0].endMs}`);
  assert(lines[0].words[2].endMs === 3000, `Last word endMs must be synchronized to 3000`);
});

// -----------------------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log('CHALLENGER M1 ROUND 2 TEST SUMMARY');
console.log('================================================================');
const total = results.length;
const passed = results.filter((r) => r.passed).length;
const failed = total - passed;
console.log(`Total Tests Run: ${total}`);
console.log(`Passed:          ${passed} (${Math.round((passed / total) * 100)}%)`);
console.log(`Failed:          ${failed} (${Math.round((failed / total) * 100)}%)`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n>>> ALL CHALLENGER R2 EMPIRICAL TESTS PASSED! <<<');
  process.exit(0);
}
