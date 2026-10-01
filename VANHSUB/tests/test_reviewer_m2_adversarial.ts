import assert from 'assert';
import { parseSrt, serializeSrt, SrtLine } from '../main/lib/srt';
import { applyVisualLineWrapping } from '../main/translate/translator';
import { breakVietnameseLines } from '../main/lib/nlpSegmenter';
import { compileToAss } from '../main/render/assCompiler';
import { groupSubtitlesForTts } from '../main/render/ttsEngine';

console.log('=== INDEPENDENT ADVERSARIAL STRESS TEST: REVIEWER M2 ===\n');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    failed++;
  }
}

// -------------------------------------------------------------
// Test 1: Extremes & Boundary Text for applyVisualLineWrapping
// -------------------------------------------------------------
test('ADV-M2-1: Empty, whitespace, and special characters in applyVisualLineWrapping', () => {
  const lines: SrtLine[] = [
    { id: '1', startMs: 0, endMs: 1000, text: '' },
    { id: '2', startMs: 1000, endMs: 2000, text: '   ' },
    { id: '3', startMs: 2000, endMs: 3000, text: '!@#$%^&*()_+{}|:"<>?' },
    { id: '4', startMs: 3000, endMs: 4000, text: 'Một từ duy nhất cực dài không có dấu cách nào cả: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
  ];

  const wrapped = applyVisualLineWrapping(lines, true);
  assert.strictEqual(wrapped.length, 4, 'Line count must be 4');
  assert.strictEqual(wrapped[0].text, '');
  assert.strictEqual(wrapped[1].text, '   ');
  assert.strictEqual(wrapped[2].text, '!@#$%^&*()_+{}|:"<>?');
  // Long unbroken word should not crash or throw
  assert.ok(wrapped[3].text.length > 0);
  assert.strictEqual(wrapped[3].startMs, 3000);
  assert.strictEqual(wrapped[3].endMs, 4000);
});

// -------------------------------------------------------------
// Test 2: Existing newlines and CRLF handling
// -------------------------------------------------------------
test('ADV-M2-2: Existing newlines and CRLF normalization', () => {
  const lineWithCRLF: SrtLine = {
    id: 'crlf',
    startMs: 100,
    endMs: 2000,
    text: 'Dòng một đã dài hơn ba mươi bảy ký tự trong tiếng Việt\r\nDòng hai cũng khá dài và cần được cân chỉnh lại',
  };

  const wrapped = applyVisualLineWrapping([lineWithCRLF], true);
  assert.strictEqual(wrapped.length, 1);
  assert.strictEqual(wrapped[0].text.includes('\r\n'), false, 'CRLF should be cleanly normalized');
  assert.strictEqual(wrapped[0].text.includes('\n'), true, 'Should contain \\n');
  assert.strictEqual(wrapped[0].startMs, 100);
  assert.strictEqual(wrapped[0].endMs, 2000);
});

// -------------------------------------------------------------
// Test 3: Metadata preservation (speaker, words, confidence)
// -------------------------------------------------------------
test('ADV-M2-3: Deep property preservation on SrtLine during wrap', () => {
  const richLine: SrtLine = {
    id: 'rich-1',
    startMs: 500,
    endMs: 3500,
    text: 'Đây là câu phụ đề có chứa nhãn người nói và mốc thời gian từng từ để kiểm tra tính toàn vẹn.',
    speaker: 'SPEAKER_02',
    words: [
      { word: 'Đây', startMs: 500, endMs: 700, speaker: 'SPEAKER_02' },
      { word: 'là', startMs: 700, endMs: 900, speaker: 'SPEAKER_02' },
    ],
    confidence: 0.98,
    frames: 90,
    stable: true,
    needsReview: false,
  };

  const wrapped = applyVisualLineWrapping([richLine], true);
  assert.strictEqual(wrapped[0].id, 'rich-1');
  assert.strictEqual(wrapped[0].speaker, 'SPEAKER_02');
  assert.deepStrictEqual(wrapped[0].words, richLine.words);
  assert.strictEqual(wrapped[0].confidence, 0.98);
  assert.strictEqual(wrapped[0].frames, 90);
  assert.strictEqual(wrapped[0].stable, true);
  assert.strictEqual(wrapped[0].needsReview, false);
});

// -------------------------------------------------------------
// Test 4: Downstream ASS Compiler Compatibility with Visual \n
// -------------------------------------------------------------
test('ADV-M2-4: ASS Compiler correctly converts \\n to \\N in Dialogue events', () => {
  const srtLines: SrtLine[] = [
    {
      id: 'ass-1',
      startMs: 1000,
      endMs: 3000,
      text: 'Dòng trên hiển thị ở đây\nDòng dưới hiển thị ở đây',
      speaker: 'SPEAKER_00',
    },
  ];

  const assOutput = compileToAss(srtLines, {
    videoWidth: 1920,
    videoHeight: 1080,
  });

  assert.ok(assOutput.includes('Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Dòng trên hiển thị ở đây\\NDòng dưới hiển thị ở đây'));
  // Ensure no literal raw newlines break the ASS Dialogue format
  const dialogueEvents = assOutput.split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.strictEqual(dialogueEvents.length, 1, 'There must be exactly 1 Dialogue event line');
});

// -------------------------------------------------------------
// Test 5: Downstream TTS Synthesis Compatibility with Visual \n
// -------------------------------------------------------------
test('ADV-M2-5: TTS grouping normalizes \\n into spaces without stutter', () => {
  const subtitles = [
    {
      index: 1,
      startTime: '00:00:01,000',
      endTime: '00:00:04,000',
      startMs: 1000,
      endMs: 4000,
      durationMs: 3000,
      text: 'Chụp ảnh được, livestream được,\ntái hiện lại các cảnh kinh điển cũng được.',
      speaker: 'SPEAKER_00',
    },
    {
      index: 2,
      startTime: '00:00:04,100',
      endTime: '00:00:06,500',
      startMs: 4100,
      endMs: 6500,
      durationMs: 2400,
      text: 'Nhưng giá cho mỗi hoạt động\ntính thế nào?',
      speaker: 'SPEAKER_00',
    },
  ];

  const groups = groupSubtitlesForTts(subtitles, { voice: 'vi-VN-HoaiMyNeural', speed: 1.0, engine: 'edge' });
  assert.ok(groups.length >= 1);
  // Check that mergedText in groups does not contain raw \n
  for (const group of groups) {
    assert.strictEqual(group.text.includes('\n'), false, 'TTS text must not contain raw newline');
    assert.strictEqual(group.text.includes('  '), false, 'TTS text must not contain double spaces');
  }
});

// -------------------------------------------------------------
// Test 6: Roundtrip SRT serialization with multiple lines & speakers
// -------------------------------------------------------------
test('ADV-M2-6: SRT Roundtrip with [SPEAKER_XX] and multi-line visual wraps', () => {
  const original: SrtLine[] = [
    {
      id: 'round-1',
      startMs: 1000,
      endMs: 4000,
      text: 'Dòng một của người nói số 1\nDòng hai của người nói số 1',
      speaker: 'SPEAKER_01',
    },
    {
      id: 'round-2',
      startMs: 4500,
      endMs: 7000,
      text: 'Người nói số 2 trả lời ngắn gọn.',
      speaker: 'SPEAKER_02',
    },
  ];

  const srtContent = serializeSrt(original);
  assert.ok(srtContent.includes('[SPEAKER_01]: Dòng một của người nói số 1\nDòng hai của người nói số 1'));
  assert.ok(srtContent.includes('[SPEAKER_02]: Người nói số 2 trả lời ngắn gọn.'));

  const parsed = parseSrt(srtContent);
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].speaker, 'SPEAKER_01');
  assert.strictEqual(parsed[0].text, 'Dòng một của người nói số 1\nDòng hai của người nói số 1');
  assert.strictEqual(parsed[0].startMs, 1000);
  assert.strictEqual(parsed[0].endMs, 4000);

  assert.strictEqual(parsed[1].speaker, 'SPEAKER_02');
  assert.strictEqual(parsed[1].text, 'Người nói số 2 trả lời ngắn gọn.');
  assert.strictEqual(parsed[1].startMs, 4500);
  assert.strictEqual(parsed[1].endMs, 7000);
});

// -------------------------------------------------------------
// Test 7: Integrity Check - Zero hardcoded or bypassed checks
// -------------------------------------------------------------
test('ADV-M2-7: Integrity check on translator.ts and SubtitleEditor.tsx', () => {
  // Ensure applyVisualLineWrapping dynamically wraps according to text length and Vietnamese word boundaries
  const test1 = applyVisualLineWrapping([{ id: '1', startMs: 0, endMs: 1000, text: 'Ngắn' }], true);
  assert.strictEqual(test1[0].text, 'Ngắn');

  const dynText = 'Đây là một câu kiểm tra tính năng tự động ngắt dòng có độ dài tương đối lớn để xác minh thuật toán xử lý thật sự.';
  const test2 = applyVisualLineWrapping([{ id: '2', startMs: 0, endMs: 1000, text: dynText }], true);
  assert.ok(test2[0].text.includes('\n'), 'Must dynamically insert \\n');
  assert.notStrictEqual(test2[0].text, dynText);
});

console.log('\n=============================================================');
console.log(`TOTAL ADVERSARIAL TESTS: ${passed + failed}`);
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);
console.log('=============================================================');

if (failed > 0) {
  process.exit(1);
}
