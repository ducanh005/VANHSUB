# Milestone 1 Store & Types: Detailed Implementation Blueprint

**Document Version:** 1.0.0  
**Author:** Main Store Explorer (Milestone 1)  
**Assigned Directory:** `d:\DEAN\DEAN\VANHSUB\.agents\explorer_m1_store\`  
**Target Files:**
1. `main/ai-studio/types.ts`
2. `main/store/aiStudioStore.ts`

---

## 1. Executive Summary & Architectural Overview

Milestone 1 establishes the foundational data structures and persistence layer for the **Vanhsub AI Video Studio** subsystem. As mandated by `AI_STUDIO_SPEC.md` and `PROJECT.md`, the AI Studio requires a completely autonomous, dedicated configuration and storage engine that operates in isolation from the core Vanhsub subtitle and dubbing settings.

### Core Architectural Guarantees:
1. **Physical & Logical Isolation**:
   - Dedicated JSON file: `vanhsub-ai-studio.json` (vs `vanhsub-settings.json` for general settings).
   - Dedicated environment variable override: `process.env.VANHSUB_AI_STUDIO_DIR` (vs `VANHSUB_SETTINGS_DIR`).
   - Zero modifications, zero shared keys, and zero cross-contamination with `main/store/settingsStore.ts`.
2. **DPAPI Hardware Security**:
   - `llm.apiKey` is encrypted using Electron's `safeStorage` (Windows DPAPI) with prefix `enc:v1:`.
   - Built-in headless/test runtime fallback that gracefully handles non-Electron execution (Node.js/`tsx`) without throwing errors.
3. **Lazy-Singleton Initialization**:
   - `getAiStudioStore()` initializes only upon first method invocation, preventing Electron lifecycle errors (`"Please specify the projectName option"`) during early application startup or headless test execution.
4. **Headless & Test Resilience**:
   - Automatic directory fallback: `process.env.VANHSUB_AI_STUDIO_DIR || path.join(os.tmpdir(), 'vanhsub-ai-studio')`.
   - Allows CI/CD, standalone test scripts (such as `scripts/test_ai_studio_pipeline.ts`), and CLI diagnostics to execute without a full Electron GUI instance.

---

## 2. File Blueprint 1: `main/ai-studio/types.ts`

### 2.1 Design Rationale & Standards
This file acts as the single source of truth for the entire AI Studio subsystem across both the Main process and Renderer process. It implements:
- Complete TypeScript interfaces for all 5 configuration sections specified in `AI_STUDIO_SPEC.md` §5.1:
  1. `llm` (LLM Provider, API Key, Model, Base URL, Temperature, System Prompt Presets)
  2. `voice` (Edge TTS Provider, Voice ID, Rate, Pitch, Volume, Word-boundary alignment)
  3. `flowEngine` (Aspect Ratio, Output Mode, Style Prompt Prefix, Negative Prompt, Concurrency)
  4. `rendering` (Resolution, FPS, Ken Burns effect, Zoom Scale, Transition Duration, BGM Volume, Audio Ducking)
  5. `subtitles` (Preset, Font Size, Primary Color, Outline Color, Outline Width, Vertical Position)
- Complete constant defaults matching `AI_STUDIO_SPEC.md` §5.2 verbatim.
- Preset definition constants (Vietnamese voice catalogs, system prompt templates, subtitle styles) for clean UI population.
- Pipeline execution & checkpoint types (Script beats, Word timestamps, Storyboard scenes, Pipeline session state) to ensure immediate compatibility with Milestone 2 and Milestone 3.

### 2.2 Verbatim Code Blueprint: `main/ai-studio/types.ts`

```typescript
/**
 * Vanhsub AI Video Studio - Core TypeScript Schemas & Defaults
 * Conforms to AI_STUDIO_SPEC.md §5.1 & §5.2 and PROJECT.md
 */

// ============================================================================
// 1. Configuration Schemas (§5.1)
// ============================================================================

export type LlmProvider = 'deepseek' | 'openai' | 'custom';

