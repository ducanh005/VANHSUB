import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import type {
  AiStudioRenderingConfig,
  AiStudioSubtitleConfig,
  FlowAspectRatio,
  RenderingResolution,
  ScriptBeatLine,
  StoryboardScene,
  WordTimestamp,
} from '../types';

// Setup FFmpeg & FFprobe binary paths
const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
const rawFfprobePath = (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';

if (rawFfmpegPath) {
  ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));
}
if (rawFfprobePath) {
  ffmpeg.setFfprobePath(rawFfprobePath.replace('app.asar', 'app.asar.unpacked'));
}

/**
 * Escapes Windows path for libass subtitles filter in FFmpeg.
 * Converts backslashes to forward slashes and escapes drive letter colons (e.g. C: -> C\:)
 */
export function escapeFfmpegSubtitlesPath(subPath: string): string {
  let escaped = subPath.replace(/\\/g, '/');
  escaped = escaped.replace(/^([A-Za-z]):/, '$1\\:');
  return escaped;
}

export interface KenBurnsMotionProfile {
  name: string;
  panEquation: string;
  zoomEquation: string;
  scaleFilter: string;
}

export type KenBurnsMotionType =
  | 'pan_left_to_right'
  | 'pan_right_to_left'
  | 'zoom_in_third_left'
  | 'zoom_in_third_right'
  | 'zoom_out_wide'
  | 'push_in_hero';

export const CINEMATIC_CAMERA_MOTION_PROFILES: ReadonlyArray<KenBurnsMotionType> = [
  'pan_left_to_right',
  'pan_right_to_left',
  'zoom_in_third_left',
  'zoom_in_third_right',
  'zoom_out_wide',
  'push_in_hero',
] as const;

export interface VideoAssemblyOptions {
  scenes: StoryboardScene[];
  voiceoverAudioPath: string;
  outputPath: string;
  renderingConfig: AiStudioRenderingConfig;
  subtitleConfig: AiStudioSubtitleConfig;
  aspectRatio?: FlowAspectRatio;
  wordsAlignment?: WordTimestamp[];
  scriptLines?: ScriptBeatLine[];
  transitionSfxPath?: string;
  enableTransitionSfx?: boolean;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  onRegisterProcess?: (proc: ffmpeg.FfmpegCommand) => void;
}

export interface VideoAssemblyResult {
  videoPath: string;
  durationSec: number;
  fileSizeBytes: number;
  width: number;
  height: number;
}

export class AiStudioVideoAssembler {
  private static instance: AiStudioVideoAssembler | null = null;

  public static getInstance(): AiStudioVideoAssembler {
    if (!AiStudioVideoAssembler.instance) {
      AiStudioVideoAssembler.instance = new AiStudioVideoAssembler();
    }
    return AiStudioVideoAssembler.instance;
  }

  // ==========================================================================
  // Dimensions Calculator
  // ==========================================================================
  public getDimensions(
    aspectRatio: FlowAspectRatio = '16:9',
    resolution: RenderingResolution = '1080p'
  ): { width: number; height: number } {
    const is720p = resolution === '720p';
    if (aspectRatio === '9:16') {
      return is720p ? { width: 720, height: 1280 } : { width: 1080, height: 1920 };
    }
    if (aspectRatio === '1:1') {
      return is720p ? { width: 720, height: 720 } : { width: 1080, height: 1080 };
    }
    return is720p ? { width: 1280, height: 720 } : { width: 1920, height: 1080 };
  }

