/**
 * ChatGptScriptCollector.ts
 *
 * Vanhsub AI Video Studio - Playwright CDP Script Collector, Safe Input & Continuation Engine.
 *
 * Core Capabilities:
 * 1. 3-Tier Safe Input Injection:
 *    - Tier 1: locator.fill() (fastest, cleanest native event dispatch)
 *    - Tier 2: locator.click() + select-all/clear + chunked/sequential keyboard typing
 *    - Tier 3: in-DOM page.evaluate() with ProseMirror transaction dispatch + execCommand('insertText')
 * 2. Pre-Submission Presence Verification:
 *    - Verifies text presence inside prompt input with minimum length ratio >= 80%.
 * 3. Safe Submission & Verification:
 *    - Clicks sendButton with fallback to Enter keypress on promptTextarea.
 *    - Confirms submission via textarea clearance OR stopButton appearance.
 * 4. Streaming Detection & Triple-Cycle Stability Checking:
 *    - Detects active streaming (stopButton, .result-streaming, [data-testid="thinking-container"]).
 *    - Awaits stopButton disappearance, then polls latest assistant turn length at ~900ms intervals.
 *    - Declares output settled when text length is invariant across >= 3 consecutive cycles.
 * 5. Lossless Content Extraction:
 *    - Read the assistant response body directly, without touching the shared clipboard.
 *    - Zero User Prompt Echo validation guarding against echoing back prompts.
 * 6. Dual-Track Long Script Continuation & Seamless Stitching:
 *    - Multi-criteria truncation detection (cutoff sentence, missing markers, beat deficit, continueButton).
 *    - Priority 1: Native "Continue generating" UI button click.
 *    - Priority 2: Structured continuation prompt injection.
 *    - Bound by max continuation turns (default: 5).
 *    - Seamless multi-turn stitching: strips LLM filler intros, reconciles broken lines & duplicate beat headers.
 * 7. Resilience & Error Discrimination:
 *    - Discriminates ChatGptSessionExpiredError and ChatGptCloudflareChallengeError.
 *    - Retries transient DOM/network errors using exponential backoff with jitter.
 *
 * Conforms to:
 * - ORIGINAL_REQUEST.md (§ 2026-10-05T11:03:12Z - Requirement R3)
 * - PROJECT.md (§ Interface Contracts lines 140–165; Features F11–F20)
 *
 * Location: main/ai-studio/chatgpt/ChatGptScriptCollector.ts
 */

import type { Page, Locator } from 'playwright-core';
import {
  CHATGPT_SELECTORS,
  resolveSelector,
  tryResolveSelector,
  dismissOverlays,
  isUserPromptEcho,
  getLastAssistantTurn,
  getAssistantTurns,
  readAssistantTurnText,
} from './chatgptSelectors.config';
import { ChatGptCdpClient } from './ChatGptCdpClient';
import { ChromeManager } from './ChromeManager';
import { parseChatGptScriptResponse } from './ChatGptWebSessionManager';

// ==============================================================================
// 1. Types & Interface Contracts (PROJECT.md § Interface Contracts)
// ==============================================================================

export type ScriptKind = 'script' | 'idea' | 'master_prompt' | 'raw';

/** Textareas retain their initial textContent after value is cleared; never use it as a fallback. */
export async function readComposerText(locator: any): Promise<string> {
  if (typeof locator.inputValue === 'function') {
    try { return await locator.inputValue({ timeout: 1500 }); } catch { /* contenteditable */ }
  }
  if (typeof locator.evaluate === 'function') {
    return await locator.evaluate((el: HTMLElement) =>
      el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
        ? el.value : el.innerText || el.textContent || '', undefined, { timeout: 1500 });
  }
  // Compatibility with lightweight test adapters without element evaluation.
  return typeof locator.innerText === 'function'
    ? await locator.innerText({ timeout: 1500 }) : await locator.textContent({ timeout: 1500 }) || '';
}

async function readUserTurnState(page: any): Promise<{ count: number; text: string }> {
  const turns = page.locator('[data-message-author-role="user"], [data-chatgpt-search-unit-key$=":user"]');
  const count = await turns.count();
  const last = count > 0 ? turns.nth(count - 1) : null;
  return { count, text: last ? await last.innerText({ timeout: 1500 }) : '' };
}

export interface CollectScriptOptions {
  prompt?: string;
  kind?: ScriptKind;
  targetMinSentences?: number;
  targetMaxSentences?: number;
  onProgress?: (message: string) => void;
  onStreamingChunk?: (chunk: string) => void;
  startNewChat?: boolean;
  targetUrl?: string;
  timeoutMs?: number;
  maxContinuationTurns?: number;
  preferClipboard?: boolean;
  retryBaseDelayMs?: number;
  maxRetries?: number;
  topic?: string;
  initialTurnCount?: number;
}

export interface ScriptCollectionOptions {
  prompt: string;
  kind?: ScriptKind;
  targetMinSentences?: number;
  targetMaxSentences?: number;
  onProgress?: (message: string) => void;
  onStreamingChunk?: (chunk: string) => void;
  startNewChat?: boolean;
  targetUrl?: string;
  timeoutMs?: number;
  maxContinuationTurns?: number;
  preferClipboard?: boolean;
  retryBaseDelayMs?: number;
  maxRetries?: number;
  topic?: string;
  initialTurnCount?: number;
}

export interface ScriptCollectionResult {
  /** Complete extracted text after all continuation turns and stitching */
  text: string;
  /** Backward-compatible alias for text (PROJECT.md) */
  rawText: string;
  /** Total turns involved in the collection (initial turn + continued turns) */
  turnCount: number;
  /** Total collection duration in milliseconds */
  durationMs: number;
  /** Word count of the final stitched response */
  wordCount: number;
  /** Whether the script remained truncated after reaching max continuation turns */
  isTruncated: boolean;
  /** Number of continuation turns executed (0 if turn 1 was complete) */
  continuedTurns: number;
  /** Backward-compatible boolean flag indicating if continuation was triggered */
  continuationTriggered: boolean;
  /** URL of the active conversation on ChatGPT Web */
  conversationUrl: string;
}

export interface SendPromptOptions {
  /** Timeout in milliseconds for each injection tier (default: 4000ms) */
  tierTimeoutMs?: number;
  /** Typing delay in milliseconds for Tier 2 typing (default: 0ms) */
  typingDelayMs?: number;
  /** Chunk size for long prompt chunked typing in Tier 2 (default: 200 chars) */
  chunkSize?: number;
  /** Minimum text presence verification ratio (default: 0.8) */
  minVerificationRatio?: number;
  /** Whether to dismiss overlays before typing (default: true) */
  dismissOverlays?: boolean;
  /** Maximum wait time in milliseconds for send button to be enabled (default: 3500ms) */
  sendButtonTimeoutMs?: number;
  /** Maximum wait time in milliseconds for submission verification (default: 6000ms) */
  submissionVerificationTimeoutMs?: number;
  /** Progress notification callback */
  onProgress?: (message: string) => void;
  /** Custom logger for diagnostics */
  logger?: { log: (msg: string) => void; warn: (msg: string) => void; error?: (msg: string) => void };
}

export interface StreamingWaitOptions {
  /** Native Continue can extend the same turn; require a change before accepting it. */
  initialResponseText?: string;
  /** Maximum time in milliseconds to wait for streaming to start (default: 15,000ms) */
  startTimeoutMs?: number;
  /** Interval in milliseconds between stability polling checks (default: 1200ms per PROJECT.md) */
  pollIntervalMs?: number;
  /** Number of consecutive stable cycles required to declare completion (default: 3) */
  requiredStableCycles?: number;
  /** Turn count threshold to isolate new assistant turns */
  initialTurnCount?: number;
  /** Progress notification callback */
  onProgress?: (message: string) => void;
  /** Streaming chunk callback */
  onStreamingChunk?: (chunk: string) => void;
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  jitterMs?: number;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

// ==============================================================================
// 2. Custom Diagnostic Error Classes
// ==============================================================================

/**
 * Thrown when the ChatGPT Web session has expired or redirected to /auth/login.
 */
export class ChatGptSessionExpiredError extends Error {
  public readonly isAuthError = true;
  public readonly currentUrl?: string;

