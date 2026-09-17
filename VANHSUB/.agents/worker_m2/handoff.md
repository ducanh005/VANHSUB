# Milestone 2 Implementation Handoff Report: AI Studio Pipeline Engine & Modular Services

## 1. Observation

### 1.1 Codebase State & Existing Contracts
- `AI_STUDIO_SPEC.md` defines the 8-stage automated video production pipeline (Dữ kiện $\to$ Kịch bản $\to$ Lồng tiếng $\to$ Trích xuất Time $\to$ Storyboard $\to$ Ảnh/Video $\to$ Dựng phim $\to$ SEO & Xuất bản) with fail-safe checkpointing.
- `main/ai-studio/types.ts` defines `AiStudioConfig`, `PipelineSessionState`, `ScriptBeatLine`, `StoryboardScene`, `WordTimestamp`, and IPC payload/result contracts.
- `main/ai-studio/ipc.ts:39-63` specifies the delegate interface `IAiStudioPipelineEngineDelegate` with 7 methods: `start`, `resume`, `cancel`, `getState`, `renderSingleLineVoice`, `regenerateSceneAsset`, `renderVideo`.
- `main/main.ts:30` imported `AiStudioPipelineEngine` from `./ai-studio/pipelineEngine` and at lines 238-239 called `registerAiStudioIpc()` and `setAiStudioPipelineEngine(new AiStudioPipelineEngine())`.
- `scripts/test_ai_studio_pipeline.ts` provides a 9-test automated verification suite covering store isolation, script generation, Edge TTS voice synthesis, word boundary extraction, storyboard prompts, synthetic assets, FFmpeg video assembly, SEO metadata, and checkpoint resumption.

### 1.2 Implemented Modular Services & Coordinator
1. **`main/ai-studio/types.ts`**:
   - Extended `ScriptBeatLine` with `estimatedDurationSec?: number` and `beatType?: 'hook' | 'intro' | 'body' | 'climax' | 'outro'`.
   - Added interfaces `SeoMetadata`, `IdeaBlueprint`, and `ScriptQualityAuditResult`.
   - Updated `PipelineSessionState['artifacts']['metadata']` to use `SeoMetadata`.
2. **`main/ai-studio/services/AiStudioLlmService.ts`**:
   - Implemented `analyzeIdeaBlueprint(topic, config)` for Stage 1 concept blueprint analysis.
   - Implemented `generateScript(topic, config)` for Stage 2 structured dialogue beats (supporting OpenAI SDK, custom endpoints, `jsonrepair`, and robust deterministic 4-beat fallback).
   - Implemented `generateStoryboardScenes(lines, flowConfig, llmConfig)` for Stage 5 English cinematic visual prompts with style prefix and negative prompt.
   - Implemented `generateSeoMetadata(topic, lines, config)` for Stage 8 viral SEO package (title 10-100 chars, description >= 50 chars, hashtags >= 3 with `#` prefix, thumbnail prompt >= 20 chars).
   - Implemented `auditScriptQuality(lines, config)` for 0-100 retention scoring, hook analysis, and feedback.
   - Exported class `AiStudioLlmService`, singleton `aiStudioLlmService`, and module-level functions (`generateScript`, `analyzeIdeaBlueprint`, etc.).
3. **`main/ai-studio/services/AiStudioTtsService.ts`**:
   - Implemented `synthesizeVoiceover(textOrLines, voiceConfig, outputPath, signal)` for Stage 3 Vietnamese speech synthesis via `msedge-tts` (`vi-VN-HoaiMyNeural` / `vi-VN-NamMinhNeural`) with prosody tuning, timeout guard, connection retries, and audio chunk aggregation.
   - Implemented `extractWordTimestamps` and `extractAlignment(rawMetadata, fullText, scriptLines, totalDurationMs)` for Stage 4 native `WordBoundary` timestamp extraction (1 tick = 100ns = 0.0001ms) with monotonic ordering and syllabic interpolation fallback.
   - Implemented `renderSingleLineVoice(payload, outputDir)` for granular line audio re-synthesis.
   - Implemented `probeMediaDuration(filePath)` using `fluent-ffmpeg` and `@ffprobe-installer/ffprobe`.
