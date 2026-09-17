# Blueprint Kỹ Thuật: Renderer Store & Typings (Milestone 1)

> **Tài liệu đặc tả kiến trúc, thiết kế chi tiết và mã nguồn hoàn chỉnh cho phân hệ Renderer Store của Vanhsub AI Video Studio.**  
> Bao gồm: `renderer/types/aiStudio.ts` và `renderer/lib/store/aiStudioStore.ts`.

---

## 1. TỔNG QUAN KIẾN TRÚC & PHÂN TÁCH TRÁCH NHIỆM

### 1.1. Mục Tiêu & Phạm Vi (Scope)
Trong Milestone 1 của phân hệ AI Video Studio, phía Renderer cần một lớp lưu trữ trạng thái cấu hình (Configuration Store) độc lập, hoàn toàn tách biệt với `settingsStore` (quản lý cài đặt chung của Vanhsub như ASR, OCR, VietTTS) và `workflowStore` (quản lý đồ thị node `@xyflow/react`).

Lớp này bao gồm 2 file trọng tâm:
1. **`renderer/types/aiStudio.ts`**: Hệ thống kiểu dữ liệu TypeScript phía Renderer, định nghĩa chính xác cấu trúc `AiStudioConfig` (gồm 5 phân hệ cấu hình: `llm`, `voice`, `flowEngine`, `rendering`, `subtitles`), các giá trị mặc định `DEFAULT_AI_STUDIO_CONFIG`, tiện ích `DeepPartial`, và các kiểu dữ liệu IPC Bridge (`VanhsubAiStudioBridge`), sự kiện tiến độ (`PipelineProgressEvent`), cũng như các request/response payload cho các giai đoạn tiếp theo (Milestone 2/3).
2. **`renderer/lib/store/aiStudioStore.ts`**: Zustand store độc lập (`useAiStudioStore`), cung cấp state management reactive cho UI, đồng bộ 2 chiều (2-way sync) với Electron Main Process qua bridge `window.vanhsub.aiStudio`, hỗ trợ cơ chế fallback an toàn về `DEFAULT_AI_STUDIO_CONFIG` khi chạy trong môi trường trình duyệt (Browser Dev Mode / Next.js dev server không có Electron preload), và cơ chế merge an toàn theo từng phân hệ (Section-aware Deep Merge) để không làm mất các thuộc tính lồng nhau.

```
+-------------------------------------------------------------------------+
|                              RENDERER PROCESS                           |
|                                                                         |
|  +-----------------------------------+  +----------------------------+  |
|  |       AI Studio UI Components     |  |    Settings & Home Tabs    |  |
|  | (AiStudioSettingsTab, AutoPilot)  |  |    (AiStudioContainer)     |  |
|  +-----------------+-----------------+  +--------------+-------------+  |
|                    |                                   |                |
|                    v                                   v                |
|  +-------------------------------------------------------------------+  |
|  |           Zustand Store: useAiStudioStore (Renderer Store)        |  |
|  |  State: config, isLoading, isSaving, error, hasLoaded             |  |
|  |  Actions: loadConfig(), updateConfig(), resetConfig(), setError() |  |
|  |  Section Helpers: updateLlmConfig(), updateVoiceConfig(), etc.   |  |
|  +-----------------+----------------------------------+---------------+  |
|                    |                                  |                 |
|         [If in Browser Dev]                  [If in Electron Preload]   |
|                    v                                  v                 |
|     +------------------------------+     +---------------------------+  |
|     | In-memory Default State      |     | window.vanhsub.aiStudio   |  |
|     | (DEFAULT_AI_STUDIO_CONFIG)   |     | getConfig / updateConfig  |  |
|     +------------------------------+     +-------------+-------------+  |
+--------------------------------------------------------|----------------+
                                                         | IPC Invoke
                                                         v
+-------------------------------------------------------------------------+
|                               MAIN PROCESS                              |
|  +-------------------------------------------------------------------+  |
|  |                  main/ai-studio/ipc.ts (IPC Router)               |  |
|  +---------------------------------+---------------------------------+  |
|                                    |                                    |
|                                    v                                    |
|  +-------------------------------------------------------------------+  |
|  |            main/store/aiStudioStore.ts (electron-store)           |  |
|  |               File: vanhsub-ai-studio.json + DPAPI                |  |
|  +-------------------------------------------------------------------+  |
+-------------------------------------------------------------------------+
```

---

## 2. BẢN THIẾT KẾ CHI TIẾT FILE 1: `renderer/types/aiStudio.ts`

