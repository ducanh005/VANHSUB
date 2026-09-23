/**
 * EMPIRICAL CHALLENGER M1_2 ADVERSARIAL TEST SUITE
 * Milestone 1 (R1: True Stealth & Offscreen Background Execution)
 *
 * Focus & Edge Cases Verification:
 * 1. FlowVideoGenerationStates & FlowImageGenerationStates: verify win.focus() is NEVER called
 *    and win.webContents.focus() IS used during simulated paste, enter prompt, and click generate.
 * 2. FlowRecoveryManager: verify window strictly remains offscreen (-3000, -3000) during diagnostic
 *    DOM snapshot and screenshot capture, with ZERO calls to win.setPosition, win.show, win.focus.
 * 3. Mode switching: verify toggling between offscreen, live_window, and back via hideLobbyOffscreen(),
 *    including rapid toggling stress test and destroyed window handling.
 * 4. Helper methods: autoConfirmAgentPermission, ensureCleanCanvasReady, configureGoogleFlowSettings.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import assert from 'assert';

// ---------------------------------------------------------------------------
// 1. Mock Electron with Deep Call Logging & Strict Invariant Assertion
// ---------------------------------------------------------------------------
const electronPath = require.resolve('electron');

let strictOffscreenInvariant = false;
let lastCreatedWindow: any = null;

const callStats = {
  winFocus: 0,
  winShow: 0,
  winRestore: 0,
  winShowInactive: 0,
  winSetPosition: [] as Array<[number, number]>,
  webContentsFocus: 0,
  webContentsPaste: 0,
  webContentsInsertText: [] as string[],
  webContentsSendInputEvent: [] as any[],
  capturePage: 0,
};

function resetCallStats() {
  callStats.winFocus = 0;
  callStats.winShow = 0;
  callStats.winRestore = 0;
  callStats.winShowInactive = 0;
  callStats.winSetPosition = [];
  callStats.webContentsFocus = 0;
  callStats.webContentsPaste = 0;
  callStats.webContentsInsertText = [];
  callStats.webContentsSendInputEvent = [];
  callStats.capturePage = 0;
}

// Temporary directory for test files
const testTempDir = path.join(os.tmpdir(), `challenger-m1-2-${Date.now()}`);
fs.mkdirSync(testTempDir, { recursive: true });

// Create a real dummy image file for reference and initFrame
const dummyImagePath = path.join(testTempDir, 'test-character-ref.png');
// Valid 1x1 PNG buffer
const validPngBuffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);
fs.writeFileSync(dummyImagePath, validPngBuffer);

let customJsExecutor: ((code: string) => any) | null = null;

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
        if (customJsExecutor) {
          return customJsExecutor(code);
        }
        // Default smart JS executor based on script content
        const lower = code.toLowerCase();
        if (code.includes('outerHTML')) {
          return '<html><head></head><body><flow-app><div class="flow-editor">Editor Ready</div></flow-app></body></html>';
        }
        if (lower.includes('flow-image-ingredient-chip') || lower.includes('chip-image') || lower.includes('thành phần')) {
          // If paste has occurred, return chip confirmed; otherwise return false
          if (callStats.webContentsPaste > 0) {
            return { hasChip: true, src: 'https://flow.google.com/assets/ref_pasted.png', selector: 'mat-chip' };
          }
          return { hasChip: false, src: '' };
        }
        if (lower.includes('selectcanvasimagejs') || lower.includes('flow-image-tile')) {
          return 'none';
        }
        if (lower.includes('add-menu-trigger') || lower.includes('addbtnjs') || lower.includes('thêm.*thành phần')) {
          return { found: false };
        }
        if (lower.includes('textlen')) {
          return { found: true, textLen: 30 };
        }
        // 1. checkEffectJs (scans spinners and toasts)
        if (lower.includes('flow-loading-indicator') || lower.includes('hasspinner') || lower.includes('btndiag')) {
          const hasClicked = callStats.webContentsSendInputEvent.length > 0;
          return {
            hasSpinner: hasClicked,
            hasGeneratingCard: false,
            promptCleared: hasClicked,
            active: hasClicked,
            toast: { found: false, text: '', selector: '' },
          };
        }
        // 2. freshCoordJs (computes coordinates of generate button)
        if (lower.includes('genbtnselectors') || lower.includes('freshcoordjs')) {
          return {
            ok: true,
            coords: { x: 500, y: 400, width: 80, height: 40, top: 380, left: 460 },
            label: 'Generate',
            computedAt: Date.now(),
          };
        }
        // 3. clickBtnJs (DOM click on generate button)
        if (lower.includes('btn.click()') || lower.includes('mat-mdc-button-disabled')) {
          return true;
        }
        // 4. checkStillTextJs
        if (lower.includes('checkstilltextjs') || (lower.includes('el.innertext') && lower.includes('length > 0'))) {
          return false;
        }
        if (lower.includes('prosemirror')) {
          return { ok: true, found: true };
        }
        return true;


      },
      insertCSS: async () => {},
      sendInputEvent: (evt: any) => {
        callStats.webContentsSendInputEvent.push(evt);
      },
      insertText: async (txt: string) => {
        callStats.webContentsInsertText.push(txt);
      },
      paste: () => {
        callStats.webContentsPaste++;
      },
      getURL: () => 'https://flow.google.com/project/challenger-m1-2-project',
      isLoading: () => false,
      isCrashed: () => false,
      focus: () => {
        callStats.webContentsFocus++;
      },
      setZoomFactor: () => {},
      capturePage: async () => {
        callStats.capturePage++;
        return {
          isEmpty: () => false,
          toPNG: () => validPngBuffer,
        };
      },
      on: (evt: string, cb: Function) => {
        if (!this.eventHandlers.has(evt)) this.eventHandlers.set(evt, []);
        this.eventHandlers.get(evt)!.push(cb);
      },
      once: (evt: string, cb: Function) => cb(),
    };
    lastCreatedWindow = this;
  }

  show() {
    callStats.winShow++;
    this.isShown = true;
    if (strictOffscreenInvariant) {
      throw new Error('INVARIANT VIOLATION: win.show() called during strict offscreen mode!');
    }
  }

  focus() {
    callStats.winFocus++;
    if (strictOffscreenInvariant) {
      throw new Error('INVARIANT VIOLATION: win.focus() called during strict offscreen mode!');
    }
  }

  restore() {
    callStats.winRestore++;
    this.minimized = false;
    if (strictOffscreenInvariant) {
      throw new Error('INVARIANT VIOLATION: win.restore() called during strict offscreen mode!');
    }
  }

  showInactive() {
    callStats.winShowInactive++;
  }

  setSize(w: number, h: number) {
    this.width = w;
    this.height = h;
  }

  setPosition(x: number, y: number) {
    callStats.winSetPosition.push([x, y]);
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

let clipboardText = '';
let clipboardImage: any = null;

const mockNativeImage = {
  createFromPath: (filePath: string) => ({
    isEmpty: () => !fs.existsSync(filePath) || fs.statSync(filePath).size === 0,
    toPNG: () => (fs.existsSync(filePath) ? fs.readFileSync(filePath) : validPngBuffer),
    getSize: () => ({ width: 800, height: 600 }),
  }),
  createEmpty: () => ({
    isEmpty: () => true,
    toPNG: () => Buffer.from(''),
  }),
};

const mockClipboard = {
  writeText: (t: string) => { clipboardText = t; },
  readText: () => clipboardText,
  writeImage: (img: any) => { clipboardImage = img; },
  readImage: () => clipboardImage || mockNativeImage.createEmpty(),
  clear: () => { clipboardText = ''; clipboardImage = null; },
};

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
      getPath: (name: string) => path.join(testTempDir, name || 'userData'),
      name: 'vanhsub-challenger-m1-2-test',
      getVersion: () => '1.0.0',
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
    },
    clipboard: mockClipboard,
    nativeImage: mockNativeImage,
  },
} as any;

// ---------------------------------------------------------------------------
// 2. Test Execution & Assertion Engine
// ---------------------------------------------------------------------------
async function runAllChallengerTests() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║        CHALLENGER M1_2: EMPIRICAL EDGE CASES & STRESS VERIFICATION          ║');
  console.log('║      State Machine Focus Isolation, Offscreen Diagnostics, Mode Toggle       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let failed = 0;
  const failureList: string[] = [];

  async function testCase(name: string, fn: () => Promise<void> | void) {
    try {
      customJsExecutor = null;
      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✘ [FAIL] ${name}`);
      console.error(`     Error: ${err?.message || err}`);
      failureList.push(`${name}: ${err?.message || err}`);
      failed++;
    }
  }

  const { GoogleVeoSessionManager, OFFSCREEN_X, OFFSCREEN_Y } = await import('../main/veo/GoogleVeoSessionManager');
  const sessionMgr = GoogleVeoSessionManager.getInstance();

  // Ensure fresh offscreen window initially
  if (sessionMgr.lobbyWindow && !sessionMgr.lobbyWindow.isDestroyed()) {
    sessionMgr.lobbyWindow.destroy();
    sessionMgr.lobbyWindow = null;
  }
  await sessionMgr.openLobbyWindow({ uiMode: 'offscreen' });

  // =========================================================================
  // SUITE 1: FlowVideoGenerationStates Focus & Input Isolation
  // =========================================================================
  console.log('\n--- SUITE 1: FlowVideoGenerationStates Focus & Input Isolation ---');
  const {
    VideoOpenFlowState,
    VideoHandleInitFrameState,
    VideoEnterPromptState,
    VideoClickGenerateState,
  } = await import('../main/workflow/flow-engine/states/FlowVideoGenerationStates');

  await testCase('T1.1: VideoHandleInitFrameState simulated paste uses webContents.focus() and NEVER win.focus()', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallStats();
    strictOffscreenInvariant = true;

    // Custom JS executor: chip is not present, canvas link returns none, ProseMirror is found
    customJsExecutor = (code: string) => {
      const lower = code.toLowerCase();
      if (lower.includes('checkexistingchipjs') || lower.includes('flow-image-ingredient-chip')) return false;
      if (lower.includes('selectcanvasimagejs') || lower.includes('flow-image-tile')) return 'none';
      return { ok: true };
    };

    const ctx: any = {
      win: sessionMgr.lobbyWindow,
      sessionMgr,
      initFrameUrl: dummyImagePath,
      electron: require('electron'),
    };

    const result = await VideoHandleInitFrameState.execute(ctx);
    assert.strictEqual(result.ok, true, 'VideoHandleInitFrameState.execute should succeed');
    assert.strictEqual(callStats.winFocus, 0, 'win.focus() must NOT be called');
    assert.strictEqual(callStats.winShow, 0, 'win.show() must NOT be called');
    assert.strictEqual(callStats.winRestore, 0, 'win.restore() must NOT be called');
    assert.strictEqual(callStats.webContentsFocus, 1, 'win.webContents.focus() MUST be called before paste');
    assert.strictEqual(callStats.webContentsPaste, 1, 'win.webContents.paste() MUST be called');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X, 'Window must remain at OFFSCREEN_X');
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y, 'Window must remain at OFFSCREEN_Y');
    strictOffscreenInvariant = false;
  });

  await testCase('T1.2: VideoEnterPromptState simulated prompt entry uses webContents.focus() and NEVER win.focus()', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallStats();
    strictOffscreenInvariant = true;

    const ctx: any = {
      win: sessionMgr.lobbyWindow,
      sessionMgr,
      prompt: 'A dramatic cinematic shot of a samurai standing in a bamboo forest during snowfall',
      electron: require('electron'),
    };

    const result = await VideoEnterPromptState.execute(ctx);
    assert.strictEqual(result.ok, true, 'VideoEnterPromptState.execute should succeed');
    assert.strictEqual(callStats.winFocus, 0, 'win.focus() must NOT be called');
    assert.strictEqual(callStats.winShow, 0, 'win.show() must NOT be called');
    assert.strictEqual(callStats.winRestore, 0, 'win.restore() must NOT be called');
    assert.strictEqual(callStats.webContentsFocus, 1, 'win.webContents.focus() MUST be called');
    assert.strictEqual(callStats.webContentsPaste, 1, 'win.webContents.paste() MUST be called');
    assert.strictEqual(clipboardText, ctx.prompt, 'Prompt text must be loaded into clipboard');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    strictOffscreenInvariant = false;
  });

  await testCase('T1.3: VideoClickGenerateState simulated click uses webContents.focus() and webContents input events without win.focus()', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallStats();
    strictOffscreenInvariant = true;

    const ctx: any = {
      win: sessionMgr.lobbyWindow,
      sessionMgr,
      btnCoords: { x: 620, y: 540 },
    };

    const result = await VideoClickGenerateState.execute(ctx);
    assert.strictEqual(result.ok, true, 'VideoClickGenerateState.execute should succeed');
    assert.strictEqual(callStats.winFocus, 0, 'win.focus() must NOT be called');
    assert.strictEqual(callStats.winShow, 0, 'win.show() must NOT be called');
    assert.strictEqual(callStats.winRestore, 0, 'win.restore() must NOT be called');
    assert.strictEqual(callStats.webContentsFocus, 1, 'win.webContents.focus() MUST be called before mouse events');
    assert(callStats.webContentsSendInputEvent.length >= 3, 'mouseMove, mouseDown, mouseUp events must be dispatched');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    strictOffscreenInvariant = false;
  });

  await testCase('T1.4: VideoOpenFlowState respects isOffscreen and coordinate guards across multiple configurations', async () => {
    // 1.4a Offscreen mode: zero show/focus/restore
    sessionMgr.hideLobbyOffscreen();
    resetCallStats();
    strictOffscreenInvariant = true;
    let ctx: any = { win: sessionMgr.lobbyWindow, sessionMgr, targetProjectId: 'proj-1' };
    let res = await VideoOpenFlowState.execute(ctx);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(callStats.winFocus, 0);
    assert.strictEqual(callStats.winShow, 0);
    assert.strictEqual(callStats.winRestore, 0);
    strictOffscreenInvariant = false;

    // 1.4b Live mode: calls show() and focus()
    sessionMgr.lobbyWindow.setPosition(100, 60);
    sessionMgr.isLobbyDebugVisible = true;
    resetCallStats();
    ctx = { win: sessionMgr.lobbyWindow, sessionMgr, targetProjectId: 'proj-1' };
    res = await VideoOpenFlowState.execute(ctx);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(callStats.winShow, 1, 'show() should be called in live mode');
    assert.strictEqual(callStats.winFocus, 1, 'focus() should be called in live mode');

    // 1.4c Defensive check: sessionMgr is null, but window coordinates are negative
    sessionMgr.hideLobbyOffscreen();
    resetCallStats();
    strictOffscreenInvariant = true;
    ctx = { win: sessionMgr.lobbyWindow, sessionMgr: null, targetProjectId: 'proj-1' };
    res = await VideoOpenFlowState.execute(ctx);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(callStats.winFocus, 0, 'Negative coordinates alone must suppress focus()');
    assert.strictEqual(callStats.winShow, 0, 'Negative coordinates alone must suppress show()');
    strictOffscreenInvariant = false;
  });

  // =========================================================================
  // SUITE 2: FlowImageGenerationStates Focus & Input Isolation
  // =========================================================================
  console.log('\n--- SUITE 2: FlowImageGenerationStates Focus & Input Isolation ---');
  const {
    OpenFlowState,
    HandleImageReferenceState,
    EnterPromptState,
    ClickGenerateState,
  } = await import('../main/workflow/flow-engine/states/FlowImageGenerationStates');

  await testCase('T2.1: OpenFlowState initializes lobby offscreen with zero focus stealing', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallStats();
    strictOffscreenInvariant = true;

    const ctx: any = { win: sessionMgr.lobbyWindow, sessionMgr };
    const res = await OpenFlowState.execute(ctx);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(callStats.winFocus, 0);
    assert.strictEqual(callStats.winShow, 0);
    assert.strictEqual(callStats.winRestore, 0);
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    strictOffscreenInvariant = false;
  });

  await testCase('T2.2: HandleImageReferenceState fallback clipboard paste uses webContents.focus() and NEVER win.focus()', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallStats();
    strictOffscreenInvariant = true;

    const ctx: any = {

      win: sessionMgr.lobbyWindow,
      sessionMgr,
      referenceImagePath: dummyImagePath,
      electron: require('electron'),
    };

    const res = await HandleImageReferenceState.execute(ctx);
    assert.strictEqual(res.ok, true, 'HandleImageReferenceState.execute should succeed');
    assert.strictEqual(callStats.winFocus, 0, 'win.focus() must NOT be called');
    assert.strictEqual(callStats.winShow, 0, 'win.show() must NOT be called');
    assert.strictEqual(callStats.winRestore, 0, 'win.restore() must NOT be called');
    assert.strictEqual(callStats.webContentsFocus, 1, 'win.webContents.focus() MUST be called');
    assert.strictEqual(callStats.webContentsPaste, 1, 'win.webContents.paste() MUST be called');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    strictOffscreenInvariant = false;
  });

  await testCase('T2.3: EnterPromptState uses webContents.focus() and webContents.insertText() without win.focus()', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallStats();
    strictOffscreenInvariant = true;

    const testPrompt = 'Cyberpunk street food vendor in neon Tokyo alley with rain reflections, ultra detailed';
    const ctx: any = {
      win: sessionMgr.lobbyWindow,
      sessionMgr,
      prompt: testPrompt,
    };

    const res = await EnterPromptState.execute(ctx);
    assert.strictEqual(res.ok, true, 'EnterPromptState.execute should succeed');
    assert.strictEqual(callStats.winFocus, 0, 'win.focus() must NOT be called');
    assert.strictEqual(callStats.winShow, 0, 'win.show() must NOT be called');
    assert.strictEqual(callStats.winRestore, 0, 'win.restore() must NOT be called');
    assert.strictEqual(callStats.webContentsFocus, 1, 'win.webContents.focus() MUST be called');
    assert.strictEqual(callStats.webContentsInsertText.length, 1, 'webContents.insertText MUST be called');
    assert.strictEqual(callStats.webContentsInsertText[0], testPrompt);
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    strictOffscreenInvariant = false;
  });

  await testCase('T2.4: ClickGenerateState dispatches native mouse events on webContents without calling win.focus()', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallStats();
    strictOffscreenInvariant = true;

    customJsExecutor = (code: string) => {
      const lower = code.toLowerCase();
      if (lower.includes('genbtnselectors') || lower.includes('freshcoordjs')) {
        return {
          ok: true,
          coords: { x: 500, y: 400, width: 80, height: 40, top: 380, left: 460 },
          label: 'Generate',
          computedAt: Date.now(),
        };
      }
      if (lower.includes('flow-loading-indicator') || lower.includes('hasspinner') || lower.includes('btndiag')) {
        return {
          hasSpinner: true,
          hasGeneratingCard: false,
          promptCleared: true,
          active: true,
          toast: { found: false, text: '', selector: '' },
          btnDiag: { found: true, disabled: false, label: 'Generate' },
        };
      }
      return true;
    };

    const ctx: any = {
      win: sessionMgr.lobbyWindow,
      sessionMgr,
      prompt: 'Test prompt',
      taskId: 'img-gen-task-test',
      generationAttemptId: 1,
    };

    const res = await ClickGenerateState.execute(ctx);
    assert.strictEqual(res.ok, true, 'ClickGenerateState.execute should succeed');
    assert.strictEqual(callStats.winFocus, 0, 'win.focus() must NOT be called');
    assert.strictEqual(callStats.winShow, 0, 'win.show() must NOT be called');
    assert.strictEqual(callStats.winRestore, 0, 'win.restore() must NOT be called');
    assert(callStats.webContentsSendInputEvent.length >= 2, 'mouseDown and mouseUp must be dispatched');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    strictOffscreenInvariant = false;
  });


  // =========================================================================
  // SUITE 3: FlowRecoveryManager Offscreen Diagnostic Invariant
  // =========================================================================
  console.log('\n--- SUITE 3: FlowRecoveryManager Offscreen Diagnostic Invariant ---');
  const { FlowRecoveryManager } = await import('../main/workflow/flow-engine/FlowRecoveryManager');

  await testCase('T3.1: UNKNOWN_STATE recovery captures valid PNG and HTML without touching window coordinates', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallStats();
    strictOffscreenInvariant = true;

    const mockCtx: any = {
      taskId: 'rec-diag-task-valid-png',
      win: sessionMgr.lobbyWindow,
      mode: 'image',
    };

    const rec = await FlowRecoveryManager.handleRecovery(sessionMgr.lobbyWindow, 'UNKNOWN_STATE', mockCtx);
    assert(rec, 'Recovery result must exist');
    assert.strictEqual(rec.recovered, false);
    assert.strictEqual(rec.shouldAbort, true);
    assert(rec.diagnosticsArtifact, 'diagnosticsArtifact path must be returned');
    assert(fs.existsSync(rec.diagnosticsArtifact!), `Artifact file must exist at ${rec.diagnosticsArtifact}`);

    // Invariant assertions: coordinates MUST NOT move, show/focus MUST NOT be called
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X, 'Window X must remain at OFFSCREEN_X');
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y, 'Window Y must remain at OFFSCREEN_Y');
    assert.strictEqual(callStats.winSetPosition.length, 0, 'win.setPosition must NEVER be called');
    assert.strictEqual(callStats.winShow, 0, 'win.show must NEVER be called');
    assert.strictEqual(callStats.winFocus, 0, 'win.focus must NEVER be called');
    assert.strictEqual(callStats.winRestore, 0, 'win.restore must NEVER be called');
    assert.strictEqual(callStats.winShowInactive, 0, 'win.showInactive must NEVER be called');
    assert.strictEqual(callStats.capturePage, 1, 'capturePage should be called exactly once');
    strictOffscreenInvariant = false;
  });

  await testCase('T3.2: UNKNOWN_STATE recovery handles capturePage failure cleanly via DOM fallback', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallStats();
    strictOffscreenInvariant = true;

    // Temporarily make capturePage reject
    const originalCapturePage = sessionMgr.lobbyWindow.webContents.capturePage;
    sessionMgr.lobbyWindow.webContents.capturePage = async () => {
      throw new Error('Compositor GPU disconnected');
    };

    const mockCtx: any = {
      taskId: 'rec-diag-task-gpu-error',
      win: sessionMgr.lobbyWindow,
      mode: 'video',
    };

    const rec = await FlowRecoveryManager.handleRecovery(sessionMgr.lobbyWindow, 'UNKNOWN_STATE', mockCtx);
    sessionMgr.lobbyWindow.webContents.capturePage = originalCapturePage;

    assert(rec, 'Recovery result must exist');
    assert.strictEqual(rec.recovered, false);
    assert.strictEqual(rec.shouldAbort, true);
    assert(rec.diagnosticsArtifact, 'DOM snapshot fallback artifact must be returned');
    assert(fs.existsSync(rec.diagnosticsArtifact!), 'DOM snapshot file must exist');

    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    assert.strictEqual(callStats.winSetPosition.length, 0);
    assert.strictEqual(callStats.winShow, 0);
    assert.strictEqual(callStats.winFocus, 0);
    strictOffscreenInvariant = false;
  });

  await testCase('T3.3: OVERLAY_BLOCKING, ELEMENT_NOT_FOUND, and SESSION_EXPIRED maintain offscreen invariants', async () => {
    sessionMgr.hideLobbyOffscreen();

    const mockCtx: any = {
      taskId: 'rec-other-errors',
      win: sessionMgr.lobbyWindow,
      mode: 'video',
      onProgress: () => {},
    };

    const errorTypes: Array<'OVERLAY_BLOCKING' | 'ELEMENT_NOT_FOUND' | 'SESSION_EXPIRED'> = [
      'OVERLAY_BLOCKING',
      'ELEMENT_NOT_FOUND',
      'SESSION_EXPIRED',
    ];

    for (const errType of errorTypes) {
      resetCallStats();
      strictOffscreenInvariant = true;

      const res = await FlowRecoveryManager.handleRecovery(sessionMgr.lobbyWindow, errType, mockCtx);
      assert(res, `Result for ${errType} must exist`);
      assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X, `${errType}: X must remain at OFFSCREEN_X`);
      assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y, `${errType}: Y must remain at OFFSCREEN_Y`);
      assert.strictEqual(callStats.winFocus, 0, `${errType}: win.focus must be 0`);
      assert.strictEqual(callStats.winShow, 0, `${errType}: win.show must be 0`);
      assert.strictEqual(callStats.winRestore, 0, `${errType}: win.restore must be 0`);
      strictOffscreenInvariant = false;
    }
  });

  // =========================================================================
  // SUITE 4: Mode Switching & Rapid Toggling Stress Tests
  // =========================================================================
  console.log('\n--- SUITE 4: Mode Switching & Rapid Toggling Stress Tests ---');

  await testCase('T4.1: Multi-cycle toggling between offscreen and live_window maintains strict state sync', async () => {
    for (let cycle = 1; cycle <= 5; cycle++) {
      // 1. Switch to live_window
      strictOffscreenInvariant = false;
      resetCallStats();
      await sessionMgr.openLobbyWindow({ uiMode: 'live_window' });
      assert.strictEqual(sessionMgr.isLobbyDebugVisible, true, `Cycle ${cycle}: isLobbyDebugVisible must be true`);
      assert.strictEqual(sessionMgr.isLobbyDebug(), true, `Cycle ${cycle}: isLobbyDebug() must be true`);
      assert.strictEqual(sessionMgr.lobbyWindow.x, 100);
      assert.strictEqual(sessionMgr.lobbyWindow.y, 60);
      assert.strictEqual(callStats.winShow, 1);
      assert.strictEqual(callStats.winFocus, 1);

      // 2. Switch back to offscreen via hideLobbyOffscreen
      resetCallStats();
      strictOffscreenInvariant = true;
      const hideOk = sessionMgr.hideLobbyOffscreen();
      assert.strictEqual(hideOk, true, `Cycle ${cycle}: hideLobbyOffscreen must return true`);
      assert.strictEqual(sessionMgr.isLobbyDebugVisible, false);
      assert.strictEqual(sessionMgr.isLobbyDebug(), false);
      assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
      assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
      assert.strictEqual(callStats.winShow, 0);
      assert.strictEqual(callStats.winFocus, 0);
      strictOffscreenInvariant = false;

      // 3. Show for debug
      resetCallStats();
      const showDebugOk = await sessionMgr.showLobbyForDebug();
      assert.strictEqual(showDebugOk, true);
      assert.strictEqual(sessionMgr.isLobbyDebugVisible, true);
      assert.strictEqual(sessionMgr.lobbyWindow.x, 100);
      assert.strictEqual(sessionMgr.lobbyWindow.y, 60);

      // 4. Switch back via openLobbyWindow({ uiMode: 'offscreen' })
      resetCallStats();
      strictOffscreenInvariant = true;
      await sessionMgr.openLobbyWindow({ uiMode: 'offscreen' });
      assert.strictEqual(sessionMgr.isLobbyDebugVisible, false);
      assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
      assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
      assert.strictEqual(callStats.winShow, 0);
      assert.strictEqual(callStats.winFocus, 0);
      strictOffscreenInvariant = false;
    }
  });

  await testCase('T4.2: 50 rapid sequential mode toggles stress test without state or coordinate corruption', async () => {
    for (let i = 0; i < 50; i++) {
      strictOffscreenInvariant = false;
      await sessionMgr.openLobbyWindow({ uiMode: 'live_window' });
      assert.strictEqual(sessionMgr.isLobbyDebugVisible, true);

      strictOffscreenInvariant = true;
      sessionMgr.hideLobbyOffscreen();
      assert.strictEqual(sessionMgr.isLobbyDebugVisible, false);
      assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
      assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
      strictOffscreenInvariant = false;
    }

    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    assert.strictEqual(sessionMgr.isLobbyDebugVisible, false);
  });

  await testCase('T4.3: hideLobbyOffscreen and isLobbyDebug handle destroyed / null window gracefully', () => {
    const originalWin = sessionMgr.lobbyWindow;
    sessionMgr.lobbyWindow = null;

    assert.strictEqual(sessionMgr.hideLobbyOffscreen(), false, 'hideLobbyOffscreen on null window returns false');
    assert.strictEqual(sessionMgr.isLobbyDebug(), false, 'isLobbyDebug on null window returns false');

    sessionMgr.lobbyWindow = { isDestroyed: () => true } as any;
    assert.strictEqual(sessionMgr.hideLobbyOffscreen(), false, 'hideLobbyOffscreen on destroyed window returns false');
    assert.strictEqual(sessionMgr.isLobbyDebug(), false, 'isLobbyDebug on destroyed window returns false');

    // Restore
    sessionMgr.lobbyWindow = originalWin;
  });

  // =========================================================================
  // SUITE 5: Session Manager Helper Methods & Focus Stealing Eradication
  // =========================================================================
  console.log('\n--- SUITE 5: Session Manager Helper Methods Offscreen Safety ---');

  await testCase('T5.1: autoConfirmAgentPermission in offscreen mode dispatches click without win.focus()', async () => {
    sessionMgr.hideLobbyOffscreen();
    sessionMgr.lobbyWindow.minimized = true;
    resetCallStats();
    strictOffscreenInvariant = true;

    sessionMgr.safeExecuteJs = async () => ({
      status: 'clicked_action_button',
      coords: { x: 420, y: 360 },
      label: 'Confirm Action',
    });

    await sessionMgr.autoConfirmAgentPermission(sessionMgr.lobbyWindow);

    assert.strictEqual(callStats.winFocus, 0, 'win.focus() must NOT be called in offscreen mode');
    assert.strictEqual(callStats.winRestore, 0, 'win.restore() must NOT be called in offscreen mode');
    assert(callStats.webContentsSendInputEvent.length >= 2, 'sendInputEvent must dispatch click');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    strictOffscreenInvariant = false;
  });

  await testCase('T5.2: ensureCleanCanvasReady in offscreen mode does NOT call show(), focus(), or restore()', async () => {
    sessionMgr.hideLobbyOffscreen();
    sessionMgr.lobbyWindow.minimized = true;
    resetCallStats();
    strictOffscreenInvariant = true;

    sessionMgr.safeExecuteJs = async () => ({
      ready: true,
      hasPrompt: true,
      hasGenBtn: true,
      coords: { x: 320, y: 320 },
    });

    await sessionMgr.ensureCleanCanvasReady(sessionMgr.lobbyWindow);

    assert.strictEqual(callStats.winShow, 0, 'win.show() must NOT be called in offscreen mode');
    assert.strictEqual(callStats.winFocus, 0, 'win.focus() must NOT be called in offscreen mode');
    assert.strictEqual(callStats.winRestore, 0, 'win.restore() must NOT be called in offscreen mode');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    strictOffscreenInvariant = false;
  });

  await testCase('T5.3: configureGoogleFlowSettings in offscreen mode uses webContents.focus() and NEVER win.focus()', async () => {
    sessionMgr.hideLobbyOffscreen();
    resetCallStats();
    strictOffscreenInvariant = true;

    const { FlowElementFinder } = await import('../main/workflow/flow-engine/FlowElementFinder');
    const origFind = FlowElementFinder.find;
    FlowElementFinder.find = async () => ({
      found: true,
      selectedCandidate: {
        rect: { x: 200, y: 150, width: 60, height: 30 },
        strategy: 'dom_query',
        confidence: 95,
      },
    }) as any;

    await sessionMgr.configureGoogleFlowSettings(sessionMgr.lobbyWindow, 'video', {
      outputCount: 1,
      aspectRatio: '16:9',
      durationSeconds: 6,
    });

    FlowElementFinder.find = origFind;

    assert.strictEqual(callStats.winFocus, 0, 'win.focus() must NOT be called in offscreen mode');
    assert.strictEqual(callStats.winShow, 0, 'win.show() must NOT be called in offscreen mode');
    assert.strictEqual(sessionMgr.lobbyWindow.x, OFFSCREEN_X);
    assert.strictEqual(sessionMgr.lobbyWindow.y, OFFSCREEN_Y);
    strictOffscreenInvariant = false;
  });

  // Cleanup temp files
  try {
    fs.rmSync(testTempDir, { recursive: true, force: true });
  } catch {}

  // =========================================================================
  // Final Summary & Exit
  // =========================================================================
  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log(`║   CHALLENGER M1_2 RESULTS: ${passed} Passed, ${failed} Failed                              ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  if (failed > 0) {
    console.error('Failed Test Cases:');
    for (const f of failureList) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  } else {
    console.log('ALL EMPIRICAL CHALLENGES PASSED! ZERO INVARIANT VIOLATIONS DETECTED.');
    process.exit(0);
  }
}

runAllChallengerTests().catch((err) => {
  console.error('Fatal crash in Challenger M1_2 test suite:', err);
  process.exit(1);
});
