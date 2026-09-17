# Handoff Report: Specification Mining for Vanhsub AI Video Studio

**Working Directory**: `d:\DEAN\DEAN\VANHSUB\.agents\spec_miner_survey`  
**Report Artifact**: `d:\DEAN\DEAN\VANHSUB\.agents\spec_miner_survey\spec_inventory.md`  
**Timestamp**: 2026-09-17T06:33:00Z  
**Type**: Hard Handoff (Task Complete)

---

## 1. Observation

1. **Mandatory Specifications**:
   - `d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md` (header `## 2026-09-17T06:24:37Z`, lines 45-103):
     - R1: Dedicated Settings & Store (`aiStudioStore` on `electron-store` and Zustand, schemas for `llm`, `voice`, `flowEngine`, `rendering`, `subtitles`, no collision with `settingsStore`/`workflowStore`).
     - R2: Pipeline Engine with 8 stages (1. Dữ kiện, 2. Kịch bản, 3. Lồng tiếng, 4. Trích xuất Time, 5. Storyboard, 6. Ảnh/Video, 7. Dựng phim, 8. SEO) + Checkpoint State Machine.
     - R3: One-Click Auto-Pilot UI (Idea intake, 8-step status tracker, quick preview player).
     - R4: Custom Workflow Studio UI (Tab 1: Script & Voiceover, Tab 2: Storyboard Visual, Tab 3: Assembly & Subtitle).
     - R5: App Navigation Integration (Sidebar item, sub-navigation tabs, Dark mode Tailwind/Radix UI).
     - Acceptance Criteria: Type check `npx tsc --noEmit` 100% clean, independent test script `scripts/test_ai_studio_pipeline.ts`.
   - `d:\DEAN\DEAN\VANHSUB\AI_STUDIO_SPEC.md` (lines 1-236):
     - Section 5.1 & 5.2: Exact TypeScript interface `AiStudioConfig` and default values JSON.
     - Section 3.2: 8-Step pipeline breakdown with artifacts and technology mappings.
     - Section 3.3: Fail-safe and checkpoint recovery requirements for Google Flow interruption.
     - Section 4.2: Granular requirements for Custom Studio Tabs 1, 2, and 3.

2. **Codebase Pattern Observations**:
   - `main/store/settingsStore.ts` (lines 88-143): Uses lazy singleton pattern for `Store<AppSettings>` with `vanhsub-settings` and safeStorage encryption for sensitive secrets.
   - `main/preload.ts` (lines 1-196): Exposes `vanhsub` API on `window` via `contextBridge.exposeInMainWorld`, mapping domain methods to `ipcRenderer.invoke`.
   - `renderer/pages/home.tsx` (lines 56-65, lines 555-565): Navigation items array `getNavItems()` rendering sidebar buttons, toggling `activeTab` with conditionally rendered container divs.
   - `main/tts-providers/edge/EdgeTTSClient.ts` (lines 1-120) & `node_modules/msedge-tts/dist/MsEdgeTTS.d.ts` (lines 14-28): `MsEdgeTTS` client supports `wordBoundaryEnabled: true` in `MetadataOptions`, emitting word-level offsets and durations via WebSocket metadata stream.
   - `main/workflow/flow-engine`: Contains `FlowStateMachine.ts`, `FlowTaskQueue.ts`, `FlowCheckpointManager.ts`, and `GoogleVeoSessionManager.ts` (status methods `getStatus()`, `generateImageViaBrowserContext()`).
   - `main/render/videoRenderer.ts` & `assCompiler.ts`: Fluent-ffmpeg configured with `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe`, supporting ASS dynamic subtitles, audio mixing, and video concatenation.

---

## 2. Logic Chain

1. **Isolation Requirement (R1)**:
   - To satisfy the requirement that `aiStudioStore` does not alter or conflict with existing stores (`settingsStore` and `workflowStore`), the new store must have its own disk storage name (`vanhsub-ai-studio`) and separate Zustand hook (`useAiStudioStore`).
   - Keys must be typed strictly to `AiStudioConfig` as specified in `AI_STUDIO_SPEC.md` §5.1 without polluting global `AppSettings`.

