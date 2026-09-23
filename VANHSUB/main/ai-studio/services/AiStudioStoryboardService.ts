/**
 * AiStudioStoryboardService
 * Probes real audio timing via ffprobe and generates audio-synchronized storyboards.
 * Conforms to spec-pipeline-video-automation.md §2 (Stages 4 & 5) and orchestrator_4/PROJECT.md.
 *
 * KEY FEATURE: AI-driven media_type decision (image vs video) per shot, based on:
 *   - Narration/visual_note content analysis (motion keywords, static keywords)
 *   - Scene duration vs model generation limits
 *   - Confidence scoring with fallback to 'image' when uncertain
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
  ShotMediaType,
  ShotConfidence,
} from '../storage/AiStudioDiskStorageManager';
import type { ChannelProfileConfig, FlowGranularity, StoryboardSynthesis, AiStudioLlmConfig } from '../types';
import { AiStudioLlmService } from './AiStudioLlmService';

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

// ============================================================================
// Media Type Decision Engine — keyword lists for narration analysis
// ============================================================================

/**
 * Strong MOTION signals → strongly prefer VIDEO.
 * These are actions that clearly need real animation to look right.
 */
const STRONG_VIDEO_KEYWORDS_VI = [
  // Movement verbs (Vietnamese)
  'đi', 'chạy', 'bước', 'tiến', 'lùi', 'nhảy', 'bay', 'bơi', 'leo', 'trèo', 'lăn', 'trượt',
  'quay', 'xoay', 'ngoái', 'ngoảnh', 'quay đầu', 'quay lại', 'quay sang',
  'vẫy', 'giơ tay', 'chỉ tay', 'bắt tay', 'ôm', 'đánh', 'đá', 'ném',
  'rơi', 'rớt', 'ngã', 'đổ', 'sập', 'vỡ', 'nổ', 'bùng cháy', 'cháy', 'lan',
  'mở', 'đóng', 'kéo', 'đẩy', 'xoay khóa', 'tắt', 'bật',
  'nhìn quanh', 'dáo dác', 'liếc', 'trừng', 'chớp mắt', 'khóc', 'cười phá lên',
  'lắc đầu', 'gật đầu', 'cúi đầu', 'ngẩng đầu',
  'tiến đến', 'tiến vào', 'bước ra', 'chạy đến', 'lao về phía',
  'biến đổi', 'chuyển hóa', 'thay đổi nét mặt', 'căng thẳng hiện rõ',
  'xe lăn bánh', 'tàu chạy', 'máy bay cất cánh', 'đoàn người diễu hành',
  'dòng nước chảy', 'sóng vỗ', 'gió thổi', 'lá rơi', 'tuyết rơi', 'mưa rơi',
  'mặt trời mọc', 'mặt trời lặn', 'đám mây di chuyển', 'bầu trời chuyển màu',
  'đám đông', 'biểu tình', 'chiến đấu', 'giao tranh',
  // English motion keywords
  'walks', 'walk', 'runs', 'run', 'jumps', 'jump', 'turns', 'turn', 'spins', 'spin',
  'moves', 'move', 'falls', 'fall', 'flies', 'fly', 'swims', 'swim',
  'reaches', 'reach', 'throws', 'throw', 'catches', 'catch', 'hits', 'hit',
  'explodes', 'explosion', 'crashes', 'crash', 'burns', 'fire spreads',
  'opens door', 'closes', 'pulls', 'pushes', 'rotating', 'spinning',
  'waves hand', 'nods', 'shakes head', 'looks around', 'glances',
  'car drives', 'train moves', 'plane takes off', 'crowd marches',
  'water flows', 'waves crash', 'wind blows', 'leaves fall', 'snow falls', 'rain falls',
  'sunrise', 'sunset', 'clouds move', 'sky changes',
];

/**
 * Strong STATIC signals → strongly prefer IMAGE.
 * These are contexts where the scene is inherently still / informational.
 */
const STRONG_IMAGE_KEYWORDS_VI = [
  // Static descriptive content
  'bức tranh', 'bức ảnh', 'hình ảnh', 'tấm ảnh', 'bản đồ', 'biểu đồ', 'đồ thị',
  'số liệu', 'thống kê', 'dữ liệu', 'con số',
  'trích dẫn', 'câu nói', 'danh ngôn', 'tựa đề', 'tiêu đề',
  'bối cảnh', 'khung cảnh yên tĩnh', 'quang cảnh tĩnh lặng',
  'giới thiệu', 'mô tả', 'thể hiện', 'minh họa',
  'không gian', 'địa điểm', 'nơi này', 'căn phòng', 'tòa nhà', 'cấu trúc',
  // Transitional / setup content
  'mở đầu', 'dẫn nhập', 'kết thúc', 'outro', 'fade in', 'fade out',
  // English static keywords
  'map', 'chart', 'graph', 'statistics', 'data', 'figure', 'table',
  'quote', 'caption', 'title', 'logo',
  'landscape', 'establishing shot', 'wide view', 'panorama',
  'portrait', 'headshot', 'still life', 'product shot',
  'infographic', 'diagram', 'illustration',
];

/**
 * Result from the media type decision engine.
 */
interface MediaTypeDecision {
  media_type: ShotMediaType;
  reason: string;
  confidence: ShotConfidence;
  videoScore: number;
  imageScore: number;
}

