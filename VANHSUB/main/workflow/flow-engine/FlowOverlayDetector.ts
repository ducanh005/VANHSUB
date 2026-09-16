/**
 * FlowOverlayDetector: Bộ phát hiện và xử lý Modal, Popup, Overlay và Panel Tác nhân che phủ giao diện
 * Tự động nhận diện các phần tử che chắn (Backdrop, Dialog, Agent Panel, Media Viewer)
 * và cung cấp cơ chế tự động giải phóng (Dismiss via Escape key hoặc click Close button).
 */

export type OverlayType =
  | 'AGENT_PANEL'       // Panel Tác nhân / Creative Agent sidebar
  | 'MODAL_DIALOG'      // Hộp thoại popup / confirmation dialog
  | 'MEDIA_VIEWER'      // Lightbox xem ảnh/video phóng to
  | 'BACKDROP'          // Lớp màn đen che phủ (CDK overlay backdrop)
  | 'GENERIC_OVERLAY';  // Các overlay khác

export interface DetectedOverlay {
  type: OverlayType;
  selector: string;
  elementTag: string;
  className: string;
  ariaLabel?: string;
  dismissSelector?: string;
  canEscape: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

export interface OverlayDetectionResult {
  hasOverlay: boolean;
  overlays: DetectedOverlay[];
  summary: string;
}

export class FlowOverlayDetector {
  /**
   * Quét và phát hiện toàn bộ overlay/modal/panel đang hiển thị trên Google Flow
   */
  static async detect(win: any): Promise<OverlayDetectionResult> {
    if (!win || win.isDestroyed()) {
      return { hasOverlay: false, overlays: [], summary: 'Window unavailable' };
    }

    const scanJs = `
      (function() {
        function isVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        }

        const detected = [];

        // 1. Quét Panel Tác nhân (Creative Agent / Agent Sidebar)
        const agentSelectors = [
          'flow-agent-panel',
          'flow-creative-agent-dialog',
          'flow-agent-confirmation',
          'aside.agent-sidebar',
          'div[class*="agent-panel"]',
          '.agent-drawer'
        ];
        for (const sel of agentSelectors) {
          const el = document.querySelector(sel);
          if (isVisible(el)) {
            const rect = el.getBoundingClientRect();
            // Tìm nút đóng của panel nếu có
            const closeBtn = el.querySelector('button[aria-label*="Đóng" i], button[aria-label*="Close" i], button.close-btn, button.dismiss-btn');
            detected.push({
              type: 'AGENT_PANEL',
              selector: sel,
              elementTag: el.tagName,
              className: el.className || '',
              ariaLabel: el.getAttribute('aria-label') || '',
              dismissSelector: closeBtn ? sel + ' button[aria-label*="Close" i], ' + sel + ' button[aria-label*="Đóng" i], ' + sel + ' .close-btn' : undefined,
              canEscape: true,
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
            });
            break;
          }
        }

        // 2. Quét Modal Dialogs (Angular Material / CDK Dialog / HTML Dialog)
        const dialogSelectors = [
          'mat-dialog-container',
          '[role="dialog"]',
          'flow-dialog',
          '.cdk-overlay-pane:has(mat-dialog-container)',
          '.modal-container',
          'dialog[open]'
        ];
        for (const sel of dialogSelectors) {
          const els = Array.from(document.querySelectorAll(sel)).filter(isVisible);
          for (const el of els) {
            // Bỏ qua prompt box container nếu nó có role="region"
            if (el.tagName.toLowerCase().includes('prompt-box')) continue;
            const rect = el.getBoundingClientRect();
            const closeBtn = el.querySelector('button[aria-label*="Đóng" i], button[aria-label*="Close" i], button.close-button, .mat-mdc-dialog-actions button');
            detected.push({
              type: 'MODAL_DIALOG',
              selector: sel,
              elementTag: el.tagName,
              className: el.className || '',
              ariaLabel: el.getAttribute('aria-label') || '',
              dismissSelector: closeBtn ? sel + ' button' : undefined,
              canEscape: true,
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
            });
          }
        }

        // 3. Quét Media Viewer / Lightbox
        const viewerSelectors = [
          'flow-media-viewer',
          'flow-lightbox',
          '.media-viewer',
          '.lightbox-overlay'
        ];
        for (const sel of viewerSelectors) {
          const el = document.querySelector(sel);
          if (isVisible(el)) {
            const rect = el.getBoundingClientRect();
            detected.push({
              type: 'MEDIA_VIEWER',
              selector: sel,
              elementTag: el.tagName,
              className: el.className || '',
              canEscape: true,
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
            });
          }
        }

        // 4. Quét Backdrop che phủ (Chỉ tính khi có kích thước phủ kín màn hình)
        const backdrops = Array.from(document.querySelectorAll('.cdk-overlay-backdrop-showing, .modal-backdrop, .overlay-backdrop')).filter(isVisible);
        for (const bd of backdrops) {
          const rect = bd.getBoundingClientRect();
          if (rect.width > 200 && rect.height > 200) {
            detected.push({
              type: 'BACKDROP',
              selector: '.cdk-overlay-backdrop-showing',
              elementTag: bd.tagName,
              className: bd.className || '',
              canEscape: true,
              rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
            });
            break;
          }
        }

        return detected;
      })()
    `;

    const overlays: DetectedOverlay[] = (await win.webContents.executeJavaScript(scanJs, true).catch(() => [])) || [];
    const hasOverlay = overlays.length > 0;
    const summary = hasOverlay
      ? `Phát hiện ${overlays.length} overlay che phủ: [${overlays.map((o) => o.type).join(', ')}]`
      : 'Không có overlay nào che phủ';

    return {
      hasOverlay,
      overlays,
      summary,
    };
  }