### 2.1. Phân Tích Kỹ Thuật
- Căn cứ tài liệu đặc tả `AI_STUDIO_SPEC.md` §5.1 & §5.2 và hợp đồng giao tiếp tại `orchestrator_2/PROJECT.md`.
- File này không phụ thuộc vào bất kỳ thư viện Electron hay Node.js nào, hoàn toàn tương thích với môi trường trình duyệt client-side và Next.js bundler.
- Cung cấp:
  1. Các interface con cho 5 phân hệ cấu hình: `AiStudioLlmConfig`, `AiStudioVoiceConfig`, `AiStudioFlowEngineConfig`, `AiStudioRenderingConfig`, `AiStudioSubtitleConfig`.
  2. Interface gốc `AiStudioConfig` gom 5 phân hệ.
  3. Hằng số `DEFAULT_AI_STUDIO_CONFIG` đầy đủ tất cả các trường mặc định theo đúng đặc tả §5.2.
  4. Utility type `DeepPartial<T>` cho phép cập nhật cấu hình từng phần (nested partial update) mà không bắt buộc truyền toàn bộ cây object.
  5. Các interface IPC Request / Response cho Milestone 1 (`getConfig`, `updateConfig`, `resetConfig`) và Milestone 2 (`startPipeline`, `resumePipeline`, `cancelPipeline`, `getPipelineState`, `renderSingleLineVoice`, `regenerateSceneAsset`, `renderVideo`, `onProgress`).
  6. Interface `VanhsubAiStudioBridge` đại diện cho namespace `window.vanhsub.aiStudio` để tái sử dụng trong `renderer/types/electron.d.ts`.

### 2.2. Toàn Bộ Mã Nguồn Đề Xuất Cho `renderer/types/aiStudio.ts`