export interface GenerateStoryboardOptions {
  storage: AiStudioDiskStorageManager;
  script?: PipelineScriptData;
  timing?: PipelineTimingData;
  stylePromptPrefix?: string;
  negativePrompt?: string;
  decompositionThresholdSec?: number; // Default 5.0s
  channelProfile?: Partial<ChannelProfileConfig>;
  backgroundPrompt?: string;
  /**
   * Pacing / shot decomposition mode:
   * - 'single': 1:1 mapping (1 shot per script scene). Recommended default for AutoPilot.
   * - 'multi': Decompose scenes longer than thresholdSec into 2-4 shots.
   */
  shotMode?: 'single' | 'multi';
  /**
   * Mức độ chi tiết hoá phân cảnh (Granularity):
   * - 'detailed': Chi tiết theo từng câu (1 shot/câu, thời gian sản xuất & credit tối đa).
   * - 'balanced' (Mặc định): AI tự cân bằng, gộp các câu mô tả tĩnh liền kề thành 1 shot ảnh duy nhất kèm Ken Burns zoom/pan.
   * - 'fast': Ưu tiên gộp nhiều câu ngắn liền kề thành 1 shot dài hơn (~8-15s) để sản xuất nhanh nhất & tiết kiệm credit.
   */
  granularity?: FlowGranularity;
  /**
   * Maximum video clip duration the model supports per generation call (seconds).
   * If a video shot is longer than this, it will be split into multi-clip sub-shots.
   * Default: 8s (safe for most models; Veo supports up to 8s per call).
   */
  maxVideoClipDurationSec?: number;
  customPromptGenerator?: (
    scene: ScriptSceneItem,
    shotIndex: number,
    totalShots: number,
    durationSec: number
  ) => { image_prompt: string; motion_note: string };
  /**
   * Two-Tier Smart Storyboard Clustering (Milestone 2 / R2):
   * Groups consecutive dialogue lines into 4.0s - 10.0s shots.
   * Tier 1: LLM Semantic Clustering (AiStudioLlmService)
   * Tier 2: Deterministic Greedy Semantic Fallback
   */
  enableClustering?: boolean;
  llmConfig?: AiStudioLlmConfig;
  topic?: string;
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
  // 3. AI Media Type Decision Engine
  // ==========================================================================

  /**
   * Analyzes narration and visual note text to decide whether a shot
   * should be rendered as a static image (with optional Ken Burns) or
   * a real animated video clip.
   *
   * Decision rules (in priority order):
   * 1. If text contains STRONG motion keywords → video (high confidence)
   * 2. If text contains STRONG static keywords → image (high confidence)
   * 3. If shot duration < 2s → image (too short for meaningful video generation)
   * 4. If shot duration > 6s AND no motion keywords → image (long static content)
   * 5. If 2–6s AND motion keywords detected → video (medium confidence)
   * 6. Default: image (low confidence) — conservative choice
   */
  public decideMediaType(
    narration: string,
    visualNote: string | undefined,
    durationSec: number
  ): MediaTypeDecision {
    const text = `${narration} ${visualNote || ''}`.toLowerCase();

    let videoScore = 0;
    let imageScore = 0;
    const detectedVideoKeywords: string[] = [];
    const detectedImageKeywords: string[] = [];

    // Score VIDEO keywords
    for (const kw of STRONG_VIDEO_KEYWORDS_VI) {
      if (text.includes(kw.toLowerCase())) {
        videoScore += kw.split(' ').length > 1 ? 3 : 1; // Multi-word phrases score higher
        detectedVideoKeywords.push(kw);
        if (detectedVideoKeywords.length >= 5) break; // Cap for performance
      }
    }

    // Score IMAGE keywords
    for (const kw of STRONG_IMAGE_KEYWORDS_VI) {
      if (text.includes(kw.toLowerCase())) {
        imageScore += kw.split(' ').length > 1 ? 3 : 1;
        detectedImageKeywords.push(kw);
        if (detectedImageKeywords.length >= 5) break;
      }
    }

    // Rule 1: Too short for meaningful video (< 2s)
    if (durationSec < 2.0) {
      return {
        media_type: 'image',
        reason: `Shot quá ngắn (${durationSec}s < 2s) để tạo video có nghĩa — dùng ảnh tĩnh hiệu quả hơn`,
        confidence: 'high',
        videoScore,
        imageScore,
      };
    }

    // Rule 2: Strong VIDEO signal wins over IMAGE signal
    if (videoScore > 0 && videoScore >= imageScore) {
      const topKws = detectedVideoKeywords.slice(0, 3).join(', ');
      const confidence: ShotConfidence = videoScore >= 3 ? 'high' : videoScore >= 1 ? 'medium' : 'low';
      return {
        media_type: 'video',
        reason: `Phát hiện chuyển động/hành động trong nội dung: "${topKws}" — cần video thật để thể hiện`,
        confidence,
        videoScore,
        imageScore,
      };
    }

    // Rule 3: Strong IMAGE signal
    if (imageScore > 0 && imageScore > videoScore) {
      const topKws = detectedImageKeywords.slice(0, 3).join(', ');
      return {
        media_type: 'image',
        reason: `Nội dung mô tả tĩnh/thông tin ("${topKws}") — ảnh tĩnh đủ hiệu quả, không cần video`,
        confidence: imageScore >= 3 ? 'high' : 'medium',
        videoScore,
        imageScore,
      };
    }

    // Rule 4: Long duration (> 6s) with no clear motion → image (cost efficient)
    if (durationSec > 6.0 && videoScore === 0) {
      return {
        media_type: 'image',
        reason: `Scene dài (${durationSec}s) nhưng không có tín hiệu chuyển động rõ — dùng ảnh tĩnh tránh tốn chi phí generate video không cần thiết`,
        confidence: 'medium',
        videoScore,
        imageScore,
      };
    }

    // Rule 5: Medium duration (2–6s) with no clear signal → default to image (conservative, low confidence)
    return {
      media_type: 'image',
      reason: `Không phát hiện tín hiệu rõ ràng về chuyển động hay nội dung tĩnh — mặc định chọn ảnh tĩnh (an toàn, rẻ hơn); nên xem lại thủ công`,
      confidence: 'low',
      videoScore,
      imageScore,
    };
  }

  // ==========================================================================
  // 3.5. Deterministic Greedy Semantic Clustering Helpers (Milestone 2 / R2)
  // ==========================================================================

  /**
   * Checks if there is a discernible context shift between two adjacent script scenes.
   */
  public hasSceneContextShift(sceneA: ScriptSceneItem, sceneB: ScriptSceneItem): boolean {
    if (!sceneA || !sceneB) return false;
    const textB = (sceneB.narration || '').toLowerCase().trim();

    // Context shift transitions: time leaps, sudden turns, location changes
    const shiftKeywords = [
      'tuy nhiên', 'nhưng rồi', 'bất ngờ', 'đột nhiên', 'mặt khác',
      'sau đó', 'vài năm sau', 'năm 18', 'năm 19', 'năm 20', 'thế kỷ',
      'ngày hôm sau', 'vào đêm', 'buổi sáng', 'sáng hôm sau',
      'bên ngoài', 'trong khi đó', 'ngược lại', 'bước sang', 'đến khi'
    ];

    for (const kw of shiftKeywords) {
      if (textB.startsWith(kw) || textB.includes(` ${kw} `) || textB.includes(` ${kw},`)) {
        return true;
      }
    }

    return false;
  }

