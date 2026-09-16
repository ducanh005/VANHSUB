import type {
  FlowAutomationState,
  FlowStateContext,
  ActionResult,
} from '../types';
import { FlowSmartWait } from '../FlowSmartWait';
import { FlowElementFinder } from '../FlowElementFinder';
import { FlowOverlayDetector } from '../FlowOverlayDetector';
import { FlowClipboardGuard } from '../FlowClipboardGuard';

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

    if (ctx.win.isMinimized()) ctx.win.restore();
    ctx.win.show();
    ctx.win.focus();

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
  timeoutMs: 15000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(12, 'Đang chuẩn bị không gian làm việc video...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
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
    const inProj = await FlowSmartWait.pollUntil(
      async () => {
        const url = ctx.win?.webContents?.getURL?.() || '';
        return url.includes('/project/') ? true : null;
      },
      { timeoutMs: 8000, initialIntervalMs: 400 }
    ).catch(() => false);
    return {
      ok: !!inProj,
      error: inProj ? undefined : 'PROJECT_CREATION_FAILED',
      errorDetail: inProj ? undefined : 'Không thể điều hướng vào không gian dự án Google Flow',
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
  timeoutMs: 10000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(16, 'Đang chọn chế độ tạo Video (Google Veo)...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    // 1. Đồng bộ LocalStorage
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

    // 2. Click Mode Tab VIDEO trên DOM qua FlowElementFinder
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

    return { ok: true };
  },

  async verify(ctx: FlowStateContext): Promise<ActionResult> {
    const checkVideoTabJs = `
      (function() {
        const videoBtn = document.querySelector('button[role="tab"][aria-selected="true"], [data-mode="video"][aria-selected="true"], button.active[aria-label*="video" i]');
        if (videoBtn && (videoBtn.innerText || '').toLowerCase().includes('video')) return true;
        const bodyText = (document.body.innerText || '').toLowerCase();
        return bodyText.includes('video') && !bodyText.includes('select image style');
      })()
    `;
    const isVideoMode = await safeExecuteJs<boolean>(ctx.win, checkVideoTabJs);
    return {
      ok: isVideoMode ?? true,
      error: isVideoMode ? undefined : 'MODE_SWITCH_FAILED',
      errorDetail: isVideoMode ? undefined : 'Chưa kích hoạt thành công tab Video',
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
  timeoutMs: 15000,

  async enter(ctx: FlowStateContext): Promise<void> {
    if (ctx.initFrameUrl) {
      ctx.onProgress?.(18, 'Đang nạp ảnh đầu vào (Image-to-Video)...');
    }
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    if (!ctx.initFrameUrl) {
      return { ok: true, data: { hasInitFrame: false } };
    }

    let electron: any = null;
    try {
      electron = (ctx as any).electron || require('electron');
    } catch {
      electron = (ctx as any).electron || null;
    }

    if (electron && electron.nativeImage && electron.clipboard) {
      await FlowClipboardGuard.withPreservedClipboard(electron, async () => {
        try {
          const natImg = electron.nativeImage.createFromPath(ctx.initFrameUrl);
          if (!natImg.isEmpty()) {
            electron.clipboard.writeImage(natImg);
            ctx.win.focus();
            ctx.win.webContents.paste();
            await new Promise((r) => setTimeout(r, 1000));
          }
        } catch (pasteErr) {
          console.warn('[FlowVideoState] Cảnh báo paste initFrameUrl:', pasteErr);
        }
      });
    }

    return { ok: true, data: { hasInitFrame: true } };
  },

  async verify(ctx: FlowStateContext): Promise<ActionResult> {
    if (!ctx.initFrameUrl) return { ok: true };

    const checkChipJs = `
      (function() {
        const chip = document.querySelector('flow-image-ingredient-chip, flow-ingredient-chip, .chip-container, mat-chip-row');
        return !!chip;
      })()
    `;
    const hasChip = await safeExecuteJs<boolean>(ctx.win, checkChipJs);
    return {
      ok: hasChip ?? true,
      error: hasChip ? undefined : 'CHIP_NOT_FOUND',
      errorDetail: hasChip ? undefined : 'Ảnh đầu vào (initFrameUrl) chưa xuất hiện dạng thẻ chip',
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

    // 1. Native paste với Clipboard Isolation
    if (electron && typeof electron === 'object' && electron.clipboard) {
      await FlowClipboardGuard.withPreservedClipboard(electron, async () => {
        try {
          electron.clipboard.writeText(promptClean);
          ctx.win.focus();
          ctx.win.webContents.paste();
        } catch (e) {
          console.warn('[FlowVideoState] Paste warning:', e);
        }
        await new Promise((r) => setTimeout(r, 200));
      });
    }

    // 2. Dispatch ClipboardEvent trực tiếp cho ProseMirror
    const pasteJs = `
      (function() {
        const promptEl = document.querySelector('flow-prompt-box .ProseMirror, [contenteditable="true"]');
        if (promptEl) {
          const dt = new DataTransfer();
          dt.setData('text/plain', ${JSON.stringify(promptClean)});
          promptEl.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        }
      })()
    `;
    await safeExecuteJs(ctx.win, pasteJs);

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

    // Đồng bộ vào LocalStorage
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
        const btn = promptBox.querySelector('button[aria-label*="Generate" i], button[aria-label*="Tạo" i], button.submit-button, button[type="submit"]');
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
        const btn = promptBox.querySelector('button[aria-label*="Generate" i], button[aria-label*="Tạo" i], button.submit-button, button[type="submit"]');
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

    const clickBtnJs = `
      (function() {
        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container') || document;
        const btn = promptBox.querySelector('button[aria-label*="Generate" i], button[aria-label*="Tạo" i], button.submit-button, button[type="submit"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `;
    const clicked = await safeExecuteJs<boolean>(ctx.win, clickBtnJs);
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
        const bodyText = (document.body.innerText || '').toLowerCase();
        if (bodyText.includes('generating') || bodyText.includes('đang tạo') || bodyText.includes('rendering')) return true;
        const progressBar = document.querySelector('flow-video-tile .progress-bar, [role="progressbar"], .video-container.generating');
        return !!progressBar;
      })()
    `;
    const started = await safeExecuteJs<boolean>(ctx.win, checkStartedJs);
    return { ok: started ?? true };
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
          const tiles = Array.from(document.querySelectorAll('flow-video-tile'));
          for (const tile of tiles) {
            const progressBar = tile.querySelector('.progress-bar, [role="progressbar"]');
            const progressStyle = progressBar ? (progressBar.getAttribute('style') || '') : '';
            const isDone = !progressBar || progressStyle.includes('100%');
            if (isDone) {
              tile.click(); // Click nhẹ để kích hoạt luồng video
              return { done: true, triggeredClick: true };
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

      if (pollRes?.done) {
        if (pollRes.videoUrl) {
          ctx.capturedMediaUrl = pollRes.videoUrl;
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
    if (ctx.capturedMediaUrl) {
      return { ok: true, data: { videoUrl: ctx.capturedMediaUrl } };
    }

    const baselineList = Array.from(ctx.baselineUrls || []);
    const extractJs = `
      (function() {
        const baselineSet = new Set(${JSON.stringify(baselineList)});
        const videos = Array.from(document.querySelectorAll('video'));
        for (const v of videos) {
          const src = v.currentSrc || v.src || (v.querySelector('source') ? v.querySelector('source').src : '');
          if (src && src.startsWith('http') && !baselineSet.has(src)) {
            return src;
          }
        }
        return null;
      })()
    `;
    const finalUrl = await safeExecuteJs<string>(ctx.win, extractJs);
    if (finalUrl) {
      ctx.capturedMediaUrl = finalUrl;
      return { ok: true, data: { videoUrl: finalUrl } };
    }

    return { ok: false, error: 'NO_VIDEO_FOUND', errorDetail: 'Không tìm thấy video sau khi render' };
  },

  async verify(ctx: FlowStateContext): Promise<ActionResult> {
    const hasUrl = !!ctx.capturedMediaUrl;
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
  VideoHandleInitFrameState,
  VideoFindEditorState,
  VideoEnterPromptState,
  VideoConfigureOptionsState,
  VideoCaptureBaselineState,
  VideoCheckIdempotencyState,
  VideoFindGenerateButtonState,
  VideoVerifyGenerateButtonState,
  VideoClickGenerateState,
  VideoVerifyGenerationStartedState,
  VideoWaitForGenerationState,
  VideoExtractOutputState,
];
