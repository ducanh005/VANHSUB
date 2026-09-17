# Milestone 1 Independent Review & Adversarial Audit Report

**Reviewer**: Reviewer 2 (Adversarial Critic)  
**Assigned Milestone**: Milestone 1 — Dedicated Settings & Store  
**Timestamp**: 2026-09-17T06:55:30Z  
**Verdict**: **REQUEST_CHANGES**

---

## Review Summary

- **Verdict**: `REQUEST_CHANGES`
- **Integrity Status**: **INTEGRITY VIOLATION DETECTED**
- **Test Suite Status**: **FAILED** (`scripts/test_ai_studio_pipeline.ts` exited with code 1; 8 passed, 1 failed)
- **TypeScript Compilation**: **PASSED** (`npx tsc --noEmit` exited with code 0)

---

## 1. Observation

### 1.1 Verbatim Command Execution & Failures

1. **Mandatory Test Suite Execution (`scripts/test_ai_studio_pipeline.ts`)**:
   - Command: `npx tsx scripts/test_ai_studio_pipeline.ts`
   - Result: Exit code 1 (FAILED).
   - Verbatim Output:
     ```text
     [RUN] Test 1: Store Isolation & Configuration Management (F01-F08)
       ℹ [INFO] Loaded live main/store/aiStudioStore module for verification.
       ✓ [PASS] Default configuration schema complies 100% with AI_STUDIO_SPEC.md §5.2
       ✓ [PASS] Configuration update mutations verified across multiple categories
       ✗ [FAIL] Store Isolation & Configuration Management (F01-F08)
         Error: SECURITY VIOLATION: llm.apiKey was stored in plaintext on disk!
         at runAiStudioE2ESuite (D:\DEAN\DEAN\VANHSUB\scripts\test_ai_studio_pipeline.ts:650:15)
     ...
     Test Results Table:
       [FAIL] Test 1: Store Isolation & Configuration Management (F01-F08)    (  190ms)
              Reason: SECURITY VIOLATION: llm.apiKey was stored in plaintext on disk!
       [PASS] Test 2: Idea & LLM Script Fallback/Generation (F09-F10)         (    3ms)
       [PASS] Test 3: Edge TTS Voiceover Synthesis (F11)                      (  989ms)
       [PASS] Test 4: Word-Boundary Alignment Extraction (F12)                (    1ms)
       [PASS] Test 5: Storyboard Visual Prompts Formatting (F13)              (    0ms)
       [PASS] Test 6: Visual Assets Generation - Fallback/Mock Mode (F14)     (  454ms)
       [PASS] Test 7: FFmpeg Video Assembly & ASS Subtitle Burning (F15)      (  280ms)
       [PASS] Test 8: SEO Metadata Generation (F16)                           (    1ms)
       [PASS] Test 9: Checkpoint State Machine & Resumption (F17)             (    5ms)
     --------------------------------------------------------------------------------
     Total Tests:    9
     Passed:         8
     Failed:         1
     Total Duration: 1.92s
     --------------------------------------------------------------------------------
      1 TEST(S) FAILED. CHECK LOGS ABOVE. 
     ```

2. **TypeScript Compilation**:
   - Command: `npx tsc --noEmit`
   - Result: Exit code 0 (Clean compilation, 0 errors).

3. **Plaintext Storage Confirmation in Node.js / CLI Environment**:
   - Command:
     ```powershell
     npx tsx -e "import { getAiStudioConfig, updateAiStudioConfig, getDecryptedAiStudioConfig } from './main/store/aiStudioStore'; updateAiStudioConfig({ llm: { apiKey: 'secret-test' } }); console.log('Stored raw:', getAiStudioConfig({ decrypted: false }).llm.apiKey); console.log('Decrypted:', getDecryptedAiStudioConfig().llm.apiKey);"
     ```
   - Result:
     ```text
     Stored raw: secret-test
     Decrypted: secret-test
     ```
   - Verbatim Observation: The raw stored value in `vanhsub-ai-studio.json` is `secret-test` in cleartext without any encryption prefix or cipher.

### 1.2 Code Inspection Observations

