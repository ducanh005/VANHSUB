/**
 * FlowSmartWait: Bộ công cụ chờ thông minh và kiểm tra tính ổn định giao diện
 * - Thay thế hoàn toàn các lệnh sleep(Nms) tĩnh bằng adaptive polling.
 * - Thoát sớm ngay khi điều kiện đạt (Zero Wasted Time).
 * - Kiểm tra độ ổn định bounding box (Element Stability) chống click khi animation đang chạy.
 * - Kiểm tra che phủ (Element Unobscured) qua document.elementFromPoint().
 */

export interface PollOptions {
  timeoutMs?: number;
  initialIntervalMs?: number;
  maxIntervalMs?: number;
  backoffFactor?: number;
  isCancelled?: () => boolean;
  tag?: string;
}

export interface StabilityOptions {
  stabilityMs?: number;
  timeoutMs?: number;
  tolerancePx?: number;
  checkIntervalMs?: number;
  containerSelector?: string;
}

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
}

export interface StabilityResult {
  stable: boolean;
  rect: ElementRect | null;
  deltas: {
    dx: number;
    dy: number;
    dw: number;
    dh: number;
  };
  durationMs: number;
  checksCount: number;
  error?: string;
}

export class FlowSmartWait {
  /**
   * Chờ có điều kiện với chu kỳ thích ứng (Adaptive Exponential Backoff Polling)
   * Thoát ngay khi điều kiện thoả mãn, tránh sleep cứng.
   */
  static async pollUntil<T>(
    fn: () => Promise<T | null | undefined | false>,
    options?: PollOptions
  ): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? 10000;
    const initialInterval = options?.initialIntervalMs ?? 100;
    const maxInterval = options?.maxIntervalMs ?? 1000;
    const backoff = options?.backoffFactor ?? 1.3;
    const tag = options?.tag ? `[${options.tag}] ` : '';

    const startTime = Date.now();
    let currentInterval = initialInterval;
    let attempt = 0;

    while (Date.now() - startTime < timeoutMs) {
      if (options?.isCancelled?.()) {
        throw new Error(`${tag}Thao tác chờ đã bị huỷ.`);
      }

      attempt++;
      try {
        const result = await fn();
        if (result !== null && result !== undefined && result !== false) {
          const elapsed = Date.now() - startTime;
          return result as T;
        }
      } catch (err: any) {
        // Cho phép thử lại nếu điều kiện quăng lỗi tạm thời trong lúc render
      }

      const elapsed = Date.now() - startTime;
      const remaining = timeoutMs - elapsed;
      if (remaining <= 0) break;

      const waitTime = Math.min(currentInterval, remaining);
      await new Promise((r) => setTimeout(r, waitTime));
      currentInterval = Math.min(maxInterval, Math.round(currentInterval * backoff));
    }