```typescript
/**
 * Vanhsub AI Video Studio - Renderer Type Definitions
 * 
 * Chứa định nghĩa kiểu dữ liệu cho toàn bộ phân hệ AI Studio phía Renderer,
 * bao gồm Schema cấu hình (AiStudioConfig), giá trị mặc định (DEFAULT_AI_STUDIO_CONFIG),
 * và các hợp đồng IPC Bridge giao tiếp giữa Renderer và Electron Main Process.
 * 
 * Tuân thủ tuyệt đối: AI_STUDIO_SPEC.md §5.1 & §5.2
 */

// ============================================================================
// 1. UTILITY TYPES
// ============================================================================

/**
 * Đệ quy chuyển toàn bộ các thuộc tính (kể cả object lồng nhau) thành optional.
 * Dùng cho các hàm cập nhật cấu hình từng phần (updateConfig).
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[P] extends object
    ? DeepPartial<T[P]>
    : T[P];
};

// ============================================================================
// 2. CONFIGURATION SCHEMAS (5 PHÂN HỆ CẤU HÌNH)
// ============================================================================

/**
 * 1. LLM Settings (Kịch bản & Phân tích ý tưởng)
 */
export type LlmProviderType = 'deepseek' | 'openai' | 'custom';

export interface AiStudioLlmConfig {
  /** Nhà cung cấp mô hình ngôn ngữ lớn */
  provider: LlmProviderType;
  /** API Key (sẽ được mã hoá an toàn bằng DPAPI ở Main process) */
  apiKey: string;
  /** Tên model định danh (vd: 'deepseek-chat', 'gpt-4o', 'gpt-4o-mini') */
  model: string;
  /** Custom endpoint / reverse proxy nếu có (tùy chọn) */
  baseUrl?: string;
  /** Nhiệt độ sáng tạo: 0.0 (chính xác tuyệt đối) - 1.0 (sáng tạo cao) */
  temperature: number;
  /** Mẫu system prompt định sẵn (vd: 'youtube_story', 'tiktok_short', 'affiliate_sales') */
  systemPromptPreset: string;
}

/**
 * 2. TTS & Voice Settings (Giọng đọc & Lồng tiếng)
 */
export type VoiceProviderType = 'edge_tts' | 'local_onnx';

export interface AiStudioVoiceConfig {
  /** Nhà cung cấp giọng đọc (mặc định 'edge_tts') */
  provider: VoiceProviderType;
  /** Mã định danh giọng đọc (vd: 'vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural') */
  voiceId: string;
  /** Tốc độ đọc (vd: '-10%', '+0%', '+15%') */
  rate: string;
  /** Cao độ giọng đọc (vd: '+0Hz', '-2Hz', '+3Hz') */
  pitch: string;
  /** Âm lượng giọng đọc (vd: '+0%') */
  volume: string;
  /** Tự động trích xuất mốc thời gian chi tiết từng từ (Word-boundary Alignment) */
  autoWordAlignment: boolean;
}

/**
 * 3. Google Flow Engine Settings (Sinh Ảnh & Video phân cảnh)
 */
export type FlowAspectRatio = '16:9' | '9:16' | '1:1';
export type FlowOutputMode = 'image' | 'video';
export type FlowOutputsPerScene = 1 | 2 | 4;

export interface AiStudioFlowEngineConfig {
  /** Tỷ lệ khung hình tạo hình ảnh/clip */
  aspectRatio: FlowAspectRatio;
  /** Chế độ đầu ra: sinh ảnh tĩnh (kèm Ken Burns) hoặc sinh video chuyển động */
  outputMode: FlowOutputMode;
  /** Tiền tố phong cách hình ảnh gắn vào đầu mỗi visual prompt */
  stylePromptPrefix: string;
  /** Negative prompt loại bỏ chi tiết lỗi (watermark, chữ rác, méo hình) */
  negativePrompt: string;
  /** Số lượng ảnh/clip biến thể sinh cho mỗi phân cảnh */
  outputsPerScene: FlowOutputsPerScene;
  /** Thư mục lưu trữ assets sinh ra (chuỗi rỗng = thư mục tạm mặc định của project) */
  downloadDir: string;
  /** Số tác vụ sinh song song (khuyến nghị: 1 để tránh rate limit / checkpoint session) */
  concurrency: number;
}

/**
 * 4. Video Assembly & Rendering (Dựng phim qua FFmpeg)
 */
export type RenderResolution = '1080p' | '720p' | '4k';
export type RenderFps = 30 | 60;

export interface AiStudioRenderingConfig {
  /** Độ phân giải video thành phẩm */
  resolution: RenderResolution;
  /** Tốc độ khung hình (khuyến nghị 30fps cho web/social, 60fps cho cinematic) */
  fps: RenderFps;
  /** Bật/tắt hiệu ứng chuyển động lia/phóng to (Ken Burns effect) trên ảnh tĩnh */
  kenBurnsEffect: boolean;
  /** Tỷ lệ zoom tối đa của hiệu ứng Ken Burns (vd: 1.15 = phóng to 115%) */
  kenBurnsScale: number;
  /** Thời gian chuyển cảnh hòa tan chéo (giây, vd: 0.5) */
  transitionDuration: number;
  /** Đường dẫn file nhạc nền mặc định (nếu có) */
  defaultBgmPath?: string;
  /** Âm lượng nhạc nền (0.00 đến 1.00, khuyến nghị: 0.12) */
  bgmVolume: number;
  /** Tự động giảm âm lượng nhạc nền khi có giọng đọc (Audio Ducking) */
  autoAudioDucking: boolean;
}

/**
 * 5. Subtitle Styling (Đặc tính phụ đề gắn liền video)
 */
export type SubtitlePresetType =
  | 'tiktok_bold'
  | 'minimalist'
  | 'classic_bar'
  | 'karaoke_glow';

export interface AiStudioSubtitleConfig {
  /** Bật/tắt phụ đề gắn trên video xuất xưởng */
  enabled: boolean;
  /** Mẫu phong cách phụ đề định sẵn */
  preset: SubtitlePresetType;
  /** Cỡ chữ phụ đề (pixel) */
  fontSize: number;
  /** Màu chữ chính (mã Hex, vd: '#FFFFFF') */
  primaryColor: string;
  /** Màu viền chữ (mã Hex, vd: '#000000') */
  outlineColor: string;
  /** Độ dày viền chữ (pixel, vd: 3) */
  outlineWidth: number;
  /** Vị trí phụ đề theo % chiều cao khung hình tính từ đỉnh (vd: 80 = cách đỉnh 80%) */
  positionY: number;
}

/**
 * Toàn bộ cấu hình AI Video Studio
 */
export interface AiStudioConfig {
  llm: AiStudioLlmConfig;
  voice: AiStudioVoiceConfig;
  flowEngine: AiStudioFlowEngineConfig;
  rendering: AiStudioRenderingConfig;
  subtitles: AiStudioSubtitleConfig;
}

// ============================================================================
// 3. DEFAULT CONFIGURATION CONSTANTS (CHUẨN ĐẶC TẢ §5.2)
// ============================================================================

export const DEFAULT_AI_STUDIO_CONFIG: AiStudioConfig = {
  llm: {
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.6,
    systemPromptPreset: 'youtube_story',
  },
  voice: {
    provider: 'edge_tts',
    voiceId: 'vi-VN-HoaiMyNeural',
    rate: '+0%',
    pitch: '+0Hz',
    volume: '+0%',
    autoWordAlignment: true,
  },
  flowEngine: {
    aspectRatio: '16:9',
    outputMode: 'image',
    stylePromptPrefix: 'Cinematic lighting, high resolution, detailed photorealistic, 4k',
    negativePrompt: 'watermark, text, blurry, distortion, lowres',
    outputsPerScene: 1,
    downloadDir: '',
    concurrency: 1,
  },
  rendering: {
    resolution: '1080p',
    fps: 30,
    kenBurnsEffect: true,
    kenBurnsScale: 1.15,
    transitionDuration: 0.5,
    bgmVolume: 0.12,
    autoAudioDucking: true,
  },
  subtitles: {
    enabled: true,
    preset: 'tiktok_bold',
    fontSize: 24,
    primaryColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 3,
    positionY: 80,
  },
};

// ============================================================================
// 4. PIPELINE & IPC TYPINGS (HỖ TRỢ M1 & M2/M3)
// ============================================================================

export type PipelineStageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type PipelineStageStatus = 'pending' | 'running' | 'success' | 'error';

export interface PipelineProgressEvent {
  sessionId: string;
  stage: number;
  stageName: string;
  progress: number; // 0 - 100
  status: PipelineStageStatus;
  message?: string;
  error?: string;
  artifacts?: Record<string, unknown>;
}

export interface PipelineStartInput {
  topic: string;
  options?: DeepPartial<AiStudioConfig>;
}

export interface PipelineStartResponse {
  sessionId: string;
}

export interface PipelineResumeInput {
  sessionId: string;
  fromStage?: number;
}

export interface PipelineResumeResponse {
  success: boolean;
  error?: string;
}

export interface PipelineCancelInput {
  sessionId: string;
}

export interface PipelineCancelResponse {
  success: boolean;
  error?: string;
}

export interface PipelineStageInfo {
  status: PipelineStageStatus;
  progress: number;
  message?: string;
  error?: string;
}

export interface PipelineSessionArtifacts {
  ideaBlueprint?: Record<string, unknown>;
  script?: Record<string, unknown>;
  voiceoverAudioPath?: string;
  alignmentData?: Record<string, unknown>;
  storyboard?: Array<Record<string, unknown>>;
  visualAssetsDir?: string;
  renderedVideoPath?: string;
  seoMetadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PipelineSessionState {
  sessionId: string;
  topic: string;
  currentStage: number;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  stageProgress: Record<number, PipelineStageInfo>;
  artifacts: PipelineSessionArtifacts;
  createdAt: string;
  updatedAt: string;
}

export interface RenderSingleLineVoiceInput {
  lineIndex: number;
  text: string;
  voiceConfig?: Partial<AiStudioVoiceConfig>;
}

export interface RenderSingleLineVoiceResponse {
  audioPath: string;
  durationMs: number;
  error?: string;
}

export interface RegenerateSceneAssetInput {
  sceneId: string;
  visualPrompt: string;
  flowConfig?: Partial<AiStudioFlowEngineConfig>;
}

export interface RegenerateSceneAssetResponse {
  assetPath: string;
  error?: string;
}

export interface RenderVideoInput {
  sessionId: string;
  customSettings?: DeepPartial<AiStudioRenderingConfig & AiStudioSubtitleConfig>;
}

export interface RenderVideoResponse {
  videoPath: string;
  error?: string;
}

// ============================================================================
// 5. IPC BRIDGE INTERFACE (GIAO DIỆN window.vanhsub.aiStudio)
// ============================================================================

/**
 * Giao diện chính xác của đối tượng `window.vanhsub.aiStudio` được inject
 * qua preload script.
 */
export interface VanhsubAiStudioBridge {
  // Milestone 1 - Quản lý Cấu hình (Core)
  getConfig: () => Promise<AiStudioConfig>;
  updateConfig: (partial: DeepPartial<AiStudioConfig>) => Promise<AiStudioConfig>;
  resetConfig: () => Promise<AiStudioConfig>;

  // Aliases linh hoạt cho M1
  get?: () => Promise<AiStudioConfig>;
  set?: (partial: DeepPartial<AiStudioConfig>) => Promise<AiStudioConfig>;
  reset?: () => Promise<AiStudioConfig>;

  // Milestone 2 - Điều Phối Pipeline & Tác Vụ Đơn Lẻ
  startPipeline?: (input: PipelineStartInput) => Promise<PipelineStartResponse>;
  resumePipeline?: (input: PipelineResumeInput) => Promise<PipelineResumeResponse>;
  cancelPipeline?: (input: PipelineCancelInput) => Promise<PipelineCancelResponse>;
  getPipelineState?: (sessionId: string) => Promise<PipelineSessionState>;

  renderSingleLineVoice?: (input: RenderSingleLineVoiceInput) => Promise<RenderSingleLineVoiceResponse>;
  regenerateSceneAsset?: (input: RegenerateSceneAssetInput) => Promise<RegenerateSceneAssetResponse>;
  renderVideo?: (input: RenderVideoInput) => Promise<RenderVideoResponse>;

  onProgress?: (callback: (event: PipelineProgressEvent) => void) => () => void;
}
```

