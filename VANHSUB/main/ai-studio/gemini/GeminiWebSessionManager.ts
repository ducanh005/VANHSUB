/**
 * Vanhsub AI Video Studio - Gemini Web Session & Automation Manager
 *
 * Provides Zero-API-Cost script generation by automating Gemini Web (gemini.google.com)
 * inside an isolated, persistent Electron session partition:
 * - Session partition: 'persist:gemini_session' (Google cookies & login preserved indefinitely)
 * - Headless/Offscreen execution OR Live Window (user can watch AI typing)
 * - Google OAuth anti-bot mitigation: Firefox auth UA switcher, sec-ch-ua strip, webdriver removal
 * - Self-healing DOM interaction for Gemini rich-textarea and Quill contenteditable
 * - Multi-turn conversation chunking (similar to Revo Studio economy mode)
 */

import { BrowserWindow, session, type WebContents } from 'electron';
import type { ScriptBeatLine } from '../types';
import { parseChatGptScriptResponse } from '../chatgpt/ChatGptWebSessionManager';

const GEMINI_HOME_URL = 'https://gemini.google.com/app';
const CHROME_DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const GOOGLE_AUTH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

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

export interface GeminiLoginStatus {
  isLoggedIn: boolean;
  userEmail?: string;
  sessionCheckedAt: number;
}

export class GeminiWebSessionManager {
  private static instance: GeminiWebSessionManager | null = null;
  private browserWindow: BrowserWindow | null = null;
  private isOffscreen = true;
  private isBusy = false;
  private isHeaderHookConfigured = false;

  private constructor() {}

  public static getInstance(): GeminiWebSessionManager {
    if (!GeminiWebSessionManager.instance) {
      GeminiWebSessionManager.instance = new GeminiWebSessionManager();
    }
    return GeminiWebSessionManager.instance;
  }

  /** Get or initialize the persistent Electron session partition */
  public getSession() {
    if (!session || typeof session.fromPartition !== 'function') {
      return null;
    }
    const ses = session.fromPartition('persist:gemini_session');
    ses.setUserAgent(CHROME_DESKTOP_UA);

    // Setup header modifications to bypass Google OAuth bot blockers
    if (!this.isHeaderHookConfigured) {
      try {
        ses.webRequest.onBeforeSendHeaders(
          { urls: ['https://*/*', 'http://*/*'] },
          (details: any, callback: any) => {
            const isGoogleAuth = details.url && details.url.includes('accounts.google.com');
            if (isGoogleAuth) {
              details.requestHeaders['User-Agent'] = GOOGLE_AUTH_UA;
            } else {
              details.requestHeaders['User-Agent'] = CHROME_DESKTOP_UA;
            }

            // Strip Electron / bot detection client hints
            delete details.requestHeaders['sec-ch-ua'];
            delete details.requestHeaders['sec-ch-ua-mobile'];
            delete details.requestHeaders['sec-ch-ua-platform'];
            delete details.requestHeaders['sec-ch-ua-full-version-list'];
            delete details.requestHeaders['sec-ch-ua-arch'];
            delete details.requestHeaders['sec-ch-ua-bitness'];
            delete details.requestHeaders['sec-ch-ua-model'];

            callback({ requestHeaders: details.requestHeaders });
          }
        );
        this.isHeaderHookConfigured = true;
      } catch (err) {
        console.warn('[GeminiWebSession] Could not configure onBeforeSendHeaders:', err);
      }
    }

    return ses;
  }

  /**
   * Check whether the user is logged into Google / Gemini Web by inspecting session cookies.
   */
  public async checkLoginStatus(): Promise<GeminiLoginStatus> {
    try {
      const ses = this.getSession();
      if (!ses?.cookies) {
        return {
          isLoggedIn: false,
          sessionCheckedAt: Date.now(),
        };
      }
      const cookies = await ses.cookies.get({});
      const authCookie = cookies.find(
        (c) =>
          GOOGLE_AUTH_COOKIE_NAMES.includes(c.name) ||
          (c.domain?.includes('google.com') && (c.name.includes('SID') || c.name.includes('SSID')))
      );

      return {
        isLoggedIn: Boolean(authCookie),
        sessionCheckedAt: Date.now(),
      };
    } catch (err) {
      console.error('[GeminiWebSession] Error checking login status:', err);
      return {
        isLoggedIn: false,
        sessionCheckedAt: Date.now(),
      };
    }
  }