  constructor(currentUrl?: string) {
    super(
      `[ChatGptSessionExpiredError] Phiên đăng nhập ChatGPT Web đã hết hạn hoặc bị chuyển hướng sang trang đăng nhập (${currentUrl || 'N/A'}). ` +
      `Vui lòng bấm 'Đăng nhập ChatGPT' trên giao diện VANHSUB để mở Chrome và hoàn tất đăng nhập lại 1 lần.`
    );
    this.name = 'ChatGptSessionExpiredError';
    this.currentUrl = currentUrl;
    Object.setPrototypeOf(this, ChatGptSessionExpiredError.prototype);
  }
}

/**
 * Thrown when Cloudflare Turnstile challenge intercepts page navigation.
 */
export class ChatGptCloudflareChallengeError extends Error {
  public readonly isCloudflare = true;
  public readonly currentUrl?: string;

  constructor(currentUrl?: string) {
    super(
      `[ChatGptCloudflareChallengeError] ChatGPT Web đang bị chặn bởi màn hình thử thách bảo mật Cloudflare Turnstile ('Just a moment...'). ` +
      `Vui lòng mở trình duyệt Chrome (Port 9223) và vượt qua bài kiểm tra người dùng thật để tiếp tục.`
    );
    this.name = 'ChatGptCloudflareChallengeError';
    this.currentUrl = currentUrl;
    Object.setPrototypeOf(this, ChatGptCloudflareChallengeError.prototype);
  }
}

/**
 * Thrown when all 3 input injection tiers fail to populate the prompt into the DOM.
 */
export class ChatGptInputInjectionError extends Error {
  public readonly attemptedTiers: number[];
  public readonly promptLength: number;
  public readonly diagnostics: Record<string, string>;

  constructor(message: string, attemptedTiers: number[], promptLength: number, diagnostics: Record<string, string>) {
    super(
      `[ChatGptInputInjectionError] ${message} (Tiers đã thử: [${attemptedTiers.join(', ')}], Độ dài: ${promptLength} chars). Chi tiết: ${JSON.stringify(diagnostics)}`
    );
    this.name = 'ChatGptInputInjectionError';
    this.attemptedTiers = attemptedTiers;
    this.promptLength = promptLength;
    this.diagnostics = diagnostics;
    Object.setPrototypeOf(this, ChatGptInputInjectionError.prototype);
  }
}

/**
 * Thrown when assistant streaming exceeds the configured timeout threshold.
 */
export class ChatGptStreamingTimeoutError extends Error {
  public readonly elapsedMs: number;
  public readonly lastObservedLength: number;
  public readonly stopButtonStillPresent: boolean;
  public readonly currentUrl?: string;

  constructor(message: string, elapsedMs: number, lastObservedLength: number, stopButtonStillPresent: boolean, currentUrl?: string) {
    super(message);
    this.name = 'ChatGptStreamingTimeoutError';
    this.elapsedMs = elapsedMs;
    this.lastObservedLength = lastObservedLength;
    this.stopButtonStillPresent = stopButtonStillPresent;
    this.currentUrl = currentUrl;
    Object.setPrototypeOf(this, ChatGptStreamingTimeoutError.prototype);
  }
}

/**
 * Thrown when extracted response matches prompt echo markers.
 */
export class AssistantResponseEchoError extends Error {
  public readonly capturedTextPreview: string;

  constructor(message: string, capturedText: string) {
    super(message);
    this.name = 'AssistantResponseEchoError';
    this.capturedTextPreview = capturedText.slice(0, 150);
    Object.setPrototypeOf(this, AssistantResponseEchoError.prototype);
  }
}

// ==============================================================================
// 3. Helper Functions: Health, Resilience, Continuation & Stitching
// ==============================================================================

/**
 * Proactively verifies page health against unauthenticated redirects and Cloudflare challenges.
 */
export async function assertPageHealth(page: any): Promise<void> {
  if (!page) {
    throw new Error('[ChatGptScriptCollector] Page reference is null or unavailable.');
  }

  let currentUrl = '';
  try {
    currentUrl = typeof page.url === 'function' ? page.url() : (page.currentUrl || '');
  } catch {}

  // 1. URL-based check
  if (currentUrl.includes('/auth/login') || currentUrl.includes('accounts.google.com')) {
    throw new ChatGptSessionExpiredError(currentUrl);
  }

  if (currentUrl.includes('__cf_chl') || currentUrl.includes('challenge-running')) {
    throw new ChatGptCloudflareChallengeError(currentUrl);
  }

  // 2. DOM-based Cloudflare challenge check
  if (CHATGPT_SELECTORS.cloudflareChallenge) {
    const cfRes = await tryResolveSelector(page, CHATGPT_SELECTORS.cloudflareChallenge, 'cloudflareChallenge');
    if (cfRes && cfRes.locator) {
      const isVis = typeof cfRes.locator.isVisible === 'function'
        ? await cfRes.locator.isVisible().catch(() => false)
        : true;
      if (isVis) {
        throw new ChatGptCloudflareChallengeError(currentUrl);
      }
    }
  }

  // 3. DOM-based Login Screen check
  if (CHATGPT_SELECTORS.loginScreen) {
    const loginRes = await tryResolveSelector(page, CHATGPT_SELECTORS.loginScreen, 'loginScreen');
    if (loginRes && loginRes.locator) {
      const isVis = typeof loginRes.locator.isVisible === 'function'
        ? await loginRes.locator.isVisible().catch(() => false)
        : true;
      if (isVis) {
        throw new ChatGptSessionExpiredError(currentUrl);
      }
    }
  }

  // 4. Page title check
  try {
    const title = typeof page.title === 'function' ? await page.title().catch(() => '') : '';
    if (/just a moment/i.test(title) || /cloudflare/i.test(title)) {
      throw new ChatGptCloudflareChallengeError(currentUrl);
    }
  } catch {}
}

/**
 * Distinguishes fatal errors (Session Expired, Cloudflare, Quota) from transient retryable errors.
 */
export function isTransientError(error: any): boolean {
  if (!error) return false;

  if (error instanceof ChatGptSessionExpiredError || error.isAuthError) return false;
  if (error instanceof ChatGptCloudflareChallengeError || error.isCloudflare) return false;

  const msg = (error?.message || String(error)).toLowerCase();

  // Quota limits should not retry blindly
  if (msg.includes("you've reached our limit") || msg.includes('rate limit reached') || msg.includes('usage cap')) {
    return false;
  }

  const transientPatterns = [
    'execution context was destroyed',
    'target page, context or browser has been closed',
    'node is detached from document',
    'element is not attached',
    'navigation timeout',
    'timeout 30000ms exceeded',
    'err_connection_reset',
    'err_network_changed',
    'econnreset',
    'etimedout',
    'socket hang up',
  ];

  return transientPatterns.some((pattern) => msg.includes(pattern));
}

/**
 * Retries an asynchronous operation with exponential backoff and jitter for transient errors.
 */
export async function retryWithBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1500;
  const maxDelayMs = options?.maxDelayMs ?? 10000;
  const backoffFactor = options?.backoffFactor ?? 2.0;
  const jitterMs = options?.jitterMs ?? 500;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation(attempt);
    } catch (err: any) {
      lastError = err;

      if (!isTransientError(err) || attempt >= maxRetries) {
        throw err;
      }

      const calculatedDelay = Math.min(
        maxDelayMs,
        baseDelayMs * Math.pow(backoffFactor, attempt - 1)
      );
      const jitter = Math.random() * jitterMs;
      const effectiveDelay = Math.round(calculatedDelay + jitter);

      if (options?.onRetry) {
        options.onRetry(attempt, err, effectiveDelay);
      } else {
        console.warn(
          `[ChatGptScriptCollector] Transient error on attempt ${attempt}/${maxRetries} (${err?.message || err}). ` +
          `Retrying in ${effectiveDelay}ms...`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, effectiveDelay));
    }
  }

  throw lastError;
}

