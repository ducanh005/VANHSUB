import {
  CleanSubtitlesItem,
  AiGroupedSubtitle,
  resolveGroupedTimestamps,
  cleanAndDeduplicateSubtitles,
  MAX_SUBTITLE_GAP_MS,
} from '../main/ai/geminiClient';

let passedCount = 0;
let totalCount = 0;

function assert(cond: boolean, msg: string) {
  totalCount++;
  if (!cond) {
    console.error(`  ❌ FAIL: ${msg}`);
    process.exit(1);
  }
  passedCount++;
  console.log(`  ✅ PASS: ${msg}`);
}

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Exact Timestamp Preservation in AI Subtitle Deduplication (R3)\n');

  // ==========================================================================
  // Section 1: Timestamp Precision (Exact Boundary Binding)
  // ==========================================================================
  console.log('--- Section 1: Timestamp Precision (startMs & endMs exact matching) ---');

  {
    const original: CleanSubtitlesItem[] = [
      { startMs: 1423, endMs: 2510, text: 'Hôm nay tôi' },
      { startMs: 2605, endMs: 3871, text: 'Hôm nay tôi đi' },
      { startMs: 3950, endMs: 5699, text: 'đi làm rất vui' },
    ];

    const aiGroups: AiGroupedSubtitle[] = [
      { sourceIndices: [0, 1, 2], text: 'Hôm nay tôi đi làm rất vui' },
    ];

    const result = resolveGroupedTimestamps(original, aiGroups);

    assert(result.length === 1, 'Group gồm 3 dòng gộp thành 1 dòng duy nhất');
    assert(result[0].startMs === 1423, `startMs (${result[0].startMs}) khớp chính xác original[0].startMs (1423)`);
    assert(result[0].endMs === 5699, `endMs (${result[0].endMs}) khớp chính xác original[2].endMs (5699)`);
    assert(result[0].text === 'Hôm nay tôi đi làm rất vui', 'Text đã làm sạch được bảo toàn');
  }

  {
    // Multiple distinct clusters with exact boundaries
    const original: CleanSubtitlesItem[] = [
      { startMs: 100, endMs: 800, text: 'Dòng 0' },
      { startMs: 850, endMs: 1600, text: 'Dòng 1' },
      { startMs: 2500, endMs: 3200, text: 'Dòng 2' },
      { startMs: 3300, endMs: 4100, text: 'Dòng 3' },
    ];

    const aiGroups: AiGroupedSubtitle[] = [
      { sourceIndices: [0, 1], text: 'Cụm 1 đã gộp' },
      { sourceIndices: [2, 3], text: 'Cụm 2 đã gộp' },
    ];

    const result = resolveGroupedTimestamps(original, aiGroups);

    assert(result.length === 2, '2 cụm riêng biệt tạo ra 2 subtitle lines');
    assert(result[0].startMs === 100, 'Cụm 1 startMs = 100');
    assert(result[0].endMs === 1600, 'Cụm 1 endMs = 1600');
    assert(result[1].startMs === 2500, 'Cụm 2 startMs = 2500');
    assert(result[1].endMs === 4100, 'Cụm 2 endMs = 4100');
  }

  // ==========================================================================
  // Section 2: Max Gap Guard (Silence > 1500ms splits cluster)
  // ==========================================================================
  console.log('\n--- Section 2: Max Gap Guard (Tách cụm khi khoảng lặng > 1500ms) ---');

  {
    // Test 2.1: Large silence gap between 2 lines (12000ms gap)
    const original: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 3000, text: 'Xin chào quý vị' },
      { startMs: 15000, endMs: 17000, text: 'Xin chào quý vị' },
    ];

    // LLM mistakenly grouped them because the text was identical
    const aiGroups: AiGroupedSubtitle[] = [
      { sourceIndices: [0, 1], text: 'Xin chào quý vị' },
    ];

    const result = resolveGroupedTimestamps(original, aiGroups, MAX_SUBTITLE_GAP_MS);

    assert(result.length === 2, 'Max Gap Guard tách cụm thành 2 dòng khi gap = 12000ms > 1500ms');
    assert(result[0].startMs === 1000 && result[0].endMs === 3000, 'Dòng 1 giữ nguyên mốc 1000 - 3000ms');
    assert(result[1].startMs === 15000 && result[1].endMs === 17000, 'Dòng 2 giữ nguyên mốc 15000 - 17000ms');
    assert(
      result[1].startMs - result[0].endMs === 12000,
      'Khoảng lặng 12s giữa video được bảo toàn, không bị phụ đề treo lơ lửng'
    );
  }

  {
    // Test 2.2: Boundary threshold tests
    // Case A: gap === 1500ms exactly -> NOT split
    const originalNoSplit: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 2000, text: 'Part 1' },
      { startMs: 3500, endMs: 4500, text: 'Part 2' }, // gap = 3500 - 2000 = 1500ms
    ];
    const resA = resolveGroupedTimestamps(originalNoSplit, [{ sourceIndices: [0, 1], text: 'Combined' }], 1500);
    assert(resA.length === 1, 'Khoảng lặng đúng 1500ms (gap <= 1500) không bị tách nhóm');
    assert(resA[0].startMs === 1000 && resA[0].endMs === 4500, 'Cụm gộp có startMs = 1000, endMs = 4500');

    // Case B: gap === 1501ms -> SPLIT
    const originalSplit: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 2000, text: 'Part 1' },
      { startMs: 3501, endMs: 4500, text: 'Part 2' }, // gap = 3501 - 2000 = 1501ms
    ];
    const resB = resolveGroupedTimestamps(originalSplit, [{ sourceIndices: [0, 1], text: 'Combined' }], 1500);
    assert(resB.length === 2, 'Khoảng lặng 1501ms (> 1500ms) kích hoạt Max Gap Guard tách nhóm');
    assert(resB[0].startMs === 1000 && resB[0].endMs === 2000, 'Phần 1: 1000 - 2000ms');
    assert(resB[1].startMs === 3501 && resB[1].endMs === 4500, 'Phần 2: 3501 - 4500ms');
  }

  {
    // Test 2.3: 4-line cluster with gap in the middle
    const original: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 2000, text: 'Line 0' },
      { startMs: 2200, endMs: 3000, text: 'Line 1' }, // gap 0->1 = 200ms
      { startMs: 7000, endMs: 8000, text: 'Line 2' }, // gap 1->2 = 4000ms > 1500ms -> SPLIT
      { startMs: 8200, endMs: 9500, text: 'Line 3' }, // gap 2->3 = 200ms
    ];

    const aiGroups: AiGroupedSubtitle[] = [
      { sourceIndices: [0, 1, 2, 3], text: 'Four lines grouped' },
    ];

    const result = resolveGroupedTimestamps(original, aiGroups, 1500);

    assert(result.length === 2, 'Nhóm 4 dòng có khoảng lặng ở giữa được tách thành 2 cụm');
    assert(result[0].startMs === 1000, 'Cụm 1 bắt đầu tại 1000ms (original[0].startMs)');
    assert(result[0].endMs === 3000, 'Cụm 1 kết thúc tại 3000ms (original[1].endMs)');
    assert(result[1].startMs === 7000, 'Cụm 2 bắt đầu tại 7000ms (original[2].startMs)');
    assert(result[1].endMs === 9500, 'Cụm 2 kết thúc tại 9500ms (original[3].endMs)');
  }

  // ==========================================================================
  // Section 3: Missing Index Recovery (100% Omitted Line Preservation)
  // ==========================================================================
  console.log('\n--- Section 3: Missing Index Recovery (Bảo toàn 100% dữ liệu không bị sót) ---');

  {
    // Test 3.1: AI merges lines 1 & 2, but completely omits lines 0, 3, 4
    const original: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 2000, text: 'Dòng 0 độc lập' },
      { startMs: 2200, endMs: 3000, text: 'Dòng 1 vế đầu' },
      { startMs: 3100, endMs: 4500, text: 'Dòng 2 vế sau' },
      { startMs: 5000, endMs: 6000, text: 'Dòng 3 độc lập' },
      { startMs: 6500, endMs: 7500, text: 'Dòng 4 kết thúc' },
    ];

    const aiGroups: AiGroupedSubtitle[] = [
      { sourceIndices: [1, 2], text: 'Dòng 1 và 2 hoàn chỉnh' },
    ];

    const result = resolveGroupedTimestamps(original, aiGroups);

    assert(result.length === 4, 'Kết quả có 4 phần: Dòng 0 (khôi phục) + Cụm [1,2] + Dòng 3 (khôi phục) + Dòng 4 (khôi phục)');
    assert(result[0].startMs === 1000 && result[0].text === 'Dòng 0 độc lập', 'Dòng 0 được khôi phục nguyên vẹn');
    assert(result[1].startMs === 2200 && result[1].endMs === 4500 && result[1].text === 'Dòng 1 và 2 hoàn chỉnh', 'Cụm [1,2] được gộp đúng');
    assert(result[2].startMs === 5000 && result[2].text === 'Dòng 3 độc lập', 'Dòng 3 được khôi phục nguyên vẹn');
    assert(result[3].startMs === 6500 && result[3].text === 'Dòng 4 kết thúc', 'Dòng 4 được khôi phục nguyên vẹn');
  }

  {
    // Test 3.2: Complete omission (AI returns empty array)
    const original: CleanSubtitlesItem[] = [
      { startMs: 500, endMs: 1500, text: 'Item 1' },
      { startMs: 2000, endMs: 3000, text: 'Item 2' },
      { startMs: 3500, endMs: 4500, text: 'Item 3' },
    ];

    const result = resolveGroupedTimestamps(original, []);

    assert(result.length === 3, 'AI trả về mảng rỗng -> khôi phục 100% (3/3) dòng gốc');
    assert(result[0].text === 'Item 1' && result[1].text === 'Item 2' && result[2].text === 'Item 3', 'Tất cả nội dung nguyên bản');
  }

  // ==========================================================================
  // Section 4: Edge Cases
  // ==========================================================================
  console.log('\n--- Section 4: Edge Cases (Mảng rỗng, 1 phần tử, chỉ số xáo trộn, ...) ---');

  {
    // Test 4.1: Empty array input
    const resultEmpty = resolveGroupedTimestamps([], []);
    assert(Array.isArray(resultEmpty) && resultEmpty.length === 0, 'Input mảng rỗng trả về mảng rỗng');
  }

  {
    // Test 4.2: Single line input
    const single: CleanSubtitlesItem[] = [{ startMs: 1000, endMs: 2500, text: 'Dòng duy nhất' }];
    const resultSingle = resolveGroupedTimestamps(single, [{ sourceIndices: [0], text: 'Dòng duy nhất đã làm sạch' }]);
    assert(resultSingle.length === 1, 'Input 1 dòng trả về đúng 1 dòng');
    assert(resultSingle[0].startMs === 1000 && resultSingle[0].endMs === 2500, 'Timestamp dòng đơn lẻ giữ nguyên');
    assert(resultSingle[0].text === 'Dòng duy nhất đã làm sạch', 'Text dòng đơn lẻ được cập nhật');
  }

  {
    // Test 4.3: Disordered indices from LLM ([2, 0, 1])
    const original: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 2000, text: 'A' },
      { startMs: 2100, endMs: 3000, text: 'B' },
      { startMs: 3100, endMs: 4000, text: 'C' },
    ];

    const aiGroups: AiGroupedSubtitle[] = [
      { sourceIndices: [2, 0, 1], text: 'A B C' },
    ];

    const result = resolveGroupedTimestamps(original, aiGroups);
    assert(result.length === 1, 'Chỉ số xáo trộn [2, 0, 1] được sắp xếp chuẩn xác');
    assert(result[0].startMs === 1000, 'startMs lấy đúng min index = 0 (1000ms)');
    assert(result[0].endMs === 4000, 'endMs lấy đúng max index = 2 (4000ms)');
  }

  {
    // Test 4.4: Already-separated lines (no merging needed)
    const original: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 2000, text: 'Câu một' },
      { startMs: 3000, endMs: 4000, text: 'Câu hai' },
      { startMs: 5000, endMs: 6000, text: 'Câu ba' },
    ];

    const aiGroups: AiGroupedSubtitle[] = [
      { sourceIndices: [0], text: 'Câu một.' },
      { sourceIndices: [1], text: 'Câu hai.' },
      { sourceIndices: [2], text: 'Câu ba.' },
    ];

    const result = resolveGroupedTimestamps(original, aiGroups);
    assert(result.length === 3, 'Các dòng độc lập giữ nguyên số lượng 3');
    assert(result[0].startMs === 1000 && result[0].endMs === 2000, 'Dòng 0 chuẩn timestamp');
    assert(result[1].startMs === 3000 && result[1].endMs === 4000, 'Dòng 1 chuẩn timestamp');
    assert(result[2].startMs === 5000 && result[2].endMs === 6000, 'Dòng 2 chuẩn timestamp');
  }

  {
    // Test 4.5: Duplicate indices within group ([0, 0, 1, 1])
    const original: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 2000, text: 'Lặp' },
      { startMs: 2100, endMs: 3000, text: 'Lặp tiếp' },
    ];

    const aiGroups: AiGroupedSubtitle[] = [
      { sourceIndices: [0, 0, 1, 1], text: 'Đã gộp' },
    ];

    const result = resolveGroupedTimestamps(original, aiGroups);
    assert(result.length === 1, 'Chỉ số trùng lặp [0, 0, 1, 1] được khử trùng lặp');
    assert(result[0].startMs === 1000 && result[0].endMs === 3000, 'Timestamp bao phủ từ 1000 đến 3000ms');
  }

  {
    // Test 4.6: Out-of-bounds indices ([-1, 0, 1, 999])
    const original: CleanSubtitlesItem[] = [
      { startMs: 1000, endMs: 2000, text: 'Line 0' },
      { startMs: 2200, endMs: 3200, text: 'Line 1' },
    ];

    const aiGroups: AiGroupedSubtitle[] = [
      { sourceIndices: [-1, 0, 1, 999], text: 'Hợp lệ' },
    ];

    const result = resolveGroupedTimestamps(original, aiGroups);
    assert(result.length === 1, 'Chỉ số ngoài biên bị loại bỏ an toàn');
    assert(result[0].startMs === 1000 && result[0].endMs === 3200, 'Timestamp khớp đúng các chỉ số hợp lệ [0, 1]');
  }

  {
    // Test 4.7: 1-based indexing normalization ([1, 2] for 2 items)
    const original: CleanSubtitlesItem[] = [
      { startMs: 500, endMs: 1500, text: 'Item 0' },
      { startMs: 1600, endMs: 2800, text: 'Item 1' },
    ];

    const aiGroups: AiGroupedSubtitle[] = [
      { sourceIndices: [1, 2], text: '1-based normalized' },
    ];

    const result = resolveGroupedTimestamps(original, aiGroups);
    assert(result.length === 1, 'Nhận diện và chuẩn hóa 1-based indexing [1, 2] -> [0, 1]');
    assert(result[0].startMs === 500 && result[0].endMs === 2800, 'Timestamp đúng từ 500 đến 2800ms');
  }

  // ==========================================================================
  // Section 5: Full Function API & Backward Compatibility Check
  // ==========================================================================
  console.log('\n--- Section 5: Full Function API & Backward Compatibility ---');

  {
    const resEmpty = await cleanAndDeduplicateSubtitles([]);
    assert(Array.isArray(resEmpty) && resEmpty.length === 0, 'cleanAndDeduplicateSubtitles([]) trả về [] ngay lập tức');

    const resSingle = await cleanAndDeduplicateSubtitles([{ startMs: 100, endMs: 500, text: 'Alo' }]);
    assert(resSingle.length === 1, 'cleanAndDeduplicateSubtitles([item]) trả về [item] an toàn không gọi API');
    assert(
      typeof resSingle[0].startMs === 'number' &&
      typeof resSingle[0].endMs === 'number' &&
      typeof resSingle[0].text === 'string',
      'Định dạng { startMs, endMs, text } tương thích 100% với SubtitleEditor.tsx'
    );
  }

  console.log(`\n🎉 TẤT CẢ KIỂM THỬ ĐÃ VƯỢT QUA HOÀN TOÀN: ${passedCount}/${totalCount} tests passed!`);
}

runTests().catch((err) => {
  console.error('Fatal error during tests:', err);
  process.exit(1);
});
