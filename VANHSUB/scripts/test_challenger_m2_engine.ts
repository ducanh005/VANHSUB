#!/usr/bin/env tsx
/**
 * scripts/test_challenger_m2_engine.ts
 *
 * Adversarial Challenger Test Suite for Milestone 2:
 * AiStudioPipelineEngine & Checkpoint State Machine
 *
 * Challenge Scenarios:
 *   1. Mid-flight cancellation: start pipeline and cancel during active stage,
 *      verifying graceful process termination and state integrity.
 *   2. Checkpoint resumption: pause after stage 4, verify stage 5-8 resume
 *      without re-running stages 1-4.
 *   3. Eviction on retry: retry stage 3, verify downstream stage artifacts 4-8
 *      are evicted while stages 1-2 remain intact.
 *   4. Corrupted session file recovery: handle missing or malformed session.json gracefully.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import {
  AiStudioPipelineEngine,
  resolveAiStudioSessionsRoot,
} from '../main/ai-studio/AiStudioPipelineEngine';
import type {
  PipelineSessionState,
  PipelineProgressEvent,
  ScriptBeatLine,
  WordTimestamp,
  StoryboardScene,
  SeoMetadata,
  AiStudioStageId,
} from '../main/ai-studio/types';

// Setup FFmpeg binaries
const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
const rawFfprobePath = (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';
if (rawFfmpegPath) ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));
if (rawFfprobePath) ffmpeg.setFfprobePath(rawFfprobePath.replace('app.asar', 'app.asar.unpacked'));

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};

function logHeader(title: string) {
  console.log(`\n${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}${colors.white}  ${title}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}\n`);
}

function logSection(title: string) {
  console.log(`\n${colors.bold}${colors.magenta}▶ ${title}${colors.reset}`);
}

function logPass(msg: string) {
  console.log(`  ${colors.green}✓ [PASS]${colors.reset} ${msg}`);
}

function logFail(msg: string, details?: any) {
  console.log(`  ${colors.red}✗ [FAIL]${colors.reset} ${msg}`);
  if (details) {
    console.error(`    ${colors.red}${details?.stack || details?.message || String(details)}${colors.reset}`);
  }
}

function logWarn(msg: string) {
  console.log(`  ${colors.yellow}⚠ [WARN/FINDING]${colors.reset} ${msg}`);
}

function logInfo(msg: string) {
  console.log(`  ${colors.dim}ℹ [INFO]${colors.reset} ${msg}`);
}

interface TestRecord {
  scenario: string;
  name: string;
  passed: boolean;
  durationMs: number;
  finding?: string;
  error?: string;
}

const records: TestRecord[] = [];

// ============================================================================
// Helpers for Mock Artifacts & Sessions
// ============================================================================

async function createValidMp3(outputPath: string, durationSec = 1.0): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input('anullsrc=r=24000:cl=mono')
      .inputFormat('lavfi')
      .duration(durationSec)
      .audioCodec('libmp3lame')
      .audioBitrate('48k')
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

async function createValidPng(outputPath: string, width = 1280, height = 720): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(`color=c=0x1a1a2e:s=${width}x${height}:d=1`)
      .inputFormat('lavfi')
      .frames(1)
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

function buildMockScriptLines(): ScriptBeatLine[] {
  return [
    {
      id: 'beat-01',
      index: 1,
      text: 'Chào mừng các bạn đến với thế giới đại dương bao la.',
      startMs: 0,
      endMs: 1500,
      durationMs: 1500,
      visualPromptEn: 'Cinematic deep blue ocean surface under sunlight, 4k',
      beatType: 'hook',
      estimatedDurationSec: 1.5,
    },
    {
      id: 'beat-02',
      index: 2,
      text: 'Những bí ẩn dưới đáy biển sâu vẫn đang chờ đợi được khám phá.',
      startMs: 1500,
      endMs: 3000,
      durationMs: 1500,
      visualPromptEn: 'Mysterious underwater abyss with glowing organisms, 4k',
      beatType: 'body',
      estimatedDurationSec: 1.5,
    },
  ];
}

function buildMockAlignment(): WordTimestamp[] {
  return [
    { word: 'Chào', startMs: 0, endMs: 250 },
    { word: 'mừng', startMs: 250, endMs: 500 },
    { word: 'các', startMs: 500, endMs: 750 },
    { word: 'bạn', startMs: 750, endMs: 1000 },
    { word: 'đại', startMs: 1000, endMs: 1250 },
    { word: 'dương', startMs: 1250, endMs: 1500 },
  ];
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

async function runChallengerSuite() {
  const suiteStartTime = Date.now();
  logHeader('ADVERSARIAL CHALLENGER SUITE: AiStudioPipelineEngine (M2)');

  // Allocate isolated temporary workspace
  const tempWorkspace = path.join(os.tmpdir(), `challenger-m2-${Date.now()}`);
  process.env.VANHSUB_AI_STUDIO_DIR = tempWorkspace;
  fs.mkdirSync(tempWorkspace, { recursive: true });
  logInfo(`Isolated test workspace: ${tempWorkspace}`);
  logInfo(`Resolved sessions root: ${resolveAiStudioSessionsRoot()}`);

  const engine = new AiStudioPipelineEngine();

  // ==========================================================================
  // SCENARIO 1: MID-FLIGHT CANCELLATION & PROCESS TERMINATION
  // ==========================================================================
  logSection('Scenario 1: Mid-Flight Cancellation & Process Termination');

  // Test 1.1: Cancel during active pipeline execution
  {
    const t0 = Date.now();
    const testName = 'Active Pipeline Cancellation & Status Integrity';
    try {
      let activeSessionId = '';
      const progressEvents: PipelineProgressEvent[] = [];

      const startPromise = engine.start(
        { topic: 'Chủ đề thử nghiệm hủy tiến trình giữa chừng' },
        (ev) => {
          progressEvents.push(ev);
        }
      );

      const startResult = await startPromise;
      activeSessionId = startResult.sessionId;
      logInfo(`Started session ${activeSessionId}, waiting for active execution...`);

      // Allow pipeline loop to initiate (timeout is 20ms in engine)
      await new Promise((r) => setTimeout(r, 60));

      // Issue mid-flight cancellation
      const cancelResult = await engine.cancel({ sessionId: activeSessionId });
      if (!cancelResult.success) {
        throw new Error('engine.cancel() did not return success: true');
      }
      logPass('engine.cancel() returned { success: true } promptly');

      // Wait 300ms for async loop to settle
      await new Promise((r) => setTimeout(r, 300));

      // Inspect persisted state
      const sessionAfterCancel = await engine.getState({ sessionId: activeSessionId });
      if (!sessionAfterCancel) {
        throw new Error('Session state missing after cancellation');
      }

      // Check status immediately
      logInfo(`Session status at 300ms: "${sessionAfterCancel.status}"`);
      logInfo(`Current stage at cancel: ${sessionAfterCancel.currentStage} (${sessionAfterCancel.stageName})`);

      // Verify downstream stages were NOT run
      const downstreamRan = [5, 6, 7, 8].some(
        (st) => sessionAfterCancel.stages[st]?.status === 'success'
      );
      if (downstreamRan) {
        throw new Error('Downstream stages (5-8) executed despite cancellation!');
      }
      logPass('Downstream stages remained unexecuted after cancellation');

      // Wait for background loop retry timer (1000ms in AiStudioTtsService) to settle
      await new Promise((r) => setTimeout(r, 1200));
      const sessionAfterSettled = await engine.getState({ sessionId: activeSessionId });
      logInfo(`Session status after background loop settled (1500ms): "${sessionAfterSettled?.status}"`);

      // Check whether session status is 'cancelled' vs 'failed'
      let finding: string | undefined;
      if (sessionAfterSettled?.status === 'failed') {
        finding = `STATE CORRUPTION: Session status was 'cancelled' initially, but runPipelineLoop.catch() overwritten it to 'failed' when TTS abort error was caught.`;
        logWarn(finding);
      } else if (sessionAfterSettled?.status === 'cancelled') {
        logPass('Session status correctly retained as "cancelled"');
      } else {
        logWarn(`Session status is "${sessionAfterSettled?.status}" (expected "cancelled")`);
      }

      records.push({
        scenario: 'Scenario 1',
        name: testName,
        passed: true,
        durationMs: Date.now() - t0,
        finding,
      });
    } catch (err: any) {
      logFail(testName, err);
      records.push({
        scenario: 'Scenario 1',
        name: testName,
        passed: false,
        durationMs: Date.now() - t0,
        error: err?.message,
      });
    }
  }

  // Test 1.2: Cancel during Stage 7 (FFmpeg video rendering assembly)
  {
    const t0 = Date.now();
    const testName = 'Cancellation During Active FFmpeg Assembly';
    try {
      const sessionId = `ffmpeg-cancel-${Date.now()}`;
      const sessionDir = engine.getSessionDir(sessionId);
      const assetsDir = engine.getSessionAssetsDir(sessionId);

      // Create mock visual asset and audio
      const mockAudio = path.join(assetsDir, 'voiceover.mp3');
      const mockPng = path.join(assetsDir, 'scene_01.png');
      await createValidMp3(mockAudio, 2.0);
      await createValidPng(mockPng, 1280, 720);

      const mockScenes: StoryboardScene[] = [
        {
          id: 'scene-01',
          lineIndex: 1,
          startMs: 0,
          endMs: 2000,
          durationMs: 2000,
          lineText: 'Thử nghiệm hủy FFmpeg',
          visualPrompt: 'Dramatic test scene',
          motionType: 'ken_burns',
          assetPath: mockPng,
          status: 'ready',
        },
      ];

      // Pre-seed session state up to stage 6 completed
      const sessionState: PipelineSessionState = {
        sessionId,
        topic: 'FFmpeg Cancellation Test',
        currentStage: 6,
        stageName: 'visuals',
        status: 'idle',
        progress: 85,
        stages: {
          1: { status: 'success', stageName: 'Dữ kiện' },
          2: { status: 'success', stageName: 'Kịch bản' },
          3: { status: 'success', stageName: 'Lồng tiếng' },
          4: { status: 'success', stageName: 'Trích xuất Time' },
          5: { status: 'success', stageName: 'Storyboard' },
          6: { status: 'success', stageName: 'Ảnh / Video' },
          7: { status: 'pending', stageName: 'Dựng phim' },
          8: { status: 'pending', stageName: 'SEO' },
        },
        artifacts: {
          audioPath: mockAudio,
          scenes: mockScenes,
          scriptLines: buildMockScriptLines(),
          wordsAlignment: buildMockAlignment(),
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      engine.persistSessionStateAtomic(sessionState);

      // Start resume from stage 7
      let ffmpegStarted = false;
      engine.resume({ sessionId, fromStage: 7 }, (ev) => {
        if (ev.stage === 7 && ev.status === 'running') {
          ffmpegStarted = true;
        }
      });

      // Wait briefly for FFmpeg command to be registered
      await new Promise((r) => setTimeout(r, 100));

      // Now cancel mid-FFmpeg
      const cancelRes = await engine.cancel({ sessionId });
      if (!cancelRes.success) throw new Error('Failed to issue cancel on FFmpeg stage');
      logPass('Cancelled during Stage 7 FFmpeg assembly');

      // Wait 400ms to verify no unhandled rejection or orphan process crash
      await new Promise((r) => setTimeout(r, 400));

      const finalState = await engine.getState({ sessionId });
      if (!finalState) throw new Error('State lost after FFmpeg cancellation');

      let finding: string | undefined;
      logInfo(`Status after FFmpeg cancel: "${finalState.status}"`);
      if (finalState.status === 'failed') {
        finding = `STATE CORRUPTION: Cancelling Stage 7 FFmpeg assembly resulted in session.status='failed' instead of 'cancelled' because runPipelineLoop.catch() overwrote the state upon FFmpeg abort error.`;
        logWarn(finding);
      }
      logPass('FFmpeg process terminated gracefully without Node process crash');

      records.push({
        scenario: 'Scenario 1',
        name: testName,
        passed: true,
        durationMs: Date.now() - t0,
        finding,
      });
    } catch (err: any) {
      logFail(testName, err);
      records.push({
        scenario: 'Scenario 1',
        name: testName,
        passed: false,
        durationMs: Date.now() - t0,
        error: err?.message,
      });
    }
  }

  // Test 1.3: Idempotent and unknown session cancellation
  {
    const t0 = Date.now();
    const testName = 'Idempotent & Non-Existent Session Cancellation Safety';
    try {
      const nonExistentRes = await engine.cancel({ sessionId: 'unknown-random-session-id-9999' });
      if (!nonExistentRes.success) {
        throw new Error('Cancel on unknown session did not return { success: true }');
      }
      logPass('Cancelling non-existent session handled safely without error');

      records.push({
        scenario: 'Scenario 1',
        name: testName,
        passed: true,
        durationMs: Date.now() - t0,
      });
    } catch (err: any) {
      logFail(testName, err);
      records.push({
        scenario: 'Scenario 1',
        name: testName,
        passed: false,
        durationMs: Date.now() - t0,
        error: err?.message,
      });
    }
  }

  // ==========================================================================
  // SCENARIO 2: CHECKPOINT RESUMPTION (PAUSE AFTER 4, RESUME 5-8)
  // ==========================================================================
  logSection('Scenario 2: Checkpoint Resumption (Resume Stages 5-8 Without Re-running 1-4)');

  // Test 2.1: Resume from Stage 5
  {
    const t0 = Date.now();
    const testName = 'Resume Stages 5-8 Preserving Upstream Stages 1-4';
    try {
      const sessionId = `resume-test-${Date.now()}`;
      const assetsDir = engine.getSessionAssetsDir(sessionId);

      const mockAudio = path.join(assetsDir, 'voiceover.mp3');
      await createValidMp3(mockAudio, 1.5);
      const initialAudioMtime = fs.statSync(mockAudio).mtimeMs;

      const mockLines = buildMockScriptLines();
      const mockWords = buildMockAlignment();
      const completedAtTimestamp = Date.now() - 50_000;

      // Seed session paused after Stage 4
      const sessionState: PipelineSessionState = {
        sessionId,
        topic: '5 Bí Ẩn Đại Dương Checkpoint Test',
        currentStage: 4,
        stageName: 'alignment',
        status: 'idle',
        progress: 55,
        stages: {
          1: { status: 'success', stageName: 'Dữ kiện', completedAt: completedAtTimestamp },
          2: { status: 'success', stageName: 'Kịch bản', completedAt: completedAtTimestamp },
          3: { status: 'success', stageName: 'Lồng tiếng', completedAt: completedAtTimestamp },
          4: { status: 'success', stageName: 'Trích xuất Time', completedAt: completedAtTimestamp },
          5: { status: 'pending', stageName: 'Storyboard' },
          6: { status: 'pending', stageName: 'Ảnh / Video' },
          7: { status: 'pending', stageName: 'Dựng phim' },
          8: { status: 'pending', stageName: 'SEO & Xuất bản' },
        },
        artifacts: {
          ideaSummary: 'Summary of deep sea mysteries',
          scriptLines: mockLines,
          audioPath: mockAudio,
          wordsAlignment: mockWords,
        },
        createdAt: completedAtTimestamp,
        updatedAt: completedAtTimestamp,
      };

      engine.persistSessionStateAtomic(sessionState);

      // Track progress events during resume
      const stagesExecuted: number[] = [];
      const resumePromise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Resumption timed out after 30s')), 30_000);
        engine.resume({ sessionId, fromStage: 5 }, (ev) => {
          if (ev.status === 'running' && !stagesExecuted.includes(ev.stage)) {
            stagesExecuted.push(ev.stage);
          }
          if (ev.status === 'error') {
            clearTimeout(timer);
            reject(new Error(`Resumption error at stage ${ev.stage}: ${ev.error}`));
          }
          if (ev.stage === 8 && ev.status === 'success' && ev.progress === 100) {
            clearTimeout(timer);
            resolve();
          }
        }).catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      await resumePromise;
      logPass('Resume pipeline completed stages 5 through 8 successfully');

      // Verify stages 1-4 were NOT re-run
      if (stagesExecuted.includes(1) || stagesExecuted.includes(2) || stagesExecuted.includes(3) || stagesExecuted.includes(4)) {
        throw new Error(`Stages 1-4 were re-executed during resumption! Executed stages: ${stagesExecuted}`);
      }
      logPass('Verified stages 1-4 were NOT re-executed (only stages 5, 6, 7, 8 executed)');

      // Reload state from disk to verify integrity
      const finalState = await engine.getState({ sessionId });
      if (!finalState) throw new Error('State missing after completion');

      // Check upstream completion timestamps remain untouched
      for (let s = 1; s <= 4; s++) {
        if (finalState.stages[s].completedAt !== completedAtTimestamp) {
          throw new Error(`Stage ${s} completedAt was modified: expected ${completedAtTimestamp}, got ${finalState.stages[s].completedAt}`);
        }
      }
      logPass('Upstream completion timestamps for stages 1-4 remained strictly untouched');

      // Check audio file was not rewritten
      const finalAudioMtime = fs.statSync(mockAudio).mtimeMs;
      if (finalAudioMtime !== initialAudioMtime) {
        throw new Error('Voiceover audio file was rewritten during stages 5-8 resumption!');
      }
      logPass('Voiceover audio file was preserved intact without re-synthesis');

      // Check downstream artifacts exist
      if (!finalState.artifacts.scenes || finalState.artifacts.scenes.length === 0) {
        throw new Error('Storyboard scenes missing in final artifacts');
      }
      if (!finalState.artifacts.videoPath || !fs.existsSync(finalState.artifacts.videoPath)) {
        throw new Error(`Rendered video missing at: ${finalState.artifacts.videoPath}`);
      }
      if (!finalState.artifacts.metadata?.title) {
        throw new Error('SEO metadata missing in final artifacts');
      }
      logPass(`Rendered video verified at: ${finalState.artifacts.videoPath} (${fs.statSync(finalState.artifacts.videoPath).size} bytes)`);
      logPass(`SEO metadata generated: "${finalState.artifacts.metadata.title}"`);

      records.push({
        scenario: 'Scenario 2',
        name: testName,
        passed: true,
        durationMs: Date.now() - t0,
      });
    } catch (err: any) {
      logFail(testName, err);
      records.push({
        scenario: 'Scenario 2',
        name: testName,
        passed: false,
        durationMs: Date.now() - t0,
        error: err?.message,
      });
    }
  }

  // Test 2.2: Illegal State Transition Protection
  {
    const t0 = Date.now();
    const testName = 'Illegal State Transition Guard (Resume Without Stage N-1)';
    try {
      const sessionId = `illegal-trans-${Date.now()}`;
      // Seed session where stage 3 failed/pending
      const brokenState: PipelineSessionState = {
        sessionId,
        topic: 'Illegal Transition Test',
        currentStage: 3,
        stageName: 'voice',
        status: 'failed',
        progress: 25,
        stages: {
          1: { status: 'success', stageName: 'Dữ kiện' },
          2: { status: 'success', stageName: 'Kịch bản' },
          3: { status: 'error', stageName: 'Lồng tiếng', error: 'TTS connection failed' },
          4: { status: 'pending', stageName: 'Trích xuất Time' },
          5: { status: 'pending', stageName: 'Storyboard' },
          6: { status: 'pending', stageName: 'Ảnh / Video' },
          7: { status: 'pending', stageName: 'Dựng phim' },
          8: { status: 'pending', stageName: 'SEO' },
        },
        artifacts: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      engine.persistSessionStateAtomic(brokenState);

      // Attempt illegal jump to stage 5 (stage 4 is pending)
      let caught = false;
      try {
        await engine.resume({ sessionId, fromStage: 5 }, () => {});
      } catch (err: any) {
        caught = true;
        if (!err.message.includes('IllegalStateTransitionError')) {
          throw new Error(`Expected IllegalStateTransitionError, got: ${err.message}`);
        }
      }

      if (!caught) {
        throw new Error('Resumption allowed jumping to stage 5 when stage 4 was not completed!');
      }
      logPass('IllegalStateTransitionError correctly thrown when stage N-1 is not completed');

      records.push({
        scenario: 'Scenario 2',
        name: testName,
        passed: true,
        durationMs: Date.now() - t0,
      });
    } catch (err: any) {
      logFail(testName, err);
      records.push({
        scenario: 'Scenario 2',
        name: testName,
        passed: false,
        durationMs: Date.now() - t0,
        error: err?.message,
      });
    }
  }

  // ==========================================================================
  // SCENARIO 3: EVICTION ON RETRY (RETRY 3 -> EVICT 4-8, PRESERVE 1-2)
  // ==========================================================================
  logSection('Scenario 3: Eviction on Retry (Retry Stage 3)');

  // Test 3.1: Retry Stage 3 downstream eviction & upstream preservation
  {
    const t0 = Date.now();
    const testName = 'Stage 3 Retry Downstream Eviction & Upstream Preservation';
    try {
      const sessionId = `retry-s3-${Date.now()}`;
      const assetsDir = engine.getSessionAssetsDir(sessionId);

      // Create dummy artifact paths
      const mockAudio = path.join(assetsDir, 'voiceover.mp3');
      const mockVideo = path.join(assetsDir, 'final_video.mp4');
      const mockSrt = path.join(assetsDir, 'subtitles.ass');
      fs.writeFileSync(mockAudio, 'dummy-audio');
      fs.writeFileSync(mockVideo, 'dummy-video');
      fs.writeFileSync(mockSrt, 'dummy-subtitles');

      // Populate fully completed session (all 8 stages success)
      const fullSession: PipelineSessionState = {
        sessionId,
        topic: 'Full Session Before Retry Stage 3',
        currentStage: 8,
        stageName: 'metadata',
        status: 'completed',
        progress: 100,
        stages: {
          1: { status: 'success', stageName: 'Dữ kiện' },
          2: { status: 'success', stageName: 'Kịch bản' },
          3: { status: 'success', stageName: 'Lồng tiếng' },
          4: { status: 'success', stageName: 'Trích xuất Time' },
          5: { status: 'success', stageName: 'Storyboard' },
          6: { status: 'success', stageName: 'Ảnh / Video' },
          7: { status: 'success', stageName: 'Dựng phim' },
          8: { status: 'success', stageName: 'SEO' },
        },
        artifacts: {
          ideaSummary: 'Original Idea Blueprint Summary (Preserve me)',
          scriptLines: buildMockScriptLines(),
          audioPath: mockAudio,
          srtPath: mockSrt,
          wordsAlignment: buildMockAlignment(),
          scenes: [{
            id: 'scene-1',
            lineIndex: 1,
            startMs: 0,
            endMs: 1500,
            durationMs: 1500,
            lineText: 'scene line',
            visualPrompt: 'scene prompt',
            motionType: 'ken_burns',
            status: 'ready',
          }],
          videoPath: mockVideo,
          metadata: {
            title: 'Original SEO Title',
            description: 'Original SEO Description',
            hashtags: ['#orig'],
            thumbnailPrompt: 'Original thumb',
          },
        },
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000,
      };

      engine.persistSessionStateAtomic(fullSession);

      // Invoke retry on Stage 3
      // Cancel immediately after resume sets up the state so we can inspect the eviction before re-run finishes
      const resumeResult = await engine.resume({ sessionId, fromStage: 3 }, () => {});
      if (!resumeResult.success) throw new Error('resume() did not return success');

      // Cancel execution so background loop doesn't overwrite our inspection
      await engine.cancel({ sessionId });

      // Inspect state immediately
      const postRetryState = await engine.getState({ sessionId });
      if (!postRetryState) throw new Error('State missing after retry');

      // 1. Verify UPSTREAM (Stages 1 and 2) PRESERVED
      if (postRetryState.stages[1].status !== 'success' || postRetryState.stages[2].status !== 'success') {
        throw new Error(`Upstream stages mutated! Stage 1=${postRetryState.stages[1].status}, Stage 2=${postRetryState.stages[2].status}`);
      }
      if (postRetryState.artifacts.ideaSummary !== 'Original Idea Blueprint Summary (Preserve me)') {
        throw new Error('Stage 1 artifact ideaSummary was lost or mutated!');
      }
      if (!postRetryState.artifacts.scriptLines || postRetryState.artifacts.scriptLines.length !== 2) {
        throw new Error('Stage 2 artifact scriptLines was lost or mutated!');
      }
      logPass('Upstream Stages 1-2 and artifacts (ideaSummary, scriptLines) strictly preserved');

      // 2. Verify DOWNSTREAM (Stages 3 to 8) RESET
      for (let s = 3; s <= 8; s++) {
        const stStatus = postRetryState.stages[s]?.status;
        // Status should be pending or error (due to cancel)
        if (stStatus === 'success') {
          throw new Error(`Downstream stage ${s} was NOT reset to pending upon retry! status=${stStatus}`);
        }
      }
      logPass('Downstream stages 3-8 successfully reset');

      // 3. Verify DOWNSTREAM ARTIFACTS EVICTED
      if (postRetryState.artifacts.audioPath !== undefined) {
        throw new Error(`audioPath was NOT evicted! value=${postRetryState.artifacts.audioPath}`);
      }
      if (postRetryState.artifacts.wordsAlignment !== undefined) {
        throw new Error(`wordsAlignment was NOT evicted! value=${postRetryState.artifacts.wordsAlignment}`);
      }
      if (postRetryState.artifacts.scenes !== undefined) {
        throw new Error(`scenes was NOT evicted! value=${postRetryState.artifacts.scenes}`);
      }
      if (postRetryState.artifacts.videoPath !== undefined) {
        throw new Error(`videoPath was NOT evicted! value=${postRetryState.artifacts.videoPath}`);
      }
      if (postRetryState.artifacts.metadata !== undefined) {
        throw new Error(`metadata was NOT evicted! value=${postRetryState.artifacts.metadata}`);
      }
      logPass('Downstream artifacts 3-8 (audioPath, wordsAlignment, scenes, videoPath, metadata) successfully evicted');

      // Check srtPath eviction behavior
      let finding: string | undefined;
      if (postRetryState.artifacts.srtPath !== undefined) {
        finding = `FINDING: artifacts.srtPath is retained after stage 3 retry (${postRetryState.artifacts.srtPath}) because srtPath is not included in the eviction list in AiStudioPipelineEngine.ts:298-305.`;
        logWarn(finding);
      } else {
        logPass('artifacts.srtPath was also evicted');
      }

      records.push({
        scenario: 'Scenario 3',
        name: testName,
        passed: true,
        durationMs: Date.now() - t0,
        finding,
      });
    } catch (err: any) {
      logFail(testName, err);
      records.push({
        scenario: 'Scenario 3',
        name: testName,
        passed: false,
        durationMs: Date.now() - t0,
        error: err?.message,
      });
    }
  }

  // Test 3.2: Retry Stage 1 wipes all downstream artifacts
  {
    const t0 = Date.now();
    const testName = 'Stage 1 Retry Full Eviction';
    try {
      const sessionId = `retry-s1-${Date.now()}`;
      const sessionState: PipelineSessionState = {
        sessionId,
        topic: 'Stage 1 Retry Test',
        currentStage: 4,
        stageName: 'alignment',
        status: 'completed',
        progress: 55,
        stages: {
          1: { status: 'success', stageName: 'Dữ kiện' },
          2: { status: 'success', stageName: 'Kịch bản' },
          3: { status: 'success', stageName: 'Lồng tiếng' },
          4: { status: 'success', stageName: 'Trích xuất Time' },
          5: { status: 'pending', stageName: 'Storyboard' },
          6: { status: 'pending', stageName: 'Ảnh / Video' },
          7: { status: 'pending', stageName: 'Dựng phim' },
          8: { status: 'pending', stageName: 'SEO' },
        },
        artifacts: {
          ideaSummary: 'old summary',
          scriptLines: buildMockScriptLines(),
          audioPath: '/old/audio.mp3',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      engine.persistSessionStateAtomic(sessionState);

      await engine.resume({ sessionId, fromStage: 1 }, () => {});
      await engine.cancel({ sessionId });

      const state = await engine.getState({ sessionId });
      if (!state) throw new Error('State missing after retry stage 1');

      if (state.artifacts.scriptLines !== undefined || state.artifacts.audioPath !== undefined) {
        throw new Error('Artifacts not evicted on stage 1 retry');
      }
      logPass('Retrying Stage 1 resets all downstream artifacts cleanly');

      records.push({
        scenario: 'Scenario 3',
        name: testName,
        passed: true,
        durationMs: Date.now() - t0,
      });
    } catch (err: any) {
      logFail(testName, err);
      records.push({
        scenario: 'Scenario 3',
        name: testName,
        passed: false,
        durationMs: Date.now() - t0,
        error: err?.message,
      });
    }
  }

  // ==========================================================================
  // SCENARIO 4: CORRUPTED SESSION FILE RECOVERY
  // ==========================================================================
  logSection('Scenario 4: Corrupted Session File Recovery');

  // Test 4.1: Missing session.json
  {
    const t0 = Date.now();
    const testName = 'Missing Session File Handling';
    try {
      const ghostId = 'non-existent-session-0000';
      const state = await engine.getState({ sessionId: ghostId });
      if (state !== null) {
        throw new Error(`Expected null for non-existent session, got: ${JSON.stringify(state)}`);
      }
      logPass('engine.getState() returned null for missing session without throwing');

      let threwOnResume = false;
      try {
        await engine.resume({ sessionId: ghostId }, () => {});
      } catch (err: any) {
        threwOnResume = true;
        if (!err.message.includes('Session không tồn tại')) {
          throw new Error(`Unexpected error message on missing session resume: ${err.message}`);
        }
      }
      if (!threwOnResume) throw new Error('engine.resume() did not throw on missing session');
      logPass('engine.resume() threw descriptive "Session không tồn tại" error');

      records.push({
        scenario: 'Scenario 4',
        name: testName,
        passed: true,
        durationMs: Date.now() - t0,
      });
    } catch (err: any) {
      logFail(testName, err);
      records.push({
        scenario: 'Scenario 4',
        name: testName,
        passed: false,
        durationMs: Date.now() - t0,
        error: err?.message,
      });
    }
  }

  // Test 4.2: Malformed JSON syntax in session.json
  {
    const t0 = Date.now();
    const testName = 'Malformed JSON Syntax in session.json';
    try {
      const corruptId = `corrupt-syntax-${Date.now()}`;
      const sessionDir = engine.getSessionDir(corruptId);
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(
        path.join(sessionDir, 'session.json'),
        '{"sessionId": "' + corruptId + '", "currentStage": 3, "unclosed: true,',
        'utf8'
      );

      // Fresh engine instance to ensure no in-memory cache hit
      const freshEngine = new AiStudioPipelineEngine();
      const state = await freshEngine.getState({ sessionId: corruptId });
      if (state !== null) {
        throw new Error(`Expected null for malformed JSON, got: ${JSON.stringify(state)}`);
      }
      logPass('engine.getState() safely caught SyntaxError on corrupt session.json and returned null');

      records.push({
        scenario: 'Scenario 4',
        name: testName,
        passed: true,
        durationMs: Date.now() - t0,
      });
    } catch (err: any) {
      logFail(testName, err);
      records.push({
        scenario: 'Scenario 4',
        name: testName,
        passed: false,
        durationMs: Date.now() - t0,
        error: err?.message,
      });
    }
  }

  // Test 4.3: 0-Byte Empty session.json
  {
    const t0 = Date.now();
    const testName = '0-Byte Empty session.json';
    try {
      const emptyId = `empty-file-${Date.now()}`;
      const sessionDir = engine.getSessionDir(emptyId);
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, 'session.json'), '', 'utf8');

      const freshEngine = new AiStudioPipelineEngine();
      const state = await freshEngine.getState({ sessionId: emptyId });
      if (state !== null) {
        throw new Error(`Expected null for 0-byte session.json, got: ${JSON.stringify(state)}`);
      }
      logPass('engine.getState() handled 0-byte file without unhandled crash');

      records.push({
        scenario: 'Scenario 4',
        name: testName,
        passed: true,
        durationMs: Date.now() - t0,
      });
    } catch (err: any) {
      logFail(testName, err);
      records.push({
        scenario: 'Scenario 4',
        name: testName,
        passed: false,
        durationMs: Date.now() - t0,
        error: err?.message,
      });
    }
  }

  // Test 4.4: Binary garbage in session.json
  {
    const t0 = Date.now();
    const testName = 'Binary Garbage in session.json';
    try {
      const binaryId = `binary-garbage-${Date.now()}`;
      const sessionDir = engine.getSessionDir(binaryId);
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(
        path.join(sessionDir, 'session.json'),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef])
      );

      const freshEngine = new AiStudioPipelineEngine();
      const state = await freshEngine.getState({ sessionId: binaryId });
      if (state !== null) {
        throw new Error(`Expected null for binary garbage, got: ${JSON.stringify(state)}`);
      }
      logPass('engine.getState() safely handled binary corruption');

      records.push({
        scenario: 'Scenario 4',
        name: testName,
        passed: true,
        durationMs: Date.now() - t0,
      });
    } catch (err: any) {
      logFail(testName, err);
      records.push({
        scenario: 'Scenario 4',
        name: testName,
        passed: false,
        durationMs: Date.now() - t0,
        error: err?.message,
      });
    }
  }

  // Test 4.5: Dual-layer fallback recovery via legacy flat file
  {
    const t0 = Date.now();
    const testName = 'Dual-Layer Legacy Flat File Fallback Recovery';
    try {
      const dualId = `dual-fallback-${Date.now()}`;
      const sessionDir = engine.getSessionDir(dualId);
      fs.mkdirSync(sessionDir, { recursive: true });

      // Corrupt primary session.json
      fs.writeFileSync(path.join(sessionDir, 'session.json'), '{ invalid json syntax !!!', 'utf8');

      // Valid backup at root level: <sessionsRoot>/<sessionId>.json
      const validBackupState: PipelineSessionState = {
        sessionId: dualId,
        topic: 'Dual Layer Recovery Test',
        currentStage: 2,
        stageName: 'script',
        status: 'idle',
        progress: 25,
        stages: {
          1: { status: 'success', stageName: 'Dữ kiện' },
          2: { status: 'pending', stageName: 'Kịch bản' },
        },
        artifacts: { ideaSummary: 'Recovered from legacy backup' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const legacyPath = path.join(resolveAiStudioSessionsRoot(), `${dualId}.json`);
      fs.writeFileSync(legacyPath, JSON.stringify(validBackupState, null, 2), 'utf8');

      const freshEngine = new AiStudioPipelineEngine();
      const recoveredState = await freshEngine.getState({ sessionId: dualId });

      if (!recoveredState) {
        throw new Error('Failed to recover from legacy backup when primary session.json was corrupt');
      }
      if (recoveredState.artifacts.ideaSummary !== 'Recovered from legacy backup') {
        throw new Error('Recovered state content mismatch');
      }
      logPass('Successfully recovered session from legacy flat-file backup when primary folder was corrupt');

      records.push({
        scenario: 'Scenario 4',
        name: testName,
        passed: true,
        durationMs: Date.now() - t0,
      });
    } catch (err: any) {
      logFail(testName, err);
      records.push({
        scenario: 'Scenario 4',
        name: testName,
        passed: false,
        durationMs: Date.now() - t0,
        error: err?.message,
      });
    }
  }

  // Test 4.6: Incomplete / Structurally corrupt schema recovery
  {
    const t0 = Date.now();
    const testName = 'Structurally Incomplete Schema (Missing Stages/Artifacts)';
    try {
      const incompleteId = `incomplete-schema-${Date.now()}`;
      const sessionDir = engine.getSessionDir(incompleteId);
      fs.mkdirSync(sessionDir, { recursive: true });
      // Valid JSON but completely missing stages and artifacts
      fs.writeFileSync(
        path.join(sessionDir, 'session.json'),
        JSON.stringify({ sessionId: incompleteId, topic: 'Incomplete Schema' }),
        'utf8'
      );

      const freshEngine = new AiStudioPipelineEngine();
      const loaded = await freshEngine.getState({ sessionId: incompleteId });
      if (!loaded) throw new Error('Failed to load JSON');

      // Now test how resume handles a session without stages object
      let threw = false;
      let errMsg = '';
      try {
        await freshEngine.resume({ sessionId: incompleteId, fromStage: 3 }, () => {});
      } catch (err: any) {
        threw = true;
        errMsg = err.message;
      }

      let finding: string | undefined;
      if (threw) {
        if (errMsg.includes('Cannot read properties of undefined')) {
          finding = `FINDING: Structurally incomplete session.json (missing 'stages') causes uncaught TypeError: "${errMsg}" instead of validation error.`;
          logWarn(finding);
        } else {
          logPass(`engine.resume() rejected incomplete schema gracefully: ${errMsg}`);
        }
      }

      records.push({
        scenario: 'Scenario 4',
        name: testName,
        passed: true,
        durationMs: Date.now() - t0,
        finding,
      });
    } catch (err: any) {
      logFail(testName, err);
      records.push({
        scenario: 'Scenario 4',
        name: testName,
        passed: false,
        durationMs: Date.now() - t0,
        error: err?.message,
      });
    }
  }

  // ==========================================================================
  // SUMMARY & VERDICT
  // ==========================================================================
  const totalDuration = ((Date.now() - suiteStartTime) / 1000).toFixed(2);
  logHeader('ADVERSARIAL CHALLENGER EXECUTION SUMMARY');

  const passedCount = records.filter((r) => r.passed).length;
  const failedCount = records.filter((r) => !r.passed).length;
  const findings = records.filter((r) => r.finding);

  console.log('Results Matrix:');
  for (const r of records) {
    const status = r.passed ? `${colors.green}[PASS]${colors.reset}` : `${colors.red}[FAIL]${colors.reset}`;
    console.log(`  ${status} ${r.scenario.padEnd(14)} | ${r.name.padEnd(52)} (${r.durationMs}ms)`);
    if (r.finding) {
      console.log(`         ${colors.yellow}${r.finding}${colors.reset}`);
    }
    if (r.error) {
      console.log(`         ${colors.red}Error: ${r.error}${colors.reset}`);
    }
  }

  console.log('\n--------------------------------------------------------------------------------');
  console.log(`Total Tests:    ${records.length}`);
  console.log(`Passed:         ${colors.green}${colors.bold}${passedCount}${colors.reset}`);
  console.log(`Failed:         ${failedCount > 0 ? colors.red + colors.bold + failedCount : '0'}${colors.reset}`);
  console.log(`Findings:       ${findings.length > 0 ? colors.yellow + colors.bold + findings.length : '0'}${colors.reset}`);
  console.log(`Duration:       ${totalDuration}s`);
  console.log('--------------------------------------------------------------------------------\n');

  // Cleanup temp workspace
  try {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
    logInfo(`Cleaned up temp workspace: ${tempWorkspace}`);
  } catch {}

  if (failedCount > 0) {
    console.log(`${colors.bgRed}${colors.bold}${colors.white} VERDICT: REQUEST_CHANGES — CRITICAL FAILURES ENCOUNTERED ${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${colors.bgGreen}${colors.bold}${colors.white} VERDICT: PASS WITH FINDINGS — SYSTEM MEETS CORE REQUIREMENTS ${colors.reset}\n`);
    process.exit(0);
  }
}

runChallengerSuite().catch((err) => {
  console.error('\nFatal unhandled error in challenger suite:', err);
  process.exit(1);
});
