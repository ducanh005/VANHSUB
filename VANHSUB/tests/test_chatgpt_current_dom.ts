import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { getAssistantTurns, readAssistantTurnText } from '../main/ai-studio/chatgpt/chatgptSelectors.config';
import { ChatGptScriptCollector, ChatGptStreamingTimeoutError, readComposerText, stitchScriptTurns, isMissingExpectedMarker } from '../main/ai-studio/chatgpt/ChatGptScriptCollector';
import { AiStudioLlmService } from '../main/ai-studio/services/AiStudioLlmService';
import { ChatGptWebSessionManager, sanitizePromptEchoFromOutput } from '../main/ai-studio/chatgpt/ChatGptWebSessionManager';

async function main() {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  let passed = 0;
  try {
    const page = await browser.newPage();
    const collector = new ChatGptScriptCollector();
    const answer = '1. SYSTEM ROLE\n\nBạn viết câu chuyện riêng của kênh.\n\n9. STRICT OUTPUT FORMAT';
    // Minimal reproduction of the live DOM observed on the reported conversation.
    await page.setContent(`<div class="group"><div>
      <div><h4>Bạn đã nói:</h4><div data-chatgpt-search-unit-key="fallback-turn-0:0:user">USER INPUT<button aria-label="Chỉnh sửa tin nhắn"></button></div></div>
      <div><span hidden data-chatgpt-agent-turn-start></span><div data-chatgpt-search-unit-key="fallback-turn-0:2:assistant"><h4 data-conversation-role="assistant">ChatGPT đã nói:</h4><div><p>1. SYSTEM ROLE</p><p>Bạn viết câu chuyện riêng của kênh.</p><p>9. STRICT OUTPUT FORMAT</p></div></div></div>
      </div><div class="turn-action-controls"><button aria-label="Sao chép"></button></div></div>`);
    const turns = await getAssistantTurns(page);
    assert.equal(turns.length, 1);
    assert.equal(await readAssistantTurnText(turns[0]), answer);
    assert.equal(await collector.extractLatestResponseText(page), answer);
    passed++;
    await collector.waitForStreamingComplete(page, 1000, { pollIntervalMs: 50, requiredStableCycles: 2 });
    passed++;
    await assert.rejects(collector.waitForStreamingComplete(page, 600, {
      initialTurnCount: 1, pollIntervalMs: 50, startTimeoutMs: 100,
    }), ChatGptStreamingTimeoutError);
    passed++;
    await page.locator('[data-chatgpt-search-unit-key$=":assistant"]').evaluate(el => el.removeAttribute('data-chatgpt-search-unit-key'));
    assert.equal((await getAssistantTurns(page)).length, 1);
    assert.equal(await collector.extractLatestResponseText(page), answer);
    passed++;
    await page.evaluate(`document.body.insertAdjacentHTML('beforeend', '<div data-chatgpt-search-unit-key="fallback-turn-1:2:assistant"><h4 data-conversation-role="assistant">ChatGPT said:</h4><div>Fresh answer.</div></div>')`);
    // Match both assistant messages with the same selector family.
    await page.locator('div:has(> [data-conversation-role="assistant"])').first().evaluate(el => el.setAttribute('data-chatgpt-search-unit-key', 'fallback-turn-0:2:assistant'));
    await collector.waitForStreamingComplete(page, 1000, { initialTurnCount: 1, pollIntervalMs: 50, requiredStableCycles: 2 });
    assert.equal(await collector.extractLatestResponseText(page), 'Fresh answer.');
    passed++;
    // Legacy UI must collect every answer block, without reading unrelated clipboard contents.
    await page.setContent('<div data-message-author-role="user">USER INPUT</div><div data-message-author-role="assistant"><div class="markdown">First block.</div><div class="markdown">Second block.</div><button aria-label="Copy">copy</button></div>');
    await page.evaluate(`(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { readText: () => { throw new Error('Must not read shared clipboard'); } } });
      document.querySelector('button').onclick = () => { throw new Error('Must not click copy'); };
    })()`);
    assert.equal(await collector.extractLatestResponseText(page), 'First block.\n\nSecond block.');
    passed++;
    const contract = `IF ACCEPTED:
TITLE: [final title]
SCRIPT:
[complete narration script, plain text, no headings, no timestamps, no stage directions]
--- END OF SCRIPT ---
NARRATION DIRECTION:
[3 to 6 lines: register, target words per minute, the two places to slow down, phonetic notes for any
name or place]
Output NOTHING else. No analysis, no planning, no alternative titles, no word counts, no visual or
music instructions, no commentary.`;
    assert.equal(sanitizePromptEchoFromOutput(contract, `Copy this verbatim:\n${contract}`, 'master_prompt'), contract);
    passed++;
    const title = 'Hanh trinh kham pha nhung bi an cua dai duong sau tham';
    const idea = JSON.stringify({ title, outline: ['A', 'B', 'C'] });
    assert.equal(sanitizePromptEchoFromOutput(idea, `Write an idea about:\n${title}`, 'idea'), idea);
    assert.equal(sanitizePromptEchoFromOutput(`CÂU 1: ${title}`, `Write a script about:\n${title}`, 'script'), `CÂU 1: ${title}`);
    passed++;
    await page.setContent('<div>No continuation button</div>');
    const incompleteMaster = '1. SYSTEM ROLE\n2. INPUT\n=== SOURCE END ===\n3. PRIMARY OBJECTIVE\nNot finished.';
    const partial = await collector.handleContinuationIfTruncated(page, incompleteMaster, { kind: 'master_prompt', maxContinuationTurns: 0 });
    assert.equal(partial.isTruncated, true);
    const complete = await collector.handleContinuationIfTruncated(page, `1. SYSTEM ROLE\n9. STRICT OUTPUT FORMAT\n${contract}`, { kind: 'master_prompt', maxContinuationTurns: 0 });
    assert.equal(complete.isTruncated, false);
    passed++;
    const stitched = stitchScriptTurns(['=== BEGIN SCRIPT ===\nCÂU 1: First sentence.', 'CÂU 2: Still unfinished']);
    assert.equal(stitched.includes('=== END SCRIPT ==='), false);
    assert.equal((await collector.handleContinuationIfTruncated(page, stitched, { kind: 'script', maxContinuationTurns: 0 })).isTruncated, true);
    assert.equal((await collector.handleContinuationIfTruncated(page, stitched + '\n=== END SCRIPT ===', { kind: 'script', targetMinSentences: 10, maxContinuationTurns: 0 })).isTruncated, true);
    assert.equal(isMissingExpectedMarker('{"nested":{"title":"ok"}, "outline":[', 'idea'), true);
    passed++;
    const continuationCollector = new ChatGptScriptCollector();
    let continuations = 0;
    continuationCollector.sendPrompt = async () => { continuations++; };
    continuationCollector.waitForStreamingComplete = async () => {};
    continuationCollector.extractLatestResponseText = async () => `9. STRICT OUTPUT FORMAT\n${contract}`;
    const resumed = await continuationCollector.handleContinuationIfTruncated(page, incompleteMaster, { kind: 'master_prompt', maxContinuationTurns: 2 });
    assert.equal(continuations, 1);
    assert.equal(resumed.isTruncated, false);
    assert.ok(resumed.fullText.includes('music instructions, no commentary.'));
    continuationCollector.extractLatestResponseText = async () => '';
    assert.equal((await continuationCollector.handleContinuationIfTruncated(page, incompleteMaster, { kind: 'master_prompt', maxContinuationTurns: 2 })).isTruncated, true);
    passed++;
    await page.setContent('<button aria-label="Gửi phản hồi">Unrelated</button><form><textarea id="prompt-textarea">Old default</textarea><button type="button" aria-label="Gửi">Send</button></form>');
    await page.evaluate(`document.querySelector('form button').onclick = () => {
      const input = document.querySelector('textarea');
      input.defaultValue = input.value;
      input.value = '';
    }`);
    await collector.sendPrompt(page, 'Test sending an idea prompt.', { dismissOverlays: false, submissionVerificationTimeoutMs: 500 });
    assert.equal(await readComposerText(page.locator('textarea')), '');
    assert.equal(await page.locator('textarea').textContent(), 'Test sending an idea prompt.');
    passed++;
    await page.setContent('<form><div id="prompt-textarea" class="ProseMirror" contenteditable="true"></div><button type="button" data-testid="send-button">Send</button></form>');
    await page.evaluate(`document.querySelector('button').onclick = () => {
      const user = document.createElement('div');
      user.setAttribute('data-chatgpt-search-unit-key', 'turn-1:user');
      user.textContent = document.querySelector('[contenteditable]').innerText;
      document.body.appendChild(user);
    }`);
    await collector.sendPrompt(page, 'An accepted message while composer is still populated.', { dismissOverlays: false, submissionVerificationTimeoutMs: 500 });
    assert.equal(await page.locator('[data-chatgpt-search-unit-key]').count(), 1);
    passed++;
    await page.setContent('<textarea id="prompt-textarea"></textarea><button data-testid="send-button">No-op</button>');
    await assert.rejects(collector.sendPrompt(page, 'This message was never sent.', { dismissOverlays: false, submissionVerificationTimeoutMs: 200 }), /Không xác nhận/);
    passed++;
    await page.setContent('<textarea id="prompt-textarea"></textarea><button data-testid="send-button" style="pointer-events:none">Cannot click</button>');
    await page.evaluate(`document.querySelector('textarea').onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); event.target.value = ''; }
    }`);
    await collector.sendPrompt(page, 'Use Enter when the button click fails.', { dismissOverlays: false, submissionVerificationTimeoutMs: 500 });
    assert.equal(await page.locator('textarea').inputValue(), '');
    passed++;
    // A collection failure after submission must never submit the prompt twice.
    let sends = 0;
    collector.sendPrompt = async () => { sends++; };
    collector.collectResponse = async () => { throw new Error('execution context was destroyed'); };
    await assert.rejects(collector.executePromptWithContinuation(page, 'Test', { retryBaseDelayMs: 1 }));
    assert.equal(sends, 1);
    passed++;
    const manager = ChatGptWebSessionManager.getInstance();
    const sharedCollector = ChatGptScriptCollector.getInstance();
    const originalCollect = sharedCollector.collect;
    const originalLogin = manager.checkLoginStatus;
    try {
      manager.checkLoginStatus = async () => ({ isLoggedIn: true, sessionCheckedAt: Date.now() });
      const response = { text: contract, rawText: contract, turnCount: 1, durationMs: 1, wordCount: 50,
        isTruncated: true, continuedTurns: 5, continuationTriggered: true, conversationUrl: 'https://chatgpt.com/c/test' };
      sharedCollector.collect = async () => response;
      await assert.rejects(manager.executePromptTurn('Test', 'offscreen', undefined, true, undefined, 'master_prompt'), /chưa hoàn tất/);
      await assert.rejects(manager.generateScriptWeb('Test'), /chưa hoàn tất/);
      response.isTruncated = false;
      assert.equal(await manager.executePromptTurn(`Copy verbatim:\n${contract}`, 'offscreen', undefined, true, undefined, 'master_prompt'), contract);
      passed++;
    } finally {
      sharedCollector.collect = originalCollect;
      manager.checkLoginStatus = originalLogin;
    }
    const original = manager.executePromptTurn;
    try {
      manager.executePromptTurn = async () => { throw new Error('TEST_READ_TIMEOUT'); };
      await assert.rejects(AiStudioLlmService.getInstance().generateMasterPromptForChannel(
        { projectName: 'Test', aiProvider: 'chatgpt_web' }, { provider: 'chatgpt_web' } as any
      ), /TEST_READ_TIMEOUT/);
      manager.executePromptTurn = async () => '';
      await assert.rejects(AiStudioLlmService.getInstance().generateMasterPromptForChannel(
        { projectName: 'Test', aiProvider: 'chatgpt_web' }, { provider: 'chatgpt_web' } as any
      ), /không trả về master prompt hợp lệ/);
      passed++;
    } finally { manager.executePromptTurn = original; }
    console.log(`PASS: ${passed} ChatGPT response regressions (real Chromium DOM).`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
