# Milestone 1 IPC Bridge Implementation Blueprint
**Subsystem**: Vanhsub AI Video Studio  
**Target Milestone**: Milestone 1 (Foundation, Isolated Store & IPC Bridge)  
**Author**: IPC Bridge Explorer (`explorer_m1_ipc`)  
**Status**: Ready for Implementation  

---

## 1. Executive Summary & Architecture

The IPC Bridge for the AI Video Studio provides a strictly isolated, asynchronous, type-safe communication channel between the Electron Main process and the Next.js/React Renderer process. 

### Core Architectural Principles
1. **Zero Side-Effect Isolation**: The AI Video Studio IPC channels do not modify or collide with existing Vanhsub channels (`tasks:*`, `settings:*`, `workflow:*`, `bible:*`, `veo:*`).
2. **Modular Handler Router Pattern**: Following the proven architectural pattern of `main/workflow/ipc.ts` (`registerWorkflowIpc()`), all AI Studio IPC handling logic is encapsulated in `main/ai-studio/ipc.ts` via `registerAiStudioIpc()`. The main entry point `main/main.ts` requires only a 1-line import and a 1-line call.
3. **Idempotent Registration**: To eliminate Electron runtime crashes during development reloads or test iterations (`Error: Attempted to register a second handler for ...`), every handler is safely unregistered via `ipcMain.removeHandler` before `ipcMain.handle`.
4. **Delegate Architecture for Milestone 2 Forward-Compatibility**: To avoid rewriting or modifying `main/ai-studio/ipc.ts` when Milestone 2 arrives, an `IAiStudioPipelineEngineDelegate` pattern is implemented. In Milestone 1, stubs cleanly report descriptive errors or return typed placeholders. In Milestone 2, the pipeline engine attaches itself via `setAiStudioPipelineEngine()` without changing the IPC routing code.
5. **Contract Resiliency & Dual Aliases**: Preload exposes both canonical action methods (`getConfig`, `updateConfig`, `resetConfig`) and concise aliases (`get`, `set`, `reset`), ensuring 100% interoperability regardless of frontend caller preference.

---

## 2. Complete Contract & Type Definitions

The types governing IPC payloads and responses are synchronized across Main and Renderer.

### 2.1. Main Process Types (`main/ai-studio/types.ts`)
```typescript
// ============================================================================
// AI Video Studio Configuration Schema (AI_STUDIO_SPEC.md §5.1)
// ============================================================================

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

// ============================================================================
// Pipeline & Step IPC Types (Milestone 2 Forward-Compatibility)
// ============================================================================

export type PipelineStageStatus = 'pending' | 'running' | 'success' | 'error';

export interface PipelineProgressEvent {
  sessionId: string;
  stage: number;
  stageName: string;
  progress: number;
  status: PipelineStageStatus;
  message?: string;
  error?: string;
  artifacts?: Record<string, any>;
}

export interface PipelineStageInfo {
  stage: number;
  name: string;
  status: PipelineStageStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface ScriptLineItem {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  visualPrompt?: string;
  assetPath?: string;
  audioPath?: string;
}

export interface PipelineSessionState {
  sessionId: string;
  topic: string;
  currentStage: number;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  stages: PipelineStageInfo[];
  scriptLines?: ScriptLineItem[];
  audioPath?: string;
  videoPath?: string;
  seoMetadata?: {
    title: string;
    description: string;
    hashtags: string[];
    thumbnailPrompt?: string;
  };
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StartPipelinePayload {
  topic: string;
  options?: Partial<AiStudioConfig>;
}

export interface StartPipelineResult {
  sessionId: string;
}

export interface ResumePipelinePayload {
  sessionId: string;
  fromStage?: number;
}

export interface ResumePipelineResult {
  success: boolean;
}

export interface CancelPipelinePayload {
  sessionId: string;
}

export interface CancelPipelineResult {
  success: boolean;
}

export interface GetPipelineStatePayload {
  sessionId: string;
}

export interface RenderSingleLineVoicePayload {
  lineIndex: number;
  text: string;
  voiceConfig: AiStudioVoiceConfig;
}

export interface RenderSingleLineVoiceResult {
  audioPath: string;
  durationMs: number;
}

export interface RegenerateSceneAssetPayload {
  sceneId: string;
  visualPrompt: string;
  flowConfig: AiStudioFlowEngineConfig;
}

export interface RegenerateSceneAssetResult {
  assetPath: string;
}

export interface RenderVideoPayload {
  sessionId: string;
  customSettings?: Partial<AiStudioRenderingConfig & AiStudioSubtitleConfig>;
}

export interface RenderVideoResult {
  videoPath: string;
}
```

