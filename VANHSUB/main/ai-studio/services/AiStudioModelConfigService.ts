/**
 * AiStudioModelConfigService
 *
 * Reads model_config.json (per-project or global) and resolves
 * the correct model + capabilities for each shot.
 *
 * Priority order for model selection:
 *   1. shot.preferred_model (per-shot override in storyboard.json)
 *   2. model_config.json default for the media type
 *   3. Built-in hardcoded default (banana_pro / veo)
 *
 * This service is the ONLY place where model names are resolved —
 * no other code should hardcode model names.
 */

import fs from 'fs';
import { AiStudioDiskStorageManager, ProjectModelConfig, ModelCapabilities } from '../storage/AiStudioDiskStorageManager';

/** Built-in default model_config — used when project has no model_config.json */
export const DEFAULT_MODEL_CONFIG: ProjectModelConfig = {
  image_model: {
    default: 'banana_pro',
    options: {
      banana_pro: {
        max_ref_images: 3,
        notes: 'Ưu tiên độ chi tiết cao, hỗ trợ nhiều reference images nhất',
      },
      omni: {
        max_ref_images: 2,
        notes: 'Balanced quality/speed, hỗ trợ 2 reference images',
      },
      nano: {
        max_ref_images: 1,
        notes: 'Nhanh, rẻ, chỉ hỗ trợ 1 reference image',
      },
    },
  },
  video_model: {
    default: 'veo',
    options: {
      veo: {
        max_duration_sec: 8,
        max_ref_images: 1,
        notes: 'Veo 2 — tối đa 8s/clip, 1 reference image (source frame)',
      },
    },
  },
};

export interface ResolvedModelInfo {
  /** Resolved model name (e.g. 'banana_pro', 'veo') */
  modelName: string;
  /** Maximum reference images this model accepts */
  maxRefImages: number;
  /** Maximum video clip duration in seconds (video models only) */
  maxDurationSec?: number;
  /** Additional notes about the model */
  notes?: string;
  /** Source of model selection */
  source: 'shot_preferred_model' | 'config_default' | 'builtin_default';
}

export class AiStudioModelConfigService {
  private static _instance: AiStudioModelConfigService;

  private constructor() {}

  public static getInstance(): AiStudioModelConfigService {
    if (!AiStudioModelConfigService._instance) {
      AiStudioModelConfigService._instance = new AiStudioModelConfigService();
    }
    return AiStudioModelConfigService._instance;
  }

  // ============================================================================
  // Config Bootstrap
  // ============================================================================

  /**
   * Returns the model config for the project.
   * If model_config.json doesn't exist, creates it from DEFAULT_MODEL_CONFIG and returns it.
   * Merges built-in defaults with project overrides so new model fields are always available.
   */
  public getOrCreateModelConfig(storage: AiStudioDiskStorageManager): ProjectModelConfig {
    const existing = storage.readModelConfig();

    if (!existing) {
      // First time — write default config to disk so user can customize it
      storage.saveModelConfig(DEFAULT_MODEL_CONFIG);
      console.log('[ModelConfigService] Created default model_config.json');
      return DEFAULT_MODEL_CONFIG;
    }

    // Merge: ensure any model in defaults that's missing from project config is added
    const merged: ProjectModelConfig = {
      image_model: {
        default: existing.image_model?.default || DEFAULT_MODEL_CONFIG.image_model.default,
        options: {
          ...DEFAULT_MODEL_CONFIG.image_model.options,
          ...(existing.image_model?.options || {}),
        },
      },
      video_model: {
        default: existing.video_model?.default || DEFAULT_MODEL_CONFIG.video_model.default,
        options: {
          ...DEFAULT_MODEL_CONFIG.video_model.options,
          ...(existing.video_model?.options || {}),
        },
      },
    };

    return merged;
  }

  // ============================================================================
  // Model Resolution
  // ============================================================================

  /**
   * Resolves the model to use for a single shot.
   *
   * @param config      The resolved ProjectModelConfig (from getOrCreateModelConfig).
   * @param mediaType   'image' or 'video' — matches shot.media_type.
   * @param preferredModel  Optional shot-level override (shot.preferred_model).
   * @returns ResolvedModelInfo with model name + capabilities.
   */
  public resolveModelForShot(
    config: ProjectModelConfig,
    mediaType: 'image' | 'video',
    preferredModel?: string
  ): ResolvedModelInfo {
    const group = mediaType === 'video' ? config.video_model : config.image_model;

    // Priority 1: shot-level preferred_model
    if (preferredModel) {
      const caps = group.options[preferredModel];
      if (caps) {
        return {
          modelName: preferredModel,
          maxRefImages: caps.max_ref_images,
          maxDurationSec: caps.max_duration_sec,
          notes: caps.notes,
          source: 'shot_preferred_model',
        };
      }
      console.warn(
        `[ModelConfigService] preferred_model "${preferredModel}" not found in model_config for ${mediaType}. ` +
        `Falling back to config default: "${group.default}".`
      );
    }

    // Priority 2: config default
    const defaultModelName = group.default;
    const defaultCaps = group.options[defaultModelName];
    if (defaultCaps) {
      return {
        modelName: defaultModelName,
        maxRefImages: defaultCaps.max_ref_images,
        maxDurationSec: defaultCaps.max_duration_sec,
        notes: defaultCaps.notes,
        source: 'config_default',
      };
    }

    // Priority 3: built-in hardcoded fallback (should never be needed)
    const builtinGroup = mediaType === 'video'
      ? DEFAULT_MODEL_CONFIG.video_model
      : DEFAULT_MODEL_CONFIG.image_model;
    const builtinName = builtinGroup.default;
    const builtinCaps = builtinGroup.options[builtinName] as ModelCapabilities;

    console.warn(
      `[ModelConfigService] Config default model "${defaultModelName}" not found in options. ` +
      `Using builtin fallback: "${builtinName}".`
    );

    return {
      modelName: builtinName,
      maxRefImages: builtinCaps.max_ref_images,
      maxDurationSec: builtinCaps.max_duration_sec,
      notes: builtinCaps.notes,
      source: 'builtin_default',
    };
  }

