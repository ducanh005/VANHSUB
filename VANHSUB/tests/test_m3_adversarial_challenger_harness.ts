/**
 * tests/test_m3_adversarial_challenger_harness.ts
 *
 * Empirical Adversarial Challenger Test Harness for Gate M3 Iteration 2
 * Verification Target: ChatGptScriptCollector.ts
 *
 * Independent Oracles & Stress Matrix:
 * 1. isCutoffSentence exhaustive boundary stress (=== END SCRIPT ===, JSON braces, terminal CJK, dangling connectors, markdown fences)
 * 2. stripContinuationFillerIntros composite preamble stripping & stacking stress (Vietnamese & English variations, safety against stripping valid beats)
 * 3. handleContinuationIfTruncated zero-turn early exit oracle on completed scripts and blueprints
 * 4. stitchScriptTurns adversarial multi-turn stress (beat collision, broken joins, multi-turn accumulation)
 */

import assert from 'assert';
import {
  ChatGptScriptCollector,
  isCutoffSentence,
  isMissingExpectedMarker,
  stripContinuationFillerIntros,
  CONTINUATION_FILLER_PATTERNS,
  stitchScriptTurns,
  stitchProseTurns,
  buildContinuationPrompt,
} from '../main/ai-studio/chatgpt/ChatGptScriptCollector';

// ==============================================================================
// Mock DOM / Page Fixture
// ==============================================================================

class MockNode {
  public selector: string;
  public tagName: string;
  public textContent: string = '';
  public attributes: Record<string, string> = {};
  public isVisible: boolean = true;
  public clickListeners: Array<() => Promise<void> | void> = [];
  public children: MockNode[] = [];

  constructor(selector: string, tagName = 'div') {
    this.selector = selector;
    this.tagName = tagName;
  }

  public matches(sel: string): boolean {
    if (this.selector === sel) return true;
    if (sel.startsWith('#') && this.attributes['id'] === sel.slice(1)) return true;
    if (sel.startsWith('.') && this.attributes['class']?.includes(sel.slice(1))) return true;
    if (sel.includes('[data-testid=') && this.attributes['data-testid']) {
      const match = sel.match(/\[data-testid=["']?([^"'\]]+)["']?\]/);
      if (match && this.attributes['data-testid'] === match[1]) return true;
    }
    if (sel.includes('[data-message-author-role=') && this.attributes['data-message-author-role']) {
      const match = sel.match(/\[data-message-author-role=["']?([^"'\]]+)["']?\]/);
      if (match && this.attributes['data-message-author-role'] === match[1]) return true;
    }
    if (sel.includes(':has-text(')) {
      const match = sel.match(/:has-text\(["']?([^"')]+)["']?\)/);
      if (match && this.textContent.includes(match[1])) return true;
    }
    return false;
  }

  public getAllDescendants(): MockNode[] {
    const list: MockNode[] = [];
    for (const child of this.children) {
      list.push(child);
      list.push(...child.getAllDescendants());
    }
    return list;
  }
}

class MockLocator {
  constructor(public nodes: MockNode[], public page: MockPage) {}

  public async count(): Promise<number> {
    return this.nodes.length;
  }

  public first(): MockLocator {
    return new MockLocator(this.nodes.slice(0, 1), this.page);
  }

  public nth(index: number): MockLocator {
    return new MockLocator(this.nodes.slice(index, index + 1), this.page);
  }

  public async isVisible(): Promise<boolean> {
    return this.nodes.length > 0 ? this.nodes[0].isVisible : false;
  }

  public async isEnabled(): Promise<boolean> {
    if (this.nodes.length === 0) return false;
    const disabled = this.nodes[0].attributes['disabled'];
    const ariaDisabled = this.nodes[0].attributes['aria-disabled'];
    return !disabled && ariaDisabled !== 'true';
  }

  public async innerText(): Promise<string> {
    return this.nodes.length > 0 ? this.nodes[0].textContent : '';
  }

  public async textContent(): Promise<string> {
    return this.nodes.length > 0 ? this.nodes[0].textContent : '';
  }

