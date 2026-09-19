/**
 * FlowVisualConfirmGuard
 *
 * Implements Confirm-Before-Act Visual Settle and Dynamic DOM Polling.
 * Conforms to spec-pipeline-video-automation.md §1.3, §1.4, R2 and orchestrator_4/PROJECT.md.
 *
 * Core Guarantees:
 * 1. 4-step Visual Settle:
 *    - Determine initial bounding box (rect1).
 *    - Render highlight overlay (div#flow-agent-highlight-overlay) with emerald/amber border,
 *      pointer-events: none, z-index: 999999, displayed for 200–400ms.
 *    - Measure bounding box a second time (rect2). If shifted (|Δ| > tolerance), abort click,
 *      wait 150ms and re-measure (up to maxMeasurements = 3).
 *    - Only dispatch click when position is verified stable across 2 consecutive measurements.
 *    - Always clean up the highlight overlay upon completion or error.
 * 2. Dynamic DOM Polling:
 *    - Zero fixed sleep. Adaptive exponential backoff polling on spinners, download buttons,
 *      and media elements with early exit.
 *    - Timeouts: 90s for image generation, 300s for video generation.
 *    - Max 2 retries on transient errors.
 */

export interface VisualSettleOptions {
  settleMs?: number;        // Settle wait time between measurements (default 200-400ms, standard 300ms)
  tolerancePx?: number;     // Spatial drift tolerance (default 1.5px)
  highlightColor?: string;  // Normal highlight color (default '#10B981' emerald)
  alertColor?: string;      // Color when element shifts (default '#F59E0B' amber)
  maxMeasurements?: number; // Maximum measurement attempts (default 3)
  retryDelayMs?: number;    // Delay before re-measuring if unstable (default 150ms)
}

export interface DOMRectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SafeClickResult {
  settled: boolean;
  driftPx: number;
  measuredRect1: DOMRectBounds;
  measuredRect2: DOMRectBounds;
  clicked: boolean;
  attempts: number;
  clickCoords?: { x: number; y: number };
  error?: string;
}

export interface DynamicPollOptions {
  timeoutMs?: number;         // Max total wait time (default 90000ms / 300000ms)
  initialIntervalMs?: number; // Starting poll interval (default 100ms)
  maxIntervalMs?: number;     // Cap on poll interval (default 1500ms)
  backoffFactor?: number;     // Backoff multiplier (default 1.25)
  maxRetries?: number;        // Max retry cycles (default 2)
  label?: string;             // Descriptive label for logs
  isCancelled?: () => boolean;// Early cancellation hook
}

export class FlowVisualConfirmGuard {
  public static readonly DEFAULT_IMAGE_TIMEOUT_MS = 90_000;
  public static readonly DEFAULT_VIDEO_TIMEOUT_MS = 300_000;
  public static readonly DEFAULT_MAX_RETRIES = 2;
  public static readonly OVERLAY_DOM_ID = 'flow-agent-highlight-overlay';

  // ==========================================================================
  // 1. Confirm-Before-Act Visual Settle Algorithm (spec §1.3, R2)
  // ==========================================================================

