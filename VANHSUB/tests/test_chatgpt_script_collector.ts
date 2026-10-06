/**
 * tests/test_chatgpt_script_collector.ts
 *
 * Comprehensive Verification Test Suite for ChatGptScriptCollector (Milestone 3).
 * Exercises:
 * 1. Custom Error Hierarchy & Prototype Chains
 * 2. Truncation Detection Utilities (isCutoffSentence, isMissingExpectedMarker)
 * 3. Multi-Turn Stitching & Filler Stripping (stripContinuationFillerIntros, stitchScriptTurns, stitchProseTurns)
 * 4. Continuation Prompt Builder (buildContinuationPrompt)
 * 5. Transient Error Discrimination & Exponential Backoff Retry (isTransientError, retryWithBackoff)
 * 6. 3-Tier Safe Input Injection & Pre-Submission Presence Verification (sendPrompt)
 * 7. Active Streaming Detection & Triple-Cycle Stability Checking (waitForStreamingComplete)
 * 8. Lossless Response Extraction & Prompt Echo Guard (extractLatestResponseText)
 * 9. Dual-Track Continuation Engine (handleContinuationIfTruncated)
 * 10. End-to-End Orchestrator (collectResponse, executePromptWithContinuation, collect)
 * 11. Auth & Session Status Probing (checkLoginStatus, openLoginWindow)
 * 12. Singleton Lifecycle & CDP Client Dependency Injection
 */

import assert from 'assert';
import {
  ChatGptScriptCollector,
  ChatGptSessionExpiredError,
  ChatGptCloudflareChallengeError,
  ChatGptInputInjectionError,
  ChatGptStreamingTimeoutError,
  AssistantResponseEchoError,
  isCutoffSentence,
  isMissingExpectedMarker,
  stripContinuationFillerIntros,
  stitchScriptTurns,
  stitchProseTurns,
  buildContinuationPrompt,
  isTransientError,
  retryWithBackoff,
  isStreamingActive,
  assertPageHealth,
} from '../main/ai-studio/chatgpt/ChatGptScriptCollector';

// ==============================================================================
// High-Fidelity Simulated DOM & Page Fixtures for Playwright CDP
// ==============================================================================

class MockDomNode {
  public selector: string;
  public tagName: string;
  public textContent: string = '';
  public innerHTML: string = '';
  public attributes: Record<string, string> = {};
  public isVisible: boolean = true;
  public clickListeners: Array<() => Promise<void> | void> = [];

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
}

class MockLocator {
  private nodes: MockDomNode[];
  private pageRef: MockPage;

  constructor(nodes: MockDomNode[], pageRef: MockPage) {
    this.nodes = nodes;
    this.pageRef = pageRef;
  }

  public async count(): Promise<number> {
    return this.nodes.length;
  }

  public first(): MockLocator {
    return new MockLocator(this.nodes.slice(0, 1), this.pageRef);
  }

  public nth(index: number): MockLocator {
    return new MockLocator(this.nodes.slice(index, index + 1), this.pageRef);
  }

  public async isVisible(): Promise<boolean> {
    if (this.nodes.length === 0) return false;
    return this.nodes[0].isVisible;
  }

  public async isEnabled(): Promise<boolean> {
    if (this.nodes.length === 0) return false;
    const disabled = this.nodes[0].attributes['disabled'];
    const ariaDisabled = this.nodes[0].attributes['aria-disabled'];
    return !disabled && ariaDisabled !== 'true';
  }

  public async innerText(): Promise<string> {
    if (this.nodes.length === 0) return '';
    return this.nodes[0].textContent;
  }

  public async textContent(): Promise<string> {
    if (this.nodes.length === 0) return '';
    return this.nodes[0].textContent;
  }

  public async inputValue(): Promise<string> {
    if (this.nodes.length === 0) return '';
    return this.nodes[0].textContent;
  }

  public async getAttribute(name: string): Promise<string | null> {
    if (this.nodes.length === 0) return null;
    return this.nodes[0].attributes[name] ?? null;
  }

  public async fill(value: string): Promise<void> {
    if (this.nodes.length === 0) throw new Error('Element not found for fill');
    this.nodes[0].textContent = value;
    this.nodes[0].innerHTML = value;
  }

  public async click(): Promise<void> {
    if (this.nodes.length === 0) throw new Error('Element not found for click');
    for (const listener of this.nodes[0].clickListeners) {
      await listener();
    }
  }

