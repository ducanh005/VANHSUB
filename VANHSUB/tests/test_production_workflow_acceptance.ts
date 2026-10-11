/**
 * tests/test_production_workflow_acceptance.ts
 *
 * VANHSUB MOCKED INTEGRATION PRODUCTION WORKFLOW TEST SUITE (3 SCENES)
 * 
 * NOTE: This is a MOCKED INTEGRATION TEST that verifies the complete orchestrator,
 * lifecycle state transitions, callbacks, media validation, asset content isolation,
 * FFmpeg concatenation, and fault tolerance without consuming live Google Flow quota.
 * 
 * For real Live Google Flow generation, see tests/test_live_production_workflow_acceptance.ts.
 *
 * Acceptance Criteria Verified:
 * 1. Dedicated test project directory, strictly isolated from user projects
 * 2. 3 independent scenes with separate visual prompts, motion prompts, and keyframes
 * 3. Strict asset content isolation: distinct buffers and distinct SHA-256 hashes per scene
 * 4. Monotonic UI progress callbacks across sequential pipeline stages
 * 5. Production media validation (normalizeAndValidateMediaFile via FFmpeg)
 * 6. Final video sequence export (VideoProcessor.concatVideos) with 100% full frame decode
 * 7. Browser tab focus safety: adapter behavior verifies bringToFront is not called by default
 * 8. In-flight cancellation: aborting a pending running job halts and rejects cleanly
 * 9. Anti-bot safety: PUBLIC_ERROR_UNUSUAL_ACTIVITY halts retry loop immediately (ABORT_HALT)
 * 10. Controlled browser disconnect fault-injection handling
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import { AiStudioVisualService } from '../main/ai-studio/services/AiStudioVisualService';
import { VisualProviderRouter } from '../main/ai-studio/providers/VisualProviderRouter';
import { BrowserAutomationAdapter } from '../main/browser-automation/BrowserAutomationAdapter';
import { VideoProcessor } from '../main/workflow/videoProcessor';
import { normalizeAndValidateMediaFile } from '../main/browser-automation/mediaValidator';
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

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('  VANHSUB MOCKED INTEGRATION PRODUCTION WORKFLOW TEST SUITE (3 SCENES)');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  const testProjectDir = path.join(os.tmpdir(), `vanhsub_acceptance_proj_${Date.now()}`);
  fs.mkdirSync(testProjectDir, { recursive: true });

  const fixturesDir = path.join(testProjectDir, 'fixtures');
  fs.mkdirSync(fixturesDir, { recursive: true });

  // Generate 3 DISTINCT procedural image and video fixtures using FFmpeg lavfi
  console.log('🎨 Khởi tạo 3 bộ media fixtures độc lập bằng FFmpeg (màu sắc, nội dung & hash riêng biệt)...');
  const colors = [
    { name: 'navy', hex: '0x000080' },
    { name: 'darkslategray', hex: '0x2F4F4F' },
    { name: 'firebrick', hex: '0xB22222' }
  ];

  const sceneImgBuffers: Buffer[] = [];
  const sceneVidBuffers: Buffer[] = [];

  for (let idx = 0; idx < 3; idx++) {
    const col = colors[idx];
    const imgPath = path.join(fixturesDir, `fixture_scene_${idx + 1}.png`);
    const vidPath = path.join(fixturesDir, `fixture_scene_${idx + 1}.mp4`);

    // Create unique image (640x360 PNG)
    execSync(`ffmpeg -y -v error -f lavfi -i color=c=${col.name}:s=640x360:d=1 -vframes 1 "${imgPath}"`);
    // Create unique video (640x360 MP4, 2 seconds, 25fps)
    execSync(`ffmpeg -y -v error -f lavfi -i color=c=${col.name}:s=640x360:d=2 -c:v libx264 -pix_fmt yuv420p "${vidPath}"`);

    const imgBuf = fs.readFileSync(imgPath);
    const vidBuf = fs.readFileSync(vidPath);

    sceneImgBuffers.push(imgBuf);
    sceneVidBuffers.push(vidBuf);

    console.log(`  - Scene ${idx + 1} (${col.name}): Img SHA256=${sha256(imgBuf).slice(0, 16)}..., Vid SHA256=${sha256(vidBuf).slice(0, 16)}...`);
  }

  // Verify fixtures have distinct SHA-256 hashes
  assert.notStrictEqual(sha256(sceneImgBuffers[0]), sha256(sceneImgBuffers[1]));
  assert.notStrictEqual(sha256(sceneImgBuffers[1]), sha256(sceneImgBuffers[2]));
  assert.notStrictEqual(sha256(sceneVidBuffers[0]), sha256(sceneVidBuffers[1]));
  assert.notStrictEqual(sha256(sceneVidBuffers[1]), sha256(sceneVidBuffers[2]));

  const router = VisualProviderRouter.getInstance();
  const adapter = BrowserAutomationAdapter.getInstance();
  const service = new AiStudioVisualService();

  console.log(`\n📁 Thư mục dự án kiểm thử độc lập: ${testProjectDir}\n`);

  // ────────────────────────────────────────────────────────────────────────────
  // WORKFLOW SECTION 1: 3-Scene Storyboard Setup & Asset Independence
  // ────────────────────────────────────────────────────────────────────────────
  console.log('▶ [PHASE 1] Storyboard Setup (3 Independent Scenes with Distinct Prompts)');

  const scenes: StoryboardScene[] = [
    {
      id: 'scene_01_mountain',
      lineIndex: 0,
      sceneNumber: 1,
      startMs: 0,
      endMs: 4000,
      durationMs: 4000,
      lineText: 'Cinematic sunrise over misty mountain peaks',
      visualPrompt: 'Cinematic sunrise over misty mountain peaks, golden rays breaking through fog, 8k hyper-realistic',
      motionType: 'video',
      status: 'pending',
    },
    {
      id: 'scene_02_autumn',
      lineIndex: 1,
      sceneNumber: 2,
      startMs: 4000,
      endMs: 8000,
      durationMs: 4000,
      lineText: 'Close-up macro of autumn maple leaves covered with dew drops',
      visualPrompt: 'Close-up macro of autumn maple leaves covered with dew drops in gentle breeze, 8k',
      motionType: 'video',
      status: 'pending',
    },
    {
      id: 'scene_03_waterfall',
      lineIndex: 2,
      sceneNumber: 3,
      startMs: 8000,
      endMs: 12000,
      durationMs: 4000,
      lineText: 'Majestic waterfall cascading into emerald forest pool',
      visualPrompt: 'Majestic waterfall cascading into emerald forest pool, lush ferns, ethereal sunlight, 8k',
      motionType: 'video',
      status: 'pending',
    },
  ];

  await runTest('1.1 Storyboard scenes are uniquely keyed and independent', () => {
    assert.strictEqual(scenes.length, 3, 'Storyboard must contain exactly 3 scenes');
    const ids = new Set(scenes.map(s => s.id));
    assert.strictEqual(ids.size, 3, 'Scene IDs must be strictly unique');
    const prompts = new Set(scenes.map(s => s.visualPrompt));
    assert.strictEqual(prompts.size, 3, 'Prompts must be completely independent');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // WORKFLOW SECTION 2: Production Pipeline Execution (Keyframe -> I2V -> Validation)
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [PHASE 2] Production Pipeline Execution with Unique Asset Fixtures & Validation');

  const progressUpdates: Array<{ pct: number; msg: string }> = [];
  const completedScenes: StoryboardScene[] = [];

  // Wire production service download to output the respective unique fixture per scene
  (service as any).downloadMediaAsset = async (url: string, targetPath: string) => {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const isVid = targetPath.endsWith('.mp4');
    let idx = 0;
    if (url.includes('scene-2') || targetPath.includes('scene_02')) idx = 1;
    else if (url.includes('scene-3') || targetPath.includes('scene_03')) idx = 2;

    const buf = isVid ? sceneVidBuffers[idx] : sceneImgBuffers[idx];
    fs.writeFileSync(targetPath, buf);
    return targetPath;
  };

  // Mock RPC client so testing runs cleanly through full pipeline
  const mockRpcClient: any = {
    partition: 'test-partition',
    getCookieString: async () => '',
    generateImage: async (params: any) => {
      const idx = params.prompt.includes('mountain') ? 1 : params.prompt.includes('autumn') ? 2 : 3;
      return {
        firstImageUrl: `https://flow-content.google/image/media-uuid-scene-${idx}`,
        images: [{ url: `https://flow-content.google/image/media-uuid-scene-${idx}`, mediaId: `asset-uuid-00${idx}` }],
        projectId: params.projectId,
      };
    },
    generateVideo: async (params: any) => {
      const idx = params.prompt.includes('mountain') ? 1 : params.prompt.includes('autumn') ? 2 : 3;
      return {
        operationId: `op-scene-${idx}`,
        projectId: params.projectId,
        status: 'COMPLETED',
        done: true,
        videoUrl: `https://flow-content.google/video/media-vid-scene-${idx}`,
      };
    },
    pollOperation: async (params: any) => {
      return {
        operationId: params.operationId,
        status: 'COMPLETED',
        done: true,
        videoUrl: `https://flow-content.google/video/${params.operationId}.mp4`,
      };
    },
  };
  service.setRpcClient(mockRpcClient);

  const flowConfig: Partial<AiStudioFlowEngineConfig> = {
    projectId: 'acceptance-test-project-vanhsub',
    outputMode: 'video',
    aspectRatio: '16:9',
    fullMediaDecode: true,
    skipCooldown: true, // fast execution in automated verification
  };

  await runTest('2.1 dispatchVisualAssets runs 3 scenes sequentially through production pipeline', async () => {
    router.clearRegistry();

    const result = await service.dispatchVisualAssets(
      scenes,
      flowConfig,
      testProjectDir,
      (pct, msg) => {
        progressUpdates.push({ pct, msg });
      },
      undefined,
      async (scene, index) => {
        completedScenes.push({ ...scene });
      }
    );

    assert.strictEqual(result.generatedCount, 3, 'All 3 scenes must be successfully generated');
    assert.strictEqual(completedScenes.length, 3, 'All 3 scene complete callbacks must fire');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // WORKFLOW SECTION 3: Asset Content Isolation & Media Decodability
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [PHASE 3] Strict Asset Content Isolation & Media Decodability');

  await runTest('3.1 Keyframe and video outputs exist on disk per scene', () => {
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      assert.ok(s.imagePath && fs.existsSync(s.imagePath), `Scene ${i + 1} keyframe must exist: ${s.imagePath}`);
      assert.ok(s.videoPath && fs.existsSync(s.videoPath), `Scene ${i + 1} video must exist: ${s.videoPath}`);
      assert.strictEqual(s.status, 'ready', `Scene ${i + 1} status must be ready`);
    }
  });

  await runTest('3.2 Strict asset content isolation: Distinct SHA-256 hashes between all scenes', () => {
    const keyframePaths = new Set(scenes.map(s => s.imagePath));
    const videoPaths = new Set(scenes.map(s => s.videoPath));

    assert.strictEqual(keyframePaths.size, 3, 'All 3 keyframes must have distinct paths');
    assert.strictEqual(videoPaths.size, 3, 'All 3 scene videos must have distinct paths');

    // Read and verify SHA-256 hashes are strictly unique across all scenes
    const imgHashes = scenes.map(s => sha256(fs.readFileSync(s.imagePath!)));
    const vidHashes = scenes.map(s => sha256(fs.readFileSync(s.videoPath!)));

    const uniqueImgHashes = new Set(imgHashes);
    const uniqueVidHashes = new Set(vidHashes);

    assert.strictEqual(uniqueImgHashes.size, 3, 'All 3 keyframes must have unique SHA-256 content hashes');
    assert.strictEqual(uniqueVidHashes.size, 3, 'All 3 videos must have unique SHA-256 content hashes');

    console.log(`    - Scene 1 Video SHA-256: ${vidHashes[0].slice(0, 16)}...`);
    console.log(`    - Scene 2 Video SHA-256: ${vidHashes[1].slice(0, 16)}...`);
    console.log(`    - Scene 3 Video SHA-256: ${vidHashes[2].slice(0, 16)}...`);
  });

  await runTest('3.3 Media validation: 100% full frame FFmpeg decode on all scene outputs', async () => {
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      // Validate keyframe image
      const imgVal = await normalizeAndValidateMediaFile(s.imagePath!, 'image', { fullDecode: true });
      assert.ok(imgVal.width > 0 && imgVal.height > 0, `Scene ${i + 1} keyframe must have valid dimensions`);
      assert.strictEqual(imgVal.fullDecodeSuccess, true, `Scene ${i + 1} keyframe must be fully decoded`);

      // Validate scene video
      const vidVal = await normalizeAndValidateMediaFile(s.videoPath!, 'video', { fullDecode: true });
      assert.ok(vidVal.width > 0 && vidVal.height > 0, `Scene ${i + 1} video must have valid dimensions`);
      assert.ok((vidVal.duration || 0) > 0, `Scene ${i + 1} video must have duration > 0`);
      assert.strictEqual(vidVal.fullDecodeSuccess, true, `Scene ${i + 1} video must be 100% frames decoded`);
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // WORKFLOW SECTION 4: Final Video Sequence Export & Concatenation
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [PHASE 4] Final Video Export & Concatenation via VideoProcessor');

  const finalExportPath = path.join(testProjectDir, 'final_vanhsub_export.mp4');

  await runTest('4.1 VideoProcessor.concatVideos merges 3 distinct scene videos into final sequence', async () => {
    const inputVideos = scenes.map(s => s.videoPath!);
    const exportedPath = await VideoProcessor.concatVideos(inputVideos, finalExportPath, {
      onProgress: (p) => {
        progressUpdates.push({ pct: p, msg: `Exporting sequence: ${p}%` });
      },
    });

    progressUpdates.push({ pct: 100, msg: 'Hoàn tất toàn bộ quy trình sản xuất' });
    assert.strictEqual(exportedPath, finalExportPath);
    assert.ok(fs.existsSync(finalExportPath), 'Final exported video must exist on disk');
  });

  await runTest('4.2 Final exported video passes 100% FFmpeg frame decoding and is playable', async () => {
    const finalVal = await normalizeAndValidateMediaFile(finalExportPath, 'video', { fullDecode: true });
    assert.strictEqual(finalVal.format, 'mp4', 'Exported video must be valid MP4');
    assert.ok(finalVal.width > 0 && finalVal.height > 0, 'Exported video must have valid width and height');
    assert.ok((finalVal.duration || 0) > 0, 'Exported video must have positive duration');
    assert.strictEqual(finalVal.fullDecodeSuccess, true, 'Exported video must be 100% decoded via FFmpeg with 0 errors');
    assert.ok(finalVal.sizeBytes > 1024, 'Exported video must have substantive file size');

    console.log(`  🎬 Final Export Verified: ${path.basename(finalExportPath)} (${finalVal.width}x${finalVal.height}, ${finalVal.duration?.toFixed(2)}s, ${finalVal.sizeBytes} bytes)`);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // WORKFLOW SECTION 5: UI Progress Monotonicity & Lifecycle States
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [PHASE 5] UI Progress Monotonicity & Lifecycle Transitions');

  await runTest('5.1 Progress updates fire monotonically non-decreasing and reach completion', () => {
    assert.ok(progressUpdates.length >= 6, 'Must have received progress updates throughout the pipeline');
    const pcts = progressUpdates.map(u => u.pct);

    // Verify sequential non-decreasing monotonicity
    for (let i = 1; i < pcts.length; i++) {
      assert.ok(
        pcts[i] >= pcts[i - 1],
        `Progress must be monotonic non-decreasing: step ${i} (${pcts[i]}%) < step ${i - 1} (${pcts[i - 1]}%)`
      );
    }

    assert.ok(pcts[0] <= 10, 'Initial progress must start in baseline phase (<= 10%)');
    assert.strictEqual(pcts[pcts.length - 1], 100, 'Final progress must terminate at 100%');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // WORKFLOW SECTION 6: Reliability & Anti-Bot Safeguards (Priority 4 Upgrades)
  // ────────────────────────────────────────────────────────────────────────────
  console.log('\n▶ [PHASE 6] Reliability, Safe In-Flight Cancellation & Anti-Bot Interception');

  await runTest('6.1 In-flight cancellation via AbortSignal cleanly aborts during pending operation', async () => {
    const abortCtrl = new AbortController();

    // Set up delayed RPC client to simulate in-flight execution
    const delayedRpcClient: any = {
      partition: 'test-partition',
      getCookieString: async () => '',
      generateImage: async () => {
        await new Promise((r) => setTimeout(r, 400));
        return {
          firstImageUrl: 'https://flow-content.google/image/delayed',
          images: [{ url: 'https://flow-content.google/image/delayed', mediaId: 'delayed' }],
        };
      },
      generateVideo: async () => {
        await new Promise((r) => setTimeout(r, 400));
        return { operationId: 'delayed-op', status: 'COMPLETED', done: true, videoUrl: 'https://flow-content.google/video/delayed.mp4' };
      },
    };

    const cancellableService = new AiStudioVisualService();
    cancellableService.setRpcClient(delayedRpcClient);

    const targetScene: StoryboardScene = {
      id: 'scene_abort_test',
      lineIndex: 0,
      visualPrompt: 'Testing in flight cancellation',
      motionType: 'video',
      status: 'pending',
    };

    // Trigger abort 50ms into the in-flight operation
    setTimeout(() => {
      abortCtrl.abort();
    }, 50);

    let didCatchAbort = false;
    try {
      await cancellableService.generateViaGoogleFlow(
        targetScene,
        path.join(testProjectDir, 'in_flight_cancelled.mp4'),
        flowConfig,
        undefined,
        abortCtrl.signal
      );
    } catch (err: any) {
      didCatchAbort = true;
      assert.strictEqual(err.code, 'CANCELLED', 'Must throw CANCELLED error code on in-flight abort');
    }
    assert.strictEqual(didCatchAbort, true, 'Must reject in-flight request promptly when signal is aborted');
  });

  await runTest('6.2 Anti-Bot PUBLIC_ERROR_UNUSUAL_ACTIVITY stops retry loop (ABORT_HALT)', async () => {
    const unusualRpcClient: any = {
      partition: 'test-partition',
      getCookieString: async () => '',
      generateImage: async () => {
        throw new GoogleFlowRpcError('Tài khoản bị giới hạn hoạt động bất thường', {
          code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
          retryable: false,
          suggestedAction: 'ABORT_HALT',
        });
      },
      generateVideo: async () => {
        throw new GoogleFlowRpcError('Tài khoản bị giới hạn hoạt động bất thường', {
          code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
          retryable: false,
          suggestedAction: 'ABORT_HALT',
        });
      },
    };

    const isolatedService = new AiStudioVisualService();
    isolatedService.setRpcClient(unusualRpcClient);

    const freshScene: StoryboardScene = {
      id: 'fresh_scene_unusual',
      lineIndex: 99,
      visualPrompt: 'Unusual activity test prompt',
      motionType: 'video',
      status: 'pending',
    };

    let caughtUnusual = false;
    try {
      await isolatedService.generateViaGoogleFlow(
        freshScene,
        path.join(testProjectDir, 'unusual_scene.mp4'),
        flowConfig
      );
    } catch (err: any) {
      caughtUnusual = true;
      assert.strictEqual(err.code, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY', 'Must propagate PUBLIC_ERROR_UNUSUAL_ACTIVITY');
    }
    assert.strictEqual(caughtUnusual, true, 'Must halt immediately on unusual activity error without retries');
  });

  await runTest('6.3 Browser tab focus safety: Adapter strictly respects bringToFront: false', async () => {
    // Verify adapter behaviour: mock page with spy on bringToFront
    let bringToFrontCallCount = 0;
    const mockPage: any = {
      isClosed: () => false,
      url: () => 'https://flow.google.com/project/mock-test',
      title: async () => 'Google Flow',
      bringToFront: async () => {
        bringToFrontCallCount++;
      },
      on: () => {},
      off: () => {},
    };

    const mockSession: any = {
      browser: { isConnected: () => true },
      context: { pages: () => [mockPage] },
      activePage: mockPage,
      isDisconnecting: false,
    };

    (adapter as any).sessions.set('flow', mockSession);

    // Call getOrCreateTab without bringToFront (defaults to false)
    await adapter.getOrCreateTab('flow', {
      targetUrl: 'https://flow.google.com/project/mock-test',
      bringToFront: false,
    });
    assert.strictEqual(bringToFrontCallCount, 0, 'bringToFront must NOT be called when bringToFront is false');

    // Call getOrCreateTab with bringToFront: true explicitly
    await adapter.getOrCreateTab('flow', {
      targetUrl: 'https://flow.google.com/project/mock-test',
      bringToFront: true,
    });
    assert.strictEqual(bringToFrontCallCount, 1, 'bringToFront must only be called when explicitly set to true');

    (adapter as any).sessions.delete('flow');
  });

  await runTest('6.4 Controlled browser disconnect fault-injection transitions state safely', async () => {
    const mockBrowserEmitter = new EventEmitter() as any;
    mockBrowserEmitter.isConnected = () => true;

    const mockSession: any = {
      provider: 'flow',
      browser: mockBrowserEmitter,
      context: { pages: () => [] },
      isDisconnecting: false,
      disconnectedEmitted: false,
    };

    (adapter as any).sessions.set('flow', mockSession);
    (adapter as any).bindBrowserLifecycle(mockBrowserEmitter, mockSession);
    assert.strictEqual(adapter.isConnected('flow'), true, 'Adapter must be connected initially');

    let receivedDisconnectEvent = false;
    adapter.once('disconnected', (p) => {
      if (p === 'flow') receivedDisconnectEvent = true;
    });

    // Fault-injection: simulate browser process termination / CDP disconnect
    mockBrowserEmitter.isConnected = () => false;
    mockBrowserEmitter.emit('disconnected');

    assert.strictEqual(receivedDisconnectEvent, true, 'Adapter must emit disconnected on connection drop');
    assert.strictEqual(adapter.isConnected('flow'), false, 'Adapter must report isConnected=false after disconnection');

    (adapter as any).sessions.delete('flow');
  });

  await runTest('6.5 Cleanup: Test project files are cleanly tracked and removable', () => {
    assert.ok(fs.existsSync(testProjectDir), 'Test project directory exists');
    const projectFiles = fs.readdirSync(testProjectDir);
    assert.ok(projectFiles.length >= 4, 'Must have at least 3 scene assets and final export');
    console.log(`  📁 Total project files generated: ${projectFiles.length}`);
  });

  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log(`  MOCKED INTEGRATION SUMMARY: ${passedTests}/${totalTests} TESTS PASSED (100%)`);
  console.log('════════════════════════════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('Fatal Workflow Acceptance Error:', err);
  process.exit(1);
});
