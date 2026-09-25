/**
 * test-google-flow-rpc.ts
 *
 * Automated verification test runner for GoogleFlowRpcClient:
 * - RPC Dispatch & In-Session Context Contract
 * - Payload Contracts (Imagen/Nano image gen, Veo video gen with audio, maseQ upload)
 * - Asset Upload Flow & Asset ID validation
 * - Async Polling State Machine Lifecycle (queued -> processing -> completed / failed)
 * - Structured Error Classification (SESSION_EXPIRED, RATE_LIMITED, CONTENT_POLICY_VIOLATION, UPSTREAM_ERROR, TIMEOUT)
 *
 * Chạy qua Node/Electron runner:
 *   npx tsx scripts/test-google-flow-rpc.ts
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  GoogleFlowRpcClient,
  getGoogleFlowRpcClient,
  GoogleFlowRpcError,
  classifyFlowRpcError,
  FlowPollingStateMachine,
  type SessionContextAdapter,
  type PollingStateTransition,
  type PollingProgressInfo,
} from '../main/workflow/flow-engine/rpc/GoogleFlowRpcClient';

import {
  buildBatchUrl,
  buildBatchBody,
  buildEnvelope,
  parseBatchResponse,
  buildGenImagePayload,
  buildGenVideoPayload,
  buildGenVideoTextPayload,
  buildUploadPayload,
  buildPollOperationPayload,
  resolveImageAspect,
  resolveVideoAspect,
  resolveImageModel,
  extractGeneratedImages,
  extractOperationStatus,
  extractPollStatus,
} from '../main/workflow/flow-engine/rpc/FlowBatchBuilder';

import {
  FLOW_HOST,
  BATCH_PATH,
  RPC_GEN_IMAGE,
  RPC_GEN_VIDEO_REFERENCES,
  RPC_GEN_VIDEO_TEXT,
  RPC_UPLOAD_IMAGE,
  RPC_OPERATION,
  RPC_MEDIA,
  CAPTCHA_ACTION_IMAGE,
  CAPTCHA_ACTION_VIDEO,
  SURFACE_ID,
} from '../main/workflow/flow-engine/rpc/FlowBatchConstants';

// ── Colors for test logging ──────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function it(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  return (async () => {
    try {
      await fn();
      passedTests++;
      console.log(`  ${GREEN}✓${RESET} ${name}`);
    } catch (err: any) {
      failedTests++;
      console.error(`  ${RED}✗ ${name}${RESET}`);
      console.error(`    ${RED}Error: ${err.message}${RESET}`);
      if (err.stack) {
        console.error(`    ${err.stack.split('\n').slice(1, 4).join('\n    ')}`);
      }
    }
  })();
}

function describe(suiteName: string, suiteFn: () => Promise<void>) {
  console.log(`\n${BOLD}${CYAN}=== SUITE: ${suiteName} ===${RESET}`);
  return suiteFn();
}

// ── Mock Helpers ─────────────────────────────────────────────────────────────

function createMockSessionAdapter(options: {
  atToken?: string;
  fSid?: string;
  bl?: string;
  captchaToken?: string;
  cookies?: Array<{ name: string; value: string; domain?: string }>;
  fetchHandler?: (url: string, init?: any) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<any> }>;
}): SessionContextAdapter {
  const atToken = options.atToken ?? 'AIQ-mock-xsrf-token-1234567890abcdef';
  const fSid = options.fSid ?? '-1234567890';
  const bl = options.bl ?? 'boq_labs-ai-sandbox-frontend_test';
  const captchaToken = options.captchaToken ?? 'mock-recaptcha-token-abcdef123456';
  const defaultCookies = [
    { name: 'SID', value: 'mock_sid_value', domain: '.google.com' },
    { name: 'HSID', value: 'mock_hsid_value', domain: '.google.com' },
    { name: '__Secure-1PSID', value: 'mock_secure_psid', domain: 'flow.google.com' },
    { name: 'SOCS', value: 'mock_socs_value', domain: 'flow.google.com' },
  ];
  const cookies = options.cookies ?? defaultCookies;

  return {
    async executeJavaScript<T = any>(code: string): Promise<T> {
      if (code.includes('grecaptcha.enterprise') || code.includes('xZbWve')) {
        return {
          token: captchaToken,
          siteKey: '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV',
        } as T;
      }
      if (code.includes('WIZ_global_data')) {
        return {
          token: atToken,
          fSid,
          bl,
        } as T;
      }
      return null as T;
    },
    async getCookies(domain: string) {
      return cookies.filter((c) => !c.domain || c.domain.includes(domain));
    },
    async fetch(url: string, init?: any) {
      if (options.fetchHandler) {
        return options.fetchHandler(url, init);
      }
      return {
        ok: true,
        status: 200,
        text: async () => `)]}'\n100\n[["wrb.fr","test",null,null,null,null,1]]\n`,
        json: async () => ({}),
      };
    },
    isWindowValid: () => true,
    getUrl: () => 'https://flow.google.com/project/mock-project-id',
  };
}

function makeBatchexecuteSuccessResponse(rpcId: string, innerPayload: unknown): string {
  const innerJson = JSON.stringify(innerPayload);
  const chunk = JSON.stringify([['wrb.fr', rpcId, innerJson, null, null, null, 1]]);
  return `)]}'\n${chunk.length}\n${chunk}\n`;
}

// ── Main Test Runner ─────────────────────────────────────────────────────────

async function runTests() {
  console.log(`${BOLD}Khởi động kiểm thử tự động GoogleFlowRpcClient${RESET}`);
  console.log(`Thời gian: ${new Date().toISOString()}`);

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 1: Initialization & In-Session Context
  // ══════════════════════════════════════════════════════════════════════════
  await describe('1. In-Session RPC Client Initialization & Context Contract', async () => {
    await it('Khởi tạo client với partition mặc định "persist:google_veo"', () => {
      const client = new GoogleFlowRpcClient();
      assert.strictEqual(client.partition, 'persist:google_veo');
      const clientCustom = new GoogleFlowRpcClient({ partition: 'persist:custom_veo' });
      assert.strictEqual(clientCustom.partition, 'persist:custom_veo');
    });

    await it('Singleton helper getGoogleFlowRpcClient trả về instance hợp lệ', () => {
      const c1 = getGoogleFlowRpcClient();
      const c2 = getGoogleFlowRpcClient();
      assert.ok(c1 instanceof GoogleFlowRpcClient);
      assert.strictEqual(c1, c2, 'Singleton phải trả về cùng 1 tham chiếu');
    });

    await it('Kế thừa cookies xác thực từ Google session (dedup & priority)', async () => {
      const adapter = createMockSessionAdapter({
        cookies: [
          { name: 'SID', value: 'google_sid', domain: '.google.com' },
          { name: 'OVERRIDE_ME', value: 'from_google', domain: '.google.com' },
          { name: 'OVERRIDE_ME', value: 'from_flow', domain: 'flow.google.com' },
          { name: '__Secure-1PSID', value: 'flow_secure_sid', domain: 'flow.google.com' },
        ],
      });
      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      const cookieStr = await client.getCookieString();

      assert.ok(cookieStr.includes('SID=google_sid'), 'Phải chứa cookie từ .google.com');
      assert.ok(cookieStr.includes('__Secure-1PSID=flow_secure_sid'), 'Phải chứa cookie từ flow.google.com');
      assert.ok(cookieStr.includes('OVERRIDE_ME=from_flow'), 'flow.google.com phải ghi đè .google.com nếu trùng tên');
    });

    await it('Trích xuất CSRF at token từ WIZ_global_data và cache TTL', async () => {
      let evalCount = 0;
      const adapter = createMockSessionAdapter({
        atToken: 'AIQ-fresh-xsrf-token-999',
      });
      const origEval = adapter.executeJavaScript;
      adapter.executeJavaScript = async (code: string) => {
        evalCount++;
        return origEval(code);
      };

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      client.invalidateAtTokenCache();

      const token1 = await client.getAtToken();
      assert.strictEqual(token1, 'AIQ-fresh-xsrf-token-999');
      assert.strictEqual(evalCount, 1, 'Lần 1 phải gọi eval');

      // Lần 2 phải lấy từ cache
      const token2 = await client.getAtToken();
      assert.strictEqual(token2, 'AIQ-fresh-xsrf-token-999');
      assert.strictEqual(evalCount, 1, 'Lần 2 phải lấy từ cache, không gọi lại eval');

      // Invalidate cache
      client.invalidateAtTokenCache();
      const token3 = await client.getAtToken();
      assert.strictEqual(token3, 'AIQ-fresh-xsrf-token-999');
      assert.strictEqual(evalCount, 2, 'Sau khi invalidate cache phải gọi lại eval');
    });

    await it('Mint reCAPTCHA Enterprise token với action tương ứng', async () => {
      const adapter = createMockSessionAdapter({
        captchaToken: 'recaptcha-minted-token-777',
      });
      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });

      const imgCaptcha = await client.mintCaptchaToken(null, CAPTCHA_ACTION_IMAGE);
      assert.strictEqual(imgCaptcha, 'recaptcha-minted-token-777');

      const vidCaptcha = await client.mintCaptchaToken(null, CAPTCHA_ACTION_VIDEO);
      assert.strictEqual(vidCaptcha, 'recaptcha-minted-token-777');
    });

    await it('Cách ly token cache theo partition không gây rò rỉ giữa các tài khoản', async () => {
      const adapterA = createMockSessionAdapter({ atToken: 'AIQ-token-account-A' });
      const adapterB = createMockSessionAdapter({ atToken: 'AIQ-token-account-B' });

      const clientA = new GoogleFlowRpcClient({ partition: 'persist:user_alpha', sessionAdapter: adapterA });
      const clientB = new GoogleFlowRpcClient({ partition: 'persist:user_beta', sessionAdapter: adapterB });

      const tokenA = await clientA.getAtToken();
      const tokenB = await clientB.getAtToken();

      assert.strictEqual(tokenA, 'AIQ-token-account-A');
      assert.strictEqual(tokenB, 'AIQ-token-account-B');
      assert.notStrictEqual(tokenA, tokenB, 'Token giữa 2 partition khác nhau không được trùng lẫn');

      // Invalidate A không ảnh hưởng tới B
      clientA.invalidateAtTokenCache();
      const tokenB_cached = await clientB.getAtToken();
      assert.strictEqual(tokenB_cached, 'AIQ-token-account-B', 'Cache của B vẫn phải nguyên vẹn khi xoá cache của A');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 2: Payload Contracts & Batchexecute Wire Protocol
  // ══════════════════════════════════════════════════════════════════════════
  await describe('2. RPC Payload Contracts (Imagen/Nano, Veo, maseQ)', async () => {
    await it('Tạo đúng payload sinh ảnh (ogiZ0b / Imagen / Nano)', () => {
      const payload = buildGenImagePayload({
        prompt: 'A majestic dragon over cyberpunk Hanoi',
        aspectRatio: '16:9',
        seed: 42,
        outputCount: 1,
        referenceMediaIds: ['ref-uuid-1', 'ref-uuid-2'],
        baseImageMediaId: 'base-img-uuid',
        imageModel: 'GEM_PIX_2',
        projectId: 'test-proj-uuid',
        captchaToken: 'test-captcha-token',
      });

      assert.ok(Array.isArray(payload), 'Payload phải là mảng');
      assert.strictEqual(payload[0], null);
      assert.ok(Array.isArray(payload[1]), 'payload[1] là taskObjects');
      assert.strictEqual(payload[2], 1, 'payload[2] phải là 1 (verified wire contract)');

      const task = (payload[1] as any[])[0];
      assert.ok(Array.isArray(task), 'task object là mảng');

      // Kiểm tra imageInputs: base image (type 2) + references (type 1)
      const inputs = task[2];
      assert.ok(Array.isArray(inputs), 'imageInputs phải là mảng');
      assert.strictEqual(inputs.length, 3);
      assert.strictEqual(inputs[0][0], 'base-img-uuid');
      assert.strictEqual(inputs[0][4], 2, 'base image có inputType = 2');
      assert.strictEqual(inputs[1][0], 'ref-uuid-1');
      assert.strictEqual(inputs[1][4], 1, 'reference có inputType = 1');

      // Seed
      assert.strictEqual(task[3], 42, 'Seed phải khớp với tham số truyền vào');

      // Aspect ratio: 16:9 -> 3 (IMG_ASPECT_LANDSCAPE)
      assert.strictEqual(task[4], 3, '16:9 aspect ratio phải giải mã thành 3');

      // Model wire id
      assert.strictEqual(task[5], 'GEM_PIX_2', 'Model ID phải là GEM_PIX_2');

      // Prompt
      assert.deepStrictEqual(task[8], [[['A majestic dragon over cyberpunk Hanoi']]]);

      // Security block chứa reCAPTCHA token & project ID
      const secBlock = task[7];
      assert.strictEqual(secBlock[1], SURFACE_ID, 'Surface ID phải là 22');
      assert.strictEqual(secBlock[5], 'test-proj-uuid');
      assert.strictEqual(secBlock[10][0], 'test-captcha-token');
    });

    await it('Tạo đúng payload sinh video có tham chiếu ảnh và tùy chọn audio (MZZa6b / Veo)', () => {
      const payload = buildGenVideoPayload({
        prompt: 'Camera zooms in smoothly on the character',
        aspectRatio: '16:9',
        durationSeconds: 8,
        inputMediaId: 'input-img-uuid',
        imageMediaId: 'input-img-uuid',
        videoModel: 'veo_3_1_r2v_lite',
        projectId: 'test-proj-uuid',
        captchaToken: 'test-vid-captcha',
        audio: { enabled: true, soundEffects: true },
      });

      assert.ok(Array.isArray(payload));
      const tasks = payload[0] as any[];
      const task = tasks[0];

      // Prompt
      assert.deepStrictEqual(task[0], [null, null, [[['Camera zooms in smoothly on the character']]]]);

      // Input image media id
      assert.deepStrictEqual(task[1], [[null, 'input-img-uuid']]);

      // Model key
      assert.strictEqual(task[2], 'veo_3_1_r2v_lite');

      // Aspect ratio: 16:9 cho video -> 2 (VID_ASPECT_LANDSCAPE)
      assert.strictEqual(task[3], 2);

      // Audio option
      assert.deepStrictEqual(task[4], { enabled: true, soundEffects: true }, 'Tùy chọn audio phải được gắn vào payload');

      // Security block
      const secBlock = payload[1] as any[];
      assert.strictEqual(secBlock[1], SURFACE_ID);
      assert.strictEqual(secBlock[5], 'test-proj-uuid');
      assert.strictEqual(secBlock[10][0], 'test-vid-captcha');
    });

    await it('Tạo đúng payload sinh video dạng text-to-video (YhhmEf)', () => {
      const payload = buildGenVideoTextPayload({
        prompt: 'Hyperrealistic drone shot over tropical mountains',
        aspectRatio: '9:16',
        durationSeconds: 4,
        projectId: 'test-proj-uuid',
        captchaToken: 'test-vid-captcha',
        audio: true,
      });

      const tasks = payload[0] as any[];
      const task = tasks[0];
      assert.deepStrictEqual(task[0], [null, null, [[['Hyperrealistic drone shot over tropical mountains']]]]);
      assert.strictEqual(task[2], 1, '9:16 cho video phải giải mã thành 1 (VID_ASPECT_PORTRAIT)');
      assert.deepStrictEqual(task[3], { enabled: true }, 'Audio boolean true giải mã thành { enabled: true }');
    });

    await it('Tạo đúng payload upload asset maseQ', () => {
      const payload = buildUploadPayload({
        projectId: 'proj-123',
        base64Data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        mimeType: 'image/png',
        filename: 'avatar.png',
        captchaToken: 'upload-captcha-token',
      });

      assert.strictEqual(payload[1], 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
      assert.strictEqual(payload[2], 'image/png');
      assert.strictEqual(payload[3], 1);
      assert.strictEqual(payload[8], 'avatar.png');
      const sec = payload[0] as any[];
      assert.strictEqual(sec[5], 'proj-123');
      assert.strictEqual(sec[10][0], 'upload-captcha-token');
    });

    await it('Xây dựng Batch Envelope & URL chuẩn Google Flow batchexecute', () => {
      const envelope = buildEnvelope(
        RPC_GEN_IMAGE,
        ['mock_inner_payload'],
        'test-at-token',
        'SID=test; __Secure-1PSID=test2',
        'proj-456',
        '-987654321',
        'bl_release_2026'
      );

      assert.ok(envelope.url.startsWith(`${FLOW_HOST}${BATCH_PATH}`));
      assert.ok(envelope.url.includes('rpcids=ogiZ0b'));
      assert.ok(envelope.url.includes('source-path=%2Fproject%2Fproj-456'));
      assert.ok(envelope.url.includes('f.sid=-987654321'));
      assert.ok(envelope.url.includes('bl=bl_release_2026'));

      assert.ok(envelope.body.includes('f.req='));
      assert.ok(envelope.body.includes('at=test-at-token'));
      assert.ok(envelope.body.endsWith('&'), 'Body phải có trailing & theo FlowKit wire format');

      assert.strictEqual(envelope.headers['Content-Type'], 'application/x-www-form-urlencoded');
      assert.strictEqual(envelope.headers['X-Same-Domain'], '1');
      assert.strictEqual(envelope.headers['Origin'], FLOW_HOST);
      assert.strictEqual(envelope.headers['Referer'], `${FLOW_HOST}/project/proj-456`);
      assert.strictEqual(envelope.headers['Cookie'], 'SID=test; __Secure-1PSID=test2');
    });

    await it('Parse chính xác response batchexecute và bóc tách dữ liệu', () => {
      const id1 = '11111111-2222-3333-4444-555555555555';
      const id2 = '66666666-7777-8888-9999-000000000000';
      const mockResultData = [
        [id1, 'https://flow-content.google/image/img-1.png'],
        [id2, 'https://flow-content.google/image/img-2.png'],
      ];
      const rawText = makeBatchexecuteSuccessResponse(RPC_GEN_IMAGE, mockResultData);

      const parsed = parseBatchResponse(rawText, RPC_GEN_IMAGE);
      assert.strictEqual(parsed.ok, true);
      assert.strictEqual(parsed.rpcId, RPC_GEN_IMAGE);
      assert.deepStrictEqual(parsed.data, mockResultData);

      const imgs = extractGeneratedImages(parsed.data);
      assert.strictEqual(imgs.length, 2);
      assert.strictEqual(imgs[0].mediaId, id1);
      assert.strictEqual(imgs[0].url, 'https://flow-content.google/image/img-1.png');
      assert.strictEqual(imgs[1].mediaId, id2);
      assert.strictEqual(imgs[1].url, 'https://flow-content.google/image/img-2.png');
    });

    await it('Tạo video hỗ trợ cú pháp generateVideo(prompt, opts) và fallback referenceAssets', async () => {
      let dispatchedPayload: any;
      const adapter = createMockSessionAdapter({
        fetchHandler: async (url, init) => {
          assert.ok(url.includes(RPC_GEN_VIDEO_REFERENCES), 'Phải gọi MZZa6b khi có reference assets');
          dispatchedPayload = init?.body;
          const mockOpData = [['op-video-uuid-123', 'proj-123', 'task-1', 'CAE']];
          const raw = makeBatchexecuteSuccessResponse(RPC_GEN_VIDEO_REFERENCES, mockOpData);
          return {
            ok: true,
            status: 200,
            text: async () => raw,
            json: async () => ({}),
          };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      const res = await client.generateVideo('Dynamic drone shot over Hanoi', {
        project_id: 'proj-123',
        reference_assets: ['ref-uuid-first'],
        duration_seconds: 4,
        aspect_ratio: '9:16',
        audio: true,
      });

      assert.strictEqual(res.operationId, 'op-video-uuid-123');
      assert.strictEqual(res.projectId, 'proj-123');
      assert.ok(dispatchedPayload, 'Payload phải được gửi đi');
    });

    await it('Parse thành công batchexecute với Windows CRLF và khoảng trắng đầu dòng', () => {
      const crlfResponse = "  )]}'\r\n50\r\n[[\"wrb.fr\",\"testRpc\",\"{\\\"success\\\":true}\",null,null,null,1]]\r\n";
      const parsed = parseBatchResponse(crlfResponse, 'testRpc');
      assert.strictEqual(parsed.ok, true);
      assert.strictEqual(parsed.rpcId, 'testRpc');
      assert.deepStrictEqual(parsed.data, { success: true });
    });

    await it('Ưu tiên chunk khớp expectedRpcId khi response chứa nhiều chunk wrb.fr', () => {
      const multiChunkResponse =
        ")]}'\n" +
        "60\n[[\"wrb.fr\",\"telemetryRpc\",\"{\\\"log\\\":1}\",null,null,null,1]]\n" +
        "60\n[[\"wrb.fr\",\"ogiZ0b\",\"{\\\"image\\\":\\\"data\\\"}\",null,null,null,2]]\n";
      const parsed = parseBatchResponse(multiChunkResponse, 'ogiZ0b');
      assert.strictEqual(parsed.ok, true);
      assert.strictEqual(parsed.rpcId, 'ogiZ0b');
      assert.deepStrictEqual(parsed.data, { image: 'data' });
    });

    await it('resolveVideoAspect và resolveImageAspect chuẩn hoá chính xác số và chuỗi', () => {
      assert.strictEqual(resolveVideoAspect('16:9'), 2);
      assert.strictEqual(resolveVideoAspect('9:16'), 1);
      assert.strictEqual(resolveVideoAspect('portrait'), 1);
      assert.strictEqual(resolveVideoAspect('landscape'), 2);
      assert.strictEqual(resolveVideoAspect('VIDEO_ASPECT_RATIO_PORTRAIT'), 1);
      assert.strictEqual(resolveVideoAspect(1), 1);
      assert.strictEqual(resolveVideoAspect(2), 2);

      assert.strictEqual(resolveImageAspect('1:1'), 1);
      assert.strictEqual(resolveImageAspect('square'), 1);
      assert.strictEqual(resolveImageAspect('9:16'), 2);
      assert.strictEqual(resolveImageAspect('portrait'), 2);
      assert.strictEqual(resolveImageAspect('16:9'), 3);
      assert.strictEqual(resolveImageAspect('landscape'), 3);
    });

    await it('Hỗ trợ chữ ký 3 tham số (win, prompt, opts) cho generateImage và generateVideo', async () => {
      const mockWin = { isDestroyed: () => false };
      const adapter = createMockSessionAdapter({
        fetchHandler: async (url) => {
          if (url.includes(RPC_GEN_IMAGE)) {
            const raw = makeBatchexecuteSuccessResponse(RPC_GEN_IMAGE, [
              ['uuid-img-1', 'https://flow-content.google/image/test.png'],
            ]);
            return { ok: true, status: 200, text: async () => raw, json: async () => ({}) };
          }
          if (url.includes(RPC_GEN_VIDEO_TEXT)) {
            const raw = makeBatchexecuteSuccessResponse(RPC_GEN_VIDEO_TEXT, [
              ['op-3arg-vid', 'proj-1', 'task-1', 'CAE'],
            ]);
            return { ok: true, status: 200, text: async () => raw, json: async () => ({}) };
          }
          return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      const imgRes = await client.generateImage(mockWin, 'Cyberpunk neon city', { aspectRatio: '16:9' });
      assert.strictEqual(imgRes.images[0].assetId, 'uuid-img-1');

      const vidRes = await client.generateVideo(mockWin, 'Drone shot over city', { duration_seconds: 4 });
      assert.strictEqual(vidRes.operationId, 'op-3arg-vid');
    });

    await it('parseBatchResponse bóc tách chính xác chunk chứa nhiều record (ví dụ ["di", ...] trước ["wrb.fr", ...])', () => {
      const expectedRpc = 'ogiZ0b';
      const chunkData = [
        ['di', 999],
        ['wrb.fr', expectedRpc, JSON.stringify([['img-id-multientry', 'https://flow-content.google/image/multi.png']]), null, null, null, 1],
      ];
      const rawText = `)]}'\n200\n${JSON.stringify(chunkData)}\n`;
      const res = parseBatchResponse(rawText, expectedRpc);
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.rpcId, expectedRpc);
      const images = extractGeneratedImages(res.data);
      assert.strictEqual(images[0].mediaId, 'img-id-multientry');
    });

    await it('extractOperationStatus bóc tách chính xác status RUNNING, PENDING, QUEUED và opId không phải UUID', () => {
      const resRunning = extractOperationStatus([['operations/custom-run-123', 'proj-999', 'task-1', 'RUNNING']], 'YhhmEf');
      assert.strictEqual(resRunning.operationId, 'operations/custom-run-123');
      assert.strictEqual(resRunning.status, 'RUNNING');
      assert.strictEqual(resRunning.projectId, 'proj-999');

      const resQueued = extractOperationStatus([['op-queued-abc', 'QUEUED']], 'MZZa6b');
      assert.strictEqual(resQueued.operationId, 'op-queued-abc');
      assert.strictEqual(resQueued.status, 'QUEUED');
    });

    await it('generateImage(prompt, projectId) và generateVideo(prompt, projectId) gán đúng projectId không bị phân tách chuỗi', async () => {
      let capturedImagePayload: any;
      let capturedVideoPayload: any;

      const adapter = createMockSessionAdapter({
        fetchHandler: async (url, init) => {
          if (url.includes(RPC_GEN_IMAGE)) {
            capturedImagePayload = init?.body;
            const raw = makeBatchexecuteSuccessResponse(RPC_GEN_IMAGE, [['img-1', 'https://flow-content.google/image/1.png']]);
            return { ok: true, status: 200, text: async () => raw, json: async () => ({}) };
          }
          if (url.includes(RPC_GEN_VIDEO_TEXT)) {
            capturedVideoPayload = init?.body;
            const raw = makeBatchexecuteSuccessResponse(RPC_GEN_VIDEO_TEXT, [['op-vid-1', 'proj-vid-targeted', 'task-1', 'CAE']]);
            return { ok: true, status: 200, text: async () => raw, json: async () => ({}) };
          }
          return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      await client.generateImage('A mountain lake', 'proj-img-targeted');
      assert.ok(decodeURIComponent(capturedImagePayload).includes('proj-img-targeted'), 'Payload phải chứa đúng projectId');

      await client.generateVideo('A flowing river', 'proj-vid-targeted');
      assert.ok(decodeURIComponent(capturedVideoPayload).includes('proj-vid-targeted'), 'Payload video phải chứa đúng projectId');
    });

    await it('referenceAssets dạng chuỗi trong generateImage và generateVideo không bị bẻ thành từng ký tự', async () => {
      let capturedPayload: any;
      const singleRefAsset = 'single-asset-uuid-123456';

      const adapter = createMockSessionAdapter({
        fetchHandler: async (url, init) => {
          if (url.includes(RPC_GEN_IMAGE)) {
            capturedPayload = decodeURIComponent(init?.body || '');
            const raw = makeBatchexecuteSuccessResponse(RPC_GEN_IMAGE, [['img-ref-1', 'https://flow-content.google/image/ref.png']]);
            return { ok: true, status: 200, text: async () => raw, json: async () => ({}) };
          }
          return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      await client.generateImage({
        prompt: 'Portrait with reference',
        referenceAssets: singleRefAsset as any, // Truyền chuỗi thay vì mảng
      });

      assert.ok(capturedPayload.includes(singleRefAsset), 'Payload phải chứa nguyên vẹn chuỗi reference asset');
      // Đảm bảo không bị split thành "s", "i", "n", "g", "l", "e"
      assert.ok(!capturedPayload.includes('["s",null,null,null,1]'), 'Không được bẻ chuỗi thành từng ký tự mảng');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 3: Asset Upload Flow & Asset ID Validation
  // ══════════════════════════════════════════════════════════════════════════
  await describe('3. Asset Upload Flow & Asset ID Validation', async () => {
    const tmpDir = path.join(os.tmpdir(), `test_rpc_upload_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Tạo file ảnh test 1x1 png
    const testPngPath = path.join(tmpDir, 'test_sample.png');
    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(testPngPath, png1x1);

    await it('Upload file ảnh cục bộ và nhận diện asset_id hợp lệ (UUID)', async () => {
      const expectedUuid = 'a1b2c3d4-e5f6-47a8-9b0c-1d2e3f4a5b6c';
      // Mock maseQ response format: [[mediaId, projectId, operationId, "CAE", ...]]
      const mockUploadResponseData = [
        [expectedUuid, 'proj-123', 'op-999', 'CAE'],
      ];

      const adapter = createMockSessionAdapter({
        fetchHandler: async (url, init) => {
          assert.ok(url.includes(RPC_UPLOAD_IMAGE), 'Phải gọi maseQ RPC endpoint');
          const raw = makeBatchexecuteSuccessResponse(RPC_UPLOAD_IMAGE, mockUploadResponseData);
          return {
            ok: true,
            status: 200,
            text: async () => raw,
            json: async () => ({}),
          };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      const res = await client.uploadAsset({
        filePath: testPngPath,
        projectId: 'proj-123',
      });

      assert.strictEqual(res.assetId, expectedUuid);
      assert.strictEqual(res.mediaId, expectedUuid);
      assert.strictEqual(res.filename, 'test_sample.png');
      assert.strictEqual(res.mimeType, 'image/png');
      assert.strictEqual(res.sizeBytes, png1x1.length);
      assert.match(
        res.assetId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        'assetId phải là UUID hợp lệ'
      );
    });

    await it('Ném lỗi rõ ràng nếu file không tồn tại hoặc rỗng', async () => {
      const client = new GoogleFlowRpcClient();

      await assert.rejects(
        async () => {
          await client.uploadAsset({
            filePath: path.join(tmpDir, 'non_existent_file.png'),
            projectId: 'proj-123',
          });
        },
        (err: any) => {
          assert.ok(err instanceof GoogleFlowRpcError);
          assert.strictEqual(err.code, 'INVALID_ARGUMENT');
          assert.strictEqual(err.retryable, false);
          return true;
        }
      );

      const emptyFilePath = path.join(tmpDir, 'empty.png');
      fs.writeFileSync(emptyFilePath, Buffer.alloc(0));

      await assert.rejects(
        async () => {
          await client.uploadAsset({
            filePath: emptyFilePath,
            projectId: 'proj-123',
          });
        },
        (err: any) => {
          assert.ok(err instanceof GoogleFlowRpcError);
          assert.strictEqual(err.code, 'INVALID_ARGUMENT');
          return true;
        }
      );
    });

    await it('Hỗ trợ gọi uploadAsset với cú pháp 2 tham số uploadAsset(filePath, projectId)', async () => {
      const mockUuid = '11223344-5566-7788-99aa-bbccddeeff00';
      const adapter = createMockSessionAdapter({
        fetchHandler: async () => {
          const raw = makeBatchexecuteSuccessResponse(RPC_UPLOAD_IMAGE, [[mockUuid, 'proj-123', 'op-1', 'CAE']]);
          return {
            ok: true,
            status: 200,
            text: async () => raw,
            json: async () => ({}),
          };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      const res = await client.uploadAsset(testPngPath, 'proj-123');

      assert.strictEqual(res.assetId, mockUuid);
      assert.strictEqual(res.mediaId, mockUuid);
      assert.strictEqual(res.asset_id, mockUuid, 'Phải có asset_id alias snake_case');
      assert.strictEqual(res.filename, 'test_sample.png');
    });

    await it('Hỗ trợ upload asset với tham số snake_case: file_path, project_id, mime_type', async () => {
      const mockUuid = '99887766-5544-3322-1100-ffeeddccbbaa';
      const adapter = createMockSessionAdapter({
        fetchHandler: async () => {
          const raw = makeBatchexecuteSuccessResponse(RPC_UPLOAD_IMAGE, [[mockUuid, 'proj-snake', 'op-1', 'CAE']]);
          return {
            ok: true,
            status: 200,
            text: async () => raw,
            json: async () => ({}),
          };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      const res = await client.uploadAsset({
        file_path: testPngPath,
        project_id: 'proj-snake',
        mime_type: 'image/png',
      });

      assert.strictEqual(res.assetId, mockUuid);
      assert.strictEqual(res.asset_id, mockUuid);
    });

    await it('Hỗ trợ uploadAsset trực tiếp từ Buffer và Uint8Array dạng vị trí uploadAsset(buffer, projectId)', async () => {
      const bufferUuid = '44556677-8899-aabb-ccdd-eeff00112233';
      const adapter = createMockSessionAdapter({
        fetchHandler: async () => {
          const raw = makeBatchexecuteSuccessResponse(RPC_UPLOAD_IMAGE, [[bufferUuid, 'proj-buf', 'op-1', 'CAE']]);
          return { ok: true, status: 200, text: async () => raw, json: async () => ({}) };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      const res = await client.uploadAsset(png1x1, 'proj-buf');
      assert.strictEqual(res.assetId, bufferUuid);
      assert.strictEqual(res.sizeBytes, png1x1.length);
    });

    await it('Hỗ trợ uploadAsset với 4 tham số (win, buffer/filePath, filename, projectId)', async () => {
      const mockWin = { isDestroyed: () => false };
      const fourArgUuid = '11223344-5566-7788-99aa-bbccddeeff00';
      let capturedPayload: any;

      const adapter = createMockSessionAdapter({
        fetchHandler: async (url, init) => {
          capturedPayload = decodeURIComponent(init?.body || '');
          const raw = makeBatchexecuteSuccessResponse(RPC_UPLOAD_IMAGE, [[fourArgUuid, 'proj-four-arg', 'op-1', 'CAE']]);
          return { ok: true, status: 200, text: async () => raw, json: async () => ({}) };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      const res = await client.uploadAsset(mockWin, png1x1, 'custom_avatar.png', 'proj-four-arg');
      assert.strictEqual(res.assetId, fourArgUuid);
      assert.strictEqual(res.filename, 'custom_avatar.png');
      assert.ok(capturedPayload.includes('custom_avatar.png'));
      assert.ok(capturedPayload.includes('proj-four-arg'));
    });

    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 4: Async Polling State Machine & Lifecycle
  // ══════════════════════════════════════════════════════════════════════════
  await describe('4. Async Polling State Machine & Lifecycle', async () => {
    await it('Chuyển trạng thái đúng chuẩn: queued -> processing -> completed', async () => {
      const transitions: PollingStateTransition[] = [];
      const progressHistory: PollingProgressInfo[] = [];

      let pollCallCount = 0;
      const expectedVideoUrl = 'https://flow-content.google/video/vid-uuid-789.mp4';

      const adapter = createMockSessionAdapter({
        fetchHandler: async (url) => {
          pollCallCount++;
          let pollData: any;

          if (pollCallCount === 1) {
            // Lần 1: Task đang xử lý
            pollData = [['op-uuid-123', 'proj-123', 'task-1', 'RUNNING']];
          } else {
            // Lần 2: Task hoàn tất với videoUrl
            pollData = [
              ['op-uuid-123', 'proj-123', 'task-1', 'CAE'],
              expectedVideoUrl,
            ];
          }

          const raw = makeBatchexecuteSuccessResponse(RPC_OPERATION, pollData);
          return {
            ok: true,
            status: 200,
            text: async () => raw,
            json: async () => ({}),
          };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });

      const result = await client.pollGeneration({
        operationId: 'op-uuid-123',
        projectId: 'proj-123',
        pollIntervalMs: 20, // nhanh cho test
        timeoutMs: 5000,
        onStateChange: (t) => transitions.push(t),
        onProgress: (p) => progressHistory.push(p),
      });

      assert.strictEqual(result.state, 'completed');
      assert.strictEqual(result.videoUrl, expectedVideoUrl);
      assert.strictEqual(result.pollCount, 2);

      // Kiểm tra chuỗi chuyển đổi trạng thái
      assert.strictEqual(transitions.length, 2);
      assert.strictEqual(transitions[0].from, 'queued');
      assert.strictEqual(transitions[0].to, 'processing');
      assert.strictEqual(transitions[1].from, 'processing');
      assert.strictEqual(transitions[1].to, 'completed');

      // Kiểm tra progress updates
      assert.ok(progressHistory.some((p) => p.state === 'queued'));
      assert.ok(progressHistory.some((p) => p.state === 'processing'));
      assert.ok(progressHistory.some((p) => p.state === 'completed' && p.percentage === 100));
    });

    await it('Dừng ngay lập tức và ném CANCELLED khi isCancelled trả về true', async () => {
      let isCancelledFlag = false;
      const transitions: PollingStateTransition[] = [];

      const adapter = createMockSessionAdapter({
        fetchHandler: async () => {
          // Kích hoạt huỷ trước khi response
          isCancelledFlag = true;
          const raw = makeBatchexecuteSuccessResponse(RPC_OPERATION, [['op-uuid', 'RUNNING']]);
          return {
            ok: true,
            status: 200,
            text: async () => raw,
            json: async () => ({}),
          };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });

      await assert.rejects(
        async () => {
          await client.pollGeneration({
            operationId: 'op-cancel-test',
            projectId: 'proj-123',
            pollIntervalMs: 20,
            onStateChange: (t) => transitions.push(t),
            isCancelled: () => isCancelledFlag,
          });
        },
        (err: any) => {
          assert.ok(err instanceof GoogleFlowRpcError);
          assert.strictEqual(err.code, 'CANCELLED');
          assert.strictEqual(err.retryable, false);
          return true;
        }
      );

      assert.ok(transitions.some((t) => t.to === 'failed'));
    });

    await it('Dừng chính xác và ném TIMEOUT khi vượt quá timeoutMs', async () => {
      const transitions: PollingStateTransition[] = [];

      const adapter = createMockSessionAdapter({
        fetchHandler: async () => {
          await new Promise((r) => setTimeout(r, 60));
          const raw = makeBatchexecuteSuccessResponse(RPC_OPERATION, [['op-uuid', 'RUNNING']]);
          return {
            ok: true,
            status: 200,
            text: async () => raw,
            json: async () => ({}),
          };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });

      await assert.rejects(
        async () => {
          await client.pollGeneration({
            operationId: 'op-timeout-test',
            projectId: 'proj-123',
            pollIntervalMs: 20,
            timeoutMs: 50, // 50ms để timeout nhanh
            onStateChange: (t) => transitions.push(t),
          });
        },
        (err: any) => {
          assert.ok(err instanceof GoogleFlowRpcError);
          assert.strictEqual(err.code, 'TIMEOUT');
          assert.strictEqual(err.retryable, true);
          return true;
        }
      );

      assert.ok(transitions.some((t) => t.to === 'failed'));
    });

    await it('FlowPollingStateMachine chặn các bước chuyển đổi phi lý', () => {
      const sm = new FlowPollingStateMachine();
      assert.strictEqual(sm.currentState, 'queued');

      sm.transitionTo('processing');
      assert.strictEqual(sm.currentState, 'processing');

      sm.transitionTo('completed');
      assert.strictEqual(sm.currentState, 'completed');

      // Chuyển từ terminal state (completed) sang state khác phải báo lỗi
      assert.throws(() => {
        sm.transitionTo('processing');
      }, /Không thể chuyển từ trạng thái kết thúc/);
    });

    await it('Phát hiện lỗi terminal từ Flow (status FAILED / Safety Filter) ngay lập tức mà không chờ timeout', async () => {
      let pollCallCount = 0;
      const transitions: PollingStateTransition[] = [];

      const adapter = createMockSessionAdapter({
        fetchHandler: async () => {
          pollCallCount++;
          // Google Flow trả về task FAILED với policy violation
          const failedPayload = [
            ['op-fail-456', 'proj-123', 'task-1', 'FAILED', 'SAFETY_BLOCKED: Prompt contains sensitive content'],
          ];
          const raw = makeBatchexecuteSuccessResponse(RPC_OPERATION, failedPayload);
          return {
            ok: true,
            status: 200,
            text: async () => raw,
            json: async () => ({}),
          };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });

      await assert.rejects(
        async () => {
          await client.pollGeneration({
            operationId: 'op-fail-456',
            projectId: 'proj-123',
            pollIntervalMs: 20,
            timeoutMs: 10000,
            onStateChange: (t) => transitions.push(t),
          });
        },
        (err: any) => {
          assert.ok(err instanceof GoogleFlowRpcError);
          assert.ok(err.code === 'CONTENT_POLICY_VIOLATION' || err.code === 'CONTENT_REJECTED');
          assert.strictEqual(err.retryable, false);
          assert.strictEqual(err.isContentPolicyViolation, true);
          return true;
        }
      );

      assert.strictEqual(pollCallCount, 1, 'Phải dừng ngay sau poll đầu tiên khi phát hiện FAILED');
      assert.ok(transitions.some((t) => t.to === 'failed'), 'State machine phải chuyển sang failed');
    });

    await it('Hoàn thành thành công khi status là CAE và tự động gọi getMediaUrl khi poll không chứa direct URL', async () => {
      let getMediaUrlCalled = false;
      const expectedUrl = 'https://flow-content.google/video/resolved-by-as29s.mp4';
      const opId = 'op-cae-no-inline-url';
      const targetMediaId = '77778888-9999-0000-1111-222233334444';

      const adapter = createMockSessionAdapter({
        fetchHandler: async (url) => {
          if (url.includes(RPC_OPERATION)) {
            // Task hoàn thành CAE nhưng không có URL trong poll response
            const pollData = [[targetMediaId, 'proj-123', 'task-1', 'CAE']];
            const raw = makeBatchexecuteSuccessResponse(RPC_OPERATION, pollData);
            return { ok: true, status: 200, text: async () => raw, json: async () => ({}) };
          }
          if (url.includes(RPC_MEDIA)) {
            getMediaUrlCalled = true;
            const mediaData = [targetMediaId, expectedUrl];
            const raw = makeBatchexecuteSuccessResponse(RPC_MEDIA, mediaData);
            return { ok: true, status: 200, text: async () => raw, json: async () => ({}) };
          }
          return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      const res = await client.pollGeneration({
        operationId: opId,
        projectId: 'proj-123',
        targetAssetId: targetMediaId,
        pollIntervalMs: 20,
      });

      assert.strictEqual(res.state, 'completed');
      assert.strictEqual(res.videoUrl, expectedUrl);
      assert.strictEqual(getMediaUrlCalled, true, 'Phải tự động gọi as29s để lấy link video khi poll không có inline URL');
    });

    await it('Dừng ngay lập tức khi sử dụng AbortController signal', async () => {
      const controller = new AbortController();
      const adapter = createMockSessionAdapter({
        fetchHandler: async () => {
          const raw = makeBatchexecuteSuccessResponse(RPC_OPERATION, [['op-sig', 'RUNNING']]);
          return { ok: true, status: 200, text: async () => raw, json: async () => ({}) };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      const pollPromise = client.pollGeneration({
        operationId: 'op-sig',
        projectId: 'proj-123',
        pollIntervalMs: 500,
        signal: controller.signal,
      });

      // Huỷ sau 30ms
      setTimeout(() => controller.abort(), 30);

      await assert.rejects(
        async () => {
          await pollPromise;
        },
        (err: any) => {
          assert.ok(err instanceof GoogleFlowRpcError);
          assert.strictEqual(err.code, 'CANCELLED');
          return true;
        }
      );
    });

    await it('extractPollStatus khớp chính xác operation ID không phải định dạng UUID 36 ký tự', () => {
      const nonUuidOp = 'operations/custom_op_name_999';
      const pollData = [[nonUuidOp, 'proj-custom', 'task-1', 'CAE']];
      const status = extractPollStatus(pollData, nonUuidOp);

      assert.strictEqual(status.operationId, nonUuidOp);
      assert.strictEqual(status.status, 'CAE');
      assert.strictEqual(status.done, true);
    });

    await it('extractPollStatus không bị ghi đè CAE bởi các node UUID phụ không liên quan trong response', () => {
      const targetOp = 'target-operation-uuid-123';
      const pollData = [
        [targetOp, 'proj-correct', 'task-1', 'CAE'],
        ['11111111-2222-3333-4444-555555555555', 'extraneous-proj', 0, 1],
      ];
      const status = extractPollStatus(pollData, targetOp);

      assert.strictEqual(status.operationId, targetOp);
      assert.strictEqual(status.status, 'CAE');
      assert.strictEqual(status.projectId, 'proj-correct');
      assert.strictEqual(status.done, true);
    });

    await it('extractPollStatus nhận diện được status ở vị trí index 1 (ví dụ [opId, FAILED, error])', () => {
      const opId = 'op-fail-index1';
      const pollData = [[opId, 'FAILED', 'Image generation rejected by prompt moderation', 'extra-node']];
      const status = extractPollStatus(pollData, opId);

      assert.strictEqual(status.operationId, opId);
      assert.strictEqual(status.status, 'FAILED');
      assert.strictEqual(status.done, false);
      assert.ok(status.error?.includes('Image generation rejected'));
    });

    await it('Vòng đời Polling duy trì trạng thái queued khi server trả về QUEUED hoặc PENDING', async () => {
      let pollCallCount = 0;
      const observedStates: string[] = [];

      const adapter = createMockSessionAdapter({
        fetchHandler: async () => {
          pollCallCount++;
          if (pollCallCount === 1) {
            const raw = makeBatchexecuteSuccessResponse(RPC_OPERATION, [['op-queued-lifecycle', 'QUEUED']]);
            return { ok: true, status: 200, text: async () => raw, json: async () => ({}) };
          }
          if (pollCallCount === 2) {
            const raw = makeBatchexecuteSuccessResponse(RPC_OPERATION, [['op-queued-lifecycle', 'RUNNING']]);
            return { ok: true, status: 200, text: async () => raw, json: async () => ({}) };
          }
          const raw = makeBatchexecuteSuccessResponse(RPC_OPERATION, [
            ['op-queued-lifecycle', 'CAE'],
            'https://flow-content.google/video/done.mp4',
          ]);
          return { ok: true, status: 200, text: async () => raw, json: async () => ({}) };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      await client.pollGeneration({
        operationId: 'op-queued-lifecycle',
        projectId: 'proj-123',
        pollIntervalMs: 15,
        onProgress: (info) => {
          observedStates.push(info.state);
        },
      });

      assert.ok(observedStates.includes('queued'), 'Phải giữ nguyên trạng thái queued khi server trả về QUEUED');
      assert.ok(observedStates.includes('processing'), 'Phải chuyển sang processing sau khi server chuyển RUNNING');
      assert.ok(observedStates.includes('completed'), 'Phải hoàn tất completed');
    });

    await it('Tác vụ generation thất bại với lỗi FAILED/terminal dừng polling ngay lập tức không bị nuốt bởi retry loop', async () => {
      let pollCount = 0;
      const adapter = createMockSessionAdapter({
        fetchHandler: async () => {
          pollCount++;
          // Server báo tác vụ thất bại vĩnh viễn
          const raw = makeBatchexecuteSuccessResponse(RPC_OPERATION, [
            ['op-dead-task', 'FAILED', 'Internal generation pipeline failed with backend error'],
          ]);
          return { ok: true, status: 200, text: async () => raw, json: async () => ({}) };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      await assert.rejects(
        async () => {
          await client.pollGeneration({
            operationId: 'op-dead-task',
            pollIntervalMs: 20,
            timeoutMs: 3000,
          });
        },
        (err: any) => {
          assert.ok(err instanceof GoogleFlowRpcError);
          assert.strictEqual(err.retryable, false, 'Lỗi terminal từ tác vụ không được phép retry loop tiếp');
          return true;
        }
      );
      assert.strictEqual(pollCount, 1, 'Chỉ được poll đúng 1 lần rồi ném lỗi ngay khi tác vụ đã FAILED');
    });

    await it('pollOperation hỗ trợ truyền callback onProgress ở vị trí tham số thứ 2 khi bỏ qua projectId', async () => {
      let progressReported = false;
      const adapter = createMockSessionAdapter({
        fetchHandler: async () => {
          const raw = makeBatchexecuteSuccessResponse(RPC_OPERATION, [
            ['op-2arg', 'CAE'],
            'https://flow-content.google/video/2arg.mp4',
          ]);
          return { ok: true, status: 200, text: async () => raw, json: async () => ({}) };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      const res = await client.pollOperation('op-2arg', (pct, msg) => {
        progressReported = true;
      });

      assert.strictEqual(res.operationId, 'op-2arg');
      assert.strictEqual(res.done, true);
      assert.strictEqual(progressReported, true, 'Callback onProgress truyền ở vị trí thứ 2 phải được thực thi');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUITE 5: Structured Error Handling & Classification
  // ══════════════════════════════════════════════════════════════════════════
  await describe('5. Structured Error Handling & Classification', async () => {
    await it('Phân loại chính xác SESSION_EXPIRED (HTTP 401 hoặc redirect URL)', () => {
      const err401 = classifyFlowRpcError(new Error('Unauthorized'), { httpStatus: 401 });
      assert.strictEqual(err401.code, 'SESSION_EXPIRED');
      assert.strictEqual(err401.retryable, false);
      assert.strictEqual(err401.suggestedAction, 'REAUTH_REQUIRED');

      const errRedirect = classifyFlowRpcError(new Error('Redirected to https://flow.google.com/about'));
      assert.strictEqual(errRedirect.code, 'SESSION_EXPIRED');
      assert.strictEqual(errRedirect.retryable, false);

      const errCookie = classifyFlowRpcError(new Error('Cookie string rỗng — session chưa đăng nhập'));
      assert.strictEqual(errCookie.code, 'SESSION_EXPIRED');
      assert.strictEqual(errCookie.retryable, false);
    });

    await it('Phân loại chính xác RATE_LIMITED (HTTP 429) và bóc tách retryAfterMs', () => {
      const err429 = classifyFlowRpcError(new Error('HTTP 429: Too Many Requests'), { httpStatus: 429 });
      assert.strictEqual(err429.code, 'RATE_LIMITED');
      assert.strictEqual(err429.retryable, true);
      assert.strictEqual(err429.suggestedAction, 'RETRY_WITH_BACKOFF');

      const errSlowDown = classifyFlowRpcError(new Error('Rate limit exceeded: Please try again in 12s'));
      assert.strictEqual(errSlowDown.code, 'RATE_LIMITED');
      assert.strictEqual(errSlowDown.retryable, true);
      assert.strictEqual(errSlowDown.retryAfterMs, 12000, 'Phải trích xuất được 12000ms');
    });

    await it('Phân loại chính xác CONTENT_POLICY_VIOLATION / CONTENT_REJECTED', () => {
      const errPolicy = classifyFlowRpcError(new Error('Generation blocked by safety filter: policy violation detected'));
      assert.strictEqual(errPolicy.code, 'CONTENT_POLICY_VIOLATION');
      assert.strictEqual(errPolicy.retryable, false);
      assert.strictEqual(errPolicy.suggestedAction, 'ABORT_HALT');

      const errCannotGen = classifyFlowRpcError(new Error('Google Flow cannot generate this image due to sensitive content'));
      assert.strictEqual(errCannotGen.code, 'CONTENT_POLICY_VIOLATION');
      assert.strictEqual(errCannotGen.retryable, false);
    });

    await it('Phân loại chính xác UPSTREAM_ERROR (5xx Server Error)', () => {
      const err500 = classifyFlowRpcError(new Error('500 Internal Server Error'), { httpStatus: 500 });
      assert.strictEqual(err500.code, 'UPSTREAM_ERROR');
      assert.strictEqual(err500.retryable, true);

      const err503 = classifyFlowRpcError(new Error('503 Service Unavailable'), { httpStatus: 503 });
      assert.strictEqual(err503.code, 'UPSTREAM_ERROR');
      assert.strictEqual(err503.retryable, true);
    });

    await it('Phân loại chính xác OUT_OF_CREDITS', () => {
      const errCredits = classifyFlowRpcError(new Error('Tài khoản đã hết tín dụng / out of credits'));
      assert.strictEqual(errCredits.code, 'OUT_OF_CREDITS');
      assert.strictEqual(errCredits.retryable, false);
    });

    await it('Terminal error trong polling state machine lập tức dừng mà không tiếp tục loop', async () => {
      let pollAttempt = 0;
      const adapter = createMockSessionAdapter({
        fetchHandler: async () => {
          pollAttempt++;
          // Giả lập trả về 401 Session Expired ngay lần đầu
          return {
            ok: false,
            status: 401,
            text: async () => 'Session Expired',
            json: async () => ({}),
          };
        },
      });

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });

      await assert.rejects(
        async () => {
          await client.pollGeneration({
            operationId: 'op-session-fail',
            projectId: 'proj-123',
            pollIntervalMs: 20,
          });
        },
        (err: any) => {
          assert.ok(err instanceof GoogleFlowRpcError);
          assert.strictEqual(err.code, 'SESSION_EXPIRED');
          assert.strictEqual(err.retryable, false);
          return true;
        }
      );

      assert.strictEqual(pollAttempt, 1, 'Lỗi terminal (SESSION_EXPIRED) phải dừng ngay, không poll tiếp');
    });

    await it('Phân loại chính xác CONTENT_REJECTED và kiểm tra getter isContentPolicyViolation', () => {
      const errRejected = classifyFlowRpcError(new Error('Flow generation prompt content_rejected by moderation'));
      assert.strictEqual(errRejected.code, 'CONTENT_REJECTED');
      assert.strictEqual(errRejected.retryable, false);
      assert.strictEqual(errRejected.isContentPolicyViolation, true);
    });

    await it('Phân loại lỗi khi cửa sổ BrowserWindow bị đóng (Object has been destroyed)', () => {
      const errDestroyed = classifyFlowRpcError(new Error('Object has been destroyed'));
      assert.strictEqual(errDestroyed.code, 'SESSION_EXPIRED');
      assert.strictEqual(errDestroyed.retryable, false);

      const errFrameDisposed = classifyFlowRpcError(new Error('Render frame was disposed before WebFrame was created'));
      assert.strictEqual(errFrameDisposed.code, 'SESSION_EXPIRED');
    });

    await it('Xử lý lỗi khi reCAPTCHA Enterprise không khả dụng (chuyển thành UPSTREAM_ERROR retryable)', async () => {
      const adapter = createMockSessionAdapter({});
      adapter.executeJavaScript = async () => {
        throw new Error('grecaptcha.enterprise not available sau thời gian chờ.');
      };

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      await assert.rejects(
        async () => {
          await client.mintCaptchaToken(null, CAPTCHA_ACTION_IMAGE);
        },
        (err: any) => {
          assert.ok(err instanceof GoogleFlowRpcError);
          assert.strictEqual(err.code, 'UPSTREAM_ERROR');
          assert.strictEqual(err.retryable, true);
          return true;
        }
      );
    });

    await it('Singleton helper getGoogleFlowRpcClient hỗ trợ cấu hình qua options object', () => {
      const customClient = getGoogleFlowRpcClient({
        partition: 'persist:configured_partition',
        maxRetries: 5,
      });
      assert.ok(customClient instanceof GoogleFlowRpcClient);
      assert.strictEqual(customClient.partition, 'persist:configured_partition');
    });

    await it('Phân loại chính xác các biến thể chính sách an toàn (prompt_blocked, safety, nsfw, content_filter)', () => {
      const errBlocked = classifyFlowRpcError(new Error('Prompt was prompt_blocked by backend safety model'));
      assert.strictEqual(errBlocked.code, 'CONTENT_POLICY_VIOLATION');
      assert.strictEqual(errBlocked.retryable, false);

      const errNsfw = classifyFlowRpcError(new Error('Image generation rejected: NSFW filter triggered'));
      assert.strictEqual(errNsfw.code, 'CONTENT_POLICY_VIOLATION');

      const errFilter = classifyFlowRpcError(new Error('Content blocked by content_filter'));
      assert.strictEqual(errFilter.code, 'CONTENT_POLICY_VIOLATION');
    });

    await it('Singleton helper getGoogleFlowRpcClient.reset() xoá bỏ instance hiện hành', () => {
      const c1 = getGoogleFlowRpcClient('persist:singleton_test');
      assert.strictEqual(c1.partition, 'persist:singleton_test');
      getGoogleFlowRpcClient.reset();
      const c2 = getGoogleFlowRpcClient('persist:singleton_fresh');
      assert.strictEqual(c2.partition, 'persist:singleton_fresh');
      assert.notStrictEqual(c1, c2, 'Sau khi reset phải tạo instance mới');
    });

    await it('Phân loại chính xác SESSION_EXPIRED khi HTTP 403 Forbidden hoặc lỗi CSRF/XSRF', () => {
      const err403 = classifyFlowRpcError(new Error('Forbidden'), { httpStatus: 403 });
      assert.strictEqual(err403.code, 'SESSION_EXPIRED');
      assert.strictEqual(err403.retryable, false);

      const errCsrf = classifyFlowRpcError(new Error('XSRF token validation failed for session'));
      assert.strictEqual(errCsrf.code, 'SESSION_EXPIRED');
      assert.strictEqual(errCsrf.retryable, false);
    });

    await it('callFlowRPC tự động xoá cache atToken khi gặp lỗi SESSION_EXPIRED', async () => {
      let evalCallCount = 0;
      const adapter = createMockSessionAdapter({
        atToken: 'cached-token-to-be-invalidated',
      });
      const origEval = adapter.executeJavaScript;
      adapter.executeJavaScript = async (code: string) => {
        if (code.includes('WIZ_global_data')) {
          evalCallCount++;
        }
        return origEval(code);
      };

      adapter.fetch = async () => {
        // Trả về lỗi 401 Session Expired
        return {
          ok: false,
          status: 401,
          text: async () => 'Session expired',
          json: async () => ({}),
        };
      };

      const client = new GoogleFlowRpcClient({ sessionAdapter: adapter });
      client.invalidateAtTokenCache();

      // Gọi getAtToken lần 1 -> nạp vào cache (evalCallCount = 1)
      const token1 = await client.getAtToken();
      assert.strictEqual(token1, 'cached-token-to-be-invalidated');
      assert.strictEqual(evalCallCount, 1);

      // Gọi callFlowRPC -> gặp 401 -> phải tự động invalidate token cache
      await assert.rejects(
        async () => {
          await client.callFlowRPC(null, RPC_OPERATION, [null]);
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SESSION_EXPIRED');
          return true;
        }
      );

      // Gọi getAtToken lần nữa -> vì cache đã bị xoá, phải gọi lại executeJavaScript (evalCallCount = 2)
      await client.getAtToken();
      assert.strictEqual(evalCallCount, 2, 'Cache phải được xoá tự động sau khi gặp SESSION_EXPIRED');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SUMMARY REPORT
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(60));
  console.log(`${BOLD}KẾT QUẢ KIỂM THỬ TỰ ĐỘNG GOOGLE FLOW RPC CLIENT:${RESET}`);
  console.log(`Tổng số tests:   ${totalTests}`);
  console.log(`Thành công:      ${GREEN}${passedTests}${RESET}`);
  console.log(`Thất bại:        ${failedTests === 0 ? GREEN : RED}${failedTests}${RESET}`);
  console.log('─'.repeat(60));

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Lỗi nghiêm trọng khi thực thi test suite:', err);
  process.exit(1);
});
