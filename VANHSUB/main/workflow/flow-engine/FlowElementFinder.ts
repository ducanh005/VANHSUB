/**
 * FlowElementFinder: Bộ tìm kiếm phần tử đa chiến lược với Confidence Scoring
 * - Hỗ trợ phân cấp 4 tầng: Accessibility -> Strict Component -> Structural Context -> Text Content.
 * - Tính toán điểm tin cậy (Confidence Score: 0-100).
 * - Tuyệt đối KHÔNG đoán, KHÔNG click bừa khi Confidence < Threshold.
 * - Tự động kết hợp kiểm tra ổn định toạ độ (Bounding Box Stability) trước khi trả về toạ độ tương tác.
 */

import { FlowSmartWait, ElementRect, StabilityResult } from './FlowSmartWait';
import type { GeometricAnchorSpec } from './FlowVisualFallback';

export type FinderStrategy =
  | 'ACCESSIBILITY'     // role + aria-label (95 - 100)
  | 'STRICT_COMPONENT'  // component tag / css class đặc thù (85 - 90)
  | 'CONTEXTUAL'        // cấu trúc quan hệ cha-con (75 - 80)
  | 'TEXT_MATCH'        // nội dung văn bản (65 - 70)
  | 'VISUAL_ANCHOR'     // neo hình học / thị giác tương đối (70 - 75)
  | 'COORDINATE_FALLBACK'; // toạ độ fallback khai báo tường minh (50)

export interface StrategyRule {
  strategy: FinderStrategy;
  baseConfidence: number;
  selectors: string[];
  description: string;
  containerSelector?: string; // Giới hạn phạm vi tìm kiếm bên trong container cha cụ thể (ngăn ngừa document-wide rò rỉ)
}

export interface ElementSearchSpec {
  name: string;
  rules: StrategyRule[];
  confidenceThreshold?: number; // Mặc định 65
  requireStable?: boolean;      // Mặc định true
  stabilityMs?: number;         // Mặc định 200ms
  unobscuredCheck?: boolean;    // Mặc định true
  visualAnchor?: GeometricAnchorSpec; // Neo hình học tương đối cứu cánh khi 4 tầng selector đều thất bại
  fallbackCoordinates?: { x: number; y: number; description?: string };
  allowCoordinateFallback?: boolean; // Khai báo tường minh khi dùng fallback toạ độ (mặc định false)
}

export interface CandidateResult {
  selector: string;
  strategy: FinderStrategy;
  confidence: number;
  rect: ElementRect;
  label?: string;
  className?: string;
  tagName?: string;
  isStable?: boolean;
  unobscured?: boolean;
  stability?: StabilityResult;
  containerSelector?: string;
}

export interface ElementFinderResult {
  found: boolean;
  selectedCandidate: CandidateResult | null;
  candidatesTried: number;
  allCandidates: CandidateResult[];
  error?: 'element_not_found' | 'low_confidence' | 'element_unstable' | 'element_obscured';
  errorDetail?: string;
}

export class FlowElementFinder {
  /**
   * Quét và thăm dò nhanh một selector đơn lẻ trên DOM
   */
  public static async probeSelector(
    win: any,
    selector: string,
    containerSelector?: string | null
  ): Promise<{
    tagName: string;
    className: string;
    label: string;
    rect: ElementRect;
  } | null> {
    if (!win || !win.webContents) return null;

    const scanJs = `
      (function() {
        function isVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        }

        try {
          let root = document;
          const cSel = ${JSON.stringify(containerSelector || null)};
          if (cSel) {
            const containerEl = document.querySelector(cSel);
            if (!containerEl || !isVisible(containerEl)) {
              return null;
            }
            root = containerEl;
          }

          let els = [];
          const sel = ${JSON.stringify(selector)};
          if (sel.startsWith('text:')) {
            const targetText = sel.slice(5).trim().toLowerCase();
            const candidates = Array.from(root.querySelectorAll('button, a, div, span, [role="button"], mat-option, [role="option"], mat-button-toggle, .mat-button-toggle-button'));
            els = candidates.filter(el => {
              const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
              if (targetText.length <= 2) {
                return txt === targetText || txt === ('x' + targetText) || txt === (targetText + 'x');
              }
              return txt.includes(targetText);
            });
          } else {
            try {
              els = Array.from(root.querySelectorAll(sel));
            } catch {
              els = [];
            }
          }

          const valid = els.filter(isVisible);
          if (valid.length === 0) return null;

          valid.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            const aInView = (ra.left >= 0 && ra.right <= window.innerWidth && ra.top >= 0 && ra.bottom <= window.innerHeight) ? 1 : 0;
            const bInView = (rb.left >= 0 && rb.right <= window.innerWidth && rb.top >= 0 && rb.bottom <= window.innerHeight) ? 1 : 0;
            return bInView - aInView;
          });

          const target = valid[0];
          const rect = target.getBoundingClientRect();
          return {
            tagName: target.tagName,
            className: target.className,
            label: (target.getAttribute('aria-label') || target.innerText || target.textContent || '').trim(),
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              top: Math.round(rect.top),
              left: Math.round(rect.left)
            }
          };
        } catch (e) {
          return null;
        }
      })()
    `;

    return await win.webContents.executeJavaScript(scanJs, true).catch(() => null);
  }

