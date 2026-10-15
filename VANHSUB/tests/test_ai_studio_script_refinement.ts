import assert from 'node:assert/strict';
import { AiStudioLlmService } from '../main/ai-studio/services/AiStudioLlmService';
import { parseRefinedScript } from '../main/ai-studio/scriptRefinement';

async function main() {
  const service = new AiStudioLlmService();
  const original: any[] = [{ id: 'line-1', index: 1, text: 'Cây cà chua cần ánh sáng.', visualAction: 'Tomato plant', audioPath: 'old.mp3', durationMs: 9000 }];
  const before = structuredClone(original);
  service.evaluateScript = async () => ({ overallScore: 60, lowestScore: 6, criteria: [], failedCriteria: ['D1'], critique: 'Cần làm rõ lời mở đầu', evaluatedAt: Date.now() });
  let captured = '', provider = '';
  (service as any).requestScriptReview = async (prompt: string, config: any) => {
    captured = prompt; provider = config.provider;
    return '```json\n' + JSON.stringify({ lines: [{ id: 'line-1', text: 'Cà chua cần ánh sáng để phát triển.', visualAction: 'Sunlit tomato plant', audioPath: 'injected.mp3', durationMs: 999999 }] }) + '\n```';
  };
  const result = await service.refineScript(original, 'Giải thích dễ hiểu cho người mới trồng cây', 'custom_prompt', undefined, undefined, { provider: 'deepseek' } as any);
  assert.equal(provider, 'deepseek');
  assert.ok(captured.includes('Giải thích dễ hiểu cho người mới trồng cây'));
  assert.ok(captured.includes(original[0].text));
  assert.ok(!captured.includes('La Braña'));
  assert.ok(!captured.includes('old.mp3'));
  assert.equal(result.lines[0].text, 'Cà chua cần ánh sáng để phát triển.');
  assert.equal(result.lines[0].id, original[0].id);
  assert.equal(result.lines[0].visualAction, 'Sunlit tomato plant');
  assert.equal(result.lines[0].audioPath, undefined);
  assert.equal(result.lines[0].durationMs, undefined);
  assert.deepEqual(original, before);
  await service.refineScript(original, undefined, 'improve_weaknesses', undefined, undefined, { provider: 'chatgpt_web' } as any);
  assert.ok(captured.includes('Nhận xét:'));
  assert.ok(!captured.includes('La Braña'));
  assert.equal(provider, 'chatgpt_web');
  await assert.rejects(() => service.refineScript([], undefined, 'improve_weaknesses'), /Chưa có kịch bản/);
  await assert.rejects(() => service.refineScript(original, '', 'custom_prompt', undefined, undefined, { provider: 'openai' } as any), /Chưa nhập/);
  assert.throws(() => parseRefinedScript('not JSON', original));
  assert.throws(() => parseRefinedScript('{"lines":[]}', original), /số dòng/);
  assert.throws(() => parseRefinedScript('{"lines":[{"id":"wrong","text":"text"}]}', original), /ID/);
  assert.throws(() => parseRefinedScript('{"lines":[{"id":"line-1","text":"  "}]}', original), /lời thoại/);
  assert.throws(() => parseRefinedScript('{"lines":[{"id":"line-1","text":"Text","suggestedMediaType":"audio"}]}', original), /media/);
  (service as any).requestScriptReview = async () => { throw new Error('provider unavailable'); };
  await assert.rejects(() => service.refineScript(original, 'Rewrite', 'custom_prompt', undefined, undefined, { provider: 'openai' } as any), /provider unavailable/);
  assert.deepEqual(original, before);
  console.log('PASS: provider-driven refinement, arbitrary instructions, topic input, schema rejection and no synthetic fallback');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
