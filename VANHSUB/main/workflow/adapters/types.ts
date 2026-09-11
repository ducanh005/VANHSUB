import type { ExecutionContext } from '../types';

export interface VideoGenParams {
  prompt: string;
  initFrameUrl?: string; // Reference frame (last-frame chaining)
  characterRefUrls?: string[];
  styleConfig?: any;
  seed?: number;
  durationSeconds: number;
  aspectRatio?: string;
  fps?: number;
  modelVariant?: string;
}

export interface VideoGenResult {
  videoUrl: string;
  lastFrameUrl: string;
  durationSeconds: number;
  width?: number;
  height?: number;
}

export interface ImageGenParams {
  prompt: string;
  characterRefUrls?: string[];
  aspectRatio?: string;
  steps?: number;
  cfgScale?: number;
}

export interface DirectorPromptParams {
  idea: string;
  tone?: string;
  lighting?: string;
  characterName?: string;
}

export interface DirectorPromptResult {
  prompt: string;
  negativePrompt: string;
  camera: string;
}

export interface ModelAdapter {
  provider: string;
  generateVideo(params: VideoGenParams, ctx: ExecutionContext): Promise<VideoGenResult>;
  generateImage?(params: ImageGenParams, ctx: ExecutionContext): Promise<{ imageUrl: string }>;
  directPrompt?(params: DirectorPromptParams, ctx: ExecutionContext): Promise<DirectorPromptResult>;
}