  /**
   * Tìm kiếm phần tử theo thông số spec với chấm điểm tin cậy
   */
  static async find(
    win: any,
    spec: ElementSearchSpec
  ): Promise<ElementFinderResult> {
    const threshold = spec.confidenceThreshold ?? 65;
    const requireStable = spec.requireStable ?? true;
    const unobscuredCheck = spec.unobscuredCheck ?? true;
    const stabilityMs = spec.stabilityMs ?? 200;

    const allCandidates: CandidateResult[] = [];
    let candidatesTried = 0;

    // 0. FAST-PATH SHORT CIRCUIT: Kiểm tra Selector Memory đã học trước đó (Phase 9 - Step 1)
    try {
      const { FlowSelectorMemory } = await import('./FlowSelectorMemory');
      const memory = FlowSelectorMemory.getInstance();
      const remembered = memory.getRemembered(spec.name);

      if (remembered) {
        candidatesTried++;
        const elData = await FlowElementFinder.probeSelector(win, remembered.selector, remembered.containerSelector);
        if (elData && elData.rect) {
          let confidence = remembered.confidence;
          if (elData.label && elData.label.length > 0) confidence = Math.min(100, confidence + 5);
          if (elData.rect.width > 20 && elData.rect.height > 20) confidence = Math.min(100, confidence + 2);

          let isStable = true;
          let stabilityRes: any = undefined;
          if (requireStable) {
            stabilityRes = await FlowSmartWait.waitForElementStable(win, remembered.selector, {
              stabilityMs,
              timeoutMs: 1500,
              tolerancePx: 1,
              containerSelector: remembered.containerSelector,
            });
            isStable = stabilityRes.stable;
          }

          let isUnobscured = true;
          if (unobscuredCheck && isStable) {
            const targetRect = stabilityRes?.rect || elData.rect;
            const clickCenter = {
              x: Math.round(targetRect.x + targetRect.width / 2),
              y: Math.round(targetRect.y + targetRect.height / 2),
            };
            const unobscuredRes = await FlowSmartWait.checkElementUnobscured(
              win,
              clickCenter,
              remembered.selector,
              remembered.containerSelector
            );
            isUnobscured = unobscuredRes.unobscured;
          }

          if (isStable && isUnobscured && confidence >= threshold) {
            const candidate: CandidateResult = {
              selector: remembered.selector,
              strategy: remembered.strategy,
              confidence,
              rect: stabilityRes?.rect || elData.rect,
              label: elData.label,
              className: elData.className,
              tagName: elData.tagName,
              isStable: true,
              unobscured: true,
              stability: stabilityRes,
              containerSelector: remembered.containerSelector,
            };

            await memory.recordSuccess(
              spec.name,
              remembered.selector,
              remembered.strategy,
              confidence,
              remembered.containerSelector
            );

            return {
              found: true,
              selectedCandidate: candidate,
              candidatesTried,
              allCandidates: [candidate],
            };
          }
        }

        // Selector đã nhớ không còn thỏa mãn, ghi nhận 1 failure để kích hoạt re-learn
        await memory.recordFailure(spec.name);
      }
    } catch {}

    // Quét theo thứ tự ưu tiên của các chiến lược (Strategy Rules)
    for (const rule of spec.rules) {
      const containerSel = rule.containerSelector || null;

      for (const selector of rule.selectors) {
        candidatesTried++;
        const elData = await FlowElementFinder.probeSelector(win, selector, containerSel);
        if (elData && elData.rect) {
          // Tính điểm tin cậy (Confidence Score)
          let confidence = rule.baseConfidence;
          const isShortText = rule.strategy === 'TEXT_MATCH' && selector.startsWith('text:') && selector.slice(5).trim().length <= 2;
          if (!isShortText && elData.label && elData.label.length > 0) confidence = Math.min(100, confidence + 5);
          if (elData.rect.width > 20 && elData.rect.height > 20) confidence = Math.min(100, confidence + 2);

          const candidate: CandidateResult = {
            selector,
            strategy: rule.strategy,
            confidence,
            rect: elData.rect,
            label: elData.label,
            className: elData.className,
            tagName: elData.tagName,
            containerSelector: rule.containerSelector,
          };

          allCandidates.push(candidate);
        }
      }

      // Nếu chiến lược hiện tại đã tìm thấy ứng viên có điểm >= threshold, dừng quét chiến lược thấp hơn
      const qualifying = allCandidates.filter((c) => c.confidence >= threshold);
      if (qualifying.length > 0) {
        break;
      }
    }

    // 5. VISUAL FALLBACK & GEOMETRIC ANCHOR (Phase 9 - Step 2)
    // Nếu các tầng 1-4 không tìm được ứng viên nào đạt ngưỡng confidence >= threshold,
    // và spec có khai báo visualAnchor, kích hoạt bộ tìm kiếm neo hình học cứu cánh
    const hasQualifyingCandidate = allCandidates.some((c) => c.confidence >= threshold);
    if (!hasQualifyingCandidate && spec.visualAnchor) {
      try {
        const { FlowVisualFallback } = await import('./FlowVisualFallback');
        const anchorCandidate = await FlowVisualFallback.resolveAnchor(win, spec.visualAnchor);
        if (anchorCandidate) {
          candidatesTried++;
          allCandidates.push(anchorCandidate);
        }
      } catch {
        // Visual fallback thất bại an toàn, tiếp tục kiểm tra các tầng sau
      }
    }

    // Fallback toạ độ tường minh: chỉ được xét khi không có candidate nào đạt và allowCoordinateFallback = true
    if (allCandidates.length === 0 && spec.fallbackCoordinates && spec.allowCoordinateFallback) {
      candidatesTried++;
      const fb = spec.fallbackCoordinates;
      allCandidates.push({
        selector: `coordinate:(${fb.x},${fb.y})`,
        strategy: 'COORDINATE_FALLBACK',
        confidence: 50, // Toạ độ fallback luôn có confidence thấp (50 < 65)
        rect: {
          x: fb.x,
          y: fb.y,
          width: 24,
          height: 24,
          top: fb.y,
          left: fb.x,
        },
        label: fb.description || 'Explicit Coordinate Fallback',
        tagName: 'COORDINATE',
      });
    }

    if (allCandidates.length === 0) {
      return {
        found: false,
        selectedCandidate: null,
        candidatesTried,
        allCandidates,
        error: 'element_not_found',
        errorDetail: `Không tìm thấy bất kỳ phần tử nào khớp với các chiến lược tìm kiếm của [${spec.name}].`,
      };
    }

    // Sắp xếp theo Confidence Score giảm dần
    allCandidates.sort((a, b) => b.confidence - a.confidence);
    const bestCandidate = allCandidates[0];

    // Quy tắc an toàn: Không click nếu độ tin cậy dưới ngưỡng cho phép
    if (bestCandidate.confidence < threshold) {
      return {
        found: false,
        selectedCandidate: bestCandidate,
        candidatesTried,
        allCandidates,
        error: 'low_confidence',
        errorDetail: `Độ tin cậy của phần tử [${spec.name}] (${bestCandidate.confidence}/100) thấp hơn ngưỡng an toàn (${threshold}/100). Hủy thao tác để tránh click bừa.`,
      };
    }

    // Kiểm tra Bounding Box Stability nếu được yêu cầu
    if (requireStable) {
      const stabilityRes = await FlowSmartWait.waitForElementStable(win, bestCandidate.selector, {
        stabilityMs,
        timeoutMs: 3000,
        tolerancePx: 1,
        containerSelector: bestCandidate.containerSelector,
      });

      bestCandidate.stability = stabilityRes;
      bestCandidate.isStable = stabilityRes.stable;

      if (!stabilityRes.stable) {
        return {
          found: false,
          selectedCandidate: bestCandidate,
          candidatesTried,
          allCandidates,
          error: 'element_unstable',
          errorDetail: `Phần tử [${spec.name}] toạ độ không ổn định (đang chạy animation hoặc layout shift) sau ${stabilityRes.durationMs}ms.`,
        };
      }

      if (stabilityRes.rect) {
        bestCandidate.rect = stabilityRes.rect;
      }
    }

    // Kiểm tra che phủ nếu được yêu cầu
    if (unobscuredCheck) {
      const clickCenter = {
        x: Math.round(bestCandidate.rect.x + bestCandidate.rect.width / 2),
        y: Math.round(bestCandidate.rect.y + bestCandidate.rect.height / 2),
      };
      const unobscuredRes = await FlowSmartWait.checkElementUnobscured(
        win,
        clickCenter,
        bestCandidate.selector,
        bestCandidate.containerSelector
      );
      bestCandidate.unobscured = unobscuredRes.unobscured;

      if (!unobscuredRes.unobscured) {
        return {
          found: false,
          selectedCandidate: bestCandidate,
          candidatesTried,
          allCandidates,
          error: 'element_obscured',
          errorDetail: `Phần tử [${spec.name}] đang bị che bởi [${unobscuredRes.topElementTag}.${unobscuredRes.topElementClass}] tại toạ độ (${clickCenter.x}, ${clickCenter.y}).`,
        };
      }
    }

    // Ghi nhận selector thành công vào Selector Memory (Phase 9 - Step 1 & 2)
    try {
      const { FlowSelectorMemory } = await import('./FlowSelectorMemory');
      // Nếu là VISUAL_ANCHOR và có derivedSelector tự nhiên, lưu derivedSelector để Fast-Path phiên sau dùng được
      const selectorToSave =
        (bestCandidate as any).derivedSelector ||
        (bestCandidate.strategy !== 'VISUAL_ANCHOR' ? bestCandidate.selector : null);

      if (selectorToSave) {
        await FlowSelectorMemory.getInstance().recordSuccess(
          spec.name,
          selectorToSave,
          bestCandidate.strategy,
          bestCandidate.confidence,
          bestCandidate.containerSelector
        );
      }
    } catch {}

    return {
      found: true,
      selectedCandidate: bestCandidate,
      candidatesTried,
      allCandidates,
    };
  }

