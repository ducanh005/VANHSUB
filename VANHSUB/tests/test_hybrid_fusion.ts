import assert from 'assert';
import {
  fuseOcrAndWhisper,
  stripVietnameseDiacritics,
  normalizeOpticalConfusions,
  evaluateWordMatch,
  alignTokens,
} from '../main/asr/hybridFusionEngine';
import type { SrtLine } from '../main/lib/srt';

console.log('=== BẮT ĐẦU TEST SUITE: HYBRID WHISPER ASR + OCR FUSION ENGINE ===\n');

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
// TEST 1: OCR TIMESTAMP ANCHORING (100% video frame alignment)
// ---------------------------------------------------------------------------
runTest('1.1. Neo mốc thời gian tuyệt đối theo OCR (startMs, endMs khớp từng mili-giây)', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'ocr-1', startMs: 1200, endMs: 3400, text: 'hom nay toi di lam' },
    { id: 'ocr-2', startMs: 5000, endMs: 7800, text: 'thoi tiet rat dep' },
  ];

  // Whisper có timestamp trôi do Voice Activity Detection: lệch 400ms - 800ms
  const whisperSegments: SrtLine[] = [
    { id: 'wh-1', startMs: 800, endMs: 4000, text: 'hôm nay tôi đi làm' },
    { id: 'wh-2', startMs: 4600, endMs: 8200, text: 'thời tiết rất đẹp' },
  ];

  const result = fuseOcrAndWhisper(ocrSegments, whisperSegments);

  assert.strictEqual(result.segments.length, 2);
  // Khớp chính xác mốc OCR
  assert.strictEqual(result.segments[0].startMs, 1200, 'Segment 0 startMs phải là 1200');
  assert.strictEqual(result.segments[0].endMs, 3400, 'Segment 0 endMs phải là 3400');
  assert.strictEqual(result.segments[1].startMs, 5000, 'Segment 1 startMs phải là 5000');
  assert.strictEqual(result.segments[1].endMs, 7800, 'Segment 1 endMs phải là 7800');
});

// ---------------------------------------------------------------------------
// TEST 2: TEXT REPAIR - MISSING DIACRITICS
// ---------------------------------------------------------------------------
runTest('2.1. Phục hồi đầy đủ dấu thanh tiếng Việt bị thiếu trong OCR bằng giọng nói Whisper', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'ocr-1', startMs: 1000, endMs: 3000, text: 'hom nay toi di lam' },
  ];
  const whisperSegments: SrtLine[] = [
    { id: 'wh-1', startMs: 900, endMs: 3100, text: 'hôm nay tôi đi làm' },
  ];

  const result = fuseOcrAndWhisper(ocrSegments, whisperSegments);
  assert.strictEqual(result.segments[0].text, 'hôm nay tôi đi làm');
  assert.ok(result.stats.diacriticsRestored >= 4, `Số dấu phục hồi: ${result.stats.diacriticsRestored}`);
});

// ---------------------------------------------------------------------------
// TEST 3: TEXT REPAIR - OPTICAL CHARACTER CONFUSIONS (1/l, 0/O, numbers)
// ---------------------------------------------------------------------------
runTest('3.1. Sửa lỗi nhầm lẫn ký tự quang học OCR (chữ O thành số 0, số 1 thành một)', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'ocr-1', startMs: 1000, endMs: 4000, text: 'Năm 2O26 có 1 câu chuyện' },
  ];
  const whisperSegments: SrtLine[] = [
    { id: 'wh-1', startMs: 1000, endMs: 4000, text: 'Năm 2026 có một câu chuyện' },
  ];

  const result = fuseOcrAndWhisper(ocrSegments, whisperSegments);
  assert.strictEqual(result.segments[0].text, 'Năm 2026 có một câu chuyện');
  assert.ok(result.stats.typosRepaired >= 1, `Số lỗi sửa: ${result.stats.typosRepaired}`);
});