### 2.2. Renderer Process Types (`renderer/types/aiStudio.ts`)
Mirrors the interfaces above so that renderer-side stores (`renderer/lib/store/aiStudioStore.ts`) and React components have complete client-side typings without crossing node/electron process boundaries.

---

## 3. Dedicated IPC Router: `main/ai-studio/ipc.ts`

### 3.1. File Location
`d:\DEAN\DEAN\VANHSUB\main\ai-studio\ipc.ts`

### 3.2. Complete Source Code Blueprint

```typescript
/**
 * AI Video Studio - IPC Communication Router
 *
 * Encapsulates all Electron IPC handlers for the AI Video Studio subsystem:
 * - Milestone 1: Configuration management (get, set, reset) via aiStudioStore
 * - Milestone 2: Pipeline execution & granular step operations via Engine Delegate
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { getAiStudioStore } from '../store/aiStudioStore';
import type {
  AiStudioConfig,
  PipelineSessionState,
  PipelineProgressEvent,
  StartPipelinePayload,
  StartPipelineResult,
  ResumePipelinePayload,
  ResumePipelineResult,
  CancelPipelinePayload,
  CancelPipelineResult,
  GetPipelineStatePayload,
  RenderSingleLineVoicePayload,
  RenderSingleLineVoiceResult,
  RegenerateSceneAssetPayload,
  RegenerateSceneAssetResult,
  RenderVideoPayload,
  RenderVideoResult,
} from './types';

// ============================================================================
// Milestone 2 Engine Delegate Contract
// ============================================================================

export interface IAiStudioPipelineEngineDelegate {
  start(
    payload: StartPipelinePayload,
    onProgress: (event: PipelineProgressEvent) => void
  ): Promise<StartPipelineResult>;

  resume(
    payload: ResumePipelinePayload,
    onProgress: (event: PipelineProgressEvent) => void
  ): Promise<ResumePipelineResult>;

  cancel(payload: CancelPipelinePayload): Promise<CancelPipelineResult>;

  getState(payload: GetPipelineStatePayload): Promise<PipelineSessionState | null>;

  renderSingleLineVoice(
    payload: RenderSingleLineVoicePayload
  ): Promise<RenderSingleLineVoiceResult>;

  regenerateSceneAsset(
    payload: RegenerateSceneAssetPayload
  ): Promise<RegenerateSceneAssetResult>;

  renderVideo(payload: RenderVideoPayload): Promise<RenderVideoResult>;
}

let pipelineEngineDelegate: IAiStudioPipelineEngineDelegate | null = null;

/**
 * Registers the Milestone 2 Pipeline Engine delegate.
 * In Milestone 2, AiStudioPipelineEngine attaches here without modifying this router.
 */
export function setAiStudioPipelineEngine(
  delegate: IAiStudioPipelineEngineDelegate | null
): void {
  pipelineEngineDelegate = delegate;
}

/**
 * Returns the currently active delegate (useful for tests or diagnostics).
 */
export function getAiStudioPipelineEngine(): IAiStudioPipelineEngineDelegate | null {
  return pipelineEngineDelegate;
}

// ============================================================================
// Safe IPC Registration Helper
// ============================================================================

/**
 * Safely registers an IPC invoke handler by unregistering any existing handler
 * for the same channel. Prevents "Attempted to register a second handler" errors.
 */
function safeHandle(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => any
): void {
  try {
    ipcMain.removeHandler(channel);
  } catch {
    // Ignore error if channel was not previously registered
  }
  ipcMain.handle(channel, handler);
}

// ============================================================================
// IPC Handler Registration Entry Point
// ============================================================================

export function registerAiStudioIpc(): void {
  // --------------------------------------------------------------------------
  // Milestone 1 Channels: Dedicated Configuration Store
  // --------------------------------------------------------------------------

  /**
   * Channel: aiStudio:config:get
   * Retrieves the current AI Studio configuration.
   */
  safeHandle('aiStudio:config:get', async (): Promise<AiStudioConfig> => {
    try {
      const store = getAiStudioStore();
      return store.getAiStudioConfig();
    } catch (err: any) {
      console.error('[AI-Studio-IPC] Error fetching configuration:', err);
      throw new Error(`Failed to retrieve AI Studio config: ${err?.message || err}`);
    }
  });

  /**
   * Channel: aiStudio:config:set
   * Updates partial AI Studio configuration and returns the merged result.
   */
  safeHandle(
    'aiStudio:config:set',
    async (_event, updates: Partial<AiStudioConfig>): Promise<AiStudioConfig> => {
      try {
        if (!updates || typeof updates !== 'object') {
          throw new Error('Invalid config updates payload: expected an object');
        }
        const store = getAiStudioStore();
        return store.updateAiStudioConfig(updates);
      } catch (err: any) {
        console.error('[AI-Studio-IPC] Error updating configuration:', err);
        throw new Error(`Failed to update AI Studio config: ${err?.message || err}`);
      }
    }
  );

  /**
   * Channel: aiStudio:config:reset
   * Resets configuration back to technical specification default values.
   */
  safeHandle('aiStudio:config:reset', async (): Promise<AiStudioConfig> => {
    try {
      const store = getAiStudioStore();
      return store.resetAiStudioConfig();
    } catch (err: any) {
      console.error('[AI-Studio-IPC] Error resetting configuration:', err);
      throw new Error(`Failed to reset AI Studio config: ${err?.message || err}`);
    }
  });

  // --------------------------------------------------------------------------
  // Milestone 2 Channels: Pipeline Control & Granular Step Operations
  // --------------------------------------------------------------------------

  /**
   * Channel: aiStudio:pipeline:start
   * Starts a new automated 8-stage video generation pipeline.
   */
  safeHandle(
    'aiStudio:pipeline:start',
    async (event, payload: StartPipelinePayload): Promise<StartPipelineResult> => {
      if (pipelineEngineDelegate?.start) {
        return pipelineEngineDelegate.start(payload, (progressEvent: PipelineProgressEvent) => {
          try {
            if (!event.sender.isDestroyed()) {
              event.sender.send('aiStudio:pipeline:progress', progressEvent);
            }
          } catch (emitErr) {
            console.error('[AI-Studio-IPC] Failed to emit pipeline progress event:', emitErr);
          }
        });
      }
      throw new Error(
        '[M2-STUB] aiStudio:pipeline:start is scheduled for Milestone 2 (Pipeline Engine).'
      );
    }
  );

  /**
   * Channel: aiStudio:pipeline:resume
   * Resumes a paused/failed pipeline from a specific checkpoint stage.
   */
  safeHandle(
    'aiStudio:pipeline:resume',
    async (event, payload: ResumePipelinePayload): Promise<ResumePipelineResult> => {
      if (pipelineEngineDelegate?.resume) {
        return pipelineEngineDelegate.resume(payload, (progressEvent: PipelineProgressEvent) => {
          try {
            if (!event.sender.isDestroyed()) {
              event.sender.send('aiStudio:pipeline:progress', progressEvent);
            }
          } catch (emitErr) {
            console.error('[AI-Studio-IPC] Failed to emit pipeline progress event:', emitErr);
          }
        });
      }
      throw new Error(
        '[M2-STUB] aiStudio:pipeline:resume is scheduled for Milestone 2 (Pipeline Engine).'
      );
    }
  );

  /**
   * Channel: aiStudio:pipeline:cancel
   * Cancels a currently executing pipeline session.
   */
  safeHandle(
    'aiStudio:pipeline:cancel',
    async (_event, payload: CancelPipelinePayload): Promise<CancelPipelineResult> => {
      if (pipelineEngineDelegate?.cancel) {
        return pipelineEngineDelegate.cancel(payload);
      }
      throw new Error(
        '[M2-STUB] aiStudio:pipeline:cancel is scheduled for Milestone 2 (Pipeline Engine).'
      );
    }
  );

  /**
   * Channel: aiStudio:pipeline:getState
   * Retrieves the persisted state of a pipeline session.
   */
  safeHandle(
    'aiStudio:pipeline:getState',
    async (_event, payload: GetPipelineStatePayload): Promise<PipelineSessionState | null> => {
      if (pipelineEngineDelegate?.getState) {
        return pipelineEngineDelegate.getState(payload);
      }
      return null;
    }
  );

  /**
   * Channel: aiStudio:step:renderSingleLineVoice
   * Synthesizes audio for a single dialogue line via Edge TTS.
   */
  safeHandle(
    'aiStudio:step:renderSingleLineVoice',
    async (
      _event,
      payload: RenderSingleLineVoicePayload
    ): Promise<RenderSingleLineVoiceResult> => {
      if (pipelineEngineDelegate?.renderSingleLineVoice) {
        return pipelineEngineDelegate.renderSingleLineVoice(payload);
      }
      throw new Error(
        '[M2-STUB] aiStudio:step:renderSingleLineVoice is scheduled for Milestone 2 (TTS Service).'
      );
    }
  );

  /**
   * Channel: aiStudio:step:regenerateSceneAsset
   * Regenerates a single visual asset via Google Flow Engine (or synthetic fallback).
   */
  safeHandle(
    'aiStudio:step:regenerateSceneAsset',
    async (
      _event,
      payload: RegenerateSceneAssetPayload
    ): Promise<RegenerateSceneAssetResult> => {
      if (pipelineEngineDelegate?.regenerateSceneAsset) {
        return pipelineEngineDelegate.regenerateSceneAsset(payload);
      }
      throw new Error(
        '[M2-STUB] aiStudio:step:regenerateSceneAsset is scheduled for Milestone 2 (Visual Service).'
      );
    }
  );

  /**
   * Channel: aiStudio:step:renderVideo
   * Triggers FFmpeg video assembly for a session.
   */
  safeHandle(
    'aiStudio:step:renderVideo',
    async (_event, payload: RenderVideoPayload): Promise<RenderVideoResult> => {
      if (pipelineEngineDelegate?.renderVideo) {
        return pipelineEngineDelegate.renderVideo(payload);
      }
      throw new Error(
        '[M2-STUB] aiStudio:step:renderVideo is scheduled for Milestone 2 (Video Assembler).'
      );
    }
  );

  console.log('[AI Studio] Registered 10 IPC channels successfully.');
}
```