  /**
   * Cấu hình chuẩn định nghĩa nút Generate Image
   */
  static getGenerateButtonSpec(): ElementSearchSpec {
    return {
      name: 'GENERATE_BUTTON',
      confidenceThreshold: 65,
      requireStable: true,
      stabilityMs: 200,
      unobscuredCheck: true,
      visualAnchor: {
        containerSelector: 'flow-prompt-box, flow-base-prompt-box, .prompt-box-container',
        relativeX: 0.95,
        relativeY: 0.50,
        interactiveRole: 'button',
        expectedTagNames: ['BUTTON', 'MAT-ICON', 'DIV'],
        baseConfidence: 72,
        description: 'Nút Generate ở góc phải prompt box',
      },
      rules: [
        {
          strategy: 'ACCESSIBILITY',
          baseConfidence: 95,
          selectors: [
            'flow-prompt-box button[aria-label*="Bắt đầu tạo" i]',
            'button[aria-label*="Bắt đầu tạo" i]',
            'flow-prompt-box button[aria-label*="Start generation" i]',
            'button[aria-label*="Start generation" i]',
            'button[aria-label*="Tạo ảnh" i]',
            'button[aria-label*="Generate image" i]',
            'button[aria-label="Generate"]',
          ],
          description: 'Tìm theo ARIA label đặc thù của nút Generate',
        },
        {
          strategy: 'STRICT_COMPONENT',
          baseConfidence: 88,
          selectors: [
            'flow-prompt-box button.mat-mdc-icon-button',
            'flow-prompt-box button.mdc-icon-button',
            'button.generate-icon-button',
            'flow-generate-icon-button button',
            'flow-generate-button button',
          ],
          description: 'Tìm theo component selector nội bộ của Google Flow',
        },
        {
          strategy: 'CONTEXTUAL',
          baseConfidence: 78,
          selectors: [
            'flow-prompt-box button:has(mat-icon)',
            'flow-prompt-box button[type="submit"]',
            'flow-base-prompt-box button[type="submit"]',
            '.prompt-box-container button[type="submit"]',
          ],
          description: 'Tìm theo nút submit bên trong prompt box container',
        },
        {
          strategy: 'TEXT_MATCH',
          baseConfidence: 68,
          selectors: [
            'button.submit-button',
          ],
          description: 'Tìm theo class submit chung',
        },
      ],
    };
  }

