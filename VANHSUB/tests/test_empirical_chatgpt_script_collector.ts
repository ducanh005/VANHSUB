/**
 * tests/test_empirical_chatgpt_script_collector.ts
 *
 * Empirical Adversarial Stress Test Suite for Milestone 3:
 * Safe Input & Streaming Stability in ChatGptScriptCollector.ts.
 */

import assert from 'assert';
import {
  ChatGptScriptCollector,
  ChatGptSessionExpiredError,
  ChatGptCloudflareChallengeError,
  ChatGptInputInjectionError,
  ChatGptStreamingTimeoutError,
  AssistantResponseEchoError,
  assertPageHealth,
  isTransientError,
  retryWithBackoff,
  isCutoffSentence,
  isMissingExpectedMarker,
  stripContinuationFillerIntros,
  stitchScriptTurns,
  stitchProseTurns,
  buildContinuationPrompt,
} from '../main/ai-studio/chatgpt/ChatGptScriptCollector';

// ANSI terminal colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

interface TestResult {
  id: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'FLAW_CONFIRMED';
  details?: string;
}

const results: TestResult[] = [];

function pass(id: string, name: string) {
  console.log(`  ${GREEN}✓ [PASS]${RESET} [${id}] ${name}`);
  results.push({ id, name, status: 'PASS' });
}

function fail(id: string, name: string, err: any) {
  console.error(`  ${RED}✗ [FAIL]${RESET} [${id}] ${name}: ${err?.message || err}`);
  results.push({ id, name, status: 'FAIL', details: err?.message || String(err) });
}

function flaw(id: string, name: string, details: string) {
  console.log(`  ${YELLOW}⚠ [FLAW CONFIRMED]${RESET} [${id}] ${name}: ${details}`);
  results.push({ id, name, status: 'FLAW_CONFIRMED', details });
}

// ==============================================================================
// High-Fidelity Mock DOM Engine
// ==============================================================================

class MockDomNode {
  public tagName: string;
  public id: string;
  public className: string;
  public attributes: Record<string, string>;
  public textContent: string;
  public isVisible: boolean;
  public isEnabled: boolean;
  public children: MockDomNode[] = [];
  public parent: MockDomNode | null = null;
  public clickHandler?: () => Promise<void> | void;
  public fillHandler?: (val: string) => Promise<void> | void;
  public pressSequentiallyHandler?: (val: string, opts?: any) => Promise<void> | void;
  public dynamicTextProvider?: () => Promise<string> | string;

  constructor(options: {
    tagName: string;
    id?: string;
    className?: string;
    attributes?: Record<string, string>;
    textContent?: string;
    isVisible?: boolean;
    isEnabled?: boolean;
  }) {
    this.tagName = options.tagName.toLowerCase();
    this.id = options.id || '';
    this.className = options.className || '';
    this.attributes = options.attributes || {};
    this.textContent = options.textContent || '';
    this.isVisible = options.isVisible !== undefined ? options.isVisible : true;
    this.isEnabled = options.isEnabled !== undefined ? options.isEnabled : true;
  }

  appendChild(child: MockDomNode): MockDomNode {
    child.parent = this;
    this.children.push(child);
    return child;
  }
}

function nodeMatchesSelector(node: MockDomNode, selector: string): boolean {
  const s = selector.trim();
  if (s.includes(',')) {
    return s.split(',').some((sub) => nodeMatchesSelector(node, sub.trim()));
  }

  // 1. ID selector (#id)
  if (s.startsWith('#')) {
    const targetId = s.slice(1);
    return node.id === targetId || node.attributes['id'] === targetId;
  }

  // 2. Class selector (.class or tag.class)
  if (s.includes('.')) {
    const parts = s.split('.');
    const tagPart = parts[0];
    const classParts = parts.slice(1);
    if (tagPart && tagPart !== '*' && tagPart.toLowerCase() !== node.tagName.toLowerCase()) {
      return false;
    }
    const nodeClasses = node.className.split(/\s+/).filter(Boolean);
    return classParts.every((c) => nodeClasses.includes(c));
  }

  // 3. Has-text selector (:has-text("...") or tag:has-text("..."))
  const textMatch = s.match(/^(?:([a-zA-Z0-9_\-]+))?:has-text\("([^"]+)"\)$/);
  if (textMatch) {
    const tagPart = textMatch[1];
    const targetText = textMatch[2];
    if (tagPart && tagPart !== '*' && tagPart.toLowerCase() !== node.tagName.toLowerCase()) {
      return false;
    }
    return node.textContent.includes(targetText);
  }

  // 4. Attribute selector (tag[attr="val"], [attr="val"], [attr*="val"])
  const attrMatch = s.match(/^(?:([a-zA-Z0-9_\-]+))?\[([a-zA-Z0-9_\-]+)([\*\^~]?=)?"?([^"\]]*)"?\]$/);
  if (attrMatch) {
    const tagPart = attrMatch[1];
    const attrName = attrMatch[2];
    const op = attrMatch[3];
    const attrVal = attrMatch[4];
    if (tagPart && tagPart !== '*' && tagPart.toLowerCase() !== node.tagName.toLowerCase()) {
      return false;
    }
    const actualVal =
      node.attributes[attrName] ||
      (attrName === 'id' ? node.id : attrName === 'class' ? node.className : undefined);
    if (actualVal === undefined) return false;
    if (!op) return true;
    if (op === '=') return actualVal === attrVal;
    if (op === '*=') return actualVal.includes(attrVal);
    if (op === '^=') return actualVal.startsWith(attrVal);
  }

  // 5. Bare tag selector (textarea, button, div, article)
  if (/^[a-zA-Z0-9_\-]+$/.test(s)) {
    return node.tagName.toLowerCase() === s.toLowerCase() || s === '*';
  }

  // 6. Contenteditable loose check
  if (s.includes('contenteditable="true"')) {
    return node.attributes['contenteditable'] === 'true';
  }

  return false;
}

function findMatchingNodes(roots: MockDomNode[], selector: string): MockDomNode[] {
  const matches: MockDomNode[] = [];
  function walk(node: MockDomNode) {
    if (nodeMatchesSelector(node, selector)) {
      matches.push(node);
    }
    for (const child of node.children) {
      walk(child);
    }
  }
  for (const root of roots) {
    walk(root);
  }
  return matches;
}

