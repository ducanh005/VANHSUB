/**
 * tests/test_m4_adversarial_challenger.ts
 *
 * Empirical Adversarial Challenger Test Suite for Milestone 4 (M4)
 * Roles: critic, specialist
 *
 * Objectives:
 * 1. Stress-test Dynamic Audio Ducking filter graph (sidechaincompress)
 * 2. Stress-test SFX Transition Insertion (adelay & amix) with delay clamping
 * 3. Verify edge cases: 0 cuts, single scene, cuts < 0.2s, without BGM, missing SFX
 * 4. Verify exact sidechaincompress parameter matching (threshold=0.03:ratio=8:attack=25:release=400:knee=2.5)
 * 5. Verify adelay stereo syntax ${delay}|${delay} in FFmpeg execution (mono and stereo)
 * 6. Acoustic empirical oracle: measure actual ducking attenuation (-18dB nominal) on speech
 * 7. Live assembleVideo execution with FFmpeg under boundary conditions
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync, spawnSync } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import {
  AiStudioVideoAssembler,
  CINEMATIC_CAMERA_MOTION_PROFILES,
} from '../main/ai-studio/services/AiStudioVideoAssembler';
import type { StoryboardScene } from '../main/ai-studio/types';

const ffmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path;

let testCount = 0;
let passedCount = 0;
let failedCount = 0;
const failureMessages: string[] = [];

async function step(name: string, fn: () => void | Promise<void>) {
  testCount++;
  try {
    await fn();
    passedCount++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err: any) {
    failedCount++;
    const msg = `  ❌ [FAIL] ${name}: ${err?.message || err}`;
    console.error(msg);
    failureMessages.push(msg);
  }
}

async function runAdversarialSuite() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   ADVERSARIAL STRESS TEST: M4 AUDIO DUCKING & SFX TRANSITION ENGINE     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_m4_challenger_'));

  try {
    // --------------------------------------------------------------------------
    // SECTION 1: SIDECHAINCOMPRESS SPECIFICATION & PARAMETER ADVERSARIAL AUDIT
    // --------------------------------------------------------------------------
    console.log('--- 🔬 SECTION 1: SIDECHAINCOMPRESS PARAMETER & GRAPH VERIFICATION ---');

    await step('Verify sidechaincompress exact parameter specification', () => {
      const graph = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(true, [], 0);
      const expectedParams = 'threshold=0.03:ratio=8:attack=25:release=400:knee=2.5';
      assert(
        graph.includes(`sidechaincompress=${expectedParams}`),
        `Filter graph must contain exact parameters "${expectedParams}", got: ${graph}`
      );
      assert(
        graph.includes('[voice_in]asplit=2[voice_main][voice_sidechain]'),
        'Must split voice_in into main and sidechain trigger'
      );
      assert(
        graph.includes('[bgm_in][voice_sidechain]sidechaincompress='),
        'Must feed bgm_in and voice_sidechain into sidechaincompress'
      );
      assert(
        graph.includes('[voice_main][bgm_ducked]amix=inputs=2:duration=first:dropout_transition=2[aout]'),
        'Must mix voice_main and ducked BGM with duration=first'
      );
    });

    // --------------------------------------------------------------------------
    // SECTION 2: ADELAY STEREO SYNTAX & CHANNEL SAFETY
    // --------------------------------------------------------------------------
    console.log('\n--- 🎧 SECTION 2: ADELAY STEREO SYNTAX & BOUNDARY CLAMPING ---');

    await step('Verify adelay syntax ${delay}|${delay} for stereo channels', () => {
      const cuts = [1.5, 3.8, 10.25];
      const graph = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(true, cuts, 3);
      // Expected delays:
      // cut 0: (1.5 - 0.2) * 1000 = 1300ms -> adelay=1300|1300
      // cut 1: (3.8 - 0.2) * 1000 = 3600ms -> adelay=3600|3600
      // cut 2: (10.25 - 0.2) * 1000 = 10050ms -> adelay=10050|10050
      assert(graph.includes('adelay=1300|1300[sfx_0_delayed]'), 'SFX 0 adelay must format delay|delay');
      assert(graph.includes('adelay=3600|3600[sfx_1_delayed]'), 'SFX 1 adelay must format delay|delay');
      assert(graph.includes('adelay=10050|10050[sfx_2_delayed]'), 'SFX 2 adelay must format delay|delay');

      // Verify pipe | delimiter exists in every adelay occurrence
      const adelayMatches = graph.match(/adelay=(\d+)\|(\d+)/g) || [];
      assert.strictEqual(adelayMatches.length, 3, 'Must match 3 stereo adelay pairs');
      for (const m of adelayMatches) {
        const parts = m.replace('adelay=', '').split('|');
        assert.strictEqual(parts[0], parts[1], `Left and right delays must be identical: ${m}`);
      }
    });

    await step('Verify delay clamping on extremely short cuts (< 0.2s, 0.0s, negative)', () => {
      const extremeCuts = [0.0, 0.05, 0.199, 0.2, 0.201, -1.5];
      const graph = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(true, extremeCuts, 6);
      // 0.0s -> max(0, -200) = 0ms
      assert(graph.includes('adelay=0|0[sfx_0_delayed]'));
      // 0.05s -> max(0, -150) = 0ms
      assert(graph.includes('adelay=0|0[sfx_1_delayed]'));
      // 0.199s -> max(0, -1) = 0ms
      assert(graph.includes('adelay=0|0[sfx_2_delayed]'));
      // 0.2s -> max(0, 0) = 0ms
      assert(graph.includes('adelay=0|0[sfx_3_delayed]'));
      // 0.201s -> max(0, 1) = 1ms
      assert(graph.includes('adelay=1|1[sfx_4_delayed]'));
      // -1.5s -> max(0, -1700) = 0ms
      assert(graph.includes('adelay=0|0[sfx_5_delayed]'));
    });

    await step('Verify degenerate cut values (undefined, missing array items)', () => {
      // sfxInputsCount > cutTimestampsSec.length
      const graph = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(true, [2.0], 3);
      // cut 0: 2.0s -> 1800ms
      assert(graph.includes('adelay=1800|1800[sfx_0_delayed]'));
      // cut 1: fallback (1 + 1) * 4.0 = 8.0s -> 7800ms
      assert(graph.includes('adelay=7800|7800[sfx_1_delayed]'));
      // cut 2: fallback (2 + 1) * 4.0 = 12.0s -> 11800ms
      assert(graph.includes('adelay=11800|11800[sfx_2_delayed]'));
    });

    // --------------------------------------------------------------------------
    // SECTION 3: EDGE CASES: 0 CUTS, SINGLE SCENE, WITHOUT BGM
    // --------------------------------------------------------------------------
    console.log('\n--- 📐 SECTION 3: EDGE CASES (0 CUTS, SINGLE SCENE, NO BGM) ---');

    await step('Edge Case: 0 cut points with BGM (single continuous scene)', () => {
      const graph = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(true, [], 0);
      assert(!graph.includes('sfx'), 'Must not contain any SFX filters when sfxInputsCount is 0');
      assert(!graph.includes('adelay'), 'Must not contain adelay when sfxInputsCount is 0');
      assert(graph.endsWith('[aout]'), 'Graph must terminate at [aout]');
      assert(graph.includes('[voice_main][bgm_ducked]amix='), 'Must mix voice and ducked BGM directly');
    });

    await step('Edge Case: No BGM (voiceover only)', () => {
      const graph = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(false, [], 0);
      assert.strictEqual(graph, '[voice_in]anull[aout]');
    });

    await step('Edge Case: No BGM with non-zero cuts/SFX count', () => {
      const graph = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(false, [2.0, 4.0], 2);
      assert.strictEqual(graph, '[voice_in]anull[aout]');
    });

    // --------------------------------------------------------------------------
    // SECTION 4: LIVE FFMPEG EXECUTION ON FILTER GRAPHS (EMPIRICAL VERIFICATION)
    // --------------------------------------------------------------------------
    console.log('\n--- ⚡ SECTION 4: LIVE FFMPEG FILTERGRAPH EXECUTION ---');

    const testVoiceMp3 = path.join(tmpDir, 'test_voice.mp3');
    const testBgmMp3 = path.join(tmpDir, 'test_bgm.mp3');
    const testSfxMp3 = path.join(tmpDir, 'test_sfx.mp3');

    execFileSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:a', 'libmp3lame', '-ac', '2', testVoiceMp3], { stdio: 'pipe' });
    execFileSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=6', '-c:a', 'libmp3lame', '-ac', '2', testBgmMp3], { stdio: 'pipe' });
    execFileSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', '-c:a', 'libmp3lame', '-ac', '2', testSfxMp3], { stdio: 'pipe' });

    await step('FFmpeg execution: Full Ducking + 2 Transition SFX (one clamped to 0ms)', () => {
      const filterGraph = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(true, [0.1, 2.5], 2);
      const fullFilter = [
        '[1:a]volume=1.0[voice_in]',
        '[0:a]volume=0.12[bgm_in]',
        '[2:a]volume=0.35,asplit=2[sfx_0][sfx_1]',
        filterGraph,
      ].join(';');

      execFileSync(
        ffmpegPath,
        [
          '-y',
          '-i', testBgmMp3,
          '-i', testVoiceMp3,
          '-i', testSfxMp3,
          '-filter_complex', fullFilter,
          '-map', '[aout]',
          '-f', 'null', '-',
        ],
        { stdio: 'pipe' }
      );
    });

    await step('FFmpeg execution: Mono Voice + Stereo BGM + Stereo SFX with adelay=X|X', () => {
      const monoVoiceMp3 = path.join(tmpDir, 'test_voice_mono.mp3');
      execFileSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'libmp3lame', '-ac', '1', monoVoiceMp3], { stdio: 'pipe' });

      const filterGraph = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(true, [1.5], 1);
      const fullFilter = [
        '[1:a]volume=1.0[voice_in]',
        '[0:a]volume=0.12[bgm_in]',
        '[2:a]volume=0.35[sfx_0]',
        filterGraph,
      ].join(';');

      execFileSync(
        ffmpegPath,
        [
          '-y',
          '-i', testBgmMp3,
          '-i', monoVoiceMp3,
          '-i', testSfxMp3,
          '-filter_complex', fullFilter,
          '-map', '[aout]',
          '-f', 'null', '-',
        ],
        { stdio: 'pipe' }
      );
    });

    await step('FFmpeg execution: Voiceover only without BGM ([voice_in]anull[aout])', () => {
      const fullFilter = ['[0:a]volume=1.0[voice_in]', '[voice_in]anull[aout]'].join(';');
      execFileSync(
        ffmpegPath,
        [
          '-y',
          '-i', testVoiceMp3,
          '-filter_complex', fullFilter,
          '-map', '[aout]',
          '-f', 'null', '-',
        ],
        { stdio: 'pipe' }
      );
    });

    // --------------------------------------------------------------------------
    // SECTION 5: ACOUSTIC EMPIRICAL ORACLE: PROVE REAL SIDECHAIN DUCKING (-18dB)
    // --------------------------------------------------------------------------
    console.log('\n--- 🔊 SECTION 5: ACOUSTIC ORACLE: MEASURE DUCKING ATTENUATION ---');

    await step('Acoustic Oracle: Verify BGM attenuation during voiceover speech', () => {
      const speechWav = path.join(tmpDir, 'speech_envelope.wav');
      const bgmWav = path.join(tmpDir, 'bgm_continuous.wav');
      const duckedOutWav = path.join(tmpDir, 'ducked_bgm_output.wav');

      // Create speech track: 6s tone at 440Hz with full amplitude during [2s, 4s] and silent elsewhere
      spawnSync(ffmpegPath, [
        '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
        '-af', 'volume=enable=\'between(t,2,4)\':volume=4:eval=frame,volume=enable=\'not(between(t,2,4))\':volume=0:eval=frame',
        '-c:a', 'pcm_s16le',
        speechWav,
      ]);

      // Create BGM track: 6s continuous tone at 1000Hz
      spawnSync(ffmpegPath, [
        '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=6',
        '-ac', '2',
        '-c:a', 'pcm_s16le',
        bgmWav,
      ]);

      // Apply sidechaincompress filter graph (using anullsink to safely sink voice_main while isolating ducked BGM)
      const compressResult = spawnSync(ffmpegPath, [
        '-y',
        '-i', bgmWav,
        '-i', speechWav,
        '-filter_complex',
        '[1:a]asplit=2[voice_main][voice_sidechain];[voice_main]anullsink;[0:a][voice_sidechain]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=400:knee=2.5[bgm_ducked]',
        '-map', '[bgm_ducked]',
        '-c:a', 'pcm_s16le',
        duckedOutWav,
      ]);

      assert(fs.existsSync(duckedOutWav), `Ducked output must exist: ${compressResult.stderr?.toString()}`);

      // Probe mean volume during speech silence [0.5s - 1.5s]
      const silenceStats = spawnSync(ffmpegPath, [
        '-ss', '0.5', '-t', '1.0',
        '-i', duckedOutWav,
        '-af', 'volumedetect',
        '-f', 'null', '-',
      ]);

      // Probe mean volume during active speech [2.5s - 3.5s]
      const speechStats = spawnSync(ffmpegPath, [
        '-ss', '2.5', '-t', '1.0',
        '-i', duckedOutWav,
        '-af', 'volumedetect',
        '-f', 'null', '-',
      ]);

      const getMeanVolume = (output: string): number => {
        const match = output.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
        return match ? parseFloat(match[1]) : NaN;
      };

      const volSilence = getMeanVolume(silenceStats.stderr.toString());
      const volSpeech = getMeanVolume(speechStats.stderr.toString());

      console.log(`    📊 Measured BGM Mean Volume (Speech Silent):  ${volSilence} dB`);
      console.log(`    📊 Measured BGM Mean Volume (Speech Active):  ${volSpeech} dB`);

      assert(!isNaN(volSilence), 'Failed to parse silence volume');
      assert(!isNaN(volSpeech), 'Failed to parse speech volume');

      const attenuation = volSilence - volSpeech;
      console.log(`    📉 Empirically Measured Ducking Attenuation: ${attenuation.toFixed(2)} dB`);

      assert(volSpeech < volSilence, 'BGM volume during speech must be lower than during silence');
      assert(attenuation >= 14.0, `Expected at least 14dB ducking attenuation, measured ${attenuation.toFixed(2)} dB`);
    });

    // --------------------------------------------------------------------------
    // SECTION 6: LIVE ASSEMBLE_VIDEO END-TO-END VERIFICATION
    // --------------------------------------------------------------------------
    console.log('\n--- 🎬 SECTION 6: LIVE ASSEMBLE_VIDEO UNDER ADVERSARIAL EDGE CASES ---');

    const dummyImage1 = path.join(tmpDir, 'test_img1.png');
    const dummyImage2 = path.join(tmpDir, 'test_img2.png');
    execFileSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1280x720:d=1', '-vframes', '1', dummyImage1], { stdio: 'pipe' });
    execFileSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=1280x720:d=1', '-vframes', '1', dummyImage2], { stdio: 'pipe' });

    const assembler = AiStudioVideoAssembler.getInstance();

    await step('Live assembleVideo: Single scene (0 cuts, no SFX, with ducking & BGM)', async () => {
      const outVideo = path.join(tmpDir, 'output_single_scene.mp4');
      const scene: StoryboardScene = {
        id: 'sc-1',
        sceneNumber: 1,
        narration: 'Single scene test',
        imagePrompt: 'Test image',
        assetPath: dummyImage1,
        durationMs: 3000,
        status: 'ready',
      };

      const result = await assembler.assembleVideo({
        scenes: [scene],
        voiceoverAudioPath: testVoiceMp3,
        outputPath: outVideo,
        renderingConfig: {
          resolution: '720p',
          kenBurnsEffect: true,
          autoAudioDucking: true,
          defaultBgmPath: testBgmMp3,
        },
        subtitleConfig: { enabled: false },
        aspectRatio: '16:9',
      });

      assert(fs.existsSync(result.videoPath), 'Output video must exist');
      assert(result.fileSizeBytes > 1000, 'Video file size must be non-trivial');
      assert.strictEqual(result.width, 1280);
      assert.strictEqual(result.height, 720);
    });

    await step('Live assembleVideo: Multi-scene with early cut < 0.2s duration + SFX', async () => {
      const outVideo = path.join(tmpDir, 'output_short_cut.mp4');
      const scenes: StoryboardScene[] = [
        {
          id: 'sc-early',
          sceneNumber: 1,
          narration: 'Quick flash',
          imagePrompt: 'Flash',
          assetPath: dummyImage1,
          durationMs: 100, // 0.1s -> clamped to 0.5s by assembler
          status: 'ready',
        },
        {
          id: 'sc-main',
          sceneNumber: 2,
          narration: 'Main scene',
          imagePrompt: 'Main',
          assetPath: dummyImage2,
          durationMs: 2900,
          status: 'ready',
        },
      ];

      const result = await assembler.assembleVideo({
        scenes,
        voiceoverAudioPath: testVoiceMp3,
        outputPath: outVideo,
        renderingConfig: {
          resolution: '720p',
          kenBurnsEffect: true,
          autoAudioDucking: true,
          defaultBgmPath: testBgmMp3,
        },
        subtitleConfig: { enabled: false },
        transitionSfxPath: testSfxMp3,
        enableTransitionSfx: true,
        aspectRatio: '16:9',
      });

      assert(fs.existsSync(result.videoPath), 'Short cut video must assemble cleanly');
      assert(result.fileSizeBytes > 1000);
    });

    await step('Live assembleVideo: No BGM and No SFX (voiceover only pass-through)', async () => {
      const outVideo = path.join(tmpDir, 'output_voice_only.mp4');
      const scenes: StoryboardScene[] = [
        {
          id: 'sc-v1',
          sceneNumber: 1,
          narration: 'Voice only',
          imagePrompt: 'Voice only',
          assetPath: dummyImage1,
          durationMs: 3000,
          status: 'ready',
        },
      ];

      const result = await assembler.assembleVideo({
        scenes,
        voiceoverAudioPath: testVoiceMp3,
        outputPath: outVideo,
        renderingConfig: {
          resolution: '720p',
          kenBurnsEffect: false,
          autoAudioDucking: false,
        },
        subtitleConfig: { enabled: false },
        enableTransitionSfx: false,
        aspectRatio: '16:9',
      });

      assert(fs.existsSync(result.videoPath), 'Voice-only video must exist');
    });

    await step('Live assembleVideo: Vertical 9:16 aspect ratio with Ken Burns & Ducking', async () => {
      const outVideo = path.join(tmpDir, 'output_vertical.mp4');
      const scenes: StoryboardScene[] = [
        {
          id: 'sc-vert1',
          sceneNumber: 1,
          narration: 'Vertical 1',
          imagePrompt: 'Vert 1',
          assetPath: dummyImage1,
          durationMs: 1500,
          status: 'ready',
        },
        {
          id: 'sc-vert2',
          sceneNumber: 2,
          narration: 'Vertical 2',
          imagePrompt: 'Vert 2',
          assetPath: dummyImage2,
          durationMs: 1500,
          status: 'ready',
        },
      ];

      const result = await assembler.assembleVideo({
        scenes,
        voiceoverAudioPath: testVoiceMp3,
        outputPath: outVideo,
        renderingConfig: {
          resolution: '720p',
          kenBurnsEffect: true,
          autoAudioDucking: true,
          defaultBgmPath: testBgmMp3,
        },
        subtitleConfig: { enabled: false },
        transitionSfxPath: testSfxMp3,
        enableTransitionSfx: true,
        aspectRatio: '9:16',
      });

      assert(fs.existsSync(result.videoPath));
      assert.strictEqual(result.width, 720);
      assert.strictEqual(result.height, 1280);
    });

    await step('Live assembleVideo: Missing SFX asset path gracefully falls back', async () => {
      const outVideo = path.join(tmpDir, 'output_fallback_sfx.mp4');
      const scenes: StoryboardScene[] = [
        {
          id: 'sc-fb1',
          sceneNumber: 1,
          narration: 'Scene 1',
          imagePrompt: 'Scene 1',
          assetPath: dummyImage1,
          durationMs: 2000,
          status: 'ready',
        },
        {
          id: 'sc-fb2',
          sceneNumber: 2,
          narration: 'Scene 2',
          imagePrompt: 'Scene 2',
          assetPath: dummyImage2,
          durationMs: 2000,
          status: 'ready',
        },
      ];

      const result = await assembler.assembleVideo({
        scenes,
        voiceoverAudioPath: testVoiceMp3,
        outputPath: outVideo,
        renderingConfig: {
          resolution: '720p',
          kenBurnsEffect: true,
          autoAudioDucking: true,
          defaultBgmPath: testBgmMp3,
        },
        subtitleConfig: { enabled: false },
        transitionSfxPath: path.join(tmpDir, 'non_existent_sfx.wav'),
        enableTransitionSfx: true,
        aspectRatio: '16:9',
      });

      assert(fs.existsSync(result.videoPath), 'Video assembly must succeed even if custom SFX is missing');
    });

  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }

  // Summary
  console.log('\n================================================================================');
  console.log(`📊 ADVERSARIAL STRESS TEST SUMMARY:`);
  console.log(`   Total Tests:  ${testCount}`);
  console.log(`   Passed:       ${passedCount} ✅`);
  console.log(`   Failed:       ${failedCount} ❌`);
  console.log('================================================================================\n');

  if (failedCount > 0) {
    console.error('❌ FAILURES DETECTED:');
    for (const msg of failureMessages) {
      console.error(msg);
    }
    process.exit(1);
  } else {
    console.log('🎉 ALL ADVERSARIAL STRESS TESTS PASSED WITH 100% SUCCESS!');
  }
}

runAdversarialSuite().catch((err) => {
  console.error('Fatal crash in adversarial test runner:', err);
  process.exit(1);
});
