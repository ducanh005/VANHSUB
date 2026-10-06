/**
 * tests/test_m3_v2_adversarial_stress.ts
 *
 * EMPIRICAL ADVERSARIAL STRESS SUITE (Gate M3 Iteration 2)
 * Target: main/ai-studio/chatgpt/ChatGptScriptCollector.ts
 *
 * Focus Areas:
 * 1. Text Shrinkage under Markdown Re-renders (single, stepped, zigzag, extreme, continuous)
 * 2. Short Timeout Configurations (<3s) & Anti-Starvation Scaling
 * 3. Concurrency Mutex Serialization & Stack Unwinding
 * 4. Preamble Stripping & Truncation Heuristic Boundary Challenges
 */

import assert from 'assert';
import {
  ChatGptScriptCollector,
  ChatGptStreamingTimeoutError,
  ChatGptSessionExpiredError,
  ChatGptCloudflareChallengeError,
  AssistantResponseEchoError,
  waitForStreamingStart,
  isStreamingActive,
  isCutoffSentence,
  isMissingExpectedMarker,
  stripContinuationFillerIntros,
  stitchScriptTurns,
  stitchProseTurns,
} from '../main/ai-studio/chatgpt/ChatGptScriptCollector';

// Colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function pass(id: string, description: string) {
  totalTests++;
  passedTests++;
  console.log(`  ${GREEN}✓ [PASS]${RESET} [${id}] ${description}`);
}

function fail(id: string, description: string, error: any) {
  totalTests++;
  failedTests++;
  console.error(`  ${RED}✗ [FAIL]${RESET} [${id}] ${description}:`, error?.message || error);
}

// ==============================================================================
// High-Fidelity Mock DOM Engine for Stress Testing
// ==============================================================================

class StressDomNode {
  public tagName: string;
  public id: string;
  public className: string;
  public attributes: Record<string, string>;
  public textContent: string;
  public isVisible: boolean;
  public isEnabled: boolean;
  public children: StressDomNode[] = [];
  public parent: StressDomNode | null = null;
  public dynamicTextProvider?: () => Promise<string> | string;

  constructor(opts: {
    tagName: string;
    id?: string;
    className?: string;
    attributes?: Record<string, string>;
    textContent?: string;
    isVisible?: boolean;
    isEnabled?: boolean;
  }) {
    this.tagName = opts.tagName.toLowerCase();
    this.id = opts.id || '';
    this.className = opts.className || '';
    this.attributes = opts.attributes || {};
    this.textContent = opts.textContent || '';
    this.isVisible = opts.isVisible !== undefined ? opts.isVisible : true;
    this.isEnabled = opts.isEnabled !== undefined ? opts.isEnabled : true;
  }

  appendChild(child: StressDomNode): StressDomNode {
    child.parent = this;
    this.children.push(child);
    return child;
  }
}

function matchNode(node: StressDomNode, selector: string): boolean {
  const s = selector.trim();
  if (s.includes(',')) {
    return s.split(',').some((part) => matchNode(node, part.trim()));
  }
  if (s.startsWith('#')) {
    const id = s.slice(1);
    return node.id === id || node.attributes['id'] === id;
  }
  if (s.includes('.')) {
    const parts = s.split('.');
    const tag = parts[0];
    const classes = parts.slice(1);
    if (tag && tag !== '*' && tag.toLowerCase() !== node.tagName.toLowerCase()) {
      return false;
    }
    const nodeClasses = node.className.split(/\s+/).filter(Boolean);
    return classes.every((c) => nodeClasses.includes(c));
  }
  const attrMatch = s.match(/^(?:([a-zA-Z0-9_\-]+))?\[([a-zA-Z0-9_\-]+)([\*\^~]?=)?"?([^"\]]*)"?\]$/);
  if (attrMatch) {
    const tag = attrMatch[1];
    const attr = attrMatch[2];
    const op = attrMatch[3];
    const val = attrMatch[4];
    if (tag && tag !== '*' && tag.toLowerCase() !== node.tagName.toLowerCase()) {
      return false;
    }
    const actual = node.attributes[attr] || (attr === 'id' ? node.id : attr === 'class' ? node.className : undefined);
    if (actual === undefined) return false;
    if (!op) return true;
    if (op === '=') return actual === val;
    if (op === '*=') return actual.includes(val);
    if (op === '^=') return actual.startsWith(val);
  }
  if (/^[a-zA-Z0-9_\-]+$/.test(s)) {
    return node.tagName.toLowerCase() === s.toLowerCase() || s === '*';
  }
  return false;
}

