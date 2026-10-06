/**
 * tests/test_m3_challenger_empirical.ts
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST SUITE FOR MILESTONE 3:
 * Continuation Engine & Zero-Echo Stitching in ChatGptScriptCollector.ts
 *
 * Evaluates:
 * 1. Multi-Turn Stitching Algorithm (stitchScriptTurns, stitchProseTurns, stripContinuationFillerIntros)
 *    - Broken sentence joins, duplicate beat numbers, multi-beat overlap collisions, marker preservation.
 * 2. Continuation Triggering & Truncation Heuristics (isCutoffSentence, isMissingExpectedMarker, buildContinuationPrompt, handleContinuationIfTruncated)
 *    - False cutoff bug on finished scripts (=== END SCRIPT ===, JSON braces, etc.)
 *    - Dual-track triggering: "Continue generating" button vs Prompt fallback.
 * 3. Extraction Logic & Fallbacks (extractLatestResponseText)
 *    - Clipboard copy vs markdown DOM fallback vs error handling.
 * 4. Zero Prompt Capture & Echo Immunity (isUserPromptEcho)
 *    - Comprehensive evaluation across prompt variations, continuation commands, and partial echoes.
 */

import assert from 'assert';
import {
  ChatGptScriptCollector,
  isCutoffSentence,
  isMissingExpectedMarker,
  stripContinuationFillerIntros,
  stitchScriptTurns,
  stitchProseTurns,
  buildContinuationPrompt,
  AssistantResponseEchoError,
} from '../main/ai-studio/chatgpt/ChatGptScriptCollector';
import { isUserPromptEcho } from '../main/ai-studio/chatgpt/chatgptSelectors.config';
import { parseChatGptScriptResponse } from '../main/ai-studio/chatgpt/ChatGptWebSessionManager';

// ==============================================================================
// Mock DOM / Page Fixture for Extraction & Continuation Testing
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
    if (sel.includes('button[aria-label*="Copy"]') && this.attributes['aria-label']?.includes('Copy')) {
      return true;
    }
    if (sel.includes('div.markdown') && this.attributes['class']?.includes('markdown')) {
      return true;
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

  public async getAttribute(name: string): Promise<string | null> {
    return this.nodes.length > 0 ? (this.nodes[0].attributes[name] ?? null) : null;
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
  public clipboardText: string = '';
  public clipboardThrows: boolean = false;

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
      if (this.clipboardThrows && fn.toString().includes('readText')) {
        throw new Error('Clipboard access denied');
      }
      // If evaluating clipboard read in simulated browser
      if (fn.toString().includes('readText')) {
        return this.clipboardText as unknown as T;
      }
      return fn(arg);
    }
    return undefined as unknown as T;
  }
}

// ==============================================================================
// Test Runner Harness
// ==============================================================================

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  error?: string;
  finding?: string;
}

const results: TestResult[] = [];

async function test(category: string, name: string, fn: () => void | Promise<void>, finding?: string) {
  try {
    const p = fn();
    if (p && typeof (p as any).then === 'function') {
      await p;
    }
    results.push({ category, name, passed: true, finding });
    console.log(`  ✓ [PASS] [${category}] ${name}`);
  } catch (err: any) {
    results.push({ category, name, passed: false, error: err.message, finding });
    console.log(`  ✗ [FAIL] [${category}] ${name}\n     -> Error: ${err.message}`);
  }
}

// ==============================================================================
// TEST EXECUTION
// ==============================================================================

