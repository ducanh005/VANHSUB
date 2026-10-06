/**
 * chatgptSelectors.config.ts
 *
 * Vanhsub AI Video Studio - ChatGPT Web Automation Centralized Selector Registry.
 *
 * Core Capabilities:
 * 1. Multi-tier Selector Matrix: Primary + Fallbacks for full DOM variance & EN/VI multilingual support.
 * 2. Dynamic Fallback Resolution: Automatically checks primary first, falls back gracefully,
 *    and logs structured warnings when OpenAI updates its DOM tree.
 * 3. Strict Mode Safety: Isolates Playwright locators using .first() to prevent strict mode violations.
 * 4. Zero User Prompt Capture Guard: Multi-layer filtering isolating assistant turns from user prompts.
 * 5. Semantic Echo Filtering: isUserPromptEcho() detects 42+ technical prompt markers to avoid capturing input.
 * 6. Overlay Auto-Dismissal: dismissOverlays() helper for clean headless automation.
 *
 * Conforms to:
 * - ORIGINAL_REQUEST.md (§ 2026-10-05T11:03:12Z - Requirement R2)
 * - PROJECT.md (§ Interface Contracts F8, F9, F10)
 *
 * Location: main/ai-studio/chatgpt/chatgptSelectors.config.ts
 */

import type { Locator } from 'playwright-core';

// ==============================================================================
// 1. Types & Interface Contracts (PROJECT.md § Interface Contracts)
// ==============================================================================

export interface SelectorGroup {
  /** The primary, preferred selector */
  primary: string;
  /** Ordered list of fallback selectors if the primary is missing or hidden */
  fallbacks: string[];
  /** Human-readable description of what this selector targets */
  description: string;
}

export interface ChatGptSelectorsConfig {
  promptTextarea: SelectorGroup;
  sendButton: SelectorGroup;
  stopButton: SelectorGroup;
  assistantTurn: SelectorGroup;
  userTurn: SelectorGroup;
  copyButton: SelectorGroup;
  continueButton: SelectorGroup;
  closeOverlayButton: SelectorGroup;
  // Extended auxiliary selector groups
  alertError?: SelectorGroup;
  loginScreen?: SelectorGroup;
  cloudflareChallenge?: SelectorGroup;
}

export interface SelectorResolutionResult {
  /** The selector string that successfully resolved and matched */
  selector: string;
  /** Whether the resolved selector was from the fallback tier */
  isFallback: boolean;
  /** The resolved Playwright Locator (isolated to .first() for strict-mode safety) */
  locator: Locator | any;
}

// Backward-compatibility alias
export type ResolvedSelectorResult = SelectorResolutionResult;

export interface CandidateDiagnostic {
  selector: string;
  isPrimary: boolean;
  count: number;
  isVisible: boolean;
  error?: string;
}

export interface ResolveSelectorOptions {
  /** Explicit wait timeout in milliseconds per candidate (default: 0 = immediate poll) */
  timeoutMs?: number;
  /** Whether the element must be visible in viewport/DOM (default: true) */
  waitForVisible?: boolean;
  /** Alias for waitForVisible */
  requireVisible?: boolean;
  /** Custom logger implementing a warn method (default: console) */
  logger?: { warn: (message: string) => void };
}

// ==============================================================================
// 2. Custom Diagnostic Error Class: SelectorNotFoundError
// ==============================================================================

/**
 * Custom diagnostic error thrown when neither the primary selector nor any
 * candidate fallback can be located or made visible on the page.
 */
export class SelectorNotFoundError extends Error {
  public readonly contextName: string;
  public readonly primarySelector: string;
  public readonly fallbackSelectors: string[];
  public readonly attemptedSelectors: string[];
  public readonly pageUrl?: string;
  public readonly diagnosticTimestamp: string;
  public readonly candidateDiagnostics: CandidateDiagnostic[];