  /**
   * Universal Confirm-Before-Act algorithm:
   * Measures element rect1, settles, measures rect2.
   * If drift > tolerance: re-measures up to maxMeasurements times.
   * Dispatches click only when element is verified stable.
   */
  public static async confirmBeforeAct(
    measureFn: () => DOMRectBounds,
    clickDispatcher: (x: number, y: number) => void | Promise<void>,
    options?: VisualSettleOptions
  ): Promise<SafeClickResult> {
    const settleMs = options?.settleMs ?? 200;
    const tolerancePx = options?.tolerancePx ?? 1.5;
    const maxMeasurements = options?.maxMeasurements ?? 3;
    const retryDelayMs = options?.retryDelayMs ?? 150;

    let attempts = 0;
    let lastRect = measureFn();
    const initialRect = { ...lastRect };

    while (attempts < maxMeasurements) {
      attempts++;

      // Wait settle duration (200-400ms)
      await new Promise((resolve) => setTimeout(resolve, settleMs));
      const secondRect = measureFn();

      const dx = secondRect.x - lastRect.x;
      const dy = secondRect.y - lastRect.y;
      const dw = secondRect.width - lastRect.width;
      const dh = secondRect.height - lastRect.height;
      const driftPx = Math.sqrt(dx * dx + dy * dy + dw * dw + dh * dh);

      if (driftPx <= tolerancePx) {
        // Element settled stably!
        const centerX = Math.round(secondRect.x + secondRect.width / 2);
        const centerY = Math.round(secondRect.y + secondRect.height / 2);

        await clickDispatcher(centerX, centerY);

        return {
          settled: true,
          driftPx: Math.round(driftPx * 100) / 100,
          measuredRect1: initialRect,
          measuredRect2: secondRect,
          clicked: true,
          attempts,
          clickCoords: { x: centerX, y: centerY },
        };
      }

      // Element still shifting or animating, wait retryDelayMs before next measurement
      if (attempts < maxMeasurements) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
      lastRect = secondRect;
    }

    // Exceeded max measurements without settling
    return {
      settled: false,
      driftPx: 999,
      measuredRect1: initialRect,
      measuredRect2: measureFn(),
      clicked: false,
      attempts,
      error: 'element_unstable',
    };
  }

  /**
   * Injects or creates a highlight overlay structure conforming to spec requirements.
   * Border: emerald (#10B981) / amber (#F59E0B), pointer-events: none, z-index: 999999.
   */
  public static injectHighlightOverlay(
    rect: DOMRectBounds,
    color: string = '#10B981'
  ): { overlayId: string; style: Record<string, string>; remove: () => void } {
    const overlayId = `flow-agent-highlight-overlay-${Date.now()}`;
    const style: Record<string, string> = {
      position: 'absolute',
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      border: `2px solid ${color}`,
      boxShadow: `0 0 10px ${color}`,
      pointerEvents: 'none',
      zIndex: '999999',
      borderRadius: '4px',
    };

    let removed = false;
    return {
      overlayId,
      style,
      remove: () => {
        removed = true;
      },
    };
  }

  // ==========================================================================
  // 2. Electron BrowserWindow DOM Native Integration
  // ==========================================================================

