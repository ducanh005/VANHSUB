# Handoff Report: Milestone 2 Pipeline Engine Architecture & Specification

> **Agent**: Pipeline Engine Explorer (`explorer_m2_engine`)  
> **Milestone**: Milestone 2 — AI Studio Pipeline Engine & Modular Services  
> **Target**: Orchestrator / Implementer  
> **Timestamp**: 2026-09-17T07:25:00Z  

---

## 1. Observation

1. **IPC Delegate Specification**:
   - In `main/ai-studio/ipc.ts:39-63`, `IAiStudioPipelineEngineDelegate` defines 7 required methods:
     ```typescript
     export interface IAiStudioPipelineEngineDelegate {
       start(payload: StartPipelinePayload, onProgress: (event: PipelineProgressEvent) => void): Promise<StartPipelineResult>;
       resume(payload: ResumePipelinePayload, onProgress: (event: PipelineProgressEvent) => void): Promise<ResumePipelineResult>;
       cancel(payload: CancelPipelinePayload): Promise<CancelPipelineResult>;
       getState(payload: GetPipelineStatePayload): Promise<PipelineSessionState | null>;
       renderSingleLineVoice(payload: RenderSingleLineVoicePayload): Promise<RenderSingleLineVoiceResult>;
       regenerateSceneAsset(payload: RegenerateSceneAssetPayload): Promise<RegenerateSceneAssetResult>;
       renderVideo(payload: RenderVideoPayload): Promise<RenderVideoResult>;
     }
     ```
   - In `main/main.ts:29-30, 238-239`:
     ```typescript
     import { registerAiStudioIpc, setAiStudioPipelineEngine } from './ai-studio/ipc'
     import { AiStudioPipelineEngine } from './ai-studio/pipelineEngine'
     ...
     registerAiStudioIpc()
     setAiStudioPipelineEngine(new AiStudioPipelineEngine())
     ```

2. **Current Implementation Limitations**:
   - `main/ai-studio/pipelineEngine.ts` is currently a single monolithic file of ~700 lines.
   - It stores sessions in a hardcoded path `path.join(os.homedir(), '.vanhsub', 'ai-studio-sessions')` instead of using `resolveAiStudioCwd()` or Electron userData directory.
   - Its `cancel()` implementation merely adds `sessionId` to a Set (`this.cancellationTokens.add(...)`); it does not kill running FFmpeg child processes or abort ongoing Edge TTS stream downloads.
   - It lacks the 4 modular services specified in `PROJECT.md:164-168` (`AiStudioLlmService`, `AiStudioTtsService`, `AiStudioVisualService`, `AiStudioVideoAssembler`).

3. **Storage Directory & Isolation Contract**:
   - In `main/store/aiStudioStore.ts:115-148`, `resolveAiStudioCwd()` returns:
     - `process.env.VANHSUB_AI_STUDIO_DIR` if set.
     - `undefined` when running inside a full Electron app (defaulting to `app.getPath('userData')`).
     - `path.join(os.tmpdir(), 'vanhsub-ai-studio')` in headless/test environments.

4. **E2E Test Suite Behavior**:
   - Executing `npx tsx scripts/test_ai_studio_pipeline.ts` runs 9 automated tests covering:
     - Test 1: Store Isolation (F01-F08)
     - Test 2: Idea & LLM Script Fallback/Generation (F09-F10)
     - Test 3: Edge TTS Voiceover Synthesis (F11)
     - Test 4: Word-Boundary Alignment Extraction (F12)
     - Test 5: Storyboard Visual Prompts Formatting (F13)
     - Test 6: Visual Assets Generation - Fallback/Mock Mode (F14)
     - Test 7: FFmpeg Video Assembly & ASS Subtitle Burning (F15)
     - Test 8: SEO Metadata Generation (F16)
     - Test 9: Checkpoint State Machine & Resumption (F17)
   - Command output: `ALL 9 PIPELINE TESTS PASSED SUCCESSFULLY!` in 2.59 seconds.
   - In Test 2 (`scripts/test_ai_studio_pipeline.ts:699-705`), the test suite dynamically attempts:
     `await import('../main/ai-studio/services/AiStudioLlmService').catch(() => null);`

5. **Windows libass Escaping Constraint**:
   - In `scripts/test_ai_studio_pipeline.ts:95-99`:
     ```typescript
     function escapeFfmpegSubtitlesPath(subPath: string): string {
       let escaped = subPath.replace(/\\/g, '/');
       escaped = escaped.replace(/^([A-Za-z]):/, '$1\\:');
       return escaped;
     }
     ```
   - Failing to escape the drive letter colon (e.g. `C\:/...`) causes FFmpeg libass filter syntax parse errors on Windows.

---

## 2. Logic Chain

