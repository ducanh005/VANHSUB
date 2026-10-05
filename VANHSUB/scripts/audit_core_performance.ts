/** Local microbenchmarks, not an ASR/OCR quality or GPU-throughput benchmark.
 * Run: node node_modules/tsx/dist/cli.mjs scripts/audit_core_performance.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fuseOcrAndWhisper } from '../main/asr/hybridFusionEngine';

async function main() {
  const sizeArg = process.argv.find((arg) => arg.startsWith('--store-size='));
  if (sizeArg) {
    const size = Number(sizeArg.split('=')[1]);
    assert.ok([100, 1000, 5000].includes(size));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-store-bench-'));
    process.env.VANHSUB_TASKS_DIR = root;
    const tasks = Array.from({ length: size }, (_, i) => ({
      id: `task-${i}`, fileName: `clip-${i}.mp4`, filePath: `C:/input/clip-${i}.mp4`,
      workflow: 'fast-transcribe', status: 'done', progress: 100,
      stageDescription: 'Completed', createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z',
    }));
    fs.writeFileSync(path.join(root, 'vanhsub-tasks.json'), JSON.stringify({ tasks }));
    try {
      const { TaskStore, flushTaskStore } = await import('../main/store/taskStore');
      assert.equal(TaskStore.getAll().length, size);
      const start = performance.now();
      for (let i = 0; i < 30; i++) TaskStore.update(`task-${size - 1}`, { progress: i });
      const scheduledMs = performance.now() - start;
      flushTaskStore();
      console.log(JSON.stringify({ benchmark: 'TaskStore.update', tasks: size, updates: 30, scheduledMs: +scheduledMs.toFixed(2), totalMs: +(performance.now() - start).toFixed(2), storeBytes: fs.statSync(path.join(root, 'vanhsub-tasks.json')).size }));
    } finally {
      assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(root).startsWith('vanhsub-store-bench-'));
      fs.rmSync(root, { recursive: true, force: true });
    }
    return;
  }
  for (const size of [100, 1000, 5000]) {
    const result = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/audit_core_performance.ts', `--store-size=${size}`], { windowsHide: true, encoding: 'utf8' });
    process.stdout.write(result);
  }
  // Non-overlapping equal OCR/ASR fixtures isolate the time-window search cost.
  const build = (size: number) => Array.from({ length: size }, (_, i) => ({ id: `line-${i}`, startMs: i * 3000, endMs: i * 3000 + 1000, text: 'Xin chào các bạn.' }));
  fuseOcrAndWhisper(build(100), build(100), { preserveSpeechOnlyWhisper: false });
  for (const size of [500, 1000, 2000, 4000]) {
    const ocr = build(size), asr = build(size);
    const samples: number[] = [];
    for (let repeat = 0; repeat < 3; repeat++) {
      const start = performance.now();
      const result = fuseOcrAndWhisper(ocr, asr, { preserveSpeechOnlyWhisper: false });
      samples.push(performance.now() - start);
      assert.equal(result.segments.length, size);
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ benchmark: 'fuseOcrAndWhisper', segmentsPerStream: size, theoreticalPairChecks: size * size, medianMs: +samples[1].toFixed(2) }));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