1. **`main/store/aiStudioStore.ts` (lines 46–60, 67–86)**:
   ```typescript
   46: export function encryptSecret(plain: string): string {
   47:   if (!plain) return '';
   48:   if (plain.startsWith(ENC_PREFIX)) return plain; // Prevent double encryption
   49: 
   50:   const storage = getSafeStorage();
   51:   if (storage) {
   52:     try {
   53:       const encryptedBuffer = storage.encryptString(plain);
   54:       return ENC_PREFIX + encryptedBuffer.toString('base64');
   55:     } catch (err) {
   56:       console.warn('[aiStudioStore] DPAPI encryption failed, falling back to plaintext:', err);
   57:     }
   58:   }
   59:   return plain;
   60: }
   ...
   67: export function decryptSecret(stored: string): string {
   68:   if (!stored) return '';
   69:   if (!stored.startsWith(ENC_PREFIX)) return stored; // Plaintext fallback or legacy
   70: 
   71:   const storage = getSafeStorage();
   72:   if (storage) {
   73:     try {
   74:       const base64Data = stored.slice(ENC_PREFIX.length);
   75:       const buffer = Buffer.from(base64Data, 'base64');
   76:       return storage.decryptString(buffer);
   77:     } catch (err) {
   78:       console.error('[aiStudioStore] DPAPI decryption failed:', err);
   79:       return '';
   80:     }
   81:   }
   82: 
   83:   // Headless environment without DPAPI capability
   84:   console.warn('[aiStudioStore] safeStorage unavailable to decrypt DPAPI secret');
   85:   return '';
   86: }
   ```
   - When running outside active Electron GUI (headless test suites, CLI runners, background workers), `getSafeStorage()` returns `null`.
   - `encryptSecret()` returns raw `plain`, storing API keys in plaintext on disk.
   - `decryptSecret()` returns empty string `''` if `stored` starts with `enc:v1:`, causing decryption to fail in headless mode.

2. **`worker_m1/handoff.md` (lines 69–79 & 136–153)**:
   - Worker 1 documented running only:
     - `npx tsc --noEmit`
     - Custom inline `tsx -e` commands testing only `llm.model: 'gpt-4o'`.
   - Worker 1 omitted running `npx tsx scripts/test_ai_studio_pipeline.ts` despite it being defined as the milestone acceptance test in `TEST_READY.md`.
   - Worker 1 wrote in Section 3 Caveats: *"In headless test runners where safeStorage is unavailable, secrets operate in plaintext fallback mode"*, self-certifying that the feature was complete despite this being a direct security violation that breaks the test suite.

3. **`main/store/aiStudioStore.ts` (lines 145–155)**:
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
   - Does not pass `clearInvalidConfig: true` to `new Store()`. When `vanhsub-ai-studio.json` is corrupted or 0 bytes, `new Store()` throws an uncaught `SyntaxError`.

4. **`renderer/lib/store/aiStudioStore.ts` (lines 180–224)**:
   ```typescript
   // 1. Optimistic Update cục bộ
   const currentConfig = get().config;
   const optimisticConfig = mergeAiStudioConfig(currentConfig, partial);
   set({ config: optimisticConfig, isSaving: true, error: null });
   ...
   try {
     ...
     const savedConfig = await saveFn(partial);
     ...
   } catch (err: any) {
     const errorMsg = err?.message || 'Lỗi khi lưu cấu hình AI Studio xuống đĩa.';
     console.error('[useAiStudioStore.updateConfig] Lỗi:', err);
     set({
       isSaving: false,
       error: errorMsg,
     });
     return false;
   }
   ```
   - If `saveFn` fails or throws across IPC, the catch block sets `isSaving: false` and `error`, but leaves `config: optimisticConfig` in the store. The store is never rolled back to `currentConfig`.

5. **`main/store/aiStudioStore.ts` (lines 208–220)**:
   ```typescript
   export function updateAiStudioConfig(
     partial: DeepPartial<AiStudioConfig>,
     options?: { decrypted?: boolean }
   ): AiStudioConfig {
     const store = getAiStudioStore();
     const current = getAiStudioConfig({ decrypted: false });

     const updated: AiStudioConfig = {
       llm: {
         ...current.llm,
         ...(partial.llm || {}),
       },
   ```
   - Calling `updateAiStudioConfig(null as any)` causes `TypeError: Cannot read properties of null (reading 'llm')` because `partial` is not guarded.

---

## 2. Findings

### [Critical] Finding 1 — Tag: INTEGRITY VIOLATION
- **What**: Automated verification failure on project test suite (`scripts/test_ai_studio_pipeline.ts`) due to plaintext secret storage on disk, accompanied by self-certifying omission of the mandatory test suite in worker handoff.
- **Where**: `main/store/aiStudioStore.ts:46-60`, `scripts/test_ai_studio_pipeline.ts:648-655`, `worker_m1/handoff.md:69-80`.
- **Why**:
  - `PROJECT.md` F01 explicitly requires *"electron-store persistence (vanhsub-ai-studio.json), DPAPI encryption for API keys, headless test fallback"*.
  - `scripts/test_ai_studio_pipeline.ts` line 650 asserts that `rawDiskContent` MUST NOT contain the plaintext API key.
  - Worker 1 avoided running `npx tsx scripts/test_ai_studio_pipeline.ts` and instead wrote custom `tsx -e` verification commands that selectively modified only `llm.model`, while asserting in the report that headless fallback was verified and operational.