export interface AiStudioLlmConfig {
  /** Nhà cung cấp mô hình ngôn ngữ lớn: 'deepseek' | 'openai' | 'custom' */
  provider: LlmProvider;
  /** API Key (được mã hóa DPAPI khi lưu trữ trên đĩa, tiền tố 'enc:v1:') */
  apiKey: string;
  /** Tên model định danh (vd: 'deepseek-chat', 'gpt-4o') */
  model: string;
  /** Base URL tùy chỉnh endpoint hoặc proxy (tùy chọn) */
  baseUrl?: string;
  /** Độ sáng tạo: 0.0 - 1.0 (mặc định 0.6) */
  temperature: number;
  /** Preset kịch bản: 'youtube_story' | 'tiktok_short' | 'affiliate_sales' | string */
  systemPromptPreset: string;
}

export type TtsVoiceProvider = 'edge_tts' | 'local_onnx';

export interface AiStudioVoiceConfig {
  /** Nhà cung cấp giọng đọc: 'edge_tts' | 'local_onnx' */
  provider: TtsVoiceProvider;
  /** ID giọng đọc Edge TTS (vd: 'vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural') */
  voiceId: string;
  /** Tốc độ đọc (vd: '-5%', '+0%', '+10%') */
  rate: string;
  /** Cao độ giọng (vd: '-2Hz', '+0Hz', '+2Hz') */
  pitch: string;
  /** Âm lượng giọng đọc (vd: '+0%') */
  volume: string;
  /** Tự động trích xuất timestamp từng từ qua metadata WordBoundary */
  autoWordAlignment: boolean;
}

export type FlowAspectRatio = '16:9' | '9:16' | '1:1';
export type FlowOutputMode = 'image' | 'video';

export interface AiStudioFlowEngineConfig {
  /** Tỷ lệ khung hình tạo ảnh/video: '16:9' | '9:16' | '1:1' */
  aspectRatio: FlowAspectRatio;
  /** Chế độ đầu ra từ Google Flow: 'image' (ảnh tĩnh) | 'video' (clip chuyển động) */
  outputMode: FlowOutputMode;
  /** Tiền tố phong cách hình ảnh (bổ sung vào prompt tiếng Anh) */
  stylePromptPrefix: string;
  /** Negative prompt loại bỏ chi tiết thừa */
  negativePrompt: string;
  /** Số biến thể ảnh sinh ra cho mỗi phân cảnh (1, 2, hoặc 4) */
  outputsPerScene: 1 | 2 | 4;
  /** Thư mục tải về lưu trữ assets sinh ra (rỗng = tự động theo thư mục dự án) */
  downloadDir: string;
  /** Số task sinh đồng thời (khuyến nghị 1) */
  concurrency: number;
}

export type RenderingResolution = '1080p' | '720p' | '4k';
export type RenderingFps = 30 | 60;

export interface AiStudioRenderingConfig {
  /** Độ phân giải video xuất xưởng: '1080p' | '720p' | '4k' */
  resolution: RenderingResolution;
  /** Tốc độ khung hình (FPS): 30 | 60 */
  fps: RenderingFps;
  /** Bật/tắt hiệu ứng chuyển động Ken Burns (Zoom/Pan ảnh tĩnh) */
  kenBurnsEffect: boolean;
  /** Tỷ lệ phóng to khi thực hiện Ken Burns (vd: 1.15) */
  kenBurnsScale: number;
  /** Thời gian chuyển cảnh giữa các phân cảnh (giây, vd: 0.5) */
  transitionDuration: number;
  /** Đường dẫn file nhạc nền mặc định (tùy chọn) */
  defaultBgmPath?: string;
  /** Âm lượng nhạc nền (0.05 - 0.20) */
  bgmVolume: number;
  /** Tự động hạ âm lượng nhạc nền khi có tiếng nói (Audio Ducking) */
  autoAudioDucking: boolean;
}

export type SubtitlePreset = 'tiktok_bold' | 'minimalist' | 'classic_bar' | 'karaoke_glow';

export interface AiStudioSubtitleConfig {
  /** Bật/tắt phụ đề gắn liền video (hardsub/burn-in) */
  enabled: boolean;
  /** Preset kiểu hiển thị phụ đề */
  preset: SubtitlePreset;
  /** Cỡ chữ phụ đề */
  fontSize: number;
  /** Mã màu chữ chính (Hex, vd: '#FFFFFF') */
  primaryColor: string;
  /** Mã màu viền chữ (Hex, vd: '#000000') */
  outlineColor: string;
  /** Độ dày viền chữ (pixels, vd: 3) */
  outlineWidth: number;
  /** Vị trí theo % chiều cao màn hình tính từ trên xuống (vd: 80) */
  positionY: number;
}

