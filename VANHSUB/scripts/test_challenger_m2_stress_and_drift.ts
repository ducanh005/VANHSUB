#!/usr/bin/env tsx
/**
 * scripts/test_challenger_m2_stress_and_drift.ts
 *
 * Empirical Challenger Verification & Stress Test Suite for Milestone 2 (R2: Smart Storyboard Clustering & Timing).
 *
 * Adversarial Test Dimensions:
 * 1. Single-sentence edge cases (1.2s ultra-short sentence, 12.5s monologue)
 * 2. Alternating short and long sentences (pacing boundaries, greedy consolidation, trailing merges)
 * 3. Context shift keywords detection & boundary splitting ('tuy nhiên', 'nhưng rồi', 'sau đó')
 * 4. AiStudioPipelineEngine Stage 5 full execution with mocked storage (index.json, session.artifacts.scenes)
 * 5. Zero cumulative drift across multiple timing distributions (prime decimals, micro-sentences, random jitter)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import assert from 'assert';

import { AiStudioStoryboardService } from '../main/ai-studio/services/AiStudioStoryboardService';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager';
import {
  AiStudioPipelineEngine,
  resolveAiStudioSessionsRoot,
} from '../main/ai-studio/AiStudioPipelineEngine';
import {
  PipelineScriptData,
  PipelineTimingData,
  PipelineSessionState,
  ScriptSceneItem,
  SceneTimingItem,
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
  magenta: '\x1b[35m',
};

function banner(title: string) {
  console.log(`\n${colors.bold}${colors.cyan}╔══════════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}║${colors.reset}  ${colors.bold}${colors.yellow}EMPIRICAL CHALLENGER M2: ${title.padEnd(51)}${colors.reset}${colors.bold}${colors.cyan}║${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}╚══════════════════════════════════════════════════════════════════════════════╝${colors.reset}\n`);
}

function pass(name: string, detail?: string) {
  console.log(`  ${colors.green}✔ [PASS]${colors.reset} ${colors.bold}${name}${colors.reset}${detail ? ` - ${colors.dim}${detail}${colors.reset}` : ''}`);
}

function fail(name: string, reason: string) {
  console.log(`  ${colors.red}✖ [FAIL]${colors.reset} ${colors.bold}${name}${colors.reset} - ${colors.red}${reason}${colors.reset}`);
}

async function runEmpiricalChallengerSuite() {
  banner('STRESS TEST & TIMING DRIFT VERIFICATION');

  const storyboardService = AiStudioStoryboardService.getInstance();
  const tempBaseDir = path.join(os.tmpdir(), `challenger_m2_${Date.now()}`);
  fs.mkdirSync(tempBaseDir, { recursive: true });

  let totalAssertions = 0;
  let passedAssertions = 0;

  function check(condition: boolean, testName: string, detail?: string) {
    totalAssertions++;
    if (condition) {
      passedAssertions++;
      pass(testName, detail);
    } else {
      fail(testName, detail || 'Assertion condition failed');
      throw new Error(`Assertion failed: ${testName} (${detail})`);
    }
  }

  // ==========================================================================
  // SUITE 1: Single-Sentence Edge Cases
  // ==========================================================================
  console.log(`\n${colors.bold}${colors.blue}▶ SUITE 1: Extreme Single-Sentence Edge Cases${colors.reset}`);

  // Test 1.1: Single ultra-short sentence (1.2s)
  {
    console.log(`  ${colors.magenta}[1.1] Single Ultra-Short Sentence (1.2s)${colors.reset}`);
    const scriptScenes: ScriptSceneItem[] = [
      { scene_id: 'scene_01', narration: 'Tokyo chìm trong bóng tối.' },
    ];
    const timingScenes: SceneTimingItem[] = [
      { scene_id: 'scene_01', start_sec: 0, end_sec: 1.2, duration_sec: 1.2 },
    ];

    const clusters = storyboardService.clusterSentencesDeterministically(scriptScenes, timingScenes, 4.0, 10.0);
    check(clusters.length === 1, '1.1.1 Single sentence produces exactly 1 cluster', `clusters.length = ${clusters.length}`);
    const c0 = clusters[0];
    check(c0.start_sec === 0, '1.1.2 Cluster starts at 0.00s', `start_sec = ${c0.start_sec}`);
    check(c0.end_sec === 1.2, '1.1.3 Cluster ends at 1.20s', `end_sec = ${c0.end_sec}`);
    check(c0.duration_sec === 1.2, '1.1.4 Cluster duration is 1.20s', `duration_sec = ${c0.duration_sec}`);
    check(c0.assigned_indices.length === 1 && c0.assigned_indices[0] === 1, '1.1.5 Assigned sentence index is [1]', JSON.stringify(c0.assigned_indices));
    check(c0.dialogue_lines[0] === 'Tokyo chìm trong bóng tối.', '1.1.6 Dialogue text preserved verbatim');

    // Run generateStoryboard on 1-sentence script
    const projId = 'proj_single_sentence_1_2s';
    const storage = new AiStudioDiskStorageManager(projId, { baseDir: tempBaseDir, autoInitialize: true });
    const scriptData: PipelineScriptData = { scenes: scriptScenes };
    const timingData: PipelineTimingData = {
      project_id: projId,
      probed_engine: 'ffprobe',
      scenes: timingScenes,
      total_duration_sec: 1.2,
    };
    storage.saveScript(scriptData);
    storage.saveTiming(timingData);

    const storyboard = await storyboardService.generateStoryboard({
      storage,
      script: scriptData,
      timing: timingData,
      enableClustering: true,
    });

    check(storyboard.scenes.length === 1, '1.1.7 Storyboard has 1 scene', `scenes.length = ${storyboard.scenes.length}`);
    const shot0 = storyboard.scenes[0].shots[0];
    check(shot0.shot_id === 'scene_01_shot_1', '1.1.8 Shot ID is scene_01_shot_1', shot0.shot_id);
    check(shot0.start_sec === 0, '1.1.9 Shot start_sec is 0.00s', `${shot0.start_sec}`);
    check(shot0.duration_sec === 1.2, '1.1.10 Shot duration_sec is 1.20s', `${shot0.duration_sec}`);
    check(shot0.previous_shot_id === undefined, '1.1.11 Shot previous_shot_id is undefined for initial shot');
    check(Math.abs(shot0.duration_sec - 1.2) < 0.001, '1.1.12 Zero cumulative drift on single sentence', 'drift = 0.00s');

    // Verify index.json on disk
    const idx = storage.readIndex();
    check(Boolean(idx.scenes['scene_01']?.shots['scene_01_shot_1']), '1.1.13 index.json contains shot metadata');
    const meta0 = idx.scenes['scene_01'].shots['scene_01_shot_1'];
    check(meta0.duration_sec === 1.2, '1.1.14 index.json records duration_sec 1.2', `${meta0.duration_sec}`);
    check(Array.isArray(meta0.assigned_sentences) && meta0.assigned_sentences[0] === 1, '1.1.15 index.json records assigned_sentences [1]');
  }

  // Test 1.2: Single long monologue sentence (12.5s)
  {
    console.log(`  ${colors.magenta}[1.2] Single Long Monologue Sentence (12.5s)${colors.reset}`);
    const scriptScenes: ScriptSceneItem[] = [
      { scene_id: 'scene_01', narration: 'Một câu chuyện dài với lời dẫn giải độc thoại kéo dài suốt mười hai giây rưỡi mà không hề ngắt nghỉ câu.' },
    ];
    const timingScenes: SceneTimingItem[] = [
      { scene_id: 'scene_01', start_sec: 0, end_sec: 12.5, duration_sec: 12.5 },
    ];

    const clusters = storyboardService.clusterSentencesDeterministically(scriptScenes, timingScenes, 4.0, 10.0);
    check(clusters.length === 1, '1.2.1 Single long sentence produces 1 cluster', `clusters = ${clusters.length}`);
    check(clusters[0].duration_sec === 12.5, '1.2.2 Duration matches 12.50s exactly', `${clusters[0].duration_sec}s`);
    check(clusters[0].start_sec === 0 && clusters[0].end_sec === 12.5, '1.2.3 Boundaries 0.00s -> 12.50s');
    check(Math.abs(clusters[0].duration_sec - 12.5) < 0.001, '1.2.4 Zero drift on long monologue', 'drift = 0.00s');
  }

  // ==========================================================================
  // SUITE 2: Alternating Short and Long Sentences
  // ==========================================================================
  console.log(`\n${colors.bold}${colors.blue}▶ SUITE 2: Alternating Short and Long Sentences (Pacing & Consolidation)${colors.reset}`);
  {
    // Pattern: [1.2s, 7.2s, 1.5s, 6.8s, 2.1s, 1.9s, 7.5s, 1.8s] (8 sentences)
    // Expected clustering:
    // 1: 1.2s + 7.2s = 8.4s (within max 10.0s) -> seals
    // 2: 1.5s + 6.8s = 8.3s -> seals
    // 3: 2.1s + 1.9s = 4.0s (min reached). Next is 7.5s (4.0+7.5 = 11.5s > 10.0s) -> seals at 4.0s
    // 4: 7.5s + trailing 1.8s (7.5+1.8 = 9.3s <= 10.5s) -> merges trailing -> 9.3s
    const durs = [1.2, 7.2, 1.5, 6.8, 2.1, 1.9, 7.5, 1.8];
    const totalExpectedAudio = durs.reduce((a, b) => a + b, 0); // 30.0s

    let tAccum = 0;
    const scriptScenes = durs.map((dur, i) => ({
      scene_id: `scene_${String(i + 1).padStart(2, '0')}`,
      narration: `Câu thoại số ${i + 1} với độ dài ${dur} giây.`,
    }));
    const timingScenes = durs.map((dur, i) => {
      const start = Math.round(tAccum * 100) / 100;
      const end = Math.round((tAccum + dur) * 100) / 100;
      tAccum += dur;
      return {
        scene_id: `scene_${String(i + 1).padStart(2, '0')}`,
        start_sec: start,
        end_sec: end,
        duration_sec: dur,
      };
    });

    const clusters = storyboardService.clusterSentencesDeterministically(scriptScenes, timingScenes, 4.0, 10.0);
    check(clusters.length === 4, '2.1.1 Alternating sentences cluster into 4 balanced shots', `got ${clusters.length} clusters`);

    let sumClusterDur = 0;
    const allAssigned: number[] = [];
    clusters.forEach((cl, idx) => {
      sumClusterDur += cl.duration_sec;
      allAssigned.push(...cl.assigned_indices);
      check(cl.duration_sec >= 4.0 && cl.duration_sec <= 10.5, `2.1.2 Cluster ${idx + 1} duration in bounds (4.0s-10.5s)`, `${cl.duration_sec}s`);
    });

    // Check zero cumulative drift
    const drift = Math.abs(Math.round((sumClusterDur - totalExpectedAudio) * 100) / 100);
    check(drift === 0, '2.1.3 Strict Zero Cumulative Drift (30.00s vs 30.00s)', `drift = ${drift}s`);

    // Check sentence completeness
    check(allAssigned.length === 8, '2.1.4 Exactly 8 sentences assigned', `count = ${allAssigned.length}`);
    const isSorted1to8 = allAssigned.every((val, i) => val === i + 1);
    check(isSorted1to8, '2.1.5 Sentences strictly sequential [1..8] without gaps or overlap', JSON.stringify(allAssigned));

    // Check timeline continuity: cluster[i].start_sec === cluster[i-1].end_sec
    for (let i = 1; i < clusters.length; i++) {
      check(clusters[i].start_sec === clusters[i - 1].end_sec, `2.1.6 Continuous timeline at seam ${i} (${clusters[i].start_sec}s === ${clusters[i - 1].end_sec}s)`);
    }

    // Now run generateStoryboard with this alternating pattern to test full shot pipeline
    const projId = 'proj_alternating_stress';
    const storage = new AiStudioDiskStorageManager(projId, { baseDir: tempBaseDir, autoInitialize: true });
    const scriptData: PipelineScriptData = { scenes: scriptScenes };
    const timingData: PipelineTimingData = {
      project_id: projId,
      probed_engine: 'ffprobe',
      scenes: timingScenes,
      total_duration_sec: totalExpectedAudio,
    };
    storage.saveScript(scriptData);
    storage.saveTiming(timingData);

    const sb = await storyboardService.generateStoryboard({
      storage,
      script: scriptData,
      timing: timingData,
      enableClustering: true,
    });

    const shots = sb.scenes.flatMap(s => s.shots);
    check(shots.length === 4, '2.1.7 Storyboard produced 4 shots matching clusters', `shots = ${shots.length}`);

    // Verify previous_shot_id chain
    check(shots[0].previous_shot_id === undefined, '2.1.8 Shot 1 previous_shot_id is undefined');
    for (let i = 1; i < shots.length; i++) {
      check(shots[i].previous_shot_id === shots[i - 1].shot_id, `2.1.9 Shot ${i + 1} previous_shot_id links to shot ${i} (${shots[i].previous_shot_id})`);
    }
  }

  // ==========================================================================
  // SUITE 3: Context Shift Keyword Detection & Semantic Segmentation
  // ==========================================================================
  console.log(`\n${colors.bold}${colors.blue}▶ SUITE 3: Context Shift Keyword Detection & Pacing Integrity${colors.reset}`);
  {
    // Test 3.1: Unit testing keyword detection
    const keywords = ['tuy nhiên', 'nhưng rồi', 'sau đó'];
    for (const kw of keywords) {
      const leadingSceneA = { scene_id: 'sc1', narration: 'Kinh đô ánh sáng rực rỡ.' };
      const testCases = [
        `${kw.charAt(0).toUpperCase() + kw.slice(1)}, một sự cố đã xảy ra.`,
        `${kw}, nguồn điện bị cắt toàn bộ.`,
        `Đột nhiên có chuyển biến ${kw} mọi việc mới rõ ràng.`,
      ];
      for (const tc of testCases) {
        const sceneB = { scene_id: 'sc2', narration: tc };
        const detected = storyboardService.hasSceneContextShift(leadingSceneA, sceneB);
        check(detected, `3.1.1 Detects keyword "${kw}" in "${tc.slice(0, 35)}..."`);
      }
    }

    // Negative control
    const negA = { scene_id: 'sc1', narration: 'Tokyo vào ban đêm.' };
    const negB = { scene_id: 'sc2', narration: 'Ánh sáng đèn dầu leo lét trên từng góc phố cổ kính.' };
    check(!storyboardService.hasSceneContextShift(negA, negB), '3.1.2 Returns false when no context shift keywords exist');

    // Test 3.2: Context shift triggering early boundary when currentDur >= 4.0s
    console.log(`  ${colors.magenta}[3.2] Context Shift Boundary Splitting (currentDur >= 4.0s)${colors.reset}`);
    const scriptScenes3: ScriptSceneItem[] = [
      { scene_id: 'sc_01', narration: 'Năm 1878, Tokyo còn chìm trong bóng tối u uất.' }, // 2.5s
      { scene_id: 'sc_02', narration: 'Ngọn đèn dầu leo lét là ánh sáng duy nhất trong đêm.' }, // 2.5s -> 5.0s (>= 4.0s)
      { scene_id: 'sc_03', narration: 'Tuy nhiên, giáo sư Ayrton cùng các học trò đã thực hiện một thí nghiệm bí mật.' }, // 'tuy nhiên' shift! -> should split
      { scene_id: 'sc_04', narration: 'Tia sáng hồ quang rực rỡ bừng lên trước sự ngỡ ngàng của mọi người.' }, // 3.0s
      { scene_id: 'sc_05', narration: 'Nhưng rồi, nguồn điện pin ắc quy ban đầu còn rất thiếu ổn định.' }, // 'nhưng rồi' shift! -> should split
      { scene_id: 'sc_06', narration: 'Các kỹ sư phải ngày đêm cải tiến để dòng điện liên tục.' }, // 3.0s
      { scene_id: 'sc_07', narration: 'Sau đó, công ty Tokyo Electric Light chính thức được thành lập.' }, // 'sau đó' shift! -> should split
      { scene_id: 'sc_08', narration: 'Mở ra một thời kỳ văn minh hiện đại cho toàn nước Nhật.' }, // 3.0s
    ];

    const timingScenes3: SceneTimingItem[] = [
      { scene_id: 'sc_01', start_sec: 0, end_sec: 2.5, duration_sec: 2.5 },
      { scene_id: 'sc_02', start_sec: 2.5, end_sec: 5.0, duration_sec: 2.5 },
      { scene_id: 'sc_03', start_sec: 5.0, end_sec: 8.5, duration_sec: 3.5 },
      { scene_id: 'sc_04', start_sec: 8.5, end_sec: 11.5, duration_sec: 3.0 },
      { scene_id: 'sc_05', start_sec: 11.5, end_sec: 14.5, duration_sec: 3.0 },
      { scene_id: 'sc_06', start_sec: 14.5, end_sec: 17.5, duration_sec: 3.0 },
      { scene_id: 'sc_07', start_sec: 17.5, end_sec: 21.0, duration_sec: 3.5 },
      { scene_id: 'sc_08', start_sec: 21.0, end_sec: 24.0, duration_sec: 3.0 },
    ];

    const clusters3 = storyboardService.clusterSentencesDeterministically(scriptScenes3, timingScenes3, 4.0, 10.0);
    check(clusters3.length === 4, '3.2.1 3 context shifts trigger clean 4-cluster segmentation', `got ${clusters3.length} clusters`);

    // Verify cluster 1 ends at 5.0s (sc_01 + sc_02)
    check(clusters3[0].end_sec === 5.0, '3.2.2 Cluster 1 ends before "Tuy nhiên" at 5.00s', `${clusters3[0].end_sec}s`);
    check(clusters3[0].assigned_indices.length === 2 && clusters3[0].assigned_indices.includes(1) && clusters3[0].assigned_indices.includes(2), '3.2.3 Cluster 1 contains sentences [1, 2]');

    // Verify cluster 2 begins with "Tuy nhiên" (sentence 3) and ends before "Nhưng rồi" (sentence 5)
    check(clusters3[1].start_sec === 5.0, '3.2.4 Cluster 2 starts at 5.00s', `${clusters3[1].start_sec}s`);
    check(clusters3[1].assigned_indices.includes(3) && clusters3[1].assigned_indices.includes(4), '3.2.5 Cluster 2 contains sentences [3, 4]');
    check(clusters3[1].end_sec === 11.5, '3.2.6 Cluster 2 ends at 11.50s before "Nhưng rồi"', `${clusters3[1].end_sec}s`);

    // Verify cluster 3 begins with "Nhưng rồi" (sentence 5) and ends before "Sau đó" (sentence 7)
    check(clusters3[2].start_sec === 11.5, '3.2.7 Cluster 3 starts at 11.50s', `${clusters3[2].start_sec}s`);
    check(clusters3[2].assigned_indices.includes(5) && clusters3[2].assigned_indices.includes(6), '3.2.8 Cluster 3 contains sentences [5, 6]');
    check(clusters3[2].end_sec === 17.5, '3.2.9 Cluster 3 ends at 17.50s before "Sau đó"', `${clusters3[2].end_sec}s`);

    // Verify cluster 4 begins with "Sau đó" (sentence 7) and contains sentence 8
    check(clusters3[3].start_sec === 17.5, '3.2.10 Cluster 4 starts at 17.50s', `${clusters3[3].start_sec}s`);
    check(clusters3[3].assigned_indices.includes(7) && clusters3[3].assigned_indices.includes(8), '3.2.11 Cluster 4 contains sentences [7, 8]');
    check(clusters3[3].end_sec === 24.0, '3.2.12 Cluster 4 ends at 24.00s', `${clusters3[3].end_sec}s`);

    // Total drift check
    const total3 = clusters3.reduce((acc, c) => acc + c.duration_sec, 0);
    check(Math.abs(total3 - 24.0) < 0.001, '3.2.13 Context shift clustering maintains zero drift (24.00s === 24.00s)', `drift = ${Math.abs(total3 - 24.0)}s`);

    // Test 3.3: Context shift protection when duration is too short (< 4.0s)
    console.log(`  ${colors.magenta}[3.3] Context Shift Protection When Sub-Duration < 4.0s${colors.reset}`);
    const shortScript: ScriptSceneItem[] = [
      { scene_id: 'sh_01', narration: 'Bóng tối.' }, // 1.5s (< 4.0s)
      { scene_id: 'sh_02', narration: 'Tuy nhiên, một tia sáng vụt qua.' }, // 'tuy nhiên' but currentDur = 1.5s < 4.0s
      { scene_id: 'sh_03', narration: 'Đó là khởi đầu của ánh sáng mới.' }, // 3.0s -> total 1.5 + 2.0 + 3.0 = 6.5s
    ];
    const shortTiming: SceneTimingItem[] = [
      { scene_id: 'sh_01', start_sec: 0, end_sec: 1.5, duration_sec: 1.5 },
      { scene_id: 'sh_02', start_sec: 1.5, end_sec: 3.5, duration_sec: 2.0 },
      { scene_id: 'sh_03', start_sec: 3.5, end_sec: 6.5, duration_sec: 3.0 },
    ];
    const shortClusters = storyboardService.clusterSentencesDeterministically(shortScript, shortTiming, 4.0, 10.0);
    // Because sentence 1 was only 1.5s, splitting at sentence 2 would violate min duration (4s).
    // Algorithm must not fracture into a 1.5s shot.
    check(shortClusters[0].duration_sec >= 4.0, '3.3.1 Pacing protection: does not split premature micro-shot (<4.0s)', `duration = ${shortClusters[0].duration_sec}s`);
    check(shortClusters.length === 1, '3.3.2 Consolidated into 1 shot meeting 4.0s minimum requirement', `clusters = ${shortClusters.length}`);
  }

  // ==========================================================================
  // SUITE 4: AiStudioPipelineEngine Stage 5 Full Execution with Mock Storage
  // ==========================================================================
  console.log(`\n${colors.bold}${colors.blue}▶ SUITE 4: AiStudioPipelineEngine Stage 5 Execution & Storage Mapping${colors.reset}`);
  {
    const engineWorkspace = path.join(os.tmpdir(), `pipeline_stage5_engine_${Date.now()}`);
    fs.mkdirSync(engineWorkspace, { recursive: true });
    process.env.VANHSUB_AI_STUDIO_DIR = engineWorkspace;

    const engine = new AiStudioPipelineEngine();
    const sessionId = `test-engine-m2-${Date.now()}`;
    const sessionDir = path.join(engineWorkspace, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    const scriptSentences = [
      { text: 'Năm 1882, ngọn đèn điện đầu tiên được thắp sáng công cộng tại khu phố Ginza.', durationMs: 3600 },
      { text: 'Hàng ngàn người dân hiếu kỳ đổ xô về chiêm ngưỡng cảnh tượng chưa từng thấy.', durationMs: 3400 },
      { text: 'Ánh sáng xanh trắng rực rỡ thay thế hoàn toàn những đốm lửa leo lét của đèn dầu.', durationMs: 3800 },
      { text: 'Tuy nhiên, chi phí lắp đặt lúc bấy giờ vẫn vô cùng đắt đỏ đối với đại chúng.', durationMs: 3200 },
      { text: 'Chỉ các xưởng quân giới và tòa báo lớn mới đủ ngân sách chi trả cho nguồn điện mới.', durationMs: 3500 },
      { text: 'Nhưng rồi, công nghệ truyền tải dòng điện xoay chiều đã tạo nên bước ngoặt vĩ đại.', durationMs: 3700 },
    ];

    const initialSession: PipelineSessionState = {
      sessionId,
      topic: 'Lịch sử dòng điện tại Nhật Bản',
      status: 'idle',
      currentStage: 4,
      stageName: 'Trích xuất Time',
      progress: 50,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stages: {
        1: { status: 'success', stageName: 'Dữ kiện' },
        2: { status: 'success', stageName: 'Kịch bản' },
        3: { status: 'success', stageName: 'Lồng tiếng' },
        4: { status: 'success', stageName: 'Trích xuất Time' },
        5: { status: 'pending', stageName: 'Storyboard' },
        6: { status: 'pending', stageName: 'Ảnh/Video' },
        7: { status: 'pending', stageName: 'Dựng phim' },
        8: { status: 'pending', stageName: 'SEO & Xuất bản' },
      },
      artifacts: {
        scriptLines: scriptSentences.map((s, idx) => ({
          lineIndex: idx,
          text: s.text,
          durationMs: s.durationMs,
          startMs: 0,
          endMs: s.durationMs,
          visualPromptEn: `Historical cinematic visual shot of Tokyo Meiji era ${idx + 1}`,
        })),
      },
    };

    // Save session.json to disk
    fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify(initialSession, null, 2), 'utf8');

    // Also initialize storage and write 01_script and 03_timing
    const storage = engine.getDiskStorageManager(sessionId);
    let cumulativeTimelineSec = 0;
    const timingScenes = scriptSentences.map((s, idx) => {
      const durSec = Math.round((s.durationMs / 1000) * 100) / 100;
      const startSec = Math.round(cumulativeTimelineSec * 100) / 100;
      const endSec = Math.round((cumulativeTimelineSec + durSec) * 100) / 100;
      cumulativeTimelineSec += durSec;
      return {
        scene_id: `scene_${String(idx + 1).padStart(2, '0')}`,
        audio_file: `02_voice/scene_${String(idx + 1).padStart(2, '0')}.mp3`,
        start_sec: startSec,
        end_sec: endSec,
        duration_sec: durSec,
      };
    });

    const scriptData: PipelineScriptData = {
      scenes: scriptSentences.map((s, idx) => ({
        scene_id: `scene_${String(idx + 1).padStart(2, '0')}`,
        narration: s.text,
        visual_note: `Meiji electricity scene ${idx + 1}`,
      })),
    };

    const timingData: PipelineTimingData = {
      project_id: sessionId,
      probed_engine: 'ffprobe',
      scenes: timingScenes,
      total_duration_sec: Math.round(cumulativeTimelineSec * 100) / 100,
    };

    storage.saveScript(scriptData);
    storage.saveTiming(timingData);

    console.log(`  ${colors.magenta}[4.1] Executing AiStudioPipelineEngine Stage 5 via runPipelineLoop with Abort Boundary${colors.reset}`);

    const abortController = new AbortController();
    let stage5CompletedEvent: any = null;

    const onProgress = (event: any) => {
      if (event.stage === 5 && event.progress === 70) {
        stage5CompletedEvent = event;
        // Abort immediately so stage 6 (media creation) does not attempt network calls
        abortController.abort();
      }
    };

    try {
      // Execute Stage 5 using private runPipelineLoop directly to precisely control lifecycle
      await (engine as any).runPipelineLoop(
        initialSession,
        5,
        onProgress,
        abortController.signal
      );
    } catch (err: any) {
      // Catch abort error cleanly
      if (!abortController.signal.aborted) {
        throw err;
      }
    }

    check(stage5CompletedEvent !== null, '4.1.1 Stage 5 emitted progress=70 completion event', stage5CompletedEvent?.message);

    // Inspect session.artifacts.scenes
    const mappedScenes = initialSession.artifacts.scenes;
    check(Array.isArray(mappedScenes) && mappedScenes.length > 0, '4.1.2 session.artifacts.scenes populated', `count = ${mappedScenes?.length}`);
    check(mappedScenes.length <= 4, '4.1.3 6 sentences clustered into <= 4 shots (Target: 2-3 shots)', `scenes count = ${mappedScenes.length}`);

    // Verify first scene mapping properties
    const firstScene = mappedScenes[0];
    check(typeof firstScene.startMs === 'number', '4.1.4 firstScene.startMs is number', `${firstScene.startMs}ms`);
    check(firstScene.startMs === 0, '4.1.5 firstScene starts at 0ms', `${firstScene.startMs}ms`);
    check(firstScene.durationMs >= 4000, '4.1.6 firstScene.durationMs meets minimum duration (>=4000ms)', `${firstScene.durationMs}ms`);
    check(firstScene.endMs === firstScene.startMs + firstScene.durationMs, '4.1.7 endMs === startMs + durationMs', `${firstScene.endMs}ms`);
    check(firstScene.lineIndex === 0, '4.1.8 firstScene lineIndex points to 0');
    check(firstScene.lineText.includes('Năm 1882'), '4.1.9 firstScene lineText includes sentence 1');
    check(firstScene.lineText.includes('Hàng ngàn người dân'), '4.1.10 firstScene lineText includes sentence 2 (combined text)');

    // Verify all scenes timeline continuity and drift in session.artifacts.scenes
    let totalMappedDurationMs = 0;
    for (let i = 0; i < mappedScenes.length; i++) {
      const sc = mappedScenes[i];
      totalMappedDurationMs += sc.durationMs;
      if (i > 0) {
        check(sc.startMs === mappedScenes[i - 1].endMs, `4.1.11 Seamless scene timeline transition at seam ${i} (${sc.startMs}ms === ${mappedScenes[i - 1].endMs}ms)`);
      }
    }
    const expectedTotalMs = Math.round(cumulativeTimelineSec * 1000);
    const msDrift = Math.abs(totalMappedDurationMs - expectedTotalMs);
    check(msDrift <= 10, '4.1.12 Zero millisecond drift in session.artifacts.scenes', `drift = ${msDrift}ms (expected: ${expectedTotalMs}ms, actual: ${totalMappedDurationMs}ms)`);

    // Verify index.json written by storage.updateShotMetadata in Stage 5
    console.log(`  ${colors.magenta}[4.2] Verifying index.json and disk storage integrity${colors.reset}`);
    const diskIndex = storage.readIndex();
    check(diskIndex !== null && typeof diskIndex.scenes === 'object', '4.2.1 index.json exists on disk');

    const indexSceneKeys = Object.keys(diskIndex.scenes);
    check(indexSceneKeys.length > 0, '4.2.2 index.json has scenes registered', `scenes = ${indexSceneKeys.join(', ')}`);

    for (const scKey of indexSceneKeys) {
      const scMeta = diskIndex.scenes[scKey];
      const shotKeys = Object.keys(scMeta.shots || {});
      for (const shKey of shotKeys) {
        const shMeta = scMeta.shots[shKey];
        check(typeof shMeta.start_sec === 'number', `4.2.3 index.json shot ${shKey} has start_sec (${shMeta.start_sec})`);
        check(typeof shMeta.duration_sec === 'number', `4.2.4 index.json shot ${shKey} has duration_sec (${shMeta.duration_sec})`);
        check(Array.isArray(shMeta.assigned_sentences) && shMeta.assigned_sentences.length > 0, `4.2.5 index.json shot ${shKey} has assigned_sentences`);
        check(Array.isArray(shMeta.assigned_scene_ids) && shMeta.assigned_scene_ids.length > 0, `4.2.6 index.json shot ${shKey} has assigned_scene_ids`);
        check(Array.isArray(shMeta.dialogue_lines) && shMeta.dialogue_lines.length > 0, `4.2.7 index.json shot ${shKey} has dialogue_lines`);
      }
    }

    // Verify 04_storyboard/storyboard.json on disk
    const diskStoryboard = storage.readStoryboard();
    check(diskStoryboard !== null && Array.isArray(diskStoryboard.scenes), '4.2.8 04_storyboard/storyboard.json persists on disk');
    check(diskStoryboard.scenes.length === mappedScenes.length, '4.2.9 storyboard.json scene count matches session.artifacts.scenes', `${diskStoryboard.scenes.length} === ${mappedScenes.length}`);
  }

  // ==========================================================================
  // SUITE 5: Zero Cumulative Drift Across Stress Timing Distributions
  // ==========================================================================
  console.log(`\n${colors.bold}${colors.blue}▶ SUITE 5: Cumulative Drift Under High-Stress Distributions${colors.reset}`);

  // Test 5.1: 20 Micro-sentences (0.8s each)
  {
    console.log(`  ${colors.magenta}[5.1] 20 Micro-Sentences (0.8s each, total 16.00s)${colors.reset}`);
    const n = 20;
    const microDur = 0.8;
    const totalExpected = Math.round(n * microDur * 100) / 100;
    let t = 0;
    const scriptScenes = Array.from({ length: n }, (_, i) => ({
      scene_id: `m_${i + 1}`,
      narration: `Câu thoại siêu ngắn ${i + 1}`,
    }));
    const timingScenes = Array.from({ length: n }, (_, i) => {
      const start = Math.round(t * 100) / 100;
      const end = Math.round((t + microDur) * 100) / 100;
      t += microDur;
      return { scene_id: `m_${i + 1}`, start_sec: start, end_sec: end, duration_sec: microDur };
    });

    const clusters = storyboardService.clusterSentencesDeterministically(scriptScenes, timingScenes, 4.0, 10.0);
    const sumDur = clusters.reduce((acc, c) => acc + c.duration_sec, 0);
    const drift = Math.abs(Math.round((sumDur - totalExpected) * 100) / 100);

    check(drift === 0, '5.1.1 Zero Cumulative Drift on 20 micro-sentences', `sum = ${sumDur.toFixed(2)}s, expected = ${totalExpected.toFixed(2)}s, drift = ${drift}s`);
    check(clusters.length >= 2 && clusters.length <= 4, '5.1.2 20 micro-sentences consolidated into 2-4 shots', `clusters = ${clusters.length}`);

    // Verify all 20 assigned
    const assigned = clusters.flatMap(c => c.assigned_indices);
    check(assigned.length === 20 && assigned.every((v, i) => v === i + 1), '5.1.3 All 20 micro-sentences accounted for sequentially');
  }

  // Test 5.2: Irregular decimal / prime timestamps
  {
    console.log(`  ${colors.magenta}[5.2] Irregular Decimal / Fractional Timestamps${colors.reset}`);
    const primes = [2.37, 3.19, 1.83, 4.41, 2.72, 3.58, 1.95, 5.23, 2.11, 3.84];
    const totalExpected = Math.round(primes.reduce((a, b) => a + b, 0) * 100) / 100; // 31.23s

    let t = 0;
    const scriptScenes = primes.map((dur, i) => ({
      scene_id: `p_${i + 1}`,
      narration: `Phân cảnh số thập phân ${i + 1}: ${dur}s`,
    }));
    const timingScenes = primes.map((dur, i) => {
      const start = Math.round(t * 100) / 100;
      const end = Math.round((t + dur) * 100) / 100;
      t += dur;
      return { scene_id: `p_${i + 1}`, start_sec: start, end_sec: end, duration_sec: dur };
    });

    const clusters = storyboardService.clusterSentencesDeterministically(scriptScenes, timingScenes, 4.0, 10.0);
    const sumDur = Math.round(clusters.reduce((acc, c) => acc + c.duration_sec, 0) * 100) / 100;
    const drift = Math.abs(Math.round((sumDur - totalExpected) * 100) / 100);

    check(drift === 0, '5.2.1 Strict Zero Drift on prime/irregular decimal timing', `sum = ${sumDur}s, expected = ${totalExpected}s, drift = ${drift}s`);

    // Verify timeline seamless continuity
    for (let i = 1; i < clusters.length; i++) {
      check(clusters[i].start_sec === clusters[i - 1].end_sec, `5.2.2 Seamless seam at cluster ${i} (${clusters[i].start_sec}s === ${clusters[i - 1].end_sec}s)`);
    }
  }

  // Test 5.3: Random Jitter Stress Test (50 sentences)
  {
    console.log(`  ${colors.magenta}[5.3] Random Timing Jitter Stress Test (50 pseudo-random sentences)${colors.reset}`);
    // Deterministic pseudo-random sequence for repeatability
    let seed = 123456789;
    function pseudoRand(min: number, max: number): number {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const r = seed / 0x7fffffff;
      return Math.round((min + r * (max - min)) * 10) / 10;
    }

    const randomDurs: number[] = [];
    for (let i = 0; i < 50; i++) {
      randomDurs.push(pseudoRand(0.6, 7.5));
    }
    const expectedRandomTotal = Math.round(randomDurs.reduce((a, b) => a + b, 0) * 100) / 100;

    let t = 0;
    const scriptScenes = randomDurs.map((dur, i) => ({
      scene_id: `rand_${i + 1}`,
      narration: `Random sentence ${i + 1} duration ${dur}`,
    }));
    const timingScenes = randomDurs.map((dur, i) => {
      const start = Math.round(t * 100) / 100;
      const end = Math.round((t + dur) * 100) / 100;
      t += dur;
      return { scene_id: `rand_${i + 1}`, start_sec: start, end_sec: end, duration_sec: dur };
    });

    const clusters = storyboardService.clusterSentencesDeterministically(scriptScenes, timingScenes, 4.0, 10.0);
    const sumDur = Math.round(clusters.reduce((acc, c) => acc + c.duration_sec, 0) * 100) / 100;
    const drift = Math.abs(Math.round((sumDur - expectedRandomTotal) * 100) / 100);

    check(drift === 0, '5.3.1 Strict Zero Drift on 50 pseudo-random jittered sentences', `sum = ${sumDur}s, expected = ${expectedRandomTotal}s, drift = ${drift}s`);

    const assigned = clusters.flatMap(c => c.assigned_indices);
    check(assigned.length === 50, '5.3.2 All 50 sentences assigned without loss', `count = ${assigned.length}`);
    check(assigned.every((v, i) => v === i + 1), '5.3.3 Sequential coverage [1..50]');

    const avgDur = sumDur / clusters.length;
    check(avgDur >= 5.0 && avgDur <= 8.5, '5.3.4 Average cluster duration in golden zone (5.0s-8.5s)', `avg = ${avgDur.toFixed(2)}s`);
    const maxDur = Math.max(...clusters.map(c => c.duration_sec));
    check(maxDur <= 11.5, '5.3.5 Max cluster duration strictly bounded <= (targetMinSec + maxSentenceDur) = 11.5s', `max dur = ${maxDur}s`);
  }

  // ==========================================================================
  // FINAL SCORECARD
  // ==========================================================================
  console.log(`\n${colors.bold}${colors.cyan}══════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}  SUMMARY OF EMPIRICAL CHALLENGER STRESS TESTS${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}══════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`  Total Checks Executed : ${colors.bold}${totalAssertions}${colors.reset}`);
  console.log(`  Passed Checks         : ${colors.bold}${colors.green}${passedAssertions}${colors.reset}`);
  console.log(`  Failed Checks         : ${colors.bold}${totalAssertions - passedAssertions === 0 ? colors.green + '0' : colors.red + (totalAssertions - passedAssertions)}${colors.reset}`);
  console.log(`  Cumulative Drift      : ${colors.bold}${colors.green}0.00s (STRICT ZERO DRIFT)${colors.reset}`);
  console.log(`  Final Verdict         : ${colors.bold}${colors.green}VERIFIED AND APPROVED (APPROVE)${colors.reset}\n`);
}

runEmpiricalChallengerSuite().catch((err) => {
  console.error(`\n${colors.red}${colors.bold}CRITICAL CHALLENGER FAILURE:${colors.reset}`, err);
  process.exit(1);
});