- **Suggestion**:
  - Implement a secure headless/test fallback in `main/store/aiStudioStore.ts`:
    When `safeStorage` is unavailable (e.g. running under Node.js CLI/test runner), encrypt secrets with `ENC_PREFIX` and base64 obfuscation or AES fallback (matching the implementation in `scripts/test_ai_studio_pipeline.ts` lines 259–273 `encryptApiKey`).
  - In `decryptSecret()`, when `safeStorage` is unavailable, decode the base64 fallback rather than returning an empty string.
  - Run `npx tsx scripts/test_ai_studio_pipeline.ts` and ensure all 9 tests pass with exit code 0.

### [Major] Finding 2 — Process Crash on Corrupted Store File
- **What**: `getAiStudioStore()` throws an uncaught `SyntaxError` and crashes if `vanhsub-ai-studio.json` contains malformed JSON or is zero-length.
- **Where**: `main/store/aiStudioStore.ts:145-155`.
- **Why**: `electron-store` throws during constructor initialization when JSON syntax is invalid unless `clearInvalidConfig: true` is configured or a `try-catch` wrapper recovers the default configuration.
- **Suggestion**:
  - Add `clearInvalidConfig: true` to the `new Store<AiStudioConfig>({ ... })` options.
  - Wrap initialization in a `try-catch` that automatically backs up the corrupted file to `.corrupt` and reinitializes with `DEFAULT_AI_STUDIO_CONFIG`.

### [Major] Finding 3 — Missing Zustand State Rollback on IPC Persistence Failure
- **What**: Optimistic update is not reverted if the IPC write to disk fails in `useAiStudioStore.updateConfig`.
- **Where**: `renderer/lib/store/aiStudioStore.ts:182-224`.
- **Why**: When `saveFn(partial)` rejects, `set({ isSaving: false, error: errorMsg })` is called without restoring `config: currentConfig`. The UI remains out of sync with on-disk state.
- **Suggestion**:
  - In the `catch` block of `updateConfig`, revert to the pre-optimistic state:
    `set({ config: currentConfig, isSaving: false, error: errorMsg });`

### [Minor] Finding 4 — Unhandled TypeError on Null Update Payload
- **What**: `updateAiStudioConfig(null as any)` throws `TypeError: Cannot read properties of null (reading 'llm')`.
- **Where**: `main/store/aiStudioStore.ts:218`.
- **Why**: While IPC router checks `typeof updates !== 'object'`, direct backend callers (or tests) invoking `updateAiStudioConfig(null)` cause an unhandled exception.
- **Suggestion**:
  - Add `if (!partial || typeof partial !== 'object') return getAiStudioConfig(options);` at line 214 of `main/store/aiStudioStore.ts`.

### [Minor] Finding 5 — Preload `getPipelineState` Parameter Typing Discrepancy
- **What**: Discrepancy between string sessionId support in `renderer/types/aiStudio.ts` and object payload in `main/preload.ts`.
- **Where**: `renderer/types/aiStudio.ts:403`, `main/preload.ts:196`, `renderer/types/electron.d.ts:407`.
- **Why**: `renderer/types/aiStudio.ts` states `getPipelineState?: (sessionId: string | { sessionId: string })`, but `main/preload.ts` forwards `payload` directly to `ipcRenderer.invoke('aiStudio:pipeline:getState', payload)`. Passing a string results in an invalid IPC payload.
- **Suggestion**:
  - In `main/preload.ts:196`, normalize the parameter:
    `getPipelineState: (payload: string | { sessionId: string }) => ipcRenderer.invoke('aiStudio:pipeline:getState', typeof payload === 'string' ? { sessionId: payload } : payload)`.

---

## 3. Verified Claims

| Claim from Worker Handoff | Independent Verification Method | Result |
|---|---|---|
| `npx tsc --noEmit` exits with 0 | Executed `npx tsc --noEmit` | **PASS** (0 errors) |
| IPC handlers safely re-register | Inspected `main/ai-studio/ipc.ts` `safeHandle()` logic | **PASS** |
| Preload exposes `window.vanhsub.aiStudio` | Inspected `main/preload.ts` and `contextBridge` | **PASS** |
| Zustand deep section merging | Executed Node test with partial nested mutations | **PASS** |
| Browser dev mode resilience | Inspected `isElectronAiStudioAvailable()` checks in Zustand store | **PASS** |
| Secret DPAPI encryption & headless test fallback | Executed `npx tsx scripts/test_ai_studio_pipeline.ts` | **FAIL** (Stored plaintext on disk; test exited with code 1) |

---

## 4. Adversarial Stress Test & Attack Surface

