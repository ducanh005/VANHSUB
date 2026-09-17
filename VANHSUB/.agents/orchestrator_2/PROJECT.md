# Project: Vanhsub AI Video Studio

## Architecture
The AI Video Studio subsystem introduces automated end-to-end video creation to Vanhsub with two distinct user-facing modes:
1. **Auto-Pilot (One-Click Pipeline)**: Takes a prompt/idea and executes an 8-stage automated generation sequence to produce a complete MP4 video.
2. **Custom Studio (Granular Workflow)**: 3-tab interactive studio (Script & Voiceover, Storyboard Visual Cards, Video Assembly & Subtitles) allowing fine-grained user editing.

### Data Flow & Isolation Architecture
- **Isolated Configuration Store**: `aiStudioStore` runs independently in Electron Main (`electron-store` pointing to `vanhsub-ai-studio.json`) and Renderer (`zustand` store `useAiStudioStore`), completely decoupled from `settingsStore` (`vanhsub-settings.json`) and `workflowStore`.
- **8-Stage Pipeline Engine**:
  1. `Dữ kiện (Idea Blueprint)`: Analyzes topic, target length, and narrative hook.
  2. `Kịch bản (Script)`: Calls LLM (DeepSeek / OpenAI) to generate structured beats and dialogue lines.
  3. `Lồng tiếng (Voiceover)`: Uses `msedge-tts` (Azure Neural Vietnamese voices) for audio synthesis.
  4. `Trích xuất Time (Alignment)`: Leverages native `WordBoundary` events from Edge TTS metadata to obtain millisecond timestamps for every word and line.
  5. `Storyboard (Visual Prompts)`: Generates cinematic English visual prompts for each scene based on line context.
  6. `Ảnh/Video (Visual Assets)`: Coordinates with Google Flow Engine (`GoogleVeoSessionManager` when authenticated; seamless synthetic fallback when unauthenticated or offline).
  7. `Dựng phim (FFmpeg Assembly)`: Uses `fluent-ffmpeg` with Ken Burns zoom/pan on visuals, mixes ducked BGM with voiceover, and burns styled ASS subtitles.
  8. `SEO & Xuất bản (Metadata)`: Generates viral titles, descriptions, hashtags, and thumbnail prompts.