  // ==========================================================================
  // Dynamic Pan/Zoom Ken Burns (6 Cinematic Profiles with 1.5x Upscaling)
  // ==========================================================================
  /**
   * Generates 6 cinematic camera motion profiles with 1.5x pre-upscaling
   * to eliminate subpixel shimmering on Windows FFmpeg zoompan filter.
   */
  public static getKenBurnsProfiles(
    width: number,
    height: number,
    durationSec: number
  ): KenBurnsMotionProfile[] {
    const frames = Math.max(25, Math.round(durationSec * 25));
    const preUpscaleW = Math.round(width * 1.5);
    const preUpscaleH = Math.round(height * 1.5);
    const scaleFilter = `scale=${preUpscaleW}:${preUpscaleH}:force_original_aspect_ratio=increase,crop=${preUpscaleW}:${preUpscaleH}`;

    return [
      {
        name: 'Pan L->R',
        panEquation: `x='(iw-iw/zoom)*(on/${frames})':y='(ih-ih/zoom)/2'`,
        zoomEquation: `z='1.15'`,
        scaleFilter,
      },
      {
        name: 'Pan R->L',
        panEquation: `x='(iw-iw/zoom)*(1-on/${frames})':y='(ih-ih/zoom)/2'`,
        zoomEquation: `z='1.15'`,
        scaleFilter,
      },
      {
        name: 'Zoom 1/3 Left',
        panEquation: `x='(iw*0.33)-(iw/zoom*0.33)':y='(ih/2)-(ih/zoom/2)'`,
        zoomEquation: `z='min(zoom+0.0015,1.25)'`,
        scaleFilter,
      },
      {
        name: 'Zoom 1/3 Right',
        panEquation: `x='(iw*0.67)-(iw/zoom*0.67)':y='(ih/2)-(ih/zoom/2)'`,
        zoomEquation: `z='min(zoom+0.0015,1.25)'`,
        scaleFilter,
      },
      {
        name: 'Zoom-out Wide',
        panEquation: `x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'`,
        zoomEquation: `z='max(1.25-0.0015*on,1.0)'`,
        scaleFilter,
      },
      {
        name: 'Push-in Hero',
        panEquation: `x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'`,
        zoomEquation: `z='min(1.0+0.002*on,1.20)'`,
        scaleFilter,
      },
    ];
  }

  public getKenBurnsProfiles(
    width: number,
    height: number,
    durationSec: number
  ): KenBurnsMotionProfile[] {
    return AiStudioVideoAssembler.getKenBurnsProfiles(width, height, durationSec);
  }

  // ==========================================================================
  // Dynamic Audio Ducking & SFX Filter Chain
  // ==========================================================================
  /**
   * Builds the FFmpeg audio filter chain for Dynamic Audio Ducking (-18dB)
   * using sidechaincompress and scene transition SFX insertion at Tk - 0.2s.
   */
  public static buildDuckingAndSfxFilterChain(
    hasBgm: boolean,
    cutTimestampsSec: number[] = [],
    sfxInputsCount: number = 0
  ): string {
    const filterParts: string[] = [];

    if (hasBgm) {
      filterParts.push(`[voice_in]asplit=2[voice_main][voice_sidechain]`);
      filterParts.push(
        `[bgm_in][voice_sidechain]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=400:knee=2.5[bgm_ducked]`
      );
      if (sfxInputsCount > 0) {
        filterParts.push(
          `[voice_main][bgm_ducked]amix=inputs=2:duration=first:dropout_transition=2[audio_mix]`
        );
        let currentMix = '[audio_mix]';
        for (let i = 0; i < sfxInputsCount; i++) {
          const cutTime = cutTimestampsSec[i] !== undefined ? cutTimestampsSec[i] : (i + 1) * 4.0;
          const sfxDelayMs = Math.max(0, Math.round((cutTime - 0.2) * 1000));
          const sfxDelayedLabel = `[sfx_${i}_delayed]`;
          const nextMixLabel = i === sfxInputsCount - 1 ? '[aout]' : `[sfx_mix_${i}]`;
          filterParts.push(`[sfx_${i}]adelay=${sfxDelayMs}|${sfxDelayMs}${sfxDelayedLabel}`);
          filterParts.push(
            `${currentMix}${sfxDelayedLabel}amix=inputs=2:duration=first:dropout_transition=0${nextMixLabel}`
          );
          currentMix = nextMixLabel;
        }
      } else {
        filterParts.push(
          `[voice_main][bgm_ducked]amix=inputs=2:duration=first:dropout_transition=2[aout]`
        );
      }
    } else {
      filterParts.push(`[voice_in]anull[aout]`);
    }

    return filterParts.join(';');
  }

  public buildDuckingAndSfxFilterChain(
    hasBgm: boolean,
    cutTimestampsSec: number[] = [],
    sfxInputsCount: number = 0
  ): string {
    return AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(
      hasBgm,
      cutTimestampsSec,
      sfxInputsCount
    );
  }

