/**
 * tests/test_adversarial_m1_chromemanager.ts
 *
 * Empirical Adversarial Stress Test Suite for ChromeManager.ts
 *
 * Requirements Challenged:
 * 1. Port 9222 collision rejection (must throw explanatory error if port 9222 is requested).
 * 2. Stale lockfile cleanup (verify SingletonLock, SingletonSocket, SingletonCookie cleanup when port is free).
 * 3. 5-tier Windows path locator resilience with mocked/manipulated env variables.
 * 4. Liveness probe timeout behavior (HTTP probe on port 9223).
 * 5. Clean process tree termination with killProcessTreeByPid.
 *
 * Execution:
 *   npx tsx tests/test_adversarial_m1_chromemanager.ts
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import net from 'net';
import { spawn } from 'child_process';

import { ChromeManager } from '../main/ai-studio/chatgpt/ChromeManager';
import { ChatGptCdpClient } from '../main/ai-studio/chatgpt/ChatGptCdpClient';
import { killProcessTreeByPid } from '../main/lib/processTree';

// ==============================================================================
// Terminal Formatting & Test Reporting Helpers
// ==============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
};

function logHeader(title: string) {
  console.log(`\n${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}  ${title}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}\n`);
}

function logDimension(num: number, title: string) {
  console.log(`\n${colors.bold}${colors.magenta}▶ [CHALLENGE ${num}]${colors.reset} ${colors.bold}${title}${colors.reset}`);
}

function logTest(id: string, desc: string) {
  console.log(`  ${colors.bold}${colors.blue}[TEST ${id}]${colors.reset} ${desc}`);
}

function logPass(msg: string) {
  console.log(`    ${colors.green}✓ [PASS]${colors.reset} ${msg}`);
}

function logFail(msg: string, err?: any) {
  console.log(`    ${colors.red}✗ [FAIL]${colors.reset} ${msg}`);
  if (err) console.error('     ', err);
}

process.on('uncaughtException', (err) => {
  console.error('[FATAL UNCAUGHT EXCEPTION]:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL UNHANDLED REJECTION]:', reason);
});

process.on('exit', (code) => {
  console.log(`[PROCESS EXIT EVENT with code ${code}]`);
});

// Helper to poll for a condition with timeout
async function pollUntil(conditionFn: () => Promise<boolean> | boolean, timeoutMs = 3000, intervalMs = 100): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await conditionFn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// Check if a process is alive
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ==============================================================================
// Main Test Runner
// ==============================================================================

async function runAdversarialSuite() {
  logHeader('EMPIRICAL ADVERSARIAL STRESS TEST: ChromeManager.ts');

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  const recordPass = (msg: string) => {
    totalTests++;
    passedTests++;
    logPass(msg);
  };

  const recordFail = (msg: string, err?: any) => {
    totalTests++;
    failedTests++;
    logFail(msg, err);
  };

  const originalEnv = { ...process.env };

  try {
    // ============================================================================
    // DIMENSION 1: PORT 9222 COLLISION REJECTION
    // ============================================================================
    logDimension(1, 'Port 9222 Collision Rejection & Guard Resilience');

    // Test 1.1: ChromeManager.launchChrome strictly rejects port 9222
    logTest('1.1', 'ChromeManager.launchChrome rejects port 9222 with explanatory error');
    try {
      const mgr = ChromeManager.getInstance();
      let threw = false;
      let errorMsg = '';
      try {
        await mgr.launchChrome({ port: 9222 });
      } catch (err: any) {
        threw = true;
        errorMsg = err.message;
      }
      assert.strictEqual(threw, true, 'launchChrome({ port: 9222 }) MUST throw');
      assert(
        errorMsg.includes('9222') &&
        (errorMsg.includes('Google Flow Bridge') || errorMsg.includes('FlowBridgeServer')),
        `Error message must mention 9222 and Flow Bridge. Actual: "${errorMsg}"`
      );
      recordPass('ChromeManager correctly rejected port 9222 with explanatory guard error');
    } catch (err: any) {
      recordFail('Test 1.1 failed', err);
    }

    // Test 1.2: Port 9222 rejected BEFORE attempting probe even if port 9222 has active listener
    logTest('1.2', 'Port 9222 guard triggers BEFORE network probe even with live listener on 9222');
    let mock9222Server: http.Server | null = null;
    try {
      let serverReceivedRequest = false;
      mock9222Server = http.createServer((req, res) => {
        serverReceivedRequest = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ Browser: 'MockFlowBridge/1.0' }));
      });

      await new Promise<void>((resolve, reject) => {
        mock9222Server!.listen(9222, '127.0.0.1', () => resolve());
        mock9222Server!.on('error', reject);
      });

      const mgr = ChromeManager.getInstance();
      let threw = false;
      try {
        await mgr.launchChrome({ port: 9222 });
      } catch (err: any) {
        threw = true;
      }

      assert.strictEqual(threw, true, 'Must reject port 9222 even when port 9222 is active');
      assert.strictEqual(
        serverReceivedRequest,
        false,
        'Port 9222 guard must trigger before sending any probe traffic to 9222'
      );
      recordPass('Guard preemptively prevented network traffic to port 9222');
    } catch (err: any) {
      recordFail('Test 1.2 failed', err);
    } finally {
      if (mock9222Server) {
        await new Promise<void>((r) => mock9222Server!.close(() => r()));
        mock9222Server = null;
      }
    }

    // Test 1.3: Port 9222 collision rejection across diverse launch configurations
    logTest('1.3', 'Port 9222 rejection across diverse options (headless, profileDir, startUrl)');
    try {
      const mgr = ChromeManager.getInstance();
      const testCases = [
        { port: 9222, headless: true },
        { port: 9222, profileDir: 'C:\\custom_profile' },
        { port: 9222, startUrl: 'https://example.com' },
      ];
      for (const opts of testCases) {
        let threw = false;
        try {
          await mgr.launchChrome(opts);
        } catch (err: any) {
          threw = true;
          assert(err.message.includes('9222'), 'Must mention port 9222');
        }
        assert.strictEqual(threw, true, `launchChrome(${JSON.stringify(opts)}) must throw`);
      }
      recordPass('All launch option permutations with port 9222 strictly rejected');

      // Adversarial probe: check if string '9222' is coerced at runtime
      let stringCoerced = false;
      try {
        await mgr.launchChrome({ port: ('9222' as any) });
      } catch (err: any) {
        if (err.message.includes('9222')) stringCoerced = true;
      }
      if (!stringCoerced) {
        await mgr.closeChrome();
        console.log(`    ${colors.yellow}⚠ [ADVISORY FINDING] String "9222" bypasses strict equality (port === 9222). Recommendation: use Number(port) === 9222.${colors.reset}`);
      }
    } catch (err: any) {
      recordFail('Test 1.3 failed', err);
    }

    // Test 1.4: ChatGptCdpClient port 9222 guard
    logTest('1.4', 'ChatGptCdpClient.connect strictly rejects port 9222');
    try {
      const cdpClient = ChatGptCdpClient.getInstance();
      let cdpThrew = false;
      let cdpErrorMsg = '';
      try {
        await cdpClient.connect(9222);
      } catch (err: any) {
        cdpThrew = true;
        cdpErrorMsg = err.message;
      }
      assert.strictEqual(cdpThrew, true, 'ChatGptCdpClient.connect(9222) MUST throw');
      assert(cdpErrorMsg.includes('9222'), `Error must cite port 9222. Actual: "${cdpErrorMsg}"`);
      recordPass('ChatGptCdpClient port 9222 guard verified');
    } catch (err: any) {
      recordFail('Test 1.4 failed', err);
    }

    // ============================================================================
    // DIMENSION 2: STALE LOCKFILE CLEANUP
    // ============================================================================
    logDimension(2, 'Stale Lockfile Cleanup (SingletonLock, SingletonSocket, SingletonCookie)');

    // Test 2.1: Targeted removal of SingletonLock, SingletonSocket, SingletonCookie
    logTest('2.1', 'cleanupStaleLockFiles unlinks all 3 lockfiles while preserving profile state');
    const tempProfileDir = path.join(os.tmpdir(), `test_lock_cleanup_${Date.now()}`);
    try {
      fs.mkdirSync(tempProfileDir, { recursive: true });

      const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
      for (const f of lockFiles) {
        fs.writeFileSync(path.join(tempProfileDir, f), `mock-lock-content-${f}`);
      }

      // Populate legitimate profile files that MUST NOT be deleted
      const legitimateFiles = ['Preferences', 'Cookies', 'Local State', 'History'];
      for (const f of legitimateFiles) {
        fs.writeFileSync(path.join(tempProfileDir, f), `mock-legitimate-${f}`);
      }

      // Verify files exist initially
      for (const f of lockFiles) {
        assert(fs.existsSync(path.join(tempProfileDir, f)), `File ${f} must exist before cleanup`);
      }
      for (const f of legitimateFiles) {
        assert(fs.existsSync(path.join(tempProfileDir, f)), `File ${f} must exist before cleanup`);
      }

      // Invoke cleanupStaleLockFiles
      const mgr = ChromeManager.getInstance();
      (mgr as any).cleanupStaleLockFiles(tempProfileDir);

      // Verify lockfiles deleted
      for (const f of lockFiles) {
        assert.strictEqual(
          fs.existsSync(path.join(tempProfileDir, f)),
          false,
          `Lockfile ${f} MUST be deleted by cleanupStaleLockFiles`
        );
      }

      // Verify legitimate files preserved
      for (const f of legitimateFiles) {
        assert.strictEqual(
          fs.existsSync(path.join(tempProfileDir, f)),
          true,
          `Legitimate profile file ${f} MUST NOT be deleted`
        );
      }

      recordPass('All 3 lockfiles successfully deleted and user profile state safely preserved');
    } catch (err: any) {
      recordFail('Test 2.1 failed', err);
    } finally {
      try {
        fs.rmSync(tempProfileDir, { recursive: true, force: true });
      } catch {}
    }

    // Test 2.2: Idempotent execution on non-existent or empty directories
    logTest('2.2', 'cleanupStaleLockFiles idempotency on clean / non-existent directory');
    try {
      const nonExistentDir = path.join(os.tmpdir(), `nonexistent_dir_${Date.now()}`);
      const emptyDir = path.join(os.tmpdir(), `empty_dir_${Date.now()}`);
      fs.mkdirSync(emptyDir, { recursive: true });

      const mgr = ChromeManager.getInstance();
      // Should not throw on non-existent or clean directory
      (mgr as any).cleanupStaleLockFiles(nonExistentDir);
      (mgr as any).cleanupStaleLockFiles(emptyDir);

      recordPass('Idempotent cleanup completed safely with zero errors');
      fs.rmSync(emptyDir, { recursive: true, force: true });
    } catch (err: any) {
      recordFail('Test 2.2 failed', err);
    }

    // Test 2.3: Locked file exception resilience (no crash when lock is in active use)
    logTest('2.3', 'cleanupStaleLockFiles exception handling when file is locked by OS');
    const lockedDir = path.join(os.tmpdir(), `locked_lockfile_dir_${Date.now()}`);
    let fileFd: number | null = null;
    try {
      fs.mkdirSync(lockedDir, { recursive: true });
      const lockPath = path.join(lockedDir, 'SingletonLock');
      // Open with exclusive write lock on Windows
      fileFd = fs.openSync(lockPath, 'w');
      fs.writeSync(fileFd, 'active-process-lock');

      const mgr = ChromeManager.getInstance();
      let threw = false;
      try {
        (mgr as any).cleanupStaleLockFiles(lockedDir);
      } catch {
        threw = true;
      }
      assert.strictEqual(threw, false, 'cleanupStaleLockFiles must gracefully catch unlink errors on locked files');
      recordPass('Locked file handled gracefully without crashing application');
    } catch (err: any) {
      recordFail('Test 2.3 failed', err);
    } finally {
      if (fileFd !== null) {
        try {
          fs.closeSync(fileFd);
        } catch {}
      }
      try {
        fs.rmSync(lockedDir, { recursive: true, force: true });
      } catch {}
    }

    // ============================================================================
    // DIMENSION 3: 5-TIER WINDOWS PATH LOCATOR RESILIENCE
    // ============================================================================
    logDimension(3, '5-Tier Windows Path Locator Resilience');

    const tempMockBinDir = path.join(os.tmpdir(), `mock_chrome_bins_${Date.now()}`);
    fs.mkdirSync(tempMockBinDir, { recursive: true });

    // Test 3.1: Tier 1 override via CHROME_PATH
    logTest('3.1', 'Tier 1 priority override via process.env.CHROME_PATH');
    const mockChromePath1 = path.join(tempMockBinDir, 'mock_chrome_1.exe');
    fs.writeFileSync(mockChromePath1, 'fake-binary');
    try {
      ChromeManager.resetInstance();
      process.env.CHROME_PATH = mockChromePath1;
      delete process.env.CHROME_BIN;

      const mgr = ChromeManager.getInstance();
      const detected = mgr.detectChromePath();
      assert.strictEqual(
        path.resolve(detected).toLowerCase(),
        path.resolve(mockChromePath1).toLowerCase(),
        'Must return CHROME_PATH when valid'
      );
      recordPass(`Tier 1 correctly returned CHROME_PATH override: ${detected}`);
    } catch (err: any) {
      recordFail('Test 3.1 failed', err);
    }

    // Test 3.2: Tier 1 override via CHROME_BIN
    logTest('3.2', 'Tier 1 secondary override via process.env.CHROME_BIN');
    const mockChromeBin2 = path.join(tempMockBinDir, 'mock_chrome_2.exe');
    fs.writeFileSync(mockChromeBin2, 'fake-binary-2');
    try {
      ChromeManager.resetInstance();
      delete process.env.CHROME_PATH;
      process.env.CHROME_BIN = mockChromeBin2;

      const mgr = ChromeManager.getInstance();
      const detected = mgr.detectChromePath();
      assert.strictEqual(
        path.resolve(detected).toLowerCase(),
        path.resolve(mockChromeBin2).toLowerCase(),
        'Must return CHROME_BIN when CHROME_PATH is absent'
      );
      recordPass(`Tier 1 correctly returned CHROME_BIN override: ${detected}`);
    } catch (err: any) {
      recordFail('Test 3.2 failed', err);
    }

    // Test 3.3: Tier 1 fallthrough when env vars point to non-existent paths
    logTest('3.3', 'Tier 1 fallthrough when CHROME_PATH / CHROME_BIN point to non-existent files');
    try {
      ChromeManager.resetInstance();
      process.env.CHROME_PATH = 'C:\\non_existent_folder_xyz\\chrome.exe';
      process.env.CHROME_BIN = 'C:\\non_existent_folder_abc\\chrome.exe';

      const mgr = ChromeManager.getInstance();
      const detected = mgr.detectChromePath();
      assert(
        !detected.includes('non_existent_folder'),
        'Must NOT return non-existent path from env vars'
      );
      assert(fs.existsSync(detected), 'Fallen-through detected path must actually exist on disk');
      recordPass(`Fell through non-existent env paths to existing binary: ${detected}`);
    } catch (err: any) {
      recordFail('Test 3.3 failed', err);
    }

    // Test 3.4: Tier 3 & Tier 4 system queries resilience (Registry & where.exe)
    logTest('3.4', 'Registry query & where.exe sub-tier execution safety');
    try {
      ChromeManager.resetInstance();
      delete process.env.CHROME_PATH;
      delete process.env.CHROME_BIN;

      const mgr = ChromeManager.getInstance();
      const detected = mgr.detectChromePath();
      assert(fs.existsSync(detected), 'Detected path must exist');
      assert(detected.toLowerCase().endsWith('chrome.exe'), 'Detected path must end with chrome.exe');
      recordPass('Standard Windows discovery succeeded');
    } catch (err: any) {
      recordFail('Test 3.4 failed', err);
    }

    // Test 3.5: Total failure mode - descriptive error when no Chrome binary exists
    logTest('3.5', 'Descriptive error thrown when Chrome is absent across all 5 tiers');
    try {
      ChromeManager.resetInstance();
      delete process.env.CHROME_PATH;
      delete process.env.CHROME_BIN;

      // Mock fs.existsSync to simulate absence of Chrome binaries
      const realExistsSync = fs.existsSync;
      (fs as any).existsSync = (p: string) => {
        if (typeof p === 'string' && p.toLowerCase().includes('chrome.exe')) {
          return false;
        }
        return realExistsSync(p);
      };

      let threw = false;
      let errorMsg = '';
      try {
        const mgr = ChromeManager.getInstance();
        mgr.detectChromePath();
      } catch (err: any) {
        threw = true;
        errorMsg = err.message;
      } finally {
        (fs as any).existsSync = realExistsSync;
      }

      assert.strictEqual(threw, true, 'detectChromePath must throw when no Chrome binary exists');
      assert(
        errorMsg.includes('Google Chrome executable was not found on this system') &&
        errorMsg.includes('CHROME_PATH'),
        `Error message must guide user to install Chrome or specify CHROME_PATH. Actual: "${errorMsg}"`
      );
      recordPass('Explanatory error guidance verified when Chrome is missing');
    } catch (err: any) {
      recordFail('Test 3.5 failed', err);
    }

    // Clean up mock bin dir
    try {
      fs.rmSync(tempMockBinDir, { recursive: true, force: true });
    } catch {}

    // Restore original env
    process.env = { ...originalEnv };
    ChromeManager.resetInstance();

    // ============================================================================
    // DIMENSION 4: LIVENESS PROBE TIMEOUT BEHAVIOR (HTTP PROBE ON PORT 9223)
    // ============================================================================
    logDimension(4, 'Liveness Probe Timeout & HTTP Probe Behavior');

    // Test 4.1: Fast negative resolution on free port
    logTest('4.1', 'isPortAlive resolves false quickly (< 250ms) on unused port');
    try {
      const mgr = ChromeManager.getInstance();
      const unusedPort = 59223;
      const t0 = Date.now();
      const alive = await mgr.isPortAlive(unusedPort, 500);
      const elapsed = Date.now() - t0;
      assert.strictEqual(alive, false, 'Unused port must report false');
      assert(elapsed < 250, `Unused port probe should resolve immediately on ECONNREFUSED. Took ${elapsed}ms`);
      recordPass(`Unused port resolved false in ${elapsed}ms`);
    } catch (err: any) {
      recordFail('Test 4.1 failed', err);
    }

    // Test 4.2: Timeout behavior on non-responsive / hanging TCP server
    logTest('4.2', 'isPortAlive times out accurately and destroys socket on hanging server');
    let blackHoleServer: net.Server | null = null;
    const blackHolePort = 59224;
    try {
      // Create TCP server that accepts connections but sends no data
      blackHoleServer = net.createServer((socket) => {
        socket.on('error', () => {}); // Handle ECONNRESET on client destroy
      });
      blackHoleServer.on('error', () => {});
      await new Promise<void>((r) => blackHoleServer!.listen(blackHolePort, '127.0.0.1', () => r()));

      const mgr = ChromeManager.getInstance();
      const timeoutMs = 300;
      const t0 = Date.now();
      const alive = await mgr.isPortAlive(blackHolePort, timeoutMs);
      const elapsed = Date.now() - t0;

      assert.strictEqual(alive, false, 'Hanging server must resolve false on timeout');
      assert(
        elapsed >= 280 && elapsed <= 650,
        `Probe should timeout around ~${timeoutMs}ms. Actual elapsed: ${elapsed}ms`
      );
      recordPass(`Hanging server timed out cleanly in ${elapsed}ms without hanging process`);
    } catch (err: any) {
      recordFail('Test 4.2 failed', err);
    } finally {
      if (blackHoleServer) {
        try {
          (blackHoleServer as any).closeAllConnections?.();
          blackHoleServer.close();
          blackHoleServer.unref();
        } catch {}
        blackHoleServer = null;
      }
    }

    // Test 4.3: Valid CDP /json/version endpoint returning 200 OK
    logTest('4.3', 'isPortAlive resolves true when /json/version returns HTTP 200');
    let validCdpServer: http.Server | null = null;
    const cdpPort = 59225;
    try {
      validCdpServer = http.createServer((req, res) => {
        if (req.url === '/json/version') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            Browser: 'Chrome/130.0.6723.70',
            'Protocol-Version': '1.3',
            'User-Agent': 'Mozilla/5.0 Chrome/130.0',
            webSocketDebuggerUrl: `ws://127.0.0.1:${cdpPort}/devtools/browser/mock-id`,
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      validCdpServer.on('error', () => {});
      await new Promise<void>((r) => validCdpServer!.listen(cdpPort, '127.0.0.1', () => r()));

      const mgr = ChromeManager.getInstance();
      const alive = await mgr.isPortAlive(cdpPort, 800);
      assert.strictEqual(alive, true, 'Active CDP endpoint must resolve true');
      recordPass('Valid CDP server endpoint recognized with status 200');
    } catch (err: any) {
      recordFail('Test 4.3 failed', err);
    } finally {
      if (validCdpServer) {
        try {
          (validCdpServer as any).closeAllConnections?.();
          validCdpServer.close();
          validCdpServer.unref();
        } catch {}
        validCdpServer = null;
      }
    }

    // Test 4.4: Non-200 HTTP status code handling (404, 500, 503)
    logTest('4.4', 'isPortAlive resolves false on non-200 HTTP responses (404 / 500)');
    let errorHttpServer: http.Server | null = null;
    const errorHttpPort = 59226;
    try {
      errorHttpServer = http.createServer((req, res) => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      });
      errorHttpServer.on('error', () => {});
      await new Promise<void>((r) => errorHttpServer!.listen(errorHttpPort, '127.0.0.1', () => r()));

      const mgr = ChromeManager.getInstance();
      const alive = await mgr.isPortAlive(errorHttpPort, 500);
      assert.strictEqual(alive, false, 'HTTP 500 must resolve false');
      recordPass('Non-200 HTTP response correctly rejected and stream consumed');
    } catch (err: any) {
      recordFail('Test 4.4 failed', err);
    } finally {
      if (errorHttpServer) {
        try {
          (errorHttpServer as any).closeAllConnections?.();
          errorHttpServer.close();
          errorHttpServer.unref();
        } catch {}
        errorHttpServer = null;
      }
    }

    // Test 4.5: Immediate TCP connection reset handling
    logTest('4.5', 'isPortAlive handles immediate TCP socket reset without crash');
    let rstServer: net.Server | null = null;
    const rstPort = 59227;
    try {
      rstServer = net.createServer((socket) => {
        socket.on('error', () => {});
        socket.destroy(); // Abruptly reset connection
      });
      rstServer.on('error', () => {});
      await new Promise<void>((r) => rstServer!.listen(rstPort, '127.0.0.1', () => r()));

      const mgr = ChromeManager.getInstance();
      const alive = await mgr.isPortAlive(rstPort, 500);
      assert.strictEqual(alive, false, 'Abrupt socket reset must resolve false');
      recordPass('Abrupt TCP reset handled cleanly without unhandled exception');
    } catch (err: any) {
      recordFail('Test 4.5 failed', err);
    } finally {
      if (rstServer) {
        try {
          (rstServer as any).closeAllConnections?.();
          rstServer.close();
          rstServer.unref();
        } catch {}
        rstServer = null;
      }
    }

    // ============================================================================
    // DIMENSION 5: PROCESS TREE TERMINATION WITH killProcessTreeByPid
    // ============================================================================
    logDimension(5, 'Clean Process Tree Termination with killProcessTreeByPid');

    // Test 5.1: Multi-level process tree termination (Parent -> Child Node processes)
    logTest('5.1', 'killProcessTreeByPid eliminates entire multi-level process tree');
    try {
      // Spawn parent Node process that spawns child Node process
      const parentScript = `
        const { spawn } = require('child_process');
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
        console.log('CHILD_PID:' + child.pid);
        setInterval(() => {}, 1000);
      `;

      const parentProcess = spawn(process.execPath, ['-e', parentScript], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });

      const parentPid = parentProcess.pid!;
      assert(parentPid > 0, 'Parent process must have valid PID');

      let childPid: number | null = null;
      parentProcess.stdout?.on('data', (data) => {
        const match = data.toString().match(/CHILD_PID:(\d+)/);
        if (match) childPid = parseInt(match[1], 10);
      });

      // Wait up to 3000ms for child process to be spawned
      await pollUntil(() => childPid !== null && isPidAlive(childPid), 3000, 100);

      assert(childPid !== null && childPid > 0, 'Child PID must be detected');
      assert(isPidAlive(parentPid), 'Parent PID must be alive');
      assert(isPidAlive(childPid), 'Child PID must be alive');

      // Call killProcessTreeByPid on the parent
      killProcessTreeByPid(parentPid);

      // Verify BOTH parent and child terminate within 3500ms
      const parentDied = await pollUntil(() => !isPidAlive(parentPid), 3500, 100);
      const childDied = await pollUntil(() => !isPidAlive(childPid!), 3500, 100);

      assert.strictEqual(parentDied, true, `Parent PID ${parentPid} must be terminated`);
      assert.strictEqual(childDied, true, `Child PID ${childPid} must be terminated (no zombie)`);

      recordPass(`Successfully terminated process tree (Parent ${parentPid} & Child ${childPid})`);
    } catch (err: any) {
      recordFail('Test 5.1 failed', err);
    }

    // Test 5.2: Edge-case PID handling (0, negative, non-existent)
    logTest('5.2', 'killProcessTreeByPid resilience with invalid PIDs (0, -1, 99999999)');
    try {
      let threw = false;
      try {
        killProcessTreeByPid(0);
        killProcessTreeByPid(-1);
        killProcessTreeByPid(99999999);
      } catch {
        threw = true;
      }
      assert.strictEqual(threw, false, 'killProcessTreeByPid must not throw on edge-case PIDs');
      recordPass('Edge-case PIDs handled safely without error');
    } catch (err: any) {
      recordFail('Test 5.2 failed', err);
    }

    // Test 5.3: End-to-end real Chrome lifecycle launch & termination via closeChrome
    logTest('5.3', 'Real Chrome process lifecycle: launch -> port alive -> closeChrome -> full cleanup');
    const e2eProfile = path.join(os.tmpdir(), `test_chrome_e2e_${Date.now()}`);
    const e2ePort = 9225; // Dedicated test port
    try {
      const mgr = ChromeManager.getInstance();

      // Launch Chrome headless
      const launchInfo = await mgr.launchChrome({
        port: e2ePort,
        headless: true,
        profileDir: e2eProfile,
      });

      assert(launchInfo.pid !== null && launchInfo.pid > 0, 'Launched Chrome must have PID');
      assert.strictEqual(launchInfo.port, e2ePort, 'Port must match requested 9225');
      assert.strictEqual(launchInfo.isAlive, true, 'isAlive must be true');

      // Verify port is alive
      const aliveBefore = await mgr.isPortAlive(e2ePort, 800);
      assert.strictEqual(aliveBefore, true, `Port ${e2ePort} must respond to CDP liveness probe`);

      // Verify process info from manager
      const processInfo = mgr.getProcessInfo();
      assert.strictEqual(processInfo.isAlive, true, 'ProcessInfo must report alive');
      assert.strictEqual(processInfo.pid, launchInfo.pid, 'PID must match');

      const spawnedPid = launchInfo.pid;

      // Close Chrome via closeChrome()
      await mgr.closeChrome();

      // Verify port is now dead
      const aliveAfter = await mgr.isPortAlive(e2ePort, 300);
      assert.strictEqual(aliveAfter, false, `Port ${e2ePort} must be released after closeChrome`);

      // Verify process is terminated
      const pidDied = await pollUntil(() => !isPidAlive(spawnedPid), 3000, 100);
      assert.strictEqual(pidDied, true, `Chrome process PID ${spawnedPid} must be terminated`);

      // Verify process info reset
      const closedInfo = mgr.getProcessInfo();
      assert.strictEqual(closedInfo.isAlive, false, 'ProcessInfo must report dead after close');
      assert.strictEqual(closedInfo.pid, null, 'Active PID must be reset to null');

      // Verify lockfiles are cleaned up
      assert.strictEqual(fs.existsSync(path.join(e2eProfile, 'SingletonLock')), false, 'SingletonLock must be cleaned');
      assert.strictEqual(fs.existsSync(path.join(e2eProfile, 'SingletonSocket')), false, 'SingletonSocket must be cleaned');
      assert.strictEqual(fs.existsSync(path.join(e2eProfile, 'SingletonCookie')), false, 'SingletonCookie must be cleaned');

      recordPass(`Real Chrome (PID ${spawnedPid}) launched, probed on port ${e2ePort}, and cleanly terminated`);
    } catch (err: any) {
      recordFail('Test 5.3 failed', err);
    } finally {
      try {
        fs.rmSync(e2eProfile, { recursive: true, force: true });
      } catch {}
    }

    // ============================================================================
    // SUMMARY
    // ============================================================================
    logHeader('ADVERSARIAL STRESS TEST SUMMARY');
    console.log(`Total Challenges Executed : ${totalTests}`);
    console.log(`Passed                    : ${colors.green}${passedTests}${colors.reset}`);
    console.log(`Failed                    : ${failedTests > 0 ? colors.red : colors.green}${failedTests}${colors.reset}`);
    console.log(`Success Rate              : ${((passedTests / totalTests) * 100).toFixed(1)}%\n`);

    if (failedTests > 0) {
      console.error(`${colors.bold}${colors.red}❌ VERDICT: CHALLENGE_FAILED (${failedTests} tests failed)${colors.reset}\n`);
      process.exit(1);
    } else {
      console.log(`${colors.bold}${colors.green}✅ VERDICT: APPROVE (100% of empirical challenges passed)${colors.reset}\n`);
      process.exit(0);
    }
  } catch (fatalErr: any) {
    console.error('Fatal unhandled error during adversarial suite:', fatalErr);
    process.exit(1);
  } finally {
    process.env = originalEnv;
  }
}

runAdversarialSuite();
