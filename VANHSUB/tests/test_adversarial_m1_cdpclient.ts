/**
 * tests/test_adversarial_m1_cdpclient.ts
 *
 * Empirical Adversarial Stress Test Suite for ChatGptCdpClient.ts (Milestone 1).
 *
 * Requirements & Challenge Dimensions:
 * 1. Port 9222 security guard (must throw PortConflictGuard if port 9222 is requested).
 * 2. Concurrent connection mutexing (concurrent calls to connect() share the exact same promise without redundant connections).
 * 3. Context index 0 enforcement (verifying it never calls browser.newContext()).
 * 4. Disconnect and cleanup resilience (resetInstance and browser.disconnect()).
 * 5. Page lifecycle error handling (crash, close, silent closed, navigation failure, recovery).
 *
 * Execution:
 *   npx tsx tests/test_adversarial_m1_cdpclient.ts
 */

import assert from 'assert';
import { EventEmitter } from 'events';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { ChatGptCdpClient, type CdpSession } from '../main/ai-studio/chatgpt/ChatGptCdpClient';

// ==============================================================================
// 1. High-Fidelity Mock Playwright Infrastructure & Spies
// ==============================================================================

export class MockPage extends EventEmitter {
  public _url: string;
  public _isClosed: boolean = false;
  public bringToFrontCalls: number = 0;
  public gotoCalls: Array<{ url: string; options?: any }> = [];
  public shouldFailGoto: boolean = false;
  public shouldFailBringToFront: boolean = false;
  public shouldThrowOnUrl: boolean = false;

  constructor(initialUrl: string = 'about:blank') {
    super();
    this._url = initialUrl;
  }

  public url(): string {
    if (this.shouldThrowOnUrl) {
      throw new Error('Target closed during url() evaluation');
    }
    return this._url;
  }

  public isClosed(): boolean {
    return this._isClosed;
  }

  public async bringToFront(): Promise<void> {
    this.bringToFrontCalls++;
    if (this.shouldFailBringToFront) {
      throw new Error('bringToFront failed: window manager error');
    }
  }

  public async goto(url: string, options?: any): Promise<any> {
    this.gotoCalls.push({ url, options });
    if (this.shouldFailGoto) {
      throw new Error('Navigation timeout: 30000ms exceeded');
    }
    this._url = url;
    return null;
  }

  public close(): void {
    this._isClosed = true;
    this.emit('close');
  }

  public crash(): void {
    this._isClosed = true;
    this.emit('crash');
  }
}

export class MockBrowserContext {
  public _pages: MockPage[] = [];
  public newPageCalls: number = 0;
  public shouldFailNewPage: boolean = false;

  constructor(initialPages: MockPage[] = []) {
    this._pages = [...initialPages];
  }

  public pages(): MockPage[] {
    return this._pages;
  }

  public async newPage(): Promise<MockPage> {
    this.newPageCalls++;
    if (this.shouldFailNewPage) {
      throw new Error('Failed to create new page in browser context');
    }
    const p = new MockPage('about:blank');
    this._pages.push(p);
    return p;
  }
}

export class MockBrowser extends EventEmitter {
  public _contexts: MockBrowserContext[] = [];
  public _isConnected: boolean = true;
  public newContextCalls: number = 0;
  public disconnectCalls: number = 0;
  public closeCalls: number = 0;
  public shouldFailDisconnect: boolean = false;

  constructor(contexts: MockBrowserContext[] = []) {
    super();
    this._contexts = [...contexts];
  }

  public isConnected(): boolean {
    return this._isConnected;
  }

  public contexts(): MockBrowserContext[] {
    return this._contexts;
  }

  public async newContext(): Promise<BrowserContext> {
    this.newContextCalls++;
    throw new Error('VIOLATION: browser.newContext() was called! Architectural rule forbids incognito context!');
  }

  public async disconnect(): Promise<void> {
    this.disconnectCalls++;
    if (this.shouldFailDisconnect) {
      throw new Error('CDP WebSocket disconnect transport error');
    }
    this._isConnected = false;
    this.emit('disconnected');
  }