function queryNodes(roots: StressDomNode[], selector: string): StressDomNode[] {
  const matched: StressDomNode[] = [];
  function traverse(n: StressDomNode) {
    if (matchNode(n, selector)) {
      matched.push(n);
    }
    for (const child of n.children) {
      traverse(child);
    }
  }
  for (const r of roots) {
    traverse(r);
  }
  return matched;
}

class StressLocator {
  private nodes: StressDomNode[];
  private page: StressPage;

  constructor(nodes: StressDomNode[], page: StressPage) {
    this.nodes = nodes;
    this.page = page;
  }

  async count(): Promise<number> {
    return this.nodes.length;
  }

  first(): StressLocator {
    return new StressLocator(this.nodes.slice(0, 1), this.page);
  }

  async isVisible(): Promise<boolean> {
    if (this.nodes.length === 0) return false;
    return this.nodes[0].isVisible;
  }

  async isEnabled(): Promise<boolean> {
    if (this.nodes.length === 0) return false;
    return this.nodes[0].isEnabled;
  }

  async innerText(): Promise<string> {
    if (this.nodes.length === 0) return '';
    return await this.computeNodeText(this.nodes[0]);
  }

  private async computeNodeText(node: StressDomNode): Promise<string> {
    if (node.dynamicTextProvider) {
      return await node.dynamicTextProvider();
    }
    if (node.textContent) {
      return node.textContent;
    }
    if (node.children.length > 0) {
      const childTexts = await Promise.all(node.children.map((c) => this.computeNodeText(c)));
      return childTexts.join(' ').trim();
    }
    return '';
  }

  async textContent(): Promise<string> {
    return this.innerText();
  }

  locator(subSelector: string): StressLocator {
    const sub = queryNodes(this.nodes, subSelector);
    return new StressLocator(sub, this.page);
  }
}

class StressPage {
  public currentUrl: string = 'https://chatgpt.com';
  public titleValue: string = 'ChatGPT';
  public domRoots: StressDomNode[] = [];

  public addNode(node: StressDomNode): StressDomNode {
    this.domRoots.push(node);
    return node;
  }

  public locator(selector: string): StressLocator {
    const matched = queryNodes(this.domRoots, selector);
    return new StressLocator(matched, this);
  }

  public url(): string {
    return this.currentUrl;
  }

  public async title(): Promise<string> {
    return this.titleValue;
  }
}

// ==============================================================================
// TEST EXECUTION RUNNER
// ==============================================================================