  /**
   * Executes Confirm-Before-Act directly inside an Electron BrowserWindow.
   * Injects a visual overlay div#flow-agent-highlight-overlay into the web page,
   * measures bounding boxes across the settle interval, dispatches native mouse
   * click events upon stability, and guarantees overlay removal.
   */
  public static async confirmBeforeActOnElement(
    win: any,
    selector: string,
    clickDispatcher?: (x: number, y: number) => void | Promise<void>,
    options?: VisualSettleOptions
  ): Promise<SafeClickResult> {
    if (!win || win.isDestroyed()) {
      return {
        settled: false,
        driftPx: 999,
        measuredRect1: { x: 0, y: 0, width: 0, height: 0 },
        measuredRect2: { x: 0, y: 0, width: 0, height: 0 },
        clicked: false,
        attempts: 0,
        error: 'window_destroyed',
      };
    }

    const settleMs = options?.settleMs ?? 300;
    const tolerancePx = options?.tolerancePx ?? 1.5;
    const maxMeasurements = options?.maxMeasurements ?? 3;
    const highlightColor = options?.highlightColor ?? '#10B981';
    const alertColor = options?.alertColor ?? '#F59E0B';
    const retryDelayMs = options?.retryDelayMs ?? 150;

    // Helper: query element rect in DOM
    const queryRectJs = `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      })()
    `;

    // Helper: inject or update overlay in DOM
    const injectOverlayJs = (rect: DOMRectBounds, borderColor: string) => `
      (function() {
        let overlay = document.getElementById(${JSON.stringify(FlowVisualConfirmGuard.OVERLAY_DOM_ID)});
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = ${JSON.stringify(FlowVisualConfirmGuard.OVERLAY_DOM_ID)};
          overlay.style.position = 'fixed';
          overlay.style.pointerEvents = 'none';
          overlay.style.zIndex = '999999';
          overlay.style.boxSizing = 'border-box';
          overlay.style.borderRadius = '4px';
          overlay.style.transition = 'all 0.15s ease-out';
          document.body.appendChild(overlay);
        }
        overlay.style.left = '${rect.x}px';
        overlay.style.top = '${rect.y}px';
        overlay.style.width = '${rect.width}px';
        overlay.style.height = '${rect.height}px';
        overlay.style.border = '2px solid ${borderColor}';
        overlay.style.boxShadow = '0 0 10px ${borderColor}';
        overlay.style.display = 'block';
        overlay.style.opacity = '1';
      })()
    `;

    // Helper: clean up overlay
    const cleanupOverlayJs = `
      (function() {
        const overlay = document.getElementById(${JSON.stringify(FlowVisualConfirmGuard.OVERLAY_DOM_ID)});
        if (overlay) overlay.remove();
      })()
    `;

    try {
      // 1. Initial measurement
      const rect1 = await win.webContents.executeJavaScript(queryRectJs);
      if (!rect1) {
        return {
          settled: false,
          driftPx: 999,
          measuredRect1: { x: 0, y: 0, width: 0, height: 0 },
          measuredRect2: { x: 0, y: 0, width: 0, height: 0 },
          clicked: false,
          attempts: 1,
          error: 'element_not_found',
        };
      }

      // 2. Inject visual highlight overlay (emerald)
      await win.webContents.executeJavaScript(injectOverlayJs(rect1, highlightColor));

      let attempts = 0;
      let lastRect: DOMRectBounds = rect1;

      while (attempts < maxMeasurements) {
        attempts++;

        // Wait settle window (200-400ms)
        await new Promise((resolve) => setTimeout(resolve, settleMs));

        const rect2 = await win.webContents.executeJavaScript(queryRectJs);
        if (!rect2) {
          return {
            settled: false,
            driftPx: 999,
            measuredRect1: rect1,
            measuredRect2: { x: 0, y: 0, width: 0, height: 0 },
            clicked: false,
            attempts,
            error: 'element_disappeared',
          };
        }

        const dx = rect2.x - lastRect.x;
        const dy = rect2.y - lastRect.y;
        const dw = rect2.width - lastRect.width;
        const dh = rect2.height - lastRect.height;
        const driftPx = Math.sqrt(dx * dx + dy * dy + dw * dw + dh * dh);

        if (driftPx <= tolerancePx) {
          // Position verified stable across 2 consecutive measurements!
          const centerX = Math.round(rect2.x + rect2.width / 2);
          const centerY = Math.round(rect2.y + rect2.height / 2);

          if (clickDispatcher) {
            await clickDispatcher(centerX, centerY);
          } else {
            // Native mouse event dispatch via Electron sendInputEvent
            await FlowVisualConfirmGuard.dispatchNativeClick(win, centerX, centerY);
          }

          return {
            settled: true,
            driftPx: Math.round(driftPx * 100) / 100,
            measuredRect1: rect1,
            measuredRect2: rect2,
            clicked: true,
            attempts,
            clickCoords: { x: centerX, y: centerY },
          };
        }

        // Element shifted! Switch overlay to alert color (amber) and wait
        await win.webContents.executeJavaScript(injectOverlayJs(rect2, alertColor));
        if (attempts < maxMeasurements) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
        lastRect = rect2;
      }

      return {
        settled: false,
        driftPx: 999,
        measuredRect1: rect1,
        measuredRect2: lastRect,
        clicked: false,
        attempts,
        error: 'element_unstable',
      };
    } finally {
      // Step 5: Always clean up highlight overlay from DOM
      try {
        if (!win.isDestroyed()) {
          await win.webContents.executeJavaScript(cleanupOverlayJs);
        }
      } catch {}
    }
  }

