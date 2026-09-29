/**
 * EMPIRICAL ADVERSARIAL STRESS TEST SUITE: PHASE 1 REMEDIATION
 * Challenger M1-1 (critic, specialist)
 *
 * Scope:
 * 1. main/lib/processTree.ts (killProcessTree, killProcessTreeByPid):
 *    - Non-existent PIDs, already-dead processes, negative/zero/NaN/boundary PIDs
 *    - Deep process tree termination on Windows (multi-level hierarchy)
 *    - High-concurrency call flooding (250 concurrent calls)
 * 2. main/render/exportRunner.ts & dubbingRunner.ts:
 *    - cancel() edge cases (invalid taskId, finished tasks, concurrent cancels)
 *    - F-EXP-02 Task Resurrection Prevention under real execution & race conditions
 *    - Partial output deletion on disk
 *    - State persistence: verify whether task status correctly transitions to 'cancelled'
 *      or gets stranded in 'exporting' (The Stranded Task Bug)
 * 3. main/ocr/paddleEngine.ts & main/audio/vocalSeparation.ts:
 *    - Process tree kill on shouldStop()
 *    - CancelledError rejection
 *    - Demucs cancellation MUST NOT run fallback FFmpeg DSP separation
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execSync, type ChildProcess } from 'child_process';

// -------------------------------------------------------------
// 0. Module Interception & Test Isolation Setup
// -------------------------------------------------------------
const testStoreDir = path.join(os.tmpdir(), `vanhsub_challenger_m1_test_${Date.now()}`);
fs.mkdirSync(testStoreDir, { recursive: true });
process.env.VANHSUB_TASKS_DIR = testStoreDir;

// Mock electron if not running inside electron app
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === 'electron') {
    return {
      app: {
        isPackaged: false,
        getAppPath: () => process.cwd(),
      },
    };
  }
  return origRequire.apply(this, arguments);
};

// Target imports
import { killProcessTree, killProcessTreeByPid } from '../main/lib/processTree';
import { TaskStore } from '../main/store/taskStore';
import { ExportRunner } from '../main/render/exportRunner';
import { DubbingRunner } from '../main/render/dubbingRunner';
import { isCancelledError, CancelledError } from '../main/lib/cancel';
import { separateVocals } from '../main/audio/vocalSeparation';

// -------------------------------------------------------------
// Helper Types & Utilities
// -------------------------------------------------------------
interface TestCaseResult {
  suite: string;
  name: string;
  passed: boolean;
  durationMs: number;
  details?: string;
  error?: string;
}

const results: TestCaseResult[] = [];

async function runTest(
  suite: string,
  name: string,
  fn: () => Promise<void> | void
): Promise<boolean> {
  const start = Date.now();
  process.stdout.write(`[RUNNING] [${suite}] ${name}... `);
  try {
    await fn();
    const duration = Date.now() - start;
    console.log(`PASSED (${duration}ms)`);
    results.push({ suite, name, passed: true, durationMs: duration });
    return true;
  } catch (err: any) {
    const duration = Date.now() - start;
    console.log(`FAILED (${duration}ms)`);
    console.error(`  -> Error: ${err.message || err}`);
    if (err.stack) {
      console.error(`  -> Stack: ${err.stack.split('\n').slice(1, 4).join('\n')}`);
    }
    results.push({
      suite,
      name,
      passed: false,
      durationMs: duration,
      error: err.message || String(err),
    });
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      const out = execSync(`powershell -NoProfile -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue"`, {
        windowsHide: true,
        encoding: 'utf-8',
      });
      return out.trim().length > 0;
    } else {
      process.kill(pid, 0);
      return true;
    }
  } catch {
    return false;
  }
}

function createDummyVideo(outPath: string, durationSec = 3): void {
  const cmd = `ffmpeg -f lavfi -i testsrc=duration=${durationSec}:size=320x240:rate=25 -f lavfi -i sine=frequency=1000:duration=${durationSec} -c:v libx264 -preset ultrafast -c:a aac -y "${outPath}"`;
  execSync(cmd, { stdio: 'ignore', windowsHide: true });
}

function createDummySrt(outPath: string): void {
  const content = `1
00:00:00,100 --> 00:00:01,500
Xin chào thế giới phụ đề

2
00:00:01,600 --> 00:00:02,800
Đây là bài kiểm tra độ trễ và huỷ tiến trình
`;
  fs.writeFileSync(outPath, content, 'utf-8');
}

// -------------------------------------------------------------
// MAIN TEST RUNNER
// -------------------------------------------------------------
async function runAllStressTests() {
  console.log('===============================================================');
  console.log('  CHALLENGER M1-1: ADVERSARIAL STRESS TEST SUITE (PHASE 1)    ');
  console.log('===============================================================');
  console.log(`OS: ${process.platform} | Node: ${process.version} | Isolated Dir: ${testStoreDir}\n`);

  // Dynamically load paddleEngine
  const { runPaddleOcr } = await import('../main/ocr/paddleEngine');

  // ===========================================================
  // SUITE 1: processTree.ts Stress & Edge-Case Battery
  // ===========================================================
  console.log('--- SUITE 1: processTree.ts Stress & Edge Cases ---');

  await runTest('processTree', 'killProcessTreeByPid with non-existent PID (99999999)', async () => {
    killProcessTreeByPid(99999999);
    await sleep(200);
  });

  await runTest('processTree', 'killProcessTreeByPid boundary PIDs (0, negative, NaN, Infinity)', async () => {
    killProcessTreeByPid(0);
    killProcessTreeByPid(-1);
    killProcessTreeByPid(-99999);
    killProcessTreeByPid(NaN as any);
    killProcessTreeByPid(Infinity as any);
    killProcessTreeByPid(-Infinity as any);
    killProcessTreeByPid(null as any);
    killProcessTreeByPid(undefined as any);
    killProcessTreeByPid('not-a-pid' as any);
    await sleep(100);
  });

  await runTest('processTree', 'killProcessTree with already-dead process', async () => {
    const deadChild = spawn('cmd.exe', ['/c', 'exit 0'], { windowsHide: true });
    await new Promise<void>((resolve) => deadChild.on('close', () => resolve()));
    const deadPid = deadChild.pid!;

    killProcessTreeByPid(deadPid);
    killProcessTree(deadChild);
    await sleep(150);
  });

  await runTest('processTree', 'killProcessTree with malformed ChildProcess inputs', async () => {
    killProcessTree(null as any);
    killProcessTree(undefined as any);
    killProcessTree({} as any);
    killProcessTree({ pid: 0 } as any);
    killProcessTree({ pid: -1 } as any);
    killProcessTree({
      pid: undefined,
      kill: () => {
        throw new Error('Explosion inside kill()');
      },
    } as any);
  });

  await runTest('processTree', 'Deep process tree termination on Windows (multi-level hierarchy)', async () => {
    if (process.platform !== 'win32') {
      console.log('Skipping Windows-specific process tree test on non-win32');
      return;
    }

    const root = spawn(
      'cmd.exe',
      ['/c', 'ping -n 30 127.0.0.1 >nul'],
      { windowsHide: true }
    );

    const rootPid = root.pid!;
    if (!rootPid) throw new Error('Failed to obtain root PID');

    await sleep(400);

    const queryCmd = `powershell -NoProfile -Command "(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${rootPid} }).ProcessId"`;
    const descendantOutput = execSync(queryCmd, {
      encoding: 'utf-8',
      windowsHide: true,
    }).trim();

    const descendantPids = descendantOutput
      .split(/\r?\n/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);

    console.log(`    (Root PID: ${rootPid}, Discovered Child PIDs: [${descendantPids.join(', ')}])`);
    if (descendantPids.length === 0) {
      throw new Error(`Child process failed to spawn under root PID ${rootPid}`);
    }

    for (const dPid of descendantPids) {
      if (!isPidAlive(dPid)) {
        throw new Error(`Child PID ${dPid} is not alive prior to killProcessTree`);
      }
    }

    killProcessTree(root);
    await sleep(800);

    const rootAlive = isPidAlive(rootPid);
    if (rootAlive) {
      throw new Error(`Root PID ${rootPid} survived killProcessTree!`);
    }

    for (const dPid of descendantPids) {
      const dAlive = isPidAlive(dPid);
      if (dAlive) {
        throw new Error(`Descendant PID ${dPid} survived taskkill /T /F! Orphan detected.`);
      }
    }
  });

  await runTest('processTree', 'High-concurrency call flooding (250 concurrent calls)', async () => {
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 250; i++) {
      const fakePid = 900000 + i;
      promises.push(
        new Promise<void>((resolve) => {
          killProcessTreeByPid(fakePid);
          resolve();
        })
      );
    }
    await Promise.all(promises);
    await sleep(300);
  });

  // ===========================================================
  // SUITE 2: ExportRunner & DubbingRunner Stress & Anti-Resurrection
  // ===========================================================
  console.log('\n--- SUITE 2: ExportRunner & DubbingRunner Cancellation & F-EXP-02 ---');

  await runTest('ExportRunner', 'cancel() with non-existent taskId returns false without throw', () => {
    const res = ExportRunner.cancel('fake-non-existent-task-id');
    if (res !== false) throw new Error(`Expected false, got ${res}`);
  });

  await runTest('DubbingRunner', 'cancel() with non-existent taskId returns false without throw', () => {
    const res = DubbingRunner.cancel('fake-non-existent-task-id');
    if (res !== false) throw new Error(`Expected false, got ${res}`);
  });

  await runTest('ExportRunner', 'cancel() with already finished task returns false', () => {
    const task = TaskStore.create({
      fileName: 'dummy.mp4',
      filePath: 'C:\\dummy.mp4',
      workflow: 'fast-transcribe',
      status: 'done',
    });
    const res = ExportRunner.cancel(task.id);
    if (res !== false) throw new Error(`Expected false for inactive task, got ${res}`);
  });

  // Test 2.4a: Mid-flight cancellation (FFmpeg actively encoding long video when cancelled)
  await runTest('ExportRunner', 'F-EXP-02 Hardsub Mid-flight Cancellation & SIGKILL Cleanup', async () => {
    const testDir = path.join(testStoreDir, 'export_midflight_test');
    fs.mkdirSync(testDir, { recursive: true });
    const videoPath = path.join(testDir, 'source_long.mp4');
    const srtPath = path.join(testDir, 'sub_long.srt');

    createDummyVideo(videoPath, 10);
    createDummySrt(srtPath);

    const task = TaskStore.create({
      fileName: 'source_long.mp4',
      filePath: videoPath,
      srtPath: srtPath,
      workflow: 'bilingual-sub',
      status: 'queued',
    });

    const exportPromise = ExportRunner.runExport(task.id, 'hardsub');

    let attempts = 0;
    while (!ExportRunner.isRunning(task.id) && attempts < 30) {
      await sleep(50);
      attempts++;
    }

    if (!ExportRunner.isRunning(task.id)) {
      throw new Error('ExportRunner did not enter running state in time');
    }

    await sleep(200);
    const cancelRes = ExportRunner.cancel(task.id);
    if (!cancelRes) throw new Error('cancel() returned false on running task');

    await exportPromise;

    const storeTask = TaskStore.getById(task.id);
    if (!storeTask) throw new Error('Task disappeared from TaskStore');

    if (storeTask.status !== 'cancelled') {
      throw new Error(`Expected status 'cancelled', got '${storeTask.status}'`);
    }

    if (storeTask.outputPath && fs.existsSync(storeTask.outputPath)) {
      throw new Error(`Dangling partial output file was NOT cleaned up: ${storeTask.outputPath}`);
    }
  });

  // Test 2.4b: Empirical Verification of the Stranded Task Bug (Guard without status update)
  await runTest('ExportRunner', 'Empirical Challenge: Cancellation at line 234/296 guard must update TaskStore to "cancelled"', async () => {
    const testDir = path.join(testStoreDir, 'export_guard_test');
    fs.mkdirSync(testDir, { recursive: true });
    const videoPath = path.join(testDir, 'source_guard.mp4');
    const srtPath = path.join(testDir, 'sub_guard.srt');

    createDummyVideo(videoPath, 2);
    createDummySrt(srtPath);

    const task = TaskStore.create({
      fileName: 'source_guard.mp4',
      filePath: videoPath,
      srtPath: srtPath,
      workflow: 'bilingual-sub',
      status: 'queued',
    });

    // Start export
    const exportPromise = ExportRunner.runExport(task.id, 'hardsub');

    // Wait until running
    while (!ExportRunner.isRunning(task.id)) {
      await sleep(20);
    }

    // Cancel while running
    ExportRunner.cancel(task.id);

    await exportPromise;

    const storeTask = TaskStore.getById(task.id);
    if (!storeTask) throw new Error('Task missing from TaskStore');

    console.log(`    (Observed final TaskStore status: '${storeTask.status}')`);

    // CHALLENGER ASSERTION:
    // When a user cancels, the task in TaskStore MUST be 'cancelled'.
    // If it is 'exporting', the task is stranded and broken!
    // If it is 'done', it was resurrected!
    if (storeTask.status === 'exporting') {
      throw new Error(
        `VULNERABILITY CONFIRMED: Task was stranded in status 'exporting'! ExportRunner.runExport guard (lines 234/296) returns currentTask without calling TaskStore.update({ status: 'cancelled' }).`
      );
    }
    if (storeTask.status === 'done') {
      throw new Error(`RESURRECTION CONFIRMED: Task was resurrected to 'done' despite ExportRunner.cancel()!`);
    }
    if (storeTask.status !== 'cancelled') {
      throw new Error(`Expected 'cancelled', but got: ${storeTask.status}`);
    }
  });

  await runTest('ExportRunner', 'Re-entrancy after cancellation (clean state recovery)', async () => {
    const testDir = path.join(testStoreDir, 'export_reentry_test');
    fs.mkdirSync(testDir, { recursive: true });
    const videoPath = path.join(testDir, 'source2.mp4');
    const srtPath = path.join(testDir, 'sub2.srt');

    createDummyVideo(videoPath, 1);
    createDummySrt(srtPath);

    const task = TaskStore.create({
      fileName: 'source2.mp4',
      filePath: videoPath,
      srtPath: srtPath,
      workflow: 'bilingual-sub',
      status: 'queued',
    });

    const completedTask = await ExportRunner.runExport(task.id, 'hardsub');
    if (!completedTask || completedTask.status !== 'done') {
      throw new Error(`Expected normal export to complete with 'done', got '${completedTask?.status}'`);
    }
    if (!completedTask.outputPath || !fs.existsSync(completedTask.outputPath)) {
      throw new Error('Completed export did not generate valid output file');
    }
  });

  await runTest('DubbingRunner', 'F-EXP-02 Dubbing Cancellation & Task Resurrection Prevention', async () => {
    const testDir = path.join(testStoreDir, 'dubbing_cancel_test');
    fs.mkdirSync(testDir, { recursive: true });
    const videoPath = path.join(testDir, 'source.mp4');
    const srtPath = path.join(testDir, 'sub.srt');
    const ttsAudioDir = path.join(testDir, 'tts_audio');
    fs.mkdirSync(ttsAudioDir, { recursive: true });

    createDummyVideo(videoPath, 4);
    createDummySrt(srtPath);

    const task = TaskStore.create({
      fileName: 'source.mp4',
      filePath: videoPath,
      srtPath: srtPath,
      ttsAudioDir: ttsAudioDir,
      workflow: 'full-dubbing',
      status: 'queued',
    });

    const dubPromise = DubbingRunner.runDubbing(task.id, true);

    let attempts = 0;
    while (!DubbingRunner.isRunning(task.id) && attempts < 20) {
      await sleep(50);
      attempts++;
    }

    if (!DubbingRunner.isRunning(task.id)) {
      throw new Error('DubbingRunner did not enter running state in time');
    }

    await sleep(250);

    const cancelRes = DubbingRunner.cancel(task.id);
    if (!cancelRes) throw new Error('DubbingRunner.cancel() returned false');

    await dubPromise;

    const storeTask = TaskStore.getById(task.id);
    if (!storeTask) throw new Error('Task disappeared from TaskStore');

    if (storeTask.status !== 'cancelled') {
      throw new Error(`DUBBING RESURRECTION DETECTED: Expected 'cancelled', got '${storeTask.status}'`);
    }

    if (storeTask.outputPath && fs.existsSync(storeTask.outputPath)) {
      throw new Error(`Dangling dubbed file was NOT deleted: ${storeTask.outputPath}`);
    }

    await sleep(1000);
    const postTask = TaskStore.getById(task.id);
    if (postTask?.status !== 'cancelled') {
      throw new Error(`DUBBING DELAYED RESURRECTION DETECTED: Status flipped to '${postTask?.status}'`);
    }
  });

  // ===========================================================
  // SUITE 3: paddleEngine.ts & vocalSeparation.ts Clean Termination
  // ===========================================================
  console.log('\n--- SUITE 3: paddleEngine.ts & vocalSeparation.ts Cancellation ---');

  await runTest('paddleEngine', 'runPaddleOcr shouldStop cancellation clean kill & CancelledError', async () => {
    const testDir = path.join(testStoreDir, 'paddle_test');
    fs.mkdirSync(testDir, { recursive: true });
    const dummyJob = {
      frames: ['frame1.png', 'frame2.png'],
      cropsDir: testDir,
      outPath: path.join(testDir, 'out.jsonl'),
      recLangNames: ['LATIN'],
      detVersion: 'PP-OCRv5',
      recVersion: 'PP-OCRv5',
      modelType: 'server',
      textScore: 0.5,
      videoWidth: 640,
      videoHeight: 360,
      regionOffsetRatio: 0.25,
    };

    let stopped = false;
    setTimeout(() => {
      stopped = true;
    }, 200);

    let caughtError: any = null;
    try {
      await runPaddleOcr(dummyJob, {
        shouldStop: () => stopped,
      });
    } catch (err: any) {
      caughtError = err;
    }

    if (!caughtError) {
      throw new Error('runPaddleOcr did not reject when stopped');
    }

    const isCancelled = isCancelledError(caughtError);
    console.log(`    (Caught error: "${caughtError.message}", isCancelledError: ${isCancelled})`);
    if (!isCancelled && !caughtError.message.includes('Đã huỷ')) {
      throw new Error(`Expected CancelledError ('Đã huỷ bởi người dùng'), got: ${caughtError.message}`);
    }
  });

  await runTest('vocalSeparation', 'separateVocals shouldStop cancellation MUST NOT run fallback', async () => {
    const testDir = path.join(testStoreDir, 'demucs_test');
    fs.mkdirSync(testDir, { recursive: true });
    const audioPath = path.join(testDir, 'dummy.wav');

    createDummyVideo(path.join(testDir, 'dummy.mp4'), 2);
    execSync(`ffmpeg -i "${path.join(testDir, 'dummy.mp4')}" -vn -c:a pcm_s16le -y "${audioPath}"`, {
      stdio: 'ignore',
      windowsHide: true,
    });

    let stopped = false;
    setTimeout(() => {
      stopped = true;
    }, 400);

    let caughtError: any = null;
    try {
      await separateVocals(audioPath, testDir, () => stopped);
    } catch (err: any) {
      caughtError = err;
    }

    if (!caughtError) {
      throw new Error('separateVocals did not reject when cancelled');
    }

    const isCancelled = isCancelledError(caughtError);
    console.log(`    (Caught Demucs error: "${caughtError.message}", isCancelledError: ${isCancelled})`);

    if (!isCancelled && !caughtError.message.includes('Đã huỷ')) {
      throw new Error(`Expected CancelledError, got: ${caughtError.message}`);
    }

    const fallbackNoVocals = path.join(testDir, 'no_vocals.wav');
    if (fs.existsSync(fallbackNoVocals)) {
      throw new Error('CRITICAL BUG: Fallback FFmpeg DSP was executed despite cancellation!');
    }
  });

  // ===========================================================
  // Summary & Report
  // ===========================================================
  console.log('\n===============================================================');
  console.log('                   STRESS TEST EXECUTION SUMMARY               ');
  console.log('===============================================================');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  for (const r of results) {
    const mark = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  ${mark} [${r.suite}] ${r.name} (${r.durationMs}ms)`);
    if (r.error) {
      console.log(`        ERROR: ${r.error}`);
    }
  }

  console.log('---------------------------------------------------------------');
  console.log(`TOTAL: ${total} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('===============================================================\n');

  try {
    fs.rmSync(testStoreDir, { recursive: true, force: true });
  } catch {}

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllStressTests().catch((e) => {
  console.error('FATAL UNCAUGHT ERROR IN TEST HARNESS:', e);
  process.exit(1);
});
