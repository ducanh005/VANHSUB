import assert from 'assert';
import {
  fuseOcrAndWhisper,
  stripVietnameseDiacritics,
  normalizeOpticalConfusions,
  evaluateWordMatch,
  alignTokens,
  levenshteinDistance,
  stringSimilarity,
} from '../main/asr/hybridFusionEngine';
import {
  resolveGroupedTimestamps,
  MAX_SUBTITLE_GAP_MS,
  CleanSubtitlesItem,
  AiGroupedSubtitle,
} from '../main/ai/geminiClient';
import type { SrtLine } from '../main/lib/srt';

console.log('================================================================');
console.log('EMPIRICAL CHALLENGER 2: ADVERSARIAL STRESS TEST SUITE (R2 & R3)');
console.log('================================================================\n');

interface TestRecord {
  category: 'R2' | 'R3';
  id: string;
  name: string;
  status: 'PASS' | 'FAIL_VULNERABILITY';
  detail?: string;
}

const records: TestRecord[] = [];

function runVerify(
  category: 'R2' | 'R3',
  id: string,
  name: string,
  fn: () => void
) {
  try {
    fn();
    console.log(`  [PASS] ${id}: ${name}`);
    records.push({ category, id, name, status: 'PASS' });
  } catch (err: any) {
    console.error(`  [FAIL / VULNERABILITY FOUND] ${id}: ${name}`);
    console.error(`         Detail: ${err?.message || err}`);
    records.push({
      category,
      id,
      name,
      status: 'FAIL_VULNERABILITY',
      detail: err?.message || String(err),
    });
  }
}

// ============================================================================
// SUITE 1: REQUIREMENT R2 - HYBRID WHISPER ASR + OCR SUBTITLE EXTRACTION
// ============================================================================
console.log('\n>>> SECTION 1: REQUIREMENT R2 - ADVERSARIAL STRESS TESTING <<<\n');

// 1.1 OCR text with no speech (banners)
runVerify('R2', 'R2-1.1.1', 'OCR banner with symbols, uppercase credits, and numbers preserved intact', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'b1', startMs: 500, endMs: 2500, text: 'ĐẠO DIỄN: TRẦN VĂN A - SĐT: 0912345678' },
    { id: 'b2', startMs: 3000, endMs: 5000, text: '--- BẢN QUYỀN THUỘC VỀ KÊNH @VANHSUB 2026 ---' },
    { id: 'b3', startMs: 5500, endMs: 7000, text: 'TẬP 10: HỒI KẾT (100% FULL HD)' },
  ];
  const whisperSegments: SrtLine[] = [
    { id: 'w1', startMs: 8000, endMs: 10000, text: 'hôm nay chúng ta cùng bắt đầu' },
  ];

  const res = fuseOcrAndWhisper(ocrSegments, whisperSegments);
  assert.strictEqual(res.segments.length, 3);
  assert.strictEqual(res.stats.bannersPreserved, 3, 'Tất cả 3 banner phải được bảo toàn nguyên vẹn');
  assert.strictEqual(res.segments[0].text, 'ĐẠO DIỄN: TRẦN VĂN A - SĐT: 0912345678');
  assert.strictEqual(res.segments[1].text, '--- BẢN QUYỀN THUỘC VỀ KÊNH @VANHSUB 2026 ---');
  assert.strictEqual(res.segments[2].text, 'TẬP 10: HỒI KẾT (100% FULL HD)');
  assert.strictEqual(res.segments[0].startMs, 500);
  assert.strictEqual(res.segments[0].endMs, 2500);
});

runVerify('R2', 'R2-1.1.2', 'OCR banner sharing a single common word with speech does not falsely corrupt', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'b1', startMs: 1000, endMs: 3000, text: 'TẬP 1: BÌNH MINH TRÊN ĐẢO' },
  ];
  const whisperSegments: SrtLine[] = [
    { id: 'w1', startMs: 1000, endMs: 3000, text: 'Một người bạn đã đến thăm tôi chiều nay' },
  ];

  const res = fuseOcrAndWhisper(ocrSegments, whisperSegments);
  assert.strictEqual(res.segments.length, 1);
  assert.strictEqual(res.stats.bannersPreserved, 1, 'Banner phải được giữ nguyên, không bị biến dạng');
  assert.strictEqual(res.segments[0].text, 'TẬP 1: BÌNH MINH TRÊN ĐẢO');
});

