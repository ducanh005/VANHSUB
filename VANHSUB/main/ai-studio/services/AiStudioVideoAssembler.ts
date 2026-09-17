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

export interface VideoAssemblyOptions {
  scenes: StoryboardScene[];
  voiceoverAudioPath: string;
  outputPath: string;
  renderingConfig: AiStudioRenderingConfig;
  subtitleConfig: AiStudioSubtitleConfig;
  aspectRatio?: FlowAspectRatio;
  wordsAlignment?: WordTimestamp[];
  scriptLines?: ScriptBeatLine[];
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

    // 2. Select primary visual asset
    const primaryImg = scenes[0]?.assetPath && fs.existsSync(scenes[0].assetPath)
      ? scenes[0].assetPath
      : null;

    if (!primaryImg) {
      throw new Error('No valid visual asset found for video assembly.');
    }

    // 3. Build Filtergraph
    const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    const zoompanFilter = renderingConfig.kenBurnsEffect
      ? `zoompan=z='min(zoom+0.0012,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=125:s=${width}x${height}`
      : `null`;

    const filterChain: string[] = [
      `[0:v]${scaleFilter},${zoompanFilter}[v_motion]`,
    ];

    if (subtitleConfig.enabled) {
      filterChain.push(`[v_motion]subtitles=filename='${escapedAss}'[vout]`);
    } else {
      filterChain.push(`[v_motion]null[vout]`);
    }

    const hasBgm = Boolean(
      renderingConfig.defaultBgmPath && fs.existsSync(renderingConfig.defaultBgmPath)
    );

    const cmd = ffmpeg()
      .input(primaryImg)
      .loop(Math.ceil(audioDurationSec) || 5)
      .input(voiceoverAudioPath);

    if (hasBgm) {
      cmd.input(renderingConfig.defaultBgmPath!);
      const bgmVol = renderingConfig.bgmVolume || 0.12;
      filterChain.push(
        `[1:a]volume=1.0[voice]`,
        `[2:a]volume=${bgmVol}[bgm]`,
        `[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`
      );
    }

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
          hasBgm ? '-map [aout]' : '-map 1:a',
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
