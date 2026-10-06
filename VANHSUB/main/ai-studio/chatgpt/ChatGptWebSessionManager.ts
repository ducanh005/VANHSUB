/**
 * ChatGptWebSessionManager.ts
 *
 * Vanhsub AI Video Studio - ChatGPT Web Unified Facade & Pipeline Adapter.
 * Milestone 4: Bridges AI Studio pipeline with Playwright CDP infrastructure (Port 9223).
 *
 * Guarantees 100% Backward Compatibility:
 * - Preserves all public interfaces: ChatGptLoginStatus, ScriptPacingMetrics
 * - Preserves all exported functions: parseChatGptScriptResponse, calculateScriptPacingMetrics,
 *   buildScriptPromptForWeb, isUserPromptEcho, parseChatGptBlueprintResponse, parseChatGptIdeaResponse
 * - Preserves legacy constants: INSTALL_FETCH_HOOK_SCRIPT, POLL_STATE_SCRIPT
 * - Preserves class methods: getInstance, checkLoginStatus, openLoginWindow, closeWindow,
 *   logout, generateScriptWeb, executePromptTurn, getLastConversationUrl, setLastConversationUrl,
 *   resetConversation, getSession, isBusy
 * - Delegates all browser orchestration to ChatGptScriptCollector, ChromeManager, and ChatGptCdpClient.
 *
 * Location: main/ai-studio/chatgpt/ChatGptWebSessionManager.ts
 */

import { BrowserWindow, session } from 'electron';
import crypto from 'crypto';
import { jsonrepair } from 'jsonrepair';
import type {
  ScriptBeatLine,
  IdeaBlueprint,
  ChannelProfileConfig,
  CameraAngleType,
  CameraMovementType,
} from '../types';
import {
  ChatGptScriptCollector,
  type ScriptKind,
} from './ChatGptScriptCollector';
import { ChromeManager } from './ChromeManager';
import { ChatGptCdpClient } from './ChatGptCdpClient';
import { isUserPromptEcho as checkUserPromptEcho } from './chatgptSelectors.config';

// -----------------------------------------------------------------------------
// 1. Exported Interfaces & Types
// -----------------------------------------------------------------------------

export interface ChatGptLoginStatus {
  isLoggedIn: boolean;
  userEmail?: string;
  sessionCheckedAt: number;
}

export interface ScriptPacingMetrics {
  isShorts: boolean;
  targetDurationSec: number;
  targetMinutesText: string;
  targetWordRange: string;
  targetSentenceRange: string;
  minSentences: number;
  maxSentences: number;
  targetWords: number;
}

export interface ScriptValidationResult {
  isValid: boolean;
  beatCount: number;
  reason?: string;
  hasHook: boolean;
  hasOutro: boolean;
  totalDurationSec: number;
}

export interface BlueprintValidationResult {
  isValid: boolean;
  missingFields: string[];
  reason?: string;
}

// -----------------------------------------------------------------------------
// 2. Legacy Script Constants (Backwards Compatibility & Syntax Verification)
// -----------------------------------------------------------------------------

export const INSTALL_FETCH_HOOK_SCRIPT = `
  (() => {
    try {
      if (!window.__VANHSUB_STREAM__) {
        window.__VANHSUB_STREAM__ = { active: false, chunks: [], fullText: '' };
      }
    } catch (e) {}
  })()
`;

export const POLL_STATE_SCRIPT = `
  (() => {
    return {
      isStreaming: false,
      textLength: 0,
      text: ''
    };
  })()
`;

// -----------------------------------------------------------------------------
// 3. User Prompt Echo & Marker Helpers
// -----------------------------------------------------------------------------

export function isUserPromptEcho(candidate: string): boolean {
  if (!candidate || candidate.trim().length === 0) return false;
  return checkUserPromptEcho(candidate);
}

export function sanitizePromptEchoFromOutput(text: string, sentPrompt?: string, kind?: ScriptKind): string {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text.trim();
  // Master prompts intentionally quote the supplied output contract verbatim.
  // Removing lines shared with the input corrupts placeholders and narration rules.
  if (kind === 'master_prompt') return cleaned;

  // Strip anything before BEGIN SCRIPT or BEGIN JSON if markers are present
  const scriptBeginIdx = cleaned.indexOf('=== BEGIN SCRIPT ===');
  if (scriptBeginIdx !== -1) {
    cleaned = cleaned.slice(scriptBeginIdx);
  }
  const jsonBeginIdx = cleaned.indexOf('=== BEGIN JSON ===');
  if (jsonBeginIdx !== -1) {
    cleaned = cleaned.slice(jsonBeginIdx);
  }

  // Filter out echo lines
  const lines = cleaned.split('\n');
  const filteredLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (isUserPromptEcho(trimmed)) return false;
    if (
      trimmed.startsWith('NHIỆM VỤ:') ||
      trimmed.startsWith('QUY ĐỊNH ĐỊNH DẠNG') ||
      trimmed.startsWith('BẮT BUỘC:') ||
      trimmed.startsWith('CHÚ Ý:')
    ) {
      return false;
    }
    return true;
  });

  cleaned = filteredLines.join('\n').trim();

  // If sentPrompt is provided, ensure no 50+ char substring from prompt leaks into output
  if (sentPrompt && sentPrompt.length >= 60) {
    const promptSentences = sentPrompt
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length >= 40 && !s.startsWith('CÂU'));
    for (const pSent of promptSentences) {
      if (cleaned.includes(pSent)) {
        cleaned = cleaned.split(pSent).join('').trim();
      }
    }
  }

  return cleaned;
}