// ---------------------------------------------------------------------------
// TEST 4: TEXT REPAIR - OBSCURED / MISSING WORDS
// ---------------------------------------------------------------------------
runTest('4.1. Bổ sung từ bị khuất/bỏ sót trong OCR dựa trên spoken Whisper tokens', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'ocr-1', startMs: 1000, endMs: 4000, text: 'Chào mừng các bạn trở lại' },
  ];
  const whisperSegments: SrtLine[] = [
    { id: 'wh-1', startMs: 950, endMs: 4100, text: 'Chào mừng các bạn đã quay trở lại' },
  ];

  const result = fuseOcrAndWhisper(ocrSegments, whisperSegments);
  assert.strictEqual(result.segments[0].text, 'Chào mừng các bạn đã quay trở lại');
  assert.ok(result.stats.wordsRestored >= 2, `Số từ khôi phục: ${result.stats.wordsRestored}`);
});

// ---------------------------------------------------------------------------
// TEST 5: VISUAL-ONLY BANNER PRESERVATION
// ---------------------------------------------------------------------------
runTest('5.1. Bảo toàn nguyên vẹn banner đồ họa trên màn hình không có tiếng nói', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'ocr-banner', startMs: 500, endMs: 2500, text: 'TẬP 1: MỞ ĐẦU THỜI KỲ MỚI' },
    { id: 'ocr-dialogue', startMs: 4000, endMs: 6500, text: 'Xin chao moi nguoi' },
  ];
  const whisperSegments: SrtLine[] = [
    // Không có tiếng nói ở giây 0.5 - 2.5
    { id: 'wh-dialogue', startMs: 3800, endMs: 6700, text: 'Xin chào mọi người' },
  ];

  const result = fuseOcrAndWhisper(ocrSegments, whisperSegments);
  assert.strictEqual(result.segments.length, 2);
  assert.strictEqual(result.segments[0].text, 'TẬP 1: MỞ ĐẦU THỜI KỲ MỚI');
  assert.strictEqual(result.segments[0].startMs, 500);
  assert.strictEqual(result.segments[0].endMs, 2500);
  assert.strictEqual(result.segments[1].text, 'Xin chào mọi người');
  assert.strictEqual(result.stats.bannersPreserved, 1);
  assert.strictEqual(result.stats.matchedSegments, 1);
});

// ---------------------------------------------------------------------------
// TEST 6: SUB-SEQUENCE SPLIT MATCHING (Whisper dài chia cho nhiều OCR segments)
// ---------------------------------------------------------------------------
runTest('6.1. Một câu Whisper dài đối chiếu chính xác cho 2 dòng OCR ngắn liên tiếp', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'ocr-1', startMs: 1000, endMs: 2800, text: 'Chung ta dang song' },
    { id: 'ocr-2', startMs: 3000, endMs: 5000, text: 'trong mot the gioi ky thuat so' },
  ];
  // Whisper sinh 1 câu liền mạch kéo dài từ 0.8s đến 5.2s
  const whisperSegments: SrtLine[] = [
    { id: 'wh-long', startMs: 800, endMs: 5200, text: 'Chúng ta đang sống trong một thế giới kỹ thuật số' },
  ];

  const result = fuseOcrAndWhisper(ocrSegments, whisperSegments);
  assert.strictEqual(result.segments.length, 2);
  assert.strictEqual(result.segments[0].startMs, 1000);
  assert.strictEqual(result.segments[0].endMs, 2800);
  assert.strictEqual(result.segments[0].text, 'Chúng ta đang sống');

  assert.strictEqual(result.segments[1].startMs, 3000);
  assert.strictEqual(result.segments[1].endMs, 5000);
  assert.strictEqual(result.segments[1].text, 'trong một thế giới kỹ thuật số');
});

// ---------------------------------------------------------------------------
// TEST 7: EDGE CASES
// ---------------------------------------------------------------------------
runTest('7.1. Xử lý an toàn mảng OCR rỗng', () => {
  const result = fuseOcrAndWhisper([], [{ id: '1', startMs: 100, endMs: 500, text: 'alo' }]);
  assert.strictEqual(result.segments.length, 0);
  assert.strictEqual(result.stats.totalOcrSegments, 0);
});