---

## 4. Main Process Integration: `main/main.ts`

### 4.1. File Location
`d:\DEAN\DEAN\VANHSUB\main\main.ts`

### 4.2. Exact Insertion Points

#### Insertion Point A: Top Import (Lines 28-29)
Existing code:
```typescript
27: import { TikTokTTSError } from './tts-providers/tiktok/types'
28: import { registerWorkflowIpc } from './workflow/ipc'
29: import { GoogleVeoSessionManager } from './veo/GoogleVeoSessionManager'
```
Target modification:
```typescript
import { TikTokTTSError } from './tts-providers/tiktok/types'
import { registerWorkflowIpc } from './workflow/ipc'
import { registerAiStudioIpc } from './ai-studio/ipc'
import { GoogleVeoSessionManager } from './veo/GoogleVeoSessionManager'
```

#### Insertion Point B: IPC Initialization (Lines 228-235)
Existing code:
```typescript
228: // =========================================================================
229: // WORKFLOW MODE IPC HANDLERS
230: // =========================================================================
231: registerWorkflowIpc()
232: 
233: // =========================================================================
234: // TASK MANAGEMENT IPC HANDLERS
235: // =========================================================================
```
Target modification:
```typescript
// =========================================================================
// WORKFLOW MODE IPC HANDLERS
// =========================================================================
registerWorkflowIpc()

// =========================================================================
// AI VIDEO STUDIO IPC HANDLERS
// =========================================================================
registerAiStudioIpc()

// =========================================================================
// TASK MANAGEMENT IPC HANDLERS
// =========================================================================
```

