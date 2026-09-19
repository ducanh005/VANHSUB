/**
 * AiStudioStyleRefsService
 *
 * Manages project-level style reference images (character_ref.png, background_ref.png).
 * Enforces the "1 lần duy nhất" (one-time setup per project) contract:
 *   - If style_refs/ already exists and is valid → skip, return existing manifest.
 *   - If user provides images → copy to canonical paths, write manifest.
 *   - If no images → generate via Google Flow T2I, save to canonical paths.
 *
 * All downstream shot generation always reads from the SAME fixed paths:
 *   {projectDir}/style_refs/character_ref.png
 *   {projectDir}/style_refs/background_ref.png
 * regardless of how they were created (AI-generated or user-provided).
 */

import fs from 'fs';
import path from 'path';
import { AiStudioDiskStorageManager, StyleManifest } from '../storage/AiStudioDiskStorageManager';
import { FlowMediaAutomationEngine } from '../../workflow/flow-engine/FlowMediaAutomationEngine';

export interface EnsureStyleRefsOptions {
  storage: AiStudioDiskStorageManager;
  win?: any; // Electron BrowserWindow
  /**
   * Path to user-provided character image.
   * If set, will be copied to style_refs/character_ref.png (Case: user_provided).
   */
  userCharacterImagePath?: string;
  /**
   * Path to user-provided background image.
   * If set, will be copied to style_refs/background_ref.png (Case: user_provided).
   */
  userBackgroundImagePath?: string;
  /**
   * Textual description of character appearance/style.
   * Required if userCharacterImagePath is not provided (used to generate via Flow).
   * Also stored in style_manifest.json as character_style_prompt.
   */
  characterStylePrompt?: string;
  /**
   * Textual description of background style.
   * Required if userBackgroundImagePath is not provided.
   * Also stored in style_manifest.json as background_style_prompt.
   */
  backgroundStylePrompt?: string;
  /** Aspect ratio for AI-generated style reference images */
  aspectRatio?: string;
}

export interface StyleRefsResult {
  manifest: StyleManifest;
  characterRefPath: string;
  backgroundRefPath: string;
  /** True if style refs were already set up — no generation was needed */
  alreadySetUp: boolean;
}

export class AiStudioStyleRefsService {
  private static _instance: AiStudioStyleRefsService;

  private constructor() {}

  public static getInstance(): AiStudioStyleRefsService {
    if (!AiStudioStyleRefsService._instance) {
      AiStudioStyleRefsService._instance = new AiStudioStyleRefsService();
    }
    return AiStudioStyleRefsService._instance;
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Helper an toàn để lưu ảnh từ nhiều định dạng: Base64 Data URL, file:// URL, đường dẫn file cục bộ.
   * Trả về true nếu nạp/ghi file thành công vào targetPath.
   */
  private _saveImageSource(input: string | undefined, targetPath: string): boolean {
    if (!input || typeof input !== 'string' || !input.trim()) return false;
    const trimmed = input.trim();

    try {
      // 1. Trường hợp Base64 Data URL (e.g. data:image/png;base64,...)
      if (trimmed.startsWith('data:image/')) {
        const commaIdx = trimmed.indexOf(',');
        const base64Str = commaIdx >= 0 ? trimmed.slice(commaIdx + 1) : trimmed;
        const buffer = Buffer.from(base64Str, 'base64');
        if (buffer.length > 0) {
          fs.writeFileSync(targetPath, buffer);
          console.log(`[StyleRefsService] 💾 Đã giải mã Base64 Data URL và ghi vào: ${targetPath} (${buffer.length} bytes)`);
          return true;
        }
        return false;
      }

      // 2. Trường hợp file:// URL
      let localPath = trimmed;
      if (localPath.startsWith('file://')) {
        localPath = localPath.replace(/^file:\/\/\/?/, '');
      }
      localPath = path.resolve(localPath);

      // Nếu đường dẫn nguồn chính là targetPath và đã tồn tại hợp lệ
      if (path.resolve(targetPath) === localPath && fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
        return true;
      }

      if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
        fs.copyFileSync(localPath, targetPath);
        console.log(`[StyleRefsService] 📁 Đã sao chép ảnh người dùng cung cấp: "${localPath}" → "${targetPath}"`);
        return true;
      }
    } catch (err: any) {
      console.warn(`[StyleRefsService] Cảnh báo khi lưu ảnh nguồn vào ${targetPath}:`, err?.message || err);
    }
    return false;
  }