// 1.2 Whisper speech with no OCR text
runVerify('R2', 'R2-1.2.1', 'Empty OCR with non-empty Whisper returns 0 segments (strictly OCR anchored)', () => {
  const whisperSegments: SrtLine[] = [
    { id: 'w1', startMs: 1000, endMs: 3000, text: 'giọng nói không có phụ đề trên khung hình' },
    { id: 'w2', startMs: 4000, endMs: 6000, text: 'thuyết minh phim tài liệu' },
  ];

  const res = fuseOcrAndWhisper([], whisperSegments);
  assert.strictEqual(res.segments.length, 0, 'Khi không có OCR khung hình, số phân đoạn đầu ra phải là 0');
  assert.strictEqual(res.stats.totalOcrSegments, 0);
  assert.strictEqual(res.stats.totalWhisperSegments, 2);
});

runVerify('R2', 'R2-1.2.2', 'OCR segments exist but Whisper has extra speech before/after/between', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'ocr-1', startMs: 5000, endMs: 7000, text: 'Chao buoi sang' },
  ];
  const whisperSegments: SrtLine[] = [
    { id: 'w0', startMs: 1000, endMs: 3000, text: 'Đoạn nói trước không có chữ' },
    { id: 'w1', startMs: 4800, endMs: 7200, text: 'Chào buổi sáng' },
    { id: 'w2', startMs: 9000, endMs: 12000, text: 'Đoạn nói sau không có chữ' },
  ];

  const res = fuseOcrAndWhisper(ocrSegments, whisperSegments);
  assert.strictEqual(res.segments.length, 1, 'Chỉ sinh đúng số lượng phân đoạn OCR khung hình');
  assert.strictEqual(res.segments[0].startMs, 5000);
  assert.strictEqual(res.segments[0].endMs, 7000);
  assert.strictEqual(res.segments[0].text, 'Chào buổi sáng');
  assert.strictEqual(res.stats.matchedSegments, 1);
});

// 1.3 Large time offsets
runVerify('R2', 'R2-1.3.1', 'Large time offset (> toleranceMs) treats OCR as unassisted banner', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'ocr-1', startMs: 10000, endMs: 12000, text: 'Cau noi bi lech gio' },
  ];
  const whisperSegments: SrtLine[] = [
    { id: 'w-far', startMs: 70000, endMs: 72000, text: 'Câu nói bị lệch giờ' },
  ];

  const res = fuseOcrAndWhisper(ocrSegments, whisperSegments, { toleranceMs: 800 });
  assert.strictEqual(res.segments.length, 1);
  assert.strictEqual(res.stats.bannersPreserved, 1, 'Lệch 60s vượt toleranceMs -> giữ nguyên OCR như banner');
  assert.strictEqual(res.segments[0].text, 'Cau noi bi lech gio');
});

runVerify('R2', 'R2-1.3.2', 'Tolerance window exact boundaries (toleranceMs = 800ms: 4199ms vs 4200ms)', () => {
  const ocr: SrtLine[] = [{ id: '1', startMs: 5000, endMs: 7000, text: 'thu nghiem moc thoi gian' }];

  // Case A: Whisper ends at 4199ms (1ms outside window [4200, 7800])
  const whOutside: SrtLine[] = [{ id: 'w', startMs: 2000, endMs: 4199, text: 'thử nghiệm mốc thời gian' }];
  const resOutside = fuseOcrAndWhisper(ocr, whOutside, { toleranceMs: 800 });
  assert.strictEqual(resOutside.stats.bannersPreserved, 1, 'Ngoài cửa sổ 1ms không được ghép');

  // Case B: Whisper ends at 4200ms (exactly touches windowStart)
  const whTouch: SrtLine[] = [{ id: 'w', startMs: 2000, endMs: 4200, text: 'thử nghiệm mốc thời gian' }];
  const resTouch = fuseOcrAndWhisper(ocr, whTouch, { toleranceMs: 800 });
  assert.strictEqual(resTouch.stats.matchedSegments, 1, 'Chạm đúng biên 4200ms được ghép');
  assert.strictEqual(resTouch.segments[0].text, 'thử nghiệm mốc thời gian');
});