/**
 * Detects whether the trailing line of text terminates prematurely mid-sentence.
 */
export function isCutoffSentence(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;

  const lastLine = lines[lines.length - 1];

  // 1. Explicit completion markers, markdown closing code fences
  if (
    /^(?:={3,}|-{3,})\s*(?:END\s*SCRIPT|END\s*JSON|SOURCE\s*END|END\s*OF\s*SCRIPT|END\s*BLUEPRINT|END\s*MASTER\s*PROMPT|END|KẾT\s*THÚC|HOÀN\s*TẤT)\s*(?:={3,}|-{3,})$/i.test(lastLine) ||
    /===\s*(?:END\s*SCRIPT|END\s*JSON|SOURCE\s*END|END\s*BLUEPRINT|END\s*MASTER\s*PROMPT)\s*===$/i.test(lastLine) ||
    /---\s*END\s*OF\s*SCRIPT\s*---/i.test(lastLine) ||
    /^```(?:\s*)$/.test(lastLine) ||
    /```\s*$/.test(lastLine)
  ) {
    return false;
  }

  // 2. Incomplete scene/beat header indicates a cutoff (e.g. "CÂU 5:", "**CÂU 10**", "Beat 3 -")
  const incompleteHeaderPattern = /^(?:\*{0,2}(?:CÂU|Câu|Beat|Phân cảnh)\s*\d+[\s:\-\.]*\*{0,2})$/i;
  if (incompleteHeaderPattern.test(lastLine)) {
    return true;
  }

  // 3. Dangling connectors indicate a cutoff
  const danglingConnectorPattern = /[,:\-;(\[\{]$/;
  if (danglingConnectorPattern.test(lastLine)) {
    return true;
  }

  // 4. Closing JSON braces or bracket tokens
  if (/[}\]]$/.test(lastLine)) {
    return false;
  }

  // 5. Terminal punctuation indicators (including quotes, fullwidth CJK, and trailing markdown formatting)
  const terminalPunctuationPattern = /[.!?…"\u201D\u2019\u00BB\u203A\)\]\}\u3002\uFF01\uFF1F]$/;

  const cleanLastLine = lastLine.replace(/[\s*_~`]+$/, '');
  if (cleanLastLine && terminalPunctuationPattern.test(cleanLastLine)) {
    return false;
  }
  if (terminalPunctuationPattern.test(lastLine)) {
    return false;
  }

  // 6. Default: Missing terminal punctuation -> cutoff detected
  return true;
}

/**
 * Checks whether an expected closing marker is missing from the output.
 */
export function hasCompleteIdeaJson(text: string): boolean {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return false;
  try { JSON.parse(text.slice(start, end + 1)); return true; } catch { return false; }
}

export function hasCompleteMasterPrompt(text: string): boolean {
  return /SYSTEM\s*ROLE/i.test(text) && /STRICT\s*OUTPUT\s*FORMAT/i.test(text) &&
    /NARRATION\s*DIRECTION\s*:/i.test(text) &&
    /Output\s+NOTHING\s+else\.[\s\S]*?no\s+commentary\./i.test(text);
}

export function isMissingExpectedMarker(text: string, kind?: ScriptKind): boolean {
  if (!text || typeof text !== 'string') return false;

  if (kind === 'script') {
    const hasBegin = /===\s*BEGIN\s*SCRIPT\s*===/i.test(text);
    const hasEnd = /===\s*END\s*SCRIPT\s*===/i.test(text);
    if (hasBegin && !hasEnd) return true;

    const hasScriptHeader = /SCRIPT:\s*/i.test(text);
    const hasScriptEnd = /---\s*END OF SCRIPT\s*---|NARRATION DIRECTION:/i.test(text);
    if (hasScriptHeader && !hasScriptEnd) return true;
  }

  if (kind === 'idea') return !hasCompleteIdeaJson(text);

  if (kind === 'master_prompt') return !hasCompleteMasterPrompt(text);

  return false;
}

/**
 * Catalog of introductory LLM filler phrases to strip from continuation turns.
 */
export const CONTINUATION_FILLER_PATTERNS: readonly RegExp[] = [
  // 1. Standalone conversational affirmation line: e.g. "Chắc chắn rồi!", "Vâng,", "Được rồi!"
  /^(?:Chắc chắn rồi|Vâng|Dạ|Được rồi|Tất nhiên)[,!.]?\s*\n+/i,

  // 2. Affirmation + continuation preamble: e.g. "Chắc chắn rồi! Dưới đây là...", "Vâng, tôi sẽ tiếp tục..."
  /^(?:Chắc chắn rồi|Vâng|Dạ|Được rồi|Tất nhiên)[,!.]?\s*(?:tôi sẽ|mình sẽ|chúng ta sẽ|dưới đây là|sau đây là)?\s*(?:tiếp tục|viết tiếp|gửi bạn|bổ sung)?[^\n]*:?\s*\n+/i,

  // 3. Vietnamese introductory phrases with compound modifiers (phần, kịch bản, nội dung, phân cảnh...)
  /^(?:Dưới đây là|Đây là|Tiếp theo là|Sau đây là)\s+(?:phần(?:\s+kịch\s+bản|\s+nội\s+dung)?|các phân cảnh|kịch bản|nội dung)(?:\s+(?:tiếp theo|còn lại|kế tiếp|viết tiếp)|\s+của\s+kịch\s+bản)?[^\n]*:?\s*\n+/i,

  // 4. Direct continuation headers
  /^(?:Kịch bản tiếp tục|Tiếp tục kịch bản|Phần kịch bản tiếp theo|Kịch bản tiếp theo|Tiếp tục phân cảnh|Phần tiếp theo)[^\n]*:?\s*\n+/i,

  // 5. Continue from beat number
  /^(?:Tiếp tục|Viết tiếp)\s+(?:từ\s+)?(?:CÂU|Câu|Beat|Phân cảnh)\s*\d+[^\n]*:?\s*\n+/i,

  // 6. English introductory phrases
  /^(?:Here is|Here are)\s+(?:the\s+)?(?:continuation(?:\s+of\s+the\s+script)?|next\s+scenes|rest\s+of\s+the\s+script|remaining\s+scenes)[^\n]*:?\s*\n+/i,

  // 7. English affirmations
  /^(?:Sure|Certainly|Of course)[,!.]?\s*(?:here is the rest|continuing with the script|here is the continuation|continuing from where we left off)[^\n]*:?\s*\n+/i,

  // 8. English continuation headers
  /^(?:Continuing the script|Continuing from where we left off|Next scenes|Script continuation)[^\n]*:?\s*\n+/i,

  // 9. Structural markers duplicated on continuation turn
  /^\s*===\s*BEGIN\s*SCRIPT\s*===\s*\n+/i,
  /^\s*===\s*BEGIN\s*JSON\s*===\s*\n+/i,
  /^\s*```(?:json|markdown)?\s*\n+/i,
];

/**
 * Strips conversational filler preambles from a continuation turn.
 */
export function stripContinuationFillerIntros(turnText: string): string {
  if (!turnText || typeof turnText !== 'string') return '';
  let cleaned = turnText.trim();

  let maxIterations = 5;
  let changed = true;
  while (changed && maxIterations-- > 0) {
    changed = false;
    for (const pattern of CONTINUATION_FILLER_PATTERNS) {
      if (pattern.test(cleaned)) {
        cleaned = cleaned.replace(pattern, '').trim();
        changed = true;
      }
    }
  }

  return cleaned;
}

/**
 * Merges multi-turn script outputs formatted as CÂU X: ... seamlessly.
 */
export function stitchScriptTurns(turns: string[]): string {
  if (!turns || turns.length === 0) return '';
  if (turns.length === 1) return stripContinuationFillerIntros(turns[0]);

  let combined = '';

  for (let turnIdx = 0; turnIdx < turns.length; turnIdx++) {
    const rawTurn = turns[turnIdx];
    const cleanedTurn = turnIdx === 0 ? rawTurn.trim() : stripContinuationFillerIntros(rawTurn);
    if (!cleanedTurn) continue;

    if (turnIdx === 0) {
      combined = cleanedTurn;
      continue;
    }

    const prevLines = combined.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const currLines = cleanedTurn.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    if (prevLines.length === 0) {
      combined = cleanedTurn;
      continue;
    }
    if (currLines.length === 0) {
      continue;
    }

    const lastPrevLine = prevLines[prevLines.length - 1];
    const firstCurrLine = currLines[0];

    // Case 1: Line number collision (Turn K ended with truncated CÂU N, Turn K+1 repeats full CÂU N)
    const prevMatch = lastPrevLine.match(/^(?:\*{0,2}(?:CÂU|Câu|Beat|Phân cảnh)\s*(\d+)[\s:\-\.]+\*{0,2})(.*)/i);
    const currMatch = firstCurrLine.match(/^(?:\*{0,2}(?:CÂU|Câu|Beat|Phân cảnh)\s*(\d+)[\s:\-\.]+\*{0,2})(.*)/i);

    if (prevMatch && currMatch && prevMatch[1] === currMatch[1]) {
      const prevWithoutLast = prevLines.slice(0, prevLines.length - 1);
      const longerLine = firstCurrLine.length >= lastPrevLine.length ? firstCurrLine : lastPrevLine;
      const mergedCurrLines = [longerLine, ...currLines.slice(1)];
      combined = [...prevWithoutLast, ...mergedCurrLines].join('\n');
      continue;
    }

    // Case 2: Turn K ended mid-sentence without CÂU prefix on Turn K+1 head
    if (isCutoffSentence(lastPrevLine) && !currMatch && !firstCurrLine.startsWith('===')) {
      const prevWithoutLast = prevLines.slice(0, prevLines.length - 1);
      const seamlessJoinedLine = `${lastPrevLine} ${firstCurrLine}`;
      combined = [...prevWithoutLast, seamlessJoinedLine, ...currLines.slice(1)].join('\n');
      continue;
    }

    // Case 3: Turn K ended cleanly, Turn K+1 continues normally
    combined = `${combined}\n${cleanedTurn}`;
  }

  return combined;
}

/**
 * Merges general prose / markdown turns using sliding-window overlap reconciliation.
 */
export function stitchProseTurns(prevText: string, nextText: string, maxOverlap = 250): string {
  const cleanPrev = prevText.trim();
  const cleanNext = stripContinuationFillerIntros(nextText).trim();

  if (!cleanPrev) return cleanNext;
  if (!cleanNext) return cleanPrev;

  const maxSearch = Math.min(cleanPrev.length, cleanNext.length, maxOverlap);
  let bestOverlapLen = 0;

  for (let len = 15; len <= maxSearch; len++) {
    const prevSuffix = cleanPrev.slice(cleanPrev.length - len);
    const nextPrefix = cleanNext.slice(0, len);
    if (prevSuffix.toLowerCase() === nextPrefix.toLowerCase()) {
      bestOverlapLen = len;
    }
  }

  if (bestOverlapLen > 0) {
    return cleanPrev + cleanNext.slice(bestOverlapLen);
  }

  if (isCutoffSentence(cleanPrev)) {
    return `${cleanPrev} ${cleanNext}`;
  }

  return `${cleanPrev}\n\n${cleanNext}`;
}

/**
 * Builds a targeted continuation prompt based on generated context and target metrics.
 */
export function buildContinuationPrompt(options: {
  kind?: ScriptKind;
  currentText: string;
  targetMinSentences?: number;
  targetMaxSentences?: number;
  topic?: string;
  initialTurnCount?: number;
}): string {
  const { kind = 'script', currentText, targetMinSentences = 40, targetMaxSentences = 60, topic = '' } = options;

  if (kind === 'script') {
    const parsedBeats = parseChatGptScriptResponse(currentText, topic);
    const currentCount = parsedBeats.length;
    const isCutoff = isCutoffSentence(currentText);
    const lastBeat = parsedBeats[parsedBeats.length - 1];

    if (isCutoff && lastBeat) {
      const nextEnd = Math.min(targetMaxSentences, Math.max(currentCount + 15, targetMinSentences));
      return (
        `Bạn vừa dừng giữa chừng ở CÂU ${lastBeat.index}. Hãy tiếp tục viết liền mạch phần còn lại bắt đầu từ câu này, ` +
        `không lặp lại những câu đã hoàn thành trước đó. Tiếp tục viết các phân cảnh tiếp theo đến CÂU ${nextEnd} ` +
        `và kết thúc bằng marker === END SCRIPT ===.`
      );
    }

    if (currentCount > 0 && currentCount < targetMinSentences) {
      const nextStart = currentCount + 1;
      const nextEnd = Math.min(targetMaxSentences, nextStart + Math.max(16, targetMinSentences - currentCount + 2));
      return (
        `tiếp tục viết liền mạch phần còn lại từ CÂU ${nextStart} đến CÂU ${nextEnd}. ` +
        `Giữ nguyên đúng định dạng mỗi câu trên 1 dòng: CÂU X: [Nội dung]. Tuyệt đối không lặp lại các câu trước. ` +
        `CÂU ${nextEnd} là phần kết luận và kêu gọi đăng ký kênh. Kết thúc bằng === END SCRIPT ===.`
      );
    }

    return 'tiếp tục viết liền mạch phần còn lại, không lặp lại nội dung đã viết. Kết thúc bằng === END SCRIPT ===.';
  }

  if (kind === 'idea') {
    return 'Hãy tiếp tục hoàn thiện trọn vẹn khối JSON còn dang dở ở trên, bắt đầu từ vị trí vừa dừng. Trả về đúng cấu trúc JSON hợp lệ.';
  }

  if (kind === 'master_prompt') {
    return 'Hãy tiếp tục viết liền mạch phần còn lại của Master Prompt từ vị trí vừa dừng đến mục 9. STRICT OUTPUT FORMAT.';
  }

  return 'tiếp tục viết liền mạch phần còn lại, không lặp lại nội dung đã viết.';
}

/**
 * Checks whether ChatGPT Web is actively streaming or reasoning.
 */
export async function isStreamingActive(page: any): Promise<boolean> {
  if (!page || typeof page.locator !== 'function') return false;

  try {
    // 1. Probe stopButton
    const stopRes = await tryResolveSelector(
      page,
      CHATGPT_SELECTORS.stopButton,
      'stopButton',
      { timeoutMs: 0, waitForVisible: true }
    );
    if (stopRes && stopRes.locator) {
      const isVisible = typeof stopRes.locator.isVisible === 'function'
        ? await stopRes.locator.isVisible().catch(() => false)
        : true;
      if (isVisible) return true;
    }

    // 2. Probe .result-streaming
    const streamingLoc = page.locator('.result-streaming');
    if ((await streamingLoc.count().catch(() => 0)) > 0) {
      const isVisible = typeof streamingLoc.first().isVisible === 'function'
        ? await streamingLoc.first().isVisible().catch(() => false)
        : true;
      if (isVisible) return true;
    }

    // 3. Probe thinking-container
    const thinkingLoc = page.locator('[data-testid="thinking-container"], [data-testid*="thinking"]');
    if ((await thinkingLoc.count().catch(() => 0)) > 0) {
      const isVisible = typeof thinkingLoc.first().isVisible === 'function'
        ? await thinkingLoc.first().isVisible().catch(() => false)
        : true;
      if (isVisible) return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Waits for streaming/reasoning to start after prompt submission.
 */
export async function waitForStreamingStart(
  page: any,
  timeoutMs = 5000,
  onProgress?: (message: string) => void,
  options?: { initialTurnCount?: number }
): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = Math.min(300, Math.max(50, Math.floor(timeoutMs / 5)));
  const initialTurns = options?.initialTurnCount ?? 0;

  onProgress?.('Đang chờ ChatGPT bắt đầu phản hồi...');

  while (Date.now() - startTime < timeoutMs) {
    if (await isStreamingActive(page)) {
      onProgress?.('ChatGPT đã bắt đầu sinh dữ liệu...');
      return true;
    }

    // Fast-exit if assistant response is already present (instant/cached response or test mock)
    const turns = await getAssistantTurns(page);
    if (turns.length > initialTurns) {
      const lastTurn = turns[turns.length - 1];
      const text = (typeof lastTurn.innerText === 'function'
        ? await lastTurn.innerText().catch(() => '')
        : await lastTurn.textContent?.().catch(() => '')) || '';
      if (text.trim().length > 0) {
        return true;
      }
    } else if (turns.length > 0 && initialTurns === 0) {
      const lastTurn = turns[turns.length - 1];
      const text = (typeof lastTurn.innerText === 'function'
        ? await lastTurn.innerText().catch(() => '')
        : await lastTurn.textContent?.().catch(() => '')) || '';
      if (text.trim().length > 0) {
        return true;
      }
    }

    if (CHATGPT_SELECTORS.alertError) {
      const alertRes = await tryResolveSelector(page, CHATGPT_SELECTORS.alertError, 'alertError');
      if (alertRes && alertRes.locator) {
        const isVis = typeof alertRes.locator.isVisible === 'function'
          ? await alertRes.locator.isVisible().catch(() => false)
          : true;
        if (isVis) {
          const alertMsg = (typeof alertRes.locator.innerText === 'function'
            ? await alertRes.locator.innerText().catch(() => '')
            : await alertRes.locator.textContent().catch(() => '')) || '';
          if (alertMsg.length > 5) {
            throw new Error(`ChatGPT Web thông báo lỗi: "${alertMsg.trim()}"`);
          }
        }
      }
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  const turns = await getAssistantTurns(page);
  return turns.length > 0;
}

// ==============================================================================
// 4. Main ChatGptScriptCollector Class
// ==============================================================================

export class ChatGptScriptCollector {
  private static instance: ChatGptScriptCollector | null = null;
  private static mutexQueue: Promise<any> = Promise.resolve();
  private static isMutexLocked = false;
  private cdpClient: ChatGptCdpClient;

  public constructor(cdpClient?: ChatGptCdpClient) {
    this.cdpClient = cdpClient || ChatGptCdpClient.getInstance();
  }

  public static getInstance(cdpClient?: ChatGptCdpClient): ChatGptScriptCollector {
    if (!ChatGptScriptCollector.instance) {
      ChatGptScriptCollector.instance = new ChatGptScriptCollector(cdpClient);
    }
    return ChatGptScriptCollector.instance;
  }

  public static resetInstance(): void {
    ChatGptScriptCollector.instance = null;
  }

  /**
   * Serializes calls to ChatGPT Web on Port 9223 via a FIFO promise queue
   */
  public async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = ChatGptScriptCollector.mutexQueue;
    let release: () => void;
    ChatGptScriptCollector.mutexQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    try {
      await prev.catch(() => {});
      ChatGptScriptCollector.isMutexLocked = true;
      return await fn();
    } finally {
      ChatGptScriptCollector.isMutexLocked = false;
      release!();
    }
  }

  public isBusy(): boolean {
    return ChatGptScriptCollector.isMutexLocked;
  }

  /**
   * Helper: Verifies whether prompt text is present inside promptTextarea with >= minRatio.
   */
  public async verifyPromptPresence(
    locator: any,
    expectedPrompt: string,
    minRatio = 0.8
  ): Promise<{ present: boolean; currentLength: number; expectedLength: number }> {
    try {
      const currentText = await readComposerText(locator);

      const trimmedCurrent = currentText.trim();
      const trimmedExpected = expectedPrompt.trim();
      const currentLength = trimmedCurrent.length;
      const expectedLength = trimmedExpected.length;

      if (expectedLength === 0) {
        return { present: true, currentLength, expectedLength };
      }

      const ratio = currentLength / expectedLength;
      const present = currentLength > 0 && ratio >= minRatio;

      return { present, currentLength, expectedLength };
    } catch {
      return { present: false, currentLength: 0, expectedLength: expectedPrompt.length };
    }
  }

  /**
   * Sends prompt into ChatGPT Web using 3-tier safe input injection, presence verification,
   * safe submission and submission confirmation.
   */
  public async sendPrompt(
    page: any,
    prompt: string,
    options?: SendPromptOptions
  ): Promise<void> {
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error('[ChatGptScriptCollector] Prompt cannot be empty or whitespace-only.');
    }

    const tierTimeoutMs = options?.tierTimeoutMs ?? 4000;
    const typingDelayMs = options?.typingDelayMs ?? 0;
    const chunkSize = options?.chunkSize ?? 200;
    const minVerificationRatio = options?.minVerificationRatio ?? 0.8;
    const sendButtonTimeoutMs = options?.sendButtonTimeoutMs ?? 3500;
    const submissionVerificationTimeoutMs = options?.submissionVerificationTimeoutMs ?? 6000;
    const logger = options?.logger ?? console;

    // Step 1: Health & Overlay Check
    await assertPageHealth(page);
    if (options?.dismissOverlays !== false) {
      await dismissOverlays(page);
      if (typeof page.keyboard?.press === 'function') {
        await page.keyboard.press('Escape').catch(() => {});
      }
    }

    // Step 2: Resolve prompt textarea
    const resolvedPrompt = await resolveSelector(page, CHATGPT_SELECTORS.promptTextarea, 'promptTextarea', {
      timeoutMs: 5000,
      waitForVisible: true,
      logger,
    });
    const promptLoc = resolvedPrompt.locator;

    const diagnostics: Record<string, string> = {};
    const attemptedTiers: number[] = [];
    let injectionSuccess = false;

    // --------------------------------------------------------------------------
    // TIER 1: locator.fill()
    // --------------------------------------------------------------------------
    attemptedTiers.push(1);
    try {
      if (typeof promptLoc.waitFor === 'function') {
        await promptLoc.waitFor({ state: 'visible', timeout: tierTimeoutMs }).catch(() => {});
      }
      if (typeof promptLoc.fill === 'function') {
        await promptLoc.fill(prompt, { timeout: tierTimeoutMs });
        await new Promise((r) => setTimeout(r, 150));

        const verification = await this.verifyPromptPresence(promptLoc, prompt, minVerificationRatio);
        if (verification.present) {
          injectionSuccess = true;
        } else {
          diagnostics['Tier1'] = `Verification ratio failed (${verification.currentLength}/${verification.expectedLength})`;
        }
      } else {
        diagnostics['Tier1'] = 'locator.fill is not a function';
      }
    } catch (err: any) {
      diagnostics['Tier1'] = `fill() error: ${err?.message || err}`;
    }

    // --------------------------------------------------------------------------
    // TIER 2: click() + chunked typing / pressSequentially
    // --------------------------------------------------------------------------
    if (!injectionSuccess) {
      logger.warn?.(`[ChatGptScriptCollector] Tier 1 (fill) failed. Cascading to Tier 2 (sequential/chunked typing)...`);
      attemptedTiers.push(2);

      try {
        if (typeof promptLoc.click === 'function') {
          await promptLoc.click({ timeout: 2000 }).catch(() => {});
        }
        if (typeof promptLoc.focus === 'function') {
          await promptLoc.focus().catch(() => {});
        }
        await new Promise((r) => setTimeout(r, 100));

        // Select all and clear
        if (typeof page.keyboard?.press === 'function') {
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
          await page.keyboard.press('Backspace').catch(() => {});
        }
        await new Promise((r) => setTimeout(r, 50));

        if (prompt.length < 150 && typeof promptLoc.pressSequentially === 'function') {
          await promptLoc.pressSequentially(prompt, { delay: Math.max(0, typingDelayMs || 5) });
        } else {
          // Chunked typing for long prompts
          for (let i = 0; i < prompt.length; i += chunkSize) {
            const chunk = prompt.slice(i, i + chunkSize);
            if (typeof page.keyboard?.insertText === 'function') {
              await page.keyboard.insertText(chunk);
            } else if (typeof page.keyboard?.type === 'function') {
              await page.keyboard.type(chunk);
            } else if (typeof promptLoc.fill === 'function') {
              await promptLoc.fill(prompt);
              break;
            }
            if (i + chunkSize < prompt.length) {
              await new Promise((r) => setTimeout(r, 15));
            }
          }
        }

        await new Promise((r) => setTimeout(r, 200));

        const verification = await this.verifyPromptPresence(promptLoc, prompt, minVerificationRatio);
        if (verification.present) {
          injectionSuccess = true;
        } else {
          diagnostics['Tier2'] = `Verification ratio failed (${verification.currentLength}/${verification.expectedLength})`;
        }
      } catch (err: any) {
        diagnostics['Tier2'] = `Sequential typing error: ${err?.message || err}`;
      }
    }

    // --------------------------------------------------------------------------
    // TIER 3: in-DOM page.evaluate() (ProseMirror dispatch / execCommand)
    // --------------------------------------------------------------------------
    if (!injectionSuccess) {
      logger.warn?.(`[ChatGptScriptCollector] Tier 2 failed. Cascading to Tier 3 (ProseMirror / execCommand)...`);
      attemptedTiers.push(3);

      try {
        if (typeof page.evaluate === 'function') {
          const evalResult = await page.evaluate(
            ({ selector, promptText }: { selector: string; promptText: string }) => {
              const el: any = document.querySelector(selector) ||
                              document.querySelector('#prompt-textarea') ||
                              document.querySelector('div.ProseMirror') ||
                              document.querySelector('div[contenteditable="true"]') ||
                              document.querySelector('textarea');
              if (!el) return { success: false, reason: 'Element not found' };

              if (typeof el.focus === 'function') el.focus();
              let handledByProseMirror = false;

              try {
                const pmView = (el.pmViewDesc && el.pmViewDesc.view) ||
                               (el.closest && el.closest('.ProseMirror')?.pmViewDesc?.view);
                if (pmView && typeof pmView.dispatch === 'function' && pmView.state) {
                  const { state } = pmView;
                  const tr = state.tr.replaceWith(0, state.doc.content.size, state.schema.text(promptText));
                  pmView.dispatch(tr);
                  handledByProseMirror = true;
                }
              } catch {}

              if (!handledByProseMirror) {
                if (el.tagName === 'DIV' || el.getAttribute?.('contenteditable') === 'true') {
                  if (typeof document.execCommand === 'function') {
                    document.execCommand('selectAll', false, undefined);
                    const cmdOk = document.execCommand('insertText', false, promptText);
                    if (!cmdOk || (!el.innerText?.trim() && !el.textContent?.trim())) {
                      el.textContent = promptText;
                    }
                  } else {
                    el.textContent = promptText;
                  }
                } else {
                  el.value = promptText;
                }
              }

              if (typeof el.dispatchEvent === 'function') {
                el.dispatchEvent(new Event('input', { bubbles: true }));
                try {
                  el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: promptText }));
                } catch {}
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }

              const readText = (el.innerText || el.textContent || el.value || '').trim();
              return { success: readText.length > 0, length: readText.length, handledByProseMirror };
            },
            { selector: resolvedPrompt.selector, promptText: prompt }
          ).catch((e: any) => ({ success: false, error: String(e) }));

          await new Promise((r) => setTimeout(r, 200));

          const verification = await this.verifyPromptPresence(promptLoc, prompt, minVerificationRatio);
          if (verification.present || (evalResult && evalResult.success)) {
            injectionSuccess = true;
          } else {
            diagnostics['Tier3'] = `In-DOM evaluate failed: ${JSON.stringify(evalResult)}`;
          }
        }
      } catch (err: any) {
        diagnostics['Tier3'] = `Tier 3 evaluate error: ${err?.message || err}`;
      }
    }

    if (!injectionSuccess) {
      throw new ChatGptInputInjectionError(
        'Không thể nhập prompt vào ô soạn thảo ChatGPT Web qua cả 3 tiers',
        attemptedTiers,
        prompt.length,
        diagnostics
      );
    }

    // Step 3: Safe Submission
    options?.onProgress?.('Đang gửi prompt tới ChatGPT...');
    const beforeUserTurn = await readUserTurnState(page);
    const form = promptLoc.locator?.('xpath=ancestor::form[1]');
    const sendScope = form && await form.count() > 0 ? form : page;
    const sendButtonRes = await tryResolveSelector(sendScope, CHATGPT_SELECTORS.sendButton, 'sendButton');
    let submittedViaButton = false;

    if (sendButtonRes && sendButtonRes.locator) {
      const sendLoc = sendButtonRes.locator;
      const waitStart = Date.now();

      // Wait for button to be enabled
      while (Date.now() - waitStart < sendButtonTimeoutMs) {
        let isEnabled = false;
        if (typeof sendLoc.isEnabled === 'function') {
          isEnabled = await sendLoc.isEnabled().catch(() => false);
        } else {
          const disabledAttr = typeof sendLoc.getAttribute === 'function' ? await sendLoc.getAttribute('disabled').catch(() => null) : null;
          const ariaDisabled = typeof sendLoc.getAttribute === 'function' ? await sendLoc.getAttribute('aria-disabled').catch(() => null) : null;
          isEnabled = !disabledAttr && ariaDisabled !== 'true';
        }

        if (isEnabled) {
          if (typeof sendLoc.click === 'function') {
            try {
              await sendLoc.click({ timeout: 2000 });
              submittedViaButton = true;
            } catch (error) {
              diagnostics['SendClick'] = String(error);
            }
          }
          break;
        }

        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // Fallback: If sendButton not clicked or disabled, press Enter on promptTextarea
    if (!submittedViaButton) {
      if (typeof promptLoc.focus === 'function') {
        await promptLoc.focus().catch(() => {});
      }
      if (typeof page.keyboard?.press === 'function') {
        await page.keyboard.press('Enter').catch(() => {});
      }
    }

    // Step 4: Verify Submission (textarea cleared OR stopButton appears)
    const verificationStart = Date.now();
    let submissionConfirmed = false;

    while (Date.now() - verificationStart < submissionVerificationTimeoutMs) {
      const userTurn = await readUserTurnState(page);
      const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
      if (userTurn.count > beforeUserTurn.count && normalize(userTurn.text).includes(normalize(prompt))) {
        submissionConfirmed = true;
        break;
      }
      // Condition A: Stop button or active streaming appeared
      if (await isStreamingActive(page)) {
        submissionConfirmed = true;
        break;
      }

      // Condition B: Textarea content cleared
      // Resolve again: React may replace the composer after submitting or navigating.
      const currentComposer = await tryResolveSelector(page, CHATGPT_SELECTORS.promptTextarea, 'promptTextarea');
      const remainingText = currentComposer
        ? await readComposerText(currentComposer.locator).catch(() => null) : null;

      if (remainingText !== null && remainingText.trim().length === 0) {
        submissionConfirmed = true;
        break;
      }

      await new Promise((r) => setTimeout(r, 300));
    }

    if (!submissionConfirmed) {
      throw new Error('Không xác nhận được ChatGPT đã nhận prompt. Hãy kiểm tra ô nhập trên Chrome trước khi thử lại.');
    }
  }

  /**
   * Waits for streaming/reasoning response to complete:
   * 1. Awaits streaming start window (stop button / streaming indicator / thinking container).
   * 2. Enforces triple-cycle stability checking: stop button absent AND text length invariant across >= 3 cycles.
   */
  public async waitForStreamingComplete(
    page: any,
    timeoutMs?: number,
    options?: StreamingWaitOptions
  ): Promise<void> {
    const maxTimeoutMs = timeoutMs ?? 180000;
    const requiredStableCycles = options?.requiredStableCycles ?? 3;
    const defaultPollIntervalMs = 1200; // per PROJECT.md line 19

    // Adapt pollIntervalMs if maxTimeoutMs is very small to avoid mathematical starvation
    let pollIntervalMs = options?.pollIntervalMs ?? defaultPollIntervalMs;
    if (pollIntervalMs * (requiredStableCycles + 1) > maxTimeoutMs) {
      pollIntervalMs = Math.min(
        pollIntervalMs,
        Math.max(50, Math.floor((maxTimeoutMs * 0.6) / requiredStableCycles))
      );
    }

    const startTime = Date.now();

    // 1. Await streaming start with capped timeout to avoid starving stability loop
    const cappedStartTimeout = Math.min(
      options?.startTimeoutMs ?? 5000,
      Math.max(200, Math.floor(maxTimeoutMs * 0.25))
    );
    await waitForStreamingStart(page, cappedStartTimeout, options?.onProgress, {
      initialTurnCount: options?.initialTurnCount,
    }).catch(() => {});

    // 2. Polling loop for stability
    let lastLength = -1;
    let lastText = '';
    let observedTurnCount = 0;
    let stableCount = 0;

    // Scale initial sleep so low timeouts are not starved
    const initialSleepMs = Math.min(600, Math.max(50, Math.floor(maxTimeoutMs * 0.1)));
    await new Promise((r) => setTimeout(r, initialSleepMs));

    while (Date.now() - startTime < maxTimeoutMs) {
      await assertPageHealth(page);

      if (CHATGPT_SELECTORS.alertError) {
        const alertRes = await tryResolveSelector(page, CHATGPT_SELECTORS.alertError, 'alertError');
        if (alertRes && alertRes.locator) {
          const isVis = typeof alertRes.locator.isVisible === 'function'
            ? await alertRes.locator.isVisible().catch(() => false)
            : true;
          if (isVis) {
            const alertText = (typeof alertRes.locator.innerText === 'function'
              ? await alertRes.locator.innerText().catch(() => '')
              : await alertRes.locator.textContent().catch(() => '')) || '';
            if (alertText.length > 10) {
              throw new Error(`ChatGPT Web thông báo lỗi: "${alertText.trim()}"`);
            }
          }
        }
      }

      const turns = await getAssistantTurns(page);
      observedTurnCount = turns.length;
      if (turns.length === 0) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        continue;
      }

      // Isolate new assistant turn if initialTurnCount was specified
      if (options?.initialTurnCount !== undefined && turns.length <= options.initialTurnCount) {
        stableCount = 0;
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        continue;
      }

      const targetTurn = turns[turns.length - 1];
      const streaming = await isStreamingActive(page);

      const currentText = await readAssistantTurnText(targetTurn);

      if (options?.initialResponseText !== undefined && currentText.trim() === options.initialResponseText.trim()) {
        stableCount = 0;
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        continue;
      }

      const currentLength = currentText.trim().length;

      if (streaming) {
        stableCount = 0;
        if (currentText !== lastText) {
          lastText = currentText;
          lastLength = currentLength;
          options?.onProgress?.(`AI đang phản hồi... (${currentLength} ký tự)`);
          options?.onStreamingChunk?.(currentText);
        }
      } else {
        if (currentText !== lastText) {
          lastText = currentText;
          lastLength = currentLength;
          stableCount = 0;
          options?.onProgress?.(`AI đang hoàn thiện định dạng... (${currentLength} ký tự)`);
          options?.onStreamingChunk?.(currentText);
        } else if (currentLength > 0) {
          stableCount++;

          if (stableCount >= requiredStableCycles) {
            if (!isUserPromptEcho(currentText)) {
              options?.onProgress?.(`Đã hoàn tất phản hồi (${currentLength} ký tự).`);
              return;
            } else {
              stableCount = 0;
            }
          }
        } else if (currentLength === 0) {
          stableCount = 0;
        }
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    const stopButtonStillPresent = await isStreamingActive(page);
    const currentUrl = typeof page.url === 'function' ? page.url() : (page.currentUrl || 'N/A');

    throw new ChatGptStreamingTimeoutError(
      `Hết thời gian chờ phản hồi từ ChatGPT Web (${Math.round(maxTimeoutMs / 1000)}s). ` +
      `Số lượt assistant: ${observedTurnCount} (trước khi gửi: ${options?.initialTurnCount ?? 0}). ` +
      `Độ dài ghi nhận cuối: ${lastLength} ký tự. Stop button còn xuất hiện: ${stopButtonStillPresent}. URL: ${currentUrl}`,
      Date.now() - startTime,
      lastLength,
      stopButtonStillPresent,
      currentUrl
    );
  }

  /**
   * Extracts clean, lossless response text from the latest assistant turn.
   * Reads the identified assistant DOM body directly,
   * sanitized against UI boilerplate and validated with the zero user prompt echo guard.
   */
  public async extractLatestResponseText(
    page: any,
    options?: { preferClipboard?: boolean }
  ): Promise<string> {
    const lastTurn = await getLastAssistantTurn(page);
    if (!lastTurn) {
      return '';
    }

    const rawText = await readAssistantTurnText(lastTurn);

    // Post-processing & boilerplate stripping
    const cleanText = (rawText || '')
      .replace(/^[^\n]*ChatGPT\s*(?:đã\s*nói|said)\s*:?\s*\n*/i, '')
      .replace(/\n+ChatGPT có thể mắc lỗi[\s\S]*$/i, '')
      .replace(/\n+ChatGPT can make mistakes[\s\S]*$/i, '')
      .replace(/\n*…\s*Xem thêm$/i, '')
      .replace(/\n*…\s*Show more$/i, '')
      .trim();

    // Zero user prompt echo validation
    if (isUserPromptEcho(cleanText)) {
      throw new AssistantResponseEchoError(
        `Lỗi trích xuất: Nội dung thu thập được bị nhận diện là bản lặp (echo) của User Prompt gửi đi ` +
        `thay vì câu trả lời của AI Assistant (${cleanText.length} ký tự).`,
        cleanText
      );
    }

    return cleanText;
  }

  /**
   * Handles multi-turn continuation when long script output is truncated.
   * Supports dual-track continuation (UI Continue button click vs prompt fallback)
   * and seamless multi-turn stitching.
   */
  public async handleContinuationIfTruncated(
    page: any,
    initialText: string,
    options?: CollectScriptOptions
  ): Promise<{ fullText: string; continuedTurns: number; isTruncated: boolean }> {
    const maxTurns = options?.maxContinuationTurns ?? 5;
    const kind = options?.kind ?? 'script';
    const targetMin = options?.targetMinSentences;
    const topic = options?.topic ?? '';
    let fullText = initialText;
    let continuedTurns = 0;
    let isTruncated = false;

    while (continuedTurns < maxTurns) {
      // 1. Proactive truncation indicators check
      const continueBtnRes = await tryResolveSelector(page, CHATGPT_SELECTORS.continueButton, 'continueButton');
      const hasContinueBtn = Boolean(
        continueBtnRes &&
        continueBtnRes.locator &&
        (typeof continueBtnRes.locator.isVisible === 'function'
          ? await continueBtnRes.locator.isVisible().catch(() => false)
          : true)
      );

      const isCutoff = isCutoffSentence(fullText);
      const isMissingMarker = isMissingExpectedMarker(fullText, kind);

      let hasBeatDeficit = false;
      if (kind === 'script' && typeof targetMin === 'number' && targetMin > 0) {
        const parsed = parseChatGptScriptResponse(fullText, topic);
        hasBeatDeficit = parsed.length < targetMin;
      }

      // 2. Explicit completion boundary verification
      const hasExplicitEndMarker = (
        (kind === 'script' && (/===\s*END\s*SCRIPT\s*===/i.test(fullText) || /---\s*END OF SCRIPT\s*---/i.test(fullText))) ||
        (kind === 'idea' && hasCompleteIdeaJson(fullText)) ||
        (kind === 'master_prompt' && hasCompleteMasterPrompt(fullText))
      );

      // If output has an explicit completion marker and no continue button and no requested beat deficit, it is complete!
      if (hasExplicitEndMarker && !hasContinueBtn && !hasBeatDeficit) {
        break;
      }

      const needsContinuation = hasContinueBtn || isCutoff || isMissingMarker || hasBeatDeficit;

      if (!needsContinuation) {
        break; // Output is full and complete
      }

      continuedTurns++;
      options?.onProgress?.(`Phát hiện kịch bản chưa hoàn tất (Lượt tiếp tục ${continuedTurns}/${maxTurns}). Đang tiếp tục sinh...`);

      let nextTurnText = '';

      if (hasContinueBtn && continueBtnRes && continueBtnRes.locator) {
        const previousText = await this.extractLatestResponseText(page, options);
        // Track A: Click UI "Continue generating"
        options?.onProgress?.('Đang nhấn nút "Continue generating"...');
        if (typeof continueBtnRes.locator.click === 'function') {
          await continueBtnRes.locator.click({ timeout: 3000 });
        }
        await this.waitForStreamingComplete(page, options?.timeoutMs, { ...options, initialTurnCount: undefined, initialResponseText: previousText });
        nextTurnText = await this.extractLatestResponseText(page, options);
      } else {
        // Track B: Structured continuation prompt fallback
        const continuationPrompt = buildContinuationPrompt({
          kind,
          currentText: fullText,
          targetMinSentences: targetMin ?? 40,
          targetMaxSentences: options?.targetMaxSentences ?? (targetMin ? targetMin + 20 : 60),
          topic,
        });
        const turnsBeforePrompt = (await getAssistantTurns(page)).length;
        options?.onProgress?.('Đang gửi lệnh tiếp tục viết phần còn lại...');
        await this.sendPrompt(page, continuationPrompt, options);
        await this.waitForStreamingComplete(page, options?.timeoutMs, {
          ...options,
          initialTurnCount: turnsBeforePrompt,
        });
        nextTurnText = await this.extractLatestResponseText(page, options);
      }

      if (nextTurnText.trim() === fullText.trim()) {
        isTruncated = true;
        break;
      }
      if (nextTurnText.trim().length > 0) {
        if (kind === 'script') {
          fullText = stitchScriptTurns([fullText, nextTurnText]);
        } else {
          fullText = stitchProseTurns(fullText, nextTurnText);
        }
      } else {
        isTruncated = true;
        break;
      }
    }

    // Check if still truncated after reaching max turns
    {
      const isCutoff = isCutoffSentence(fullText);
      const isMissingMarker = isMissingExpectedMarker(fullText, kind);
      const hasExplicitEndMarker = (
        (kind === 'script' && (/===\s*END\s*SCRIPT\s*===/i.test(fullText) || /---\s*END OF SCRIPT\s*---/i.test(fullText))) ||
        (kind === 'idea' && hasCompleteIdeaJson(fullText)) ||
        (kind === 'master_prompt' && hasCompleteMasterPrompt(fullText))
      );
      const beatDeficit = kind === 'script' && typeof targetMin === 'number' &&
        parseChatGptScriptResponse(fullText, topic).length < targetMin;
      isTruncated = isTruncated || beatDeficit || (!hasExplicitEndMarker && (isCutoff || isMissingMarker));
    }

    return {
      fullText,
      continuedTurns,
      isTruncated,
    };
  }

  /**
   * Collects response from the active page, waiting for streaming completion
   * and handling continuation if output is truncated.
   */
  public async collectResponse(
    page: any,
    options?: CollectScriptOptions
  ): Promise<ScriptCollectionResult> {
    const startTime = Date.now();

    await this.waitForStreamingComplete(page, options?.timeoutMs, options);
    const initialText = await this.extractLatestResponseText(page, options);
    const continuation = await this.handleContinuationIfTruncated(page, initialText, options);

    const durationMs = Date.now() - startTime;
    const wordCount = continuation.fullText.split(/\s+/).filter(Boolean).length;
    const turnCount = 1 + continuation.continuedTurns;
    const conversationUrl = typeof page.url === 'function' ? page.url() : (page.currentUrl || 'https://chatgpt.com');

    return {
      text: continuation.fullText,
      rawText: continuation.fullText,
      turnCount,
      durationMs,
      wordCount,
      isTruncated: continuation.isTruncated,
      continuedTurns: continuation.continuedTurns,
      continuationTriggered: continuation.continuedTurns > 0,
      conversationUrl,
    };
  }

  /**
   * Sends prompt and collects response with continuation and transient backoff retries.
   */
  public async executePromptWithContinuation(
    page: any,
    prompt: string,
    options?: CollectScriptOptions
  ): Promise<ScriptCollectionResult> {
    let activePage = page;
    const initialTurnCount = await retryWithBackoff(
      async (attempt: number) => {
        if (attempt > 1) {
          // Re-acquire fresh page reference if previous page was closed or disconnected
          const isClosed = typeof activePage.isClosed === 'function' ? activePage.isClosed() : false;
          if (isClosed) {
            options?.onProgress?.(`Trang bị đóng đột ngột, đang kết nối lại CDP (lần ${attempt})...`);
            const session = await this.cdpClient.connect(9223);
            activePage = session.page;
          } else if (typeof activePage.reload === 'function') {
            options?.onProgress?.(`Đang tải lại trang để phục hồi trạng thái sạch (lần ${attempt})...`);
            await activePage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            await new Promise((r) => setTimeout(r, 1500));
          }
        }

        await assertPageHealth(activePage);
        return (await getAssistantTurns(activePage)).length;
      },
      {
        maxRetries: options?.maxRetries ?? 3,
        baseDelayMs: options?.retryBaseDelayMs ?? 1500,
        onRetry: (attempt, err, delay) => {
          options?.onProgress?.(`Gặp sự cố tạm thời (thử lại lần ${attempt}): ${err.message}. Đang chờ ${delay}ms...`);
        },
      }
    );
    await this.sendPrompt(activePage, prompt, options);
    return await this.collectResponse(activePage, { ...options, initialTurnCount });
  }

  /**
   * Main entrypoint conforming to PROJECT.md § Interface Contracts.
   */
  public async collect(
    options: ScriptCollectionOptions | (CollectScriptOptions & { prompt: string })
  ): Promise<ScriptCollectionResult> {
    return await this.runExclusive(async () => {
      const session = await this.cdpClient.connect(9223);
      const page = session.page;

      if (options.startNewChat) {
        options.onProgress?.('Đang tạo đoạn chat mới trên ChatGPT Web...');
        await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));
      } else if (options.targetUrl && !page.url().includes(options.targetUrl)) {
        options.onProgress?.('Đang kết nối lại đoạn chat chỉ định...');
        await page.goto(options.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise((r) => setTimeout(r, 1500));
      }

      return await this.executePromptWithContinuation(page, options.prompt, options);
    });
  }

  /**
   * Checks current login status on ChatGPT Web via CDP.
   */
  public async checkLoginStatus(): Promise<{ isLoggedIn: boolean; userEmail?: string }> {
    try {
      const isAlive = await ChromeManager.getInstance().isPortAlive(9223);
      if (!isAlive) {
        return { isLoggedIn: false };
      }

      const session = await this.cdpClient.connect(9223);
      const page: any = session.page;
      const currentUrl = typeof page.url === 'function' ? page.url() : (page.currentUrl || '');

      if (currentUrl.includes('/auth/login')) {
        return { isLoggedIn: false };
      }

      if (CHATGPT_SELECTORS.loginScreen) {
        const loginRes = await tryResolveSelector(page, CHATGPT_SELECTORS.loginScreen, 'loginScreen');
        if (loginRes && loginRes.locator) {
          const isVis = typeof loginRes.locator.isVisible === 'function'
            ? await loginRes.locator.isVisible().catch(() => false)
            : true;
          if (isVis) {
            return { isLoggedIn: false };
          }
        }
      }

      // Check prompt textarea presence as indicator of authenticated chat interface
      const promptRes = await tryResolveSelector(page, CHATGPT_SELECTORS.promptTextarea, 'promptTextarea');
      const isLoggedIn = Boolean(promptRes && promptRes.locator);

      return { isLoggedIn };
    } catch {
      return { isLoggedIn: false };
    }
  }

  /**
   * Launches Google Chrome headed window on Port 9223 for manual user authentication.
   */
  public async openLoginWindow(): Promise<boolean> {
    const chromeMgr = ChromeManager.getInstance();
    const info = await chromeMgr.launchChrome({ port: 9223, headless: false });
    return info.isAlive;
  }
}