runTest('7.2. Xử lý an toàn mảng Whisper rỗng (toàn bộ OCR biến thành banner)', () => {
  const ocrSegments: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Phụ đề video không lời' },
    { id: '2', startMs: 3000, endMs: 4000, text: 'Ký tên đạo diễn' },
  ];
  const result = fuseOcrAndWhisper(ocrSegments, []);
  assert.strictEqual(result.segments.length, 2);
  assert.strictEqual(result.segments[0].text, 'Phụ đề video không lời');
  assert.strictEqual(result.segments[1].text, 'Ký tên đạo diễn');
  assert.strictEqual(result.stats.bannersPreserved, 2);
});

runTest('7.3. Tiện ích chuẩn hóa diacritics và optical confusions', () => {
  assert.strictEqual(stripVietnameseDiacritics('Đường Đời Đầy Đau Đớn'), 'Duong Doi Day Dau Don');
  assert.strictEqual(stripVietnameseDiacritics('Tiếng Việt có dấu'), 'Tieng Viet co dau');
  assert.strictEqual(normalizeOpticalConfusions('2O26'), '2o26');
  assert.strictEqual(normalizeOpticalConfusions('2026'), '2o26');
  assert.strictEqual(normalizeOpticalConfusions('1àm'), 'làm');
});

runTest('7.4. Sửa đồng thời nhiều lỗi phức tạp (vừa mất dấu, vừa nhầm ký tự quang học 1/l, vừa thiếu từ)', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'ocr-complex', startMs: 2000, endMs: 5000, text: 'Năm 2O26 toi di 1am o Ha Noi' },
  ];
  const whisperSegments: SrtLine[] = [
    { id: 'wh-complex', startMs: 1800, endMs: 5200, text: 'Năm 2026 tôi đi làm việc ở Hà Nội' },
  ];

  const result = fuseOcrAndWhisper(ocrSegments, whisperSegments);
  assert.strictEqual(result.segments[0].startMs, 2000);
  assert.strictEqual(result.segments[0].endMs, 5000);
  assert.strictEqual(result.segments[0].text, 'Năm 2026 tôi đi làm việc ở Hà Nội');
  assert.ok(result.stats.typosRepaired >= 1);
  assert.ok(result.stats.diacriticsRestored >= 2);
  assert.ok(result.stats.wordsRestored >= 1);
});

runTest('7.5. Video xen kẽ nhiều banner tĩnh giữa các câu đối thoại', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'b1', startMs: 0, endMs: 2000, text: 'CHƯƠNG 1' },
    { id: 'd1', startMs: 2200, endMs: 4000, text: 'xin chao' },
    { id: 'b2', startMs: 4200, endMs: 6000, text: 'ĐẠO DIỄN: NGUYỄN VĂN A' },
    { id: 'd2', startMs: 6200, endMs: 8000, text: 'tam biet' },
    { id: 'b3', startMs: 8200, endMs: 10000, text: 'HẾT PHIM' },
  ];
  const whisperSegments: SrtLine[] = [
    { id: 'w1', startMs: 2100, endMs: 3900, text: 'xin chào' },
    { id: 'w2', startMs: 6300, endMs: 7900, text: 'tạm biệt' },
  ];

  const result = fuseOcrAndWhisper(ocrSegments, whisperSegments);
  assert.strictEqual(result.segments.length, 5);
  assert.strictEqual(result.segments[0].text, 'CHƯƠNG 1');
  assert.strictEqual(result.segments[1].text, 'xin chào');
  assert.strictEqual(result.segments[2].text, 'ĐẠO DIỄN: NGUYỄN VĂN A');
  assert.strictEqual(result.segments[3].text, 'tạm biệt');
  assert.strictEqual(result.segments[4].text, 'HẾT PHIM');
  assert.strictEqual(result.stats.bannersPreserved, 3);
  assert.strictEqual(result.stats.matchedSegments, 2);
});

console.log(`\n=== TỔNG KẾT: ${passCount}/${totalCount} TEST ĐÃ VƯỢT QUA (100%) ===\n`);
if (passCount !== totalCount) {
  process.exit(1);
}
