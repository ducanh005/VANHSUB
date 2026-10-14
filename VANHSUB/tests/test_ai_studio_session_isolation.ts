import { execFileSync } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-studio-isolation-'));
  process.env.VANHSUB_AI_STUDIO_DIR = path.join(root, 'config');
  process.env.VANHSUB_SETTINGS_DIR = path.join(root, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(root, 'tasks');
  process.env.VANHSUB_BIBLE_DIR = path.join(root, 'bible');
  try {
    const { AiStudioPipelineEngine, resolveAiStudioSessionsRoot } = await import('../main/ai-studio/AiStudioPipelineEngine');
    const { updateAiStudioConfig } = await import('../main/store/aiStudioStore');
    const { DEFAULT_CHANNEL_PROFILE_CONFIG } = await import('../main/ai-studio/types');
    const profile = { ...DEFAULT_CHANNEL_PROFILE_CONFIG, hostName: 'Test', hostDescription: 'Test host', projectBackgroundPrompt: 'Test setting' };
    const out = path.join(root, 'output');
    const mediaRoot = path.join(root, 'external-media');
    updateAiStudioConfig({ activeProjectId: 'A', savedProjects: [
      { id: 'A', name: 'A', channelProfile: profile, outputDir: out, updatedAt: Date.now() },
      { id: 'B', name: 'B', channelProfile: profile, outputDir: out, updatedAt: Date.now() },
    ], channelProfile: { ...profile, customMediaDir: mediaRoot } });
    const engine = new AiStudioPipelineEngine();
    // Exercise the real start/storage path without calling providers in its background loop.
    (engine as any).runPipelineLoop = async () => {};
    const first = await engine.start({ topic: 'Episode one', outputDir: out }, () => {});
    const second = await engine.start({ topic: 'Episode two', outputDir: out }, () => {});
    await new Promise((resolve) => setTimeout(resolve, 40));
    const a = (await engine.getState(first))!;
    const b = (await engine.getState(second))!;
    assert.notEqual(a.workspaceDir, b.workspaceDir);
    assert.notEqual(a.mediaDir, b.mediaDir);
    assert.equal(a.ownerProjectId, 'A');
    assert.equal(a.workspaceDir, path.join(out, 'sessions', a.sessionId));
    assert.equal(a.mediaDir, path.join(mediaRoot, 'sessions', a.sessionId));
    const storageA = engine.getDiskStorageManager(a.sessionId);
    const storageB = engine.getDiskStorageManager(b.sessionId);
    storageA.saveScript({ scenes: [{ scene_id: 'scene_01', narration: 'First', visual_note: 'First image' }] });
    storageB.saveScript({ scenes: [{ scene_id: 'scene_01', narration: 'Second', visual_note: 'Second image' }] });
    fs.writeFileSync(storageA.getVoiceAudioPath('scene_01'), 'first voice');
    fs.writeFileSync(storageB.getVoiceAudioPath('scene_01'), 'second voice');
    assert.equal(storageA.readScript()!.scenes[0].narration, 'First');
    assert.equal(fs.readFileSync(storageA.getVoiceAudioPath('scene_01'), 'utf8'), 'first voice');
    const unchangedSecond = fs.readFileSync(path.join(b.workspaceDir!, 'session.json'), 'utf8');
    updateAiStudioConfig({ activeProjectId: 'B', channelProfile: { customMediaDir: path.join(root, 'wrong-media') } });
    a.topic = 'Updated episode one';
    engine.persistSessionStateAtomic(a);
    assert.equal(fs.readFileSync(path.join(b.workspaceDir!, 'session.json'), 'utf8'), unchangedSecond);
    assert.equal(engine.getDiskStorageManager(a.sessionId).paths.mediaDir, a.mediaDir);
    const manualImage = path.join(root, 'manual.png');
    execFileSync(ffmpegInstaller.path, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=64x64', '-frames:v', '1', manualImage], { windowsHide: true });
    a.artifacts.scenes = [{ id: 'scene_01_shot_1', lineIndex: 0, startMs: 0, endMs: 1000, durationMs: 1000, lineText: 'First', visualPrompt: 'First', motionType: 'ken_burns', status: 'pending' }];
    const imported = await engine.importSceneMedia({ sessionId: a.sessionId, sceneId: 'scene_01_shot_1', filePath: manualImage, mediaType: 'image' });
    assert.equal(imported.success, true, imported.error);
    assert.equal(path.dirname(imported.assetPath), a.mediaDir);
    assert.equal(fs.readFileSync(path.join(b.workspaceDir!, 'session.json'), 'utf8'), unchangedSecond);
    assert.equal(fs.existsSync(path.join(out, 'session.json')), false);
    const restarted = new AiStudioPipelineEngine();
    assert.equal((await restarted.getState(first))!.topic, a.topic);
    assert.equal(restarted.getSessionDir(a.sessionId), a.workspaceDir);
    assert.equal(await restarted.getState({ sessionId: 'missing-session' }), null);
    assert.throws(() => restarted.getSessionDir('../escape'), /không hợp lệ/);

    const catalog = resolveAiStudioSessionsRoot();
    const legacyDir = path.join(root, 'legacy');
    fs.mkdirSync(legacyDir);
    const legacy = { ...a, sessionId: 'legacy-one', outputDir: legacyDir, workspaceDir: undefined, mediaDir: undefined, artifacts: {} };
    fs.writeFileSync(path.join(legacyDir, 'session.json'), JSON.stringify(legacy));
    fs.writeFileSync(path.join(catalog, 'legacy-one.json'), JSON.stringify(legacy));
    const oldEngine = new AiStudioPipelineEngine();
    const loadedOld = (await oldEngine.getState({ sessionId: legacy.sessionId }))!;
    assert.equal(oldEngine.getSessionDir(legacy.sessionId), legacyDir);
    oldEngine.persistSessionStateAtomic(loadedOld);
    assert.equal(JSON.parse(fs.readFileSync(path.join(legacyDir, 'session.json'), 'utf8')).sessionId, legacy.sessionId);

    const conflict = { ...legacy, sessionId: 'legacy-two' };
    fs.writeFileSync(path.join(catalog, 'legacy-two.json'), JSON.stringify(conflict));
    const original = fs.readFileSync(path.join(legacyDir, 'session.json'), 'utf8');
    assert.throws(() => oldEngine.persistSessionStateAtomic(loadedOld), /dùng chung/);
    assert.throws(() => oldEngine.getDiskStorageManager(legacy.sessionId), /dùng chung/);
    assert.throws(() => oldEngine.getSessionAssetsDir(legacy.sessionId), /dùng chung/);
    await assert.rejects(() => oldEngine.regenerateSceneAsset({ sessionId: legacy.sessionId, sceneId: 'scene_01_shot_1', visualPrompt: 'test', flowConfig: { engine: 'dom' } }), /dùng chung/);
    assert.equal(fs.readFileSync(path.join(legacyDir, 'session.json'), 'utf8'), original);
    // Wrong-ID root checkpoint must never be returned as the requested session.
    updateAiStudioConfig({ savedProjects: [{ id: 'legacy-owner', name: 'Legacy', outputDir: legacyDir, lastSessionId: 'wrong-id', channelProfile: profile, updatedAt: Date.now() }] });
    assert.equal(await new AiStudioPipelineEngine().getState({ sessionId: 'wrong-id' }), null);
    // Owner profile can locate a genuine pre-catalog legacy session, even when another project is active.
    fs.unlinkSync(path.join(catalog, 'legacy-one.json'));
    updateAiStudioConfig({ savedProjects: [{ id: 'legacy-owner', name: 'Legacy', outputDir: legacyDir, lastSessionId: 'legacy-one', channelProfile: profile, updatedAt: Date.now() }] });
    assert.equal((await new AiStudioPipelineEngine().getState({ sessionId: 'legacy-one' }))!.workspaceDir, legacyDir);
    const badPath = path.join(root, 'not-a-directory');
    fs.writeFileSync(badPath, 'keep');
    assert.throws(() => engine.persistSessionStateAtomic({ ...a, sessionId: 'cannot-save', workspaceDir: badPath, mediaDir: undefined }));
    const failingEngine = new AiStudioPipelineEngine();
    (failingEngine as any).runPipelineLoop = async () => { throw new Error('provider failed'); };
    const persist = failingEngine.persistSessionStateAtomic.bind(failingEngine);
    let writes = 0;
    failingEngine.persistSessionStateAtomic = (state) => {
      if (++writes > 1) throw new Error('disk unavailable');
      persist(state);
    };
    const events: any[] = [];
    await failingEngine.start({ topic: 'Failure checkpoint', outputDir: out }, (event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(events[0]?.status, 'error', 'Background failures still reach the UI if saving the failure checkpoint also fails');
    console.log('PASS: episode/workspace/media isolation, switch/restart, validated lookup, legacy preservation/conflict guards and failed-write propagation');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