  /**
   * Cấu hình chuẩn định nghĩa ô nhập Prompt Input
   */
  static getPromptInputSpec(): ElementSearchSpec {
    return {
      name: 'PROMPT_INPUT',
      confidenceThreshold: 65,
      requireStable: false,
      unobscuredCheck: true,
      visualAnchor: {
        containerSelector: 'flow-prompt-box, flow-base-prompt-box, .prompt-box-container',
        relativeX: 0.35,
        relativeY: 0.45,
        interactiveRole: 'input',
        expectedTagNames: ['DIV', 'TEXTAREA', 'P'],
        baseConfidence: 72,
        description: 'Vùng soạn thảo prompt box',
      },
      rules: [
        {
          strategy: 'STRICT_COMPONENT',
          baseConfidence: 92,
          selectors: [
            'flow-rich-text-editor .ProseMirror',
            '.prosemirror-editor .ProseMirror',
            'flow-prompt-box .ProseMirror',
            'flow-creative-agent-prompt-box .ProseMirror',
          ],
          description: 'Tìm theo ProseMirror editor trong prompt box của Flow',
        },
        {
          strategy: 'ACCESSIBILITY',
          baseConfidence: 85,
          selectors: [
            '[contenteditable="true"][role="textbox"]',
            'flow-prompt-box [contenteditable="true"]',
          ],
          description: 'Tìm theo role textbox contenteditable',
        },
        {
          strategy: 'CONTEXTUAL',
          baseConfidence: 75,
          selectors: [
            'flow-prompt-box textarea:not(.g-recaptcha-response)',
            'flow-base-prompt-box textarea',
          ],
          description: 'Tìm textarea trong khung soạn thảo',
        },
        {
          strategy: 'TEXT_MATCH',
          baseConfidence: 68,
          selectors: [
            'textarea[placeholder*="Mô tả" i]',
            'textarea[placeholder*="prompt" i]',
          ],
          description: 'Tìm textarea theo placeholder',
        },
      ],
    };
  }

  /**
   * Cấu hình chuẩn định nghĩa khung chứa prompt editor (Prompt Box Container)
   */
  static getEditorContainerSpec(): ElementSearchSpec {
    return {
      name: 'EDITOR_CONTAINER',
      confidenceThreshold: 65,
      requireStable: false,
      unobscuredCheck: false,
      visualAnchor: {
        relativeX: 0.50,
        relativeY: 0.85,
        expectedTagNames: ['FLOW-PROMPT-BOX', 'DIV', 'FLOW-BASE-PROMPT-BOX'],
        baseConfidence: 70,
        description: 'Khung prompt box ở cạnh dưới màn hình',
      },
      rules: [
        {
          strategy: 'ACCESSIBILITY',
          baseConfidence: 95,
          selectors: [
            'flow-prompt-box[role="region"]',
            '[aria-label*="Prompt" i]',
            '[aria-label*="Hộp nhắc" i]',
          ],
          description: 'Tìm theo ARIA role region hoặc prompt box label',
        },
        {
          strategy: 'STRICT_COMPONENT',
          baseConfidence: 90,
          selectors: [
            'flow-prompt-box',
            'flow-base-prompt-box',
            'flow-creative-agent-prompt-box',
          ],
          description: 'Tìm theo thẻ Custom Component của Flow',
        },
        {
          strategy: 'CONTEXTUAL',
          baseConfidence: 80,
          selectors: [
            '.prompt-box-container',
            '.base-prompt-box',
            'div:has(> flow-rich-text-editor)',
            'div:has(> .prosemirror-editor)',
          ],
          description: 'Tìm theo container bao ngoài editor',
        },
        {
          strategy: 'TEXT_MATCH',
          baseConfidence: 68,
          selectors: [
            '.prompt-box',
            '.flow-editor-box',
          ],
          description: 'Tìm theo css class chung',
        },
      ],
    };
  }

