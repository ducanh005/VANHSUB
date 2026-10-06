/**
 * tests/test_m4_video_assembler.ts
 *
 * Dedicated Milestone 4 (M4) Unit & Integration Test Suite for AiStudioVideoAssembler.
 * Tests:
 * 1. Dynamic Pan/Zoom Ken Burns (6 Cinematic Motion Profiles with 1.5x pre-upscaling)
 * 2. Dynamic Audio Ducking (-18dB on Speech) via sidechaincompress
 * 3. Scene Transition SFX insertion at Tk - 0.2s via adelay and amix
 * 4. Boundary cases: 9:16 vertical, 1:1 square, early cuts < 0.2s, no BGM, no SFX
 */

import assert from 'assert';
import {
  AiStudioVideoAssembler,
  CINEMATIC_CAMERA_MOTION_PROFILES,
  type KenBurnsMotionProfile,
} from '../main/ai-studio/services/AiStudioVideoAssembler';

async function runTests() {
  console.log('--- 🎬 TEST M4: VIDEO EDITING & AUDIO DESIGN SUITE ---');

  // Test 1: Exactly 6 Cinematic Camera Motion Profiles
  console.log('  Testing Ken Burns 6 motion profiles...');
  const profiles = AiStudioVideoAssembler.getKenBurnsProfiles(1920, 1080, 4.0);
  assert.strictEqual(profiles.length, 6, 'Must generate exactly 6 profiles');

  const names = profiles.map((p) => p.name);
  assert.deepStrictEqual(names, [
    'Pan L->R',
    'Pan R->L',
    'Zoom 1/3 Left',
    'Zoom 1/3 Right',
    'Zoom-out Wide',
    'Push-in Hero',
  ]);

  // Test 2: 1.5x Pre-upscaling to eliminate subpixel shimmering
  console.log('  Testing 1.5x pre-upscaling across resolutions...');
  // 1920x1080 -> 2880x1620
  assert(profiles[0].scaleFilter.includes('scale=2880:1620'));
  assert(profiles[0].scaleFilter.includes('crop=2880:1620'));

  // 9:16 vertical: 1080x1920 -> 1620x2880
  const verticalProfiles = AiStudioVideoAssembler.getKenBurnsProfiles(1080, 1920, 5.0);
  assert.strictEqual(verticalProfiles.length, 6);
  assert(verticalProfiles[0].scaleFilter.includes('scale=1620:2880'));

  // 1:1 square: 1080x1080 -> 1620x1620
  const squareProfiles = AiStudioVideoAssembler.getKenBurnsProfiles(1080, 1080, 3.0);
  assert.strictEqual(squareProfiles.length, 6);
  assert(squareProfiles[0].scaleFilter.includes('scale=1620:1620'));

  // Test 3: Motion Profile Equations
  console.log('  Testing motion profile equations (Pan L->R, Pan R->L, Rule-of-Thirds)...');
  const panLR = profiles.find((p) => p.name === 'Pan L->R')!;
  assert(panLR.panEquation.includes("(iw-iw/zoom)*(on/100)'"));
  assert.strictEqual(panLR.zoomEquation, "z='1.15'");

  const panRL = profiles.find((p) => p.name === 'Pan R->L')!;
  assert(panRL.panEquation.includes("(iw-iw/zoom)*(1-on/100)'"));

  const thirdLeft = profiles.find((p) => p.name === 'Zoom 1/3 Left')!;
  assert(thirdLeft.panEquation.includes('iw*0.33'));
  assert.strictEqual(thirdLeft.zoomEquation, "z='min(zoom+0.0015,1.25)'");

  const thirdRight = profiles.find((p) => p.name === 'Zoom 1/3 Right')!;
  assert(thirdRight.panEquation.includes('iw*0.67'));

  const zoomWide = profiles.find((p) => p.name === 'Zoom-out Wide')!;
  assert(zoomWide.zoomEquation.includes('max(1.25-0.0015*on,1.0)'));

  const pushIn = profiles.find((p) => p.name === 'Push-in Hero')!;
  assert(pushIn.zoomEquation.includes('min(1.0+0.002*on,1.20)'));

  // Test 4: Dynamic Audio Ducking (-18dB on Speech via sidechaincompress)
  console.log('  Testing Dynamic Audio Ducking sidechaincompress filter graph...');
  const duckingChain = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(true, [], 0);
  assert(duckingChain.includes('[voice_in]asplit=2[voice_main][voice_sidechain]'));
  assert(
    duckingChain.includes(
      'sidechaincompress=threshold=0.03:ratio=8:attack=25:release=400:knee=2.5[bgm_ducked]'
    )
  );
  assert(duckingChain.includes('[voice_main][bgm_ducked]amix=inputs=2:duration=first:dropout_transition=2[aout]'));

  // Test 5: Scene Transition SFX Insertion at Tk - 0.2s via adelay & amix
  console.log('  Testing Scene Transition SFX insertion at Tk - 0.2s...');
  // Cuts at 3.5s and 7.0s
  const sfxChain = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(true, [3.5, 7.0], 2);
  // Cut 1: 3.5s - 0.2s = 3.3s = 3300ms
  assert(sfxChain.includes('adelay=3300|3300[sfx_0_delayed]'));
  // Cut 2: 7.0s - 0.2s = 6.8s = 6800ms
  assert(sfxChain.includes('adelay=6800|6800[sfx_1_delayed]'));
  assert(sfxChain.endsWith('[aout]'));

  // Test 6: Boundary: Early cut timestamp < 0.2s clamps delay to 0ms
  console.log('  Testing early cut boundary (< 0.2s)...');
  const earlyCutChain = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(true, [0.1], 1);
  assert(earlyCutChain.includes('adelay=0|0[sfx_0_delayed]'));

  // Test 7: Boundary: No BGM (Voiceover only)
  console.log('  Testing voiceover-only without BGM...');
  const noBgmChain = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(false, [], 0);
  assert.strictEqual(noBgmChain, '[voice_in]anull[aout]');

  // Test 8: Instance method equivalence
  console.log('  Testing instance method delegation...');
  const instance = AiStudioVideoAssembler.getInstance();
  const instProfiles = instance.getKenBurnsProfiles(1920, 1080, 4.0);
  assert.strictEqual(instProfiles.length, 6);
  const instChain = instance.buildDuckingAndSfxFilterChain(true, [4.0], 1);
  assert(instChain.includes('adelay=3800|3800'));

  console.log('\n🎉 ALL M4 TESTS PASSED SUCCESSFULLY (100% PASS RATE)!');
}

runTests().catch((err) => {
  console.error('❌ M4 Test failure:', err);
  process.exit(1);
});
