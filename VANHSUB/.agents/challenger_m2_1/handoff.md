# Challenger 1 Handoff Report — Milestone 2: Pipeline Engine & Checkpoint State Machine

**Verdict: REQUEST_CHANGES**

---

## 1. Observation

Adversarial stress-test script `scripts/test_challenger_m2_engine.ts` was authored and executed targeting `AiStudioPipelineEngine.ts` across all 4 mandatory challenge scenarios (13 distinct test cases executed).

### 1.1 Positive Verifications
1. **Checkpoint Resumption (Scenario 2)**:
   - Resuming from Stage 5 after Stages 1–4 are completed executed only Stages 5, 6, 7, and 8.
   - Stages 1–4 were NOT re-executed. Original timestamps (`completedAt`) and generated audio files (`assets/voiceover.mp3`) remained strictly untouched (`mtimeMs` identical).
   - Produced valid MP4 video (`assets/final_video.mp4`, H.264/AAC) and complete SEO metadata.
   - Illegal state jumps (e.g. jumping to Stage 5 when Stage 4 is not completed) were rejected with `IllegalStateTransitionError`.
2. **Corrupted File Recovery (Scenario 4)**:
   - Missing `session.json`: `getState()` returned `null`, `resume()` threw descriptive `"Session không tồn tại"`.
   - Malformed JSON syntax (unclosed brackets/quotes): safely caught `SyntaxError` and returned `null` without crashing.
   - 0-Byte empty file and raw binary garbage: handled gracefully without process crash.
   - Dual-layer recovery: successfully recovered state from legacy root backup (`<sessionsRoot>/<sessionId>.json`) when `<sessionsRoot>/<sessionId>/session.json` was corrupted.
3. **Subprocess Termination (Scenario 1)**:
   - Mid-flight cancellation during active Stage 7 FFmpeg video assembly triggered `cmd.kill('SIGKILL')`, terminating FFmpeg without leaving hanging orphan processes or crashing Node.js.

### 1.2 Defects & Vulnerabilities Discovered

#### Defect 1: Cancellation State Overwritten to `'failed'` (State Machine Race Condition)
- **File**: `main/ai-studio/AiStudioPipelineEngine.ts:241-259` and `315-333`
- **Observed Behavior**:
  When `engine.cancel({ sessionId })` is called during active Stage 3 (TTS) or Stage 7 (FFmpeg):
  1. `cancel()` successfully aborts `AbortController` and marks `session.status = 'cancelled'` (verified at `AiStudioPipelineEngine.ts:192`).
  2. The active child operation aborts and throws an error (e.g. `"Quá trình dựng video bị hủy bởi người dùng"` or `"Quá trình tạo giọng đọc đã bị hủy bởi người dùng"`).
  3. This error rejects `runPipelineLoop(...)` and triggers the `.catch((err) => { ... })` handler in `start()` (lines 242–258) and `resume()` (lines 316–332).
  4. The catch block **unconditionally overwrites** `session.status = 'failed'` and emits an IPC event with `status: 'error'`!
- **Verbatim Test Log**:
  ```
  [AiStudioPipelineEngine] Resume error on session ffmpeg-cancel-1789630761335: Error: Quá trình dựng video bị hủy bởi người dùng.
  Status after FFmpeg cancel: "failed"
  STATE CORRUPTION: Cancelling Stage 7 FFmpeg assembly resulted in session.status='failed' instead of 'cancelled' because runPipelineLoop.catch() overwrote the state upon FFmpeg abort error.
  ```
- **Secondary TTS Retry Delay**:
  In `main/ai-studio/services/AiStudioTtsService.ts:166-173`, when aborted, `catch (err)` executes `await new Promise((r) => setTimeout(r, 1000))` before retrying. This delays the rejection by 1000ms, causing the session status to mutate from `'cancelled'` to `'failed'` 1 second after `cancel()` returned success.

#### Defect 2: Subtitle Artifact (`artifacts.srtPath`) Leaking on Downstream Eviction
- **File**: `main/ai-studio/AiStudioPipelineEngine.ts:298-305`
- **Observed Behavior**:
  When retrying Stage $N \le 7$ (e.g. Stage 3):
  ```typescript
  if (targetStage <= 2) session.artifacts.scriptLines = undefined;
  if (targetStage <= 3) session.artifacts.audioPath = undefined;
  if (targetStage <= 4) session.artifacts.wordsAlignment = undefined;
  if (targetStage <= 5) session.artifacts.scenes = undefined;
  if (targetStage <= 7) session.artifacts.videoPath = undefined;
  if (targetStage <= 8) session.artifacts.metadata = undefined;
  ```
  `session.artifacts.srtPath` was omitted from eviction.
- **Verbatim Test Log**:
  ```
  FINDING: artifacts.srtPath is retained after stage 3 retry (C:\...\sessions\retry-s3-...\assets\subtitles.ass) because srtPath is not included in the eviction list in AiStudioPipelineEngine.ts:298-305.
  ```
  If a user modifies dialogue lines in Tab 1 and retries from Stage 3, `artifacts.srtPath` retains the path to obsolete subtitles from the previous run.

