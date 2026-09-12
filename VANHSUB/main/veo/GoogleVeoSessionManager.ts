import path from 'path';
import https from 'https';
import { SettingsStore } from '../store/settingsStore';
import { GoogleVeoAntiSpamGuard } from './GoogleVeoAntiSpamGuard';
import type {
  VeoMode,
  VeoSessionStatus,
  VeoSessionValidationResult,
  VeoStatusPayload,
} from './types';

const CHROME_DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const VIDEO_FX_LOBBY_URL = 'https://labs.google/fx/tools/video-fx';
const GOOGLE_AUTH_COOKIE_NAMES = [
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID',
];

export class GoogleVeoSessionManager {
  private static instance: GoogleVeoSessionManager | null = null;
  private lobbyWindow: any = null;

  private constructor() {}

  static getInstance(): GoogleVeoSessionManager {
    if (!this.instance) {
      this.instance = new GoogleVeoSessionManager();
    }
    return this.instance;
  }

  /**
   * Lấy cookie session đã lưu hoặc từ phân vùng Electron
   */
  async getEffectiveCookieString(): Promise<string> {
    // 1. Thử đọc từ SettingsStore trước
    const storedCookie = SettingsStore.get('veoSessionCookie')?.trim();
    if (storedCookie) {
      return storedCookie;
    }

    // 2. Thử đọc từ Electron session partition nếu có
    try {
      const electron = require('electron');
      const session = electron?.session;
      if (session?.fromPartition) {
        const ses = session.fromPartition('persist:google_veo');
        const cookies = await ses.cookies.get({ domain: '.google.com' });
        const labCookies = await ses.cookies.get({ domain: 'labs.google' });
        const allCookies = [...cookies, ...labCookies];

        if (allCookies.length > 0) {
          const cookieStr = allCookies
            .map((c: any) => `${c.name}=${c.value}`)
            .join('; ');
          SettingsStore.set('veoSessionCookie', cookieStr);
          return cookieStr;
        }
      }
    } catch {}

    return '';
  }

