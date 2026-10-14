import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeDubbingPreferences } from '../main/lib/dubbingPreferences';

async function main() {
  assert.deepEqual(normalizeDubbingPreferences(), {
    replaceAudio: true, syncMode: 'strict', mixOriginalAudio: false, vocalSeparation: false,
  });
  const separated = normalizeDubbingPreferences({ mixOriginalAudio: true, vocalSeparation: true, syncMode: 'video-stretch' });
  assert.equal(separated.vocalSeparation, true);
  assert.equal(separated.mixOriginalAudio, false, 'Do not mix the original dialogue back into separated BGM');
  assert.equal(separated.syncMode, 'video-stretch');
  const bilingual = normalizeDubbingPreferences({ replaceAudio: false, mixOriginalAudio: true, vocalSeparation: true });
  assert.equal(bilingual.mixOriginalAudio, false);
  assert.equal(bilingual.vocalSeparation, false, 'Bilingual mode keeps original and TTS as separate tracks');
  assert.equal(normalizeDubbingPreferences({ syncMode: 'flexible' }).syncMode, 'strict');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-dub-preferences-'));
  process.env.VANHSUB_SETTINGS_DIR = path.join(dir, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(dir, 'tasks');
  try {
    const { TaskStore } = await import('../main/store/taskStore');
    const task = TaskStore.create({ fileName: 'source.mp4', filePath: path.join(dir, 'source.mp4'), dubbingPreferences: separated,
      dubbedVideoPath: 'old.mp4', dubbedVideoStretchFactor: 1.2 });
    assert.deepEqual(TaskStore.getById(task.id)?.dubbingPreferences, separated, 'All tabs receive one saved configuration');
    TaskStore.update(task.id, { dubbingPreferences: bilingual, dubbedVideoPath: undefined });
    assert.deepEqual(TaskStore.getById(task.id)?.dubbingPreferences, bilingual);
    assert.equal(TaskStore.getById(task.id)?.dubbedVideoStretchFactor, undefined, 'Changing preferences invalidates the old dub');
    console.log('PASS: shared dubbing preferences, conflicting mix/separation flags, legacy sync mode and persisted configuration');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
