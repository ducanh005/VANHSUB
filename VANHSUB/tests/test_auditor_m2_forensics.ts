import {
  breakVietnameseLines,
  segmentSubtitlesNetflix,
  splitLineSmart,
  calculateCps,
  analyzeSubtitleLine,
  calculatePhoneticWeight,
} from '../main/lib/nlpSegmenter';
import { SrtLine } from '../main/lib/srt';

let passed = 0;
let failed = 0;

function check(desc: string, cond: boolean, details?: string) {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${desc}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${desc} ${details ? `-> ${details}` : ''}`);
  }
}

async function runAuditorForensics() {
  console.log('================================================================');
  console.log('AUDITOR FORENSIC INTEGRITY & ADVERSARIAL STRESS TEST (MILESTONE 2)');
  console.log('================================================================\n');

  // --- SUITE 1: Edge Cases & Extreme Inputs to breakVietnameseLines ---
  console.log('--- SUITE 1: Extreme Inputs to breakVietnameseLines ---');
  {
    // 1.1 Empty & whitespace
    check('1.1 Empty string returns empty', breakVietnameseLines('') === '');
    check('1.2 Whitespace string returns empty', breakVietnameseLines('   \t\n  ') === '');

    // 1.3 Super long single word without space (> 50 chars)
    const longWord = 'https://vanhsub.ai/features/vietnamese-nlp-subtitle-segmentation-netflix-standard';
    let noCrashLongWord = false;
    let longWordRes = '';
    try {
      longWordRes = breakVietnameseLines(longWord, 37);
      noCrashLongWord = true;
    } catch (e) {
      noCrashLongWord = false;
    }
    check('1.3 Word longer than 37 chars does not crash', noCrashLongWord);
    check('1.4 Long word preserves content without truncation', longWordRes.trim() === longWord);

    // 1.5 Redundant spaces and tabs normalized
    const messyText = '  Chính   phủ   vừa   ban   hành  \t  nghị   định   mới  ';
    const brokenMessy = breakVietnameseLines(messyText, 37);
    check('1.5 Normalized consecutive whitespace', !brokenMessy.includes('   '));

    // 1.6 All-caps text
    const allCaps = 'CHÍNH PHỦ VỪA BAN HÀNH NGHỊ ĐỊNH MỚI NHẰM PHÁT TRIỂN KINH TẾ.';
    const brokenCaps = breakVietnameseLines(allCaps, 37);
    const capsLines = brokenCaps.split('\n');
    check('1.6 All-caps text splits safely into <= 37 char lines', capsLines.every(l => l.trim().length <= 37));

    // 1.7 Currency and compound units variations
    const moneyText = 'Doanh thu đạt 1.500.000 USD và lợi nhuận tăng 25,5% trong năm 2026.';
    const brokenMoney = breakVietnameseLines(moneyText, 37);
    const moneyLines = brokenMoney.split('\n');
    check('1.7 Money & units text obeys <= 37 chars', moneyLines.every(l => l.trim().length <= 37));
    check('1.8 "25,5%" not split across lines', moneyLines.some(l => l.includes('25,5%')));
    check('1.9 "1.500.000 USD" kept intact', moneyLines.some(l => l.includes('1.500.000 USD')));
  }

  // --- SUITE 2: splitLineSmart Boundary Conditions ---
  console.log('\n--- SUITE 2: splitLineSmart Boundary Conditions ---');
  {
    const baseLine: SrtLine = {
      id: 'sub-base',
      startMs: 2000,
      endMs: 8000,
      text: 'Trí tuệ nhân tạo đang làm thay đổi thế giới một cách nhanh chóng.',
      speaker: 'SPEAKER_01',
    };

    // 2.1 CursorMs way before startMs
    const splitBefore = splitLineSmart(baseLine, -5000);
    check('2.1 Split with cursor before startMs preserves startMs', splitBefore.line1.startMs === 2000);
    check('2.2 Split preserves speaker on both lines', splitBefore.line1.speaker === 'SPEAKER_01' && splitBefore.line2.speaker === 'SPEAKER_01');
    check('2.3 Clearance gap strictly >= 80ms', splitBefore.line2.startMs - splitBefore.line1.endMs >= 80);

    // 2.4 CursorMs way beyond endMs
    const splitAfter = splitLineSmart(baseLine, 999999);
    check('2.4 Split with cursor beyond endMs preserves endMs', splitAfter.line2.endMs === 8000);
    check('2.5 Split preserves endMs >= startMs', splitAfter.line1.startMs < splitAfter.line1.endMs && splitAfter.line2.startMs < splitAfter.line2.endMs);

    // 2.6 Very short line (dur = 150ms)
    const tightLine: SrtLine = {
      id: 'sub-tight',
      startMs: 1000,
      endMs: 1150,
      text: 'Một hai ba bốn năm.',
    };
    const splitTight = splitLineSmart(tightLine, 1075);
    check('2.6 Tight duration split does not throw', splitTight.line1 !== undefined && splitTight.line2 !== undefined);

    // 2.7 Line with empty text
    const emptyLine: SrtLine = {
      id: 'sub-empty',
      startMs: 1000,
      endMs: 3000,
      text: '',
    };
    const splitEmpty = splitLineSmart(emptyLine);
    check('2.7 Empty text split does not throw', splitEmpty.line1.text === '' && splitEmpty.line2.text === '');
  }

  // --- SUITE 3: segmentSubtitlesNetflix Invariants & Adversarial Conditions ---
  console.log('\n--- SUITE 3: segmentSubtitlesNetflix Invariants ---');
  {
    // 3.1 Empty array
    check('3.1 Empty array returns empty array', segmentSubtitlesNetflix([]).length === 0);

    // 3.2 Preserves speaker through decomposition
    const multiChunkLine: SrtLine = {
      id: 'speaker-test',
      startMs: 10000,
      endMs: 30000,
      text: 'Thành phố Hồ Chí Minh là trung tâm kinh tế, tài chính và văn hóa lớn nhất miền Nam Việt Nam với hơn mười triệu dân sinh sống và làm việc.',
      speaker: 'SPEAKER_02',
    };
    const segmentedSpeaker = segmentSubtitlesNetflix([multiChunkLine]);
    check('3.2 Decomposed chunks all preserve speaker label', segmentedSpeaker.length > 1 && segmentedSpeaker.every(c => c.speaker === 'SPEAKER_02'));

    // 3.3 Zero silence gap between lines (touching subtitles)
    const touchingLines: SrtLine[] = [
      { id: 't1', startMs: 1000, endMs: 2000, text: 'Dòng thứ nhất.' },
      { id: 't2', startMs: 2000, endMs: 3000, text: 'Dòng thứ hai.' },
      { id: 't3', startMs: 3000, endMs: 4000, text: 'Dòng thứ ba.' },
    ];
    const segTouching = segmentSubtitlesNetflix(touchingLines);
    let noOverlap = true;
    for (let i = 0; i < segTouching.length - 1; i++) {
      if (segTouching[i].endMs > segTouching[i + 1].startMs) {
        noOverlap = false;
        console.error(`Overlap detected at index ${i}: endMs=${segTouching[i].endMs} > next startMs=${segTouching[i+1].startMs}`);
      }
    }
    check('3.3 Touching subtitles do not produce reversed timecode overlaps', noOverlap);

    // 3.4 Extremely high CPS line correctly triggers needsReview flag
    const ultraFastLine: SrtLine = {
      id: 'fast-review',
      startMs: 1000,
      endMs: 1400, // 400ms duration, 0ms gap to next
      text: 'Đây là một câu nói cực kỳ dài và dồn dập đến mức không thể đọc kịp trong khoảng thời gian này.',
    };
    const nextImmediate: SrtLine = {
      id: 'fast-next',
      startMs: 1480,
      endMs: 3000,
      text: 'Câu tiếp theo bắt đầu ngay.',
    };
    const segFast = segmentSubtitlesNetflix([ultraFastLine, nextImmediate]);
    const highCpsChunk = segFast.find(c => calculateCps(c) > 21);
    check('3.4 High CPS line has needsReview flag set', highCpsChunk ? highCpsChunk.needsReview === true : true);
  }

  // --- SUITE 4: Randomized Stress Generation (30 Complex Vietnamese Sentences) ---
  console.log('\n--- SUITE 4: Stress Testing Across 30 Generated Complex Sentences ---');
  {
    const prefixes = [
      'Chính phủ vừa ban hành',
      'Thủ tướng Chính phủ yêu cầu',
      'Bộ trưởng Bộ Tài chính nhấn mạnh rằng',
      'Theo nhận định của các chuyên gia kinh tế,',
      'Đại biểu Quốc hội đã thảo luận sôi nổi về',
      'Các doanh nghiệp khởi nghiệp đổi mới sáng tạo',
    ];

    const middles = [
      'dự án chuyển đổi số quốc gia với tổng vốn đầu tư 4,8 tỷ USD',
      'kế hoạch giảm lãi suất ngân hàng nhằm hỗ trợ sản xuất kinh doanh',
      'chiến lược phát triển trí tuệ nhân tạo và công nghệ bán dẫn tại Việt Nam',
      'chính sách bảo vệ môi trường và ứng phó biến đổi khí hậu',
      'mục tiêu tăng trưởng kinh tế xã hội đạt 7,5% trong năm 2026',
    ];

    const suffixes = [
      'đang mang lại những tín hiệu hết sức tích cực cho toàn thể nhân dân.',
      'đóng vai trò then chốt trong sự nghiệp công nghiệp hóa, hiện đại hóa.',
      'sẽ tạo ra bước đột phá to lớn cho nền kinh tế biển trong thập kỷ tới.',
      'nhằm bảo đảm an sinh xã hội và nâng cao đời sống của người lao động.',
      'với sự tham gia tích cực của hơn 100.000 chuyên gia và kỹ sư trẻ.',
    ];

    const stressSentences: string[] = [];
    for (let p of prefixes) {
      for (let m of middles) {
        stressSentences.push(`${p} ${m} ${suffixes[stressSentences.length % suffixes.length]}`);
      }
    }

    const testLines: SrtLine[] = stressSentences.map((text, i) => ({
      id: `stress-${i}`,
      startMs: i * 8000,
      endMs: i * 8000 + 7200,
      text,
    }));

    const resultBlocks = segmentSubtitlesNetflix(testLines);

    let allBlocksValidLines = true;
    let allLinesValidChars = true;
    let maxCharSeen = 0;
    let invalidCharDetail = '';

    for (const b of resultBlocks) {
      const bLines = b.text.split('\n');
      if (bLines.length > 2) {
        allBlocksValidLines = false;
      }
      for (const line of bLines) {
        const len = line.trim().length;
        if (len > maxCharSeen) maxCharSeen = len;
        if (len > 37) {
          allLinesValidChars = false;
          invalidCharDetail = `Len ${len}: "${line}"`;
        }
      }
    }

    check('4.1 Generated 30 complex sentences segmented without crash', resultBlocks.length >= 30);
    check('4.2 100% of segmented blocks have <= 2 lines', allBlocksValidLines);
    check('4.3 100% of subtitle lines have <= 37 characters', allLinesValidChars, invalidCharDetail);
    console.log(`      (Maximum observed line length: ${maxCharSeen}/37 characters)`);
  }

  // --- SUMMARY ---
  console.log('\n================================================================');
  console.log(`AUDITOR FORENSIC TEST RESULTS:`);
  console.log(`TOTAL CHECKS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuditorForensics().catch(err => {
  console.error('Fatal error in forensic tests:', err);
  process.exit(1);
});