// 1.4 Completely mismatched words (English vs Vietnamese, gibberish, symbols)
runVerify('R2', 'R2-1.4.1', 'Completely mismatched languages (English OCR vs Vietnamese Whisper)', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'ocr-en', startMs: 2000, endMs: 4000, text: 'SUBSCRIBE TO OUR CHANNEL NOW' },
  ];
  const whisperSegments: SrtLine[] = [
    { id: 'wh-vi', startMs: 2000, endMs: 4000, text: 'hôm nay thời tiết rất đẹp trời' },
  ];

  const res = fuseOcrAndWhisper(ocrSegments, whisperSegments);
  assert.strictEqual(res.segments[0].text, 'SUBSCRIBE TO OUR CHANNEL NOW');
  assert.strictEqual(res.stats.bannersPreserved, 1);
  assert.strictEqual(res.stats.matchedSegments, 0);
});

runVerify('R2', 'R2-1.4.2', 'Random gibberish OCR vs natural Whisper speech', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'ocr-gibberish', startMs: 1000, endMs: 3000, text: 'xzqwkp jvbnmf rytld' },
  ];
  const whisperSegments: SrtLine[] = [
    { id: 'wh-vi', startMs: 1000, endMs: 3000, text: 'chúng ta cùng đi chơi' },
  ];

  const res = fuseOcrAndWhisper(ocrSegments, whisperSegments);
  assert.strictEqual(res.segments[0].text, 'xzqwkp jvbnmf rytld');
  assert.strictEqual(res.stats.bannersPreserved, 1);
});

runVerify('R2', 'R2-1.4.3', 'Special symbols and punctuation OCR', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'ocr-sym', startMs: 1000, endMs: 2000, text: '=== >>> *** <<<' },
  ];
  const whisperSegments: SrtLine[] = [
    { id: 'wh-speech', startMs: 1000, endMs: 2000, text: 'tiếp theo chương trình' },
  ];

  const res = fuseOcrAndWhisper(ocrSegments, whisperSegments);
  assert.strictEqual(res.segments[0].text, '=== >>> *** <<<');
  assert.strictEqual(res.stats.bannersPreserved, 1);
});

// 1.5 Vietnamese diacritic recovery under heavy typos
runVerify('R2', 'R2-1.5.1', 'Vietnamese diacritic recovery for standard sentences', () => {
  const ocrSegments: SrtLine[] = [
    {
      id: 'ocr-tones',
      startMs: 1000,
      endMs: 5000,
      text: 'truong dai hoc bach khoa ha noi dao tao chuyen gia chat luong cao',
    },
  ];
  const whisperSegments: SrtLine[] = [
    {
      id: 'wh-tones',
      startMs: 1000,
      endMs: 5000,
      text: 'Trường Đại học Bách khoa Hà Nội đào tạo chuyên gia chất lượng cao',
    },
  ];

  const res = fuseOcrAndWhisper(ocrSegments, whisperSegments);
  assert.strictEqual(
    res.segments[0].text,
    'Trường Đại học Bách khoa Hà Nội đào tạo chuyên gia chất lượng cao'
  );
  assert.ok(res.stats.diacriticsRestored >= 8, `Đã phục hồi ${res.stats.diacriticsRestored} dấu tiếng Việt`);
});

// Vulnerability 1: Optical confusion regex /gi replaces lowercase 'i' with 'l'
runVerify('R2', 'R2-1.5.2-VULN', 'Vulnerability Test: normalizeOpticalConfusions replaces lowercase i with l due to /[1l|I]/gi', () => {
  const normalized = normalizeOpticalConfusions('nguoi');
  // Lowercase 'i' in 'nguoi' should NOT become 'l' ('nguol')
  assert.strictEqual(normalized, 'nguoi', `Expected 'nguoi' but got '${normalized}' due to /[1l|I]/gi matching lowercase 'i'`);
});