export function buildPromptWithMarkers(prompt: string, kind: ScriptKind): string {
  if (kind === 'idea' && !prompt.includes('=== BEGIN JSON ===')) {
    return `${prompt}\n\nBẮT BUỘC: Trả về DUY NHẤT một khối JSON hợp lệ, bọc chính xác trong marker:\n=== BEGIN JSON ===\n{ ... }\n=== END JSON ===\nKhông thêm văn bản nào ngoài marker.`;
  }
  if (kind === 'script' && !prompt.includes('=== BEGIN SCRIPT ===')) {
    return `${prompt}\n\nBẮT BUỘC: Bọc toàn bộ kịch bản trong marker:\n=== BEGIN SCRIPT ===\nCÂU 1: ...\n=== END SCRIPT ===`;
  }
  return prompt;
}

// -----------------------------------------------------------------------------
// 4. Script & Blueprint Parsers (F21, F23, F24)
// -----------------------------------------------------------------------------

/**
 * Parses raw textual response from ChatGPT Web into structured ScriptBeatLine items.
 * Robust against markers (=== BEGIN SCRIPT ===), SCRIPT: blocks, JSON arrays,
 * two-column Audiovisual elements, and standard "CÂU X:" prefixes.
 */
export function parseChatGptScriptResponse(rawText: string, topic: string): ScriptBeatLine[] {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) return [];

  let processedText = rawText.trim();

  // 1. Marker Extraction (Feature F21)
  const scriptMarkerMatch = processedText.match(
    /===\s*BEGIN\s*SCRIPT\s*===([\s\S]*?)(?:===\s*END\s*SCRIPT\s*===|$)/i
  );
  if (scriptMarkerMatch && scriptMarkerMatch[1].trim().length >= 15) {
    processedText = scriptMarkerMatch[1].trim();
  } else if (/===\s*END\s*SCRIPT\s*===/i.test(processedText)) {
    // If only === END SCRIPT === is present, cut off everything after it
    processedText = processedText.split(/===\s*END\s*SCRIPT\s*===/i)[0].trim();
  } else {
    // Check for SCRIPT: block (Master Prompt format)
    const scriptMatch = processedText.match(
      /SCRIPT:\s*([\s\S]*?)(?:---\s*END OF SCRIPT\s*---|NARRATION DIRECTION:|$)/i
    );
    if (scriptMatch && scriptMatch[1].trim().length >= 20) {
      processedText = scriptMatch[1].trim();
    }
  }

  // 2. Check for JSON array or object block
  const jsonCodeMatch = processedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidateJson = jsonCodeMatch
    ? jsonCodeMatch[1].trim()
    : processedText.startsWith('{') || processedText.startsWith('[')
    ? processedText
    : null;

  if (candidateJson) {
    try {
      const repaired = jsonrepair(candidateJson);
      const parsed = JSON.parse(repaired);
      const rawLines = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.lines)
        ? parsed.lines
        : null;

      if (Array.isArray(rawLines) && rawLines.length >= 3) {
        return rawLines.map((item: any, idx: number) => {
          const content = String(item.text || item.content || item.voiceover || '').trim();
          const cleanText = content.replace(/^[\*_"“”'`]+|[\*_"“”'`]+$/g, '').trim();
          const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
          const mediaType: 'video' | 'image' | undefined =
            item.suggestedMediaType === 'video' || item.media_type === 'video'
              ? 'video'
              : item.suggestedMediaType === 'image' || item.media_type === 'image'
              ? 'image'
              : undefined;

          let estDur = Number(item.estimatedDurationSec);
          if (isNaN(estDur) || estDur <= 0) {
            estDur = Math.max(3.0, Math.round((wordCount / 3.2) * 10) / 10);
          }
          if (mediaType === 'video') {
            estDur = Math.min(8.0, Math.max(2.0, estDur)); // Veo clamping [2.0s, 8.0s]
          } else {
            estDur = Math.max(2.0, estDur);
          }

          return {
            id: `line-${idx + 1}-${crypto.randomBytes(3).toString('hex')}`,
            index: idx + 1,
            text: cleanText || `Phân cảnh ${idx + 1}`,
            voiceDirection: item.voiceDirection || item.voice_direction,
            visualAction: item.visualAction || item.visual_action,
            cameraAngle: item.cameraAngle || item.camera_angle,
            cameraMovement: item.cameraMovement || item.camera_movement,
            suggestedMediaType: mediaType,
            estimatedDurationSec: estDur,
            beatType:
              item.beatType ||
              (idx === 0
                ? 'hook'
                : idx === 1
                ? 'intro'
                : idx === rawLines.length - 1
                ? 'outro'
                : idx === rawLines.length - 2
                ? 'climax'
                : 'body'),
          };
        });
      }
    } catch {
      // JSON parse failed, proceed to line-by-line parsing
    }
  }

  // 3. Line-by-Line Parsing
  const lines = processedText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const parsedBeats: ScriptBeatLine[] = [];
  const linePattern =
    /^(?:(?:\*{0,2}(?:CÂU|Câu|Beat|Phân cảnh)\s*(\d+)[\s:\-\.]+\*{0,2})|(?:\*{0,2}(\d+)[\.\)]\s*\*{0,2}))(?:\[.*?\]\s*)?(.+)/i;

  for (const line of lines) {
    if (isUserPromptEcho(line)) continue;

    const match = line.match(linePattern);
    if (match) {
      const idx = parseInt(match[1] || match[2], 10);
      let content = match[3].trim();

      // Deconstruct Two-Column Attributes: Text | Visual | Camera | Media | Voice
      let visualAction: string | undefined;
      let cameraMovement: string | undefined;
      let cameraAngle: string | undefined;
      let suggestedMediaType: 'image' | 'video' | undefined;
      let voiceDirection: string | undefined;

      // Extract pipe-delimited attributes
      if (content.includes('|')) {
        const parts = content.split('|').map((p) => p.trim());
        content = parts[0] || '';

        for (let pIdx = 1; pIdx < parts.length; pIdx++) {
          const part = parts[pIdx];
          if (/^(?:VISUAL|HÌNH\s*ẢNH|CẢNH)\s*:\s*/i.test(part)) {
            visualAction = part.replace(/^(?:VISUAL|HÌNH\s*ẢNH|CẢNH)\s*:\s*/i, '').trim();
          } else if (/^(?:CAMERA|GÓC\s*MÁY|CHUYỂN\s*ĐỘNG)\s*:\s*/i.test(part)) {
            const camDesc = part.replace(/^(?:CAMERA|GÓC\s*MÁY|CHUYỂN\s*ĐỘNG)\s*:\s*/i, '').trim();
            cameraMovement = camDesc;
            if (/wide|toàn\s*cảnh/i.test(camDesc)) cameraAngle = 'wide_establishing';
            else if (/close|cận\s*cảnh/i.test(camDesc)) cameraAngle = 'close_up';
            else cameraAngle = 'medium_shot';
          } else if (/^(?:MEDIA|LOẠI)\s*:\s*/i.test(part)) {
            suggestedMediaType = part.toLowerCase().includes('video') ? 'video' : 'image';
          } else if (/^(?:VOICE|GIỌNG\s*ĐỌC)\s*:\s*/i.test(part)) {
            voiceDirection = part.replace(/^(?:VOICE|GIỌNG\s*ĐỌC)\s*:\s*/i, '').trim();
          }
        }
      }

      // Extract bracket tags [Hình ảnh: ...] [Camera: ...]
      const visualTag = content.match(/\[(?:Hình ảnh|Visual|Cảnh)\s*:\s*([^\]]+)\]/i);
      if (visualTag) {
        visualAction = visualTag[1].trim();
        content = content.replace(visualTag[0], '').trim();
      }
      const camTag = content.match(/\[(?:Camera|Góc máy|Chuyển động)\s*:\s*([^\]]+)\]/i);
      if (camTag) {
        cameraMovement = camTag[1].trim();
        content = content.replace(camTag[0], '').trim();
      }
      const mediaTag = content.match(/\[(?:Media|Loại)\s*:\s*([^\]]+)\]/i);
      if (mediaTag) {
        suggestedMediaType = mediaTag[1].toLowerCase().includes('video') ? 'video' : 'image';
        content = content.replace(mediaTag[0], '').trim();
      }
      const voiceTag = content.match(/\[(?:Voice|Giọng đọc)\s*:\s*([^\]]+)\]/i);
      if (voiceTag) {
        voiceDirection = voiceTag[1].trim();
        content = content.replace(voiceTag[0], '').trim();
      }

      // Clean spoken dialogue: strip quote marks, brackets, markdown bold
      content = content.replace(/^[\*_"“”'`]+|[\*_"“”'`]+$/g, '').trim();
      content = content.replace(/\*\*/g, '').trim();
      content = content.replace(/^\[.*?\]\s*/, '').trim();

      if (content.length >= 8) {
        const wordCount = content.split(/\s+/).filter(Boolean).length;
        let estDuration = Math.max(3.0, Math.round((wordCount / 3.2) * 10) / 10);
        if (suggestedMediaType === 'video') {
          estDuration = Math.min(8.0, Math.max(2.0, estDuration));
        }

        parsedBeats.push({
          id: `line-${idx}-${crypto.randomBytes(3).toString('hex')}`,
          index: idx,
          text: content,
          voiceDirection,
          visualAction,
          cameraAngle,
          cameraMovement,
          suggestedMediaType,
          estimatedDurationSec: estDuration,
          beatType: 'body',
        });
      }
    }
  }

  // 4. Fallback Sentence Splitting if numbered beats < 3
  if (parsedBeats.length < 3) {
    parsedBeats.length = 0;
    const meaningfulLines = lines.filter((l) => {
      const lower = l.toLowerCase();
      if (lower.startsWith('#') || lower.startsWith('>') || lower.startsWith('---') || lower.startsWith('===')) return false;
      if (
        lower.includes('dưới đây là') ||
        lower.includes('chúc bạn') ||
        lower.includes('hy vọng kịch bản') ||
        lower.includes('bạn có thể tham khảo') ||
        lower.startsWith('title:') ||
        lower.startsWith('tiêu đề:') ||
        lower.startsWith('status:') ||
        isUserPromptEcho(l)
      ) {
        return false;
      }
      return l.length >= 10;
    });

    const sentences: string[] = [];
    for (const chunk of meaningfulLines) {
      const parts = chunk
        .split(/(?<=[.!?…])\s+(?=[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ0-9"“'\[])/u)
        .map((p) => p.trim())
        .filter(Boolean);

      if (parts.length > 0) sentences.push(...parts);
      else if (chunk.length > 0) sentences.push(chunk);
    }

    sentences.forEach((text, i) => {
      let cleanText = text.replace(/^\d+[\.\-\)]\s*/, '').replace(/\*\*/g, '').trim();
      cleanText = cleanText.replace(/^[\*_"“”'`]+|[\*_"“”'`]+$/g, '').trim();
      cleanText = cleanText.replace(/^\[.*?\]\s*/, '').trim();
      if (cleanText.length >= 8 && !isUserPromptEcho(cleanText)) {
        const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
        parsedBeats.push({
          id: `line-${i + 1}-${crypto.randomBytes(3).toString('hex')}`,
          index: i + 1,
          text: cleanText,
          estimatedDurationSec: Math.max(3.0, Math.round((wordCount / 3.2) * 10) / 10),
          beatType: 'body',
        });
      }
    });
  }

  // 5. Normalize indexes and beatTypes
  if (parsedBeats.length >= 3) {
    parsedBeats.forEach((beat, i) => {
      beat.index = i + 1;
      beat.id = `line-${i + 1}-${crypto.randomBytes(3).toString('hex')}`;
      if (i === 0) beat.beatType = 'hook';
      else if (i === 1) beat.beatType = 'intro';
      else if (i === parsedBeats.length - 1) beat.beatType = 'outro';
      else if (i === parsedBeats.length - 2) beat.beatType = 'climax';
      else beat.beatType = 'body';
    });
  }

  return parsedBeats;
}

/**
 * Converts Idea response to IdeaBlueprint with jsonrepair recovery (F24).
 */
export function parseChatGptBlueprintResponse(
  rawText: string,
  topic: string,
  aspectRatio: '16:9' | '9:16' = '16:9',
  channelProfile?: Partial<ChannelProfileConfig>
): IdeaBlueprint {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('ChatGPT Web trả về dữ liệu ý tưởng trống.');
  }

  let cleanText = rawText.trim();

  // Strip JSON markers
  const markerMatch = cleanText.match(/===\s*BEGIN\s*JSON\s*===([\s\S]*?)(?:===\s*END\s*JSON\s*===|$)/i);
  if (markerMatch) {
    cleanText = markerMatch[1].trim();
  } else {
    const codeMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeMatch) cleanText = codeMatch[1].trim();
  }

  // Extract outermost JSON block
  const firstBrace = cleanText.indexOf('{');
  const lastBrace = cleanText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleanText = cleanText.slice(firstBrace, lastBrace + 1);
  }

  let parsed: any = {};
  try {
    const repaired = jsonrepair(cleanText);
    parsed = JSON.parse(repaired);
  } catch {
    // Regex recovery fallback
    const extractField = (p: RegExp) => {
      const m = cleanText.match(p);
      return m ? m[1].trim() : '';
    };
    parsed = {
      title: extractField(/"title"\s*:\s*"([^"]+)"/i) || topic,
      hookConcept: extractField(/"hookConcept"\s*:\s*"([^"]+)"/i) || `Bạn có tin vào ${topic}?`,
      narrativeAngle: extractField(/"narrativeAngle"\s*:\s*"([^"]+)"/i) || 'Góc nhìn độc đáo sâu sắc',
      outline: ['1. Mở đầu', '2. Bối cảnh & cao trào', '3. Kết luận'],
      estimatedDurationSec: aspectRatio === '9:16' ? 60 : 300,
    };
  }

  const effectiveTitle = parsed.title || topic;
  const outlineList = Array.isArray(parsed.outline)
    ? parsed.outline
    : Array.isArray(parsed.keyBeats)
    ? parsed.keyBeats
    : [];

  return {
    topic: topic || effectiveTitle || 'Ý tưởng video',
    title: effectiveTitle,
    aspectRatio: parsed.aspectRatio || aspectRatio,
    targetAudience: parsed.targetAudience || 'Khán giả đại chúng',
    narrativeAngle: parsed.narrativeAngle || 'Góc nhìn độc đáo',
    hookConcept: parsed.hookConcept || `Khám phá sự thật về ${topic}`,
    pacing: parsed.pacing || (aspectRatio === '9:16' ? 'fast' : 'moderate'),
    estimatedDurationSec: Number(parsed.estimatedDurationSec) || (aspectRatio === '9:16' ? 60 : 300),
    keyBeats: outlineList,
    outline: outlineList,
    thumbnailConcept: parsed.thumbnailConcept || `Ý tưởng thumbnail về ${effectiveTitle}`,
    thumbnailPrompt:
      parsed.thumbnailPrompt || `Cinematic YouTube thumbnail for ${effectiveTitle}, 8k photorealistic`,
    rawSummary: parsed.rawSummary || cleanText.slice(0, 300),
  };
}

