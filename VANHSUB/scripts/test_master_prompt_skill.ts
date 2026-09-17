import assert from 'assert';
import { aiStudioLlmService } from '../main/ai-studio/services/AiStudioLlmService';
import { RAW_SKILL_TEMPLATE, generateFilledSkillPrompt } from '../renderer/components/ai-studio/ChannelSkillModal';
import type { ChannelProfileConfig } from '../main/ai-studio/types';

async function testMasterPromptSkill() {
  console.log('--- TEST 1: Skill Template & Variables Replacement ---');
  assert.ok(RAW_SKILL_TEMPLATE.includes('Bạn là chuyên gia viết PRODUCTION MASTER PROMPT'), 'Raw skill template text must match spec');
  assert.ok(RAW_SKILL_TEMPLATE.includes('PHẦN A — KHUÔN BẮT BUỘC'), 'Must include PHẦN A');
  assert.ok(RAW_SKILL_TEMPLATE.includes('PHẦN B — VÙNG CẤM SỬA'), 'Must include PHẦN B');
  assert.ok(RAW_SKILL_TEMPLATE.includes('=== SOURCE START ==='), 'Must include SOURCE START marker');
  assert.ok(RAW_SKILL_TEMPLATE.includes('STRICT OUTPUT FORMAT'), 'Must include STRICT OUTPUT FORMAT');

  const testProfile: Partial<ChannelProfileConfig> = {
    channelNiche: 'Chiến sự & Địa chính trị Thế giới',
    channelDescription: 'Phân tích quân sự chuyên sâu, trực diện, không thiên kiến.',
    channelOrientation: 'Kịch tính, dẫn chứng hồ sơ giải mật, số liệu thực chiến.',
    channelHook: 'Chào mừng bạn quay trở lại với Góc Nhìn Chiến Sự!',
    targetLongDuration: '8_12_min',
  };

  const filledPrompt = generateFilledSkillPrompt(testProfile);
  assert.ok(filledPrompt.includes('Chiến sự & Địa chính trị Thế giới'), 'Filled prompt must include channel niche');
  assert.ok(filledPrompt.includes('8–12 phút'), 'Filled prompt must include target minutes');
  assert.ok(filledPrompt.includes('Phân tích quân sự chuyên sâu'), 'Filled prompt must include channel description');
  console.log('✓ [PASS] Skill Template and Channel variable substitution verified.');

  console.log('--- TEST 2: Fallback 10-Section Master Prompt Generation ---');
  // Run without LLM config to test fallback template compliance
  const masterPrompt = await aiStudioLlmService.generateMasterPromptForChannel(testProfile);
  assert.ok(masterPrompt.includes('1. SYSTEM ROLE'), 'Must contain 1. SYSTEM ROLE');
  assert.ok(masterPrompt.includes('2. INPUT'), 'Must contain 2. INPUT');
  assert.ok(masterPrompt.includes('{{CHANNEL_NAME}}'), 'Must contain {{CHANNEL_NAME}} runtime placeholder');
  assert.ok(masterPrompt.includes('{{SOURCE_MATERIAL}}'), 'Must contain {{SOURCE_MATERIAL}} runtime placeholder');
  assert.ok(masterPrompt.includes('=== SOURCE START ==='), 'Must contain === SOURCE START ===');
  assert.ok(masterPrompt.includes('=== SOURCE END ==='), 'Must contain === SOURCE END ===');
  assert.ok(masterPrompt.includes('3. PRIMARY OBJECTIVE'), 'Must contain 3. PRIMARY OBJECTIVE');
  assert.ok(masterPrompt.includes('4. CHANNEL DNA'), 'Must contain 4. CHANNEL DNA');
  assert.ok(masterPrompt.includes('4B. BRAND IDENTITY'), 'Must contain 4B. BRAND IDENTITY');
  assert.ok(masterPrompt.includes('5. SIGNATURE BEAT'), 'Must contain 5. SIGNATURE BEAT');
  assert.ok(masterPrompt.includes('6. NGUỒN & SỰ THẬT'), 'Must contain 6. NGUỒN & SỰ THẬT');
  assert.ok(masterPrompt.includes('7. CẤU TRÚC TẬP'), 'Must contain 7. CẤU TRÚC TẬP');
  assert.ok(masterPrompt.includes('8. NARRATION & DELIVERY'), 'Must contain 8. NARRATION & DELIVERY');
  assert.ok(masterPrompt.includes('9. STRICT OUTPUT FORMAT'), 'Must contain 9. STRICT OUTPUT FORMAT');
  assert.ok(masterPrompt.includes('SCRIPT:'), 'Must contain SCRIPT block in format contract');
  assert.ok(masterPrompt.includes('--- END OF SCRIPT ---'), 'Must contain --- END OF SCRIPT ---');
  assert.ok(masterPrompt.includes('NARRATION DIRECTION:'), 'Must contain NARRATION DIRECTION');
  console.log('✓ [PASS] Generated Master Prompt complies 100% with the 10-section contract.');

  console.log('--- TEST 3: Script Parsing with Strict Output Format ---');
  const strictTextOutput = `TITLE: Trận Đánh Quyết Định Bên Bờ Sông Dnipro

SCRIPT:
Vào đúng ba giờ sáng ngày mười lăm tháng chín, pháo đài thép đã nổ tung.
Đây là thời khắc nguy kịch nhất của toàn bộ chiến dịch biên giới.
Các đơn vị tiền phương buộc phải đưa ra quyết định sinh tử chỉ trong vỏn vẹn năm phút.
Nếu tuyến phòng thủ này sụp đổ, toàn bộ vùng hạ lưu sẽ rơi vào tình thế không thể cứu vãn.
Và đó cũng là lúc sự thật đằng sau mệnh lệnh rút lui được hé lộ.

--- END OF SCRIPT ---

NARRATION DIRECTION:
Giọng trầm ấm, tốc độ 135 từ một phút, chậm lại ở câu mở đầu và câu kết thúc.`;

  const parsedBeats = aiStudioLlmService.splitScriptToBeatLines(strictTextOutput);
  assert.ok(parsedBeats.length >= 3, `Expected at least 3 beats, got ${parsedBeats.length}`);
  console.log(`✓ [PASS] Strict Output text extracted into ${parsedBeats.length} discrete beats.`);

  console.log('\nALL MASTER PROMPT SKILL TESTS PASSED SUCCESSFULLY! ✅');
}

testMasterPromptSkill().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
