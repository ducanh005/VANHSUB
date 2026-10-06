import fs from 'fs';
import path from 'path';
import os from 'os';
import type {
  PipelineSessionState,
  CapCutDraftSceneItem,
  CapCutDraftSubtitleItem,
  CapCutDraftProjectData,
  CapCutDraftExportOptions,
  CapCutDraftExportResult,
} from '../types';
import { aiStudioPipelineEngine } from '../AiStudioPipelineEngine';

export {
  CapCutDraftSceneItem,
  CapCutDraftSubtitleItem,
  CapCutDraftProjectData,
  CapCutDraftExportOptions,
  CapCutDraftExportResult,
};

/**
 * Sanitizes a draft title for use as a Windows folder name while preserving
 * Unicode characters (such as Vietnamese diacritics).
 * Replaces illegal Windows filename characters (< > : " / \ | ? *) with an underscore.
 */
export function sanitizeDraftFolderName(rawName: string): string {
  if (!rawName || !rawName.trim()) {
    return `draft_${Date.now()}`;
  }
  // Replace illegal Windows file/folder characters: < > : " / \ | ? * and control chars
  let sanitized = rawName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  // Strip trailing dots or spaces which are invalid on Windows
  sanitized = sanitized.replace(/[. ]+$/, '');
  return sanitized || `draft_${Date.now()}`;
}

/**
 * CapCutDraftExporter: 1-Click native export service to CapCut Desktop / JianYing
 * projects with microsecond (μs) timeline synchronization.
 *
 * Conforms to Milestone 5, PROJECT.md Contract 5, and AI Studio Specifications.
 */
