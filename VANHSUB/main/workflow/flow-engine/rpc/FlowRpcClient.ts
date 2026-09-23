/**
 * FlowRpcClient.ts
 *
 * Tầng giao tiếp RPC với Google Flow batchexecute từ Electron main process.
 *
 * Thay thế hoàn toàn Chrome Extension WebSocket bridge của FlowKit:
 *   Extension chrome.cookies.getAll()      → session.cookies.get()
 *   Extension injected.js (MAIN world)      → webContents.executeJavaScript()
 *   Extension fetch() trong tab context     → session.fetch() từ main process
 *   Extension WebSocket ↔ Python agent      → gọi trực tiếp, không có 2 tiến trình
 *
 * QUAN TRỌNG — BrowserWindow phải tồn tại trong suốt generate:
 *   - getAtToken() + mintCaptchaToken() cần executeJavaScript()
 *   - lobbyWindow có thể minimize/offscreen nhưng KHÔNG được destroy
 *
 * ══════════════════════════════════════════════════════════════
 *   GIAI ĐOẠN 1 — Chỉ dùng maseQ (upload) để VERIFY P1–P4.
 *   Các method generate image/video chưa được gọi vào production.
 * ══════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import {
  RECAPTCHA_SITE_KEY,
  CAPTCHA_ACTION_IMAGE,
  CAPTCHA_ACTION_VIDEO,
  WIZ_DATA_AT_TOKEN_KEY,
  RPC_GEN_IMAGE,
  RPC_GEN_VIDEO,
  RPC_GEN_VIDEO_TEXT,
  RPC_GEN_VIDEO_FIRST_LAST,
  RPC_GEN_VIDEO_REFERENCES,
  RPC_OPERATION,
  RPC_PROJECT_MEDIA,
  RPC_MEDIA,
  RPC_UPLOAD_IMAGE,
  SURFACE_ID,
  OPERATION_POLL_INTERVAL_MS,
  OPERATION_POLL_TIMEOUT_MS,
  RPC_REQUEST_TIMEOUT_MS,
  RPC_TRANSIENT_RETRY_DELAY_MS,
  IMAGE_TRANSIENT_MAX_RETRIES,
  OPERATION_STATUS_DONE,
  FLOW_HOST,
  CAPTCHA_SLOT,
} from './FlowBatchConstants';
import { FlowBridgeServer } from './FlowBridgeServer';

import {
  buildEnvelope,
  parseBatchResponse,
  buildUploadPayload,
  buildGenImagePayload,
  buildGenVideoPayload,
  buildGenVideoTextPayload,
  buildGenVideoFirstLastPayload,
  buildGenVideoReferencesPayload,
  buildPollOperationPayload,
  buildListProjectMediaPayload,
  extractGeneratedImages,
  extractOperationStatus,
  extractPollStatus,
  type GenImagePayloadOptions,
  type GenVideoPayloadOptions,
  type GenVideoTextPayloadOptions,
  type GenVideoFirstLastPayloadOptions,
  type GenVideoReferencesPayloadOptions,
  type GeneratedImage,
  type OperationStatus,
  type MediaUrls,
} from './FlowBatchBuilder';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UploadImageResult {
  mediaId: string;
  /** URL media trên flow-content.google (nếu response trả về) */
  url?: string;
}

/** Options cho callFlowRPC nội bộ */
interface RpcCallOptions {
  /** Nếu true: mint CAPTCHA token trước khi gửi (image/video gen) */
  needsCaptcha?: boolean;
  captchaAction?: typeof CAPTCHA_ACTION_IMAGE | typeof CAPTCHA_ACTION_VIDEO;
  /** Số lần retry tối đa cho transient errors. Default 1. */
  maxRetries?: number;
  /** Label cho log */
  label?: string;
}

// ── At Token Cache ─────────────────────────────────────────────────────────────

interface AtTokenCache {
  token: string;
  fSid?: string;
  bl?: string;
  cachedAt: number;
  /** TTL: 50 phút (flow session token thường có TTL ~60 phút) */
}

const AT_TOKEN_CACHE_TTL_MS = 50 * 60 * 1000;
let _atTokenCache: AtTokenCache | null = null;

// ── Core RPC Client ───────────────────────────────────────────────────────────

export class FlowRpcClient {
  /** Partition name của Electron session chứa Flow cookies */
  private readonly _partition: string;

  /**
   * @param partition Partition name của session đăng nhập Flow.
   *   App dùng 'persist:google_veo' — phải khớp với partition của lobbyWindow.
   */
  constructor(partition = 'persist:google_veo') {
    this._partition = partition;
  }

  // ── Cookie ─────────────────────────────────────────────────────────────────