### 4.3. Non-Interference Guarantee
- `registerAiStudioIpc()` is registered alongside `registerWorkflowIpc()` at top-level module execution time.
- All existing handlers (`tasks:*`, `downloader:*`, `settings:*`, `ai:*`, `workflow:*`, `bible:*`, etc.) remain 100% untouched.

---

## 5. Preload Bridge Extension: `main/preload.ts`

### 5.1. File Location
`d:\DEAN\DEAN\VANHSUB\main\preload.ts`

### 5.2. Exact Insertion Point
Inside `const vanhsub = { ... }`, immediately following `bible: { ... },` on lines 170-177.

#### Before (Lines 170-179):
```typescript
170:   bible: {
171:     getCharacters: () => ipcRenderer.invoke('bible:getCharacters'),
172:     saveCharacter: (profile: any) => ipcRenderer.invoke('bible:saveCharacter', profile),
173:     deleteCharacter: (id: string) => ipcRenderer.invoke('bible:deleteCharacter', id),
174:     getScenes: () => ipcRenderer.invoke('bible:getScenes'),
175:     saveScene: (profile: any) => ipcRenderer.invoke('bible:saveScene', profile),
176:     deleteScene: (id: string) => ipcRenderer.invoke('bible:deleteScene', id),
177:   },
178: }
179: 
```

