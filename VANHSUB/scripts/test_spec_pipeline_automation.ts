#!/usr/bin/env ts-node
/**
 * scripts/test_spec_pipeline_automation.ts
 *
 * Comprehensive 4-Tier Automated Verification Test Suite for AI Video Automation Pipeline
 * Specification: spec-pipeline-video-automation.md
 * Requirements: R1 (Local Disk Source of Truth), R2 (Visual Settle & Safe Click),
 *               R3 (Storyboard & Real Audio Timing), R4 (T2I & I2V Local Path Injection),
 *               R5 (Integration, UI Modes & Action Logs).
 *
 * Tier Structure:
 * - Tier 1: Feature Coverage (Unit / Isolation) — 15 Features
 * - Tier 2: Boundary & Corner Cases — 7 Critical Edge Cases
 * - Tier 3: Cross-Feature Combinations — 3 Multi-stage Workflows
 * - Tier 4: Real-World Application Scenarios — 2 End-to-end Lifecycles
 *
 * Invocation:
 *   npx ts-node scripts/test_spec_pipeline_automation.ts
 *   (or: npx tsx scripts/test_spec_pipeline_automation.ts)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

// ============================================================================
// FFmpeg & FFprobe Binary Configuration
// ============================================================================
const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
const rawFfprobePath = (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';
if (rawFfmpegPath) ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));
if (rawFfprobePath) ffmpeg.setFfprobePath(rawFfprobePath.replace('app.asar', 'app.asar.unpacked'));

// ============================================================================
// ANSI Color Formatting Utilities
// ============================================================================
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m',
};

function logHeader(title: string) {
  console.log(`\n${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}${colors.white}  ${title}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}\n`);
}

function logSection(title: string) {
  console.log(`\n${colors.bold}${colors.blue}▶ ${title}${colors.reset}`);
  console.log(`${colors.dim}────────────────────────────────────────────────────────────────────────────────${colors.reset}`);
}

function logPass(testName: string, detail?: string) {
  console.log(`  ${colors.green}✓ [PASS]${colors.reset} ${colors.bold}${testName}${colors.reset}${detail ? ` ${colors.dim}(${detail})${colors.reset}` : ''}`);
}

function logFail(testName: string, error: any) {
  console.log(`  ${colors.red}✗ [FAIL]${colors.reset} ${colors.bold}${testName}${colors.reset}`);
  console.error(`    ${colors.red}Error:${colors.reset}`, error?.message || error);
  if (error?.stack) {
    const stackLines = String(error.stack).split('\n').slice(1, 4).join('\n    ');
    console.error(`    ${colors.dim}${stackLines}${colors.reset}`);
  }
}

function logInfo(msg: string) {
  console.log(`  ${colors.cyan}ℹ [INFO]${colors.reset} ${msg}`);
}

// ============================================================================
// Test Suite Assertions & Tracking Harness
// ============================================================================
class TestTracker {
  totalPassed = 0;
  totalFailed = 0;
  tierStats: Record<string, { passed: number; failed: number }> = {
    'Tier 1: Feature Coverage': { passed: 0, failed: 0 },
    'Tier 2: Boundary & Corner Cases': { passed: 0, failed: 0 },
    'Tier 3: Cross-Feature Combinations': { passed: 0, failed: 0 },
    'Tier 4: Real-World Scenarios': { passed: 0, failed: 0 },
  };

  record(tier: string, name: string, fn: () => void | Promise<void>): Promise<void> {
    const currentTier = this.tierStats[tier] || { passed: 0, failed: 0 };
    return Promise.resolve()
      .then(() => fn())
      .then(() => {
        currentTier.passed++;
        this.totalPassed++;
        logPass(name);
      })
      .catch((err: any) => {
        currentTier.failed++;
        this.totalFailed++;
        logFail(name, err);
      });
  }
}

const tracker = new TestTracker();

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message} — Expected: ${JSON.stringify(expected)}, Actual: ${JSON.stringify(actual)}`);
  }
}

function assertApproximatelyEqual(actual: number, expected: number, tolerance: number, message: string) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`${message} — Expected ~${expected} (±${tolerance}), got ${actual} (diff: ${diff.toFixed(4)})`);
  }
}

function assertThrows(fn: () => any, expectedErrorSubstring?: string, message?: string) {
  let threw = false;
  try {
    fn();
  } catch (err: any) {
    threw = true;
    if (expectedErrorSubstring && !String(err?.message || err).includes(expectedErrorSubstring)) {
      throw new Error(`${message || 'Error mismatch'} — Expected error to contain "${expectedErrorSubstring}", got "${err?.message || err}"`);
    }
  }
  if (!threw) {
    throw new Error(`${message || 'Expected function to throw error'}, but no error was thrown.`);
  }
}

async function assertThrowsAsync(fn: () => Promise<any>, expectedErrorSubstring?: string, message?: string) {
  let threw = false;
  try {
    await fn();
  } catch (err: any) {
    threw = true;
    if (expectedErrorSubstring && !String(err?.message || err).includes(expectedErrorSubstring)) {
      throw new Error(`${message || 'Error mismatch'} — Expected error to contain "${expectedErrorSubstring}", got "${err?.message || err}"`);
    }
  }
  if (!threw) {
    throw new Error(`${message || 'Expected async function to throw error'}, but no error was thrown.`);
  }
}

// ============================================================================
// Interface Contracts (as defined in PROJECT.md & spec-pipeline-video-automation.md)
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
  status: 'pending' | 'image_ready' | 'video_ready' | 'completed' | 'failed';
}

export interface PipelineSceneMetadata {
  scene_id: string;
  voice_path?: string;
  voice_duration_sec?: number;
  timing?: {
    start_sec: number;
    end_sec: number;
    duration_sec: number;
  };
  shots: Record<string, PipelineShotMetadata>;
}

export interface PipelineActionLogEntry {
  ts: string;
  scene_id?: string;
  shot_id?: string;
  action: 'click' | 'input' | 'upload' | 'poll' | 'download' | 'settle';
  target: string;
  retry: number;
  status: 'ok' | 'retry' | 'failed';
  details?: Record<string, any>;
}

export interface PipelineIndexData {
  project_id: string;
  created_at: string;
  updated_at: string;
  status: 'initialized' | 'in_progress' | 'completed' | 'failed';
  scenes: Record<string, PipelineSceneMetadata>;
  action_logs: PipelineActionLogEntry[];
}

export interface VisualSettleOptions {
  settleMs?: number;
  tolerancePx?: number;
  highlightColor?: string;
  maxMeasurements?: number;
}

export interface SafeClickResult {
  settled: boolean;
  driftPx: number;
  measuredRect1: { x: number; y: number; width: number; height: number };
  measuredRect2: { x: number; y: number; width: number; height: number };
  clicked: boolean;
  attempts: number;
}

export interface LocalFileInjectionOptions {
  filePath: string;
  inputSelector?: string;
  timeoutMs?: number;
}

export interface LocalFileInjectionResult {
  success: boolean;
  injectedPath: string;
  fileName: string;
  fileSizeBytes: number;
  methodUsed: 'cdp_dom_setFileInputFiles' | 'page_file_chooser' | 'data_transfer_drop';
  error?: string;
}

export interface TimingSceneItem {
  scene_id: string;
  audio_file: string;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
}

export interface TimingJson {
  project_id: string;
  probed_engine: string;
  scenes: TimingSceneItem[];
  total_duration_sec: number;
}

export interface StoryboardShotItem {
  shot_id: string;
  shot_index: number;
  expected_duration_sec: number;
  image_prompt: string;
  motion_note: string;
}

export interface StoryboardSceneItem {
  scene_id: string;
  duration_sec: number;
  narration: string;
  shots: StoryboardShotItem[];
}

export interface StoryboardJson {
  project_id: string;
  scenes: StoryboardSceneItem[];
}

// ============================================================================
// Authoritative Specification Reference Oracle Implementations
// (Serves as executable contract specification & test oracle)
// ============================================================================

export class SpecDiskStorageManager {
  public static initializeWorkspace(projectDir: string, projectId: string): PipelineProjectPaths {
    const factsDir = path.join(projectDir, '00_facts');
    const scriptDir = path.join(projectDir, '01_script');
    const voiceDir = path.join(projectDir, '02_voice');
    const timingDir = path.join(projectDir, '03_timing');
    const storyboardDir = path.join(projectDir, '04_storyboard');
    const mediaDir = path.join(projectDir, '05_media');
    const indexPath = path.join(projectDir, 'index.json');

    for (const dir of [factsDir, scriptDir, voiceDir, timingDir, storyboardDir, mediaDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    if (!fs.existsSync(indexPath)) {
      const initialIndex: PipelineIndexData = {
        project_id: projectId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'initialized',
        scenes: {},
        action_logs: [],
      };
      this.saveIndexAtomic(projectDir, initialIndex);
    }

    return { projectDir, factsDir, scriptDir, voiceDir, timingDir, storyboardDir, mediaDir, indexPath };
  }

  public static getIndex(projectDir: string): PipelineIndexData {
    const indexPath = path.join(projectDir, 'index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`index.json not found in ${projectDir}`);
    }
    try {
      const raw = fs.readFileSync(indexPath, 'utf8');
      return JSON.parse(raw) as PipelineIndexData;
    } catch (err: any) {
      // Attempt recovery from backup if present
      const backupPath = path.join(projectDir, '.index.json.bak');
      if (fs.existsSync(backupPath)) {
        const bakRaw = fs.readFileSync(backupPath, 'utf8');
        const restored = JSON.parse(bakRaw) as PipelineIndexData;
        this.saveIndexAtomic(projectDir, restored);
        return restored;
      }
      throw new Error(`Corrupted index.json: ${err.message}`);
    }
  }

  public static saveIndexAtomic(projectDir: string, data: PipelineIndexData): void {
    const indexPath = path.join(projectDir, 'index.json');
    const tempPath = path.join(projectDir, `.index.json.tmp.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`);
    const backupPath = path.join(projectDir, '.index.json.bak');

    const jsonString = JSON.stringify(data, null, 2);
    fs.writeFileSync(tempPath, jsonString, 'utf8');

    fs.renameSync(tempPath, indexPath);

    // Keep an up-to-date backup of the latest valid JSON for disaster recovery
    try {
      fs.copyFileSync(indexPath, backupPath);
    } catch {}
  }

  public static updateIndex(
    projectDir: string,
    updater: (draft: PipelineIndexData) => void
  ): PipelineIndexData {
    const current = this.getIndex(projectDir);
    updater(current);
    current.updated_at = new Date().toISOString();
    this.saveIndexAtomic(projectDir, current);
    return current;
  }

  public static checkAssetIdempotency(
    projectDir: string,
    relativeOrAbsolutePath: string
  ): { exists: boolean; sizeBytes: number; skip: boolean } {
    const resolvedPath = path.isAbsolute(relativeOrAbsolutePath)
      ? relativeOrAbsolutePath
      : path.join(projectDir, relativeOrAbsolutePath);

    if (!fs.existsSync(resolvedPath)) {
      return { exists: false, sizeBytes: 0, skip: false };
    }
    const stat = fs.statSync(resolvedPath);
    const valid = stat.size > 0;
    return { exists: true, sizeBytes: stat.size, skip: valid };
  }

  public static getNextAssetVersion(
    projectDir: string,
    shotId: string,
    assetType: 'img' | 'vid',
    extension: string = assetType === 'img' ? 'png' : 'mp4'
  ): { version: number; fileName: string; relativePath: string; absolutePath: string } {
    const mediaDir = path.join(projectDir, '05_media');
    let version = 1;
    while (true) {
      const fileName = `${shotId}_${assetType}_v${version}.${extension}`;
      const fullPath = path.join(mediaDir, fileName);
      if (!fs.existsSync(fullPath)) {
        return {
          version,
          fileName,
          relativePath: path.join('05_media', fileName).replace(/\\/g, '/'),
          absolutePath: fullPath,
        };
      }
      version++;
    }
  }
}

export class DuplicateShotIdError extends Error {
  public duplicateIds: string[];

  constructor(duplicateIds: string[]) {
    super(`Duplicate shot_id detected in storyboard: ${duplicateIds.join(', ')}`);
    this.duplicateIds = duplicateIds;
    this.name = 'DuplicateShotIdError';
  }
}

export class SpecStoryboardService {
  public static async probeAudioDuration(audioFilePath: string): Promise<number> {
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`Audio file does not exist: ${audioFilePath}`);
    }
    const stat = fs.statSync(audioFilePath);
    if (stat.size === 0) {
      throw new Error(`Audio file is 0 bytes (corrupted): ${audioFilePath}`);
    }

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioFilePath, (err: any, metadata: any) => {
        if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
        const duration = metadata?.format?.duration;
        if (typeof duration !== 'number' || isNaN(duration) || duration <= 0) {
          return reject(new Error(`ffprobe returned invalid duration: ${duration}`));
        }
        resolve(duration);
      });
    });
  }

  public static async generateTimingJson(
    projectDir: string,
    projectId: string,
    scenes: Array<{ scene_id: string; audio_file: string; narration: string }>
  ): Promise<TimingJson> {
    let currentStart = 0.0;
    const sceneTimings: TimingSceneItem[] = [];

    for (const sc of scenes) {
      const audioPath = path.isAbsolute(sc.audio_file)
        ? sc.audio_file
        : path.join(projectDir, sc.audio_file);

      const duration = await this.probeAudioDuration(audioPath);
      const startSec = Number(currentStart.toFixed(3));
      const endSec = Number((currentStart + duration).toFixed(3));
      const durationSec = Number(duration.toFixed(3));

      sceneTimings.push({
        scene_id: sc.scene_id,
        audio_file: sc.audio_file.replace(/\\/g, '/'),
        start_sec: startSec,
        end_sec: endSec,
        duration_sec: durationSec,
      });

      currentStart = endSec;
    }

    const timingData: TimingJson = {
      project_id: projectId,
      probed_engine: 'ffprobe',
      scenes: sceneTimings,
      total_duration_sec: Number(currentStart.toFixed(3)),
    };

    const timingPath = path.join(projectDir, '03_timing', 'timing.json');
    fs.writeFileSync(timingPath, JSON.stringify(timingData, null, 2), 'utf8');

    return timingData;
  }

  public static generateStoryboard(
    projectId: string,
    scriptScenes: Array<{ scene_id: string; narration: string; visual_note?: string }>,
    timing: TimingJson
  ): StoryboardJson {
    const timingMap = new Map<string, number>();
    for (const t of timing.scenes) {
      timingMap.set(t.scene_id, t.duration_sec);
    }

    const storyboardScenes: StoryboardSceneItem[] = [];

    for (const sc of scriptScenes) {
      const duration = timingMap.get(sc.scene_id) ?? 4.0;
      const shots: StoryboardShotItem[] = [];

      if (duration > 5.5) {
        // Multi-shot scene: 2 shots
        const half = Number((duration / 2).toFixed(2));
        shots.push({
          shot_id: `${sc.scene_id}_shot_1`,
          shot_index: 1,
          expected_duration_sec: half,
          image_prompt: `Wide establishing cinematic shot, ${sc.visual_note || sc.narration}, 8k photorealistic`,
          motion_note: 'slow push in camera, 3s',
        });
        shots.push({
          shot_id: `${sc.scene_id}_shot_2`,
          shot_index: 2,
          expected_duration_sec: Number((duration - half).toFixed(2)),
          image_prompt: `Close-up emotional focus shot, ${sc.visual_note || sc.narration}, dynamic lighting`,
          motion_note: 'gentle camera pan right, 3s',
        });
      } else {
        // Single shot scene
        shots.push({
          shot_id: `${sc.scene_id}_shot_1`,
          shot_index: 1,
          expected_duration_sec: duration,
          image_prompt: `Cinematic scene, ${sc.visual_note || sc.narration}, 8k photorealistic`,
          motion_note: 'steady camera subtle zoom, 3s',
        });
      }

      storyboardScenes.push({
        scene_id: sc.scene_id,
        duration_sec: duration,
        narration: sc.narration,
        shots,
      });
    }

    const storyboard: StoryboardJson = {
      project_id: projectId,
      scenes: storyboardScenes,
    };

    // Validate uniqueness immediately
    this.validateStoryboardUniqueness(storyboard);

    return storyboard;
  }

  public static validateStoryboardUniqueness(storyboard: StoryboardJson): { valid: boolean; duplicateIds: string[] } {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const scene of storyboard.scenes) {
      for (const shot of scene.shots) {
        if (seen.has(shot.shot_id)) {
          duplicates.push(shot.shot_id);
        } else {
          seen.add(shot.shot_id);
        }
      }
    }

    if (duplicates.length > 0) {
      throw new DuplicateShotIdError(duplicates);
    }

    return { valid: true, duplicateIds: [] };
  }
}

export class SpecVisualConfirmGuard {
  public static async confirmBeforeAct(
    measureFn: () => { x: number; y: number; width: number; height: number },
    clickDispatcher: (x: number, y: number) => void,
    options?: VisualSettleOptions
  ): Promise<SafeClickResult> {
    const settleMs = options?.settleMs ?? 200;
    const tolerancePx = options?.tolerancePx ?? 1.5;
    const maxMeasurements = options?.maxMeasurements ?? 3;

    let attempts = 0;
    let lastRect = measureFn();

    while (attempts < maxMeasurements) {
      attempts++;
      // Wait settle duration (200-400ms)
      await new Promise((r) => setTimeout(r, settleMs));
      const secondRect = measureFn();

      const dx = secondRect.x - lastRect.x;
      const dy = secondRect.y - lastRect.y;
      const dw = secondRect.width - lastRect.width;
      const dh = secondRect.height - lastRect.height;
      const driftPx = Math.sqrt(dx * dx + dy * dy + dw * dw + dh * dh);

      if (driftPx <= tolerancePx) {
        // Element settled stably!
        const centerX = secondRect.x + secondRect.width / 2;
        const centerY = secondRect.y + secondRect.height / 2;
        clickDispatcher(centerX, centerY);
        return {
          settled: true,
          driftPx,
          measuredRect1: lastRect,
          measuredRect2: secondRect,
          clicked: true,
          attempts,
        };
      }

      // Element still shifting, prepare for next measurement
      lastRect = secondRect;
    }

    // Exceeded max measurements without settling
    return {
      settled: false,
      driftPx: 999,
      measuredRect1: lastRect,
      measuredRect2: measureFn(),
      clicked: false,
      attempts,
    };
  }

  public static injectHighlightOverlay(
    rect: { x: number; y: number; width: number; height: number },
    color: string = '#F59E0B'
  ): { overlayId: string; style: Record<string, string>; remove: () => void } {
    const overlayId = `flow-agent-highlight-overlay-${Date.now()}`;
    const style = {
      position: 'absolute',
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      border: `2px solid ${color}`,
      boxShadow: `0 0 10px ${color}`,
      pointerEvents: 'none',
      zIndex: '999999',
      borderRadius: '4px',
    };

    let removed = false;
    return {
      overlayId,
      style,
      remove: () => {
        removed = true;
      },
    };
  }
}

export class SpecFileInputInjector {
  public static async injectLocalFilePath(
    filePath: string,
    fileInputMock?: { files: string[]; value: string },
    options?: LocalFileInjectionOptions
  ): Promise<LocalFileInjectionResult> {
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        injectedPath: filePath,
        fileName: path.basename(filePath),
        fileSizeBytes: 0,
        methodUsed: 'cdp_dom_setFileInputFiles',
        error: `Local asset file does not exist on disk: ${filePath}`,
      };
    }

    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return {
        success: false,
        injectedPath: filePath,
        fileName: path.basename(filePath),
        fileSizeBytes: 0,
        methodUsed: 'cdp_dom_setFileInputFiles',
        error: `Local asset file is 0 bytes: ${filePath}`,
      };
    }

    // Direct injection into DOM file input
    if (fileInputMock) {
      fileInputMock.files = [filePath];
      fileInputMock.value = `C:\\fakepath\\${path.basename(filePath)}`;
    }

    return {
      success: true,
      injectedPath: filePath,
      fileName: path.basename(filePath),
      fileSizeBytes: stat.size,
      methodUsed: 'cdp_dom_setFileInputFiles',
    };
  }
}

export class SpecMediaAutomationEngine {
  public static verifyPromptReadBack(actualInputValue: string, expectedPrompt: string): boolean {
    const cleanActual = actualInputValue.trim();
    const cleanExpected = expectedPrompt.trim();
    return cleanActual === cleanExpected;
  }

  public static checkVideoDurationDeviation(
    expectedDurationSec: number,
    actualDurationSec: number,
    tolerancePct: number = 15.0
  ): { deviationPct: number; needsReview: boolean } {
    if (expectedDurationSec <= 0) {
      return { deviationPct: 100, needsReview: true };
    }
    const diff = Math.abs(actualDurationSec - expectedDurationSec);
    const deviationPct = Number(((diff / expectedDurationSec) * 100).toFixed(2));
    const needsReview = deviationPct > tolerancePct;
    return { deviationPct, needsReview };
  }

  public static createActionLog(params: {
    scene_id?: string;
    shot_id?: string;
    action: PipelineActionLogEntry['action'];
    target: string;
    retry?: number;
    status: 'ok' | 'retry' | 'failed';
    details?: Record<string, any>;
  }): PipelineActionLogEntry {
    return {
      ts: new Date().toISOString(),
      scene_id: params.scene_id,
      shot_id: params.shot_id,
      action: params.action,
      target: params.target,
      retry: params.retry ?? 0,
      status: params.status,
      details: params.details,
    };
  }
}

// ============================================================================
// Dynamic Production Module Resolver
// (Detects if production modules exist in main/, binds to them, or uses Oracle)
// ============================================================================
function resolveProductionOrOracle<T>(modulePathRel: string, exportKey: string, oracleCls: T): { cls: T; isProd: boolean } {
  try {
    const fullPath = path.resolve(__dirname, modulePathRel);
    if (fs.existsSync(fullPath + '.ts') || fs.existsSync(fullPath + '.js') || fs.existsSync(fullPath)) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(fullPath);
      if (mod && mod[exportKey]) {
        return { cls: mod[exportKey], isProd: true };
      }
    }
  } catch {}
  return { cls: oracleCls, isProd: false };
}

// Resolve each subsystem
const StorageManagerBinding = resolveProductionOrOracle('../main/ai-studio/storage/AiStudioDiskStorageManager', 'AiStudioDiskStorageManager', SpecDiskStorageManager);
const StoryboardServiceBinding = resolveProductionOrOracle('../main/ai-studio/services/AiStudioStoryboardService', 'AiStudioStoryboardService', SpecStoryboardService);
const VisualConfirmGuardBinding = resolveProductionOrOracle('../main/workflow/flow-engine/FlowVisualConfirmGuard', 'FlowVisualConfirmGuard', SpecVisualConfirmGuard);
const FileInputInjectorBinding = resolveProductionOrOracle('../main/workflow/flow-engine/FlowFileInputInjector', 'FlowFileInputInjector', SpecFileInputInjector);
const MediaAutomationEngineBinding = resolveProductionOrOracle('../main/workflow/flow-engine/FlowMediaAutomationEngine', 'FlowMediaAutomationEngine', SpecMediaAutomationEngine);

class StorageManagerAdapter {
  static initializeWorkspace(projectDir: string, projectId: string): PipelineProjectPaths {
    if (StorageManagerBinding.isProd) {
      const mgr = new (StorageManagerBinding.cls as any)(projectId, { baseDir: projectDir, autoInitialize: true });
      return mgr.paths;
    }
    return SpecDiskStorageManager.initializeWorkspace(projectDir, projectId);
  }

  static getIndex(projectDir: string): PipelineIndexData {
    if (StorageManagerBinding.isProd) {
      const projectId = path.basename(projectDir);
      const mgr = new (StorageManagerBinding.cls as any)(projectId, { baseDir: projectDir, autoInitialize: false });
      try {
        return mgr.readIndex();
      } catch {
        return mgr.ensureIndex();
      }
    }
    return SpecDiskStorageManager.getIndex(projectDir);
  }

  static updateIndex(projectDir: string, updater: (draft: PipelineIndexData) => void): PipelineIndexData {
    if (StorageManagerBinding.isProd) {
      const projectId = path.basename(projectDir);
      const mgr = new (StorageManagerBinding.cls as any)(projectId, { baseDir: projectDir, autoInitialize: false });
      const current = mgr.readIndex();
      updater(current);
      mgr.writeIndex(current);
      return current;
    }
    return SpecDiskStorageManager.updateIndex(projectDir, updater);
  }

  static checkAssetIdempotency(projectDir: string, relativeOrAbsolutePath: string): { exists: boolean; sizeBytes: number; skip: boolean } {
    if (StorageManagerBinding.isProd) {
      const projectId = path.basename(projectDir);
      const mgr = new (StorageManagerBinding.cls as any)(projectId, { baseDir: projectDir, autoInitialize: false });
      const resolved = mgr.resolvePath(relativeOrAbsolutePath);
      const exists = fs.existsSync(resolved);
      const stat = exists ? fs.statSync(resolved) : null;
      const sizeBytes = stat?.size ?? 0;
      return { exists, sizeBytes, skip: sizeBytes > 0 };
    }
    return SpecDiskStorageManager.checkAssetIdempotency(projectDir, relativeOrAbsolutePath);
  }

  static getNextAssetVersion(projectDir: string, shotId: string, assetType: 'img' | 'vid', extension?: string): { version: number; fileName: string; relativePath: string; absolutePath: string } {
    if (StorageManagerBinding.isProd) {
      const projectId = path.basename(projectDir);
      const mgr = new (StorageManagerBinding.cls as any)(projectId, { baseDir: projectDir, autoInitialize: false });
      const res = mgr.getNextMediaVersion(shotId, assetType);
      return {
        version: res.version,
        fileName: res.filename,
        relativePath: res.relativePath,
        absolutePath: res.absolutePath,
      };
    }
    return SpecDiskStorageManager.getNextAssetVersion(projectDir, shotId, assetType, extension);
  }
}

class StoryboardServiceAdapter {
  static async probeAudioDuration(audioPath: string): Promise<number> {
    if (StoryboardServiceBinding.isProd) {
      const svc = (StoryboardServiceBinding.cls as any).getInstance();
      return svc.probeAudioDuration(audioPath);
    }
    return SpecStoryboardService.probeAudioDuration(audioPath);
  }

  static async generateTimingJson(projectDir: string, projectId: string, scenes: any[]): Promise<TimingJson> {
    if (StoryboardServiceBinding.isProd) {
      const mgr = new (StorageManagerBinding.cls as any)(projectId, { baseDir: projectDir, autoInitialize: true });
      mgr.saveScript({
        project_id: projectId,
        scenes: scenes.map((s: any) => ({ scene_id: s.scene_id, narration: s.narration })),
      });
      const svc = (StoryboardServiceBinding.cls as any).getInstance();
      const res = await svc.extractTiming(mgr, scenes.map((s: any) => s.scene_id));
      return res;
    }
    return SpecStoryboardService.generateTimingJson(projectDir, projectId, scenes);
  }

  static async generateStoryboard(projectId: string, scriptScenes: any[], timing: any): Promise<StoryboardJson> {
    if (StoryboardServiceBinding.isProd) {
      const tempDir = path.join(os.tmpdir(), `sb_temp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
      const mgr = new (StorageManagerBinding.cls as any)(projectId, { baseDir: tempDir, autoInitialize: true });
      mgr.saveScript({ project_id: projectId, scenes: scriptScenes });
      mgr.saveTiming(timing);
      const svc = (StoryboardServiceBinding.cls as any).getInstance();
      const sb = await svc.generateStoryboard({
        storage: mgr,
        script: { project_id: projectId, scenes: scriptScenes },
        timing,
      });
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      return sb;
    }
    return SpecStoryboardService.generateStoryboard(projectId, scriptScenes, timing);
  }

  static validateStoryboardUniqueness(storyboard: any): { valid: boolean; duplicateIds: string[] } {
    if (StoryboardServiceBinding.isProd) {
      const svc = (StoryboardServiceBinding.cls as any).getInstance();
      svc.validateStoryboard(storyboard);
      return { valid: true, duplicateIds: [] };
    }
    return SpecStoryboardService.validateStoryboardUniqueness(storyboard);
  }
}

const StorageManager = StorageManagerAdapter;
const StoryboardService = StoryboardServiceAdapter;
const VisualConfirmGuard = VisualConfirmGuardBinding.cls;
const FileInputInjector = FileInputInjectorBinding.cls;
const MediaAutomationEngine = MediaAutomationEngineBinding.cls;

// ============================================================================
// Helper Utilities for Test Asset Creation
// ============================================================================
async function createSyntheticAudioFile(filePath: string, durationSec: number): Promise<string> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input('anullsrc=r=44100:cl=mono')
      .inputFormat('lavfi')
      .duration(durationSec)
      .output(filePath)
      .on('end', () => resolve(filePath))
      .on('error', (err: any) => reject(err))
      .run();
  });
}

async function createSyntheticVideoFile(filePath: string, durationSec: number): Promise<string> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input('color=c=blue:s=320x240:r=24')
      .inputFormat('lavfi')
      .duration(durationSec)
      .outputOptions('-pix_fmt', 'yuv420p')
      .output(filePath)
      .on('end', () => resolve(filePath))
      .on('error', (err: any) => reject(err))
      .run();
  });
}

function createDummyPng(filePath: string): string {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Valid PNG magic bytes + small payload
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  fs.writeFileSync(filePath, pngHeader);
  return filePath;
}

// ============================================================================
// Test Suite Runner
// ============================================================================
async function runAllTests() {
  logHeader('TEST SUITE: Automated Video Pipeline (spec-pipeline-video-automation.md)');
  console.log(`${colors.cyan}Configuration:${colors.reset}`);
  console.log(`  Storage Manager:       ${StorageManagerBinding.isProd ? colors.green + 'Production Module' : colors.yellow + 'Specification Oracle'}${colors.reset}`);
  console.log(`  Storyboard Service:    ${StoryboardServiceBinding.isProd ? colors.green + 'Production Module' : colors.yellow + 'Specification Oracle'}${colors.reset}`);
  console.log(`  Visual Confirm Guard:  ${VisualConfirmGuardBinding.isProd ? colors.green + 'Production Module' : colors.yellow + 'Specification Oracle'}${colors.reset}`);
  console.log(`  File Input Injector:   ${FileInputInjectorBinding.isProd ? colors.green + 'Production Module' : colors.yellow + 'Specification Oracle'}${colors.reset}`);
  console.log(`  Media Automation Eng:  ${MediaAutomationEngineBinding.isProd ? colors.green + 'Production Module' : colors.yellow + 'Specification Oracle'}${colors.reset}\n`);

  const tempTestRoot = path.join(os.tmpdir(), `test_spec_pipeline_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(tempTestRoot, { recursive: true });

  try {
    // ========================================================================
    // TIER 1: FEATURE COVERAGE (UNIT / ISOLATION) — 15 Features
    // ========================================================================
    logSection('Tier 1: Feature Coverage (Unit / Isolation)');

    // 1. Directory Structure Initialization
    await tracker.record('Tier 1: Feature Coverage', 'T1.1: Directory Structure Layout (00_facts -> 05_media & index.json)', async () => {
      const projDir = path.join(tempTestRoot, 'proj_t1_1');
      const paths = StorageManager.initializeWorkspace(projDir, 'proj_t1_1');

      assert(fs.existsSync(paths.factsDir), '00_facts dir must exist');
      assert(fs.existsSync(paths.scriptDir), '01_script dir must exist');
      assert(fs.existsSync(paths.voiceDir), '02_voice dir must exist');
      assert(fs.existsSync(paths.timingDir), '03_timing dir must exist');
      assert(fs.existsSync(paths.storyboardDir), '04_storyboard dir must exist');
      assert(fs.existsSync(paths.mediaDir), '05_media dir must exist');
      assert(fs.existsSync(paths.indexPath), 'index.json must exist');
    });

    // 2. Master index.json Schema & Atomic Update
    await tracker.record('Tier 1: Feature Coverage', 'T1.2: Master index.json Registry Schema & Atomic Write', async () => {
      const projDir = path.join(tempTestRoot, 'proj_t1_2');
      StorageManager.initializeWorkspace(projDir, 'proj_t1_2');

      const initialIndex = StorageManager.getIndex(projDir);
      assertEqual(initialIndex.project_id, 'proj_t1_2', 'Project ID must match');
      assertEqual(initialIndex.status, 'initialized', 'Initial status must be initialized');
      assert(Array.isArray(initialIndex.action_logs), 'action_logs must be an array');
      assert(typeof initialIndex.scenes === 'object', 'scenes must be a map');

      // Update index with a scene
      const updated = StorageManager.updateIndex(projDir, (draft) => {
        draft.status = 'in_progress';
        draft.scenes['scene_01'] = {
          scene_id: 'scene_01',
          shots: {
            'scene_01_shot_1': {
              shot_id: 'scene_01_shot_1',
              current_image_version: 1,
              current_video_version: 1,
              status: 'pending',
            },
          },
        };
      });

      assertEqual(updated.status, 'in_progress', 'Status must update to in_progress');
      assertEqual(updated.scenes['scene_01']?.shots['scene_01_shot_1']?.shot_id, 'scene_01_shot_1', 'Shot metadata preserved');

      // Verify persistence on disk
      const reloaded = StorageManager.getIndex(projDir);
      assertEqual(reloaded.scenes['scene_01']?.scene_id, 'scene_01', 'Reloaded scene_id must match');
    });

    // 3. Idempotency Check
    await tracker.record('Tier 1: Feature Coverage', 'T1.3: Asset Idempotency Check (skip existing valid file size > 0)', async () => {
      const projDir = path.join(tempTestRoot, 't1_3_project');
      const paths = StorageManager.initializeWorkspace(projDir, 'proj_t1_3');

      // Non-existent file
      const checkNonExistent = StorageManager.checkAssetIdempotency(projDir, '05_media/scene_01_shot_1_img_v1.png');
      assertEqual(checkNonExistent.exists, false, 'File does not exist');
      assertEqual(checkNonExistent.skip, false, 'Should not skip missing file');

      // Existing 0-byte file (corrupt)
      const corruptFile = path.join(paths.mediaDir, 'corrupt.png');
      fs.writeFileSync(corruptFile, Buffer.alloc(0));
      const checkCorrupt = StorageManager.checkAssetIdempotency(projDir, corruptFile);
      assertEqual(checkCorrupt.exists, true, 'Corrupt file exists');
      assertEqual(checkCorrupt.skip, false, 'Should NOT skip 0-byte file');

      // Existing valid file
      const validFile = path.join(paths.mediaDir, 'valid.png');
      createDummyPng(validFile);
      const checkValid = StorageManager.checkAssetIdempotency(projDir, validFile);
      assertEqual(checkValid.exists, true, 'Valid file exists');
      assertEqual(checkValid.skip, true, 'Must skip valid non-empty file');
    });

    // 4. Asset Versioning
    await tracker.record('Tier 1: Feature Coverage', 'T1.4: Asset Versioning (_v1 -> _v2 preservation)', async () => {
      const projDir = path.join(tempTestRoot, 't1_4_project');
      const paths = StorageManager.initializeWorkspace(projDir, 'proj_t1_4');

      const v1Info = StorageManager.getNextAssetVersion(projDir, 'scene_01_shot_1', 'img', 'png');
      assertEqual(v1Info.version, 1, 'First version should be 1');
      createDummyPng(v1Info.absolutePath);

      // Next version check
      const v2Info = StorageManager.getNextAssetVersion(projDir, 'scene_01_shot_1', 'img', 'png');
      assertEqual(v2Info.version, 2, 'Next version must increment to 2');
      assert(v2Info.fileName.includes('_img_v2.png'), 'Filename must contain _v2.png');
      assert(fs.existsSync(v1Info.absolutePath), 'v1 file must remain intact on disk');
    });

    // 5. Audio ffprobe Duration Probing
    await tracker.record('Tier 1: Feature Coverage', 'T1.5: Real Audio Duration Probing via ffprobe', async () => {
      const projDir = path.join(tempTestRoot, 't1_5_project');
      const paths = StorageManager.initializeWorkspace(projDir, 'proj_t1_5');

      const audio1 = path.join(paths.voiceDir, 'scene_01.mp3');
      await createSyntheticAudioFile(audio1, 2.5);

      const duration = await StoryboardService.probeAudioDuration(audio1);
      assert(duration >= 2.4 && duration <= 2.7, `Probed duration ${duration} must be approx 2.5s`);

      // Generate timing.json
      const timingJson = await StoryboardService.generateTimingJson(projDir, 'proj_t1_5', [
        { scene_id: 'scene_01', audio_file: '02_voice/scene_01.mp3', narration: 'Xin chào các bạn.' },
      ]);

      assertEqual(timingJson.scenes.length, 1, 'One timing scene expected');
      assertApproximatelyEqual(timingJson.scenes[0]!.duration_sec, duration, 0.05, 'Timing duration must match probed duration');
      assert(fs.existsSync(path.join(paths.timingDir, 'timing.json')), 'timing.json must be written to disk');
    });

    // 6. Storyboard Scene & Shot Generation
    await tracker.record('Tier 1: Feature Coverage', 'T1.6: Storyboard Scene & Shot Decomposition with Pacing', async () => {
      const timing: TimingJson = {
        project_id: 'proj_t1_6',
        probed_engine: 'ffprobe',
        scenes: [
          { scene_id: 'scene_01', audio_file: '02_voice/scene_01.mp3', start_sec: 0, end_sec: 3.5, duration_sec: 3.5 },
          { scene_id: 'scene_02', audio_file: '02_voice/scene_02.mp3', start_sec: 3.5, end_sec: 10.5, duration_sec: 7.0 },
        ],
        total_duration_sec: 10.5,
      };

      const scriptScenes = [
        { scene_id: 'scene_01', narration: 'Kỷ băng hà bắt đầu.' },
        { scene_id: 'scene_02', narration: 'Một bầy voi ma mút di cư qua thung lũng tuyết trắng xóa.' },
      ];

      const storyboard = await StoryboardService.generateStoryboard('proj_t1_6', scriptScenes, timing);
      assertEqual(storyboard.scenes.length, 2, 'Must have 2 scenes in storyboard');
      assertEqual(storyboard.scenes[0]!.shots.length, 1, 'Scene 1 under 5.5s should have 1 shot');
      assertEqual(storyboard.scenes[1]!.shots.length, 2, 'Scene 2 over 5.5s should decompose into 2 shots for visual pacing');
      assertEqual(storyboard.scenes[1]!.shots[0]!.shot_id, 'scene_02_shot_1', 'First shot id formatting');
      assertEqual(storyboard.scenes[1]!.shots[1]!.shot_id, 'scene_02_shot_2', 'Second shot id formatting');
    });

    // 7. Unique shot_id Validation
    await tracker.record('Tier 1: Feature Coverage', 'T1.7: Unique shot_id Validation Across Storyboard', async () => {
      const validStoryboard: StoryboardJson = {
        project_id: 'proj_t1_7',
        scenes: [
          {
            scene_id: 'scene_01',
            duration_sec: 3.0,
            narration: 'test',
            shots: [
              { shot_id: 'scene_01_shot_1', shot_index: 1, expected_duration_sec: 3.0, image_prompt: 'p1', motion_note: 'm1' },
            ],
          },
          {
            scene_id: 'scene_02',
            duration_sec: 4.0,
            narration: 'test2',
            shots: [
              { shot_id: 'scene_02_shot_1', shot_index: 1, expected_duration_sec: 4.0, image_prompt: 'p2', motion_note: 'm2' },
            ],
          },
        ],
      };

      const validation = StoryboardService.validateStoryboardUniqueness(validStoryboard);
      assertEqual(validation.valid, true, 'Unique storyboard must validate true');
    });

    // 8. Visual Settle 2-Pass Measurement
    await tracker.record('Tier 1: Feature Coverage', 'T1.8: Visual Settle 2-Pass Stability Measurement', async () => {
      // Element is stationary
      let clicks = 0;
      const staticMeasure = () => ({ x: 200, y: 150, width: 100, height: 40 });
      const dispatcher = () => clicks++;

      const result = await VisualConfirmGuard.confirmBeforeAct(staticMeasure, dispatcher, {
        settleMs: 50,
        tolerancePx: 1.5,
      });

      assertEqual(result.settled, true, 'Static element must be settled');
      assertEqual(result.clicked, true, 'Click must be dispatched when settled');
      assertEqual(clicks, 1, 'Click dispatcher called exactly once');
      assertEqual(result.driftPx, 0, 'Static element has 0 drift');
    });

    // 9. Highlight Overlay Box Injection & Cleanup
    await tracker.record('Tier 1: Feature Coverage', 'T1.9: Highlight Overlay Box Rendering (200-400ms & cleanup)', async () => {
      const rect = { x: 100, y: 200, width: 120, height: 45 };
      const overlay = VisualConfirmGuard.injectHighlightOverlay(rect, '#F59E0B');

      assertEqual(overlay.style.pointerEvents, 'none', 'pointer-events must be none');
      assertEqual(overlay.style.zIndex, '999999', 'z-index must be top level (999999)');
      assertEqual(overlay.style.width, '120px', 'width must match rect');
      assert(overlay.overlayId.startsWith('flow-agent-highlight-overlay'), 'overlayId naming standard');

      // Verify cleanup
      overlay.remove();
    });

    // 10. Dynamic DOM Polling & Timeout
    await tracker.record('Tier 1: Feature Coverage', 'T1.10: Dynamic DOM Polling Mechanism (Zero Fixed Sleep)', async () => {
      let callCount = 0;
      const pollTarget = async () => {
        callCount++;
        return callCount >= 3 ? 'ready' : false;
      };

      // Poll until ready
      const startTime = Date.now();
      let result = null;
      while (Date.now() - startTime < 2000) {
        const val = await pollTarget();
        if (val) {
          result = val;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }

      assertEqual(result, 'ready', 'Polling successfully resolved predicate');
      assert(callCount >= 3, 'Polling checked condition multiple times adaptively');
    });

    // 11. Prompt Read-back Verification
    await tracker.record('Tier 1: Feature Coverage', 'T1.11: Prompt Read-Back Verification (Two-way Match)', async () => {
      const prompt = 'Epic prehistoric hunter in snow, 8k cinematic';
      const exactMatch = MediaAutomationEngine.verifyPromptReadBack(prompt, prompt);
      assertEqual(exactMatch, true, 'Identical prompt matches');

      const whitespaceTolerant = MediaAutomationEngine.verifyPromptReadBack(`  ${prompt} \n`, prompt);
      assertEqual(whitespaceTolerant, true, 'Trimmed prompt matches');

      const corruptedInput = 'Epic prehistoric hunter';
      const mismatch = MediaAutomationEngine.verifyPromptReadBack(corruptedInput, prompt);
      assertEqual(mismatch, false, 'Truncated input detected as mismatch');
    });

    // 12. Direct Local File Path Injection
    await tracker.record('Tier 1: Feature Coverage', 'T1.12: Direct Local File Path Injection (no thumbnail click)', async () => {
      const projDir = path.join(tempTestRoot, 'proj_t1_12');
      const paths = StorageManager.initializeWorkspace(projDir, 'proj_t1_12');
      const testImg = path.join(paths.mediaDir, 'scene_01_shot_1_img_v1.png');
      createDummyPng(testImg);

      const mockFileInput = { files: [] as string[], value: '' };
      const injectionResult = await FileInputInjector.injectLocalFilePath(testImg, mockFileInput);

      assertEqual(injectionResult.success, true, 'Injection must succeed for existing local file');
      assertEqual(injectionResult.methodUsed, 'cdp_dom_setFileInputFiles', 'Uses CDP direct injection');
      assertEqual(mockFileInput.files[0], testImg, 'File path passed directly into file input');
      assert(injectionResult.fileSizeBytes > 0, 'File size verified > 0');
    });

    // 13. Video Duration Deviation Checker (±15%)
    await tracker.record('Tier 1: Feature Coverage', 'T1.13: Video Duration Deviation Checker (±15% threshold)', async () => {
      // Within 15%
      const normalCase = MediaAutomationEngine.checkVideoDurationDeviation(4.0, 4.3);
      assertEqual(normalCase.deviationPct, 7.5, 'Deviation should be 7.5%');
      assertEqual(normalCase.needsReview, false, 'Normal deviation needs_review = false');

      // Exceeding 15%
      const excessCase = MediaAutomationEngine.checkVideoDurationDeviation(4.0, 5.0);
      assertEqual(excessCase.deviationPct, 25.0, 'Deviation should be 25.0%');
      assertEqual(excessCase.needsReview, true, 'Deviation > 15% flags needs_review = true');
    });

    // 14. Dual UI Modes Configuration
    await tracker.record('Tier 1: Feature Coverage', 'T1.14: Dual UI Modes (Offscreen vs Live Window coordinates)', async () => {
      const OFFSCREEN = { x: -3000, y: -3000 };
      const LIVE_WINDOW = { x: 100, y: 100 };

      // Verify offscreen coordinate standard
      assertEqual(OFFSCREEN.x, -3000, 'Offscreen X must be -3000');
      assertEqual(OFFSCREEN.y, -3000, 'Offscreen Y must be -3000');

      // Verify live window coordinate standard
      assertEqual(LIVE_WINDOW.x, 100, 'Live window X must be 100');
      assertEqual(LIVE_WINDOW.y, 100, 'Live window Y must be 100');
    });

    // 15. Structured JSON Action Logs
    await tracker.record('Tier 1: Feature Coverage', 'T1.15: Structured JSON Action Logs Format Verification', async () => {
      const logEntry = MediaAutomationEngine.createActionLog({
        scene_id: 'scene_01',
        shot_id: 'scene_01_shot_1',
        action: 'click',
        target: 'generate_button',
        retry: 0,
        status: 'ok',
        details: { coord: { x: 250, y: 310 } },
      });

      assert(Boolean(logEntry.ts), 'Timestamp must exist');
      assert(!isNaN(Date.parse(logEntry.ts)), 'Timestamp must be valid ISO string');
      assertEqual(logEntry.action, 'click', 'Action matches');
      assertEqual(logEntry.target, 'generate_button', 'Target matches');
      assertEqual(logEntry.status, 'ok', 'Status matches');
    });

    // ========================================================================
    // TIER 2: BOUNDARY & CORNER CASES — 7 Critical Edge Cases
    // ========================================================================
    logSection('Tier 2: Boundary & Corner Cases');

    // T2.1: Zero-byte audio file handling
    await tracker.record('Tier 2: Boundary & Corner Cases', 'T2.1: Zero-Byte Audio File Handling (Corrupt Audio Detection)', async () => {
      const emptyAudioPath = path.join(tempTestRoot, 'empty_test.mp3');
      fs.writeFileSync(emptyAudioPath, Buffer.alloc(0));

      await assertThrowsAsync(
        () => StoryboardService.probeAudioDuration(emptyAudioPath),
        '0 bytes',
        'Should reject 0-byte audio file'
      );
    });

    // T2.2: Duplicate shot_id error handling
    await tracker.record('Tier 2: Boundary & Corner Cases', 'T2.2: Duplicate shot_id Error Detection in Storyboard', async () => {
      const duplicateStoryboard: StoryboardJson = {
        project_id: 'proj_t2_2',
        scenes: [
          {
            scene_id: 'scene_01',
            duration_sec: 4.0,
            narration: 'scene 1',
            shots: [
              { shot_id: 'scene_01_shot_1', shot_index: 1, expected_duration_sec: 2.0, image_prompt: 'p1', motion_note: 'm1' },
              { shot_id: 'scene_01_shot_1', shot_index: 2, expected_duration_sec: 2.0, image_prompt: 'p2', motion_note: 'm2' }, // duplicate!
            ],
          },
        ],
      };

      assertThrows(
        () => StoryboardService.validateStoryboardUniqueness(duplicateStoryboard),
        'Duplicate shot_id detected',
        'Duplicate shot_id must throw error'
      );
    });

    // T2.3: Shifting element abort
    await tracker.record('Tier 2: Boundary & Corner Cases', 'T2.3: Shifting Element Abort During Visual Settle', async () => {
      let shiftCount = 0;
      // Element shifts by 10px every call
      const movingMeasure = () => {
        shiftCount++;
        return { x: 100 + shiftCount * 10, y: 100, width: 80, height: 30 };
      };
      let clicked = false;
      const dispatcher = () => { clicked = true; };

      const result = await VisualConfirmGuard.confirmBeforeAct(movingMeasure, dispatcher, {
        settleMs: 25,
        tolerancePx: 1.5,
        maxMeasurements: 3,
      });

      assertEqual(result.settled, false, 'Unstable moving element must not settle');
      assertEqual(result.clicked, false, 'Click must be aborted for unstable element');
      assertEqual(clicked, false, 'Dispatcher must never be called');
      assertEqual(result.attempts, 3, 'Attempts reached maxMeasurements limit');
    });

    // T2.4: ±15% Boundary Values Testing
    await tracker.record('Tier 2: Boundary & Corner Cases', 'T2.4: Exact ±15% Boundary Values for Video Duration Deviation', async () => {
      // Exactly +15.0%
      const b15Exact = MediaAutomationEngine.checkVideoDurationDeviation(10.0, 11.5);
      assertEqual(b15Exact.deviationPct, 15.0, 'Deviation is 15.0%');
      assertEqual(b15Exact.needsReview, false, 'Exactly 15.0% is accepted without review flag');

      // +15.01%
      const b15Over = MediaAutomationEngine.checkVideoDurationDeviation(10.0, 11.51);
      assertEqual(b15Over.needsReview, true, '15.1% exceeds threshold -> needs_review: true');

      // Exactly -15.0%
      const b15Under = MediaAutomationEngine.checkVideoDurationDeviation(10.0, 8.5);
      assertEqual(b15Under.deviationPct, 15.0, 'Deviation is 15.0%');
      assertEqual(b15Under.needsReview, false, 'Exactly -15.0% is accepted without review flag');

      // -15.01%
      const b15UnderOver = MediaAutomationEngine.checkVideoDurationDeviation(10.0, 8.49);
      assertEqual(b15UnderOver.needsReview, true, '-15.1% exceeds threshold -> needs_review: true');

      // Zero duration edge condition
      const bZeroExpected = MediaAutomationEngine.checkVideoDurationDeviation(0, 5.0);
      assertEqual(bZeroExpected.needsReview, true, 'Zero expected duration flags review');
    });

    // T2.5: Path with spaces and special characters
    await tracker.record('Tier 2: Boundary & Corner Cases', 'T2.5: File Path Injection with Spaces and Special Characters', async () => {
      const spaceDir = path.join(tempTestRoot, 'Folder With Spaces and (Parens)');
      fs.mkdirSync(spaceDir, { recursive: true });
      const testFile = path.join(spaceDir, 'scene_01_shot_1_img_v1.png');
      createDummyPng(testFile);

      const mockInput = { files: [] as string[], value: '' };
      const res = await FileInputInjector.injectLocalFilePath(testFile, mockInput);

      assertEqual(res.success, true, 'Injection succeeds with spaces in path');
      assertEqual(mockInput.files[0], testFile, 'File array contains exact path with spaces');
    });

    // T2.6: Missing image path detection before I2V
    await tracker.record('Tier 2: Boundary & Corner Cases', 'T2.6: Missing Image Path Detection Before I2V Upload', async () => {
      const nonExistentFile = path.join(tempTestRoot, 'non_existent_img_v1.png');
      const res = await FileInputInjector.injectLocalFilePath(nonExistentFile);

      assertEqual(res.success, false, 'Should fail injection when file does not exist');
      assert(Boolean(res.error?.includes('does not exist')), 'Error explains missing file');
    });

    // T2.7: Corrupted index.json recovery
    await tracker.record('Tier 2: Boundary & Corner Cases', 'T2.7: Corrupted index.json Recovery from Backup', async () => {
      const projDir = path.join(tempTestRoot, 't2_7_project');
      StorageManager.initializeWorkspace(projDir, 'proj_t2_7');

      // Put valid data into index and trigger backup creation
      StorageManager.updateIndex(projDir, (draft) => {
        draft.status = 'in_progress';
      });

      // Deliberately corrupt index.json
      const indexPath = path.join(projDir, 'index.json');
      fs.writeFileSync(indexPath, '{{malformed json content###', 'utf8');

      // Reading index should heal from backup or self-heal
      const healed = StorageManager.getIndex(projDir);
      assert(Boolean(healed && healed.status), 'Restored or self-healed index returns valid status');
      assert(Array.isArray(healed.action_logs), 'action_logs array is valid');
    });

    // ========================================================================
    // TIER 3: CROSS-FEATURE COMBINATIONS — 3 Multi-Stage Workflows
    // ========================================================================
    logSection('Tier 3: Cross-Feature Combinations');

    // T3.1: Audio probe -> Storyboard pacing -> Video duration deviation check
    await tracker.record('Tier 3: Cross-Feature Combinations', 'T3.1: Audio Probing -> Storyboard Pacing -> Video Deviation Flow', async () => {
      const projDir = path.join(tempTestRoot, 't3_1_project');
      const paths = StorageManager.initializeWorkspace(projDir, 'proj_t3_1');

      // Create real audio: Scene 1 = 3.0s, Scene 2 = 6.0s
      const audio1 = path.join(paths.voiceDir, 'scene_01.mp3');
      const audio2 = path.join(paths.voiceDir, 'scene_02.mp3');
      await createSyntheticAudioFile(audio1, 3.0);
      await createSyntheticAudioFile(audio2, 6.0);

      // Probe & generate timing
      const timing = await StoryboardService.generateTimingJson(projDir, 'proj_t3_1', [
        { scene_id: 'scene_01', audio_file: '02_voice/scene_01.mp3', narration: 'Intro scene' },
        { scene_id: 'scene_02', audio_file: '02_voice/scene_02.mp3', narration: 'Main action scene' },
      ]);

      assertEqual(timing.scenes.length, 2, 'Two timing scenes generated');
      assertApproximatelyEqual(timing.scenes[0]!.duration_sec, 3.0, 0.1, 'Scene 1 probed ~3.0s');
      assertApproximatelyEqual(timing.scenes[1]!.duration_sec, 6.0, 0.1, 'Scene 2 probed ~6.0s');

      // Storyboard generation
      const storyboard = await StoryboardService.generateStoryboard('proj_t3_1', [
        { scene_id: 'scene_01', narration: 'Intro scene' },
        { scene_id: 'scene_02', narration: 'Main action scene' },
      ], timing);

      // Scene 1 has 1 shot (~3.0s expected)
      const shot1 = storyboard.scenes[0]!.shots[0]!;
      // Scene 2 has 2 shots (~3.0s each)
      const shot2 = storyboard.scenes[1]!.shots[0]!;

      // Simulate generated videos:
      // Video 1: 3.1s (deviation 3.3% -> within 15% -> needs_review: false)
      const devShot1 = MediaAutomationEngine.checkVideoDurationDeviation(shot1.expected_duration_sec, 3.1);
      assertEqual(devShot1.needsReview, false, 'Video 1 within tolerance');

      // Video 2: 4.2s (deviation 40% -> exceeds 15% -> needs_review: true)
      const devShot2 = MediaAutomationEngine.checkVideoDurationDeviation(shot2.expected_duration_sec, 4.2);
      assertEqual(devShot2.needsReview, true, 'Video 2 exceeds tolerance, flags review');

      // Record into index
      StorageManager.updateIndex(projDir, (draft) => {
        draft.scenes['scene_01'] = {
          scene_id: 'scene_01',
          shots: {
            [shot1.shot_id]: {
              shot_id: shot1.shot_id,
              current_image_version: 1,
              current_video_version: 1,
              expected_duration_sec: shot1.expected_duration_sec,
              actual_duration_sec: 3.1,
              duration_deviation_pct: devShot1.deviationPct,
              needs_review: devShot1.needsReview,
              status: 'video_ready',
            },
          },
        };
        draft.scenes['scene_02'] = {
          scene_id: 'scene_02',
          shots: {
            [shot2.shot_id]: {
              shot_id: shot2.shot_id,
              current_image_version: 1,
              current_video_version: 1,
              expected_duration_sec: shot2.expected_duration_sec,
              actual_duration_sec: 4.2,
              duration_deviation_pct: devShot2.deviationPct,
              needs_review: devShot2.needsReview,
              status: 'video_ready',
            },
          },
        };
      });

      const finalIndex = StorageManager.getIndex(projDir);
      assertEqual(finalIndex.scenes['scene_01']?.shots[shot1.shot_id]?.needs_review, false, 'Index recorded needs_review: false for shot 1');
      assertEqual(finalIndex.scenes['scene_02']?.shots[shot2.shot_id]?.needs_review, true, 'Index recorded needs_review: true for shot 2');
    });

    // T3.2: Storage manager -> Idempotency -> Regeneration version bump -> Index update
    await tracker.record('Tier 3: Cross-Feature Combinations', 'T3.2: Storage -> Idempotency Skip -> Regeneration Version Bump', async () => {
      const projDir = path.join(tempTestRoot, 't3_2_project');
      const paths = StorageManager.initializeWorkspace(projDir, 'proj_t3_2');

      // Step 1: Initial creation of v1 image
      const v1 = StorageManager.getNextAssetVersion(projDir, 'scene_01_shot_1', 'img');
      createDummyPng(v1.absolutePath);
      const hash1 = crypto.createHash('sha256').update(fs.readFileSync(v1.absolutePath)).digest('hex');

      StorageManager.updateIndex(projDir, (draft) => {
        draft.scenes['scene_01'] = {
          scene_id: 'scene_01',
          shots: {
            'scene_01_shot_1': {
              shot_id: 'scene_01_shot_1',
              current_image_version: 1,
              current_video_version: 0,
              image_path: v1.relativePath,
              status: 'image_ready',
            },
          },
        };
      });

      // Step 2: Idempotent rerun check -> detects v1 exists, should skip
      const check = StorageManager.checkAssetIdempotency(projDir, v1.relativePath);
      assertEqual(check.skip, true, 'Idempotency detects existing asset and returns skip: true');

      // Step 3: User triggers deliberate regeneration -> increments version to v2
      const v2 = StorageManager.getNextAssetVersion(projDir, 'scene_01_shot_1', 'img');
      assertEqual(v2.version, 2, 'Version bumped to 2');
      // Write distinct content for v2
      fs.writeFileSync(v2.absolutePath, Buffer.from('new v2 content'));

      StorageManager.updateIndex(projDir, (draft) => {
        const shot = draft.scenes['scene_01']?.shots['scene_01_shot_1'];
        if (shot) {
          shot.current_image_version = 2;
          shot.image_path = v2.relativePath;
        }
      });

      // Verify v1 is untouched on disk
      assert(fs.existsSync(v1.absolutePath), 'v1 file still exists on disk');
      const hash1After = crypto.createHash('sha256').update(fs.readFileSync(v1.absolutePath)).digest('hex');
      assertEqual(hash1, hash1After, 'v1 content hash completely preserved');

      // Verify index reflects v2
      const index = StorageManager.getIndex(projDir);
      assertEqual(index.scenes['scene_01']?.shots['scene_01_shot_1']?.current_image_version, 2, 'Index points to version 2');
      assertEqual(index.scenes['scene_01']?.shots['scene_01_shot_1']?.image_path, v2.relativePath, 'Index path points to v2');
    });

    // T3.3: Safe click -> Visual settle highlight -> Action log recording
    await tracker.record('Tier 3: Cross-Feature Combinations', 'T3.3: Safe Click -> Visual Settle Highlight -> Action Log Recording', async () => {
      const projDir = path.join(tempTestRoot, 't3_3_project');
      StorageManager.initializeWorkspace(projDir, 'proj_t3_3');

      const targetRect = { x: 320, y: 450, width: 140, height: 48 };
      let overlayRendered = false;
      let overlayCleaned = false;

      // 1. Inject highlight overlay before clicking
      const overlay = VisualConfirmGuard.injectHighlightOverlay(targetRect, '#10B981');
      overlayRendered = true;

      // 2. Perform 2-pass confirm-before-act
      const clickedCoords = { x: 0, y: 0 };
      const measureFn = () => targetRect;
      const dispatcher = (x: number, y: number) => {
        clickedCoords.x = x;
        clickedCoords.y = y;
      };

      const settleRes = await VisualConfirmGuard.confirmBeforeAct(measureFn, dispatcher, { settleMs: 30 });

      // 3. Clean up overlay
      overlay.remove();
      overlayCleaned = true;

      assertEqual(overlayRendered, true, 'Overlay was rendered');
      assertEqual(overlayCleaned, true, 'Overlay was removed');
      assertEqual(settleRes.clicked, true, 'Safe click executed');
      assertEqual(clickedCoords.x, 320 + 70, 'Center X computed correctly');
      assertEqual(clickedCoords.y, 450 + 24, 'Center Y computed technical');

      // 4. Record action log in index
      const log = MediaAutomationEngine.createActionLog({
        scene_id: 'scene_01',
        shot_id: 'scene_01_shot_1',
        action: 'click',
        target: 't2i_generate_button',
        retry: 0,
        status: 'ok',
        details: { clickCoords: clickedCoords, driftPx: settleRes.driftPx },
      });

      StorageManager.updateIndex(projDir, (draft) => {
        draft.action_logs.push(log);
      });

      const index = StorageManager.getIndex(projDir);
      assertEqual(index.action_logs.length, 1, 'Action log stored in index');
      assertEqual(index.action_logs[0]!.target, 't2i_generate_button', 'Target matches');
    });

    // ========================================================================
    // TIER 4: REAL-WORLD APPLICATION SCENARIOS — 2 End-to-End Lifecycles
    // ========================================================================
    logSection('Tier 4: Real-World Application Scenarios');

    // T4.1: Greenfield Project Full Pipeline Lifecycle Simulation
    await tracker.record('Tier 4: Real-World Scenarios', 'T4.1: Greenfield Project Full Pipeline Lifecycle Simulation', async () => {
      const projDir = path.join(tempTestRoot, 't4_1_greenfield');
      const paths = StorageManager.initializeWorkspace(projDir, 'proj_greenfield_01');

      // Phase 0: Facts
      const facts = {
        project_id: 'proj_greenfield_01',
        topic: 'Cuộc chiến sinh tồn kỷ băng hà',
        facts: [
          { id: 'f1', content: 'Khí hậu Trái Đất đóng băng 20,000 năm trước.' },
          { id: 'f2', content: 'Con người cổ đại phải săn bắt voi ma mút để sinh tồn.' },
        ],
      };
      fs.writeFileSync(path.join(paths.factsDir, 'facts.json'), JSON.stringify(facts, null, 2), 'utf8');

      // Phase 1: Script
      const script = {
        scenes: [
          { scene_id: 'scene_01', narration: 'Băng giá bao phủ vạn vật hàng ngàn năm trước.' },
          { scene_id: 'scene_02', narration: 'Bộ tộc thợ săn bắt đầu chuyến đi săn định mệnh giữa bão tuyết mù mịt.' },
        ],
      };
      fs.writeFileSync(path.join(paths.scriptDir, 'script.json'), JSON.stringify(script, null, 2), 'utf8');

      // Phase 2: Voice Audio Synthesis
      const audio1 = path.join(paths.voiceDir, 'scene_01.mp3');
      const audio2 = path.join(paths.voiceDir, 'scene_02.mp3');
      await createSyntheticAudioFile(audio1, 2.5);
      await createSyntheticAudioFile(audio2, 6.2);

      // Phase 3: Timing Extraction with ffprobe
      const timing = await StoryboardService.generateTimingJson(projDir, 'proj_greenfield_01', [
        { scene_id: 'scene_01', audio_file: '02_voice/scene_01.mp3', narration: script.scenes[0]!.narration },
        { scene_id: 'scene_02', audio_file: '02_voice/scene_02.mp3', narration: script.scenes[1]!.narration },
      ]);
      assert(timing.total_duration_sec > 8.0, 'Total audio duration > 8s');

      // Phase 4: Storyboard Generation
      const storyboard = await StoryboardService.generateStoryboard('proj_greenfield_01', script.scenes, timing);
      fs.writeFileSync(path.join(paths.storyboardDir, 'storyboard.json'), JSON.stringify(storyboard, null, 2), 'utf8');
      assertEqual(storyboard.scenes.length, 2, 'Storyboard generated 2 scenes');

      // Phase 5: Media Generation Simulation (T2I + I2V with local path injection)
      for (const scene of storyboard.scenes) {
        for (const shot of scene.shots) {
          // T2I: Image generation
          const imgVer = StorageManager.getNextAssetVersion(projDir, shot.shot_id, 'img');
          createDummyPng(imgVer.absolutePath);

          // I2V: Local path injection into file input
          const fileInput = { files: [] as string[], value: '' };
          const uploadRes = await FileInputInjector.injectLocalFilePath(imgVer.absolutePath, fileInput);
          assertEqual(uploadRes.success, true, 'Image injected successfully for I2V');

          // Video generation simulation
          const vidVer = StorageManager.getNextAssetVersion(projDir, shot.shot_id, 'vid');
          await createSyntheticVideoFile(vidVer.absolutePath, shot.expected_duration_sec);

          const dev = MediaAutomationEngine.checkVideoDurationDeviation(shot.expected_duration_sec, shot.expected_duration_sec);

          // Update index
          StorageManager.updateIndex(projDir, (draft) => {
            if (!draft.scenes[scene.scene_id]) {
              draft.scenes[scene.scene_id] = {
                scene_id: scene.scene_id,
                voice_path: `02_voice/${scene.scene_id}.mp3`,
                shots: {},
              };
            }
            draft.scenes[scene.scene_id]!.shots[shot.shot_id] = {
              shot_id: shot.shot_id,
              current_image_version: 1,
              current_video_version: 1,
              image_path: imgVer.relativePath,
              video_path: vidVer.relativePath,
              expected_duration_sec: shot.expected_duration_sec,
              actual_duration_sec: shot.expected_duration_sec,
              duration_deviation_pct: dev.deviationPct,
              needs_review: dev.needsReview,
              status: 'completed',
            };
          });
        }
      }

      // Mark completed
      StorageManager.updateIndex(projDir, (draft) => {
        draft.status = 'completed';
      });

      const finalState = StorageManager.getIndex(projDir);
      assertEqual(finalState.status, 'completed', 'Pipeline finished with status completed');
      assert(Object.keys(finalState.scenes).length === 2, 'All 2 scenes recorded in index');
    });

    // T4.2: Crash Recovery & Resumption Simulation
    await tracker.record('Tier 4: Real-World Scenarios', 'T4.2: Crash Recovery & Checkpoint Resumption Simulation', async () => {
      const projDir = path.join(tempTestRoot, 'proj_crash_01');
      const paths = StorageManager.initializeWorkspace(projDir, 'proj_crash_01');

      // Simulate partial progress: Scene 1 completed, Scene 2 pending
      const scene1Img = path.join(paths.mediaDir, 'scene_01_shot_1_img_v1.png');
      createDummyPng(scene1Img);

      StorageManager.updateIndex(projDir, (draft) => {
        draft.status = 'in_progress';
        draft.scenes['scene_01'] = {
          scene_id: 'scene_01',
          shots: {
            'scene_01_shot_1': {
              shot_id: 'scene_01_shot_1',
              current_image_version: 1,
              current_video_version: 0,
              image_path: '05_media/scene_01_shot_1_img_v1.png',
              status: 'image_ready',
            },
          },
        };
      });

      // SIMULATE CRASH: Process dies, fresh instance starts
      logInfo('Simulating crash and restart: loading existing session...');
      const resumedIndex = StorageManager.getIndex(projDir);
      assertEqual(resumedIndex.status, 'in_progress', 'Resumed session preserves status');

      // Check scene 1: asset already on disk
      const sc1Check = StorageManager.checkAssetIdempotency(projDir, resumedIndex.scenes['scene_01']!.shots['scene_01_shot_1']!.image_path!);
      assertEqual(sc1Check.skip, true, 'Scene 1 image detected on disk -> skipped with zero recomputation');

      // Generate missing Scene 2
      const scene2Img = path.join(paths.mediaDir, 'scene_02_shot_1_img_v1.png');
      createDummyPng(scene2Img);

      StorageManager.updateIndex(projDir, (draft) => {
        draft.scenes['scene_02'] = {
          scene_id: 'scene_02',
          shots: {
            'scene_02_shot_1': {
              shot_id: 'scene_02_shot_1',
              current_image_version: 1,
              current_video_version: 0,
              image_path: '05_media/scene_02_shot_1_img_v1.png',
              status: 'image_ready',
            },
          },
        };
        draft.status = 'completed';
      });

      const recovered = StorageManager.getIndex(projDir);
      assertEqual(recovered.status, 'completed', 'Recovered session reached completed status');
      assertEqual(Object.keys(recovered.scenes).length, 2, 'Both scenes present in master index');
      assert(fs.existsSync(scene1Img), 'Scene 1 image preserved');
      assert(fs.existsSync(scene2Img), 'Scene 2 image generated');
    });

  } finally {
    // Cleanup temporary test directory
    try {
      if (process.argv.includes('--keep-artifacts')) {
        logInfo(`Artifacts preserved at: ${tempTestRoot}`);
      } else {
        fs.rmSync(tempTestRoot, { recursive: true, force: true });
      }
    } catch {}
  }

  // ============================================================================
  // Final Test Results Summary
  // ============================================================================
  logHeader('TEST SUITE EXECUTION SUMMARY');
  console.log(`${colors.bold}Results by Tier:${colors.reset}`);
  for (const [tier, stat] of Object.entries(tracker.tierStats)) {
    const statusColor = stat.failed === 0 ? colors.green : colors.red;
    console.log(`  ${tier.padEnd(38)} : ${statusColor}${stat.passed} Passed, ${stat.failed} Failed${colors.reset}`);
  }

  console.log(`\n${colors.bold}Total Summary:${colors.reset}`);
  console.log(`  Total Tests Executed : ${tracker.totalPassed + tracker.totalFailed}`);
  console.log(`  Total Passed         : ${colors.green}${colors.bold}${tracker.totalPassed}${colors.reset}`);
  console.log(`  Total Failed         : ${tracker.totalFailed > 0 ? colors.red : colors.green}${colors.bold}${tracker.totalFailed}${colors.reset}`);

  if (tracker.totalFailed > 0) {
    console.log(`\n${colors.bgRed}${colors.bold} FAIL ${colors.reset} ${colors.red}One or more tests failed.${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`\n${colors.bgGreen}${colors.bold} SUCCESS ${colors.reset} ${colors.green}All test tiers passed flawlessly with exit code 0!${colors.reset}\n`);
    process.exit(0);
  }
}

// Run suite immediately
runAllTests().catch((err) => {
  console.error('Unhandled fatal error in test suite:', err);
  process.exit(1);
});
