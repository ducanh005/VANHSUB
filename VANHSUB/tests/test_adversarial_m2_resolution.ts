/**
 * tests/test_adversarial_m2_resolution.ts
 *
 * Empirical Adversarial Test Harness for Dynamic Selector Resolution (Milestone 2).
 * Target: main/ai-studio/chatgpt/chatgptSelectors.config.ts
 *
 * Authoritative Requirements:
 * - ORIGINAL_REQUEST.md (§ 2026-10-05T11:03:12Z, Requirement R2)
 * - PROJECT.md (§ Interface Contracts, F8, F9, F10)
 * - Dispatch Instructions:
 *   1. Primary selector match: resolves without fallback warning and returns isFallback: false.
 *   2. Fallback selector match: primary missing/hidden, verifies fallback is chosen, isFallback: true,
 *      and warning log message is emitted with the exact required Vietnamese warning text.
 *   3. Multiple fallbacks: verifies that the first available fallback in order is selected.
 *   4. Total failure: verifies that resolveSelector throws SelectorNotFoundError with detailed diagnostic data,
 *      while tryResolveSelector returns null without throwing.
 *   5. dismissOverlays: verifies that overlay dismiss button is found and clicked.
 *
 * Execution:
 *   npx tsx tests/test_adversarial_m2_resolution.ts
 */

import assert from 'assert';
import {
  CHATGPT_SELECTORS,
  CANONICAL_SELECTORS_CONFIG,
  ALIASES,
  resolveSelector,
  tryResolveSelector,
  SelectorNotFoundError,
  dismissOverlays,
  isUserPromptEcho,
  PROMPT_ECHO_MARKERS,
  isElementUserTurn,
  isElementAssistantTurn,
  getAssistantTurns,
  getLastAssistantTurn,
  extractCleanAssistantText,
  SelectorGroup,
  CandidateDiagnostic,
} from '../main/ai-studio/chatgpt/chatgptSelectors.config';

// ------------------------------------------------------------------------------
// Test Harness Utilities & Mock DOM Engine
// ------------------------------------------------------------------------------

interface MockLocatorConfig {
  count?: number;
  isVisible?: boolean | (() => Promise<boolean>);
  click?: (options?: any) => Promise<void>;
  waitFor?: (options?: any) => Promise<void>;
  getAttribute?: (attr: string) => Promise<string | null>;
  innerText?: () => Promise<string>;
  textContent?: () => Promise<string>;
  children?: Record<string, MockLocatorConfig>;
  throwOnLocate?: boolean;
  throwOnClick?: boolean;
}

class MockPlaywrightPage {
  public urlValue: string;
  public selectorConfigs: Map<string, MockLocatorConfig> = new Map();
  public urlThrows: boolean = false;
  public clickLogs: Array<{ selector: string; options?: any }> = [];

  constructor(url: string = 'https://chatgpt.com') {
    this.urlValue = url;
  }

  public url(): string {
    if (this.urlThrows) {
      throw new Error('Page context destroyed or navigation in progress');
    }
    return this.urlValue;
  }

  public setSelector(selector: string, config: MockLocatorConfig): void {
    this.selectorConfigs.set(selector, config);
  }

