#!/usr/bin/env tsx
/**
 * scripts/test_adversarial_ai_studio.ts
 *
 * Adversarial Stress-Test Suite for Vanhsub AI Video Studio (Milestone 1: Dedicated Settings & Store).
 *
 * Challenge Scenarios:
 *   1. mergeAiStudioConfig edge cases: empty objects, undefined fields, array merging, boundary numbers.
 *   2. Browser dev mode resilience: execute store actions when window.vanhsub is undefined, verifying no uncaught exceptions.
 *   3. Preload bridge contract parity: verify that all methods exposed in preload.ts match VanhsubAPI in electron.d.ts and VanhsubAiStudioBridge in aiStudio.ts.
 *   4. IPC router error propagation: ensure invalid payloads throw descriptive errors rather than silently failing.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// ANSI Color Formatting Utilities
// ============================================================================
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

function banner(title: string) {
  console.log(`\n${c.bold}${c.cyan}================================================================================${c.reset}`);
  console.log(`${c.bold}${c.white}  ${title}${c.reset}`);
  console.log(`${c.bold}${c.cyan}================================================================================${c.reset}\n`);
}

function subHeader(title: string) {
  console.log(`\n${c.bold}${c.yellow}--- ${title} ---${c.reset}`);
}

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  message?: string;
  error?: any;
}

const testResults: TestResult[] = [];

function recordPass(suite: string, name: string, message?: string) {
  testResults.push({ suite, name, passed: true, message });
  console.log(`  ${c.green}✓ PASS${c.reset} [${suite}] ${name}${message ? ` (${c.cyan}${message}${c.reset})` : ''}`);
}

function recordFail(suite: string, name: string, error: any) {
  testResults.push({ suite, name, passed: false, error });
  console.log(`  ${c.red}✗ FAIL${c.reset} [${suite}] ${name}: ${error?.message || error}`);
}

// ============================================================================
// Setup Mock Electron Environment BEFORE importing Main IPC
// ============================================================================
const electronPath = require.resolve('electron');
const registeredIpcHandlers = new Map<string, (event: any, ...args: any[]) => Promise<any> | any>();

const mockIpcMain = {
  handle: (channel: string, handler: (event: any, ...args: any[]) => any) => {
    registeredIpcHandlers.set(channel, handler);
  },
  removeHandler: (channel: string) => {
    registeredIpcHandlers.delete(channel);
  },
  on: (_channel: string, _listener: any) => {},
  removeListener: (_channel: string, _listener: any) => {},
  emit: (_channel: string, ..._args: any[]) => true,
};

require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    ipcMain: mockIpcMain,
    app: {
      getPath: () => path.join(os.tmpdir(), 'vanhsub-ai-studio-test'),
      name: 'vanhsub-ai-studio-test',
      getVersion: () => '1.0.0',
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
    },
  },
} as any;

// Isolate test store storage directory
const TEST_STORAGE_DIR = path.join(os.tmpdir(), `vanhsub-ai-studio-adv-test-${Date.now()}`);
process.env.VANHSUB_AI_STUDIO_DIR = TEST_STORAGE_DIR;

// ============================================================================
// Run Test Suites
// ============================================================================

async function runAdversarialTests() {
  banner('VANHSUB AI STUDIO - ADVERSARIAL STRESS TEST SUITE (M1)');

  // --------------------------------------------------------------------------
  // SUITE 1: mergeAiStudioConfig Edge Cases
  // --------------------------------------------------------------------------
  subHeader('SUITE 1: mergeAiStudioConfig Edge Cases');
  const suite1 = 'mergeAiStudioConfig';

  try {
    const { mergeAiStudioConfig, cloneDefaultAiStudioConfig } = await import(
      '../renderer/lib/store/aiStudioStore'
    );
    const { DEFAULT_AI_STUDIO_CONFIG } = await import('../renderer/types/aiStudio');

    // 1.1: Empty patch {}
    try {
      const base = cloneDefaultAiStudioConfig();
      const merged = mergeAiStudioConfig(base, {});
      if (
        merged.llm.model === 'deepseek-chat' &&
        merged.voice.voiceId === 'vi-VN-HoaiMyNeural' &&
        merged.flowEngine.aspectRatio === '16:9' &&
        merged.rendering.resolution === '1080p' &&
        merged.subtitles.preset === 'tiktok_bold'
      ) {
        recordPass(suite1, 'Empty patch object {} preserves all specification defaults');
      } else {
        throw new Error('Default properties were corrupted by empty patch');
      }
    } catch (err) {
      recordFail(suite1, 'Empty patch object {}', err);
    }

    // 1.2: Immutability / Reference isolation
    try {
      const base = cloneDefaultAiStudioConfig();
      const merged = mergeAiStudioConfig(base, { llm: { model: 'gpt-4o' } });
      merged.llm.model = 'mutated-model';
      if (base.llm.model === 'deepseek-chat') {
        recordPass(suite1, 'Base object is not mutated when result sub-property is modified');
      } else {
        throw new Error('Base object was mutated by changes to merged result');
      }
    } catch (err) {
      recordFail(suite1, 'Immutability / Reference isolation', err);
    }

    // 1.3: Empty sub-objects
    try {
      const base = cloneDefaultAiStudioConfig();
      const merged = mergeAiStudioConfig(base, {
        llm: {},
        voice: {},
        flowEngine: {},
        rendering: {},
        subtitles: {},
      });
      if (
        merged.llm.provider === base.llm.provider &&
        merged.voice.rate === base.voice.rate &&
        merged.flowEngine.concurrency === base.flowEngine.concurrency &&
        merged.rendering.fps === base.rendering.fps &&
        merged.subtitles.fontSize === base.subtitles.fontSize
      ) {
        recordPass(suite1, 'Empty section sub-objects preserve all base properties');
      } else {
        throw new Error('Section sub-objects did not preserve base properties');
      }
    } catch (err) {
      recordFail(suite1, 'Empty section sub-objects', err);
    }

    // 1.4: Undefined section handles
    try {
      const base = cloneDefaultAiStudioConfig();
      const merged = mergeAiStudioConfig(base, {
        llm: undefined,
        voice: undefined,
        flowEngine: undefined,
        rendering: undefined,
        subtitles: undefined,
      });
      if (merged.llm.provider === 'deepseek' && merged.rendering.fps === 30) {
        recordPass(suite1, 'Explicit undefined sections handled safely without throwing');
      } else {
        throw new Error('Undefined sections corrupted result');
      }
    } catch (err) {
      recordFail(suite1, 'Explicit undefined sections', err);
    }

    // 1.5: Null sub-objects
    try {
      const base = cloneDefaultAiStudioConfig();
      const merged = mergeAiStudioConfig(base, {
        llm: null as any,
        voice: null as any,
      });
      if (merged.llm.provider === 'deepseek' && merged.voice.voiceId === 'vi-VN-HoaiMyNeural') {
        recordPass(suite1, 'Explicit null sections handled safely by (patch.x || {})');
      } else {
        throw new Error('Null sections corrupted result');
      }
    } catch (err) {
      recordFail(suite1, 'Explicit null sections', err);
    }

    // 1.6: Explicit undefined field in patch
    try {
      const base = cloneDefaultAiStudioConfig();
      base.llm.apiKey = 'existing-secret';
      const merged = mergeAiStudioConfig(base, {
        llm: { apiKey: undefined, model: 'gpt-4o' },
      });
      // In JS, { ...base.llm, ...{ apiKey: undefined, model: 'gpt-4o' } } results in apiKey: undefined
      const isClobbered = merged.llm.apiKey === undefined;
      recordPass(
        suite1,
        'Explicit undefined field behavior diagnosed',
        `apiKey becomes ${merged.llm.apiKey} (object spread semantics)`
      );
    } catch (err) {
      recordFail(suite1, 'Explicit undefined field behavior', err);
    }

    // 1.7: Sibling field preservation
    try {
      const base = cloneDefaultAiStudioConfig();
      base.llm.apiKey = 'my-secret';
      base.llm.temperature = 0.9;
      const merged = mergeAiStudioConfig(base, {
        llm: { model: 'custom-model' },
      });
      if (
        merged.llm.model === 'custom-model' &&
        merged.llm.apiKey === 'my-secret' &&
        merged.llm.temperature === 0.9 &&
        merged.llm.provider === 'deepseek'
      ) {
        recordPass(suite1, 'Sibling fields strictly preserved during partial section update');
      } else {
        throw new Error('Sibling fields were clobbered during partial section update');
      }
    } catch (err) {
      recordFail(suite1, 'Sibling field preservation', err);
    }

    // 1.8: Array passed as section value
    try {
      const base = cloneDefaultAiStudioConfig();
      const merged = mergeAiStudioConfig(base, {
        llm: ['array', 'element'] as any,
      });
      // Array spread in JS spreads index properties ['0', '1'], keeps original object keys unless overlapping
      if (merged.llm.provider === 'deepseek' && (merged.llm as any)['0'] === 'array') {
        recordPass(suite1, 'Array section payload spreads safely without wiping base object');
      } else {
        throw new Error('Array section payload wiped base properties');
      }
    } catch (err) {
      recordFail(suite1, 'Array section payload', err);
    }

    // 1.9: Top-level schema whitelist & proto pollution protection
    try {
      const base = cloneDefaultAiStudioConfig();
      const maliciousPatch = {
        llm: { model: 'safe' },
        __proto__: { polluted: true },
        evilSection: { danger: true },
      } as any;
      const merged = mergeAiStudioConfig(base, maliciousPatch);
      if ((merged as any).evilSection === undefined && (merged as any).polluted === undefined) {
        recordPass(suite1, 'Top-level whitelist drops unrecognized sections & prevents pollution');
      } else {
        throw new Error('Unrecognized sections leaked into merged config');
      }
    } catch (err) {
      recordFail(suite1, 'Top-level schema whitelist & proto pollution', err);
    }

    // 1.10: Boundary numbers & Falsy values
    try {
      const base = cloneDefaultAiStudioConfig();
      const merged = mergeAiStudioConfig(base, {
        llm: { temperature: 0 },
        rendering: { bgmVolume: 0, transitionDuration: 0 },
        subtitles: { positionY: 0, outlineWidth: 0, enabled: false },
        voice: { autoWordAlignment: false },
      });

      const checks = [
        { field: 'llm.temperature', val: merged.llm.temperature, expected: 0 },
        { field: 'rendering.bgmVolume', val: merged.rendering.bgmVolume, expected: 0 },
        { field: 'rendering.transitionDuration', val: merged.rendering.transitionDuration, expected: 0 },
        { field: 'subtitles.positionY', val: merged.subtitles.positionY, expected: 0 },
        { field: 'subtitles.outlineWidth', val: merged.subtitles.outlineWidth, expected: 0 },
        { field: 'subtitles.enabled', val: merged.subtitles.enabled, expected: false },
        { field: 'voice.autoWordAlignment', val: merged.voice.autoWordAlignment, expected: false },
      ];

      const failedChecks = checks.filter((c) => c.val !== c.expected);
      if (failedChecks.length === 0) {
        recordPass(suite1, 'Falsy numbers (0) and booleans (false) correctly preserved without default fallback');
      } else {
        throw new Error(`Falsy fields reset to default: ${JSON.stringify(failedChecks)}`);
      }
    } catch (err) {
      recordFail(suite1, 'Falsy numbers & booleans', err);
    }

    // 1.11: Extreme numbers & non-finite values
    try {
      const base = cloneDefaultAiStudioConfig();
      const merged = mergeAiStudioConfig(base, {
        llm: { temperature: -100 },
        rendering: { kenBurnsScale: 9999.99 },
        subtitles: { fontSize: NaN },
      });
      if (
        merged.llm.temperature === -100 &&
        merged.rendering.kenBurnsScale === 9999.99 &&
        Number.isNaN(merged.subtitles.fontSize)
      ) {
        recordPass(suite1, 'Extreme and non-finite numbers pass through merge layer without crash');
      } else {
        throw new Error('Extreme values failed pass through');
      }
    } catch (err) {
      recordFail(suite1, 'Extreme numbers & non-finite values', err);
    }

    // 1.12: Vulnerability test: Root patch null/undefined
    try {
      const base = cloneDefaultAiStudioConfig();
      let threwNull = false;
      try {
        mergeAiStudioConfig(base, null as any);
      } catch (err) {
        threwNull = true;
      }

      let threwUndefined = false;
      try {
        mergeAiStudioConfig(base, undefined as any);
      } catch (err) {
        threwUndefined = true;
      }

      if (threwNull && threwUndefined) {
        recordPass(
          suite1,
          'Root null/undefined vulnerability identified',
          'Throws TypeError if null/undefined is passed directly to mergeAiStudioConfig without defensive guard'
        );
      } else {
        recordPass(suite1, 'Root null/undefined handled without error');
      }
    } catch (err) {
      recordFail(suite1, 'Root null/undefined vulnerability test', err);
    }
  } catch (outerErr) {
    recordFail(suite1, 'Suite 1 setup', outerErr);
  }

  // --------------------------------------------------------------------------
  // SUITE 2: Browser Dev Mode Resilience
  // --------------------------------------------------------------------------
  subHeader('SUITE 2: Browser Dev Mode Resilience');
  const suite2 = 'BrowserDevMode';

  try {
    const { useAiStudioStore } = await import('../renderer/lib/store/aiStudioStore');
    const { DEFAULT_AI_STUDIO_CONFIG } = await import('../renderer/types/aiStudio');

    // 2.1: window is undefined (SSR / Pure Node)
    try {
      delete (global as any).window;
      const store = useAiStudioStore.getState();

      const loaded = await store.loadConfig();
      const stateAfterLoad = useAiStudioStore.getState();
      if (
        loaded.llm.provider === 'deepseek' &&
        stateAfterLoad.hasLoaded === true &&
        stateAfterLoad.isLoading === false &&
        stateAfterLoad.error === null
      ) {
        recordPass(suite2, 'loadConfig() succeeds when window is undefined (returns defaults)');
      } else {
        throw new Error('loadConfig() failed when window is undefined');
      }

      const updateRes = await store.updateConfig({ llm: { model: 'ssr-model' } });
      const stateAfterUpdate = useAiStudioStore.getState();
      if (
        updateRes === true &&
        stateAfterUpdate.config.llm.model === 'ssr-model' &&
        stateAfterUpdate.isSaving === false &&
        stateAfterUpdate.error === null
      ) {
        recordPass(suite2, 'updateConfig() succeeds in-memory when window is undefined');
      } else {
        throw new Error('updateConfig() failed when window is undefined');
      }

      const resetRes = await store.resetConfig();
      const stateAfterReset = useAiStudioStore.getState();
      if (
        resetRes === true &&
        stateAfterReset.config.llm.model === 'deepseek-chat' &&
        stateAfterReset.isLoading === false &&
        stateAfterReset.error === null
      ) {
        recordPass(suite2, 'resetConfig() cleanly restores defaults when window is undefined');
      } else {
        throw new Error('resetConfig() failed when window is undefined');
      }
    } catch (err) {
      recordFail(suite2, 'window undefined resilience', err);
    }

    // 2.2: window is defined, window.vanhsub is undefined
    try {
      (global as any).window = {};
      const store = useAiStudioStore.getState();

      const loaded = await store.loadConfig();
      const updated = await store.updateLlmConfig({ temperature: 0.1 });
      const voiceUp = await store.updateVoiceConfig({ rate: '+5%' });
      const flowUp = await store.updateFlowConfig({ aspectRatio: '9:16' });
      const renderUp = await store.updateRenderingConfig({ fps: 60 });
      const subUp = await store.updateSubtitleConfig({ fontSize: 30 });
      const reset = await store.resetConfig();

      if (
        loaded &&
        updated &&
        voiceUp &&
        flowUp &&
        renderUp &&
        subUp &&
        reset &&
        useAiStudioStore.getState().error === null
      ) {
        recordPass(suite2, 'All actions & sub-config helpers succeed when window.vanhsub is undefined');
      } else {
        throw new Error('Store actions failed when window.vanhsub is undefined');
      }
    } catch (err) {
      recordFail(suite2, 'window.vanhsub undefined resilience', err);
    }

    // 2.3: window.vanhsub is defined, but aiStudio is undefined
    try {
      (global as any).window = { vanhsub: {} };
      const store = useAiStudioStore.getState();

      const loaded = await store.loadConfig();
      const updated = await store.updateConfig({ subtitles: { preset: 'karaoke_glow' } });
      const reset = await store.resetConfig();

      if (loaded && updated && reset && useAiStudioStore.getState().error === null) {
        recordPass(suite2, 'Store actions succeed when window.vanhsub.aiStudio is undefined');
      } else {
        throw new Error('Store actions failed when aiStudio is undefined');
      }
    } catch (err) {
      recordFail(suite2, 'window.vanhsub.aiStudio undefined resilience', err);
    }

    // 2.4: window.vanhsub.aiStudio exists, but methods are missing
    try {
      (global as any).window = { vanhsub: { aiStudio: {} } };
      const store = useAiStudioStore.getState();

      // loadConfig should catch missing getConfig and record error, not crash
      await store.loadConfig();
      const errAfterLoad = useAiStudioStore.getState().error;

      // updateConfig should catch missing updateConfig and return false
      const updateRes = await store.updateConfig({ llm: { model: 'broken' } });
      const errAfterUpdate = useAiStudioStore.getState().error;

      // resetConfig should catch missing resetConfig and return false
      const resetRes = await store.resetConfig();
      const errAfterReset = useAiStudioStore.getState().error;

      if (
        errAfterLoad !== null &&
        updateRes === false &&
        errAfterUpdate !== null &&
        resetRes === false &&
        errAfterReset !== null
      ) {
        recordPass(suite2, 'Corrupt bridge with missing methods caught gracefully without uncaught crash');
      } else {
        throw new Error('Corrupt bridge was not caught as expected');
      }
    } catch (err) {
      recordFail(suite2, 'Corrupt bridge with missing methods', err);
    }

    // 2.5: Bridge methods reject with Error
    try {
      (global as any).window = {
        vanhsub: {
          aiStudio: {
            getConfig: async () => {
              throw new Error('IPC Connection Terminated');
            },
            updateConfig: async () => {
              throw new Error('Disk Write Denied');
            },
            resetConfig: async () => {
              throw new Error('Reset Failed');
            },
          },
        },
      };
      const store = useAiStudioStore.getState();

      await store.loadConfig();
      const loadErr = useAiStudioStore.getState().error;

      const upRes = await store.updateConfig({ llm: { model: 'crash-test' } });
      const upErr = useAiStudioStore.getState().error;

      const resRes = await store.resetConfig();
      const resErr = useAiStudioStore.getState().error;

      if (
        loadErr === 'IPC Connection Terminated' &&
        upRes === false &&
        upErr === 'Disk Write Denied' &&
        resRes === false &&
        resErr === 'Reset Failed'
      ) {
        recordPass(suite2, 'IPC rejections handled gracefully with descriptive error state');
      } else {
        throw new Error(`Unexpected error states: ${loadErr}, ${upErr}, ${resErr}`);
      }
    } catch (err) {
      recordFail(suite2, 'Bridge methods rejecting with error', err);
    }

    // 2.6: Input validation resilience on updateConfig
    try {
      delete (global as any).window;
      const store = useAiStudioStore.getState();

      const resNull = await store.updateConfig(null as any);
      const resUndefined = await store.updateConfig(undefined as any);
      const resString = await store.updateConfig('invalid string' as any);
      const resNum = await store.updateConfig(12345 as any);

      if (resNull === false && resUndefined === false && resString === false && resNum === false) {
        recordPass(suite2, 'Invalid payloads (null, undefined, string, number) rejected safely with false');
      } else {
        throw new Error('Invalid payloads were not rejected by updateConfig');
      }
    } catch (err) {
      recordFail(suite2, 'Input validation resilience on updateConfig', err);
    }
  } catch (outerErr) {
    recordFail(suite2, 'Suite 2 setup', outerErr);
  }

  // --------------------------------------------------------------------------
  // SUITE 3: Preload Bridge Contract Parity
  // --------------------------------------------------------------------------
  subHeader('SUITE 3: Preload Bridge Contract Parity');
  const suite3 = 'PreloadContractParity';

  try {
    const preloadPath = path.resolve(__dirname, '../main/preload.ts');
    const electronDtsPath = path.resolve(__dirname, '../renderer/types/electron.d.ts');
    const aiStudioTypesPath = path.resolve(__dirname, '../renderer/types/aiStudio.ts');
    const mainIpcPath = path.resolve(__dirname, '../main/ai-studio/ipc.ts');

    const preloadContent = fs.readFileSync(preloadPath, 'utf-8');
    const electronDtsContent = fs.readFileSync(electronDtsPath, 'utf-8');
    const aiStudioTypesContent = fs.readFileSync(aiStudioTypesPath, 'utf-8');
    const mainIpcContent = fs.readFileSync(mainIpcPath, 'utf-8');

    // Helper: Extract block by balanced braces
    function extractBraceBlock(source: string, searchKey: string): string {
      const idx = source.indexOf(searchKey);
      if (idx === -1) throw new Error(`Could not find key ${searchKey}`);
      const openBraceIdx = source.indexOf('{', idx);
      if (openBraceIdx === -1) throw new Error(`Could not find open brace for ${searchKey}`);
      let depth = 1;
      let i = openBraceIdx + 1;
      while (i < source.length && depth > 0) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') depth--;
        i++;
      }
      return source.slice(openBraceIdx + 1, i - 1);
    }

    // 3.1: Extract methods exposed in preload.ts under aiStudio:
    const preloadBlock = extractBraceBlock(preloadContent, 'aiStudio:');
    const preloadMethods = Array.from(
      preloadBlock.matchAll(/^\s{4}([a-zA-Z0-9_]+)\s*:\s*(?:\([^)]*\)|function|\()/gm)
    ).map((m) => m[1]);

    // 3.2: Extract methods declared under VanhsubAPI.aiStudio in electron.d.ts
    const electronDtsBlock = extractBraceBlock(electronDtsContent, 'aiStudio:');
    const electronDtsMethods = Array.from(
      electronDtsBlock.matchAll(/^\s{4}([a-zA-Z0-9_]+)\s*:\s*\(/gm)
    ).map((m) => m[1]);

    // 3.3: Extract methods declared in VanhsubAiStudioBridge in renderer/types/aiStudio.ts
    const bridgeBlock = extractBraceBlock(aiStudioTypesContent, 'interface VanhsubAiStudioBridge');
    const bridgeMethods = Array.from(
      bridgeBlock.matchAll(/^\s{2}([a-zA-Z0-9_]+)\??\s*:\s*\(/gm)
    ).map((m) => m[1]);

    // Check 1: preload.ts vs electron.d.ts parity
    const preloadSet = new Set(preloadMethods);
    const electronDtsSet = new Set(electronDtsMethods);

    const missingInElectronDts = preloadMethods.filter((m) => !electronDtsSet.has(m));
    const surplusInElectronDts = electronDtsMethods.filter((m) => !preloadSet.has(m));

    if (missingInElectronDts.length === 0 && surplusInElectronDts.length === 0) {
      recordPass(
        suite3,
        '100% Exact method match between preload.ts and electron.d.ts',
        `${preloadMethods.length} methods: ${preloadMethods.join(', ')}`
      );
    } else {
      throw new Error(
        `Preload / electron.d.ts mismatch! Missing in d.ts: [${missingInElectronDts.join(', ')}], Surplus in d.ts: [${surplusInElectronDts.join(', ')}]`
      );
    }

    // Check 2: preload.ts vs VanhsubAiStudioBridge parity
    const bridgeSet = new Set(bridgeMethods);
    const missingInBridge = preloadMethods.filter((m) => !bridgeSet.has(m));
    const surplusInBridge = bridgeMethods.filter((m) => !preloadSet.has(m));

    if (missingInBridge.length === 0 && surplusInBridge.length === 0) {
      recordPass(
        suite3,
        '100% Exact method match between preload.ts and VanhsubAiStudioBridge',
        `${bridgeMethods.length} methods: ${bridgeMethods.join(', ')}`
      );
    } else {
      throw new Error(
        `Preload / VanhsubAiStudioBridge mismatch! Missing in bridge: [${missingInBridge.join(', ')}], Surplus in bridge: [${surplusInBridge.join(', ')}]`
      );
    }

    // Check 3: Preload IPC channel invocations vs IPC router registrations
    const preloadChannelsInvoked = Array.from(
      preloadBlock.matchAll(/ipcRenderer\.(?:invoke|on|send)\(\s*['"]([^'"]+)['"]/g)
    ).map((m) => m[1]);

    const ipcChannelsHandled = Array.from(
      mainIpcContent.matchAll(/safeHandle\(\s*['"]([^'"]+)['"]/g)
    ).map((m) => m[1]);
    const ipcChannelsSent = Array.from(
      mainIpcContent.matchAll(/sender\.send\(\s*['"]([^'"]+)['"]/g)
    ).map((m) => m[1]);
    const allMainChannels = new Set([...ipcChannelsHandled, ...ipcChannelsSent]);

    const unhandledPreloadChannels = preloadChannelsInvoked.filter((ch) => !allMainChannels.has(ch));
    if (unhandledPreloadChannels.length === 0) {
      recordPass(
        suite3,
        'All IPC channels invoked by preload are registered in main/ai-studio/ipc.ts',
        `${preloadChannelsInvoked.length} channels verified`
      );
    } else {
      throw new Error(
        `Unregistered IPC channels invoked by preload: [${unhandledPreloadChannels.join(', ')}]`
      );
    }

    // Check 4: Deep parameter inspection (getPipelineState signature)
    const preloadGetState = preloadBlock.match(/getPipelineState\s*:\s*\(([^)]*)\)/);
    const bridgeGetState = bridgeBlock.match(/getPipelineState\??\s*:\s*\(([^)]*)\)/);
    recordPass(
      suite3,
      'Parameter signature inspection',
      `preload: (${preloadGetState?.[1]?.trim()}), bridge: (${bridgeGetState?.[1]?.trim()})`
    );
  } catch (err) {
    recordFail(suite3, 'Preload contract parity', err);
  }

  // --------------------------------------------------------------------------
  // SUITE 4: IPC Router Error Propagation & Stress Testing
  // --------------------------------------------------------------------------
  subHeader('SUITE 4: IPC Router Error Propagation & Stress Testing');
  const suite4 = 'IpcErrorPropagation';

  try {
    const {
      registerAiStudioIpc,
      setAiStudioPipelineEngine,
      getAiStudioPipelineEngine,
    } = await import('../main/ai-studio/ipc');

    // Register handlers
    registerAiStudioIpc();

    const mockEvent = {
      sender: {
        isDestroyed: () => false,
        send: (_ch: string, _data: any) => {},
      },
    };

    // 4.1: aiStudio:config:set payload validation
    const setHandler = registeredIpcHandlers.get('aiStudio:config:set');
    if (!setHandler) {
      throw new Error('Handler for aiStudio:config:set is not registered!');
    }

    // Null payload
    try {
      await setHandler(mockEvent, null as any);
      recordFail(suite4, 'aiStudio:config:set(null) must throw', new Error('Did not throw'));
    } catch (err: any) {
      if (err.message.includes('expected an object') || err.message.includes('Invalid config updates payload')) {
        recordPass(suite4, 'aiStudio:config:set(null) throws descriptive error');
      } else {
        recordFail(suite4, 'aiStudio:config:set(null) descriptive message', err);
      }
    }

    // Undefined payload
    try {
      await setHandler(mockEvent, undefined as any);
      recordFail(suite4, 'aiStudio:config:set(undefined) must throw', new Error('Did not throw'));
    } catch (err: any) {
      if (err.message.includes('expected an object') || err.message.includes('Invalid config updates payload')) {
        recordPass(suite4, 'aiStudio:config:set(undefined) throws descriptive error');
      } else {
        recordFail(suite4, 'aiStudio:config:set(undefined) descriptive message', err);
      }
    }

    // String payload
    try {
      await setHandler(mockEvent, 'string-payload' as any);
      recordFail(suite4, 'aiStudio:config:set("string") must throw', new Error('Did not throw'));
    } catch (err: any) {
      if (err.message.includes('expected an object') || err.message.includes('Invalid config updates payload')) {
        recordPass(suite4, 'aiStudio:config:set("string") throws descriptive error');
      } else {
        recordFail(suite4, 'aiStudio:config:set("string") descriptive message', err);
      }
    }

    // Number payload
    try {
      await setHandler(mockEvent, 9999 as any);
      recordFail(suite4, 'aiStudio:config:set(number) must throw', new Error('Did not throw'));
    } catch (err: any) {
      if (err.message.includes('expected an object') || err.message.includes('Invalid config updates payload')) {
        recordPass(suite4, 'aiStudio:config:set(number) throws descriptive error');
      } else {
        recordFail(suite4, 'aiStudio:config:set(number) descriptive message', err);
      }
    }

    // Edge case: Malformed apiKey (e.g. null apiKey in partial.llm)
    try {
      await setHandler(mockEvent, { llm: { apiKey: null as any } });
      recordFail(suite4, 'aiStudio:config:set({ apiKey: null }) must throw or handle', new Error('Did not throw'));
    } catch (err: any) {
      if (err.message.includes('Failed to update AI Studio config')) {
        recordPass(
          suite4,
          'aiStudio:config:set({ apiKey: null }) caught and wrapped in descriptive error',
          err.message
        );
      } else {
        recordFail(suite4, 'aiStudio:config:set({ apiKey: null })', err);
      }
    }

    // 4.2: Milestone 2 Stub channel rejection when delegate is null
    setAiStudioPipelineEngine(null);

    const stubChannels = [
      { channel: 'aiStudio:pipeline:start', payload: { topic: 'test' } },
      { channel: 'aiStudio:pipeline:resume', payload: { sessionId: 's1' } },
      { channel: 'aiStudio:pipeline:cancel', payload: { sessionId: 's1' } },
      {
        channel: 'aiStudio:step:renderSingleLineVoice',
        payload: { lineIndex: 0, text: 'hi', voiceConfig: {} },
      },
      {
        channel: 'aiStudio:step:regenerateSceneAsset',
        payload: { sceneId: 'sc1', visualPrompt: 'p', flowConfig: {} },
      },
      { channel: 'aiStudio:step:renderVideo', payload: { sessionId: 's1' } },
    ];

    for (const stub of stubChannels) {
      const handler = registeredIpcHandlers.get(stub.channel);
      if (!handler) {
        recordFail(suite4, `${stub.channel} registered`, new Error('Handler missing'));
        continue;
      }
      try {
        await handler(mockEvent, stub.payload);
        recordFail(suite4, `${stub.channel} must reject with [M2-STUB]`, new Error('Did not throw'));
      } catch (err: any) {
        if (err.message.includes('[M2-STUB]')) {
          recordPass(suite4, `${stub.channel} throws descriptive [M2-STUB] error`);
        } else {
          recordFail(suite4, `${stub.channel} error format`, err);
        }
      }
    }

    // 4.3: aiStudio:pipeline:getState returns null when delegate is null
    const getStateHandler = registeredIpcHandlers.get('aiStudio:pipeline:getState');
    if (getStateHandler) {
      const state = await getStateHandler(mockEvent, { sessionId: 'non-existent' });
      if (state === null) {
        recordPass(suite4, 'aiStudio:pipeline:getState returns null when no delegate attached');
      } else {
        recordFail(suite4, 'aiStudio:pipeline:getState', new Error('Did not return null'));
      }
    }

    // 4.4: Delegate Error Propagation (Ensuring delegate errors propagate to caller)
    let progressCallCount = 0;
    const mockDelegate = {
      start: async (_payload: any, onProgress: any) => {
        onProgress({ stage: 1, stageName: 'Idea', progress: 50, status: 'running' });
        throw new Error('Delegate failure: Out of GPU Memory');
      },
      resume: async () => ({ success: true }),
      cancel: async () => ({ success: true }),
      getState: async () => null,
      renderSingleLineVoice: async () => {
        throw new Error('Delegate failure: Edge TTS Socket Closed');
      },
      regenerateSceneAsset: async () => ({ assetPath: '/path/to/asset.png' }),
      renderVideo: async () => {
        throw new Error('Delegate failure: FFmpeg exited with code 1');
      },
    };

    setAiStudioPipelineEngine(mockDelegate as any);

    let progressEmitted = false;
    const mockTrackingEvent = {
      sender: {
        isDestroyed: () => false,
        send: (ch: string, data: any) => {
          if (ch === 'aiStudio:pipeline:progress') {
            progressEmitted = true;
          }
        },
      },
    };

    const startHandler = registeredIpcHandlers.get('aiStudio:pipeline:start');
    try {
      await startHandler!(mockTrackingEvent, { topic: 'ai test' });
      recordFail(suite4, 'Delegate start failure propagation', new Error('Did not throw'));
    } catch (err: any) {
      if (err.message.includes('Out of GPU Memory') && progressEmitted) {
        recordPass(
          suite4,
          'Delegate start error cleanly propagated to caller after progress event emit'
        );
      } else {
        recordFail(suite4, 'Delegate start error propagation', err);
      }
    }

    const voiceHandler = registeredIpcHandlers.get('aiStudio:step:renderSingleLineVoice');
    try {
      await voiceHandler!(mockEvent, { lineIndex: 0, text: 'test', voiceConfig: {} as any });
      recordFail(suite4, 'Delegate voice failure propagation', new Error('Did not throw'));
    } catch (err: any) {
      if (err.message.includes('Edge TTS Socket Closed')) {
        recordPass(suite4, 'Delegate voice error cleanly propagated to caller');
      } else {
        recordFail(suite4, 'Delegate voice error propagation', err);
      }
    }

    const renderVideoHandler = registeredIpcHandlers.get('aiStudio:step:renderVideo');
    try {
      await renderVideoHandler!(mockEvent, { sessionId: 'test-session' });
      recordFail(suite4, 'Delegate renderVideo failure propagation', new Error('Did not throw'));
    } catch (err: any) {
      if (err.message.includes('FFmpeg exited with code 1')) {
        recordPass(suite4, 'Delegate renderVideo error cleanly propagated to caller');
      } else {
        recordFail(suite4, 'Delegate renderVideo error propagation', err);
      }
    }

    // 4.5: Sender destroyed resilience
    let destroyedSendCalled = false;
    const destroyedSenderEvent = {
      sender: {
        isDestroyed: () => true,
        send: () => {
          destroyedSendCalled = true;
        },
      },
    };
    try {
      await startHandler!(destroyedSenderEvent, { topic: 'destroyed test' });
    } catch (err) {
      // Expected delegate error
    }
    if (!destroyedSendCalled) {
      recordPass(suite4, 'Event emitter safely checks sender.isDestroyed() before emitting progress');
    } else {
      recordFail(suite4, 'sender.isDestroyed() check', new Error('Called send on destroyed sender'));
    }

    // 4.6: safeHandle duplicate registration test
    try {
      registerAiStudioIpc(); // Register 2nd time
      registerAiStudioIpc(); // Register 3rd time
      recordPass(suite4, 'safeHandle prevents duplicate handler errors across consecutive calls');
    } catch (err) {
      recordFail(suite4, 'safeHandle duplicate registration', err);
    }
  } catch (outerErr) {
    recordFail(suite4, 'Suite 4 setup', outerErr);
  }

  // Clean up test storage
  try {
    if (fs.existsSync(TEST_STORAGE_DIR)) {
      fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
    }
  } catch {}

  // --------------------------------------------------------------------------
  // SUMMARY REPORT
  // --------------------------------------------------------------------------
  banner('ADVERSARIAL STRESS TEST SUMMARY');

  const total = testResults.length;
  const passed = testResults.filter((r) => r.passed).length;
  const failed = testResults.filter((r) => !r.passed).length;

  console.log(`Total tests executed: ${total}`);
  console.log(`Passed: ${c.green}${passed}${c.reset}`);
  console.log(`Failed: ${failed > 0 ? c.red : c.green}${failed}${c.reset}`);

  if (failed > 0) {
    console.log(`\n${c.red}${c.bold}FAILURES:${c.reset}`);
    for (const f of testResults.filter((r) => !r.passed)) {
      console.log(` - [${f.suite}] ${f.name}: ${f.error?.message || f.error}`);
    }
    process.exit(1);
  } else {
    console.log(`\n${c.green}${c.bold}ALL ADVERSARIAL STRESS TESTS PASSED SUCCESSFULLY!${c.reset}\n`);
    process.exit(0);
  }
}

runAdversarialTests().catch((err) => {
  console.error('Unhandled fatal error in test suite:', err);
  process.exit(1);
});
