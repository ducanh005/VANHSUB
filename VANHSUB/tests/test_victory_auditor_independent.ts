import fs from 'fs';
import path from 'path';
import os from 'os';
import assert from 'assert';
import { parseSrt, serializeSrt, SrtLine } from '../main/lib/srt';
import {
  extractAndNormalizeTranslationBatch,
  applyVisualLineWrapping,
  buildSystemPrompt,
  buildRetrySystemPrompt,
  loadCheckpoint,
  saveCheckpoint,
  getCheckpointPath,
} from '../main/translate/translator';
import {
  resolveGroupedTimestamps,
  MAX_SUBTITLE_GAP_MS,
  MAX_SUBTITLE_DURATION_MS,
  MAX_LINES_PER_GROUP,
  CleanSubtitlesItem,
  AiGroupedSubtitle,
} from '../main/ai/geminiClient';

let totalTests = 0;
let passedTests = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      throw new Error('Async test must be awaited');
    }
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] ${name}`);
    console.error(`     Error: ${err.message || err}`);
    failures.push(`${name}: ${err.message || err}`);
  }
}

async function runAudit() {
  console.log('================================================================');
  console.log('VICTORY AUDITOR INDEPENDENT ADVERSARIAL VERIFICATION SUITE');
  console.log('================================================================\n');

  // --- R1: Flexible JSON & Integrity ---
  console.log('--- R1: Translation Normalization, ID Variants & Integrity ---');

  const expected3 = [
    { i: 'line-0', text: 'Good morning' },
    { i: 'line-1', text: 'Welcome to the presentation' },
    { i: 'line-2', text: 'Thank you for attending' },
  ];

  test('R1.1 Numeric 0 does not get dropped by falsy check', () => {
    const raw = JSON.stringify([
      { i: 0, text: 'Chào buổi sáng' },
      { i: 1, text: 'Chào mừng bạn đến với bài thuyết trình' },
      { i: 2, text: 'Cảm ơn đã tham dự' },
    ]);
    const res = extractAndNormalizeTranslationBatch(raw, expected3);
    assert.strictEqual(res.get('line-0'), 'Chào buổi sáng');
    assert.strictEqual(res.get('line-1'), 'Chào mừng bạn đến với bài thuyết trình');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn đã tham dự');
  });

  test('R1.2 1-based indexing mapped properly to zero-indexed expected lines', () => {
    const raw = JSON.stringify([
      { index: 1, translation: 'Chào buổi sáng' },
      { index: 2, translation: 'Chào mừng' },
      { index: 3, translation: 'Cảm ơn' },
    ]);
    const res = extractAndNormalizeTranslationBatch(raw, expected3);
    assert.strictEqual(res.get('line-0'), 'Chào buổi sáng');
    assert.strictEqual(res.get('line-1'), 'Chào mừng');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn');
  });

  test('R1.3 Wrapped JSON envelope with custom root key', () => {
    const raw = JSON.stringify({
      status: 'success',
      subtitles: [
        { id: 'line-0', text: 'Chào buổi sáng' },
        { id: 'line-1', text: 'Chào mừng' },
        { id: 'line-2', text: 'Cảm ơn' },
      ],
    });
    const res = extractAndNormalizeTranslationBatch(raw, expected3);
    assert.strictEqual(res.size, 3);
    assert.strictEqual(res.get('line-0'), 'Chào buổi sáng');
  });

  test('R1.4 Plain numbered text lines fallback', () => {
    const raw = '1. Chào buổi sáng\n2. Chào mừng bạn\n3. Cảm ơn bạn rất nhiều';
    const res = extractAndNormalizeTranslationBatch(raw, expected3);
    assert.strictEqual(res.size, 3);
    assert.strictEqual(res.get('line-0'), 'Chào buổi sáng');
    assert.strictEqual(res.get('line-1'), 'Chào mừng bạn');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn bạn rất nhiều');
  });

  test('R1.5 Multiple markdown code blocks concatenated', () => {
    const raw = `Đoạn 1:\n\`\`\`json\n[{"i": "line-0", "text": "Chào buổi sáng"}]\n\`\`\`\nĐoạn 2:\n\`\`\`json\n[{"i": "line-1", "text": "Chào mừng"}, {"i": "line-2", "text": "Cảm ơn"}]\n\`\`\``;
    const res = extractAndNormalizeTranslationBatch(raw, expected3);
    assert.strictEqual(res.size, 3);
    assert.strictEqual(res.get('line-0'), 'Chào buổi sáng');
    assert.strictEqual(res.get('line-1'), 'Chào mừng');
    assert.strictEqual(res.get('line-2'), 'Cảm ơn');
  });

  test('R1.6 Partial response detection triggers integrity failure (missing line)', () => {
    const raw = JSON.stringify([
      { i: 'line-0', text: 'Chào buổi sáng' },
      { i: 'line-1', text: 'Chào mừng' },
      // line-2 is missing!
    ]);
    const res = extractAndNormalizeTranslationBatch(raw, expected3);
    assert.strictEqual(res.size, 2);
    // In translator.ts, the missing items filter triggers:
    const missing = expected3.filter((it) => !res.get(it.i) || !res.get(it.i)!.trim());
    assert.strictEqual(missing.length, 1);
    assert.strictEqual(missing[0].i, 'line-2');
  });

  test('R1.7 Checkpoint purges untranslated source fallback', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auditor-cp-'));
    const srtFile = path.join(tmpDir, 'test.srt');
    fs.writeFileSync(srtFile, '1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nGood morning\n', 'utf-8');

    // Save checkpoint where line-0 is untranslated (source === target === 'Hello')
    saveCheckpoint(srtFile, 'vi', {
      'line-0': { source: 'Hello', target: 'Hello' },
      'line-1': { source: 'Good morning', target: 'Chào buổi sáng' },
    }, 2);

    const loaded = loadCheckpoint(srtFile, 'vi', 2);
    // line-0 must be discarded from checkpoint!
    assert.strictEqual(loaded.has('line-0'), false, 'Untranslated fallback in checkpoint must be purged');
    assert.strictEqual(loaded.has('line-1'), true, 'Valid translation must be retained');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('R1.8 Checkpoint invalidated when SRT line count changes', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auditor-cp2-'));
    const srtFile = path.join(tmpDir, 'test2.srt');
    fs.writeFileSync(srtFile, '1\n00:00:01,000 --> 00:00:02,000\nHello\n', 'utf-8');

    saveCheckpoint(srtFile, 'vi', {
      'line-0': { source: 'Hello', target: 'Xin chào' },
    }, 5); // Checkpoint was created for a 5-line file

    // Current file has 1 line
    const loaded = loadCheckpoint(srtFile, 'vi', 1);
    assert.strictEqual(loaded.size, 0, 'Checkpoint must be invalidated when line count mismatches');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- R2: Timeline 1:1 Synchronization ---
  console.log('\n--- R2: Timeline 1:1 Synchronization & Deduplication Bounds ---');

  test('R2.1 Deduplication splits excessive duration cluster (> 7000ms)', () => {
    const original: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 3000, text: 'Câu thứ nhất' },
      { startMs: 3200, endMs: 5500, text: 'Câu thứ hai' },
      { startMs: 5700, endMs: 8500, text: 'Câu thứ ba' }, // total duration 1000 -> 8500 = 7500ms > 7000ms
    ];
    const aiGroup: AiGroupedSubtitle[] = [
      { sourceIndices: [0, 1, 2], text: 'Câu một hai ba gộp lại' },
    ];
    const resolved = resolveGroupedTimestamps(original, aiGroup);
    assert.strictEqual(resolved.length, 2, 'Must split into 2 clusters because duration > 7000ms');
    assert.strictEqual(resolved[0].startMs, 1000);
    assert.strictEqual(resolved[0].endMs, 5500);
    assert.strictEqual(resolved[1].startMs, 5700);
    assert.strictEqual(resolved[1].endMs, 8500);
  });

  test('R2.2 Deduplication splits excessive line count cluster (> 4 lines)', () => {
    const original: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 1500, text: 'Một' },
      { startMs: 1600, endMs: 2000, text: 'Hai' },
      { startMs: 2100, endMs: 2500, text: 'Ba' },
      { startMs: 2600, endMs: 3000, text: 'Bốn' },
      { startMs: 3100, endMs: 3500, text: 'Năm' }, // 5 lines > 4 lines MAX_LINES_PER_GROUP
    ];
    const aiGroup: AiGroupedSubtitle[] = [
      { sourceIndices: [0, 1, 2, 3, 4], text: 'Một hai ba bốn năm' },
    ];
    const resolved = resolveGroupedTimestamps(original, aiGroup);
    assert.strictEqual(resolved.length, 2, 'Must split because group has 5 lines > 4 max lines');
    assert.strictEqual(resolved[0].startMs, 1000);
    assert.strictEqual(resolved[0].endMs, 3000);
    assert.strictEqual(resolved[1].startMs, 3100);
    assert.strictEqual(resolved[1].endMs, 3500);
  });

  test('R2.3 Deduplication preserves missing lines when AI omits them', () => {
    const original: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 2000, text: 'Dòng 0' },
      { startMs: 2500, endMs: 3500, text: 'Dòng 1' },
      { startMs: 4000, endMs: 5000, text: 'Dòng 2' },
    ];
    // AI only groups [0, 1], omits index 2:
    const aiGroup: AiGroupedSubtitle[] = [
      { sourceIndices: [0, 1], text: 'Dòng 0 và 1 gộp' },
    ];
    const resolved = resolveGroupedTimestamps(original, aiGroup);
    assert.strictEqual(resolved.length, 2, 'Must retain both group [0,1] and recovered line 2');
    assert.strictEqual(resolved[0].startMs, 1000);
    assert.strictEqual(resolved[0].endMs, 3500);
    assert.strictEqual(resolved[1].startMs, 4000);
    assert.strictEqual(resolved[1].endMs, 5000);
    assert.strictEqual(resolved[1].text, 'Dòng 2');
  });

  // --- R3: 2-Line Layout Constraint & Visual Wrapping ---
  console.log('\n--- R3: Layout Compliance (Max 2 Lines, <= 37-40 Chars/Line) ---');

  test('R3.1 Sentence between 74-80 chars wraps into exactly 2 lines', () => {
    const longText = 'Hội đồng quản trị công ty đã thông qua kế hoạch phát triển kinh doanh năm 2026.';
    assert.ok(longText.length >= 75 && longText.length <= 80, `Length is ${longText.length}`);

    const line: SrtLine = { id: 'line-0', startMs: 1000, endMs: 4000, text: longText };
    const wrapped = applyVisualLineWrapping([line], true)[0];
    const sublines = wrapped.text.split('\n');

    assert.strictEqual(sublines.length, 2, `Must be exactly 2 lines, got ${sublines.length}: ${JSON.stringify(sublines)}`);
    assert.ok(sublines[0].length <= 42, `Line 1 length ${sublines[0].length} exceeds 42`);
    assert.ok(sublines[1].length <= 42, `Line 2 length ${sublines[1].length} exceeds 42`);
    assert.strictEqual(wrapped.startMs, 1000);
    assert.strictEqual(wrapped.endMs, 4000);
    assert.strictEqual(wrapped.id, 'line-0');
  });

  test('R3.2 Sentence between 84-90 chars wraps into exactly 2 lines (no 3rd line overflow)', () => {
    const text86 = 'Các chuyên gia kinh tế hàng đầu dự báo thị trường chứng khoán sẽ khởi sắc mạnh mẽ.';
    assert.ok(text86.length >= 80 && text86.length <= 90, `Length is ${text86.length}`);

    const line: SrtLine = { id: 'line-0', startMs: 1000, endMs: 5000, text: text86 };
    const wrapped = applyVisualLineWrapping([line], true)[0];
    const sublines = wrapped.text.split('\n');

    assert.strictEqual(sublines.length, 2, `Must be exactly 2 lines, got ${sublines.length}: ${JSON.stringify(sublines)}`);
    assert.ok(sublines.every((s) => s.length <= 52), 'Sublines must not exceed maximum balanced width');
  });

  test('R3.3 Sentence of 94 chars wraps into exactly 2 balanced lines', () => {
    const text94 = 'Trường Đại học Bách khoa Hà Nội vừa tổ chức lễ trao giải thưởng nghiên cứu khoa học sinh viên.';
    assert.strictEqual(text94.length, 94);

    const line: SrtLine = { id: 'line-0', startMs: 1000, endMs: 6000, text: text94 };
    const wrapped = applyVisualLineWrapping([line], true)[0];
    const sublines = wrapped.text.split('\n');

    assert.strictEqual(sublines.length, 2, `Must be exactly 2 lines, got ${sublines.length}: ${JSON.stringify(sublines)}`);
  });

  test('R3.4 Strict 1:1 invariant: Line count, startMs, endMs, id, speaker untouched', () => {
    const lines: SrtLine[] = [
      { id: 'sub-0', startMs: 1200, endMs: 3400, speaker: 'SPEAKER_00', text: 'Xin chào các bạn.' },
      { id: 'sub-1', startMs: 3500, endMs: 6000, speaker: 'SPEAKER_01', text: 'Chào mừng các bạn đã quay trở lại với kênh công nghệ của chúng tôi hôm nay.' },
    ];

    const wrapped = applyVisualLineWrapping(lines, true);
    assert.strictEqual(wrapped.length, 2);
    assert.strictEqual(wrapped[0].id, 'sub-0');
    assert.strictEqual(wrapped[0].startMs, 1200);
    assert.strictEqual(wrapped[0].endMs, 3400);
    assert.strictEqual(wrapped[0].speaker, 'SPEAKER_00');

    assert.strictEqual(wrapped[1].id, 'sub-1');
    assert.strictEqual(wrapped[1].startMs, 3500);
    assert.strictEqual(wrapped[1].endMs, 6000);
    assert.strictEqual(wrapped[1].speaker, 'SPEAKER_01');
    assert.strictEqual(wrapped[1].text.split('\n').length, 2);
  });

  console.log('\n================================================================');
  console.log(`INDEPENDENT AUDIT SUMMARY: ${passedTests}/${totalTests} tests passed (${failures.length} failures)`);
  console.log('================================================================');

  if (failures.length > 0) {
    process.exit(1);
  }
}

runAudit();
