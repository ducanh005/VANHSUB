/**
 * Pipeline Storage & Storyboard Schema Contracts
 * Conforms to spec-pipeline-video-automation.md §1.2, §2 and orchestrator_4/PROJECT.md
 */

// ============================================================================
// 1. Directory & Path Contracts
// ============================================================================

export interface PipelineProjectPaths {
  projectDir: string;
  factsDir: string;      // 00_facts
  scriptDir: string;     // 01_script
  voiceDir: string;      // 02_voice
  timingDir: string;     // 03_timing
  storyboardDir: string; // 04_storyboard
  mediaDir: string;      // 05_media
  styleRefsDir: string;  // style_refs (character_ref.png, background_ref.png, style_manifest.json)
  indexPath: string;     // index.json
  actionLogPath: string; // action_logs.jsonl
}

// ============================================================================
// 2. Index Registry Contracts (spec-pipeline-video-automation.md §1.2)
// ============================================================================

export type PipelineProjectStatus = 'initialized' | 'in_progress' | 'completed' | 'failed';
export type PipelineShotStatus = 'pending' | 'image_ready' | 'video_ready' | 'completed' | 'failed';
export type PipelineActionType = 'click' | 'input' | 'upload' | 'poll' | 'download' | 'settle' | 'probe' | 'storyboard' | 'init' | string;
export type PipelineActionStatus = 'ok' | 'retry' | 'failed';

export interface PipelineActionLogEntry {
  ts: string;
  scene_id?: string;
  shot_id?: string;
  action: PipelineActionType;
  target: string;
  retry: number;
  status: PipelineActionStatus;
  details?: Record<string, any>;
}

export interface PipelineShotMetadata {
  shot_id: string;
  current_image_version: number;
  current_video_version: number;
  start_sec?: number;
  duration_sec?: number;
  assigned_sentences?: number[];
  assigned_scene_ids?: string[];
  dialogue_lines?: string[];
  previous_shot_id?: string;
  image_path?: string;
  image_prompt_used?: string;
  image_generated_at?: string;
  video_path?: string;
  source_image_path?: string;
  motion_note?: string;
  video_generated_at?: string;
  expected_duration_sec?: number;
  actual_duration_sec?: number;
  duration_deviation_pct?: number;
  needs_review?: boolean;
  status: PipelineShotStatus;
  /** Which model was used to generate this shot (e.g. 'banana_pro', 'veo') */
  model_used?: string;
  /** SHA-256 hash of style_manifest.json at generation time — for cache invalidation */
  style_manifest_hash?: string;
  /** Which reference images were uploaded (e.g. ['character_ref.png', 'background_ref.png']) */
  references_used?: string[];
  /** Whether background was sent as uploaded image or baked into text prompt */
  background_sent_as?: 'image' | 'text_prompt';
  /** Google Flow internal asset URL (flow-content.google/image/{id}) for library reuse */
  flow_asset_url?: string;
}

export interface PipelineSceneMetadata {
  scene_id: string;
  narration?: string;
  voice_path?: string;
  voice_duration_sec?: number;
  timing?: {
    start_sec: number;
    end_sec: number;
    duration_sec: number;
  };
  shots: Record<string, PipelineShotMetadata>;
}

export interface PipelineIndexData {
  project_id: string;
  created_at: string;
  updated_at: string;
  status: PipelineProjectStatus;
  /** Project-level Google Flow character reference asset URL for library reuse (backward compat) */
  flow_asset_url?: string;
  /** Individual asset URLs by reference type (e.g. { character: '...', background: '...' }) */
  flow_asset_urls?: Record<string, string>;
  scenes: Record<string, PipelineSceneMetadata>;
  action_logs: PipelineActionLogEntry[];
}

// ============================================================================
// 3. Phase-Specific Intermediate Data Contracts
// ============================================================================

/** 00_facts/facts.json */
export interface PipelineFactItem {
  id: string;
  content: string;
}

export interface PipelineFactsData {
  project_id: string;
  topic?: string;
  facts: PipelineFactItem[];
}

/** 01_script/script.json */
export interface ScriptSceneItem {
  scene_id: string;
  narration: string;
  visual_note?: string;
}