  private finalizeDeterministicCluster(
    group: Array<{ scene: ScriptSceneItem; timing: SceneTimingItem; index: number }>,
    clusterIndex: number
  ) {
    const first = group[0];
    const last = group[group.length - 1];
    const start_sec = Math.round(first.timing.start_sec * 100) / 100;
    const end_sec = Math.round(last.timing.end_sec * 100) / 100;
    const duration_sec = Math.round((end_sec - start_sec) * 100) / 100;
    const assigned_indices = group.map((g) => g.index);
    const assigned_scene_ids = group.map((g) => g.scene.scene_id);
    const dialogue_lines = group.map((g) => g.scene.narration);
    const combined_narration = dialogue_lines.join(' ');
    const visual_notes = group.map((g) => g.scene.visual_note).filter(Boolean) as string[];

    return {
      cluster_index: clusterIndex,
      assigned_indices,
      assigned_scene_ids,
      dialogue_lines,
      combined_narration,
      visual_notes,
      start_sec,
      end_sec,
      duration_sec,
    };
  }

  private mergeIntoLastDeterministicCluster(
    lastCluster: {
      cluster_index: number;
      assigned_indices: number[];
      assigned_scene_ids: string[];
      dialogue_lines: string[];
      combined_narration: string;
      visual_notes: string[];
      start_sec: number;
      end_sec: number;
      duration_sec: number;
    },
    group: Array<{ scene: ScriptSceneItem; timing: SceneTimingItem; index: number }>
  ) {
    const lastItem = group[group.length - 1];
    lastCluster.end_sec = Math.round(lastItem.timing.end_sec * 100) / 100;
    lastCluster.duration_sec = Math.round((lastCluster.end_sec - lastCluster.start_sec) * 100) / 100;
    lastCluster.assigned_indices.push(...group.map((g) => g.index));
    lastCluster.assigned_scene_ids.push(...group.map((g) => g.scene.scene_id));
    const newLines = group.map((g) => g.scene.narration);
    lastCluster.dialogue_lines.push(...newLines);
    lastCluster.combined_narration = lastCluster.dialogue_lines.join(' ');
    const newVisual = group.map((g) => g.scene.visual_note).filter(Boolean) as string[];
    lastCluster.visual_notes.push(...newVisual);
  }

  /**
   * Deterministic Greedy Semantic Clustering fallback:
   * Groups consecutive dialogue lines into 4.0s - 10.0s shots (ideal 5s - 8s).
    * Directly extracts start_sec and end_sec from timing.json to guarantee 0.00s drift.
   */
  public clusterSentencesDeterministically(
    scriptScenes: ScriptSceneItem[],
    timingScenes: SceneTimingItem[],
    granularityOrMinSec: FlowGranularity | number = 'balanced',
    customMaxSec?: number,
    customIdealSec?: number
  ): Array<{
    cluster_index: number;
    assigned_indices: number[];
    assigned_scene_ids: string[];
    dialogue_lines: string[];
    combined_narration: string;
    visual_notes: string[];
    start_sec: number;
    end_sec: number;
    duration_sec: number;
  }> {
    let granularity: FlowGranularity = 'balanced';
    let targetMinSec: number;
    let idealMaxSec: number;
    let targetMaxSec: number;

    if (typeof granularityOrMinSec === 'number') {
      targetMinSec = granularityOrMinSec;
      targetMaxSec = customMaxSec ?? 12.0;
      idealMaxSec = customIdealSec ?? 9.5;
    } else {
      granularity = granularityOrMinSec || 'balanced';
      switch (granularity) {
        case 'fast':
          // Gộp tối đa: 2–4 câu/shot (lý tưởng 7–12s, trần 16s)
          targetMinSec = 6.0;
          idealMaxSec = 12.0;
          targetMaxSec = 16.0;
          break;
        case 'detailed':
          // Tách chi tiết: 1–2 câu/shot (lý tưởng 3–5.5s, trần 7s)
          targetMinSec = 2.5;
          idealMaxSec = 5.5;
          targetMaxSec = 7.0;
          break;
        case 'balanced':
        default:
          // Cân bằng điện ảnh: 2–3 câu/shot (lý tưởng 5–9.5s, trần 12s)
          targetMinSec = 4.0;
          idealMaxSec = 9.5;
          targetMaxSec = 12.0;
          break;
      }
    }

    console.log(
      `🔀 [GRANULARITY ENGINE V2 ACTIVE] Chế độ Granularity: "${granularity.toUpperCase()}" ` +
      `(min: ${targetMinSec}s, ideal: ${idealMaxSec}s, max: ${targetMaxSec}s)`
    );

    const timingMap = new Map<string, SceneTimingItem>();
    for (const t of timingScenes) {
      timingMap.set(t.scene_id, t);
    }

    const items = scriptScenes.map((sc, idx) => {
      const t = timingMap.get(sc.scene_id) || timingScenes[idx] || {
        scene_id: sc.scene_id,
        start_sec: 0,
        end_sec: 4.0,
        duration_sec: 4.0,
      };
      return {
        scene: sc,
        timing: t,
        index: idx + 1,
      };
    });

    const clusters: Array<{
      cluster_index: number;
      assigned_indices: number[];
      assigned_scene_ids: string[];
      dialogue_lines: string[];
      combined_narration: string;
      visual_notes: string[];
      start_sec: number;
      end_sec: number;
      duration_sec: number;
    }> = [];

    let currentGroup: Array<{ scene: ScriptSceneItem; timing: SceneTimingItem; index: number }> = [];
    let currentDur = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const dur = item.timing.duration_sec || 3.5;
      const isStatic = this.isStaticOrDescriptiveNarration(item.scene.narration, item.scene.visual_note);

      // Nếu đang có nhóm: kiểm tra xem có nên chốt shot trước khi thêm câu này
      if (currentGroup.length > 0) {
        const nextDur = currentDur + dur;
        const wouldExceedMax = nextDur > targetMaxSec;
        const wouldExceedIdeal = currentDur >= targetMinSec && (nextDur > idealMaxSec);

        const prevItem = currentGroup[currentGroup.length - 1];
        const prevStatic = this.isStaticOrDescriptiveNarration(prevItem.scene.narration, prevItem.scene.visual_note);
        const bothStatic = prevStatic && isStatic;
        const hasShift = this.hasSceneContextShift(prevItem.scene, item.scene);

        let shouldSeal = false;
        let sealReason = '';

        if (wouldExceedMax) {
          shouldSeal = true;
          sealReason = `Thời lượng vượt trần tối đa (${nextDur.toFixed(1)}s > ${targetMaxSec}s)`;
        } else if (hasShift && currentDur >= targetMinSec) {
          shouldSeal = true;
          sealReason = `Phát hiện chuyển ngữ cảnh/bối cảnh (${prevItem.scene.scene_id} -> ${item.scene.scene_id})`;
        } else if (wouldExceedIdeal) {
          shouldSeal = true;
          sealReason = `Đạt vùng thời lượng lý tưởng (${currentDur.toFixed(1)}s >= ${targetMinSec}s, thêm câu thành ${nextDur.toFixed(1)}s > ${idealMaxSec}s)`;
        }

        if (shouldSeal) {
          console.log(
            `[GRANULARITY V2] 🔒 Chốt Shot #${clusters.length + 1} (${currentGroup.map(g => '#' + g.index).join(', ')}): ` +
            `${currentDur.toFixed(1)}s — Lý do: ${sealReason}`
          );
          clusters.push(this.finalizeDeterministicCluster(currentGroup, clusters.length + 1));
          currentGroup = [];
          currentDur = 0;
        } else {
          console.log(
            `[GRANULARITY V2] ➕ Gộp câu #${item.index} (${dur.toFixed(1)}s, static=${isStatic}) vào Shot #${clusters.length + 1} ` +
            `→ Thời lượng mới: ${nextDur.toFixed(1)}s`
          );
        }
      }

      currentGroup.push(item);
      currentDur += dur;
    }