  // ============================================================================
  // Validation Helpers
  // ============================================================================

  /**
   * Validates that a video shot's expected duration does not exceed the model's max_duration_sec.
   * Returns an error string if violation detected, null if OK.
   *
   * Note: This is a DETECTION-ONLY check. The fix (multi-clip splitting) must have been done
   * in the Storyboard Generation stage. This stage only reports the error, does NOT auto-split.
   */
  public validateVideoDuration(
    modelInfo: ResolvedModelInfo,
    shotId: string,
    expectedDurationSec: number
  ): string | null {
    if (!modelInfo.maxDurationSec) return null; // Model has no duration limit
    if (expectedDurationSec <= modelInfo.maxDurationSec) return null;

    return (
      `[ModelConfigService] ERROR: Shot "${shotId}" requires ${expectedDurationSec}s ` +
      `but model "${modelInfo.modelName}" max_duration_sec is ${modelInfo.maxDurationSec}s. ` +
      `This should have been split in the Storyboard Generation stage. ` +
      `Skipping this shot to avoid corrupt output.`
    );
  }

  /**
   * Computes which reference image paths to upload and how to handle background
   * based on the model's max_ref_images capability.
   *
   * Returns:
   *   - refsToUpload: array of absolute paths to upload (1 or 2 items)
   *   - backgroundSentAs: 'image' if bg was uploaded, 'text_prompt' if baked into text
   */
  public resolveReferenceUploads(
    modelInfo: ResolvedModelInfo,
    characterRefPath: string,
    backgroundRefPath: string
  ): { refsToUpload: string[]; backgroundSentAs: 'image' | 'text_prompt' } {
    const isFileValid = (p: string) => {
      try {
        return Boolean(p && fs.existsSync(p) && fs.statSync(p).size > 0);
      } catch {
        return false;
      }
    };

    const hasChar = isFileValid(characterRefPath);
    const hasBg = isFileValid(backgroundRefPath);

    if (modelInfo.maxRefImages >= 2) {
      if (hasChar && hasBg) {
        return {
          refsToUpload: [characterRefPath, backgroundRefPath],
          backgroundSentAs: 'image',
        };
      }
      if (hasChar && !hasBg) {
        return {
          refsToUpload: [characterRefPath],
          backgroundSentAs: 'text_prompt',
        };
      }
      if (!hasChar && hasBg) {
        return {
          refsToUpload: [backgroundRefPath],
          backgroundSentAs: 'image',
        };
      }
      return {
        refsToUpload: [],
        backgroundSentAs: 'text_prompt',
      };
    }

    // max_ref_images == 1 → only character; background goes into text prompt
    return {
      refsToUpload: hasChar ? [characterRefPath] : [],
      backgroundSentAs: 'text_prompt',
    };
  }

  /**
   * Builds the final composite text prompt for a shot, following the fixed composition order:
   *   [character_style_prompt]
   *   + [background_style_prompt — ONLY if background was NOT sent as image]
   *   + [shot image_prompt]
   *   + [motion_note — ONLY if media_type is 'video']
   */
  public buildCompositePrompt(params: {
    characterStylePrompt: string;
    backgroundStylePrompt: string;
    imagePrompt: string;
    motionNote?: string;
    mediaType: 'image' | 'video';
    backgroundSentAs: 'image' | 'text_prompt';
  }): string {
    const parts: string[] = [];

    // Part 1: always include character style, sanitized of rigid static pose keywords
    const rawChar = params.characterStylePrompt || '';
    const cleanChar = rawChar
      .replace(/\b(studio portrait|portrait photo|close-up portrait|headshot|portrait)\b/gi, 'appearance')
      .replace(/\b(looking directly into camera|looking straight at camera|looking at camera|facing camera|front view)\b/gi, '')
      .replace(/\b(neutral expression|expressionless)\b/gi, '')
      .replace(/\b(isolated on white background|isolated background|plain white background)\b/gi, '')
      .replace(/\b(centered composition|centered framing)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .replace(/^,\s*|,\s*$/g, '');

    if (cleanChar.trim()) {
      parts.push(cleanChar.trim());
    }

    // Part 2: background style — ONLY if not sent as image reference
    if (params.backgroundSentAs === 'text_prompt' && params.backgroundStylePrompt.trim()) {
      parts.push(params.backgroundStylePrompt.trim());
    }

    // Part 3: shot-specific prompt (always included)
    if (params.imagePrompt.trim()) {
      parts.push(params.imagePrompt.trim());
    }

    // Part 4: motion note — ONLY for video shots
    if (params.mediaType === 'video' && params.motionNote?.trim()) {
      parts.push(params.motionNote.trim());
    }

    return parts.join('. ');
  }
}

/** Singleton export */
export const aiStudioModelConfigService = AiStudioModelConfigService.getInstance();
