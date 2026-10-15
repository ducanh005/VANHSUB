import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-job-audit-'));
  process.env.VANHSUB_AI_STUDIO_DIR = path.join(root, 'config');
  try {
    const { updateAiStudioConfig } = await import('../main/store/aiStudioStore');
    const { AiStudioPipelineEngine } = await import('../main/ai-studio/AiStudioPipelineEngine');
    const { isSessionOperationActive, withSessionOperation } = await import('../main/ai-studio/sessionOperations');
    const engine = new AiStudioPipelineEngine();
    const session: any = { sessionId: 'job-audit', projectId: 'owner', topic: 'Test', workspaceDir: path.join(root, 'episode'), currentStage: 2, stageName: 'script', status: 'awaiting_approval', progress: 25,
      stages: { 1: { status: 'success', stageName: 'Source' }, 2: { status: 'success', stageName: 'Script' } }, artifacts: { scriptLines: [{ id: 'line', index: 1, text: 'Text' }] }, createdAt: Date.now(), updatedAt: Date.now() };
    updateAiStudioConfig({ activeProjectId: 'owner', savedProjects: [{ id: 'owner', name: 'Owner', outputDir: path.join(root, 'output'), savedSession: session, lastSessionId: session.sessionId } as any] });
    engine.persistSessionStateAtomic(session);
    const checkpoint = fs.readFileSync(path.join(session.workspaceDir, 'session.json'), 'utf8');
    await assert.rejects(() => engine.approveStage({ sessionId: session.sessionId, currentStage: 7, updatedArtifacts: { audioPath: 'wrong' } }, () => {}), /Chỉ được duyệt/);
    assert.equal(fs.readFileSync(path.join(session.workspaceDir, 'session.json'), 'utf8'), checkpoint);
    await assert.rejects(() => engine.resume({ sessionId: session.sessionId, fromStage: 0 as any }, () => {}), /1–8/);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    (engine as any).runPipelineLoop = async () => { await waiting; };
    const results = await Promise.allSettled([engine.approveStage({ sessionId: session.sessionId, currentStage: 2 }, () => {}), engine.approveStage({ sessionId: session.sessionId, currentStage: 2 }, () => {})]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(isSessionOperationActive(session.sessionId), true);
    await engine.cancel({ sessionId: session.sessionId });
    assert.equal(isSessionOperationActive(session.sessionId), true, 'Cancel cannot free the lease of a provider still in flight');
    await assert.rejects(() => engine.resume({ sessionId: session.sessionId }, () => {}), /chưa dừng hẳn/);
    await assert.rejects(() => engine.renderVideo({ sessionId: session.sessionId }), /chưa dừng hẳn/);
    await assert.rejects(() => engine.importSceneMedia({ sessionId: session.sessionId, sceneId: 'shot', filePath: 'none' }), /chưa dừng hẳn/);
    await assert.rejects(() => withSessionOperation(session.sessionId, async () => {}), /chưa dừng hẳn/);
    release(); await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(isSessionOperationActive(session.sessionId), false);
    assert.equal((await engine.getState({ sessionId: session.sessionId }))!.jobActive, false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(session.workspaceDir, 'session.json'), 'utf8')).jobActive, undefined);
    console.log('PASS: approval integrity, stage bounds, duplicate continuation exclusion and cancellation lease held until actual provider settlement');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