  /**
   * Configures webContents with anti-bot overrides (webdriver removal, OAuth popups, etc.).
   */
  private configureWebContents(win: BrowserWindow): void {
    win.webContents.setUserAgent(CHROME_DESKTOP_UA);

    // Wipe navigator.webdriver on page load
    win.webContents.on('dom-ready', () => {
      win.webContents.executeJavaScript(`
        try {
          delete Object.getPrototypeOf(navigator).webdriver;
          if (navigator.webdriver) {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          }
        } catch (e) {}
      `).catch(() => {});
    });

    // Handle OAuth navigation (Google Auth UA switcher)
    win.webContents.on('did-navigate', (_event: any, url: string) => {
      if (url.includes('accounts.google.com')) {
        win.webContents.setUserAgent(GOOGLE_AUTH_UA);
      } else {
        win.webContents.setUserAgent(CHROME_DESKTOP_UA);
      }
    });

    // Support OAuth popup login windows
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.includes('accounts.google.com') || url.includes('google.com')) {
        win.loadURL(url).catch(() => {});
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode !== -3) {
        console.warn(`[Gemini Web] Page load notice (${errorCode}): ${errorDescription} for ${validatedURL}`);
      }
    });
  }

  /**
   * Opens a visible BrowserWindow for the user to log in with their Google account.
   */
  public async openLoginWindow(): Promise<boolean> {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.setPosition(100, 100);
      this.browserWindow.setSize(950, 750);
      this.browserWindow.show();
      this.browserWindow.focus();
      return true;
    }

    const ses = this.getSession();
    if (!ses || typeof BrowserWindow === 'undefined') {
      throw new Error('Môi trường Electron không khả dụng để mở trình duyệt Gemini.');
    }

    this.browserWindow = new BrowserWindow({
      width: 950,
      height: 750,
      title: 'Đăng nhập Gemini Web — Vanhsub AI Studio (Chế độ Tiết kiệm)',
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      show: true,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });

    this.configureWebContents(this.browserWindow);
    this.isOffscreen = false;

    // Load Gemini home
    this.browserWindow.loadURL(GEMINI_HOME_URL).catch((err) => {
      console.warn('[GeminiWebSession] loadURL warning:', err?.message || err);
    });

    return new Promise((resolve) => {
      if (!this.browserWindow) return resolve(false);

      this.browserWindow.on('closed', () => {
        this.browserWindow = null;
        resolve(true);
      });
    });
  }

  /**
   * Ensures an active automation window is available (either visible or offscreen).
   */
  private async ensureAutomationWindow(mode: 'offscreen' | 'visible' = 'offscreen'): Promise<BrowserWindow> {
    const ses = this.getSession();
    if (!ses || typeof BrowserWindow === 'undefined') {
      throw new Error('Môi trường Electron không khả dụng để tự động hóa Gemini.');
    }
    const shouldBeOffscreen = mode === 'offscreen';

    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      if (this.isOffscreen !== shouldBeOffscreen) {
        if (shouldBeOffscreen) {
          this.browserWindow.setPosition(-3000, -3000);
          this.browserWindow.hide();
          this.isOffscreen = true;
        } else {
          this.browserWindow.setPosition(100, 100);
          this.browserWindow.setSize(850, 700);
          this.browserWindow.show();
          this.isOffscreen = false;
        }
      }
      return this.browserWindow;
    }

    this.isOffscreen = shouldBeOffscreen;
    this.browserWindow = new BrowserWindow({
      width: 850,
      height: 700,
      x: shouldBeOffscreen ? -3000 : 100,
      y: shouldBeOffscreen ? -3000 : 100,
      show: !shouldBeOffscreen,
      title: 'Gemini Web Automation — Vanhsub AI Studio',
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });

    this.configureWebContents(this.browserWindow);

    this.browserWindow.on('closed', () => {
      this.browserWindow = null;
    });

    return this.browserWindow;
  }

  /**
   * Sends a prompt turn into Gemini Web DOM and waits for response.
   */
  private async sendPromptTurn(
    win: BrowserWindow,
    prompt: string,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    onProgress?.('Đang truyền prompt vào Gemini Web...');

    const injected = await win.webContents.executeJavaScript(`
      (async () => {
        const editor = document.querySelector('rich-textarea div[contenteditable="true"]') ||
                       document.querySelector('div.ql-editor[contenteditable="true"]') ||
                       document.querySelector('div[contenteditable="true"]') ||
                       document.querySelector('textarea');
        if (!editor) return { success: false, error: 'Không tìm thấy ô nhập prompt trên Gemini Web' };

        editor.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, ${JSON.stringify(prompt)});
        editor.dispatchEvent(new Event('input', { bubbles: true }));

        await new Promise(r => setTimeout(r, 600));

        const sendBtn = document.querySelector('button[aria-label*="Gửi"]') ||
                        document.querySelector('button[aria-label*="Send"]') ||
                        document.querySelector('button.send-button') ||
                        document.querySelector('button[mattooltip*="Send"]') ||
                        document.querySelector('button[data-test-id="send-button"]');
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
          return { success: true };
        }

        const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
        editor.dispatchEvent(enterEvent);
        return { success: true };
      })()
    `);

    if (!injected?.success) {
      throw new Error(injected?.error || 'Không thể gửi prompt tới Gemini Web');
    }

    onProgress?.('Gemini đang phản hồi...');
    return this.waitForResponseCompletion(win.webContents, onProgress);
  }

  /**
   * Core automation: Navigate to Gemini, input prompt, wait for reply,
   * with automatic Multi-Turn Chunking if the script is truncated.
   */
  public async generateScriptWeb(
    topic: string,
    preset: string,
    mode: 'offscreen' | 'visible' = 'offscreen',
    onProgress?: (msg: string) => void
  ): Promise<string> {
    if (this.isBusy) {
      throw new Error('Gemini Web đang bận thực hiện tác vụ khác. Vui lòng thử lại sau giây lát.');
    }

    this.isBusy = true;
    try {
      const loginStatus = await this.checkLoginStatus();
      if (!loginStatus.isLoggedIn) {
        onProgress?.('Chưa phát hiện đăng nhập Google / Gemini Web. Đang mở cửa sổ đăng nhập...');
        await this.openLoginWindow();
        const recheck = await this.checkLoginStatus();
        if (!recheck.isLoggedIn) {
          throw new Error('Vui lòng hoàn tất đăng nhập tài khoản Google để sử dụng Gemini Web.');
        }
      }

      onProgress?.('Đang kết nối phiên Gemini Web...');
      const win = await this.ensureAutomationWindow(mode);

      const currentUrl = win.webContents.getURL();
      if (!currentUrl.includes('gemini.google.com')) {
        await win.loadURL(GEMINI_HOME_URL);
        await new Promise((r) => setTimeout(r, 4000));
      }

      const turn1Prompt = `Bạn là biên kịch video chuyên nghiệp cho kênh video triệu view (YouTube Shorts / TikTok).
Chủ đề video: "${topic}".
Phong cách: ${preset}.

Nhiệm vụ: Viết kịch bản lồng tiếng tiếng Việt gồm chính xác 4 đến 6 câu ngắn gọn, súc tích, câu từ lôi cuốn, dành cho người nghe.
Quy định định dạng bắt buộc:
Mỗi câu viết trên 1 dòng riêng biệt theo đúng cú pháp:
CÂU 1: [Câu thoại mở đầu giật gân, cuốn hút người xem trong 3 giây đầu]
CÂU 2: [Câu thoại giới thiệu bối cảnh / dữ kiện bất ngờ]
CÂU 3: [Câu thoại cao trào, thông tin then chốt hấp dẫn]
CÂU 4: [Câu thoại phân tích hoặc mở rộng chi tiết]
CÂU 5: [Câu thoại kết luận và kêu gọi hành động đăng ký kênh]

CHÚ Ý: Chỉ trả về các dòng bắt đầu bằng "CÂU X: ...", không thêm lời chào, không thêm markdown phụ.`;

      const turn1Response = await this.sendPromptTurn(win, turn1Prompt, onProgress);
      let combinedResponse = turn1Response;

      const turn1Parsed = parseChatGptScriptResponse(turn1Response, topic);
      if (turn1Parsed.length < 4) {
        onProgress?.('Kịch bản chưa đủ số phân cảnh. Đang gửi lượt yêu cầu tiếp nối (Multi-turn chunking)...');
        const nextStart = turn1Parsed.length + 1;
        const turn2Prompt = `Hãy tiếp tục viết các câu tiếp theo từ CÂU ${nextStart} đến CÂU ${Math.max(
          5,
          nextStart + 2
        )} để hoàn thiện kịch bản về chủ đề "${topic}". Giữ nguyên định dạng mỗi dòng "CÂU X: [Nội dung]".`;
        try {
          const turn2Response = await this.sendPromptTurn(win, turn2Prompt, onProgress);
          combinedResponse = `${turn1Response}\n${turn2Response}`;
        } catch (turn2Err) {
          console.warn('[GeminiWebSession] Turn 2 continuation failed, proceeding with Turn 1 response:', turn2Err);
        }
      }

      return combinedResponse;
    } finally {
      this.isBusy = false;
      if (mode === 'offscreen' && this.browserWindow && !this.browserWindow.isDestroyed()) {
        this.browserWindow.hide();
      }
    }
  }

  /**
   * Executes a single prompt turn against Gemini Web and returns the full response text.
   * Useful for Idea Blueprint generation, SEO metadata, and custom prompt queries.
   */
  public async executePromptTurn(
    prompt: string,
    mode: 'offscreen' | 'visible' = 'offscreen',
    onProgress?: (msg: string) => void
  ): Promise<string> {
    if (this.isBusy) {
      throw new Error('Gemini Web đang bận thực hiện tác vụ khác. Vui lòng thử lại sau giây lát.');
    }

    this.isBusy = true;
    try {
      const loginStatus = await this.checkLoginStatus();
      if (!loginStatus.isLoggedIn) {
        onProgress?.('Chưa phát hiện đăng nhập Google. Đang mở cửa sổ đăng nhập...');
        await this.openLoginWindow();
        const recheck = await this.checkLoginStatus();
        if (!recheck.isLoggedIn) {
          throw new Error('Vui lòng hoàn tất đăng nhập tài khoản Google để sử dụng Gemini Web.');
        }
      }

      onProgress?.('Đang kết nối phiên Gemini Web...');
      const win = await this.ensureAutomationWindow(mode);

      const currentUrl = win.webContents.getURL();
      if (!currentUrl.includes('gemini.google.com')) {
        await win.loadURL(GEMINI_HOME_URL);
        await new Promise((r) => setTimeout(r, 4000));
      }

      return await this.sendPromptTurn(win, prompt, onProgress);
    } finally {
      this.isBusy = false;
      if (mode === 'offscreen' && this.browserWindow && !this.browserWindow.isDestroyed()) {
        this.browserWindow.hide();
      }
    }
  }

  /**
   * Polls the Gemini Web DOM until generation completes.
   */
  private async waitForResponseCompletion(
    webContents: WebContents,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    const maxWaitMs = 90000; // 90s timeout
    const startTime = Date.now();

    await new Promise((r) => setTimeout(r, 2000));

    let lastLength = 0;
    let stableCount = 0;

    while (Date.now() - startTime < maxWaitMs) {
      const state = await webContents.executeJavaScript(`
        (() => {
          const stopBtn = document.querySelector('button[aria-label*="Dừng"]') ||
                          document.querySelector('button[aria-label*="Stop"]');
          const isStreaming = Boolean(stopBtn) || Boolean(document.querySelector('.sparkle-anim'));
          
          const responseContainers = Array.from(
            document.querySelectorAll('message-content, model-response')
          );
          let lastMsg = responseContainers[responseContainers.length - 1];
          if (!lastMsg) {
            const fallbacks = Array.from(
              document.querySelectorAll('.model-response-text, .response-container, .markdown')
            );
            lastMsg = fallbacks[fallbacks.length - 1];
          }
          const text = lastMsg ? lastMsg.innerText : '';

          return { isStreaming, text, messageCount: assistantMessages.length };
        })()
      `);

      if (state.isStreaming) {
        onProgress?.(`Gemini đang viết kịch bản... (${state.text.length} ký tự)`);
        stableCount = 0;
      } else if (state.text && state.text.length > 30) {
        if (state.text.length === lastLength) {
          stableCount++;
          if (stableCount >= 2) {
            return state.text;
          }
        } else {
          lastLength = state.text.length;
          stableCount = 0;
        }
      }

      await new Promise((r) => setTimeout(r, 1200));
    }

    throw new Error('Hết thời gian chờ phản hồi từ Gemini Web (Timeout 90s)');
  }

  /** Close active window if needed */
  public closeWindow(): void {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.close();
      this.browserWindow = null;
    }
  }
}
