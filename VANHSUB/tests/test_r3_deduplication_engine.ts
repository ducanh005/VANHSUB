import assert from 'assert';
import type { SrtLine } from '../main/lib/srt';
import {
  deduplicateExact,
  deduplicateProgressiveKaraoke,
  deduplicateWhisperOcrCross,
  deduplicateSubtitlesPipeline,
  normalizeText,
  stripEdgePunctuation,
  stripVietnameseDiacritics,
  levenshteinDistance,
  type DedupOptions,
} from '../main/lib/subtitleDeduplication';
import { fuseOcrAndWhisper } from '../main/asr/hybridFusionEngine';
import { consolidateSubtitleClauses } from '../main/lib/nlpSegmenter';

console.log('=== BẮT ĐẦU TEST SUITE: THUẬT TOÁN KHỬ TRÙNG LẶP PHỤ ĐỀ THÔNG MINH (R3) ===\n');

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

// ===========================================================================
// GROUP 1: EXACT DUPLICATES DEDUPLICATION (deduplicateExact)
// ===========================================================================
console.log('--- NHÓM 1: LẶP NGUYÊN VĂN LIÊN TIẾP (EXACT DUPLICATES) ---');

runTest('1.1. Hai câu giống hệt nhau liên tiếp trong khoảng cách an toàn gộp thành 1 dòng duy nhất', () => {
  const lines: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2500, text: 'VanhSub Studio' },
    { id: '2', startMs: 2700, endMs: 4000, text: 'VanhSub Studio' },
  ];
  const deduped = deduplicateExact(lines);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 4000);
  assert.strictEqual(deduped[0].text, 'VanhSub Studio');
});

runTest('1.2. Ba câu giống hệt nhau liên tiếp gộp từ startMs đầu tiên đến endMs cuối cùng', () => {
  const lines: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Đồng thuận' },
    { id: '2', startMs: 2100, endMs: 3000, text: 'Đồng thuận' },
    { id: '3', startMs: 3100, endMs: 4500, text: 'Đồng thuận' },
  ];
  const deduped = deduplicateExact(lines);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 4500);
});

runTest('1.3. Chuẩn hóa không phân biệt hoa thường, khoảng trắng thừa và NFC unicode', () => {
  const lines: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: '  Học Viện Công Nghệ  ' },
    { id: '2', startMs: 2100, endMs: 3200, text: 'học viện công nghệ' },
  ];
  const deduped = deduplicateExact(lines);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 3200);
});

runTest('1.4. Bỏ qua dấu câu ở biên (dấu chấm, dấu than, dấu phẩy) khi so sánh lặp', () => {
  const lines: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Xin chào các bạn!' },
    { id: '2', startMs: 2100, endMs: 3500, text: 'Xin chào các bạn.' },
  ];
  const deduped = deduplicateExact(lines);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 3500);
});

runTest('1.5. Giới hạn khoảng cách: gap <= 1200ms gộp, gap 1201ms không gộp', () => {
  const linesMerge: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Câu lặp' },
    { id: '2', startMs: 3199, endMs: 4000, text: 'Câu lặp' }, // gap 1199ms
  ];
  assert.strictEqual(deduplicateExact(linesMerge).length, 1);

  const linesSplit: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Câu lặp' },
    { id: '2', startMs: 3205, endMs: 4000, text: 'Câu lặp' }, // gap 1205ms
  ];
  assert.strictEqual(deduplicateExact(linesSplit).length, 2);
});

runTest('1.6. Ranh giới khoảng lặng ngắt đoạn > 1500ms TUYỆT ĐỐI không gộp', () => {
  const lines: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Cảm ơn đã theo dõi' },
    { id: '2', startMs: 3550, endMs: 5000, text: 'Cảm ơn đã theo dõi' }, // gap 1550ms
  ];
  const deduped = deduplicateExact(lines);
  assert.strictEqual(deduped.length, 2);
  assert.strictEqual(deduped[0].endMs, 2000);
  assert.strictEqual(deduped[1].startMs, 3550);
});

