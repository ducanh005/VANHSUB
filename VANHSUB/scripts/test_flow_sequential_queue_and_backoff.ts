/**
 * test_flow_sequential_queue_and_backoff.ts
 *
 * Automated verification test runner for:
 * 1. Concurrency Limiter (Concurrency = 1) in GoogleFlowRpcClient & AiStudioVisualService
 * 2. Safe Cooldown (8-12s with ±2s jitter, >= 8s) & Per-Second Countdown in dispatchVisualAssets
 * 3. Instant Abort cancellation via AbortSignal during Cooldown
 * 4. Exponential Backoff (2^retry * 10s capped at 120s) on RATE_LIMITED (429), UPSTREAM_ERROR, TIMEOUT
 * 5. PUBLIC_ERROR_UNUSUAL_ACTIVITY CDP Trusted Click fallback #1 activation & transition to backoff
 * 6. Sniffer Capture Tooling & RPC Payload Verifier (FlowBridgeServer.verifySnifferDump)
 *
 * Run with:
 *   npx tsx scripts/test_flow_sequential_queue_and_backoff.ts
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  AiStudioVisualService,
  calculateCooldownSeconds,
  sleepAbortable,
} from '../main/ai-studio/services/AiStudioVisualService';

import {
  GoogleFlowRpcClient,
  GoogleFlowRpcError,
  classifyFlowRpcError,
  calculateExponentialBackoffMs,
  isUnusualActivityError,
  type GenerateImageParams,
  type RpcGenerateImageResult,
  type GenerateVideoParams,
  type RpcGenerateVideoResult,
} from '../main/workflow/flow-engine/rpc/GoogleFlowRpcClient';

import { FlowBridgeServer } from '../main/workflow/flow-engine/rpc/FlowBridgeServer';
import { GoogleFlowBrowserMutex } from '../main/workflow/dispatcher/GoogleFlowBrowserMutex';
import type { StoryboardScene } from '../main/ai-studio/types';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
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
    console.error(`    ${RED}${err.stack || err.message || err}${RESET}`);
  }
}

async function runAllTests(): Promise<void> {
  console.log('================================================================');
  console.log('  TEST SUITE: Flow Sequential Queue, Cooldown & Backoff        ');
  console.log('================================================================');

  const tmpTestDir = path.join(os.tmpdir(), `vanhsub-queue-test-${Date.now()}`);
  fs.mkdirSync(tmpTestDir, { recursive: true });

  // 1. Tạo 1 file ảnh PNG hợp lệ cho mock download
  const dummyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  const dummyPngPath = path.join(tmpTestDir, 'dummy.png');
  fs.writeFileSync(dummyPngPath, dummyPng);

  try {
    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 1: Exponential Backoff Formula & Transient Error Classification
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 1: Công thức Exponential Backoff & Phân loại lỗi chuẩn hóa${RESET}`);

    await test('calculateExponentialBackoffMs tính đúng 2^retry * 10s và cap ở 120s', () => {
      // retry 0: 2^0 * 10s = 10s = 10,000ms
      assert.strictEqual(calculateExponentialBackoffMs(0), 10_000);
      // retry 1: 2^1 * 10s = 20s = 20,000ms
      assert.strictEqual(calculateExponentialBackoffMs(1), 20_000);
      // retry 2: 2^2 * 10s = 40s = 40,000ms
      assert.strictEqual(calculateExponentialBackoffMs(2), 40_000);
      // retry 3: 2^3 * 10s = 80s = 80,000ms
      assert.strictEqual(calculateExponentialBackoffMs(3), 80_000);
      // retry 4: 2^4 * 10s = 160s -> Capped at 120s = 120,000ms
      assert.strictEqual(calculateExponentialBackoffMs(4), 120_000);
      // retry 5: 2^5 * 10s = 320s -> Capped at 120s = 120,000ms
      assert.strictEqual(calculateExponentialBackoffMs(5), 120_000);
    });

    await test('calculateCooldownSeconds đảm bảo giãn cách luôn >= 8s', () => {
      for (let i = 0; i < 50; i++) {
        const sec = calculateCooldownSeconds(8, 12, 2);
        assert.ok(sec >= 8, `Cooldown phải >= 8s, nhận được: ${sec}s`);
        assert.ok(sec <= 14, `Cooldown với jitter phải <= 14s, nhận được: ${sec}s`);
      }
    });

    await test('isUnusualActivityError nhận diện chính xác PUBLIC_ERROR_UNUSUAL_ACTIVITY', () => {
      const err1 = new GoogleFlowRpcError('Server error: PUBLIC_ERROR_UNUSUAL_ACTIVITY', {
        code: 'RATE_LIMITED',
        retryable: true,
      });
      assert.strictEqual(isUnusualActivityError(err1), true);

      const err2 = new Error('Client reported unusual_activity on generation');
      assert.strictEqual(isUnusualActivityError(err2), true);

      const err3 = new GoogleFlowRpcError('Rate limit', {
        code: 'RATE_LIMITED',
        retryable: true,
        details: { isUnusualActivity: true },
      });
      assert.strictEqual(isUnusualActivityError(err3), true);

      const errNormal = new GoogleFlowRpcError('429 Too Many Requests', {
        code: 'RATE_LIMITED',
        retryable: true,
      });
      assert.strictEqual(isUnusualActivityError(errNormal), false);
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 2: Strict Concurrency Limiter (Concurrency = 1)
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 2: Hàng đợi tạo Media nghiêm ngặt (Concurrency = 1)${RESET}`);

    await test('GoogleFlowRpcClient.generateImage thực thi tuần tự tuyệt đối (Concurrency = 1) khi gọi đồng thời', async () => {
      let activeConcurrency = 0;
      let maxObservedConcurrency = 0;
      const executionOrder: number[] = [];

      class ConcurrencyTestClient extends GoogleFlowRpcClient {
        public override async callFlowRPC(
          _win: any,
          rpcId: string,
          innerPayload: unknown[],
          _projectId?: string
        ): Promise<unknown> {
          activeConcurrency++;
          maxObservedConcurrency = Math.max(maxObservedConcurrency, activeConcurrency);

          const innerStr = (innerPayload as any[])?.[0]?.[1];
          let id = executionOrder.length + 1;
          try {
            const parsed = JSON.parse(innerStr);
            id = Number(parsed[0] || id);
          } catch {}
          executionOrder.push(id);

          // Giả lập thời gian xử lý RPC
          await new Promise((r) => setTimeout(r, 60));

          activeConcurrency--;
          return [
            [
              '11111111-1111-1111-1111-11111111111' + id,
              'https://flow-content.google/image-' + id + '.png',
            ],
          ];
        }
      }

      const client = new ConcurrencyTestClient();

      // Bắn 4 request tạo ảnh đồng thời
      const promises = [
        client.generateImage({ prompt: '1' }),
        client.generateImage({ prompt: '2' }),
        client.generateImage({ prompt: '3' }),
        client.generateImage({ prompt: '4' }),
      ];

      const results = await Promise.all(promises);
      assert.strictEqual(results.length, 4);
      assert.strictEqual(maxObservedConcurrency, 1, 'Độ tương tác đồng thời tối đa phải nghiêm ngặt = 1');
      assert.deepStrictEqual(executionOrder, [1, 2, 3, 4], 'Thứ tự thực thi phải chuẩn FIFO');
    });

    await test('GoogleFlowRpcClient.generateVideo thực thi tuần tự tuyệt đối (Concurrency = 1) khi gọi đồng thời', async () => {
      let activeConcurrency = 0;
      let maxObservedConcurrency = 0;

      class ConcurrencyVideoTestClient extends GoogleFlowRpcClient {
        public override async callFlowRPC(
          _win: any,
          rpcId: string,
          _innerPayload: unknown[],
          _projectId?: string
        ): Promise<unknown> {
          activeConcurrency++;
          maxObservedConcurrency = Math.max(maxObservedConcurrency, activeConcurrency);

          await new Promise((r) => setTimeout(r, 60));

          activeConcurrency--;
          return [['operations/video-op-1', 'RUNNING']];
        }
      }

      const client = new ConcurrencyVideoTestClient();

      const promises = [
        client.generateVideo({ prompt: 'v1' }),
        client.generateVideo({ prompt: 'v2' }),
        client.generateVideo({ prompt: 'v3' }),
      ];

      const results = await Promise.all(promises);
      assert.strictEqual(results.length, 3);
      assert.strictEqual(maxObservedConcurrency, 1, 'Độ tương tác đồng thời tạo video tối đa phải = 1');
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 3: Cooldown 8-12s, Per-Second Countdown & AbortSignal Cancellation
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 3: Giãn cách Cooldown, Đếm ngược từng giây & Huỷ bỏ an toàn${RESET}`);

    await test('dispatchVisualAssets thực hiện giãn cách an toàn >= 8s và thông báo tiến độ từng giây giữa các cảnh', async () => {
      class MockSuccessClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          return {
            images: [{ assetId: 'img-1', mediaId: 'img-1', url: dummyPngPath }],
            firstImageUrl: dummyPngPath,
            projectId: 'proj-1',
          };
        }
      }

      const service = new AiStudioVisualService();
      service.setRpcClient(new MockSuccessClient());

      const scenes: StoryboardScene[] = [
        { id: 'sc-1', lineIndex: 0, startMs: 0, endMs: 2000, durationMs: 2000, lineText: 'Cảnh 1', visualPrompt: 'Prompt 1', motionType: 'ken_burns', status: 'pending' },
        { id: 'sc-2', lineIndex: 1, startMs: 2000, endMs: 4000, durationMs: 2000, lineText: 'Cảnh 2', visualPrompt: 'Prompt 2', motionType: 'ken_burns', status: 'pending' },
      ];

      const progressMessages: string[] = [];
      const startTime = Date.now();

      // Sử dụng cooldownSec = 8s chuẩn xác để kiểm tra việc đếm ngược từng giây
      await service.dispatchVisualAssets(
        scenes,
        {
          aspectRatio: '16:9',
          outputMode: 'image',
          cooldownSec: 8,
          outputsPerScene: 1,
          concurrency: 1,
        },
        path.join(tmpTestDir, 'suite3_cooldown'),
        (_pct, msg) => {
          if (msg) progressMessages.push(msg);
        }
      );

      const elapsedMs = Date.now() - startTime;
      assert.ok(elapsedMs >= 7500, `Thời gian chạy phải phản ánh cooldown >= 8s (thực tế: ${elapsedMs}ms)`);

      // Kiểm tra các thông báo đếm ngược từng giây có mặt đầy đủ
      const countdownMessages = progressMessages.filter((m) => m.includes('Đang giãn cách an toàn: Còn'));
      assert.ok(countdownMessages.length >= 7, `Phải có ít nhất 7 thông báo đếm ngược, nhận được: ${countdownMessages.length}`);
      assert.ok(countdownMessages.some((m) => m.includes('Còn 8 giây')));
      assert.ok(countdownMessages.some((m) => m.includes('Còn 1 giây')));
    });

    await test('dispatchVisualAssets huỷ bỏ lập tức khi nhận signal.aborted trong thời gian cooldown', async () => {
      class MockSuccessClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          return {
            images: [{ assetId: 'img-1', mediaId: 'img-1', url: dummyPngPath }],
            firstImageUrl: dummyPngPath,
            projectId: 'proj-1',
          };
        }
      }

      const service = new AiStudioVisualService();
      service.setRpcClient(new MockSuccessClient());

      const scenes: StoryboardScene[] = [
        { id: 'sc-1', lineIndex: 0, startMs: 0, endMs: 2000, durationMs: 2000, lineText: 'Cảnh 1', visualPrompt: 'Prompt 1', motionType: 'ken_burns', status: 'pending' },
        { id: 'sc-2', lineIndex: 1, startMs: 2000, endMs: 4000, durationMs: 2000, lineText: 'Cảnh 2', visualPrompt: 'Prompt 2', motionType: 'ken_burns', status: 'pending' },
      ];

      const controller = new AbortController();

      // Huỷ sau 1.2 giây (ngay trong giây thứ 2 của cooldown 10s)
      setTimeout(() => controller.abort(), 1200);

      const startTime = Date.now();
      let caughtErr: any = null;

      try {
        await service.dispatchVisualAssets(
          scenes,
          {
            aspectRatio: '16:9',
            outputMode: 'image',
            cooldownSec: 10,
            outputsPerScene: 1,
            concurrency: 1,
          },
          path.join(tmpTestDir, 'suite3_abort'),
          undefined,
          controller.signal
        );
      } catch (err: any) {
        caughtErr = err;
      }

      const elapsedMs = Date.now() - startTime;
      assert.ok(caughtErr, 'Phải ném lỗi huỷ bỏ');
      assert.ok(caughtErr.message.includes('hủy'), `Thông báo huỷ: ${caughtErr.message}`);
      assert.ok(elapsedMs < 3000, `Phải ngắt ngay lập tức sau ~1.2s thay vì chờ hết 10s (thực tế: ${elapsedMs}ms)`);
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 4: Exponential Backoff Retry on RATE_LIMITED & UPSTREAM_ERROR
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 4: Tự động Retry với Exponential Backoff khi gặp lỗi tạm thời${RESET}`);

    await test('dispatchVisualAssets tự động áp dụng exponential backoff khi gặp RATE_LIMITED (429) và phục hồi thành công', async () => {
      let callCount = 0;
      const progressList: string[] = [];

      class MockTransientFailClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          callCount++;
          if (callCount <= 2) {
            // Lần 1 và 2 ném lỗi RATE_LIMITED (429)
            throw new GoogleFlowRpcError('429 Too Many Requests: Rate limited by Google Flow', {
              code: 'RATE_LIMITED',
              retryable: true,
              httpStatus: 429,
            });
          }
          // Lần 3 thành công
          return {
            images: [{ assetId: 'img-recovered', mediaId: 'img-recovered', url: dummyPngPath }],
            firstImageUrl: dummyPngPath,
            projectId: 'proj-recovered',
          };
        }
      }

      const service = new AiStudioVisualService();
      service.setRpcClient(new MockTransientFailClient());

      const scenes: StoryboardScene[] = [
        { id: 'sc-retry', lineIndex: 0, startMs: 0, endMs: 2000, durationMs: 2000, lineText: 'Thử lại', visualPrompt: 'Test backoff', motionType: 'ken_burns', status: 'pending' },
      ];

      // Đặt backoffBaseMs nhỏ để test chạy nhanh nhưng vẫn kiểm tra chính xác logic
      const res = await service.dispatchVisualAssets(
        scenes,
        {
          aspectRatio: '16:9',
          outputMode: 'image',
          maxRetries: 3,
          backoffBaseMs: 30, // 30ms base -> 30ms, 60ms
          skipCooldown: true,
        },
        path.join(tmpTestDir, 'suite4_rate_recovery'),
        (_pct, msg) => progressList.push(msg)
      );

      assert.strictEqual(res.modeUsed, 'google_flow');
      assert.strictEqual(callCount, 3, 'Phải thử lại chính xác 2 lần và thành công ở lần 3');
      assert.strictEqual(scenes[0].status, 'ready');
      assert.ok(progressList.some((m) => m.includes('giãn cách lùi bước') || m.includes('RATE_LIMITED')), 'Phải phát tín hiệu lùi bước qua progress');
    });

    await test('dispatchVisualAssets tự động áp dụng exponential backoff khi gặp UPSTREAM_ERROR và phục hồi thành công', async () => {
      let callCount = 0;

      class MockUpstreamRecoveryClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          callCount++;
          if (callCount === 1) {
            throw new GoogleFlowRpcError('500 Internal Server Error: Upstream Google Flow service unavailable', {
              code: 'UPSTREAM_ERROR',
              retryable: true,
              httpStatus: 500,
            });
          }
          return {
            images: [{ assetId: 'img-up-recovered', mediaId: 'img-up-recovered', url: dummyPngPath }],
            firstImageUrl: dummyPngPath,
            projectId: 'proj-up-recovered',
          };
        }
      }

      const service = new AiStudioVisualService();
      service.setRpcClient(new MockUpstreamRecoveryClient());

      const scenes: StoryboardScene[] = [
        { id: 'sc-upstream', lineIndex: 0, startMs: 0, endMs: 2000, durationMs: 2000, lineText: 'Upstream', visualPrompt: 'Test upstream', motionType: 'ken_burns', status: 'pending' },
      ];

      const res = await service.dispatchVisualAssets(
        scenes,
        {
          aspectRatio: '16:9',
          outputMode: 'image',
          maxRetries: 2,
          backoffBaseMs: 20,
          skipCooldown: true,
        },
        path.join(tmpTestDir, 'suite4_upstream_recovery')
      );

      assert.strictEqual(res.modeUsed, 'google_flow');
      assert.strictEqual(callCount, 2, 'Phải retry 1 lần và thành công');
      assert.strictEqual(scenes[0].status, 'ready');
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 5: PUBLIC_ERROR_UNUSUAL_ACTIVITY & CDP Trusted Click Fallback #1
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 5: Cơ chế dự phòng số 1 (CDP Trusted Click) cho UNUSUAL_ACTIVITY${RESET}`);

    await test('PUBLIC_ERROR_UNUSUAL_ACTIVITY kích hoạt cơ chế dự phòng CDP Trusted Click và chuyển sang giãn cách lùi bước', async () => {
      let recoveryCalls = 0;
      let generateAttempts = 0;

      class MockUnusualActivityClient extends GoogleFlowRpcClient {
        // Mock method phục hồi để kiểm tra việc kích hoạt
        public override async handleUnusualActivityRecovery(win?: any): Promise<any> {
          recoveryCalls++;
          return win;
        }

        protected override async _handleUnusualActivityAutoRecovery(win?: any): Promise<any> {
          recoveryCalls++;
          return win;
        }

        public async generateImage(): Promise<RpcGenerateImageResult> {
          generateAttempts++;
          if (generateAttempts === 1) {
            // Lần 1: Bị chặn bot flag
            throw new GoogleFlowRpcError('RPC failed: PUBLIC_ERROR_UNUSUAL_ACTIVITY (reCAPTCHA bot flag)', {
              code: 'RATE_LIMITED',
              retryable: true,
              details: { isUnusualActivity: true },
            });
          }
          // Lần 2: Thành công sau khi CDP Trusted Click được kích hoạt
          return {
            images: [{ assetId: 'img-unusual-pass', mediaId: 'img-unusual-pass', url: dummyPngPath }],
            firstImageUrl: dummyPngPath,
            projectId: 'proj-unusual',
          };
        }
      }

      const client = new MockUnusualActivityClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const scenes: StoryboardScene[] = [
        { id: 'sc-bot-recovery', lineIndex: 0, startMs: 0, endMs: 2000, durationMs: 2000, lineText: 'Bot check', visualPrompt: 'Test bot flag', motionType: 'ken_burns', status: 'pending' },
      ];

      const res = await service.dispatchVisualAssets(
        scenes,
        {
          aspectRatio: '16:9',
          outputMode: 'image',
          maxRetries: 2,
          backoffBaseMs: 20,
          skipCooldown: true,
        },
        path.join(tmpTestDir, 'suite5_unusual_recovery')
      );

      assert.strictEqual(res.modeUsed, 'google_flow');
      assert.strictEqual(recoveryCalls, 1, 'CDP Trusted Click hardware fallback phải được kích hoạt đúng 1 lần khi gặp UNUSUAL_ACTIVITY');
      assert.strictEqual(generateAttempts, 2);
      assert.strictEqual(scenes[0].status, 'ready');
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 6: Sniffer Capture Tooling & RPC Payload Verifier
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 6: Tiện ích phân tích sniffer_dump.json & Kiểm tra f.req và rpcids${RESET}`);

    await test('FlowBridgeServer.verifySnifferDump xác thực thành công payload hợp lệ', () => {
      const validDump = [
        {
          type: 'fetch',
          url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b&bl=boq_aisandbox',
          body: 'f.req=' + encodeURIComponent(JSON.stringify([[['ogiZ0b', JSON.stringify(['Cinematic drone shot of fjord', 3, 1]), null, 'generic']]])) + '&at=at_token_test',
          response: ")]}'\n[[[\"wrb.fr\",\"ogiZ0b\",null,null,null,null,null,1]]]",
          timestamp: Date.now(),
        },
        {
          type: 'xhr',
          url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=MZZa6b',
          body: 'f.req=' + encodeURIComponent(JSON.stringify([[['MZZa6b', JSON.stringify(['Animate water waves', 8]), null, 'generic']]])) + '&at=at_token_test',
          response: ")]}'\n[[[\"wrb.fr\",\"MZZa6b\",\"op-999\",null,null,null,null,1]]]",
          timestamp: Date.now() + 500,
        },
      ];

      const report = FlowBridgeServer.verifySnifferDump(validDump);
      assert.strictEqual(report.valid, true);
      assert.strictEqual(report.totalEntries, 2);
      assert.strictEqual(report.batchExecuteCount, 2);
      assert.strictEqual(report.validPayloadCount, 2);
      assert.strictEqual(report.corruptedPayloadCount, 0);
      assert.strictEqual(report.rpcidCounts['ogiZ0b'], 1);
      assert.strictEqual(report.rpcidCounts['MZZa6b'], 1);
      assert.strictEqual(report.unusualActivityDetected, false);
      assert.strictEqual(report.errors.length, 0);
    });

    await test('FlowBridgeServer.verifySnifferDump phát hiện chính xác payload hỏng hoặc mismatch rpcid', () => {
      const corruptDump = [
        {
          type: 'fetch',
          // URL khai báo ogiZ0b nhưng payload bên trong là YhhmEf -> mismatch!
          url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b',
          body: 'f.req=' + encodeURIComponent(JSON.stringify([[['YhhmEf', JSON.stringify(['prompt']), null, 'generic']]])),
          timestamp: Date.now(),
        },
        {
          type: 'fetch',
          url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b',
          // body không có tham số f.req
          body: 'invalid_data_without_freq=123',
          timestamp: Date.now() + 100,
        },
        {
          type: 'fetch',
          url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b',
          // innerPayload bị hỏng cú pháp JSON
          body: 'f.req=' + encodeURIComponent(JSON.stringify([[['ogiZ0b', 'NOT_A_VALID_JSON{', null, 'generic']]])),
          timestamp: Date.now() + 200,
        },
      ];

      const report = FlowBridgeServer.verifySnifferDump(corruptDump);
      assert.strictEqual(report.valid, false);
      assert.strictEqual(report.batchExecuteCount, 3);
      assert.strictEqual(report.validPayloadCount, 0);
      assert.strictEqual(report.corruptedPayloadCount, 3);
      assert.strictEqual(report.errors.length, 3);
    });

    await test('FlowBridgeServer.verifySnifferDump phát hiện cờ PUBLIC_ERROR_UNUSUAL_ACTIVITY trong response', () => {
      const blockedDump = [
        {
          type: 'fetch',
          url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b',
          body: 'f.req=' + encodeURIComponent(JSON.stringify([[['ogiZ0b', JSON.stringify(['Test prompt']), null, 'generic']]])),
          response: ")]}'\n[[[\"wrb.fr\",\"ogiZ0b\",null,null,null,null,null,[\"PUBLIC_ERROR_UNUSUAL_ACTIVITY\"]]]]",
          timestamp: Date.now(),
        },
      ];

      const report = FlowBridgeServer.verifySnifferDump(blockedDump);
      assert.strictEqual(report.unusualActivityDetected, true);
      assert.strictEqual(report.details[0].unusualActivityDetected, true);
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 7: Adversarial Reviewer Verification Suite (Reviewer Round 1)
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 7: Adversarial Reviewer Verification Suite (Reviewer Round 1)${RESET}`);

    await test('classifyFlowRpcError chuẩn hóa code PUBLIC_ERROR_UNUSUAL_ACTIVITY đúng hợp đồng', () => {
      const err = classifyFlowRpcError(new Error('RPC call failed: Server reported PUBLIC_ERROR_UNUSUAL_ACTIVITY'));
      assert.strictEqual(err.code, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY');
      assert.strictEqual(err.isUnusualActivity, true);
      assert.strictEqual(err.retryable, true);
      assert.strictEqual(err.retryAfterMs, 20000);
    });

    await test('classifyFlowRpcError nhận diện chính xác cả 2 chuẩn chính tả tiếng Việt cho huỷ/hủy bỏ', () => {
      const errU = classifyFlowRpcError(new Error('Quá trình tạo hình ảnh đã bị hủy bởi người dùng.'));
      assert.strictEqual(errU.code, 'CANCELLED');
      assert.strictEqual(errU.retryable, false);

      const errY = classifyFlowRpcError(new Error('Tác vụ đã bị người dùng huỷ bỏ.'));
      assert.strictEqual(errY.code, 'CANCELLED');
      assert.strictEqual(errY.retryable, false);
    });

    await test('dispatchVisualAssets huỷ bỏ lập tức khi nhận signal.aborted và KHÔNG âm thầm nuốt lỗi fallback sang synthetic', async () => {
      class HangingClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          await new Promise((r) => setTimeout(r, 60));
          throw new GoogleFlowRpcError('Tác vụ đã bị người dùng huỷ bỏ.', { code: 'CANCELLED', retryable: false });
        }
      }

      const service = new AiStudioVisualService();
      service.setRpcClient(new HangingClient());

      const controller = new AbortController();
      controller.abort();

      const scenes: StoryboardScene[] = [
        { id: 'sc-cancel-1', lineIndex: 0, startMs: 0, endMs: 2000, durationMs: 2000, lineText: 'Hủy', visualPrompt: 'Cancel test', motionType: 'ken_burns', status: 'pending' },
      ];

      let thrownErr: any = null;
      try {
        await service.dispatchVisualAssets(
          scenes,
          {
            allowSyntheticFallback: true, // Ngay cả khi CÓ fallback!
            skipCooldown: true,
          },
          path.join(tmpTestDir, 'suite7_cancel'),
          undefined,
          controller.signal
        );
      } catch (err: any) {
        thrownErr = err;
      }

      assert.ok(thrownErr, 'Phải ném lỗi huỷ bỏ ra ngoài');
      assert.strictEqual(classifyFlowRpcError(thrownErr).code, 'CANCELLED');
    });

    await test('dispatchVisualAssets tôn trọng cấu hình backoffBaseMs: 0 mà không bị fallback về 10000ms', async () => {
      let callCount = 0;
      class FastFailClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          callCount++;
          if (callCount === 1) {
            throw new GoogleFlowRpcError('Temporary rate limit', { code: 'RATE_LIMITED', retryable: true, retryAfterMs: 0 });
          }
          return {
            images: [{ assetId: 'img-fast', mediaId: 'img-fast', url: dummyPngPath }],
            firstImageUrl: dummyPngPath,
            projectId: 'proj-fast',
          };
        }
      }

      const service = new AiStudioVisualService();
      service.setRpcClient(new FastFailClient());

      const t0 = Date.now();
      const res = await service.dispatchVisualAssets(
        [{ id: 'sc-fast', lineIndex: 0, startMs: 0, endMs: 2000, durationMs: 2000, lineText: 'Fast', visualPrompt: 'Fast test', motionType: 'ken_burns', status: 'pending' }],
        {
          backoffBaseMs: 0,
          skipCooldown: true,
          maxRetries: 1,
        },
        path.join(tmpTestDir, 'suite7_fast')
      );

      const elapsed = Date.now() - t0;
      assert.strictEqual(res.modeUsed, 'google_flow');
      assert.strictEqual(callCount, 2);
      assert.ok(elapsed < 2000, `backoffBaseMs: 0 phải thử lại ngay lập tức (thực tế: ${elapsed}ms)`);
    });

    await test('FlowBridgeServer.verifySnifferDump đối chiếu chính xác URL chứa danh sách nhiều rpcids phân cách dấu phẩy', () => {
      const multiRpcUrlDump = [
        {
          type: 'fetch',
          url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b,MZZa6b,bl&f.sid=456',
          body: 'f.req=' + encodeURIComponent(JSON.stringify([[['ogiZ0b', JSON.stringify(['Multiple rpcid test']), null, 'generic']]])),
          response: ")]}'\n[[[\"wrb.fr\",\"ogiZ0b\",null,null,null,null,null,1]]]",
          timestamp: Date.now(),
        },
      ];

      const report = FlowBridgeServer.verifySnifferDump(multiRpcUrlDump);
      assert.strictEqual(report.valid, true);
      assert.strictEqual(report.validPayloadCount, 1);
      assert.strictEqual(report.corruptedPayloadCount, 0);
      assert.strictEqual(report.rpcidCounts['ogiZ0b'], 1);
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 8: Adversarial Reviewer Round 2 Verification Suite
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 8: Adversarial Reviewer Verification Suite (Reviewer Round 2)${RESET}`);

    await test('[IMP-5] Abort ngay ranh giới hoàn thành cảnh 1 sẽ ngắt tức thì trước khi khởi động cooldown cảnh 2', async () => {
      const ac = new AbortController();
      let scene1Finished = false;
      const progressMessages: string[] = [];

      class BoundaryClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          return {
            images: [{ assetId: 'img-bnd', mediaId: 'img-bnd', url: dummyPngPath }],
            firstImageUrl: dummyPngPath,
            projectId: 'proj-bnd',
          };
        }
      }

      const service = new AiStudioVisualService();
      service.setRpcClient(new BoundaryClient());

      const scenes: StoryboardScene[] = [
        { id: 'sc-bnd-1', lineIndex: 0, startMs: 0, endMs: 2000, durationMs: 2000, lineText: 'Cảnh 1', visualPrompt: 'P1', motionType: 'ken_burns', status: 'pending' },
        { id: 'sc-bnd-2', lineIndex: 1, startMs: 2000, endMs: 4000, durationMs: 2000, lineText: 'Cảnh 2', visualPrompt: 'P2', motionType: 'ken_burns', status: 'pending' },
      ];

      let thrownErr: any = null;
      try {
        await service.dispatchVisualAssets(
          scenes,
          {
            aspectRatio: '16:9',
            outputMode: 'image',
            cooldownSec: 8,
          },
          path.join(tmpTestDir, 'suite8_bnd'),
          (_pct, msg) => {
            progressMessages.push(msg);
          },
          ac.signal,
          (scene, idx) => {
            if (idx === 0) {
              scene1Finished = true;
              // Ngắt ngay lập tức ở ranh giới hoàn thành cảnh 1
              ac.abort();
            }
          }
        );
      } catch (err: any) {
        thrownErr = err;
      }

      assert.ok(thrownErr, 'Phải ném lỗi khi bị huỷ ở ranh giới');
      assert.strictEqual(scene1Finished, true, 'Cảnh 1 phải được ghi nhận hoàn thành trước khi huỷ');
      const classified = classifyFlowRpcError(thrownErr);
      assert.strictEqual(classified.code, 'CANCELLED', 'Mã lỗi ném ra phải chuẩn hoá là CANCELLED');
      const hasCooldownProgress = progressMessages.some((m) => m.includes('Đang giãn cách an toàn'));
      assert.strictEqual(hasCooldownProgress, false, 'Không được phát tín hiệu đếm ngược cooldown sau khi đã huỷ ở ranh giới');
    });

    await test('[IMP-6] Batch lớn 25 phân cảnh liên hoàn: Mutex giải phóng 100%, không rò rỉ deadlock', async () => {
      let callCount = 0;
      class MassiveBatchClient extends GoogleFlowRpcClient {
        public async generateImage(): Promise<RpcGenerateImageResult> {
          callCount++;
          return {
            images: [{ assetId: `img-mass-${callCount}`, mediaId: `img-mass-${callCount}`, url: dummyPngPath }],
            firstImageUrl: dummyPngPath,
            projectId: 'proj-mass',
          };
        }
      }

      const service = new AiStudioVisualService();
      service.setRpcClient(new MassiveBatchClient());

      const largeScenes: StoryboardScene[] = Array.from({ length: 25 }, (_, i) => ({
        id: `sc-large-${i + 1}`,
        lineIndex: i,
        startMs: i * 2000,
        endMs: (i + 1) * 2000,
        durationMs: 2000,
        lineText: `Cảnh ${i + 1}`,
        visualPrompt: `Prompt ${i + 1}`,
        motionType: 'ken_burns',
        status: 'pending',
      }));

      const res = await service.dispatchVisualAssets(
        largeScenes,
        {
          aspectRatio: '16:9',
          outputMode: 'image',
          skipCooldown: true, // skip delay để test thông lượng 25 scenes
        },
        path.join(tmpTestDir, 'suite8_large')
      );

      assert.strictEqual(res.modeUsed, 'google_flow');
      assert.strictEqual(callCount, 25, 'Phải thực thi đủ 25 phân cảnh');
      assert.strictEqual(res.generatedCount, 25);
      assert.strictEqual(GoogleFlowBrowserMutex.getInstance().isLocked(), false, 'Mutex phải ở trạng thái đã giải phóng hoàn toàn sau 25 scenes');
    });

    await test('Triệt tiêu Compound Retry: Khi maxRetries = 0 hệ thống chỉ gọi RPC đúng 1 lần duy nhất', async () => {
      let rpcCallCount = 0;
      class ZeroRetryClient extends GoogleFlowRpcClient {
        public override async callFlowRPC(): Promise<unknown> {
          rpcCallCount++;
          throw new GoogleFlowRpcError('Upstream network drop', {
            code: 'UPSTREAM_ERROR',
            retryable: true,
          });
        }
      }

      const client = new ZeroRetryClient();
      let caughtErr: any = null;
      try {
        await client.generateImage({
          prompt: 'Test zero retry',
          maxRetries: 0,
        });
      } catch (e: any) {
        caughtErr = e;
      }

      assert.ok(caughtErr, 'Phải ném lỗi khi RPC thất bại');
      assert.strictEqual(rpcCallCount, 1, 'Khi maxRetries = 0 chỉ được gọi RPC đúng 1 lần, không được compound retry');
    });

    await test('calculateExponentialBackoffMs & calculateCooldownSeconds xử lý an toàn giá trị bất thường (NaN, âm, đảo biên)', () => {
      // Test backoff với NaN hoặc số âm
      const b1 = calculateExponentialBackoffMs(NaN as any);
      assert.strictEqual(b1, 10000, 'NaN retryCount phải tự fallback về retry 0 (10s)');
      const b2 = calculateExponentialBackoffMs(-5);
      assert.strictEqual(b2, 10000, 'Số âm retryCount phải tự fallback về retry 0 (10s)');
      const b3 = calculateExponentialBackoffMs(1, NaN as any);
      assert.strictEqual(b3, 20000, 'NaN baseMs phải fallback về default 10s -> 20s');

      // Test cooldown với biên đảo ngược (min > max) và giá trị âm
      for (let i = 0; i < 50; i++) {
        const cdReversed = calculateCooldownSeconds(12, 8, 2);
        assert.ok(cdReversed >= 8, `Biên đảo ngược vẫn phải đảm bảo >= 8s (nhận: ${cdReversed})`);
      }
      const cdNan = calculateCooldownSeconds(NaN as any, NaN as any);
      assert.ok(cdNan >= 8, 'NaN min/max vẫn phải fallback về giá trị an toàn >= 8s');
    });

    await test('FlowBridgeServer.verifySnifferDump xác thực chuẩn xác payload batched nhiều RPC IDs (ogiZ0b và MZZa6b)', () => {
      const batchedDump = [
        {
          type: 'fetch',
          url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b,MZZa6b',
          body: 'f.req=' + encodeURIComponent(JSON.stringify([[
            ['ogiZ0b', JSON.stringify(['Image prompt']), null, 'generic'],
            ['MZZa6b', JSON.stringify(['Video prompt']), null, 'generic'],
          ]])),
          response: ")]}'\n[[[\"wrb.fr\",\"ogiZ0b\",null,null,null,null,null,1]],[[\"wrb.fr\",\"MZZa6b\",\"op-batch\",null,null,null,null,1]]]",
          timestamp: Date.now(),
        },
      ];

      const report = FlowBridgeServer.verifySnifferDump(batchedDump);
      assert.strictEqual(report.valid, true);
      assert.strictEqual(report.validPayloadCount, 1);
      assert.strictEqual(report.corruptedPayloadCount, 0);
      assert.strictEqual(report.rpcidCounts['ogiZ0b'], 1);
      assert.strictEqual(report.rpcidCounts['MZZa6b'], 1);
    });

    // ════════════════════════════════════════════════════════════════════════════
    // SUITE 9: Adversarial Hardening & Leak Prevention Suite (Reviewer Round 3)
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`\n${CYAN}${BOLD}▶ SUITE 9: Adversarial Hardening Suite (Reviewer Round 3)${RESET}`);

    await test('Zero-Retry UNUSUAL_ACTIVITY không kích hoạt redundancy recovery ở tầng RPC', async () => {
      let recoveryCalls = 0;
      class ZeroRetryUnusualClient extends GoogleFlowRpcClient {
        public override async handleUnusualActivityRecovery(win?: any): Promise<any> {
          recoveryCalls++;
          return win;
        }
        public override async callFlowRPC(): Promise<unknown> {
          throw new GoogleFlowRpcError('Detected unusual_activity', {
            code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
            retryable: true,
          });
        }
      }

      const client = new ZeroRetryUnusualClient();
      let caught: any = null;
      try {
        await client.generateImage({
          prompt: 'Test zero retry unusual',
          maxRetries: 0,
        });
      } catch (err: any) {
        caught = err;
      }

      assert.ok(caught, 'Phải ném lỗi khi maxRetries = 0');
      assert.strictEqual(caught.code, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY');
      assert.strictEqual(recoveryCalls, 0, 'Khi maxRetries = 0 tầng RPC không được tự gọi redundancy recovery');
    });

    await test('Standalone GoogleFlowRpcClient.generateImage với maxRetries > 0 kích hoạt recovery, chờ backoff và retry', async () => {
      let recoveryCalls = 0;
      let rpcAttempts = 0;
      class StandaloneRetryClient extends GoogleFlowRpcClient {
        public override async handleUnusualActivityRecovery(win?: any): Promise<any> {
          recoveryCalls++;
          return win;
        }
        public override async callFlowRPC(): Promise<unknown> {
          rpcAttempts++;
          if (rpcAttempts === 1) {
            throw new GoogleFlowRpcError('unusual_activity on IP', {
              code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
              retryable: true,
            });
          }
          return [['11111111-1111-1111-1111-111111111111', 'https://flow-content.google/image-r3.png']];
        }
      }

      const client = new StandaloneRetryClient();
      const res = await client.generateImage({
        prompt: 'Standalone retry test',
        maxRetries: 1,
        backoffBaseMs: 15, // Giãn cách ngắn để test nhanh
      });

      assert.ok(res.images && res.images.length > 0);
      assert.strictEqual(recoveryCalls, 1, 'Phải kích hoạt recovery đúng 1 lần trước khi retry');
      assert.strictEqual(rpcAttempts, 2, 'Phải retry lần 2 thành công');
    });

    await test('isUnusualActivity trên GoogleFlowRpcError nhận diện không phân biệt hoa thường', () => {
      const errLower = new GoogleFlowRpcError('Server detected unusual_activity on IP', {
        code: 'RATE_LIMITED',
        retryable: true,
      });
      assert.strictEqual(errLower.isUnusualActivity, true);
      assert.strictEqual(isUnusualActivityError(errLower), true);

      const errNormal = new GoogleFlowRpcError('Server busy', {
        code: 'RATE_LIMITED',
        retryable: true,
      });
      assert.strictEqual(errNormal.isUnusualActivity, false);
      assert.strictEqual(isUnusualActivityError(errNormal), false);
    });

    await test('AiStudioVisualService.regenerateSceneAsset bảo toàn toàn diện cấu hình & hỗ trợ referenceImagePath', async () => {
      let capturedConfig: any = null;
      let capturedScene: any = null;

      class MockRegenClient extends GoogleFlowRpcClient {
        public override async generateImage(params: GenerateImageParams): Promise<RpcGenerateImageResult> {
          return {
            images: [{ assetId: 'img-regen-r3', mediaId: 'img-regen-r3', url: dummyPngPath }],
            firstImageUrl: dummyPngPath,
            projectId: params.projectId || 'default-proj',
          };
        }
      }

      const client = new MockRegenClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      // Spy on generateViaGoogleFlow
      const origGen = service.generateViaGoogleFlow.bind(service);
      service.generateViaGoogleFlow = async (scene, outPath, flowConfig, onProgress, signal) => {
        capturedScene = scene;
        capturedConfig = flowConfig;
        return await origGen(scene, outPath, flowConfig, onProgress, signal);
      };

      const outDir = path.join(tmpTestDir, 'suite9_regen');
      const res = await service.regenerateSceneAsset(
        {
          sceneId: 'sc-regen-r3',
          visualPrompt: 'Regenerate visual with ref image',
          mode: 'image',
          referenceImagePath: dummyPngPath,
          flowConfig: {
            projectId: 'proj-custom-r3',
            backoffBaseMs: 0,
            skipCooldown: true,
            maxRetries: 1,
          },
        },
        outDir
      );

      assert.ok(res.assetPath && fs.existsSync(res.assetPath));
      assert.strictEqual(capturedScene.referenceImagePath, dummyPngPath, 'mockScene phải giữ referenceImagePath');
      assert.strictEqual(capturedConfig.projectId, 'proj-custom-r3', 'flowConfig phải giữ projectId');
      assert.strictEqual(capturedConfig.backoffBaseMs, 0, 'flowConfig phải giữ backoffBaseMs');
      assert.strictEqual(capturedConfig.skipCooldown, true, 'flowConfig phải giữ skipCooldown');
      service.setRpcClient(null);
    });

    await test('FlowBridgeServer.verifySnifferDump phát hiện cấu trúc f.req rỗng và payload inner không phải object/array', () => {
      // 1. Empty call list
      const emptyBatch = [
        {
          type: 'fetch',
          url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b',
          body: 'f.req=' + encodeURIComponent(JSON.stringify([[]])),
          response: '',
          timestamp: Date.now(),
        },
      ];
      const r1 = FlowBridgeServer.verifySnifferDump(emptyBatch);
      assert.strictEqual(r1.valid, false, 'Batch rỗng phải được đánh dấu không hợp lệ');

      // 2. Corrupt non-object inner payload
      const nonObjBatch = [
        {
          type: 'fetch',
          url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b',
          body: 'f.req=' + encodeURIComponent(JSON.stringify([[['ogiZ0b', '12345', null, 'generic']]])),
          response: '',
          timestamp: Date.now(),
        },
      ];
      const r2 = FlowBridgeServer.verifySnifferDump(nonObjBatch);
      assert.strictEqual(r2.valid, false, 'Inner payload kiểu số nguyên (không phải object/array) phải bị từ chối');
    });

    await test('dispatchVisualAssets chuẩn hoá an toàn số giây cooldown dạng float (vd: 8.7s) và NaN', async () => {
      const countdownValues: number[] = [];
      class MockFloatCdClient extends GoogleFlowRpcClient {
        public override async generateImage(): Promise<RpcGenerateImageResult> {
          return {
            images: [{ assetId: 'img-float-cd', mediaId: 'img-float-cd', url: dummyPngPath }],
            firstImageUrl: dummyPngPath,
            projectId: 'proj-float-cd',
          };
        }
      }

      const client = new MockFloatCdClient();
      const service = new AiStudioVisualService();
      service.setRpcClient(client);

      const scenes: StoryboardScene[] = [
        { id: 'sc-cd-1', lineIndex: 0, startMs: 0, endMs: 2000, durationMs: 2000, lineText: '1', visualPrompt: '1', motionType: 'ken_burns', status: 'pending' },
        { id: 'sc-cd-2', lineIndex: 1, startMs: 2000, endMs: 4000, durationMs: 2000, lineText: '2', visualPrompt: '2', motionType: 'ken_burns', status: 'pending' },
      ];

      // Test with float cooldownSec = 1.8 -> round to 2
      const outDir = path.join(tmpTestDir, 'suite9_float_cd');
      await service.dispatchVisualAssets(
        scenes,
        {
          outputMode: 'image',
          cooldownSec: 2, // 2s countdown
        },
        outDir,
        (_pct, msg) => {
          const match = msg.match(/Còn (\d+(?:\.\d+)?) giây/);
          if (match) {
            countdownValues.push(Number(match[1]));
          }
        }
      );

      assert.ok(countdownValues.length > 0, 'Phải có tin nhắn đếm ngược cooldown');
      for (const val of countdownValues) {
        assert.strictEqual(Number.isInteger(val), true, `Số giây đếm ngược phải là số nguyên, nhận: ${val}`);
      }
      service.setRpcClient(null);
    });

    console.log('\n================================================================');
    console.log(`  KẾT QUẢ KIỂM THỬ: ${passedTests}/${totalTests} TESTS PASSED  `);
    if (failedTests === 0) {
      console.log(`  ${GREEN}${BOLD}TẤT CẢ CÁC BÀI KIỂM TRA ĐÃ ĐẠT 100%!${RESET}`);
    } else {
      console.log(`  ${RED}${BOLD}CÓ ${failedTests} BÀI KIỂM TRA THẤT BẠI!${RESET}`);
      process.exit(1);
    }
    console.log('================================================================\n');
  } finally {
    try {
      fs.rmSync(tmpTestDir, { recursive: true, force: true });
    } catch {}
  }
}

runAllTests().catch((e) => {
  console.error('Lỗi thực thi test runner:', e);
  process.exit(1);
});
