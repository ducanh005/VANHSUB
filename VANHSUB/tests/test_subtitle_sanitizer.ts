import assert from 'assert';
import {
  isOcrGarbageLine,
  sanitizeSubtitles,
  type SanitizeOptions,
  type SanitizeResult,
} from '../main/lib/subtitleSanitizer';
import { fuseOcrAndWhisper } from '../main/asr/hybridFusionEngine';
import type { SrtLine } from '../main/lib/srt';

console.log('=== BẮT ĐẦU TEST SUITE: BỘ LỌC RÁC OCR & KHỬ NHIỄU QUANG HỌC (R1) ===\n');

let passCount = 0;
let totalCount = 0;

function runTest(name: string, fn: () => void) {
  totalCount++;
  try {
    fn();
    console.log(`✓ PASS: ${name}`);
    passCount++;
  } catch (err: any) {
    console.error(`✗ FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// TEST GROUP 1: QUY TẮC G1 - KÝ TỰ ĐƠN LẺ (SINGLE-CHARACTER TOKENS)
// ---------------------------------------------------------------------------
runTest('1.1. Loại bỏ triệt để các dòng chỉ chứa 1 ký tự đơn lẻ (c, A, a, ., -, 1, |)', () => {
  const garbageLines: SrtLine[] = [
    { id: 'g1', startMs: 1000, endMs: 2000, text: 'c' },
    { id: 'g2', startMs: 2000, endMs: 3000, text: 'A' },
    { id: 'g3', startMs: 3000, endMs: 4000, text: 'a' },
    { id: 'g4', startMs: 4000, endMs: 5000, text: '.' },
    { id: 'g5', startMs: 5000, endMs: 6000, text: '-' },
    { id: 'g6', startMs: 6000, endMs: 7000, text: '1' },
    { id: 'g7', startMs: 7000, endMs: 8000, text: '|' },
    { id: 'g8', startMs: 8000, endMs: 9000, text: ' o ' },
  ];

  for (const line of garbageLines) {
    assert.strictEqual(
      isOcrGarbageLine(line),
      true,
      `Dòng '${line.text}' phải bị xác định là rác G1`
    );
  }

  const result = sanitizeSubtitles(garbageLines);
  assert.strictEqual(result.cleaned.length, 0);
  assert.strictEqual(result.removedCount, garbageLines.length);
  assert.strictEqual(result.removedItems.length, garbageLines.length);
});

runTest('1.2. Loại bỏ các dòng chỉ có 1 ký tự chữ/số bị bao quanh bởi dấu câu/ký hiệu', () => {
  const garbageWithSymbols: SrtLine[] = [
    { id: 's1', startMs: 1000, endMs: 2000, text: 'c.' },
    { id: 's2', startMs: 2000, endMs: 3000, text: '- a' },
    { id: 's3', startMs: 3000, endMs: 4000, text: '(c)' },
    { id: 's4', startMs: 4000, endMs: 5000, text: '[1]' },
    { id: 's5', startMs: 5000, endMs: 6000, text: '— A' },
    { id: 's6', startMs: 6000, endMs: 7000, text: '. 1 .' },
  ];

  for (const line of garbageWithSymbols) {
    assert.strictEqual(
      isOcrGarbageLine(line),
      true,
      `Dòng '${line.text}' phải bị lọc là rác`
    );
  }
});

// ---------------------------------------------------------------------------
// TEST GROUP 2: QUY TẮC G2 - DẤU CÂU & KÝ HIỆU TRÔI NỔI (FLOATING PUNCTUATION)
// ---------------------------------------------------------------------------
runTest('2.1. Loại bỏ các dòng dấu câu/ký hiệu không chứa bất kỳ chữ cái hay chữ số nào', () => {
  const floatingPunctuation: SrtLine[] = [
    { id: 'p1', startMs: 1000, endMs: 2500, text: '.' },
    { id: 'p2', startMs: 2500, endMs: 4000, text: '...' },
    { id: 'p3', startMs: 4000, endMs: 5500, text: '—' },
    { id: 'p4', startMs: 5500, endMs: 7000, text: '--' },
    { id: 'p5', startMs: 7000, endMs: 8500, text: '|' },
    { id: 'p6', startMs: 8500, endMs: 9500, text: '- - -' },
    { id: 'p7', startMs: 9500, endMs: 10500, text: '[ ]' },
    { id: 'p8', startMs: 10500, endMs: 11500, text: '• • •' },
    { id: 'p9', startMs: 11500, endMs: 12500, text: '???' },
    { id: 'p10', startMs: 12500, endMs: 13500, text: '~~' },
    { id: 'p11', startMs: 13500, endMs: 14500, text: ': :' },
  ];

  for (const line of floatingPunctuation) {
    assert.strictEqual(
      isOcrGarbageLine(line),
      true,
      `Dòng '${line.text}' phải bị xác định là rác G2`
    );
  }

  const result = sanitizeSubtitles(floatingPunctuation);
  assert.strictEqual(result.cleaned.length, 0);
  assert.strictEqual(result.removedCount, floatingPunctuation.length);
});

// ---------------------------------------------------------------------------
// TEST GROUP 3: QUY TẮC G3 - THỜI LƯỢNG SIÊU NGẮN (< 150MS) & ĐỐI CHIẾU WHISPER
// ---------------------------------------------------------------------------
runTest('3.1. Loại bỏ dòng có thời lượng siêu ngắn (< 150ms) khi không có âm thanh Whisper', () => {
  const ultraShortLines: SrtLine[] = [
    { id: 'u1', startMs: 1000, endMs: 1080, text: 'Chớp sáng' }, // 80ms
    { id: 'u2', startMs: 2000, endMs: 2120, text: 'Nhiễu hình' }, // 120ms
    { id: 'u3', startMs: 3000, endMs: 3149, text: 'Khung flash' }, // 149ms
  ];

  for (const line of ultraShortLines) {
    assert.strictEqual(
      isOcrGarbageLine(line),
      true,
      `Dòng '${line.text}' (${line.endMs - line.startMs}ms) không có Whisper phải bị lọc`
    );
  }

  // Khi cung cấp whisperSegments nhưng không có đoạn nào khớp dải thời gian
  const whisperNonOverlapping: SrtLine[] = [
    { id: 'w1', startMs: 5000, endMs: 7000, text: 'Đoạn thoại khác xa' },
  ];

  for (const line of ultraShortLines) {
    assert.strictEqual(
      isOcrGarbageLine(line, { whisperSegments: whisperNonOverlapping }),
      true,
      `Dòng '${line.text}' không khớp Whisper phải bị lọc`
    );
  }
});

runTest('3.2. BẢO TOÀN dòng có thời lượng siêu ngắn (< 150ms) khi CÓ âm thanh Whisper khớp', () => {
  const shortValidLine: SrtLine = {
    id: 'valid-short',
    startMs: 1000,
    endMs: 1120, // 120ms
    text: 'Đúng',
  };

  const whisperMatching: SrtLine[] = [
    { id: 'w-match', startMs: 950, endMs: 1250, text: 'Đúng vậy' },
  ];

  const isGarbage = isOcrGarbageLine(shortValidLine, { whisperSegments: whisperMatching });
  assert.strictEqual(
    isGarbage,
    false,
    'Dòng ngắn nhưng có âm thanh Whisper chứng thực phải được bảo toàn'
  );

  const result = sanitizeSubtitles([shortValidLine], { whisperSegments: whisperMatching });
  assert.strictEqual(result.cleaned.length, 1);
  assert.strictEqual(result.removedCount, 0);
  assert.strictEqual(result.cleaned[0].text, 'Đúng');
});

runTest('3.3. Dòng có thời lượng bình thường (>= 150ms) không bị ảnh hưởng bởi G3', () => {
  const normalLine: SrtLine = {
    id: 'normal-1',
    startMs: 1000,
    endMs: 1150, // đúng 150ms
    text: 'Xin chào',
  };
  assert.strictEqual(isOcrGarbageLine(normalLine), false);

  const longerLine: SrtLine = {
    id: 'normal-2',
    startMs: 2000,
    endMs: 3500, // 1500ms
    text: 'Cảm ơn các bạn rất nhiều',
  };
  assert.strictEqual(isOcrGarbageLine(longerLine), false);
});

// ---------------------------------------------------------------------------
// TEST GROUP 4: QUY TẮC G4 - UNICODE GLITCHES (PUA, REPLACEMENT, BOX DRAWING)
// ---------------------------------------------------------------------------
runTest('4.1. Loại bỏ các dòng chứa ký tự dị thường (Replacement char, PUA, Box Drawing)', () => {
  const glitchLines: SrtLine[] = [
    { id: 'glitch-1', startMs: 1000, endMs: 3000, text: '\uFFFD' }, // 
    { id: 'glitch-2', startMs: 2000, endMs: 4000, text: '\uE001 \uE002' }, // PUA
    { id: 'glitch-3', startMs: 3000, endMs: 5000, text: '┌─────────┐' }, // Box Drawing
    { id: 'glitch-4', startMs: 4000, endMs: 6000, text: '█████████' }, // Block Elements
    { id: 'glitch-5', startMs: 5000, endMs: 7000, text: '░▒▓█' }, // Shading blocks
    { id: 'glitch-6', startMs: 6000, endMs: 8000, text: '\uFFFD \uFFFD' },
  ];

  for (const line of glitchLines) {
    assert.strictEqual(
      isOcrGarbageLine(line),
      true,
      `Dòng glitch '${line.text}' phải bị loại bỏ`
    );
  }

  const result = sanitizeSubtitles(glitchLines);
  assert.strictEqual(result.cleaned.length, 0);
  assert.strictEqual(result.removedCount, glitchLines.length);
});

// ---------------------------------------------------------------------------
// TEST GROUP 5: BẢO TOÀN NGUYÊN VẸN CÂU THOẠI & BANNER HỢP LỆ
// ---------------------------------------------------------------------------
runTest('5.1. Bảo toàn 100% các câu thoại tiếng Việt hợp lệ, không mất chữ hay lệch timecode', () => {
  const validDialogue: SrtLine[] = [
    { id: 'v1', startMs: 1000, endMs: 3500, text: 'Hôm nay trời rất đẹp, chúng ta cùng đi dạo nhé.' },
    { id: 'v2', startMs: 4000, endMs: 7000, text: 'Xin chào quý vị khán giả đã quay trở lại với kênh.' },
    { id: 'v3', startMs: 7500, endMs: 9000, text: 'Tuyệt vời!' },
    { id: 'v4', startMs: 9500, endMs: 12000, text: 'TẬP 1: BẮT ĐẦU CHẶNG ĐƯỜNG MỚI' },
    { id: 'v5', startMs: 13000, endMs: 15500, text: 'Giá của sản phẩm này là 150.000 VNĐ.' },
  ];

  const result = sanitizeSubtitles(validDialogue);
  assert.strictEqual(result.cleaned.length, validDialogue.length);
  assert.strictEqual(result.removedCount, 0);
  assert.strictEqual(result.removedItems.length, 0);

  for (let i = 0; i < validDialogue.length; i++) {
    assert.strictEqual(result.cleaned[i].id, validDialogue[i].id);
    assert.strictEqual(result.cleaned[i].startMs, validDialogue[i].startMs);
    assert.strictEqual(result.cleaned[i].endMs, validDialogue[i].endMs);
    assert.strictEqual(result.cleaned[i].text, validDialogue[i].text);
  }
});

// ---------------------------------------------------------------------------
// TEST GROUP 6: DANH SÁCH TRỘN LẪN (MIXED REAL-WORLD SUBTITLE FILE)
// ---------------------------------------------------------------------------
runTest('6.1. Lọc chính xác các dòng rác đan xen giữa các câu thoại hợp lệ', () => {
  const mixedLines: SrtLine[] = [
    { id: 'm1', startMs: 500, endMs: 2500, text: 'TẬP 1: MỞ ĐẦU' }, // Banner hợp lệ -> Giữ
    { id: 'm2', startMs: 2600, endMs: 2700, text: 'c' }, // Rác 1-char -> Xóa
    { id: 'm3', startMs: 3000, endMs: 5000, text: 'Chào mừng các bạn đã đến với chương trình' }, // Thoại hợp lệ -> Giữ
    { id: 'm4', startMs: 5100, endMs: 5800, text: '...' }, // Rác ký hiệu -> Xóa
    { id: 'm5', startMs: 6000, endMs: 6100, text: 'Nhiễu chớp' }, // Rác <150ms -> Xóa
    { id: 'm6', startMs: 6500, endMs: 8500, text: 'Hôm nay chúng ta sẽ bàn về trí tuệ nhân tạo.' }, // Thoại hợp lệ -> Giữ
    { id: 'm7', startMs: 8600, endMs: 9000, text: '—' }, // Rác gạch ngang -> Xóa
    { id: 'm8', startMs: 9500, endMs: 12000, text: 'Cảm ơn mọi người đã theo dõi!' }, // Thoại hợp lệ -> Giữ
  ];

  const result = sanitizeSubtitles(mixedLines);
  assert.strictEqual(result.cleaned.length, 4);
  assert.strictEqual(result.removedCount, 4);

  assert.strictEqual(result.cleaned[0].text, 'TẬP 1: MỞ ĐẦU');
  assert.strictEqual(result.cleaned[1].text, 'Chào mừng các bạn đã đến với chương trình');
  assert.strictEqual(result.cleaned[2].text, 'Hôm nay chúng ta sẽ bàn về trí tuệ nhân tạo.');
  assert.strictEqual(result.cleaned[3].text, 'Cảm ơn mọi người đã theo dõi!');

  const removedTexts = result.removedItems.map((r) => r.text);
  assert.deepStrictEqual(removedTexts, ['c', '...', 'Nhiễu chớp', '—']);
});

// ---------------------------------------------------------------------------
// TEST GROUP 7: EDGE CASES (EMPTY, WHITESPACE, INVALID TIMESTAMPS)
// ---------------------------------------------------------------------------
runTest('7.1. Xử lý an toàn mảng rỗng, null/undefined, mảng toàn rác', () => {
  const emptyRes = sanitizeSubtitles([]);
  assert.strictEqual(emptyRes.cleaned.length, 0);
  assert.strictEqual(emptyRes.removedCount, 0);

  const nullRes = sanitizeSubtitles(null as any);
  assert.strictEqual(nullRes.cleaned.length, 0);
  assert.strictEqual(nullRes.removedCount, 0);

  // Mảng chỉ gồm toàn dòng rác
  const allGarbage: SrtLine[] = [
    { id: '1', startMs: 100, endMs: 200, text: 'c' },
    { id: '2', startMs: 200, endMs: 300, text: '.' },
  ];
  const allGarbageRes = sanitizeSubtitles(allGarbage);
  assert.strictEqual(allGarbageRes.cleaned.length, 0);
  assert.strictEqual(allGarbageRes.removedCount, 2);
});

runTest('7.2. Lọc bỏ dòng chỉ có khoảng trắng hoặc mốc thời gian hỏng', () => {
  const corruptedLines: SrtLine[] = [
    { id: 'c1', startMs: 1000, endMs: 3000, text: '   ' },
    { id: 'c2', startMs: 5000, endMs: 4000, text: 'Thời gian kết thúc trước bắt đầu' },
    { id: 'c3', startMs: -100, endMs: 2000, text: 'Bắt đầu âm' },
    { id: 'c4', startMs: 1000, endMs: 1000, text: 'Thời lượng bằng 0' },
  ];

  for (const line of corruptedLines) {
    assert.strictEqual(
      isOcrGarbageLine(line),
      true,
      `Dòng lỗi '${line.text}' phải bị xác định là rác`
    );
  }
});

// ---------------------------------------------------------------------------
// TEST GROUP 8: TÍCH HỢP HYBRID FUSION ENGINE VỚI BỘ LỌC RÁC
// ---------------------------------------------------------------------------
runTest('8.1. fuseOcrAndWhisper loại bỏ rác OCR thay vì biến thành banner video tĩnh', () => {
  const ocrWithGarbage: SrtLine[] = [
    // Rác OCR 1-char lọt vào không có Whisper
    { id: 'ocr-garbage-1', startMs: 500, endMs: 1000, text: 'c' },
    // Banner tĩnh hợp lệ không có Whisper
    { id: 'ocr-banner-real', startMs: 1500, endMs: 3500, text: 'TẬP ĐẶC BIỆT' },
    // Dấu câu trôi nổi không có Whisper
    { id: 'ocr-garbage-2', startMs: 4000, endMs: 4800, text: '...' },
    // Thoại đối chiếu khớp Whisper
    { id: 'ocr-dialogue', startMs: 5000, endMs: 8000, text: 'Xin chao cac ban' },
    // Nhiễu chớp hình < 150ms không có Whisper
    { id: 'ocr-garbage-3', startMs: 8500, endMs: 8600, text: 'Vết lóe' },
  ];

  const whisperSegments: SrtLine[] = [
    { id: 'wh-1', startMs: 4900, endMs: 8100, text: 'Xin chào các bạn' },
  ];

  const fusion = fuseOcrAndWhisper(ocrWithGarbage, whisperSegments);

  // Chỉ có banner 'TẬP ĐẶC BIỆT' và thoại 'Xin chào các bạn' được giữ lại
  assert.strictEqual(fusion.segments.length, 2);
  assert.strictEqual(fusion.segments[0].text, 'TẬP ĐẶC BIỆT');
  assert.strictEqual(fusion.segments[1].text, 'Xin chào các bạn');

  // Thống kê ghi nhận chính xác:
  assert.strictEqual(fusion.stats.bannersPreserved, 1, 'Chỉ 1 banner thực sự được giữ lại');
  assert.strictEqual(fusion.stats.garbageFiltered, 3, 'Đã lọc đúng 3 dòng rác OCR');
  assert.strictEqual(fusion.stats.matchedSegments, 1, '1 phân đoạn khớp thoại Whisper');
});

runTest('8.2. Options tùy chỉnh (minDurationMs, removeSingleChars)', () => {
  const testLine: SrtLine = { id: 'opt-1', startMs: 1000, endMs: 2000, text: 'a' };

  // Mặc định: loại bỏ 'a'
  assert.strictEqual(isOcrGarbageLine(testLine), true);

  // Tắt removeSingleChars: giữ lại 'a'
  assert.strictEqual(isOcrGarbageLine(testLine, { removeSingleChars: false }), false);

  const durationLine: SrtLine = { id: 'opt-2', startMs: 1000, endMs: 1200, text: 'Hai trăm ms' }; // 200ms
  // Ngưỡng mặc định 150ms: giữ lại
  assert.strictEqual(isOcrGarbageLine(durationLine), false);
  // Nâng ngưỡng lên 300ms: loại bỏ
  assert.strictEqual(isOcrGarbageLine(durationLine, { minDurationMs: 300 }), true);
});

console.log(`\n=== TỔNG KẾT: ${passCount}/${totalCount} TEST ĐÃ VƯỢT QUA (100%) ===\n`);
if (passCount !== totalCount) {
  process.exit(1);
}