// Vulnerability 2: Vowel variant "ki" vs "kỹ" causes word stutter/duplication
runVerify('R2', 'R2-1.5.3-VULN', 'Vulnerability Test: Vowel variant "ki" vs "kỹ" causes stutter duplication in fuseOcrAndWhisper', () => {
  const ocr = [{ id: '1', startMs: 1000, endMs: 3000, text: 'dao tao ki su' }];
  const wh = [{ id: 'w', startMs: 1000, endMs: 3000, text: 'đào tạo kỹ sư' }];
  const res = fuseOcrAndWhisper(ocr, wh);
  // Stutter bug causes "kỹ ki sư"
  assert.strictEqual(res.segments[0].text, 'đào tạo kỹ sư', `Expected 'đào tạo kỹ sư' but got '${res.segments[0].text}'`);
});

// 1.6 Local token sequence alignment stress test
runVerify('R2', 'R2-1.6.1', 'Long Whisper sentence (30 words) mapped across 3 short consecutive OCR lines', () => {
  const ocrSegments: SrtLine[] = [
    { id: 'ocr-1', startMs: 1000, endMs: 3000, text: 'Tri tue nhan tao dang phat trien' },
    { id: 'ocr-2', startMs: 3200, endMs: 5500, text: 'voi toc do chong mat va thay doi' },
    { id: 'ocr-3', startMs: 5800, endMs: 8000, text: 'toan bo cuc dien cong nghe the gioi' },
  ];

  const whisperSegments: SrtLine[] = [
    {
      id: 'wh-giant',
      startMs: 800,
      endMs: 8200,
      text: 'Trí tuệ nhân tạo đang phát triển với tốc độ chóng mặt và thay đổi toàn bộ cục diện công nghệ thế giới',
    },
  ];

  const res = fuseOcrAndWhisper(ocrSegments, whisperSegments);
  assert.strictEqual(res.segments.length, 3);
  assert.strictEqual(res.segments[0].startMs, 1000);
  assert.strictEqual(res.segments[0].endMs, 3000);
  assert.strictEqual(res.segments[0].text, 'Trí tuệ nhân tạo đang phát triển');

  assert.strictEqual(res.segments[1].startMs, 3200);
  assert.strictEqual(res.segments[1].endMs, 5500);
  assert.strictEqual(res.segments[1].text, 'với tốc độ chóng mặt và thay đổi');

  assert.strictEqual(res.segments[2].startMs, 5800);
  assert.strictEqual(res.segments[2].endMs, 8000);
  assert.strictEqual(res.segments[2].text, 'toàn bộ cục diện công nghệ thế giới');
});

runVerify('R2', 'R2-1.6.2', 'High-density repetitive tokens alignment (no infinite loops or crash)', () => {
  const ocrTokens = ['toi', 'rat', 'rat', 'vui'];
  const whTokens = ['tôi', 'rất', 'rất', 'rất', 'vui', 'mừng'];

  const { steps, averageScore } = alignTokens(ocrTokens, whTokens);
  assert.ok(steps.length > 0);
  assert.ok(averageScore > 0.7);
});

// ============================================================================
// SUITE 2: REQUIREMENT R3 - EXACT TIMESTAMP PRESERVATION IN DEDUPLICATION
// ============================================================================
console.log('\n>>> SECTION 2: REQUIREMENT R3 - ADVERSARIAL STRESS TESTING <<<\n');

