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

// ============================================================================
// 1.5 Channel Profile & Personality Settings (Cấu hình Kênh & Bộ não)
// ============================================================================

export type ChannelImageSource = 'ai_flow_meta' | 'ai_static' | 'ai_video';
export type ChannelSeriesType = 'anthology_new_topic' | 'connected_series' | 'standalone';
export type ChannelEvaluationLlm = 'gemini_web' | 'chatgpt_web' | 'deepseek' | 'openai';
export type ChannelLongDuration = '1_3_min' | '3_5_min' | '5_8_min' | '8_12_min' | '12_18_min' | '18_28_min';
export type ChannelShortDuration = '30_60_sec' | '60_90_sec' | '90_120_sec' | '120_180_sec';
export type ChannelCharacterSync = 'per_video' | 'consistent_channel' | 'none';
export type ChannelCharacterImageMode = 'ai_draw' | 'upload_photo' | 'studio_preset';
export type ChannelVisualMode = 'blend' | 'image_only' | 'video_only';

export interface ChannelVideoStyle {
  id: string;
  name: string;
  description: string;
  systemPrompt?: string;
}

export interface ChannelProfileConfig {
  /** Tên project / Kênh */
  projectName?: string;
  /** Tên host đại diện */
  hostName?: string;
  /** Mô tả host đại diện để AI tạo */
  hostDescription?: string;
  /** Đường dẫn / URL ảnh host đại diện */
  hostAvatarUrl?: string;
  /** Danh sách nhân vật đại diện kênh */
  channelCharacters?: Array<{ id: string; name: string; descriptionEn: string; avatarUrl?: string }>;
  /** 1. Nguồn hình */
  imageSource: ChannelImageSource;
  /** 2. Kiểu video (bộ não AI) đã chọn */
  videoStyleId: string;
  /** Danh sách các kiểu video tùy biến */
  videoStyles: ChannelVideoStyle[];
  /** 3. Ngách của kênh (gõ cụ thể để khác biệt) */
  channelNiche: string;
  /** 4. Kiểu chuỗi tập (chống trùng chủ đề) */
  seriesType: ChannelSeriesType;
  /** 5. Mô tả chi tiết kênh */
  channelDescription: string;
  /** 6. Định hướng kênh */
  channelOrientation: string;
  /** 7. Master prompt viết kịch bản */
  masterPrompt: string;
  /** 8. Tra cứu dữ kiện trước khi viết */
  researchFactBeforeWrite: boolean;
  /** 9. AI chấm điểm & cải thiện kịch bản */
  evaluationLlm: ChannelEvaluationLlm;
  /** 10. Hook của kênh (câu chốt thương hiệu) */
  channelHook: string;
  /** 11. Độ dài Video dài mục tiêu */
  targetLongDuration: ChannelLongDuration;
  /** 12. Độ dài Shorts mục tiêu */
  targetShortDuration: ChannelShortDuration;
  /** 13. AI provider (văn bản) */
  aiProvider: 'default' | 'chatgpt_web' | 'gemini_web' | 'deepseek' | 'openai';
  /** 14. Giọng đọc (TTS) */
  ttsEngine: 'edge_tts' | 'kokoro_tts';
  /** 15. Giọng cụ thể */
  specificVoice: string;
  /** 16. Đồng bộ nhân vật */
  characterSync: ChannelCharacterSync;
  /** 17. Vai của nhân vật đại diện */
  characterRole: string;
  /** 18. Ảnh nhân vật */
  characterImageMode: ChannelCharacterImageMode;
  /** 19. Profile Chrome của kênh */
  chromeProfile: string;
  /** 20. Tạo ảnh/video bằng */
  visualEngine: 'google_flow' | 'comfyui' | 'mock';
  /** 21. Chế độ hình */
  visualMode: ChannelVisualMode;
  /** 22. Số cảnh video mở đầu */
  videoScenesIntro: number;
  /** 23. Số cảnh video phần thân */
  videoScenesBody: number;
  /** 24. Thời gian ảnh tĩnh min (giây) */
  staticImageDurationMin: number;
  /** 25. Thời gian ảnh tĩnh max (giây) */
  staticImageDurationMax: number;
  /** 26. Model video */
  videoModel: string;
  /** 27. Model ảnh */
  imageModel: string;
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
  /** 6. Channel Profile Settings (Cấu hình Kênh & Bộ não) */
  channelProfile?: ChannelProfileConfig;
}

/** Deep partial type for safe partial updates */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? T[P]
    : T[P] extends ReadonlyArray<infer U>
    ? T[P]
    : NonNullable<T[P]> extends object
    ? DeepPartial<NonNullable<T[P]>>
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