export const parseChatGptIdeaResponse = parseChatGptBlueprintResponse;

// -----------------------------------------------------------------------------
// 5. Pacing Calculation & Web Prompt Builder
// -----------------------------------------------------------------------------

export function calculateScriptPacingMetrics(
  blueprint?: IdeaBlueprint,
  channelProfile?: Partial<ChannelProfileConfig>
): ScriptPacingMetrics {
  const isShorts =
    blueprint?.aspectRatio === '9:16' ||
    channelProfile?.channelOrientation?.toLowerCase().includes('shorts') ||
    false;

  let targetDurationSec = 390; // Default: ~6.5 min (5_8_min)
  let targetMinutesText = '5 đến 8 phút';
  let minSentences = 40;
  let maxSentences = 60;
  let targetWords = 1250;
  let targetWordRange = '1.100 - 1.450 từ';
  let targetSentenceRange = '40 đến 60 câu phân cảnh';

  if (isShorts) {
    const shortDur = channelProfile?.targetShortDuration || '60_90_sec';
    if (shortDur === '30_60_sec') {
      targetDurationSec = 45;
      targetMinutesText = '30 đến 60 giây';
      targetWords = 140;
      targetWordRange = '100 - 160 từ';
      targetSentenceRange = '5 đến 8 câu phân cảnh';
      minSentences = 5;
      maxSentences = 8;
    } else {
      targetDurationSec = 75;
      targetMinutesText = '60 đến 90 giây';
      targetWords = 230;
      targetWordRange = '180 - 270 từ';
      targetSentenceRange = '8 đến 14 câu phân cảnh';
      minSentences = 8;
      maxSentences = 14;
    }
  } else {
    const longDur = channelProfile?.targetLongDuration || '5_8_min';
    if (longDur === '1_3_min') {
      targetDurationSec = 120;
      targetMinutesText = '1 đến 3 phút';
      targetWords = 380;
      targetWordRange = '300 - 550 từ';
      targetSentenceRange = '14 đến 22 câu phân cảnh';
      minSentences = 14;
      maxSentences = 22;
    } else if (longDur === '3_5_min') {
      targetDurationSec = 240;
      targetMinutesText = '3 đến 5 phút';
      targetWords = 750;
      targetWordRange = '650 - 900 từ';
      targetSentenceRange = '25 đến 38 câu phân cảnh';
      minSentences = 25;
      maxSentences = 38;
    } else if (longDur === '5_8_min') {
      targetDurationSec = 390;
      targetMinutesText = '5 đến 8 phút';
      targetWords = 1250;
      targetWordRange = '1.100 - 1.450 từ';
      targetSentenceRange = '40 đến 60 câu phân cảnh';
      minSentences = 40;
      maxSentences = 60;
    } else if (longDur === '8_12_min') {
      targetDurationSec = 600;
      targetMinutesText = '8 đến 12 phút';
      targetWords = 1900;
      targetWordRange = '1.650 - 2.300 từ';
      targetSentenceRange = '60 đến 90 câu phân cảnh';
      minSentences = 60;
      maxSentences = 90;
    } else if (longDur === '12_18_min') {
      targetDurationSec = 900;
      targetMinutesText = '12 đến 18 phút';
      targetWords = 2800;
      targetWordRange = '2.500 - 3.400 từ';
      targetSentenceRange = '90 đến 130 câu phân cảnh';
      minSentences = 90;
      maxSentences = 130;
    } else if (longDur === '18_28_min') {
      targetDurationSec = 1400;
      targetMinutesText = '18 đến 28 phút';
      targetWords = 4400;
      targetWordRange = '3.800 - 5.000 từ';
      targetSentenceRange = '130 đến 190 câu phân cảnh';
      minSentences = 130;
      maxSentences = 190;
    }
  }

  // If blueprint explicitly has estimatedDurationSec, adjust target sentences proportionally
  if (
    blueprint?.estimatedDurationSec &&
    blueprint.estimatedDurationSec > 0 &&
    Math.abs(blueprint.estimatedDurationSec - targetDurationSec) > 30
  ) {
    targetDurationSec = blueprint.estimatedDurationSec;
    targetWords = Math.round(targetDurationSec * 3.1);
    minSentences = Math.max(5, Math.round(targetWords / 25));
    maxSentences = Math.max(minSentences + 3, Math.round(targetWords / 18));
    targetWordRange = `${Math.round(targetWords * 0.85)} - ${Math.round(targetWords * 1.15)} từ`;
    targetSentenceRange = `${minSentences} đến ${maxSentences} câu phân cảnh`;
    const mins = Math.floor(targetDurationSec / 60);
    const secs = targetDurationSec % 60;
    targetMinutesText = mins > 0 ? `khoảng ${mins} phút ${secs > 0 ? `${secs}s` : ''}` : `${secs} giây`;
  }

  return {
    isShorts,
    targetDurationSec,
    targetMinutesText,
    targetWordRange,
    targetSentenceRange,
    minSentences,
    maxSentences,
    targetWords,
  };
}

