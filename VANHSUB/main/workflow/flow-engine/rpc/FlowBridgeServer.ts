/**
 * FlowBridgeServer.ts
 *
 * WebSocket Server chạy trên 127.0.0.1:9222 bên trong Electron main process.
 * Đóng vai trò cầu nối 2 chiều giữa VanhSub Desktop và Chrome Extension (VanhSub Flow Bridge).
 *
 * Cho phép Electron chuyển giao toàn bộ các RPC yêu cầu CAPTCHA (tạo ảnh, tạo video)
 * sang tab Google Chrome thật của người dùng để ký reCAPTCHA với điểm tín nhiệm cao (0.9).
 */

import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { BRIDGE_WS_PORT } from './FlowBatchConstants';

interface PendingRequest {
  resolve: (value: { status: number; body: string }) => void;
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
            reject(new Error(`HTTP ${res.status} từ Chrome: ${res.body.slice(0, 300)}`));
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

  private getFirstActiveClient(): WebSocket | null {
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) return ws;
    }
    return null;
  }

  private handleIncomingMessage(msg: any): void {
    const { id, result, error, type } = msg;

    if (type === 'HANDSHAKE') {
      console.log(`[FlowBridgeServer] 🤝 Nhận handshake từ Extension v${msg.version || '1.0.0'}`);
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
}

export function getFlowBridgeServer(): FlowBridgeServer {
  return FlowBridgeServer.getInstance();
}
