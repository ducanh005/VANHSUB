/**
 * Automated Verification Script for Milestone 1 (R1: Stealth & Offscreen Background Execution)
 * Tests complete eradication of focus stealing, window popping, and onscreen flips.
 */

import path from 'path';
import os from 'os';
import assert from 'assert';

// 1. Mock electron before any imports
const electronPath = require.resolve('electron');

let lastCreatedWindow: any = null;
const windowCallLog: { [key: string]: number } = {
  show: 0,
  focus: 0,
  restore: 0,
  showInactive: 0,
  setPosition: 0,
  webContentsFocus: 0,
};

function resetWindowCallLog() {
  for (const k of Object.keys(windowCallLog)) {
    windowCallLog[k] = 0;
  }
}

class MockBrowserWindow {
  public width: number;
  public height: number;
  public x: number;
  public y: number;
  public isShown: boolean;
  public destroyed: boolean = false;
  public webContents: any;
  private eventHandlers: Map<string, Function[]> = new Map();

  constructor(opts: any = {}) {
    this.width = opts.width || 1440;
    this.height = opts.height || 900;
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.isShown = Boolean(opts.show);
    this.webContents = {
      setUserAgent: () => {},
      executeJavaScript: async () => true,
      insertCSS: async () => {},
      sendInputEvent: () => {},
      insertText: async () => {},
      paste: () => {},
      getURL: () => 'https://flow.google.com/project/test-project',
      isLoading: () => false,
      isCrashed: () => false,
      focus: () => {
        windowCallLog.webContentsFocus++;
      },
      capturePage: async () => ({
        isEmpty: () => true,
        toPNG: () => Buffer.from(''),
      }),
      on: (evt: string, cb: Function) => {
        if (!this.eventHandlers.has(evt)) this.eventHandlers.set(evt, []);
        this.eventHandlers.get(evt)!.push(cb);
      },
      once: (evt: string, cb: Function) => cb(),
    };
    lastCreatedWindow = this;
  }

  show() {
    windowCallLog.show++;
    this.isShown = true;
  }

  focus() {
    windowCallLog.focus++;
  }

  restore() {
    windowCallLog.restore++;
  }

  showInactive() {
    windowCallLog.showInactive++;
  }

  setSize(w: number, h: number) {
    this.width = w;
    this.height = h;
  }

  setPosition(x: number, y: number) {
    windowCallLog.setPosition++;
    this.x = x;
    this.y = y;
  }

  getPosition(): [number, number] {
    return [this.x, this.y];
  }

  isMinimized(): boolean {
    return false;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
  }

  loadURL(_url: string) {
    return Promise.resolve();
  }

  on(evt: string, cb: Function) {
    if (!this.eventHandlers.has(evt)) this.eventHandlers.set(evt, []);
    this.eventHandlers.get(evt)!.push(cb);
  }
}

const mockSession = {
  fromPartition: () => ({
    setUserAgent: () => {},
    webRequest: {
      onBeforeSendHeaders: () => {},
    },
    cookies: {
      get: async () => [],
      on: () => {},
    },
  }),
};

require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    BrowserWindow: MockBrowserWindow,
    session: mockSession,
    app: {
      getPath: () => path.join(os.tmpdir(), 'vanhsub-stealth-test'),
      name: 'vanhsub-stealth-test',
      getVersion: () => '1.0.0',
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
    },
    clipboard: {
      writeText: () => {},
      readText: () => '',
      writeImage: () => {},
    },
  },
} as any;