  /**
   * Main entry point — ensures style refs are ready before any shot generation.
   *
   * Decision tree:
   * 1. Read style_manifest.json. If it exists AND both image files are valid → return early.
   * 2. If userCharacterImagePath is provided OR character_ref.png exists → Case user_provided.
   * 3. Otherwise → Case ai_generated (requires characterStylePrompt).
   *
   * Throws if setup cannot be completed (missing prompts, Flow error, etc.).
   */
  public async ensureStyleRefs(options: EnsureStyleRefsOptions): Promise<StyleRefsResult> {
    const { storage } = options;

    // Ensure the style_refs directory exists before anything
    storage.ensureDirectories();

    const characterRefPath = storage.getStyleRefPath('character');
    const backgroundRefPath = storage.getStyleRefPath('background');

    // Check 1: Is the manifest already written and images valid on disk?
    const existingManifest = storage.readStyleManifest();
    if (existingManifest && storage.isStyleRefsReady()) {
      console.log('[StyleRefsService] ✅ Style refs already set up — skipping setup.');
      return {
        manifest: existingManifest,
        characterRefPath,
        backgroundRefPath,
        alreadySetUp: true,
      };
    }

    // Check 2: Partial manifest or missing images — log and proceed to rebuild
    if (existingManifest && !storage.isStyleRefsReady()) {
      console.warn('[StyleRefsService] ⚠️ Manifest exists but images missing/invalid — rebuilding style refs.');
    }

    // Kiểm tra xem đã có sẵn ảnh hợp lệ trên đĩa hoặc người dùng có cung cấp nguồn ảnh không
    const hasExistingChar = storage.isFileValidNonEmpty(characterRefPath);
    const hasExistingBg = storage.isFileValidNonEmpty(backgroundRefPath);
    const hasUserChar = Boolean(options.userCharacterImagePath && options.userCharacterImagePath.trim());
    const hasUserBg = Boolean(options.userBackgroundImagePath && options.userBackgroundImagePath.trim());

    // Case A: Người dùng cung cấp ảnh HOẶC file style_refs đã tồn tại sẵn trên đĩa
    if (hasUserChar || hasUserBg || hasExistingChar || hasExistingBg) {
      return this.setupFromUserProvided(options);
    }

    // Case B: Hoàn toàn không có ảnh nào → Chuyển sang AI tự sinh qua Flow T2I
    return this.generateAndSetupStyleRefs(options);
  }

