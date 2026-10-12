import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  AiStudioVideoAssembler,
  TimelineDurationMismatchError,
  type TimelineMismatchDetail,
} from '../main/ai-studio/services/AiStudioVideoAssembler';
import type { StoryboardScene } from '../main/ai-studio/types';

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('  TEST SUITE: Timeline Export Duration Mismatch Guard & Pre-Validation');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  const assembler = AiStudioVideoAssembler.getInstance();

  const realVidFixture = path.resolve(__dirname, '..', 'temp_live_e2e_output', 'live_scene_2_1791646454362.mp4');
  const realImgFixture = path.resolve(__dirname, '..', 'temp_live_e2e_output', 'live_scene_1_1791648384031.jpg');

  assert.ok(fs.existsSync(realVidFixture), `Fixture video file must exist: ${realVidFixture}`);
  assert.ok(fs.existsSync(realImgFixture), `Fixture image file must exist: ${realImgFixture}`);

  // Probe real video fixture duration to get empirical ground truth
  const realVidDuration = await assembler.probeDuration(realVidFixture);
  console.log(`[Fixture] Empirical duration of real video fixture: ${realVidDuration.toFixed(2)}s`);
  assert.ok(realVidDuration >= 3.5 && realVidDuration <= 4.5, 'Fixture should be ~4s Veo video');

  // ============================================================================
  // CASE A: 3 video clips 4s on timeline expecting 7s, 6s, 6s -> BLOCKED
  // ============================================================================
  console.log('▶ [Case A] Testing 3 clips (4s) on timeline 7s / 6s / 6s (must be BLOCKED)...');
  const scenesCaseA: StoryboardScene[] = [
    {
      id: 'scene_01',
      shotId: 'scene_01_shot_1',
      lineIndex: 0,
      startMs: 0,
      endMs: 7000,
      durationMs: 7000,
      lineText: 'Scene 1: Introduction beat',
      visualPrompt: 'Visual prompt 1',
      motionType: 'cinematic',
      videoPath: realVidFixture,
      assetPath: realVidFixture,
      status: 'ready',
    },
    {
      id: 'scene_02',
      shotId: 'scene_02_shot_1',
      lineIndex: 1,
      startMs: 7000,
      endMs: 13000,
      durationMs: 6000,
      lineText: 'Scene 2: Conflict beat',
      visualPrompt: 'Visual prompt 2',
      motionType: 'cinematic',
      videoPath: realVidFixture,
      assetPath: realVidFixture,
      status: 'ready',
    },
    {
      id: 'scene_03',
      shotId: 'scene_03_shot_1',
      lineIndex: 2,
      startMs: 13000,
      endMs: 19000,
      durationMs: 6000,
      lineText: 'Scene 3: Climax beat',
      visualPrompt: 'Visual prompt 3',
      motionType: 'cinematic',
      videoPath: realVidFixture,
      assetPath: realVidFixture,
      status: 'ready',
    },
  ];

  const validationA = await assembler.validateTimelineDurations(scenesCaseA, 25);
  assert.strictEqual(validationA.valid, false, 'Validation A must fail due to duration mismatch');
  assert.strictEqual(validationA.mismatches.length, 3, 'Must report mismatches for all 3 scenes');

  console.log('  Mismatches collected:');
  for (const m of validationA.mismatches) {
    console.log(`    - Cảnh ${m.sceneId} (${m.shotId}): cần ${m.expectedDurationSec}s, có ${m.actualDurationSec}s, thiếu ${m.missingDurationSec}s`);
  }

  // Check scene 1 mismatch details
  const m1 = validationA.mismatches.find((m) => m.sceneId === 'scene_01')!;
  assert.strictEqual(m1.expectedDurationSec, 7.0);
  assert.ok(Math.abs(m1.actualDurationSec - realVidDuration) < 0.05);
  assert.ok(m1.missingDurationSec >= 2.5);

  // Check scene 2 mismatch details
  const m2 = validationA.mismatches.find((m) => m.sceneId === 'scene_02')!;
  assert.strictEqual(m2.expectedDurationSec, 6.0);
  assert.ok(m2.missingDurationSec >= 1.5);

  // Check scene 3 mismatch details
  const m3 = validationA.mismatches.find((m) => m.sceneId === 'scene_03')!;
  assert.strictEqual(m3.expectedDurationSec, 6.0);
  assert.ok(m3.missingDurationSec >= 1.5);

  // Verify assembleVideo throws structured TimelineDurationMismatchError
  let assembleErrorCaught: TimelineDurationMismatchError | null = null;
  try {
    await assembler.assembleVideo({
      scenes: scenesCaseA,
      voiceoverAudioPath: realVidFixture, // Use valid media path as dummy audio
      outputPath: path.resolve(__dirname, '..', 'temp_live_e2e_output', 'dummy_output.mp4'),
      renderingConfig: {} as any,
      subtitleConfig: {} as any,
    });
  } catch (err: any) {
    if (err instanceof TimelineDurationMismatchError) {
      assembleErrorCaught = err;
    }
  }

  assert.ok(assembleErrorCaught !== null, 'assembleVideo must throw TimelineDurationMismatchError');
  assert.strictEqual(assembleErrorCaught.code, 'TIMELINE_DURATION_MISMATCH');
  assert.strictEqual(assembleErrorCaught.mismatches.length, 3);
  assert.ok(assembleErrorCaught.message.includes('Cảnh scene_01 (scene_01_shot_1) cần 7.0 giây, video hiện có'));
  assert.ok(assembleErrorCaught.message.includes('còn thiếu'));
  console.log('  ✔ [PASS] Case A successfully blocked with structured error before rendering.');

  // ============================================================================
  // CASE B: Video clips matching timeline duration -> PASSES
  // ============================================================================
  console.log('\n▶ [Case B] Testing video clips matching timeline duration (must PASS)...');
  // Expected duration 4.0s matching the actual ~4.0s video clip
  const scenesCaseB: StoryboardScene[] = [
    {
      id: 'scene_01',
      shotId: 'scene_01_shot_1',
      lineIndex: 0,
      startMs: 0,
      endMs: 4000,
      durationMs: 4000,
      lineText: 'Scene 1: 4.0s matching',
      visualPrompt: 'Visual prompt 1',
      motionType: 'cinematic',
      videoPath: realVidFixture,
      assetPath: realVidFixture,
      status: 'ready',
    },
    {
      id: 'scene_02',
      shotId: 'scene_02_shot_1',
      lineIndex: 1,
      startMs: 4000,
      endMs: 7000,
      durationMs: 3000, // Video 4s is longer than 3s -> permitted and trimmed
      lineText: 'Scene 2: 3.0s (video is longer)',
      visualPrompt: 'Visual prompt 2',
      motionType: 'cinematic',
      videoPath: realVidFixture,
      assetPath: realVidFixture,
      status: 'ready',
    },
  ];

  const validationB = await assembler.validateTimelineDurations(scenesCaseB, 25);
  assert.strictEqual(validationB.valid, true, 'Validation B must pass when video duration matches or exceeds');
  assert.strictEqual(validationB.mismatches.length, 0);
  console.log('  ✔ [PASS] Case B passes validation cleanly without false mismatch.');

  // ============================================================================
  // CASE C: Mixed static images -> NOT falsely blocked
  // ============================================================================
  console.log('\n▶ [Case C] Testing mixed static images (1 image 7s, 1 video 4s -> must NOT block static image)...');
  const scenesCaseC: StoryboardScene[] = [
    {
      id: 'scene_img_01',
      shotId: 'scene_img_01_shot_1',
      lineIndex: 0,
      startMs: 0,
      endMs: 7000,
      durationMs: 7000, // 7s static image
      lineText: 'Static image scene',
      visualPrompt: 'Visual prompt image',
      motionType: 'ken_burns',
      imagePath: realImgFixture,
      assetPath: realImgFixture,
      status: 'ready',
    },
    {
      id: 'scene_vid_02',
      shotId: 'scene_vid_02_shot_1',
      lineIndex: 1,
      startMs: 7000,
      endMs: 11000,
      durationMs: 4000, // 4s video
      lineText: 'Matching video scene',
      visualPrompt: 'Visual prompt video',
      motionType: 'cinematic',
      videoPath: realVidFixture,
      assetPath: realVidFixture,
      status: 'ready',
    },
  ];

  const validationC = await assembler.validateTimelineDurations(scenesCaseC, 25);
  assert.strictEqual(validationC.valid, true, 'Static images must never be falsely blocked as duration mismatch');
  assert.strictEqual(validationC.mismatches.length, 0);
  console.log('  ✔ [PASS] Case C correctly extends static images and does not block them.');

  // ============================================================================
  // CASE D: Frame boundary tolerance test (0.04s delta vs 0.15s delta)
  // ============================================================================
  console.log('\n▶ [Case D] Testing frame boundary tolerance (tolerance ~0.08s at 25fps)...');

  // Subcase D1: Clip is 0.04s shorter than expected (within 0.08s frame tolerance) -> accepted
  const expectedJustAbove = realVidDuration + 0.04;
  const scenesCaseD1: StoryboardScene[] = [
    {
      id: 'scene_tol_pass',
      shotId: 'scene_tol_pass_shot_1',
      lineIndex: 0,
      startMs: 0,
      endMs: Math.round(expectedJustAbove * 1000),
      durationMs: Math.round(expectedJustAbove * 1000),
      lineText: 'Boundary tolerance scene',
      visualPrompt: 'Visual prompt',
      motionType: 'cinematic',
      videoPath: realVidFixture,
      assetPath: realVidFixture,
      status: 'ready',
    },
  ];

  const validationD1 = await assembler.validateTimelineDurations(scenesCaseD1, 25);
  assert.strictEqual(
    validationD1.valid,
    true,
    'Video within 0.04s frame boundary tolerance must be accepted without false error'
  );
  console.log('  ✔ [PASS] Subcase D1: 0.04s difference accepted within 0.08s frame tolerance.');

  // Subcase D2: Clip is 0.15s shorter than expected (exceeding 0.08s tolerance) -> blocked
  const expectedSignificantlyAbove = realVidDuration + 0.15;
  const scenesCaseD2: StoryboardScene[] = [
    {
      id: 'scene_tol_fail',
      shotId: 'scene_tol_fail_shot_1',
      lineIndex: 0,
      startMs: 0,
      endMs: Math.round(expectedSignificantlyAbove * 1000),
      durationMs: Math.round(expectedSignificantlyAbove * 1000),
      lineText: 'Exceeding tolerance scene',
      visualPrompt: 'Visual prompt',
      motionType: 'cinematic',
      videoPath: realVidFixture,
      assetPath: realVidFixture,
      status: 'ready',
    },
  ];

  const validationD2 = await assembler.validateTimelineDurations(scenesCaseD2, 25);
  assert.strictEqual(
    validationD2.valid,
    false,
    'Video 0.15s short (exceeding 0.08s tolerance) must be flagged'
  );
  assert.strictEqual(validationD2.mismatches.length, 1);
  console.log('  ✔ [PASS] Subcase D2: 0.15s difference correctly detected and flagged.');

  // ============================================================================
  // CASE E: Freeze Last Frame Fill Mode -> Unblocks validation & renders full 19s
  // ============================================================================
  console.log('\n▶ [Case E] Testing "freeze_last_frame" fillMode on 3 scenes (7s/6s/6s, total 19s)...');
  const scenesCaseE: StoryboardScene[] = scenesCaseA.map((sc) => ({
    ...sc,
    fillMode: 'freeze_last_frame',
  }));

  const validationE = await assembler.validateTimelineDurations(scenesCaseE, 25);
  assert.strictEqual(validationE.valid, true, 'Validation must PASS when freeze_last_frame is explicitly selected');
  assert.strictEqual(validationE.mismatches.length, 0, 'No mismatches should be reported for freeze_last_frame scenes');
  assert.ok(scenesCaseE[0].originalMediaDurationSec! >= 3.8 && scenesCaseE[0].originalMediaDurationSec! <= 4.2, 'originalMediaDurationSec must be populated');
  console.log(`  ✔ [PASS] Validation E accepted scenes with freeze_last_frame (media duration: ${scenesCaseE[0].originalMediaDurationSec}s).`);

  // Render video with assembleVideo using dummy 19s audio
  const outputCaseE = path.resolve(__dirname, '..', 'temp_live_e2e_output', 'test_freeze_last_frame_19s.mp4');
  // First create a 19s dummy voiceover audio file using ffmpeg tone
  const dummyVoicePath = path.resolve(__dirname, '..', 'temp_live_e2e_output', 'dummy_voice_19s.mp3');
  await new Promise<void>((resolve, reject) => {
    const ffmpegModule = require('fluent-ffmpeg');
    ffmpegModule()
      .input('anullsrc=r=44100:cl=stereo')
      .inputFormat('lavfi')
      .duration(19.0)
      .output(dummyVoicePath)
      .on('end', () => resolve())
      .on('error', (err: any) => reject(err))
      .run();
  });

  console.log('  Rendering 19s video with assembleVideo (FFmpeg tpad filter)...');
  const renderResultE = await assembler.assembleVideo({
    scenes: scenesCaseE,
    voiceoverAudioPath: dummyVoicePath,
    outputPath: outputCaseE,
    renderingConfig: {
      resolution: '720p',
      fps: 25,
      kenBurnsEffect: false,
    } as any,
    subtitleConfig: {
      fontFamily: 'Arial',
      fontSize: 20,
      textColor: '&H00FFFFFF',
      outlineColor: '&H00000000',
      outlineWidth: 2,
      shadowDepth: 1,
      alignment: 2,
      verticalMargin: 30,
    } as any,
    aspectRatio: '16:9',
  });

  assert.ok(fs.existsSync(renderResultE.videoPath), `Rendered video must exist at ${renderResultE.videoPath}`);
  const finalDurationE = await assembler.probeDuration(renderResultE.videoPath);
  console.log(`  Rendered video duration: ${finalDurationE.toFixed(3)}s`);
  assert.ok(Math.abs(finalDurationE - 19.0) <= 0.15, `Duration should be ~19.0s (got ${finalDurationE.toFixed(3)}s)`);
  console.log('  ✔ [PASS] Case E assembled complete 19.0s video with last frames cloned to fill duration.');

  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log('✅ ALL TIMELINE DURATION MISMATCH GUARD TESTS PASSED SUCCESSFULLY!');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('❌ [FAIL] Timeline Export Duration Guard Test failed:', err);
  process.exit(1);
});
