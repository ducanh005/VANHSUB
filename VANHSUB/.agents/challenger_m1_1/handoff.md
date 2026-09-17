# Milestone 1 Adversarial Challenge Report: Dedicated Settings & Store

## Verdict: REQUEST_CHANGES

---

## 1. Observation

Adversarial stress-testing was executed against `main/store/aiStudioStore.ts` across 5 challenge scenarios using two dedicated test harnesses:
- `scripts/test_adversarial_ai_studio_store.ts` (14 automated stress test cases via `npx tsx`)
- `scripts/test_adversarial_ai_studio_store_electron.js` (Native Windows DPAPI verification via `npx electron`)

### Test Execution Summary:
- Total tests executed: 14
- Passed: 11
- **Failed: 3 (Critical)**

### Verbatim Test Execution Output:
```text
================================================================================
  MILESTONE 1 ADVERSARIAL STRESS TEST SUITE
  Target: main/store/aiStudioStore.ts
  Test Dir: C:\Users\MTLS\AppData\Local\Temp\vanhsub-m1-adversarial-1789628179345-o66bo
================================================================================

--- RUNNING SCENARIO 1: Concurrent Partial Updates ---
[Scenario 1] ✅ PASS: 1.1 Concurrent 50-task partial updates across 5 sections
   Detail: All 5 sections intact, sibling fields preserved, disk sync verified. Final temp: 0.55, voice rate: +1%
[Scenario 1] ✅ PASS: 1.2 Empty partial updates resilience
   Detail: Empty objects did not corrupt state

--- RUNNING SCENARIO 2: Corrupted On-Disk JSON File Resilience ---
[Scenario 2] ❌ FAIL: 2.1 Syntax-corrupted JSON file resilience (getAiStudioConfig)
   Detail: Fatal crash occurred instead of default fallback: [SyntaxError] Unterminated string in JSON at position 28 (line 1 column 29)
   Error:  SyntaxError: Unterminated string in JSON at position 28 (line 1 column 29)
    at JSON.parse (<anonymous>)
    at ElectronStore._deserialize (D:\DEAN\DEAN\VANHSUB\node_modules\conf\dist\source\index.js:378:34)
    at parseStore (D:\DEAN\DEAN\VANHSUB\node_modules\conf\dist\source\index.js:213:47)
    at ElectronStore.get store (D:\DEAN\DEAN\VANHSUB\node_modules\conf\dist\source\index.js:219:20)
    at ElectronStore.#initializeStore (D:\DEAN\DEAN\VANHSUB\node_modules\conf\dist\source\index.js:638:32)
    at new Conf (D:\DEAN\DEAN\VANHSUB\node_modules\conf\dist\source\index.js:60:14)
    at new ElectronStore (D:\DEAN\DEAN\VANHSUB\node_modules\electron-store\index.js:69:3)
    at getAiStudioStore (D:\DEAN\DEAN\VANHSUB\main\store\aiStudioStore.ts:148:22)
    at getAiStudioConfig (D:\DEAN\DEAN\VANHSUB\main\store\aiStudioStore.ts:175:17)
    at runTestSuite (D:\DEAN\DEAN\VANHSUB\scripts\test_adversarial_ai_studio_store.ts:234:25)
[Scenario 2] ❌ FAIL: 2.2 0-byte file resilience (getAiStudioConfig)
   Detail: Fatal crash on 0-byte file instead of default fallback: [SyntaxError] Unexpected end of JSON input
   Error:  SyntaxError: Unexpected end of JSON input
    at JSON.parse (<anonymous>)
    at ElectronStore._deserialize (D:\DEAN\DEAN\VANHSUB\node_modules\conf\dist\source\index.js:378:34)
    at parseStore (D:\DEAN\DEAN\VANHSUB\node_modules\conf\dist\source\index.js:213:47)
    at ElectronStore.get store (D:\DEAN\DEAN\VANHSUB\node_modules\conf\dist\source\index.js:219:20)
    at ElectronStore.#initializeStore (D:\DEAN\DEAN\VANHSUB\node_modules\conf\dist\source\index.js:638:32)
    at new Conf (D:\DEAN\DEAN\VANHSUB\node_modules\conf\dist\source\index.js:60:14)
    at new ElectronStore (D:\DEAN\DEAN\VANHSUB\node_modules\electron-store\index.js:69:3)
    at getAiStudioStore (D:\DEAN\DEAN\VANHSUB\main\store\aiStudioStore.ts:148:22)
    at getAiStudioConfig (D:\DEAN\DEAN\VANHSUB\main\store\aiStudioStore.ts:175:17)
    at runTestSuite (D:\DEAN\DEAN\VANHSUB\scripts\test_adversarial_ai_studio_store.ts:277:24)
[Scenario 2] ❌ FAIL: 2.3 resetAiStudioConfig() on corrupted file
   Detail: Cannot reset configuration when on-disk file is corrupted: [SyntaxError] Unexpected token 'M', "MALFORMED "... is not valid JSON
   Error:  SyntaxError: Unexpected token 'M', "MALFORMED "... is not valid JSON
    at JSON.parse (<anonymous>)
    at ElectronStore._deserialize (D:\DEAN\DEAN\VANHSUB\node_modules\conf\dist\source\index.js:378:34)
    at parseStore (D:\DEAN\DEAN\VANHSUB\node_modules\conf\dist\source\index.js:213:47)
    at ElectronStore.get store (D:\DEAN\DEAN\VANHSUB\node_modules\conf\dist\source\index.js:219:20)
    at ElectronStore.#initializeStore (D:\DEAN\DEAN\VANHSUB\node_modules\conf\dist\source\index.js:638:32)
    at new Conf (D:\DEAN\DEAN\VANHSUB\node_modules\conf\dist\source\index.js:60:14)
    at new ElectronStore (D:\DEAN\DEAN\VANHSUB\node_modules\electron-store\index.js:69:3)
    at getAiStudioStore (D:\DEAN\DEAN\VANHSUB\main\store\aiStudioStore.ts:148:22)
    at resetAiStudioConfig (D:\DEAN\DEAN\VANHSUB\main\store\aiStudioStore.ts:273:17)
    at runTestSuite (D:\DEAN\DEAN\VANHSUB\scripts\test_adversarial_ai_studio_store.ts:310:21)
[Scenario 2] ✅ PASS: 2.4 Null / primitive section type fallback
   Detail: Cleanly handled null & primitive section replacements

--- RUNNING SCENARIO 3: API Key Encryption Security ---
[Scenario 3] ✅ PASS: 3.1 Idempotent encryption (enc:v1: prefix check)
   Detail: Keys already starting with enc:v1: are never double-encrypted
[Scenario 3] ✅ PASS: 3.2 Whitespace API key normalization
   Detail: Whitespace apiKey normalized to empty string
[Scenario 3] ✅ PASS: 3.3 Ciphertext preservation on disk
   Detail: Ciphertext with enc:v1: stored verbatim on disk without mutation
[Scenario 3] ✅ PASS: 3.4 Corrupted ciphertext graceful fallback
   Detail: Corrupted ciphertext safely returned empty string without crashing

--- RUNNING SCENARIO 4: Reset Integrity ---
[Scenario 4] ✅ PASS: 4.1 Reset restores exact specification defaults and purges stale keys
   Detail: All 5 sections restored to spec defaults, foreign keys purged, apiKey is empty string
[Scenario 4] ✅ PASS: 4.2 Reset idempotence
   Detail: Subsequent reset call remains consistent

--- RUNNING SCENARIO 5: Cross-Store Isolation ---
[Scenario 5] ✅ PASS: 5.1 vanhsub-settings.json immutability verification
   Detail: Canary file byte-for-byte identical (SHA256: e2f1e157336917a6..., size: 310 bytes)
[Scenario 5] ✅ PASS: 5.2 Zero key contamination between stores
   Detail: No AI Studio keys leaked to settingsStore; no settingsStore keys leaked to aiStudioStore
```