async function runEmpiricalStressTests() {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('  EMPIRICAL CHALLENGER STRESS SUITE: MILESTONE 3 CONTINUATION & STITCHING ENGINE');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  // ----------------------------------------------------------------------------
  // SECTION 1: Multi-Turn Stitching Algorithm Stress Tests
  // ----------------------------------------------------------------------------
  console.log('▶ [SECTION 1] MULTI-TURN STITCHING ALGORITHM');

  await test('Stitching', 'Case 1: Duplicate beat header with longer continuation replaces truncated beat', () => {
    const turn1 = '=== BEGIN SCRIPT ===\nCÂU 1: Giới thiệu mở đầu video.\nCÂU 2: Con tàu vũ trụ bắt đầu rời khỏi bệ phóng và';
    const turn2 = 'CÂU 2: Con tàu vũ trụ bắt đầu rời khỏi bệ phóng và bay thẳng vào tầng bình lưu.\nCÂU 3: Phi hành đoàn chuẩn bị kết nối.\n=== END SCRIPT ===';
    const stitched = stitchScriptTurns([turn1, turn2]);

    assert.ok(stitched.includes('CÂU 2: Con tàu vũ trụ bắt đầu rời khỏi bệ phóng và bay thẳng vào tầng bình lưu.'));
    assert.strictEqual((stitched.match(/CÂU 2:/g) || []).length, 1, 'CÂU 2 must appear exactly once');
    assert.ok(stitched.includes('CÂU 3: Phi hành đoàn chuẩn bị kết nối.'));
  });

  await test('Stitching', 'Case 2: Broken sentence without CÂU prefix in Turn 2 seamlessly joins to last line of Turn 1', () => {
    const turn1 = 'CÂU 1: Mở đầu.\nCÂU 2: Nhà thám hiểm nhìn vào bóng tối sâu thẳm của hang động';
    const turn2 = 'và phát hiện ra một lối đi bí mật chưa từng được ghi nhận trên bản đồ.\nCÂU 3: Kết thúc tập 1.';
    const stitched = stitchScriptTurns([turn1, turn2]);

    assert.ok(
      stitched.includes('CÂU 2: Nhà thám hiểm nhìn vào bóng tối sâu thẳm của hang động và phát hiện ra một lối đi bí mật chưa từng được ghi nhận trên bản đồ.'),
      'Broken sentence should be joined seamlessly with a single space'
    );
    assert.ok(stitched.includes('CÂU 3: Kết thúc tập 1.'));
  });

  await test('Stitching', 'Preamble stripping: strips Vietnamese and English continuation conversational filler', () => {
    const fillers = [
      'Dưới đây là phần kịch bản tiếp theo:\nCÂU 10: Nội dung câu 10.',
      'Chắc chắn rồi! Dưới đây là nội dung viết tiếp:\nCÂU 11: Nội dung câu 11.',
      'Kịch bản tiếp tục:\nCÂU 12: Nội dung câu 12.',
      'Tiếp tục từ CÂU 13:\nCÂU 13: Nội dung câu 13.',
      'Here is the continuation of the script:\nCÂU 14: Content 14.',
      'Sure, here is the rest of the script:\nCÂU 15: Content 15.',
      'Continuing the script:\nCÂU 16: Content 16.',
      '=== BEGIN SCRIPT ===\nCÂU 17: Content 17.',
    ];

    for (const f of fillers) {
      const stripped = stripContinuationFillerIntros(f);
      assert.ok(!stripped.includes('Dưới đây là phần'), `Failed to strip filler: ${f}`);
      assert.ok(!stripped.includes('Chắc chắn rồi'), `Failed to strip filler: ${f}`);
      assert.ok(!stripped.includes('Kịch bản tiếp tục'), `Failed to strip filler: ${f}`);
      assert.ok(!stripped.includes('Here is the continuation'), `Failed to strip filler: ${f}`);
      assert.ok(!stripped.startsWith('=== BEGIN SCRIPT ==='), `Failed to strip duplicate marker: ${f}`);
      assert.ok(stripped.startsWith('CÂU'), `Stripped text should start with CÂU: ${stripped}`);
    }
  });

  await test('Stitching', 'Prose sliding-window overlap: reconciles 40-character identical overlap without repetition', () => {
    const prose1 = 'Mặt trời lặn dần phía sau những ngọn núi hùng vĩ, tỏa ra những dải sáng vàng cam rực rỡ khắp thung lũng.';
    const prose2 = 'tỏa ra những dải sáng vàng cam rực rỡ khắp thung lũng. Đêm nay sẽ là một đêm đầy biến động.';
    const stitched = stitchProseTurns(prose1, prose2);

    assert.strictEqual((stitched.match(/tỏa ra những dải sáng vàng cam rực rỡ khắp thung lũng/g) || []).length, 1);
    assert.ok(stitched.endsWith('Đêm nay sẽ là một đêm đầy biến động.'));
  });

  await test('Stitching', 'Stress: 3-turn script stitching preserves all beats without losing markers or headers', () => {
    const turn1 = '=== BEGIN SCRIPT ===\nCÂU 1: Bắt đầu hành trình.\nCÂU 2: Đoàn thám hiểm vượt';
    const turn2 = 'qua dãy núi tuyết hiểm trở.\nCÂU 3: Họ tìm thấy ngôi đền cổ.';
    const turn3 = 'Dưới đây là phần kết thúc kịch bản:\nCÂU 4: Bí mật được giải mã.\n=== END SCRIPT ===';

    const stitched = stitchScriptTurns([turn1, turn2, turn3]);
    assert.ok(stitched.includes('=== BEGIN SCRIPT ==='));
    assert.ok(stitched.includes('=== END SCRIPT ==='));
    assert.ok(stitched.includes('CÂU 2: Đoàn thám hiểm vượt qua dãy núi tuyết hiểm trở.'));
    assert.ok(stitched.includes('CÂU 3: Họ tìm thấy ngôi đền cổ.'));
    assert.ok(stitched.includes('CÂU 4: Bí mật được giải mã.'));
  });

  // ----------------------------------------------------------------------------
  // SECTION 2: Continuation Triggering & Truncation Heuristics Stress Tests
  // ----------------------------------------------------------------------------
  console.log('\n▶ [SECTION 2] CONTINUATION TRIGGERING & TRUNCATION HEURISTICS');

  await test('Truncation Heuristics', 'EMPIRICAL BUG PROBE 1: isCutoffSentence on completed script ending with === END SCRIPT ===', () => {
    const completeScript = '=== BEGIN SCRIPT ===\nCÂU 1: Đoạn 1.\nCÂU 2: Đoạn 2.\n=== END SCRIPT ===';
    const isCutoff = isCutoffSentence(completeScript);
    // CHALLENGE: Does isCutoffSentence return true on complete script because lastLine is '=== END SCRIPT ===' which ends with '='?
    if (isCutoff === true) {
      throw new Error(
        `CRITICAL FLAW: isCutoffSentence returns TRUE on a fully completed script ending with '=== END SCRIPT ===' ` +
        `because '=' is not in terminalPunctuationPattern. This causes handleContinuationIfTruncated to enter an unwanted continuation loop!`
      );
    }
    assert.strictEqual(isCutoff, false);
  }, 'BUG: isCutoffSentence treats === END SCRIPT === as cutoff due to trailing = sign');

  await test('Truncation Heuristics', 'EMPIRICAL BUG PROBE 2: isCutoffSentence on complete JSON ending with closing brace }', () => {
    const completeJson = '{\n  "title": "Kịch bản mẫu",\n  "beats": 10\n}';
    const isCutoff = isCutoffSentence(completeJson);
    // CHALLENGE: Does isCutoffSentence return true on complete JSON ending with '}'?
    if (isCutoff === true) {
      throw new Error(
        `CRITICAL FLAW: isCutoffSentence returns TRUE on complete JSON ending with '}' because '}' is not in terminalPunctuationPattern. ` +
        `This triggers infinite continuation loops on idea blueprints!`
      );
    }
    assert.strictEqual(isCutoff, false);
  }, 'BUG: isCutoffSentence treats } as cutoff because } is missing from terminal punctuation pattern');

  await test('Truncation Heuristics', 'isCutoffSentence correctly identifies genuine mid-sentence cutoff and dangling connectors', () => {
    assert.strictEqual(isCutoffSentence('CÂU 1: Nhân vật chính đang chạy'), true, 'Missing terminal punctuation');
    assert.strictEqual(isCutoffSentence('CÂU 1: Danh sách gồm có:'), true, 'Dangling colon');
    assert.strictEqual(isCutoffSentence('CÂU 1: Lúc đó,'), true, 'Dangling comma');
    assert.strictEqual(isCutoffSentence('CÂU 1: Bước tiếp theo -'), true, 'Dangling hyphen');
    assert.strictEqual(isCutoffSentence('CÂU 5:'), true, 'Incomplete scene header');
    assert.strictEqual(isCutoffSentence('**CÂU 10**'), true, 'Bold incomplete scene header');
  });

  await test('Truncation Heuristics', 'isMissingExpectedMarker detects missing end marker across all script kinds', () => {
    // Script kind
    assert.strictEqual(isMissingExpectedMarker('=== BEGIN SCRIPT ===\nCÂU 1: A.', 'script'), true);
    assert.strictEqual(isMissingExpectedMarker('=== BEGIN SCRIPT ===\nCÂU 1: A.\n=== END SCRIPT ===', 'script'), false);

    // Idea kind
    assert.strictEqual(isMissingExpectedMarker('{\n  "title": "A"', 'idea'), true);
    assert.strictEqual(isMissingExpectedMarker('{\n  "title": "A"\n}', 'idea'), false);

    // Master prompt kind
    assert.strictEqual(isMissingExpectedMarker('1. SYSTEM ROLE\nChuyên gia', 'master_prompt'), true);
    assert.strictEqual(isMissingExpectedMarker('1. SYSTEM ROLE\nChuyên gia\n9. STRICT OUTPUT FORMAT\nĐịnh dạng', 'master_prompt'), false);
  });

  await test('Continuation Triggering', 'buildContinuationPrompt dynamically targets next beat index and target sentence range', () => {
    const text20Beats = Array.from({ length: 20 }, (_, i) => `CÂU ${i + 1}: Nội dung phân cảnh thứ ${i + 1}.`).join('\n');
    const prompt = buildContinuationPrompt({
      kind: 'script',
      currentText: text20Beats,
      targetMinSentences: 40,
      targetMaxSentences: 50,
      topic: 'Lịch sử La Mã',
    });

    assert.ok(prompt.includes('từ CÂU 21'), 'Prompt should ask to continue from CÂU 21');
    assert.ok(prompt.includes('đến CÂU 43') || prompt.includes('đến CÂU 42') || prompt.includes('đến CÂU'), 'Prompt should specify target end beat');
    assert.ok(prompt.includes('=== END SCRIPT ==='), 'Prompt should demand closing marker');
  });

  await test('Continuation Triggering', 'Dual-track continuation: clicks continueButton when present (Track A)', async () => {
    const page = new MockPage();

    const continueBtn = new MockNode('button:has-text("Continue generating")', 'button');
    continueBtn.textContent = 'Continue generating';
    page.nodes.push(continueBtn);

    const assistantNode = new MockNode('div[data-message-author-role="assistant"]');
    assistantNode.attributes['data-message-author-role'] = 'assistant';
    assistantNode.textContent = 'CÂU 1: Đoạn đầu.';
    page.nodes.push(assistantNode);

    let continueClicked = false;
    continueBtn.clickListeners.push(async () => {
      continueClicked = true;
      // Button disappears and new content appears
      page.nodes = page.nodes.filter((n) => n !== continueBtn);
      assistantNode.textContent = 'CÂU 2: Đoạn kế tiếp hoàn tất.';
    });

    const collector = new ChatGptScriptCollector();
    // Use timeoutMs: 6000 so the default 3.3s stability window finishes comfortably
    const result = await collector.handleContinuationIfTruncated(page, 'CÂU 1: Đoạn đầu.', {
      kind: 'raw',
      timeoutMs: 6000,
      maxContinuationTurns: 2,
      onProgress: () => {},
    });

    assert.strictEqual(continueClicked, true, 'Track A continueButton click was not executed');
    assert.strictEqual(result.continuedTurns, 1);
  });

  // ----------------------------------------------------------------------------
  // SECTION 3: Extraction Logic: Markdown vs Clipboard Fallback Stress Tests
  // ----------------------------------------------------------------------------
  console.log('\n▶ [SECTION 3] EXTRACTION LOGIC: CLIPBOARD COPY VS MARKDOWN FALLBACK');

  await test('Extraction', 'Clipboard preference: reads from clipboard via copy button when available', async () => {
    const page = new MockPage();
    const assistantNode = new MockNode('div[data-message-author-role="assistant"]');
    assistantNode.attributes['data-message-author-role'] = 'assistant';
    assistantNode.textContent = 'DOM Text Fallback';

    const copyBtn = new MockNode('button[aria-label*="Copy"]', 'button');
    copyBtn.attributes['aria-label'] = 'Copy response';
    copyBtn.clickListeners.push(async () => {
      page.clipboardText = 'CÂU 1: Văn bản trích xuất trực tiếp từ clipboard thông qua nút Copy.';
    });
    assistantNode.children = [copyBtn]; // descendant mock

    page.nodes.push(assistantNode);
    page.clipboardText = '';

    const collector = new ChatGptScriptCollector();
    const text = await collector.extractLatestResponseText(page, { preferClipboard: true });

    assert.ok(text.includes('trích xuất trực tiếp từ clipboard'), `Expected clipboard content, got: ${text}`);
  });

  await test('Extraction', 'Fallback to DOM: falls back gracefully to div.markdown when clipboard read throws', async () => {
    const page = new MockPage();
    page.clipboardThrows = true;

    const assistantNode = new MockNode('div[data-message-author-role="assistant"]');
    assistantNode.attributes['data-message-author-role'] = 'assistant';

    const mdNode = new MockNode('div.markdown');
    mdNode.attributes['class'] = 'markdown prose';
    mdNode.textContent = 'CÂU 1: Nội dung từ div.markdown khi clipboard bị từ chối quyền truy cập.';
    assistantNode.children = [mdNode];

    page.nodes.push(assistantNode);

    const collector = new ChatGptScriptCollector();
    const text = await collector.extractLatestResponseText(page, { preferClipboard: true });

    assert.ok(text.includes('Nội dung từ div.markdown'), `Expected DOM fallback, got: ${text}`);
  });

  await test('Extraction', 'Boilerplate stripping: cleanly strips ChatGPT disclaimers and Show More artifacts', async () => {
    const page = new MockPage();
    const assistantNode = new MockNode('div[data-message-author-role="assistant"]');
    assistantNode.attributes['data-message-author-role'] = 'assistant';
    assistantNode.textContent =
      'ChatGPT đã nói:\n' +
      'CÂU 1: Lời thoại thực sự của video.\n' +
      '… Xem thêm\n' +
      'ChatGPT có thể mắc lỗi. Hãy kiểm tra các thông tin quan trọng.';

    page.nodes.push(assistantNode);

    const collector = new ChatGptScriptCollector();
    const text = await collector.extractLatestResponseText(page, { preferClipboard: false });

    assert.strictEqual(text, 'CÂU 1: Lời thoại thực sự của video.');
  });

  await test('Extraction', 'Echo guard in extraction: throws AssistantResponseEchoError if extracted text is prompt echo', async () => {
    const page = new MockPage();
    const assistantNode = new MockNode('div[data-message-author-role="assistant"]');
    assistantNode.attributes['data-message-author-role'] = 'assistant';
    assistantNode.textContent = 'PHẦN F — CÁCH TRẢ LỜI: Tuyệt đối không sửa đổi định dạng...';
    page.nodes.push(assistantNode);

    const collector = new ChatGptScriptCollector();
    let threw = false;
    try {
      await collector.extractLatestResponseText(page, { preferClipboard: false });
    } catch (err: any) {
      threw = true;
      assert.ok(err instanceof AssistantResponseEchoError, `Error should be AssistantResponseEchoError, got: ${err.name}`);
    }
    assert.strictEqual(threw, true, 'Extraction should reject prompt echo with AssistantResponseEchoError');
  });

  // ----------------------------------------------------------------------------
  // SECTION 4: Zero Prompt Capture & Echo Immunity Stress Tests
  // ----------------------------------------------------------------------------
  console.log('\n▶ [SECTION 4] ZERO PROMPT CAPTURE & ECHO IMMUNITY');

  await test('Echo Immunity', 'Detects all standard user prompt template instruction headers', () => {
    const echoSamples = [
      'PHẦN F — CÁCH TRẢ LỜI',
      'PHẦN B — VÙNG CẤM SỬA',
      'PHẦN A — BỐ CỤC BẮT BUỘC',
      'Bạn là chuyên gia viết PRODUCTION MASTER PROMPT',
      'Độ dài master prompt: 150–250 dòng',
      '1. SYSTEM ROLE — model đóng vai ai',
      '=== 1. ĐỊNH DANH DỰ ÁN & KÊNH ===',
      'Bạn là Giám đốc Sáng tạo & Biên kịch trưởng',
      'QUY ĐỊNH ĐỊNH DẠNG BẮT BUỘC:',
      'HOOK 3S BÚA BỔ MỞ ĐẦU:',
      'CHÚ Ý: Chỉ trả về các dòng bắt đầu bằng "CÂU X: ...", không thêm lời chào',
    ];

    for (const sample of echoSamples) {
      assert.strictEqual(isUserPromptEcho(sample), true, `Failed to flag user prompt echo: "${sample}"`);
    }
  });

  await test('Echo Immunity', 'Short continuation command prompts are flagged as user prompt echoes', () => {
    const continuationCommands = [
      'tiếp tục viết phần còn lại',
      'tiếp tục viết tiếp',
      'tiếp tục viết tiếp kịch bản.',
      'tiếp tục phần kịch bản còn lại',
      'tiếp tục',
      'continue',
      'continue writing',
      'continue generating',
      'please continue',
    ];

    for (const cmd of continuationCommands) {
      assert.strictEqual(isUserPromptEcho(cmd), true, `Failed to flag short continuation echo: "${cmd}"`);
    }
  });

  await test('Echo Immunity', 'Authentic assistant outputs are NEVER falsely classified as prompt echoes', () => {
    const validAssistantOutputs = [
      '=== BEGIN SCRIPT ===\nCÂU 1: Bí ẩn của đại dương xanh thẳm luôn thu hút con người.\nCÂU 2: Hôm nay chúng ta cùng khám phá.\n=== END SCRIPT ===',
      '{\n  "title": "Bí Ẩn Kim Tự Tháp",\n  "hook": "Ai đã xây dựng nó?",\n  "scenes": [\n    {"visual": "Cận cảnh kim tự tháp", "voiceover": "Một công trình kỳ vĩ"}\n  ]\n}',
      'CÂU 1: Đã bao giờ bạn tự hỏi vũ trụ bao la đến nhường nào?\nCÂU 2: Hãy cùng đếm các vì sao.',
      '1. SYSTEM ROLE\nBạn là chuyên gia về thiên văn học và vật lý lượng tử.\n2. INPUT\nChủ đề: Lỗ đen vũ trụ.',
    ];

    for (const out of validAssistantOutputs) {
      assert.strictEqual(isUserPromptEcho(out), false, `Falsely flagged valid output as echo: "${out.slice(0, 60)}..."`);
    }
  });

  // ----------------------------------------------------------------------------
  // SECTION 5: Multi-Turn Edge-Case & Stress Matrix
  // ----------------------------------------------------------------------------
  console.log('\n▶ [SECTION 5] MULTI-TURN EDGE-CASE & STRESS MATRIX');

  await test('Edge Matrix', 'Turn 1 ends with truncated CÂU N header only (e.g. "CÂU 25:"), Turn 2 provides full line', () => {
    const turn1 = 'CÂU 24: Kết thúc phân đoạn 24.\nCÂU 25:';
    const turn2 = 'CÂU 25: Toàn bộ nội dung của câu 25 được viết tiếp ở đây.\nCÂU 26: Nội dung câu 26.';
    const stitched = stitchScriptTurns([turn1, turn2]);

    assert.ok(stitched.includes('CÂU 25: Toàn bộ nội dung của câu 25 được viết tiếp ở đây.'));
    assert.strictEqual((stitched.match(/CÂU 25:/g) || []).length, 1);
    assert.ok(!stitched.includes('CÂU 25:\nCÂU 25:'));
  });

  await test('Edge Matrix', 'Continuation prompt echo: assistant echoes continuation prompt before writing script', () => {
    // If ChatGPT echoes: "tiếp tục viết phần còn lại từ CÂU 21 đến CÂU 35: \nCÂU 21: Đoạn 21."
    const turnWithEcho = 'tiếp tục viết phần còn lại từ CÂU 21 đến CÂU 35:\nCÂU 21: Đây là phân cảnh thứ hai mươi mốt.';
    const cleaned = stripContinuationFillerIntros(turnWithEcho);
    // Notice: does stripContinuationFillerIntros remove the echoed prompt command?
    // Let's check if the preamble is removed or if it leaks into the script
    const hasLeak = cleaned.includes('tiếp tục viết phần còn lại');
    if (hasLeak) {
      console.log('     [NOTE] Notice: stripContinuationFillerIntros leaves custom continuation prompts if not matching exact patterns.');
    }
  });

  // ----------------------------------------------------------------------------
  // SUMMARY REPORT
  // ----------------------------------------------------------------------------
  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log('  CHALLENGE TEST SUMMARY');
  console.log('════════════════════════════════════════════════════════════════════════════════');

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`Total Tests Run: ${total}`);
  console.log(`Passed:          ${passed} (${Math.round((passed / total) * 100)}%)`);
  console.log(`Failed:          ${failed}`);

  if (failed > 0) {
    console.log('\nFailed Tests:');
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - [${r.category}] ${r.name}`);
      console.log(`    Error: ${r.error}`);
      if (r.finding) console.log(`    Challenge Finding: ${r.finding}`);
    }
  }

  return { total, passed, failed, results };
}

runEmpiricalStressTests().catch(console.error);