// 2.1 Max Gap Guard boundary condition: 1499ms vs 1500ms vs 1501ms
runVerify('R3', 'R3-2.1.1', 'Max Gap Guard boundary test (gap = 1499ms -> DO NOT SPLIT)', () => {
  const original: CleanSubtitlesItem[] = [
    { startMs: 1000, endMs: 2500, text: 'Phần 1' },
    { startMs: 3999, endMs: 5000, text: 'Phần 2' }, // gap = 3999 - 2500 = 1499ms
  ];
  const aiGroups: AiGroupedSubtitle[] = [{ sourceIndices: [0, 1], text: 'Phần 1 Phần 2' }];

  const res = resolveGroupedTimestamps(original, aiGroups, 1500);
  assert.strictEqual(res.length, 1, 'Khoảng lặng 1499ms (<= 1500ms) không được tách');
  assert.strictEqual(res[0].startMs, 1000);
  assert.strictEqual(res[0].endMs, 5000);
});

runVerify('R3', 'R3-2.1.2', 'Max Gap Guard boundary test (gap = 1500ms exact -> DO NOT SPLIT)', () => {
  const original: CleanSubtitlesItem[] = [
    { startMs: 1000, endMs: 2500, text: 'Phần 1' },
    { startMs: 4000, endMs: 5000, text: 'Phần 2' }, // gap = 4000 - 2500 = 1500ms
  ];
  const aiGroups: AiGroupedSubtitle[] = [{ sourceIndices: [0, 1], text: 'Phần 1 Phần 2' }];

  const res = resolveGroupedTimestamps(original, aiGroups, 1500);
  assert.strictEqual(res.length, 1, 'Khoảng lặng đúng 1500ms (<= 1500ms) không được tách');
  assert.strictEqual(res[0].startMs, 1000);
  assert.strictEqual(res[0].endMs, 5000);
});

runVerify('R3', 'R3-2.1.3', 'Max Gap Guard boundary test (gap = 1501ms -> MUST SPLIT)', () => {
  const original: CleanSubtitlesItem[] = [
    { startMs: 1000, endMs: 2500, text: 'Phần 1' },
    { startMs: 4001, endMs: 5000, text: 'Phần 2' }, // gap = 4001 - 2500 = 1501ms
  ];
  const aiGroups: AiGroupedSubtitle[] = [{ sourceIndices: [0, 1], text: 'Phần 1\nPhần 2' }];

  const res = resolveGroupedTimestamps(original, aiGroups, 1500);
  assert.strictEqual(res.length, 2, 'Khoảng lặng 1501ms (> 1500ms) PHẢI bị tách thành 2 phân đoạn');
  assert.strictEqual(res[0].startMs, 1000);
  assert.strictEqual(res[0].endMs, 2500);
  assert.strictEqual(res[1].startMs, 4001);
  assert.strictEqual(res[1].endMs, 5000);
});

// 2.2 Missing Index Recovery: AI omits 50% and 100% of indices
runVerify('R3', 'R3-2.2.1', 'Missing Index Recovery when AI omits 50% of lines (alternating lines)', () => {
  const original: CleanSubtitlesItem[] = [
    { startMs: 0, endMs: 1000, text: 'Line 0' },
    { startMs: 1200, endMs: 2000, text: 'Line 1' },
    { startMs: 2200, endMs: 3000, text: 'Line 2' },
    { startMs: 3200, endMs: 4000, text: 'Line 3' },
    { startMs: 4200, endMs: 5000, text: 'Line 4' },
    { startMs: 5200, endMs: 6000, text: 'Line 5' },
  ];

  const aiGroups: AiGroupedSubtitle[] = [
    { sourceIndices: [1, 2], text: 'Merged 1 and 2' },
    { sourceIndices: [5], text: 'Line 5 edited' },
  ];

  const res = resolveGroupedTimestamps(original, aiGroups);
  assert.strictEqual(res.length, 5, 'Output must contain all items: 0 (rec), [1,2] (merged), 3 (rec), 4 (rec), 5 (ai)');

  assert.strictEqual(res[0].startMs, 0);
  assert.strictEqual(res[0].text, 'Line 0');

  assert.strictEqual(res[1].startMs, 1200);
  assert.strictEqual(res[1].endMs, 3000);
  assert.strictEqual(res[1].text, 'Merged 1 and 2');

  assert.strictEqual(res[2].startMs, 3200);
  assert.strictEqual(res[2].text, 'Line 3');

  assert.strictEqual(res[3].startMs, 4200);
  assert.strictEqual(res[3].text, 'Line 4');

  assert.strictEqual(res[4].startMs, 5200);
  assert.strictEqual(res[4].text, 'Line 5 edited');
});

