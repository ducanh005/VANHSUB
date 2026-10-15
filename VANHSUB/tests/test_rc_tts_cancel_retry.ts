import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-tts-retry-'));
  process.env.VANHSUB_TASKS_DIR = path.join(root, 'tasks');
  process.env.VANHSUB_SETTINGS_DIR = path.join(root, 'settings');
  const { TaskStore } = await import('../main/store/taskStore');
  const { SettingsStore } = await import('../main/store/settingsStore');
  const { TTSRunner } = await import('../main/render/ttsRunner');
  const { VoiceSampleStore } = await import('../main/store/voiceSampleStore');
  const getPath = VoiceSampleStore.getPath, list = VoiceSampleStore.list;
  // Headless metadata fixture only; HTTP/provider client and audio processing remain real.
  VoiceSampleStore.getPath = () => null; VoiceSampleStore.list = () => [];
  let calls = 0, taskId = '', mode = 'cancel';
  const audio = path.join(root, 'synthetic.mp3');
  execFileSync(ffmpeg.path, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=0.7', '-c:a', 'libmp3lame', audio], { windowsHide: true });
  const bytes = fs.readFileSync(audio);
  const server = http.createServer((request, response) => {
    if (request.url === '/v1/voices') { response.setHeader('Content-Type', 'application/json'); response.end('["alloy"]'); return; }
    calls++;
    if (mode === 'cancel') { TTSRunner.cancel(taskId); request.socket.destroy(); }
    else { response.setHeader('Content-Type', 'audio/mpeg'); response.end(bytes); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    SettingsStore.set('vietTtsEndpoint', `http://127.0.0.1:${(server.address() as any).port}`);
    const subtitle = path.join(root, 'input.srt'); fs.writeFileSync(subtitle, '1\n00:00:00,000 --> 00:00:02,000\nXin chào.\n');
    const task = TaskStore.create({ fileName: 'input.wav', filePath: path.join(root, 'input.wav'), srtPath: subtitle, projectDir: root });
    taskId = task.id;
    TaskStore.update(taskId, { ttsMergedAudioPath: audio });
    const cancelled = await TTSRunner.runTTS(taskId, 'alloy', 1, undefined, undefined, 'viettts');
    assert.equal(cancelled?.status, 'cancelled');
    assert.equal(calls, 1, 'Cancellation must stop retrying a failed synthesis request');
    assert.equal(TaskStore.getById(taskId)?.ttsMergedAudioPath, audio);
    assert.deepEqual(fs.readFileSync(audio), bytes);
    assert.equal(TTSRunner.isRunning(taskId), false);
    mode = 'success';
    const rerun = await TTSRunner.runTTS(taskId, 'alloy', 1, undefined, undefined, 'viettts');
    assert.equal(rerun?.status, 'done', rerun?.errorMessage);
    assert.ok(rerun?.ttsAudioDir && fs.existsSync(rerun.ttsAudioDir));
    assert.equal(calls, 2, 'Rerun synthesizes once, not a duplicate retry job');
    console.log('PASS: actual local HTTP reset after cancellation causes no retry, preserves prior audio, releases runner and permits a successful synthetic-audio rerun');
  } finally {
    VoiceSampleStore.getPath = getPath; VoiceSampleStore.list = list;
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