  constructor(
    contextName: string,
    group: SelectorGroup,
    diagnostics: CandidateDiagnostic[],
    pageUrl?: string
  ) {
    const summary =
      `[ChatGPT Selector Resolution Error] SelectorNotFoundError: Không thể tìm thấy bất kỳ selector nào cho [${contextName}].\n` +
      `  - URL trang hiện tại: ${pageUrl || 'N/A'}\n` +
      `  - Selector chính: "${group.primary}"\n` +
      `  - Danh sách dự phòng (${group.fallbacks.length}): ${JSON.stringify(group.fallbacks)}\n` +
      `  - Chi tiết từng ứng viên (${diagnostics.length}):\n` +
      diagnostics
        .map(
          (d, i) =>
            `    ${i + 1}. [${d.isPrimary ? 'PRIMARY' : 'FALLBACK'}] "${d.selector}": count=${d.count}, visible=${d.isVisible}${
              d.error ? ` (lỗi: ${d.error})` : ''
            }`
        )
        .join('\n') +
      `\n  -> Khuyến nghị: Kiểm tra xem giao diện ChatGPT Web có cập nhật DOM cấu trúc mới không, hoặc trang có đang hiển thị Cloudflare Turnstile / Popup đăng nhập.`;

    super(summary);
    this.name = 'SelectorNotFoundError';
    this.contextName = contextName;
    this.primarySelector = group.primary;
    this.fallbackSelectors = [...group.fallbacks];
    this.attemptedSelectors = [group.primary, ...group.fallbacks];
    this.pageUrl = pageUrl;
    this.diagnosticTimestamp = new Date().toISOString();
    this.candidateDiagnostics = diagnostics;

    // Preserve prototype chain across compilation targets
    Object.setPrototypeOf(this, SelectorNotFoundError.prototype);
  }
}

// ==============================================================================
// 3. Centralized Selector Matrix Configuration
// ==============================================================================

export const CHATGPT_SELECTORS: ChatGptSelectorsConfig = {
  promptTextarea: {
    primary: '#prompt-textarea',
    fallbacks: [
      'div.ProseMirror',
      'div[contenteditable="true"]',
      'textarea[data-id="root"]',
      'textarea',
    ],
    description: 'Ô nhập prompt chính của ChatGPT Web (hỗ trợ cả textarea truyền thống lẫn ProseMirror contenteditable)',
  },

  sendButton: {
    primary: 'button[data-testid="send-button"]',
    fallbacks: [
      'button[data-testid="fruitjuice-send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send"]',
      'button[aria-label="Gửi lời nhắc"]',
      'button[aria-label="Gửi tin nhắn"]',
      'button[aria-label="Gửi"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="Gửi"]',
      'button[data-testid*="send"]',
      'form button[type="submit"]',
    ],
    description: 'Nút gửi prompt tới ChatGPT Web (hỗ trợ các biến thể data-testid, aria-label đa ngôn ngữ EN/VI và form submit)',
  },

  stopButton: {
    primary: 'button[data-testid="stop-button"]',
    fallbacks: [
      'button[aria-label*="Stop"]',
      'button[aria-label*="Dừng"]',
      'button[data-testid*="stop"]',
      '.result-streaming',
      '[data-testid="thinking-container"]',
    ],
    description: 'Nút dừng streaming hoặc chỉ báo mô hình đang sinh dữ liệu/suy nghĩ (o1/o3/thinking container)',
  },

  assistantTurn: {
    primary: 'div[data-message-author-role="assistant"]',
    fallbacks: [
      '[data-message-author-role="assistant"]',
      '[data-chatgpt-search-unit-key$=":assistant"]',
      'div:has(> [data-conversation-role="assistant"])',
      'article[data-testid^="conversation-turn-"]:not([data-message-author-role="user"])',
      'div.agent-turn',
      'div.markdown.prose',
      'div.markdown',
      '.prose',
    ],
    description: 'Khối tin nhắn phản hồi của Assistant (lọc theo author role, conversation turn và container markdown/prose)',
  },

  userTurn: {
    primary: 'div[data-message-author-role="user"]',
    fallbacks: [
      '[data-message-author-role="user"]',
      'div[data-testid*="user"]',
      'div.user-turn',
      'button[aria-label*="Chỉnh sửa"]',
      'button[aria-label*="Edit"]',
      '[data-testid="edit-user-message"]',
      'article:not(:has(button[aria-label*="Copy"]))',
    ],
    description: 'Khối tin nhắn hoặc chỉ báo tương tác của User dùng để loại trừ 100% không bắt nhầm input',
  },

  copyButton: {
    primary: 'button[aria-label*="Copy"]',
    fallbacks: [
      'button[aria-label*="Sao chép"]',
      'button[data-testid="copy-turn-action-button"]',
      'button[data-testid="good-response"]',
    ],
    description: 'Nút sao chép phản hồi trên turn assistant (hỗ trợ đa ngôn ngữ VI/EN và testid)',
  },

  continueButton: {
    primary: 'button:has-text("Continue generating")',
    fallbacks: [
      'button[data-testid="continue-button"]',
      'button[aria-label*="Continue generating"]',
      'button[aria-label*="Tiếp tục sinh"]',
      'button:has-text("Tiếp tục viết")',
      'button:has-text("Tiếp tục sinh")',
      'button:has-text("Tiếp tục")',
    ],
    description: 'Nút tiếp tục sinh khi ChatGPT ngắt giữa chừng đối với kịch bản dài',
  },

  closeOverlayButton: {
    primary: 'button[aria-label="Close"]',
    fallbacks: [
      'button[aria-label="Đóng"]',
      'button[data-testid="close-dialog"]',
      'button[data-testid="close-button"]',
      'button.close-modal',
      'button:has-text("Dismiss")',
      'button:has-text("Stay logged out")',
    ],
    description: 'Nút đóng các modal, dialog, onboarding hoặc banner quảng cáo che phủ giao diện',
  },

  alertError: {
    primary: 'div[role="alert"]',
    fallbacks: [
      '.text-red-500',
      'div[class*="bg-red-"]',
      '.border-red-500',
      '[data-testid="error-message"]',
    ],
    description: 'Thông báo lỗi mạng, lỗi hạn ngạch (quota limit) hoặc ngoại lệ giao diện',
  },

  loginScreen: {
    primary: 'a[href*="/auth/login"]',
    fallbacks: [
      'button[data-testid="login-button"]',
      'a[data-testid="login-button"]',
      'button:has-text("Log in")',
      'button:has-text("Đăng nhập")',
    ],
    description: 'Chỉ báo màn hình đăng nhập khi phiên làm việc bị hết hạn',
  },

  cloudflareChallenge: {
    primary: '#challenge-running',
    fallbacks: [
      'iframe[src*="cloudflare"]',
      'div.cf-turnstile',
      '#cf-wrapper',
      'text="Just a moment..."',
    ],
    description: 'Chỉ báo màn hình thử thách bảo mật Cloudflare Turnstile',
  },
};

