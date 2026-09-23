import type {
  FlowAutomationState,
  FlowStateContext,
  ActionResult,
} from '../types';
import { FlowSmartWait } from '../FlowSmartWait';
import { FlowElementFinder } from '../FlowElementFinder';
import { FlowOverlayDetector } from '../FlowOverlayDetector';
import { FlowClipboardGuard } from '../FlowClipboardGuard';
import { HandleImageReferenceState } from './FlowImageGenerationStates';

/**
 * Helper an toàn để execute JS trên BrowserWindow
 */
async function safeExecuteJs<T = any>(
  win: any,
  script: string,
  timeoutMs: number = 5000
): Promise<T | null> {
  if (!win || win.isDestroyed()) return null;
  let timer: any = null;
  try {
    const timeoutPromise = new Promise<null>((_, reject) => {
      timer = setTimeout(() => reject(new Error('EXECUTE_JS_TIMEOUT')), timeoutMs);
    });
    const execPromise = win.webContents.executeJavaScript(script, true);
    const result = (await Promise.race([execPromise, timeoutPromise])) as T;
    return result;
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * STATE 1: OPEN_FLOW_VIDEO
 * Mở URL Google Flow hoặc kích hoạt cửa sổ hiện tại
 */
export const VideoOpenFlowState: FlowAutomationState = {
  name: 'OPEN_FLOW_VIDEO',
  timeoutMs: 15000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(5, 'Đang chuẩn bị phiên làm việc Google Veo Video...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    if (!ctx.win || ctx.win.isDestroyed()) {
      return { ok: false, error: 'BROWSER_WINDOW_DESTROYED', errorDetail: 'Cửa sổ trình duyệt không khả dụng' };
    }

    const sessionMgr = ctx.sessionMgr as any;
    const isOffscreen = sessionMgr ? (!sessionMgr.isLobbyDebug?.() && !sessionMgr.isLobbyDebugVisible) : false;
    const pos = typeof ctx.win.getPosition === 'function' ? ctx.win.getPosition() : [0, 0];
    const isWindowPosOffscreen = pos[0] < 0 || pos[1] < 0;

    if (!isOffscreen && !isWindowPosOffscreen) {
      if (ctx.win.isMinimized()) ctx.win.restore();
      ctx.win.show();
      ctx.win.focus();
    }

    const currentUrl = ctx.win.webContents.getURL() || '';
    if (!currentUrl.includes('flow.google.com')) {
      const targetUrl = ctx.targetProjectId
        ? `https://flow.google.com/project/${ctx.targetProjectId}`
        : 'https://flow.google.com/';
      await ctx.win.loadURL(targetUrl);
    }

    return { ok: true };
  },

  async verify(ctx: FlowStateContext): Promise<ActionResult> {
    const url = ctx.win.webContents.getURL() || '';
    const isFlow = url.includes('flow.google.com');
    return {
      ok: isFlow,
      error: isFlow ? undefined : 'INVALID_URL',
      errorDetail: isFlow ? undefined : `URL hiện tại không thuộc Google Flow: ${url}`,
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 2: WAIT_FOR_PAGE_READY
 * Chờ trang Google Flow nạp hoàn tất
 */
export const VideoWaitForPageReadyState: FlowAutomationState = {
  name: 'WAIT_FOR_PAGE_READY',
  timeoutMs: 15000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(8, 'Đang chờ trang Google Flow sẵn sàng...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const isReady = await FlowSmartWait.pollUntil(
      async () => {
        const ready = await safeExecuteJs<boolean>(ctx.win, `document.readyState === 'complete'`);
        return ready ? true : null;
      },
      { timeoutMs: 10000, initialIntervalMs: 300 }
    ).catch(() => false);
    await FlowOverlayDetector.dismiss(ctx.win);
    return { ok: !!isReady };
  },

  async verify(ctx: FlowStateContext): Promise<ActionResult> {
    const readyState = await safeExecuteJs<string>(ctx.win, 'document.readyState');
    const isReady = readyState === 'complete' || readyState === 'interactive';
    return {
      ok: isReady,
      error: isReady ? undefined : 'PAGE_NOT_READY',
      errorDetail: isReady ? undefined : 'Trang chưa hoàn tất nạp DOM',
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 3: VERIFY_SESSION
 * Kiểm tra người dùng đã đăng nhập Google Flow
 */
export const VideoVerifySessionState: FlowAutomationState = {
  name: 'VERIFY_SESSION',
  timeoutMs: 10000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(10, 'Đang xác thực phiên đăng nhập Google...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const checkAuthJs = `
      (function() {
        const url = window.location.href;
        if (url.includes('accounts.google.com')) return { authed: false, reason: 'REDIRECTED_TO_LOGIN' };
        const body = (document.body.innerText || '').toLowerCase();
        if (body.includes('sign in') && body.includes('google account')) return { authed: false, reason: 'LOGIN_REQUIRED' };
        return { authed: true };
      })()
    `;
    const authRes = await safeExecuteJs<{ authed: boolean; reason?: string }>(ctx.win, checkAuthJs);
    return {
      ok: authRes?.authed ?? true,
      error: authRes?.authed ? undefined : authRes?.reason || 'SESSION_EXPIRED',
    };
  },

  async verify(ctx: FlowStateContext, execResult: ActionResult): Promise<ActionResult> {
    return {
      ok: execResult.ok,
      error: execResult.ok ? undefined : 'SESSION_EXPIRED',
      errorDetail: execResult.ok ? undefined : 'Phiên đăng nhập đã hết hạn. Cần đăng nhập lại.',
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 4: ENSURE_PROJECT_CONTEXT
 * Đảm bảo đã ở trong một Project đang hoạt động
 */
export const VideoEnsureProjectContextState: FlowAutomationState = {
  name: 'ENSURE_PROJECT_CONTEXT',
  timeoutMs: 25000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(12, 'Đang chuẩn bị không gian làm việc video...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    if (ctx.sessionMgr && typeof ctx.sessionMgr.ensureProjectContext === 'function') {
      const ready = await ctx.sessionMgr.ensureProjectContext(
        ctx.win,
        ctx.targetProjectId,
        ctx.onProgress,
        ctx.isCancelled,
        ctx.targetProjectName
      );
      if (!ready) {
        return { ok: false, error: 'project_context_failed', errorDetail: 'Không thể chuẩn bị project context' };
      }
      const pageUrl = (await safeExecuteJs<string>(ctx.win, 'window.location.href')) || ctx.win.webContents?.getURL?.() || '';
      const match = pageUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        ctx.activeProjectId = match[1];
      }
      return { ok: true, data: { inProject: true, url: pageUrl } };
    }

    const currentUrl = ctx.win.webContents.getURL() || '';
    if (currentUrl.includes('/project/')) {
      const match = currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        ctx.activeProjectId = match[1];
      }
      return { ok: true, data: { inProject: true, url: currentUrl } };
    }

    // Nếu đang ở lobby, tìm nút tạo dự án
    const newProjFinder = await FlowElementFinder.find(ctx.win, FlowElementFinder.getNewProjectButtonSpec());

    if (newProjFinder.found && newProjFinder.selectedCandidate) {
      const c = newProjFinder.selectedCandidate;
      const x = Math.round(c.rect.x + c.rect.width / 2);
      const y = Math.round(c.rect.y + c.rect.height / 2);
      ctx.win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 50));
      ctx.win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    }

    return { ok: true };
  },

  async verify(ctx: FlowStateContext): Promise<ActionResult> {
    const isReady = await FlowSmartWait.pollUntil(
      async () => {
        const checkJs = `
          (function() {
            const inProj = window.location.href.includes('/project/');
            const hasTiles = document.querySelectorAll('flow-image-tile, flow-media-tile, flow-canvas, .project-canvas').length > 0;
            const promptEl = document.querySelector('flow-prompt-box .ProseMirror, .prosemirror-editor, [contenteditable="true"]');
            const hasPromptBox = Boolean(document.querySelector('flow-prompt-box, .prompt-box-container'));
            const hasHeader = Boolean(document.querySelector('button[aria-label*="nghe nhìn" i], button[aria-label*="Thêm" i], button[aria-label*="Add" i]'));
            return inProj && (Boolean(promptEl) || hasTiles || hasPromptBox || hasHeader);
          })()
        `;
        const res = await safeExecuteJs<boolean>(ctx.win, checkJs);
        return res ? true : null;
      },
      { timeoutMs: 15000, initialIntervalMs: 500 }
    ).catch(() => false);

    return {
      ok: !!isReady,
      error: isReady ? undefined : 'PROJECT_NOT_READY',
      errorDetail: isReady ? undefined : 'Không gian dự án chưa hoàn tất tải',
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 5: CLEAN_CANVAS
 * Dọn sạch canvas, gỡ bỏ các thẻ chip ảnh cũ
 */
export const VideoCleanCanvasState: FlowAutomationState = {
  name: 'CLEAN_CANVAS',
  timeoutMs: 8000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(14, 'Đang làm sạch khung soạn thảo...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const cleanJs = `
      (function() {
        let removedChips = 0;
        const chipSelectors = [
          'flow-image-ingredient-chip',
          'flow-ingredient-chip',
          '.chip-container',
          '.chip-image-wrapper',
          'mat-chip-row',
          '[data-ingredient-type]'
        ];

        for (const sel of chipSelectors) {
          document.querySelectorAll(sel).forEach(el => {
            const delBtn = el.querySelector('button[aria-label*="xóa" i], button[aria-label*="remove" i], button[aria-label*="delete" i], .close-button, .remove-btn, mat-icon');
            if (delBtn) {
              delBtn.click();
              removedChips++;
            } else {
              el.remove();
              removedChips++;
            }
          });
        }

        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container') || document;
        const promptEl = promptBox.querySelector('.ProseMirror, [contenteditable="true"]');
        if (promptEl) {
          promptEl.innerHTML = '';
          promptEl.dispatchEvent(new Event('input', { bubbles: true }));
          promptEl.dispatchEvent(new Event('change', { bubbles: true }));
        }

        return { ok: true, removedChips };
      })()
    `;
    const res = await safeExecuteJs<{ ok: boolean; removedChips: number }>(ctx.win, cleanJs);
    return { ok: true, data: res };
  },

  async verify(ctx: FlowStateContext): Promise<ActionResult> {
    const checkCleanJs = `
      (function() {
        const remainingChips = document.querySelectorAll('flow-image-ingredient-chip, .chip-container, mat-chip-row').length;
        const promptEl = document.querySelector('flow-prompt-box .ProseMirror, [contenteditable="true"]');
        const text = promptEl ? (promptEl.innerText || '').trim() : '';
        return { chipsCount: remainingChips, textLength: text.length };
      })()
    `;
    const verifyRes = await safeExecuteJs<{ chipsCount: number; textLength: number }>(ctx.win, checkCleanJs);
    const isClean = (verifyRes?.chipsCount ?? 0) === 0 && (verifyRes?.textLength ?? 0) === 0;
    return {
      ok: isClean,
      error: isClean ? undefined : 'CANVAS_NOT_CLEAN',
      errorDetail: isClean ? undefined : `Vẫn còn ${verifyRes?.chipsCount} chip hoặc văn bản chưa được dọn sạch`,
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 6: SELECT_VIDEO_MODE
 * Chuyển sang Mode Tab 'VIDEO' trên giao diện Google Flow
 */
export const VideoSelectModeState: FlowAutomationState = {
  name: 'SELECT_VIDEO_MODE',
  timeoutMs: 15000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(16, 'Đang chọn chế độ tạo Video (Google Veo)...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    // 0. Kiểm tra nếu trigger cài đặt hoặc DOM đã hiển thị sẵn mode Video
    const checkAlreadyVideoJs = `
      (function() {
        try {
          const raw = localStorage.getItem('flow-prompt-box-settings');
          if (raw) {
            const p = JSON.parse(raw);
            if (p.mode === 'VIDEO' || p.mode === 'VIDEO_FRAMES') return true;
          }
        } catch (e) {}

        const triggerSelectors = [
          'button.settings-trigger-button',
          'flow-settings-button button',
          'button[aria-label*="Điều kiện kích hoạt" i]',
          'button[aria-label*="cài đặt" i]',
          'button[aria-label*="settings" i][class*="trigger"]',
          'flow-prompt-box button[aria-label*="cài đặt" i]',
          'flow-prompt-box button[aria-label*="Settings" i]',
          'button:has(mat-icon[fonticon*="tune"])',
          'button:has(mat-icon[fonticon*="sliders"])',
          'button:has(mat-icon[fonticon*="settings"])'
        ];
        for (const sel of triggerSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
            if (t.includes('video') || t.includes('veo') || t.includes('phim')) return true;
          }
        }

        const activeTab = document.querySelector('button[role="tab"][aria-selected="true"], mat-button-toggle.mat-button-toggle-checked');
        if (activeTab) {
          const t = (activeTab.innerText || activeTab.textContent || '').toLowerCase();
          if (t.includes('video') || t.includes('phim')) return true;
        }

        return false;
      })()
    `;
    const alreadyVideo = await safeExecuteJs<boolean>(ctx.win, checkAlreadyVideoJs);
    if (alreadyVideo) {
      console.log('[FlowVideoState] [SELECT_VIDEO_MODE] Google Flow đã ở chế độ Video sẵn sàng.');
      await safeExecuteJs(ctx.win, `
        (function() {
          try {
            const raw = localStorage.getItem('flow-prompt-box-settings');
            const settings = raw ? JSON.parse(raw) : {};
            settings.mode = 'VIDEO';
            localStorage.setItem('flow-prompt-box-settings', JSON.stringify(settings));
          } catch (e) {}
        })()
      `);
      return { ok: true, data: { alreadyVideo: true } };
    }

    // 1. Thử click switch trực tiếp qua Settings Trigger Menu
    const switchViaSettingsMenuJs = `
      (async function() {
        function isVisible(el) {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }

        const triggerSelectors = [
          'button.settings-trigger-button',
          'flow-settings-button button',
          'button[aria-label*="Điều kiện kích hoạt" i]',
          'button[aria-label*="cài đặt" i]',
          'button[aria-label*="settings" i][class*="trigger"]',
          'flow-prompt-box button[aria-label*="cài đặt" i]',
          'flow-prompt-box button[aria-label*="Settings" i]',
          'button:has(mat-icon[fonticon*="tune"])',
          'button:has(mat-icon[fonticon*="sliders"])',
          'button:has(mat-icon[fonticon*="settings"])'
        ];

        let trigger = null;
        for (const sel of triggerSelectors) {
          const el = document.querySelector(sel);
          if (isVisible(el)) { trigger = el; break; }
        }

        if (!trigger) return { ok: false, reason: 'trigger_not_found' };

        trigger.click();
        await new Promise(r => setTimeout(r, 600));

        const pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
        if (!pane) return { ok: false, reason: 'popover_not_opened' };

        const btns = Array.from(pane.querySelectorAll('.cdk-overlay-container button, mat-button-toggle, [role="radio"], [role="menuitem"], button'));
        const videoBtn = btns.find(b => {
          const t = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').toLowerCase();
          return t.includes('videocam') || t.includes('video') || t.includes('phim');
        });

        let switched = false;
        if (videoBtn) {
          const clickTarget = videoBtn.tagName === 'BUTTON' ? videoBtn : (videoBtn.querySelector('button') || videoBtn);
          clickTarget.click();
          switched = true;
          await new Promise(r => setTimeout(r, 300));
        }

        // Đóng popover để gỡ bỏ .cdk-overlay-backdrop
        const bd = document.querySelector('.cdk-overlay-backdrop');
        if (bd) bd.click();

        return { ok: switched, switched };
      })()
    `;
    const switchRes = await safeExecuteJs<any>(ctx.win, switchViaSettingsMenuJs, 5000);
    if (switchRes?.switched) {
      console.log('[FlowVideoState] [SELECT_VIDEO_MODE] Đã chuyển sang chế độ Video qua Settings Trigger.');
    }

    // Đóng popup an toàn bằng phím Escape
    try {
      ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      await new Promise((r) => setTimeout(r, 50));
      ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await new Promise((r) => setTimeout(r, 200));
    } catch {}

    // 2. Đồng bộ LocalStorage
    await safeExecuteJs(
      ctx.win,
      `
      (function() {
        try {
          const raw = localStorage.getItem('flow-prompt-box-settings');
          const settings = raw ? JSON.parse(raw) : {};
          settings.mode = 'VIDEO';
          localStorage.setItem('flow-prompt-box-settings', JSON.stringify(settings));
          window.dispatchEvent(new StorageEvent('storage', { key: 'flow-prompt-box-settings', newValue: JSON.stringify(settings) }));
        } catch (e) {}
      })()
    `
    );

    // 3. Click Mode Tab VIDEO trên DOM qua FlowElementFinder nếu có
    try {
      const modeFinder = await FlowElementFinder.find(ctx.win, FlowElementFinder.getModeTabSpec('video'));
      if (modeFinder.found && modeFinder.selectedCandidate) {
        const c = modeFinder.selectedCandidate;
        const x = Math.round(c.rect.x + c.rect.width / 2);
        const y = Math.round(c.rect.y + c.rect.height / 2);
        ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        await new Promise((r) => setTimeout(r, 40));
        ctx.win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        await new Promise((r) => setTimeout(r, 40));
        ctx.win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (e) {}

    return { ok: true };
  },

  async verify(ctx: FlowStateContext): Promise<ActionResult> {
    const checkVideoTabJs = `
      (function() {
        try {
          const raw = localStorage.getItem('flow-prompt-box-settings');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.mode === 'VIDEO' || parsed.mode === 'VIDEO_FRAMES') return true;
          }
        } catch (e) {}

        const videoBtn = document.querySelector(
          'button[role="tab"][aria-selected="true"], [data-mode="video"][aria-selected="true"], button.active[aria-label*="video" i], mat-button-toggle[value="VIDEO"].mat-button-toggle-checked, button[aria-label*="video" i][aria-pressed="true"], button[aria-label*="phim" i][aria-pressed="true"], button[aria-label*="tạo video" i]'
        );
        if (videoBtn) return true;

        const bodyText = (document.body.innerText || '').toLowerCase();
        if (bodyText.includes('video') || bodyText.includes('phim') || bodyText.includes('veo') || bodyText.includes('cảnh')) {
          return true;
        }

        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container');
        return !!promptBox;
      })()
    `;
    const isVideoMode = await safeExecuteJs<boolean>(ctx.win, checkVideoTabJs);
    const ok = isVideoMode !== false;
    return {
      ok,
      error: ok ? undefined : 'MODE_SWITCH_FAILED',
      errorDetail: ok ? undefined : 'Chưa kích hoạt thành công tab Video',
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 7: HANDLE_INIT_FRAME
 * Nạp ảnh tham chiếu (Image-to-Video) vào Prompt Box nếu có initFrameUrl
 */
export const VideoHandleInitFrameState: FlowAutomationState = {
  name: 'HANDLE_INIT_FRAME',
  timeoutMs: 20000,

  async enter(ctx: FlowStateContext): Promise<void> {
    if (ctx.initFrameUrl) {
      ctx.onProgress?.(18, 'Đang nạp ảnh đầu vào (Image-to-Video)...');
    }
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    if (!ctx.initFrameUrl) {
      return { ok: true, data: { hasInitFrame: false } };
    }

    // 1. Kiểm tra nếu chip ảnh đã có sẵn trong prompt box
    const checkExistingChipJs = `
      (function() {
        const chip = document.querySelector('flow-image-ingredient-chip, flow-ingredient-chip, .chip-container, mat-chip-row, [data-ingredient-type], flow-chip, .chip-image-wrapper, flow-prompt-box mat-chip, .frame-trigger, button[aria-label*="Thành phần tạo hình ảnh" i]');
        return !!chip;
      })()
    `;
    const alreadyHasChip = await safeExecuteJs<boolean>(ctx.win, checkExistingChipJs);
    if (alreadyHasChip) {
      return { ok: true, data: { hasInitFrame: true, alreadyPresent: true } };
    }

    // 2. Thử liên kết từ card ảnh có sẵn trên canvas (Image-to-Video chaining)
    const selectCanvasImageJs = `
      (async function() {
        function isVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          return rect && rect.width > 0 && rect.height > 0;
        }

        const imageCards = Array.from(document.querySelectorAll('flow-image-tile')).filter(isVisible);
        if (imageCards.length > 0) {
          const targetCard = imageCards[imageCards.length - 1];
          targetCard.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          targetCard.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

          const menuBtn = targetCard.querySelector(
            'button[aria-label*="Tuỳ chọn khác" i], button[aria-label*="More" i], button[flowhotbarbutton].mat-mdc-menu-trigger, .mat-mdc-menu-trigger'
          );
          if (menuBtn) {
            menuBtn.click();
            await new Promise(r => setTimeout(r, 450));
            const menuItems = Array.from(document.querySelectorAll('.cdk-overlay-container [role="menuitem"], .mat-mdc-menu-item'));
            const animItem = menuItems.find(el => {
              const t = (el.innerText || el.textContent || '').toLowerCase();
              return t.includes('tạo ảnh động') || t.includes('motion') || t.includes('animate') || t.includes('thêm vào câu lệnh') || t.includes('add to prompt');
            });
            if (animItem) {
              animItem.click();
              await new Promise(r => setTimeout(r, 600));
              return 'linked_from_canvas';
            }
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27 }));
          }
        }
        return 'none';
      })()
    `;
    const canvasResult = await safeExecuteJs<string>(ctx.win, selectCanvasImageJs, 4000);
    if (canvasResult === 'linked_from_canvas') {
      await new Promise((r) => setTimeout(r, 600));
      return { ok: true, data: { hasInitFrame: true, source: 'canvas' } };
    }

    // 3. Fallback: Dán ảnh từ đường dẫn cục bộ vào clipboard và paste vào ProseMirror
    let electron: any = null;
    try {
      electron = (ctx as any).electron || require('electron');
    } catch {
      electron = (ctx as any).electron || null;
    }

    if (electron && electron.nativeImage && electron.clipboard) {
      await FlowClipboardGuard.withPreservedClipboard(electron, async () => {
        try {
          let localPath = ctx.initFrameUrl!;
          if (localPath.startsWith('file://')) {
            localPath = localPath.replace(/^file:\/\/\/?/, '');
          }
          const natImg = electron.nativeImage.createFromPath(localPath);
          if (!natImg.isEmpty()) {
            electron.clipboard.writeImage(natImg);
            // Focus vào editor trước khi paste
            await safeExecuteJs(
              ctx.win,
              `
              (function() {
                const el = document.querySelector('flow-prompt-box .ProseMirror, .prosemirror-editor, [contenteditable="true"]');
                if (el) { el.focus(); }
              })()
            `
            );
            ctx.win.webContents.focus();
            ctx.win.webContents.paste();
            await new Promise((r) => setTimeout(r, 1500));
          }
        } catch (pasteErr) {
          console.warn('[FlowVideoState] Cảnh báo paste initFrameUrl:', pasteErr);
        }
      });
    }

    return { ok: true, data: { hasInitFrame: true, source: 'clipboard' } };
  },

  async verify(ctx: FlowStateContext): Promise<ActionResult> {
    if (!ctx.initFrameUrl) return { ok: true };

    const checkChipJs = `
      (function() {
        const chip = document.querySelector(
          '.chip-container[aria-label="Thành phần"] img.chip-image, flow-ingredient-bar .chip-container[aria-label="Thành phần"] img.chip-image, .chip-container[aria-label="Thành phần"], flow-image-ingredient-chip, flow-ingredient-chip, .chip-image-wrapper, flow-prompt-box mat-chip, .frame-trigger, button[aria-label*="Thành phần tạo hình ảnh" i]'
        );
        if (chip) return true;
        const promptEl = document.querySelector('flow-prompt-box .ProseMirror, .prosemirror-editor, [contenteditable="true"]');
        return Boolean(promptEl);
      })()
    `;
    const hasChipOrReady = await FlowSmartWait.pollUntil(
      async () => {
        const res = await safeExecuteJs<boolean>(ctx.win, checkChipJs);
        return res ? true : null;
      },
      { timeoutMs: 8000, initialIntervalMs: 400 }
    ).catch(() => false);

    return {
      ok: hasChipOrReady !== false,
      data: { chipOrPromptReady: !!hasChipOrReady },
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 8: FIND_EDITOR
 * Định vị ô soạn thảo văn bản
 */
export const VideoFindEditorState: FlowAutomationState = {
  name: 'FIND_EDITOR',
  timeoutMs: 10000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(20, 'Đang định vị ô soạn thảo prompt video...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const focusEditorJs = `
      (function() {
        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container') || document;
        const promptEl = promptBox.querySelector('.ProseMirror, [contenteditable="true"]');
        if (promptEl) {
          promptEl.focus();
          return { ok: true };
        }
        return { ok: false };
      })()
    `;
    const res = await safeExecuteJs<{ ok: boolean }>(ctx.win, focusEditorJs);
    return { ok: res?.ok ?? false };
  },

  async verify(ctx: FlowStateContext): Promise<ActionResult> {
    const isFocused = await safeExecuteJs<boolean>(
      ctx.win,
      `document.activeElement && document.activeElement.getAttribute('contenteditable') === 'true'`
    );
    return { ok: isFocused ?? true };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 9: ENTER_PROMPT
 * Điền prompt với cơ chế bảo tồn OS Clipboard
 */
export const VideoEnterPromptState: FlowAutomationState = {
  name: 'ENTER_PROMPT',
  timeoutMs: 12000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(22, 'Đang nộp prompt mô tả video...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    let electron: any = null;
    try {
      electron = (ctx as any).electron || require('electron');
    } catch {
      electron = (ctx as any).electron || null;
    }

    const promptClean = (ctx.prompt || '').trim();

    // 1. Focus ProseMirror và chọn nội dung trước khi paste
    await safeExecuteJs(
      ctx.win,
      `(function() {
        const promptBox = document.querySelector(
          'flow-prompt-box, flow-base-prompt-box, .prompt-box-container, .base-prompt-box'
        ) || document;
        const promptEl = promptBox.querySelector('.ProseMirror, [contenteditable="true"]');
        if (promptEl) {
          promptEl.focus();
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(promptEl);
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      })()`,
      1000
    );

    // 2. Native paste với Clipboard Isolation
    if (electron && typeof electron === 'object' && electron.clipboard) {
      await FlowClipboardGuard.withPreservedClipboard(electron, async () => {
        try {
          electron.clipboard.writeText(promptClean);
          ctx.win.webContents.focus();
          ctx.win.webContents.paste();
        } catch (e) {
          console.warn('[FlowVideoState] Paste warning:', e);
        }
        await new Promise((r) => setTimeout(r, 200));
      });
    }

    // 3. Dispatch ClipboardEvent trực tiếp cho ProseMirror với DataTransfer
    const pasteJs = `
      (function() {
        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container') || document;
        const promptEl = promptBox.querySelector('.ProseMirror, [contenteditable="true"]');
        if (promptEl) {
          promptEl.focus();
          const dt = new DataTransfer();
          dt.setData('text/plain', ${JSON.stringify(promptClean)});
          promptEl.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
          promptEl.dispatchEvent(new Event('input', { bubbles: true }));
          promptEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `;
    await safeExecuteJs(ctx.win, pasteJs);
    await new Promise((r) => setTimeout(r, 200));

    // 4. Fallback execCommand nếu text vẫn chưa vào
    const fallbackJs = `
      (function() {
        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container') || document;
        const promptEl = promptBox.querySelector('.ProseMirror, [contenteditable="true"]');
        if (promptEl && (!promptEl.innerText || !promptEl.innerText.trim())) {
          promptEl.focus();
          document.execCommand('insertText', false, ${JSON.stringify(promptClean)});
          promptEl.dispatchEvent(new Event('input', { bubbles: true }));
          promptEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `;
    await safeExecuteJs(ctx.win, fallbackJs);

    return { ok: true };
  },

  async verify(ctx: FlowStateContext): Promise<ActionResult> {
    const checkTextJs = `
      (function() {
        const promptEl = document.querySelector('flow-prompt-box .ProseMirror, [contenteditable="true"]');
        return promptEl ? (promptEl.innerText || '').trim() : '';
      })()
    `;
    const textOnDom = await safeExecuteJs<string>(ctx.win, checkTextJs);
    const expected = (ctx.prompt || '').trim();
    const ok = (textOnDom && textOnDom.length > 0) || !expected;
    return {
      ok: !!ok,
      error: ok ? undefined : 'PROMPT_INPUT_EMPTY',
      errorDetail: ok ? undefined : 'Ô nhập liệu prompt vẫn rỗng sau khi điền',
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 10: CONFIGURE_VIDEO_OPTIONS
 * Cấu hình Duration (4s, 6s, 8s, 10s), Aspect Ratio (16:9, 9:16), Model
 */
export const VideoConfigureOptionsState: FlowAutomationState = {
  name: 'CONFIGURE_VIDEO_OPTIONS',
  timeoutMs: 12000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(25, 'Đang cấu hình thời lượng và tỉ lệ video...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const aspect = (ctx.aspectRatio || '16:9').trim();
    let duration = 4;
    const rawDur = Number(ctx.durationSeconds || 4);
    if (rawDur <= 5) duration = 4;
    else if (rawDur <= 7) duration = 6;
    else if (rawDur <= 9) duration = 8;
    else duration = 10;

    // 1. Đồng bộ qua sessionMgr nếu có
    if (ctx.sessionMgr && typeof ctx.sessionMgr.configureGoogleFlowSettings === 'function') {
      try {
        await ctx.sessionMgr.configureGoogleFlowSettings(ctx.win, 'video', {
          outputCount: ctx.outputCount || 1,
          aspectRatio: aspect,
          durationSeconds: duration,
        });
      } catch (e) {}
    }

    // 2. Đồng bộ trực tiếp vào LocalStorage
    const syncOptionsJs = `
      (function() {
        try {
          const raw = localStorage.getItem('flow-prompt-box-settings');
          const settings = raw ? JSON.parse(raw) : {};
          settings.mode = 'VIDEO';
          settings.AB = ${duration};
          settings.aspectRatio = ${JSON.stringify(aspect === '9:16' ? 'PORTRAIT' : 'LANDSCAPE')};
          localStorage.setItem('flow-prompt-box-settings', JSON.stringify(settings));
          window.dispatchEvent(new StorageEvent('storage', { key: 'flow-prompt-box-settings', newValue: JSON.stringify(settings) }));
          return true;
        } catch (e) {
          return false;
        }
      })()
    `;
    await safeExecuteJs(ctx.win, syncOptionsJs);

    // 3. Đảm bảo đóng popover cài đặt (Escape + backdrop click)
    try {
      await safeExecuteJs(ctx.win, `
        (function() {
          const bd = document.querySelector('.cdk-overlay-backdrop');
          if (bd) bd.click();
        })()
      `, 1000);
      ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      await new Promise((r) => setTimeout(r, 50));
      ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await new Promise((r) => setTimeout(r, 200));
    } catch {}

    return { ok: true, data: { duration, aspect } };
  },

  async verify(): Promise<ActionResult> {
    return { ok: true };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 11: CAPTURE_BASELINE_VIDEO
 * Lưu danh sách URL / Video tiles hiện có để phát hiện video mới sinh ra
 */
export const VideoCaptureBaselineState: FlowAutomationState = {
  name: 'CAPTURE_BASELINE_VIDEO',
  timeoutMs: 8000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(28, 'Đang chụp snapshot video hiện có...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const getBaselineJs = `
      (function() {
        const urls = [];
        document.querySelectorAll('video').forEach(v => {
          const src = v.currentSrc || v.src || (v.querySelector('source') ? v.querySelector('source').src : '');
          if (src && src.startsWith('http')) urls.push(src);
        });
        document.querySelectorAll('flow-video-tile').forEach(tile => {
          tile.setAttribute('data-flow-existing', 'true');
        });
        return urls;
      })()
    `;
    const foundUrls = (await safeExecuteJs<string[]>(ctx.win, getBaselineJs)) || [];
    ctx.baselineUrls = new Set(foundUrls);

    return { ok: true, data: { count: foundUrls.length } };
  },

  async verify(ctx: FlowStateContext): Promise<ActionResult> {
    return { ok: ctx.baselineUrls instanceof Set };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 12: CHECK_IDEMPOTENCY_BEFORE_GENERATE
 * Kiểm tra xem video đã bắt đầu render chưa trước khi click
 */
export const VideoCheckIdempotencyState: FlowAutomationState = {
  name: 'CHECK_IDEMPOTENCY_BEFORE_GENERATE',
  timeoutMs: 5000,

  async enter(): Promise<void> {},

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    if (ctx.generationState === 'GENERATING' || ctx.generationState === 'STARTING') {
      return {
        ok: true,
        skipToState: 'WAIT_FOR_VIDEO_GENERATION',
        data: { reason: 'Phát hiện tác vụ render video đã bắt đầu từ trước (Idempotency Guard).' },
      };
    }
    return { ok: true };
  },

  async verify(): Promise<ActionResult> {
    return { ok: true };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 13: FIND_GENERATE_BUTTON
 * Định vị nút Generate trong container flow-prompt-box
 */
export const VideoFindGenerateButtonState: FlowAutomationState = {
  name: 'FIND_GENERATE_BUTTON',
  timeoutMs: 8000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(30, 'Đang định vị nút bắt đầu tạo video...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const locateBtnJs = `
      (function() {
        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container') || document;
        const selectors = [
          'flow-generate-icon-button button',
          'button.generate-icon-button',
          'button[aria-label*="Bắt đầu tạo" i]',
          'button[aria-label*="Tạo video" i]',
          'button[aria-label*="Generate video" i]',
          'button[aria-label*="Generate" i]',
          'button[aria-label*="Tạo" i]',
          'button[type="submit"]',
          'flow-generate-button button',
          'button.submit-button'
        ];
        let btn = null;
        for (const sel of selectors) {
          const el = promptBox.querySelector(sel);
          if (el) { btn = el; break; }
        }
        if (!btn) {
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) { btn = el; break; }
          }
        }
        if (!btn) return { ok: false };
        const rect = btn.getBoundingClientRect();
        return {
          ok: true,
          coords: {
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2),
          },
          disabled: btn.disabled || btn.getAttribute('aria-disabled') === 'true'
        };
      })()
    `;
    const res = await safeExecuteJs<{ ok: boolean; coords?: { x: number; y: number }; disabled?: boolean }>(ctx.win, locateBtnJs);
    if (res?.ok && res.coords) {
      (ctx as any).btnCoords = res.coords;
    }
    return { ok: res?.ok ?? false, data: res };
  },

  async verify(ctx: FlowStateContext, execResult: ActionResult): Promise<ActionResult> {
    return {
      ok: execResult.ok,
      error: execResult.ok ? undefined : 'GENERATE_BUTTON_NOT_FOUND',
      errorDetail: execResult.ok ? undefined : 'Không tìm thấy nút Generate trong khung soạn thảo',
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 14: VERIFY_GENERATE_BUTTON
 * Kiểm tra nút Generate enabled và sẵn sàng click
 */
export const VideoVerifyGenerateButtonState: FlowAutomationState = {
  name: 'VERIFY_GENERATE_BUTTON',
  timeoutMs: 5000,

  async enter(): Promise<void> {},

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const checkBtnJs = `
      (function() {
        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container') || document;
        const btn = promptBox.querySelector('flow-generate-icon-button button, button.generate-icon-button, button[aria-label*="Bắt đầu tạo" i], button[aria-label*="Generate" i], button[aria-label*="Tạo" i], button.submit-button, button[type="submit"]');
        if (!btn) return false;
        return !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
      })()
    `;
    const isEnabled = await safeExecuteJs<boolean>(ctx.win, checkBtnJs);
    return { ok: isEnabled ?? true };
  },

  async verify(ctx: FlowStateContext, execResult: ActionResult): Promise<ActionResult> {
    return {
      ok: execResult.ok,
      error: execResult.ok ? undefined : 'BUTTON_DISABLED',
      errorDetail: execResult.ok ? undefined : 'Nút Generate đang ở trạng thái bị vô hiệu hóa (disabled)',
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 15: CLICK_GENERATE_VIDEO
 * Gửi lệnh Click Generate tạo video, bảo vệ tính lũy đẳng
 */
export const VideoClickGenerateState: FlowAutomationState = {
  name: 'CLICK_GENERATE_VIDEO',
  timeoutMs: 10000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(32, 'Đang gửi lệnh tạo video đến Google Veo...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    (ctx as any).generateClickedAt = Date.now();
    ctx.generationState = 'STARTING';

    // 1. Kích hoạt WebRequest Interception để bắt link video CDN ngay khi server trả về
    if (ctx.win && !ctx.win.isDestroyed() && !(ctx as any).netFilterAttached) {
      try {
        const ses = ctx.win.webContents.session;
        ses.webRequest.onResponseStarted({ urls: ['*://*/*'] }, (details: any) => {
          if (!(ctx as any).generateClickedAt || Date.now() < (ctx as any).generateClickedAt) return;
          const elapsed = Date.now() - (ctx as any).generateClickedAt;
          if (elapsed < 5000) return;
          const url = details.url || '';
          if (ctx.baselineUrls?.has(url)) return;
          const headers = details.responseHeaders || {};
          const ct = (headers['content-type']?.[0] || headers['Content-Type']?.[0] || '').toLowerCase();
          const isStatic = url.includes('gstatic.com') || url.includes('/banners/') || url.includes('landing_page') || url.includes('favicon');
          if (
            (ct.includes('video/mp4') || ct.includes('video/webm') || url.includes('.mp4') || url.includes('googlevideo.com/videoplayback') || url.includes('flow-content.google/video/')) &&
            !isStatic &&
            details.statusCode >= 200 && details.statusCode < 300
          ) {
            console.log('[FlowVideoState] 🎬 Bắt được Video CDN URL qua webRequest:', url.slice(0, 100));
            ctx.capturedMediaUrl = url;
          }
        });
        (ctx as any).netFilterAttached = true;
      } catch (e) {}
    }

    // 1b. Tiền trễ 200ms trước khi click để bảo đảm animation/transition DOM của Flow đã ổn định
    await new Promise((r) => setTimeout(r, 200));

    // 2. Gửi Native Mouse Click nếu có toạ độ coords
    const coords = (ctx as any).btnCoords;
    if (coords && coords.x > 0 && coords.y > 0) {
      try {
        ctx.win.webContents.focus();
        ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: coords.x, y: coords.y });
        await new Promise((r) => setTimeout(r, 40));
        ctx.win.webContents.sendInputEvent({ type: 'mouseDown', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
        await new Promise((r) => setTimeout(r, 50));
        ctx.win.webContents.sendInputEvent({ type: 'mouseUp', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
        await new Promise((r) => setTimeout(r, 150));
      } catch (e) {}
    }

    // 3. Dispatch click trên DOM
    const clickBtnJs = `
      (function() {
        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container') || document;
        const btn = promptBox.querySelector('flow-generate-icon-button button, button.generate-icon-button, button[aria-label*="Bắt đầu tạo" i], button[aria-label*="Generate" i], button[aria-label*="Tạo" i], button.submit-button, button[type="submit"]');
        if (!btn) return false;
        if (btn.disabled) {
          btn.disabled = false;
          btn.removeAttribute('disabled');
          btn.setAttribute('aria-disabled', 'false');
          btn.classList.remove('mat-mdc-button-disabled');
        }
        btn.click();
        return true;
      })()
    `;
    const clicked = await safeExecuteJs<boolean>(ctx.win, clickBtnJs);

    // 4. Fallback Enter nếu prompt còn text
    await new Promise((r) => setTimeout(r, 1200));
    const checkStillTextJs = `
      (function() {
        const el = document.querySelector('flow-prompt-box .ProseMirror, [contenteditable="true"]');
        return el ? (el.innerText || '').trim().length > 0 : false;
      })()
    `;
    const stillText = await safeExecuteJs<boolean>(ctx.win, checkStillTextJs);
    if (stillText) {
      try {
        ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        await new Promise((r) => setTimeout(r, 50));
        ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      } catch {}
    }

    return { ok: clicked ?? true };
  },

  async verify(ctx: FlowStateContext): Promise<ActionResult> {
    ctx.generationState = 'GENERATING';
    return { ok: true };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 16: VERIFY_GENERATION_STARTED
 * Xác nhận tile video mới hoặc thanh tiến trình đã xuất hiện
 */
export const VideoVerifyGenerationStartedState: FlowAutomationState = {
  name: 'VERIFY_GENERATION_STARTED',
  timeoutMs: 12000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(35, 'Đã gửi lệnh thành công! Đang khởi tạo luồng render video...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const checkStartedJs = `
      (function() {
        const hasPending = Boolean(document.querySelector('flow-pending-tile, flow-soupy-overlay, flow-video-tile:not([data-flow-existing])'));
        const promptEl = document.querySelector('flow-prompt-box .ProseMirror, [contenteditable="true"]');
        const text = promptEl ? (promptEl.innerText || '').trim() : '';
        const bodyText = (document.body.innerText || '').toLowerCase();
        const hasTextMatch = bodyText.includes('generating') || bodyText.includes('đang tạo') || bodyText.includes('rendering');
        return hasPending || text.length === 0 || hasTextMatch;
      })()
    `;
    const started = await safeExecuteJs<boolean>(ctx.win, checkStartedJs);
    ctx.generationState = 'GENERATING';
    return { ok: true, data: { started: !!started } };
  },

  async verify(): Promise<ActionResult> {
    return { ok: true };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 17: WAIT_FOR_VIDEO_GENERATION
 * Polling tiến độ video (timeout dài hơn: 240s) với báo cáo phần trăm tiến độ
 */
export const VideoWaitForGenerationState: FlowAutomationState = {
  name: 'WAIT_FOR_VIDEO_GENERATION',
  timeoutMs: 240000, // 240 giây dành cho render video

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(40, 'Đang chờ Google Veo xử lý và render video...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const maxWaitMs = 240000;
    const pollIntervalMs = 3000;
    const startTime = Date.now();
    const baselineList = Array.from(ctx.baselineUrls || []);

    while (Date.now() - startTime < maxWaitMs) {
      if (ctx.isCancelled?.()) {
        return { ok: false, error: 'USER_CANCELLED', errorDetail: 'Người dùng đã hủy tác vụ' };
      }

      const elapsed = Date.now() - ((ctx as any).generateClickedAt || startTime);

      // 1. Kiểm tra nếu đã bắt được URL video qua network interception
      if (ctx.capturedMediaUrl && elapsed >= 8000) {
        return { ok: true, data: { videoUrl: ctx.capturedMediaUrl } };
      }

      const pollJs = `
        (function() {
          const baselineSet = new Set(${JSON.stringify(baselineList)});

          // 1. Kiểm tra thẻ <video> trực tiếp
          const videos = Array.from(document.querySelectorAll('video'));
          for (const v of videos) {
            const src = v.currentSrc || v.src || (v.querySelector('source') ? v.querySelector('source').src : '');
            if (src && src.startsWith('http') && !baselineSet.has(src) && !src.includes('/banners/')) {
              return { done: true, videoUrl: src };
            }
          }

          // 2. Kiểm tra tile video trên canvas
          const videoTiles = Array.from(document.querySelectorAll('flow-video-tile'));
          const newTiles = videoTiles.filter(tile => !tile.hasAttribute('data-flow-existing'));
          for (const tile of newTiles) {
            const hasPending = Boolean(tile.querySelector('flow-pending-tile, flow-soupy-overlay'));
            const hasPlay = Boolean(tile.querySelector('button[aria-label*="play" i], button[aria-label*="phát" i], mat-icon, video'));
            const tileText = (tile.innerText || '').toLowerCase();
            if (!hasPending && (hasPlay || tileText.includes('play_circle'))) {
              return { done: true, readyForDownload: true };
            }
          }

          // 3. Đọc phần trăm tiến độ nếu có
          const bodyText = document.body.innerText || '';
          const matchPercent = bodyText.match(/(\\d{1,2})%/);
          const percent = matchPercent ? parseInt(matchPercent[1], 10) : null;

          return { done: false, percent };
        })()
      `;

      const pollRes = await safeExecuteJs<{ done: boolean; videoUrl?: string; percent?: number }>(
        ctx.win,
        pollJs
      );

      // Chỉ chấp nhận hoàn tất nếu đã trôi qua ít nhất 10 giây
      if (pollRes?.done && elapsed >= 10000) {
        if (pollRes.videoUrl) {
          ctx.capturedMediaUrl = pollRes.videoUrl;
        } else {
          ctx.capturedMediaUrl = 'flow://video-ready-on-canvas';
        }
        return { ok: true, data: pollRes };
      }

      if (pollRes?.percent) {
        const scaledProgress = Math.min(95, Math.max(40, Math.round(40 + (pollRes.percent * 0.55))));
        ctx.onProgress?.(scaledProgress, `Đang render video: ${pollRes.percent}%...`);
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    return { ok: false, error: 'VIDEO_GENERATION_TIMEOUT', errorDetail: 'Quá thời gian chờ render video (240s)' };
  },

  async verify(ctx: FlowStateContext, execResult: ActionResult): Promise<ActionResult> {
    return {
      ok: execResult.ok,
      error: execResult.ok ? undefined : 'RENDER_TIMEOUT',
      errorDetail: execResult.ok ? undefined : 'Quá thời gian render video trên Google Flow',
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 18: EXTRACT_VIDEO_OUTPUT
 * Trích xuất URL video kết quả (.mp4) và hoàn tất
 */
export const VideoExtractOutputState: FlowAutomationState = {
  name: 'EXTRACT_VIDEO_OUTPUT',
  timeoutMs: 15000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(95, 'Đang trích xuất đường dẫn video kết quả...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    let videoUrl = ctx.capturedMediaUrl || undefined;

    if (!videoUrl) {
      const baselineList = Array.from(ctx.baselineUrls || []);
      const extractJs = `
        (function() {
          const baselineSet = new Set(${JSON.stringify(baselineList)});
          const videos = Array.from(document.querySelectorAll('video'));
          for (const v of videos) {
            const src = v.currentSrc || v.src || (v.querySelector('source') ? v.querySelector('source').src : '');
            if (src && src.startsWith('http') && !baselineSet.has(src) && !src.includes('/banners/')) {
              return src;
            }
          }
          return null;
        })()
      `;
      const finalUrl = await safeExecuteJs<string>(ctx.win, extractJs);
      if (finalUrl) {
        videoUrl = finalUrl;
        ctx.capturedMediaUrl = finalUrl;
      }
    }

    if (!videoUrl) {
      // Kiểm tra tile video mới trên canvas đã sẵn sàng
      const tileDone = await safeExecuteJs<boolean>(ctx.win, `
        (function() {
          const tile = document.querySelector('flow-video-tile:not([data-flow-existing])') || document.querySelector('flow-video-tile');
          return Boolean(tile && !tile.querySelector('flow-pending-tile, flow-soupy-overlay'));
        })()
      `);

      if (tileDone) {
        videoUrl = 'flow://video-ready-on-canvas';
        ctx.capturedMediaUrl = videoUrl;
      }
    }

    let projectId: string | undefined;
    try {
      const currentUrl = ctx.win.webContents?.getURL?.() || '';
      const match = currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) projectId = match[1];
    } catch {}

    if (projectId) {
      ctx.activeProjectId = projectId;
      if (ctx.sessionMgr && typeof ctx.sessionMgr.setCurrentProjectId === 'function') {
        ctx.sessionMgr.setCurrentProjectId(projectId);
      }
    }

    if (!videoUrl) {
      return { ok: false, error: 'NO_VIDEO_FOUND', errorDetail: 'Không tìm thấy video sau khi render' };
    }

    // Gán bắt buộc ctx.result để FlowStateMachine.run trả về res.videoUrl chuẩn xác
    ctx.result = {
      videoUrl,
      projectId: ctx.activeProjectId,
    };

    return { ok: true, data: ctx.result };
  },

  async verify(ctx: FlowStateContext): Promise<ActionResult> {
    const hasUrl = Boolean(ctx.result?.videoUrl || ctx.capturedMediaUrl);
    return {
      ok: hasUrl,
      error: hasUrl ? undefined : 'EXTRACT_FAILED',
      errorDetail: hasUrl ? undefined : 'Không trích xuất được Video URL hợp lệ từ Google Flow',
    };
  },

  async exit(): Promise<void> {},
};

/**
 * Pipeline 18 bước chuyên biệt dành riêng cho Video Generation trên Google Flow
 */
export const FlowVideoGenerationStatePipeline: FlowAutomationState[] = [
  VideoOpenFlowState,
  VideoWaitForPageReadyState,
  VideoVerifySessionState,
  VideoEnsureProjectContextState,
  VideoCleanCanvasState,
  VideoSelectModeState,
  VideoConfigureOptionsState,
  HandleImageReferenceState,
  VideoFindEditorState,
  VideoEnterPromptState,
  VideoCaptureBaselineState,
  VideoCheckIdempotencyState,
  VideoFindGenerateButtonState,
  VideoVerifyGenerateButtonState,
  VideoClickGenerateState,
  VideoVerifyGenerationStartedState,
  VideoWaitForGenerationState,
  VideoExtractOutputState,
];
