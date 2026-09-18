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
  // Helper: Concat Audio Files via FFmpeg Concat Demuxer
  // ==========================================================================
  public async concatAudioFiles(inputPaths: string[], outputPath: string): Promise<void> {
    if (inputPaths.length === 0) return;
    if (inputPaths.length === 1) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.copyFileSync(inputPaths[0], outputPath);
      return;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const listFilePath = path.join(
      path.dirname(outputPath),
      `concat_list_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.txt`
    );
    const listContent = inputPaths
      .map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(listFilePath, listContent, 'utf8');

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(listFilePath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .output(outputPath)
          .on('end', () => resolve())
          .on('error', (err) => {
            console.warn(
              '[AiStudioTtsService] Concat copy failed, falling back to audio re-encoding:',
              err?.message || err
            );
            ffmpeg()
              .input(listFilePath)
              .inputOptions(['-f', 'concat', '-safe', '0'])
              .audioCodec('libmp3lame')
              .audioBitrate('48k')
              .output(outputPath)
              .on('end', () => resolve())
              .on('error', (reencodeErr) => reject(reencodeErr))
              .run();
          })
          .run();
      });
    } finally {
      try {
        if (fs.existsSync(listFilePath)) {
          fs.unlinkSync(listFilePath);
        }
      } catch {}
    }
  }

  // ==========================================================================
  // Helper: Synthesize Single Speech Chunk (Safe WebSocket with timeout & retry)
  // ==========================================================================
  public async synthesizeSingleSpeechChunk(
    text: string,
    targetVoice: string,
    prosody: ProsodyOptions,
    outputPath: string,
    signal?: AbortSignal
  ): Promise<Buffer> {
    const maxRetries = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) {
        throw new Error('Quá trình tạo giọng đọc đã bị hủy bởi người dùng.');
      }

      const tts = new MsEdgeTTS();

      try {
        await tts.setMetadata(targetVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
          wordBoundaryEnabled: false,
          sentenceBoundaryEnabled: false,
        });

        const { audioStream, metadataStream } = tts.toStream(text, prosody);
        if (metadataStream) {
          metadataStream.resume(); // consume to prevent stream stall
        }

        const audioChunks: Buffer[] = [];

        await new Promise<void>((resolve, reject) => {
          const timeoutTimer = setTimeout(() => {
            try {
              tts.close();
            } catch {}
            reject(new Error(`Edge TTS timed out sau 45s (lần thử ${attempt}/${maxRetries})`));
          }, 45_000);

          const abortHandler = () => {
            clearTimeout(timeoutTimer);
            try {
              tts.close();
            } catch {}
            reject(new Error('Quá trình lồng tiếng bị hủy bởi người dùng.'));
          };

          if (signal) {
            if (signal.aborted) return abortHandler();
            signal.addEventListener('abort', abortHandler, { once: true });
          }

          audioStream.on('data', (chunk: Buffer) => audioChunks.push(chunk));
          audioStream.on('error', (err) => {
            clearTimeout(timeoutTimer);
            try {
              tts.close();
            } catch {}
            reject(err);
          });
          audioStream.on('end', () => {
            clearTimeout(timeoutTimer);
            try {
              tts.close();
            } catch {}
            resolve();
          });
        });

        const audioBuffer = Buffer.concat(audioChunks);
        if (audioBuffer.length === 0) {
          throw new Error('Edge TTS trả về buffer âm thanh rỗng (0 byte).');
        }

        fs.writeFileSync(outputPath, audioBuffer);
        return audioBuffer;
      } catch (err: any) {
        lastError = err;
        try {
          tts.close();
        } catch {}
        if (signal?.aborted) {
          throw new Error('Quá trình tạo giọng đọc đã bị hủy bởi người dùng.');
        }
        if (attempt < maxRetries) {
          console.warn(
            `[AiStudioTtsService] Tổng hợp câu "${text.slice(0, 35)}..." lần ${attempt} thất bại, thử lại sau ${attempt * 600}ms:`,
            err?.message || err
          );
          await new Promise((r) => setTimeout(r, attempt * 600));
        }
      }
    }

    throw new Error(`Edge TTS Voiceover synthesis failed: ${lastError?.message || lastError}`);
  }

  // ==========================================================================
  // Stage 3: Robust Voiceover Synthesis (Line-by-Line + Concat)
  // ==========================================================================
  public async synthesizeVoiceover(
    textOrLines: string | ScriptBeatLine[],
    voiceConfig: AiStudioVoiceConfig,
    outputPath: string,
    signal?: AbortSignal
  ): Promise<TtsSynthesisResult> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const targetVoice = this.normalizeVoiceId(voiceConfig.voiceId);

    const prosody: ProsodyOptions = {
      rate: voiceConfig.rate || '+0%',
      pitch: voiceConfig.pitch || '+0Hz',
      volume: voiceConfig.volume || '+0%',
    };

    // ------------------------------------------------------------------------
    // CASE A: Array of ScriptBeatLine[] (Line-by-line synthesis)
    // ------------------------------------------------------------------------
    if (Array.isArray(textOrLines)) {
      if (textOrLines.length === 0) {
        throw new Error('Danh sách câu kịch bản không được để trống.');
      }

      const voiceDir = path.join(path.dirname(outputPath), 'voice');
      fs.mkdirSync(voiceDir, { recursive: true });

      const lineAudioPaths: string[] = [];
      const allWordTimestamps: WordTimestamp[] = [];
      let currentMs = 0;

      for (let i = 0; i < textOrLines.length; i++) {
        if (signal?.aborted) {
          throw new Error('Quá trình tạo giọng đọc đã bị hủy bởi người dùng.');
        }

        if (i > 0) {
          await new Promise((r) => setTimeout(r, 200));
        }

        const line = textOrLines[i];
        const sanitizedLine = this.sanitizeTextForTts(line.text) || line.text.trim();
        if (!sanitizedLine) continue;

        const lineAudioPath = path.join(voiceDir, `line_${line.index || i + 1}.mp3`);
        await this.synthesizeSingleSpeechChunk(sanitizedLine, targetVoice, prosody, lineAudioPath, signal);

        const durSec = await this.probeMediaDuration(lineAudioPath);
        const durMs = Math.round(durSec * 1000);

        line.durationMs = durMs;
        line.audioPath = lineAudioPath;
        line.startMs = currentMs;
        line.endMs = currentMs + durMs;

        const lineWords = this.calculateSyllabicAlignment(line.text, durMs);
        for (const wt of lineWords) {
          allWordTimestamps.push({
            word: wt.word,
            startMs: wt.startMs + currentMs,
            endMs: wt.endMs + currentMs,
          });
        }

        currentMs += durMs;
        lineAudioPaths.push(lineAudioPath);
      }

      await this.concatAudioFiles(lineAudioPaths, outputPath);
      const totalDurSec = await this.probeMediaDuration(outputPath);
      const totalDurationMs = Math.round(totalDurSec * 1000) || currentMs;

      return {
        audioPath: outputPath,
        durationMs: totalDurationMs,
        sizeBytes: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0,
        rawMetadata: [],
        wordTimestamps: allWordTimestamps,
      };
    }

    // ------------------------------------------------------------------------
    // CASE B: Single String
    // ------------------------------------------------------------------------
    const rawFullText = textOrLines.trim();
    if (!rawFullText) {
      throw new Error('Văn bản lồng tiếng không được để trống.');
    }

    const sanitized = this.sanitizeTextForTts(rawFullText) || rawFullText;

    // If text is long (>= 1000 chars), split into sentence chunks to prevent Edge TTS drop
    if (sanitized.length >= 1000) {
      const sentenceSplits = sanitized
        .split(/(?<=[.!?\n])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const mockLines: ScriptBeatLine[] = sentenceSplits.map((text, idx) => ({
        id: `chunk_${idx + 1}`,
        index: idx + 1,
        text,
      }));

      return this.synthesizeVoiceover(mockLines, voiceConfig, outputPath, signal);
    }

    // Short text: Synthesize directly
    await this.synthesizeSingleSpeechChunk(sanitized, targetVoice, prosody, outputPath, signal);
    const durationSec = await this.probeMediaDuration(outputPath);
    const durationMs = Math.round(durationSec * 1000);
    const wordTimestamps = this.calculateSyllabicAlignment(sanitized, durationMs);

    return {
      audioPath: outputPath,
      durationMs,
      sizeBytes: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0,
      rawMetadata: [],
      wordTimestamps,
    };
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
      const lineDurationMs = (line.durationMs && line.durationMs > 0)
        ? line.durationMs
        : Math.max(
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