  /**
   * Cấu hình chuẩn định nghĩa nút dọn dẹp canvas (Clear Canvas Button)
   */
  static getClearCanvasSpec(): ElementSearchSpec {
    return {
      name: 'CLEAR_CANVAS_BUTTON',
      confidenceThreshold: 65,
      requireStable: true,
      stabilityMs: 150,
      unobscuredCheck: true,
      visualAnchor: {
        containerSelector: 'flow-prompt-box, flow-base-prompt-box, .prompt-box-container',
        relativeX: 0.88,
        relativeY: 0.50,
        interactiveRole: 'button',
        expectedTagNames: ['BUTTON', 'MAT-ICON'],
        baseConfidence: 70,
        description: 'Nút Clear trong prompt box',
      },
      rules: [
        {
          strategy: 'ACCESSIBILITY',
          baseConfidence: 95,
          selectors: [
            'flow-prompt-box button[aria-label*="Xóa" i]',
            'flow-prompt-box button[aria-label*="Clear" i]',
            'button[aria-label*="Xóa lời nhắc" i]',
            'button[aria-label*="Clear prompt" i]',
            'button[aria-label*="Xóa" i]',
            'button[aria-label*="Clear" i]',
          ],
          description: 'Tìm nút xóa/clear theo ARIA label',
        },
        {
          strategy: 'STRICT_COMPONENT',
          baseConfidence: 88,
          selectors: [
            'flow-prompt-box button.clear-button',
            'button.clear-btn',
            '.clear-canvas-btn',
            'button.reset-prompt-btn',
          ],
          description: 'Tìm theo component selector nội bộ của nút clear',
        },
        {
          strategy: 'CONTEXTUAL',
          baseConfidence: 78,
          containerSelector: 'flow-prompt-box, flow-base-prompt-box, .prompt-box-container',
          selectors: [
            'button:has(mat-icon[fonticon*="clear"])',
            'button.clear-btn',
            'button:has(mat-icon)',
          ],
          description: 'Tìm nút clear icon bên trong prompt box (Container-Scoped)',
        },
        {
          strategy: 'TEXT_MATCH',
          baseConfidence: 68,
          containerSelector: 'flow-prompt-box, flow-base-prompt-box, .prompt-box-container',
          selectors: [
            'text:Xóa tất cả',
            'text:Clear all',
            'text:Xóa lời nhắc',
            'text:Clear prompt',
          ],
          description: 'Tìm theo text label đầy đủ của nút clear (Container-Scoped)',
        },
        {
          strategy: 'TEXT_MATCH',
          baseConfidence: 55, // Short text: hạ xuống 55 < 65
          containerSelector: 'flow-prompt-box, flow-base-prompt-box, .prompt-box-container',
          selectors: [
            'text:Xóa',
            'text:Clear',
          ],
          description: 'Tìm theo text ngắn (Confidence 55 < 65: Ngăn ngừa false-click)',
        },
      ],
    };
  }

  /**
   * Cấu hình chuẩn định nghĩa nút Tạo dự án mới (New Project Button)
   */
  static getNewProjectButtonSpec(): ElementSearchSpec {
    const containerScope = 'flow-lobby-header, flow-lobby, header, .lobby-container';
    return {
      name: 'NEW_PROJECT_BUTTON',
      confidenceThreshold: 65,
      requireStable: true,
      stabilityMs: 200,
      unobscuredCheck: true,
      visualAnchor: {
        containerSelector: containerScope,
        relativeX: 0.90,
        relativeY: 0.50,
        interactiveRole: 'button',
        expectedTagNames: ['BUTTON', 'MAT-ICON', 'DIV'],
        baseConfidence: 70,
        description: 'Nút New Project ở góc trên phải sảnh',
      },
      rules: [
        {
          strategy: 'ACCESSIBILITY',
          baseConfidence: 95,
          selectors: [
            'button[aria-label*="Tạo dự án mới" i]',
            'button[aria-label*="New project" i]',
            'button[aria-label*="Create project" i]',
            'button[aria-label*="Tạo dự án" i]',
          ],
          description: 'Tìm theo ARIA label của nút New Project',
        },
        {
          strategy: 'STRICT_COMPONENT',
          baseConfidence: 88,
          selectors: [
            'flow-lobby-header button.new-project-btn',
            'button.create-project-btn',
            'button.new-project-button',
            'flow-project-list button:first-child',
          ],
          description: 'Tìm theo component header / list selector của Flow',
        },
        {
          strategy: 'CONTEXTUAL',
          baseConfidence: 78,
          containerSelector: containerScope,
          selectors: [
            'button.new-project-button',
            'button:has(mat-icon)',
            'header button[type="button"]',
          ],
          description: 'Tìm theo vị trí header trên trang sảnh Flow (Container-Scoped)',
        },
        {
          strategy: 'TEXT_MATCH',
          baseConfidence: 68,
          containerSelector: containerScope,
          selectors: [
            'text:Tạo dự án mới',
            'text:Dự án mới',
            'text:New project',
            'text:Create project',
          ],
          description: 'Tìm nút theo text đầy đủ (Container-Scoped)',
        },
      ],
    };
  }