// Aliased export to match test fixtures naming
export const CANONICAL_SELECTORS_CONFIG = CHATGPT_SELECTORS;

/**
 * Backward compatibility getters for alternative naming conventions.
 */
export const ALIASES = {
  get continueGeneratingButton(): SelectorGroup {
    return CHATGPT_SELECTORS.continueButton;
  },
  get closePopupButton(): SelectorGroup {
    return CHATGPT_SELECTORS.closeOverlayButton;
  },
};

// ==============================================================================
// 4. Dynamic Selector Resolution Algorithm (Core Requirement)
// ==============================================================================

/**
 * Resolves a selector from a SelectorGroup on a target Playwright Page or Locator:
 * 1. Probes group.primary first.
 * 2. If primary is absent or not visible, iterates sequentially through group.fallbacks.
 * 3. When a fallback is activated, logs the required diagnostic warning:
 *    [ChatGPT Selector Fallback] Selector chính "${group.primary}" không tìm thấy cho [${contextName}]. Đã kích hoạt selector dự phòng "${fallback}". Hãy kiểm tra và cập nhật chatgptSelectors.config.ts nếu giao diện web đã thay đổi.
 * 4. If all candidates fail, throws SelectorNotFoundError with rich diagnostic data.
 *
 * Compatible with both Playwright Page / Locator and Simulated Test Fixtures.
 */
