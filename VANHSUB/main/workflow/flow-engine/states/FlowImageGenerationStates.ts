import type {
  FlowAutomationState,
  FlowStateContext,
  ActionResult,
} from '../types';

/**
 * Helper an toàn để execute JS trên BrowserWindow
 */
async function safeExecuteJs<T = any>(win: any, jsCode: string, timeoutMs = 5000): Promise<T | null> {
  if (!win || win.isDestroyed()) return null;
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<null>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`executeJavaScript timeout (${timeoutMs}ms)`)), timeoutMs);
  });
  try {
    const execPromise = win.webContents.executeJavaScript(jsCode);
    const result = await Promise.race([execPromise, timeoutPromise]);
    if (typeof result === 'string') {
      try {
        return JSON.parse(result) as T;
      } catch {
        return result as unknown as T;
      }
    }
    return result as T;
  } catch (err: any) {
    return null;
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * STATE 1: OPEN_FLOW
 * Đảm bảo cửa sổ lobbyWindow đã mở và điều hướng tới flow.google.com
 */
export const OpenFlowState: FlowAutomationState = {
  name: 'OPEN_FLOW',
  timeoutMs: 15000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(5, 'Đang chuẩn bị Sảnh Google Flow...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const ready = await ctx.sessionMgr.ensureLobbyAtFlow();
    if (!ready) {
      return { ok: false, error: 'lobby_not_ready', errorDetail: 'Không thể chuẩn bị Sảnh Google Flow.' };
    }
    ctx.win = ctx.sessionMgr.getLobbyWindow();
    return { ok: true };
  },

  async verify(ctx: FlowStateContext): Promise<boolean> {
    if (!ctx.win || ctx.win.isDestroyed()) return false;
    const url = (ctx.win.webContents?.getURL?.() || '').toLowerCase();
    return url.includes('flow.google.com');
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 2: WAIT_FOR_PAGE_READY
 * Chờ trang Google Flow kết thúc chu kỳ tải ban đầu
 */
export const WaitForPageReadyState: FlowAutomationState = {
  name: 'WAIT_FOR_PAGE_READY',
  timeoutMs: 10000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(8, 'Đang chờ Google Flow tải xong...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    for (let i = 0; i < 20; i++) {
      if (ctx.isCancelled?.()) return { ok: false, error: 'cancelled' };
      const isLoading = ctx.win.webContents?.isLoading?.();
      if (!isLoading) {
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return { ok: true };
  },

  async verify(ctx: FlowStateContext): Promise<boolean> {
    const readyState = await safeExecuteJs<string>(ctx.win, 'document.readyState', 2000);
    return readyState === 'complete' || readyState === 'interactive';
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 3: VERIFY_SESSION
 * Xác thực phiên đăng nhập Google và trạng thái tín dụng
 */
export const VerifySessionState: FlowAutomationState = {
  name: 'VERIFY_SESSION',
  timeoutMs: 8000,

  async enter(): Promise<void> {},

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const status = ctx.sessionMgr.getStatus();
    if (status.sessionStatus === 'out_of_credits') {
      return { ok: false, error: 'out_of_credits', errorDetail: 'Tài khoản Google Flow đã hết tín dụng.' };
    }
    const currentUrl = (ctx.win.webContents?.getURL?.() || '').toLowerCase();
    if (currentUrl.includes('accounts.google.com') || currentUrl.includes('servicelogin')) {
      return { ok: false, error: 'session_expired', errorDetail: 'Cần đăng nhập tài khoản Google trên Sảnh Flow trước.' };
    }
    return { ok: true };
  },

  async verify(ctx: FlowStateContext): Promise<boolean> {
    const currentUrl = (ctx.win.webContents?.getURL?.() || '').toLowerCase();
    return !currentUrl.includes('accounts.google.com') && currentUrl.includes('flow.google.com');
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 4: ENSURE_PROJECT_CONTEXT
 * Điều hướng vào đúng project chỉ định hoặc tái sử dụng project hiện tại
 */
export const EnsureProjectContextState: FlowAutomationState = {
  name: 'ENSURE_PROJECT_CONTEXT',
  timeoutMs: 30000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(12, 'Đang chuẩn bị workspace Google Flow cho ảnh...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const projectReady = await ctx.sessionMgr.ensureProjectContext(
      ctx.win,
      ctx.targetProjectId,
      ctx.onProgress,
      ctx.isCancelled
    );
    if (!projectReady) {
      return { ok: false, error: 'project_context_failed', errorDetail: 'Không thể mở hoặc tạo dự án trên Google Flow.' };
    }
    const currentUrl = ctx.win.webContents?.getURL?.() || '';
    const match = currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      ctx.activeProjectId = match[1];
    }
    return { ok: true, data: { projectId: ctx.activeProjectId } };
  },

  async verify(ctx: FlowStateContext): Promise<boolean> {
    const currentUrl = ctx.win.webContents?.getURL?.() || '';
    return currentUrl.includes('/project/');
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 5: CLEAN_CANVAS
 * Dọn sạch canvas, đóng lightbox/overlay nếu có và đưa ô prompt về trạng thái sẵn sàng
 */
export const CleanCanvasState: FlowAutomationState = {
  name: 'CLEAN_CANVAS',
  timeoutMs: 15000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(14, 'Đang kiểm tra và dọn dẹp canvas...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const cleanOk = await ctx.sessionMgr.ensureCleanCanvasReady(
      ctx.win,
      'image',
      ctx.onProgress,
      ctx.isCancelled
    );
    if (!cleanOk) {
      return { ok: false, error: 'clean_canvas_failed', errorDetail: 'Không thể dọn dẹp canvas về trạng thái sẵn sàng.' };
    }
    return { ok: true };
  },

  async verify(ctx: FlowStateContext): Promise<boolean> {
    const checkPromptJs = `
      (function() {
        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container');
        const promptEl = promptBox ? promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea') : null;
        if (!promptEl) return false;
        const rect = promptEl.getBoundingClientRect();
        return rect && rect.width > 0 && rect.height > 0;
      })()
    `;
    const promptReady = await safeExecuteJs<boolean>(ctx.win, checkPromptJs, 3000);
    return Boolean(promptReady);
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 6: FIND_EDITOR
 * Xác định khung chứa prompt box
 */
export const FindEditorState: FlowAutomationState = {
  name: 'FIND_EDITOR',
  timeoutMs: 8000,

  async enter(): Promise<void> {},

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const findBoxJs = `
      (function() {
        const box = document.querySelector(
          'flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box'
        );
        return Boolean(box);
      })()
    `;
    const found = await safeExecuteJs<boolean>(ctx.win, findBoxJs, 3000);
    return { ok: Boolean(found) };
  },

  async verify(ctx: FlowStateContext): Promise<boolean> {
    const isPresent = await safeExecuteJs<boolean>(
      ctx.win,
      `Boolean(document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container'))`,
      2000
    );
    return Boolean(isPresent);
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 7: FIND_PROMPT_INPUT
 * Xác định phần tử nhập liệu text (ProseMirror / contenteditable) và lấy tiêu điểm OS
 */
export const FindPromptInputState: FlowAutomationState = {
  name: 'FIND_PROMPT_INPUT',
  timeoutMs: 8000,

  async enter(): Promise<void> {},

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    // Focus vào ô soạn thảo
    const focusEditorJs = `
      (function() {
        const promptBox = document.querySelector(
          'flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box'
        ) || document;
        const selectors = [
          'flow-rich-text-editor .ProseMirror',
          '.prosemirror-editor .ProseMirror',
          '.ProseMirror',
          '[contenteditable="true"]',
          'textarea:not(.g-recaptcha-response)',
          'input[type="text"]'
        ];
        for (const sel of selectors) {
          const el = promptBox.querySelector(sel) || document.querySelector(sel);
          if (el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
            el.focus();
            const rect = el.getBoundingClientRect();
            return {
              ok: true,
              coords: rect ? { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) } : null
            };
          }
        }
        return { ok: false };
      })()
    `;
    const res = await safeExecuteJs<any>(ctx.win, focusEditorJs, 2500);
    return { ok: Boolean(res?.ok), data: res };
  },

  async verify(ctx: FlowStateContext): Promise<boolean> {
    const isFocused = await safeExecuteJs<boolean>(
      ctx.win,
      `Boolean(document.activeElement && (document.activeElement.isContentEditable || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.classList.contains('ProseMirror')))`,
      2000
    );
    return Boolean(isFocused);
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 8: ENTER_PROMPT
 * Điền nội dung prompt vào ô soạn thảo
 */
export const EnterPromptState: FlowAutomationState = {
  name: 'ENTER_PROMPT',
  timeoutMs: 12000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(20, 'Đang nộp prompt sinh ảnh vào Google Flow...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const electron = require('electron');
    const promptClean = (ctx.prompt || '').trim();
    const promptJson = JSON.stringify(promptClean);

    // 1. Native paste qua clipboard
    try {
      electron.clipboard.writeText(promptClean);
      ctx.win.focus();
      ctx.win.webContents.paste();
    } catch (e) {
      console.warn('[FlowStateMachine] Clipboard paste warning:', e);
    }
    await new Promise((r) => setTimeout(r, 300));

    // 2. DOM insertText gia cố
    const fillPromptJs = `
      (async function() {
        const promptBox = document.querySelector(
          'flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box'
        ) || document;
        const selectors = [
          'flow-rich-text-editor .ProseMirror',
          '.prosemirror-editor .ProseMirror',
          '.ProseMirror',
          '[contenteditable="true"]',
          'textarea:not(.g-recaptcha-response)',
          'input[type="text"]'
        ];
        let promptEl = null;
        for (const sel of selectors) {
          const el = promptBox.querySelector(sel) || document.querySelector(sel);
          if (el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
            promptEl = el;
            break;
          }
        }
        if (!promptEl) return { ok: false, error: 'no_prompt_input' };

        promptEl.focus();
        let currentText = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();

        if (!currentText || currentText.length < 5) {
          try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(promptEl);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('delete', false, null);
            document.execCommand('insertText', false, ${promptJson});
            promptEl.dispatchEvent(new Event('input', { bubbles: true }));
            promptEl.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (e) {}

          if (promptEl.tagName === 'TEXTAREA' || promptEl.tagName === 'INPUT') {
            promptEl.value = ${promptJson};
            promptEl.dispatchEvent(new Event('input', { bubbles: true }));
            promptEl.dispatchEvent(new Event('change', { bubbles: true }));
          }
          await new Promise(r => setTimeout(r, 200));
          currentText = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();
        }

        if (!currentText && promptEl.isContentEditable) {
          promptEl.innerHTML = '<p>' + ${JSON.stringify(promptClean)} + '</p>';
          promptEl.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 200));
          currentText = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();
        }

        return { ok: true, textLen: currentText.length };
      })()
    `;

    const fillRes = await safeExecuteJs<any>(ctx.win, fillPromptJs, 5000);
    return { ok: Boolean(fillRes?.ok) };
  },

  async verify(ctx: FlowStateContext): Promise<boolean> {
    // BẮT BUỘC: Đọc lại text từ editor để đảm bảo prompt thực sự đã được điền
    const readPromptJs = `
      (function() {
        const promptBox = document.querySelector(
          'flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box'
        ) || document;
        const promptEl = promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea:not(.g-recaptcha-response), input[type="text"]');
        const text = promptEl ? (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim() : '';
        return text.length;
      })()
    `;
    const textLen = (await safeExecuteJs<number>(ctx.win, readPromptJs, 2000)) || 0;
    return textLen > 0;
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 9: CONFIGURE_OPTIONS
 * Đồng bộ cài đặt ảnh (tỉ lệ, số lượng, mô hình)
 */
export const ConfigureOptionsState: FlowAutomationState = {
  name: 'CONFIGURE_OPTIONS',
  timeoutMs: 15000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(22, 'Đang đồng bộ thiết lập ảnh (tỉ lệ, số lượng, mô hình)...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    await ctx.sessionMgr.configureGoogleFlowSettings(ctx.win, 'image', {
      outputCount: ctx.outputCount || 1,
      aspectRatio: ctx.aspectRatio || '16:9',
      imageEngine: ctx.imageEngine || 'nano-banana',
    });
    return { ok: true };
  },

  async verify(ctx: FlowStateContext): Promise<boolean> {
    const verifySettingsJs = `
      (function() {
        try {
          const raw = localStorage.getItem('flow-prompt-box-settings');
          if (raw) {
            const parsed = JSON.parse(raw);
            return parsed.mode === 'IMAGE';
          }
        } catch (e) {}
        return true;
      })()
    `;
    const verified = await safeExecuteJs<boolean>(ctx.win, verifySettingsJs, 2000);
    return Boolean(verified);
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 10: CAPTURE_BASELINE
 * Ghi nhận snapshot danh sách ảnh đã có trên trang trước khi bấm Generate
 */
export const CaptureBaselineState: FlowAutomationState = {
  name: 'CAPTURE_BASELINE',
  timeoutMs: 8000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(25, 'Đang thiết lập Baseline Snapshot cho ảnh...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const captureBaselineJs = `
      (function() {
        const urls = new Set();
        document.querySelectorAll('img, video, a[href*="flow-content"]').forEach(el => {
          const s = el.currentSrc || el.src || el.href;
          if (s && !s.includes('gstatic') && !s.includes('/icons/') && !s.includes('/avatar')) urls.add(s);
        });
        document.querySelectorAll('flow-media-card, flow-image-card, flow-card, flow-chat-view, .media-card, img').forEach(el => {
          el.setAttribute('data-flow-existing', 'true');
        });
        return Array.from(urls);
      })()
    `;
    const baselineList = (await safeExecuteJs<string[]>(ctx.win, captureBaselineJs, 3000)) || [];
    ctx.baselineUrls = new Set(baselineList);

    // Gắn Network Listener tạm thời
    const electron = require('electron');
    const ses = electron.session.fromPartition('persist:google_veo');
    const netFilter = { urls: ['*://*/*'] };

    ctx.onResponseStartedHandler = (details: any) => {
      if (!ctx.generateClickedAt || Date.now() < ctx.generateClickedAt) return;
      const elapsed = Date.now() - ctx.generateClickedAt;
      if (elapsed < 5000) return; // Time Gate ảnh tối thiểu 5s

      const url = details.url || '';
      if (ctx.baselineUrls.has(url)) return;

      const headers = details.responseHeaders || {};
      const ct = (headers['content-type']?.[0] || headers['Content-Type']?.[0] || '').toLowerCase();
      const isStatic =
        url.includes('gstatic.com') ||
        url.includes('/banners/') ||
        url.includes('/asb/') ||
        url.includes('landing_page') ||
        url.includes('favicon') ||
        url.includes('/avatar') ||
        url.includes('/icons/') ||
        url.includes('fonts.');

      const isRealFlowImage =
        url.includes('flow-content.google') ||
        (url.includes('googleusercontent.com') && !url.includes('=s') && !url.includes('/a/'));

      if (
        isRealFlowImage &&
        (ct.includes('image/png') || ct.includes('image/jpeg') || ct.includes('image/webp')) &&
        !url.includes('blank') &&
        !isStatic &&
        details.statusCode >= 200 &&
        details.statusCode < 300
      ) {
        console.log('[FlowStateMachine] [NETWORK] 🖼️ Bắt được luồng ảnh Flow mới thật:', url.slice(0, 100));
        ctx.capturedMediaUrl = url;
      }
    };

    ses.webRequest.onResponseStarted(netFilter, ctx.onResponseStartedHandler);
    ctx.netFilterAttached = true;

    return { ok: true, data: { baselineCount: baselineList.length } };
  },

  async verify(ctx: FlowStateContext): Promise<boolean> {
    return ctx.netFilterAttached && ctx.baselineUrls instanceof Set;
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 11: FIND_GENERATE_BUTTON
 * Quét DOM tìm nút bấm Generate Image với vòng lặp chờ thích ứng và document fallback
 */
export const FindGenerateButtonState: FlowAutomationState = {
  name: 'FIND_GENERATE_BUTTON',
  timeoutMs: 15000,

  async enter(): Promise<void> {},

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const scanBtnJs = `
      (function() {
        function isVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        }

        const genBtnSelectors = [
          'button.generate-icon-button',
          'flow-generate-icon-button button',
          'button[aria-label*="Bắt đầu tạo" i]',
          'button[aria-label*="Start generation" i]',
          'button[aria-label*="Tạo ảnh" i]',
          'button[aria-label*="Tạo video" i]',
          'button[aria-label*="Generate" i]',
          'button[aria-label*="tạo" i]',
          'button[type="submit"]',
          'flow-generate-button button',
          'button.submit-button'
        ];

        const allButtons = Array.from(document.querySelectorAll(genBtnSelectors.join(', ')));
        const valid = allButtons.filter(b => {
          if (!isVisible(b)) return false;
          if (b.classList.contains('agent-action-button') ||
              b.classList.contains('settings-trigger-button') ||
              b.classList.contains('add-menu-trigger') ||
              b.classList.contains('header-action') ||
              b.classList.contains('suggestion-card')) {
            return false;
          }
          return true;
        });

        if (valid.length > 0) {
          const btn = valid[0];
          const rect = btn.getBoundingClientRect();
          return {
            found: true,
            label: (btn.getAttribute('aria-label') || btn.innerText || '').trim(),
            className: btn.className,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
          };
        }
        return { found: false };
      })()
    `;

    for (let attempt = 0; attempt < 25; attempt++) {
      const res = await safeExecuteJs<any>(ctx.win, scanBtnJs, 2000);
      if (res?.found) {
        return { ok: true, data: res };
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    return {
      ok: false,
      error: 'generate_button_not_found',
      errorDetail: 'Không tìm thấy nút Generate trên giao diện Google Flow sau 25 lần quét.',
    };
  },

  async verify(ctx: FlowStateContext, res: ActionResult): Promise<boolean> {
    return Boolean(res.ok && res.data?.found);
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 12: VERIFY_GENERATE_BUTTON
 * Xác nhận nút Generate không bị che phủ và sẵn sàng kích hoạt
 */
export const VerifyGenerateButtonState: FlowAutomationState = {
  name: 'VERIFY_GENERATE_BUTTON',
  timeoutMs: 8000,

  async enter(): Promise<void> {},

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const verifyBtnJs = `
      (function() {
        const btn = document.querySelector(
          'button.generate-icon-button, flow-generate-icon-button button, button[aria-label*="Bắt đầu tạo" i], button[aria-label*="Start generation" i], button[aria-label*="tạo" i], button[aria-label*="generate" i], button[type="submit"]'
        );
        if (!btn) return { ok: false, error: 'no_btn' };
        const rect = btn.getBoundingClientRect();
        const isVisible = rect && rect.width > 0 && rect.height > 0;
        const isEnabled = !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
        return {
          ok: isVisible,
          visible: isVisible,
          enabled: isEnabled,
          disabledAttr: btn.disabled,
          ariaDisabled: btn.getAttribute('aria-disabled')
        };
      })()
    `;

    for (let attempt = 0; attempt < 15; attempt++) {
      const res = await safeExecuteJs<any>(ctx.win, verifyBtnJs, 2000);
      if (res?.visible) {
        return { ok: true, data: res };
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    return { ok: false, error: 'button_not_ready', errorDetail: 'Nút Generate không sẵn sàng hoặc bị che khuất.' };
  },

  async verify(ctx: FlowStateContext, res: ActionResult): Promise<boolean> {
    return Boolean(res.ok && res.data?.visible);
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 13: CHECK_IDEMPOTENCY_BEFORE_GENERATE (QUAN TRỌNG)
 * Kiểm tra xem Google Flow đã bắt đầu sinh từ trước chưa để chống tạo trùng lặp (duplicate generation)
 */
export const CheckIdempotencyBeforeGenerateState: FlowAutomationState = {
  name: 'CHECK_IDEMPOTENCY_BEFORE_GENERATE',
  timeoutMs: 6000,

  async enter(): Promise<void> {},

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const checkStateJs = `
      (function() {
        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container');
        const promptEl = promptBox ? promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea') : null;
        const currentText = promptEl ? (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim() : '';

        const hasSpinner = Boolean(document.querySelector(
          'flow-loading-indicator, flow-progress-bar, mat-progress-spinner, mat-spinner, .generation-in-progress, [role="progressbar"], flow-card[state="generating"], .loading-spinner'
        ));

        const btnDisabled = Boolean(document.querySelector(
          'flow-generate-icon-button button[disabled], button.generate-icon-button[disabled], button[aria-disabled="true"]'
        ));

        return {
          isCleared: currentText.length === 0,
          hasSpinner,
          btnDisabled
        };
      })()
    `;
    const status = await safeExecuteJs<any>(ctx.win, checkStateJs, 2500);

    // Nếu đã có spinner hoặc nút đang ở trạng thái disabled sinh -> Chuyển thẳng sang WAIT_FOR_GENERATION!
    if (status?.hasSpinner || (status?.isCleared && status?.btnDisabled)) {
      console.warn(
        `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ⚠️ IDEMPOTENCY: Google Flow đã bắt đầu sinh từ trước! Bỏ qua CLICK_GENERATE để chống trùng lặp!`
      );
      ctx.generationState = 'GENERATING';
      return { ok: true, skipToState: 'WAIT_FOR_GENERATION' };
    }

    ctx.generationState = 'READY';
    return { ok: true };
  },

  async verify(): Promise<boolean> {
    return true;
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 14: CLICK_GENERATE
 * TÍNH LẠI TỨC THÌ getBoundingClientRect() NGAY TRƯỚC CLICK VÀ GỬI CLICK CHUỘT THẬT
 */
export const ClickGenerateState: FlowAutomationState = {
  name: 'CLICK_GENERATE',
  timeoutMs: 12000,

  async enter(): Promise<void> {},

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    // YÊU CẦU BẮT BUỘC: Tính lại fresh getBoundingClientRect() tức thì ngay trong khối thực thi này!
    const freshCoordJs = `
      (function() {
        function isVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        }

        const genBtnSelectors = [
          'button.generate-icon-button',
          'flow-generate-icon-button button',
          'button[aria-label*="Bắt đầu tạo" i]',
          'button[aria-label*="Start generation" i]',
          'button[aria-label*="Tạo ảnh" i]',
          'button[aria-label*="Tạo video" i]',
          'button[aria-label*="Generate" i]',
          'button[aria-label*="tạo" i]',
          'button[type="submit"]',
          'flow-generate-button button',
          'button.submit-button'
        ];

        const allButtons = Array.from(document.querySelectorAll(genBtnSelectors.join(', ')));
        const valid = allButtons.filter(b => {
          if (!isVisible(b)) return false;
          if (b.classList.contains('agent-action-button') ||
              b.classList.contains('settings-trigger-button') ||
              b.classList.contains('add-menu-trigger') ||
              b.classList.contains('header-action') ||
              b.classList.contains('suggestion-card')) {
            return false;
          }
          return true;
        });

        if (valid.length === 0) return { ok: false, error: 'no_target_btn' };

        const target = valid[0];

        // Đảm bảo không bị disabled
        if (target.disabled || target.getAttribute('aria-disabled') === 'true') {
          target.disabled = false;
          target.removeAttribute('disabled');
          target.setAttribute('aria-disabled', 'false');
          target.classList.remove('mat-mdc-button-disabled');
        }

        // Kích hoạt click JS dự phòng
        try {
          target.click();
        } catch (e) {}

        // TÍNH LẠI TOẠ ĐỘ TỨC THỜI NGAY TRƯỚC SỰ KIỆN CLICK CHUỘT THẬT (TRÁNH TRÔI DẠT TOẠ ĐỘ)
        const rect = target.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          return { ok: false, error: 'btn_zero_rect' };
        }

        return {
          ok: true,
          coords: {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top),
            left: Math.round(rect.left)
          },
          label: (target.getAttribute('aria-label') || target.innerText || '').trim(),
          computedAt: Date.now()
        };
      })()
    `;

    let clickInfo: any = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      clickInfo = await safeExecuteJs<any>(ctx.win, freshCoordJs, 2500);
      if (clickInfo?.ok && clickInfo.coords) {
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!clickInfo?.ok || !clickInfo.coords) {
      return {
        ok: false,
        error: 'click_prep_failed',
        errorDetail: clickInfo?.error || 'Không thể tính toạ độ nút Generate tức thời.',
      };
    }

    // Gửi click chuột native ngay lập tức tại toạ độ vừa tính tức thời
    if (!ctx.win.isDestroyed()) {
      try {
        console.log(
          `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🖱️ Gửi click chuột native tại toạ độ TỨC THỜI (fresh getBoundingClientRect): (${clickInfo.coords.x}, ${clickInfo.coords.y})`
        );
        ctx.win.webContents.sendInputEvent({
          type: 'mouseDown',
          x: clickInfo.coords.x,
          y: clickInfo.coords.y,
          button: 'left',
          clickCount: 1,
        });
        await new Promise((r) => setTimeout(r, 50));
        ctx.win.webContents.sendInputEvent({
          type: 'mouseUp',
          x: clickInfo.coords.x,
          y: clickInfo.coords.y,
          button: 'left',
          clickCount: 1,
        });
      } catch (err: any) {
        console.warn('[FlowStateMachine] sendInputEvent warning:', err?.message);
      }
    }

    ctx.generateClickedAt = Date.now();
    ctx.generationState = 'STARTING';
    return { ok: true, data: clickInfo };
  },

  async verify(ctx: FlowStateContext): Promise<boolean> {
    return ctx.generateClickedAt > 0;
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 15: VERIFY_GENERATION_STARTED
 * BẮT BUỘC: Kiểm tra phản hồi DOM để xác nhận Flow đã thực sự nhận lệnh
 */
export const VerifyGenerationStartedState: FlowAutomationState = {
  name: 'VERIFY_GENERATION_STARTED',
  timeoutMs: 15000,

  async enter(ctx: FlowStateContext): Promise<void> {
    // Đợi 300ms và tự động xác nhận quyền của Creative Agent nếu có
    await new Promise((r) => setTimeout(r, 300));
    const agentCheckInit = await ctx.sessionMgr.autoConfirmAgentPermission(ctx.win);
    if (agentCheckInit.startsWith('agent_error:')) {
      throw new Error(`agent_error: ${agentCheckInit}`);
    }
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const checkStartedJs = `
      (function() {
        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box') || document;
        const promptEl = promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea:not(.g-recaptcha-response), input[type="text"]');
        const currentText = promptEl ? (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim() : '';

        const hasSpinner = Boolean(document.querySelector(
          'flow-loading-indicator, flow-progress-bar, mat-progress-spinner, mat-spinner, .generation-in-progress, [role="progressbar"], flow-card[state="generating"], .loading-spinner, flow-generating-card, div[class*="generating"]'
        ));

        const btnDisabled = Boolean(document.querySelector(
          'flow-generate-icon-button button[disabled], button.generate-icon-button[disabled], button[aria-disabled="true"], button.generate-icon-button.mat-mdc-button-disabled'
        ));

        return {
          isCleared: currentText.length === 0,
          hasSpinner,
          btnDisabled,
          textLen: currentText.length
        };
      })()
    `;

    let started = false;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const status = await safeExecuteJs<any>(ctx.win, checkStartedJs, 1500);
      if (status?.isCleared || status?.hasSpinner || status?.btnDisabled) {
        started = true;
        console.log(
          `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🎯 Xác nhận generation đã khởi động sau ${(i + 1) * 300}ms:`,
          status
        );
        break;
      }
    }

    // Nếu sau 4.5s chưa thấy phản hồi, gửi bổ trợ Enter native
    if (!started && !ctx.win.isDestroyed()) {
      console.log(
        `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ⚠️ Flow chưa phản hồi, kích hoạt Enter native bổ trợ...`
      );
      try {
        await ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        await new Promise((r) => setTimeout(r, 60));
        await ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      } catch {}
      await new Promise((r) => setTimeout(r, 1200));

      const recheck = await safeExecuteJs<any>(ctx.win, checkStartedJs, 1500);
      if (recheck?.isCleared || recheck?.hasSpinner || recheck?.btnDisabled) {
        started = true;
      }
    }

    ctx.generationState = started ? 'GENERATING' : 'STARTING';
    return { ok: started };
  },

  async verify(ctx: FlowStateContext, res: ActionResult): Promise<boolean> {
    return Boolean(res.ok);
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 16: WAIT_FOR_GENERATION
 * Polling chờ kết quả sinh ảnh kết hợp Time Gate và Auto-confirm Tác nhân
 */
export const WaitForGenerationState: FlowAutomationState = {
  name: 'WAIT_FOR_GENERATION',
  timeoutMs: 120000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.generationState = 'GENERATING';
    ctx.onProgress?.(35, 'Đang chờ Google Flow tạo ảnh...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const pollDomImageJs = `
      (async function() {
        try {
          const imgs = Array.from(document.querySelectorAll(
            'flow-media-card img, flow-image-card img, flow-agent-panel img, flow-chat-view img, flow-message img, flow-canvas img, .media-card img, .project-canvas img, [role="img"] img, img'
          ));
          for (const img of imgs) {
            if (img.closest('[data-flow-existing="true"]')) continue;
            const src = img.currentSrc || img.src;
            if (!src || src.includes('gstatic.com') || src.includes('/banners/') || src.includes('favicon') || src.includes('avatar') || src.includes('/icons/')) continue;

            if (src.startsWith('http') && (src.includes('googleusercontent.com') || src.includes('flow-content.google') || src.includes('blob:'))) {
              return { type: 'http', imageUrl: src };
            }

            if (src.startsWith('blob:')) {
              try {
                const resp = await fetch(src);
                const blob = await resp.blob();
                if (blob.size > 3000) {
                  const b64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                  });
                  return { type: 'blob', base64Data: b64 };
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
        return null;
      })()
    `;

    const maxWaitSeconds = 90;
    const pollIntervalMs = 2000;
    const maxAttempts = Math.floor((maxWaitSeconds * 1000) / pollIntervalMs);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (ctx.win.isDestroyed()) break;
      if (ctx.isCancelled?.()) return { ok: false, error: 'cancelled' };

      // Tự động kiểm tra quyền hoặc phát hiện lỗi Tác nhân
      const agentStatus = await ctx.sessionMgr.autoConfirmAgentPermission(ctx.win);
      if (agentStatus.startsWith('agent_error:')) {
        return { ok: false, error: 'agent_error', errorDetail: agentStatus };
      }

      const elapsedSinceClick = Date.now() - ctx.generateClickedAt;
      const minImageTimeGate = 4000; // Tối thiểu 4s mới chấp nhận ảnh thật

      const domResult = await safeExecuteJs<any>(ctx.win, pollDomImageJs, 3000);
      const foundUrl =
        (elapsedSinceClick >= minImageTimeGate && ctx.capturedMediaUrl && !ctx.baselineUrls.has(ctx.capturedMediaUrl) ? ctx.capturedMediaUrl : null) ||
        (elapsedSinceClick >= minImageTimeGate && domResult?.type === 'http' && !ctx.baselineUrls.has(domResult.imageUrl) ? domResult.imageUrl : null);

      if (foundUrl) {
        ctx.capturedMediaUrl = foundUrl;
        return { ok: true, data: { imageUrl: foundUrl } };
      }

      if (domResult?.type === 'blob' && domResult?.base64Data && elapsedSinceClick >= minImageTimeGate) {
        ctx.capturedBase64 = domResult.base64Data;
        return { ok: true, data: { base64Data: domResult.base64Data } };
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const elapsed = (attempt + 1) * (pollIntervalMs / 1000);
      const pct = Math.min(85, Math.round(35 + (elapsed / maxWaitSeconds) * 50));
      ctx.onProgress?.(pct, `Google Flow đang xử lý ảnh (${Math.round(elapsed)}s / ${maxWaitSeconds}s)...`);
    }

    return { ok: false, error: 'generation_timeout', errorDetail: 'Quá thời gian chờ ảnh từ Google Flow.' };
  },

  async verify(ctx: FlowStateContext, res: ActionResult): Promise<boolean> {
    return Boolean(res.ok && (ctx.capturedMediaUrl || ctx.capturedBase64));
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 17: VERIFY_GENERATION_COMPLETED
 * Xác nhận ảnh kết quả hợp lệ, không phải ảnh cũ
 */
export const VerifyGenerationCompletedState: FlowAutomationState = {
  name: 'VERIFY_GENERATION_COMPLETED',
  timeoutMs: 6000,

  async enter(): Promise<void> {},

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const valid = Boolean(ctx.capturedMediaUrl || ctx.capturedBase64);
    if (!valid) {
      return { ok: false, error: 'no_media_captured' };
    }
    ctx.generationState = 'COMPLETED';
    return { ok: true };
  },

  async verify(ctx: FlowStateContext): Promise<boolean> {
    return ctx.generationState === 'COMPLETED';
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 18: EXTRACT_OUTPUT
 * Trích xuất base64 và cập nhật projectId
 */
export const ExtractOutputState: FlowAutomationState = {
  name: 'EXTRACT_OUTPUT',
  timeoutMs: 15000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(90, 'Đã nhận được ảnh từ Google Flow, đang trích xuất dữ liệu ảnh...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    let base64Data = ctx.capturedBase64 || undefined;

    if (!base64Data && ctx.capturedMediaUrl) {
      try {
        const toBase64Js = `
          (async function() {
            try {
              const resp = await fetch(${JSON.stringify(ctx.capturedMediaUrl)});
              const blob = await resp.blob();
              return await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
              });
            } catch (e) {
              return null;
            }
          })()
        `;
        base64Data = (await safeExecuteJs<string>(ctx.win, toBase64Js, 10000)) || undefined;
      } catch {}
    }

    let projectId: string | undefined;
    try {
      const currentUrl = ctx.win.webContents?.getURL?.() || '';
      const match = currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) projectId = match[1];
    } catch {}

    if (projectId) {
      ctx.activeProjectId = projectId;
      ctx.sessionMgr.setCurrentProjectId(projectId);
    }

    ctx.result = {
      imageUrl: ctx.capturedMediaUrl || undefined,
      base64Data,
      projectId: ctx.activeProjectId,
    };

    return { ok: true, data: ctx.result };
  },

  async verify(ctx: FlowStateContext): Promise<boolean> {
    return Boolean(ctx.result?.imageUrl || ctx.result?.base64Data);
  },

  async exit(): Promise<void> {},
};

/**
 * Danh sách toàn bộ các State theo thứ tự cho luồng sinh ảnh Image Generation
 */
export const FlowImageGenerationStatePipeline: FlowAutomationState[] = [
  OpenFlowState,
  WaitForPageReadyState,
  VerifySessionState,
  EnsureProjectContextState,
  CleanCanvasState,
  FindEditorState,
  FindPromptInputState,
  EnterPromptState,
  ConfigureOptionsState,
  CaptureBaselineState,
  FindGenerateButtonState,
  VerifyGenerateButtonState,
  CheckIdempotencyBeforeGenerateState,
  ClickGenerateState,
  VerifyGenerationStartedState,
  WaitForGenerationState,
  VerifyGenerationCompletedState,
  ExtractOutputState,
];
