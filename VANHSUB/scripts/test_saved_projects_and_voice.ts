import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { aiStudioTtsService } from '../main/ai-studio/services/AiStudioTtsService';
import {
  getAiStudioConfig,
  updateAiStudioConfig,
} from '../main/store/aiStudioStore';
import type {
  SavedProjectProfile,
  ScriptBeatLine,
  AiStudioVoiceConfig,
} from '../main/ai-studio/types';

async function runTests() {
  console.log('=== TEST 1: Saved Projects Persistence & Switching ===');

  const testDir = path.join(os.tmpdir(), 'vanhsub-test-projects-' + Date.now());
  process.env.VANHSUB_AI_STUDIO_DIR = testDir;

  const proj1: SavedProjectProfile = {
    id: 'proj_test_1',
    name: 'Hồ Sơ Bí Ẩn Vũ Trụ',
    channelProfile: {
      projectName: 'Hồ Sơ Bí Ẩn Vũ Trụ',
      channelNiche: 'Thiên văn học & Vũ trụ',
      channelOrientation: 'Bí ẩn, khoa học viễn tưởng, lôi cuốn',
      aiProvider: 'gemini_web',
      targetLongDuration: '5_8_min',
      imageSource: 'ai_flow_meta',
      videoStyleId: '',
      videoStyles: [],
      seriesType: 'anthology_new_topic',
      channelDescription: '',
      masterPrompt: '',
      researchFactBeforeWrite: false,
      evaluationLlm: 'gemini_web',
      channelHook: '',
      targetShortDuration: '60_90_sec',
      ttsEngine: 'edge_tts',
      specificVoice: 'vi-VN-NamMinhNeural',
      characterSync: 'per_video',
      characterRole: '',
      characterImageMode: 'ai_draw',
      chromeProfile: 'auto',
      visualEngine: 'google_flow',
      visualMode: 'blend',
      videoScenesIntro: 3,
      videoScenesBody: 10,
      staticImageDurationMin: 5,
      staticImageDurationMax: 8,
      videoModel: 'Omni 1.1 Flash',
      imageModel: '⭐ Nano Banana 2',
    },
    flowConfig: { aspectRatio: '16:9' },
    updatedAt: Date.now(),
  };

  const proj2: SavedProjectProfile = {
    id: 'proj_test_2',
    name: 'Sử Ký Hùng Tráng',
    channelProfile: {
      projectName: 'Sử Ký Hùng Tráng',
      channelNiche: 'Lịch sử chiến tranh Việt Nam',
      channelOrientation: 'Hào hùng, điện ảnh, bóc tách chiến thuật',
      aiProvider: 'chatgpt_web',
      targetLongDuration: '8_12_min',
      imageSource: 'ai_flow_meta',
      videoStyleId: '',
      videoStyles: [],
      seriesType: 'anthology_new_topic',
      channelDescription: '',
      masterPrompt: '',
      researchFactBeforeWrite: false,
      evaluationLlm: 'gemini_web',
      channelHook: '',
      targetShortDuration: '60_90_sec',
      ttsEngine: 'edge_tts',
      specificVoice: 'vi-VN-HoaiMyNeural',
      characterSync: 'per_video',
      characterRole: '',
      characterImageMode: 'ai_draw',
      chromeProfile: 'auto',
      visualEngine: 'google_flow',
      visualMode: 'blend',
      videoScenesIntro: 3,
      videoScenesBody: 10,
      staticImageDurationMin: 5,
      staticImageDurationMax: 8,
      videoModel: 'Omni 1.1 Flash',
      imageModel: '⭐ Nano Banana 2',
    },
    flowConfig: { aspectRatio: '9:16' },
    updatedAt: Date.now(),
  };

  // 1. Add proj1
  updateAiStudioConfig({
    savedProjects: [proj1],
    activeProjectId: proj1.id,
    channelProfile: proj1.channelProfile,
  });

  let cfg = getAiStudioConfig();
  assert.strictEqual(cfg.savedProjects?.length, 1, 'Should have 1 saved project');
  assert.strictEqual(cfg.activeProjectId, 'proj_test_1', 'Active project must be proj_test_1');
  assert.strictEqual(cfg.channelProfile?.projectName, 'Hồ Sơ Bí Ẩn Vũ Trụ');

  // 2. Add proj2
  updateAiStudioConfig({
    savedProjects: [proj2, proj1],
    activeProjectId: proj2.id,
    channelProfile: proj2.channelProfile,
  });

  cfg = getAiStudioConfig();
  assert.strictEqual(cfg.savedProjects?.length, 2, 'Should have 2 saved projects');
  assert.strictEqual(cfg.activeProjectId, 'proj_test_2');
  assert.strictEqual(cfg.channelProfile?.channelNiche, 'Lịch sử chiến tranh Việt Nam');

  // 3. Delete proj2 and switch back to proj1
  const remaining = cfg.savedProjects!.filter((p) => p.id !== 'proj_test_2');
  updateAiStudioConfig({
    savedProjects: remaining,
    activeProjectId: proj1.id,
    channelProfile: proj1.channelProfile,
  });

  cfg = getAiStudioConfig();
  assert.strictEqual(cfg.savedProjects?.length, 1, 'Should have 1 remaining project after delete');
  assert.strictEqual(cfg.activeProjectId, 'proj_test_1');
  console.log('✓ [PASS] Multi-Project saving, switching, and deletion verified successfully.');

  // =========================================================================
  console.log('\n=== TEST 2: Line-By-Line TTS Synthesis & FFmpeg Concatenation ===');
  const ttsTmpDir = path.join(os.tmpdir(), 'vanhsub-tts-test-' + Date.now());
  fs.mkdirSync(ttsTmpDir, { recursive: true });

  const testLines: ScriptBeatLine[] = [
    {
      id: 'line_1',
      index: 1,
      text: 'Hàng ngàn năm trước, các bộ lạc nguyên thủy đã học cách sinh tồn giữa thiên nhiên hoang dã.',
    },
    {
      id: 'line_2',
      index: 2,
      text: 'Họ tạo ra những ngọn lửa đầu tiên để sưởi ấm và xua đuổi dã thú trong màn đêm tăm tối.',
    },
    {
      id: 'line_3',
      index: 3,
      text: 'Đó chính là bước ngoặt vĩ đại mở đầu cho sự phát triển của nền văn minh nhân loại.',
    },
  ];

  const voiceConfig: AiStudioVoiceConfig = {
    provider: 'edge_tts',
    voiceId: 'vi-VN-HoaiMyNeural',
    rate: '+0%',
    pitch: '+0Hz',
    volume: '+0%',
    autoWordAlignment: true,
  };

  const combinedVoiceoverPath = path.join(ttsTmpDir, 'voiceover.mp3');
  console.log('Synthesizing 3 script lines line-by-line...');

  const ttsResult = await aiStudioTtsService.synthesizeVoiceover(
    testLines,
    voiceConfig,
    combinedVoiceoverPath
  );

  assert.strictEqual(fs.existsSync(combinedVoiceoverPath), true, 'Combined voiceover.mp3 must exist');
  assert.ok(ttsResult.sizeBytes > 1000, `Size must be > 1000 bytes, got ${ttsResult.sizeBytes}`);
  assert.ok(ttsResult.durationMs > 2000, `Duration must be > 2000ms, got ${ttsResult.durationMs}`);

  // Verify each line has durationMs, audioPath, startMs, and endMs
  let expectedStart = 0;
  for (const line of testLines) {
    assert.ok(line.durationMs && line.durationMs > 0, `Line ${line.index} must have durationMs`);
    assert.ok(line.audioPath && fs.existsSync(line.audioPath), `Line ${line.index} audio file must exist`);
    assert.strictEqual(line.startMs, expectedStart, `Line ${line.index} startMs must be ${expectedStart}`);
    assert.strictEqual(line.endMs, expectedStart + line.durationMs!, `Line ${line.index} endMs must match duration`);
    expectedStart += line.durationMs!;
    console.log(`  ✓ Line ${line.index}: ${line.durationMs}ms [${line.startMs}ms - ${line.endMs}ms] -> ${path.basename(line.audioPath)}`);
  }

  assert.ok(ttsResult.wordTimestamps.length > 0, 'Word timestamps must be populated');
  console.log(`✓ [PASS] Combined voiceover generated: ${ttsResult.durationMs}ms, ${ttsResult.sizeBytes} bytes, ${ttsResult.wordTimestamps.length} words.`);

  // =========================================================================
  console.log('\n=== TEST 3: Alignment Extraction Preserves Probed Audio Durations ===');
  const alignment = aiStudioTtsService.extractAlignment(
    [],
    testLines.map((l) => l.text).join(' '),
    testLines,
    ttsResult.durationMs
  );

  assert.strictEqual(alignment.alignedLines.length, 3);
  for (let i = 0; i < alignment.alignedLines.length; i++) {
    const aligned = alignment.alignedLines[i];
    const original = testLines[i];
    assert.strictEqual(aligned.durationMs, original.durationMs, `Aligned line ${i} must preserve probed durationMs`);
    assert.strictEqual(aligned.startMs, original.startMs, `Aligned line ${i} must preserve probed startMs`);
    assert.strictEqual(aligned.endMs, original.endMs, `Aligned line ${i} must preserve probed endMs`);
  }
  console.log('✓ [PASS] Alignment stage flawlessly preserved exact probed durations with zero drift.');

  // Clean up
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.rmSync(ttsTmpDir, { recursive: true, force: true });
  } catch {}

  console.log('\n==================================================');
  console.log('ALL SAVED PROJECTS & TTS VOICE TESTS PASSED! ✅');
  console.log('==================================================');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