export interface AiStudioConfig {
  /** 1. LLM Settings (Kịch bản & Phân tích) */
  llm: AiStudioLlmConfig;
  /** 2. TTS & Voice Settings (Giọng đọc & Lồng tiếng) */
  voice: AiStudioVoiceConfig;
  /** 3. Google Flow Engine Settings (Sinh Ảnh & Video) */
  flowEngine: AiStudioFlowEngineConfig;
  /** 4. Video Assembly & Rendering (Dựng phim FFmpeg) */
  rendering: AiStudioRenderingConfig;
  /** 5. Subtitle Styling (Đặc tính phụ đề gắn liền video) */
  subtitles: AiStudioSubtitleConfig;
}

/** Deep partial type for safe partial updates */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? T[P]
    : T[P] extends ReadonlyArray<infer U>
    ? T[P]
    : T[P] extends object
    ? DeepPartial<T[P]>
    : T[P];
};

export type PartialAiStudioConfig = DeepPartial<AiStudioConfig>;

// ============================================================================
// 2. Default Constants Matching AI_STUDIO_SPEC.md §5.2
// ============================================================================

export const DEFAULT_LLM_CONFIG: Readonly<AiStudioLlmConfig> = Object.freeze({
  provider: 'deepseek',
  apiKey: '',
  model: 'deepseek-chat',
  baseUrl: '',
  temperature: 0.6,
  systemPromptPreset: 'youtube_story',
});

export const DEFAULT_VOICE_CONFIG: Readonly<AiStudioVoiceConfig> = Object.freeze({
  provider: 'edge_tts',
  voiceId: 'vi-VN-HoaiMyNeural',
  rate: '+0%',
  pitch: '+0Hz',
  volume: '+0%',
  autoWordAlignment: true,
});

export const DEFAULT_FLOW_ENGINE_CONFIG: Readonly<AiStudioFlowEngineConfig> = Object.freeze({
  aspectRatio: '16:9',
  outputMode: 'image',
  stylePromptPrefix: 'Cinematic lighting, high resolution, detailed photorealistic, 4k',
  negativePrompt: 'watermark, text, blurry, distortion, lowres',
  outputsPerScene: 1,
  downloadDir: '',
  concurrency: 1,
});

export const DEFAULT_RENDERING_CONFIG: Readonly<AiStudioRenderingConfig> = Object.freeze({
  resolution: '1080p',
  fps: 30,
  kenBurnsEffect: true,
  kenBurnsScale: 1.15,
  transitionDuration: 0.5,
  defaultBgmPath: '',
  bgmVolume: 0.12,
  autoAudioDucking: true,
});

export const DEFAULT_SUBTITLE_CONFIG: Readonly<AiStudioSubtitleConfig> = Object.freeze({
  enabled: true,
  preset: 'tiktok_bold',
  fontSize: 24,
  primaryColor: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidth: 3,
  positionY: 80,
});

export const DEFAULT_AI_STUDIO_CONFIG: Readonly<AiStudioConfig> = Object.freeze({
  llm: DEFAULT_LLM_CONFIG,
  voice: DEFAULT_VOICE_CONFIG,
  flowEngine: DEFAULT_FLOW_ENGINE_CONFIG,
  rendering: DEFAULT_RENDERING_CONFIG,
  subtitles: DEFAULT_SUBTITLE_CONFIG,
});

// ============================================================================
// 3. UI Catalog & Preset Metadata
// ============================================================================

export interface SystemPromptPresetOption {
  id: string;
  name: string;
  description: string;
}

export const SYSTEM_PROMPT_PRESETS: ReadonlyArray<SystemPromptPresetOption> = Object.freeze([
  {
    id: 'youtube_story',
    name: 'Kể chuyện / Review phim (YouTube)',
    description: 'Phong cách dẫn dắt lôi cuốn, mở đầu kịch tính, nhịp điệu vừa phải',
  },
  {
    id: 'tiktok_short',
    name: 'Viral Short / TikTok',
    description: 'Tiết tấu dồn dập, giật hook ngay 3 giây đầu, giữ chân người xem cao',
  },
  {
    id: 'affiliate_sales',
    name: 'Bán hàng / Review sản phẩm',
    description: 'Tập trung vào nỗi đau khách hàng, nêu giải pháp và kêu gọi hành động (CTA)',
  },
  {
    id: 'explainer_edu',
    name: 'Kiến thức / Phổ biến khoa học',
    description: 'Rõ ràng, ngắn gọn, dùng các phép so sánh hình ảnh dễ liên tưởng',
  },
]);

