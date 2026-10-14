import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyScriptLines } from '../main/ai-studio/sessionArtifacts';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-script-invalidation-'));
  process.env.VANHSUB_AI_STUDIO_DIR = path.join(root, 'config');
  try {
    const { AiStudioPipelineEngine } = await import('../main/ai-studio/AiStudioPipelineEngine');
    const engine = new AiStudioPipelineEngine();
    const session: any = {
      sessionId: 'edited-script', topic: 'Test', currentStage: 8, stageName: 'metadata', status: 'completed', progress: 100,
      workspaceDir: path.join(root, 'episode'), mediaDir: path.join(root, 'media'),
      stages: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, { status: 'success', stageName: `Step ${i + 1}` }])),
      artifacts: { scriptLines: [{ id: 'l1', index: 1, text: 'Original text', visualAction: 'Wide landscape', startMs: 0, endMs: 7000, durationMs: 7000, audioPath: 'old-voice.mp3' }],
        audioPath: 'old-combined.mp3', wordsAlignment: [{ word: 'Original', startMs: 0, endMs: 7000 }], scenes: [{ id: 's1' }],
        storyboardSynthesis: { shots: [] }, videoPath: 'old-final.mp4', srtPath: 'old.srt', metadata: { title: 'Old' }, scriptEvaluation: { score: 5 } },
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    engine.persistSessionStateAtomic(session);
    const originalStorage = engine.getDiskStorageManager(session.sessionId);
    const timingFile = path.join(originalStorage.paths.timingDir, 'timing.json');
    fs.writeFileSync(timingFile, '{"old":true}');
    const originalVoice = path.join(originalStorage.paths.voiceDir, 'scene_01.mp3');
    fs.writeFileSync(originalVoice, 'original voice bytes');
    const voiceBefore = structuredClone(session.artifacts.scriptLines);
    const unchanged = structuredClone(session);
    assert.equal(applyScriptLines(session, voiceBefore), false);
    assert.deepEqual(session, unchanged);
    assert.throws(() => applyScriptLines(session, []), /Kịch bản/);
    assert.throws(() => applyScriptLines(session, [voiceBefore[0], voiceBefore[0]]), /Kịch bản/);
    assert.deepEqual(session, unchanged);
    assert.equal(applyScriptLines(session, [{ ...voiceBefore[0], visualAction: 'Close up' }]), true);
    assert.equal(session.currentStage, 4);
    assert.equal(session.artifacts.audioPath, 'old-combined.mp3');
    assert.equal(session.artifacts.scriptLines[0].durationMs, 7000);
    assert.equal(session.productionRevision, undefined);
    assert.equal(session.artifacts.scenes, undefined);
    assert.equal(session.artifacts.storyboardSynthesis, undefined);
    assert.equal(session.artifacts.videoPath, undefined);
    assert.equal(applyScriptLines(session, [{ ...session.artifacts.scriptLines[0], text: 'Changed narration' }]), true);
    assert.equal(session.currentStage, 2);
    assert.equal(session.status, 'awaiting_approval');
    assert.equal(session.productionRevision, 1);
    assert.equal(session.artifacts.audioPath, undefined);
    assert.equal(session.artifacts.wordsAlignment, undefined);
    assert.equal(session.artifacts.scriptLines[0].durationMs, undefined);
    assert.equal(session.artifacts.scriptEvaluation, undefined);
    assert.equal(session.artifacts.metadata, undefined);
    engine.persistSessionStateAtomic(session);
    const fresh = engine.getDiskStorageManager(session.sessionId);
    assert.notEqual(fresh.paths.timingDir, originalStorage.paths.timingDir);
    assert.notEqual(fresh.paths.voiceDir, originalStorage.paths.voiceDir);
    assert.equal(fresh.readTiming(), null);
    assert.equal(fs.readFileSync(timingFile, 'utf8'), '{"old":true}');
    assert.equal(fs.readFileSync(originalVoice, 'utf8'), 'original voice bytes');
    await assert.rejects(() => engine.renderVideo({ sessionId: session.sessionId }), /assets/);
    assert.equal(applyScriptLines(session, voiceBefore), true, 'Undo invalidates current production, never reinstates old audio');
    assert.equal(session.productionRevision, 2);
    assert.equal(session.artifacts.scriptLines[0].audioPath, undefined);
    engine.persistSessionStateAtomic(session);
    (engine as any).runPipelineLoop = async () => {};
    await engine.resume({ sessionId: session.sessionId, fromStage: 3 }, () => {});
    await new Promise(resolve => setTimeout(resolve, 40));
    const resumed = (await engine.getState({ sessionId: session.sessionId }))!;
    assert.equal(resumed.productionRevision, 3);
    assert.equal(fs.readFileSync(originalVoice, 'utf8'), 'original voice bytes');
    assert.ok(engine.getSessionAssetsDir(session.sessionId).includes('rev_3'));
    console.log('PASS: script invalidation, visual-only edit, no-op, rejected edits, undo, fresh caches, retained files and voice resume');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