    throw new Error(
      `${tag}Quá thời gian chờ điều kiện (${timeoutMs}ms) sau ${attempt} lần kiểm tra thích ứng.`
    );
  }

  /**
   * Thực thi an toàn đoạn mã JS trong BrowserWindow và timeout bảo vệ
   */
  private static async safeExecuteJs<T>(
    win: any,
    code: string,
    timeoutMs = 2500
  ): Promise<T | null> {
    if (!win || win.isDestroyed()) return null;
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        win.webContents.executeJavaScript(code, true),
        new Promise<null>((_, reject) => {
          timer = setTimeout(() => reject(new Error('executeJavaScript timeout')), timeoutMs);
        }),
      ]);
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Kiểm tra xem phần tử có tồn tại và hiển thị trong DOM hay không
   */
  static async waitForVisible(
    win: any,
    selector: string,
    timeoutMs = 8000
  ): Promise<ElementRect> {
    const checkJs = `
      (function() {
        const el = document.querySelector(\`${selector}\`);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return null;
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          left: Math.round(rect.left)
        };
      })()
    `;

    return await this.pollUntil<ElementRect>(
      async () => {
        return await this.safeExecuteJs<ElementRect>(win, checkJs, 1500);
      },
      {
        timeoutMs,
        initialIntervalMs: 60,
        maxIntervalMs: 500,
        tag: `waitForVisible(${selector.slice(0, 35)})`,
      }
    );
  }

  /**
   * BẮT BUỘC TRƯỚC CLICK: Đo độ ổn định toạ độ (Bounding Box Stability)
   * Đảm bảo phần tử không bị trôi do layout shift, CSS transition hoặc scroll
   */
  static async waitForElementStable(
    win: any,
    selector: string,
    options?: StabilityOptions
  ): Promise<StabilityResult> {
    const timeoutMs = options?.timeoutMs ?? 7000;
    const stabilityMs = options?.stabilityMs ?? 200;
    const tolerance = options?.tolerancePx ?? 1;
    const checkInterval = options?.checkIntervalMs ?? 60;
    const cSel = options?.containerSelector || null;

    const measureJs = `
      (function() {
        let root = document;
        const cSel = ${JSON.stringify(cSel)};
        if (cSel) {
          const cont = document.querySelector(cSel);
          if (cont) root = cont;
        }
        let el = null;
        const sel = ${JSON.stringify(selector)};
        if (sel.startsWith('text:')) {
          const targetText = sel.slice(5).trim().toLowerCase();
          const candidates = Array.from(root.querySelectorAll('button, a, div, span, [role="button"], mat-option, [role="option"], mat-button-toggle, .mat-button-toggle-button'));
          el = candidates.find(e => {
            const txt = (e.innerText || e.textContent || '').trim().toLowerCase();
            return txt.includes(targetText);
          });
        } else {
          try {
            el = root.querySelector(sel);
          } catch {
            el = null;
          }
        }
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        };
      })()
    `;

    const startTime = Date.now();
    let lastRect: ElementRect | null = null;
    let stableSince = 0;
    let checksCount = 0;
    let maxDeltas = { dx: 0, dy: 0, dw: 0, dh: 0 };

    while (Date.now() - startTime < timeoutMs) {
      if (!win || win.isDestroyed()) {
        return { stable: false, rect: null, deltas: maxDeltas, durationMs: Date.now() - startTime, checksCount, error: 'window_destroyed' };
      }

      checksCount++;
      const currentRect = await this.safeExecuteJs<ElementRect>(win, measureJs, 1000);

      if (!currentRect) {
        lastRect = null;
        stableSince = 0;
        await new Promise((r) => setTimeout(r, checkInterval));
        continue;
      }

      if (!lastRect) {
        lastRect = currentRect;
        stableSince = Date.now();
      } else {
        const dx = Math.abs(currentRect.x - lastRect.x);
        const dy = Math.abs(currentRect.y - lastRect.y);
        const dw = Math.abs(currentRect.width - lastRect.width);
        const dh = Math.abs(currentRect.height - lastRect.height);

        maxDeltas = {
          dx: Math.max(maxDeltas.dx, dx),
          dy: Math.max(maxDeltas.dy, dy),
          dw: Math.max(maxDeltas.dw, dw),
          dh: Math.max(maxDeltas.dh, dh),
        };

        if (dx <= tolerance && dy <= tolerance && dw <= tolerance && dh <= tolerance) {
          // Toạ độ giữ nguyên
          if (Date.now() - stableSince >= stabilityMs) {
            return {
              stable: true,
              rect: {
                x: Math.round(currentRect.x),
                y: Math.round(currentRect.y),
                width: Math.round(currentRect.width),
                height: Math.round(currentRect.height),
              },
              deltas: maxDeltas,
              durationMs: Date.now() - startTime,
              checksCount,
            };
          }
        } else {
          // Bounding box đang di chuyển / co giãn (transition / animation)
          lastRect = currentRect;
          stableSince = Date.now();
        }
      }

      await new Promise((r) => setTimeout(r, checkInterval));
    }

    return {
      stable: false,
      rect: lastRect ? {
        x: Math.round(lastRect.x),
        y: Math.round(lastRect.y),
        width: Math.round(lastRect.width),
        height: Math.round(lastRect.height),
      } : null,
      deltas: maxDeltas,
      durationMs: Date.now() - startTime,
      checksCount,
      error: 'stability_timeout',
    };
  }

  /**
   * Kiểm tra che phủ (Element Unobscured):
   * Dùng document.elementFromPoint(x, y) để kiểm tra xem điểm click chuột
   * có thực sự chạm vào phần tử mục tiêu hay bị backdrop, modal, tooltip chắn ngang.
   */
  static async checkElementUnobscured(
    win: any,
    targetCoords: { x: number; y: number },
    targetSelector?: string,
    containerSelector?: string
  ): Promise<{ unobscured: boolean; topElementTag?: string; topElementClass?: string; isSelfOrDescendant: boolean }> {
    const checkJs = `
      (function() {
        let root = document;
        const cSel = ${JSON.stringify(containerSelector || null)};
        if (cSel) {
          const cont = document.querySelector(cSel);
          if (cont) root = cont;
        }
        let targetEl = null;
        const sel = ${JSON.stringify(targetSelector || '')};
        if (sel) {
          try {
            if (sel.startsWith('text:')) {
              const targetText = sel.slice(5).trim().toLowerCase();
              const candidates = Array.from(root.querySelectorAll('button, a, div, span, [role="button"], mat-option, [role="option"], mat-button-toggle, .mat-button-toggle-button'));
              targetEl = candidates.find(e => {
                const txt = (e.innerText || e.textContent || '').trim().toLowerCase();
                return txt.includes(targetText);
              });
            } else {
              targetEl = root.querySelector(sel);
            }
            if (targetEl && typeof targetEl.scrollIntoView === 'function') {
              targetEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
          } catch {}
        }

        let x = ${targetCoords.x};
        let y = ${targetCoords.y};

        if (targetEl) {
          const r = targetEl.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            x = Math.round(r.x + r.width / 2);
            y = Math.round(r.y + r.height / 2);
          }
        }

        // Đảm bảo toạ độ nằm trong ranh giới hiển thị của viewport
        const clampedX = Math.max(2, Math.min(window.innerWidth - 2, x));
        const clampedY = Math.max(2, Math.min(window.innerHeight - 2, y));

        const topEl = document.elementFromPoint(clampedX, clampedY);
        if (!topEl) return { unobscured: false, isSelfOrDescendant: false, topElementTag: 'none' };

        let isSelfOrDescendant = false;
        if (targetEl) {
          isSelfOrDescendant = (targetEl === topEl) || targetEl.contains(topEl) || topEl.contains(targetEl);
        } else {
          isSelfOrDescendant = true;
        }

        // Kiểm tra các phần tử backdrop/overlay che phủ (Google CDK, modal, drawer, backdrop)
        const isBackdrop = topEl.classList.contains('cdk-overlay-backdrop') ||
          topEl.classList.contains('modal-backdrop') ||
          topEl.classList.contains('fake-agent-modal-backdrop') ||
          topEl.tagName === 'MAT-DIALOG-CONTAINER' ||
          topEl.id === 'test-fake-modal-backdrop';

        return {
          unobscured: isSelfOrDescendant && !isBackdrop,
          isSelfOrDescendant,
          topElementTag: topEl.tagName,
          topElementClass: (topEl.className || '').slice(0, 50)
        };
      })()
    `;

    const res = await this.safeExecuteJs<any>(win, checkJs, 1500);
    return {
      unobscured: Boolean(res?.unobscured),
      isSelfOrDescendant: Boolean(res?.isSelfOrDescendant),
      topElementTag: res?.topElementTag || 'unknown',
      topElementClass: res?.topElementClass || '',
    };
  }
}
