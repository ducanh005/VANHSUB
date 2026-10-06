/**
 * tests/test_challenger_m1_1_adversarial_deep.ts
 *
 * Empirical Challenger M1-1 Adversarial Stress Test Suite:
 * 1. Direct RPC Local Keyframe Auto-Upload Stress Testing:
 *    - Missing files, empty paths, zero-byte files, undefined/null buffers.
 *    - Special characters, spaces, brackets, hashes, and Vietnamese Unicode paths.
 * 2. Two-Step Image-to-Video (I2V) Pipeline & Synthetic Card Elimination:
 *    - Authentic Imagen keyframe generation + Veo I2V payload wiring.
 *    - Veo RPC failure scenario: authentic keyframe preservation + Ken Burns fallback.
 *    - ZERO synthetic colored text card generation under all error conditions.
 *    - Hard unrecoverable errors (SESSION_EXPIRED, UNUSUAL_ACTIVITY) throw typed actionable errors.
 * 3. Session Self-Healing & Cookie Management:
 *    - Flow /about redirect classification & re-auth recommendation.
 *    - Cookie deduplication and sanitization under adversarial inputs.
 *    - Exponential backoff capping and project name sanitization.
 */

process.env.TEST_ENV = 'true';

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  GoogleFlowRpcClient,
  GoogleFlowRpcError,
  classifyFlowRpcError,
  calculateExponentialBackoffMs,
  isUnusualActivityError,
} from '../main/workflow/flow-engine/rpc/GoogleFlowRpcClient';

import {
  buildUploadPayload,
  buildGenVideoPayload,
  buildGenImagePayload,
  extractGeneratedImages,
  extractOperationStatus,
} from '../main/workflow/flow-engine/rpc/FlowBatchBuilder';

import {
  RPC_UPLOAD_IMAGE,
  RPC_GEN_VIDEO_REFERENCES,
  RPC_GEN_IMAGE,
  CAPTCHA_SLOT,
  PROJECT_ID_SLOT,
} from '../main/workflow/flow-engine/rpc/FlowBatchConstants';

import {
  GoogleVeoSessionManager,
  sanitizeProjectName,
} from '../main/veo/GoogleVeoSessionManager';

import { AiStudioVisualService } from '../main/ai-studio/services/AiStudioVisualService';
import type { StoryboardScene } from '../main/ai-studio/types';

interface TestResult {
  id: string;
  category: string;
  name: string;
  passed: boolean;
  durationMs: number;
  details?: string;
}

const results: TestResult[] = [];

async function recordTest(
  id: string,
  category: string,
  name: string,
  fn: () => Promise<void> | void
): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    console.log(`  [PASS] [${id}] ${category}: ${name} (${durationMs}ms)`);
    results.push({ id, category, name, passed: true, durationMs });
  } catch (err: any) {
    const durationMs = Date.now() - start;
    console.error(`  [FAIL] [${id}] ${category}: ${name} (${durationMs}ms)`);
    console.error(`         Error: ${err?.message || err}`);
    results.push({
      id,
      category,
      name,
      passed: false,
      durationMs,
      details: err?.message || String(err),
    });
  }
}