export async function resolveSelector(
  page: any,
  group: SelectorGroup,
  contextName: string,
  options?: ResolveSelectorOptions | { warn: (message: string) => void }
): Promise<SelectorResolutionResult> {
  let logger: { warn: (message: string) => void } = console;
  let timeoutMs = 0;
  let waitForVisible = true;

  if (options) {
    if (typeof (options as any).warn === 'function') {
      logger = options as { warn: (message: string) => void };
    } else {
      const opts = options as ResolveSelectorOptions;
      if (opts.logger && typeof opts.logger.warn === 'function') {
        logger = opts.logger;
      }
      if (typeof opts.timeoutMs === 'number') {
        timeoutMs = Math.max(0, opts.timeoutMs);
      }
      if (typeof opts.waitForVisible === 'boolean') {
        waitForVisible = opts.waitForVisible;
      } else if (typeof opts.requireVisible === 'boolean') {
        waitForVisible = opts.requireVisible;
      }
    }
  }

  const diagnostics: CandidateDiagnostic[] = [];

  const probeCandidate = async (
    candidate: string,
    isPrimary: boolean
  ): Promise<{ matched: boolean; locator: any }> => {
    try {
      if (!page || typeof page.locator !== 'function') {
        throw new Error('Invalid page object: page.locator is not a function');
      }

      const loc = page.locator(candidate);
      let target = typeof loc.first === 'function' ? loc.first() : loc;

      // In real Playwright, optionally wait if timeoutMs is requested
      if (timeoutMs > 0 && typeof target.waitFor === 'function') {
        await target
          .waitFor({
            state: waitForVisible ? 'visible' : 'attached',
            timeout: timeoutMs,
          })
          .catch(() => {});
      }

      const count = typeof loc.count === 'function' ? await loc.count() : 0;
      let isVisible = false;

      if (count > 0) {
        if (typeof target.isVisible === 'function') {
          isVisible = await target.isVisible().catch(() => false);
          // If first element is hidden but there are multiple matching elements and visible is required,
          // probe subsequent elements up to count to find the first actually visible node.
          if (!isVisible && waitForVisible && count > 1 && typeof loc.nth === 'function') {
            for (let i = 1; i < count; i++) {
              const nthLoc = loc.nth(i);
              if (typeof nthLoc.isVisible === 'function') {
                const nthVisible = await nthLoc.isVisible().catch(() => false);
                if (nthVisible) {
                  target = nthLoc;
                  isVisible = true;
                  break;
                }
              }
            }
          }
        } else {
          isVisible = true;
        }
      }

      diagnostics.push({
        selector: candidate,
        isPrimary,
        count,
        isVisible,
      });

      const matched = count > 0 && (!waitForVisible || isVisible);
      return { matched, locator: target };
    } catch (err: any) {
      diagnostics.push({
        selector: candidate,
        isPrimary,
        count: 0,
        isVisible: false,
        error: err?.message || String(err),
      });
      return { matched: false, locator: null };
    }
  };

  // ----------------------------------------------------------------------------
  // Step 1: Probe group.primary
  // ----------------------------------------------------------------------------
  const primaryResult = await probeCandidate(group.primary, true);
  if (primaryResult.matched) {
    return {
      selector: group.primary,
      isFallback: false,
      locator: primaryResult.locator,
    };
  }

  // ----------------------------------------------------------------------------
  // Step 2: Iterate through group.fallbacks sequentially
  // ----------------------------------------------------------------------------
  for (const fallback of group.fallbacks) {
    const fallbackResult = await probeCandidate(fallback, false);
    if (fallbackResult.matched) {
      const warningMessage =
        `[ChatGPT Selector Fallback] Selector chính "${group.primary}" không tìm thấy cho [${contextName}]. ` +
        `Đã kích hoạt selector dự phòng "${fallback}". Hãy kiểm tra và cập nhật chatgptSelectors.config.ts nếu giao diện web đã thay đổi.`;

      if (logger && typeof logger.warn === 'function') {
        logger.warn(warningMessage);
      }
      if (logger !== console) {
        console.warn(warningMessage);
      }

      return {
        selector: fallback,
        isFallback: true,
        locator: fallbackResult.locator,
      };
    }
  }

  // ----------------------------------------------------------------------------
  // Step 3: All candidates failed -> Throw SelectorNotFoundError
  // ----------------------------------------------------------------------------
  let pageUrl: string | undefined;
  try {
    if (typeof page?.url === 'function') {
      pageUrl = page.url();
    } else if (typeof page?.page === 'function' && typeof page.page()?.url === 'function') {
      pageUrl = page.page().url();
    } else if (typeof page?.currentUrl === 'string') {
      pageUrl = page.currentUrl;
    }
  } catch {
    pageUrl = undefined;
  }

  throw new SelectorNotFoundError(contextName, group, diagnostics, pageUrl);
}

