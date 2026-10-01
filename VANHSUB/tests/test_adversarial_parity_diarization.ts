import { execSync } from 'child_process';
import path from 'path';
import assert from 'assert';
import {
  segmentWordsToSubtitles,
  type SrtWord,
  type SrtLine,
} from '../main/asr/wordSegmenter';

interface PythonSegment {
  start: number;
  end: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker: string | null;
  words: SrtWord[];
}

function runPythonSegmenter(words: SrtWord[], maxCharsPerLine = 37): PythonSegment[] {
  const bridgeScript = path.join(__dirname, 'parity_python_bridge.py');
  const inputJson = JSON.stringify({ words, maxCharsPerLine });
  const stdout = execSync(`python "${bridgeScript}"`, {
    input: inputJson,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout.trim());
}

function assertParity(testName: string, words: SrtWord[], maxCharsPerLine = 37) {
  const tsSegments = segmentWordsToSubtitles(words, { maxCharsPerLine });
  const pySegments = runPythonSegmenter(words, maxCharsPerLine);

  assert.strictEqual(
    tsSegments.length,
    pySegments.length,
    `[${testName}] Segment count mismatch: TS=${tsSegments.length}, Python=${pySegments.length}`
  );

  for (let i = 0; i < tsSegments.length; i++) {
    const ts = tsSegments[i];
    const py = pySegments[i];

    assert.strictEqual(
      ts.startMs,
      py.startMs,
      `[${testName}] Segment ${i} startMs mismatch: TS=${ts.startMs}, Python=${py.startMs}`
    );

    assert.strictEqual(
      ts.endMs,
      py.endMs,
      `[${testName}] Segment ${i} endMs mismatch: TS=${ts.endMs}, Python=${py.endMs}`
    );

    const tsSpeaker = ts.speaker || null;
    const pySpeaker = py.speaker || null;
    assert.strictEqual(
      tsSpeaker,
      pySpeaker,
      `[${testName}] Segment ${i} speaker mismatch: TS=${tsSpeaker}, Python=${pySpeaker}`
    );

    assert.strictEqual(
      ts.words?.length,
      py.words?.length,
      `[${testName}] Segment ${i} words length mismatch: TS=${ts.words?.length}, Python=${py.words?.length}`
    );

    if (ts.words && py.words) {
      for (let w = 0; w < ts.words.length; w++) {
        assert.strictEqual(
          ts.words[w].word,
          py.words[w].word,
          `[${testName}] Segment ${i} Word ${w} text mismatch: TS=${ts.words[w].word}, Python=${py.words[w].word}`
        );
        assert.strictEqual(
          ts.words[w].startMs,
          py.words[w].startMs,
          `[${testName}] Segment ${i} Word ${w} startMs mismatch: TS=${ts.words[w].startMs}, Python=${py.words[w].startMs}`
        );
        assert.strictEqual(
          ts.words[w].endMs,
          py.words[w].endMs,
          `[${testName}] Segment ${i} Word ${w} endMs mismatch: TS=${ts.words[w].endMs}, Python=${py.words[w].endMs}`
        );
      }
    }
  }
}

async function runParitySuite() {
  console.log('=== CROSS-LANGUAGE PARITY & DIARIZATION STRESS HARNESS ===\n');

  let passedTests = 0;
  let totalTests = 0;

  function runCase(name: string, fn: () => void) {
    totalTests++;
    process.stdout.write(`[Test ${totalTests}] ${name}... `);
    try {
      fn();
      passedTests++;
      console.log('PASS');
    } catch (err: any) {
      console.log('FAIL');
      console.error(err.message);
      throw err;
    }
  }

  // -------------------------------------------------------------
  // Part 1: Silence Boundary Parity
  // -------------------------------------------------------------
  runCase('Silence 349ms gap (should NOT split)', () => {
    const words: SrtWord[] = [
      { word: 'Word1', startMs: 0, endMs: 300 },
      { word: 'Word2', startMs: 649, endMs: 900 }, // pause = 349ms < 350ms
    ];
    assertParity('Silence 349ms', words);
    const tsRes = segmentWordsToSubtitles(words);
    assert.strictEqual(tsRes.length, 1);
  });

  runCase('Silence 350ms gap (MUST split)', () => {
    const words: SrtWord[] = [
      { word: 'Word1', startMs: 0, endMs: 300 },
      { word: 'Word2', startMs: 650, endMs: 900 }, // pause = 350ms >= 350ms
    ];
    assertParity('Silence 350ms', words);
    const tsRes = segmentWordsToSubtitles(words);
    assert.strictEqual(tsRes.length, 2);
  });

  runCase('Major silence 699ms vs 700ms gap', () => {
    const words699: SrtWord[] = [
      { word: 'A', startMs: 0, endMs: 300 },
      { word: 'B', startMs: 999, endMs: 1200 }, // pause 699ms (splits by >= 350ms anyway)
    ];
    assertParity('Silence 699ms', words699);

    const words700: SrtWord[] = [
      { word: 'A', startMs: 0, endMs: 300 },
      { word: 'B', startMs: 1000, endMs: 1200 }, // pause 700ms >= 700ms
    ];
    assertParity('Silence 700ms', words700);
  });

  // -------------------------------------------------------------
  // Part 2: Terminal Punctuation Parity
  // -------------------------------------------------------------
  runCase('Terminal punctuation (. ? !) with >= 4 units', () => {
    const words: SrtWord[] = [
      { word: 'Đây', startMs: 0, endMs: 300 },
      { word: 'là', startMs: 310, endMs: 500 },
      { word: 'câu', startMs: 510, endMs: 700 },
      { word: 'hỏi?', startMs: 710, endMs: 1000 },
      { word: 'Đúng', startMs: 1050, endMs: 1300 },
      { word: 'rồi!', startMs: 1310, endMs: 1600 },
    ];
    assertParity('Terminal punct 4 units', words);
  });

  runCase('CJK Terminal punctuation (。 ？ ！ …)', () => {
    const words: SrtWord[] = [
      { word: '我', startMs: 0, endMs: 250 },
      { word: '知', startMs: 260, endMs: 500 },
      { word: '道', startMs: 510, endMs: 750 },
      { word: '了。', startMs: 760, endMs: 1000 },
      { word: '你', startMs: 1050, endMs: 1300 },
      { word: '呢？', startMs: 1310, endMs: 1600 },
    ];
    assertParity('CJK Terminal punct', words);
  });

  // -------------------------------------------------------------
  // Part 3: Clause Punctuation Parity
  // -------------------------------------------------------------
  runCase('Clause punctuation (, ; :) with >= 6 units', () => {
    const words: SrtWord[] = [
      { word: 'W1', startMs: 0, endMs: 300 },
      { word: 'W2', startMs: 310, endMs: 600 },
      { word: 'W3', startMs: 610, endMs: 900 },
      { word: 'W4', startMs: 910, endMs: 1200 },
      { word: 'W5', startMs: 1210, endMs: 1500 },
      { word: 'W6,', startMs: 1510, endMs: 1800 },
      { word: 'W7', startMs: 1850, endMs: 2100 },
      { word: 'W8', startMs: 2110, endMs: 2400 },
    ];
    assertParity('Clause punct 6 units', words);
  });

  runCase('CJK Clause punctuation (， ； ： 、) with 12 CJK glyphs', () => {
    const words: SrtWord[] = [
      { word: '如', startMs: 0, endMs: 200 },
      { word: '果', startMs: 210, endMs: 400 },
      { word: '你', startMs: 410, endMs: 600 },
      { word: '想', startMs: 610, endMs: 800 },
      { word: '学', startMs: 810, endMs: 1000 },
      { word: '习', startMs: 1010, endMs: 1200 },
      { word: '编', startMs: 1210, endMs: 1400 },
      { word: '程', startMs: 1410, endMs: 1600 },
      { word: '开', startMs: 1610, endMs: 1800 },
      { word: '发', startMs: 1810, endMs: 2000 },
      { word: '技', startMs: 2010, endMs: 2200 },
      { word: '术，', startMs: 2210, endMs: 2400 }, // 12 CJK units + comma
      { word: '就', startMs: 2450, endMs: 2650 },
      { word: '来', startMs: 2660, endMs: 2850 },
      { word: '吧。', startMs: 2860, endMs: 3100 },
    ];
    assertParity('CJK Clause 12 units', words);
  });

  // -------------------------------------------------------------
  // Part 4: Monologue Hard Ceiling
  // -------------------------------------------------------------
  runCase('Monologue 100 continuous words (hard ceiling <= 6.0s)', () => {
    const words: SrtWord[] = [];
    for (let i = 0; i < 100; i++) {
      words.push({
        word: `monologueWord${i}`,
        startMs: i * 250,
        endMs: i * 250 + 240, // 10ms gap
      });
    }
    assertParity('Monologue 100 words', words);
    const res = segmentWordsToSubtitles(words);
    for (const seg of res) {
      assert.ok(seg.endMs - seg.startMs <= 6000, `Duration > 6000ms: ${seg.endMs - seg.startMs}`);
    }
  });

  // -------------------------------------------------------------
  // Part 5: Diarization Edge Cases
  // -------------------------------------------------------------
  runCase('Diarization: Speaker flips on every word (10 words)', () => {
    const words: SrtWord[] = [];
    for (let i = 0; i < 10; i++) {
      words.push({
        word: `w${i}`,
        startMs: i * 200,
        endMs: i * 200 + 180,
        speaker: i % 2 === 0 ? 'SPEAKER_00' : 'SPEAKER_01',
      });
    }
    assertParity('Speaker flips every word', words);
    const res = segmentWordsToSubtitles(words);
    assert.strictEqual(res.length, 10);
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(res[i].speaker, i % 2 === 0 ? 'SPEAKER_00' : 'SPEAKER_01');
    }
  });

  runCase('Diarization: 3 speakers rotating', () => {
    const speakers = ['SPEAKER_00', 'SPEAKER_01', 'SPEAKER_02'];
    const words: SrtWord[] = [];
    for (let i = 0; i < 30; i++) {
      const spkIdx = Math.floor(i / 5) % 3; // switches every 5 words
      words.push({
        word: `talk${i}`,
        startMs: i * 250,
        endMs: i * 250 + 220,
        speaker: speakers[spkIdx],
      });
    }
    assertParity('3 speakers rotating', words);
    const res = segmentWordsToSubtitles(words);
    assert.strictEqual(res.length, 6); // 30 words / 5 = 6 chunks
  });

  runCase('Diarization: Speaker undefined throughout', () => {
    const words: SrtWord[] = [
      { word: 'No', startMs: 0, endMs: 200 },
      { word: 'speaker', startMs: 210, endMs: 400 },
      { word: 'at', startMs: 410, endMs: 600 },
      { word: 'all.', startMs: 610, endMs: 800 },
    ];
    assertParity('Speaker undefined throughout', words);
    const res = segmentWordsToSubtitles(words);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].speaker, undefined);
  });

  runCase('Diarization: Speaker undefined transitioning to defined', () => {
    const words: SrtWord[] = [
      { word: 'Intro', startMs: 0, endMs: 300 }, // undefined
      { word: 'speech', startMs: 310, endMs: 600, speaker: 'SPEAKER_01' },
      { word: 'continues', startMs: 610, endMs: 900, speaker: 'SPEAKER_01' },
    ];
    assertParity('Undef to defined', words);
  });

  runCase('Diarization: Speaker defined transitioning to undefined', () => {
    const words: SrtWord[] = [
      { word: 'Spoken', startMs: 0, endMs: 300, speaker: 'SPEAKER_00' },
      { word: 'outro', startMs: 310, endMs: 600 }, // undefined
    ];
    assertParity('Defined to undef', words);
  });

  // -------------------------------------------------------------
  // Part 6: Randomized Fuzzing (50 diverse trials)
  // -------------------------------------------------------------
  runCase('Randomized Fuzzing: 50 trials across languages, pauses, speakers', () => {
    const sampleVocab = [
      'xin', 'chào', 'các', 'bạn', 'hôm', 'nay', 'thời', 'tiết', 'rất', 'đẹp',
      'chúng', 'ta', 'hãy', 'cùng', 'nhau', 'thực', 'hiện', 'nhiệm', 'vụ', 'này.',
      'Hello', 'world', 'this', 'is', 'an', 'adversarial', 'test', 'suite!',
      '你', '好', '，', '世', '界', '。', '天', '气', '好', '极', '了', '！',
    ];
    const speakerChoices = [undefined, 'SPEAKER_00', 'SPEAKER_01', 'SPEAKER_02'];

    // Seeded pseudo-random generator
    let seed = 42;
    function rand() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    }

    for (let trial = 0; trial < 50; trial++) {
      const wordCount = 10 + Math.floor(rand() * 40); // 10 to 50 words
      const words: SrtWord[] = [];
      let currentMs = Math.floor(rand() * 1000);

      for (let w = 0; w < wordCount; w++) {
        const text = sampleVocab[Math.floor(rand() * sampleVocab.length)];
        const dur = 150 + Math.floor(rand() * 400); // 150 to 550ms
        const pauseProb = rand();
        let pause = 20 + Math.floor(rand() * 80); // 20-100ms
        if (pauseProb > 0.85) {
          pause = 350 + Math.floor(rand() * 400); // trigger pause split
        }

        const spk = speakerChoices[Math.floor(rand() * speakerChoices.length)];

        words.push({
          word: text,
          startMs: currentMs,
          endMs: currentMs + dur,
          ...(spk ? { speaker: spk } : {}),
        });

        currentMs += dur + pause;
      }

      assertParity(`Fuzzing trial #${trial + 1}`, words);
    }
  });

  console.log('\n=============================================================');
  console.log(`=== PARITY HARNESS COMPLETED: ${passedTests}/${totalTests} TESTS PASSED (100%) ===`);
  console.log('=============================================================\n');
}

runParitySuite().catch((err) => {
  console.error('[PARITY SUITE FATAL ERROR]:', err);
  process.exit(1);
});