#### After:
```typescript
  bible: {
    getCharacters: () => ipcRenderer.invoke('bible:getCharacters'),
    saveCharacter: (profile: any) => ipcRenderer.invoke('bible:saveCharacter', profile),
    deleteCharacter: (id: string) => ipcRenderer.invoke('bible:deleteCharacter', id),
    getScenes: () => ipcRenderer.invoke('bible:getScenes'),
    saveScene: (profile: any) => ipcRenderer.invoke('bible:saveScene', profile),
    deleteScene: (id: string) => ipcRenderer.invoke('bible:deleteScene', id),
  },
  aiStudio: {
    // Configuration (Milestone 1)
    getConfig: () => ipcRenderer.invoke('aiStudio:config:get'),
    updateConfig: (updates: any) => ipcRenderer.invoke('aiStudio:config:set', updates),
    resetConfig: () => ipcRenderer.invoke('aiStudio:config:reset'),

    // Configuration Aliases
    get: () => ipcRenderer.invoke('aiStudio:config:get'),
    set: (updates: any) => ipcRenderer.invoke('aiStudio:config:set', updates),
    reset: () => ipcRenderer.invoke('aiStudio:config:reset'),

    // Pipeline Execution (Milestone 2)
    startPipeline: (payload: { topic: string; options?: any }) =>
      ipcRenderer.invoke('aiStudio:pipeline:start', payload),
    resumePipeline: (payload: { sessionId: string; fromStage?: number }) =>
      ipcRenderer.invoke('aiStudio:pipeline:resume', payload),
    cancelPipeline: (payload: { sessionId: string }) =>
      ipcRenderer.invoke('aiStudio:pipeline:cancel', payload),
    getPipelineState: (payload: { sessionId: string }) =>
      ipcRenderer.invoke('aiStudio:pipeline:getState', payload),

    // Granular Step Operations (Milestone 2)
    renderSingleLineVoice: (payload: { lineIndex: number; text: string; voiceConfig: any }) =>
      ipcRenderer.invoke('aiStudio:step:renderSingleLineVoice', payload),
    regenerateSceneAsset: (payload: { sceneId: string; visualPrompt: string; flowConfig: any }) =>
      ipcRenderer.invoke('aiStudio:step:regenerateSceneAsset', payload),
    renderVideo: (payload: { sessionId: string; customSettings?: any }) =>
      ipcRenderer.invoke('aiStudio:step:renderVideo', payload),

    // Push Event Subscription (Returns unsubscribe function)
    onPipelineProgress: (callback: (event: any) => void) => {
      const subscription = (_event: any, data: any) => callback(data);
      ipcRenderer.on('aiStudio:pipeline:progress', subscription);
      return () => {
        ipcRenderer.removeListener('aiStudio:pipeline:progress', subscription);
      };
    },
  },
}
```

