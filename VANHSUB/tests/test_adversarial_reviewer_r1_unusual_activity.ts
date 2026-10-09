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
import { AiStudioPipelineEngine } from '../main/ai-studio/AiStudioPipelineEngine';
import type { StoryboardScene } from '../main/ai-studio/types';

async function runAdversarialReviewerTests() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   ADVERSARIAL REVIEWER TEST SUITE: ROUND 1                               ║');
  console.log('║   PUBLIC_ERROR_UNUSUAL_ACTIVITY & DUAL-ENGINE FALLBACK VERIFICATION     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_adv_r1_'));
  const dummyPng = path.join(tmpDir, 'test_keyframe.png');
  const dummyMp4 = path.join(tmpDir, 'test_video.mp4');
  fs.writeFileSync(dummyPng, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  fs.writeFileSync(dummyMp4, Buffer.from('fake mp4 video content header for testing'));

  try {
    // ════════════════════════════════════════════════════════════════════════
    // TEST 1: Video Dual-Engine Fallback (Pure RPC -> CDP Trusted UI Gen)
    // ════════════════════════════════════════════════════════════════════════
    console.log('--- TEST 1: Dual-Engine Fallback for Video (as29s / MZZa6b) ---');
    {
      const bridge = FlowBridgeServer.getInstance();
      const origIsConnected = bridge.isConnected.bind(bridge);
      const origTriggerUiGen = bridge.triggerUiGen.bind(bridge);

      let bridgeTriggered = false;
      let triggeredPrompt = '';
      let triggeredProjectId = '';

      (bridge as any).isConnected = () => true;
      (bridge as any).triggerUiGen = async (prompt: string, timeoutMs: number, projectId?: string) => {
        bridgeTriggered = true;
        triggeredPrompt = prompt;
        triggeredProjectId = projectId || '';
        // Mock returning a captured batchexecute RPC response containing a video operation
        return {
          ok: true,
          capturedRpc: {
            url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=MZZa6b',
            status: 200,
            response: `)]}'\n\n[[["wrb.fr","MZZa6b","[[\\"${projectId || 'test-proj'}\\",\\"${projectId || 'test-proj'}\\"],[null,null,\\"operations/video-fallback-op-123\\"]]",null,null,null,null,1]]]`,
          },
        };
      };

      let rpcGenVideoCalls = 0;
      let pollCalls = 0;

      class MockBotBlockedRpcClient extends GoogleFlowRpcClient {
        public override async generateImage(): Promise<any> {
          return {
            images: [{ assetId: 'img-uuid-1', mediaId: 'img-uuid-1', url: dummyPng }],
            firstImageUrl: dummyPng,
            projectId: 'test-proj-fallback',
          };
        }

        public override async generateVideo(): Promise<any> {
          rpcGenVideoCalls++;
          throw new GoogleFlowRpcError('Server detected bot activity on request: PUBLIC_ERROR_UNUSUAL_ACTIVITY', {
            code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
            retryable: true,
            suggestedAction: 'RETRY_WITH_BACKOFF',
          });
        }

        public override async pollGeneration(params: any): Promise<any> {
          pollCalls++;
          assert.strictEqual(params.operationId, 'operations/video-fallback-op-123');
          return {
            done: true,
            videoUrl: dummyMp4,
            status: 'COMPLETED',
          };
        }
      }

      const visualService = new AiStudioVisualService();
      visualService.setRpcClient(new MockBotBlockedRpcClient());

      // Spy on downloadMediaAsset and validateMediaFile to return the dummyMp4
      (visualService as any).downloadMediaAsset = async (url: string, out: string) => {
        fs.writeFileSync(out, fs.readFileSync(dummyMp4));
      };
      (visualService as any).validateMediaFile = () => {};

      const scene: StoryboardScene = {
        id: 'scene-video-fallback',
        lineIndex: 0,
        startMs: 0,
        endMs: 4000,
        durationMs: 4000,
        lineText: 'A drone shot over crashing ocean waves',
        visualPrompt: 'Cinematic waves at sunset',
        motionType: 'video',
        status: 'pending',
      };

      const outVideoPath = path.join(tmpDir, 'scene_output.mp4');
      const finalPath = await visualService.generateViaGoogleFlow(
        scene,
        outVideoPath,
        {
          projectId: 'test-proj-fallback',
          outputMode: 'video',
          backoffBaseMs: 0,
        }
      );

      assert.strictEqual(rpcGenVideoCalls, 1, 'Pure RPC generateVideo phải được gọi trước');
      assert.strictEqual(bridgeTriggered, true, 'Dual-Engine: Phải fallback sang bridge.triggerUiGen khi Pure RPC bị bot flag');
      assert.strictEqual(triggeredProjectId, 'test-proj-fallback', 'Phải truyền đúng projectId vào triggerUiGen');
      assert.strictEqual(pollCalls, 1, 'Phải thực hiện poll generation theo operationId thu thập từ triggerUiGen');
      assert.strictEqual(finalPath, outVideoPath, 'Đường dẫn đầu ra phải là file video MP4 hoàn tất');
      assert.strictEqual(scene.status, 'ready');
      assert.strictEqual(scene.videoPath, outVideoPath);

      // Restore
      (bridge as any).isConnected = origIsConnected;
      (bridge as any).triggerUiGen = origTriggerUiGen;
      visualService.setRpcClient(null);
      console.log('  [PASS] Video Dual-Engine Fallback: Pure RPC -> CDP Trusted UI Gen -> Operation Polling thành công 100%');
    }

    // ════════════════════════════════════════════════════════════════════════
    // TEST 2: Extension background.js sniffer captures as29s RPC
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- TEST 2: Extension sniffer coverage for as29s RPC ---');
    {
      const bgSource = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf-8');
      assert.ok(
        bgSource.includes("h.url.includes('as29s')"),
        'extension/background.js phải giám sát và bắt được RPC URL chứa as29s'
      );
      assert.ok(
        bgSource.includes('getFlowTab(false, params?.projectId)'),
        'recover_unusual_activity trong background.js phải tôn trọng params?.projectId'
      );
      console.log('  [PASS] background.js sniffer hỗ trợ as29s và định tuyến projectId chính xác');
    }

    // ════════════════════════════════════════════════════════════════════════
    // TEST 3: handleUnusualActivityRecovery returns immediately on bridge
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- TEST 3: GoogleFlowRpcClient.handleUnusualActivityRecovery isolation ---');
    {
      const bridge = FlowBridgeServer.getInstance();
      const origIsConnected = bridge.isConnected.bind(bridge);
      const origRecover = bridge.recoverUnusualActivity.bind(bridge);

      let bridgeRecoverCalls = 0;
      let bridgeRecoverProjectId = '';

      (bridge as any).isConnected = () => true;
      (bridge as any).recoverUnusualActivity = async (_timeout: number, pid?: string) => {
        bridgeRecoverCalls++;
        bridgeRecoverProjectId = pid || '';
        return { ok: true };
      };

      const client = new GoogleFlowRpcClient();
      const startTime = Date.now();
      const mockWin = { id: 999 };
      const retWin = await client.handleUnusualActivityRecovery(mockWin, 'proj-adv-recovery');
      const elapsed = Date.now() - startTime;

      assert.strictEqual(retWin, mockWin, 'Phải bảo toàn activeWin');
      assert.strictEqual(bridgeRecoverCalls, 1, 'Phải gọi bridge.recoverUnusualActivity đúng 1 lần');
      assert.strictEqual(bridgeRecoverProjectId, 'proj-adv-recovery', 'Phải chuyển giao projectId xuống bridge');
      assert.ok(elapsed < 1000, `Khi bridge kết nối, recovery phải hoàn tất tức thì (<1s), thực tế: ${elapsed}ms (không mở Electron lobby hay chờ 2.5s)`);

      // Restore
      (bridge as any).isConnected = origIsConnected;
      (bridge as any).recoverUnusualActivity = origRecover;
      console.log('  [PASS] handleUnusualActivityRecovery tối ưu hoá khi bridge kết nối: không làm rò rỉ Electron window hay chờ vô ích');
    }

    // ════════════════════════════════════════════════════════════════════════
    // TEST 4: FlowBridgeServer.recoverUnusualActivity contract
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- TEST 4: FlowBridgeServer.recoverUnusualActivity contract ---');
    {
      const bridge = FlowBridgeServer.getInstance();
      const origIsConnected = bridge.isConnected.bind(bridge);
      (bridge as any).isConnected = () => false;

      const notConnRes = await bridge.recoverUnusualActivity(1000, 'proj-test');
      assert.strictEqual(notConnRes.ok, false);
      assert.strictEqual(notConnRes.message, 'EXTENSION_NOT_CONNECTED');

      (bridge as any).isConnected = origIsConnected;
      console.log('  [PASS] FlowBridgeServer.recoverUnusualActivity xử lý an toàn khi extension ngắt kết nối');
    }

    // ════════════════════════════════════════════════════════════════════════
    // TEST 5: Pipeline Engine regenerateSceneAsset project continuity
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- TEST 5: AiStudioPipelineEngine regenerateSceneAsset project continuity ---');
    {
      const engine = new AiStudioPipelineEngine();
      (engine as any).getState = async () => ({
        sessionId: 'session-adv-continuity',
        flowProjectUrl: undefined, // Phiên chưa có flowProjectUrl trực tiếp
      });

      let genCalled = false;
      (engine as any).getDiskStorageManager = () => ({
        resolvePath: (p: string) => p,
      });

      // Kiểm tra xem nó có ném lỗi thiếu project hay không khi có flowConfig.projectId
      let threwProjectRequired = false;
      try {
        await engine.regenerateSceneAsset({
          sessionId: 'session-adv-continuity',
          sceneId: 'scene_01',
          flowConfig: {
            projectId: 'proj-valid-from-config-1234',
          },
        });
      } catch (err: any) {
        if (err.message.includes('Phiên chưa có project Flow riêng')) {
          threwProjectRequired = true;
        }
      }

      assert.strictEqual(
        threwProjectRequired,
        false,
        'regenerateSceneAsset không được ném "Phiên chưa có project Flow riêng" khi payload.flowConfig có projectId hợp lệ'
      );
      console.log('  [PASS] regenerateSceneAsset duy trì project continuity từ payload.flowConfig');
    }

    // ════════════════════════════════════════════════════════════════════════
    // TEST 6: Resilient backoff & bot-flag error classification consistency
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- TEST 6: Resilient backoff & bot-flag classification ---');
    {
      for (const rawCode of [
        'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
        'UNUSUAL_ACTIVITY',
        'BOT_FLAGGED',
        'CAPTCHA_SCORE_LOW',
        'Server rejected request: public_error_unusual_activity in batchexecute response',
      ]) {
        const classified = classifyFlowRpcError(new Error(rawCode));
        assert.strictEqual(classified.retryable, false, `${rawCode} phải có retryable = false`);
        assert.strictEqual(classified.suggestedAction, 'ABORT_HALT', `${rawCode} phải đề xuất ABORT_HALT`);
        assert.strictEqual(classified.isUnusualActivity, true, `${rawCode} phải có isUnusualActivity = true`);
      }
      console.log('  [PASS] 100% các biến thể bot-flag được phân loại thành công sang ABORT_HALT với retryable: false');
    }

    console.log('\n========================================================================');
    console.log('  TẤT CẢ 6 BÀI KIỂM THỬ ADVERSARIAL REVIEWER ROUND 1 ĐÃ PASS 100%!       ');
    console.log('========================================================================\n');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

runAdversarialReviewerTests().catch((err) => {
  console.error('\n❌ ADVERSARIAL TEST FAILED:', err);
  process.exit(1);
});
