# Forensic Integrity Audit Report: Milestone 2 (AI Studio Pipeline Engine & Services)

**Working Directory**: `d:\DEAN\DEAN\VANHSUB\.agents\auditor_m2_1`  
**Auditor Archetype**: Forensic Auditor  
**Integrity Mode**: `development` (per `ORIGINAL_REQUEST.md` ## 2026-09-17T06:24:37Z)  
**Profile**: General Project  
**Verdict**: **`CLEAN`**

---

## 1. Forensic Audit Summary

| Check # | Forensic Verification Item | Result | Evidence / Details |
|---|---|:---:|---|
| **C1** | **Hardcoded Test Results & Facades Detection** | **PASS** | Inspected all 6 target files; no dummy returns, no constant mocks, zero fake pass strings. |
| **C2** | **Edge TTS Genuine Synthesis & Word Boundaries** | **PASS** | Live WebSocket connection via `msedge-tts` (`vi-VN-HoaiMyNeural`), wrote real MP3 (25,344 bytes, 4.22s duration) and extracted 11 native `WordBoundary` timestamps. |
| **C3** | **FFmpeg Real Video Assembly & Output Validity** | **PASS** | Executed `fluent-ffmpeg` with Ken Burns zoompan & ASS subtitle burning; produced playable MP4 (20,337 bytes, 1280x720 H.264 video, AAC audio). |
| **C4** | **Google Flow Dispatcher & Synthetic Fallback** | **PASS** | Verified references to `GoogleVeoSessionManager` & `GoogleFlowBrowserMutex`; offline fallback generates verified PNG cards with magic bytes `[0x89, 0x50, 0x4E, 0x47]`. |
| **C5** | **Atomic `session.json` Disk Persistence** | **PASS** | Verified atomic temporary file write + rename (`session.json.tmp.*` $\to$ `session.json`) in dedicated session directories. |
| **C6** | **State Machine Resumption & Eviction** | **PASS** | Resuming from stage $N$ preserves upstream artifacts while evicting downstream artifacts; guards invalid stage transitions with `IllegalStateTransitionError`. |
| **C7** | **Cancellation & Process Termination** | **PASS** | `cancel()` immediately triggers `AbortController.abort()` and sends `SIGKILL` to active FFmpeg commands. |
| **C8** | **Zero Contamination to Legacy Stores** | **PASS** | `git status -- main/store/settingsStore.ts main/store/workflowStore.ts` confirmed 0 diffs, 100% clean and untouched. |
| **C9** | **TypeScript Typecheck Cleanliness** | **PASS** | `npx tsc --noEmit` exited 0 with 0 compilation errors across the entire repository. |
| **C10** | **Automated Test Suite Validations** | **PASS** | `scripts/test_ai_studio_pipeline.ts` (9/9 PASS), `scripts/test_adversarial_ai_studio_store.ts` (14/14 PASS), and independent `scripts/test_forensic_auditor_m2.ts` (63/63 sub-checks PASS). |

---

## 2. Observation

### 2.1 File Inspections & Implementations
1. **`main/ai-studio/AiStudioPipelineEngine.ts`**:
   - Implements `IAiStudioPipelineEngineDelegate` interface (`start`, `resume`, `cancel`, `getState`, `renderSingleLineVoice`, `regenerateSceneAsset`, `renderVideo`).
   - Line 100-128: `persistSessionStateAtomic` writes to `path.join(sessionDir, 'session.json.tmp.' + Date.now())` and calls `fs.renameSync(tempPath, finalPath)` with copy/unlink fallback.
   - Line 278-286: Resuming stage $N$ validates that stage $N-1$ is completed (`session.stages[prevStage]?.status === 'success'`), throwing `IllegalStateTransitionError` otherwise.
   - Line 290-305: Evicts downstream stage statuses to `'pending'` and unsets downstream artifacts (`scriptLines`, `audioPath`, `wordsAlignment`, `scenes`, `videoPath`, `metadata`).
   - Line 166-201: `cancel()` aborts `AbortController` and executes `proc.kill('SIGKILL')` on all registered processes.

2. **`main/ai-studio/services/AiStudioTtsService.ts`**:
   - Line 96-104: Instantiates `new MsEdgeTTS()`, calls `setMetadata` with `wordBoundaryEnabled: true`, and invokes `tts.toStream(fullText, prosody)`.
   - Line 182-211: Parses raw WebSocket metadata `item.Type === 'WordBoundary'`, converts 100ns ticks to milliseconds (`Math.round(offsetTicks / 10000)`), enforcing monotonic order and syllabic fallback if server omits boundaries.
   - Line 89-174: Implements exponential-free retry mechanism with connection retry loop and 25-second timeout guard.

3. **`main/ai-studio/services/AiStudioVisualService.ts`**:
   - Line 7-8: Imports `GoogleVeoSessionManager` and `GoogleFlowBrowserMutex`.
   - Line 78-86: Queries `GoogleVeoSessionManager.getInstance().validateSession()`.
   - Line 142-162: Dispatches via browser mutex when session is active.
   - Line 168-213: `generateSyntheticSceneCard` uses `ffmpeg().input('color=c=${color}:s=${width}x${height}:d=1').inputFormat('lavfi').outputOptions('-vframes 1')` and validates magic bytes `[0x89, 0x50, 0x4e, 0x47]`.

4. **`main/ai-studio/services/AiStudioVideoAssembler.ts`**:
   - Line 89-168: Compiles real `.ass` subtitle files with `[Script Info]`, `[V4+ Styles]` (`TikTokBold`), and `[Events]` with time formatting `h:mm:ss.cs`.
   - Line 31-35: `escapeFfmpegSubtitlesPath` escapes Windows drive colon (`C:` $\to$ `C\:`) and normalizes backslashes.
   - Line 220-252: Builds fluent-ffmpeg filtergraph with Ken Burns `zoompan=z='min(zoom+0.0012,1.15)':...`, libass subtitles, ducked BGM audio mixing (`amix=inputs=2:duration=first`), and H.264/AAC encoding.

5. **`main/ai-studio/services/AiStudioLlmService.ts`**:
   - Uses OpenAI SDK with configurable base URL (OpenAI / DeepSeek), `jsonrepair` recovery for broken JSON formatting, and calibrated procedural fallbacks when unauthenticated.

6. **`main/ai-studio/ipc.ts`**:
   - Registers all 10 IPC channels safely via `safeHandle`.
   - Lines 110-114: Automatically attaches `new AiStudioPipelineEngine()` into `setAiStudioPipelineEngine` upon registration.

### 2.2 Critical Forensic Finding (Functional Defect in `fluent-ffmpeg` `.loop(1)`)
- **File**: `main/ai-studio/services/AiStudioVideoAssembler.ts:241`
- **Code**:
  ```typescript
  const cmd = ffmpeg()
    .input(primaryImg)
    .loop(1)
    .input(voiceoverAudioPath);
  ```
- **Analysis**:
  In `fluent-ffmpeg`, the `.loop()` method signature is `.loop([duration])`. Passing `.loop(1)` causes fluent-ffmpeg to append `[ '-loop', '1', '-t', 1 ]` to the FFmpeg command line.
  Because `-shortest` is specified on the output, the resulting MP4 file is truncated to **1.00 second**, regardless of the voiceover audio duration (which was e.g. 4.22s or 6.26s).
  Meanwhile, line 305 returns `durationSec: audioDurationSec` (e.g. 4.22s), creating a discrepancy between the metadata return value and the actual video duration on disk.
- **Root Cause**: An API parameter misunderstanding (assuming `1` means boolean enabled, when fluent-ffmpeg treats numeric arguments as duration in seconds).
- **Remediation**: In `AiStudioVideoAssembler.ts:241`, change `.loop(1)` to either `.loop()` (loop indefinitely without `-t`, letting `-shortest` match the audio duration) or `.loop(audioDurationSec)`.

---

## 3. Logic Chain

1. **Absence of Fraudulent Constructs**:
   Thorough AST inspection and pattern searches across `main/ai-studio/` confirmed the absence of mock facades, dummy constants, hardcoded expected answers, or fake test passing logic.
2. **Empirical Verification of Core Services**:
   Independent execution of `scripts/test_forensic_auditor_m2.ts` verified that:
   - `msedge-tts` transmits real Vietnamese audio over WebSocket, probes audio duration with ffprobe, and extracts monotonic word boundary timestamps.
   - `fluent-ffmpeg` produces valid PNG images (magic bytes `0x89, 0x50, 0x4e, 0x47`) and valid playable MP4 containers with H.264 video and AAC audio.
   - `AiStudioPipelineEngine` runs all 8 stages sequentially, writes checkpoints atomically to `session.json`, restores state upon resume, evicts downstream artifacts, and rejects illegal stage jumps.
3. **Strict Isolation Compliance**:
   Git status and file checksums verify that `main/store/settingsStore.ts` and `main/store/workflowStore.ts` have zero modifications.
4. **Classification of `.loop(1)`**:
   The `.loop(1)` issue is not an intentional facade or attempt to cheat; it is a genuine functional defect arising from fluent-ffmpeg's parameter conventions. The code is therefore **CLEAN** of integrity violations.

---

## 4. Caveats

- Google Flow browser authentication was not active in the headless CLI test environment; fallback to procedural synthetic assets occurred as designed and allowed by specification (`ORIGINAL_REQUEST.md` R2: "hỗ trợ chế độ thực tế hoặc fallback mock assets khi chưa đăng nhập").
- The `.loop(1)` defect must be corrected before Milestone 3 UI preview to allow videos to play their full duration.

---

## 5. Conclusion

**Verdict**: **`CLEAN`**

Milestone 2 (AI Studio Pipeline Engine & Modular Services) passes all forensic integrity checks:
- No cheating, hardcoded test strings, or mock facades exist in the source code.
- Edge TTS, FFmpeg, Google Flow fallback, and atomic persistence operate authentically.
- Legacy stores remain completely unpolluted.
- All automated test suites (`test_ai_studio_pipeline.ts`, `test_adversarial_ai_studio_store.ts`, and `test_forensic_auditor_m2.ts`) pass 100%.

---

## 6. Verification Method

To independently reproduce the forensic audit:

1. **Verify TypeScript Compilation**:
   ```powershell
   npx tsc --noEmit
   ```
   *Expected: Exit code 0, 0 errors.*

2. **Run Comprehensive E2E Pipeline Test**:
   ```powershell
   npx tsx scripts/test_ai_studio_pipeline.ts
   ```
   *Expected: All 9 pipeline tests pass with exit code 0.*

3. **Run Independent Forensic Audit Suite**:
   ```powershell
   npx tsx scripts/test_forensic_auditor_m2.ts
   ```
   *Expected: All 63 forensic assertions pass with exit code 0.*

4. **Verify Legacy Store Non-Contamination**:
   ```powershell
   git status -- main/store/settingsStore.ts main/store/workflowStore.ts
   ```
   *Expected: Clean working tree, 0 modified files.*
