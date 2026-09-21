/**
 * AiStudioDiskStorageManager
 * Single Source of Truth for Local Disk Workspace
 * Conforms to spec-pipeline-video-automation.md §1.1, §1.2, §1.5 and orchestrator_4/PROJECT.md
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  PipelineProjectPaths,
  PipelineIndexData,
  PipelineSceneMetadata,
  PipelineShotMetadata,
  PipelineActionLogEntry,
  PipelineProjectStatus,
  PipelineFactsData,
  PipelineScriptData,
  PipelineTimingData,
  PipelineStoryboardData,
  MediaAssetType,
  AssetKind,
  NextMediaVersionResult,
  StyleManifest,
  ProjectModelConfig,
} from '../types/storage';

// Re-export all types for convenient consumption
export * from '../types/storage';

export interface StorageManagerOptions {
  baseDir?: string;
  customMediaDir?: string;
  autoInitialize?: boolean;
  exactProjectDir?: boolean;
}

export class AiStudioDiskStorageManager {
  private readonly _projectId: string;
  private readonly _projectDir: string;
  private readonly _paths: PipelineProjectPaths;

  constructor(projectId: string, options: StorageManagerOptions = {}) {
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('AiStudioDiskStorageManager requires a valid string projectId');
    }
    this._projectId = projectId.trim();

    // Determine base project directory
    const customBase = options.baseDir || path.join(process.cwd(), 'flow_outputs', 'projects');
    this._projectDir = options.exactProjectDir || path.basename(customBase) === this._projectId
      ? customBase
      : path.join(customBase, this._projectId);

    const mediaDir = options.customMediaDir && options.customMediaDir.trim()
      ? path.resolve(options.customMediaDir.trim())
      : path.join(this._projectDir, '05_media');

    this._paths = {
      projectDir: this._projectDir,
      factsDir: path.join(this._projectDir, '00_facts'),
      scriptDir: path.join(this._projectDir, '01_script'),
      voiceDir: path.join(this._projectDir, '02_voice'),
      timingDir: path.join(this._projectDir, '03_timing'),
      storyboardDir: path.join(this._projectDir, '04_storyboard'),
      mediaDir,
      styleRefsDir: path.join(this._projectDir, 'style_refs'),
      indexPath: path.join(this._projectDir, 'index.json'),
      actionLogPath: path.join(this._projectDir, 'action_logs.jsonl'),
    };

    if (options.autoInitialize !== false) {
      this.ensureDirectories();
      this.ensureIndex();
    }
  }

  // ==========================================================================
  // Getters
  // ==========================================================================

  public get projectId(): string {
    return this._projectId;
  }

  public get projectDir(): string {
    return this._projectDir;
  }

  public get paths(): Readonly<PipelineProjectPaths> {
    return this._paths;
  }

  // ==========================================================================
  // Static Factory
  // ==========================================================================

  public static forProject(projectId: string, baseDir?: string, customMediaDir?: string): AiStudioDiskStorageManager {
    return new AiStudioDiskStorageManager(projectId, { baseDir, customMediaDir });
  }

  public static initialize(projectId: string, baseDir?: string): AiStudioDiskStorageManager {
    const mgr = new AiStudioDiskStorageManager(projectId, { baseDir, autoInitialize: true });
    return mgr;
  }

  // ==========================================================================
  // Directory & Index Initialization
  // ==========================================================================

  /**
   * Initializes or ensures the 6 subdirectories layout:
   * 00_facts, 01_script, 02_voice, 03_timing, 04_storyboard, 05_media
   */
  public ensureDirectories(): PipelineProjectPaths {
    const dirs = [
      this._paths.projectDir,
      this._paths.factsDir,
      this._paths.scriptDir,
      this._paths.voiceDir,
      this._paths.timingDir,
      this._paths.storyboardDir,
      this._paths.mediaDir,
      this._paths.styleRefsDir,
    ];

    for (const d of dirs) {
      if (!fs.existsSync(d)) {
        fs.mkdirSync(d, { recursive: true });
      }
    }

    return this._paths;
  }

  /**
   * Ensures index.json exists with initial schema if not already present.
   */
  public ensureIndex(): PipelineIndexData {
    this.ensureDirectories();
    if (fs.existsSync(this._paths.indexPath)) {
      try {
        const raw = fs.readFileSync(this._paths.indexPath, 'utf-8');
        const parsed = JSON.parse(raw) as PipelineIndexData;
        if (parsed && typeof parsed === 'object') {
          // Guarantee scenes and action_logs exist
          if (!parsed.scenes) parsed.scenes = {};
          if (!Array.isArray(parsed.action_logs)) parsed.action_logs = [];
          return parsed;
        }
      } catch (err) {
        // If file is corrupted, preserve backup and re-initialize
        const backupPath = `${this._paths.indexPath}.corrupt.${Date.now()}`;
        try { fs.copyFileSync(this._paths.indexPath, backupPath); } catch {}
      }
    }

    const initialData: PipelineIndexData = {
      project_id: this._projectId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'initialized',
      scenes: {},
      action_logs: [],
    };

    this.writeIndex(initialData);
    return initialData;
  }

  // ==========================================================================
  // Atomic File Operations
  // ==========================================================================

  /**
   * Writes content to a file atomically via a temporary file + rename.
   * Handles Windows file locking / EPERM edge cases gracefully.
   */
  public writeAtomic(filePath: string, content: string | Buffer): void {
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
    fs.writeFileSync(tmpPath, content);

    try {
      fs.renameSync(tmpPath, filePath);
    } catch (err: any) {
      // Windows fallback if renameSync fails on existing target
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          fs.renameSync(tmpPath, filePath);
          return;
        } catch {
          // Fallback to copy and unlink
          fs.copyFileSync(tmpPath, filePath);
          try { fs.unlinkSync(tmpPath); } catch {}
          return;
        }
      }
      // If tmp still exists, clean up
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
      throw err;
    }
  }

  // ==========================================================================
  // Master index.json Registry
  // ==========================================================================

  /**
   * Reads index.json. If missing, ensures and returns initialized data.
   */
  public readIndex(): PipelineIndexData {
    if (!fs.existsSync(this._paths.indexPath)) {
      return this.ensureIndex();
    }
    try {
      const raw = fs.readFileSync(this._paths.indexPath, 'utf-8');
      const parsed = JSON.parse(raw) as PipelineIndexData;
      if (!parsed || typeof parsed !== 'object') {
        return this.ensureIndex();
      }
      if (!parsed.scenes) parsed.scenes = {};
      if (!Array.isArray(parsed.action_logs)) parsed.action_logs = [];
      return parsed;
    } catch (err) {
      // Corrupt or partial file: delegate to ensureIndex() to preserve backup and re-initialize
      return this.ensureIndex();
    }
  }

  /**
   * Atomically writes updated index.json, maintaining updated_at timestamp.
   */
  public writeIndex(data: PipelineIndexData): void {
    data.project_id = this._projectId;
    data.updated_at = new Date().toISOString();
    if (!data.created_at) data.created_at = data.updated_at;
    if (!data.scenes) data.scenes = {};
    if (!Array.isArray(data.action_logs)) data.action_logs = [];

    const jsonStr = JSON.stringify(data, null, 2);
    this.writeAtomic(this._paths.indexPath, jsonStr);
  }

  /**
   * Lấy URL/ID nội bộ của ảnh tham chiếu trên Google Flow (flow-content.google/image/{id})
   * để tái sử dụng từ Thư viện Asset mà không cần upload lại.
   * Hỗ trợ lưu và lấy riêng biệt cho 'character' và 'background'.
   */
  public getFlowAssetUrl(refType: 'character' | 'background' | string = 'character'): string | undefined {
    const index = this.readIndex();
    if (index.flow_asset_urls && index.flow_asset_urls[refType]) {
      return index.flow_asset_urls[refType];
    }
    if (refType === 'character') {
      return index.flow_asset_url;
    }
    return undefined;
  }

  /**
   * Lưu URL/ID nội bộ của ảnh tham chiếu trên Google Flow vào index.json.
   * Lưu vào flow_asset_urls[refType] và đồng bộ flow_asset_url cho character.
   */
  public setFlowAssetUrl(url: string, refType: 'character' | 'background' | string = 'character'): void {
    if (!url || typeof url !== 'string') return;
    const index = this.readIndex();
    if (!index.flow_asset_urls) {
      index.flow_asset_urls = {};
    }
    index.flow_asset_urls[refType] = url.trim();
    if (refType === 'character') {
      index.flow_asset_url = url.trim();
    }
    this.writeIndex(index);
  }

  /**
   * Updates project overall status in index.json.
   */
  public setProjectStatus(status: PipelineProjectStatus): void {
    const idx = this.readIndex();
    idx.status = status;
    this.writeIndex(idx);
  }

  /**
   * Updates or merges scene metadata into index.json.
   */
  public updateSceneMetadata(sceneId: string, meta: Partial<PipelineSceneMetadata>): void {
    const idx = this.readIndex();
    const existing = idx.scenes[sceneId] || {
      scene_id: sceneId,
      shots: {},
    };

    idx.scenes[sceneId] = {
      ...existing,
      ...meta,
      scene_id: sceneId,
      shots: {
        ...(existing.shots || {}),
        ...(meta.shots || {}),
      },
    };

    this.writeIndex(idx);
  }

  /**
   * Retrieves scene metadata from index.json.
   */
  public getSceneMetadata(sceneId: string): PipelineSceneMetadata | undefined {
    const idx = this.readIndex();
    return idx.scenes[sceneId];
  }

  /**
   * Updates or merges shot metadata for a specific scene into index.json.
   */
  public updateShotMetadata(sceneId: string, shotId: string, meta: Partial<PipelineShotMetadata>): void {
    const idx = this.readIndex();
    const existingScene = idx.scenes[sceneId] || {
      scene_id: sceneId,
      shots: {},
    };

    const existingShot = existingScene.shots?.[shotId] || {
      shot_id: shotId,
      current_image_version: 0,
      current_video_version: 0,
      status: 'pending' as const,
    };

    existingScene.shots = existingScene.shots || {};
    existingScene.shots[shotId] = {
      ...existingShot,
      ...meta,
      shot_id: shotId,
    };

    idx.scenes[sceneId] = existingScene;
    this.writeIndex(idx);
  }

  /**
   * Retrieves shot metadata from index.json.
   */
  public getShotMetadata(sceneId: string, shotId: string): PipelineShotMetadata | undefined {
    const scene = this.getSceneMetadata(sceneId);
    return scene?.shots?.[shotId];
  }

  // ==========================================================================
  // Action Logging (§3)
  // ==========================================================================

  /**
   * Appends an action log entry to both index.json and action_logs.jsonl.
   */
  public appendActionLog(entry: PipelineActionLogEntry): void {
    if (!entry.ts) {
      entry.ts = new Date().toISOString();
    }

    // 1. Append to action_logs.jsonl
    try {
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this._paths.actionLogPath, line, 'utf-8');
    } catch (err) {
      // Non-fatal if log file append fails
    }

    // 2. Append to index.json action_logs array
    try {
      const idx = this.readIndex();
      idx.action_logs.push(entry);
      this.writeIndex(idx);
    } catch (err) {
      // Non-fatal
    }
  }

  // ==========================================================================
  // Idempotency Checking (§1.5)
  // ==========================================================================

  /**
   * Checks if an asset already exists on local disk and is non-empty (size > 0).
   * Verifies against index.json records and direct file inspection.
   */
  public isAssetValid(sceneId: string, shotId?: string, assetType: AssetKind = 'image'): boolean {
    const idx = this.readIndex();
    const scene = idx.scenes[sceneId];

    if (assetType === 'voice') {
      // Check scene voice
      const candidatePaths = [
        scene?.voice_path ? this.resolvePath(scene.voice_path) : null,
        path.join(this._paths.voiceDir, `${sceneId}.mp3`),
      ].filter(Boolean) as string[];

      for (const p of candidatePaths) {
        if (this.isFileValidNonEmpty(p)) {
          return true;
        }
      }
      return false;
    }

    if (!shotId) {
      return false;
    }

    const shot = scene?.shots?.[shotId];

    if (assetType === 'image') {
      if (shot?.image_path) {
        const fullPath = this.resolvePath(shot.image_path);
        if (this.isFileValidNonEmpty(fullPath)) {
          return true;
        }
      }
      // Check mediaDir for any {shotId}_img_v*.png
      const files = this.scanMediaFilesForShot(shotId, 'img');
      return files.length > 0;
    }

    if (assetType === 'video') {
      if (shot?.video_path) {
        const fullPath = this.resolvePath(shot.video_path);
        if (this.isFileValidNonEmpty(fullPath)) {
          return true;
        }
      }
      // Check mediaDir for any {shotId}_vid_v*.mp4
      const files = this.scanMediaFilesForShot(shotId, 'vid');
      return files.length > 0;
    }

    return false;
  }

  /**
   * Direct check on any file path: exists and size > 0.
   */
  public isFileValidNonEmpty(filePath: string): boolean {
    try {
      if (!filePath || !fs.existsSync(filePath)) return false;
      const stat = fs.statSync(filePath);
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Versioning (§1.5)
  // ==========================================================================

  /**
   * Computes the next version number and filenames for a media asset.
   * Preserves previous versions for rollback/history.
   * Formula: {shot_id}_img_v{n}.png or {shot_id}_vid_v{n}.mp4
   */
  public getNextMediaVersion(shotId: string, type: MediaAssetType): NextMediaVersionResult {
    const existingVersions = this.getExistingMediaVersions(shotId, type);
    const maxVersionOnDisk = existingVersions.length > 0 ? Math.max(...existingVersions) : 0;

    // Also check index.json current version
    let maxVersionInIndex = 0;
    const idx = this.readIndex();
    for (const sc of Object.values(idx.scenes)) {
      const shot = sc.shots?.[shotId];
      if (shot) {
        const v = type === 'img' ? shot.current_image_version : shot.current_video_version;
        if (typeof v === 'number' && v > maxVersionInIndex) {
          maxVersionInIndex = v;
        }
      }
    }

    const nextVersion = Math.max(maxVersionOnDisk, maxVersionInIndex) + 1;
    const ext = type === 'img' ? 'png' : 'mp4';
    const filename = `${shotId}_${type}_v${nextVersion}.${ext}`;
    const relativePath = path.join('05_media', filename).replace(/\\/g, '/');
    const absolutePath = path.join(this._paths.mediaDir, filename);

    return {
      version: nextVersion,
      filename,
      relativePath,
      absolutePath,
    };
  }

  /**
   * Returns current active/latest version for a media asset, or null if none exists.
   */
  public getCurrentMediaVersion(shotId: string, type: MediaAssetType): NextMediaVersionResult | null {
    const existingVersions = this.getExistingMediaVersions(shotId, type);
    if (existingVersions.length === 0) {
      return null;
    }
    const currentVersion = Math.max(...existingVersions);
    const ext = type === 'img' ? 'png' : 'mp4';
    const filename = `${shotId}_${type}_v${currentVersion}.${ext}`;
    const relativePath = path.join('05_media', filename).replace(/\\/g, '/');
    const absolutePath = path.join(this._paths.mediaDir, filename);

    return {
      version: currentVersion,
      filename,
      relativePath,
      absolutePath,
    };
  }

  /**
   * Scans 05_media/ for all versions of a given shot and type.
   */
  private getExistingMediaVersions(shotId: string, type: MediaAssetType): number[] {
    if (!fs.existsSync(this._paths.mediaDir)) {
      return [];
    }
    const escapedShotId = shotId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedShotId}_${type}_v(\\d+)\\.(png|mp4|webp|jpg)$`, 'i');

    const files = fs.readdirSync(this._paths.mediaDir);
    const versions: number[] = [];

    for (const f of files) {
      const match = f.match(pattern);
      if (match && match[1]) {
        const v = parseInt(match[1], 10);
        if (!isNaN(v) && v > 0) {
          // Verify file size > 0
          const fullPath = path.join(this._paths.mediaDir, f);
          if (this.isFileValidNonEmpty(fullPath)) {
            versions.push(v);
          }
        }
      }
    }

    return versions;
  }

  private scanMediaFilesForShot(shotId: string, type: MediaAssetType): string[] {
    if (!fs.existsSync(this._paths.mediaDir)) return [];
    const escapedShotId = shotId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedShotId}_${type}_v\\d+\\.(png|mp4|webp|jpg)$`, 'i');
    return fs.readdirSync(this._paths.mediaDir)
      .filter(f => pattern.test(f))
      .filter(f => this.isFileValidNonEmpty(path.join(this._paths.mediaDir, f)));
  }

  // ==========================================================================
  // Phase Intermediate Data Storage Helpers
  // ==========================================================================

  // 00_facts
  public saveFacts(data: PipelineFactsData): string {
    const factsPath = path.join(this._paths.factsDir, 'facts.json');
    data.project_id = this._projectId;
    this.writeAtomic(factsPath, JSON.stringify(data, null, 2));
    return factsPath;
  }

  public readFacts(): PipelineFactsData | null {
    const factsPath = path.join(this._paths.factsDir, 'facts.json');
    if (!fs.existsSync(factsPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(factsPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  // 01_script
  public saveScript(data: PipelineScriptData): string {
    const scriptPath = path.join(this._paths.scriptDir, 'script.json');
    this.writeAtomic(scriptPath, JSON.stringify(data, null, 2));
    return scriptPath;
  }

  public readScript(): PipelineScriptData | null {
    const scriptPath = path.join(this._paths.scriptDir, 'script.json');
    if (!fs.existsSync(scriptPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(scriptPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  // 02_voice
  public getVoiceAudioPath(sceneId: string): string {
    return path.join(this._paths.voiceDir, `${sceneId}.mp3`);
  }

  public getVoiceAudioRelativePath(sceneId: string): string {
    return `02_voice/${sceneId}.mp3`;
  }

  // 03_timing
  public saveTiming(data: PipelineTimingData): string {
    const timingPath = path.join(this._paths.timingDir, 'timing.json');
    data.project_id = this._projectId;
    this.writeAtomic(timingPath, JSON.stringify(data, null, 2));
    return timingPath;
  }

  public readTiming(): PipelineTimingData | null {
    const timingPath = path.join(this._paths.timingDir, 'timing.json');
    if (!fs.existsSync(timingPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(timingPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  // 04_storyboard
  public saveStoryboard(data: PipelineStoryboardData): string {
    const storyboardPath = path.join(this._paths.storyboardDir, 'storyboard.json');
    data.project_id = this._projectId;
    this.writeAtomic(storyboardPath, JSON.stringify(data, null, 2));
    return storyboardPath;
  }

  public readStoryboard(): PipelineStoryboardData | null {
    const storyboardPath = path.join(this._paths.storyboardDir, 'storyboard.json');
    if (!fs.existsSync(storyboardPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(storyboardPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  // Path resolution utility
  public resolvePath(targetPath: string): string {
    if (path.isAbsolute(targetPath)) {
      return targetPath;
    }
    const normalized = targetPath.replace(/\\/g, '/');
    if (normalized.startsWith('05_media/')) {
      const filename = path.basename(targetPath);
      return path.resolve(this._paths.mediaDir, filename);
    }
    return path.resolve(this._projectDir, targetPath);
  }

  // ==========================================================================
  // Style References (style_refs/ directory)
  // ==========================================================================

  /**
   * Returns the absolute path of a style reference file.
   * Always points to the same fixed location regardless of how the file was created.
   * type='character' → style_refs/character_ref.png
   * type='background' → style_refs/background_ref.png
   */
  public getStyleRefPath(type: 'character' | 'background'): string {
    return path.join(this._paths.styleRefsDir, `${type}_ref.png`);
  }

  /**
   * Reads style_refs/style_manifest.json.
   * Returns null if not present or corrupt.
   */
  public readStyleManifest(): StyleManifest | null {
    const manifestPath = path.join(this._paths.styleRefsDir, 'style_manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as StyleManifest;
    } catch {
      return null;
    }
  }

  /**
   * Atomically writes style_refs/style_manifest.json.
   */
  public saveStyleManifest(data: StyleManifest): void {
    this.ensureDirectories();
    const manifestPath = path.join(this._paths.styleRefsDir, 'style_manifest.json');
    this.writeAtomic(manifestPath, JSON.stringify(data, null, 2));
  }

  /**
   * Returns SHA-256 hex hash of style_manifest.json content.
   * Used as cache key in index.json shot metadata (style_manifest_hash field).
   * Returns empty string if manifest does not exist.
   */
  public hashStyleManifest(): string {
    const manifestPath = path.join(this._paths.styleRefsDir, 'style_manifest.json');
    if (!fs.existsSync(manifestPath)) return '';
    try {
      const content = fs.readFileSync(manifestPath);
      return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    } catch {
      return '';
    }
  }

  /**
   * Validates both style ref images exist on disk and are non-empty.
   */
  public isStyleRefsReady(): boolean {
    const charPath = this.getStyleRefPath('character');
    const bgPath = this.getStyleRefPath('background');
    return this.isFileValidNonEmpty(charPath) && this.isFileValidNonEmpty(bgPath);
  }

  // ==========================================================================
  // Model Configuration (model_config.json)
  // ==========================================================================

  /**
   * Reads model_config.json from project root.
   * Returns null if not present or corrupt.
   */
  public readModelConfig(): ProjectModelConfig | null {
    const configPath = path.join(this._paths.projectDir, 'model_config.json');
    if (!fs.existsSync(configPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as ProjectModelConfig;
    } catch {
      return null;
    }
  }

  /**
   * Atomically writes model_config.json to project root.
   */
  public saveModelConfig(data: ProjectModelConfig): void {
    const configPath = path.join(this._paths.projectDir, 'model_config.json');
    this.writeAtomic(configPath, JSON.stringify(data, null, 2));
  }
}
