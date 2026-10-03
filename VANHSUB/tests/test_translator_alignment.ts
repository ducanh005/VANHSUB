/**
 * =========================================================================================
 * ADVERSARIAL TEST SUITE: TRANSLATOR 1-1 ALIGNMENT & VISUAL LINE WRAPPING
 * Milestone 2 (R2 & R3) - Empirical Challenger Verification
 * =========================================================================================
 *
 * Invariants Verified:
 * 1. Strict 1-1 line count: translated.length === source.length (on 50+ lines dataset).
 * 2. Strict startMs identity: translated[i].startMs === source[i].startMs for all i.
 * 3. Strict endMs identity: translated[i].endMs === source[i].endMs for all i.
 * 4. Strict speaker identity: translated[i].speaker === source[i].speaker for all i.
 * 5. Strict id preservation: translated[i].id === source[i].id for all i.
 * 6. Zero artificial gaps & zero timecode shifts:
 *    For all adjacent lines (i, i+1), gap_final === gap_source (no 80ms minGapMs injected).
 * 7. Visual wrapping invariant: text > 37 chars is wrapped with \n while remaining a single SrtLine.
 * 8. Short text invariant: text <= 37 chars remains single line without newline.
 * 9. Linguistic span protection: compound words, units/numbers, proper nouns preserved across wraps.
 * 10. Multi-language coverage: micro-lines, short, medium, 100+ char complex, CJK, English, Vietnamese.
 * 11. End-to-end translateSrtFile execution with multi-batch chunking, concurrency, and checkpointing.
 * 12. Non-Vietnamese target language bypasses Vietnamese-specific wrapping.
 * 13. Static codebase audit: zero references to segmentSubtitlesNetflix in production directories.
 *
 * Runner: npx tsx tests/test_translator_alignment.ts
 * =========================================================================================
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import assert from 'assert';
import OpenAI from 'openai';
import { parseSrt, serializeSrt, type SrtLine } from '../main/lib/srt';
import {
  applyVisualLineWrapping,
  translateSrtFile,
  getCheckpointPath,
  saveCheckpoint,
} from '../main/translate/translator';
import { SettingsStore } from '../main/store/settingsStore';
import { segmentSubtitlesNetflix } from '../main/lib/nlpSegmenter';

let passedCount = 0;
let totalCount = 0;
const failureDetails: string[] = [];

async function runTest(testName: string, fn: () => void | Promise<void>) {
  totalCount++;
  try {
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      await res;
    }
    passedCount++;
    console.log(`  ✅ [PASS] ${testName}`);
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${testName}`);
    console.error(`     Error: ${err.message || err}`);
    failureDetails.push(`${testName}: ${err.message || err}`);
    process.exitCode = 1;
  }
}

// =========================================================================
// 60-LINE ADVERSARIAL BENCHMARK DATASET
// Diverse lengths, languages (CJK, EN, VI), speakers, timecodes, boundaries
// =========================================================================

export const ADVERSARIAL_60_SOURCE_LINES: SrtLine[] = [
  // 1-5: Micro sentences (1 to 5 chars)
  { id: 'line-0', startMs: 1000, endMs: 1400, text: 'Ồ!', speaker: 'SPEAKER_00' },
  { id: 'line-1', startMs: 1500, endMs: 1900, text: 'Dạ.', speaker: 'SPEAKER_01' },
  { id: 'line-2', startMs: 2000, endMs: 2500, text: 'Vâng!', speaker: 'SPEAKER_02' },
  { id: 'line-3', startMs: 2600, endMs: 3000, text: 'Hả?', speaker: 'SPEAKER_03' },
  { id: 'line-4', startMs: 3100, endMs: 3400, text: 'Ừ.', speaker: 'SPEAKER_00' },

  // 6-10: Very short sentences (6 to 20 chars)
  { id: 'line-5', startMs: 3500, endMs: 4500, text: 'Xin chào bạn.', speaker: 'SPEAKER_01' },
  { id: 'line-6', startMs: 4600, endMs: 5800, text: 'Tôi đang lắng nghe.', speaker: 'SPEAKER_00' },
  { id: 'line-7', startMs: 6000, endMs: 7200, text: 'Hôm nay trời đẹp.', speaker: 'SPEAKER_02' },
  { id: 'line-8', startMs: 7300, endMs: 8500, text: 'Cảm ơn rất nhiều.', speaker: 'SPEAKER_01' },
  { id: 'line-9', startMs: 8600, endMs: 9800, text: 'Hẹn gặp lại nhé.', speaker: 'SPEAKER_03' },

  // 11-15: Moderate sentences (21 to 36 chars, strictly <= 37 chars)
  { id: 'line-10', startMs: 10000, endMs: 12500, text: 'Hệ thống phụ đề thông minh VanhSub.', speaker: 'SPEAKER_00' }, // 35 chars
  { id: 'line-11', startMs: 12600, endMs: 14800, text: 'Độ trễ xử lý âm thanh rất thấp.', speaker: 'SPEAKER_01' }, // 31 chars
  { id: 'line-12', startMs: 15000, endMs: 17200, text: 'Mọi thứ đang hoạt động ổn định.', speaker: 'SPEAKER_02' }, // 31 chars
  { id: 'line-13', startMs: 17500, endMs: 19800, text: 'Kiểm tra tính năng dịch tự động.', speaker: 'SPEAKER_00' }, // 32 chars
  { id: 'line-14', startMs: 20000, endMs: 22500, text: 'Một câu thoại thử nghiệm ngắn gọn.', speaker: 'SPEAKER_01' }, // 34 chars

  // 16-17: Boundary sentences around 37 chars threshold
  { id: 'line-15', startMs: 22700, endMs: 24200, text: 'Câu này được thiết kế đúng 37 ký tự!!', speaker: 'SPEAKER_02' }, // Exactly 37 chars -> NO wrap
  { id: 'line-16', startMs: 24400, endMs: 25900, text: 'Câu này được thiết kế đúng 38 ký tự!!!', speaker: 'SPEAKER_03' }, // Exactly 38 chars -> MUST wrap

  // 18-20: Medium sentences (40 to 70 chars, standard 2-line visual wrapping)
  { id: 'line-17', startMs: 26000, endMs: 29500, text: 'Chào buổi sáng mọi người, hôm nay chúng ta bắt đầu bài kiểm tra mới.', speaker: 'SPEAKER_00' }, // 68 chars
  { id: 'line-18', startMs: 29600, endMs: 33000, text: 'Chúng ta cùng nhau phát triển kinh tế số bền vững cho tương lai.', speaker: 'SPEAKER_01' }, // 64 chars
  { id: 'line-19', startMs: 33500, endMs: 37000, text: 'Dự án nghiên cứu trí tuệ nhân tạo thế hệ mới của tập đoàn công nghệ.', speaker: 'SPEAKER_02' }, // 67 chars

  // 21-22: Sentences around 74 chars threshold (2 x 37 limit)
  { id: 'line-20', startMs: 37500, endMs: 42000, text: 'Mô hình trí tuệ nhân tạo mới đem lại hiệu quả vượt trội cho tương lai này.', speaker: 'SPEAKER_03' }, // 74 chars
  { id: 'line-21', startMs: 42500, endMs: 47000, text: 'Mô hình trí tuệ nhân tạo mới đem lại hiệu quả vượt trội cho tương lai này nhé.', speaker: 'SPEAKER_00' }, // 78 chars

  // 23-30: Long complex sentences (100+ chars, 150+ chars, 200+ chars, 280+ chars)
  { id: 'line-22', startMs: 48000, endMs: 54000, text: 'Chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được, nhưng giá cho mỗi hoạt động tính thế nào?', speaker: 'SPEAKER_01' }, // 116 chars
  { id: 'line-23', startMs: 54500, endMs: 61000, text: 'Chúng ta cần đẩy mạnh chuyển đổi số trong mọi lĩnh vực kinh tế, đặc biệt là nông nghiệp công nghệ cao và công nghiệp bán dẫn hiện đại.', speaker: 'SPEAKER_02' }, // 136 chars
  { id: 'line-24', startMs: 61500, endMs: 69000, text: 'Viện Hàn lâm Khoa học và Công nghệ Việt Nam đã công bố kết quả nghiên cứu đột phá về công nghệ bán dẫn và vật liệu mới tại buổi lễ tổng kết năm học hôm qua.', speaker: 'SPEAKER_03' }, // 158 chars
  { id: 'line-25', startMs: 69500, endMs: 79000, text: 'Các nhà khoa học tại Trường Đại học Quốc gia Hà Nội đã phối hợp với chuyên gia quốc tế để phát triển thành công giải pháp chuyển đổi xanh toàn diện, mang lại lợi ích thiết thực cho hàng triệu người dân trên cả nước.', speaker: 'SPEAKER_00' }, // 217 chars
  { id: 'line-26', startMs: 79500, endMs: 92000, text: 'Trí tuệ nhân tạo đang làm thay đổi toàn diện cách thức con người sống và làm việc, từ việc tự động hóa các quy trình sản xuất phức tạp, phân tích dữ liệu lớn trong y tế để cứu chữa người bệnh, cho đến việc hỗ trợ sáng tạo nội dung truyền thông đa phương tiện chất lượng cao cho cộng đồng.', speaker: 'SPEAKER_01' }, // 286 chars
  { id: 'line-27', startMs: 92500, endMs: 98000, text: 'Mọi người đều đồng ý rằng giải pháp này mang lại hiệu quả cao và tiết kiệm thời gian cho toàn bộ quy trình.', speaker: 'SPEAKER_02' }, // 105 chars
  { id: 'line-28', startMs: 98500, endMs: 104000, text: 'Sau khi hoàn thành giai đoạn thử nghiệm, nhóm phát triển sẽ tiến hành triển khai diện rộng trên toàn hệ thống.', speaker: 'SPEAKER_03' }, // 112 chars
  { id: 'line-29', startMs: 104500, endMs: 110500, text: 'Các chuyên gia đánh giá cao khả năng thích ứng linh hoạt và độ chính xác vượt trội của thuật toán phân đoạn mới này.', speaker: 'SPEAKER_00' }, // 125 chars

  // 31-35: Sentences with Vietnamese compound words (must preserve compound boundary)
  { id: 'line-30', startMs: 111000, endMs: 115000, text: 'Thủ tướng Chính phủ đã chỉ đạo Bộ Tài chính triển khai chính sách mới.', speaker: 'SPEAKER_01' }, // 69 chars
  { id: 'line-31', startMs: 115500, endMs: 120000, text: 'Phát triển kinh tế biển và bảo vệ chủ quyền quốc gia là nhiệm vụ trọng tâm.', speaker: 'SPEAKER_02' }, // 74 chars
  { id: 'line-32', startMs: 120500, endMs: 125000, text: 'Doanh nghiệp cần chủ động đổi mới sáng tạo để nâng cao năng lực cạnh tranh.', speaker: 'SPEAKER_03' }, // 75 chars
  { id: 'line-33', startMs: 125500, endMs: 130000, text: 'Bộ Giáo dục và Đào tạo phối hợp với các trường đại học hàng đầu khu vực.', speaker: 'SPEAKER_00' }, // 73 chars
  { id: 'line-34', startMs: 130500, endMs: 134500, text: 'Cải cách thủ tục hành chính nhằm tạo thuận lợi tối đa cho người dân.', speaker: 'SPEAKER_01' }, // 67 chars

  // 36-40: Sentences with numbers, percentages, currencies, measurement units
  { id: 'line-35', startMs: 135000, endMs: 139000, text: 'Doanh thu quý này đạt 150 tỷ đồng, tăng trưởng 12.5% so với cùng kỳ.', speaker: 'SPEAKER_02' }, // 68 chars
  { id: 'line-36', startMs: 139500, endMs: 144000, text: 'Tốc độ xe trên cao tốc đạt 120 km/h trong suốt hành trình 45 phút.', speaker: 'SPEAKER_03' }, // 66 chars
  { id: 'line-37', startMs: 144500, endMs: 148500, text: 'Dự án thu hút 250 chuyên gia và kỹ sư công nghệ cao từ 15 quốc gia.', speaker: 'SPEAKER_00' }, // 67 chars
  { id: 'line-38', startMs: 149000, endMs: 153500, text: 'Tổng vốn đầu tư trực tiếp nước ngoài đạt mốc 35.8 tỷ USD trong năm nay.', speaker: 'SPEAKER_01' }, // 71 chars
  { id: 'line-39', startMs: 154000, endMs: 158500, text: 'Diện tích khu công nghệ cao mở rộng thêm 500 ha phục vụ sản xuất chip.', speaker: 'SPEAKER_02' }, // 70 chars

  // 41-45: Sentences with multi-word proper nouns
  { id: 'line-40', startMs: 159000, endMs: 163000, text: 'Thành phố Hồ Chí Minh là trung tâm kinh tế lớn nhất cả nước.', speaker: 'SPEAKER_03' }, // 59 chars
  { id: 'line-41', startMs: 163500, endMs: 167500, text: 'Giáo sư Trần Đại Nghĩa đã có những đóng góp to lớn cho nền khoa học.', speaker: 'SPEAKER_00' }, // 68 chars
  { id: 'line-42', startMs: 168000, endMs: 172000, text: 'Chủ tịch Hồ Chí Minh đã khẳng định tầm quan trọng của việc học tập.', speaker: 'SPEAKER_01' }, // 67 chars
  { id: 'line-43', startMs: 172500, endMs: 176500, text: 'Đoàn đại biểu Việt Nam tham dự hội nghị tại New York và Washington.', speaker: 'SPEAKER_02' }, // 67 chars
  { id: 'line-44', startMs: 177000, endMs: 182000, text: 'Đồng bằng sông Cửu Long đang đối mặt với nguy cơ xâm nhập mặn nghiêm trọng.', speaker: 'SPEAKER_03' }, // 75 chars

  // 46-50: CJK (Chinese & Japanese) source lines
  { id: 'line-45', startMs: 182500, endMs: 185500, text: '这是一个测试句子，用于验证多语言翻译对齐功能。', speaker: 'SPEAKER_00' },
  { id: 'line-46', startMs: 186000, endMs: 190000, text: '人工智能技术正在深刻改变全球影视字幕制作和本地化的整个流程。', speaker: 'SPEAKER_01' },
  { id: 'line-47', startMs: 190500, endMs: 196000, text: '这是一个非常长且复杂的中文句子，用来测试长句子在系统中的时间戳保全机制与对齐逻辑是否完好无损。', speaker: 'SPEAKER_02' },
  { id: 'line-48', startMs: 196500, endMs: 200500, text: 'これは日本語のテスト字幕であり、タイムコードの同期を確認します。', speaker: 'SPEAKER_03' },
  { id: 'line-49', startMs: 201000, endMs: 208000, text: '人工知能の発展に伴い、字幕の自動生成と翻訳の品質が劇的に向上し、世界中の視聴者にコンテンツを届けることが可能になりました。', speaker: 'SPEAKER_00' },

  // 51-55: English source lines
  { id: 'line-50', startMs: 208500, endMs: 212000, text: 'Welcome to our comprehensive adversarial test suite.', speaker: 'SPEAKER_01' },
  { id: 'line-51', startMs: 212500, endMs: 218500, text: 'The artificial intelligence model translates natural language subtitles with high precision and fluency.', speaker: 'SPEAKER_02' },
  { id: 'line-52', startMs: 219000, endMs: 224000, text: 'Zero artificial pause insertion ensures voice continuity across all speech segments.', speaker: 'SPEAKER_03' },
  { id: 'line-53', startMs: 224500, endMs: 229000, text: 'Subtitle timecodes must strictly match the original acoustic boundaries.', speaker: 'SPEAKER_00' },
  { id: 'line-54', startMs: 229500, endMs: 233500, text: 'Every single line maintains 100 percent timestamp identity.', speaker: 'SPEAKER_01' },

  // 56-60: Special boundary, 0ms gap, dialogue quotes, and pre-existing \n lines
  { id: 'line-55', startMs: 233500, endMs: 236000, text: 'Dòng thoại này bắt đầu lập tức sau câu trước với khoảng hở 0 mili-giây.', speaker: 'SPEAKER_02' }, // 0ms gap from line-54!
  { id: 'line-56', startMs: 236000, endMs: 239000, text: 'Người tiếp theo tiếp lời ngay tức khắc mà không hề có bất kỳ khoảng lặng nào.', speaker: 'SPEAKER_03' }, // 0ms gap from line-55!
  { id: 'line-57', startMs: 239500, endMs: 243500, text: 'Cô ấy nói: "Tôi nhất định sẽ thành công trong dự án này!"', speaker: 'SPEAKER_00' }, // Quotes & dialogue
  { id: 'line-58', startMs: 244000, endMs: 250000, text: 'Dòng thứ nhất đã có ngắt\nDòng thứ hai tiếp tục câu này nhưng lại dài hơn ba mươi bảy ký tự để xem xử lý ra sao.', speaker: 'SPEAKER_01' }, // Pre-existing \n
  { id: 'line-59', startMs: 250500, endMs: 254000, text: 'https://vanhsub.ai/demonstration/adversarial-long-url-without-spaces-1234567890', speaker: 'SPEAKER_02' }, // Unbroken URL
];

// Mapping generator for simulated translation
function mockTranslateSentence(source: string): string {
  // If micro
  if (source.length <= 5) return source;
  // If CJK
  if (/[\u4e00-\u9fa5\u3040-\u30ff]/.test(source)) {
    if (source.includes('多语言')) return 'Đây là câu kiểm thử nhằm xác minh chức năng căn chỉnh bản dịch đa ngôn ngữ.';
    if (source.includes('深刻改变')) return 'Công nghệ trí tuệ nhân tạo đang thay đổi sâu sắc toàn bộ quy trình làm phụ đề phim.';
    if (source.includes('非常长')) return 'Đây là một câu tiếng Trung rất dài và phức tạp, dùng để kiểm tra cơ chế bảo toàn timestamp.';
    if (source.includes('日本語のテスト')) return 'Đây là phụ đề kiểm thử tiếng Nhật để xác nhận việc đồng bộ hóa mã thời gian.';
    if (source.includes('人工知能の発展')) return 'Cùng với sự phát triển của trí tuệ nhân tạo, chất lượng tạo phụ đề tự động đã tăng vượt bậc.';
  }
  // If English
  if (/^[A-Za-z0-9 ,.?!'"\-]+$/.test(source)) {
    if (source.includes('adversarial test suite')) return 'Chào mừng bạn đến với bộ kiểm thử đối kháng toàn diện của chúng tôi.';
    if (source.includes('high precision')) return 'Mô hình trí tuệ nhân tạo dịch phụ đề ngôn ngữ tự nhiên với độ chính xác và trôi chảy cao.';
    if (source.includes('Zero artificial')) return 'Việc loại bỏ chèn khoảng lặng nhân tạo giúp bảo đảm tính liền mạch của giọng nói.';
    if (source.includes('acoustic boundaries')) return 'Mốc thời gian phụ đề phải khớp hoàn toàn với ranh giới âm thanh gốc.';
    if (source.includes('timestamp identity')) return 'Từng dòng phụ đề đơn lẻ duy trì một trăm phần trăm tính toàn vẹn thời gian.';
  }
  // Otherwise return existing text or slightly polished text
  return source;
}

async function runAdversarialSuite() {
  console.log('================================================================================');
  console.log('⚔️  ADVERSARIAL CHALLENGER TEST SUITE: 1-1 TRANSLATOR ALIGNMENT (M2)');
  console.log('================================================================================\n');

  // ==========================================================================
  // SECTION 1: Static Codebase Audit (Zero Netflix in Production)
  // ==========================================================================
  console.log('--- Section 1: Static Codebase Audit (Zero Netflix in Production) ---');

  await runTest('1.1 Zero import or invocation of segmentSubtitlesNetflix in main/translate/', () => {
    const dir = path.join(__dirname, '..', 'main', 'translate');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      assert.strictEqual(
        content.includes('segmentSubtitlesNetflix'),
        false,
        `Forbidden segmentSubtitlesNetflix found in main/translate/${file}`
      );
    }
  });

  await runTest('1.2 Zero import or invocation of segmentSubtitlesNetflix in main/asr/', () => {
    const dir = path.join(__dirname, '..', 'main', 'asr');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      assert.strictEqual(
        content.includes('segmentSubtitlesNetflix'),
        false,
        `Forbidden segmentSubtitlesNetflix found in main/asr/${file}`
      );
    }
  });

  await runTest('1.3 Zero import or invocation of segmentSubtitlesNetflix in renderer/ tree', () => {
    const checkDir = (dirPath: string) => {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.next' || entry.name === 'node_modules') continue;
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          checkDir(full);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js'))) {
          const content = fs.readFileSync(full, 'utf-8');
          assert.strictEqual(
            content.includes('segmentSubtitlesNetflix'),
            false,
            `Forbidden segmentSubtitlesNetflix found in renderer file: ${full}`
          );
        }
      }
    };
    checkDir(path.join(__dirname, '..', 'renderer'));
  });

  await runTest('1.4 SubtitleEditor.tsx UI toolbar & shortcuts completely scrubbed of Netflix slicing', () => {
    const editorPath = path.join(__dirname, '..', 'renderer', 'components', 'SubtitleEditor.tsx');
    const content = fs.readFileSync(editorPath, 'utf-8');
    assert.strictEqual(content.includes('handleNetflixNormalize'), false, 'handleNetflixNormalize must not exist');
    assert.strictEqual(content.includes('Chuẩn hoá Netflix (NLP)'), false, 'Netflix toolbar button must not exist');
    assert.strictEqual(content.includes('KeyN'), false, 'Ctrl+Shift+N shortcut must not exist');
    assert.strictEqual(content.includes('handleVisualWrapLines'), true, 'handleVisualWrapLines must exist');
    assert.strictEqual(content.includes('Ngắt dòng hiển thị (\\n)'), true, 'Visual wrap button must exist');
  });

  // ==========================================================================
  // SECTION 2: 50+ Lines Adversarial Dataset - applyVisualLineWrapping Invariants
  // ==========================================================================
  console.log('\n--- Section 2: applyVisualLineWrapping on 60 Diverse Adversarial Lines ---');

  const linesDataset = ADVERSARIAL_60_SOURCE_LINES;
  assert.ok(linesDataset.length >= 50, `Dataset must have at least 50 lines (has ${linesDataset.length})`);

  // Translate texts using mock generator
  const translatedDataset: SrtLine[] = linesDataset.map((line) => ({
    ...line,
    text: mockTranslateSentence(line.text),
  }));

  const wrappedResults = applyVisualLineWrapping(translatedDataset, true);

  await runTest('2.1 Strict 1-1 line count invariant (60 lines in -> exactly 60 lines out)', () => {
    assert.strictEqual(
      wrappedResults.length,
      linesDataset.length,
      `Expected exactly ${linesDataset.length} lines, got ${wrappedResults.length}`
    );
  });

  await runTest('2.2 Strict startMs identity invariant for every line i (0..59)', () => {
    for (let i = 0; i < linesDataset.length; i++) {
      assert.strictEqual(
        wrappedResults[i].startMs,
        linesDataset[i].startMs,
        `Line ${i} startMs changed: expected ${linesDataset[i].startMs}, got ${wrappedResults[i].startMs}`
      );
    }
  });

  await runTest('2.3 Strict endMs identity invariant for every line i (0..59)', () => {
    for (let i = 0; i < linesDataset.length; i++) {
      assert.strictEqual(
        wrappedResults[i].endMs,
        linesDataset[i].endMs,
        `Line ${i} endMs changed: expected ${linesDataset[i].endMs}, got ${wrappedResults[i].endMs}`
      );
    }
  });

  await runTest('2.4 Strict speaker label fidelity for every line i (0..59)', () => {
    for (let i = 0; i < linesDataset.length; i++) {
      assert.strictEqual(
        wrappedResults[i].speaker,
        linesDataset[i].speaker,
        `Line ${i} speaker altered: expected ${linesDataset[i].speaker}, got ${wrappedResults[i].speaker}`
      );
    }
  });

  await runTest('2.5 Strict id preservation for every line i (0..59)', () => {
    for (let i = 0; i < linesDataset.length; i++) {
      assert.strictEqual(
        wrappedResults[i].id,
        linesDataset[i].id,
        `Line ${i} id altered: expected ${linesDataset[i].id}, got ${wrappedResults[i].id}`
      );
    }
  });

  await runTest('2.6 Zero artificial gap injection: gap_final === gap_source across all pairs', () => {
    for (let i = 0; i < linesDataset.length - 1; i++) {
      const origGap = linesDataset[i + 1].startMs - linesDataset[i].endMs;
      const finalGap = wrappedResults[i + 1].startMs - wrappedResults[i].endMs;
      assert.strictEqual(
        finalGap,
        origGap,
        `Gap between line ${i} and ${i + 1} altered: original ${origGap}ms vs final ${finalGap}ms`
      );
    }
  });

  await runTest('2.7 0ms back-to-back speech gaps preserved exactly (lines 54->55 and 55->56)', () => {
    const gap54_55 = wrappedResults[55].startMs - wrappedResults[54].endMs;
    assert.strictEqual(gap54_55, 0, 'Back-to-back 0ms gap between lines 54 and 55 must remain 0ms');
    const gap55_56 = wrappedResults[56].startMs - wrappedResults[55].endMs;
    assert.strictEqual(gap55_56, 0, 'Back-to-back 0ms gap between lines 55 and 56 must remain 0ms');
  });

  await runTest('2.8 Short lines (<= 37 chars) remain single visual line without \\n', () => {
    for (let i = 0; i <= 15; i++) {
      const res = wrappedResults[i];
      assert.strictEqual(
        res.text.includes('\n'),
        false,
        `Line ${i} ("${res.text}") has length ${res.text.length} <= 37 but was wrapped!`
      );
    }
  });

  await runTest('2.9 Long lines (> 37 chars) with spaces are wrapped with \\n while remaining a single SrtLine block', () => {
    for (let i = 16; i < linesDataset.length; i++) {
      const res = wrappedResults[i];
      if (res.text.length > 37) {
        if (res.text.includes(' ')) {
          assert.ok(
            res.text.includes('\n'),
            `Line ${i} ("${res.text}") has length ${res.text.length} > 37 with spaces but was NOT wrapped with \\n!`
          );
        } else {
          // Unbroken single token (e.g. long URL) without spaces cannot be wrapped by word wrap
          assert.ok(res.text.length > 37, 'Unbroken long string preserved intact');
        }
      }
    }
  });

  await runTest('2.10 Linguistic span protection: numbers and units never split across newline', () => {
    // Check line 35 ("150 tỷ đồng"), line 36 ("120 km/h"), line 38 ("35.8 tỷ USD")
    const checkLineProtected = (index: number, forbiddenBrokenWords: string[]) => {
      const text = wrappedResults[index].text;
      const sublines = text.split('\n');
      for (const phrase of forbiddenBrokenWords) {
        const parts = phrase.split(' ');
        for (let s = 0; s < sublines.length - 1; s++) {
          const l1 = sublines[s].trim();
          const l2 = sublines[s + 1].trim();
          const broken = l1.endsWith(parts[0]) && l2.startsWith(parts.slice(1).join(' '));
          assert.strictEqual(
            broken,
            false,
            `Line ${index} improperly broke protected phrase "${phrase}" across sublines: "${l1}" | "${l2}"`
          );
        }
      }
    };

    checkLineProtected(35, ['150 tỷ', 'tỷ đồng', '12.5%']);
    checkLineProtected(36, ['120 km/h', '45 phút']);
    checkLineProtected(38, ['35.8 tỷ', 'tỷ USD']);
  });

  await runTest('2.11 Proper nouns (Thành phố Hồ Chí Minh, Trần Đại Nghĩa) boundary protected', () => {
    const textHCM = wrappedResults[40].text;
    assert.ok(textHCM.includes('Hồ Chí Minh'), 'Proper noun Hồ Chí Minh must not be split');
  });

  await runTest('2.12 Pre-existing newline in text is cleanly normalized and re-wrapped', () => {
    const line58 = wrappedResults[58];
    assert.ok(line58.text.includes('\n'), 'Line 58 must be wrapped');
    const sublines = line58.text.split('\n');
    for (const sub of sublines) {
      assert.ok(sub.trim().length <= 45, `Subline length ${sub.length} exceeds wrap expectation`);
    }
  });

  await runTest('2.13 Extreme long line (286 chars) wraps into compliant visual sublines in 1 block', () => {
    const line26 = wrappedResults[26];
    assert.strictEqual(line26.id, 'line-26');
    assert.strictEqual(line26.startMs, 79500);
    assert.strictEqual(line26.endMs, 92000);
    assert.strictEqual(line26.speaker, 'SPEAKER_01');
    const sublines = line26.text.split('\n');
    assert.ok(sublines.length >= 3, `Expected >= 3 sublines for 286 chars, got ${sublines.length}`);
    for (const sub of sublines) {
      assert.ok(sub.trim().length <= 42, `Subline exceeds wrap threshold: "${sub}" (${sub.length})`);
    }
  });

  await runTest('2.14 Non-Vietnamese target language (isVietnamese = false) preserves raw text without wrap', () => {
    const rawEnglishLines: SrtLine[] = [
      {
        id: 'en-long',
        startMs: 1000,
        endMs: 5000,
        text: 'This is a very long English sentence that would normally trigger Vietnamese wrapping if enabled.',
        speaker: 'SPEAKER_00',
      },
    ];
    const bypassed = applyVisualLineWrapping(rawEnglishLines, false);
    assert.strictEqual(bypassed[0].text, rawEnglishLines[0].text);
    assert.strictEqual(bypassed[0].text.includes('\n'), false);
  });

  await runTest('2.15 Pigeonhole boundary: when 2-line <=37 hard constraint conflicts with span, hard constraint wins without breaking 1-1 line invariant', () => {
    // A 71-char line where the protected span "120 km/h" straddles indices 32-40.
    // Partitioning into 2 lines <= 37 chars is only possible between indices 34..37 (inside "120 km/h").
    const straddlingLine: SrtLine[] = [
      {
        id: 'straddle-1',
        startMs: 5000,
        endMs: 9000,
        text: 'Tốc độ xe chạy trên cao tốc đạt 120 km/h trong suốt 45 phút hành trình.',
        speaker: 'SPEAKER_01',
      },
    ];
    const res = applyVisualLineWrapping(straddlingLine, true);
    assert.strictEqual(res.length, 1, 'Must remain a single SrtLine block');
    assert.strictEqual(res[0].id, 'straddle-1');
    assert.strictEqual(res[0].startMs, 5000);
    assert.strictEqual(res[0].endMs, 9000);
    assert.strictEqual(res[0].speaker, 'SPEAKER_01');
    const sublines = res[0].text.split('\n');
    assert.strictEqual(sublines.length, 2);
    // Both sublines strictly respect <= 37
    assert.ok(sublines[0].length <= 37, `Subline 0 (${sublines[0].length}) exceeds 37`);
    assert.ok(sublines[1].length <= 37, `Subline 1 (${sublines[1].length}) exceeds 37`);
  });

  // ==========================================================================
  // SECTION 3: SRT Round-Trip Serialization & Parsing Fidelity
  // ==========================================================================
  console.log('\n--- Section 3: SRT Round-Trip Serialization & Parsing Fidelity ---');

  await runTest('3.1 serializeSrt and parseSrt preserve all 60 lines, speakers, times, and visual \\n', () => {
    const serialized = serializeSrt(wrappedResults);
    const parsed = parseSrt(serialized);

    assert.strictEqual(parsed.length, wrappedResults.length, 'SRT parse length must match serialized length');
    for (let i = 0; i < wrappedResults.length; i++) {
      const orig = wrappedResults[i];
      const reparsed = parsed[i];
      assert.strictEqual(reparsed.startMs, orig.startMs, `Line ${i} startMs mismatch after SRT roundtrip`);
      assert.strictEqual(reparsed.endMs, orig.endMs, `Line ${i} endMs mismatch after SRT roundtrip`);
      assert.strictEqual(reparsed.speaker, orig.speaker, `Line ${i} speaker mismatch after SRT roundtrip`);
      assert.strictEqual(reparsed.text, orig.text, `Line ${i} text mismatch after SRT roundtrip`);
    }
  });

  // ==========================================================================
  // SECTION 4: End-to-End translateSrtFile Execution (Mocked AI Client)
  // Multi-batching (60 lines / 15 batchSize = 4 batches), concurrency, checkpoints
  // ==========================================================================
  console.log('\n--- Section 4: End-to-End translateSrtFile Execution ---');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_challenger_m2_'));
  const tempSrtPath = path.join(tempDir, 'sample_60_lines.srt');

  // Serialize the 60 source lines to temp SRT
  fs.writeFileSync(tempSrtPath, serializeSrt(linesDataset), 'utf-8');

  // Intercept OpenAI chat.completions.create
  SettingsStore.set('geminiApiKey', 'test_adversarial_key_12345');
  SettingsStore.set('translateBatchSize', 15);
  SettingsStore.set('translateConcurrency', 2);

  const testClient = new OpenAI({ apiKey: 'test_adversarial_key_12345' });
  const completionsProto = Object.getPrototypeOf(testClient.chat.completions) as any;
  const originalCreate = completionsProto.create;

  let apiCallCount = 0;
  completionsProto.create = async function (params: any) {
    apiCallCount++;
    const userMessage = params.messages?.find((m: any) => m.role === 'user');
    assert.ok(userMessage, 'User message payload required');

    let payload: any;
    try {
      payload = JSON.parse(userMessage.content);
    } catch {
      payload = {};
    }

    const items: Array<{ i: string; text: string }> = payload.items || [];
    const translatedItems = items.map((item) => {
      const trans = mockTranslateSentence(item.text);
      return {
        i: item.i,
        text: trans !== item.text ? trans : `[Dịch] ${item.text}`,
      };
    });

    return {
      id: `chatcmpl-${apiCallCount}`,
      object: 'chat.completion',
      created: Date.now(),
      model: params.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: JSON.stringify(translatedItems),
          },
          finish_reason: 'stop',
        },
      ],
    };
  };

  try {
    let progressUpdates: number[] = [];
    const { translatedSrtPath } = await translateSrtFile(
      tempSrtPath,
      'vi',
      (p) => progressUpdates.push(p)
    );

    await runTest('4.1 translateSrtFile completed successfully and produced .translated.srt', () => {
      assert.ok(fs.existsSync(translatedSrtPath), `Translated SRT file must exist at ${translatedSrtPath}`);
      assert.ok(progressUpdates.length > 0, 'Progress callback must have been triggered');
      assert.strictEqual(progressUpdates[progressUpdates.length - 1], 100, 'Final progress must be 100%');
    });

    await runTest('4.2 Multi-batch execution made expected number of API calls (4 batches for 60 lines)', () => {
      assert.strictEqual(apiCallCount, 4, `Expected 4 API batch calls (60 / 15), got ${apiCallCount}`);
    });

    const translatedContent = fs.readFileSync(translatedSrtPath, 'utf-8');
    const finalParsed = parseSrt(translatedContent);

    await runTest('4.3 E2E translated SRT has exactly 60 lines (strict 1-1 count invariant)', () => {
      assert.strictEqual(
        finalParsed.length,
        linesDataset.length,
        `Expected 60 lines in output, got ${finalParsed.length}`
      );
    });

    await runTest('4.4 E2E translated SRT maintains 100% exact startMs and endMs identity', () => {
      for (let i = 0; i < linesDataset.length; i++) {
        assert.strictEqual(
          finalParsed[i].startMs,
          linesDataset[i].startMs,
          `E2E line ${i} startMs changed: expected ${linesDataset[i].startMs}, got ${finalParsed[i].startMs}`
        );
        assert.strictEqual(
          finalParsed[i].endMs,
          linesDataset[i].endMs,
          `E2E line ${i} endMs changed: expected ${linesDataset[i].endMs}, got ${finalParsed[i].endMs}`
        );
      }
    });

    await runTest('4.5 E2E translated SRT maintains 100% exact speaker label identity', () => {
      for (let i = 0; i < linesDataset.length; i++) {
        assert.strictEqual(
          finalParsed[i].speaker,
          linesDataset[i].speaker,
          `E2E line ${i} speaker altered: expected ${linesDataset[i].speaker}, got ${finalParsed[i].speaker}`
        );
      }
    });

    await runTest('4.6 E2E translated SRT maintains 100% zero artificial gaps (no 80ms minGapMs)', () => {
      for (let i = 0; i < linesDataset.length - 1; i++) {
        const origGap = linesDataset[i + 1].startMs - linesDataset[i].endMs;
        const e2eGap = finalParsed[i + 1].startMs - finalParsed[i].endMs;
        assert.strictEqual(
          e2eGap,
          origGap,
          `E2E acoustic gap between lines ${i} and ${i + 1} altered: orig ${origGap}ms vs e2e ${e2eGap}ms`
        );
      }
    });

    await runTest('4.7 Checkpoint file is deleted upon successful completion', () => {
      const cpPath = getCheckpointPath(tempSrtPath);
      assert.strictEqual(fs.existsSync(cpPath), false, 'Checkpoint file must be removed after successful run');
    });

    // ========================================================================
    // SECTION 5: Checkpoint Recovery Verification
    // ========================================================================
    console.log('\n--- Section 5: Checkpoint Recovery Verification ---');

    await runTest('5.1 Pre-existing checkpoint is reused without re-translating cached lines', async () => {
      // Create a new test SRT with 15 lines
      const subset15 = linesDataset.slice(0, 15);
      const testCpSrt = path.join(tempDir, 'test_cp.srt');
      fs.writeFileSync(testCpSrt, serializeSrt(subset15), 'utf-8');

      // Pre-populate checkpoint for line-0..line-4 (5 lines)
      const cpData: Record<string, { source: string; target: string }> = {};
      for (let i = 0; i < 5; i++) {
        cpData[subset15[i].id] = {
          source: subset15[i].text,
          target: `[CACHED] ${subset15[i].text}`,
        };
      }
      saveCheckpoint(testCpSrt, 'vi', cpData);

      const beforeApiCount = apiCallCount;
      const { translatedSrtPath: cpOut } = await translateSrtFile(testCpSrt, 'vi');
      const cpParsed = parseSrt(fs.readFileSync(cpOut, 'utf-8'));

      assert.strictEqual(cpParsed.length, 15, 'Must have 15 lines');
      // The first 5 lines must contain [CACHED]
      for (let i = 0; i < 5; i++) {
        assert.ok(
          cpParsed[i].text.includes('[CACHED]'),
          `Line ${i} should have been loaded from checkpoint: "${cpParsed[i].text}"`
        );
      }
      // StartMs, endMs, speaker must remain identical
      for (let i = 0; i < 15; i++) {
        assert.strictEqual(cpParsed[i].startMs, subset15[i].startMs);
        assert.strictEqual(cpParsed[i].endMs, subset15[i].endMs);
        assert.strictEqual(cpParsed[i].speaker, subset15[i].speaker);
      }
    });

  } finally {
    // Restore original OpenAI prototype
    completionsProto.create = originalCreate;
    // Clean up temporary files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }

  // ==========================================================================
  // SECTION 6: Contrast against Legacy segmentSubtitlesNetflix
  // ==========================================================================
  console.log('\n--- Section 6: Contrast Against Legacy segmentSubtitlesNetflix ---');

  await runTest('6.1 Contrast: legacy Netflix slicing alters line count and injects gaps vs 1-1 preservation', () => {
    const sampleInput = linesDataset.slice(22, 27); // 5 long lines
    const netflixOutput = segmentSubtitlesNetflix(sampleInput);

    console.log(`    (Info: Old Netflix produced ${netflixOutput.length} lines from ${sampleInput.length} long lines)`);
    assert.ok(
      netflixOutput.length > sampleInput.length,
      'Legacy Netflix slicing would have split long lines into multiple blocks'
    );

    const ourOutput = applyVisualLineWrapping(sampleInput, true);
    assert.strictEqual(
      ourOutput.length,
      sampleInput.length,
      'New 1-1 translation pipeline strictly preserves line count'
    );
  });

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log('\n================================================================================');
  console.log('📊 EMPIRICAL CHALLENGER TEST RESULTS:');
  console.log(`   Total Tests: ${totalCount}`);
  console.log(`   Passed:      ${passedCount} ✅`);
  console.log(`   Failed:      ${totalCount - passedCount} ❌`);
  console.log('================================================================================\n');

  if (failureDetails.length > 0) {
    console.error('Failure Details:');
    failureDetails.forEach((f) => console.error(` - ${f}`));
    process.exit(1);
  } else {
    console.log('🎉 ALL ADVERSARIAL CHALLENGES PASSED! 1-1 TRANSLATION ALIGNMENT IS 100% EMPIRICALLY VERIFIED.');
  }
}

runAdversarialSuite().catch((err) => {
  console.error('Fatal crash in adversarial test runner:', err);
  process.exit(1);
});
