/**
 * Vanhsub AI Video Studio - ChatGPT Web Session & Automation Manager
 *
 * Provides Zero-API-Cost script generation by automating ChatGPT Web (chatgpt.com)
 * inside an isolated, persistent Electron session partition:
 * - Session partition: 'persist:chatgpt_session' (cookies & login preserved indefinitely)
 * - Headless/Offscreen execution OR Live Window (user can watch AI typing)
 * - Self-healing DOM interaction (input injection, send button trigger, stream completion detection)
 * - Multi-turn conversation chunking (similar to Revo Studio economy mode)
 */

import { BrowserWindow, session, type WebContents } from 'electron';
import crypto from 'crypto';
import type { ScriptBeatLine } from '../types';

const CHATGPT_HOME_URL = 'https://chatgpt.com';
const CHROME_DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface ChatGptLoginStatus {
  isLoggedIn: boolean;
  userEmail?: string;
  sessionCheckedAt: number;
}

/**
 * Parses raw textual response from ChatGPT Web into structured ScriptBeatLine items.
 * Robust against varied ChatGPT formatting (CÂU X, numbered list, bold prefixes, markdown).
 */
export function parseChatGptScriptResponse(rawText: string, topic: string): ScriptBeatLine[] {
  if (!rawText || typeof rawText !== 'string') return [];

  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const parsedBeats: ScriptBeatLine[] = [];

  // Match prefixes like "CÂU 1:", "Câu 1.", "Beat 1:", "Phân cảnh 1:", "1. [Hook] ..."
  const linePattern =
    /^(?:(?:\*{0,2}(?:CÂU|Câu|Beat|Phân cảnh)\s*(\d+)[\s:\-\.]+\*{0,2})|(?:\*{0,2}(\d+)[\.\)]\s*\*{0,2}))(?:\[.*?\]\s*)?(.+)/i;

  for (const line of lines) {
    const match = line.match(linePattern);
    if (match) {
      const lineNumStr = match[1] || match[2];
      const idx = parseInt(lineNumStr, 10);
      let content = match[3].trim();
      // Strip markdown bold / italic / quotes
      content = content.replace(/^[\*_"“”'`]+|[\*_"“”'`]+$/g, '').trim();
      // Remove any lingering [Hook] or [Intro] tags at beginning
      content = content.replace(/^\[.*?\]\s*/, '').trim();

      if (content.length >= 8) {
        const wordCount = content.split(/\s+/).length;
        const estDuration = Math.max(3.5, Math.round((wordCount / 3.2) * 10) / 10);
        parsedBeats.push({
          id: `line-${idx}-${crypto.randomBytes(3).toString('hex')}`,
          index: idx,
          text: content,
          estimatedDurationSec: estDuration,
          beatType: 'body',
        });
      }
    }
  }

  // Fallback if formatting was not strictly numbered
  if (parsedBeats.length < 3) {
    parsedBeats.length = 0;
    const meaningfulLines = lines.filter((l) => {
      const lower = l.toLowerCase();
      if (lower.startsWith('#') || lower.startsWith('>') || lower.startsWith('-')) return false;
      if (
        lower.includes('dưới đây là') ||
        lower.includes('chúc bạn') ||
        lower.includes('hy vọng kịch bản') ||
        lower.includes('bạn có thể tham khảo')
      ) {
        return false;
      }
      return l.length >= 15;
    });

    meaningfulLines.slice(0, 8).forEach((text, i) => {
      let cleanText = text.replace(/^\d+[\.\-\)]\s*/, '').replace(/\*\*/g, '').trim();
      cleanText = cleanText.replace(/^[\*_"“”'`]+|[\*_"“”'`]+$/g, '').trim();
      const wordCount = cleanText.split(/\s+/).length;
      parsedBeats.push({
        id: `line-${i + 1}-${crypto.randomBytes(3).toString('hex')}`,
        index: i + 1,
        text: cleanText,
        estimatedDurationSec: Math.max(3.5, Math.round((wordCount / 3.2) * 10) / 10),
        beatType: 'body',
      });
    });
  }

  // Normalize indexes and assign proper beat types
  if (parsedBeats.length >= 3) {
    parsedBeats.forEach((beat, i) => {
      beat.index = i + 1;
      if (i === 0) beat.beatType = 'hook';
      else if (i === 1) beat.beatType = 'intro';
      else if (i === parsedBeats.length - 1) beat.beatType = 'outro';
      else if (i === parsedBeats.length - 2) beat.beatType = 'climax';
      else beat.beatType = 'body';
    });
  }

  return parsedBeats;
}

export class ChatGptWebSessionManager {
  private static instance: ChatGptWebSessionManager | null = null;
  private browserWindow: BrowserWindow | null = null;
  private isOffscreen = true;
  private isBusy = false;

  private constructor() {}

  public static getInstance(): ChatGptWebSessionManager {
    if (!ChatGptWebSessionManager.instance) {
      ChatGptWebSessionManager.instance = new ChatGptWebSessionManager();
    }
    return ChatGptWebSessionManager.instance;
  }

  /** Get or initialize the persistent Electron session partition */
  public getSession() {
    if (!session || typeof session.fromPartition !== 'function') {
      return null;
    }
    const ses = session.fromPartition('persist:chatgpt_session');
    ses.setUserAgent(CHROME_DESKTOP_UA);
    return ses;
  }

  /**
   * Check whether the user is logged into ChatGPT Web by inspecting cookies.
   */
  public async checkLoginStatus(): Promise<ChatGptLoginStatus> {
    try {
      const ses = this.getSession();
      if (!ses?.cookies) {
        return {
          isLoggedIn: false,
          sessionCheckedAt: Date.now(),
        };
      }
      const cookies = await ses.cookies.get({});
      // Look for standard OpenAI authentication session cookies
      const authCookie = cookies.find(
        (c) =>
          c.name.includes('session-token') ||
          c.name.includes('jwt') ||
          c.name.includes('auth') ||
          c.name === '__Secure-next-auth.session-token' ||
          c.name.includes('oai-nav-state')
      );

      return {
        isLoggedIn: Boolean(authCookie),
        sessionCheckedAt: Date.now(),
      };
    } catch (err) {
      console.error('[ChatGptWebSession] Error checking login status:', err);
      return {
        isLoggedIn: false,
        sessionCheckedAt: Date.now(),
      };
    }
  }

  /**
   * Opens a visible BrowserWindow for the user to log in with their ChatGPT account.
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
      throw new Error('Môi trường Electron không khả dụng để mở trình duyệt ChatGPT.');
    }
    this.browserWindow = new BrowserWindow({
      width: 950,
      height: 750,
      title: 'Đăng nhập ChatGPT Web — Vanhsub AI Studio (Chế độ Tiết kiệm)',
      backgroundColor: '#0f172a',
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    this.isOffscreen = false;
    await this.browserWindow.loadURL(CHATGPT_HOME_URL);

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
      throw new Error('Môi trường Electron không khả dụng để tự động hóa ChatGPT.');
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
      title: 'ChatGPT Web Automation — Vanhsub AI Studio',
      backgroundColor: '#0f172a',
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    this.browserWindow.on('closed', () => {
      this.browserWindow = null;
    });

    return this.browserWindow;
  }

  /**
   * Sends a prompt turn into ChatGPT Web DOM and waits for response.
   */
  private async sendPromptTurn(
    win: BrowserWindow,
    prompt: string,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    onProgress?.('Đang truyền prompt vào ChatGPT Web...');

    // Inject prompt into ChatGPT Web DOM
    const injected = await win.webContents.executeJavaScript(`
      (async () => {
        const textarea = document.querySelector('#prompt-textarea') ||
                         document.querySelector('div[contenteditable="true"]') ||
                         document.querySelector('textarea');
        if (!textarea) return { success: false, error: 'Không tìm thấy ô nhập prompt trên ChatGPT Web' };

        textarea.focus();
        if (textarea.tagName === 'DIV' || textarea.getAttribute('contenteditable') === 'true') {
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, ${JSON.stringify(prompt)});
        } else {
          textarea.value = ${JSON.stringify(prompt)};
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }

        await new Promise(r => setTimeout(r, 600));

        const sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                        document.querySelector('button[aria-label="Send prompt"]') ||
                        document.querySelector('button[data-testid="fruitjuice-send-button"]');
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
          return { success: true };
        }

        const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
        textarea.dispatchEvent(enterEvent);
        return { success: true };
      })()
    `);

    if (!injected?.success) {
      throw new Error(injected?.error || 'Không thể gửi prompt tới ChatGPT Web');
    }

    onProgress?.('ChatGPT đang phản hồi...');
    return this.waitForResponseCompletion(win.webContents, onProgress);
  }

  /**
   * Core automation: Navigate to ChatGPT, input prompt, wait for reply,
   * with automatic Multi-Turn Chunking if the script is truncated.
   */
  public async generateScriptWeb(
    topic: string,
    preset: string,
    mode: 'offscreen' | 'visible' = 'offscreen',
    onProgress?: (msg: string) => void
  ): Promise<string> {
    if (this.isBusy) {
      throw new Error('ChatGPT Web đang bận thực hiện tác vụ khác. Vui lòng thử lại sau giây lát.');
    }

    this.isBusy = true;
    try {
      // Check login status first
      const loginStatus = await this.checkLoginStatus();
      if (!loginStatus.isLoggedIn) {
        onProgress?.('Chưa phát hiện đăng nhập ChatGPT Web. Đang mở cửa sổ đăng nhập...');
        await this.openLoginWindow();
        const recheck = await this.checkLoginStatus();
        if (!recheck.isLoggedIn) {
          throw new Error('Vui lòng hoàn tất đăng nhập tài khoản ChatGPT Web để sử dụng Chế độ Tiết kiệm.');
        }
      }

      onProgress?.('Đang kết nối phiên ChatGPT Web...');
      const win = await this.ensureAutomationWindow(mode);

      // Load ChatGPT home
      const currentUrl = win.webContents.getURL();
      if (!currentUrl.includes('chatgpt.com')) {
        await win.loadURL(CHATGPT_HOME_URL);
        await new Promise((r) => setTimeout(r, 4000));
      }

      // Turn 1: Main generation prompt
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

      // Multi-turn chunking check: if response has fewer than 4 beats, send Turn 2 continuation
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
          console.warn('[ChatGptWebSession] Turn 2 continuation failed, proceeding with Turn 1 response:', turn2Err);
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
   * Polls the ChatGPT Web DOM until generation completes.
   */
  private async waitForResponseCompletion(
    webContents: WebContents,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    const maxWaitMs = 90000; // 90s timeout
    const startTime = Date.now();

    // Give it 2s to start generating
    await new Promise((r) => setTimeout(r, 2000));

    let lastLength = 0;
    let stableCount = 0;

    while (Date.now() - startTime < maxWaitMs) {
      const state = await webContents.executeJavaScript(`
        (() => {
          const stopBtn = document.querySelector('button[data-testid="stop-button"]');
          const isStreaming = Boolean(stopBtn) || Boolean(document.querySelector('.result-streaming'));
          
          // Get all assistant messages
          const assistantMessages = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
          const lastMsg = assistantMessages[assistantMessages.length - 1];
          const text = lastMsg ? lastMsg.innerText : '';

          return { isStreaming, text, messageCount: assistantMessages.length };
        })()
      `);

      if (state.isStreaming) {
        onProgress?.(`AI đang viết kịch bản... (${state.text.length} ký tự)`);
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

    throw new Error('Hết thời gian chờ phản hồi từ ChatGPT Web (Timeout 90s)');
  }

  /** Close active window if needed */
  public closeWindow(): void {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.close();
      this.browserWindow = null;
    }
  }
}
