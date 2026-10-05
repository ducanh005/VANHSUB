/**
 * Vanhsub AI Video Studio - ChatGPT Web Session & Automation Manager
 *
 * Provides Zero-API-Cost script generation by automating ChatGPT Web (chatgpt.com)
 * inside an isolated, persistent Electron session partition:
 * - Session partition: 'persist:chatgpt_session' (cookies & login preserved indefinitely)
 * - Headless/Offscreen execution OR Live Window (user can watch AI typing)
 * - Anti-bot detection mitigation: sec-ch-ua strip, navigator.webdriver wipe, OAuth popup handling
 * - Multi-turn conversation chunking (similar to Revo Studio economy mode)
 */

import { BrowserWindow, session, type WebContents } from 'electron';
import crypto from 'crypto';
import type { ScriptBeatLine, IdeaBlueprint, ChannelProfileConfig } from '../types';
import { ChatGptTurnTracker, readChatGptTurnSnapshot, isChatGptSessionCookie, type ChatGptTurnSnapshot } from './ChatGptWebTurnState';

const CHATGPT_HOME_URL = 'https://chatgpt.com';
const CHROME_DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const GOOGLE_AUTH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

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

  // Extract SCRIPT block if Master Prompt format is present
  let processedText = rawText;
  const scriptMatch = rawText.match(/SCRIPT:\s*([\s\S]*?)(?:---\s*END OF SCRIPT\s*---|NARRATION DIRECTION:|$)/i);
  if (scriptMatch && scriptMatch[1].trim().length >= 20) {
    processedText = scriptMatch[1].trim();
  }

  const lines = processedText
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
      content = content.replace(/^[\*_"“”'`]+|[\*_"“”'`]+$/g, '').trim();
      content = content.replace(/^\[.*?\]\s*/, '').trim();

      if (content.length >= 8) {
        const wordCount = content.split(/\s+/).filter(Boolean).length;
        const estDuration = Math.max(3.0, Math.round((wordCount / 3.2) * 10) / 10);
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

  // Fallback if formatting was not strictly numbered: full sentence boundary extraction
  if (parsedBeats.length < 3) {
    parsedBeats.length = 0;
    const meaningfulLines = lines.filter((l) => {
      const lower = l.toLowerCase();
      if (lower.startsWith('#') || lower.startsWith('>') || lower.startsWith('---')) return false;
      if (
        lower.includes('dưới đây là') ||
        lower.includes('chúc bạn') ||
        lower.includes('hy vọng kịch bản') ||
        lower.includes('bạn có thể tham khảo') ||
        lower.startsWith('title:') ||
        lower.startsWith('tiêu đề:') ||
        lower.startsWith('status:')
      ) {
        return false;
      }
      return l.length >= 10;
    });

    const sentences: string[] = [];
    for (const chunk of meaningfulLines) {
      const parts = chunk
        .split(/(?<=[.!?…])\s+(?=[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ0-9"“'\[])/u)
        .map((p) => p.trim())
        .filter(Boolean);

      if (parts.length > 0) {
        sentences.push(...parts);
      } else if (chunk.length > 0) {
        sentences.push(chunk);
      }
    }

    sentences.forEach((text, i) => {
      let cleanText = text.replace(/^\d+[\.\-\)]\s*/, '').replace(/\*\*/g, '').trim();
      cleanText = cleanText.replace(/^[\*_"“”'`]+|[\*_"“”'`]+$/g, '').trim();
      if (cleanText.length >= 8) {
        const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
        parsedBeats.push({
          id: `line-${i + 1}-${crypto.randomBytes(3).toString('hex')}`,
          index: i + 1,
          text: cleanText,
          estimatedDurationSec: Math.max(3.0, Math.round((wordCount / 3.2) * 10) / 10),
          beatType: 'body',
        });
      }
    });
  }

  // Normalize indexes and assign proper beat types
  if (parsedBeats.length >= 3) {
    parsedBeats.forEach((beat, i) => {
      beat.index = i + 1;
      if (i === 0) beat.beatType = 'hook';
      else if (i === 1) beat.beatType = 'intro';
      else if (i === parsedBeats.length - 1) beat.beatType = 'outro';
      else if (i >= parsedBeats.length - 3 && i >= parsedBeats.length - 2) beat.beatType = 'climax';
      else beat.beatType = 'body';
    });
  }

  return parsedBeats;
}

export interface ScriptPacingMetrics {
  isShorts: boolean;
  targetDurationSec: number;
  targetMinutesText: string;
  targetWordRange: string;
  targetSentenceRange: string;
  minSentences: number;
  maxSentences: number;
  targetWords: number;
}

export function calculateScriptPacingMetrics(
  blueprint?: IdeaBlueprint,
  channelProfile?: Partial<ChannelProfileConfig>
): ScriptPacingMetrics {
  const isShorts =
    blueprint?.aspectRatio === '9:16' ||
    channelProfile?.channelOrientation?.toLowerCase().includes('shorts') ||
    false;

  let targetDurationSec = 390; // Default: ~6.5 min (5_8_min)
  let targetMinutesText = '5 đến 8 phút';
  let minSentences = 40;
  let maxSentences = 60;
  let targetWords = 1250;
  let targetWordRange = '1.100 - 1.450 từ';
  let targetSentenceRange = '40 đến 60 câu phân cảnh';

  if (isShorts) {
    const shortDur = channelProfile?.targetShortDuration || '60_90_sec';
    if (shortDur === '30_60_sec') {
      targetDurationSec = 45;
      targetMinutesText = '30 đến 60 giây';
      targetWords = 140;
      targetWordRange = '100 - 160 từ';
      targetSentenceRange = '5 đến 8 câu phân cảnh';
      minSentences = 5;
      maxSentences = 8;
    } else {
      targetDurationSec = 75;
      targetMinutesText = '60 đến 90 giây';
      targetWords = 230;
      targetWordRange = '180 - 270 từ';
      targetSentenceRange = '8 đến 14 câu phân cảnh';
      minSentences = 8;
      maxSentences = 14;
    }
  } else {
    const longDur = channelProfile?.targetLongDuration || '5_8_min';
    if (longDur === '1_3_min') {
      targetDurationSec = 120;
      targetMinutesText = '1 đến 3 phút';
      targetWords = 380;
      targetWordRange = '300 - 550 từ';
      targetSentenceRange = '14 đến 22 câu phân cảnh';
      minSentences = 14;
      maxSentences = 22;
    } else if (longDur === '3_5_min') {
      targetDurationSec = 240;
      targetMinutesText = '3 đến 5 phút';
      targetWords = 750;
      targetWordRange = '650 - 900 từ';
      targetSentenceRange = '25 đến 38 câu phân cảnh';
      minSentences = 25;
      maxSentences = 38;
    } else if (longDur === '5_8_min') {
      targetDurationSec = 390;
      targetMinutesText = '5 đến 8 phút';
      targetWords = 1250;
      targetWordRange = '1.100 - 1.450 từ';
      targetSentenceRange = '40 đến 60 câu phân cảnh';
      minSentences = 40;
      maxSentences = 60;
    } else if (longDur === '8_12_min') {
      targetDurationSec = 600;
      targetMinutesText = '8 đến 12 phút';
      targetWords = 1900;
      targetWordRange = '1.650 - 2.300 từ';
      targetSentenceRange = '60 đến 90 câu phân cảnh';
      minSentences = 60;
      maxSentences = 90;
    } else if (longDur === '12_18_min') {
      targetDurationSec = 900;
      targetMinutesText = '12 đến 18 phút';
      targetWords = 2800;
      targetWordRange = '2.500 - 3.400 từ';
      targetSentenceRange = '90 đến 130 câu phân cảnh';
      minSentences = 90;
      maxSentences = 130;
    } else if (longDur === '18_28_min') {
      targetDurationSec = 1400;
      targetMinutesText = '18 đến 28 phút';
      targetWords = 4400;
      targetWordRange = '3.800 - 5.000 từ';
      targetSentenceRange = '130 đến 190 câu phân cảnh';
      minSentences = 130;
      maxSentences = 190;
    }
  }

  // If blueprint explicitly has estimatedDurationSec, adjust target sentences proportionally
  if (
    blueprint?.estimatedDurationSec &&
    blueprint.estimatedDurationSec > 0 &&
    Math.abs(blueprint.estimatedDurationSec - targetDurationSec) > 30
  ) {
    targetDurationSec = blueprint.estimatedDurationSec;
    targetWords = Math.round(targetDurationSec * 3.1);
    minSentences = Math.max(5, Math.round(targetWords / 25));
    maxSentences = Math.max(minSentences + 3, Math.round(targetWords / 18));
    targetWordRange = `${Math.round(targetWords * 0.85)} - ${Math.round(targetWords * 1.15)} từ`;
    targetSentenceRange = `${minSentences} đến ${maxSentences} câu phân cảnh`;
    const mins = Math.floor(targetDurationSec / 60);
    const secs = targetDurationSec % 60;
    targetMinutesText = mins > 0 ? `khoảng ${mins} phút ${secs > 0 ? `${secs}s` : ''}` : `${secs} giây`;
  }

  return {
    isShorts,
    targetDurationSec,
    targetMinutesText,
    targetWordRange,
    targetSentenceRange,
    minSentences,
    maxSentences,
    targetWords,
  };
}

export function buildScriptPromptForWeb(
  topic: string,
  preset: string,
  blueprint?: IdeaBlueprint,
  channelProfile?: Partial<ChannelProfileConfig>
): { prompt: string; metrics: ScriptPacingMetrics } {
  const metrics = calculateScriptPacingMetrics(blueprint, channelProfile);

  const title = blueprint?.title || topic;
  const projectName = channelProfile?.projectName || channelProfile?.channelNiche || 'Kênh Kể Chuyện AI';
  const orientation = channelProfile?.channelOrientation || preset || 'Kịch tính, sâu sắc, lôi cuốn, tư liệu thực tế';

  const masterPrompt = channelProfile?.masterPrompt?.trim();
  if (masterPrompt && masterPrompt.length >= 40) {
    const source = `${title}\n${blueprint?.hookConcept || ''}\n${blueprint?.narrativeAngle || ''}\n${(blueprint?.outline || []).join('\n')}`;
    const filledPrompt = masterPrompt
      .replace(/\{\{\s*CHANNEL_NAME\s*\}\}/gi, () => projectName)
      .replace(/\{\{\s*SOURCE_MATERIAL\s*\}\}/gi, () => source);
    return {
      prompt: `${filledPrompt}\n\nYÊU CẦU XUẤT CHO APP (ưu tiên định dạng này): Chỉ trả về từng câu thoại trên một dòng dạng CÂU X: ...; không xuất TITLE hay NARRATION DIRECTION. Độ dài mục tiêu ${metrics.targetMinutesText}, ${metrics.targetWordRange}, ${metrics.targetSentenceRange}.`,
      metrics,
    };
  }

  let prompt = '';

  if (metrics.isShorts) {
    prompt = `Bạn là biên kịch video ngắn chuyên nghiệp cho kênh video triệu view (YouTube Shorts / TikTok).
KÊNH: "${projectName}".
CHỦ ĐỀ: "${title}".
PHONG CÁCH: ${orientation}.
${blueprint?.hookConcept ? `HOOK 3S: "${blueprint.hookConcept}".` : ''}

NHIỆM VỤ:
Viết kịch bản lồng tiếng tiếng Việt hoàn chỉnh cho video ngắn độ dài ${metrics.targetMinutesText} (khoảng ${metrics.targetWordRange}, từ ${metrics.minSentences} đến ${metrics.maxSentences} câu).

QUY ĐỊNH ĐỊNH DẠNG BẮT BUỘC:
Mỗi câu viết trên 1 dòng riêng biệt theo đúng cú pháp:
CÂU 1: [Câu thoại mở đầu giật gân, cuốn hút người xem trong 3 giây đầu]
CÂU 2: [Câu thoại giới thiệu bối cảnh / dữ kiện bất ngờ]
...
CÂU ${metrics.maxSentences}: [Câu thoại kết luận và kêu gọi hành động đăng ký kênh]

CHÚ Ý: Chỉ trả về các dòng bắt đầu bằng "CÂU X: ...", không thêm lời chào, không thêm markdown phụ.`;
  } else {
    // LONG VIDEO (e.g. 5-8 minutes, 8-12 minutes)
    const outlineBlock =
      blueprint?.outline && blueprint.outline.length > 0
        ? `\nDÀN Ý PHÂN ĐOẠN CHI TIẾT (BẮT BUỘC BÁM SÁT VÀ PHÁT TRIỂN ĐỦ TẤT CẢ CÁC ĐOẠN NÀY):\n${blueprint.outline.join('\n')}\n`
        : '';

    prompt = `Bạn là nhà biên kịch YouTube cao cấp chuyên viết kịch bản lồng tiếng kể chuyện tài liệu dài triệu view.
KÊNH: "${projectName}"
CHỦ ĐỀ TẬP PHIM: "${title}"
${blueprint?.hookConcept ? `HOOK 3S BÚA BỔ MỞ ĐẦU: "${blueprint.hookConcept}"` : ''}
${blueprint?.narrativeAngle ? `GÓC NHÌN TIẾP CẬN: "${blueprint.narrativeAngle}"` : ''}
${channelProfile?.hostName ? `NGƯỜI DẪN / LỒNG TIẾNG (HOST): ${channelProfile.hostName}${channelProfile.hostDescription ? ` - ${channelProfile.hostDescription}` : ''}` : ''}
PHONG CÁCH KỂ CHUYỆN: ${orientation}
${outlineBlock}
NHIỆM VỤ CỐT TỬ VỀ ĐỘ DÀI VÀ NỘI DUNG:
- Độ dài mục tiêu: ${metrics.targetMinutesText} (${metrics.targetWordRange}).
- Kịch bản PHẢI ĐỦ DÀI, chia thành ${metrics.targetSentenceRange} độc lập.
- TUYỆT ĐỐI KHÔNG tóm tắt ngắn ngủn hay viết sơ sài vài câu. Phải đào sâu chi tiết, đưa ra bằng chứng thực tế, diễn biến kịch tính từng bước theo dàn ý.

QUY ĐỊNH ĐỊNH DẠNG BẮT BUỘC:
1. Viết kịch bản theo từng câu phân cảnh độc lập, mỗi câu trên 1 dòng riêng biệt theo cú pháp chính xác:
CÂU 1: [Hook mở đầu búa bổ bằng danh từ riêng hoặc con số chấn động trong 6 giây đầu]
CÂU 2: [Phát triển bối cảnh...]
...
CÂU ${metrics.minSentences}: ...
...
CÂU ${metrics.maxSentences}: [Đúc kết lắng đọng và lời kết kêu gọi đăng ký kênh ${projectName}]

2. Mỗi câu có độ dài khoảng 18 đến 30 từ, viết cho TAI nghe (tự nhiên, giàu hình ảnh, nhịp ngắt nghỉ rõ ràng).
3. KHÔNG thêm lời chào mừng AI, KHÔNG thêm tiêu đề markdown phụ. Chỉ trả về danh sách các dòng bắt đầu bằng "CÂU X: ...".`;
  }

  return { prompt, metrics };
}

export class ChatGptWebSessionManager {
  private static instance: ChatGptWebSessionManager | null = null;
  private browserWindow: BrowserWindow | null = null;
  private isOffscreen = true;
  private isBusy = false;
  private isHeaderHookConfigured = false;

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

    // Setup header modifications to bypass Cloudflare and Google bot blockers
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
        console.warn('[ChatGptWebSession] Could not configure onBeforeSendHeaders:', err);
      }
    }

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
      const authCookie = cookies.find((c) => isChatGptSessionCookie(c));

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

    // Handle OAuth navigation (Google, Apple, Microsoft)
    win.webContents.on('did-navigate', (_event: any, url: string) => {
      if (url.includes('accounts.google.com')) {
        win.webContents.setUserAgent(GOOGLE_AUTH_UA);
      } else {
        win.webContents.setUserAgent(CHROME_DESKTOP_UA);
      }
    });

    // Support OAuth popup login windows
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (
        url.includes('accounts.google.com') ||
        url.includes('appleid.apple.com') ||
        url.includes('login.microsoftonline.com') ||
        url.includes('auth0') ||
        url.includes('auth')
      ) {
        win.loadURL(url).catch(() => {});
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      // Ignore abort errors (usually redirects)
      if (errorCode !== -3) {
        console.warn(`[ChatGPT Web] Page load notice (${errorCode}): ${errorDescription} for ${validatedURL}`);
      }
    });
  }

  /**
   * Opens a visible BrowserWindow for the user to log in with their ChatGPT account.
   * When waitForCompletion is false (default, for UI button), returns true immediately so UI does not freeze.
   * When waitForCompletion is true (for auto-generation), polls until user logs in or closes window.
   */
  public async openLoginWindow(waitForCompletion = false): Promise<boolean> {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.setPosition(100, 100);
      this.browserWindow.setSize(950, 750);
      this.browserWindow.show();
      this.browserWindow.focus();
      this.isOffscreen = false;
      if (!waitForCompletion) {
        return true;
      }
    } else {
      const ses = this.getSession();
      if (!ses || typeof BrowserWindow === 'undefined') {
        throw new Error('Môi trường Electron không khả dụng để mở trình duyệt ChatGPT.');
      }

      this.browserWindow = new BrowserWindow({
        width: 950,
        height: 750,
        title: 'Đăng nhập ChatGPT Web — Vanhsub AI Studio (Chế độ Tiết kiệm)',
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

      // Load ChatGPT home
      this.browserWindow.loadURL(CHATGPT_HOME_URL).catch((err) => {
        console.warn('[ChatGptWebSession] loadURL warning:', err?.message || err);
      });

      this.browserWindow.on('closed', () => {
        this.browserWindow = null;
      });

      if (!waitForCompletion) {
        return true;
      }
    }

    return new Promise((resolve) => {
      const startedAt = Date.now();
      const pollInterval = setInterval(async () => {
        if (Date.now() - startedAt > 180_000 || !this.browserWindow || this.browserWindow.isDestroyed()) {
          clearInterval(pollInterval);
          resolve(false);
          return;
        }
        const status = await this.checkLoginStatus();
        if (status.isLoggedIn) {
          clearInterval(pollInterval);
          resolve(true);
        }
      }, 1500);

      this.browserWindow?.on('closed', () => {
        clearInterval(pollInterval);
        resolve(false);
      });
    });
  }

  /**
   * Logs out of ChatGPT Web by clearing cookies & storage data in the session partition.
   */
  public async logout(): Promise<void> {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.close();
      this.browserWindow = null;
    }
    const ses = this.getSession();
    if (ses) {
      await ses.clearStorageData();
    }
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
   * Sends a prompt turn into ChatGPT Web DOM and waits for response.
   */
  private async sendPromptTurn(
    win: BrowserWindow,
    prompt: string,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    onProgress?.('Đang truyền prompt vào ChatGPT Web...');

    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      throw new Error('Cửa sổ phiên ChatGPT Web không khả dụng hoặc đã bị đóng.');
    }

    // Wait for the SPA composer, rather than assuming loadURL + a fixed sleep is enough.
    const readyAt = Date.now();
    while (true) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) {
        throw new Error('Cửa sổ ChatGPT Web đã bị đóng.');
      }
      const ready = await win.webContents.executeJavaScript(`Boolean(document.querySelector('#prompt-textarea'))`);
      if (ready) break;
      if (Date.now() - readyAt > 30_000) {
        throw new Error('ChatGPT Web chưa sẵn sàng: kiểm tra đăng nhập hoặc thông báo xác minh trong cửa sổ ChatGPT.');
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const baseline: ChatGptTurnSnapshot = await win.webContents.executeJavaScript(`(${readChatGptTurnSnapshot.toString()})()`);
    if (baseline.isStreaming) throw new Error('ChatGPT đang trả lời lượt trước. Vui lòng chờ hoàn tất.');

    const injected = await win.webContents.executeJavaScript(`
      (async () => {
        try {
          const textarea = document.querySelector('#prompt-textarea') ||
                           document.querySelector('div[contenteditable="true"]') ||
                           document.querySelector('textarea');
          if (!textarea) return { success: false, error: 'Không tìm thấy ô nhập prompt trên ChatGPT Web' };
          const draft = textarea.value || textarea.innerText || '';
          if (draft.trim()) return { success: false, error: 'Ô nhập ChatGPT đang có nội dung chưa gửi. Vui lòng gửi hoặc xóa bản nháp trước.' };

          textarea.focus();
          if (textarea.tagName === 'DIV' || textarea.getAttribute('contenteditable') === 'true') {
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, ${JSON.stringify(prompt)});
          } else {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            setter.call(textarea, ${JSON.stringify(prompt)});
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }

          const deadline = Date.now() + 10000;
          while (Date.now() < deadline) {
            const sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                            document.querySelector('button[aria-label="Send prompt"]') ||
                            document.querySelector('button[aria-label="Send message"]') ||
                            document.querySelector('button[data-testid="fruitjuice-send-button"]');
            if (sendBtn && !sendBtn.disabled) {
              sendBtn.click();
              return { success: true };
            }
            await new Promise(r => setTimeout(r, 250));
          }
          return { success: false, error: 'Nút gửi ChatGPT không khả dụng; prompt chưa được gửi. Kiểm tra giới hạn sử dụng hoặc đăng nhập.' };
        } catch (err) {
          return { success: false, error: String(err) };
        }
      })()
    `);

    if (!injected?.success) {
      throw new Error(injected?.error || 'Không thể gửi prompt tới ChatGPT Web');
    }

    onProgress?.('ChatGPT đang phản hồi...');
    return this.waitForResponseCompletion(win.webContents, baseline, onProgress);
  }

  /**
   * Core automation: Navigate to ChatGPT, input prompt, wait for reply,
   * with automatic Multi-Turn Chunking if the script is truncated.
   */
  public async generateScriptWeb(
    topic: string,
    preset: string,
    mode: 'offscreen' | 'visible' = 'offscreen',
    onProgress?: (msg: string) => void,
    blueprint?: IdeaBlueprint,
    channelProfile?: Partial<ChannelProfileConfig>
  ): Promise<string> {
    if (this.isBusy) {
      throw new Error('ChatGPT Web đang bận thực hiện tác vụ khác. Vui lòng thử lại sau giây lát.');
    }

    this.isBusy = true;
    try {
      const loginStatus = await this.checkLoginStatus();
      if (!loginStatus.isLoggedIn) {
        onProgress?.('Chưa phát hiện đăng nhập ChatGPT Web. Đang mở cửa sổ đăng nhập...');
        await this.openLoginWindow(true);
        const recheck = await this.checkLoginStatus();
        if (!recheck.isLoggedIn) {
          throw new Error('Vui lòng hoàn tất đăng nhập tài khoản ChatGPT Web để sử dụng Chế độ Tiết kiệm.');
        }
      }

      onProgress?.('Đang kết nối phiên ChatGPT Web...');
      const win = await this.ensureAutomationWindow(mode);

      // Independent jobs start fresh; continuation turns below stay in this conversation.
      await win.loadURL(CHATGPT_HOME_URL);

      const { prompt: turn1Prompt, metrics } = buildScriptPromptForWeb(topic, preset, blueprint, channelProfile);
      onProgress?.(`Đang yêu cầu AI viết kịch bản mục tiêu ${metrics.targetMinutesText} (${metrics.targetSentenceRange})...`);

      const turn1Response = await this.sendPromptTurn(win, turn1Prompt, onProgress);
      let combinedResponse = turn1Response;

      const turn1Parsed = parseChatGptScriptResponse(turn1Response, topic);
      const targetMin = metrics.minSentences;

      // Multi-Turn continuation if script has not reached target sentence count
      if (turn1Parsed.length < targetMin) {
        onProgress?.(
          `Kịch bản lượt 1 đạt ${turn1Parsed.length}/${targetMin} câu. Đang gửi yêu cầu viết tiếp các phân cảnh (Multi-turn)...`
        );
        const nextStart = turn1Parsed.length + 1;
        const targetEnd = Math.min(
          metrics.maxSentences,
          nextStart + Math.max(18, targetMin - turn1Parsed.length + 4)
        );
        const turn2Prompt = `Kịch bản đang rất hấp dẫn. Hãy viết tiếp liền mạch các phân cảnh tiếp theo từ CÂU ${nextStart} đến CÂU ${targetEnd} để phát triển trọn vẹn các phần còn lại của dàn ý cho chủ đề "${topic}". Đảm bảo tổng độ dài đạt mục tiêu ${metrics.targetMinutesText}. CÂU ${targetEnd} là phần kết luận và kêu gọi đăng ký kênh.
Giữ nguyên đúng định dạng mỗi dòng:
CÂU X: [Nội dung câu thoại]`;
        try {
          const turn2Response = await this.sendPromptTurn(win, turn2Prompt, onProgress);
          combinedResponse = `${turn1Response}\n${turn2Response}`;

          // If still significantly short for long form videos (e.g. 8-12 min), send turn 3
          const turn2Parsed = parseChatGptScriptResponse(combinedResponse, topic);
          if (turn2Parsed.length < targetMin - 8 && metrics.targetDurationSec >= 600) {
            onProgress?.(`Đang gửi lượt 3 để hoàn tất kịch bản dài (${turn2Parsed.length}/${targetMin} câu)...`);
            const nextStart3 = turn2Parsed.length + 1;
            const turn3Prompt = `Hãy viết tiếp các phân cảnh cao trào và kết thúc từ CÂU ${nextStart3} đến CÂU ${metrics.maxSentences} để hoàn tất kịch bản. CÂU ${metrics.maxSentences} là lời kết và kêu gọi đăng ký kênh. Định dạng: CÂU X: [Nội dung].`;
            const turn3Response = await this.sendPromptTurn(win, turn3Prompt, onProgress);
            combinedResponse = `${combinedResponse}\n${turn3Response}`;
          }
        } catch (turn2Err) {
          console.warn('[ChatGptWebSession] Turn 2 continuation failed, proceeding with received text:', turn2Err);
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
   * Executes a single prompt turn against ChatGPT Web and returns the full response text.
   * Useful for Idea Blueprint generation, SEO metadata, and custom prompt queries.
   */
  public async executePromptTurn(
    prompt: string,
    mode: 'offscreen' | 'visible' = 'offscreen',
    onProgress?: (msg: string) => void
  ): Promise<string> {
    if (this.isBusy) {
      throw new Error('ChatGPT Web đang bận thực hiện tác vụ khác. Vui lòng thử lại sau giây lát.');
    }

    this.isBusy = true;
    try {
      const loginStatus = await this.checkLoginStatus();
      if (!loginStatus.isLoggedIn) {
        onProgress?.('Chưa phát hiện đăng nhập ChatGPT Web. Đang mở cửa sổ đăng nhập...');
        await this.openLoginWindow(true);
        const recheck = await this.checkLoginStatus();
        if (!recheck.isLoggedIn) {
          throw new Error('Vui lòng hoàn tất đăng nhập tài khoản ChatGPT Web để sử dụng Chế độ Tiết kiệm.');
        }
      }

      onProgress?.('Đang kết nối phiên ChatGPT Web...');
      const win = await this.ensureAutomationWindow(mode);

      await win.loadURL(CHATGPT_HOME_URL);

      return await this.sendPromptTurn(win, prompt, onProgress);
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
    baseline: ChatGptTurnSnapshot,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    const maxWaitMs = 240_000;
    const startTime = Date.now();
    const tracker = new ChatGptTurnTracker(baseline);

    while (Date.now() - startTime < maxWaitMs) {
      if (webContents.isDestroyed()) {
        throw new Error('Phiên ChatGPT Web đã bị đóng trong lúc chờ phản hồi.');
      }

      const state: ChatGptTurnSnapshot = await webContents.executeJavaScript(`(${readChatGptTurnSnapshot.toString()})()`);
      const response = tracker.observe(state, Date.now());
      if (response !== null) return response;
      onProgress?.(`Đang chờ phản hồi ChatGPT... (${state.text.length} ký tự)`);
      if (state.userCount <= baseline.userCount && Date.now() - startTime > 20_000) {
        throw new Error('ChatGPT chưa xác nhận nhận prompt. Kiểm tra cửa sổ ChatGPT trước khi thử lại để tránh gửi trùng.');
      }

      await new Promise((r) => setTimeout(r, 1200));
    }

    throw new Error('Hết thời gian chờ phản hồi hoàn chỉnh từ ChatGPT Web (240s). Kiểm tra cửa sổ ChatGPT trước khi thử lại.');
  }

  /** Close active window if needed */
  public closeWindow(): void {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.close();
      this.browserWindow = null;
    }
  }
}
