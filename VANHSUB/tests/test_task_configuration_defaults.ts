import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { engineForVoice, resolveTtsEngine } from '../main/lib/ttsConfig';

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-defaults-'));
  process.env.VANHSUB_SETTINGS_DIR = path.join(dir, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(dir, 'tasks');
  try {
    const { SettingsStore } = await import('../main/store/settingsStore');
    const { TaskStore } = await import('../main/store/taskStore');
    assert.equal(SettingsStore.get('ttsVoice'), 'vi-VN-HoaiMyNeural');
    SettingsStore.set('asrModel', 'large-v3');
    SettingsStore.set('asrEngine', 'whisper-cpp');
    SettingsStore.set('enableDiarization', true);
    SettingsStore.set('ttsVoice', 'vi-VN-NamMinhNeural');
    SettingsStore.set('ttsSpeed', 1.25);
    const first = TaskStore.create({ fileName: 'first.mp4', filePath: path.join(dir, 'first.mp4') });
    assert.equal(first.asrModel, 'large-v3');
    assert.equal(first.asrEngine, 'whisper-cpp');
    assert.equal(first.enableDiarization, true);
    assert.equal(first.ttsVoice, 'vi-VN-NamMinhNeural');
    assert.equal(first.ttsEngine, 'edge');
    assert.equal(first.ttsSpeed, 1.25);
    SettingsStore.set('ttsVoice', 'BV074_streaming');
    SettingsStore.set('asrModel', 'small');
    const second = TaskStore.create({ fileName: 'second.mp4', filePath: path.join(dir, 'second.mp4') });
    assert.equal(second.ttsEngine, 'tiktok');
    assert.equal(second.asrModel, 'small');
    assert.equal(TaskStore.getById(first.id)?.ttsEngine, 'edge', 'Existing task retains its chosen settings');
    const explicit = TaskStore.create({ fileName: 'explicit.mp4', filePath: path.join(dir, 'explicit.mp4'),
      asrModel: 'base', asrEngine: 'faster-whisper', enableDiarization: false, speakerCount: 3,
      ttsVoice: 'vi-VN-HoaiMyNeural', ttsSpeed: 0.9 });
    assert.equal(explicit.asrModel, 'base');
    assert.equal(explicit.asrEngine, 'faster-whisper');
    assert.equal(explicit.enableDiarization, false);
    assert.equal(explicit.speakerCount, 3);
    assert.equal(explicit.ttsEngine, 'edge');
    assert.equal(explicit.ttsSpeed, 0.9);
    assert.equal(engineForVoice('BV075_streaming'), 'tiktok');
    assert.equal(resolveTtsEngine('vi-VN-NamMinhNeural', 'tiktok'), 'edge');
    assert.equal(resolveTtsEngine('BV074_streaming', 'edge'), 'tiktok');
    assert.equal(resolveTtsEngine('sample', 'viettts'), 'viettts');
    assert.equal(resolveTtsEngine('BV074_streaming', 'tiktok', 'edge'), 'edge');
    console.log('PASS: default ASR/TTS configuration, explicit overrides, stable existing tasks and consistent provider selection');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
