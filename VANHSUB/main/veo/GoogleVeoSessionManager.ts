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

export const OFFSCREEN_X = -3000;
export const OFFSCREEN_Y = -3000;

export class GoogleVeoSessionManager {
  private static instance: GoogleVeoSessionManager | null = null;
  private lobbyWindow: any = null;
  private isLobbyDebugVisible = false;
  private _webRequestListenerAttached = false;
  private lastPermissionConfirmedAt = 0;

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
      if (!this.isLobbyDebugVisible) {
        this.lobbyWindow.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
      }
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
      x: OFFSCREEN_X,
      y: OFFSCREEN_Y,
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
      this.isLobbyDebugVisible = false;
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
    const credits = SettingsStore.get('veoFlowCredits') ?? null;
    const creditsCheckedAt = Number(SettingsStore.get('veoFlowCreditsCheckedAt')) || undefined;
    const antiSpam = GoogleVeoAntiSpamGuard.getInstance().getStatus();

    return {
      mode,
      hasSession,
      sessionStatus,
      email,
      credits,
      creditsCheckedAt,
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
   * Đọc số lượng credit Google Flow còn lại từ panel tài khoản Google (iframe accounts.google.com).
   * Luôn bọc trong try/catch và timeout 4s, trả về number | null, không throw lỗi.
   */
  private async readFlowCredits(win: any): Promise<number | null> {
    if (!win || win.isDestroyed()) return null;

    const readPromise = (async (): Promise<number | null> => {
      try {
        // 1. Click vào nút/avatar mở panel tài khoản Google trên trang chính
        const clickAvatarJs = `
          (function() {
            const selectors = [
              'a.gb_A',
              '[aria-label*="Google Account" i]',
              '[aria-label*="Tài khoản Google" i]',
              'a[href*="myaccount.google.com"]'
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el) {
                el.click();
                return true;
              }
            }
            return false;
          })()
        `;

        const clicked = await this.safeExecuteJs<boolean>(win, clickAvatarJs, 2000);
        // 2. Nếu không tìm thấy nút để click, trả về null ngay, không throw lỗi
        if (!clicked) {
          console.log('[Google Flow Credits] Không tìm thấy nút avatar tài khoản Google để mở panel.');
          return null;
        }

        // 3. Đợi khoảng 700-900ms để iframe panel kịp render
        await new Promise((r) => setTimeout(r, 800));
        if (win.isDestroyed()) return null;

        // 4. Duyệt qua win.webContents.mainFrame.framesInSubtree, tìm frame có url chứa accounts.google.com
        const frames: any[] = win.webContents?.mainFrame?.framesInSubtree || [];
        const accountFrames = frames.filter((f) => {
          const u = (f?.url || '').toLowerCase();
          return u.includes('accounts.google.com');
        });

        if (accountFrames.length === 0) {
          console.log('[Google Flow Credits] Không tìm thấy iframe accounts.google.com trong trang.');
          return null;
        }

        let foundCredits: number | null = null;

        // 5. Trong frame đó, gọi frame.executeJavaScript(...) để lấy document.body.innerText
        for (const frame of accountFrames) {
          try {
            const textPromise = frame.executeJavaScript('(document.body ? document.body.innerText : "") || ""');
            const frameTimeout = new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error('frame timeout')), 1500)
            );
            const text: string = (await Promise.race([textPromise, frameTimeout]).catch(() => '')) || '';

            if (!text) continue;

            // Regex bắt số đứng trước cụm "tín dụng Google Flow" hoặc "Google Flow credits"
            // Loại bỏ dấu chấm/phẩy phân cách nghìn, parse thành số nguyên
            const matchBefore = text.match(/([0-9][0-9.,]*)\s*(?:tín\s*dụng\s*google\s*flow|google\s*flow\s*credits)/i);
            if (matchBefore && matchBefore[1]) {
              const cleanStr = matchBefore[1].replace(/[.,\s]/g, '');
              const val = parseInt(cleanStr, 10);
              if (!isNaN(val)) {
                foundCredits = val;
                break;
              }
            }

            // Fallback: hỗ trợ trường hợp số đứng sau cụm từ (ví dụ "Tín dụng Google Flow: 30")
            const matchAfter = text.match(/(?:tín\s*dụng\s*google\s*flow|google\s*flow\s*credits)[:\s]+([0-9][0-9.,]*)/i);
            if (matchAfter && matchAfter[1]) {
              const cleanStr = matchAfter[1].replace(/[.,\s]/g, '');
              const val = parseInt(cleanStr, 10);
              if (!isNaN(val)) {
                foundCredits = val;
                break;
              }
            }
          } catch {}
        }

        return foundCredits;
      } catch (err: any) {
        console.warn('[Google Flow Credits] Lỗi khi đọc credit từ panel:', err?.message || err);
        return null;
      } finally {
        // 6. Sau khi đọc xong (dù thành công hay thất bại), gửi phím Escape để đóng panel lại
        try {
          if (!win.isDestroyed()) {
            await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
            await new Promise((r) => setTimeout(r, 60));
            await win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
          }
        } catch {}
      }
    })();

    // 7. Bọc toàn bộ trong timeout tổng thể không quá 4 giây
    const overallTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
    return Promise.race([readPromise, overallTimeout]);
  }

  /**
   * Lấy số credit Google Flow từ cache hoặc mở panel đọc trực tiếp nếu cache hết hạn.
   * KHÔNG được gọi trong luồng generate chính để tránh tốn thời gian và can thiệp UI.
   * @param maxAgeMs Thời gian hợp lệ của cache (mặc định 20 phút = 20 * 60 * 1000 ms)
   */
  async getCachedOrFreshCredits(maxAgeMs = 20 * 60 * 1000): Promise<number | null> {
    const cachedCredits = SettingsStore.get('veoFlowCredits');
    const checkedAt = Number(SettingsStore.get('veoFlowCreditsCheckedAt')) || 0;

    // 1. Nếu đã có giá trị cache và Date.now() - veoFlowCreditsCheckedAt < maxAgeMs, trả thẳng giá trị cache
    if (cachedCredits !== null && typeof cachedCredits === 'number' && Date.now() - checkedAt < maxAgeMs) {
      return cachedCredits;
    }

    // 2. Ngược lại, gọi ensureLobbyAtFlow() để đảm bảo có window sẵn sàng
    const ready = await this.ensureLobbyAtFlow();
    if (!ready || !this.lobbyWindow || this.lobbyWindow.isDestroyed()) {
      return cachedCredits ?? null;
    }

    // 3. Gọi readFlowCredits, lưu kết quả + timestamp mới vào SettingsStore, trả về kết quả
    const freshCredits = await this.readFlowCredits(this.lobbyWindow);
    if (freshCredits !== null) {
      console.log(`[Google Flow Credits] Đã cập nhật số credit Google Flow: ${freshCredits}`);
      SettingsStore.set('veoFlowCredits', freshCredits);
      SettingsStore.set('veoFlowCreditsCheckedAt', Date.now());

      if (freshCredits === 0) {
        SettingsStore.set('veoSessionStatus', 'out_of_credits');
      }
      return freshCredits;
    }

    return cachedCredits ?? null;
  }

  /**
   * Tạo một Dự án mới (New Project) sạch sẽ trên Google Flow.
   * Tuyệt đối không click vào các thẻ project cũ (flow-project-card).
   */
  public async createNewProject(
    win?: any,
    onProgress?: (pct: number, msg: string) => void,
    isCancelled?: () => boolean
  ): Promise<boolean> {
    const targetWin = win || this.lobbyWindow;
    if (!targetWin || targetWin.isDestroyed()) return false;

    const currentUrl = targetWin.webContents?.getURL?.() || '';

    // Nếu đang ở trong một project cũ, tải lại trang sảnh chính để reset sạch
    if (currentUrl.includes('/project/')) {
      console.log('[Google Flow Browser] Đang thoát khỏi project cũ để tạo project mới sạch sẽ...');
      onProgress?.(14, 'Đang điều hướng về trang chủ Google Flow...');
      try {
        await targetWin.loadURL('https://flow.google.com/');
      } catch {}
    }

    // Đảm bảo URL là flow.google.com và trang không còn đang loading
    for (let i = 0; i < 15; i++) {
      if (isCancelled?.()) return false;
      const url = targetWin.webContents?.getURL?.() || '';
      const isLoading = targetWin.webContents?.isLoading?.();
      if (url.includes('flow.google.com') && !url.includes('/project/') && !isLoading) {
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 1000));

    onProgress?.(16, 'Đang tìm và nhấn nút Tạo dự án mới...');

    // Tìm và nhấn nút New Project (Tuyệt đối không click flow-project-card)
    const clickNewProjJs = `
      (function() {
        function isVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        }

        const buttons = Array.from(document.querySelectorAll(
          'button.new-project-button, button.mdc-fab, [aria-label*="New project" i], [aria-label*="Dự án mới" i], button[extended], button'
        )).filter(el => {
          if (!isVisible(el)) return false;
          const txt = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
          const cls = (el.className || '').toLowerCase();
          return cls.includes('new-project-button') || txt.includes('dự án mới') || txt.includes('new project');
        });

        const btn = buttons[0];
        if (btn) {
          const rect = btn.getBoundingClientRect();
          btn.click();
          return JSON.stringify({
            ok: true,
            coords: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
          });
        }
        return JSON.stringify({ ok: false });
      })()
    `;

    let clickSucceeded = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      if (isCancelled?.()) return false;

      const clickRes = await this.safeExecuteJs<any>(targetWin, clickNewProjJs, 2500);
      if (clickRes?.ok) {
        clickSucceeded = true;
        console.log(`[Google Flow Browser] ✅ Đã click nút New Project (lần thử ${attempt + 1}):`, clickRes);
        if (clickRes.coords && !targetWin.isDestroyed()) {
          try {
            targetWin.webContents.sendInputEvent({
              type: 'mouseDown',
              x: clickRes.coords.x,
              y: clickRes.coords.y,
              button: 'left',
              clickCount: 1,
            });
            await new Promise((r) => setTimeout(r, 40));
            targetWin.webContents.sendInputEvent({
              type: 'mouseUp',
              x: clickRes.coords.x,
              y: clickRes.coords.y,
              button: 'left',
              clickCount: 1,
            });
          } catch {}
        }
        break;
      }
      await new Promise((r) => setTimeout(r, 800));
    }

    if (!clickSucceeded) {
      console.warn('[Google Flow Browser] ⚠️ Không tìm thấy nút New Project sau 10s.');
      return false;
    }

    // Đợi URL chuyển thành /project/<uuid> và editor sẵn sàng (tối đa 20s)
    onProgress?.(18, 'Đang chờ Google Flow khởi tạo workspace dự án mới...');
    for (let i = 0; i < 20; i++) {
      if (isCancelled?.()) return false;
      await new Promise((r) => setTimeout(r, 1000));

      const checkReadyJs = `
        (function() {
          const inProj = window.location.href.includes('/project/');
          const promptEl = document.querySelector('.ProseMirror, [contenteditable="true"], .prompt-input');
          return inProj && Boolean(promptEl);
        })()
      `;
      const isReady = await this.safeExecuteJs<boolean>(targetWin, checkReadyJs, 2000);
      if (isReady) {
        console.log(`[Google Flow Browser] ✅ Dự án mới đã sẵn sàng sau ${i + 1}s:`, targetWin.webContents.getURL());
        await new Promise((r) => setTimeout(r, 1000));
        return true;
      }
    }

    console.warn('[Google Flow Browser] ⚠️ Quá thời gian chờ khởi tạo dự án mới.');
    return false;
  }

  /**
   * Đảm bảo cửa sổ Flow đang ở đúng project context mong muốn:
   * - Nếu targetProjectId được truyền vào: Điều hướng/giữ nguyên đúng project đó.
   * - Nếu targetProjectId KHÔNG được truyền vào: Bắt buộc tạo project mới sạch sẽ, không dùng project cũ.
   */
  private async ensureProjectContext(
    win: any,
    targetProjectId?: string,
    onProgress?: (pct: number, msg: string) => void,
    isCancelled?: () => boolean
  ): Promise<boolean> {
    if (!win || win.isDestroyed()) return false;

    const currentUrl = win.webContents?.getURL?.() || '';

    // Trường hợp 1: Có targetProjectId cụ thể (tiếp nối chuỗi thao tác cùng dự án)
    if (targetProjectId) {
      if (currentUrl.includes(`/project/${targetProjectId}`)) {
        console.log(`[Google Flow Browser] Đã ở đúng project được chỉ định: ${targetProjectId}`);
        return true;
      }
      onProgress?.(15, `Đang mở dự án ${targetProjectId}...`);
      try {
        await win.loadURL(`https://flow.google.com/project/${targetProjectId}`);
        for (let i = 0; i < 20; i++) {
          if (isCancelled?.()) return false;
          await new Promise((r) => setTimeout(r, 1000));
          const ready = await this.safeExecuteJs<boolean>(
            win,
            `Boolean(document.querySelector('.ProseMirror, [contenteditable="true"], .prompt-input'))`,
            2000
          );
          if (ready) {
            console.log(`[Google Flow Browser] Đã tải xong project ${targetProjectId} sau ${i + 1}s.`);
            return true;
          }
        }
      } catch {}
      return false;
    }

    // Trường hợp 2: KHÔNG có targetProjectId -> Bắt buộc tạo project mới hoàn toàn
    return await this.createNewProject(win, onProgress, isCancelled);
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
      outputCount?: number;
      projectId?: string;
    },
    onProgress?: (percent: number, msg?: string) => void,
    isCancelled?: () => boolean
  ): Promise<{ videoUrl?: string; base64Data?: string; projectId?: string; error?: 'out_of_credits' | 'timeout' | 'button_not_found' | 'agent_error' | string; errorDetail?: string; } | null> {
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
    let generateClickedAt = 0;
    const baselineUrlsSet = new Set<string>();
    const ses = electron.session.fromPartition('persist:google_veo');
    const netFilter = { urls: ['*://*/*'] };

    const onResponseStartedHandler = (details: any) => {
      // Chỉ chấp nhận response có thời điểm xảy ra SAU khi bấm nút Generate của lượt này
      if (!generateClickedAt || Date.now() < generateClickedAt) return;
      const elapsed = Date.now() - generateClickedAt;
      // Google Veo mất tối thiểu 12s-20s để render, bỏ qua các response thumbnail ban đầu
      if (elapsed < 12000) return;

      const url = details.url || '';
      // Bỏ qua mọi response thuộc danh sách asset đã có trước đó
      if (baselineUrlsSet.has(url)) return;

      const headers = details.responseHeaders || {};
      const ct = (headers['content-type']?.[0] || headers['Content-Type']?.[0] || '').toLowerCase();

      // Bỏ qua các video banner quảng cáo tĩnh từ gstatic / webview
      const isStaticBanner = url.includes('gstatic.com') || url.includes('/banners/') || url.includes('landing_page') || url.includes('favicon');

      if (
        (ct.includes('video/mp4') || ct.includes('video/webm') || url.includes('.mp4') || url.includes('googlevideo.com/videoplayback') || url.includes('flow-content.google/video/')) &&
        !url.includes('blank') &&
        !isStaticBanner &&
        details.statusCode >= 200 && details.statusCode < 300
      ) {
        console.log('[Google Flow Network] 🎬 Bắt được luồng video Veo mới thật:', url.slice(0, 100));
        capturedVideoUrl = url;
      }
    };

    try {
      ses.webRequest.onResponseStarted(netFilter, onResponseStartedHandler);

      const promptClean = (params.prompt || '').trim() || 'Cinematic animation, vibrant dynamic motion, beautiful render';
      const promptJson = JSON.stringify(promptClean);

      onProgress?.(12, 'Đang chuẩn bị workspace Google Flow cho video...');

      // BƯỚC 1: Đảm bảo đúng Project Context (Dự án mới nếu không có projectId cụ thể)
      const projectReady = await this.ensureProjectContext(win, params.projectId, onProgress, isCancelled);
      if (!projectReady) {
        console.warn('[Google Flow Browser] Không thể mở hoặc tạo dự án video trên Google Flow.');
        return null;
      }

      if (isCancelled?.()) return null;

      // Thiết lập Mode VIDEO và Output Count (mặc định x1 để tránh tạo trùng)
      const switchModeToVideoJs = `
        (function() {
          function isElementVisible(el) {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            if (el.offsetParent === null && style.position !== 'fixed') return false;
            return true;
          }

          const targetCount = ${params.outputCount || 1};
          try {
            const raw = localStorage.getItem('flow-prompt-box-settings');
            const settings = raw ? JSON.parse(raw) : {};
            settings.mode = 'VIDEO';
            settings.Qp = targetCount;
            localStorage.setItem('flow-prompt-box-settings', JSON.stringify(settings));
            window.dispatchEvent(new StorageEvent('storage', {
              key: 'flow-prompt-box-settings',
              newValue: JSON.stringify(settings)
            }));
          } catch (e) {}

          const allButtons = Array.from(document.querySelectorAll(
            'button, mat-button-toggle, [role="tab"], .mat-button-toggle-button, [aria-label*="Output count" i] button'
          )).filter(isElementVisible);

          const countBtn = allButtons.find(b => {
            const t = (b.innerText || b.textContent || '').trim().toLowerCase();
            return t === 'x' + targetCount || t === 'x1';
          });
          if (countBtn) countBtn.click();

          const vidBtn = allButtons.find(b => {
            const label = (b.getAttribute('aria-label') || b.textContent || b.innerText || '').toLowerCase();
            return (
              label === 'video' ||
              label.includes('video mode') ||
              label.includes('tạo video')
            );
          });
          if (vidBtn) {
            vidBtn.click();
            return 'clicked_vid_btn';
          }
          return 'storage_updated';
        })()
      `;
      await this.safeExecuteJs(win, switchModeToVideoJs, 2000);

      // Bước bắt buộc: Dọn sạch canvas và xác nhận ô prompt sẵn sàng trước khi điền
      await this.ensureCleanCanvasReady(win, 'video', onProgress, isCancelled);

      if (isCancelled?.()) return null;

      // Chụp snapshot baseline các URL video/card hiện có trên trang để loại trừ 100% video cũ
      const captureBaselineJs = `
        (function() {
          const urls = new Set();
          document.querySelectorAll('video, video source, a[href*="flow-content"], a[href*="videoplayback"], flow-video-tile, flow-image-tile, .video-container').forEach(el => {
            const s = el.currentSrc || el.src || el.href;
            if (s && !s.includes('gstatic') && !s.includes('/banners/')) urls.add(s);
            const mid = el.getAttribute('data-media-id');
            if (mid) urls.add(mid);
          });
          document.querySelectorAll('flow-media-card, flow-video-card, flow-card, flow-chat-view, .media-card, video, flow-video-tile, flow-image-tile, .video-container').forEach(el => {
            el.setAttribute('data-flow-existing', 'true');
          });
          return Array.from(urls);
        })()
      `;
      const baselineUrlsList = (await this.safeExecuteJs<string[]>(win, captureBaselineJs, 3000)) || [];
      for (const u of baselineUrlsList) baselineUrlsSet.add(u);
      console.log(`[Google Flow Browser] 📋 Đã ghi nhận baseline video: ${baselineUrlsList.length} media URLs có sẵn.`);

      // === BƯỚC 3: Điền prompt và bấm nút Generate ===
      onProgress?.(25, 'Đang nộp prompt vào Google Flow...');

      // Đảm bảo cửa sổ được hiển thị và lấy focus để Chromium kích hoạt input
      if (!win.isDestroyed()) {
        try {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
          if (!this.isLobbyDebugVisible) {
            win.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
          }
          console.log('[Google Flow Browser] Vị trí cửa sổ sau show/focus (Video):', win.getPosition());
        } catch {}
      }

      // 1. Focus vào ô soạn thảo trong DOM trước
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
              const selObj = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(el);
              selObj.removeAllRanges();
              selObj.addRange(range);
              return true;
            }
          }
          return false;
        })()
      `;
      await this.safeExecuteJs(win, focusEditorJs, 2500);

      // 2. Nạp prompt vào Clipboard và kích hoạt native paste qua WebContents
      try {
        electron.clipboard.writeText(promptClean);
        win.focus();
        win.webContents.paste();
      } catch (e) {
        console.warn('[Google Flow Browser] Clipboard paste error:', e);
      }

      await new Promise((r) => setTimeout(r, 400));

      // 3. Thực thi đoạn mã hoàn tất việc điền và định vị nút Submit
      const fillPromptJs = `
        (async function() {
          try {
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
            for (let i = 0; i < 20; i++) {
              for (const sel of selectors) {
                const el = promptBox.querySelector(sel) || document.querySelector(sel);
                if (el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
                  promptEl = el;
                  break;
                }
              }
              if (promptEl) break;
              await new Promise(r => setTimeout(r, 300));
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

            // Nạp nội dung vào ProseMirror bằng delete + insertText chuẩn để Angular nhận diện state
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

            await new Promise(r => setTimeout(r, 300));
            let textAfterInsert = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();
            if (!textAfterInsert && promptEl.isContentEditable) {
              promptEl.innerHTML = '<p>' + ${JSON.stringify(promptClean)} + '</p>';
              promptEl.dispatchEvent(new Event('input', { bubbles: true }));
              await new Promise(r => setTimeout(r, 200));
              textAfterInsert = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();
            }

            function isElementVisible(el) {
              if (!el) return false;
              const rect = el.getBoundingClientRect();
              if (!rect || rect.width <= 0 || rect.height <= 0) return false;
              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              if (el.offsetParent === null && style.position !== 'fixed') return false;
              return true;
            }

            // Tìm nút Submit / Generate đang thực sự hiển thị trên DOM (loại trừ các nút helper)
            const genBtnSelectors = [
              'flow-generate-icon-button button',
              'button.generate-icon-button',
              'button[type="submit"]',
              'button[aria-label*="Bắt đầu tạo" i]',
              'button[aria-label*="Start generation" i]',
              'button[aria-label*="Tạo video" i]',
              'button[aria-label*="Tạo ảnh" i]',
              'button[aria-label="Generate" i]',
              'flow-generate-button button',
              'button.submit-button'
            ];

            let genBtn = null;
            let btnCoords = null;
            for (let i = 0; i < 20; i++) {
              const scope = promptBox || document;
              let candidates = Array.from(scope.querySelectorAll(genBtnSelectors.join(', '))).filter(el => {
                if (!isElementVisible(el)) return false;
                if (el.classList.contains('agent-action-button') ||
                    el.classList.contains('settings-trigger-button') ||
                    el.classList.contains('add-menu-trigger') ||
                    el.classList.contains('header-action') ||
                    el.classList.contains('suggestion-card')) {
                  return false;
                }
                return true;
              });
              if (candidates.length === 0 && scope !== document) {
                candidates = Array.from(document.querySelectorAll(genBtnSelectors.join(', '))).filter(el => {
                  if (!isElementVisible(el)) return false;
                  if (el.classList.contains('agent-action-button') ||
                      el.classList.contains('settings-trigger-button') ||
                      el.classList.contains('add-menu-trigger') ||
                      el.classList.contains('header-action') ||
                      el.classList.contains('suggestion-card')) {
                    return false;
                  }
                  return true;
                });
              }
              if (candidates.length > 0) {
                const target = candidates.find(b =>
                  b.classList.contains('generate-icon-button') ||
                  b.getAttribute('type') === 'submit' ||
                  (b.getAttribute('aria-label') || '').toLowerCase().includes('bắt đầu tạo') ||
                  (b.getAttribute('aria-label') || '').toLowerCase().includes('tạo video') ||
                  (b.getAttribute('aria-label') || '').toLowerCase().includes('tạo ảnh')
                ) || candidates[0];

                const rect = target.getBoundingClientRect();
                if (rect && rect.width > 0 && rect.height > 0) {
                  genBtn = target;
                  btnCoords = {
                    x: Math.round(rect.x + rect.width / 2),
                    y: Math.round(rect.y + rect.height / 2)
                  };
                  break;
                }
              }
              await new Promise(r => setTimeout(r, 200));
            }

            if (genBtn && btnCoords) {
              genBtn.disabled = false;
              genBtn.removeAttribute('disabled');
              genBtn.setAttribute('aria-disabled', 'false');

              genBtn.click();
              return JSON.stringify({
                ok: true,
                method: 'click_gen_button',
                insertedText: textAfterInsert.slice(0, 80),
                buttonFound: true,
                btnCoords
              });
            }

            // Fallback: dispatch phím Enter
            promptEl.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true
            }));

            const debugSnippet = promptBox ? (promptBox.outerHTML || '').slice(0, 500) : '';

            return JSON.stringify({
              ok: true,
              method: 'enter_key',
              insertedText: textAfterInsert.slice(0, 80),
              buttonFound: false,
              btnCoords: null,
              debugSnippet
            });
          } catch (e) {
            return JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) });
          }
        })()
      `;

      const fillResult = await this.safeExecuteJs<any>(win, fillPromptJs, 9000);
      console.log('[Google Flow Browser] Kết quả điền prompt video:', fillResult);

      if (!fillResult?.ok || !fillResult?.buttonFound || !fillResult?.btnCoords) {
        console.warn('[Google Flow Browser] ❌ Không thể tìm thấy nút Tạo video:', fillResult?.error || 'gen_btn_not_found');
        return null;
      }

      // Gửi click chuột thật qua webContents.sendInputEvent tại đúng toạ độ btnCoords
      if (!win.isDestroyed()) {
        try {
          console.log('[Google Flow Browser] 🖱️ Gửi click chuột thật tới nút Tạo video:', fillResult.btnCoords);
          win.webContents.sendInputEvent({
            type: 'mouseDown',
            x: fillResult.btnCoords.x,
            y: fillResult.btnCoords.y,
            button: 'left',
            clickCount: 1,
          });
          await new Promise((r) => setTimeout(r, 50));
          win.webContents.sendInputEvent({
            type: 'mouseUp',
            x: fillResult.btnCoords.x,
            y: fillResult.btnCoords.y,
            button: 'left',
            clickCount: 1,
          });
        } catch (clickErr: any) {
          console.warn('[Google Flow Browser] Native mouse click warning:', clickErr?.message);
        }
      }

      // Đánh dấu chính xác thời điểm bấm nút Generate của lượt hiện tại
      generateClickedAt = Date.now();

      // Đợi 300ms và tự động xác nhận quyền của Tác nhân nếu có
      await new Promise((r) => setTimeout(r, 300));
      const agentCheckInit = await this.autoConfirmAgentPermission(win);
      if (agentCheckInit.startsWith('agent_error:')) {
        console.error('[Google Flow Browser] 🛑 Dừng tác vụ vì Tác nhân Google Flow báo lỗi:', agentCheckInit);
        return { error: 'agent_error', errorDetail: agentCheckInit };
      }

      if (isCancelled?.()) return null;

      // Xác nhận phản hồi ban đầu của Flow
      const checkVideoStartedJs = `
        (function() {
          const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container');
          const promptEl = promptBox ? promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea') : null;
          const currentText = promptEl ? (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim() : '';

          const hasSpinner = Boolean(document.querySelector(
            'flow-loading-indicator, flow-progress-bar, mat-progress-spinner, mat-spinner, .generation-in-progress, [role="progressbar"], flow-card[state="generating"], .loading-spinner'
          ));

          const btnDisabled = Boolean(document.querySelector(
            'flow-generate-icon-button button[disabled], button.generate-icon-button[disabled], button[aria-disabled="true"]'
          ));

          return JSON.stringify({
            isCleared: currentText.length === 0,
            hasSpinner,
            btnDisabled,
            textLen: currentText.length
          });
        })()
      `;

      let startedStatus: any = null;
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 200));
        startedStatus = await this.safeExecuteJs<any>(win, checkVideoStartedJs, 1500);
        if (startedStatus?.isCleared || startedStatus?.hasSpinner) break;
      }
      console.log('[Google Flow Browser] Xác nhận phản hồi ban đầu của Flow (Video):', startedStatus);

      if (startedStatus && !startedStatus.isCleared && !startedStatus.hasSpinner && !startedStatus.btnDisabled && !win.isDestroyed()) {
        console.log('[Google Flow Browser] ⚠️ Flow chưa nhận lệnh (text còn nguyên, chưa loading), kích hoạt bổ trợ Enter native...');
        try {
          await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
          await new Promise((r) => setTimeout(r, 60));
          await win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        } catch {}
        await new Promise((r) => setTimeout(r, 1500));
      }

      if (isCancelled?.()) return null;

      // === BƯỚC 4: Polling chờ video (tối đa 240s, mỗi 3s kiểm tra 1 lần) ===
      onProgress?.(30, 'Đang chờ Google Veo render video...');

      const pollAndTriggerVideoJs = `
        (async function() {
          const baselineList = ${JSON.stringify(baselineUrlsList)};
          const baselineSet = new Set(baselineList);

          // 1. Kiểm tra nếu có thẻ <video> trực tiếp
          try {
            const videos = Array.from(document.querySelectorAll('video'));
            for (const v of videos) {
              if (v.closest('[data-flow-existing="true"]')) continue;
              const src = v.currentSrc || v.src || (v.querySelector('source') ? v.querySelector('source').src : '');
              if (!src || src.includes('/banners/') || src.includes('googleusercontent.com/a/')) continue;
              if (baselineSet.has(src)) continue;
              if (src.startsWith('http')) return { type: 'http', videoUrl: src };
            }
          } catch (e) {}

          // 2. Kiểm tra flow-video-tile trên canvas
          try {
            const allTiles = Array.from(document.querySelectorAll('flow-video-tile'));
            const newTiles = allTiles.filter(t => !t.closest('[data-flow-existing="true"]') && !t.hasAttribute('data-flow-existing'));

            // 3. Kiểm tra .video-container.clickable trong chat view
            const allChatVid = Array.from(document.querySelectorAll('.video-container.clickable, flow-chat-view .video-container'));
            const newChatVid = allChatVid.filter(c => !c.closest('[data-flow-existing="true"]') && !c.hasAttribute('data-flow-existing'));

            const bodyText = (document.body.innerText || '').toLowerCase();
            const chatSaysReady = bodyText.includes('your video is ready') || bodyText.includes('video của bạn đã sẵn sàng') || bodyText.includes('video is ready');

            // Kiểm tra các tile mới sinh ra trên canvas
            for (const tile of newTiles) {
              const progressBar = tile.querySelector('.progress-bar, [role="progressbar"]');
              const progressStyle = progressBar ? (progressBar.getAttribute('style') || '') : '';
              const isDone = !progressBar || progressStyle.includes('100%') || chatSaysReady;

              if (isDone) {
                // Click vào tile để Google Flow nạp luồng video .mp4 thật
                tile.click();
                return { type: 'triggered_click', source: 'tile' };
              }
            }

            // Kiểm tra các video container trong khung chat tác nhân
            for (const container of newChatVid) {
              container.click();
              return { type: 'triggered_click', source: 'chat' };
            }
          } catch (e) {}

          return null;
        })()
      `;

      const maxWaitSeconds = 240;
      const pollIntervalMs = 3000;
      const maxAttempts = Math.floor((maxWaitSeconds * 1000) / pollIntervalMs);

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (win.isDestroyed()) break;

        if (isCancelled?.()) {
          console.log('[Google Flow Browser] Tác vụ đã bị người dùng hủy bỏ.');
          return null;
        }

        // Tự động kiểm tra quyền hoặc phát hiện lỗi Tác nhân
        const agentStatus = await this.autoConfirmAgentPermission(win);
        if (agentStatus.startsWith('agent_error:')) {
          console.error('[Google Flow Browser] 🛑 Dừng tác vụ vì Tác nhân Google Flow báo lỗi:', agentStatus);
          return { error: 'agent_error', errorDetail: agentStatus };
        }

        const elapsedSinceClick = Date.now() - generateClickedAt;
        const minVideoTimeGate = 12000; // Tối thiểu 12s mới chấp nhận video thật

        // 1. Kiểm tra nếu đã bắt được URL video qua network listener
        if (capturedVideoUrl && elapsedSinceClick >= minVideoTimeGate) {
          onProgress?.(90, 'Đã nhận được video từ Google Flow!');
          console.log('[Google Flow Browser] ✅ Bắt được video qua network (sau ' + Math.round(elapsedSinceClick / 1000) + 's):', capturedVideoUrl);
          
          let projectId: string | undefined;
          try {
            const currentUrl = win.webContents?.getURL?.() || '';
            const match = currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
            if (match && match[1]) projectId = match[1];
          } catch {}

          return { videoUrl: capturedVideoUrl, projectId };
        }

        // 2. Thực thi kiểm tra DOM và kích hoạt click vào video tile/container nếu đã render xong
        if (elapsedSinceClick >= minVideoTimeGate) {
          const domResult = await this.safeExecuteJs<any>(win, pollAndTriggerVideoJs, 3500);
          if (domResult?.type === 'http' && domResult.videoUrl) {
            let projectId: string | undefined;
            try {
              const currentUrl = win.webContents?.getURL?.() || '';
              const match = currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
              if (match && match[1]) projectId = match[1];
            } catch {}

            onProgress?.(90, 'Đã nhận được video từ Google Flow!');
            console.log('[Google Flow Browser] ✅ Tìm thấy video HTTP qua DOM (sau ' + Math.round(elapsedSinceClick / 1000) + 's):', domResult.videoUrl);
            return { videoUrl: domResult.videoUrl, projectId };
          }
          if (domResult?.type === 'triggered_click') {
            console.log('[Google Flow Browser] 🎬 Phát hiện video hoàn tất trên ' + domResult.source + ', đã click kích hoạt luồng video MP4...');
            // Đợi 1000ms để network listener nhận response
            await new Promise((r) => setTimeout(r, 1000));
            if (capturedVideoUrl) {
              onProgress?.(90, 'Đã nhận được video từ Google Flow!');
              console.log('[Google Flow Browser] ✅ Bắt được video qua network sau khi kích hoạt:', capturedVideoUrl);
              let projectId: string | undefined;
              try {
                const currentUrl = win.webContents?.getURL?.() || '';
                const match = currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
                if (match && match[1]) projectId = match[1];
              } catch {}
              return { videoUrl: capturedVideoUrl, projectId };
            }
          }
        }

        await new Promise((r) => setTimeout(r, pollIntervalMs));
        const elapsed = (attempt + 1) * (pollIntervalMs / 1000);
        const pct = Math.min(85, Math.round(30 + (elapsed / maxWaitSeconds) * 55));
        onProgress?.(pct, `Google Veo đang xử lý (${Math.round(elapsed)}s / ${maxWaitSeconds}s)...`);
      }

      console.warn('[Google Flow Browser] Quá thời gian chờ video từ Google Flow.');

      const outOfCreditsJs = `
        (function() {
          const text = (document.body.innerText || '').toLowerCase();
          return (
            text.includes('hết tín dụng') ||
            text.includes('không đủ tín dụng') ||
            text.includes('insufficient credit') ||
            text.includes('out of credits') ||
            text.includes('you have run out')
          );
        })()
      `;
      const outOfCredits = await this.safeExecuteJs<boolean>(win, outOfCreditsJs, 2000);
      if (outOfCredits) {
        console.warn('[Google Flow Browser] Tài khoản đã hết credit Google Flow.');
        SettingsStore.set('veoSessionStatus', 'out_of_credits');
        SettingsStore.set('veoFlowCredits', 0);
        SettingsStore.set('veoFlowCreditsCheckedAt', Date.now());
        return { error: 'out_of_credits' };
      }

      return null;
    } finally {
      try {
        ses.webRequest.onResponseStarted(netFilter, null as any);
      } catch {}
    }
  }

  /**
   * Sinh ảnh trực tiếp trên trình duyệt Google Flow (Electron context)
   * Đảm bảo ảnh được tạo ngay trong project của Google Flow và xuất hiện trong lịch sử web flow.
   */
  async generateImageViaBrowserContext(
    params: {
      prompt: string;
      aspectRatio?: string;
      outputCount?: number;
      projectId?: string;
    },
    onProgress?: (pct: number, msg?: string) => void,
    isCancelled?: () => boolean
  ): Promise<{ imageUrl?: string; base64Data?: string; projectId?: string; error?: 'out_of_credits' | 'timeout' | 'button_not_found' | 'agent_error' | string; errorDetail?: string; } | null> {
    onProgress?.(5, 'Đang chuẩn bị Sảnh Google Flow...');

    const ready = await this.ensureLobbyAtFlow();
    if (!ready) {
      console.warn('[Google Flow Browser] Sảnh Google Flow chưa sẵn sàng.');
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

    // Network listener để bắt URL ảnh mới
    let capturedImageUrl: string | null = null;
    let generateClickedAt = 0;
    const baselineUrlsSet = new Set<string>();
    const ses = electron.session.fromPartition('persist:google_veo');
    const netFilter = { urls: ['*://*/*'] };

    const onResponseStartedHandler = (details: any) => {
      // Chỉ chấp nhận response có thời điểm xảy ra SAU khi bấm nút Generate của lượt này
      if (!generateClickedAt || Date.now() < generateClickedAt) return;
      const elapsed = Date.now() - generateClickedAt;
      // Google Flow mất tối thiểu 5s-10s để render ảnh mới, bỏ qua thumbnail cũ tải ngay trong 5s đầu
      if (elapsed < 5000) return;

      const url = details.url || '';
      // Bỏ qua mọi response thuộc danh sách media đã có trước khi click Generate
      if (baselineUrlsSet.has(url)) return;

      const headers = details.responseHeaders || {};
      const ct = (headers['content-type']?.[0] || headers['Content-Type']?.[0] || '').toLowerCase();

      const isStatic =
        url.includes('gstatic.com') ||
        url.includes('/banners/') ||
        url.includes('/asb/') ||
        url.includes('flow.google.com/asb') ||
        url.includes('landing_page') ||
        url.includes('favicon') ||
        url.includes('/avatar') ||
        url.includes('/a/ACg8') ||
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
        console.log('[Google Flow Network] 🖼️ Bắt được luồng ảnh Flow mới thật:', url.slice(0, 100));
        capturedImageUrl = url;
      }
    };

    try {
      ses.webRequest.onResponseStarted(netFilter, onResponseStartedHandler);

      const promptClean = (params.prompt || '').trim();
      const promptJson = JSON.stringify(promptClean);

      onProgress?.(12, 'Đang chuẩn bị workspace Google Flow cho ảnh...');

      // BƯỚC 1: Đảm bảo đúng Project Context (Dự án mới nếu không có projectId cụ thể)
      const projectReady = await this.ensureProjectContext(win, params.projectId, onProgress, isCancelled);
      if (!projectReady) {
        console.warn('[Google Flow Browser] Không thể mở hoặc tạo dự án ảnh trên Google Flow.');
        return null;
      }

      if (isCancelled?.()) return null;

      // Chuyển Mode sang IMAGE và thiết lập Output Count (mặc định x1) trong Google Flow
      const switchModeToImageJs = `
        (function() {
          function isElementVisible(el) {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            if (el.offsetParent === null && style.position !== 'fixed') return false;
            return true;
          }

          const targetCount = 1;
          try {
            const raw = localStorage.getItem('flow-prompt-box-settings');
            const settings = raw ? JSON.parse(raw) : {};
            settings.mode = 'IMAGE';
            settings.Qp = targetCount;
            localStorage.setItem('flow-prompt-box-settings', JSON.stringify(settings));
            window.dispatchEvent(new StorageEvent('storage', {
              key: 'flow-prompt-box-settings',
              newValue: JSON.stringify(settings)
            }));
          } catch (e) {}

          const allButtons = Array.from(document.querySelectorAll(
            'button, mat-button-toggle, [role="tab"], .mat-button-toggle-button, [aria-label*="Output count" i] button'
          )).filter(isElementVisible);

          const countBtn = allButtons.find(b => {
            const t = (b.innerText || b.textContent || '').trim().toLowerCase();
            return t === 'x' + targetCount || t === 'x1';
          });
          if (countBtn) countBtn.click();

          const imgBtn = allButtons.find(b => {
            const label = (b.getAttribute('aria-label') || b.textContent || b.innerText || '').toLowerCase();
            return label === 'image' || label.includes('image mode') || label.includes('tạo ảnh');
          });
          if (imgBtn) {
            imgBtn.click();
            return 'clicked_img_btn';
          }
          return 'storage_updated';
        })()
      `;
      await this.safeExecuteJs(win, switchModeToImageJs, 2000);

      // Bước bắt buộc: Dọn sạch canvas và xác nhận ô prompt sẵn sàng trước khi điền
      await this.ensureCleanCanvasReady(win, 'image', onProgress, isCancelled);

      if (isCancelled?.()) return null;

      // Chụp snapshot baseline các URL ảnh/card hiện có trên trang để loại trừ 100% ảnh cũ
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
      const baselineUrlsList = (await this.safeExecuteJs<string[]>(win, captureBaselineJs, 3000)) || [];
      for (const u of baselineUrlsList) baselineUrlsSet.add(u);
      console.log(`[Google Flow Browser] 📋 Đã ghi nhận baseline ảnh: ${baselineUrlsList.length} media URLs có sẵn.`);

      // === BƯỚC 3: Focus ô soạn thảo, dán prompt và click Generate ===
      onProgress?.(25, 'Đang nộp prompt sinh ảnh vào Google Flow...');

      if (!win.isDestroyed()) {
        try {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
          if (!this.isLobbyDebugVisible) {
            win.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
          }
          console.log('[Google Flow Browser] Vị trí cửa sổ sau show/focus (Image):', win.getPosition());
        } catch {}
      }

      // 1. Focus vào ô soạn thảo
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
              const selObj = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(el);
              selObj.removeAllRanges();
              selObj.addRange(range);
              return true;
            }
          }
          return false;
        })()
      `;
      await this.safeExecuteJs(win, focusEditorJs, 2500);

      // 2. Ghi prompt vào Clipboard và paste native
      try {
        electron.clipboard.writeText(promptClean);
        win.focus();
        win.webContents.paste();
      } catch (e) {
        console.warn('[Google Flow Browser] Clipboard paste error:', e);
      }

      await new Promise((r) => setTimeout(r, 400));

      // 3. Hoàn tất điền và bấm nút Tạo ảnh
      const fillPromptJs = `
        (async function() {
          try {
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
            for (let i = 0; i < 20; i++) {
              for (const sel of selectors) {
                const el = promptBox.querySelector(sel) || document.querySelector(sel);
                if (el && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
                  promptEl = el;
                  break;
                }
              }
              if (promptEl) break;
              await new Promise(r => setTimeout(r, 300));
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

            await new Promise(r => setTimeout(r, 300));
            let textAfterInsert = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();
            if (!textAfterInsert && promptEl.isContentEditable) {
              promptEl.innerHTML = '<p>' + ${JSON.stringify(promptClean)} + '</p>';
              promptEl.dispatchEvent(new Event('input', { bubbles: true }));
              await new Promise(r => setTimeout(r, 200));
              textAfterInsert = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();
            }

            function isElementVisible(el) {
              if (!el) return false;
              const rect = el.getBoundingClientRect();
              if (!rect || rect.width <= 0 || rect.height <= 0) return false;
              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              if (el.offsetParent === null && style.position !== 'fixed') return false;
              return true;
            }

            const genBtnSelectors = [
              'flow-generate-icon-button button',
              'button.generate-icon-button',
              'button[type="submit"]',
              'button[aria-label*="Bắt đầu tạo" i]',
              'button[aria-label*="Start generation" i]',
              'button[aria-label*="Tạo ảnh" i]',
              'button[aria-label*="Tạo video" i]',
              'button[aria-label="Generate" i]',
              'flow-generate-button button',
              'button.submit-button'
            ];

            let genBtn = null;
            let btnCoords = null;
            for (let i = 0; i < 20; i++) {
              const scope = promptBox || document;
              let candidates = Array.from(scope.querySelectorAll(genBtnSelectors.join(', '))).filter(el => {
                if (!isElementVisible(el)) return false;
                if (el.classList.contains('agent-action-button') ||
                    el.classList.contains('settings-trigger-button') ||
                    el.classList.contains('add-menu-trigger') ||
                    el.classList.contains('header-action') ||
                    el.classList.contains('suggestion-card')) {
                  return false;
                }
                return true;
              });
              if (candidates.length === 0 && scope !== document) {
                candidates = Array.from(document.querySelectorAll(genBtnSelectors.join(', '))).filter(el => {
                  if (!isElementVisible(el)) return false;
                  if (el.classList.contains('agent-action-button') ||
                      el.classList.contains('settings-trigger-button') ||
                      el.classList.contains('add-menu-trigger') ||
                      el.classList.contains('header-action') ||
                      el.classList.contains('suggestion-card')) {
                    return false;
                  }
                  return true;
                });
              }
              if (candidates.length > 0) {
                const target = candidates.find(b =>
                  b.classList.contains('generate-icon-button') ||
                  b.getAttribute('type') === 'submit' ||
                  (b.getAttribute('aria-label') || '').toLowerCase().includes('bắt đầu tạo') ||
                  (b.getAttribute('aria-label') || '').toLowerCase().includes('tạo ảnh') ||
                  (b.getAttribute('aria-label') || '').toLowerCase().includes('tạo video')
                ) || candidates[0];

                const rect = target.getBoundingClientRect();
                if (rect && rect.width > 0 && rect.height > 0) {
                  genBtn = target;
                  btnCoords = {
                    x: Math.round(rect.x + rect.width / 2),
                    y: Math.round(rect.y + rect.height / 2)
                  };
                  break;
                }
              }
              await new Promise(r => setTimeout(r, 200));
            }

            if (genBtn && btnCoords) {
              genBtn.disabled = false;
              genBtn.removeAttribute('disabled');
              genBtn.setAttribute('aria-disabled', 'false');

              genBtn.click();
              return JSON.stringify({
                ok: true,
                method: 'click_gen_button',
                insertedText: textAfterInsert.slice(0, 80),
                buttonFound: true,
                btnCoords
              });
            }

            // Fallback: dispatch phím Enter
            promptEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));

            const debugSnippet = promptBox ? (promptBox.outerHTML || '').slice(0, 500) : '';

            return JSON.stringify({
              ok: true,
              method: 'enter_key',
              insertedText: textAfterInsert.slice(0, 80),
              buttonFound: false,
              btnCoords: null,
              debugSnippet
            });
          } catch (e) {
            return JSON.stringify({ ok: false, error: String(e?.message || e) });
          }
        })()
      `;
      const fillResult = await this.safeExecuteJs<any>(win, fillPromptJs, 9000);
      console.log('[Google Flow Browser] Kết quả điền prompt ảnh:', fillResult);

      if (!fillResult?.ok || !fillResult?.buttonFound || !fillResult?.btnCoords) {
        console.warn('[Google Flow Browser] ❌ Không thể tìm thấy nút Tạo ảnh:', fillResult?.error || 'gen_btn_not_found');
        return null;
      }

      // Gửi click chuột thật qua webContents.sendInputEvent tại đúng toạ độ btnCoords
      if (!win.isDestroyed()) {
        try {
          console.log('[Google Flow Browser] 🖱️ Gửi click chuột thật tới nút Tạo ảnh:', fillResult.btnCoords);
          win.webContents.sendInputEvent({
            type: 'mouseDown',
            x: fillResult.btnCoords.x,
            y: fillResult.btnCoords.y,
            button: 'left',
            clickCount: 1,
          });
          await new Promise((r) => setTimeout(r, 50));
          win.webContents.sendInputEvent({
            type: 'mouseUp',
            x: fillResult.btnCoords.x,
            y: fillResult.btnCoords.y,
            button: 'left',
            clickCount: 1,
          });
        } catch (clickErr: any) {
          console.warn('[Google Flow Browser] Native mouse click warning:', clickErr?.message);
        }
      }

      // Đánh dấu chính xác thời điểm bấm nút Generate của lượt hiện tại
      generateClickedAt = Date.now();

      // Đợi 300ms và tự động xác nhận quyền của Tác nhân nếu có
      await new Promise((r) => setTimeout(r, 300));
      const agentCheckInit = await this.autoConfirmAgentPermission(win);
      if (agentCheckInit.startsWith('agent_error:')) {
        console.error('[Google Flow Browser] 🛑 Dừng tác vụ vì Tác nhân Google Flow báo lỗi:', agentCheckInit);
        return { error: 'agent_error', errorDetail: agentCheckInit };
      }

      if (isCancelled?.()) return null;

      // Xác nhận phản hồi ban đầu của Flow (Image)
      const checkImageStartedJs = `
        (function() {
          const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container');
          const promptEl = promptBox ? promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea') : null;
          const currentText = promptEl ? (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim() : '';

          const hasSpinner = Boolean(document.querySelector(
            'flow-loading-indicator, flow-progress-bar, mat-progress-spinner, mat-spinner, .generation-in-progress, [role="progressbar"], flow-card[state="generating"], .loading-spinner'
          ));

          const btnDisabled = Boolean(document.querySelector(
            'flow-generate-icon-button button[disabled], button.generate-icon-button[disabled], button[aria-disabled="true"]'
          ));

          return JSON.stringify({
            isCleared: currentText.length === 0,
            hasSpinner,
            btnDisabled,
            textLen: currentText.length
          });
        })()
      `;

      let startedStatus: any = null;
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 200));
        startedStatus = await this.safeExecuteJs<any>(win, checkImageStartedJs, 1500);
        if (startedStatus?.isCleared || startedStatus?.hasSpinner) break;
      }
      console.log('[Google Flow Browser] Xác nhận phản hồi ban đầu của Flow (Image):', startedStatus);

      if (startedStatus && !startedStatus.isCleared && !startedStatus.hasSpinner && !startedStatus.btnDisabled && !win.isDestroyed()) {
        console.log('[Google Flow Browser] ⚠️ Flow chưa nhận lệnh ảnh (text còn nguyên, chưa loading), kích hoạt bổ trợ Enter native...');
        try {
          await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
          await new Promise((r) => setTimeout(r, 60));
          await win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        } catch {}
        await new Promise((r) => setTimeout(r, 1500));
      }

      if (isCancelled?.()) return null;

      // Bước 4: Polling chờ ảnh (tối đa 90s, mỗi 2s)
      onProgress?.(35, 'Đang chờ Google Flow tạo ảnh...');

      const pollDomImageJs = `
        (async function() {
          const baselineList = ${JSON.stringify(baselineUrlsList)};
          const baselineSet = new Set(baselineList);
          try {
            const imgs = Array.from(document.querySelectorAll(
              'flow-media-card img, flow-image-card img, .media-card img, .project-canvas img, flow-canvas img, [role="img"] img'
            ));
            for (const img of imgs) {
              // Bỏ qua ảnh thuộc card đã tồn tại từ trước khi submit
              if (img.closest('[data-flow-existing="true"]')) continue;

              const src = img.currentSrc || img.src;
              if (!src || src.includes('gstatic.com') || src.includes('/banners/') || src.includes('favicon') || src.includes('avatar') || src.includes('/icons/')) continue;
              // Bỏ qua nếu src đã nằm trong snapshot baseline
              if (baselineSet.has(src)) continue;

              if (src.startsWith('http') && (src.includes('googleusercontent.com') || src.includes('flow-content.google') || src.includes('blob:'))) {
                return JSON.stringify({ type: 'http', imageUrl: src });
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
                    return JSON.stringify({ type: 'blob', base64Data: b64 });
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
        if (win.isDestroyed()) break;
        if (isCancelled?.()) {
          console.log('[Google Flow Browser] Tác vụ đã bị người dùng hủy bỏ.');
          return null;
        }

        // Tự động kiểm tra quyền hoặc phát hiện lỗi Tác nhân
        const agentStatus = await this.autoConfirmAgentPermission(win);
        if (agentStatus.startsWith('agent_error:')) {
          console.error('[Google Flow Browser] 🛑 Dừng tác vụ vì Tác nhân Google Flow báo lỗi:', agentStatus);
          return { error: 'agent_error', errorDetail: agentStatus };
        }

        const elapsedSinceClick = Date.now() - generateClickedAt;
        const minImageTimeGate = 5000; // Tối thiểu 5s mới chấp nhận ảnh thật

        const domResult = await this.safeExecuteJs<any>(win, pollDomImageJs, 3000);
        const foundUrl = (elapsedSinceClick >= minImageTimeGate && capturedImageUrl) ||
          (elapsedSinceClick >= minImageTimeGate && domResult?.type === 'http' ? domResult.imageUrl : null);

        if (foundUrl) {
          onProgress?.(90, 'Đã nhận được ảnh từ Google Flow, đang trích xuất dữ liệu ảnh...');
          console.log('[Google Flow Browser] ✅ Bắt được ảnh thành công (sau ' + Math.round(elapsedSinceClick / 1000) + 's):', foundUrl);

          let base64Data: string | undefined;
          try {
            const toBase64Js = `
              (async function() {
                try {
                  const resp = await fetch(${JSON.stringify(foundUrl)});
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
            base64Data = (await this.safeExecuteJs<string>(win, toBase64Js, 10000)) || undefined;
          } catch {}

          let projectId: string | undefined;
          try {
            const currentUrl = win.webContents?.getURL?.() || '';
            const match = currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
            if (match && match[1]) projectId = match[1];
          } catch {}

          return { imageUrl: foundUrl, base64Data, projectId };
        }

        if (domResult?.type === 'blob' && domResult?.base64Data && elapsedSinceClick >= minImageTimeGate) {
          onProgress?.(90, 'Đã trích xuất ảnh Blob từ Google Flow!');
          let projectId: string | undefined;
          try {
            const currentUrl = win.webContents?.getURL?.() || '';
            const match = currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
            if (match && match[1]) projectId = match[1];
          } catch {}
          return { base64Data: domResult.base64Data, projectId };
        }

        await new Promise((r) => setTimeout(r, pollIntervalMs));
        const elapsed = (attempt + 1) * (pollIntervalMs / 1000);
        const pct = Math.min(85, Math.round(35 + (elapsed / maxWaitSeconds) * 50));
        onProgress?.(pct, `Google Flow đang xử lý ảnh (${Math.round(elapsed)}s / ${maxWaitSeconds}s)...`);
      }

      console.warn('[Google Flow Browser] Quá thời gian chờ ảnh từ Google Flow.');

      const outOfCreditsJs = `
        (function() {
          const text = (document.body.innerText || '').toLowerCase();
          return (
            text.includes('hết tín dụng') ||
            text.includes('không đủ tín dụng') ||
            text.includes('insufficient credit') ||
            text.includes('out of credits') ||
            text.includes('you have run out')
          );
        })()
      `;
      const outOfCredits = await this.safeExecuteJs<boolean>(win, outOfCreditsJs, 2000);
      if (outOfCredits) {
        console.warn('[Google Flow Browser] Tài khoản đã hết credit Google Flow.');
        SettingsStore.set('veoSessionStatus', 'out_of_credits');
        SettingsStore.set('veoFlowCredits', 0);
        SettingsStore.set('veoFlowCreditsCheckedAt', Date.now());
        return { error: 'out_of_credits' };
      }

      return null;
    } finally {
      try {
        ses.webRequest.onResponseStarted(netFilter, null as any);
      } catch {}
    }
  }

  /**
   * Tự động kiểm tra và nhấn nút xác nhận tạo nội dung của Tác nhân (Creative Agent Permission).
   * Giúp workflow tự động chạy tiếp mà không cần người dùng phải bấm tay vào tab tác nhân.
   * Đồng thời phát hiện sớm nếu Tác nhân báo lỗi ("Tác nhân đã gặp lỗi. Hãy thử lại.") để dừng ngay, không bị treo.
   */
  private async autoConfirmAgentPermission(win: any): Promise<string> {
    if (!win || win.isDestroyed()) return 'none';

    // Cooldown 4 giây giữa các lần click xác nhận thành công
    const now = Date.now();
    const isCoolingDown = now - this.lastPermissionConfirmedAt < 4000;

    const autoConfirmJs = `
      (async function(skipAction) {
        function isVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (el.offsetParent === null && style.position !== 'fixed') return false;
          return true;
        }

        // 0. Kiểm tra thông báo lỗi của Creative Agent / Tác nhân gặp lỗi (ưu tiên số 1)
        const bodyText = (document.body.innerText || '').toLowerCase();
        if (
          bodyText.includes('tác nhân đã gặp lỗi') ||
          bodyText.includes('tác nhân đã gặp sự cố') ||
          bodyText.includes('agent encountered an error') ||
          bodyText.includes('creative agent encountered an error') ||
          bodyText.includes('failed to generate')
        ) {
          return JSON.stringify({ status: 'agent_error: Tác nhân đã gặp lỗi. Hãy thử lại.' });
        }

        if (skipAction) return JSON.stringify({ status: 'none' });

        // 1. Kiểm tra permission message của Creative Agent
        const allRadios = Array.from(document.querySelectorAll(
          'flow-permission-message [role="radio"], flow-permission-message .option-row, flow-permission-message mat-radio-button, [role="radiogroup"] [role="radio"]'
        ));

        function isChecked(r) {
          if (!r) return false;
          if (r.getAttribute('aria-checked') === 'true') return true;
          if (r.checked) return true;
          if (r.classList.contains('mat-radio-checked') || r.classList.contains('selected')) return true;
          if (r.querySelector('[aria-checked="true"], .mat-radio-checked, input:checked')) return true;
          return false;
        }

        // Lọc các radio đang hiển thị và KHÔNG ở trạng thái read-only / disabled
        // Loại bỏ triệt để các tùy chọn về upload / tải ảnh từ thiết bị
        const permRadios = allRadios.filter(r => {
          if (!isVisible(r)) return false;
          if (r.classList.contains('read-only') || r.getAttribute('aria-disabled') === 'true') return false;
          const label = (r.getAttribute('aria-label') || r.innerText || r.textContent || '').toLowerCase();
          if (label.includes('tải') || label.includes('upload') || label.includes('thiết bị') || label.includes('device') || label.includes('tập tin') || label.includes('file')) return false;
          return true;
        });

        // Nếu đã có radio hợp lệ được chọn, không click lại để tránh lặp vô tận, nhường cho bước 2 bấm nút xác nhận
        const alreadyChecked = permRadios.find(isChecked);
        let targetRadio = null;

        if (!alreadyChecked && permRadios.length > 0) {
          // Ưu tiên chọn option "Luôn luôn phê duyệt" / "Luôn cho phép" nếu có
          const alwaysRadio = permRadios.find(r => {
            const label = (r.getAttribute('aria-label') || r.innerText || r.textContent || '').toLowerCase();
            return label.includes('luôn') || label.includes('always');
          });
          targetRadio = alwaysRadio || (permRadios.length > 1 ? permRadios[1] : permRadios[0]);
        }

        if (targetRadio) {
          // Bắt buộc cuộn radio vào chính giữa màn hình trước khi click để tọa độ luôn nằm trong viewport
          targetRadio.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
          await new Promise(r => setTimeout(r, 60));

          const rect = targetRadio.getBoundingClientRect();
          const coords = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };

          // Kích hoạt đầy đủ chuỗi sự kiện chuột trong DOM
          try {
            targetRadio.focus();
            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtType => {
              targetRadio.dispatchEvent(new MouseEvent(evtType, { bubbles: true, cancelable: true, view: window }));
            });
            targetRadio.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            targetRadio.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (e) {}

          return JSON.stringify({
            status: 'clicked_permission_radio',
            coords,
            label: targetRadio.getAttribute('aria-label') || targetRadio.innerText
          });
        }

        // 2. Kiểm tra các nút bấm xác nhận hành động trong flow-permission-message, dialog
        const buttons = Array.from(document.querySelectorAll(
          'flow-permission-message button, flow-confirmation-dialog button, mat-dialog-container button, .agree-actions-group button, flow-agent-panel button, button[aria-label*="Confirm" i], button[aria-label*="Phê duyệt" i]'
        )).filter(isVisible);

        const actionBtn = buttons.find(b => {
          if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
          // Loại bỏ các suggestion chips / quick replies
          if (b.classList.contains('suggestion-chip') || b.classList.contains('suggestion-card') || b.classList.contains('flow-chip') || b.closest('flow-suggestion-list, .suggestions, .chips-container')) {
            return false;
          }
          const txt = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
          const isNegative = txt.includes('hủy') || txt.includes('cancel') || txt.includes('không') || txt.includes('close') || txt.includes('từ chối') || txt.includes('đóng');
          if (isNegative) return false;

          const isPermContainer = b.closest('flow-permission-message, flow-confirmation-dialog, .agree-actions-group, mat-dialog-container');
          if (isPermContainer) {
            return (
              txt.includes('xác nhận') ||
              txt.includes('cho phép') ||
              txt.includes('phê duyệt') ||
              txt.includes('đồng ý') ||
              txt.includes('tạo') ||
              txt.includes('generate') ||
              txt.includes('confirm') ||
              txt.includes('allow') ||
              txt.includes('agree') ||
              txt.includes('proceed')
            );
          }

          return (
            txt.includes('xác nhận') ||
            txt.includes('cho phép') ||
            txt.includes('phê duyệt') ||
            txt.includes('đồng ý') ||
            txt.includes('confirm') ||
            txt.includes('proceed')
          );
        });

        if (actionBtn) {
          actionBtn.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
          await new Promise(r => setTimeout(r, 60));
          const rect = actionBtn.getBoundingClientRect();
          const coords = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };

          try {
            actionBtn.focus();
            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtType => {
              actionBtn.dispatchEvent(new MouseEvent(evtType, { bubbles: true, cancelable: true, view: window }));
            });
          } catch (e) {}

          return JSON.stringify({
            status: 'clicked_action_button',
            coords,
            label: (actionBtn.innerText || actionBtn.getAttribute('aria-label') || '').trim()
          });
        }

        return JSON.stringify({ status: 'none' });
      })(${isCoolingDown})
    `;

    try {
      const rawRes = await this.safeExecuteJs<string>(win, autoConfirmJs, 2500);
      const res = rawRes ? (typeof rawRes === 'object' ? rawRes : JSON.parse(rawRes)) : null;

      if (res && res.status !== 'none') {
        if (res.status.startsWith('agent_error:')) {
          console.error('[Google Flow Browser] ❌ Phát hiện sự cố Tác nhân Google Flow:', res.status);
          return res.status;
        }

        // Gửi click chuột thật cấp OS tới toạ độ của phần tử (bảo đảm click 100% trúng đích)
        if (res.coords && res.coords.x > 0 && res.coords.y > 0 && !win.isDestroyed()) {
          try {
            if (win.isMinimized()) win.restore();
            win.focus();
            if (!this.isLobbyDebugVisible) {
              win.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
            }
            win.webContents.sendInputEvent({
              type: 'mouseDown',
              x: res.coords.x,
              y: res.coords.y,
              button: 'left',
              clickCount: 1,
            });
            await new Promise((r) => setTimeout(r, 50));
            win.webContents.sendInputEvent({
              type: 'mouseUp',
              x: res.coords.x,
              y: res.coords.y,
              button: 'left',
              clickCount: 1,
            });
            await new Promise((r) => setTimeout(r, 150));
          } catch {}
        }

        this.lastPermissionConfirmedAt = Date.now();
        console.log(`[Google Flow Browser] 👉 Đã tự động nhấn nút xác nhận tạo nội dung của Tác nhân (${res.label || res.status}) tại (${res.coords?.x}, ${res.coords?.y})`);
        return res.status;
      }
    } catch {}
    return 'none';
  }

  /**
   * Dọn sạch canvas và chuẩn bị ô soạn thảo prompt về trạng thái sẵn sàng trước mỗi lượt generate.
   * Bắt buộc chạy trước mỗi lượt sinh (đặc biệt quan trọng khi 2 node chạy nối tiếp qua Mutex).
   * 1. Kiểm tra bằng JS xem có đang tồn tại preview/overlay của kết quả vừa sinh hay không.
   * 2. Nếu phát hiện, gửi phím Escape và đợi overlay đóng lại.
   * 3. Xác nhận lại rằng ô prompt (ProseMirror/contenteditable) đang thực sự trống, có nút Generate và có thể focus được.
   * 4. Nếu sau bước dọn dẹp vẫn không sẵn sàng, thử tạo New Project sạch sẽ làm dự phòng (tuyệt đối không click flow-project-card).
   */
  private async ensureCleanCanvasReady(
    win: any,
    mode: 'image' | 'video',
    onProgress?: (percent: number, msg: string) => void,
    isCancelled?: () => boolean
  ): Promise<boolean> {
    if (!win || win.isDestroyed()) return false;

    // 1. Kiểm tra bằng JS xem có đang tồn tại preview / overlay của kết quả vừa sinh không
    const checkOverlayJs = `
      (function() {
        function isVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        }

        const overlaySelectors = [
          'flow-media-viewer', '.media-viewer-container', '.lightbox-overlay', 'flow-lightbox',
          '[role="dialog"]', '.cdk-overlay-pane:not(:empty)', 'mat-dialog-container',
          '.modal-backdrop', 'flow-full-screen-preview', '.media-preview-expanded'
        ];

        for (const sel of overlaySelectors) {
          const els = Array.from(document.querySelectorAll(sel));
          if (els.some(isVisible)) return true;
        }
        return false;
      })()
    `;

    const hasOverlay = await this.safeExecuteJs<boolean>(win, checkOverlayJs, 2000);
    if (hasOverlay) {
      console.log('[Google Flow Browser] 🧹 Phát hiện overlay/media-viewer mở, gửi Escape để đóng lại...');
      try {
        await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        await new Promise((r) => setTimeout(r, 50));
        await win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      } catch {}
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const stillOverlay = await this.safeExecuteJs<boolean>(win, checkOverlayJs, 500);
        if (!stillOverlay) break;
      }
    }

    if (isCancelled?.()) return false;

    // 2. Xác nhận và làm sạch ô soạn thảo prompt (ProseMirror / contenteditable)
    const cleanAndCheckPromptJs = `
      (async function() {
        function isVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        }

        const inProject = window.location.href.includes('/project/');
        if (!inProject) return { ready: false, hasPrompt: false, reason: 'not_in_project' };

        const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box');
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
          const el = promptBox ? promptBox.querySelector(sel) : document.querySelector(sel);
          if (el && isVisible(el)) {
            promptEl = el;
            break;
          }
        }

        if (!promptEl) return { ready: false, hasPrompt: false, reason: 'no_prompt_el' };

        // Xóa sạch nội dung cũ nếu còn sót lại từ lượt trước bằng range delete + input event
        let currentText = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();
        if (currentText.length > 0) {
          try {
            promptEl.focus();
            if (promptEl.isContentEditable) {
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(promptEl);
              sel.removeAllRanges();
              sel.addRange(range);
              document.execCommand('delete', false, null);
              promptEl.dispatchEvent(new Event('input', { bubbles: true }));
              promptEl.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (promptEl.value !== undefined) {
              promptEl.value = '';
              promptEl.dispatchEvent(new Event('input', { bubbles: true }));
              promptEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } catch (e) {}
        }

        // Chờ canvas ổn định: hết animation loop glow, hết spinner và nút Generate đã hiển thị trong DOM
        for (let i = 0; i < 15; i++) {
          const isBusy = Boolean(document.querySelector('flow-border-glow.loop, .generation-in-progress, flow-card[state="generating"], mat-progress-spinner'));
          const genBtn = document.querySelector('flow-generate-icon-button button, button.generate-icon-button, button[type="submit"], [aria-label*="Bắt đầu tạo" i]');
          const hasBtn = Boolean(genBtn && isVisible(genBtn));
          if (!isBusy && hasBtn) break;
          await new Promise(r => setTimeout(r, 150));
        }

        promptEl.focus();
        currentText = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();

        const rect = promptEl.getBoundingClientRect();
        const canFocus = rect && rect.width > 0 && rect.height > 0;
        const genBtn = document.querySelector('flow-generate-icon-button button, button.generate-icon-button, button[type="submit"], [aria-label*="Bắt đầu tạo" i]');
        const hasGenBtn = Boolean(genBtn && isVisible(genBtn));

        return {
          ready: canFocus && currentText.length === 0 && hasGenBtn,
          hasPrompt: true,
          hasGenBtn,
          coords: canFocus ? { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) } : null,
          textLen: currentText.length
        };
      })()
    `;

    let cleanResult = await this.safeExecuteJs<any>(win, cleanAndCheckPromptJs, 4000);
    // Nếu kết quả bị null do timeout nhỏ, retry lại 1 lần
    if (!cleanResult) {
      await new Promise((r) => setTimeout(r, 500));
      cleanResult = await this.safeExecuteJs<any>(win, cleanAndCheckPromptJs, 3000);
    }
    console.log('[Google Flow Browser] Trạng thái dọn dẹp canvas:', cleanResult);

    // Nếu ô prompt đã sẵn sàng và trống, click chuột thật vào ô prompt để bảo đảm tiêu điểm OS
    if (cleanResult?.ready && cleanResult?.coords && !win.isDestroyed()) {
      try {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        if (!this.isLobbyDebugVisible) {
          win.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
        }
        win.webContents.sendInputEvent({
          type: 'mouseDown',
          x: cleanResult.coords.x,
          y: cleanResult.coords.y,
          button: 'left',
          clickCount: 1
        });
        await new Promise((r) => setTimeout(r, 40));
        win.webContents.sendInputEvent({
          type: 'mouseUp',
          x: cleanResult.coords.x,
          y: cleanResult.coords.y,
          button: 'left',
          clickCount: 1
        });
        await new Promise((r) => setTimeout(r, 150));
      } catch {}
      return true;
    }

    // 3. Phương án dự phòng: Nếu sau khi dọn dẹp ô prompt vẫn không sẵn sàng,
    // thử click vào nút "Bắt đầu phiên mới" (New session) nếu đang trong project, hoặc tạo New Project mới sạch sẽ
    console.warn('[Google Flow Browser] ⚠️ Ô prompt chưa sẵn sàng sau khi dọn dẹp, kích hoạt phương án dự phòng (reset canvas/mở dự án mới)...');
    onProgress?.(15, 'Đang đặt lại canvas và chuẩn bị dự án mới...');

    const clickNewSessionJs = `
      (function() {
        function isElementVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        }

        if (window.location.href.includes('/project/')) {
          const newSessionBtn = document.querySelector('button[aria-label*="Bắt đầu phiên mới" i], button[aria-label*="New session" i]');
          if (newSessionBtn && isElementVisible(newSessionBtn)) {
            newSessionBtn.click();
            return 'clicked_new_session_btn';
          }
        }
        return 'no_btn_found';
      })()
    `;

    const sessionRes = await this.safeExecuteJs<string>(win, clickNewSessionJs, 2500);
    console.log('[Google Flow Browser] Kết quả click New Session dự phòng:', sessionRes);

    if (sessionRes === 'clicked_new_session_btn') {
      await new Promise((r) => setTimeout(r, 2000));
      const recheck = await this.safeExecuteJs<any>(win, cleanAndCheckPromptJs, 3000);
      if (recheck?.ready) {
        console.log('[Google Flow Browser] Canvas đã sẵn sàng sau khi reset session mới.');
        return true;
      }
    }

    // Nếu vẫn chưa được hoặc không có nút New Session: Tạo hẳn một dự án mới hoàn toàn
    console.log('[Google Flow Browser] Đang tạo dự án mới sạch sẽ làm phương án dự phòng...');
    const newProjOk = await this.createNewProject(win, onProgress, isCancelled);
    if (!newProjOk) return false;

    // Kiểm tra lại lần cuối sau khi tạo new project
    const finalCheck = await this.safeExecuteJs<any>(win, cleanAndCheckPromptJs, 3000);
    return Boolean(finalCheck?.ready);
  }

  /** Kéo lobby window về vị trí bình thường trên màn hình chính để debug bằng mắt */
  public showLobbyForDebug(): boolean {
    this.isLobbyDebugVisible = true;
    if (!this.lobbyWindow || this.lobbyWindow.isDestroyed()) {
      this.openLobbyWindow()
        .then(() => {
          if (this.lobbyWindow && !this.lobbyWindow.isDestroyed()) {
            this.lobbyWindow.setPosition(100, 100);
            this.lobbyWindow.show();
            this.lobbyWindow.focus();
          }
        })
        .catch(() => {});
      return true;
    }
    this.lobbyWindow.setPosition(100, 100);
    this.lobbyWindow.show();
    this.lobbyWindow.focus();
    return true;
  }

  /** Đưa lobby window trở lại vị trí ẩn ngoài màn hình sau khi debug xong */
  public hideLobbyOffscreen(): boolean {
    this.isLobbyDebugVisible = false;
    if (!this.lobbyWindow || this.lobbyWindow.isDestroyed()) return false;
    this.lobbyWindow.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
    return true;
  }

  /** Kiểm tra trạng thái hiển thị debug của lobby window */
  public isLobbyDebug(): boolean {
    return this.isLobbyDebugVisible && Boolean(this.lobbyWindow && !this.lobbyWindow.isDestroyed());
  }

  /** Lấy tham chiếu tới lobby window hiện tại */
  public getLobbyWindow(): any {
    return this.lobbyWindow;
  }
}


