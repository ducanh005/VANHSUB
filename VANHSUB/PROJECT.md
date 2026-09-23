# Project: Vanhsub AI Video Studio Core Fixes (R1 - R4)

## Architecture
Vanhsub AI Video Studio orchestrates an 8-stage automated video generation pipeline:
1. Facts (`00_facts`)
2. Script (`01_script`)
3. Voiceover (`02_voice`) via `msedge-tts`
4. Timing (`03_timing`) via ffprobe
5. Storyboard (`04_storyboard`) with semantic clustering and visual prompt synthesis
6. Media Generation (`05_media`) via Google Flow Automation (T2I and I2V)
7. Video Assembly via FFmpeg (Ken Burns multi-shot concat, audio sync, ASS subtitles)
8. Metadata & Publishing

### Key Subsystems
- **Session & Window Management**: `main/veo/GoogleVeoSessionManager.ts` managing background Electron `BrowserWindow` for Google Flow.
- **Flow Automation Engine**: `main/workflow/flow-engine/` managing state machines for T2I/I2V interaction on Chromium WebContents.
- **Storyboard Service**: `main/ai-studio/services/AiStudioStoryboardService.ts` and `AiStudioLlmService.ts` clustering dialogue into 4-10s visual shots.
- **Media Automation Engine**: `main/ai-studio/services/FlowMediaAutomationEngine.ts` and `AiStudioPipelineEngine.ts` managing media creation, style references, and fault fallback.
- **Rendering & Video Assembly**: `main/ai-studio/services/AiStudioVideoAssembler.ts` assembling multi-shot clips with Ken Burns animation and audio muxing.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1.1 | Offscreen Window Creation | Parameterize `openLobbyWindow` to keep window at `(OFFSCREEN_X, OFFSCREEN_Y)` with `show: false` when `uiMode === 'offscreen'` | M1 | Survey R1 |
| F1.2 | Focus & Show Eradication | Eliminate all `win.show()`, `win.focus()`, `win.restore()` calls in offscreen mode across SessionManager, PipelineEngine, and FlowStates | M1 | Survey R1 |
| F1.3 | WebContents Background Input | Ensure `sendInputEvent` and `insertText` use `win.webContents.focus()` and DOM element focus without calling OS `win.focus()` | M1 | Survey R1 |
| F1.4 | Offscreen Diagnostic Capture | Remove onscreen flipping in `FlowRecoveryManager.ts` when taking diagnostic snapshots | M1 | Survey R1 |
| F1.5 | Default Configuration Alignment | Set default `uiMode` to `'offscreen'` in `types.ts`, renderer config, and channel defaults | M1 | Survey R1 |
| F2.1 | Storyboard Data Schema Expansion | Extend `StoryboardShotItem` and `PipelineShotMetadata` with `start_sec`, `duration_sec`, `assigned_sentences`, `assigned_scene_ids`, `dialogue_lines` | M2 | Survey R2 |
| F2.2 | LLM Semantic Clustering | Implement `clusterAndGenerateStoryboard()` in `AiStudioLlmService.ts` to group dialogue lines into 4s-10s contextual shots with rich prompts | M2 | Survey R2 |
| F2.3 | Deterministic Greedy Clustering Fallback | Implement offline heuristic clustering in `AiStudioStoryboardService.ts` grouping sentences to 4.0s-10.0s (ideal 5s-8s) | M2 | Survey R2 |
| F2.4 | Deterministic Audio Timing Alignment | Compute `start_sec` and `duration_sec` directly from `03_timing/timing.json` to guarantee 0.00s cumulative audio drift | M2 | Survey R2 |
| F2.5 | Pipeline Engine Storyboard Mapping | Map clustered shots to `session.artifacts.scenes` in `AiStudioPipelineEngine.ts` with correct `startMs`, `durationMs`, and combined `lineText` | M2 | Survey R2 |
| F3.1 | Canonical Style Anchor Model | Standardize reference image flow in `AiStudioPipelineEngine.ts` using `character_ref.png` and `background_ref.png` from `style_refs/` | M3 | Survey R3 |
| F3.2 | Explicit `previous_shot_id` Continuity | Add `previous_shot_id?: string` to shot schema and resolve continuity references by exact shot ID instead of `idx - 1` | M3 | Survey R3 |
| F3.3 | Reference Validation & Drift Prevention | Eliminate generation-from-generation drift; fallback to Canonical Anchor if previous shot asset is missing or invalid | M3 | Survey R3 |
| F4.1 | Local Fault Boundary in Stage 6 | Catch T2I / I2V errors per shot in `AiStudioPipelineEngine.ts`, preventing pipeline crashes after retries | M4 | Survey R4 |
| F4.2 | Automatic Fallback Asset Activation | On shot failure, copy/link Canonical Ref or adjacent valid shot as fallback asset, mark `fallback_used: true`, record in `index.json`/`session.json` | M4 | Survey R4 |
| F4.3 | Domino Prevention | Subsequent shots skip referencing failed shots and safely fallback to Canonical Anchor | M4 | Survey R4 |
| F4.4 | Multi-Shot FFmpeg Assembly Engine | Overhaul `AiStudioVideoAssembler.assembleVideo` to iterate over all shots in `scenes`, normalizing videos or generating Ken Burns clips | M4 | Survey R4 |
| F4.5 | Dynamic Ken Burns for Image-Only Shots | Apply FFmpeg `zoompan` animation with exact frame count matching shot duration for shots lacking video | M4 | Survey R4 |
| F4.6 | Concat Demuxer & Final Muxing | Sequentially concatenate all shot clips and mux with audio, BGM, and ASS subtitles | M4 | Survey R4 |
| F5.1 | Comprehensive E2E Test Suite | Automated test verification covering R1, R2, R3, R4 in `scripts/test_spec_pipeline_automation.ts` or new test suite | M5 | Acceptance Criteria |
| F5.2 | TypeScript Compilation Verification | `npx tsc --noEmit` passes with 0 errors across entire codebase | M5 | Acceptance Criteria |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Stealth & Offscreen Background Execution | F1.1, F1.2, F1.3, F1.4, F1.5 | none | PLANNED |
| M2 | Smart Storyboard Clustering & Timing | F2.1, F2.2, F2.3, F2.4, F2.5 | none | PLANNED |
| M3 | Reference Image Drift Elimination & Canonical Anchor | F3.1, F3.2, F3.3 | M2 | PLANNED |
| M4 | Fault Isolation, Fallback Asset & Multi-Shot Ken Burns Assembly | F4.1, F4.2, F4.3, F4.4, F4.5, F4.6 | M2, M3 | PLANNED |
| M5 | E2E Testing Track & Final Verification | F5.1, F5.2 | M1, M2, M3, M4 | PLANNED |

