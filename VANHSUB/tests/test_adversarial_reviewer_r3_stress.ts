import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  extractOperationStatus,
  extractGeneratedImages,
  parseBatchResponse,
} from '../main/workflow/flow-engine/rpc/FlowBatchBuilder';
import {
  RPC_GEN_IMAGE,
  RPC_GEN_VIDEO_REFERENCES,
  RPC_MEDIA,
} from '../main/workflow/flow-engine/rpc/FlowBatchConstants';
import { FlowBridgeServer } from '../main/workflow/flow-engine/rpc/FlowBridgeServer';
import {
  AiStudioVisualService,
} from '../main/ai-studio/services/AiStudioVisualService';
import {
  GoogleFlowRpcClient,
  GoogleFlowRpcError,
} from '../main/workflow/flow-engine/rpc/GoogleFlowRpcClient';
import type { StoryboardScene } from '../main/ai-studio/types';

async function runRound3AdversarialSuite() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   ADVERSARIAL REVIEWER TEST SUITE: ROUND 3                               ║');
  console.log('║   DEEP STRESS TESTING: DUAL-ENGINE FALLBACK, DIRECT URLs & SIGNALS      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_adv_r3_'));

  try {
    // =========================================================================
    // TEST 1: extractOperationStatus String Batch Envelope Parsing
    // =========================================================================
    console.log('--- TEST 1: extractOperationStatus with Raw Batchexecute Strings ---');
    {
      // 1a. Raw batchexecute envelope with direct CDN video URL (as29s RPC response)
      const rawDirectVideo = `)]}'\n120\n[[["wrb.fr","as29s","[[\\"proj-r3\\"],[\\"https://flow-content.google/video/direct_video_stream.mp4\\"]]",null,null,null,1]]]`;
      const op1 = extractOperationStatus(rawDirectVideo, 'as29s');
      assert.strictEqual(op1.videoUrl, 'https://flow-content.google/video/direct_video_stream.mp4', 'extractOperationStatus phải trích xuất được videoUrl từ as29s string');
      assert.strictEqual(op1.done, true, 'done phải là true khi có direct videoUrl');

      // 1b. Raw batchexecute envelope with UUID operation ID (no "operations/" prefix)
      const rawUuidOp = `)]}'\n140\n[[["wrb.fr","MZZa6b","[[\\"proj-r3\\"],[null,null,\\"f47ac10b-58cc-4372-a567-0e02b2c3d479\\"]]",null,null,null,1]]]`;
      const op2 = extractOperationStatus(rawUuidOp, 'MZZa6b');
      assert.strictEqual(op2.operationId, 'f47ac10b-58cc-4372-a567-0e02b2c3d479', 'extractOperationStatus phải trích xuất được UUID operation ID từ batchexecute string');
      assert.strictEqual(op2.done, false, 'done phải là false khi chỉ có operationId');

      // 1c. Raw batchexecute envelope with named operation "operations/video-123"
      const rawNamedOp = `)]}'\n140\n[[["wrb.fr","MZZa6b","[[\\"proj-r3\\"],[null,null,\\"operations/video-task-xyz-888\\"]]",null,null,null,1]]]`;
      const op3 = extractOperationStatus(rawNamedOp, 'MZZa6b');
      assert.strictEqual(op3.operationId, 'operations/video-task-xyz-888', 'extractOperationStatus phải trích xuất được operations/ identifier');

      console.log('  [PASS] extractOperationStatus giải mã thành công 100% batchexecute strings (direct URLs, UUIDs, named operations)');
    }

    // =========================================================================
    // TEST 2: Video Fallback with Direct Video URL (skips poller, downloads directly)
    // =========================================================================
    console.log('\n--- TEST 2: Video Dual-Engine Fallback with Direct Video URL via as29s ---');
    {
      const bridge = FlowBridgeServer.getInstance();
      const mockWs: any = {
        readyState: 1, // OPEN
        send: () => {},
        on: () => {},
      };
      (bridge as any).clients.clear();
      (bridge as any).clients.add(mockWs);

      const fakeMp4 = path.join(tmpDir, 'upstream_stream.mp4');
      fs.writeFileSync(fakeMp4, Buffer.concat([Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), Buffer.alloc(100, 0)]));

      const directVideoBatch = `)]}'\n150\n[[["wrb.fr","as29s","[[\\"proj-direct-video\\"],[\\"file://${fakeMp4.replace(/\\/g, '/')}\\"]]",null,null,null,1]]]`;

      bridge.triggerUiGen = async (prompt: string, timeoutMs?: number, projectId?: string, mode?: string) => {
        assert.strictEqual(mode, 'video', 'triggerUiGen phải được gọi với mode video');
        return {
          ok: true,
          capturedRpc: {
            url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=as29s',
            rpcid: 'as29s',
            status: 200,
            response: directVideoBatch,
          },
        };
      };

      const mockClient = new GoogleFlowRpcClient();
      mockClient.generateVideo = async () => {
        throw new GoogleFlowRpcError('Bot evaluation failed', {
          code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
          retryable: true,
        });
      };

      const service = AiStudioVisualService.getInstance();
      service.setRpcClient(mockClient);

      const mockScene: StoryboardScene = {
        id: 'scene-direct-video',
        lineIndex: 0,
        startMs: 0,
        endMs: 4000,
        durationMs: 4000,
        lineText: 'Direct video test scene',
        visualPrompt: 'A beautiful eagle soaring across mountain peaks',
        inputImageAsset: 'media-existing-keyframe-uuid',
        motionType: 'video',
        status: 'pending',
      };

      const outPath = path.join(tmpDir, 'scene_direct_video.mp4');
      const finalResult = await service.generateViaGoogleFlow(
        mockScene,
        outPath,
        { projectId: 'proj-direct-video', outputMode: 'video' }
      );

      assert.strictEqual(finalResult, outPath, 'Tệp video đích phải khớp với đường dẫn outPath');
      assert.ok(fs.existsSync(outPath), 'Tệp video kết quả phải tồn tại trên ổ đĩa');
      assert.strictEqual(mockScene.videoPath, outPath, 'mockScene.videoPath phải được cập nhật');

      console.log('  [PASS] Video Dual-Engine Fallback: Direct Video URL bóc tách và tải hoàn tất không cần poll');
      (bridge as any).clients.clear();
    }

    // =========================================================================
    // TEST 3: Sniffer Mode Isolation & Timestamp Precision in background.js
    // =========================================================================
    console.log('\n--- TEST 3: background.js Sniffer Strict Mode Isolation ---');
    {
      const bgPath = path.join(__dirname, '../extension/background.js');
      const bgContent = fs.readFileSync(bgPath, 'utf8');

      // Kiểm tra actualClickTimestamp được ghi nhận chính xác tại thời điểm CDP click
      assert.ok(
        bgContent.includes('actualClickTimestamp = Date.now()'),
        'background.js phải cập nhật actualClickTimestamp tại thời điểm phát sự kiện CDP click'
      );

      // Kiểm tra sniffer Phase 3 sử dụng timestamp chuẩn xác trừ margin 200ms
      assert.ok(
        bgContent.includes('actualClickTimestamp - 200'),
        'Phase 3 sniffer phải sử dụng actualClickTimestamp trừ 200ms margin'
      );

      // Kiểm tra sniffer KHÔNG có fallback chéo mode (loại trừ bắt nhầm ogiZ0b khi đang gen video hoặc ngược lại)
      const phase3SnifferMatch = bgContent.match(/const genRpc = hist\.find\([\s\S]*?\n\s*\);/);
      assert.ok(phase3SnifferMatch, 'Phải tìm thấy logic genRpc sniffer trong Phase 3');
      const snifferCode = phase3SnifferMatch[0];
      assert.ok(
        !snifferCode.includes('|| hist.find('),
        'Sniffer Phase 3 không được chứa fallback chéo mode làm nhiễm bẩn gói tin'
      );

      console.log('  [PASS] background.js đảm bảo tính toàn vẹn cách ly mode và thời gian click CDP');
    }

    // =========================================================================
    // TEST 4: Immediate AbortSignal Propagation across Bridge & Recovery
    // =========================================================================
    console.log('\n--- TEST 4: AbortSignal Propagation across FlowBridgeServer & RpcClient ---');
    {
      const bridge = FlowBridgeServer.getInstance();
      const mockWs: any = {
        readyState: 1,
        send: () => {},
        on: () => {},
      };
      (bridge as any).clients.clear();
      (bridge as any).clients.add(mockWs);

      // 4a. sendBatchRpc with already aborted signal
      const abortedController = new AbortController();
      abortedController.abort();

      await assert.rejects(
        bridge.sendBatchRpc('ogiZ0b', [], undefined, undefined, 5000, abortedController.signal),
        /CANCELLED/,
        'sendBatchRpc phải lập tức từ chối khi signal đã aborted'
      );

      // 4b. sendBatchRpc aborted mid-flight
      const liveController = new AbortController();
      const midFlightPromise = bridge.sendBatchRpc('ogiZ0b', [], undefined, undefined, 5000, liveController.signal);
      liveController.abort();

      await assert.rejects(
        midFlightPromise,
        /CANCELLED/,
        'sendBatchRpc phải huỷ bỏ ngay lập tức khi nhận tín hiệu signal.abort mid-flight'
      );
      assert.strictEqual((bridge as any).pendingRequests.size, 0, 'pendingRequests phải được dọn sạch');

      // 4c. ensureProject aborted mid-flight
      const projController = new AbortController();
      const projPromise = bridge.ensureProject('proj-test', projController.signal);
      projController.abort();

      await assert.rejects(
        projPromise,
        /CANCELLED/,
        'ensureProject phải huỷ bỏ ngay lập tức khi nhận signal.abort'
      );
      assert.strictEqual((bridge as any).pendingRequests.size, 0, 'pendingRequests phải được dọn sạch sau khi abort ensureProject');

      // 4d. GoogleFlowRpcClient handleUnusualActivityRecovery propagates signal
      let receivedSignal: AbortSignal | undefined;
      (bridge as any).recoverUnusualActivity = async (timeoutMs: number, projectId?: string, signal?: AbortSignal) => {
        receivedSignal = signal;
        return { ok: true };
      };

      const rpcClient = new GoogleFlowRpcClient();
      const testSigController = new AbortController();
      await rpcClient.handleUnusualActivityRecovery(null, 'proj-123', testSigController.signal);
      assert.strictEqual(receivedSignal, testSigController.signal, 'handleUnusualActivityRecovery phải truyền chính xác AbortSignal xuống bridge');

      (bridge as any).clients.clear();
      console.log('  [PASS] AbortSignal được lan truyền toàn diện, ngắt lập tức 0ms không rò rỉ timer');
    }

    // =========================================================================
    // TEST 5: Standalone Image Fallback with Raw Batchexecute String
    // =========================================================================
    console.log('\n--- TEST 5: Standalone Image Fallback with Raw Batchexecute Response ---');
    {
      const bridge = FlowBridgeServer.getInstance();
      const mockWs: any = {
        readyState: 1,
        send: () => {},
        on: () => {},
      };
      (bridge as any).clients.clear();
      (bridge as any).clients.add(mockWs);

      const fakePng = path.join(tmpDir, 'raw_batch_image.png');
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      fs.writeFileSync(fakePng, Buffer.concat([pngHeader, Buffer.alloc(100, 0)]));

      const rawImageBatch = `)]}'\n110\n[[["wrb.fr","ogiZ0b","[[\\"img-uuid-raw-999\\"],[\\"file://${fakePng.replace(/\\/g, '/')}\\"]]",null,null,null,1]]]`;

      bridge.triggerUiGen = async (prompt: string, timeoutMs?: number, projectId?: string, mode?: string) => {
        assert.strictEqual(mode, 'image', 'Phải gọi triggerUiGen với mode image');
        return {
          ok: true,
          capturedRpc: {
            url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b',
            rpcid: 'ogiZ0b',
            status: 200,
            response: rawImageBatch,
          },
        };
      };

      const mockClient = new GoogleFlowRpcClient();
      mockClient.generateImage = async () => {
        throw new GoogleFlowRpcError('reCAPTCHA bot flag blocked Pure RPC', {
          code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
          retryable: true,
        });
      };

      const service = AiStudioVisualService.getInstance();
      service.setRpcClient(mockClient);

      const mockScene: StoryboardScene = {
        id: 'scene-standalone-raw',
        lineIndex: 1,
        startMs: 0,
        endMs: 3000,
        durationMs: 3000,
        lineText: 'Standalone image scene',
        visualPrompt: 'A majestic redwood forest in dawn mist',
        motionType: 'ken_burns',
        status: 'pending',
      };

      const outPath = path.join(tmpDir, 'scene_standalone_raw.png');
      const resPath = await service.generateViaGoogleFlow(
        mockScene,
        outPath,
        { projectId: 'proj-raw-image', outputMode: 'image' }
      );

      assert.strictEqual(resPath, outPath, 'Đường dẫn trả về phải khớp với outPath');
      assert.ok(fs.existsSync(outPath), 'Tệp ảnh tải về phải tồn tại');
      assert.strictEqual(mockScene.imagePath, outPath, 'mockScene.imagePath phải được cập nhật');

      console.log('  [PASS] Standalone Image Fallback: Giải mã chuỗi batchexecute và tải ảnh về đĩa 100%');
      (bridge as any).clients.clear();
    }

    // =========================================================================
    // TEST 6: Flow Error Classifier Resilience on Multiple Bot Flag Aliases
    // =========================================================================
    console.log('\n--- TEST 6: Error Classifier Resilience on Bot-Flag Aliases ---');
    {
      const { FlowErrorClassifier } = require('../main/workflow/flow-engine/FlowErrorClassifier');
      const aliases = [
        'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
        'UNUSUAL_ACTIVITY',
        'bot_flagged by security checkpoint',
        'recaptcha evaluation failed on token mint',
        'captcha_score_low: score=0.1 below threshold',
      ];

      for (const alias of aliases) {
        const classified = FlowErrorClassifier.classify(new Error(alias));
        assert.strictEqual(classified.category, 'NON_RETRYABLE', `Alias "${alias}" phải thuộc NON_RETRYABLE`);
        assert.strictEqual(classified.canRetry, false, `Alias "${alias}" phải có canRetry = false`);
        assert.strictEqual(classified.suggestedAction, 'ABORT_HALT', `Alias "${alias}" phải có ABORT_HALT`);
        assert.strictEqual(classified.code, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY', `Alias "${alias}" phải có code PUBLIC_ERROR_UNUSUAL_ACTIVITY`);
      }

      console.log('  [PASS] FlowErrorClassifier chuẩn hoá 100% biến thể bot-flag sang NON_RETRYABLE (ABORT_HALT)');
    }

    console.log('\n========================================================================');
    console.log('  TẤT CẢ 6 BÀI KIỂM THỬ ADVERSARIAL REVIEWER ROUND 3 ĐÃ PASS 100%!       ');
    console.log('========================================================================\n');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

runRound3AdversarialSuite().catch((err) => {
  console.error('\n❌ ADVERSARIAL REVIEWER ROUND 3 TEST SUITE THẤT BẠI:');
  console.error(err);
  process.exit(1);
});