/**
 * Non-throwing variant of resolveSelector. Returns null if no selector matches.
 * Useful for conditional elements such as stopButton, continueButton, and overlays.
 */
export async function tryResolveSelector(
  page: any,
  group: SelectorGroup,
  contextName: string,
  options?: ResolveSelectorOptions | { warn: (message: string) => void }
): Promise<SelectorResolutionResult | null> {
  try {
    return await resolveSelector(page, group, contextName, options);
  } catch (err) {
    if (err instanceof SelectorNotFoundError) {
      return null;
    }
    return null;
  }
}

// ==============================================================================
// 5. Zero User Prompt Echo Blacklist & Semantic Guard (R2, R4, F10)
// ==============================================================================

/**
 * Comprehensive catalog of 42+ technical markers embedded into prompts generated by
 * Vanhsub (AiStudioPipelineEngine, ChatGptWebSessionManager, AiStudioLlmService).
 */
export const PROMPT_ECHO_MARKERS: readonly string[] = [
  // Master Prompt Template Instruction Headers
  'PHẦN F — CÁCH TRẢ LỜI',
  'PHẦN B — VÙNG CẤM SỬA',
  'PHẦN E — ĐẦU VÀO',
  'PHẦN D — CHẤT LƯỢNG VĂN',
  'PHẦN C — CỔNG NGUỒN: ĐỂ NHẸ',
  'PHẦN C — CỔNG NGUỒN',
  'PHẦN A — BỐ CỤC BẮT BUỘC',
  'PHẦN A — KHUÔN BẮT BUỘC',

  // Master Prompt Core Mandates & Contract Directives
  'Ba khối dưới đây là hợp đồng kỹ thuật',
  'Bạn là chuyên gia viết PRODUCTION MASTER PROMPT',
  'Bạn KHÔNG viết kịch bản. Bạn viết cái prompt sinh ra kịch bản',
  'Độ dài master prompt: 150–250 dòng',
  'Trích xuất toàn bộ nội dung master prompt',
  'Bắt đầu ngay bằng mục 1 SYSTEM ROLE',
  'Không diễn đạt lại, không rút gọn, không dịch, không gộp vào mục khác',
  'Tên kênh ở trên là TÊN THẬT. Viết nó thẳng vào mục 1',

  // Master Prompt Explanatory Suffixes
  '1. SYSTEM ROLE — model đóng vai ai',
  '2. INPUT — vùng nhận nguồn',
  '3. PRIMARY OBJECTIVE — độ dài mục tiêu',
  '4. CHANNEL DNA — 3-4 dòng ngắn định nghĩa',
  '4B. BRAND IDENTITY — nhận diện thương hiệu',
  '5. SIGNATURE BEAT — MỘT đoạn đặc trưng mà người xem quen',
  '6. NGUỒN & SỰ THẬT — phân loại dữ kiện',
  '7. CẤU TRÚC TẬP — chia theo mốc thời gian',
  '8. NARRATION & DELIVERY — viết cho TAI',
  '9. STRICT OUTPUT FORMAT — chép nguyên văn từ PHẦN B',

  // Idea Blueprint Section Context & Prompts
  '=== 1. ĐỊNH DANH DỰ ÁN & KÊNH ===',
  '=== 1B. BẢN SẮC & MÔ TẢ KÊNH ===',
  '=== 2. THỜI LƯỢNG MỤC TIÊU & QUY CHUẨN DÀN Ý ===',
  '=== 3. MASTER PROMPT & NGUYÊN TẮC KÊNH ===',
  '=== 4. PHONG CÁCH NGHỆ THUẬT & MODEL HÌNH ẢNH / VIDEO ===',
  '=== 5. KHÓA NHÂN VẬT ĐẠI DIỆN',
  'Bạn là Giám đốc Sáng tạo & Biên kịch trưởng',
  'Nhiệm vụ: Dựa trên chủ đề/ý tưởng đầu vào:',
  'Yêu cầu nghiêm ngặt: Trả về DUY NHẤT một khối JSON hợp lệ',
  'Yêu cầu số lượng phân đoạn trong dàn ý: BẮT BUỘC có ĐỦ từ',
  'Cả "thumbnailConcept" (tiếng Việt) và "thumbnailPrompt" (tiếng Anh) PHẢI đặt nhân vật',

  // Video Script Writing Instruction Markers
  'Bạn là biên kịch video ngắn chuyên nghiệp cho kênh video triệu view',
  'Bạn là nhà biên kịch YouTube cao cấp chuyên viết kịch bản lồng tiếng',
  'NHIỆM VỤ CỐT TỬ VỀ ĐỘ DÀI VÀ NỘI DUNG:',
  'QUY ĐỊNH ĐỊNH DẠNG BẮT BUỘC:',
  'Mỗi câu viết trên 1 dòng riêng biệt theo đúng cú pháp:',
  'CÂU 1: [Câu thoại mở đầu giật gân, cuốn hút người xem trong 3 giây đầu]',
  'CÂU 1: [Hook mở đầu búa bổ bằng danh từ riêng hoặc con số chấn động',
  'DÀN Ý PHÂN ĐOẠN CHI TIẾT (BẮT BUỘC BÁM SÁT VÀ PHÁT TRIỂN ĐỦ TẤT CẢ CÁC ĐOẠN NÀY):',
  'CHÚ Ý: Chỉ trả về các dòng bắt đầu bằng "CÂU X: ...", không thêm lời chào',
  'KHÔNG thêm lời chào mừng AI, KHÔNG thêm tiêu đề markdown phụ. Chỉ trả về danh sách các dòng bắt đầu bằng "CÂU X: ..."',
  'HOOK 3S BÚA BỔ MỞ ĐẦU:',
  'GÓC NHÌN TIẾP CẬN:',

  // Web UI Truncation & State Artifacts
  '… Xem thêm',
  'Xem thêm\nChatGPT đang phản hồi',
  'ChatGPT đang phản hồi',
  'Xem thêm\n',
  'Show more\n',
];