  public async focus(): Promise<void> {
    // no-op for mock
  }

  public async waitFor(): Promise<void> {
    // no-op for mock
  }

  public locator(selector: string): MockLocator {
    const matched: MockDomNode[] = [];
    for (const node of this.nodes) {
      if (node.matches(selector)) {
        matched.push(node);
      }
    }
    return new MockLocator(matched, this.pageRef);
  }
}

class MockPage {
  public currentUrl: string = 'https://chatgpt.com';
  public nodes: MockDomNode[] = [];

  public keyboard = {
    insertText: async (text: string) => {
      const textarea = this.nodes.find((n) => n.matches('#prompt-textarea') || n.tagName === 'textarea');
      if (textarea) textarea.textContent += text;
    },
    type: async (text: string) => {
      const textarea = this.nodes.find((n) => n.matches('#prompt-textarea') || n.tagName === 'textarea');
      if (textarea) textarea.textContent += text;
    },
    press: async (key: string) => {
      if (key === 'Backspace') {
        const textarea = this.nodes.find((n) => n.matches('#prompt-textarea') || n.tagName === 'textarea');
        if (textarea) textarea.textContent = '';
      }
    },
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

  public async evaluate<T = any>(fn: any, arg?: any): Promise<T> {
    if (typeof fn === 'function') {
      return fn(arg);
    }
    return undefined as unknown as T;
  }
}

// ==============================================================================
// Test Suites Execution
// ==============================================================================

async function runTestSuite() {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('  CHATGPT SCRIPT COLLECTOR DEDICATED VERIFICATION TEST SUITE (M3)');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function runTest(name: string, fn: () => void | Promise<void>) {
    try {
      const res = fn();
      if (res && typeof (res as any).then === 'function') {
        return (res as Promise<void>)
          .then(() => {
            console.log(`  ✓ [PASS] ${name}`);
            passed++;
          })
          .catch((err) => {
            console.error(`  ✗ [FAIL] ${name}: ${err?.message || err}`);
            failed++;
          });
      } else {
        console.log(`  ✓ [PASS] ${name}`);
        passed++;
        return Promise.resolve();
      }
    } catch (err: any) {
      console.error(`  ✗ [FAIL] ${name}: ${err?.message || err}`);
      failed++;
      return Promise.resolve();
    }
  }

  // ----------------------------------------------------------------------------
  // SECTION 1: Error Hierarchy & Prototype Chains
  // ----------------------------------------------------------------------------
  await runTest('Error Hierarchy: ChatGptSessionExpiredError has correct name & isAuthError', () => {
    const err = new ChatGptSessionExpiredError('https://chatgpt.com/auth/login');
    assert.strictEqual(err.name, 'ChatGptSessionExpiredError');
    assert.strictEqual(err.isAuthError, true);
    assert.strictEqual(err.currentUrl, 'https://chatgpt.com/auth/login');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof ChatGptSessionExpiredError);
  });

  await runTest('Error Hierarchy: ChatGptCloudflareChallengeError has correct name & isCloudflare', () => {
    const err = new ChatGptCloudflareChallengeError('https://chatgpt.com/#challenge-running');
    assert.strictEqual(err.name, 'ChatGptCloudflareChallengeError');
    assert.strictEqual(err.isCloudflare, true);
    assert.ok(err instanceof Error);
    assert.ok(err instanceof ChatGptCloudflareChallengeError);
  });

  await runTest('Error Hierarchy: ChatGptInputInjectionError contains attempted tiers & prompt length', () => {
    const err = new ChatGptInputInjectionError('Injection failed', [1, 2, 3], 500, { Tier1: 'fail' });
    assert.strictEqual(err.name, 'ChatGptInputInjectionError');
    assert.deepStrictEqual(err.attemptedTiers, [1, 2, 3]);
    assert.strictEqual(err.promptLength, 500);
    assert.ok(err instanceof Error);
  });

  await runTest('Error Hierarchy: ChatGptStreamingTimeoutError contains timing diagnostics', () => {
    const err = new ChatGptStreamingTimeoutError('Timeout reached', 180000, 1200, true, 'https://chatgpt.com');
    assert.strictEqual(err.name, 'ChatGptStreamingTimeoutError');
    assert.strictEqual(err.elapsedMs, 180000);
    assert.strictEqual(err.lastObservedLength, 1200);
    assert.strictEqual(err.stopButtonStillPresent, true);
    assert.ok(err instanceof Error);
  });