class MockLocator {
  private matchedNodes: MockDomNode[];
  private pageRef: MockPage;

  constructor(matchedNodes: MockDomNode[], pageRef: MockPage) {
    this.matchedNodes = matchedNodes;
    this.pageRef = pageRef;
  }

  async count(): Promise<number> {
    return this.matchedNodes.length;
  }

  first(): MockLocator {
    return new MockLocator(this.matchedNodes.slice(0, 1), this.pageRef);
  }

  nth(index: number): MockLocator {
    return new MockLocator(this.matchedNodes.slice(index, index + 1), this.pageRef);
  }

  async isVisible(): Promise<boolean> {
    if (this.matchedNodes.length === 0) return false;
    return this.matchedNodes[0].isVisible;
  }

  async isEnabled(): Promise<boolean> {
    if (this.matchedNodes.length === 0) return false;
    return this.matchedNodes[0].isEnabled;
  }

  async getAttribute(name: string): Promise<string | null> {
    if (this.matchedNodes.length === 0) return null;
    return this.matchedNodes[0].attributes[name] ?? null;
  }

  async inputValue(): Promise<string> {
    if (this.matchedNodes.length === 0) return '';
    return this.matchedNodes[0].textContent;
  }

  async innerText(): Promise<string> {
    if (this.matchedNodes.length === 0) return '';
    const node = this.matchedNodes[0];
    if (node.dynamicTextProvider) {
      return await node.dynamicTextProvider();
    }
    return node.textContent;
  }

  async textContent(): Promise<string> {
    return this.innerText();
  }

  async waitFor(): Promise<void> {}
  async focus(): Promise<void> {}

  async fill(val: string): Promise<void> {
    if (this.matchedNodes.length === 0) {
      throw new Error('Element not found for fill()');
    }
    const node = this.matchedNodes[0];
    if (node.fillHandler) {
      await node.fillHandler(val);
      return;
    }
    node.textContent = val;
  }

  async click(): Promise<void> {
    if (this.matchedNodes.length === 0) {
      throw new Error('Element not found for click()');
    }
    const node = this.matchedNodes[0];
    if (node.clickHandler) {
      await node.clickHandler();
    }
  }

  async pressSequentially(val: string, opts?: any): Promise<void> {
    if (this.matchedNodes.length === 0) {
      throw new Error('Element not found for pressSequentially()');
    }
    const node = this.matchedNodes[0];
    if (node.pressSequentiallyHandler) {
      await node.pressSequentiallyHandler(val, opts);
      return;
    }
    node.textContent = val;
  }

  locator(subSelector: string): MockLocator {
    const subMatches = findMatchingNodes(this.matchedNodes, subSelector);
    return new MockLocator(subMatches, this.pageRef);
  }
}

class MockPage {
  public currentUrl: string = 'https://chatgpt.com';
  public titleValue: string = 'ChatGPT';
  public domRoots: MockDomNode[] = [];
  public evaluateHandler?: (fn: any, arg: any) => Promise<any>;

  public keyboard = {
    typedText: '',
    presses: [] as string[],
    insertTextCalls: [] as string[],
    insertText: async (text: string) => {
      this.keyboard.insertTextCalls.push(text);
      this.keyboard.typedText += text;
      const promptNode = findMatchingNodes(this.domRoots, '#prompt-textarea')[0];
      if (promptNode) {
        promptNode.textContent += text;
      }
    },
    type: async (text: string) => {
      this.keyboard.typedText += text;
      const promptNode = findMatchingNodes(this.domRoots, '#prompt-textarea')[0];
      if (promptNode) {
        promptNode.textContent += text;
      }
    },
    press: async (key: string) => {
      this.keyboard.presses.push(key);
      if (key === 'Backspace') {
        const promptNode = findMatchingNodes(this.domRoots, '#prompt-textarea')[0];
        if (promptNode) {
          promptNode.textContent = '';
        }
        this.keyboard.typedText = '';
      }
    },
  };

  public context() {
    return {
      grantPermissions: async () => {},
    };
  }

  public addNode(node: MockDomNode): MockDomNode {
    this.domRoots.push(node);
    return node;
  }

  public locator(selector: string): MockLocator {
    const matches = findMatchingNodes(this.domRoots, selector);
    return new MockLocator(matches, this);
  }

  public url(): string {
    return this.currentUrl;
  }

  public async title(): Promise<string> {
    return this.titleValue;
  }

  public async evaluate(fn: any, arg?: any): Promise<any> {
    if (this.evaluateHandler) {
      return await this.evaluateHandler(fn, arg);
    }
    if (typeof fn === 'function') {
      return await fn(arg);
    }
    return { success: true };
  }
}

// ==============================================================================
// TEST EXECUTION
// ==============================================================================