4. **`main/ai-studio/services/AiStudioVisualService.ts`**:
   - Implemented `dispatchVisualAssets(scenes, flowConfig, assetsDir, onProgress, signal)` for Stage 6 dual-mode dispatcher:
     - Checks `GoogleVeoSessionManager.getInstance().validateSession()`.
     - When authenticated: acquires `GoogleFlowBrowserMutex.getInstance()` and dispatches to `GoogleVeoSessionManager.getInstance().generateImageViaBrowserContext`.
     - When unauthenticated / offline / test / error: seamlessly executes high-resolution procedural synthetic card generator.
   - Implemented `generateSyntheticSceneCard(scene, outputPath, aspectRatio, resolution)` via FFmpeg `lavfi` color canvas with `-vframes 1`, producing verified PNG images with magic bytes `[0x89, 0x50, 0x4E, 0x47]`.
   - Implemented `regenerateSceneAsset(payload, assetsDir)` for single-scene asset re-generation.
5. **`main/ai-studio/services/AiStudioVideoAssembler.ts`**:
   - Implemented `assembleVideo(options)` for Stage 7 video assembly via `fluent-ffmpeg`:
     - Compiles styled dynamic ASS subtitles matching preset (`tiktok_bold`, `karaoke_glow`, etc.) with `compileAssSubtitles`.
     - Escapes ASS subtitle path for Windows libass filter via `escapeFfmpegSubtitlesPath`.
     - Applies Ken Burns zoom/pan filtergraph (`scale=...`, `zoompan=z='min(zoom+0.0012,1.15)':...`).
     - Mixes ducked BGM with voiceover audio when BGM is configured (`amix=inputs=2:duration=first`).
     - Encodes H.264 video + AAC audio (`-pix_fmt yuv420p`, `-preset veryfast`, `-shortest`).
   - Implemented `renderVideo(payload)` for custom re-rendering with modified subtitle styles or rendering options.
6. **`main/ai-studio/AiStudioPipelineEngine.ts`**:
   - Implemented complete `IAiStudioPipelineEngineDelegate` contract.
   - Checkpoint state machine persists atomic `session.json` (`tempPath` + `fs.renameSync`) in `path.join(resolveAiStudioSessionsRoot(), sessionId)`.
   - Sequential execution of all 8 stages with progress events (`aiStudio:pipeline:progress`).
   - Resumption support: loads existing artifacts from upstream stages without re-executing them.
   - Per-stage retry & downstream eviction: invalidates downstream artifacts and resets downstream stages to `'pending'` when retrying stage $N$.
   - Illegal transition guard: throws `IllegalStateTransitionError` if resuming stage $N > 1$ when stage $N-1$ is not completed.
   - Cancellation support: aborts active `AbortController` and kills active FFmpeg commands.
7. **`main/ai-studio/ipc.ts`**:
   - Auto-wires `AiStudioPipelineEngine` into `setAiStudioPipelineEngine` inside `registerAiStudioIpc()`.
8. **`main/ai-studio/pipelineEngine.ts`**:
   - Re-exports everything from `./AiStudioPipelineEngine` for 100% backward compatibility with `main/main.ts`.

### 1.3 Execution Verifications
- Command: `npx tsc --noEmit`
  - Output: Exit code 0, 0 type errors.
- Command: `npx tsx scripts/test_ai_studio_pipeline.ts`
  - Output: Exit code 0, 9/9 tests passed:
    - Test 1: Store Isolation & Configuration Management (F01-F08) -> PASS
    - Test 2: Idea & LLM Script Fallback/Generation (F09-F10) -> PASS (dynamically imported live `AiStudioLlmService`)
    - Test 3: Edge TTS Voiceover Synthesis (F11) -> PASS
    - Test 4: Word-Boundary Alignment Extraction (F12) -> PASS
    - Test 5: Storyboard Visual Prompts Formatting (F13) -> PASS
    - Test 6: Visual Assets Generation - Fallback/Mock Mode (F14) -> PASS
    - Test 7: FFmpeg Video Assembly & ASS Subtitle Burning (F15) -> PASS
    - Test 8: SEO Metadata Generation (F16) -> PASS
    - Test 9: Checkpoint State Machine & Resumption (F17) -> PASS