runVerify('R3', 'R3-2.2.2', 'Missing Index Recovery when AI omits 100% of indices (empty array or malformed)', () => {
  const original: CleanSubtitlesItem[] = [
    { startMs: 100, endMs: 500, text: 'A' },
    { startMs: 600, endMs: 900, text: 'B' },
    { startMs: 1000, endMs: 1500, text: 'C' },
  ];

  const resEmpty = resolveGroupedTimestamps(original, []);
  assert.strictEqual(resEmpty.length, 3, 'Khôi phục 100% khi AI trả về mảng rỗng');
  assert.strictEqual(resEmpty[0].text, 'A');
  assert.strictEqual(resEmpty[1].text, 'B');
  assert.strictEqual(resEmpty[2].text, 'C');

  const resMalformed = resolveGroupedTimestamps(original, [
    { sourceIndices: [], text: '' },
    { sourceIndices: [999], text: 'invalid' },
  ] as any);
  assert.strictEqual(resMalformed.length, 3, 'Khôi phục 100% khi AI trả về indices rỗng hoặc out-of-bounds');
});

// 2.3 Out-of-order, Duplicate, and Out-of-bounds Indices
runVerify('R3', 'R3-2.3.1', 'Out-of-order indices with all elements present ([3, 2, 1, 0] or [1, 0])', () => {
  const original: CleanSubtitlesItem[] = [
    { startMs: 1000, endMs: 2000, text: 'Item 0' },
    { startMs: 2200, endMs: 3000, text: 'Item 1' },
    { startMs: 3200, endMs: 4000, text: 'Item 2' },
    { startMs: 4200, endMs: 5000, text: 'Item 3' },
  ];

  const aiGroups: AiGroupedSubtitle[] = [
    { sourceIndices: [3, 2, 1, 0], text: 'Reversed all four' },
  ];

  const res = resolveGroupedTimestamps(original, aiGroups);
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].startMs, original[0].startMs);
  assert.strictEqual(res[0].endMs, original[3].endMs);
});

// Vulnerability 3: Non-consecutive out-of-order indices [3, 0] causes overlap clamping to truncate group endMs
runVerify('R3', 'R3-2.3.2-VULN', 'Vulnerability Test: Non-consecutive index pair [3, 0] causes collision with recovered items and truncates endMs', () => {
  const original: CleanSubtitlesItem[] = [
    { startMs: 1000, endMs: 1200, text: 'A' },
    { startMs: 1250, endMs: 1400, text: 'B' },
    { startMs: 1450, endMs: 1600, text: 'C' },
    { startMs: 1650, endMs: 2000, text: 'D' },
  ];

  // AI specifies [3, 0] (gap is 1650 - 1200 = 450ms <= 1500ms)
  const aiGroups: AiGroupedSubtitle[] = [
    { sourceIndices: [3, 0], text: 'A and D' },
  ];

  const res = resolveGroupedTimestamps(original, aiGroups);
  const group = res.find((r) => r.text === 'A and D');
  assert.ok(group, 'Group A and D must exist');
  // Timestamp must strictly equal original[3].endMs (2000), but overlap clamping truncates it to 1250!
  assert.strictEqual(
    group.endMs,
    original[3].endMs,
    `Expected group.endMs to strictly equal original[3].endMs (${original[3].endMs}) but got ${group.endMs} (truncated by overlap clamping)`
  );
});

runVerify('R3', 'R3-2.3.3', 'Duplicate indices inside single group ([1, 1, 1, 2, 2])', () => {
  const original: CleanSubtitlesItem[] = [
    { startMs: 1000, endMs: 2000, text: 'Zero' },
    { startMs: 2200, endMs: 3000, text: 'One' },
    { startMs: 3200, endMs: 4000, text: 'Two' },
  ];

  const aiGroups: AiGroupedSubtitle[] = [
    { sourceIndices: [1, 1, 1, 2, 2], text: 'One Two deduped' },
  ];

  const res = resolveGroupedTimestamps(original, aiGroups);
  assert.strictEqual(res.length, 2, 'Line 0 recovered + merged [1, 2]');
  assert.strictEqual(res[1].startMs, 2200);
  assert.strictEqual(res[1].endMs, 4000);
});

