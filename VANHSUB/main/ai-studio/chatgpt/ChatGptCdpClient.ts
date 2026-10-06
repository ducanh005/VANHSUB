/**
 * ChatGptCdpClient.ts
 *
 * Vanhsub AI Video Studio - Playwright-Core CDP Client for ChatGPT Web.
 *
 * Core Capabilities:
 * 1. CDP Connection: chromium.connectOverCDP('http://127.0.0.1:9223').
 * 2. Persistent Context: strictly reuses browser.contexts()[0] to preserve cookies/login.
 * 3. Active Tab Management: reuses existing chatgpt.com tabs or navigates safely.
 * 4. Lifecycle Resilience: exponential backoff retry, mutex against race conditions,
 *    graceful detach, and self-healing cleanup on disconnect/crash.
 * 5. Isolation Guard: strictly forbids port 9222 (reserved for Google Flow Bridge).
 *
 * Location: main/ai-studio/chatgpt/ChatGptCdpClient.ts
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

export interface CdpSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export interface CdpConnectionOptions {
  port?: number;
  host?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  targetUrl?: string;
}

export class ChatGptCdpClient {
  private static instance: ChatGptCdpClient | null = null;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;
  private connectingPromise: Promise<CdpSession> | null = null;
  private isDisconnecting: boolean = false;

  private readonly defaultPort: number = 9223;
  private readonly defaultHost: string = '127.0.0.1';
  private readonly defaultTargetUrl: string = 'https://chatgpt.com';

  private constructor() {
    // Singleton pattern
  }

  public static getInstance(): ChatGptCdpClient {
    if (!ChatGptCdpClient.instance) {
      ChatGptCdpClient.instance = new ChatGptCdpClient();
    }
    return ChatGptCdpClient.instance;
  }

  /**
   * Resets singleton instance and cleans up references (useful for test teardown).
   */
  public static resetInstance(): void {
    if (ChatGptCdpClient.instance) {
      ChatGptCdpClient.instance.cleanupReferences();
      ChatGptCdpClient.instance = null;
    }
  }

  /**
   * Connects to Google Chrome over CDP.
   * If already connected, returns existing session immediately.
   * If a connection is in-flight, shares the pending promise (mutex).
   *
   * @param port Target CDP port (default: 9223)
   */
  public async connect(port?: number): Promise<CdpSession> {
    const effectivePort = port ?? this.defaultPort;

    // Security Guard: Prevent collision with Google Flow Bridge (9222)
    if (effectivePort === 9222) {
      throw new Error(
        '[ChatGptCdpClient] Port Conflict Guard: Port 9222 is strictly reserved for Google Flow Bridge (FlowBridgeServer). ' +
        'ChatGPT automation must run on port 9223.'
      );
    }

    // Fast-path: return alive connection
    if (this.browser && this.browser.isConnected() && this.context) {
      const page = await this.getActivePage();
      return {
        browser: this.browser,
        context: this.context,
        page,
      };
    }

    // Mutex: await existing in-flight connection attempt
    if (this.connectingPromise) {
      return await this.connectingPromise;
    }

    this.connectingPromise = this.internalConnect(effectivePort);

    try {
      const session = await this.connectingPromise;
      return session;
    } finally {
      this.connectingPromise = null;
    }
  }

  /**
   * Internal connection loop with exponential backoff retry.
   */
  private async internalConnect(port: number): Promise<CdpSession> {
    const maxRetries = 5;
    const baseDelayMs = 500;
    const cdpEndpoint = `http://${this.defaultHost}:${port}`;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[ChatGptCdpClient] Connecting to CDP at ${cdpEndpoint} (attempt ${attempt}/${maxRetries})...`);
        const browser = await chromium.connectOverCDP(cdpEndpoint, {
          timeout: 10000,
        });

        this.browser = browser;
        this.setupBrowserLifecycle(browser);

        // 1. Acquire Persistent Browser Context
        const context = await this.acquirePersistentContext(browser);
        this.context = context;

        // 2. Acquire or navigate Active Page
        const page = await this.acquireActivePage(context);
        this.activePage = page;

        console.log('[ChatGptCdpClient] Successfully connected over CDP and acquired active ChatGPT page.');
        return { browser, context, page };
      } catch (err: any) {
        lastError = err;
        if (attempt < maxRetries) {
          const delay = Math.round(baseDelayMs * Math.pow(1.5, attempt - 1));
          console.warn(
            `[ChatGptCdpClient] CDP connection attempt ${attempt}/${maxRetries} failed (${err?.message || err}). ` +
            `Retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(
      `[ChatGptCdpClient] Failed to connect to Chrome over CDP on port ${port} after ${maxRetries} attempts. ` +
      `Ensure Google Chrome was launched with --remote-debugging-port=${port} and --user-data-dir. ` +
      `Last error: ${lastError?.message || lastError}`
    );
  }

  /**
   * Acquires the persistent browser context.
   *
   * CRITICAL ARCHITECTURAL RULE:
   * When Chrome is launched with --user-data-dir, browser.contexts()[0] is the persistent context
   * containing all stored cookies, tokens, and login credentials.
   * Calling browser.newContext() creates an ephemeral incognito context which wipes the login session!
   */
  private async acquirePersistentContext(browser: Browser): Promise<BrowserContext> {
    let contexts = browser.contexts();
    if (contexts.length > 0) {
      return contexts[0];
    }

    // Defensive poll for context availability during CDP attachment
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      contexts = browser.contexts();
      if (contexts.length > 0) {
        return contexts[0];
      }
    }

    throw new Error(
      '[ChatGptCdpClient] Persistent Browser Context not found in Chrome instance. ' +
      'Refusing to create an incognito context via browser.newContext() because it would lose the saved login session.'
    );
  }

  /**
   * Acquires the active ChatGPT page:
   * 1. Finds existing tab already on chatgpt.com.
   * 2. If not found, repurposes an open blank page or creates a new page in the persistent context.
   * 3. Navigates safely and brings the tab to the foreground.
   */
  public async getActivePage(): Promise<Page> {
    // If browser/context is not connected or disconnected, connect first
    if (!this.browser || !this.browser.isConnected() || !this.context) {
      const session = await this.connect();
      return session.page;
    }

    // If cached activePage is alive and not closed, reuse it
    if (this.activePage && !this.activePage.isClosed()) {
      return this.activePage;
    }

    // Otherwise, re-acquire from persistent context
    this.activePage = await this.acquireActivePage(this.context);
    return this.activePage;
  }

  /**
   * Scans context pages and returns or creates a ChatGPT page.
   */
  private async acquireActivePage(context: BrowserContext): Promise<Page> {
    const pages = context.pages().filter((p) => !p.isClosed());

    // 1. Check if a tab is already on chatgpt.com or openai.com
    const existingChatGptPage = pages.find((p) => {
      try {
        const url = p.url();
        return url.includes('chatgpt.com') || url.includes('openai.com');
      } catch {
        return false;
      }
    });

    if (existingChatGptPage) {
      this.attachPageLifecycle(existingChatGptPage);
      await existingChatGptPage.bringToFront().catch(() => {});
      return existingChatGptPage;
    }

    // 2. Check if a blank tab or newtab page can be repurposed
    const blankPage = pages.find((p) => {
      try {
        const url = p.url();
        return url === 'about:blank' || url.startsWith('chrome://');
      } catch {
        return false;
      }
    });

    let targetPage: Page;
    if (blankPage) {
      targetPage = blankPage;
    } else if (pages.length === 1 && (pages[0].url() === '' || pages[0].url() === 'about:blank')) {
      targetPage = pages[0];
    } else {
      targetPage = await context.newPage();
    }

    this.attachPageLifecycle(targetPage);

    // 3. Navigate to ChatGPT if not already on the site
    if (!targetPage.url().includes('chatgpt.com')) {
      console.log(`[ChatGptCdpClient] Navigating tab to ${this.defaultTargetUrl}...`);
      await targetPage.goto(this.defaultTargetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    }

    await targetPage.bringToFront().catch(() => {});
    return targetPage;
  }

  /**
   * Attaches close and crash handlers to a Page to self-heal cached references.
   */
  private attachPageLifecycle(page: Page): void {
    if ((page as any).__vanhsubPageTracked) return;
    (page as any).__vanhsubPageTracked = true;

    page.on('close', () => {
      if (this.activePage === page) {
        console.log('[ChatGptCdpClient] Active ChatGPT page closed.');
        this.activePage = null;
      }
    });

    page.on('crash', () => {
      console.warn('[ChatGptCdpClient] Active ChatGPT page crashed.');
      if (this.activePage === page) {
        this.activePage = null;
      }
    });
  }

  /**
   * Sets up browser-level lifecycle hooks.
   */
  private setupBrowserLifecycle(browser: Browser): void {
    browser.on('disconnected', () => {
      if (!this.isDisconnecting) {
        console.warn('[ChatGptCdpClient] Browser disconnected unexpectedly from CDP.');
      } else {
        console.log('[ChatGptCdpClient] Browser CDP detached gracefully.');
      }
      this.cleanupReferences();
    });
  }

  /**
   * Disconnects the Playwright CDP WebSocket connection without closing the user's Chrome browser.
   * Keeps Chrome, open tabs, and login session completely intact.
   */
  public async disconnect(): Promise<void> {
    if (this.isDisconnecting) return;
    this.isDisconnecting = true;

    try {
      if (this.browser && this.browser.isConnected()) {
        if (typeof (this.browser as any).disconnect === 'function') {
          await (this.browser as any).disconnect();
        } else {
          await this.browser.close();
        }
      }
    } catch (err: any) {
      console.warn('[ChatGptCdpClient] Warning during disconnect:', err?.message || err);
    } finally {
      this.cleanupReferences();
      this.isDisconnecting = false;
    }
  }

  /**
   * Cleans up internal references.
   */
  private cleanupReferences(): void {
    this.browser = null;
    this.context = null;
    this.activePage = null;
    this.connectingPromise = null;
  }

  /**
   * Check if CDP connection is currently alive.
   */
  public isConnected(): boolean {
    return !!(this.browser && this.browser.isConnected());
  }

  /**
   * Returns current Browser instance or null.
   */
  public getBrowser(): Browser | null {
    return this.browser;
  }

  /**
   * Returns current BrowserContext instance or null.
   */
  public getContext(): BrowserContext | null {
    return this.context;
  }
}
