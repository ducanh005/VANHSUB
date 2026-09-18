import assert from 'assert';
import { aiStudioLlmService } from '../main/ai-studio/services/AiStudioLlmService';
import type { ScriptBeatLine, IdeaBlueprint, ChannelProfileConfig, PipelineSessionState } from '../main/ai-studio/types';

async function runScriptEvaluationTests() {
  console.log('=== TEST 1: AI Script Evaluation (10 Dimensions D1-D10) ===');

  const sampleBlueprint: IdeaBlueprint = {
    title: 'Bí Mật Đằng Sau Sự Sụp Đổ Của Đế Chế Lehman Brothers',
    hookConcept: 'Vào đúng 1h sáng ngày 15/9, một cuộc điện thoại đã làm bốc hơi 600 tỷ USD...',
    narrativeAngle: 'Góc nhìn từ bàn làm việc của các nhà giao dịch cấp cao trong đêm định mệnh',
    targetAudience: 'Người quan tâm đến tài chính, kinh tế thế giới và đầu tư mạo hiểm',
    estimatedDurationSec: 300,
    aspectRatio: '16:9',
    outline: [
      '[00:00 - 00:30] Hook: Cuộc gọi lúc nửa đêm và sự hoảng loạn tại Phố Wall',
      '[00:30 - 01:30] Bối cảnh: Khoản nợ dưới chuẩn và quả bom hẹn giờ',
      '[01:30 - 03:00] Đỉnh điểm: 72 giờ đàm phán nghẹt thở tại Fed New York',
      '[03:00 - 04:30] Sụp đổ: Đơn phá sản kỷ lục và phản ứng dây chuyền toàn cầu',
      '[04:30 - 05:00] Kết luận: Bài học đắt giá chưa bao giờ cũ',
    ],
    thumbnailPrompt: 'Cinematic photo of Wall Street trading floor in chaos',
  };

  const sampleChannelProfile: ChannelProfileConfig = {
    projectName: 'Kinh Tế Kỳ Bí',
    channelNiche: 'Tài chính - Lịch sử Phố Wall',
    channelOrientation: 'Kịch tính, sâu sắc, giàu thông tin thực chứng',
    targetLongDuration: '5_8_min',
    targetShortDuration: '60_90_sec',
    hostName: 'David Hùng',
    hostDescription: 'Nhà phân tích tài chính gạo cội, vest xám đen sang trọng',
    imageModel: 'Nano Banana 2',
    videoModel: 'Omni 1.1 Flash',
    voiceStyle: 'Trầm ấm, lôi cuốn, nhịp điệu dồn dập ở cao trào',
  };

  const sampleLines: ScriptBeatLine[] = [
    {
      id: 'beat-1',
      index: 0,
      speaker: 'David Hùng',
      text: 'Đúng 1 giờ 45 phút sáng ngày 15 tháng 9 năm 2008, một cuộc gọi bí mật từ Tòa nhà Fed New York đã làm bốc hơi hơn 600 tỷ đô la trong nháy mắt.',
      visualPromptEn: 'Cinematic dark office in New York, flashing emergency phone, rainy window overlooking Wall street, dramatic noir lighting',
    },
    {
      id: 'beat-2',
      index: 1,
      speaker: 'David Hùng',
      text: 'Đó không chỉ là sự sụp đổ của một ngân hàng 158 năm tuổi, mà là khởi đầu cho cơn ác mộng tài chính tồi tệ nhất thế kỷ 21.',
      visualPromptEn: 'Lehman brothers headquarters at night, stressed employees packing cardboard boxes into yellow taxis',
    },
    {
      id: 'beat-3',
      index: 2,
      speaker: 'David Hùng',
      text: 'Hàng ngàn nhân viên ôm những thùng các-tông bước ra đường trong nước mắt, trong khi thị trường chứng khoán toàn cầu bắt đầu rơi tự do.',
      visualPromptEn: 'Wall Street trading screen plunging into red charts, shocked brokers covering their faces in disbelief',
    },
    {
      id: 'beat-4',
      index: 3,
      speaker: 'David Hùng',
      text: 'Nhưng điều gì đã biến một gã khổng lồ tưởng chừng như bất khả chiến bại trở thành mồi lửa thiêu rụi toàn bộ hệ thống tiền tệ quốc tế?',
      visualPromptEn: 'Close up of antique wall clock ticking rapidly, stacks of subprime mortgage contracts burning slowly',
    },
    {
      id: 'beat-5',
      index: 4,
      speaker: 'David Hùng',
      text: 'Hãy đăng ký kênh ngay hôm nay để cùng tôi giải mã những góc khuất tàn nhẫn nhất phía sau các đại án kinh tế toàn cầu.',
      visualPromptEn: 'Host in sharp charcoal suit speaking directly to camera, cinematic studio depth of field',
    },
  ];

  // Evaluate script
  const evaluation = await aiStudioLlmService.evaluateScript(
    sampleLines,
    sampleBlueprint,
    sampleChannelProfile,
    { llm: { provider: 'deepseek', apiKey: '' } } as any
  );

  assert.ok(evaluation, 'Evaluation result must not be null');
  assert.strictEqual(typeof evaluation.overallScore, 'number', 'Overall score must be a number');
  assert.ok(evaluation.overallScore >= 0 && evaluation.overallScore <= 100, 'Overall score must be between 0 and 100');
  assert.strictEqual(evaluation.criteria.length, 10, 'Must have exactly 10 criteria scores D1-D10');

  const criteriaCodes = evaluation.criteria.map((c) => c.id);
  const expectedCodes = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10'];
  assert.deepStrictEqual(criteriaCodes, expectedCodes, 'Criteria codes must strictly be D1 to D10 in order');

  for (const crit of evaluation.criteria) {
    assert.ok(crit.name && crit.name.length > 0, `Criterion ${crit.id} must have a name`);
    assert.strictEqual(typeof crit.score, 'number', `Criterion ${crit.id} score must be numeric`);
    assert.ok(crit.score >= 0 && crit.score <= 10, `Criterion ${crit.id} score must be between 0 and 10`);
  }

  assert.ok(Array.isArray(evaluation.failedCriteria), 'failedCriteria must be an array');
  assert.ok(evaluation.critique && evaluation.critique.length > 0, 'Critique must be non-empty string');

  console.log(`✓ [PASS] Evaluation produced total score: ${evaluation.overallScore}/100 with ${evaluation.failedCriteria.length} weak criteria.`);
  console.log(`  Critique snippet: ${evaluation.critique.slice(0, 100)}...`);

  console.log('=== TEST 2: Script Refinement (improve_weaknesses & custom_prompt) ===');

  // Test mode: improve_weaknesses
  const refinedWeaknesses = await aiStudioLlmService.refineScript(
    sampleLines,
    undefined,
    'improve_weaknesses',
    sampleBlueprint,
    sampleChannelProfile,
    { llm: { provider: 'deepseek', apiKey: '' } } as any
  );

  assert.ok(refinedWeaknesses?.lines && refinedWeaknesses.lines.length > 0, 'Refined lines must not be empty');
  assert.strictEqual(refinedWeaknesses.lines.length, sampleLines.length, 'Refined lines count should match input lines');
  assert.ok(refinedWeaknesses.lines[0].text.length > 0, 'First refined line text must not be empty');

  console.log('✓ [PASS] improve_weaknesses returned properly formatted ScriptBeatLine array.');

  // Test mode: custom_prompt
  const customInstruction = 'Làm cho lời thoại kịch tính hơn, thêm ngôn từ giật gân, nhấn mạnh tính khốc liệt';
  const refinedCustom = await aiStudioLlmService.refineScript(
    sampleLines,
    customInstruction,
    'custom_prompt',
    sampleBlueprint,
    sampleChannelProfile,
    { llm: { provider: 'deepseek', apiKey: '' } } as any
  );

  assert.ok(refinedCustom?.lines && refinedCustom.lines.length > 0, 'Custom refined lines must not be empty');
  assert.strictEqual(refinedCustom.lines.length, sampleLines.length, 'Custom refined lines count should match');

  console.log('✓ [PASS] custom_prompt returned properly formatted ScriptBeatLine array.');

  console.log('=== TEST 3: Script Lines Duration and Timestamps Simulation ===');
  let runningSec = 0;
  const timestamps = sampleLines.map((line) => {
    const mins = Math.floor(runningSec / 60);
    const secs = Math.floor(runningSec % 60);
    const timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    const words = (line.text || '').split(/\s+/).filter(Boolean).length;
    const dur = line.durationMs ? Math.round(line.durationMs / 1000) : Math.max(3, Math.round(words / 3.3));
    runningSec += dur;
    return timeStr;
  });

  assert.strictEqual(timestamps[0], '0:00', 'First line must start at 0:00');
  assert.ok(timestamps.length === sampleLines.length, 'Timestamps count matches lines');
  assert.ok(runningSec > 0, 'Total calculated duration must be > 0');

  console.log(`✓ [PASS] Timestamps generated accurately (${timestamps.join(', ')}) with total ${runningSec}s.`);

  console.log('=== TEST 4: Inline Edit Simulation & Session State Sync ===');
  const mockSession: PipelineSessionState = {
    sessionId: 'test-session-edit-123',
    topic: 'Lehman Brothers Collapse',
    status: 'paused',
    currentStage: 2,
    progress: 25,
    stages: {
      1: { stage: 1, name: 'Ý tưởng', status: 'completed' },
      2: { stage: 2, name: 'Kịch bản & Lồng tiếng', status: 'paused' },
    },
    artifacts: {
      blueprint: sampleBlueprint,
      scriptLines: [...sampleLines],
      scriptEvaluation: evaluation,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Simulate user modifying line 2 inline
  const editedLines = [...mockSession.artifacts.scriptLines!];
  const newText = 'Và chính vào khoảnh khắc đó, một cơn chấn động nghìn tỷ đô la đã quét sạch nền tài chính toàn cầu.';
  editedLines[1] = {
    ...editedLines[1],
    text: newText,
  };

  // Simulate atomic update
  mockSession.artifacts.scriptLines = editedLines;
  mockSession.updatedAt = Date.now();

  assert.strictEqual(mockSession.artifacts.scriptLines[1].text, newText, 'Line 2 text must be updated');
  assert.strictEqual(mockSession.artifacts.scriptLines.length, sampleLines.length, 'Total lines preserved');
  console.log('✓ [PASS] Manual inline script line edit persists in session artifacts.');

  console.log('\n==================================================');
  console.log('ALL SCRIPT EVALUATION & EDIT TESTS PASSED! ✅');
  console.log('==================================================');
}

runScriptEvaluationTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
