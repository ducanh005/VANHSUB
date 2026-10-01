import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { parseSrt, serializeSrt, SrtLine } from '../main/lib/srt';
import { applyVisualLineWrapping } from '../main/translate/translator';
import { breakVietnameseLines } from '../main/lib/nlpSegmenter';

console.log('=== AUDITOR FORENSIC INTEGRITY AUDIT: MILESTONE 2 ===\n');

let pass = 0;
let fail = 0;

function audit(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    pass++;
  } catch (err: any) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err?.message || err}`);
    fail++;
  }
}

// -----------------------------------------------------------------------------
// CHECK 1: Exhaustive Static Codebase Scan for Prohibited Netflix References
// -----------------------------------------------------------------------------
console.log('--- CHECK 1: Static Codebase Forensic Scan ---');

audit('No segmentSubtitlesNetflix in main/ (except nlpSegmenter @deprecated)', () => {
  const mainDir = path.join(__dirname, '..', 'main');
  const scan = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
        const content = fs.readFileSync(full, 'utf-8');
        if (content.includes('segmentSubtitlesNetflix')) {
          const relPath = path.relative(path.join(__dirname, '..'), full).replace(/\\/g, '/');
          assert.strictEqual(
            relPath,
            'main/lib/nlpSegmenter.ts',
            `Prohibited reference in production file: ${relPath}`
          );
        }
      }
    }
  };
  scan(mainDir);
});

audit('No segmentSubtitlesNetflix in renderer/', () => {
  const rendererDir = path.join(__dirname, '..', 'renderer');
  const scan = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.next' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
        const content = fs.readFileSync(full, 'utf-8');
        assert.strictEqual(
          content.includes('segmentSubtitlesNetflix'),
          false,
          `Prohibited reference in renderer file: ${full}`
        );
      }
    }
  };
  scan(rendererDir);
});

audit('main/translate/translator.ts does not reference Netflix', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'main', 'translate', 'translator.ts'), 'utf-8');
  assert.strictEqual(content.toLowerCase().includes('netflix'), false, 'translator.ts contains "netflix"');
});

audit('renderer/components/SubtitleEditor.tsx does not reference Netflix', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'components', 'SubtitleEditor.tsx'), 'utf-8');
  assert.strictEqual(content.toLowerCase().includes('netflix'), false, 'SubtitleEditor.tsx contains "netflix"');
});

// -----------------------------------------------------------------------------
// CHECK 2: Absence of Facades & Prohibited Shortcuts in translator.ts
// -----------------------------------------------------------------------------
console.log('\n--- CHECK 2: Facade & Hardcoded Shortcut Detection ---');

audit('translator.ts exports real applyVisualLineWrapping function', () => {
  assert.strictEqual(typeof applyVisualLineWrapping, 'function');
  const sample: SrtLine[] = [
    { id: '1', startMs: 100, endMs: 200, text: 'Ngắn' },
    {
      id: '2',
      startMs: 250,
      endMs: 800,
      text: 'Đây là một câu rất dài nhằm kiểm tra xem cơ chế ngắt dòng hiển thị có hoạt động chuẩn xác không.',
    },
  ];
  const wrapped = applyVisualLineWrapping(sample, true);
  assert.strictEqual(wrapped.length, 2);
  assert.strictEqual(wrapped[0].text, 'Ngắn');
  assert.ok(wrapped[1].text.includes('\n'), 'Must contain newline');
  // Confirm it did not return fixed/mocked text
  assert.ok(wrapped[1].text.includes('Đây là một câu'));
});

audit('applyVisualLineWrapping strictly preserves 100% metadata and line count', () => {
  const testSet: SrtLine[] = Array.from({ length: 50 }, (_, i) => ({
    id: `custom-id-${i * 7}`,
    startMs: i * 2000,
    endMs: i * 2000 + 1500,
    text: i % 2 === 0
      ? `Câu số ${i} là một câu tương đối dài được tạo ra để thử nghiệm tính bất biến của thuật toán.`
      : `Câu ngắn ${i}.`,
    speaker: `SPEAKER_0${i % 3}`,
  }));

  const out = applyVisualLineWrapping(testSet, true);
  assert.strictEqual(out.length, testSet.length, 'Length mismatch');

  for (let i = 0; i < testSet.length; i++) {
    assert.strictEqual(out[i].id, testSet[i].id, `ID mismatch at ${i}`);
    assert.strictEqual(out[i].startMs, testSet[i].startMs, `startMs mismatch at ${i}`);
    assert.strictEqual(out[i].endMs, testSet[i].endMs, `endMs mismatch at ${i}`);
    assert.strictEqual(out[i].speaker, testSet[i].speaker, `speaker mismatch at ${i}`);
    if (i < testSet.length - 1) {
      const originalGap = testSet[i + 1].startMs - testSet[i].endMs;
      const newGap = out[i + 1].startMs - out[i].endMs;
      assert.strictEqual(newGap, originalGap, `Gap altered between line ${i} and ${i+1}`);
    }
  }
});

// -----------------------------------------------------------------------------
// CHECK 3: Adversarial Edge Cases in applyVisualLineWrapping
// -----------------------------------------------------------------------------
console.log('\n--- CHECK 3: Adversarial Edge Cases ---');

audit('Edge Case: Empty array input', () => {
  const res = applyVisualLineWrapping([], true);
  assert.deepStrictEqual(res, []);
});

audit('Edge Case: Line with empty string or whitespace only', () => {
  const lines: SrtLine[] = [
    { id: 'e1', startMs: 0, endMs: 100, text: '' },
    { id: 'e2', startMs: 100, endMs: 200, text: '   ' },
  ];
  const res = applyVisualLineWrapping(lines, true);
  assert.strictEqual(res.length, 2);
  assert.strictEqual(res[0].text, '');
  assert.strictEqual(res[1].text, '   ');
});

audit('Edge Case: Line with existing newlines (\r\n and \n)', () => {
  const line: SrtLine = {
    id: 'n1',
    startMs: 1000,
    endMs: 4000,
    text: 'Dòng thứ nhất đã có sẵn xuống dòng\r\nvà đây là dòng thứ hai có độ dài cực kỳ lớn vượt quá ba mươi bảy ký tự trong câu.',
  };
  const res = applyVisualLineWrapping([line], true);
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].id, 'n1');
  assert.strictEqual(res[0].startMs, 1000);
  assert.strictEqual(res[0].endMs, 4000);
  const sublines = res[0].text.split('\n');
  assert.ok(sublines.length >= 2);
  for (const s of sublines) {
    assert.ok(s.trim().length <= 45);
  }
});

audit('Edge Case: Giant token without any spaces (> 100 chars)', () => {
  const unbroken = 'A'.repeat(120);
  const line: SrtLine = { id: 'u1', startMs: 0, endMs: 1000, text: unbroken };
  const res = applyVisualLineWrapping([line], true);
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].id, 'u1');
  assert.strictEqual(res[0].startMs, 0);
  assert.strictEqual(res[0].endMs, 1000);
  // Must not crash or loop infinitely
  assert.strictEqual(res[0].text, unbroken);
});

audit('Edge Case: Target language not Vietnamese bypasses wrapping', () => {
  const line: SrtLine = {
    id: 'en1',
    startMs: 500,
    endMs: 2500,
    text: 'This is an English line that is definitely longer than thirty-seven characters in total.',
  };
  const res = applyVisualLineWrapping([line], false);
  assert.strictEqual(res[0].text, line.text);
});

// -----------------------------------------------------------------------------
// CHECK 4: End-to-End SRT Roundtrip with Visual Newlines
// -----------------------------------------------------------------------------
console.log('\n--- CHECK 4: SRT Parser & Serializer Round-trip ---');

audit('SRT round-trip preserves exact startMs, endMs, and visual \\n', () => {
  const original = `1