export function buildScriptPromptForWeb(
  topic: string,
  preset: string,
  blueprint?: IdeaBlueprint,
  channelProfile?: Partial<ChannelProfileConfig>
): { prompt: string; metrics: ScriptPacingMetrics } {
  const metrics = calculateScriptPacingMetrics(blueprint, channelProfile);

  const title = blueprint?.title || topic;
  const projectName = channelProfile?.projectName || channelProfile?.channelNiche || 'Kênh Kể Chuyện AI';
  const orientation = channelProfile?.channelOrientation || preset || 'Kịch tính, sâu sắc, lôi cuốn, tư liệu thực tế';

  let prompt = '';

  if (metrics.isShorts) {
    prompt = `Bạn là biên kịch video ngắn chuyên nghiệp cho kênh video triệu view (YouTube Shorts / TikTok).
KÊNH: "${projectName}".
CHỦ ĐỀ: "${title}".
PHONG CÁCH: ${orientation}.
${blueprint?.hookConcept ? `HOOK 3S: "${blueprint.hookConcept}".` : ''}

NHIỆM VỤ:
Viết kịch bản lồng tiếng tiếng Việt hoàn chỉnh cho video ngắn độ dài ${metrics.targetMinutesText} (khoảng ${metrics.targetWordRange}, từ ${metrics.minSentences} đến ${metrics.maxSentences} câu).

QUY ĐỊNH ĐỊNH DẠNG BẮT BUỘC:
BẮT BUỘC bọc toàn bộ các câu trong marker:
=== BEGIN SCRIPT ===
CÂU 1: [Câu thoại mở đầu giật gân, cuốn hút người xem trong 3 giây đầu]
CÂU 2: [Câu thoại giới thiệu bối cảnh / dữ kiện bất ngờ]
...
CÂU ${metrics.maxSentences}: [Câu thoại kết luận và kêu gọi hành động đăng ký kênh]
=== END SCRIPT ===

CHÚ Ý: Mỗi câu viết trên 1 dòng riêng biệt theo đúng cú pháp "CÂU X: ...", không thêm lời chào, không thêm markdown phụ ngoài marker.`;
  } else {
    // LONG VIDEO (e.g. 5-8 minutes, 8-12 minutes)
    const outlineBlock =
      blueprint?.outline && blueprint.outline.length > 0
        ? `\nDÀN Ý PHÂN ĐOẠN CHI TIẾT (BẮT BUỘC BÁM SÁT VÀ PHÁT TRIỂN ĐỦ TẤT CẢ CÁC ĐOẠN NÀY):\n${blueprint.outline.join('\n')}\n`
        : '';

    prompt = `Bạn là nhà biên kịch YouTube cao cấp chuyên viết kịch bản lồng tiếng kể chuyện tài liệu dài triệu view.
KÊNH: "${projectName}"
CHỦ ĐỀ TẬP PHIM: "${title}"
${blueprint?.hookConcept ? `HOOK 3S BÚA BỔ MỞ ĐẦU: "${blueprint.hookConcept}"` : ''}
${blueprint?.narrativeAngle ? `GÓC NHÌN TIẾP CẬN: "${blueprint.narrativeAngle}"` : ''}
${channelProfile?.hostName ? `NGƯỜI DẪN / LỒNG TIẾNG (HOST): ${channelProfile.hostName}${channelProfile.hostDescription ? ` - ${channelProfile.hostDescription}` : ''}` : ''}
PHONG CÁCH KỂ CHUYỆN: ${orientation}
${outlineBlock}
NHIỆM VỤ CỐT TỬ VỀ ĐỘ DÀI VÀ NỘI DUNG:
- Độ dài mục tiêu: ${metrics.targetMinutesText} (${metrics.targetWordRange}).
- Kịch bản PHẢI ĐỦ DÀI, chia thành ${metrics.targetSentenceRange} độc lập.
- TUYỆT ĐỐI KHÔNG tóm tắt ngắn ngủn hay viết sơ sài vài câu. Phải đào sâu chi tiết, đưa ra bằng chứng thực tế, diễn biến kịch tính từng bước theo dàn ý.

QUY ĐỊNH ĐỊNH DẠNG BẮT BUỘC:
1. BẮT BUỘC bọc toàn bộ nội dung kịch bản trong marker:
=== BEGIN SCRIPT ===
CÂU 1: [Hook mở đầu búa bổ bằng danh từ riêng hoặc con số chấn động trong 6 giây đầu]
CÂU 2: [Phát triển bối cảnh...]
...
CÂU ${metrics.minSentences}: ...
...
CÂU ${metrics.maxSentences}: [Đúc kết lắng đọng và lời kết kêu gọi đăng ký kênh ${projectName}]
=== END SCRIPT ===

2. Mỗi câu có độ dài khoảng 18 đến 30 từ, viết cho TAI nghe (tự nhiên, giàu hình ảnh, nhịp ngắt nghỉ rõ ràng).
3. KHÔNG thêm lời chào mừng AI, KHÔNG thêm tiêu đề markdown phụ. Bắt đầu bằng === BEGIN SCRIPT === và kết thúc bằng === END SCRIPT ===.`;
  }

  return { prompt, metrics };
}

