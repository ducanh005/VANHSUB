import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AiStudioVisualService } from '../main/ai-studio/services/AiStudioVisualService';
import { GoogleFlowRpcClient, GoogleFlowRpcError } from '../main/workflow/flow-engine/rpc/GoogleFlowRpcClient';
import { FlowBridgeServer } from '../main/workflow/flow-engine/rpc/FlowBridgeServer';
import type { StoryboardScene } from '../main/ai-studio/types';

async function runDirectUiAdaptiveTests() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   TEST SUITE: DIRECT UI ADAPTIVE MODE & DYNAMIC TIMEOUT                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_direct_ui_test_'));
  const dummyPng = path.join(tmpDir, 'dummy.png');
  fs.writeFileSync(dummyPng, Buffer.from('FAKE_PNG_BINARY_CONTENT'));

  try {
    // ════════════════════════════════════════════════════════════════════════
    // TEST 1: Subsequent scene skips Pure RPC once UNUSUAL_ACTIVITY flagged
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- TEST 1: Subsequent scene skips Pure RPC when _preferUiImageGen is active ---');
    {
      const bridge = FlowBridgeServer.getInstance();
      const origIsConnected = bridge.isConnected.bind(bridge);
      const origTriggerUiGen = bridge.triggerUiGen.bind(bridge);

      let uiTriggerCalls = 0;
      let lastTimeoutMs = 0;
      (bridge as any).isConnected = () => true;
      (bridge as any).triggerUiGen = async (prompt: string, timeoutMs: number, pid: string, mode: string) => {
        uiTriggerCalls++;
        lastTimeoutMs = timeoutMs;
        return {
          ok: true,
          capturedRpc: {
            url: 'https://flow.google.com/batchexecute?rpcids=ogiZ0b',
            status: 200,
            response: `)]}'\n\n[[["wrb.fr","ogiZ0b","[[\\"test-uuid\\",\\"https://lh3.googleusercontent.com/test-img\\"]]",null,null,null,null,1]]]`,
          },
        };
      };

      let rpcImageCalls = 0;
      class MockBotRpcClient extends GoogleFlowRpcClient {
        public override async generateImage(): Promise<any> {
          rpcImageCalls++;
          throw new GoogleFlowRpcError('PUBLIC_ERROR_UNUSUAL_ACTIVITY', {
            code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
            retryable: true,
          });
        }
      }

      const visualService = new AiStudioVisualService();
      visualService.setRpcClient(new MockBotRpcClient());
      (visualService as any).downloadMediaAsset = async (_url: string, out: string) => {
        fs.writeFileSync(out, fs.readFileSync(dummyPng));
      };
      (visualService as any).validateMediaFile = () => {};

      // Scene 1: First attempt -> Pure RPC fails -> Fallback to UI -> Flags _preferUiImageGen = true
      const scene1: StoryboardScene = {
        id: 'scene-1',
        lineIndex: 0,
        startMs: 0,
        endMs: 2000,
        durationMs: 2000,
        lineText: 'Scene 1 text',
        visualPrompt: 'Scene 1 prompt',
        motionType: 'ken_burns',
        status: 'pending',
      };
      await visualService.generateViaGoogleFlow(scene1, path.join(tmpDir, 's1.png'), {
        projectId: 'test-p1',
        outputMode: 'image',
        backoffBaseMs: 0,
      });

      assert.strictEqual(rpcImageCalls, 1, 'Scene 1 phải thử Pure RPC trước (1 call)');
      assert.strictEqual(uiTriggerCalls, 1, 'Scene 1 phải fallback qua triggerUiGen (1 call)');
      assert.strictEqual(lastTimeoutMs, 90000, 'Timeout triggerUiGen cho ảnh phải là 90s (90000ms)');
      assert.strictEqual(visualService.isPreferUiImageGen(), true, '_preferUiImageGen phải được set sang true sau lỗi');

      // Scene 2: Next scene in batch -> MUST skip Pure RPC directly to UI Gen!
      const scene2: StoryboardScene = {
        id: 'scene-2',
        lineIndex: 1,
        startMs: 2000,
        endMs: 4000,
        durationMs: 2000,
        lineText: 'Scene 2 text',
        visualPrompt: 'Scene 2 prompt',
        motionType: 'ken_burns',
        status: 'pending',
      };
      await visualService.generateViaGoogleFlow(scene2, path.join(tmpDir, 's2.png'), {
        projectId: 'test-p1',
        outputMode: 'image',
        backoffBaseMs: 0,
      });

      assert.strictEqual(rpcImageCalls, 1, 'Scene 2 PHẢI BỎ QUA Pure RPC hoàn toàn! (rpcImageCalls vẫn giữ nguyên là 1)');
      assert.strictEqual(uiTriggerCalls, 2, 'Scene 2 phải gọi trực tiếp triggerUiGen (tổng 2 calls)');
      assert.strictEqual(scene2.status, 'ready');

      // Restore
      (bridge as any).isConnected = origIsConnected;
      (bridge as any).triggerUiGen = origTriggerUiGen;
      console.log('  [PASS] Adaptive UI Mode: Cảnh sau tự động bỏ qua Pure RPC bị chặn, trực tiếp gọi UI Gen 0s delay!');
    }

    // ════════════════════════════════════════════════════════════════════════
    // TEST 2: Reset preferUiGen resets state for fresh sessions
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- TEST 2: resetPreferUiGen restores Pure RPC attempt ---');
    {
      const visualService = new AiStudioVisualService();
      visualService.setPreferUiGen(true);
      assert.strictEqual(visualService.isPreferUiGen(), true);
      visualService.resetPreferUiGen();
      assert.strictEqual(visualService.isPreferUiImageGen(), false);
      assert.strictEqual(visualService.isPreferUiVideoGen(), false);
      assert.strictEqual(visualService.isPreferUiGen(), false);
      console.log('  [PASS] resetPreferUiGen khôi phục trạng thái mặc định sạch sẽ');
    }

    // ════════════════════════════════════════════════════════════════════════
    // TEST 3: Video generation default timeout is 180s (180000ms)
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- TEST 3: Video generation default timeout is 180s ---');
    {
      const bridge = FlowBridgeServer.getInstance();
      const origIsConnected = bridge.isConnected.bind(bridge);
      const origTriggerUiGen = bridge.triggerUiGen.bind(bridge);

      let videoTimeoutUsed = 0;
      (bridge as any).isConnected = () => true;
      (bridge as any).triggerUiGen = async (_p: string, timeoutMs: number, _pid: string, mode: string) => {
        if (mode === 'video') videoTimeoutUsed = timeoutMs;
        return {
          ok: true,
          capturedRpc: {
            url: 'https://flow.google.com/batchexecute?rpcids=MZZa6b',
            status: 200,
            response: `)]}'\n\n[[["wrb.fr","MZZa6b","[[\\"test-p1\\",\\"test-p1\\"],[null,null,\\"operations/op-test-123\\"]]",null,null,null,null,1]]]`,
          },
        };
      };

      class MockVideoBlockedRpc extends GoogleFlowRpcClient {
        public override async generateImage(): Promise<any> {
          return { images: [{ url: 'https://test/kf.png', mediaId: 'kf-id' }] };
        }
        public override async generateVideo(): Promise<any> {
          throw new GoogleFlowRpcError('PUBLIC_ERROR_UNUSUAL_ACTIVITY', {
            code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
            retryable: true,
          });
        }
        public override async pollGeneration(): Promise<any> {
          return { done: true, videoUrl: 'https://test/done.mp4', status: 'COMPLETED' };
        }
      }

      const visualService = new AiStudioVisualService();
      visualService.setRpcClient(new MockVideoBlockedRpc());
      (visualService as any).downloadMediaAsset = async (_url: string, out: string) => {
        fs.writeFileSync(out, Buffer.from('FAKE_MP4'));
      };
      (visualService as any).validateMediaFile = () => {};

      const sceneVid: StoryboardScene = {
        id: 'scene-vid-1',
        lineIndex: 0,
        startMs: 0,
        endMs: 3000,
        durationMs: 3000,
        lineText: 'Vid text',
        visualPrompt: 'Vid prompt',
        motionType: 'video',
        status: 'pending',
      };

      await visualService.generateViaGoogleFlow(sceneVid, path.join(tmpDir, 'v.mp4'), {
        projectId: 'test-p1',
        outputMode: 'video',
        backoffBaseMs: 0,
      });

      assert.strictEqual(videoTimeoutUsed, 180000, 'Video UI Gen timeout phải là 180s (180000ms)');
      (bridge as any).isConnected = origIsConnected;
      (bridge as any).triggerUiGen = origTriggerUiGen;
      console.log('  [PASS] Video timeout cấu hình 180s an toàn cho các tác vụ sinh video nặng!');
    }

    console.log('\n========================================================================');
    console.log('  TẤT CẢ TEST DIRECT UI ADAPTIVE MODE ĐÃ PASS 100%!                     ');
    console.log('========================================================================');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

runDirectUiAdaptiveTests().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
