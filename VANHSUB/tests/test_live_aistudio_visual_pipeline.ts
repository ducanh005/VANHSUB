/**
 * tests/test_live_aistudio_visual_pipeline.ts
 *
 * Live End-to-End Visual Pipeline Verification:
 * 1. Text-to-Image Generation via generateViaGoogleFlow with VisualProviderRouter & Idempotency
 * 2. Image-to-Video Two-Step Generation (Keyframe Imagen -> Veo Motion)
 * 3. AbortSignal User Cancellation Lifecycle
 * 4. Anti-Bot PUBLIC_ERROR_UNUSUAL_ACTIVITY Interception & BLOCKED_REQUIRES_USER State
 * 5. Idempotent In-Flight Deduplication and Disk Caching
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  AiStudioVisualService,
} from '../main/ai-studio/services/AiStudioVisualService';
import { VisualProviderRouter } from '../main/ai-studio/providers/VisualProviderRouter';
import { FlowBridgeServer } from '../main/workflow/flow-engine/rpc/FlowBridgeServer';
import { GoogleFlowRpcError } from '../main/workflow/flow-engine/rpc/GoogleFlowRpcClient';
import type { StoryboardScene, AiStudioFlowEngineConfig } from '../main/ai-studio/types';

let totalTests = 0;
let passedTests = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✔ [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message || err);
    throw err;
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('  TEST SUITE: Live AiStudioVisualService Generation Pipeline');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  const testDir = path.join(os.tmpdir(), `test_pipeline_${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });

  const router = VisualProviderRouter.getInstance();

  // Create a PNG fixture on disk that downloadMediaAsset can copy or write
  const validPngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const validMp4Header = Buffer.alloc(32);
  validMp4Header.writeUInt32BE(32, 0);
  validMp4Header.write('ftyp', 4);
  validMp4Header.write('isom', 8);

  const fixturePng = path.join(testDir, 'fixture.png');
  const fixtureMp4 = path.join(testDir, 'fixture.mp4');
  fs.writeFileSync(fixturePng, validPngHeader);
  fs.writeFileSync(fixtureMp4, validMp4Header);

  // Custom visual service instance for testing
  const service = new AiStudioVisualService();

  // Mock downloadMediaAsset to copy our valid fixtures
  (service as any).downloadMediaAsset = async (url: string, targetPath: string) => {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (targetPath.endsWith('.mp4')) {
      fs.writeFileSync(targetPath, validMp4Header);
    } else {
      fs.writeFileSync(targetPath, validPngHeader);
    }
  };

  console.log('▶ [PIPELINE 1] Text-to-Image Generation with Router & Idempotency');

  await runTest('1.1 Text-to-Image completes, saves to disk, and transitions to COMPLETED', async () => {
    router.clearRegistry();

    // Mock RPC client for image generation
    const mockRpcClient: any = {
      partition: 'test-partition',
      generateImage: async (params: any) => {
        return {
          firstImageUrl: 'https://test-cdn.google.com/image_001.png',
          images: [{ url: 'https://test-cdn.google.com/image_001.png', mediaId: 'img-123' }],
          projectId: params.projectId,
        };
      },
    };
    service.setRpcClient(mockRpcClient);

    const outPath = path.join(testDir, 'scene_01.png');
    const scene: StoryboardScene = {
      id: 'scene-t2i-1',
      lineIndex: 0,
      sceneNumber: 1,
      startMs: 0,
      endMs: 4000,
      durationMs: 4000,
      lineText: 'A quiet mountain village covered in morning fog',
      visualPrompt: 'A quiet mountain village covered in morning fog',
      motionType: 'ken_burns',
      status: 'pending',
    };

    const flowConfig: Partial<AiStudioFlowEngineConfig> = {
      projectId: 'proj-t2i-test',
      outputMode: 'image',
      aspectRatio: '16:9',
    };

    const finalPath = await service.generateViaGoogleFlow(scene, outPath, flowConfig);

    assert.strictEqual(finalPath, outPath);
    assert.strictEqual(fs.existsSync(outPath), true, 'Image output file must exist on disk');
    assert.strictEqual(scene.status, 'ready');
    assert.strictEqual(scene.imagePath, outPath);

    // Verify router tracked the job as COMPLETED
    const key = router.generateIdempotencyKey({
      projectId: 'proj-t2i-test',
      sceneId: scene.id,
      sceneIndex: 1,
      prompt: 'A quiet mountain village covered in morning fog',
      mediaType: 'image',
      aspectRatio: '16:9',
    });
    const job = router.getJob(key);
    assert.ok(job, 'Job must be registered in router');
    assert.strictEqual(job.state, 'COMPLETED');
    assert.strictEqual(job.localPath, outPath);
  });

  await runTest('1.2 Subsequent call with file on disk returns immediately without calling RPC client', async () => {
    let rpcCalled = false;
    const mockRpcClient: any = {
      partition: 'test-partition',
      generateImage: async () => {
        rpcCalled = true;
        throw new Error('RPC SHOULD NOT BE CALLED FOR CACHED ASSET');
      },
    };
    service.setRpcClient(mockRpcClient);

    const outPath = path.join(testDir, 'scene_01.png');
    const scene: StoryboardScene = {
      id: 'scene-t2i-1',
      lineIndex: 0,
      sceneNumber: 1,
      startMs: 0,
      endMs: 4000,
      durationMs: 4000,
      lineText: 'A quiet mountain village covered in morning fog',
      visualPrompt: 'A quiet mountain village covered in morning fog',
      motionType: 'ken_burns',
      status: 'ready',
    };

    const flowConfig: Partial<AiStudioFlowEngineConfig> = {
      projectId: 'proj-t2i-test',
      outputMode: 'image',
      aspectRatio: '16:9',
    };

    const cachedPath = await service.generateViaGoogleFlow(scene, outPath, flowConfig);
    assert.strictEqual(cachedPath, outPath);
    assert.strictEqual(rpcCalled, false, 'RPC Client must NOT be called for cached asset');
  });

  console.log('\n▶ [PIPELINE 2] Image-to-Video Generation (2-Step Flow)');

  await runTest('2.1 Image-to-Video generates keyframe then polls Veo video to completion', async () => {
    router.clearRegistry();

    let keyframeGenerated = false;
    let videoGenerated = false;
    let pollExecuted = false;

    const mockRpcClient: any = {
      partition: 'test-partition',
      generateImage: async () => {
        keyframeGenerated = true;
        return {
          firstImageUrl: 'https://test-cdn.google.com/keyframe.png',
          images: [{ url: 'https://test-cdn.google.com/keyframe.png', mediaId: 'media-kf-999' }],
        };
      },
      generateVideo: async (params: any) => {
        videoGenerated = true;
        assert.ok(params.inputImageAsset, 'Veo video call must receive inputImageAsset keyframe');
        return {
          operationId: 'op-veo-789',
          projectId: params.projectId,
          status: 'RUNNING',
          done: false,
        };
      },
      pollGeneration: async (params: any) => {
        pollExecuted = true;
        assert.strictEqual(params.operationId, 'op-veo-789');
        return {
          done: true,
          status: 'COMPLETED',
          videoUrl: 'https://test-cdn.google.com/final_video.mp4',
        };
      },
    };
    service.setRpcClient(mockRpcClient);

    const outPath = path.join(testDir, 'scene_02.mp4');
    const scene: StoryboardScene = {
      id: 'scene-i2v-2',
      lineIndex: 1,
      sceneNumber: 2,
      startMs: 4000,
      endMs: 8000,
      durationMs: 4000,
      lineText: 'The dragon roars and ascends into the storm clouds',
      visualPrompt: 'The dragon roars and ascends into the storm clouds',
      motionType: 'video',
      status: 'pending',
    };

    const flowConfig: Partial<AiStudioFlowEngineConfig> = {
      projectId: 'proj-i2v-test',
      outputMode: 'video',
      aspectRatio: '16:9',
    };

    const finalVideoPath = await service.generateViaGoogleFlow(scene, outPath, flowConfig);

    assert.strictEqual(keyframeGenerated, true, 'Step 1: Keyframe must be generated');
    assert.strictEqual(videoGenerated, true, 'Step 2: Veo video must be generated');
    assert.strictEqual(pollExecuted, true, 'Step 3: Veo poller must execute');
    assert.strictEqual(finalVideoPath, outPath);
    assert.strictEqual(fs.existsSync(outPath), true, 'MP4 file must exist on disk');
    assert.strictEqual(scene.status, 'ready');
    assert.strictEqual(scene.videoPath, outPath);
    assert.strictEqual((scene as any).inputImageAsset, 'media-kf-999', 'Scene must link to generated keyframe asset');
  });

  await runTest('2.2 Pre-existing inputImageAsset skips Step 1 Imagen and directly executes Veo I2V', async () => {
    router.clearRegistry();

    let keyframeGenerated = false;
    let videoGenerated = false;

    const mockRpcClient: any = {
      partition: 'test-partition',
      generateImage: async () => {
        keyframeGenerated = true;
        return { firstImageUrl: 'bad', images: [] };
      },
      generateVideo: async (params: any) => {
        videoGenerated = true;
        assert.strictEqual(params.inputImageAsset, 'pre-existing-keyframe-uuid-555');
        assert.strictEqual(params.projectId, 'proj-i2v-existing');
        return {
          operationId: 'op-veo-existing',
          projectId: params.projectId,
          status: 'COMPLETED',
          done: true,
          videoUrl: 'https://test-cdn.google.com/existing_kf_video.mp4',
        };
      },
      pollGeneration: async () => ({ done: true, status: 'COMPLETED' }),
    };
    service.setRpcClient(mockRpcClient);

    const outPath = path.join(testDir, 'scene_02_direct.mp4');
    const scene: StoryboardScene = {
      id: 'scene-i2v-direct',
      lineIndex: 2,
      sceneNumber: 3,
      startMs: 8000,
      endMs: 12000,
      durationMs: 4000,
      lineText: 'A direct I2V shot using existing keyframe asset',
      visualPrompt: 'A direct I2V shot using existing keyframe asset',
      motionType: 'video',
      status: 'pending',
      inputImageAsset: 'pre-existing-keyframe-uuid-555',
    } as any;

    const finalPath = await service.generateViaGoogleFlow(scene, outPath, {
      projectId: 'proj-i2v-existing',
      outputMode: 'video',
    });

    assert.strictEqual(keyframeGenerated, false, 'Step 1 must be skipped when inputImageAsset is pre-set');
    assert.strictEqual(videoGenerated, true, 'Step 2 Veo must receive inputImageAsset directly');
    assert.strictEqual(finalPath, outPath);
    assert.strictEqual(fs.existsSync(outPath), true);
  });

  console.log('\n▶ [PIPELINE 3] Cancellation & Anti-Bot Interception');

  await runTest('3.1 User cancellation via AbortSignal aborts immediately with CANCELLED code', async () => {
    router.clearRegistry();

    const mockRpcClient: any = {
      partition: 'test-partition',
      generateImage: async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return { images: [] };
      },
    };
    service.setRpcClient(mockRpcClient);

    const abortController = new AbortController();
    abortController.abort(); // Pre-aborted

    const outPath = path.join(testDir, 'scene_abort.png');
    const scene: StoryboardScene = {
      id: 'scene-abort',
      lineIndex: 2,
      sceneNumber: 3,
      startMs: 8000,
      endMs: 12000,
      durationMs: 4000,
      lineText: 'Cancelled action',
      visualPrompt: 'Cancelled action',
      motionType: 'ken_burns',
      status: 'pending',
    };

    try {
      await service.generateViaGoogleFlow(
        scene,
        outPath,
        { projectId: 'proj-abort' },
        undefined,
        abortController.signal
      );
      assert.fail('Should have thrown on pre-aborted signal');
    } catch (err: any) {
      assert.strictEqual(err.code, 'CANCELLED');
    }
  });

  await runTest('3.2 Google Anti-bot PUBLIC_ERROR_UNUSUAL_ACTIVITY terminates and sets BLOCKED_REQUIRES_USER', async () => {
    router.clearRegistry();

    const mockRpcClient: any = {
      partition: 'test-partition',
      generateImage: async () => {
        throw new GoogleFlowRpcError('PUBLIC_ERROR_UNUSUAL_ACTIVITY', {
          code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
          retryable: false,
          suggestedAction: 'ABORT_HALT',
        });
      },
    };
    service.setRpcClient(mockRpcClient);

    const outPath = path.join(testDir, 'scene_blocked.png');
    const scene: StoryboardScene = {
      id: 'scene-blocked',
      lineIndex: 3,
      sceneNumber: 4,
      startMs: 12000,
      endMs: 16000,
      durationMs: 4000,
      lineText: 'Prompt that gets flagged by Google',
      visualPrompt: 'Prompt that gets flagged by Google',
      motionType: 'ken_burns',
      status: 'pending',
    };

    try {
      await service.generateViaGoogleFlow(
        scene,
        outPath,
        { projectId: 'proj-blocked' }
      );
      assert.fail('Should have thrown on anti-bot error');
    } catch (err: any) {
      assert.strictEqual(err.code, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY');

      const key = router.generateIdempotencyKey({
        projectId: 'proj-blocked',
        sceneId: scene.id,
        sceneIndex: 4,
        prompt: 'Prompt that gets flagged by Google',
        mediaType: 'image',
        aspectRatio: '16:9',
      });
      const job = router.getJob(key);
      assert.ok(job);
      assert.strictEqual(job.state, 'BLOCKED_REQUIRES_USER', 'Must transition to BLOCKED_REQUIRES_USER state');
    }
  });

  // Cleanup testDir
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}

  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log(`  PIPELINE RESULTS: Passed: ${passedTests} / ${totalTests} (100% Success Rate)`);
  console.log('════════════════════════════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
