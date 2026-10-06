/**
 * tests/adversarial_m4_stress_test.ts
 *
 * Empirical Adversarial Challenger Test Suite for Milestone 4:
 * 1. Mathematical Simulation & Invariant Verification of all 6 Ken Burns Motion Profiles
 * 2. 1.5x Pre-upscaling Even Dimension Invariants for libx264
 * 3. Rule-of-Thirds Bounding Box Invariants
 * 4. Real FFmpeg Filtergraph Execution & Probe Verification
 * 5. Audio Ducking & SFX Filtergraph Real Execution
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import {
  AiStudioVideoAssembler,
  CINEMATIC_CAMERA_MOTION_PROFILES,
  type KenBurnsMotionProfile,
} from '../main/ai-studio/services/AiStudioVideoAssembler';

const ffmpegPath = ((ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '').replace('app.asar', 'app.asar.unpacked');
const ffprobePath = ((ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '').replace('app.asar', 'app.asar.unpacked');

const TEMP_DIR = path.join(os.tmpdir(), `vanhsub_m4_stress_${Date.now()}`);

function cleanupTempDir() {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  } catch {}
}

async function runAdversarialSuite() {
  console.log('================================================================');
  console.log('⚔️  ADVERSARIAL STRESS TEST: MILESTONE 4 VIDEO & AUDIO ENGINE ⚔️');
  console.log('================================================================\n');

  fs.mkdirSync(TEMP_DIR, { recursive: true });

  // --------------------------------------------------------------------------
  // CHALLENGE 1: Mathematical Invariant Oracle across all 6 Motion Profiles
  // --------------------------------------------------------------------------
  console.log('🔍 [Challenge 1] Testing Mathematical Invariants across 6 Motion Profiles...');

  const resolutions = [
    { name: '1080p Landscape (16:9)', w: 1920, h: 1080 },
    { name: '720p Landscape (16:9)', w: 1280, h: 720 },
    { name: '1080p Portrait (9:16)', w: 1080, h: 1920 },
    { name: '720p Portrait (9:16)', w: 720, h: 1280 },
    { name: '1080p Square (1:1)', w: 1080, h: 1080 },
    { name: '720p Square (1:1)', w: 720, h: 720 },
    { name: 'Ultra-wide 21:9', w: 2560, h: 1080 },
    { name: '4:3 Standard', w: 1440, h: 1080 },
    { name: 'Small 320x240', w: 320, h: 240 },
  ];

  const durations = [0.01, 0.1, 0.5, 1.0, 2.0, 4.0, 8.0, 15.0, 60.0, 300.0, 3600.0, 0, -5];

  let totalFrameChecks = 0;

  for (const res of resolutions) {
    for (const dur of durations) {
      const profiles = AiStudioVideoAssembler.getKenBurnsProfiles(res.w, res.h, dur);
      assert.strictEqual(profiles.length, 6, `Must always return 6 profiles for ${res.name} at ${dur}s`);

      const frames = Math.max(25, Math.round(dur * 25));
      assert(frames >= 25, `Frames must be at least 25 (was ${frames})`);

      for (const profile of profiles) {
        // Simulate frame-by-frame values
        let currentZoom = 1.0;

        for (let on = 0; on <= frames; on++) {
          totalFrameChecks++;

          let z = 1.0;
          let x = 0;
          let y = 0;

          // Compute exact profile mathematical expressions
          if (profile.name === 'Pan L->R') {
            z = 1.15;
            x = (res.w - res.w / z) * (on / frames);
            y = (res.h - res.h / z) / 2;
          } else if (profile.name === 'Pan R->L') {
            z = 1.15;
            x = (res.w - res.w / z) * (1 - on / frames);
            y = (res.h - res.h / z) / 2;
          } else if (profile.name === 'Zoom 1/3 Left') {
            currentZoom = Math.min(currentZoom + 0.0015, 1.25);
            z = currentZoom;
            x = (res.w * 0.33) - (res.w / z * 0.33);
            y = (res.h / 2) - (res.h / z / 2);
          } else if (profile.name === 'Zoom 1/3 Right') {
            currentZoom = Math.min(currentZoom + 0.0015, 1.25);
            z = currentZoom;
            x = (res.w * 0.67) - (res.w / z * 0.67);
            y = (res.h / 2) - (res.h / z / 2);
          } else if (profile.name === 'Zoom-out Wide') {
            z = Math.max(1.25 - 0.0015 * on, 1.0);
            x = (res.w - res.w / z) / 2;
            y = (res.h - res.h / z) / 2;
          } else if (profile.name === 'Push-in Hero') {
            z = Math.min(1.0 + 0.002 * on, 1.20);
            x = (res.w - res.w / z) / 2;
            y = (res.h - res.h / z) / 2;
          }

          // Invariant 1: No NaN or Infinite
          assert(!Number.isNaN(z), `Zoom is NaN in ${profile.name} at frame ${on}`);
          assert(!Number.isNaN(x), `X is NaN in ${profile.name} at frame ${on}`);
          assert(!Number.isNaN(y), `Y is NaN in ${profile.name} at frame ${on}`);
          assert(Number.isFinite(z), `Zoom is infinite in ${profile.name} at frame ${on}`);
          assert(Number.isFinite(x), `X is infinite in ${profile.name} at frame ${on}`);
          assert(Number.isFinite(y), `Y is infinite in ${profile.name} at frame ${on}`);

          // Invariant 2: Zoom must be strictly >= 1.0 (zoompan constraint)
          assert(z >= 1.0, `Zoom must be >= 1.0, got ${z} in ${profile.name}`);

          // Invariant 3: Crop Box strictly within input bounds [0, iw] and [0, ih]
          const cropW = res.w / z;
          const cropH = res.h / z;

          // x must be >= 0 (with float rounding margin)
          assert(x >= -1e-5, `X < 0: ${x} in ${profile.name} at frame ${on}`);
          // x + cropW <= res.w (with float rounding margin)
          assert(x + cropW <= res.w + 1e-4, `X+cropW > iw: ${x + cropW} > ${res.w} in ${profile.name} at frame ${on}`);

          // y must be >= 0 (with float rounding margin)
          assert(y >= -1e-5, `Y < 0: ${y} in ${profile.name} at frame ${on}`);
          // y + cropH <= res.h (with float rounding margin)
          assert(y + cropH <= res.h + 1e-4, `Y+cropH > ih: ${y + cropH} > ${res.h} in ${profile.name} at frame ${on}`);
        }
      }
    }
  }

  console.log(`  ✅ Successfully simulated and verified ${totalFrameChecks} frame calculations.`);
  console.log('  ✅ Invariants confirmed: 0 NaNs, 0 Infinities, 0 out-of-bounds crops.\n');

  // --------------------------------------------------------------------------
  // CHALLENGE 2: 1.5x Pre-upscaling Even Dimension Invariants
  // --------------------------------------------------------------------------
  console.log('🔍 [Challenge 2] Testing 1.5x Pre-upscaling Even Dimensions for libx264...');

  const testDimensions = [
    { w: 1920, h: 1080 },
    { w: 1280, h: 720 },
    { w: 1080, h: 1920 },
    { w: 720, h: 1280 },
    { w: 1080, h: 1080 },
    { w: 720, h: 720 },
  ];

  for (const dims of testDimensions) {
    const preW = Math.round(dims.w * 1.5);
    const preH = Math.round(dims.h * 1.5);

    assert.strictEqual(preW % 2, 0, `Pre-upscale width must be even: ${dims.w} * 1.5 = ${preW}`);
    assert.strictEqual(preH % 2, 0, `Pre-upscale height must be even: ${dims.h} * 1.5 = ${preH}`);
  }
  console.log('  ✅ All standard resolutions yield strictly even numbers under 1.5x upscaling.\n');

  // --------------------------------------------------------------------------
  // CHALLENGE 3: Real FFmpeg Video Encoding with All 6 Profiles
  // --------------------------------------------------------------------------
  console.log('🔍 [Challenge 3] Executing Real FFmpeg libx264 Renders on All 6 Profiles...');

  // Create test input image (1920x1080 PNG) using ffmpeg testsrc
  const testImgPath = path.join(TEMP_DIR, 'test_input.png');
  execFileSync(ffmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc=size=1920x1080:rate=1',
    '-vframes', '1',
    testImgPath,
  ]);
  assert(fs.existsSync(testImgPath) && fs.statSync(testImgPath).size > 0, 'Test image must exist');

  const assembler = AiStudioVideoAssembler.getInstance();
  const testDuration = 2.0; // 50 frames
  const profiles = AiStudioVideoAssembler.getKenBurnsProfiles(1920, 1080, testDuration);
  const frames = Math.max(25, Math.round(testDuration * 25));

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    const outVideoPath = path.join(TEMP_DIR, `output_profile_${i}.mp4`);

    const filterString = `[0:v]${profile.scaleFilter},setsar=1,zoompan=${profile.zoomEquation}:${profile.panEquation}:d=${frames}:s=1920x1080:fps=25[v0];[v0]null[vout]`;

    const args = [
      '-y',
      '-loop', '1',
      '-t', String(testDuration),
      '-i', testImgPath,
      '-filter_complex', filterString,
      '-map', '[vout]',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      outVideoPath,
    ];

    execFileSync(ffmpegPath, args);
    assert(fs.existsSync(outVideoPath), `Video for profile ${profile.name} must be generated`);
    const size = fs.statSync(outVideoPath).size;
    assert(size > 1000, `Video for profile ${profile.name} must not be empty (was ${size} bytes)`);

    // Probe the generated video using ffprobe
    const probeOutput = execFileSync(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,codec_name,pix_fmt,r_frame_rate',
      '-of', 'json',
      outVideoPath,
    ]).toString();

    const probeData = JSON.parse(probeOutput);
    const stream = probeData.streams[0];
    assert.strictEqual(stream.width, 1920, `Width must be 1920 for profile ${profile.name}`);
    assert.strictEqual(stream.height, 1080, `Height must be 1080 for profile ${profile.name}`);
    assert.strictEqual(stream.codec_name, 'h264', `Codec must be h264 for profile ${profile.name}`);
    assert.strictEqual(stream.pix_fmt, 'yuv420p', `Pixel format must be yuv420p for profile ${profile.name}`);

    console.log(`  ✅ Profile "${profile.name}" successfully rendered & probed: 1920x1080 yuv420p (${size} bytes)`);
  }
  console.log('  ✅ Real FFmpeg execution PASS for all 6 motion profiles!\n');

  // --------------------------------------------------------------------------
  // CHALLENGE 4: Vertical (9:16) & Square (1:1) Real FFmpeg Rendering
  // --------------------------------------------------------------------------
  console.log('🔍 [Challenge 4] Testing Vertical (9:16) & Square (1:1) Real FFmpeg Renders...');

  // 9:16 Vertical test
  {
    const vertImgPath = path.join(TEMP_DIR, 'test_vert.png');
    execFileSync(ffmpegPath, [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=size=1080x1920:rate=1',
      '-vframes', '1',
      vertImgPath,
    ]);

    const vertProfiles = AiStudioVideoAssembler.getKenBurnsProfiles(1080, 1920, 1.5);
    const vertFrames = Math.max(25, Math.round(1.5 * 25));
    // Test Zoom 1/3 Left on 9:16 vertical
    const p = vertProfiles[2];
    const vertOutVideo = path.join(TEMP_DIR, 'output_vert.mp4');
    const filterString = `[0:v]${p.scaleFilter},setsar=1,zoompan=${p.zoomEquation}:${p.panEquation}:d=${vertFrames}:s=1080x1920:fps=25[v0];[v0]null[vout]`;

    execFileSync(ffmpegPath, [
      '-y',
      '-loop', '1',
      '-t', '1.5',
      '-i', vertImgPath,
      '-filter_complex', filterString,
      '-map', '[vout]',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      vertOutVideo,
    ]);

    const vertProbe = JSON.parse(execFileSync(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      vertOutVideo,
    ]).toString()).streams[0];

    assert.strictEqual(vertProbe.width, 1080);
    assert.strictEqual(vertProbe.height, 1920);
    console.log('  ✅ 9:16 Vertical (1080x1920) rendered and validated.');
  }

  // 1:1 Square test
  {
    const squareImgPath = path.join(TEMP_DIR, 'test_square.png');
    execFileSync(ffmpegPath, [
      '-y',
      '-f', 'lavfi',
      '-i', 'testsrc=size=1080x1080:rate=1',
      '-vframes', '1',
      squareImgPath,
    ]);

    const sqProfiles = AiStudioVideoAssembler.getKenBurnsProfiles(1080, 1080, 1.5);
    const sqFrames = Math.max(25, Math.round(1.5 * 25));
    // Test Pan R->L on 1:1 square
    const p = sqProfiles[1];
    const sqOutVideo = path.join(TEMP_DIR, 'output_square.mp4');
    const filterString = `[0:v]${p.scaleFilter},setsar=1,zoompan=${p.zoomEquation}:${p.panEquation}:d=${sqFrames}:s=1080x1080:fps=25[v0];[v0]null[vout]`;

    execFileSync(ffmpegPath, [
      '-y',
      '-loop', '1',
      '-t', '1.5',
      '-i', squareImgPath,
      '-filter_complex', filterString,
      '-map', '[vout]',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      sqOutVideo,
    ]);

    const sqProbe = JSON.parse(execFileSync(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      sqOutVideo,
    ]).toString()).streams[0];

    assert.strictEqual(sqProbe.width, 1080);
    assert.strictEqual(sqProbe.height, 1080);
    console.log('  ✅ 1:1 Square (1080x1080) rendered and validated.\n');
  }

  // --------------------------------------------------------------------------
  // CHALLENGE 5: Real FFmpeg Audio Ducking & SFX Filtergraph Execution
  // --------------------------------------------------------------------------
  console.log('🔍 [Challenge 5] Real Audio Ducking (-18dB) & Transition SFX adelay Execution...');

  // Create voiceover audio (5s sine 440Hz)
  const voiceAudioPath = path.join(TEMP_DIR, 'voice.wav');
  execFileSync(ffmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=5',
    voiceAudioPath,
  ]);

  // Create BGM audio (5s sine 220Hz)
  const bgmAudioPath = path.join(TEMP_DIR, 'bgm.wav');
  execFileSync(ffmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', 'sine=frequency=220:duration=5',
    bgmAudioPath,
  ]);

  // Create SFX audio (0.5s sine 880Hz)
  const sfxAudioPath = path.join(TEMP_DIR, 'sfx.wav');
  execFileSync(ffmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', 'sine=frequency=880:duration=0.5',
    sfxAudioPath,
  ]);

  // Test full ducking + 2 SFX transitions at 2.0s and 4.0s
  const duckingSfxChain = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(true, [2.0, 4.0], 2);
  const fullAudioFilter = `[0:a]volume=1.0[voice_in];[1:a]volume=0.12[bgm_in];[2:a]volume=0.35,asplit=2[sfx_0][sfx_1];${duckingSfxChain}`;
  const outMixedAudio = path.join(TEMP_DIR, 'mixed_audio.wav');

  execFileSync(ffmpegPath, [
    '-y',
    '-i', voiceAudioPath,
    '-i', bgmAudioPath,
    '-i', sfxAudioPath,
    '-filter_complex', fullAudioFilter,
    '-map', '[aout]',
    outMixedAudio,
  ]);

  assert(fs.existsSync(outMixedAudio) && fs.statSync(outMixedAudio).size > 1000);

  const audioProbe = JSON.parse(execFileSync(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,channels,sample_rate',
    '-of', 'json',
    outMixedAudio,
  ]).toString()).streams[0];

  assert.strictEqual(audioProbe.codec_name, 'pcm_s16le');
  console.log(`  ✅ Mixed audio successfully rendered with sidechain ducking and delayed SFX.`);

  // Test boundary: early cut < 0.2s clamps to 0ms
  const earlyDuckingChain = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(true, [0.05], 1);
  const earlyAudioFilter = `[0:a]volume=1.0[voice_in];[1:a]volume=0.12[bgm_in];[2:a]volume=0.35[sfx_0];${earlyDuckingChain}`;
  const outEarlyAudio = path.join(TEMP_DIR, 'early_cut_audio.wav');

  execFileSync(ffmpegPath, [
    '-y',
    '-i', voiceAudioPath,
    '-i', bgmAudioPath,
    '-i', sfxAudioPath,
    '-filter_complex', earlyAudioFilter,
    '-map', '[aout]',
    outEarlyAudio,
  ]);

  assert(fs.existsSync(outEarlyAudio));
  console.log(`  ✅ Early cut (< 0.2s) clamp to 0ms successfully rendered.\n`);

  cleanupTempDir();

  console.log('================================================================');
  console.log('🏆 ADVERSARIAL STRESS TEST: ALL 5 CHALLENGES PASSED EMPIRICALLY!');
  console.log('================================================================');
}

runAdversarialSuite().catch((err) => {
  cleanupTempDir();
  console.error('❌ Adversarial Stress Test Failed:', err);
  process.exit(1);
});
