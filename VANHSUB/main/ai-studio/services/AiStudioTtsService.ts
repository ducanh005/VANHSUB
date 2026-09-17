import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { MsEdgeTTS, OUTPUT_FORMAT, type ProsodyOptions } from 'msedge-tts';
import type {
  AiStudioVoiceConfig,
  ScriptBeatLine,
  WordTimestamp,
  RenderSingleLineVoicePayload,
  RenderSingleLineVoiceResult,
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

export interface TtsSynthesisResult {
  audioPath: string;
  durationMs: number;
  sizeBytes: number;
  rawMetadata: any[];
  wordTimestamps: WordTimestamp[];
}

export interface AlignmentResult {
  wordsAlignment: WordTimestamp[];
  alignedLines: ScriptBeatLine[];
  totalDurationMs: number;
}

export class AiStudioTtsService {
  private static instance: AiStudioTtsService | null = null;

  public static getInstance(): AiStudioTtsService {
    if (!AiStudioTtsService.instance) {
      AiStudioTtsService.instance = new AiStudioTtsService();
    }
    return AiStudioTtsService.instance;
  }

  // ==========================================================================
  // Helper: Normalize Voice ID
  // ==========================================================================
  public normalizeVoiceId(voiceId?: string): string {
    const v = (voiceId || '').toLowerCase();
    if (v.includes('female') || v.includes('hoaimy') || v.includes('nu') || v.includes('nữ')) {
      return 'vi-VN-HoaiMyNeural';
    }
    if (v.includes('nam') || v.includes('male')) {
      return 'vi-VN-NamMinhNeural';
    }
    return 'vi-VN-HoaiMyNeural';
  }

  // ==========================================================================
  // Helper: Sanitize Text For TTS (Strip Unpronounceable Glyphs / Stars / Emojis)
  // ==========================================================================
  public sanitizeTextForTts(text: string): string {
    if (!text) return '';
    return text
      // Strip star sequences and decorative rating glyphs (e.g. ⭐⭐⭐⭐⭐, ★, ☆, ✨, 🌟, 💫)
      .replace(/[⭐★☆✨🌟💫✦✧]+/g, ' ')
      // Normalize decorative quotes and ornate bracket blocks
      .replace(/[«»‹›“”„‟〔〕〈〉《》【】〖〗]/g, '"')
      // Strip emoticons and non-verbal emojis / symbols
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
      // Normalize multiple spaces
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ==========================================================================
  // Stage 3: Voiceover Synthesis with WordBoundary Capture
  // ==========================================================================
  public async synthesizeVoiceover(
    textOrLines: string | ScriptBeatLine[],
    voiceConfig: AiStudioVoiceConfig,
    outputPath: string,
    signal?: AbortSignal
  ): Promise<TtsSynthesisResult> {
    const rawFullText = typeof textOrLines === 'string'
      ? textOrLines.trim()
      : textOrLines.map((l) => l.text.trim()).join(' ');

    if (!rawFullText) {
      throw new Error('Văn bản lồng tiếng không được để trống.');
    }

    const sanitized = this.sanitizeTextForTts(rawFullText);
    const fullText = sanitized.length > 0 ? sanitized : rawFullText;

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const targetVoice = this.normalizeVoiceId(voiceConfig.voiceId);

    const prosody: ProsodyOptions = {
      rate: voiceConfig.rate || '+0%',
      pitch: voiceConfig.pitch || '+0Hz',
      volume: voiceConfig.volume || '+0%',
    };

    let lastError: any = null;
    const maxRetries = 2;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) {
        throw new Error('Quá trình tạo giọng đọc đã bị hủy bởi người dùng.');
      }

      const tts = new MsEdgeTTS();

      try {
        await tts.setMetadata(targetVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
          wordBoundaryEnabled: voiceConfig.autoWordAlignment !== false,
          sentenceBoundaryEnabled: true,
        });

        const { audioStream, metadataStream } = tts.toStream(fullText, prosody);
        const audioChunks: Buffer[] = [];
        const rawMetadata: any[] = [];

        await new Promise<void>((resolve, reject) => {
          const timeoutTimer = setTimeout(() => {
            try { tts.close(); } catch {}
            reject(new Error(`Edge TTS timed out after 25s (lần thử ${attempt}/${maxRetries})`));
          }, 25_000);

          const abortHandler = () => {
            clearTimeout(timeoutTimer);
            try { tts.close(); } catch {}
            reject(new Error('Quá trình lồng tiếng bị hủy bởi người dùng.'));
          };

          if (signal) {
            if (signal.aborted) return abortHandler();
            signal.addEventListener('abort', abortHandler, { once: true });
          }

          if (metadataStream) {
            metadataStream.on('data', (chunk: Buffer) => {
              try {
                const parsed = JSON.parse(chunk.toString());
                if (parsed?.Metadata) rawMetadata.push(...parsed.Metadata);
              } catch {}
            });
          }

          audioStream.on('data', (chunk: Buffer) => audioChunks.push(chunk));
          audioStream.on('error', (err) => {
            clearTimeout(timeoutTimer);
            try { tts.close(); } catch {}
            reject(err);
          });
          audioStream.on('end', () => {
            clearTimeout(timeoutTimer);
            try { tts.close(); } catch {}
            resolve();
          });
        });

        const audioBuffer = Buffer.concat(audioChunks);
        if (audioBuffer.length === 0) {
          throw new Error('Edge TTS trả về buffer âm thanh rỗng (0 byte).');
        }

        fs.writeFileSync(outputPath, audioBuffer);
        const durationSec = await this.probeMediaDuration(outputPath);
        const durationMs = Math.round(durationSec * 1000);

        // Extract native WordBoundary items
        const wordTimestamps = this.extractWordTimestamps(rawMetadata, fullText, durationMs);

        return {
          audioPath: outputPath,
          durationMs,
          sizeBytes: audioBuffer.length,
          rawMetadata,
          wordTimestamps,
        };
      } catch (err: any) {
        lastError = err;
        try { tts.close(); } catch {}
        if (signal?.aborted) {
          throw new Error('Quá trình tạo giọng đọc đã bị hủy bởi người dùng.');
        }
        if (attempt < maxRetries) {
          console.warn(`[AiStudioTtsService] Lần tổng hợp ${attempt} thất bại, thử lại sau 1s:`, err?.message || err);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    throw new Error(`Edge TTS Voiceover synthesis failed: ${lastError?.message || lastError}`);
  }

  // ==========================================================================
  // Stage 4: Word-Boundary Alignment Extraction
  // ==========================================================================
  public extractWordTimestamps(
    rawMetadata: any[],
    fullText: string,
    totalDurationMs: number
  ): WordTimestamp[] {
    const extracted: WordTimestamp[] = [];

    if (Array.isArray(rawMetadata) && rawMetadata.length > 0) {
      for (const item of rawMetadata) {
        if (item.Type === 'WordBoundary' && item.Data) {
          const offsetTicks = item.Data.Offset || 0;
          const durationTicks = item.Data.Duration || 0;
          const text = item.Data.text?.Text || '';
          // 1 tick = 100 ns = 0.0001 ms
          const startMs = Math.round(offsetTicks / 10000);
          const endMs = Math.round((offsetTicks + durationTicks) / 10000);
          if (text && endMs > startMs) {
            extracted.push({ word: text, startMs, endMs });
          }
        }
      }
    }

    // Fallback: Syllabic distribution if metadata was omitted by server
    if (extracted.length === 0) {
      return this.calculateSyllabicAlignment(fullText, totalDurationMs);
    }

    return extracted;
  }

  public extractAlignment(
    rawMetadata: any[],
    scriptText: string,
    scriptLines: ScriptBeatLine[],
    totalDurationMs: number
  ): AlignmentResult {
    const wordsAlignment = this.extractWordTimestamps(rawMetadata, scriptText, totalDurationMs);
    const alignedLines: ScriptBeatLine[] = JSON.parse(JSON.stringify(scriptLines));

    const totalChars = alignedLines.reduce((sum, l) => sum + l.text.length, 0);
    let currentMs = 0;

    for (let i = 0; i < alignedLines.length; i++) {
      const line = alignedLines[i];
      const lineDurationMs = Math.max(
        1500,
        Math.round((line.text.length / Math.max(1, totalChars)) * totalDurationMs)
      );

      line.startMs = currentMs;
      line.endMs = currentMs + lineDurationMs;
      line.durationMs = lineDurationMs;
      currentMs += lineDurationMs;
    }

    return {
      wordsAlignment,
      alignedLines,
      totalDurationMs,
    };
  }

  public calculateSyllabicAlignment(text: string, totalDurationMs: number): WordTimestamp[] {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const safeDuration = Math.max(1000, totalDurationMs);
    const perWord = safeDuration / words.length;

    return words.map((w, idx) => ({
      word: w,
      startMs: Math.round(idx * perWord),
      endMs: Math.round((idx + 1) * perWord),
    }));
  }

  // ==========================================================================
  // Granular Step: Single-Line Voice Re-Synthesis
  // ==========================================================================
  public async renderSingleLineVoice(
    payload: RenderSingleLineVoicePayload,
    outputDir?: string
  ): Promise<RenderSingleLineVoiceResult> {
    const targetDir = outputDir || path.join(os.tmpdir(), 'vanhsub-single-lines');
    fs.mkdirSync(targetDir, { recursive: true });

    const lineAudioPath = path.join(
      targetDir,
      `line_${payload.lineIndex}_${Date.now()}.mp3`
    );

    const result = await this.synthesizeVoiceover(payload.text, payload.voiceConfig, lineAudioPath);
    return {
      audioPath: result.audioPath,
      durationMs: result.durationMs,
    };
  }

  // ==========================================================================
  // Prober Helper
  // ==========================================================================
  public async probeMediaDuration(mediaPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(mediaPath, (err, metadata) => {
        if (err) return reject(err);
        const duration = metadata?.format?.duration || 0;
        resolve(Number(duration) || 5);
      });
    });
  }
}

export const aiStudioTtsService = AiStudioTtsService.getInstance();