  /**
   * Case A: User has provided reference images.
   * Copies them to canonical paths and writes style_manifest.json.
   * If only one image is provided, the other is generated.
   */
  public async setupFromUserProvided(options: EnsureStyleRefsOptions): Promise<StyleRefsResult> {
    const { storage } = options;
    storage.ensureDirectories();

    const characterRefPath = storage.getStyleRefPath('character');
    const backgroundRefPath = storage.getStyleRefPath('background');
    const charPrompt = options.characterStylePrompt || 'character appearance (user-provided image)';
    const bgPrompt = options.backgroundStylePrompt || 'background style (user-provided image)';

    let charProvidedByUser = false;
    let bgProvidedByUser = false;

    // 1. Xử lý ảnh nhân vật:
    if (options.userCharacterImagePath && this._saveImageSource(options.userCharacterImagePath, characterRefPath)) {
      charProvidedByUser = true;
    } else if (storage.isFileValidNonEmpty(characterRefPath)) {
      charProvidedByUser = true;
      console.log(`[StyleRefsService] ℹ️ Đã tìm thấy ảnh nhân vật có sẵn trên đĩa: "${characterRefPath}"`);
    } else if (options.userCharacterImagePath) {
      console.warn(`[StyleRefsService] ⚠️ userCharacterImagePath không hợp lệ hoặc rỗng: "${options.userCharacterImagePath}"`);
    }

    // 2. Xử lý ảnh bối cảnh:
    if (options.userBackgroundImagePath && this._saveImageSource(options.userBackgroundImagePath, backgroundRefPath)) {
      bgProvidedByUser = true;
    } else if (storage.isFileValidNonEmpty(backgroundRefPath)) {
      bgProvidedByUser = true;
      console.log(`[StyleRefsService] ℹ️ Đã tìm thấy ảnh nền có sẵn trên đĩa: "${backgroundRefPath}"`);
    } else if (options.userBackgroundImagePath) {
      console.warn(`[StyleRefsService] ⚠️ userBackgroundImagePath không hợp lệ hoặc rỗng: "${options.userBackgroundImagePath}"`);
    }

    // 3. Nếu nhân vật vẫn chưa có sau bước nạp ảnh người dùng → Sinh qua Flow T2I kèm log cảnh báo rõ ràng
    if (!storage.isFileValidNonEmpty(characterRefPath)) {
      console.log(
        `[StyleRefsService] ⚠️ Không tìm thấy ảnh nhân vật do người dùng cung cấp tại "${options.userCharacterImagePath || 'none'}" — chuyển sang chế độ AI tự generate qua Flow T2I.`
      );
      if (!options.characterStylePrompt) {
        throw new Error(
          '[StyleRefsService] character_ref.png is missing and no characterStylePrompt provided to generate it.'
        );
      }
      await this._generateSingleStyleRef(options, 'character', options.characterStylePrompt, characterRefPath);
    }

    // 4. Nếu bối cảnh vẫn chưa có sau bước nạp ảnh người dùng → Sinh qua Flow T2I kèm log cảnh báo rõ ràng
    if (!storage.isFileValidNonEmpty(backgroundRefPath)) {
      console.log(
        `[StyleRefsService] ⚠️ Không tìm thấy ảnh nền do người dùng cung cấp tại "${options.userBackgroundImagePath || 'none'}" — chuyển sang chế độ AI tự generate qua Flow T2I.`
      );
      if (!options.backgroundStylePrompt) {
        throw new Error(
          '[StyleRefsService] background_ref.png is missing and no backgroundStylePrompt provided to generate it.'
        );
      }
      await this._generateSingleStyleRef(options, 'background', options.backgroundStylePrompt, backgroundRefPath);
    }

    // Validate final result
    this._validateOrThrow(storage, characterRefPath, backgroundRefPath);

    const isUserProvided = charProvidedByUser || bgProvidedByUser;
    const manifest: StyleManifest = {
      character_ref: 'style_refs/character_ref.png',
      background_ref: 'style_refs/background_ref.png',
      character_style_prompt: charPrompt,
      background_style_prompt: bgPrompt,
      source: isUserProvided ? 'user_provided' : 'ai_generated',
      created_at: new Date().toISOString(),
    };

    storage.saveStyleManifest(manifest);
    console.log(`[StyleRefsService] ✅ Style manifest written (source: ${manifest.source})`);

    return { manifest, characterRefPath, backgroundRefPath, alreadySetUp: false };
  }

