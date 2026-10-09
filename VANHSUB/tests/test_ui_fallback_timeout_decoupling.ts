/**
 * tests/test_ui_fallback_timeout_decoupling.ts
 *
 * Automated Programmatic Test Suite for UI Fallback Staged Timeouts & Decoupling:
 * - Suite 1: Staged Timeout Calculations & Hard Cap Clamping (image vs video)
 * - Suite 2: Response Normalization & Error Code Mapping
 * - Suite 3: Bi-Directional AbortSignal Propagation & Cancellation
 * - Suite 4: End-to-End WebSocket Bridge Communication & Timing Simulation
 * - Suite 5: Injected Network Sniffer Multi-Channel & Early Warning Signal Verification
 *
 * Execution:
 *   npx tsx tests/test_ui_fallback_timeout_decoupling.ts
 */

import assert from 'assert';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  FlowBridgeServer,
  calculateUiGenTimeouts,
  normalizeUiGenResponse,
  TIMEOUT_SUBMISSION_MS,
  DEFAULT_IMAGE_PROCESSING_TIMEOUT_MS,
  MAX_IMAGE_PROCESSING_TIMEOUT_MS,
  DEFAULT_VIDEO_PROCESSING_TIMEOUT_MS,
  MAX_VIDEO_PROCESSING_TIMEOUT_MS,
  type TriggerUiGenParams,
  type TriggerUiGenResponse,
} from '../main/workflow/flow-engine/rpc/FlowBridgeServer';

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`  ${colors.green}✔${colors.reset} ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ${colors.red}✖${colors.reset} ${name}`);
      console.error(`    ${colors.red}${err.message}${colors.reset}`);
      failed++;
    }
  })();
}

