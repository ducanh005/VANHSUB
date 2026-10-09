/**
 * tests/test_adversarial_m1_challenger2_adapter.ts
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST SUITE FOR BrowserAutomationAdapter:
 * - Suite A: Persistent Context Index 0 Enforcement (Absolute prohibition of newContext(), multi-context isolation, polling exhaustion)
 * - Suite B: In-Flight Connection Mutex Race Conditions (50x concurrency storms, error propagation & retry recovery, cross-provider isolation, connect-disconnect races)
 * - Suite C: Tab Discovery & Routing Edge Cases (100-tab haystack, throwing predicates, async tab closures, blank tab identification, URL deduping, navigation failure tolerance)
 * - Suite D: Disconnect() Safe Detach Without Process Kill (disconnect vs close verification, multi-session detachment isolation, idempotency, process preservation)
 *
 * Execution:
 *   npx tsx tests/test_adversarial_m1_challenger2_adapter.ts
 */

import assert from 'assert';
import { EventEmitter } from 'events';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import {
  BrowserAutomationAdapter,
} from '../main/browser-automation/BrowserAutomationAdapter';
import {
  BrowserProcessManager,
} from '../main/browser-automation/BrowserProcessManager';
import {
  RESERVED_BRIDGE_PORT,
  DEFAULT_CHATGPT_PORT,
  DEFAULT_FLOW_PORT,
  DEFAULT_GENERIC_PORT,
  PortConflictError,
  CdpConnectionError,
  PersistentContextNotFoundError,
  type AutomationProvider,
  type BrowserSession,
  type TabPredicate,
} from '../main/browser-automation/types';

// =============================================================================
// ANSI Output Formatting
// =============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
};

function banner(text: string) {
  console.log(`\n${colors.bold}${colors.cyan}${'═'.repeat(80)}${colors.reset}`);
  console.log(`${colors.bold}  ${text}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}${'═'.repeat(80)}${colors.reset}\n`);
}

function suiteBanner(name: string) {
  console.log(`\n${colors.bold}${colors.magenta}▶ [ADVERSARIAL SUITE]${colors.reset} ${colors.bold}${name}${colors.reset}`);
}

function pass(name: string) {
  console.log(`  ${colors.green}✓ [PASS]${colors.reset} ${name}`);
}

function fail(name: string, error: any) {
  console.log(`  ${colors.red}✗ [FAIL]${colors.reset} ${name}`);
  console.error('    Error details:', error);
}

// =============================================================================
// High-Fidelity Adversarial Mock Infrastructure
// =============================================================================

export class MockAdversarialPage extends EventEmitter {
  public _url: string;
  public _title: string;
  public _isClosed = false;
  public bringToFrontCalls = 0;
  public gotoCalls: Array<{ url: string; options?: any }> = [];
  public shouldFailGoto = false;
  public shouldFailBringToFront = false;
  public shouldThrowOnUrl = false;
  public shouldThrowOnTitle = false;

  constructor(url = 'about:blank', title = 'Blank') {
    super();
    this._url = url;
    this._title = title;
  }

  public url(): string {
    if (this.shouldThrowOnUrl) {
      throw new Error('Target closed / URL read error');
    }
    return this._url;
  }

  public async title(): Promise<string> {
    if (this.shouldThrowOnTitle) {
      throw new Error('Target closed / Title read error');
    }
    return this._title;
  }

  public isClosed(): boolean {
    return this._isClosed;
  }

  public async bringToFront(): Promise<void> {
    this.bringToFrontCalls++;
    if (this.shouldFailBringToFront) {
      throw new Error('bringToFront failed: window minimized or permission denied');
    }
  }

