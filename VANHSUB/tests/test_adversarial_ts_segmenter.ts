import {
  segmentWordsToSubtitles,
  formatWordsText,
  wrapVisualLines,
  isCjkText,
  isCjkChar,
  countUnits,
  type SrtWord,
  type SrtLine,
} from '../main/asr/wordSegmenter';
import assert from 'assert';

function testSuite() {
  console.log('=== ADVERSARIAL STRESS TEST: TS WORD SEGMENTER ===\n');

  // 1. Silence Splitting
  console.log('[TS 1] Silence Splitting (350ms & 700ms)...');
  {
    const words: SrtWord[] = [
      { word: 'Xin', startMs: 0, endMs: 200 },
      { word: 'chào', startMs: 220, endMs: 400 },
      // Gap: 750 - 400 = 350ms -> MUST SPLIT
      { word: 'các', startMs: 750, endMs: 950 },
      { word: 'bạn', startMs: 970, endMs: 1200 },
      // Gap: 1950 - 1200 = 750ms >= 700ms -> MUST SPLIT
      { word: 'hôm', startMs: 1950, endMs: 2150 },
      { word: 'nay', startMs: 2170, endMs: 2400 },
    ];
    const segments = segmentWordsToSubtitles(words);
    assert.strictEqual(segments.length, 3);
    assert.strictEqual(segments[0].text, 'Xin chào');
    assert.strictEqual(segments[1].text, 'các bạn');
    assert.strictEqual(segments[2].text, 'hôm nay');
    assert.strictEqual(segments[0].startMs, 0);
    assert.strictEqual(segments[0].endMs, 400);
    assert.strictEqual(segments[1].startMs, 750);
    assert.strictEqual(segments[1].endMs, 1200);
    assert.strictEqual(segments[2].startMs, 1950);
    assert.strictEqual(segments[2].endMs, 2400);
    console.log('  -> PASS');
  }

  // 2. Terminal Punctuation
  console.log('[TS 2] Terminal Punctuation (. ? ! 。 ？ ！ …)...');
  {
    const words: SrtWord[] = [
      { word: 'Đây', startMs: 0, endMs: 300 },
      { word: 'là', startMs: 310, endMs: 500 },
      { word: 'câu', startMs: 510, endMs: 700 },
      { word: 'một.', startMs: 710, endMs: 1000 },
      { word: 'Còn', startMs: 1050, endMs: 1300 },
      { word: 'đây', startMs: 1310, endMs: 1500 },
      { word: 'là', startMs: 1510, endMs: 1700 },
      { word: 'hai!', startMs: 1710, endMs: 2000 },
    ];
    const segments = segmentWordsToSubtitles(words);
    assert.strictEqual(segments.length, 2);
    assert.strictEqual(segments[0].text, 'Đây là câu một.');
    assert.strictEqual(segments[1].text, 'Còn đây là hai!');

    // Short utterance kept together
    const shortWords: SrtWord[] = [
      { word: 'Dạ!', startMs: 0, endMs: 200 },
      { word: 'Em', startMs: 250, endMs: 400 },
      { word: 'hiểu.', startMs: 450, endMs: 700 },
    ];
    const shortSegments = segmentWordsToSubtitles(shortWords);
    assert.strictEqual(shortSegments.length, 1);
    assert.strictEqual(shortSegments[0].text, 'Dạ! Em hiểu.');
    console.log('  -> PASS');
  }

  // 3. Clause Punctuation
  console.log('[TS 3] Clause Punctuation (, ; : ， ； ： 、)...');
  {
    const words: SrtWord[] = [
      { word: 'Một', startMs: 0, endMs: 300 },
      { word: 'hai', startMs: 310, endMs: 600 },
      { word: 'ba', startMs: 610, endMs: 900 },
      { word: 'bốn', startMs: 910, endMs: 1200 },
      { word: 'năm', startMs: 1210, endMs: 1500 },
      { word: 'sáu,', startMs: 1510, endMs: 1800 },
      { word: 'bảy', startMs: 1850, endMs: 2100 },
      { word: 'tám', startMs: 2110, endMs: 2400 },
      { word: 'chín.', startMs: 2410, endMs: 2700 },
    ];
    const segments = segmentWordsToSubtitles(words);
    assert.strictEqual(segments.length, 2);
    assert.strictEqual(segments[0].text, 'Một hai ba bốn năm sáu,');
    assert.strictEqual(segments[1].text, 'bảy tám chín.');
    console.log('  -> PASS');
  }

  // 4. Hard Max Duration Ceiling
  console.log('[TS 4] Hard Max Duration Ceiling (<= 6000ms)...');
  {
    const words: SrtWord[] = [];
    for (let i = 0; i < 30; i++) {
      words.push({
        word: `word${i}`,
        startMs: i * 300,
        endMs: i * 300 + 280,
      });
    }
    const segments = segmentWordsToSubtitles(words);
    assert.ok(segments.length >= 2);
    for (let i = 0; i < segments.length; i++) {
      const dur = segments[i].endMs - segments[i].startMs;
      assert.ok(dur <= 6000, `Segment ${i} exceeded 6000ms: ${dur}ms`);
    }
    console.log(`  -> PASS (${segments.length} segments, all <= 6.0s)`);
  }

  // 5. CJK Formatting
  console.log('[TS 5] CJK Spaceless Joining & Mixed CJK-Latin...');
  {
    const cjkWords: SrtWord[] = [
      { word: '今', startMs: 0, endMs: 200 },
      { word: '天', startMs: 210, endMs: 400 },
      { word: '天', startMs: 410, endMs: 600 },
      { word: '气', startMs: 610, endMs: 800 },
      { word: '很', startMs: 810, endMs: 1000 },
      { word: '好', startMs: 1010, endMs: 1200 },
      { word: '。', startMs: 1210, endMs: 1300 },
    ];
    const segments = segmentWordsToSubtitles(cjkWords);
    assert.strictEqual(segments.length, 1);
    assert.strictEqual(segments[0].text, '今天天气很好。');

    const mixedWords: SrtWord[] = [
      { word: '使用', startMs: 0, endMs: 300 },
      { word: 'Python', startMs: 310, endMs: 600 },
      { word: '编写', startMs: 610, endMs: 900 },
    ];
    const text = formatWordsText(mixedWords);
    assert.strictEqual(text, '使用 Python 编写');
    console.log('  -> PASS');
  }

  // 6. Speaker Flips On Every Word
  console.log('[TS 6] Speaker Flips on Every Word...');
  {
    const words: SrtWord[] = [
      { word: 'Hello', startMs: 0, endMs: 200, speaker: 'SPEAKER_00' },
      { word: 'Hi', startMs: 210, endMs: 400, speaker: 'SPEAKER_01' },
      { word: 'How', startMs: 410, endMs: 600, speaker: 'SPEAKER_00' },
      { word: 'Fine', startMs: 610, endMs: 800, speaker: 'SPEAKER_01' },
      { word: 'Thanks', startMs: 810, endMs: 1000, speaker: 'SPEAKER_00' },
      { word: 'Bye', startMs: 1010, endMs: 1200, speaker: 'SPEAKER_01' },
    ];
    const segments = segmentWordsToSubtitles(words);
    assert.strictEqual(segments.length, 6, `Expected 6 segments, got ${segments.length}`);
    const expectedSpeakers = ['SPEAKER_00', 'SPEAKER_01', 'SPEAKER_00', 'SPEAKER_01', 'SPEAKER_00', 'SPEAKER_01'];
    for (let i = 0; i < segments.length; i++) {
      assert.strictEqual(segments[i].speaker, expectedSpeakers[i]);
      assert.strictEqual(segments[i].text, words[i].word);
      assert.strictEqual(segments[i].startMs, words[i].startMs);
      assert.strictEqual(segments[i].endMs, words[i].endMs);
    }
    console.log('  -> PASS');
  }

  // 7. Speaker Undefined / Null / Partial
  console.log('[TS 7] Speaker Undefined & Edge Cases...');
  {
    const wordsUndef: SrtWord[] = [
      { word: 'Một', startMs: 0, endMs: 300 },
      { word: 'hai', startMs: 310, endMs: 600 },
    ];
    const segmentsUndef = segmentWordsToSubtitles(wordsUndef);
    assert.strictEqual(segmentsUndef.length, 1);
    assert.strictEqual(segmentsUndef[0].speaker, undefined);

    const wordsPartial1: SrtWord[] = [
      { word: 'Một', startMs: 0, endMs: 300 },
      { word: 'hai', startMs: 310, endMs: 600, speaker: 'SPEAKER_01' },
    ];
    const segments1 = segmentWordsToSubtitles(wordsPartial1);
    assert.strictEqual(segments1.length, 1);
    assert.strictEqual(segments1[0].speaker, undefined);

    const wordsPartial2: SrtWord[] = [
      { word: 'Một', startMs: 0, endMs: 300, speaker: 'SPEAKER_00' },
      { word: 'hai', startMs: 310, endMs: 600 },
    ];
    const segments2 = segmentWordsToSubtitles(wordsPartial2);
    assert.strictEqual(segments2.length, 1);
    assert.strictEqual(segments2[0].speaker, 'SPEAKER_00');
    console.log('  -> PASS');
  }

  // 8. Abnormal & Inverted Timestamps
  console.log('[TS 8] Abnormal & Inverted Timestamps...');
  {
    assert.deepStrictEqual(segmentWordsToSubtitles([]), []);
    assert.deepStrictEqual(segmentWordsToSubtitles(null as any), []);

    const wordsCorrupt = [
      null as any,
      {} as any,
      { word: '' } as any,
      { word: '   ' } as any,
      { word: 'Valid', startMs: 100, endMs: 300 },
    ];
    const segments = segmentWordsToSubtitles(wordsCorrupt);
    assert.strictEqual(segments.length, 1);
    assert.strictEqual(segments[0].text, 'Valid');

    const inverted = [{ word: 'Test', startMs: 500, endMs: 400 }];
    const segInv = segmentWordsToSubtitles(inverted);
    assert.strictEqual(segInv.length, 1);
    assert.strictEqual(segInv[0].startMs, 500);
    assert.ok(segInv[0].endMs >= 530);
    console.log('  -> PASS');
  }

  // 9. Exact Timestamps & Zero Gaps
  console.log('[TS 9] Exact Timestamps & Zero Gaps...');
  {
    const words: SrtWord[] = [
      { word: 'A', startMs: 1000, endMs: 1300 },
      { word: 'B', startMs: 1320, endMs: 1600 },
      { word: 'C', startMs: 2000, endMs: 2300 },
      { word: 'D', startMs: 2310, endMs: 2600 },
    ];
    const segments = segmentWordsToSubtitles(words);
    assert.strictEqual(segments.length, 2);
    assert.strictEqual(segments[0].startMs, 1000);
    assert.strictEqual(segments[0].endMs, 1600);
    assert.strictEqual(segments[1].startMs, 2000);
    assert.strictEqual(segments[1].endMs, 2600);
    assert.strictEqual(segments[1].startMs - segments[0].endMs, 400);
    console.log('  -> PASS');
  }

  console.log('\n=== ALL 9 TS ADVERSARIAL STRESS TESTS PASSED ===\n');
}

testSuite();