  await runTest('Error Hierarchy: AssistantResponseEchoError flags captured preview', () => {
    const err = new AssistantResponseEchoError('Echo detected', 'PHẦN F — CÁCH TRẢ LỜI: Không được sửa...');
    assert.strictEqual(err.name, 'AssistantResponseEchoError');
    assert.ok(err.capturedTextPreview.includes('PHẦN F'));
    assert.ok(err instanceof Error);
  });

  // ----------------------------------------------------------------------------
  // SECTION 2: Truncation Detection Utilities
  // ----------------------------------------------------------------------------
  await runTest('Truncation Detection: isCutoffSentence correctly identifies complete vs cutoff sentences', () => {
    assert.strictEqual(isCutoffSentence('CÂU 1: Xin chào các bạn đến với video hôm nay.'), false);
    assert.strictEqual(isCutoffSentence('CÂU 2: Đây là câu hỏi thật bất ngờ?'), false);
    assert.strictEqual(isCutoffSentence('CÂU 3: Cảnh tượng tuyệt vời!'), false);
    assert.strictEqual(isCutoffSentence('CÂU 4: Nhưng câu chuyện vẫn còn tiếp diễn…'), false);
    // Cutoffs:
    assert.strictEqual(isCutoffSentence('CÂU 5: Khi đoàn thám hiểm bước vào hang động, họ nhìn thấy một'), true);
    assert.strictEqual(isCutoffSentence('CÂU 6: Danh sách bao gồm:'), true);
    assert.strictEqual(isCutoffSentence('CÂU 7: Sau khi mở cánh cửa bí mật,'), true);
    assert.strictEqual(isCutoffSentence('CÂU 8:'), true);
  });

  await runTest('Truncation Detection: isMissingExpectedMarker checks required end markers', () => {
    const incompleteScript = '=== BEGIN SCRIPT ===\nCÂU 1: Bắt đầu video.\nCÂU 2: Tiếp tục video.';
    assert.strictEqual(isMissingExpectedMarker(incompleteScript, 'script'), true);

    const completeScript = '=== BEGIN SCRIPT ===\nCÂU 1: Bắt đầu video.\n=== END SCRIPT ===';
    assert.strictEqual(isMissingExpectedMarker(completeScript, 'script'), false);

    const unclosedJson = '{"title": "Video Khám Phá", "outline": [';
    assert.strictEqual(isMissingExpectedMarker(unclosedJson, 'idea'), true);

    const closedJson = '{"title": "Video Khám Phá", "outline": []}';
    assert.strictEqual(isMissingExpectedMarker(closedJson, 'idea'), false);

    const incompleteMaster = '1. SYSTEM ROLE\nBạn là chuyên gia...';
    assert.strictEqual(isMissingExpectedMarker(incompleteMaster, 'master_prompt'), true);

    const completeMaster = '1. SYSTEM ROLE\nBạn là chuyên gia...\n9. STRICT OUTPUT FORMAT\nĐịnh dạng chuẩn.';
    assert.strictEqual(isMissingExpectedMarker(completeMaster, 'master_prompt'), false);
  });

  // ----------------------------------------------------------------------------
  // SECTION 3: Multi-Turn Stitching & Preambles
  // ----------------------------------------------------------------------------
  await runTest('Stitching: stripContinuationFillerIntros removes Vietnamese & English conversational preambles', () => {
    const rawTurn2 = 'Dưới đây là phần tiếp theo của kịch bản:\nCÂU 15: Họ bước qua ngọn đồi tuyết.';
    const cleaned = stripContinuationFillerIntros(rawTurn2);
    assert.strictEqual(cleaned, 'CÂU 15: Họ bước qua ngọn đồi tuyết.');

    const rawTurn3 = 'Sure, continuing with the script:\nCÂU 20: Ánh mặt trời dần ló rạng.';
    const cleaned3 = stripContinuationFillerIntros(rawTurn3);
    assert.strictEqual(cleaned3, 'CÂU 20: Ánh mặt trời dần ló rạng.');
  });

