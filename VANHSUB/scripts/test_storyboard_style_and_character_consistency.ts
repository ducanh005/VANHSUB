import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  aiStudioStoryboardService,
  VISUAL_ART_STYLE_PRESETS,
} from '../main/ai-studio/services/AiStudioStoryboardService';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager';
import type { ChannelProfileConfig } from '../main/ai-studio/types';

async function runTests() {
  console.log('🚀 Starting Storyboard Style & Character Consistency Tests...\n');

  // =========================================================================
  // Test 1: Presets mapping and availability
  // =========================================================================
  console.log('--- Test 1: Visual Art Style Presets Integrity ---');
  const expectedPresets = ['cinematic', 'anime_ghibli', 'dark_fantasy', 'cyberpunk', 'history_doc', '3d_pixar'];
  for (const presetId of expectedPresets) {
    assert(VISUAL_ART_STYLE_PRESETS[presetId], `Preset "${presetId}" must be registered in VISUAL_ART_STYLE_PRESETS`);
    assert(VISUAL_ART_STYLE_PRESETS[presetId].stylePrefix.length > 10, `Preset "${presetId}" must have descriptive stylePrefix`);
    assert(VISUAL_ART_STYLE_PRESETS[presetId].defaultBackground.length > 10, `Preset "${presetId}" must have defaultBackground`);
  }
  console.log('✅ Test 1 Passed: All 6 visual art style presets are defined and rich.\n');

  // =========================================================================
  // Test 2: buildShotPrompt Unit Tests with Character & Background Injection
  // =========================================================================
  console.log('--- Test 2: buildShotPrompt Layered Prompt Composition ---');

  const channelProfile: Partial<ChannelProfileConfig> = {
    hostName: 'Sói Bạc',
    hostDescription: 'anthropomorphic silver wolf in a sharp charcoal suit, golden rim glasses, distinguished scholar look',
    channelCharacters: [
      {
        id: 'char_1',
        name: 'Giáo sư Cú',
        descriptionEn: 'elderly brown owl professor with round spectacles, tweed vest, wise expression',
      },
    ],
    projectBackgroundPrompt: 'Rain-slicked cyberpunk Neo-Tokyo 2099 street at midnight, neon billboards in cyan and magenta, towering holographic buildings',
    visualArtStylePreset: 'cyberpunk',
  };

  // Case A: Scene featuring host via host name
  const sceneWithHost = {
    scene_id: 'scene_01',
    narration: 'Sói Bạc bước ra sân khấu và giới thiệu chương trình tối nay.',
    visual_note: 'Sói Bạc mỉm cười chào khán giả',
  };
  const promptA = aiStudioStoryboardService.buildShotPrompt(
    sceneWithHost,
    1,
    1,
    VISUAL_ART_STYLE_PRESETS.cyberpunk.stylePrefix,
    channelProfile,
    channelProfile.projectBackgroundPrompt
  );
  console.log('Prompt A (Host):', promptA);
  assert(promptA.includes('featuring Sói Bạc: anthropomorphic silver wolf'), 'Prompt A must inject host appearance');
  assert(promptA.includes('in Rain-slicked cyberpunk Neo-Tokyo 2099'), 'Prompt A must inject project background prompt');
  assert(promptA.includes('Cyberpunk sci-fi aesthetic'), 'Prompt A must include preset art style');

  // Case B: Scene featuring channel character (Giáo sư Cú)
  const sceneWithChar = {
    scene_id: 'scene_02',
    narration: 'Giáo sư Cú giải thích hiện tượng lỗ đen kỳ bí trong vũ trụ.',
    visual_note: 'Giáo sư Cú chỉ vào tấm bản đồ thiên hà',
  };
  const promptB = aiStudioStoryboardService.buildShotPrompt(
    sceneWithChar,
    1,
    1,
    VISUAL_ART_STYLE_PRESETS.cyberpunk.stylePrefix,
    channelProfile,
    channelProfile.projectBackgroundPrompt
  );
  console.log('\nPrompt B (Character):', promptB);
  assert(promptB.includes('featuring character Giáo sư Cú (elderly brown owl professor'), 'Prompt B must inject character description');
  assert(promptB.includes('in Rain-slicked cyberpunk Neo-Tokyo 2099'), 'Prompt B must inject project background prompt');

  // Case C: Scene with generic character cue ("người dẫn")
  const sceneWithGenericCue = {
    scene_id: 'scene_03',
    narration: 'Người dẫn chương trình phân tích dữ liệu quan trọng.',
    visual_note: 'Người dẫn chỉ tay vào biểu đồ',
  };
  const promptC = aiStudioStoryboardService.buildShotPrompt(
    sceneWithGenericCue,
    1,
    1,
    VISUAL_ART_STYLE_PRESETS.cyberpunk.stylePrefix,
    channelProfile,
    channelProfile.projectBackgroundPrompt
  );
  console.log('\nPrompt C (Generic Host Cue):', promptC);
  assert(promptC.includes('featuring Sói Bạc: anthropomorphic silver wolf'), 'Prompt C must detect host from generic cue');

  // Case D: Pure environment scene without character
  const sceneEnvOnly = {
    scene_id: 'scene_04',
    narration: 'Một cơn bão từ xa cuồn cuộn kéo đến thành phố.',
    visual_note: 'Bầu trời sấm chớp trên đỉnh các tòa nhà chọc trời',
  };
  const promptD = aiStudioStoryboardService.buildShotPrompt(
    sceneEnvOnly,
    1,
    1,
    VISUAL_ART_STYLE_PRESETS.cyberpunk.stylePrefix,
    channelProfile,
    channelProfile.projectBackgroundPrompt
  );
  console.log('\nPrompt D (Environment Only):', promptD);
  assert(!promptD.includes('featuring'), 'Prompt D should NOT inject character when no character is mentioned');
  assert(promptD.includes('in Rain-slicked cyberpunk Neo-Tokyo 2099'), 'Prompt D must still retain project background prompt');

  console.log('✅ Test 2 Passed: buildShotPrompt correctly composes layered character and background prompts.\n');

  // =========================================================================
  // Test 3: Full generateStoryboard Flow with Persistence & Index Synchronization
  // =========================================================================
  console.log('--- Test 3: End-to-End generateStoryboard Execution ---');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard_style_test_'));
  const storage = new AiStudioDiskStorageManager('session_test_style_01', { baseDir: testTempDir });
  storage.ensureDirectories();

  const scriptData = {
    scenes: [
      {
        scene_id: 'scene_01',
        narration: 'Chào mừng các bạn, tôi là Sói Bạc, hôm nay chúng ta sẽ tìm hiểu về Trí tuệ nhân tạo.',
        visual_note: 'Sói Bạc ngồi trong phòng làm việc giới thiệu chủ đề',
      },
      {
        scene_id: 'scene_02',
        narration: 'Đầu tiên, Giáo sư Cú sẽ phân tích kiến trúc mạng nơ-ron từ những năm 1980.',
        visual_note: 'Giáo sư Cú đứng trước bảng công thức toán học',
      },
      {
        scene_id: 'scene_03',
        narration: 'Thế giới công nghệ đang thay đổi với tốc độ chóng mặt từng giây từng phút.',
        visual_note: 'Dòng xe bay lướt qua các tòa nhà cao tầng trong thành phố',
      },
    ],
  };
  storage.saveScript(scriptData);

  const timingData = {
    project_id: storage.projectId,
    probed_engine: 'mock' as const,
    scenes: [
      { scene_id: 'scene_01', start_sec: 0, end_sec: 3.5, duration_sec: 3.5 },
      { scene_id: 'scene_02', start_sec: 3.5, end_sec: 10.0, duration_sec: 6.5 }, // Multi-shot (> 5.0s)
      { scene_id: 'scene_03', start_sec: 10.0, end_sec: 14.0, duration_sec: 4.0 },
    ],
    total_duration_sec: 14.0,
  };
  storage.saveTiming(timingData);

  const storyboard = await aiStudioStoryboardService.generateStoryboard({
    storage,
    script: scriptData,
    timing: timingData,
    channelProfile,
    backgroundPrompt: channelProfile.projectBackgroundPrompt,
  });

  assert(storyboard.scenes.length === 3, 'Storyboard must have 3 scenes');
  assert(storyboard.scenes[0].shots.length === 1, 'Scene 1 (3.5s) must have 1 shot');
  assert(storyboard.scenes[1].shots.length >= 2, 'Scene 2 (6.5s) must decompose into >= 2 shots');
  assert(storyboard.scenes[2].shots.length === 1, 'Scene 3 (4.0s) must have 1 shot');

  // Check Shot 1 prompt (Host + Background)
  const shot1 = storyboard.scenes[0].shots[0];
  assert(shot1.image_prompt.includes('featuring Sói Bạc: anthropomorphic silver wolf'), 'Shot 1 must feature Sói Bạc');
  assert(shot1.image_prompt.includes('in Rain-slicked cyberpunk Neo-Tokyo 2099'), 'Shot 1 must have background prompt');

  // Check Shot 2.1 & 2.2 prompts (Character + Background)
  for (const shot of storyboard.scenes[1].shots) {
    assert(shot.image_prompt.includes('featuring character Giáo sư Cú'), 'Scene 2 shots must feature Giáo sư Cú');
    assert(shot.image_prompt.includes('in Rain-slicked cyberpunk Neo-Tokyo 2099'), 'Scene 2 shots must have background prompt');
  }

  // Check Shot 3 prompt (No character, Background present)
  const shot3 = storyboard.scenes[2].shots[0];
  assert(!shot3.image_prompt.includes('featuring'), 'Shot 3 must not have character');
  assert(shot3.image_prompt.includes('in Rain-slicked cyberpunk Neo-Tokyo 2099'), 'Shot 3 must have background prompt');

  // Verify on-disk storyboard.json
  const diskStoryboard = storage.readStoryboard();
  assert(diskStoryboard !== null, 'storyboard.json must exist on disk');
  assert.strictEqual(diskStoryboard?.scenes.length, 3, 'On-disk storyboard must contain 3 scenes');

  // Verify index.json metadata contains prompts
  const indexData = storage.readIndex();
  assert(indexData !== null, 'index.json must exist');
  const indexShot1 = indexData?.scenes?.scene_01?.shots?.scene_01_shot_1;
  assert(indexShot1?.image_prompt_used?.includes('in Rain-slicked cyberpunk Neo-Tokyo 2099'), 'index.json must preserve image_prompt_used with background');

  // Clean up temp dir
  fs.rmSync(testTempDir, { recursive: true, force: true });
  console.log('✅ Test 3 Passed: Full storyboard generation accurately persists and synchronizes background & character consistency.\n');

  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! (100%)\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
