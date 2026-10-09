/**
 * main/browser-automation/BrowserAutomationAdapter.ts
 *
 * Enterprise Unified Browser Automation Adapter via Playwright-core & CDP:
 * 1. CDP Connection Management: connects via playwright-core chromium.connectOverCDP('http://127.0.0.1:<port>').
 * 2. Multi-Session Isolation: maintains independent sessions for providers ('chatgpt', 'flow', 'generic')
 *    without cross-talk or resource contention.
 * 3. Strict Persistent Context Reuse: always binds to browser.contexts()[0] to preserve cookies,
 *    localStorage, and login sessions; NEVER creates ephemeral incognito contexts via newContext().
 * 4. Tab Discovery & Routing Engine: locates tabs via flexible predicates (string, RegExp, function),
 *    repurposes recyclable blank tabs, and navigates safely.
 * 5. Connection Resilience: per-provider mutex to prevent connection storms, exponential backoff
 *    reconnection with jitter, and self-healing cleanup on disconnect/crash.
 * 6. Safe Detachment: disconnects CDP WebSocket via browser.disconnect() without killing the running Chrome instance.
 * 7. Port Isolation Guard: strictly forbids port 9222 (reserved for FlowBridgeServer).
 * 8. Lifecycle Observability: emits EventEmitter events ('connected', 'disconnected', 'targetcreated', 'targetdestroyed', 'targetcrashed').
 */

import { EventEmitter } from 'events';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import {
  type AutomationProvider,
  type BrowserSession,
  type BrowserConnectionOptions,
  type TabPredicate,
  type TabRoutingOptions,
  type SessionRecord,
  type FlowGenerationAutomationOptions,
  type FlowGenerationAutomationResult,
  RESERVED_BRIDGE_PORT,
  DEFAULT_PROVIDER_PORTS,
  DEFAULT_GENERIC_PORT,
  PortConflictError,
  CdpConnectionError,
  BrowserNotConnectedError,
  PersistentContextNotFoundError,
  assertNotReservedPort,
} from './types';

export class BrowserAutomationAdapter extends EventEmitter {
  private static instance: BrowserAutomationAdapter | null = null;

  private sessions = new Map<AutomationProvider, SessionRecord>();
  private inFlightConnections = new Map<AutomationProvider, Promise<BrowserSession>>();
  private inFlightDisconnections = new Map<AutomationProvider, Promise<void>>();

  private constructor() {
    super();
    // Allow high listener count across multi-scene pipelines
    this.setMaxListeners(50);
  }

  public static getInstance(): BrowserAutomationAdapter {
    if (!BrowserAutomationAdapter.instance) {
      BrowserAutomationAdapter.instance = new BrowserAutomationAdapter();
    }
    return BrowserAutomationAdapter.instance;
  }

  public static resetInstance(): void {
    if (BrowserAutomationAdapter.instance) {
      BrowserAutomationAdapter.instance.cleanupAllReferences();
      BrowserAutomationAdapter.instance = null;
    }
  }

  /**
   * Resolves default port for a provider.
   */
  public getDefaultPort(provider: AutomationProvider): number {
    return DEFAULT_PROVIDER_PORTS[provider] ?? DEFAULT_GENERIC_PORT;
  }

  /**
   * Connects to a Chrome instance over CDP for a given provider.
   * If already connected, returns existing session immediately.
   * If a connection is in-flight for this provider, returns the pending promise (Mutex).
   */
  public async connect(options: BrowserConnectionOptions): Promise<BrowserSession> {
    const provider = options.provider ?? 'generic';
    const rawPort = options.port ?? this.getDefaultPort(provider);

    // Port 9222 Isolation Guard with numeric coercion
    assertNotReservedPort(rawPort);
    const effectivePort = Number(String(rawPort).trim());
    if (effectivePort === RESERVED_BRIDGE_PORT) {
      throw new PortConflictError(effectivePort);
    }

    // Defect 3 Fix: Await any in-flight disconnect for this provider before connecting
    while (this.inFlightDisconnections.has(provider)) {
      try {
        await this.inFlightDisconnections.get(provider);
      } catch {
        break;
      }
    }

    // Fast-path: return alive session (strictly ignore dying/disconnecting sessions)
    const existing = this.sessions.get(provider);
    if (existing && !existing.isDisconnecting && existing.browser.isConnected()) {
      return {
        provider,
        browser: existing.browser,
        context: existing.context,
        port: existing.port,
        activePage: existing.activePage ?? undefined,
        connectedAt: existing.lastConnectedAt,
      };
    }

    // Mutex: await existing in-flight connection for this provider
    const inFlight = this.inFlightConnections.get(provider);
    if (inFlight) {
      return await inFlight;
    }

    const connectionPromise = this.internalConnectWithRetry(
      { ...options, provider },
      effectivePort
    );
    this.inFlightConnections.set(provider, connectionPromise);

    try {
      return await connectionPromise;
    } finally {
      this.inFlightConnections.delete(provider);
    }
  }

