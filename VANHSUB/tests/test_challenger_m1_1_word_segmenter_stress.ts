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

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function recordTest(category: string, name: string, fn: () => void) {
  try {
    fn();
    results.push({ category, name, passed: true });
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    results.push({ category, name, passed: false, error: err.message, details: err.stack });
    console.error(`  [FAIL] ${name}\n         Error: ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(msg);
  }
}

function runEmpiricalStressSuite() {
  console.log('================================================================');
  console.log('EMPIRICAL ADVERSARIAL STRESS TEST SUITE — CHALLENGER M1-1');
  console.log('Target: main/asr/wordSegmenter.ts (segmentWordsToSubtitles)');
  console.log('================================================================\n');

  // ===========================================================================
  // CATEGORY 1: SILENCE BOUNDARIES (349ms vs 350ms, 699ms vs 700ms, Rapid Fire)
  // ===========================================================================
  console.log('>>> CATEGORY 1: SILENCE BOUNDARIES <<<');

  recordTest('Silence Boundaries', '1.1 Boundary 349ms vs 350ms: 349ms does NOT split short phrase', () => {
    // 2 words, duration 800ms (< 1500ms, < 4 words, no punctuation)
    // pause = 349ms
    const words: SrtWord[] = [
      { word: 'Xin', startMs: 1000, endMs: 1400 },
      { word: 'chào', startMs: 1749, endMs: 2149 },
    ];
    const lines = segmentWordsToSubtitles(words);
    assert(lines.length === 1, `Expected 1 line for 349ms pause, got ${lines.length}`);
    assert(lines[0].text === 'Xin chào', `Unexpected text: ${lines[0].text}`);
  });

  recordTest('Silence Boundaries', '1.2 Boundary 349ms vs 350ms: 350ms DOES split short phrase', () => {
    // Exactly 350ms pause
    const words: SrtWord[] = [
      { word: 'Xin', startMs: 1000, endMs: 1400 },
      { word: 'chào', startMs: 1750, endMs: 2150 },
    ];
    const lines = segmentWordsToSubtitles(words);
    assert(lines.length === 2, `Expected 2 lines for 350ms pause, got ${lines.length}`);
    assert(lines[0].text === 'Xin', `Line 0 text: ${lines[0].text}`);
    assert(lines[1].text === 'chào', `Line 1 text: ${lines[1].text}`);
  });

  recordTest('Silence Boundaries', '1.3 Boundary around 350ms (348ms vs 351ms)', () => {
    const words348: SrtWord[] = [
      { word: 'Một', startMs: 0, endMs: 500 },
      { word: 'hai', startMs: 848, endMs: 1200 },
    ];
    const lines348 = segmentWordsToSubtitles(words348);
    assert(lines348.length === 1, `348ms pause should not split, got ${lines348.length}`);

    const words351: SrtWord[] = [
      { word: 'Một', startMs: 0, endMs: 500 },
      { word: 'hai', startMs: 851, endMs: 1200 },
    ];
    const lines351 = segmentWordsToSubtitles(words351);
    assert(lines351.length === 2, `351ms pause should split, got ${lines351.length}`);
  });

  recordTest('Silence Boundaries', '1.4 Boundary 699ms vs 700ms under default options', () => {
    // Under default options (minPauseMs = 350), both 699ms and 700ms must split
    const words699: SrtWord[] = [
      { word: 'Ba', startMs: 0, endMs: 400 },
      { word: 'bốn', startMs: 1099, endMs: 1500 }, // pause = 699ms
    ];
    const lines699 = segmentWordsToSubtitles(words699);
    assert(lines699.length === 2, `699ms pause must split under default options, got ${lines699.length}`);

    const words700: SrtWord[] = [
      { word: 'Ba', startMs: 0, endMs: 400 },
      { word: 'bốn', startMs: 1100, endMs: 1500 }, // pause = 700ms
    ];
    const lines700 = segmentWordsToSubtitles(words700);
    assert(lines700.length === 2, `700ms pause must split under default options, got ${lines700.length}`);
  });

  recordTest('Silence Boundaries', '1.5 Boundary 699ms vs 700ms with custom minPauseMs=700', () => {
    // When custom minPauseMs is 700ms:
    const words699: SrtWord[] = [
      { word: 'Năm', startMs: 0, endMs: 400 },
      { word: 'sáu', startMs: 1099, endMs: 1500 }, // pause = 699ms
    ];
    const lines699 = segmentWordsToSubtitles(words699, { minPauseMs: 700 });
    assert(lines699.length === 1, `699ms should NOT split when minPauseMs=700, got ${lines699.length}`);

    const words700: SrtWord[] = [
      { word: 'Năm', startMs: 0, endMs: 400 },
      { word: 'sáu', startMs: 1100, endMs: 1500 }, // pause = 700ms
    ];
    const lines700 = segmentWordsToSubtitles(words700, { minPauseMs: 700 });
    assert(lines700.length === 2, `700ms SHOULD split when minPauseMs=700, got ${lines700.length}`);
  });

  recordTest('Silence Boundaries', '1.6 Rapid fire words with sub-10ms pauses', () => {
    // 30 words spoken with 5ms pauses, each word 80ms (total ~2550ms)
    const words: SrtWord[] = [];
    let cur = 1000;
    for (let i = 0; i < 30; i++) {
      words.push({
        word: `w${i}`,
        startMs: cur,
        endMs: cur + 80,
      });
      cur += 85;
    }
    const lines = segmentWordsToSubtitles(words);
    assert(lines.length >= 1, 'Should produce at least 1 line');
    // Total duration is ~2550ms, ideal duration is 2-5s, so it should fit nicely in 1 line
    assert(lines.length === 1, `2550ms rapid fire should remain 1 natural segment, got ${lines.length}`);
  });

  // ===========================================================================
  // CATEGORY 2: LONG MONOLOGUES & HARD CEILING <= 6.0s (6000ms)
  // ===========================================================================
  console.log('\n>>> CATEGORY 2: LONG MONOLOGUES & HARD CEILING <= 6.0s <<<');

  recordTest('Long Monologues', '2.1 100 continuous words (no punctuation, 150ms/word, 20ms pause)', () => {
    // 100 words * 170ms = 17,000ms (~17 seconds)
    const words: SrtWord[] = [];
    let cur = 0;
    for (let i = 0; i < 100; i++) {
      words.push({
        word: `word${i}`,
        startMs: cur,
        endMs: cur + 150,
      });
      cur += 170;
    }

    const lines = segmentWordsToSubtitles(words);

    // Assert every segment obeys hard ceiling <= 6000ms
    for (let i = 0; i < lines.length; i++) {
      const dur = lines[i].endMs - lines[i].startMs;
      assert(dur <= 6000, `Segment ${i} duration ${dur}ms exceeded hard ceiling 6000ms!`);
    }

    // Assert all 100 words are present and in order
    const allEmittedWords = lines.flatMap((l) => l.words || []);
    assert(allEmittedWords.length === 100, `Word count mismatch: expected 100 words, got ${allEmittedWords.length}`);
    for (let i = 0; i < 100; i++) {
      assert(allEmittedWords[i].word === `word${i}`, `Word ${i} corrupted: ${allEmittedWords[i].word}`);
    }
  });

  recordTest('Long Monologues', '2.2 100 rapid continuous words (50ms/word, 5ms pause, 5.5s total)', () => {
    // 100 words * 55ms = 5500ms
    const words: SrtWord[] = [];
    let cur = 0;
    for (let i = 0; i < 100; i++) {
      words.push({
        word: `rap${i}`,
        startMs: cur,
        endMs: cur + 50,
      });
      cur += 55;
    }
    const lines = segmentWordsToSubtitles(words);
    for (let i = 0; i < lines.length; i++) {
      const dur = lines[i].endMs - lines[i].startMs;
      assert(dur <= 6000, `Segment ${i} duration ${dur}ms exceeded 6000ms`);
    }
    const emitted = lines.flatMap((l) => l.words || []);
    assert(emitted.length === 100, `Expected 100 words, got ${emitted.length}`);
  });

  recordTest('Long Monologues', '2.3 250 words randomized durations & pauses (stress run)', () => {
    // 250 words with pseudo-random lengths 50-350ms, pauses 5-300ms
    const words: SrtWord[] = [];
    let cur = 500;
    for (let i = 0; i < 250; i++) {
      const wordDur = 50 + ((i * 37) % 300); // 50 to 350
      const pause = 5 + ((i * 17) % 250);   // 5 to 255 (all < 350ms, so no pause splits)
      words.push({
        word: `tok${i}`,
        startMs: cur,
        endMs: cur + wordDur,
      });
      cur += wordDur + pause;
    }
    const lines = segmentWordsToSubtitles(words);
    for (let i = 0; i < lines.length; i++) {
      const dur = lines[i].endMs - lines[i].startMs;
      assert(dur <= 6000, `Segment ${i} duration ${dur}ms breached 6000ms`);
    }
    const emitted = lines.flatMap((l) => l.words || []);
    assert(emitted.length === 250, `Expected 250 words, got ${emitted.length}`);
  });

  recordTest('Long Monologues', '2.4 Word right at 6000ms boundary does not push segment over 6000ms', () => {
    // Word 0: 0 - 4800 (dur 4800)
    // Word 1: 4850 - 6100 (projectedDur = 6100 > 6000)
    const words: SrtWord[] = [
      { word: 'Đầu', startMs: 0, endMs: 4800 },
      { word: 'tiếp', startMs: 4850, endMs: 6100 },
    ];
    const lines = segmentWordsToSubtitles(words);
    assert(lines.length === 2, `Projected duration 6100ms > 6000ms must split into 2 lines, got ${lines.length}`);
    assert(lines[0].endMs - lines[0].startMs <= 6000, `Line 0 breached 6000ms: ${lines[0].endMs - lines[0].startMs}ms`);
    assert(lines[1].endMs - lines[1].startMs <= 6000, `Line 1 breached 6000ms: ${lines[1].endMs - lines[1].startMs}ms`);
  });

  // ===========================================================================
  // CATEGORY 3: MIXED CJK AND LATIN, FULL-WIDTH VS HALF-WIDTH PUNCTUATION
  // ===========================================================================
  console.log('\n>>> CATEGORY 3: MIXED CJK & LATIN WORDS, PUNCTUATION <<<');

  recordTest('Mixed CJK & Latin', '3.1 Spacing rules: Latin-Latin has space, CJK-CJK spaceless, Latin-CJK has space', () => {
    const words: SrtWord[] = [
      { word: 'Hello', startMs: 0, endMs: 200 },
      { word: 'world', startMs: 210, endMs: 400 },
      { word: '你', startMs: 410, endMs: 600 },
      { word: '好', startMs: 610, endMs: 800 },
      { word: 'VANHSUB', startMs: 810, endMs: 1200 },
    ];
    const text = formatWordsText(words);
    assert(text === 'Hello world 你好 VANHSUB', `Unexpected joined text: "${text}"`);
  });

  recordTest('Mixed CJK & Latin', '3.2 Full-width punctuation attach without spaces', () => {
    const words: SrtWord[] = [
      { word: 'Chào', startMs: 0, endMs: 200 },
      { word: 'bạn', startMs: 210, endMs: 400 },
      { word: '，', startMs: 410, endMs: 500 },
      { word: 'hôm', startMs: 510, endMs: 700 },
      { word: 'nay', startMs: 710, endMs: 900 },
      { word: '。', startMs: 910, endMs: 1000 },
    ];
    const text = formatWordsText(words);
    assert(text === 'Chào bạn， hôm nay。', `Unexpected full-width punct formatting: "${text}"`);
  });

  recordTest('Mixed CJK & Latin', '3.3 Mixed punctuation: half-width and full-width terminal punctuation triggers', () => {
    // Latin terminal: '.'
    assert(hasTerminalPunctuation('end.'), 'Latin . should be terminal');
    assert(hasTerminalPunctuation('what?'), 'Latin ? should be terminal');
    assert(hasTerminalPunctuation('wow!'), 'Latin ! should be terminal');
    assert(hasTerminalPunctuation('waiting...'), 'Latin ... should be terminal');

    // CJK terminal: '。', '？', '！', '…'
    assert(hasTerminalPunctuation('结束。'), 'CJK 。 should be terminal');
    assert(hasTerminalPunctuation('什么？'), 'CJK ？ should be terminal');
    assert(hasTerminalPunctuation('太棒了！'), 'CJK ！ should be terminal');
    assert(hasTerminalPunctuation('等等…'), 'CJK … should be terminal');

    // Clause punctuation
    assert(hasClausePunctuation('stop,'), 'Latin , should be clause');
    assert(hasClausePunctuation('stop;'), 'Latin ; should be clause');
    assert(hasClausePunctuation('stop:'), 'Latin : should be clause');
    assert(hasClausePunctuation('你好，'), 'CJK ， should be clause');
    assert(hasClausePunctuation('你好；'), 'CJK ； should be clause');
    assert(hasClausePunctuation('你好：'), 'CJK ： should be clause');
    assert(hasClausePunctuation('你好、'), 'CJK 、 should be clause');
  });

  recordTest('Mixed CJK & Latin', '3.4 Clause punctuation split threshold in CJK vs Latin', () => {
    // Latin requires 6 words or 2000ms duration
    const latinWordsShort: SrtWord[] = [
      { word: 'If', startMs: 0, endMs: 200 },
      { word: 'so,', startMs: 220, endMs: 400 }, // only 2 words and 400ms -> should not split clause yet
      { word: 'we', startMs: 420, endMs: 600 },
      { word: 'go.', startMs: 620, endMs: 900 },
    ];
    const latinLines = segmentWordsToSubtitles(latinWordsShort);
    assert(latinLines.length === 1, `Short Latin clause (<2000ms, <6 words) should not split prematurely, got ${latinLines.length}`);

    // CJK requires 12 chars or 2000ms duration
    const cjkWordsShort: SrtWord[] = [
      { word: '如', startMs: 0, endMs: 200 },
      { word: '果，', startMs: 220, endMs: 400 }, // only 2 chars and 400ms
      { word: '我', startMs: 420, endMs: 600 },
      { word: '们', startMs: 620, endMs: 800 },
      { word: '走。', startMs: 820, endMs: 1000 },
    ];
    const cjkLines = segmentWordsToSubtitles(cjkWordsShort);
    assert(cjkLines.length === 1, `Short CJK clause (<2000ms, <12 chars) should not split prematurely, got ${cjkLines.length}`);
  });

  // ===========================================================================
  // CATEGORY 4: EXTREME TIMESTAMPS, ZERO DURATION, OVERLAPPING WORDS
  // ===========================================================================
  console.log('\n>>> CATEGORY 4: EXTREME TIMESTAMPS, ZERO DURATION, OVERLAPPING <<<');

  recordTest('Extreme Timestamps', '4.1 Zero-duration words (startMs === endMs)', () => {
    const zeroWords: SrtWord[] = [
      { word: 'Zero', startMs: 1000, endMs: 1000 },
      { word: 'duration', startMs: 1050, endMs: 1050 },
    ];
    const lines = segmentWordsToSubtitles(zeroWords);
    assert(lines.length === 1, `Zero duration words should form 1 valid line, got ${lines.length}`);
    assert(lines[0].endMs > lines[0].startMs, `Line endMs (${lines[0].endMs}) must be > startMs (${lines[0].startMs})`);
  });

  recordTest('Extreme Timestamps', '4.2 Negative and zero timestamps', () => {
    const negWords: SrtWord[] = [
      { word: 'Negative', startMs: -500, endMs: -100 },
      { word: 'test', startMs: 0, endMs: 300 },
    ];
    const lines = segmentWordsToSubtitles(negWords);
    assert(lines.length === 1, 'Should handle negative timestamps safely');
    assert(lines[0].startMs >= 0, `startMs must be clamped to >= 0, got ${lines[0].startMs}`);
  });

  recordTest('Extreme Timestamps', '4.3 Huge timestamps (hours into long recording)', () => {
    const hugeWords: SrtWord[] = [
      { word: 'Hour', startMs: 10_000_000, endMs: 10_000_300 },
      { word: 'two', startMs: 10_000_350, endMs: 10_000_700 },
    ];
    const lines = segmentWordsToSubtitles(hugeWords);
    assert(lines.length === 1, 'Huge timestamps should not overflow');
    assert(lines[0].startMs === 10_000_000, `startMs mismatch: ${lines[0].startMs}`);
    assert(lines[0].endMs === 10_000_700, `endMs mismatch: ${lines[0].endMs}`);
  });

  recordTest('Extreme Timestamps', '4.4 Out-of-order words (unsorted startMs)', () => {
    const unsortedWords: SrtWord[] = [
      { word: 'Second', startMs: 2000, endMs: 2500 },
      { word: 'First', startMs: 1000, endMs: 1500 },
    ];
    const lines = segmentWordsToSubtitles(unsortedWords);
    assert(lines.length === 2, `Out of order words with 500ms pause should split into 2 lines, got ${lines.length}`);
    assert(lines[0].startMs === 1000, `First line startMs must be 1000, got ${lines[0].startMs}`);
    assert(lines[1].startMs === 2000, `Second line startMs must be 2000, got ${lines[1].startMs}`);
    assert(lines[0].text === 'First', `First line text should be 'First', got '${lines[0].text}'`);
    assert(lines[1].text === 'Second', `Second line text should be 'Second', got '${lines[1].text}'`);
  });

  recordTest('Extreme Timestamps', '4.5 Overlapping words (word B ends before word A)', () => {
    const overlapping: SrtWord[] = [
      { word: 'Lồng', startMs: 1000, endMs: 1600 },
      { word: 'tiếng', startMs: 1200, endMs: 1400 },
    ];
    const lines = segmentWordsToSubtitles(overlapping);
    assert(lines.length === 1, `Overlapping words should be merged into 1 line, got ${lines.length}`);
    // Note: check whether line covers until 1600 or gets truncated to 1400
    console.log(`      [OBSERVATION] Overlapping: line.startMs=${lines[0].startMs}, line.endMs=${lines[0].endMs}, words[0].endMs=1600, words[1].endMs=1400`);
  });

  // ===========================================================================
  // CATEGORY 5: INVARIANT CHECKS (ZERO ARTIFICIAL GAPS & EXACT TIMECODES)
  // ===========================================================================
  console.log('\n>>> CATEGORY 5: INVARIANT CHECKS (ZERO ARTIFICIAL GAPS) <<<');

  recordTest('Invariant Checks', '5.1 Invariant: startMs === words[0].startMs on all produced lines', () => {
    const testCases: SrtWord[][] = [
      [
        { word: 'A', startMs: 100, endMs: 400 },
        { word: 'B', startMs: 450, endMs: 800 },
      ],
      [
        { word: 'Single', startMs: 2500, endMs: 3000 },
      ],
      [
        { word: 'One', startMs: 50, endMs: 100 },
        { word: 'Two', startMs: 500, endMs: 800 }, // pause 400ms -> 2 lines
      ],
    ];

    for (const words of testCases) {
      const lines = segmentWordsToSubtitles(words);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        assert(line.words !== undefined && line.words.length > 0, `Line ${i} has empty words array`);
        assert(
          line.startMs === line.words[0].startMs,
          `Line ${i} startMs (${line.startMs}) !== words[0].startMs (${line.words[0].startMs})`
        );
      }
    }
  });

  recordTest('Invariant Checks', '5.2 Invariant: endMs === words[last].endMs on normal-duration words', () => {
    const words: SrtWord[] = [
      { word: 'Hôm', startMs: 100, endMs: 400 },
      { word: 'nay', startMs: 420, endMs: 750 },
      // pause 500ms
      { word: 'trời', startMs: 1250, endMs: 1600 },
      { word: 'mát.', startMs: 1620, endMs: 1950 },
    ];
    const lines = segmentWordsToSubtitles(words);
    assert(lines.length === 2, `Expected 2 lines, got ${lines.length}`);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lastWord = line.words[line.words.length - 1];
      assert(
        line.endMs === lastWord.endMs,
        `Line ${i} endMs (${line.endMs}) !== words[last].endMs (${lastWord.endMs})`
      );
    }
  });

  recordTest('Invariant Checks', '5.3 CRITICAL AUDIT: endMs === words[last].endMs under short duration (< 50ms)', () => {
    // When a single word has duration 30ms:
    const shortWord: SrtWord[] = [
      { word: 'Ơ!', startMs: 1000, endMs: 1030 },
    ];
    const lines = segmentWordsToSubtitles(shortWord);
    assert(lines.length === 1, `Expected 1 line, got ${lines.length}`);
    const line = lines[0];
    const lastWord = line.words[line.words.length - 1];

    console.log(`      [AUDIT RESULT] line.startMs=${line.startMs}, line.endMs=${line.endMs}, words[0].startMs=${lastWord.startMs}, words[0].endMs=${lastWord.endMs}`);
    
    // Strict equality check: line.endMs === words[last].endMs
    assert(
      line.endMs === lastWord.endMs,
      `VIOLATION OF CONTRACT: line.endMs (${line.endMs}) !== words[last].endMs (${lastWord.endMs}) due to Math.max(startMs + 50, endMs)!`
    );
  });

  recordTest('Invariant Checks', '5.4 CRITICAL AUDIT: Speaker transition after short word does NOT cause subtitle overlap', () => {
    // Speaker 0 says "Ơ!" (duration 30ms: 1000-1030)
    // Speaker 1 says "Gì?" starting at 1040ms (1040-1200)
    const dialog: SrtWord[] = [
      { word: 'Ơ!', startMs: 1000, endMs: 1030, speaker: 'SPEAKER_00' },
      { word: 'Gì?', startMs: 1040, endMs: 1200, speaker: 'SPEAKER_01' },
    ];
    const lines = segmentWordsToSubtitles(dialog);
    assert(lines.length === 2, `Expected 2 lines for speaker switch, got ${lines.length}`);

    console.log(`      [AUDIT RESULT] Line 0: [${lines[0].startMs} - ${lines[0].endMs}], Line 1: [${lines[1].startMs} - ${lines[1].endMs}]`);

    // Invariant: line[0].endMs must be <= line[1].startMs (NO OVERLAP)
    assert(
      lines[0].endMs <= lines[1].startMs,
      `SUBTITLE OVERLAP BUG: Line 0 endMs (${lines[0].endMs}) > Line 1 startMs (${lines[1].startMs})! Padded duration overlapped next speaker!`
    );
  });

  recordTest('Invariant Checks', '5.5 Zero artificial gaps: subtitle gap matches acoustic gap', () => {
    const words: SrtWord[] = [
      { word: 'A', startMs: 0, endMs: 500 },
      // Acoustic gap = 923 - 500 = 423ms
      { word: 'B', startMs: 923, endMs: 1400 },
    ];
    const lines = segmentWordsToSubtitles(words);
    assert(lines.length === 2, 'Expected 2 lines');
    const subtitleGap = lines[1].startMs - lines[0].endMs;
    const acousticGap = words[1].startMs - words[0].endMs;
    assert(
      subtitleGap === acousticGap,
      `Artificial gap detected! Subtitle gap=${subtitleGap}ms, acoustic gap=${acousticGap}ms`
    );
  });

  // ===========================================================================
  // CATEGORY 6: VISUAL LINE WRAPPING ADVERSARIAL STRESS
  // ===========================================================================
  console.log('\n>>> CATEGORY 6: VISUAL LINE WRAPPING <<<');

  recordTest('Visual Wrapping', '6.1 Latin sentence wrapping at 37 chars', () => {
    const text = 'Đây là một câu kiểm tra khả năng ngắt dòng tiếng Việt hoàn hảo không làm gãy từ.';
    const wrapped = wrapVisualLines(text, 37);
    const lines = wrapped.split('\n');
    for (const l of lines) {
      assert(l.length <= 37, `Line "${l}" exceeds 37 chars (${l.length})`);
    }
  });

  recordTest('Visual Wrapping', '6.2 Mixed CJK & Latin sentence must NOT slice English word in half', () => {
    const mixed = 'We are testing word segmentation with 你 here today';
    const wrapped = wrapVisualLines(mixed, 37);
    console.log(`      [OBSERVATION] Mixed CJK+Latin wrap: "${wrapped.replace('\n', '\\n')}"`);
    // Check if "segmentation" got sliced into "segme" and "ntation"
    assert(
      !wrapped.includes('segme\nntation'),
      `DEFECT: wrapVisualLines sliced the English word "segmentation" into "segme\\nntation" because of CJK character presence!`
    );
  });

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n================================================================');
  console.log('STRESS TEST SUMMARY');
  console.log('================================================================');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Total Tests Run: ${results.length}`);
  console.log(`Passed:          ${passed} (${Math.round((passed / results.length) * 100)}%)`);
  console.log(`Failed:          ${failed} (${Math.round((failed / results.length) * 100)}%)\n`);

  if (failed > 0) {
    console.log('FAILURES:');
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - [${r.category}] ${r.name}`);
      console.log(`    Error: ${r.error}\n`);
    }
  }

  return { total: results.length, passed, failed, results };
}

runEmpiricalStressSuite();
