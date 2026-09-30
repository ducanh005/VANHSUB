/**
 * Dedicated Adversarial Test Harness: Whisper-OCR Cross-Deduplication Engine (Milestone 3)
 * Author: challenger_m3_2 (Teamwork Adversarial Stress Challenger)
 *
 * Empirical verification of Requirement R3:
 * 1. Heavy cross-modal overlap between Whisper and OCR.
 * 2. Speech-only Whisper segments (speech with 0 OCR frames) — 100% preserved.
 * 3. Graphic banner OCR segments (text with 0 Whisper audio) — 100% preserved without corrupting speech.
 * 4. Authoritative benchmark sentence ("chụp ảnh được...") under noisy optical frame conditions.
 * 5. Pathological boundaries, idempotency, and high-volume performance stress.
 */

import assert from 'assert';
import type { SrtLine } from '../main/lib/srt';
import {
  deduplicateExact,
  deduplicateProgressiveKaraoke,
  deduplicateWhisperOcrCross,
  deduplicateSubtitlesPipeline,
  levenshteinDistance,
  stripVietnameseDiacritics,
} from '../main/lib/subtitleDeduplication';
import { fuseOcrAndWhisper } from '../main/asr/hybridFusionEngine';
import { consolidateSubtitleClauses } from '../main/lib/nlpSegmenter';
import { isOcrGarbageLine, sanitizeSubtitles } from '../main/lib/subtitleSanitizer';

console.log('================================================================');
console.log('🔥 CHALLENGER M3_2: ADVERSARIAL STRESS TEST HARNESS (R3 DEDUP)');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureDetails: string[] = [];