---

## 3. BẢN THIẾT KẾ CHI TIẾT FILE 2: `renderer/lib/store/aiStudioStore.ts`

### 3.1. Phân Tích Kỹ Thuật & Yêu Cầu Cốt Lõi

1. **State Shape**:
   - `config: AiStudioConfig`: Khởi tạo bằng bản clone an toàn của `DEFAULT_AI_STUDIO_CONFIG`.
   - `isLoading: boolean`: Bật `true` khi đang nạp cấu hình từ Main (`loadConfig`) hoặc khi đặt lại mặc định (`resetConfig`).
   - `isSaving: boolean`: Bật `true` khi đang ghi nhận thay đổi (`updateConfig`).
   - `error: string | null`: Lưu thông điệp lỗi nếu IPC bị ngắt quãng hoặc từ chối; tự xóa khi thao tác thành công.
   - `hasLoaded: boolean`: Đánh dấu `true` sau khi `loadConfig()` hoàn thành ít nhất một lần. Cho phép UI biết đã sẵn sàng và tránh gọi nạp lại không cần thiết.

2. **Cơ Chế 2-Way Sync Với Electron Main**:
   - `loadConfig()`: Gọi `window.vanhsub.aiStudio.getConfig()`. Khi có phản hồi, cập nhật `config` trong store bằng dữ liệu chính thống từ `electron-store`.
   - `updateConfig(partial)`:
     - Thực hiện cập nhật lạc quan (Optimistic Update) cục bộ trong Zustand ngay lập tức để UI mượt mà, phản hồi ngay với slider, text input.
     - Sau đó chuyển payload `partial` sang Main qua `window.vanhsub.aiStudio.updateConfig(partial)`.
     - Nhận về `AiStudioConfig` đã lưu (đã qua mã hoá DPAPI nếu có key nhạy cảm) và cập nhật lại store.
   - `resetConfig()`: Gọi `window.vanhsub.aiStudio.resetConfig()`, đưa store về `DEFAULT_AI_STUDIO_CONFIG`.