---

## Interface Contracts

### 1. `GoogleVeoSessionManager` ↔ `AiStudioPipelineEngine` / `FlowMediaAutomationEngine`
```typescript
interface OpenLobbyWindowOptions {
  uiMode?: 'offscreen' | 'live_window';
  forceRecreate?: boolean;
}
openLobbyWindow(options?: OpenLobbyWindowOptions): Promise<BrowserWindow>;
getLobbyWindow(): BrowserWindow | null;
```

### 2. `AiStudioStoryboardService` & `AiStudioLlmService` ↔ `AiStudioPipelineEngine`
```typescript
interface StoryboardShotItem {
  shot_id: string; // e.g. "scene_01_shot_1"
  shot_index?: number;
  start_sec: number; // absolute start timestamp on timeline
  duration_sec: number; // precise duration in seconds (4.0s - 10.0s)
  assigned_sentences: number[]; // indices of sentences in script
  assigned_scene_ids: string[]; // e.g. ["scene_01", "scene_02"]
  dialogue_lines: string[]; // dialogue texts in this cluster
  image_prompt: string; // comprehensive visual prompt in English
  motion_note?: string; // cinematic motion description
  media_type: ShotMediaType;
  previous_shot_id?: string; // explicit previous shot reference for continuity
  reason: string;
  confidence?: ShotConfidence;
}
```

### 3. `FlowMediaAutomationEngine` ↔ `AiStudioPipelineEngine`
```typescript
interface GenerateShotVisualResult {
  success: boolean;
  imagePath?: string;
  videoPath?: string;
  fallbackUsed?: boolean;
  fallbackSource?: 'canonical_character_ref' | 'adjacent_shot' | 'none';
  error?: string;
}
```

### 4. `AiStudioVideoAssembler` ↔ `AiStudioPipelineEngine`
```typescript
interface AssembleVideoOptions {
  scenes: Array<{
    id: string;
    shotId?: string;
    startMs: number;
    endMs: number;
    durationMs: number;
    assetPath?: string; // video path or image path
    imagePath?: string;
    videoPath?: string;
    lineText?: string;
  }>;
  voiceoverAudioPath: string;
  outputVideoPath: string;
  renderingConfig: AiStudioRenderingConfig;
  subtitlesConfig?: AiStudioSubtitlesConfig;
  bgmPath?: string;
  bgmVolume?: number;
  wordsAlignment?: Array<{ word: string; startMs: number; endMs: number }>;
}
```

---

## Code Layout
- `main/veo/GoogleVeoSessionManager.ts`: Session & window lifecycle, offscreen positioning.
- `main/workflow/flow-engine/states/`: Flow automation states (Video & Image generation).
- `main/workflow/flow-engine/FlowRecoveryManager.ts`: Error recovery & diagnostics.
- `main/ai-studio/types/storage.ts`: Pipeline storage and metadata schemas.
- `main/ai-studio/types.ts` & `renderer/types/aiStudio.ts`: Default configuration definitions.
- `main/ai-studio/services/AiStudioStoryboardService.ts`: Storyboard clustering and heuristic generation.
- `main/ai-studio/services/AiStudioLlmService.ts`: LLM semantic clustering.
- `main/ai-studio/services/AiStudioPipelineEngine.ts`: 8-stage pipeline orchestrator.
- `main/ai-studio/services/FlowMediaAutomationEngine.ts`: Google Flow task execution.
- `main/ai-studio/services/AiStudioStyleRefsService.ts`: Project-level style reference assets.
- `main/ai-studio/services/AiStudioVideoAssembler.ts`: FFmpeg multi-shot assembly with Ken Burns.
- `scripts/test_spec_pipeline_automation.ts`: Automated test harness.