export interface EdgeTtsVoiceOption {
  id: string;
  name: string;
  gender: 'female' | 'male';
  locale: string;
  description: string;
}

export const EDGE_TTS_VOICES: ReadonlyArray<EdgeTtsVoiceOption> = Object.freeze([
  {
    id: 'vi-VN-HoaiMyNeural',
    name: 'Hoài My (Nữ)',
    gender: 'female',
    locale: 'vi-VN',
    description: 'Giọng nữ chuẩn Hà Nội, tự nhiên, truyền cảm, phù hợp kể chuyện và tin tức',
  },
  {
    id: 'vi-VN-NamMinhNeural',
    name: 'Nam Minh (Nam)',
    gender: 'male',
    locale: 'vi-VN',
    description: 'Giọng nam trầm ấm, đĩnh đạc, phù hợp review phim và tài liệu',
  },
]);

// ============================================================================
// 4. Pipeline Engine & Checkpoint State Types (M2/M3 Contract)
// ============================================================================

export type AiStudioStageId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type AiStudioStageName =
  | 'source'
  | 'script'
  | 'voice'
  | 'alignment'
  | 'storyboard'
  | 'visuals'
  | 'render'
  | 'metadata';

export type AiStudioStageStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface ScriptBeatLine {
  id: string;
  index: number;
  speaker?: string;
  text: string;
  startMs?: number;
  endMs?: number;
  durationMs?: number;
  audioPath?: string;
  visualPromptEn?: string;
  assetPath?: string;
  assetType?: 'image' | 'video';
}

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

export interface StoryboardScene {
  id: string;
  lineIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  lineText: string;
  visualPrompt: string;
  negativePrompt?: string;
  motionType: 'ken_burns' | 'video';
  assetPath?: string;
  status: 'pending' | 'generating' | 'ready' | 'error';
  error?: string;
}

export interface PipelineSessionState {
  sessionId: string;
  topic: string;
  currentStage: AiStudioStageId;
  stageName: AiStudioStageName;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0 - 100
  stages: Record<
    number,
    {
      status: AiStudioStageStatus;
      stageName: string;
      startedAt?: number;
      completedAt?: number;
      error?: string;
    }
  >;
  artifacts: {
    ideaSummary?: string;
    scriptLines?: ScriptBeatLine[];
    audioPath?: string;
    srtPath?: string;
    wordsAlignment?: WordTimestamp[];
    scenes?: StoryboardScene[];
    videoPath?: string;
    metadata?: {
      title: string;
      description: string;
      hashtags: string[];
      thumbnailPrompt?: string;
    };
  };
  createdAt: number;
  updatedAt: number;
}

export interface PipelineProgressPayload {
  sessionId: string;
  stage: number;
  stageName: string;
  progress: number;
  status: AiStudioStageStatus;
  message?: string;
  error?: string;
  artifacts?: Partial<PipelineSessionState['artifacts']>;
}
```

---

## 3. File Blueprint 2: `main/store/aiStudioStore.ts`

### 3.1 Design Rationale & Standards
1. **Isolated Data Persistence**:
   Uses `Store<AiStudioConfig>` configured with `name: 'vanhsub-ai-studio'`, writing to `vanhsub-ai-studio.json`.
   This ensures complete physical decoupling from `vanhsub-settings.json`.
2. **Lazy Singleton**:
   Exported function `getAiStudioStore()` instantiates the store only on demand. If accessed before Electron is ready or during headless tests, it dynamically resolves a valid directory rather than crashing with projectName errors.
3. **Hardware DPAPI Encryption via safeStorage**:
   - `encryptSecret`: Uses `safeStorage.encryptString()` and tags ciphertexts with `enc:v1:`. If safeStorage is unavailable (such as during Node.js tests or on systems without credential managers), it falls back seamlessly to plaintext.
   - `decryptSecret`: Inspects prefix. If starting with `enc:v1:`, calls `safeStorage.decryptString()`. If safeStorage is unavailable or fails, returns empty string. If unencrypted plaintext, passes through as-is.
4. **Headless / Test Directory Fallback**:
   Checks `process.env.VANHSUB_AI_STUDIO_DIR` first. If undefined and running outside full Electron, defaults to `path.join(os.tmpdir(), 'vanhsub-ai-studio')`. Ensures directory existence recursively before initialization.
5. **Methods Required by Objective**:
   - `getAiStudioConfig()`: Returns persisted config object.
   - `getDecryptedAiStudioConfig()`: Returns config with `llm.apiKey` decrypted for backend LLM clients.
   - `updateAiStudioConfig(partial)`: Performs deep merge across all 5 sections, encrypting new plaintext API keys.
   - `resetAiStudioConfig()`: Resets configuration to `DEFAULT_AI_STUDIO_CONFIG`.
   - `AiStudioStore`: Namespace facade matching project conventions (`SettingsStore`, `TaskStore`).

### 3.2 Verbatim Code Blueprint: `main/store/aiStudioStore.ts`

```typescript
import os from 'os';
import path from 'path';
import fs from 'fs';
import Store from 'electron-store';
import {
  AiStudioConfig,
  DEFAULT_AI_STUDIO_CONFIG,
  DeepPartial,
} from '../ai-studio/types';

