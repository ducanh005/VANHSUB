import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-episode-audit-'));
  process.env.VANHSUB_AI_STUDIO_DIR = path.join(root, 'config');
  process.env.VANHSUB_BIBLE_DIR = path.join(root, 'bible');
  try {
    const { updateAiStudioConfig, getDecryptedAiStudioConfig } = await import('../main/store/aiStudioStore');
    const { AiStudioPipelineEngine } = await import('../main/ai-studio/AiStudioPipelineEngine');
    const output = path.join(root, 'output');
    updateAiStudioConfig({ activeProjectId: 'owner', savedProjects: [{ id: 'owner', name: 'Audit', outputDir: output, channelProfile: {} } as any] });
    const engine = new AiStudioPipelineEngine();
    (engine as any).runPipelineLoop = async () => {};
    const first = await engine.start({ topic: 'First episode' }, () => {});
    const one = (await engine.getState(first))!;
    const storageOne = engine.getDiskStorageManager(first.sessionId);
    fs.writeFileSync(path.join(storageOne.paths.voiceDir, 'old.mp3'), 'first voice');
    const protectedFile = path.join(storageOne.paths.scriptDir, 'protected.json');
    fs.writeFileSync(protectedFile, 'last good version');
    const rename = fs.renameSync;
    const copy = fs.copyFileSync;
    try {
      fs.renameSync = (() => { throw Object.assign(new Error('synthetic locked target'), { code: 'EPERM' }); }) as any;
      fs.copyFileSync = (() => { throw new Error('synthetic copy failure'); }) as any;
      assert.throws(() => storageOne.writeAtomic(protectedFile, 'new version'), /locked target/);
      assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'last good version');
    } finally { fs.renameSync = rename; fs.copyFileSync = copy; }
    const second = await engine.start({ topic: 'Second episode' }, () => {});
    const two = (await engine.getState(second))!;
    const storageTwo = engine.getDiskStorageManager(second.sessionId);
    assert.notEqual(one.workspaceDir, two.workspaceDir);
    assert.notEqual(storageOne.paths.mediaDir, storageTwo.paths.mediaDir);
    assert.notEqual(storageOne.paths.voiceDir, storageTwo.paths.voiceDir);
    assert.equal(fs.readFileSync(path.join(storageOne.paths.voiceDir, 'old.mp3'), 'utf8'), 'first voice');
    await new Promise(resolve => setTimeout(resolve, 40));
    const restarted = new AiStudioPipelineEngine();
    assert.equal((await restarted.getState(first))!.sessionId, first.sessionId);
    assert.equal((await restarted.getState(second))!.sessionId, second.sessionId);
    const interrupted = { ...one, status: 'running' as const, currentStage: 3 as const, stages: { ...one.stages, 3: { status: 'running' as const, stageName: 'Voice' } } };
    engine.persistSessionStateAtomic(interrupted);
    const recovered = await new AiStudioPipelineEngine().getState(first);
    assert.equal(recovered!.status, 'failed');
    assert.match(recovered!.stages[3].error!, /gián đoạn/);
    await assert.rejects(() => restarted.getState({ sessionId: '../outside' }), /ID session/);
    const badParent = path.join(root, 'not-a-directory'); fs.writeFileSync(badParent, 'file');
    assert.throws(() => engine.persistSessionStateAtomic({ ...one, sessionId: 'write-error', workspaceDir: badParent }), /ENOTDIR|EEXIST/);
    // A project-level legacy checkpoint from another episode must not be returned for this ID.
    const config = getDecryptedAiStudioConfig();
    config.savedProjects![0].lastSessionId = 'legacy-one';
    config.savedProjects![0].savedSession = { ...one, sessionId: 'legacy-one', workspaceDir: undefined };
    updateAiStudioConfig({ savedProjects: config.savedProjects });
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'session.json'), JSON.stringify({ ...two, sessionId: 'legacy-two' }));
    const legacy = await new AiStudioPipelineEngine().getState({ sessionId: 'legacy-one' });
    assert.equal(legacy!.sessionId, 'legacy-one');
    assert.throws(() => engine.getSessionAssetsDir('legacy-one', output), /SESSION_DIRECTORY_CONFLICT/);
    console.log('PASS: same-project episode workspaces, retained audio, restart identity, traversal rejection, write failures and legacy wrong-ID checkpoint guard');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
