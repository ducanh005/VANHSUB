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

const GOOGLE_AUTH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

const GOOGLE_FLOW_LOBBY_URL = 'https://flow.google.com';
const VIDEO_FX_FALLBACK_URL = 'https://labs.google/fx/tools/video-fx';
const GOOGLE_AUTH_COOKIE_NAMES = [
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PSIDTS',
  '__Secure-3PSIDTS',
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
   * Khởi động và tự động đồng bộ cookie từ phân vùng Electron khi app chạy
   */
  async init(): Promise<void> {
    try {
      const electron = require('electron');
      const session = electron?.session;
      if (session?.fromPartition) {
        const ses = session.fromPartition('persist:google_veo');
        await this.syncCookiesFromPartition(ses);

        ses.cookies.on('changed', async (_event: any, cookie: any, _cause: any, removed: boolean) => {
          if (!removed && (GOOGLE_AUTH_COOKIE_NAMES.includes(cookie.name) || cookie.domain?.includes('google'))) {
            await this.syncCookiesFromPartition(ses);
          }
        });
      }
    } catch (e) {
      console.warn('GoogleVeoSessionManager init warning:', e);
    }
  }

  /**
   * Chuẩn hóa và loại bỏ cookie trùng lặp (tránh lỗi Google accounts.google.com/CookieMismatch)
   */
  static cleanAndDeduplicateCookies(rawCookieStr: string): string {
    if (!rawCookieStr) return '';
    const cookieMap = new Map<string, string>();
    const parts = rawCookieStr.split(';').map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx > 0) {
        const key = part.slice(0, eqIdx).trim();
        const val = part.slice(eqIdx + 1).trim();
        if (key && val) {
          cookieMap.set(key, val);
        }
      }
    }
    return Array.from(cookieMap.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /**
   * Lấy cookie session đã lưu hoặc từ phân vùng Electron
   */
  async getEffectiveCookieString(): Promise<string> {
    // 1. Thử đọc từ SettingsStore trước
    const storedCookie = SettingsStore.get('veoSessionCookie')?.trim();
    if (storedCookie) {
      return GoogleVeoSessionManager.cleanAndDeduplicateCookies(storedCookie);
    }

    // 2. Thử đọc từ Electron session partition nếu có
    try {
      const electron = require('electron');
      const session = electron?.session;
      if (session?.fromPartition) {
        const ses = session.fromPartition('persist:google_veo');
        const cookies = await ses.cookies.get({});
        const authCookies = cookies.filter((c: any) =>
          GOOGLE_AUTH_COOKIE_NAMES.includes(c.name) ||
          (c.domain && (c.domain.includes('google') || c.domain.includes('flow')))
        );

        if (authCookies.length > 0) {
          const rawJoined = authCookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
          return GoogleVeoSessionManager.cleanAndDeduplicateCookies(rawJoined);
        }
      }
    } catch {}

    return '';
  }

  /**
   * Mở cửa sổ Sảnh Google Veo / Flow để người dùng đăng nhập tài khoản thật
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

    // Thiết lập User-Agent mặc định cho partition
    try {
      ses.setUserAgent(CHROME_DESKTOP_UA);
    } catch {}

    // Can thiệp request headers để loại bỏ mọi dấu vết sec-ch-ua/Electron gây chặn "Ứng dụng không an toàn / không tin cậy"
    try {
      ses.webRequest.onBeforeSendHeaders(
        {
          urls: [
            '*://*.google.com/*',
            '*://google.com/*',
            '*://labs.google/*',
            '*://*.labs.google/*',
            '*://flow.google.com/*',
            '*://*.flow.google.com/*',
          ],
        },
        (details: any, callback: any) => {
          const isAuth = details.url && details.url.includes('accounts.google.com');
          if (isAuth) {
            // Khi vào trang đăng nhập Google, chuyển sang User-Agent Firefox sạch không có sec-ch-ua client hints
            details.requestHeaders['User-Agent'] = GOOGLE_AUTH_UA;
            delete details.requestHeaders['sec-ch-ua'];
            delete details.requestHeaders['sec-ch-ua-mobile'];
            delete details.requestHeaders['sec-ch-ua-platform'];
            delete details.requestHeaders['sec-ch-ua-full-version-list'];
            delete details.requestHeaders['sec-ch-ua-arch'];
            delete details.requestHeaders['sec-ch-ua-bitness'];
            delete details.requestHeaders['sec-ch-ua-model'];
          } else {
            details.requestHeaders['User-Agent'] = CHROME_DESKTOP_UA;
          }
          callback({ requestHeaders: details.requestHeaders });
        }
      );
    } catch (headerErr) {
      console.warn('Lỗi khi thiết lập onBeforeSendHeaders cho Google Veo:', headerErr);
    }

    this.lobbyWindow = new BrowserWindow({
      width: 1100,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      title: 'Sảnh Google Flow / Veo - Đăng nhập tài khoản Google để nhận Credit miễn phí',
      parent: parentWindow && !parentWindow.isDestroyed() ? parentWindow : undefined,
      modal: false,
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:google_veo',
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Thiết lập User-Agent cho webContents
    this.lobbyWindow.webContents.setUserAgent(CHROME_DESKTOP_UA);

    // Xóa cờ automation webdriver nếu có
    this.lobbyWindow.webContents.on('dom-ready', () => {
      this.lobbyWindow?.webContents?.executeJavaScript(`
        try {
          delete Object.getPrototypeOf(navigator).webdriver;
          if (navigator.webdriver) {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          }
        } catch (e) {}
      `).catch(() => {});
    });

    // Lắng nghe cookie thay đổi để tự động lưu session
    ses.cookies.on('changed', async (_event: any, cookie: any, _cause: any, removed: boolean) => {
      if (!removed && (GOOGLE_AUTH_COOKIE_NAMES.includes(cookie.name) || cookie.domain?.includes('google'))) {
        await this.syncCookiesFromPartition(ses);
      }
    });

    // Lắng nghe điều hướng URL: đổi User-Agent linh hoạt giữa trang Auth và trang Labs/Flow
    this.lobbyWindow.webContents.on('did-navigate', async (_event: any, url: string) => {
      if (url.includes('accounts.google.com')) {
        this.lobbyWindow?.webContents?.setUserAgent(GOOGLE_AUTH_UA);
      } else {
        this.lobbyWindow?.webContents?.setUserAgent(CHROME_DESKTOP_UA);
      }

      if (
        url.includes('flow.google.com') ||
        url.includes('labs.google') ||
        url.includes('aitestkitchen') ||
        url.includes('google.com')
      ) {
        await this.syncCookiesFromPartition(ses);
        await this.validateSession();
      }
    });

    this.lobbyWindow.on('closed', async () => {
      this.lobbyWindow = null;
      // Khi người dùng đóng cửa sổ, tự động chạy health check 1 lần để cập nhật UI
      await this.syncCookiesFromPartition(ses);
      await this.validateSession();
    });

    try {
      await this.lobbyWindow.loadURL(GOOGLE_FLOW_LOBBY_URL);
    } catch {
      // Fallback nếu không tải được URL chính
      try {
        await this.lobbyWindow.loadURL(VIDEO_FX_FALLBACK_URL);
      } catch {}
    }
  }

  /**
   * Đồng bộ cookie từ phân vùng Electron vào SettingsStore
   */
  private async syncCookiesFromPartition(ses: any): Promise<void> {
    try {
      const cookies = await ses.cookies.get({});
      const authCookies = cookies.filter((c: any) =>
        GOOGLE_AUTH_COOKIE_NAMES.includes(c.name) || (c.domain && c.domain.includes('google'))
      );

      if (authCookies.length > 0) {
        const cookieStr = authCookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
        SettingsStore.set('veoSessionCookie', cookieStr);
        SettingsStore.set('veoSessionAuthToken', '');
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

    if (trimmed.startsWith('ya29.')) {
      // Bearer OAuth token chuẩn của Google
      SettingsStore.set('veoSessionAuthToken', trimmed);
      SettingsStore.set('veoSessionCookie', '');
    } else {
      // Kiểm tra người dùng có chỉ dán mỗi giá trị chuỗi SID (thiếu "SID=" hoặc thiếu các cookie bảo mật khác)
      if (!trimmed.includes('=')) {
        throw new Error(
          'Bạn chỉ mới dán GIÁ TRỊ của cookie mà thiếu tên và các cookie bảo mật bắt buộc của Google. Google yêu cầu đủ bộ cookie (SID, HSID, SSID, __Secure-1PSID). Vui lòng dùng nút "Mở Sảnh Google" để đăng nhập tự động, hoặc copy toàn bộ dòng Header "Cookie" từ F12 Network.'
        );
      }

      const cookieNames = trimmed.split(';').map((p) => p.trim().split('=')[0].trim());
      const hasSid = cookieNames.includes('SID');
      const hasCompanion =
        cookieNames.includes('HSID') ||
        cookieNames.includes('SSID') ||
        cookieNames.includes('__Secure-1PSID') ||
        cookieNames.includes('__Secure-3PSID');

      if (hasSid && !hasCompanion) {
        throw new Error(
          'Chuỗi cookie chỉ chứa SID đơn lẻ mà thiếu các cookie bảo mật bắt buộc (HSID, SSID, __Secure-1PSID). Google sẽ từ chối xác thực nếu chỉ có SID. Vui lòng bấm "Mở Sảnh Google" để đăng nhập tự động, hoặc copy toàn bộ Cookie header từ F12.'
        );
      }

      const cleanCookie = GoogleVeoSessionManager.cleanAndDeduplicateCookies(trimmed);
      SettingsStore.set('veoSessionCookie', cleanCookie);
      SettingsStore.set('veoSessionAuthToken', ''); // Xóa auth token rác để tránh xung đột

      // Thử inject vào Electron partition nếu có
      try {
        const electron = require('electron');
        const session = electron?.session;
        if (session?.fromPartition) {
          const ses = session.fromPartition('persist:google_veo');
          const pairs = cleanCookie.split(';').map((p) => p.trim());
          for (const pair of pairs) {
            const idx = pair.indexOf('=');
            if (idx > 0) {
              const name = pair.slice(0, idx).trim();
              const value = pair.slice(idx + 1).trim();
              const isSecure = name.startsWith('__Secure-') || name.startsWith('__Host-') || name === 'SSID';
              await ses.cookies.set({
                url: 'https://flow.google.com',
                name,
                value,
                domain: '.google.com',
                path: '/',
                secure: isSecure,
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
    let token = SettingsStore.get('veoSessionAuthToken')?.trim();

    // Chỉ chấp nhận Bearer token nếu bắt đầu bằng ya29.
    if (token && !token.startsWith('ya29.')) {
      SettingsStore.set('veoSessionAuthToken', '');
      token = '';
    }

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
   * Gửi request probe siêu nhẹ đến Google Flow / Labs
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
      if (token && token.startsWith('ya29.')) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const hasCoreCookies = cookie.includes('SID=') || cookie.includes('__Secure-1PSID=') || Boolean(token);

      const probeUrl = 'https://flow.google.com';

      const sendRequest = (targetUrl: string, hopCount = 0) => {
        if (hopCount > 3) {
          resolve({
            valid: hasCoreCookies,
            status: hasCoreCookies ? 'active' : 'unknown',
            detail: 'Quá nhiều lần chuyển hướng, nhưng cookie phiên vẫn còn hiệu lực.',
            lastChecked: Date.now(),
          });
          return;
        }

        const parsedUrl = new URL(targetUrl);
        const req = https.request(
          {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers,
            timeout: 6000,
          },
          (res) => {
            const statusCode = res.statusCode || 0;
            const location = res.headers['location'] || '';

            // Nếu bị chuyển hướng về trang Login của Google -> Session đã hết hạn
            if (
              (statusCode >= 300 && statusCode < 400) &&
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

            // Chuyển hướng nội bộ an toàn (ví dụ redirect sang /fx/ hoặc flow.google.com/...)
            if (statusCode >= 300 && statusCode < 400 && location) {
              const nextUrl = location.startsWith('http') ? location : new URL(location, targetUrl).toString();
              sendRequest(nextUrl, hopCount + 1);
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
              const isCaptchaChallenge =
                data.includes('google.com/sorry') ||
                data.includes('Unusual traffic from your computer network') ||
                data.includes('g-recaptcha-response');

              if (isCaptchaChallenge) {
                resolve({
                  valid: false,
                  status: 'captcha_required',
                  detail: 'Google yêu cầu giải mã Captcha chống bot. Vui lòng mở sảnh để hoàn tất giải Captcha.',
                  lastChecked: Date.now(),
                });
                return;
              }

              // Nếu trả về 200 OK
              resolve({
                valid: true,
                status: 'active',
                detail: 'Session Google Flow / Veo đang hoạt động hoàn hảo! Sẵn sàng sử dụng credit miễn phí.',
                lastChecked: Date.now(),
              });
            });
          }
        );

        req.on('timeout', () => {
          req.destroy();
          resolve({
            valid: hasCoreCookies,
            status: hasCoreCookies ? 'active' : 'unknown',
            detail: hasCoreCookies
              ? 'Đã lưu session (kết nối kiểm tra quá hạn, nhưng cookie vẫn sẵn sàng).'
              : 'Kiểm tra quá hạn (timeout).',
            lastChecked: Date.now(),
          });
        });

        req.on('error', (err) => {
          resolve({
            valid: hasCoreCookies,
            status: hasCoreCookies ? 'active' : 'unknown',
            detail: hasCoreCookies
              ? 'Đã lưu session Google Flow (mạng gián đoạn tạm thời).'
              : `Không thể kết nối tới máy chủ Google Flow: ${err.message}`,
            lastChecked: Date.now(),
          });
        });

        req.end();
      };

      sendRequest(probeUrl);
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

  // =========================================================================
  // BROWSER AUTOMATION — Sinh video qua fetchThật trong Electron BrowserWindow
  // =========================================================================

  /**
   * Đảm bảo lobby window đang mở và đã navigate đến VideoFX page của labs.google.
   * Trả về true nếu sẵn sàng, false nếu thất bại.
   */
  private async ensureLobbyAtVideoFx(): Promise<boolean> {
    let electron: any;
    try {
      electron = require('electron');
    } catch {
      return false;
    }

    const { BrowserWindow } = electron;
    if (!BrowserWindow) return false;

    // Mở lobby window nếu chưa có
    if (!this.lobbyWindow || this.lobbyWindow.isDestroyed()) {
      try {
        await this.openLobbyWindow();
      } catch (e) {
        console.warn('[Google Flow Browser] Không thể mở lobby window:', e);
        return false;
      }
    }

    const win = this.lobbyWindow;
    if (!win || win.isDestroyed()) return false;

    // Đợi page load ban đầu
    if (win.webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        const onStop = () => resolve();
        win.webContents.once('did-stop-loading', onStop);
        setTimeout(resolve, 7000);
      });
    }

    // Kiểm tra xem đang ở đúng domain chưa
    const currentUrl = (win.webContents.getURL() || '').toLowerCase();
    const isOnFlowOrLabs = currentUrl.includes('labs.google') || currentUrl.includes('flow.google.com');

    if (!isOnFlowOrLabs) {
      console.log('[Google Flow Browser] Đang navigate tới labs.google VideoFX...');
      try {
        await win.loadURL('https://labs.google/fx/tools/video-fx');
        await new Promise<void>((resolve) => {
          const onStop = () => resolve();
          win.webContents.once('did-stop-loading', onStop);
          setTimeout(resolve, 8000);
        });
        // Extra wait for JS to initialize
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) {
        console.warn('[Google Flow Browser] Không thể load VideoFX page:', e);
        return false;
      }
    }

    return !win.isDestroyed();
  }

  /**
   * Sinh video bằng cách thực thi fetch() thật từ trong Electron BrowserWindow
   * (session partition 'persist:google_veo' đã đăng nhập sẵn).
   * 
   * Đây là cách duy nhất để dùng credit Google Flow miễn phí mà không cần API key:
   * - Browser tự gán Cookie, Origin, CSRF token đúng chuẩn
   * - Google không phân biệt được với request thật của người dùng
   * - Video được render bởi Google Veo thật sự
   */
  async generateVideoViaBrowserContext(
    params: {
      prompt: string;
      aspectRatio?: string;
      durationSeconds?: number;
      modelVariant?: string;
    },
    onProgress?: (percent: number, msg?: string) => void
  ): Promise<{ videoUrl: string } | null> {
    onProgress?.(5, 'Đang chuẩn bị Sảnh Google Labs...');

    const ready = await this.ensureLobbyAtVideoFx();
    if (!ready) {
      console.warn('[Google Flow Browser] Không thể chuẩn bị browser context.');
      return null;
    }

    const win = this.lobbyWindow;
    if (!win || win.isDestroyed()) return null;

    // Xây dựng tham số
    const aspect = params.aspectRatio === '9:16' ? 'PORTRAIT' : 'LANDSCAPE';
    let model = params.modelVariant || 'veo-3.1-generate-quality';
    if (model === 'veo-3.1-quality') model = 'veo-3.1-generate-quality';
    if (model === 'veo-3.1-lite') model = 'veo-3.1-generate-preview';
    if (model === 'veo-2.0') model = 'veo-2.0-generate-001';
    const duration = Math.max(3, Math.min(10, Math.round(params.durationSeconds || 5)));
    const promptJson = JSON.stringify(params.prompt || '');

    onProgress?.(12, 'Đang gửi yêu cầu sinh video tới Google Labs...');

    // === BƯỚC 1: Submit video generation job ===
    // Thử tRPC batch format (format chuẩn của labs.google)
    const generateJs = `
      (async function __vanhsubGenerate() {
        try {
          // Thử tRPC batch endpoint (format v10/v11)
          const endpoints = [
            { url: '/fx/api/trpc/videoFx.generateVideo?batch=1', isBatch: true },
            { url: '/api/trpc/videoFx.generateVideo?batch=1', isBatch: true },
            { url: '/fx/api/trpc/videoFx.generateVideo', isBatch: false },
          ];

          for (const ep of endpoints) {
            try {
              const body = ep.isBatch
                ? JSON.stringify([{ json: { prompt: ${promptJson}, aspectRatio: '${aspect}', durationSeconds: ${duration}, model: '${model}' } }])
                : JSON.stringify({ json: { prompt: ${promptJson}, aspectRatio: '${aspect}', durationSeconds: ${duration}, model: '${model}' } });

              const resp = await fetch(ep.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*' },
                credentials: 'include',
                body: body,
              });

              if (resp.status === 200 || resp.status === 201) {
                const text = await resp.text();
                return JSON.stringify({ ok: true, endpointUrl: ep.url, status: resp.status, body: text.slice(0, 8000) });
              }
              // 404/405 → thử endpoint tiếp theo
            } catch (fetchErr) {
              // tiếp tục thử
            }
          }
          return JSON.stringify({ ok: false, error: 'Tất cả endpoint đều thất bại' });
        } catch(e) {
          return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) });
        }
      })()
    `;

    let generateResult: any;
    try {
      const raw = await win.webContents.executeJavaScript(generateJs, true);
      generateResult = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      console.warn('[Google Flow Browser] executeJavaScript lỗi ở bước generate:', e);
      return null;
    }

    if (!generateResult?.ok) {
      console.warn('[Google Flow Browser] Generate request thất bại:', generateResult?.error);
      return null;
    }

    console.log(`[Google Flow Browser] Endpoint hoạt động: ${generateResult.endpointUrl}`);

    // Parse tRPC response để lấy jobId hoặc videoUrl
    let responseBody: any;
    try {
      responseBody = JSON.parse(generateResult.body);
    } catch {
      console.warn('[Google Flow Browser] Không parse được response body');
      return null;
    }

    // Hỗ trợ cả batch (array) và non-batch (object)
    const firstItem = Array.isArray(responseBody) ? responseBody[0] : responseBody;
    const resultData = firstItem?.result?.data;
    const dataJson = resultData?.json ?? resultData;

    // Kiểm tra videoUrl trực tiếp (hiếm gặp với async API)
    const directUrl = dataJson?.videoUrl || dataJson?.url || dataJson?.outputUrl || dataJson?.videoUri;
    if (typeof directUrl === 'string' && directUrl.startsWith('http')) {
      onProgress?.(90, 'Google Labs đã trả về video ngay lập tức!');
      return { videoUrl: directUrl };
    }

    // Lấy jobId để polling
    const jobId = dataJson?.jobId || dataJson?.id || dataJson?.requestId || dataJson?.operationName || dataJson?.name;
    if (!jobId) {
      console.warn('[Google Flow Browser] Không tìm thấy jobId hay videoUrl trong response:', JSON.stringify(dataJson).slice(0, 300));
      return null;
    }

    console.log(`[Google Flow Browser] Nhận jobId: ${String(jobId).slice(0, 40)}, bắt đầu polling...`);
    onProgress?.(20, `Google Labs đang render (JobId: ${String(jobId).slice(0, 16)}...)...`);

    // === BƯỚC 2: Poll cho đến khi video render xong ===
    const jobIdJson = JSON.stringify(String(jobId));
    const pollEndpoint = generateResult.endpointUrl.includes('batch=1')
      ? generateResult.endpointUrl.replace('videoFx.generateVideo', 'videoFx.getVideoStatus')
      : '/fx/api/trpc/videoFx.getVideoStatus?batch=1';

    for (let attempt = 0; attempt < 24; attempt++) {
      if (win.isDestroyed()) return null;
      await new Promise((r) => setTimeout(r, 5000));
      const pct = Math.min(80, 20 + attempt * 2.5);
      onProgress?.(pct, `Google Labs đang render... (${(attempt + 1) * 5}s / 120s tối đa)`);

      const pollJs = `
        (async function __vanhsubPoll() {
          try {
            const inputParam = JSON.stringify([{ json: { jobId: ${jobIdJson} } }]);
            const pollUrls = [
              '${pollEndpoint}' + '&input=' + encodeURIComponent(inputParam),
              '/fx/api/trpc/videoFx.getVideoStatus?batch=1&input=' + encodeURIComponent(inputParam),
              '/api/trpc/videoFx.getVideoStatus?batch=1&input=' + encodeURIComponent(inputParam),
            ];

            for (const url of pollUrls) {
              try {
                const resp = await fetch(url, { credentials: 'include' });
                if (resp.status === 200) {
                  const text = await resp.text();
                  return JSON.stringify({ ok: true, body: text.slice(0, 8000) });
                }
              } catch {}
            }
            return JSON.stringify({ ok: false, error: 'Poll không thành công' });
          } catch(e) {
            return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) });
          }
        })()
      `;

      let pollResult: any;
      try {
        const pollRaw = await win.webContents.executeJavaScript(pollJs, true);
        pollResult = typeof pollRaw === 'string' ? JSON.parse(pollRaw) : pollRaw;
      } catch {
        continue;
      }

      if (!pollResult?.ok) continue;

      let pollData: any;
      try {
        pollData = JSON.parse(pollResult.body);
      } catch {
        continue;
      }

      const pollFirst = Array.isArray(pollData) ? pollData[0] : pollData;
      const pollResultData = pollFirst?.result?.data;
      const pollJson = pollResultData?.json ?? pollResultData;

      // Kiểm tra trạng thái
      const jobStatus = (pollJson?.status || pollJson?.state || '').toUpperCase();
      if (jobStatus === 'FAILED' || jobStatus === 'ERROR' || jobStatus === 'CANCELLED') {
        console.warn('[Google Flow Browser] Google Labs báo render thất bại:', jobStatus, pollJson?.error || '');
        return null;
      }

      // Kiểm tra video URL
      const videoUrl = pollJson?.videoUrl || pollJson?.url || pollJson?.outputUrl || pollJson?.videoUri
        || pollJson?.video?.url || pollJson?.output?.url;
      if (typeof videoUrl === 'string' && videoUrl.startsWith('http')) {
        onProgress?.(85, 'Google Labs đã render video thành công!');
        console.log('[Google Flow Browser] ✅ Nhận được video URL từ Google Veo thật!');
        return { videoUrl };
      }
    }

    // Hết 120s vẫn không có video
    console.warn('[Google Flow Browser] Timeout 120s: Google Labs không trả về video URL');
    return null;
  }
}
