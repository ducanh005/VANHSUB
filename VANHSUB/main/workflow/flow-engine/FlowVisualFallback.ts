/**
 * FlowVisualFallback: Cơ chế tìm kiếm phần tử cứu cánh thông qua neo hình học tương đối (Geometric / Visual Anchor)
 * 
 * NGUYÊN LÝ HOẠT ĐỘNG:
 * 1. Khi Google Flow thay đổi hash class ngẫu nhiên hoặc obfuscate hoàn toàn cấu trúc DOM:
 *    Các bộ chọn Tầng 1-4 (Accessibility, Strict Component, Contextual, Text) có thể thất bại.
 * 2. Giao diện người dùng vẫn giữ nguyên bố cục hình học tương đối (Relative Spatial Geometry):
 *    - Nút Generate luôn nằm ở mép phải của Prompt Box (~95% chiều ngang, ~50% chiều cao).
 *    - Ô nhập Prompt nằm ở vùng trung tâm bên trái Prompt Box (~35% chiều ngang, ~45% chiều cao).
 *    - Nút New Project nằm ở thanh header trên cùng góc phải (~90% chiều ngang).
 * 3. Thăm dò bằng document.elementFromPoint(x, y) tại toạ độ tương đối được tính toán:
 *    - Neo theo container cha (nếu có) hoặc viewport toàn màn hình.
 *    - Leo ngược DOM tree (Climbing) để bắt đúng phần tử tương tác thực thụ (button, contenteditable, input, dropdown).
 *    - Chấm điểm tin cậy chuẩn hóa (Confidence Score: 65 - 80).
 *    - Gán thuộc tính neo tạm thời [data-flow-anchor] để bảo đảm tính ổn định khi kiểm tra stability và unobscured.
 *    - Tìm cách suy diễn selector tự nhiên (natural CSS selector) để nạp vào Selector Memory nếu khả thi.
 */

import { ElementRect } from './FlowSmartWait';
import type { CandidateResult } from './FlowElementFinder';

export interface GeometricAnchorSpec {
  containerSelector?: string; // CSS selector của container cha (ví dụ 'flow-prompt-box', 'header')
  relativeX: number;          // 0.0 -> 1.0 (ví dụ 0.95 = 95% chiều rộng tính từ trái sang phải)
  relativeY: number;          // 0.0 -> 1.0 (ví dụ 0.50 = 50% chiều cao tính từ trên xuống dưới)
  offsetPx?: { x?: number; y?: number }; // Độ dịch chuyển pixel cố định nếu cần
  expectedTagNames?: string[]; // Danh sách tag mong đợi: ['BUTTON', 'MAT-ICON', 'DIV', 'A', 'INPUT', 'TEXTAREA']
  interactiveRole?: 'button' | 'input' | 'dropdown' | 'any'; // Ưu tiên phần tử tương tác khi leo DOM tree
  baseConfidence?: number;     // Điểm tin cậy cơ bản (mặc định 70)
  description?: string;        // Mô tả ngữ nghĩa (ví dụ 'Nút Generate ở góc phải prompt box')
}

export interface VisualAnchorResult {
  candidate: CandidateResult;
  pointTested: { x: number; y: number };
  containerRect: ElementRect;
  derivedSelector?: string;
}

export class FlowVisualFallback {
  /**
   * Tính toán toạ độ pixel tuyệt đối từ thông số neo hình học tương đối và khung tham chiếu
   */
  public static computeAbsoluteCoordinates(
    containerRect: ElementRect,
    spec: { relativeX: number; relativeY: number; offsetPx?: { x?: number; y?: number } }
  ): { x: number; y: number } {
    const offX = spec.offsetPx?.x ?? 0;
    const offY = spec.offsetPx?.y ?? 0;
    const originX = containerRect.left ?? containerRect.x;
    const originY = containerRect.top ?? containerRect.y;
    return {
      x: Math.round(originX + containerRect.width * spec.relativeX + offX),
      y: Math.round(originY + containerRect.height * spec.relativeY + offY),
    };
  }