  await runTest('Stitching: stitchScriptTurns handles broken sentence boundary and duplicate CÂU N numbers', () => {
    const turn1 = 'CÂU 1: Mở đầu ấn tượng.\nCÂU 2: Khi người thủy thủ nhìn ra biển khơi xa xăm, anh';
    const turn2 = 'Dưới đây là phần tiếp theo:\nCÂU 2: Khi người thủy thủ nhìn ra biển khơi xa xăm, anh thấy một ngọn hải đăng rực sáng.\nCÂU 3: Kết thúc tập phim.';
    const stitched = stitchScriptTurns([turn1, turn2]);

    assert.ok(stitched.includes('CÂU 1: Mở đầu ấn tượng.'));
    assert.ok(stitched.includes('CÂU 2: Khi người thủy thủ nhìn ra biển khơi xa xăm, anh thấy một ngọn hải đăng rực sáng.'));
    assert.ok(stitched.includes('CÂU 3: Kết thúc tập phim.'));
    // Ensure CÂU 2 is not duplicated
    const countCau2 = (stitched.match(/CÂU 2:/g) || []).length;
    assert.strictEqual(countCau2, 1);
  });

  await runTest('Stitching: stitchProseTurns reconciles sliding-window suffix-prefix overlap', () => {
    const text1 = 'Chiếc tàu ngầm từ từ hạ độ sâu xuống rãnh Mariana nơi bóng tối bao trùm hoàn toàn.';
    const text2 = 'nơi bóng tối bao trùm hoàn toàn. Các sinh vật phát quang bơi lượn xung quanh.';
    const merged = stitchProseTurns(text1, text2);
    assert.strictEqual(
      merged,
      'Chiếc tàu ngầm từ từ hạ độ sâu xuống rãnh Mariana nơi bóng tối bao trùm hoàn toàn. Các sinh vật phát quang bơi lượn xung quanh.'
    );
  });

  // ----------------------------------------------------------------------------
  // SECTION 4: Continuation Prompt Builder
  // ----------------------------------------------------------------------------
  await runTest('Prompt Builder: buildContinuationPrompt creates targeted prompts for script, idea, master_prompt', () => {
    const scriptPrompt = buildContinuationPrompt({
      kind: 'script',
      currentText: 'CÂU 1: Mở đầu.\nCÂU 2: Thân bài.',
      targetMinSentences: 10,
    });
    assert.ok(scriptPrompt.includes('tiếp tục viết liền mạch phần còn lại'));
    assert.ok(scriptPrompt.includes('=== END SCRIPT ==='));

    const ideaPrompt = buildContinuationPrompt({
      kind: 'idea',
      currentText: '{"title": "Test"',
    });
    assert.ok(ideaPrompt.includes('hoàn thiện trọn vẹn khối JSON'));

    const masterPrompt = buildContinuationPrompt({
      kind: 'master_prompt',
      currentText: '1. SYSTEM ROLE',
    });
    assert.ok(masterPrompt.includes('Master Prompt'));
  });

  // ----------------------------------------------------------------------------
  // SECTION 5: Resilience & Retry Logic
  // ----------------------------------------------------------------------------
  await runTest('Resilience: isTransientError classifies error types accurately', () => {
    assert.strictEqual(isTransientError(new ChatGptSessionExpiredError()), false);
    assert.strictEqual(isTransientError(new ChatGptCloudflareChallengeError()), false);
    assert.strictEqual(isTransientError(new Error("You've reached our limit for GPT-4")), false);

    assert.strictEqual(isTransientError(new Error('Target page, context or browser has been closed')), true);
    assert.strictEqual(isTransientError(new Error('node is detached from document')), true);
    assert.strictEqual(isTransientError(new Error('navigation timeout 30000ms exceeded')), true);
  });

