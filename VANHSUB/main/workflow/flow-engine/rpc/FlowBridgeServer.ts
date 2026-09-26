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

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
}

export class FlowBridgeServer {
  private static _instance: FlowBridgeServer | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private pendingRequests = new Map<string, PendingRequest>();
  private port = BRIDGE_WS_PORT;

  private constructor() {}

  public static getInstance(): FlowBridgeServer {
    const g = globalThis as any;
    if (!g.__flowBridgeServerInstance) {
      g.__flowBridgeServerInstance = new FlowBridgeServer();
    }
    return g.__flowBridgeServerInstance;
  }

  /**
   * Khởi động WebSocket Server lắng nghe kết nối từ Chrome Extension.
   */
  public start(port = BRIDGE_WS_PORT): void {
    if (this.wss) return;
    this.port = port;

    try {
      this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' });

      this.wss.on('listening', () => {
        console.log(`[FlowBridgeServer] 🌐 WebSocket Server đang lắng nghe tại ws://127.0.0.1:${this.port}`);
      });

      this.wss.on('connection', (ws: WebSocket) => {
        console.log('[FlowBridgeServer] 🔌 Đã có Chrome Extension kết nối vào VanhSub!');
        this.clients.add(ws);

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
          this.clients.delete(ws);
        });

        ws.on('error', (err: any) => {
          console.warn('[FlowBridgeServer] WebSocket client error:', err.message);
          this.clients.delete(ws);
        });
      });

      this.wss.on('error', (err: any) => {
        console.error('[FlowBridgeServer] ❌ Lỗi WebSocket Server:', err.message);
      });
    } catch (err: any) {
      console.error('[FlowBridgeServer] ❌ Không thể khởi động WebSocket Server:', err.message);
    }
  }

  /**
   * Dừng WebSocket Server.
   */
  public stop(): void {
    if (!this.wss) return;
    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error('FlowBridgeServer stopped'));
      this.pendingRequests.delete(id);
    }
    this.clients.clear();
    this.wss.close();
    this.wss = null;
    console.log('[FlowBridgeServer] Đã tắt WebSocket Server.');
  }

  /**
   * Kiểm tra xem hiện có Extension nào đang kết nối không.
   */
  public isConnected(): boolean {
    return this.clients.size > 0;
  }

  /**
   * Lấy trạng thái hoạt động của Bridge.
   */
  public getStatus(): { running: boolean; connected: boolean; clientCount: number; port: number } {
    return {
      running: !!this.wss,
      connected: this.isConnected(),
      clientCount: this.clients.size,
      port: this.port,
    };
  }

  /**
   * Lấy thông tin chẩn đoán về tab Flow đang mở trên Chrome (URL, Project ID, grecaptcha...).
   */
  public async getFlowTabInfo(timeoutMs = 5000): Promise<any> {
    if (!this.isConnected()) {
      return { connected: false, error: 'Extension chưa kết nối' };
    }
    const client = this.getFirstActiveClient();
    if (!client) {
      return { connected: false, error: 'Không tìm thấy client WebSocket hợp lệ' };
    }

    const id = uuidv4();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve({ connected: true, error: 'Timeout khi lấy thông tin tab từ Chrome' });
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (res: any) => resolve(res),
        reject: (err: any) => resolve({ connected: true, error: err?.message || String(err) }),
        timer,
      });

      client.send(JSON.stringify({ id, method: 'get_status', params: {} }));
    });
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
      });

      client.send(JSON.stringify({ id, method: 'reload_extension', params: {} }));
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
      });

      client.send(JSON.stringify({ id, method: 'reload_tab', params: {} }));
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
      });

      client.send(JSON.stringify({ id, method: 'dom_inspect', params: {} }));
    });
  }

  /**
   * Kích hoạt tạo ảnh/video trực tiếp qua giao diện Chrome tab (nhập prompt và click nút tạo thật)
   * Giúp reCAPTCHA nhận diện tương tác người dùng thật 100%, không bị đánh dấu bot.
   */
  public async triggerUiGen(prompt: string, timeoutMs = 20000): Promise<any> {
    if (!this.isConnected()) return { error: 'NOT_CONNECTED' };
    const client = this.getFirstActiveClient();
    if (!client) return { error: 'NO_CLIENT' };

    const id = uuidv4();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve({ error: 'TIMEOUT_TRIGGER_UI_GEN' });
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (res: any) => resolve(res),
        reject: (err: any) => resolve({ error: err?.message || String(err) }),
        timer,
      });

      client.send(JSON.stringify({ id, method: 'trigger_ui_gen', params: { prompt } }));
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
      });

      client.send(JSON.stringify({ id, method: 'tab_eval', params: { code } }));
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
    timeoutMs = 60000
  ): Promise<string> {
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
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`BRIDGE_TIMEOUT: Chrome Extension không phản hồi sau ${timeoutMs / 1000}s cho RPC ${rpcid}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (res) => {
          if (res.status !== 200 && res.status !== 0) {
            reject(new Error(`HTTP ${res.status} từ Chrome: ${(res.body || res.error || '').slice(0, 300)}`));
          } else {
            resolve(res.body);
          }
        },
        reject,
        timer,
      });

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
      });

      client.send(JSON.stringify({ id, method: 'solve_captcha', params: { captchaAction } }));
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
      if (ver !== '1.0.5') {
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