async function runAllTests() {
  console.log(`\n${colors.bold}${colors.cyan}======================================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}  TEST SUITE: UI Fallback Timeout Decoupling & AbortSignal (M2)${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}======================================================================${colors.reset}\n`);

  // ---------------------------------------------------------------------------
  // SUITE 1: Staged Timeout Calculations & Boundary Clamping
  // ---------------------------------------------------------------------------
  console.log(`${colors.bold}Suite 1: Staged Timeout Calculations & Boundary Clamping${colors.reset}`);

  await it('1.1 Should calculate default image timeouts correctly (6s submission, 40s processing)', () => {
    const res = calculateUiGenTimeouts('image');
    assert.strictEqual(res.submissionTimeoutMs, 6000);
    assert.strictEqual(res.processingTimeoutMs, 40000);
    assert.strictEqual(res.totalClientTimeoutMs, 46000);
    assert.strictEqual(res.serverGuardTimeoutMs, 49000);
  });

  await it('1.2 Should clamp custom image timeout exceeding 50s hard cap down to 50s', () => {
    const res = calculateUiGenTimeouts('image', 70000);
    assert.strictEqual(res.submissionTimeoutMs, 6000);
    assert.strictEqual(res.processingTimeoutMs, 50000); // Clamped to MAX_IMAGE_PROCESSING_TIMEOUT_MS
    assert.strictEqual(res.totalClientTimeoutMs, 56000);
    assert.strictEqual(res.serverGuardTimeoutMs, 59000);
  });

  await it('1.3 Should preserve custom image timeout within safe bounds (<50s)', () => {
    const res = calculateUiGenTimeouts('image', 25000);
    assert.strictEqual(res.submissionTimeoutMs, 6000);
    assert.strictEqual(res.processingTimeoutMs, 25000);
    assert.strictEqual(res.totalClientTimeoutMs, 31000);
  });

  await it('1.4 Should calculate default video timeouts correctly (6s submission, 120s processing)', () => {
    const res = calculateUiGenTimeouts('video');
    assert.strictEqual(res.submissionTimeoutMs, 6000);
    assert.strictEqual(res.processingTimeoutMs, 120000);
    assert.strictEqual(res.totalClientTimeoutMs, 126000);
    assert.strictEqual(res.serverGuardTimeoutMs, 129000);
  });

  await it('1.5 Should clamp custom video timeout exceeding 135s hard cap down to 135s', () => {
    const res = calculateUiGenTimeouts('video', 180000);
    assert.strictEqual(res.submissionTimeoutMs, 6000);
    assert.strictEqual(res.processingTimeoutMs, 135000); // Clamped to MAX_VIDEO_PROCESSING_TIMEOUT_MS
    assert.strictEqual(res.totalClientTimeoutMs, 141000);
    assert.strictEqual(res.serverGuardTimeoutMs, 144000);
  });

  await it('1.6 Should accept custom submission timeout override', () => {
    const res = calculateUiGenTimeouts('image', 30000, 4000);
    assert.strictEqual(res.submissionTimeoutMs, 4000);
    assert.strictEqual(res.processingTimeoutMs, 30000);
    assert.strictEqual(res.totalClientTimeoutMs, 34000);
  });

  // ---------------------------------------------------------------------------
  // SUITE 2: Response Normalization & Error Code Mapping
  // ---------------------------------------------------------------------------
  console.log(`\n${colors.bold}Suite 2: Response Normalization & Error Code Mapping${colors.reset}`);

  await it('2.1 Should normalize successful DOM fallback image extraction to COMPLETED', () => {
    const raw = {
      ok: true,
      domFallback: true,
      firstImageUrl: 'https://lh3.googleusercontent.com/test-extracted.jpg',
    };
    const norm = normalizeUiGenResponse(raw);
    assert.strictEqual(norm.ok, true);
    assert.strictEqual(norm.state, 'COMPLETED');
    assert.strictEqual(norm.firstImageUrl, 'https://lh3.googleusercontent.com/test-extracted.jpg');
    assert.strictEqual(norm.domFallback, true);
  });

  await it('2.2 Should normalize TIMEOUT_SUBMITTING to state TIMED_OUT and errorCode TIMEOUT_SUBMITTING', () => {
    const raw = { ok: false, error: 'TIMEOUT_SUBMITTING: Form input not accepted in 6s' };
    const norm = normalizeUiGenResponse(raw);
    assert.strictEqual(norm.ok, false);
    assert.strictEqual(norm.state, 'TIMED_OUT');
    assert.strictEqual(norm.errorCode, 'TIMEOUT_SUBMITTING');
  });

  await it('2.3 Should normalize legacy TIMEOUT_WAITING_RPC to state TIMED_OUT and errorCode TIMEOUT_PROCESSING', () => {
    const raw = { ok: false, error: 'TIMEOUT_WAITING_RPC' };
    const norm = normalizeUiGenResponse(raw);
    assert.strictEqual(norm.ok, false);
    assert.strictEqual(norm.state, 'TIMED_OUT');
    assert.strictEqual(norm.errorCode, 'TIMEOUT_PROCESSING');
  });

  await it('2.4 Should normalize PUBLIC_ERROR_UNUSUAL_ACTIVITY to state BLOCKED_REQUIRES_USER', () => {
    const raw = { ok: false, error: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY: bot challenge required' };
    const norm = normalizeUiGenResponse(raw);
    assert.strictEqual(norm.ok, false);
    assert.strictEqual(norm.state, 'BLOCKED_REQUIRES_USER');
    assert.strictEqual(norm.errorCode, 'BLOCKED_REQUIRES_USER');
  });

  await it('2.5 Should normalize RATE_LIMITED error to state FAILED and errorCode RATE_LIMITED', () => {
    const raw = { ok: false, error: 'RATE_LIMITED: 429 quota exceeded' };
    const norm = normalizeUiGenResponse(raw);
    assert.strictEqual(norm.ok, false);
    assert.strictEqual(norm.state, 'FAILED');
    assert.strictEqual(norm.errorCode, 'RATE_LIMITED');
  });

  await it('2.6 Should handle null/undefined payload gracefully without throwing', () => {
    const norm = normalizeUiGenResponse(null);
    assert.strictEqual(norm.ok, false);
    assert.strictEqual(norm.state, 'FAILED');
    assert.strictEqual(norm.errorCode, 'UI_AUTOMATION_FAILED');
  });

  // ---------------------------------------------------------------------------
  // SUITE 3: Bi-Directional AbortSignal Propagation & Cancellation
  // ---------------------------------------------------------------------------
  console.log(`\n${colors.bold}Suite 3: Bi-Directional AbortSignal & Cancellation${colors.reset}`);

  await it('3.1 Pre-aborted signal returns immediately without network roundtrip', async () => {
    const controller = new AbortController();
    controller.abort('User pre-cancelled');
    const server = FlowBridgeServer.getInstance();

    const res = await server.triggerUiGen(
      { prompt: 'a cat', mode: 'image' },
      controller.signal
    );

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.state, 'TIMED_OUT');
    assert.strictEqual(res.error, 'ABORTED');
  });

  await it('3.2 Mid-flight abort emits cancel_ui_gen over WebSocket and resolves cleanly', async () => {
    const testPort = 9876;
    const mockWss = new WebSocketServer({ port: testPort });
    let receivedCancelMsg: any = null;
    let receivedTriggerMsg: any = null;

    mockWss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'trigger_ui_gen') {
          receivedTriggerMsg = msg;
        } else if (msg.method === 'cancel_ui_gen') {
          receivedCancelMsg = msg;
        }
      });
    });

    const clientWs = new WebSocket(`ws://127.0.0.1:${testPort}`);
    await new Promise((r) => clientWs.on('open', r));

    const bridge = FlowBridgeServer.getInstance();
    bridge.registerClient(clientWs);

    const controller = new AbortController();
    const genPromise = bridge.triggerUiGen(
      { prompt: 'cinematic mountain landscape', mode: 'image' },
      controller.signal
    );

    await new Promise((r) => setTimeout(r, 60));
    assert.ok(receivedTriggerMsg, 'trigger_ui_gen frame should have been sent to client');
    assert.strictEqual(receivedTriggerMsg.params.prompt, 'cinematic mountain landscape');

    // Fire abort mid-flight:
    controller.abort('User pressed stop button');

    const res = await genPromise;
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.state, 'TIMED_OUT');
    assert.strictEqual(res.error, 'ABORTED');

    await new Promise((r) => setTimeout(r, 60));
    assert.ok(receivedCancelMsg, 'cancel_ui_gen should have been emitted over WebSocket');
    assert.strictEqual(receivedCancelMsg.params.id, receivedTriggerMsg.id);
    assert.strictEqual(receivedCancelMsg.params.reason, 'User pressed stop button');

    clientWs.close();
    mockWss.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  await it('3.3 Standalone cancelUiGen method emits cancellation WebSocket frame', async () => {
    const testPort = 9877;
    const mockWss = new WebSocketServer({ port: testPort });
    let emittedCancel: any = null;

    mockWss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'cancel_ui_gen') {
          emittedCancel = msg;
        }
      });
    });

    const clientWs = new WebSocket(`ws://127.0.0.1:${testPort}`);
    await new Promise((r) => clientWs.on('open', r));

    const bridge = FlowBridgeServer.getInstance();
    bridge.registerClient(clientWs);

    const success = bridge.cancelUiGen('task-id-abc-123', 'Job replaced by user');
    assert.strictEqual(success, true);

    await new Promise((r) => setTimeout(r, 60));
    assert.ok(emittedCancel);
    assert.strictEqual(emittedCancel.params.id, 'task-id-abc-123');
    assert.strictEqual(emittedCancel.params.reason, 'Job replaced by user');

    clientWs.close();
    mockWss.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  // ---------------------------------------------------------------------------
  // SUITE 4: End-to-End WebSocket Bridge Communication & Timing Simulation
  // ---------------------------------------------------------------------------
  console.log(`\n${colors.bold}Suite 4: End-to-End WebSocket Bridge Communication & Timing${colors.reset}`);

  await it('4.1 Staged timeout parameters are passed correctly to Extension in params', async () => {
    const testPort = 9878;
    const mockWss = new WebSocketServer({ port: testPort });
    let receivedPayload: any = null;

    mockWss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'trigger_ui_gen') {
          receivedPayload = msg;
          // Reply with mock DOM card:
          ws.send(JSON.stringify({
            id: msg.id,
            result: {
              ok: true,
              domFallback: true,
              firstImageUrl: 'https://lh3.googleusercontent.com/generated-shot.webp',
            },
          }));
        }
      });
    });

    const clientWs = new WebSocket(`ws://127.0.0.1:${testPort}`);
    await new Promise((r) => clientWs.on('open', r));

    const bridge = FlowBridgeServer.getInstance();
    bridge.registerClient(clientWs);

    const res = await bridge.triggerUiGen({
      prompt: 'cyberpunk street at neon night',
      mode: 'image',
      timeoutMs: 45000,
      submissionTimeoutMs: 5000,
    });

    assert.ok(receivedPayload);
    assert.strictEqual(receivedPayload.params.submissionTimeoutMs, 5000);
    assert.strictEqual(receivedPayload.params.processingTimeoutMs, 45000);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.state, 'COMPLETED');
    assert.strictEqual(res.firstImageUrl, 'https://lh3.googleusercontent.com/generated-shot.webp');

    clientWs.close();
    mockWss.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  await it('4.2 Legacy positional arguments (prompt, timeoutMs, projectId, mode, signal) are normalized', async () => {
    const testPort = 9879;
    const mockWss = new WebSocketServer({ port: testPort });
    let receivedPayload: any = null;

    mockWss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'trigger_ui_gen') {
          receivedPayload = msg;
          ws.send(JSON.stringify({
            id: msg.id,
            result: {
              ok: true,
              videoUrl: 'https://storage.googleapis.com/test-bucket/video.mp4',
            },
          }));
        }
      });
    });

    const clientWs = new WebSocket(`ws://127.0.0.1:${testPort}`);
    await new Promise((r) => clientWs.on('open', r));

    const bridge = FlowBridgeServer.getInstance();
    bridge.registerClient(clientWs);

    const res = await bridge.triggerUiGen(
      'drone flying over waterfall',
      120000,
      'proj-12345',
      'video'
    );

    assert.ok(receivedPayload);
    assert.strictEqual(receivedPayload.params.prompt, 'drone flying over waterfall');
    assert.strictEqual(receivedPayload.params.projectId, 'proj-12345');
    assert.strictEqual(receivedPayload.params.mode, 'video');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.state, 'COMPLETED');
    assert.strictEqual(res.videoUrl, 'https://storage.googleapis.com/test-bucket/video.mp4');

    clientWs.close();
    mockWss.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  // ---------------------------------------------------------------------------
  // SUITE 5: Injected Network Sniffer Multi-Channel & Early Warning
  // ---------------------------------------------------------------------------
  console.log(`\n${colors.bold}Suite 5: Injected Network Sniffer Multi-Channel & Early Warning Signals${colors.reset}`);

  await it('5.1 Injected.js sniffer data structures and sensitive header sanitization', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const vm = await import('vm');

    let dispatchedEvents: any[] = [];
    const windowMock: any = {
      fetch: null,
      addEventListener() {},
      dispatchEvent(event: any) {
        dispatchedEvents.push(event);
      },
    };

    const injectedCode = fs.readFileSync(path.join(process.cwd(), 'extension/injected.js'), 'utf-8');

    class CustomEvent {
      type: string;
      detail: any;
      constructor(type: string, opts: any) {
        this.type = type;
        this.detail = opts?.detail;
      }
    }

    const sandbox: any = {
      window: windowMock,
      console: { log() {}, warn() {}, error() {} },
      CustomEvent,
      setTimeout,
      clearTimeout,
      Date,
      JSON,
      String,
      Object,
      Array,
      module: {},
      process: { versions: { node: '20.0.0' } },
    };

    let fetchResponseText = 'test-response';
    let fetchStatus = 200;
    sandbox.window.fetch = async (url: string, opts?: any) => ({
      status: fetchStatus,
      clone: () => ({
        text: async () => fetchResponseText,
      }),
    });

    vm.createContext(sandbox);
    vm.runInContext(injectedCode, sandbox);

    // 1. Check data structures
    assert.ok(sandbox.window.__VANHSUB_SNIFFER__, '__VANHSUB_SNIFFER__ should be initialized');
    assert.ok(Array.isArray(sandbox.window.__VANHSUB_SNIFFER__.history), 'history should be array');
    assert.ok(Array.isArray(sandbox.window.__VANHSUB_SNIFFER__.trpcHistory), 'trpcHistory should be array');
    assert.ok(Array.isArray(sandbox.window.__VANHSUB_SNIFFER__.mediaUrls), 'mediaUrls should be array');
    assert.strictEqual(sandbox.window.__VANHSUB_SNIFFER__.botFlagged, false, 'botFlagged should default to false');

    // 2. Test TRPC call with sensitive headers
    await sandbox.window.fetch('https://flow.google.com/fx/api/trpc/media.poll?batch=1', {
      method: 'POST',
      headers: {
        'cookie': 'SECRET_SESSION_TOKEN',
        'authorization': 'Bearer TOP_SECRET',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query: 'test' }),
    });

    assert.strictEqual(sandbox.window.__VANHSUB_SNIFFER__.trpcHistory.length, 1);
    const trpcEntry = sandbox.window.__VANHSUB_SNIFFER__.trpcHistory[0];
    assert.strictEqual(trpcEntry.trpcPath, 'media.poll');
    assert.strictEqual(trpcEntry.headers['cookie'], undefined, 'Cookie must be sanitized');
    assert.strictEqual(trpcEntry.headers['authorization'], undefined, 'Authorization must be sanitized');
    assert.strictEqual(trpcEntry.headers['content-type'], 'application/json', 'Safe headers must be preserved');

    // 3. Test Early Warning on HTTP 429
    fetchStatus = 429;
    fetchResponseText = 'Rate limit exceeded: too many requests';
    await sandbox.window.fetch('https://flow.google.com/batchexecute?rpcids=ogiZ0b');

    // Wait for clone().text() promise resolution
    await new Promise((r) => setTimeout(r, 20));

    assert.ok(sandbox.window.__VANHSUB_SNIFFER__.lastWarning, 'lastWarning should be set');
    assert.strictEqual(sandbox.window.__VANHSUB_SNIFFER__.lastWarning.code, 'RATE_LIMITED');
    const warningEvent = dispatchedEvents.find((e) => e.type === 'VANHSUB_EARLY_WARNING');
    assert.ok(warningEvent, 'VANHSUB_EARLY_WARNING event should be dispatched');
    assert.strictEqual(warningEvent.detail.code, 'RATE_LIMITED');

    // 4. Test Early Warning on PUBLIC_ERROR_UNUSUAL_ACTIVITY
    fetchStatus = 200;
    fetchResponseText = ')]}\'\n\n[["wrb.fr","error","PUBLIC_ERROR_UNUSUAL_ACTIVITY"]]';
    await sandbox.window.fetch('https://flow.google.com/batchexecute?rpcids=ogiZ0b');
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(sandbox.window.__VANHSUB_SNIFFER__.botFlagged, true, 'botFlagged should be true');
    assert.strictEqual(sandbox.window.__VANHSUB_SNIFFER__.lastWarning.code, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY');
  });

  console.log(`\n${colors.bold}======================================================================${colors.reset}`);
  console.log(`  ${colors.bold}RESULTS: Passed: ${passed} | Failed: ${failed}${colors.reset}`);
  console.log(`${colors.bold}======================================================================${colors.reset}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Test execution fatal error:', err);
  process.exit(1);
});
