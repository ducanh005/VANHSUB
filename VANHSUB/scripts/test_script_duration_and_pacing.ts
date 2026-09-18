import assert from 'assert';
import {
  calculateScriptPacingMetrics,
  buildScriptPromptForWeb,
  parseChatGptScriptResponse,
} from '../main/ai-studio/chatgpt/ChatGptWebSessionManager';
import type { IdeaBlueprint, ChannelProfileConfig } from '../main/ai-studio/types';

async function runDurationAndPacingTests() {
  console.log('=== TEST 1: Pacing Metrics for 5-8 Minute Video vs Shorts ===');

  const channelProfileLong: Partial<ChannelProfileConfig> = {
    projectName: 'Hồ Sơ Bí Ẩn',
    channelNiche: 'Lịch sử & Vụ án thế giới',
    channelOrientation: 'Kịch tính, sâu sắc, tư liệu thực tế',
    targetLongDuration: '5_8_min',
    targetShortDuration: '60_90_sec',
  };

  const blueprintLong: IdeaBlueprint = {
    title: 'Bí Ẩn Chuyến Bay 370',
    aspectRatio: '16:9',
    hookConcept: '239 sinh mạng đã biến mất khỏi màn hình radar...',
    narrativeAngle: 'Góc nhìn từ phòng kiểm soát không lưu Kuala Lumpur',
    outline: [
      '[00:00 - 01:00] Đoạn 1: Mất tín hiệu bí ẩn trên Biển Đông',
      '[01:00 - 02:30] Đoạn 2: Cú ngoặt gắt sang hướng tây',
      '[02:30 - 04:30] Đoạn 3: Các tín hiệu ping vệ tinh cuối cùng',
      '[04:30 - 06:00] Đoạn 4: Cuộc tìm kiếm đắt đỏ nhất lịch sử',
      '[06:00 - 07:30] Đoạn 5: Những giả thuyết chưa có lời giải',
    ],
  };

  const longMetrics = calculateScriptPacingMetrics(blueprintLong, channelProfileLong);
  assert.strictEqual(longMetrics.isShorts, false, 'Must be long video format');
  assert.strictEqual(longMetrics.targetMinutesText, '5 đến 8 phút');
  assert.ok(longMetrics.targetDurationSec >= 300 && longMetrics.targetDurationSec <= 480, 'Target sec must be 5-8 min range');
  assert.ok(longMetrics.minSentences >= 35 && longMetrics.maxSentences <= 70, 'Target sentences must be 40-60');
  console.log(`✓ [PASS] Long video 5-8 min metrics: ${longMetrics.minSentences}-${longMetrics.maxSentences} sentences, target duration ${longMetrics.targetDurationSec}s.`);

  // Test Shorts metrics
  const blueprintShorts: IdeaBlueprint = {
    title: 'Top 3 Sự Thật Đáng Sợ Về Vũ Trụ',
    aspectRatio: '9:16',
    hookConcept: 'Nếu rơi vào hố đen, thời gian sẽ dừng lại...',
    narrativeAngle: 'Cận cảnh hố đen',
  };
  const shortsMetrics = calculateScriptPacingMetrics(blueprintShorts, channelProfileLong);
  assert.strictEqual(shortsMetrics.isShorts, true, 'Must be detected as shorts');
  assert.strictEqual(shortsMetrics.targetMinutesText, '60 đến 90 giây');
  assert.ok(shortsMetrics.minSentences >= 8 && shortsMetrics.maxSentences <= 15, 'Shorts sentences should be 8-14');
  console.log(`✓ [PASS] Shorts metrics: ${shortsMetrics.minSentences}-${shortsMetrics.maxSentences} sentences, target duration ${shortsMetrics.targetDurationSec}s.`);

  console.log('=== TEST 2: Dynamic Web Prompt Generation ===');
  const { prompt: webPrompt, metrics: generatedMetrics } = buildScriptPromptForWeb(
    'Bí Ẩn Chuyến Bay 370',
    'youtube_story',
    blueprintLong,
    channelProfileLong
  );

  assert.ok(webPrompt.includes('5 đến 8 phút'), 'Prompt must specify 5 đến 8 phút');
  assert.ok(webPrompt.includes('DÀN Ý PHÂN ĐOẠN CHI TIẾT'), 'Prompt must include outline');
  assert.ok(webPrompt.includes('[00:00 - 01:00] Đoạn 1'), 'Prompt must ground on specific outline beats');
  assert.ok(!webPrompt.includes('YouTube Shorts / TikTok'), 'Long video prompt must NOT say YouTube Shorts / TikTok');
  assert.ok(!webPrompt.includes('4 đến 6 câu'), 'Long video prompt must NOT ask for 4-6 sentences');
  console.log('✓ [PASS] Web Prompt for 5-8 min video correctly grounded with outline and sentence targets.');

  console.log('=== TEST 3: parseChatGptScriptResponse (No Truncation on Long Script) ===');
  // Generate 50 numbered sentences to simulate a real 6-minute AI response
  const simulatedLines: string[] = [];
  for (let i = 1; i <= 50; i++) {
    simulatedLines.push(
      `CÂU ${i}: Vào thời khắc định mệnh đó, tín hiệu kiểm soát không lưu đột ngột tắt lịm hoàn toàn giữa vùng trời tĩnh mịch số ${i}.`
    );
  }
  const simulatedRaw = simulatedLines.join('\n');

  const parsedBeats = parseChatGptScriptResponse(simulatedRaw, 'Bí Ẩn Chuyến Bay 370');
  assert.strictEqual(parsedBeats.length, 50, 'Must parse ALL 50 sentences without slice(0, 8) truncation!');
  assert.strictEqual(parsedBeats[0].beatType, 'hook');
  assert.strictEqual(parsedBeats[parsedBeats.length - 1].beatType, 'outro');

  const totalWords = parsedBeats.reduce((acc, l) => acc + l.text.split(/\s+/).filter(Boolean).length, 0);
  const totalDurationSec = Math.round(totalWords / 3.3);
  const mins = Math.floor(totalDurationSec / 60);
  const secs = totalDurationSec % 60;
  console.log(`✓ [PASS] Parsed 50 sentences: Total ${totalWords} words, Duration ~${mins}:${secs < 10 ? '0' : ''}${secs} (${totalDurationSec}s).`);
  assert.ok(totalDurationSec >= 300, '50 sentences must produce > 5 minutes (>= 300s), NOT 43s!');

  console.log('=== TEST 4: parseChatGptScriptResponse with Master Prompt Format ===');
  const masterPromptSimulated = `
STATUS: ACCEPTED
TITLE: Bí Ẩn Vụ Mất Tích Không Gian

SCRIPT:
Đúng 1 giờ 19 phút sáng, cơ trưởng cất lời chào cuối cùng với đài không lưu trước khi phi cơ biến mất vào hư không.
Không một cuộc gọi cứu nạn nào được phát đi từ buồng lái của chiếc máy bay hiện đại nhất thời điểm đó.
Những trạm radar quân sự bí mật sau đó phát hiện máy bay đã thực hiện một cú rẽ ngoạn mục sang hướng tây.
Suốt nhiều năm qua, cuộc săn lùng dưới đáy đại dương sâu thẳm đã tiêu tốn hàng trăm triệu đô la mà không mang lại kết quả.
Các thân nhân hành khách vẫn mòn mỏi chờ đợi một câu trả lời chính thức sau hàng ngàn ngày đêm tuyệt vọng.
Những chiếc hộp đen nằm im dưới lớp bùn lạnh giá, mang theo bí mật chưa từng được giải mã của nhân loại.
Hãy đăng ký kênh ngay hôm nay để cùng chúng tôi tiếp tục hành trình lật mở những hồ sơ bí ẩn lớn nhất thế giới.
--- END OF SCRIPT ---

NARRATION DIRECTION:
Tông giọng trầm, nhịp điệu dồn dập.
`;

  const parsedMaster = parseChatGptScriptResponse(masterPromptSimulated, 'Bí Ẩn');
  assert.strictEqual(parsedMaster.length, 7, 'Must parse all 7 sentences from SCRIPT block');
  assert.ok(!parsedMaster.some((b) => b.text.includes('STATUS: ACCEPTED')), 'Must not include STATUS');
  assert.ok(!parsedMaster.some((b) => b.text.includes('NARRATION DIRECTION')), 'Must not include DIRECTION');
  console.log('✓ [PASS] Master Prompt SCRIPT block successfully parsed without unwanted metadata.');

  console.log('\n==================================================');
  console.log('ALL DURATION & PACING TESTS PASSED SUCCESSFULLY! ✅');
  console.log('==================================================');
}

runDurationAndPacingTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