// -----------------------------------------------------------------------------
// 6. Schema Validators
// -----------------------------------------------------------------------------

export function validateScriptBeatLines(
  beats: ScriptBeatLine[],
  targetMinSentences = 3
): ScriptValidationResult {
  if (!Array.isArray(beats) || beats.length === 0) {
    return {
      isValid: false,
      beatCount: 0,
      reason: 'Danh sách phân cảnh rỗng',
      hasHook: false,
      hasOutro: false,
      totalDurationSec: 0,
    };
  }

  if (beats.length < targetMinSentences) {
    return {
      isValid: false,
      beatCount: beats.length,
      reason: `Số lượng câu (${beats.length}) ít hơn mục tiêu tối thiểu (${targetMinSentences})`,
      hasHook: beats[0]?.beatType === 'hook',
      hasOutro: beats[beats.length - 1]?.beatType === 'outro',
      totalDurationSec: beats.reduce((acc, b) => acc + (b.estimatedDurationSec || 0), 0),
    };
  }

  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    if (!b.text || b.text.trim().length < 6) {
      return {
        isValid: false,
        beatCount: beats.length,
        reason: `Phân cảnh #${i + 1} có nội dung quá ngắn hoặc rỗng`,
        hasHook: false,
        hasOutro: false,
        totalDurationSec: 0,
      };
    }
    if (isUserPromptEcho(b.text)) {
      return {
        isValid: false,
        beatCount: beats.length,
        reason: `Phân cảnh #${i + 1} bị lẫn prompt của người dùng`,
        hasHook: false,
        hasOutro: false,
        totalDurationSec: 0,
      };
    }
  }

  const hasHook = beats[0]?.beatType === 'hook';
  const hasOutro = beats[beats.length - 1]?.beatType === 'outro';
  const totalDurationSec = beats.reduce((acc, b) => acc + (b.estimatedDurationSec || 0), 0);

  return { isValid: true, beatCount: beats.length, hasHook, hasOutro, totalDurationSec };
}