3. **Fallback An Toàn Khi Chạy Browser Dev**:
   - Kiểm tra `typeof window !== 'undefined' && window.vanhsub?.aiStudio`.
   - Nếu `window.vanhsub.aiStudio` không tồn tại (chạy `next dev` thuần hoặc unit test):
     - `loadConfig()`: Giữ nguyên `DEFAULT_AI_STUDIO_CONFIG`, bật `hasLoaded = true`, ghi nhận warning ở chế độ dev (`console.debug`), trả về cấu hình hiện tại mà không văng exception làm crash trang web.
     - `updateConfig(partial)`: Áp dụng merge trực tiếp vào in-memory state của Zustand, trả về `true`.
     - `resetConfig()`: Khôi phục in-memory state về bản sao mới của `DEFAULT_AI_STUDIO_CONFIG`, trả về `true`.

4. **Thuật Toán Section-Aware Deep Merge**:
   - Nếu chỉ dùng `{ ...base, ...partial }` cấp 1, khi người dùng gọi `updateConfig({ llm: { temperature: 0.8 } })`, toàn bộ object `llm` sẽ bị đè bẹp, làm mất sạch `apiKey`, `provider`, `model`!
   - Store triển khai hàm thuần khiết `mergeAiStudioConfig(base, partial)` kết hợp từng phân hệ:
     - `llm: { ...base.llm, ...(partial.llm || {}) }`
     - `voice: { ...base.voice, ...(partial.voice || {}) }`
     - `flowEngine: { ...base.flowEngine, ...(partial.flowEngine || {}) }`
     - `rendering: { ...base.rendering, ...(partial.rendering || {}) }`
     - `subtitles: { ...base.subtitles, ...(partial.subtitles || {}) }`
   - Đảm bảo 100% không bao giờ làm mất dữ liệu của các thuộc tính anh em trong cùng một phân hệ.

5. **Helper Functions Cho UI Từng Tab**:
   - Cung cấp sẵn các action chuyên biệt: `updateLlmConfig`, `updateVoiceConfig`, `updateFlowConfig`, `updateRenderingConfig`, `updateSubtitleConfig`.
   - Các component UI ở M3 (như `AiStudioSettingsTab`) có thể gọi trực tiếp `updateLlmConfig({ apiKey: 'sk-...' })` cực kỳ gọn gàng mà không phải bọc lại object cha.

### 3.2. Toàn Bộ Mã Nguồn Đề Xuất Cho `renderer/lib/store/aiStudioStore.ts`

