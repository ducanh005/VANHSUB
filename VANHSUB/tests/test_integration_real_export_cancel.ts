import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

async function main() {
  const evidence = path.resolve('docs/integration-evidence/2026-10-15');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-real-export-cancel-'));
  process.env.VANHSUB_TASKS_DIR = path.join(root, 'tasks');
  process.env.VANHSUB_SETTINGS_DIR = path.join(root, 'settings');
  const result: any = { classification: 'REAL_RUNTIME_LOCAL_FFMPEG_CANCEL', generationCount: 0 };
  const started = Date.now();
  try {
    const { TaskStore } = await import('../main/store/taskStore');
    const { ExportRunner } = await import('../main/render/exportRunner');
    const video = path.join(root, 'video.mp4'), subtitle = path.join(root, 'input.srt'), previous = path.join(root, 'previous.mp4');
    execFileSync(ffmpeg.path, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=128x72:r=25:d=300', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', video], { windowsHide: true });
    fs.writeFileSync(subtitle, '1\n00:00:00,000 --> 00:00:01,000\nSynthetic cancellation fixture.\n');
    fs.writeFileSync(previous, 'last good artifact');
    const task = TaskStore.create({ fileName: 'video.mp4', filePath: video, srtPath: subtitle, projectDir: root });
    TaskStore.update(task.id, { outputPath: previous });
    const running = ExportRunner.runExport(task.id, 'hardsub', null, undefined, null, { formatOptions: { resolution: '1080p' } });
    const deadline = Date.now() + 10000;
    let pid: number | undefined;
    while (!pid && Date.now() < deadline) {
      pid = (ExportRunner as any).runningCommands.get(task.id)?.ffmpegProc?.pid;
      if (!pid) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(pid, 'Must reach an actual FFmpeg worker, not cancel before it starts');
    assert.equal(ExportRunner.cancel(task.id), true);
    const stopped = await running;
    assert.equal(stopped!.status, 'cancelled');
    assert.equal(ExportRunner.isRunning(task.id), false);
    assert.equal((ExportRunner as any).runningCommands.has(task.id), false);
    assert.throws(() => process.kill(pid!, 0));
    assert.equal(fs.readFileSync(previous, 'utf8'), 'last good artifact');
    assert.equal(TaskStore.getById(task.id)!.outputPath, previous);
    assert.equal(fs.readdirSync(root).some(name => name.includes('.hardsub.')), false);
    result.status = 'PASS'; result.nativeWorkerObserved = true; result.nativeWorkerExited = true; result.previousArtifactPreserved = true;
  } catch (error: any) { result.status = 'FAIL'; result.error = error.stack || String(error); process.exitCode = 1; }
  finally {
    result.elapsedMs = Date.now() - started;
    fs.writeFileSync(path.join(evidence, 'real-export-cancel.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
