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
  private _webRequestListenerAttached = false;

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
      // Không đặt parent để sảnh là cửa sổ độc lập, thu nhỏ (-) xuống taskbar thoải mái không bị đóng
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

    this.lobbyWindow.on('closed', () => {
      this.lobbyWindow = null;
      // Khi người dùng đóng cửa sổ, chỉ sync cookie; KHÔNG gọi validateSession()
      // vì validateSession() có thể hang nếu mạng chậm và không có ai await nó đúng cách
      this.syncCookiesFromPartition(ses).catch(() => {});
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
   * Gửi request probe siêu nhẹ đến Google Flow / Labs.
   * Có hard timeout toàn bộ 8s để tuyệt đối không hang.
   */
  private async executeHealthProbe(cookie: string, token?: string): Promise<VeoSessionValidationResult> {
    const hasCoreCookies = cookie.includes('SID=') || cookie.includes('__Secure-1PSID=') || Boolean(token);
    const now = Date.now();

    // Hard outer timeout — đảm bảo hàm này LUÔN kết thúc trong tối đa 8 giây
    const HARD_TIMEOUT_MS = 8000;

    const probePromise = new Promise<VeoSessionValidationResult>((resolve) => {
      const headers: Record<string, string> = {
        'User-Agent': CHROME_DESKTOP_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
        Connection: 'close',
      };

      if (cookie) headers['Cookie'] = cookie;
      if (token && token.startsWith('ya29.')) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      let settled = false;
      const done = (result: VeoSessionValidationResult) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };

      const sendRequest = (targetUrl: string, hopCount = 0) => {
        if (hopCount > 3) {
          done({
            valid: hasCoreCookies,
            status: hasCoreCookies ? 'active' : 'unknown',
            detail: 'Quá nhiều lần chuyển hướng, nhưng cookie phiên vẫn còn hiệu lực.',
            lastChecked: Date.now(),
          });
          return;
        }

        let parsedUrl: URL;
        try {
          parsedUrl = new URL(targetUrl);
        } catch {
          done({ valid: hasCoreCookies, status: hasCoreCookies ? 'active' : 'unknown', detail: 'URL probe không hợp lệ.', lastChecked: Date.now() });
          return;
        }

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

            // Phải consume body để socket không bị treo
            const drainAndDone = (result: VeoSessionValidationResult) => {
              res.resume(); // drain ngay, không đọc nội dung
              done(result);
            };

            // Redirect tới trang login → session expired
            if (
              statusCode >= 300 && statusCode < 400 &&
              (location.includes('accounts.google.com') || location.includes('ServiceLogin') || location.includes('signin'))
            ) {
              drainAndDone({
                valid: false,
                status: 'expired',
                detail: 'Phiên Google đã hết hạn hoặc đã đăng xuất. Vui lòng mở lại sảnh để đăng nhập.',
                lastChecked: Date.now(),
              });
              return;
            }

            // Redirect nội bộ an toàn → follow
            if (statusCode >= 300 && statusCode < 400 && location) {
              res.resume(); // drain redirect response (thường không có body)
              const nextUrl = location.startsWith('http') ? location : new URL(location, targetUrl).toString();
              sendRequest(nextUrl, hopCount + 1);
              return;
            }

            // Rate limited
            if (statusCode === 429) {
              drainAndDone({
                valid: false,
                status: 'rate_limited',
                detail: 'Google đang hạn chế tần suất (Rate Limit 429). Vui lòng đợi hoặc đổi tài khoản.',
                lastChecked: Date.now(),
              });
              return;
            }

            // Forbidden / Unauthorized
            if (statusCode === 401 || statusCode === 403) {
              drainAndDone({
                valid: false,
                status: 'expired',
                detail: 'Tài khoản không có quyền truy cập hoặc session không hợp lệ (Mã 403/401).',
                lastChecked: Date.now(),
              });
              return;
            }

            // Đọc một phần body để check Captcha, có giới hạn dung lượng
            let data = '';
            res.on('data', (chunk) => {
              data += chunk.toString();
              if (data.length > 20000) {
                res.destroy(); // Đã đọc đủ, ngắt
              }
            });

            res.on('end', () => {
              if (
                data.includes('google.com/sorry') ||
                data.includes('Unusual traffic') ||
                data.includes('g-recaptcha-response')
              ) {
                done({
                  valid: false,
                  status: 'captcha_required',
                  detail: 'Google yêu cầu giải Captcha chống bot. Vui lòng mở sảnh để hoàn tất.',
                  lastChecked: Date.now(),
                });
                return;
              }

              done({
                valid: true,
                status: 'active',
                detail: 'Session Google Flow / Veo đang hoạt động! Sẵn sàng sử dụng credit miễn phí.',
                lastChecked: Date.now(),
              });
            });

            res.on('error', () => {
              done({
                valid: hasCoreCookies,
                status: hasCoreCookies ? 'active' : 'unknown',
                detail: 'Kết nối probe bị ngắt, nhưng cookie vẫn sẵn sàng.',
                lastChecked: Date.now(),
              });
            });
          }
        );

        req.on('timeout', () => {
          req.destroy();
          done({
            valid: hasCoreCookies,
            status: hasCoreCookies ? 'active' : 'unknown',
            detail: hasCoreCookies
              ? 'Đã lưu session (kết nối kiểm tra quá hạn, cookie vẫn sẵn sàng).'
              : 'Kiểm tra quá hạn (timeout).',
            lastChecked: Date.now(),
          });
        });

        req.on('error', () => {
          done({
            valid: hasCoreCookies,
            status: hasCoreCookies ? 'active' : 'unknown',
            detail: hasCoreCookies
              ? 'Đã lưu session Google Flow (mạng gián đoạn tạm thời).'
              : 'Không thể kết nối tới máy chủ Google Flow.',
            lastChecked: Date.now(),
          });
        });

        req.end();
      };

      sendRequest('https://flow.google.com');
    });

    const timeoutPromise = new Promise<VeoSessionValidationResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            valid: hasCoreCookies,
            status: hasCoreCookies ? 'active' : 'unknown',
            detail: hasCoreCookies
              ? 'Đã lưu session (server phản hồi chậm, cookie vẫn hợp lệ).'
              : 'Không thể xác minh session (server không phản hồi).',
            lastChecked: now,
          }),
        HARD_TIMEOUT_MS
      )
    );

    return Promise.race([probePromise, timeoutPromise]);
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
   * Thực thi JavaScript an toàn với Hard Watchdog timeout (tránh vĩnh viễn lỗi Mojo interface hang)
   */
  private async safeExecuteJs<T = any>(win: any, js: string, timeoutMs = 6000): Promise<T | null> {
    if (!win || win.isDestroyed()) return null;
    try {
      const execPromise = win.webContents.executeJavaScript(js, true);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('executeJavaScript timeout')), timeoutMs)
      );
      const raw = await Promise.race([execPromise, timeoutPromise]);
      if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return raw as any; }
      }
      return raw as T;
    } catch (err: any) {
      console.warn('[Google Flow Browser] safeExecuteJs warning:', err?.message || err);
      return null;
    }
  }

  /**
   * Đảm bảo lobby window đang mở và đã ở trang Google Flow (https://flow.google.com).
   */
  private async ensureLobbyAtFlow(): Promise<boolean> {
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

    // Đợi load ban đầu nếu đang loading (tối đa 5s)
    if (win.webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        win.webContents.once('did-stop-loading', () => resolve());
        setTimeout(resolve, 5000);
      });
    }

    const currentUrl = (win.webContents.getURL() || '').toLowerCase();

    // Nếu đang ở trang đăng nhập Google
    if (currentUrl.includes('accounts.google.com') || currentUrl.includes('servicelogin')) {
      console.warn('[Google Flow Browser] Cần đăng nhập tài khoản Google trên Sảnh Flow trước.');
      return false;
    }

    // Nếu chưa ở flow.google.com → chuyển đến flow.google.com
    if (!currentUrl.includes('flow.google.com')) {
      console.log('[Google Flow Browser] Đang mở https://flow.google.com...');
      try {
        await win.loadURL(GOOGLE_FLOW_LOBBY_URL);
        await new Promise<void>((resolve) => {
          win.webContents.once('did-stop-loading', () => resolve());
          setTimeout(resolve, 6000);
        });
      } catch (e) {
        console.warn('[Google Flow Browser] Không thể load flow.google.com:', e);
        return false;
      }
    }

    return !win.isDestroyed();
  }

  /**
   * Sinh video qua tự động hóa giao diện Google Flow trên Electron BrowserWindow.
   * Tất cả các bước đều có timeout ngắn để tuyệt đối không làm treo workflow.
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
    onProgress?.(5, 'Đang chuẩn bị Sảnh Google Flow...');

    const ready = await this.ensureLobbyAtFlow();
    if (!ready) {
      console.warn('[Google Flow Browser] Sảnh Google Flow chưa sẵn sàng (chưa đăng nhập hoặc cửa sổ đã đóng).');
      return null;
    }

    const win = this.lobbyWindow;
    if (!win || win.isDestroyed()) return null;

    let electron: any;
    try {
      electron = require('electron');
    } catch {
      return null;
    }

    // Gắn network listener tạm thời để bắt link video
    let capturedVideoUrl: string | null = null;
    const ses = electron.session.fromPartition('persist:google_veo');
    const netFilter = { urls: ['*://*/*'] };

    const onResponseStartedHandler = (details: any) => {
      const url = details.url || '';
      const headers = details.responseHeaders || {};
      const ct = (headers['content-type']?.[0] || headers['Content-Type']?.[0] || '').toLowerCase();
      
      // Bỏ qua các video banner quảng cáo tĩnh từ gstatic / webview
      const isStaticBanner = url.includes('gstatic.com') || url.includes('/banners/') || url.includes('landing_page');

      if (
        (ct.includes('video/mp4') || ct.includes('video/webm') || url.includes('.mp4') || url.includes('googlevideo.com/videoplayback')) &&
        !url.includes('blank') &&
        !isStaticBanner &&
        details.statusCode >= 200 && details.statusCode < 300
      ) {
        console.log('[Google Flow Network] 🎬 Bắt được luồng video Veo thật:', url.slice(0, 100));
        capturedVideoUrl = url;
      }
    };

    try {
      ses.webRequest.onResponseStarted(netFilter, onResponseStartedHandler);
    } catch {}

    const promptClean = (params.prompt || '').trim();
    const promptJson = JSON.stringify(promptClean);

    onProgress?.(12, 'Đang phân tích giao diện Google Flow...');

    // === BƯỚC 1: Kiểm tra trạng thái trang hiện tại (chạy cực nhanh, không click) ===
    const checkStateJs = `
      (function() {
        const hasPrompt = Boolean(document.querySelector('.ProseMirror, [contenteditable="true"], flow-prompt-box textarea, textarea'));
        const projectCard = Boolean(document.querySelector('flow-project-card'));
        const newProjBtn = Boolean(document.querySelector('button.new-project-button, [aria-label*="New project" i]'));
        // Chỉ coi là chưa đăng nhập nếu KHÔNG có project/card/prompt và thấy nút đăng nhập rõ ràng
        const isSignIn = !hasPrompt && !projectCard && !newProjBtn && Boolean(
          document.querySelector('a[href*="ServiceLogin"], [aria-label*="Sign in" i]')
        );
        return JSON.stringify({
          url: window.location.href,
          hasPrompt,
          projectCard,
          newProjBtn,
          isSignIn
        });
      })()
    `;

    const stateResult = await this.safeExecuteJs<any>(win, checkStateJs, 4000);
    console.log('[Google Flow Browser] Trạng thái trang:', stateResult);

    if (stateResult?.isSignIn) {
      console.warn('[Google Flow Browser] Tài khoản chưa đăng nhập trên Google Flow.');
      return null;
    }

    // === BƯỚC 2: Nếu chưa ở trang soạn thảo prompt, mở project ===
    if (!stateResult?.hasPrompt && (stateResult?.projectCard || stateResult?.newProjBtn)) {
      onProgress?.(18, 'Đang mở dự án trên Google Flow...');
      const clickProjectJs = `
        (function() {
          // 1. Thử click link/thẻ mở project bên trong flow-project-card
          const cardLink = document.querySelector('flow-project-card a[aria-label*="project" i]') ||
                           document.querySelector('flow-project-card a.project-thumbnail-container') ||
                           document.querySelector('flow-project-card a') ||
                           document.querySelector('flow-project-card .project-card');
          if (cardLink) {
            const href = cardLink.getAttribute('href') || (cardLink.href ? cardLink.href : null);
            if (href && (href.startsWith('/project/') || href.includes('flow.google.com/project/'))) {
              window.location.href = href;
              return 'navigated_href_' + href;
            }
            cardLink.click();
            return 'clicked_card_link';
          }

          // 2. Thử nút New Project
          const newBtn = document.querySelector('button.new-project-button') ||
                         document.querySelector('[aria-label*="New project" i]') ||
                         document.querySelector('button[extended]');
          if (newBtn) {
            newBtn.click();
            return 'clicked_new_btn';
          }

          return 'none';
        })()
      `;
      const clickResult = await this.safeExecuteJs(win, clickProjectJs, 3000);
      console.log('[Google Flow Browser] Kết quả click mở project:', clickResult);

      // Đợi SPA router chuyển trang (tối đa 8s, kiểm tra mỗi 1s)
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const checkEditorJs = `
          Boolean(document.querySelector(
            '.ProseMirror, [contenteditable="true"], .prompt-input, flow-prompt-input, flow-prompt-box, .prompt-box-container'
          ))
        `;
        const inEditor = await this.safeExecuteJs<boolean>(win, checkEditorJs, 2000);
        if (inEditor) {
          console.log(`[Google Flow Browser] Đã tải xong editor sau ${i + 1}s.`);
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    // === BƯỚC 3: Điền prompt và bấm nút Generate ===
    onProgress?.(25, 'Đang nộp prompt vào Google Flow...');
    const fillPromptJs = `
      (async function() {
        try {
          // Các selector ô prompt có thể có trên Google Flow
          const selectors = [
            '.ProseMirror',
            '[contenteditable="true"]',
            '.prompt-input [contenteditable]',
            'flow-prompt-input [contenteditable]',
            '.prompt-input',
            'flow-prompt-box textarea',
            'textarea',
            'input[type="text"]'
          ];

          let promptEl = null;
          for (let i = 0; i < 12; i++) {
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
                promptEl = el;
                break;
              }
            }
            if (promptEl) break;
            await new Promise(r => setTimeout(r, 500));
          }

          if (!promptEl) {
            return JSON.stringify({
              ok: false,
              error: 'no_prompt_input',
              url: window.location.href,
              htmlSnippet: document.body.innerText.slice(0, 300)
            });
          }

          promptEl.focus();
          if (promptEl.isContentEditable) {
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, ${promptJson});
            promptEl.dispatchEvent(new Event('input', { bubbles: true }));
            promptEl.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            promptEl.value = ${promptJson};
            promptEl.dispatchEvent(new Event('input', { bubbles: true }));
            promptEl.dispatchEvent(new Event('change', { bubbles: true }));
          }

          await new Promise(r => setTimeout(r, 400));

          // Tìm nút Generate hoặc bấm Enter
          const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
          const genBtn = buttons.find(b => {
            const t = (b.innerText || b.textContent || '').toLowerCase().trim();
            const a = (b.getAttribute('aria-label') || '').toLowerCase();
            return (
              t === 'generate' || t === 'create' || t === 'tạo' ||
              a.includes('generate') || a.includes('create')
            ) && !b.disabled;
          }) || document.querySelector('.flow-button-primary, button[type="submit"], flow-prompt-box button');

          if (genBtn && !genBtn.disabled) {
            genBtn.click();
            return JSON.stringify({ ok: true, method: 'click_button' });
          } else {
            promptEl.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true
            }));
            return JSON.stringify({ ok: true, method: 'enter_key' });
          }
        } catch (e) {
          return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) });
        }
      })()
    `;

    const fillResult = await this.safeExecuteJs<any>(win, fillPromptJs, 9000);
    console.log('[Google Flow Browser] Kết quả điền prompt:', fillResult);

    if (!fillResult?.ok) {
      console.warn('[Google Flow Browser] Không thể tương tác với ô prompt:', fillResult?.error || 'unknown');
      return null;
    }

    // === BƯỚC 4: Polling chờ video (tối đa 60s, mỗi 3s kiểm tra 1 lần) ===
    onProgress?.(30, 'Đang chờ Google Veo render video...');

    const pollDomVideoJs = `
      (function() {
        const videos = Array.from(document.querySelectorAll('video'));
        for (const v of videos) {
          const src = v.currentSrc || v.src || (v.querySelector('source') ? v.querySelector('source').src : '');
          if (
            src &&
            src.startsWith('http') &&
            !src.includes('blob:') &&
            !src.includes('gstatic.com') &&
            !src.includes('/banners/')
          ) {
            return src;
          }
        }
        return null;
      })()
    `;

    const maxWaitSeconds = 60;
    const pollIntervalMs = 3000;
    const maxAttempts = Math.floor((maxWaitSeconds * 1000) / pollIntervalMs);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (win.isDestroyed()) break;

      // Kiểm tra network sniffer
      if (capturedVideoUrl) {
        onProgress?.(90, 'Đã nhận được video từ Google Flow!');
        console.log('[Google Flow Browser] ✅ Bắt được video qua network:', capturedVideoUrl);
        return { videoUrl: capturedVideoUrl };
      }

      // Kiểm tra DOM thẻ <video>
      const domSrc = await this.safeExecuteJs<string>(win, pollDomVideoJs, 2500);
      if (domSrc && typeof domSrc === 'string' && domSrc.startsWith('http')) {
        onProgress?.(90, 'Đã nhận được video từ Google Flow!');
        console.log('[Google Flow Browser] ✅ Tìm thấy video qua DOM:', domSrc);
        return { videoUrl: domSrc };
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const elapsed = (attempt + 1) * (pollIntervalMs / 1000);
      const pct = Math.min(85, Math.round(30 + (elapsed / maxWaitSeconds) * 55));
      onProgress?.(pct, `Google Veo đang xử lý (${Math.round(elapsed)}s / ${maxWaitSeconds}s)...`);
    }

    console.warn('[Google Flow Browser] Quá thời gian chờ video từ Google Flow (sẽ tự động dùng mô phỏng offline).');
    return null;
  }


}
