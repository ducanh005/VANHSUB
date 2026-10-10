/**
 * FlowBridgeServer.ts
 *
 * WebSocket Server chạy trên 127.0.0.1:9222 bên trong Electron main process.
 * Đóng vai trò cầu nối 2 chiều giữa VanhSub Desktop và Chrome Extension (VanhSub Flow Bridge).
 *
 * Cho phép Electron chuyển giao toàn bộ các RPC yêu cầu CAPTCHA (tạo ảnh, tạo video)
 * sang tab Google Chrome thật của người dùng để ký reCAPTCHA với điểm tín nhiệm cao (0.9).
 */

import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { BRIDGE_WS_PORT } from './FlowBatchConstants';
import type { JobState } from '../../../browser-automation/types';

export interface SnifferEntry {
  type: string;
  url: string;
  body: string;
  response?: string;
  timestamp: number;
  headers?: Record<string, string>;
}

export interface SnifferVerificationReport {
  valid: boolean;
  totalEntries: number;
  batchExecuteCount: number;
  validPayloadCount: number;
  corruptedPayloadCount: number;
  rpcidCounts: Record<string, number>;
  unusualActivityDetected: boolean;
  errors: string[];
  details: Array<{
    index: number;
    timestamp: number;
    url: string;
    rpcidInUrl?: string;
    rpcidInPayload?: string;
    matches: boolean;
    validFReq: boolean;
    validInnerPayload: boolean;
    hasResponseSentinel?: boolean;
    unusualActivityDetected?: boolean;
    error?: string;
  }>;
}

/**
 * Staged timeout constants for UI Generation fallback.
 */
export const TIMEOUT_SUBMISSION_MS = 6000;              // 6s for UI submission confirmation
export const DEFAULT_IMAGE_PROCESSING_TIMEOUT_MS = 40000; // 40s default for image generation
export const MAX_IMAGE_PROCESSING_TIMEOUT_MS = 50000;     // 50s hard cap for image generation
export const DEFAULT_VIDEO_PROCESSING_TIMEOUT_MS = 120000; // 120s (2 min) default for video generation
export const MAX_VIDEO_PROCESSING_TIMEOUT_MS = 135000;     // 135s (2 min 15s) hard cap for video generation
export const SERVER_IPC_GUARD_BUFFER_MS = 3000;          // 3s safety buffer for IPC/WS transport

/**
 * Interface contract matching PROJECT.md § Interface Contracts
 */
export interface TriggerUiGenParams {
  prompt: string;
  projectId?: string;
  mode: 'image' | 'video';
  timeoutMs?: number;
  idempotencyKey?: string;
  submissionTimeoutMs?: number;
  processingTimeoutMs?: number;
  jobId?: string;
  sceneId?: string;
  tabId?: number;
  inputImageAsset?: string;
  referenceImage?: string;
}

export interface CancelUiGenParams {
  id: string;
  reason?: string;
}

export interface TriggerUiGenResponse {
  ok: boolean;
  state: JobState;
  jobId?: string;
  projectId?: string;
  sceneId?: string;
  capturedRpc?: {
    url: string;
    rpcid: string;
    status: number;
    response: string;
  };
  firstImageUrl?: string;
  videoUrl?: string;
  domFallback?: boolean;
  error?: string;
  errorCode?:
    | 'TIMEOUT_SUBMITTING'
    | 'TIMEOUT_PROCESSING'
    | 'BLOCKED_REQUIRES_USER'
    | 'RATE_LIMITED'
    | 'UI_AUTOMATION_FAILED';
}

export interface CalculatedUiGenTimeouts {
  submissionTimeoutMs: number;
  processingTimeoutMs: number;
  totalClientTimeoutMs: number;
  serverGuardTimeoutMs: number;
}

export function calculateUiGenTimeouts(
  mode: 'image' | 'video' = 'image',
  customTimeoutMs?: number,
  customSubmissionTimeoutMs?: number
): CalculatedUiGenTimeouts {
  const isVideo = mode === 'video';
  const submissionTimeoutMs =
    typeof customSubmissionTimeoutMs === 'number' && customSubmissionTimeoutMs > 0
      ? customSubmissionTimeoutMs
      : TIMEOUT_SUBMISSION_MS;

  let processingTimeoutMs: number;
  if (isVideo) {
    if (typeof customTimeoutMs === 'number' && customTimeoutMs > 0) {
      processingTimeoutMs = Math.min(customTimeoutMs, MAX_VIDEO_PROCESSING_TIMEOUT_MS);
    } else {
      processingTimeoutMs = DEFAULT_VIDEO_PROCESSING_TIMEOUT_MS;
    }
  } else {
    if (typeof customTimeoutMs === 'number' && customTimeoutMs > 0) {
      processingTimeoutMs = Math.min(customTimeoutMs, MAX_IMAGE_PROCESSING_TIMEOUT_MS);
    } else {
      processingTimeoutMs = DEFAULT_IMAGE_PROCESSING_TIMEOUT_MS;
    }
  }

  const totalClientTimeoutMs = submissionTimeoutMs + processingTimeoutMs;
  const serverGuardTimeoutMs = totalClientTimeoutMs + SERVER_IPC_GUARD_BUFFER_MS;

  return {
    submissionTimeoutMs,
    processingTimeoutMs,
    totalClientTimeoutMs,
    serverGuardTimeoutMs,
  };
}

