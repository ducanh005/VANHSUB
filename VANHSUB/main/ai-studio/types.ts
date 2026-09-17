/**
 * Vanhsub AI Video Studio - Core TypeScript Schemas & Defaults
 * Conforms to AI_STUDIO_SPEC.md §5.1 & §5.2 and PROJECT.md
 */

// ============================================================================
// 1. Configuration Schemas (§5.1)
// ============================================================================

export type LlmProvider = 'deepseek' | 'openai' | 'custom' | 'chatgpt_web' | 'gemini_web';

export interface AiStudioLlmConfig {
  /** Nhà cung cấp mô hình ngôn ngữ lớn: 'deepseek' | 'openai' | 'custom' | 'chatgpt_web' | 'gemini_web' */
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
  /** Chế độ hiển thị khi dùng ChatGPT Web: 'offscreen' | 'visible' */
  chatgptWebMode?: 'offscreen' | 'visible';
  /** Chế độ hiển thị khi dùng Gemini Web: 'offscreen' | 'visible' */
  geminiWebMode?: 'offscreen' | 'visible';
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
  estimatedDurationSec?: number;
  beatType?: 'hook' | 'intro' | 'body' | 'climax' | 'outro';
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

export interface SeoMetadata {
  title: string;
  description: string;
  hashtags: string[];
  thumbnailPrompt: string;
}

export interface IdeaBlueprint {
  topic: string;
  targetAudience: string;
  narrativeAngle: string;
  hookConcept: string;
  pacing: 'fast' | 'moderate' | 'slow';
  estimatedDurationSec: number;
  keyBeats: string[];
  rawSummary: string;
}

export interface ScriptQualityAuditResult {
  retentionScore: number;
  hookScore: number;
  pacingScore: number;
  hookAnalysis: string;
  retentionLoopSuggestions: string[];
  ctaEvaluation: string;
  overallFeedback: string;
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
    metadata?: SeoMetadata;
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

export type PipelineStageStatus = AiStudioStageStatus;
export type PipelineProgressEvent = PipelineProgressPayload;

// Payload and Result contracts for IPC
export interface StartPipelinePayload {
  topic: string;
  options?: PartialAiStudioConfig;
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
  customSettings?: DeepPartial<AiStudioRenderingConfig & AiStudioSubtitleConfig>;
}

export interface RenderVideoResult {
  videoPath: string;
}