// Alias for compatibility
export const USER_PROMPT_ECHO_MARKERS = PROMPT_ECHO_MARKERS;

/**
 * Validates whether candidate text extracted from the DOM is an echo of the user's prompt.
 * Returns true if candidateText contains prompt instructions or UI echo artifacts.
 * Returns false on genuine assistant responses (scripts, JSON blueprints, generated master prompts).
 */
export function isUserPromptEcho(candidateText: string): boolean {
  if (!candidateText || typeof candidateText !== 'string') {
    return false;
  }

  const trimmed = candidateText.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // 1. Direct match on short continuation command prompt echoes (with punctuation normalization)
  const normalizedLower = trimmed.toLowerCase().replace(/[\.\!\?…\s]+$/g, '');
  const shortPromptEchoes = [
    'tiếp tục viết phần còn lại',
    'tiếp tục viết tiếp',
    'tiếp tục viết tiếp kịch bản',
    'tiếp tục phần kịch bản còn lại',
    'tiếp tục',
    'continue',
    'continue writing',
    'continue generating',
    'please continue',
  ];
  if (shortPromptEchoes.includes(normalizedLower)) {
    return true;
  }

  // 2. Exhaustive marker scanning across technical instructions
  // Use candidateText directly to preserve markers with trailing newlines (e.g. 'Xem thêm\n', 'Show more\n')
  for (const marker of PROMPT_ECHO_MARKERS) {
    if (candidateText.includes(marker) || trimmed.includes(marker)) {
      return true;
    }
    const markerTrimmed = marker.trim();
    if (marker !== markerTrimmed && markerTrimmed.length > 0 && trimmed.includes(markerTrimmed)) {
      return true;
    }
  }

  return false;
}

// ==============================================================================
// 6. DOM-Level Turn Discrimination & Overlay Utilities
// ==============================================================================

