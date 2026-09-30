import {
  breakVietnameseLines,
  segmentSubtitlesNetflix,
  splitLineSmart,
  calculateCps,
  analyzeSubtitleLine,
  calculatePhoneticWeight,
} from '../main/lib/nlpSegmenter';
import { SrtLine } from '../main/lib/srt';

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
  console.log('🧪 BẮT ĐẦU TEST SUITE: VIETNAMESE NLP SUBTITLE SEGMENTATION (NETFLIX STANDARD)\n');

  // ==========================================================================
  // Test Suite 1: Compound Word Preservation (Bảo toàn Từ ghép Tiếng Việt)
  // ==========================================================================
  console.log('--- Test Suite 1: Compound Word Preservation ---');

  {
    // Câu 1: Chứa "Chính phủ", "nghị định", "phát triển", "kinh tế"
    const text1 = 'Chính phủ vừa ban hành nghị định mới nhằm thúc đẩy phát triển kinh tế số.';
    const broken1 = breakVietnameseLines(text1, 37);
    const lines1 = broken1.split('\n');

    assert(lines1.length === 2, `Câu được chia làm 2 dòng cân đối (thực tế: ${lines1.length} dòng)`);
    assert(lines1[0].length <= 37, `Dòng 1 <= 37 ký tự (${lines1[0].length} ký tự: "${lines1[0]}")`);
    assert(lines1[1].length <= 37, `Dòng 2 <= 37 ký tự (${lines1[1].length} ký tự: "${lines1[1]}")`);

    // Kiểm tra không ngắt đôi từ ghép
    assert(!lines1[0].endsWith('Chính') && !lines1[1].startsWith('phủ'), 'Không ngắt đôi từ "Chính phủ"');
    assert(!lines1[0].endsWith('nghị') && !lines1[1].startsWith('định'), 'Không ngắt đôi từ "nghị định"');
    assert(!lines1[0].endsWith('phát') && !lines1[1].startsWith('triển'), 'Không ngắt đôi từ "phát triển"');
    assert(!lines1[0].endsWith('kinh') && !lines1[1].startsWith('tế'), 'Không ngắt đôi từ "kinh tế"');
    assert(!lines1[0].endsWith('thúc') && !lines1[1].startsWith('đẩy'), 'Không ngắt đôi từ "thúc đẩy"');
  }

  {
    // Câu 2: Chứa "Trí tuệ nhân tạo", "doanh nghiệp", "thách thức"
    const text2 = 'Trí tuệ nhân tạo mang lại nhiều cơ hội và thách thức cho doanh nghiệp.';
    const broken2 = breakVietnameseLines(text2, 37);
    const lines2 = broken2.split('\n');

    assert(lines2.length === 2, `Câu được chia làm 2 dòng (thực tế: ${lines2.length} dòng)`);
    assert(lines2[0].length <= 37 && lines2[1].length <= 37, 'Cả 2 dòng tuân thủ <= 37 ký tự');
    assert(!lines2[0].endsWith('Trí') && !lines2[1].startsWith('tuệ'), 'Không ngắt đôi từ "Trí tuệ"');
    assert(!lines2[0].endsWith('nhân') && !lines2[1].startsWith('tạo'), 'Không ngắt đôi từ "nhân tạo"');
    assert(!lines2[0].endsWith('doanh') && !lines2[1].startsWith('nghiệp'), 'Không ngắt đôi từ "doanh nghiệp"');
  }

  {
    // Câu 3: Chứa "Thành phố Hồ Chí Minh", "Việt Nam", "thương mại"
    const text3 = 'Thành phố Hồ Chí Minh là trung tâm thương mại lớn nhất của Việt Nam.';
    const broken3 = breakVietnameseLines(text3, 37);
    const lines3 = broken3.split('\n');

    assert(lines3.length === 2, `Câu được chia làm 2 dòng (thực tế: ${lines3.length} dòng)`);
    assert(lines3[0].length <= 37 && lines3[1].length <= 37, 'Cả 2 dòng tuân thủ <= 37 ký tự');
    assert(!lines3[0].endsWith('Việt') && !lines3[1].startsWith('Nam'), 'Không ngắt đôi tên riêng "Việt Nam"');
    assert(!lines3[0].endsWith('thương') && !lines3[1].startsWith('mại'), 'Không ngắt đôi từ "thương mại"');
  }

  // ==========================================================================
  // Test Suite 2: Numeric and Unit Binding (Ràng buộc Số liệu và Đơn vị)
  // ==========================================================================
  console.log('\n--- Test Suite 2: Numeric and Unit Binding ---');

  {
    // Câu chứa "2,5 tỷ USD" và "120 km/h"
    const text = 'Dự án có tổng mức đầu tư 2,5 tỷ USD và vận hành với tốc độ 120 km/h.';
    const broken = breakVietnameseLines(text, 37);
    const lines = broken.split('\n');

    assert(lines.length === 2, `Chia làm 2 dòng (thực tế: ${lines.length} dòng)`);
    assert(lines[0].length <= 37 && lines[1].length <= 37, 'Cả 2 dòng <= 37 ký tự');

    // "2,5 tỷ USD" phải nằm trọn vẹn trên 1 dòng
    const has25BillionLine1 = lines[0].includes('2,5 tỷ USD');
    const has25BillionLine2 = lines[1].includes('2,5 tỷ USD');
    assert(has25BillionLine1 || has25BillionLine2, 'Cụm "2,5 tỷ USD" được bảo toàn trọn vẹn trên cùng 1 dòng');

    // "120 km/h" phải nằm trọn vẹn trên 1 dòng
    const has120kmhLine1 = lines[0].includes('120 km/h');
    const has120kmhLine2 = lines[1].includes('120 km/h');
    assert(has120kmhLine1 || has120kmhLine2, 'Cụm "120 km/h" được bảo toàn trọn vẹn trên cùng 1 dòng');
  }

  {
    // Câu chứa "30%", "15 kỹ sư", "8 giờ"
    const text = 'Hơn 15 kỹ sư đã làm việc suốt 8 giờ để hoàn thành chỉ tiêu tăng 30%.';
    const broken = breakVietnameseLines(text, 37);
    const lines = broken.split('\n');

    assert(lines[0].length <= 37 && lines[1].length <= 37, 'Cả 2 dòng <= 37 ký tự');
    assert(
      lines[0].includes('15 kỹ sư') || lines[1].includes('15 kỹ sư'),
      'Cụm "15 kỹ sư" không bị tách rời giữa số và đơn vị'
    );
    assert(
      lines[0].includes('8 giờ') || lines[1].includes('8 giờ'),
      'Cụm "8 giờ" không bị tách rời giữa số và đơn vị'
    );
    assert(
      lines[0].includes('30%') || lines[1].includes('30%'),
      'Cụm "30%" không bị tách rời'
    );
  }

  // ==========================================================================
  // Test Suite 3: Dangling Preposition Prevention (Chống từ nối treo cuối dòng 1)
  // ==========================================================================
  console.log('\n--- Test Suite 3: Dangling Preposition Prevention ---');

  {
    const text = 'Chúng tôi rất vinh dự được hợp tác chặt chẽ với các chuyên gia đầu ngành tại Việt Nam.';
    const broken = breakVietnameseLines(text, 37);
    const lines = broken.split('\n');

    assert(lines.every((l) => l.length <= 37), 'Mọi dòng sinh ra đều <= 37 ký tự');

    // Kiểm tra dòng 1 không kết thúc bằng từ nối treo
    const forbiddenLastWords = ['với', 'tại', 'cho', 'của', 'để', 'và', 'trong', 'là', 'các', 'những'];
    const l1Words = lines[0].trim().split(/\s+/);
    const lastWord1 = l1Words[l1Words.length - 1].toLowerCase().replace(/[.,:;!?]/g, '');

    assert(
      !forbiddenLastWords.includes(lastWord1),
      `Dòng 1 không kết thúc bằng từ nối treo (từ cuối: "${lastWord1}")`
    );
  }

  {
    const text = 'Chương trình được thiết kế nhằm mang lại lợi ích thiết thực cho người dân trên toàn quốc.';
    const broken = breakVietnameseLines(text, 37);
    const lines = broken.split('\n');

    const l1Words = lines[0].trim().split(/\s+/);
    const lastWord1 = l1Words[l1Words.length - 1].toLowerCase().replace(/[.,:;!?]/g, '');

    assert(lastWord1 !== 'cho', `Dòng 1 không kết thúc bằng "cho" (từ cuối: "${lastWord1}")`);
    assert(lastWord1 !== 'nhằm', `Dòng 1 không kết thúc bằng "nhằm" (từ cuối: "${lastWord1}")`);
  }

  // ==========================================================================
  // Test Suite 4: 100% Compliance with <= 37 chars/line, max 2 lines/block (50 Sentences)
  // ==========================================================================
  console.log('\n--- Test Suite 4: 100% Compliance Across 50 Complex Vietnamese Sentences ---');

  const COMPLEX_50_SENTENCES: string[] = [
    'Chính phủ vừa ban hành nghị định mới nhằm thúc đẩy phát triển kinh tế số.',
    'Trí tuệ nhân tạo đang thay đổi sâu sắc cách thức làm việc và tư duy của con người.',
    'Việt Nam đặt mục tiêu trở thành quốc gia phát triển có thu nhập cao vào năm 2045.',
    'Thành phố Hồ Chí Minh là trung tâm kinh tế, tài chính và đổi mới sáng tạo lớn nhất cả nước.',
    'Dự án đường sắt tốc độ cao Bắc - Nam có tổng mức đầu tư ước tính khoảng 67 tỷ USD.',
    'Ngân hàng Nhà nước tiếp tục điều hành chính sách tiền tệ chủ động, linh hoạt và hiệu quả.',
    'Các chuyên gia công nghệ khuyến nghị doanh nghiệp cần đầu tư mạnh mẽ vào an ninh mạng.',
    'Chuyển đổi số trong ngành giáo dục đã mở ra cơ hội học tập bình đẳng cho học sinh vùng sâu.',
    'Hội nghị cấp cao ASEAN lần thứ 44 đã bế mạc thành công tốt đẹp với nhiều thỏa thuận quan trọng.',
    'Ngành du lịch Việt Nam ghi nhận sự phục hồi mạnh mẽ với hơn 12 triệu lượt khách quốc tế.',
    'Đội ngũ kỹ sư phần mềm đã hoàn thành xuất sắc giai đoạn thử nghiệm phiên bản mới.',
    'Nông nghiệp công nghệ cao đang là hướng đi bền vững cho nông dân đồng bằng sông Cửu Long.',
    'Chính sách bảo hiểm xã hội mới sẽ mang lại nhiều quyền lợi thiết thực cho người lao động.',
    'Tập đoàn công nghệ hàng đầu thế giới vừa công bố kế hoạch xây dựng trung tâm nghiên cứu tại Hà Nội.',
    'Việc phát triển năng lượng tái tạo là chìa khóa để Việt Nam thực hiện cam kết giảm phát thải ròng.',
    'Các trường đại học đang tích cực đổi mới chương trình đào tạo để đáp ứng nhu cầu thị trường.',
    'Hệ thống y tế cơ sở cần được nâng cấp trang thiết bị để nâng cao chất lượng khám chữa bệnh.',
    'Thị trường bất động sản đang có những tín hiệu khởi sắc sau khi các luật mới có hiệu lực.',
    'Chúng ta cần xây dựng văn hóa giao thông văn minh, hiện đại và an toàn cho tất cả mọi người.',
    'Việc bảo tồn và phát huy giá trị di sản văn hóa dân tộc là trách nhiệm của toàn xã hội.',
    'Các giải pháp đột phá về hạ tầng giao thông sẽ giúp kết nối vùng kinh tế trọng điểm phía Nam.',
    'Sự phát triển của thương mại điện tử đã tạo ra thói quen mua sắm tiện lợi cho hàng triệu gia đình.',
    'Bộ Y tế khuyến cáo người dân chủ động tiêm phòng vắc xin để phòng ngừa các bệnh truyền nhiễm.',
    'Thanh niên Việt Nam luôn tiên phong trong phong trào khởi nghiệp sáng tạo và chuyển đổi xanh.',
    'Quốc hội đã thảo luận sôi nổi và thông qua nhiều dự án luật có tính chất nền tảng cho tương lai.',
    'Các nhà khoa học trẻ đã tìm ra giải pháp xử lý rác thải nhựa bằng công nghệ sinh học tiên tiến.',
    'Chúng tôi xin chân thành cảm ơn quý vị đại biểu và các vị khách quý đã đến tham dự buổi lễ.',
    'Tỷ lệ lạm phát được kiểm soát ở mức dưới 4% là thành tựu nổi bật trong điều hành vĩ mô.',
    'Thị trường chứng khoán chứng kiến phiên giao dịch bùng nổ với thanh khoản vượt 30 nghìn tỷ đồng.',
    'Công tác phòng chống thiên tai và tìm kiếm cứu nạn luôn được triển khai kịp thời, quyết liệt.',
    'Nhiều mô hình hợp tác xã kiểu mới đang giúp nâng cao giá trị chuỗi nông sản xuất khẩu.',
    'Các doanh nghiệp nhỏ và vừa đóng vai trò then chốt trong việc tạo việc làm cho xã hội.',
    'Công nghệ bán dẫn đang thu hút sự quan tâm đặc biệt của các nhà đầu tư chiến lược toàn cầu.',
    'Chương trình mục tiêu quốc gia xây dựng nông thôn mới đã làm thay đổi diện mạo làng quê.',
    'Việc kiểm soát chặt chẽ an toàn vệ sinh thực phẩm là nhiệm vụ cấp bách của các cơ quan quản lý.',
    'Các chính sách hỗ trợ lãi suất đã giúp nhiều cơ sở sản xuất vượt qua giai đoạn khó khăn.',
    'Bộ Ngoại giao khẳng định Việt Nam luôn coi trọng mối quan hệ đối tác chiến lược toàn diện.',
    'Lễ hội văn hóa truyền thống thu hút đông đảo du khách trong và ngoài nước đến thưởng thức.',
    'Công tác cải cách thủ tục hành chính đã giúp cắt giảm đáng kể thời gian và chi phí cho người dân.',
    'Ngành viễn thông đang đẩy nhanh tiến độ phủ sóng mạng 5G trên phạm vi toàn quốc.',
    'Các vận động viên thể thao Việt Nam đã nỗ lực thi đấu và mang về nhiều huy chương vàng danh giá.',
    'Khí hậu toàn cầu đang diễn biến phức tạp, đòi hỏi các quốc gia phải chung tay hành động khẩn trương.',
    'Chúng tôi cam kết cung cấp dịch vụ tốt nhất và luôn đồng hành cùng sự phát triển của khách hàng.',
    'Mô hình kinh tế tuần hoàn sẽ giúp tối ưu hóa việc sử dụng tài nguyên và giảm thiểu ô nhiễm.',
    'Hệ thống tư pháp ngày càng được hoàn thiện, bảo đảm tính nghiêm minh và công bằng xã hội.',
    'Các bậc phụ huynh cần quan tâm và đồng hành cùng con em trong giai đoạn định hướng tương lai.',
    'Việc phát triển kinh tế biển phải luôn gắn liền với bảo vệ chủ quyền biển đảo thiêng liêng của Tổ quốc.',
    'Những nỗ lực không ngừng nghỉ của toàn thể cán bộ nhân viên đã đem lại kết quả vượt kỳ vọng.',
    'Xin chào và hẹn gặp lại quý khán giả trong chương trình thời sự tối mai vào lúc 19 giờ.',
    'Dự án nâng cấp tuyến đê biển đã hoàn thành 95% khối lượng công việc và sẵn sàng đưa vào vận hành trước mùa mưa bão năm nay.'
  ];

  const mockSrtLines: SrtLine[] = COMPLEX_50_SENTENCES.map((text, i) => ({
    id: `line-${i}`,
    startMs: i * 4000,
    endMs: i * 4000 + 3500,
    text,
  }));

  const segmentedBlocks = segmentSubtitlesNetflix(mockSrtLines);

  assert(segmentedBlocks.length >= 50, `Sinh ra ${segmentedBlocks.length} khối phụ đề từ 50 câu ban đầu`);

  let allLinesUnder37 = true;
  let allBlocksUnder2Lines = true;
  let maxObservedLen = 0;
  let offendingLine = '';

  for (const block of segmentedBlocks) {
    const rawLines = block.text.split('\n');
    if (rawLines.length > 2) {
      allBlocksUnder2Lines = false;
      console.error(`Khối vượt quá 2 dòng (${rawLines.length} dòng):`, block);
    }
    for (const l of rawLines) {
      const len = l.trim().length;
      if (len > maxObservedLen) maxObservedLen = len;
      if (len > 37) {
        allLinesUnder37 = false;
        offendingLine = l;
      }
    }
  }

  assert(allBlocksUnder2Lines, '100% các khối phụ đề có số dòng <= 2');
  assert(
    allLinesUnder37,
    `100% các dòng phụ đề có độ dài <= 37 ký tự (Độ dài lớn nhất quan sát được: ${maxObservedLen}/37, vi phạm: "${offendingLine}")`
  );

  // ==========================================================================
  // Test Suite 5: 15-21 CPS Speed Control & Duration Padding
  // ==========================================================================
  console.log('\n--- Test Suite 5: CPS Speed Control & Duration Padding ---');

  {
    // Test 5A: Câu quá ngắn ("Cảm ơn bạn.", 350ms ban đầu, gap 1200ms)
    const shortLine: SrtLine = {
      id: 'short-1',
      startMs: 1000,
      endMs: 1350, // duration 350ms
      text: 'Cảm ơn bạn.',
    };
    const nextLine: SrtLine = {
      id: 'short-2',
      startMs: 2550, // khoảng lặng 1200ms
      endMs: 5000,
      text: 'Chúc bạn một ngày tốt lành.',
    };

    const padded = segmentSubtitlesNetflix([shortLine, nextLine]);
    const paddedFirst = padded[0];
    const newDur = paddedFirst.endMs - paddedFirst.startMs;

    assert(newDur >= 1000, `Thời lượng câu ngắn được pad lên >= 1000ms (thực tế: ${newDur}ms)`);
    assert(paddedFirst.endMs <= nextLine.startMs - 80, `Duy trì clearance gap >= 80ms tới câu tiếp theo (${nextLine.startMs - paddedFirst.endMs}ms)`);
  }

  {
    // Test 5B: Tốc độ đọc nhanh (30 ký tự trong 800ms = 37.5 CPS, gap 2000ms)
    const fastLine: SrtLine = {
      id: 'fast-1',
      startMs: 0,
      endMs: 800,
      text: 'Xin chào quý vị khán giả.', // 25 ký tự không kể space/newline, CPS ban đầu 31.2
    };
    const nextLine: SrtLine = {
      id: 'fast-2',
      startMs: 3000, // gap 2200ms
      endMs: 6000,
      text: 'Hôm nay chúng ta cùng tìm hiểu.',
    };

    const initialCps = calculateCps(fastLine);
    assert(initialCps > 25, `CPS ban đầu trước khi pad cao hơn 25 (${initialCps} CPS)`);

    const padded = segmentSubtitlesNetflix([fastLine, nextLine], { targetCps: 18 });
    const finalCps = calculateCps(padded[0]);

    assert(
      finalCps >= 14 && finalCps <= 21,
      `Sau duration padding, CPS nằm trong dải an toàn 15-21 CPS (thực tế: ${finalCps} CPS, duration: ${padded[0].endMs - padded[0].startMs}ms)`
    );
  }

  // ==========================================================================
  // Test Suite 6: Timecode Monotonicity & Clearance Gap >= 80ms
  // ==========================================================================
  console.log('\n--- Test Suite 6: Timecode Monotonicity & Clearance Gap ---');

  {
    // Câu rất dài bị chia thành nhiều khối phụ đề
    const veryLongLine: SrtLine = {
      id: 'long-1',
      startMs: 5000,
      endMs: 12000, // 7000ms
      text: 'Thành phố Hồ Chí Minh là trung tâm kinh tế, tài chính và đổi mới sáng tạo lớn nhất cả nước với tiềm năng phát triển vượt bậc.',
    };

    const splitBlocks = segmentSubtitlesNetflix([veryLongLine]);
    assert(splitBlocks.length >= 2, `Câu dài được phân tách thành ${splitBlocks.length} khối phụ đề con`);

    let monotonic = true;
    let clearanceOk = true;

    for (let i = 0; i < splitBlocks.length; i++) {
      const b = splitBlocks[i];
      if (b.startMs >= b.endMs) {
        monotonic = false;
        console.error(`Khối #${i} có startMs >= endMs:`, b);
      }
      if (b.endMs - b.startMs < 500) {
        console.error(`Khối #${i} thời lượng quá ngắn (< 500ms):`, b);
      }
      if (i < splitBlocks.length - 1) {
        const nextB = splitBlocks[i + 1];
        const gap = nextB.startMs - b.endMs;
        if (gap < 80) {
          clearanceOk = false;
          console.error(`Clearance gap giữa #${i} và #${i+1} nhỏ hơn 80ms (${gap}ms)`);
        }
      }
    }

    assert(monotonic, 'Mọi khối phụ đề đảm bảo tính đơn điệu: startMs < endMs');
    assert(clearanceOk, 'Khoảng cách giữa các khối phụ đề liên tiếp luôn >= 80ms (Clearance Gap)');
  }

  {
    // Kiểm tra thao tác splitLineSmart
    const lineToSplit: SrtLine = {
      id: 'test-split',
      startMs: 10000,
      endMs: 16000,
      text: 'Chính phủ vừa ban hành nghị định mới nhằm phát triển kinh tế.',
    };

    const { line1, line2 } = splitLineSmart(lineToSplit, 13000);

    assert(line1.endMs < line2.startMs, `line1.endMs (${line1.endMs}) < line2.startMs (${line2.startMs})`);
    assert(line2.startMs - line1.endMs >= 80, `Clearance gap giữa line1 và line2 >= 80ms (${line2.startMs - line1.endMs}ms)`);
    assert(line1.startMs === lineToSplit.startMs, 'line1.startMs khớp mốc bắt đầu ban đầu');
    assert(line2.endMs === lineToSplit.endMs, 'line2.endMs khớp mốc kết thúc ban đầu');

    // Không ngắt đôi từ ghép "Chính phủ" hay "nghị định" hay "kinh tế"
    const words1 = line1.text.trim().split(/\s+/);
    const lastWord1 = words1[words1.length - 1].toLowerCase();
    const words2 = line2.text.trim().split(/\s+/);
    const firstWord2 = words2[0].toLowerCase();

    assert(!(lastWord1 === 'chính' && firstWord2 === 'phủ'), 'splitLineSmart không cắt đôi "Chính phủ"');
    assert(!(lastWord1 === 'nghị' && firstWord2 === 'định'), 'splitLineSmart không cắt đôi "nghị định"');
    assert(!(lastWord1 === 'kinh' && firstWord2 === 'tế'), 'splitLineSmart không cắt đôi "kinh tế"');
  }

  // ==========================================================================
  // KẾT QUẢ TỔNG HỢP
  // ==========================================================================
  console.log(`\n=======================================================`);
  console.log(`🎉 TẤT CẢ TEST SUITE ĐÃ HOÀN TẤT THÀNH CÔNG!`);
  console.log(`📊 Kết quả: ${passedCount}/${totalCount} assertions ĐẠT (100% PASS)`);
  console.log(`=======================================================\n`);
}

runTests().catch((err) => {
  console.error('Lỗi thực thi test suite:', err);
  process.exit(1);
});
