/**
 * tests/test_browser_automation_adapter.ts
 *
 * Comprehensive Automated Test Suite for Unified Browser Automation Module:
 * - Types, Constants, and Error Classes
 * - BrowserProcessManager: 5-tier detection, port guards, profile isolation, lockfile cleanup
 * - BrowserAutomationAdapter: Playwright CDP, persistent context preservation, mutex, tab discovery, safe detach
 *
 * Coverage:
 * - Suite 1: Port 9222 Collision Guard Tests (numeric and string coercion)
 * - Suite 2: Port Resolution & Profile Directory Isolation Tests
 * - Suite 3: Chrome Binary Detection & Locator Verification Tests
 * - Suite 4: Process Management Lifecycle & Lockfile Tests
 * - Suite 5: Connection, Session Management & Tab Discovery Tests
 *
 * Execution:
 *   npx tsx tests/test_browser_automation_adapter.ts
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

// Production Code Imports
import {
  RESERVED_BRIDGE_PORT,
  DEFAULT_CHATGPT_PORT,
  DEFAULT_FLOW_PORT,
  DEFAULT_GENERIC_PORT,
  DEFAULT_PROVIDER_PORTS,
  DEFAULT_PROVIDER_PROFILE_NAMES,
  PortConflictError,
  PortConflictGuardError,
  ChromeNotFoundError,
  BrowserLaunchError,
  BrowserLaunchTimeoutError,
  CdpConnectionError,
  BrowserNotConnectedError,
  PersistentContextNotFoundError,
  TabNotFoundError,
  assertNotReservedPort,
  type AutomationProvider,
  type BrowserLaunchOptions,
  type BrowserSession,
  type BrowserConnectionOptions,
} from '../main/browser-automation/types';

import { BrowserProcessManager } from '../main/browser-automation/BrowserProcessManager';
import { BrowserAutomationAdapter } from '../main/browser-automation/BrowserAutomationAdapter';

// =============================================================================
// Terminal Colors & Test Reporting
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

function logHeader(title: string) {
  console.log(`\n${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}  ${title}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}\n`);
}

function logSuite(num: number, title: string) {
  console.log(`\n${colors.bold}${colors.magenta}▶ [SUITE ${num}]${colors.reset} ${colors.bold}${title}${colors.reset}`);
}

function logTest(id: string, desc: string) {
  console.log(`  ${colors.bold}${colors.blue}[TEST ${id}]${colors.reset} ${desc}`);
}

function logPass(msg: string) {
  console.log(`    ${colors.green}✓ [PASS]${colors.reset} ${msg}`);
}

function logFail(msg: string, err?: any) {
  console.log(`    ${colors.red}✗ [FAIL]${colors.reset} ${msg}`);
  if (err) console.error('     ', err);
}

// =============================================================================
// High-Fidelity Mock Playwright Infrastructure
// =============================================================================

export class MockPage extends EventEmitter {
  public _url: string;
  public _title: string;
  public _isClosed = false;
  public bringToFrontCalls = 0;
  public gotoCalls: Array<{ url: string; options?: any }> = [];
  public shouldFailGoto = false;

  constructor(initialUrl = 'about:blank', title = 'Blank Tab') {
    super();
    this._url = initialUrl;
    this._title = title;
  }

  public url(): string {
    return this._url;
  }

  public async title(): Promise<string> {
    return this._title;
  }

  public isClosed(): boolean {
    return this._isClosed;
  }

  public async bringToFront(): Promise<void> {
    this.bringToFrontCalls++;
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

export class MockBrowserContext extends EventEmitter {
  public _pages: MockPage[] = [];
  public newPageCalls = 0;

  constructor(initialPages: MockPage[] = []) {
    super();
    this._pages = [...initialPages];
  }

  public pages(): MockPage[] {
    return this._pages;
  }

  public async newPage(): Promise<MockPage> {
    this.newPageCalls++;
    const page = new MockPage('about:blank', 'New Tab');
    this._pages.push(page);
    this.emit('page', page);
    return page;
  }
}

export class MockBrowser extends EventEmitter {
  public _contexts: MockBrowserContext[] = [];
  public _isConnected = true;
  public newContextCalls = 0;
  public disconnectCalls = 0;
  public closeCalls = 0;

  constructor(contexts: MockBrowserContext[] = []) {
    super();
    this._contexts =
      contexts.length > 0 ? contexts : [new MockBrowserContext([new MockPage('about:blank')])];
  }

  public contexts(): MockBrowserContext[] {
    return this._contexts;
  }

  public isConnected(): boolean {
    return this._isConnected;
  }

  public async newContext(): Promise<any> {
    this.newContextCalls++;
    throw new Error(
      'VIOLATION: newContext() must never be called! Persistent context contexts()[0] must be preserved.'
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

// CDP Mock Hook
const originalConnectOverCDP = chromium.connectOverCDP;
let customConnectHandler: ((endpoint: string, opts?: any) => Promise<Browser>) | null = null;

function installMockConnect(
  handler: (endpoint: string, opts?: any) => Promise<Browser>
) {
  customConnectHandler = handler;
  chromium.connectOverCDP = (async (endpoint: string, opts?: any) => {
    if (customConnectHandler) {
      return customConnectHandler(endpoint, opts);
    }
    return originalConnectOverCDP(endpoint, opts);
  }) as any;
}

function restoreMockConnect() {
  customConnectHandler = null;
  chromium.connectOverCDP = originalConnectOverCDP;
}

// =============================================================================
// Test Suite Runner
// =============================================================================

async function runTestSuite() {
  logHeader('TEST SUITE: UNIFIED BROWSER AUTOMATION ADAPTER & PROCESS MANAGER');
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  async function runCase(
    suiteNum: number,
    testId: string,
    desc: string,
    fn: () => void | Promise<void>
  ) {
    totalTests++;
    logTest(testId, desc);
    try {
      const res = fn();
      if (res && typeof (res as any).then === 'function') {
        await res;
      }
      passedTests++;
      logPass(`${testId} passed`);
    } catch (err: any) {
      failedTests++;
      logFail(`${testId} failed`, err);
    }
  }

  // ---------------------------------------------------------------------------
  // SUITE 1: Port 9222 Collision Guard Tests
  // ---------------------------------------------------------------------------
  logSuite(1, 'PORT 9222 COLLISION GUARD TESTS (RESERVED FOR FlowBridgeServer)');

  await runCase(1, '1.1', 'assertNotReservedPort(9222) throws PortConflictError', () => {
    assert.throws(
      () => assertNotReservedPort(9222),
      (err: any) =>
        err instanceof PortConflictError &&
        err.port === 9222 &&
        err.name === 'PortConflictError'
    );
  });

  await runCase(
    1,
    '1.2',
    'assertNotReservedPort with string "9222" and whitespace throws PortConflictError',
    () => {
      assert.throws(
        () => assertNotReservedPort('9222'),
        (err: any) => err instanceof PortConflictError && err.port === 9222
      );
      assert.throws(
        () => assertNotReservedPort('  9222  '),
        (err: any) => err instanceof PortConflictError && err.port === 9222
      );
    }
  );

  await runCase(
    1,
    '1.3',
    'Valid ports (9223, 9224, 9225, 9300, undefined, null) pass assertNotReservedPort',
    () => {
      assert.strictEqual(assertNotReservedPort(9223), 9223);
      assert.strictEqual(assertNotReservedPort(9224), 9224);
      assert.strictEqual(assertNotReservedPort(9225), 9225);
      assert.strictEqual(assertNotReservedPort(9300), 9300);
      assert.strictEqual(assertNotReservedPort(undefined), 0);
      assert.strictEqual(assertNotReservedPort(null), 0);
    }
  );

  await runCase(
    1,
    '1.4',
    'BrowserProcessManager validatePort rejects numeric 9222 and throws PortConflictError',
    () => {
      const pm = BrowserProcessManager.getInstance();
      assert.throws(
        () => pm.validatePort(9222),
        (err: any) => err instanceof PortConflictError && err.port === 9222
      );
    }
  );

  await runCase(
    1,
    '1.5',
    'BrowserProcessManager validatePort rejects string "9222" and whitespace',
    () => {
      const pm = BrowserProcessManager.getInstance();
      assert.throws(
        () => pm.validatePort('9222'),
        (err: any) => err instanceof PortConflictError && err.port === 9222
      );
      assert.throws(
        () => pm.validatePort('  9222  '),
        (err: any) => err instanceof PortConflictError && err.port === 9222
      );
    }
  );

  await runCase(
    1,
    '1.6',
    'BrowserProcessManager validatePort enforces valid range [1, 65535]',
    () => {
      const pm = BrowserProcessManager.getInstance();
      assert.throws(() => pm.validatePort(0));
      assert.throws(() => pm.validatePort(-10));
      assert.throws(() => pm.validatePort(70000));
      assert.throws(() => pm.validatePort('invalid'));
      assert.strictEqual(pm.validatePort(9223), 9223);
      assert.strictEqual(pm.validatePort('9224'), 9224);
    }
  );

  await runCase(
    1,
    '1.7',
    'BrowserAutomationAdapter connect() strictly rejects port 9222 (numeric and string)',
    async () => {
      const adapter = BrowserAutomationAdapter.getInstance();
      await assert.rejects(
        async () => adapter.connect({ provider: 'flow', port: 9222 }),
        (err: any) => err instanceof PortConflictError && err.port === 9222
      );
      await assert.rejects(
        async () => adapter.connect({ provider: 'flow', port: '9222' as any }),
        (err: any) => err instanceof PortConflictError && err.port === 9222
      );
    }
  );

  await runCase(
    1,
    '1.8',
    'PortConflictError exposes conflictingService and suggestedPort',
    () => {
      const err = new PortConflictError(9222);
      assert.strictEqual(err.conflictingService, 'FlowBridgeServer');
      assert.strictEqual(err.suggestedPort, DEFAULT_FLOW_PORT);
      assert.ok(err.message.includes('strictly reserved for Google Flow Extension Bridge'));
      assert.ok(err.name === 'PortConflictError');

      // PortConflictGuardError compatibility alias
      const guardErr = new PortConflictGuardError('Port 9222 guard test');
      assert.ok(guardErr instanceof PortConflictError);
    }
  );

  // ---------------------------------------------------------------------------
  // SUITE 2: Port Resolution & Profile Directory Isolation Tests
  // ---------------------------------------------------------------------------
  logSuite(2, 'PORT RESOLUTION & PROFILE DIRECTORY ISOLATION TESTS');

  await runCase(
    2,
    '2.1',
    'Default port mapping strictly isolates ChatGPT (9223), Flow (9224), and Generic (9225)',
    () => {
      const pm = BrowserProcessManager.getInstance();
      assert.strictEqual(pm.getDefaultPort('chatgpt'), 9223);
      assert.strictEqual(pm.getDefaultPort('flow'), 9224);
      assert.strictEqual(pm.getDefaultPort('generic'), 9225);

      const adapter = BrowserAutomationAdapter.getInstance();
      assert.strictEqual(adapter.getDefaultPort('chatgpt'), 9223);
      assert.strictEqual(adapter.getDefaultPort('flow'), 9224);
      assert.strictEqual(adapter.getDefaultPort('generic'), 9225);
    }
  );

  await runCase(
    2,
    '2.2',
    'Profile directory isolation: Flow and ChatGPT profiles are distinct paths',
    () => {
      const pm = BrowserProcessManager.getInstance();
      const chatgptProfile = pm.getProfileDir('chatgpt');
      const flowProfile = pm.getProfileDir('flow');
      const genericProfile = pm.getProfileDir('generic');

      assert.ok(
        chatgptProfile.endsWith('chrome_chatgpt_profile'),
        `Expected chrome_chatgpt_profile, got ${chatgptProfile}`
      );
      assert.ok(
        flowProfile.endsWith('chrome_flow_profile'),
        `Expected chrome_flow_profile, got ${flowProfile}`
      );
      assert.ok(
        genericProfile.endsWith('chrome_generic_profile'),
        `Expected chrome_generic_profile, got ${genericProfile}`
      );
      assert.notStrictEqual(
        chatgptProfile,
        flowProfile,
        'Flow and ChatGPT profiles must not collide!'
      );
    }
  );

  await runCase(
    2,
    '2.3',
    'Custom profile directory override is respected in getProfileDir',
    () => {
      const pm = BrowserProcessManager.getInstance();
      const custom = 'D:\\test_custom_browser_profile';
      assert.strictEqual(
        pm.getProfileDir('flow', custom),
        path.resolve(custom)
      );
    }
  );

  await runCase(
    2,
    '2.4',
    'Environment variable overrides CHATGPT_PROFILE_DIR and FLOW_PROFILE_DIR',
    () => {
      const pm = BrowserProcessManager.getInstance();
      const origChat = process.env.CHATGPT_PROFILE_DIR;
      const origFlow = process.env.FLOW_PROFILE_DIR;
      try {
        process.env.CHATGPT_PROFILE_DIR = 'C:\\env_chatgpt_profile';
        process.env.FLOW_PROFILE_DIR = 'C:\\env_flow_profile';
        assert.strictEqual(
          pm.getProfileDir('chatgpt'),
          path.resolve('C:\\env_chatgpt_profile')
        );
        assert.strictEqual(
          pm.getProfileDir('flow'),
          path.resolve('C:\\env_flow_profile')
        );
      } finally {
        if (origChat !== undefined) process.env.CHATGPT_PROFILE_DIR = origChat;
        else delete process.env.CHATGPT_PROFILE_DIR;
        if (origFlow !== undefined) process.env.FLOW_PROFILE_DIR = origFlow;
        else delete process.env.FLOW_PROFILE_DIR;
      }
    }
  );

  await runCase(
    2,
    '2.5',
    'Environment variable overrides CHATGPT_CDP_PORT and FLOW_CDP_PORT in getDefaultPort',
    () => {
      const pm = BrowserProcessManager.getInstance();
      const origChat = process.env.CHATGPT_CDP_PORT;
      const origFlow = process.env.FLOW_CDP_PORT;
      try {
        process.env.CHATGPT_CDP_PORT = '9230';
        process.env.FLOW_CDP_PORT = '9240';
        assert.strictEqual(pm.getDefaultPort('chatgpt'), 9230);
        assert.strictEqual(pm.getDefaultPort('flow'), 9240);
      } finally {
        if (origChat !== undefined) process.env.CHATGPT_CDP_PORT = origChat;
        else delete process.env.CHATGPT_CDP_PORT;
        if (origFlow !== undefined) process.env.FLOW_CDP_PORT = origFlow;
        else delete process.env.FLOW_CDP_PORT;
      }
    }
  );

  // ---------------------------------------------------------------------------
  // SUITE 3: Binary Detection Verification
  // ---------------------------------------------------------------------------
  logSuite(3, 'BINARY DETECTION & LOCATOR VERIFICATION TESTS');

  await runCase(
    3,
    '3.1',
    'Tier 1 priority override via explicit parameter in detectChromePath',
    () => {
      const pm = BrowserProcessManager.getInstance();
      pm.clearDetectedChromePath();
      const tempFile = path.join(os.tmpdir(), `temp_chrome_${Date.now()}.exe`);
      fs.writeFileSync(tempFile, 'dummy binary');
      try {
        const detected = pm.detectChromePath(tempFile);
        assert.strictEqual(detected, path.resolve(tempFile));
      } finally {
        try {
          fs.unlinkSync(tempFile);
        } catch {}
      }
    }
  );

  await runCase(
    3,
    '3.2',
    'Tier 1 priority override via CHROME_PATH with valid file',
    () => {
      const pm = BrowserProcessManager.getInstance();
      pm.clearDetectedChromePath();
      const tempFile = path.join(os.tmpdir(), `temp_chrome_env_${Date.now()}.exe`);
      fs.writeFileSync(tempFile, 'dummy binary');
      const orig = process.env.CHROME_PATH;
      try {
        process.env.CHROME_PATH = tempFile;
        const detected = pm.detectChromePath();
        assert.strictEqual(detected, path.resolve(tempFile));
      } finally {
        if (orig !== undefined) process.env.CHROME_PATH = orig;
        else delete process.env.CHROME_PATH;
        pm.clearDetectedChromePath();
        try {
          fs.unlinkSync(tempFile);
        } catch {}
      }
    }
  );

  await runCase(
    3,
    '3.3',
    'Tier 1 priority override via CHROME_BIN with valid file',
    () => {
      const pm = BrowserProcessManager.getInstance();
      pm.clearDetectedChromePath();
      const tempFile = path.join(os.tmpdir(), `temp_chrome_bin_${Date.now()}.exe`);
      fs.writeFileSync(tempFile, 'dummy binary');
      const orig = process.env.CHROME_BIN;
      try {
        process.env.CHROME_BIN = tempFile;
        const detected = pm.detectChromePath();
        assert.strictEqual(detected, path.resolve(tempFile));
      } finally {
        if (orig !== undefined) process.env.CHROME_BIN = orig;
        else delete process.env.CHROME_BIN;
        pm.clearDetectedChromePath();
        try {
          fs.unlinkSync(tempFile);
        } catch {}
      }
    }
  );

  await runCase(
    3,
    '3.4',
    'clearDetectedChromePath() resets the cached binary path',
    () => {
      const pm = BrowserProcessManager.getInstance();
      pm.clearDetectedChromePath();
      const tempFile = path.join(os.tmpdir(), `temp_cache_test_${Date.now()}.exe`);
      fs.writeFileSync(tempFile, 'dummy binary');
      try {
        pm.detectChromePath(tempFile);
        pm.clearDetectedChromePath();
        // After clearing, detectChromePath without args searches fresh
      } finally {
        try {
          fs.unlinkSync(tempFile);
        } catch {}
      }
    }
  );

  await runCase(
    3,
    '3.5',
    'Descriptive ChromeNotFoundError thrown when Chrome is absent across all candidates',
    () => {
      const pm = BrowserProcessManager.getInstance();
      pm.clearDetectedChromePath();
      const realExistsSync = fs.existsSync;
      (fs as any).existsSync = (p: string) => {
        if (typeof p === 'string' && p.toLowerCase().includes('chrome.exe')) {
          return false;
        }
        return realExistsSync(p);
      };
      try {
        assert.throws(
          () => pm.detectChromePath(),
          (err: any) =>
            err instanceof ChromeNotFoundError &&
            err.name === 'ChromeNotFoundError' &&
            Array.isArray(err.checkedLocations)
        );
      } finally {
        (fs as any).existsSync = realExistsSync;
        pm.clearDetectedChromePath();
      }
    }
  );

  // ---------------------------------------------------------------------------
  // SUITE 4: Process Management Lifecycle & Lockfile Tests
  // ---------------------------------------------------------------------------
  logSuite(4, 'PROCESS MANAGEMENT LIFECYCLE & LOCKFILE TESTS');

  await runCase(
    4,
    '4.1',
    'cleanupStaleLockFiles safely cleans SingletonLock, SingletonSocket, SingletonCookie',
    () => {
      const pm = BrowserProcessManager.getInstance();
      const testDir = path.join(os.tmpdir(), `vanhsub_lock_test_${Date.now()}`);
      fs.mkdirSync(testDir, { recursive: true });

      const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'RegularData.json'];
      for (const f of lockFiles) {
        fs.writeFileSync(path.join(testDir, f), 'test content');
      }

      pm.cleanupStaleLockFiles(testDir);

      assert.strictEqual(fs.existsSync(path.join(testDir, 'SingletonLock')), false);
      assert.strictEqual(fs.existsSync(path.join(testDir, 'SingletonSocket')), false);
      assert.strictEqual(fs.existsSync(path.join(testDir, 'SingletonCookie')), false);
      assert.strictEqual(fs.existsSync(path.join(testDir, 'RegularData.json')), true);

      // Clean up test directory
      try {
        fs.unlinkSync(path.join(testDir, 'RegularData.json'));
        fs.rmdirSync(testDir);
      } catch {}
    }
  );

  await runCase(
    4,
    '4.2',
    'isPortAlive on port 9222 immediately returns false without network probe',
    async () => {
      const pm = BrowserProcessManager.getInstance();
      const alive = await pm.isPortAlive(9222, 100);
      assert.strictEqual(alive, false);
    }
  );

  await runCase(
    4,
    '4.3',
    'isPortAlive on unbound port returns false gracefully without throwing',
    async () => {
      const pm = BrowserProcessManager.getInstance();
      const alive = await pm.isPortAlive(59999, 150);
      assert.strictEqual(alive, false);
    }
  );

  await runCase(
    4,
    '4.4',
    'BrowserProcessManager active process registry and info accessors',
    () => {
      const pm = BrowserProcessManager.getInstance();
      assert.strictEqual(pm.getProcessInfo('chatgpt'), null);
      assert.deepStrictEqual(pm.getAllProcesses(), []);
    }
  );

  // ---------------------------------------------------------------------------
  // SUITE 5: Connection, Session Management & Tab Discovery Tests
  // ---------------------------------------------------------------------------
  logSuite(5, 'CONNECTION & DISCONNECT SIMULATION TESTS (PLAYWRIGHT CDP)');

  await runCase(
    5,
    '5.1',
    'Persistent Context contexts()[0] is strictly enforced and newContext() is NEVER called',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const mockPage = new MockPage('about:blank', 'Initial Tab');
      const mockContext = new MockBrowserContext([mockPage]);
      const mockBrowser = new MockBrowser([mockContext]);

      installMockConnect(async (endpoint) => {
        assert.ok(endpoint.includes('9224'));
        return mockBrowser as unknown as Browser;
      });

      try {
        const session = await adapter.connect({ provider: 'flow', port: 9224 });
        assert.strictEqual(session.context, mockContext);
        assert.strictEqual(
          mockBrowser.newContextCalls,
          0,
          'browser.newContext() was called! Architectural rule forbids incognito context!'
        );
      } finally {
        restoreMockConnect();
      }
    }
  );

  await runCase(
    5,
    '5.2',
    'Defensive polling for persistent context throws PersistentContextNotFoundError if empty',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      // Mock browser with empty contexts array
      const mockBrowser = new MockBrowser([]);
      mockBrowser._contexts = [];

      installMockConnect(async () => mockBrowser as unknown as Browser);

      try {
        await assert.rejects(
          async () => adapter.connect({ provider: 'flow', port: 9224 }),
          (err: any) =>
            err instanceof CdpConnectionError ||
            err instanceof PersistentContextNotFoundError
        );
      } finally {
        restoreMockConnect();
      }
    }
  );

  await runCase(
    5,
    '5.3',
    'Concurrent connection mutexing: parallel connect() calls share the in-flight promise',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      let connectCalls = 0;
      const mockPage = new MockPage('about:blank');
      const mockContext = new MockBrowserContext([mockPage]);
      const mockBrowser = new MockBrowser([mockContext]);

      installMockConnect(async () => {
        connectCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return mockBrowser as unknown as Browser;
      });

      try {
        const [s1, s2, s3] = await Promise.all([
          adapter.connect({ provider: 'flow', port: 9224 }),
          adapter.connect({ provider: 'flow', port: 9224 }),
          adapter.connect({ provider: 'flow', port: 9224 }),
        ]);

        assert.strictEqual(connectCalls, 1, 'connectOverCDP must be called exactly once due to mutex');
        assert.strictEqual(s1.browser, s2.browser);
        assert.strictEqual(s2.browser, s3.browser);
      } finally {
        restoreMockConnect();
      }
    }
  );

  await runCase(
    5,
    '5.4',
    'Multi-session isolation: Flow (9224) and ChatGPT (9223) maintain separate sessions without cross-talk',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const flowPage = new MockPage('https://labs.google/fx/tools/flow');
      const flowContext = new MockBrowserContext([flowPage]);
      const flowBrowser = new MockBrowser([flowContext]);

      const chatPage = new MockPage('https://chatgpt.com');
      const chatContext = new MockBrowserContext([chatPage]);
      const chatBrowser = new MockBrowser([chatContext]);

      installMockConnect(async (endpoint) => {
        if (endpoint.includes('9224')) return flowBrowser as unknown as Browser;
        if (endpoint.includes('9223')) return chatBrowser as unknown as Browser;
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      });

      try {
        const flowSession = await adapter.connect({ provider: 'flow', port: 9224 });
        const chatSession = await adapter.connect({ provider: 'chatgpt', port: 9223 });

        assert.strictEqual(flowSession.port, 9224);
        assert.strictEqual(chatSession.port, 9223);
        assert.notStrictEqual(flowSession.browser, chatSession.browser);

        assert.strictEqual(adapter.getSession('flow')?.port, 9224);
        assert.strictEqual(adapter.getSession('chatgpt')?.port, 9223);
        assert.strictEqual(adapter.isConnected('flow'), true);
        assert.strictEqual(adapter.isConnected('chatgpt'), true);
        assert.strictEqual(adapter.isConnected('generic'), false);
      } finally {
        restoreMockConnect();
      }
    }
  );

  await runCase(
    5,
    '5.5',
    'Tab discovery: findTab and getOrCreateTab match existing tab via predicate',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const flowPage = new MockPage('https://labs.google/fx/tools/flow', 'Google Flow');
      const blankPage = new MockPage('about:blank', 'New Tab');
      const context = new MockBrowserContext([blankPage, flowPage]);
      const browser = new MockBrowser([context]);

      installMockConnect(async () => browser as unknown as Browser);

      try {
        await adapter.connect({ provider: 'flow', port: 9224 });

        // findTab with substring string
        const foundByString = await adapter.findTab('flow', 'labs.google/fx');
        assert.strictEqual(foundByString, flowPage);

        // findTab with RegExp
        const foundByRegExp = await adapter.findTab('flow', /labs\.google\/fx/);
        assert.strictEqual(foundByRegExp, flowPage);

        // findTab with function predicate
        const foundByFn = await adapter.findTab('flow', (p) =>
          typeof p === 'object' && 'url' in p ? p.url().includes('flow') : false
        );
        assert.strictEqual(foundByFn, flowPage);

        // getOrCreateTab matches existing and brings to front
        const tab = await adapter.getOrCreateTab('flow', {
          predicate: 'labs.google/fx',
          bringToFront: true,
        });
        assert.strictEqual(tab, flowPage);
        assert.strictEqual(flowPage.bringToFrontCalls, 1);
      } finally {
        restoreMockConnect();
      }
    }
  );

  await runCase(
    5,
    '5.6',
    'Tab routing: getOrCreateTab repurposes recyclable blank tab for navigation',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const blankPage = new MockPage('about:blank', 'Blank');
      const context = new MockBrowserContext([blankPage]);
      const browser = new MockBrowser([context]);

      installMockConnect(async () => browser as unknown as Browser);

      try {
        await adapter.connect({ provider: 'flow', port: 9224 });

        const page = await adapter.getOrCreateTab('flow', {
          targetUrl: 'https://labs.google/fx/tools/flow',
          repurposeBlank: true,
        });

        assert.strictEqual(page, blankPage);
        assert.strictEqual(blankPage.gotoCalls.length, 1);
        assert.strictEqual(blankPage.gotoCalls[0].url, 'https://labs.google/fx/tools/flow');
        assert.strictEqual(context.newPageCalls, 0, 'Should have repurposed blank tab instead of newPage');
      } finally {
        restoreMockConnect();
      }
    }
  );

  await runCase(
    5,
    '5.7',
    'Tab routing: getOrCreateTab creates new tab when no recyclable tab exists',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const occupiedPage = new MockPage('https://chatgpt.com', 'ChatGPT');
      const context = new MockBrowserContext([occupiedPage]);
      const browser = new MockBrowser([context]);

      installMockConnect(async () => browser as unknown as Browser);

      try {
        await adapter.connect({ provider: 'generic', port: 9225 });

        const page = await adapter.getOrCreateTab('generic', {
          targetUrl: 'https://example.com',
          repurposeBlank: true,
        });

        assert.strictEqual(context.newPageCalls, 1);
        assert.notStrictEqual(page, occupiedPage);
        assert.strictEqual(page.url(), 'https://example.com');
      } finally {
        restoreMockConnect();
      }
    }
  );

  await runCase(
    5,
    '5.8',
    'Safe detach: disconnect() detaches CDP without terminating Chrome and preserves other sessions',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const flowBrowser = new MockBrowser();
      const chatBrowser = new MockBrowser();

      installMockConnect(async (endpoint) => {
        if (endpoint.includes('9224')) return flowBrowser as unknown as Browser;
        if (endpoint.includes('9223')) return chatBrowser as unknown as Browser;
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      });

      try {
        await adapter.connect({ provider: 'flow', port: 9224 });
        await adapter.connect({ provider: 'chatgpt', port: 9223 });

        assert.strictEqual(adapter.isConnected('flow'), true);
        assert.strictEqual(adapter.isConnected('chatgpt'), true);

        // Disconnect flow
        await adapter.disconnect('flow');

        assert.strictEqual(flowBrowser.disconnectCalls, 1);
        assert.strictEqual(flowBrowser.closeCalls, 0, 'browser.close() must not be called when disconnect() is available');
        assert.strictEqual(adapter.isConnected('flow'), false);
        assert.strictEqual(adapter.getSession('flow'), null);

        // ChatGPT session must remain completely connected
        assert.strictEqual(adapter.isConnected('chatgpt'), true);
        assert.strictEqual(chatBrowser.disconnectCalls, 0);

        // Disconnect all
        await adapter.disconnectAll();
        assert.strictEqual(chatBrowser.disconnectCalls, 1);
        assert.strictEqual(adapter.isConnected('chatgpt'), false);
      } finally {
        restoreMockConnect();
      }
    }
  );

  await runCase(
    5,
    '5.9',
    'Lifecycle event emission: connected, targetcreated, targetdestroyed, targetcrashed, disconnected',
    async () => {
      BrowserAutomationAdapter.resetInstance();
      const adapter = BrowserAutomationAdapter.getInstance();

      const page1 = new MockPage('about:blank');
      const context = new MockBrowserContext([page1]);
      const browser = new MockBrowser([context]);

      const eventsReceived: string[] = [];
      adapter.on('connected', (p) => eventsReceived.push(`connected:${p}`));
      adapter.on('disconnected', (p, r) => eventsReceived.push(`disconnected:${p}:${r}`));
      adapter.on('targetcreated', (p) => eventsReceived.push(`targetcreated:${p}`));
      adapter.on('targetdestroyed', (p) => eventsReceived.push(`targetdestroyed:${p}`));
      adapter.on('targetcrashed', (p) => eventsReceived.push(`targetcrashed:${p}`));

      installMockConnect(async () => browser as unknown as Browser);

      try {
        await adapter.connect({ provider: 'flow', port: 9224 });
        assert.ok(eventsReceived.includes('connected:flow'));

        // Create new page in context
        const page2 = await context.newPage();
        assert.ok(eventsReceived.includes('targetcreated:flow'));

        // Close page
        page2.close();
        assert.ok(eventsReceived.includes('targetdestroyed:flow'));

        // Crash page
        page1.crash();
        assert.ok(eventsReceived.includes('targetcrashed:flow'));

        // Disconnect
        await adapter.disconnect('flow');
        assert.ok(eventsReceived.includes('disconnected:flow:graceful_detach'));
      } finally {
        restoreMockConnect();
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  logHeader('TEST SUITE EXECUTION SUMMARY');
  console.log(`Total Cases Run : ${totalTests}`);
  console.log(`Passed          : ${colors.green}${passedTests}${colors.reset}`);
  console.log(`Failed          : ${failedTests > 0 ? colors.red : colors.green}${failedTests}${colors.reset}`);
  console.log(`Success Rate    : ${((passedTests / totalTests) * 100).toFixed(1)}%\n`);

  if (failedTests > 0) {
    console.error(`${colors.bold}${colors.red}VERDICT: REJECT ❌ (${failedTests} test failures detected)${colors.reset}`);
    process.exit(1);
  } else {
    console.log(`${colors.bold}${colors.green}VERDICT: APPROVE ✅ (100% of ${totalTests} test cases passed)${colors.reset}`);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