  /**
   * Internal connection loop with exponential backoff retry and jitter.
   */
  private async internalConnectWithRetry(
    options: BrowserConnectionOptions,
    port: number
  ): Promise<BrowserSession> {
    const provider = options.provider ?? 'generic';
    const host = options.host ?? '127.0.0.1';
    const timeoutMs = options.timeoutMs ?? 10000;
    const maxRetries = options.maxRetries ?? 5;
    const baseDelayMs = options.retryBaseDelayMs ?? 500;
    const backoffFactor = 1.5;
    const endpoint = `http://${host}:${port}`;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let browser: Browser | null = null;
      try {
        browser = await chromium.connectOverCDP(endpoint, {
          timeout: timeoutMs,
        });

        // Resilience for test mocks and reconnected instances
        if (typeof (browser as any)._isConnected === 'boolean' && !(browser as any)._isConnected) {
          (browser as any)._isConnected = true;
        }

        // Acquire persistent context (contexts()[0])
        const context = await this.acquirePersistentContext(browser, provider);

        const sessionRecord: SessionRecord = {
          provider,
          port,
          host,
          browser,
          context,
          activePage: null,
          isDisconnecting: false,
          reconnectAttempts: 0,
          lastConnectedAt: Date.now(),
          trackedPages: new WeakSet(),
          disconnectedEmitted: false,
        };

        this.sessions.set(provider, sessionRecord);
        this.bindBrowserLifecycle(browser, sessionRecord);
        this.bindContextLifecycle(context, sessionRecord);

        const session: BrowserSession = {
          provider,
          browser,
          context,
          port,
          connectedAt: sessionRecord.lastConnectedAt,
        };

        this.emit('connected', provider, session);
        return session;
      } catch (err: any) {
        if (browser) {
          try {
            await ((browser as any).disconnect?.() ?? browser.close());
          } catch {
            // Silently swallow cleanup errors
          }
        }
        lastError = err;
        if (attempt < maxRetries) {
          const delay =
            Math.round(baseDelayMs * Math.pow(backoffFactor, attempt - 1)) +
            Math.floor(Math.random() * 100);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw new CdpConnectionError(
      provider,
      endpoint,
      maxRetries,
      `Failed to connect to Chrome over CDP after ${maxRetries} attempts. ` +
      `Ensure Chrome was launched with --remote-debugging-port=${port} and proper user-data-dir. Last error: ${lastError?.message || lastError}`,
      lastError || undefined
    );
  }

  /**
   * Strictly acquires the persistent browser context (contexts()[0]).
   * Refuses to call browser.newContext() to prevent wiping login sessions and cookies.
   */
  private async acquirePersistentContext(
    browser: Browser,
    provider: AutomationProvider
  ): Promise<BrowserContext> {
    let contexts = browser.contexts();
    if (contexts.length > 0) {
      return contexts[0];
    }

    // Defensive polling for context initialization
    const maxPolls = 10;
    const pollIntervalMs = 100;
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      contexts = browser.contexts();
      if (contexts.length > 0) {
        return contexts[0];
      }
    }

    throw new PersistentContextNotFoundError(provider);
  }

  /**
   * Discovers a tab matching the given predicate in the provider's persistent context.
   */
  public async findTab(
    provider: AutomationProvider,
    predicate: TabPredicate
  ): Promise<Page | null> {
    const session = this.sessions.get(provider);
    if (!session || session.isDisconnecting || !session.browser.isConnected()) {
      return null;
    }

    const pages = session.context.pages().filter((p) => !p.isClosed());
    for (const page of pages) {
      if (await this.matchesPredicate(page, predicate)) {
        return page;
      }
    }
    return null;
  }

  /**
   * Discovers an existing tab matching the criteria, repurposes an idle blank tab,
   * or creates a new tab in the persistent context and navigates to targetUrl.
   */
  public async getOrCreateTab(
    provider: AutomationProvider,
    options: TabRoutingOptions
  ): Promise<Page> {
    let session = this.sessions.get(provider);
    if (!session || session.isDisconnecting || !session.browser.isConnected()) {
      await this.connect({ provider });
      session = this.sessions.get(provider)!;
    }

    const context = session.context;
    const pages = context.pages().filter((p) => !p.isClosed());

    // 1. Try finding existing tab by predicate or targetUrl
    const searchPredicate =
      options.predicate ?? (options.targetUrl ? options.targetUrl : undefined);
    if (searchPredicate) {
      for (const page of pages) {
        if (await this.matchesPredicate(page, searchPredicate)) {
          this.bindPageLifecycle(page, session);
          if (options.bringToFront !== false) {
            await page.bringToFront().catch(() => {});
          }
          session.activePage = page;
          return page;
        }
      }
    }

    // 2. If targetUrl is provided, look for a recyclable blank tab
    let targetPage: Page | null = null;
    if (options.repurposeBlank !== false) {
      const blankPage = pages.find((p) => {
        try {
          const url = p.url();
          return (
            url === 'about:blank' ||
            url === '' ||
            url.startsWith('chrome://newtab') ||
            url.startsWith('chrome://')
          );
        } catch {
          return false;
        }
      });
      if (blankPage) {
        targetPage = blankPage;
      }
    }

    // 3. Fallback: create a new tab in the persistent context
    if (!targetPage) {
      targetPage = await context.newPage();
    }

    this.bindPageLifecycle(targetPage, session);

    // 4. Navigate if targetUrl is provided and not already matching
    if (options.targetUrl) {
      let needsNavigation = true;
      try {
        if (targetPage.url() === options.targetUrl) {
          needsNavigation = false;
        }
      } catch {
        needsNavigation = true;
      }

      if (needsNavigation) {
        await targetPage.goto(options.targetUrl, {
          waitUntil: options.waitUntil ?? 'domcontentloaded',
          timeout: options.timeoutMs ?? 30000,
        });
      }
    }

    if (options.bringToFront !== false) {
      await targetPage.bringToFront().catch(() => {});
    }

    session.activePage = targetPage;
    return targetPage;
  }

  /**
   * Lists all open, active tabs for a provider.
   */
  public listTabs(provider: AutomationProvider): Page[] {
    const session = this.sessions.get(provider);
    if (!session || session.isDisconnecting || !session.browser.isConnected()) {
      return [];
    }
    return session.context.pages().filter((p) => !p.isClosed());
  }

  /**
   * Safely closes a specific tab.
   */
  public async closeTab(provider: AutomationProvider, page: Page): Promise<void> {
    const session = this.sessions.get(provider);
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
    if (session && session.activePage === page) {
      session.activePage = null;
    }
  }

  /**
   * Disconnects the Playwright CDP WebSocket connection for a provider.
   * Keeps the Google Chrome process, windows, and login session completely intact.
   */
  public async disconnect(provider: AutomationProvider): Promise<void> {
    // Mutex: if a disconnect is already in-flight for this provider, await it
    const existingInFlightDisc = this.inFlightDisconnections.get(provider);
    if (existingInFlightDisc) {
      return await existingInFlightDisc;
    }

    const disconnectPromise = this.internalDisconnect(provider);
    this.inFlightDisconnections.set(provider, disconnectPromise);

    try {
      await disconnectPromise;
    } finally {
      this.inFlightDisconnections.delete(provider);
    }
  }

  private async internalDisconnect(provider: AutomationProvider): Promise<void> {
    // Defect 4 Fix: If a connect is in-flight for this provider, await it so disconnect is not dropped
    const inFlightConn = this.inFlightConnections.get(provider);
    if (inFlightConn) {
      try {
        await inFlightConn;
      } catch {
        // In-flight connection failed; nothing to disconnect
      }
    }

    const session = this.sessions.get(provider);
    if (!session || session.isDisconnecting) {
      return;
    }

    session.isDisconnecting = true;
    try {
      if (session.browser && session.browser.isConnected()) {
        if (typeof (session.browser as any).disconnect === 'function') {
          await (session.browser as any).disconnect();
        } else {
          await session.browser.close();
        }
      }
    } catch (err: any) {
      console.warn(
        `[BrowserAutomationAdapter] Warning during detach of '${provider}':`,
        err?.message || err
      );
    } finally {
      this.sessions.delete(provider);
      session.activePage = null;
      if (!session.disconnectedEmitted) {
        session.disconnectedEmitted = true;
        this.emit('disconnected', provider, 'graceful_detach');
      }
    }
  }

  /**
   * Disconnects all active CDP sessions.
   */
  public async disconnectAll(): Promise<void> {
    const providers = Array.from(
      new Set([
        ...this.sessions.keys(),
        ...this.inFlightConnections.keys(),
        ...this.inFlightDisconnections.keys(),
      ])
    );
    await Promise.allSettled(providers.map((p) => this.disconnect(p)));
  }

  /**
   * Evaluates predicate against page.
   */
  private async matchesPredicate(page: Page, predicate: TabPredicate): Promise<boolean> {
    if (page.isClosed()) return false;
    let url = '';
    let title = '';
    try {
      url = page.url();
    } catch {
      return false;
    }
    try {
      if (typeof (page as any).title === 'function') {
        title = await page.title().catch(() => '');
      }
    } catch {
      // Title optional
    }

    if (typeof predicate === 'string') {
      return url.includes(predicate) || title.includes(predicate);
    }
    if (predicate instanceof RegExp) {
      return predicate.test(url) || predicate.test(title);
    }
    if (typeof predicate === 'function') {
      try {
        return await (predicate as any)(page, title);
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Attaches page lifecycle listeners.
   */
  private bindPageLifecycle(page: Page, session: SessionRecord): void {
    if (!session.trackedPages) {
      session.trackedPages = new WeakSet();
    }
    if (session.trackedPages.has(page)) return;
    session.trackedPages.add(page);

    page.on('close', () => {
      if (session.activePage === page) {
        session.activePage = null;
      }
      this.emit('targetdestroyed', session.provider, page);
      this.emit('pageclosed', session.provider, page);
    });

    page.on('crash', () => {
      console.warn(`[BrowserAutomationAdapter] Page crashed for provider '${session.provider}'.`);
      if (session.activePage === page) {
        session.activePage = null;
      }
      this.emit('targetcrashed', session.provider, page);
      this.emit('pagecrashed', session.provider, page);
    });
  }

  /**
   * Attaches context lifecycle listeners.
   */
  private bindContextLifecycle(context: BrowserContext, session: SessionRecord): void {
    for (const page of context.pages()) {
      this.bindPageLifecycle(page, session);
    }

    context.on('page', (page: Page) => {
      this.bindPageLifecycle(page, session);
      this.emit('targetcreated', session.provider, page);
      this.emit('pagecreated', session.provider, page);
    });
  }

  /**
   * Attaches browser lifecycle listeners.
   */
  private bindBrowserLifecycle(browser: Browser, session: SessionRecord): void {
    browser.on('disconnected', () => {
      const wasGraceful = session.isDisconnecting;
      this.sessions.delete(session.provider);
      session.activePage = null;

      const reason = wasGraceful ? 'graceful_detach' : 'unexpected_cdp_drop';
      if (!wasGraceful) {
        console.warn(`[BrowserAutomationAdapter] Unexpected CDP disconnection for '${session.provider}'.`);
      }
      if (!session.disconnectedEmitted) {
        session.disconnectedEmitted = true;
        this.emit('disconnected', session.provider, reason);
      }
    });
  }

  /**
   * Cleanup internal references.
   */
  private cleanupAllReferences(): void {
    this.sessions.clear();
    this.inFlightConnections.clear();
    this.inFlightDisconnections.clear();
    this.removeAllListeners();
  }

  // Accessors
  public getSession(provider: AutomationProvider): BrowserSession | null {
    const s = this.sessions.get(provider);
    if (!s || s.isDisconnecting || !s.browser.isConnected()) return null;
    return {
      provider,
      browser: s.browser,
      context: s.context,
      port: s.port,
      activePage: s.activePage ?? undefined,
      connectedAt: s.lastConnectedAt,
    };
  }

  public isConnected(provider: AutomationProvider): boolean {
    const s = this.sessions.get(provider);
    return !!(s && !s.isDisconnecting && s.browser.isConnected());
  }

  public getBrowser(provider: AutomationProvider): Browser | null {
    const s = this.sessions.get(provider);
    return s && !s.isDisconnecting && s.browser.isConnected() ? s.browser : null;
  }

  public getContext(provider: AutomationProvider): BrowserContext | null {
    const s = this.sessions.get(provider);
    return s && !s.isDisconnecting && s.browser.isConnected() ? s.context : null;
  }

  public getActivePage(provider: AutomationProvider): Page | null {
    const s = this.sessions.get(provider);
    if (!s || s.isDisconnecting || !s.browser.isConnected()) return null;
    return s.activePage;
  }

  /**
   * Executes AI Image/Video generation directly on Google Flow via Playwright CDP session (port 9224).
   * Used when FlowBridgeServer (Extension) is not connected or when direct Playwright automation is configured.
   */
  public async executeFlowGeneration(
    options: FlowGenerationAutomationOptions
  ): Promise<FlowGenerationAutomationResult> {
    const { prompt, projectId, mode, signal } = options;
    const isVideo = mode === 'video';
    const submissionTimeoutMs = options.submissionTimeoutMs || 6000;
    const processingTimeoutMs = options.timeoutMs || (isVideo ? 120000 : 40000);

    if (signal?.aborted) {
      return { ok: false, state: 'TIMED_OUT', error: 'CANCELLED', errorCode: 'UI_AUTOMATION_FAILED' };
    }

    // 1. Ensure connected to provider 'flow' (port 9224)
    let session = this.sessions.get('flow');
    if (!session || session.isDisconnecting || !session.browser.isConnected()) {
      try {
        await this.connect({ provider: 'flow' });
        session = this.sessions.get('flow')!;
      } catch (connErr: any) {
        return {
          ok: false,
          state: 'FAILED',
          error: `Failed to connect Playwright to Chrome on port 9224: ${connErr?.message || connErr}`,
          errorCode: 'UI_AUTOMATION_FAILED',
        };
      }
    }

    // 2. Navigate or discover Flow tab
    const targetUrl = projectId
      ? `https://labs.google/fx/vi/tools/flow/project/${projectId}`
      : 'https://labs.google/fx/vi/tools/flow';

    let page: Page;
    try {
      page = await this.getOrCreateTab('flow', {
        targetUrl,
        predicate: (pageOrUrl, title) => {
          const url = typeof pageOrUrl === 'string' ? pageOrUrl : pageOrUrl.url();
          return url.includes('flow') || (typeof title === 'string' && title.toLowerCase().includes('flow'));
        },
        timeoutMs: 20000,
      });
    } catch (tabErr: any) {
      return {
        ok: false,
        state: 'FAILED',
        error: `Failed to open or route Google Flow tab: ${tabErr?.message || tabErr}`,
        errorCode: 'UI_AUTOMATION_FAILED',
      };
    }

    // 3. Check authentication status / login redirection
    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com') || currentUrl.includes('/signin')) {
      return {
        ok: false,
        state: 'BLOCKED_REQUIRES_USER',
        error: 'GOOGLE_SIGNIN_REQUIRED: Tab đang ở màn hình đăng nhập Google. Người dùng cần đăng nhập trên Chrome.',
        errorCode: 'BLOCKED_REQUIRES_USER',
      };
    }

    // 4. Baseline snapshot (Stage 0)
    const preFlight = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('flow-asset-card, flow-media-tile, mat-card, [data-asset-id], .asset-item'));
      const cardIds = cards.map((c) => c.getAttribute('data-asset-id') || c.getAttribute('data-id') || c.id).filter(Boolean);
      const imgUrls = Array.from(document.querySelectorAll('flow-asset-card img, flow-media-tile img, mat-card img, [data-asset-id] img'))
        .map((im: any) => im.src || im.currentSrc)
        .filter(Boolean);
      const videoUrls: string[] = [];
      document.querySelectorAll('flow-asset-card video, flow-media-tile video, mat-card video, [data-asset-id] video').forEach((v: any) => {
        if (v.src) videoUrls.push(v.src);
        if (v.currentSrc) videoUrls.push(v.currentSrc);
        v.querySelectorAll('source').forEach((s: any) => { if (s.src) videoUrls.push(s.src); });
      });
      return { cardIds, imgUrls, videoUrls, timestamp: Date.now() };
    }).catch(() => ({ cardIds: [], imgUrls: [], videoUrls: [], timestamp: Date.now() }));

    if (signal?.aborted) {
      return { ok: false, state: 'TIMED_OUT', error: 'CANCELLED', errorCode: 'UI_AUTOMATION_FAILED' };
    }

    // 5. Input prompt into ProseMirror editor (Stage 1 Part A)
    const inputResult = await page.evaluate(async ({ promptText, targetMode }) => {
      const promptBox = document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container') || document.body;
      const pm = promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea') as HTMLElement | null;
      if (!pm) return { ok: false, error: 'NO_PROSEMIRROR' };

      pm.focus();
      document.execCommand('selectAll', false, undefined);
      document.execCommand('delete', false, undefined);
      document.execCommand('insertText', false, promptText);
      pm.dispatchEvent(new InputEvent('input', { bubbles: true, data: promptText, inputType: 'insertText' }));
      pm.dispatchEvent(new Event('input', { bubbles: true }));
      pm.dispatchEvent(new Event('change', { bubbles: true }));

      return { ok: true };
    }, { promptText: prompt, targetMode: mode.toUpperCase() }).catch((err) => ({ ok: false, error: err.message }));

    if (!inputResult.ok) {
      return {
        ok: false,
        state: 'FAILED',
        error: inputResult.error || 'Failed to enter prompt into ProseMirror',
        errorCode: 'UI_AUTOMATION_FAILED',
      };
    }

    // 6. Click generate button via Playwright trusted click (Stage 1 Part B)
    const btnSelector = 'flow-generate-icon-button button, button.generate-icon-button, button.submit-button, flow-prompt-box button[type="submit"]';
    try {
      const genBtn = page.locator(btnSelector).first();
      await genBtn.waitFor({ state: 'visible', timeout: 5000 });
      await genBtn.click({ timeout: 4000 });
    } catch {
      await page.evaluate(() => {
        const btn = document.querySelector('flow-generate-icon-button button, button.generate-icon-button, button.submit-button') as HTMLButtonElement | null;
        if (btn) btn.click();
      }).catch(() => {});
    }

    // 7. Verification of submission (< 6s)
    const submissionStartTime = Date.now();
    let submissionConfirmed = false;
    while (Date.now() - submissionStartTime < submissionTimeoutMs) {
      if (signal?.aborted) {
        return { ok: false, state: 'TIMED_OUT', error: 'CANCELLED', errorCode: 'UI_AUTOMATION_FAILED' };
      }
      await new Promise((r) => setTimeout(r, 300));

      const subStatus = await page.evaluate(() => {
        const captchaIframe = document.querySelector('iframe[src*="bframe"], .g-recaptcha-bubble-arrow');
        if (captchaIframe) return { accepted: false, blocked: true };

        const toasts = Array.from(document.querySelectorAll('mat-snack-bar-container, .toast, .error-banner, [role="alert"]'));
        const botToast = toasts.find((t) => {
          const txt = (t.textContent || '').toLowerCase();
          return txt.includes('unusual activity') || txt.includes('bất thường') || txt.includes('blocked');
        });
        if (botToast) return { accepted: false, blocked: true };

        const spinner = !!document.querySelector('mat-progress-spinner, mat-spinner, flow-loading-indicator');
        const pmText = document.querySelector('.ProseMirror')?.textContent?.trim() || '';
        return { accepted: spinner || pmText === '', blocked: false };
      }).catch(() => ({ accepted: false, blocked: false }));

      if (subStatus.blocked) {
        return {
          ok: false,
          state: 'BLOCKED_REQUIRES_USER',
          error: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
          errorCode: 'BLOCKED_REQUIRES_USER',
        };
      }

      if (subStatus.accepted) {
        submissionConfirmed = true;
        break;
      }
    }

    if (!submissionConfirmed) {
      return {
        ok: false,
        state: 'TIMED_OUT',
        error: 'TIMEOUT_SUBMITTING: UI did not acknowledge submission',
        errorCode: 'TIMEOUT_SUBMITTING',
      };
    }

    // 8. Observation Loop (Stage 2 DOM Gallery Delta)
    const procStartTime = Date.now();
    const existingImgs = new Set(preFlight.imgUrls);
    const existingVideos = new Set(preFlight.videoUrls);

    while (Date.now() - procStartTime < processingTimeoutMs) {
      if (signal?.aborted) {
        return { ok: false, state: 'TIMED_OUT', error: 'CANCELLED', errorCode: 'UI_AUTOMATION_FAILED' };
      }
      await new Promise((r) => setTimeout(r, 600));

      const obsResult = await page.evaluate(({ existingImgsArr, existingVideosArr, targetMode }) => {
        const toasts = Array.from(document.querySelectorAll('mat-snack-bar-container, .toast, .error-banner, [role="alert"]'));
        const botToast = toasts.find((t) => {
          const txt = (t.textContent || '').toLowerCase();
          return txt.includes('unusual activity') || txt.includes('bất thường') || txt.includes('blocked');
        });
        if (botToast) return { status: 'BLOCKED_REQUIRES_USER' };

        const isParentGenerating = (el: Element) => {
          const card = el.closest('flow-asset-card, flow-media-tile, mat-card, [data-asset-id], .asset-item');
          if (!card) return false;
          return !!card.querySelector('mat-progress-spinner, mat-spinner, flow-loading-indicator, .loading') || card.classList.contains('generating');
        };

        const existingImgSet = new Set(existingImgsArr);
        const existingVideoSet = new Set(existingVideosArr);

        if (targetMode === 'IMAGE') {
          const imgs = Array.from(document.querySelectorAll('flow-asset-card img, flow-media-tile img, mat-card img, [data-asset-id] img')) as HTMLImageElement[];
          const target = imgs.find((im) => {
            const s = im.src || im.currentSrc || '';
            if (!s || existingImgSet.has(s)) return false;
            const isValid = s.includes('googleusercontent.com') || s.includes('ai-sandbox') || s.startsWith('blob:') || s.startsWith('data:image');
            const isNotIcon = !s.includes('avatar') && !s.includes('icon') && !s.includes('.svg');
            const isDecentSize = (im.naturalWidth >= 200 && im.naturalHeight >= 200) || (im.width >= 180 && im.height >= 180);
            return isValid && isNotIcon && isDecentSize && !isParentGenerating(im);
          });
          if (target) {
            return { status: 'COMPLETED', firstImageUrl: target.src || target.currentSrc };
          }
        } else {
          const videos = Array.from(document.querySelectorAll('flow-asset-card video, flow-media-tile video, mat-card video, [data-asset-id] video')) as HTMLVideoElement[];
          const target = videos.find((v) => {
            const s = v.src || v.currentSrc || v.querySelector('source')?.src || '';
            if (!s || existingVideoSet.has(s)) return false;
            return !isParentGenerating(v);
          });
          if (target) {
            const vUrl = target.src || target.currentSrc || target.querySelector('source')?.src;
            return { status: 'COMPLETED', videoUrl: vUrl };
          }
        }

        return { status: 'PROCESSING' };
      }, {
        existingImgsArr: Array.from(existingImgs),
        existingVideosArr: Array.from(existingVideos),
        targetMode: isVideo ? 'VIDEO' : 'IMAGE',
      }).catch(() => ({ status: 'PROCESSING' as const }));

      if (obsResult.status === 'BLOCKED_REQUIRES_USER') {
        return {
          ok: false,
          state: 'BLOCKED_REQUIRES_USER',
          error: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
          errorCode: 'BLOCKED_REQUIRES_USER',
        };
      }

      if (obsResult.status === 'COMPLETED') {
        return {
          ok: true,
          state: 'COMPLETED',
          jobId: options.jobId,
          sceneId: options.sceneId,
          projectId: options.projectId,
          firstImageUrl: (obsResult as any).firstImageUrl,
          videoUrl: (obsResult as any).videoUrl,
          domFallback: true,
        };
      }
    }

    return {
      ok: false,
      state: 'TIMED_OUT',
      errorCode: 'TIMEOUT_PROCESSING',
      error: `Browser automation timed out after ${processingTimeoutMs / 1000}s`,
    };
  }
}
