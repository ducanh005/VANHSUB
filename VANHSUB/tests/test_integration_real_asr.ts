// Real local inference using the packaged CLI and an existing public sample/model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const source = path.resolve(__dirname, '..');
  const evidence = path.join(source, 'docs/integration-evidence/2026-10-15');
  const build = JSON.parse(fs.readFileSync(path.join(evidence, 'build-workspace.json'), 'utf8')).path;
  if (!/^codex-integration-build-[a-f0-9]+$/.test(path.basename(build))) throw new Error('Unexpected audit build');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-native-asr-'));
  const originalCwd = process.cwd();
  const cp = require('node:child_process');
  const spawn = cp.spawn;
  const pids: number[] = [];
  const result: any = { classification: 'REAL_RUNTIME_LOCAL_ASR', generationCount: 0, networkModelDownloads: 0, passes: [] };
  const started = Date.now();
  try {
    const model = path.join(source, 'node_modules/nodejs-whisper/cpp/whisper.cpp/models/ggml-tiny.bin');
    const sample = path.join(source, 'node_modules/nodejs-whisper/cpp/whisper.cpp/bindings/go/samples/jfk.wav');
    assert.ok(fs.statSync(model).size > 50000000, 'Existing tiny model required; never auto-download during this test');
    const modelRoot = path.join(build, 'node_modules/nodejs-whisper/cpp/whisper.cpp/models');
    fs.copyFileSync(model, path.join(modelRoot, 'ggml-tiny.bin'));
    const input = path.join(root, 'public-jfk.wav'); fs.copyFileSync(sample, input);
    const cli = path.join(build, 'dist/win-unpacked/resources/whisper/whisper-cli.exe');
    assert.ok(fs.existsSync(cli));
    process.env.VANHSUB_WHISPER_CLI = cli;
    process.env.VANHSUB_TASKS_DIR = path.join(root, 'tasks');
    process.env.VANHSUB_SETTINGS_DIR = path.join(root, 'settings');
    process.env.VANHSUB_AI_STUDIO_DIR = path.join(root, 'studio');
    cp.spawn = (...args: any[]) => { const child = spawn(...args); if (args[0] === cli && child.pid) pids.push(child.pid); return child; };
    process.chdir(build);
    const { TaskStore } = await import('../main/store/taskStore');
    const { TaskRunner } = await import('../main/asr/taskRunner');
    const { parseSrtStrict } = await import('../main/lib/srt');
    const { isCancelledError } = await import('../main/lib/cancel');
    const task = TaskStore.create({ filePath: input, fileName: 'public-jfk.wav', asrModel: 'tiny', asrEngine: 'whisper-cpp' });
    const completed = await TaskRunner.runTask(task.id);
    assert.equal(completed?.status, 'done', completed?.errorMessage);
    const lines = parseSrtStrict(fs.readFileSync(completed!.srtPath!, 'utf8'));
    assert.ok(lines.length > 0);
    assert.match(lines.map(line => line.text).join(' '), /country/i);
    for (let i = 0; i < lines.length; i++) {
      assert.ok(lines[i].endMs > lines[i].startMs);
      if (i) assert.ok(lines[i].startMs >= lines[i - 1].startMs);
    }
    result.subtitleCount = lines.length;
    result.passes.push('Actual TaskRunner extraction and packaged Whisper tiny inference produced ordered speech subtitles');
    const long = path.join(root, 'cancel.wav');
    const ffmpeg = path.join(build, 'dist/win-unpacked/resources/app.asar.unpacked/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
    cp.execFileSync(ffmpeg, ['-v', 'error', '-stream_loop', '-1', '-i', input, '-t', '360', '-ac', '1', '-ar', '16000', long], { windowsHide: true });
    const { transcribe } = await import('../main/asr/whisperEngine');
    const before = pids.length, cancelAt = Date.now() + 1000;
    await assert.rejects(() => transcribe(long, { modelName: 'tiny', modelRootPath: modelRoot, shouldStop: () => Date.now() >= cancelAt }), isCancelledError);
    assert.ok(pids.length > before, 'Cancellation must reach a real native child');
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), 'Native child must exit after completion/cancel');
    result.nativeChildren = pids.length;
    result.passes.push('Cancelled a real native Whisper job; all observed native child PIDs exited');
    result.status = 'PASS';
  } catch (error: any) { result.status = 'FAIL'; result.error = error.stack || String(error); process.exitCode = 1; }
  finally {
    cp.spawn = spawn; process.chdir(originalCwd);
    result.elapsedMs = Date.now() - started;
    fs.writeFileSync(path.join(evidence, 'real-asr.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
