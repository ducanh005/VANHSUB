import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { parseSrt, serializeSrt, type SrtLine } from '../main/lib/srt';
import { breakVietnameseLines, segmentSubtitlesNetflix } from '../main/lib/nlpSegmenter';
import { applyVisualLineWrapping } from '../main/translate/translator';

console.log('=== TEST SUITE: MILESTONE 2 - CLEAN REMOVAL OF NETFLIX SLICING & 1-1 TRANSLATION PRESERVATION ===\n');

let passCount = 0;
let failCount = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(
        () => {
          console.log(`  ✓ PASS: ${name}`);
          passCount++;
        },
        (err) => {
          console.error(`  ✗ FAIL: ${name}`);
          console.error(err);
          failCount++;
        }
      );
    } else {
      console.log(`  ✓ PASS: ${name}`);
      passCount++;
    }
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    failCount++;
  }
}

async function main() {
  // =========================================================================
  // TEST GROUP 1: Static Codebase Audit (Zero Netflix in Production)
  // =========================================================================
  console.log('--- Test Group 1: Static Codebase Audit ---');

  runTest('1.1 Zero import or call to segmentSubtitlesNetflix in main/translate/', () => {
    const dir = path.join(__dirname, '..', 'main', 'translate');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      assert.strictEqual(
        content.includes('segmentSubtitlesNetflix'),
        false,
        `File main/translate/${file} still references segmentSubtitlesNetflix!`
      );
    }
  });

  runTest('1.2 Zero import or call to segmentSubtitlesNetflix in main/asr/', () => {
    const dir = path.join(__dirname, '..', 'main', 'asr');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      assert.strictEqual(
        content.includes('segmentSubtitlesNetflix'),
        false,
        `File main/asr/${file} still references segmentSubtitlesNetflix!`
      );
    }
  });

  runTest('1.3 Zero import or call to segmentSubtitlesNetflix in renderer/ (components & lib)', () => {
    const checkDirRecursive = (dirPath: string) => {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.next' || entry.name === 'node_modules') continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          checkDirRecursive(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js'))) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          assert.strictEqual(
            content.includes('segmentSubtitlesNetflix'),
            false,
            `File ${fullPath} still references segmentSubtitlesNetflix!`
          );
        }
      }
    };
    checkDirRecursive(path.join(__dirname, '..', 'renderer'));
  });

  runTest('1.4 SubtitleEditor.tsx has removed Netflix button and Ctrl+Shift+N shortcut', () => {
    const editorPath = path.join(__dirname, '..', 'renderer', 'components', 'SubtitleEditor.tsx');
    const content = fs.readFileSync(editorPath, 'utf-8');
    assert.strictEqual(content.includes('handleNetflixNormalize'), false, 'handleNetflixNormalize must be removed');
    assert.strictEqual(content.includes('Chuẩn hoá Netflix (NLP)'), false, 'Chuẩn hoá Netflix toolbar button must be removed');
    assert.strictEqual(content.includes('KeyN'), false, 'Ctrl+Shift+N shortcut must be removed');
    assert.strictEqual(content.includes('handleVisualWrapLines'), true, 'handleVisualWrapLines must be present');
    assert.strictEqual(content.includes('Ngắt dòng hiển thị (\\n)'), true, 'Ngắt dòng hiển thị toolbar button must be present');
  });

  runTest('1.5 segmentSubtitlesNetflix in main/lib/nlpSegmenter.ts is marked @deprecated', () => {
    const nlpPath = path.join(__dirname, '..', 'main', 'lib', 'nlpSegmenter.ts');
    const content = fs.readFileSync(nlpPath, 'utf-8');
    assert.strictEqual(content.includes('@deprecated'), true, '@deprecated annotation must be present');
    assert.strictEqual(typeof segmentSubtitlesNetflix, 'function', 'segmentSubtitlesNetflix must still be exported for legacy tests');
  });

  // =========================================================================
  // TEST GROUP 2: Translation 1-1 Line Count, StartMs, EndMs, Speaker Fidelity
  // =========================================================================
  console.log('\n--- Test Group 2: Translation 1-1 Fidelity Invariant ---');

  const mockOriginalLines: SrtLine[] = [
    {
      id: 'line-0',
      startMs: 1200,
      endMs: 3450,
      text: 'Good morning everyone, welcome to the demonstration.',
      speaker: 'SPEAKER_00',
    },
    {
      id: 'line-1',
      startMs: 3800,
      endMs: 6900,
      text: 'Today we will showcase the new subtitle pipeline without any Netflix time shifting.',
      speaker: 'SPEAKER_01',
    },
    {
      id: 'line-2',
      startMs: 7100,
      endMs: 9500,
      text: 'Notice that timestamps remain completely untouched.',
      speaker: 'SPEAKER_00',
    },
    {
      id: 'line-3',
      startMs: 10000,
      endMs: 14200,
      text: 'Even when lines are quite long and need visual newline wrapping, no new blocks are created.',
      speaker: 'SPEAKER_01',
    },
    {
      id: 'line-4',
      startMs: 15000,
      endMs: 18000,
      text: 'End of test segment.',
      speaker: 'SPEAKER_00',
    },
  ];

  // Simulated translated text mapped 1-1 by id
  const mockTranslatedTexts: Record<string, string> = {
    'line-0': 'Chào buổi sáng mọi người, chào mừng đến với buổi minh họa.', // 57 chars (>37)
    'line-1': 'Hôm nay chúng ta sẽ trình diễn pipeline phụ đề mới không còn cắt câu Netflix.', // 77 chars (>37)
    'line-2': 'Hãy chú ý rằng các mốc thời gian được giữ nguyên hoàn toàn.', // 59 chars (>37)
    'line-3': 'Ngay cả khi các dòng khá dài và cần ngắt dòng hiển thị, không có khối mới nào được tạo ra.', // 90 chars (>37)
    'line-4': 'Kết thúc đoạn kiểm thử.', // 24 chars (<=37)
  };

  const translatedLines: SrtLine[] = mockOriginalLines.map((line) => ({
    ...line,
    text: mockTranslatedTexts[line.id] ?? line.text,
  }));

  const finalProcessedLines = applyVisualLineWrapping(translatedLines, true);

  runTest('2.1 Strict 1-1 line count preservation', () => {
    assert.strictEqual(
      finalProcessedLines.length,
      mockOriginalLines.length,
      `Expected exactly ${mockOriginalLines.length} lines, got ${finalProcessedLines.length}`
    );
  });

  runTest('2.2 Strict startMs and endMs identity for every line', () => {
    for (let i = 0; i < mockOriginalLines.length; i++) {
      const orig = mockOriginalLines[i];
      const final = finalProcessedLines[i];
      assert.strictEqual(
        final.startMs,
        orig.startMs,
        `Line ${i}: startMs changed from ${orig.startMs} to ${final.startMs}!`
      );
      assert.strictEqual(
        final.endMs,
        orig.endMs,
        `Line ${i}: endMs changed from ${orig.endMs} to ${final.endMs}!`
      );
      assert.strictEqual(
        final.id,
        orig.id,
        `Line ${i}: id changed from ${orig.id} to ${final.id}!`
      );
    }
  });

  runTest('2.3 Strict speaker diarization label fidelity', () => {
    for (let i = 0; i < mockOriginalLines.length; i++) {
      const orig = mockOriginalLines[i];
      const final = finalProcessedLines[i];
      assert.strictEqual(
        final.speaker,
        orig.speaker,
        `Line ${i}: speaker label altered from ${orig.speaker} to ${final.speaker}!`
      );
    }
  });

  runTest('2.4 Zero artificial gap injection (Netflix 80ms minGapMs eliminated)', () => {
    for (let i = 0; i < mockOriginalLines.length - 1; i++) {
      const origGap = mockOriginalLines[i + 1].startMs - mockOriginalLines[i].endMs;
      const finalGap = finalProcessedLines[i + 1].startMs - finalProcessedLines[i].endMs;
      assert.strictEqual(
        finalGap,
        origGap,
        `Acoustic gap between line ${i} and ${i + 1} changed from ${origGap}ms to ${finalGap}ms!`
      );
    }
  });

  // Compare with old Netflix segmentation to demonstrate contrast
  runTest('2.5 Contrast against deprecated segmentSubtitlesNetflix', () => {
    const netflixLines = segmentSubtitlesNetflix(translatedLines);
    // Deprecated Netflix slicing alters line count and timecodes
    console.log(`    (Info: Old Netflix produced ${netflixLines.length} lines from ${translatedLines.length} original lines)`);
    // Our 1-1 pipeline preserves exactly translatedLines.length
    assert.strictEqual(finalProcessedLines.length, translatedLines.length);
  });

  // =========================================================================
  // TEST GROUP 3: Visual Line Wrapping (\n) Invariants
  // =========================================================================
  console.log('\n--- Test Group 3: Visual Line Wrapping (\\n) Invariants ---');

  runTest('3.1 Short lines (<= 37 chars) remain single line without newline', () => {
    const shortLine: SrtLine = {
      id: 'short-1',
      startMs: 1000,
      endMs: 3000,
      text: 'Đây là câu ngắn.',
    };
    const wrapped = applyVisualLineWrapping([shortLine], true);
    assert.strictEqual(wrapped[0].text, 'Đây là câu ngắn.');
    assert.strictEqual(wrapped[0].text.includes('\n'), false);
    assert.strictEqual(wrapped[0].startMs, 1000);
    assert.strictEqual(wrapped[0].endMs, 3000);
  });

  runTest('3.2 Long lines (> 37 chars) are wrapped with \\n at word boundaries', () => {
    const longLine: SrtLine = {
      id: 'long-1',
      startMs: 2000,
      endMs: 7000,
      text: 'Chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được, nhưng giá cho mỗi hoạt động tính thế nào?',
    };
    const wrapped = applyVisualLineWrapping([longLine], true);
    assert.strictEqual(wrapped.length, 1, 'Must remain a single SrtLine block');
    assert.strictEqual(wrapped[0].id, 'long-1');
    assert.strictEqual(wrapped[0].startMs, 2000);
    assert.strictEqual(wrapped[0].endMs, 7000);
    assert.strictEqual(wrapped[0].text.includes('\n'), true, 'Must contain visual newline \\n');

    // Each subline must respect reasonable width
    const sublines = wrapped[0].text.split('\n');
    for (const sub of sublines) {
      assert.ok(sub.trim().length <= 45, `Subline exceeds wrap threshold: "${sub}" (${sub.length} chars)`);
    }
  });

  runTest('3.3 Non-Vietnamese target language bypasses Vietnamese grammar wrapping', () => {
    const englishLine: SrtLine = {
      id: 'en-1',
      startMs: 500,
      endMs: 2500,
      text: 'This is an English sentence that is longer than thirty seven characters in total.',
    };
    const wrapped = applyVisualLineWrapping([englishLine], false);
    assert.strictEqual(wrapped[0].text, englishLine.text, 'English text should not be modified by vi wrap');
    assert.strictEqual(wrapped[0].startMs, 500);
    assert.strictEqual(wrapped[0].endMs, 2500);
  });

  // =========================================================================
  // TEST GROUP 4: SRT Parser & Serializer Round-trip with Multi-line Text
  // =========================================================================
  console.log('\n--- Test Group 4: SRT Serialization / Parsing Round-trip ---');

  runTest('4.1 serializeSrt and parseSrt preserve visual \\n and exact timecodes', () => {
    const srtLines: SrtLine[] = [
      {
        id: '1',
        startMs: 1000,
        endMs: 4500,
        text: 'Dòng thứ nhất hiển thị trên màn hình\nDòng thứ hai tiếp tục câu nói',
        speaker: 'SPEAKER_00',
      },
      {
        id: '2',
        startMs: 5000,
        endMs: 8000,
        text: 'Câu đơn lẻ ngắn.',
        speaker: 'SPEAKER_01',
      },
    ];

    const serialized = serializeSrt(srtLines);
    assert.ok(serialized.includes('Dòng thứ nhất hiển thị trên màn hình\nDòng thứ hai tiếp tục câu nói'));

    const parsed = parseSrt(serialized);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].startMs, 1000);
    assert.strictEqual(parsed[0].endMs, 4500);
    assert.strictEqual(parsed[0].text, 'Dòng thứ nhất hiển thị trên màn hình\nDòng thứ hai tiếp tục câu nói');
    assert.strictEqual(parsed[1].startMs, 5000);
    assert.strictEqual(parsed[1].endMs, 8000);
    assert.strictEqual(parsed[1].text, 'Câu đơn lẻ ngắn.');
  });

  // =========================================================================
  // TEST GROUP 5: SubtitleEditor Visual Wrap Action Simulation
  // =========================================================================
  console.log('\n--- Test Group 5: SubtitleEditor Visual Wrap State Mutation ---');

  runTest('5.1 handleVisualWrapLines mutates only text with \\n and preserves all ids/times', () => {
    const editorState: SrtLine[] = [
      {
        id: 'editor-0',
        startMs: 500,
        endMs: 3500,
        text: 'Hôm nay chúng ta sẽ trình diễn pipeline phụ đề mới không còn cắt câu Netflix.',
      },
      {
        id: 'editor-1',
        startMs: 4000,
        endMs: 6000,
        text: 'Câu ngắn.',
      },
    ];

    let wrappedCount = 0;
    const updated = editorState.map((line) => {
      const hasOverflow = line.text.includes('\n')
        ? line.text.split(/\r?\n/).some((sub) => sub.trim().length > 37)
        : line.text.length > 37;
      if (hasOverflow) {
        const wrapped = breakVietnameseLines(line.text.replace(/\r?\n/g, ' '), 37);
        if (wrapped !== line.text) wrappedCount++;
        return { ...line, text: wrapped };
      }
      return line;
    });

    assert.strictEqual(wrappedCount, 1, 'Only line 0 should be wrapped');
    assert.strictEqual(updated.length, 2, 'Line count must remain 2');
    assert.strictEqual(updated[0].id, 'editor-0');
    assert.strictEqual(updated[0].startMs, 500);
    assert.strictEqual(updated[0].endMs, 3500);
    assert.strictEqual(updated[0].text.includes('\n'), true);
    assert.strictEqual(updated[1].id, 'editor-1');
    assert.strictEqual(updated[1].startMs, 4000);
    assert.strictEqual(updated[1].endMs, 6000);
    assert.strictEqual(updated[1].text, 'Câu ngắn.');
  });

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n=============================================================');
  console.log(`TOTAL TESTS: ${passCount + failCount}`);
  console.log(`PASSED: ${passCount}`);
  console.log(`FAILED: ${failCount}`);
  console.log('=============================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