async function runEmpiricalStressSuite() {
  console.log(`\n${BOLD}================================================================================${RESET}`);
  console.log(`${BOLD}${CYAN} EMPIRICAL ADVERSARIAL STRESS TEST SUITE: ChatGptScriptCollector (Milestone 3)${RESET}`);
  console.log(`${BOLD}================================================================================${RESET}\n`);

  const collector = new ChatGptScriptCollector();

  // ----------------------------------------------------------------------------
  // SUITE 1: 3-TIER SAFE INPUT INJECTION & SUBMISSION VERIFICATION
  // ----------------------------------------------------------------------------
  console.log(`${BOLD}[SUITE 1] 3-Tier Safe Input Injection & Submission${RESET}`);

  // 1.1 Tier 1 Happy-Path: fill() succeeds and passes presence check
  try {
    const page = new MockPage();
    const promptNode = page.addNode(
      new MockDomNode({ tagName: 'textarea', id: 'prompt-textarea', textContent: '' })
    );
    const sendBtn = page.addNode(
      new MockDomNode({
        tagName: 'button',
        attributes: { 'data-testid': 'send-button' },
        isEnabled: true,
      })
    );
    sendBtn.clickHandler = () => {
      promptNode.textContent = ''; // Clear upon send
    };

    const promptText = 'Tạo kịch bản video TikTok 60s về Lịch sử Việt Nam';
    await collector.sendPrompt(page as any, promptText, {
      tierTimeoutMs: 500,
      submissionVerificationTimeoutMs: 1000,
    });

    assert.strictEqual(page.keyboard.insertTextCalls.length, 0, 'Tier 1 must not use keyboard insertText');
    pass('1.1', 'Tier 1 primary fill() succeeds with verified presence & button click submission');
  } catch (err: any) {
    fail('1.1', 'Tier 1 primary fill() failed', err);
  }

  // 1.2 Tier 1 Failure -> Tier 2 Success: fill throws, chunked keyboard typing succeeds
  try {
    const page = new MockPage();
    const promptNode = page.addNode(
      new MockDomNode({ tagName: 'textarea', id: 'prompt-textarea', textContent: '' })
    );
    promptNode.fillHandler = () => {
      throw new Error('Element not interactable for fill(): contenteditable DIV requires typing');
    };

    const sendBtn = page.addNode(
      new MockDomNode({
        tagName: 'button',
        attributes: { 'data-testid': 'send-button' },
        isEnabled: true,
      })
    );
    sendBtn.clickHandler = () => {
      promptNode.textContent = '';
    };

    // Prompt length >= 150 chars triggers chunked keyboard typing (lines 878-894)
    const promptText =
      'Kịch bản vũ trụ ngắn dài hơn 150 ký tự để kích hoạt chunked typing của Tier 2 nhằm kiểm chứng khả năng phân mảnh nội dung an toàn và đảm bảo tính nguyên vẹn của văn bản khi nhập liệu qua CDP Playwright.';
    await collector.sendPrompt(page as any, promptText, {
      tierTimeoutMs: 500,
      submissionVerificationTimeoutMs: 1000,
      chunkSize: 60,
    });

    assert(page.keyboard.insertTextCalls.length > 0, 'Tier 2 must utilize keyboard.insertText for prompts >= 150 chars');
    assert.strictEqual(page.keyboard.presses.includes('Backspace'), true, 'Tier 2 must clear existing text before typing');
    pass('1.2', 'Tier 1 exception cascades seamlessly to Tier 2 chunked keyboard typing');
  } catch (err: any) {
    fail('1.2', 'Tier 1 -> Tier 2 fallback failed', err);
  }

  // 1.3 Tier 1 & 2 Failure -> Tier 3 Success: in-DOM evaluate (ProseMirror / execCommand)
  try {
    const page = new MockPage();
    const promptNode = page.addNode(
      new MockDomNode({ tagName: 'div', id: 'prompt-textarea', className: 'ProseMirror', attributes: { contenteditable: 'true' }, textContent: '' })
    );
    promptNode.fillHandler = () => {
      throw new Error('fill() blocked by synthetic event filter');
    };
    promptNode.pressSequentiallyHandler = () => {
      throw new Error('pressSequentially failed');
    };
    page.keyboard.insertText = async () => {
      throw new Error('keyboard.insertText intercepted and rejected by OS/browser');
    };
    page.keyboard.type = async () => {
      throw new Error('keyboard.type intercepted and rejected');
    };

    let evaluateCalled = false;
    page.evaluateHandler = async (fn, arg) => {
      evaluateCalled = true;
      promptNode.textContent = arg.promptText;
      return { success: true, length: arg.promptText.length, handledByProseMirror: true };
    };

    const sendBtn = page.addNode(
      new MockDomNode({
        tagName: 'button',
        attributes: { 'data-testid': 'send-button' },
        isEnabled: true,
      })
    );
    sendBtn.clickHandler = () => {
      promptNode.textContent = '';
    };

    const promptText = 'Test prompt for Tier 3 ProseMirror evaluation';
    await collector.sendPrompt(page as any, promptText, {
      tierTimeoutMs: 500,
      submissionVerificationTimeoutMs: 1000,
    });

    assert.strictEqual(evaluateCalled, true, 'Tier 3 must trigger page.evaluate');
    pass('1.3', 'Tier 1 & Tier 2 failures cascade to Tier 3 in-DOM evaluate dispatch');
  } catch (err: any) {
    fail('1.3', 'Tier 3 fallback failed', err);
  }

  // 1.4 All 3 Tiers Fail -> Throws ChatGptInputInjectionError with full diagnostics
  try {
    const page = new MockPage();
    const promptNode = page.addNode(
      new MockDomNode({ tagName: 'textarea', id: 'prompt-textarea', textContent: '' })
    );
    promptNode.fillHandler = () => {
      throw new Error('Tier 1 fill error');
    };
    promptNode.pressSequentiallyHandler = () => {
      throw new Error('Tier 2 press error');
    };
    page.keyboard.insertText = async () => {
      throw new Error('Tier 2 keyboard error');
    };
    page.keyboard.type = async () => {
      throw new Error('Tier 2 type error');
    };
    page.evaluateHandler = async () => {
      return { success: false, reason: 'ProseMirror view not found' };
    };

    let thrownError: ChatGptInputInjectionError | null = null;
    try {
      await collector.sendPrompt(page as any, 'Test all fail', { tierTimeoutMs: 200 });
    } catch (err: any) {
      if (err instanceof ChatGptInputInjectionError) {
        thrownError = err;
      } else {
        throw err;
      }
    }

    assert(thrownError !== null, 'Must throw ChatGptInputInjectionError');
    assert.deepStrictEqual(thrownError.attemptedTiers, [1, 2, 3], 'Must record all 3 attempted tiers');
    assert(thrownError.diagnostics['Tier1'], 'Must include Tier1 diagnostics');
    assert(thrownError.diagnostics['Tier2'], 'Must include Tier2 diagnostics');
    assert(thrownError.diagnostics['Tier3'], 'Must include Tier3 diagnostics');
    pass('1.4', 'All 3 tiers failing raises descriptive ChatGptInputInjectionError with attemptedTiers [1, 2, 3]');
  } catch (err: any) {
    fail('1.4', 'All tiers failing test failed', err);
  }

  // 1.5 Pre-submission Presence Ratio Verification
  try {
    const page = new MockPage();
    const promptNode = page.addNode(
      new MockDomNode({ tagName: 'textarea', id: 'prompt-textarea', textContent: '' })
    );
    // Simulate drop of 60% of characters during fill
    promptNode.fillHandler = (val) => {
      promptNode.textContent = val.slice(0, Math.floor(val.length * 0.4)); // Only 40% retained
    };

    const sendBtn = page.addNode(
      new MockDomNode({
        tagName: 'button',
        attributes: { 'data-testid': 'send-button' },
        isEnabled: true,
      })
    );
    sendBtn.clickHandler = () => {
      promptNode.textContent = '';
    };

    // Length >= 150 chars triggers chunked keyboard typing in Tier 2
    const longPrompt =
      'This is a long test prompt exceeding 150 characters that experiences character dropping in Tier 1 and must successfully cascade to Tier 2 keyboard typing.';
    await collector.sendPrompt(page as any, longPrompt, {
      minVerificationRatio: 0.8,
      tierTimeoutMs: 300,
      submissionVerificationTimeoutMs: 1000,
    });

    assert(page.keyboard.insertTextCalls.length > 0, 'Tier 1 presence failure must trigger Tier 2');
    pass('1.5', 'Pre-submission presence ratio (<0.8) correctly rejects corrupted fill and triggers Tier 2');
  } catch (err: any) {
    fail('1.5', 'Presence ratio verification failed', err);
  }

  // 1.6 Rejection of Empty and Whitespace Prompts
  try {
    const page = new MockPage();
    let rejected = false;
    try {
      await collector.sendPrompt(page as any, '   \n\t  ');
    } catch (e: any) {
      if (e.message.includes('Prompt cannot be empty')) {
        rejected = true;
      }
    }
    assert.strictEqual(rejected, true, 'Empty prompt must be rejected before any DOM interaction');
    pass('1.6', 'Empty and whitespace-only prompts rejected immediately with clear error');
  } catch (err: any) {
    fail('1.6', 'Empty prompt test failed', err);
  }

  // 1.7 Safe Submission: Enter Key Fallback when Send Button is Disabled/Absent
  try {
    const page = new MockPage();
    const promptNode = page.addNode(
      new MockDomNode({ tagName: 'textarea', id: 'prompt-textarea', textContent: '' })
    );
    page.addNode(
      new MockDomNode({
        tagName: 'button',
        attributes: { 'data-testid': 'send-button' },
        isEnabled: false, // Disabled!
      })
    );

    let enterPressed = false;
    const origPress = page.keyboard.press;
    page.keyboard.press = async (key: string) => {
      await origPress(key);
      if (key === 'Enter') {
        enterPressed = true;
        promptNode.textContent = ''; // Enter submitted prompt
      }
    };

    await collector.sendPrompt(page as any, 'Valid prompt', {
      sendButtonTimeoutMs: 300,
      submissionVerificationTimeoutMs: 800,
    });

    assert.strictEqual(enterPressed, true, 'Must fall back to pressing Enter when sendButton is disabled');
    pass('1.7', 'Disabled sendButton safely falls back to promptTextarea Enter key submission');
  } catch (err: any) {
    fail('1.7', 'Enter key fallback failed', err);
  }

  // ----------------------------------------------------------------------------
  // SUITE 2: TRIPLE-CYCLE STREAMING STABILITY ALGORITHM
  // ----------------------------------------------------------------------------
  console.log(`\n${BOLD}[SUITE 2] Triple-Cycle Streaming Stability Algorithm${RESET}`);

  // 2.1 Standard Triple-Cycle Stability: Stop button absent, 3 cycles with constant length
  try {
    const page = new MockPage();
    const assistantTurn = page.addNode(
      new MockDomNode({
        tagName: 'div',
        attributes: { 'data-message-author-role': 'assistant' },
      })
    );
    assistantTurn.appendChild(
      new MockDomNode({
        tagName: 'div',
        className: 'markdown prose',
        textContent: 'CÂU 1: Lời mở đầu video TikTok.\nCÂU 2: Nội dung chính hoàn chỉnh.',
      })
    );

    let progressMessages: string[] = [];
    const startTime = Date.now();

    await collector.waitForStreamingComplete(page as any, 5000, {
      startTimeoutMs: 50, // Short start wait for mock
      pollIntervalMs: 50,
      requiredStableCycles: 3,
      onProgress: (msg) => progressMessages.push(msg),
    });

    const elapsed = Date.now() - startTime;
    assert(elapsed >= 650, `Must take >= 650ms (initial grace sleep + cycles), took ${elapsed}ms`);
    assert(progressMessages.some((m) => m.includes('Đã hoàn tất phản hồi')), 'Progress must log completion');
    pass('2.1', 'Standard triple-cycle stability confirmed: terminates after >= 3 stable invariant cycles');
  } catch (err: any) {
    fail('2.1', 'Standard triple-cycle stability failed', err);
  }

  // 2.2 Active Streaming Guard: Stop Button visible prevents completion even if text is invariant
  try {
    const page = new MockPage();
    page.addNode(
      new MockDomNode({
        tagName: 'button',
        attributes: { 'data-testid': 'stop-button' },
        isVisible: true,
      })
    );
    const assistantTurn = page.addNode(
      new MockDomNode({
        tagName: 'div',
        attributes: { 'data-message-author-role': 'assistant' },
      })
    );
    assistantTurn.appendChild(
      new MockDomNode({
        tagName: 'div',
        className: 'markdown',
        textContent: 'Model is paused thinking during generation...',
      })
    );

    let timedOut = false;
    try {
      await collector.waitForStreamingComplete(page as any, 300, {
        pollIntervalMs: 40,
        requiredStableCycles: 3,
      });
    } catch (err: any) {
      if (err instanceof ChatGptStreamingTimeoutError) {
        timedOut = true;
        assert.strictEqual(err.stopButtonStillPresent, true, 'Error must identify stop button still present');
      }
    }

    assert.strictEqual(timedOut, true, 'Must NOT declare completion while stop button is visible');
    pass('2.2', 'Active streaming guard: visible stop button strictly prevents premature extraction');
  } catch (err: any) {
    fail('2.2', 'Active streaming guard test failed', err);
  }

  // 2.3 Post-Streaming Dynamic Growth: Length increase resets stability counter
  try {
    const page = new MockPage();
    const assistantTurn = page.addNode(
      new MockDomNode({
        tagName: 'div',
        attributes: { 'data-message-author-role': 'assistant' },
      })
    );
    const mdNode = assistantTurn.appendChild(
      new MockDomNode({
        tagName: 'div',
        className: 'markdown',
        textContent: '',
      })
    );

    let pollIndex = 0;
    const textSequence = [
      'CÂU 1: Bắt đầu video.',
      'CÂU 1: Bắt đầu video.',
      'CÂU 1: Bắt đầu video. CÂU 2: Tiếp tục...',
      'CÂU 1: Bắt đầu video. CÂU 2: Tiếp tục...',
      'CÂU 1: Bắt đầu video. CÂU 2: Tiếp tục...',
      'CÂU 1: Bắt đầu video. CÂU 2: Tiếp tục...',
    ];

    mdNode.dynamicTextProvider = () => {
      const txt = textSequence[Math.min(pollIndex, textSequence.length - 1)];
      pollIndex++;
      return txt;
    };

    await collector.waitForStreamingComplete(page as any, 4000, {
      startTimeoutMs: 50,
      pollIntervalMs: 60,
      requiredStableCycles: 3,
    });

    assert(pollIndex >= 5, `Expected at least 5 polls due to counter reset, got ${pollIndex}`);
    pass('2.3', 'Post-streaming growth resets stability count to 0 and requires 3 fresh stable cycles');
  } catch (err: any) {
    fail('2.3', 'Growth reset test failed', err);
  }

  // 2.4 User Prompt Echo Guard during Streaming
  try {
    const page = new MockPage();
    const assistantTurn = page.addNode(
      new MockDomNode({
        tagName: 'div',
        attributes: { 'data-message-author-role': 'assistant' },
      })
    );
    const mdNode = assistantTurn.appendChild(
      new MockDomNode({
        tagName: 'div',
        className: 'markdown',
        textContent: '',
      })
    );

    let pollCount = 0;
    mdNode.dynamicTextProvider = () => {
      pollCount++;
      if (pollCount <= 4) {
        return 'PHẦN F — CÁCH TRẢ LỜI: Hãy viết kịch bản chuẩn'; // Echo fragment (46 chars)
      }
      return 'CÂU 1: Chào mừng bạn đến với kênh của tôi. Đây là nội dung chính đầy đủ và hoàn thiện của kịch bản.'; // 99 chars (> 46)
    };

    await collector.waitForStreamingComplete(page as any, 5000, {
      startTimeoutMs: 50,
      pollIntervalMs: 50,
      requiredStableCycles: 3,
    });

    assert(pollCount >= 7, `Must ignore echo cycles and only stabilize after genuine response (polls: ${pollCount})`);
    pass('2.4', 'Zero user prompt echo guard intercepts echoed text during streaming stability check');
  } catch (err: any) {
    fail('2.4', 'User prompt echo test failed', err);
  }

  // 2.5 Long Token Interval (Token arrives right before 3rd cycle completes)
  try {
    const page = new MockPage();
    const assistantTurn = page.addNode(
      new MockDomNode({
        tagName: 'div',
        attributes: { 'data-message-author-role': 'assistant' },
      })
    );
    const mdNode = assistantTurn.appendChild(
      new MockDomNode({
        tagName: 'div',
        className: 'markdown',
        textContent: '',
      })
    );

    let polls = 0;
    mdNode.dynamicTextProvider = () => {
      polls++;
      if (polls <= 2) return '1234567890';
      return '12345678901234567890';
    };

    await collector.waitForStreamingComplete(page as any, 5000, {
      startTimeoutMs: 50,
      pollIntervalMs: 50,
      requiredStableCycles: 3,
    });

    assert(polls >= 6, `Must require 6 polls due to late token arrival reset, got ${polls}`);
    pass('2.5', 'Late token arrival at cycle 2 cleanly resets counter and prevents premature extraction');
  } catch (err: any) {
    fail('2.5', 'Long interval test failed', err);
  }

  // 2.6 Empirical Challenge: Flapping / Text Shrinkage Edge Case
  try {
    const page = new MockPage();
    const assistantTurn = page.addNode(
      new MockDomNode({
        tagName: 'div',
        attributes: { 'data-message-author-role': 'assistant' },
      })
    );
    const mdNode = assistantTurn.appendChild(
      new MockDomNode({
        tagName: 'div',
        className: 'markdown',
        textContent: '',
      })
    );

    let call = 0;
    mdNode.dynamicTextProvider = () => {
      call++;
      if (call === 1) return 'A'.repeat(50);
      return 'B'.repeat(40); // Shrunk from 50 to 40 chars
    };

    let timedOut = false;
    try {
      await collector.waitForStreamingComplete(page as any, 400, {
        startTimeoutMs: 50,
        pollIntervalMs: 50,
        requiredStableCycles: 3,
      });
    } catch (err: any) {
      if (err instanceof ChatGptStreamingTimeoutError) {
        timedOut = true;
      }
    }

    if (timedOut) {
      flaw(
        '2.6',
        'Text Shrinkage / Collapse Handling',
        'If text length drops (e.g. DOM re-render/whitespace collapse) and stays lower, ' +
        'lastLength remains at higher value, preventing stableCount from incrementing and causing a timeout.'
      );
    } else {
      pass('2.6', 'Text shrinkage handled without timeout');
    }
  } catch (err: any) {
    fail('2.6', 'Text shrinkage test failed', err);
  }

  // ----------------------------------------------------------------------------
  // SUITE 3: TIMEOUT CONDITIONS & DESCRIPTIVE ERROR PROPAGATION
  // ----------------------------------------------------------------------------
  console.log(`\n${BOLD}[SUITE 3] Timeout Conditions & Error Propagation${RESET}`);

  // 3.1 Streaming Timeout with Stop Button Still Present
  try {
    const page = new MockPage();
    page.currentUrl = 'https://chatgpt.com/c/active-conversation-123';
    page.addNode(
      new MockDomNode({
        tagName: 'button',
        attributes: { 'data-testid': 'stop-button' },
        isVisible: true,
      })
    );
    const assistantTurn = page.addNode(
      new MockDomNode({
        tagName: 'div',
        attributes: { 'data-message-author-role': 'assistant' },
      })
    );
    assistantTurn.appendChild(
      new MockDomNode({
        tagName: 'div',
        className: 'markdown',
        textContent: 'Partial response that never finished',
      })
    );

    let caughtError: ChatGptStreamingTimeoutError | null = null;
    try {
      await collector.waitForStreamingComplete(page as any, 400, { pollIntervalMs: 50 });
    } catch (err: any) {
      if (err instanceof ChatGptStreamingTimeoutError) {
        caughtError = err;
      }
    }

    assert(caughtError !== null, 'Must throw ChatGptStreamingTimeoutError');
    assert.strictEqual(caughtError.stopButtonStillPresent, true, 'Must report stopButtonStillPresent = true');
    assert(caughtError.elapsedMs >= 400, 'Must record elapsed duration');
    assert(caughtError.message.includes('Stop button còn xuất hiện: true'), 'Message must detail stop button');
    assert(caughtError.message.includes('active-conversation-123'), 'Message must include active URL');
    pass('3.1', 'Streaming timeout throws ChatGptStreamingTimeoutError with stopButtonStillPresent and URL');
  } catch (err: any) {
    fail('3.1', 'Streaming timeout test failed', err);
  }

  // 3.2 Streaming Timeout with Monotonic Growth (Infinite Generation)
  try {
    const page = new MockPage();
    const assistantTurn = page.addNode(
      new MockDomNode({
        tagName: 'div',
        attributes: { 'data-message-author-role': 'assistant' },
      })
    );
    const mdNode = assistantTurn.appendChild(
      new MockDomNode({
        tagName: 'div',
        className: 'markdown',
        textContent: '',
      })
    );

    let counter = 0;
    mdNode.dynamicTextProvider = () => {
      counter += 10;
      return 'X'.repeat(counter); // Grows endlessly
    };

    let caught: ChatGptStreamingTimeoutError | null = null;
    try {
      await collector.waitForStreamingComplete(page as any, 1500, {
        startTimeoutMs: 50,
        pollIntervalMs: 40,
      });
    } catch (err: any) {
      if (err instanceof ChatGptStreamingTimeoutError) {
        caught = err;
      }
    }

    assert(caught !== null, 'Must throw timeout error on infinite growth');
    assert.strictEqual(caught.stopButtonStillPresent, false, 'Stop button not present');
    assert(caught.lastObservedLength > 0, `Must record last observed length (>0), got ${caught?.lastObservedLength}`);
    pass('3.2', 'Endless text growth triggers clean ChatGptStreamingTimeoutError without hanging');
  } catch (err: any) {
    fail('3.2', 'Endless growth test failed', err);
  }

  // 3.3 In-Page ChatGPT Alert Banner triggers Immediate Throw
  try {
    const page = new MockPage();
    page.addNode(
      new MockDomNode({
        tagName: 'div',
        attributes: { role: 'alert' },
        isVisible: true,
        textContent: 'Too many requests in 1 hour. Please try again later.',
      })
    );

    let caughtError: Error | null = null;
    try {
      await collector.waitForStreamingComplete(page as any, 5000, {
        startTimeoutMs: 50,
        pollIntervalMs: 50,
      });
    } catch (err: any) {
      caughtError = err;
    }

    assert(caughtError !== null, 'Must throw error on alert');
    assert(caughtError.message.includes('Too many requests in 1 hour'), 'Must extract verbatim alert text');
    pass('3.3', 'In-page ChatGPT error banner throws immediately without waiting for timeout');
  } catch (err: any) {
    fail('3.3', 'Alert banner test failed', err);
  }

  // ----------------------------------------------------------------------------
  // SUITE 4: TRUNCATION DETECTION, LONG SCRIPT CONTINUATION & STITCHING
  // ----------------------------------------------------------------------------
  console.log(`\n${BOLD}[SUITE 4] Truncation Detection, Continuation & Stitching${RESET}`);

  // 4.1 isCutoffSentence Oracle
  try {
    const cutoffs = [
      'CÂU 10: Nơi mà mọi thứ bắt đầu từ',
      'Phân cảnh 5 đang diễn ra thì bất ngờ,',
      'Hắn ta quay lại và nhìn thấy:',
      'CÂU 15: Con tàu vũ trụ đang bay về hướng (',
      'CÂU 12',
      '**Phân cảnh 8**',
      'Câu 20:',
    ];
    for (const c of cutoffs) {
      assert.strictEqual(isCutoffSentence(c), true, `"${c}" must be identified as cutoff sentence`);
    }

    const completes = [
      'CÂU 10: Nơi mà mọi thứ bắt đầu.',
      'Bất ngờ một tiếng sét vang dội!',
      'Bạn có dám thử thách không?',
      'Thế giới này thật kỳ diệu…',
      'Đại thi hào từng nói: "Đời là bể khổ."',
      'Đây là câu tiếng Nhật。',
      'Ký tự CJK kết thúc！',
    ];
    for (const c of completes) {
      assert.strictEqual(isCutoffSentence(c), false, `"${c}" must be identified as complete sentence`);
    }
    pass('4.1', 'isCutoffSentence oracle accurately discriminates cutoff vs complete endings');
  } catch (err: any) {
    fail('4.1', 'isCutoffSentence test failed', err);
  }

  // 4.2 isMissingExpectedMarker Oracle
  try {
    assert.strictEqual(isMissingExpectedMarker('=== BEGIN SCRIPT ===\nCÂU 1: abc', 'script'), true);
    assert.strictEqual(isMissingExpectedMarker('=== BEGIN SCRIPT ===\nCÂU 1: abc\n=== END SCRIPT ===', 'script'), false);
    assert.strictEqual(isMissingExpectedMarker('{"title": "Test"', 'idea'), true);
    assert.strictEqual(isMissingExpectedMarker('{"title": "Test"}', 'idea'), false);
    assert.strictEqual(isMissingExpectedMarker('1. SYSTEM ROLE\nRole description...', 'master_prompt'), true);
    assert.strictEqual(isMissingExpectedMarker('1. SYSTEM ROLE\n...\n9. STRICT OUTPUT FORMAT', 'master_prompt'), false);
    pass('4.2', 'isMissingExpectedMarker correctly validates script, idea and master_prompt markers');
  } catch (err: any) {
    fail('4.2', 'isMissingExpectedMarker test failed', err);
  }

  // 4.3 stitchScriptTurns Seamless Merging
  try {
    const turn1 = `
=== BEGIN SCRIPT ===
CÂU 1: Hành trình thám hiểm bắt đầu từ bờ biển cát trắng.
CÂU 2: Con thuyền nhỏ lướt đi giữa những con sóng
    `.trim();

    const turn2 = `
Dưới đây là phần tiếp theo của kịch bản:
dữ dội của đại dương bao la.
CÂU 3: Đột nhiên một cột sáng xuất hiện từ đáy biển sâu!
=== END SCRIPT ===
    `.trim();

    const stitched = stitchScriptTurns([turn1, turn2]);

    assert(!stitched.includes('Dưới đây là phần tiếp theo'), 'Filler intro must be cleanly stripped');
    assert(stitched.includes('những con sóng dữ dội'), 'Broken sentence across turns must be joined seamlessly');
    assert(stitched.includes('CÂU 3: Đột nhiên một cột sáng'), 'Next scenes must be appended');
    assert(stitched.includes('=== END SCRIPT ==='), 'End marker must be preserved');
    pass('4.3', 'stitchScriptTurns seamlessly reconciles broken sentence and strips filler intro');
  } catch (err: any) {
    fail('4.3', 'stitchScriptTurns test failed', err);
  }

  // 4.4 stitchScriptTurns Line Collision Deduplication
  try {
    const turn1 = `
CÂU 1: Mở đầu ấn tượng.
CÂU 2: Cảnh hành động kịch tính bị ngắt
    `.trim();

    const turn2 = `
Chắc chắn rồi, tiếp tục từ câu 2:
CÂU 2: Cảnh hành động kịch tính bị ngắt quãng giữa chừng nay được hoàn thiện trọn vẹn.
CÂU 3: Kết thúc video.
    `.trim();

    const stitched = stitchScriptTurns([turn1, turn2]);
    const lines = stitched.split('\n').filter((l) => l.trim().startsWith('CÂU 2:'));
    assert.strictEqual(lines.length, 1, `Expected exactly 1 line for CÂU 2, got ${lines.length}`);
    assert(lines[0].includes('nay được hoàn thiện trọn vẹn'), 'Must keep longer complete version of CÂU 2');
    pass('4.4', 'stitchScriptTurns deduplicates colliding scene headers between turns');
  } catch (err: any) {
    fail('4.4', 'stitchScriptTurns collision test failed', err);
  }

  // 4.5 buildContinuationPrompt Target Awareness
  try {
    const currentScript = '=== BEGIN SCRIPT ===\nCÂU 1: Đầu\nCÂU 2: Giữa';
    const promptForScript = buildContinuationPrompt({
      kind: 'script',
      currentText: currentScript,
      targetMinSentences: 30,
      targetMaxSentences: 50,
      topic: 'Lịch sử',
    });

    assert(promptForScript.includes('CÂU 3'), 'Continuation prompt must request starting from CÂU 3');
    assert(promptForScript.includes('=== END SCRIPT ==='), 'Must request end marker');

    const promptForIdea = buildContinuationPrompt({ kind: 'idea', currentText: '{"outline": [' });
    assert(promptForIdea.includes('JSON'), 'Must request JSON completion');

    pass('4.5', 'buildContinuationPrompt constructs context-aware prompts with beat indices and markers');
  } catch (err: any) {
    fail('4.5', 'buildContinuationPrompt test failed', err);
  }

  // ----------------------------------------------------------------------------
  // SUITE 5: SESSION HEALTH, CLOUDFLARE & TRANSIENT RETRY RESILIENCE
  // ----------------------------------------------------------------------------
  console.log(`\n${BOLD}[SUITE 5] Session Health, Cloudflare & Retry Resilience${RESET}`);

  // 5.1 assertPageHealth Auth Redirect Detection
  try {
    const page = new MockPage();
    page.currentUrl = 'https://chatgpt.com/auth/login?next=%2F';

    let thrownAuth: ChatGptSessionExpiredError | null = null;
    try {
      await assertPageHealth(page);
    } catch (e: any) {
      if (e instanceof ChatGptSessionExpiredError) {
        thrownAuth = e;
      }
    }

    assert(thrownAuth !== null, 'Must throw ChatGptSessionExpiredError');
    assert.strictEqual(thrownAuth.isAuthError, true, 'isAuthError must be true');
    assert(thrownAuth.message.includes('hết hạn'), 'Must provide actionable login message');
    pass('5.1', 'assertPageHealth flags /auth/login redirect and throws ChatGptSessionExpiredError');
  } catch (err: any) {
    fail('5.1', 'assertPageHealth auth test failed', err);
  }

  // 5.2 assertPageHealth Cloudflare Challenge Detection
  try {
    const page = new MockPage();
    page.currentUrl = 'https://chatgpt.com/?__cf_chl_tk=123';
    page.titleValue = 'Just a moment...';

    let thrownCf: ChatGptCloudflareChallengeError | null = null;
    try {
      await assertPageHealth(page);
    } catch (e: any) {
      if (e instanceof ChatGptCloudflareChallengeError) {
        thrownCf = e;
      }
    }

    assert(thrownCf !== null, 'Must throw ChatGptCloudflareChallengeError');
    assert.strictEqual(thrownCf.isCloudflare, true, 'isCloudflare must be true');
    assert(thrownCf.message.includes('Cloudflare Turnstile'), 'Must identify Cloudflare');
    pass('5.2', 'assertPageHealth flags Cloudflare challenge challenge-running / Just a moment title');
  } catch (err: any) {
    fail('5.2', 'assertPageHealth Cloudflare test failed', err);
  }

  // 5.3 retryWithBackoff Discrimination: Non-Transient Fail-Fast
  try {
    let callCount = 0;
    let caught: any = null;
    try {
      await retryWithBackoff(
        async () => {
          callCount++;
          throw new ChatGptSessionExpiredError('https://chatgpt.com/auth/login');
        },
        { maxRetries: 3, baseDelayMs: 20 }
      );
    } catch (e: any) {
      caught = e;
    }

    assert.strictEqual(callCount, 1, 'Fatal auth error must NOT be retried (fail-fast on attempt 1)');
    assert(caught instanceof ChatGptSessionExpiredError, 'Must propagate ChatGptSessionExpiredError');
    pass('5.3', 'retryWithBackoff fails fast on fatal session error without wasteful retries');
  } catch (err: any) {
    fail('5.3', 'retryWithBackoff non-transient test failed', err);
  }

  // 5.4 retryWithBackoff: Transient Error Retried with Backoff & Succeeds
  try {
    let callCount = 0;
    const retryDelays: number[] = [];

    const result = await retryWithBackoff(
      async (attempt) => {
        callCount++;
        if (attempt === 1) {
          throw new Error('Navigation timeout 30000ms exceeded');
        }
        return 'SUCCESS_ATTEMPT_2';
      },
      {
        maxRetries: 3,
        baseDelayMs: 50,
        jitterMs: 10,
        onRetry: (att, err, delay) => retryDelays.push(delay),
      }
    );

    assert.strictEqual(callCount, 2, 'Must succeed on attempt 2');
    assert.strictEqual(result, 'SUCCESS_ATTEMPT_2');
    assert.strictEqual(retryDelays.length, 1, 'Must record 1 retry delay');
    assert(retryDelays[0] >= 50, 'Delay must reflect baseDelayMs');
    pass('5.4', 'retryWithBackoff recovers transient navigation error on subsequent attempt');
  } catch (err: any) {
    fail('5.4', 'retryWithBackoff transient test failed', err);
  }

  // ----------------------------------------------------------------------------
  // SUITE 6: END-TO-END METHOD VERIFICATION: extractLatestResponseText & collectResponse
  // ----------------------------------------------------------------------------
  console.log(`\n${BOLD}[SUITE 6] End-to-End Extraction & Continuation Workflow${RESET}`);

  // 6.1 extractLatestResponseText: Copy Button Clipboard Tier & Fallback
  try {
    const page = new MockPage();
    const assistantTurn = page.addNode(
      new MockDomNode({
        tagName: 'div',
        attributes: { 'data-message-author-role': 'assistant' },
      })
    );
    assistantTurn.appendChild(
      new MockDomNode({
        tagName: 'button',
        attributes: { 'aria-label': 'Copy turn' },
        isVisible: true,
      })
    );
    assistantTurn.appendChild(
      new MockDomNode({
        tagName: 'div',
        className: 'markdown',
        textContent: 'Fallback markdown text',
      })
    );

    page.evaluateHandler = async () => {
      return '=== BEGIN SCRIPT ===\nCÂU 1: Kịch bản trích xuất trực tiếp qua Clipboard Copy button.\n=== END SCRIPT ===';
    };

    const text = await collector.extractLatestResponseText(page as any, { preferClipboard: true });
    assert(text.includes('Clipboard Copy button'), 'Must extract text from clipboard');
    pass('6.1', 'extractLatestResponseText extracts clean text via Copy button clipboard tier');
  } catch (err: any) {
    fail('6.1', 'extractLatestResponseText clipboard test failed', err);
  }

  // 6.2 extractLatestResponseText: Zero Prompt Echo Throws AssistantResponseEchoError
  try {
    const page = new MockPage();
    const assistantTurn = page.addNode(
      new MockDomNode({
        tagName: 'div',
        attributes: { 'data-message-author-role': 'assistant' },
      })
    );
    assistantTurn.appendChild(
      new MockDomNode({
        tagName: 'div',
        className: 'markdown',
        textContent: 'PHẦN B — VÙNG CẤM SỬA: Tuyệt đối không thay đổi cấu trúc này',
      })
    );

    let caughtEcho: AssistantResponseEchoError | null = null;
    try {
      await collector.extractLatestResponseText(page as any, { preferClipboard: false });
    } catch (e: any) {
      if (e instanceof AssistantResponseEchoError) {
        caughtEcho = e;
      }
    }

    assert(caughtEcho !== null, 'Must throw AssistantResponseEchoError');
    assert(caughtEcho.capturedTextPreview.includes('PHẦN B'), 'Preview must show echoed text');
    pass('6.2', 'extractLatestResponseText intercepts prompt echo and throws AssistantResponseEchoError');
  } catch (err: any) {
    fail('6.2', 'extractLatestResponseText echo test failed', err);
  }

  // ----------------------------------------------------------------------------
  // SUMMARY REPORT
  // ----------------------------------------------------------------------------
  console.log(`\n${BOLD}================================================================================${RESET}`);
  console.log(`${BOLD} EMPIRICAL TEST SUITE EXECUTION SUMMARY${RESET}`);
  console.log(`${BOLD}================================================================================${RESET}`);

  const total = results.length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const flaws = results.filter((r) => r.status === 'FLAW_CONFIRMED').length;

  console.log(`  Total tests executed : ${total}`);
  console.log(`  ${GREEN}Passed               : ${passed}${RESET}`);
  console.log(`  ${RED}Failed               : ${failed}${RESET}`);
  console.log(`  ${YELLOW}Flaws Confirmed      : ${flaws}${RESET}`);

  if (failed > 0) {
    console.log(`\n${RED}FAILURE DETAILS:${RESET}`);
    for (const r of results.filter((r) => r.status === 'FAIL')) {
      console.log(`  - [${r.id}] ${r.name}: ${r.details}`);
    }
  }

  if (flaws > 0) {
    console.log(`\n${YELLOW}OBSERVED ANOMALIES / FLAWS:${RESET}`);
    for (const r of results.filter((r) => r.status === 'FLAW_CONFIRMED')) {
      console.log(`  - [${r.id}] ${r.name}: ${r.details}`);
    }
  }

  console.log(`${BOLD}================================================================================${RESET}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runEmpiricalStressSuite().catch((e) => {
  console.error('Fatal test runner exception:', e);
  process.exit(1);
});
