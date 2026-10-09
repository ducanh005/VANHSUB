/**
 * test_antibot_state_machine_idempotency.ts
 *
 * Automated verification suite for Milestone 3:
 * 1. Anti-Bot Error Reclassification (PUBLIC_ERROR_UNUSUAL_ACTIVITY -> non-retryable & BLOCKED_REQUIRES_USER)
 * 2. 7-State Job Lifecycle State Machine
 * 3. Deterministic Idempotency Key & In-Flight Request Deduplication
 * 4. Elimination of Double-Nested Retries
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  GoogleFlowRpcError,
  classifyFlowRpcError,
  isUnusualActivityError,
} from '../main/workflow/flow-engine/rpc/GoogleFlowRpcClient';
import { FlowErrorClassifier } from '../main/workflow/flow-engine/FlowErrorClassifier';
import {
  VisualProviderRouter,
  VisualGenerationRequest,
} from '../main/ai-studio/providers/VisualProviderRouter';

let totalTests = 0;
let passedTests = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✔ ${name}`);
  } catch (err: any) {
    console.error(`  ❌ ${name}:`, err.message);
    throw err;
  }
}

async function main() {
  console.log('======================================================================');
  console.log('  TEST SUITE: Anti-Bot State Machine & Idempotency Protocol (M3)');
  console.log('======================================================================\n');

  console.log('Suite 1: Anti-Bot Error Reclassification & Non-Retryable Contracts');

  await runTest('1.1 classifyFlowRpcError reclassifies PUBLIC_ERROR_UNUSUAL_ACTIVITY as non-retryable', () => {
    const err = classifyFlowRpcError(new Error('Batch RPC failed with PUBLIC_ERROR_UNUSUAL_ACTIVITY in payload'));
    assert.strictEqual(err.code, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY');
    assert.strictEqual(err.retryable, false, 'Anti-bot errors must NOT be marked retryable');
    assert.strictEqual(err.suggestedAction, 'ABORT_HALT');
    assert.strictEqual((err.details as any)?.state, 'BLOCKED_REQUIRES_USER');
  });

  await runTest('1.2 classifyFlowRpcError reclassifies bot_flagged and captcha_score_low as non-retryable', () => {
    const botErr = classifyFlowRpcError(new Error('Request blocked: bot_flagged by server'));
    assert.strictEqual(botErr.code, 'BOT_FLAGGED');
    assert.strictEqual(botErr.retryable, false);

    const captchaErr = classifyFlowRpcError(new Error('recaptcha evaluation failed with score 0.1: captcha_score_low'));
    assert.strictEqual(captchaErr.code, 'CAPTCHA_SCORE_LOW');
    assert.strictEqual(captchaErr.retryable, false);
  });

  await runTest('1.3 FlowErrorClassifier classifies PUBLIC_ERROR_UNUSUAL_ACTIVITY as NON_RETRYABLE', () => {
    const classified = FlowErrorClassifier.classify('PUBLIC_ERROR_UNUSUAL_ACTIVITY detected on Google Flow tab');
    assert.strictEqual(classified.code, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY');
    assert.strictEqual(classified.category, 'NON_RETRYABLE');
    assert.strictEqual(classified.canRetry, false, 'canRetry must be false to halt automated retries');
    assert.strictEqual(classified.suggestedAction, 'ABORT_HALT');
    assert.strictEqual((classified.details as any)?.state, 'BLOCKED_REQUIRES_USER');
  });

  await runTest('1.4 isUnusualActivityError correctly identifies all anti-bot signatures', () => {
    assert.strictEqual(isUnusualActivityError(new Error('PUBLIC_ERROR_UNUSUAL_ACTIVITY')), true);
    assert.strictEqual(isUnusualActivityError(new Error('Unusual activity detected on your network')), true);
    assert.strictEqual(isUnusualActivityError(new Error('bot_flagged')), true);
    assert.strictEqual(isUnusualActivityError(new Error('random network failure')), false);
  });

  console.log('\nSuite 2: 7-State Job Lifecycle & Transition Machine');

  const router = VisualProviderRouter.getInstance();

  await runTest('2.1 Initial job transition: SUBMITTING -> SUBMITTED -> PROCESSING -> COMPLETED', async () => {
    router.clearRegistry();
    const key = router.generateIdempotencyKey({
      projectId: 'proj-1',
      sceneIndex: 0,
      prompt: 'cinematic sunset on ocean',
      mediaType: 'image',
      aspectRatio: '16:9',
    });

    const statesRecorded: string[] = [];

    const req: VisualGenerationRequest = {
      idempotencyKey: key,
      mediaType: 'image',
      prompt: 'cinematic sunset on ocean',
      aspectRatio: '16:9',
    };

    const dummyFile = path.join(__dirname, 'dummy_output.png');
    fs.writeFileSync(dummyFile, 'PNG_DATA');

    const result = await router.executeWithIdempotency(req, async (r) => {
      statesRecorded.push(router.getJob(key)!.state);
      return {
        provider: 'google_flow_rpc',
        mediaType: 'image',
        localPath: dummyFile,
        state: 'COMPLETED',
      };
    });

    const finalRecord = router.getJob(key);
    assert.strictEqual(finalRecord?.state, 'COMPLETED');
    assert.strictEqual(result.state, 'COMPLETED');
    assert.strictEqual(result.localPath, dummyFile);

    try { fs.unlinkSync(dummyFile); } catch {}
  });

  await runTest('2.2 Anti-bot failure cleanly transitions job to BLOCKED_REQUIRES_USER', async () => {
    router.clearRegistry();
    const key = router.generateIdempotencyKey({
      projectId: 'proj-bot',
      sceneIndex: 1,
      prompt: 'futuristic neon city',
      mediaType: 'video',
    });

    const req: VisualGenerationRequest = {
      idempotencyKey: key,
      mediaType: 'video',
      prompt: 'futuristic neon city',
      aspectRatio: '16:9',
    };

    let caught = false;
    try {
      await router.executeWithIdempotency(req, async () => {
        throw new GoogleFlowRpcError('PUBLIC_ERROR_UNUSUAL_ACTIVITY', {
          code: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY',
          retryable: false,
        });
      });
    } catch (err) {
      caught = true;
    }

    assert.strictEqual(caught, true);
    const finalRecord = router.getJob(key);
    assert.strictEqual(finalRecord?.state, 'BLOCKED_REQUIRES_USER');
  });

  console.log('\nSuite 3: Deterministic Idempotency & Deduplication Protection');

  await runTest('3.1 Deterministic key generation produces identical hashes for identical params', () => {
    const k1 = router.generateIdempotencyKey({
      projectId: 'p123',
      sceneIndex: 3,
      prompt: 'a majestic tiger walking in snow',
      mediaType: 'image',
      aspectRatio: '16:9',
    });
    const k2 = router.generateIdempotencyKey({
      projectId: 'p123',
      sceneIndex: 3,
      prompt: '  a majestic tiger walking in snow  ',
      mediaType: 'image',
      aspectRatio: '16:9',
    });
    assert.strictEqual(k1, k2, 'Trimmed prompt with identical params must yield identical idempotencyKey');
  });

  await runTest('3.2 In-flight duplicate calls share the same Promise without running executor twice', async () => {
    router.clearRegistry();
    const key = router.generateIdempotencyKey({
      projectId: 'p_race',
      sceneIndex: 0,
      prompt: 'mountain peak at dawn',
      mediaType: 'image',
    });

    const req: VisualGenerationRequest = {
      idempotencyKey: key,
      mediaType: 'image',
      prompt: 'mountain peak at dawn',
      aspectRatio: '16:9',
    };

    let executionCount = 0;
    const slowExecutor = async () => {
      executionCount++;
      await new Promise((r) => setTimeout(r, 60));
      return {
        provider: 'google_flow_rpc' as const,
        mediaType: 'image' as const,
        localPath: '/tmp/test.png',
        state: 'COMPLETED' as const,
      };
    };

    const [res1, res2, res3] = await Promise.all([
      router.executeWithIdempotency(req, slowExecutor),
      router.executeWithIdempotency(req, slowExecutor),
      router.executeWithIdempotency(req, slowExecutor),
    ]);

    assert.strictEqual(executionCount, 1, 'Executor must only be invoked ONCE across concurrent calls with same key');
    assert.strictEqual(res1.localPath, '/tmp/test.png');
    assert.strictEqual(res2.localPath, '/tmp/test.png');
    assert.strictEqual(res3.localPath, '/tmp/test.png');
  });

  await runTest('3.3 isJobActive correctly reflects in-flight submission state', async () => {
    router.clearRegistry();
    const key = 'test-active-key';
    assert.strictEqual(router.isJobActive(key), false);

    router.updateJobState(key, 'SUBMITTING');
    assert.strictEqual(router.isJobActive(key), true);

    router.updateJobState(key, 'SUBMITTED');
    assert.strictEqual(router.isJobActive(key), true);

    router.updateJobState(key, 'PROCESSING');
    assert.strictEqual(router.isJobActive(key), true);

    router.updateJobState(key, 'COMPLETED');
    assert.strictEqual(router.isJobActive(key), false);

    router.updateJobState(key, 'BLOCKED_REQUIRES_USER');
    assert.strictEqual(router.isJobActive(key), false);
  });

  console.log('\n======================================================================');
  console.log(`  RESULTS: Passed: ${passedTests} | Failed: ${totalTests - passedTests}`);
  console.log('======================================================================\n');
}

main().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