  /**
   * Cấu hình chuẩn định nghĩa nút Cài đặt/Tùy chọn sinh (Settings Trigger Button)
   */
  /**
   * Cấu hình chuẩn định nghĩa chuyển đổi Mode Tab (Image / Video)
   */
  /**
   * Cấu hình chuẩn định nghĩa chuyển đổi Mode Tab (Image / Video)
   */
  static getModeTabSpec(mode: 'image' | 'video' = 'image'): ElementSearchSpec {
    const isImg = mode === 'image';
    const containerScope = 'flow-prompt-box, flow-base-prompt-box, .prompt-box-container';
    return {
      name: `MODE_TAB_${mode.toUpperCase()}`,
      confidenceThreshold: 65,
      requireStable: true,
      stabilityMs: 150,
      unobscuredCheck: true,
      rules: [
        {
          strategy: 'ACCESSIBILITY',
          baseConfidence: 95,
          selectors: isImg
            ? [
                'button[role="tab"][aria-label*="Image" i]',
                'button[role="tab"][aria-label*="Ảnh" i]',
                'button[aria-label*="Image mode" i]',
                'button[aria-label*="Tạo ảnh" i]',
                'mat-button-toggle[aria-label*="Image" i]',
                'mat-button-toggle[aria-label*="Ảnh" i]',
              ]
            : [
                'button[role="tab"][aria-label*="Video" i]',
                'button[role="tab"][aria-label*="Phim" i]',
                'button[aria-label*="Video mode" i]',
                'button[aria-label*="Tạo video" i]',
                'mat-button-toggle[aria-label*="Video" i]',
              ],
          description: `Tìm tab chuyển mode ${mode} theo ARIA role và label`,
        },
        {
          strategy: 'STRICT_COMPONENT',
          baseConfidence: 88,
          selectors: isImg
            ? [
                'flow-prompt-box mat-button-toggle[value="IMAGE"]',
                'flow-prompt-box mat-button-toggle[value="image"]',
                'button.mode-toggle-image',
                'mat-button-toggle.mode-image',
                'button[data-mode="image"]',
              ]
            : [
                'flow-prompt-box mat-button-toggle[value="VIDEO"]',
                'flow-prompt-box mat-button-toggle[value="video"]',
                'button.mode-toggle-video',
                'mat-button-toggle.mode-video',
                'button[data-mode="video"]',
              ],
          description: `Tìm tab ${mode} theo component toggle đặc thù của Flow`,
        },
        {
          strategy: 'CONTEXTUAL',
          baseConfidence: 78,
          containerSelector: containerScope,
          selectors: [
            '[role="tablist"] button',
            'mat-button-toggle-group mat-button-toggle',
            '[role="tab"]',
          ],
          description: 'Tìm trong danh sách tab của prompt box (Container-Scoped)',
        },
        {
          strategy: 'TEXT_MATCH',
          baseConfidence: 68,
          containerSelector: containerScope,
          selectors: isImg
            ? ['text:Image mode', 'text:Tạo ảnh']
            : ['text:Video mode', 'text:Tạo video'],
          description: `Tìm theo nhãn text đầy đủ của tab ${mode} (Container-Scoped)`,
        },
        {
          strategy: 'TEXT_MATCH',
          baseConfidence: 55, // Ngắn 1-2 từ/ký tự: dưới ngưỡng an toàn 65 để chống click nhầm
          containerSelector: containerScope,
          selectors: isImg
            ? ['text:Image', 'text:Ảnh']
            : ['text:Video', 'text:Phim'],
          description: `Text ngắn của tab ${mode} (Confidence 55 < 65: Ngăn ngừa false-click khi không có context)`,
        },
      ],
    };
  }

