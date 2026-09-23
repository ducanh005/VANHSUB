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
        let zoomFilter = '';
        if (renderingConfig.kenBurnsEffect) {
          const frames = Math.max(25, Math.round(seg.durationSec * 25));
          zoomFilter = `,zoompan=z='min(zoom+0.0012,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}`;
        }
        filterChain.push(`[${i}:v]${safeScale}${zoomFilter}[v${i}]`);
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

    // Audio inputs: Voiceover audio input nằm ở index segments.length
    const voiceInputIdx = segments.length;
    cmd.input(voiceoverAudioPath);

    const hasBgm = Boolean(
      renderingConfig.defaultBgmPath && fs.existsSync(renderingConfig.defaultBgmPath)
    );

    let bgmInputIdx = -1;
    if (hasBgm) {
      bgmInputIdx = segments.length + 1;
      cmd.input(renderingConfig.defaultBgmPath!);
      const bgmVol = renderingConfig.bgmVolume || 0.12;
      filterChain.push(
        `[${voiceInputIdx}:a]volume=1.0[voice]`,
        `[${bgmInputIdx}:a]volume=${bgmVol}[bgm]`,
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
          hasBgm ? '-map [aout]' : `-map ${voiceInputIdx}:a`,
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
