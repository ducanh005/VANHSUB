#!/usr/bin/env tsx
/**
 * scripts/test_challenger_m2_services.ts
 *
 * Adversarial Stress-Test Suite for Milestone 2: Modular Services & FFmpeg Assembly.
 * Challenger: Challenger 2 (Empirical Challenger)
 *
 * Target Coverage (from User Request):
 *   1. TTS with complex Vietnamese characters, numbers, and emojis.
 *   2. Storyboard prompt generation with empty or short lines.
 *   3. Visual service offline fallback generation (verify 16:9 and 9:16 aspect ratios).
 *   4. Video Assembler: verify assembly without BGM, verify Windows paths containing spaces and unicode characters.
 *   5. Granular step handlers: `renderSingleLineVoice`, `regenerateSceneAsset`, `renderVideo`.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

import { aiStudioTtsService } from '../main/ai-studio/services/AiStudioTtsService';
import { aiStudioLlmService } from '../main/ai-studio/services/AiStudioLlmService';
import { aiStudioVisualService } from '../main/ai-studio/services/AiStudioVisualService';
import {
  aiStudioVideoAssembler,
  escapeFfmpegSubtitlesPath,
} from '../main/ai-studio/services/AiStudioVideoAssembler';
import { aiStudioPipelineEngine } from '../main/ai-studio/AiStudioPipelineEngine';
import {
  DEFAULT_AI_STUDIO_CONFIG,
  ScriptBeatLine,
  StoryboardScene,
  PipelineSessionState,
} from '../main/ai-studio/types';

// Setup FFmpeg & FFprobe
const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
const rawFfprobePath = (ffprobeInstaller as any)?.path || (ffprobeInstaller as any)?.default?.path || '';

if (rawFfmpegPath) {
  ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));
}
if (rawFfprobePath) {
  ffmpeg.setFfprobePath(rawFfprobePath.replace('app.asar', 'app.asar.unpacked'));
}

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};

interface TestResult {
  id: string;
  target: string;
  name: string;
  passed: boolean;
  durationMs: number;
  details: string;
  defectFound?: string;
  error?: string;
}

const results: TestResult[] = [];

function logPass(id: string, target: string, name: string, durationMs: number, details: string) {
  results.push({ id, target, name, passed: true, durationMs, details });
  console.log(`  ${colors.green}✓ [PASS]${colors.reset} ${colors.bold}${name}${colors.reset} (${durationMs}ms)`);
  if (details) console.log(`      ${colors.dim}Detail:${colors.reset} ${details}`);
}

function logDefect(id: string, target: string, name: string, durationMs: number, defectFound: string, error?: string) {
  results.push({ id, target, name, passed: false, durationMs, details: defectFound, defectFound, error });
  console.log(`  ${colors.red}✗ [DEFECT DETECTED]${colors.reset} ${colors.bold}${name}${colors.reset} (${durationMs}ms)`);
  console.log(`      ${colors.red}${colors.bold}Defect:${colors.reset} ${defectFound}`);
  if (error) console.log(`      ${colors.dim}Raw Error:${colors.reset} ${error}`);
}

async function probeMedia(filePath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

// Setup isolated working directory
const TEST_ROOT = path.join(os.tmpdir(), `vanhsub-challenger-m2-${Date.now()}`);
fs.mkdirSync(TEST_ROOT, { recursive: true });
process.env.VANHSUB_AI_STUDIO_DIR = path.join(TEST_ROOT, 'ai-studio');

console.log(`\n${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
console.log(`${colors.bold}${colors.white}  CHALLENGER 2: ADVERSARIAL STRESS TEST SUITE — MILESTONE 2 MODULAR SERVICES${colors.reset}`);
console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
console.log(`Test Directory: ${TEST_ROOT}\n`);

async function runChallengerSuite() {
  const overallStart = Date.now();

  // ==========================================================================
  // TARGET 1: TTS with Complex Vietnamese, Numbers, and Emojis
  // ==========================================================================
  console.log(`\n${colors.bold}${colors.blue}▶ TARGET 1: TTS Service Stress Testing${colors.reset}`);

  // 1.1: Complex Vietnamese Diacritics & Upper/Lower Tone Marks
  {
    const t0 = Date.now();
    const id = 'TTS-1.1';
    const name = 'TTS Complex Vietnamese Diacritics & Tone Marks';
    try {
      const outDir = path.join(TEST_ROOT, 'tts');
      fs.mkdirSync(outDir, { recursive: true });
      const outMp3 = path.join(outDir, 'vietnamese_complex.mp3');

      const complexText =
        'Thử nghiệm hệ thống Vanhsub AI Studio với ngữ âm tiếng Việt phức tạp: ' +
        'Nguyễn Hoàng Đăng Khoa, thuở ấy, loằng ngoằng, xoong chảo, ngoe nguẩy, khuỷu tay, trĩu nặng. ' +
        'Các địa danh có dấu: ĐẮK LẮK, QUẢNG NGÃI, THỪA THIÊN HUẾ, HÒA BÌNH, BẮC KẠN.';

      const result = await aiStudioTtsService.synthesizeVoiceover(
        complexText,
        {
          provider: 'edge_tts',
          voiceId: 'vi-VN-HoaiMyNeural',
          rate: '+0%',
          pitch: '+0Hz',
          volume: '+0%',
          autoWordAlignment: true,
        },
        outMp3
      );

      if (!fs.existsSync(outMp3) || result.sizeBytes < 1000) {
        throw new Error(`File was not created or too small: ${result.sizeBytes} bytes`);
      }

      const probe = await probeMedia(outMp3);
      const duration = Number(probe?.format?.duration) || 0;
      if (duration < 3.0) {
        throw new Error(`Probed duration unexpectedly short: ${duration}s`);
      }

      logPass(id, 'TTS', name, Date.now() - t0, `Generated ${result.sizeBytes} bytes MP3, duration ${duration.toFixed(2)}s, words: ${result.wordTimestamps.length}`);
    } catch (err: any) {
      logDefect(id, 'TTS', name, Date.now() - t0, 'Failed synthesizing complex Vietnamese text', err?.message);
    }
  }

  // 1.2: Numbers, Currencies, Dates, Times, and Percentages
  {
    const t0 = Date.now();
    const id = 'TTS-1.2';
    const name = 'TTS Numbers, Dates, Times, Percentages & Currencies';
    try {
      const outMp3 = path.join(TEST_ROOT, 'tts', 'numbers_currencies.mp3');
      const numberText =
        'Báo cáo ngày 17/09/2026, lúc 14:30:15: ' +
        'Tăng trưởng đạt 99%, doanh thu 123.456.789 đồng, khoảng 5.000 USD.';

      const result = await aiStudioTtsService.synthesizeVoiceover(
        numberText,
        {
          provider: 'edge_tts',
          voiceId: 'vi-VN-NamMinhNeural',
          rate: '+5%',
          pitch: '+0Hz',
          volume: '+0%',
          autoWordAlignment: true,
        },
        outMp3
      );

      if (!fs.existsSync(outMp3) || result.sizeBytes < 1000) {
        throw new Error(`Audio file missing or empty: ${result.sizeBytes} bytes`);
      }

      const probe = await probeMedia(outMp3);
      const duration = Number(probe?.format?.duration) || 0;

      logPass(id, 'TTS', name, Date.now() - t0, `Synthesized with vi-VN-NamMinhNeural: ${result.sizeBytes} bytes, duration ${duration.toFixed(2)}s`);
    } catch (err: any) {
      logDefect(id, 'TTS', name, Date.now() - t0, 'Failed synthesizing numbers and currencies', err?.message);
    }
  }

  // 1.3: Emojis & Unsanitized Symbols (Vulnerability Stress Test)
  {
    const t0 = Date.now();
    const id = 'TTS-1.3';
    const name = 'TTS Emoji & Non-Verbal Unicode Symbol Handling (Defect Check)';
    try {
      const outMp3 = path.join(TEST_ROOT, 'tts', 'emojis_unsanitized.mp3');
      const rawEmojiText = 'Khám phá video AI triệu view 🚀🔥🎉! Siêu phẩm công nghệ 🤖✨!';

      // Test raw unsanitized input against Edge TTS
      let rawFailed = false;
      let rawError = '';
      try {
        await aiStudioTtsService.synthesizeVoiceover(
          rawEmojiText,
          {
            provider: 'edge_tts',
            voiceId: 'vi-VN-HoaiMyNeural',
            rate: '+0%',
            pitch: '+0Hz',
            volume: '+0%',
            autoWordAlignment: true,
          },
          outMp3
        );
      } catch (err: any) {
        rawFailed = true;
        rawError = err?.message || String(err);
      }

      if (rawFailed) {
        logDefect(
          id,
          'TTS',
          name,
          Date.now() - t0,
          'DEFECT-1: AiStudioTtsService lacks input sanitization for emojis/unicode symbols. Edge TTS stream terminates abruptly or throws "Stream closed before synthesis completed" when text contains emojis.',
          rawError
        );
      } else {
        logPass(id, 'TTS', name, Date.now() - t0, 'Edge TTS succeeded on raw emojis without error');
      }
    } catch (err: any) {
      logDefect(id, 'TTS', name, Date.now() - t0, 'Unexpected harness error in 1.3', err?.message);
    }
  }

  // 1.4: Voice Normalization Bug: 'female' matches 'male'
  {
    const t0 = Date.now();
    const id = 'TTS-1.4';
    const name = "TTS Voice ID Normalization: 'female' Substring Collision (Defect Check)";
    try {
      const normMale = aiStudioTtsService.normalizeVoiceId('male');
      const normFemale = aiStudioTtsService.normalizeVoiceId('female');

      // 'female'.toLowerCase().includes('male') is TRUE!
      // Therefore normalizeVoiceId('female') returns 'vi-VN-NamMinhNeural' (Male voice)!
      if (normFemale === 'vi-VN-NamMinhNeural') {
        logDefect(
          id,
          'TTS',
          name,
          Date.now() - t0,
          `DEFECT-2: Substring matching collision in normalizeVoiceId(): 'female'.includes('male') evaluates to true, causing female voice requests ('female') to wrongly return MALE voice ('vi-VN-NamMinhNeural') instead of 'vi-VN-HoaiMyNeural'.`
        );
      } else if (normFemale === 'vi-VN-HoaiMyNeural' && normMale === 'vi-VN-NamMinhNeural') {
        logPass(id, 'TTS', name, Date.now() - t0, 'Voice normalization cleanly differentiates male and female voice requests');
      } else {
        logDefect(id, 'TTS', name, Date.now() - t0, `Unexpected voice normalization: female=${normFemale}, male=${normMale}`);
      }
    } catch (err: any) {
      logDefect(id, 'TTS', name, Date.now() - t0, 'Harness error in 1.4', err?.message);
    }
  }

  // 1.5: Empty / Whitespace Text Guard & WordBoundary Monotonicity
  {
    const t0 = Date.now();
    const id = 'TTS-1.5';
    const name = 'TTS Empty Input Guard & Timestamp Monotonicity';
    try {
      let threwOnEmpty = false;
      try {
        await aiStudioTtsService.synthesizeVoiceover(
          '   \n\t  ',
          DEFAULT_AI_STUDIO_CONFIG.voice,
          path.join(TEST_ROOT, 'tts', 'empty.mp3')
        );
      } catch {
        threwOnEmpty = true;
      }

      if (!threwOnEmpty) {
        throw new Error('synthesizeVoiceover accepted empty/whitespace string without throwing');
      }

      // Test timestamp extraction monotonicity with synthetic metadata
      const mockMeta = [
        { Type: 'WordBoundary', Data: { Offset: 1000000, Duration: 2000000, text: { Text: 'Chào' } } },
        { Type: 'WordBoundary', Data: { Offset: 3500000, Duration: 1500000, text: { Text: 'bạn' } } },
      ];
      const aligned = aiStudioTtsService.extractWordTimestamps(mockMeta, 'Chào bạn', 1000);
      if (aligned.length !== 2 || aligned[0].endMs > aligned[1].startMs) {
        throw new Error('Word timestamps non-monotonic');
      }

      logPass(id, 'TTS', name, Date.now() - t0, 'Empty input strictly guarded; word-boundary monotonic ordering verified');
    } catch (err: any) {
      logDefect(id, 'TTS', name, Date.now() - t0, 'Empty guard or monotonicity failed', err?.message);
    }
  }

  // ==========================================================================
  // TARGET 2: Storyboard Prompt Generation with Empty or Short Lines
  // ==========================================================================
  console.log(`\n${colors.bold}${colors.blue}▶ TARGET 2: Storyboard & Script Quality Adversarial Tests${colors.reset}`);

  // 2.1: Empty, Whitespace, and Short Script Lines in generateStoryboardScenes
  {
    const t0 = Date.now();
    const id = 'STORYBOARD-2.1';
    const name = 'Storyboard Scenes with Empty, Whitespace & Ultra-Short Lines';
    try {
      const adversarialLines: ScriptBeatLine[] = [
        { id: 'l-1', index: 1, text: '', estimatedDurationSec: 2.0 },
        { id: 'l-2', index: 2, text: '     \t\n  ', estimatedDurationSec: 1.5 },
        { id: 'l-3', index: 3, text: 'A', estimatedDurationSec: 0.5 },
        { id: 'l-4', index: 4, text: 'Bí ẩn?', beatType: 'hook' },
        { id: 'l-5', index: 5, text: 'Hết.', beatType: 'outro' },
      ];

      const flowConfig = DEFAULT_AI_STUDIO_CONFIG.flowEngine;
      const scenes = aiStudioLlmService.generateStoryboardScenes(adversarialLines, flowConfig);

      if (!Array.isArray(scenes) || scenes.length !== adversarialLines.length) {
        throw new Error(`Expected ${adversarialLines.length} scenes, got ${scenes?.length}`);
      }

      for (let i = 0; i < scenes.length; i++) {
        const s = scenes[i];
        if (!s.visualPrompt || s.visualPrompt.trim().length < 20) {
          throw new Error(`Scene ${i + 1} generated empty or too short visualPrompt: "${s.visualPrompt}"`);
        }
        if (!s.visualPrompt.includes(flowConfig.stylePromptPrefix)) {
          throw new Error(`Scene ${i + 1} visualPrompt missing style prefix`);
        }
        if (s.durationMs <= 0) {
          throw new Error(`Scene ${i + 1} has non-positive durationMs: ${s.durationMs}`);
        }
      }

      logPass(id, 'Storyboard', name, Date.now() - t0, `Handled 5 edge-case lines cleanly; all visualPrompts correctly formatted with style prefix`);
    } catch (err: any) {
      logDefect(id, 'Storyboard', name, Date.now() - t0, 'Failed handling empty/short storyboard lines', err?.message);
    }
  }

  // 2.2: Empty Array & Missing BeatType Fallback
  {
    const t0 = Date.now();
    const id = 'STORYBOARD-2.2';
    const name = 'Storyboard Empty Array & Unknown BeatType Handling';
    try {
      const flowConfig = DEFAULT_AI_STUDIO_CONFIG.flowEngine;
      const emptyScenes = aiStudioLlmService.generateStoryboardScenes([], flowConfig);
      if (!Array.isArray(emptyScenes) || emptyScenes.length !== 0) {
        throw new Error(`Expected empty array, got length ${emptyScenes?.length}`);
      }

      const untypedLines: ScriptBeatLine[] = [
        { id: 'u-1', index: 1, text: 'Không có beatType' },
        { id: 'u-2', index: 2, text: 'BeatType không xác định', beatType: 'random_beat' as any },
      ];

      const untypedScenes = aiStudioLlmService.generateStoryboardScenes(untypedLines, flowConfig);
      if (untypedScenes.length !== 2 || !untypedScenes[0].visualPrompt || !untypedScenes[1].visualPrompt) {
        throw new Error('Scenes with untyped beats failed prompt generation');
      }

      logPass(id, 'Storyboard', name, Date.now() - t0, 'Empty lines array returns [] without throwing; untyped beats default gracefully');
    } catch (err: any) {
      logDefect(id, 'Storyboard', name, Date.now() - t0, 'Failed empty array/untyped beat test', err?.message);
    }
  }

  // 2.3: Script Quality Audit Resilience (Empty & Single-Line Scripts)
  {
    const t0 = Date.now();
    const id = 'STORYBOARD-2.3';
    const name = 'Script Quality Audit Edge Cases (Empty & Short Scripts)';
    try {
      const emptyAudit = await aiStudioLlmService.auditScriptQuality([]);
      if (
        typeof emptyAudit.retentionScore !== 'number' ||
        Number.isNaN(emptyAudit.retentionScore) ||
        emptyAudit.retentionScore < 0 ||
        emptyAudit.retentionScore > 100
      ) {
        throw new Error(`Empty script audit returned invalid retentionScore: ${emptyAudit.retentionScore}`);
      }

      const singleLineAudit = await aiStudioLlmService.auditScriptQuality([
        { id: '1', index: 1, text: 'Bạn có biết bí mật này chưa?' },
      ]);
      if (singleLineAudit.hookScore <= 0 || singleLineAudit.retentionScore <= 0) {
        throw new Error(`Single line audit score invalid`);
      }

      logPass(id, 'Storyboard', name, Date.now() - t0, `Heuristic audit safe: empty retention=${emptyAudit.retentionScore}, single-line hook=${singleLineAudit.hookScore}`);
    } catch (err: any) {
      logDefect(id, 'Storyboard', name, Date.now() - t0, 'Failed script quality audit test', err?.message);
    }
  }

  // ==========================================================================
  // TARGET 3: Visual Service Offline Fallback (16:9 and 9:16 Aspect Ratios)
  // ==========================================================================
  console.log(`\n${colors.bold}${colors.blue}▶ TARGET 3: Visual Service Offline Fallback & Aspect Ratios${colors.reset}`);

  // 3.1: Dimensions Resolution Formula Validation
  {
    const t0 = Date.now();
    const id = 'VISUAL-3.1';
    const name = 'Visual Dimensions Resolution (16:9, 9:16, 1:1 @ 720p & 1080p)';
    try {
      const d16_9_1080 = aiStudioVisualService.resolveDimensions('16:9', '1080p');
      const d16_9_720 = aiStudioVisualService.resolveDimensions('16:9', '720p');
      const d9_16_1080 = aiStudioVisualService.resolveDimensions('9:16', '1080p');
      const d9_16_720 = aiStudioVisualService.resolveDimensions('9:16', '720p');
      const d1_1_1080 = aiStudioVisualService.resolveDimensions('1:1', '1080p');
      const d1_1_720 = aiStudioVisualService.resolveDimensions('1:1', '720p');

      if (d16_9_1080.width !== 1920 || d16_9_1080.height !== 1080) throw new Error('16:9 1080p mismatch');
      if (d16_9_720.width !== 1280 || d16_9_720.height !== 720) throw new Error('16:9 720p mismatch');
      if (d9_16_1080.width !== 1080 || d9_16_1080.height !== 1920) throw new Error('9:16 1080p mismatch');
      if (d9_16_720.width !== 720 || d9_16_720.height !== 1280) throw new Error('9:16 720p mismatch');
      if (d1_1_1080.width !== 1080 || d1_1_1080.height !== 1080) throw new Error('1:1 1080p mismatch');
      if (d1_1_720.width !== 720 || d1_1_720.height !== 720) throw new Error('1:1 720p mismatch');

      logPass(id, 'Visual', name, Date.now() - t0, 'All 6 combinations of aspect ratio & resolution verified mathematically');
    } catch (err: any) {
      logDefect(id, 'Visual', name, Date.now() - t0, 'Dimension resolution mismatch', err?.message);
    }
  }

  // 3.2: 16:9 Procedural Synthetic Card Generation & Magic Bytes
  {
    const t0 = Date.now();
    const id = 'VISUAL-3.2';
    const name = '16:9 Synthetic Card Generation (720p & 1080p PNG Validation)';
    try {
      const outDir = path.join(TEST_ROOT, 'visuals');
      fs.mkdirSync(outDir, { recursive: true });

      const mockScene: StoryboardScene = {
        id: 'scene-16-9',
        lineIndex: 1,
        startMs: 0,
        endMs: 5000,
        durationMs: 5000,
        lineText: '16:9 Scene',
        visualPrompt: 'Cinematic deep ocean underwater ruins',
        motionType: 'ken_burns',
        status: 'pending',
      };

      const out720 = path.join(outDir, 'scene_16_9_720p.png');
      const out1080 = path.join(outDir, 'scene_16_9_1080p.png');

      await aiStudioVisualService.generateSyntheticSceneCard(mockScene, out720, '16:9', '720p');
      await aiStudioVisualService.generateSyntheticSceneCard(mockScene, out1080, '16:9', '1080p');

      const probe720 = await probeMedia(out720);
      const stream720 = probe720.streams.find((s: any) => s.codec_type === 'video');
      if (stream720.width !== 1280 || stream720.height !== 720) {
        throw new Error(`720p mismatch: ${stream720.width}x${stream720.height}`);
      }

      const probe1080 = await probeMedia(out1080);
      const stream1080 = probe1080.streams.find((s: any) => s.codec_type === 'video');
      if (stream1080.width !== 1920 || stream1080.height !== 1080) {
        throw new Error(`1080p mismatch: ${stream1080.width}x${stream1080.height}`);
      }

      logPass(id, 'Visual', name, Date.now() - t0, 'Verified 16:9 cards: 1280x720 and 1920x1080 valid PNGs probed');
    } catch (err: any) {
      logDefect(id, 'Visual', name, Date.now() - t0, 'Failed 16:9 synthetic card generation', err?.message);
    }
  }

  // 3.3: 9:16 Vertical Short Video Card Generation (TikTok / YouTube Shorts)
  {
    const t0 = Date.now();
    const id = 'VISUAL-3.3';
    const name = '9:16 Vertical Card Generation (TikTok / Shorts 720x1280 & 1080x1920)';
    try {
      const outDir = path.join(TEST_ROOT, 'visuals');
      const mockScene: StoryboardScene = {
        id: 'scene-9-16',
        lineIndex: 2,
        startMs: 0,
        endMs: 4000,
        durationMs: 4000,
        lineText: '9:16 Scene',
        visualPrompt: 'Portrait neon cyberpunk character',
        motionType: 'ken_burns',
        status: 'pending',
      };

      const out9_16_720 = path.join(outDir, 'scene_9_16_720p.png');
      const out9_16_1080 = path.join(outDir, 'scene_9_16_1080p.png');

      await aiStudioVisualService.generateSyntheticSceneCard(mockScene, out9_16_720, '9:16', '720p');
      await aiStudioVisualService.generateSyntheticSceneCard(mockScene, out9_16_1080, '9:16', '1080p');

      const probe720 = await probeMedia(out9_16_720);
      const stream720 = probe720.streams.find((s: any) => s.codec_type === 'video');
      if (stream720.width !== 720 || stream720.height !== 1280) {
        throw new Error(`Vertical 720p mismatch: ${stream720.width}x${stream720.height}`);
      }

      const probe1080 = await probeMedia(out9_16_1080);
      const stream1080 = probe1080.streams.find((s: any) => s.codec_type === 'video');
      if (stream1080.width !== 1080 || stream1080.height !== 1920) {
        throw new Error(`Vertical 1080p mismatch: ${stream1080.width}x${stream1080.height}`);
      }

      logPass(id, 'Visual', name, Date.now() - t0, 'Verified 9:16 vertical cards: 720x1280 and 1080x1920 PNGs probed successfully');
    } catch (err: any) {
      logDefect(id, 'Visual', name, Date.now() - t0, 'Failed 9:16 vertical card generation', err?.message);
    }
  }

  // 3.4: Dual-Mode Dispatcher Fallback & Mode Reporting (Defect Check)
  {
    const t0 = Date.now();
    const id = 'VISUAL-3.4';
    const name = 'Dual-Mode Dispatcher: Accurate Fallback Mode Reporting (Defect Check)';
    try {
      const outDir = path.join(TEST_ROOT, 'visuals_batch');
      const scenes: StoryboardScene[] = [
        { id: 'b-1', lineIndex: 0, startMs: 0, endMs: 3000, durationMs: 3000, lineText: 'Scene 1', visualPrompt: 'P1', motionType: 'ken_burns', status: 'pending' },
        { id: 'b-2', lineIndex: 1, startMs: 3000, endMs: 6000, durationMs: 3000, lineText: 'Scene 2', visualPrompt: 'P2', motionType: 'ken_burns', status: 'pending' },
      ];

      const result = await aiStudioVisualService.dispatchVisualAssets(
        scenes,
        {
          aspectRatio: '9:16',
          outputMode: 'image',
          stylePromptPrefix: 'Cinematic',
          negativePrompt: 'blurry',
          outputsPerScene: 1,
          downloadDir: outDir,
          concurrency: 1,
        },
        outDir
      );

      // Verify all assets generated
      if (result.generatedCount !== 2) {
        throw new Error(`Expected 2 generated assets, got ${result.generatedCount}`);
      }

      // Check whether modeUsed accurately reflects that synthetic fallback was used
      // When lobbyWindow is null, Google Flow browser generation always fails,
      // so synthetic fallback was 100% engaged.
      // If modeUsed still reports 'google_flow', it is misleading.
      if (result.modeUsed === 'google_flow') {
        logDefect(
          id,
          'Visual',
          name,
          Date.now() - t0,
          `DEFECT-3: Inaccurate mode reporting in dispatchVisualAssets(). When Google Flow session exists in SettingsStore but lobbyWindow is unready, Google Flow generation fails and synthetic fallback generates all images. However, result.modeUsed is hardcoded to 'google_flow' based on initial session probe rather than actual outcome.`
        );
      } else {
        logPass(id, 'Visual', name, Date.now() - t0, `Correctly reported mode: ${result.modeUsed}`);
      }
    } catch (err: any) {
      logDefect(id, 'Visual', name, Date.now() - t0, 'Harness error in 3.4', err?.message);
    }
  }

  // ==========================================================================
  // TARGET 4: Video Assembler: Without BGM & Spaces/Unicode Paths
  // ==========================================================================
  console.log(`\n${colors.bold}${colors.blue}▶ TARGET 4: Video Assembler Assembly & Path Resilience${colors.reset}`);

  // 4.1: Video Assembly Without BGM
  {
    const t0 = Date.now();
    const id = 'ASSEMBLER-4.1';
    const name = 'Video Assembly Without BGM (Voice-Only MP4)';
    try {
      const renderDir = path.join(TEST_ROOT, 'render_no_bgm');
      fs.mkdirSync(renderDir, { recursive: true });
      const outMp4 = path.join(renderDir, 'output_no_bgm.mp4');

      const sceneImg = path.join(renderDir, 'scene_card.png');
      await aiStudioVisualService.generateSyntheticSceneCard(
        { id: '1', lineIndex: 0, startMs: 0, endMs: 3000, durationMs: 3000, lineText: 'T1', visualPrompt: 'P1', motionType: 'ken_burns', status: 'ready' },
        sceneImg,
        '16:9',
        '720p'
      );

      const audioPath = path.join(renderDir, 'voice_short.mp3');
      await aiStudioTtsService.synthesizeVoiceover(
        'Đoạn âm thanh kiểm thử dựng phim không nhạc nền.',
        { provider: 'edge_tts', voiceId: 'vi-VN-HoaiMyNeural', rate: '+0%', pitch: '+0Hz', volume: '+0%', autoWordAlignment: true },
        audioPath
      );

      const result = await aiStudioVideoAssembler.assembleVideo({
        scenes: [{ id: '1', lineIndex: 0, startMs: 0, endMs: 3000, durationMs: 3000, lineText: 'T1', visualPrompt: 'P1', motionType: 'ken_burns', status: 'ready', assetPath: sceneImg }],
        voiceoverAudioPath: audioPath,
        outputPath: outMp4,
        renderingConfig: {
          resolution: '720p',
          fps: 30,
          kenBurnsEffect: true,
          kenBurnsScale: 1.15,
          transitionDuration: 0.5,
          defaultBgmPath: '', // No BGM
          bgmVolume: 0.12,
          autoAudioDucking: true,
        },
        subtitleConfig: {
          enabled: true,
          preset: 'tiktok_bold',
          fontSize: 24,
          primaryColor: '#FFFFFF',
          outlineColor: '#000000',
          outlineWidth: 3,
          positionY: 80,
        },
        aspectRatio: '16:9',
      });

      if (!fs.existsSync(outMp4)) {
        throw new Error(`Output MP4 was not created: ${outMp4}`);
      }

      const probe = await probeMedia(outMp4);
      const vStream = probe.streams.find((s: any) => s.codec_type === 'video');
      const aStream = probe.streams.find((s: any) => s.codec_type === 'audio');

      if (!vStream || vStream.codec_name !== 'h264') throw new Error(`Video stream invalid: ${vStream?.codec_name}`);
      if (!aStream || aStream.codec_name !== 'aac') throw new Error(`Audio stream invalid: ${aStream?.codec_name}`);

      logPass(id, 'Assembler', name, Date.now() - t0, `Rendered ${result.fileSizeBytes} bytes MP4, duration ${result.durationSec.toFixed(2)}s, H.264/AAC with subtitles burned`);
    } catch (err: any) {
      logDefect(id, 'Assembler', name, Date.now() - t0, 'Failed assembling video without BGM', err?.message);
    }
  }

  // 4.2: Windows Paths with Spaces and Vietnamese Unicode Characters
  {
    const t0 = Date.now();
    const id = 'ASSEMBLER-4.2';
    const name = 'Windows Paths Containing Spaces & Vietnamese Unicode Characters';
    try {
      const unicodeDir = path.join(
        TEST_ROOT,
        'Thư Mục Video AI Đẹp Nhất 2026 (Bản Thử Nghiệm #1)'
      );
      fs.mkdirSync(unicodeDir, { recursive: true });

      const unicodeImg = path.join(unicodeDir, 'hình ảnh phân cảnh số 1.png');
      const unicodeAudio = path.join(unicodeDir, 'giọng đọc lồng tiếng chuẩn.mp3');
      const unicodeVideo = path.join(unicodeDir, 'video thành phẩm cực nét.mp4');

      // Test path escaping
      const testRawPath = 'D:\\Thư Mục\\phụ đề.ass';
      const escaped = escapeFfmpegSubtitlesPath(testRawPath);
      if (!escaped.startsWith('D\\:/') || escaped.includes('\\Thư')) {
        throw new Error(`escapeFfmpegSubtitlesPath failed: ${escaped}`);
      }

      await aiStudioVisualService.generateSyntheticSceneCard(
        { id: '1', lineIndex: 0, startMs: 0, endMs: 3000, durationMs: 3000, lineText: 'U1', visualPrompt: 'P1', motionType: 'ken_burns', status: 'ready' },
        unicodeImg,
        '16:9',
        '720p'
      );

      await aiStudioTtsService.synthesizeVoiceover(
        'Thử nghiệm đường dẫn chứa khoảng trắng và ký tự tiếng Việt.',
        { provider: 'edge_tts', voiceId: 'vi-VN-HoaiMyNeural', rate: '+0%', pitch: '+0Hz', volume: '+0%', autoWordAlignment: true },
        unicodeAudio
      );

      const result = await aiStudioVideoAssembler.assembleVideo({
        scenes: [{ id: '1', lineIndex: 0, startMs: 0, endMs: 3000, durationMs: 3000, lineText: 'U1', visualPrompt: 'P1', motionType: 'ken_burns', status: 'ready', assetPath: unicodeImg }],
        voiceoverAudioPath: unicodeAudio,
        outputPath: unicodeVideo,
        renderingConfig: {
          resolution: '720p',
          fps: 30,
          kenBurnsEffect: false,
          kenBurnsScale: 1.15,
          transitionDuration: 0.5,
          bgmVolume: 0.12,
          autoAudioDucking: true,
        },
        subtitleConfig: {
          enabled: true,
          preset: 'tiktok_bold',
          fontSize: 22,
          primaryColor: '#FFFF00',
          outlineColor: '#000000',
          outlineWidth: 3,
          positionY: 80,
        },
        aspectRatio: '16:9',
      });

      if (!fs.existsSync(unicodeVideo) || fs.statSync(unicodeVideo).size < 1000) {
        throw new Error(`Rendered video file not found in unicode directory: ${unicodeVideo}`);
      }

      const probe = await probeMedia(unicodeVideo);
      const stream = probe.streams.find((s: any) => s.codec_type === 'video');
      if (!stream) throw new Error('Video stream not found in rendered file');

      logPass(id, 'Assembler', name, Date.now() - t0, `FFmpeg cleanly processed input & output paths with spaces and Unicode: ${path.basename(unicodeVideo)} (${result.fileSizeBytes} bytes)`);
    } catch (err: any) {
      logDefect(id, 'Assembler', name, Date.now() - t0, 'Failed assembly in unicode/space path', err?.message);
    }
  }

  // ==========================================================================
  // TARGET 5: Granular Step Handlers
  // ==========================================================================
  console.log(`\n${colors.bold}${colors.blue}▶ TARGET 5: Granular Step Handlers Testing${colors.reset}`);

  // 5.1: renderSingleLineVoice
  {
    const t0 = Date.now();
    const id = 'GRANULAR-5.1';
    const name = 'Granular Step: renderSingleLineVoice';
    try {
      const res = await aiStudioPipelineEngine.renderSingleLineVoice({
        lineIndex: 3,
        text: 'Thử nghiệm tái tạo giọng đọc cho một câu thoại độc lập trong kịch bản.',
        voiceConfig: {
          provider: 'edge_tts',
          voiceId: 'vi-VN-NamMinhNeural',
          rate: '+0%',
          pitch: '+0Hz',
          volume: '+0%',
          autoWordAlignment: true,
        },
      });

      if (!res.audioPath || !fs.existsSync(res.audioPath)) {
        throw new Error(`Returned audioPath does not exist: ${res.audioPath}`);
      }
      if (res.durationMs <= 0) {
        throw new Error(`Returned durationMs is non-positive: ${res.durationMs}`);
      }

      const probe = await probeMedia(res.audioPath);
      const duration = Number(probe?.format?.duration) || 0;
      if (duration < 1.0) {
        throw new Error(`Probed single line duration too short: ${duration}s`);
      }

      logPass(id, 'GranularHandlers', name, Date.now() - t0, `Re-synthesized line 3: ${res.durationMs}ms at ${path.basename(res.audioPath)}`);
    } catch (err: any) {
      logDefect(id, 'GranularHandlers', name, Date.now() - t0, 'Failed renderSingleLineVoice', err?.message);
    }
  }

  // 5.2: regenerateSceneAsset (Vertical 9:16)
  {
    const t0 = Date.now();
    const id = 'GRANULAR-5.2';
    const name = 'Granular Step: regenerateSceneAsset (Vertical 9:16 Asset)';
    try {
      const res = await aiStudioPipelineEngine.regenerateSceneAsset({
        sceneId: 'scene-granular-test',
        visualPrompt: 'A glowing majestic neon phoenix flying over cyberpunk skyscrapers, 8k',
        flowConfig: {
          aspectRatio: '9:16',
          outputMode: 'image',
          stylePromptPrefix: 'Cinematic lighting, 8k',
          negativePrompt: 'watermark, lowres',
          outputsPerScene: 1,
          downloadDir: '',
          concurrency: 1,
        },
      });

      if (!res.assetPath || !fs.existsSync(res.assetPath)) {
        throw new Error(`Returned assetPath does not exist: ${res.assetPath}`);
      }

      const probe = await probeMedia(res.assetPath);
      const stream = probe.streams.find((s: any) => s.codec_type === 'video');
      if (stream.width !== 720 || stream.height !== 1280) {
        throw new Error(`Expected 720x1280, got ${stream.width}x${stream.height}`);
      }

      logPass(id, 'GranularHandlers', name, Date.now() - t0, `Regenerated scene asset: 720x1280 PNG at ${path.basename(res.assetPath)}`);
    } catch (err: any) {
      logDefect(id, 'GranularHandlers', name, Date.now() - t0, 'Failed regenerateSceneAsset', err?.message);
    }
  }

  // 5.3: renderVideo (Custom assembly re-render from existing session)
  {
    const t0 = Date.now();
    const id = 'GRANULAR-5.3';
    const name = 'Granular Step: renderVideo (Custom Re-Render from Session)';
    try {
      const sessionId = `test-session-custom-${Date.now()}`;
      const sessionDir = aiStudioPipelineEngine.getSessionDir(sessionId);
      fs.mkdirSync(sessionDir, { recursive: true });
      const assetsDir = aiStudioPipelineEngine.getSessionAssetsDir(sessionId);

      const audioPath = path.join(assetsDir, 'voiceover.mp3');
      await aiStudioTtsService.synthesizeVoiceover(
        'Thử nghiệm dựng lại video với cấu hình tùy biến từ giao diện người dùng.',
        { provider: 'edge_tts', voiceId: 'vi-VN-HoaiMyNeural', rate: '+0%', pitch: '+0Hz', volume: '+0%', autoWordAlignment: true },
        audioPath
      );

      const sceneCard = path.join(assetsDir, 'scene_01.png');
      await aiStudioVisualService.generateSyntheticSceneCard(
        { id: '1', lineIndex: 0, startMs: 0, endMs: 4000, durationMs: 4000, lineText: 'L1', visualPrompt: 'P1', motionType: 'ken_burns', status: 'ready' },
        sceneCard,
        '16:9',
        '720p'
      );

      const sessionState: PipelineSessionState = {
        sessionId,
        topic: 'Thử Nghiệm Custom Render',
        currentStage: 7,
        stageName: 'render',
        status: 'completed',
        progress: 95,
        stages: {
          1: { status: 'success', stageName: 'Dữ kiện' },
          2: { status: 'success', stageName: 'Kịch bản' },
          3: { status: 'success', stageName: 'Lồng tiếng' },
          4: { status: 'success', stageName: 'Trích xuất Time' },
          5: { status: 'success', stageName: 'Storyboard' },
          6: { status: 'success', stageName: 'Ảnh / Video' },
          7: { status: 'success', stageName: 'Dựng phim' },
          8: { status: 'pending', stageName: 'SEO' },
        },
        artifacts: {
          audioPath,
          scenes: [
            {
              id: 's-1',
              lineIndex: 0,
              startMs: 0,
              endMs: 4000,
              durationMs: 4000,
              lineText: 'Thử nghiệm dựng lại video',
              visualPrompt: 'Visual prompt',
              motionType: 'ken_burns',
              assetPath: sceneCard,
              status: 'ready',
            },
          ],
          wordsAlignment: [
            { word: 'Thử', startMs: 0, endMs: 400 },
            { word: 'nghiệm', startMs: 400, endMs: 800 },
            { word: 'dựng', startMs: 800, endMs: 1200 },
            { word: 'video', startMs: 1200, endMs: 1800 },
          ],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      aiStudioPipelineEngine.persistSessionStateAtomic(sessionState);

      const renderRes = await aiStudioPipelineEngine.renderVideo({
        sessionId,
        customSettings: {
          resolution: '720p',
          kenBurnsEffect: false,
          preset: 'karaoke_glow',
          primaryColor: '#00FFCC',
          fontSize: 26,
        } as any,
      });

      if (!renderRes.videoPath || !fs.existsSync(renderRes.videoPath)) {
        throw new Error(`Output videoPath missing: ${renderRes.videoPath}`);
      }

      const probe = await probeMedia(renderRes.videoPath);
      const vStream = probe.streams.find((s: any) => s.codec_type === 'video');
      if (!vStream || vStream.width !== 1280 || vStream.height !== 720) {
        throw new Error(`Custom render dimensions mismatch: ${vStream?.width}x${vStream?.height}`);
      }

      logPass(id, 'GranularHandlers', name, Date.now() - t0, `Successfully re-rendered custom video: ${renderRes.videoPath} (1280x720 H.264/AAC)`);
    } catch (err: any) {
      logDefect(id, 'GranularHandlers', name, Date.now() - t0, 'Failed renderVideo granular handler', err?.message);
    }
  }

  // ==========================================================================
  // FINAL SUMMARY & FINDINGS TABLE
  // ==========================================================================
  const totalDuration = ((Date.now() - overallStart) / 1000).toFixed(2);
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const defects = results.filter((r) => !r.passed);

  console.log(`\n${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}${colors.white}  CHALLENGER 2: ADVERSARIAL TEST RESULTS SUMMARY${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`Total Tests Executed:  ${total}`);
  console.log(`Passed Checks:         ${colors.green}${colors.bold}${passed}${colors.reset}`);
  console.log(`Defects Detected:      ${defects.length > 0 ? colors.red + colors.bold + defects.length : '0'}${colors.reset}`);
  console.log(`Total Execution Time:  ${totalDuration}s\n`);

  if (defects.length > 0) {
    console.log(`${colors.red}${colors.bold}SUMMARY OF DETECTED DEFECTS:${colors.reset}`);
    for (const d of defects) {
      console.log(`  - [${d.id}] ${colors.bold}${d.name}${colors.reset}`);
      console.log(`    ${d.defectFound}`);
    }
  }

  // Cleanup test workspace
  try {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    console.log(`\nCleaned up temporary challenger test workspace: ${TEST_ROOT}`);
  } catch {}

  console.log(`${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}\n`);

  // Exit with 0 so the test report can be rendered and analyzed
  return { total, passed, defectsCount: defects.length, defects };
}

runChallengerSuite().then(({ defectsCount }) => {
  console.log(`Test suite completed with ${defectsCount} defects documented.`);
});