    if (currentGroup.length > 0) {
      if (
        clusters.length > 0 &&
        currentDur < targetMinSec &&
        (clusters[clusters.length - 1].duration_sec + currentDur <= targetMaxSec)
      ) {
        console.log(
          `[GRANULARITY V2] 🧲 Gộp câu đuôi (${currentGroup.map(g => '#' + g.index).join(', ')}) vào Shot #${clusters.length} để tránh shot quá ngắn.`
        );
        this.mergeIntoLastDeterministicCluster(clusters[clusters.length - 1], currentGroup);
      } else {
        console.log(
          `[GRANULARITY V2] 🔒 Chốt Shot cuối #${clusters.length + 1} (${currentGroup.map(g => '#' + g.index).join(', ')}): ` +
          `${currentDur.toFixed(1)}s`
        );
        clusters.push(this.finalizeDeterministicCluster(currentGroup, clusters.length + 1));
      }
    }

    const totalDur = clusters.reduce((s, c) => s + c.duration_sec, 0);
    const avgDur = clusters.length > 0 ? (totalDur / clusters.length).toFixed(1) : '0';
    console.log(
      `📊 [GRANULARITY ENGINE V2 SUMMARY]\n` +
      `   * Mức thiết lập: ${granularity.toUpperCase()}\n` +
      `   * Tổng câu thoại gốc: ${scriptScenes.length}\n` +
      `   * Tổng shot được tạo ra: ${clusters.length}\n` +
      `   * Tỷ lệ nén: ${clusters.length}/${scriptScenes.length} (${Math.round((clusters.length / scriptScenes.length) * 100)}%)\n` +
      `   * Thời lượng trung bình: ${avgDur}s/shot`
    );