```typescript
import { create } from 'zustand';
import {
  AiStudioConfig,
  DEFAULT_AI_STUDIO_CONFIG,
  DeepPartial,
  AiStudioLlmConfig,
  AiStudioVoiceConfig,
  AiStudioFlowEngineConfig,
  AiStudioRenderingConfig,
  AiStudioSubtitleConfig,
} from '../../types/aiStudio';

// ============================================================================
// PURE UTILITY FUNCTIONS (MERGE & CLONE)
// ============================================================================

/**
 * Tạo một bản sao độc lập (Deep Clone) của DEFAULT_AI_STUDIO_CONFIG
 * để không bao giờ làm đột biến hằng số gốc.
 */
export function cloneDefaultAiStudioConfig(): AiStudioConfig {
  return JSON.parse(JSON.stringify(DEFAULT_AI_STUDIO_CONFIG));
}

/**
 * Trộn một phần cấu hình (DeepPartial) vào cấu hình cơ sở một cách an toàn.
 * Bảo toàn tất cả các thuộc tính lồng nhau trong 5 phân hệ cấu hình.
 */
export function mergeAiStudioConfig(
  base: AiStudioConfig,
  patch: DeepPartial<AiStudioConfig>
): AiStudioConfig {
  return {
    llm: {
      ...base.llm,
      ...(patch.llm || {}),
    },
    voice: {
      ...base.voice,
      ...(patch.voice || {}),
    },
    flowEngine: {
      ...base.flowEngine,
      ...(patch.flowEngine || {}),
    },
    rendering: {
      ...base.rendering,
      ...(patch.rendering || {}),
    },
    subtitles: {
      ...base.subtitles,
      ...(patch.subtitles || {}),
    },
  };
}

/**
 * Kiểm tra xem môi trường hiện tại có cầu nối Electron IPC (preload) khả dụng hay không.
 */
function isElectronAiStudioAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.vanhsub !== 'undefined' &&
    Boolean(window.vanhsub.aiStudio)
  );
}

// ============================================================================
// STORE INTERFACES
// ============================================================================

export interface AiStudioStoreState {
  /** Toàn bộ đối tượng cấu hình AI Studio hiện tại */
  config: AiStudioConfig;
  /** Trạng thái đang tải cấu hình từ Main process hoặc đang reset */
  isLoading: boolean;
  /** Trạng thái đang lưu cấu hình xuống đĩa qua Main process */
  isSaving: boolean;
  /** Thông điệp lỗi gần nhất (nếu có); null nếu hoạt động bình thường */
  error: string | null;
  /** Đánh dấu cấu hình đã được nạp thành công ít nhất một lần */
  hasLoaded: boolean;
}

export interface AiStudioStoreActions {
  /** Nạp cấu hình từ Electron Main; fallback về mặc định nếu ở Browser */
  loadConfig: () => Promise<AiStudioConfig>;
  /** Cập nhật một phần cấu hình, đồng bộ 2 chiều với Main */
  updateConfig: (partial: DeepPartial<AiStudioConfig>) => Promise<boolean>;
  /** Đặt lại toàn bộ cấu hình về giá trị mặc định của hệ thống */
  resetConfig: () => Promise<boolean>;
  /** Ghi nhận hoặc xoá trạng thái lỗi */
  setError: (err: string | null) => void;

  // Tiện ích cập nhật riêng lẻ từng phân hệ (Sub-configuration Helpers)
  updateLlmConfig: (partial: Partial<AiStudioLlmConfig>) => Promise<boolean>;
  updateVoiceConfig: (partial: Partial<AiStudioVoiceConfig>) => Promise<boolean>;
  updateFlowConfig: (partial: Partial<AiStudioFlowEngineConfig>) => Promise<boolean>;
  updateRenderingConfig: (partial: Partial<AiStudioRenderingConfig>) => Promise<boolean>;
  updateSubtitleConfig: (partial: Partial<AiStudioSubtitleConfig>) => Promise<boolean>;
}

export type AiStudioStore = AiStudioStoreState & AiStudioStoreActions;

// ============================================================================
// ZUSTAND STORE IMPLEMENTATION
// ============================================================================

export const useAiStudioStore = create<AiStudioStore>((set, get) => ({
  // Khởi tạo state ban đầu an toàn
  config: cloneDefaultAiStudioConfig(),
  isLoading: false,
  isSaving: false,
  error: null,
  hasLoaded: false,

  /**
   * Đọc cấu hình từ Main process qua IPC bridge `window.vanhsub.aiStudio.getConfig()`.
   * Nếu đang ở Browser dev mode, giữ nguyên giá trị mặc định mà không báo lỗi.
   */
  loadConfig: async (): Promise<AiStudioConfig> => {
    set({ isLoading: true, error: null });

    if (!isElectronAiStudioAvailable()) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug(
          '[useAiStudioStore] window.vanhsub.aiStudio không tồn tại. Sử dụng cấu hình mặc định (Browser Dev Mode).'
        );
      }
      set({ isLoading: false, hasLoaded: true });
      return get().config;
    }

    try {
      const bridge = window.vanhsub.aiStudio;
      // Hỗ trợ cả method chuẩn getConfig và alias get
      const fetchFn = bridge.getConfig || bridge.get;
      if (typeof fetchFn !== 'function') {
        throw new Error('IPC method aiStudio.getConfig không khả dụng trên preload bridge.');
      }

      const remoteConfig = await fetchFn();
      if (remoteConfig && typeof remoteConfig === 'object') {
        // Hợp nhất với default config để phòng trường hợp dữ liệu cũ thiếu key
        const merged = mergeAiStudioConfig(cloneDefaultAiStudioConfig(), remoteConfig);
        set({
          config: merged,
          isLoading: false,
          hasLoaded: true,
          error: null,
        });
        return merged;
      }

      set({ isLoading: false, hasLoaded: true });
      return get().config;
    } catch (err: any) {
      const errorMsg = err?.message || 'Không thể tải cấu hình AI Studio từ Main process.';
      console.error('[useAiStudioStore.loadConfig] Lỗi:', err);
      set({
        isLoading: false,
        hasLoaded: true, // Vẫn đánh dấu hasLoaded để không gây block vòng lặp UI
        error: errorMsg,
      });
      return get().config;
    }
  },

  /**
   * Cập nhật cấu hình:
   * 1. Cập nhật lạc quan (Optimistic update) trên Zustand store ngay lập tức.
   * 2. Nếu có Electron Main, gửi payload partial xuống qua IPC để lưu vào electron-store.
   * 3. Nhận lại cấu hình chính thống từ Main để cập nhật lại store.
   */
  updateConfig: async (partial: DeepPartial<AiStudioConfig>): Promise<boolean> => {
    if (!partial || typeof partial !== 'object') {
      return false;
    }

    // 1. Optimistic Update cục bộ
    const currentConfig = get().config;
    const optimisticConfig = mergeAiStudioConfig(currentConfig, partial);
    set({
      config: optimisticConfig,
      isSaving: true,
      error: null,
    });

    // 2. Kiểm tra môi trường Browser Dev
    if (!isElectronAiStudioAvailable()) {
      set({ isSaving: false });
      return true;
    }

    // 3. Đồng bộ với Electron Main Process
    try {
      const bridge = window.vanhsub.aiStudio;
      const saveFn = bridge.updateConfig || bridge.set;
      if (typeof saveFn !== 'function') {
        throw new Error('IPC method aiStudio.updateConfig không khả dụng trên preload bridge.');
      }

      const savedConfig = await saveFn(partial);
      if (savedConfig && typeof savedConfig === 'object') {
        const validatedConfig = mergeAiStudioConfig(cloneDefaultAiStudioConfig(), savedConfig);
        set({
          config: validatedConfig,
          isSaving: false,
          error: null,
        });
      } else {
        set({ isSaving: false });
      }
      return true;
    } catch (err: any) {
      const errorMsg = err?.message || 'Lỗi khi lưu cấu hình AI Studio xuống đĩa.';
      console.error('[useAiStudioStore.updateConfig] Lỗi:', err);
      set({
        isSaving: false,
        error: errorMsg,
      });
      return false;
    }
  },

  /**
   * Đặt lại toàn bộ cấu hình về giá trị mặc định:
   * Gọi IPC `resetConfig()` nếu có Electron, hoặc khôi phục in-memory nếu ở Browser.
   */
  resetConfig: async (): Promise<boolean> => {
    set({ isLoading: true, error: null });

    const defaultConfig = cloneDefaultAiStudioConfig();

    if (!isElectronAiStudioAvailable()) {
      set({
        config: defaultConfig,
        isLoading: false,
        error: null,
      });
      return true;
    }

    try {
      const bridge = window.vanhsub.aiStudio;
      const resetFn = bridge.resetConfig || bridge.reset;
      if (typeof resetFn !== 'function') {
        throw new Error('IPC method aiStudio.resetConfig không khả dụng trên preload bridge.');
      }

      const result = await resetFn();
      const finalConfig =
        result && typeof result === 'object'
          ? mergeAiStudioConfig(cloneDefaultAiStudioConfig(), result)
          : defaultConfig;

      set({
        config: finalConfig,
        isLoading: false,
        error: null,
      });
      return true;
    } catch (err: any) {
      const errorMsg = err?.message || 'Lỗi khi đặt lại cấu hình AI Studio mặc định.';
      console.error('[useAiStudioStore.resetConfig] Lỗi:', err);
      set({
        isLoading: false,
        error: errorMsg,
      });
      return false;
    }
  },

  /**
   * Đặt hoặc xóa thông điệp lỗi trên store.
   */
  setError: (err: string | null) => {
    set({ error: err });
  },

  // ==========================================================================
  // CONVENIENCE SECTION HELPERS
  // ==========================================================================

  updateLlmConfig: async (partial: Partial<AiStudioLlmConfig>): Promise<boolean> => {
    return get().updateConfig({ llm: partial });
  },

  updateVoiceConfig: async (partial: Partial<AiStudioVoiceConfig>): Promise<boolean> => {
    return get().updateConfig({ voice: partial });
  },

  updateFlowConfig: async (partial: Partial<AiStudioFlowEngineConfig>): Promise<boolean> => {
    return get().updateConfig({ flowEngine: partial });
  },

  updateRenderingConfig: async (partial: Partial<AiStudioRenderingConfig>): Promise<boolean> => {
    return get().updateConfig({ rendering: partial });
  },

  updateSubtitleConfig: async (partial: Partial<AiStudioSubtitleConfig>): Promise<boolean> => {
    return get().updateConfig({ subtitles: partial });
  },
}));
```