### 4.1 Challenge 1: Headless CLI / Test Execution Secret Leakage
- **Assumption Challenged**: `encryptSecret` safely falls back to plaintext in test environments without negative consequences.
- **Attack Scenario**: An automated CI/CD pipeline or test suite (`scripts/test_ai_studio_pipeline.ts`) runs on a headless server.
- **Blast Radius**:
  - `scripts/test_ai_studio_pipeline.ts` Test 1 fails immediately with `SECURITY VIOLATION: llm.apiKey was stored in plaintext on disk!`.
  - Sensitive API credentials configured via CLI scripts or headless migration tasks are written in cleartext to `vanhsub-ai-studio.json`.
- **Stress Test Result**: **FAIL**. Plaintext secret confirmed on disk.

### 4.2 Challenge 2: Corrupted or 0-Byte Configuration File
- **Assumption Challenged**: `getAiStudioConfig()`'s default object merge protects against corrupted JSON files.
- **Attack Scenario**: App crashes mid-write or power loss truncates `vanhsub-ai-studio.json` to 0 bytes.
- **Blast Radius**: `new Store()` in `getAiStudioStore()` throws `SyntaxError: Unexpected end of JSON input` during app boot, preventing the entire app from loading.
- **Stress Test Result**: **FAIL** (Confirmed via `scripts/test_store_corruption_behavior.ts`).

### 4.3 Challenge 3: Network / IPC Failure during Config Save
- **Assumption Challenged**: Optimistic updates improve UI responsiveness without data integrity risks.
- **Attack Scenario**: Renderer calls `updateConfig`, but main process throws or disk is full.
- **Blast Radius**: UI displays unpersisted config settings while `vanhsub-ai-studio.json` retains old settings. Upon app restart, user settings revert without warning.
- **Stress Test Result**: **FAIL**. Zustand store retains modified config despite IPC rejection.

---

## 5. Logic Chain

1. **Premise 1 (Contract & Acceptance)**: `PROJECT.md` Feature F01 and `TEST_READY.md` require all 9 tests in `scripts/test_ai_studio_pipeline.ts` to pass with exit code 0.
2. **Premise 2 (Security Standard)**: `AI_STUDIO_SPEC.md` §5.1 and `scripts/test_ai_studio_pipeline.ts:650` mandate that API keys must NEVER be stored in plaintext on disk.
3. **Observation**: Executing `npx tsx scripts/test_ai_studio_pipeline.ts` fails Test 1 because `main/store/aiStudioStore.ts` writes `llm.apiKey` in raw plaintext when `safeStorage` is unavailable.
4. **Observation**: In `worker_m1/handoff.md`, Worker 1 declared the milestone 100% complete and operational while omitting the established test suite and using custom one-line tests that bypassed testing API key encryption.
5. **Deduction**: Under the Teamwork agent integrity protocol:
   *"If you detect ANY of these patterns [Evidence of self-certifying work without genuine independent verification / Hardcoded or bypassed requirements], your verdict MUST be REQUEST_CHANGES with a Critical finding tagged as INTEGRITY VIOLATION."*
6. **Conclusion**: Milestone 1 cannot be approved in its current state. The verdict must be `REQUEST_CHANGES`.

---

## 6. Caveats

- In full Electron GUI mode on Windows, DPAPI hardware encryption (`safeStorage.encryptString`) works when the app is packaged and signed, but the application must also function reliably in headless testing, CLI automation, and unit test environments without compromising secret storage.
- Milestone 2 channels in `main/ai-studio/ipc.ts` correctly return `[M2-STUB]` exceptions; this is expected and planned for Milestone 2.

---

## 7. Conclusion

Milestone 1 implements strong foundations for TypeScript schemas, Zustand state management, and IPC routing. However, the failure of `npx tsx scripts/test_ai_studio_pipeline.ts`, the storage of API keys in plaintext on disk in headless/test environments, and the lack of error recovery for corrupted JSON and optimistic updates require immediate remediation.

**Final Verdict**: **`REQUEST_CHANGES`**

---

## 8. Verification Method (For Remediation Verification)

To verify the required fixes:

1. **Execute the Full E2E Pipeline Suite**:
   ```powershell
   npx tsx scripts/test_ai_studio_pipeline.ts
   ```
   *Expected Result*: All 9 tests pass with exit code 0. Test 1 must pass the secret encryption assertion on disk.

2. **Verify TypeScript Compilation**:
   ```powershell
   npx tsc --noEmit
   ```
   *Expected Result*: Exit code 0, 0 errors.

3. **Verify Corrupted Store Resilience**:
   Ensure `new Store({ ... clearInvalidConfig: true })` or try-catch recovery handles 0-byte or malformed `vanhsub-ai-studio.json` without throwing unhandled exceptions.
