import fs from 'fs';
import path from 'path';
import os from 'os';
import assert from 'assert';
import OpenAI from 'openai';
import { parseSrt, serializeSrt, SrtLine } from '../main/lib/srt';
import {
  extractAndNormalizeTranslationBatch,
  applyVisualLineWrapping,
  buildSystemPrompt,
  buildRetrySystemPrompt,
  loadCheckpoint,
  saveCheckpoint,
  getCheckpointPath,
  translateSrtFile,
} from '../main/translate/translator';
import {
  resolveGroupedTimestamps,
  cleanAndDeduplicateSubtitles,
  MAX_SUBTITLE_GAP_MS,
  MAX_SUBTITLE_DURATION_MS,
  MAX_LINES_PER_GROUP,
  CleanSubtitlesItem,
  AiGroupedSubtitle,
} from '../main/ai/geminiClient';
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
  }
}

async function runSuite() {
  console.log('================================================================================');
  console.log('🧪 TEST SUITE: TRANSLATION RESILIENCE, INTEGRITY & LAYOUT COMPLIANCE (R1, R2, R3)');
  console.log('================================================================================\n');

  // ===========================================================================
  // SECTION 1: Flexible JSON Normalization & ID Variant Handling (R1)
  // ===========================================================================
  console.log('--- Section 1: Flexible JSON Normalization & ID Variant Handling ---');

  const expected = [
    { i: 'line-0', text: 'Hello' },
    { i: 'line-1', text: 'Good morning' },
    { i: 'line-2', text: 'Thank you' },
  ];

  await test('1.1 Standard JSON array with exact "i" field', () => {
    const raw = JSON.stringify([
      { i: 'line-0', text: 'Xin chào' },
      { i: 'line-1', text: 'Chào buổi sáng' },
      { i: 'line-2', text: 'Cảm ơn bạn' },
    ]);
    const res = extractAndNormalizeTranslationBatch(raw, expected);
    assert.strictEqual(res.get('line-0'), 'Xin chào');
    assert.strictEqual(res.get('line-1'), 'Chào buổi sáng');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn bạn');
    assert.strictEqual(res.size, 3);
  });

  await test('1.2 Numeric ID 0 preserves line-0 (no JS falsy 0 bug)', () => {
    const raw = JSON.stringify([
      { i: 0, text: 'Xin chào số 0' },
      { i: 1, text: 'Chào buổi sáng' },
      { i: 2, text: 'Cảm ơn bạn' },
    ]);
    const res = extractAndNormalizeTranslationBatch(raw, expected);
    assert.strictEqual(res.get('line-0'), 'Xin chào số 0', 'Line-0 must be extracted when i === 0');
    assert.strictEqual(res.get('line-1'), 'Chào buổi sáng');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn bạn');
  });

  await test('1.3 Alternative ID field names ("id", "index", "lineId")', () => {
    const raw = JSON.stringify([
      { id: 'line-0', text: 'Xin chào' },
      { index: 'line-1', target: 'Chào buổi sáng' },
      { lineId: 'line-2', translation: 'Cảm ơn bạn' },
    ]);
    const res = extractAndNormalizeTranslationBatch(raw, expected);
    assert.strictEqual(res.get('line-0'), 'Xin chào');
    assert.strictEqual(res.get('line-1'), 'Chào buổi sáng');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn bạn');
  });

  await test('1.4 Wrapped JSON structures ({ items: [...] }, { translations: [...] }, { result: [...] })', () => {
    const raw1 = JSON.stringify({ items: [{ i: 'line-0', text: 'Xin chào' }, { i: 'line-1', text: 'Chào' }, { i: 'line-2', text: 'Cảm ơn' }] });
    const raw2 = JSON.stringify({ translations: [{ id: '0', text: 'Xin chào' }, { id: '1', text: 'Chào' }, { id: '2', text: 'Cảm ơn' }] });
    const raw3 = JSON.stringify({ result: [{ i: 'line-0', text: 'Xin chào' }, { i: 'line-1', text: 'Chào' }, { i: 'line-2', text: 'Cảm ơn' }] });

    assert.strictEqual(extractAndNormalizeTranslationBatch(raw1, expected).size, 3);
    assert.strictEqual(extractAndNormalizeTranslationBatch(raw2, expected).size, 3);
    assert.strictEqual(extractAndNormalizeTranslationBatch(raw3, expected).size, 3);
  });

  await test('1.5 Key-value dictionary structure ({ "line-0": "text" })', () => {
    const raw = JSON.stringify({
      'line-0': 'Xin chào',
      'line-1': 'Chào buổi sáng',
      'line-2': 'Cảm ơn bạn',
    });
    const res = extractAndNormalizeTranslationBatch(raw, expected);
    assert.strictEqual(res.get('line-0'), 'Xin chào');
    assert.strictEqual(res.get('line-1'), 'Chào buổi sáng');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn bạn');
  });

  await test('1.6 Positional plain string array (["Dịch 0", "Dịch 1", "Dịch 2"])', () => {
    const raw = JSON.stringify(['Xin chào', 'Chào buổi sáng', 'Cảm ơn bạn']);
    const res = extractAndNormalizeTranslationBatch(raw, expected);
    assert.strictEqual(res.get('line-0'), 'Xin chào');
    assert.strictEqual(res.get('line-1'), 'Chào buổi sáng');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn bạn');
  });

  await test('1.7 Markdown fenced block with surrounding conversational text', () => {
    const raw = `Chào bạn, dưới đây là bản dịch phụ đề cho video:
\`\`\`json
[
  { "i": "line-0", "text": "Xin chào" },
  { "i": "line-1", "text": "Chào buổi sáng" },
  { "i": "line-2", "text": "Cảm ơn bạn" }
]
\`\`\`
Chúc bạn một ngày tốt lành!`;
    const res = extractAndNormalizeTranslationBatch(raw, expected);
    assert.strictEqual(res.get('line-0'), 'Xin chào');
    assert.strictEqual(res.get('line-1'), 'Chào buổi sáng');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn bạn');
  });

  await test('1.8 1-based indexing from model ([1, 2, 3] -> [line-0, line-1, line-2])', () => {
    const raw = JSON.stringify([
      { i: 1, text: 'Xin chào' },
      { i: 2, text: 'Chào buổi sáng' },
      { i: 3, text: 'Cảm ơn bạn' },
    ]);
    const res = extractAndNormalizeTranslationBatch(raw, expected);
    assert.strictEqual(res.get('line-0'), 'Xin chào');
    assert.strictEqual(res.get('line-1'), 'Chào buổi sáng');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn bạn');
  });

  await test('1.9 0-based indexing with offset line IDs ([0, 1, 2] -> [line-1, line-2, line-3])', () => {
    const offsetExpected = [
      { i: 'line-1', text: 'Sentence 1' },
      { i: 'line-2', text: 'Sentence 2' },
      { i: 'line-3', text: 'Sentence 3' },
    ];
    const raw = JSON.stringify([
      { i: 0, text: 'Dịch 0' },
      { i: 1, text: 'Dịch 1' },
      { i: 2, text: 'Dịch 2' },
    ]);
    const res = extractAndNormalizeTranslationBatch(raw, offsetExpected);
    assert.strictEqual(res.get('line-1'), 'Dịch 0', 'line-1 must map to item 0, not be overwritten by item 1');
    assert.strictEqual(res.get('line-2'), 'Dịch 1', 'line-2 must map to item 1');
    assert.strictEqual(res.get('line-3'), 'Dịch 2', 'line-3 must map to item 2');
    assert.strictEqual(res.size, 3);
  });

  await test('1.10 Dictionary structure with numeric positional keys ("0", "1", "2")', () => {
    const offsetExpected = [
      { i: 'line-1', text: 'Sentence 1' },
      { i: 'line-2', text: 'Sentence 2' },
      { i: 'line-3', text: 'Sentence 3' },
    ];
    const raw = JSON.stringify({
      '0': 'Dịch 0',
      '1': 'Dịch 1',
      '2': 'Dịch 2',
    });
    const res = extractAndNormalizeTranslationBatch(raw, offsetExpected);
    assert.strictEqual(res.get('line-1'), 'Dịch 0');
    assert.strictEqual(res.get('line-2'), 'Dịch 1');
    assert.strictEqual(res.get('line-3'), 'Dịch 2');
    assert.strictEqual(res.size, 3);
  });

  await test('1.11 Bracket prefix in conversational commentary ([tiếng Việt]: [ ... ])', () => {
    const raw = 'Dưới đây là phụ đề [tiếng Việt]:\n[ {"i": "line-0", "text": "Xin chào"} ]';
    const res = extractAndNormalizeTranslationBatch(raw, [{ i: 'line-0', text: 'Hello' }]);
    assert.strictEqual(res.get('line-0'), 'Xin chào', 'Bracket prefix must be parsed correctly');
    assert.strictEqual(res.size, 1);
  });

  await test('1.12 Capitalized property keys ("Text", "Translation", "I", "ID")', () => {
    const raw = '[ {"I": "line-0", "Text": "Xin chào 0"}, {"id": "line-1", "Translation": "Xin chào 1"} ]';
    const res = extractAndNormalizeTranslationBatch(raw, [
      { i: 'line-0', text: 'Hello 0' },
      { i: 'line-1', text: 'Hello 1' },
    ]);
    assert.strictEqual(res.get('line-0'), 'Xin chào 0', 'Capitalized "Text" & "I" must be parsed');
    assert.strictEqual(res.get('line-1'), 'Xin chào 1', 'Capitalized "Translation" must be parsed');
    assert.strictEqual(res.size, 2);
  });

  await test('1.13 Custom language key in 2-key dictionary ({"i": "line-0", "vietnamese": "Xin chào"})', () => {
    const raw = '[ {"i": "line-0", "vietnamese": "Xin chào"} ]';
    const res = extractAndNormalizeTranslationBatch(raw, [{ i: 'line-0', text: 'Hello' }]);
    assert.strictEqual(res.get('line-0'), 'Xin chào', 'Custom language key in 2-key object must be parsed');
    assert.strictEqual(res.size, 1);
  });

  await test('1.14 Multiple markdown code blocks concatenated into one complete batch', () => {
    const raw = `Phần 1:
\`\`\`json
[
  {"i": "line-0", "text": "Xin chào"}
]
\`\`\`
Phần 2:
\`\`\`json
[
  {"i": "line-1", "text": "Chào buổi sáng"},
  {"i": "line-2", "text": "Cảm ơn bạn"}
]
\`\`\``;
    const res = extractAndNormalizeTranslationBatch(raw, expected);
    assert.strictEqual(res.size, 3, 'All 3 lines from multiple code blocks must be extracted');
    assert.strictEqual(res.get('line-0'), 'Xin chào');
    assert.strictEqual(res.get('line-1'), 'Chào buổi sáng');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn bạn');
  });

  await test('1.15 Array of 1-key objects where key is ID with partial items ([{"line-0": "text"}, {"line-2": "text"}])', () => {
    const raw = JSON.stringify([
      { 'line-0': 'Xin chào' },
      { 'line-2': 'Cảm ơn bạn' },
    ]);
    const res = extractAndNormalizeTranslationBatch(raw, expected);
    assert.strictEqual(res.size, 2);
    assert.strictEqual(res.get('line-0'), 'Xin chào');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn bạn');
  });

  await test('1.16 Plain text format with bracketed IDs ([line-0]: Xin chào)', () => {
    const raw = `[line-0]: Xin chào\n[line-1]: Chào buổi sáng\n[line-2]: Cảm ơn bạn`;
    const res = extractAndNormalizeTranslationBatch(raw, expected);
    assert.strictEqual(res.size, 3);
    assert.strictEqual(res.get('line-0'), 'Xin chào');
    assert.strictEqual(res.get('line-1'), 'Chào buổi sáng');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn bạn');
  });

  await test('1.17 Plain text format with markdown bullets (- line-0: Xin chào)', () => {
    const raw = `- line-0: Xin chào\n- line-1: Chào buổi sáng\n- line-2: Cảm ơn bạn`;
    const res = extractAndNormalizeTranslationBatch(raw, expected);
    assert.strictEqual(res.size, 3);
    assert.strictEqual(res.get('line-0'), 'Xin chào');
    assert.strictEqual(res.get('line-1'), 'Chào buổi sáng');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn bạn');
  });

  await test('1.18 Plain numbered lines when model omits JSON (1. Xin chào\\n2. Chào buổi sáng\\n3. Cảm ơn bạn)', () => {
    const raw = `1. Xin chào\n2. Chào buổi sáng\n3. Cảm ơn bạn`;
    const res = extractAndNormalizeTranslationBatch(raw, expected);
    assert.strictEqual(res.size, 3);
    assert.strictEqual(res.get('line-0'), 'Xin chào');
    assert.strictEqual(res.get('line-1'), 'Chào buổi sáng');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn bạn');
  });

  // ===========================================================================
  // SECTION 2: Batch Integrity Verification & Automatic Retry (R1)
  // ===========================================================================
  console.log('\n--- Section 2: Batch Integrity Verification & Automatic Retry ---');

  await test('2.1 Partial response detection: missing line triggers retry and never silently accepts fallback', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_integrity_'));
    const srtFile = path.join(tempDir, 'integrity_test.srt');
    const testLines: SrtLine[] = [
      { id: 'line-0', startMs: 1000, endMs: 2000, text: 'Sentence one.', speaker: 'SPEAKER_00' },
      { id: 'line-1', startMs: 2500, endMs: 3500, text: 'Sentence two.', speaker: 'SPEAKER_00' },
      { id: 'line-2', startMs: 4000, endMs: 5000, text: 'Sentence three.', speaker: 'SPEAKER_00' },
    ];
    fs.writeFileSync(srtFile, serializeSrt(testLines), 'utf-8');

    SettingsStore.set('geminiApiKey', 'test_key');
    SettingsStore.set('translateBatchSize', 10);
    SettingsStore.set('translateConcurrency', 1);

    const testClient = new OpenAI({ apiKey: 'test_key' });
    const proto = Object.getPrototypeOf(testClient.chat.completions) as any;
    const origCreate = proto.create;

    let callCount = 0;
    proto.create = async function (params: any) {
      callCount++;
      if (callCount === 1) {
        // Attempt 1: Return only 2 out of 3 lines (omit line-2)
        return {
          choices: [
            {
              message: {
                content: JSON.stringify([
                  { i: 'line-0', text: 'Câu một.' },
                  { i: 'line-1', text: 'Câu hai.' },
                ]),
              },
            },
          ],
        };
      }
      // Attempt 2: After retry, return all 3 lines
      return {
        choices: [
          {
            message: {
              content: JSON.stringify([
                { i: 'line-0', text: 'Câu một.' },
                { i: 'line-1', text: 'Câu hai.' },
                { i: 'line-2', text: 'Câu ba.' },
              ]),
            },
          },
        ],
      };
    };

    try {
      const { translatedSrtPath } = await translateSrtFile(srtFile, 'vi');
      const parsed = parseSrt(fs.readFileSync(translatedSrtPath, 'utf-8'));

      assert.strictEqual(callCount, 2, 'Must have retried after missing line in attempt 1');
      assert.strictEqual(parsed.length, 3);
      assert.strictEqual(parsed[0].text, 'Câu một.');
      assert.strictEqual(parsed[1].text, 'Câu hai.');
      assert.strictEqual(parsed[2].text, 'Câu ba.', 'Line 2 must be translated after retry, not fallen back to source!');
    } finally {
      proto.create = origCreate;
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  await test('2.2 Unrecoverable failure throws explicit error instead of silently outputting untranslated SRT', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_fail_'));
    const srtFile = path.join(tempDir, 'fail_test.srt');
    const testLines: SrtLine[] = [
      { id: 'line-0', startMs: 1000, endMs: 2000, text: 'Always fails.', speaker: 'SPEAKER_00' },
    ];
    fs.writeFileSync(srtFile, serializeSrt(testLines), 'utf-8');

    const testClient = new OpenAI({ apiKey: 'test_key' });
    const proto = Object.getPrototypeOf(testClient.chat.completions) as any;
    const origCreate = proto.create;

    proto.create = async function () {
      // Model consistently returns empty response
      return { choices: [{ message: { content: '[]' } }] };
    };

    let caughtError = false;
    try {
      await translateSrtFile(srtFile, 'vi');
    } catch (err: any) {
      caughtError = true;
      assert.ok(err.message.includes('Dịch thất bại'), 'Must throw descriptive translation failure error');
    } finally {
      proto.create = origCreate;
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }

    assert.strictEqual(caughtError, true, 'Must throw error when translation fails all retries');
  });

  await test('2.3 Input SRT with empty or whitespace lines is safely handled without integrity crash', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_empty_line_'));
    const srtFile = path.join(tempDir, 'empty_line_test.srt');
    const testLines: SrtLine[] = [
      { id: 'line-0', startMs: 1000, endMs: 2000, text: '', speaker: 'SPEAKER_00' },
      { id: 'line-1', startMs: 2500, endMs: 3500, text: 'Hello world', speaker: 'SPEAKER_00' },
      { id: 'line-2', startMs: 4000, endMs: 5000, text: '   ', speaker: 'SPEAKER_00' },
    ];
    fs.writeFileSync(srtFile, serializeSrt(testLines), 'utf-8');

    const testClient = new OpenAI({ apiKey: 'test_key' });
    const proto = Object.getPrototypeOf(testClient.chat.completions) as any;
    const origCreate = proto.create;

    proto.create = async function () {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify([{ i: 'line-1', text: 'Xin chào thế giới' }]),
            },
          },
        ],
      };
    };

    try {
      const { translatedSrtPath } = await translateSrtFile(srtFile, 'vi');
      const parsed = parseSrt(fs.readFileSync(translatedSrtPath, 'utf-8'));
      assert.strictEqual(parsed.length, 3);
      assert.strictEqual(parsed[1].text, 'Xin chào thế giới');
    } finally {
      proto.create = origCreate;
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  await test('2.4 Duplicate source text lines in same batch synchronized before integrity check', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_dup_sync_'));
    const srtFile = path.join(tempDir, 'dup_test.srt');
    const testLines: SrtLine[] = [
      { id: 'line-0', startMs: 1000, endMs: 2000, text: 'Thank you.', speaker: 'SPEAKER_00' },
      { id: 'line-1', startMs: 2500, endMs: 3500, text: 'Thank you.', speaker: 'SPEAKER_00' }, // Duplicate text
    ];
    fs.writeFileSync(srtFile, serializeSrt(testLines), 'utf-8');

    SettingsStore.set('geminiApiKey', 'test_key');
    SettingsStore.set('translateBatchSize', 10);
    SettingsStore.set('translateConcurrency', 1);

    const testClient = new OpenAI({ apiKey: 'test_key' });
    const proto = Object.getPrototypeOf(testClient.chat.completions) as any;
    const origCreate = proto.create;

    let apiCalls = 0;
    // Model returns only line-0 because source text is identical
    proto.create = async function () {
      apiCalls++;
      return {
        choices: [
          {
            message: {
              content: JSON.stringify([{ i: 'line-0', text: 'Cảm ơn bạn.' }]),
            },
          },
        ],
      };
    };

    try {
      const { translatedSrtPath } = await translateSrtFile(srtFile, 'vi');
      const parsed = parseSrt(fs.readFileSync(translatedSrtPath, 'utf-8'));

      assert.strictEqual(apiCalls, 1, 'Should not retry when duplicate line is synchronized');
      assert.strictEqual(parsed.length, 2);
      assert.strictEqual(parsed[0].text, 'Cảm ơn bạn.');
      assert.strictEqual(parsed[1].text, 'Cảm ơn bạn.', 'Duplicate source line must inherit translation');
    } finally {
      proto.create = origCreate;
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  await test('2.5 Pure-punctuation and music note lines pre-cached without triggering AI call', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_punct_precached_'));
    const srtFile = path.join(tempDir, 'punct_test.srt');
    const testLines: SrtLine[] = [
      { id: 'line-0', startMs: 1000, endMs: 2000, text: '...', speaker: 'SPEAKER_00' },
      { id: 'line-1', startMs: 2500, endMs: 3500, text: '♪♪♪', speaker: 'SPEAKER_00' },
      { id: 'line-2', startMs: 4000, endMs: 5000, text: 'Hello', speaker: 'SPEAKER_00' },
    ];
    fs.writeFileSync(srtFile, serializeSrt(testLines), 'utf-8');

    SettingsStore.set('geminiApiKey', 'test_key');
    SettingsStore.set('translateBatchSize', 10);
    SettingsStore.set('translateConcurrency', 1);

    const testClient = new OpenAI({ apiKey: 'test_key' });
    const proto = Object.getPrototypeOf(testClient.chat.completions) as any;
    const origCreate = proto.create;

    let payloadReceived: any = null;
    proto.create = async function (params: any) {
      payloadReceived = JSON.parse(params.messages[1].content);
      return {
        choices: [
          {
            message: {
              content: JSON.stringify([{ i: 'line-2', text: 'Xin chào' }]),
            },
          },
        ],
      };
    };

    try {
      const { translatedSrtPath } = await translateSrtFile(srtFile, 'vi');
      const parsed = parseSrt(fs.readFileSync(translatedSrtPath, 'utf-8'));

      // Punctuation and music notes should be excluded from API payload
      assert.strictEqual(payloadReceived.items.length, 1);
      assert.strictEqual(payloadReceived.items[0].i, 'line-2');

      // But fully preserved in translated output
      assert.strictEqual(parsed.length, 3);
      assert.strictEqual(parsed[0].text, '...');
      assert.strictEqual(parsed[1].text, '♪♪♪');
      assert.strictEqual(parsed[2].text, 'Xin chào');
    } finally {
      proto.create = origCreate;
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  // ===========================================================================
  // SECTION 3: Smart Checkpoint Management (R1)
  // ===========================================================================
  console.log('\n--- Section 3: Smart Checkpoint Management ---');

  await test('3.1 Stale checkpoint invalidated when SRT file modified after checkpoint saved', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_cp_stale_'));
    const srtFile = path.join(tempDir, 'sample.srt');
    fs.writeFileSync(srtFile, '1\n00:00:01,000 --> 00:00:02,000\nOld text\n', 'utf-8');

    // Save checkpoint
    saveCheckpoint(srtFile, 'vi', {
      'line-0': { source: 'Old text', target: 'Bản dịch cũ' },
    });

    const cpPath = getCheckpointPath(srtFile);
    assert.ok(fs.existsSync(cpPath), 'Checkpoint file must exist');

    // Simulate modifying SRT 5 seconds later
    const futureTime = (Date.now() + 5000) / 1000;
    fs.utimesSync(srtFile, futureTime, futureTime);

    // loadCheckpoint should detect stale SRT modification and purge checkpoint
    const loaded = loadCheckpoint(srtFile, 'vi');
    assert.strictEqual(loaded.size, 0, 'Stale checkpoint must return empty map');
    assert.strictEqual(fs.existsSync(cpPath), false, 'Stale checkpoint file must be purged');

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  await test('3.2 Untranslated fallback text in checkpoint is purged and not reused', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_cp_garbage_'));
    const srtFile = path.join(tempDir, 'garbage.srt');
    fs.writeFileSync(srtFile, '1\n00:00:01,000 --> 00:00:02,000\nThis is a long sentence in English\n', 'utf-8');

    // Save checkpoint where target === source (garbage from a previous broken run)
    saveCheckpoint(srtFile, 'vi', {
      'line-0': {
        source: 'This is a long sentence in English',
        target: 'This is a long sentence in English', // Untranslated!
      },
    });

    const loaded = loadCheckpoint(srtFile, 'vi');
    assert.strictEqual(loaded.has('line-0'), false, 'Untranslated fallback must not be reused from checkpoint');

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  await test('3.3 Short untranslated Latin and CJK text in checkpoint is purged and re-translated', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_cp_short_untrans_'));
    const srtFile = path.join(tempDir, 'short.srt');
    fs.writeFileSync(srtFile, '1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:02,000 --> 00:00:03,000\n你好\n', 'utf-8');

    saveCheckpoint(srtFile, 'vi', {
      'line-0': { source: 'Hello', target: 'Hello' },
      'line-1': { source: '你好', target: '你好' },
    });

    const loaded = loadCheckpoint(srtFile, 'vi');
    assert.strictEqual(loaded.has('line-0'), false, 'Short untranslated "Hello" must be purged');
    assert.strictEqual(loaded.has('line-1'), false, 'Short untranslated "你好" must be purged');

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  await test('3.4 Checkpoint invalidated when totalLines does not match current SRT file length', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_cp_totallines_'));
    const srtFile = path.join(tempDir, 'lines.srt');
    fs.writeFileSync(srtFile, '1\n00:00:01,000 --> 00:00:02,000\nHello\n', 'utf-8');

    // Checkpoint was saved for a file with 10 lines
    saveCheckpoint(srtFile, 'vi', { 'line-0': { source: 'Hello', target: 'Xin chào' } }, 10);

    // Current file has only 1 line
    const loaded = loadCheckpoint(srtFile, 'vi', 1);
    assert.strictEqual(loaded.size, 0, 'Checkpoint must be invalidated when totalLines changes');

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  await test('3.5 2-letter non-OK untranslated words ("No", "Hi") purged from checkpoint; only "OK" / "O.K." preserved', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test_cp_no_hi_'));
    const srtFile = path.join(tempDir, 'short_words.srt');
    fs.writeFileSync(srtFile, '1\n00:00:01,000 --> 00:00:02,000\nNo\n\n2\n00:00:02,000 --> 00:00:03,000\nOK\n', 'utf-8');

    saveCheckpoint(srtFile, 'vi', {
      'line-0': { source: 'No', target: 'No' },
      'line-1': { source: 'OK', target: 'OK' },
    });

    const loaded = loadCheckpoint(srtFile, 'vi');
    assert.strictEqual(loaded.has('line-0'), false, 'Untranslated "No" must be purged from checkpoint');
    assert.strictEqual(loaded.has('line-1'), true, 'Global loanword "OK" is permitted to be preserved');

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  // ===========================================================================
  // SECTION 4: AI Clean & Deduplicate Timeline Synchronization (R2)
  // ===========================================================================
  console.log('\n--- Section 4: AI Clean & Deduplicate Timeline Synchronization ---');

  await test('4.1 Excessive duration cluster (> 7000ms) is split to protect video speech rhythm', () => {
    // 3 lines spaced 300ms apart, but spanning 9000ms in total
    const original: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 3500, text: 'Part one' },
      { startMs: 3800, endMs: 6500, text: 'Part two' },
      { startMs: 6800, endMs: 10000, text: 'Part three' }, // Total duration = 10000 - 1000 = 9000ms > 7000ms
    ];

    const aiGroups: AiGroupedSubtitle[] = [
      { sourceIndices: [0, 1, 2], text: 'Part one two three merged' },
    ];

    const result = resolveGroupedTimestamps(original, aiGroups, MAX_SUBTITLE_GAP_MS, MAX_SUBTITLE_DURATION_MS);
    assert.strictEqual(result.length, 2, 'Duration guard must split group exceeding 7000ms');
    assert.ok(result[0].endMs - result[0].startMs <= 7000, 'Cluster 1 duration <= 7000ms');
    assert.ok(result[1].endMs - result[1].startMs <= 7000, 'Cluster 2 duration <= 7000ms');
  });

  await test('4.2 Excessive line count cluster (> 4 lines) is split to prevent grouping too many sentences', () => {
    const original: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 1500, text: 'L0' },
      { startMs: 1600, endMs: 2000, text: 'L1' },
      { startMs: 2100, endMs: 2500, text: 'L2' },
      { startMs: 2600, endMs: 3000, text: 'L3' },
      { startMs: 3100, endMs: 3500, text: 'L4' }, // 5th line
    ];

    const aiGroups: AiGroupedSubtitle[] = [
      { sourceIndices: [0, 1, 2, 3, 4], text: 'Five lines merged' },
    ];

    const result = resolveGroupedTimestamps(original, aiGroups);
    assert.strictEqual(result.length, 2, 'Max lines per group guard must split clusters exceeding 4 lines');
  });

  await test('4.3 Split clusters without newlines use member items text instead of duplicating rawText', () => {
    const original: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 2000, text: 'Hello' },
      { startMs: 2100, endMs: 3000, text: 'world' },
      { startMs: 12000, endMs: 13000, text: 'How are you' },
      { startMs: 13100, endMs: 14000, text: 'today' },
    ];
    // Model merged all 4 into 1 text without newline
    const aiGroups: AiGroupedSubtitle[] = [
      { sourceIndices: [0, 1, 2, 3], text: 'Xin chào thế giới bạn thế nào hôm nay' },
    ];

    const result = resolveGroupedTimestamps(original, aiGroups);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].text, 'Hello world', 'Cluster 0 must use member items text');
    assert.strictEqual(result[1].text, 'How are you today', 'Cluster 1 must use member items text');
  });

  await test('4.4 Non-consecutive group indices ([0, 2] skipping 1) does NOT swallow intermediate line', () => {
    const original: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 1200, text: 'Line 0' },
      { startMs: 1300, endMs: 1500, text: 'Line 1' },
      { startMs: 1600, endMs: 1800, text: 'Line 2' },
    ];
    // AI groups non-consecutive indices 0 and 2 together
    const aiGroups: AiGroupedSubtitle[] = [
      { sourceIndices: [0, 2], text: 'Group 0 and 2' },
    ];

    const result = resolveGroupedTimestamps(original, aiGroups);
    // Must retain all 3 lines: cluster 0, recovered line 1, cluster 2
    assert.strictEqual(result.length, 3, 'Must retain all 3 lines without swallowing Line 1');
    assert.ok(result.some((r) => r.text === 'Line 1'), 'Line 1 must be recovered intact');
    assert.strictEqual(result[0].startMs, 1000);
    assert.strictEqual(result[1].startMs, 1300);
    assert.strictEqual(result[2].startMs, 1600);
  });

  await test('4.5 Wrapped JSON structures ({ groups: [...] }) parsed in cleanAndDeduplicateSubtitles', async () => {
    SettingsStore.set('geminiApiKey', 'test_key');
    const testClient = new OpenAI({ apiKey: 'test_key' });
    const proto = Object.getPrototypeOf(testClient.chat.completions) as any;
    const origCreate = proto.create;

    proto.create = async function () {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                groups: [
                  { sourceIndices: [0, 1], text: 'Xin chào thế giới' },
                ],
              }),
            },
          },
        ],
      };
    };

    try {
      const items: CleanSubtitlesItem[] = [
        { startMs: 1000, endMs: 2000, text: 'Xin chào' },
        { startMs: 2200, endMs: 3000, text: 'thế giới' },
      ];
      const res = await cleanAndDeduplicateSubtitles(items);
      assert.strictEqual(res.length, 1, 'Wrapped JSON object must be recognized and merged');
      assert.strictEqual(res[0].text, 'Xin chào thế giới');
      assert.strictEqual(res[0].startMs, 1000);
      assert.strictEqual(res[0].endMs, 3000);
    } finally {
      proto.create = origCreate;
    }
  });

  await test('4.6 Cross-group overlapping source indices does not truncate speech timestamps', () => {
    const original: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 2000, text: 'Line 0' },
      { startMs: 2100, endMs: 3000, text: 'Line 1' },
      { startMs: 3100, endMs: 4000, text: 'Line 2' },
    ];
    // Group 1 claims [0, 1], Group 2 erroneously also lists index 1 along with 2 ([1, 2])
    const aiGroups: AiGroupedSubtitle[] = [
      { sourceIndices: [0, 1], text: 'Group 0-1' },
      { sourceIndices: [1, 2], text: 'Group 1-2' },
    ];

    const res = resolveGroupedTimestamps(original, aiGroups);
    assert.strictEqual(res.length, 2);
    assert.strictEqual(res[0].startMs, 1000);
    assert.strictEqual(res[0].endMs, 3000, 'Group 0-1 must keep full duration of Line 0 and Line 1 without truncation');
    assert.strictEqual(res[1].startMs, 3100, 'Group 1-2 without claimed line 1 starts cleanly at line 2');
    assert.strictEqual(res[1].endMs, 4000);
  });

  // ===========================================================================
  // SECTION 5: Visual Line Wrapping & 2-Line Layout Compliance (R3)
  // ===========================================================================
  console.log('\n--- Section 5: Visual Line Wrapping & 2-Line Layout Compliance ---');

  await test('5.1 Sentences between 75-80 chars wrap into exactly 2 lines using 37-40 char limit (no 3rd line)', () => {
    // 78-char sentence that previously broke into 3 lines
    const testLine: SrtLine = {
      id: 'wrap-78',
      startMs: 1000,
      endMs: 5000,
      text: 'Mô hình trí tuệ nhân tạo mới đem lại hiệu quả vượt trội cho tương lai này nhé.',
      speaker: 'SPEAKER_00',
    };

    const res = applyVisualLineWrapping([testLine], true);
    assert.strictEqual(res.length, 1);
    const sublines = res[0].text.split('\n');
    assert.ok(sublines.length <= 2, `Expected at most 2 lines, got ${sublines.length}`);
    for (const sub of sublines) {
      assert.ok(sub.trim().length <= 42, `Line length ${sub.length} exceeds allowed range`);
    }
  });

  await test('5.2 Pre-existing 3-line input is consolidated and wrapped into 2 lines', () => {
    const testLine: SrtLine = {
      id: 'pre-3',
      startMs: 1000,
      endMs: 4000,
      text: 'Dòng thứ nhất ngắn\nDòng thứ hai cũng ngắn\nDòng thứ ba kết thúc câu này.',
      speaker: 'SPEAKER_00',
    };

    const res = applyVisualLineWrapping([testLine], true);
    const sublines = res[0].text.split('\n');
    assert.strictEqual(sublines.length, 2, `Pre-existing 3 lines should re-wrap into 2 lines (got ${sublines.length})`);
    assert.ok(sublines[0].length <= 40, `Subline 0 (${sublines[0].length}) <= 40`);
    assert.ok(sublines[1].length <= 40, `Subline 1 (${sublines[1].length}) <= 40`);
  });

  await test('5.3 System prompts explicitly enforce concise movie style, 100% completeness and 2-line limit', () => {
    const prompt = buildSystemPrompt('vi');
    assert.ok(prompt.includes('tối đa 2 dòng hiển thị'), 'Prompt must specify max 2 lines');
    assert.ok(prompt.includes('37-40 ký tự'), 'Prompt must specify 37-40 chars limit');
    assert.ok(prompt.includes('TOÀN VẸN 100%'), 'Prompt must require 100% completeness');
    assert.ok(prompt.includes('BẢO TOÀN ID'), 'Prompt must enforce ID preservation');

    const retryPrompt = buildRetrySystemPrompt('vi', 10);
    assert.ok(retryPrompt.includes('chính xác 10 câu'), 'Retry prompt must state exact line count');
    assert.ok(retryPrompt.includes('tối đa 2 dòng hiển thị'), 'Retry prompt must enforce 2 lines');
  });

  await test('5.4 81-character complex sentence wraps into exactly 2 lines (no 3rd or 4th line)', () => {
    const testLine: SrtLine = {
      id: 'wrap-81',
      startMs: 1000,
      endMs: 5000,
      text: 'Tôi muốn giới thiệu với tất cả các bạn một sản phẩm công nghệ vô cùng tuyệt vời.',
      speaker: 'SPEAKER_00',
    };

    const res = applyVisualLineWrapping([testLine], true);
    assert.strictEqual(res.length, 1);
    const sublines = res[0].text.split('\n');
    assert.strictEqual(sublines.length, 2, `81-char sentence must wrap into exactly 2 lines, got ${sublines.length}`);
    for (const sub of sublines) {
      assert.ok(sub.trim().length <= 42, `Subline length ${sub.length} must be <= 42`);
    }
  });

  await test('5.5 86-character sentence wraps into exactly 2 balanced lines without 3-line layout overflow', () => {
    const testLine: SrtLine = {
      id: 'wrap-86',
      startMs: 1000,
      endMs: 5000,
      text: 'Chúng tôi đang nỗ lực hết mình để đem đến cho các bạn những giải pháp công nghệ tốt nhất.',
      speaker: 'SPEAKER_00',
    };

    const res = applyVisualLineWrapping([testLine], true);
    assert.strictEqual(res.length, 1);
    const sublines = res[0].text.split('\n');
    assert.strictEqual(sublines.length, 2, `86-char sentence must wrap into exactly 2 lines, got ${sublines.length}`);
    for (const sub of sublines) {
      assert.ok(sub.trim().length <= 46, `Subline length ${sub.length} must be <= 46`);
    }
  });

  await test('5.6 94-character sentence wraps into exactly 2 balanced lines without 3-line layout overflow', () => {
    const testLine: SrtLine = {
      id: 'wrap-94',
      startMs: 1000,
      endMs: 6000,
      text: 'Trường Đại học Bách khoa Hà Nội vừa tổ chức lễ trao giải thưởng nghiên cứu khoa học sinh viên.',
      speaker: 'SPEAKER_00',
    };

    const res = applyVisualLineWrapping([testLine], true);
    assert.strictEqual(res.length, 1);
    const sublines = res[0].text.split('\n');
    assert.strictEqual(sublines.length, 2, `94-char sentence must wrap into exactly 2 lines, got ${sublines.length}`);
    for (const sub of sublines) {
      assert.ok(sub.trim().length <= 52, `Subline length ${sub.length} must be <= 52`);
    }
  });

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n================================================================================');
  console.log(`📊 TEST SUITE SUMMARY: ${passedTests}/${totalTests} tests passed`);
  console.log('================================================================================\n');

  if (failures.length > 0) {
    console.error('FAILURES:');
    failures.forEach((f) => console.error(` - ${f}`));
    process.exit(1);
  } else {
    console.log('🎉 ALL RESILIENCE AND LAYOUT TESTS PASSED PERFECTLY!');
  }
}

runSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