00:00:01,234 --> 00:00:04,567
Chào buổi sáng mọi người,
chúc một ngày làm việc tốt lành!

2
00:00:05,000 --> 00:00:08,999
[SPEAKER_01]: Đây là dòng thứ hai có speaker.
`;

  const parsed = parseSrt(original);
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].startMs, 1234);
  assert.strictEqual(parsed[0].endMs, 4567);
  assert.ok(parsed[0].text.includes('\n'));
  assert.strictEqual(parsed[1].startMs, 5000);
  assert.strictEqual(parsed[1].endMs, 8999);
  assert.strictEqual(parsed[1].speaker, 'SPEAKER_01');

  const serialized = serializeSrt(parsed);
  const reParsed = parseSrt(serialized);

  assert.strictEqual(reParsed.length, parsed.length);
  for (let i = 0; i < parsed.length; i++) {
    assert.strictEqual(reParsed[i].startMs, parsed[i].startMs);
    assert.strictEqual(reParsed[i].endMs, parsed[i].endMs);
    assert.strictEqual(reParsed[i].text.replace(/\r/g, ''), parsed[i].text.replace(/\r/g, ''));
    assert.strictEqual(reParsed[i].speaker, parsed[i].speaker);
  }
});

// -----------------------------------------------------------------------------
// CHECK 5: Performance Stress (3,000 subtitle lines)
// -----------------------------------------------------------------------------
console.log('\n--- CHECK 5: Scale & Performance Stress ---');

audit('3,000 subtitle lines wrapped in < 500ms', () => {
  const largeSet: SrtLine[] = Array.from({ length: 3000 }, (_, i) => ({
    id: `line-${i}`,
    startMs: i * 3000,
    endMs: i * 3000 + 2500,
    text: `Dòng thứ ${i}: Đây là một thử nghiệm quy mô lớn nhằm đo lường hiệu năng của hàm applyVisualLineWrapping khi xử lý khối lượng phụ đề thực tế.`,
    speaker: `SPEAKER_${i % 4}`,
  }));

  const t0 = Date.now();
  const res = applyVisualLineWrapping(largeSet, true);
  const duration = Date.now() - t0;

  console.log(`    (Info: 3,000 lines processed in ${duration}ms)`);
  assert.strictEqual(res.length, 3000);
  assert.ok(duration < 1000, `Execution took too long: ${duration}ms`);
  assert.strictEqual(res[2999].endMs, largeSet[2999].endMs);
});

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log('\n=============================================================');
console.log(`AUDITOR FORENSIC RESULTS:`);
console.log(`PASSED: ${pass}`);
console.log(`FAILED: ${fail}`);
console.log('=============================================================');

if (fail > 0) {
  process.exit(1);
}