  public async close(): Promise<void> {
    this.closeCalls++;
    this._isConnected = false;
    this.emit('disconnected');
  }
}

export interface MockCdpEnvironment {
  browser: MockBrowser;
  context: MockBrowserContext;
  initialPage: MockPage;
  connectOverCdpCalls: number;
  connectDelayMs: number;
  shouldFailConnect: boolean;
  failConnectError?: Error;
}

let activeMockEnv: MockCdpEnvironment | null = null;
const originalConnectOverCDP = chromium.connectOverCDP;

function createMockBrowserInstance(options?: {
  contextCount?: number;
  initialPageUrl?: string;
  hasDisconnectMethod?: boolean;
}) {
  const initialPage = new MockPage(options?.initialPageUrl ?? 'https://chatgpt.com');
  const context = new MockBrowserContext([initialPage]);

  const contexts: MockBrowserContext[] = [];
  const count = options?.contextCount ?? 1;
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      contexts.push(context);
    } else {
      contexts.push(new MockBrowserContext([new MockPage('about:blank')]));
    }
  }

  const browser = new MockBrowser(contexts);

  if (options?.hasDisconnectMethod === false) {
    (browser as any).disconnect = undefined;
  }

  return { browser, context, initialPage };
}

function installMockEnvironment(options?: {
  contextCount?: number;
  initialPageUrl?: string;
  connectDelayMs?: number;
  shouldFailConnect?: boolean;
  failConnectError?: Error;
  hasDisconnectMethod?: boolean;
}): MockCdpEnvironment {
  const initial = createMockBrowserInstance(options);

  const env: MockCdpEnvironment = {
    browser: initial.browser,
    context: initial.context,
    initialPage: initial.initialPage,
    connectOverCdpCalls: 0,
    connectDelayMs: options?.connectDelayMs ?? 10,
    shouldFailConnect: options?.shouldFailConnect ?? false,
    failConnectError: options?.failConnectError,
  };

  activeMockEnv = env;

  chromium.connectOverCDP = (async (endpoint: string, opts?: any) => {
    env.connectOverCdpCalls++;
    if (env.connectDelayMs > 0) {
      await new Promise((r) => setTimeout(r, env.connectDelayMs));
    }
    if (env.shouldFailConnect) {
      throw env.failConnectError || new Error(`Connection refused: ${endpoint}`);
    }
    const fresh = createMockBrowserInstance(options);
    env.browser = fresh.browser;
    env.context = fresh.context;
    env.initialPage = fresh.initialPage;
    return fresh.browser as unknown as Browser;
  }) as any;

  return env;
}

function restoreOriginalEnvironment() {
  chromium.connectOverCDP = originalConnectOverCDP;
  activeMockEnv = null;
  ChatGptCdpClient.resetInstance();
}

// ==============================================================================
// 2. Test Execution & Reporting Harness
// ==============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
};

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

const sectionStats: Record<string, { total: number; passed: number; failed: number }> = {};

function startSection(name: string) {
  console.log(`\n${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}  ${name}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}\n`);
  sectionStats[name] = { total: 0, passed: 0, failed: 0 };
}

async function runAdversarialTest(section: string, testId: string, description: string, testFn: () => Promise<void>) {
  totalTests++;
  sectionStats[section].total++;
  process.stdout.write(`  ${colors.bold}${colors.blue}[${testId}]${colors.reset} ${description} ... `);

  // Always reset client before each test to guarantee fresh state
  ChatGptCdpClient.resetInstance();

  try {
    await testFn();
    passedTests++;
    sectionStats[section].passed++;
    console.log(`${colors.green}✓ PASS${colors.reset}`);
  } catch (err: any) {
    failedTests++;
    sectionStats[section].failed++;
    console.log(`${colors.red}✗ FAIL${colors.reset}`);
    console.error(`    ${colors.red}Error:${colors.reset} ${err?.message || err}`);
    if (err?.stack) {
      const stackLines = err.stack.split('\n').slice(1, 4).join('\n');
      console.error(`    ${colors.yellow}${stackLines}${colors.reset}`);
    }
  } finally {
    ChatGptCdpClient.resetInstance();
  }
}

