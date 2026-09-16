import path from 'path';
import https from 'https';
import { SettingsStore } from '../store/settingsStore';
import { GoogleVeoAntiSpamGuard } from './GoogleVeoAntiSpamGuard';
import { GoogleFlowBrowserMutex } from '../workflow/dispatcher/GoogleFlowBrowserMutex';
import {
  FlowStateMachine,
  FlowImageGenerationStatePipeline,
  FlowElementFinder,
  FlowSmartWait,
  FlowClipboardGuard,
  type FlowStateContext,
} from '../workflow/flow-engine';
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
  private currentProjectId: string | null = null;
  private lastPermissionConfirmedAt = 0;

  private constructor() {}

  public getCurrentProjectId(): string | null {
    return this.currentProjectId;
  }

  public setCurrentProjectId(id: string | null): void {
    this.currentProjectId = id;
  }

  static getInstance(): GoogleVeoSessionManager {
    if (!this.instance) {
      this.instance = new GoogleVeoSessionManager();
    }
    return this.instance;
  }

  /**
   * Khôi phục cookie từ SettingsStore vào partition Electron nếu partition đang thiếu auth cookie
   */
  public async restoreCookiesToPartition(ses?: any): Promise<number> {
    try {
      let targetSes = ses;
      if (!targetSes) {
        const electron = require('electron');
        targetSes = electron?.session?.fromPartition('persist:google_veo');
      }
      if (!targetSes) return 0;

      const storedCookie = SettingsStore.get('veoSessionCookie')?.trim();
      if (!storedCookie) return 0;

      // Kiểm tra xem partition đã có đầy đủ auth cookies chưa
      const existing = await targetSes.cookies.get({ domain: '.google.com' });
      const hasAuth = existing.some((c: any) => GOOGLE_AUTH_COOKIE_NAMES.includes(c.name));
      if (hasAuth) {
        return existing.length;
      }

      console.log('[GoogleVeoSessionManager] 🔄 Đang nạp lại cookie từ SettingsStore vào phân vùng persist:google_veo...');
      const parts = storedCookie.split(';').map((p) => p.trim()).filter(Boolean);
      let count = 0;

      for (const part of parts) {
        const eqIdx = part.indexOf('=');
        if (eqIdx <= 0) continue;
        const name = part.slice(0, eqIdx).trim();
        const value = part.slice(eqIdx + 1).trim();
        if (!name || !value) continue;

        const isHost = name.startsWith('__Host-');
        const isSecure = true; // Google cookies chạy qua HTTPS, bắt buộc cho SameSite=no_restriction
        const isHttpOnly = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID'].includes(name) || name.includes('SID');

        // Nạp cho .google.com
        try {
          const cookieDetail: any = {
            url: 'https://google.com',
            name,
            value,
            path: '/',
            secure: isSecure,
            httpOnly: isHttpOnly,
            sameSite: 'no_restriction',
          };
          if (!isHost) {
            cookieDetail.domain = '.google.com';
          }
          await targetSes.cookies.set(cookieDetail);
          count++;
        } catch {}

        // Nạp riêng cho flow.google.com
        try {
          const flowCookieDetail: any = {
            url: 'https://flow.google.com',
            name,
            value,
            path: '/',
            secure: isSecure,
            httpOnly: isHttpOnly,
            sameSite: 'no_restriction',
          };
          if (!isHost) {
            flowCookieDetail.domain = '.google.com';
          }
          await targetSes.cookies.set(flowCookieDetail);
        } catch {}
      }

      if (typeof targetSes.cookies.flushStore === 'function') {
        await targetSes.cookies.flushStore();
      }

      console.log(`[GoogleVeoSessionManager] ✅ Đã nạp thành công ${count} cookies vào phân vùng Electron.`);
      return count;
    } catch (e) {
      console.warn('[GoogleVeoSessionManager] Lỗi khi nạp cookie vào partition:', e);
      return 0;
    }
  }

  /**
   * Khởi động và tự động đồng bộ cookie hai chiều giữa SettingsStore và phân vùng Electron
   */
  async init(): Promise<void> {
    try {
      const electron = require('electron');
      const session = electron?.session;
      if (session?.fromPartition) {
        const ses = session.fromPartition('persist:google_veo');
        // 1. Phục hồi cookie từ SettingsStore nếu phân vùng Electron đang trống
        await this.restoreCookiesToPartition(ses);

        // 2. Đồng bộ cookie mới nhất từ phân vùng
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
        backgroundThrottling: false,
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

    // Đảm bảo nạp đầy đủ cookie xác thực từ SettingsStore vào partition trước khi mở trang Flow
    await this.restoreCookiesToPartition(ses);

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
  public async safeExecuteJs<T = any>(win: any, js: string, timeoutMs = 6000): Promise<T | null> {
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
  public async ensureLobbyAtFlow(): Promise<boolean> {
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

    // Nếu chưa ở flow.google.com → chuyển đến flow.google.com trước
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

    const finalUrl = (win.webContents.getURL() || '').toLowerCase();

    // Nếu sau khi mở flow.google.com mà bị chuyển hướng sang trang đăng nhập Google
    if (finalUrl.includes('accounts.google.com') || finalUrl.includes('servicelogin')) {
      console.warn('[Google Flow Browser] Cần đăng nhập tài khoản Google trên Sảnh Flow trước.');
      return false;
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

    // 2. Ngược lại, truy cập lobbyWindow để đọc credit mới:
    // BẮT BUỘC tuần tự hóa qua GoogleFlowBrowserMutex để không can thiệp workflow đang chạy
    return await GoogleFlowBrowserMutex.getInstance().runExclusive(async () => {
      // Kiểm tra lại cache lần 2 (double-checked locking) phòng trường hợp tác vụ trước vừa cập nhật
      const freshCached = SettingsStore.get('veoFlowCredits');
      const freshCheckedAt = Number(SettingsStore.get('veoFlowCreditsCheckedAt')) || 0;
      if (freshCached !== null && typeof freshCached === 'number' && Date.now() - freshCheckedAt < maxAgeMs) {
        return freshCached;
      }

      const ready = await this.ensureLobbyAtFlow();
      if (!ready || !this.lobbyWindow || this.lobbyWindow.isDestroyed()) {
        return freshCached ?? null;
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

      return freshCached ?? null;
    }, 'credit_access');
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

    // Tìm và nhấn nút New Project qua FlowElementFinder (Tuyệt đối không click flow-project-card)
    let clickSucceeded = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      if (isCancelled?.()) return false;

      const finderRes = await FlowElementFinder.find(targetWin, FlowElementFinder.getNewProjectButtonSpec());
      if (finderRes.found && finderRes.selectedCandidate) {
        const cand = finderRes.selectedCandidate;
        const clickX = Math.round(cand.rect.x + cand.rect.width / 2);
        const clickY = Math.round(cand.rect.y + cand.rect.height / 2);
        console.log(
          `[Google Flow Browser] ✅ Đã tìm thấy nút New Project qua FlowElementFinder (Strategy: ${cand.strategy}, Confidence: ${cand.confidence}/100, Coords: (${clickX}, ${clickY}), lần thử ${attempt + 1})`
        );

        if (!targetWin.isDestroyed()) {
          try {
            targetWin.focus?.();
            targetWin.webContents.sendInputEvent({
              type: 'mouseMove',
              x: clickX,
              y: clickY,
            });
            await new Promise((r) => setTimeout(r, 40));
            targetWin.webContents.sendInputEvent({
              type: 'mouseDown',
              x: clickX,
              y: clickY,
              button: 'left',
              clickCount: 1,
            });
            await new Promise((r) => setTimeout(r, 50));
            targetWin.webContents.sendInputEvent({
              type: 'mouseUp',
              x: clickX,
              y: clickY,
              button: 'left',
              clickCount: 1,
            });

            // Fallback kích hoạt DOM click trên đúng candidate của FlowElementFinder để Angular Material nhận diện
            const selStr = JSON.stringify(cand.selector || 'button.new-project-button');
            await this.safeExecuteJs(
              targetWin,
              `(function() {
                try {
                  const el = document.querySelector(${selStr}) || document.querySelector('button.new-project-button, button[aria-label*="Tạo dự án" i]');
                  if (el) { el.click(); }
                } catch {}
              })()`,
              2000
            );

            clickSucceeded = true;
            break;
          } catch (e: any) {
            console.warn('[Google Flow Browser] Lỗi khi gửi sendInputEvent cho nút New Project:', e?.message || e);
          }
        }
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
        const pageUrl = (await this.safeExecuteJs<string>(targetWin, 'window.location.href', 1500)) || targetWin.webContents?.getURL?.() || '';
        const match = pageUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          this.currentProjectId = match[1];
          console.log(`[Google Flow Browser] 📌 Đã lưu currentProjectId mới: ${this.currentProjectId}`);
        }
        console.log(`[Google Flow Browser] ✅ Dự án mới đã sẵn sàng sau ${i + 1}s:`, pageUrl);
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
   * - Nếu targetProjectId KHÔNG được truyền vào: Kiểm tra nếu cửa sổ đang ở trong một project hoặc có currentProjectId hợp lệ, tái sử dụng project đó.
   * - Chỉ tạo project mới khi hoàn toàn chưa có dự án nào đang mở.
   */
  public async ensureProjectContext(
    win: any,
    targetProjectId?: string,
    onProgress?: (pct: number, msg: string) => void,
    isCancelled?: () => boolean
  ): Promise<boolean> {
    if (!win || win.isDestroyed()) return false;

    const href = (await this.safeExecuteJs<string>(win, 'window.location.href', 2000)) || '';
    const currentUrl = href || win.webContents?.getURL?.() || '';

    // Quyết định projectId hiệu lực:
    // 1. Ưu tiên targetProjectId nếu được truyền cụ thể
    // 2. Nếu không có targetProjectId nhưng lobbyWindow đang ở trong một project hợp lệ hoặc có currentProjectId:
    //    tái sử dụng project đó thay vì thoát ra tạo mới!
    const activeId = targetProjectId || this.currentProjectId || (currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/)?.[1]);

    if (activeId) {
      this.currentProjectId = activeId;
      if (currentUrl.includes(`/project/${activeId}`)) {
        console.log(`[Google Flow Browser] Đã ở đúng project được chỉ định: ${activeId}`);
        return true;
      }
      onProgress?.(15, `Đang mở dự án ${activeId}...`);
      try {
        await win.loadURL(`https://flow.google.com/project/${activeId}`);
        for (let i = 0; i < 20; i++) {
          if (isCancelled?.()) return false;
          await new Promise((r) => setTimeout(r, 1000));
          const ready = await this.safeExecuteJs<boolean>(
            win,
            `Boolean(document.querySelector('.ProseMirror, [contenteditable="true"], .prompt-input'))`,
            2000
          );
          if (ready) {
            console.log(`[Google Flow Browser] Đã tải xong project ${activeId} sau ${i + 1}s.`);
            return true;
          }
        }
      } catch {}
      return false;
    }

    // Trường hợp hoàn toàn chưa có project context nào -> Bắt buộc tạo project mới
    return await this.createNewProject(win, onProgress, isCancelled);
  }

  /**
   * Đồng bộ và thiết lập các thông số (Aspect Ratio, Output Count, Duration, Model)
   * trực tiếp vào Google Flow DOM (Prompt Box Settings Overlay, Settings Panel và LocalStorage).
   * Đảm bảo tính nhất quán 1:1 giữa cấu hình Node trong Workflow và kết quả sinh thực tế trên Google Flow.
   */
  public async configureGoogleFlowSettings(
    win: any,
    mode: 'image' | 'video',
    options: {
      outputCount?: number;
      aspectRatio?: string;
      durationSeconds?: number;
      modelVariant?: string;
      imageEngine?: string;
    }
  ): Promise<void> {
    if (!win || win.isDestroyed()) return;

    const count = Math.max(1, Math.min(4, Math.round(Number(options.outputCount || 1))));
    const aspect = (options.aspectRatio || '16:9').trim();

    // Chuẩn hóa thời lượng video theo 4 mức chuẩn của Google Flow Veo: 4, 6, 8, 10
    let duration = 4;
    if (mode === 'video') {
      const rawDur = Number(options.durationSeconds || 4);
      if (rawDur <= 5) duration = 4;
      else if (rawDur <= 7) duration = 6;
      else if (rawDur <= 9) duration = 8;
      else duration = 10;
    }

    console.log(`[Google Flow Browser] ⚙️ Đang áp dụng cấu hình Google Flow cho ${mode}: count=${count}, aspect=${aspect}${mode === 'video' ? `, duration=${duration}s` : ''}...`);

    // 1. Đồng bộ LocalStorage flow-prompt-box-settings làm lớp nền Idempotent redundancy
    try {
      await win.webContents.executeJavaScript(`
        (function() {
          try {
            const raw = localStorage.getItem('flow-prompt-box-settings');
            const settings = raw ? JSON.parse(raw) : {};
            settings.mode = ${JSON.stringify(mode.toUpperCase())};
            settings.Qp = ${count};
            const targetAspect = ${JSON.stringify(aspect)};
            if (${JSON.stringify(mode)} === 'video') {
              settings.AB = ${duration};
              settings.aspectRatio = targetAspect === '9:16' ? 'PORTRAIT' : 'LANDSCAPE';
            } else {
              if (targetAspect === '9:16') settings.aspectRatio = 'PORTRAIT';
              else if (targetAspect === '1:1') settings.aspectRatio = 'SQUARE';
              else if (targetAspect === '4:3') settings.aspectRatio = 'FOUR_THREE';
              else if (targetAspect === '3:4') settings.aspectRatio = 'THREE_FOUR';
              else settings.aspectRatio = 'LANDSCAPE';
            }
            localStorage.setItem('flow-prompt-box-settings', JSON.stringify(settings));
            window.dispatchEvent(new StorageEvent('storage', {
              key: 'flow-prompt-box-settings',
              newValue: JSON.stringify(settings)
            }));
            return true;
          } catch (e) {
            return false;
          }
        })()
      `, true).catch(() => {});
    } catch {}

    // 2. Chuyển đổi Mode Tab (Image / Video) bằng FlowElementFinder
    try {
      const modeFinder = await FlowElementFinder.find(win, FlowElementFinder.getModeTabSpec(mode));
      if (modeFinder.found && modeFinder.selectedCandidate) {
        const c = modeFinder.selectedCandidate;
        const x = Math.round(c.rect.x + c.rect.width / 2);
        const y = Math.round(c.rect.y + c.rect.height / 2);
        console.log(`[Google Flow Settings] 🔘 Đã định vị Mode Tab [${mode}] qua FlowElementFinder (${c.strategy}, conf: ${c.confidence}/100) tại (${x}, ${y})`);
        win.focus?.();
        win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        await new Promise((r) => setTimeout(r, 40));
        win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        await new Promise((r) => setTimeout(r, 40));
        win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (e: any) {
      console.warn('[Google Flow Settings] Gặp sự cố khi định vị Mode Tab:', e?.message || e);
    }

    // 3. Mở Settings Popover bằng FlowElementFinder
    let popoverOpened = false;
    try {
      const triggerFinder = await FlowElementFinder.find(win, FlowElementFinder.getSettingsTriggerSpec());
      if (triggerFinder.found && triggerFinder.selectedCandidate) {
        const c = triggerFinder.selectedCandidate;
        const x = Math.round(c.rect.x + c.rect.width / 2);
        const y = Math.round(c.rect.y + c.rect.height / 2);
        console.log(`[Google Flow Settings] ⚙️ Đã định vị Settings Trigger qua FlowElementFinder (${c.strategy}, conf: ${c.confidence}/100) tại (${x}, ${y})`);
        win.focus?.();
        win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        await new Promise((r) => setTimeout(r, 40));
        win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        await new Promise((r) => setTimeout(r, 40));
        win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        popoverOpened = true;
        await new Promise((r) => setTimeout(r, 450));
      }
    } catch (e: any) {
      console.warn('[Google Flow Settings] Gặp sự cố khi định vị Settings Trigger:', e?.message || e);
    }

    // 4. Nếu popover mở, tương tác với Aspect Ratio và Output Count
    if (popoverOpened) {
      // A. Chọn Aspect Ratio qua FlowElementFinder
      try {
        const aspectFinder = await FlowElementFinder.find(win, FlowElementFinder.getAspectRatioSpec(aspect));
        if (aspectFinder.found && aspectFinder.selectedCandidate) {
          const c = aspectFinder.selectedCandidate;
          const x = Math.round(c.rect.x + c.rect.width / 2);
          const y = Math.round(c.rect.y + c.rect.height / 2);
          console.log(`[Google Flow Settings] 📐 Đã định vị Aspect Ratio [${aspect}] qua FlowElementFinder (${c.strategy}, conf: ${c.confidence}/100) tại (${x}, ${y})`);
          win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
          await new Promise((r) => setTimeout(r, 30));
          win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
          await new Promise((r) => setTimeout(r, 40));
          win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
          await new Promise((r) => setTimeout(r, 150));
        }
      } catch (e: any) {
        console.warn('[Google Flow Settings] Gặp sự cố khi định vị Aspect Ratio:', e?.message || e);
      }

      // B. Chọn Output Count qua FlowElementFinder
      try {
        const countFinder = await FlowElementFinder.find(win, FlowElementFinder.getOutputCountSpec(count));
        if (countFinder.found && countFinder.selectedCandidate) {
          const c = countFinder.selectedCandidate;
          const x = Math.round(c.rect.x + c.rect.width / 2);
          const y = Math.round(c.rect.y + c.rect.height / 2);
          console.log(`[Google Flow Settings] 🔢 Đã định vị Output Count [x${count}] qua FlowElementFinder (${c.strategy}, conf: ${c.confidence}/100) tại (${x}, ${y})`);
          win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
          await new Promise((r) => setTimeout(r, 30));
          win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
          await new Promise((r) => setTimeout(r, 40));
          win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
          await new Promise((r) => setTimeout(r, 150));
        }
      } catch (e: any) {
        console.warn('[Google Flow Settings] Gặp sự cố khi định vị Output Count:', e?.message || e);
      }

      // C. Đóng popover bằng cách click lại trigger button, backdrop hoặc Save button
      try {
        await this.safeExecuteJs(
          win,
          `(function() {
            const saveBtn = document.querySelector('button.settings-save-button') || Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === 'Lưu');
            if (saveBtn) { saveBtn.click(); return 'clicked_save'; }
            const bd = document.querySelector('.cdk-overlay-backdrop');
            if (bd) { bd.click(); return 'clicked_backdrop'; }
            const trigger = document.querySelector('flow-prompt-box button.settings-trigger-button, flow-prompt-box button[aria-label*="Điều kiện kích hoạt" i]');
            if (trigger) { trigger.click(); return 'clicked_trigger'; }
          })()`,
          2000
        );
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        await new Promise((r) => setTimeout(r, 40));
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await new Promise((r) => setTimeout(r, 200));
      } catch {}
    }
  }

  /**
   * Sinh video qua tự động hóa giao diện Google Flow trên Electron BrowserWindow.
   * Tất cả các bước đều có timeout ngắn để tuyệt đối không làm treo workflow.
   */
  async generateVideoViaBrowserContext(
    params: {
      prompt: string;
      initFrameUrl?: string;
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

      // BƯỚC 1: Đảm bảo đúng Project Context (tiếp nối project của ảnh nếu cùng session hoặc có targetProjectId)
      const projectReady = await this.ensureProjectContext(win, params.projectId, onProgress, isCancelled);
      if (!projectReady) {
        console.warn('[Google Flow Browser] Không thể mở hoặc tạo dự án video trên Google Flow.');
        return null;
      }

      // Bước 1.2: Dọn dẹp overlay cũ nếu có trước khi chọn card ảnh
      await this.ensureCleanCanvasReady(win, 'video', onProgress, isCancelled);

      if (isCancelled?.()) return null;

      // BƯỚC 1.5: XỬ LÝ KHUNG HÌNH THAM CHIẾU (IMAGE-TO-VIDEO CHAINING)
      onProgress?.(18, 'Đang liên kết ảnh tham chiếu cho video...');
      const selectImageCardJs = `
        (async function() {
          function isVisible(el) {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0) return false;
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
          }

          // 1. Kiểm tra xem ô prompt box đã có chip ảnh đính kèm chưa
          const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container');
          const existingChip = promptBox ? promptBox.querySelector('flow-image-ingredient-chip, .chip-container, .chip-image-wrapper, mat-chip') : null;
          if (existingChip) {
            return 'already_has_image_chip';
          }

          // 2. Tìm thẻ ảnh (flow-image-tile) trên canvas của project
          const imageCards = Array.from(document.querySelectorAll('flow-image-tile')).filter(isVisible);
          if (imageCards.length > 0) {
            const targetCard = imageCards[imageCards.length - 1];
            
            // Tìm nút menu (Tuỳ chọn khác) trên tile ảnh
            const menuBtn = targetCard.querySelector(
              'button[aria-label*="Tuỳ chọn khác" i], button[aria-label*="More" i], .mat-mdc-menu-trigger'
            );
            if (menuBtn) {
              menuBtn.click();
              await new Promise(r => setTimeout(r, 450));
              
              // Tìm mục "Tạo ảnh động" (motion_blur / animate) hoặc "Thêm vào câu lệnh" trong menu vừa mở
              const menuItems = Array.from(document.querySelectorAll('.cdk-overlay-container [role="menuitem"], .mat-mdc-menu-item'));
              const animItem = menuItems.find(el => {
                const t = (el.innerText || el.textContent || '').toLowerCase();
                return t.includes('tạo ảnh động') || t.includes('motion') || t.includes('animate');
              }) || menuItems.find(el => {
                const t = (el.innerText || el.textContent || '').toLowerCase();
                return t.includes('thêm vào câu lệnh') || t.includes('add to prompt');
              });

              if (animItem) {
                animItem.click();
                await new Promise(r => setTimeout(r, 500));
                return 'clicked_menu_tao_anh_dong';
              }
            }

            // Fallback: click nút animate trực tiếp nếu có
            const btns = Array.from(targetCard.querySelectorAll('button, [role="button"]'));
            const animBtn = btns.find(b => {
              const t = (b.getAttribute('aria-label') || b.innerText || b.textContent || '').toLowerCase();
              return t.includes('tạo video') || t.includes('animate') || t.includes('tạo ảnh động');
            });
            if (animBtn) {
              animBtn.click();
              await new Promise(r => setTimeout(r, 500));
              return 'clicked_card_animate';
            }
          }

          // 3. Fallback: mở menu Add của prompt box để chọn ảnh
          if (promptBox) {
            const addBtn = promptBox.querySelector('button[aria-label*="Thêm thành phần" i], button.add-menu-trigger');
            if (addBtn && isVisible(addBtn)) {
              addBtn.click();
              await new Promise(r => setTimeout(r, 450));
              const addItems = Array.from(document.querySelectorAll('.cdk-overlay-container [role="menuitem"], .mat-mdc-menu-item'));
              const imgItem = addItems.find(el => {
                const t = (el.innerText || el.textContent || '').toLowerCase();
                return t.includes('hình ảnh') || t.includes('image') || t.includes('thêm vào câu lệnh');
              });
              if (imgItem) {
                imgItem.click();
                await new Promise(r => setTimeout(r, 500));
                return 'clicked_add_menu_image';
              }
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27 }));
            }
          }

          return 'no_image_card';
        })()
      `;

      const cardRes = await this.safeExecuteJs<string>(win, selectImageCardJs, 6000);
      console.log('[Google Flow Browser] 🎬 Kết quả liên kết card ảnh Image-to-Video:', cardRes);

      // Kiểm tra xem chip ảnh đã xuất hiện trong prompt box chưa
      const checkChipJs = `Boolean(document.querySelector('flow-image-ingredient-chip, flow-prompt-box .chip-container, flow-prompt-box .chip-image-wrapper, flow-prompt-box mat-chip'))`;
      let hasChip = await this.safeExecuteJs<boolean>(win, checkChipJs, 2000);

      // B. Nếu chưa có chip trên canvas nhưng có file ảnh cục bộ (initFrameUrl bên ngoài): Dán ảnh qua Clipboard
      if (!hasChip && params.initFrameUrl) {
        try {
          let localImgPath = params.initFrameUrl;
          if (localImgPath.startsWith('file://')) {
            localImgPath = localImgPath.replace(/^file:\/\/\/?/, '');
          }
          const fs = require('fs');
          if (fs.existsSync(localImgPath)) {
            const natImg = electron.nativeImage.createFromPath(localImgPath);
            if (!natImg.isEmpty()) {
              console.log('[Google Flow Browser] 🖼️ Nạp ảnh initFrameUrl vào Clipboard và Paste vào Prompt Box...');
              await FlowClipboardGuard.withPreservedClipboard(electron, async () => {
                electron.clipboard.writeImage(natImg);
                win.focus();
                win.webContents.paste();
                await new Promise((r) => setTimeout(r, 1200));
              });
              hasChip = await this.safeExecuteJs<boolean>(win, checkChipJs, 2000);
            }
          }
        } catch (pasteErr) {
          console.warn('[Google Flow Browser] Thử paste initFrameUrl warning:', pasteErr);
        }
      }

      console.log('[Google Flow Browser] 📌 Trạng thái gắn chip ảnh trong prompt box:', hasChip);

      // BƯỚC 2: Thiết lập Mode VIDEO, Duration, Aspect Ratio và Output Count trong Google Flow
      onProgress?.(22, 'Đang đồng bộ thiết lập video (thời lượng, tỉ lệ, số lượng)...');
      await this.configureGoogleFlowSettings(win, 'video', {
        outputCount: params.outputCount || 1,
        aspectRatio: params.aspectRatio || '16:9',
        durationSeconds: params.durationSeconds || 4,
        modelVariant: params.modelVariant || 'omni-flash',
      });

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

      // 2. Nạp prompt vào Clipboard và kích hoạt native paste qua WebContents (bảo tồn clipboard người dùng)
      await FlowClipboardGuard.withPreservedClipboard(electron, async () => {
        try {
          electron.clipboard.writeText(promptClean);
          win.focus();
          win.webContents.paste();
        } catch (e) {
          console.warn('[Google Flow Browser] Clipboard paste error:', e);
        }
        await new Promise((r) => setTimeout(r, 400));
      });

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

            // Tìm nút Submit / Generate VIDEO đang thực sự hiển thị trên DOM (loại trừ các nút helper)
            const genBtnSelectors = [
              'flow-generate-icon-button button',
              'button.generate-icon-button',
              'button[type="submit"]',
              'button[aria-label*="Tạo video" i]',
              'button[aria-label*="Generate video" i]',
              'button[aria-label*="Bắt đầu tạo" i]',
              'button[aria-label*="Start generation" i]',
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
                const label = (el.getAttribute('aria-label') || el.innerText || el.textContent || '').toLowerCase();
                // TUYỆT ĐỐI KHÔNG CHẤP NHẬN NÚT TẠO ẢNH TRONG LƯỢT SINH VIDEO
                if (label.includes('tạo ảnh') || label.includes('generate image')) {
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
                  const label = (el.getAttribute('aria-label') || el.innerText || el.textContent || '').toLowerCase();
                  if (label.includes('tạo ảnh') || label.includes('generate image')) {
                    return false;
                  }
                  return true;
                });
              }
              if (candidates.length > 0) {
                const target = candidates.find(b => {
                  const lbl = (b.getAttribute('aria-label') || b.innerText || b.textContent || '').toLowerCase();
                  if (lbl.includes('tạo ảnh') || lbl.includes('generate image')) return false;
                  return (
                    lbl.includes('tạo video') ||
                    lbl.includes('generate video') ||
                    lbl.includes('bắt đầu tạo') ||
                    lbl.includes('start generation') ||
                    b.classList.contains('generate-icon-button') ||
                    b.getAttribute('type') === 'submit'
                  );
                }) || candidates[0];

                if (target) {
                  const targetLabel = (target.getAttribute('aria-label') || target.innerText || target.textContent || '').toLowerCase();
                  if (targetLabel.includes('tạo ảnh') || targetLabel.includes('generate image')) {
                    await new Promise(r => setTimeout(r, 200));
                    continue;
                  }

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
                btnText: (genBtn.getAttribute('aria-label') || genBtn.innerText || genBtn.textContent || '').trim(),
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
          if (projectId) {
            this.currentProjectId = projectId;
          } else if (this.currentProjectId) {
            projectId = this.currentProjectId;
          }

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
            if (projectId) {
              this.currentProjectId = projectId;
            } else if (this.currentProjectId) {
              projectId = this.currentProjectId;
            }

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
              if (projectId) {
                this.currentProjectId = projectId;
              } else if (this.currentProjectId) {
                projectId = this.currentProjectId;
              }
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
   * Sinh ảnh trực tiếp trên trình duyệt Google Flow thông qua State Machine Engine.
   * Chạy qua chuỗi State Machine chuẩn:
   * OPEN_FLOW -> WAIT_FOR_PAGE_READY -> VERIFY_SESSION -> ENSURE_PROJECT_CONTEXT
   * -> CLEAN_CANVAS -> FIND_EDITOR -> FIND_PROMPT_INPUT -> ENTER_PROMPT
   * -> CONFIGURE_OPTIONS -> CAPTURE_BASELINE -> FIND_GENERATE_BUTTON
   * -> VERIFY_GENERATE_BUTTON -> CHECK_IDEMPOTENCY_BEFORE_GENERATE -> CLICK_GENERATE
   * -> VERIFY_GENERATION_STARTED -> WAIT_FOR_GENERATION -> VERIFY_GENERATION_COMPLETED
   * -> EXTRACT_OUTPUT
   *
   * Đảm bảo:
   * 1. Mỗi state có enter(), execute(), verify() chặt chẽ.
   * 2. Bắt buộc tính lại getBoundingClientRect() tức thời ngay trước khi gửi sendInputEvent.
   * 3. Idempotency Guard: phát hiện nếu generation đã chạy thì không click lại, chuyển thẳng sang chờ kết quả.
   */
  async generateImageViaBrowserContext(
    params: {
      prompt: string;
      aspectRatio?: string;
      outputCount?: number;
      imageEngine?: string;
      projectId?: string;
      taskId?: string;
      generationAttemptId?: string;
    },
    onProgress?: (pct: number, msg?: string) => void,
    isCancelled?: () => boolean
  ): Promise<{ imageUrl?: string; base64Data?: string; projectId?: string; error?: 'out_of_credits' | 'timeout' | 'button_not_found' | 'agent_error' | string; errorDetail?: string; } | null> {
    const taskId = params.taskId || `task_img_${Date.now()}`;
    const generationAttemptId = params.generationAttemptId || `att_${Math.random().toString(36).slice(2, 7)}`;

    // Đảm bảo lobby window sẵn sàng trước khi nạp context
    const ready = await this.ensureLobbyAtFlow();
    if (!ready) {
      console.warn('[Google Flow Browser] Sảnh Google Flow chưa sẵn sàng.');
      return null;
    }

    const fsm = new FlowStateMachine(FlowImageGenerationStatePipeline);
    const ctx: FlowStateContext = {
      taskId,
      generationAttemptId,
      mode: 'image',
      win: this.lobbyWindow,
      sessionMgr: this,
      prompt: params.prompt,
      aspectRatio: params.aspectRatio || '16:9',
      outputCount: params.outputCount || 1,
      imageEngine: params.imageEngine || 'nano-banana',
      targetProjectId: params.projectId,
      onProgress,
      isCancelled,
      generationState: 'IDLE',
      baselineUrls: new Set(),
      capturedMediaUrl: null,
      capturedBase64: null,
      generateClickedAt: 0,
      netFilterAttached: false,
      stateHistory: [],
    };

    const res = await fsm.run(ctx);

    if (!res.ok) {
      if (res.error === 'out_of_credits' || res.classifiedErrorCode === 'OUT_OF_CREDITS') {
        SettingsStore.set('veoSessionStatus', 'out_of_credits');
        SettingsStore.set('veoFlowCredits', 0);
        SettingsStore.set('veoFlowCreditsCheckedAt', Date.now());
      }
      return {
        error: (res.classifiedErrorCode as any) || (res.error as any) || 'unknown_failure',
        errorDetail: res.errorDetail,
      };
    }

    return {
      imageUrl: res.imageUrl,
      base64Data: res.base64Data,
      projectId: res.projectId,
    };
  }

  /**
   * Tự động kiểm tra và nhấn nút xác nhận tạo nội dung của Tác nhân (Creative Agent Permission).
   * Giúp workflow tự động chạy tiếp mà không cần người dùng phải bấm tay vào tab tác nhân.
   * Đồng thời phát hiện sớm nếu Tác nhân báo lỗi ("Tác nhân đã gặp lỗi. Hãy thử lại.") để dừng ngay, không bị treo.
   */
  public async autoConfirmAgentPermission(win: any): Promise<string> {
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
  public async ensureCleanCanvasReady(
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

      // Thử tìm nút đóng qua FlowElementFinder nếu Escape chưa đóng được
      try {
        const closeFinder = await FlowElementFinder.find(win, FlowElementFinder.getCloseOverlaySpec());
        if (closeFinder.found && closeFinder.selectedCandidate) {
          const c = closeFinder.selectedCandidate;
          const cx = Math.round(c.rect.x + c.rect.width / 2);
          const cy = Math.round(c.rect.y + c.rect.height / 2);
          console.log(`[Google Flow Browser] 🧹 Đã tìm thấy nút đóng overlay qua FlowElementFinder (${c.strategy}, conf: ${c.confidence}/100) tại (${cx}, ${cy})`);
          win.webContents.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 });
          await new Promise((r) => setTimeout(r, 40));
          win.webContents.sendInputEvent({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 });
        }
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

        // A. Xóa bỏ triệt để các thẻ chip ảnh cũ (flow-image-ingredient-chip) còn sót lại từ lượt trước
        let removedChipsCount = 0;
        const chipContainer = promptBox || document;
        const chipSelectors = [
          'flow-image-ingredient-chip',
          '.chip-container',
          '.chip-image-wrapper',
          'mat-chip-row',
          'mat-chip'
        ];
        const chips = Array.from(chipContainer.querySelectorAll(chipSelectors.join(', ')));
        for (const chip of chips) {
          try {
            // 1. Thử click nút xoá trên chip
            const removeBtn = chip.querySelector(
              'button[aria-label*="Xóa" i], button[aria-label*="Remove" i], button[aria-label*="Delete" i], button.remove-button, .mat-mdc-chip-remove, button'
            );
            if (removeBtn) {
              removeBtn.click();
              removedChipsCount++;
            } else {
              // 2. Fallback xoá node khỏi DOM và phát sự kiện
              chip.remove();
              removedChipsCount++;
            }
          } catch (e) {}
        }
        if (removedChipsCount > 0) {
          promptBox?.dispatchEvent(new Event('input', { bubbles: true }));
          promptBox?.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // B. Xóa sạch nội dung text cũ nếu còn sót lại từ lượt trước bằng DOM Range (không dùng clipboard OS)
        let currentText = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();
        if (currentText.length > 0) {
          try {
            promptEl.focus();
            if (promptEl.isContentEditable) {
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(promptEl);
              sel?.removeAllRanges();
              sel?.addRange(range);
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

        // C. Kiểm tra còn chip ảnh nào sót lại không
        const remainingChips = Array.from(
          chipContainer.querySelectorAll('flow-image-ingredient-chip, .chip-container, .chip-image-wrapper')
        ).filter(isVisible);

        // Kiểm tra nhanh sự hiện diện của ô prompt và nút Generate
        const genBtn = document.querySelector(
          'flow-generate-icon-button button, button.generate-icon-button, button[type="submit"], [aria-label*="tạo" i], [aria-label*="generate" i]'
        );
        const hasGenBtn = Boolean(genBtn && isVisible(genBtn));

        promptEl.focus();
        currentText = (promptEl.innerText || promptEl.textContent || promptEl.value || '').trim();
        const rect = promptEl.getBoundingClientRect();
        const canFocus = rect && rect.width > 0 && rect.height > 0;

        return {
          ready: Boolean(canFocus && remainingChips.length === 0),
          hasPrompt: true,
          hasGenBtn,
          coords: canFocus ? { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) } : null,
          textLen: currentText.length,
          removedChipsCount,
          remainingChipsCount: remainingChips.length
        };
      })()
    `;

    let cleanResult = await this.safeExecuteJs<any>(win, cleanAndCheckPromptJs, 3000);
    console.log('[Google Flow Browser] Trạng thái dọn dẹp canvas:', cleanResult);

    // Nếu ô prompt đã sẵn sàng, click chuột thật vào ô prompt để bảo đảm tiêu điểm OS
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

    // 3. Nếu đang trong một project hợp lệ: TUYỆT ĐỐI KHÔNG TẠO MỚI ĐỂ TRÁNH MẤT PROJECT & ẢNH ĐANG CÓ
    const currentUrl = win.webContents?.getURL?.() || '';
    if (currentUrl.includes('/project/')) {
      console.log('[Google Flow Browser] Đang ở trong project, bảo toàn project context.');
      return true;
    }

    // Chỉ tạo new project khi chưa mở project nào (đang ở ngoài flow.google.com trang chủ)
    console.log('[Google Flow Browser] Chưa ở trong project nào, đang tạo dự án mới...');
    const newProjOk = await this.createNewProject(win, onProgress, isCancelled);
    if (!newProjOk) return false;

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