### Electron Native DPAPI Verification (`scripts/test_adversarial_ai_studio_store_electron.js`):
```text
[DPAPI] safeStorage.isEncryptionAvailable(): true
[Test 3.1] Ciphertext generated: enc:v1:djEwfV+mghLNKvDVYs...
[Test 3.1] Prefix enc:v1: verified: true
[Test 3.1] Plaintext absent from ciphertext: true
[Test 3.2] No double encryption: true
[Test 3.3] Round-trip decryption matches original: true
[Test 3.4] Plaintext NEVER stored on disk: true
[Test 3.4] Ciphertext verified on disk: true

DPAPI Verification Status: ALL TESTS PASSED
```

---

## 2. Logic Chain

1. **Failure in Scenario 2 (Corrupted On-Disk JSON File Resilience)**:
   - *Requirement*: Dispatch explicitly mandates: `"2. Corrupted on-disk JSON file resilience (ensure default fallback instead of fatal crash)."`
   - *Implementation in `main/store/aiStudioStore.ts`*:
     Lines 145-154:
     ```typescript
     export function getAiStudioStore(): Store<AiStudioConfig> {
       if (!_aiStudioStore) {
         const cwd = resolveAiStudioCwd();
         _aiStudioStore = new Store<AiStudioConfig>({
           name: 'vanhsub-ai-studio',
           ...(cwd ? { cwd } : {}),
           defaults: JSON.parse(JSON.stringify(DEFAULT_AI_STUDIO_CONFIG)),
         });
       }
       return _aiStudioStore;
     }
     ```
   - In `node_modules/conf` (underlying `electron-store`), the constructor immediately reads and attempts `JSON.parse` on the on-disk file during instantiation (`this.#initializeStore()` -> `parseStore()` -> `JSON.parse()`).
   - If the file has invalid syntax, is truncated, or is 0 bytes (e.g. from an OS crash, power cut, or partial write), `new Store(...)` throws an uncaught `SyntaxError`.
   - In `main/store/aiStudioStore.ts` line 180, the worker attempted default merging:
     ```typescript
     const raw = store.store;
     const config: AiStudioConfig = JSON.parse(JSON.stringify(raw));
     // Merge with defaults to protect against corrupted or partially populated JSON files
     const merged: AiStudioConfig = { ... }
     ```
     However, this code is unreachable because line 175 (`const store = getAiStudioStore();`) crashes during `new Store<AiStudioConfig>()` before `getAiStudioConfig()` can inspect or merge anything.
   - Even worse, `resetAiStudioConfig()` also calls `getAiStudioStore()` on line 273 and crashes immediately with `SyntaxError`. The user is completely unable to reset or recover their configuration, deadlocking the AI Studio subsystem.

