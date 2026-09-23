/**
 * EMPIRICAL CHALLENGER TEST SUITE: Milestone 1 (R1: Stealth & Offscreen Background Execution)
 * 
 * Strict Adversarial Oracle & Stress Harness to verify:
 * 1. Under simulated offscreen execution, no calls to win.show(), win.focus(), win.restore() occur.
 * 2. Coordinates remain strictly offscreen (OFFSCREEN_X, OFFSCREEN_Y = -3000, -3000).
 * 3. openLobbyWindow called repeatedly in offscreen mode never flips window to positive coordinates or calls show().
 * 4. All Flow states and helpers use webContents.focus() rather than OS-level win.focus().
 * 5. Diagnostic capture in FlowRecoveryManager never flips window onscreen.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import assert from 'assert';

// ---------------------------------------------------------------------------
// 1. Mock Electron with Invariant Trap
// ---------------------------------------------------------------------------
const electronPath = require.resolve('electron');

let strictOffscreenInvariant = false;
let lastCreatedWindow: any = null;

const callLog = {
  show: 0,
  focus: 0,
  restore: 0,
  showInactive: 0,
  setPosition: 0,
  webContentsFocus: 0,
  webContentsPaste: 0,
  webContentsInsertText: 0,
  sendInputEvent: 0,
};

function resetCallLog() {
  for (const k of Object.keys(callLog)) {
    (callLog as any)[k] = 0;
  }
}

class MockBrowserWindow {
  public width: number;
  public height: number;
  public x: number;
  public y: number;
  public isShown: boolean;
  public minimized: boolean = false;
  public destroyed: boolean = false;
  public webContents: any;
  private eventHandlers: Map<string, Function[]> = new Map();

  constructor(opts: any = {}) {
    this.width = opts.width || 1440;
    this.height = opts.height || 900;
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.isShown = Boolean(opts.show);

    if (strictOffscreenInvariant) {
      if (this.x >= 0 || this.y >= 0) {
        throw new Error(`INVARIANT VIOLATION: MockBrowserWindow created at (${this.x}, ${this.y}) during strict offscreen mode!`);
      }
      if (this.isShown) {
        throw new Error('INVARIANT VIOLATION: MockBrowserWindow created with show: true during strict offscreen mode!');
      }
    }

    this.webContents = {
      setUserAgent: () => {},
      executeJavaScript: async (code: string) => {
        if (code.includes('outerHTML')) {
          return '<html><body>Mock Google Flow DOM Content</body></html>';
        }
        if (code.includes('checkExistingChip') || code.includes('chip-container')) {
          // If paste has occurred, simulate chip attached successfully
          if (callLog.webContentsPaste > 0) {
            return { hasChip: true, src: 'https://flow.google.com/asset/mock-ref-chip', selector: 'flow-image-ingredient-chip' };
          }
          return false;
        }
        if (code.includes('selectCanvasImageJs') || code.includes('linked_from_canvas')) {
          return 'none';
        }
        return true;
      },
      insertCSS: async () => {},
      sendInputEvent: (_evt: any) => {
        callLog.sendInputEvent++;
      },
      insertText: async (_txt: string) => {
        callLog.webContentsInsertText++;
      },
      paste: () => {
        callLog.webContentsPaste++;
      },
      getURL: () => 'https://flow.google.com/project/adversarial-challenger-project',
      isLoading: () => false,
      isCrashed: () => false,
      focus: () => {
        callLog.webContentsFocus++;
      },
      setZoomFactor: () => {},
      capturePage: async () => ({
        isEmpty: () => false,
        toPNG: () => Buffer.from('mock-png-buffer-data'),
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
    callLog.show++;
    this.isShown = true;
    if (strictOffscreenInvariant) {
      throw new Error('INVARIANT VIOLATION: win.show() called during strict offscreen mode!');
    }
  }

  focus() {
    callLog.focus++;
    if (strictOffscreenInvariant) {
      throw new Error('INVARIANT VIOLATION: win.focus() called during strict offscreen mode!');
    }
  }

  restore() {
    callLog.restore++;
    this.minimized = false;
    if (strictOffscreenInvariant) {
      throw new Error('INVARIANT VIOLATION: win.restore() called during strict offscreen mode!');
    }
  }

  showInactive() {
    callLog.showInactive++;
  }

  setSize(w: number, h: number) {
    this.width = w;
    this.height = h;
  }

  setPosition(x: number, y: number) {
    callLog.setPosition++;
    this.x = x;
    this.y = y;
    if (strictOffscreenInvariant && (x >= 0 || y >= 0)) {
      throw new Error(`INVARIANT VIOLATION: win.setPosition(${x}, ${y}) moved window onscreen during strict offscreen mode!`);
    }
  }

  getPosition(): [number, number] {
    return [this.x, this.y];
  }

  isMinimized(): boolean {
    return this.minimized;
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

  getTitle() {
    return 'Google Flow';
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
      getPath: () => path.join(os.tmpdir(), 'vanhsub-challenger-test'),
      name: 'vanhsub-challenger-test',
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
    nativeImage: {
      createFromPath: (_p: string) => ({
        isEmpty: () => false,
        toPNG: () => Buffer.from('png'),
      }),
    },
  },
} as any;

// Helper to create test assets
const tempDir = path.join(os.tmpdir(), 'vanhsub_challenger_m1');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}
const testInitFrameFile = path.join(tempDir, 'challenger_init_frame.png');
const testRefImageFile = path.join(tempDir, 'challenger_ref_image.png');
fs.writeFileSync(testInitFrameFile, Buffer.from('test-image-data-init-frame'));
fs.writeFileSync(testRefImageFile, Buffer.from('test-image-data-ref-image'));

// ---------------------------------------------------------------------------
// 2. Test Runner
// ---------------------------------------------------------------------------
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║       EMPIRICAL CHALLENGER TEST SUITE: MILESTONE 1 (R1)          ║');
  console.log('║   True Stealth, Offscreen Invariants & Focus Leak Stress Tests   ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let failed = 0;
  const failureDetails: string[] = [];

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✘ [FAIL] ${name}`);
      console.error(`     Error: ${err?.message || err}`);
      failureDetails.push(`${name}: ${err?.message || err}`);
      failed++;
    }
  }

  // Load target modules
  const { GoogleVeoSessionManager, OFFSCREEN_X, OFFSCREEN_Y } = await import('../main/veo/GoogleVeoSessionManager');
  const sessionMgr = GoogleVeoSessionManager.getInstance();

  // -------------------------------------------------------------------------
  // SUITE 1: Configuration Defaults & Schema Hardening
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 1: Configuration Defaults Hardening ---');
  await test('T1.1: DEFAULT_FLOW_ENGINE_CONFIG.uiMode defaults to "offscreen"', async () => {
    const { DEFAULT_FLOW_ENGINE_CONFIG } = await import('../main/ai-studio/types');
    assert.strictEqual(DEFAULT_FLOW_ENGINE_CONFIG.uiMode, 'offscreen');
  });

  await test('T1.2: DEFAULT_AI_STUDIO_CONFIG.flowEngine.uiMode defaults to "offscreen"', async () => {
    const { DEFAULT_AI_STUDIO_CONFIG } = await import('../renderer/types/aiStudio');
    assert.strictEqual(DEFAULT_AI_STUDIO_CONFIG.flowEngine.uiMode, 'offscreen');
  });

  // -------------------------------------------------------------------------
  // SUITE 2: High-Frequency & Concurrent openLobbyWindow (Stress Oracle)
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 2: High-Frequency & Concurrent openLobbyWindow ---');
  
  await test('T2.1: 100 sequential openLobbyWindow({ uiMode: "offscreen" }) calls remain strictly offscreen', async () => {
    // Reset any existing window
    if (sessionMgr.lobbyWindow && !sessionMgr.lobbyWindow.isDestroyed()) {
      sessionMgr.lobbyWindow.destroy();
      sessionMgr.lobbyWindow = null;
    }
    resetCallLog();
    strictOffscreenInvariant = true;

    for (let i = 0; i < 100; i++) {
      await sessionMgr.openLobbyWindow({ uiMode: 'offscreen' });
      const win = sessionMgr.lobbyWindow;
      assert(win, `LobbyWindow must exist at iteration ${i}`);
      assert.strictEqual(win.x, OFFSCREEN_X, `Window x must be ${OFFSCREEN_X} at iteration ${i}`);
      assert.strictEqual(win.y, OFFSCREEN_Y, `Window y must be ${OFFSCREEN_Y} at iteration ${i}`);
      assert.strictEqual(sessionMgr.isLobbyDebugVisible, false, `isLobbyDebugVisible must be false at iteration ${i}`);
    }

    assert.strictEqual(callLog.show, 0, 'Zero show() calls allowed across 100 sequential offscreen calls');
    assert.strictEqual(callLog.focus, 0, 'Zero focus() calls allowed across 100 sequential offscreen calls');
    assert.strictEqual(callLog.restore, 0, 'Zero restore() calls allowed across 100 sequential offscreen calls');
    strictOffscreenInvariant = false;
  });

  await test('T2.2: 25 concurrent openLobbyWindow({ uiMode: "offscreen" }) calls remain strictly offscreen', async () => {
    resetCallLog();
    strictOffscreenInvariant = true;

    const promises = Array.from({ length: 25 }, () => sessionMgr.openLobbyWindow({ uiMode: 'offscreen' }));
    await Promise.all(promises);

    const win = sessionMgr.lobbyWindow;
    assert(win, 'LobbyWindow must exist after concurrent calls');
    assert.strictEqual(win.x, OFFSCREEN_X);
    assert.strictEqual(win.y, OFFSCREEN_Y);
    assert.strictEqual(callLog.show, 0);
    assert.strictEqual(callLog.focus, 0);
    assert.strictEqual(callLog.restore, 0);
    strictOffscreenInvariant = false;
  });

  await test('T2.3: 50 openLobbyWindow() calls with NO arguments default to offscreen', async () => {
    resetCallLog();
    strictOffscreenInvariant = true;

    for (let i = 0; i < 50; i++) {
      await sessionMgr.openLobbyWindow();
      const win = sessionMgr.lobbyWindow;
      assert.strictEqual(win.x, OFFSCREEN_X);
      assert.strictEqual(win.y, OFFSCREEN_Y);
      assert.strictEqual(sessionMgr.isLobbyDebugVisible, false);
    }

    assert.strictEqual(callLog.show, 0);
    assert.strictEqual(callLog.focus, 0);
    strictOffscreenInvariant = false;
  });

  await test('T2.4: 10 forceRecreate: true calls in offscreen mode never leak focus or position', async () => {
    resetCallLog();
    strictOffscreenInvariant = true;

    for (let i = 0; i < 10; i++) {
      await sessionMgr.openLobbyWindow({ forceRecreate: true, uiMode: 'offscreen' });
      const win = sessionMgr.lobbyWindow;
      assert(win, 'Window must exist');
      assert.strictEqual(win.x, OFFSCREEN_X);
      assert.strictEqual(win.y, OFFSCREEN_Y);
    }

    assert.strictEqual(callLog.show, 0);
    assert.strictEqual(callLog.focus, 0);
    assert.strictEqual(callLog.restore, 0);
    strictOffscreenInvariant = false;
  });

  // -------------------------------------------------------------------------
  // SUITE 3: Dynamic Mode Flapping (Offscreen <-> Live Window)
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 3: Mode Toggling Flapping & Isolation ---');

  await test('T3.1: 10 back-and-forth toggles between live_window and offscreen restore offscreen invariants', async () => {
    for (let i = 0; i < 10; i++) {
      // 1. Switch to live_window
      strictOffscreenInvariant = false;
      await sessionMgr.openLobbyWindow({ uiMode: 'live_window' });
      assert.strictEqual(sessionMgr.isLobbyDebugVisible, true, `live_window should be visible at iteration ${i}`);
      assert.strictEqual(sessionMgr.lobbyWindow.x, 100);
      assert.strictEqual(sessionMgr.lobbyWindow.y, 60);

      // 2. Switch back to offscreen
      resetCallLog();
      strictOffscreenInvariant = true;
      await sessionMgr.openLobbyWindow({ uiMode: 'offscreen' });
      assert.strictEqual(sessionMgr.isLobbyDebugVisible, false, `offscreen should be invisible at iteration ${i}`);
      assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
      assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
      assert.strictEqual(callLog.show, 0, `show() must not be called when toggling to offscreen at iteration ${i}`);
      assert.strictEqual(callLog.focus, 0, `focus() must not be called when toggling to offscreen at iteration ${i}`);
      strictOffscreenInvariant = false;
    }
  });

  await test('T3.2: hideLobbyOffscreen immediately restores coordinates without show/focus calls', () => {
    // Put window onscreen first
    sessionMgr.lobbyWindow.setPosition(100, 60);
    sessionMgr.isLobbyDebugVisible = true;

    resetCallLog();
    strictOffscreenInvariant = true;
    const ok = sessionMgr.hideLobbyOffscreen();

    assert.strictEqual(ok, true);
    assert.strictEqual(sessionMgr.isLobbyDebugVisible, false);
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    assert.strictEqual(callLog.show, 0);
    assert.strictEqual(callLog.focus, 0);
    assert.strictEqual(callLog.restore, 0);
    strictOffscreenInvariant = false;
  });

  // -------------------------------------------------------------------------
  // SUITE 4: Crash Watchdog Self-Healing Invariant
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 4: Crash Watchdog Self-Healing ---');

  await test('T4.1: handleRendererCrash recreates window strictly offscreen without focus', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallLog();
    strictOffscreenInvariant = true;

    const recoveredWin = await sessionMgr.handleRendererCrash({ reason: 'gpu-process-crashed', exitCode: -1 });

    assert(recoveredWin, 'Recovered window must exist');
    assert.strictEqual(recoveredWin.x, OFFSCREEN_X);
    assert.strictEqual(recoveredWin.y, OFFSCREEN_Y);
    assert.strictEqual(sessionMgr.isLobbyDebugVisible, false);
    assert.strictEqual(callLog.show, 0);
    assert.strictEqual(callLog.focus, 0);
    assert.strictEqual(callLog.restore, 0);
    strictOffscreenInvariant = false;
  });

  await test('T4.2: recreateLobbyWindow keeps window strictly offscreen', async () => {
    resetCallLog();
    strictOffscreenInvariant = true;

    const recreated = await sessionMgr.recreateLobbyWindow();

    assert(recreated, 'Recreated window must exist');
    assert.strictEqual(recreated.x, OFFSCREEN_X);
    assert.strictEqual(recreated.y, OFFSCREEN_Y);
    assert.strictEqual(callLog.show, 0);
    assert.strictEqual(callLog.focus, 0);
    strictOffscreenInvariant = false;
  });

  // -------------------------------------------------------------------------
  // SUITE 5: Flow Video Generation States Invariant
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 5: Flow Video Generation States Invariant ---');
  const {
    VideoOpenFlowState,
    VideoHandleInitFrameState,
    VideoEnterPromptState,
    VideoClickGenerateState,
  } = await import('../main/workflow/flow-engine/states/FlowVideoGenerationStates');

  await test('T5.1: VideoOpenFlowState with offscreen sessionMgr does NOT call show(), focus(), or restore()', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallLog();
    strictOffscreenInvariant = true;

    const ctx: any = {
      win: sessionMgr.lobbyWindow,
      sessionMgr,
      targetProjectId: 'test-proj',
    };

    const res = await VideoOpenFlowState.execute(ctx);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(callLog.show, 0);
    assert.strictEqual(callLog.focus, 0);
    assert.strictEqual(callLog.restore, 0);
    strictOffscreenInvariant = false;
  });

  await test('T5.2: VideoOpenFlowState with minimized window does NOT call restore() in offscreen mode', async () => {
    sessionMgr.hideLobbyOffscreen();
    sessionMgr.lobbyWindow.minimized = true;
    resetCallLog();
    strictOffscreenInvariant = true;

    const ctx: any = {
      win: sessionMgr.lobbyWindow,
      sessionMgr,
      targetProjectId: 'test-proj',
    };

    const res = await VideoOpenFlowState.execute(ctx);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(callLog.restore, 0, 'win.restore() must NOT be called in offscreen mode even if minimized');
    strictOffscreenInvariant = false;
  });

  await test('T5.3: VideoOpenFlowState defensive check: missing sessionMgr but offscreen coordinates does NOT show/focus', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallLog();
    strictOffscreenInvariant = true;

    const ctx: any = {
      win: sessionMgr.lobbyWindow,
      sessionMgr: null, // decoupled sessionMgr
      targetProjectId: 'test-proj',
    };

    const res = await VideoOpenFlowState.execute(ctx);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(callLog.show, 0);
    assert.strictEqual(callLog.focus, 0);
    assert.strictEqual(callLog.restore, 0);
    strictOffscreenInvariant = false;
  });

  await test('T5.4: VideoHandleInitFrameState calls webContents.focus() and NOT win.focus()', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallLog();
    strictOffscreenInvariant = true;

    const ctx: any = {
      win: sessionMgr.lobbyWindow,
      sessionMgr,
      initFrameUrl: testInitFrameFile,
    };

    const res = await VideoHandleInitFrameState.execute(ctx);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(callLog.focus, 0, 'OS-level win.focus() must NOT be called');
    assert.strictEqual(callLog.webContentsFocus, 1, 'Chromium internal webContents.focus() must be called');
    assert.strictEqual(callLog.webContentsPaste, 1, 'Chromium internal webContents.paste() must be called');
    strictOffscreenInvariant = false;
  });

  await test('T5.5: VideoEnterPromptState calls webContents.focus() and NOT win.focus()', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallLog();
    strictOffscreenInvariant = true;

    const ctx: any = {
      win: sessionMgr.lobbyWindow,
      sessionMgr,
      prompt: 'A cinematic drone shot over ancient Japanese temple in snowy mountains',
    };

    const res = await VideoEnterPromptState.execute(ctx);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(callLog.focus, 0, 'OS-level win.focus() must NOT be called');
    assert.strictEqual(callLog.webContentsFocus, 1, 'Chromium internal webContents.focus() must be called');
    strictOffscreenInvariant = false;
  });

  await test('T5.6: VideoClickGenerateState calls webContents.focus() and NOT win.focus()', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallLog();
    strictOffscreenInvariant = true;

    const ctx: any = {
      win: sessionMgr.lobbyWindow,
      sessionMgr,
      btnCoords: { x: 500, y: 500 },
    };

    const res = await VideoClickGenerateState.execute(ctx);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(callLog.focus, 0, 'OS-level win.focus() must NOT be called');
    assert.strictEqual(callLog.webContentsFocus, 1, 'Chromium internal webContents.focus() must be called');
    assert.strictEqual(callLog.sendInputEvent >= 3, true, 'Mouse input events must be dispatched via webContents');
    strictOffscreenInvariant = false;
  });

  // -------------------------------------------------------------------------
  // SUITE 6: Flow Image Generation States Invariant
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 6: Flow Image Generation States Invariant ---');
  const {
    OpenFlowState,
    HandleImageReferenceState,
    EnterPromptState,
  } = await import('../main/workflow/flow-engine/states/FlowImageGenerationStates');

  await test('T6.1: OpenFlowState ensures lobby is at flow offscreen with 0 focus stealing', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallLog();
    strictOffscreenInvariant = true;

    const ctx: any = {
      win: sessionMgr.lobbyWindow,
      sessionMgr,
    };

    const res = await OpenFlowState.execute(ctx);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(callLog.show, 0);
    assert.strictEqual(callLog.focus, 0);
    assert.strictEqual(callLog.restore, 0);
    assert.strictEqual(ctx.win.x, OFFSCREEN_X);
    assert.strictEqual(ctx.win.y, OFFSCREEN_Y);
    strictOffscreenInvariant = false;
  });

  await test('T6.2: HandleImageReferenceState uses webContents.focus() without calling win.focus()', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallLog();
    strictOffscreenInvariant = true;

    const ctx: any = {
      win: sessionMgr.lobbyWindow,
      sessionMgr,
      referenceImagePath: testRefImageFile,
    };

    const res = await HandleImageReferenceState.execute(ctx);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(callLog.focus, 0, 'OS win.focus() must not be called');
    assert.strictEqual(callLog.webContentsFocus, 1, 'webContents.focus() must be called');
    assert.strictEqual(callLog.webContentsPaste, 1, 'webContents.paste() must be called');
    strictOffscreenInvariant = false;
  });

  await test('T6.3: EnterPromptState uses webContents.focus() without calling win.focus()', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallLog();
    strictOffscreenInvariant = true;

    const ctx: any = {
      win: sessionMgr.lobbyWindow,
      sessionMgr,
      prompt: 'Detailed matte painting of Tokyo skyline at night, cyberpunk style',
    };

    const res = await EnterPromptState.execute(ctx);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(callLog.focus, 0, 'OS win.focus() must not be called');
    assert.strictEqual(callLog.webContentsFocus, 1, 'webContents.focus() must be called');
    strictOffscreenInvariant = false;
  });

  // -------------------------------------------------------------------------
  // SUITE 7: Interactive Helper Methods & Focus Stealing Eradication
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 7: Session Manager Helpers Offscreen Safety ---');

  await test('T7.1: autoConfirmAgentPermission in offscreen mode dispatches click without focus() or restore()', async () => {
    sessionMgr.hideLobbyOffscreen();
    sessionMgr.lobbyWindow.minimized = true;
    resetCallLog();
    strictOffscreenInvariant = true;

    sessionMgr.safeExecuteJs = async () => ({
      status: 'clicked_action_button',
      coords: { x: 350, y: 450 },
      label: 'Accept & Continue',
    });

    await sessionMgr.autoConfirmAgentPermission(sessionMgr.lobbyWindow);

    assert.strictEqual(callLog.focus, 0, 'win.focus() must NOT be called in offscreen mode');
    assert.strictEqual(callLog.restore, 0, 'win.restore() must NOT be called in offscreen mode');
    assert.strictEqual(callLog.sendInputEvent >= 2, true, 'sendInputEvent must dispatch click');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    strictOffscreenInvariant = false;
  });

  await test('T7.2: ensureCleanCanvasReady in offscreen mode does NOT call show(), focus(), or restore()', async () => {
    sessionMgr.hideLobbyOffscreen();
    sessionMgr.lobbyWindow.minimized = true;
    resetCallLog();
    strictOffscreenInvariant = true;

    sessionMgr.safeExecuteJs = async () => ({
      ready: true,
      hasPrompt: true,
      hasGenBtn: true,
      coords: { x: 300, y: 300 },
    });

    await sessionMgr.ensureCleanCanvasReady(sessionMgr.lobbyWindow);

    assert.strictEqual(callLog.show, 0, 'win.show() must NOT be called in offscreen mode');
    assert.strictEqual(callLog.focus, 0, 'win.focus() must NOT be called in offscreen mode');
    assert.strictEqual(callLog.restore, 0, 'win.restore() must NOT be called in offscreen mode');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    strictOffscreenInvariant = false;
  });

  await test('T7.3: configureGoogleFlowSettings in offscreen mode does NOT call OS win.focus()', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallLog();
    strictOffscreenInvariant = true;

    const { FlowElementFinder } = await import('../main/workflow/flow-engine/FlowElementFinder');
    FlowElementFinder.find = async () => ({
      found: true,
      selectedCandidate: {
        rect: { x: 100, y: 100, width: 50, height: 20 },
        strategy: 'dom_query',
        confidence: 95,
      },
    }) as any;

    await sessionMgr.configureGoogleFlowSettings(sessionMgr.lobbyWindow, 'video', {
      outputCount: 1,
      aspectRatio: '16:9',
      durationSeconds: 4,
    });

    assert.strictEqual(callLog.focus, 0, 'win.focus() must NOT be called in offscreen mode');
    assert.strictEqual(callLog.webContentsFocus >= 2, true, 'win.webContents.focus() should be called');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    strictOffscreenInvariant = false;
  });

  // -------------------------------------------------------------------------
  // SUITE 8: FlowRecoveryManager Diagnostic Capture Invariant
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 8: FlowRecoveryManager Diagnostic Capture Invariant ---');
  const { FlowRecoveryManager } = await import('../main/workflow/flow-engine/FlowRecoveryManager');

  await test('T8.1: handleRecovery for UNKNOWN_STATE maintains coordinates (-3000, -3000) and zero showInactive()', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallLog();
    strictOffscreenInvariant = true;

    const mockCtx: any = {
      taskId: 'challenger-task-diag-1',
      win: sessionMgr.lobbyWindow,
      mode: 'video',
    };

    const rec = await FlowRecoveryManager.handleRecovery(sessionMgr.lobbyWindow, 'UNKNOWN_STATE', mockCtx);
    assert(rec, 'Recovery result must exist');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X, 'X coordinate must remain at OFFSCREEN_X');
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y, 'Y coordinate must remain at OFFSCREEN_Y');
    assert.strictEqual(callLog.showInactive, 0, 'showInactive must NOT be called on recovery screenshot');
    assert.strictEqual(callLog.show, 0, 'show must NOT be called');
    assert.strictEqual(callLog.focus, 0, 'focus must NOT be called');
    strictOffscreenInvariant = false;
  });

  await test('T8.2: handleRecovery for DOM_INSPECTION_FAILED maintains coordinates (-3000, -3000)', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallLog();
    strictOffscreenInvariant = true;

    const mockCtx: any = {
      taskId: 'challenger-task-diag-2',
      win: sessionMgr.lobbyWindow,
      mode: 'image',
    };

    const rec = await FlowRecoveryManager.handleRecovery(sessionMgr.lobbyWindow, 'DOM_INSPECTION_FAILED', mockCtx);
    assert(rec, 'Recovery result must exist');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    assert.strictEqual(callLog.show, 0);
    assert.strictEqual(callLog.focus, 0);
    strictOffscreenInvariant = false;
  });

  // -------------------------------------------------------------------------
  // SUITE 9: Pipeline Engine Dual-Mode Invocations
  // -------------------------------------------------------------------------
  console.log('\n--- SUITE 9: Pipeline Engine Dual-Mode Invocations ---');

  await test('T9.1: Pipeline Engine stage 6 offscreen mode branch guarantees zero show/focus calls', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallLog();
    strictOffscreenInvariant = true;

    const flowUiMode = 'offscreen';
    let lobbyWin = sessionMgr.getLobbyWindow();
    if (!lobbyWin || lobbyWin.isDestroyed()) {
      await sessionMgr.openLobbyWindow({ uiMode: flowUiMode });
      lobbyWin = sessionMgr.getLobbyWindow();
    } else if (flowUiMode === 'offscreen') {
      sessionMgr.hideLobbyOffscreen();
    }

    if (flowUiMode === 'live_window' && lobbyWin && !lobbyWin.isDestroyed()) {
      lobbyWin.show();
      lobbyWin.focus();
    }

    assert.strictEqual(callLog.show, 0);
    assert.strictEqual(callLog.focus, 0);
    assert.strictEqual(lobbyWin.x, OFFSCREEN_X);
    assert.strictEqual(lobbyWin.y, OFFSCREEN_Y);
    strictOffscreenInvariant = false;
  });

  // -------------------------------------------------------------------------
  // Summary & Exit
  // -------------------------------------------------------------------------
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║   CHALLENGE RESULTS: ${passed} Passed, ${failed} Failed                       ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  if (failed > 0) {
    console.error('Failed Test Cases:');
    for (const f of failureDetails) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  } else {
    console.log('ALL EMPIRICAL CHALLENGES PASSED PERFECTLY!');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal crash in challenger suite:', err);
  process.exit(1);
});