  public async goto(url: string, options?: any): Promise<any> {
    this.gotoCalls.push({ url, options });
    if (this.shouldFailGoto) {
      throw new Error(`Navigation failed: net::ERR_CONNECTION_REFUSED to ${url}`);
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

export class MockAdversarialContext extends EventEmitter {
  public id: string;
  public _pages: MockAdversarialPage[] = [];
  public newPageCalls = 0;
  public shouldFailNewPage = false;

  constructor(id = 'context_0', initialPages: MockAdversarialPage[] = []) {
    super();
    this.id = id;
    this._pages = [...initialPages];
  }

  public pages(): MockAdversarialPage[] {
    return this._pages;
  }

  public async newPage(): Promise<MockAdversarialPage> {
    this.newPageCalls++;
    if (this.shouldFailNewPage) {
      throw new Error('Failed to create new page in context: browser out of memory');
    }
    const page = new MockAdversarialPage('about:blank', 'New Tab');
    this._pages.push(page);
    this.emit('page', page);
    return page;
  }
}

export class MockAdversarialBrowser extends EventEmitter {
  public id: string;
  public _contexts: MockAdversarialContext[] = [];
  public _isConnected = true;
  public newContextCalls = 0;
  public disconnectCalls = 0;
  public closeCalls = 0;

  constructor(id = 'browser_0', contexts: MockAdversarialContext[] = []) {
    super();
    this.id = id;
    this._contexts = contexts;
  }

  public contexts(): MockAdversarialContext[] {
    return this._contexts;
  }

  public isConnected(): boolean {
    return this._isConnected;
  }

  public async newContext(): Promise<any> {
    this.newContextCalls++;
    throw new Error(
      'CRITICAL VIOLATION: browser.newContext() was invoked! Persistent context contexts()[0] MUST be preserved!'
    );
  }

  public async disconnect(): Promise<void> {
    this.disconnectCalls++;
    this._isConnected = false;
    this.emit('disconnected');
  }

  public async close(): Promise<void> {
    this.closeCalls++;
    this._isConnected = false;
    this.emit('disconnected');
  }
}

// Interception harness for chromium.connectOverCDP
const originalConnect = chromium.connectOverCDP;
let activeConnectHandler: ((endpoint: string, opts?: any) => Promise<Browser>) | null = null;

function setMockCdpHandler(handler: (endpoint: string, opts?: any) => Promise<Browser>) {
  activeConnectHandler = handler;
  chromium.connectOverCDP = (async (endpoint: string, opts?: any) => {
    if (activeConnectHandler) {
      return activeConnectHandler(endpoint, opts);
    }
    return originalConnect(endpoint, opts);
  }) as any;
}

function restoreCdpHandler() {
  activeConnectHandler = null;
  chromium.connectOverCDP = originalConnect;
}

// =============================================================================
// Test Runner Engine
// =============================================================================

async function runAdversarialSuite() {
  banner('EMPIRICAL ADVERSARIAL STRESS TESTS: BrowserAutomationAdapter');

  let total = 0;
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    total++;
    try {
      const res = fn();
      if (res && typeof (res as any).then === 'function') {
        await res;
      }
      passed++;
      pass(name);
    } catch (err: any) {
      failed++;
      fail(name, err);
    }
  }

  // ---------------------------------------------------------------------------
  // SUITE A: PERSISTENT CONTEXT INDEX 0 ENFORCEMENT
  // ---------------------------------------------------------------------------
  suiteBanner('SUITE A: Persistent Context Index 0 Enforcement');

  await test(
    'A.1 Zero-tolerance: browser.newContext() is NEVER called across connect, findTab, and getOrCreateTab',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const page1 = new MockAdversarialPage('about:blank', 'Home');
      const ctx0 = new MockAdversarialContext('ctx_persistent', [page1]);
      const browser = new MockAdversarialBrowser('b1', [ctx0]);

      setMockCdpHandler(async () => browser as unknown as Browser);

      try {
        // 1. Connect
        const session = await adapter.connect({ provider: 'flow', port: 9224 });
        assert.strictEqual(session.context, ctx0 as unknown as BrowserContext);
        assert.strictEqual(browser.newContextCalls, 0);

        // 2. findTab
        const found = await adapter.findTab('flow', 'Home');
        assert.strictEqual(found, page1 as unknown as Page);
        assert.strictEqual(browser.newContextCalls, 0);

        // 3. getOrCreateTab with repurposeBlank
        const repurposed = await adapter.getOrCreateTab('flow', {
          targetUrl: 'https://labs.google/fx/tools/flow',
          repurposeBlank: true,
        });
        assert.strictEqual(repurposed, page1 as unknown as Page);
        assert.strictEqual(browser.newContextCalls, 0);

        // 4. getOrCreateTab forcing brand new page (repurposeBlank: false)
        const brandNew = await adapter.getOrCreateTab('flow', {
          targetUrl: 'https://labs.google/fx/tools/flow/scene2',
          repurposeBlank: false,
        });
        assert.notStrictEqual(brandNew, page1 as unknown as Page);
        assert.strictEqual(ctx0.newPageCalls, 1);
        assert.strictEqual(browser.newContextCalls, 0);
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'A.2 Multi-context array: Adapter strictly binds to contexts()[0] and never contexts()[1] or contexts()[2]',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const p0 = new MockAdversarialPage('https://chatgpt.com', 'Persistent Login Tab');
      const p1 = new MockAdversarialPage('about:blank', 'Incognito Tab 1');
      const p2 = new MockAdversarialPage('about:blank', 'Incognito Tab 2');

      const ctx0 = new MockAdversarialContext('persistent_ctx_0', [p0]);
      const ctx1 = new MockAdversarialContext('ephemeral_ctx_1', [p1]);
      const ctx2 = new MockAdversarialContext('ephemeral_ctx_2', [p2]);

      const browser = new MockAdversarialBrowser('b_multi', [ctx0, ctx1, ctx2]);

      setMockCdpHandler(async () => browser as unknown as Browser);

      try {
        const session = await adapter.connect({ provider: 'chatgpt', port: 9223 });
        assert.strictEqual(session.context, ctx0 as unknown as BrowserContext);
        assert.notStrictEqual(session.context, ctx1 as unknown as BrowserContext);
        assert.notStrictEqual(session.context, ctx2 as unknown as BrowserContext);

        const tab = await adapter.getOrCreateTab('chatgpt', {
          predicate: 'chatgpt.com',
        });
        assert.strictEqual(tab, p0 as unknown as Page);
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'A.3 Context initialization lag: Adapter defensive polling discovers context arriving on poll 5',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const p0 = new MockAdversarialPage('about:blank');
      const ctx0 = new MockAdversarialContext('delayed_ctx', [p0]);
      const browser = new MockAdversarialBrowser('b_lag', []);

      let pollCount = 0;
      browser.contexts = () => {
        pollCount++;
        // Context only becomes available after 4 empty polls (on poll 5)
        if (pollCount >= 5) {
          return [ctx0];
        }
        return [];
      };

      setMockCdpHandler(async () => browser as unknown as Browser);

      try {
        const session = await adapter.connect({ provider: 'flow', port: 9224 });
        assert.strictEqual(session.context, ctx0 as unknown as BrowserContext);
        assert.ok(pollCount >= 5, `Expected at least 5 polls, got ${pollCount}`);
        assert.strictEqual(browser.newContextCalls, 0);
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'A.4 Polling timeout exhaustion: PersistentContextNotFoundError thrown, NO fallback to newContext()',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const browser = new MockAdversarialBrowser('b_empty', []);
      browser.contexts = () => []; // Permanently empty

      setMockCdpHandler(async () => browser as unknown as Browser);

      try {
        await assert.rejects(
          async () => adapter.connect({ provider: 'flow', port: 9224, maxRetries: 1 }),
          (err: any) => {
            // Must either be CdpConnectionError or PersistentContextNotFoundError
            const isExpected =
              err instanceof CdpConnectionError ||
              err instanceof PersistentContextNotFoundError ||
              (err?.message && err.message.includes('Persistent Context'));
            return isExpected;
          }
        );
        assert.strictEqual(browser.newContextCalls, 0, 'newContext() must NEVER be called even on failure!');
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'A.5 CDP Connection Leak Defect: If acquirePersistentContext fails, connected Browser instance is leaked without disconnect()',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const browser = new MockAdversarialBrowser('b_leak', []);
      browser.contexts = () => []; // No context

      setMockCdpHandler(async () => browser as unknown as Browser);

      try {
        await assert.rejects(
          async () => adapter.connect({ provider: 'flow', port: 9224, maxRetries: 1 })
        );

        console.log(`    [Empirical Discovery] browser.disconnectCalls after failed context acquisition: ${browser.disconnectCalls}`);
        assert.ok(
          browser.disconnectCalls > 0,
          'RESOURCE LEAK DEFECT: Browser connected via CDP was leaked without calling disconnect() when acquirePersistentContext failed!'
        );
      } finally {
        restoreCdpHandler();
      }
    }
  );

  // ---------------------------------------------------------------------------
  // SUITE B: IN-FLIGHT CONNECTION MUTEX RACE CONDITIONS
  // ---------------------------------------------------------------------------
  suiteBanner('SUITE B: In-Flight Connection Mutex Race Conditions');

  await test(
    'B.1 50-Caller Concurrent Connection Storm: Underlying CDP connects exactly ONCE',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      let cdpConnectCalls = 0;
      const p = new MockAdversarialPage('about:blank');
      const ctx = new MockAdversarialContext('ctx_storm', [p]);
      const browser = new MockAdversarialBrowser('b_storm', [ctx]);

      setMockCdpHandler(async () => {
        cdpConnectCalls++;
        // Simulate real network delay during connection
        await new Promise((r) => setTimeout(r, 40));
        return browser as unknown as Browser;
      });

      try {
        const CONCURRENT_COUNT = 50;
        const promises = Array.from({ length: CONCURRENT_COUNT }, () =>
          adapter.connect({ provider: 'flow', port: 9224 })
        );

        const results = await Promise.all(promises);

        assert.strictEqual(
          cdpConnectCalls,
          1,
          `Expected exactly 1 connectOverCDP call, but got ${cdpConnectCalls}!`
        );
        assert.strictEqual(results.length, CONCURRENT_COUNT);
        for (const res of results) {
          assert.strictEqual(res.browser, browser as unknown as Browser);
          assert.strictEqual(res.port, 9224);
        }

        // Fast-path check: immediate subsequent call returns cached session
        const cached = await adapter.connect({ provider: 'flow', port: 9224 });
        assert.strictEqual(cached.browser, browser as unknown as Browser);
        assert.strictEqual(cdpConnectCalls, 1);
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'B.2 Concurrent failure propagation: All 20 storm callers fail simultaneously; subsequent call cleanly retries',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      let cdpConnectAttempts = 0;
      setMockCdpHandler(async () => {
        cdpConnectAttempts++;
        await new Promise((r) => setTimeout(r, 20));
        throw new Error('Connection refused: socket hang up');
      });

      try {
        const FAIL_COUNT = 20;
        const promises = Array.from({ length: FAIL_COUNT }, () =>
          adapter.connect({ provider: 'flow', port: 9224, maxRetries: 1 })
        );

        const results = await Promise.allSettled(promises);

        // All 20 must have rejected
        for (const res of results) {
          assert.strictEqual(res.status, 'rejected');
          assert.ok(
            (res as PromiseRejectedResult).reason instanceof CdpConnectionError ||
            (res as PromiseRejectedResult).reason?.message?.includes('Failed to connect')
          );
        }
        assert.strictEqual(cdpConnectAttempts, 1, 'Only 1 connection attempt should have run for the batch');

        // Now mock recovery for call 21
        const p = new MockAdversarialPage('about:blank');
        const ctx = new MockAdversarialContext('ctx_rec', [p]);
        const browser = new MockAdversarialBrowser('b_rec', [ctx]);
        setMockCdpHandler(async () => {
          cdpConnectAttempts++;
          return browser as unknown as Browser;
        });

        // The mutex map must NOT be poisoned/locked
        const recovered = await adapter.connect({ provider: 'flow', port: 9224, maxRetries: 1 });
        assert.strictEqual(recovered.browser, browser as unknown as Browser);
        assert.strictEqual(cdpConnectAttempts, 2);
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'B.3 Interleaved cross-provider concurrency: Flow (9224) and ChatGPT (9223) run in parallel without contention',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const flowBrowser = new MockAdversarialBrowser('b_flow', [
        new MockAdversarialContext('c_flow', [new MockAdversarialPage('https://flow')]),
      ]);
      const chatBrowser = new MockAdversarialBrowser('b_chat', [
        new MockAdversarialContext('c_chat', [new MockAdversarialPage('https://chatgpt')]),
      ]);

      const connectLog: Array<{ provider: string; port: number }> = [];

      setMockCdpHandler(async (endpoint) => {
        await new Promise((r) => setTimeout(r, 30));
        if (endpoint.includes('9224')) {
          connectLog.push({ provider: 'flow', port: 9224 });
          return flowBrowser as unknown as Browser;
        }
        if (endpoint.includes('9223')) {
          connectLog.push({ provider: 'chatgpt', port: 9223 });
          return chatBrowser as unknown as Browser;
        }
        throw new Error(`Unexpected port in ${endpoint}`);
      });

      try {
        const flowBatch = Array.from({ length: 15 }, () =>
          adapter.connect({ provider: 'flow', port: 9224 })
        );
        const chatBatch = Array.from({ length: 15 }, () =>
          adapter.connect({ provider: 'chatgpt', port: 9223 })
        );

        const [flowResults, chatResults] = await Promise.all([
          Promise.all(flowBatch),
          Promise.all(chatBatch),
        ]);

        assert.strictEqual(connectLog.length, 2);
        assert.strictEqual(flowResults.length, 15);
        assert.strictEqual(chatResults.length, 15);

        for (const f of flowResults) {
          assert.strictEqual(f.browser, flowBrowser as unknown as Browser);
          assert.strictEqual(f.port, 9224);
        }
        for (const c of chatResults) {
          assert.strictEqual(c.browser, chatBrowser as unknown as Browser);
          assert.strictEqual(c.port, 9223);
        }
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'B.4 Duplicate disconnected event defect: disconnect() emits "disconnected" TWICE for a single detachment',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const browser = new MockAdversarialBrowser('b_disc', [
        new MockAdversarialContext('c_disc', [new MockAdversarialPage('about:blank')]),
      ]);

      setMockCdpHandler(async () => browser as unknown as Browser);

      try {
        await adapter.connect({ provider: 'flow', port: 9224 });
        assert.strictEqual(adapter.isConnected('flow'), true);

        const disconnectEvents: Array<{ provider: string; reason: string }> = [];
        adapter.on('disconnected', (prov, reason) => {
          disconnectEvents.push({ provider: prov, reason });
        });

        await adapter.disconnect('flow');

        // BUG DEMONSTRATION: browser.on('disconnected') emits once, AND disconnect() finally emits again!
        // A single call to disconnect() produces 2 disconnected events!
        console.log(`    [Empirical Discovery] Number of disconnected events fired: ${disconnectEvents.length}`);
        // If length > 1, this confirms the duplicate emission bug:
        assert.strictEqual(
          disconnectEvents.length,
          1,
          `DUPLICATE EVENT DEFECT: disconnect() triggered ${disconnectEvents.length} "disconnected" events instead of exactly 1!`
        );
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'B.6 Race Condition: connect() called while disconnect() is in-flight returns dying session',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const browser = new MockAdversarialBrowser('b_race', [
        new MockAdversarialContext('c_race', [new MockAdversarialPage('about:blank')]),
      ]);

      // Simulate network latency during CDP disconnect (e.g. 50ms)
      const origDisconnect = browser.disconnect.bind(browser);
      browser.disconnect = async () => {
        await new Promise((r) => setTimeout(r, 50));
        await origDisconnect();
      };

      setMockCdpHandler(async () => browser as unknown as Browser);

      try {
        await adapter.connect({ provider: 'flow', port: 9224 });
        assert.strictEqual(adapter.isConnected('flow'), true);

        // Caller 1 starts disconnect (takes 50ms)
        const discPromise = adapter.disconnect('flow');

        // Caller 2 calls connect() while disconnect is in flight (at 10ms)
        await new Promise((r) => setTimeout(r, 10));
        const sessionWhileDisconnecting = await adapter.connect({ provider: 'flow', port: 9224 });

        // Wait for disconnect to complete
        await discPromise;

        // CRITICAL BUG VERIFICATION:
        // Does sessionWhileDisconnecting remain connected, or was it killed out from under Caller 2?
        console.log(`    [Empirical Discovery] Session isConnected after disconnect finished: ${sessionWhileDisconnecting.browser.isConnected()}`);
        assert.strictEqual(
          sessionWhileDisconnecting.browser.isConnected(),
          true,
          'RACE CONDITION DEFECT: connect() returned a session that was actively being disconnected! The session is now dead!'
        );
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'B.7 Race Condition: disconnect() called while connect() is in-flight is silently dropped',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const browser = new MockAdversarialBrowser('b_race_conn', [
        new MockAdversarialContext('c_race_conn', [new MockAdversarialPage('about:blank')]),
      ]);

      // Simulate connection latency (50ms)
      setMockCdpHandler(async () => {
        await new Promise((r) => setTimeout(r, 50));
        return browser as unknown as Browser;
      });

      try {
        // Caller 1 starts connect (in-flight for 50ms)
        const connectPromise = adapter.connect({ provider: 'flow', port: 9224 });

        // Caller 2 decides to abort/disconnect while connection is in-flight (at 10ms)
        await new Promise((r) => setTimeout(r, 10));
        await adapter.disconnect('flow');

        // Connection finishes
        await connectPromise;

        // CRITICAL BUG VERIFICATION:
        // Caller requested disconnect, but adapter ignored it because session was not yet in sessions map!
        // Now adapter has an active connected session despite explicit disconnect call!
        console.log(`    [Empirical Discovery] Adapter isConnected after connect+disconnect race: ${adapter.isConnected('flow')}`);
        assert.strictEqual(
          adapter.isConnected('flow'),
          false,
          'RACE CONDITION DEFECT: disconnect() called during in-flight connect() was dropped, leaving zombie connection!'
        );
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'B.8 Self-healing reconnection cycle after unexpected CDP WebSocket crash',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const browser1 = new MockAdversarialBrowser('b_orig', [
        new MockAdversarialContext('c_orig', [new MockAdversarialPage('about:blank')]),
      ]);
      const browser2 = new MockAdversarialBrowser('b_reconn', [
        new MockAdversarialContext('c_reconn', [new MockAdversarialPage('about:blank')]),
      ]);

      let call = 0;
      setMockCdpHandler(async () => {
        call++;
        return (call === 1 ? browser1 : browser2) as unknown as Browser;
      });

      try {
        await adapter.connect({ provider: 'flow', port: 9224 });
        assert.strictEqual(adapter.isConnected('flow'), true);

        // Simulate abrupt remote CDP disconnection
        browser1._isConnected = false;
        browser1.emit('disconnected');

        // Adapter must register disconnect
        assert.strictEqual(adapter.isConnected('flow'), false);
        assert.strictEqual(adapter.getSession('flow'), null);

        // Reconnection call must establish browser2
        const session2 = await adapter.connect({ provider: 'flow', port: 9224 });
        assert.strictEqual(session2.browser, browser2 as unknown as Browser);
        assert.strictEqual(adapter.isConnected('flow'), true);
      } finally {
        restoreCdpHandler();
      }
    }
  );

  // ---------------------------------------------------------------------------
  // SUITE C: TAB DISCOVERY & ROUTING EDGE CASES
  // ---------------------------------------------------------------------------
  suiteBanner('SUITE C: Tab Discovery & Routing Edge Cases');

  await test(
    'C.1 100-Tab haystack predicate matching: finds target tab among 100 open tabs by string, regex, and fn',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const tabs: MockAdversarialPage[] = [];
      for (let i = 0; i < 99; i++) {
        tabs.push(new MockAdversarialPage(`https://random-site-${i}.com`, `Page ${i}`));
      }
      const needleTab = new MockAdversarialPage(
        'https://labs.google/fx/tools/flow?projectId=target_needle_123#canvas',
        'Flow Project Alpha'
      );
      tabs.splice(47, 0, needleTab); // Insert at index 47

      const ctx = new MockAdversarialContext('ctx_100', tabs);
      const browser = new MockAdversarialBrowser('b_100', [ctx]);

      setMockCdpHandler(async () => browser as unknown as Browser);

      try {
        await adapter.connect({ provider: 'flow', port: 9224 });

        // Match by query param substring
        const foundStr = await adapter.findTab('flow', 'target_needle_123');
        assert.strictEqual(foundStr, needleTab as unknown as Page);

        // Match by RegExp
        const foundRegex = await adapter.findTab('flow', /flow\?projectId=target_needle/i);
        assert.strictEqual(foundRegex, needleTab as unknown as Page);

        // Match by title
        const foundTitle = await adapter.findTab('flow', 'Project Alpha');
        assert.strictEqual(foundTitle, needleTab as unknown as Page);

        // Match by custom async function predicate
        const foundFn = await adapter.findTab('flow', async (page, title) => {
          return title === 'Flow Project Alpha';
        });
        assert.strictEqual(foundFn, needleTab as unknown as Page);
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'C.2 Resilience against throwing and crashing tabs during discovery',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const badTab1 = new MockAdversarialPage('https://crash1');
      badTab1.shouldThrowOnUrl = true;

      const badTab2 = new MockAdversarialPage('https://crash2');
      badTab2.shouldThrowOnTitle = true;

      const closedTab = new MockAdversarialPage('https://closed');
      closedTab.close();

      const goodTab = new MockAdversarialPage('https://labs.google/fx/target', 'Target');

      const ctx = new MockAdversarialContext('ctx_err', [badTab1, closedTab, badTab2, goodTab]);
      const browser = new MockAdversarialBrowser('b_err', [ctx]);

      setMockCdpHandler(async () => browser as unknown as Browser);

      try {
        await adapter.connect({ provider: 'flow', port: 9224 });

        // findTab must gracefully skip badTab1, badTab2, closedTab without throwing!
        const found = await adapter.findTab('flow', 'labs.google/fx/target');
        assert.strictEqual(found, goodTab as unknown as Page);
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'C.3 Resilience against exception-throwing predicate function',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const tab = new MockAdversarialPage('https://chatgpt.com');
      const ctx = new MockAdversarialContext('ctx_throw_pred', [tab]);
      const browser = new MockAdversarialBrowser('b_throw_pred', [ctx]);

      setMockCdpHandler(async () => browser as unknown as Browser);

      try {
        await adapter.connect({ provider: 'chatgpt', port: 9223 });

        // Predicate throws synchronous error
        const resSync = await adapter.findTab('flow', () => {
          throw new Error('Malformed user predicate');
        });
        assert.strictEqual(resSync, null);

        // Predicate returns rejecting promise
        const resAsync = await adapter.findTab('flow', async () => {
          throw new Error('Asynchronous predicate rejection');
        });
        assert.strictEqual(resAsync, null);
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'C.4 URL duplicate prevention: getOrCreateTab does NOT call goto() if targetUrl matches tab URL',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const existingTab = new MockAdversarialPage('https://chatgpt.com', 'ChatGPT');
      const ctx = new MockAdversarialContext('ctx_dedup', [existingTab]);
      const browser = new MockAdversarialBrowser('b_dedup', [ctx]);

      setMockCdpHandler(async () => browser as unknown as Browser);

      try {
        await adapter.connect({ provider: 'chatgpt', port: 9223 });

        const page = await adapter.getOrCreateTab('chatgpt', {
          targetUrl: 'https://chatgpt.com',
        });

        assert.strictEqual(page, existingTab as unknown as Page);
        assert.strictEqual(
          existingTab.gotoCalls.length,
          0,
          'goto() should NOT have been called when already on matching targetUrl!'
        );
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'C.5 Blank tab recycling discrimination: Recycles about:blank / chrome://newtab but preserves real URLs',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const realTab = new MockAdversarialPage('https://about.me/profile', 'Profile');
      const realTab2 = new MockAdversarialPage('https://google.com/blank-search', 'Search');
      const blankTab = new MockAdversarialPage('chrome://newtab', 'New Tab');

      const ctx = new MockAdversarialContext('ctx_blank_disc', [realTab, realTab2, blankTab]);
      const browser = new MockAdversarialBrowser('b_blank_disc', [ctx]);

      setMockCdpHandler(async () => browser as unknown as Browser);

      try {
        await adapter.connect({ provider: 'flow', port: 9224 });

        const page = await adapter.getOrCreateTab('flow', {
          targetUrl: 'https://labs.google/fx/tools/flow',
          repurposeBlank: true,
        });

        // Must repurpose blankTab (chrome://newtab)
        assert.strictEqual(page, blankTab as unknown as Page);
        assert.strictEqual(blankTab.gotoCalls.length, 1);
        assert.strictEqual(realTab.gotoCalls.length, 0);
        assert.strictEqual(realTab2.gotoCalls.length, 0);
        assert.strictEqual(ctx.newPageCalls, 0);
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'C.6 Navigation failure propagation: If page.goto() rejects, getOrCreateTab rejects cleanly without corrupting adapter',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const blankTab = new MockAdversarialPage('about:blank');
      blankTab.shouldFailGoto = true;

      const ctx = new MockAdversarialContext('ctx_goto_fail', [blankTab]);
      const browser = new MockAdversarialBrowser('b_goto_fail', [ctx]);

      setMockCdpHandler(async () => browser as unknown as Browser);

      try {
        await adapter.connect({ provider: 'flow', port: 9224 });

        await assert.rejects(
          async () =>
            adapter.getOrCreateTab('flow', {
              targetUrl: 'https://non-existent-domain.xyz',
              timeoutMs: 500,
            }),
          (err: any) => err?.message?.includes('Navigation failed')
        );

        // Adapter remains healthy and alive
        assert.strictEqual(adapter.isConnected('flow'), true);
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'C.7 bringToFront failure tolerance: If page.bringToFront() rejects, getOrCreateTab succeeds and returns page',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const tab = new MockAdversarialPage('https://chatgpt.com', 'ChatGPT');
      tab.shouldFailBringToFront = true;

      const ctx = new MockAdversarialContext('ctx_btf_fail', [tab]);
      const browser = new MockAdversarialBrowser('b_btf_fail', [ctx]);

      setMockCdpHandler(async () => browser as unknown as Browser);

      try {
        await adapter.connect({ provider: 'chatgpt', port: 9223 });

        const page = await adapter.getOrCreateTab('chatgpt', {
          predicate: 'chatgpt.com',
          bringToFront: true,
        });

        assert.strictEqual(page, tab as unknown as Page);
      } finally {
        restoreCdpHandler();
      }
    }
  );

  // ---------------------------------------------------------------------------
  // SUITE D: DISCONNECT() SAFE DETACH WITHOUT PROCESS KILL
  // ---------------------------------------------------------------------------
  suiteBanner('SUITE D: Disconnect() Safe Detach Without Process Kill');

  await test(
    'D.1 Safe detach: disconnect() strictly calls browser.disconnect() and NEVER browser.close()',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const browser = new MockAdversarialBrowser('b_detach', [
        new MockAdversarialContext('c_detach', [new MockAdversarialPage('about:blank')]),
      ]);

      setMockCdpHandler(async () => browser as unknown as Browser);

      try {
        await adapter.connect({ provider: 'flow', port: 9224 });
        assert.strictEqual(adapter.isConnected('flow'), true);

        await adapter.disconnect('flow');

        assert.strictEqual(
          browser.disconnectCalls,
          1,
          'browser.disconnect() must be called to detach CDP WebSocket'
        );
        assert.strictEqual(
          browser.closeCalls,
          0,
          'CRITICAL: browser.close() was called! disconnect() must NOT close browser!'
        );
        assert.strictEqual(adapter.isConnected('flow'), false);
        assert.strictEqual(adapter.getSession('flow'), null);
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'D.2 Multi-session detachment isolation: Disconnecting Flow does NOT affect ChatGPT or Generic',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const flowBrowser = new MockAdversarialBrowser('b_flow_iso', [new MockAdversarialContext()]);
      const chatBrowser = new MockAdversarialBrowser('b_chat_iso', [new MockAdversarialContext()]);
      const genericBrowser = new MockAdversarialBrowser('b_gen_iso', [new MockAdversarialContext()]);

      setMockCdpHandler(async (endpoint) => {
        if (endpoint.includes('9224')) return flowBrowser as unknown as Browser;
        if (endpoint.includes('9223')) return chatBrowser as unknown as Browser;
        if (endpoint.includes('9225')) return genericBrowser as unknown as Browser;
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      });

      try {
        await adapter.connect({ provider: 'flow', port: 9224 });
        await adapter.connect({ provider: 'chatgpt', port: 9223 });
        await adapter.connect({ provider: 'generic', port: 9225 });

        assert.strictEqual(adapter.isConnected('flow'), true);
        assert.strictEqual(adapter.isConnected('chatgpt'), true);
        assert.strictEqual(adapter.isConnected('generic'), true);

        // Disconnect only Flow
        await adapter.disconnect('flow');

        assert.strictEqual(flowBrowser.disconnectCalls, 1);
        assert.strictEqual(chatBrowser.disconnectCalls, 0);
        assert.strictEqual(genericBrowser.disconnectCalls, 0);

        assert.strictEqual(adapter.isConnected('flow'), false);
        assert.strictEqual(adapter.isConnected('chatgpt'), true);
        assert.strictEqual(adapter.isConnected('generic'), true);

        // Disconnect only ChatGPT
        await adapter.disconnect('chatgpt');

        assert.strictEqual(chatBrowser.disconnectCalls, 1);
        assert.strictEqual(genericBrowser.disconnectCalls, 0);

        assert.strictEqual(adapter.isConnected('chatgpt'), false);
        assert.strictEqual(adapter.isConnected('generic'), true);

        // DisconnectAll finishes remaining Generic
        await adapter.disconnectAll();
        assert.strictEqual(genericBrowser.disconnectCalls, 1);
        assert.strictEqual(adapter.isConnected('generic'), false);
      } finally {
        restoreCdpHandler();
      }
    }
  );

  await test(
    'D.3 Safe no-op on uninitialized or already-disconnected provider',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      // Disconnect provider that has never been connected
      await assert.doesNotReject(async () => adapter.disconnect('generic'));
      await assert.doesNotReject(async () => adapter.disconnect('flow'));
      await assert.doesNotReject(async () => adapter.disconnectAll());
    }
  );

  await test(
    'D.4 Process registry decoupling: Adapter detach does NOT remove process from BrowserProcessManager',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      BrowserProcessManager.resetInstance();

      const adapter = BrowserAutomationAdapter.getInstance();
      const pm = BrowserProcessManager.getInstance();

      // Seed a simulated managed process in BrowserProcessManager
      const mockRecord: any = {
        provider: 'flow',
        port: 9224,
        profileDir: 'D:\\simulated_profile',
        pid: 99999,
        childProcess: null,
        spawnedByManager: false,
        createdAt: Date.now(),
      };
      (pm as any).activeProcesses.set('flow', mockRecord);

      const flowBrowser = new MockAdversarialBrowser('b_pm_iso', [new MockAdversarialContext()]);
      setMockCdpHandler(async () => flowBrowser as unknown as Browser);

      try {
        await adapter.connect({ provider: 'flow', port: 9224 });

        // Disconnect CDP
        await adapter.disconnect('flow');

        // Verify BrowserProcessManager still has the process record intact!
        const procInfo = pm.getProcessInfo('flow');
        assert.ok(procInfo !== null, 'BrowserProcessManager record must NOT be deleted by adapter.disconnect()');
        assert.strictEqual(procInfo?.port, 9224);
      } finally {
        restoreCdpHandler();
        BrowserProcessManager.resetInstance();
      }
    }
  );

  // ---------------------------------------------------------------------------
  // SUMMARY AND VERDICT
  // ---------------------------------------------------------------------------
  banner('EMPIRICAL ADVERSARIAL STRESS TEST SUMMARY');
  console.log(`Total Stress Tests : ${total}`);
  console.log(`Passed             : ${colors.green}${passed}${colors.reset}`);
  console.log(`Failed             : ${failed > 0 ? colors.red : colors.green}${failed}${colors.reset}`);
  console.log(`Pass Rate          : ${((passed / total) * 100).toFixed(1)}%\n`);

  if (failed > 0) {
    console.error(`${colors.bold}${colors.red}ADVERSARIAL VERDICT: REJECT ❌ (${failed} tests failed)${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${colors.bold}${colors.green}ADVERSARIAL VERDICT: APPROVE ✅ (All ${total} tests passed)${colors.reset}\n`);
  }
}

runAdversarialSuite().catch((err) => {
  console.error('Fatal unhandled error in adversarial test suite:', err);
  process.exit(1);
});
