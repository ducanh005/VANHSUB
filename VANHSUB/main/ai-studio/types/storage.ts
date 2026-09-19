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
export interface StoryboardShotItem {
  shot_id: string; // Strictly formatted as {scene_id}_shot_{n}
  shot_index?: number;
  expected_duration_sec?: number;
  image_prompt: string;
  motion_note?: string;
}

export interface StoryboardSceneItem {
  scene_id: string;
  duration_sec: number;
  narration?: string;
  shots: StoryboardShotItem[];
}

export interface PipelineStoryboardData {
  project_id: string;
  scenes: StoryboardSceneItem[];
}

// ============================================================================
// 4. Asset Versioning & Idempotency Types
// ============================================================================

export type MediaAssetType = 'img' | 'vid';
export type AssetKind = 'voice' | 'image' | 'video';

export interface NextMediaVersionResult {
  version: number;
  filename: string;
  relativePath: string;
  absolutePath: string;
}
