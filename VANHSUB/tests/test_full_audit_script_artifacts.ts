import assert from 'node:assert/strict';
import { applyScriptLines } from '../main/ai-studio/sessionArtifacts';
import ffmpeg from 'fluent-ffmpeg';
import { aiStudioTtsService } from '../main/ai-studio/services/AiStudioTtsService';
const original: any = { id: 'a', index: 0, text: 'Original', audioPath: 'voice.mp3', startMs: 0, endMs: 1000, assetPath: 'old.mp4' };
const session: any = { currentStage: 8, status: 'completed', stages: {}, artifacts: { scriptLines: [original], audioPath: 'merged.mp3', wordsAlignment: [], videoPath: 'final.mp4', scenes: [{ assetPath: 'old.mp4' }] } };
applyScriptLines(session, [{ ...original }]);
assert.equal(session.artifacts.videoPath, 'final.mp4', 'Unchanged content preserves outputs');
assert.throws(() => applyScriptLines(session, [{ ...original, id: '' }]), /ID/);
assert.equal(session.status, 'completed', 'Invalid input does not mutate session');
applyScriptLines(session, [{ ...original, text: 'Revised', audioPath: 'injected.mp3' }]);
assert.equal(session.artifacts.audioPath, undefined);
assert.equal(session.artifacts.videoPath, undefined);
assert.equal(session.artifacts.scenes, undefined);
assert.equal(session.artifacts.scriptLines[0].audioPath, undefined);
assert.equal(session.artifacts.scriptHistory[0].lines[0].audioPath, 'voice.mp3');
assert.equal(session.currentStage, 2);
assert.equal(session.status, 'awaiting_approval');
assert.equal(session.stages[3].status, 'pending');
console.log('PASS: script edits reject invalid input, preserve history and invalidate stale media pointers');
async function testDuration() {
  const original = ffmpeg.ffprobe;
  try {
    for (const duration of [0, -1, undefined, Number.NaN]) {
      (ffmpeg as any).ffprobe = (_path: string, callback: Function) => callback(null, { format: { duration } });
      await assert.rejects(() => aiStudioTtsService.probeMediaDuration('synthetic'), /thời lượng hợp lệ/);
    }
    (ffmpeg as any).ffprobe = (_path: string, callback: Function) => callback(null, { format: { duration: 1.25 } });
    assert.equal(await aiStudioTtsService.probeMediaDuration('synthetic'), 1.25);
    console.log('PASS: invalid TTS duration is rejected rather than replaced with a fictitious five seconds');
  } finally { ffmpeg.ffprobe = original; }
}
testDuration().catch(error => { console.error(error); process.exitCode = 1; });
