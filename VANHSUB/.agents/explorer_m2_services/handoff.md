# Handoff Report: Milestone 2 Modular Services Design

## 1. Observation
1. **Codebase Baseline**:
   - `scripts/test_ai_studio_pipeline.ts`: Line 699 attempts dynamic import of `../main/ai-studio/services/AiStudioLlmService` with fallback to `generateStructuredScript`. Tests 1 through 9 cover store isolation, script generation, Edge TTS voiceover, WordBoundary alignment, storyboard prompts, synthetic assets, FFmpeg video assembly, SEO metadata, and checkpoint resumption.
   - Ran `npx tsx scripts/test_ai_studio_pipeline.ts`: Output: `ALL 9 PIPELINE TESTS PASSED SUCCESSFULLY! Total Duration: 3.82s`.
   - `main/ai-studio/types.ts`: Lines 105-116 define `AiStudioConfig` (`llm`, `voice`, `flowEngine`, `rendering`, `subtitles`). Lines 254-337 define `PipelineSessionState`, `ScriptBeatLine`, `WordTimestamp`, `StoryboardScene`. Lines 384-413 define payloads and results for single-line voice, scene asset regeneration, and video rendering.
   - `main/ai-studio/ipc.ts`: Lines 39-63 define `IAiStudioPipelineEngineDelegate` with 7 methods (`start`, `resume`, `cancel`, `getState`, `renderSingleLineVoice`, `regenerateSceneAsset`, `renderVideo`). Lines 108-295 register 10 IPC channels.
   - `main/ai-studio/pipelineEngine.ts`: Lines 97-432 implement `AiStudioPipelineEngine` with inlined stubs for script generation, voice synthesis, image generation, and video assembly. It does not yet delegate to modular service classes.
   - `main/tts-providers/edge/EdgeTTSClient.ts`: Demonstrates `MsEdgeTTS` instantiation with `vi-VN-HoaiMyNeural` and `vi-VN-NamMinhNeural` but only consumes `audioStream`, lacking `metadataStream` capture for `WordBoundary` events.
   - `main/render/assCompiler.ts` & `main/render/videoRenderer.ts`: Contain battle-tested `escapeFfmpegSubtitlesPath` (lines 36-43), `hexToAssColor`, `formatAssTime`, `buildForceStyle`, and `burnHardsub`.
   - `main/veo/GoogleVeoSessionManager.ts`: Line 1768 defines `generateImageViaBrowserContext` and Line 1700 defines `generateVideoViaBrowserContext`. Lines 606-873 define `validateSession()`. Concurrency is protected by `GoogleFlowBrowserMutex`.
   - `package.json`: Lines 14, 15, 43, 48, 51, 56 show `@ffmpeg-installer/ffmpeg` (^1.1.0), `@ffprobe-installer/ffprobe` (^2.1.2), `fluent-ffmpeg` (^2.1.3), `jsonrepair` (^3.15.0), `msedge-tts` (^2.0.7), and `openai` (^7.5.0) are already installed.
   - Baseline TypeScript compilation: Ran `npx tsc --noEmit`. `main/` and all backend files are 100% clean of TypeScript errors; only minor renderer component typing warnings exist in `renderer/components/ai-studio/AutoPilotView.tsx`.

## 2. Logic Chain
1. *From Observation 1 & 4*: The current `AiStudioPipelineEngine` bundles all stage implementations into a monolithic class with simplified mock generators. To achieve architectural modularity, maintainability, and support Milestone 3's Custom Studio granular editing operations, four independent backend services must be created under `main/ai-studio/services/`:
   - `AiStudioLlmService.ts`
   - `AiStudioTtsService.ts`
   - `AiStudioVisualService.ts`
   - `AiStudioVideoAssembler.ts`
2. *From Observation 2 & 7*: `scripts/test_ai_studio_pipeline.ts` explicitly expects `AiStudioLlmService.ts` to export `generateScript(topic: string, llmConfig: AiStudioLlmConfig): Promise<ScriptBeatLine[]>`. Moreover, when LLM API keys are unconfigured (the default state in local development and CI), `AiStudioLlmService` must provide a deterministic procedural fallback generator returning valid multi-beat scripts with positive durations.
3. *From Observation 5*: Standard `EdgeTTSClient` does not capture the metadata stream. By instantiating `MsEdgeTTS` with `wordBoundaryEnabled: true` and listening to `metadataStream`, `AiStudioTtsService` can extract native `WordBoundary` timestamps in 100ns units (`Math.round(ticks / 10000)`), with automatic fallback to syllabic interpolation when metadata chunks are dropped.
4. *From Observation 6*: Video assembly on Windows requires escaping backslashes and drive colons (`C:/` -> `C\:/`) in ASS subtitle paths before passing them into FFmpeg's `subtitles` filter. `AiStudioVideoAssembler` adopts the existing project convention `escapeFfmpegSubtitlesPath` to prevent libass parse crashes.
5. *From Observation 7*: Visual generation must be dual-mode: when Google Flow session is authenticated and active, it delegates to `GoogleVeoSessionManager` via `GoogleFlowBrowserMutex`; otherwise, it generates high-resolution synthetic scene cards using FFmpeg `lavfi` color filter, ensuring zero pipeline blockage in test or unauthenticated states.

## 3. Caveats
- **Live LLM Network Calls**: Calling real OpenAI or DeepSeek APIs requires valid internet access and active API keys. When keys are blank or expired, the services transparently engage procedural fallback generation to maintain 100% pipeline continuity.
- **Renderer TS Errors**: Baseline `npx tsc --noEmit` reported typing discrepancies in `renderer/components/ai-studio/AutoPilotView.tsx` (M3 scope). The backend services under `main/ai-studio/` are fully decoupled from renderer components.

## 4. Conclusion
The architectural blueprint for Milestone 2's 4 modular backend services is complete, fully specified, and documented in `d:\DEAN\DEAN\VANHSUB\.agents\explorer_m2_services\m2_services_plan.md`. The services cleanly divide responsibilities across LLM, TTS, Visuals, and Video Assembly, conform to all IPC contracts and test suite expectations, and provide seamless dual-mode execution and procedural fallbacks.

## 5. Verification Method
1. **End-to-End Pipeline Verification**:
   Execute the automated standalone test suite:
   ```bash
   npx tsx scripts/test_ai_studio_pipeline.ts
   ```
   *Expected result*: All 9 automated tests PASS with 0 failures.
2. **TypeScript Compilation Check**:
   Execute type check across workspace:
   ```bash
   npx tsc --noEmit
   ```
   *Expected result*: `main/ai-studio/` and all related backend modules compile with 0 errors.
3. **Artifact Inspection**:
   Inspect `d:\DEAN\DEAN\VANHSUB\.agents\explorer_m2_services\m2_services_plan.md` for complete class interfaces, methods, and FFmpeg filter chains.