### 5.3. Design Highlights
- Follows the lightweight preload convention of `preload.ts` (using `any` parameter signatures to prevent bundler/sandbox module resolution conflicts).
- Unsubscribe function is returned by `onPipelineProgress`, following the exact pattern of `tasks.onUpdate` and `logs.onLog`.

---

## 6. Renderer Interface Typings: `renderer/types/electron.d.ts`

### 6.1. File Location
`d:\DEAN\DEAN\VANHSUB\renderer\types\electron.d.ts`

### 6.2. Exact Insertion Points

#### Insertion Point A: Top Import (Lines 1-2)
Existing code:
```typescript
1: import type { Task, CreateTaskInput } from './task';
2: 
```
Target modification:
```typescript
import type { Task, CreateTaskInput } from './task';
import type {
  AiStudioConfig,
  AiStudioVoiceConfig,
  AiStudioFlowEngineConfig,
  AiStudioRenderingConfig,
  AiStudioSubtitleConfig,
  PipelineSessionState,
  PipelineProgressEvent,
} from './aiStudio';
```

#### Insertion Point B: `VanhsubAPI` Interface Extension (Lines 374-383)
Existing code:
```typescript
374:   bible: {
375:     getCharacters: () => Promise<any[]>;
376:     saveCharacter: (profile: any) => Promise<any>;
377:     deleteCharacter: (id: string) => Promise<boolean>;
378:     getScenes: () => Promise<any[]>;
379:     saveScene: (profile: any) => Promise<any>;
380:     deleteScene: (id: string) => Promise<boolean>;
381:   };
382: }
383: 
```
Target modification:
```typescript
  bible: {
    getCharacters: () => Promise<any[]>;
    saveCharacter: (profile: any) => Promise<any>;
    deleteCharacter: (id: string) => Promise<boolean>;
    getScenes: () => Promise<any[]>;
    saveScene: (profile: any) => Promise<any>;
    deleteScene: (id: string) => Promise<boolean>;
  };
  aiStudio: {
    // Configuration (Milestone 1)
    getConfig: () => Promise<AiStudioConfig>;
    updateConfig: (updates: Partial<AiStudioConfig>) => Promise<AiStudioConfig>;
    resetConfig: () => Promise<AiStudioConfig>;

    // Configuration Aliases
    get: () => Promise<AiStudioConfig>;
    set: (updates: Partial<AiStudioConfig>) => Promise<AiStudioConfig>;
    reset: () => Promise<AiStudioConfig>;

    // Pipeline Execution (Milestone 2)
    startPipeline: (payload: { topic: string; options?: Partial<AiStudioConfig> }) => Promise<{ sessionId: string }>;
    resumePipeline: (payload: { sessionId: string; fromStage?: number }) => Promise<{ success: boolean }>;
    cancelPipeline: (payload: { sessionId: string }) => Promise<{ success: boolean }>;
    getPipelineState: (payload: { sessionId: string }) => Promise<PipelineSessionState | null>;

    // Granular Step Operations (Milestone 2)
    renderSingleLineVoice: (payload: {
      lineIndex: number;
      text: string;
      voiceConfig: AiStudioVoiceConfig;
    }) => Promise<{ audioPath: string; durationMs: number }>;
    regenerateSceneAsset: (payload: {
      sceneId: string;
      visualPrompt: string;
      flowConfig: AiStudioFlowEngineConfig;
    }) => Promise<{ assetPath: string }>;
    renderVideo: (payload: {
      sessionId: string;
      customSettings?: Partial<AiStudioRenderingConfig & AiStudioSubtitleConfig>;
    }) => Promise<{ videoPath: string }>;

    // Push Event Subscription
    onPipelineProgress: (callback: (event: PipelineProgressEvent) => void) => () => void;
  };
}
```

---

## 7. Contract Harmonization Matrix