  public async inputValue(): Promise<string> {
    return this.nodes.length > 0 ? this.nodes[0].textContent : '';
  }

  public async fill(value: string): Promise<void> {
    if (this.nodes.length === 0) throw new Error('Fill target not found');
    this.nodes[0].textContent = value;
  }

  public async click(): Promise<void> {
    if (this.nodes.length === 0) throw new Error('Click target not found');
    for (const listener of this.nodes[0].clickListeners) {
      await listener();
    }
  }

  public async focus(): Promise<void> {}
  public async waitFor(): Promise<void> {}

  public locator(selector: string): MockLocator {
    const matched: MockNode[] = [];
    for (const node of this.nodes) {
      if (node.matches(selector)) matched.push(node);
      for (const desc of node.getAllDescendants()) {
        if (desc.matches(selector)) matched.push(desc);
      }
    }
    return new MockLocator(matched, this.page);
  }
}

class MockPage {
  public currentUrl: string = 'https://chatgpt.com';
  public nodes: MockNode[] = [];
  public sentPrompts: string[] = [];

  public keyboard = {
    insertText: async (t: string) => {},
    type: async (t: string) => {},
    press: async (k: string) => {},
  };

  public locator(selector: string): MockLocator {
    const matched = this.nodes.filter((n) => n.matches(selector));
    return new MockLocator(matched, this);
  }

  public url(): string {
    return this.currentUrl;
  }

  public async goto(url: string): Promise<void> {
    this.currentUrl = url;
  }

  public context() {
    return {
      grantPermissions: async () => {},
    };
  }

  public async evaluate<T = any>(fn: any, arg?: any): Promise<T> {
    if (typeof fn === 'function') {
      return fn(arg);
    }
    return undefined as unknown as T;
  }
}

// ==============================================================================
// Test Runner
// ==============================================================================

interface TestResult {
  group: string;
  name: string;
  passed: boolean;
  error?: string;
}

const allResults: TestResult[] = [];

async function runTest(group: string, name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      await res;
    }
    allResults.push({ group, name, passed: true });
    console.log(`  ✓ [PASS] [${group}] ${name}`);
  } catch (err: any) {
    allResults.push({ group, name, passed: false, error: err?.message || String(err) });
    console.error(`  ✗ [FAIL] [${group}] ${name}`);
    console.error(`     Error: ${err?.message || err}`);
  }
}

