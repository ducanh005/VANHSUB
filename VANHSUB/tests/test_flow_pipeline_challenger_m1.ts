/**
 * tests/test_flow_pipeline_challenger_m1.ts
 *
 * Empirical Challenger Test Suite for:
 * `scripts/run_sample_flow_pipeline.ts`
 *
 * Evaluates:
 * 1. Preflight check hard timeout precision (<= 8.5s under offline bridge).
 * 2. Active Promise.race guard verification vs arbitrary sleeps.
 * 3. Unhandled rejection prevention on late rejections.
 * 4. Physical media asset verification guards (PNG/MP4 magic bytes, 0-byte, missing).
 * 5. Corrupted / read-only output directory handling.
 * 6. Clean exit codes: exit 0 on success, exit 1 on fatal error.
 * 7. Vulnerability analysis: import-triggered auto-execution due to `|| !process.env.TEST_ENV`.
 * 8. Clean child process termination under SIGINT.
 */

// MUST define TEST_ENV to prevent run_sample_flow_pipeline.ts from auto-running on import
process.env.TEST_ENV = 'true';

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

import {
  performPreflightCheck,
  verifyPhysicalMediaAsset,
  initializeOutputWorkspace,
  runSampleFlowPipeline,
  CYBERPUNK_CAT_STORYBOARD,
} from '../scripts/run_sample_flow_pipeline';
import { GoogleVeoSessionManager } from '../main/veo/GoogleVeoSessionManager';

interface ChallengeResult {
  id: string;
  name: string;
  passed: boolean;
  durationMs: number;
  details: string;
  vulnerability?: string;
}

const results: ChallengeResult[] = [];

async function recordTest(
  id: string,
  name: string,
  fn: () => Promise<void> | void
): Promise<void> {
  const start = Date.now();
  console.log(`\n------------------------------------------------------------`);
  console.log(`[TEST ${id}] ${name}`);
  console.log(`------------------------------------------------------------`);
  try {
    await fn();
    const durationMs = Date.now() - start;
    console.log(`  >>> PASS (${durationMs}ms)`);
    results.push({ id, name, passed: true, durationMs, details: 'OK' });
  } catch (err: any) {
    const durationMs = Date.now() - start;
    console.error(`  >>> FAIL (${durationMs}ms):`, err?.message || err);
    results.push({
      id,
      name,
      passed: false,
      durationMs,
      details: err?.message || String(err),
      vulnerability: err?.stack,
    });
  }
}