  /**
   * Cấu hình chuẩn định nghĩa nút Cài đặt/Tùy chọn sinh (Settings Trigger Button)
   */
  static getSettingsTriggerSpec(): ElementSearchSpec {
    const containerScope = 'flow-prompt-box, flow-base-prompt-box, .prompt-box-container';
    return {
      name: 'SETTINGS_TRIGGER_BUTTON',
      confidenceThreshold: 65,
      requireStable: true,
      stabilityMs: 150,
      unobscuredCheck: true,
      rules: [
        {
          strategy: 'ACCESSIBILITY',
          baseConfidence: 95,
          containerSelector: containerScope,
          selectors: [
            'button[aria-label*="Điều kiện kích hoạt" i]',
            'button[aria-label*="Cài đặt" i]',
            'button[aria-label*="Settings" i]',
            'button[aria-label*="Tùy chọn" i]',
            'button[aria-label*="Options" i]',
            'button[aria-label*="Tune" i]',
          ],
          description: 'Tìm theo ARIA label nút cài đặt (Container-Scoped)',
        },
        {
          strategy: 'STRICT_COMPONENT',
          baseConfidence: 88,
          containerSelector: containerScope,
          selectors: [
            'button.settings-trigger-button',
            'flow-settings-button button',
            'button.options-button',
            'button:has(mat-icon[fonticon*="tune"])',
            'button:has(mat-icon[fonticon*="crop"])',
          ],
          description: 'Tìm theo component selector cài đặt của Flow (Container-Scoped)',
        },
        {
          strategy: 'CONTEXTUAL',
          baseConfidence: 78,
          containerSelector: containerScope,
          selectors: [
            'button:has(mat-icon[fonticon*="tune"])',
            'button:has(mat-icon[fonticon*="crop"])',
            'button:has(mat-icon)',
            'button.settings-btn',
            'button.options-btn',
          ],
          description: 'Tìm nút icon trong prompt box container (Container-Scoped)',
        },
        {
          strategy: 'TEXT_MATCH',
          baseConfidence: 68,
          containerSelector: containerScope,
          selectors: [
            'text:Cài đặt',
            'text:Settings',
            'text:Tùy chọn',
          ],
          description: 'Tìm theo nhãn text đầy đủ (Container-Scoped)',
        },
        {
          strategy: 'TEXT_MATCH',
          baseConfidence: 55, // Short text: hạ xuống 55 < 65
          containerSelector: containerScope,
          selectors: [
            'text:Tune',
          ],
          description: 'Tìm theo text ngắn (Confidence 55 < 65: Ngăn ngừa false-click)',
        },
      ],
    };
  }

  /**
   * Cấu hình chuẩn định nghĩa tuỳ chọn Tỉ lệ khung hình (Aspect Ratio Option)
   */
  static getAspectRatioSpec(ratio: string = '16:9'): ElementSearchSpec {
    const containerScope = '.cdk-overlay-pane, flow-aspect-ratio-selector';
    const ratioClean = ratio.replace(':', '_');
    return {
      name: `ASPECT_RATIO_${ratioClean}`,
      confidenceThreshold: 65,
      requireStable: false,
      unobscuredCheck: true,
      rules: [
        {
          strategy: 'ACCESSIBILITY',
          baseConfidence: 95,
          containerSelector: containerScope,
          selectors: [
            `button[aria-label*="${ratio}" i]`,
            `mat-button-toggle[aria-label*="${ratio}" i]`,
            `mat-option[aria-label*="${ratio}" i]`,
            `button[aria-label*="Tỉ lệ ${ratio}" i]`,
            `button[aria-label*="Aspect ratio ${ratio}" i]`,
            `button:has(mat-icon[fonticon*="crop_${ratioClean}"])`,
            `mat-button-toggle:has(mat-icon[fonticon*="crop_${ratioClean}"])`,
          ],
          description: `Tìm theo ARIA label hoặc crop icon tỉ lệ ${ratio} (Container-Scoped)`,
        },
        {
          strategy: 'STRICT_COMPONENT',
          baseConfidence: 88,
          containerSelector: containerScope,
          selectors: [
            `mat-button-toggle[value*="${ratio}"]`,
            `mat-button-toggle[value*="${ratioClean}"]`,
            `mat-button-toggle:has(mat-icon[fonticon*="crop_${ratioClean}"])`,
            `mat-button-toggle-group:nth-of-type(2) mat-button-toggle`,
            'button.aspect-ratio-btn',
            'button.ratio-button',
            'flow-aspect-ratio-selector mat-button-toggle',
          ],
          description: 'Tìm theo component selector toggle / dropdown tỉ lệ (Container-Scoped)',
        },
        {
          strategy: 'CONTEXTUAL',
          baseConfidence: 78,
          containerSelector: containerScope,
          selectors: [
            'mat-button-toggle:has(mat-icon[fonticon*="crop"])',
            'mat-button-toggle-group:nth-of-type(2) mat-button-toggle',
            '.aspect-ratio-selector mat-button-toggle',
          ],
          description: 'Tìm trong nhóm toggle tỉ lệ khung hình (Container-Scoped)',
        },
        {
          strategy: 'TEXT_MATCH',
          baseConfidence: 68,
          containerSelector: containerScope,
          selectors: [
            `text:crop_${ratioClean} ${ratio}`,
            `text:${ratio}`,
          ],
          description: `Tìm theo chuỗi tỉ lệ text ${ratio} (Container-Scoped)`,
        },
      ],
    };
  }