export function normalizeUiGenResponse(raw: any): TriggerUiGenResponse {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      state: 'FAILED',
      errorCode: 'UI_AUTOMATION_FAILED',
      error: 'Empty or invalid response from Extension Bridge',
    };
  }

  // Already conformant
  if (typeof raw.ok === 'boolean' && raw.state && raw.errorCode !== undefined) {
    return raw as TriggerUiGenResponse;
  }

  if (raw.ok === true || (!raw.error && (raw.firstImageUrl || raw.videoUrl || raw.capturedRpc))) {
    return {
      ok: true,
      state: 'COMPLETED',
      jobId: raw.jobId,
      projectId: raw.projectId,
      sceneId: raw.sceneId,
      capturedRpc: raw.capturedRpc,
      firstImageUrl: raw.firstImageUrl,
      videoUrl: raw.videoUrl,
      domFallback: raw.domFallback,
    };
  }

  const rawErr = String(raw.error || raw.message || 'Unknown error');
  let errorCode: TriggerUiGenResponse['errorCode'] = 'UI_AUTOMATION_FAILED';
  let state: JobState = 'FAILED';

  if (rawErr.includes('TIMEOUT_SUBMITTING') || rawErr.includes('NO_GEN_BUTTON') || rawErr.includes('PHASE1_FAILED')) {
    errorCode = 'TIMEOUT_SUBMITTING';
    state = 'TIMED_OUT';
  } else if (
    rawErr.includes('TIMEOUT_PROCESSING') ||
    rawErr.includes('TIMEOUT_WAITING_RPC') ||
    rawErr.includes('TIMEOUT_TRIGGER_UI_GEN') ||
    rawErr.includes('timeout')
  ) {
    errorCode = 'TIMEOUT_PROCESSING';
    state = 'TIMED_OUT';
  } else if (
    rawErr.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY') ||
    rawErr.includes('UNUSUAL_ACTIVITY') ||
    rawErr.includes('recaptcha') ||
    rawErr.includes('challenge') ||
    rawErr.includes('BLOCKED_REQUIRES_USER')
  ) {
    errorCode = 'BLOCKED_REQUIRES_USER';
    state = 'BLOCKED_REQUIRES_USER';
  } else if (rawErr.includes('RATE_LIMITED') || rawErr.includes('429') || rawErr.includes('quota') || rawErr.includes('RESOURCE_EXHAUSTED')) {
    errorCode = 'RATE_LIMITED';
    state = 'FAILED';
  } else if (rawErr === 'ABORTED' || rawErr === 'CANCELLED') {
    errorCode = 'UI_AUTOMATION_FAILED';
    state = 'TIMED_OUT';
  }

  return {
    ok: false,
    state,
    errorCode,
    error: rawErr,
    jobId: raw.jobId,
    projectId: raw.projectId,
    sceneId: raw.sceneId,
    domFallback: raw.domFallback,
  };
}


interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
  client?: WebSocket;
}

export class FlowBridgeServer {
  private static _instance: FlowBridgeServer | null = null;
  private wss: WebSocketServer | null = null;
  private secondaryWss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private pendingRequests = new Map<string, PendingRequest>();
  private port = BRIDGE_WS_PORT;
  private lastAutoReloadAt = 0;
  private cachedTabInfo: { data: any; fetchedAt: number } | null = null;
  private inflightTabInfoPromise: Promise<any> | null = null;

  private constructor() {}

  public static getInstance(): FlowBridgeServer {
    const g = globalThis as any;
    if (!g.__flowBridgeServerInstance) {
      g.__flowBridgeServerInstance = new FlowBridgeServer();
    }
    return g.__flowBridgeServerInstance;
  }

  public getPort(): number {
    return this.port;
  }

  private attachServerHandlers(server: WebSocketServer, listenPort: number, isPrimary: boolean): void {
    server.on('listening', () => {
      if (isPrimary) {
        this.port = listenPort;
      }
      console.log(`[FlowBridgeServer] 🌐 WebSocket Server đang lắng nghe tại ws://127.0.0.1:${listenPort}`);
    });

    server.on('connection', (ws: WebSocket) => {
      console.log(`[FlowBridgeServer] 🔌 Đã có Chrome Extension kết nối vào VanhSub (port ${listenPort})!`);
      this.registerClient(ws);
    });

    server.on('error', (err: any) => {
      if (err?.code === 'EADDRINUSE') {
        console.warn(`[FlowBridgeServer] ⚠️ Cổng ${listenPort} đang bận (EADDRINUSE), sử dụng cổng dự phòng.`);
        if (isPrimary && listenPort !== 8765) {
          this.port = 8765;
        }
      } else {
        console.error(`[FlowBridgeServer] ❌ Lỗi WebSocket Server (port ${listenPort}):`, err.message);
      }
    });
  }