  /**
   * Case B: No user-provided images — generate both via Google Flow T2I.
   * Both character and background are generated independently.
   */
  public async generateAndSetupStyleRefs(options: EnsureStyleRefsOptions): Promise<StyleRefsResult> {
    const { storage } = options;
    storage.ensureDirectories();

    const characterRefPath = storage.getStyleRefPath('character');
    const backgroundRefPath = storage.getStyleRefPath('background');

    const charPrompt = options.characterStylePrompt;
    const bgPrompt = options.backgroundStylePrompt;

    console.log(
      `[StyleRefsService] ⚠️ Không tìm thấy ảnh nhân vật do người dùng cung cấp tại "${options.userCharacterImagePath || 'none'}" — chuyển sang chế độ AI tự generate qua Flow T2I.`
    );
    console.log(
      `[StyleRefsService] ⚠️ Không tìm thấy ảnh nền do người dùng cung cấp tại "${options.userBackgroundImagePath || 'none'}" — chuyển sang chế độ AI tự generate qua Flow T2I.`
    );

    if (!charPrompt) {
      throw new Error(
        '[StyleRefsService] characterStylePrompt is required to generate character reference image. ' +
        'Please provide a description of the character appearance and visual style.'
      );
    }
    if (!bgPrompt) {
      throw new Error(
        '[StyleRefsService] backgroundStylePrompt is required to generate background reference image. ' +
        'Please provide a description of the background/environment style.'
      );
    }

    // Generate character reference (character sheet / full body reference)
    const charGenPrompt = `Character reference sheet. ${charPrompt}. Full body view, consistent style, white background, clear details, high quality.`;
    await this._generateSingleStyleRef(options, 'character', charGenPrompt, characterRefPath);

    // Generate background reference
    const bgGenPrompt = `Background environment reference. ${bgPrompt}. Establishing shot, no characters, consistent style, high quality.`;
    await this._generateSingleStyleRef(options, 'background', bgGenPrompt, backgroundRefPath);

    // Validate
    this._validateOrThrow(storage, characterRefPath, backgroundRefPath);

    const manifest: StyleManifest = {
      character_ref: 'style_refs/character_ref.png',
      background_ref: 'style_refs/background_ref.png',
      character_style_prompt: charPrompt,
      background_style_prompt: bgPrompt,
      source: 'ai_generated',
      created_at: new Date().toISOString(),
    };

    storage.saveStyleManifest(manifest);
    console.log('[StyleRefsService] ✅ Style manifest written (source: ai_generated)');

    return { manifest, characterRefPath, backgroundRefPath, alreadySetUp: false };
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Generates a single style reference image via FlowMediaAutomationEngine.generateImageForShot(),
   * then copies the result to the canonical fixed path.
   */
  private async _generateSingleStyleRef(
    options: EnsureStyleRefsOptions,
    type: 'character' | 'background',
    prompt: string,
    targetPath: string
  ): Promise<void> {
    const { storage, win } = options;
    const shotId = `style_ref_${type}`;
    const sceneId = `style_setup`;

    console.log(`[StyleRefsService] Generating ${type} reference via Flow T2I...`);

    const result = await FlowMediaAutomationEngine.generateImageForShot({
      storage,
      win,
      sceneId,
      shotId,
      prompt,
      aspectRatio: options.aspectRatio || '1:1',
      forceRegenerate: true,
    });

    if (!result.success || !result.imagePath) {
      throw new Error(
        `[StyleRefsService] Failed to generate ${type} reference image: ${result.error || 'Unknown error'}`
      );
    }

    // Copy generated image to canonical fixed path
    fs.copyFileSync(result.imagePath, targetPath);
    console.log(`[StyleRefsService] ✅ ${type} ref generated → ${targetPath}`);
  }

  /**
   * Throws a descriptive error if either style ref is missing or invalid after setup.
   */
  private _validateOrThrow(
    storage: AiStudioDiskStorageManager,
    characterRefPath: string,
    backgroundRefPath: string
  ): void {
    if (!storage.isFileValidNonEmpty(characterRefPath)) {
      throw new Error(
        `[StyleRefsService] character_ref.png is missing or empty after setup: "${characterRefPath}"`
      );
    }
    if (!storage.isFileValidNonEmpty(backgroundRefPath)) {
      throw new Error(
        `[StyleRefsService] background_ref.png is missing or empty after setup: "${backgroundRefPath}"`
      );
    }
  }
}

/** Singleton export for convenience */
export const aiStudioStyleRefsService = AiStudioStyleRefsService.getInstance();