/**
 * Dismisses any open overlays, modals, onboarding dialogs, or survey popups.
 * Safe to invoke repeatedly; swallows non-critical errors.
 *
 * @param page Playwright Page instance or simulated page fixture
 * @returns Number of overlays successfully dismissed
 */
export async function dismissOverlays(page: any): Promise<number> {
  if (!page || typeof page.locator !== 'function') return 0;
  let dismissedCount = 0;

  try {
    const overlayRes = await tryResolveSelector(
      page,
      CHATGPT_SELECTORS.closeOverlayButton,
      'closeOverlayButton'
    );
    if (overlayRes && overlayRes.locator) {
      if (typeof overlayRes.locator.click === 'function') {
        await overlayRes.locator.click({ timeout: 1500 }).catch(() => {});
        dismissedCount++;
      }
    }
  } catch {
    // Non-fatal overlay dismissal attempt
  }

  return dismissedCount;
}

/**
 * Checks whether a Playwright locator represents a user message turn.
 */
export async function isElementUserTurn(locator: any): Promise<boolean> {
  if (!locator) return false;
  try {
    const authorRole = typeof locator.getAttribute === 'function' ? await locator.getAttribute('data-message-author-role') : null;
    if (authorRole === 'user') return true;

    if (typeof locator.locator === 'function') {
      const userDescendant = locator.locator('[data-message-author-role="user"]');
      if (typeof userDescendant.count === 'function' && (await userDescendant.count()) > 0) return true;

      const editBtn = locator.locator(
        'button[aria-label*="Edit"], button[aria-label*="Chỉnh sửa"], [data-testid="edit-user-message"]'
      );
      if (typeof editBtn.count === 'function' && (await editBtn.count()) > 0) return true;
    }
  } catch {
    // Non-fatal inspection error
  }
  return false;
}

/**
 * Checks whether a Playwright locator represents an assistant response turn.
 */
export async function isElementAssistantTurn(locator: any): Promise<boolean> {
  if (!locator) return false;
  try {
    if (await isElementUserTurn(locator)) return false;

    const authorRole = typeof locator.getAttribute === 'function' ? await locator.getAttribute('data-message-author-role') : null;
    if (authorRole === 'assistant') return true;
    const searchKey = typeof locator.getAttribute === 'function' ? await locator.getAttribute('data-chatgpt-search-unit-key') : null;
    if (searchKey?.endsWith(':assistant')) return true;
    if (typeof locator.locator === 'function' &&
        await locator.locator(':scope > [data-conversation-role="assistant"]').count() > 0) return true;

    // Check if the element itself matches assistant classes (.markdown, .prose) or attributes
    const classAttr = typeof locator.getAttribute === 'function' ? await locator.getAttribute('class') : null;
    if (classAttr && /\b(?:markdown|prose)\b/.test(classAttr)) {
      return true;
    }

    // Support simulated mocks where classList is stored on the element object
    const classList = (locator as any).element?.classList || (locator as any).matchesList?.[0]?.classList;
    if (Array.isArray(classList) && (classList.includes('markdown') || classList.includes('prose'))) {
      return true;
    }

    // In real Playwright, evaluate classList or element match if available
    if (typeof locator.evaluate === 'function') {
      const isSelfMarkdown = await locator.evaluate((el: any) => {
        return el.classList?.contains('markdown') || el.classList?.contains('prose') || el.matches?.('div.markdown, .markdown, .prose');
      }).catch(() => false);
      if (isSelfMarkdown) return true;
    }

    if (typeof locator.locator === 'function') {
      const assistantDescendant = locator.locator('[data-message-author-role="assistant"]');
      if (typeof assistantDescendant.count === 'function' && (await assistantDescendant.count()) > 0) return true;

      const copyBtn = locator.locator(
        'button[aria-label*="Copy"], button[aria-label*="Sao chép"], [data-testid="copy-turn-action-button"], button[data-testid="good-response"]'
      );
      if (typeof copyBtn.count === 'function' && (await copyBtn.count()) > 0) return true;

      const markdown = locator.locator('div.markdown, .markdown, .prose');
      if (typeof markdown.count === 'function' && (await markdown.count()) > 0) return true;
    }
  } catch {
    // Non-fatal inspection error
  }
  return false;
}