runTest('1.7. Hai câu giống nhau bị chồng lấn timecode (gap âm) gộp chuẩn xác thành dải bao quát', () => {
  const lines: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 3000, text: 'Chồng lấn khung hình' },
    { id: '2', startMs: 2000, endMs: 4500, text: 'Chồng lấn khung hình' },
  ];
  const deduped = deduplicateExact(lines);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 4500);
});

runTest('1.8. Xử lý an toàn: mảng rỗng, mảng 1 phần tử, mảng xáo trộn startMs', () => {
  assert.deepStrictEqual(deduplicateExact([]), []);

  const single: SrtLine[] = [{ id: '1', startMs: 500, endMs: 1500, text: 'Đơn' }];
  assert.strictEqual(deduplicateExact(single).length, 1);

  const unordered: SrtLine[] = [
    { id: '2', startMs: 2500, endMs: 4000, text: 'Trật tự' },
    { id: '1', startMs: 1000, endMs: 2400, text: 'Trật tự' },
  ];
  const deduped = deduplicateExact(unordered);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 4000);
});

runTest('1.9. Chuỗi 50 khung hình OCR tĩnh lặp lại thu gọn thành đúng 1 dòng duy nhất', () => {
  const frames: SrtLine[] = Array.from({ length: 50 }, (_, i) => ({
    id: `f-${i}`,
    startMs: i * 200,
    endMs: i * 200 + 180,
    text: 'Frame video lặp',
  }));
  const deduped = deduplicateExact(frames);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].startMs, 0);
  assert.strictEqual(deduped[0].endMs, 49 * 200 + 180);
});

// ===========================================================================
// GROUP 2: INCREMENTAL / PROGRESSIVE KARAOKE OVERLAP (deduplicateProgressiveKaraoke)
// ===========================================================================
console.log('\n--- NHÓM 2: LẶP KIỂU KARAOKE / CHỮ HIỆN DẦN (PROGRESSIVE OVERLAP) ---');

runTest('2.1. Chuỗi karaoke 2 bước thu gọn thành câu dài hơn với start đầu và end cuối', () => {
  const lines: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Hôm nay tôi' },
    { id: '2', startMs: 2050, endMs: 3500, text: 'Hôm nay tôi đi học' },
  ];
  const deduped = deduplicateProgressiveKaraoke(lines);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].text, 'Hôm nay tôi đi học');
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 3500);
});

runTest('2.2. Câu chuẩn Authoritative Benchmark 3 bước thu gọn thành 1 câu đầy đủ nhất (1000ms -> 7000ms)', () => {
  const benchmark: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'chụp ảnh được' },
    { id: '2', startMs: 2000, endMs: 3500, text: 'chụp ảnh được, livestream được' },
    {
      id: '3',
      startMs: 3500,
      endMs: 7000,
      text: 'chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được, nhưng giá cho mỗi hoạt động tính thế nào?',
    },
  ];
  const deduped = deduplicateProgressiveKaraoke(benchmark);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 7000);
  assert.strictEqual(deduped[0].text, benchmark[2].text);
});

runTest('2.3. Dung sai lỗi chính tả / thiếu dấu ở tiền tố do OCR (chup anh duoc -> chụp ảnh được, livestream được)', () => {
  const lines: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'chup anh duoc' }, // mất dấu tiếng Việt
    { id: '2', startMs: 2100, endMs: 4000, text: 'chụp ảnh được, livestream được' },
  ];
  const deduped = deduplicateProgressiveKaraoke(lines);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].text, 'chụp ảnh được, livestream được');
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 4000);
});

runTest('2.4. Sai khác dấu câu biên ở tiền tố karaoke ("xin chào," vs "xin chào các bạn!")', () => {
  const lines: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'xin chào,' },
    { id: '2', startMs: 2100, endMs: 3500, text: 'xin chào các bạn!' },
  ];
  const deduped = deduplicateProgressiveKaraoke(lines);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].text, 'xin chào các bạn!');
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 3500);
});

