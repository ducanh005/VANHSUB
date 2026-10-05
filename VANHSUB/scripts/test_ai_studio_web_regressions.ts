import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatGptTurnTracker, isChatGptSessionCookie, readChatGptTurnSnapshot, type ChatGptTurnSnapshot } from '../main/ai-studio/chatgpt/ChatGptWebTurnState';
import { ChatGptWebSessionManager, buildScriptPromptForWeb } from '../main/ai-studio/chatgpt/ChatGptWebSessionManager';
import { aiStudioLlmService } from '../main/ai-studio/services/AiStudioLlmService';
import type { AiStudioLlmConfig, ScriptBeatLine } from '../main/ai-studio/types';

async function main() {
  const baseline: ChatGptTurnSnapshot = { userCount: 1, assistantCount: 1, assistantId: 'old', text: 'Old answer', isStreaming: false, hasCompletionControl: true };
  const next = { ...baseline, userCount: 2, assistantCount: 2, assistantId: 'new', text: 'New answer' };
  const tracker = new ChatGptTurnTracker(baseline);
  assert.equal(tracker.observe(baseline, 1000), null);
  assert.equal(tracker.observe(baseline, 9000), null, 'Never return an old answer');
  assert.equal(tracker.observe({ ...next, userCount: 1 }, 10000), null, 'Require submitted user turn');
  assert.equal(tracker.observe({ ...next, isStreaming: true }, 11000), null);
  assert.equal(tracker.observe(next, 12000), null);
  const corrected = { ...next, text: 'New result' }; // same length as New answer
  assert.equal(tracker.observe(corrected, 13800), null, 'Equal-length corrections restart settling');
  assert.equal(tracker.observe(corrected, 15500), null);
  assert.equal(tracker.observe(corrected, 15600), 'New result');
  const paused = new ChatGptTurnTracker(baseline);
  assert.equal(paused.observe({ ...next, hasCompletionControl: false }, 1000), null);
  assert.equal(paused.observe({ ...next, hasCompletionControl: false }, 20000), null, 'A pause without completion controls is not completion');
  assert.throws(() => paused.observe({ ...next, error: 'Usage limit reached' }, 21000), /Usage limit/);
  const thinking = new ChatGptTurnTracker(baseline);
  assert.equal(thinking.observe({ ...next, text: '' }, 1000), null);
  assert.equal(thinking.observe({ ...next, text: '' }, 10000), null);
  console.log('PASS: stale replies, unconfirmed sends, streaming, equal-length corrections, reasoning, completion and errors');

  // Verify the actual function injected into the page runs without imported/compiler helpers.
  const domState = runInNewContext(`(${readChatGptTurnSnapshot.toString()})()`, { document: {
    querySelectorAll: () => [], querySelector: () => null,
  } });
  assert.equal(domState.assistantCount, 0);
  assert.equal(domState.text, '');
  assert.equal(isChatGptSessionCookie({ name: 'oai-nav-state', domain: '.chatgpt.com' }), false);
  assert.equal(isChatGptSessionCookie({ name: 'auth', domain: 'accounts.google.com' }), false);
  assert.equal(isChatGptSessionCookie({ name: '__Secure-next-auth.session-token', domain: 'evilchatgpt.com' }), false);
  assert.equal(isChatGptSessionCookie({ name: '__Secure-next-auth.session-token', domain: '.chatgpt.com', expirationDate: 999 }, 1000), false);
  assert.equal(isChatGptSessionCookie({ name: '__Secure-next-auth.session-token.0', domain: '.chatgpt.com', expirationDate: 2000 }, 1000), true);
  console.log('PASS: injected snapshot serialization and scoped, unexpired authentication cookies');

  const cfg: AiStudioLlmConfig = { provider: 'deepseek', apiKey: 'retained-test-key', baseUrl: 'https://example.invalid/v1', model: 'deepseek-chat', temperature: 0.6, systemPromptPreset: 'youtube_story' };
  const selected = aiStudioLlmService.resolveChannelLlmConfig(cfg, { aiProvider: 'chatgpt_web' });
  assert.equal(selected.provider, 'chatgpt_web');
  assert.equal(selected.apiKey, '');
  assert.equal(selected.baseUrl, undefined);
  assert.equal((aiStudioLlmService as any).createClient({ ...cfg, provider: 'chatgpt_web' }), null);
  assert.equal((aiStudioLlmService as any).createClient({ ...cfg, provider: 'gemini_web' }), null);
  const built = buildScriptPromptForWeb('Biển', 'youtube_story', undefined, {
    projectName: 'Kênh $&', masterPrompt: 'SYSTEM ROLE: Giữ nguyên dữ kiện. Kênh {{ CHANNEL_NAME }}. Nguồn {{ SOURCE_MATERIAL }}.',
  });
  assert.ok(built.prompt.includes('Kênh Kênh $&'));
  assert.ok(built.prompt.includes('Nguồn Biển'));
  assert.ok(built.prompt.includes('CÂU X'));
  console.log('PASS: channel provider, no inherited API routing and master prompt on web');

  const manager = ChatGptWebSessionManager.getInstance();
  const original = manager.executePromptTurn;
  try {
    manager.executePromptTurn = async () => { throw new Error('Test transport failure'); };
    await assert.rejects(() => aiStudioLlmService.generateMasterPromptForChannel({ aiProvider: 'chatgpt_web' }, cfg), /Test transport failure/);
    manager.executePromptTurn = async () => 'Short';
    await assert.rejects(() => aiStudioLlmService.generateMasterPromptForChannel({ aiProvider: 'chatgpt_web' }, cfg), /quá ngắn/);
    manager.executePromptTurn = async () => 'Sorry, I cannot complete that request. '.repeat(10);
    await assert.rejects(() => aiStudioLlmService.generateMasterPromptForChannel({ aiProvider: 'chatgpt_web' }, cfg), /thiếu cấu trúc/);
    const validMaster = await aiStudioLlmService.generateMasterPromptForChannel({ projectName: 'Biển' });
    manager.executePromptTurn = async () => validMaster;
    assert.ok((await aiStudioLlmService.generateMasterPromptForChannel({ aiProvider: 'chatgpt_web' }, cfg)).includes('SYSTEM ROLE'));
    manager.executePromptTurn = async () => JSON.stringify({ title: 'Biển', outline: ['Đoạn một', 'Đoạn hai'] });
    const idea = await aiStudioLlmService.analyzeIdeaBlueprint('Biển', cfg, '16:9', undefined, { aiProvider: 'chatgpt_web' });
    assert.equal(idea.title, 'Biển', 'Idea uses the selected web provider instead of global API provider');
  } finally { manager.executePromptTurn = original; }
  for (const raw of ['', 'Usage limit reached', '{"title":"Thiếu dàn ý"}', 'null', '{"outline":[null,42]}']) {
    assert.throws(() => aiStudioLlmService.parseBlueprintJson(raw, 'Biển'), /dàn ý hợp lệ/);
  }
  console.log('PASS: master prompt failure propagation, idea routing and rejection of fake blueprints');

  const lines: ScriptBeatLine[] = ['Hôm nay ta tìm hiểu về biển.', 'Nước biển chuyển động theo thủy triều.', 'Hãy theo dõi kênh để tìm hiểu thêm.'].map((text, i) => ({ id: `l${i}`, index: i + 1, text, beatType: i === 0 ? 'hook' : 'body', estimatedDurationSec: 4 }));
  const refined = await aiStudioLlmService.refineScript(lines);
  assert.ok(!refined.lines.some((l) => /Tây Ban Nha|La Braña|7\.000|các nhà khoa học đã tìm thấy/.test(l.text)));
  assert.equal(refined.lines[0].text, lines[0].text);
  assert.equal(lines[1].text, 'Nước biển chuyển động theo thủy triều.', 'Input remains unmodified');
  console.log('PASS: script refinement does not inject unrelated fabricated facts');

  const { AiStudioPipelineEngine } = await import('../main/ai-studio/AiStudioPipelineEngine');
  const engine = Object.create(AiStudioPipelineEngine.prototype);
  engine.activeAbortControllers = new Map([['test', new AbortController()]]);
  engine.getState = async () => ({ status: 'running', currentStage: 2, stages: { 2: { status: 'success' } } });
  await assert.rejects(() => engine.approveStage({ sessionId: 'test', currentStage: 2 }, () => {}), /Không thể duyệt bước/);
  engine.getState = async () => ({ status: 'awaiting_approval', currentStage: 2, stages: { 2: { status: 'success' } } });
  await assert.rejects(() => engine.approveStage({ sessionId: 'test', currentStage: 4 }, () => {}), /Không thể duyệt bước/);
  engine.getState = async () => ({ sessionId: 'test', status: 'running', currentStage: 1, stages: {} });
  await assert.rejects(() => engine.resume({ sessionId: 'test', fromStage: 1 }, () => {}), /Pipeline đang chạy/);
  await assert.rejects(() => engine.resume({ sessionId: 'test', fromStage: 9 }, () => {}), /khoảng 1 đến 8/);
  await assert.rejects(() => engine.resume({ sessionId: 'test', fromStage: 0 }, () => {}), /khoảng 1 đến 8/);
  await assert.rejects(() => engine.resume({ sessionId: 'test', fromStage: NaN }, () => {}), /khoảng 1 đến 8/);
  console.log('PASS: stale approval, duplicate runs and invalid resume stages rejected');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-web-regression-'));
  const previousDir = process.env.VANHSUB_AI_STUDIO_DIR;
  process.env.VANHSUB_AI_STUDIO_DIR = tmp;
  try {
    fs.mkdirSync(path.join(tmp, 'sessions'));
    const realEngine = new AiStudioPipelineEngine();
    const output = path.join(tmp, 'project-a');
    const state: any = { sessionId: 'session-a', outputDir: output, status: 'awaiting_approval', currentStage: 1, stages: { 1: { status: 'success' } }, artifacts: {} };
    realEngine.persistSessionStateAtomic(state);
    assert.equal(realEngine.getSessionDir('session-a'), output);
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'session.json'), 'utf8')).sessionId, 'session-a');
    await realEngine.cancel({ sessionId: 'session-a' });
    assert.equal(state.status, 'cancelled', 'Cancellation also stops approval waits');
    const otherOutput = path.join(tmp, 'project-b');
    fs.mkdirSync(otherOutput);
    fs.writeFileSync(path.join(otherOutput, 'session.json'), JSON.stringify({ sessionId: 'session-b' }));
    const restored = new AiStudioPipelineEngine();
    restored.getSessionDir = () => otherOutput; // simulate switching projects before loading old session
    assert.equal((await restored.getState({ sessionId: 'session-a' }))?.sessionId, 'session-a', 'Reject wrong project session and recover indexed checkpoint');
    assert.equal(await restored.getState({ sessionId: 'unknown' }), null);
    console.log('PASS: checkpoint directory ownership, cross-project identity and cancellation while awaiting approval');
  } finally {
    if (previousDir === undefined) delete process.env.VANHSUB_AI_STUDIO_DIR;
    else process.env.VANHSUB_AI_STUDIO_DIR = previousDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
