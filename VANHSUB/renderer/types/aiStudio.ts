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
export type LlmProviderType = 'deepseek' | 'openai' | 'custom' | 'chatgpt_web' | 'gemini_web';

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
  /** Chế độ hiển thị khi dùng ChatGPT Web: 'offscreen' (chạy ngầm) hoặc 'visible' (xem trực tiếp) */
  chatgptWebMode?: 'offscreen' | 'visible';
  /** Chế độ hiển thị khi dùng Gemini Web: 'offscreen' (chạy ngầm) hoặc 'visible' (xem trực tiếp) */
  geminiWebMode?: 'offscreen' | 'visible';
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

export type SubtitlePreset = SubtitlePresetType;

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

export type PartialAiStudioConfig = DeepPartial<AiStudioConfig>;

// ============================================================================
// 3. DEFAULT CONFIGURATION CONSTANTS (CHUẨN ĐẶC TẢ §5.2)
// ============================================================================

export const DEFAULT_AI_STUDIO_CONFIG: AiStudioConfig = {
  llm: {
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-chat',
    baseUrl: '',
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
    defaultBgmPath: '',
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

export type PipelineStageStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped' | 'awaiting_approval';

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

export interface IdeaBlueprint {
  topic: string;
  title?: string;
  aspectRatio?: '16:9' | '9:16';
  targetAudience?: string;
  narrativeAngle: string;
  hookConcept: string;
  pacing?: 'fast' | 'moderate' | 'slow';
  estimatedDurationSec?: number;
  keyBeats?: string[];
  outline?: string[];
  existingScript?: string;
  thumbnailConcept?: string;
  thumbnailPrompt?: string;
  rawSummary?: string;
}

export interface PipelineStartInput {
  topic: string;
  blueprint?: IdeaBlueprint;
  gatedMode?: boolean;
  options?: DeepPartial<AiStudioConfig>;
}
export type StartPipelinePayload = PipelineStartInput;

export interface PipelineStartResponse {
  sessionId: string;
}
export type StartPipelineResult = PipelineStartResponse;

export interface AutoFillIdeaInput {
  topic: string;
  aspectRatio?: '16:9' | '9:16';
}
export type AutoFillIdeaPayload = AutoFillIdeaInput;

export interface AutoFillIdeaResponse {
  title: string;
  hookConcept: string;
  narrativeAngle: string;
  outline: string[];
  thumbnailConcept: string;
  thumbnailPrompt: string;
}
export type AutoFillIdeaResult = AutoFillIdeaResponse;

export interface ApproveStageInput {
  sessionId: string;
  currentStage: number;
  updatedArtifacts?: Record<string, unknown>;
}
export type ApproveStagePayload = ApproveStageInput;

export interface ApproveStageResponse {
  success: boolean;
  nextStage?: number;
}
export type ApproveStageResult = ApproveStageResponse;

export interface PipelineResumeInput {
  sessionId: string;
  fromStage?: number;
}
export type ResumePipelinePayload = PipelineResumeInput;

export interface PipelineResumeResponse {
  success: boolean;
  error?: string;
}
export type ResumePipelineResult = PipelineResumeResponse;

export interface PipelineCancelInput {
  sessionId: string;
}
export type CancelPipelinePayload = PipelineCancelInput;

export interface PipelineCancelResponse {
  success: boolean;
  error?: string;
}
export type CancelPipelineResult = PipelineCancelResponse;

export interface PipelineStageInfo {
  stage?: number;
  name?: string;
  stageName?: string;
  status: PipelineStageStatus;
  progress?: number;
  startedAt?: number;
  completedAt?: number;
  message?: string;
  error?: string;
}

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

export interface PipelineSessionArtifacts {
  ideaSummary?: string;
  blueprint?: IdeaBlueprint;
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
  [key: string]: unknown;
}

export interface PipelineSessionState {
  sessionId: string;
  topic: string;
  currentStage: number;
  stageName?: string;
  status: 'idle' | 'running' | 'awaiting_approval' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'error';
  progress?: number;
  gatedMode?: boolean;
  stages?: Record<number, PipelineStageInfo> | PipelineStageInfo[];
  stageProgress?: Record<number, PipelineStageInfo>;
  artifacts: PipelineSessionArtifacts;
  createdAt: number | string;
  updatedAt: number | string;
  error?: string;
}

export interface RenderSingleLineVoiceInput {
  lineIndex: number;
  text: string;
  voiceConfig?: Partial<AiStudioVoiceConfig>;
}
export type RenderSingleLineVoicePayload = RenderSingleLineVoiceInput;

export interface RenderSingleLineVoiceResponse {
  audioPath: string;
  durationMs: number;
  error?: string;
}
export type RenderSingleLineVoiceResult = RenderSingleLineVoiceResponse;

export interface RegenerateSceneAssetInput {
  sceneId: string;
  visualPrompt: string;
  flowConfig?: Partial<AiStudioFlowEngineConfig>;
}
export type RegenerateSceneAssetPayload = RegenerateSceneAssetInput;

export interface RegenerateSceneAssetResponse {
  assetPath: string;
  error?: string;
}
export type RegenerateSceneAssetResult = RegenerateSceneAssetResponse;

export interface RenderVideoInput {
  sessionId: string;
  customSettings?: DeepPartial<AiStudioRenderingConfig & AiStudioSubtitleConfig>;
}
export type RenderVideoPayload = RenderVideoInput;

export interface RenderVideoResponse {
  videoPath: string;
  error?: string;
}
export type RenderVideoResult = RenderVideoResponse;

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
  getPipelineState?: (sessionId: string | { sessionId: string }) => Promise<PipelineSessionState | null>;

  // Chế độ từng bước có phê duyệt & Tự động điền ý tưởng
  autoFillIdea?: (input: AutoFillIdeaInput) => Promise<AutoFillIdeaResponse>;
  approveStage?: (input: ApproveStageInput) => Promise<ApproveStageResponse>;

  renderSingleLineVoice?: (input: RenderSingleLineVoiceInput) => Promise<RenderSingleLineVoiceResponse>;
  regenerateSceneAsset?: (input: RegenerateSceneAssetInput) => Promise<RegenerateSceneAssetResponse>;
  renderVideo?: (input: RenderVideoInput) => Promise<RenderVideoResponse>;

  // ChatGPT Web Automation
  checkChatGptLogin?: () => Promise<{ isLoggedIn: boolean; userEmail?: string; sessionCheckedAt: number }>;
  openChatGptLogin?: () => Promise<{ success: boolean }>;
  closeChatGptLogin?: () => Promise<{ success: boolean }>;

  // Gemini Web Automation
  checkGeminiLogin?: () => Promise<{ isLoggedIn: boolean; userEmail?: string; sessionCheckedAt: number }>;
  openGeminiLogin?: () => Promise<{ success: boolean }>;
  closeGeminiLogin?: () => Promise<{ success: boolean }>;

  onPipelineProgress?: (callback: (event: PipelineProgressEvent) => void) => () => void;
  onProgress?: (callback: (event: PipelineProgressEvent) => void) => () => void;
}