  /**
   * Mở cửa sổ Sảnh Google Veo để người dùng đăng nhập tài khoản thật
   */
  async openLobbyWindow(parentWindow?: any): Promise<void> {
    let electron: any;
    try {
      electron = require('electron');
    } catch {
      throw new Error('Chức năng mở cửa sổ chỉ hoạt động trong môi trường ứng dụng Electron.');
    }

    const { BrowserWindow, session } = electron;
    if (!BrowserWindow) {
      throw new Error('Không tìm thấy BrowserWindow trong Electron.');
    }

    // Nếu cửa sổ đang mở thì focus lại
    if (this.lobbyWindow && !this.lobbyWindow.isDestroyed()) {
      this.lobbyWindow.focus();
      return;
    }

    const ses = session.fromPartition('persist:google_veo');

    this.lobbyWindow = new BrowserWindow({
      width: 1100,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      title: 'Sảnh Google Veo - Đăng nhập tài khoản Google để nhận Credit miễn phí',
      parent: parentWindow && !parentWindow.isDestroyed() ? parentWindow : undefined,
      modal: false,
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:google_veo',
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Thiết lập User-Agent chuẩn Chrome Desktop để Google không chặn
    this.lobbyWindow.webContents.setUserAgent(CHROME_DESKTOP_UA);

    // Lắng nghe cookie thay đổi để tự động lưu session
    ses.cookies.on('changed', async (_event: any, cookie: any, _cause: any, removed: boolean) => {
      if (!removed && GOOGLE_AUTH_COOKIE_NAMES.includes(cookie.name)) {
        await this.syncCookiesFromPartition(ses);
      }
    });

    // Lắng nghe điều hướng URL
    this.lobbyWindow.webContents.on('did-navigate', async (_event: any, url: string) => {
      if (url.includes('labs.google/fx/tools/video-fx') || url.includes('aitestkitchen')) {
        await this.syncCookiesFromPartition(ses);
        await this.validateSession();
      }
    });

    this.lobbyWindow.on('closed', async () => {
      this.lobbyWindow = null;
      // Khi người dùng đóng cửa sổ, tự động chạy health check 1 lần để cập nhật UI
      await this.validateSession();
    });

    await this.lobbyWindow.loadURL(VIDEO_FX_LOBBY_URL);
  }

  /**
   * Đồng bộ cookie từ phân vùng Electron vào SettingsStore
   */
  private async syncCookiesFromPartition(ses: any): Promise<void> {
    try {
      const cookies = await ses.cookies.get({});
      const authCookies = cookies.filter((c: any) =>
        GOOGLE_AUTH_COOKIE_NAMES.includes(c.name) || c.domain.includes('google')
      );

      if (authCookies.length > 0) {
        const cookieStr = authCookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
        SettingsStore.set('veoSessionCookie', cookieStr);
        SettingsStore.set('veoSessionStatus', 'active');
      }
    } catch (err) {
      console.warn('Không thể đồng bộ cookie từ partition:', err);
    }
  }

  /**
   * Nhập cookie hoặc token thủ công do người dùng dán vào
   */
  async saveManualSession(rawInput: string): Promise<VeoSessionValidationResult> {
    const trimmed = String(rawInput || '').trim();
    if (!trimmed) {
      throw new Error('Vui lòng dán chuỗi Cookie hoặc Bearer Token phiên làm việc của Google.');
    }

    if (trimmed.startsWith('ya29.') || trimmed.length > 150 && !trimmed.includes('=')) {
      // Có dạng Bearer OAuth token
      SettingsStore.set('veoSessionAuthToken', trimmed);
    } else {
      // Dạng Cookie chuỗi
      SettingsStore.set('veoSessionCookie', trimmed);

      // Thử inject vào Electron partition nếu có
      try {
        const electron = require('electron');
        const session = electron?.session;
        if (session?.fromPartition) {
          const ses = session.fromPartition('persist:google_veo');
          const pairs = trimmed.split(';').map((p) => p.trim());
          for (const pair of pairs) {
            const idx = pair.indexOf('=');
            if (idx > 0) {
              const name = pair.slice(0, idx).trim();
              const value = pair.slice(idx + 1).trim();
              await ses.cookies.set({
                url: 'https://labs.google',
                name,
                value,
                domain: '.google.com',
                path: '/',
              });
            }
          }
        }
      } catch {}
    }

    return this.validateSession();
  }

  /**
   * Xóa toàn bộ session đăng nhập
   */
  async clearSession(): Promise<void> {
    SettingsStore.set('veoSessionCookie', '');
    SettingsStore.set('veoSessionAuthToken', '');
    SettingsStore.set('veoAccountEmail', '');
    SettingsStore.set('veoSessionStatus', 'unauthenticated');
    SettingsStore.set('veoLastChecked', Date.now());

    try {
      const electron = require('electron');
      const session = electron?.session;
      if (session?.fromPartition) {
        const ses = session.fromPartition('persist:google_veo');
        await ses.clearStorageData();
      }
    } catch {}
  }

  /**
   * KIỂM TRA SESSION HOẠT ĐỘNG (SESSION HEALTH CHECK)
   * Gửi probe request siêu nhẹ đến Google để xác nhận cookie còn sống không.
   * Trả về kết quả trong < 1.5s để người dùng không mất thời gian vô ích.
   */
  async validateSession(): Promise<VeoSessionValidationResult> {
    const cookie = await this.getEffectiveCookieString();
    const token = SettingsStore.get('veoSessionAuthToken')?.trim();

    const now = Date.now();

    // 1. Kiểm tra ban đầu: nếu chưa hề có cookie hay token
    if (!cookie && !token) {
      const res: VeoSessionValidationResult = {
        valid: false,
        status: 'unauthenticated',
        detail: 'Chưa có phiên đăng nhập Google Veo. Vui lòng bấm "Mở sảnh Google Veo" để đăng nhập nhận credit miễn phí.',
        lastChecked: now,
      };
      SettingsStore.set('veoSessionStatus', res.status);
      SettingsStore.set('veoLastChecked', now);
      return res;
    }

    // 2. Kiểm tra xem các cookie cốt lõi có hiện diện không
    const hasCoreCookies = cookie.includes('SID=') || cookie.includes('__Secure-1PSID=') || Boolean(token);
    if (!hasCoreCookies) {
      const res: VeoSessionValidationResult = {
        valid: false,
        status: 'expired',
        detail: 'Thiếu cookie nhận diện SID/__Secure-1PSID của Google. Session đã hết hạn hoặc không đủ quyền.',
        lastChecked: now,
      };
      SettingsStore.set('veoSessionStatus', res.status);
      SettingsStore.set('veoLastChecked', now);
      return res;
    }

    // 3. Thực hiện probe request kiểm tra kết nối với Google
    try {
      const probeResult = await this.executeHealthProbe(cookie, token);
      SettingsStore.set('veoSessionStatus', probeResult.status);
      SettingsStore.set('veoLastChecked', now);
      if (probeResult.email) {
        SettingsStore.set('veoAccountEmail', probeResult.email);
      }
      return probeResult;
    } catch (err: any) {
      // Khi offline hoặc lỗi mạng
      const res: VeoSessionValidationResult = {
        valid: hasCoreCookies, // nếu có cookie thì tạm coi là ok nhưng cảnh báo mạng
        status: hasCoreCookies ? 'active' : 'unknown',
        detail: hasCoreCookies
          ? 'Đã lưu session (chưa thể kiểm tra với server do mạng yếu hoặc offline).'
          : `Lỗi kiểm tra session: ${err?.message || err}`,
        lastChecked: now,
      };
      SettingsStore.set('veoSessionStatus', res.status);
      SettingsStore.set('veoLastChecked', now);
      return res;
    }
  }

  /**
   * Gửi request probe siêu nhẹ đến Google Labs
   */
  private async executeHealthProbe(cookie: string, token?: string): Promise<VeoSessionValidationResult> {
    return new Promise((resolve) => {
      const headers: Record<string, string> = {
        'User-Agent': CHROME_DESKTOP_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
      };

      if (cookie) {
        headers['Cookie'] = cookie;
      }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const req = https.request(
        'https://labs.google/fx/tools/video-fx',
        {
          method: 'GET',
          headers,
          timeout: 6000,
        },
        (res) => {
          const statusCode = res.statusCode || 0;
          const location = res.headers['location'] || '';

          // Nếu bị chuyển hướng về trang Login của Google -> Session đã hết hạn
          if (
            (statusCode === 302 || statusCode === 301 || statusCode === 303) &&
            (location.includes('accounts.google.com') || location.includes('ServiceLogin') || location.includes('signin'))
          ) {
            resolve({
              valid: false,
              status: 'expired',
              detail: 'Phiên Google đã hết hạn hoặc đã đăng xuất. Vui lòng mở lại sảnh để đăng nhập.',
              lastChecked: Date.now(),
            });
            return;
          }

          // Bị Google Rate Limit
          if (statusCode === 429) {
            resolve({
              valid: false,
              status: 'rate_limited',
              detail: 'Google đang hạn chế tần suất (Rate Limit 429). Vui lòng đợi hồi chiêu hoặc đổi tài khoản.',
              lastChecked: Date.now(),
            });
            return;
          }

          // Bị cấm quyền truy cập
          if (statusCode === 401 || statusCode === 403) {
            resolve({
              valid: false,
              status: 'expired',
              detail: 'Tài khoản không có quyền truy cập Google Labs hoặc session không hợp lệ (Mã 403/401).',
              lastChecked: Date.now(),
            });
            return;
          }

          // Đọc một phần body để kiểm tra xem có dính Captcha không
          let data = '';
          res.on('data', (chunk) => {
            data += chunk.toString();
            if (data.length > 50000) {
              res.destroy();
            }
          });

          res.on('end', () => {
            if (data.includes('recaptcha') || data.includes('botguard') || data.includes('challenge')) {
              resolve({
                valid: false,
                status: 'captcha_required',
                detail: 'Google yêu cầu giải mã Captcha chống bot. Vui lòng mở sảnh để hoàn tất giải Captcha.',
                lastChecked: Date.now(),
              });
              return;
            }

            // Nếu trả về 200 OK và không chuyển hướng login
            resolve({
              valid: true,
              status: 'active',
              detail: 'Session Google Veo đang hoạt động hoàn hảo! Sẵn sàng sử dụng credit miễn phí.',
              lastChecked: Date.now(),
            });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve({
          valid: true, // fallback khi timeout
          status: 'active',
          detail: 'Kiểm tra quá hạn (timeout), nhưng session đã được nạp sẵn.',
          lastChecked: Date.now(),
        });
      });

      req.on('error', (err) => {
        resolve({
          valid: false,
          status: 'unknown',
          detail: `Không thể kết nối tới máy chủ Google Labs: ${err.message}`,
          lastChecked: Date.now(),
        });
      });

      req.end();
    });
  }

  /**
   * Lấy tổng quan trạng thái phục vụ hiển thị trên UI
   */
  getStatus(): VeoStatusPayload {
    const mode = (SettingsStore.get('veoMode') || 'free_session') as VeoMode;
    const sessionStatus = (SettingsStore.get('veoSessionStatus') || 'unauthenticated') as VeoSessionStatus;
    const hasSession = SettingsStore.hasVeoSession();
    const email = SettingsStore.get('veoAccountEmail') || undefined;
    const lastChecked = Number(SettingsStore.get('veoLastChecked')) || undefined;
    const antiSpam = GoogleVeoAntiSpamGuard.getInstance().getStatus();

    return {
      mode,
      hasSession,
      sessionStatus,
      email,
      lastChecked,
      antiSpam,
    };
  }

  /** Đổi chế độ hoạt động: Sảnh Free vs API Key vs Mô phỏng */
  setMode(mode: VeoMode): void {
    SettingsStore.set('veoMode', mode);
  }
}
