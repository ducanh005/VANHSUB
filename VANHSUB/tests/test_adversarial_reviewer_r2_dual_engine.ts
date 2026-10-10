import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  GoogleFlowRpcClient,
  GoogleFlowRpcError,
  classifyFlowRpcError,
  calculateExponentialBackoffMs,
  isUnusualActivityError,
} from '../main/workflow/flow-engine/rpc/GoogleFlowRpcClient';
import { FlowBridgeServer } from '../main/workflow/flow-engine/rpc/FlowBridgeServer';
import { AiStudioVisualService } from '../main/ai-studio/services/AiStudioVisualService';
import { FlowErrorClassifier } from '../main/workflow/flow-engine/FlowErrorClassifier';
import {
  extractGeneratedImages,
  extractOperationStatus,
  parseBatchResponse,
} from '../main/workflow/flow-engine/rpc/FlowBatchBuilder';
import {
  RPC_GEN_IMAGE,
  RPC_GEN_VIDEO_REFERENCES,
} from '../main/workflow/flow-engine/rpc/FlowBatchConstants';
import type { StoryboardScene } from '../main/ai-studio/types';

async function runAdversarialReviewerRound2Tests() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   ADVERSARIAL REVIEWER TEST SUITE: ROUND 2                               ║');
  console.log('║   DEEP VERIFICATION OF DUAL-ENGINE FALLBACK & EDGE CASES                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_adv_r2_'));
  const dummyPng = path.join(tmpDir, 'test_keyframe.png');
  const dummyMp4 = path.join(tmpDir, 'test_video.mp4');
  fs.writeFileSync(dummyPng, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  fs.writeFileSync(dummyMp4, Buffer.from('fake mp4 video content header for testing'));

  try {
    // ════════════════════════════════════════════════════════════════════════
    // TEST 1: extractGeneratedImages handles raw string batch responses
    // ════════════════════════════════════════════════════════════════════════
    console.log('--- TEST 1: extractGeneratedImages String Batch Response Parsing ---');
    {
      const rawStringBatch = `)]}'\n\n[[["wrb.fr","ogiZ0b","[[\\"mock-img-uuid-999\\",\\"https://lh3.googleusercontent.com/test-photo-asset\\"]]",null,null,null,null,1]]]`;
      const extracted = extractGeneratedImages(rawStringBatch);
      assert.strictEqual(extracted.length, 1, 'extractGeneratedImages phải bóc tách thành công 1 ảnh từ chuỗi response');
      assert.strictEqual(extracted[0].mediaId, 'mock-img-uuid-999');
      assert.strictEqual(extracted[0].url, 'https://lh3.googleusercontent.com/test-photo-asset');

      // Test with 3-level wrapped array
      const rawWrapped = `)]}'\n\n[[[["wrb.fr","ogiZ0b","[[\\"mock-uuid-wrap\\",\\"https://flow-content.google/asset-123\\"]]"]]]]`;
      const extractedWrap = extractGeneratedImages(rawWrapped);
      assert.strictEqual(extractedWrap.length, 1);
      assert.strictEqual(extractedWrap[0].mediaId, 'mock-uuid-wrap');
      console.log('  [PASS] extractGeneratedImages hỗ trợ bóc tách trực tiếp chuỗi batchexecute response');
    }

    // ════════════════════════════════════════════════════════════════════════
    // TEST 2: Standalone Image Dual-Engine Fallback (Pure RPC -> triggerUiGen)
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- TEST 2: Standalone Image Dual-Engine Fallback ---');
    {
      const bridge = FlowBridgeServer.getInstance();
      const origIsConnected = bridge.isConnected.bind(bridge);
      const origTriggerUiGen = bridge.triggerUiGen.bind(bridge);

      let triggeredMode = '';
      let triggeredPrompt = '';
      let triggeredPid = '';

      (bridge as any).isConnected = () => true;
      (bridge as any).triggerUiGen = async (
        prompt: string,
        _timeout: number,
        pid?: string,
        mode?: 'image' | 'video'
      ) => {
        triggeredMode = mode || '';
        triggeredPrompt = prompt;
        triggeredPid = pid || '';
        return {
          ok: true,
          capturedRpc: {
            url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b',
            status: 200,
            response: `)]}'\n\n[[["wrb.fr","ogiZ0b","[[\\"img-fallback-uuid-42\\",\\"https://lh3.googleusercontent.com/fallback-image-hero\\"]]",null,null,null,null,1]]]`,
          },
        };
      };

      let rpcImageCalls = 0;
      class MockBotBlockedImageRpcClient extends GoogleFlowRpcClient {
        public override async generateImage(): Promise<any> {
          rpcImageCalls++;
          throw new GoogleFlowRpcError('PUBLIC_ERROR_UNUSUAL_ACTIVITY: Bot activity detected by Google Flow', {
            code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
            retryable: true,
            suggestedAction: 'RETRY_WITH_BACKOFF',
          });
        }
      }

      const visualService = new AiStudioVisualService();
      visualService.setRpcClient(new MockBotBlockedImageRpcClient());

      // Mock download
      (visualService as any).downloadMediaAsset = async (_url: string, out: string) => {
        fs.writeFileSync(out, fs.readFileSync(dummyPng));
      };
      (visualService as any).validateMediaFile = () => {};

      const scene: StoryboardScene = {
        id: 'scene-image-fallback-test',
        lineIndex: 0,
        startMs: 0,
        endMs: 3000,
        durationMs: 3000,
        lineText: 'A beautiful lotus garden in the morning light',
        visualPrompt: 'A beautiful lotus garden',
        motionType: 'ken_burns',
        status: 'pending',
      };

      const outPath = path.join(tmpDir, 'scene_image_fallback.png');
      const finalPath = await visualService.generateViaGoogleFlow(
        scene,
        outPath,
        {
          projectId: 'proj-image-fallback-xyz',
          outputMode: 'image',
          backoffBaseMs: 0,
        }
      );

      assert.strictEqual(rpcImageCalls, 1, 'Pure RPC generateImage phải được gọi trước');
      assert.strictEqual(triggeredMode, 'image', 'Phải chỉ định rõ mode "image" xuống triggerUiGen');
      assert.strictEqual(triggeredPid, 'proj-image-fallback-xyz', 'Phải truyền đúng projectId vào triggerUiGen');
      assert.strictEqual(finalPath, outPath, 'Đầu ra phải là ảnh PNG hoàn tất');
      assert.strictEqual(scene.status, 'ready');
      assert.strictEqual(scene.imagePath, outPath);

      // Restore
      (bridge as any).isConnected = origIsConnected;
      (bridge as any).triggerUiGen = origTriggerUiGen;
      visualService.setRpcClient(null);
      console.log('  [PASS] Standalone Image Dual-Engine Fallback: Pure RPC -> CDP Trusted UI Gen -> Cứu cảnh thành công 100%');
    }

    // ════════════════════════════════════════════════════════════════════════
    // TEST 3: Two-Step I2V: Keyframe AND Video Both Fallback to UI Gen
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- TEST 3: Two-Step I2V: Keyframe + Video Cascading Dual Fallback ---');
    {
      const bridge = FlowBridgeServer.getInstance();
      const origIsConnected = bridge.isConnected.bind(bridge);
      const origTriggerUiGen = bridge.triggerUiGen.bind(bridge);

      const capturedModes: string[] = [];

      (bridge as any).isConnected = () => true;
      (bridge as any).triggerUiGen = async (
        _prompt: string,
        _timeout: number,
        pid?: string,
        mode?: 'image' | 'video'
      ) => {
        capturedModes.push(mode || '');
        if (mode === 'image') {
          return {
            ok: true,
            capturedRpc: {
              url: 'https://flow.google.com/batchexecute?rpcids=ogiZ0b',
              status: 200,
              response: `)]}'\n\n[[["wrb.fr","ogiZ0b","[[\\"keyframe-uuid-888\\",\\"https://lh3.googleusercontent.com/keyframe-888\\"]]",null,null,null,null,1]]]`,
            },
          };
        } else {
          return {
            ok: true,
            capturedRpc: {
              url: 'https://flow.google.com/batchexecute?rpcids=MZZa6b',
              status: 200,
              response: `)]}'\n\n[[["wrb.fr","MZZa6b","[[\\"${pid}\\",\\"${pid}\\"],[null,null,\\"operations/cascading-video-op-777\\"]]",null,null,null,null,1]]]`,
            },
          };
        }
      };

      let rpcImageCalls = 0;
      let rpcVideoCalls = 0;
      let pollCalls = 0;

      class MockBothBlockedRpcClient extends GoogleFlowRpcClient {
        public override async generateImage(): Promise<any> {
          rpcImageCalls++;
          throw new GoogleFlowRpcError('PUBLIC_ERROR_UNUSUAL_ACTIVITY', {
            code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
            retryable: true,
          });
        }

        public override async generateVideo(): Promise<any> {
          rpcVideoCalls++;
          throw new GoogleFlowRpcError('PUBLIC_ERROR_UNUSUAL_ACTIVITY', {
            code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
            retryable: true,
          });
        }

        public override async pollGeneration(params: any): Promise<any> {
          pollCalls++;
          assert.strictEqual(params.operationId, 'operations/cascading-video-op-777');
          return {
            done: true,
            videoUrl: dummyMp4,
            status: 'COMPLETED',
          };
        }
      }

      const visualService = new AiStudioVisualService();
      visualService.setRpcClient(new MockBothBlockedRpcClient());

      (visualService as any).downloadMediaAsset = async (_url: string, out: string) => {
        if (out.endsWith('.png')) {
          fs.writeFileSync(out, fs.readFileSync(dummyPng));
        } else {
          fs.writeFileSync(out, fs.readFileSync(dummyMp4));
        }
      };
      (visualService as any).validateMediaFile = () => {};

      const scene: StoryboardScene = {
        id: 'scene-cascading-fallback',
        lineIndex: 0,
        startMs: 0,
        endMs: 4000,
        durationMs: 4000,
        lineText: 'An astronaut walking on Mars red sand',
        visualPrompt: 'An astronaut on Mars',
        motionType: 'video',
        status: 'pending',
      };

      const outVideoPath = path.join(tmpDir, 'scene_cascading.mp4');
      const finalPath = await visualService.generateViaGoogleFlow(
        scene,
        outVideoPath,
        {
          projectId: 'proj-cascading-999',
          outputMode: 'video',
          backoffBaseMs: 0,
        }
      );

      assert.strictEqual(rpcImageCalls, 1, 'Bước 1 Imagen Pure RPC phải được thử trước');
      assert.strictEqual(rpcVideoCalls, 1, 'Bước 2 Veo Pure RPC phải được thử trước');
      assert.deepStrictEqual(capturedModes, ['image', 'video'], 'Phải fallback UI theo thứ tự: Bước 1 image, Bước 2 video');
      assert.strictEqual(pollCalls, 1, 'Bước 2 phải poll operationId từ video UI fallback');
      assert.strictEqual(finalPath, outVideoPath);
      assert.strictEqual(scene.status, 'ready');
      assert.strictEqual(scene.videoPath, outVideoPath);

      // Restore
      (bridge as any).isConnected = origIsConnected;
      (bridge as any).triggerUiGen = origTriggerUiGen;
      visualService.setRpcClient(null);
      console.log('  [PASS] Two-Step I2V Cascading Fallback: Cả keyframe lẫn video đều fallback mượt mà qua CDP Trusted Click');
    }

    // ════════════════════════════════════════════════════════════════════════
    // TEST 4: Immediate Abort Cancellation on triggerUiGen & recoverUnusualActivity
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- TEST 4: Immediate Abort Cancellation during Bridge Calls ---');
    {
      const bridge = FlowBridgeServer.getInstance();
      const origIsConnected = bridge.isConnected.bind(bridge);
      const origGetFirstActiveClient = (bridge as any).getFirstActiveClient.bind(bridge);

      const mockWsClient = {
        send: () => {},
      };

      (bridge as any).isConnected = () => true;
      (bridge as any).getFirstActiveClient = () => mockWsClient;

      // 4a. triggerUiGen với signal đã aborted trước
      const preAborted = new AbortController();
      preAborted.abort();
      const preRes = await bridge.triggerUiGen('test prompt', 10000, 'proj-1', 'image', preAborted.signal);
      assert.ok(preRes.error === 'CANCELLED' || preRes.error === 'ABORTED', 'triggerUiGen phải trả lời CANCELLED hoặc ABORTED lập tức khi signal đã abort');

      // 4b. triggerUiGen bị abort giữa chừng
      const midAbort = new AbortController();
      const triggerPromise = bridge.triggerUiGen('test prompt mid', 10000, 'proj-1', 'video', midAbort.signal);
      // Abort sau 50ms
      setTimeout(() => midAbort.abort(), 50);
      const midRes = await triggerPromise;
      assert.ok(midRes.error === 'CANCELLED' || midRes.error === 'ABORTED', 'triggerUiGen phải ngắt lập tức khi signal abort giữa chừng');

      // 4c. recoverUnusualActivity với signal abort
      const recAbort = new AbortController();
      recAbort.abort();
      const recRes = await bridge.recoverUnusualActivity(10000, 'proj-1', recAbort.signal);
      assert.strictEqual(recRes.ok, false);
      assert.strictEqual(recRes.message, 'CANCELLED');

      // Restore
      (bridge as any).isConnected = origIsConnected;
      (bridge as any).getFirstActiveClient = origGetFirstActiveClient;
      console.log('  [PASS] FlowBridgeServer giải phóng lập tức timer & pendingRequests khi nhận signal.abort');
    }

    // ════════════════════════════════════════════════════════════════════════
    // TEST 5: FlowErrorClassifier Standardized Classification
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- TEST 5: FlowErrorClassifier Classification for Bot Flags ---');
    {
      const c1 = FlowErrorClassifier.classify(new Error('PUBLIC_ERROR_UNUSUAL_ACTIVITY'));
      assert.strictEqual(c1.code, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY');
      assert.strictEqual(c1.category, 'NON_RETRYABLE');
      assert.strictEqual(c1.canRetry, false);
      assert.strictEqual(c1.suggestedAction, 'ABORT_HALT');

      const c2 = FlowErrorClassifier.classify(new Error('bot_flagged by google'));
      assert.strictEqual(c2.code, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY');
      assert.strictEqual(c2.category, 'NON_RETRYABLE');
      assert.strictEqual(c2.canRetry, false);

      console.log('  [PASS] FlowErrorClassifier chuẩn hoá chính xác PUBLIC_ERROR_UNUSUAL_ACTIVITY sang NON_RETRYABLE (ABORT_HALT)');
    }

    // ════════════════════════════════════════════════════════════════════════
    // TEST 6: background.js Mode-Aware Sniffer & Mode Switch Verification
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- TEST 6: background.js Code Integrity for Mode-Aware Trigger ---');
    {
      const bgSource = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf-8');
      assert.ok(
        bgSource.includes('reqMode === \'IMAGE\''),
        'background.js phải có kiểm tra chuyển chế độ cho IMAGE'
      );
      assert.ok(
        bgSource.includes('reqMode === \'VIDEO\''),
        'background.js phải có kiểm tra chuyển chế độ cho VIDEO'
      );
      assert.ok(
        bgSource.includes('mode === \'IMAGE\''),
        'background.js sniffer phải ưu tiên ogiZ0b khi mode là IMAGE'
      );
      assert.ok(
        bgSource.includes('h.url.includes(\'as29s\') || h.url.includes(\'MZZa6b\')'),
        'background.js sniffer phải ưu tiên as29s/MZZa6b khi mode là VIDEO'
      );
      console.log('  [PASS] background.js hỗ trợ mode switching và sniffer lọc mode chuẩn xác');
    }

    console.log('\n========================================================================');
    console.log('  TẤT CẢ 6 BÀI KIỂM THỬ ADVERSARIAL REVIEWER ROUND 2 ĐÃ PASS 100%!       ');
    console.log('========================================================================\n');
    console.log('RESULTS: Passed: 6 | Failed: 0');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

runAdversarialReviewerRound2Tests().catch((err) => {
  console.error('\n❌ ADVERSARIAL ROUND 2 TEST FAILED:', err);
  process.exit(1);
});