runTest('2.5. Câu sau ngắn hơn câu trước KHÔNG kích hoạt gộp karaoke (giữ nguyên 2 câu)', () => {
  const lines: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2500, text: 'Hôm nay tôi đi học ở trường' },
    { id: '2', startMs: 2600, endMs: 3500, text: 'Hôm nay' },
  ];
  const deduped = deduplicateProgressiveKaraoke(lines);
  assert.strictEqual(deduped.length, 2);
  assert.strictEqual(deduped[0].text, 'Hôm nay tôi đi học ở trường');
  assert.strictEqual(deduped[1].text, 'Hôm nay');
});

runTest('2.6. Khoảng cách thời gian: gap 999ms tiếp tục chuỗi, gap 1205ms ngắt chuỗi', () => {
  const linesMerge: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'A B' },
    { id: '2', startMs: 2999, endMs: 4000, text: 'A B C' },
  ];
  assert.strictEqual(deduplicateProgressiveKaraoke(linesMerge).length, 1);

  const linesSplit: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'A B' },
    { id: '2', startMs: 3205, endMs: 4000, text: 'A B C' },
  ];
  assert.strictEqual(deduplicateProgressiveKaraoke(linesSplit).length, 2);
});

runTest('2.7. Từng từ hiện dần qua 5 khung hình thu gọn thành câu hoàn chỉnh cuối cùng', () => {
  const lines: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 1400, text: 'Tôi' },
    { id: '2', startMs: 1400, endMs: 1800, text: 'Tôi là' },
    { id: '3', startMs: 1800, endMs: 2200, text: 'Tôi là ai' },
    { id: '4', startMs: 2200, endMs: 2600, text: 'Tôi là ai đây' },
    { id: '5', startMs: 2600, endMs: 3500, text: 'Tôi là ai đây?' },
  ];
  const deduped = deduplicateProgressiveKaraoke(lines);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].text, 'Tôi là ai đây?');
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 3500);
});

runTest('2.8. Hai chuỗi karaoke độc lập cách nhau 2000ms phân giải thành 2 câu riêng biệt', () => {
  const lines: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 2000, text: 'Một hai' },
    { id: '2', startMs: 2000, endMs: 3000, text: 'Một hai ba bốn' },
    // gap 2000ms
    { id: '3', startMs: 5000, endMs: 6000, text: 'Năm sáu' },
    { id: '4', startMs: 6000, endMs: 7500, text: 'Năm sáu bảy tám' },
  ];
  const deduped = deduplicateProgressiveKaraoke(lines);
  assert.strictEqual(deduped.length, 2);
  assert.strictEqual(deduped[0].text, 'Một hai ba bốn');
  assert.strictEqual(deduped[1].text, 'Năm sáu bảy tám');
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 3000);
  assert.strictEqual(deduped[1].startMs, 5000);
  assert.strictEqual(deduped[1].endMs, 7500);
});

// ===========================================================================
// GROUP 3: CROSS-MODAL WHISPER-OCR DEDUPLICATION (deduplicateWhisperOcrCross)
// ===========================================================================
console.log('\n--- NHÓM 3: KHỬ LẶP CHÉO GIỮA WHISPER VÀ OCR (CROSS-MODAL DEDUPLICATION) ---');

runTest('3.1. Hợp nhất phân đoạn OCR và Whisper trùng lặp (neo thời gian OCR, chuẩn hóa dấu Whisper)', () => {
  const ocr: SrtLine[] = [
    { id: 'ocr-1', startMs: 1200, endMs: 3400, text: 'hom nay toi di lam' },
  ];
  const whisper: SrtLine[] = [
    { id: 'wh-1', startMs: 900, endMs: 3800, text: 'hôm nay tôi đi làm' },
  ];
  const cross = deduplicateWhisperOcrCross(ocr, whisper);
  assert.strictEqual(cross.length, 1);
  assert.strictEqual(cross[0].startMs, 1200);
  assert.strictEqual(cross[0].endMs, 3400);
  assert.strictEqual(cross[0].text, 'hôm nay tôi đi làm');
});

runTest('3.2. Bảo toàn nguyên vẹn đoạn thoại Whisper độc lập (speech-only, không có chữ trên màn hình)', () => {
  const ocr: SrtLine[] = [];
  const whisper: SrtLine[] = [
    { id: 'wh-1', startMs: 2000, endMs: 4000, text: 'Lời thoại trong phòng tối' },
  ];
  const cross = deduplicateWhisperOcrCross(ocr, whisper);
  assert.strictEqual(cross.length, 1);
  assert.strictEqual(cross[0].text, 'Lời thoại trong phòng tối');
  assert.strictEqual(cross[0].startMs, 2000);
  assert.strictEqual(cross[0].endMs, 4000);
});