1. **Interface Conformance**: From Observation 1, `ipc.ts` enforces `IAiStudioPipelineEngineDelegate` with 7 specific methods. To fulfill this contract without breaking existing IPC routing or `main.ts`, the new engine in `AiStudioPipelineEngine.ts` must implement these exact methods, and `pipelineEngine.ts` must re-export `AiStudioPipelineEngine`.
2. **Modular Service Decomposition**: From Observation 2 and Observation 4, `PROJECT.md` and the test runner expect distinct services (`AiStudioLlmService`, `AiStudioTtsService`, `AiStudioVisualService`, `AiStudioVideoAssembler`). Separating these into `main/ai-studio/services/` promotes testability, reusability in future Canvas Workflow nodes (as specified in `AI_STUDIO_SPEC.md §6`), and eliminates monolithic bloat.
3. **Session Path Uniformity**: From Observation 2 and Observation 3, sessions must not be hardcoded to `~/.vanhsub/`. They must be resolved via a unified `resolveAiStudioSessionsRoot()` helper that checks `resolveAiStudioCwd()`, `electron.app.getPath('userData')`, and `os.tmpdir()`. Each session directory will contain `session.json` and an `assets/` subfolder.
4. **State Machine & Atomic Checkpointing**: To guarantee fail-safe recovery (from `AI_STUDIO_SPEC.md §3.3`), each stage transition must persist `session.json` atomically using a temporary file and rename (`fs.renameSync`). On resume from stage $N$, upstream artifacts ($1 \dots N-1$) must be strictly preserved, while downstream stages ($N \dots 8$) must be cleared.
5. **Process Termination on Cancellation**: From Observation 2, an active render or TTS download must not continue after `cancel()`. Tracking active `AbortController` and `ffmpeg.FfmpegCommand` handles enables calling `.kill('SIGKILL')` and aborting requests immediately upon cancellation.
6. **Cross-Platform Path Safety**: From Observation 5, subtitle generation in Stage 7 and `renderVideo` must apply Windows drive-letter escaping (`C\:/...`) before passing paths to FFmpeg filtergraphs.

---

## 3. Caveats

1. **Google Flow Live Automation Dependency**:
   - Real asset generation via Google Flow depends on valid Google session cookies and available credits.
   - When Google Flow is unauthenticated, expired, or out of credits, `AiStudioVisualService` transparently engages procedural synthetic card generation (FFmpeg lavfi / high-res PNG). This is by design to ensure automated pipelines and offline users are never blocked.
2. **Renderer UI Compilation Errors (Milestone 3 Scope)**:
   - `npx tsc --noEmit` currently reports 10 errors in `renderer/components/ai-studio/` due to minor typing discrepancies (`SubtitlePreset` vs `SubtitlePresetType`).
   - The backend `main/ai-studio/` and `main/store/` files have 0 TypeScript compile errors.
   - Resolving UI component errors is allocated to Milestone 3 (UI Layer).

---

## 4. Conclusion

The architecture and design for Milestone 2 is complete, fully specified, and documented in:
- `d:\DEAN\DEAN\VANHSUB\.agents\explorer_m2_engine\m2_engine_plan.md`

The plan establishes:
- Production-ready `main/ai-studio/AiStudioPipelineEngine.ts` implementing `IAiStudioPipelineEngineDelegate`.
- 4 modular services in `main/ai-studio/services/`:
  1. `AiStudioLlmService.ts`
  2. `AiStudioTtsService.ts`
  3. `AiStudioVisualService.ts`
  4. `AiStudioVideoAssembler.ts`
- Seamless backwards compatibility via `main/ai-studio/pipelineEngine.ts` re-exporting `AiStudioPipelineEngine`.
- Robust checkpoint state machine with atomic `session.json` writes and artifact preservation on retry.
- Real-time progress callbacks and active process cancellation.

---

## 5. Verification Method

To verify the design and implementation independently:

1. **E2E Pipeline Test Suite**:
   ```bash
   npx tsx scripts/test_ai_studio_pipeline.ts
   ```
   - Verification condition: All 9 tests pass with exit code 0.
   - Verifies store isolation, LLM fallback, Edge TTS synthesis, word alignment, storyboard prompts, visual fallback, FFmpeg video assembly with ASS subtitles, SEO metadata, and checkpoint state machine retry/resumption.

2. **Adversarial & IPC Contract Verification**:
   ```bash
   npx tsx scripts/test_adversarial_ai_studio.ts
   ```
   - Verification condition: Store isolation, preload bridge parity, and IPC error propagation pass.

3. **Backend Typecheck**:
   ```bash
   npx tsc --noEmit --project tsconfig.json
   ```
   - Verification condition: Verify that `main/ai-studio/` files compile with zero type errors.