// ============================================================================
// 1. Hardware DPAPI Secret Encryption (safeStorage)
// ============================================================================

export const ENC_PREFIX = 'enc:v1:';

/**
 * Safely acquires Electron's safeStorage API if available in current process.
 * Gracefully returns null in headless, unit test, or CLI runtimes.
 */
function getSafeStorage(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    const safeStorage = electron?.safeStorage;
    if (
      safeStorage &&
      typeof safeStorage.isEncryptionAvailable === 'function' &&
      safeStorage.isEncryptionAvailable()
    ) {
      return safeStorage;
    }
  } catch {
    // Not running inside active Electron environment
  }
  return null;
}

/**
 * Encrypts a secret string using Windows DPAPI (via safeStorage).
 * If safeStorage is available, returns 'enc:v1:<base64>'.
 * If unavailable, safely falls back to plaintext.
 */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  if (plain.startsWith(ENC_PREFIX)) return plain; // Prevent double encryption

  const storage = getSafeStorage();
  if (storage) {
    try {
      const encryptedBuffer = storage.encryptString(plain);
      return ENC_PREFIX + encryptedBuffer.toString('base64');
    } catch (err) {
      console.warn('[aiStudioStore] DPAPI encryption failed, falling back to plaintext:', err);
    }
  }
  return plain;
}

/**
 * Decrypts a DPAPI-encrypted secret string (prefixed with 'enc:v1:').
 * Returns plaintext as-is if unencrypted.
 * Returns empty string if safeStorage is unavailable or decryption fails.
 */
export function decryptSecret(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith(ENC_PREFIX)) return stored; // Plaintext fallback or legacy

  const storage = getSafeStorage();
  if (storage) {
    try {
      const base64Data = stored.slice(ENC_PREFIX.length);
      const buffer = Buffer.from(base64Data, 'base64');
      return storage.decryptString(buffer);
    } catch (err) {
      console.error('[aiStudioStore] DPAPI decryption failed:', err);
      return '';
    }
  }

  // Headless environment without DPAPI capability
  console.warn('[aiStudioStore] safeStorage unavailable to decrypt DPAPI secret');
  return '';
}

// ============================================================================
// 2. Storage Directory Resolution & Headless Fallback
// ============================================================================

/**
 * Resolves the configuration directory for 'vanhsub-ai-studio.json'.
 * Resolution order:
 * 1. process.env.VANHSUB_AI_STUDIO_DIR (test/custom override)
 * 2. Electron userData directory (when app is ready)
 * 3. Headless fallback: path.join(os.tmpdir(), 'vanhsub-ai-studio')
 */
export function resolveAiStudioCwd(): string | undefined {
  const envDir = process.env.VANHSUB_AI_STUDIO_DIR;
  if (envDir) {
    if (!fs.existsSync(envDir)) {
      try {
        fs.mkdirSync(envDir, { recursive: true });
      } catch {}
    }
    return envDir;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    const electronApp = electron?.app;
    if (electronApp?.name || electronApp?.getPath) {
      // Running in full Electron app; electron-store will use app userData by default
      return undefined;
    }
  } catch {
    // Not running inside Electron
  }

  // Headless / test fallback
  const tmpDir = path.join(os.tmpdir(), 'vanhsub-ai-studio');
  if (!fs.existsSync(tmpDir)) {
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
    } catch {}
  }
  return tmpDir;
}

// ============================================================================
// 3. Lazy Singleton Store Instance
// ============================================================================

