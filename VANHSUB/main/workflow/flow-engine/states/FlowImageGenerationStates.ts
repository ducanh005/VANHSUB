import fs from 'fs';
import path from 'path';
import type {
  FlowAutomationState,
  FlowStateContext,
  ActionResult,
  VerifyResult,
} from '../types';
import { FlowSmartWait } from '../FlowSmartWait';
import { FlowElementFinder } from '../FlowElementFinder';
import { FlowOverlayDetector } from '../FlowOverlayDetector';
import { FlowRecoveryManager } from '../FlowRecoveryManager';
import { FlowClipboardGuard } from '../FlowClipboardGuard';
import { FlowFileInputInjector } from '../FlowFileInputInjector';

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
  timeoutMs: 35000,

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

  async verify(ctx: FlowStateContext): Promise<VerifyResult> {
    if (!ctx.win || ctx.win.isDestroyed()) return { ok: false, reason: 'Cửa sổ lobbyWindow đã bị đóng' };
    const currentUrl = ctx.win.webContents?.getURL?.() || '';
    const isAtFlow = currentUrl.toLowerCase().includes('flow.google.com');
    const isAboutLanding = currentUrl.toLowerCase().includes('flow.google.com/about');
    const ok = isAtFlow && !isAboutLanding;
    return {
      ok,
      criteria: {
        currentUrl,
        isAtFlow,
        isAboutLanding,
        title: ctx.win.getTitle?.() || '',
      },
      reason: !isAtFlow
        ? `URL hiện tại không thuộc flow.google.com: ${currentUrl}`
        : isAboutLanding
        ? 'LobbyWindow đang ở trang giới thiệu /about (chưa xác thực phiên hoặc cookie hết hạn)'
        : undefined,
    };
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
    try {
      await FlowSmartWait.pollUntil(
        async () => {
          const readyState = await safeExecuteJs<string>(ctx.win, 'document.readyState', 2000);
          return readyState === 'complete';
        },
        {
          timeoutMs: 8000,
          initialIntervalMs: 100,
          isCancelled: ctx.isCancelled,
          tag: 'WAIT_PAGE_READY',
        }
      );
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: 'page_ready_timeout', errorDetail: err?.message };
    }
  },

  async verify(ctx: FlowStateContext): Promise<VerifyResult> {
    const readyState = await safeExecuteJs<string>(ctx.win, 'document.readyState', 2000);
    const isReady = readyState === 'complete' || readyState === 'interactive';
    return {
      ok: isReady,
      criteria: {
        readyState: readyState || 'unknown',
        isInteractive: isReady,
      },
      reason: isReady ? undefined : `document.readyState chưa đạt chuẩn: ${readyState}`,
    };
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
    if (currentUrl.includes('flow.google.com/about')) {
      return { ok: false, error: 'session_expired', errorDetail: 'Google Flow chuyển hướng về trang /about do phiên làm việc chưa đăng nhập hoặc cookie hết hạn.' };
    }
    return { ok: true };
  },

  async verify(ctx: FlowStateContext): Promise<VerifyResult> {
    const currentUrl = (ctx.win.webContents?.getURL?.() || '').toLowerCase();
    const notInLogin = !currentUrl.includes('accounts.google.com') && !currentUrl.includes('servicelogin');
    const notInAbout = !currentUrl.includes('flow.google.com/about');
    const isFlow = currentUrl.includes('flow.google.com');
    const status = ctx.sessionMgr.getStatus();
    const ok = notInLogin && notInAbout && isFlow;
    return {
      ok,
      criteria: {
        sessionStatus: status.sessionStatus,
        hasActiveSession: status.hasSession,
        notInLoginFlow: notInLogin,
        notInAboutLanding: notInAbout,
        antiSpamAllowed: status.antiSpam?.allowed,
      },
      reason: ok ? undefined : 'Phiên đăng nhập không hợp lệ, đang ở trang login hoặc landing page /about',
    };
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

    // Đối với Image Generation: Đảm bảo cửa sổ đang ở chế độ chỉnh sửa ảnh (/project/<id>/edit/<asset_id>)
    // Tránh bị kẹt ở trang Thư viện Media (/project/<id>) với thanh prompt rỗng hoặc Scene (/scene/<id>) bị khóa
    const checkEditJs = `Boolean(window.location.href.includes('/edit/') && document.querySelector('.ProseMirror, [contenteditable="true"]:not([contenteditable="false"])'))`;
    let inEdit = await safeExecuteJs<boolean>(ctx.win, checkEditJs, 1500);
    if (inEdit) {
      return { ok: true, data: { projectId: ctx.activeProjectId } };
    }

    // Nếu đang ở trong Scene (/scene/), thoát ra để về trang chính hoặc vào Image Editor
    const inSceneJs = `Boolean(window.location.href.includes('/scene/'))`;
    const inScene = await safeExecuteJs<boolean>(ctx.win, inSceneJs, 1500);
    if (inScene) {
      ctx.onProgress?.(13, 'Đang chuyển từ Scene sang không gian tạo ảnh...');
      const exitSceneJs = `
        (function() {
          const backBtn = document.querySelector('button[aria-label*="Quay lại" i], button[aria-label*="Back" i], button.back-button, a[href*="/project/"]');
          if (backBtn) { backBtn.click(); return true; }
          return false;
        })()
      `;
      await safeExecuteJs(ctx.win, exitSceneJs, 2000);
      await new Promise((r) => setTimeout(r, 1200));
    }

    // 1. Kiểm tra xem đã có thẻ ảnh nào (flow-image-tile, img.image, .tile-container img) trong Thư viện Media chưa
    const clickImageTileJs = `
      (function() {
        const img = document.querySelector('img.image, flow-image-tile img, .tile-container img, [class*="tile"] img, flow-image-tile');
        if (img) {
          img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          img.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
          return true;
        }
        return false;
      })()
    `;
    let hasTile = await safeExecuteJs<boolean>(ctx.win, clickImageTileJs, 2000);

    if (hasTile) {
      // Đợi trang /edit/ tải và mount .ProseMirror
      for (let i = 0; i < 10; i++) {
        if (ctx.isCancelled?.()) return { ok: false, error: 'cancelled' };
        await new Promise((r) => setTimeout(r, 800));
        inEdit = await safeExecuteJs<boolean>(ctx.win, checkEditJs, 1500);
        if (inEdit) {
          console.log('[FlowImageState] ✅ Đã mở Image Editor từ thẻ ảnh hiện có.');
          return { ok: true, data: { projectId: ctx.activeProjectId } };
        }
      }
    }

    // 2. Nếu chưa có thẻ ảnh nào (dự án mới hoặc trống): Tải ảnh lên theo quy trình Upload cục bộ
    ctx.onProgress?.(13, 'Đang nạp ảnh từ đĩa cục bộ lên Google Flow...');
    let localImagePath = ctx.referenceImagePath || ctx.initFrameUrl;
    if (localImagePath?.startsWith('file://')) {
      localImagePath = localImagePath.replace(/^file:\/\/\/?/, '');
    }

    // Nếu không có ảnh chỉ định, tìm ảnh starter canvas trên máy
    if (!localImagePath || !fs.existsSync(localImagePath) || fs.statSync(localImagePath).size === 0) {
      const candidates = [
        path.resolve('app/images/logo.png'),
        path.resolve('renderer/public/images/logo.png'),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand) && fs.statSync(cand).size > 0) {
          localImagePath = cand;
          break;
        }
      }
    }

    if (localImagePath && fs.existsSync(localImagePath)) {
      console.log(`[FlowImageState] 🖼️ Canvas dự án mới chưa có ảnh — nạp ảnh starter để kích hoạt Image Editor: "${localImagePath}"`);
      const injected = await FlowFileInputInjector.injectViaCDPDragDrop(ctx.win, localImagePath);
      if (injected) {
        // Đợi thẻ ảnh xuất hiện (tối đa 12s)
        for (let i = 0; i < 12; i++) {
          if (ctx.isCancelled?.()) return { ok: false, error: 'cancelled' };
          await new Promise((r) => setTimeout(r, 1000));
          const clicked = await safeExecuteJs<boolean>(ctx.win, clickImageTileJs, 1500);
          if (clicked) {
            // Đợi chuyển sang /edit/
            for (let j = 0; j < 10; j++) {
              if (ctx.isCancelled?.()) return { ok: false, error: 'cancelled' };
              await new Promise((r) => setTimeout(r, 800));
              inEdit = await safeExecuteJs<boolean>(ctx.win, checkEditJs, 1500);
              if (inEdit) {
                console.log('[FlowImageState] ✅ Tải ảnh thành công và đã vào Image Editor.');
                return { ok: true, data: { projectId: ctx.activeProjectId } };
              }
            }
            break;
          }
        }
      }
    }

    return { ok: true, data: { projectId: ctx.activeProjectId } };
  },

  async verify(ctx: FlowStateContext): Promise<VerifyResult> {
    const currentUrl = ctx.win.webContents?.getURL?.() || '';
    const inProject = currentUrl.includes('/project/');
    return {
      ok: inProject,
      criteria: {
        activeProjectId: ctx.activeProjectId || 'unknown',
        urlMatchesProject: inProject,
        currentUrl,
      },
      reason: inProject ? undefined : `URL không nằm trong workspace dự án: ${currentUrl}`,
    };
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

  async verify(ctx: FlowStateContext): Promise<VerifyResult> {
    const checkPromptJs = `
      (function() {
        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box') || document;
        const promptEl = promptBox ? promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea:not(.g-recaptcha-response), input[type="text"]') : null;
        if (!promptEl) return { ok: false, reason: 'no_prompt_el' };
        const rect = promptEl.getBoundingClientRect();
        const text = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();
        const chips = Array.from(promptBox.querySelectorAll('flow-image-ingredient-chip, .chip-container, .chip-image-wrapper'));
        return {
          ok: rect && rect.width > 0 && rect.height > 0 && chips.length === 0,
          canFocus: rect && rect.width > 0,
          textLen: text.length,
          chipsCount: chips.length,
          coords: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
        };
      })()
    `;
    const res = await safeExecuteJs<any>(ctx.win, checkPromptJs, 3000);
    const ok = Boolean(res?.ok);
    return {
      ok,
      criteria: {
        promptReady: ok,
        canFocus: Boolean(res?.canFocus),
        textLen: res?.textLen ?? 0,
        chipsCount: res?.chipsCount ?? 0,
        coords: res?.coords || null,
      },
      reason: ok ? undefined : (res?.chipsCount > 0 ? 'Vẫn còn sót chip ảnh cũ (flow-image-ingredient-chip) trong prompt box' : 'Ô soạn thảo prompt chưa sẵn sàng hoặc không thể focus'),
    };
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
    const findRes = await FlowElementFinder.find(ctx.win, FlowElementFinder.getEditorContainerSpec());
    if (!findRes.found || !findRes.selectedCandidate) {
      return {
        ok: false,
        error: findRes.error || 'editor_not_found',
        errorDetail: findRes.errorDetail || 'Không tìm thấy khung chứa prompt editor đạt độ tin cậy.',
      };
    }
    return {
      ok: true,
      data: {
        candidate: findRes.selectedCandidate,
        tried: findRes.candidatesTried,
        strategy: findRes.selectedCandidate.strategy,
        confidence: findRes.selectedCandidate.confidence,
        selector: findRes.selectedCandidate.selector,
      },
    };
  },

  async verify(ctx: FlowStateContext, actionRes: ActionResult): Promise<VerifyResult> {
    const candidate = actionRes.data?.candidate;
    const ok = Boolean(candidate && candidate.confidence >= 65);
    return {
      ok,
      criteria: {
        editorContainerFound: ok,
        strategy: candidate?.strategy || 'none',
        selector: candidate?.selector || 'none',
        confidence: candidate?.confidence || 0,
        candidatesTried: actionRes.data?.tried || 0,
      },
      reason: ok ? undefined : 'Không tìm thấy khung chứa prompt editor trên DOM đạt chuẩn an toàn',
    };
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
    // 1. Kiểm tra nếu đang bị kẹt ở /scene/ hoặc prompt bị khóa (contenteditable="false")
    const checkPromptStatusJs = `
      (function() {
        const pm = document.querySelector('.ProseMirror, [contenteditable="true"], [contenteditable="false"]');
        return {
          exists: Boolean(pm),
          isContentEditable: Boolean(pm && pm.isContentEditable),
          inScene: window.location.href.includes('/scene/'),
          inEdit: window.location.href.includes('/edit/')
        };
      })()
    `;
    const promptStatus = await safeExecuteJs<any>(ctx.win, checkPromptStatusJs, 2000);

    if (promptStatus?.exists && !promptStatus.isContentEditable) {
      console.warn('[FlowImageState] ⚠️ Phát hiện ô prompt bị khóa (contenteditable=false), đang khôi phục vào Image Editor...');
      // Thoát Scene nếu có
      if (promptStatus.inScene) {
        await safeExecuteJs(ctx.win, `
          (function() {
            const backBtn = document.querySelector('button[aria-label*="Quay lại" i], button[aria-label*="Back" i], button.back-button, a[href*="/project/"]');
            if (backBtn) backBtn.click();
          })()
        `, 2000);
        await new Promise(r => setTimeout(r, 1200));
      }
      // Click vào thẻ ảnh để vào /edit/
      await safeExecuteJs(ctx.win, `
        (function() {
          const img = document.querySelector('img.image, flow-image-tile img, .tile-container img, [class*="tile"] img, flow-image-tile');
          if (img) {
            img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            img.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
          }
        })()
      `, 2000);
      await new Promise(r => setTimeout(r, 1500));
    }

    const findRes = await FlowElementFinder.find(ctx.win, FlowElementFinder.getPromptInputSpec());
    if (!findRes.found || !findRes.selectedCandidate) {
      return {
        ok: false,
        error: findRes.error || 'prompt_input_not_found',
        errorDetail: findRes.errorDetail || 'Không tìm thấy ô nhập prompt đạt độ tin cậy an toàn.',
      };
    }

    const candidate = findRes.selectedCandidate;
    const focusJs = `
      (function() {
        const el = document.querySelector(${JSON.stringify(candidate.selector)});
        if (el) {
          el.focus();
          return true;
        }
        return false;
      })()
    `;
    await safeExecuteJs(ctx.win, focusJs, 1500);

    return {
      ok: true,
      data: {
        strategy: candidate.strategy,
        confidence: candidate.confidence,
        selector: candidate.selector,
        coords: {
          x: Math.round(candidate.rect.x + candidate.rect.width / 2),
          y: Math.round(candidate.rect.y + candidate.rect.height / 2),
        },
      },
    };
  },

  async verify(ctx: FlowStateContext, res: ActionResult): Promise<VerifyResult> {
    const checkFocusJs = `
      (function() {
        const el = document.activeElement;
        if (!el) return { ok: false };
        const isEditable = el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
        return {
          ok: isEditable,
          tagName: el.tagName,
          isContentEditable: Boolean(el.isContentEditable)
        };
      })()
    `;
    const checkRes = await safeExecuteJs<any>(ctx.win, checkFocusJs, 2000);
    const ok = Boolean(checkRes?.ok);
    return {
      ok,
      criteria: {
        activeElementIsEditable: ok,
        tagName: checkRes?.tagName || 'none',
        isContentEditable: Boolean(checkRes?.isContentEditable),
        finderStrategy: res.data?.strategy || 'none',
        confidenceScore: res.data?.confidence ?? 0,
        selectedSelector: res.data?.selector || '',
      },
      reason: ok ? undefined : 'Active element hiện tại không phải ô nhập liệu văn bản',
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 7B: HANDLE_IMAGE_REFERENCE
 * Nạp ảnh tham chiếu cục bộ (Character / Style Reference) từ đĩa vào Prompt Box nếu có referenceImagePath/initFrameUrl.
 * Kiểm tra xác nhận chip ảnh xuất hiện trong DOM thực tế; fail cứng nếu không gắn được reference image.
 */
export const HandleImageReferenceState: FlowAutomationState = {
  name: 'HANDLE_IMAGE_REFERENCE',
  timeoutMs: 30000,

  async enter(ctx: FlowStateContext): Promise<void> {
    const refPath = ctx.referenceImagePath || ctx.initFrameUrl;
    if (refPath) {
      const fileName = path.basename(refPath);
      ctx.onProgress?.(18, `Đang nạp ảnh tham chiếu cục bộ "${fileName}" vào Google Flow...`);
    }
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const refPath = ctx.referenceImagePath || ctx.initFrameUrl;
    if (!refPath) {
      return { ok: true, data: { hasRefImage: false, attachmentConfirmed: true, uploadMethodUsed: 'none' } };
    }

    let localPath = refPath;
    if (localPath.startsWith('file://')) {
      localPath = localPath.replace(/^file:\/\/\/?/, '');
    }
    localPath = path.resolve(localPath);

    if (!fs.existsSync(localPath) || fs.statSync(localPath).size === 0) {
      console.error(`[FlowImageState] ❌ File ảnh tham chiếu không tồn tại trên đĩa hoặc rỗng: "${localPath}"`);
      return {
        ok: false,
        error: 'IMAGE_REFERENCE_ATTACH_FAILED',
        errorDetail: `IMAGE_REFERENCE_ATTACH_FAILED: File ảnh tham chiếu không tồn tại trên đĩa hoặc rỗng: "${localPath}"`,
        data: { hasRefImage: true, attachmentConfirmed: false, fileName: path.basename(localPath), localPath }
      };
    }

    const fileName = path.basename(localPath);
    const fileSizeKb = (fs.statSync(localPath).size / 1024).toFixed(1);
    console.log(`[FlowImageState] 📤 [HANDLE_IMAGE_REFERENCE] Bắt đầu nạp ảnh tham chiếu cục bộ: "${localPath}" (${fileSizeKb} KB)`);

    // Selector nhận diện chip ảnh tham chiếu / ingredient chip trong prompt box
    const checkExistingChipJs = `
      (function() {
        const selectors = [
          'flow-image-ingredient-chip',
          'flow-ingredient-chip',
          '.chip-container',
          'mat-chip-row',
          '[data-ingredient-type]',
          'flow-chip',
          '.chip-image-wrapper',
          'flow-prompt-box mat-chip',
          '.frame-trigger',
          'button[aria-label*="Thành phần tạo hình ảnh" i]',
          'flow-prompt-box img',
          'flow-base-prompt-box img',
          '.ProseMirror img',
          'flow-prompt-box [class*="chip"]',
          'flow-prompt-box [class*="ingredient"]',
          '[data-ingredient-name]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const r = el.getBoundingClientRect();
            if (r && r.width > 0 && r.height > 0) {
              return { hasChip: true, selector: sel, tag: el.tagName };
            }
          }
        }
        return { hasChip: false };
      })()
    `;

    // 1. Kiểm tra nếu chip ảnh đã có sẵn trong prompt box
    const alreadyHasChip = await safeExecuteJs<any>(ctx.win, checkExistingChipJs, 1500);
    if (alreadyHasChip?.hasChip) {
      console.log(`[FlowImageState] ℹ️ Chip ảnh tham chiếu đã có sẵn trong prompt box (selector: ${alreadyHasChip.selector}).`);
      return {
        ok: true,
        data: {
          hasRefImage: true,
          attachmentConfirmed: true,
          fileName,
          uploadMethodUsed: 'already_present',
          chipSelector: alreadyHasChip.selector
        }
      };
    }

    // 2. Phương thức A: Thử nạp qua file input nếu có trong DOM
    try {
      const cdpFileInput = await FlowFileInputInjector.injectIntoBrowserWindow(ctx.win, localPath, {
        inputSelector: 'flow-prompt-box input[type="file"], flow-base-prompt-box input[type="file"], input[type="file"]'
      });
      if (cdpFileInput.success) {
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 400));
          const chipRes = await safeExecuteJs<any>(ctx.win, checkExistingChipJs, 1000);
          if (chipRes?.hasChip) {
            console.log(`[FlowImageState] ✅ Chip ảnh tham chiếu xuất hiện sau file input injection: ${chipRes.selector}`);
            return {
              ok: true,
              data: {
                hasRefImage: true,
                attachmentConfirmed: true,
                fileName,
                uploadMethodUsed: cdpFileInput.methodUsed,
                chipSelector: chipRes.selector
              }
            };
          }
        }
      }
    } catch (e) {
      console.warn('[FlowImageState] File input injection warning:', e);
    }

    // 3. Phương thức B: Drag-drop file bằng CDP trực tiếp vào toạ độ ProseMirror editor
    const getEditorRectJs = `
      (function() {
        const selectors = [
          '.ProseMirror',
          '[contenteditable="true"]',
          'flow-prompt-box',
          'flow-base-prompt-box',
          '.prompt-box-container',
          '.base-prompt-box'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const r = el.getBoundingClientRect();
            if (r && r.width > 0 && r.height > 0) {
              return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), width: r.width, height: r.height, selector: sel };
            }
          }
        }
        return null;
      })()
    `;
    const editorRect = await safeExecuteJs<any>(ctx.win, getEditorRectJs, 2000);
    const dropX = editorRect?.x ?? 720;
    const dropY = editorRect?.y ?? 450;
    console.log(`[FlowImageState] 📎 Drag-drop ảnh tham chiếu vào editor tại (${dropX}, ${dropY}): "${localPath}"`);

    try {
      const dropped = await FlowFileInputInjector.injectViaCDPDragDrop(ctx.win, localPath, dropX, dropY);
      if (dropped) {
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const chipRes = await safeExecuteJs<any>(ctx.win, checkExistingChipJs, 1000);
          if (chipRes?.hasChip) {
            console.log(`[FlowImageState] ✅ Chip ảnh tham chiếu xuất hiện sau CDP drag-drop vào editor: ${chipRes.selector}`);
            return {
              ok: true,
              data: {
                hasRefImage: true,
                attachmentConfirmed: true,
                fileName,
                uploadMethodUsed: 'cdp_drag_drop_editor',
                chipSelector: chipRes.selector
              }
            };
          }
        }
      }
    } catch (dragErr) {
      console.warn('[FlowImageState] CDP Drag-drop vào editor lỗi:', dragErr);
    }

    // 4. Phương thức C: Fallback Drag-drop vào viewport center
    try {
      const dropped2 = await FlowFileInputInjector.injectViaCDPDragDrop(ctx.win, localPath, 720, 450);
      if (dropped2) {
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const chipRes = await safeExecuteJs<any>(ctx.win, checkExistingChipJs, 1000);
          if (chipRes?.hasChip) {
            console.log(`[FlowImageState] ✅ Chip ảnh tham chiếu xuất hiện sau fallback drag-drop: ${chipRes.selector}`);
            return {
              ok: true,
              data: {
                hasRefImage: true,
                attachmentConfirmed: true,
                fileName,
                uploadMethodUsed: 'cdp_drag_drop_fallback',
                chipSelector: chipRes.selector
              }
            };
          }
        }
      }
    } catch {}

    // 5. Phương thức D: Fallback clipboard nativeImage paste vào ProseMirror
    let electron: any = null;
    try {
      electron = (ctx as any).electron || require('electron');
    } catch {
      electron = (ctx as any).electron || null;
    }

    if (electron && electron.nativeImage && electron.clipboard) {
      await FlowClipboardGuard.withPreservedClipboard(electron, async () => {
        try {
          const natImg = electron.nativeImage.createFromPath(localPath);
          if (!natImg.isEmpty()) {
            electron.clipboard.writeImage(natImg);
            await safeExecuteJs(
              ctx.win,
              `(function() {
                const el = document.querySelector('flow-prompt-box .ProseMirror, .prosemirror-editor, [contenteditable="true"]');
                if (el) { el.focus(); }
              })()`,
              1000
            );
            ctx.win.focus();
            ctx.win.webContents.paste();
          }
        } catch (pasteErr) {
          console.warn('[FlowImageState] Cảnh báo paste referenceImagePath:', pasteErr);
        }
      });

      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const chipRes = await safeExecuteJs<any>(ctx.win, checkExistingChipJs, 1000);
        if (chipRes?.hasChip) {
          console.log(`[FlowImageState] ✅ Chip ảnh tham chiếu xuất hiện sau clipboard paste: ${chipRes.selector}`);
          return {
            ok: true,
            data: {
              hasRefImage: true,
              attachmentConfirmed: true,
              fileName,
              uploadMethodUsed: 'clipboard',
              chipSelector: chipRes.selector
            }
          };
        }
      }
    }

    console.error(`[FlowImageState] ❌ Không phát hiện chip ảnh tham chiếu sau khi thử tất cả phương thức nạp: "${localPath}"`);
    return {
      ok: false,
      error: 'IMAGE_REFERENCE_ATTACH_FAILED',
      errorDetail: `IMAGE_REFERENCE_ATTACH_FAILED: Không thể đính kèm ảnh tham chiếu "${fileName}" vào Google Flow (chip ảnh/thumbnail không xuất hiện trong DOM).`,
      data: {
        hasRefImage: true,
        attachmentConfirmed: false,
        fileName,
        uploadMethodUsed: 'none',
      }
    };
  },

  async verify(ctx: FlowStateContext, actionRes: ActionResult): Promise<VerifyResult> {
    const refPath = ctx.referenceImagePath || ctx.initFrameUrl;
    if (!refPath) {
      return {
        ok: true,
        criteria: {
          hasRefImage: false,
          attachmentConfirmed: true,
          uploadMethodUsed: 'none',
        }
      };
    }

    const fileName = path.basename(refPath);

    // Kiểm tra kết quả thực thi
    if (!actionRes.ok || !actionRes.data?.attachmentConfirmed) {
      return {
        ok: false,
        error: 'IMAGE_REFERENCE_ATTACH_FAILED',
        errorDetail: actionRes.errorDetail || `IMAGE_REFERENCE_ATTACH_FAILED: Đính kèm ảnh tham chiếu "${fileName}" thất bại ở bước thực thi.`,
        criteria: {
          hasRefImage: true,
          uploadMethodUsed: actionRes.data?.uploadMethodUsed || 'none',
          fileName,
          attachmentConfirmed: false,
          chipSelector: 'none',
        },
        reason: `IMAGE_REFERENCE_ATTACH_FAILED: Chip ảnh tham chiếu "${fileName}" chưa xuất hiện trong prompt box của Google Flow.`,
      };
    }

    // Quét lại DOM lần cuối để đảm bảo chip vẫn tồn tại ổn định
    const checkChipJs = `
      (function() {
        const selectors = [
          'flow-image-ingredient-chip',
          'flow-ingredient-chip',
          '.chip-container',
          'mat-chip-row',
          '[data-ingredient-type]',
          'flow-chip',
          '.chip-image-wrapper',
          'flow-prompt-box mat-chip',
          '.frame-trigger',
          'button[aria-label*="Thành phần tạo hình ảnh" i]',
          'flow-prompt-box img',
          'flow-base-prompt-box img',
          '.ProseMirror img',
          'flow-prompt-box [class*="chip"]',
          'flow-prompt-box [class*="ingredient"]',
          '[data-ingredient-name]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const r = el.getBoundingClientRect();
            if (r && r.width > 0 && r.height > 0) {
              return { hasChip: true, selector: sel, tag: el.tagName };
            }
          }
        }
        return { hasChip: false };
      })()
    `;
    const res = await safeExecuteJs<any>(ctx.win, checkChipJs, 2000);
    const hasChip = Boolean(res?.hasChip);

    if (!hasChip) {
      return {
        ok: false,
        error: 'IMAGE_REFERENCE_ATTACH_FAILED',
        errorDetail: `IMAGE_REFERENCE_ATTACH_FAILED: Xác minh thất bại: Chip ảnh tham chiếu "${fileName}" không còn tồn tại trong DOM sau khi nạp.`,
        criteria: {
          hasRefImage: true,
          uploadMethodUsed: actionRes.data?.uploadMethodUsed || 'unknown',
          fileName,
          attachmentConfirmed: false,
          chipSelector: 'none',
        },
        reason: `IMAGE_REFERENCE_ATTACH_FAILED: Không tìm thấy chip ảnh tham chiếu "${fileName}" trong prompt box.`,
      };
    }

    return {
      ok: true,
      criteria: {
        hasRefImage: true,
        uploadMethodUsed: actionRes.data?.uploadMethodUsed || 'unknown',
        fileName,
        attachmentConfirmed: true,
        chipSelector: res?.selector || actionRes.data?.chipSelector || 'chip_detected',
      }
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 8: ENTER_PROMPT
 * Điền nội dung prompt vào ô soạn thảo ProseMirror bằng Chromium native IME insertText
 * và kiểm tra nghiêm ngặt tooltip "cần cung cấp câu lệnh" để fail sớm (PROMPT_NOT_RECOGNIZED_BY_APP)
 */
export const EnterPromptState: FlowAutomationState = {
  name: 'ENTER_PROMPT',
  timeoutMs: 15000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(20, 'Đang nhập prompt sinh ảnh vào Google Flow...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const promptClean = (ctx.prompt || '').trim();
    if (!promptClean) {
      return { ok: false, error: 'INVALID_INPUT', errorDetail: 'Nội dung prompt rỗng' };
    }

    console.log(`[FlowImageState] ✍️ [ENTER_PROMPT] Chuẩn bị nhập prompt (${promptClean.length} chars): "${promptClean.slice(0, 60)}..."`);

    // 1. Focus ProseMirror và chọn nội dung cũ để ghi đè sạch sẽ
    await safeExecuteJs(
      ctx.win,
      `(function() {
        const promptBox = document.querySelector(
          'flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box'
        ) || document;
        const promptEl = promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea:not(.g-recaptcha-response), input[type="text"]');
        if (promptEl) {
          promptEl.focus();
          if (promptEl.isContentEditable) {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(promptEl);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      })()`,
      1000
    );

    // 2. Kích hoạt native focus trên cửa sổ Electron
    ctx.win.focus();

    // 3. Phương thức chính: ctx.win.webContents.insertText(promptClean)
    // Đây là Native Chromium IME input API trong Electron, kích hoạt trực tiếp editing pipeline của Chromium,
    // đảm bảo ProseMirror transactions và Angular View binding ghi nhận 100% chuẩn xác.
    try {
      await ctx.win.webContents.insertText(promptClean);
    } catch (insertErr) {
      console.warn('[FlowImageState] webContents.insertText warning:', insertErr);
    }

    // 4. Kiểm tra độ dài văn bản sau insertText
    const checkTextJs = `
      (function() {
        const promptBox = document.querySelector(
          'flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box'
        ) || document;
        const promptEl = promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea:not(.g-recaptcha-response), input[type="text"]');
        if (!promptEl) return { found: false, textLen: 0 };
        const t = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();
        return { found: true, textLen: t.length };
      })()
    `;
    let textStatus = await safeExecuteJs<any>(ctx.win, checkTextJs, 1500);

    // 5. Fallback nếu textLength < 5 (insertText không vào được do focus)
    if (!textStatus?.textLen || textStatus.textLen < 5) {
      console.warn('[FlowImageState] insertText chưa đạt độ dài tối thiểu, thử fallback qua DataTransfer và execCommand...');
      const promptJson = JSON.stringify(promptClean);
      const fallbackJs = `
        (function() {
          const promptBox = document.querySelector(
            'flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box'
          ) || document;
          const promptEl = promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea:not(.g-recaptcha-response), input[type="text"]');
          if (!promptEl) return { ok: false };
          promptEl.focus();

          try {
            const dt = new DataTransfer();
            dt.setData('text/plain', ${promptJson});
            const pasteEv = new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              clipboardData: dt
            });
            promptEl.dispatchEvent(pasteEv);
          } catch (e) {}

          let curLen = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim().length;
          if (curLen < 5) {
            try {
              document.execCommand('insertText', false, ${promptJson});
            } catch (e) {}
          }
          return { ok: true };
        })()
      `;
      await safeExecuteJs(ctx.win, fallbackJs, 2000);
    }

    // 6. Phát sinh InputEvent và Change Event để đảm bảo Angular Change Detection kích hoạt
    await safeExecuteJs(
      ctx.win,
      `(function() {
        const promptBox = document.querySelector(
          'flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box'
        ) || document;
        const promptEl = promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea:not(.g-recaptcha-response), input[type="text"]');
        if (promptEl) {
          try {
            promptEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(promptClean)} }));
          } catch (e) {
            promptEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
          promptEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()`,
      1000
    );

    // 7. Settling pause 400ms để ProseMirror và Angular component cập nhật trạng thái
    await new Promise((r) => setTimeout(r, 400));

    return { ok: true, data: { promptLength: promptClean.length } };
  },

  async verify(ctx: FlowStateContext): Promise<VerifyResult> {
    const readPromptJs = `
      (function() {
        const promptBox = document.querySelector(
          'flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box'
        ) || document;
        const promptEl = promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea:not(.g-recaptcha-response), input[type="text"]');
        if (!promptEl) return { found: false, textLength: 0 };
        const text = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();
        const isFocused = document.activeElement === promptEl || promptEl.contains(document.activeElement);

        // Quét tooltip cảnh báo thiếu prompt
        const tooltipSelectors = [
          '.mat-mdc-tooltip',
          '[role="tooltip"]',
          '.cdk-overlay-pane',
          'mat-tooltip-component'
        ];
        let missingPromptTooltip = false;
        let tooltipText = '';
        for (const sel of tooltipSelectors) {
          const tooltips = document.querySelectorAll(sel);
          for (const t of tooltips) {
            const tt = (t.textContent || t.innerText || '').toLowerCase();
            if (
              tt.includes('phải cung cấp câu lệnh') ||
              tt.includes('cung cấp câu lệnh') ||
              tt.includes('provide a prompt') ||
              tt.includes('enter a prompt') ||
              tt.includes('prompt is required')
            ) {
              missingPromptTooltip = true;
              tooltipText = (t.textContent || '').trim();
              break;
            }
          }
          if (missingPromptTooltip) break;
        }

        // Quét thêm tooltip hoặc attribute disabled trên nút Generate
        const btn = document.querySelector(
          'button.generate-icon-button, button.generate-button, flow-generate-icon-button button, button[aria-label*="Bắt đầu tạo" i], button[aria-label*="Tạo ảnh" i], button[aria-label*="Generate" i], button[type="submit"]'
        );
        if (btn) {
          const btnTip = (btn.getAttribute('mattooltip') || btn.getAttribute('aria-label') || btn.getAttribute('title') || '').toLowerCase();
          if (
            btnTip.includes('phải cung cấp câu lệnh') ||
            btnTip.includes('cung cấp câu lệnh') ||
            btnTip.includes('provide a prompt') ||
            btnTip.includes('enter a prompt')
          ) {
            missingPromptTooltip = true;
            tooltipText = btnTip;
          }
        }

        return {
          found: true,
          textLength: text.length,
          sample: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
          isFocused,
          tagName: promptEl.tagName,
          missingPromptTooltip,
          tooltipText
        };
      })()
    `;
    const res = await safeExecuteJs<any>(ctx.win, readPromptJs, 2500);

    if (!res?.found || !res.textLength) {
      return {
        ok: false,
        error: 'INVALID_INPUT',
        errorDetail: 'Nội dung prompt đọc lại từ DOM đang rỗng hoặc không tìm thấy ô nhập prompt.',
        criteria: {
          textLength: 0,
          sample: '',
          missingPromptTooltip: Boolean(res?.missingPromptTooltip),
          elementTag: res?.tagName || 'none',
        },
        reason: 'Nội dung prompt đọc lại từ DOM đang rỗng hoặc không tìm thấy ô nhập prompt',
      };
    }

    if (res.missingPromptTooltip) {
      console.error(
        `[FlowImageState] ❌ Tooltip yêu cầu câu lệnh vẫn hiển thị dù textLength=${res.textLength} ("${res.tooltipText}"). Flow/ProseMirror chưa công nhận prompt!`
      );
      return {
        ok: false,
        error: 'PROMPT_NOT_RECOGNIZED_BY_APP',
        errorDetail: `PROMPT_NOT_RECOGNIZED_BY_APP: Google Flow hiển thị tooltip "${res.tooltipText}" cho biết prompt chưa được ứng dụng công nhận, dù DOM có textLength=${res.textLength}.`,
        criteria: {
          textLength: res.textLength,
          sample: res.sample,
          missingPromptTooltip: true,
          tooltipText: res.tooltipText,
          elementTag: res.tagName,
        },
        reason: `PROMPT_NOT_RECOGNIZED_BY_APP: Tooltip "${res.tooltipText}" vẫn xuất hiện — ProseMirror/Angular chưa kích hoạt transaction ghi nhận prompt.`,
      };
    }

    return {
      ok: true,
      criteria: {
        textLength: res.textLength,
        sample: res.sample,
        missingPromptTooltip: false,
        isFocused: Boolean(res.isFocused),
        elementTag: res.tagName,
      }
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 9: CONFIGURE_OPTIONS
 * Đồng bộ cài đặt ảnh (tỉ lệ, số lượng, mô hình)
 */
export const ConfigureOptionsState: FlowAutomationState = {
  name: 'CONFIGURE_OPTIONS',
  timeoutMs: 25000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(22, 'Đang đồng bộ thiết lập ảnh (tỉ lệ, số lượng, mô hình)...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    // 1. Đồng bộ aspect ratio, output count, và mode qua configureGoogleFlowSettings
    await ctx.sessionMgr.configureGoogleFlowSettings(ctx.win, 'image', {
      outputCount: ctx.outputCount || 1,
      aspectRatio: ctx.aspectRatio || '16:9',
      imageEngine: ctx.imageEngine || 'nano-banana',
    });

    // Cho giao diện ổn định sau khi popover cài đặt tỷ lệ đóng
    await new Promise((r) => setTimeout(r, 400));

    // 2. Chọn model đúng theo ctx.imageEngine trong Image Editor (/edit/)
    // Mapping từ imageEngine config → keyword tìm kiếm trên UI Google Flow
    const rawEngine = (ctx.imageEngine || 'nano-banana').toLowerCase().trim();
    const engineNormalized =
      rawEngine.includes('pro') || rawEngine.includes('banana-pro') || rawEngine === 'banana_pro'
        ? 'banana-pro'
        : 'nano-banana';

    // Keyword để match: 'pro' cho Banana Pro, 'nano' cho Nano Banana
    const modelKeyword = engineNormalized === 'banana-pro' ? 'pro' : 'nano';

    console.log(`[FlowImageState] 🍌 Đang chọn model: ${engineNormalized} (keyword: "${modelKeyword}") cho imageEngine="${ctx.imageEngine}"`);

    try {
      // 2a. Click nút settings trigger để mở model picker panel
      const openModelPickerJs = `
        (function() {
          const trigger = document.querySelector(
            'button.settings-trigger-button, button[aria-label*="Điều kiện kích hoạt cài đặt" i], button[aria-label*="settings" i][class*="trigger"], flow-prompt-box button[aria-label*="cài đặt" i]'
          );
          if (trigger) {
            trigger.click();
            return { clicked: true, text: (trigger.innerText || trigger.getAttribute('aria-label') || '').trim() };
          }
          return { clicked: false };
        })()
      `;
      const openRes = await safeExecuteJs<any>(ctx.win, openModelPickerJs, 2000);
      if (!openRes?.clicked) {
        console.error('[FlowImageState] ❌ Không tìm thấy nút settings trigger để mở menu chọn model!');
        return {
          ok: false,
          error: 'settings_trigger_not_found',
          errorDetail: 'Không tìm thấy nút Settings Trigger để mở menu chọn model trong Google Flow',
          data: { modelClicked: false, keyword: modelKeyword, availableOptions: [] }
        };
      }

      // 2b. BƯỚC WAIT: Chờ menu model options render xong (chờ ít nhất 1 option element xuất hiện trong DOM)
      const scanOptionsJs = `
        (function() {
          const optionSelectors = [
            'mat-option',
            'mat-radio-button',
            '[role="option"]',
            '[role="menuitem"]',
            '[role="radio"]',
            '.model-option',
            '.model-item',
            '.mat-mdc-menu-item',
            '.cdk-overlay-pane [role="menuitem"]',
            '.cdk-overlay-pane button',
            '.cdk-overlay-container mat-option',
            '.cdk-overlay-container [role="menuitem"]',
            '.cdk-overlay-container [role="radio"]'
          ];
          const elements = Array.from(document.querySelectorAll(optionSelectors.join(', '))).filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });

          const options = elements.map(el => {
            const text = (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ');
            return text;
          }).filter(t => t.length > 0 && t.length < 80);

          return {
            count: elements.length,
            options: Array.from(new Set(options))
          };
        })()
      `;

      let menuReady = false;
      let menuCandidatesCount = 0;
      let detectedOptions: string[] = [];
      const waitStart = Date.now();
      const maxWaitMenuMs = 4000;

      while (Date.now() - waitStart < maxWaitMenuMs) {
        const scanRes = await safeExecuteJs<any>(ctx.win, scanOptionsJs, 1500);
        if (scanRes && scanRes.count > 0) {
          menuReady = true;
          menuCandidatesCount = scanRes.count;
          detectedOptions = scanRes.options || [];
          break;
        }
        await new Promise((r) => setTimeout(r, 150));
        if (ctx.isCancelled?.()) break;
      }

      // Nếu hết thời gian chờ mà candidates vẫn = 0 -> LỖI CỨNG (hard error)
      if (!menuReady || menuCandidatesCount === 0) {
        const overlayDebug = await safeExecuteJs<any>(ctx.win, `
          (function() {
            const container = document.querySelector('.cdk-overlay-container');
            if (!container) return 'Không có .cdk-overlay-container trong DOM';
            const text = (container.innerText || container.textContent || '').trim().slice(0, 250);
            const tags = Array.from(container.querySelectorAll('*')).map(e => e.tagName.toLowerCase()).slice(0, 30);
            return { text, tags };
          })()
        `, 1500);

        console.error(
          `[FlowImageState] ❌ Menu chọn model không xuất hiện hoặc chưa kịp render (candidates=0). Overlay debug:`,
          overlayDebug
        );

        return {
          ok: false,
          error: 'model_menu_not_rendered',
          errorDetail: `Menu chọn model chưa kịp render hoặc không xuất hiện sau khi click Settings Trigger (candidates=0). Keyword cần tìm="${modelKeyword}". Overlay debug: ${JSON.stringify(overlayDebug)}`,
          data: {
            modelClicked: false,
            keyword: modelKeyword,
            availableOptions: [],
          }
        };
      }

      console.log(`[FlowImageState] 📋 Đã phát hiện ${menuCandidatesCount} options trong menu model: [${detectedOptions.map(o => `"${o}"`).join(', ')}]`);

      // 2c. Tìm và click đúng model option theo keyword
      const selectModelJs = `
        (function() {
          const keyword = ${JSON.stringify(modelKeyword.toLowerCase())};
          const optionSelectors = [
            'mat-option',
            'mat-radio-button',
            '[role="option"]',
            '[role="menuitem"]',
            '[role="radio"]',
            '.model-option',
            '.model-item',
            '.mat-mdc-menu-item',
            '.cdk-overlay-pane [role="menuitem"]',
            '.cdk-overlay-pane button',
            '.cdk-overlay-container mat-option',
            '.cdk-overlay-container [role="menuitem"]',
            '.cdk-overlay-container [role="radio"]'
          ];
          const candidates = Array.from(document.querySelectorAll(optionSelectors.join(', '))).filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });

          const allOptionsText = candidates.map(el => (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' '));

          let matchedEl = null;
          let matchedText = '';

          // Logic match chuẩn xác:
          // Nếu keyword là 'nano': ưu tiên chứa 'nano' VÀ KHÔNG chứa 'pro'
          // Nếu keyword là 'pro': ưu tiên chứa 'pro'
          for (const el of candidates) {
            const t = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase().trim();
            if (keyword === 'nano') {
              if (t.includes('nano') && !t.includes('pro')) {
                matchedEl = el;
                matchedText = el.textContent?.trim() || t;
                break;
              } else if (t.includes('nano') && !matchedEl) {
                matchedEl = el;
                matchedText = el.textContent?.trim() || t;
              }
            } else if (keyword === 'pro') {
              if (t.includes('pro')) {
                matchedEl = el;
                matchedText = el.textContent?.trim() || t;
                break;
              }
            }
          }

          // Fallback match nếu chưa tìm ra
          if (!matchedEl) {
            for (const el of candidates) {
              const t = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase().trim();
              if (t.includes(keyword)) {
                matchedEl = el;
                matchedText = el.textContent?.trim() || t;
                break;
              }
            }
          }

          if (matchedEl) {
            matchedEl.click();
            return {
              selected: true,
              clickedText: matchedText.slice(0, 80),
              allOptions: allOptionsText
            };
          }

          return {
            selected: false,
            candidatesCount: candidates.length,
            allOptions: allOptionsText
          };
        })()
      `;

      const selectRes = await safeExecuteJs<any>(ctx.win, selectModelJs, 2500);

      // Nếu không tìm thấy model khớp keyword -> LỖI CỨNG (hard error), KHÔNG ĐƯỢC warning rồi đi tiếp!
      if (!selectRes?.selected) {
        console.error(
          `[FlowImageState] ❌ Không tìm thấy model option nào khớp keyword="${modelKeyword}". ` +
          `Danh sách toàn bộ ${selectRes?.allOptions?.length || 0} options thực tế trên DOM: [${(selectRes?.allOptions || []).map((o: string) => `"${o}"`).join(', ')}]`
        );
        return {
          ok: false,
          error: 'model_option_not_found',
          errorDetail: `Không tìm thấy model option khớp keyword="${modelKeyword}" (engine="${engineNormalized}"). Danh sách options thực tế trên DOM: [${(selectRes?.allOptions || []).map((o: string) => `"${o}"`).join(', ')}]`,
          data: {
            modelClicked: false,
            keyword: modelKeyword,
            availableOptions: selectRes?.allOptions || [],
          }
        };
      }

      console.log(`[FlowImageState] ✅ Đã click chọn model thành công: "${selectRes.clickedText}"`);
      await new Promise((r) => setTimeout(r, 300));

      // 2d. Đóng panel sau khi chọn (Backdrop click hoặc Escape)
      await safeExecuteJs(ctx.win, `
        (function() {
          const bd = document.querySelector('.cdk-overlay-backdrop');
          if (bd) { bd.click(); return; }
        })()
      `, 1000);
      ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      await new Promise((r) => setTimeout(r, 50));
      ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await new Promise((r) => setTimeout(r, 250));

      return {
        ok: true,
        data: {
          modelClicked: true,
          selectedModelText: selectRes.clickedText,
          keyword: modelKeyword,
          engineNormalized,
          availableOptions: selectRes.allOptions,
        }
      };
    } catch (modelErr: any) {
      console.error('[FlowImageState] ❌ Lỗi nghiêm trọng khi chọn model:', modelErr?.message || modelErr);
      return {
        ok: false,
        error: 'model_selection_exception',
        errorDetail: `Ngoại lệ khi thực hiện chọn model: ${modelErr?.message || modelErr}`,
        data: { modelClicked: false, keyword: modelKeyword, availableOptions: [] }
      };
    }
  },

  async verify(ctx: FlowStateContext, res: ActionResult): Promise<VerifyResult> {
    // 1. Xác nhận (a): Hành động click chọn model ở bước EXECUTE đã thực sự xảy ra
    const modelClicked = Boolean(res.ok && res.data?.modelClicked);
    const selectedModelText = res.data?.selectedModelText || '';
    if (!modelClicked) {
      return {
        ok: false,
        criteria: {
          modelClicked: false,
          selectedModelText: '',
          currentModelText: '',
        },
        reason: `Bước chọn model thất bại: không click được vào bất kỳ model option nào (modelClicked=false, error=${res.errorDetail || res.error || 'candidates=0'})`,
      };
    }

    // 2. Xác nhận (b): currentModelText đọc từ UI sau đó phải khớp với model mong muốn
    const rawEngine = (ctx.imageEngine || 'nano-banana').toLowerCase().trim();
    const engineNormalized =
      rawEngine.includes('pro') || rawEngine.includes('banana-pro') || rawEngine === 'banana_pro'
        ? 'banana-pro'
        : 'nano-banana';
    const expectedKeyword = engineNormalized === 'banana-pro' ? 'pro' : 'nano';

    const verifySettingsJs = `
      (function() {
        let storageOk = false;
        let mode = 'IMAGE';
        let outputCount = 1;
        let aspectRatio = 'LANDSCAPE';
        try {
          const raw = localStorage.getItem('flow-prompt-box-settings');
          if (raw) {
            const parsed = JSON.parse(raw);
            mode = parsed.mode || 'IMAGE';
            outputCount = parsed.Qp || parsed.outputCount || 1;
            aspectRatio = parsed.aspectRatio || 'LANDSCAPE';
            storageOk = (mode === 'IMAGE');
          }
        } catch (e) {}

        const modeTabActive = Boolean(
          document.querySelector('mat-button-toggle[value="IMAGE"].mat-button-toggle-checked, button[role="tab"][aria-selected="true"]')
        );

        // Đọc model hiện tại từ settings trigger button
        const triggerBtn = document.querySelector('button.settings-trigger-button, button[aria-label*="Điều kiện kích hoạt cài đặt" i]');
        const currentModelText = triggerBtn ? (triggerBtn.textContent || triggerBtn.getAttribute('aria-label') || '').trim() : '';

        return {
          modeOk: storageOk || modeTabActive,
          mode,
          outputCount,
          aspectRatio,
          modeTabActive,
          currentModelText: currentModelText.slice(0, 80),
        };
      })()
    `;
    const verifyRes = await safeExecuteJs<any>(ctx.win, verifySettingsJs, 2000);
    const modeOk = Boolean(verifyRes?.modeOk);
    const currentModelText = (verifyRes?.currentModelText || '').toLowerCase();
    const modelTextMatches = currentModelText.includes(expectedKeyword);

    const ok = modeOk && modelTextMatches;
    let failReason: string | undefined;
    if (!modeOk) {
      failReason = 'Thiết lập mode trong LocalStorage/DOM không khớp IMAGE';
    } else if (!modelTextMatches) {
      failReason = `Model hiển thị trên UI ("${verifyRes?.currentModelText}") không khớp với model mong muốn "${engineNormalized}" (keyword="${expectedKeyword}")`;
    }

    return {
      ok,
      criteria: {
        modelClicked,
        selectedModelText,
        expectedKeyword,
        currentModelText: verifyRes?.currentModelText || '',
        modelTextMatches,
        mode: verifyRes?.mode || 'IMAGE',
        outputCount: verifyRes?.outputCount || ctx.outputCount || 1,
        aspectRatio: verifyRes?.aspectRatio || ctx.aspectRatio || '16:9',
      },
      reason: failReason,
    };
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
      const refTime = ctx.generateClickedAt || ctx.idempotencyDetectedAt;
      if (!refTime || Date.now() < refTime) return;
      const elapsed = Date.now() - refTime;
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

  async verify(ctx: FlowStateContext): Promise<VerifyResult> {
    const ok = Boolean(ctx.netFilterAttached && ctx.baselineUrls instanceof Set);
    return {
      ok,
      criteria: {
        baselineSnapshotCount: ctx.baselineUrls?.size ?? 0,
        netFilterAttached: ctx.netFilterAttached,
      },
      reason: ok ? undefined : 'Chưa gắn được network listener hoặc baseline snapshot rỗng',
    };
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
    const startWait = Date.now();
    let findRes = await FlowElementFinder.find(ctx.win, FlowElementFinder.getGenerateButtonSpec());

    // Nếu chưa thấy ngay, dùng Adaptive Polling chờ với FlowSmartWait
    if (!findRes.found) {
      try {
        findRes = await FlowSmartWait.pollUntil<any>(
          async () => {
            if (!ctx.win || ctx.win.isDestroyed()) return null;

            // Kiểm tra fallback: Nếu phát hiện spinner đang chạy -> Chuyển sang WAIT_FOR_GENERATION
            const checkGenJs = `
              Boolean(document.querySelector(
                'flow-loading-indicator, flow-progress-bar, mat-progress-spinner, mat-spinner, .generation-in-progress, flow-card[state="generating"], .loading-spinner, flow-generating-card'
              ))
            `;
            const isGenerating = await safeExecuteJs<boolean>(ctx.win, checkGenJs, 1000);
            if (isGenerating) {
              return { isGenerating: true };
            }

            const res = await FlowElementFinder.find(ctx.win, FlowElementFinder.getGenerateButtonSpec());
            return res.found ? res : null;
          },
          {
            timeoutMs: 12000,
            initialIntervalMs: 80,
            maxIntervalMs: 500,
            isCancelled: ctx.isCancelled,
            tag: 'FIND_GEN_BTN',
          }
        );
      } catch (e) {
        // Hết thời gian chờ thích ứng
      }
    }

    if ((findRes as any)?.isGenerating) {
      console.warn(
        `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ⚠️ FIND_GENERATE_BUTTON: Phát hiện tiến trình sinh đang chạy! Kích hoạt Idempotency fallback...`
      );
      return {
        ok: true,
        skipToState: 'WAIT_FOR_GENERATION',
        data: { decision: 'ALREADY_GENERATING_FALLBACK', found: false },
      };
    }

    if (!findRes?.found || !findRes.selectedCandidate) {
      return {
        ok: false,
        error: findRes?.error || 'generate_button_not_found',
        errorDetail: findRes?.errorDetail || 'Không tìm thấy nút Generate trên UI Google Flow sau adaptive search.',
      };
    }

    const candidate = findRes.selectedCandidate;
    ctx.foundButton = candidate;
    const durationMs = Date.now() - startWait;

    return {
      ok: true,
      data: {
        found: true,
        strategy: candidate.strategy,
        confidence: candidate.confidence,
        selector: candidate.selector,
        label: candidate.label || '',
        rect: candidate.rect,
        isStable: Boolean(candidate.isStable),
        deltas: candidate.stability?.deltas || { dx: 0, dy: 0, dw: 0, dh: 0 },
        unobscured: Boolean(candidate.unobscured),
        className: (candidate.className || '').slice(0, 50),
        earlyExitMs: durationMs,
      },
    };
  },

  async verify(ctx: FlowStateContext, res: ActionResult): Promise<VerifyResult> {
    const found = Boolean(res.ok && res.data?.found);
    return {
      ok: found,
      criteria: {
        buttonFound: found,
        finderStrategy: res.data?.strategy || 'none',
        confidenceScore: res.data?.confidence ?? 0,
        selectedSelector: res.data?.selector || '',
        boundingStability: res.data?.isStable ? 'STABLE' : 'UNSTABLE',
        deltas: res.data?.deltas || null,
        unobscured: res.data?.unobscured ?? false,
        rect: res.data?.rect || null,
        smartWaitEarlyExitMs: res.data?.earlyExitMs ?? 0,
      },
      reason: found ? undefined : 'Không tìm thấy nút Generate đạt chuẩn ổn định và tin cậy trên UI',
    };
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
    const selector = ctx.foundButton?.selector || 'button.generate-icon-button, flow-generate-icon-button button';
    const verifyBtnJs = `
      (function() {
        const btn = document.querySelector(${JSON.stringify(selector)});
        if (!btn) return { ok: false, error: 'no_btn' };
        const rect = btn.getBoundingClientRect();
        const isVisible = rect && rect.width > 0 && rect.height > 0;
        const isEnabled = !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
        return {
          ok: isVisible && isEnabled,
          visible: isVisible,
          enabled: isEnabled,
          disabledAttr: btn.disabled,
          ariaDisabled: btn.getAttribute('aria-disabled'),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
        };
      })()
    `;

    try {
      const res = await FlowSmartWait.pollUntil<any>(
        async () => {
          const status = await safeExecuteJs<any>(ctx.win, verifyBtnJs, 1500);
          return status?.visible ? status : null;
        },
        {
          timeoutMs: 6000,
          initialIntervalMs: 50,
          maxIntervalMs: 300,
          isCancelled: ctx.isCancelled,
          tag: 'VERIFY_GEN_BTN',
        }
      );
      return { ok: true, data: res };
    } catch {
      return { ok: false, error: 'button_not_ready', errorDetail: 'Nút Generate không sẵn sàng hoặc bị che khuất sau adaptive polling.' };
    }
  },

  async verify(ctx: FlowStateContext, res: ActionResult): Promise<VerifyResult> {
    const isVisible = Boolean(res.ok && res.data?.visible);
    return {
      ok: isVisible,
      criteria: {
        isVisible,
        isEnabled: Boolean(res.data?.enabled),
        ariaDisabled: res.data?.ariaDisabled || 'false',
        rect: res.data?.rect || null,
      },
      reason: isVisible ? undefined : 'Nút Generate bị ẩn hoặc không thể tương tác',
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 13: CHECK_IDEMPOTENCY_BEFORE_GENERATE (QUAN TRỌNG)
 * Kiểm tra xem Google Flow đã bắt đầu sinh từ trước chưa để chống tạo trùng lặp (duplicate generation)
 */
export const CheckIdempotencyBeforeGenerateState: FlowAutomationState = {
  name: 'CHECK_IDEMPOTENCY_BEFORE_GENERATE',
  timeoutMs: 12000,

  async enter(): Promise<void> {},

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const checkStateJs = `
      (function() {
        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box') || document;
        const promptEl = promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea:not(.g-recaptcha-response), input[type="text"]');
        const currentText = promptEl ? (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim() : '';

        // 1. Quét các chỉ báo spinner, progress bar thực sự đang chạy (loại trừ border glow trang trí của prompt box)
        function isVisible(el) {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }

        const spinners = Array.from(document.querySelectorAll(
          'flow-loading-indicator, flow-progress-bar, mat-progress-spinner, mat-spinner, .generation-in-progress, .loading-spinner, flow-generating-card'
        )).filter(isVisible);
        const hasSpinner = spinners.length > 0;

        // 2. Quét trạng thái nút Generate: disabled hoặc đã bị ẩn khỏi DOM
        const genBtn = document.querySelector(
          'button.generate-icon-button, flow-generate-icon-button button, button[aria-label*="Bắt đầu tạo" i], button[aria-label*="Start generation" i], button[aria-label*="Tạo ảnh" i], button[aria-label*="Generate" i], button[type="submit"]'
        );
        const hasGenBtn = Boolean(genBtn);
        const btnDisabled = genBtn ? (genBtn.disabled || genBtn.getAttribute('aria-disabled') === 'true' || genBtn.classList.contains('mat-mdc-button-disabled')) : false;

        // 3. Quét các card đang sinh trên giao diện
        const cards = Array.from(document.querySelectorAll('flow-media-card, flow-image-card, flow-card, flow-chat-item'));
        const hasGeneratingCard = cards.some(c => {
          const state = c.getAttribute('state') || '';
          const cls = c.className || '';
          return state.includes('generating') || cls.includes('generating') || Boolean(c.querySelector('mat-progress-spinner, [role="progressbar"], flow-loading-indicator'));
        });

        return {
          isCleared: currentText.length === 0,
          textLen: currentText.length,
          hasSpinner,
          hasGeneratingCard,
          hasGenBtn,
          btnDisabled
        };
      })()
    `;
    let status = await safeExecuteJs<any>(ctx.win, checkStateJs, 2500);

    // YÊU CẦU 1: Bắt buộc phải có ÍT NHẤT MỘT trong hai bằng chứng trực tiếp:
    // hasSpinner === true HOẶC hasGeneratingCard === true.
    // Nếu cả hai đều false -> TUYỆT ĐỐI KHÔNG được kết luận là đang generate, dù isCleared hay btnDisabled thế nào!
    const hasDirectEvidence = Boolean(status?.hasSpinner || status?.hasGeneratingCard);

    if (hasDirectEvidence) {
      console.warn(
        `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ⚠️ IDEMPOTENCY: Google Flow đã bắt đầu sinh thật từ trước (có bằng chứng trực tiếp: hasSpinner=${status?.hasSpinner}, hasGeneratingCard=${status?.hasGeneratingCard})! Bỏ qua CLICK_GENERATE để chống trùng lặp!`,
        status
      );
      ctx.generationState = 'GENERATING';
      ctx.idempotencyDetectedAt = Date.now();
      return {
        ok: true,
        skipToState: 'WAIT_FOR_GENERATION',
        data: { ...status, decision: 'ALREADY_GENERATING_SKIP_CLICK', directEvidence: true },
      };
    }

    // YÊU CẦU 2 & 3: Khi btnDisabled: true nhưng KHÔNG có spinner hay generating card:
    // Đây là "transient UI lock" sau khi nhập prompt / paste ảnh, KHÔNG phải đang generate.
    // Xử lý: Chờ thêm (poll ngắn mỗi 300ms, tối đa 4500ms) cho tới khi btnDisabled trở lại false rồi mới CLICK_GENERATE.
    if (status?.btnDisabled) {
      console.log(
        `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ⏳ Nút Generate đang tạm khóa (btnDisabled=true, transient UI lock) nhưng KHÔNG có spinner/card. Bắt đầu chờ nút mở khóa (poll mỗi 300ms, tối đa 4500ms)...`
      );

      const pollStart = Date.now();
      const maxWaitMs = 4500;
      let unlocked = false;

      while (Date.now() - pollStart < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 300));
        if (ctx.isCancelled?.()) break;

        const pollStatus = await safeExecuteJs<any>(ctx.win, checkStateJs, 1500);

        // Nếu trong lúc chờ xuất hiện bằng chứng sinh trực tiếp -> chuyển ngay sang WAIT_FOR_GENERATION
        if (pollStatus?.hasSpinner || pollStatus?.hasGeneratingCard) {
          console.warn(
            `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ⚠️ Trong lúc chờ transient UI lock, phát hiện generation đã bắt đầu thật (hasSpinner=${pollStatus.hasSpinner}, hasGeneratingCard=${pollStatus.hasGeneratingCard})! Chuyển sang WAIT_FOR_GENERATION.`,
            pollStatus
          );
          ctx.generationState = 'GENERATING';
          ctx.idempotencyDetectedAt = Date.now();
          return {
            ok: true,
            skipToState: 'WAIT_FOR_GENERATION',
            data: { ...pollStatus, decision: 'ALREADY_GENERATING_SKIP_CLICK', directEvidence: true },
          };
        }

        // Nếu nút đã hết disabled
        if (pollStatus?.hasGenBtn && !pollStatus.btnDisabled) {
          console.log(
            `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ✅ Nút Generate đã hết disabled (mở khóa) sau ${Date.now() - pollStart}ms! Tiến hành CLICK_GENERATE.`
          );
          unlocked = true;
          status = pollStatus;
          break;
        }
      }

      if (!unlocked) {
        console.warn(
          `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ⚠️ Hết thời gian chờ transient UI lock (${maxWaitMs}ms), nút vẫn báo disabled (nhưng vẫn KHÔNG có spinner/card). VẪN TIẾP TỤC chuyển sang CLICK_GENERATE để không bị bỏ qua sinh ảnh!`
        );
      }
    }

    // YÊU CẦU 4: Luôn thực thi CLICK_GENERATE thật sự khi không có bằng chứng trực tiếp
    ctx.generationState = 'READY';
    return {
      ok: true,
      data: { ...status, decision: 'SAFE_TO_GENERATE', directEvidence: false },
    };
  },

  async verify(ctx: FlowStateContext, res: ActionResult): Promise<VerifyResult> {
    const data = res.data || {};
    return {
      ok: true,
      criteria: {
        textLen: data.textLen ?? 0,
        isCleared: Boolean(data.isCleared),
        hasSpinner: Boolean(data.hasSpinner),
        hasGeneratingCard: Boolean(data.hasGeneratingCard),
        hasGenBtn: Boolean(data.hasGenBtn),
        btnDisabled: Boolean(data.btnDisabled),
        decision: data.decision || 'SAFE_TO_GENERATE',
        directEvidence: Boolean(data.directEvidence),
      },
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 14: CLICK_GENERATE
 * TÍNH LẠI TỨC THÌ getBoundingClientRect() NGAY TRƯỚC CLICK VÀ GỬI CLICK CHUỘT THẬT
 */
export const ClickGenerateState: FlowAutomationState = {
  name: 'CLICK_GENERATE',
  timeoutMs: 30000,

  async enter(ctx: FlowStateContext): Promise<void> {
    if (ctx.generationState === 'GENERATING' && (ctx.idempotencyDetectedAt || 0) > 0) {
      console.warn(
        `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🛡️ IDEMPOTENCY PRE-CHECK: Generate đã được xác nhận đang chạy từ trước (idempotencyDetectedAt: ${ctx.idempotencyDetectedAt}).`
      );
    }
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    // 1. NGUYÊN TẮC ZERO DUPLICATE CLICK: Chỉ bỏ qua nếu THỰC SỰ đã có bằng chứng sinh từ trước (idempotencyDetectedAt)
    if (ctx.generationState === 'GENERATING' && (ctx.idempotencyDetectedAt || 0) > 0) {
      console.warn(
        `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🛡️ IDEMPOTENCY RESUME: Bỏ qua CLICK_GENERATE vì generation đã được kích hoạt trước đó!`
      );
      return {
        ok: true,
        skipToState: 'WAIT_FOR_GENERATION',
        data: { skipped: true, reason: 'already_generating', clickedAt: ctx.generateClickedAt },
      };
    }

    // Script tính toạ độ tức thời của nút Generate trong flow-prompt-box
    const freshCoordJs = `
      (function() {
        const container = document.querySelector('flow-prompt-box');
        if (!container) return { ok: false, error: 'prompt_box_not_found' };

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

        const allButtons = Array.from(container.querySelectorAll(genBtnSelectors.join(', ')));
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

    // Script kiểm tra trực tiếp: spinner, generating card, error toast/snackbar và trạng thái nút Generate
    const checkEffectJs = `
      (function() {
        function isVisible(el) {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }

        // 1. Quét Spinner / Progress Bar
        const spinners = Array.from(document.querySelectorAll(
          'flow-loading-indicator, flow-progress-bar, mat-progress-spinner, mat-spinner, .generation-in-progress, [role="progressbar"], .loading-spinner, flow-generating-card'
        )).filter(isVisible);
        const hasSpinner = spinners.length > 0;

        // 2. Quét Generating Media Cards
        const cards = Array.from(document.querySelectorAll('flow-media-card, flow-image-card, flow-card, flow-chat-item'));
        const hasGeneratingCard = cards.some(c => {
          const state = c.getAttribute('state') || '';
          const cls = c.className || '';
          return state.includes('generating') || cls.includes('generating') || Boolean(c.querySelector('mat-progress-spinner, [role="progressbar"], flow-loading-indicator'));
        });

        // 3. Quét Error Toast / Snackbar / Alert thông báo bị từ chối
        const toastSelectors = [
          '.mat-mdc-snack-bar-label',
          'mat-snack-bar-container',
          '.mat-mdc-snack-bar-container',
          '[role="alert"]',
          '[role="alertdialog"]',
          '.error-toast',
          '.flow-error-toast',
          '.flow-error-banner',
          'flow-toast',
          '.cdk-overlay-pane mat-snack-bar-container',
          '.cdk-overlay-pane .error',
          '.cdk-overlay-pane [class*="error"]',
          'div[class*="snack-bar"]',
          'div[class*="toast"][class*="error"]'
        ];

        let toastText = '';
        let hasToast = false;
        let toastSelector = '';

        for (const sel of toastSelectors) {
          const els = Array.from(document.querySelectorAll(sel)).filter(isVisible);
          for (const el of els) {
            const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
            if (text.length > 0 && text.length < 500) {
              hasToast = true;
              toastText = text.replace(/\\s+/g, ' ');
              toastSelector = sel;
              break;
            }
          }
          if (hasToast) break;
        }

        // 4. Chẩn đoán trạng thái nút Generate
        const box = document.querySelector('flow-prompt-box') || document;
        const genBtn = box.querySelector('button.generate-icon-button, flow-generate-icon-button button, button[type="submit"]');
        const btnDiag = genBtn ? {
          found: true,
          disabled: Boolean(genBtn.disabled || genBtn.getAttribute('aria-disabled') === 'true' || genBtn.classList.contains('mat-mdc-button-disabled')),
          ariaDisabled: genBtn.getAttribute('aria-disabled'),
          label: (genBtn.getAttribute('aria-label') || genBtn.innerText || '').trim(),
          className: genBtn.className,
        } : { found: false, disabled: true };

        return {
          hasSpinner,
          hasGeneratingCard,
          active: hasSpinner || hasGeneratingCard,
          toast: {
            found: hasToast,
            text: toastText,
            selector: toastSelector
          },
          btnDiag
        };
      })()
    `;

    // Lấy baseline toast trước khi click để chỉ bắt toast MỚI xuất hiện sau khi click
    const initialStatus = await safeExecuteJs<any>(ctx.win, checkEffectJs, 1500);
    const baselineToastText = initialStatus?.toast?.text || '';

    const maxAttempts = 3; // 1 lần chính + tối đa 2 lần retry
    let clickConfirmed = false;
    let rejected = false;
    let rejectedReason = '';
    let lastCheckResult: any = null;
    let lastClickCoords: any = null;
    let finalAttempt = 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (ctx.isCancelled?.()) break;
      finalAttempt = attempt;

      // =========================================================================
      // ĐIỂM 2: SINGLE CHECK NGAY TRƯỚC MỖI LẦN RETRY CLICK (TRÁNH DOUBLE-SUBMIT)
      // =========================================================================
      if (attempt > 1) {
        console.log(
          `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🔍 [DOUBLE-SUBMIT GUARD] Kiểm tra nhanh trước retry click lần ${attempt}...`
        );
        const preRetryCheck = await safeExecuteJs<any>(ctx.win, checkEffectJs, 1500);
        if (preRetryCheck?.hasSpinner || preRetryCheck?.hasGeneratingCard) {
          console.log(
            `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🛡️ [DOUBLE-SUBMIT GUARD] Huỷ retry click lần ${attempt} vì phát hiện generate ĐÃ BẮT ĐẦU Ở PHÚT CHÓT từ lần click trước! (hasSpinner=${preRetryCheck.hasSpinner}, hasGeneratingCard=${preRetryCheck.hasGeneratingCard}). Chuyển thẳng sang WAIT_FOR_GENERATION.`
          );
          clickConfirmed = true;
          ctx.generateClickedAt = Date.now();
          ctx.generationState = 'GENERATING';
          lastCheckResult = preRetryCheck;
          break;
        }
      }

      console.log(
        `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🖱️ [CLICK_GENERATE] Lần click ${attempt}/${maxAttempts}...`
      );

      // 2a. Tính toạ độ tức thời của nút Generate
      const clickInfo = await safeExecuteJs<any>(ctx.win, freshCoordJs, 2000);
      if (!clickInfo?.ok || !clickInfo.coords) {
        console.warn(
          `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ⚠️ Không tính được toạ độ nút Generate ở lần click ${attempt}:`,
          clickInfo
        );
      } else {
        lastClickCoords = clickInfo.coords;

        // 2b. Gửi sự kiện chuột native (mouseDown + mouseUp)
        if (!ctx.win.isDestroyed()) {
          ctx.win.webContents.sendInputEvent({
            type: 'mouseDown',
            x: clickInfo.coords.x,
            y: clickInfo.coords.y,
            button: 'left',
            clickCount: 1,
          });
          await new Promise((r) => setTimeout(r, 60));
          ctx.win.webContents.sendInputEvent({
            type: 'mouseUp',
            x: clickInfo.coords.x,
            y: clickInfo.coords.y,
            button: 'left',
            clickCount: 1,
          });

          // 2c. Kích hoạt DOM click bổ trợ trên nút Generate
          await safeExecuteJs(
            ctx.win,
            `(function() {
              try {
                const box = document.querySelector('flow-prompt-box');
                if (box) {
                  const b = box.querySelector('button.generate-icon-button, flow-generate-icon-button button, button[type="submit"]');
                  if (b) b.click();
                }
              } catch {}
            })()`,
            1000
          );

          // 2d. Gửi bổ trợ Enter native nếu là lần retry thứ 2 trở lên
          if (attempt > 1) {
            try {
              ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
              await new Promise((r) => setTimeout(r, 50));
              ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
            } catch {}
          }
        }
      }

      ctx.nativeClicksCount = (ctx.nativeClicksCount || 0) + 1;

      // =========================================================================
      // ĐIỂM 1: POLL NGẮN XÁC NHẬN TÁC DỤNG & PHÁT HIỆN LỖI TỪ CHỐI (TOAST/SNACKBAR)
      // =========================================================================
      const pollStart = Date.now();
      const maxPollMs = 3500;
      let hasEffect = false;

      while (Date.now() - pollStart < maxPollMs) {
        await new Promise((r) => setTimeout(r, 300));
        if (ctx.isCancelled?.()) break;

        const checkRes = await safeExecuteJs<any>(ctx.win, checkEffectJs, 1500);
        lastCheckResult = checkRes;

        // 1. Kiểm tra nếu có spinner hoặc generating card -> THÀNH CÔNG
        if (checkRes?.hasSpinner || checkRes?.hasGeneratingCard) {
          hasEffect = true;
          console.log(
            `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🎯 CLICK_GENERATE ĐÃ CÓ TÁC DỤNG sau ${Date.now() - pollStart}ms (hasSpinner=${checkRes.hasSpinner}, hasGeneratingCard=${checkRes.hasGeneratingCard})!`
          );
          break;
        }

        // 2. Kiểm tra nếu xuất hiện Error Toast / Snackbar mới xuất hiện sau khi click -> BỊ TỪ CHỐI
        if (checkRes?.toast?.found && checkRes.toast.text !== baselineToastText) {
          rejected = true;
          rejectedReason = checkRes.toast.text;
          console.error(
            `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🛑 CLICK_GENERATE_REJECTED: Google Flow hiển thị thông báo lỗi từ chối sau khi click: "${rejectedReason}" (selector: ${checkRes.toast.selector}). Dừng ngay, KHÔNG retry click!`
          );
          break;
        }
      }

      // Nếu phát hiện bị từ chối -> Thoát ngay vòng lặp retry, KHÔNG retry click thêm!
      if (rejected) {
        break;
      }

      if (hasEffect) {
        clickConfirmed = true;
        ctx.generateClickedAt = Date.now();
        ctx.generationState = 'GENERATING';
        break;
      } else {
        console.warn(
          `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ⚠️ Sau lần click ${attempt}/${maxAttempts}: KHÔNG phát hiện spinner, generating card hay thông báo từ chối.`
        );
        if (attempt < maxAttempts) {
          console.log(
            `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🔄 Sẽ retry click Generate (lần ${attempt + 1}/${maxAttempts}) sau 500ms...`
          );
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    // =========================================================================
    // XỬ LÝ KẾT QUẢ CUỐI CÙNG
    // =========================================================================

    // Tình huống 1: Bị Google Flow từ chối (CLICK_GENERATE_REJECTED) -> Lỗi nghiệp vụ, dừng ngay
    if (rejected) {
      ctx.generationState = 'FAILED';
      return {
        ok: false,
        error: 'CLICK_GENERATE_REJECTED',
        errorDetail: `CLICK_GENERATE_REJECTED: Google Flow đã từ chối yêu cầu tạo ảnh. Thông báo lỗi: "${rejectedReason}".`,
        data: {
          rejected: true,
          reason: rejectedReason,
          attempts: finalAttempt,
          lastCheckResult,
          coords: lastClickCoords,
        }
      };
    }

    // Tình huống 2: Đã click tối đa số lần nhưng không có phản hồi (CLICK_GENERATE_NO_EFFECT) -> Lỗi kỹ thuật DOM
    if (!clickConfirmed) {
      const btnDiag = lastCheckResult?.btnDiag || {};
      const possibleReason = btnDiag.found
        ? (btnDiag.disabled
            ? 'Nút Generate vẫn đang bị disabled trong logic nội bộ của Google Flow'
            : 'Nút Generate không phản hồi sự kiện click (có thể bị che bởi overlay ẩn hoặc listener bị hủy)')
        : 'Không tìm thấy phần tử nút Generate trong container flow-prompt-box';

      console.error(
        `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ❌ CLICK_GENERATE_NO_EFFECT: Đã click ${maxAttempts} lần nhưng không có tác dụng. Lý do khả dĩ: ${possibleReason}. Trạng thái nút:`,
        btnDiag
      );

      ctx.generationState = 'FAILED';
      return {
        ok: false,
        error: 'CLICK_GENERATE_NO_EFFECT',
        errorDetail: `CLICK_GENERATE_NO_EFFECT: Đã click Generate ${maxAttempts} lần (1 lần chính + 2 lần retry) nhưng Google Flow không bắt đầu sinh (hasSpinner=false, hasGeneratingCard=false). Lý do khả dĩ: ${possibleReason}. Chi tiết nút: ${JSON.stringify(btnDiag)}`,
        data: {
          success: false,
          attempts: maxAttempts,
          lastCheckResult,
          coords: lastClickCoords,
        }
      };
    }

    // Tình huống 3: Click thành công, đã có spinner hoặc card
    return {
      ok: true,
      data: {
        success: true,
        attempts: ctx.nativeClicksCount,
        lastCheckResult,
        coords: lastClickCoords,
      }
    };
  },

  async verify(ctx: FlowStateContext, res: ActionResult): Promise<VerifyResult> {
    if (res.data?.skipped) {
      return {
        ok: true,
        criteria: {
          skipped: true,
          reason: res.data.reason,
          clickedAt: ctx.generateClickedAt,
        },
      };
    }

    if (res.data?.rejected) {
      return {
        ok: false,
        criteria: {
          rejected: true,
          reason: res.data.reason,
        },
        reason: `CLICK_GENERATE_REJECTED: ${res.data.reason}`,
      };
    }

    const ok = Boolean(res.ok && res.data?.success);
    return {
      ok,
      criteria: {
        clickConfirmed: ok,
        hasSpinner: Boolean(res.data?.lastCheckResult?.hasSpinner),
        hasGeneratingCard: Boolean(res.data?.lastCheckResult?.hasGeneratingCard),
        attempts: res.data?.attempts || 1,
        coords: res.data?.coords || null,
      },
      reason: ok ? undefined : (res.errorDetail || 'CLICK_GENERATE_NO_EFFECT: Không kích hoạt được quá trình sinh ảnh sau các lần click'),
    };
  },

  async exit(): Promise<void> {},
};

/**
 * STATE 15: VERIFY_GENERATION_STARTED
 * BẮT BUỘC: Xác nhận bằng chứng trực tiếp (spinner hoặc generating card) rằng Flow đang tạo ảnh
 */
export const VerifyGenerationStartedState: FlowAutomationState = {
  name: 'VERIFY_GENERATION_STARTED',
  timeoutMs: 12000,

  async enter(ctx: FlowStateContext): Promise<void> {
    // Tự động xác nhận quyền của Creative Agent nếu có popup xuất hiện
    const agentCheckInit = await ctx.sessionMgr.autoConfirmAgentPermission(ctx.win);
    if (agentCheckInit.startsWith('agent_error:')) {
      throw new Error(`agent_error: ${agentCheckInit}`);
    }
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const checkStartedJs = `
      (function() {
        function isVisible(el) {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }

        const spinners = Array.from(document.querySelectorAll(
          'flow-loading-indicator, flow-progress-bar, mat-progress-spinner, mat-spinner, .generation-in-progress, [role="progressbar"], .loading-spinner, flow-generating-card'
        )).filter(isVisible);
        const hasSpinner = spinners.length > 0;

        const cards = Array.from(document.querySelectorAll('flow-media-card, flow-image-card, flow-card, flow-chat-item'));
        const hasGeneratingCard = cards.some(c => {
          const state = c.getAttribute('state') || '';
          const cls = c.className || '';
          return state.includes('generating') || cls.includes('generating') || Boolean(c.querySelector('mat-progress-spinner, [role="progressbar"], flow-loading-indicator'));
        });

        return {
          hasSpinner,
          hasGeneratingCard,
          active: hasSpinner || hasGeneratingCard
        };
      })()
    `;

    // Kiểm tra trực tiếp bằng chứng sinh ảnh (hasSpinner hoặc hasGeneratingCard)
    let status = await safeExecuteJs<any>(ctx.win, checkStartedJs, 1500);
    let started = Boolean(status?.hasSpinner || status?.hasGeneratingCard);

    // Nếu chưa thấy ngay, poll thêm tối đa 3s (mỗi 300ms)
    if (!started) {
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 300));
        if (ctx.isCancelled?.()) break;
        status = await safeExecuteJs<any>(ctx.win, checkStartedJs, 1500);
        if (status?.hasSpinner || status?.hasGeneratingCard) {
          started = true;
          break;
        }
      }
    }

    ctx.generationState = started ? 'GENERATING' : 'FAILED';

    if (!started) {
      return {
        ok: false,
        error: 'CLICK_GENERATE_NO_EFFECT',
        errorDetail: 'VERIFY_GENERATION_STARTED: Không phát hiện spinner hoặc generating card nào sau khi click Generate (CLICK_GENERATE_NO_EFFECT).',
        data: status,
      };
    }

    return { ok: true, data: status };
  },

  async verify(ctx: FlowStateContext, res: ActionResult): Promise<VerifyResult> {
    const ok = Boolean(res.ok && (res.data?.hasSpinner || res.data?.hasGeneratingCard));
    return {
      ok,
      criteria: {
        generationStarted: ok,
        hasSpinner: Boolean(res.data?.hasSpinner),
        hasGeneratingCard: Boolean(res.data?.hasGeneratingCard),
      },
      reason: ok ? undefined : 'CLICK_GENERATE_NO_EFFECT: Cả spinner và generating card đều không xuất hiện sau khi click Generate',
    };
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

      const refTime = ctx.generateClickedAt || (ctx.idempotencyDetectedAt ? ctx.idempotencyDetectedAt - 5000 : 0);
      const elapsedSinceClick = refTime ? Date.now() - refTime : 6000;
      const minImageTimeGate = 4000; // Tối thiểu 4s mới chấp nhận ảnh thật

      const domResult = await safeExecuteJs<any>(ctx.win, pollDomImageJs, 3000);
      const foundUrl =
        (elapsedSinceClick >= minImageTimeGate && ctx.capturedMediaUrl && !ctx.baselineUrls.has(ctx.capturedMediaUrl) ? ctx.capturedMediaUrl : null) ||
        (elapsedSinceClick >= minImageTimeGate && domResult?.type === 'http' && !ctx.baselineUrls.has(domResult.imageUrl) ? domResult.imageUrl : null);

      if (foundUrl) {
        ctx.capturedMediaUrl = foundUrl;
        return { ok: true, data: { imageUrl: foundUrl, elapsedSec: Math.round(elapsedSinceClick / 1000) } };
      }

      if (domResult?.type === 'blob' && domResult?.base64Data && elapsedSinceClick >= minImageTimeGate) {
        ctx.capturedBase64 = domResult.base64Data;
        return { ok: true, data: { base64Data: domResult.base64Data, elapsedSec: Math.round(elapsedSinceClick / 1000) } };
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const elapsed = (attempt + 1) * (pollIntervalMs / 1000);
      const pct = Math.min(85, Math.round(35 + (elapsed / maxWaitSeconds) * 50));
      ctx.onProgress?.(pct, `Google Flow đang xử lý ảnh (${Math.round(elapsed)}s / ${maxWaitSeconds}s)...`);
    }

    return { ok: false, error: 'generation_timeout', errorDetail: 'Quá thời gian chờ ảnh từ Google Flow.' };
  },

  async verify(ctx: FlowStateContext, res: ActionResult): Promise<VerifyResult> {
    const hasMedia = Boolean(res.ok && (ctx.capturedMediaUrl || ctx.capturedBase64));
    return {
      ok: hasMedia,
      criteria: {
        mediaCaptured: hasMedia,
        mediaType: ctx.capturedMediaUrl ? 'URL' : 'BASE64',
        urlPreview: ctx.capturedMediaUrl ? ctx.capturedMediaUrl.slice(0, 70) + '...' : undefined,
        base64Length: ctx.capturedBase64 ? ctx.capturedBase64.length : undefined,
      },
      reason: hasMedia ? undefined : 'Không thu thập được ảnh kết quả hợp lệ sau thời gian chờ',
    };
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

  async verify(ctx: FlowStateContext): Promise<VerifyResult> {
    const isCompleted = ctx.generationState === 'COMPLETED';
    const hasMedia = Boolean(ctx.capturedMediaUrl || ctx.capturedBase64);
    const ok = isCompleted && hasMedia;
    return {
      ok,
      criteria: {
        generationState: ctx.generationState,
        hasResultUrl: Boolean(ctx.capturedMediaUrl),
        hasResultBase64: Boolean(ctx.capturedBase64),
      },
      reason: ok ? undefined : 'Trạng thái thế hệ không phải COMPLETED hoặc dữ liệu ảnh rỗng',
    };
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

  async verify(ctx: FlowStateContext): Promise<VerifyResult> {
    const hasOutput = Boolean(ctx.result?.imageUrl || ctx.result?.base64Data);
    return {
      ok: hasOutput,
      criteria: {
        outputExtracted: hasOutput,
        hasImageUrl: Boolean(ctx.result?.imageUrl),
        base64Length: ctx.result?.base64Data ? ctx.result.base64Data.length : 0,
        projectId: ctx.result?.projectId || ctx.activeProjectId || 'unknown',
      },
      reason: hasOutput ? undefined : 'Không trích xuất được ImageUrl hoặc Base64 từ kết quả sinh',
    };
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
  ConfigureOptionsState,
  FindPromptInputState,
  HandleImageReferenceState,
  EnterPromptState,
  CaptureBaselineState,
  CheckIdempotencyBeforeGenerateState,
  FindGenerateButtonState,
  VerifyGenerateButtonState,
  ClickGenerateState,
  VerifyGenerationStartedState,
  WaitForGenerationState,
  VerifyGenerationCompletedState,
  ExtractOutputState,
];