2. **Pipeline Engine & Checkpoint Design (R2)**:
   - The 8 stages form a sequential dependency graph: Idea $\rightarrow$ Script $\rightarrow$ Voice $\rightarrow$ Alignment $\rightarrow$ Storyboard $\rightarrow$ Visual Assets $\rightarrow$ Render $\rightarrow$ SEO.
   - If stage 6 (Google Flow) is interrupted by captcha or rate limiting, stages 1 through 5 are already valid and must not be invalidated.
   - Therefore, a persistent Checkpoint State Machine must record the status and artifact pointer for each stage. Resuming from stage 6 only executes missing scene generations.
   - Providing a "Fallback Mock Assets" pathway allows testing and demo rendering even when unauthenticated or offline.

3. **UI Decomposition (R3 & R4)**:
   - Mode 1 (Auto-Pilot): Needs an intuitive prompt intake, a reactive 8-stage progress tracker listening to IPC push events (`aiStudio:pipeline:progress`), and inline preview players.
   - Mode 2 (Custom Studio): Divides the pipeline into 3 logical editing surfaces:
     - Tab 1 governs Script & Voice: allows per-sentence text editing, per-line TTS re-generation, and retention scoring.
     - Tab 2 governs Visual Storyboard: allows per-scene prompt editing, individual image regeneration via Google Flow, manual image upload, and Ken Burns motion assignment.
     - Tab 3 governs Final Assembly: allows subtitle preset/style tuning, BGM volume & ducking adjustment, live player preview, and final FFmpeg render invocation.

4. **Integration & Navigation (R5)**:
   - Adding `ai-studio` to `getNavItems` in `renderer/pages/home.tsx` integrates the studio into the existing sidebar.
   - The sub-navigation header (Auto-Pilot / Custom Studio / Settings) enables seamless switching while preserving shared session state in `useAiStudioStore`.

---

## 3. Caveats

1. **Live Google Flow Browser Session**:
   - Google Flow live generation requires an active authenticated Google session. While the automation engine is integrated, our specification explicitly mandates a robust "Mock Assets Fallback" to ensure the pipeline and test scripts remain 100% executable even without active Google credentials.
2. **FFmpeg Transcoding Performance**:
   - Heavy 4K 60FPS video assembly with Ken Burns filter on long scripts (> 70 scenes) can be CPU/GPU intensive. Default configuration is pegged at 1080p 30FPS with fast presets.
3. **No Modification Constraint**:
   - As a Specification Miner, no production source code has been modified in this survey phase. All specifications, models, and contracts are compiled into `.agents/spec_miner_survey/spec_inventory.md`.

---

## 4. Conclusion

The specification mining and architecture survey is **100% complete**:
- **38 Granular Features** documented in the `## Features Discovered` table covering R1, R2, R3, R4, R5, and IPC contracts.
- **16 Edge Cases** documented with explicit fail-safe and defensive behaviors.
- **Exact TypeScript Schemas** specified for `AiStudioConfig`, stage inputs/outputs, artifacts (Stages 1-8), session checkpoints, and IPC channels.
- **Error Recovery Protocols** established for Google Flow interruptions, LLM rate limits, Edge TTS timeouts, and FFmpeg render fallbacks.
- Comprehensive inventory report written to `d:\DEAN\DEAN\VANHSUB\.agents\spec_miner_survey\spec_inventory.md`.

---

## 5. Verification Method

To independently verify the findings and specifications:
1. **Inspect Report Artifact**:
   - Read `d:\DEAN\DEAN\VANHSUB\.agents\spec_miner_survey\spec_inventory.md`.
   - Verify presence of sections 1 through 7, including tables `## Features Discovered` and `## Edge Cases`.
2. **Verify Schema Alignment**:
   - Cross-reference `AiStudioConfig` in `spec_inventory.md` §4.1 against `d:\DEAN\DEAN\VANHSUB\AI_STUDIO_SPEC.md` §5.1.
   - Cross-reference default values against `AI_STUDIO_SPEC.md` §5.2.
3. **Verify Existing Codebase Interoperability**:
   - Check `main/store/settingsStore.ts` to confirm store naming and isolation.
   - Check `main/tts-providers/edge/EdgeTTSClient.ts` and `main/render/videoRenderer.ts` to confirm compatibility with the proposed 8-stage pipeline.