export interface PipelineScriptData {
  scenes: ScriptSceneItem[];
}

/** 03_timing/timing.json */
export interface SceneTimingItem {
  scene_id: string;
  audio_file?: string;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
}

export interface PipelineTimingData {
  project_id: string;
  probed_engine: 'ffprobe' | string;
  scenes: SceneTimingItem[];
  total_duration_sec: number;
}

/** 04_storyboard/storyboard.json */
export type ShotMediaType = 'image' | 'video';
export type ShotConfidence = 'high' | 'medium' | 'low';

export interface StoryboardShotItem {
  shot_id: string;             // Strictly formatted as {scene_id}_shot_{n}
  shot_index?: number;
  start_sec: number;           // Absolute start timestamp on video timeline (from 03_timing)
  duration_sec: number;        // Precise duration in seconds (4.0s - 10.0s)
  expected_duration_sec?: number;
  assigned_sentences: number[]; // 1-based script sentence indices assigned to this shot (e.g. [1, 2])
  assigned_scene_ids: string[]; // Timing scene_ids assigned to this shot (e.g. ['scene_01', 'scene_02'])
  dialogue_lines: string[];    // Dialogue text lines assigned to this shot
  previous_shot_id?: string;   // Reference to preceding shot for continuity
  image_prompt: string;
  motion_note?: string;
  /** AI-decided media type: 'image' (static, Ken Burns) or 'video' (animate via I2V) */
  media_type: ShotMediaType;
  /**
   * Human-readable explanation of why image vs video was chosen.
   * MANDATORY — empty string is not accepted by validateStoryboard().
   */
  reason: string;
  /**
   * AI confidence in the media_type decision.
   * 'low' → user should review this shot manually.
   */
  confidence?: ShotConfidence;
  /**
   * Override the default model for this specific shot.
   * If set, takes priority over model_config.json default.
   * Values: 'banana_pro', 'omni', 'veo', etc.
   */
  preferred_model?: string;
}

export interface StoryboardSceneItem {
  scene_id: string;
  duration_sec: number;
  start_sec?: number;
  end_sec?: number;
  narration?: string;
  assigned_sentences?: number[];
  assigned_scene_ids?: string[];
  shots: StoryboardShotItem[];
}

export interface PipelineStoryboardData {
  project_id: string;
  scenes: StoryboardSceneItem[];
  synthesis?: import('../types').StoryboardSynthesis;
}

// ============================================================================
// 5. Style References & Model Configuration
// ============================================================================

/** style_refs/style_manifest.json — fixed style references for the project */
export type StyleManifestSource = 'ai_generated' | 'user_provided';

export interface StyleManifest {
  /** Relative path from project root: 'style_refs/character_ref.png' */
  character_ref: string;
  /** Relative path from project root: 'style_refs/background_ref.png' */
  background_ref: string;
  /** Text prompt describing character appearance/style — used when image cannot be uploaded */
  character_style_prompt: string;
  /** Text prompt describing background style — used when max_ref_images < 2 */
  background_style_prompt: string;
  /** How the style refs were created */
  source: StyleManifestSource;
  created_at: string;
  updated_at?: string;
}

/** model_config.json — per-project model selection and capabilities */
export interface ModelCapabilities {
  /** Maximum number of reference images this model accepts */
  max_ref_images: number;
  /** Maximum video clip duration in seconds (video models only) */
  max_duration_sec?: number;
  /** Human-readable notes */
  notes?: string;
}

export interface ModelGroupConfig {
  /** Default model name to use for this media type */
  default: string;
  /** Map of model name → capabilities */
  options: Record<string, ModelCapabilities>;
}

export interface ProjectModelConfig {
  image_model: ModelGroupConfig;
  video_model: ModelGroupConfig;
}

// ============================================================================
// 4. Asset Versioning & Idempotency Types
// ============================================================================

export type MediaAssetType = 'img' | 'vid';
export type AssetKind = 'voice' | 'image' | 'video';
export type BackgroundSentAs = 'image' | 'text_prompt';

export interface NextMediaVersionResult {
  version: number;
  filename: string;
  relativePath: string;
  absolutePath: string;
}

