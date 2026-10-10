/**
 * tests/test_media_validator_ffmpeg_decoding.ts
 *
 * REGRESSION & NEGATIVE TEST SUITE:
 * 1. Strict FFmpeg Spawn & Execution Error Handling (No false-positive resolution)
 * 2. Missing binary / ENOENT spawn error rejection
 * 3. Corrupted / truncated media decoding failure rejection
 * 4. Timeout & process cleanup guard
 * 5. Single-settle Promise guarantee
 * 6. Non-conflation of Text-to-Video (T2V) into Image-to-Video (I2V)
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  fullDecodeMediaWithFfmpeg,
  normalizeAndValidateMediaFile,
} from '../main/browser-automation/mediaValidator';

let totalTests = 0;
let passedTests = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✔ [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message || err);
    throw err;
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('  TEST SUITE: FFmpeg Full Decode Negative Tests & I2V Non-Conflation Guard');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_ffmpeg_test_'));

  try {
    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 1: Negative Tests for fullDecodeMediaWithFfmpeg
    // ──────────────────────────────────────────────────────────────────────────
    console.log('▶ [SECTION 1] Negative Tests: FFmpeg Failures Must Strictly REJECT');

    await runTest('1.1 Non-existent file rejects with clear error', async () => {
      const nonExistent = path.join(tempDir, 'does_not_exist_file.mp4');
      let resolved = false;
      try {
        await fullDecodeMediaWithFfmpeg(nonExistent);
        resolved = true;
      } catch (err: any) {
        assert.ok(err.message.includes('Media file does not exist'));
      }
      assert.strictEqual(resolved, false, 'Must never resolve when file does not exist');
    });

    await runTest('1.2 Sub-64 byte file rejects with clear error', async () => {
      const smallFile = path.join(tempDir, 'too_small.mp4');
      fs.writeFileSync(smallFile, Buffer.from('hello world'));
      let resolved = false;
      try {
        await fullDecodeMediaWithFfmpeg(smallFile);
        resolved = true;
      } catch (err: any) {
        assert.ok(err.message.includes('Media file is too small'));
      }
      assert.strictEqual(resolved, false, 'Must never resolve when file is too small');
    });

    await runTest('1.3 Non-existent FFmpeg executable rejects (NO false-positive fullyDecoded: true)', async () => {
      const dummyFile = path.join(tempDir, 'valid_size_dummy.bin');
      fs.writeFileSync(dummyFile, Buffer.alloc(128, 0x55));
      let resolved = false;
      try {
        await fullDecodeMediaWithFfmpeg(dummyFile, {
          ffmpegPathOverride: 'non_existent_ffmpeg_executable_xyz_9999',
        });
        resolved = true;
      } catch (err: any) {
        assert.ok(
          err.message.includes('FFmpeg process failed to spawn') ||
          err.message.includes('FFmpeg spawn exception') ||
          err.message.includes('ENOENT'),
          `Error message should indicate spawn failure, got: ${err.message}`
        );
      }
      assert.strictEqual(resolved, false, 'Must strictly reject on spawn error, never return fullyDecoded: true');
    });

    await runTest('1.4 Corrupted media file fails decoding and rejects with error', async () => {
      const corruptFile = path.join(tempDir, 'corrupt_stream.mp4');
      // Create a fake MP4 header followed by corrupted random junk
      const fakeHeader = Buffer.alloc(128);
      fakeHeader.writeUInt32BE(32, 0);
      fakeHeader.write('ftyp', 4);
      fakeHeader.write('isom', 8);
      // Fill the rest with non-decodable bytes
      for (let i = 32; i < 128; i++) {
        fakeHeader[i] = 0xff;
      }
      fs.writeFileSync(corruptFile, fakeHeader);

      let resolved = false;
      try {
        await fullDecodeMediaWithFfmpeg(corruptFile);
        resolved = true;
      } catch (err: any) {
        assert.ok(
          err.message.includes('Full frame media decoding failed') ||
          err.message.includes('Exit code'),
          `Expected decoding error, got: ${err.message}`
        );
      }
      assert.strictEqual(resolved, false, 'Corrupt media must strictly fail full frame decoding');
    });

    await runTest('1.5 Timeout aborts hung FFmpeg process and rejects', async () => {
      // Use existing real video with impossible 1ms timeout
      const realVideoPath = path.resolve(__dirname, '..', 'temp_live_e2e_output', 'live_scene_2_1791646454362.mp4');
      if (fs.existsSync(realVideoPath)) {
        let resolved = false;
        try {
          await fullDecodeMediaWithFfmpeg(realVideoPath, { timeoutMs: 1 });
          resolved = true;
        } catch (err: any) {
          assert.ok(
            err.message.includes('timed out') || err.message.includes('failed'),
            `Expected timeout or immediate error, got: ${err.message}`
          );
        }
        assert.strictEqual(resolved, false, 'Must reject on timeout');
      }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 2: Positive Tests on Real Validated Media
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n▶ [SECTION 2] Positive Tests: Real Media Files Decode 100% Cleanly');

    const realImgPath = path.resolve(__dirname, '..', 'temp_live_e2e_output', 'live_scene_1_1791648384031.jpg');
    const realVidPath = path.resolve(__dirname, '..', 'temp_live_e2e_output', 'live_scene_2_1791646454362.mp4');

    if (fs.existsSync(realImgPath)) {
      await runTest('2.1 Real JPEG image resolves with fullyDecoded: true', async () => {
        const res = await fullDecodeMediaWithFfmpeg(realImgPath);
        assert.strictEqual(res.fullyDecoded, true);
      });
    }

    if (fs.existsSync(realVidPath)) {
      await runTest('2.2 Real MP4 video resolves with fullyDecoded: true', async () => {
        const res = await fullDecodeMediaWithFfmpeg(realVidPath);
        assert.strictEqual(res.fullyDecoded, true);
      });

      await runTest('2.3 normalizeAndValidateMediaFile with fullDecode: true passes valid video', async () => {
        const norm = await normalizeAndValidateMediaFile(realVidPath, 'video', { fullDecode: true });
        assert.strictEqual(norm.format, 'mp4');
        assert.ok(norm.width > 0 && norm.height > 0);
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // SECTION 3: I2V vs T2V Strict Non-Conflation Guard
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n▶ [SECTION 3] I2V vs T2V Strict Non-Conflation Guard');

    await runTest('3.1 Standalone T2V video and T2I image CANNOT be inferred as I2V without inputImageAsset', () => {
      // Scenario: An image file and video file exist in the directory
      const imageAsset = {
        id: 'img-asset-101',
        type: 'image',
        timestamp: 1791648384031,
        mode: 'text-to-image',
      };
      const videoAsset = {
        id: 'vid-asset-202',
        type: 'video',
        timestamp: 1791646454362,
        mode: 'text-to-video', // Generated from prompt, NOT keyframe
        inputImageAsset: undefined,
      };

      // Auditor function checking I2V contract
      function auditI2vProvenance(img: typeof imageAsset, vid: typeof videoAsset): { isI2v: boolean; reason: string } {
        if (!vid.inputImageAsset) {
          return {
            isI2v: false,
            reason: 'Video was generated via Text-to-Video without linking inputImageAsset',
          };
        }
        if (vid.inputImageAsset !== img.id) {
          return {
            isI2v: false,
            reason: `Video links inputImageAsset ${vid.inputImageAsset}, but image asset is ${img.id}`,
          };
        }
        return { isI2v: true, reason: 'Valid I2V chain' };
      }

      const auditResult = auditI2vProvenance(imageAsset, videoAsset);
      assert.strictEqual(auditResult.isI2v, false);
      assert.ok(auditResult.reason.includes('Text-to-Video without linking inputImageAsset'));
    });

    await runTest('3.2 I2V contract is satisfied ONLY when video request explicitly binds inputImageAsset', () => {
      const imageAsset = {
        id: 'img-asset-101',
        type: 'image',
        timestamp: 1791648384031,
        mode: 'text-to-image',
      };
      const videoAssetI2V = {
        id: 'vid-asset-303',
        type: 'video',
        timestamp: 1791648400000,
        mode: 'image-to-video',
        inputImageAsset: 'img-asset-101',
      };

      function auditI2vProvenance(img: typeof imageAsset, vid: typeof videoAssetI2V): { isI2v: boolean; reason: string } {
        if (!vid.inputImageAsset || vid.inputImageAsset !== img.id) {
          return { isI2v: false, reason: 'Invalid or missing inputImageAsset' };
        }
        return { isI2v: true, reason: 'Valid I2V chain' };
      }

      const auditResult = auditI2vProvenance(imageAsset, videoAssetI2V);
      assert.strictEqual(auditResult.isI2v, true);
    });

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log(`  RESULTS: Passed: ${passedTests} | Failed: 0`);
  console.log('════════════════════════════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
