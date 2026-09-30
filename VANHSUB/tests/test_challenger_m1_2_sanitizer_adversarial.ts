/**
 * ADVERSARIAL STRESS TEST SUITE: OCR NOISE & GARBAGE SANITIZER (M1)
 * Challenger M1-2 (critic, specialist)
 *
 * Scope:
 * 1. Hybrid fusion resilience: heavy OCR noise vs clean Whisper, valid banners mixed with noise,
 *    temporal overlap of noise with Whisper speech, empty Whisper scenarios.
 * 2. 100% Vietnamese dialogue preservation: 0% false positives on genuine speech across
 *    diverse vocabulary, short words, loanwords, numbers/units, quotes, NFC/NFD Unicode forms.
 * 3. Garbage detection accuracy: 0% false negatives across single-char noise, floating symbols,
 *    Unicode decode glitches (PUA, replacement chars, box drawing), ultra-short flicker (<150ms).
 * 4. High-load stress & ReDoS safety: 10,000 mixed lines, execution speed < 250ms, immutability.
 * 5. SubtitleEditor UI integration contracts & idempotency.
 */

import {
  isOcrGarbageLine,
  sanitizeSubtitles,
  type SanitizeOptions,
} from '../main/lib/subtitleSanitizer';
import { fuseOcrAndWhisper } from '../main/asr/hybridFusionEngine';
import type { SrtLine } from '../main/lib/srt';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures: string[] = [];