  /**
   * Cấu hình chuẩn định nghĩa tuỳ chọn Số lượng đầu ra (Output Count Option)
   */
  static getOutputCountSpec(count: number = 1): ElementSearchSpec {
    const countNum = Math.max(1, Math.min(4, Math.round(Number(count) || 1)));
    const containerScope = '.cdk-overlay-pane, flow-output-count-selector';
    return {
      name: `OUTPUT_COUNT_${countNum}`,
      confidenceThreshold: 65,
      requireStable: false,
      unobscuredCheck: true,
      rules: [
        {
          strategy: 'ACCESSIBILITY',
          baseConfidence: 95,
          containerSelector: containerScope,
          selectors: [
            `button[aria-label*="${countNum} image" i]`,
            `button[aria-label*="${countNum} ảnh" i]`,
            `mat-button-toggle[aria-label*="${countNum}" i]`,
            `button[aria-label*="x${countNum}" i]`,
            `button[aria-label*="Count ${countNum}" i]`,
          ],
          description: `Tìm theo ARIA label số lượng ảnh ${countNum} (Container-Scoped)`,
        },
        {
          strategy: 'STRICT_COMPONENT',
          baseConfidence: 88,
          containerSelector: containerScope,
          selectors: [
            `mat-button-toggle[value="${countNum}"]`,
            `button.output-count-${countNum}`,
            `flow-output-count-selector mat-button-toggle`,
            `.count-toggle-${countNum}`,
            `mat-button-toggle-group:last-of-type mat-button-toggle`,
          ],
          description: `Tìm theo component selector số lượng ${countNum} (Container-Scoped)`,
        },
        {
          strategy: 'CONTEXTUAL',
          baseConfidence: 78,
          containerSelector: containerScope,
          selectors: [
            'mat-button-toggle-group:last-of-type mat-button-toggle',
            '.output-count-group mat-button-toggle',
            '.count-toggle-group mat-button-toggle',
          ],
          description: 'Tìm trong nhóm toggle số lượng ảnh (Container-Scoped)',
        },
        {
          strategy: 'TEXT_MATCH',
          baseConfidence: 68,
          containerSelector: containerScope,
          selectors: [
            `text:${countNum} image`,
            `text:${countNum} ảnh`,
          ],
          description: `Tìm theo nhãn text đầy đủ ${countNum} image/ảnh (Container-Scoped)`,
        },
        {
          strategy: 'TEXT_MATCH',
          baseConfidence: 48, // Hạ xuống 48 (+2 dimension bonus = 50 đúng theo kế hoạch < 65)
          containerSelector: containerScope,
          selectors: [
            `text:x${countNum}`,
            `text:${countNum}`,
          ],
          description: `Text ngắn 1 ký tự x${countNum}/${countNum} (Confidence 50 < 65: Ngăn ngừa false-click)`,
        },
      ],
    };
  }

  /**
   * Cấu hình chuẩn định nghĩa nút Đóng overlay/panel/dialog (Close Overlay Button)
   */
  static getCloseOverlaySpec(): ElementSearchSpec {
    return {
      name: 'CLOSE_OVERLAY_BUTTON',
      confidenceThreshold: 65,
      requireStable: true,
      stabilityMs: 100,
      unobscuredCheck: true,
      rules: [
        {
          strategy: 'ACCESSIBILITY',
          baseConfidence: 95,
          selectors: [
            'button[aria-label*="Đóng" i]',
            'button[aria-label*="Close" i]',
            'button[aria-label*="Dismiss" i]',
            'button[aria-label*="Thoát" i]',
          ],
          description: 'Tìm nút đóng theo ARIA label',
        },
        {
          strategy: 'STRICT_COMPONENT',
          baseConfidence: 88,
          selectors: [
            'button.close-button',
            'button.mat-mdc-dialog-close',
            'button.dialog-close-btn',
            'button.lightbox-close',
            'flow-media-viewer button.close-btn',
          ],
          description: 'Tìm theo component class đóng dialog/overlay',
        },
        {
          strategy: 'CONTEXTUAL',
          baseConfidence: 78,
          selectors: [
            '[role="dialog"] button:has(mat-icon)',
            '.cdk-overlay-pane button:has(mat-icon)',
            'flow-media-viewer button',
          ],
          description: 'Tìm nút icon trong hộp thoại hoặc overlay',
        },
        {
          strategy: 'TEXT_MATCH',
          baseConfidence: 68,
          selectors: [
            'text:Đóng',
            'text:Close',
            'text:Hủy',
            'text:Cancel',
          ],
          description: 'Tìm theo nhãn text đóng/hủy',
        },
      ],
    };
  }

  /**
   * Cấu hình chuẩn định nghĩa tuỳ chọn Mô hình (Model Selector)
   */
  static getModelSelectorSpec(modelName: string = 'Imagen'): ElementSearchSpec {
    return {
      name: `MODEL_SELECTOR_${modelName.toUpperCase()}`,
      confidenceThreshold: 65,
      requireStable: false,
      unobscuredCheck: true,
      rules: [
        {
          strategy: 'ACCESSIBILITY',
          baseConfidence: 95,
          selectors: [
            `button[aria-label*="${modelName}" i]`,
            `button[aria-label*="Mô hình" i]`,
            `button[aria-label*="Model" i]`,
            `mat-select[aria-label*="Model" i]`,
          ],
          description: `Tìm theo ARIA label mô hình ${modelName}`,
        },
        {
          strategy: 'STRICT_COMPONENT',
          baseConfidence: 88,
          selectors: [
            'flow-model-selector button',
            'button.model-selector-btn',
            'button.model-picker-button',
          ],
          description: 'Tìm theo component model selector của Flow',
        },
        {
          strategy: 'CONTEXTUAL',
          baseConfidence: 78,
          selectors: [
            'flow-prompt-box flow-model-selector',
            '.model-picker',
            'mat-option',
          ],
          description: 'Tìm model picker trong prompt box',
        },
        {
          strategy: 'TEXT_MATCH',
          baseConfidence: 68,
          selectors: [
            `text:${modelName}`,
            'text:Imagen',
            'text:Nano',
            'text:Veo',
          ],
          description: `Tìm theo tên text của model ${modelName}`,
        },
      ],
    };
  }
}


