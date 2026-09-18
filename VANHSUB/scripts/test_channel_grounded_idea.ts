import assert from 'assert';
import { aiStudioLlmService } from '../main/ai-studio/services/AiStudioLlmService';
import type { ChannelProfileConfig } from '../main/ai-studio/types';

async function runTests() {
  console.log('=== TEST 1: Blueprint duration & character grounding in parseBlueprintJson ===');

  const profileLong: Partial<ChannelProfileConfig> = {
    projectName: 'Chiến Tranh & Địa Chính Trị',
    channelNiche: 'Lịch sử quân sự thế giới',
    channelOrientation: 'Sâu sắc, kịch tính, tư liệu mật',
    targetLongDuration: '8_12_min',
    hostName: 'Đại Úy Hùng',
    hostDescription: 'Sĩ quan chỉ huy mặc quân phục tác chiến rằn ri, ánh mắt kiên định, phong cách cinematic noir',
    imageModel: 'Nano Banana 2',
    videoModel: 'Omni 1.1 Flash',
  };

  const rawSampleJson = JSON.stringify({
    title: 'Trận Chiến Cuối Cùng Tại Vòng Cung Kursk',
    hookConcept: '300 xe tăng đã biến mất bí ẩn chỉ trong 45 phút đầu tiên...',
    narrativeAngle: 'Góc nhìn từ đài chỉ huy tiền phương',
    outline: [
      '[00:00 - 01:00] Phân đoạn 1: Chuẩn bị hỏa lực trước bình minh',
      '[01:00 - 02:30] Phân đoạn 2: Đợt xung kích đầu tiên của thiết giáp',
      '[02:30 - 04:00] Phân đoạn 3: Cuộc chạm trán ác liệt tại cao điểm 252',
      '[04:00 - 06:00] Phân đoạn 4: Đòn phản công bất ngờ từ cánh trái',
      '[06:00 - 08:00] Phân đoạn 5: Bước ngoặt xoay chuyển toàn bộ cục diện',
      '[08:00 - 10:00] Phân đoạn 6: Bài học đắt giá và tàn cuộc',
    ],
  });

  const parsed = aiStudioLlmService.parseBlueprintJson(
    rawSampleJson,
    'Trận Kursk',
    '16:9',
    profileLong
  );

  assert.strictEqual(parsed.title, 'Trận Chiến Cuối Cùng Tại Vòng Cung Kursk');
  assert.strictEqual(parsed.estimatedDurationSec, 600, 'Target duration for 8_12_min must be 600s');
  assert.strictEqual(parsed.outline.length, 6);
  assert.ok(
    parsed.thumbnailPrompt.includes('Đại Úy Hùng') || parsed.thumbnailPrompt.includes('Nano Banana 2'),
    'Thumbnail prompt must reflect character or image model'
  );
  console.log('✓ [PASS] 8_12_min video blueprint correctly parsed with 600s duration and character consistency.');

  console.log('=== TEST 2: Shorts 60_90_sec duration & character grounding ===');
  const profileShort: Partial<ChannelProfileConfig> = {
    projectName: 'Shorts Tài Chính',
    channelNiche: 'Kinh tế vĩ mô',
    targetShortDuration: '60_90_sec',
    hostName: 'Alex Nguyễn',
    hostDescription: 'Chuyên gia phân tích tài chính trẻ tuổi, mặc vest xám hiện đại',
    imageModel: 'Midjourney v6',
  };

  const parsedShort = aiStudioLlmService.parseBlueprintJson(
    JSON.stringify({
      title: '5 Đồng Tiền Bí Ẩn Đang Tăng Giá',
      hookConcept: 'Đừng mua vàng vội, hãy xem 30 giây này trước!',
      outline: [
        '[00:00 - 00:15] Phân đoạn 1: Cảnh báo lạm phát',
        '[00:15 - 00:45] Phân đoạn 2: Làn sóng tài sản thay thế',
        '[00:45 - 01:15] Phân đoạn 3: Lời khuyên phân bổ vốn',
      ],
    }),
    'Tài chính',
    '9:16',
    profileShort
  );

  assert.strictEqual(parsedShort.estimatedDurationSec, 75, 'Target duration for 60_90_sec must be 75s');
  assert.strictEqual(parsedShort.aspectRatio, '9:16');
  assert.ok(
    parsedShort.thumbnailPrompt.includes('Alex Nguyễn') || parsedShort.thumbnailPrompt.includes('Midjourney v6'),
    'Shorts thumbnail prompt must reflect character or model'
  );
  console.log('✓ [PASS] 60_90_sec shorts blueprint correctly parsed with 75s duration.');

  console.log('=== TEST 3: Zero Silent Mock on Missing API Key with Channel Profile ===');
  let threwError = false;
  try {
    await aiStudioLlmService.analyzeIdeaBlueprint(
      'Test Topic',
      {
        provider: 'openai',
        apiKey: '',
        model: 'gpt-4o',
      },
      '16:9',
      undefined,
      profileLong
    );
  } catch (err: any) {
    threwError = true;
    assert.ok(
      err.message.includes('API Key') || err.message.includes('Cài Đặt'),
      `Error message should mention API Key: ${err.message}`
    );
  }
  assert.ok(threwError, 'Missing credentials must throw an explicit error');
  console.log('=== TEST 4: Recovery from Gemini Web {{ template syntax in response ===');
  // Exact simulation of Gemini Web returning text mentioning {{CHANNEL_NAME}} before the JSON block
  const geminiProblematicResponse = `Dưới đây là kế hoạch chi tiết cho kênh {{CHANNEL_NAME}}:

\`\`\`json
{
  "title": "Bí Ẩn Tam Giác Vàng 2026",
  "hookConcept": "Bạn có biết bí mật kinh hoàng đằng sau vùng đất này?",
  "narrativeAngle": "Điều tra độc quyền",
  "outline": [
    "[00:00 - 01:00] Phân đoạn 1: Mở đầu sự việc",
    "[01:00 - 02:30] Phân đoạn 2: Lần theo dấu vết"
  ],
  "thumbnailConcept": "Bản đồ cổ phát sáng trong sương mù",
  "thumbnailPrompt": "Cinematic mysterious map, golden light, 8k"
}
\`\`\`
Hy vọng bạn hài lòng với kế hoạch này!`;

  const parsedGemini = aiStudioLlmService.parseBlueprintJson(
    geminiProblematicResponse,
    'Tam Giác Vàng',
    '16:9',
    profileLong
  );

  assert.strictEqual(parsedGemini.title, 'Bí Ẩn Tam Giác Vàng 2026');
  assert.strictEqual(parsedGemini.outline.length, 2);
  assert.strictEqual(parsedGemini.estimatedDurationSec, 600);
  console.log('✓ [PASS] Gemini response with {{ template syntax cleanly parsed without "Unexpected character" error.');

  console.log('=== TEST 5: Fallback regex extraction on non-JSON response ===');
  const plainTextResponse = `Tiêu đề: Cuộc Sống Trong Lòng Đất 2050
Hook: Liệu con người có thể sống dưới lòng đất 50 năm?
Góc nhìn: Khoa học viễn tưởng thực tế
Phân đoạn 1 [00:00 - 01:00]: Xây dựng thành phố ngầm
Phân đoạn 2 [01:00 - 03:00]: Thách thức về năng lượng và không khí
Thumbnail: Thành phố ngầm lung linh ánh đèn neon`;

  const parsedPlainText = aiStudioLlmService.parseBlueprintJson(
    plainTextResponse,
    'Thành phố ngầm',
    '16:9',
    profileLong
  );

  assert.strictEqual(parsedPlainText.title, 'Cuộc Sống Trong Lòng Đất 2050');
  assert.ok(parsedPlainText.outline.length >= 2, 'Must extract outline beats from plain text');
  console.log('✓ [PASS] Non-JSON plain text response successfully rescued via regex fallback.');

  console.log('\nALL CHANNEL GROUNDED IDEA TESTS PASSED SUCCESSFULLY! ✅');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
