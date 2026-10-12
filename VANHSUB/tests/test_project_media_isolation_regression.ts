import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-owner-integration-'));
  process.env.VANHSUB_AI_STUDIO_DIR = path.join(root, 'store');
  process.env.VANHSUB_SETTINGS_DIR = path.join(root, 'settings');
  try {
    const { AiStudioPipelineEngine, resolveAiStudioSessionsRoot } = await import('../main/ai-studio/AiStudioPipelineEngine');
    const { updateAiStudioConfig } = await import('../main/store/aiStudioStore');
    const aDir = path.join(root, 'A'), bDir = path.join(root, 'B');
    updateAiStudioConfig({ activeProjectId: 'B', savedProjects: [
      { id: 'A', name: 'A', outputDir: aDir, channelProfile: {}, updatedAt: 1 },
      { id: 'B', name: 'B', outputDir: bDir, channelProfile: {}, updatedAt: 1 },
    ] } as any);
    const makeSession = (id: string, owner: string, dir: string): any => ({
      sessionId: id, ownerProjectId: owner, workspaceDir: dir, mediaDir: path.join(dir, '05_media'),
      topic: id, outputDir: dir, status: 'awaiting_approval', currentStage: 6, stageName: 'visuals', progress: 75,
      createdAt: 1, updatedAt: 1, stages: {}, artifacts: { scenes: [{ id: 'scene_01_shot_1',
        lineIndex: 0, startMs: 0, endMs: 1000, durationMs: 1000, lineText: id, visualPrompt: id,
        motionType: 'ken_burns', status: 'pending' }] },
    });
    const engine = new AiStudioPipelineEngine();
    const a = makeSession('session_A', 'A', aDir), b = makeSession('session_B', 'B', bDir);
    engine.persistSessionStateAtomic(a); engine.persistSessionStateAtomic(b);
    const imageA = path.join(root, 'a.png'), imageB = path.join(root, 'b.png');
    execFileSync(ffmpeg.path, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=64x64', '-frames:v', '1', imageA], { windowsHide: true });
    execFileSync(ffmpeg.path, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=64x64', '-frames:v', '1', imageB], { windowsHide: true });
    const checkpointB = fs.readFileSync(path.join(bDir, 'session.json'), 'utf8');
    const importedA = await engine.importSceneMedia({ sessionId: a.sessionId, sceneId: 'scene_01_shot_1', filePath: imageA, mediaType: 'image' });
    assert.equal(importedA.success, true, importedA.error);
    assert.ok(importedA.assetPath.startsWith(aDir + path.sep));
    assert.equal(fs.readFileSync(path.join(bDir, 'session.json'), 'utf8'), checkpointB);
    const importedB = await engine.importSceneMedia({ sessionId: b.sessionId, sceneId: 'scene_01_shot_1', filePath: imageB, mediaType: 'image' });
    assert.equal(importedB.success, true, importedB.error);
    assert.ok(importedB.assetPath.startsWith(bDir + path.sep));
    assert.deepEqual(fs.readFileSync(importedA.assetPath), fs.readFileSync(imageA));
    assert.deepEqual(fs.readFileSync(importedB.assetPath), fs.readFileSync(imageB));
    const orphan = await engine.importSceneMedia({ sessionId: 'orphan', sceneId: 'scene_01_shot_1', filePath: imageA, mediaType: 'image' });
    assert.equal(orphan.success, false);
    assert.equal(await engine.getState({ sessionId: 'orphan' }), null);
    const beforeConflict = fs.readFileSync(path.join(aDir, 'session.json'), 'utf8');
    fs.writeFileSync(path.join(resolveAiStudioSessionsRoot(), 'ambiguous.json'), JSON.stringify({ ...a, sessionId: 'ambiguous' }));
    assert.throws(() => engine.getDiskStorageManager(a.sessionId), /dùng chung|thuộc phiên/);
    assert.equal(fs.readFileSync(path.join(aDir, 'session.json'), 'utf8'), beforeConflict);
    fs.unlinkSync(path.join(resolveAiStudioSessionsRoot(), 'ambiguous.json'));
    updateAiStudioConfig({ activeProjectId: 'A' });
    assert.equal(engine.getDiskStorageManager(b.sessionId).paths.mediaDir, b.mediaDir);
    const restart = new AiStudioPipelineEngine();
    assert.equal((await restart.getState({ sessionId: a.sessionId }))!.ownerProjectId, 'A');
    assert.equal(restart.getSessionDir(a.sessionId), aDir);
    console.log('PASS: decoded image isolation, inactive project routing, unknown session rejection, ambiguous workspace safety and restart binding');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