export const DEFAULT_CHANNEL_PROFILE_CONFIG: Readonly<ChannelProfileConfig> = Object.freeze({
  imageSource: 'ai_flow_meta',
  videoStyleId: '',
  videoStyles: [
    {
      id: 'survival_documentary',
      name: 'Sinh tồn & Lịch sử tiền sử',
      description: 'Phong cách kịch tính, chân thực về đời sống và sinh tồn con người thời kỳ cổ xưa',
      systemPrompt: 'Phong cách kể chuyện sinh tồn tiền sử, nhấn mạnh vào sự khắc nghiệt của thiên nhiên, bản năng sinh tồn và khám phá khảo cổ.',
    },
    {
      id: 'science_mystery',
      name: 'Khoa học & Bí ẩn đại dương',
      description: 'Khám phá những hiện tượng khoa học chưa có lời giải và thế giới tự nhiên bí ẩn',
      systemPrompt: 'Phong cách phóng sự tài liệu khoa học khám phá, logic chặt chẽ, tạo cảm giác tò mò và thán phục.',
    },
    {
      id: 'finance_wealth',
      name: 'Tài chính & Kinh tế vĩ mô',
      description: 'Phân tích dòng tiền, sự kiện kinh tế lớn và bài học đầu tư thực chiến',
      systemPrompt: 'Phong cách chuyên gia tài chính sắc bén, góc nhìn thực tế, ngôn từ cuốn hút và có tính cảnh báo.',
    },
  ],
  projectName: '',
  hostName: '',
  hostDescription: '',
  hostAvatarUrl: '',
  channelCharacters: [],
  channelNiche: '',
  seriesType: 'anthology_new_topic',
  channelDescription: '',
  channelOrientation: '',
  masterPrompt: '',
  researchFactBeforeWrite: false,
  evaluationLlm: 'gemini_web',
  channelHook: '',
  targetLongDuration: '3_5_min',
  targetShortDuration: '90_120_sec',
  aiProvider: 'default',
  ttsEngine: 'kokoro_tts',
  specificVoice: 'vi-VN-HoaiMyNeural',
  characterSync: 'per_video',
  characterRole: '',
  characterImageMode: 'ai_draw',
  chromeProfile: 'auto',
  visualEngine: 'google_flow',
  visualMode: 'blend',
  videoScenesIntro: 3,
  videoScenesBody: 10,
  staticImageDurationMin: 5,
  staticImageDurationMax: 8,
  videoModel: 'Omni 1.1 Flash',
  imageModel: '⭐ Nano Banana 2',
});

export const DEFAULT_AI_STUDIO_CONFIG: Readonly<AiStudioConfig> = Object.freeze({
  llm: DEFAULT_LLM_CONFIG,
  voice: DEFAULT_VOICE_CONFIG,
  flowEngine: DEFAULT_FLOW_ENGINE_CONFIG,
  rendering: DEFAULT_RENDERING_CONFIG,
  subtitles: DEFAULT_SUBTITLE_CONFIG,
  channelProfile: DEFAULT_CHANNEL_PROFILE_CONFIG,
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
  status: 'idle' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0 - 100
  gatedMode?: boolean;
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
    blueprint?: IdeaBlueprint;
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
  status: AiStudioStageStatus | 'awaiting_approval';
  message?: string;
  error?: string;
  artifacts?: Partial<PipelineSessionState['artifacts']>;
}

export type PipelineStageStatus = AiStudioStageStatus;
export type PipelineProgressEvent = PipelineProgressPayload;

// Payload and Result contracts for IPC
export interface StartPipelinePayload {
  topic: string;
  blueprint?: IdeaBlueprint;
  gatedMode?: boolean;
  options?: PartialAiStudioConfig;
}

export interface StartPipelineResult {
  sessionId: string;
}

export interface AutoFillIdeaPayload {
  topic: string;
  aspectRatio?: '16:9' | '9:16';
  channelProfile?: Partial<ChannelProfileConfig>;
}

export interface AutoFillIdeaResult {
  title: string;
  hookConcept: string;
  narrativeAngle: string;
  outline: string[];
  thumbnailConcept: string;
  thumbnailPrompt: string;
}

export interface ApproveStagePayload {
  sessionId: string;
  currentStage: number;
  updatedArtifacts?: Partial<PipelineSessionState['artifacts']>;
}

export interface ApproveStageResult {
  success: boolean;
  nextStage?: number;
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

export interface GenerateMasterPromptPayload {
  channelProfile: Partial<ChannelProfileConfig>;
}

export interface GenerateMasterPromptResult {
  masterPrompt: string;
}