---

## 4. TÍCH HỢP VỚI `renderer/types/electron.d.ts`

Để TypeScript nhận diện đầy đủ `window.vanhsub.aiStudio` mà không báo lỗi kiểu, cần bổ sung trường `aiStudio` vào interface `VanhsubAPI` trong file `renderer/types/electron.d.ts`.

### 4.1. Khối Import Cần Thêm Đầu File `renderer/types/electron.d.ts`
```typescript
import type {
  AiStudioConfig,
  DeepPartial,
  AiStudioVoiceConfig,
  AiStudioFlowEngineConfig,
  AiStudioRenderingConfig,
  AiStudioSubtitleConfig,
  PipelineStartInput,
  PipelineStartResponse,
  PipelineResumeInput,
  PipelineResumeResponse,
  PipelineCancelInput,
  PipelineCancelResponse,
  PipelineSessionState,
  RenderSingleLineVoiceInput,
  RenderSingleLineVoiceResponse,
  RegenerateSceneAssetInput,
  RegenerateSceneAssetResponse,
  RenderVideoInput,
  RenderVideoResponse,
  PipelineProgressEvent,
} from './aiStudio';
```

### 4.2. Khối Thuộc Tính Cần Thêm Vào `interface VanhsubAPI`
Tại `renderer/types/electron.d.ts`, bên trong `export interface VanhsubAPI { ... }`:

```typescript
  aiStudio: {
    /** Lấy cấu hình đầy đủ của phân hệ AI Studio */
    getConfig: () => Promise<AiStudioConfig>;
    /** Cập nhật cấu hình từng phần (đồng bộ lưu vào vanhsub-ai-studio.json) */
    updateConfig: (partial: DeepPartial<AiStudioConfig>) => Promise<AiStudioConfig>;
    /** Đặt lại cấu hình về mặc định ban đầu */
    resetConfig: () => Promise<AiStudioConfig>;

    // Aliases hỗ trợ tương thích
    get?: () => Promise<AiStudioConfig>;
    set?: (partial: DeepPartial<AiStudioConfig>) => Promise<AiStudioConfig>;
    reset?: () => Promise<AiStudioConfig>;

    // Milestone 2 Pipeline & Step APIs (Optional trong M1)
    startPipeline?: (input: PipelineStartInput) => Promise<PipelineStartResponse>;
    resumePipeline?: (input: PipelineResumeInput) => Promise<PipelineResumeResponse>;
    cancelPipeline?: (input: PipelineCancelInput) => Promise<PipelineCancelResponse>;
    getPipelineState?: (sessionId: string) => Promise<PipelineSessionState>;

    renderSingleLineVoice?: (input: RenderSingleLineVoiceInput) => Promise<RenderSingleLineVoiceResponse>;
    regenerateSceneAsset?: (input: RegenerateSceneAssetInput) => Promise<RegenerateSceneAssetResponse>;
    renderVideo?: (input: RenderVideoInput) => Promise<RenderVideoResponse>;

    onProgress?: (callback: (event: PipelineProgressEvent) => void) => () => void;
  };
```