async function runAdversarialStressSuite() {
  console.log(`\n${BOLD}${CYAN}================================================================================${RESET}`);
  console.log(`${BOLD}${CYAN} GATE M3 EMPIRICAL ADVERSARIAL STRESS SUITE (ITERATION 2)                      ${RESET}`);
  console.log(`${BOLD}${CYAN} Target: ChatGptScriptCollector.ts                                              ${RESET}`);
  console.log(`${BOLD}${CYAN}================================================================================${RESET}\n`);

  const collector = ChatGptScriptCollector.getInstance();

  // ----------------------------------------------------------------------------
  // SECTION 1: TEXT SHRINKAGE UNDER MARKDOWN RE-RENDERS
  // ----------------------------------------------------------------------------
  console.log(`${BOLD}[SECTION 1] Text Shrinkage under Markdown Re-renders (Flapping/Collapse Guard)${RESET}`);

  // Test 1.1: Single text shrinkage post-streaming (250 chars -> 210 chars -> 210 -> 210)
  try {
    const page = new StressPage();
    const assistantTurn = page.addNode(
      new StressDomNode({ tagName: 'div', attributes: { 'data-message-author-role': 'assistant' } })
    );
    const md = assistantTurn.appendChild(
      new StressDomNode({ tagName: 'div', className: 'markdown prose', textContent: '' })
    );

    let pollCount = 0;
    md.dynamicTextProvider = () => {
      pollCount++;
      if (pollCount === 1) return 'X'.repeat(250); // Raw streaming text
      return 'Y'.repeat(210); // Markdown rendered / normalized text
    };

    const startTime = Date.now();
    await collector.waitForStreamingComplete(page as any, 3000, {
      startTimeoutMs: 50,
      pollIntervalMs: 60,
      requiredStableCycles: 3,
    });
    const duration = Date.now() - startTime;

    assert(pollCount >= 4, `Expected at least 4 polls (1 initial + 3 stable), got ${pollCount}`);
    pass('1.1', `Single post-streaming shrinkage (250->210 chars) completed cleanly in ${duration}ms without deadlock`);
  } catch (err: any) {
    fail('1.1', 'Single shrinkage failed', err);
  }

  // Test 1.2: Stepped progressive shrinkage (300 -> 260 -> 220 -> 220 -> 220)
  try {
    const page = new StressPage();
    const assistantTurn = page.addNode(
      new StressDomNode({ tagName: 'div', attributes: { 'data-message-author-role': 'assistant' } })
    );
    const md = assistantTurn.appendChild(
      new StressDomNode({ tagName: 'div', className: 'markdown prose', textContent: '' })
    );

    let pollCount = 0;
    const stepped = [300, 260, 220, 220, 220, 220];
    md.dynamicTextProvider = () => {
      const len = stepped[Math.min(pollCount, stepped.length - 1)];
      pollCount++;
      return 'M'.repeat(len);
    };

    await collector.waitForStreamingComplete(page as any, 3000, {
      startTimeoutMs: 50,
      pollIntervalMs: 50,
      requiredStableCycles: 3,
    });

    assert(pollCount >= 5, `Expected >= 5 polls for stepped shrinkage, got ${pollCount}`);
    pass('1.2', `Stepped progressive shrinkage (300->260->220 chars) resets stability counter and finishes after 3 cycles`);
  } catch (err: any) {
    fail('1.2', 'Stepped shrinkage failed', err);
  }

  // Test 1.3: Zigzag / Oscillating text lengths (150 -> 220 -> 180 -> 240 -> 200 -> 200 -> 200)
  try {
    const page = new StressPage();
    const assistantTurn = page.addNode(
      new StressDomNode({ tagName: 'div', attributes: { 'data-message-author-role': 'assistant' } })
    );
    const md = assistantTurn.appendChild(
      new StressDomNode({ tagName: 'div', className: 'markdown prose', textContent: '' })
    );

    let pollCount = 0;
    const zigzag = [150, 220, 180, 240, 200, 200, 200, 200];
    md.dynamicTextProvider = () => {
      const len = zigzag[Math.min(pollCount, zigzag.length - 1)];
      pollCount++;
      return 'Z'.repeat(len);
    };

    await collector.waitForStreamingComplete(page as any, 4000, {
      startTimeoutMs: 50,
      pollIntervalMs: 50,
      requiredStableCycles: 3,
    });

    assert(pollCount >= 7, `Expected >= 7 polls for zigzag pattern, got ${pollCount}`);
    pass('1.3', `Zigzag oscillating lengths (150-220-180-240-200) stabilizes only after 3 consecutive identical cycles`);
  } catch (err: any) {
    fail('1.3', 'Zigzag oscillation failed', err);
  }

  // Test 1.4: Extreme shrinkage (800 chars -> 80 chars, e.g. DOM node replacement by summary)
  try {
    const page = new StressPage();
    const assistantTurn = page.addNode(
      new StressDomNode({ tagName: 'div', attributes: { 'data-message-author-role': 'assistant' } })
    );
    const md = assistantTurn.appendChild(
      new StressDomNode({ tagName: 'div', className: 'markdown prose', textContent: '' })
    );

    let pollCount = 0;
    md.dynamicTextProvider = () => {
      pollCount++;
      if (pollCount === 1) return 'A'.repeat(800);
      return 'B'.repeat(80);
    };

    await collector.waitForStreamingComplete(page as any, 3000, {
      startTimeoutMs: 50,
      pollIntervalMs: 50,
      requiredStableCycles: 3,
    });

    assert(pollCount >= 4, `Expected >= 4 polls for 90% extreme shrinkage, got ${pollCount}`);
    pass('1.4', `Extreme 90% shrinkage (800->80 chars) recovers gracefully without deadlock`);
  } catch (err: any) {
    fail('1.4', 'Extreme shrinkage failed', err);
  }

  // Test 1.5: Shrinkage during active streaming (stopButton visible)
  try {
    const page = new StressPage();
    const stopBtn = page.addNode(
      new StressDomNode({ tagName: 'button', attributes: { 'data-testid': 'stop-button' }, isVisible: true })
    );
    const assistantTurn = page.addNode(
      new StressDomNode({ tagName: 'div', attributes: { 'data-message-author-role': 'assistant' } })
    );
    const md = assistantTurn.appendChild(
      new StressDomNode({ tagName: 'div', className: 'markdown prose', textContent: '' })
    );

    let pollCount = 0;
    md.dynamicTextProvider = () => {
      pollCount++;
      if (pollCount === 1) return 'STREAMING_RAW_100'.padEnd(100, '.');
      if (pollCount === 2) return 'STREAMING_SHRUNK_60'.padEnd(60, '.');
      if (pollCount === 3) {
        stopBtn.isVisible = false; // Stop button disappears on cycle 3
        return 'FINAL_CLEAN_75'.padEnd(75, '.');
      }
      return 'FINAL_CLEAN_75'.padEnd(75, '.');
    };

    await collector.waitForStreamingComplete(page as any, 4000, {
      startTimeoutMs: 50,
      pollIntervalMs: 50,
      requiredStableCycles: 3,
    });

    assert(pollCount >= 6, `Expected >= 6 polls (2 during streaming + 1 transition + 3 stable), got ${pollCount}`);
    pass('1.5', `Shrinkage during streaming with active stop button transitions seamlessly to post-streaming stability`);
  } catch (err: any) {
    fail('1.5', 'Streaming shrinkage transition failed', err);
  }

  // Test 1.6: Endless shrinkage (never stabilizing, continually decreasing text) -> throws timeout cleanly
  try {
    const page = new StressPage();
    const assistantTurn = page.addNode(
      new StressDomNode({ tagName: 'div', attributes: { 'data-message-author-role': 'assistant' } })
    );
    const md = assistantTurn.appendChild(
      new StressDomNode({ tagName: 'div', className: 'markdown prose', textContent: '' })
    );

    let currentLength = 1000;
    md.dynamicTextProvider = () => {
      currentLength = Math.max(10, currentLength - 10);
      return 'C'.repeat(currentLength);
    };

    let caughtTimeout = false;
    try {
      await collector.waitForStreamingComplete(page as any, 400, {
        startTimeoutMs: 30,
        pollIntervalMs: 40,
        requiredStableCycles: 3,
      });
    } catch (err: any) {
      if (err instanceof ChatGptStreamingTimeoutError) {
        caughtTimeout = true;
      }
    }

    assert.strictEqual(caughtTimeout, true, 'Continuous shrinkage without stabilization must throw ChatGptStreamingTimeoutError');
    pass('1.6', `Endless text shrinkage triggers ChatGptStreamingTimeoutError cleanly without unhandled rejection`);
  } catch (err: any) {
    fail('1.6', 'Endless shrinkage test failed', err);
  }

  // ----------------------------------------------------------------------------
  // SECTION 2: SHORT TIMEOUT CONFIGURATIONS (<3s) & ANTI-STARVATION
  // ----------------------------------------------------------------------------
  console.log(`\n${BOLD}[SECTION 2] Short Timeout Configurations (<3s) & Starvation Prevention${RESET}`);

  // Test 2.1: Timeout = 500ms with fast-exit assistant turn
  try {
    const page = new StressPage();
    const assistantTurn = page.addNode(
      new StressDomNode({ tagName: 'div', attributes: { 'data-message-author-role': 'assistant' } })
    );
    assistantTurn.appendChild(
      new StressDomNode({ tagName: 'div', className: 'markdown prose', textContent: 'Quick result' })
    );

    const start = Date.now();
    await collector.waitForStreamingComplete(page as any, 500); // 500ms timeout with defaults
    const elapsed = Date.now() - start;

    assert(elapsed < 500, `Must complete under 500ms, took ${elapsed}ms`);
    pass('2.1', `500ms timeout configuration completes safely in ${elapsed}ms without timeout starvation`);
  } catch (err: any) {
    fail('2.1', '500ms timeout test failed', err);
  }

  // Test 2.2: Timeout = 1000ms with 3-cycle stabilization
  try {
    const page = new StressPage();
    const assistantTurn = page.addNode(
      new StressDomNode({ tagName: 'div', attributes: { 'data-message-author-role': 'assistant' } })
    );
    assistantTurn.appendChild(
      new StressDomNode({ tagName: 'div', className: 'markdown prose', textContent: 'CÂU 1: Lời mở đầu.' })
    );

    const start = Date.now();
    await collector.waitForStreamingComplete(page as any, 1000); // Adaptive scaling applies
    const elapsed = Date.now() - start;

    assert(elapsed < 1000, `Must complete under 1000ms, took ${elapsed}ms`);
    pass('2.2', `1000ms timeout adapts poll interval and completes cleanly in ${elapsed}ms`);
  } catch (err: any) {
    fail('2.2', '1000ms timeout test failed', err);
  }

  // Test 2.3: Timeout = 1500ms with dynamic text arrival
  try {
    const page = new StressPage();
    const assistantTurn = page.addNode(
      new StressDomNode({ tagName: 'div', attributes: { 'data-message-author-role': 'assistant' } })
    );
    const md = assistantTurn.appendChild(
      new StressDomNode({ tagName: 'div', className: 'markdown prose', textContent: '' })
    );

    let poll = 0;
    md.dynamicTextProvider = () => {
      poll++;
      if (poll === 1) return 'Start of line';
      return 'Complete stable sentence.';
    };

    const start = Date.now();
    await collector.waitForStreamingComplete(page as any, 1500);
    const elapsed = Date.now() - start;

    assert(elapsed < 1500, `Must complete under 1500ms, took ${elapsed}ms`);
    pass('2.3', `1500ms timeout accommodates initial growth and completes in ${elapsed}ms`);
  } catch (err: any) {
    fail('2.3', '1500ms timeout test failed', err);
  }

  // Test 2.4: Timeout = 2000ms with shrinkage under default options
  try {
    const page = new StressPage();
    const assistantTurn = page.addNode(
      new StressDomNode({ tagName: 'div', attributes: { 'data-message-author-role': 'assistant' } })
    );
    const md = assistantTurn.appendChild(
      new StressDomNode({ tagName: 'div', className: 'markdown prose', textContent: '' })
    );

    let poll = 0;
    md.dynamicTextProvider = () => {
      poll++;
      if (poll === 1) return 'A'.repeat(80);
      return 'B'.repeat(60); // Shrunk to 60
    };

    const start = Date.now();
    await collector.waitForStreamingComplete(page as any, 2000);
    const elapsed = Date.now() - start;

    assert(elapsed < 2000, `Must complete under 2000ms, took ${elapsed}ms`);
    pass('2.4', `2000ms timeout handles shrinkage and 3 cycles in ${elapsed}ms`);
  } catch (err: any) {
    fail('2.4', '2000ms timeout test failed', err);
  }

  // Test 2.5: Starvation Guard: waitForStreamingStart does NOT consume all time when streaming takes too long
  try {
    const page = new StressPage();
    // No assistant turn, no stop button -> streaming never starts
    const start = Date.now();
    let timedOut = false;

    try {
      // 800ms total timeout. cappedStartTimeout should be Math.min(5000, Math.max(200, 800 * 0.25)) = 200ms
      await collector.waitForStreamingComplete(page as any, 800);
    } catch (err: any) {
      if (err instanceof ChatGptStreamingTimeoutError) {
        timedOut = true;
      }
    }
    const elapsed = Date.now() - start;

    assert.strictEqual(timedOut, true, 'Must throw ChatGptStreamingTimeoutError');
    assert(elapsed >= 750 && elapsed <= 1400, `Expected elapsed around 800ms (+ overhead), got ${elapsed}ms`);
    pass('2.5', `Starvation guard: 800ms timeout caps streaming start wait and throws timeout gracefully in ${elapsed}ms`);
  } catch (err: any) {
    fail('2.5', 'Starvation guard test failed', err);
  }

  // Test 2.6: Ultra-short timeout (350ms) with unstable text -> diagnostic accuracy
  try {
    const page = new StressPage();
    const assistantTurn = page.addNode(
      new StressDomNode({ tagName: 'div', attributes: { 'data-message-author-role': 'assistant' } })
    );
    const md = assistantTurn.appendChild(
      new StressDomNode({ tagName: 'div', className: 'markdown prose', textContent: '' })
    );

    let counter = 0;
    md.dynamicTextProvider = () => {
      counter++;
      return 'X'.repeat(counter * 15);
    };

    let caughtError: ChatGptStreamingTimeoutError | null = null;
    try {
      await collector.waitForStreamingComplete(page as any, 350);
    } catch (err: any) {
      if (err instanceof ChatGptStreamingTimeoutError) {
        caughtError = err;
      }
    }

    assert(caughtError !== null, 'Must throw ChatGptStreamingTimeoutError');
    assert(caughtError!.elapsedMs >= 300, `elapsedMs diagnostic must reflect real time: ${caughtError!.elapsedMs}`);
    pass('2.6', `Ultra-short 350ms timeout produces accurate elapsedMs (${caughtError!.elapsedMs}ms) diagnostics`);
  } catch (err: any) {
    fail('2.6', 'Ultra-short timeout test failed', err);
  }

  // ----------------------------------------------------------------------------
  // SECTION 3: MUTEX CONCURRENCY ON PORT 9223 & STACK SAFETY
  // ----------------------------------------------------------------------------
  console.log(`\n${BOLD}[SECTION 3] Port 9223 Mutex Queue & Serialization Safety${RESET}`);

  // Test 3.1: 5 concurrent callers execute strictly serialized
  try {
    const executionOrder: number[] = [];
    const runPromises = [1, 2, 3, 4, 5].map((id) =>
      collector.runExclusive(async () => {
        executionOrder.push(id);
        await new Promise((r) => setTimeout(r, 20));
        return id * 10;
      })
    );

    const results = await Promise.all(runPromises);
    assert.deepStrictEqual(executionOrder, [1, 2, 3, 4, 5], 'Calls must execute in exact FIFO order');
    assert.deepStrictEqual(results, [10, 20, 30, 40, 50], 'All results must match');
    assert.strictEqual(collector.isBusy(), false, 'isBusy() must be false after completion');
    pass('3.1', 'FIFO mutex queue serializes 5 concurrent automation jobs in exact sequence');
  } catch (err: any) {
    fail('3.1', 'FIFO mutex queue failed', err);
  }

  // Test 3.2: Exception thrown in mutex job does not poison queue for subsequent callers
  try {
    let job2Executed = false;
    const p1 = collector.runExclusive(async () => {
      throw new Error('Simulated transient worker failure');
    });

    const p2 = collector.runExclusive(async () => {
      job2Executed = true;
      return 'recovered';
    });

    await assert.rejects(p1, /Simulated transient worker failure/);
    const res2 = await p2;
    assert.strictEqual(job2Executed, true, 'Job 2 must execute despite Job 1 failure');
    assert.strictEqual(res2, 'recovered');
    assert.strictEqual(collector.isBusy(), false, 'Mutex must release lock after error');
    pass('3.2', 'Exception inside runExclusive does not poison mutex queue for subsequent callers');
  } catch (err: any) {
    fail('3.2', 'Mutex exception safety failed', err);
  }

  // ----------------------------------------------------------------------------
  // SECTION 4: PREAMBLE STRIPPING & TRUNCATION HEURISTICS
  // ----------------------------------------------------------------------------
  console.log(`\n${BOLD}[SECTION 4] Preamble Stripping & Truncation Edge Cases${RESET}`);

  // Test 4.1: Complex composite Vietnamese preambles with markdown headers
  try {
    const complexPreamble =
      'Chắc chắn rồi! Dưới đây là phần kịch bản tiếp theo cho video của bạn:\n\n' +
      'CÂU 26: Nội dung câu 26 tiếp nối.\n' +
      'CÂU 27: Kết luận video.\n' +
      '=== END SCRIPT ===';

    const cleaned = stripContinuationFillerIntros(complexPreamble);
    assert(!cleaned.includes('Chắc chắn rồi'), 'Affirmation must be stripped');
    assert(!cleaned.includes('Dưới đây là phần kịch bản'), 'Preamble intro must be stripped');
    assert(cleaned.startsWith('CÂU 26:'), `Must start directly with beat header: "${cleaned.slice(0, 30)}"`);
    pass('4.1', 'Composite Vietnamese conversational preambles stripped cleanly');
  } catch (err: any) {
    fail('4.1', 'Composite preamble test failed', err);
  }

  // Test 4.2: isCutoffSentence on markdown code fences and bold text
  try {
    // A: Code block closed
    const textA = '```json\n{"status": "ok"}\n```';
    assert.strictEqual(isCutoffSentence(textA), false, 'Closing code fence ``` must return false');

    // B: Markdown bold ending
    const textB = 'CÂU 10: Hãy nhấn đăng ký kênh để xem thêm nội dung hấp dẫn nhé!**';
    assert.strictEqual(isCutoffSentence(textB), false, 'Sentence with terminal punctuation before bold marker must return false');

    // C: Incomplete beat header
    const textC = 'CÂU 15:';
    assert.strictEqual(isCutoffSentence(textC), true, 'Trailing incomplete beat header must return true');

    // D: Dangling comma or colon
    const textD = 'CÂU 12: Chúng ta có thể thấy rằng,';
    assert.strictEqual(isCutoffSentence(textD), true, 'Dangling comma must return true');

    pass('4.2', 'isCutoffSentence correctly evaluates markdown fences, bold wrappers, and dangling connectors');
  } catch (err: any) {
    fail('4.2', 'isCutoffSentence edge case failed', err);
  }

  // Test 4.3: Multi-turn stitching with duplicate scene header and dangling line
  try {
    const turn1 =
      '=== BEGIN SCRIPT ===\n' +
      'CÂU 1: Giới thiệu mở đầu video.\n' +
      'CÂU 2: Đây là câu thoại đang nói dở,';

    const turn2 =
      'Dưới đây là phần tiếp theo:\n' +
      'CÂU 2: Đây là câu thoại đang nói dở, nhưng được bổ sung hoàn chỉnh trọn vẹn.\n' +
      'CÂU 3: Lời kêu gọi hành động.\n' +
      '=== END SCRIPT ===';

    const stitched = stitchScriptTurns([turn1, turn2]);
    const lines = stitched.split('\n').map((l) => l.trim()).filter(Boolean);

    // Turn 2 replaces truncated CÂU 2 with full version
    const cau2Lines = lines.filter((l) => l.startsWith('CÂU 2:'));
    assert.strictEqual(cau2Lines.length, 1, 'Duplicate CÂU 2 must be deduplicated');
    assert(cau2Lines[0].includes('nhưng được bổ sung hoàn chỉnh'), 'Longer version of CÂU 2 must be preserved');
    assert(stitched.includes('=== END SCRIPT ==='), 'End marker must be preserved');
    pass('4.3', 'stitchScriptTurns seamlessly replaces truncated colliding scene header with complete turn');
  } catch (err: any) {
    fail('4.3', 'stitchScriptTurns test failed', err);
  }

  // ==============================================================================
  // SUMMARY REPORT
  // ==============================================================================
  console.log(`\n${BOLD}${CYAN}================================================================================${RESET}`);
  console.log(`${BOLD}${CYAN} ADVERSARIAL STRESS TEST SUMMARY REPORT                                         ${RESET}`);
  console.log(`${BOLD}${CYAN}================================================================================${RESET}`);
  console.log(`  Total Scenarios Executed : ${BOLD}${totalTests}${RESET}`);
  console.log(`  Passed                   : ${GREEN}${passedTests}${RESET}`);
  console.log(`  Failed                   : ${failedTests > 0 ? RED : GREEN}${failedTests}${RESET}`);
  console.log(`${BOLD}${CYAN}================================================================================${RESET}\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAdversarialStressSuite().catch((e) => {
  console.error('Fatal stress suite failure:', e);
  process.exit(1);
});