export function validateIdeaBlueprint(blueprint: IdeaBlueprint): BlueprintValidationResult {
  const missingFields: string[] = [];
  if (!blueprint || typeof blueprint !== 'object') {
    return { isValid: false, missingFields: ['blueprint'], reason: 'Blueprint is null' };
  }

  if (!blueprint.title && !blueprint.topic) missingFields.push('title');
  if (!blueprint.hookConcept || blueprint.hookConcept.trim().length < 5) missingFields.push('hookConcept');
  if (!blueprint.narrativeAngle || blueprint.narrativeAngle.trim().length < 5) missingFields.push('narrativeAngle');
  if (!Array.isArray(blueprint.outline) || blueprint.outline.length < 3) missingFields.push('outline (>= 3 items)');
  if (!blueprint.estimatedDurationSec || blueprint.estimatedDurationSec <= 0) missingFields.push('estimatedDurationSec');

  const isValid = missingFields.length === 0;
  return {
    isValid,
    missingFields,
    reason: isValid ? undefined : `Thiếu các trường bắt buộc: ${missingFields.join(', ')}`,
  };
}

// -----------------------------------------------------------------------------
// 7. Facade Class: ChatGptWebSessionManager
// -----------------------------------------------------------------------------

export class ChatGptWebSessionManager {
  private static instance: ChatGptWebSessionManager | null = null;
  private lastConversationUrl: string | null = null;
  private busy = false;

  private constructor() {}

  public static getInstance(): ChatGptWebSessionManager {
    if (!ChatGptWebSessionManager.instance) {
      ChatGptWebSessionManager.instance = new ChatGptWebSessionManager();
    }
    return ChatGptWebSessionManager.instance;
  }