// ==============================================================================
// ADVERSARIAL STRESS TEST SUITE
// ==============================================================================

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('  M3 ITERATION 2 ADVERSARIAL CHALLENGER STRESS HARNESS');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  // ----------------------------------------------------------------------------
  // SECTION 1: isCutoffSentence Boundary Stress
  // ----------------------------------------------------------------------------
  console.log('▶ [SECTION 1] isCutoffSentence EMPIRICAL ORACLE & BOUNDARY STRESS');

  await runTest('Cutoff Oracle', 'Returns false for scripts ending with === END SCRIPT ===', () => {
    assert.strictEqual(isCutoffSentence('CÂU 1: Mở đầu.\n=== END SCRIPT ==='), false);
    assert.strictEqual(isCutoffSentence('CÂU 1: Mở đầu.\n===   END SCRIPT   ==='), false);
    assert.strictEqual(isCutoffSentence('=== BEGIN SCRIPT ===\nCÂU 1: Nội dung.\n=== END SCRIPT ===\n'), false);
    assert.strictEqual(isCutoffSentence('CÂU 1: Nội dung.\n=== END SCRIPT ===   '), false);
    assert.strictEqual(isCutoffSentence('CÂU 1: Nội dung.\n--- END OF SCRIPT ---'), false);
    assert.strictEqual(isCutoffSentence('CÂU 1: Nội dung.\n=== SOURCE END ==='), false);
    assert.strictEqual(isCutoffSentence('CÂU 1: Nội dung.\n=== END BLUEPRINT ==='), false);
    assert.strictEqual(isCutoffSentence('CÂU 1: Nội dung.\n=== END MASTER PROMPT ==='), false);
    assert.strictEqual(isCutoffSentence('CÂU 1: Nội dung.\n=== KẾT THÚC ==='), false);
    assert.strictEqual(isCutoffSentence('CÂU 1: Nội dung.\n=== HOÀN TẤT ==='), false);
  });

  await runTest('Cutoff Oracle', 'Returns false for completed JSON blueprints ending with } and ]', () => {
    assert.strictEqual(isCutoffSentence('{\n  "title": "Video",\n  "beats": 10\n}'), false);
    assert.strictEqual(isCutoffSentence('{"status": "ok"}'), false);
    assert.strictEqual(isCutoffSentence('{\n  "items": [1, 2, 3]\n}\n\n'), false);
    assert.strictEqual(isCutoffSentence('[\n  {"id": 1},\n  {"id": 2}\n]'), false);
    assert.strictEqual(isCutoffSentence('[ "a", "b", "c" ]'), false);
  });

  await runTest('Cutoff Oracle', 'Returns false for code fence terminations', () => {
    assert.strictEqual(isCutoffSentence('```json\n{"a": 1}\n```'), false);
    assert.strictEqual(isCutoffSentence('```\nconst x = 1;\n```'), false);
    assert.strictEqual(isCutoffSentence('Kịch bản:\n```\nCÂU 1: Xong.\n```\n'), false);
  });

  await runTest('Cutoff Oracle', 'Returns false for normal sentences with terminal punctuation & formatting', () => {
    assert.strictEqual(isCutoffSentence('CÂU 1: Đây là câu hoàn chỉnh.'), false);
    assert.strictEqual(isCutoffSentence('CÂU 2: Tuyệt vời quá!'), false);
    assert.strictEqual(isCutoffSentence('CÂU 3: Bạn có hiểu không?'), false);
    assert.strictEqual(isCutoffSentence('CÂU 4: Còn nhiều điều kỳ thú…'), false);
    assert.strictEqual(isCutoffSentence('CÂU 5: Nhân vật thốt lên: "Tôi đã hiểu!"'), false);
    assert.strictEqual(isCutoffSentence('CÂU 6: Nhân vật nói: “Đây là chân lý.”'), false);
    assert.strictEqual(isCutoffSentence('CÂU 7: Điểm nhấn **quan trọng.**'), false);
    assert.strictEqual(isCutoffSentence('CÂU 8: Toàn bộ *kết thúc.*'), false);
    assert.strictEqual(isCutoffSentence('CÂU 9: Kính mời các bạn đón xem (tập 2).'), false);
    assert.strictEqual(isCutoffSentence('CÂU 10: Điệp khúc kết [hết].'), false);
    assert.strictEqual(isCutoffSentence('CÂU 11: Dấu câu CJK。\nCÂU 12: Hoàn tất！'), false);
  });

  await runTest('Cutoff Oracle', 'Returns true for genuine cutoffs and dangling tokens', () => {
    // Dangling connectors
    assert.strictEqual(isCutoffSentence('CÂU 1: Danh sách gồm:'), true);
    assert.strictEqual(isCutoffSentence('CÂU 2: Khi nhân vật bước vào phòng,'), true);
    assert.strictEqual(isCutoffSentence('CÂU 3: Điều này dẫn tới -'), true);
    assert.strictEqual(isCutoffSentence('CÂU 4: Nhưng vì vậy;'), true);
    assert.strictEqual(isCutoffSentence('CÂU 5: Mở ngoặc ('), true);
    assert.strictEqual(isCutoffSentence('CÂU 6: Mở ngoặc vuông ['), true);
    assert.strictEqual(isCutoffSentence('CÂU 7: Mở ngoặc nhọn {'), true);

    // Incomplete scene/beat headers
    assert.strictEqual(isCutoffSentence('CÂU 10:'), true);
    assert.strictEqual(isCutoffSentence('**CÂU 10**'), true);
    assert.strictEqual(isCutoffSentence('Beat 5 -'), true);
    assert.strictEqual(isCutoffSentence('Phân cảnh 12:'), true);
    assert.strictEqual(isCutoffSentence('Câu 8.'), true); // "Câu 8." without content is an incomplete header!

    // Mid-sentence missing terminal punctuation
    assert.strictEqual(isCutoffSentence('CÂU 1: Nhân vật chính đang chạy trên cánh đồng'), true);
    assert.strictEqual(isCutoffSentence('Hôm nay chúng ta sẽ khám phá'), true);
  });

  await runTest('Cutoff Oracle', 'Gracefully handles empty strings, whitespace, and nullish inputs', () => {
    assert.strictEqual(isCutoffSentence(''), false);
    assert.strictEqual(isCutoffSentence('   \n\t  '), false);
    assert.strictEqual(isCutoffSentence(null as any), false);
    assert.strictEqual(isCutoffSentence(undefined as any), false);
  });

  // ----------------------------------------------------------------------------
  // SECTION 2: stripContinuationFillerIntros Preamble Stripping Stress
  // ----------------------------------------------------------------------------
  console.log('\n▶ [SECTION 2] stripContinuationFillerIntros COMPOSITE PREAMBLE STRIPPING');

  await runTest('Filler Stripping', 'Cleanly strips "Dưới đây là phần kịch bản tiếp theo:" composite preamble', () => {
    const input = 'Dưới đây là phần kịch bản tiếp theo:\nCÂU 11: Đây là phân cảnh 11.';
    const cleaned = stripContinuationFillerIntros(input);
    assert.strictEqual(cleaned, 'CÂU 11: Đây là phân cảnh 11.');
  });

  await runTest('Filler Stripping', 'Strips various Vietnamese compound continuation preambles', () => {
    const variants = [
      'Dưới đây là các phân cảnh tiếp theo của kịch bản:\nCÂU 12: Phân cảnh 12.',
      'Tiếp theo là phần kịch bản tiếp theo:\nCÂU 12: Phân cảnh 12.',
      'Sau đây là phần nội dung tiếp theo của kịch bản:\nCÂU 12: Phân cảnh 12.',
      'Kịch bản tiếp tục:\nCÂU 12: Phân cảnh 12.',
      'Tiếp tục kịch bản:\nCÂU 12: Phân cảnh 12.',
      'Phần kịch bản tiếp theo:\nCÂU 12: Phân cảnh 12.',
      'Tiếp tục từ CÂU 12:\nCÂU 12: Phân cảnh 12.',
      'Viết tiếp từ Beat 12:\nCÂU 12: Phân cảnh 12.',
    ];

    for (const v of variants) {
      const stripped = stripContinuationFillerIntros(v);
      assert.strictEqual(stripped, 'CÂU 12: Phân cảnh 12.', `Failed stripping variant: "${v.split('\n')[0]}"`);
    }
  });

  await runTest('Filler Stripping', 'Strips standalone and compound conversational affirmations', () => {
    const input1 = 'Chắc chắn rồi!\nDưới đây là phần kịch bản tiếp theo:\nCÂU 15: Phân cảnh 15.';
    assert.strictEqual(stripContinuationFillerIntros(input1), 'CÂU 15: Phân cảnh 15.');

    const input2 = 'Vâng, tôi sẽ tiếp tục viết tiếp kịch bản:\nCÂU 15: Phân cảnh 15.';
    assert.strictEqual(stripContinuationFillerIntros(input2), 'CÂU 15: Phân cảnh 15.');

    const input3 = 'Được rồi! Sau đây là các phân cảnh còn lại:\nCÂU 15: Phân cảnh 15.';
    assert.strictEqual(stripContinuationFillerIntros(input3), 'CÂU 15: Phân cảnh 15.');
  });

  await runTest('Filler Stripping', 'Strips stacked / chained preambles up to 5 iterations', () => {
    const stacked =
      'Chắc chắn rồi!\n' +
      'Vâng!\n' +
      'Dưới đây là phần kịch bản tiếp theo:\n' +
      'Tiếp tục kịch bản:\n' +
      'CÂU 20: Phân cảnh hai mươi.';

    const cleaned = stripContinuationFillerIntros(stacked);
    assert.strictEqual(cleaned, 'CÂU 20: Phân cảnh hai mươi.');
  });

  await runTest('Filler Stripping', 'Strips English continuation preambles and duplicated markers', () => {
    const en1 = 'Sure! Here is the continuation of the script:\nCÂU 21: Scene 21.';
    assert.strictEqual(stripContinuationFillerIntros(en1), 'CÂU 21: Scene 21.');

    const en2 = 'Certainly, continuing from where we left off:\nCÂU 21: Scene 21.';
    assert.strictEqual(stripContinuationFillerIntros(en2), 'CÂU 21: Scene 21.');

    const markerDupe = '=== BEGIN SCRIPT ===\nCÂU 21: Scene 21.';
    assert.strictEqual(stripContinuationFillerIntros(markerDupe), 'CÂU 21: Scene 21.');
  });

  await runTest('Filler Stripping', 'SAFETY CHECK: Does NOT strip genuine script content starting with CÂU', () => {
    const genuineScript = 'CÂU 1: Dưới đây là phần kịch bản tiếp theo mà nhân vật đọc trên màn hình.';
    const result = stripContinuationFillerIntros(genuineScript);
    assert.strictEqual(result, genuineScript, 'Should not alter legitimate script dialogue');
  });

  // ----------------------------------------------------------------------------
  // SECTION 3: handleContinuationIfTruncated Zero-Turn Oracle on Completed Output
  // ----------------------------------------------------------------------------
  console.log('\n▶ [SECTION 3] handleContinuationIfTruncated ZERO-TURN ORACLE ON COMPLETED OUTPUT');

  await runTest('Continuation Oracle', 'Completes immediately with 0 continuation turns when script ends with === END SCRIPT ===', async () => {
    const page = new MockPage();
    // Prompt textarea and send button present in DOM
    const promptNode = new MockNode('#prompt-textarea', 'div');
    page.nodes.push(promptNode);
    const sendBtn = new MockNode('button[data-testid="send-button"]', 'button');
    page.nodes.push(sendBtn);

    const completedScript = [
      '=== BEGIN SCRIPT ===',
      'CÂU 1: Chào mừng các bạn đến với kênh.',
      'CÂU 2: Hôm nay chúng ta sẽ khám phá bí mật lịch sử.',
      'CÂU 3: Hãy bấm like và đăng ký kênh nhé!',
      '=== END SCRIPT ===',
    ].join('\n');

    const collector = new ChatGptScriptCollector();
    let progressMessages: string[] = [];

    const result = await collector.handleContinuationIfTruncated(page, completedScript, {
      kind: 'script',
      timeoutMs: 2000,
      onProgress: (m) => progressMessages.push(m),
    });

    assert.strictEqual(result.continuedTurns, 0, 'Must have 0 continued turns on finished script');
    assert.strictEqual(result.isTruncated, false, 'Must not be flagged as truncated');
    assert.strictEqual(result.fullText, completedScript, 'Output text must be identical to input');
    assert.strictEqual(progressMessages.length, 0, 'No continuation progress messages should be dispatched');
    assert.strictEqual(page.sentPrompts.length, 0, 'No continuation prompts should be sent');
  });

  await runTest('Continuation Oracle', 'Completes immediately with 0 continuation turns on completed JSON blueprint ending with }', async () => {
    const page = new MockPage();
    const promptNode = new MockNode('#prompt-textarea', 'div');
    page.nodes.push(promptNode);

    const completedJson = JSON.stringify({
      title: 'Khám phá vũ trụ',
      targetAudience: 'Người yêu khoa học',
      hookDurationSec: 5,
      beatsCount: 15,
    }, null, 2);

    const collector = new ChatGptScriptCollector();
    const result = await collector.handleContinuationIfTruncated(page, completedJson, {
      kind: 'idea',
      timeoutMs: 2000,
    });

    assert.strictEqual(result.continuedTurns, 0, 'Must have 0 continued turns on finished JSON');
    assert.strictEqual(result.isTruncated, false, 'JSON must not be flagged as truncated');
    assert.strictEqual(result.fullText, completedJson);
  });

  await runTest('Continuation Oracle', 'Completes immediately with 0 continuation turns on Master Prompt with Section 9', async () => {
    const page = new MockPage();
    const completedMasterPrompt = [
      '1. SYSTEM ROLE: Bạn là chuyên gia biên kịch video viral.',
      '2. OBJECTIVE: Tạo kịch bản 60 giây.',
      '9. STRICT OUTPUT FORMAT: Trả về marker === BEGIN SCRIPT ===',
    ].join('\n');

    const collector = new ChatGptScriptCollector();
    const result = await collector.handleContinuationIfTruncated(page, completedMasterPrompt, {
      kind: 'master_prompt',
      timeoutMs: 2000,
    });

    assert.strictEqual(result.continuedTurns, 0, 'Must have 0 continued turns on completed master prompt');
    assert.strictEqual(result.isTruncated, false);
  });

  await runTest('Continuation Oracle', 'Correctly triggers continuation on truncated script and stitches result', async () => {
    const page = new MockPage();

    // Setup assistant turn in DOM
    const assistantNode = new MockNode('div[data-message-author-role="assistant"]');
    assistantNode.attributes['data-message-author-role'] = 'assistant';
    page.nodes.push(assistantNode);

    // Setup prompt textarea and send button
    const promptNode = new MockNode('#prompt-textarea', 'div');
    promptNode.attributes['id'] = 'prompt-textarea';
    promptNode.attributes['contenteditable'] = 'true';
    page.nodes.push(promptNode);

    const sendBtn = new MockNode('button[data-testid="send-button"]', 'button');
    sendBtn.attributes['data-testid'] = 'send-button';
    page.nodes.push(sendBtn);

    sendBtn.clickListeners.push(async () => {
      // Simulate new assistant turn spawned by ChatGPT Web
      const turn2Node = new MockNode('div[data-message-author-role="assistant"]');
      turn2Node.attributes['data-message-author-role'] = 'assistant';
      turn2Node.textContent = [
        'Dưới đây là phần kịch bản tiếp theo:',
        'CÂU 2: Phân cảnh thứ hai hoàn tất.',
        '=== END SCRIPT ===',
      ].join('\n');
      page.nodes.push(turn2Node);
      // Clear prompt
      promptNode.textContent = '';
    });

    const truncatedScript = '=== BEGIN SCRIPT ===\nCÂU 1: Bắt đầu câu chuyện nhưng chưa hết';

    const collector = new ChatGptScriptCollector();
    const result = await collector.handleContinuationIfTruncated(page, truncatedScript, {
      kind: 'script',
      timeoutMs: 5000,
      maxContinuationTurns: 2,
    });

    assert.strictEqual(result.continuedTurns, 1, 'Should have executed 1 continuation turn');
    assert.strictEqual(result.isTruncated, false, 'Should be marked complete after receiving === END SCRIPT ===');
    assert.ok(result.fullText.includes('CÂU 1:'), 'Must retain Turn 1 content');
    assert.ok(result.fullText.includes('CÂU 2: Phân cảnh thứ hai hoàn tất.'), 'Must contain Turn 2 content');
    assert.ok(!result.fullText.includes('Dưới đây là phần kịch bản tiếp theo:'), 'Must strip filler intro');
    assert.ok(result.fullText.includes('=== END SCRIPT ==='), 'Must end with END SCRIPT marker');
  });

  // ----------------------------------------------------------------------------
  // SECTION 4: stitchScriptTurns Multi-Turn Adversarial Stress
  // ----------------------------------------------------------------------------
  console.log('\n▶ [SECTION 4] stitchScriptTurns ADVERSARIAL STRESS MATRIX');

  await runTest('Stitching Matrix', 'Reconciles duplicate beat header collision with longer content', () => {
    const turn1 = 'CÂU 1: Mở đầu.\nCÂU 2: Đang nói dở thì bị';
    const turn2 = 'CÂU 2: Đang nói dở thì bị ngắt quãng giữa chừng.\nCÂU 3: Tiếp theo.';

    const stitched = stitchScriptTurns([turn1, turn2]);
    const lines = stitched.split('\n');

    assert.strictEqual(lines.filter((l) => l.startsWith('CÂU 2:')).length, 1, 'CÂU 2 must appear exactly once');
    assert.strictEqual(lines.find((l) => l.startsWith('CÂU 2:')), 'CÂU 2: Đang nói dở thì bị ngắt quãng giữa chừng.');
  });

  await runTest('Stitching Matrix', 'Seamlessly joins mid-sentence break when Turn 2 head lacks CÂU header', () => {
    const turn1 = 'CÂU 1: Mở đầu.\nCÂU 2: Nhân vật đang suy nghĩ về tương lai';
    const turn2 = 'và những gì sắp diễn ra trong ngày mai.\nCÂU 3: Kết thúc.';

    const stitched = stitchScriptTurns([turn1, turn2]);
    assert.ok(stitched.includes('CÂU 2: Nhân vật đang suy nghĩ về tương lai và những gì sắp diễn ra trong ngày mai.'));
  });

  await runTest('Stitching Matrix', 'Handles 3 turns with composite preambles across turns', () => {
    const turn1 = '=== BEGIN SCRIPT ===\nCÂU 1: Đoạn một.\nCÂU 2: Đoạn hai.';
    const turn2 = 'Dưới đây là phần kịch bản tiếp theo:\nCÂU 3: Đoạn ba.\nCÂU 4: Đoạn bốn.';
    const turn3 = 'Chắc chắn rồi! Tiếp tục kịch bản:\nCÂU 5: Đoạn năm kết thúc.\n=== END SCRIPT ===';

    const stitched = stitchScriptTurns([turn1, turn2, turn3]);
    assert.ok(stitched.includes('=== BEGIN SCRIPT ==='));
    assert.ok(stitched.includes('=== END SCRIPT ==='));
    assert.ok(!stitched.includes('Dưới đây là phần kịch bản tiếp theo:'));
    assert.ok(!stitched.includes('Chắc chắn rồi!'));
    assert.ok(stitched.includes('CÂU 1: Đoạn một.'));
    assert.ok(stitched.includes('CÂU 2: Đoạn hai.'));
    assert.ok(stitched.includes('CÂU 3: Đoạn ba.'));
    assert.ok(stitched.includes('CÂU 4: Đoạn bốn.'));
    assert.ok(stitched.includes('CÂU 5: Đoạn năm kết thúc.'));
  });

  await runTest('Stitching Matrix', 'Auto-appends === END SCRIPT === if BEGIN marker was present but END marker missing', () => {
    const turn1 = '=== BEGIN SCRIPT ===\nCÂU 1: Đoạn một.';
    const turn2 = 'CÂU 2: Đoạn hai.';

    const stitched = stitchScriptTurns([turn1, turn2]);
    assert.ok(stitched.endsWith('=== END SCRIPT ==='));
  });

  // ----------------------------------------------------------------------------
  // SECTION 5: Summary & Integrity Assertion
  // ----------------------------------------------------------------------------
  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log('  TEST SUMMARY');
  console.log('════════════════════════════════════════════════════════════════════════════════');

  const total = allResults.length;
  const passed = allResults.filter((r) => r.passed).length;
  const failed = allResults.filter((r) => !r.passed).length;

  console.log(`Total Adversarial Tests: ${total}`);
  console.log(`Passed:                  ${passed} (${Math.round((passed / total) * 100)}%)`);
  console.log(`Failed:                  ${failed}`);

  if (failed > 0) {
    console.error('\nFailed tests:');
    for (const r of allResults.filter((r) => !r.passed)) {
      console.error(`- [${r.group}] ${r.name}: ${r.error}`);
    }
    process.exit(1);
  } else {
    console.log('\n🎉 ALL ADVERSARIAL STRESS TESTS PASSED EMPIRICALLY!');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Unhandled harness exception:', err);
  process.exit(1);
});