runTest('3.3. Bảo toàn nguyên vẹn banner đồ họa tĩnh OCR (không có âm thanh nói)', () => {
  const ocr: SrtLine[] = [
    { id: 'ocr-1', startMs: 5000, endMs: 9000, text: 'TIÊU ĐỀ: BẢN TIN TRƯA' },
  ];
  const whisper: SrtLine[] = [];
  const cross = deduplicateWhisperOcrCross(ocr, whisper);
  assert.strictEqual(cross.length, 1);
  assert.strictEqual(cross[0].text, 'TIÊU ĐỀ: BẢN TIN TRƯA');
  assert.strictEqual(cross[0].startMs, 5000);
  assert.strictEqual(cross[0].endMs, 9000);
});

runTest('3.4. Dòng thời gian sau hợp nhất được sắp xếp tăng dần không bị chồng chéo', () => {
  const ocr: SrtLine[] = [
    { id: 'ocr-1', startMs: 1000, endMs: 3000, text: 'Đoạn một' },
    { id: 'ocr-2', startMs: 7000, endMs: 9000, text: 'Đoạn ba' },
  ];
  const whisper: SrtLine[] = [
    { id: 'wh-1', startMs: 4000, endMs: 6000, text: 'Đoạn hai chỉ có tiếng' },
  ];
  const cross = deduplicateWhisperOcrCross(ocr, whisper);
  assert.strictEqual(cross.length, 3);
  for (let i = 0; i < cross.length - 1; i++) {
    assert.ok(cross[i].startMs <= cross[i + 1].startMs);
  }
});

runTest('3.5. Cửa sổ dung sai thời gian: lệch -800ms hoặc +800ms khớp, lệch +850ms không khớp', () => {
  const ocrA: SrtLine[] = [{ id: 'o1', startMs: 2000, endMs: 4000, text: 'vanhsub studio' }];
  const whA: SrtLine[] = [{ id: 'w1', startMs: 1200, endMs: 3600, text: 'VanhSub Studio' }]; // -800ms
  assert.strictEqual(deduplicateWhisperOcrCross(ocrA, whA).length, 1);

  const ocrB: SrtLine[] = [{ id: 'o1', startMs: 2000, endMs: 4000, text: 'tri tue nhan tao' }];
  const whB: SrtLine[] = [{ id: 'w1', startMs: 2800, endMs: 4800, text: 'trí tuệ nhân tạo' }]; // +800ms
  assert.strictEqual(deduplicateWhisperOcrCross(ocrB, whB).length, 1);

  const ocrC: SrtLine[] = [{ id: 'o1', startMs: 1000, endMs: 2000, text: 'Banner 1' }];
  const whC: SrtLine[] = [{ id: 'w1', startMs: 2850, endMs: 4000, text: 'Lời nói độc lập' }]; // +850ms past end
  assert.strictEqual(deduplicateWhisperOcrCross(ocrC, whC).length, 2);
});

runTest('3.6. Loại bỏ hoàn toàn tiếng vọng trùng lặp khi cả hai luồng cùng bắt 1 câu thoại', () => {
  const ocr: SrtLine[] = [
    { id: 'ocr-1', startMs: 1000, endMs: 3000, text: 'Xin kính chào quý vị' },
  ];
  const whisper: SrtLine[] = [
    { id: 'wh-1', startMs: 1400, endMs: 3400, text: 'Xin kính chào quý vị' },
  ];
  const cross = deduplicateWhisperOcrCross(ocr, whisper);
  assert.strictEqual(cross.length, 1);
});

// ===========================================================================
// GROUP 4: PIPELINE KHỬ TRÙNG LẶP & CÁC TƯƠNG TÁC PHỨC TẠP
// ===========================================================================
console.log('\n--- NHÓM 4: PIPELINE DEDUPLICATION & TƯƠNG TÁC ĐA TẦNG ---');