  public static resetInstance(): void {
    ChatGptWebSessionManager.instance = null;
  }

  public getLastConversationUrl(): string | null {
    return this.lastConversationUrl;
  }

  public setLastConversationUrl(url: string | null): void {
    this.lastConversationUrl = url;
  }

  public resetConversation(): void {
    this.lastConversationUrl = null;
  }

  public isBusySession(): boolean {
    return this.busy;
  }

  public isBusyState(): boolean {
    return this.busy;
  }

  public isBusy(): boolean {
    return this.busy;
  }

  /**
   * Backward-compatible session partition getter.
   */
  public getSession(): any {
    if (typeof session !== 'undefined' && typeof session.fromPartition === 'function') {
      return session.fromPartition('persist:chatgpt_session');
    }
    return null;
  }

  /**
   * Probes login status on ChatGPT Web via Playwright CDP.
   */
  public async checkLoginStatus(): Promise<ChatGptLoginStatus> {
    try {
      const collector = ChatGptScriptCollector.getInstance();
      const status = await collector.checkLoginStatus();
      return {
        isLoggedIn: Boolean(status.isLoggedIn),
        userEmail: status.userEmail,
        sessionCheckedAt: Date.now(),
      };
    } catch {
      return {
        isLoggedIn: false,
        sessionCheckedAt: Date.now(),
      };
    }
  }