- **Checkpoint & State Machine**: State and artifacts are persisted to disk at each stage, enabling seamless Resume and Per-Stage Retry.
- **IPC Protocol**: Modular registration in `main/ai-studio/ipc.ts` exposed via `main/preload.ts` (`window.vanhsub.aiStudio`) and typed in `renderer/types/electron.d.ts`.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | Dedicated Main Store | `electron-store` persistence (`vanhsub-ai-studio.json`), DPAPI encryption for API keys, headless test fallback | M1 | `spec_inventory.md` F01 |
| F02 | Zustand Renderer Store | Isolated `useAiStudioStore` with 2-way IPC sync | M1 | `spec_inventory.md` F02 |
| F03 | LLM Multi-Provider Config | DeepSeek, OpenAI, Custom baseUrl, temperature, presets | M1 | `spec_inventory.md` F03 |
| F04 | Edge TTS Voice Config | Voice ID (`vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`), rate, pitch, auto alignment | M1 | `spec_inventory.md` F04 |
| F05 | Google Flow Config | Aspect ratios (16:9, 9:16, 1:1), output mode (image/video), style prefixes, negative prompts, downloadDir | M1 | `spec_inventory.md` F05 |
| F06 | FFmpeg Render Config | Resolution (1080p, 720p, 4k), FPS, Ken Burns scale/transition, BGM volume, ducking | M1 | `spec_inventory.md` F06 |
| F07 | Dynamic Subtitle Config | Presets (`tiktok_bold`, `karaoke_glow`, `minimalist`), font styling, ASS color normalization | M1 | `spec_inventory.md` F07 |
| F08 | Reset to Defaults | Complete reset of AI Studio config to technical specification defaults | M1 | `spec_inventory.md` F08 |
| F09 | Stage 1: Idea Blueprint | Analyzes prompt/topic, hook, and narrative structure | M2 | `spec_inventory.md` F09 |
| F10 | Stage 2: Script Generation | LLM structured dialogue generation with `jsonrepair` and retry | M2 | `spec_inventory.md` F10 |
| F11 | Stage 3: Edge TTS Voiceover | Synthesizes full `voiceover.mp3` with reconnection resilience | M2 | `spec_inventory.md` F11 |
| F12 | Stage 4: Word-Boundary Alignment | Native Edge TTS metadata timestamp extraction with syllabic fallback | M2 | `spec_inventory.md` F12 |
| F13 | Stage 5: Visual Storyboard | Generates cinematic English visual prompts for each scene | M2 | `spec_inventory.md` F13 |
| F14 | Stage 6: Visual Assets Generation | Dual-mode Google Flow dispatcher (real session + synthetic fallback) | M2 | `spec_inventory.md` F14 |
| F15 | Stage 7: FFmpeg Video Assembly | Ken Burns zoompan + ducked BGM + ASS subtitles to MP4 | M2 | `spec_inventory.md` F15 |
| F16 | Stage 8: SEO & Publishing | Viral title, description, hashtags, and thumbnail prompt | M2 | `spec_inventory.md` F16 |
| F17 | Checkpoint State Machine | Save/resume session, stage retry, artifact preservation | M2 | `spec_inventory.md` F17 |
| F18 | Auto-Pilot Idea Input UI | Topic input, quick options, "Bắt đầu sản xuất" button | M3 | `spec_inventory.md` F18 |
| F19 | 8-Step Live Status Tracker | Real-time visual pipeline progress with pending/running/success/error badges | M3 | `spec_inventory.md` F19 |
| F20 | Auto-Pilot Quick Preview | In-line Audio & Video players for instant playback | M3 | `spec_inventory.md` F20 |
| F21 | Video Download & Explorer Shell | Save video dialog and open in Windows Explorer | M3 | `spec_inventory.md` F21 |
| F22 | Custom Tab 1: Timeline Script Editor | Inline text editing per dialogue line with timeline markers | M3 | `spec_inventory.md` F22 |
| F23 | Custom Tab 1: Per-Line Voice Controls | Single-line voice re-synthesis and audio preview | M3 | `spec_inventory.md` F23 |
| F24 | Custom Tab 1: Time Re-alignment | Re-align timestamps after manual script edits | M3 | `spec_inventory.md` F24 |
| F25 | Custom Tab 1: Script Audit | Audience retention and hook quality evaluation (0-100) | M3 | `spec_inventory.md` F25 |
| F26 | Custom Tab 2: Storyboard Cards | Visual scene cards mapped to script timeline | M3 | `spec_inventory.md` F26 |
| F27 | Custom Tab 2: Visual Prompt Editor | Textarea for modifying English prompts per scene | M3 | `spec_inventory.md` F27 |
| F28 | Custom Tab 2: Per-Scene Regenerate | Single-scene re-generation via Flow Engine | M3 | `spec_inventory.md` F28 |
| F29 | Custom Tab 2: Manual Image Upload | Local asset upload dialog replacing scene image | M3 | `spec_inventory.md` F29 |
| F30 | Custom Tab 2: Motion Type Selector | Static + Ken Burns (Zoom/Pan) vs Motion Clip | M3 | `spec_inventory.md` F30 |
| F31 | Custom Tab 3: Subtitle Styler | Style selector, color picker, font size, position slider | M3 | `spec_inventory.md` F31 |
| F32 | Custom Tab 3: BGM & Motion Controls | BGM selector, volume slider, audio ducking switch | M3 | `spec_inventory.md` F32 |
| F33 | Custom Tab 3: Live Studio Preview | Real-time preview with visual slides and audio playback | M3 | `spec_inventory.md` F33 |
| F34 | Custom Tab 3: Render Final Video | Triggers FFmpeg assembly with live progress bar | M3 | `spec_inventory.md` F34 |
| F35 | Sidebar Navigation Integration | "AI Studio" item in `home.tsx` sidebar with Sparkles icon and badge | M3 | `spec_inventory.md` F35 |
| F36 | Sub-Navigation Tabs | Auto-Pilot, Custom Studio, Settings view switcher | M3 | `spec_inventory.md` F36 |
| F37 | Design System Alignment | TailwindCSS v4, Obsidian dark palette, Radix UI, Lucide icons | M3 | `spec_inventory.md` F37 |
| F38 | IPC Bridge & Typed Contracts | Complete IPC channels for config, pipeline execution, step control, and events | M1, M2 | `spec_inventory.md` F38 |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Test Suite Track | Test harness (`scripts/test_ai_studio_pipeline.ts`), opaque-box test tiers, verification of all 8 stages | none | DONE |
| M1 | Dedicated Settings & Store | `main/store/aiStudioStore.ts`, `renderer/lib/store/aiStudioStore.ts`, IPC config handlers, encryption, default schemas (F01-F08, F38) | none | DONE |
| M2 | Pipeline Engine & Services | 8 continuous stages, `AiStudioPipelineEngine`, modular services (LLM, TTS, Visual Dual-Mode, Video Assembler), Checkpoints & State Machine (F09-F17, F38) | M1 | PLANNED |
| M3 | UI Layer & Navigation | Auto-Pilot view (F18-F21), Custom Studio 3 Tabs (F22-F34), AI Studio Settings tab, Sidebar integration in `home.tsx` (F35-F37) | M1, M2 | PLANNED |
| M4 | Integration, E2E Pass & Hardening | Full build & typecheck clean (`npx tsc --noEmit`), E2E pipeline verification via `scripts/test_ai_studio_pipeline.ts`, adversarial hardening | E2E, M1, M2, M3 | PLANNED |

---

## Interface Contracts