  /**
   * Lấy Bounding Box của container cha hoặc fallback về Viewport
   */
  public static async getContainerRect(
    win: any,
    containerSelector?: string
  ): Promise<ElementRect | null> {
    if (!win || !win.webContents) return null;

    const js = `
      (function() {
        function isVisible(el) {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          if (!r || r.width <= 0 || r.height <= 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        }

        try {
          const cSel = ${JSON.stringify(containerSelector || null)};
          if (cSel) {
            const containerEl = document.querySelector(cSel);
            if (containerEl && isVisible(containerEl)) {
              const r = containerEl.getBoundingClientRect();
              return {
                x: Math.round(r.x),
                y: Math.round(r.y),
                width: Math.round(r.width),
                height: Math.round(r.height),
                top: Math.round(r.top),
                left: Math.round(r.left)
              };
            }
          }
          return {
            x: 0,
            y: 0,
            width: window.innerWidth,
            height: window.innerHeight,
            top: 0,
            left: 0
          };
        } catch {
          return null;
        }
      })()
    `;

    return await win.webContents.executeJavaScript(js, true).catch(() => null);
  }

  /**
   * Thăm dò và giải quyết phần tử tại toạ độ neo hình học
   */
  public static async resolveAnchor(
    win: any,
    spec: GeometricAnchorSpec
  ): Promise<CandidateResult | null> {
    if (!win || !win.webContents) return null;

    const probeJs = `
      (function() {
        function isVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        }

        try {
          // 1. Xác định khung tham chiếu (Reference Container)
          let contRect = null;
          const cSel = ${JSON.stringify(spec.containerSelector || null)};
          if (cSel) {
            const containerEl = document.querySelector(cSel);
            if (containerEl && isVisible(containerEl)) {
              const r = containerEl.getBoundingClientRect();
              contRect = {
                x: Math.round(r.x),
                y: Math.round(r.y),
                width: Math.round(r.width),
                height: Math.round(r.height),
                top: Math.round(r.top),
                left: Math.round(r.left)
              };
            }
          }

          // Fallback khung tham chiếu về viewport nếu không tìm thấy containerSelector
          if (!contRect) {
            contRect = {
              x: 0,
              y: 0,
              width: window.innerWidth,
              height: window.innerHeight,
              top: 0,
              left: 0
            };
          }

          // 2. Tính toán toạ độ neo tương đối
          const relX = ${Number(spec.relativeX)};
          const relY = ${Number(spec.relativeY)};
          const offX = ${Number(spec.offsetPx?.x || 0)};
          const offY = ${Number(spec.offsetPx?.y || 0)};

          let pointX = contRect.left + (contRect.width * relX) + offX;
          let pointY = contRect.top + (contRect.height * relY) + offY;

          // Giới hạn trong viewport an toàn
          pointX = Math.max(2, Math.min(window.innerWidth - 2, Math.round(pointX)));
          pointY = Math.max(2, Math.min(window.innerHeight - 2, Math.round(pointY)));

          // 3. Thăm dò phần tử tại toạ độ neo bằng elementFromPoint
          let rawEl = document.elementFromPoint(pointX, pointY);
          if (!rawEl) return null;

          // 4. Leo ngược cây DOM (DOM climbing) để tìm phần tử tương tác phù hợp
          const role = ${JSON.stringify(spec.interactiveRole || 'any')};
          const expectedTags = ${JSON.stringify(spec.expectedTagNames || [])}.map(function(t) { return t.toUpperCase(); });

          let interactiveEl = null;
          if (role === 'button') {
            interactiveEl = rawEl.closest('button, [role="button"], a.mat-button, .mat-mdc-button-base, [role="tab"]');
          } else if (role === 'input') {
            interactiveEl = rawEl.closest('[contenteditable="true"], textarea, input, [role="textbox"], .ProseMirror');
          } else if (role === 'dropdown') {
            interactiveEl = rawEl.closest('mat-select, [role="combobox"], [role="listbox"], select, mat-button-toggle');
          } else {
            interactiveEl = rawEl.closest('button, [role="button"], [contenteditable="true"], textarea, input, a, mat-select, [role="combobox"], mat-option, mat-button-toggle');
          }

          let targetEl = interactiveEl || rawEl;

          // Nếu có expectedTagNames và phần tử hiện tại chưa khớp, thử leo tiếp theo expectedTagNames
          if (expectedTags.length > 0 && !expectedTags.includes(targetEl.tagName.toUpperCase())) {
            const selectorStr = expectedTags.map(function(t) { return t.toLowerCase(); }).join(',');
            const tagMatch = rawEl.closest(selectorStr);
            if (tagMatch) {
              targetEl = tagMatch;
            }
          }

          if (!isVisible(targetEl)) return null;

          // 5. Gán thuộc tính neo tạm thời để query ổn định trong cùng lifecycle
          const anchorId = 'va_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
          targetEl.setAttribute('data-flow-anchor', anchorId);
          const anchorSelector = '[data-flow-anchor="' + anchorId + '"]';

          // 6. Tìm cách suy diễn selector tự nhiên nếu có thể (để cache học vào Selector Memory)
          let derivedSelector = null;
          if (targetEl.id && typeof CSS !== 'undefined' && CSS.escape) {
            const idSel = '#' + CSS.escape(targetEl.id);
            if (document.querySelectorAll(idSel).length === 1) {
              derivedSelector = idSel;
            }
          }
          if (!derivedSelector && targetEl.getAttribute('aria-label') && typeof CSS !== 'undefined' && CSS.escape) {
            const ariaVal = targetEl.getAttribute('aria-label');
            const ariaSel = targetEl.tagName.toLowerCase() + '[aria-label="' + CSS.escape(ariaVal) + '"]';
            const scope = cSel ? document.querySelector(cSel) : document;
            if (scope && scope.querySelectorAll(ariaSel).length === 1) {
              derivedSelector = cSel ? (cSel + ' ' + ariaSel) : ariaSel;
            }
          }

          const targetRect = targetEl.getBoundingClientRect();

          return {
            anchorSelector: anchorSelector,
            derivedSelector: derivedSelector,
            tagName: targetEl.tagName,
            className: targetEl.className || '',
            label: (targetEl.getAttribute('aria-label') || targetEl.innerText || targetEl.textContent || '').trim(),
            rect: {
              x: Math.round(targetRect.x),
              y: Math.round(targetRect.y),
              width: Math.round(targetRect.width),
              height: Math.round(targetRect.height),
              top: Math.round(targetRect.top),
              left: Math.round(targetRect.left)
            },
            pointTested: { x: pointX, y: pointY },
            containerRect: contRect
          };
        } catch (err) {
          return null;
        }
      })()
    `;

    try {
      const res = await win.webContents.executeJavaScript(probeJs, true);
      if (!res || !res.rect) return null;

      // Tính Confidence Score cho Visual Anchor (thang điểm 65 - 80)
      let confidence = spec.baseConfidence ?? 70;
      if (res.label && res.label.length > 0) {
        confidence = Math.min(80, confidence + 3);
      }
      if (
        spec.expectedTagNames &&
        spec.expectedTagNames.map((t: string) => t.toUpperCase()).includes(res.tagName.toUpperCase())
      ) {
        confidence = Math.min(80, confidence + 3);
      }
      if (res.rect.width >= 24 && res.rect.height >= 24) {
        confidence = Math.min(80, confidence + 2);
      }

      const candidate: CandidateResult = {
        selector: res.anchorSelector,
        strategy: 'VISUAL_ANCHOR',
        confidence,
        rect: res.rect,
        label: res.label || spec.description || 'Visual Anchor Element',
        className: res.className,
        tagName: res.tagName,
        containerSelector: spec.containerSelector,
      };

      // Đính kèm các thông tin bổ sung để FlowElementFinder sử dụng
      (candidate as any).derivedSelector = res.derivedSelector;
      (candidate as any).pointTested = res.pointTested;
      (candidate as any).containerRect = res.containerRect;

      return candidate;
    } catch {
      return null;
    }
  }
}
