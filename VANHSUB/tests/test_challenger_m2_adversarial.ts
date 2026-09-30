import {
  breakVietnameseLines,
  segmentSubtitlesNetflix,
  splitLineSmart,
  calculateCps,
  analyzeSubtitleLine,
  calculatePhoneticWeight,
} from '../main/lib/nlpSegmenter';
import { SrtLine } from '../main/lib/srt';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureDetails: string[] = [];

function check(cond: boolean, desc: string, details?: string) {
  totalTests++;
  if (cond) {
    passedTests++;
    console.log(`  ✅ PASS: ${desc}`);
  } else {
    failedTests++;
    const msg = `  ❌ FAIL: ${desc}${details ? ` -> ${details}` : ''}`;
    console.error(msg);
    failureDetails.push(msg);
  }
}

async function runAdversarialStressTests() {
  console.log('================================================================');
  console.log('🔥 CHALLENGER M2: ADVERSARIAL STRESS TEST SUITE (NETFLIX VIETNAMESE NLP)');
  console.log('================================================================\n');

  // ==========================================================================
  // SUITE 1: EXTREME SENTENCE LENGTHS (200+ TO 500+ CHARS, 40-90 WORDS)
  // ==========================================================================
  console.log('--- SUITE 1: Extreme Sentence Lengths (200+ to 500+ chars) ---');

  const EXTREME_SENTENCES = [
    // 1. Extreme 245 chars, 40 words
    {
      text: 'Chính phủ vừa ban hành nghị quyết mới với mục tiêu đẩy mạnh cải cách thủ tục hành chính, tạo điều kiện thuận lợi tối đa cho cộng đồng doanh nghiệp và thu hút nguồn vốn đầu tư trực tiếp nước ngoài vào các ngành công nghiệp mũi nhọn tại Việt Nam.',
      label: 'Nghị quyết chính phủ (245 chars)'
    },
    // 2. Extreme 295 chars, 47 words
    {
      text: 'Thị trường tài chính và chứng khoán Việt Nam trong quý vừa qua đã ghi nhận mức tăng trưởng vượt bậc với tổng giá trị giao dịch bình quân đạt hơn 25 nghìn tỷ đồng mỗi phiên, củng cố vững chắc niềm tin của các nhà đầu tư trong nước cũng như các quỹ tài chính quy mô lớn trên toàn thế giới.',
      label: 'Báo cáo tài chính chứng khoán (295 chars)'
    },
    // 3. Extreme 382 chars, 58 words
    {
      text: 'Việc nghiên cứu và ứng dụng trí tuệ nhân tạo cùng công nghệ vi mạch bán dẫn đang được xem là động lực then chốt nhằm nâng cao năng lực cạnh tranh quốc gia, đòi hỏi sự phối hợp chặt chẽ, đồng bộ giữa các cơ quan quản lý nhà nước, các viện nghiên cứu khoa học, các trường đại học hàng đầu và các tập đoàn công nghệ tiên phong để xây dựng hệ sinh thái đổi mới sáng tạo bền vững.',
      label: 'Khoa học công nghệ AI & bán dẫn (382 chars)'
    },
    // 4. Extreme 518 chars, 83 words
    {
      text: 'Trước những diễn biến phức tạp và khó lường của tình hình địa chính trị toàn cầu cùng áp lực lạm phát gia tăng, Ngân hàng Nhà nước Việt Nam đã chủ động triển khai các biện pháp can thiệp thị trường tiền tệ linh hoạt, kết hợp hài hòa chính sách tài khóa với chính sách tiền tệ nhằm giữ vững ổn định kinh tế vĩ mô, kiểm soát lạm phát dưới ngưỡng 4%, bảo đảm các cân đối lớn của nền kinh tế và đồng thời tạo dư địa cần thiết cho việc phục hồi, thúc đẩy tăng trưởng sản xuất kinh doanh của các doanh nghiệp trong nước.',
      label: 'Mega-sentence chính sách tiền tệ (518 chars)'
    }
  ];

  for (const item of EXTREME_SENTENCES) {
    const originalText = item.text;
    const initialLine: SrtLine = {
      id: `ext-${totalTests}`,
      startMs: 10000,
      endMs: 30000, // 20s
      text: originalText,
    };

    const blocks = segmentSubtitlesNetflix([initialLine]);

    check(
      blocks.length >= 2,
      `[${item.label}] Phân rã thành nhiều blocks hợp lệ (sinh ra ${blocks.length} blocks)`
    );

    let allBlocksMax2Lines = true;
    let allLinesMax37Chars = true;
    let maxLineLengthSeen = 0;
    let worstLine = '';

    for (const b of blocks) {
      const bLines = b.text.split('\n');
      if (bLines.length > 2) allBlocksMax2Lines = false;
      for (const l of bLines) {
        const len = l.trim().length;
        if (len > maxLineLengthSeen) maxLineLengthSeen = len;
        if (len > 37) {
          allLinesMax37Chars = false;
          worstLine = l.trim();
        }
      }
    }

    check(
      allBlocksMax2Lines,
      `[${item.label}] 100% blocks có số dòng <= 2`
    );
    check(
      allLinesMax37Chars,
      `[${item.label}] 100% dòng có độ dài <= 37 ký tự (Max: ${maxLineLengthSeen}/37)${worstLine ? ` [Vi phạm: "${worstLine}"]` : ''}`
    );

    // Kiểm tra bảo toàn từ vựng (no words lost)
    const originalWords = originalText.trim().replace(/[.,:;!?]/g, '').split(/\s+/);
    const reconstructedWords = blocks.map(b => b.text).join(' ').trim().replace(/[.,:;!?]/g, '').split(/\s+/);
    check(
      originalWords.length === reconstructedWords.length,
      `[${item.label}] Bảo toàn 100% từ vựng, không rơi rụng nội dung (${originalWords.length} == ${reconstructedWords.length})`
    );

    // Kiểm tra monotonicity và gap giữa các block sinh ra
    let monotonic = true;
    let clearanceGapsOk = true;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].startMs >= blocks[i].endMs) monotonic = false;
      if (i < blocks.length - 1) {
        const gap = blocks[i + 1].startMs - blocks[i].endMs;
        if (gap < 80) clearanceGapsOk = false;
      }
    }
    check(monotonic, `[${item.label}] Timecode đơn điệu nghiêm ngặt (startMs < endMs)`);
    check(clearanceGapsOk, `[${item.label}] Khoảng cách clearance giữa các sub-blocks >= 80ms`);
  }

  // ==========================================================================
  // SUITE 2: EDGE-CASE NUMBERS, DECIMALS, AND CURRENCIES
  // ==========================================================================
  console.log('\n--- SUITE 2: Edge-case Numbers, Currencies, and Unit Binding ---');

  const NUMERIC_EDGE_CASES = [
    {
      raw: 'Khoản chi ngân sách vừa qua là 1.234.567,89 đồng cho mỗi hộ gia đình.',
      checkSpan: '1.234.567,89 đồng',
      desc: 'Số hàng triệu định dạng VN "1.234.567,89 đồng"'
    },
    {
      raw: 'Tỷ lệ lạm phát mục tiêu duy trì ở mức 0,5% trong quý này.',
      checkSpan: '0,5%',
      desc: 'Số thập phân có dấu phẩy "0,5%"'
    },
    {
      raw: 'Tốc độ tối đa trên cao tốc là 100 km/h và không được vượt quá.',
      checkSpan: '100 km/h',
      desc: 'Vận tốc "100 km/h"'
    },
    {
      raw: 'Tổng vốn đầu tư ban đầu ước tính khoảng 30 triệu USD cho dự án.',
      checkSpan: '30 triệu USD',
      desc: 'Tiền tệ ngoại tệ "30 triệu USD"'
    },
    {
      raw: 'Doanh thu năm nay đạt 25,8 tỷ VND và vượt 15% kế hoạch.',
      checkSpan: '25,8 tỷ VND',
      desc: 'Tiền tệ tỷ đồng thập phân "25,8 tỷ VND"'
    },
    {
      raw: 'Nhà máy đã tiêu thụ hơn 10.000 kWh điện trong tháng cao điểm.',
      checkSpan: '10.000 kWh',
      desc: 'Đơn vị điện năng "10.000 kWh"'
    },
    {
      raw: 'Dự án tuyển dụng thêm 500 kỹ sư chất lượng cao cho trung tâm R&D.',
      checkSpan: '500 kỹ sư',
      desc: 'Đơn vị nhân lực "500 kỹ sư"'
    },
    {
      raw: 'Đoàn kiểm tra đã huy động hơn 45 chuyên gia y tế đầu ngành.',
      checkSpan: '45 chuyên gia',
      desc: 'Đơn vị chuyên gia "45 chuyên gia"'
    }
  ];

  for (const item of NUMERIC_EDGE_CASES) {
    const broken = breakVietnameseLines(item.raw, 37);
    const lines = broken.split('\n');

    check(
      lines.every(l => l.length <= 37),
      `[${item.desc}] Mọi dòng <= 37 chars`
    );

    // Kiểm tra cụm số và đơn vị không bị ngắt đôi giữa dòng 1 và dòng 2
    let intact = false;
    for (const line of lines) {
      if (line.includes(item.checkSpan)) {
        intact = true;
        break;
      }
    }

    // Nếu span chứa số như "1.234.567,89 đồng", kiểm tra xem "đồng" có bị tách khỏi "1.234.567,89" không
    check(
      intact,
      `[${item.desc}] Cụm "${item.checkSpan}" được giữ nguyên trên 1 dòng, không bị xé đôi`
    );
  }

  // ==========================================================================
  // SUITE 3: DANGLING PREPOSITIONS AND CONJUNCTIONS STRESS
  // ==========================================================================
  console.log('\n--- SUITE 3: Dangling Words at End of Line 1 Stress ---');

  const DANGLING_TEST_CASES = [
    {
      text: 'Đây là chương trình hợp tác quan trọng của các tập đoàn công nghệ lớn.',
      forbiddenWord: 'của',
      desc: 'Không treo "của" cuối dòng 1'
    },
    {
      text: 'Chúng tôi mong muốn phối hợp chặt chẽ và đem lại nhiều giá trị thiết thực.',
      forbiddenWord: 'và',
      desc: 'Không treo "và" cuối dòng 1'
    },
    {
      text: 'Các bạn cần chuẩn bị tinh thần sẵn sàng cho những thử thách phía trước.',
      forbiddenWord: 'cho',
      desc: 'Không treo "cho" cuối dòng 1'
    },
    {
      text: 'Kế hoạch hành động cụ thể đã được trình lên ban lãnh đạo phê duyệt.',
      forbiddenWord: 'lên',
      desc: 'Không treo "lên" cuối dòng 1'
    },
    {
      text: 'Quy chuẩn an toàn mới áp dụng đồng bộ tại các trung tâm phân phối.',
      forbiddenWord: 'tại',
      desc: 'Không treo "tại" cuối dòng 1'
    }
  ];

  for (const item of DANGLING_TEST_CASES) {
    const broken = breakVietnameseLines(item.text, 37);
    const lines = broken.split('\n');

    if (lines.length >= 2) {
      const l1Words = lines[0].trim().split(/\s+/);
      const lastWord = l1Words[l1Words.length - 1].toLowerCase().replace(/[.,:;!?]/g, '');
      check(
        lastWord !== item.forbiddenWord,
        `[${item.desc}] Dòng 1 không kết thúc bằng "${item.forbiddenWord}" (Thực tế từ cuối: "${lastWord}")`
      );
    } else {
      check(true, `[${item.desc}] Câu ngắn vừa vặn trong 1 dòng`);
    }
  }

  // ==========================================================================
  // SUITE 4: TIMECODE STRESS (ZERO-GAP, SHORT AUDIO, LARGE GAP, SMART-SPLIT)
  // ==========================================================================
  console.log('\n--- SUITE 4: Timecode Stress (Zero-gap, Micro-duration, Large Gaps) ---');

  // Test 4A: Zero-gap consecutive subtitles
  {
    console.log('  Testing 4A: Zero-gap consecutive subtitles...');
    const zeroGapLines: SrtLine[] = [
      { id: 'zg-1', startMs: 1000, endMs: 3000, text: 'Phụ đề số một bắt đầu.' },
      { id: 'zg-2', startMs: 3000, endMs: 5000, text: 'Phụ đề số hai tiếp nối ngay.' }, // gap = 0ms
      { id: 'zg-3', startMs: 5000, endMs: 7000, text: 'Phụ đề số ba liền kề.' },     // gap = 0ms
      { id: 'zg-4', startMs: 7000, endMs: 9000, text: 'Phụ đề số bốn kết thúc.' },     // gap = 0ms
    ];

    const result = segmentSubtitlesNetflix(zeroGapLines, { minGapMs: 80 });

    let zeroGapHandled = true;
    for (let i = 0; i < result.length - 1; i++) {
      const gap = result[i + 1].startMs - result[i].endMs;
      if (gap < 80) {
        zeroGapHandled = false;
        console.error(`    ❌ Gap vi phạm: result[${i}].endMs=${result[i].endMs}, result[${i+1}].startMs=${result[i+1].startMs}, gap=${gap}ms`);
      }
    }
    check(
      zeroGapHandled,
      '4A: Zero-gap subtitles được điều chỉnh để duy trì gap >= 80ms'
    );
  }

  // Test 4B: Micro-duration intervals (100ms - 200ms audio)
  {
    console.log('  Testing 4B: Micro-duration intervals (100ms - 200ms)...');
    const microLines: SrtLine[] = [
      { id: 'micro-1', startMs: 1000, endMs: 1100, text: 'Vâng.' }, // 100ms
      { id: 'micro-2', startMs: 1200, endMs: 1400, text: 'Đúng vậy.' }, // 200ms
      { id: 'micro-3', startMs: 5000, endMs: 7000, text: 'Câu bình thường tiếp theo.' }
    ];

    const result = segmentSubtitlesNetflix(microLines, { minGapMs: 80, autoPadDuration: true });

    let noOverlap = true;
    for (let i = 0; i < result.length; i++) {
      const line = result[i];
      if (line.startMs >= line.endMs) {
        noOverlap = false;
        console.error(`    ❌ Micro line #${i} startMs (${line.startMs}) >= endMs (${line.endMs})`);
      }
      if (i < result.length - 1) {
        if (line.endMs > result[i + 1].startMs) {
          noOverlap = false;
          console.error(`    ❌ Micro line #${i} endMs (${line.endMs}) > next startMs (${result[i+1].startMs})`);
        }
      }
    }
    check(
      noOverlap,
      '4B: Micro-duration audio không gây đè timecode lên câu tiếp theo'
    );
  }

  // Test 4C: Large gap between subtitles (e.g. 30 seconds gap)
  {
    console.log('  Testing 4C: Large gaps (30,000ms)...');
    const largeGapLines: SrtLine[] = [
      { id: 'lg-1', startMs: 1000, endMs: 2500, text: 'Chào mừng các bạn quay trở lại.' },
      { id: 'lg-2', startMs: 35000, endMs: 37000, text: 'Phần tiếp theo bắt đầu sau 30 giây.' }
    ];

    const result = segmentSubtitlesNetflix(largeGapLines);
    const firstEnd = result[0].endMs;
    // Duration padding không được nới quá đà đến tận 35000ms
    check(
      firstEnd < 10000,
      `4C: Large gap không khiến duration padding mở rộng vô hạn (endMs: ${firstEnd}ms < 10000ms)`
    );
  }

  // Test 4D: splitLineSmart robustness under edge conditions
  {
    console.log('  Testing 4D: splitLineSmart edge conditions...');
    // Short line (600ms)
    const shortLine: SrtLine = {
      id: 'split-short',
      startMs: 2000,
      endMs: 2700, // 700ms
      text: 'Hà Nội mùa thu tuyệt đẹp.'
    };
    const { line1, line2 } = splitLineSmart(shortLine);
    check(
      line1.startMs < line1.endMs && line2.startMs < line2.endMs && line1.endMs < line2.startMs,
      `4D: splitLineSmart giữ nguyên tính đơn điệu thời gian (L1: ${line1.startMs}-${line1.endMs}, L2: ${line2.startMs}-${line2.endMs})`
    );
    check(
      line2.startMs - line1.endMs >= 80,
      `4D: splitLineSmart clearance gap >= 80ms (thực tế: ${line2.startMs - line1.endMs}ms)`
    );
  }

  // Test 4F: Multi-chunk decomposition collision with tightly-following subtitle
  {
    console.log('  Testing 4F: Multi-chunk decomposition with tightly-following subtitle...');
    const collisionLines: SrtLine[] = [
      {
        id: 'coll-1',
        startMs: 0,
        endMs: 2000, // Short time window for long text
        text: 'Thị trường tài chính và chứng khoán Việt Nam trong quý vừa qua đã ghi nhận mức tăng trưởng vượt bậc với tổng giá trị giao dịch bình quân đạt hơn 25 nghìn tỷ đồng mỗi phiên, củng cố vững chắc niềm tin của các nhà đầu tư trong nước cũng như các quỹ tài chính quy mô lớn trên toàn thế giới.'
      },
      {
        id: 'coll-2',
        startMs: 2000,
        endMs: 4000,
        text: 'Dự án tiếp tục được triển khai.'
      }
    ];

    const result = segmentSubtitlesNetflix(collisionLines);

    let chronologicalOrder = true;
    let noInterLineOverlap = true;

    for (let i = 0; i < result.length - 1; i++) {
      if (result[i].startMs > result[i + 1].startMs) {
        chronologicalOrder = false;
        console.error(`    ❌ Out of order: result[${i}].startMs=${result[i].startMs} > result[${i+1}].startMs=${result[i+1].startMs}`);
      }
      if (result[i].endMs > result[i + 1].startMs) {
        noInterLineOverlap = false;
        console.error(`    ❌ Overlap: result[${i}].endMs=${result[i].endMs} > result[${i+1}].startMs=${result[i+1].startMs}`);
      }
    }

    check(
      chronologicalOrder,
      '4F: Các khối phụ đề sau khi decompose vẫn giữ thứ tự thời gian tăng dần (startMs monotonicity)'
    );
    check(
      noInterLineOverlap,
      '4F: Các khối phụ đề con không tràn qua và đè lên mốc thời gian của câu tiếp theo'
    );
  }

  // Test 4G: splitLineSmart with short duration (< 680ms)
  {
    console.log('  Testing 4G: splitLineSmart with short duration (< 680ms)...');
    const ultraShortLine: SrtLine = {
      id: 'split-micro',
      startMs: 1000,
      endMs: 1300, // 300ms duration
      text: 'Chào bạn nhé.'
    };
    const { line1, line2 } = splitLineSmart(ultraShortLine);
    const validMonotonic = line1.startMs < line1.endMs && line2.startMs < line2.endMs && line1.endMs < line2.startMs;
    if (!validMonotonic) {
      console.error(`    ❌ Invalid timecodes: line1=[${line1.startMs}, ${line1.endMs}], line2=[${line2.startMs}, ${line2.endMs}]`);
    }
    check(
      validMonotonic,
      '4G: splitLineSmart không sinh timecode âm (line2.startMs < line2.endMs)'
    );
  }

  // Test 4H: Short duration subtitle followed by zero-gap subtitle (< 380ms total window)
  {
    console.log('  Testing 4H: Short duration subtitle with zero-gap to next subtitle...');
    const shortZeroGap: SrtLine[] = [
      { id: 'sz-1', startMs: 1800, endMs: 2000, text: 'Ngắn gọn.' }, // 200ms duration
      { id: 'sz-2', startMs: 2000, endMs: 4000, text: 'Câu tiếp theo bắt đầu ngay tại 2000ms.' }
    ];
    const res = segmentSubtitlesNetflix(shortZeroGap, { minGapMs: 80 });
    const noOverlap = res[0].endMs <= res[1].startMs;
    const hasGap = res[1].startMs - res[0].endMs >= 80;
    if (!noOverlap || !hasGap) {
      console.error(`    ❌ Overlap or negative gap: res[0].endMs=${res[0].endMs}, res[1].startMs=${res[1].startMs}, gap=${res[1].startMs - res[0].endMs}ms`);
    }
    check(
      noOverlap && hasGap,
      '4H: Phụ đề ngắn đứng trước zero-gap không bị pad đè lên câu tiếp theo'
    );
  }

  // Test 4E: splitLineSmart with cursorMs at boundary extremes
  {
    console.log('  Testing 4E: splitLineSmart cursorMs at boundary extremes...');
    const testLine: SrtLine = {
      id: 'split-cursor',
      startMs: 5000,
      endMs: 10000,
      text: 'Trí tuệ nhân tạo đang thay đổi sâu sắc toàn bộ nền kinh tế thế giới.'
    };
    // Cursor at very beginning (5100ms)
    const resBegin = splitLineSmart(testLine, 5100);
    check(
      resBegin.line1.text.length > 0 && resBegin.line2.text.length > 0,
      '4E: Cursor sát điểm đầu không gây rỗng text dòng 1 hay 2'
    );
    // Cursor at very end (9900ms)
    const resEnd = splitLineSmart(testLine, 9900);
    check(
      resEnd.line1.text.length > 0 && resEnd.line2.text.length > 0,
      '4E: Cursor sát điểm cuối không gây rỗng text dòng 1 hay 2'
    );
  }

  // ==========================================================================
  // SUITE 5: UNUSUAL PUNCTUATION, SPECIAL CHARS & FORMATTING
  // ==========================================================================
  console.log('\n--- SUITE 5: Special Punctuation & Formatting Edge Cases ---');

  {
    // Multiple spaces, leading/trailing whitespace, tabs
    const messyText = '   Việt Nam    đặt mục tiêu  phát triển   bền vững   đến năm 2030.  \t ';
    const broken = breakVietnameseLines(messyText, 37);
    const lines = broken.split('\n');
    check(
      lines.every(l => l.length <= 37),
      '5A: Xử lý chuỗi chứa nhiều khoảng trắng thừa/tab thành công (mọi dòng <= 37)'
    );
    check(
      !broken.includes('   '),
      '5A: Khoảng trắng thừa được chuẩn hoá'
    );
  }

  {
    // Quotes and brackets
    const quotedText = 'Thủ tướng nhấn mạnh: "Chúng ta phải quyết tâm đổi mới sáng tạo toàn diện."';
    const broken = breakVietnameseLines(quotedText, 37);
    const lines = broken.split('\n');
    check(
      lines.every(l => l.length <= 37),
      '5B: Câu chứa dấu ngoặc kép phân dòng <= 37 chars'
    );
  }

  {
    // Ellipsis and dashes
    const dashedText = 'Dự án đường cao tốc Bắc — Nam — biểu tượng của tinh thần đổi mới và phát triển.';
    const broken = breakVietnameseLines(dashedText, 37);
    const lines = broken.split('\n');
    check(
      lines.every(l => l.length <= 37),
      '5C: Câu chứa dấu gạch ngang dài phân dòng <= 37 chars'
    );
  }

  // ==========================================================================
  // SUITE 6: REALISTIC SUBTITLE STREAM WITH SPEED/CPS AUDITING
  // ==========================================================================
  console.log('\n--- SUITE 6: Realistic Subtitle Stream & CPS Auditing ---');

  {
    const streamLines: SrtLine[] = [
      { id: 's1', startMs: 0, endMs: 2000, text: 'Chào mừng các bạn đến với khóa học.' },
      { id: 's2', startMs: 2100, endMs: 3800, text: 'Hôm nay chúng ta sẽ tìm hiểu về trí tuệ nhân tạo.' },
      { id: 's3', startMs: 4000, endMs: 5500, text: 'Một chủ đề đang rất được quan tâm.' },
      { id: 's4', startMs: 5600, endMs: 7200, text: 'Hãy cùng theo dõi chi tiết ngay sau đây.' }
    ];

    const processed = segmentSubtitlesNetflix(streamLines, { targetCps: 18, minGapMs: 80 });

    let allCpsUnderControl = true;
    for (const line of processed) {
      const analysis = analyzeSubtitleLine(line);
      if (analysis.cps > 23 && !line.needsReview) {
        allCpsUnderControl = false;
        console.error(`    ❌ Line ${line.id} có CPS cao (${analysis.cps}) nhưng không được gắn cờ needsReview`);
      }
    }

    check(
      allCpsUnderControl,
      '6: CPS được kiểm soát tốt hoặc đánh dấu needsReview nếu quá nhanh'
    );
  }

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log('\n================================================================');
  console.log(`📊 KẾT QUẢ ADVERSARIAL STRESS TEST:`);
  console.log(`   Tổng assertions: ${totalTests}`);
  console.log(`   Đạt (PASS):      ${passedTests}`);
  console.log(`   Không đạt (FAIL): ${failedTests}`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    console.error('Chi tiết các lỗi phát hiện:');
    failureDetails.forEach(f => console.error(f));
    process.exit(1);
  } else {
    console.log('🎉 TẤT CẢ CÁC BÀI TEST ĐỐI KHÁNG ĐỀU ĐẠT CHUẨN XUẤT SẮC!');
  }
}

runAdversarialStressTests().catch(err => {
  console.error('Lỗi khi chạy adversarial test:', err);
  process.exit(1);
});