function assertTest(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS] ${testName}`);
  } else {
    failedTests++;
    const msg = `  ✗ [FAIL] ${testName}${detail ? ' -> ' + detail : ''}`;
    console.error(msg);
    failures.push(msg);
  }
}

console.log('================================================================');
console.log('⚡ ADVERSARIAL STRESS TEST: OCR NOISE & GARBAGE SANITIZER (M1)');
console.log('================================================================\n');

// ============================================================================
// SUITE 1: 100% VIETNAMESE DIALOGUE PRESERVATION (0% False Positives)
// ============================================================================
console.log('--- SUITE 1: 100% Vietnamese Dialogue Preservation (0% False Positives) ---');

const genuineVietnameseDialogue: string[] = [
  // Short 2-letter conversational responses
  'Có', 'Đi', 'Ăn', 'Ta', 'Xe', 'Cá', 'Gà', 'Mẹ', 'Ba', 'Bố', 'Về', 'Kìa', 'Nè', 'Hả', 'Hử', 'Ơi', 'Ủa', 'Ụa',
  // Short colloquial interjections with tone marks
  'Dạ', 'Ừm', 'Ha', 'Hè', 'Nha', 'Nhé', 'Thôi', 'Được', 'Đúng', 'Sai', 'Chưa', 'Rồi',
  // Typical sentences with questions & exclamations
  'Ăn cơm chưa?',
  'Đi đâu đấy bạn ơi?',
  'Trời ơi, chuyện này khó tin quá!',
  'Tuyệt vời quá cả nhà ơi!',
  'Ủa sao tự nhiên lại thế này?',
  'Dạ vâng, em chào anh chị ạ.',
  'Hôm nay thời tiết Hà Nội mát mẻ dễ chịu.',
  // Numbers, units, percentages, currencies
  'Chiếc áo này giá 150.000 VNĐ.',
  'Tăng trưởng doanh thu đạt 18,5% trong quý vừa qua.',
  'Anh ấy cao 1m80 và nặng 75kg.',
  'Cuộc họp bắt đầu lúc 15:30 chiều nay.',
  'Khoảng cách từ đây đến đó là 50km.',
  'Căn hộ này có giá 3,5 tỷ đồng.',
  // Formatting: quotes, dashes, ellipses, parentheses
  '— Cậu đang làm gì đấy? — Tôi đang viết mã.',
  'Thầy giáo bảo: "Hãy luôn kiên trì học hỏi!"',
  'Mọi chuyện... dường như đã an bài...',
  '(Cười) Đừng nói đùa như thế chứ!',
  '[Nhạc nhẹ] Mùa thu rụng lá trên con đường vắng.',
  // English loanwords, tech slang, trendy terms
  'Nhớ bật Bluetooth và kết nối Wi-Fi nhé.',
  'Video vừa đăng đã đạt hơn 1M view trên TikTok.',
  'Chụp ảnh check-in ở quán cà phê chill cực kỳ.',
  'Đang chạy deadline sấp mặt luôn.',
  'Livestream bán hàng hôm nay cháy hàng rồi.',
  // Complex multi-clause sentence (benchmark)
  'chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được, nhưng giá cho mỗi hoạt động tính thế nào?'
];

let allDialoguePreserved = true;
const falsePositives: string[] = [];

for (const phrase of genuineVietnameseDialogue) {
  const line: SrtLine = {
    id: `dial-${Math.random()}`,
    startMs: 1000,
    endMs: 3000,
    text: phrase,
  };
  const isGarbage = isOcrGarbageLine(line);
  if (isGarbage) {
    allDialoguePreserved = false;
    falsePositives.push(phrase);
  }
}

assertTest(
  allDialoguePreserved && falsePositives.length === 0,
  'Genuine Vietnamese dialogue corpus (43 phrases) is 100% preserved (0% false positives)',
  falsePositives.length > 0 ? `Falsely flagged: ${falsePositives.join(', ')}` : undefined
);

// Test Unicode NFC vs NFD normalization resilience
console.log('Testing NFC vs NFD Unicode normalization on Vietnamese tone marks...');
const toneMarkWords = [
  'tiếng', 'việt', 'người', 'đường', 'phượng', 'hoàng', 'thuở', 'nghỉ', 'ngơi', 'chuyện'
];

let nfcNfdConsistent = true;
for (const word of toneMarkWords) {
  const nfcLine: SrtLine = { id: 'nfc', startMs: 1000, endMs: 2500, text: word.normalize('NFC') };
  const nfdLine: SrtLine = { id: 'nfd', startMs: 1000, endMs: 2500, text: word.normalize('NFD') };

  if (isOcrGarbageLine(nfcLine) || isOcrGarbageLine(nfdLine)) {
    nfcNfdConsistent = false;
    console.error(`Normalization failed for word: ${word}`);
  }
}

assertTest(
  nfcNfdConsistent,
  'All Vietnamese tone marks in both NFC and NFD decomposed forms are 100% preserved'
);

// Rapid speech with Whisper audio backing (< 150ms)
const rapidSpeechWithWhisper: SrtLine = {
  id: 'rapid-1',
  startMs: 1000,
  endMs: 1100, // 100ms duration (< 150ms)
  text: 'Dạ!',
};

const whisperBacking: SrtLine[] = [
  { id: 'w-1', startMs: 950, endMs: 1200, text: 'Dạ vâng' },
];

assertTest(
  !isOcrGarbageLine(rapidSpeechWithWhisper, { whisperSegments: whisperBacking }),
  'Ultra-short rapid speech (<150ms) is preserved when backed by overlapping Whisper audio'
);

assertTest(
  isOcrGarbageLine(rapidSpeechWithWhisper, { whisperSegments: [] }),
  'Ultra-short block (<150ms) is correctly rejected when NO Whisper audio overlaps'
);

// ============================================================================
// SUITE 2: GARBAGE & NOISE DETECTION ACCURACY (0% False Negatives)
// ============================================================================
console.log('\n--- SUITE 2: Garbage & Noise Detection Accuracy (0% False Negatives) ---');

const knownNoiseInputs: { label: string; text: string; durationMs?: number }[] = [
  // Single char noise
  { label: 'single lowercase c', text: 'c' },
  { label: 'single uppercase A', text: 'A' },
  { label: 'single digit 1', text: '1' },
  { label: 'single dash -', text: '-' },
  { label: 'single period .', text: '.' },
  { label: 'single pipe |', text: '|' },
  { label: 'single tilde ~', text: '~' },
  // Surrounded single char noise
  { label: 'punctuation-padded .c', text: '.c' },
  { label: 'punctuation-padded -A', text: '-A' },
  { label: 'bracket-wrapped [x]', text: '[x]' },
  { label: 'parenthesis-wrapped (1)', text: '(1)' },
  { label: 'asterisk-padded *c*', text: '*c*' },
  { label: 'quote-padded "z"', text: '"z"' },
  { label: 'space and dash - a ', text: '- a ' },
  // Floating punctuation
  { label: 'floating ellipsis ...', text: '...' },
  { label: 'floating em-dash —', text: '—' },
  { label: 'floating double dash --', text: '--' },
  { label: 'floating symbols !?', text: '!?' },
  { label: 'floating brackets [ ]', text: '[ ]' },
  { label: 'floating bullets •••', text: '•••' },
  { label: 'floating arrows >>>', text: '>>>' },
  { label: 'floating underscores ___', text: '___' },
  // Unicode glitches
  { label: 'replacement char \uFFFD', text: 'Lỗi giải mã \uFFFD' },
  { label: 'PUA char \uE001', text: 'Biểu tượng lạ \uE001' },
  { label: 'Box drawing glitch │', text: '│' },
  { label: 'Box drawing double ║', text: '║' },
  { label: 'Block elements ███', text: '███' },
  { label: 'Control char BELL \u0007', text: '\u0007' },
  // Whitespace & empty
  { label: 'empty string', text: '' },
  { label: 'spaces only', text: '   ' },
  { label: 'tabs and newlines', text: '\t\n   \n' },
];

let allNoiseDetected = true;
const undetectedNoise: string[] = [];

for (const noise of knownNoiseInputs) {
  const line: SrtLine = {
    id: `noise-${noise.label}`,
    startMs: 1000,
    endMs: 1000 + (noise.durationMs ?? 1000),
    text: noise.text,
  };
  const isGarbage = isOcrGarbageLine(line);
  if (!isGarbage) {
    allNoiseDetected = false;
    undetectedNoise.push(noise.label);
  }
}

assertTest(
  allNoiseDetected && undetectedNoise.length === 0,
  `Known noise input corpus (${knownNoiseInputs.length} patterns) is 100% detected as garbage`,
  undetectedNoise.length > 0 ? `Failed to detect: ${undetectedNoise.join(', ')}` : undefined
);

// Malformed timestamp handling
assertTest(
  isOcrGarbageLine({ id: 'bad-1', startMs: -100, endMs: 500, text: 'Hợp lệ nhưng âm' }),
  'Negative startMs is treated as invalid/garbage'
);
assertTest(
  isOcrGarbageLine({ id: 'bad-2', startMs: 2000, endMs: 1000, text: 'Hợp lệ nhưng đảo' }),
  'Inverted timestamps (startMs > endMs) are treated as invalid/garbage'
);
assertTest(
  isOcrGarbageLine({ id: 'bad-3', startMs: 1000, endMs: 1000, text: 'Hợp lệ nhưng 0ms' }),
  'Zero duration (startMs === endMs) is treated as invalid/garbage'
);
assertTest(
  isOcrGarbageLine({ id: 'bad-4', startMs: NaN, endMs: 2000, text: 'Hợp lệ nhưng NaN' }),
  'NaN timestamp is treated as invalid/garbage'
);

// ============================================================================
// SUITE 3: HYBRID FUSION RESILIENCE WITH HEAVY NOISE & BANNERS
// ============================================================================
console.log('\n--- SUITE 3: Hybrid Fusion Resilience with Heavy Noise & Banners ---');

// Scenario 3.1: Heavy OCR Noise vs Clean Whisper
const heavyOcrList: SrtLine[] = [];
// Add 50 noise lines
for (let i = 0; i < 50; i++) {
  const noiseTypes = ['c', 'A', '.', '-', '...', '|', '[ ]', '—', '\uFFFD', '*'];
  const text = noiseTypes[i % noiseTypes.length];
  heavyOcrList.push({
    id: `ocr-noise-${i}`,
    startMs: i * 500,
    endMs: i * 500 + (i % 3 === 0 ? 80 : 300),
    text,
  });
}

// Add 5 genuine speech OCR lines matching Whisper
const genuineSpeechOcr: SrtLine[] = [
  { id: 'ocr-s1', startMs: 30000, endMs: 33000, text: 'xin chào quy vi khan gia' },
  { id: 'ocr-s2', startMs: 34000, endMs: 37000, text: 'hom nay chung toi gioi thieu' },
  { id: 'ocr-s3', startMs: 38000, endMs: 41000, text: 'san pham cong nghe moi nhat' },
  { id: 'ocr-s4', startMs: 42000, endMs: 45000, text: 'voi nhieu tinh nang vuot troi' },
  { id: 'ocr-s5', startMs: 46000, endMs: 49000, text: 'cam on da theo doi' },
];
heavyOcrList.push(...genuineSpeechOcr);

// Clean Whisper segments
const cleanWhisperSegments: SrtLine[] = [
  { id: 'w-s1', startMs: 30000, endMs: 33000, text: 'Xin chào quý vị khán giả' },
  { id: 'w-s2', startMs: 34000, endMs: 37000, text: 'Hôm nay chúng tôi giới thiệu' },
  { id: 'w-s3', startMs: 38000, endMs: 41000, text: 'Sản phẩm công nghệ mới nhất' },
  { id: 'w-s4', startMs: 42000, endMs: 45000, text: 'Với nhiều tính năng vượt trội' },
  { id: 'w-s5', startMs: 46000, endMs: 49000, text: 'Cảm ơn đã theo dõi' },
];

const fusionResult1 = fuseOcrAndWhisper(heavyOcrList, cleanWhisperSegments);

assertTest(
  fusionResult1.stats.garbageFiltered === 50,
  `Heavy OCR noise (50 noise lines) is 100% filtered out (filtered: ${fusionResult1.stats.garbageFiltered}/50)`
);
assertTest(
  fusionResult1.stats.matchedSegments === 5,
  `All 5 genuine speech segments are properly matched with Whisper (matched: ${fusionResult1.stats.matchedSegments}/5)`
);
assertTest(
  fusionResult1.segments.length === 5,
  `Output segments contain only the 5 clean merged speech lines, zero noise lines (got: ${fusionResult1.segments.length})`
);

// Verify diacritics were repaired from Whisper
const firstSegment = fusionResult1.segments[0];
assertTest(
  firstSegment && firstSegment.text.includes('quý vị khán giả'),
  'Vietnamese diacritics correctly repaired from clean Whisper into fused subtitle'
);

// Scenario 3.2: Valid Banners Mixed with Heavy Noise and NO Whisper audio
console.log('Testing OCR with valid static banners mixed with heavy noise (No Whisper)...');
const bannersAndNoise: SrtLine[] = [
  { id: 'b1', startMs: 1000, endMs: 4000, text: 'TẬP 1: NGÀY KHỞI ĐẦU' },
  { id: 'n1', startMs: 4500, endMs: 4800, text: 'c' },
  { id: 'b2', startMs: 5000, endMs: 8000, text: 'Đạo diễn: Nguyễn Văn A' },
  { id: 'n2', startMs: 8200, endMs: 8300, text: '...' }, // 100ms noise
  { id: 'b3', startMs: 9000, endMs: 12000, text: 'Hà Nội, mùa thu năm 1990' },
  { id: 'n3', startMs: 12200, endMs: 12500, text: '—' },
  { id: 'b4', startMs: 13000, endMs: 16000, text: 'Kênh Tin Tức 24h' },
  { id: 'n4', startMs: 16200, endMs: 16300, text: '\uFFFD' },
];

const fusionResultBanners = fuseOcrAndWhisper(bannersAndNoise, []);

assertTest(
  fusionResultBanners.stats.bannersPreserved === 4,
  `Valid video banners are 100% preserved (got ${fusionResultBanners.stats.bannersPreserved}/4)`
);
assertTest(
  fusionResultBanners.stats.garbageFiltered === 4,
  `Noise lines mixed with banners are 100% rejected (got ${fusionResultBanners.stats.garbageFiltered}/4)`
);
assertTest(
  fusionResultBanners.segments.length === 4,
  `Output contains exactly the 4 valid banners and zero noise lines`
);
assertTest(
  fusionResultBanners.segments.every((s) => !['c', '...', '—'].includes(s.text)),
  'No noise text leaked into output banners'
);

// Scenario 3.3: Temporal Overlap of Noise with Background Whisper Speech
console.log('Testing temporal coincidence: OCR noise coinciding with Whisper speech...');
// Suppose at [5000, 5200], OCR catches a single letter 'x' (watermark),
// while Whisper has speech at [4000, 7000] ("chúng ta tiếp tục thảo luận").
const coincidingOcr: SrtLine[] = [
  { id: 'c-noise-1', startMs: 5000, endMs: 5200, text: 'x' },
  { id: 'c-speech-1', startMs: 5300, endMs: 7000, text: 'chung ta tiep tuc thao luan' },
];
const coincidingWhisper: SrtLine[] = [
  { id: 'c-w-1', startMs: 4000, endMs: 7200, text: 'Chúng ta tiếp tục thảo luận' },
];

const coincidingResult = fuseOcrAndWhisper(coincidingOcr, coincidingWhisper);

assertTest(
  coincidingResult.stats.garbageFiltered === 1,
  'OCR single-char noise overlapping with Whisper speech is still rejected as garbage (NOT promoted to banner)'
);
assertTest(
  coincidingResult.segments.length === 1 && coincidingResult.segments[0].text.includes('Chúng ta tiếp tục thảo luận'),
  'Valid speech is retained and restored, overlapping noise is discarded'
);

// ============================================================================
// SUITE 4: HIGH LOAD STRESS & PERFORMANCE HARNESS (10,000 Lines)
// ============================================================================
console.log('\n--- SUITE 4: High Load Stress & Performance Harness (10,000 Lines) ---');

const largeDataset: SrtLine[] = [];
for (let i = 0; i < 10000; i++) {
  const isGarbage = i % 2 === 0;
  if (isGarbage) {
    largeDataset.push({
      id: `stress-${i}`,
      startMs: i * 200,
      endMs: i * 200 + 150,
      text: i % 4 === 0 ? 'c' : i % 4 === 1 ? '...' : i % 4 === 2 ? '— a' : '\uFFFD',
    });
  } else {
    largeDataset.push({
      id: `stress-${i}`,
      startMs: i * 200,
      endMs: i * 200 + 500,
      text: 'Câu phụ đề tiếng Việt hợp lệ trong thử nghiệm chịu tải lớn',
    });
  }
}

const startTime = performance.now();
const sanitizeLargeResult = sanitizeSubtitles(largeDataset);
const durationMs = performance.now() - startTime;

console.log(`  Processed 10,000 lines in ${durationMs.toFixed(2)}ms`);

assertTest(
  durationMs < 250,
  `High load processing: 10,000 lines executed in < 250ms (actual: ${durationMs.toFixed(2)}ms)`
);
assertTest(
  sanitizeLargeResult.cleaned.length === 5000,
  `Exactly 5,000 valid lines preserved (got: ${sanitizeLargeResult.cleaned.length})`
);
assertTest(
  sanitizeLargeResult.removedCount === 5000,
  `Exactly 5,000 garbage lines removed (got: ${sanitizeLargeResult.removedCount})`
);
assertTest(
  largeDataset.length === 10000,
  'Immutability: Original input array length unchanged (10,000)'
);

// ============================================================================
// SUITE 5: SUBTITLEEDITOR UI & IDEMPOTENCY INVARIANTS
// ============================================================================
console.log('\n--- SUITE 5: SubtitleEditor UI & Idempotency Invariants ---');

// Test idempotency: sanitize(sanitize(x)) === sanitize(x)
const mixedInput: SrtLine[] = [
  { id: '1', startMs: 1000, endMs: 2000, text: 'Phụ đề 1' },
  { id: '2', startMs: 2500, endMs: 2600, text: 'c' },
  { id: '3', startMs: 3000, endMs: 5000, text: 'Phụ đề 2' },
  { id: '4', startMs: 5500, endMs: 5600, text: '...' },
];

const pass1 = sanitizeSubtitles(mixedInput);
const pass2 = sanitizeSubtitles(pass1.cleaned);

assertTest(
  pass1.removedCount === 2 && pass1.cleaned.length === 2,
  'Pass 1 removes exactly the 2 garbage lines'
);
assertTest(
  pass2.removedCount === 0 && pass2.cleaned.length === pass1.cleaned.length,
  'Idempotency: Pass 2 on already-cleaned subtitles removes 0 lines and preserves all cleaned lines'
);

// Edge Cases: Empty array, null/undefined safety
const emptyResult = sanitizeSubtitles([]);
assertTest(
  emptyResult.cleaned.length === 0 && emptyResult.removedCount === 0,
  'Empty array input returns empty result safely'
);

const nullishArrayResult = sanitizeSubtitles(null as any);
assertTest(
  nullishArrayResult.cleaned.length === 0 && nullishArrayResult.removedCount === 0,
  'Null input returns empty result safely without throwing'
);

// Summary & Verdict
console.log('\n================================================================');
console.log(`📊 ADVERSARIAL STRESS TEST SUMMARY:`);
console.log(`   Total Tests:  ${totalTests}`);
console.log(`   Passed:       ${passedTests} ✅`);
console.log(`   Failed:       ${failedTests} ❌`);
console.log('================================================================');

if (failedTests > 0) {
  console.error('\nFAILURES ENCOUNTERED:');
  failures.forEach((f) => console.error(f));
  process.exit(1);
} else {
  console.log('\n🌟 ALL ADVERSARIAL CHALLENGES PASSED WITH ZERO DEFECTS!');
  process.exit(0);
}