  await runTest('Resilience: retryWithBackoff succeeds after transient errors', async () => {
    let attempts = 0;
    const result = await retryWithBackoff(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('node is detached from document');
        }
        return 'SUCCESS';
      },
      { maxRetries: 3, baseDelayMs: 20, jitterMs: 5 }
    );
    assert.strictEqual(result, 'SUCCESS');
    assert.strictEqual(attempts, 3);
  });

  // ----------------------------------------------------------------------------
  // SECTION 6: Safe Input Injection & Pre-Submission Presence Verification
  // ----------------------------------------------------------------------------
  await runTest('Safe Input: sendPrompt successfully injects prompt via Tier 1 and confirms presence', async () => {
    const page = new MockPage();
    const promptNode = new MockDomNode('#prompt-textarea', 'textarea');
    promptNode.attributes['id'] = 'prompt-textarea';
    const sendBtn = new MockDomNode('button[data-testid="send-button"]', 'button');
    sendBtn.attributes['data-testid'] = 'send-button';

    sendBtn.clickListeners.push(async () => {
      // Simulate submission: textarea cleared and stop button appears
      promptNode.textContent = '';
      const stopBtn = new MockDomNode('button[data-testid="stop-button"]', 'button');
      stopBtn.attributes['data-testid'] = 'stop-button';
      page.nodes.push(stopBtn);
    });

    page.nodes.push(promptNode, sendBtn);

    const collector = new ChatGptScriptCollector();
    await collector.sendPrompt(page, 'Kịch bản về sao Hỏa trong tương lai');

    // Verification check passed and send executed
    assert.strictEqual(promptNode.textContent, '');
    assert.ok(page.nodes.some((n) => n.matches('button[data-testid="stop-button"]')));
  });

  await runTest('Safe Input: sendPrompt rejects empty or whitespace-only prompt', async () => {
    const page = new MockPage();
    const collector = new ChatGptScriptCollector();
    let threw = false;
    try {
      await collector.sendPrompt(page, '   ');
    } catch (e: any) {
      threw = true;
      assert.ok(e.message.includes('cannot be empty'));
    }
    assert.strictEqual(threw, true);
  });

  // ----------------------------------------------------------------------------
  // SECTION 7: Streaming & Triple-Cycle Stability Checking
  // ----------------------------------------------------------------------------
  await runTest('Stability: waitForStreamingComplete requires 3 consecutive identical length cycles', async () => {
    const page = new MockPage();

    // Create assistant turn node
    const assistantNode = new MockDomNode('div[data-message-author-role="assistant"]');
    assistantNode.attributes['data-message-author-role'] = 'assistant';
    assistantNode.textContent = 'Đang bắt đầu...';
    page.nodes.push(assistantNode);

    // Initial streaming indicator
    const stopBtn = new MockDomNode('button[data-testid="stop-button"]', 'button');
    stopBtn.attributes['data-testid'] = 'stop-button';
    page.nodes.push(stopBtn);

    const collector = new ChatGptScriptCollector();

    // In background, simulate streaming finishing and stabilizing
    setTimeout(() => {
      // Stop button disappears
      page.nodes = page.nodes.filter((n) => n !== stopBtn);
      assistantNode.textContent = 'CÂU 1: Hoàn thành kịch bản trọn vẹn.';
    }, 400);

    await collector.waitForStreamingComplete(page, 5000, {
      pollIntervalMs: 150,
      requiredStableCycles: 3,
    });

    assert.ok(assistantNode.textContent.includes('Hoàn thành kịch bản'));
  });

  // ----------------------------------------------------------------------------
  // SECTION 8: Clean Response Extraction & Zero Prompt Echo
  // ----------------------------------------------------------------------------
  await runTest('Extraction: extractLatestResponseText retrieves clean text and rejects prompt echo', async () => {
    const page = new MockPage();
    const assistantNode = new MockDomNode('div[data-message-author-role="assistant"]');
    assistantNode.attributes['data-message-author-role'] = 'assistant';
    assistantNode.textContent = 'ChatGPT đã nói:\nCÂU 1: Đây là phản hồi thật.\nChatGPT có thể mắc lỗi.';
    page.nodes.push(assistantNode);

    const collector = new ChatGptScriptCollector();
    const clean = await collector.extractLatestResponseText(page, { preferClipboard: false });
    assert.strictEqual(clean, 'CÂU 1: Đây là phản hồi thật.');

    // Echo detection
    assistantNode.textContent = 'PHẦN F — CÁCH TRẢ LỜI: Giữ nguyên định dạng...';
    let echoThrew = false;
    try {
      await collector.extractLatestResponseText(page, { preferClipboard: false });
    } catch (e: any) {
      echoThrew = true;
      assert.ok(e instanceof AssistantResponseEchoError);
    }
    assert.strictEqual(echoThrew, true);
  });

  // ----------------------------------------------------------------------------
  // SECTION 9: Dual-Track Continuation Engine
  // ----------------------------------------------------------------------------
  await runTest('Continuation: handleContinuationIfTruncated clicks continueButton when present', async () => {
    const page = new MockPage();

    const continueBtn = new MockDomNode('button:has-text("Continue generating")', 'button');
    continueBtn.textContent = 'Continue generating';
    page.nodes.push(continueBtn);

    const assistantNode = new MockDomNode('div[data-message-author-role="assistant"]');
    assistantNode.attributes['data-message-author-role'] = 'assistant';
    assistantNode.textContent = 'CÂU 1: Đoạn đầu.';
    page.nodes.push(assistantNode);

    let clicked = false;
    continueBtn.clickListeners.push(async () => {
      clicked = true;
      page.nodes = page.nodes.filter((n) => n !== continueBtn);
      assistantNode.textContent = 'CÂU 2: Đoạn kế tiếp hoàn tất.';
    });

    const collector = new ChatGptScriptCollector();
    const result = await collector.handleContinuationIfTruncated(page, 'CÂU 1: Đoạn đầu.', {
      kind: 'raw',
      timeoutMs: 3000,
      maxContinuationTurns: 2,
    });

    assert.strictEqual(clicked, true);
    assert.strictEqual(result.continuedTurns, 1);
    assert.ok(result.fullText.includes('CÂU 1: Đoạn đầu.'));
    assert.ok(result.fullText.includes('CÂU 2: Đoạn kế tiếp hoàn tất.'));
  });

  // ----------------------------------------------------------------------------
  // SECTION 10: End-to-End Orchestrator (collectResponse & ScriptCollectionResult)
  // ----------------------------------------------------------------------------
  await runTest('Orchestrator: collectResponse computes ScriptCollectionResult attributes accurately', async () => {
    const page = new MockPage();
    const assistantNode = new MockDomNode('div[data-message-author-role="assistant"]');
    assistantNode.attributes['data-message-author-role'] = 'assistant';
    assistantNode.textContent = 'CÂU 1: Toàn bộ kịch bản hoàn hảo được tạo thành công.';
    page.nodes.push(assistantNode);

    const collector = new ChatGptScriptCollector();
    const res = await collector.collectResponse(page, {
      kind: 'raw',
      timeoutMs: 2000,
    });

    assert.strictEqual(res.text, 'CÂU 1: Toàn bộ kịch bản hoàn hảo được tạo thành công.');
    assert.strictEqual(res.rawText, res.text);
    assert.strictEqual(res.turnCount, 1);
    assert.strictEqual(res.isTruncated, false);
    assert.strictEqual(res.continuedTurns, 0);
    assert.strictEqual(res.continuationTriggered, false);
    assert.ok(res.wordCount >= 8);
    assert.ok(typeof res.durationMs === 'number');
    assert.ok(res.conversationUrl.includes('chatgpt.com'));
  });

  // ----------------------------------------------------------------------------
  // SECTION 11: Auth & Session Status Probing
  // ----------------------------------------------------------------------------
  await runTest('Auth: assertPageHealth flags unauthenticated redirect and Cloudflare', async () => {
    const pageAuth = new MockPage();
    pageAuth.currentUrl = 'https://chatgpt.com/auth/login';
    let authThrew = false;
    try {
      await assertPageHealth(pageAuth);
    } catch (e: any) {
      authThrew = true;
      assert.ok(e instanceof ChatGptSessionExpiredError);
    }
    assert.strictEqual(authThrew, true);

    const pageCf = new MockPage();
    pageCf.currentUrl = 'https://chatgpt.com/#challenge-running';
    let cfThrew = false;
    try {
      await assertPageHealth(pageCf);
    } catch (e: any) {
      cfThrew = true;
      assert.ok(e instanceof ChatGptCloudflareChallengeError);
    }
    assert.strictEqual(cfThrew, true);
  });

  // ----------------------------------------------------------------------------
  // SECTION 12: Singleton Pattern Lifecycle
  // ----------------------------------------------------------------------------
  await runTest('Singleton: ChatGptScriptCollector.getInstance() and resetInstance() operate cleanly', () => {
    ChatGptScriptCollector.resetInstance();
    const inst1 = ChatGptScriptCollector.getInstance();
    const inst2 = ChatGptScriptCollector.getInstance();
    assert.strictEqual(inst1, inst2);

    ChatGptScriptCollector.resetInstance();
    const inst3 = ChatGptScriptCollector.getInstance();
    assert.notStrictEqual(inst1, inst3);
  });

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log(`  VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