  /**
   * Opens Google Chrome (Port 9223) for human authentication.
   * In headless CLI test environments where Electron runtime is absent, throws explicit error.
   */
  public async openLoginWindow(waitForCompletion = false): Promise<boolean> {
    if (typeof BrowserWindow === 'undefined' && !process.env.PLAYWRIGHT_LIVE_CHROME) {
      // Compatibility guard for headless CLI test runner
      throw new Error('Môi trường Electron không khả dụng để mở trình duyệt ChatGPT.');
    }

    const chromeMgr = ChromeManager.getInstance();
    const info = await chromeMgr.launchChrome({ port: 9223, headless: false, startUrl: 'https://chatgpt.com' });
    if (!info.isAlive) {
      return false;
    }

    if (!waitForCompletion) {
      return true;
    }

    const startTime = Date.now();
    const maxWaitMs = 300000; // 5 min timeout
    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 1500));
      const isAlive = await chromeMgr.isPortAlive(9223);
      if (!isAlive) {
        return false;
      }
      const st = await this.checkLoginStatus();
      if (st.isLoggedIn) {
        return true;
      }
    }
    return false;
  }

  /**
   * Cleanly disconnects CDP client and shuts down Chrome instance.
   */
  public async closeWindow(): Promise<void> {
    try {
      await ChatGptCdpClient.getInstance().disconnect();
    } catch {}
    try {
      await ChromeManager.getInstance().closeChrome();
    } catch {}
  }

  /**
   * Logs out of ChatGPT Web by closing Chrome and clearing session storage data.
   */
  public async logout(): Promise<void> {
    await this.closeWindow();
    this.lastConversationUrl = null;
    const ses = this.getSession();
    if (ses && typeof ses.clearStorageData === 'function') {
      try {
        await ses.clearStorageData();
      } catch {}
    }
  }

  /**
   * Generates video script via ChatGPT Web using Playwright CDP & continuation engine.
   * Conforms 100% to AiStudioLlmService.generateScript.
   */
  public async generateScriptWeb(
    topic: string,
    preset = 'youtube_story',
    _mode: 'offscreen' | 'visible' = 'offscreen',
    onProgress?: (msg: string) => void,
    blueprint?: IdeaBlueprint,
    channelProfile?: Partial<ChannelProfileConfig>
  ): Promise<string> {
    if (this.busy) {
      throw new Error('ChatGPT Web đang bận thực hiện tác vụ khác. Vui lòng thử lại sau giây lát.');
    }
    this.busy = true;

    try {
      const loginStatus = await this.checkLoginStatus();
      if (!loginStatus.isLoggedIn) {
        onProgress?.('Chưa phát hiện đăng nhập ChatGPT Web. Đang mở cửa sổ đăng nhập...');
        const opened = await this.openLoginWindow(true);
        if (!opened) {
          throw new Error('Không thể khởi chạy Google Chrome để đăng nhập ChatGPT Web.');
        }
        const recheck = await this.checkLoginStatus();
        if (!recheck.isLoggedIn) {
          throw new Error('Vui lòng hoàn tất đăng nhập tài khoản ChatGPT Web trong cửa sổ Chrome để sử dụng Chế độ Tiết kiệm.');
        }
      }

      const { prompt, metrics } = buildScriptPromptForWeb(topic, preset, blueprint, channelProfile);
      onProgress?.(`Đang yêu cầu AI viết kịch bản mục tiêu ${metrics.targetMinutesText} (${metrics.targetSentenceRange})...`);

      const collector = ChatGptScriptCollector.getInstance();
      const targetUrl = channelProfile?.chatgptConversationUrl || this.lastConversationUrl || undefined;

      const result = await collector.collect({
        prompt,
        kind: 'script',
        targetMinSentences: metrics.minSentences,
        targetMaxSentences: metrics.maxSentences,
        onProgress,
        startNewChat: !targetUrl,
        targetUrl,
        topic,
      });

      if (result.conversationUrl) {
        this.lastConversationUrl = result.conversationUrl;
        if (channelProfile) {
          channelProfile.chatgptConversationUrl = result.conversationUrl;
        }
      }

      let finalResponse = result.rawText || result.text || '';

      if (isUserPromptEcho(finalResponse)) {
        throw new Error('Phát hiện phản hồi bị bắt nhầm prompt người dùng (User Prompt Echo). Vui lòng thử lại.');
      }

      // F22: Schema Validation & Targeted Retry
      const parsedBeats = parseChatGptScriptResponse(finalResponse, topic);
      if (parsedBeats.length < 3 && !result.isTruncated) {
        onProgress?.('Kịch bản chưa đúng định dạng. Đang tự động retry yêu cầu định dạng chuẩn...');
        const retryPrompt = `Kịch bản bạn vừa viết chưa đúng định dạng câu phân cảnh. Vui lòng viết lại toàn bộ kịch bản theo đúng cú pháp bắt buộc:\n=== BEGIN SCRIPT ===\nCÂU 1: [Câu thoại mở đầu] | VISUAL: [...] | CAMERA: [...] | MEDIA: [video]\nCÂU 2: [Câu thoại tiếp theo] | VISUAL: [...] | CAMERA: [...] | MEDIA: [image]\n...\nCÂU ${metrics.minSentences}: [Câu thoại kết luận]\n=== END SCRIPT ===`;
        try {
          const retryResult = await collector.collect({
            prompt: retryPrompt,
            kind: 'script',
            targetMinSentences: metrics.minSentences,
            targetMaxSentences: metrics.maxSentences,
            onProgress,
            startNewChat: false,
            targetUrl: this.lastConversationUrl || undefined,
            topic,
          });
          const retryParsed = parseChatGptScriptResponse(retryResult.rawText || retryResult.text || '', topic);
          if (retryParsed.length >= 3) {
            finalResponse = retryResult.rawText || retryResult.text || '';
          }
        } catch (retryErr) {
          console.warn('[ChatGptWebSession] Safe retry notice:', retryErr);
        }
      }

      return sanitizePromptEchoFromOutput(finalResponse, prompt);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Executes a single prompt turn on ChatGPT Web (e.g. Master Prompt, Idea, Script).
   * Conforms 100% to AiStudioLlmService.analyzeIdeaBlueprint and generateMasterPromptForChannel.
   */
  public async executePromptTurn(
    prompt: string,
    _mode: 'offscreen' | 'visible' = 'offscreen',
    onProgress?: (msg: string) => void,
    startNewChat = false,
    targetConversationUrl?: string,
    expectedKind: 'master_prompt' | 'idea' | 'script' | 'general' | 'raw' = 'general'
  ): Promise<string> {
    if (this.busy) {
      throw new Error('ChatGPT Web đang bận thực hiện tác vụ khác. Vui lòng thử lại sau giây lát.');
    }
    this.busy = true;

    try {
      const loginStatus = await this.checkLoginStatus();
      if (!loginStatus.isLoggedIn) {
        onProgress?.('Chưa phát hiện đăng nhập ChatGPT Web. Đang mở cửa sổ đăng nhập...');
        const opened = await this.openLoginWindow(true);
        if (!opened) {
          throw new Error('Không thể khởi chạy Google Chrome để đăng nhập ChatGPT Web.');
        }
        const recheck = await this.checkLoginStatus();
        if (!recheck.isLoggedIn) {
          throw new Error('Vui lòng hoàn tất đăng nhập tài khoản ChatGPT Web để sử dụng Chế độ Tiết kiệm.');
        }
      }

      const kind: ScriptKind =
        expectedKind === 'idea'
          ? 'idea'
          : expectedKind === 'master_prompt'
          ? 'master_prompt'
          : expectedKind === 'script'
          ? 'script'
          : 'raw';

      const formattedPrompt = buildPromptWithMarkers(prompt, kind);
      const collector = ChatGptScriptCollector.getInstance();
      const targetUrl = targetConversationUrl || this.lastConversationUrl || undefined;

      const result = await collector.collect({
        prompt: formattedPrompt,
        kind,
        onProgress,
        startNewChat,
        targetUrl: startNewChat ? undefined : targetUrl,
      });

      if (result.conversationUrl) {
        this.lastConversationUrl = result.conversationUrl;
      }

      let outputText = result.rawText || result.text || '';

      if (isUserPromptEcho(outputText)) {
        throw new Error('Phát hiện phản hồi bị bắt nhầm prompt người dùng (User Prompt Echo). Vui lòng thử lại.');
      }

      outputText = sanitizePromptEchoFromOutput(outputText, prompt, kind);

      // Schema validation and repair for idea blueprints
      if (expectedKind === 'idea') {
        const blueprint = parseChatGptIdeaResponse(outputText, 'Ý tưởng video');
        const val = validateIdeaBlueprint(blueprint);
        if (!val.isValid) {
          onProgress?.(`Ý tưởng chưa đủ trường (${val.reason}). Đang gửi yêu cầu bổ sung...`);
          const repairPrompt = `Khối JSON trước đó chưa hợp lệ: ${val.reason}.
BẮT BUỘC trả về DUY NHẤT một khối JSON đầy đủ, bọc trong marker:
=== BEGIN JSON ===
{
  "title": "Tiêu đề",
  "hookConcept": "Câu mở đầu 3s",
  "narrativeAngle": "Góc nhìn",
  "outline": ["1...", "2...", "3..."],
  "estimatedDurationSec": 60,
  "thumbnailConcept": "Mô tả thumbnail",
  "thumbnailPrompt": "Prompt tiếng Anh"
}
=== END JSON ===`;
          try {
            const retryRes = await collector.collect({
              prompt: repairPrompt,
              kind: 'idea',
              startNewChat: false,
              onProgress,
            });
            const retryBp = parseChatGptIdeaResponse(retryRes.rawText || retryRes.text || '', 'Ý tưởng video');
            if (validateIdeaBlueprint(retryBp).isValid) {
              outputText = retryRes.rawText || retryRes.text || '';
            }
          } catch (repairErr) {
            console.warn('[ChatGptWebSession] Idea repair notice:', repairErr);
          }
        }
      }

      return outputText;
    } finally {
      this.busy = false;
    }
  }
}
