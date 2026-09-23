#!/usr/bin/env tsx
/**
 * scripts/test_adversarial_m2.ts
 *
 * Adversarial Stress-Testing Suite for Milestone 2 (R2: Smart Storyboard Clustering & Timing).
 * Tests extreme boundary conditions, failure modes, context shifts, and backward compatibility:
 *
 * 1. Ultra-short single sentence (< 2.0s).
 * 2. Rapid succession of ultra-short sentences (8 x 1.1s).
 * 3. Ultra-long single sentence (> 15.0s, e.g. 24.5s).
 * 4. Mixed extreme lengths (ultra-long + ultra-short combinations).
 * 5. Context shift edge cases (shifts below vs above targetMinSec).
 * 6. Backward compatibility (shotMode: 'single', 'multi', customPromptGenerator).
 * 7. Continuity chain & metadata integrity (previous_shot_id, non-overlapping assignments).
 * 8. Pipeline Engine Stage 5 mapping & index.json synchronization.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import assert from 'assert';

import { AiStudioStoryboardService } from '../main/ai-studio/services/AiStudioStoryboardService';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager';
import {
  PipelineScriptData,
  PipelineTimingData,
  StoryboardShotItem,
} from '../main/ai-studio/types/storage';

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
};

function logHeader(title: string) {
  console.log(`\n${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}  ${title}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}\n`);
}

function logPass(name: string, detail?: string) {
  console.log(`  ${colors.green}✓ [PASS]${colors.reset} ${colors.bold}${name}${colors.reset}${detail ? ` ${colors.dim}(${detail})${colors.reset}` : ''}`);
}

function logFail(name: string, error: any) {
  console.log(`  ${colors.red}✗ [FAIL]${colors.reset} ${colors.bold}${name}${colors.reset}: ${error.message || error}`);
}

async function runAdversarialTests() {
  logHeader('ADVERSARIAL STRESS TEST: Storyboard Clustering & Timing (Milestone 2)');

  const service = AiStudioStoryboardService.getInstance();
  const tempBaseDir = path.join(os.tmpdir(), `test_sb_adv_${Date.now()}`);
  fs.mkdirSync(tempBaseDir, { recursive: true });

  let passed = 0;
  let failed = 0;

  // Helper to build test environment
  function setupTestProject(projectId: string, texts: string[], durations: number[]) {
    const storage = new AiStudioDiskStorageManager(projectId, {
      baseDir: tempBaseDir,
      autoInitialize: true,
    });

    let timeline = 0;
    const scriptScenes = texts.map((t, idx) => ({
      scene_id: `scene_${String(idx + 1).padStart(2, '0')}`,
      narration: t,
      visual_note: `Visual note ${idx + 1}`,
    }));

    const timingScenes = durations.map((dur, idx) => {
      const start = Math.round(timeline * 100) / 100;
      const end = Math.round((timeline + dur) * 100) / 100;
      timeline += dur;
      return {
        scene_id: `scene_${String(idx + 1).padStart(2, '0')}`,
        audio_file: `02_voice/scene_${String(idx + 1).padStart(2, '0')}.mp3`,
        start_sec: start,
        end_sec: end,
        duration_sec: dur,
      };
    });

    const totalDur = durations.reduce((acc, d) => acc + d, 0);
    const scriptData: PipelineScriptData = { scenes: scriptScenes };
    const timingData: PipelineTimingData = {
      project_id: projectId,
      probed_engine: 'ffprobe',
      scenes: timingScenes,
      total_duration_sec: Math.round(totalDur * 100) / 100,
    };

    storage.saveScript(scriptData);
    storage.saveTiming(timingData);

    return { storage, scriptData, timingData, totalDur };
  }

  // ==========================================================================
  // TEST 1: Single Ultra-Short Sentence (< 2.0s, e.g. 1.2s)
  // ==========================================================================
  console.log(`${colors.bold}${colors.blue}▶ Test 1: Single Ultra-Short Sentence (< 2.0s)${colors.reset}`);
  try {
    const { storage, scriptData, timingData, totalDur } = setupTestProject(
      'proj_adv_single_short',
      ['Chào bạn.'],
      [1.2]
    );

    const storyboard = await service.generateStoryboard({
      storage,
      script: scriptData,
      timing: timingData,
      enableClustering: true,
      granularity: 'balanced',
    });

    assert.strictEqual(storyboard.scenes.length, 1, 'Should have exactly 1 scene');
    assert.strictEqual(storyboard.scenes[0].shots.length, 1, 'Should have exactly 1 shot');
    const shot = storyboard.scenes[0].shots[0];
    assert.strictEqual(shot.start_sec, 0, 'Shot start_sec should be 0');
    assert.strictEqual(shot.duration_sec, 1.2, 'Shot duration_sec should be 1.2');
    assert.deepStrictEqual(shot.assigned_sentences, [1], 'Assigned sentence should be [1]');
    assert.strictEqual(shot.previous_shot_id, undefined, 'First shot previous_shot_id should be undefined');
    assert.strictEqual(shot.media_type, 'image', 'Short scene (<2s) without action should default to image');

    // Verify disk
    const onDiskSb = storage.readStoryboard();
    assert(onDiskSb && onDiskSb.scenes.length === 1, 'Storyboard on disk should exist');

    logPass('Single Ultra-Short Sentence (<2s)', 'Created valid 1.2s image shot without error');
    passed++;
  } catch (err) {
    logFail('Single Ultra-Short Sentence (<2s)', err);
    failed++;
  }

  // ==========================================================================
  // TEST 2: Rapid Succession of Ultra-Short Sentences (8 x 1.1s = 8.8s)
  // ==========================================================================
  console.log(`${colors.bold}${colors.blue}▶ Test 2: Rapid Succession of Ultra-Short Sentences (8 x 1.1s)${colors.reset}`);
  try {
    const texts = [
      'Một.', 'Hai.', 'Ba.', 'Bốn.', 'Năm.', 'Sáu.', 'Bảy.', 'Tám.'
    ];
    const durations = [1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1]; // Total: 8.8s
    const { storage, scriptData, timingData, totalDur } = setupTestProject(
      'proj_adv_rapid_short',
      texts,
      durations
    );

    const storyboard = await service.generateStoryboard({
      storage,
      script: scriptData,
      timing: timingData,
      enableClustering: true,
      granularity: 'balanced',
    });

    const shots = storyboard.scenes.flatMap(s => s.shots);
    assert(shots.length >= 1 && shots.length <= 2, `Expected 1 or 2 clustered shots, got ${shots.length}`);

    // Check sentence coverage
    const assigned = shots.flatMap(s => s.assigned_sentences);
    assert.deepStrictEqual(assigned, [1, 2, 3, 4, 5, 6, 7, 8], 'All 8 sentences must be assigned in order');

    // Check drift
    const totalShotDur = shots.reduce((acc, s) => acc + s.duration_sec, 0);
    const drift = Math.abs(Math.round((totalShotDur - totalDur) * 100) / 100);
    assert.strictEqual(drift, 0, `Cumulative drift must be 0.00s, got ${drift}`);

    logPass('Rapid Succession of Short Sentences', `8 short sentences clustered into ${shots.length} shots, 0.00s drift`);
    passed++;
  } catch (err) {
    logFail('Rapid Succession of Short Sentences', err);
    failed++;
  }

  // ==========================================================================
  // TEST 3: Ultra-Long Single Sentence (> 15.0s, e.g. 24.5s)
  // ==========================================================================
  console.log(`${colors.bold}${colors.blue}▶ Test 3: Ultra-Long Single Sentence (> 15.0s, e.g. 24.5s)${colors.reset}`);
  try {
    const { storage, scriptData, timingData, totalDur } = setupTestProject(
      'proj_adv_single_long',
      ['Đây là một câu độc thoại triết học vô cùng dài miêu tả toàn bộ quá trình hình thành và phát triển của vũ trụ từ vụ nổ Big Bang cho đến sự xuất hiện của các dải ngân hà và sự sống thông minh.'],
      [24.5]
    );

    const storyboard = await service.generateStoryboard({
      storage,
      script: scriptData,
      timing: timingData,
      enableClustering: true,
      granularity: 'balanced',
    });

    assert.strictEqual(storyboard.scenes.length, 1, 'Should produce 1 scene');
    const shots = storyboard.scenes[0].shots;
    assert.strictEqual(shots.length, 1, 'Should produce 1 shot');
    assert.strictEqual(shots[0].duration_sec, 24.5, 'Duration should match probed 24.5s');
    assert.strictEqual(shots[0].start_sec, 0, 'Start sec should be 0');
    assert.deepStrictEqual(shots[0].assigned_sentences, [1], 'Sentence [1] assigned');

    logPass('Ultra-Long Single Sentence (>15s)', 'Handled 24.5s sentence cleanly with exact duration and 0 drift');
    passed++;
  } catch (err) {
    logFail('Ultra-Long Single Sentence (>15s)', err);
    failed++;
  }

  // ==========================================================================
  // TEST 4: Mixed Extreme Lengths (Ultra-Long + Ultra-Short Combinations)
  // ==========================================================================
  console.log(`${colors.bold}${colors.blue}▶ Test 4: Mixed Extreme Lengths [18.0s, 1.2s, 1.5s, 0.9s, 16.0s, 2.0s]${colors.reset}`);
  try {
    const texts = [
      'Câu 1 rất dài miêu tả toàn cảnh lịch sử kéo dài 18 giây.', // 18.0s
      'Một.', // 1.2s
      'Hai.', // 1.5s
      'Ba.', // 0.9s
      'Câu 5 cũng vô cùng dài kéo dài 16 giây kể về cuộc đời nhân vật.', // 16.0s
      'Kết thúc.', // 2.0s
    ];
    const durations = [18.0, 1.2, 1.5, 0.9, 16.0, 2.0];
    const totalExpectedDur = durations.reduce((a, b) => a + b, 0); // 39.6s

    const { storage, scriptData, timingData, totalDur } = setupTestProject(
      'proj_adv_mixed_extremes',
      texts,
      durations
    );

    const storyboard = await service.generateStoryboard({
      storage,
      script: scriptData,
      timing: timingData,
      enableClustering: true,
      granularity: 'balanced',
    });

    const shots = storyboard.scenes.flatMap(s => s.shots);

    // Assert sentence assignment completeness & sequential order
    const assignedAll = shots.flatMap(s => s.assigned_sentences);
    assert.deepStrictEqual(assignedAll, [1, 2, 3, 4, 5, 6], 'Every sentence [1..6] assigned in order');

    // Assert timeline drift is 0.00s
    const totalShotDur = shots.reduce((acc, s) => acc + s.duration_sec, 0);
    const drift = Math.abs(Math.round((totalShotDur - totalExpectedDur) * 100) / 100);
    assert.strictEqual(drift, 0, `Cumulative drift must be exactly 0.00s, got ${drift}`);

    // Assert continuous timeline: shot N start_sec = shot N-1 start_sec + duration_sec
    for (let i = 1; i < shots.length; i++) {
      const prev = shots[i - 1];
      const curr = shots[i];
      const expectedStart = Math.round((prev.start_sec + prev.duration_sec) * 100) / 100;
      assert.strictEqual(curr.start_sec, expectedStart, `Shot ${i + 1} start_sec must match prev end_sec`);
    }

    logPass('Mixed Extreme Lengths', `${texts.length} sentences clustered into ${shots.length} shots, 0.00s drift, timeline contiguous`);
    passed++;
  } catch (err) {
    logFail('Mixed Extreme Lengths', err);
    failed++;
  }

  // ==========================================================================
  // TEST 5: Context Shift Pacing Stress Test
  // ==========================================================================
  console.log(`${colors.bold}${colors.blue}▶ Test 5: Context Shift Pacing Stress Test${colors.reset}`);
  try {
    // Scenario A: Context shift when current cluster < 4.0s (should NOT seal early)
    const scriptA = [
      { scene_id: 's1', narration: 'Đoạn mở đầu ngắn.', visual_note: 'note 1' },
      { scene_id: 's2', narration: 'Tuy nhiên mọi thứ vẫn chưa rõ ràng.', visual_note: 'note 2' },
      { scene_id: 's3', narration: 'Ánh đèn tiếp tục tỏa sáng.', visual_note: 'note 3' },
    ];
    const timingA = [
      { scene_id: 's1', audio_file: '1.mp3', start_sec: 0, end_sec: 2.0, duration_sec: 2.0 },
      { scene_id: 's2', audio_file: '2.mp3', start_sec: 2.0, end_sec: 4.5, duration_sec: 2.5 },
      { scene_id: 's3', audio_file: '3.mp3', start_sec: 4.5, end_sec: 7.5, duration_sec: 3.0 },
    ];

    const clustersA = service.clusterSentencesDeterministically(scriptA, timingA, 4.0, 10.0);
    // At s1 (2.0s < 4.0s), 'Tuy nhiên' should NOT trigger early seal because currentDur (2.0s) < targetMinSec (4.0s)
    // Then s2 (2.5s) is added -> currentDur = 4.5s.
    // s3 is checked -> s3 has no shift keyword, adding s3 (3.0s) gives 7.5s <= 8.0s (idealMax).
    // All 3 sentences should fit into 1 cluster of 7.5s!
    assert.strictEqual(clustersA.length, 1, `Expected 1 cluster for Scenario A, got ${clustersA.length}`);
    assert.strictEqual(clustersA[0].duration_sec, 7.5, 'Duration should be 7.5s');

    // Scenario B: Context shift when current cluster >= 4.0s (SHOULD seal at boundary)
    const scriptB = [
      { scene_id: 's1', narration: 'Tokyo vào thế kỷ 19 chìm trong đêm tối mịt mùng.', visual_note: 'note 1' }, // 4.5s
      { scene_id: 's2', narration: 'Nhưng vào đêm 25 tháng 3, một sự kiện đã xảy ra.', visual_note: 'note 2' }, // 4.0s (Context shift keyword 'Nhưng vào đêm')
      { scene_id: 's3', narration: 'Ánh sáng bừng lên rực rỡ.', visual_note: 'note 3' }, // 3.0s
    ];
    const timingB = [
      { scene_id: 's1', audio_file: '1.mp3', start_sec: 0, end_sec: 4.5, duration_sec: 4.5 },
      { scene_id: 's2', audio_file: '2.mp3', start_sec: 4.5, end_sec: 8.5, duration_sec: 4.0 },
      { scene_id: 's3', audio_file: '3.mp3', start_sec: 8.5, end_sec: 11.5, duration_sec: 3.0 },
    ];

    const clustersB = service.clusterSentencesDeterministically(scriptB, timingB, 4.0, 10.0);
    // s1 is 4.5s >= 4.0s. s2 starts with 'nhưng vào đêm', triggering context shift -> seals cluster 1 (s1).
    // s2 (4.0s) + s3 (3.0s) = 7.0s -> forms cluster 2.
    assert.strictEqual(clustersB.length, 2, `Expected 2 clusters for Scenario B, got ${clustersB.length}`);
    assert.deepStrictEqual(clustersB[0].assigned_indices, [1], 'Cluster 1 should contain sentence 1');
    assert.deepStrictEqual(clustersB[1].assigned_indices, [2, 3], 'Cluster 2 should contain sentences 2, 3');

    logPass('Context Shift Pacing Logic', 'Protected <4s clusters from premature split; accurately split at >=4s shift boundaries');
    passed++;
  } catch (err) {
    logFail('Context Shift Pacing Logic', err);
    failed++;
  }

  // ==========================================================================
  // TEST 6: Backward Compatibility (shotMode: 'single', 'multi', customPromptGenerator)
  // ==========================================================================
  console.log(`${colors.bold}${colors.blue}▶ Test 6: Backward Compatibility (shotMode & customPromptGenerator)${colors.reset}`);
  try {
    const texts = [
      'Câu 1 rất dài và nhiều hành động bùng nổ diễn ra.',
      'Câu 2 tĩnh lặng miêu tả không gian.',
      'Câu 3 hành động tiếp diễn.',
      'Câu 4 kết luận.',
    ];
    const durations = [12.0, 4.0, 10.0, 3.0];
    const { storage, scriptData, timingData } = setupTestProject(
      'proj_adv_backward_compat',
      texts,
      durations
    );

    // 6.1 shotMode: 'single' -> strictly 1:1, NO clustering
    const sbSingle = await service.generateStoryboard({
      storage,
      script: scriptData,
      timing: timingData,
      shotMode: 'single',
    });
    assert.strictEqual(sbSingle.scenes.length, 4, 'Single mode must have 4 scenes');
    const singleShots = sbSingle.scenes.flatMap(s => s.shots);
    assert.strictEqual(singleShots.length, 4, 'Single mode must have strictly 4 shots (1:1 per scene)');

    // 6.2 shotMode: 'multi' -> multi-shot decomposition per scene, NO clustering across scenes
    const sbMulti = await service.generateStoryboard({
      storage,
      script: scriptData,
      timing: timingData,
      shotMode: 'multi',
      decompositionThresholdSec: 5.0,
    });
    assert.strictEqual(sbMulti.scenes.length, 4, 'Multi mode must preserve 4 scenes');
    const multiShots = sbMulti.scenes.flatMap(s => s.shots);
    assert(multiShots.length > 4, `Multi mode must decompose long scenes into >4 shots, got ${multiShots.length}`);
    // Scene 1 (12s) should have multiple shots
    assert(sbMulti.scenes[0].shots.length >= 2, 'Scene 1 (12s) should have >= 2 shots in multi mode');

    // 6.3 customPromptGenerator -> should call custom generator
    let customCalled = 0;
    const sbCustom = await service.generateStoryboard({
      storage,
      script: scriptData,
      timing: timingData,
      shotMode: 'single',
      customPromptGenerator: (sc, idx, total, dur) => {
        customCalled++;
        return {
          image_prompt: `CUSTOM_PROMPT_${sc.scene_id}_${idx}`,
          motion_note: 'custom pan',
        };
      },
    });
    assert(customCalled >= 4, `customPromptGenerator should be called at least 4 times, got ${customCalled}`);
    assert(sbCustom.scenes[0].shots[0].image_prompt.includes('CUSTOM_PROMPT_'), 'Custom prompt must be reflected');

    logPass('Backward Compatibility', 'Preserved 1:1 single-shot mode, multi-shot decomposition, and customPromptGenerator');
    passed++;
  } catch (err) {
    logFail('Backward Compatibility', err);
    failed++;
  }

  // ==========================================================================
  // TEST 7: Continuity Chain & Metadata Integrity (previous_shot_id & index.json)
  // ==========================================================================
  console.log(`${colors.bold}${colors.blue}▶ Test 7: Continuity Chain & Metadata Integrity${colors.reset}`);
  try {
    const texts = [
      'Đêm Tokyo tối tăm.', // 3.0s
      'Ngọn đèn dầu leo lét.', // 3.0s -> Shot 1 (6.0s)
      'Thí nghiệm bắt đầu.', // 3.5s
      'Đèn hồ quang bừng sáng.', // 3.5s -> Shot 2 (7.0s)
      'Thành phố chuyển mình rực rỡ.', // 5.0s -> Shot 3 (5.0s)
    ];
    const durations = [3.0, 3.0, 3.5, 3.5, 5.0];
    const { storage, scriptData, timingData } = setupTestProject(
      'proj_adv_continuity_test',
      texts,
      durations
    );

    const storyboard = await service.generateStoryboard({
      storage,
      script: scriptData,
      timing: timingData,
      enableClustering: true,
      granularity: 'balanced',
    });

    const shots = storyboard.scenes.flatMap(s => s.shots);
    assert.strictEqual(shots.length, 3, `Expected 3 clustered shots, got ${shots.length}`);

    // Shot 1: previous_shot_id must be undefined
    assert.strictEqual(shots[0].previous_shot_id, undefined, 'Shot 1 previous_shot_id must be undefined');
    // Shot 2: previous_shot_id must be Shot 1's ID
    assert.strictEqual(shots[1].previous_shot_id, shots[0].shot_id, `Shot 2 previous_shot_id must be ${shots[0].shot_id}`);
    // Shot 3: previous_shot_id must be Shot 2's ID
    assert.strictEqual(shots[2].previous_shot_id, shots[1].shot_id, `Shot 3 previous_shot_id must be ${shots[1].shot_id}`);

    // Check index.json metadata
    const indexData = storage.readIndex();
    assert(indexData && indexData.scenes, 'index.json scenes must exist');

    for (const shot of shots) {
      // Find shot in index.json
      let foundInIndex = false;
      for (const [scId, scMeta] of Object.entries(indexData.scenes)) {
        if (scMeta.shots && scMeta.shots[shot.shot_id]) {
          foundInIndex = true;
          const meta = scMeta.shots[shot.shot_id];
          assert.strictEqual(meta.start_sec, shot.start_sec, `index.json start_sec must match for ${shot.shot_id}`);
          assert.strictEqual(meta.duration_sec, shot.duration_sec, `index.json duration_sec must match for ${shot.shot_id}`);
          assert.deepStrictEqual(meta.assigned_sentences, shot.assigned_sentences, `index.json assigned_sentences must match`);
          assert.deepStrictEqual(meta.dialogue_lines, shot.dialogue_lines, `index.json dialogue_lines must match`);
          assert.strictEqual(meta.previous_shot_id, shot.previous_shot_id, `index.json previous_shot_id must match`);
          break;
        }
      }
      assert(foundInIndex, `Shot ${shot.shot_id} must be persisted in index.json`);
    }

    logPass('Continuity Chain & Metadata Integrity', 'previous_shot_id correctly chained, index.json holds full metadata');
    passed++;
  } catch (err) {
    logFail('Continuity Chain & Metadata Integrity', err);
    failed++;
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log(`\n${colors.bold}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}  ADVERSARIAL STRESS TEST SUMMARY: ${passed} Passed, ${failed} Failed${colors.reset}`);
  console.log(`${colors.bold}════════════════════════════════════════════════════════════════════════════════${colors.reset}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAdversarialTests().catch((err) => {
  console.error('Fatal error in adversarial test suite:', err);
  process.exit(1);
});