#### Defect 3: Uncaught TypeError on Incomplete `session.json` Schema
- **File**: `main/ai-studio/AiStudioPipelineEngine.ts:280`
- **Observed Behavior**:
  If `session.json` exists with valid JSON but is missing the `stages` object (e.g. `{ "sessionId": "..." }`), calling `resume()` immediately crashes with an unhandled exception:
  ```
  TypeError: Cannot read properties of undefined (reading '2')
  ```
  instead of throwing a clean validation error.

---

## 2. Logic Chain

1. **State Machine Integrity**:
   - `types.ts:338` specifies `PipelineSessionState['status'] = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'`.
   - When a user issues a cancellation, the UI (Milestone 3 F18/F19) listens for `status: 'cancelled'` to display a clean stopped state.
   - Because `runPipelineLoop(...).catch()` does not check `abortController.signal.aborted`, it treats the expected abort error as an unhandled pipeline crash, overwriting `session.status = 'failed'` and broadcasting `status: 'error'`.
   - This causes UI state flakiness (flashing "Cancelled" and then suddenly turning red with "Failed / Error").
2. **Artifact Correctness on Retry**:
   - Eviction exists to prevent stale upstream/downstream mismatches.
   - Retrying Stage 3 means speech audio and timestamps are being regenerated. Subtitles are tightly coupled to timestamps. Retaining `srtPath` allows stale subtitle artifacts to leak into downstream video re-renders.
3. **Schema Resilience**:
   - In production, session files may be partially written if a hard crash occurs prior to atomic rename, or if user settings are edited. `resume()` must not crash Node process with an unhandled `TypeError` on missing keys.

---

## 3. Caveats

- In test CLI mode, Google Flow browser automation runs in synthetic fallback mode (as expected without interactive Electron window). Live Google Flow CDP automation must be verified during Milestone 4 integrated tests.
- FFmpeg and Edge-TTS binaries and fallback paths were fully verified in the local environment.
- No caveats regarding reproducibility: all 3 findings are 100% reproducible via `scripts/test_challenger_m2_engine.ts`.

---

## 4. Conclusion

**Verdict: REQUEST_CHANGES**

The core pipeline architecture is structurally sound and modular services are well-crafted. However, Milestone 2 cannot be approved in its current state due to the 3 state machine defects above.

### Required Changes for Worker M2:

1. **Fix Cancellation Status Overwrite in `AiStudioPipelineEngine.ts`**:
   In `start()` (around line 243) and `resume()` (around line 317), guard the catch handler:
   ```typescript
   this.runPipelineLoop(session, startStage, onProgress, abortController.signal).catch((err) => {
     if (abortController.signal.aborted || session.status === 'cancelled') {
       session.status = 'cancelled';
       if (session.stages[session.currentStage]) {
         session.stages[session.currentStage].status = 'error';
         session.stages[session.currentStage].error = 'Đã hủy bởi người dùng';
       }
       this.persistSessionStateAtomic(session);
       onProgress({
         sessionId: session.sessionId,
         stage: session.currentStage,
         stageName: session.stageName,
         progress: session.progress,
         status: 'error',
         message: 'Đã hủy bởi người dùng',
       });
       return;
     }
     console.error(`[AiStudioPipelineEngine] Error on session ${session.sessionId}:`, err);
     session.status = 'failed';
     ...
   });
   ```

2. **Abort Immediately in `AiStudioTtsService.ts`**:
   In `synthesizeVoiceover` (line 166), do not wait 1000ms if aborted:
   ```typescript
   } catch (err: any) {
     lastError = err;
     try { tts.close(); } catch {}
     if (signal?.aborted) {
       throw new Error('Quá trình tạo giọng đọc đã bị hủy bởi người dùng.');
     }
     if (attempt < maxRetries) { ... }
   ```

3. **Include `srtPath` in Eviction List in `AiStudioPipelineEngine.ts:303`**:
   ```typescript
   if (targetStage <= 7) {
     session.artifacts.videoPath = undefined;
     session.artifacts.srtPath = undefined;
   }
   ```

4. **Add Defensive Schema Defaults in `AiStudioPipelineEngine.ts:276`**:
   ```typescript
   session.stages = session.stages || {};
   session.artifacts = session.artifacts || {};
   ```

---

## 5. Verification Method

To independently verify the adversarial test suite and findings:

1. **Run Challenger Test Suite**:
   ```bash
   npx tsx scripts/test_challenger_m2_engine.ts
   ```
   *Expectation*: Executes 13 tests across 4 challenge scenarios and reports the 3 findings.

2. **Run Existing Pipeline E2E Test Suite**:
   ```bash
   npx tsx scripts/test_ai_studio_pipeline.ts
   ```
   *Expectation*: Passes all 9 tests cleanly.

3. **Run TypeScript Compilation Check**:
   ```bash
   npx tsc --noEmit
   ```
   *Expectation*: Exit code 0, 0 type errors.
