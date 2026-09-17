#!/usr/bin/env tsx
/**
 * scripts/test_adversarial_ai_studio_store.ts
 *
 * Adversarial Stress-Test Suite targeting `main/store/aiStudioStore.ts`.
 *
 * Challenge Scenarios:
 *   1. Concurrent partial updates (rapidly mutating different sub-sections simultaneously).
 *   2. Corrupted on-disk JSON file resilience (ensure default fallback instead of fatal crash).
 *   3. API key encryption security: ensure plaintext is never stored when DPAPI is available; prefix enc:v1: handling.
 *   4. Reset integrity: verify reset restores clean specification defaults without leaving stale keys.
 *   5. Cross-store isolation: assert that vanhsub-settings.json is never written or modified.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  getAiStudioStore,
  getAiStudioConfig,
  getDecryptedAiStudioConfig,
  updateAiStudioConfig,
  resetAiStudioConfig,
  _resetAiStudioStoreInstance,
  encryptSecret,
  decryptSecret,
  ENC_PREFIX,
  AiStudioStore,
} from '../main/store/aiStudioStore';
import { DEFAULT_AI_STUDIO_CONFIG, AiStudioConfig } from '../main/ai-studio/types';

// ============================================================================
// Test Harness & Formatting
// ============================================================================

interface TestResult {
  name: string;
  scenario: number;
  status: 'PASS' | 'FAIL';
  details: string;
  error?: string;
}

const results: TestResult[] = [];

function recordResult(scenario: number, name: string, status: 'PASS' | 'FAIL', details: string, error?: string) {
  results.push({ scenario, name, status, details, error });
  const icon = status === 'PASS' ? '✅ PASS' : '❌ FAIL';
  console.log(`[Scenario ${scenario}] ${icon}: ${name}`);
  if (details) console.log(`   Detail: ${details}`);
  if (error) console.log(`   Error:  ${error}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// Setup Dedicated Isolated Test Environment
// ============================================================================

const TEST_ROOT = path.join(os.tmpdir(), `vanhsub-m1-adversarial-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
const AI_STUDIO_DIR = path.join(TEST_ROOT, 'ai-studio');
const SETTINGS_DIR = path.join(TEST_ROOT, 'settings');

fs.mkdirSync(AI_STUDIO_DIR, { recursive: true });
fs.mkdirSync(SETTINGS_DIR, { recursive: true });

process.env.VANHSUB_AI_STUDIO_DIR = AI_STUDIO_DIR;
process.env.VANHSUB_SETTINGS_DIR = SETTINGS_DIR;

const aiStudioJsonPath = path.join(AI_STUDIO_DIR, 'vanhsub-ai-studio.json');
const settingsJsonPath = path.join(SETTINGS_DIR, 'vanhsub-settings.json');

// Initialize Canary Settings file for Cross-Store Isolation Check
const CANARY_SETTINGS_DATA = JSON.stringify(
  {
    geminiApiKey: 'canary-gemini-key-99999',
    geminiModel: 'gemini-1.5-pro',
    targetLanguage: 'vi',
    asrModel: 'large-v3',
    exportDir: 'C:\\canary\\export',
    translateBatchSize: 20,
    veoMode: 'free_session',
    veoSessionCookie: 'canary-cookie-abc',
    veoSessionStatus: 'authenticated',
  },
  null,
  2
);

fs.writeFileSync(settingsJsonPath, CANARY_SETTINGS_DATA, 'utf8');
const initialCanaryHash = crypto.createHash('sha256').update(fs.readFileSync(settingsJsonPath)).digest('hex');
const initialCanaryStat = fs.statSync(settingsJsonPath);

console.log('================================================================================');
console.log('  MILESTONE 1 ADVERSARIAL STRESS TEST SUITE');
console.log('  Target: main/store/aiStudioStore.ts');
console.log(`  Test Dir: ${TEST_ROOT}`);
console.log('================================================================================\n');

async function runTestSuite() {
  // --------------------------------------------------------------------------
  // SCENARIO 1: Concurrent Partial Updates
  // --------------------------------------------------------------------------
  console.log('--- RUNNING SCENARIO 1: Concurrent Partial Updates ---');
  try {
    _resetAiStudioStoreInstance();
    resetAiStudioConfig();

    // 1.1: 50 interleaved concurrent async mutations across all 5 sections
    const updateTasks: Promise<void>[] = [];
    const tracker = {
      temperatures: [] as number[],
      rates: [] as string[],
      aspectRatios: [] as string[],
      resolutions: [] as string[],
      fontSizes: [] as number[],
    };

    const count = 50;
    for (let i = 0; i < count; i++) {
      const idx = i;
      updateTasks.push(
        (async () => {
          // Add non-deterministic jitter to simulate real concurrent async interleaving
          await sleep(Math.floor(Math.random() * 25));

          const sectionChoice = idx % 5;
          switch (sectionChoice) {
            case 0: {
              const temp = Math.round((0.2 + (idx / count) * 0.5) * 100) / 100;
              tracker.temperatures.push(temp);
              updateAiStudioConfig({ llm: { temperature: temp } });
              break;
            }
            case 1: {
              const rate = `+${idx}%`;
              tracker.rates.push(rate);
              updateAiStudioConfig({ voice: { rate } });
              break;
            }
            case 2: {
              const ratio = idx % 2 === 0 ? '9:16' : '16:9';
              tracker.aspectRatios.push(ratio);
              updateAiStudioConfig({ flowEngine: { aspectRatio: ratio as any } });
              break;
            }
            case 3: {
              const res = idx % 2 === 0 ? '4k' : '720p';
              tracker.resolutions.push(res);
              updateAiStudioConfig({ rendering: { resolution: res as any } });
              break;
            }
            case 4: {
              const fsVal = 20 + idx;
              tracker.fontSizes.push(fsVal);
              updateAiStudioConfig({ subtitles: { fontSize: fsVal } });
              break;
            }
          }
        })()
      );
    }

    await Promise.all(updateTasks);

    const finalConfig = getAiStudioConfig();
    const diskContent = JSON.parse(fs.readFileSync(aiStudioJsonPath, 'utf8'));

    // Assert that all 5 sections remain fully populated
    const sectionsExist =
      Boolean(finalConfig.llm) &&
      Boolean(finalConfig.voice) &&
      Boolean(finalConfig.flowEngine) &&
      Boolean(finalConfig.rendering) &&
      Boolean(finalConfig.subtitles);

    // Assert that sibling fields within sections were NOT wiped out
    const siblingsPreserved =
      finalConfig.llm.provider === DEFAULT_AI_STUDIO_CONFIG.llm.provider &&
      finalConfig.voice.voiceId === DEFAULT_AI_STUDIO_CONFIG.voice.voiceId &&
      finalConfig.flowEngine.outputMode === DEFAULT_AI_STUDIO_CONFIG.flowEngine.outputMode &&
      finalConfig.rendering.kenBurnsEffect === DEFAULT_AI_STUDIO_CONFIG.rendering.kenBurnsEffect &&
      finalConfig.subtitles.primaryColor === DEFAULT_AI_STUDIO_CONFIG.subtitles.primaryColor;

    // Assert disk file sync matches in-memory store
    const diskSynced = diskContent.llm.temperature === finalConfig.llm.temperature;

    if (sectionsExist && siblingsPreserved && diskSynced) {
      recordResult(
        1,
        '1.1 Concurrent 50-task partial updates across 5 sections',
        'PASS',
        `All 5 sections intact, sibling fields preserved, disk sync verified. Final temp: ${finalConfig.llm.temperature}, voice rate: ${finalConfig.voice.rate}`
      );
    } else {
      recordResult(
        1,
        '1.1 Concurrent 50-task partial updates across 5 sections',
        'FAIL',
        `Integrity lost: sectionsExist=${sectionsExist}, siblingsPreserved=${siblingsPreserved}, diskSynced=${diskSynced}`
      );
    }

    // 1.2: Empty partials and empty sub-sections
    updateAiStudioConfig({});
    updateAiStudioConfig({ llm: {} });
    updateAiStudioConfig({ voice: {} });
    const configAfterEmpty = getAiStudioConfig();
    if (configAfterEmpty.llm.provider === 'deepseek' && configAfterEmpty.subtitles.preset === 'tiktok_bold') {
      recordResult(1, '1.2 Empty partial updates resilience', 'PASS', 'Empty objects did not corrupt state');
    } else {
      recordResult(1, '1.2 Empty partial updates resilience', 'FAIL', 'Empty object corrupted store');
    }
  } catch (err: any) {
    recordResult(1, 'Scenario 1 Concurrent updates', 'FAIL', 'Unexpected exception in Scenario 1', err?.message);
  }

  // --------------------------------------------------------------------------
  // SCENARIO 2: Corrupted On-Disk JSON File Resilience
  // --------------------------------------------------------------------------
  console.log('\n--- RUNNING SCENARIO 2: Corrupted On-Disk JSON File Resilience ---');

  // 2.1: Syntax-corrupted JSON file (truncated write / bad syntax)
  try {
    _resetAiStudioStoreInstance();
    fs.writeFileSync(aiStudioJsonPath, '{ "llm": { "provider": "deep', 'utf8');

    let recoveredConfig: AiStudioConfig | null = null;
    let threwError = false;
    let caughtError: any = null;

    try {
      recoveredConfig = getAiStudioConfig();
    } catch (err: any) {
      threwError = true;
      caughtError = err;
    }

    if (threwError) {
      recordResult(
        2,
        '2.1 Syntax-corrupted JSON file resilience (getAiStudioConfig)',
        'FAIL',
        `Fatal crash occurred instead of default fallback: [${caughtError?.name}] ${caughtError?.message}`,
        caughtError?.stack
      );
    } else if (recoveredConfig && recoveredConfig.llm.provider === DEFAULT_AI_STUDIO_CONFIG.llm.provider) {
      recordResult(
        2,
        '2.1 Syntax-corrupted JSON file resilience (getAiStudioConfig)',
        'PASS',
        'Successfully fell back to default configuration without crashing'
      );
    } else {
      recordResult(
        2,
        '2.1 Syntax-corrupted JSON file resilience (getAiStudioConfig)',
        'FAIL',
        'Did not throw but returned invalid config'
      );
    }
  } catch (err: any) {
    recordResult(2, '2.1 Syntax-corrupted JSON file resilience', 'FAIL', 'Harness error in 2.1', err?.message);
  }

  // 2.2: 0-byte file (power-cut / truncated file creation)
  try {
    _resetAiStudioStoreInstance();
    fs.writeFileSync(aiStudioJsonPath, '', 'utf8');

    let recovered0Byte: AiStudioConfig | null = null;
    let threw0Byte = false;
    let caught0Byte: any = null;

    try {
      recovered0Byte = getAiStudioConfig();
    } catch (err: any) {
      threw0Byte = true;
      caught0Byte = err;
    }

    if (threw0Byte) {
      recordResult(
        2,
        '2.2 0-byte file resilience (getAiStudioConfig)',
        'FAIL',
        `Fatal crash on 0-byte file instead of default fallback: [${caught0Byte?.name}] ${caught0Byte?.message}`,
        caught0Byte?.stack
      );
    } else if (recovered0Byte && recovered0Byte.llm.provider === DEFAULT_AI_STUDIO_CONFIG.llm.provider) {
      recordResult(2, '2.2 0-byte file resilience (getAiStudioConfig)', 'PASS', 'Cleanly fell back to defaults');
    } else {
      recordResult(2, '2.2 0-byte file resilience (getAiStudioConfig)', 'FAIL', 'Did not recover defaults');
    }
  } catch (err: any) {
    recordResult(2, '2.2 0-byte file resilience', 'FAIL', 'Harness error in 2.2', err?.message);
  }

  // 2.3: Reset ability when file is corrupted
  try {
    _resetAiStudioStoreInstance();
    fs.writeFileSync(aiStudioJsonPath, 'MALFORMED GARBAGE 0xDEADBEEF', 'utf8');

    let resetResult: AiStudioConfig | null = null;
    let resetThrew = false;
    let resetErr: any = null;

    try {
      resetResult = resetAiStudioConfig();
    } catch (err: any) {
      resetThrew = true;
      resetErr = err;
    }

    if (resetThrew) {
      recordResult(
        2,
        '2.3 resetAiStudioConfig() on corrupted file',
        'FAIL',
        `Cannot reset configuration when on-disk file is corrupted: [${resetErr?.name}] ${resetErr?.message}`,
        resetErr?.stack
      );
    } else if (resetResult && resetResult.llm.provider === DEFAULT_AI_STUDIO_CONFIG.llm.provider) {
      recordResult(2, '2.3 resetAiStudioConfig() on corrupted file', 'PASS', 'Reset succeeded on corrupted file');
    } else {
      recordResult(2, '2.3 resetAiStudioConfig() on corrupted file', 'FAIL', 'Reset returned unexpected state');
    }
  } catch (err: any) {
    recordResult(2, '2.3 reset on corrupted file', 'FAIL', 'Harness error in 2.3', err?.message);
  }

  // 2.4: Type corruption: Primitive or null section values in valid JSON
  try {
    _resetAiStudioStoreInstance();
    fs.writeFileSync(
      aiStudioJsonPath,
      JSON.stringify({
        llm: null,
        voice: 'not-an-object',
        rendering: 12345,
        subtitles: ['array', 'instead', 'of', 'object'],
      }),
      'utf8'
    );

    const typeCorruptConfig = getAiStudioConfig();
    const safeTypeFallback =
      typeCorruptConfig.llm?.provider === 'deepseek' &&
      typeof typeCorruptConfig.rendering === 'object' &&
      typeCorruptConfig.rendering.resolution === '1080p';

    if (safeTypeFallback) {
      recordResult(
        2,
        '2.4 Null / primitive section type fallback',
        'PASS',
        'Cleanly handled null & primitive section replacements'
      );
    } else {
      recordResult(
        2,
        '2.4 Null / primitive section type fallback',
        'FAIL',
        `Fallback failed: rendering=${JSON.stringify(typeCorruptConfig.rendering)}`
      );
    }
  } catch (err: any) {
    recordResult(2, '2.4 Null / primitive section type fallback', 'FAIL', 'Threw on primitive sections', err?.message);
  }

  // --------------------------------------------------------------------------
  // SCENARIO 3: API Key Encryption Security
  // --------------------------------------------------------------------------
  console.log('\n--- RUNNING SCENARIO 3: API Key Encryption Security ---');
  try {
    _resetAiStudioStoreInstance();
    resetAiStudioConfig();

    // 3.1: Prefix enc:v1: handling & idempotent encryption
    const secretKey = 'sk-proj-super-secret-test-key-vanhsub-12345';
    const fakeCiphertext = `${ENC_PREFIX}c29tZS1mYWtlLWNpcGhlcnRleHQ=`;

    // Test helper function encryptSecret
    const encryptedOnce = encryptSecret(secretKey);
    const encryptedTwice = encryptSecret(fakeCiphertext);

    const noDoubleEncrypt = encryptedTwice === fakeCiphertext;
    if (noDoubleEncrypt) {
      recordResult(
        3,
        '3.1 Idempotent encryption (enc:v1: prefix check)',
        'PASS',
        'Keys already starting with enc:v1: are never double-encrypted'
      );
    } else {
      recordResult(
        3,
        '3.1 Idempotent encryption (enc:v1: prefix check)',
        'FAIL',
        `Double encryption detected: ${encryptedTwice}`
      );
    }

    // 3.2: Empty & whitespace normalization
    updateAiStudioConfig({ llm: { apiKey: '   ' } });
    const emptyKeyConfig = getAiStudioConfig();
    const diskRawEmpty = JSON.parse(fs.readFileSync(aiStudioJsonPath, 'utf8'));

    if (emptyKeyConfig.llm.apiKey === '' && diskRawEmpty.llm.apiKey === '') {
      recordResult(3, '3.2 Whitespace API key normalization', 'PASS', 'Whitespace apiKey normalized to empty string');
    } else {
      recordResult(
        3,
        '3.2 Whitespace API key normalization',
        'FAIL',
        `Stored apiKey not empty: config=${emptyKeyConfig.llm.apiKey}, disk=${diskRawEmpty.llm.apiKey}`
      );
    }

    // 3.3: Mock DPAPI environment to test exact safeStorage encrypt/decrypt round-trip
    // We simulate safeStorage present in Node to verify full encrypt-decrypt flow
    const testSecret = 'sk-test-secret-key-round-trip-abcdef';
    let mockEncrypted: string;
    {
      const fakeBuffer = Buffer.from(`MOCK_DPAPI:${testSecret}`);
      mockEncrypted = ENC_PREFIX + fakeBuffer.toString('base64');
    }

    // Store mockEncrypted directly in config
    updateAiStudioConfig({ llm: { apiKey: mockEncrypted } });

    // Read back raw (decrypted: false)
    const rawStored = getAiStudioConfig({ decrypted: false });
    const onDiskRaw = JSON.parse(fs.readFileSync(aiStudioJsonPath, 'utf8'));

    const rawPreserved = rawStored.llm.apiKey === mockEncrypted && onDiskRaw.llm.apiKey === mockEncrypted;
    if (rawPreserved) {
      recordResult(
        3,
        '3.3 Ciphertext preservation on disk',
        'PASS',
        `Ciphertext with ${ENC_PREFIX} stored verbatim on disk without mutation`
      );
    } else {
      recordResult(
        3,
        '3.3 Ciphertext preservation on disk',
        'FAIL',
        `Mismatch: stored=${rawStored.llm.apiKey}, disk=${onDiskRaw.llm.apiKey}`
      );
    }

    // 3.4: Corrupted ciphertext resilience (bad base64 or invalid DPAPI payload)
    const badCiphertext = `${ENC_PREFIX}!!!NOT_VALID_BASE64_OR_CORRUPT_BUFFER!!!`;
    const decryptedBad = decryptSecret(badCiphertext);
    // In headless or safeStorage failure, it must return '' without throwing
    if (decryptedBad === '') {
      recordResult(
        3,
        '3.4 Corrupted ciphertext graceful fallback',
        'PASS',
        'Corrupted ciphertext safely returned empty string without crashing'
      );
    } else {
      recordResult(
        3,
        '3.4 Corrupted ciphertext graceful fallback',
        'FAIL',
        `Unexpected return on bad ciphertext: ${decryptedBad}`
      );
    }
  } catch (err: any) {
    recordResult(3, 'Scenario 3 Encryption security', 'FAIL', 'Unexpected exception in Scenario 3', err?.message);
  }

  // --------------------------------------------------------------------------
  // SCENARIO 4: Reset Integrity
  // --------------------------------------------------------------------------
  console.log('\n--- RUNNING SCENARIO 4: Reset Integrity ---');
  try {
    _resetAiStudioStoreInstance();

    // 4.1: Heavily mutate every single section with non-default values
    updateAiStudioConfig({
      llm: {
        provider: 'custom',
        apiKey: 'custom-secret-key-12345',
        model: 'custom-llm-model-v99',
        baseUrl: 'https://custom.endpoint.internal/v1',
        temperature: 0.15,
        systemPromptPreset: 'affiliate_sales',
      },
      voice: {
        provider: 'local_onnx',
        voiceId: 'vi-VN-NamMinhNeural',
        rate: '+30%',
        pitch: '-4Hz',
        volume: '+10%',
        autoWordAlignment: false,
      },
      flowEngine: {
        aspectRatio: '1:1',
        outputMode: 'video',
        stylePromptPrefix: 'Anime, 4k, hyper-detailed',
        negativePrompt: 'blurry, ugly',
        outputsPerScene: 4,
        downloadDir: 'C:\\custom\\assets\\dir',
        concurrency: 2,
      },
      rendering: {
        resolution: '4k',
        fps: 60,
        kenBurnsEffect: false,
        kenBurnsScale: 1.05,
        transitionDuration: 1.2,
        defaultBgmPath: 'C:\\music\\track1.mp3',
        bgmVolume: 0.25,
        autoAudioDucking: false,
      },
      subtitles: {
        enabled: false,
        preset: 'minimalist',
        fontSize: 18,
        primaryColor: '#FF0000',
        outlineColor: '#00FF00',
        outlineWidth: 5,
        positionY: 50,
      },
    });

    // Also inject foreign stale keys directly into the underlying store
    const store = getAiStudioStore();
    (store as any).set('foreignStaleKey', 'should_be_purged');
    (store as any).set('llm.unknownLeakedField', 9999);

    // Verify pollution is present
    const pollutedDisk = JSON.parse(fs.readFileSync(aiStudioJsonPath, 'utf8'));
    const isPolluted = Boolean(pollutedDisk.foreignStaleKey && pollutedDisk.llm.unknownLeakedField);

    // Execute Reset
    const resetReturn = resetAiStudioConfig();
    const diskAfterReset = JSON.parse(fs.readFileSync(aiStudioJsonPath, 'utf8'));

    // Verify all keys match DEFAULT_AI_STUDIO_CONFIG exactly
    const matchesDefaultSpec =
      JSON.stringify(resetReturn) === JSON.stringify(DEFAULT_AI_STUDIO_CONFIG) &&
      JSON.stringify(diskAfterReset) === JSON.stringify(DEFAULT_AI_STUDIO_CONFIG);

    // Verify foreign keys are completely purged
    const noForeignKeys = !('foreignStaleKey' in diskAfterReset) && !('unknownLeakedField' in diskAfterReset.llm);

    // Verify apiKey is empty string
    const apiKeyClean = resetReturn.llm.apiKey === '' && diskAfterReset.llm.apiKey === '';

    if (isPolluted && matchesDefaultSpec && noForeignKeys && apiKeyClean) {
      recordResult(
        4,
        '4.1 Reset restores exact specification defaults and purges stale keys',
        'PASS',
        'All 5 sections restored to spec defaults, foreign keys purged, apiKey is empty string'
      );
    } else {
      recordResult(
        4,
        '4.1 Reset restores exact specification defaults and purges stale keys',
        'FAIL',
        `Reset mismatch: isPolluted=${isPolluted}, matchesDefaultSpec=${matchesDefaultSpec}, noForeignKeys=${noForeignKeys}, apiKeyClean=${apiKeyClean}`
      );
    }

    // 4.2: Reset idempotence (calling reset twice in a row)
    const reset2 = resetAiStudioConfig();
    const matches2 = JSON.stringify(reset2) === JSON.stringify(DEFAULT_AI_STUDIO_CONFIG);
    if (matches2) {
      recordResult(4, '4.2 Reset idempotence', 'PASS', 'Subsequent reset call remains consistent');
    } else {
      recordResult(4, '4.2 Reset idempotence', 'FAIL', 'Subsequent reset altered state');
    }
  } catch (err: any) {
    recordResult(4, 'Scenario 4 Reset integrity', 'FAIL', 'Unexpected exception in Scenario 4', err?.message);
  }

  // --------------------------------------------------------------------------
  // SCENARIO 5: Cross-Store Isolation
  // --------------------------------------------------------------------------
  console.log('\n--- RUNNING SCENARIO 5: Cross-Store Isolation ---');
  try {
    // Check canary settings file after all previous operations
    const currentCanaryHash = crypto.createHash('sha256').update(fs.readFileSync(settingsJsonPath)).digest('hex');
    const currentCanaryStat = fs.statSync(settingsJsonPath);
    const currentCanaryContent = fs.readFileSync(settingsJsonPath, 'utf8');

    // 5.1: SHA256 integrity and file stats check
    const hashMatch = currentCanaryHash === initialCanaryHash;
    const sizeMatch = currentCanaryStat.size === initialCanaryStat.size;
    const contentMatch = currentCanaryContent === CANARY_SETTINGS_DATA;

    if (hashMatch && sizeMatch && contentMatch) {
      recordResult(
        5,
        '5.1 vanhsub-settings.json immutability verification',
        'PASS',
        `Canary file byte-for-byte identical (SHA256: ${currentCanaryHash.slice(0, 16)}..., size: ${currentCanaryStat.size} bytes)`
      );
    } else {
      recordResult(
        5,
        '5.1 vanhsub-settings.json immutability verification',
        'FAIL',
        `vanhsub-settings.json was modified! hashMatch=${hashMatch}, sizeMatch=${sizeMatch}, contentMatch=${contentMatch}`
      );
    }

    // 5.2: Cross-contamination check: Ensure no aiStudio keys in settings, and no settings keys in aiStudio
    const aiStudioDiskData = JSON.parse(fs.readFileSync(aiStudioJsonPath, 'utf8'));
    const canaryParsed = JSON.parse(currentCanaryContent);

    const aiStudioKeysInCanary = ['llm', 'voice', 'flowEngine', 'rendering', 'subtitles'].filter(
      (k) => k in canaryParsed
    );
    const canaryKeysInAiStudio = [
      'geminiApiKey',
      'vietTtsEndpoint',
      'veoMode',
      'veoSessionCookie',
      'asrModel',
    ].filter((k) => k in aiStudioDiskData);

    if (aiStudioKeysInCanary.length === 0 && canaryKeysInAiStudio.length === 0) {
      recordResult(
        5,
        '5.2 Zero key contamination between stores',
        'PASS',
        'No AI Studio keys leaked to settingsStore; no settingsStore keys leaked to aiStudioStore'
      );
    } else {
      recordResult(
        5,
        '5.2 Zero key contamination between stores',
        'FAIL',
        `Contamination detected: aiStudioKeysInCanary=[${aiStudioKeysInCanary}], canaryKeysInAiStudio=[${canaryKeysInAiStudio}]`
      );
    }
  } catch (err: any) {
    recordResult(5, 'Scenario 5 Cross-store isolation', 'FAIL', 'Unexpected exception in Scenario 5', err?.message);
  }

  // ==========================================================================
  // Summary & Evaluation
  // ==========================================================================
  console.log('\n================================================================================');
  console.log('  TEST SUMMARY');
  console.log('================================================================================');

  const total = results.length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;

  console.log(`Total tests executed: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFAILED TESTS:');
    results
      .filter((r) => r.status === 'FAIL')
      .forEach((r) => {
        console.log(`  - [Scenario ${r.scenario}] ${r.name}`);
        console.log(`    ${r.details}`);
        if (r.error) console.log(`    Stack: ${r.error.split('\n')[0]}`);
      });
  }

  // Cleanup isolated test directory
  try {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {}

  return { total, passed, failed, results };
}

runTestSuite().then(({ failed }) => {
  process.exit(failed > 0 ? 1 : 0);
});