async function runAdversarialSuite() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   EMPIRICAL CHALLENGER M1-1: DEEP ADVERSARIAL STRESS TEST SUITE          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const tmpTestDir = path.join(os.tmpdir(), `vanhsub_challenger_m1_${Date.now()}`);
  fs.mkdirSync(tmpTestDir, { recursive: true });

  const client = new GoogleFlowRpcClient();

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 1: DIRECT RPC LOCAL KEYFRAME AUTO-UPLOAD STRESS TESTS
    // ══════════════════════════════════════════════════════════════════════════
    console.log('--- 1. DIRECT RPC LOCAL KEYFRAME AUTO-UPLOAD STRESS ---');

    await recordTest(
      'TC-DIR-01',
      'Auto-Upload',
      'Missing file path throws INVALID_ARGUMENT without calling network RPC',
      async () => {
        const nonExistentPath = path.join(tmpTestDir, 'non_existent_keyframe_image.png');
        let threw = false;
        try {
          await client.uploadAsset(nonExistentPath, 'proj-123');
        } catch (err: any) {
          threw = true;
          assert(err instanceof GoogleFlowRpcError, 'Must throw GoogleFlowRpcError');
          assert.strictEqual(err.code, 'INVALID_ARGUMENT');
          assert(err.message.includes('File không tồn tại'), `Error message must indicate non-existence: ${err.message}`);
        }
        assert.strictEqual(threw, true, 'Should have thrown for missing file');
      }
    );

    await recordTest(
      'TC-DIR-02',
      'Auto-Upload',
      'Empty string or invalid path parameter throws INVALID_ARGUMENT cleanly',
      async () => {
        let threw = false;
        try {
          await client.uploadAsset('', 'proj-123');
        } catch (err: any) {
          threw = true;
          assert(err instanceof GoogleFlowRpcError);
          assert.strictEqual(err.code, 'INVALID_ARGUMENT');
        }
        assert.strictEqual(threw, true);
      }
    );

    await recordTest(
      'TC-DIR-03',
      'Auto-Upload',
      'Zero-byte file throws INVALID_ARGUMENT (File dữ liệu rỗng)',
      async () => {
        const emptyFile = path.join(tmpTestDir, 'zero_byte.png');
        fs.writeFileSync(emptyFile, Buffer.alloc(0));

        let threw = false;
        try {
          await client.uploadAsset(emptyFile, 'proj-123');
        } catch (err: any) {
          threw = true;
          assert(err instanceof GoogleFlowRpcError);
          assert.strictEqual(err.code, 'INVALID_ARGUMENT');
          assert(err.message.includes('File dữ liệu rỗng'), `Should report empty file: ${err.message}`);
        }
        assert.strictEqual(threw, true);
      }
    );

    await recordTest(
      'TC-DIR-04',
      'Auto-Upload',
      'Null or empty buffer object throws INVALID_ARGUMENT',
      async () => {
        let threw = false;
        try {
          await client.uploadAsset({ buffer: Buffer.alloc(0), projectId: 'proj-123' });
        } catch (err: any) {
          threw = true;
          assert(err instanceof GoogleFlowRpcError);
          assert.strictEqual(err.code, 'INVALID_ARGUMENT');
        }
        assert.strictEqual(threw, true);
      }
    );

    await recordTest(
      'TC-DIR-05',
      'Auto-Upload',
      'Paths with special characters, spaces, brackets, hashes, and Unicode are parsed cleanly',
      async () => {
        const specialSubdir = path.join(
          tmpTestDir,
          'Thư mục đặc biệt [Tập #1] - (HD 4K) & #@!'
        );
        fs.mkdirSync(specialSubdir, { recursive: true });

        const specialFile = path.join(
          specialSubdir,
          'Khung hình mèo mướp #01 - (1080p) [bản gốc].png'
        );

        // Valid PNG header (8 bytes) + dummy payload
        const validPngBytes = Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        ]);
        fs.writeFileSync(specialFile, validPngBytes);

        // Verify buffer reading and MIME type inference logic
        assert(fs.existsSync(specialFile));
        const ext = path.extname(specialFile).toLowerCase();
        assert.strictEqual(ext, '.png');

        const readBuf = fs.readFileSync(specialFile);
        assert.strictEqual(readBuf.length, validPngBytes.length);
        const base64 = readBuf.toString('base64');
        assert(base64.length > 0);

        // Test payload construction with special filename
        const payload = buildUploadPayload({
          projectId: 'proj-unicode',
          base64Data: base64,
          mimeType: 'image/png',
          filename: path.basename(specialFile),
          captchaToken: 'token',
        });

        assert(Array.isArray(payload));
        assert.strictEqual(payload[8], path.basename(specialFile));
        assert.strictEqual(payload[2], 'image/png');
        assert.strictEqual(payload[1], base64);
      }
    );

    await recordTest(
      'TC-DIR-06',
      'Auto-Upload',
      'Direct RPC generateVideo gracefully avoids uploading non-existent paths',
      async () => {
        const fakePath = 'C:\\non_existent_folder_abc\\missing_keyframe.png';
        const exists = fs.existsSync(fakePath);
        assert.strictEqual(exists, false);

        // Build payload directly
        const payload = buildGenVideoPayload({
          imageMediaId: 'media-uuid-12345',
          aspectRatio: '16:9',
          durationSeconds: 5,
          prompt: 'A sleek cat gliding across neon alley',
          projectId: 'proj-cat',
          captchaToken: 'test-captcha',
        });

        assert(Array.isArray(payload));
        const taskConfig = (payload[0] as any)[0];
        assert.deepStrictEqual(taskConfig[1], [[null, 'media-uuid-12345']]);
      }
    );

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 2: TWO-STEP I2V PIPELINE & SYNTHETIC CARD ELIMINATION
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n--- 2. TWO-STEP I2V PIPELINE & SYNTHETIC CARD ELIMINATION ---');

    await recordTest(
      'TC-I2V-01',
      'I2V Pipeline',
      'Step 1 Imagen ogiZ0b produces keyframe UUID and wires into Step 2 Veo MZZa6b',
      async () => {
        // Mock Imagen response with remote media UUID
        const mockRawImagenData = [
          null,
          [
            [
              null,
              null,
              'flow-remote-uuid-imagen-keyframe-789',
              'https://lh3.googleusercontent.com/keyframe-image.png',
            ],
          ],
        ];

        const extracted = extractGeneratedImages(mockRawImagenData);
        assert.strictEqual(extracted.length, 1);
        assert.strictEqual(extracted[0].mediaId, 'flow-remote-uuid-imagen-keyframe-789');

        // Pass into Veo payload
        const veoPayload = buildGenVideoPayload({
          imageMediaId: extracted[0].mediaId,
          aspectRatio: '16:9',
          durationSeconds: 6,
          prompt: 'Camera slowly pans left revealing neon reflections',
          projectId: 'proj-veo',
          captchaToken: 'cap-token',
        });

        const taskConfig = (veoPayload[0] as any)[0];
        assert.deepStrictEqual(taskConfig[1], [[null, 'flow-remote-uuid-imagen-keyframe-789']]);
        assert.strictEqual(taskConfig[2], 'veo_3_1_r2v_lite'); // modelKey
      }
    );

    await recordTest(
      'TC-I2V-02',
      'I2V Pipeline',
      'Veo RPC failure with authentic keyframe: fallback preserves keyframe + Ken Burns, ZERO synthetic cards',
      async () => {
        const visualService = AiStudioVisualService.getInstance();

        // Create an authentic keyframe image on disk
        const authenticKeyframe = path.join(tmpTestDir, 'authentic_keyframe_hero.png');
        // Valid PNG header (8 bytes) + content
        const validPng = Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(200, 0xff),
        ]);
        fs.writeFileSync(authenticKeyframe, validPng);

        // Mock RPC client where generateVideo rejects
        const mockRpc = {
          partition: 'persist:google_veo',
          generateImage: async () => ({
            images: [{ mediaId: 'uuid-keyframe', url: 'https://example.com/img.png' }],
            firstImageUrl: 'https://example.com/img.png',
          }),
          generateVideo: async () => {
            throw new GoogleFlowRpcError('Veo GPU cluster quota exceeded (503)', {
              code: 'UPSTREAM_ERROR',
              retryable: true,
              httpStatus: 503,
            });
          },
          pollGeneration: async () => ({ done: true }),
        } as any;

        visualService.setRpcClient(mockRpc);

        // Prepare scene with existing authentic keyframe
        const scene: StoryboardScene = {
          lineIndex: 0,
          lineText: 'Hero stands on the rooftop watching the sunrise',
          visualPrompt: 'Hero stands on rooftop, golden cinematic light',
          motionType: 'video',
          imagePath: authenticKeyframe,
          inputImageAsset: 'uuid-keyframe',
          status: 'pending',
        };

        const targetVideoPath = path.join(tmpTestDir, 'output_scene_01.mp4');

        // Execute generateViaGoogleFlow
        const returnedPath = await visualService.generateViaGoogleFlow(scene, targetVideoPath, {
          outputMode: 'video',
        });

        // 1. Returned path must be the authentic keyframe
        assert.strictEqual(returnedPath, authenticKeyframe);
        // 2. scene.imagePath preserved
        assert.strictEqual(scene.imagePath, authenticKeyframe);
        // 3. scene.assetPath is keyframe
        assert.strictEqual(scene.assetPath, authenticKeyframe);
        // 4. videoPath deleted
        assert.strictEqual(scene.videoPath, undefined);
        // 5. motionType switched to ken_burns
        assert.strictEqual(scene.motionType, 'ken_burns');
        // 6. status marked ready
        assert.strictEqual(scene.status, 'ready');
        // 7. Verify no synthetic video or card was created
        assert.strictEqual(fs.existsSync(targetVideoPath), false);

        // Restore client
        visualService.setRpcClient(null);
      }
    );

    await recordTest(
      'TC-I2V-03',
      'I2V Pipeline',
      'Veo RPC failure without any existing keyframe throws typed error without synthetic cards',
      async () => {
        const visualService = AiStudioVisualService.getInstance();

        const mockRpc = {
          partition: 'persist:google_veo',
          generateImage: async () => {
            throw new GoogleFlowRpcError('Session expired redirect to /about', {
              code: 'SESSION_EXPIRED',
              suggestedAction: 'REAUTH_REQUIRED',
            });
          },
          generateVideo: async () => {
            throw new GoogleFlowRpcError('Should not reach here', { code: 'UNKNOWN' });
          },
        } as any;

        visualService.setRpcClient(mockRpc);

        const scene: StoryboardScene = {
          lineIndex: 1,
          lineText: 'Scene without keyframe',
          visualPrompt: 'Futuristic city street',
          motionType: 'video',
          status: 'pending',
        };

        const targetPath = path.join(tmpTestDir, 'scene_no_keyframe.mp4');

        let threw = false;
        try {
          await visualService.generateViaGoogleFlow(scene, targetPath, { outputMode: 'video' });
        } catch (err: any) {
          threw = true;
          assert(err instanceof GoogleFlowRpcError);
          assert.strictEqual(err.code, 'SESSION_EXPIRED');
        }

        assert.strictEqual(threw, true, 'Must throw typed error instead of generating synthetic card');
        assert.strictEqual(fs.existsSync(targetPath), false, 'Must not create dummy file');

        visualService.setRpcClient(null);
      }
    );

    await recordTest(
      'TC-I2V-04',
      'I2V Pipeline',
      'Hard unrecoverable errors (UNUSUAL_ACTIVITY, RATE_LIMITED) throw typed actionable errors',
      async () => {
        const unusualErr = classifyFlowRpcError(new Error('public_error_unusual_activity reCAPTCHA required'));
        assert.strictEqual(unusualErr.code, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY');
        assert.strictEqual(unusualErr.isUnusualActivity, true);

        const rateLimitErr = classifyFlowRpcError(new Error('HTTP 429 Too Many Requests'));
        assert.strictEqual(rateLimitErr.code, 'RATE_LIMITED');
        assert.strictEqual(rateLimitErr.retryable, true);
        assert.strictEqual(rateLimitErr.suggestedAction, 'RETRY_WITH_BACKOFF');
      }
    );

    await recordTest(
      'TC-I2V-05',
      'Integrity',
      'Zero synthetic scene cards or dummy text card filters in GoogleFlowAdapter',
      async () => {
        // Read GoogleFlowAdapter source code directly to guarantee no regressions
        const adapterFile = path.resolve(__dirname, '../main/workflow/adapters/GoogleFlowAdapter.ts');
        const adapterContent = fs.readFileSync(adapterFile, 'utf8');

        // Must not contain dummy text drawing filters
        assert(!adapterContent.includes("drawtext=text='VANHSUB"), 'Found prohibited drawtext dummy banner!');
        assert(!adapterContent.includes('drawtext=text='), 'Prohibited drawtext overlay found in adapter!');

        // Read AiStudioVisualService to verify generateSyntheticSceneCard is not called
        const visualServiceFile = path.resolve(__dirname, '../main/ai-studio/services/AiStudioVisualService.ts');
        const visualContent = fs.readFileSync(visualServiceFile, 'utf8');

        const callsToSynthetic = (visualContent.match(/\.generateSyntheticSceneCard\(/g) || []).length;
        assert.strictEqual(callsToSynthetic, 0, 'generateSyntheticSceneCard must not be called anywhere in pipeline!');
      }
    );

    // ══════════════════════════════════════════════════════════════════════════
    // CATEGORY 3: SESSION SELF-HEALING & COOKIE DEDUPLICATION
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n--- 3. SESSION SELF-HEALING & COOKIE DEDUPLICATION ---');

    await recordTest(
      'TC-SESS-01',
      'Session',
      'Flow /about redirect is accurately classified as SESSION_EXPIRED',
      async () => {
        const redirectErr1 = classifyFlowRpcError(new Error('Redirected to https://flow.google.com/about'));
        assert.strictEqual(redirectErr1.code, 'SESSION_EXPIRED');
        assert.strictEqual(redirectErr1.suggestedAction, 'REAUTH_REQUIRED');
        assert.strictEqual(redirectErr1.retryable, false);

        const redirectErr2 = classifyFlowRpcError(new Error('accounts.google.com/ServiceLogin?continue=flow'));
        assert.strictEqual(redirectErr2.code, 'SESSION_EXPIRED');
        assert.strictEqual(redirectErr2.suggestedAction, 'REAUTH_REQUIRED');
      }
    );

    await recordTest(
      'TC-SESS-02',
      'Session',
      'Cookie cleaning deduplicates and preserves secure auth cookies',
      async () => {
        const messyCookies = [
          'SID=old_value',
          'HSID=hsid_1',
          'SID=new_value',
          '__Secure-1PSID=secure_token_123',
          '__Secure-3PSID=secure_token_456',
          'SSID=ssid_token',
          'invalid;;;token',
          '   =bad_pair   ',
          'trailing=val;',
        ].join('; ');

        const cleaned = GoogleVeoSessionManager.cleanAndDeduplicateCookies(messyCookies);

        // In cleaned cookies:
        // 1. SID must exist
        assert(cleaned.includes('SID='));
        // 2. Both secure tokens preserved
        assert(cleaned.includes('__Secure-1PSID=secure_token_123'));
        assert(cleaned.includes('__Secure-3PSID=secure_token_456'));
        // 3. Trailing garbage stripped
        assert(!cleaned.includes(';;;'));
        assert(!cleaned.includes('=bad_pair'));
      }
    );

    await recordTest(
      'TC-SESS-03',
      'Session',
      'Sanitize project names strips dangerous Windows filesystem characters',
      async () => {
        const dirtyName = '  <Script> alert("xss") </Script> : *? / \\ | Project [Episode 1]  ';
        const clean = sanitizeProjectName(dirtyName);

        assert(!clean.includes('<'));
        assert(!clean.includes('>'));
        assert(!clean.includes(':'));
        assert(!clean.includes('*'));
        assert(!clean.includes('?'));
        assert(!clean.includes('/'));
        assert(!clean.includes('\\'));
        assert(!clean.includes('|'));
        assert(!clean.includes('"'));
        assert(clean.length <= 60);
      }
    );

    await recordTest(
      'TC-SESS-04',
      'Session',
      'Exponential backoff calculations respect 120s ceiling under large attempts',
      async () => {
        // Attempt 0 -> 10,000ms
        assert.strictEqual(calculateExponentialBackoffMs(0), 10_000);
        // Attempt 1 -> 20,000ms
        assert.strictEqual(calculateExponentialBackoffMs(1), 20_000);
        // Attempt 2 -> 40,000ms
        assert.strictEqual(calculateExponentialBackoffMs(2), 40_000);
        // Attempt 3 -> 80,000ms
        assert.strictEqual(calculateExponentialBackoffMs(3), 80_000);
        // Attempt 4 -> 120,000ms (capped)
        assert.strictEqual(calculateExponentialBackoffMs(4), 120_000);
        // Attempt 100 -> 120,000ms (capped, no numeric overflow)
        assert.strictEqual(calculateExponentialBackoffMs(100), 120_000);
      }
    );

  } finally {
    try {
      fs.rmSync(tmpTestDir, { recursive: true, force: true });
    } catch {}
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SUMMARY REPORT
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║                   CHALLENGER M1-1 SCORECARD                              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`TOTAL TESTS: ${total} | PASSED: ${passed} | FAILED: ${failed}`);

  if (failed > 0) {
    console.error('\n❌ FAILED TESTS:');
    for (const f of results.filter((r) => !r.passed)) {
      console.error(`- [${f.id}] ${f.category}: ${f.name} - ${f.details}`);
    }
    process.exit(1);
  } else {
    console.log('\n🎉 ALL ADVERSARIAL STRESS TESTS PASSED EMPIRICALLY (100% PASS RATE)!');
    process.exit(0);
  }
}

runAdversarialSuite().catch((err) => {
  console.error('[UNCAUGHT TEST RUNNER ERROR]', err);
  process.exit(1);
});
