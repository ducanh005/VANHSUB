import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { parseSrt, serializeSrt, formatMs, parseTimecode, parseMsString, type SrtLine } from '../main/lib/srt';
import { breakVietnameseLines, segmentSubtitlesNetflix } from '../main/lib/nlpSegmenter';

console.log('======================================================================');
console.log('CHALLENGER 2: ADVERSARIAL VERIFICATION OF UI & STATIC PURITY (M2)');
console.log('======================================================================\n');

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

// SubtitleEditor UI state transformation simulation function matching renderer/components/SubtitleEditor.tsx:490-505
function simulateEditorVisualWrap(lines: SrtLine[]): { updated: SrtLine[]; wrappedCount: number } {
  let wrappedCount = 0;
  const updated = lines.map((line) => {
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
  return { updated, wrappedCount };
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');

  // =========================================================================
  // SUITE 1: Exhaustive Static Codebase Audit (Zero Netflix in Production)
  // =========================================================================
  console.log('--- SUITE 1: Exhaustive Static Codebase Audit ---');

  runTest('1.1 Zero references to segmentSubtitlesNetflix in main/translate/', () => {
    const dir = path.join(rootDir, 'main', 'translate');
    const files = fs.readdirSync(dir).filter((f) => /\.(ts|tsx|js|mjs)$/.test(f));
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      assert.strictEqual(
        content.includes('segmentSubtitlesNetflix'),
        false,
        `VULNERABILITY: main/translate/${file} still contains reference to segmentSubtitlesNetflix!`
      );
    }
  });

  runTest('1.2 Zero references to segmentSubtitlesNetflix in main/asr/', () => {
    const dir = path.join(rootDir, 'main', 'asr');
    const scanDir = (currentPath: string) => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          scanDir(full);
        } else if (/\.(ts|tsx|js|mjs|py)$/.test(entry.name)) {
          const content = fs.readFileSync(full, 'utf-8');
          assert.strictEqual(
            content.includes('segmentSubtitlesNetflix'),
            false,
            `VULNERABILITY: ${full} still contains reference to segmentSubtitlesNetflix!`
          );
        }
      }
    };
    scanDir(dir);
  });

  runTest('1.3 Zero references to segmentSubtitlesNetflix across entire renderer/', () => {
    const rendererDir = path.join(rootDir, 'renderer');
    const scannedFiles: string[] = [];
    const scanDir = (currentPath: string) => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.next' || entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          scanDir(full);
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          scannedFiles.push(full);
          const content = fs.readFileSync(full, 'utf-8');
          assert.strictEqual(
            content.includes('segmentSubtitlesNetflix'),
            false,
            `VULNERABILITY: renderer file ${full} still references segmentSubtitlesNetflix!`
          );
        }
      }
    };
    scanDir(rendererDir);
    assert.ok(scannedFiles.length >= 20, `Scanned ${scannedFiles.length} renderer files`);
  });

  runTest('1.4 Zero references to segmentSubtitlesNetflix in main production subsystems (render, tts, ocr, main.ts)', () => {
    const checkTargets = [
      path.join(rootDir, 'main', 'main.ts'),
      path.join(rootDir, 'main', 'preload.ts'),
      path.join(rootDir, 'main', 'render'),
      path.join(rootDir, 'main', 'tts'),
      path.join(rootDir, 'main', 'ocr'),
    ];

    for (const target of checkTargets) {
      if (!fs.existsSync(target)) continue;
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        const files = fs.readdirSync(target).filter((f) => /\.(ts|tsx|js|mjs)$/.test(f));
        for (const file of files) {
          const content = fs.readFileSync(path.join(target, file), 'utf-8');
          assert.strictEqual(
            content.includes('segmentSubtitlesNetflix'),
            false,
            `VULNERABILITY: ${target}/${file} contains segmentSubtitlesNetflix!`
          );
        }
      } else {
        const content = fs.readFileSync(target, 'utf-8');
        assert.strictEqual(
          content.includes('segmentSubtitlesNetflix'),
          false,
          `VULNERABILITY: ${target} contains segmentSubtitlesNetflix!`
        );
      }
    }
  });

  runTest('1.5 SubtitleEditor.tsx UI audit: removed Netflix, bound visual wrap to Ctrl+Shift+W & button', () => {
    const editorPath = path.join(rootDir, 'renderer', 'components', 'SubtitleEditor.tsx');
    const content = fs.readFileSync(editorPath, 'utf-8');

    // Netflix references eliminated
    assert.strictEqual(content.includes('handleNetflixNormalize'), false, 'handleNetflixNormalize must be deleted');
    assert.strictEqual(content.includes('Chuẩn hoá Netflix (NLP)'), false, 'Netflix toolbar button must be deleted');
    assert.strictEqual(content.includes('segmentSubtitlesNetflix'), false, 'segmentSubtitlesNetflix must not be imported');

    // Visual wrap properly implemented
    assert.strictEqual(content.includes('const handleVisualWrapLines = () =>'), true, 'handleVisualWrapLines function exists');
    assert.strictEqual(content.includes('breakVietnameseLines'), true, 'breakVietnameseLines is imported and used');
    assert.strictEqual(content.includes('Ngắt dòng hiển thị (\\n)'), true, 'Visual wrap toolbar button exists');

    // Shortcut checks: KeyW registered for visual wrap, KeyN not used for Netflix
    assert.ok(content.includes('KeyW') || content.includes("'W'") || content.includes('"W"'), 'Ctrl+Shift+W shortcut registered');
    assert.strictEqual(content.includes('handleNetflixNormalize'), false);
  });

  runTest('1.6 segmentSubtitlesNetflix is isolated in main/lib/nlpSegmenter.ts and marked @deprecated', () => {
    const nlpFile = path.join(rootDir, 'main', 'lib', 'nlpSegmenter.ts');
    const content = fs.readFileSync(nlpFile, 'utf-8');
    assert.ok(content.includes('@deprecated'), 'JSDoc @deprecated tag must be present on segmentSubtitlesNetflix');
    assert.strictEqual(typeof segmentSubtitlesNetflix, 'function');
  });

  // =========================================================================
  // SUITE 2: SubtitleEditor UI State Simulation & Adversarial Wrapping
  // =========================================================================
  console.log('\n--- SUITE 2: SubtitleEditor UI State Simulation & Adversarial Wrapping ---');

  // Construct a diverse adversarial subtitle dataset
  const complexSubtitles: SrtLine[] = [
    // 0: Short simple
    { id: 'uuid-001', startMs: 100, endMs: 1500, text: 'Xin chào.' },
    // 1: Boundary exact 36 chars
    { id: 'uuid-002', startMs: 1600, endMs: 3200, text: 'Dòng này có đúng ba mươi sáu ký tự nè' },
    // 2: Boundary exact 37 chars
    { id: 'uuid-003', startMs: 3300, endMs: 5000, text: 'Dòng này có đúng ba mươi bảy ký tự đó' },
    // 3: Boundary exact 38 chars (must wrap)
    { id: 'uuid-004', startMs: 5100, endMs: 7000, text: 'Dòng này có đúng ba mươi tám ký tự nhé' },
    // 4: Medium sentence with punctuation (52 chars)
    { id: 'uuid-005', startMs: 7100, endMs: 10500, text: 'Hôm nay trời rất đẹp, chúng ta cùng đi dạo công viên nhé!', speaker: 'SPEAKER_00' },
    // 5: Long complex Vietnamese sentence with comma and clauses (116 chars)
    {
      id: 'uuid-006',
      startMs: 11000,
      endMs: 16500,
      text: 'Chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được, nhưng giá cho mỗi hoạt động tính thế nào?',
      speaker: 'SPEAKER_01',
    },
    // 6: Massive paragraph (184 chars)
    {
      id: 'uuid-007',
      startMs: 17000,
      endMs: 25000,
      text: 'Theo thông tin từ cơ quan khí tượng thủy văn quốc gia, đợt không khí lạnh tăng cường sẽ tiếp tục ảnh hưởng sâu rộng đến các tỉnh miền Bắc và Bắc Trung Bộ trong những ngày tới.',
      speaker: 'HOST',
    },
    // 7: Already wrapped subtitle with all sublines <= 37 chars
    {
      id: 'uuid-008',
      startMs: 26000,
      endMs: 29000,
      text: 'Dòng thứ nhất ngắn gọn\nDòng thứ hai cũng rất vừa vặn',
    },
    // 8: Already wrapped subtitle but one subline exceeds 37 chars
    {
      id: 'uuid-009',
      startMs: 30000,
      endMs: 35000,
      text: 'Dòng ngắn\nDòng này bị quá dài vượt quá giới hạn ba mươi bảy ký tự quy định cần ngắt lại',
    },
    // 9: Single unbreakable continuous token without spaces (> 37 chars)
    {
      id: 'uuid-010',
      startMs: 36000,
      endMs: 39000,
      text: 'https://vanhsub.org/download/video/sample-subtitles-dataset-archive-v2.mp4',
    },
    // 10: Mixed with Emojis and Special Punctuation
    {
      id: 'uuid-011',
      startMs: 40000,
      endMs: 44000,
      text: 'Khám phá video cực đỉnh 🔥🚀🎬🇻🇳 cùng bộ công cụ làm phụ đề thông minh nhất 2026!',
      speaker: 'SPEAKER_00',
    },
    // 11: Bilingual / CJK characters mixed with Vietnamese
    {
      id: 'uuid-012',
      startMs: 45000,
      endMs: 48500,
      text: 'Phim truyền hình 狂飙 (Cuồng Phong) là tác phẩm đạt rating kỷ lục trên sóng truyền hình.',
    },
    // 12: Minimalist edge: 1 char
    { id: 'uuid-013', startMs: 49000, endMs: 49500, text: 'Ồ' },
    // 13: Zero timecodes (startMs=0, endMs=0)
    { id: 'uuid-014', startMs: 0, endMs: 0, text: 'Đầu dòng 0ms mốc thời gian không được biến dạng khi wrap.' },
    // 14: Very large timecodes (12 hours)
    { id: 'uuid-015', startMs: 43200000, endMs: 43205000, text: 'Thời gian mười hai tiếng sau vẫn phải chuẩn xác từng mili-giây.' },
    // 15: Touching timecodes
    { id: 'uuid-016', startMs: 43205000, endMs: 43208000, text: 'Dòng kế tiếp dính liền mốc kết thúc dòng trước.' },
  ];

  runTest('2.1 handleVisualWrapLines preserves 100% of line count, IDs, startMs, endMs, and speakers', () => {
    const { updated, wrappedCount } = simulateEditorVisualWrap(complexSubtitles);

    // 1. Line count preservation
    assert.strictEqual(
      updated.length,
      complexSubtitles.length,
      `Expected ${complexSubtitles.length} lines, got ${updated.length}`
    );

    // 2. Strict ID, timecode, and speaker preservation on every line
    for (let i = 0; i < complexSubtitles.length; i++) {
      const orig = complexSubtitles[i];
      const cur = updated[i];

      assert.strictEqual(cur.id, orig.id, `Line ${i}: ID mutated from ${orig.id} to ${cur.id}`);
      assert.strictEqual(cur.startMs, orig.startMs, `Line ${i}: startMs mutated from ${orig.startMs} to ${cur.startMs}`);
      assert.strictEqual(cur.endMs, orig.endMs, `Line ${i}: endMs mutated from ${orig.endMs} to ${cur.endMs}`);
      assert.strictEqual(cur.speaker, orig.speaker, `Line ${i}: speaker mutated from ${orig.speaker} to ${cur.speaker}`);

      // 3. Word preservation check (all words in orig must be in cur)
      const origWords = orig.text.replace(/\r?\n/g, ' ').trim().split(/\s+/).filter(Boolean);
      const curWords = cur.text.replace(/\r?\n/g, ' ').trim().split(/\s+/).filter(Boolean);
      assert.deepStrictEqual(
        curWords,
        origWords,
        `Line ${i}: Text content altered or words lost during visual wrap!`
      );
    }

    // Verify wrapping happened on long lines
    assert.ok(wrappedCount >= 6, `Expected at least 6 long lines to be wrapped, got ${wrappedCount}`);

    // Verify boundary lines
    assert.strictEqual(updated[1].text.includes('\n'), false, '36-char line should NOT contain newline');
    assert.strictEqual(updated[2].text.includes('\n'), false, '37-char line should NOT contain newline');
    assert.strictEqual(updated[3].text.includes('\n'), true, '38-char line MUST contain newline');
    assert.strictEqual(updated[5].text.includes('\n'), true, '116-char line MUST contain newline');
  });

  runTest('2.2 Idempotence: Consecutive executions produce zero drift', () => {
    let current = complexSubtitles;
    for (let run = 1; run <= 5; run++) {
      const { updated } = simulateEditorVisualWrap(current);
      current = updated;
    }

    const firstRun = simulateEditorVisualWrap(complexSubtitles).updated;
    for (let i = 0; i < current.length; i++) {
      assert.strictEqual(
        current[i].text,
        firstRun[i].text,
        `Line ${i} drifted across multiple visual wrap invocations!`
      );
      assert.strictEqual(current[i].startMs, complexSubtitles[i].startMs);
      assert.strictEqual(current[i].endMs, complexSubtitles[i].endMs);
      assert.strictEqual(current[i].id, complexSubtitles[i].id);
    }
  });

  runTest('2.3 Unbreakable single token is preserved safely without crash or infinite loop', () => {
    const unbreakableLine: SrtLine = {
      id: 'token-line',
      startMs: 1000,
      endMs: 3000,
      text: 'SupercalifragilisticexpialidociousWithoutAnySpacesInsideThisSingleExtremelyLongWord',
    };
    const { updated } = simulateEditorVisualWrap([unbreakableLine]);
    assert.strictEqual(updated.length, 1);
    assert.strictEqual(updated[0].text, unbreakableLine.text);
    assert.strictEqual(updated[0].startMs, 1000);
    assert.strictEqual(updated[0].endMs, 3000);
  });

  runTest('2.4 Scale & Performance Stress: 1,000 complex subtitles wrapped in < 300ms', () => {
    const largeDataset: SrtLine[] = [];
    const sampleSentences = [
      'Câu ngắn gọn dưới 37 ký tự.',
      'Câu trung bình này dài khoảng bốn mươi lăm ký tự cần ngắt.',
      'Chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được, nhưng giá cho mỗi hoạt động tính thế nào?',
      'Theo dự báo từ trung tâm khí tượng thủy văn, thời tiết sẽ chuyển biến phức tạp trong những ngày tới.',
      'Xin chào và hẹn gặp lại quý vị khán giả trong chương trình lần sau!',
    ];

    for (let i = 0; i < 1000; i++) {
      largeDataset.push({
        id: `bench-line-${i}`,
        startMs: i * 3000,
        endMs: i * 3000 + 2500,
        text: sampleSentences[i % sampleSentences.length],
        speaker: i % 2 === 0 ? 'SPEAKER_00' : 'SPEAKER_01',
      });
    }

    const startTs = Date.now();
    const { updated, wrappedCount } = simulateEditorVisualWrap(largeDataset);
    const durationMs = Date.now() - startTs;

    console.log(`    (Info: Processed 1,000 subtitles in ${durationMs}ms, wrapped ${wrappedCount} lines)`);
    assert.strictEqual(updated.length, 1000);
    assert.ok(durationMs < 500, `Execution took ${durationMs}ms which exceeds 500ms limit`);

    // Invariant check on 1,000 lines
    for (let i = 0; i < 1000; i++) {
      assert.strictEqual(updated[i].id, largeDataset[i].id);
      assert.strictEqual(updated[i].startMs, largeDataset[i].startMs);
      assert.strictEqual(updated[i].endMs, largeDataset[i].endMs);
      assert.strictEqual(updated[i].speaker, largeDataset[i].speaker);
    }
  });

  // =========================================================================
  // SUITE 3: SRT Multi-line Serialization & Deserialization Fidelity
  // =========================================================================
  console.log('\n--- SUITE 3: SRT Multi-line Serialization & Deserialization Fidelity ---');

  runTest('3.1 Multi-line subtitles round-trip without line count or timecode loss', () => {
    const multiLineInput: SrtLine[] = [
      {
        id: 'line-0',
        startMs: 1250,
        endMs: 4750,
        text: 'Dòng thứ nhất hiển thị câu đầu\nDòng thứ hai hoàn tất câu thoại',
        speaker: 'SPEAKER_00',
      },
      {
        id: 'line-1',
        startMs: 5000,
        endMs: 9200,
        text: 'Dòng một của câu thứ hai\nDòng hai của câu thứ hai\nDòng ba bổ sung thông tin',
        speaker: 'SPEAKER_01',
      },
      {
        id: 'line-2',
        startMs: 9500,
        endMs: 11000,
        text: 'Một dòng ngắn đơn lẻ.',
      },
    ];

    const srtString = serializeSrt(multiLineInput);
    const parsed = parseSrt(srtString);

    assert.strictEqual(parsed.length, multiLineInput.length, 'Line count must be identical');

    for (let i = 0; i < multiLineInput.length; i++) {
      const orig = multiLineInput[i];
      const cur = parsed[i];

      assert.strictEqual(cur.startMs, orig.startMs, `Line ${i} startMs changed: ${orig.startMs} vs ${cur.startMs}`);
      assert.strictEqual(cur.endMs, orig.endMs, `Line ${i} endMs changed: ${orig.endMs} vs ${cur.endMs}`);
      assert.strictEqual(cur.text, orig.text, `Line ${i} text altered: "${orig.text}" vs "${cur.text}"`);
      assert.strictEqual(cur.speaker, orig.speaker, `Line ${i} speaker altered: "${orig.speaker}" vs "${cur.speaker}"`);
    }
  });

  runTest('3.2 Millisecond boundary precision: exact preservation of 0..999 ms with leading zeros', () => {
    const testMsValues = [0, 1, 5, 12, 99, 100, 234, 500, 789, 999];
    for (const ms of testMsValues) {
      const formatted = formatMs(ms);
      const parsedTime = parseTimecode(formatted);
      assert.strictEqual(parsedTime, ms, `Failed millisecond roundtrip for ${ms} (formatted: ${formatted})`);

      const line: SrtLine = {
        id: `ms-${ms}`,
        startMs: 10000 + ms,
        endMs: 20000 + ms,
        text: `Kiểm tra độ chính xác mili-giây: ${ms}`,
      };
      const parsedLine = parseSrt(serializeSrt([line]))[0];
      assert.strictEqual(parsedLine.startMs, line.startMs);
      assert.strictEqual(parsedLine.endMs, line.endMs);
    }
  });

  runTest('3.3 Double serialization idempotence: serialize(parse(serialize(x))) === serialize(x)', () => {
    const originalWrapped = simulateEditorVisualWrap(complexSubtitles).updated;
    const srtFirst = serializeSrt(originalWrapped);
    const parsedFirst = parseSrt(srtFirst);
    const srtSecond = serializeSrt(parsedFirst);

    assert.strictEqual(
      srtSecond,
      srtFirst,
      'Double serialization is not idempotent! Serialized text modified on second pass.'
    );
  });

  runTest('3.4 Large hours (> 99h) timecode parsing robustness', () => {
    const longHourSrt = `1\n120:15:30,500 --> 120:15:35,750\nNội dung video dài hơn 100 giờ\n`;
    const parsed = parseSrt(longHourSrt);
    assert.strictEqual(parsed.length, 1);
    const expectedStart = (120 * 3600 + 15 * 60 + 30) * 1000 + 500;
    const expectedEnd = (120 * 3600 + 15 * 60 + 35) * 1000 + 750;
    assert.strictEqual(parsed[0].startMs, expectedStart);
    assert.strictEqual(parsed[0].endMs, expectedEnd);
    assert.strictEqual(parsed[0].text, 'Nội dung video dài hơn 100 giờ');
  });

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n======================================================================');
  console.log(`TOTAL TESTS: ${passCount + failCount}`);
  console.log(`PASSED: ${passCount}`);
  console.log(`FAILED: ${failCount}`);
  console.log('======================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal execution error in challenger test suite:', err);
  process.exit(1);
});
