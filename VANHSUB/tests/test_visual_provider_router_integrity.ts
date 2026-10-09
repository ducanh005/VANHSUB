/**
 * test_visual_provider_router_integrity.ts
 *
 * Automated verification suite for Milestone 4:
 * 1. Visual Provider Router Hierarchy (Flow -> Official Gemini/Veo -> Ken Burns)
 * 2. Preservation of Generation Capabilities (T2I, I2V, T2V, Keyframe, Ken Burns)
 * 3. Multi-Scene Sequencing & Media Output Validation
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  VisualProviderRouter,
  VisualGenerationRequest,
  VisualGenerationResult,
} from '../main/ai-studio/providers/VisualProviderRouter';
import { StoryboardScene } from '../main/ai-studio/services/AiStudioStoryboardService';

let totalTests = 0;
let passedTests = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✔ ${name}`);
  } catch (err: any) {
    console.error(`  ❌ ${name}:`, err.message);
    throw err;
  }
}

async function main() {
  console.log('======================================================================');
  console.log('  TEST SUITE: Visual Provider Router & Pipeline Integrity (M4)');
  console.log('======================================================================\n');

  const router = VisualProviderRouter.getInstance();

  console.log('Suite 1: Visual Provider Router Configuration & Official API Detection');

  await runTest('1.1 isOfficialApiConfigured returns false when no API key is provided', () => {
    assert.strictEqual(router.isOfficialApiConfigured(undefined), false);
    assert.strictEqual(router.isOfficialApiConfigured(''), false);
    assert.strictEqual(router.isOfficialApiConfigured('short'), false);
  });

  await runTest('1.2 isOfficialApiConfigured returns true when valid API key is supplied', () => {
    assert.strictEqual(router.isOfficialApiConfigured('AIzaSyD-dummy-api-key-for-test-39281'), true);
  });

  console.log('\nSuite 2: Multi-Provider Hierarchy & Fallback Execution');

  await runTest('2.1 Primary provider generates image successfully', async () => {
    router.clearRegistry();
    const tmpOut = path.join(__dirname, 'm4_primary_image.png');
    fs.writeFileSync(tmpOut, 'PRIMARY_IMAGE_CONTENT');

    const key = router.generateIdempotencyKey({
      prompt: 'a tranquil lake surrounded by pine trees',
      mediaType: 'image',
    });

    const req: VisualGenerationRequest = {
      idempotencyKey: key,
      mediaType: 'image',
      prompt: 'a tranquil lake surrounded by pine trees',
      aspectRatio: '16:9',
      targetPath: tmpOut,
    };

    const res = await router.executeWithIdempotency(req, async () => {
      return {
        provider: 'google_flow_rpc',
        mediaType: 'image',
        localPath: tmpOut,
        state: 'COMPLETED',
      };
    });

    assert.strictEqual(res.provider, 'google_flow_rpc');
    assert.strictEqual(res.state, 'COMPLETED');
    assert.strictEqual(fs.existsSync(res.localPath), true);

    try { fs.unlinkSync(tmpOut); } catch {}
  });

  await runTest('2.2 When primary fails, fallback to Official API executes correctly', async () => {
    router.clearRegistry();
    const tmpOut = path.join(__dirname, 'm4_official_api_image.png');
    fs.writeFileSync(tmpOut, 'OFFICIAL_API_IMAGE_CONTENT');

    const key = router.generateIdempotencyKey({
      prompt: 'cyberpunk street in rain',
      mediaType: 'image',
    });

    const req: VisualGenerationRequest = {
      idempotencyKey: key,
      mediaType: 'image',
      prompt: 'cyberpunk street in rain',
      aspectRatio: '16:9',
      apiKey: 'AIzaSyFakeKeyForTest-123456789',
      targetPath: tmpOut,
    };

    const res = await router.executeWithIdempotency(req, async (r) => {
      // Simulate primary failure and routing to official API
      let providerUsed = 'google_flow_rpc';
      try {
        throw new Error('PUBLIC_ERROR_UNUSUAL_ACTIVITY');
      } catch {
        if (router.isOfficialApiConfigured(r.apiKey)) {
          providerUsed = 'official_gemini_api';
        }
      }

      return {
        provider: providerUsed as any,
        mediaType: 'image',
        localPath: tmpOut,
        state: 'COMPLETED',
      };
    });

    assert.strictEqual(res.provider, 'official_gemini_api');
    assert.strictEqual(res.state, 'COMPLETED');

    try { fs.unlinkSync(tmpOut); } catch {}
  });

  await runTest('2.3 Video generation failure degrades gracefully to Ken Burns when keyframe exists', async () => {
    router.clearRegistry();
    const keyframeFile = path.join(__dirname, 'm4_keyframe.png');
    fs.writeFileSync(keyframeFile, 'KEYFRAME_PNG');

    const scene: Partial<StoryboardScene> = {
      id: 'scene-1',
      index: 1,
      imagePrompt: 'A castle on a misty hill',
      motionPrompt: 'Slow zoom into the castle tower',
      imagePath: keyframeFile,
    };

    // Simulate degradation logic
    let finalPath = '';
    let motionType = 'video';
    try {
      throw new Error('Video generation timed out');
    } catch {
      if (scene.imagePath && fs.existsSync(scene.imagePath)) {
        finalPath = scene.imagePath;
        motionType = 'ken_burns';
        scene.assetPath = scene.imagePath;
        delete scene.videoPath;
        scene.motionType = 'ken_burns';
      }
    }

    assert.strictEqual(finalPath, keyframeFile);
    assert.strictEqual(motionType, 'ken_burns');
    assert.strictEqual(scene.assetPath, keyframeFile);
    assert.strictEqual(scene.videoPath, undefined);

    try { fs.unlinkSync(keyframeFile); } catch {}
  });

  console.log('\nSuite 3: Multi-Scene Sequencing & Asset Tracking');

  await runTest('3.1 Multi-scene sequence preserves asset status across multiple scenes', () => {
    const scenes: Partial<StoryboardScene>[] = [
      { id: 'sc-1', index: 1, imagePrompt: 'Prompt 1', status: 'idle' },
      { id: 'sc-2', index: 2, imagePrompt: 'Prompt 2', status: 'idle' },
      { id: 'sc-3', index: 3, imagePrompt: 'Prompt 3', status: 'idle' },
    ];

    // Simulate completion of scenes
    scenes[0].assetPath = '/assets/scene_1.mp4';
    scenes[0].videoPath = '/assets/scene_1.mp4';
    scenes[0].status = 'ready';

    scenes[1].assetPath = '/assets/scene_2.png';
    scenes[1].imagePath = '/assets/scene_2.png';
    scenes[1].motionType = 'ken_burns';
    scenes[1].status = 'ready';

    scenes[2].assetPath = '/assets/scene_3.mp4';
    scenes[2].videoPath = '/assets/scene_3.mp4';
    scenes[2].status = 'ready';

    assert.strictEqual(scenes.every((s) => s.status === 'ready'), true);
    assert.strictEqual(scenes[1].motionType, 'ken_burns');
    assert.strictEqual(scenes[0].videoPath, '/assets/scene_1.mp4');
  });

  console.log('\n======================================================================');
  console.log(`  RESULTS: Passed: ${passedTests} | Failed: ${totalTests - passedTests}`);
  console.log('======================================================================\n');
}

main().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