runVerify('R3', 'R3-2.3.4', 'Out-of-bounds indices ([-5, -1, 0, 1, 100, 999999])', () => {
  const original: CleanSubtitlesItem[] = [
    { startMs: 500, endMs: 1500, text: 'First' },
    { startMs: 1700, endMs: 2500, text: 'Second' },
  ];

  const aiGroups: AiGroupedSubtitle[] = [
    { sourceIndices: [-5, -1, 0, 1, 100, 999999], text: 'Sanitized' },
  ];

  const res = resolveGroupedTimestamps(original, aiGroups);
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].startMs, 500);
  assert.strictEqual(res[0].endMs, 2500);
  assert.strictEqual(res[0].text, 'Sanitized');
});

runVerify('R3', 'R3-2.3.5', 'String numbers and non-numeric indices', () => {
  const original: CleanSubtitlesItem[] = [
    { startMs: 1000, endMs: 2000, text: 'A' },
    { startMs: 2200, endMs: 3000, text: 'B' },
  ];

  const aiGroups: AiGroupedSubtitle[] = [
    { sourceIndices: ['0', '1', 'invalid', NaN as any, null as any], text: 'String parsed' },
  ];

  const res = resolveGroupedTimestamps(original, aiGroups);
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].startMs, 1000);
  assert.strictEqual(res[0].endMs, 3000);
});

// 2.4 Strict Timestamp Equality Verification (No Hallucination)
runVerify('R3', 'R3-2.4.1', 'Subtitle timestamps strictly equal original[min].startMs and original[max].endMs', () => {
  const original: CleanSubtitlesItem[] = [
    { startMs: 1234, endMs: 2345, text: 'Segment A' },
    { startMs: 2400, endMs: 3500, text: 'Segment B' },
    { startMs: 3600, endMs: 4700, text: 'Segment C' },
    { startMs: 6500, endMs: 7800, text: 'Segment D' },
    { startMs: 7900, endMs: 9100, text: 'Segment E' },
  ];

  const aiGroups: AiGroupedSubtitle[] = [
    { sourceIndices: [0, 1, 2], text: 'Merged ABC' },
    { sourceIndices: [3, 4], text: 'Merged DE' },
  ];

  const res = resolveGroupedTimestamps(original, aiGroups);
  assert.strictEqual(res.length, 2);

  assert.strictEqual(res[0].startMs, original[0].startMs, 'startMs must exactly match original[0].startMs');
  assert.strictEqual(res[0].endMs, original[2].endMs, 'endMs must exactly match original[2].endMs');
  assert.strictEqual(res[0].startMs, 1234);
  assert.strictEqual(res[0].endMs, 4700);

  assert.strictEqual(res[1].startMs, original[3].startMs, 'startMs must exactly match original[3].startMs');
  assert.strictEqual(res[1].endMs, original[4].endMs, 'endMs must exactly match original[4].endMs');
  assert.strictEqual(res[1].startMs, 6500);
  assert.strictEqual(res[1].endMs, 9100);
});

// Print summary
console.log('\n================================================================');
const passCount = records.filter((r) => r.status === 'PASS').length;
const vulnCount = records.filter((r) => r.status === 'FAIL_VULNERABILITY').length;
console.log(`TOTAL VERIFIED:     ${records.length}`);
console.log(`PASSED:             ${passCount}`);
console.log(`VULNERABILITIES:    ${vulnCount}`);
console.log('================================================================');

if (vulnCount > 0) {
  console.log('\nCONFIRMED VULNERABILITIES:');
  records.filter((r) => r.status === 'FAIL_VULNERABILITY').forEach((r) => {
    console.log(`- [${r.id}] ${r.name}`);
    console.log(`  Reason: ${r.detail}`);
  });
}