  // ==========================================================================
  // ASS Subtitle File Compiler
  // ==========================================================================
  public compileAssSubtitles(
    words: WordTimestamp[],
    scriptLines: ScriptBeatLine[],
    subtitleConfig: AiStudioSubtitleConfig,
    width: number,
    height: number,
    outputPath: string,
    totalDurationMs = 5000
  ): string {
    const posPercent = subtitleConfig.positionY || 80;
    const marginV = Math.round((height * (100 - posPercent)) / 100);

    // Convert hex '#RRGGBB' to ASS '&H00BBGGRR&'
    const formatAssColor = (hex: string) => {
      const clean = hex.replace('#', '');
      const r = clean.slice(0, 2) || 'FF';
      const g = clean.slice(2, 4) || 'FF';
      const b = clean.slice(4, 6) || 'FF';
      return `&H00${b}${g}${r}&`;
    };

    const primaryCol = formatAssColor(subtitleConfig.primaryColor || '#FFFFFF');
    const outlineCol = formatAssColor(subtitleConfig.outlineColor || '#000000');
    const fontSize = subtitleConfig.fontSize || 24;
    const outlineWidth = subtitleConfig.outlineWidth || 3;

    const formatTime = (ms: number) => {
      const totalCs = Math.floor(Math.max(0, ms) / 10);
      const cs = totalCs % 100;
      const totalS = Math.floor(totalCs / 100);
      const s = totalS % 60;
      const totalM = Math.floor(totalS / 60);
      const m = totalM % 60;
      const h = Math.floor(totalM / 60);
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
    };

    const header = `[Script Info]
Title: Vanhsub AI Studio Auto Subtitles
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TikTokBold,Arial,${fontSize},${primaryCol},&H000000FF&,${outlineCol},&H80000000&,-1,0,0,0,100,100,0,0,1,${outlineWidth},1,2,20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const dialogueLines: string[] = [];

    if (words && words.length > 0) {
      // Group words into punchy chunks of 3-4 words (TikTok bold style)
      const chunkSize = 4;
      for (let i = 0; i < words.length; i += chunkSize) {
        const chunk = words.slice(i, i + chunkSize);
        const start = formatTime(chunk[0].startMs);
        const end = formatTime(chunk[chunk.length - 1].endMs);
        const text = chunk.map((c) => c.word).join(' ');
        dialogueLines.push(`Dialogue: 0,${start},${end},TikTokBold,,0,0,0,,${text}`);
      }
    } else if (scriptLines && scriptLines.length > 0) {
      for (const line of scriptLines) {
        const start = formatTime(line.startMs || 0);
        const end = formatTime(line.endMs || 3000);
        dialogueLines.push(`Dialogue: 0,${start},${end},TikTokBold,,0,0,0,,${line.text}`);
      }
    } else {
      dialogueLines.push(`Dialogue: 0,0:00:00.00,${formatTime(totalDurationMs)},TikTokBold,,0,0,0,,Vanhsub AI Studio`);
    }

    const content = header + dialogueLines.join('\n') + '\n';
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, content, 'utf8');
    return outputPath;
  }

  // ==========================================================================
  // Stage 7: Video Assembly & Rendering
  // ==========================================================================
  public async assembleVideo(options: VideoAssemblyOptions): Promise<VideoAssemblyResult> {
    const {
      scenes,
      voiceoverAudioPath,
      outputPath,
      renderingConfig,
      subtitleConfig,
      aspectRatio = '16:9',
      wordsAlignment = [],
      scriptLines = [],
      onProgress,
      signal,
      onRegisterProcess,
    } = options;

    if (!fs.existsSync(voiceoverAudioPath)) {
      throw new Error(`Voiceover audio file not found at: ${voiceoverAudioPath}`);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const { width, height } = this.getDimensions(aspectRatio, renderingConfig.resolution);
    const audioDurationSec = await this.probeDuration(voiceoverAudioPath);
    const totalDurationMs = Math.round(audioDurationSec * 1000);

    // 1. Generate ASS Subtitles
    const assPath = path.join(path.dirname(outputPath), 'subtitles.ass');
    this.compileAssSubtitles(
      wordsAlignment,
      scriptLines,
      subtitleConfig,
      width,
      height,
      assPath,
      totalDurationMs
    );
    const escapedAss = escapeFfmpegSubtitlesPath(assPath);

    // 2. Resolve all visual segments from scenes
    interface VisualSegment {
      path: string;
      durationSec: number;
      isVideo: boolean;
      shotId?: string;
    }

    const isVideoFile = (filePath: string) => /\.(mp4|webm|mov|mkv)$/i.test(filePath);

    // Find the first valid asset to act as fallback if a scene is missing its asset file
    let firstValidAssetPath: string | null = null;
    for (const sc of scenes) {
      const p = sc.assetPath || sc.imagePath || sc.videoPath;
      if (p && fs.existsSync(p) && fs.statSync(p).size > 0) {
        firstValidAssetPath = p;
        break;
      }
    }

    if (!firstValidAssetPath) {
      throw new Error('Không tìm thấy bất kỳ hình ảnh hoặc video hợp lệ nào từ các phân cảnh để dựng phim.');
    }

    let lastKnownAssetPath = firstValidAssetPath;
    const segments: VisualSegment[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      let resolvedPath = sc.assetPath || sc.imagePath || sc.videoPath;
      if (!resolvedPath || !fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).size === 0) {
        resolvedPath = lastKnownAssetPath;
      } else {
        lastKnownAssetPath = resolvedPath;
      }

      let durSec = 4.0;
      if (typeof sc.durationMs === 'number' && sc.durationMs > 0) {
        durSec = sc.durationMs / 1000;
      } else if (typeof sc.endMs === 'number' && typeof sc.startMs === 'number' && sc.endMs > sc.startMs) {
        durSec = (sc.endMs - sc.startMs) / 1000;
      }

      segments.push({
        path: resolvedPath,
        durationSec: Math.max(0.5, Math.round(durSec * 100) / 100),
        isVideo: isVideoFile(resolvedPath),
        shotId: sc.shotId || sc.id,
      });
    }

    // Đảm bảo tổng thời lượng visual bao phủ đủ audioDurationSec để tránh cắt hụt video
    let totalVisualSec = segments.reduce((sum, s) => sum + s.durationSec, 0);
    if (totalVisualSec < audioDurationSec && segments.length > 0) {
      const diff = audioDurationSec - totalVisualSec;
      segments[segments.length - 1].durationSec = Math.round((segments[segments.length - 1].durationSec + diff + 0.5) * 100) / 100;
      totalVisualSec = segments.reduce((sum, s) => sum + s.durationSec, 0);
    }

    console.log(
      `[AiStudioVideoAssembler] 🎬 Bắt đầu dựng phim đa phân cảnh: ${segments.length} segments, ` +
      `tổng thời lượng visual ~${totalVisualSec}s, audio: ${audioDurationSec}s`
    );

    // 3. Build FFmpeg Command & Filtergraph
    const cmd = ffmpeg();
    const filterChain: string[] = [];
    const concatInputs: string[] = [];

    segments.forEach((seg, i) => {
      const safeScale = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=25`;
      if (seg.isVideo) {
        cmd.input(seg.path);
        filterChain.push(`[${i}:v]${safeScale},trim=duration=${seg.durationSec},setpts=PTS-STARTPTS[v${i}]`);
      } else {
        cmd.input(seg.path).inputOptions(['-loop 1', `-t ${seg.durationSec}`]);
        if (renderingConfig.kenBurnsEffect) {
          const frames = Math.max(25, Math.round(seg.durationSec * 25));
          const profiles = AiStudioVideoAssembler.getKenBurnsProfiles(width, height, seg.durationSec);

          // Select profile from scene/beat metadata or alternate modulo
          const requestedMotion =
            (seg as any).cameraMotion ||
            (seg as any).cameraMovement ||
            (scenes[i] as any)?.cameraMotion ||
            (scenes[i] as any)?.cameraMovement ||
            scriptLines[i]?.cameraMovement;

          let profile: KenBurnsMotionProfile;
          if (requestedMotion === 'pan_left_to_right') {
            profile = profiles[0];
          } else if (requestedMotion === 'pan_right_to_left') {
            profile = profiles[1];
          } else if (requestedMotion === 'zoom_in_third_left') {
            profile = profiles[2];
          } else if (requestedMotion === 'zoom_in_third_right') {
            profile = profiles[3];
          } else if (requestedMotion === 'zoom_out_wide' || requestedMotion === 'dolly_out') {
            profile = profiles[4];
          } else if (requestedMotion === 'push_in_hero' || requestedMotion === 'dolly_in') {
            profile = profiles[5];
          } else {
            profile = profiles[i % profiles.length];
          }

          // 1.5x pre-upscaling before zoompan eliminates pixel shimmer on Windows FFmpeg
          const preScale = `${profile.scaleFilter},setsar=1`;
          const zoompan = `zoompan=${profile.zoomEquation}:${profile.panEquation}:d=${frames}:s=${width}x${height}:fps=25`;
          filterChain.push(`[${i}:v]${preScale},${zoompan}[v${i}]`);
        } else {
          filterChain.push(`[${i}:v]${safeScale}[v${i}]`);
        }
      }
      concatInputs.push(`[v${i}]`);
    });

    if (segments.length === 1) {
      filterChain.push(`[v0]null[vconcat]`);
    } else {
      filterChain.push(`${concatInputs.join('')}concat=n=${segments.length}:v=1:a=0[vconcat]`);
    }

    if (subtitleConfig.enabled) {
      filterChain.push(`[vconcat]subtitles=filename='${escapedAss}'[vout]`);
    } else {
      filterChain.push(`[vconcat]null[vout]`);
    }

    // Audio inputs: Voiceover audio input at index segments.length
    const voiceInputIdx = segments.length;
    cmd.input(voiceoverAudioPath);

    const hasBgm = Boolean(
      renderingConfig.defaultBgmPath && fs.existsSync(renderingConfig.defaultBgmPath)
    );

    let bgmInputIdx = -1;
    if (hasBgm) {
      bgmInputIdx = segments.length + 1;
      cmd.input(renderingConfig.defaultBgmPath!);
    }

    // Calculate cut timestamps Tk between consecutive scenes for transition SFX insertion
    const cutTimestampsSec: number[] = [];
    let accumulatedSec = 0;
    for (let i = 0; i < segments.length - 1; i++) {
      accumulatedSec += segments[i].durationSec;
      cutTimestampsSec.push(Math.round(accumulatedSec * 100) / 100);
    }

    // Resolve transition SFX asset if available
    let resolvedSfxPath = options.transitionSfxPath || (renderingConfig as any).transitionSfxPath;
    if (!resolvedSfxPath) {
      const candidates = [
        path.join(process.cwd(), 'resources', 'sfx', 'whoosh.wav'),
        path.join(process.cwd(), 'resources', 'sfx', 'impact.wav'),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          resolvedSfxPath = cand;
          break;
        }
      }
    }

    const sfxEnabled = options.enableTransitionSfx !== false;
    const hasSfx = Boolean(
      sfxEnabled &&
      resolvedSfxPath &&
      fs.existsSync(resolvedSfxPath) &&
      cutTimestampsSec.length > 0
    );

    let sfxInputIdx = -1;
    if (hasSfx) {
      sfxInputIdx = hasBgm ? segments.length + 2 : segments.length + 1;
      cmd.input(resolvedSfxPath!);
      const sfxCount = cutTimestampsSec.length;
      if (sfxCount === 1) {
        filterChain.push(`[${sfxInputIdx}:a]volume=0.35[sfx_0]`);
      } else {
        const sfxLabels = Array.from({ length: sfxCount }, (_, idx) => `[sfx_${idx}]`).join('');
        filterChain.push(`[${sfxInputIdx}:a]volume=0.35,asplit=${sfxCount}${sfxLabels}`);
      }
    }

    // Construct Audio Ducking & SFX Filtergraph
    const autoDucking = renderingConfig.autoAudioDucking !== false;
    const bgmVol = renderingConfig.bgmVolume || 0.12;

    if (hasBgm) {
      filterChain.push(`[${voiceInputIdx}:a]volume=1.0[voice_in]`);
      filterChain.push(`[${bgmInputIdx}:a]volume=${bgmVol}[bgm_in]`);

      if (autoDucking) {
        const duckingChain = AiStudioVideoAssembler.buildDuckingAndSfxFilterChain(
          true,
          cutTimestampsSec,
          hasSfx ? cutTimestampsSec.length : 0
        );
        filterChain.push(duckingChain);
      } else {
        if (hasSfx) {
          filterChain.push(`[voice_in][bgm_in]amix=inputs=2:duration=first:dropout_transition=2[audio_mix]`);
          let currentMix = '[audio_mix]';
          for (let i = 0; i < cutTimestampsSec.length; i++) {
            const cutTime = cutTimestampsSec[i] || (i + 1) * 4.0;
            const sfxDelayMs = Math.max(0, Math.round((cutTime - 0.2) * 1000));
            const sfxDelayedLabel = `[sfx_${i}_delayed]`;
            const nextMixLabel = i === cutTimestampsSec.length - 1 ? '[aout]' : `[sfx_mix_${i}]`;
            filterChain.push(`[sfx_${i}]adelay=${sfxDelayMs}|${sfxDelayMs}${sfxDelayedLabel}`);
            filterChain.push(
              `${currentMix}${sfxDelayedLabel}amix=inputs=2:duration=first:dropout_transition=0${nextMixLabel}`
            );
            currentMix = nextMixLabel;
          }
        } else {
          filterChain.push(`[voice_in][bgm_in]amix=inputs=2:duration=first:dropout_transition=2[aout]`);
        }
      }
    } else if (hasSfx) {
      filterChain.push(`[${voiceInputIdx}:a]volume=1.0[voice_main]`);
      let currentMix = '[voice_main]';
      for (let i = 0; i < cutTimestampsSec.length; i++) {
        const cutTime = cutTimestampsSec[i] || (i + 1) * 4.0;
        const sfxDelayMs = Math.max(0, Math.round((cutTime - 0.2) * 1000));
        const sfxDelayedLabel = `[sfx_${i}_delayed]`;
        const nextMixLabel = i === cutTimestampsSec.length - 1 ? '[aout]' : `[sfx_mix_${i}]`;
        filterChain.push(`[sfx_${i}]adelay=${sfxDelayMs}|${sfxDelayMs}${sfxDelayedLabel}`);
        filterChain.push(
          `${currentMix}${sfxDelayedLabel}amix=inputs=2:duration=first:dropout_transition=0${nextMixLabel}`
        );
        currentMix = nextMixLabel;
      }
    }

    const hasAudioMix = hasBgm || hasSfx;

    onRegisterProcess?.(cmd);

    await new Promise<void>((resolve, reject) => {
      const abortHandler = () => {
        try {
          (cmd as any).kill?.('SIGKILL');
        } catch {}
        reject(new Error('Quá trình dựng video bị hủy bởi người dùng.'));
      };

      if (signal) {
        if (signal.aborted) return abortHandler();
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      cmd
        .complexFilter(filterChain.join(';'))
        .outputOptions([
          '-map [vout]',
          hasAudioMix ? '-map [aout]' : `-map ${voiceInputIdx}:a`,
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-preset veryfast',
          '-c:a aac',
          '-b:a 128k',
          '-shortest',
        ])
        .output(outputPath)
        .on('progress', (p) => {
          if (onProgress && p?.percent) {
            onProgress(Math.min(99, Math.round(p.percent)));
          }
        })
        .on('end', () => {
          if (onProgress) onProgress(100);
          resolve();
        })
        .on('error', (err, _stdout, stderr) => {
          console.error('[AiStudioVideoAssembler] FFmpeg render stderr:', stderr);
          reject(new Error(`FFmpeg video assembly failed: ${err.message}`));
        })
        .run();
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error(`Output video file was not created: ${outputPath}`);
    }

    const stat = fs.statSync(outputPath);
    return {
      videoPath: outputPath,
      durationSec: audioDurationSec,
      fileSizeBytes: stat.size,
      width,
      height,
    };
  }

  // ==========================================================================
  // Prober Helper
  // ==========================================================================
  public async probeDuration(mediaPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(mediaPath, (err, data) => {
        if (err) return reject(err);
        resolve(Number(data?.format?.duration) || 5);
      });
    });
  }
}

export const aiStudioVideoAssembler = AiStudioVideoAssembler.getInstance();