    return clusters;
  }

  // ==========================================================================
  // 4. Storyboard Generation & Validation (Phase 5 / spec §2)
  // ==========================================================================

  /**
   * Generates storyboard scenes and decomposed shots from script and probed timing.
   * Each shot receives an AI-decided media_type ('image' | 'video') and a human-readable
   * reason for the decision — no black-box outputs.
   *
   * Multi-clip splitting: if a video shot exceeds maxVideoClipDurationSec, it is split
   * into consecutive sub-shots (e.g. scene_01_shot_2a, scene_01_shot_2b) so each
   * generation call stays within model limits.
   *
   * Enforces absolute uniqueness of shot_ids formatted as {scene_id}_shot_{n}.
   * Persists to 04_storyboard/storyboard.json and updates index.json.
   */
  public async generateStoryboard(
    options: GenerateStoryboardOptions
  ): Promise<PipelineStoryboardData> {
    const { storage } = options;
    storage.ensureDirectories();

    const maxVideoClipSec = options.maxVideoClipDurationSec || 8.0;

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
    const granularity: FlowGranularity = options.granularity || (options.shotMode === 'multi' ? 'detailed' : 'balanced');
    const thresholdSec = options.decompositionThresholdSec || 5.0;
    const isSingleShot = (options.shotMode === 'single' || granularity === 'fast') && options.shotMode !== 'multi';

    const processedScenes = script.scenes.map((scriptScene) => {
      const timingItem = timingMap.get(scriptScene.scene_id);
      if (!timingItem) {
        throw new Error(
          `Missing timing data for scene "${scriptScene.scene_id}". Ensure audio timing extraction has run.`
        );
      }
      return {
        scene_id: scriptScene.scene_id,
        narration: scriptScene.narration,
        visual_note: scriptScene.visual_note,
        duration_sec: timingItem.duration_sec,
      };
    });

    const enableClustering = options.enableClustering === true ||
      (options.enableClustering !== false &&
       options.shotMode !== 'single' &&
       options.shotMode !== 'multi' &&
       !options.customPromptGenerator &&
       script.scenes.length >= 4);

    let storyboardScenes: StoryboardSceneItem[] = [];

    if (enableClustering) {
      let clusteredScenes: StoryboardSceneItem[] | null = null;

      // Tier 1: Try LLM Semantic Clustering
      if (options.llmConfig) {
        try {
          const llmResult = await AiStudioLlmService.getInstance().clusterAndGenerateStoryboard({
            scriptLines: script.scenes,
            timingData: timing,
            stylePromptPrefix: stylePrefix,
            negativePrompt: options.negativePrompt,
            channelProfile: options.channelProfile,
            backgroundPrompt: effectiveBgPrompt,
            config: options.llmConfig,
            topic: options.topic || storage.projectId,
          });

          if (llmResult && Array.isArray(llmResult.shots) && llmResult.shots.length > 0) {
            const llmScenes: StoryboardSceneItem[] = [];
            let prevShotId: string | undefined = undefined;

            for (let idx = 0; idx < llmResult.shots.length; idx++) {
              const s = llmResult.shots[idx];
              const sceneId = `scene_${String(idx + 1).padStart(2, '0')}`;
              const assignedIndices: number[] = Array.isArray(s.assigned_sentences) && s.assigned_sentences.length > 0
                ? s.assigned_sentences
                : [idx + 1];

              const firstIdx = Math.max(0, Math.min(script.scenes.length - 1, assignedIndices[0] - 1));
              const lastIdx = Math.max(firstIdx, Math.min(script.scenes.length - 1, assignedIndices[assignedIndices.length - 1] - 1));

              const firstTiming = timing.scenes[firstIdx];
              const lastTiming = timing.scenes[lastIdx];
              const start_sec = firstTiming ? Math.round(firstTiming.start_sec * 100) / 100 : 0;
              const end_sec = lastTiming ? Math.round(lastTiming.end_sec * 100) / 100 : (start_sec + 5.0);
              const duration_sec = Math.round((end_sec - start_sec) * 100) / 100;

              const assigned_scene_ids = script.scenes.slice(firstIdx, lastIdx + 1).map((sc) => sc.scene_id);
              const dialogue_lines = script.scenes.slice(firstIdx, lastIdx + 1).map((sc) => sc.narration);
              const combined_narration = dialogue_lines.join(' ');

              const shotId = `${sceneId}_shot_1`;
              const shot: StoryboardShotItem = {
                shot_id: shotId,
                shot_index: 1,
                start_sec,
                duration_sec,
                expected_duration_sec: duration_sec,
                assigned_sentences: assignedIndices,
                assigned_scene_ids,
                dialogue_lines,
                previous_shot_id: prevShotId,
                image_prompt: s.image_prompt,
                motion_note: s.motion_note || 'Slow cinematic push in',
                media_type: s.media_type === 'video' ? 'video' : 'image',
                reason: s.reason || `LLM phân cảnh cụm ${assigned_scene_ids.join(', ')}`,
                confidence: s.confidence || 'high',
              };
              prevShotId = shotId;

              llmScenes.push({
                scene_id: sceneId,
                start_sec,
                end_sec,
                duration_sec,
                narration: combined_narration,
                assigned_sentences: assignedIndices,
                assigned_scene_ids,
                shots: [shot],
              });
            }

            if (llmScenes.length > 0) {
              clusteredScenes = llmScenes;
            }
          }
        } catch (llmErr) {
          console.warn('[AiStudioStoryboardService] Tier 1 LLM clustering failed, falling back to Tier 2 Greedy Fallback:', llmErr);
        }
      }

      // Tier 2: Deterministic Greedy Semantic Clustering fallback
      if (!clusteredScenes) {
        const clusters = this.clusterSentencesDeterministically(script.scenes, timing.scenes, granularity);
        const fallbackScenes: StoryboardSceneItem[] = [];
        let prevShotId: string | undefined = undefined;

        for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
          const cluster = clusters[cIdx];
          const sceneId = `scene_${String(cIdx + 1).padStart(2, '0')}`;
          const shotId = `${sceneId}_shot_1`;

          const decision = this.decideMediaType(
            cluster.combined_narration,
            cluster.visual_notes.join('. '),
            cluster.duration_sec
          );
          const syntheticScene: ScriptSceneItem = {
            scene_id: sceneId,
            narration: cluster.combined_narration,
            visual_note: cluster.visual_notes.join('. ') || cluster.combined_narration,
          };
          const imagePrompt = this.buildShotPrompt(
            syntheticScene,
            1,
            1,
            stylePrefix,
            options.channelProfile,
            effectiveBgPrompt
          );
          const motionNote = this.buildMotionNote(1, 1, decision.media_type);

          const shot: StoryboardShotItem = {
            shot_id: shotId,
            shot_index: 1,
            start_sec: cluster.start_sec,
            duration_sec: cluster.duration_sec,
            expected_duration_sec: cluster.duration_sec,
            assigned_sentences: cluster.assigned_indices,
            assigned_scene_ids: cluster.assigned_scene_ids,
            dialogue_lines: cluster.dialogue_lines,
            previous_shot_id: prevShotId,
            image_prompt: imagePrompt,
            motion_note: motionNote,
            media_type: decision.media_type,
            reason: decision.reason,
            confidence: decision.confidence,
          };
          prevShotId = shotId;

          fallbackScenes.push({
            scene_id: sceneId,
            start_sec: cluster.start_sec,
            end_sec: cluster.end_sec,
            duration_sec: cluster.duration_sec,
            narration: cluster.combined_narration,
            assigned_sentences: cluster.assigned_indices,
            assigned_scene_ids: cluster.assigned_scene_ids,
            shots: [shot],
          });
        }

        clusteredScenes = fallbackScenes;
      }

      storyboardScenes = clusteredScenes || [];
    } else {
      // Non-clustered mode (1:1 or per-scene multi-shot decomposition)
      let timelineSec = 0;
      let prevShotId: string | undefined = undefined;

      for (let scIdx = 0; scIdx < processedScenes.length; scIdx++) {
        const scriptScene = processedScenes[scIdx];
        const durationSec = scriptScene.duration_sec;
        const timingItem = timingMap.get(scriptScene.scene_id);
        const sceneStartSec = timingItem ? timingItem.start_sec : timelineSec;
        let shotCurrentSec = sceneStartSec;
        const shots: StoryboardShotItem[] = [];

        if (options.customPromptGenerator) {
          // Use custom shot planner if provided — still apply AI media_type decision
          const numShots = isSingleShot
            ? 1
            : durationSec > thresholdSec
            ? Math.max(2, Math.ceil(durationSec / 4.0))
            : 1;
          const baseDur = Math.round((durationSec / numShots) * 100) / 100;

          for (let i = 1; i <= numShots; i++) {
            const shotId = `${scriptScene.scene_id}_shot_${i}`;
            const isLast = i === numShots;
            const shotDur = isLast ? Math.round((durationSec - baseDur * (numShots - 1)) * 100) / 100 : baseDur;
            const customPrompt = options.customPromptGenerator(scriptScene as any, i, numShots, shotDur);
            const decision = this.decideMediaType(scriptScene.narration, scriptScene.visual_note, shotDur);

            shots.push({
              shot_id: shotId,
              shot_index: i,
              start_sec: Math.round(shotCurrentSec * 100) / 100,
              duration_sec: shotDur,
              expected_duration_sec: shotDur,
              assigned_sentences: [scIdx + 1],
              assigned_scene_ids: [scriptScene.scene_id],
              dialogue_lines: [scriptScene.narration],
              previous_shot_id: prevShotId,
              image_prompt: customPrompt.image_prompt,
              motion_note: customPrompt.motion_note,
              media_type: decision.media_type,
              reason: decision.reason,
              confidence: decision.confidence,
            });
            prevShotId = shotId;
            shotCurrentSec += shotDur;
          }
        } else {
          // Default intelligent duration-based decomposition with AI media_type decision
          const isStaticScene = granularity === 'balanced' &&
            this.isStaticOrDescriptiveNarration(scriptScene.narration, scriptScene.visual_note) &&
            durationSec <= 10.0;

          const rawShots = (isSingleShot || isStaticScene)
            ? [{ index: 1, durationSec }]
            : this.decomposeSceneIntoRawShots(scriptScene as any, durationSec, thresholdSec);

          for (const raw of rawShots) {
            const decision = isStaticScene
              ? {
                  media_type: 'image' as const,
                  reason: 'Cân bằng pacing: Phân cảnh mô tả tĩnh được giữ làm 1 shot ảnh kèm hiệu ứng Ken Burns để chống giật hình và tối ưu chi phí.',
                  confidence: 'high' as const,
                  videoScore: 0,
                  imageScore: 3,
                }
              : this.decideMediaType(scriptScene.narration, scriptScene.visual_note, raw.durationSec);
            const imagePrompt = this.buildShotPrompt(scriptScene as any, raw.index, rawShots.length, stylePrefix, options.channelProfile, effectiveBgPrompt);
            const motionNote = isStaticScene
              ? 'Ken Burns subtle pan and slow zoom in'
              : this.buildMotionNote(raw.index, rawShots.length, decision.media_type);

            // Multi-clip splitting: if video shot exceeds model limit, split into sub-shots
            if (decision.media_type === 'video' && raw.durationSec > maxVideoClipSec && !isSingleShot) {
              const subShots = this.splitIntoMultiClips(
                scriptScene.scene_id,
                raw.index,
                raw.durationSec,
                maxVideoClipSec,
                imagePrompt,
                motionNote,
                decision,
                Math.round(shotCurrentSec * 100) / 100,
                [scIdx + 1],
                [scriptScene.scene_id],
                [scriptScene.narration],
                prevShotId
              );
              shots.push(...subShots);
              if (subShots.length > 0) {
                prevShotId = subShots[subShots.length - 1].shot_id;
              }
              shotCurrentSec += raw.durationSec;
            } else {
              const shotId = `${scriptScene.scene_id}_shot_${raw.index}`;
              shots.push({
                shot_id: shotId,
                shot_index: raw.index,
                start_sec: Math.round(shotCurrentSec * 100) / 100,
                duration_sec: raw.durationSec,
                expected_duration_sec: raw.durationSec,
                assigned_sentences: [scIdx + 1],
                assigned_scene_ids: [scriptScene.scene_id],
                dialogue_lines: [scriptScene.narration],
                previous_shot_id: prevShotId,
                image_prompt: imagePrompt,
                motion_note: motionNote,
                media_type: decision.media_type,
                reason: decision.reason,
                confidence: decision.confidence,
              });
              prevShotId = shotId;
              shotCurrentSec += raw.durationSec;
            }
          }
        }

        // Re-index shot_index sequentially after any multi-clip expansion
        shots.forEach((shot, idx) => {
          (shot as any).shot_index = idx + 1;
        });

        // Duration integrity check: total shots must match scene duration (±0.1s)
        const totalShotDur = shots.reduce((acc, s) => acc + (s.expected_duration_sec || 0), 0);
        const diff = Math.abs(Math.round((totalShotDur - durationSec) * 100) / 100);
        if (diff > 0.1) {
          // Correct by adjusting last shot
          const lastShot = shots[shots.length - 1];
          const adjustment = durationSec - (totalShotDur - (lastShot.expected_duration_sec || 0));
          lastShot.expected_duration_sec = Math.round(adjustment * 100) / 100;
          lastShot.duration_sec = lastShot.expected_duration_sec;
        }

        storyboardScenes.push({
          scene_id: scriptScene.scene_id,
          start_sec: sceneStartSec,
          end_sec: sceneStartSec + durationSec,
          duration_sec: durationSec,
          narration: scriptScene.narration,
          assigned_sentences: [scIdx + 1],
          assigned_scene_ids: [scriptScene.scene_id],
          shots,
        });

        timelineSec = sceneStartSec + durationSec;
      }
    }

    // 4. Bước TỔNG HỢP (Synthesis) & Tính toán ước tính sản xuất
    const synthesis = this.synthesizeStoryboard(storyboardScenes, granularity);

    const storyboardData: PipelineStoryboardData = {
      project_id: storage.projectId,
      scenes: storyboardScenes,
      synthesis,
    };

    // 5. Validate storyboard (uniqueness, required fields)
    this.validateStoryboard(storyboardData);

    // 6. Persist 04_storyboard/storyboard.json
    storage.saveStoryboard(storyboardData);

    // 7. Update index.json scene and shot metadata
    for (const sc of storyboardScenes) {
      storage.updateSceneMetadata(sc.scene_id, {
        narration: sc.narration,
        timing: typeof sc.start_sec === 'number' && typeof sc.duration_sec === 'number'
          ? {
              start_sec: sc.start_sec,
              end_sec: sc.end_sec || (sc.start_sec + sc.duration_sec),
              duration_sec: sc.duration_sec,
            }
          : undefined,
      });

      for (const shot of sc.shots) {
        storage.updateShotMetadata(sc.scene_id, shot.shot_id, {
          image_prompt_used: shot.image_prompt,
          motion_note: shot.motion_note,
          start_sec: shot.start_sec,
          duration_sec: shot.duration_sec,
          expected_duration_sec: shot.expected_duration_sec,
          assigned_sentences: shot.assigned_sentences,
          assigned_scene_ids: shot.assigned_scene_ids,
          dialogue_lines: shot.dialogue_lines,
          previous_shot_id: shot.previous_shot_id,
          status: 'pending',
        });
      }
    }

    // 8. Append action log
    const totalShots = synthesis.total_shots;
    const videoShots = synthesis.video_shots;
    const imageShots = synthesis.image_shots;
    storage.appendActionLog({
      ts: new Date().toISOString(),
      action: 'storyboard',
      target: '04_storyboard/storyboard.json',
      retry: 0,
      status: 'ok',
      details: {
        scene_count: storyboardScenes.length,
        shot_count: totalShots,
        image_shots: imageShots,
        video_shots: videoShots,
        avg_duration_per_shot_sec: synthesis.avg_duration_per_shot_sec,
        estimated_production_time_sec: synthesis.estimated_production_time_sec,
        estimated_credits: synthesis.estimated_credits,
        granularity,
      },
    });

    console.log(
      `[AiStudioStoryboardService] ✅ Storyboard tạo xong [${granularity.toUpperCase()}]: ${storyboardScenes.length} scene, ${totalShots} shot (${imageShots} ảnh / ${videoShots} video, TB ${synthesis.avg_duration_per_shot_sec}s/shot, ~${Math.round(synthesis.estimated_production_time_sec / 60)} phút, ~${synthesis.estimated_credits} credits)`
    );
    if (synthesis.is_too_fragmented && synthesis.warning) {
      console.warn(`[AiStudioStoryboardService] ⚠️ ${synthesis.warning}`);
    }

    return storyboardData;
  }

  /**
   * Phân tích nội dung narration và visual_note để phát hiện các câu mô tả tĩnh,
   * thiếu chuyển động mạnh, hoặc lặp lại bối cảnh — phục vụ gom cụm phân cảnh.
   */
  public isStaticOrDescriptiveNarration(narration: string, visualNote?: string): boolean {
    const rawText = (narration + ' ' + (visualNote || '')).toLowerCase();

    // Loại trừ các cụm từ dễ nhầm lẫn sang động từ mạnh
    const text = rawText
      .replace(/đánh giá/g, '')
      .replace(/đánh dấu/g, '')
      .replace(/đánh đổi/g, '')
      .replace(/hành động cụ thể/g, '');

    // Động từ chuyển động mạnh hoặc biến cố kịch bản gay cấn -> KHÔNG PHẢI TĨNH
    const dynamicKeywords = [
      'chạy', 'nhảy', 'bay', 'lao', 'đuổi', 'chiến đấu', ' nổ ', ' bùng nổ', 'rơi', 'sụp đổ',
      'phóng', 'va chạm', 'biến hình', 'tấn công', 'chém', 'bắn', 'bùng phát', 'di cư',
      'run', 'jump', 'fly', 'chase', 'fight', 'explode', 'fall', 'crash', 'transform', 'dash', 'attack'
    ];
    if (dynamicKeywords.some(kw => text.includes(kw))) {
      return false;
    }

    // Từ khóa mô tả tĩnh, nhận định, bối cảnh chung, suy nghĩ, giải thích, lịch sử
    const staticKeywords = [
      'là một', 'vẫn là', 'đang đứng', 'ngồi im', 'tĩnh lặng', 'bầu trời', 'khung cảnh',
      'nhìn chung', 'như đã biết', 'không gian', 'mô tả', 'cảnh quan', 'vẻ đẹp', 'được biết',
      'ý nghĩa', 'lý do', 'thực tế', 'trong khi đó', 'thời bấy giờ', 'xung quanh', 'tổng quan',
      'lịch sử', 'hình thành', 'phát triển', 'bắt đầu', 'ra đời', 'xuất hiện', 'nguồn gốc',
      'thời kỳ', 'giai đoạn', 'câu chuyện', 'giới thiệu', 'thế giới',
      'standing', 'sitting', 'silent', 'landscape', 'scenery', 'atmosphere', 'calm', 'peaceful', 'overview', 'history'
    ];
    if (staticKeywords.some(kw => text.includes(kw))) {
      return true;
    }

    // Nếu câu ngắn dưới 55 ký tự và không có động từ mạnh -> xem là mô tả bối cảnh
    return text.trim().length < 55;
  }

  /**
   * Bước TỔNG HỢP (Storyboard Synthesis) & Đề xuất / Dự toán Sản xuất
   */
  public synthesizeStoryboard(
    scenes: StoryboardSceneItem[],
    granularity: FlowGranularity = 'balanced'
  ): StoryboardSynthesis {
    const totalShots = scenes.reduce((sum, s) => sum + s.shots.length, 0);
    const videoShots = scenes.reduce((sum, s) => sum + s.shots.filter(sh => sh.media_type === 'video').length, 0);
    const imageShots = totalShots - videoShots;
    const totalDurationSec = scenes.reduce((sum, s) => sum + s.duration_sec, 0);
    const avgDurationPerShotSec = totalShots > 0 ? Math.round((totalDurationSec / totalShots) * 10) / 10 : 0;
    const isTooFragmented = avgDurationPerShotSec > 0 && avgDurationPerShotSec < 2.5;

    let warning: string | undefined;
    if (isTooFragmented) {
      warning = `Phân cảnh đang quá vụn (trung bình ${avgDurationPerShotSec}s/shot < 2.5s). Khuyến nghị chuyển sang mức "Cân bằng" hoặc "Nhanh" để gộp các câu thoại liền kề, tối ưu thời gian sản xuất và tiết kiệm credit.`;
    }

    // Thời gian ước tính: ~22s cho ảnh và ~65s cho video
    const estimatedProductionTimeSec = imageShots * 22 + videoShots * 65;
    // Credit ước tính: 1 credit / ảnh, 5 credits / video
    const estimatedCredits = imageShots * 1 + videoShots * 5;

    return {
      total_shots: totalShots,
      image_shots: imageShots,
      video_shots: videoShots,
      total_duration_sec: Math.round(totalDurationSec * 10) / 10,
      avg_duration_per_shot_sec: avgDurationPerShotSec,
      is_too_fragmented: isTooFragmented,
      warning,
      estimated_production_time_sec: estimatedProductionTimeSec,
      estimated_credits: estimatedCredits,
      granularity,
    };
  }

  // ==========================================================================
  // 5. Multi-Clip Splitting (spec: exceed model generation limit)
  // ==========================================================================

  /**
   * Splits a single video shot that exceeds maxVideoClipSec into consecutive
   * sub-shots, each within model limits. Sub-shot IDs use suffix _a, _b, _c...
   * e.g. scene_01_shot_2a, scene_01_shot_2b
   */
  private splitIntoMultiClips(
    sceneId: string,
    shotIndex: number,
    totalDurationSec: number,
    maxClipSec: number,
    imagePrompt: string,
    motionNote: string,
    decision: MediaTypeDecision,
    startSec = 0,
    assignedSentences: number[] = [1],
    assignedSceneIds: string[] = [sceneId],
    dialogueLines: string[] = [],
    initialPreviousShotId?: string
  ): StoryboardShotItem[] {
    const subShots: StoryboardShotItem[] = [];
    const numClips = Math.ceil(totalDurationSec / maxClipSec);
    const clipDur = Math.round((totalDurationSec / numClips) * 100) / 100;
    const suffixes = 'abcdefghijklmnopqrstuvwxyz';

    console.log(
      `[AiStudioStoryboardService] 🎬 Multi-clip split: ${sceneId}_shot_${shotIndex} (${totalDurationSec}s) → ${numClips} clips à ${clipDur}s (limit: ${maxClipSec}s/clip)`
    );

    let currentStart = startSec;
    let prevId = initialPreviousShotId;

    for (let c = 0; c < numClips; c++) {
      const isLast = c === numClips - 1;
      const subDur = isLast
        ? Math.round((totalDurationSec - clipDur * (numClips - 1)) * 100) / 100
        : clipDur;
      const shotId = `${sceneId}_shot_${shotIndex}${suffixes[c]}`;

      subShots.push({
        shot_id: shotId,
        shot_index: shotIndex,
        start_sec: currentStart,
        duration_sec: subDur,
        expected_duration_sec: subDur,
        assigned_sentences: assignedSentences,
        assigned_scene_ids: assignedSceneIds,
        dialogue_lines: dialogueLines,
        previous_shot_id: prevId,
        image_prompt: imagePrompt,
        motion_note: c === 0 ? motionNote : `continuous: ${motionNote}`,
        media_type: 'video',
        reason: `${decision.reason} [Multi-clip ${c + 1}/${numClips}: shot dài ${totalDurationSec}s vượt giới hạn ${maxClipSec}s/lần generate]`,
        confidence: decision.confidence,
      });

      prevId = shotId;
      currentStart = Math.round((currentStart + subDur) * 100) / 100;
    }

    return subShots;
  }

  // ==========================================================================
  // 6. Storyboard Validation
  // ==========================================================================

  /**
   * Enforces:
   * - Absolute uniqueness of all shot_ids across the storyboard
   * - Hierarchical format {scene_id}_shot_{n}
   * - `media_type` must be 'image' or 'video'
   * - `reason` must be non-empty string
   * Throws a descriptive error if any constraint is violated.
   */
  public validateStoryboard(storyboard: PipelineStoryboardData): void {
    if (!storyboard || !Array.isArray(storyboard.scenes)) {
      throw new Error('Invalid storyboard data: missing scenes array');
    }

    const seenShotIds = new Map<string, string>(); // shot_id → scene_id

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

        // Validate media_type (if present)
        if (shot.media_type !== undefined && shot.media_type !== 'image' && shot.media_type !== 'video') {
          throw new Error(
            `Shot "${shot.shot_id}" has invalid or missing media_type: "${shot.media_type}". Must be "image" or "video".`
          );
        }

        // Validate reason is non-empty (if media_type is present)
        if (shot.media_type !== undefined && (!shot.reason || typeof shot.reason !== 'string' || shot.reason.trim().length === 0)) {
          throw new Error(
            `Shot "${shot.shot_id}" is missing required "reason" field. Every shot must explain why image/video was chosen.`
          );
        }

        seenShotIds.set(shot.shot_id, sc.scene_id);
      }
    }
  }

  // ==========================================================================
  // 7. Internal Helpers
  // ==========================================================================

  /**
   * Decomposes a scene's total duration into raw shot time slots.
   * Returns array of { index, durationSec } for further processing.
   */
  private decomposeSceneIntoRawShots(
    scene: ScriptSceneItem,
    durationSec: number,
    thresholdSec: number
  ): Array<{ index: number; durationSec: number }> {
    if (durationSec <= thresholdSec) {
      return [{ index: 1, durationSec }];
    }

    const numShots = Math.max(2, Math.min(4, Math.ceil(durationSec / 4.0)));
    const baseDur = Math.round((durationSec / numShots) * 100) / 100;
    const result: Array<{ index: number; durationSec: number }> = [];

    for (let i = 1; i <= numShots; i++) {
      const isLast = i === numShots;
      const shotDur = isLast
        ? Math.round((durationSec - baseDur * (numShots - 1)) * 100) / 100
        : baseDur;
      result.push({ index: i, durationSec: shotDur });
    }

    return result;
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
      promptParts.push('character depicted in natural active pose, seamlessly interacting with the scene, consistent identity, dynamic environmental lighting');
    }
    if (bgSnippet) {
      promptParts.push(bgSnippet);
    }
    promptParts.push('sharp focus, highly detailed, photorealistic');

    return promptParts.join(', ');
  }

  private buildMotionNote(shotIndex: number, totalShots: number, mediaType: ShotMediaType): string {
    if (mediaType === 'image') {
      // Ken Burns suggestions for static images
      if (totalShots === 1) return 'Ken Burns: slow zoom in from wide';
      if (shotIndex === 1) return 'Ken Burns: slow pan right, establishing drift';
      if (shotIndex === 2) return 'Ken Burns: slow zoom in, focus pull';
      return 'Ken Burns: subtle zoom out, gentle drift';
    }
    // Video motion notes
    if (totalShots === 1) {
      return 'slow push in camera, steady cinematic framing';
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