2. **Success in Scenario 1 (Concurrent Partial Updates)**:
   - 50 concurrent async tasks executing interleaved mutations across all 5 sections completed without race-condition data loss because `updateAiStudioConfig` operates synchronously from snapshot read to disk write in each event loop tick, and merges sections with `...(current.<section>)` and `...(partial.<section> || {})`.

3. **Success in Scenario 3 (API Key DPAPI Encryption Security)**:
   - Direct verification inside Electron runtime confirmed Windows DPAPI (`safeStorage.encryptString`) encrypts plaintext keys into `enc:v1:<base64>`.
   - Direct inspection of the raw JSON file on disk proved plaintext is NEVER written to storage when DPAPI is available.
   - Idempotency check verified keys starting with `enc:v1:` are not re-encrypted.
   - Decryption correctly recovers plaintext only when `{ decrypted: true }` is requested.

4. **Success in Scenario 4 (Reset Integrity)**:
   - When the store is readable, `resetAiStudioConfig()` writes clean `DEFAULT_AI_STUDIO_CONFIG` to disk and purges all injected foreign and stale keys.

5. **Success in Scenario 5 (Cross-Store Isolation)**:
   - The canary `vanhsub-settings.json` file remained 100% untouched (exact SHA256 checksum and size match), proving zero interference or contamination between stores.