export class CapCutDraftExporter {
  /**
   * Auto-detects the default CapCut Desktop draft projects directory on Windows.
   * Path: %LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft\
   * Fallback: %USERPROFILE%\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\
   */
  public static detectCapCutDraftDirectory(): string {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData && localAppData.trim()) {
      return path.join(
        localAppData.trim(),
        'CapCut',
        'User Data',
        'Projects',
        'com.lveditor.draft'
      );
    }
    return path.join(
      os.homedir(),
      'AppData',
      'Local',
      'CapCut',
      'User Data',
      'Projects',
      'com.lveditor.draft'
    );
  }

  /**
   * Instance method alias for detectCapCutDraftDirectory.
   */
  public detectCapCutDraftDirectory(): string {
    return CapCutDraftExporter.detectCapCutDraftDirectory();
  }

  /**
   * Exports an AI Studio project or pipeline session into a valid CapCut Desktop draft.
   *
   * Generates:
   * 1. draft_content.json: Complete 4-track timeline structure and materials dictionary
   *    (Track 1: Video clips/images, Track 2: Voiceover, Track 3: BGM, Track 4: Subtitles).
   * 2. draft_meta_info.json: Project metadata with creation timestamp and duration.
   *
   * Timebase: All timing values are in microseconds (1 second = 1,000,000 μs).
   */
  public static async exportToCapCutDraft(
    optionsOrTargetOrProject: CapCutDraftExportOptions | string | any,
    maybeTargetOrProject?: string | any
  ): Promise<CapCutDraftExportResult> {
    const { targetDir, projectData } = await CapCutDraftExporter.resolveExportInputs(
      optionsOrTargetOrProject,
      maybeTargetOrProject
    );

    return CapCutDraftExporter.generateDraftFiles(targetDir, projectData);
  }

  /**
   * Synchronous variant for direct testing and synchronous pipeline orchestration.
   */
  public static exportToCapCutDraftSync(
    targetDir: string,
    projectData: CapCutDraftProjectData
  ): CapCutDraftExportResult {
    return CapCutDraftExporter.generateDraftFiles(targetDir, projectData);
  }

  /**
   * Instance method alias for exportToCapCutDraft.
   */
  public async exportToCapCutDraft(
    optionsOrTargetOrProject: CapCutDraftExportOptions | string | any,
    maybeTargetOrProject?: string | any
  ): Promise<CapCutDraftExportResult> {
    return CapCutDraftExporter.exportToCapCutDraft(
      optionsOrTargetOrProject,
      maybeTargetOrProject
    );
  }

  /**
   * Resolves varied calling conventions (options object vs (targetDir, projectData) vs (projectData, targetDir))
   * and handles PipelineSessionState resolution if a sessionId or sessionState is provided.
   */
  private static async resolveExportInputs(
    arg1: CapCutDraftExportOptions | string | any,
    arg2?: string | any
  ): Promise<{ targetDir: string; projectData: CapCutDraftProjectData }> {
    let rawTargetDir: string | undefined;
    let rawProjectData: CapCutDraftProjectData | undefined;
    let sessionId: string | undefined;
    let sessionState: PipelineSessionState | undefined;

    if (typeof arg1 === 'string' && typeof arg2 === 'object' && arg2 !== null) {
      // Calling convention: (targetDir: string, projectData: object)
      rawTargetDir = arg1;
      rawProjectData = arg2;
    } else if (typeof arg1 === 'object' && arg1 !== null && typeof arg2 === 'string') {
      // Calling convention: (projectData: object, targetDir: string)
      rawTargetDir = arg2;
      rawProjectData = arg1;
    } else if (typeof arg1 === 'object' && arg1 !== null) {
      // Calling convention: (options: CapCutDraftExportOptions)
      const opts = arg1 as CapCutDraftExportOptions;
      rawTargetDir = opts.targetDir || opts.targetDirectory;
      rawProjectData = opts.projectData || opts;
      sessionId = opts.sessionId || opts.projectId;
      sessionState = opts.sessionState;
    } else if (typeof arg1 === 'string') {
      // Calling convention with raw string sessionId / targetDir
      const isPathString = (val: string) => {
        try {
          return path.isAbsolute(val) || val.includes('\\') || val.includes('/') || fs.existsSync(val);
        } catch {
          return path.isAbsolute(val) || val.includes('\\') || val.includes('/');
        }
      };

      if (typeof arg2 === 'string') {
        if (!isPathString(arg1)) {
          sessionId = arg1;
          rawTargetDir = arg2;
        } else if (!isPathString(arg2)) {
          rawTargetDir = arg1;
          sessionId = arg2;
        } else {
          sessionId = arg1;
          rawTargetDir = arg2;
        }
      } else {
        if (!isPathString(arg1)) {
          sessionId = arg1;
        } else {
          rawTargetDir = arg1;
        }
      }
    }

    // Attempt session state resolution if scenes are missing but sessionId / sessionState is present
    const hasScenes =
      rawProjectData?.scenes &&
      Array.isArray(rawProjectData.scenes) &&
      rawProjectData.scenes.length > 0;

    if (!hasScenes && (sessionId || sessionState)) {
      if (!sessionState && sessionId) {
        try {
          sessionState = (await aiStudioPipelineEngine.getState({ sessionId })) ?? undefined;
        } catch {
          // Non-fatal if session is not loaded in memory
        }
      }

      if (sessionState) {
        const resolved = CapCutDraftExporter.extractProjectDataFromSession(sessionState);
        rawProjectData = {
          id: rawProjectData?.id || resolved.id,
          title: rawProjectData?.title || resolved.title,
          durationSec: rawProjectData?.durationSec ?? resolved.durationSec,
          scenes: hasScenes ? rawProjectData?.scenes : resolved.scenes,
          voiceoverPath: rawProjectData?.voiceoverPath || resolved.voiceoverPath,
          bgmPath: rawProjectData?.bgmPath || resolved.bgmPath,
          subtitles:
            rawProjectData?.subtitles && rawProjectData.subtitles.length > 0
              ? rawProjectData.subtitles
              : resolved.subtitles,
        };
      }
    }

    const safeProjectData: CapCutDraftProjectData = {
      id: rawProjectData?.id || sessionId || `draft-${Date.now()}`,
      title: rawProjectData?.title || 'AI Studio Video',
      durationSec: rawProjectData?.durationSec,
      scenes: rawProjectData?.scenes || [],
      voiceoverPath: rawProjectData?.voiceoverPath,
      bgmPath: rawProjectData?.bgmPath,
      subtitles: rawProjectData?.subtitles || [],
    };

    // Resolve destination directory
    let effectiveTargetDir: string;
    if (rawTargetDir && rawTargetDir.trim()) {
      effectiveTargetDir = path.resolve(rawTargetDir.trim());
    } else {
      const baseDir = CapCutDraftExporter.detectCapCutDraftDirectory();
      const folderName = `${sanitizeDraftFolderName(
        safeProjectData.title || safeProjectData.id || 'draft'
      )}_${Date.now()}`;
      effectiveTargetDir = path.join(baseDir, folderName);
    }

    return {
      targetDir: effectiveTargetDir,
      projectData: safeProjectData,
    };
  }

  /**
   * Derives scenes, audio tracks, and subtitles from a PipelineSessionState checkpoint.
   */
  private static extractProjectDataFromSession(
    session: PipelineSessionState
  ): CapCutDraftProjectData {
    const scenes: CapCutDraftSceneItem[] = [];

    if (session.artifacts.scenes && session.artifacts.scenes.length > 0) {
      for (let i = 0; i < session.artifacts.scenes.length; i++) {
        const sc = session.artifacts.scenes[i];
        const durSec =
          typeof sc.durationMs === 'number' && !isNaN(sc.durationMs)
            ? sc.durationMs / 1000
            : 4.0;
        const mediaPath = sc.videoPath || sc.assetPath || sc.imagePath || '';
        const isVideo =
          sc.motionType === 'video' ||
          Boolean(sc.videoPath) ||
          mediaPath.toLowerCase().endsWith('.mp4');

        scenes.push({
          id: sc.id || sc.shotId || `sc-${i}`,
          path: mediaPath,
          durationSec: durSec,
          type: isVideo ? 'video' : 'image',
        });
      }
    } else if (session.artifacts.scriptLines && session.artifacts.scriptLines.length > 0) {
      for (let i = 0; i < session.artifacts.scriptLines.length; i++) {
        const line = session.artifacts.scriptLines[i];
        const durSec =
          typeof line.endMs === 'number' &&
          typeof line.startMs === 'number' &&
          !isNaN(line.endMs) &&
          !isNaN(line.startMs)
            ? (line.endMs - line.startMs) / 1000
            : line.estimatedDurationSec || 4.0;
        const mediaPath = line.assetPath || line.audioPath || '';
        const isVideo =
          line.assetType === 'video' || mediaPath.toLowerCase().endsWith('.mp4');

        scenes.push({
          id: line.id || `line-${i}`,
          path: mediaPath,
          durationSec: durSec,
          type: isVideo ? 'video' : 'image',
        });
      }
    }

    const subtitles: CapCutDraftSubtitleItem[] = [];
    if (session.artifacts.scriptLines && session.artifacts.scriptLines.length > 0) {
      for (const line of session.artifacts.scriptLines) {
        if (line.text && line.text.trim()) {
          const startSec = (line.startMs ?? 0) / 1000;
          const endSec = (line.endMs ?? (line.startMs ?? 0) + 3000) / 1000;
          subtitles.push({
            text: line.text,
            startSec,
            endSec,
          });
        }
      }
    }

    const calculatedDurationSec = scenes.reduce((sum, s) => sum + s.durationSec, 0);

    return {
      id: session.sessionId,
      title: session.artifacts.blueprint?.title || session.topic || 'AI Studio Video',
      durationSec:
        calculatedDurationSec > 0
          ? calculatedDurationSec
          : session.artifacts.blueprint?.estimatedDurationSec || 10.0,
      scenes,
      voiceoverPath: session.artifacts.audioPath,
      bgmPath: undefined,
      subtitles,
    };
  }

  /**
   * Generates draft_content.json and draft_meta_info.json on disk with
   * exact microsecond calculations and 4 synchronized tracks.
   */
  private static generateDraftFiles(
    targetDir: string,
    projectData: CapCutDraftProjectData
  ): CapCutDraftExportResult {
    fs.mkdirSync(targetDir, { recursive: true });

    const scenes: CapCutDraftSceneItem[] = (projectData.scenes || []).map((sc, i) => ({
      id: sc.id || `sc-${i}`,
      path: sc.path || '',
      durationSec: Number(sc.durationSec) || 0,
      type: sc.type || 'video',
    }));

    // Calculate total duration in seconds and convert to microseconds (1s = 1,000,000 μs)
    let durationSec = Number(projectData.durationSec);
    if (!durationSec || isNaN(durationSec) || durationSec <= 0) {
      const sumScenes = scenes.reduce((sum, s) => sum + s.durationSec, 0);
      const maxSub = (projectData.subtitles || []).reduce(
        (max, s) => Math.max(max, Number(s.endSec) || 0),
        0
      );
      durationSec = sumScenes > 0 ? sumScenes : maxSub;
    }
    const totalDurationUs = Math.round(durationSec * 1_000_000);

    // Track 1: Video (Video clips and static images)
    let videoElapsedUs = 0;
    const videoSegments = scenes.map((sc, i) => {
      const clipDurationUs = Math.round(sc.durationSec * 1_000_000);
      const seg = {
        id: `seg-vid-${i}`,
        material_id: `mat-vid-${i}`,
        target_timerange: {
          start: videoElapsedUs,
          duration: clipDurationUs,
        },
      };
      videoElapsedUs += clipDurationUs;
      return seg;
    });

    const tracks: any[] = [
      {
        id: 'track-video-main',
        type: 'video',
        segments: videoSegments,
      },
    ];

    // Track 2: Voiceover Audio (Voice speech track spanning total duration)
    const voiceoverPath = projectData.voiceoverPath?.trim();
    if (voiceoverPath) {
      tracks.push({
        id: 'track-audio-voice',
        type: 'audio',
        segments: [
          {
            id: 'seg-audio-voice-0',
            material_id: 'mat-audio-voice-0',
            target_timerange: {
              start: 0,
              duration: totalDurationUs,
            },
          },
        ],
      });
    }

    // Track 3: BGM Audio (Background music track spanning total duration)
    const bgmPath = projectData.bgmPath?.trim();
    if (bgmPath) {
      tracks.push({
        id: 'track-audio-bgm',
        type: 'audio',
        segments: [
          {
            id: 'seg-audio-bgm-0',
            material_id: 'mat-audio-bgm-0',
            target_timerange: {
              start: 0,
              duration: totalDurationUs,
            },
          },
        ],
      });
    }

    // Track 4: Text Subtitles (Timed subtitle text chunks)
    const subtitles = projectData.subtitles || [];
    if (subtitles.length > 0) {
      const subSegments = subtitles.map((sub, i) => ({
        id: `seg-text-${i}`,
        material_id: `mat-text-${i}`,
        text: sub.text,
        target_timerange: {
          start: Math.round(Number(sub.startSec) * 1_000_000),
          duration: Math.round((Number(sub.endSec) - Number(sub.startSec)) * 1_000_000),
        },
      }));
      tracks.push({
        id: 'track-text-subtitle',
        type: 'text',
        segments: subSegments,
      });
    }

    // Complete Materials Dictionary
    const materials = {
      videos: scenes.map((s, i) => ({
        id: `mat-vid-${i}`,
        path: s.path,
        type: s.type || 'video',
        duration: Math.round(s.durationSec * 1_000_000),
      })),
      audios: [
        ...(voiceoverPath
          ? [{ id: 'mat-audio-voice-0', path: voiceoverPath, duration: totalDurationUs }]
          : []),
        ...(bgmPath
          ? [{ id: 'mat-audio-bgm-0', path: bgmPath, duration: totalDurationUs }]
          : []),
      ],
      texts: subtitles.map((sub, i) => ({
        id: `mat-text-${i}`,
        content: sub.text,
      })),
    };

    const draftId = projectData.id || `draft-${Date.now()}`;
    const draftTitle = projectData.title || 'AI Studio Video';

    // Build draft_content.json structure
    const draftContent = {
      id: draftId,
      version: 2,
      duration: totalDurationUs,
      tracks,
      materials,
    };

    // Build draft_meta_info.json structure
    const draftMeta = {
      draft_id: draftId,
      draft_name: draftTitle,
      draft_fold_path: targetDir,
      tm_draft_create: Date.now(),
      tm_duration: totalDurationUs,
    };

    const contentJsonPath = path.join(targetDir, 'draft_content.json');
    const metaInfoJsonPath = path.join(targetDir, 'draft_meta_info.json');

    // Atomic / complete write as utf-8 (preserving Unicode characters and Vietnamese diacritics)
    fs.writeFileSync(contentJsonPath, JSON.stringify(draftContent, null, 2), 'utf8');
    fs.writeFileSync(metaInfoJsonPath, JSON.stringify(draftMeta, null, 2), 'utf8');

    const summary = {
      videoClipsCount: videoSegments.length,
      voiceoverTracksCount: voiceoverPath ? 1 : 0,
      bgmTracksCount: bgmPath ? 1 : 0,
      subtitlesCount: subtitles.length,
      totalDurationUs,
    };

    return {
      draftPath: targetDir,
      contentJsonPath,
      metaInfoJsonPath,
      tracksSummary: summary,
      trackSummary: summary,
    };
  }
}

export const capCutDraftExporter = new CapCutDraftExporter();
export default CapCutDraftExporter;