  /**
   * Tự động giải phóng (Dismiss) overlay bằng phím Escape hoặc click nút đóng
   */
  static async dismiss(win: any, overlay?: DetectedOverlay): Promise<boolean> {
    if (!win || win.isDestroyed()) return false;

    // Bước 1: Thử gửi phím Escape hệ điều hành (Native Keyboard Event)
    try {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await new Promise((r) => setTimeout(r, 200));

      // Kiểm tra lại xem overlay đã biến mất chưa
      const check1 = await this.detect(win);
      if (!check1.hasOverlay) {
        return true;
      }
    } catch (e) {}

    // Bước 2: Nếu có dismissSelector hoặc nút đóng trong dialog, click chuột trực tiếp
    const clickCloseJs = `
      (function() {
        const closeBtns = Array.from(document.querySelectorAll(
          'button[aria-label*="Đóng" i], button[aria-label*="Close" i], button[aria-label*="Dismiss" i], .close-button, .close-btn, .mat-mdc-dialog-actions button, flow-agent-panel button.dismiss-btn'
        ));
        for (const btn of closeBtns) {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            btn.click();
            return true;
          }
        }
        return false;
      })()
    `;
    await win.webContents.executeJavaScript(clickCloseJs, true).catch(() => false);
    await new Promise((r) => setTimeout(r, 250));

    // Bước 3: Thử click backdrop nếu có
    const clickBackdropJs = `
      (function() {
        const bd = document.querySelector('.cdk-overlay-backdrop-showing, .modal-backdrop, .overlay-backdrop');
        if (bd) {
          bd.click();
          return true;
        }
        return false;
      })()
    `;
    await win.webContents.executeJavaScript(clickBackdropJs, true).catch(() => false);
    await new Promise((r) => setTimeout(r, 200));

    // Bước 4: Gửi Escape lần 2 để chắc chắn
    try {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await new Promise((r) => setTimeout(r, 150));
    } catch (e) {}

    const finalCheck = await this.detect(win);
    return !finalCheck.hasOverlay;
  }
}
