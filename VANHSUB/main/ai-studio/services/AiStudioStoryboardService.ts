/**
 * AiStudioStoryboardService
 * Probes real audio timing via ffprobe and generates audio-synchronized storyboards
 * Conforms to spec-pipeline-video-automation.md §2 (Stages 4 & 5) and orchestrator_4/PROJECT.md
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpeg from 'fluent-ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

import {
  AiStudioDiskStorageManager,
  PipelineScriptData,
  PipelineTimingData,
  PipelineStoryboardData,
  SceneTimingItem,
  StoryboardSceneItem,
  StoryboardShotItem,
  ScriptSceneItem,
} from '../storage/AiStudioDiskStorageManager';
import type { ChannelProfileConfig } from '../types';

const execFileAsync = promisify(execFile);

// Configure FFprobe binary path from project installer
const rawFfprobePath = (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';
const resolvedFfprobePath = rawFfprobePath ? rawFfprobePath.replace('app.asar', 'app.asar.unpacked') : '';

if (resolvedFfprobePath) {
  ffmpeg.setFfprobePath(resolvedFfprobePath);
}

export interface VisualArtStylePresetItem {
  id: string;
  name: string;
  badge: string;
  stylePrefix: string;
  defaultBackground: string;
}

export const VISUAL_ART_STYLE_PRESETS: Record<string, VisualArtStylePresetItem> = {
  cinematic: {
    id: 'cinematic',
    name: 'Điện ảnh Chân thực (Cinematic Real)',
    badge: 'Phổ biến',
    stylePrefix: 'Cinematic movie lighting, 8k resolution, photorealistic masterpiece, 35mm film grain, anamorphic lens, highly detailed textures, dramatic lighting',
    defaultBackground: 'Modern cinematic studio environment, dramatic atmospheric backlighting, soft natural shadows, high contrast depth of field',
  },
  anime_ghibli: {
    id: 'anime_ghibli',
    name: 'Anime Ghibli (Miyazaki Style)',
    badge: 'Nghệ thuật',
    stylePrefix: 'Studio Ghibli aesthetic, lush hand-painted background, vibrant colors, gentle sunlight, whimsical atmosphere, highly detailed anime illustration by Hayao Miyazaki',
    defaultBackground: 'Idyllic countryside hillside with lush rolling green grass, vibrant wild flowers, blue sky with fluffy watercolor clouds',
  },
  dark_fantasy: {
    id: 'dark_fantasy',
    name: 'Kỳ ảo Đen tối (Dark Fantasy Epic)',
    badge: 'Huyền bí',
    stylePrefix: 'Dark fantasy epic, grimdark aesthetic, atmospheric volumetric fog, moody chiaroscuro lighting, intricate gothic architecture, Unreal Engine 5 render, 8k',
    defaultBackground: 'Ancient ruined gothic cathedral cloaked in misty moonlight, weathered stone pillars, eerie floating embers, deep mysterious shadows',
  },
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Tương lai Cyberpunk (Sci-Fi Neon)',
    badge: 'Khoa học',
    stylePrefix: 'Cyberpunk sci-fi aesthetic, vibrant neon reflections, octane render, futuristic high-tech dystopian cityscape, intricate mechanical details, cinematic 8k',
    defaultBackground: 'Rain-slicked futuristic Neo-Tokyo street at midnight, glowing neon signs in violet and cyan, towering holographic billboards, flying traffic streaks',
  },
  history_doc: {
    id: 'history_doc',
    name: 'Tài liệu Lịch sử (National Geographic)',
    badge: 'Tài liệu',
    stylePrefix: 'National Geographic documentary photography, historical realism, authentic period textures, dramatic natural daylight, 8k resolution, raw documentary focus',
    defaultBackground: 'Authentic historical ancient workshop with rustic wooden workbenches, parchment scrolls, brass measuring tools, dust motes in soft window light',
  },
  '3d_pixar': {
    id: '3d_pixar',
    name: 'Hoạt hình 3D Pixar (Disney 3D CGI)',
    badge: '3D Vui nhộn',
    stylePrefix: 'Pixar 3D animation style, Disney modern CGI render, charming stylized lighting, soft subsurface scattering, vibrant warm colors, 8k resolution',
    defaultBackground: 'Cozy whimsical studio room with colorful wooden furniture, warm ambient lighting, cute stylized props on bookshelves',
  },
};

export interface GenerateStoryboardOptions {
  storage: AiStudioDiskStorageManager;
  script?: PipelineScriptData;
  timing?: PipelineTimingData;
  stylePromptPrefix?: string;
  negativePrompt?: string;
  decompositionThresholdSec?: number; // Default 5.0s
  channelProfile?: Partial<ChannelProfileConfig>;
  backgroundPrompt?: string;
  customPromptGenerator?: (
    scene: ScriptSceneItem,
    shotIndex: number,
    totalShots: number,
    durationSec: number
  ) => { image_prompt: string; motion_note: string };
}

export class AiStudioStoryboardService {
  private static instance: AiStudioStoryboardService;

  public static getInstance(): AiStudioStoryboardService {
    if (!AiStudioStoryboardService.instance) {
      AiStudioStoryboardService.instance = new AiStudioStoryboardService();
    }
    return AiStudioStoryboardService.instance;
  }

  // ==========================================================================
  // 1. Audio Duration Probing (Phase 4 / spec §2)
  // ==========================================================================

  /**
   * Probes the actual audio duration (in seconds) of an audio file using ffprobe.
   * Absolutely forbids character-count or word-count estimation.
   * Rejects if file is missing, empty (0 bytes), or corrupt.
   */
  public async probeAudioDuration(audioPath: string): Promise<number> {
    if (!audioPath || typeof audioPath !== 'string') {
      throw new Error(`Invalid audio path provided to probeAudioDuration: "${audioPath}"`);
    }

    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file does not exist on disk: ${audioPath}`);
    }

    const stat = fs.statSync(audioPath);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Audio file is empty or 0 bytes: ${audioPath}`);
    }

    // 1. Try fluent-ffmpeg ffprobe
    try {
      const dur = await this.probeViaFluentFfmpeg(audioPath);
      if (Number.isFinite(dur) && dur > 0) {
        return Math.round(dur * 100) / 100;
      }
    } catch (fluentErr: any) {
      // Fall through to execFile if fluent probe fails
    }

    // 2. Try direct execFile of ffprobe binary
    try {
      const dur = await this.probeViaExecFile(audioPath);
      if (Number.isFinite(dur) && dur > 0) {
        return Math.round(dur * 100) / 100;
      }
    } catch (execErr: any) {
      throw new Error(
        `Failed to probe audio duration via ffprobe for "${audioPath}". Error: ${execErr?.message || String(execErr)}`
      );
    }

    throw new Error(`ffprobe returned an invalid or zero duration for audio file: "${audioPath}"`);
  }

  private probeViaFluentFfmpeg(audioPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) return reject(err);
        const formatDur = metadata?.format?.duration;
        const streamDur = metadata?.streams?.find(s => s.duration)?.duration;
        const dur = parseFloat(String(formatDur ?? streamDur ?? '0'));
        if (Number.isFinite(dur) && dur > 0) {
          resolve(dur);
        } else {
          reject(new Error(`fluent-ffmpeg returned non-positive duration: ${dur}`));
        }
      });
    });
  }

  private async probeViaExecFile(audioPath: string): Promise<number> {
    const ffprobeBin = resolvedFfprobePath || 'ffprobe';
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ];

    const { stdout, stderr } = await execFileAsync(ffprobeBin, args);
    if (stderr && stderr.trim().length > 0 && !stdout) {
      throw new Error(`ffprobe error output: ${stderr}`);
    }

    const dur = parseFloat(stdout.trim());
    if (!Number.isFinite(dur) || dur <= 0) {
      throw new Error(`ffprobe stdout output invalid duration: "${stdout.trim()}"`);
    }

    return dur;
  }

  // ==========================================================================
  // 2. Timing Extraction & 03_timing/timing.json Persistence
  // ==========================================================================

  /**
   * Probes audio duration for all scenes in 02_voice/{scene_id}.mp3,
   * generates 03_timing/timing.json, and updates index.json.
   */
  public async extractTiming(
    storage: AiStudioDiskStorageManager,
    customSceneIds?: string[]
  ): Promise<PipelineTimingData> {
    storage.ensureDirectories();

    // 1. Determine scenes to probe
    let sceneIds: string[] = customSceneIds || [];

    if (sceneIds.length === 0) {
      const script = storage.readScript();
      if (script && Array.isArray(script.scenes) && script.scenes.length > 0) {
        sceneIds = script.scenes.map(s => s.scene_id);
      }
    }

    if (sceneIds.length === 0) {
      // Discover existing voice files in 02_voice/
      if (fs.existsSync(storage.paths.voiceDir)) {
        const files = fs.readdirSync(storage.paths.voiceDir);
        sceneIds = files
          .filter(f => f.endsWith('.mp3'))
          .map(f => f.replace(/\.mp3$/, ''))
          .sort();
      }
    }

    if (sceneIds.length === 0) {
      // Check index.json scenes
      const idx = storage.readIndex();
      sceneIds = Object.keys(idx.scenes);
    }

    if (sceneIds.length === 0) {
      throw new Error(
        `No scenes discovered for timing extraction in project "${storage.projectId}". Please ensure script.json or voice files exist.`
      );
    }

    // 2. Probe each scene's audio file and compute timeline
    const sceneTimingList: SceneTimingItem[] = [];
    let currentTimelineSec = 0;

    for (const sceneId of sceneIds) {
      const audioPath = storage.getVoiceAudioPath(sceneId);
      const relativeAudioPath = storage.getVoiceAudioRelativePath(sceneId);

      const durSec = await this.probeAudioDuration(audioPath);
      const start_sec = Math.round(currentTimelineSec * 100) / 100;
      const end_sec = Math.round((currentTimelineSec + durSec) * 100) / 100;
      currentTimelineSec += durSec;

      const timingItem: SceneTimingItem = {
        scene_id: sceneId,
        audio_file: relativeAudioPath,
        start_sec,
        end_sec,
        duration_sec: durSec,
      };

      sceneTimingList.push(timingItem);

      // Update index.json scene metadata
      storage.updateSceneMetadata(sceneId, {
        voice_path: relativeAudioPath,
        voice_duration_sec: durSec,
        timing: {
          start_sec,
          end_sec,
          duration_sec: durSec,
        },
      });
    }

    const total_duration_sec = Math.round(currentTimelineSec * 100) / 100;

    const timingData: PipelineTimingData = {
      project_id: storage.projectId,
      probed_engine: 'ffprobe',
      scenes: sceneTimingList,
      total_duration_sec,
    };

    // 3. Persist 03_timing/timing.json
    storage.saveTiming(timingData);

    // 4. Record action log
    storage.appendActionLog({
      ts: new Date().toISOString(),
      action: 'probe',
      target: '03_timing/timing.json',
      retry: 0,
      status: 'ok',
      details: {
        scene_count: sceneTimingList.length,
        total_duration_sec,
      },
    });

    return timingData;
  }

  // ==========================================================================
  // 3. Storyboard Generation & Validation (Phase 5 / spec §2)
  // ==========================================================================

  /**
   * Generates storyboard scenes and decomposed shots from script and probed timing.
   * Enforces absolute uniqueness of shot_ids formatted as {scene_id}_shot_{n}.
   * Persists to 04_storyboard/storyboard.json and updates index.json.
   */
  public async generateStoryboard(
    options: GenerateStoryboardOptions
  ): Promise<PipelineStoryboardData> {
    const { storage } = options;
    storage.ensureDirectories();

    // 1. Resolve Script data
    const script = options.script || storage.readScript();
    if (!script || !Array.isArray(script.scenes) || script.scenes.length === 0) {
      throw new Error(
        `Cannot generate storyboard: script is missing or empty in project "${storage.projectId}"`
      );
    }

    // 2. Resolve Timing data
    let timing = options.timing || storage.readTiming();
    if (!timing || !Array.isArray(timing.scenes) || timing.scenes.length === 0) {
      // Auto-extract timing if missing
      timing = await this.extractTiming(storage, script.scenes.map(s => s.scene_id));
    }

    const timingMap = new Map<string, SceneTimingItem>();
    for (const t of timing.scenes) {
      timingMap.set(t.scene_id, t);
    }

    const presetKey = options.channelProfile?.visualArtStylePreset;
    const preset = presetKey && VISUAL_ART_STYLE_PRESETS[presetKey];
    const defaultPrefix = preset ? preset.stylePrefix : 'Cinematic lighting, 8k resolution, detailed photorealistic, masterpiece';
    const stylePrefix = options.stylePromptPrefix || defaultPrefix;
    const effectiveBgPrompt = options.backgroundPrompt || options.channelProfile?.projectBackgroundPrompt;
    const thresholdSec = options.decompositionThresholdSec || 5.0;

    const storyboardScenes: StoryboardSceneItem[] = [];

    // 3. Decompose each scene into shots based on duration
    for (const scriptScene of script.scenes) {
      const timingItem = timingMap.get(scriptScene.scene_id);
      if (!timingItem) {
        throw new Error(
          `Missing timing data for scene "${scriptScene.scene_id}". Ensure audio timing extraction has run.`
        );
      }

      const durationSec = timingItem.duration_sec;
      const shots: StoryboardShotItem[] = [];

      if (options.customPromptGenerator) {
        // Use custom shot planner if provided
        const numShots = durationSec > thresholdSec ? Math.max(2, Math.ceil(durationSec / 4.0)) : 1;
        const baseDur = Math.round((durationSec / numShots) * 100) / 100;

        for (let i = 1; i <= numShots; i++) {
          const shotId = `${scriptScene.scene_id}_shot_${i}`;
          const isLast = i === numShots;
          const shotDur = isLast ? Math.round((durationSec - baseDur * (numShots - 1)) * 100) / 100 : baseDur;
          const customPrompt = options.customPromptGenerator(scriptScene, i, numShots, shotDur);

          shots.push({
            shot_id: shotId,
            shot_index: i,
            expected_duration_sec: shotDur,
            image_prompt: customPrompt.image_prompt,
            motion_note: customPrompt.motion_note,
          });
        }
      } else {
        // Default intelligent duration-based decomposition
        if (durationSec <= thresholdSec) {
          // Single shot for short scenes
          const shotId = `${scriptScene.scene_id}_shot_1`;
          const imagePrompt = this.buildShotPrompt(scriptScene, 1, 1, stylePrefix, options.channelProfile, effectiveBgPrompt);
          const motionNote = 'slow push in camera, steady cinematic framing';

          shots.push({
            shot_id: shotId,
            shot_index: 1,
            expected_duration_sec: durationSec,
            image_prompt: imagePrompt,
            motion_note: motionNote,
          });
        } else {
          // Multi-shot decomposition for scenes longer than threshold (e.g. > 5s)
          const numShots = Math.max(2, Math.min(4, Math.ceil(durationSec / 4.0)));
          const baseDur = Math.round((durationSec / numShots) * 100) / 100;

          for (let i = 1; i <= numShots; i++) {
            const shotId = `${scriptScene.scene_id}_shot_${i}`;
            const isLast = i === numShots;
            const shotDur = isLast ? Math.round((durationSec - baseDur * (numShots - 1)) * 100) / 100 : baseDur;
            const imagePrompt = this.buildShotPrompt(scriptScene, i, numShots, stylePrefix, options.channelProfile, effectiveBgPrompt);
            const motionNote = this.buildMotionNote(i, numShots);

            shots.push({
              shot_id: shotId,
              shot_index: i,
              expected_duration_sec: shotDur,
              image_prompt: imagePrompt,
              motion_note: motionNote,
            });
          }
        }
      }

      storyboardScenes.push({
        scene_id: scriptScene.scene_id,
        duration_sec: durationSec,
        narration: scriptScene.narration,
        shots,
      });
    }

    const storyboardData: PipelineStoryboardData = {
      project_id: storage.projectId,
      scenes: storyboardScenes,
    };

    // 4. Validate absolute uniqueness of shot_ids
    this.validateStoryboard(storyboardData);

    // 5. Persist 04_storyboard/storyboard.json
    storage.saveStoryboard(storyboardData);

    // 6. Update index.json scene and shot metadata
    for (const sc of storyboardScenes) {
      storage.updateSceneMetadata(sc.scene_id, {
        narration: sc.narration,
      });

      for (const shot of sc.shots) {
        storage.updateShotMetadata(sc.scene_id, shot.shot_id, {
          image_prompt_used: shot.image_prompt,
          motion_note: shot.motion_note,
          expected_duration_sec: shot.expected_duration_sec,
          status: 'pending',
        });
      }
    }

    // 7. Append action log
    const totalShots = storyboardScenes.reduce((sum, s) => sum + s.shots.length, 0);
    storage.appendActionLog({
      ts: new Date().toISOString(),
      action: 'storyboard',
      target: '04_storyboard/storyboard.json',
      retry: 0,
      status: 'ok',
      details: {
        scene_count: storyboardScenes.length,
        shot_count: totalShots,
      },
    });

    return storyboardData;
  }

  /**
   * Enforces absolute uniqueness of all shot_ids across the storyboard.
   * Verifies hierarchical format {scene_id}_shot_{n}.
   * Throws a descriptive error if duplicate or invalid format is found.
   */
  public validateStoryboard(storyboard: PipelineStoryboardData): void {
    if (!storyboard || !Array.isArray(storyboard.scenes)) {
      throw new Error('Invalid storyboard data: missing scenes array');
    }

    const seenShotIds = new Map<string, string>(); // shot_id -> scene_id

    for (const sc of storyboard.scenes) {
      if (!sc.scene_id || typeof sc.scene_id !== 'string') {
        throw new Error(`Storyboard scene has missing or invalid scene_id: "${sc.scene_id}"`);
      }

      if (!Array.isArray(sc.shots) || sc.shots.length === 0) {
        throw new Error(`Storyboard scene "${sc.scene_id}" has no shots defined`);
      }

      const expectedPrefix = `${sc.scene_id}_shot_`;

      for (const shot of sc.shots) {
        if (!shot.shot_id || typeof shot.shot_id !== 'string') {
          throw new Error(`Shot in scene "${sc.scene_id}" is missing shot_id`);
        }

        // Validate hierarchical naming contract
        if (!shot.shot_id.startsWith(expectedPrefix)) {
          throw new Error(
            `Invalid shot_id format: "${shot.shot_id}". Must strictly follow hierarchical pattern "${expectedPrefix}{n}"`
          );
        }

        // Validate uniqueness across the entire storyboard
        if (seenShotIds.has(shot.shot_id)) {
          const priorScene = seenShotIds.get(shot.shot_id);
          throw new Error(
            `Duplicate shot_id detected: "${shot.shot_id}". Found in scene "${sc.scene_id}" but was already registered in scene "${priorScene}". All shot_ids must be globally unique.`
          );
        }

        seenShotIds.set(shot.shot_id, sc.scene_id);
      }
    }
  }

  // ==========================================================================
  // Prompt Synthesis Helpers
  // ==========================================================================

  public buildShotPrompt(
    scene: ScriptSceneItem,
    shotIndex: number,
    totalShots: number,
    stylePrefix: string,
    channelProfile?: Partial<ChannelProfileConfig>,
    backgroundPrompt?: string
  ): string {
    const anglePrefix = totalShots === 1
      ? 'Medium cinematic shot'
      : shotIndex === 1
      ? 'Wide establishing cinematic shot'
      : shotIndex === 2
      ? 'Medium action tracking shot'
      : shotIndex === 3
      ? 'Close-up dramatic focus shot'
      : 'Dynamic cinematic framing shot';

    const visualContent = scene.visual_note ? scene.visual_note.trim() : scene.narration.trim();

    // 1. Detect Character Appearance / Outfits
    let characterSnippet = '';
    const sceneText = `${scene.visual_note || ''} ${scene.narration || ''}`.toLowerCase();

    if (channelProfile?.channelCharacters && channelProfile.channelCharacters.length > 0) {
      for (const char of channelProfile.channelCharacters) {
        if (char.name && sceneText.includes(char.name.toLowerCase())) {
          characterSnippet = `featuring character ${char.name}${char.descriptionEn ? ` (${char.descriptionEn.trim()})` : ''}`;
          break;
        }
      }
    }

    if (!characterSnippet && channelProfile?.hostDescription) {
      const hostName = (channelProfile.hostName || '').toLowerCase();
      const hasHostMention = Boolean(hostName && sceneText.includes(hostName));
      const hasGenericCharacterMention = /\b(host|mc|người dẫn|nhân vật|chuyên gia|tôi|anh ấy|cô ấy|cậu bé|chàng trai|cô gái|narrator|protagonist|character)\b/i.test(sceneText);

      if (hasHostMention || hasGenericCharacterMention) {
        const hName = channelProfile.hostName ? `${channelProfile.hostName}: ` : '';
        characterSnippet = `featuring ${hName}${channelProfile.hostDescription.trim()}`;
      }
    }

    // 2. Detect Project Background Style
    const effectiveBg = (backgroundPrompt || channelProfile?.projectBackgroundPrompt || '').trim();
    const bgSnippet = effectiveBg ? `in ${effectiveBg}` : '';

    // 3. Assemble prompt layers: [Art Style] + [Camera Angle & Action] + [Character] + [Background] + [Quality Details]
    const promptParts: string[] = [stylePrefix, `${anglePrefix} of ${visualContent}`];
    if (characterSnippet) {
      promptParts.push(characterSnippet);
    }
    if (bgSnippet) {
      promptParts.push(bgSnippet);
    }
    promptParts.push('sharp focus, highly detailed, photorealistic');

    return promptParts.join(', ');
  }

  private buildMotionNote(shotIndex: number, totalShots: number): string {
    if (totalShots === 1) {
      return 'slow push in camera, steady shot';
    }
    if (shotIndex === 1) {
      return 'slow pan right, cinematic establishing movement';
    }
    if (shotIndex === 2) {
      return 'slow push in camera, tracking subject';
    }
    if (shotIndex === 3) {
      return 'subtle dynamic zoom, dramatic focal emphasis';
    }
    return 'smooth camera glide, natural transition';
  }
}

export const aiStudioStoryboardService = AiStudioStoryboardService.getInstance();