---

## 5. MẪU SỬ DỤNG TRONG UI COMPONENTS (MILESTONE 3 READY)

Dưới đây là mẫu cách component UI (ví dụ `AiStudioSettingsTab.tsx` hoặc `AutoPilotView.tsx`) sử dụng store `useAiStudioStore`:

```tsx
import React, { useEffect } from 'react';
import { useAiStudioStore } from '@/lib/store/aiStudioStore';

export function AiStudioSettingsTab() {
  const {
    config,
    isLoading,
    isSaving,
    error,
    hasLoaded,
    loadConfig,
    updateLlmConfig,
    updateVoiceConfig,
    resetConfig,
  } = useAiStudioStore();

  useEffect(() => {
    if (!hasLoaded) {
      loadConfig();
    }
  }, [hasLoaded, loadConfig]);

  if (isLoading && !hasLoaded) {
    return <div>Đang nạp cấu hình AI Studio...</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <h2 className="text-xl font-bold">Cấu hình AI Video Studio</h2>
      
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded">
          {error}
        </div>
      )}

      {/* Phân hệ LLM */}
      <section className="space-y-4">
        <h3 className="text-lg font-semibold">1. Kịch Bản & LLM</h3>
        <input
          type="password"
          placeholder="Nhập API Key LLM"
          value={config.llm.apiKey}
          onChange={(e) => updateLlmConfig({ apiKey: e.target.value })}
          className="border p-2 rounded w-full"
        />
      </section>

      {/* Phân hệ Voice */}
      <section className="space-y-4">
        <h3 className="text-lg font-semibold">2. Giọng Đọc & TTS</h3>
        <select
          value={config.voice.voiceId}
          onChange={(e) => updateVoiceConfig({ voiceId: e.target.value })}
          className="border p-2 rounded w-full"
        >
          <option value="vi-VN-HoaiMyNeural">Hoài My (Nữ)</option>
          <option value="vi-VN-NamMinhNeural">Nam Minh (Nam)</option>
        </select>
      </section>

      <div className="flex gap-4">
        <button
          onClick={() => resetConfig()}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
        >
          Khôi phục mặc định
        </button>
        {isSaving && <span className="text-sm text-gray-400">Đang lưu...</span>}
      </div>
    </div>
  );
}
```

---

## 6. PHƯƠNG PHÁP XÁC MINH & KIỂM THỬ ĐỘC LẬP (VERIFICATION PLAN)

### 6.1. Kiểm Thử Biên Dịch TypeScript (Strict Typecheck)
- Chạy lệnh: `npx tsc --noEmit`
- Kỳ vọng: Không có bất kỳ lỗi biên dịch nào trên toàn bộ thư mục `renderer/` và `main/`.
- Kiểm tra cụ thể:
  - `AiStudioConfig` tuân thủ strict null check.
  - `DeepPartial<AiStudioConfig>` cho phép truyền các nhánh con mà không báo lỗi thuộc tính thiếu.
  - `useAiStudioStore` cung cấp đầy đủ các action và state với đúng type signatures.

### 6.2. Kiểm Thử Cơ Chế Fallback Trình Duyệt (Browser Dev Fallback)
- Môi trường: Khởi chạy renderer trên browser không qua Electron preload (`npm run dev` hoặc test runner node/jsdom).
- Kiểm tra:
  - `useAiStudioStore.getState().loadConfig()` chạy thành công và trả về `DEFAULT_AI_STUDIO_CONFIG`.
  - `useAiStudioStore.getState().updateConfig({ llm: { temperature: 0.9 } })` cập nhật state local và giữ nguyên `llm.provider`, `llm.model`.
  - Không có exception nào bị ném ra do thiếu `window.vanhsub`.

### 6.3. Kiểm Thử Đồng Bộ Hai Chiều Với Main Process (2-Way Sync)
- Môi trường: Chạy ứng dụng hoàn chỉnh qua `npm run dev` (Nextron: Electron + Next.js).
- Kiểm tra:
  - Khi store gọi `loadConfig()`, `window.vanhsub.aiStudio.getConfig()` được gọi và trả về cấu hình từ `vanhsub-ai-studio.json`.
  - Khi store gọi `updateConfig({ voice: { rate: '+10%' } })`, file `vanhsub-ai-studio.json` được cập nhật tương ứng.
  - Khi khởi động lại ứng dụng, `loadConfig()` nạp lại chính xác giá trị `rate: '+10%'` đã lưu trước đó.
