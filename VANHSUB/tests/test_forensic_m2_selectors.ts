/**
 * tests/test_forensic_m2_selectors.ts
 *
 * Independent Forensic Integrity Test Suite for Milestone 2:
 * Centralized ChatGPT Web Selector Registry (chatgptSelectors.config.ts).
 *
 * Authored by: m2_auditor_1 (Forensic Integrity Auditor)
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  CHATGPT_SELECTORS,
  resolveSelector,
  tryResolveSelector,
  SelectorNotFoundError,
  isUserPromptEcho,
  PROMPT_ECHO_MARKERS,
  dismissOverlays,
  isElementUserTurn,
  isElementAssistantTurn,
  extractCleanAssistantText,
} from '../main/ai-studio/chatgpt/chatgptSelectors.config';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runCheck(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res
        .then(() => {
          passedTests++;
          console.log(`  ✓ [PASS] ${name}`);
        })
        .catch((err) => {
          failedTests++;
          console.error(`  ✗ [FAIL] ${name}:`, err.message || err);
        });
    } else {
      passedTests++;
      console.log(`  ✓ [PASS] ${name}`);
    }
  } catch (err: any) {
    failedTests++;
    console.error(`  ✗ [FAIL] ${name}:`, err.message || err);
  }
}

async function runForensicAudit() {
  console.log('================================================================');
  console.log(' FORENSIC INTEGRITY AUDIT: chatgptSelectors.config.ts');
  console.log('================================================================\n');

  // 1. Static Source Code Analysis (Anti-hardcoding, anti-facade)
  console.log('--- Phase 1: Static Code Forensics (Anti-Cheat / Anti-Facade) ---');
  const fileContent = fs.readFileSync(
    path.join(__dirname, '../main/ai-studio/chatgpt/chatgptSelectors.config.ts'),
    'utf-8'
  );

  runCheck('No test-environment short circuits (e.g. isTest, mockMode bypass)', () => {
    assert(!fileContent.includes('isTest'), 'Must not contain isTest bypass');
    assert(!fileContent.includes('mockMode'), 'Must not contain mockMode bypass');
    assert(!fileContent.includes('process.env.NODE_ENV === \'test\''), 'Must not contain test-env bypass');
  });

  runCheck('No dummy facade returns (genuine locators and async checks only)', () => {
    assert(!fileContent.includes('return true; // dummy'), 'No dummy boolean returns');
    assert(!fileContent.includes('return [] as any; // fake'), 'No fake empty arrays');
    assert(fileContent.includes('new SelectorNotFoundError('), 'Must genuinely instantiate and throw SelectorNotFoundError');
  });

  // 2. Structure & Matrix Completeness
  console.log('\n--- Phase 2: Matrix Completeness & Typing Integrity ---');
  const requiredKeys = [
    'promptTextarea',
    'sendButton',
    'stopButton',
    'assistantTurn',
    'userTurn',
    'copyButton',
    'continueButton',
    'closeOverlayButton',
  ] as const;

  for (const k of requiredKeys) {
    runCheck(`SelectorGroup "${k}" structure verified`, () => {
      const grp = CHATGPT_SELECTORS[k];
      assert(grp, `Group ${k} must exist`);
      assert(typeof grp.primary === 'string' && grp.primary.length > 0, `${k}.primary must be string`);
      assert(Array.isArray(grp.fallbacks) && grp.fallbacks.length > 0, `${k}.fallbacks must be non-empty array`);
      assert(typeof grp.description === 'string' && grp.description.length > 0, `${k}.description must exist`);
    });
  }

  // 3. Behavioral Verification (Primary, Fallback, Error Handling)
  console.log('\n--- Phase 3: Dynamic Fallback Resolution & Logging Mechanics ---');

  await runCheck('Primary match resolves without warning log', async () => {
    const loggedWarns: string[] = [];
    const mockPage = {
      locator: (s: string) => ({
        count: async () => (s === CHATGPT_SELECTORS.promptTextarea.primary ? 1 : 0),
        first: () => ({ isVisible: async () => true }),
      }),
    };
    const res = await resolveSelector(
      mockPage,
      CHATGPT_SELECTORS.promptTextarea,
      'promptTextarea',
      { logger: { warn: (m: string) => loggedWarns.push(m) } }
    );
    assert.strictEqual(res.selector, CHATGPT_SELECTORS.promptTextarea.primary);
    assert.strictEqual(res.isFallback, false);
    assert.strictEqual(loggedWarns.length, 0, 'No warning should be emitted on primary match');
  });

  await runCheck('Fallback triggers structured Vietnamese warning log', async () => {
    const loggedWarns: string[] = [];
    const fbSelector = CHATGPT_SELECTORS.promptTextarea.fallbacks[0];
    const mockPage = {
      locator: (s: string) => ({
        count: async () => (s === fbSelector ? 1 : 0),
        first: () => ({ isVisible: async () => true }),
      }),
    };
    const res = await resolveSelector(
      mockPage,
      CHATGPT_SELECTORS.promptTextarea,
      'testPrompt',
      { logger: { warn: (m: string) => loggedWarns.push(m) } }
    );
    assert.strictEqual(res.selector, fbSelector);
    assert.strictEqual(res.isFallback, true);
    assert.strictEqual(loggedWarns.length, 1);
    assert(
      loggedWarns[0].includes('[ChatGPT Selector Fallback]'),
      'Must contain [ChatGPT Selector Fallback]'
    );
    assert(
      loggedWarns[0].includes(`Selector chính "${CHATGPT_SELECTORS.promptTextarea.primary}" không tìm thấy cho [testPrompt]`),
      'Must contain primary selector and contextName'
    );
    assert(
      loggedWarns[0].includes(`Đã kích hoạt selector dự phòng "${fbSelector}"`),
      'Must contain fallback selector'
    );
    assert(
      loggedWarns[0].includes('Hãy kiểm tra và cập nhật chatgptSelectors.config.ts nếu giao diện web đã thay đổi.'),
      'Must contain update advice'
    );
  });

  await runCheck('Hidden primary (count=1, isVisible=false) skips to visible fallback', async () => {
    const loggedWarns: string[] = [];
    const fb = CHATGPT_SELECTORS.sendButton.fallbacks[0];
    const mockPage = {
      locator: (s: string) => ({
        count: async () => 1,
        first: () => ({
          isVisible: async () => s === fb, // primary is not visible, fb is visible
        }),
      }),
    };
    const res = await resolveSelector(
      mockPage,
      CHATGPT_SELECTORS.sendButton,
      'sendButton',
      { logger: { warn: (m: string) => loggedWarns.push(m) } }
    );
    assert.strictEqual(res.selector, fb);
    assert.strictEqual(res.isFallback, true);
  });

  await runCheck('All candidates failing throws SelectorNotFoundError with rich diagnostics', async () => {
    const mockPage = {
      url: () => 'https://chatgpt.com/c/test-session-id',
      locator: () => ({ count: async () => 0, first: () => ({ isVisible: async () => false }) }),
    };
    let error: any = null;
    try {
      await resolveSelector(mockPage, CHATGPT_SELECTORS.stopButton, 'stopCtx');
    } catch (e) {
      error = e;
    }
    assert(error instanceof SelectorNotFoundError, 'Must throw SelectorNotFoundError');
    assert.strictEqual(error.contextName, 'stopCtx');
    assert.strictEqual(error.pageUrl, 'https://chatgpt.com/c/test-session-id');
    assert(error.candidateDiagnostics.length > 0, 'Must record candidate diagnostics');
  });

  await runCheck('tryResolveSelector returns null on failure without throwing', async () => {
    const mockPage = {
      url: () => 'https://chatgpt.com',
      locator: () => ({ count: async () => 0, first: () => ({ isVisible: async () => false }) }),
    };
    const res = await tryResolveSelector(mockPage, CHATGPT_SELECTORS.continueButton, 'continueCtx');
    assert.strictEqual(res, null);
  });

  await runCheck('dismissOverlays safely clicks overlay close button', async () => {
    let clicked = false;
    const mockPage = {
      locator: (s: string) => ({
        count: async () => (s === CHATGPT_SELECTORS.closeOverlayButton.primary ? 1 : 0),
        first: () => ({
          isVisible: async () => true,
          click: async () => { clicked = true; },
        }),
      }),
    };
    const dismissed = await dismissOverlays(mockPage);
    assert.strictEqual(dismissed, 1);
    assert.strictEqual(clicked, true);
  });

  // 4. Semantic Echo Discrimination Forensics
  console.log('\n--- Phase 4: Zero User Prompt Capture Guard Forensics ---');

  runCheck('PROMPT_ECHO_MARKERS contains >= 42 technical prompt markers', () => {
    assert(PROMPT_ECHO_MARKERS.length >= 42, `Marker count ${PROMPT_ECHO_MARKERS.length} must be >= 42`);
  });

  runCheck('isUserPromptEcho detects all catalog markers', () => {
    for (const marker of PROMPT_ECHO_MARKERS) {
      assert.strictEqual(
        isUserPromptEcho(`Instruction snippet:\n${marker}\nPlease adhere strictly.`),
        true,
        `Failed to detect marker: "${marker}"`
      );
    }
  });

  runCheck('isUserPromptEcho detects short continuation prompt variations', () => {
    const echoes = [
      'tiếp tục viết phần còn lại',
      'tiếp tục viết tiếp',
      'tiếp tục viết tiếp kịch bản',
      'tiếp tục phần kịch bản còn lại',
      'Tiếp tục viết phần còn lại',
      '   TIẾP TỤC VIẾT TIẾP   ',
    ];
    for (const e of echoes) {
      assert.strictEqual(isUserPromptEcho(e), true, `Failed to detect continuation echo: "${e}"`);
    }
  });

  runCheck('isUserPromptEcho detects Web UI truncation artifacts', () => {
    assert.strictEqual(isUserPromptEcho('Phần đầu prompt… Xem thêm'), true);
    assert.strictEqual(isUserPromptEcho('Nội dung yêu cầu\nXem thêm\nChatGPT đang phản hồi'), true);
  });

  runCheck('isUserPromptEcho strictly allows genuine Assistant deliverables', () => {
    const genuineCases = [
      'CÂU 1: Bí mật về loài cá voi xanh lớn nhất hành tinh!\nCÂU 2: Trái tim của chúng nặng bằng cả một chiếc ô tô.',
      '=== BEGIN SCRIPT ===\nCÂU 1: Chào mừng các bạn đến với kênh Vanhsub.\n=== END SCRIPT ===',
      '{\n  "topic": "Vũ trụ bao la",\n  "outline": ["Khởi đầu", "Các thiên hà", "Lỗ đen vũ trụ"]\n}',
      '1. SYSTEM ROLE\nBạn là biên kịch chuyên nghiệp phụ trách kênh Vanhsub.',
      'Dưới đây là kịch bản hoàn chỉnh cho tập 5 của series Khám Phá Thế Giới.',
    ];
    for (const g of genuineCases) {
      assert.strictEqual(isUserPromptEcho(g), false, `Falsely flagged genuine assistant text: "${g.slice(0, 40)}..."`);
    }
  });

  // 5. DOM Turn Segregation Forensics
  console.log('\n--- Phase 5: DOM Turn Segregation & Sanitization Forensics ---');

  await runCheck('isElementUserTurn and isElementAssistantTurn accurately segregate turns', async () => {
    const mockUserLocator = {
      getAttribute: async (attr: string) => (attr === 'data-message-author-role' ? 'user' : null),
      locator: () => ({ count: async () => 0 }),
    };
    const mockAssistantLocator = {
      getAttribute: async (attr: string) => (attr === 'data-message-author-role' ? 'assistant' : null),
      locator: () => ({ count: async () => 0 }),
    };

    assert.strictEqual(await isElementUserTurn(mockUserLocator), true);
    assert.strictEqual(await isElementAssistantTurn(mockUserLocator), false);

    assert.strictEqual(await isElementUserTurn(mockAssistantLocator), false);
    assert.strictEqual(await isElementAssistantTurn(mockAssistantLocator), true);
  });

  await runCheck('extractCleanAssistantText strips ChatGPT UI boilerplate and checks echo', async () => {
    const mockTurn = {
      locator: (s: string) => ({
        count: async () => (s.includes('markdown') ? 1 : 0),
        first: () => ({
          innerText: async () =>
            'ChatGPT đã nói:\nCÂU 1: Đây là câu trả lời của AI\n\nChatGPT có thể mắc lỗi. Hãy kiểm tra thông tin quan trọng.',
        }),
      }),
    };
    const mockPage = {
      locator: (s: string) => ({
        count: async () => (s === CHATGPT_SELECTORS.assistantTurn.primary ? 1 : 0),
        nth: () => mockTurn,
        first: () => mockTurn,
      }),
    };

    const extracted = await extractCleanAssistantText(mockPage);
    assert.strictEqual(extracted.text, 'CÂU 1: Đây là câu trả lời của AI');
    assert.strictEqual(extracted.isEcho, false);
    assert.strictEqual(extracted.hasContent, true);
  });

  console.log('\n================================================================');
  console.log(` AUDIT SUMMARY: Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runForensicAudit().catch((err) => {
  console.error('FATAL AUDIT FAILURE:', err);
  process.exit(1);
});