  public locator(selector: string): any {
    const config = this.selectorConfigs.get(selector);

    if (config?.throwOnLocate) {
      throw new Error(`Synthetic DOM query error for selector: "${selector}"`);
    }

    const countVal = config && config.count !== undefined ? config.count : 0;
    const isVisibleFn = async () => {
      if (!config) return false;
      if (typeof config.isVisible === 'function') {
        return await config.isVisible();
      }
      return config.isVisible !== undefined ? config.isVisible : true;
    };

    const targetLocator: any = {
      _selector: selector,
      count: async () => countVal,
      isVisible: isVisibleFn,
      waitFor: async (opts: any) => {
        if (config?.waitFor) return await config.waitFor(opts);
      },
      click: async (opts: any) => {
        this.clickLogs.push({ selector, options: opts });
        if (config?.throwOnClick) {
          throw new Error(`Synthetic click failure on "${selector}"`);
        }
        if (config?.click) return await config.click(opts);
      },
      getAttribute: async (attr: string) => {
        if (config?.getAttribute) return await config.getAttribute(attr);
        return null;
      },
      innerText: async () => {
        if (config?.innerText) return await config.innerText();
        return '';
      },
      textContent: async () => {
        if (config?.textContent) return await config.textContent();
        return '';
      },
      locator: (childSelector: string) => {
        const childCfg = config?.children?.[childSelector];
        const childCount = childCfg?.count !== undefined ? childCfg.count : 0;
        const childIsVis = async () => childCfg?.isVisible !== undefined ? childCfg.isVisible : true;
        const childObj: any = {
          _childSelector: childSelector,
          count: async () => childCount,
          isVisible: childIsVis,
          first: () => childObj,
          getAttribute: async (attr: string) => childCfg?.getAttribute ? childCfg.getAttribute(attr) : null,
          innerText: async () => childCfg?.innerText ? childCfg.innerText() : '',
          textContent: async () => childCfg?.textContent ? childCfg.textContent() : '',
        };
        return childObj;
      },
    };

    // strict-mode .first() isolation
    targetLocator.first = () => {
      const firstTarget = { ...targetLocator, _isFirstCall: true };
      return firstTarget;
    };

    targetLocator.nth = (index: number) => {
      return { ...targetLocator, _nthIndex: index };
    };

    return targetLocator;
  }
}

// ------------------------------------------------------------------------------
// Test Runner Infrastructure
// ------------------------------------------------------------------------------

let passedTests = 0;
let failedTests = 0;
const failures: Array<{ name: string; error: any }> = [];

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  process.stdout.write(`  [CHALLENGE] ${name} ... `);
  try {
    await fn();
    console.log('\x1b[32mPASS\x1b[0m');
    passedTests++;
  } catch (err: any) {
    console.log('\x1b[31mFAIL\x1b[0m');
    console.error(`    -> Error: ${err?.message || err}`);
    if (err?.stack) {
      console.error(`    ${err.stack.split('\n').slice(1, 4).join('\n    ')}`);
    }
    failures.push({ name, error: err });
    failedTests++;
  }
}

// ------------------------------------------------------------------------------
// Adversarial Test Scenarios
// ------------------------------------------------------------------------------