function check(desc: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: ${desc}`);
    passedTests++;
  } catch (err: any) {
    failedTests++;
    const msg = `  ❌ FAIL: ${desc} -> ${err.message || err}`;
    console.error(msg);
    failureDetails.push(msg);
  }
}

// =============================================================================
// SUITE 1: HEAVY CROSS-MODAL OVERLAP BETWEEN WHISPER AND OCR
// =============================================================================
console.log('\n--- SUITE 1: HEAVY CROSS-MODAL OVERLAP BETWEEN WHISPER AND OCR ---');

check('1.1. Dense multi-segment overlap: 15 Whisper segments vs 25 OCR segments', () => {
  const whisper: SrtLine[] = Array.from({ length: 15 }, (_, i) => ({
    id: `w-${i}`,
    startMs: i * 2000,
    endMs: i * 2000 + 1700,
    text: `Lời thoại số ${i + 1} của nhân vật`,
  }));

  const ocr: SrtLine[] = [];
  for (let i = 0; i < 15; i++) {
    if (i % 3 === 0) {
      ocr.push({
        id: `ocr-${i}-a`,
        startMs: i * 2000 + 50,
        endMs: i * 2000 + 800,
        text: `loi thoai so ${i + 1}`,
      });
      ocr.push({
        id: `ocr-${i}-b`,
        startMs: i * 2000 + 850,
        endMs: i * 2000 + 1750,
        text: `loi thoai so ${i + 1} cua nhan vat`,
      });
    } else if (i % 3 === 1) {
      ocr.push({
        id: `ocr-${i}`,
        startMs: i * 2000 + 100,
        endMs: i * 2000 + 1650,
        text: `Lời thoại số ${i + 1} của nhân vật`,
      });
    }
  }

  for (let b = 0; b < 5; b++) {
    ocr.push({
      id: `banner-${b}`,
      startMs: b * 6000 + 100,
      endMs: b * 6000 + 1900,
      text: `LOGO_BANNER_${b + 1}: KÊNH THỜI SỰ`,
    });
  }

  const result = deduplicateWhisperOcrCross(ocr, whisper);

  for (let k = 0; k < result.length - 1; k++) {
    assert.ok(
      result[k].startMs <= result[k + 1].startMs,
      `Timeline not sorted: idx ${k} (${result[k].startMs}) > idx ${k + 1} (${result[k + 1].startMs})`
    );
  }

  for (const idx of [2, 5, 8, 11, 14]) {
    const expectedText = `Lời thoại số ${idx + 1} của nhân vật`;
    const found = result.some((r) => r.text === expectedText);
    assert.ok(found, `Speech-only segment '${expectedText}' was lost in heavy overlap!`);
  }

  for (let b = 0; b < 5; b++) {
    const bannerText = `LOGO_BANNER_${b + 1}: KÊNH THỜI SỰ`;
    const found = result.some((r) => r.text === bannerText);
    assert.ok(found, `Graphic banner '${bannerText}' was lost in heavy overlap!`);
  }
});

check('1.2. 1 long Whisper audio utterance overlapping 3 sequential OCR clause fragments (timeline preservation)', () => {
  const whisper: SrtLine[] = [
    {
      id: 'w-full',
      startMs: 1000,
      endMs: 8000,
      text: 'Chúng tôi xin chào mừng tất cả quý vị đại biểu và các bạn khán giả đã đến tham dự chương trình hôm nay.',
    },
  ];

  const ocr: SrtLine[] = [
    { id: 'ocr-1', startMs: 1000, endMs: 3000, text: 'chúng tôi xin chào mừng' },
    { id: 'ocr-2', startMs: 3200, endMs: 5500, text: 'tất cả quý vị đại biểu' },
    { id: 'ocr-3', startMs: 5700, endMs: 8000, text: 'và các bạn khán giả đã đến tham dự chương trình hôm nay.' },
  ];

  const result = deduplicateWhisperOcrCross(ocr, whisper);
  assert.ok(result.length >= 1, 'Should produce valid subtitles');

  for (let i = 0; i < result.length - 1; i++) {
    assert.ok(result[i].startMs <= result[i + 1].startMs);
  }
});

check('1.3. Multi-card OCR duplication check: consecutive distinct OCR cards should not receive identical full Whisper sentence text', () => {
  const whisper: SrtLine[] = [
    {
      id: 'w-full',
      startMs: 1000,
      endMs: 7500,
      text: 'chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được',
    },
  ];

  const ocr: SrtLine[] = [
    { id: 'card1', startMs: 1000, endMs: 3000, text: 'chup anh duoc, livestream duoc' },
    { id: 'card2', startMs: 3200, endMs: 7500, text: 'tai hien lai cac canh kinh dien cung duoc' },
  ];

  const result = deduplicateWhisperOcrCross(ocr, whisper);
  assert.strictEqual(result.length, 2);
  // Adversarial check: card 1 and card 2 must not be identical copies of the full Whisper sentence
  assert.notStrictEqual(
    result[0].text,
    result[1].text,
    `Card 1 and Card 2 were both overwritten with the identical full Whisper sentence: "${result[0].text}"`
  );
});

check('1.4. Asynchronous boundary shifts at tolerance edge (-799ms and +799ms vs +/-805ms)', () => {
  const ocrBase: SrtLine = { id: 'o1', startMs: 2000, endMs: 4000, text: 'Thử nghiệm dung sai' };

  const whLeftMatch: SrtLine[] = [
    { id: 'w-l-ok', startMs: 1201, endMs: 3200, text: 'thử nghiệm dung sai' },
  ];
  const resLeftMatch = deduplicateWhisperOcrCross([ocrBase], whLeftMatch);
  assert.strictEqual(resLeftMatch.length, 1, 'Should match within 800ms left tolerance');

  const whLeftNoMatch: SrtLine[] = [
    { id: 'w-l-fail', startMs: 300, endMs: 1190, text: 'thử nghiệm dung sai' },
  ];
  const resLeftNoMatch = deduplicateWhisperOcrCross([ocrBase], whLeftNoMatch);
  assert.strictEqual(resLeftNoMatch.length, 2, 'Should NOT match when beyond 800ms left tolerance');

  const whRightMatch: SrtLine[] = [
    { id: 'w-r-ok', startMs: 2800, endMs: 4799, text: 'thử nghiệm dung sai' },
  ];
  const resRightMatch = deduplicateWhisperOcrCross([ocrBase], whRightMatch);
  assert.strictEqual(resRightMatch.length, 1, 'Should match within 800ms right tolerance');

  const whRightNoMatch: SrtLine[] = [
    { id: 'w-r-fail', startMs: 4805, endMs: 6000, text: 'thử nghiệm dung sai' },
  ];
  const resRightNoMatch = deduplicateWhisperOcrCross([ocrBase], whRightNoMatch);
  assert.strictEqual(resRightNoMatch.length, 2, 'Should NOT match when beyond 800ms right tolerance');
});

check('1.5. Shuffled and inverted chronological orders in input arrays are normalized', () => {
  const shuffledOcr: SrtLine[] = [
    { id: 'o3', startMs: 5000, endMs: 6000, text: 'Câu ba' },
    { id: 'o1', startMs: 1000, endMs: 2000, text: 'Câu một' },
    { id: 'o2', startMs: 3000, endMs: 4000, text: 'Câu hai' },
  ];

  const shuffledWhisper: SrtLine[] = [
    { id: 'w2', startMs: 3000, endMs: 4000, text: 'Câu hai' },
    { id: 'w3', startMs: 5000, endMs: 6000, text: 'Câu ba' },
    { id: 'w1', startMs: 1000, endMs: 2000, text: 'Câu một' },
  ];

  const result = deduplicateWhisperOcrCross(shuffledOcr, shuffledWhisper);
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0].text, 'Câu một');
  assert.strictEqual(result[1].text, 'Câu hai');
  assert.strictEqual(result[2].text, 'Câu ba');
});

// =============================================================================
// SUITE 2: SPEECH-ONLY WHISPER SEGMENTS (100% PRESERVATION GATE)
// =============================================================================
console.log('\n--- SUITE 2: SPEECH-ONLY WHISPER SEGMENTS (100% PRESERVATION GATE) ---');

check('2.1. Completely dark video (0 OCR frames) -> 100% of Whisper speech segments preserved', () => {
  const speechOnlyWhisper: SrtLine[] = Array.from({ length: 30 }, (_, i) => ({
    id: `speech-${i}`,
    startMs: i * 3000,
    endMs: i * 3000 + 2500,
    text: `Đoạn độc thoại trong bóng tối thứ ${i + 1} không hề có chữ trên màn hình.`,
  }));

  const emptyOcr: SrtLine[] = [];

  const crossDedup = deduplicateWhisperOcrCross(emptyOcr, speechOnlyWhisper);
  assert.strictEqual(crossDedup.length, 30, 'Cross-dedup must preserve all 30 speech-only segments');
  for (let i = 0; i < 30; i++) {
    assert.strictEqual(crossDedup[i].startMs, speechOnlyWhisper[i].startMs);
    assert.strictEqual(crossDedup[i].text, speechOnlyWhisper[i].text);
  }

  const fused = fuseOcrAndWhisper(emptyOcr, speechOnlyWhisper, {
    preserveSpeechOnlyWhisper: true,
  });
  assert.strictEqual(fused.segments.length, 30, 'fuseOcrAndWhisper must preserve all 30 speech segments');
  assert.strictEqual(fused.stats.speechOnlyPreserved, 30);
});

check('2.2. Pre-roll and post-roll speech-only segments with 0 OCR frames around central OCR', () => {
  const whisper: SrtLine[] = [
    { id: 'w-pre', startMs: 500, endMs: 2500, text: 'Lời mở đầu giới thiệu chương trình' },
    { id: 'w-mid', startMs: 5000, endMs: 7000, text: 'Chủ đề chính hôm nay' },
    { id: 'w-post', startMs: 12000, endMs: 15000, text: 'Cảm ơn và hẹn gặp lại trong số tiếp theo' },
  ];

  const ocr: SrtLine[] = [
    { id: 'o-mid', startMs: 5000, endMs: 7000, text: 'chu de chinh hom nay' },
  ];

  const result = deduplicateWhisperOcrCross(ocr, whisper);
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0].text, 'Lời mở đầu giới thiệu chương trình');
  assert.strictEqual(result[0].startMs, 500);
  assert.strictEqual(result[1].text, 'Chủ đề chính hôm nay');
  assert.strictEqual(result[1].startMs, 5000);
  assert.strictEqual(result[2].text, 'Cảm ơn và hẹn gặp lại trong số tiếp theo');
  assert.strictEqual(result[2].startMs, 12000);
});

check('2.3. Speech-only segments with short exclamations ("Ơ!", "Ủa?", "Dạ!") are NOT discarded as OCR noise', () => {
  const exclamations: SrtLine[] = [
    { id: 'w-1', startMs: 1000, endMs: 1300, text: 'Ơ!' },
    { id: 'w-2', startMs: 2000, endMs: 2400, text: 'Ủa?' },
    { id: 'w-3', startMs: 3000, endMs: 3500, text: 'Dạ!' },
  ];

  const result = deduplicateWhisperOcrCross([], exclamations);
  assert.strictEqual(result.length, 3, 'Short speech exclamations must not be deleted');
  assert.strictEqual(result[0].text, 'Ơ!');
  assert.strictEqual(result[1].text, 'Ủa?');
  assert.strictEqual(result[2].text, 'Dạ!');
});

check('2.4. Speech-only segments with special characters, numbers, and currency ("$500", "50%", "24/7")', () => {
  const whisper: SrtLine[] = [
    { id: 'w-num', startMs: 1000, endMs: 3000, text: 'Chi phí là $500 giảm 50% phục vụ 24/7' },
  ];
  const result = deduplicateWhisperOcrCross([], whisper);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].text, 'Chi phí là $500 giảm 50% phục vụ 24/7');
});

// =============================================================================
// SUITE 3: GRAPHIC BANNER OCR SEGMENTS (100% PRESERVED, NO SPEECH CORRUPTION)
// =============================================================================
console.log('\n--- SUITE 3: GRAPHIC BANNER OCR SEGMENTS (100% PRESERVED, NO CORRUPTION) ---');

check('3.1. Silent video (0 Whisper audio) -> Valid graphic banners 100% preserved', () => {
  const banners: SrtLine[] = [
    { id: 'b1', startMs: 1000, endMs: 5000, text: 'TẬP 1: BƯỚC ĐẦU KHỞI NGHIỆP' },
    { id: 'b2', startMs: 6000, endMs: 10000, text: 'ĐẠO DIỄN: NGUYỄN VĂN A' },
    { id: 'b3', startMs: 11000, endMs: 15000, text: 'NHÀ TÀI TRỢ CHÍNH: VANHSUB AI' },
  ];

  const result = deduplicateWhisperOcrCross(banners, []);
  assert.strictEqual(result.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(result[i].text, banners[i].text);
    assert.strictEqual(result[i].startMs, banners[i].startMs);
    assert.strictEqual(result[i].endMs, banners[i].endMs);
  }
});

check('3.2. Graphic banner concurrent with completely unrelated speech -> Both preserved without corruption', () => {
  const banner: SrtLine = {
    id: 'ocr-ticker',
    startMs: 2000,
    endMs: 8000,
    text: 'VN-INDEX TĂNG 15 ĐIỂM, THANH KHOẢN ĐẠT 25 NGHÌN TỶ ĐỒNG',
  };

  const speech: SrtLine = {
    id: 'wh-weather',
    startMs: 2500,
    endMs: 7500,
    text: 'Áp thấp nhiệt đới đang tiến vào vùng biển miền Trung với sức gió giật cấp 9.',
  };

  const result = deduplicateWhisperOcrCross([banner], [speech]);
  assert.strictEqual(result.length, 2, 'Both ticker and speech must be preserved!');

  const hasBanner = result.some(
    (r) => r.text === 'VN-INDEX TĂNG 15 ĐIỂM, THANH KHOẢN ĐẠT 25 NGHÌN TỶ ĐỒNG'
  );
  const hasSpeech = result.some(
    (r) => r.text === 'Áp thấp nhiệt đới đang tiến vào vùng biển miền Trung với sức gió giật cấp 9.'
  );

  assert.ok(hasBanner, 'Financial ticker banner was mistakenly dropped or overwritten!');
  assert.ok(hasSpeech, 'Weather speech was mistakenly dropped or overwritten!');
});

check('3.3. Long-running graphic banner spanning 15s across 3 consecutive short speeches', () => {
  const banner: SrtLine = {
    id: 'b-top',
    startMs: 1000,
    endMs: 16000,
    text: 'CHƯƠNG TRÌNH PHÁT SÓNG TRỰC TIẾP TỪ PHÒNG THU HÀ NỘI',
  };

  const speeches: SrtLine[] = [
    { id: 'w1', startMs: 2000, endMs: 4000, text: 'Kính chào quý vị khán giả' },
    { id: 'w2', startMs: 6000, endMs: 9000, text: 'Hôm nay chúng ta cùng thảo luận về công nghệ' },
    { id: 'w3', startMs: 11000, endMs: 14000, text: 'Đặc biệt là các giải pháp xử lý giọng nói' },
  ];

  const result = deduplicateWhisperOcrCross([banner], speeches);

  assert.strictEqual(result.length, 4, '1 banner + 3 distinct speeches must yield 4 lines');
  assert.ok(result.some((r) => r.text === banner.text));
  assert.ok(result.some((r) => r.text === speeches[0].text));
  assert.ok(result.some((r) => r.text === speeches[1].text));
  assert.ok(result.some((r) => r.text === speeches[2].text));
});

check('3.4. OCR noise banners ("c", ".", "-") filtered, but valid titles ("TẬP 1", "HẾT") preserved', () => {
  const dirtyOcr: SrtLine[] = [
    { id: 'n1', startMs: 500, endMs: 600, text: 'c' },
    { id: 'n2', startMs: 800, endMs: 900, text: '-' },
    { id: 'n3', startMs: 1000, endMs: 1100, text: '.' },
    { id: 'valid1', startMs: 2000, endMs: 4000, text: 'TẬP 1' },
    { id: 'valid2', startMs: 5000, endMs: 7000, text: 'HẾT' },
  ];

  const sanitized = sanitizeSubtitles(dirtyOcr);
  assert.strictEqual(sanitized.removedCount, 3, 'Should remove 3 noise lines');
  assert.strictEqual(sanitized.cleaned.length, 2, 'Should keep 2 valid title lines');

  const cross = deduplicateWhisperOcrCross(sanitized.cleaned, []);
  assert.strictEqual(cross.length, 2);
  assert.strictEqual(cross[0].text, 'TẬP 1');
  assert.strictEqual(cross[1].text, 'HẾT');
});

// =============================================================================
// SUITE 4: BENCHMARK SENTENCE UNDER NOISY OPTICAL CONDITIONS
// =============================================================================
console.log('\n--- SUITE 4: AUTHORITATIVE BENCHMARK SENTENCE UNDER OPTICAL NOISE ---');

const BENCHMARK_SENTENCE =
  'chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được, nhưng giá cho mỗi hoạt động tính thế nào?';

check('4.1a. Monotonic progressive OCR expansion merges into 1 complete sentence (1000ms -> 7500ms)', () => {
  const progressiveFrames: SrtLine[] = [
    { id: 'f1', startMs: 1000, endMs: 1800, text: 'chụp ảnh' },
    { id: 'f2', startMs: 1800, endMs: 2400, text: 'chụp ảnh được' },
    { id: 'f3', startMs: 2400, endMs: 3200, text: 'chụp ảnh được, livestream được' },
    {
      id: 'f4',
      startMs: 3200,
      endMs: 4400,
      text: 'chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được',
    },
    {
      id: 'f5',
      startMs: 4400,
      endMs: 7500,
      text: BENCHMARK_SENTENCE,
    },
  ];

  const deduped = deduplicateProgressiveKaraoke(progressiveFrames);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].text, BENCHMARK_SENTENCE);
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 7500);
});

check('4.1b. Equal-length diacritic/typo prefix frame ("chup anh duoc" -> "chụp ảnh được") does not strand orphan banner', () => {
  const noisyOcrFrames: SrtLine[] = [
    { id: 'f1', startMs: 1000, endMs: 1800, text: 'chup anh duoc' },
    { id: 'f2', startMs: 1800, endMs: 2400, text: 'chụp ảnh được' },
    { id: 'f3', startMs: 2400, endMs: 3200, text: 'chụp ảnh đưoc, 1ivestream đưoc' },
    {
      id: 'f4',
      startMs: 3200,
      endMs: 4400,
      text: 'chụp ảnh được, livestream được, tai hien lai cac canh kinh dien cung duoc',
    },
    {
      id: 'f5',
      startMs: 4400,
      endMs: 7500,
      text: BENCHMARK_SENTENCE,
    },
    {
      id: 'f6',
      startMs: 7500,
      endMs: 8200,
      text: BENCHMARK_SENTENCE,
    },
  ];

  const whisperGroundTruth: SrtLine[] = [
    {
      id: 'wh-bench',
      startMs: 950,
      endMs: 8000,
      text: BENCHMARK_SENTENCE,
    },
  ];

  const crossFused = deduplicateWhisperOcrCross(noisyOcrFrames, whisperGroundTruth);
  // Adversarial check: all noisy progressive frames must collapse into 1 clean sentence,
  // without stranding "chup anh duoc" as an orphan banner.
  assert.strictEqual(
    crossFused.length,
    1,
    `Expected 1 merged sentence, but got ${crossFused.length} lines: ${crossFused.map((x) => `[${x.startMs}-${x.endMs}: ${x.text}]`).join(', ')}`
  );
  assert.strictEqual(crossFused[0].text, BENCHMARK_SENTENCE);
  assert.strictEqual(crossFused[0].startMs, 1000);
});

check('4.2. Benchmark sentence with interspersed watermark garbage lines', () => {
  const ocrWithGarbage: SrtLine[] = [
    { id: 'g0', startMs: 500, endMs: 600, text: '|' },
    { id: 'f1', startMs: 1000, endMs: 2000, text: 'chụp ảnh được' },
    { id: 'g1', startMs: 2050, endMs: 2150, text: 'x' },
    { id: 'f2', startMs: 2200, endMs: 4000, text: 'chụp ảnh được, livestream được' },
    { id: 'g2', startMs: 4050, endMs: 4120, text: '...' },
    { id: 'f3', startMs: 4200, endMs: 7500, text: BENCHMARK_SENTENCE },
  ];

  const sanitized = sanitizeSubtitles(ocrWithGarbage);
  assert.strictEqual(sanitized.removedCount, 3);

  const deduped = deduplicateProgressiveKaraoke(sanitized.cleaned);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].text, BENCHMARK_SENTENCE);
  assert.strictEqual(deduped[0].startMs, 1000);
  assert.strictEqual(deduped[0].endMs, 7500);
});

check('4.3. Benchmark sentence wraps cleanly into max 2 lines <= 37 chars/line via nlpSegmenter', () => {
  const line: SrtLine = {
    id: 'bench-wrapped',
    startMs: 1000,
    endMs: 7500,
    text: BENCHMARK_SENTENCE,
  };
  const wrapped = consolidateSubtitleClauses([line]);
  assert.ok(wrapped.length >= 1);
  for (const block of wrapped) {
    const lines = block.text.split('\n');
    assert.ok(lines.length <= 2, `Block has > 2 lines: ${lines.length}`);
    for (const l of lines) {
      assert.ok(
        l.length <= 37,
        `Line exceeds 37 characters: "${l}" (${l.length} chars)`
      );
    }
  }
});

// =============================================================================
// SUITE 5: PATHOLOGICAL BOUNDARIES, IDEMPOTENCY & MASSIVE SCALE
// =============================================================================
console.log('\n--- SUITE 5: PATHOLOGICAL BOUNDARIES, IDEMPOTENCY & MASSIVE SCALE ---');

check('5.1. Idempotency test: dedup(dedup(x)) === dedup(x)', () => {
  const testInput: SrtLine[] = [
    { id: '1', startMs: 1000, endMs: 1800, text: 'Học máy' },
    { id: '2', startMs: 1850, endMs: 2500, text: 'Học máy' },
    { id: '3', startMs: 2600, endMs: 4000, text: 'Học máy và trí tuệ nhân tạo' },
    { id: '4', startMs: 6000, endMs: 8000, text: 'Phát biểu riêng biệt' },
  ];

  const pass1 = deduplicateSubtitlesPipeline(testInput);
  const pass2 = deduplicateSubtitlesPipeline(pass1);

  assert.strictEqual(pass1.length, pass2.length);
  for (let i = 0; i < pass1.length; i++) {
    assert.strictEqual(pass1[i].id, pass2[i].id);
    assert.strictEqual(pass1[i].startMs, pass2[i].startMs);
    assert.strictEqual(pass1[i].endMs, pass2[i].endMs);
    assert.strictEqual(pass1[i].text, pass2[i].text);
  }
});

check('5.2a. Default maxGapMs boundary (1200ms): gap 1199ms merges, gap 1205ms does NOT merge', () => {
  const lineA1: SrtLine = { id: '1', startMs: 1000, endMs: 2000, text: 'Thông điệp lặp' };
  const lineA2: SrtLine = { id: '2', startMs: 3199, endMs: 4000, text: 'Thông điệp lặp' }; // gap 1199ms
  const resMerge = deduplicateExact([lineA1, lineA2]);
  assert.strictEqual(resMerge.length, 1, 'gap 1199ms should merge under default 1200ms gap');

  const lineB1: SrtLine = { id: '1', startMs: 1000, endMs: 2000, text: 'Thông điệp lặp' };
  const lineB2: SrtLine = { id: '2', startMs: 3205, endMs: 4000, text: 'Thông điệp lặp' }; // gap 1205ms
  const resNoMerge = deduplicateExact([lineB1, lineB2]);
  assert.strictEqual(resNoMerge.length, 2, 'gap 1205ms must NOT merge (exceeds default 1200ms gap)');
});

check('5.2b. Hard silence ceiling (1500ms): gap 1499ms merges with options, gap 1501ms NEVER merges', () => {
  const lineA1: SrtLine = { id: '1', startMs: 1000, endMs: 2000, text: 'Thông điệp lặp' };
  const lineA2: SrtLine = { id: '2', startMs: 3499, endMs: 4500, text: 'Thông điệp lặp' }; // gap 1499ms
  const resMerge = deduplicateExact([lineA1, lineA2], { maxGapMs: 1800 });
  assert.strictEqual(resMerge.length, 1, 'gap 1499ms should merge under 1500ms hard silence ceiling');

  const lineB1: SrtLine = { id: '1', startMs: 1000, endMs: 2000, text: 'Thông điệp lặp' };
  const lineB2: SrtLine = { id: '2', startMs: 3501, endMs: 4500, text: 'Thông điệp lặp' }; // gap 1501ms
  const resNoMerge = deduplicateExact([lineB1, lineB2], { maxGapMs: 1800 });
  assert.strictEqual(resNoMerge.length, 2, 'gap 1501ms must NOT merge (exceeds 1500ms hard silence ceiling)');
});

check('5.3. Degenerate inputs: empty array, single item, zero-duration, negative timestamps', () => {
  assert.deepStrictEqual(deduplicateExact([]), []);
  assert.deepStrictEqual(deduplicateProgressiveKaraoke([]), []);
  assert.deepStrictEqual(deduplicateWhisperOcrCross([], []), []);

  const single: SrtLine[] = [{ id: '1', startMs: 100, endMs: 200, text: 'test' }];
  assert.strictEqual(deduplicateExact(single).length, 1);
  assert.strictEqual(deduplicateProgressiveKaraoke(single).length, 1);

  const negative: SrtLine[] = [
    { id: '1', startMs: -500, endMs: 1000, text: 'Âm' },
    { id: '2', startMs: 100, endMs: 1200, text: 'Âm' },
  ];
  const resNeg = deduplicateExact(negative);
  assert.strictEqual(resNeg.length, 1);
  assert.strictEqual(resNeg[0].startMs, -500);
});

check('5.4. High volume performance stress: 2,000 OCR frames processed under 1000ms', () => {
  const largeFrames: SrtLine[] = [];
  for (let i = 0; i < 2000; i++) {
    const cycle = i % 4;
    largeFrames.push({
      id: `frame-${i}`,
      startMs: i * 100,
      endMs: i * 100 + 95,
      text: cycle === 0 ? 'VanhSub' : cycle === 1 ? 'VanhSub AI' : cycle === 2 ? 'VanhSub AI Studio' : 'VanhSub AI Studio Pro',
    });
  }

  const startTime = Date.now();
  const deduped = deduplicateSubtitlesPipeline(largeFrames);
  const elapsed = Date.now() - startTime;

  console.log(`    (Processed 2,000 frames in ${elapsed}ms -> output count: ${deduped.length})`);
  assert.ok(elapsed < 1000, `Processing took ${elapsed}ms, exceeding 1000ms limit!`);
  assert.ok(deduped.length < 2000, 'Should significantly reduce 2000 repetitive frames');
});

// =============================================================================
// SUMMARY
// =============================================================================
console.log('\n================================================================');
console.log(`📊 ADVERSARIAL STRESS TEST SUMMARY:`);
console.log(`   Total Tests:  ${totalTests}`);
console.log(`   Passed:       ${passedTests} ✅`);
console.log(`   Failed:       ${failedTests} ❌`);
console.log(`   Pass Rate:    ${Math.round((passedTests / totalTests) * 100)}%`);
console.log('================================================================\n');

if (failedTests > 0) {
  console.error('FAILURES SUMMARY:');
  for (const f of failureDetails) {
    console.error(f);
  }
  process.exitCode = 1;
} else {
  console.log('🎉 ALL ADVERSARIAL CHALLENGES SURVIVED WITH 100% SUCCESS!');
}
