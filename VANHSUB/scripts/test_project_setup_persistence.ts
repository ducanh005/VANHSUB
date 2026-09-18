import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DEFAULT_CHANNEL_PROFILE_CONFIG as MAIN_DEFAULT_PROFILE } from '../main/ai-studio/types';
import { DEFAULT_CHANNEL_PROFILE_CONFIG as RENDERER_DEFAULT_PROFILE } from '../renderer/types/aiStudio';
import {
  getAiStudioConfig,
  updateAiStudioConfig,
  getDecryptedAiStudioConfig,
  _resetAiStudioStoreInstance,
} from '../main/store/aiStudioStore';

async function testProjectSetupPersistence() {
  console.log('=== TEST 1: Default Project Name Contract ===');
  assert.strictEqual(
    MAIN_DEFAULT_PROFILE.projectName,
    '',
    'Main DEFAULT_CHANNEL_PROFILE_CONFIG.projectName must be empty string, not dummy "kênh test"'
  );
  assert.strictEqual(
    RENDERER_DEFAULT_PROFILE.projectName,
    '',
    'Renderer DEFAULT_CHANNEL_PROFILE_CONFIG.projectName must be empty string, not dummy "kênh test"'
  );
  console.log('✓ [PASS] Default project name is empty string across main & renderer.');

  console.log('=== TEST 2: Project Setup Persistence Across Reads ===');
  // Use dedicated test temp directory
  const testDir = path.join(os.tmpdir(), `vanhsub-test-ai-studio-${Date.now()}`);
  process.env.VANHSUB_AI_STUDIO_DIR = testDir;
  _resetAiStudioStoreInstance();

  const customProject = 'Bí Ẩn Đại Dương & Khảo Cổ Biển Sâu';
  const customNiche = 'Khoa học & Khám phá đại dương';
  const customOrientation = 'Kịch tính, điện ảnh, bóc tách sự thật từng tầng hải lưu';

  // 1. Save new project from upfront setup screen
  const updated = updateAiStudioConfig({
    channelProfile: {
      projectName: customProject,
      channelNiche: customNiche,
      channelOrientation: customOrientation,
      aiProvider: 'gemini_web',
      targetLongDuration: '8_12_min',
    },
    llm: {
      provider: 'gemini_web',
    },
  });

  assert.strictEqual(
    updated.channelProfile?.projectName,
    customProject,
    'Returned config must reflect updated project name'
  );
  assert.strictEqual(
    updated.channelProfile?.channelNiche,
    customNiche,
    'Returned config must reflect updated channel niche'
  );

  // 2. Read back config using standard getter
  const readBack = getDecryptedAiStudioConfig();
  assert.strictEqual(
    readBack.channelProfile?.projectName,
    customProject,
    'Decrypted config must retain saved project name'
  );
  assert.strictEqual(
    readBack.llm.provider,
    'gemini_web',
    'LLM provider must retain saved gemini_web'
  );

  // 3. Reset store instance in memory to simulate application restart
  _resetAiStudioStoreInstance();

  const reloadedFromDisk = getDecryptedAiStudioConfig();
  assert.strictEqual(
    reloadedFromDisk.channelProfile?.projectName,
    customProject,
    'Config reloaded from disk after restart must match saved project name'
  );
  assert.strictEqual(
    reloadedFromDisk.channelProfile?.channelNiche,
    customNiche,
    'Config reloaded from disk after restart must match saved channel niche'
  );
  assert.strictEqual(
    reloadedFromDisk.channelProfile?.targetLongDuration,
    '8_12_min',
    'Target duration must persist correctly'
  );

  console.log('✓ [PASS] Project setup survives simulated app restart and reloads correctly.');

  console.log('=== TEST 3: Partial updates do not overwrite saved project name ===');
  // Update only voice config
  updateAiStudioConfig({
    voice: {
      provider: 'kokoro_tts',
      voiceId: 'vi-VN-CustomVoice',
    },
  });

  const afterVoiceUpdate = getDecryptedAiStudioConfig();
  assert.strictEqual(
    afterVoiceUpdate.channelProfile?.projectName,
    customProject,
    'Project name must remain intact after partial voice update'
  );
  assert.strictEqual(
    afterVoiceUpdate.voice.provider,
    'kokoro_tts',
    'Voice provider must be updated'
  );

  console.log('✓ [PASS] Partial config update preserves existing project name.');

  // Clean up
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}

  console.log('\nALL PROJECT SETUP PERSISTENCE TESTS PASSED! ✅');
}

testProjectSetupPersistence().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