/**
 * Queries all assistant turns on the page, strictly excluding user turns.
 */
export async function getAssistantTurns(page: any): Promise<any[]> {
  if (!page || typeof page.locator !== 'function') return [];
  const primaryLoc = page.locator(CHATGPT_SELECTORS.assistantTurn.primary);
  const count = typeof primaryLoc.count === 'function' ? await primaryLoc.count() : 0;
  const validTurns: any[] = [];

  if (count > 0) {
    for (let i = 0; i < count; i++) {
      const turn = typeof primaryLoc.nth === 'function' ? primaryLoc.nth(i) : primaryLoc;
      if (!(await isElementUserTurn(turn))) {
        validTurns.push(turn);
      }
    }
  }

  // Fallback selector cascade if primary returns 0 turns
  if (validTurns.length === 0) {
    for (const fb of CHATGPT_SELECTORS.assistantTurn.fallbacks) {
      const fbLoc = page.locator(fb);
      const fbCount = typeof fbLoc.count === 'function' ? await fbLoc.count() : 0;
      if (fbCount > 0) {
        for (let i = 0; i < fbCount; i++) {
          const turn = typeof fbLoc.nth === 'function' ? fbLoc.nth(i) : fbLoc;
          if (await isElementAssistantTurn(turn)) {
            validTurns.push(turn);
          }
        }
        if (validTurns.length > 0) break;
      }
    }
  }

  return validTurns;
}

/**
 * Gets the latest assistant turn locator.
 */
export async function getLastAssistantTurn(page: any): Promise<any | null> {
  const turns = await getAssistantTurns(page);
  if (turns.length === 0) return null;
  return turns[turns.length - 1];
}

/** Read only the answer body, never a shared clipboard or a container including the user turn. */
export async function readAssistantTurnText(turn: any): Promise<string> {
  if (!turn) return '';
  if (typeof turn.locator === 'function') {
    // The current UI uses a role heading followed by the rendered response body.
    for (const selector of [':scope > [data-conversation-role="assistant"] ~ div', '.markdown:not(.markdown .markdown), .prose:not(.markdown .prose):not(.prose .prose)']) {
      const bodies = turn.locator(selector);
      const count = await bodies.count();
      if (count > 0) {
        const parts: string[] = [];
        for (let i = 0; i < count; i++) {
          const body = bodies.nth(i);
          parts.push(await body.innerText({ timeout: 1500 }));
        }
        return parts.join('\n\n').trim();
      }
    }
  }
  return ((typeof turn.innerText === 'function'
    ? await turn.innerText({ timeout: 1500 }) : await turn.textContent({ timeout: 1500 })) || '').trim();
}

/**
 * Extracts and cleans text from the latest assistant turn, running it through the echo guard.
 */
export async function extractCleanAssistantText(
  page: any
): Promise<{ text: string; isEcho: boolean; hasContent: boolean }> {
  const lastTurn = await getLastAssistantTurn(page);
  if (!lastTurn) {
    return { text: '', isEcho: false, hasContent: false };
  }

  let text = '';
  if (typeof lastTurn.locator === 'function') {
    const mdLoc = lastTurn.locator('div.markdown, .markdown, .prose');
    if ((await mdLoc.count()) > 0) {
      text = typeof mdLoc.first().innerText === 'function'
        ? await mdLoc.first().innerText()
        : await mdLoc.first().textContent();
    } else {
      text = typeof lastTurn.innerText === 'function'
        ? await lastTurn.innerText()
        : await lastTurn.textContent();
    }
  } else {
    text = typeof lastTurn.innerText === 'function'
      ? await lastTurn.innerText()
      : await lastTurn.textContent();
  }

  // Clean Web UI boilerplate headers and footers
  text = (text || '')
    .replace(/^[^\n]*ChatGPT\s*(?:đã\s*nói|said)\s*:?\s*\n*/i, '')
    .replace(/\n+ChatGPT có thể mắc lỗi[\s\S]*$/i, '')
    .replace(/\n+ChatGPT can make mistakes[\s\S]*$/i, '')
    .trim();

  const isEcho = isUserPromptEcho(text);
  return {
    text,
    isEcho,
    hasContent: text.length > 0 && !isEcho,
  };
}