### 1. Configuration Schema (`AiStudioConfig`)
Defined in `shared/types/aiStudio.ts` / `main/ai-studio/types.ts` / `renderer/types/aiStudio.ts`:
```typescript
export interface AiStudioLlmConfig {
  provider: 'deepseek' | 'openai' | 'custom';
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature: number;
  systemPromptPreset: string;
}

export interface AiStudioVoiceConfig {
  provider: 'edge_tts' | 'local_onnx';
  voiceId: string;
  rate: string;
  pitch: string;
  volume: string;
  autoWordAlignment: boolean;
}

export interface AiStudioFlowEngineConfig {
  aspectRatio: '16:9' | '9:16' | '1:1';
  outputMode: 'image' | 'video';
  stylePromptPrefix: string;
  negativePrompt: string;
  outputsPerScene: 1 | 2 | 4;
  downloadDir: string;
  concurrency: number;
}

export interface AiStudioRenderingConfig {
  resolution: '1080p' | '720p' | '4k';
  fps: 30 | 60;
  kenBurnsEffect: boolean;
  kenBurnsScale: number;
  transitionDuration: number;
  defaultBgmPath?: string;
  bgmVolume: number;
  autoAudioDucking: boolean;
}

export interface AiStudioSubtitleConfig {
  enabled: boolean;
  preset: 'tiktok_bold' | 'minimalist' | 'classic_bar' | 'karaoke_glow';
  fontSize: number;
  primaryColor: string;
  outlineColor: string;
  outlineWidth: number;
  positionY: number;
}

export interface AiStudioConfig {
  llm: AiStudioLlmConfig;
  voice: AiStudioVoiceConfig;
  flowEngine: AiStudioFlowEngineConfig;
  rendering: AiStudioRenderingConfig;
  subtitles: AiStudioSubtitleConfig;
}
```

### 2. IPC Channels
- `aiStudio:config:get` -> returns `AiStudioConfig`
- `aiStudio:config:set` -> payload `Partial<AiStudioConfig>` -> returns `AiStudioConfig`
- `aiStudio:config:reset` -> returns `AiStudioConfig`
- `aiStudio:pipeline:start` -> payload `{ topic: string; options?: Partial<AiStudioConfig> }` -> returns `{ sessionId: string }`
- `aiStudio:pipeline:resume` -> payload `{ sessionId: string; fromStage?: number }` -> returns `{ success: boolean }`
- `aiStudio:pipeline:cancel` -> payload `{ sessionId: string }` -> returns `{ success: boolean }`
- `aiStudio:pipeline:getState` -> payload `{ sessionId: string }` -> returns `PipelineSessionState`
- `aiStudio:step:renderSingleLineVoice` -> payload `{ lineIndex: number; text: string; voiceConfig: AiStudioVoiceConfig }` -> returns `{ audioPath: string; durationMs: number }`
- `aiStudio:step:regenerateSceneAsset` -> payload `{ sceneId: string; visualPrompt: string; flowConfig: AiStudioFlowEngineConfig }` -> returns `{ assetPath: string }`
- `aiStudio:step:renderVideo` -> payload `{ sessionId: string; customSettings?: Partial<AiStudioRenderingConfig & AiStudioSubtitleConfig> }` -> returns `{ videoPath: string }`
- `aiStudio:pipeline:progress` (push event from main to renderer): `{ sessionId: string; stage: number; stageName: string; progress: number; status: 'pending' | 'running' | 'success' | 'error'; message?: string; error?: string; artifacts?: any }`

---

## Code Layout
```
main/
  ai-studio/
    types.ts                        # Complete shared types for AI Studio
    ipc.ts                          # IPC handlers registration (registerAiStudioIpc)
    AiStudioPipelineEngine.ts       # 8-stage coordinator with checkpoint/state machine
    services/
      AiStudioLlmService.ts         # LLM prompt, script generation, SEO metadata
      AiStudioTtsService.ts         # msedge-tts synthesis & word-boundary timestamp extraction
      AiStudioVisualService.ts      # Dual-mode Google Flow dispatcher & synthetic asset generator
      AiStudioVideoAssembler.ts     # FFmpeg video assembly (Ken Burns, ducked BGM, ASS subtitles)
  store/
    aiStudioStore.ts                # Isolated electron-store (vanhsub-ai-studio.json)
  preload.ts                        # Expose window.vanhsub.aiStudio

renderer/
  types/
    aiStudio.ts                     # Renderer-side AI Studio typings
    electron.d.ts                   # VanhsubAPI extension with aiStudio
  lib/
    store/
      aiStudioStore.ts              # Zustand store for AI Studio state & 2-way IPC sync
  components/
    ai-studio/
      AiStudioContainer.tsx         # Main container with mode switcher
      AutoPilotView.tsx             # One-Click Auto-Pilot UI (Idea input, 8-step tracker, preview)
      CustomStudioView.tsx          # Custom Studio with 3 sub-tabs
      AiStudioSettingsTab.tsx       # Dedicated AI Studio configuration panel
      custom/
        ScriptVoiceTab.tsx          # Tab 1: Timeline script editor, voice controls, script score
        StoryboardTab.tsx           # Tab 2: Visual scene cards, prompt editing, per-scene regenerate
        AssemblySubtitleTab.tsx     # Tab 3: Subtitle styling, Ken Burns, BGM ducking, live preview
  pages/
    home.tsx                        # Sidebar item "AI Studio" & tab container mounting

scripts/
  test_ai_studio_pipeline.ts        # Comprehensive standalone E2E pipeline test suite
```
