/** Offline core suites, each in a child process with isolated stores. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { killProcessTree } from '../main/lib/processTree';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-core-suites-'));
const suites = [
  'test_word_segmenter.ts',
  'test_translator_alignment.ts',
  'test_translation_resilience_and_layout.ts',
  'test_subtitle_sanitizer.ts',
  'test_hybrid_fusion.ts',
  'test_r3_deduplication_engine.ts',
  'test_subtitle_dedup_timestamps.ts',
  'test_adversarial_parity_diarization.ts',
  'test_benchmark_independent_verification.ts',
  'test_r2_visual_wrapping_seamless_tts.ts',
  'test_merged_mp3_and_background_download.ts',
  'test_r4_capcut_mini_export.ts',
  'test_core_flow_regression.ts',
];
const results: { file: string; exitCode: number | null; signal: string | null; seconds: number; logPath: string }[] =
  [];
async function run(file: string): Promise<void> {
  const name = path.basename(file, '.ts'),
    start = Date.now(),
    logPath = path.join(root, `${name}.log`);
  const log = fs.createWriteStream(logPath);
  const child = spawn(process.execPath, [require.resolve('tsx/cli'), path.join('tests', file)], {
    windowsHide: true,
    env: {
      ...process.env,
      VANHSUB_TASKS_DIR: path.join(root, name, 'tasks'),
      VANHSUB_SETTINGS_DIR: path.join(root, name, 'settings'),
    },
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const timer = setTimeout(() => killProcessTree(child), 180000);
  child.on('error', (error) => log.write(String(error)));
  await new Promise<void>((resolve) =>
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      log.end(() => {
        const result = { file, exitCode, signal, seconds: (Date.now() - start) / 1000, logPath };
        results.push(result);
        console.log(`${exitCode === 0 ? 'PASS' : 'FAIL'} ${file} (${result.seconds.toFixed(1)}s)`);
        if (exitCode !== 0) console.error(fs.readFileSync(logPath, 'utf8').slice(-6000));
        resolve();
      });
    })
  );
}
async function worker() {
  while (suites.length) await run(suites.shift()!);
}
async function main() {
  await Promise.all([worker(), worker()]);
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(results, null, 2));
  const passed = results.filter((result) => result.exitCode === 0).length;
  console.log(`Core suites: ${passed}/${results.length} passed. Logs: ${root}`);
  if (passed !== results.length) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