  /**
   * Lấy toàn bộ cookies của flow.google.com từ Electron session partition.
   *
   * Tương đương chrome.cookies.getAll({domain: 'flow.google.com'}) của FlowKit.
   * App đã có 'persist:google_veo' partition chứa đúng session đăng nhập.
   *
   * Dùng session.fetch() nếu Electron ≥ 25 (app dùng Electron 43 → OK).
   */
  async getCookieString(): Promise<string> {
    const { session } = require('electron');
    const ses = session.fromPartition(this._partition);

    // Lấy cookies của cả flow.google.com và .google.com (parent domain)
    const flowCookies = await ses.cookies.get({ domain: 'flow.google.com' });
    const googleCookies = await ses.cookies.get({ domain: '.google.com' });

    // Dedup: ưu tiên flow.google.com specific cookie nếu trùng tên
    const cookieMap = new Map<string, string>();

    // Thêm google.com cookies trước (thứ tự thấp hơn)
    for (const c of googleCookies) {
      cookieMap.set(c.name, c.value);
    }
    // Override bằng flow.google.com specific
    for (const c of flowCookies) {
      cookieMap.set(c.name, c.value);
    }

    const cookieStr = Array.from(cookieMap.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');

    console.log(
      `[FlowRpcClient] 🍪 Cookie string built: ${cookieMap.size} cookies, ` +
      `${cookieStr.length} chars. Has SID: ${cookieMap.has('SID')}. ` +
      `Has __Secure-1PSID: ${cookieMap.has('__Secure-1PSID')}`
    );

    return cookieStr;
  }

  // ── At Token ───────────────────────────────────────────────────────────────

  /**
   * Lấy XSRF token `at` từ window object của trang Flow đang mở.
   *
   * Tương đương injected.js của FlowKit (chạy trong MAIN world).
   * executeJavaScript() trong Electron = code chạy trong MAIN world của renderer.
   *
   * VERIFY P1: WIZ_global_data.SNlM0e là đúng tên không?
   *   → Kiểm tra bằng DevTools: window.WIZ_global_data trong lobbyWindow
   */
  async getAtToken(win: Electron.BrowserWindow): Promise<string> {
    // Kiểm tra cache trước
    if (
      _atTokenCache &&
      Date.now() - _atTokenCache.cachedAt < AT_TOKEN_CACHE_TTL_MS
    ) {
      console.log('[FlowRpcClient] 🔑 at token từ cache');
      return _atTokenCache.token;
    }

    if (!win || win.isDestroyed()) {
      throw new Error('[FlowRpcClient] getAtToken: lobbyWindow đã bị destroy');
    }

    const sessionData: { token: string | null; fSid?: string; bl?: string } = await win.webContents.executeJavaScript(`
      (function() {
        let fSid = undefined;
        let bl = undefined;
        try {
          const wizData = window.WIZ_global_data;
          if (wizData && typeof wizData === 'object') {
            if (wizData.FdrFJe) fSid = String(wizData.FdrFJe);
            if (wizData.cfb2h) bl = String(wizData.cfb2h);
            console.log('[FlowRpc:inject] WIZ_global_data keys:', Object.keys(wizData).slice(0, 15).join(', '));
            if (wizData['${WIZ_DATA_AT_TOKEN_KEY}']) {
              console.log('[FlowRpc:inject] ✅ Found at token via WIZ_global_data.${WIZ_DATA_AT_TOKEN_KEY}');
              return { token: wizData['${WIZ_DATA_AT_TOKEN_KEY}'], fSid, bl };
            }
          }
        } catch(e) {
          console.warn('[FlowRpc:inject] WIZ_global_data access error:', e.message);
        }
        
        // Fallback 1: Scan script tags cho pattern "SNlM0e":"<token>", "at":"AIQ-..."
        try {
          const scripts = Array.from(document.querySelectorAll('script'));
          for (const s of scripts) {
            const text = s.textContent || '';
            const patterns = [
              /"SNlM0e":"([^"]{20,}?)"/,
              /"at":"(AIQ-[^"]+?)"/,
              /"at":"(AF[^"]+?)"/,
              /"csrfToken":"([^"]+?)"/,
            ];
            for (const pattern of patterns) {
              const m = text.match(pattern);
              if (m && m[1]) {
                console.log('[FlowRpc:inject] ✅ Found at token via script scan, pattern:', pattern.source.slice(0,20));
                return { token: m[1], fSid, bl };
              }
            }
          }
        } catch(e) {
          console.warn('[FlowRpc:inject] Script scan error:', e.message);
        }

        // Fallback 2: meta tag
        try {
          const meta = document.querySelector('meta[name="at"], meta[name="_at"]');
          if (meta) {
            const content = meta.getAttribute('content');
            if (content) {
              console.log('[FlowRpc:inject] ✅ Found at token via meta tag');
              return { token: content, fSid, bl };
            }
          }
        } catch(e) {}
        
        console.error('[FlowRpc:inject] ❌ VERIFY P1 FAILED: Could not find at token.' +
          ' WIZ_global_data:', JSON.stringify(window.WIZ_global_data)?.slice(0, 200));
        return { token: null, fSid, bl };
      })()
    `);

    const token = sessionData?.token;
    if (!token) {
      throw new Error(
        '[FlowRpcClient] getAtToken: VERIFY P1 FAILED — Không tìm thấy at token trong window. ' +
        'Xem console log của lobbyWindow để debug. ' +
        'Kiểm tra: window.WIZ_global_data trong DevTools của lobbyWindow.'
      );
    }

    // Cache token, fSid và bl
    _atTokenCache = { token, fSid: sessionData.fSid, bl: sessionData.bl, cachedAt: Date.now() };
    console.log(`[FlowRpcClient] 🔑 at token captured (${token.length} chars, fSid=${sessionData.fSid || 'none'}, bl=${sessionData.bl || 'default'}), sẽ cache ${AT_TOKEN_CACHE_TTL_MS / 60000} phút`);
    return token;
  }

  /** Xóa at token cache (gọi khi session expire hoặc reload trang) */
  invalidateAtTokenCache(): void {
    _atTokenCache = null;
    console.log('[FlowRpcClient] at token cache cleared');
  }

  // ── reCAPTCHA ──────────────────────────────────────────────────────────────

  /**
   * Mint fresh reCAPTCHA Enterprise token ngay trong page context của tab Flow.
   *
   * QUAN TRỌNG:
   * - Token SINGLE-USE + time-limited (~2 phút)
   * - KHÔNG cache — gọi ngay trước mỗi request generate
   * - window.grecaptcha phải tồn tại (trang Flow phải đã load xong)
   *
   * VERIFY P7: grecaptcha.enterprise available ngay sau did-finish-load không?
   */
  async mintCaptchaToken(
    win: Electron.BrowserWindow,
    action: typeof CAPTCHA_ACTION_IMAGE | typeof CAPTCHA_ACTION_VIDEO = CAPTCHA_ACTION_IMAGE
  ): Promise<string> {
    if (!win || win.isDestroyed()) {
      throw new Error('[FlowRpcClient] mintCaptchaToken: lobbyWindow đã bị destroy');
    }

    console.log(`[FlowRpcClient] 🔐 Đang mint CAPTCHA token cho action="${action}"...`);

    try {
      if (!win.isMinimized()) win.focus();
    } catch {}

    const captchaData: { token: string; siteKey: string } = await win.webContents.executeJavaScript(`
      new Promise(function(resolve, reject) {
        // Lấy siteKey chuẩn nội bộ của Google Flow: WIZ_global_data.xZbWve hoặc script render param
        var siteKey = '${RECAPTCHA_SITE_KEY}';
        try {
          if (window.WIZ_global_data && window.WIZ_global_data.xZbWve) {
            siteKey = window.WIZ_global_data.xZbWve;
            console.log('[FlowRpc:captcha] 🎯 Lấy siteKey từ WIZ_global_data.xZbWve:', siteKey);
          } else {
            var script = document.querySelector('script[src*="recaptcha"]');
            if (script && script.src) {
              var m = script.src.match(/render=([a-zA-Z0-9_-]+)/);
              if (m && m[1]) {
                siteKey = m[1];
                console.log('[FlowRpc:captcha] 🎯 Lấy siteKey từ DOM script render param:', siteKey);
              }
            }
          }
        } catch(e) {}

        var action = '${action}';
        var attempts = 0;
        var maxAttempts = 24; // Chờ tối đa 12s (24 x 500ms)

        function tryMint() {
          if (window.grecaptcha && window.grecaptcha.enterprise && typeof window.grecaptcha.enterprise.execute === 'function') {
            window.grecaptcha.enterprise.execute(siteKey, { action: action })
              .then(function(token) {
                console.log('[FlowRpc:captcha] ✅ CAPTCHA token minted, length:', token.length, 'with siteKey:', siteKey);
                resolve({ token: token, siteKey: siteKey });
              })
              .catch(function(err) {
                console.error('[FlowRpc:captcha] ❌ CAPTCHA mint failed:', err.message);
                reject(err);
              });
            return;
          }

          attempts++;
          if (attempts >= maxAttempts) {
            console.error('[FlowRpc:captcha] grecaptcha.enterprise not available sau 12s.',
              'typeof grecaptcha:', typeof window.grecaptcha,
              'URL:', window.location.href);
            reject(new Error(
              'grecaptcha.enterprise not available — Trang Flow chưa load xong hoặc chưa vào trang dự án (/project/<id>). URL hiện tại: ' +
              window.location.href
            ));
            return;
          }

          setTimeout(tryMint, 500);
        }

        tryMint();
      })
    `);

    const token = captchaData?.token;
    if (!token || typeof token !== 'string') {
      throw new Error('[FlowRpcClient] mintCaptchaToken: Token rỗng hoặc null');
    }

    console.log(`[FlowRpcClient] ✅ CAPTCHA token minted (${token.length} chars) [SiteKey: ${captchaData.siteKey}]`);
    return token;
  }

  // ── Core HTTP Caller ───────────────────────────────────────────────────────

  /**
   * Gửi 1 batchexecute RPC request và trả về parsed result.
   *
   * Dùng session.fetch() (Electron 25+) để request đi qua partition network stack.
   *
   * === VERIFIED từ test P4 (HTTP 400 xsrf error) ===
   * Field `at=` trong POST body là BẮT BUỘC cho MỌI request:
   *   - Generate (needsCaptcha=true):   at=<CAPTCHA_TOKEN>  (FlowKit pattern)
   *   - Upload/Poll (needsCaptcha=false): at=<XSRF_TOKEN>   (WIZ_global_data.SNlM0e)
   */
  async callFlowRPC(
    win: Electron.BrowserWindow | null,
    rpcId: string,
    innerPayload: unknown[],
    projectId?: string,
    opts: RpcCallOptions = {}
  ): Promise<unknown> {
    const {
      needsCaptcha = false,
      captchaAction = CAPTCHA_ACTION_IMAGE,
      maxRetries = 1,
      label = rpcId,
    } = opts;

    const { session } = require('electron');
    const ses = session.fromPartition(this._partition);

    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt <= maxRetries) {
      attempt++;
      try {
        // 1. Lấy cookies mới nhất
        const cookieStr = await this.getCookieString();
        if (!cookieStr || cookieStr.length < 20) {
          throw new Error(
            `[FlowRpcClient] Cookie string rỗng — session có thể chưa đăng nhập. ` +
            `Cookie length: ${cookieStr.length}`
          );
        }

        // 2. Resolve `at=` parameter — BẮT BUỘC LUÔN LÀ XSRF token (WIZ_global_data.SNlM0e)
        // Đây là chuẩn bảo mật chống CSRF của batchexecute cho MỌI request
        let xsrfToken: string;
        if (win && !win.isDestroyed()) {
          xsrfToken = await this.getAtToken(win);
        } else if (_atTokenCache) {
          xsrfToken = _atTokenCache.token;
          console.log(`[FlowRpcClient] 🔑 at= param = XSRF từ cache cho ${label}`);
        } else {
          throw new Error(
            `[FlowRpcClient] callFlowRPC: Không có XSRF at token (cache rỗng, win=null). ` +
            `Gọi callFlowRPC với win trước để cache at token. RPC: ${label}`
          );
        }

        // 3. Mint CAPTCHA nếu RPC yêu cầu (dành cho generate RPCs trong mảng payload)
        let captchaToken: string | null = null;
        if (needsCaptcha) {
          if (!win || win.isDestroyed()) {
            throw new Error(
              '[FlowRpcClient] callFlowRPC: lobbyWindow cần tồn tại để mint CAPTCHA. ' +
              `RPC: ${label}`
            );
          }
          captchaToken = await this.mintCaptchaToken(win, captchaAction);
          console.log(`[FlowRpcClient] 🔐 Minted CAPTCHA token (${captchaToken.length} chars) cho ${label}`);
          // TODO: Chèn captchaToken vào vị trí chính xác trong innerPayload sau khi xác nhận qua P2
        }

        // 4. Build envelope — at= LUÔN là xsrfToken, fSid chuẩn từ session, bl từ cache
        const fSid = _atTokenCache?.fSid;
        const bl = _atTokenCache?.bl;
        const envelope = buildEnvelope(rpcId, innerPayload, xsrfToken, cookieStr, projectId, fSid, bl);

        console.log(
          `[FlowRpcClient] 📡 ${label} (attempt ${attempt}/${maxRetries + 1}, fSid=${fSid || 'none'}, bl=${bl || 'default'}) → ${envelope.url.slice(0, 80)}...`
        );

        // 4. Gửi request: Ưu tiên dùng in-page fetch (100% browser context, cookies và session thật)
        let rawText: string;
        if (win && !win.isDestroyed()) {
          const fetchUrl = envelope.url.startsWith('https://flow.google.com')
            ? envelope.url.replace('https://flow.google.com', '')
            : envelope.url;
          rawText = await win.webContents.executeJavaScript(`
            (async function() {
              try {
                const res = await window.fetch(${JSON.stringify(fetchUrl)}, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-Same-Domain': '1'
                  },
                  body: ${JSON.stringify(envelope.body)},
                  credentials: 'include'
                });
                const text = await res.text();
                if (!res.ok) {
                  return 'HTTP_ERROR:' + res.status + ':' + text.slice(0, 300);
                }
                return text;
              } catch (e) {
                return 'FETCH_EXCEPTION:' + (e.message || String(e));
              }
            })()
          `);

          if (rawText.startsWith('HTTP_ERROR:')) {
            const parts = rawText.split(':');
            const status = parseInt(parts[1], 10) || 500;
            const errBody = rawText.slice(parts[0].length + parts[1].length + 2);
            if (status === 403) {
              throw new Error(`HTTP 403 — Bot detection hoặc CAPTCHA/token lỗi. Body: ${errBody.slice(0, 150)}`);
            }
            throw new Error(`HTTP ${status}: ${errBody.slice(0, 200)}`);
          }
          if (rawText.startsWith('FETCH_EXCEPTION:')) {
            throw new Error(`In-page fetch failed: ${rawText.slice(16)}`);
          }
        } else {
          // Fallback session.fetch từ Electron main process
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), RPC_REQUEST_TIMEOUT_MS);
          try {
            const response = await ses.fetch(envelope.url, {
              method: 'POST',
              headers: envelope.headers,
              body: envelope.body,
              signal: controller.signal,
            });
            rawText = await response.text();
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${rawText.slice(0, 200)}`);
            }
          } finally {
            clearTimeout(timeout);
          }
        }

        console.log(`[FlowRpcClient] 📥 ${label} raw response (first 600 chars):`, rawText.slice(0, 600));

        // 5. Parse batchexecute response
        const result = parseBatchResponse(rawText, rpcId);

        if (!result.ok) {
          const errStr = JSON.stringify(result.error);
          console.error(`[FlowRpcClient] ❌ RPC error ${label}: ${errStr}. Full response: ${rawText}`);

          // Một số lỗi transient đặc biệt (code 8 trong image gen)
          const isTransient =
            errStr.includes('8') ||
            errStr.includes('transient') ||
            errStr.includes('TRANSIENT');

          if (isTransient && attempt <= maxRetries) {
            console.log(
              `[FlowRpcClient] ⏳ Transient error, retry sau ${RPC_TRANSIENT_RETRY_DELAY_MS}ms...`
            );
            await new Promise((r) => setTimeout(r, RPC_TRANSIENT_RETRY_DELAY_MS));
            lastError = new Error(`RPC error: ${errStr}`);
            continue;
          }

          throw new Error(`[FlowRpcClient] RPC ${label} failed: ${errStr}`);
        }

        console.log(`[FlowRpcClient] ✅ ${label} thành công (attempt ${attempt})`);
        return result.data;

      } catch (err: any) {
        lastError = err;
        if (attempt <= maxRetries) {
          console.warn(
            `[FlowRpcClient] ⚠️ ${label} attempt ${attempt} failed: ${err.message}. ` +
            `Retry trong ${RPC_TRANSIENT_RETRY_DELAY_MS}ms...`
          );
          await new Promise((r) => setTimeout(r, RPC_TRANSIENT_RETRY_DELAY_MS));
        }
      }
    }

    throw lastError ?? new Error(`[FlowRpcClient] ${label} failed sau ${attempt} attempts`);
  }

  // ── Upload Reference Image ─────────────────────────────────────────────────

  /**
   * Upload ảnh tham chiếu local (character_ref.png / background_ref.png) lên Flow qua maseQ RPC.
   * Trả về media_id (UUID) để dùng trong các request generate tiếp theo.
   *
   * Thay thế hoàn toàn cơ chế "chip" qua DOM.
   * Không tiêu credit.
   * BẮT BUỘC có reCAPTCHA token (IMAGE_GENERATION) nhúng trong securityBlock (xác nhận 100% từ FlowKit).
   *
   * @param win lobbyWindow đang mở flow.google.com (cần để mint reCAPTCHA + XSRF)
   * @param filePath Đường dẫn tuyệt đối đến file ảnh local
   * @param projectId UUID project hiện tại (từ ctx.activeProjectId)
   */
  async uploadReferenceImage(
    win: Electron.BrowserWindow | null | undefined,
    filePath: string,
    projectId: string
  ): Promise<UploadImageResult> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`[FlowRpcClient] uploadReferenceImage: File không tồn tại: "${filePath}"`);
    }

    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      throw new Error(`[FlowRpcClient] uploadReferenceImage: File rỗng: "${filePath}"`);
    }

    const filename = path.basename(filePath);
    console.log(
      `[FlowRpcClient] 📤 Chuẩn bị upload reference image: "${filename}" ` +
      `(${(stat.size / 1024).toFixed(1)} KB) cho project ${projectId}`
    );

    // 1. Đọc file thành base64 (không có prefix data:image)
    const imageBuffer = fs.readFileSync(filePath);
    const base64Data = imageBuffer.toString('base64');
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.webp' ? 'image/webp'
      : 'image/png';

    // ── Ưu tiên 1: Chuyển qua Chrome Extension Bridge nếu đang kết nối ────────
    const bridge = FlowBridgeServer.getInstance();
    if (bridge.isConnected()) {
      console.log(`[FlowRpcClient] 🌐 [Chrome Extension Bridge] Đang upload reference image: "${filename}"...`);
      const uploadPayload = buildUploadPayload({
        projectId,
        base64Data,
        mimeType,
        filename,
        captchaToken: CAPTCHA_SLOT,
      });
      const rawText = await bridge.sendBatchRpc(
        RPC_UPLOAD_IMAGE,
        uploadPayload,
        CAPTCHA_ACTION_IMAGE,
        projectId
      );
      const res = parseBatchResponse(rawText, RPC_UPLOAD_IMAGE);
      if (!res.ok) {
        throw new Error(`[FlowRpcClient] Chrome Extension Bridge upload error: ${JSON.stringify(res.error)}`);
      }
      const mediaId = this._extractMediaIdFromUploadResponse(res.data);
      if (!mediaId) {
        throw new Error(`[FlowRpcClient] Không extract được mediaId từ upload response của Extension: ${rawText.slice(0, 300)}`);
      }
      console.log(`[FlowRpcClient] ✅ [Chrome Extension Bridge] Upload thành công! media_id: ${mediaId}`);
      return { mediaId };
    }

    // ── Ưu tiên 2 (Fallback): Cửa sổ ảo Electron (Cần lobbyWindow) ───────────
    if (!win || win.isDestroyed()) {
      throw new Error('[FlowRpcClient] uploadReferenceImage: lobbyWindow phải tồn tại hoặc cần kết nối Chrome Extension');
    }

    // Tự động chuyển hướng lobbyWindow vào đúng project nếu đang ở trang chủ hoặc project khác
    const currentUrl = win.webContents?.getURL?.() || '';
    if (projectId && !currentUrl.includes(projectId)) {
      console.log(`[FlowRpcClient] 🔄 lobbyWindow đang ở "${currentUrl}", tự động chuyển hướng vào project: ${projectId}`);
      await win.loadURL(`https://flow.google.com/project/${projectId}`);
      await new Promise((r) => setTimeout(r, 3000));
    }

    // 2. Mint fresh reCAPTCHA token cho IMAGE_GENERATION (FlowKit verified)
    console.log(`[FlowRpcClient] 🔐 Minting reCAPTCHA cho maseQ upload...`);
    const captchaToken = await this.mintCaptchaToken(win, CAPTCHA_ACTION_IMAGE);

    // 3. Build inner payload chuẩn 100% từ FlowKit wire format
    const uploadPayload = buildUploadPayload({
      projectId,
      base64Data,
      mimeType,
      filename,
      captchaToken,
    });

    console.log(
      `[FlowRpcClient] 🚀 Gửi maseQ RPC: filename="${filename}", mime="${mimeType}", ` +
      `base64Len=${base64Data.length}, captchaLen=${captchaToken.length}`
    );

    let data: unknown;
    try {
      data = await this.callFlowRPC(win, RPC_UPLOAD_IMAGE, uploadPayload, projectId, {
        needsCaptcha: false, // CAPTCHA đã được nhúng trong securityBlock bên trong uploadPayload
        label: `maseQ(upload:${filename})`,
        maxRetries: 2,
      });
    } catch (err: any) {
      console.error(
        `[FlowRpcClient] ❌ maseQ upload failed: ${err.message}`
      );
      throw err;
    }

    console.log('[FlowRpcClient] 📥 maseQ raw response:', JSON.stringify(data)?.slice(0, 400));

    // 4. Trích xuất media_id từ response
    const mediaId = this._extractMediaIdFromUploadResponse(data);

    if (!mediaId) {
      throw new Error(
        `[FlowRpcClient] VERIFY P4: Không thể extract media_id từ maseQ response. ` +
        `Raw data: ${JSON.stringify(data)?.slice(0, 300)}.`
      );
    }

    console.log(`[FlowRpcClient] ✅ Upload thành công! media_id: ${mediaId}`);
    return { mediaId };
  }

  /**
   * Tìm media_id (UUID pattern) trong response của maseQ.
   * FlowKit spec: data[0][0] là mediaId trong mảng [[mediaId, projectId, operationId, "CAE", ...]]
   */
  private _extractMediaIdFromUploadResponse(data: unknown): string | null {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Fast path: FlowKit standard record format data[0][0]
    if (Array.isArray(data) && data.length > 0) {
      const firstRecord = data[0];
      if (Array.isArray(firstRecord) && firstRecord.length > 0) {
        const candidate = firstRecord[0];
        if (typeof candidate === 'string' && UUID_RE.test(candidate)) {
          return candidate;
        }
      }
      if (typeof firstRecord === 'string' && UUID_RE.test(firstRecord)) {
        return firstRecord;
      }
    }

    // Fallback: Duyệt toàn bộ nested structure để tìm chuỗi UUID
    const findUuid = (node: unknown): string | null => {
      if (typeof node === 'string' && UUID_RE.test(node)) return node;
      if (Array.isArray(node)) {
        for (const item of node) {
          const found = findUuid(item);
          if (found) return found;
        }
      }
      return null;
    };

    return findUuid(data);
  }

  /**
   * Tạo ảnh qua RPC_GEN_IMAGE (ogiZ0b).
   *
   * === VERIFIED 100% TỪ CAPTURE THỰC TẾ TRÊN GOOGLE FLOW ===
   */
  async generateImage(
    win: Electron.BrowserWindow | null | undefined,
    opts: Omit<GenImagePayloadOptions, 'captchaToken'>
  ): Promise<GeneratedImage[]> {
    // ── Ưu tiên 1: Chuyển qua Chrome Extension Bridge nếu đang kết nối ────────
    const bridge = FlowBridgeServer.getInstance();
    if (bridge.isConnected()) {
      console.log(`[FlowRpcClient] 🌐 [Chrome Extension Bridge] Đang tạo ảnh: "${opts.prompt.slice(0, 40)}"...`);
      const innerPayload = buildGenImagePayload({
        ...opts,
        captchaToken: CAPTCHA_SLOT,
      });
      const rawText = await bridge.sendBatchRpc(
        RPC_GEN_IMAGE,
        innerPayload,
        CAPTCHA_ACTION_IMAGE,
        opts.projectId
      );
      const res = parseBatchResponse(rawText, RPC_GEN_IMAGE);
      if (!res.ok) {
        throw new Error(`[FlowRpcClient] Chrome Extension Bridge lỗi: ${JSON.stringify(res.error)}`);
      }
      const images = extractGeneratedImages(res.data);
      if (images.length === 0) {
        throw new Error(`[FlowRpcClient] Không extract được ảnh từ response của Extension: ${rawText.slice(0, 300)}`);
      }
      console.log(`[FlowRpcClient] ✅ [Chrome Extension Bridge] Đã tạo thành công ${images.length} ảnh!`);
      return images;
    }

    // ── Ưu tiên 2 (Fallback): Cửa sổ ảo Electron (Có thể bị bot detection) ───
    if (!win || win.isDestroyed()) {
      throw new Error('[FlowRpcClient] generateImage: lobbyWindow phải tồn tại hoặc cần kết nối Chrome Extension');
    }

    // Tự động chuyển hướng lobbyWindow vào đúng project nếu đang ở ngoài project
    const currentUrl = win.webContents?.getURL?.() || '';
    if (opts.projectId && !currentUrl.includes(opts.projectId)) {
      console.log(`[FlowRpcClient] 🔄 lobbyWindow đang ở "${currentUrl}", tự động chuyển hướng vào project: ${opts.projectId}`);
      await win.loadURL(`https://flow.google.com/project/${opts.projectId}`);
      await new Promise((r) => setTimeout(r, 3000));
    }

    // 1. Mint fresh reCAPTCHA token (~2400 chars) cho IMAGE_GENERATION
    const captchaToken = await this.mintCaptchaToken(win, CAPTCHA_ACTION_IMAGE);

    // 2. Build inner payload chính xác theo schema thật đã capture
    const innerPayload = buildGenImagePayload({
      ...opts,
      captchaToken,
    });

    // 3. Gửi batchexecute (at= ngoài envelope là XSRF token)
    const data = await this.callFlowRPC(
      win,
      RPC_GEN_IMAGE,
      innerPayload,
      opts.projectId,
      {
        needsCaptcha: false, // CAPTCHA đã nằm trong innerPayload!
        maxRetries: IMAGE_TRANSIENT_MAX_RETRIES,
        label: `ogiZ0b(image:${opts.prompt.slice(0, 30)})`,
      }
    );

    console.log('[FlowRpcClient] 📥 ogiZ0b response data:', JSON.stringify(data)?.slice(0, 500));

    const images = extractGeneratedImages(data);

    if (images.length === 0) {
      throw new Error(
        `[FlowRpcClient] generateImage: Không extract được ảnh từ response. ` +
        `Raw: ${JSON.stringify(data)?.slice(0, 400)}`
      );
    }

    return images;
  }

  // ── Generate Video ─────────────────────────────────────────────────────────

  /**
   * Tạo video image-to-video qua RPC_GEN_VIDEO_REFERENCES (MZZa6b).
   * VERIFIED 100% TỪ GÓI TIN CAPTURE THẬT TRÊN GOOGLE FLOW.
   * Trả về OperationStatus — cần poll bằng pollOperation() để lấy kết quả.
   */
  async generateVideo(
    win: Electron.BrowserWindow | null | undefined,
    opts: Omit<GenVideoPayloadOptions, 'captchaToken'>
  ): Promise<OperationStatus> {
    // ── Ưu tiên 1: Chuyển qua Chrome Extension Bridge nếu đang kết nối ────────
    const bridge = FlowBridgeServer.getInstance();
    if (bridge.isConnected()) {
      console.log(`[FlowRpcClient] 🌐 [Chrome Extension Bridge] Đang tạo video: "${opts.prompt.slice(0, 40)}"...`);
      const innerPayload = buildGenVideoPayload({
        ...opts,
        captchaToken: CAPTCHA_SLOT,
      });
      const rawText = await bridge.sendBatchRpc(
        RPC_GEN_VIDEO_REFERENCES,
        innerPayload,
        CAPTCHA_ACTION_VIDEO,
        opts.projectId
      );
      const res = parseBatchResponse(rawText, RPC_GEN_VIDEO_REFERENCES);
      if (!res.ok) {
        throw new Error(`[FlowRpcClient] Chrome Extension Bridge lỗi: ${JSON.stringify(res.error)}`);
      }
      const opStatus = extractOperationStatus(res.data, RPC_GEN_VIDEO_REFERENCES);
      console.log(`[FlowRpcClient] ✅ [Chrome Extension Bridge] Video RPC thành công! Operation: ${opStatus.operationId || 'none'}`);
      return opStatus;
    }

    // ── Ưu tiên 2 (Fallback): Cửa sổ ảo Electron (Có thể bị bot detection) ───
    if (!win || win.isDestroyed()) {
      throw new Error('[FlowRpcClient] generateVideo: lobbyWindow phải tồn tại hoặc cần kết nối Chrome Extension');
    }

    // ── Bước 1: Show window trước — reCAPTCHA cần window hiển thị để tính behavioral score ──
    try {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } catch {}

    // ── Bước 2: Điều hướng sang project page nếu cần ──────────────────────────
    const currentUrl = win.webContents?.getURL?.() || '';
    if (opts.projectId && !currentUrl.includes(opts.projectId)) {
      console.log(`[FlowRpcClient] 🔄 lobbyWindow đang ở "${currentUrl}", điều hướng vào project: ${opts.projectId}`);
      // Xóa at-token cache vì sắp load trang mới có WIZ_global_data mới
      this.invalidateAtTokenCache();
      await win.loadURL(`https://flow.google.com/project/${opts.projectId}`);
    }

    // ── Bước 3: Poll chờ grecaptcha.enterprise load xong (tối đa 30 giây) ─────
    console.log('[FlowRpcClient] ⏳ Chờ grecaptcha.enterprise load trên project page...');
    const captchaReady = await win.webContents.executeJavaScript(`
      new Promise(function(resolve) {
        var elapsed = 0;
        var interval = setInterval(function() {
          elapsed += 500;
          if (window.grecaptcha && window.grecaptcha.enterprise &&
              typeof window.grecaptcha.enterprise.execute === 'function') {
            clearInterval(interval);
            resolve({ ready: true, elapsed: elapsed, url: window.location.href });
          } else if (elapsed >= 30000) {
            clearInterval(interval);
            resolve({ ready: false, elapsed: elapsed, url: window.location.href });
          }
        }, 500);
      })
    `);

    console.log(`[FlowRpcClient] 📍 grecaptcha status:`, captchaReady);

    if (!captchaReady?.ready) {
      throw new Error(
        `[FlowRpcClient] generateVideo: grecaptcha.enterprise không load sau 30s. ` +
        `URL: ${captchaReady?.url}. Kiểm tra xem project page có mở đúng không.`
      );
    }

    // ── Bước 4: Mint fresh reCAPTCHA token cho VIDEO_GENERATION ───────────────
    // Window đang visible & focused — user có thể di chuột qua để tăng score
    const captchaToken = await this.mintCaptchaToken(win, CAPTCHA_ACTION_VIDEO);

    // ── Bước 5: Build inner payload chuẩn 100% từ gói tin capture thật ────────
    const innerPayload = buildGenVideoPayload({
      ...opts,
      captchaToken,
    });

    // ── Bước 6: Gửi RPC MZZa6b ────────────────────────────────────────────────
    const data = await this.callFlowRPC(
      win,
      RPC_GEN_VIDEO_REFERENCES,
      innerPayload,
      opts.projectId,
      {
        needsCaptcha: false, // CAPTCHA đã nằm trong securityBlock
        label: `MZZa6b(video)`,
      }
    );
    return extractOperationStatus(data, RPC_GEN_VIDEO_REFERENCES);
  }


  /**
   * Tạo video text-to-video qua RPC_GEN_VIDEO_TEXT (YhhmEf).
   */
  async generateVideoText(
    win: Electron.BrowserWindow | null | undefined,
    opts: GenVideoTextPayloadOptions
  ): Promise<OperationStatus> {
    const bridge = FlowBridgeServer.getInstance();
    if (bridge.isConnected()) {
      console.log(`[FlowRpcClient] 🌐 [Chrome Extension Bridge] Đang tạo video text: "${opts.prompt.slice(0, 40)}"...`);
      const innerPayload = buildGenVideoTextPayload(opts);
      const rawText = await bridge.sendBatchRpc(
        RPC_GEN_VIDEO_TEXT,
        innerPayload,
        CAPTCHA_ACTION_VIDEO,
        opts.projectId
      );
      const res = parseBatchResponse(rawText, RPC_GEN_VIDEO_TEXT);
      if (!res.ok) throw new Error(`[FlowRpcClient] Chrome Extension Bridge lỗi: ${JSON.stringify(res.error)}`);
      return extractOperationStatus(res.data, RPC_GEN_VIDEO_TEXT);
    }

    if (!win || win.isDestroyed()) {
      throw new Error('[FlowRpcClient] generateVideoText: lobbyWindow phải tồn tại hoặc cần kết nối Chrome Extension');
    }

    // Tự động chuyển hướng lobbyWindow vào đúng project nếu đang ở ngoài project
    const currentUrl = win.webContents?.getURL?.() || '';
    if (opts.projectId && !currentUrl.includes(opts.projectId)) {
      console.log(`[FlowRpcClient] 🔄 lobbyWindow đang ở "${currentUrl}", tự động chuyển hướng vào project: ${opts.projectId}`);
      await win.loadURL(`https://flow.google.com/project/${opts.projectId}`);
      await new Promise((r) => setTimeout(r, 3000));
    }

    const innerPayload = buildGenVideoTextPayload(opts);
    const data = await this.callFlowRPC(
      win,
      RPC_GEN_VIDEO_TEXT,
      innerPayload,
      opts.projectId,
      {
        needsCaptcha: true,
        captchaAction: CAPTCHA_ACTION_VIDEO,
        label: `YhhmEf(text2video)`,
      }
    );
    return extractOperationStatus(data, RPC_GEN_VIDEO_TEXT);
  }

  /**
   * Tạo video first+last frame qua RPC_GEN_VIDEO_FIRST_LAST (nprQif).
   */
  async generateVideoFirstLast(
    win: Electron.BrowserWindow | null | undefined,
    opts: GenVideoFirstLastPayloadOptions
  ): Promise<OperationStatus> {
    const bridge = FlowBridgeServer.getInstance();
    if (bridge.isConnected()) {
      console.log(`[FlowRpcClient] 🌐 [Chrome Extension Bridge] Đang tạo video first-last frame`);
      const innerPayload = buildGenVideoFirstLastPayload(opts);
      const rawText = await bridge.sendBatchRpc(
        RPC_GEN_VIDEO_FIRST_LAST,
        innerPayload,
        CAPTCHA_ACTION_VIDEO,
        opts.projectId
      );
      const res = parseBatchResponse(rawText, RPC_GEN_VIDEO_FIRST_LAST);
      if (!res.ok) throw new Error(`[FlowRpcClient] Chrome Extension Bridge lỗi: ${JSON.stringify(res.error)}`);
      return extractOperationStatus(res.data, RPC_GEN_VIDEO_FIRST_LAST);
    }

    const innerPayload = buildGenVideoFirstLastPayload(opts);
    const data = await this.callFlowRPC(
      win || null,
      RPC_GEN_VIDEO_FIRST_LAST,
      innerPayload,
      opts.projectId,
      {
        needsCaptcha: true,
        captchaAction: CAPTCHA_ACTION_VIDEO,
        label: `nprQif(first+last)`,
      }
    );
    return extractOperationStatus(data, RPC_GEN_VIDEO_FIRST_LAST);
  }

  /**
   * Tạo video với reference images qua RPC_GEN_VIDEO_REFERENCES (MZZa6b).
   */
  async generateVideoWithReferences(
    win: Electron.BrowserWindow,
    opts: GenVideoReferencesPayloadOptions
  ): Promise<OperationStatus> {
    const innerPayload = buildGenVideoReferencesPayload(opts);
    const data = await this.callFlowRPC(
      win,
      RPC_GEN_VIDEO_REFERENCES,
      innerPayload,
      opts.projectId,
      {
        needsCaptcha: true,
        captchaAction: CAPTCHA_ACTION_VIDEO,
        label: `MZZa6b(video+refs)`,
      }
    );
    return extractOperationStatus(data, RPC_GEN_VIDEO_REFERENCES);
  }

  // ── Poll Operation ─────────────────────────────────────────────────────────

  /**
   * Poll operation (jwpduf) cho đến khi status = "CAE" (done) hoặc timeout.
   *
   * Không cần CAPTCHA — poll bình thường.
   * Không cần BrowserWindow sau khi operation đã được submit.
   *
   * @param operationId Operation ID từ generateVideo() response
   * @param projectId UUID project
   * @param onProgress Callback progress (0–100)
   * @param isCancelled Callback check cancelled
   */
  async pollOperation(
    operationId: string,
    projectId: string,
    onProgress?: (pct: number, msg: string) => void,
    isCancelled?: () => boolean
  ): Promise<OperationStatus> {
    const startTime = Date.now();
    let pollCount = 0;

    console.log(`[FlowRpcClient] ⏳ Bắt đầu poll operation: ${operationId} (max ${OPERATION_POLL_TIMEOUT_MS / 60000} phút)`);

    while (true) {
      if (isCancelled?.()) {
        throw new Error('[FlowRpcClient] pollOperation: Cancelled by user');
      }

      const elapsed = Date.now() - startTime;
      if (elapsed >= OPERATION_POLL_TIMEOUT_MS) {
        throw new Error(
          `[FlowRpcClient] pollOperation timeout sau ${elapsed / 1000}s. ` +
          `Operation ${operationId} chưa hoàn tất.`
        );
      }

      pollCount++;
      const pct = Math.min(90, Math.round((elapsed / OPERATION_POLL_TIMEOUT_MS) * 100));
      onProgress?.(pct, `Đang chờ video generate... (${Math.round(elapsed / 1000)}s)`);

      try {
        const innerPayload = buildPollOperationPayload(operationId, projectId);
        let data: unknown;

        const bridge = FlowBridgeServer.getInstance();
        if (bridge.isConnected()) {
          const rawText = await bridge.sendBatchRpc(
            RPC_OPERATION,
            innerPayload,
            undefined, // no captcha needed
            projectId
          );
          const res = parseBatchResponse(rawText, RPC_OPERATION);
          if (!res.ok) {
            throw new Error(`[FlowRpcClient] Chrome Extension Bridge poll error: ${JSON.stringify(res.error)}`);
          }
          data = res.data;
        } else {
          // Poll không cần CAPTCHA — gọi trực tiếp không qua BrowserWindow
          data = await this.callFlowRPC(
            null, // win = null — không cần window cho poll
            RPC_OPERATION,
            innerPayload,
            projectId,
            {
              needsCaptcha: false,
              label: `jwpduf(poll#${pollCount})`,
            }
          );
        }

        const status = extractPollStatus(data, operationId);
        console.log(
          `[FlowRpcClient] 📊 Poll #${pollCount}: status=${status.status ?? 'pending'}, done=${status.done}`
        );

        if (status.done) {
          console.log(
            `[FlowRpcClient] ✅ Operation hoàn tất sau ${(Date.now() - startTime) / 1000}s, ` +
            `${pollCount} lần poll`
          );
          return status;
        }

      } catch (err: any) {
        // Transient poll error — không throw, chỉ log và tiếp tục
        console.warn(`[FlowRpcClient] ⚠️ Poll #${pollCount} error (bỏ qua): ${err.message}`);
      }

      await new Promise((r) => setTimeout(r, OPERATION_POLL_INTERVAL_MS));
    }
  }

  // ── List Project Media ─────────────────────────────────────────────────────

  /**
   * Lấy danh sách media URLs trong project (Zzl0ze).
   * Dùng sau khi operation done để lấy URL video.
   */
  async listProjectMedia(projectId: string): Promise<MediaUrls[]> {
    const innerPayload = buildListProjectMediaPayload(projectId);
    let data: unknown;

    const bridge = FlowBridgeServer.getInstance();
    if (bridge.isConnected()) {
      const rawText = await bridge.sendBatchRpc(
        RPC_PROJECT_MEDIA,
        innerPayload,
        undefined,
        projectId
      );
      const res = parseBatchResponse(rawText, RPC_PROJECT_MEDIA);
      if (!res.ok) {
        throw new Error(`[FlowRpcClient] Chrome Extension Bridge listProjectMedia error: ${JSON.stringify(res.error)}`);
      }
      data = res.data;
    } else {
      data = await this.callFlowRPC(
        null,
        RPC_PROJECT_MEDIA,
        innerPayload,
        projectId,
        {
          needsCaptcha: false,
          label: `Zzl0ze(list-media)`,
        }
      );
    }

    console.log('[FlowRpcClient] 📋 Project media raw:', JSON.stringify(data)?.slice(0, 400));

    // Extract MediaUrls từ nested array — cấu trúc cần VERIFY
    const results: MediaUrls[] = [];
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const findMedia = (node: unknown): void => {
      if (!Array.isArray(node)) return;
      // Pattern: array với UUID + URLs
      const possibleMediaId = node.find(
        (x) => typeof x === 'string' && UUID_RE.test(x)
      ) as string | undefined;
      const videoUrl = node.find(
        (x) => typeof x === 'string' && x.includes('flow-content.google') && x.includes('.mp4')
      ) as string | undefined;
      const imageUrl = node.find(
        (x) => typeof x === 'string' && x.includes('flow-content.google') && !x.includes('.mp4')
      ) as string | undefined;

      if (possibleMediaId) {
        results.push({ mediaId: possibleMediaId, videoUrl, imageUrl });
      } else {
        for (const item of node) findMedia(item);
      }
    };

    findMedia(data);
    return results;
  }
}

// ── Singleton Helper ──────────────────────────────────────────────────────────

let _instance: FlowRpcClient | null = null;

/**
 * Lấy singleton FlowRpcClient với partition mặc định 'persist:google_veo'.
 * Có thể gọi từ bất kỳ đâu trong main process.
 */
export function getFlowRpcClient(partition?: string): FlowRpcClient {
  if (!_instance || partition) {
    _instance = new FlowRpcClient(partition ?? 'persist:google_veo');
  }
  return _instance;
}
