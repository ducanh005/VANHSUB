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
import { FlowFileInputInjector, ensureLocalImageFile, shortenForLog } from '../FlowFileInputInjector';
import { getFlowRpcClient } from '../rpc';

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
      ctx.isCancelled,
      ctx.targetProjectName
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

    // 1. Quét các thẻ ảnh hiện có trên Canvas / Thư viện Media
    const scanTilesJs = `
      (function() {
        function isVisible(el) {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }

        const tiles = Array.from(document.querySelectorAll(
          'flow-image-tile, flow-media-card, img.image, .tile-container img, [class*="tile"] img'
        )).filter(isVisible);

        const items = tiles.map(t => {
          const img = t.tagName === 'IMG' ? t : t.querySelector('img');
          const src = img ? (img.currentSrc || img.src || '') : '';
          const alt = img ? (img.alt || '') : '';
          const isStarter = src.includes('logo.png') || alt.includes('logo');
          const isValidMedia = Boolean(src && !isStarter && (src.includes('googleusercontent.com') || src.includes('flow-content.google') || src.startsWith('blob:')));
          return {
            src,
            alt,
            isStarter,
            isValidMedia
          };
        });

        const validMedia = items.filter(i => i.isValidMedia);
        return {
          totalTiles: tiles.length,
          validMediaCount: validMedia.length,
          validUrls: validMedia.map(m => m.src),
          items: validMedia
        };
      })()
    `;
    const tileScan = await safeExecuteJs<any>(ctx.win, scanTilesJs, 2000);

    // 1a. Cảnh báo nếu phát hiện nhiều ảnh trên canvas (nguy cơ thừa/trùng lặp do retry)
    if (tileScan?.totalTiles && tileScan.totalTiles > 1) {
      console.warn(
        `[FlowImageState] ⚠️ CẢNH BÁO: Phát hiện ${tileScan.totalTiles} thẻ ảnh trên canvas dự án. Nếu có ảnh sinh thừa do các lần retry trước, người dùng nên kiểm tra và xóa bớt ảnh thừa trên Google Flow để tiết kiệm credit.`
      );
    }

    // 1b. [RETRY RECOVERY] CHỈ KÍCH HOẠT KHI:
    // 1. Thực sự là lần retry (retryIndex > 0 hoặc token số cuối cùng > 0). TUYỆT ĐỐI KHÔNG kích hoạt ở attempt 0 (lần chạy đầu).
    // 2. Thẻ ảnh trên canvas phải là ẢNH MỚI XUẤT HIỆN SAU KHI SHOT NÀY BẮT ĐẦU (không nằm trong ctx.shotBaselineUrls).
    // 3. Ảnh đã có sẵn từ các shot trước đó (nằm trong shotBaselineUrls) TUYỆT ĐỐI KHÔNG được coi là kết quả của shot hiện tại.
    const attemptStr = String(ctx.generationAttemptId || '0');
    const lastToken = attemptStr.split('_').pop() || '0';
    const retryFromId = parseInt(lastToken, 10);
    const retryCount = ctx.retryIndex !== undefined ? ctx.retryIndex : (!isNaN(retryFromId) ? retryFromId : 0);
    const isRetryAttempt = retryCount > 0;

    const shotBaseline = ctx.shotBaselineUrls || new Set<string>();

    if (isRetryAttempt && tileScan?.validMediaCount && tileScan.validMediaCount > 0) {
      // Lọc các ảnh mới xuất hiện (chưa từng có trong baseline trước khi shot bắt đầu)
      const validItems: Array<{ src: string; alt: string }> = Array.isArray(tileScan.items) ? tileScan.items : [];
      const newItems = validItems.filter((i) => i.src && !shotBaseline.has(i.src));

      if (newItems.length > 0) {
        // Kiểm tra xem ảnh mới có khớp một phần từ khoá prompt không (nếu alt hiển thị)
        const promptKeywords = (ctx.prompt || '')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, ' ')
          .split(/\s+/)
          .filter((w) => w.length > 3);

        const bestMatch =
          newItems.find((i) => {
            if (!i.alt) return true; // Nếu DOM Flow không set alt thì chấp nhận vì đã qua bộ lọc shotBaseline
            const altLower = i.alt.toLowerCase();
            return promptKeywords.some((kw) => altLower.includes(kw));
          }) || newItems[newItems.length - 1];

        const recoveredUrl = bestMatch.src;
        console.log(
          `[FlowImageState] 🎯 [RETRY RECOVERY] Phát hiện ảnh mới (${recoveredUrl.slice(0, 80)}...) xuất hiện sau khi shot bắt đầu và không nằm trong baseline (${shotBaseline.size} ảnh cũ)! Bỏ qua tạo mới, chuyển thẳng sang EXTRACT_OUTPUT.`
        );
        ctx.capturedMediaUrl = recoveredUrl;
        ctx.generationState = 'COMPLETED';
        return {
          ok: true,
          skipToState: 'EXTRACT_OUTPUT',
          data: { recovered: true, imageUrl: recoveredUrl, projectId: ctx.activeProjectId },
        };
      } else {
        console.log(
          `[FlowImageState] ℹ️ [RETRY RECOVERY] Là lần retry thứ ${retryCount}, nhưng toàn bộ ${tileScan.validMediaCount} ảnh trên canvas đều đã có sẵn từ trước khi shot bắt đầu (trùng baseline). Tiếp tục quy trình tạo ảnh mới...`
        );
      }
    }

    // 2. Kiểm tra nếu ô nhập Prompt chính trên Canvas (/project/<id>) đã sẵn sàng
    // Ưu tiên tạo ảnh trên Canvas trắng thay vì ép mở Image Editor (/edit/<id>) của ảnh cũ
    const checkCanvasPromptJs = `
      (function() {
        const pb = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container');
        const pm = document.querySelector('.ProseMirror, [contenteditable="true"]:not([contenteditable="false"])');
        return Boolean(pb && pm);
      })()
    `;
    const hasCanvasPrompt = await safeExecuteJs<boolean>(ctx.win, checkCanvasPromptJs, 1500);
    if (hasCanvasPrompt) {
      console.log('[FlowImageState] ✅ Không gian làm việc dự án sẵn sàng với khung Prompt chính (Canvas mode).');
      return { ok: true, data: { projectId: ctx.activeProjectId, mode: 'canvas' } };
    }

    // 3. Nếu chưa có Prompt Box trên Canvas, kiểm tra xem có thể vào Image Editor qua thẻ ảnh không
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
          return { ok: true, data: { projectId: ctx.activeProjectId, mode: 'edit' } };
        }
      }
    }

    // 4. Nếu chưa có thẻ ảnh nào (dự án mới hoặc trống): Tải ảnh lên theo quy trình Upload cục bộ
    ctx.onProgress?.(13, 'Đang nạp ảnh từ đĩa cục bộ lên Google Flow...');
    const rawStarter = ctx.referenceImagePath || ctx.initFrameUrl;
    let localImagePath = ensureLocalImageFile(rawStarter, 'starter_image');

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
                return { ok: true, data: { projectId: ctx.activeProjectId, mode: 'edit' } };
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

    let findRes = await FlowElementFinder.find(ctx.win, FlowElementFinder.getPromptInputSpec());

    // Nếu phần tử tạm thời bị che bởi tooltip / nhãn credit, tự động cứu hộ trước khi báo lỗi
    if (!findRes.found && (findRes.error === 'element_obscured' || (findRes.errorDetail || '').includes('che'))) {
      console.warn(`[FlowImageState] ⚠️ [FIND_PROMPT_INPUT] Prompt input bị che: ${findRes.errorDetail}. Đang kích hoạt cứu hộ tooltip...`);

      // Cách a: Di chuột ra toạ độ xa (10, 10) để kích hoạt tooltip Material Design tự ẩn
      try {
        ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 10 });
      } catch {}

      // Cách b: Chờ 400ms và thử quét lại
      await new Promise((r) => setTimeout(r, 400));
      findRes = await FlowElementFinder.find(ctx.win, FlowElementFinder.getPromptInputSpec());

      // Cách c: Nếu vẫn bị che, kiểm tra xem có modal/backdrop thật sự chặn không
      if (!findRes.found && (findRes.error === 'element_obscured' || (findRes.errorDetail || '').includes('che'))) {
        const checkBackdropJs = `
          (function() {
            const bd = document.querySelector('.cdk-overlay-backdrop, mat-dialog-container, .modal-backdrop');
            return Boolean(bd);
          })()
        `;
        const hasTrueModal = await safeExecuteJs<boolean>(ctx.win, checkBackdropJs, 1000);
        if (!hasTrueModal) {
          // Chỉ là tooltip/label nổi (như credit-cost-label), chờ thêm 500ms rồi thử lại lần cuối
          await new Promise((r) => setTimeout(r, 500));
          findRes = await FlowElementFinder.find(ctx.win, FlowElementFinder.getPromptInputSpec());
        }
      }
    }

    if (!findRes.found || !findRes.selectedCandidate) {
      // Fallback cuối: Nếu chỉ bị che bởi credit-cost-label hoặc tooltip nhưng ProseMirror vẫn focus được
      const emergencyFocusJs = `
        (function() {
          const pm = document.querySelector('flow-prompt-box .ProseMirror, .prosemirror-editor .ProseMirror, .ProseMirror, [contenteditable="true"]');
          if (pm) {
            pm.focus();
            const r = pm.getBoundingClientRect();
            return {
              ok: true,
              selector: 'flow-prompt-box .ProseMirror',
              coords: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
            };
          }
          return { ok: false };
        })()
      `;
      const emRes = await safeExecuteJs<any>(ctx.win, emergencyFocusJs, 1000);
      if (emRes?.ok) {
        console.log('[FlowImageState] ℹ️ Đã focus trực tiếp vào ProseMirror qua DOM bypass overlay tooltip.');
        return {
          ok: true,
          data: {
            strategy: 'DOM_EMERGENCY_FOCUS',
            confidence: 70,
            selector: emRes.selector,
            coords: emRes.coords,
          }
        };
      }

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
    const rawRef = ctx.referenceImagePath || ctx.initFrameUrl;
    if (rawRef) {
      const resolved = ensureLocalImageFile(rawRef, 'character_ref');
      if (resolved) {
        ctx.referenceImagePath = resolved;
      }
      const fileName = resolved ? path.basename(resolved) : shortenForLog(rawRef, 30);
      ctx.onProgress?.(18, `Đang nạp ảnh tham chiếu cục bộ "${fileName}" vào Google Flow...`);
    }
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    const rawRef = ctx.referenceImagePath || ctx.initFrameUrl;
    if (!rawRef) {
      return { ok: true, data: { hasRefImage: false, attachmentConfirmed: true, uploadMethodUsed: 'none' } };
    }

    // Tự động kiểm tra và cứu hộ nếu nhận được Base64 hoặc URL chưa resolve
    const resolvedPath = ensureLocalImageFile(rawRef, 'character_ref');
    if (!resolvedPath || !fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).size === 0) {
      const displayPath = shortenForLog(resolvedPath || rawRef, 100);
      console.error(`[FlowImageState] ❌ File ảnh tham chiếu không tồn tại trên đĩa hoặc rỗng: "${displayPath}"`);
      return {
        ok: false,
        error: 'IMAGE_REFERENCE_ATTACH_FAILED',
        errorDetail: `IMAGE_REFERENCE_ATTACH_FAILED: File ảnh tham chiếu không tồn tại trên đĩa hoặc rỗng: "${displayPath}"`,
        data: { hasRefImage: true, attachmentConfirmed: false, fileName: path.basename(displayPath), localPath: displayPath }
      };
    }

    const localPath = resolvedPath;
    ctx.referenceImagePath = localPath;

    const fileName = path.basename(localPath);
    const refLabel = fileName.toLowerCase().includes('background') ? 'background_ref' : 'character_ref';
    const fileSizeKb = (fs.statSync(localPath).size / 1024).toFixed(1);
    console.log(`[FlowImageState] 🎯 [HANDLE_IMAGE_REFERENCE] Chuẩn bị nạp [ẢNH THAM CHIẾU CỤC BỘ - ${refLabel}]: "${localPath}" (${fileSizeKb} KB)...`);

    // Selector nhận diện chip ảnh tham chiếu chuẩn xác 100% theo DOM Google Flow:
    // <button class="chip-container" aria-label="Thành phần"><div class="chip-image-wrapper"><img class="chip-image" src="..."></div></button>
    const checkExistingChipJs = `
      (function() {
        const primarySel = '.chip-container[aria-label="Thành phần"] img.chip-image, flow-ingredient-bar .chip-container[aria-label="Thành phần"] img.chip-image';
        const primaryEl = document.querySelector(primarySel);
        if (primaryEl) {
          const r = primaryEl.getBoundingClientRect();
          const src = primaryEl.getAttribute('src') || '';
          if (r && r.width > 0 && r.height > 0 && src && src.length > 5) {
            return { hasChip: true, selector: primarySel, src };
          }
        }

        // Secondary check: container chip có aria-label "Thành phần" và chứa thẻ img có src hợp lệ
        const containerSel = 'flow-ingredient-bar .chip-container[aria-label="Thành phần"], .chip-container[aria-label="Thành phần"]';
        const container = document.querySelector(containerSel);
        if (container) {
          const r = container.getBoundingClientRect();
          if (r && r.width > 0 && r.height > 0) {
            const innerImg = container.querySelector('img.chip-image, img');
            const src = innerImg ? (innerImg.getAttribute('src') || '') : '';
            if (src && src.length > 5) {
              return { hasChip: true, selector: containerSel + ' img', src };
            }
          }
        }

        return { hasChip: false, src: '' };
      })()
    `;

    // Helper an toàn đóng popup menu (bấm Escape + click outside) sau khi chọn hoặc upload
    const closeMenuSafe = async () => {
      try {
        await safeExecuteJs(ctx.win, `
          (function() {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            // Click nhẹ vào vùng trung lập ngoài popup để bảo đảm đóng triệt để
            const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container');
            if (promptBox) {
              promptBox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            }
          })()
        `, 500);
      } catch {}
    };

    // 1. Kiểm tra nếu chip ảnh đã có sẵn trong prompt box (với xác nhận src hợp lệ)
    const alreadyHasChip = await safeExecuteJs<any>(ctx.win, checkExistingChipJs, 1500);
    if (alreadyHasChip?.hasChip && alreadyHasChip.src) {
      const chipSrc = alreadyHasChip.src;
      const extractId = (u: string) => {
        if (!u) return '';
        const m = u.match(/\/image\/([a-zA-Z0-9_-]+)/);
        return m ? m[1] : '';
      };
      const chipId = extractId(chipSrc);
      const targetId = extractId(ctx.flowAssetUrl || '');

      const isMatch = (targetId && chipId && targetId === chipId) ||
                      (ctx.flowAssetUrl && chipSrc.includes(ctx.flowAssetUrl)) ||
                      (!ctx.flowAssetUrl && chipSrc.includes('flow-content.google/image/')) ||
                      (!ctx.flowAssetUrl && (chipSrc.startsWith('http') || chipSrc.startsWith('blob:') || chipSrc.startsWith('data:')));

      if (isMatch) {
        if (chipSrc && !ctx.flowAssetUrl) {
          ctx.flowAssetUrl = chipSrc;
        }
        console.log(`[FlowImageState] 🎯 [XÁC THỰC CHIP THÀNH CÔNG] Chip xác nhận: ${refLabel} đang dùng URL "${chipSrc}" (selector: ${alreadyHasChip.selector})`);
        return {
          ok: true,
          data: {
            hasRefImage: true,
            attachmentConfirmed: true,
            fileName,
            uploadMethodUsed: 'already_present',
            chipSelector: alreadyHasChip.selector,
            flowAssetUrl: ctx.flowAssetUrl || chipSrc
          }
        };
      }
      console.log(`[FlowImageState] ⚠️ Chip ảnh có sẵn nhưng URL không khớp với asset mong đợi (chipSrc: "${chipSrc.slice(0, 60)}...", expected: "${ctx.flowAssetUrl || 'new'}") → tiến hành chọn lại từ thư viện/upload.`);
    }

    // 2. Tương tác Menu "+" (Thư viện Asset hoặc Upload mới A0)
    try {
      // 2a. Tìm nút "+" (Add Media/Ingredient) trong Prompt Box
      const addBtnJs = `
        (function() {
          // Ưu tiên cao nhất: Nút add-menu-trigger trực tiếp của flow-add-menu trong prompt box
          const promptBoxBtn = document.querySelector(
            'flow-prompt-box button.add-menu-trigger, flow-base-prompt-box button.add-menu-trigger, .bottom-controls button.add-menu-trigger, button.add-menu-trigger[aria-label*="thành phần" i], button.add-menu-trigger'
          );
          if (promptBoxBtn) {
            const r = promptBoxBtn.getBoundingClientRect();
            if (r && r.width > 0 && r.height > 0) {
              return {
                found: true,
                x: Math.round(r.left + r.width / 2),
                y: Math.round(r.top + r.height / 2),
                label: promptBoxBtn.getAttribute('aria-label') || '+',
                selector: 'button.add-menu-trigger'
              };
            }
          }

          const labelPatterns = [
            /thêm.*thành phần/i, /add.*ingredient/i, /thêm ảnh/i, /add image/i,
            /thêm phương tiện/i, /add media/i, /tải ảnh/i, /upload image/i,
            /thêm/i, /add/i
          ];
          const selectors = [
            'flow-prompt-box button',
            'flow-base-prompt-box button',
            '.bottom-controls button',
            'button.add-ingredient',
            'button[class*="add"]',
            'button[class*="ingredient"]',
            'button[aria-label]'
          ];
          for (const sel of selectors) {
            const buttons = Array.from(document.querySelectorAll(sel));
            for (const btn of buttons) {
              // Bỏ qua các nút trong top header/navbar (r.top < 150)
              const r = btn.getBoundingClientRect();
              if (r.top < 150) continue;
              const label = (btn.getAttribute('aria-label') || btn.textContent || '').trim();
              for (const pat of labelPatterns) {
                if (pat.test(label)) {
                  if (r && r.width > 0 && r.height > 0) {
                    return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label, selector: sel };
                  }
                }
              }
            }
          }
          const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box');
          if (promptBox) {
            const btns = Array.from(promptBox.querySelectorAll('button'));
            for (const btn of btns) {
              const txt = (btn.textContent || '').trim();
              const r = btn.getBoundingClientRect();
              if (r && r.width > 0 && r.height > 0 && (txt === '+' || txt === '' || btn.querySelector('mat-icon'))) {
                return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label: txt || '+', selector: 'flow-prompt-box button[fallback]' };
              }
            }
          }
          return { found: false };
        })()
      `;

      const addBtnInfo = await safeExecuteJs<any>(ctx.win, addBtnJs, 2000);
      if (addBtnInfo?.found) {
        console.log(`[FlowImageState] [AddMenu] Tìm thấy nút "+" tại (${addBtnInfo.x}, ${addBtnInfo.y}), label="${addBtnInfo.label}" — đang mở menu...`);
        await safeExecuteJs(ctx.win, `
          (function() {
            const sel = ${JSON.stringify(addBtnInfo.selector)};
            const buttons = Array.from(document.querySelectorAll(sel));
            const labelPats = [/thêm.*thành phần/i, /add.*ingredient/i, /thêm ảnh/i, /add image/i, /thêm phương tiện/i, /add media/i, /tải ảnh/i, /thêm/i, /add/i];
            let target = buttons.find(b => {
              const lbl = (b.getAttribute('aria-label') || b.textContent || '').trim();
              return labelPats.some(p => p.test(lbl));
            });
            if (!target) {
              target = document.elementFromPoint(${addBtnInfo.x}, ${addBtnInfo.y});
            }
            if (target) {
              target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
              target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
              target.click();
            }
          })()
        `, 500);

        // Chờ menu render (flow-add-menu, flow-add-menu-side-nav, .mat-mdc-menu-panel)
        let menuOpened = false;
        for (let t = 0; t < 15; t++) {
          await new Promise((r) => setTimeout(r, 200));
          const menuCheck = await safeExecuteJs<boolean>(ctx.win, `
            !!(document.querySelector('flow-add-menu, flow-add-menu-side-nav, .mat-mdc-menu-panel, mat-menu, [role="menu"], .cdk-overlay-container [role="menuitem"]'))
          `, 500);
          if (menuCheck) { menuOpened = true; break; }
        }

        if (menuOpened) {
          console.log(`[FlowImageState] [AddMenu] Menu flow-add-menu đã mở sẵn sàng.`);

          // NHÁNH 1: TÁI SỬ DỤNG TỪ THƯ VIỆN ASSET (nếu đã có flowAssetUrl)
          if (ctx.flowAssetUrl) {
            console.log(`[FlowImageState] [Thư Viện Asset] Đã có flowAssetUrl="${ctx.flowAssetUrl.slice(0, 60)}..." — tiến hành tìm và chọn lại từ thư viện...`);

            // Chuyển sang tab "Tệp tải lên" nếu có
            const switchTabJs = `
              (function() {
                const sideNav = document.querySelector('flow-add-menu-side-nav, flow-add-menu, .mat-mdc-menu-panel');
                if (!sideNav) return { clicked: false };
                const buttons = Array.from(sideNav.querySelectorAll('button, [role="tab"], [role="menuitem"], .nav-item'));
                for (const b of buttons) {
                  const txt = (b.textContent || b.getAttribute('aria-label') || '').trim();
                  if (/tệp tải lên|uploaded/i.test(txt) && !/tải.*lên.*từ|tải.*nghe nhìn/i.test(txt)) {
                    b.click();
                    return { clicked: true, tab: txt };
                  }
                }
                return { clicked: false };
              })()
            `;
            await safeExecuteJs(ctx.win, switchTabJs, 1000);
            await new Promise((r) => setTimeout(r, 400));

            // Quét các flow-add-menu-asset-item và click thumbnail khớp
            const selectAssetJs = `
              (function() {
                const targetUrl = ${JSON.stringify(ctx.flowAssetUrl || '')};
                const extractId = (u) => {
                  if (!u) return '';
                  const m = u.match(/\\/image\\/([a-zA-Z0-9_-]+)/);
                  return m ? m[1] : '';
                };
                const targetId = extractId(targetUrl);

                const items = Array.from(document.querySelectorAll('flow-add-menu-asset-item, [class*="asset-item"], .asset-card'));
                for (const item of items) {
                  const img = item.querySelector('img.asset-thumbnail-image, img');
                  const src = img?.getAttribute('src') || '';
                  const itemId = extractId(src);

                  const matches = (targetId && itemId && targetId === itemId) ||
                                  (targetUrl && src && (src.includes(targetUrl) || targetUrl.includes(src)));

                  if (matches) {
                    const clickTarget = img || item;
                    const r = clickTarget.getBoundingClientRect();
                    clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                    clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                    clickTarget.click();
                    return { found: true, clicked: true, src, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
                  }
                }
                return { found: false, totalItems: items.length };
              })()
            `;

            const selectRes = await safeExecuteJs<any>(ctx.win, selectAssetJs, 2000);
            if (selectRes?.found) {
              console.log(`[FlowImageState] [Thư Viện Asset] Đã click chọn asset item tại (${selectRes.x}, ${selectRes.y}). Đang gắn chip...`);
              for (let i = 0; i < 10; i++) {
                // Tự động click "Thêm vào câu lệnh" (detail-add-to-prompt-btn) nếu có
                await safeExecuteJs(ctx.win, `
                  (function() {
                    const addBtn = document.querySelector('button.detail-add-to-prompt-btn, button[aria-label*="Thêm vào câu lệnh" i], button.detail-add-btn');
                    if (addBtn) addBtn.click();
                  })()
                `, 500);

                await new Promise((r) => setTimeout(r, 400));
                const chipRes = await safeExecuteJs<any>(ctx.win, checkExistingChipJs, 1000);
                if (chipRes?.hasChip && chipRes.src) {
                  // Đóng popup an toàn SAU KHI chip đã được verify xuất hiện trong DOM
                  await closeMenuSafe();
                  // Hậu kiểm tra (post-close verify): bảo đảm chip vẫn gắn vững chắc sau khi popup đóng
                  await new Promise((r) => setTimeout(r, 200));
                  const postCloseChip = await safeExecuteJs<any>(ctx.win, checkExistingChipJs, 1000);
                  const finalChip = (postCloseChip?.hasChip && postCloseChip.src) ? postCloseChip : chipRes;

                  ctx.flowAssetUrl = finalChip.src;
                  const refLabel = fileName.toLowerCase().includes('background') ? 'background_ref' : 'character_ref';
                  console.log(`[FlowImageState] 🎯 [XÁC THỰC CHIP THÀNH CÔNG] Chip xác nhận: ${refLabel} tái sử dụng từ thư viện với URL "${finalChip.src}" (selector: ${finalChip.selector})`);
                  return {
                    ok: true,
                    data: {
                      hasRefImage: true,
                      attachmentConfirmed: true,
                      fileName,
                      uploadMethodUsed: 'library_select',
                      chipSelector: finalChip.selector,
                      flowAssetUrl: finalChip.src
                    }
                  };
                }
              }
              console.warn('[FlowImageState] [Thư Viện Asset] Đã click asset item nhưng chip chưa xuất hiện sau 3.2s -> fallback sang upload mới A0.');
            } else {
              console.log(`[FlowImageState] ℹ️ [Thư Viện Asset] Không tìm thấy asset khớp flowAssetUrl trong ${selectRes?.totalItems || 0} items -> fallback sang upload mới A0.`);
            }
          }

          // NHÁNH 2: ĐƯỜNG LUỒNG A0 (Upload file mới từ đĩa cứng)
          console.log(`[FlowImageState] [A0] Đang tìm nút "Tải nội dung nghe nhìn lên" / "Tải ảnh lên từ máy tính"...`);
          const clickUploadItemJs = `
            (function() {
              const menuItemPatterns = [
                /tải.*nghe nhìn/i, /tải ảnh lên/i, /tải lên từ máy/i, /^tải lên$/i,
                /upload/i, /upload.*image/i, /upload.*local/i, /from.*computer/i,
                /máy tính/i, /local file/i, /from device/i
              ];
              const itemSelectors = [
                'button.sidebar-upload-btn',
                'button[class*="sidebar-upload"]',
                'flow-add-menu-side-nav button',
                'flow-add-menu button',
                '[role="menuitem"]',
                '.mat-mdc-menu-item',
                'button[mat-menu-item]',
                '.mat-menu-item',
                'mat-menu button'
              ];
              for (const sel of itemSelectors) {
                const items = Array.from(document.querySelectorAll(sel));
                for (const item of items) {
                  const txt = (item.textContent || item.getAttribute('aria-label') || '').trim();
                  if (menuItemPatterns.some(p => p.test(txt))) {
                    const touchTarget = item.querySelector('.mat-mdc-button-touch-target');
                    const clickTarget = touchTarget || item;
                    const r = clickTarget.getBoundingClientRect();
                    clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                    clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                    clickTarget.click();
                    return { clicked: true, text: txt, usedTouchTarget: !!touchTarget, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
                  }
                }
              }
              return { clicked: false };
            })()
          `;

          const clickRes = await safeExecuteJs<any>(ctx.win, clickUploadItemJs, 1500);
          if (clickRes?.clicked) {
            console.log(`[FlowImageState] [A0] Đã click nút upload "${clickRes.text}" tại (${clickRes.x}, ${clickRes.y})`);

            // Chờ input[type="file"] xuất hiện trong DOM (tối đa 3000ms)
            let fileInputReady = false;
            for (let t = 0; t < 10; t++) {
              await new Promise((r) => setTimeout(r, 300));
              const hasInput = await safeExecuteJs<boolean>(ctx.win, `!!document.querySelector('input[type="file"]')`, 500);
              if (hasInput) { fileInputReady = true; break; }
            }

            if (fileInputReady) {
              console.log(`[FlowImageState] [A0] input[type="file"] đã sẵn sàng — tiến hành nạp file "${fileName}" qua CDP...`);
              try {
                const cdpFileInput = await FlowFileInputInjector.injectIntoBrowserWindow(ctx.win, localPath, {
                  inputSelector: 'input[type="file"]'
                });
                if (cdpFileInput.success) {
                  for (let i = 0; i < 8; i++) {
                    await new Promise((r) => setTimeout(r, 400));
                    const chipRes = await safeExecuteJs<any>(ctx.win, checkExistingChipJs, 1000);
                    if (chipRes?.hasChip && chipRes.src) {
                      const detectedAssetUrl = chipRes.src;
                      ctx.flowAssetUrl = detectedAssetUrl;
                      await closeMenuSafe();
                      console.log(`[FlowImageState] 🎯 [XÁC THỰC CHIP THÀNH CÔNG] Chip xác nhận: character_ref đã upload A0 thành công với URL "${detectedAssetUrl}" (selector: ${chipRes.selector})`);
                      return {
                        ok: true,
                        data: {
                          hasRefImage: true,
                          attachmentConfirmed: true,
                          fileName,
                          uploadMethodUsed: 'click_menu',
                          chipSelector: chipRes.selector,
                          flowAssetUrl: detectedAssetUrl
                        }
                      };
                    }
                  }
                  console.warn(`[FlowImageState] [A0] Inject file thành công nhưng chip chưa xuất hiện sau 3.2s.`);
                } else {
                  console.warn(`[FlowImageState] [A0] injectIntoBrowserWindow thất bại.`);
                }
              } catch (injectErr) {
                console.warn('[FlowImageState] [A0] Lỗi inject file:', injectErr);
              }
            } else {
              console.warn(`[FlowImageState] [A0] input[type="file"] không xuất hiện sau 3s dù đã click menu item.`);
            }
          } else {
            console.warn(`[FlowImageState] [A0] Không tìm thấy menu item upload trong menu.`);
          }
        } else {
          console.warn(`[FlowImageState] [A0] Nút "+" đã click nhưng menu không mở sau 3s.`);
        }
      } else {
        console.warn(`[FlowImageState] [A0] Không tìm thấy nút "+" (Add Media/Ingredient) trong prompt box.`);
      }
    } catch (a0Err) {
      console.warn('[FlowImageState] Lỗi không mong đợi trong luồng menu upload:', a0Err);
    }

    // 3. Phương thức A: Thử nạp qua file input nếu có trong DOM (sau khi A0 đã cố mở)
    try {
      const cdpFileInput = await FlowFileInputInjector.injectIntoBrowserWindow(ctx.win, localPath, {
        inputSelector: 'flow-prompt-box input[type="file"], flow-base-prompt-box input[type="file"], input[type="file"]'
      });
      if (cdpFileInput.success) {
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 400));
          const chipRes = await safeExecuteJs<any>(ctx.win, checkExistingChipJs, 1000);
          if (chipRes?.hasChip && chipRes.src) {
            ctx.flowAssetUrl = chipRes.src;
            console.log(`[FlowImageState] 🎯 [XÁC THỰC CHIP THÀNH CÔNG] Chip xác nhận: ${refLabel} xuất hiện sau file input injection với URL "${chipRes.src}" (selector: ${chipRes.selector})`);
            return {
              ok: true,
              data: {
                hasRefImage: true,
                attachmentConfirmed: true,
                fileName,
                uploadMethodUsed: cdpFileInput.methodUsed,
                chipSelector: chipRes.selector,
                flowAssetUrl: chipRes.src
              }
            };
          }
        }
      }
    } catch (e) {
      console.warn('[FlowImageState] File input injection warning:', e);
    }

    // 4. Phương thức B: Drag-drop file bằng CDP trực tiếp vào toạ độ ProseMirror editor
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
          if (chipRes?.hasChip && chipRes.src) {
            ctx.flowAssetUrl = chipRes.src;
            console.log(`[FlowImageState] 🎯 [XÁC THỰC CHIP THÀNH CÔNG] Chip xác nhận: ${refLabel} xuất hiện sau CDP drag-drop vào editor với URL "${chipRes.src}" (selector: ${chipRes.selector})`);
            return {
              ok: true,
              data: {
                hasRefImage: true,
                attachmentConfirmed: true,
                fileName,
                uploadMethodUsed: 'cdp_drag_drop_editor',
                chipSelector: chipRes.selector,
                flowAssetUrl: chipRes.src
              }
            };
          }
        }
      }
    } catch (dragErr) {
      console.warn('[FlowImageState] CDP Drag-drop vào editor lỗi:', dragErr);
    }

    // 5. Phương thức C: Fallback Drag-drop vào viewport center
    try {
      const dropped2 = await FlowFileInputInjector.injectViaCDPDragDrop(ctx.win, localPath, 720, 450);
      if (dropped2) {
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const chipRes = await safeExecuteJs<any>(ctx.win, checkExistingChipJs, 1000);
          if (chipRes?.hasChip && chipRes.src) {
            ctx.flowAssetUrl = chipRes.src;
            console.log(`[FlowImageState] 🎯 [XÁC THỰC CHIP THÀNH CÔNG] Chip xác nhận: ${refLabel} xuất hiện sau fallback drag-drop với URL "${chipRes.src}" (selector: ${chipRes.selector})`);
            return {
              ok: true,
              data: {
                hasRefImage: true,
                attachmentConfirmed: true,
                fileName,
                uploadMethodUsed: 'cdp_drag_drop_fallback',
                chipSelector: chipRes.selector,
                flowAssetUrl: chipRes.src
              }
            };
          }
        }
      }
    } catch {}

    // 6. Phương thức D: Fallback clipboard nativeImage paste vào ProseMirror
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
            ctx.win.webContents.focus();
            ctx.win.webContents.paste();
          }
        } catch (pasteErr) {
          console.warn('[FlowImageState] Cảnh báo paste referenceImagePath:', pasteErr);
        }
      });

      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const chipRes = await safeExecuteJs<any>(ctx.win, checkExistingChipJs, 1000);
        if (chipRes?.hasChip && chipRes.src) {
          ctx.flowAssetUrl = chipRes.src;
          console.log(`[FlowImageState] 🎯 [XÁC THỰC CHIP THÀNH CÔNG] Chip xác nhận: ${refLabel} xuất hiện sau clipboard paste với URL "${chipRes.src}" (selector: ${chipRes.selector})`);
          return {
            ok: true,
            data: {
              hasRefImage: true,
              attachmentConfirmed: true,
              fileName,
              uploadMethodUsed: 'clipboard',
              chipSelector: chipRes.selector,
              flowAssetUrl: chipRes.src
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

    const fileName = refPath.startsWith('data:') ? 'ref_image' : path.basename(refPath);

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

    // Quét lại DOM lần cuối để đảm bảo chip vẫn tồn tại ổn định theo selector chuẩn
    const checkChipJs = `
      (function() {
        const primarySel = '.chip-container[aria-label="Thành phần"] img.chip-image, flow-ingredient-bar .chip-container[aria-label="Thành phần"] img.chip-image';
        const img = document.querySelector(primarySel);
        if (img) {
          const r = img.getBoundingClientRect();
          const src = img.getAttribute('src') || '';
          if (r && r.width > 0 && r.height > 0 && src && src.length > 5) {
            return { hasChip: true, selector: primarySel, src };
          }
        }

        const containerSel = 'flow-ingredient-bar .chip-container[aria-label="Thành phần"], .chip-container[aria-label="Thành phần"]';
        const container = document.querySelector(containerSel);
        if (container) {
          const r = container.getBoundingClientRect();
          if (r && r.width > 0 && r.height > 0) {
            const innerImg = container.querySelector('img.chip-image, img');
            const src = innerImg ? (innerImg.getAttribute('src') || '') : '';
            if (src && src.length > 5) {
              return { hasChip: true, selector: containerSel + ' img', src };
            }
          }
        }

        return { hasChip: false, src: '' };
      })()
    `;
    const res = await safeExecuteJs<any>(ctx.win, checkChipJs, 2000);
    const hasChip = Boolean(res?.hasChip && res.src);

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

    console.log(`[FlowImageState] 🎯 [VERIFY HOÀN TẤT] Chip ảnh tham chiếu "${fileName}" được xác nhận với URL: "${res.src}"`);

    return {
      ok: true,
      criteria: {
        hasRefImage: true,
        uploadMethodUsed: actionRes.data?.uploadMethodUsed || 'unknown',
        fileName,
        attachmentConfirmed: true,
        chipSelector: res?.selector || actionRes.data?.chipSelector || 'chip_detected',
        flowAssetUrl: res.src || actionRes.data?.flowAssetUrl,
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

    // 2. Kích hoạt native focus trên WebContents Electron
    ctx.win.webContents.focus();

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
          function isVisible(el) {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          }

          const triggerSelectors = [
            'button.settings-trigger-button',
            'flow-settings-button button',
            'button[aria-label*="Điều kiện kích hoạt cài đặt" i]',
            'button[aria-label*="settings" i][class*="trigger"]',
            'flow-prompt-box button[aria-label*="cài đặt" i]',
            'button:has(mat-icon[fonticon*="tune"])',
            'button:has(mat-icon[fonticon*="sliders"])',
            'button:has(mat-icon[fonticon*="settings"])'
          ];

          const candidates = Array.from(document.querySelectorAll(triggerSelectors.join(', '))).filter(isVisible);
          // Tuyệt đối loại trừ nút thêm ảnh / add-menu-trigger
          const valid = candidates.filter(b => {
            if (b.classList.contains('add-menu-trigger') || b.closest('.add-menu-trigger')) return false;
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            if (aria.includes('thêm') || aria.includes('add')) return false;
            return true;
          });

          if (valid.length > 0) {
            const trigger = valid[0];
            const rect = trigger.getBoundingClientRect();
            const currentText = (trigger.innerText || trigger.getAttribute('aria-label') || '').trim();
            // NẾU NÚT TRIGGER ĐÃ CHỨA SẴN KEYWORD CỦA MODEL HOẶC ĐÃ Ở CHẾ ĐỘ ẢNH (VÍ DỤ: "🍌 Nano Banana Pro" khớp với "nano" / "banana" / "pro")
            const kw = ${JSON.stringify(modelKeyword.toLowerCase())};
            const isMatch = currentText.toLowerCase().includes(kw) ||
              (kw === 'nano' && (currentText.toLowerCase().includes('banana') || currentText.toLowerCase().includes('imagen')));
            if (isMatch) {
              return {
                alreadySelected: true,
                clicked: false,
                text: currentText,
                coords: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
              };
            }
            trigger.click();
            return {
              clicked: true,
              alreadySelected: false,
              text: currentText,
              coords: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
            };
          }
          return { clicked: false };
        })()
      `;
      const openRes = await safeExecuteJs<any>(ctx.win, openModelPickerJs, 2000);

      if (openRes?.alreadySelected) {
        console.log(
          `[FlowImageState] ✅ Model "${modelKeyword}" đã được cấu hình sẵn trên trigger: "${openRes.text}". Bỏ qua thao tác mở menu!`
        );
        return {
          ok: true,
          data: {
            modelClicked: false,
            alreadySelected: true,
            keyword: modelKeyword,
            selectedModelText: openRes.text
          }
        };
      }

      if (!openRes?.clicked) {
        console.error('[FlowImageState] ❌ Không tìm thấy nút settings trigger để mở menu chọn model!');
        return {
          ok: false,
          error: 'settings_trigger_not_found',
          errorDetail: 'Không tìm thấy nút Settings Trigger để mở menu chọn model trong Google Flow',
          data: { modelClicked: false, keyword: modelKeyword, availableOptions: [] }
        };
      }

      console.log(
        `[FlowImageState] 🎯 [CONFIGURE_OPTIONS] Chuẩn bị bấm nút [SETTINGS TRIGGER] để chọn model tại toạ độ (${openRes.coords?.x}, ${openRes.coords?.y}): "${openRes.text}"`
      );

      // Kiểm tra xem có bị mở nhầm Add Menu (menu thêm cảnh / upload) không
      const checkWrongMenuJs = `
        (function() {
          const items = Array.from(document.querySelectorAll('[role="menuitem"], .mat-mdc-menu-item'));
          return items.some(el => {
            const t = (el.textContent || '').toLowerCase();
            return t.includes('cảnh mới') || t.includes('new scene') || t.includes('tải lên') || t.includes('upload');
          });
        })()
      `;
      const isWrongMenu = await safeExecuteJs<boolean>(ctx.win, checkWrongMenuJs, 1000);
      if (isWrongMenu) {
        console.warn('[FlowImageState] ⚠️ Phát hiện menu Thêm/Upload mở nhầm thay vì menu Settings! Đang nhấn Escape để đóng...');
        try {
          ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
          await new Promise((r) => setTimeout(r, 50));
          ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
          await new Promise((r) => setTimeout(r, 300));
        } catch {}
      }

      // 2a-1. Đồng bộ bên trong Popover: Chuyển sang chế độ Hình ảnh và kiểm tra nút Model
      const popoverSyncJs = `
        (function() {
          const pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
          if (!pane) return { foundPane: false };

          // 1. Kiểm tra và chuyển Toggle "Hình ảnh" nếu đang ở Video
          let modeSwitched = false;
          const toggles = Array.from(pane.querySelectorAll('mat-button-toggle, [role="radio"], button'));
          for (const toggle of toggles) {
            const text = (toggle.innerText || toggle.textContent || '').toLowerCase();
            if (text.includes('hình ảnh') || text.includes('image')) {
              const isChecked = toggle.classList.contains('mat-button-toggle-checked') || toggle.getAttribute('aria-checked') === 'true';
              if (!isChecked) {
                const btn = toggle.tagName === 'BUTTON' ? toggle : (toggle.querySelector('button') || toggle);
                btn.click();
                modeSwitched = true;
              }
              break;
            }
          }

          // 2. Kiểm tra nút chọn model trong Popover
          const modelBtn = pane.querySelector('button[aria-label*="mô hình" i], button[aria-label*="model" i]') ||
            Array.from(pane.querySelectorAll('button')).find(b => {
              const t = (b.innerText || '').toLowerCase();
              return t.includes('banana') || t.includes('imagen') || t.includes('omni') || t.includes('veo');
            });

          const currentModelText = modelBtn ? (modelBtn.innerText || '').trim() : '';
          const kw = ${JSON.stringify(modelKeyword.toLowerCase())};
          const isModelMatched = currentModelText.toLowerCase().includes(kw) ||
            (kw === 'nano' && (currentModelText.toLowerCase().includes('banana') || currentModelText.toLowerCase().includes('imagen')));

          if (isModelMatched) {
            return {
              foundPane: true,
              modeSwitched,
              alreadyMatched: true,
              currentModelText
            };
          }

          // Nếu model chưa match, click nút modelBtn để mở menu options
          if (modelBtn) {
            modelBtn.click();
            return {
              foundPane: true,
              modeSwitched,
              openedDropdown: true,
              currentModelText
            };
          }

          return { foundPane: true, modeSwitched, openedDropdown: false, currentModelText };
        })()
      `;

      const popoverSync = await safeExecuteJs<any>(ctx.win, popoverSyncJs, 2000);
      if (popoverSync?.alreadyMatched) {
        console.log(`[FlowImageState] ✅ Model "${modelKeyword}" đã khớp sẵn trong Settings Popover ("${popoverSync.currentModelText}"). Đang đóng popover...`);
        try {
          ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
          await new Promise((r) => setTimeout(r, 50));
          ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
          await new Promise((r) => setTimeout(r, 200));
        } catch {}
        return {
          ok: true,
          data: {
            modelClicked: false,
            alreadySelected: true,
            keyword: modelKeyword,
            selectedModelText: popoverSync.currentModelText
          }
        };
      }
      if (popoverSync?.modeSwitched) {
        await new Promise((r) => setTimeout(r, 300));
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

      // Nếu hết thời gian chờ mà candidates vẫn = 0 -> Kiểm tra graceful fallback
      if (!menuReady || menuCandidatesCount === 0) {
        // Đóng popover nếu đang mở
        try {
          ctx.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
          await new Promise((r) => setTimeout(r, 50));
          ctx.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
          await new Promise((r) => setTimeout(r, 200));
        } catch {}

        // Kiểm tra xem trigger hiện tại có phải đã ở chế độ ảnh không
        const checkTriggerJs = `
          (function() {
            const trigger = document.querySelector('button.settings-trigger-button');
            const text = (trigger?.innerText || '').toLowerCase();
            return {
              text,
              isImageMode: !text.includes('video') && !text.includes('giây') && !text.includes('720p')
            };
          })()
        `;
        const trigInfo = await safeExecuteJs<any>(ctx.win, checkTriggerJs, 1500);
        if (trigInfo?.isImageMode) {
          console.warn(`[FlowImageState] ⚠️ Menu dropdown không mở nhưng Google Flow đang ở chế độ ảnh ("${trigInfo.text}"). Fallback an toàn và tiếp tục!`);
          return {
            ok: true,
            data: {
              modelClicked: false,
              fallbackDefault: true,
              keyword: modelKeyword,
              selectedModelText: trigInfo.text
            }
          };
        }

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

      // 2e. BƯỚC CHỜ CÓ ĐIỀU KIỆN: Đợi tooltip credit-cost-label (hoặc overlay chi phí credit) biến mất
      // Di chuột ra góc màn hình (10, 10) để kích hoạt tooltip Material Design tự ẩn
      try {
        ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 10 });
      } catch {}

      console.log('[FlowImageState] ⏳ Kiểm tra tooltip chi phí credit tạm thời (.credit-cost-label)...');
      const waitCostStart = Date.now();
      const maxWaitCostMs = 2500;
      let costTooltipGone = false;

      while (Date.now() - waitCostStart < maxWaitCostMs) {
        const checkCostJs = `
          (function() {
            const selectors = [
              '.credit-cost-label',
              '[class*="credit-cost"]',
              '[class*="cost-label"]',
              'span.credit-cost-label',
              '.mat-mdc-tooltip',
              '[role="tooltip"]'
            ];
            for (const sel of selectors) {
              const els = document.querySelectorAll(sel);
              for (const el of els) {
                const r = el.getBoundingClientRect();
                if (r && r.width > 0 && r.height > 0) {
                  return { visible: true, selector: sel, text: (el.textContent || '').trim() };
                }
              }
            }
            return { visible: false };
          })()
        `;
        const costStatus = await safeExecuteJs<any>(ctx.win, checkCostJs, 1000);
        if (!costStatus?.visible) {
          costTooltipGone = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
        if (ctx.isCancelled?.()) break;
      }

      if (costTooltipGone) {
        console.log('[FlowImageState] ✅ Không còn tooltip credit-cost-label che phủ.');
      } else {
        console.warn('[FlowImageState] ⚠️ Hết 2.5s chờ nhưng tooltip credit-cost-label vẫn hiển thị; tiếp tục chuyển sang FIND_PROMPT_INPUT.');
      }

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
    // 1. Xác nhận (a): Hành động click chọn model ở bước EXECUTE đã thực sự xảy ra hoặc đã được chọn sẵn từ trước
    const modelSatisfied = Boolean(res.ok && (res.data?.modelClicked || res.data?.alreadySelected));
    const selectedModelText = res.data?.selectedModelText || '';
    if (!modelSatisfied) {
      return {
        ok: false,
        criteria: {
          modelClicked: false,
          alreadySelected: false,
          selectedModelText: '',
          currentModelText: '',
        },
        reason: `Bước chọn model thất bại: không click được vào bất kỳ model option nào (modelClicked=false, alreadySelected=false, error=${res.errorDetail || res.error || 'candidates=0'})`,
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
        modelClicked: Boolean(res.data?.modelClicked),
        alreadySelected: Boolean(res.data?.alreadySelected),
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

    // Script tính toạ độ tức thời của nút Generate (tìm trong container hoặc fallback toàn document)
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
          'button[aria-label*="Bắt đầu tạo" i]',
          'button[aria-label*="Start generation" i]',
          'button[aria-label*="Tạo ảnh" i]',
          'button[aria-label*="Tạo video" i]',
          'button[aria-label*="Generate image" i]',
          'button[aria-label="Generate"]',
          'button[aria-label*="Generate" i]',
          'button.generate-icon-button',
          'flow-generate-icon-button button',
          'flow-generate-button button',
          'button[aria-label*="tạo" i]',
          'flow-prompt-box button[type="submit"]',
          'flow-base-prompt-box button[type="submit"]',
          '.prompt-box-container button[type="submit"]',
          'button[type="submit"]',
          'button.submit-button'
        ];

        // 1. Thử tìm trong các container tiềm năng
        const container = document.querySelector('flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box');
        let allButtons = [];
        if (container) {
          allButtons = Array.from(container.querySelectorAll(genBtnSelectors.join(', ')));
        }

        // 2. Fallback độc lập: Nếu không có container hoặc không có nút trong container, quét trên toàn document
        if (allButtons.length === 0) {
          allButtons = Array.from(document.querySelectorAll(genBtnSelectors.join(', ')));
        }
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
        const box = document.querySelector('flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box') || document;
        const genBtn = box.querySelector('button.generate-icon-button, flow-generate-icon-button button, button[aria-label*="Bắt đầu tạo" i], button[aria-label*="Start generation" i], button[aria-label*="Tạo ảnh" i], button[aria-label*="Generate" i], button[type="submit"]');
        const btnDiag = genBtn ? {
          found: true,
          disabled: Boolean(genBtn.disabled || genBtn.getAttribute('aria-disabled') === 'true' || genBtn.classList.contains('mat-mdc-button-disabled')),
          ariaDisabled: genBtn.getAttribute('aria-disabled'),
          label: (genBtn.getAttribute('aria-label') || genBtn.innerText || '').trim(),
          className: genBtn.className,
        } : { found: false, disabled: true };

        // 5. Kiểm tra nếu prompt đã submit (làm rỗng input sau khi click)
        const pm = box.querySelector('.ProseMirror, [contenteditable="true"]');
        const promptText = (pm ? (pm.innerText || pm.textContent || '') : '').trim();
        const promptCleared = promptText.length === 0;

        return {
          hasSpinner,
          hasGeneratingCard,
          promptCleared,
          active: hasSpinner || hasGeneratingCard || promptCleared,
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
    const clickLoopStart = Date.now();
    const initialPromptLength = (ctx.prompt || '').trim().length;
    const isVerbose = process.env.FLOW_DEBUG === 'true' || Boolean((ctx as any).verbose);
    const debugLog = (msg: string, ...args: any[]) => {
      if (isVerbose) console.log(msg, ...args);
    };

    // Khoảng chờ ngắn cố định (200ms) NGAY TRƯỚC lần click đầu tiên để Google Flow hoàn tất animation/UI transition
    await new Promise((r) => setTimeout(r, 200));

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (ctx.isCancelled?.()) break;
      finalAttempt = attempt;

      // =========================================================================
      // ĐIỂM 2: SINGLE CHECK NGAY TRƯỚC MỖI LẦN RETRY CLICK (TRÁNH DOUBLE-SUBMIT)
      // =========================================================================
      if (attempt > 1) {
        debugLog(
          `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🔍 [DOUBLE-SUBMIT GUARD] Kiểm tra nhanh trước retry click lần ${attempt}...`
        );
        const preRetryCheck = await safeExecuteJs<any>(ctx.win, checkEffectJs, 1500);
        if (preRetryCheck?.hasSpinner || preRetryCheck?.hasGeneratingCard || (preRetryCheck?.promptCleared && initialPromptLength > 0)) {
          debugLog(
            `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🛡️ [DOUBLE-SUBMIT GUARD] Huỷ retry click lần ${attempt} vì phát hiện generate ĐÃ BẮT ĐẦU Ở PHÚT CHÓT từ lần click trước!`
          );
          clickConfirmed = true;
          ctx.generateClickedAt = Date.now();
          ctx.generationState = 'GENERATING';
          lastCheckResult = preRetryCheck;
          break;
        }
      }

      debugLog(
        `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🖱️ [CLICK_GENERATE] Lần click ${attempt}/${maxAttempts}...`
      );

      // 2a. Tính toạ độ tức thời của nút Generate
      const clickInfo = await safeExecuteJs<any>(ctx.win, freshCoordJs, 2000);
      if (!clickInfo?.ok || !clickInfo.coords) {
        debugLog(
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
                const box = document.querySelector('flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box') || document;
                const b = box.querySelector('button.generate-icon-button, flow-generate-icon-button button, button[aria-label*="Bắt đầu tạo" i], button[aria-label*="Start generation" i], button[aria-label*="Tạo ảnh" i], button[aria-label*="Generate" i], button[type="submit"]');
                if (b) b.click();
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
      const maxPollMs = attempt === 1 ? 5500 : 4000;
      let hasEffect = false;

      while (Date.now() - pollStart < maxPollMs) {
        await new Promise((r) => setTimeout(r, 300));
        if (ctx.isCancelled?.()) break;

        const checkRes = await safeExecuteJs<any>(ctx.win, checkEffectJs, 1500);
        lastCheckResult = checkRes;

        // 1. Kiểm tra nếu có spinner, generating card, hoặc prompt text đã submit (cleared) -> THÀNH CÔNG
        const promptClearedSuccess = Boolean(checkRes?.promptCleared && initialPromptLength > 0);
        if (checkRes?.hasSpinner || checkRes?.hasGeneratingCard || promptClearedSuccess) {
          hasEffect = true;
          debugLog(
            `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🎯 CLICK_GENERATE ĐÃ CÓ TÁC DỤNG sau ${Date.now() - pollStart}ms (hasSpinner=${checkRes.hasSpinner}, hasGeneratingCard=${checkRes.hasGeneratingCard}, promptCleared=${promptClearedSuccess})!`
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
        debugLog(
          `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ⚠️ Sau lần click ${attempt}/${maxAttempts}: KHÔNG phát hiện spinner, generating card hay thông báo từ chối.`
        );
        if (attempt < maxAttempts) {
          debugLog(
            `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🔄 Sẽ retry click Generate (lần ${attempt + 1}/${maxAttempts}) sau 500ms...`
          );
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    // Ghi log 1 dòng tổng kết duy nhất ở mức INFO khi click thành công
    if (clickConfirmed) {
      const elapsedMs = Date.now() - clickLoopStart;
      console.log(
        `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ✅ CLICK_GENERATE thành công sau ${finalAttempt}/${maxAttempts} lần thử (${elapsedMs}ms)`
      );
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

        const box = document.querySelector('flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box') || document;
        const pm = box.querySelector('.ProseMirror, [contenteditable="true"]');
        const promptText = (pm ? (pm.innerText || pm.textContent || '') : '').trim();
        const promptCleared = promptText.length === 0;

        return {
          hasSpinner,
          hasGeneratingCard,
          promptCleared,
          active: hasSpinner || hasGeneratingCard || promptCleared
        };
      })()
    `;

    const initialPromptLength = (ctx.prompt || '').trim().length;

    // Kiểm tra trực tiếp bằng chứng sinh ảnh (hasSpinner, hasGeneratingCard hoặc prompt đã submit rỗng)
    let status = await safeExecuteJs<any>(ctx.win, checkStartedJs, 1500);
    let started = Boolean(status?.hasSpinner || status?.hasGeneratingCard || (status?.promptCleared && initialPromptLength > 0));

    // Nếu chưa thấy ngay, poll thêm tối đa 3s (mỗi 300ms)
    if (!started) {
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 300));
        if (ctx.isCancelled?.()) break;
        status = await safeExecuteJs<any>(ctx.win, checkStartedJs, 1500);
        if (status?.hasSpinner || status?.hasGeneratingCard || (status?.promptCleared && initialPromptLength > 0)) {
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
        errorDetail: 'VERIFY_GENERATION_STARTED: Không phát hiện spinner, generating card hay prompt cleared nào sau khi click Generate (CLICK_GENERATE_NO_EFFECT).',
        data: status,
      };
    }

    return { ok: true, data: status };
  },

  async verify(ctx: FlowStateContext, res: ActionResult): Promise<VerifyResult> {
    const initialPromptLength = (ctx.prompt || '').trim().length;
    const ok = Boolean(res.ok && (res.data?.hasSpinner || res.data?.hasGeneratingCard || (res.data?.promptCleared && initialPromptLength > 0)));
    return {
      ok,
      criteria: {
        generationStarted: ok,
        hasSpinner: Boolean(res.data?.hasSpinner),
        hasGeneratingCard: Boolean(res.data?.hasGeneratingCard),
        promptCleared: Boolean(res.data?.promptCleared),
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
 * STATE RPC: RPC_GENERATE_IMAGE
 * Sinh ảnh trực tiếp qua Google Flow RPC (ogiZ0b) — Kiến trúc Hybrid.
 * Thay thế 11 states DOM tương tác phức tạp (FindPrompt, EnterPrompt, ConfigureOptions,
 * ClickGenerate, WaitForGeneration, v.v.).
 */
export const RpcGenerateImageState: FlowAutomationState = {
  name: 'RPC_GENERATE_IMAGE',
  timeoutMs: 90000,

  async enter(ctx: FlowStateContext): Promise<void> {
    ctx.onProgress?.(40, 'Đang chuẩn bị gửi yêu cầu sinh ảnh tới máy chủ Google Flow (RPC)...');
  },

  async execute(ctx: FlowStateContext): Promise<ActionResult> {
    if (!ctx.win || ctx.win.isDestroyed()) {
      return { ok: false, error: 'BROWSER_WINDOW_DESTROYED', errorDetail: 'Cửa sổ Flow đã bị đóng' };
    }

    // 1. Xác định activeProjectId
    let projectId = ctx.activeProjectId || ctx.targetProjectId;
    if (!projectId) {
      const currentUrl = ctx.win.webContents?.getURL?.() || '';
      const match = currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        projectId = match[1];
        ctx.activeProjectId = projectId;
      }
    }

    if (!projectId) {
      return {
        ok: false,
        error: 'PROJECT_NOT_FOUND',
        errorDetail: 'Không tìm thấy Project ID trong URL hoặc context để gọi RPC sinh ảnh.',
      };
    }

    // 2. Tìm assetId nếu đang ở chế độ Edit (/project/<id>/edit/<assetId>)
    let editAssetId: string | null = null;
    try {
      const currentUrl = ctx.win.webContents?.getURL?.() || '';
      const editMatch = currentUrl.match(/\/edit\/([a-zA-Z0-9_-]+)/);
      if (editMatch && editMatch[1]) {
        editAssetId = editMatch[1];
      }
    } catch {}

    // 3. Xử lý ảnh tham chiếu hoàn toàn qua RPC (maseQ) — KHÔNG cào DOM chip
    // Dọn sạch chip cũ trên UI nếu có để giữ giao diện sạch sẽ, tránh UI conflict
    try {
      await safeExecuteJs(ctx.win, `
        (function() {
          const closeBtns = document.querySelectorAll(
            '.chip-container button[aria-label*="xóa" i], .chip-container button[aria-label*="remove" i], .chip-container button[aria-label*="close" i], button.chip-remove, button.remove-ingredient'
          );
          closeBtns.forEach(btn => btn.click());
        })()
      `, 1000);
    } catch {}

    const referenceMediaIds: string[] = [];
    const client = getFlowRpcClient();

    if (ctx.referenceMediaId) {
      referenceMediaIds.push(ctx.referenceMediaId);
    }

    // Nếu có referenceImagePath hoặc referenceImagePaths, upload trực tiếp qua maseQ RPC
    const candidatePaths: string[] = [];
    if (ctx.referenceImagePath) candidatePaths.push(ctx.referenceImagePath);
    if ((ctx as any).referenceImagePaths && Array.isArray((ctx as any).referenceImagePaths)) {
      for (const p of (ctx as any).referenceImagePaths) {
        if (p && !candidatePaths.includes(p)) candidatePaths.push(p);
      }
    }

    for (const imgPath of candidatePaths) {
      if (imgPath && fs.existsSync(imgPath)) {
        try {
          console.log(`[RpcGenerateImageState] 📤 Đang upload reference image qua maseQ RPC: ${path.basename(imgPath)}`);
          const uploadRes = await client.uploadReferenceImage(ctx.win, imgPath, projectId);
          if (uploadRes?.mediaId && !referenceMediaIds.includes(uploadRes.mediaId)) {
            referenceMediaIds.push(uploadRes.mediaId);
            ctx.referenceMediaId = uploadRes.mediaId;
            console.log(`[RpcGenerateImageState] 📎 Upload reference thành công, media_id: ${uploadRes.mediaId}`);
          }
        } catch (uploadErr: any) {
          console.warn(`[RpcGenerateImageState] ⚠️ Không thể upload reference "${path.basename(imgPath)}" qua RPC: ${uploadErr.message}`);
        }
      }
    }

    // 4. Xác định Model Wire ID
    const rawEngine = (ctx.imageEngine || 'nano-banana').toLowerCase();
    const isPro = rawEngine.includes('pro') || rawEngine === 'banana-pro';
    const modelId = isPro ? 'GEM_PIX_2' : 'NARWHAL';

    console.log(
      `[RpcGenerateImageState] 🚀 Bắt đầu gọi ogiZ0b RPC: prompt="${ctx.prompt.slice(0, 60)}...", ` +
      `aspectRatio=${ctx.aspectRatio}, model=${modelId}, projectId=${projectId}`
    );

    ctx.onProgress?.(55, 'Google Flow AI đang sinh ảnh...');

    try {
      const client = getFlowRpcClient();
      const images = await client.generateImage(ctx.win, {
        prompt: ctx.prompt,
        aspectRatio: ctx.aspectRatio || '16:9',
        outputCount: ctx.outputCount || 1,
        projectId,
        editAssetId,
        imageModel: modelId,
        referenceMediaIds,
      });

      if (!images || images.length === 0 || !images[0]?.url) {
        return {
          ok: false,
          error: 'RPC_EMPTY_RESPONSE',
          errorDetail: 'Google Flow RPC hoàn tất nhưng không trả về URL ảnh hợp lệ',
        };
      }

      const generated = images[0];
      console.log(
        `[RpcGenerateImageState] ✅ Sinh ảnh thành công qua RPC! ` +
        `mediaId=${generated.mediaId}, url=${generated.url.slice(0, 80)}...`
      );

      ctx.capturedMediaUrl = generated.url;
      ctx.capturedMediaId = generated.mediaId;
      ctx.generationState = 'COMPLETED';

      return {
        ok: true,
        data: {
          imageUrl: generated.url,
          mediaId: generated.mediaId,
          projectId,
        },
      };
    } catch (err: any) {
      console.error('[RpcGenerateImageState] ❌ Lỗi khi gọi RPC generateImage:', err);
      return {
        ok: false,
        error: 'RPC_GENERATION_FAILED',
        errorDetail: err?.message || String(err),
      };
    }
  },

  async verify(ctx: FlowStateContext): Promise<VerifyResult> {
    const hasUrl = Boolean(ctx.capturedMediaUrl && ctx.capturedMediaUrl.includes('flow-content.google'));
    return {
      ok: hasUrl,
      criteria: {
        capturedMediaUrl: ctx.capturedMediaUrl || 'none',
        generationState: ctx.generationState,
      },
      reason: hasUrl ? undefined : 'Chưa nhận được URL ảnh CDN hợp lệ từ RPC Google Flow',
    };
  },

  async exit(): Promise<void> {},
};

/**
 * Danh sách toàn bộ các State theo thứ tự cho luồng sinh ảnh Image Generation (Chuẩn DOM Automation trong Electron)
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

/**
 * Pipeline thử nghiệm RPC độc lập (không ảnh hưởng luồng chính)
 */
export const FlowImageGenerationRpcPipeline: FlowAutomationState[] = [
  OpenFlowState,
  WaitForPageReadyState,
  VerifySessionState,
  EnsureProjectContextState,
  HandleImageReferenceState,
  RpcGenerateImageState,
  ExtractOutputState,
];