async function runAllChallenges() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   EMPIRICAL CHALLENGER: TIMEOUT & RECOVERY STRESS TEST SUITE   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  // ==========================================================================
  // Test 1: Baseline Preflight Execution Time (Real Offline Bridge)
  // ==========================================================================
  await recordTest(
    'TC-01',
    'Real Offline Preflight Timeout Measurement (<= 8.5s)',
    async () => {
      const start = Date.now();
      const preflight = await performPreflightCheck(8000);
      const measuredDuration = Date.now() - start;

      console.log(`  Measured elapsed time: ${measuredDuration}ms (reported: ${preflight.elapsedMs}ms)`);
      console.log(`  Bridge connected: ${preflight.bridgeConnected}`);
      console.log(`  Session valid: ${preflight.sessionValid}`);
      console.log(`  Session status: ${preflight.sessionStatus}`);
      console.log(`  Error detail: ${preflight.errorMessage}`);

      assert.strictEqual(preflight.bridgeConnected, false, 'Bridge should be offline in test environment');
      assert.strictEqual(preflight.sessionValid, false, 'Session should be invalid / unauthenticated');

      // Must complete within <= 8500ms (8000ms ± 500ms jitter)
      assert.ok(
        measuredDuration <= 8500,
        `Preflight execution (${measuredDuration}ms) exceeded 8.5s threshold!`
      );
      assert.ok(
        measuredDuration >= 7000,
        `Preflight execution (${measuredDuration}ms) terminated unexpectedly early (< 7s)!`
      );
    }
  );

  // ==========================================================================
  // Test 2: Active Promise.race Guard Verification (Arbitrary Hung Session)
  // ==========================================================================
  await recordTest(
    'TC-02',
    'Active Promise.race Guard Verification (Hanging Promise at 1500ms and 2500ms)',
    async () => {
      const sessionMgr = GoogleVeoSessionManager.getInstance();
      const originalValidate = sessionMgr.validateSession.bind(sessionMgr);

      try {
        // Force validateSession to hang indefinitely
        (sessionMgr as any).validateSession = () => new Promise(() => {});

        // Test 1500ms timeout
        const start1 = Date.now();
        const res1 = await performPreflightCheck(1500);
        const elapsed1 = Date.now() - start1;

        console.log(`  Subtest 1500ms timeout: actual elapsed = ${elapsed1}ms`);
        assert.ok(
          elapsed1 >= 1400 && elapsed1 <= 1900,
          `1500ms timeout guard fired at ${elapsed1}ms (expected 1400-1900ms)`
        );
        assert.strictEqual(res1.sessionStatus, 'error_or_timeout');
        assert.ok(
          res1.errorMessage?.includes('Quá thời gian') || res1.errorMessage?.includes('Timeout'),
          `Error message should indicate timeout, got: ${res1.errorMessage}`
        );

        // Test 2500ms timeout
        const start2 = Date.now();
        const res2 = await performPreflightCheck(2500);
        const elapsed2 = Date.now() - start2;

        console.log(`  Subtest 2500ms timeout: actual elapsed = ${elapsed2}ms`);
        assert.ok(
          elapsed2 >= 2400 && elapsed2 <= 2900,
          `2500ms timeout guard fired at ${elapsed2}ms (expected 2400-2900ms)`
        );
        assert.strictEqual(res2.sessionStatus, 'error_or_timeout');
      } finally {
        (sessionMgr as any).validateSession = originalValidate;
      }
    }
  );

  // ==========================================================================
  // Test 3: Unhandled Rejection Prevention on Late Rejection
  // ==========================================================================
  await recordTest(
    'TC-03',
    'Unhandled Rejection Prevention on Late Rejection',
    async () => {
      let unhandledCount = 0;
      const unhandledErrors: any[] = [];
      const handler = (reason: any) => {
        unhandledCount++;
        unhandledErrors.push(reason);
      };
      process.on('unhandledRejection', handler);

      const sessionMgr = GoogleVeoSessionManager.getInstance();
      const originalValidate = sessionMgr.validateSession.bind(sessionMgr);

      try {
        // Late rejecting promise (rejects at 800ms, while timeout is 300ms)
        (sessionMgr as any).validateSession = () =>
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error('LATE_REJECTION_FROM_NETWORK_STREAM'));
            }, 800);
          });

        const preflight = await performPreflightCheck(300);
        assert.strictEqual(preflight.sessionStatus, 'error_or_timeout');

        // Wait 1000ms for the late rejection to occur
        await new Promise((r) => setTimeout(r, 1000));

        assert.strictEqual(
          unhandledCount,
          0,
          `Detected ${unhandledCount} unhandled rejections! Errors: ${unhandledErrors.map((e) => e?.message)}`
        );
        console.log('  Confirmed: 0 unhandled rejections occurred after timeout settlement.');
      } finally {
        (sessionMgr as any).validateSession = originalValidate;
        process.removeListener('unhandledRejection', handler);
      }
    }
  );

  // ==========================================================================
  // Test 4: Physical Media Asset Verification Guards (Negative Testing)
  // ==========================================================================
  await recordTest(
    'TC-04',
    'Physical Media Asset Verification (Magic Bytes & 0-Byte Detection)',
    async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_challenger_test_'));

      try {
        // 1. Missing file
        const missingFile = path.join(tempDir, 'non_existent.png');
        assert.throws(
          () => verifyPhysicalMediaAsset(missingFile, 'image', 'scene_01', 'Hook'),
          /Tệp không tồn tại/
        );
        console.log('  ✓ Missing file correctly rejected.');

        // 2. Zero-byte file
        const zeroByteFile = path.join(tempDir, 'empty.png');
        fs.writeFileSync(zeroByteFile, Buffer.alloc(0));
        assert.throws(
          () => verifyPhysicalMediaAsset(zeroByteFile, 'image', 'scene_01', 'Hook'),
          /Tệp rỗng/
        );
        console.log('  ✓ Zero-byte file correctly rejected.');

        // 3. Corrupted PNG (invalid magic bytes)
        const fakePng = path.join(tempDir, 'corrupted.png');
        fs.writeFileSync(fakePng, Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]));
        assert.throws(
          () => verifyPhysicalMediaAsset(fakePng, 'image', 'scene_01', 'Hook'),
          /Tệp không đúng định dạng PNG/
        );
        console.log('  ✓ Corrupted PNG header correctly rejected.');

        // 4. Corrupted MP4 (missing ftyp/moov/mdat)
        const fakeMp4 = path.join(tempDir, 'corrupted.mp4');
        fs.writeFileSync(fakeMp4, Buffer.from('RIFF....WAVEfmt ')); // AVI/WAV header
        assert.throws(
          () => verifyPhysicalMediaAsset(fakeMp4, 'video', 'scene_02', 'Action'),
          /Tệp không đúng định dạng MP4/
        );
        console.log('  ✓ Non-MP4 header correctly rejected.');

        // 5. Valid PNG magic bytes
        const validPng = path.join(tempDir, 'valid.png');
        fs.writeFileSync(validPng, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        const verifiedPng = verifyPhysicalMediaAsset(validPng, 'image', 'scene_01', 'Hook');
        assert.strictEqual(verifiedPng.magicBytesValid, true);
        assert.strictEqual(verifiedPng.magicBytesHex, '89504E470D0A1A0A');
        console.log('  ✓ Valid PNG verified successfully.');

        // 6. Valid MP4 header with ftyp
        const validMp4 = path.join(tempDir, 'valid.mp4');
        const mp4Header = Buffer.alloc(32);
        mp4Header.writeUInt32BE(32, 0);
        mp4Header.write('ftypmp42', 4, 'ascii');
        fs.writeFileSync(validMp4, mp4Header);
        const verifiedMp4 = verifyPhysicalMediaAsset(validMp4, 'video', 'scene_02', 'Action');
        assert.strictEqual(verifiedMp4.magicBytesValid, true);
        console.log('  ✓ Valid MP4 ftyp box verified successfully.');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  );

  // ==========================================================================
  // Test 5: Corrupted / Read-Only Output Directory Handling
  // ==========================================================================
  await recordTest(
    'TC-05',
    'Corrupted / Read-Only Output Directory Handling',
    async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_corrupt_test_'));
      const blockingFile = path.join(tempDir, 'blocking_file');
      fs.writeFileSync(blockingFile, 'i_am_a_file_not_a_directory');

      // Attempting to treat a file as a directory causes ENOTDIR / EEXIST
      const invalidDirPath = path.join(blockingFile, 'child_sub_dir');

      let failedAsExpected = false;
      try {
        await runSampleFlowPipeline({ outputDir: invalidDirPath });
      } catch (err: any) {
        failedAsExpected = true;
        console.log(`  ✓ Pipeline rejected corrupted output directory: ${err.message}`);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }

      assert.strictEqual(
        failedAsExpected,
        true,
        'runSampleFlowPipeline should throw when given a corrupted/invalid directory'
      );
    }
  );

  // ==========================================================================
  // Test 6: CLI Runner Clean Exit Code (0 on success, 1 on failure)
  // ==========================================================================
  await recordTest(
    'TC-06',
    'CLI Runner Exit Codes (0 on Success, 1 on Fatal Error)',
    async () => {
      // Subtest 6A: Child process with fatal error path -> Must exit with code 1
      const scriptPath = path.resolve(__dirname, '../scripts/run_sample_flow_pipeline.ts');
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_exit_test_'));
      const conflictFile = path.join(tempDir, 'conflict.txt');
      fs.writeFileSync(conflictFile, 'blocking');
      const badPath = path.join(conflictFile, 'nested');

      const codeError = await new Promise<number>((resolve) => {
        const child = spawn(
          'npx.cmd',
          ['tsx', '-e', `import { runSampleFlowPipeline } from './scripts/run_sample_flow_pipeline'; runSampleFlowPipeline({ outputDir: ${JSON.stringify(badPath)} }).then(() => process.exit(0)).catch(() => process.exit(1));`],
          { cwd: path.resolve(__dirname, '..'), stdio: 'ignore', shell: true }
        );
        child.on('close', (code) => resolve(code ?? -1));
      });

      console.log(`  Subtest 6A (Fatal directory error): exit code = ${codeError}`);
      assert.strictEqual(codeError, 1, `Fatal error should result in exit code 1, got ${codeError}`);

      // Subtest 6B: Direct run of run_sample_flow_pipeline.ts -> Must exit with code 0
      console.log('  Subtest 6B: Executing run_sample_flow_pipeline.ts end-to-end...');
      const codeSuccess = await new Promise<number>((resolve) => {
        const child = spawn(
          'npx.cmd',
          ['tsx', 'scripts/run_sample_flow_pipeline.ts'],
          { cwd: path.resolve(__dirname, '..'), stdio: 'ignore', shell: true }
        );
        child.on('close', (code) => resolve(code ?? -1));
      });

      console.log(`  Subtest 6B (Normal execution): exit code = ${codeSuccess}`);
      assert.strictEqual(codeSuccess, 0, `Successful run should exit with code 0, got ${codeSuccess}`);

      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  );

  // ==========================================================================
  // Test 7: Vulnerability Investigation - Import Auto-Execution Bug
  // ==========================================================================
  await recordTest(
    'TC-07',
    'Vulnerability Analysis: Module Import Side-Effect Condition in run_sample_flow_pipeline.ts',
    async () => {
      /**
       * In scripts/run_sample_flow_pipeline.ts line 669:
       * if (isDirectRun || !process.env.TEST_ENV) {
       *
       * Notice: When another module imports run_sample_flow_pipeline without setting TEST_ENV:
       * isDirectRun is FALSE, but !process.env.TEST_ENV is TRUE.
       * Because of the `||` operator, the entire pipeline executes on import and calls process.exit(0)!
       *
       * We empirically verify this behavior by running a node process that imports it without TEST_ENV.
       */
      const startTime = Date.now();
      const exitCode = await new Promise<number>((resolve) => {
        const child = spawn(
          'npx.cmd',
          ['tsx', 'tests/test_import_leak.ts'],
          { cwd: path.resolve(__dirname, '..'), env: { ...process.env, TEST_ENV: '' }, stdio: 'ignore', shell: true }
        );
        child.on('close', (code) => resolve(code ?? -1));
      });
      const duration = Date.now() - startTime;

      console.log(`  Import without TEST_ENV took ${duration}ms and exited with code ${exitCode}.`);
      assert.strictEqual(exitCode, 0);
      assert.ok(
        duration >= 7000,
        `Process took ${duration}ms, proving that importing the module unexpectedly executed the full preflight/pipeline!`
      );
      console.log('  ⚠️ VULNERABILITY CONFIRMED: Line 669 `isDirectRun || !process.env.TEST_ENV` triggers auto-execution on ANY import unless TEST_ENV is explicitly provided.');
    }
  );

  // ==========================================================================
  // Test 8: Process Termination under SIGINT
  // ==========================================================================
  await recordTest(
    'TC-08',
    'Process Termination under SIGINT',
    async () => {
      const child = spawn(
        'npx.cmd',
        ['tsx', 'scripts/run_sample_flow_pipeline.ts'],
        { cwd: path.resolve(__dirname, '..'), stdio: 'ignore', shell: true }
      );

      // Let it boot for 1.5 seconds into the preflight check
      await new Promise((r) => setTimeout(r, 1500));

      const startTime = Date.now();
      // Send SIGINT / kill
      child.kill('SIGINT');

      const exitCodeOrSignal = await new Promise<string>((resolve) => {
        child.on('exit', (code, signal) => resolve(`code=${code},signal=${signal}`));
        // Failsafe timeout
        setTimeout(() => resolve('timeout'), 5000);
      });

      const terminationTime = Date.now() - startTime;
      console.log(`  SIGINT termination result: ${exitCodeOrSignal} in ${terminationTime}ms`);
      assert.notStrictEqual(exitCodeOrSignal, 'timeout', 'Child process failed to terminate under SIGINT within 5s');
    }
  );

  // ==========================================================================
  // Summary & Scorecard
  // ==========================================================================
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                   CHALLENGER SCORECARD                         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  for (const r of results) {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${status}] ${r.id}: ${r.name} (${r.durationMs}ms)`);
    if (!r.passed) {
      console.log(`       Error: ${r.details}`);
    }
  }

  const allPassed = results.every((r) => r.passed);
  console.log(`\nOVERALL RESULT: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  process.exit(allPassed ? 0 : 1);
}

runAllChallenges().catch((err) => {
  console.error('Test suite runner crashed:', err);
  process.exit(1);
});