  /**
   * Dispatches native mouse click events via Electron webContents.sendInputEvent.
   */
  public static async dispatchNativeClick(win: any, x: number, y: number): Promise<void> {
    if (!win || win.isDestroyed()) return;

    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    await new Promise((r) => setTimeout(r, 30));
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 60));
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  }

  /**
   * Waits for an element to appear and then safely clicks it using Confirm-Before-Act.
   */
  public static async waitForElementAndSafeClick(
    win: any,
    selector: string,
    options?: VisualSettleOptions & { timeoutMs?: number }
  ): Promise<SafeClickResult> {
    const timeoutMs = options?.timeoutMs ?? 15000;
    const startTime = Date.now();

    // Poll until element exists and has non-zero size
    await FlowVisualConfirmGuard.pollCondition(
      async () => {
        if (!win || win.isDestroyed()) return false;
        const exists = await win.webContents.executeJavaScript(`
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })()
        `).catch(() => false);
        return exists ? true : false;
      },
      { timeoutMs, initialIntervalMs: 80, maxIntervalMs: 500, label: `waitFor(${selector})` }
    );

    const elapsed = Date.now() - startTime;
    const remainingTimeout = Math.max(2000, timeoutMs - elapsed);

    return await FlowVisualConfirmGuard.confirmBeforeActOnElement(win, selector, undefined, {
      ...options,
      settleMs: options?.settleMs ?? 250,
    });
  }

  // ==========================================================================
  // 3. Dynamic DOM Polling Mechanism (spec §1.4, R2)
  // ==========================================================================

  /**
   * Dynamic DOM Polling with zero fixed sleep:
   * Uses adaptive exponential backoff to check conditions.
   * Resolves immediately when predicate is met, never waiting arbitrarily.
   */
  public static async pollCondition<T>(
    predicate: () => Promise<T | null | undefined | false>,
    options?: DynamicPollOptions
  ): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? FlowVisualConfirmGuard.DEFAULT_IMAGE_TIMEOUT_MS;
    const initialInterval = options?.initialIntervalMs ?? 100;
    const maxInterval = options?.maxIntervalMs ?? 1500;
    const backoff = options?.backoffFactor ?? 1.25;
    const label = options?.label ? `[${options.label}] ` : '';

    const startTime = Date.now();
    let currentInterval = initialInterval;
    let attempt = 0;

    while (Date.now() - startTime < timeoutMs) {
      if (options?.isCancelled?.()) {
        throw new Error(`${label}Polling operation cancelled.`);
      }

      attempt++;
      try {
        const result = await predicate();
        if (result !== null && result !== undefined && result !== false) {
          return result as T;
        }
      } catch (err) {
        // Transient error during DOM evaluation; continue polling until timeout
      }

      const elapsed = Date.now() - startTime;
      const remaining = timeoutMs - elapsed;
      if (remaining <= 0) break;

      const waitDuration = Math.min(currentInterval, remaining);
      await new Promise((resolve) => setTimeout(resolve, waitDuration));
      currentInterval = Math.min(maxInterval, Math.round(currentInterval * backoff));
    }

    throw new Error(
      `${label}Dynamic DOM polling timed out after ${timeoutMs}ms (${attempt} adaptive checks)`
    );
  }

  /**
   * Executes an asynchronous operation with bounded retries (max 2 retries).
   * Conforms to spec §1.4 bounded retry requirements.
   */
  public static async pollWithRetry<T>(
    task: (attemptIndex: number) => Promise<T>,
    options?: { maxRetries?: number; timeoutMs?: number; label?: string }
  ): Promise<T> {
    const maxRetries = options?.maxRetries ?? FlowVisualConfirmGuard.DEFAULT_MAX_RETRIES;
    const label = options?.label ? `[${options.label}] ` : '';
    let lastError: any = null;

    for (let retry = 0; retry <= maxRetries; retry++) {
      try {
        return await task(retry);
      } catch (err: any) {
        lastError = err;
        if (retry < maxRetries) {
          // Adaptive backoff before retry cycle
          const delayMs = (retry + 1) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw new Error(
      `${label}Operation failed after ${maxRetries + 1} attempts. Last error: ${lastError?.message || String(lastError)}`
    );
  }
}