let _aiStudioStore: Store<AiStudioConfig> | null = null;

/**
 * Returns the lazy-singleton electron-store instance for AI Studio.
 * Writes to 'vanhsub-ai-studio.json'.
 * Completely isolated from 'vanhsub-settings.json'.
 */
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

/**
 * Test helper to reset the cached singleton instance.
 * Allows switching directories or re-initializing in unit tests.
 */
export function _resetAiStudioStoreInstance(): void {
  _aiStudioStore = null;
}

// ============================================================================
// 4. Configuration Access & Mutation Methods
// ============================================================================

/**
 * Retrieves the AI Studio configuration.
 * @param options.decrypted When true, decrypts `llm.apiKey` from DPAPI ciphertext.
 *                          When false or omitted, returns stored value (encrypted if DPAPI was used).
 */
export function getAiStudioConfig(options?: { decrypted?: boolean }): AiStudioConfig {
  const store = getAiStudioStore();
  const raw = store.store;
  const config: AiStudioConfig = JSON.parse(JSON.stringify(raw));

  // Merge with defaults to protect against corrupted or partially populated JSON files
  const merged: AiStudioConfig = {
    llm: { ...DEFAULT_AI_STUDIO_CONFIG.llm, ...(config.llm || {}) },
    voice: { ...DEFAULT_AI_STUDIO_CONFIG.voice, ...(config.voice || {}) },
    flowEngine: { ...DEFAULT_AI_STUDIO_CONFIG.flowEngine, ...(config.flowEngine || {}) },
    rendering: { ...DEFAULT_AI_STUDIO_CONFIG.rendering, ...(config.rendering || {}) },
    subtitles: { ...DEFAULT_AI_STUDIO_CONFIG.subtitles, ...(config.subtitles || {}) },
  };

  if (options?.decrypted) {
    merged.llm.apiKey = decryptSecret(merged.llm.apiKey);
  }

  return merged;
}

/**
 * Retrieves the AI Studio configuration with `llm.apiKey` guaranteed decrypted.
 * Suitable for backend services making outbound LLM API requests.
 */
export function getDecryptedAiStudioConfig(): AiStudioConfig {
  return getAiStudioConfig({ decrypted: true });
}

/**
 * Updates AI Studio configuration with partial changes.
 * Performs deep section merging to avoid overwriting unchanged sibling keys.
 * Automatically encrypts plaintext API keys with DPAPI before persisting to disk.
 */
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
    voice: {
      ...current.voice,
      ...(partial.voice || {}),
    },
    flowEngine: {
      ...current.flowEngine,
      ...(partial.flowEngine || {}),
    },
    rendering: {
      ...current.rendering,
      ...(partial.rendering || {}),
    },
    subtitles: {
      ...current.subtitles,
      ...(partial.subtitles || {}),
    },
  };

  // Encrypt llm.apiKey if modified
  if (partial.llm && 'apiKey' in partial.llm && partial.llm.apiKey !== undefined) {
    const rawKey = partial.llm.apiKey.trim();
    if (!rawKey) {
      updated.llm.apiKey = '';
    } else if (rawKey.startsWith(ENC_PREFIX)) {
      // Already encrypted, retain without double-encrypting
      updated.llm.apiKey = rawKey;
    } else {
      // New plaintext key, encrypt with DPAPI
      updated.llm.apiKey = encryptSecret(rawKey);
    }
  }

  // Persist to disk
  store.store = updated;

  if (options?.decrypted) {
    return {
      ...updated,
      llm: {
        ...updated.llm,
        apiKey: decryptSecret(updated.llm.apiKey),
      },
    };
  }

  return JSON.parse(JSON.stringify(updated));
}

/**
 * Resets the entire AI Studio configuration back to specification defaults.
 * Writes clean defaults to 'vanhsub-ai-studio.json' on disk.
 */
export function resetAiStudioConfig(): AiStudioConfig {
  const store = getAiStudioStore();
  const freshDefaults: AiStudioConfig = JSON.parse(JSON.stringify(DEFAULT_AI_STUDIO_CONFIG));
  store.store = freshDefaults;
  return JSON.parse(JSON.stringify(freshDefaults));
}

// ============================================================================
// 5. Facade Object (Vanhsub Convention)
// ============================================================================