async function runTests() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  TEST SUITE: Milestone 1 (R1: True Stealth Offscreen Execution)');
  console.log('════════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  async function testCase(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ [FAIL] ${name}: ${err?.message || err}`);
      failed++;
    }
  }

  // --- Suite 1: Configuration Defaults ---
  console.log('▶ Suite 1: Configuration Defaults');
  await testCase('S1.1: DEFAULT_FLOW_ENGINE_CONFIG.uiMode defaults to "offscreen"', async () => {
    const { DEFAULT_FLOW_ENGINE_CONFIG } = await import('../main/ai-studio/types');
    assert.strictEqual(DEFAULT_FLOW_ENGINE_CONFIG.uiMode, 'offscreen');
  });

  await testCase('S1.2: DEFAULT_AI_STUDIO_CONFIG.flowEngine.uiMode defaults to "offscreen"', async () => {
    const { DEFAULT_AI_STUDIO_CONFIG } = await import('../renderer/types/aiStudio');
    assert.strictEqual(DEFAULT_AI_STUDIO_CONFIG.flowEngine.uiMode, 'offscreen');
  });

  // --- Suite 2: GoogleVeoSessionManager Stealth Lifecycle ---
  console.log('\n▶ Suite 2: GoogleVeoSessionManager Lifecycle');
  const { GoogleVeoSessionManager, OFFSCREEN_X, OFFSCREEN_Y } = await import('../main/veo/GoogleVeoSessionManager');
  const sessionMgr = GoogleVeoSessionManager.getInstance();

  await testCase('S2.1: openLobbyWindow in offscreen mode creates window offscreen with no show() or focus()', async () => {
    resetWindowCallLog();
    if (sessionMgr.lobbyWindow && !sessionMgr.lobbyWindow.isDestroyed()) {
      sessionMgr.lobbyWindow.destroy();
      sessionMgr.lobbyWindow = null;
    }

    await sessionMgr.openLobbyWindow({ uiMode: 'offscreen' });

    assert(sessionMgr.lobbyWindow, 'lobbyWindow must be initialized');
    assert.strictEqual(sessionMgr.isLobbyDebugVisible, false, 'isLobbyDebugVisible must be false');
    assert.strictEqual(sessionMgr.isLobbyDebug(), false, 'isLobbyDebug() must return false');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X, 'Window X must be OFFSCREEN_X (-3000)');
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y, 'Window Y must be OFFSCREEN_Y (-3000)');
    assert.strictEqual(windowCallLog.show, 0, 'win.show() must NEVER be called in offscreen mode');
    assert.strictEqual(windowCallLog.focus, 0, 'win.focus() must NEVER be called in offscreen mode');
    assert.strictEqual(windowCallLog.showInactive, 1, 'win.showInactive() should be called for paint');
  });

  await testCase('S2.2: openLobbyWindow when already open maintains offscreen without stealing focus', async () => {
    resetWindowCallLog();
    await sessionMgr.openLobbyWindow({ uiMode: 'offscreen' });

    assert.strictEqual(sessionMgr.isLobbyDebugVisible, false);
    assert.strictEqual(windowCallLog.show, 0, 'win.show() must not be called');
    assert.strictEqual(windowCallLog.focus, 0, 'win.focus() must not be called');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
  });

  await testCase('S2.3: openLobbyWindow in live_window mode positions onscreen and calls show() and focus()', async () => {
    resetWindowCallLog();
    await sessionMgr.openLobbyWindow({ uiMode: 'live_window' });

    assert.strictEqual(sessionMgr.isLobbyDebugVisible, true, 'isLobbyDebugVisible must be true');
    assert.strictEqual(sessionMgr.isLobbyDebug(), true, 'isLobbyDebug() must return true');
    assert.strictEqual(sessionMgr.lobbyWindow.x, 100, 'Window X must be 100 in live_window mode');
    assert.strictEqual(sessionMgr.lobbyWindow.y, 60, 'Window Y must be 60 in live_window mode');
    assert.strictEqual(windowCallLog.show, 1, 'win.show() must be called in live_window mode');
    assert.strictEqual(windowCallLog.focus, 1, 'win.focus() must be called in live_window mode');
  });

  await testCase('S2.4: hideLobbyOffscreen moves window back offscreen', () => {
    sessionMgr.hideLobbyOffscreen();
    assert.strictEqual(sessionMgr.isLobbyDebugVisible, false);
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
  });

  // --- Suite 3: Helper & Pipeline State Machine Focus Isolation ---
  console.log('\n▶ Suite 3: State Machine & Helpers Focus Isolation');
  const { VideoOpenFlowState } = await import('../main/workflow/flow-engine/states/FlowVideoGenerationStates');

  await testCase('S3.1: VideoOpenFlowState does NOT show/focus when offscreen', async () => {
    resetWindowCallLog();
    sessionMgr.hideLobbyOffscreen();

    const mockCtx: any = {
      win: sessionMgr.lobbyWindow,
      sessionMgr,
      targetProjectId: 'test-proj',
    };

    const result = await VideoOpenFlowState.execute(mockCtx);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(windowCallLog.show, 0, 'VideoOpenFlowState must not call win.show() when offscreen');
    assert.strictEqual(windowCallLog.focus, 0, 'VideoOpenFlowState must not call win.focus() when offscreen');
    assert.strictEqual(windowCallLog.restore, 0, 'VideoOpenFlowState must not call win.restore() when offscreen');
  });

  await testCase('S3.2: autoConfirmAgentPermission does NOT steal focus in offscreen mode', async () => {
    resetWindowCallLog();
    sessionMgr.hideLobbyOffscreen();

    // Mock JS execution returning clicked button
    sessionMgr.safeExecuteJs = async () => ({
      status: 'clicked_action_button',
      coords: { x: 500, y: 300 },
      label: 'Confirm',
    });

    await sessionMgr.autoConfirmAgentPermission(sessionMgr.lobbyWindow);

    assert.strictEqual(windowCallLog.focus, 0, 'autoConfirmAgentPermission must not call win.focus() in offscreen mode');
    assert.strictEqual(windowCallLog.restore, 0, 'autoConfirmAgentPermission must not call win.restore() in offscreen mode');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
  });

  await testCase('S3.3: ensureCleanCanvasReady does NOT show or focus in offscreen mode', async () => {
    resetWindowCallLog();
    sessionMgr.hideLobbyOffscreen();

    // Mock JS execution returning ready
    sessionMgr.safeExecuteJs = async () => ({
      ready: true,
      hasPrompt: true,
      hasGenBtn: true,
      coords: { x: 400, y: 400 },
    });

    await sessionMgr.ensureCleanCanvasReady(sessionMgr.lobbyWindow);

    assert.strictEqual(windowCallLog.show, 0, 'ensureCleanCanvasReady must not call win.show() in offscreen mode');
    assert.strictEqual(windowCallLog.focus, 0, 'ensureCleanCanvasReady must not call win.focus() in offscreen mode');
    assert.strictEqual(windowCallLog.restore, 0, 'ensureCleanCanvasReady must not call win.restore() in offscreen mode');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
  });

  // --- Suite 4: FlowRecoveryManager Offscreen Capture ---
  console.log('\n▶ Suite 4: FlowRecoveryManager Diagnostic Capture');
  const { FlowRecoveryManager } = await import('../main/workflow/flow-engine/FlowRecoveryManager');

  await testCase('S4.1: FlowRecoveryManager captures diagnostics without flipping window onscreen', async () => {
    resetWindowCallLog();
    sessionMgr.hideLobbyOffscreen();

    const mockDiagCtx: any = {
      taskId: 'test-recovery-task',
      win: sessionMgr.lobbyWindow,
      mode: 'image',
    };

    const recoveryResult = await FlowRecoveryManager.handleRecovery(
      sessionMgr.lobbyWindow,
      'UNKNOWN_PAGE_STATE',
      mockDiagCtx
    );
    assert(recoveryResult, 'Recovery result should exist');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X, 'Window position must NOT be flipped to 100, 100');
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y, 'Window position must NOT be flipped to 100, 100');
    assert.strictEqual(windowCallLog.showInactive, 0, 'showInactive must NOT be called on flip');
  });

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(`  SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('════════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
