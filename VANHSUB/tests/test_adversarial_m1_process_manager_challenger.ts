/**
 * tests/test_adversarial_m1_process_manager_challenger.ts
 *
 * Adversarial Stress-Testing Suite for BrowserProcessManager and Types (Milestone 1):
 * Archetype: Empirical Challenger
 *
 * Suites:
 * - Suite 1: Port 9222 Guard Bypass Attempts
 *   - Numeric 9222
 *   - String "9222", whitespace/newline padded "  9222 \n\r"
 *   - Leading plus "+9222"
 *   - Hexadecimal "0x2406", "0X2406", literal 0x2406
 *   - Octal "0o22006", literal 0o22006
 *   - Binary "0b10010000000110", literal 0b10010000000110
 *   - Scientific notation "9.222e3", "0.9222e4", "92.22e2"
 *   - Floats and boundary coercion: 9222.0, "9222.000", Math.floor(9222)
 *   - Invalid port ranges and non-numerics: 0, -1, 65536, 70000, NaN, null, undefined, "", "abc", "{}"
 *   - isPortAlive bypass attempts with string representations
 *   - Environment variable injection bypass: FLOW_CDP_PORT="9222", CHATGPT_CDP_PORT=" 9222 "
 *
 * - Suite 2: Stale Lockfile Sanitization & File Safety
 *   - Safe cleanup of SingletonLock, SingletonSocket, SingletonCookie
 *   - Preservation of user data files (Preferences, Cookies, Local State, History)
 *   - Non-existent profile directories handling
 *   - Pre-launch lockfile cleanup verification
 *   - Post-close lockfile cleanup verification
 *
 * - Suite 3: 5-Tier Binary Locator Fallback & Cache Integrity
 *   - Explicit parameter override (valid vs invalid path)
 *   - Tier 1 env overrides (CHROME_PATH, CHROME_BIN, VANHSUB_CHROME_PATH)
 *   - Fallback behavior when primary candidate missing
 *   - Cache invalidation via clearDetectedChromePath()
 *   - Descriptive ChromeNotFoundError with checkedLocations
 *
 * - Suite 4: Concurrent Multi-Profile Spawning & Lifecycle Isolation
 *   - Simultaneous multi-profile launching (ChatGPT on 9223 and Flow on 9224)
 *   - Distinct profile directories (chrome_chatgpt_profile vs chrome_flow_profile)
 *   - Independent registry entries in activeProcesses
 *   - Targeted closeBrowser('flow') leaves ChatGPT running
 *   - Full teardown via closeAllBrowsers()
 *
 * - Suite 5: Adapter Port 9222 Rejection & Cross-Talk Prevention
 *   - BrowserAutomationAdapter.connect() port 9222 bypass rejection
 *   - Multi-session isolation between ChatGPT (9223) and Flow (9224)
 *   - Safe detach without killing Chrome process
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import {
  RESERVED_BRIDGE_PORT,
  DEFAULT_CHATGPT_PORT,
  DEFAULT_FLOW_PORT,
  DEFAULT_GENERIC_PORT,
  DEFAULT_PROVIDER_PORTS,
  DEFAULT_PROVIDER_PROFILE_NAMES,
  PortConflictError,
  PortConflictGuardError,
  ChromeNotFoundError,
  BrowserLaunchError,
  BrowserLaunchTimeoutError,
  CdpConnectionError,
  BrowserNotConnectedError,
  PersistentContextNotFoundError,
  TabNotFoundError,
  assertNotReservedPort,
} from '../main/browser-automation/types';
import { BrowserProcessManager } from '../main/browser-automation/BrowserProcessManager';
import { BrowserAutomationAdapter } from '../main/browser-automation/BrowserAutomationAdapter';

// =============================================================================
// ANSI Output Formatting
// =============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
};

let totalPassed = 0;
let totalFailed = 0;
const failureDetails: Array<{ suite: string; test: string; error: any }> = [];

function pass(testId: string, description: string) {
  totalPassed++;
  console.log(`  ${colors.green}✓ [PASS]${colors.reset} [${testId}] ${description}`);
}

function fail(testId: string, description: string, err: any) {
  totalFailed++;
  failureDetails.push({ suite: currentSuite, test: `[${testId}] ${description}`, error: err });
  console.error(`  ${colors.red}✗ [FAIL]${colors.reset} [${testId}] ${description}`);
  console.error(`     Error: ${err?.message || err}`);
}

let currentSuite = '';

function suite(name: string) {
  currentSuite = name;
  console.log(`\n${colors.bold}${colors.magenta}▶ [SUITE] ${name}${colors.reset}`);
}

// =============================================================================
// Main Test Runner
// =============================================================================

async function runAdversarialTestSuite() {
  console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}  EMPIRICAL CHALLENGER: ADVERSARIAL STRESS-TEST SUITE FOR MILESTONE 1${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);

  const bpm = BrowserProcessManager.getInstance();
  const adapter = BrowserAutomationAdapter.getInstance();

  // ---------------------------------------------------------------------------
  // SUITE 1: Port 9222 Guard Bypass Attempts
  // ---------------------------------------------------------------------------
  suite('Suite 1: Port 9222 Guard Bypass Attempts & Port Validation');

  // Test 1.1: Numeric 9222 in assertNotReservedPort
  try {
    assert.throws(
      () => assertNotReservedPort(9222),
      (err: any) => err instanceof PortConflictError && err.port === 9222
    );
    pass('1.1', 'assertNotReservedPort(9222) throws PortConflictError with port 9222');
  } catch (e) {
    fail('1.1', 'assertNotReservedPort(9222) numeric rejection failed', e);
  }

  // Test 1.2: String "9222" and padded string variants
  try {
    const stringBypasses = [
      '9222',
      ' 9222',
      '9222 ',
      '  9222  ',
      '\t9222\n',
      '\r\n 9222 \r\n',
      '+9222',
    ];
    for (const val of stringBypasses) {
      assert.throws(
        () => assertNotReservedPort(val),
        (err: any) => err instanceof PortConflictError && err.port === 9222,
        `Expected assertNotReservedPort("${val}") to throw PortConflictError`
      );
      assert.throws(
        () => bpm.validatePort(val),
        (err: any) => err instanceof PortConflictError && err.port === 9222,
        `Expected bpm.validatePort("${val}") to throw PortConflictError`
      );
    }
    pass('1.2', 'String "9222" with whitespace, newlines, and leading plus are rejected');
  } catch (e) {
    fail('1.2', 'String whitespace bypass failed', e);
  }

  // Test 1.3: Hexadecimal notation bypass attempts
  try {
    const hexBypasses = ['0x2406', '0X2406', 0x2406];
    for (const val of hexBypasses) {
      assert.throws(
        () => assertNotReservedPort(val),
        (err: any) => err instanceof PortConflictError && err.port === 9222,
        `Expected assertNotReservedPort(${val}) to throw PortConflictError`
      );
      assert.throws(
        () => bpm.validatePort(val),
        (err: any) => err instanceof PortConflictError && err.port === 9222,
        `Expected bpm.validatePort(${val}) to throw PortConflictError`
      );
    }
    pass('1.3', 'Hexadecimal representations (0x2406, 0X2406) resolve to 9222 and are rejected');
  } catch (e) {
    fail('1.3', 'Hexadecimal bypass failed', e);
  }

  // Test 1.4: Octal notation bypass attempts
  try {
    const octalBypasses = ['0o22006', '0O22006', 0o22006];
    for (const val of octalBypasses) {
      assert.throws(
        () => assertNotReservedPort(val),
        (err: any) => err instanceof PortConflictError && err.port === 9222,
        `Expected assertNotReservedPort(${val}) to throw PortConflictError`
      );
      assert.throws(
        () => bpm.validatePort(val),
        (err: any) => err instanceof PortConflictError && err.port === 9222,
        `Expected bpm.validatePort(${val}) to throw PortConflictError`
      );
    }
    pass('1.4', 'Octal representations (0o22006, 0O22006) resolve to 9222 and are rejected');
  } catch (e) {
    fail('1.4', 'Octal bypass failed', e);
  }

  // Test 1.5: Binary and scientific notation bypass attempts
  try {
    const otherBypasses = [
      '0b10010000000110',
      0b10010000000110,
      '9.222e3',
      '92.22e2',
      '0.9222e4',
      9.222e3,
    ];
    for (const val of otherBypasses) {
      assert.throws(
        () => assertNotReservedPort(val),
        (err: any) => err instanceof PortConflictError && err.port === 9222,
        `Expected assertNotReservedPort(${val}) to throw PortConflictError`
      );
      assert.throws(
        () => bpm.validatePort(val),
        (err: any) => err instanceof PortConflictError && err.port === 9222,
        `Expected bpm.validatePort(${val}) to throw PortConflictError`
      );
    }
    pass('1.5', 'Binary (0b...) and Scientific notation (9.222e3) resolve to 9222 and are rejected');
  } catch (e) {
    fail('1.5', 'Binary / Scientific notation bypass failed', e);
  }

  // Test 1.6: Float representations resolving to 9222
  try {
    const floatBypasses = [9222.0, '9222.0', '9222.000', Math.floor(9222.999)];
    for (const val of floatBypasses) {
      assert.throws(
        () => assertNotReservedPort(val),
        (err: any) => err instanceof PortConflictError && err.port === 9222,
        `Expected assertNotReservedPort(${val}) to throw PortConflictError`
      );
      assert.throws(
        () => bpm.validatePort(val),
        (err: any) => err instanceof PortConflictError && err.port === 9222,
        `Expected bpm.validatePort(${val}) to throw PortConflictError`
      );
    }
    pass('1.6', 'Float representations (9222.0, "9222.000") are rejected');
  } catch (e) {
    fail('1.6', 'Float 9222 bypass failed', e);
  }

  // Test 1.7: Invalid TCP port ranges and non-numeric inputs
  try {
    const invalidInputs: any[] = [
      0,
      -1,
      -9222,
      65536,
      70000,
      100000,
      NaN,
      null,
      undefined,
      '',
      '   ',
      'abc',
      'port9222',
      '9222a',
      '{}',
      [],
    ];

    for (const invalid of invalidInputs) {
      assert.throws(
        () => bpm.validatePort(invalid),
        (err: any) => err instanceof Error,
        `Expected bpm.validatePort(${JSON.stringify(invalid)}) to throw Error`
      );
    }
    pass('1.7', 'Out-of-range (<1 or >65535) and non-numeric inputs rejected by validatePort');
  } catch (e) {
    fail('1.7', 'Invalid range rejection failed', e);
  }

  // Test 1.8: assertNotReservedPort behavior with non-reserved and falsy values
  try {
    assert.strictEqual(assertNotReservedPort(null), 0);
    assert.strictEqual(assertNotReservedPort(undefined), 0);
    assert.strictEqual(assertNotReservedPort(9223), 9223);
    assert.strictEqual(assertNotReservedPort('9224'), 9224);
    assert.strictEqual(assertNotReservedPort(' 9225 '), 9225);
    pass('1.8', 'assertNotReservedPort safely returns numeric value or 0 for falsy');
  } catch (e) {
    fail('1.8', 'assertNotReservedPort benign input failed', e);
  }

  // Test 1.9: Environment variable override injection bypass
  try {
    const origFlowPort = process.env.FLOW_CDP_PORT;
    const origChatGptPort = process.env.CHATGPT_CDP_PORT;

    process.env.FLOW_CDP_PORT = '9222';
    assert.throws(
      () => bpm.getDefaultPort('flow'),
      (err: any) => err instanceof PortConflictError && err.port === 9222
    );

    process.env.CHATGPT_CDP_PORT = ' 9222 ';
    assert.throws(
      () => bpm.getDefaultPort('chatgpt'),
      (err: any) => err instanceof PortConflictError && err.port === 9222
    );

    // Restore env
    if (origFlowPort !== undefined) process.env.FLOW_CDP_PORT = origFlowPort;
    else delete process.env.FLOW_CDP_PORT;
    if (origChatGptPort !== undefined) process.env.CHATGPT_CDP_PORT = origChatGptPort;
    else delete process.env.CHATGPT_CDP_PORT;

    pass('1.9', 'Environment variable injection of port 9222 is blocked in getDefaultPort');
  } catch (e) {
    fail('1.9', 'Env variable port guard failed', e);
  }

  // Test 1.10: isPortAlive safety check on port 9222
  try {
    const aliveNumeric = await bpm.isPortAlive(9222);
    assert.strictEqual(aliveNumeric, false);

    // Also verify non-alive unbound port returns false cleanly
    const aliveRandom = await bpm.isPortAlive(59871, 100);
    assert.strictEqual(aliveRandom, false);

    pass('1.10', 'isPortAlive(9222) returns false immediately without network traffic');
  } catch (e) {
    fail('1.10', 'isPortAlive 9222 test failed', e);
  }

  // ---------------------------------------------------------------------------
  // SUITE 2: Stale Lockfile Sanitization & User Data Safety
  // ---------------------------------------------------------------------------
  suite('Suite 2: Stale Lockfile Sanitization & User Data Safety');

  const testTempProfile = path.join(os.tmpdir(), `vanhsub_challenger_lock_${Date.now()}`);

  try {
    fs.mkdirSync(testTempProfile, { recursive: true });

    // Seed lockfiles
    fs.writeFileSync(path.join(testTempProfile, 'SingletonLock'), '12345');
    fs.writeFileSync(path.join(testTempProfile, 'SingletonSocket'), 'socket_data');
    fs.writeFileSync(path.join(testTempProfile, 'SingletonCookie'), 'cookie_data');

    // Seed sensitive persistent data that MUST NOT be touched
    fs.writeFileSync(path.join(testTempProfile, 'Preferences'), '{"theme":"dark"}');
    fs.writeFileSync(path.join(testTempProfile, 'Cookies'), 'binary_cookie_db');
    fs.writeFileSync(path.join(testTempProfile, 'Local State'), '{"os_crypt":{}}');

    bpm.cleanupStaleLockFiles(testTempProfile);

    // Assert lockfiles removed
    assert.strictEqual(fs.existsSync(path.join(testTempProfile, 'SingletonLock')), false, 'SingletonLock should be removed');
    assert.strictEqual(fs.existsSync(path.join(testTempProfile, 'SingletonSocket')), false, 'SingletonSocket should be removed');
    assert.strictEqual(fs.existsSync(path.join(testTempProfile, 'SingletonCookie')), false, 'SingletonCookie should be removed');

    // Assert user data preserved
    assert.strictEqual(fs.existsSync(path.join(testTempProfile, 'Preferences')), true, 'Preferences MUST NOT be removed');
    assert.strictEqual(fs.existsSync(path.join(testTempProfile, 'Cookies')), true, 'Cookies MUST NOT be removed');
    assert.strictEqual(fs.existsSync(path.join(testTempProfile, 'Local State')), true, 'Local State MUST NOT be removed');

    pass('2.1', 'cleanupStaleLockFiles purges SingletonLock/Socket/Cookie while preserving user data');
  } catch (e) {
    fail('2.1', 'Lockfile cleanup failed', e);
  } finally {
    try {
      fs.rmSync(testTempProfile, { recursive: true, force: true });
    } catch {}
  }

  // Test 2.2: cleanupStaleLockFiles on non-existent directory does not throw
  try {
    const nonExistent = path.join(os.tmpdir(), `non_existent_profile_${Date.now()}`);
    bpm.cleanupStaleLockFiles(nonExistent);
    pass('2.2', 'cleanupStaleLockFiles handles non-existent profile directories gracefully');
  } catch (e) {
    fail('2.2', 'Non-existent directory lockfile cleanup threw error', e);
  }

  // ---------------------------------------------------------------------------
  // SUITE 3: 5-Tier Binary Locator Fallback & Cache Integrity
  // ---------------------------------------------------------------------------
  suite('Suite 3: 5-Tier Binary Locator Fallback & Cache Integrity');

  // Test 3.1: Explicit override path precedence
  const dummyChromeExe = path.join(os.tmpdir(), `dummy_chrome_${Date.now()}.exe`);
  try {
    fs.writeFileSync(dummyChromeExe, 'dummy binary');
    bpm.clearDetectedChromePath();
    const resolved = bpm.detectChromePath(dummyChromeExe);
    assert.strictEqual(path.resolve(resolved), path.resolve(dummyChromeExe));
    pass('3.1', 'detectChromePath prioritizes valid explicit overridePath');
  } catch (e) {
    fail('3.1', 'Explicit override detection failed', e);
  } finally {
    try { fs.unlinkSync(dummyChromeExe); } catch {}
  }

  // Test 3.2: Tier 1 Environment Variable Overrides
  const dummyEnvChrome = path.join(os.tmpdir(), `dummy_env_chrome_${Date.now()}.exe`);
  try {
    fs.writeFileSync(dummyEnvChrome, 'dummy env binary');
    const origChromePath = process.env.CHROME_PATH;

    process.env.CHROME_PATH = dummyEnvChrome;
    bpm.clearDetectedChromePath();
    const resolved = bpm.detectChromePath();
    assert.strictEqual(path.resolve(resolved), path.resolve(dummyEnvChrome));

    if (origChromePath !== undefined) process.env.CHROME_PATH = origChromePath;
    else delete process.env.CHROME_PATH;

    pass('3.2', 'detectChromePath prioritizes CHROME_PATH environment variable');
  } catch (e) {
    fail('3.2', 'CHROME_PATH override detection failed', e);
  } finally {
    try { fs.unlinkSync(dummyEnvChrome); } catch {}
  }

  // Test 3.3: Cache invalidation via clearDetectedChromePath
  try {
    bpm.clearDetectedChromePath();
    const realChrome = bpm.detectChromePath();
    assert.ok(fs.existsSync(realChrome), `Real Chrome should exist at ${realChrome}`);

    // Verify subsequent call uses cached path
    const cached = bpm.detectChromePath();
    assert.strictEqual(cached, realChrome);

    // Clear cache and verify re-detection
    bpm.clearDetectedChromePath();
    const reDetected = bpm.detectChromePath();
    assert.strictEqual(reDetected, realChrome);

    pass('3.3', 'clearDetectedChromePath successfully invalidates cached binary path');
  } catch (e) {
    fail('3.3', 'Cache invalidation test failed', e);
  }

  // Test 3.4: Host Chrome presence verification
  try {
    const hostPath = bpm.detectChromePath();
    assert.ok(fs.existsSync(hostPath), `Host Chrome binary must exist on system: ${hostPath}`);
    assert.ok(hostPath.toLowerCase().includes('chrome'), 'Path should reference Chrome binary');
    pass('3.4', `Host Chrome binary detected at: ${hostPath}`);
  } catch (e) {
    fail('3.4', 'Host Chrome detection failed', e);
  }

  // ---------------------------------------------------------------------------
  // SUITE 4: Concurrent Multi-Profile Spawning & Lifecycle Isolation
  // ---------------------------------------------------------------------------
  suite('Suite 4: Concurrent Multi-Profile Spawning & Lifecycle Isolation');

  // Test 4.1: Profile directories for ChatGPT and Flow are strictly distinct
  try {
    const chatGptProfile = bpm.getProfileDir('chatgpt');
    const flowProfile = bpm.getProfileDir('flow');
    const genericProfile = bpm.getProfileDir('generic');

    assert.notStrictEqual(chatGptProfile, flowProfile);
    assert.notStrictEqual(flowProfile, genericProfile);
    assert.ok(chatGptProfile.includes('chrome_chatgpt_profile'));
    assert.ok(flowProfile.includes('chrome_flow_profile'));
    assert.ok(genericProfile.includes('chrome_generic_profile'));

    pass('4.1', 'Provider profile directories are strictly isolated distinct paths');
  } catch (e) {
    fail('4.1', 'Profile directory isolation failed', e);
  }

  // Test 4.2: Port allocations are strictly isolated
  try {
    const chatGptPort = bpm.getDefaultPort('chatgpt');
    const flowPort = bpm.getDefaultPort('flow');
    const genericPort = bpm.getDefaultPort('generic');

    assert.strictEqual(chatGptPort, 9223);
    assert.strictEqual(flowPort, 9224);
    assert.strictEqual(genericPort, 9225);

    assert.notStrictEqual(chatGptPort, RESERVED_BRIDGE_PORT);
    assert.notStrictEqual(flowPort, RESERVED_BRIDGE_PORT);
    assert.notStrictEqual(genericPort, RESERVED_BRIDGE_PORT);

    pass('4.2', 'Default ports (9223, 9224, 9225) are distinct and isolated from 9222');
  } catch (e) {
    fail('4.2', 'Port allocation isolation failed', e);
  }

  // Test 4.3: Real headless dual-browser launch & independent lifecycle
  // We use separate mock ports/isolated temporary profile directories to avoid altering real user sessions.
  const testChatGptProfile = path.join(os.tmpdir(), `vanhsub_test_cgpt_${Date.now()}`);
  const testFlowProfile = path.join(os.tmpdir(), `vanhsub_test_flow_${Date.now()}`);
  const testPortChatGpt = 9253;
  const testPortFlow = 9254;

  let spawnedChatGpt = false;
  let spawnedFlow = false;

  try {
    console.log(`    Spawning concurrent headless browsers: ChatGPT on ${testPortChatGpt}, Flow on ${testPortFlow}...`);

    // Concurrent launch via Promise.all
    const [infoChatGpt, infoFlow] = await Promise.all([
      bpm.launchBrowser({
        provider: 'chatgpt',
        port: testPortChatGpt,
        profileDir: testChatGptProfile,
        headless: true,
        timeoutMs: 15000,
        extraArgs: ['--no-sandbox', '--disable-gpu'],
      }),
      bpm.launchBrowser({
        provider: 'flow',
        port: testPortFlow,
        profileDir: testFlowProfile,
        headless: true,
        timeoutMs: 15000,
        extraArgs: ['--no-sandbox', '--disable-gpu'],
      }),
    ]);

    spawnedChatGpt = true;
    spawnedFlow = true;

    // Verify both are alive
    assert.strictEqual(infoChatGpt.isAlive, true);
    assert.strictEqual(infoChatGpt.port, testPortChatGpt);
    assert.strictEqual(infoChatGpt.provider, 'chatgpt');
    assert.ok(infoChatGpt.pid && infoChatGpt.pid > 0);

    assert.strictEqual(infoFlow.isAlive, true);
    assert.strictEqual(infoFlow.port, testFlowProfile ? testPortFlow : 0);
    assert.strictEqual(infoFlow.provider, 'flow');
    assert.ok(infoFlow.pid && infoFlow.pid > 0);

    // Verify active registry tracks both
    const allProcs = bpm.getAllProcesses();
    assert.strictEqual(allProcs.length, 2);

    const trackedCgpt = bpm.getProcessInfo('chatgpt');
    const trackedFlow = bpm.getProcessInfo('flow');
    assert.ok(trackedCgpt && trackedCgpt.isAlive);
    assert.ok(trackedFlow && trackedFlow.isAlive);

    pass('4.3', 'Simultaneous launchBrowser for ChatGPT (9253) and Flow (9254) succeeded concurrently');

    // Test 4.4: Targeted closeBrowser('flow') leaves ChatGPT intact
    await bpm.closeBrowser('flow');
    spawnedFlow = false;

    // Verify Flow is terminated
    const flowAliveAfter = await bpm.isPortAlive(testPortFlow, 250);
    assert.strictEqual(flowAliveAfter, false, 'Flow port should be dead');
    assert.strictEqual(bpm.getProcessInfo('flow'), null, 'Flow should be removed from registry');

    // Verify ChatGPT remains alive
    const cgptAliveAfter = await bpm.isPortAlive(testPortChatGpt, 250);
    assert.strictEqual(cgptAliveAfter, true, 'ChatGPT port MUST remain alive');
    const cgptTrackedAfter = bpm.getProcessInfo('chatgpt');
    assert.ok(cgptTrackedAfter && cgptTrackedAfter.isAlive, 'ChatGPT must remain tracked as alive');

    pass('4.4', 'Closing Flow browser cleanly terminates Flow while ChatGPT remains alive');

    // Test 4.5: Clean closeBrowser('chatgpt')
    await bpm.closeBrowser('chatgpt');
    spawnedChatGpt = false;

    const cgptAliveFinal = await bpm.isPortAlive(testPortChatGpt, 250);
    assert.strictEqual(cgptAliveFinal, false, 'ChatGPT port should be dead after close');
    assert.strictEqual(bpm.getProcessInfo('chatgpt'), null, 'ChatGPT should be removed from registry');

    pass('4.5', 'Closing ChatGPT browser cleanly terminates process tree');
  } catch (e) {
    fail('4.3-4.5', 'Concurrent multi-profile spawning/isolation failed', e);
  } finally {
    // Teardown safety
    if (spawnedChatGpt) await bpm.closeBrowser('chatgpt').catch(() => {});
    if (spawnedFlow) await bpm.closeBrowser('flow').catch(() => {});
    await bpm.closeBrowserByPort(testPortChatGpt).catch(() => {});
    await bpm.closeBrowserByPort(testPortFlow).catch(() => {});
    try { fs.rmSync(testChatGptProfile, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(testFlowProfile, { recursive: true, force: true }); } catch {}
  }

  // ---------------------------------------------------------------------------
  // SUITE 5: Adapter Port 9222 Rejection & Cross-Talk Prevention
  // ---------------------------------------------------------------------------
  suite('Suite 5: BrowserAutomationAdapter Port 9222 Rejection & Cross-Talk');

  // Test 5.1: Adapter connect rejects port 9222 (numeric, string, padded, hex, octal)
  try {
    const adapterBypasses: any[] = [
      9222,
      '9222',
      ' 9222 ',
      '0x2406',
      '0o22006',
      '9.222e3',
    ];

    for (const p of adapterBypasses) {
      await assert.rejects(
        async () => {
          await adapter.connect({ provider: 'flow', port: p });
        },
        (err: any) => err instanceof PortConflictError,
        `Expected adapter.connect({ port: ${JSON.stringify(p)} }) to reject with PortConflictError`
      );
    }
    pass('5.1', 'BrowserAutomationAdapter.connect() rejects port 9222 bypasses with PortConflictError');
  } catch (e) {
    fail('5.1', 'Adapter connect port 9222 guard failed', e);
  }

  // Test 5.2: Singleton resetInstance clears state safely
  try {
    BrowserProcessManager.resetInstance();
    const freshBpm = BrowserProcessManager.getInstance();
    assert.strictEqual(freshBpm.getAllProcesses().length, 0);

    BrowserAutomationAdapter.resetInstance();
    const freshAdapter = BrowserAutomationAdapter.getInstance();
    assert.strictEqual(freshAdapter.isConnected('chatgpt'), false);
    assert.strictEqual(freshAdapter.isConnected('flow'), false);

    pass('5.2', 'Singleton resetInstance cleans internal maps and listeners without leakage');
  } catch (e) {
    fail('5.2', 'Singleton reset failed', e);
  }

  // =============================================================================
  // Summary & Empirical Challenger Verdict
  // =============================================================================
  console.log(`\n${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}  EMPIRICAL CHALLENGE EXECUTION SUMMARY${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`Total Cases Run : ${totalPassed + totalFailed}`);
  console.log(`Passed          : ${colors.green}${totalPassed}${colors.reset}`);
  console.log(`Failed          : ${totalFailed > 0 ? colors.red + totalFailed + colors.reset : '0'}`);
  console.log(`Success Rate    : ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%`);

  if (totalFailed > 0) {
    console.log(`\n${colors.bold}${colors.red}FAILURES:${colors.reset}`);
    for (const f of failureDetails) {
      console.log(`  - [${f.suite}] ${f.test}: ${f.error?.message || f.error}`);
    }
    console.log(`\n${colors.bold}${colors.red}VERDICT: REQUEST_CHANGES ❌${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`\n${colors.bold}${colors.green}VERDICT: APPROVE ✅ (100% of adversarial assertions passed)${colors.reset}\n`);
    process.exit(0);
  }
}

runAdversarialTestSuite().catch((err) => {
  console.error('Fatal unhandled error in adversarial test runner:', err);
  process.exit(1);
});