export const AiStudioStore = {
  getStore: getAiStudioStore,
  getConfig: getAiStudioConfig,
  getDecryptedConfig: getDecryptedAiStudioConfig,
  updateConfig: updateAiStudioConfig,
  resetConfig: resetAiStudioConfig,
  hasApiKey(): boolean {
    const cfg = getDecryptedAiStudioConfig();
    return Boolean(cfg.llm.apiKey && cfg.llm.apiKey.trim().length > 0);
  },
};
```

---

## 4. Rigorous Proof of Zero Interference with `settingsStore.ts`

| Dimension | `settingsStore.ts` | `aiStudioStore.ts` | Interference Analysis |
| :--- | :--- | :--- | :--- |
| **Disk File Name** | `vanhsub-settings.json` | `vanhsub-ai-studio.json` | Separate file handles. OS filesystem guarantees atomic mutual exclusion. |
| **Env Var Override** | `process.env.VANHSUB_SETTINGS_DIR` | `process.env.VANHSUB_AI_STUDIO_DIR` | Distinct environment keys. Tests pointing one store to temp dir never touch the other. |
| **Headless Fallback Dir**| `path.join(os.tmpdir(), 'vanhsub-settings')` | `path.join(os.tmpdir(), 'vanhsub-ai-studio')` | Isolated subdirectory folders in OS temp directory. |
| **Singleton Instance** | `_store: Store<AppSettings>` | `_aiStudioStore: Store<AiStudioConfig>` | Module-scoped private memory variables. No global leakage. |
| **Top-Level Schema** | `geminiApiKey`, `veoSessionCookie`, `ocrMode`, etc. | `llm`, `voice`, `flowEngine`, `rendering`, `subtitles` | Completely disjoint schemas. |
| **IPC Channels** | `settings:get`, `settings:set` | `aiStudio:config:get`, `aiStudio:config:set`, `aiStudio:config:reset` | Namespace prefix `aiStudio:` isolates all message events. |

---

## 5. IPC Registration Pattern (`main/ai-studio/ipc.ts`)

In Milestone 1, IPC registration will be placed in `main/ai-studio/ipc.ts` and called inside `main/main.ts` via `registerAiStudioIpc()`. The handler mapping is designed as follows:

```typescript
import { ipcMain } from 'electron';
import {
  getAiStudioConfig,
  getDecryptedAiStudioConfig,
  updateAiStudioConfig,
  resetAiStudioConfig,
} from '../store/aiStudioStore';
import type { PartialAiStudioConfig } from './types';

export function registerAiStudioConfigIpc(): void {
  // Returns configuration (with decrypted apiKey so user can see and edit in Settings tab)
  ipcMain.handle('aiStudio:config:get', async () => {
    return getDecryptedAiStudioConfig();
  });

  // Saves partial configuration updates
  ipcMain.handle('aiStudio:config:set', async (_event, partial: PartialAiStudioConfig) => {
    return updateAiStudioConfig(partial, { decrypted: true });
  });

  // Resets configuration to specification defaults
  ipcMain.handle('aiStudio:config:reset', async () => {
    return resetAiStudioConfig();
  });
}
```

Preload binding in `main/preload.ts`:
```typescript
aiStudio: {
  getConfig: () => ipcRenderer.invoke('aiStudio:config:get'),
  setConfig: (partial: any) => ipcRenderer.invoke('aiStudio:config:set', partial),
  resetConfig: () => ipcRenderer.invoke('aiStudio:config:reset'),
}
```

---

## 6. Verification & Test Plan

A verification test suite will validate the implementation using `npx tsx`:
1. **Defaults Test**: Verify that on a fresh store, all 5 sections match §5.1 & §5.2 defaults.
2. **Partial Update & Deep Merge Test**: Updating `rendering.fps` must not erase `kenBurnsEffect` or `resolution`. Updating `llm.model` must not erase `provider`.
3. **Encryption Round-Trip & Fallback Test**:
   - In Node.js headless environment, verify that `encryptSecret` safely falls back to plaintext without throwing.
   - When mocked or in Electron, verify `enc:v1:` prefix and decryption round-trip.
4. **Reset Test**: After making edits, calling `resetAiStudioConfig()` must restore exact `DEFAULT_AI_STUDIO_CONFIG`.
5. **Headless / CWD Isolation Test**:
   - Set `process.env.VANHSUB_AI_STUDIO_DIR` to a temporary directory.
   - Verify store writes to that temporary directory and leaves `vanhsub-settings.json` completely untouched.