---

## 3. Caveats

- In headless Node.js environments (`npx tsx`) without active Electron runtime, Electron's `safeStorage` is unavailable (`typeof electron !== 'object'`). In this mode, `encryptSecret` safely falls back to plaintext as designed. Native DPAPI encryption was verified separately inside the actual Electron runtime using `scripts/test_adversarial_ai_studio_store_electron.js`.
- File locking under multi-process concurrent access (multiple distinct OS processes opening `vanhsub-ai-studio.json` at the exact same millisecond) was not simulated, as Electron desktop apps run as a single main process.

---

## 4. Conclusion

**Verdict: REQUEST_CHANGES**

Milestone 1 satisfies Scenarios 1, 3, 4, and 5. However, it fails Scenario 2 (`Corrupted on-disk JSON file resilience`), which causes an unhandled fatal application crash when `vanhsub-ai-studio.json` contains corrupted syntax or is 0 bytes.

### Actionable Remediation for Worker M1:
In `main/store/aiStudioStore.ts`, update `getAiStudioStore()` to wrap `new Store(...)` in a `try / catch` block:
```typescript
export function getAiStudioStore(): Store<AiStudioConfig> {
  if (!_aiStudioStore) {
    const cwd = resolveAiStudioCwd();
    const storeOptions = {
      name: 'vanhsub-ai-studio',
      ...(cwd ? { cwd } : {}),
      defaults: JSON.parse(JSON.stringify(DEFAULT_AI_STUDIO_CONFIG)),
    };

    try {
      _aiStudioStore = new Store<AiStudioConfig>(storeOptions);
      // Access store once to trigger deserialize check
      void _aiStudioStore.store;
    } catch (err) {
      console.warn('[aiStudioStore] Corrupted config file detected on disk. Backing up and resetting to defaults:', err);
      // Delete or backup corrupted file so new Store can recreate clean file
      if (cwd) {
        const filePath = path.join(cwd, 'vanhsub-ai-studio.json');
        try {
          if (fs.existsSync(filePath)) {
            const backupPath = path.join(cwd, `vanhsub-ai-studio.corrupted.${Date.now()}.json`);
            fs.renameSync(filePath, backupPath);
          }
        } catch (backupErr) {
          console.error('[aiStudioStore] Failed to backup corrupted file, unlinking:', backupErr);
          try { fs.unlinkSync(path.join(cwd, 'vanhsub-ai-studio.json')); } catch {}
        }
      }
      _aiStudioStore = new Store<AiStudioConfig>(storeOptions);
    }
  }
  return _aiStudioStore;
}
```
This guarantees that any corrupted file is automatically backed up and reset to clean specification defaults without crashing the app.

---

## 5. Verification Method

1. **Run Adversarial Stress Test Suite**:
   ```powershell
   npx tsx scripts/test_adversarial_ai_studio_store.ts
   ```
   *Current Result*: Exit code 1 (3 failures in Scenario 2).
   *Expected Result after fix*: Exit code 0 (14/14 tests pass).

2. **Run Native Electron DPAPI Verification**:
   ```powershell
   npx electron scripts/test_adversarial_ai_studio_store_electron.js
   ```
   *Result*: Exit code 0 (All DPAPI tests pass).

3. **Manual Corruption Repro Command**:
   ```powershell
   npx tsx -e "import fs from 'fs'; import path from 'path'; import os from 'os'; const d = path.join(os.tmpdir(), 'repro'); fs.mkdirSync(d, {recursive: true}); fs.writeFileSync(path.join(d, 'vanhsub-ai-studio.json'), '{ bad json'); process.env.VANHSUB_AI_STUDIO_DIR = d; import('./main/store/aiStudioStore').then(m => m.getAiStudioConfig()).catch(e => console.log('CONFIRMED_FATAL_CRASH:', e.name));"
   ```