async function runAdversarialTestSuite() {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('  ADVERSARIAL STRESS-TEST HARNESS: DYNAMIC SELECTOR RESOLUTION (M2)');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('Target: main/ai-studio/chatgpt/chatgptSelectors.config.ts\n');

  // ============================================================================
  // SECTION 1: Primary Selector Match Challenges
  // ============================================================================
  console.log('▶ SECTION 1: PRIMARY SELECTOR MATCH CHALLENGES');

  await test('1.1 Primary matches when present and visible with 0 fallback warnings and isFallback: false', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    const group = CHATGPT_SELECTORS.promptTextarea;

    page.setSelector(group.primary, { count: 1, isVisible: true });

    const warnings: string[] = [];
    const customLogger = { warn: (msg: string) => warnings.push(msg) };

    const result = await resolveSelector(page, group, 'promptInput', { logger: customLogger });

    assert.strictEqual(result.selector, group.primary, 'Resolved selector must match primary selector');
    assert.strictEqual(result.isFallback, false, 'isFallback must be false when primary matches');
    assert(result.locator, 'Must return locator object');
    assert.strictEqual(warnings.length, 0, 'Zero warning messages must be emitted on primary match');
  });

  await test('1.2 Primary resolution isolates strict-mode locator via .first()', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    const group = CHATGPT_SELECTORS.sendButton;

    // Simulate 3 matching send buttons on page (Playwright strict mode hazard)
    page.setSelector(group.primary, { count: 3, isVisible: true });

    const result = await resolveSelector(page, group, 'sendButton');
    assert.strictEqual(result.selector, group.primary);
    assert.strictEqual(result.isFallback, false);
    assert.strictEqual(result.locator._isFirstCall, true, 'Locator must be isolated through .first()');
  });

  await test('1.3 Primary present in DOM but hidden (isVisible: false) must NOT match; must fall back to visible fallback', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    const group = CHATGPT_SELECTORS.promptTextarea;

    // Primary exists but is hidden (e.g. display: none during loading modal)
    page.setSelector(group.primary, { count: 1, isVisible: false });
    // First fallback is visible
    const firstFallback = group.fallbacks[0];
    page.setSelector(firstFallback, { count: 1, isVisible: true });

    const warnings: string[] = [];
    const customLogger = { warn: (msg: string) => warnings.push(msg) };

    const result = await resolveSelector(page, group, 'promptTextarea', { logger: customLogger });

    assert.strictEqual(result.selector, firstFallback, 'Must resolve to firstFallback when primary is hidden');
    assert.strictEqual(result.isFallback, true, 'isFallback must be true when fallback is chosen');
    assert.strictEqual(warnings.length, 1, 'Warning must be emitted when primary is hidden');
  });

  await test('1.4 Primary present and hidden, with waitForVisible: false, matches primary without fallback', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    const group = CHATGPT_SELECTORS.promptTextarea;

    // Primary exists but is hidden
    page.setSelector(group.primary, { count: 1, isVisible: false });

    const warnings: string[] = [];
    const result = await resolveSelector(page, group, 'promptTextarea', {
      waitForVisible: false,
      logger: { warn: (m: string) => warnings.push(m) },
    });

    assert.strictEqual(result.selector, group.primary, 'Should match primary when visibility is not required');
    assert.strictEqual(result.isFallback, false);
    assert.strictEqual(warnings.length, 0);
  });

  // ============================================================================
  // SECTION 2: Fallback Selector Match & Exact Vietnamese Warning Text Challenges
  // ============================================================================
  console.log('\n▶ SECTION 2: FALLBACK SELECTOR MATCH & EXACT VIETNAMESE WARNING TEXT');

  await test('2.1 Fallback selected when primary missing (count = 0); verifies isFallback: true and exact Vietnamese warning', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    const group = CHATGPT_SELECTORS.sendButton;
    const contextName = 'chatgptSendAction';

    // Primary missing
    page.setSelector(group.primary, { count: 0, isVisible: false });
    // First fallback matches
    const expectedFallback = group.fallbacks[0];
    page.setSelector(expectedFallback, { count: 1, isVisible: true });

    const warnings: string[] = [];
    const customLogger = { warn: (msg: string) => warnings.push(msg) };

    const result = await resolveSelector(page, group, contextName, { logger: customLogger });

    assert.strictEqual(result.selector, expectedFallback);
    assert.strictEqual(result.isFallback, true);
    assert.strictEqual(warnings.length, 1, 'Must emit exactly 1 warning');

    const expectedWarning =
      `[ChatGPT Selector Fallback] Selector chính "${group.primary}" không tìm thấy cho [${contextName}]. ` +
      `Đã kích hoạt selector dự phòng "${expectedFallback}". Hãy kiểm tra và cập nhật chatgptSelectors.config.ts nếu giao diện web đã thay đổi.`;

    assert.strictEqual(warnings[0], expectedWarning, 'Warning log text must EXACTLY match the Vietnamese contract');
  });

  await test('2.2 Duck-typed logger ({ warn: fn }) correctly receives exact Vietnamese warning', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    const group = CHATGPT_SELECTORS.stopButton;
    const contextName = 'stopStreaming';

    page.setSelector(group.primary, { count: 0, isVisible: false });
    const chosenFallback = group.fallbacks[1];
    page.setSelector(group.fallbacks[0], { count: 0, isVisible: false });
    page.setSelector(chosenFallback, { count: 1, isVisible: true });

    const captured: string[] = [];
    // Passing duck-typed { warn: ... } directly as options
    const result = await resolveSelector(page, group, contextName, {
      warn: (msg: string) => captured.push(msg),
    });

    assert.strictEqual(result.selector, chosenFallback);
    assert.strictEqual(result.isFallback, true);
    assert.strictEqual(captured.length, 1);
    assert(captured[0].includes(`[ChatGPT Selector Fallback]`));
    assert(captured[0].includes(`Selector chính "${group.primary}" không tìm thấy cho [${contextName}]`));
    assert(captured[0].includes(`Đã kích hoạt selector dự phòng "${chosenFallback}"`));
    assert(captured[0].includes(`Hãy kiểm tra và cập nhật chatgptSelectors.config.ts nếu giao diện web đã thay đổi.`));
  });

  // ============================================================================
  // SECTION 3: Multiple Fallbacks Order & Cascade Challenges
  // ============================================================================
  console.log('\n▶ SECTION 3: MULTIPLE FALLBACKS ORDER & CASCADE CHALLENGES');

  await test('3.1 Selects the FIRST available fallback in defined sequential order (skipping missing fallbacks)', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    const group: SelectorGroup = {
      primary: '#primary-btn',
      fallbacks: ['.fb-first', '.fb-second', '.fb-third', '.fb-fourth'],
      description: 'Test sequential fallback precedence',
    };

    // Primary missing
    page.setSelector('#primary-btn', { count: 0, isVisible: false });
    // First fallback missing
    page.setSelector('.fb-first', { count: 0, isVisible: false });
    // Second fallback present and visible
    page.setSelector('.fb-second', { count: 1, isVisible: true });
    // Third and fourth also present and visible
    page.setSelector('.fb-third', { count: 1, isVisible: true });
    page.setSelector('.fb-fourth', { count: 1, isVisible: true });

    const warnings: string[] = [];
    const result = await resolveSelector(page, group, 'testPrecedence', {
      logger: { warn: (m: string) => warnings.push(m) },
    });

    assert.strictEqual(result.selector, '.fb-second', 'Must select .fb-second as the first available fallback');
    assert.strictEqual(result.isFallback, true);
    assert(warnings[0].includes('.fb-second'));
    assert(!warnings[0].includes('.fb-third'));
  });

  await test('3.2 Skips prior fallbacks that are present in DOM but hidden', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    const group: SelectorGroup = {
      primary: '#main-input',
      fallbacks: ['.hidden-fb1', '.hidden-fb2', '.visible-fb3'],
      description: 'Test skipping hidden fallbacks',
    };

    page.setSelector('#main-input', { count: 0 });
    page.setSelector('.hidden-fb1', { count: 1, isVisible: false });
    page.setSelector('.hidden-fb2', { count: 2, isVisible: false });
    page.setSelector('.visible-fb3', { count: 1, isVisible: true });

    const result = await resolveSelector(page, group, 'testHiddenSkipping');
    assert.strictEqual(result.selector, '.visible-fb3', 'Must skip hidden fallbacks and choose .visible-fb3');
    assert.strictEqual(result.isFallback, true);
  });

  await test('3.3 Fault tolerance: handles DOM syntax / query exception on FB1 and recovers cleanly on FB2', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    const group: SelectorGroup = {
      primary: '#bad-primary',
      fallbacks: ['.crashing-fb1', '.resilient-fb2'],
      description: 'Test syntax error recovery in fallback cascade',
    };

    page.setSelector('#bad-primary', { count: 0 });
    // Simulate an invalid selector or DOM detachment throw on FB1
    page.setSelector('.crashing-fb1', { throwOnLocate: true });
    page.setSelector('.resilient-fb2', { count: 1, isVisible: true });

    const warnings: string[] = [];
    const result = await resolveSelector(page, group, 'testFaultTolerance', {
      logger: { warn: (m: string) => warnings.push(m) },
    });

    assert.strictEqual(result.selector, '.resilient-fb2');
    assert.strictEqual(result.isFallback, true);
  });

  // ============================================================================
  // SECTION 4: Total Failure & Diagnostic Error vs tryResolveSelector Challenges
  // ============================================================================
  console.log('\n▶ SECTION 4: TOTAL FAILURE & DIAGNOSTICS vs tryResolveSelector');

  await test('4.1 Total failure throws SelectorNotFoundError with rich diagnostic data', async () => {
    const currentUrl = 'https://chatgpt.com/c/adversarial-session-123';
    const page = new MockPlaywrightPage(currentUrl);
    const group = CHATGPT_SELECTORS.assistantTurn;
    const contextName = 'assistantExtraction';

    // Mark all candidates missing
    page.setSelector(group.primary, { count: 0, isVisible: false });
    for (const fb of group.fallbacks) {
      page.setSelector(fb, { count: 0, isVisible: false });
    }

    let caughtError: SelectorNotFoundError | null = null;
    try {
      await resolveSelector(page, group, contextName);
    } catch (err: any) {
      if (err instanceof SelectorNotFoundError) {
        caughtError = err;
      } else {
        throw new Error(`Expected SelectorNotFoundError, caught ${err?.name || typeof err}: ${err}`);
      }
    }

    assert(caughtError !== null, 'resolveSelector must throw SelectorNotFoundError on total failure');
    assert.strictEqual(caughtError.name, 'SelectorNotFoundError');
    assert.strictEqual(caughtError.contextName, contextName);
    assert.strictEqual(caughtError.primarySelector, group.primary);
    assert.deepStrictEqual(caughtError.fallbackSelectors, group.fallbacks);
    assert.deepStrictEqual(caughtError.attemptedSelectors, [group.primary, ...group.fallbacks]);
    assert.strictEqual(caughtError.pageUrl, currentUrl);
    assert(caughtError.diagnosticTimestamp, 'Timestamp must be populated');

    // Diagnostics list inspection
    assert.strictEqual(
      caughtError.candidateDiagnostics.length,
      1 + group.fallbacks.length,
      'Must have diagnostic record for primary plus each fallback'
    );

    const primaryDiag = caughtError.candidateDiagnostics[0];
    assert.strictEqual(primaryDiag.selector, group.primary);
    assert.strictEqual(primaryDiag.isPrimary, true);
    assert.strictEqual(primaryDiag.count, 0);
    assert.strictEqual(primaryDiag.isVisible, false);

    // Message inspection
    assert(caughtError.message.includes('[ChatGPT Selector Resolution Error]'));
    assert(caughtError.message.includes(contextName));
    assert(caughtError.message.includes(currentUrl));
    assert(caughtError.message.includes(group.primary));
    assert(caughtError.message.includes('Khuyến nghị:'));
  });

  await test('4.2 Diagnostic recording handles page.url() throwing gracefully without crashing', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    page.urlThrows = true; // Simulate page destruction or navigation race
    const group = CHATGPT_SELECTORS.userTurn;

    page.setSelector(group.primary, { count: 0 });
    for (const fb of group.fallbacks) {
      page.setSelector(fb, { count: 0 });
    }

    let caught: SelectorNotFoundError | null = null;
    try {
      await resolveSelector(page, group, 'userTurnProbe');
    } catch (e: any) {
      if (e instanceof SelectorNotFoundError) {
        caught = e;
      }
    }

    assert(caught !== null);
    assert.strictEqual(caught.pageUrl, undefined, 'pageUrl must be safely undefined if page.url() throws');
    assert(caught.message.includes('URL trang hiện tại: N/A'));
  });

  await test('4.3 tryResolveSelector returns null on total failure without throwing', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    const group = CHATGPT_SELECTORS.continueButton;

    page.setSelector(group.primary, { count: 0 });
    for (const fb of group.fallbacks) {
      page.setSelector(fb, { count: 0 });
    }

    const res = await tryResolveSelector(page, group, 'continueButtonCheck');
    assert.strictEqual(res, null, 'tryResolveSelector must return null without throwing');
  });

  await test('4.4 tryResolveSelector returns resolution result when fallback matches', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    const group = CHATGPT_SELECTORS.continueButton;
    const activeFb = group.fallbacks[2]; // Vietnamese variant: button:has-text("Tiếp tục sinh")

    page.setSelector(group.primary, { count: 0 });
    page.setSelector(group.fallbacks[0], { count: 0 });
    page.setSelector(group.fallbacks[1], { count: 0 });
    page.setSelector(activeFb, { count: 1, isVisible: true });

    const warnings: string[] = [];
    const res = await tryResolveSelector(page, group, 'continueCheck', {
      logger: { warn: (m: string) => warnings.push(m) },
    });

    assert(res !== null, 'tryResolveSelector must return result when fallback matches');
    assert.strictEqual(res.selector, activeFb);
    assert.strictEqual(res.isFallback, true);
    assert.strictEqual(warnings.length, 1);
  });

  // ============================================================================
  // SECTION 5: dismissOverlays Engine Challenges
  // ============================================================================
  console.log('\n▶ SECTION 5: dismissOverlays ENGINE CHALLENGES');

  await test('5.1 dismissOverlays finds primary closeOverlayButton and clicks with timeout option', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    const closeGroup = CHATGPT_SELECTORS.closeOverlayButton;

    let clicked = false;
    let clickTimeoutUsed: number | undefined;

    page.setSelector(closeGroup.primary, {
      count: 1,
      isVisible: true,
      click: async (opts: any) => {
        clicked = true;
        clickTimeoutUsed = opts?.timeout;
      },
    });

    const count = await dismissOverlays(page);

    assert.strictEqual(count, 1, 'Must report 1 overlay dismissed');
    assert.strictEqual(clicked, true, 'Close button .click() must be invoked');
    assert.strictEqual(clickTimeoutUsed, 1500, 'Must apply safety timeout of 1500ms');
    assert.strictEqual(page.clickLogs.length, 1);
    assert.strictEqual(page.clickLogs[0].selector, closeGroup.primary);
  });

  await test('5.2 dismissOverlays resolves Vietnamese / fallback dismiss button if primary missing', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    const closeGroup = CHATGPT_SELECTORS.closeOverlayButton;
    const fallbackClose = closeGroup.fallbacks[0]; // e.g. button[aria-label="Đóng"]

    page.setSelector(closeGroup.primary, { count: 0 });
    page.setSelector(fallbackClose, {
      count: 1,
      isVisible: true,
    });

    const count = await dismissOverlays(page);
    assert.strictEqual(count, 1);
    assert.strictEqual(page.clickLogs.length, 1);
    assert.strictEqual(page.clickLogs[0].selector, fallbackClose);
  });

  await test('5.3 dismissOverlays returns 0 cleanly when no overlay exists', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    const closeGroup = CHATGPT_SELECTORS.closeOverlayButton;

    page.setSelector(closeGroup.primary, { count: 0 });
    for (const fb of closeGroup.fallbacks) {
      page.setSelector(fb, { count: 0 });
    }

    const count = await dismissOverlays(page);
    assert.strictEqual(count, 0, 'Must return 0 when no overlay is found');
    assert.strictEqual(page.clickLogs.length, 0);
  });

  await test('5.4 dismissOverlays handles click rejection / element detachment gracefully without throwing', async () => {
    const page = new MockPlaywrightPage('https://chatgpt.com');
    const closeGroup = CHATGPT_SELECTORS.closeOverlayButton;

    page.setSelector(closeGroup.primary, {
      count: 1,
      isVisible: true,
      throwOnClick: true, // Element disappeared or clicked by user simultaneously
    });

    let threw = false;
    let count = -1;
    try {
      count = await dismissOverlays(page);
    } catch {
      threw = true;
    }

    assert.strictEqual(threw, false, 'dismissOverlays must never throw an unhandled exception on click failure');
    // Note: implementation increments count because dismissal action was dispatched
    assert(count >= 0, 'Must return a valid non-negative count');
  });

  await test('5.5 dismissOverlays is null-safe against invalid page inputs', async () => {
    assert.strictEqual(await dismissOverlays(null), 0);
    assert.strictEqual(await dismissOverlays(undefined), 0);
    assert.strictEqual(await dismissOverlays({}), 0);
  });

  // ============================================================================
  // SECTION 6: Centralized Selector Matrix Integrity
  // ============================================================================
  console.log('\n▶ SECTION 6: CENTRALIZED SELECTOR MATRIX INTEGRITY');

  await test('6.1 All 8 mandatory selector groups + 3 auxiliary groups are fully defined with non-empty tiers', async () => {
    const mandatoryGroups: Array<keyof typeof CHATGPT_SELECTORS> = [
      'promptTextarea',
      'sendButton',
      'stopButton',
      'assistantTurn',
      'userTurn',
      'copyButton',
      'continueButton',
      'closeOverlayButton',
    ];

    for (const key of mandatoryGroups) {
      const group = CHATGPT_SELECTORS[key];
      assert(group, `Group ${key} must exist`);
      assert(typeof group.primary === 'string' && group.primary.length > 0, `Group ${key} primary must be non-empty`);
      assert(Array.isArray(group.fallbacks) && group.fallbacks.length > 0, `Group ${key} fallbacks must have >= 1 entries`);
      assert(typeof group.description === 'string' && group.description.length > 0, `Group ${key} must have description`);

      // Verify each fallback is non-empty string
      for (const fb of group.fallbacks) {
        assert(typeof fb === 'string' && fb.length > 0, `Fallback in ${key} must be valid string`);
      }
    }

    // Auxiliary groups check
    const auxiliaryGroups: Array<keyof typeof CHATGPT_SELECTORS> = [
      'alertError',
      'loginScreen',
      'cloudflareChallenge',
    ];

    for (const key of auxiliaryGroups) {
      const group = CHATGPT_SELECTORS[key];
      assert(group, `Auxiliary group ${key} must exist`);
      assert(group.primary.length > 0);
      assert(group.fallbacks.length > 0);
    }
  });

  await test('6.2 Aliased exports and backward-compatibility objects match canonical config', async () => {
    assert.strictEqual(CANONICAL_SELECTORS_CONFIG, CHATGPT_SELECTORS);
    assert.strictEqual(ALIASES.continueGeneratingButton, CHATGPT_SELECTORS.continueButton);
    assert.strictEqual(ALIASES.closePopupButton, CHATGPT_SELECTORS.closeOverlayButton);
  });

  // ============================================================================
  // SECTION 7: Zero User Prompt Capture Guard & Echo Discrimination
  // ============================================================================
  console.log('\n▶ SECTION 7: ZERO USER PROMPT CAPTURE GUARD & ECHO DISCRIMINATION');

  await test('7.1 isUserPromptEcho flags 46+ technical markers and continuation prompts as TRUE', async () => {
    assert(PROMPT_ECHO_MARKERS.length >= 42, `PROMPT_ECHO_MARKERS must contain >= 42 markers (actual: ${PROMPT_ECHO_MARKERS.length})`);

    // Sample checks across marker categories
    assert.strictEqual(isUserPromptEcho('PHẦN A — BỐ CỤC BẮT BUỘC\nNội dung...'), true);
    assert.strictEqual(isUserPromptEcho('Ba khối dưới đây là hợp đồng kỹ thuật'), true);
    assert.strictEqual(isUserPromptEcho('=== 1. ĐỊNH DANH DỰ ÁN & KÊNH ==='), true);
    assert.strictEqual(isUserPromptEcho('Bạn là biên kịch video ngắn chuyên nghiệp cho kênh video triệu view'), true);
    assert.strictEqual(isUserPromptEcho('CÂU 1: [Câu thoại mở đầu giật gân, cuốn hút người xem trong 3 giây đầu]'), true);
    assert.strictEqual(isUserPromptEcho('… Xem thêm'), true);
    assert.strictEqual(isUserPromptEcho('tiếp tục viết phần còn lại'), true);
    assert.strictEqual(isUserPromptEcho('tiếp tục viết tiếp kịch bản'), true);
  });

  await test('7.2 isUserPromptEcho flags genuine assistant responses as FALSE', async () => {
    // Valid video script output
    const realScript =
      'CÂU 1: Giữa lòng Hà Nội cổ kính, có một bí mật chưa từng được kể.\n' +
      'CÂU 2: Đó là câu chuyện về ngọn tháp cổ xây dựng từ thế kỷ 18.\n' +
      'CÂU 3: Hãy cùng khám phá ngay bây giờ.';
    assert.strictEqual(isUserPromptEcho(realScript), false);

    // Valid JSON blueprint
    const realJson = '{\n  "title": "Bí ẩn thế kỷ",\n  "targetDuration": 60,\n  "beats": []\n}';
    assert.strictEqual(isUserPromptEcho(realJson), false);

    // Valid natural assistant text
    const realText = 'Chào bạn! Đây là kịch bản hoàn chỉnh cho video của bạn theo yêu cầu.';
    assert.strictEqual(isUserPromptEcho(realText), false);

    // Null and whitespace edge cases
    assert.strictEqual(isUserPromptEcho(''), false);
    assert.strictEqual(isUserPromptEcho('   \n  '), false);
    assert.strictEqual(isUserPromptEcho(null as any), false);
    assert.strictEqual(isUserPromptEcho(undefined as any), false);
  });

  await test('7.3 DOM-level turn discrimination accurately segregates user vs assistant turns', async () => {
    // User turn locator
    const userTurnLoc: any = {
      getAttribute: async (attr: string) => attr === 'data-message-author-role' ? 'user' : null,
      locator: () => ({ count: async () => 0 }),
    };

    // Assistant turn locator
    const assistantTurnLoc: any = {
      getAttribute: async (attr: string) => attr === 'data-message-author-role' ? 'assistant' : null,
      locator: () => ({ count: async () => 0 }),
    };

    assert.strictEqual(await isElementUserTurn(userTurnLoc), true);
    assert.strictEqual(await isElementAssistantTurn(userTurnLoc), false);

    assert.strictEqual(await isElementUserTurn(assistantTurnLoc), false);
    assert.strictEqual(await isElementAssistantTurn(assistantTurnLoc), true);
  });

  await test('7.4 extractCleanAssistantText strips Web UI boilerplate and handles valid responses', async () => {
    const rawDomText =
      'ChatGPT đã nói:\n' +
      'CÂU 1: Xin chào các bạn!\n' +
      'CÂU 2: Hôm nay chúng ta sẽ tìm hiểu về vũ trụ bao la.\n' +
      'ChatGPT có thể mắc lỗi. Hãy kiểm tra lại thông tin quan trọng.';

    const mockPage: any = {
      locator: (sel: string) => {
        if (sel === CHATGPT_SELECTORS.assistantTurn.primary) {
          return {
            count: async () => 1,
            nth: (i: number) => ({
              getAttribute: async (a: string) => a === 'data-message-author-role' ? 'assistant' : null,
              locator: (sub: string) => ({
                count: async () => sub.includes('markdown') ? 1 : 0,
                first: () => ({
                  innerText: async () => rawDomText,
                  textContent: async () => rawDomText,
                }),
              }),
            }),
          };
        }
        return { count: async () => 0 };
      },
    };

    const res = await extractCleanAssistantText(mockPage);
    assert.strictEqual(res.hasContent, true);
    assert.strictEqual(res.isEcho, false);
    assert(res.text.startsWith('CÂU 1: Xin chào các bạn!'), 'Must strip ChatGPT đã nói header');
    assert(!res.text.includes('ChatGPT có thể mắc lỗi'), 'Must strip footer disclaimer');
  });

  await test('7.5 extractCleanAssistantText flags prompt echo as isEcho: true and hasContent: false', async () => {
    const echoDomText =
      'ChatGPT đã nói:\n' +
      'Ba khối dưới đây là hợp đồng kỹ thuật\n' +
      'PHẦN A — BỐ CỤC BẮT BUỘC';

    const mockPage: any = {
      locator: (sel: string) => {
        if (sel === CHATGPT_SELECTORS.assistantTurn.primary) {
          return {
            count: async () => 1,
            nth: () => ({
              getAttribute: async (a: string) => a === 'data-message-author-role' ? 'assistant' : null,
              locator: (sub: string) => ({
                count: async () => sub.includes('markdown') ? 1 : 0,
                first: () => ({
                  innerText: async () => echoDomText,
                  textContent: async () => echoDomText,
                }),
              }),
            }),
          };
        }
        return { count: async () => 0 };
      },
    };

    const res = await extractCleanAssistantText(mockPage);
    assert.strictEqual(res.isEcho, true, 'Must identify prompt echo');
    assert.strictEqual(res.hasContent, false, 'hasContent must be false on prompt echo');
  });

  // ============================================================================
  // Summary & Verdict
  // ============================================================================
  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log(`  ADVERSARIAL SUITE RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('════════════════════════════════════════════════════════════════════════════════');

  if (failedTests > 0) {
    console.error('\n❌ FAILURES:');
    for (const f of failures) {
      console.error(`- ${f.name}: ${f.error?.message || f.error}`);
    }
    process.exit(1);
  } else {
    console.log('\n🎉 ALL ADVERSARIAL CHALLENGES PASSED EMPIRICALLY (100% SUCCESS RATE)!');
    process.exit(0);
  }
}

runAdversarialTestSuite().catch((err) => {
  console.error('Fatal unhandled error running test suite:', err);
  process.exit(1);
});