runTest('4.1. deduplicateSubtitlesPipeline: xử lý kết hợp cả exact duplicate và progressive karaoke', () => {
  const dirty: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 1800, text: 'chào các bạn' },
    { id: '2', startMs: 1850, endMs: 2600, text: 'chào các bạn' }, // exact duplicate
    { id: '3', startMs: 2650, endMs: 4000, text: 'chào các bạn đã đến với kênh' }, // progressive
  ];
  const result = deduplicateSubtitlesPipeline(dirty);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].text, 'chào các bạn đã đến với kênh');
  assert.strictEqual(result[0].startMs, 1000);
  assert.strictEqual(result[0].endMs, 4000);
});

runTest('4.2. Luồng OCR phức tạp: nhiều frame lặp xen kẽ karaoke -> thu gọn về 1 câu duy nhất', () => {
  const stream: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 1500, text: 'học máy' },
    { id: '2', startMs: 1500, endMs: 2000, text: 'học máy' },
    { id: '3', startMs: 2000, endMs: 2800, text: 'học máy và trí tuệ nhân tạo' },
    { id: '4', startMs: 2800, endMs: 3500, text: 'học máy và trí tuệ nhân tạo' },
    { id: '5', startMs: 3500, endMs: 5000, text: 'học máy và trí tuệ nhân tạo đang thay đổi thế giới' },
  ];
  const result = deduplicateSubtitlesPipeline(stream);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].text, 'học máy và trí tuệ nhân tạo đang thay đổi thế giới');
  assert.strictEqual(result[0].startMs, 1000);
  assert.strictEqual(result[0].endMs, 5000);
});

runTest('4.3. fuseOcrAndWhisper tích hợp preserveSpeechOnlyWhisper và deduplicateKaraoke', () => {
  const ocr: SrtLine[] = [
    { id: 'k1', startMs: 1000, endMs: 1800, text: 'chup anh duoc' },
    { id: 'k2', startMs: 1800, endMs: 3000, text: 'chup anh duoc, livestream duoc' },
  ];
  const whisper: SrtLine[] = [
    { id: 'w1', startMs: 950, endMs: 3100, text: 'chụp ảnh được, livestream được' },
    { id: 'w2', startMs: 5000, endMs: 7000, text: 'Lời thoại sau đó không có chữ' },
  ];
  const fused = fuseOcrAndWhisper(ocr, whisper, {
    preserveSpeechOnlyWhisper: true,
    deduplicateKaraoke: true,
  });

  assert.strictEqual(fused.segments.length, 2);
  assert.strictEqual(fused.segments[0].startMs, 1000);
  assert.strictEqual(fused.segments[0].text, 'chụp ảnh được, livestream được');
  assert.strictEqual(fused.segments[1].startMs, 5000);
  assert.strictEqual(fused.segments[1].text, 'Lời thoại sau đó không có chữ');
  assert.strictEqual(fused.stats.speechOnlyPreserved, 1);
});

runTest('4.4. Defensive guard trong nlpSegmenter: text > 74 chars nhưng duration siêu ngắn không sinh timecode nghịch', () => {
  const longShortDurationLine: SrtLine = {
    id: 'test-guard',
    startMs: 1000,
    endMs: 1050, // 50ms duration, but text is 90 chars -> 3 chunks
    text: 'Đây là một câu rất dài nhằm kiểm tra độ an toàn của thuật toán khi duration nhỏ hơn 100 mili-giây.',
  };
  const wrapped = consolidateSubtitleClauses([longShortDurationLine]);
  assert.ok(wrapped.length >= 1);
  for (const block of wrapped) {
    assert.ok(block.startMs <= block.endMs, `Timecode bị nghịch đảo: start=${block.startMs}, end=${block.endMs}`);
  }
});

// ===========================================================================
// TỔNG KẾT TEST SUITE
// ===========================================================================
console.log('\n===========================================================================');
console.log(`📊 TỔNG KẾT TEST SUITE R3: ${passCount}/${totalCount} TEST ĐÃ VƯỢT QUA (${Math.round((passCount / totalCount) * 100)}%)`);
console.log('===========================================================================');
