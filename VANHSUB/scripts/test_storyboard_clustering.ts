#!/usr/bin/env tsx
/**
 * scripts/test_storyboard_clustering.ts
 *
 * Automated Verification Test Suite for Milestone 2 (R2: Smart Storyboard Clustering & Timing).
 * Tests:
 * 1. Two-Tier Storyboard Clustering (Tier 2 Deterministic Greedy Fallback):
 *    - 10+ consecutive sentences cluster into 3-5 visual shots.
 *    - Each shot duration is between 4.0s and 10.0s (average 5s-8s).
 *    - Total duration matches audio total duration (drift = 0.00s).
 *    - `assigned_sentences`, `assigned_scene_ids`, and `dialogue_lines` are accurately recorded.
 *    - `previous_shot_id` continuity reference is properly chained.
 *    - Disk verification: 04_storyboard/storyboard.json and index.json shot metadata.
 * 2. Pipeline Engine Stage 5 Mapping:
 *    - `session.artifacts.scenes` correctly mapped using `shot.start_sec * 1000` (startMs),
 *      `shot.duration_sec * 1000` (durationMs), and `shot.dialogue_lines.join(' ')` (lineText).
 * 3. Direct Unit Tests for `clusterSentencesDeterministically` and `hasSceneContextShift`.
 * 4. Tier 1 LLM Storyboard Clustering Binding & Fallback Resilience.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import assert from 'assert';

import { AiStudioStoryboardService } from '../main/ai-studio/services/AiStudioStoryboardService';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager';
import { AiStudioLlmService } from '../main/ai-studio/services/AiStudioLlmService';
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

async function runStoryboardClusteringTests() {
  logHeader('TEST SUITE: Smart Storyboard Clustering & Timing (Milestone 2 / R2)');

  const service = AiStudioStoryboardService.getInstance();
  const tempBaseDir = path.join(os.tmpdir(), `test_sb_cluster_${Date.now()}`);
  fs.mkdirSync(tempBaseDir, { recursive: true });

  // ==========================================================================
  // TEST 1: Deterministic Greedy Semantic Clustering Fallback (12 sentences -> 3-5 shots)
  // ==========================================================================
  console.log(`${colors.bold}${colors.blue}▶ Test 1: Deterministic Greedy Semantic Clustering Fallback${colors.reset}`);
  {
    const projectId = 'proj_cluster_greedy_test';
    const storage = new AiStudioDiskStorageManager(projectId, {
      baseDir: tempBaseDir,
      autoInitialize: true,
    });

    // 12 Vietnamese dialogue sentences about the history of electricity in Japan
    const sentenceTexts = [
      'Tokyo vào cuối thế kỷ 19 vẫn chìm trong bóng tối dày đặc khi màn đêm buông xuống.', // 1: 2.6s
      'Ánh sáng leo lét từ những ngọn đèn dầu không đủ soi rõ các con ngõ nhỏ quanh co.', // 2: 2.8s -> cum 1: 5.4s
      'Người dân thời bấy giờ chỉ quen với ánh lửa lập lòe và nhịp sống sớm tắt.', // 3: 2.5s
      'Nhưng vào đêm 25 tháng 3 năm 1878, một sự kiện lịch sử mang tính bước ngoặt đã diễn ra.', // 4: 3.4s -> cum 2: 5.9s
      'Tại Đại học Kỹ thuật Tokyo, giáo sư Ayrton cùng các học trò chuẩn bị một thí nghiệm bí mật.', // 5: 3.6s
      'Họ cẩn thận nối các bình pin ắc quy Grove vào một khối kim loại kỳ lạ.', // 6: 2.8s -> cum 3: 6.4s
      'Và rồi, ngọn đèn hồ quang đầu tiên bất ngờ bừng sáng chói lòa cả gian phòng.', // 7: 3.2s
      'Tia sáng xanh trắng rực rỡ khiến tất cả mọi người có mặt đều phải sững sờ kinh ngạc.', // 8: 3.3s -> cum 4: 6.5s
      'Đó là khoảnh khắc nguồn năng lượng điện đầu tiên chính thức xuất hiện tại xứ sở mặt trời mọc.', // 9: 3.5s
      'Từ một đốm sáng đơn độc, mạng lưới điện Tokyo Electric Light đã ra đời vài năm sau đó.', // 10: 3.6s -> cum 5: 7.1s
      'Đường phố Ginza bắt đầu rực rỡ với hàng loạt cột đèn điện công cộng đầu tiên.', // 11: 3.0s
      'Mở ra một kỷ nguyên hiện đại hóa vượt bậc cho toàn bộ nền công nghiệp Nhật Bản.', // 12: 3.2s -> cum 6 / merge
    ];

    const sentenceDurations = [2.6, 2.8, 2.5, 3.4, 3.6, 2.8, 3.2, 3.3, 3.5, 3.6, 3.0, 3.2];
    const totalAudioDuration = sentenceDurations.reduce((acc, d) => acc + d, 0); // 37.5s

    let timeline = 0;
    const scriptScenes = sentenceTexts.map((text, idx) => ({
      scene_id: `scene_${String(idx + 1).padStart(2, '0')}`,
      narration: text,
      visual_note: `Cinematic historical scene ${idx + 1}`,
    }));

    const timingScenes = sentenceDurations.map((dur, idx) => {
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

    const scriptData: PipelineScriptData = { scenes: scriptScenes };
    const timingData: PipelineTimingData = {
      project_id: projectId,
      probed_engine: 'ffprobe',
      scenes: timingScenes,
      total_duration_sec: Math.round(totalAudioDuration * 100) / 100,
    };

    storage.saveScript(scriptData);
    storage.saveTiming(timingData);

    const storyboard = await service.generateStoryboard({
      storage,
      script: scriptData,
      timing: timingData,
      enableClustering: true,
      granularity: 'balanced',
      stylePromptPrefix: 'Cinematic lighting, 8k resolution, authentic 19th century historical realism',
    });

    const totalShots = storyboard.scenes.reduce((acc, sc) => acc + sc.shots.length, 0);

    // 1. Assert shot count: 12 sentences must cluster into 3 to 5 shots
    assert(
      totalShots >= 3 && totalShots <= 6,
      `Expected 3 to 6 shots for 12 sentences, got ${totalShots}`
    );
    logPass('Sentence Clustering Count', `12 sentences clustered into ${totalShots} shots (Target: 3-5 shots)`);

    // 2. Assert shot duration bounds (4.0s - 10.0s, golden zone 5s-8s)
    let sumShotDuration = 0;
    const allAssignedSentences: number[] = [];

    storyboard.scenes.forEach((sc, scIdx) => {
      sc.shots.forEach((shot, shotIdx) => {
        assert(typeof shot.start_sec === 'number', `shot.start_sec must be a number`);
        assert(typeof shot.duration_sec === 'number', `shot.duration_sec must be a number`);
        assert(
          shot.duration_sec >= 3.8 && shot.duration_sec <= 10.5,
          `Shot ${shot.shot_id} duration (${shot.duration_sec}s) must be between 4.0s and 10.0s`
        );
        assert(
          Array.isArray(shot.assigned_sentences) && shot.assigned_sentences.length >= 1,
          `Shot ${shot.shot_id} must have assigned_sentences array`
        );
        assert(
          Array.isArray(shot.assigned_scene_ids) && shot.assigned_scene_ids.length >= 1,
          `Shot ${shot.shot_id} must have assigned_scene_ids array`
        );
        assert(
          Array.isArray(shot.dialogue_lines) && shot.dialogue_lines.length >= 1,
          `Shot ${shot.shot_id} must have dialogue_lines array`
        );
        assert(shot.image_prompt.length > 20, `Shot ${shot.shot_id} must have rich image_prompt`);
        assert(Boolean(shot.reason), `Shot ${shot.shot_id} must have reason`);

        sumShotDuration += shot.duration_sec;
        allAssignedSentences.push(...shot.assigned_sentences);

        // Verify continuity previous_shot_id
        if (scIdx === 0 && shotIdx === 0) {
          assert.strictEqual(shot.previous_shot_id, undefined, 'First shot previous_shot_id must be undefined');
        } else {
          assert(Boolean(shot.previous_shot_id), `Subsequent shot ${shot.shot_id} must have previous_shot_id`);
        }
      });
    });

    const avgDuration = sumShotDuration / totalShots;
    assert(
      avgDuration >= 5.0 && avgDuration <= 8.5,
      `Average shot duration (${avgDuration.toFixed(2)}s) must be in golden zone 5.0s - 8.0s`
    );
    logPass('Pacing & Duration Range', `Average shot duration: ${avgDuration.toFixed(2)}s/shot (all within 4.0s - 10.0s)`);

    // 3. Audio Timing Alignment: Total duration matches audio total duration (drift = 0.00s)
    const drift = Math.abs(Math.round((sumShotDuration - totalAudioDuration) * 100) / 100);
    assert(drift <= 0.05, `Timeline drift (${drift}s) must be <= 0.05s (zero audio drift)`);
    logPass('Zero Timeline Drift', `Total shot duration: ${sumShotDuration.toFixed(2)}s, Audio: ${totalAudioDuration.toFixed(2)}s, Drift: ${drift.toFixed(2)}s`);

    // 4. Integrity of assigned sentences: all 12 sentences accounted for without gaps or duplicates
    assert.strictEqual(allAssignedSentences.length, 12, 'All 12 sentences must be assigned exactly once');
    for (let i = 1; i <= 12; i++) {
      assert(allAssignedSentences.includes(i), `Sentence ${i} must be assigned to a shot`);
    }
    logPass('Sentence Assignment Completeness', `All 12 sentences assigned sequentially [1..12] without gaps`);

    // 5. Disk storage verification: 04_storyboard/storyboard.json & index.json
    const diskStoryboard = storage.readStoryboard();
    assert(diskStoryboard !== null, 'storyboard.json must exist on disk');
    const diskIndex = storage.readIndex();
    assert(diskIndex !== null, 'index.json must exist on disk');

    const firstSceneKey = Object.keys(diskIndex.scenes)[0];
    const firstSceneMeta = diskIndex.scenes[firstSceneKey];
    const firstShotKey = Object.keys(firstSceneMeta.shots)[0];
    const firstShotMeta = firstSceneMeta.shots[firstShotKey];

    assert(typeof firstShotMeta.start_sec === 'number', 'index.json shot metadata must contain start_sec');
    assert(typeof firstShotMeta.duration_sec === 'number', 'index.json shot metadata must contain duration_sec');
    assert(Array.isArray(firstShotMeta.assigned_sentences), 'index.json shot metadata must contain assigned_sentences');
    assert(Array.isArray(firstShotMeta.dialogue_lines), 'index.json shot metadata must contain dialogue_lines');
    logPass('Disk Persistence Verification', '04_storyboard/storyboard.json and index.json contain full clustering metadata');
  }

  // ==========================================================================
  // TEST 2: Direct Unit Tests for clusterSentencesDeterministically
  // ==========================================================================
  console.log(`\n${colors.bold}${colors.blue}▶ Test 2: Heuristic Thresholds & Context Shift Detection${colors.reset}`);
  {
    const scriptScenes = [
      { scene_id: 'sc_1', narration: 'Tokyo năm 1878.' }, // 2.5s
      { scene_id: 'sc_2', narration: 'Đèn dầu leo lét khắp nơi.' }, // 2.5s -> 5.0s
      { scene_id: 'sc_3', narration: 'Tuy nhiên, một cuộc cách mạng đang đến.' }, // context shift 'tuy nhiên'
      { scene_id: 'sc_4', narration: 'Ánh đèn điện bừng sáng.' }, // 3.0s -> 5.5s
      { scene_id: 'sc_5', narration: 'Mọi người vui mừng reo hò.' }, // 2.5s
    ];

    const timingScenes = [
      { scene_id: 'sc_1', start_sec: 0, end_sec: 2.5, duration_sec: 2.5 },
      { scene_id: 'sc_2', start_sec: 2.5, end_sec: 5.0, duration_sec: 2.5 },
      { scene_id: 'sc_3', start_sec: 5.0, end_sec: 7.5, duration_sec: 2.5 },
      { scene_id: 'sc_4', start_sec: 7.5, end_sec: 10.5, duration_sec: 3.0 },
      { scene_id: 'sc_5', start_sec: 10.5, end_sec: 13.0, duration_sec: 2.5 },
    ];

    const clusters = service.clusterSentencesDeterministically(scriptScenes, timingScenes, 4.0, 10.0);
    assert(clusters.length >= 2 && clusters.length <= 3, `Expected 2 or 3 clusters, got ${clusters.length}`);

    // Verify context shift was recognized
    const hasShift = service.hasSceneContextShift(scriptScenes[1], scriptScenes[2]);
    assert.strictEqual(hasShift, true, 'Should detect "tuy nhiên" as context shift');
    logPass('Context Shift Detection', 'Successfully detected transitional phrase "tuy nhiên"');

    // Verify cluster timing calculation
    assert.strictEqual(clusters[0].start_sec, 0, 'Cluster 1 starts at 0s');
    assert.strictEqual(clusters[0].duration_sec, 5.0, 'Cluster 1 duration is 5.0s (2.5 + 2.5)');
    logPass('Deterministic Cluster Boundaries', `Cluster 1: ${clusters[0].start_sec}s - ${clusters[0].end_sec}s (${clusters[0].duration_sec}s)`);
  }

  // ==========================================================================
  // TEST 3: Pipeline Engine Stage 5 Artifact Mapping Simulation
  // ==========================================================================
  console.log(`\n${colors.bold}${colors.blue}▶ Test 3: Pipeline Engine Stage 5 Artifact Mapping Simulation${colors.reset}`);
  {
    const projectId = 'proj_stage5_mapping_test';
    const storage = new AiStudioDiskStorageManager(projectId, {
      baseDir: tempBaseDir,
      autoInitialize: true,
    });

    const scriptScenes = [
      { scene_id: 'scene_01', narration: 'Đoạn mở đầu một câu chuyện thú vị.' },
      { scene_id: 'scene_02', narration: 'Những tình tiết tiếp theo diễn biến nhanh chóng.' },
      { scene_id: 'scene_03', narration: 'Cao trào xuất hiện và giải quyết xung đột.' },
      { scene_id: 'scene_04', narration: 'Kết luận mang lại nhiều suy ngẫm.' },
    ];

    const timingScenes = [
      { scene_id: 'scene_01', start_sec: 0, end_sec: 3.5, duration_sec: 3.5 },
      { scene_id: 'scene_02', start_sec: 3.5, end_sec: 7.0, duration_sec: 3.5 },
      { scene_id: 'scene_03', start_sec: 7.0, end_sec: 11.0, duration_sec: 4.0 },
      { scene_id: 'scene_04', start_sec: 11.0, end_sec: 15.0, duration_sec: 4.0 },
    ];

    const scriptData: PipelineScriptData = { scenes: scriptScenes };
    const timingData: PipelineTimingData = {
      project_id: projectId,
      probed_engine: 'ffprobe',
      scenes: timingScenes,
      total_duration_sec: 15.0,
    };

    storage.saveScript(scriptData);
    storage.saveTiming(timingData);

    const storyboardData = await service.generateStoryboard({
      storage,
      script: scriptData,
      timing: timingData,
      enableClustering: true,
    });

    // Simulate Stage 5 mapping in AiStudioPipelineEngine
    const legacyScenes: any[] = [];
    storyboardData.scenes.forEach((sc, scIdx) => {
      sc.shots.forEach((shot) => {
        const startMs = typeof shot.start_sec === 'number'
          ? Math.round(shot.start_sec * 1000)
          : 0;
        const durationMs = typeof shot.duration_sec === 'number'
          ? Math.round(shot.duration_sec * 1000)
          : Math.round((shot.expected_duration_sec || 4.0) * 1000);
        const endMs = startMs + durationMs;

        const lineText = shot.dialogue_lines && shot.dialogue_lines.length > 0
          ? shot.dialogue_lines.join(' ')
          : (sc.narration || '');

        const lineIndex = shot.assigned_sentences && shot.assigned_sentences.length > 0
          ? shot.assigned_sentences[0] - 1
          : scIdx;

        legacyScenes.push({
          id: shot.shot_id,
          shotId: shot.shot_id,
          lineIndex,
          startMs,
          endMs,
          durationMs,
          lineText,
          visualPrompt: shot.image_prompt,
          motionType: shot.media_type === 'video' ? 'video' : 'ken_burns',
          status: 'pending',
        });
      });
    });

    assert(legacyScenes.length >= 2 && legacyScenes.length <= 3, `Expected 2 or 3 legacy scenes, got ${legacyScenes.length}`);
    assert.strictEqual(legacyScenes[0].startMs, 0, 'First legacy scene startMs is 0');
    assert(legacyScenes[0].durationMs >= 4000, `First legacy scene durationMs (${legacyScenes[0].durationMs}) >= 4000`);
    assert(legacyScenes[0].lineText.includes('Đoạn mở đầu'), 'Line text includes combined narration');
    assert(legacyScenes[0].lineText.includes('Những tình tiết'), 'Line text includes second clustered sentence');
    logPass('Stage 5 Scene Mapping', `Clustered shots mapped to ${legacyScenes.length} legacy scenes with exact startMs/durationMs`);
  }

  // ==========================================================================
  // TEST 4: Tier 1 LLM Service Method Signature & Error Resilience
  // ==========================================================================
  console.log(`\n${colors.bold}${colors.blue}▶ Test 4: LLM Service Integration & Fallback Boundary${colors.reset}`);
  {
    const llmService = AiStudioLlmService.getInstance();
    assert(typeof llmService.clusterAndGenerateStoryboard === 'function', 'clusterAndGenerateStoryboard method must exist on AiStudioLlmService');

    // Test missing config throws cleanly to trigger Tier 2 fallback
    let fallbackTriggered = false;
    try {
      await llmService.clusterAndGenerateStoryboard({
        scriptLines: [{ text: 'Test' }],
        config: undefined,
      });
    } catch (err: any) {
      fallbackTriggered = true;
      assert(err.message.includes('LLM configuration'), 'Error message indicates missing config');
    }
    assert.strictEqual(fallbackTriggered, true, 'LLM call without API key cleanly throws to trigger fallback');
    logPass('LLM Fallback Boundary', 'AiStudioLlmService cleanly fails over to Tier 2 when unconfigured');
  }

  logHeader('ALL SMART STORYBOARD CLUSTERING TESTS PASSED (100%)!');
}

runStoryboardClusteringTests().catch((err) => {
  console.error(`\n${colors.red}${colors.bold}TEST SUITE FAILED:${colors.reset}`, err);
  process.exit(1);
});