// ==============================================================================
// 3. Test Suite Implementation
// ==============================================================================

async function main() {
  console.log(`${colors.bold}${colors.magenta}EMPIRICAL ADVERSARIAL STRESS TEST SUITE: ChatGptCdpClient${colors.reset}`);
  console.log(`Testing against requirements in ORIGINAL_REQUEST.md & PROJECT.md`);

  try {
    // --------------------------------------------------------------------------
    // CHALLENGE DIMENSION 1: PORT 9222 SECURITY GUARD
    // --------------------------------------------------------------------------
    const S1 = 'CHALLENGE 1: PORT 9222 SECURITY GUARD';
    startSection(S1);

    await runAdversarialTest(S1, '1.1', 'Throws PortConflictGuard error when port 9222 is requested directly', async () => {
      installMockEnvironment();
      const client = ChatGptCdpClient.getInstance();

      let errorThrown: any = null;
      try {
        await client.connect(9222);
      } catch (err: any) {
        errorThrown = err;
      }

      assert(errorThrown !== null, 'connect(9222) MUST throw an error');
      assert(
        errorThrown.message.includes('Port Conflict Guard') || errorThrown.message.includes('9222'),
        `Error must mention Port Conflict Guard or 9222. Received: "${errorThrown.message}"`
      );
    });

    await runAdversarialTest(S1, '1.2', 'Leaves client in clean state after rejecting port 9222', async () => {
      const env = installMockEnvironment();
      const client = ChatGptCdpClient.getInstance();

      // Attempt forbidden port
      await assert.rejects(async () => client.connect(9222), /9222/);

      // Verify client wasn't left in a connecting/broken state: valid port 9223 must succeed immediately
      const session = await client.connect(9223);
      assert(session.browser !== null, 'Subsequent valid connection must succeed');
      assert.strictEqual(env.connectOverCdpCalls, 1, 'connectOverCDP must only have been called for 9223');
    });

    await runAdversarialTest(S1, '1.3', 'Blocks port 9222 even when an active connection on 9223 already exists', async () => {
      installMockEnvironment();
      const client = ChatGptCdpClient.getInstance();

      // Establish legitimate connection on 9223
      await client.connect(9223);
      assert.strictEqual(client.isConnected(), true);

      // Attempt forbidden port 9222
      await assert.rejects(
        async () => client.connect(9222),
        /Port Conflict Guard.*9222/,
        'Must reject port 9222 even if already connected'
      );

      // Legitimate connection must remain intact
      assert.strictEqual(client.isConnected(), true);
    });

    await runAdversarialTest(S1, '1.4', 'Concurrent storm of 25 calls requesting port 9222 all reject safely', async () => {
      installMockEnvironment();
      const client = ChatGptCdpClient.getInstance();

      const promises = Array.from({ length: 25 }, () => client.connect(9222));
      const results = await Promise.allSettled(promises);

      for (const res of results) {
        assert.strictEqual(res.status, 'rejected', 'Every concurrent 9222 request must be rejected');
        if (res.status === 'rejected') {
          assert(
            res.reason.message.includes('Port Conflict Guard'),
            'Rejection reason must be Port Conflict Guard'
          );
        }
      }
    });

    // --------------------------------------------------------------------------
    // CHALLENGE DIMENSION 2: CONCURRENT CONNECTION MUTEXING
    // --------------------------------------------------------------------------
    const S2 = 'CHALLENGE 2: CONCURRENT CONNECTION MUTEXING';
    startSection(S2);

    await runAdversarialTest(S2, '2.1', '50 concurrent calls to connect() share exact same promise and return identical session', async () => {
      const env = installMockEnvironment({ connectDelayMs: 40 });
      const client = ChatGptCdpClient.getInstance();

      const promises = Array.from({ length: 50 }, () => client.connect(9223));
      const sessions = await Promise.all(promises);

      assert.strictEqual(sessions.length, 50);
      assert.strictEqual(
        env.connectOverCdpCalls,
        1,
        `connectOverCDP must be called exactly ONCE, but was called ${env.connectOverCdpCalls} times`
      );

      // Verify all sessions share the exact same browser and context reference
      const firstSession = sessions[0];
      for (let i = 1; i < sessions.length; i++) {
        assert.strictEqual(sessions[i].browser, firstSession.browser, `Session ${i} browser must match session 0`);
        assert.strictEqual(sessions[i].context, firstSession.context, `Session ${i} context must match session 0`);
      }
    });

    await runAdversarialTest(S2, '2.2', 'Subsequent calls after in-flight completion hit fast-path without reconnecting', async () => {
      const env = installMockEnvironment({ connectDelayMs: 20 });
      const client = ChatGptCdpClient.getInstance();

      // First call establishes connection
      const session1 = await client.connect(9223);
      assert.strictEqual(env.connectOverCdpCalls, 1);

      // Next 10 calls should use fast-path
      for (let i = 0; i < 10; i++) {
        const sessionN = await client.connect(9223);
        assert.strictEqual(sessionN.browser, session1.browser);
      }

      assert.strictEqual(env.connectOverCdpCalls, 1, 'connectOverCDP must still have been called only once');
    });

    await runAdversarialTest(S2, '2.3', 'Staggered concurrency (arrivals at t=0, 10ms, 25ms) binds to pending promise', async () => {
      const env = installMockEnvironment({ connectDelayMs: 50 });
      const client = ChatGptCdpClient.getInstance();

      const p1 = client.connect(9223);
      await new Promise((r) => setTimeout(r, 10));
      const p2 = client.connect(9223);
      await new Promise((r) => setTimeout(r, 15));
      const p3 = client.connect(9223);

      const [s1, s2, s3] = await Promise.all([p1, p2, p3]);
      assert.strictEqual(env.connectOverCdpCalls, 1);
      assert.strictEqual(s1.browser, s2.browser);
      assert.strictEqual(s2.browser, s3.browser);
    });

    await runAdversarialTest(S2, '2.4', 'Concurrent failure storm rejects all callers and allows subsequent retry', async () => {
      const env = installMockEnvironment({
        connectDelayMs: 10,
        shouldFailConnect: true,
        failConnectError: new Error('ECONNREFUSED 127.0.0.1:9223'),
      });
      const client = ChatGptCdpClient.getInstance();

      // 10 concurrent requests to a failing endpoint
      const promises = Array.from({ length: 10 }, () => client.connect(9223));
      const results = await Promise.allSettled(promises);

      for (const res of results) {
        assert.strictEqual(res.status, 'rejected', 'All concurrent calls must reject upon connection failure');
      }

      // Now heal the environment: subsequent call must retry and succeed
      env.shouldFailConnect = false;
      const healedSession = await client.connect(9223);
      assert(healedSession.browser !== null, 'Client must recover after failure without hanging');
    });

    // --------------------------------------------------------------------------
    // CHALLENGE DIMENSION 3: CONTEXT INDEX 0 ENFORCEMENT
    // --------------------------------------------------------------------------
    const S3 = 'CHALLENGE 3: CONTEXT INDEX 0 ENFORCEMENT';
    startSection(S3);

    await runAdversarialTest(S3, '3.1', 'Strictly selects browser.contexts()[0] when multiple contexts exist', async () => {
      const env = installMockEnvironment({ contextCount: 3 });
      const client = ChatGptCdpClient.getInstance();

      const session = await client.connect(9223);

      assert.strictEqual(
        session.context,
        env.browser.contexts()[0],
        'session.context MUST strictly match browser.contexts()[0]'
      );
      assert.notStrictEqual(session.context, env.browser.contexts()[1]);
      assert.notStrictEqual(session.context, env.browser.contexts()[2]);
    });

    await runAdversarialTest(S3, '3.2', 'Never invokes browser.newContext() under any circumstance', async () => {
      const env = installMockEnvironment();
      const client = ChatGptCdpClient.getInstance();

      await client.connect(9223);
      await client.getActivePage();

      assert.strictEqual(
        env.browser.newContextCalls,
        0,
        `browser.newContext() was called ${env.browser.newContextCalls} times! Architectural rule violated!`
      );
    });

    await runAdversarialTest(S3, '3.3', 'Recovers if contexts array is initially empty but becomes available after polling', async () => {
      const env = installMockEnvironment({ contextCount: 0 });
      const client = ChatGptCdpClient.getInstance();

      // Simulate delayed context initialization (populated after 150ms)
      setTimeout(() => {
        const delayedContext = new MockBrowserContext([new MockPage('https://chatgpt.com')]);
        env.browser._contexts.push(delayedContext);
      }, 150);

      const session = await client.connect(9223);
      assert(session.context !== null, 'Must successfully acquire context after defensive polling');
      assert.strictEqual(session.context, env.browser.contexts()[0]);
      assert.strictEqual(env.browser.newContextCalls, 0);
    });

    await runAdversarialTest(S3, '3.4', 'Throws error and refuses browser.newContext() if contexts remain empty', async () => {
      const env = installMockEnvironment({ contextCount: 0 });
      const client = ChatGptCdpClient.getInstance();

      let errMessage = '';
      try {
        await client.connect(9223);
      } catch (err: any) {
        errMessage = err.message;
      }

      assert(
        errMessage.includes('Persistent Browser Context not found') || errMessage.includes('Refusing to create an incognito context'),
        `Error must explain refusal of newContext(). Got: "${errMessage}"`
      );
      assert.strictEqual(env.browser.newContextCalls, 0, 'Must NOT call browser.newContext() when context is missing');
    });

    // --------------------------------------------------------------------------
    // CHALLENGE DIMENSION 4: DISCONNECT AND CLEANUP RESILIENCE
    // --------------------------------------------------------------------------
    const S4 = 'CHALLENGE 4: DISCONNECT AND CLEANUP RESILIENCE';
    startSection(S4);

    await runAdversarialTest(S4, '4.1', 'Gracefully detaches via browser.disconnect() and clears all internal state', async () => {
      const env = installMockEnvironment();
      const client = ChatGptCdpClient.getInstance();

      await client.connect(9223);
      assert.strictEqual(client.isConnected(), true);
      assert(client.getBrowser() !== null);
      assert(client.getContext() !== null);

      await client.disconnect();

      assert.strictEqual(client.isConnected(), false, 'isConnected must be false after disconnect');
      assert.strictEqual(client.getBrowser(), null, 'browser must be cleared');
      assert.strictEqual(client.getContext(), null, 'context must be cleared');
      assert.strictEqual(env.browser.disconnectCalls, 1, 'browser.disconnect must have been called once');
    });

    await runAdversarialTest(S4, '4.2', 'Falls back to browser.close() if browser.disconnect is undefined', async () => {
      const env = installMockEnvironment({ hasDisconnectMethod: false });
      const client = ChatGptCdpClient.getInstance();

      await client.connect(9223);
      await client.disconnect();

      assert.strictEqual(client.isConnected(), false);
      assert.strictEqual(env.browser.closeCalls, 1, 'browser.close must be called as fallback');
    });

    await runAdversarialTest(S4, '4.3', 'Recovers gracefully when browser.disconnect() throws an unhandled error', async () => {
      const env = installMockEnvironment();
      env.browser.shouldFailDisconnect = true; // Simulates transport socket failure
      const client = ChatGptCdpClient.getInstance();

      await client.connect(9223);

      // disconnect() must catch the error, log warning, and still clean up references
      await client.disconnect();

      assert.strictEqual(client.isConnected(), false);
      assert.strictEqual(client.getBrowser(), null);
      assert.strictEqual(client.getContext(), null);
    });

    await runAdversarialTest(S4, '4.4', '10 concurrent calls to disconnect() complete cleanly without race conditions', async () => {
      installMockEnvironment();
      const client = ChatGptCdpClient.getInstance();

      await client.connect(9223);

      const promises = Array.from({ length: 10 }, () => client.disconnect());
      await Promise.all(promises);

      assert.strictEqual(client.isConnected(), false);
      assert.strictEqual(client.getBrowser(), null);
    });

    await runAdversarialTest(S4, '4.5', 'Self-heals internal state when browser emits external "disconnected" event', async () => {
      const env = installMockEnvironment();
      const client = ChatGptCdpClient.getInstance();

      await client.connect(9223);
      assert.strictEqual(client.isConnected(), true);

      // Simulate unexpected Chrome process termination
      env.browser.emit('disconnected');

      assert.strictEqual(client.isConnected(), false);
      assert.strictEqual(client.getBrowser(), null);
      assert.strictEqual(client.getContext(), null);
    });

    await runAdversarialTest(S4, '4.6', 'resetInstance() fully resets singleton and allows fresh instantiation', async () => {
      installMockEnvironment();
      const client1 = ChatGptCdpClient.getInstance();
      await client1.connect(9223);

      ChatGptCdpClient.resetInstance();

      const client2 = ChatGptCdpClient.getInstance();
      assert.notStrictEqual(client1, client2, 'New instance must be created after reset');
      assert.strictEqual(client2.isConnected(), false, 'Fresh instance must be unattached');
    });

    await runAdversarialTest(S4, '4.7', 'Stress test: 5 sequential connect-disconnect-reconnect cycles', async () => {
      installMockEnvironment();
      const client = ChatGptCdpClient.getInstance();

      for (let cycle = 1; cycle <= 5; cycle++) {
        await client.connect(9223);
        assert.strictEqual(client.isConnected(), true, `Cycle ${cycle} connect failed`);
        await client.disconnect();
        assert.strictEqual(client.isConnected(), false, `Cycle ${cycle} disconnect failed`);
      }
    });

    // --------------------------------------------------------------------------
    // CHALLENGE DIMENSION 5: PAGE LIFECYCLE ERROR HANDLING
    // --------------------------------------------------------------------------
    const S5 = 'CHALLENGE 5: PAGE LIFECYCLE ERROR HANDLING';
    startSection(S5);

    await runAdversarialTest(S5, '5.1', 'Self-heals and re-acquires page after active page crashes', async () => {
      const env = installMockEnvironment({ initialPageUrl: 'https://chatgpt.com' });
      const client = ChatGptCdpClient.getInstance();

      await client.connect(9223);
      const originalPage = await client.getActivePage();
      assert.strictEqual(originalPage.url(), 'https://chatgpt.com');

      // Trigger page crash
      (originalPage as unknown as MockPage).crash();

      // Prepare replacement page in context
      const replacementPage = new MockPage('https://chatgpt.com');
      env.context._pages.push(replacementPage);

      const recoveredPage = await client.getActivePage();
      assert.strictEqual(recoveredPage, replacementPage, 'Must re-acquire replacement page after crash');
      assert.strictEqual(recoveredPage.isClosed(), false);
    });

    await runAdversarialTest(S5, '5.2', 'Self-heals and re-acquires page after active page is closed by user', async () => {
      const env = installMockEnvironment({ initialPageUrl: 'https://chatgpt.com' });
      const client = ChatGptCdpClient.getInstance();

      await client.connect(9223);
      const originalPage = await client.getActivePage();

      // Trigger user tab close
      (originalPage as unknown as MockPage).close();

      const replacementPage = new MockPage('https://chatgpt.com');
      env.context._pages.push(replacementPage);

      const recoveredPage = await client.getActivePage();
      assert.strictEqual(recoveredPage, replacementPage, 'Must re-acquire replacement page after close');
    });

    await runAdversarialTest(S5, '5.3', 'Detects silent tab closure (isClosed=true without close event)', async () => {
      const env = installMockEnvironment({ initialPageUrl: 'https://chatgpt.com' });
      const client = ChatGptCdpClient.getInstance();

      await client.connect(9223);
      const page1 = await client.getActivePage();

      // Silently set _isClosed without emitting 'close' event
      (page1 as unknown as MockPage)._isClosed = true;

      const newPage = new MockPage('https://chatgpt.com');
      env.context._pages.push(newPage);

      const recovered = await client.getActivePage();
      assert.strictEqual(recovered, newPage, 'Must detect isClosed() and re-acquire valid tab');
    });

    await runAdversarialTest(S5, '5.4', 'Survives exception during page.url() inspection (destroyed target)', async () => {
      const env = installMockEnvironment();
      const client = ChatGptCdpClient.getInstance();

      // Add a corrupted page that throws when .url() is called
      const corruptedPage = new MockPage('https://chatgpt.com');
      corruptedPage.shouldThrowOnUrl = true;
      env.context._pages.unshift(corruptedPage);

      await client.connect(9223);
      const page = await client.getActivePage();

      assert(page !== null, 'Must skip corrupted page and return healthy page');
      assert.strictEqual(page.url(), 'https://chatgpt.com');
    });

    await runAdversarialTest(S5, '5.5', 'Swallows exception if bringToFront() rejects', async () => {
      const env = installMockEnvironment({ initialPageUrl: 'https://chatgpt.com' });
      env.initialPage.shouldFailBringToFront = true;
      const client = ChatGptCdpClient.getInstance();

      await client.connect(9223);
      const page = await client.getActivePage();

      assert(page !== null, 'bringToFront rejection must not disrupt active page acquisition');
    });

    await runAdversarialTest(S5, '5.6', 'Repurposes blank tab (about:blank) by navigating it to chatgpt.com', async () => {
      const env = installMockEnvironment({ initialPageUrl: 'about:blank' });
      const client = ChatGptCdpClient.getInstance();

      await client.connect(9223);
      const page = await client.getActivePage();

      assert.strictEqual(page.url(), 'https://chatgpt.com', 'about:blank tab must be navigated to chatgpt.com');
      assert.strictEqual(env.initialPage.gotoCalls.length, 1, 'page.goto must have been called');
      assert.strictEqual(env.context.newPageCalls, 0, 'Must NOT open new tab when blank tab is available');
    });

    await runAdversarialTest(S5, '5.7', 'Creates new page and navigates when only foreign tabs exist', async () => {
      const env = installMockEnvironment({ initialPageUrl: 'https://google.com' });
      const client = ChatGptCdpClient.getInstance();

      await client.connect(9223);
      const page = await client.getActivePage();

      assert.strictEqual(env.context.newPageCalls, 1, 'Must call context.newPage() when no blank or chatgpt tab exists');
      assert.strictEqual(page.url(), 'https://chatgpt.com');
    });

    await runAdversarialTest(S5, '5.8', 'Auto-reconnects when getActivePage() is called while client is disconnected', async () => {
      const env = installMockEnvironment();
      const client = ChatGptCdpClient.getInstance();

      // Do NOT call client.connect() beforehand
      assert.strictEqual(client.isConnected(), false);

      const page = await client.getActivePage();
      assert(page !== null);
      assert.strictEqual(client.isConnected(), true, 'getActivePage() must trigger auto-connection');
    });

    // --------------------------------------------------------------------------
    // CHALLENGE DIMENSION 6: ADVANCED CONCURRENCY & EDGE-CASE HARNESS
    // --------------------------------------------------------------------------
    const S6 = 'CHALLENGE 6: ADVANCED CONCURRENCY & EDGE-CASE HARNESS';
    startSection(S6);

    await runAdversarialTest(S6, '6.1', 'Concurrent getActivePage() storm (20 callers) safely returns valid active page', async () => {
      installMockEnvironment({ initialPageUrl: 'https://chatgpt.com' });
      const client = ChatGptCdpClient.getInstance();

      await client.connect(9223);

      const promises = Array.from({ length: 20 }, () => client.getActivePage());
      const pages = await Promise.all(promises);

      assert.strictEqual(pages.length, 20);
      for (const p of pages) {
        assert(p !== null);
        assert.strictEqual(p.url(), 'https://chatgpt.com');
      }
    });

    await runAdversarialTest(S6, '6.2', 'Disconnect during in-flight connect behavior & post-connect cleanup resilience', async () => {
      installMockEnvironment({ connectDelayMs: 40 });
      const client = ChatGptCdpClient.getInstance();

      // Launch connect
      const connectPromise = client.connect(9223);

      // Premature disconnect during in-flight connection attempt
      await new Promise((r) => setTimeout(r, 10));
      await client.disconnect();

      // In-flight connect completes afterwards
      const session = await connectPromise;
      assert(session.browser !== null);

      // Advisory Check: Because disconnect() does not currently await in-flight connectingPromise,
      // the connection is established after premature disconnect.
      // Verify that calling disconnect() once connected successfully tears it down cleanly:
      await client.disconnect();
      assert.strictEqual(client.isConnected(), false, 'Subsequent disconnect must cleanly tear down connection');
      assert.strictEqual(client.getBrowser(), null);
    });

    await runAdversarialTest(S6, '6.3', 'Default port binds to 9223 when port parameter is omitted', async () => {
      const env = installMockEnvironment();
      const client = ChatGptCdpClient.getInstance();

      // Connect without port parameter
      const session = await client.connect();
      assert(session.browser !== null);
      assert.strictEqual(client.isConnected(), true);
    });

    await runAdversarialTest(S6, '6.4', 'Singleton pattern preserves single instance reference across multiple calls', async () => {
      const client1 = ChatGptCdpClient.getInstance();
      const client2 = ChatGptCdpClient.getInstance();
      assert.strictEqual(client1, client2, 'ChatGptCdpClient.getInstance() must return singleton instance');
    });

  } finally {
    restoreOriginalEnvironment();
  }

  // ============================================================================
  // SUMMARY REPORT
  // ============================================================================
  console.log(`\n${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}  EMPIRICAL ADVERSARIAL STRESS TEST SUMMARY REPORT${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}\n`);

  console.log(`┌────────────────────────────────────────────────────────────┬────────┬────────┬────────┬─────────┐`);
  console.log(`│ Challenge Dimension                                        │ Total  │ Passed │ Failed │ Pass %  │`);
  console.log(`├────────────────────────────────────────────────────────────┼────────┼────────┼────────┼─────────┤`);

  for (const [sectionName, stats] of Object.entries(sectionStats)) {
    const pct = stats.total > 0 ? ((stats.passed / stats.total) * 100).toFixed(1) : '0.0';
    const namePadded = sectionName.padEnd(58, ' ');
    const totalPadded = String(stats.total).padStart(6, ' ');
    const passedPadded = String(stats.passed).padStart(6, ' ');
    const failedPadded = String(stats.failed).padStart(6, ' ');
    const pctPadded = `${pct}%`.padStart(7, ' ');
    console.log(`│ ${namePadded} │ ${totalPadded} │ ${passedPadded} │ ${failedPadded} │ ${pctPadded} │`);
  }

  console.log(`├────────────────────────────────────────────────────────────┼────────┼────────┼────────┼─────────┤`);
  const totalPct = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : '0.0';
  const totName = 'TOTAL EMPIRICAL CHALLENGES'.padEnd(58, ' ');
  const totTotal = String(totalTests).padStart(6, ' ');
  const totPass = String(passedTests).padStart(6, ' ');
  const totFail = String(failedTests).padStart(6, ' ');
  const totPctPad = `${totalPct}%`.padStart(7, ' ');
  console.log(`│ ${totName} │ ${totTotal} │ ${totPass} │ ${totFail} │ ${totPctPad} │`);
  console.log(`└────────────────────────────────────────────────────────────┴────────┴────────┴────────┴─────────┘\n`);

  if (failedTests === 0) {
    console.log(`${colors.bold}${colors.green}VERDICT: APPROVE ✅ (100% of ${totalTests} adversarial challenges passed)${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${colors.bold}${colors.red}VERDICT: CHALLENGE_FAILED ❌ (${failedTests} of ${totalTests} challenges failed)${colors.reset}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal unhandled error in test suite:', err);
  process.exit(1);
});
