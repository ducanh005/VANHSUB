import os from 'os';
import path from 'path';
import fs from 'fs';
import { AiStudioStoryboardService } from '../main/ai-studio/services/AiStudioStoryboardService';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager';
import { FlowGranularity, StoryboardSynthesis } from '../main/ai-studio/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${msg}`);
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`Assertion Failed: ${msg} (Expected ${expected}, got ${actual})`);
  }
}

async function runGranularityAndSynthesisTests() {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('  TEST SUITE: Granularity & Storyboard Synthesis Optimization');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  const service = AiStudioStoryboardService.getInstance();
  const tempDir = path.join(os.tmpdir(), `test_granularity_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const storage = new AiStudioDiskStorageManager('proj_granularity_test', {
    baseDir: tempDir,
    autoInitialize: true,
  });

  try {
    // 1. Setup mock script with a static scene and a dynamic scene
    // Scene 1: Static landscape description (7.0s)
    // Scene 2: High action chase sequence (7.0s)
    const scriptScenes = [
      {
        scene_id: 'scene_01',
        narration: 'Khung cảnh thung lũng mùa thu tĩnh lặng dưới ánh hoàng hôn vàng rực rỡ.',
        visual_note: 'Bầu trời và dãy núi đằng xa tĩnh lặng, không có người qua lại.',
      },
      {
        scene_id: 'scene_02',
        narration: 'Chiếc xe cảnh sát phóng như bay, lao qua hàng rào và đuổi theo tên cướp.',
        visual_note: 'Góc máy tracking tốc độ cao, va chạm nảy lửa.',
      },
    ];

    const timingData = {
      project_id: 'proj_granularity_test',
      probed_engine: 'ffprobe',
      total_duration_sec: 14.0,
      scenes: [
        { scene_id: 'scene_01', audio_file: '02_voice/scene_01.mp3', start_sec: 0, end_sec: 7.0, duration_sec: 7.0 },
        { scene_id: 'scene_02', audio_file: '02_voice/scene_02.mp3', start_sec: 7.0, end_sec: 14.0, duration_sec: 7.0 },
      ],
    };

    // ────────────────────────────────────────────────────────────────────────
    // Test 1: BALANCED Granularity (Default)
    // - Static scene (7.0s) stays 1 shot with Ken Burns pan/zoom (prevents repetitive "Phân cảnh 1" cards)
    // - Dynamic scene (7.0s) decomposes into 2 shots for high visual pacing
    // ────────────────────────────────────────────────────────────────────────
    console.log('▶ Test 1: Balanced Granularity Pacing & De-duplication');
    const balancedSb = await service.generateStoryboard({
      storage,
      script: { project_id: 'proj_granularity_test', scenes: scriptScenes },
      timing: timingData,
      granularity: 'balanced',
    });

    assertEqual(balancedSb.scenes.length, 2, 'Balanced mode preserves all 2 scenes');
    assertEqual(balancedSb.scenes[0].shots.length, 1, 'Scene 1 (static 7s) in balanced mode stays 1 shot');
    assertEqual(balancedSb.scenes[0].shots[0].media_type, 'image', 'Scene 1 media_type is image');
    assert(
      balancedSb.scenes[0].shots[0].motion_note?.includes('Ken Burns') || false,
      'Scene 1 motion_note contains Ken Burns'
    );
    assertEqual(balancedSb.scenes[1].shots.length, 2, 'Scene 2 (dynamic action 7s) in balanced mode decomposes into 2 shots');
    console.log('  ✓ [PASS] Balanced mode: 1 shot for static scene + 2 shots for action scene (Total: 3 shots)');

    // ────────────────────────────────────────────────────────────────────────
    // Test 2: DETAILED Granularity
    // - Both scenes decompose into 2 shots (total: 4 shots)
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n▶ Test 2: Detailed Granularity Decomposition');
    const detailedSb = await service.generateStoryboard({
      storage,
      script: { project_id: 'proj_granularity_test', scenes: scriptScenes },
      timing: timingData,
      granularity: 'detailed',
    });

    assertEqual(detailedSb.scenes.length, 2, 'Detailed mode preserves all 2 scenes');
    assertEqual(detailedSb.scenes[0].shots.length, 2, 'Scene 1 in detailed mode decomposes into 2 shots');
    assertEqual(detailedSb.scenes[1].shots.length, 2, 'Scene 2 in detailed mode decomposes into 2 shots');
    assertEqual(detailedSb.synthesis?.total_shots, 4, 'Total shots in detailed mode is 4');
    console.log('  ✓ [PASS] Detailed mode: decomposes both scenes into 4 shots total');

    // ────────────────────────────────────────────────────────────────────────
    // Test 3: FAST Granularity
    // - Both scenes remain 1 shot each (1:1 mapping, total: 2 shots)
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n▶ Test 3: Fast Granularity Single-Shot Optimization');
    const fastSb = await service.generateStoryboard({
      storage,
      script: { project_id: 'proj_granularity_test', scenes: scriptScenes },
      timing: timingData,
      granularity: 'fast',
    });

    assertEqual(fastSb.scenes.length, 2, 'Fast mode preserves all 2 scenes');
    assertEqual(fastSb.scenes[0].shots.length, 1, 'Scene 1 in fast mode is 1 shot');
    assertEqual(fastSb.scenes[1].shots.length, 1, 'Scene 2 in fast mode is 1 shot');
    assertEqual(fastSb.synthesis?.total_shots, 2, 'Total shots in fast mode is 2');
    console.log('  ✓ [PASS] Fast mode: strictly 1 shot per scene (2 shots total)');

    // ────────────────────────────────────────────────────────────────────────
    // Test 4: Storyboard Synthesis Calculations & Pacing Alert
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n▶ Test 4: Storyboard Synthesis & Credit/Duration Estimation');
    const syn: StoryboardSynthesis = balancedSb.synthesis!;
    assert(!!syn, 'StoryboardSynthesis object exists on storyboardData');
    assertEqual(syn.total_shots, 3, 'Total shots = 3 in balanced');
    assertEqual(syn.total_duration_sec, 14.0, 'Total duration = 14s');
    // Avg duration: 14 / 3 = 4.7s
    assertEqual(syn.avg_duration_per_shot_sec, 4.7, 'Avg duration = 4.7s');
    assertEqual(syn.is_too_fragmented, false, 'Not fragmented when avg > 2.5s');

    // Verification of estimated time and credits:
    // estimatedProductionTimeSec = imageShots * 22 + videoShots * 65
    // estimatedCredits = imageShots * 1 + videoShots * 5
    const expectedTime = syn.image_shots * 22 + syn.video_shots * 65;
    const expectedCredits = syn.image_shots * 1 + syn.video_shots * 5;
    assertEqual(syn.estimated_production_time_sec, expectedTime, 'Estimated production time matches formula');
    assertEqual(syn.estimated_credits, expectedCredits, 'Estimated credits match formula');
    console.log(`  ✓ [PASS] Synthesis: ${syn.total_shots} shots, TB ${syn.avg_duration_per_shot_sec}s/shot, ~${expectedTime}s (${Math.round(expectedTime / 60)} phút), ~${expectedCredits} credits`);

    // ────────────────────────────────────────────────────────────────────────
    // Test 5: Fragmentation Warning Detection
    // - When average duration < 2.5s, trigger is_too_fragmented and warning
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n▶ Test 5: Fragmented Pacing Detection (< 2.5s per shot)');
    const fragmentedScenes = [
      {
        scene_id: 'scene_01',
        duration_sec: 4.0,
        narration: 'Quick shot 1',
        shots: [
          { shot_id: 'scene_01_shot_1', shot_index: 1, expected_duration_sec: 1.0, image_prompt: 'p1', media_type: 'image' as const, reason: 'r1' },
          { shot_id: 'scene_01_shot_2', shot_index: 2, expected_duration_sec: 1.0, image_prompt: 'p2', media_type: 'image' as const, reason: 'r2' },
          { shot_id: 'scene_01_shot_3', shot_index: 3, expected_duration_sec: 1.0, image_prompt: 'p3', media_type: 'image' as const, reason: 'r3' },
          { shot_id: 'scene_01_shot_4', shot_index: 4, expected_duration_sec: 1.0, image_prompt: 'p4', media_type: 'image' as const, reason: 'r4' },
        ],
      },
    ];

    const fragSynthesis = service.synthesizeStoryboard(fragmentedScenes as any, 'detailed');
    assertEqual(fragSynthesis.total_shots, 4, 'Total shots = 4');
    assertEqual(fragSynthesis.avg_duration_per_shot_sec, 1.0, 'Avg duration = 1.0s');
    assertEqual(fragSynthesis.is_too_fragmented, true, 'is_too_fragmented must be true for 1.0s/shot');
    assert(fragSynthesis.warning !== undefined, 'Warning text must be provided when fragmented');
    console.log(`  ✓ [PASS] Fragmentation alert triggered correctly: "${fragSynthesis.warning?.slice(0, 50)}..."`);

    console.log('\n════════════════════════════════════════════════════════════════════════════════');
    console.log('  ALL GRANULARITY & SYNTHESIS TESTS PASSED (5/5)!');
    console.log('════════════════════════════════════════════════════════════════════════════════\n');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

runGranularityAndSynthesisTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