- Dedicated Pipeline Engine Test:
  - All 8 stages executed end-to-end via `AiStudioPipelineEngine.start()`.
  - Atomic persistence of `session.json` verified with complete artifacts.
  - Final video output verified at `assets/final_video.mp4` (21,544 bytes, valid H.264/AAC).
  - Single-line voice synthesis (`renderSingleLineVoice`), scene regeneration (`regenerateSceneAsset`), and custom re-render (`renderVideo`) verified.
  - Illegal transition rejection and graceful cancellation verified.

---

## 2. Logic Chain

1. **Decoupled Architecture**: By separating the monolithic pipeline stub into 4 specialized services (`AiStudioLlmService`, `AiStudioTtsService`, `AiStudioVisualService`, `AiStudioVideoAssembler`), each module encapsulates its distinct external dependencies (`openai`, `msedge-tts`, `GoogleVeoSessionManager`, `fluent-ffmpeg`).
2. **Resilience & Graceful Degradation**: Real-world generative pipelines encounter external failure modes (missing/invalid LLM API keys, rate limits, WebSocket disconnects, unauthenticated Google session). Implementing deterministic procedural fallbacks (calibrated 4-beat scripts, syllabic word alignment interpolation, procedural synthetic PNG card generation) ensures the pipeline never crashes and always delivers a verified MP4 output while maintaining full support for live cloud providers when authenticated.
3. **Atomic State & Resume Safety**: By persisting `session.json` atomically via temporary files and rename operations, corrupt writes due to unexpected process termination are eliminated. Downstream eviction on resume from stage $N$ guarantees that outdated artifacts (such as stale audio or mismatched visual assets) are never carried into newly rendered downstream products.
4. **Zero-Contamination & Contract Compliance**: Configuration and sessions resolve through dedicated directories (`resolveAiStudioCwd()` and `resolveAiStudioSessionsRoot()`), ensuring strict isolation from Vanhsub's `settingsStore` (`vanhsub-settings.json`) and Canvas workflow.

---

## 3. Caveats

- In headless CLI test environments, Google Flow authentication is typically unauthenticated; the visual service properly exercises the synthetic fallback mode. Full Google Flow browser execution requires interactive desktop login in Electron.
- In production runtime, FFmpeg binary unpacking from ASAR is automatically handled by the path replacements in `AiStudioTtsService` and `AiStudioVideoAssembler`.
- No caveats regarding TypeScript compilation or automated test execution.

---

## 4. Conclusion

Milestone 2 (Pipeline Engine & Modular Services) is **100% complete and verified**:
- 4 modular services implemented under `main/ai-studio/services/`.
- Central coordinator `AiStudioPipelineEngine` implements all 7 methods of `IAiStudioPipelineEngineDelegate` with 8 sequential stages, atomic disk checkpoints, resume capability, and cancellation.
- IPC router in `main/ai-studio/ipc.ts` automatically wires the engine into `setAiStudioPipelineEngine`.
- TypeScript check (`npx tsc --noEmit`) passes with 0 errors.
- Test suite (`scripts/test_ai_studio_pipeline.ts`) passes 9/9 tests cleanly.
- System is fully primed for Milestone 3 (UI Layer & Navigation).

---

## 5. Verification Method

To independently verify the Milestone 2 deliverables:

1. **TypeScript Type Check**:
   ```bash
   npx tsc --noEmit
   ```
   *Expected: Clean completion with exit code 0.*

2. **Official End-to-End Test Suite**:
   ```bash
   npx tsx scripts/test_ai_studio_pipeline.ts
   ```
   *Expected: All 9 tests pass with exit code 0.*

3. **Store Isolation & Security Regression Test**:
   ```bash
   npx tsx scripts/test_adversarial_ai_studio_store.ts
   ```
   *Expected: All 14 tests pass with exit code 0.*

4. **Verify File Layout Compliance**:
   Confirm that all 4 modular services are in `main/ai-studio/services/`, the engine is in `main/ai-studio/AiStudioPipelineEngine.ts`, and no temporary code files exist in `.agents/`.