  /**
   * Đăng ký một client WebSocket kết nối và gắn các event listener vòng đời (message, close, error).
   */
  public registerClient(ws: WebSocket): void {
    this.clients.add(ws);
    this.cachedTabInfo = null;

    const handleClientDisconnect = (reason: string) => {
      this.clients.delete(ws);
      this.cachedTabInfo = null;
      for (const [id, req] of Array.from(this.pendingRequests.entries())) {
        if (req.client === ws || this.clients.size === 0) {
          clearTimeout(req.timer);
          this.pendingRequests.delete(id);
          req.reject(new Error(`BRIDGE_DISCONNECTED: Chrome Extension đã ngắt kết nối (${reason}).`));
        }
      }
    };

    ws.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleIncomingMessage(msg);
      } catch (e: any) {
        console.error('[FlowBridgeServer] Lỗi phân tích cú pháp message từ Extension:', e.message);
      }
    });

    ws.on('close', () => {
      console.log('[FlowBridgeServer] 🔌 Chrome Extension đã ngắt kết nối.');
      handleClientDisconnect('kết nối đóng');
    });

    ws.on('error', (err: any) => {
      console.warn('[FlowBridgeServer] WebSocket client error:', err?.message || err);
      handleClientDisconnect(`lỗi client: ${err?.message || 'unknown'}`);
    });
  }

  /**
   * Khởi động WebSocket Server lắng nghe kết nối từ Chrome Extension.
   * Lắng nghe đồng thời cổng chính (9222) và cổng dự phòng (8765) để tránh xung đột cổng CDP.
   */
  public start(port = BRIDGE_WS_PORT): void {
    if (this.wss) return;
    this.port = port;

    try {
      this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' });
      this.attachServerHandlers(this.wss, this.port, true);
    } catch (err: any) {
      console.error('[FlowBridgeServer] ❌ Không thể khởi động WebSocket Server chính:', err.message);
    }

    const backupPort = this.port === 8765 ? 9222 : 8765;
    if (!this.secondaryWss) {
      try {
        this.secondaryWss = new WebSocketServer({ port: backupPort, host: '127.0.0.1' });
        this.attachServerHandlers(this.secondaryWss, backupPort, false);
      } catch (err: any) {
        console.warn(`[FlowBridgeServer] Không thể mở cổng phụ ${backupPort}:`, err.message);
      }
    }
  }

  /**
   * Dừng WebSocket Server.
   */
  public stop(): void {
    if (!this.wss && !this.secondaryWss) return;
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error('FlowBridgeServer stopped'));
      this.pendingRequests.delete(id);
    }
    for (const ws of this.clients) {
      try { ws.terminate(); } catch {}
    }
    this.clients.clear();
    this.cachedTabInfo = null;
    if (this.wss) {
      try { this.wss.close(); } catch {}
      this.wss = null;
    }
    if (this.secondaryWss) {
      try { this.secondaryWss.close(); } catch {}
      this.secondaryWss = null;
    }
    console.log('[FlowBridgeServer] Đã tắt WebSocket Server.');
  }

  /**
   * Kiểm tra xem hiện có Extension nào đang kết nối không.
   */
  public isConnected(): boolean {
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) return true;
    }
    return false;
  }

  /**
   * Alias tương thích ngược kiểm tra kết nối WebSocket của Chrome Extension.
   */
  public isExtensionConnected(): boolean {
    return this.isConnected();
  }

  /**
   * Lấy trạng thái hoạt động của Bridge.
   */
  public getStatus(): { running: boolean; connected: boolean; clientCount: number; port: number } {
    return {
      running: !!(this.wss || this.secondaryWss),
      connected: this.isConnected(),
      clientCount: this.clients.size,
      port: this.port,
    };
  }

  /**
   * Lấy thông tin chẩn đoán về tab Flow đang mở trên Chrome (URL, Project ID, grecaptcha...).
   * Có cache ngắn hạn 2s để tránh nghẽn khi nhiều component UI poll cùng lúc.
   */
  public async getFlowTabInfo(timeoutMs = 5000, fullDiag = false): Promise<any> {
    if (!this.isConnected()) {
      return { connected: false, error: 'Extension chưa kết nối' };
    }
    const client = this.getFirstActiveClient();
    if (!client) {
      return { connected: false, error: 'Không tìm thấy client WebSocket hợp lệ' };
    }

    if (!fullDiag && this.cachedTabInfo && Date.now() - this.cachedTabInfo.fetchedAt < 2000) {
      return this.cachedTabInfo.data;
    }
    if (!fullDiag && this.inflightTabInfoPromise) {
      return this.inflightTabInfoPromise;
    }

    const id = uuidv4();
    const reqPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve({ connected: false, error: 'Timeout khi lấy thông tin tab từ Chrome' });
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (res: any) => {
          if (!fullDiag && res && !res.error) {
            this.cachedTabInfo = { data: res, fetchedAt: Date.now() };
          }
          resolve(res);
        },
        reject: (err: any) => resolve({ connected: false, error: err?.message || String(err) }),
        timer,
        client,
      });

      try {
        client.send(JSON.stringify({ id, method: 'get_status', params: { fullDiag } }));
      } catch (sendErr: any) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        resolve({ connected: false, error: sendErr?.message || String(sendErr) });
      }
    }).finally(() => {
      if (!fullDiag) {
        this.inflightTabInfoPromise = null;
      }
    });

    if (!fullDiag) {
      this.inflightTabInfoPromise = reqPromise;
    }
    return reqPromise;
  }

  /**
   * Yêu cầu Chrome Extension tự reload chính nó (cập nhật code background.js mới).
   */
  public async reloadExtension(timeoutMs = 3000): Promise<{ ok: boolean; message: string }> {
    if (!this.isConnected()) {
      return { ok: false, message: 'Extension chưa kết nối' };
    }
    const client = this.getFirstActiveClient();
    if (!client) {
      return { ok: false, message: 'Không tìm thấy client WebSocket hợp lệ' };
    }

    const id = uuidv4();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve({ ok: true, message: 'Đã gửi lệnh reload tới Extension' });
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: () => resolve({ ok: true, message: 'Extension đã reload thành công' }),
        reject: () => resolve({ ok: true, message: 'Extension đang reload' }),
        timer,
        client,
      });

      try {
        client.send(JSON.stringify({ id, method: 'reload_extension', params: {} }));
      } catch (sendErr: any) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        resolve({ ok: false, message: sendErr?.message || String(sendErr) });
      }
    });
  }

  /**
   * Reload tab Flow trên Google Chrome để làm mới phiên làm việc (WIZ_global_data, SNlM0e, reCAPTCHA).
   */
  public async reloadTab(timeoutMs = 20000): Promise<{ ok: boolean; message: string }> {
    if (!this.isConnected()) {
      return { ok: false, message: 'Extension chưa kết nối' };
    }
    const client = this.getFirstActiveClient();
    if (!client) {
      return { ok: false, message: 'Không tìm thấy client WebSocket hợp lệ' };
    }

    const id = uuidv4();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve({ ok: true, message: 'Đã gửi lệnh reload tab tới Extension' });
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: () => resolve({ ok: true, message: 'Tab Flow đã reload thành công' }),
        reject: (err) => resolve({ ok: false, message: err?.message || String(err) }),
        timer,
        client,
      });

      try {
        client.send(JSON.stringify({ id, method: 'reload_tab', params: {} }));
      } catch (sendErr: any) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        resolve({ ok: false, message: sendErr?.message || String(sendErr) });
      }
    });
  }

  /**
   * Quét DOM trong tab Flow để tìm các nút bấm, ô nhập prompt và mode toggle.
   */
  public async inspectDom(timeoutMs = 5000): Promise<any> {
    if (!this.isConnected()) return { error: 'NOT_CONNECTED' };
    const client = this.getFirstActiveClient();
    if (!client) return { error: 'NO_CLIENT' };

    const id = uuidv4();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve({ error: 'TIMEOUT' });
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (res: any) => resolve(res),
        reject: (err: any) => resolve({ error: err?.message || String(err) }),
        timer,
        client,
      });

      try {
        client.send(JSON.stringify({ id, method: 'dom_inspect', params: {} }));
      } catch (sendErr: any) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        resolve({ error: sendErr?.message || String(sendErr) });
      }
    });
  }

  /**
   * Huỷ một tác vụ UI Generation đang thực thi trên Chrome Extension.
   * Gửi message WebSocket `cancel_ui_gen` để yêu cầu Extension dừng ngay lập tức.
   */
  public cancelUiGen(params: CancelUiGenParams): boolean;
  public cancelUiGen(id: string, reason?: string): boolean;
  public cancelUiGen(idOrParams: string | CancelUiGenParams, reason?: string): boolean {
    const id = typeof idOrParams === 'string' ? idOrParams : idOrParams.id;
    const effReason = typeof idOrParams === 'string' ? reason : idOrParams.reason;
    const client = this.getFirstActiveClient();
    if (client && client.readyState === WebSocket.OPEN) {
      try {
        client.send(
          JSON.stringify({
            id: uuidv4(),
            method: 'cancel_ui_gen',
            type: 'cancel_ui_gen',
            params: {
              id,
              reason: effReason || 'Aborted by FlowBridgeServer',
            },
          })
        );
        return true;
      } catch (err: any) {
        console.warn(`[FlowBridgeServer] Không thể gửi cancel_ui_gen cho task ${id}:`, err?.message || err);
      }
    }
    return false;
  }

  /**
   * Kích hoạt sinh ảnh/video qua giao diện người dùng (DOM / CDP Trusted Click)
   * trên Google Flow với kiến trúc timeout phân tầng và huỷ 2 chiều (bi-directional AbortSignal).
   */
  public async triggerUiGen(
    params: TriggerUiGenParams,
    signal?: AbortSignal
  ): Promise<TriggerUiGenResponse>;
  public async triggerUiGen(
    prompt: string,
    timeoutMs?: number,
    projectId?: string,
    mode?: 'image' | 'video',
    signal?: AbortSignal,
    extraOptions?: { inputImageAsset?: string; referenceImage?: string; jobId?: string; sceneId?: string }
  ): Promise<TriggerUiGenResponse>;
  public async triggerUiGen(
    paramsOrPrompt: TriggerUiGenParams | string,
    timeoutMsOrSignal?: number | AbortSignal,
    projectId?: string,
    mode?: 'image' | 'video',
    signal?: AbortSignal,
    extraOptions?: { inputImageAsset?: string; referenceImage?: string; jobId?: string; sceneId?: string }
  ): Promise<TriggerUiGenResponse> {
    let effParams: TriggerUiGenParams;
    let effSignal: AbortSignal | undefined;

    if (typeof paramsOrPrompt === 'object' && paramsOrPrompt !== null) {
      effParams = paramsOrPrompt;
      effSignal = timeoutMsOrSignal instanceof AbortSignal ? timeoutMsOrSignal : signal;
    } else {
      effParams = {
        prompt: paramsOrPrompt,
        timeoutMs: typeof timeoutMsOrSignal === 'number' ? timeoutMsOrSignal : undefined,
        projectId,
        mode: mode || 'image',
        inputImageAsset: extraOptions?.inputImageAsset,
        referenceImage: extraOptions?.referenceImage,
        jobId: extraOptions?.jobId,
        sceneId: extraOptions?.sceneId,
      };
      effSignal = signal;
    }

    const { prompt: promptText, projectId: targetProjectId, mode: targetMode, idempotencyKey } = effParams;
    const timeouts = calculateUiGenTimeouts(targetMode, effParams.timeoutMs, effParams.submissionTimeoutMs);

    console.warn(
      `[FlowBridgeServer] ⚠️ triggerUiGen fallback được kích hoạt (mode=${targetMode}, ` +
      `submitTimeout=${timeouts.submissionTimeoutMs / 1000}s, ` +
      `procTimeout=${timeouts.processingTimeoutMs / 1000}s, ` +
      `guardTimeout=${timeouts.serverGuardTimeoutMs / 1000}s).`
    );

    if (effSignal?.aborted) {
      return {
        ok: false,
        state: 'TIMED_OUT',
        error: 'ABORTED',
        errorCode: 'UI_AUTOMATION_FAILED',
      };
    }

    if (!this.isConnected()) {
      return {
        ok: false,
        state: 'FAILED',
        error: 'NOT_CONNECTED: Extension Bridge chưa kết nối',
        errorCode: 'UI_AUTOMATION_FAILED',
      };
    }

    const client = this.getFirstActiveClient();
    if (!client) {
      return {
        ok: false,
        state: 'FAILED',
        error: 'NO_CLIENT: Không tìm thấy client WebSocket hoạt động',
        errorCode: 'UI_AUTOMATION_FAILED',
      };
    }

    const id = uuidv4();

    return new Promise<TriggerUiGenResponse>((resolve) => {
      let cleanedUp = false;

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        if (effSignal) {
          effSignal.removeEventListener('abort', onAbort);
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        console.warn(`[FlowBridgeServer] ⏱️ triggerUiGen server guard timeout (${timeouts.serverGuardTimeoutMs / 1000}s) vượt ngưỡng.`);
        resolve({
          ok: false,
          state: 'TIMED_OUT',
          errorCode: 'TIMEOUT_PROCESSING',
          error: `UI generation processing timed out after ${timeouts.processingTimeoutMs / 1000}s`,
        });
      }, timeouts.serverGuardTimeoutMs);

      const onAbort = () => {
        const reason = effSignal?.reason ? String(effSignal.reason) : 'Aborted by caller';
        console.warn(`[FlowBridgeServer] 🛑 triggerUiGen nhận tín hiệu huỷ (id=${id}, reason="${reason}"). Gửi cancel_ui_gen sang Extension...`);
        cleanup();

        // Bi-directional propagation to Extension over WebSocket:
        if (client && client.readyState === WebSocket.OPEN) {
          try {
            client.send(
              JSON.stringify({
                id: uuidv4(),
                method: 'cancel_ui_gen',
                type: 'cancel_ui_gen',
                params: {
                  id,
                  reason,
                },
              })
            );
          } catch (cancelErr: any) {
            console.warn('[FlowBridgeServer] Lỗi khi gửi cancel_ui_gen tới Extension:', cancelErr?.message || cancelErr);
          }
        }

        resolve({
          ok: false,
          state: 'TIMED_OUT',
          error: 'ABORTED',
          errorCode: 'UI_AUTOMATION_FAILED',
        });
      };

      if (effSignal) {
        effSignal.addEventListener('abort', onAbort, { once: true });
      }

      this.pendingRequests.set(id, {
        resolve: (res: any) => {
          cleanup();
          const normalized = normalizeUiGenResponse(res);
          console.log(
            `[FlowBridgeServer] 📥 triggerUiGen hoàn tất: ok=${normalized.ok}, state=${normalized.state}, ` +
            `error=${normalized.error || 'none'}`
          );
          resolve(normalized);
        },
        reject: (err: any) => {
          cleanup();
          const errStr = err?.message || String(err);
          console.warn(`[FlowBridgeServer] ⚠️ triggerUiGen reject:`, errStr);
          resolve(normalizeUiGenResponse({ ok: false, error: errStr }));
        },
        timer,
        client,
      });

      try {
        client.send(
          JSON.stringify({
            id,
            method: 'trigger_ui_gen',
            params: {
              prompt: promptText,
              projectId: targetProjectId,
              mode: targetMode,
              idempotencyKey,
              jobId: effParams.jobId || id,
              sceneId: effParams.sceneId,
              tabId: effParams.tabId,
              inputImageAsset: effParams.inputImageAsset,
              referenceImage: effParams.referenceImage,
              timeoutMs: timeouts.processingTimeoutMs,
              submissionTimeoutMs: timeouts.submissionTimeoutMs,
              processingTimeoutMs: timeouts.processingTimeoutMs,
            },
          })
        );
      } catch (sendErr: any) {
        cleanup();
        resolve({
          ok: false,
          state: 'FAILED',
          errorCode: 'UI_AUTOMATION_FAILED',
          error: `SEND_FAILED: ${sendErr?.message || String(sendErr)}`,
        });
      }
    });
  }

  /**
   * Kích hoạt phục hồi tương tác người dùng (CDP Trusted Click) trên Chrome Extension khi gặp bot flag.
   */
  public async recoverUnusualActivity(
    timeoutMs = 15000,
    projectId?: string,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; message?: string }> {
    if (signal?.aborted) return { ok: false, message: 'CANCELLED' };
    if (!this.isConnected()) return { ok: false, message: 'EXTENSION_NOT_CONNECTED' };
    const client = this.getFirstActiveClient();
    if (!client) return { ok: false, message: 'NO_CLIENT' };

    const id = uuidv4();
    return new Promise((resolve) => {
      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        signal?.removeEventListener('abort', onAbort);
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve({ ok: false, message: 'TIMEOUT_RECOVER_UNUSUAL_ACTIVITY' });
      }, timeoutMs);

      const onAbort = () => {
        cleanup();
        resolve({ ok: false, message: 'CANCELLED' });
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.pendingRequests.set(id, {
        resolve: (res: any) => {
          cleanup();
          resolve(res || { ok: true });
        },
        reject: (err: any) => {
          cleanup();
          resolve({ ok: false, message: err?.message || String(err) });
        },
        timer,
        client,
      });

      try {
        client.send(JSON.stringify({ id, method: 'recover_unusual_activity', params: { projectId } }));
      } catch (sendErr: any) {
        cleanup();
        resolve({ ok: false, message: sendErr?.message || String(sendErr) });
      }
    });
  }

  /**
   * Chạy trực tiếp 1 biểu thức JavaScript trong MAIN world của tab Flow trên Chrome.
   */
  public async tabEval(code: string, timeoutMs = 10000): Promise<any> {
    if (!this.isConnected()) throw new Error('Extension chưa kết nối');
    const client = this.getFirstActiveClient();
    if (!client) throw new Error('Client không khả dụng');

    const id = uuidv4();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('tabEval timeout'));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (res) => resolve(res),
        reject,
        timer,
        client,
      });

      try {
        client.send(JSON.stringify({ id, method: 'tab_eval', params: { code } }));
      } catch (sendErr: any) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(sendErr);
      }
    });
  }

  public async ensureProject(projectId?: string, signal?: AbortSignal): Promise<{ projectId: string; url: string }> {
    if (signal?.aborted) throw new Error('CANCELLED: Tác vụ đã bị người dùng huỷ bỏ.');
    const client = this.getFirstActiveClient();
    if (!client) throw new Error('Chrome Extension chưa kết nối.');
    const id = uuidv4();
    return new Promise((resolve, reject) => {
      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        signal?.removeEventListener('abort', onAbort);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Hết thời gian xác nhận project Flow. Kiểm tra Chrome và cập nhật extension trước khi tiếp tục.'));
      }, 45000);
      const onAbort = () => {
        cleanup();
        reject(new Error('CANCELLED: Tác vụ đã bị người dùng huỷ bỏ.'));
      };
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.pendingRequests.set(id, {
        resolve: (res: any) => {
          cleanup();
          if (!res?.projectId || (projectId && res.projectId !== projectId)) {
            reject(new Error('Flow trả về project không khớp với tác vụ.'));
          } else resolve(res);
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
        timer,
        client,
      });
      try { client.send(JSON.stringify({ id, method: 'ensure_project', params: { projectId, createNew: !projectId } })); }
      catch (error) { cleanup(); reject(error); }
    });
  }

  /**
   * Gửi 1 RPC batchexecute qua Chrome Extension và nhận lại chuỗi raw response.
   */
  public async sendBatchRpc(
    rpcid: string,
    innerPayload: unknown[],
    captchaAction?: string,
    projectId?: string,
    timeoutMs = 60000,
    signal?: AbortSignal
  ): Promise<string> {
    if (signal?.aborted) {
      throw new Error('CANCELLED: Tác vụ đã bị người dùng huỷ bỏ.');
    }
    if (!this.isConnected()) {
      throw new Error(
        'EXTENSION_NOT_CONNECTED: Chưa có Chrome Extension (VanhSub Flow Bridge) nào kết nối tới ứng dụng. ' +
        'Vui lòng mở Google Chrome, đảm bảo extension đã được bật và có ít nhất 1 tab flow.google.com đang mở.'
      );
    }

    const client = this.getFirstActiveClient();
    if (!client) {
      throw new Error('EXTENSION_CLIENT_UNAVAILABLE: Không tìm thấy client WebSocket hợp lệ.');
    }

    const id = uuidv4();
    const fReq = JSON.stringify([[[rpcid, JSON.stringify(innerPayload), null, 'generic']]]);

    console.log(`[FlowBridgeServer] 📤 Gửi ${rpcid} sang Chrome Extension (action=${captchaAction || 'none'}, id=${id})...`);

    return new Promise<string>((resolve, reject) => {
      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        signal?.removeEventListener('abort', onAbort);
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`BRIDGE_TIMEOUT: Chrome Extension không phản hồi sau ${timeoutMs / 1000}s cho RPC ${rpcid}`));
      }, timeoutMs);

      const onAbort = () => {
        cleanup();
        reject(new Error('CANCELLED: Tác vụ đã bị người dùng huỷ bỏ.'));
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.pendingRequests.set(id, {
        resolve: (res) => {
          cleanup();
          if (!res || typeof res !== 'object') {
            reject(new Error('BRIDGE_EMPTY_RESPONSE: Phản hồi từ Chrome Extension không hợp lệ.'));
            return;
          }
          if (res.error) {
            reject(new Error(`BRIDGE_ERROR: ${typeof res.error === 'string' ? res.error : JSON.stringify(res.error)}`));
            return;
          }
          if (res.status !== 200 && res.status !== 0) {
            reject(new Error(`HTTP ${res.status} từ Chrome: ${(res.body || res.error || '').slice(0, 300)}`));
          } else if (typeof res.body !== 'string' || res.body.trim().length === 0) {
            reject(new Error(`BRIDGE_EMPTY_BODY: Phản hồi từ Chrome không chứa nội dung RPC body hợp lệ.`));
          } else {
            resolve(res.body);
          }
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
        timer,
        client,
      });

      try {
        client.send(
          JSON.stringify({
            id,
            method: 'batch_rpc',
            params: {
              rpcid,
              freq: fReq,
              captchaAction,
              projectId,
            },
          })
        );
      } catch (sendErr: any) {
        cleanup();
        reject(new Error(`BRIDGE_SEND_FAILED: Không thể gửi dữ liệu tới Extension: ${sendErr?.message || sendErr}`));
      }
    });
  }

  /**
   * Yêu cầu Extension mint fresh reCAPTCHA token qua invisible widget (chuẩn FlowKit).
   */
  public async mintCaptcha(captchaAction = 'IMAGE_GENERATION', timeoutMs = 30000): Promise<string> {
    if (!this.isConnected()) {
      throw new Error('EXTENSION_NOT_CONNECTED: Chưa có Chrome Extension kết nối.');
    }
    const client = this.getFirstActiveClient();
    if (!client) {
      throw new Error('EXTENSION_CLIENT_UNAVAILABLE: Không tìm thấy client WebSocket hợp lệ.');
    }

    const id = uuidv4();
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`BRIDGE_TIMEOUT: Extension không trả về captcha token sau ${timeoutMs / 1000}s`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (res: any) => {
          if (res?.token) {
            resolve(res.token);
          } else if (typeof res === 'string') {
            resolve(res);
          } else {
            reject(new Error(res?.error || 'NO_TOKEN_RETURNED'));
          }
        },
        reject,
        timer,
        client,
      });

      try {
        client.send(JSON.stringify({ id, method: 'solve_captcha', params: { captchaAction } }));
      } catch (sendErr: any) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new Error(`BRIDGE_SEND_FAILED: Không thể gửi lệnh giải CAPTCHA tới Extension: ${sendErr?.message || sendErr}`));
      }
    });
  }

  private getFirstActiveClient(): WebSocket | null {
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) return ws;
    }
    return null;
  }

  private handleIncomingMessage(msg: any): void {
    const { id, result, error, type } = msg;

    if (type === 'HANDSHAKE') {
      const ver = msg.version || '1.0.0';
      console.log(`[FlowBridgeServer] 🤝 Nhận handshake từ Extension v${ver}`);
      if (ver !== '1.0.5' && Date.now() - this.lastAutoReloadAt > 60_000) {
        this.lastAutoReloadAt = Date.now();
        console.log(`[FlowBridgeServer] 🔄 Phát hiện Extension v${ver} cũ. Tự động yêu cầu Extension reload lên v1.0.5...`);
        setTimeout(() => {
          this.reloadExtension().catch(() => {});
        }, 500);
      }
      return;
    }

    if (!id || !this.pendingRequests.has(id)) return;

    const req = this.pendingRequests.get(id)!;
    clearTimeout(req.timer);
    this.pendingRequests.delete(id);

    if (error) {
      req.reject(new Error(typeof error === 'string' ? error : JSON.stringify(error)));
    } else if (result) {
      req.resolve(result);
    } else {
      req.reject(new Error('Phản hồi trống từ Extension'));
    }
  }

  /**
   * Phân tích và kiểm tra tính toàn vẹn của file hoặc danh sách sniffer_dump.json:
   * 1. Giải mã f.req từ body form data
   * 2. Kiểm tra tính hợp lệ của cấu trúc batch execute [[[rpcid, innerPayload, ...]]]
   * 3. Đối chiếu rpcid trong URL với rpcid trong payload
   * 4. Kiểm tra JSON cú pháp của innerPayload
   * 5. Nhận diện các lỗi PUBLIC_ERROR_UNUSUAL_ACTIVITY trong response
   */
  public static verifySnifferDump(input?: string | SnifferEntry[]): SnifferVerificationReport {
    let entries: SnifferEntry[] = [];
    const errors: string[] = [];

    if (!input) {
      input = path.join(process.cwd(), 'sniffer_dump.json');
    }

    if (typeof input === 'string') {
      try {
        if (!fs.existsSync(input)) {
          return {
            valid: false,
            totalEntries: 0,
            batchExecuteCount: 0,
            validPayloadCount: 0,
            corruptedPayloadCount: 0,
            rpcidCounts: {},
            unusualActivityDetected: false,
            errors: [`Tệp sniffer_dump không tồn tại: ${input}`],
            details: [],
          };
        }
        const raw = fs.readFileSync(input, 'utf-8');
        entries = JSON.parse(raw);
        if (!Array.isArray(entries)) {
          return {
            valid: false,
            totalEntries: 0,
            batchExecuteCount: 0,
            validPayloadCount: 0,
            corruptedPayloadCount: 0,
            rpcidCounts: {},
            unusualActivityDetected: false,
            errors: ['Nội dung sniffer_dump.json không phải là một mảng JSON hợp lệ'],
            details: [],
          };
        }
      } catch (e: any) {
        return {
          valid: false,
          totalEntries: 0,
          batchExecuteCount: 0,
          validPayloadCount: 0,
          corruptedPayloadCount: 0,
          rpcidCounts: {},
          unusualActivityDetected: false,
          errors: [`Lỗi khi đọc file sniffer dump: ${e.message || e}`],
          details: [],
        };
      }
    } else if (Array.isArray(input)) {
      entries = input;
    }

    let batchExecuteCount = 0;
    let validPayloadCount = 0;
    let corruptedPayloadCount = 0;
    let unusualActivityDetected = false;
    const rpcidCounts: Record<string, number> = {};
    const details: SnifferVerificationReport['details'] = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const url = String(entry.url || '');
      const body = String(entry.body || '');
      const response = String(entry.response || '');

      const isBatch = url.includes('batchexecute') || body.includes('f.req');
      if (!isBatch) {
        continue;
      }
      batchExecuteCount++;

      // Trích xuất rpcids từ URL query param
      let rpcidInUrl: string | undefined;
      const urlMatch = url.match(/[?&]rpcids=([^&]+)/);
      if (urlMatch) {
        rpcidInUrl = decodeURIComponent(urlMatch[1]);
      }

      // Trích xuất f.req từ body
      let validFReq = false;
      let validInnerPayload = false;
      let rpcidInPayload: string | undefined;
      let entryError: string | undefined;

      let fReqRaw: string | undefined;
      if (body.startsWith('f.req=')) {
        const rawVal = body.slice(6);
        const ampIdx = rawVal.indexOf('&');
        fReqRaw = ampIdx >= 0 ? rawVal.slice(0, ampIdx) : rawVal;
      } else {
        const match = body.match(/(?:^|&)f\.req=([^&]+)/);
        if (match) {
          fReqRaw = match[1];
        }
      }

      const payloadRpcids: string[] = [];
      if (fReqRaw) {
        try {
          const decoded = decodeURIComponent(fReqRaw.replace(/\+/g, ' '));
          const parsedEnvelope = JSON.parse(decoded);

          if (Array.isArray(parsedEnvelope) && Array.isArray(parsedEnvelope[0]) && Array.isArray(parsedEnvelope[0][0])) {
            validFReq = true;
            let allCallsValid = parsedEnvelope[0].length > 0;
            if (parsedEnvelope[0].length === 0) {
              entryError = 'Gói tin f.req rỗng, không chứa RPC call nào';
              validInnerPayload = false;
            } else {
              for (const call of parsedEnvelope[0]) {
                if (!Array.isArray(call) || typeof call[0] !== 'string' || !call[0]) {
                  allCallsValid = false;
                  entryError = 'Cấu trúc RPC call bên trong f.req không hợp lệ';
                  break;
                }
                const curRpcId = call[0];
                payloadRpcids.push(curRpcId);
                rpcidCounts[curRpcId] = (rpcidCounts[curRpcId] || 0) + 1;

                const innerRaw = call[1];
                let callInnerValid = false;
                if (typeof innerRaw === 'string') {
                  try {
                    const innerParsed = JSON.parse(innerRaw);
                    callInnerValid = Array.isArray(innerParsed) || (typeof innerParsed === 'object' && innerParsed !== null);
                    if (!callInnerValid) {
                      entryError = `Inner payload của ${curRpcId} không phải JSON object hoặc array hợp lệ`;
                    }
                  } catch (innerErr: any) {
                    entryError = `Inner payload của ${curRpcId} không thể parse JSON: ${innerErr.message}`;
                    callInnerValid = false;
                  }
                } else if (Array.isArray(innerRaw) || (typeof innerRaw === 'object' && innerRaw !== null)) {
                  callInnerValid = true;
                } else {
                  entryError = `Inner payload của ${curRpcId} không tồn tại hoặc sai định dạng`;
                }

                if (!callInnerValid) {
                  allCallsValid = false;
                  break;
                }
              }
              validInnerPayload = allCallsValid;
            }
            rpcidInPayload = payloadRpcids.join(',');
          } else {
            entryError = 'Cấu trúc f.req không khớp quy chuẩn batchexecute array [[[rpcid, innerPayload, ...]]]';
          }
        } catch (fReqErr: any) {
          entryError = `Lỗi phân tích cú pháp f.req: ${fReqErr.message}`;
        }
      } else {
        entryError = 'Không tìm thấy tham số f.req trong body request';
      }

      const hasResponseSentinel = response ? response.startsWith(")]}'\n") || response.startsWith(")]}'") : undefined;
      const entryUnusual = response.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY') || body.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY');
      if (entryUnusual) {
        unusualActivityDetected = true;
      }

      const urlRpcids = rpcidInUrl ? rpcidInUrl.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const matches = Boolean(
        urlRpcids.length > 0 && payloadRpcids.length > 0
          ? payloadRpcids.some((id) => urlRpcids.includes(id)) || urlRpcids.some((id) => payloadRpcids.includes(id))
          : validFReq && payloadRpcids.length > 0
      );

      if (validFReq && validInnerPayload && (urlRpcids.length === 0 || matches)) {
        validPayloadCount++;
      } else {
        corruptedPayloadCount++;
        errors.push(`Gói tin #${i + 1} (${rpcidInPayload || rpcidInUrl || 'unknown'}): ${entryError || 'Mismatch rpcid giữa URL và payload'}`);
      }

      details.push({
        index: i,
        timestamp: entry.timestamp,
        url,
        rpcidInUrl,
        rpcidInPayload,
        matches,
        validFReq,
        validInnerPayload,
        hasResponseSentinel,
        unusualActivityDetected: entryUnusual,
        error: entryError,
      });
    }

    const isValid = batchExecuteCount > 0 && corruptedPayloadCount === 0;

    return {
      valid: isValid,
      totalEntries: entries.length,
      batchExecuteCount,
      validPayloadCount,
      corruptedPayloadCount,
      rpcidCounts,
      unusualActivityDetected,
      errors,
      details,
    };
  }

  public verifySnifferDump(filePathOrEntries?: string | SnifferEntry[]): SnifferVerificationReport {
    return FlowBridgeServer.verifySnifferDump(filePathOrEntries);
  }
}

export function getFlowBridgeServer(): FlowBridgeServer {
  return FlowBridgeServer.getInstance();
}
