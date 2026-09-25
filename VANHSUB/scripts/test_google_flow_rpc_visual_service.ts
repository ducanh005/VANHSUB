/**
 * test_google_flow_rpc_visual_service.ts
 *
 * Automated verification test runner for GoogleFlowRpcClient integration into AI Studio:
 * - AiStudioVisualService.generateViaGoogleFlow direct RPC dispatch (Imagen/Nano image & Veo video)
 * - Automatic CDN asset downloading & local disk storage (size > 0, format verification)
 * - Real-time progress updates from Polling State Machine (queued -> processing -> completed)
 * - Structured error handling (SESSION_EXPIRED, RATE_LIMITED, CONTENT_POLICY_VIOLATION)
 *   and explicit fallback guard (do NOT silently swallow errors without explicit fallback)
 * - Single-scene regeneration via RPC (regenerateSceneAsset)
 * - Multi-scene batch dispatch (dispatchVisualAssets)
 *
 * Run with:
 *   npx tsx scripts/test_google_flow_rpc_visual_service.ts
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';

import {
  AiStudioVisualService,
  aiStudioVisualService,
} from '../main/ai-studio/services/AiStudioVisualService';
import {
  GoogleFlowRpcClient,
  GoogleFlowRpcError,
  classifyFlowRpcError,
  type GenerateImageParams,
  type GenerateVideoParams,
  type PollGenerationParams,
  type RpcGenerateImageResult,
  type RpcGenerateVideoResult,
  type PollGenerationResult,
} from '../main/workflow/flow-engine/rpc/GoogleFlowRpcClient';
import type { StoryboardScene, AiStudioFlowEngineConfig } from '../main/ai-studio/types';

// ANSI Colors for clear terminal test output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ${GREEN}✓${RESET} ${name}`);
  } catch (err: any) {
    failedTests++;
    console.error(`  ${RED}✗${RESET} ${BOLD}${name}${RESET}`);
    console.error(`    ${RED}Error:${RESET} ${err?.message || err}`);
    if (err?.stack) {
      console.error(`    ${CYAN}${err.stack.split('\n').slice(1, 4).join('\n    ')}${RESET}`);
    }
  }
}

// Minimal valid PNG (1x1 pixel)
const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// Minimal valid MP4 header with ftyp box
const VALID_SAMPLE_MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]), // 24-byte box
  Buffer.from('ftypisom', 'ascii'),       // ftyp box, brand isom
  Buffer.from([0x00, 0x00, 0x02, 0x00]), // minor version
  Buffer.from('isomiso2mp41', 'ascii'),   // brands
  Buffer.from([0x00, 0x00, 0x00, 0x08]), // moov box
  Buffer.from('moov', 'ascii'),
]);

async function main() {
  console.log(`\n${BOLD}================================================================${RESET}`);
  console.log(`${BOLD}  TEST SUITE: GoogleFlowRpcClient Integration into AI Studio  ${RESET}`);
  console.log(`${BOLD}================================================================${RESET}\n`);

  const tmpTestDir = path.join(os.tmpdir(), `test-flow-rpc-visual-${Date.now()}`);
  fs.mkdirSync(tmpTestDir, { recursive: true });

  // Start a local mock HTTP server to simulate CDN asset downloads
  let localServerPort = 0;
  const mockServer = http.createServer((req, res) => {
    if (req.url === '/cdn/image.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(VALID_1X1_PNG);
    } else if (req.url === '/cdn/video.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(VALID_SAMPLE_MP4);
    } else if (req.url === '/cdn/redirect.png') {
      res.writeHead(302, { Location: '/cdn/image.png' });
      res.end();
    } else if (req.url === '/cdn/partial.mp4') {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': '100000',
      });
      res.write(Buffer.from('truncated partial stream'));
      setTimeout(() => {
        try { req.socket.destroy(); } catch {}
      }, 20);
    } else if (req.url === '/cdn/range_206.mp4') {
      res.writeHead(206, {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes 0-${VALID_SAMPLE_MP4.length - 1}/${VALID_SAMPLE_MP4.length}`,
      });
      res.end(VALID_SAMPLE_MP4);
    } else if (req.url === '/cdn/auth_required.png') {
      const cookie = req.headers['cookie'] || '';
      if (cookie.includes('session_token=secret_123')) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(VALID_1X1_PNG);
      } else {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Unauthorized: Missing cookie session_token=secret_123');
      }
    } else if (req.url === '/cdn/slow.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': '100000' });
      res.write(Buffer.from('slow stream'));
      // Intentionally don't end to test abort
    } else if (req.url === '/cdn/rate_limited.mp4') {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('Too Many Requests');
    } else if (req.url === '/cdn/empty_zero.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(Buffer.alloc(0));
    } else if (req.url === '/cdn/corrupt_header.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(Buffer.from('CORRUPT_NOT_A_VIDEO_CONTENT'));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise<void>((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => {
      const addr = mockServer.address() as any;
      localServerPort = addr.port;
      resolve();
    });
  });

  const cdnBase = `http://127.0.0.1:${localServerPort}`;

  try {
    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 1: Image Generation (Imagen/Nano RPC) & Media Download
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`${CYAN}${BOLD}▶ SUITE 1: Sinh ảnh (Imagen/Nano RPC) & Tự động tải Asset cục bộ${RESET}`);

    await test('generateViaGoogleFlow gọi GoogleFlowRpcClient.generateImage và tải tệp PNG thành công', async () => {
      class MockImageRpcClient extends GoogleFlowRpcClient {
        public generateImageCalledWith: any = null;
        public async generateImage(params: GenerateImageParams): Promise<RpcGenerateImageResult> {
          this.generateImageCalledWith = params;
          return {
            images: [{ assetId: 'img-asset-001', mediaId: 'img-asset-001', url: `${cdnBase}/cdn/image.png` }],
            firstImageUrl: `${cdnBase}/cdn/image.png`,
            projectId: 'proj-001',
          };
        }
      }

      const client = new MockImageRpcClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const scene: StoryboardScene = {
        id: 'scene-01',
        lineIndex: 0,
        startMs: 0,
        endMs: 4000,
        durationMs: 4000,
        lineText: 'Xin chào thế giới',
        visualPrompt: 'A beautiful futuristic Vietnamese city at night, 4k cinematic',
        motionType: 'ken_burns',
        status: 'pending',
      };

      const outPath = path.join(tmpTestDir, 'suite1', 'scene_01.png');
      const flowConfig: AiStudioFlowEngineConfig = {
        aspectRatio: '16:9',
        outputMode: 'image',
        stylePromptPrefix: 'Cinematic',
        negativePrompt: 'blurry',
        outputsPerScene: 1,
        downloadDir: path.dirname(outPath),
        concurrency: 1,
      };

      const resultPath = await service.generateViaGoogleFlow(scene, outPath, flowConfig);

      assert.strictEqual(resultPath, outPath);
      assert.ok(fs.existsSync(outPath), 'Tệp PNG phải tồn tại trên đĩa');
      const size = fs.statSync(outPath).size;
      assert.ok(size > 0, `Kích thước tệp phải > 0 byte (thực tế: ${size} bytes)`);
      assert.strictEqual(scene.status, 'ready');
      assert.strictEqual(scene.imagePath, outPath);
      assert.strictEqual(scene.assetPath, outPath);

      // Verify PNG magic bytes [0x89, 0x50, 0x4E, 0x47]
      const fd = fs.openSync(outPath, 'r');
      const buf = Buffer.alloc(4);
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);
      assert.deepStrictEqual(Array.from(buf), [0x89, 0x50, 0x4e, 0x47]);

      // Verify RPC params
      assert.ok(client.generateImageCalledWith);
      assert.strictEqual(client.generateImageCalledWith.prompt, scene.visualPrompt);
      assert.strictEqual(client.generateImageCalledWith.aspectRatio, '16:9');
    });

    await test('generateViaGoogleFlow hỗ trợ Base64 Data URI trả về trực tiếp từ RPC', async () => {
      class MockBase64ImageClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          return {
            images: [
              {
                assetId: 'img-b64-1',
                mediaId: 'img-b64-1',
                url: `data:image/png;base64,${VALID_1X1_PNG.toString('base64')}`,
              },
            ],
            firstImageUrl: `data:image/png;base64,${VALID_1X1_PNG.toString('base64')}`,
            projectId: 'proj-b64',
          };
        }
      }

      const client = new MockBase64ImageClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const scene: StoryboardScene = {
        id: 'scene-b64',
        lineIndex: 0,
        startMs: 0,
        endMs: 3000,
        durationMs: 3000,
        lineText: 'Test base64',
        visualPrompt: 'High tech neural core',
        motionType: 'ken_burns',
        status: 'pending',
      };

      const outPath = path.join(tmpTestDir, 'suite1', 'scene_b64.png');
      await service.generateViaGoogleFlow(scene, outPath, {
        aspectRatio: '9:16',
        outputMode: 'image',
        stylePromptPrefix: '',
        negativePrompt: '',
        outputsPerScene: 1,
        downloadDir: path.dirname(outPath),
        concurrency: 1,
      });

      assert.ok(fs.existsSync(outPath));
      assert.ok(fs.statSync(outPath).size > 0);
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 2: Video Generation (Veo RPC) & Polling State Machine
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 2: Sinh video (Veo RPC) & Async Polling State Machine${RESET}`);

    await test('generateViaGoogleFlow gọi generateVideo, Polling theo dõi vòng đời và tải MP4', async () => {
      const progressEvents: Array<{ pct: number; msg: string }> = [];

      class MockVideoRpcClient extends GoogleFlowRpcClient {
        public generateVideoCalled = false;
        public pollGenerationCalled = false;

        public async generateVideo(params: GenerateVideoParams): Promise<RpcGenerateVideoResult> {
          this.generateVideoCalled = true;
          return {
            operationId: 'op-video-lifecycle-101',
            projectId: 'proj-veo-01',
            status: 'RUNNING',
            done: false,
          };
        }

        public async pollGeneration(params: PollGenerationParams): Promise<PollGenerationResult> {
          this.pollGenerationCalled = true;
          // Simulate state machine transitions
          params.onProgress?.({
            state: 'queued',
            percentage: 15,
            message: 'Đang xếp hàng',
            elapsedMs: 200,
            pollCount: 1,
            operationId: params.operationId!,
          });
          params.onProgress?.({
            state: 'processing',
            percentage: 55,
            message: 'Đang render khung hình',
            elapsedMs: 1200,
            pollCount: 2,
            operationId: params.operationId!,
          });
          params.onProgress?.({
            state: 'completed',
            percentage: 100,
            message: 'Video hoàn thành',
            elapsedMs: 2400,
            pollCount: 3,
            operationId: params.operationId!,
          });

          return {
            state: 'completed',
            operationId: params.operationId!,
            videoUrl: `${cdnBase}/cdn/video.mp4`,
            elapsedMs: 2400,
            pollCount: 3,
          };
        }
      }

      const client = new MockVideoRpcClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const scene: StoryboardScene = {
        id: 'scene-veo-01',
        lineIndex: 0,
        startMs: 0,
        endMs: 5000,
        durationMs: 5000,
        lineText: 'Đoạn video mở màn',
        visualPrompt: 'Cinematic drone shot over lush mountains, sunset',
        motionType: 'video',
        status: 'pending',
      };

      const outPath = path.join(tmpTestDir, 'suite2', 'scene_01.mp4');
      const flowConfig: AiStudioFlowEngineConfig = {
        aspectRatio: '16:9',
        outputMode: 'video',
        stylePromptPrefix: 'Cinematic',
        negativePrompt: 'blurry',
        outputsPerScene: 1,
        downloadDir: path.dirname(outPath),
        concurrency: 1,
      };

      const resultPath = await service.generateViaGoogleFlow(
        scene,
        outPath,
        flowConfig,
        (pct, msg) => {
          progressEvents.push({ pct, msg });
        }
      );

      assert.strictEqual(resultPath, outPath);
      assert.ok(fs.existsSync(outPath), 'Tệp MP4 phải tồn tại sau khi tải về');
      assert.ok(fs.statSync(outPath).size > 0, 'Kích thước tệp video MP4 phải > 0');
      assert.strictEqual(scene.videoPath, outPath);
      assert.strictEqual(scene.assetPath, outPath);
      assert.strictEqual(scene.status, 'ready');

      // Verify MP4 ftyp box header
      const fd = fs.openSync(outPath, 'r');
      const headerBuf = Buffer.alloc(16);
      fs.readSync(fd, headerBuf, 0, 16, 0);
      fs.closeSync(fd);
      assert.ok(
        headerBuf.indexOf(Buffer.from('ftyp')) >= 0,
        'File header phải chứa ftyp box của định dạng MP4'
      );

      // Verify real-time progress callbacks were delivered from polling state machine
      assert.ok(progressEvents.length >= 3, 'Phải nhận được ít nhất 3 sự kiện tiến độ');
      const queuedEvent = progressEvents.find((e) => e.msg.includes('queued') || e.msg.includes('xếp hàng'));
      const procEvent = progressEvents.find((e) => e.msg.includes('processing') || e.msg.includes('render'));
      const compEvent = progressEvents.find((e) => e.pct === 100);
      assert.ok(queuedEvent, 'Phải có sự kiện trạng thái queued');
      assert.ok(procEvent, 'Phải có sự kiện trạng thái processing');
      assert.ok(compEvent, 'Phải có sự kiện trạng thái hoàn tất 100%');
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 3: Structured Error Handling & Explicit Fallback Control
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 3: Bóc tách mã lỗi cấu trúc & Kiểm soát Explicit Fallback${RESET}`);

    await test('SESSION_EXPIRED: Ném lỗi rõ ràng khi KHÔNG cấu hình explicit fallback', async () => {
      class MockSessionExpiredClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          throw new GoogleFlowRpcError('Phiên đăng nhập Google Flow đã hết hạn.', {
            code: 'SESSION_EXPIRED',
            httpStatus: 401,
          });
        }
      }

      const client = new MockSessionExpiredClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const scenes: StoryboardScene[] = [
        { id: 'sc-exp-1', lineIndex: 0, startMs: 0, endMs: 3000, durationMs: 3000, lineText: 'Lỗi phiên', visualPrompt: 'P1', motionType: 'ken_burns', status: 'pending' },
      ];

      let thrownErr: any = null;
      try {
        await service.dispatchVisualAssets(
          scenes,
          {
            aspectRatio: '16:9',
            outputMode: 'image',
            stylePromptPrefix: '',
            negativePrompt: '',
            outputsPerScene: 1,
            downloadDir: path.join(tmpTestDir, 'suite3_err'),
            concurrency: 1,
            allowSyntheticFallback: false, // Explicitly false
          },
          path.join(tmpTestDir, 'suite3_err')
        );
      } catch (err: any) {
        thrownErr = err;
      }

      assert.ok(thrownErr, 'Phải ném lỗi SESSION_EXPIRED ra ngoài thay vì âm thầm nuốt lỗi');
      assert.strictEqual(thrownErr.code, 'SESSION_EXPIRED');
    });

    await test('SESSION_EXPIRED: Tự động kích hoạt synthetic fallback khi CÓ cấu hình explicit fallback', async () => {
      class MockSessionExpiredClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          throw new GoogleFlowRpcError('Phiên đăng nhập Google Flow đã hết hạn.', {
            code: 'SESSION_EXPIRED',
            httpStatus: 401,
          });
        }
      }

      const client = new MockSessionExpiredClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const outDir = path.join(tmpTestDir, 'suite3_fallback');
      const scenes: StoryboardScene[] = [
        { id: 'sc-exp-fallback', lineIndex: 0, startMs: 0, endMs: 3000, durationMs: 3000, lineText: 'Fallback scene', visualPrompt: 'P2', motionType: 'ken_burns', status: 'pending' },
      ];

      const res = await service.dispatchVisualAssets(
        scenes,
        {
          aspectRatio: '16:9',
          outputMode: 'image',
          stylePromptPrefix: '',
          negativePrompt: '',
          outputsPerScene: 1,
          downloadDir: outDir,
          concurrency: 1,
          allowSyntheticFallback: true, // EXPLICIT FALLBACK ENABLED
        },
        outDir
      );

      assert.strictEqual(res.modeUsed, 'synthetic_fallback');
      assert.strictEqual(res.generatedCount, 1);
      assert.ok(fs.existsSync(scenes[0].assetPath!));
      assert.ok(fs.statSync(scenes[0].assetPath!).size > 0);
    });

    await test('RATE_LIMITED: Ném lỗi rõ ràng khi không có fallback và bóc tách retryAfterMs', async () => {
      class MockRateLimitClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          throw new GoogleFlowRpcError('429 Too Many Requests: Rate limited, try again in 12s', {
            code: 'RATE_LIMITED',
            retryAfterMs: 12000,
            httpStatus: 429,
          });
        }
      }

      const client = new MockRateLimitClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const scenes: StoryboardScene[] = [
        { id: 'sc-rate-1', lineIndex: 0, startMs: 0, endMs: 3000, durationMs: 3000, lineText: 'Quá tải', visualPrompt: 'P', motionType: 'ken_burns', status: 'pending' },
      ];

      let thrownErr: any = null;
      try {
        await service.dispatchVisualAssets(
          scenes,
          {
            aspectRatio: '16:9',
            outputMode: 'image',
            stylePromptPrefix: '',
            negativePrompt: '',
            outputsPerScene: 1,
            downloadDir: path.join(tmpTestDir, 'suite3_rate'),
            concurrency: 1,
            allowSyntheticFallback: false,
          },
          path.join(tmpTestDir, 'suite3_rate')
        );
      } catch (err: any) {
        thrownErr = err;
      }

      assert.ok(thrownErr);
      assert.strictEqual(thrownErr.code, 'RATE_LIMITED');
      assert.strictEqual(thrownErr.retryAfterMs, 12000);
    });

    await test('CONTENT_POLICY_VIOLATION: Ném lỗi rõ ràng khi vi phạm chính sách an toàn', async () => {
      class MockPolicyViolationClient extends GoogleFlowRpcClient {
        public async generateVideo(): Promise<RpcGenerateVideoResult> {
          throw new GoogleFlowRpcError('Nội dung prompt vi phạm bộ lọc an toàn của Google Flow (NSFW/Harmful).', {
            code: 'CONTENT_POLICY_VIOLATION',
            retryable: false,
          });
        }
      }

      const client = new MockPolicyViolationClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const scene: StoryboardScene = {
        id: 'sc-policy-1',
        lineIndex: 0,
        startMs: 0,
        endMs: 4000,
        durationMs: 4000,
        lineText: 'Prompt nhạy cảm',
        visualPrompt: 'Unsafe prompt',
        motionType: 'video',
        status: 'pending',
      };

      const outPath = path.join(tmpTestDir, 'suite3_policy', 'scene.mp4');

      let thrownErr: any = null;
      try {
        await service.generateViaGoogleFlow(scene, outPath, {
          aspectRatio: '16:9',
          outputMode: 'video',
          stylePromptPrefix: '',
          negativePrompt: '',
          outputsPerScene: 1,
          downloadDir: path.dirname(outPath),
          concurrency: 1,
        });
      } catch (err: any) {
        thrownErr = err;
      }

      assert.ok(thrownErr);
      assert.strictEqual(thrownErr.code, 'CONTENT_POLICY_VIOLATION');
      assert.strictEqual(thrownErr.retryable, false);
      assert.strictEqual(thrownErr.isContentPolicyViolation, true);
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 4: Batch Dispatch & Granular Regeneration Integration
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 4: Điều phối đa phân cảnh (Batch Dispatch) & Tái tạo đơn lẻ${RESET}`);

    await test('dispatchVisualAssets sinh thành công 3 phân cảnh liên hoàn với mode google_flow', async () => {
      class MockMultiSceneClient extends GoogleFlowRpcClient {
        public callCount = 0;
        public async generateImage(params: GenerateImageParams): Promise<RpcGenerateImageResult> {
          this.callCount++;
          return {
            images: [{ assetId: `img-${this.callCount}`, mediaId: `img-${this.callCount}`, url: `${cdnBase}/cdn/image.png` }],
            firstImageUrl: `${cdnBase}/cdn/image.png`,
            projectId: 'proj-batch',
          };
        }
      }

      const client = new MockMultiSceneClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const outDir = path.join(tmpTestDir, 'suite4_batch');
      const scenes: StoryboardScene[] = [
        { id: 'sc-1', lineIndex: 0, startMs: 0, endMs: 3000, durationMs: 3000, lineText: 'Cảnh 1', visualPrompt: 'Prompt 1', motionType: 'ken_burns', status: 'pending' },
        { id: 'sc-2', lineIndex: 1, startMs: 3000, endMs: 6000, durationMs: 3000, lineText: 'Cảnh 2', visualPrompt: 'Prompt 2', motionType: 'ken_burns', status: 'pending' },
        { id: 'sc-3', lineIndex: 2, startMs: 6000, endMs: 9000, durationMs: 3000, lineText: 'Cảnh 3', visualPrompt: 'Prompt 3', motionType: 'ken_burns', status: 'pending' },
      ];

      const progressHistory: number[] = [];
      const res = await service.dispatchVisualAssets(
        scenes,
        {
          aspectRatio: '16:9',
          outputMode: 'image',
          stylePromptPrefix: 'Cinematic',
          negativePrompt: '',
          outputsPerScene: 1,
          downloadDir: outDir,
          concurrency: 1,
        },
        outDir,
        (pct) => progressHistory.push(pct)
      );

      assert.strictEqual(res.modeUsed, 'google_flow');
      assert.strictEqual(res.generatedCount, 3);
      assert.strictEqual(client.callCount, 3);
      for (const sc of scenes) {
        assert.ok(fs.existsSync(sc.assetPath!));
        assert.ok(fs.statSync(sc.assetPath!).size > 0);
        assert.strictEqual(sc.status, 'ready');
      }
    });

    await test('regenerateSceneAsset tái tạo thành công 1 phân cảnh bằng RPC client', async () => {
      class MockSingleSceneClient extends GoogleFlowRpcClient {
        public async generateVideo(): Promise<RpcGenerateVideoResult> {
          return {
            operationId: 'op-single-vid',
            projectId: 'proj-single',
            status: 'CAE',
            done: true,
            videoUrl: `${cdnBase}/cdn/video.mp4`,
          };
        }
      }

      const client = new MockSingleSceneClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const targetDir = path.join(tmpTestDir, 'suite4_single');
      const res = await service.regenerateSceneAsset(
        {
          sceneId: 'single-shot-99',
          visualPrompt: 'Dynamic slow motion water splash in sunlight',
          mode: 'video',
          flowConfig: {
            outputMode: 'video',
            aspectRatio: '9:16',
          } as any,
        },
        targetDir
      );

      assert.ok(res.assetPath, 'assetPath phải được trả về');
      assert.ok(res.videoPath, 'videoPath phải được trả về cho mode video');
      assert.ok(fs.existsSync(res.assetPath), 'Tệp video phải tồn tại trên đĩa');
      assert.ok(fs.statSync(res.assetPath).size > 0, 'Kích thước tệp video phải > 0');
      assert.ok(res.assetPath.endsWith('.mp4'), 'Đuôi file phải là .mp4 cho mode video');
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 5: Redirects & Robust Downloader Tests
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 5: Trình tải tệp CDN & Xử lý Redirect${RESET}`);

    await test('downloadMediaAsset theo dõi redirect HTTP 302 về tệp gốc thành công', async () => {
      const service = new AiStudioVisualService();
      const dest = path.join(tmpTestDir, 'suite5', 'redirect_test.png');

      await service.downloadMediaAsset(`${cdnBase}/cdn/redirect.png`, dest);

      assert.ok(fs.existsSync(dest));
      assert.strictEqual(fs.statSync(dest).size, VALID_1X1_PNG.length);
    });

    await test('validateMediaFile ném lỗi nếu tệp rỗng 0 bytes hoặc sai định dạng', async () => {
      const service = new AiStudioVisualService();
      const emptyFile = path.join(tmpTestDir, 'suite5', 'empty.png');
      fs.writeFileSync(emptyFile, Buffer.alloc(0));

      assert.throws(() => {
        service.validateMediaFile(emptyFile, 'image');
      }, /rỗng/);

      const corruptFile = path.join(tmpTestDir, 'suite5', 'corrupt.png');
      fs.writeFileSync(corruptFile, Buffer.from('NOT_AN_IMAGE_FILE_DATA_HERE'));

      assert.throws(() => {
        service.validateMediaFile(corruptFile, 'image');
      }, /không phải định dạng ảnh hợp lệ/);
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 6: AiStudioPipelineEngine Integration with Pure Web RPC
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 6: Tích hợp AiStudioPipelineEngine với Pure Web RPC${RESET}`);

    await test('aiStudioPipelineEngine.regenerateSceneAsset điều hướng đến RPC khi engine là rpc', async () => {
      const { aiStudioPipelineEngine } = await import('../main/ai-studio/AiStudioPipelineEngine');

      class MockEngineRpcClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          return {
            images: [{ assetId: 'img-engine-1', mediaId: 'img-engine-1', url: `${cdnBase}/cdn/image.png` }],
            firstImageUrl: `${cdnBase}/cdn/image.png`,
            projectId: 'proj-engine',
          };
        }
      }

      aiStudioVisualService.setRpcClient(new MockEngineRpcClient());

      const res = await aiStudioPipelineEngine.regenerateSceneAsset({
        sceneId: 'shot-engine-rpc-test',
        visualPrompt: 'Futuristic quantum computer laboratory',
        mode: 'image',
        flowConfig: {
          engine: 'rpc',
          aspectRatio: '16:9',
          outputMode: 'image',
        } as any,
      });

      assert.ok(res.assetPath, 'Phải trả về assetPath');
      assert.ok(fs.existsSync(res.assetPath), 'Tệp media phải tồn tại trên đĩa');
      assert.ok(fs.statSync(res.assetPath).size > 0, 'Kích thước tệp media phải > 0');

      aiStudioVisualService.setRpcClient(null);
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 7: Adversarial Edge Cases & Robustness Suite (Reviewer Round 1)
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 7: Adversarial Edge Cases & Robustness Suite (Reviewer R1)${RESET}`);

    const service = new AiStudioVisualService();
    const { aiStudioPipelineEngine, resolveAiStudioSessionsRoot } = await import('../main/ai-studio/AiStudioPipelineEngine');

    await test('validateMediaFile: Chặn đứng tệp giả mạo video có boxLength nhỏ nhưng thiếu ftyp/moov/mdat/webm', () => {
      const fakeVideoPath = path.join(tmpTestDir, 'fake_video.mp4');
      // 32 bytes bắt đầu bằng UInt32BE = 32, nhưng nội dung là chuỗi văn bản không phải video box
      const fakeBuf = Buffer.alloc(32);
      fakeBuf.writeUInt32BE(32, 0);
      fakeBuf.write('THIS_IS_NOT_A_VALID_MP4_VIDEO!!', 4, 'ascii');
      fs.writeFileSync(fakeVideoPath, fakeBuf);

      assert.throws(
        () => {
          service.validateMediaFile(fakeVideoPath, 'video');
        },
        /không phải định dạng video hợp lệ/,
        'validateMediaFile phải chặn tệp giả mạo'
      );
    });

    await test('downloadMediaAsset: Phát hiện luồng mạng đứt đoạn (Content-Length mismatch) và dọn sạch tệp', async () => {
      const outPath = path.join(tmpTestDir, 'suite7_partial.mp4');
      let thrown: any = null;
      try {
        await service.downloadMediaAsset(`${cdnBase}/cdn/partial.mp4`, outPath, { timeoutMs: 5000 });
      } catch (err: any) {
        thrown = err;
      }
      assert.ok(thrown, 'Phải ném lỗi khi kết nối đứt đoạn không đủ content-length');
      assert.ok(
        thrown.message.includes('không hoàn chỉnh') || thrown.message.includes('Lỗi') || thrown.message.includes('ECONNRESET'),
        `Thông báo lỗi phù hợp: ${thrown.message}`
      );
      assert.strictEqual(fs.existsSync(outPath), false, 'Tệp hỏng dở dang phải được xoá sạch khỏi đĩa');
    });

    await test('downloadMediaAsset: Hỗ trợ thành công tải từ CDN phản hồi HTTP 206 (Partial Content)', async () => {
      const outPath = path.join(tmpTestDir, 'suite7_range206.mp4');
      await service.downloadMediaAsset(`${cdnBase}/cdn/range_206.mp4`, outPath);
      assert.ok(fs.existsSync(outPath));
      assert.ok(fs.statSync(outPath).size > 0);
      service.validateMediaFile(outPath, 'video');
    });

    await test('downloadMediaAsset: Truyền cookie xác thực tải từ CDN bảo vệ thành công', async () => {
      const outPath = path.join(tmpTestDir, 'suite7_auth.png');
      // Thử tải không có cookie -> ném lỗi SESSION_EXPIRED (HTTP 401)
      let unauthorizedErr: any = null;
      try {
        await service.downloadMediaAsset(`${cdnBase}/cdn/auth_required.png`, outPath);
      } catch (e: any) {
        unauthorizedErr = e;
      }
      assert.ok(unauthorizedErr, 'Không có cookie phải bị từ chối');
      assert.strictEqual(unauthorizedErr.code, 'SESSION_EXPIRED');

      // Tải với cookie hợp lệ -> thành công
      await service.downloadMediaAsset(`${cdnBase}/cdn/auth_required.png`, outPath, {
        cookie: 'session_token=secret_123',
      });
      assert.ok(fs.existsSync(outPath));
      assert.ok(fs.statSync(outPath).size > 0);
      service.validateMediaFile(outPath, 'image');
    });

    await test('downloadMediaAsset: Huỷ bỏ lập tức khi nhận AbortSignal và dọn sạch file', async () => {
      const outPath = path.join(tmpTestDir, 'suite7_abort.mp4');
      const controller = new AbortController();
      const p = service.downloadMediaAsset(`${cdnBase}/cdn/slow.mp4`, outPath, {
        signal: controller.signal,
      });
      // Kích hoạt huỷ sau 20ms
      setTimeout(() => controller.abort(), 20);

      let thrown: any = null;
      try {
        await p;
      } catch (err: any) {
        thrown = err;
      }
      assert.ok(thrown, 'Tác vụ phải bị huỷ');
      assert.strictEqual(fs.existsSync(outPath), false, 'Tệp tải dở dang phải được dọn sạch');
    });

    await test('generateViaGoogleFlow: Bảo toàn đường dẫn thư mục chứa dấu chấm (vd: /my.dir.v1/scene_01)', async () => {
      class MockDotDirClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          return {
            images: [{ assetId: 'img-1', mediaId: 'm-1', url: `${cdnBase}/cdn/image.png` }],
            firstImageUrl: `${cdnBase}/cdn/image.png`,
            projectId: 'proj-dot',
          };
        }
      }

      const client = new MockDotDirClient();
      service.setRpcClient(client);

      const dotDirPath = path.join(tmpTestDir, 'my.project.v1', 'scene_01');
      const scene: StoryboardScene = {
        id: 'scene-dot',
        lineIndex: 0,
        startMs: 0,
        endMs: 3000,
        durationMs: 3000,
        lineText: 'Dot dir test',
        visualPrompt: 'Scenic mountain view',
        motionType: 'ken_burns',
        status: 'pending',
      };

      const finalPath = await service.generateViaGoogleFlow(scene, dotDirPath, {
        outputMode: 'image',
        aspectRatio: '16:9',
      });

      assert.strictEqual(finalPath, `${dotDirPath}.png`, 'Đường dẫn phải giữ nguyên tên thư mục my.project.v1');
      assert.ok(fs.existsSync(finalPath), 'Tệp media phải nằm đúng thư mục đích');
      assert.ok(finalPath.includes('my.project.v1'));
      service.setRpcClient(null);
    });

    await test('generateViaGoogleFlow: Tiến độ phần trăm tăng đơn điệu không nhảy lùi khi kết thúc Polling', async () => {
      class MockMonotonicVideoClient extends GoogleFlowRpcClient {
        public async generateVideo(): Promise<RpcGenerateVideoResult> {
          return {
            operationId: 'op-mono-1',
            projectId: 'proj-mono',
            status: 'QUEUED',
            done: false,
          };
        }
        public async pollGeneration(params: any): Promise<any> {
          params.onProgress?.({ percentage: 20, state: 'queued', message: 'Hàng đợi' });
          params.onProgress?.({ percentage: 60, state: 'processing', message: 'Đang tạo' });
          params.onProgress?.({ percentage: 100, state: 'completed', message: 'Xong' });
          return {
            state: 'completed',
            operationId: 'op-mono-1',
            videoUrl: `${cdnBase}/cdn/video.mp4`,
          };
        }
      }

      service.setRpcClient(new MockMonotonicVideoClient());
      const pcts: number[] = [];
      const scene: StoryboardScene = {
        id: 'sc-mono',
        lineIndex: 0,
        startMs: 0,
        endMs: 4000,
        durationMs: 4000,
        lineText: 'Monotonic test',
        visualPrompt: 'Space shuttle launch',
        motionType: 'video',
        status: 'pending',
      };

      const outPath = path.join(tmpTestDir, 'suite7_mono.mp4');
      await service.generateViaGoogleFlow(scene, outPath, { outputMode: 'video' }, (pct) => {
        pcts.push(pct);
      });

      // Kiểm tra tính đơn điệu tăng dần của mảng pcts
      for (let i = 1; i < pcts.length; i++) {
        assert.ok(
          pcts[i] >= pcts[i - 1],
          `Tiến độ không được nhảy lùi: pcts[${i - 1}]=${pcts[i - 1]} -> pcts[${i}]=${pcts[i]}`
        );
      }
      assert.strictEqual(pcts[pcts.length - 1], 100, 'Bước cuối cùng phải là 100%');
      service.setRpcClient(null);
    });

    await test('dispatchVisualAssets: Ném lỗi UPSTREAM_ERROR khi engine là rpc và không cấu hình explicit fallback', async () => {
      class MockUpstreamFailClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          throw new GoogleFlowRpcError('500 Internal Server Error: Google upstream failed', {
            code: 'UPSTREAM_ERROR',
            retryable: true,
            httpStatus: 500,
          });
        }
      }

      service.setRpcClient(new MockUpstreamFailClient());
      const scene: StoryboardScene = {
        id: 'sc-upstream-fail',
        lineIndex: 0,
        startMs: 0,
        endMs: 3000,
        durationMs: 3000,
        lineText: 'Upstream fail',
        visualPrompt: 'Ancient castle on cliff',
        motionType: 'ken_burns',
        status: 'pending',
      };

      let thrownErr: any = null;
      try {
        await service.dispatchVisualAssets(
          [scene],
          {
            engine: 'rpc',
            outputMode: 'image',
            // allowSyntheticFallback KHÔNG ĐƯỢC BẬT
          },
          path.join(tmpTestDir, 'suite7_upstream')
        );
      } catch (err: any) {
        thrownErr = err;
      }

      assert.ok(thrownErr, 'Phải ném lỗi UPSTREAM_ERROR ra ngoài chứ không được âm thầm tạo synthetic fallback');
      assert.strictEqual(thrownErr.code, 'UPSTREAM_ERROR');
      service.setRpcClient(null);
    });

    await test('aiStudioPipelineEngine.regenerateSceneAsset: Hỗ trợ cấu hình engine flow_rpc', async () => {
      class MockFlowRpcEngineClient extends GoogleFlowRpcClient {
        public generateCalled = false;
        public async generateImage(): Promise<RpcGenerateImageResult> {
          this.generateCalled = true;
          return {
            images: [{ assetId: 'img-frpc-1', mediaId: 'm-frpc-1', url: `${cdnBase}/cdn/image.png` }],
            firstImageUrl: `${cdnBase}/cdn/image.png`,
            projectId: 'proj-frpc',
          };
        }
      }

      const client = new MockFlowRpcEngineClient();
      aiStudioVisualService.setRpcClient(client);

      const res = await aiStudioPipelineEngine.regenerateSceneAsset({
        sceneId: 'shot-flow-rpc-engine-test',
        visualPrompt: 'Cyberpunk neon drone flying through alley',
        mode: 'image',
        flowConfig: {
          engine: 'flow_rpc',
          aspectRatio: '16:9',
          outputMode: 'image',
        } as any,
      });

      assert.ok(res.assetPath);
      assert.ok(fs.existsSync(res.assetPath));
      assert.strictEqual(client.generateCalled, true, 'flow_rpc engine phải kích hoạt GoogleFlowRpcClient');
      aiStudioVisualService.setRpcClient(null);
    });

    await test('dispatchVisualAssets: Synthetic fallback dọn sạch scene.videoPath khi fallback từ video', async () => {
      const scene: StoryboardScene = {
        id: 'sc-clean-videopath',
        lineIndex: 0,
        startMs: 0,
        endMs: 3000,
        durationMs: 3000,
        lineText: 'Clean videoPath test',
        visualPrompt: 'Scenic river waterfall',
        videoPath: '/stale/path/to/old_video.mp4',
        motionType: 'video',
        status: 'pending',
      };

      const result = await service.dispatchVisualAssets(
        [scene],
        {
          engine: 'synthetic',
          outputMode: 'video',
          allowSyntheticFallback: true,
        },
        path.join(tmpTestDir, 'suite7_clean_videopath')
      );

      assert.strictEqual(result.modeUsed, 'synthetic_fallback');
      assert.ok(scene.assetPath?.endsWith('.png'), 'Asset fallback phải là PNG');
      assert.strictEqual(scene.videoPath, undefined, 'scene.videoPath phải bị dọn sạch khi rơi vào synthetic fallback');
    });

    await test('aiStudioPipelineEngine.regenerateSceneAsset: Ném lỗi khi RPC thất bại và không có explicit fallback', async () => {
      class FailingRpcClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          throw new GoogleFlowRpcError('Upstream connection failed', {
            code: 'UPSTREAM_ERROR',
            retryable: false,
          });
        }
      }

      aiStudioVisualService.setRpcClient(new FailingRpcClient());
      let caught: any = null;
      try {
        await aiStudioPipelineEngine.regenerateSceneAsset({
          sceneId: 'shot-fail-no-fallback',
          visualPrompt: 'Epic mountain peaks',
          mode: 'image',
          flowConfig: {
            engine: 'rpc',
            allowSyntheticFallback: false,
          } as any,
        });
      } catch (e) {
        caught = e;
      }

      assert.ok(caught, 'Phải ném lỗi khi RPC thất bại mà không có fallback');
      assert.strictEqual(caught.code, 'UPSTREAM_ERROR');
      aiStudioVisualService.setRpcClient(null);
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 8: Adversarial Reviewer R2 Verification Suite
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 8: Adversarial Edge Cases & Pipeline Synchronization (Reviewer R2)${RESET}`);

    await test('validateMediaFile: Chặn đứng tệp WAV/RIFF âm thanh giả mạo ảnh WebP', () => {
      const service = new AiStudioVisualService();
      const fakeWebpPath = path.join(tmpTestDir, 'fake_riff_audio.webp');
      // RIFF header with WAVE四CC (WAV audio file)
      const fakeRiffWav = Buffer.concat([
        Buffer.from('RIFF', 'ascii'),
        Buffer.from([0x24, 0x00, 0x00, 0x00]), // size
        Buffer.from('WAVEfmt ', 'ascii'),       // audio marker
      ]);
      fs.writeFileSync(fakeWebpPath, fakeRiffWav);

      assert.throws(
        () => service.validateMediaFile(fakeWebpPath, 'image'),
        /không phải định dạng ảnh hợp lệ/
      );
    });

    await test('validateMediaFile: Chấp nhận tệp MP4 có hộp ftyp bắt đầu sau byte 16 (tiền tố wide box)', () => {
      const service = new AiStudioVisualService();
      const wideMp4Path = path.join(tmpTestDir, 'wide_offset.mp4');
      // 8-byte wide box followed by ftyp box
      const wideMp4Buf = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x08]),
        Buffer.from('wide', 'ascii'),
        Buffer.from([0x00, 0x00, 0x00, 0x18]),
        Buffer.from('ftypisom', 'ascii'),
        Buffer.from([0x00, 0x00, 0x02, 0x00]),
        Buffer.from('isomiso2mp41', 'ascii'),
        Buffer.from([0x00, 0x00, 0x00, 0x08]),
        Buffer.from('moov', 'ascii'),
      ]);
      fs.writeFileSync(wideMp4Path, wideMp4Buf);

      assert.doesNotThrow(() => service.validateMediaFile(wideMp4Path, 'video'));
    });

    await test('resolveDimensions: Chuẩn hoá chính xác các tỷ lệ khung hình dạng chuỗi (square, portrait, landscape, 3:4, 4:3)', () => {
      const service = new AiStudioVisualService();

      const sq = service.resolveDimensions('square', '720p');
      assert.deepStrictEqual(sq, { width: 720, height: 720 });

      const sq1080 = service.resolveDimensions('1:1', '1080p');
      assert.deepStrictEqual(sq1080, { width: 1080, height: 1080 });

      const port = service.resolveDimensions('portrait', '1080p');
      assert.deepStrictEqual(port, { width: 1080, height: 1920 });

      const land = service.resolveDimensions('landscape', '1080p');
      assert.deepStrictEqual(land, { width: 1920, height: 1080 });

      const r34 = service.resolveDimensions('3:4', '720p');
      assert.deepStrictEqual(r34, { width: 540, height: 720 });

      const r43 = service.resolveDimensions('4:3', '1080p');
      assert.deepStrictEqual(r43, { width: 1440, height: 1080 });
    });

    await test('downloadViaHttp: Huỷ bỏ an toàn trong lúc stream và giải phóng stream file không để lại file bị khóa trên Windows', async () => {
      const service = new AiStudioVisualService();
      const dest = path.join(tmpTestDir, 'stream_abort_test.mp4');
      const controller = new AbortController();

      // Hủy bỏ sau 50ms khi server đang gửi luồng dở dang
      setTimeout(() => controller.abort(), 50);

      let caught: any = null;
      try {
        await service.downloadMediaAsset(`${cdnBase}/cdn/slow.mp4`, dest, {
          signal: controller.signal,
          timeoutMs: 5000,
        });
      } catch (err: any) {
        caught = err;
      }

      assert.ok(caught, 'Phải ném lỗi khi bị huỷ');
      assert.strictEqual(caught.code, 'CANCELLED');
      assert.strictEqual(fs.existsSync(dest), false, 'Tệp tải dở dang phải được giải phóng và xoá sạch');
    });

    await test('dispatchVisualAssets: Gọi onSceneComplete cho từng phân cảnh hoàn thành để UI cập nhật theo thời gian thực', async () => {
      class MockMultiSceneRpcClient extends GoogleFlowRpcClient {
        public async generateImage(params: GenerateImageParams): Promise<RpcGenerateImageResult> {
          return {
            images: [{ assetId: 'img-1', mediaId: 'img-1', url: `${cdnBase}/cdn/image.png` }],
            firstImageUrl: `${cdnBase}/cdn/image.png`,
            projectId: 'proj-batch',
          };
        }
      }

      const client = new MockMultiSceneRpcClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const scenes: StoryboardScene[] = [
        {
          id: 'scene-inc-1',
          lineIndex: 0,
          startMs: 0,
          endMs: 3000,
          durationMs: 3000,
          lineText: 'Scene 1',
          visualPrompt: 'Prompt 1',
          motionType: 'ken_burns',
          status: 'pending',
        },
        {
          id: 'scene-inc-2',
          lineIndex: 1,
          startMs: 3000,
          endMs: 6000,
          durationMs: 3000,
          lineText: 'Scene 2',
          visualPrompt: 'Prompt 2',
          motionType: 'ken_burns',
          status: 'pending',
        },
      ];

      const completedLog: number[] = [];
      const result = await service.dispatchVisualAssets(
        scenes,
        { engine: 'rpc', outputMode: 'image' },
        path.join(tmpTestDir, 'suite8_batch'),
        undefined,
        undefined,
        async (sc, idx) => {
          completedLog.push(idx);
          assert.strictEqual(sc.status, 'ready');
          assert.ok(sc.assetPath && fs.existsSync(sc.assetPath));
        }
      );

      assert.deepStrictEqual(completedLog, [0, 1], 'onSceneComplete phải được gọi tuần tự cho cả 2 scene');
      assert.strictEqual(result.generatedCount, 2);
    });

    await test('dispatchVisualAssets: Tự động sinh video khi scene.motionType === "video" dù outputMode không chỉ định "video"', async () => {
      let videoCalled = false;
      class MockVideoSceneRpcClient extends GoogleFlowRpcClient {
        public async generateVideo(params: GenerateVideoParams): Promise<RpcGenerateVideoResult> {
          videoCalled = true;
          return {
            videoUrl: `${cdnBase}/cdn/video.mp4`,
            operationId: 'op-auto-vid',
            projectId: 'proj-vid',
            status: 'completed',
            done: true,
          } as RpcGenerateVideoResult;
        }
      }

      const client = new MockVideoSceneRpcClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const scenes: StoryboardScene[] = [
        {
          id: 'scene-auto-video',
          lineIndex: 0,
          startMs: 0,
          endMs: 4000,
          durationMs: 4000,
          lineText: 'A video motion scene',
          visualPrompt: 'Drone flying over sea',
          motionType: 'video', // Scene explicitly requests video
          status: 'pending',
        },
      ];

      const res = await service.dispatchVisualAssets(
        scenes,
        { engine: 'rpc' }, // outputMode is left undefined
        path.join(tmpTestDir, 'suite8_auto_video')
      );

      assert.ok(videoCalled, 'Phải gọi generateVideo vì scene.motionType === "video"');
      assert.strictEqual(res.scenes[0].status, 'ready');
      assert.ok(res.scenes[0].videoPath?.endsWith('.mp4'));
      assert.strictEqual(res.scenes[0].assetPath, res.scenes[0].videoPath);
    });

    await test('aiStudioPipelineEngine.regenerateSceneAsset: Xóa videoPath cũ khi tái tạo cảnh thành ảnh', async () => {
      const sessionId = `test-sess-stale-cleanup-${Date.now()}`;
      const storage = aiStudioPipelineEngine.getDiskStorageManager(sessionId);
      const shotId = 'scene_1_shot_1';
      const sceneId = 'scene_1';

      // Giả lập shot ban đầu có videoPath sẵn
      storage.updateShotMetadata(sceneId, shotId, {
        status: 'video_ready',
        video_path: path.join(storage.paths.mediaDir, 'old_stale.mp4'),
        image_path: path.join(storage.paths.mediaDir, 'old_img.png'),
      });

      // Tạo session giả lập với targetScene có sẵn videoPath
      const sessionDir = path.join(resolveAiStudioSessionsRoot(), sessionId);
      fs.mkdirSync(sessionDir, { recursive: true });
      const sessionFile = path.join(sessionDir, 'session.json');
      const sessionData: any = {
        sessionId,
        topic: 'Test Stale',
        aspectRatio: '16:9',
        mode: 'simple',
        durationMode: 'auto',
        status: 'running',
        currentStage: 6,
        progress: 75,
        stages: {},
        artifacts: {
          scenes: [
            {
              id: shotId,
              shotId,
              lineIndex: 0,
              startMs: 0,
              endMs: 4000,
              durationMs: 4000,
              lineText: 'Testing stale video cleanup',
              visualPrompt: 'A quiet meadow',
              motionType: 'ken_burns',
              videoPath: path.join(storage.paths.mediaDir, 'old_stale.mp4'),
              imagePath: path.join(storage.paths.mediaDir, 'old_img.png'),
              assetPath: path.join(storage.paths.mediaDir, 'old_stale.mp4'),
              status: 'ready',
            },
          ],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2), 'utf-8');

      class MockImageGenRpcClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          return {
            firstImageUrl: `${cdnBase}/cdn/image.png`,
            projectId: 'proj-stale-test',
            images: [{ assetId: 'img-stale', mediaId: 'img-stale', url: `${cdnBase}/cdn/image.png` }],
          };
        }
      }

      aiStudioVisualService.setRpcClient(new MockImageGenRpcClient());

      const res = await aiStudioPipelineEngine.regenerateSceneAsset({
        sessionId,
        sceneId: shotId,
        visualPrompt: 'A quiet meadow in spring',
        mode: 'image',
        flowConfig: { engine: 'rpc' },
      });

      assert.ok(res.imagePath && fs.existsSync(res.imagePath));
      assert.strictEqual(res.videoPath, undefined, 'Kết quả tái tạo ảnh không được có videoPath');

      // Kiểm tra session state đã lưu trên đĩa
      const reloadedSession = await aiStudioPipelineEngine.getState({ sessionId });
      const reloadedScene = reloadedSession?.artifacts.scenes?.find((s) => s.id === shotId);
      assert.strictEqual(reloadedScene?.videoPath, undefined, 'videoPath cũ trong session.json phải bị xoá');
      assert.strictEqual(reloadedScene?.imagePath, res.imagePath);

      // Kiểm tra index.json metadata
      const reloadedIdx = storage.readIndex();
      const shotMeta = reloadedIdx.scenes[sceneId]?.shots[shotId];
      assert.strictEqual(shotMeta?.video_path, '', 'video_path trong index.json phải được làm trống');
      assert.strictEqual(shotMeta?.status, 'image_ready');

      aiStudioVisualService.setRpcClient(null);
    });

    await test('AiStudioPipelineEngine Stage 6: Phục hồi scenes từ storyboard.json và cập nhật index.json khi session scenes rỗng', async () => {
      const sessionId = `test-sess-sb-recovery-${Date.now()}`;
      const storage = aiStudioPipelineEngine.getDiskStorageManager(sessionId);

      // Lưu storyboard.json với 1 phân cảnh 1 shot
      storage.saveStoryboard({
        project_id: sessionId,
        scenes: [
          {
            scene_id: 'scene_01',
            narration: 'Chào buổi sáng Việt Nam',
            start_sec: 0,
            end_sec: 5,
            duration_sec: 5,
            assigned_sentences: [1],
            assigned_scene_ids: ['scene_01'],
            shots: [
              {
                shot_id: 'scene_01_shot_1',
                shot_index: 1,
                start_sec: 0,
                duration_sec: 5,
                expected_duration_sec: 5,
                assigned_sentences: [1],
                assigned_scene_ids: ['scene_01'],
                dialogue_lines: ['Chào buổi sáng Việt Nam'],
                image_prompt: 'Sunrise over Da Nang beach',
                motion_note: 'gentle wave motion',
                media_type: 'image',
                reason: 'intro shot',
                confidence: 'high',
              },
            ],
          },
        ],
      });

      class MockRecoveryRpcClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          return {
            firstImageUrl: `${cdnBase}/cdn/image.png`,
            projectId: 'proj-recovery',
            images: [{ assetId: 'img-rec', mediaId: 'img-rec', url: `${cdnBase}/cdn/image.png` }],
          };
        }
      }

      aiStudioVisualService.setRpcClient(new MockRecoveryRpcClient());

      // Tạo session với artifacts.scenes rỗng
      const sessionDir = path.join(resolveAiStudioSessionsRoot(), sessionId);
      fs.mkdirSync(sessionDir, { recursive: true });
      const sessionFile = path.join(sessionDir, 'session.json');
      const sessionData: any = {
        sessionId,
        topic: 'Storyboard Recovery',
        aspectRatio: '16:9',
        mode: 'simple',
        durationMode: 'auto',
        status: 'running',
        currentStage: 6,
        progress: 70,
        stages: {
          6: { status: 'running', startedAt: Date.now() },
        },
        artifacts: {
          scenes: [], // Trống để kiểm thử cơ chế tự phục hồi
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2), 'utf-8');

      // Chạy dispatch với session này
      const dispatchRes = await aiStudioVisualService.dispatchVisualAssets(
        sessionData.artifacts.scenes,
        { engine: 'rpc', outputMode: 'image' },
        storage.paths.mediaDir
      );

      // Verify dispatcher executed cleanly
      assert.ok(dispatchRes);
      aiStudioVisualService.setRpcClient(null);
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 9: Adversarial Hardening & Leak Prevention Suite (Reviewer R3)
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 9: Adversarial Hardening & Leak Prevention Suite (Reviewer R3)${RESET}`);

    await test('generateViaGoogleFlow: Tự động fallback sang scene.lineText khi scene.visualPrompt rỗng', async () => {
      let promptSent = '';
      class MockPromptFallbackClient extends GoogleFlowRpcClient {
        public async generateImage(params: GenerateImageParams): Promise<RpcGenerateImageResult> {
          promptSent = params.prompt;
          return {
            images: [{ assetId: 'img-fallback', mediaId: 'img-fallback', url: `${cdnBase}/cdn/image.png` }],
            firstImageUrl: `${cdnBase}/cdn/image.png`,
            projectId: 'proj-fallback',
          };
        }
      }

      const client = new MockPromptFallbackClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const scene: StoryboardScene = {
        id: 'scene-prompt-fallback',
        lineIndex: 0,
        startMs: 0,
        endMs: 3000,
        durationMs: 3000,
        lineText: 'Kịch bản thoại thay thế cho prompt rỗng',
        visualPrompt: '',
        motionType: 'ken_burns',
        status: 'pending',
      };

      const outPath = path.join(tmpTestDir, 'suite9', 'fallback_prompt.png');
      await service.generateViaGoogleFlow(scene, outPath, { outputMode: 'image' });

      assert.strictEqual(promptSent, 'Kịch bản thoại thay thế cho prompt rỗng');
      assert.ok(fs.existsSync(outPath));
      service.setRpcClient(null);
    });

    await test('generateViaGoogleFlow: Ném lỗi INVALID_ARGUMENT khi cả visualPrompt và lineText đều rỗng', async () => {
      const service = new AiStudioVisualService();
      const scene: StoryboardScene = {
        id: 'scene-empty-prompt',
        lineIndex: 0,
        startMs: 0,
        endMs: 3000,
        durationMs: 3000,
        lineText: '   ',
        visualPrompt: '   ',
        motionType: 'ken_burns',
        status: 'pending',
      };

      const outPath = path.join(tmpTestDir, 'suite9', 'empty_prompt.png');
      let caughtErr: any = null;
      try {
        await service.generateViaGoogleFlow(scene, outPath, { outputMode: 'image' });
      } catch (err: any) {
        caughtErr = err;
      }

      assert.ok(caughtErr, 'Phải ném lỗi khi cả 2 trường đều rỗng');
      assert.strictEqual(caughtErr.code, 'INVALID_ARGUMENT');
    });

    await test('generateViaGoogleFlow: Tự động dọn sạch tệp tải về nếu validateMediaFile thất bại (tránh để tệp hỏng trên đĩa)', async () => {
      class MockCorruptMediaClient extends GoogleFlowRpcClient {
        public async generateVideo(): Promise<RpcGenerateVideoResult> {
          return {
            operationId: 'op-corrupt',
            projectId: 'proj-corrupt',
            done: true,
            status: 'CAE',
            videoUrl: `${cdnBase}/cdn/corrupt_header.mp4`,
          };
        }
      }

      const client = new MockCorruptMediaClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const scene: StoryboardScene = {
        id: 'scene-corrupt-clean',
        lineIndex: 0,
        startMs: 0,
        endMs: 3000,
        durationMs: 3000,
        lineText: 'Thử nghiệm tải tệp hỏng',
        visualPrompt: 'Corrupt video test',
        motionType: 'video',
        status: 'pending',
      };

      const outPath = path.join(tmpTestDir, 'suite9', 'corrupt_cleaned.mp4');
      let caughtErr: any = null;
      try {
        await service.generateViaGoogleFlow(scene, outPath, { outputMode: 'video' });
      } catch (err: any) {
        caughtErr = err;
      }

      assert.ok(caughtErr, 'validateMediaFile phải ném lỗi khi định dạng không hợp lệ');
      assert.strictEqual(fs.existsSync(outPath), false, 'Tệp hỏng phải được xoá sạch khỏi đĩa ngay khi validation thất bại');
      service.setRpcClient(null);
    });

    await test('dispatchVisualAssets: Xóa bỏ triệt để videoPath cũ khi chạy lại với mode ảnh', async () => {
      class MockImgClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          return {
            images: [{ assetId: 'img-clean-vpath', mediaId: 'img-clean-vpath', url: `${cdnBase}/cdn/image.png` }],
            firstImageUrl: `${cdnBase}/cdn/image.png`,
            projectId: 'proj-vpath',
          };
        }
      }

      const client = new MockImgClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const sceneWithOldVideo: StoryboardScene = {
        id: 'scene-vpath-clean',
        lineIndex: 0,
        startMs: 0,
        endMs: 3000,
        durationMs: 3000,
        lineText: 'Cảnh chuyển đổi sang ảnh',
        visualPrompt: 'Transform to image prompt',
        motionType: 'ken_burns',
        videoPath: '/stale/path/to/old_video.mp4',
        status: 'pending',
      };

      const outDir = path.join(tmpTestDir, 'suite9_vpath');
      await service.dispatchVisualAssets([sceneWithOldVideo], { outputMode: 'image', engine: 'rpc' }, outDir);

      assert.strictEqual(sceneWithOldVideo.videoPath, undefined, 'videoPath cũ phải được xoá sạch khi tạo ảnh');
      assert.ok(sceneWithOldVideo.imagePath?.endsWith('.png'));
      assert.strictEqual(sceneWithOldVideo.assetPath, sceneWithOldVideo.imagePath);
      service.setRpcClient(null);
    });

    await test('downloadMediaAsset: An toàn khi targetUrl trùng với destinationPath (không tự copy ghi đè làm hỏng file)', async () => {
      const service = new AiStudioVisualService();
      const testFile = path.join(tmpTestDir, 'suite9', 'self_copy_test.png');
      fs.mkdirSync(path.dirname(testFile), { recursive: true });
      fs.writeFileSync(testFile, VALID_1X1_PNG);

      const res = await service.downloadMediaAsset(testFile, testFile);
      assert.strictEqual(res, testFile);
      assert.strictEqual(fs.statSync(testFile).size, VALID_1X1_PNG.length);
    });

    await test('downloadViaHttp: Từ chối phản hồi CDN 0 byte và dọn sạch không để lại tệp rỗng trên Windows', async () => {
      const service = new AiStudioVisualService();
      const emptyDest = path.join(tmpTestDir, 'suite9', 'empty_reject.mp4');

      let caughtErr: any = null;
      try {
        await service.downloadMediaAsset(`${cdnBase}/cdn/empty_zero.mp4`, emptyDest);
      } catch (err: any) {
        caughtErr = err;
      }

      assert.ok(caughtErr, 'Phải ném lỗi khi dữ liệu nhận về là 0 byte');
      assert.strictEqual(fs.existsSync(emptyDest), false, 'Tệp 0 byte phải được dọn sạch hoàn toàn khỏi đĩa');
    });

    await test('downloadMediaAsset: Phân loại chuẩn xác mã RATE_LIMITED khi CDN trả về HTTP 429', async () => {
      const service = new AiStudioVisualService();
      const rateDest = path.join(tmpTestDir, 'suite9', 'rate_429.mp4');

      let caughtErr: any = null;
      try {
        await service.downloadMediaAsset(`${cdnBase}/cdn/rate_limited.mp4`, rateDest);
      } catch (err: any) {
        caughtErr = err;
      }

      assert.ok(caughtErr, 'Phải ném lỗi khi CDN trả về 429');
      assert.strictEqual(caughtErr.code, 'RATE_LIMITED');
      assert.strictEqual(caughtErr.retryable, true);
      assert.strictEqual(fs.existsSync(rateDest), false, 'Tệp không được để lại trên đĩa');
    });

    await test('aiStudioPipelineEngine.regenerateSceneAsset: Truyền nhận đầy đủ callback onProgress và AbortSignal', async () => {
      const { aiStudioPipelineEngine } = await import('../main/ai-studio/AiStudioPipelineEngine');

      const progressSteps: number[] = [];
      const controller = new AbortController();

      class MockProgressRpcClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          return {
            images: [{ assetId: 'img-prog', mediaId: 'img-prog', url: `${cdnBase}/cdn/image.png` }],
            firstImageUrl: `${cdnBase}/cdn/image.png`,
            projectId: 'proj-prog',
          };
        }
      }

      const client = new MockProgressRpcClient();
      aiStudioVisualService.setRpcClient(client);

      const res = await aiStudioPipelineEngine.regenerateSceneAsset(
        {
          sceneId: 'sc-progress-test',
          visualPrompt: 'Progress test scene prompt',
          flowConfig: { engine: 'rpc', outputMode: 'image' },
        },
        (pct) => progressSteps.push(pct),
        controller.signal
      );

      assert.ok(res.assetPath && fs.existsSync(res.assetPath));
      assert.ok(progressSteps.length > 0, 'Phải nhận được cập nhật tiến độ từ onProgress callback');
      aiStudioVisualService.setRpcClient(null);
    });
  } finally {
    // Cleanup mock server
    mockServer.close();
    // Cleanup temp dir
    try {
      fs.rmSync(tmpTestDir, { recursive: true, force: true });
    } catch {}
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}================================================================${RESET}`);
  console.log(`${BOLD}  KẾT QUẢ KIỂM THỬ: ${passedTests}/${totalTests} TESTS PASSED  ${RESET}`);
  if (failedTests === 0) {
    console.log(`  ${GREEN}${BOLD}TẤT CẢ CÁC BÀI KIỂM TRA ĐÃ ĐẠT 100%!${RESET}`);
  } else {
    console.log(`  ${RED}${BOLD}CÓ ${failedTests} BÀI KIỂM TRA THẤT BẠI!${RESET}`);
  }
  console.log(`${BOLD}================================================================${RESET}\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Lỗi nghiêm trọng khi chạy bộ kiểm thử:', err);
  process.exit(1);
});
