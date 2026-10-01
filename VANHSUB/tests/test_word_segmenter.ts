import {
  segmentWordsToSubtitles,
  formatWordsText,
  wrapVisualLines,
  isCjkText,
  isCjkChar,
  countUnits,
  type SrtWord,
  type SrtLine,
} from '../main/asr/wordSegmenter';
import { serializeSrt } from '../main/lib/srt';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED]: ${message}`);
  }
}

function assertClose(actual: number, expected: number, tolerance = 10, message = '') {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`[ASSERTION FAILED]: Expected ${expected} +/- ${tolerance}, but got ${actual}. ${message}`);
  }
}

async function runTests() {
  console.log('=== TEST SUITE: WORD-LEVEL NATURAL SEGMENTATION (MILESTONE 1) ===\n');

  // =========================================================================
  // TEST SUITE 1: SILENCE PAUSE >= 350ms SPLITTING (AND UNCONDITIONAL >= 700ms)
  // =========================================================================
  console.log('[TEST 1] Kiểm tra tách phân đoạn theo khoảng lặng âm thanh (>= 350ms & >= 700ms)...');
  {
    // Cụm 1: 0 - 1200ms, sau đó khoảng lặng 400ms (>= 350ms), Cụm 2: 1600 - 2800ms
    const wordsWithPause: SrtWord[] = [
      { word: 'Hôm', startMs: 0, endMs: 300 },
      { word: 'nay', startMs: 320, endMs: 650 },
      { word: 'trời', startMs: 670, endMs: 950 },
      { word: 'đẹp', startMs: 970, endMs: 1200 },
      // Khoảng lặng: 1600 - 1200 = 400ms >= 350ms -> BẮT BUỘC NGẮT TẠI ĐÂY
      { word: 'chúng', startMs: 1600, endMs: 1900 },
      { word: 'ta', startMs: 1920, endMs: 2200 },
      { word: 'đi', startMs: 2220, endMs: 2500 },
      { word: 'chơi', startMs: 2520, endMs: 2800 },
    ];

    const lines = segmentWordsToSubtitles(wordsWithPause);
    assert(lines.length === 2, `Cần tách thành đúng 2 dòng khi có khoảng lặng 400ms, thực tế nhận ${lines.length}`);
    assert(lines[0].text === 'Hôm nay trời đẹp', `Dòng 1 sai nội dung: "${lines[0].text}"`);
    assert(lines[1].text === 'chúng ta đi chơi', `Dòng 2 sai nội dung: "${lines[1].text}"`);
    assert(lines[0].startMs === 0 && lines[0].endMs === 1200, `Timecode Dòng 1 sai: ${lines[0].startMs} - ${lines[0].endMs}`);
    assert(lines[1].startMs === 1600 && lines[1].endMs === 2800, `Timecode Dòng 2 sai: ${lines[1].startMs} - ${lines[1].endMs}`);

    // Kiểm tra khoảng lặng lớn 800ms (>= 700ms)
    const wordsWithMajorPause: SrtWord[] = [
      { word: 'Xin', startMs: 100, endMs: 400 },
      { word: 'chào', startMs: 450, endMs: 800 },
      // Khoảng lặng 800ms >= 700ms
      { word: 'các', startMs: 1600, endMs: 1900 },
      { word: 'bạn', startMs: 1950, endMs: 2300 },
    ];
    const linesMajor = segmentWordsToSubtitles(wordsWithMajorPause);
    assert(linesMajor.length === 2, `Khoảng lặng >= 700ms phải tách 2 dòng, nhận ${linesMajor.length}`);
    console.log('  -> PASS: Đã tách chính xác khi có khoảng lặng >= 350ms và >= 700ms.');
  }

  // =========================================================================
  // TEST SUITE 2: DẤU CÂU KẾT THÚC (. ? ! 。 ？ ！ …)
  // =========================================================================
  console.log('[TEST 2] Kiểm tra ngắt theo dấu câu kết thúc (. ? ! 。 ？ ！ …)...');
  {
    // Dòng 1 có 4 từ và dấu chấm, thời lượng >= 1500ms
    const wordsTerminal: SrtWord[] = [
      { word: 'Tôi', startMs: 0, endMs: 400 },
      { word: 'tên', startMs: 420, endMs: 800 },
      { word: 'là', startMs: 820, endMs: 1100 },
      { word: 'Nam.', startMs: 1120, endMs: 1600 }, // Dấu chấm, dur = 1600ms >= 1500ms & 4 từ -> Ngắt
      { word: 'Rất', startMs: 1700, endMs: 2000 },
      { word: 'vui', startMs: 2020, endMs: 2300 },
      { word: 'được', startMs: 2320, endMs: 2600 },
      { word: 'gặp', startMs: 2620, endMs: 2900 },
      { word: 'bạn!', startMs: 2920, endMs: 3300 },
    ];

    const lines = segmentWordsToSubtitles(wordsTerminal);
    assert(lines.length === 2, `Cần tách 2 dòng tại dấu chấm câu kết thúc, nhận ${lines.length}`);
    assert(lines[0].text === 'Tôi tên là Nam.', `Dòng 1 sai: "${lines[0].text}"`);
    assert(lines[1].text === 'Rất vui được gặp bạn!', `Dòng 2 sai: "${lines[1].text}"`);
    assert(lines[0].endMs === 1600, `Dòng 1 endMs phải là 1600ms, nhận ${lines[0].endMs}`);
    assert(lines[1].startMs === 1700, `Dòng 2 startMs phải là 1700ms, nhận ${lines[1].startMs}`);

    // Trường hợp câu ngắn < 1500ms và < 4 từ nhưng không có khoảng lặng lớn: không băm vụn
    const shortUtterance: SrtWord[] = [
      { word: 'Đợi', startMs: 0, endMs: 250 },
      { word: 'đã!', startMs: 270, endMs: 500 }, // Dấu than nhưng mới 500ms và 2 từ
      { word: 'Đừng', startMs: 550, endMs: 800 },
      { word: 'đi.', startMs: 820, endMs: 1100 },
    ];
    const linesShort = segmentWordsToSubtitles(shortUtterance);
    // Vì 'Đợi đã!' chỉ 500ms (< 1500ms) và 2 từ (< 4 từ) với khoảng lặng 50ms, nó được giữ chung thành câu tự nhiên
    assert(linesShort.length === 1, `Không băm vụn câu ngắn dưới 1.5s và dưới 4 từ nếu không có khoảng lặng, nhận ${linesShort.length}`);
    console.log('  -> PASS: Đã tách câu chính xác theo dấu câu kết thúc và giữ ngữ cảnh câu ngắn.');
  }

  // =========================================================================
  // TEST SUITE 3: DẤU NGẮT VẾ CÂU (, ; : ， ； ： 、)
  // =========================================================================
  console.log('[TEST 3] Kiểm tra ngắt theo dấu ngắt vế (, ; : ， ； ： 、)...');
  {
    // Vế 1: 6 từ, thời lượng 2200ms (>= 2000ms), kết thúc bằng dấu phẩy
    const wordsClause: SrtWord[] = [
      { word: 'Nếu', startMs: 0, endMs: 300 },
      { word: 'bạn', startMs: 320, endMs: 600 },
      { word: 'muốn', startMs: 620, endMs: 950 },
      { word: 'học', startMs: 970, endMs: 1300 },
      { word: 'tiếng', startMs: 1320, endMs: 1700 },
      { word: 'Anh,', startMs: 1720, endMs: 2200 }, // Dấu phẩy, dur = 2200ms >= 2000ms & 6 từ -> Ngắt
      { word: 'hãy', startMs: 2300, endMs: 2600 },
      { word: 'chăm', startMs: 2620, endMs: 2900 },
      { word: 'chỉ', startMs: 2920, endMs: 3200 },
      { word: 'luyện', startMs: 3220, endMs: 3500 },
      { word: 'tập', startMs: 3520, endMs: 3800 },
      { word: 'hàng', startMs: 3820, endMs: 4100 },
      { word: 'ngày.', startMs: 4120, endMs: 4400 },
    ];

    const lines = segmentWordsToSubtitles(wordsClause);
    assert(lines.length === 2, `Cần tách 2 vế tại dấu phẩy đủ điều kiện duration/words, nhận ${lines.length}`);
    assert(lines[0].text === 'Nếu bạn muốn học tiếng Anh,', `Vế 1 sai: "${lines[0].text}"`);
    assert(lines[1].text === 'hãy chăm chỉ luyện tập hàng ngày.', `Vế 2 sai: "${lines[1].text}"`);
    console.log('  -> PASS: Đã tách vế câu tự nhiên theo dấu phẩy và độ dài chuẩn.');
  }

  // =========================================================================
  // TEST SUITE 4: GIỚI HẠN THỜI LƯỢNG LÝ TƯỞNG (2-5s) VÀ TRẦN CỨNG 6.0s
  // =========================================================================
  console.log('[TEST 4] Kiểm tra giới hạn thời lượng lý tưởng và trần cứng 6.0s...');
  {
    // Tạo chuỗi 15 từ nói liên tục không có dấu câu, tổng thời lượng 7.5s
    // Mỗi từ kéo dài 450ms, khoảng cách 50ms -> mỗi từ tốn 500ms
    const continuousWords: SrtWord[] = [];
    for (let i = 0; i < 15; i++) {
      continuousWords.push({
        word: `từ${i + 1}`,
        startMs: i * 500,
        endMs: i * 500 + 450,
      });
    }

    const lines = segmentWordsToSubtitles(continuousWords);
    // Tổng 7.5s, trần cứng 6.0s và ideal max 5.0s -> Phải tách thành ít nhất 2 phân đoạn
    assert(lines.length >= 2, `Chuỗi 7.5s liên tục phải tách thành >= 2 phân đoạn, nhận ${lines.length}`);

    // Đảm bảo KHÔNG CÓ PHÂN ĐOẠN NÀO vượt quá trần cứng 6.0s
    for (let i = 0; i < lines.length; i++) {
      const dur = lines[i].endMs - lines[i].startMs;
      assert(dur <= 6000, `Phân đoạn ${i + 1} vượt quá trần cứng 6.0s (thực tế: ${dur}ms)`);
      assert(dur >= 1000, `Phân đoạn ${i + 1} quá ngắn: ${dur}ms`);
    }
    console.log(`  -> PASS: Chuỗi 7.5s được phân bổ thành ${lines.length} phân đoạn đều <= 6.0s.`);
  }

  // =========================================================================
  // TEST SUITE 5: ĐỘ CHÍNH XÁC TIMECODE (EXACT STARTMS/ENDMS & KHÔNG CÓ GAP NHÂN TẠO)
  // =========================================================================
  console.log('[TEST 5] Kiểm tra độ chính xác tuyệt đối của startMs và endMs (zero artificial gap)...');
  {
    const sampleWords: SrtWord[] = [
      { word: 'Một', startMs: 1234, endMs: 1567 },
      { word: 'hai', startMs: 1580, endMs: 1890 },
      { word: 'ba.', startMs: 1900, endMs: 2345 },
      // gap = 2800 - 2345 = 455ms >= 350ms
      { word: 'Bốn', startMs: 2800, endMs: 3100 },
      { word: 'năm.', startMs: 3120, endMs: 3678 },
    ];

    const lines = segmentWordsToSubtitles(sampleWords);
    assert(lines.length === 2, `Cần tách 2 dòng, nhận ${lines.length}`);

    // Dòng 1: startMs phải chính xác là từ đầu tiên (1234ms), endMs là từ cuối cùng (2345ms)
    assert(lines[0].startMs === 1234, `lines[0].startMs phải là 1234, nhận ${lines[0].startMs}`);
    assert(lines[0].endMs === 2345, `lines[0].endMs phải là 2345, nhận ${lines[0].endMs}`);

    // Dòng 2: startMs phải chính xác là 2800ms, endMs là 3678ms
    assert(lines[1].startMs === 2800, `lines[1].startMs phải là 2800, nhận ${lines[1].startMs}`);
    assert(lines[1].endMs === 3678, `lines[1].endMs phải là 3678, nhận ${lines[1].endMs}`);

    // Kiểm tra không có bất kỳ khoảng hở nhân tạo 80ms nào bị chèn hay trôi dạt timecode
    const actualAcousticGap = lines[1].startMs - lines[0].endMs;
    assert(actualAcousticGap === 455, `Khoảng trống giữa 2 dòng phụ đề phải đúng bằng khoảng lặng âm thanh gốc (455ms), thực tế ${actualAcousticGap}ms`);
    console.log('  -> PASS: Timecode chính xác 100%, bảo toàn nguyên vẹn âm thanh gốc.');
  }

  // =========================================================================
  // TEST SUITE 6: VĂN BẢN CJK (TIẾNG TRUNG / TIẾNG NHẬT - GHÉP LIỀN KHÔNG CÁCH)
  // =========================================================================
  console.log('[TEST 6] Kiểm tra xử lý văn bản CJK (Trung/Nhật ghép liền không cách)...');
  {
    // Từ CJK tiếng Trung
    const cjkWords: SrtWord[] = [
      { word: '你', startMs: 100, endMs: 300 },
      { word: '好', startMs: 320, endMs: 550 },
      { word: '，', startMs: 560, endMs: 700 },
      { word: '世', startMs: 720, endMs: 950 },
      { word: '界', startMs: 970, endMs: 1200 },
      { word: '。', startMs: 1210, endMs: 1350 },
      // Khoảng lặng 600ms >= 350ms
      { word: '欢', startMs: 1950, endMs: 2200 },
      { word: '迎', startMs: 2220, endMs: 2500 },
      { word: '光', startMs: 2520, endMs: 2800 },
      { word: '临', startMs: 2820, endMs: 3100 },
      { word: '！', startMs: 3110, endMs: 3250 },
    ];

    const lines = segmentWordsToSubtitles(cjkWords);
    assert(lines.length === 2, `CJK cần tách 2 dòng, nhận ${lines.length}`);
    assert(lines[0].text === '你好，世界。', `CJK dòng 1 sai quy tắc spaceless: "${lines[0].text}"`);
    assert(lines[1].text === '欢迎光临！', `CJK dòng 2 sai quy tắc spaceless: "${lines[1].text}"`);

    // Kiểm tra helper formatWordsText
    const testCjkJoined = formatWordsText([
      { word: '微', startMs: 0, endMs: 100 },
      { word: '信', startMs: 100, endMs: 200 },
      { word: '支', startMs: 200, endMs: 300 },
      { word: '付', startMs: 300, endMs: 400 },
    ]);
    assert(testCjkJoined === '微信支付', `CJK phải ghép liền không khoảng trắng, nhận "${testCjkJoined}"`);
    console.log('  -> PASS: Văn bản CJK ghép liền không khoảng trắng chính xác.');
  }

  // =========================================================================
  // TEST SUITE 7: ĐỔI NGƯỜI NÓI (SPEAKER DIARIZATION TRANSITION)
  // =========================================================================
  console.log('[TEST 7] Kiểm tra tách phân đoạn ngay lập tức khi đổi người nói (Diarization)...');
  {
    const dialogWords: SrtWord[] = [
      { word: 'Anh', startMs: 0, endMs: 250, speaker: 'SPEAKER_00' },
      { word: 'có', startMs: 260, endMs: 450, speaker: 'SPEAKER_00' },
      { word: 'khỏe', startMs: 460, endMs: 700, speaker: 'SPEAKER_00' },
      { word: 'không?', startMs: 710, endMs: 1000, speaker: 'SPEAKER_00' },
      // Người nói đổi sang SPEAKER_01 ngay sau 100ms
      { word: 'Tôi', startMs: 1100, endMs: 1350, speaker: 'SPEAKER_01' },
      { word: 'rất', startMs: 1360, endMs: 1550, speaker: 'SPEAKER_01' },
      { word: 'khỏe,', startMs: 1560, endMs: 1800, speaker: 'SPEAKER_01' },
      { word: 'cảm', startMs: 1810, endMs: 2000, speaker: 'SPEAKER_01' },
      { word: 'ơn.', startMs: 2010, endMs: 2300, speaker: 'SPEAKER_01' },
    ];

    const lines = segmentWordsToSubtitles(dialogWords);
    assert(lines.length === 2, `Đổi người nói phải tách thành 2 dòng riêng biệt, nhận ${lines.length}`);
    assert(lines[0].speaker === 'SPEAKER_00', `Dòng 1 sai speaker: ${lines[0].speaker}`);
    assert(lines[1].speaker === 'SPEAKER_01', `Dòng 2 sai speaker: ${lines[1].speaker}`);
    assert(lines[0].text === 'Anh có khỏe không?', `Dòng 1 text sai: "${lines[0].text}"`);
    assert(lines[1].text === 'Tôi rất khỏe, cảm ơn.', `Dòng 2 text sai: "${lines[1].text}"`);

    // Kiểm tra tuần tự hóa SRT có gắn nhãn speaker
    const srtContent = serializeSrt(lines);
    assert(srtContent.includes('[SPEAKER_00]: Anh có khỏe không?'), 'SRT thiếu tiền tố [SPEAKER_00]');
    assert(srtContent.includes('[SPEAKER_01]: Tôi rất khỏe, cảm ơn.'), 'SRT thiếu tiền tố [SPEAKER_01]');
    console.log('  -> PASS: Đã tách phân đoạn và gắn nhãn người nói hoàn hảo.');
  }

  // =========================================================================
  // TEST SUITE 8: NGẮT DÒNG HIỂN THỊ THUẦN TÚY (\n, <= 37 CHARS/LINE)
  // =========================================================================
  console.log('[TEST 8] Kiểm tra ngắt dòng hiển thị (Visual line wrapping <= 37 chars/line)...');
  {
    // Câu dài 65 ký tự, thời lượng 4s (hợp lệ cho 1 câu phụ đề tự nhiên)
    const longWords: SrtWord[] = [
      { word: 'Chào', startMs: 0, endMs: 300 },
      { word: 'mừng', startMs: 310, endMs: 600 },
      { word: 'tất', startMs: 610, endMs: 850 },
      { word: 'cả', startMs: 860, endMs: 1050 },
      { word: 'các', startMs: 1060, endMs: 1250 },
      { word: 'bạn', startMs: 1260, endMs: 1500 },
      { word: 'đã', startMs: 1510, endMs: 1750 },
      { word: 'đến', startMs: 1760, endMs: 2000 },
      { word: 'với', startMs: 2010, endMs: 2250 },
      { word: 'kênh', startMs: 2260, endMs: 2500 },
      { word: 'chia', startMs: 2510, endMs: 2750 },
      { word: 'sẻ', startMs: 2760, endMs: 3000 },
      { word: 'kiến', startMs: 3010, endMs: 3300 },
      { word: 'thức', startMs: 3310, endMs: 3600 },
      { word: 'này.', startMs: 3610, endMs: 3950 },
    ];

    const lines = segmentWordsToSubtitles(longWords, { enableVisualWrap: true, maxCharsPerLine: 37 });
    assert(lines.length === 1, `Câu 3.95s không bị xé vụn timecode, vẫn là 1 khối phụ đề, nhận ${lines.length}`);
    assert(lines[0].text.includes('\n'), `Câu dài 65 ký tự phải chứa dấu xuống dòng \\n, nhận "${lines[0].text}"`);

    const sublines = lines[0].text.split('\n');
    for (const subl of sublines) {
      assert(subl.length <= 37, `Dòng hiển thị vượt quá 37 ký tự (${subl.length} chars): "${subl}"`);
    }
    assert(lines[0].startMs === 0 && lines[0].endMs === 3950, 'Timecode của khối dài được bảo toàn nguyên vẹn');
    console.log('  -> PASS: Ngắt dòng hiển thị \\n hoạt động hoàn hảo, không băm timecode.');
  }

  // =========================================================================
  // TEST SUITE 9: CÁC TRƯỜNG HỢP BIÊN VÀ DỮ LIỆU DỊ THƯỜNG (EDGE CASES)
  // =========================================================================
  console.log('[TEST 9] Kiểm tra các trường hợp biên & edge cases...');
  {
    // Mảng rỗng
    const emptyRes = segmentWordsToSubtitles([]);
    assert(emptyRes.length === 0, 'Mảng từ rỗng phải trả về []');

    // 1 từ đơn lẻ
    const singleRes = segmentWordsToSubtitles([{ word: 'Alo', startMs: 100, endMs: 400 }]);
    assert(singleRes.length === 1, '1 từ phải trả về 1 dòng');
    assert(singleRes[0].startMs === 100 && singleRes[0].endMs === 400, 'Timecode 1 từ khớp');

    // 1 từ siêu dài 7 giây (ca sĩ ngân giọng)
    const longSingle = segmentWordsToSubtitles([{ word: 'Aaaa', startMs: 0, endMs: 7000 }]);
    assert(longSingle.length === 1, '1 từ đơn dài không bị crash hay loop vô tận');
    assert(longSingle[0].endMs === 7000, 'EndMs 1 từ dài được bảo toàn');

    // Dữ liệu thời gian bị đảo ngược hoặc lỗi (endMs <= startMs)
    const invertedRes = segmentWordsToSubtitles([
      { word: 'Từ', startMs: 500, endMs: 400 },
      { word: 'một', startMs: 600, endMs: 600 },
    ]);
    assert(invertedRes.length === 1, 'Dữ liệu dị thường được tự động hiệu chỉnh');
    assert(invertedRes[0].endMs > invertedRes[0].startMs, 'endMs được đảm bảo lớn hơn startMs');
    console.log('  -> PASS: Tất cả các edge cases đều được xử lý an toàn.');
  }

  console.log('\n=============================================================');
  console.log('=== TẤT CẢ 9 BỘ KIỂM THỬ WORD SEGMENTER ĐÃ VƯỢT QUA 100%! ===');
  console.log('=============================================================\n');
}

runTests().catch((err) => {
  console.error('\n[LỖI TEST]:', err);
  process.exit(1);
});