| Main IPC Channel | Preload Method | `electron.d.ts` Signature | Milestone | Implementation Status |
| :--- | :--- | :--- | :--- | :--- |
| `aiStudio:config:get` | `getConfig()` / `get()` | `() => Promise<AiStudioConfig>` | M1 | Calls `getAiStudioStore().getAiStudioConfig()` |
| `aiStudio:config:set` | `updateConfig(p)` / `set(p)` | `(p: Partial<AiStudioConfig>) => Promise<AiStudioConfig>` | M1 | Calls `getAiStudioStore().updateAiStudioConfig(p)` |
| `aiStudio:config:reset` | `resetConfig()` / `reset()` | `() => Promise<AiStudioConfig>` | M1 | Calls `getAiStudioStore().resetAiStudioConfig()` |
| `aiStudio:pipeline:start` | `startPipeline(p)` | `(p: { topic, options? }) => Promise<{ sessionId }>` | M2 | M1 Stub (`[M2-STUB]` throw) / Delegate ready |
| `aiStudio:pipeline:resume` | `resumePipeline(p)` | `(p: { sessionId, fromStage? }) => Promise<{ success }>` | M2 | M1 Stub (`[M2-STUB]` throw) / Delegate ready |
| `aiStudio:pipeline:cancel` | `cancelPipeline(p)` | `(p: { sessionId }) => Promise<{ success }>` | M2 | M1 Stub (`[M2-STUB]` throw) / Delegate ready |
| `aiStudio:pipeline:getState` | `getPipelineState(p)` | `(p: { sessionId }) => Promise<PipelineSessionState \| null>` | M2 | M1 Stub (returns `null`) / Delegate ready |
| `aiStudio:step:renderSingleLineVoice` | `renderSingleLineVoice(p)` | `(p: { lineIndex, text, voiceConfig }) => Promise<{ audioPath, durationMs }>` | M2 | M1 Stub (`[M2-STUB]` throw) / Delegate ready |
| `aiStudio:step:regenerateSceneAsset` | `regenerateSceneAsset(p)` | `(p: { sceneId, visualPrompt, flowConfig }) => Promise<{ assetPath }>` | M2 | M1 Stub (`[M2-STUB]` throw) / Delegate ready |
| `aiStudio:step:renderVideo` | `renderVideo(p)` | `(p: { sessionId, customSettings? }) => Promise<{ videoPath }>` | M2 | M1 Stub (`[M2-STUB]` throw) / Delegate ready |
| `aiStudio:pipeline:progress` (event) | `onPipelineProgress(cb)` | `(cb: (e: PipelineProgressEvent) => void) => () => void` | M2 | Pushed to `event.sender` during pipeline runs |

---

## 8. Verification & Test Strategy

### 8.1. TypeScript Compiler Verification
Run:
```powershell
npx tsc --noEmit
```
**Criteria**: 0 errors across `main/**/*.ts` and `renderer/**/*.ts`.

### 8.2. Headless Unit Test Simulation
A test script can directly invoke registered IPC handlers in a headless Node environment:
```typescript
import { ipcMain } from 'electron';
import { registerAiStudioIpc, setAiStudioPipelineEngine } from '../main/ai-studio/ipc';
import { getAiStudioStore } from '../main/store/aiStudioStore';

// 1. Register IPC handlers
registerAiStudioIpc();

// 2. Test config:get
const config = await (ipcMain as any)._invoke('aiStudio:config:get');
console.assert(config.llm.provider === 'deepseek', 'Default LLM provider must be deepseek');

// 3. Test config:set
const updated = await (ipcMain as any)._invoke('aiStudio:config:set', {}, { rendering: { resolution: '720p' } });
console.assert(updated.rendering.resolution === '720p', 'Resolution must update to 720p');

// 4. Test config:reset
const reset = await (ipcMain as any)._invoke('aiStudio:config:reset');
console.assert(reset.rendering.resolution === '1080p', 'Resolution must reset to 1080p');

// 5. Test M2 stub safety
try {
  await (ipcMain as any)._invoke('aiStudio:pipeline:start', {}, { topic: 'test' });
  console.assert(false, 'Should throw M2-STUB error');
} catch (err: any) {
  console.assert(err.message.includes('[M2-STUB]'), 'Must throw descriptive stub error');
}
```
