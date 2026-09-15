/**
 * FlowElementFinder: Bộ tìm kiếm phần tử đa chiến lược với Confidence Scoring
 * - Hỗ trợ phân cấp 4 tầng: Accessibility -> Strict Component -> Structural Context -> Text Content.
 * - Tính toán điểm tin cậy (Confidence Score: 0-100).
 * - Tuyệt đối KHÔNG đoán, KHÔNG click bừa khi Confidence < Threshold.
 * - Tự động kết hợp kiểm tra ổn định toạ độ (Bounding Box Stability) trước khi trả về toạ độ tương tác.
 */

import { FlowSmartWait, ElementRect, StabilityResult } from './FlowSmartWait';

export type FinderStrategy =
  | 'ACCESSIBILITY'     // role + aria-label (95 - 100)
  | 'STRICT_COMPONENT'  // component tag / css class đặc thù (85 - 90)
  | 'CONTEXTUAL'        // cấu trúc quan hệ cha-con (75 - 80)
  | 'TEXT_MATCH';       // nội dung văn bản (65 - 70)

export interface StrategyRule {
  strategy: FinderStrategy;
  baseConfidence: number;
  selectors: string[];
  description: string;
}

export interface ElementSearchSpec {
  name: string;
  rules: StrategyRule[];
  confidenceThreshold?: number; // Mặc định 65
  requireStable?: boolean;      // Mặc định true
  stabilityMs?: number;         // Mặc định 200ms
  unobscuredCheck?: boolean;    // Mặc định true
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

    // Quét theo thứ tự ưu tiên của các chiến lược (Strategy Rules)
    for (const rule of spec.rules) {
      for (const selector of rule.selectors) {
        candidatesTried++;
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
              const els = Array.from(document.querySelectorAll(\`${selector}\`));
              const valid = els.filter(isVisible);
              if (valid.length === 0) return null;

              // Ưu tiên phần tử nằm trọn vẹn trong viewport nhìn thấy được
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

        const elData = await win.webContents.executeJavaScript(scanJs, true).catch(() => null);
        if (elData && elData.rect) {
          // Tính điểm tin cậy (Confidence Score)
          let confidence = rule.baseConfidence;
          if (elData.label && elData.label.length > 0) confidence = Math.min(100, confidence + 5);
          if (elData.rect.width > 20 && elData.rect.height > 20) confidence = Math.min(100, confidence + 2);

          const candidate: CandidateResult = {
            selector,
            strategy: rule.strategy,
            confidence,
            rect: elData.rect,
            label: elData.label,
            className: elData.className,
            tagName: elData.tagName,
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
      const unobscuredRes = await FlowSmartWait.checkElementUnobscured(win, clickCenter, bestCandidate.selector);
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
      ],
    };
  }
}
