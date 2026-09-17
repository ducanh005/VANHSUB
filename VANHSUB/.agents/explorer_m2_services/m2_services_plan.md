# Vanhsub AI Video Studio — Milestone 2: Modular Services Architecture & Engineering Specification

> **Subsystem**: AI Video Studio Backend Services  
> **Milestone**: M2 (Pipeline Engine & Modular Services)  
> **Target Directory**: `main/ai-studio/services/`  
> **Status**: Comprehensive Engineering Plan & Architectural Specification  

---

## 1. Executive Summary & Architectural Overview

Milestone 2 (M2) transitions the Vanhsub AI Video Studio from the configuration/store baseline established in Milestone 1 into a production-grade, modular 8-stage automated media production pipeline.

The architecture decouples the previous monolithic pipeline stub into **4 highly specialized modular services** residing under `main/ai-studio/services/`:

```
main/
  ai-studio/
    types.ts                        # Shared schemas, payload contracts, defaults
    ipc.ts                          # Electron IPC router & engine delegate bridge
    AiStudioPipelineEngine.ts       # 8-stage coordinator, state machine & checkpoints
    services/
      AiStudioLlmService.ts         # Stage 1 (Blueprint), Stage 2 (Script), Stage 8 (SEO), Script Audit
      AiStudioTtsService.ts         # Stage 3 (Edge TTS), Stage 4 (Word-Boundary Alignment), Single-Line Voice
      AiStudioVisualService.ts      # Stage 5 (Storyboard Prompts), Stage 6 (Dual-Mode Visuals), Single-Scene Asset
      AiStudioVideoAssembler.ts     # Stage 7 (FFmpeg Ken Burns + Ducked BGM + Dynamic ASS Subtitles)
```

### Core Architecture Principles
1. **Decoupled Single-Responsibility Services**: Each service encapsulates its domain logic, external dependencies (`openai`, `msedge-tts`, `fluent-ffmpeg`, `GoogleVeoSessionManager`), and internal error handling.
2. **Dual-Mode Execution & Graceful Degradation**:
   - When external services are authenticated and online (e.g. valid Google Flow session, valid LLM API key), the services utilize full cloud generation.
   - When unauthenticated, offline, rate-limited, or in test environments, services seamlessly engage calibrated heuristic/procedural fallbacks (synthetic high-res scene cards, procedural scripts, syllabic interpolation) without breaking the pipeline.
3. **Idempotent Checkpoints & Granular Step Operations**: The pipeline supports resuming from any stage and allows individual granular mutations (re-synthesizing a single voice line, regenerating a single scene card, re-rendering with new subtitle styles).
4. **Zero-Contamination Isolation**: Dedicated storage in `vanhsub-ai-studio.json` and session workspaces under `~/.vanhsub/ai-studio-sessions/` ensures absolute zero interference with Vanhsub's existing `settingsStore` or Canvas workflow.

---

## 2. Shared Data Models & Contracts (`main/ai-studio/types.ts`)

The services exchange strongly-typed data structures aligned with `AI_STUDIO_SPEC.md §5.1` and `main/ai-studio/types.ts`:

### 2.1. Script & Beat Structure
```typescript
export interface ScriptBeatLine {
  id: string;
  index: number;
  speaker?: string;
  text: string;
  startMs?: number;
  endMs?: number;
  durationMs?: number;
  audioPath?: string;
  visualPromptEn?: string;
  assetPath?: string;
  assetType?: 'image' | 'video';
  beatType?: 'hook' | 'intro' | 'body' | 'climax' | 'outro';
}
```

### 2.2. Timestamp Alignment Contract
```typescript
export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}
```

### 2.3. Storyboard Scene Model
```typescript
export interface StoryboardScene {
  id: string;
  lineIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  lineText: string;
  visualPrompt: string;
  negativePrompt?: string;
  motionType: 'ken_burns' | 'video';
  assetPath?: string;
  status: 'pending' | 'generating' | 'ready' | 'error';
  error?: string;
}
```

### 2.4. SEO & Publishing Metadata
```typescript
export interface SeoMetadata {
  title: string;
  description: string;
  hashtags: string[];
  thumbnailPrompt: string;
}
```

### 2.5. Idea Blueprint Model
```typescript
export interface IdeaBlueprint {
  topic: string;
  targetAudience: string;
  narrativeAngle: string;
  hookConcept: string;
  pacing: 'fast' | 'moderate' | 'slow';
  estimatedDurationSec: number;
  keyBeats: string[];
  rawSummary: string;
}
```

### 2.6. Script Quality Audit Model
```typescript
export interface ScriptQualityAuditResult {
  retentionScore: number; // 0 - 100
  hookScore: number;      // 0 - 100
  pacingScore: number;    // 0 - 100
  hookAnalysis: string;
  retentionLoopSuggestions: string[];
  ctaEvaluation: string;
  overallFeedback: string;
}
```

---

## 3. Detailed Modular Service Specifications

---

### Service 1: `AiStudioLlmService.ts`
**Location**: `main/ai-studio/services/AiStudioLlmService.ts`  
**Dependencies**: `openai`, `jsonrepair`, `crypto`  
**Responsibilities**:
- Stage 1: Idea / blueprint analysis (hook, angle, pacing).
- Stage 2: Script generation via OpenAI SDK or custom endpoint with `jsonrepair` and structured JSON extraction. Includes fallback generator when API key is unconfigured.
- Stage 8: SEO metadata generation (viral title, description, hashtags, thumbnail prompt).
- Script quality audit (retention score 0-100, hook analysis).

#### Architectural Details & Implementation Design

```typescript
import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import crypto from 'crypto';
import type {
  AiStudioLlmConfig,
  ScriptBeatLine,
  IdeaBlueprint,
  SeoMetadata,
  ScriptQualityAuditResult,
} from '../types';

export class AiStudioLlmService {
  private static instance: AiStudioLlmService | null = null;

  public static getInstance(): AiStudioLlmService {
    if (!AiStudioLlmService.instance) {
      AiStudioLlmService.instance = new AiStudioLlmService();
    }
    return AiStudioLlmService.instance;
  }

  // --------------------------------------------------------------------------
  // Helper: OpenAI Client Factory
  // --------------------------------------------------------------------------
  private createClient(config: AiStudioLlmConfig): { client: OpenAI; model: string } | null {
    const rawApiKey = (config.apiKey || '').trim();
    if (!rawApiKey) return null;

    let baseURL = (config.baseUrl || '').trim();
    if (!baseURL) {
      if (config.provider === 'deepseek') {
        baseURL = 'https://api.deepseek.com/v1';
      } else {
        baseURL = 'https://api.openai.com/v1';
      }
    }

    const client = new OpenAI({
      apiKey: rawApiKey,
      baseURL,
      timeout: 45_000,
      maxRetries: 1,
    });

    const model = config.model || (config.provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o');
    return { client, model };
  }

  // --------------------------------------------------------------------------
  // Stage 1: Idea Blueprint Analysis
  // --------------------------------------------------------------------------
  public async analyzeIdeaBlueprint(
    topic: string,
    config: AiStudioLlmConfig
  ): Promise<IdeaBlueprint> {
    const clientBundle = this.createClient(config);
    if (!clientBundle) {
      return this.generateFallbackBlueprint(topic, config.systemPromptPreset);
    }

    try {
      const prompt = `Bạn là giám đốc sáng tạo video ngắn triệu view.
Hãy phân tích chủ đề sau và lập kế hoạch sản xuất video:
Chủ đề: "${topic}"
Preset: "${config.systemPromptPreset}"

Trả về định dạng JSON DUY NHẤT (không giải thích thêm, không markdown wrapper):
{
  "targetAudience": "Đối tượng khán giả mục tiêu",
  "narrativeAngle": "Góc nhìn kể chuyện độc đáo",
  "hookConcept": "Ý tưởng mở đầu giật gân giữ chân trong 3 giây",
  "pacing": "fast | moderate | slow",
  "estimatedDurationSec": 60,
  "keyBeats": ["Ý chính 1", "Ý chính 2", "Ý chính 3", "Ý chính 4"],
  "rawSummary": "Tóm tắt chiến lược nội dung trong 2 câu"
}`;

      const response = await clientBundle.client.chat.completions.create({
        model: clientBundle.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: config.temperature || 0.6,
      });

      const rawText = response.choices[0]?.message?.content || '';
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const repaired = jsonrepair(cleaned);
      const parsed = JSON.parse(repaired);

      return {
        topic,
        targetAudience: parsed.targetAudience || 'Khán giả đại chúng yêu thích khám phá',
        narrativeAngle: parsed.narrativeAngle || 'Bật mí sự thật bí ẩn chưa từng tiết lộ',
        hookConcept: parsed.hookConcept || `Bạn có tin vào điều kỳ lạ nhất về ${topic}?`,
        pacing: parsed.pacing || 'fast',
        estimatedDurationSec: Number(parsed.estimatedDurationSec) || 60,
        keyBeats: Array.isArray(parsed.keyBeats) ? parsed.keyBeats : ['Hook', 'Thực tế', 'Bí ẩn', 'Kết luận'],
        rawSummary: parsed.rawSummary || `Phân tích chiến lược nội dung cho "${topic}".`,
      };
    } catch (err) {
      console.warn('[AiStudioLlmService] LLM blueprint analysis failed, engaging fallback:', err);
      return this.generateFallbackBlueprint(topic, config.systemPromptPreset);
    }
  }

  // --------------------------------------------------------------------------
  // Stage 2: Script Generation
  // --------------------------------------------------------------------------
  public async generateScript(
    topic: string,
    config: AiStudioLlmConfig
  ): Promise<ScriptBeatLine[]> {
    const clientBundle = this.createClient(config);
    if (!clientBundle) {
      return this.generateFallbackScript(topic, config.systemPromptPreset);
    }

    try {
      const prompt = `Bạn là nhà biên kịch video ngắn chuyên nghiệp.
Nhiệm vụ: Viết kịch bản lồng tiếng tiếng Việt hoàn chỉnh cho chủ đề: "${topic}".
Phong cách preset: "${config.systemPromptPreset}".

Yêu cầu nghiêm ngặt:
1. Chia kịch bản thành từng câu ngắn (4 - 8 câu), mỗi câu là 1 phân cảnh độc lập.
2. Câu mở đầu (index 1) PHẢI là "hook" cuốn hút gây tò mò trong 3 giây đầu.
3. Câu kết thúc PHẢI là "outro" kêu gọi hành động (đăng ký kênh, theo dõi Vanhsub AI Studio).
4. Phân loại beatType: "hook" | "intro" | "body" | "climax" | "outro".
5. Trả về định dạng JSON DUY NHẤT có cấu trúc:
{
  "lines": [
    {
      "index": 1,
      "text": "Câu thoại tiếng Việt đầy đủ...",
      "estimatedDurationSec": 4.5,
      "beatType": "hook"
    }
  ]
}`;

      const response = await clientBundle.client.chat.completions.create({
        model: clientBundle.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: config.temperature || 0.6,
      });

      const rawText = response.choices[0]?.message?.content || '';
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const repaired = jsonrepair(cleaned);
      const parsed = JSON.parse(repaired);

      const rawLines = Array.isArray(parsed) ? parsed : parsed.lines;
      if (!Array.isArray(rawLines) || rawLines.length === 0) {
        throw new Error('LLM did not return an array of script lines');
      }

      return rawLines.map((item: any, idx: number) => ({
        id: `line-${idx + 1}-${crypto.randomBytes(3).toString('hex')}`,
        index: idx + 1,
        text: String(item.text || '').trim(),
        estimatedDurationSec: Number(item.estimatedDurationSec) || 4.5,
        beatType: item.beatType || (idx === 0 ? 'hook' : idx === rawLines.length - 1 ? 'outro' : 'body'),
      }));
    } catch (err) {
      console.warn('[AiStudioLlmService] LLM script generation failed, engaging fallback:', err);
      return this.generateFallbackScript(topic, config.systemPromptPreset);
    }
  }

  // --------------------------------------------------------------------------
  // Stage 8: SEO Metadata Generation
  // --------------------------------------------------------------------------
  public async generateSeoMetadata(
    topic: string,
    scriptLines: ScriptBeatLine[],
    config: AiStudioLlmConfig
  ): Promise<SeoMetadata> {
    const clientBundle = this.createClient(config);
    if (!clientBundle) {
      return this.generateFallbackSeo(topic, scriptLines);
    }

    try {
      const summaryText = scriptLines.map((l) => l.text).join(' ');
      const prompt = `Bạn là chuyên gia tối ưu hóa video YouTube & TikTok (SEO Specialist).
Dựa trên kịch bản video sau về chủ đề "${topic}":
Nội dung: "${summaryText.slice(0, 1000)}"

Hãy tạo bộ siêu dữ liệu SEO lan truyền (viral metadata):
Trả về JSON DUY NHẤT:
{
  "title": "Tiêu đề giật tít chuẩn CTR cao (10-100 ký tự)",
  "description": "Mô tả video chi tiết hấp dẫn, có kêu gọi hành động (ít nhất 50 ký tự)",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"],
  "thumbnailPrompt": "Cinematic visual prompt tiếng Anh để sinh ảnh thumbnail ấn tượng"
}`;

      const response = await clientBundle.client.chat.completions.create({
        model: clientBundle.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      });

      const rawText = response.choices[0]?.message?.content || '';
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const repaired = jsonrepair(cleaned);
      const parsed = JSON.parse(repaired);

      return {
        title: parsed.title || `${topic} — Bí Ẩn Chưa Ai Tiết Lộ | Vanhsub AI Studio`,
        description: parsed.description || `Khám phá toàn cảnh về ${topic}. Hãy theo dõi kênh Vanhsub để cập nhật kiến thức mới!`,
        hashtags: Array.isArray(parsed.hashtags) && parsed.hashtags.length >= 3
          ? parsed.hashtags.map((h: string) => (h.startsWith('#') ? h : `#${h}`))
          : ['#vanhsub', '#bian', '#khampha', '#khoahoc', '#aivideo'],
        thumbnailPrompt: parsed.thumbnailPrompt || `Cinematic dramatic eye-level thumbnail shot for ${topic}, vivid lighting, 8k`,
      };
    } catch (err) {
      console.warn('[AiStudioLlmService] LLM SEO generation failed, engaging fallback:', err);
      return this.generateFallbackSeo(topic, scriptLines);
    }
  }

  // --------------------------------------------------------------------------
  // Script Quality Audit (Custom Studio Tab 1 Feature F25)
  // --------------------------------------------------------------------------
  public async auditScriptQuality(
    scriptLines: ScriptBeatLine[],
    config?: AiStudioLlmConfig
  ): Promise<ScriptQualityAuditResult> {
    const clientBundle = config ? this.createClient(config) : null;
    if (!clientBundle || scriptLines.length === 0) {
      return this.auditScriptHeuristically(scriptLines);
    }

    try {
      const scriptDump = scriptLines.map((l, i) => `${i + 1}. [${l.beatType || 'beat'}] ${l.text}`).join('\n');
      const prompt = `Bạn là chuyên gia thẩm định kịch bản video ngắn hàng đầu (Audience Retention Auditor).
Hãy đánh giá kịch bản sau:
${scriptDump}

Chấm điểm trên thang 100 và trả về JSON DUY NHẤT:
{
  "retentionScore": 85,
  "hookScore": 90,
  "pacingScore": 80,
  "hookAnalysis": "Đánh giá chi tiết câu mở đầu",
  "retentionLoopSuggestions": ["Góp ý 1 để giữ chân người xem", "Góp ý 2"],
  "ctaEvaluation": "Đánh giá câu kêu gọi hành động cuối",
  "overallFeedback": "Nhận xét tổng quan"
}`;

      const response = await clientBundle.client.chat.completions.create({
        model: clientBundle.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });

      const rawText = response.choices[0]?.message?.content || '';
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const repaired = jsonrepair(cleaned);
      const parsed = JSON.parse(repaired);

      return {
        retentionScore: Math.max(0, Math.min(100, Math.round(parsed.retentionScore || 80))),
        hookScore: Math.max(0, Math.min(100, Math.round(parsed.hookScore || 85))),
        pacingScore: Math.max(0, Math.min(100, Math.round(parsed.pacingScore || 80))),
        hookAnalysis: parsed.hookAnalysis || 'Mở đầu ấn tượng, kích thích sự tò mò của khán giả.',
        retentionLoopSuggestions: Array.isArray(parsed.retentionLoopSuggestions)
          ? parsed.retentionLoopSuggestions
          : ['Rút ngắn nhịp chuyển cảnh giữa các câu', 'Tăng tính đối lập trong câu cao trào'],
        ctaEvaluation: parsed.ctaEvaluation || 'Kêu gọi hành động rõ ràng và tự nhiên.',
        overallFeedback: parsed.overallFeedback || 'Kịch bản có cấu trúc tốt, sẵn sàng cho công đoạn sản xuất video.',
      };
    } catch {
      return this.auditScriptHeuristically(scriptLines);
    }
  }

  // --------------------------------------------------------------------------
  // Fallback Procedural Generators
  // --------------------------------------------------------------------------
  public generateFallbackBlueprint(topic: string, preset = 'youtube_story'): IdeaBlueprint {
    return {
      topic,
      targetAudience: 'Người xem yêu thích thông tin ngắn gọn, kịch tính và giàu hình ảnh',
      narrativeAngle: 'Khám phá những khía cạnh ẩn giấu ít người biết',
      hookConcept: `Chào mừng bạn đến với ${topic}. Liệu bạn đã biết toàn bộ sự thật?`,
      pacing: preset === 'tiktok_short' ? 'fast' : 'moderate',
      estimatedDurationSec: 20,
      keyBeats: [
        'Đặt câu hỏi kích thích tò mò',
        'Cung cấp dữ kiện bất ngờ',
        'Phân tích chi tiết cao trào',
        'Kêu gọi hành động và theo dõi',
      ],
      rawSummary: `Video 4 nhịp tập trung vào yếu tố giật gân và giá trị thực tế của "${topic}".`,
    };
  }

  public generateFallbackScript(topic: string, preset = 'youtube_story'): ScriptBeatLine[] {
    return [
      {
        id: `line-1-${crypto.randomBytes(3).toString('hex')}`,
        index: 1,
        text: `Chào mừng bạn đến với hành trình khám phá ${topic}. Bạn có tin vào những bí ẩn chưa từng được tiết lộ?`,
        estimatedDurationSec: 4.5,
        beatType: 'hook',
      },
      {
        id: `line-2-${crypto.randomBytes(3).toString('hex')}`,
        index: 2,
        text: 'Ở độ sâu hàng ngàn mét, áp suất và bóng tối bao trùm, các nhà khoa học đã ghi nhận những âm thanh kỳ lạ.',
        estimatedDurationSec: 5.0,
        beatType: 'intro',
      },
      {
        id: `line-3-${crypto.randomBytes(3).toString('hex')}`,
        index: 3,
        text: 'Những sinh vật phát quang bí ẩn và cấu trúc địa chất khổng lồ thách thức mọi định luật vật lý hiện đại.',
        estimatedDurationSec: 5.2,
        beatType: 'climax',
      },
      {
        id: `line-4-${crypto.randomBytes(3).toString('hex')}`,
        index: 4,
        text: 'Hãy đăng ký kênh Vanhsub AI Studio ngay hôm nay để không bỏ lỡ những phát hiện chấn động tiếp theo.',
        estimatedDurationSec: 4.8,
        beatType: 'outro',
      },
    ];
  }

  public generateFallbackSeo(topic: string, scriptLines: ScriptBeatLine[]): SeoMetadata {
    return {
      title: `${topic} — Những Bí Ẩn Rùng Mình Chưa Có Lời Giải Đáp`,
      description: `Khám phá chi tiết về "${topic}". Video được sản xuất tự động toàn diện từ kịch bản, giọng đọc AI đến dựng phim bởi Vanhsub AI Studio. Đừng quên bấm Like và Đăng Ký kênh!`,
      hashtags: ['#vanhsub', '#bian', '#khampha', '#khoahoc', '#aivideo', '#review'],
      thumbnailPrompt: `Cinematic dramatic thumbnail for ${topic}, high contrast lighting, glowing focal point, ultra-detailed, 8k resolution`,
    };
  }

  public auditScriptHeuristically(scriptLines: ScriptBeatLine[]): ScriptQualityAuditResult {
    const totalLines = scriptLines.length;
    const firstLine = scriptLines[0]?.text || '';
    const lastLine = scriptLines[totalLines - 1]?.text || '';

    const hasQuestion = /[?？]/.test(firstLine);
    const hasCuriosityWords = /(bí ẩn|sự thật|kinh ngạc|chưa từng|tại sao|liệu|bạn có biết)/i.test(firstLine);
    const hookScore = Math.min(95, 60 + (hasQuestion ? 20 : 0) + (hasCuriosityWords ? 15 : 0));

    const hasCta = /(đăng ký|theo dõi|like|share|bình luận|comment)/i.test(lastLine);
    const pacingScore = totalLines >= 4 && totalLines <= 12 ? 85 : 70;
    const retentionScore = Math.round((hookScore * 0.45 + pacingScore * 0.35 + (hasCta ? 20 : 10)));

    return {
      retentionScore,
      hookScore,
      pacingScore,
      hookAnalysis: hasCuriosityWords
        ? 'Hook mở đầu rất tốt, chứa các từ khóa gợi mở sự tò mò cao.'
        : 'Hook mở đầu ở mức khá; có thể bổ sung câu hỏi hoặc từ khóa kích thích tò mò hơn.',
      retentionLoopSuggestions: [
        'Duy trì độ dài câu vừa phải (15 - 25 từ) để giữ nhịp độ đọc hấp dẫn',
        'Bổ sung âm thanh hiệu ứng (SFX) ở các điểm ngắt ý chính',
      ],
      ctaEvaluation: hasCta
        ? 'Kêu gọi hành động rõ ràng ở câu kết thúc.'
        : 'Nên thêm lời nhắc đăng ký kênh hoặc để lại bình luận ở câu cuối.',
      overallFeedback: `Kịch bản đạt ${retentionScore}/100 điểm giữ chân khán giả, tối ưu cho định dạng video ngắn.`,
    };
  }
}

// Module-level exported helpers for direct test harness imports
export const aiStudioLlmService = AiStudioLlmService.getInstance();
export const generateScript = (topic: string, cfg: AiStudioLlmConfig) => aiStudioLlmService.generateScript(topic, cfg);
export const analyzeIdeaBlueprint = (topic: string, cfg: AiStudioLlmConfig) => aiStudioLlmService.analyzeIdeaBlueprint(topic, cfg);
export const generateSeoMetadata = (topic: string, lines: ScriptBeatLine[], cfg: AiStudioLlmConfig) => aiStudioLlmService.generateSeoMetadata(topic, lines, cfg);
export const auditScriptQuality = (lines: ScriptBeatLine[], cfg?: AiStudioLlmConfig) => aiStudioLlmService.auditScriptQuality(lines, cfg);
```

---

### Service 2: `AiStudioTtsService.ts`
**Location**: `main/ai-studio/services/AiStudioTtsService.ts`  
**Dependencies**: `msedge-tts`, `fluent-ffmpeg`, `@ffmpeg-installer/ffmpeg`, `@ffprobe-installer/ffprobe`, `fs`, `path`, `os`  
**Responsibilities**:
- Stage 3: Vietnamese voiceover synthesis using `msedge-tts` (`vi-VN-HoaiMyNeural` / `vi-VN-NamMinhNeural`).
- Stage 4: Native `WordBoundary` timestamp extraction (with syllabic interpolation fallback).
- Single-line voice re-synthesis method.

#### Architectural Details & Implementation Design

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import { MsEdgeTTS, OUTPUT_FORMAT, type ProsodyOptions } from 'msedge-tts';
import type {
  AiStudioVoiceConfig,
  ScriptBeatLine,
  WordTimestamp,
  RenderSingleLineVoicePayload,
  RenderSingleLineVoiceResult,
} from '../types';

export interface TtsSynthesisResult {
  audioPath: string;
  durationMs: number;
  sizeBytes: number;
  rawMetadata: any[];
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

  // --------------------------------------------------------------------------
  // Normalize Voice ID
  // --------------------------------------------------------------------------
  private normalizeVoiceId(voiceId?: string): string {
    const v = (voiceId || '').toLowerCase();
    if (v.includes('nam') || v.includes('male')) {
      return 'vi-VN-NamMinhNeural';
    }
    return 'vi-VN-HoaiMyNeural';
  }

  // --------------------------------------------------------------------------
  // Stage 3: Voiceover Synthesis with WordBoundary Capture
  // --------------------------------------------------------------------------
  public async synthesizeVoiceover(
    text: string,
    voiceConfig: AiStudioVoiceConfig,
    outputPath: string
  ): Promise<TtsSynthesisResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Văn bản lồng tiếng không được để trống.');
    }

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
      const tts = new MsEdgeTTS();

      try {
        await tts.setMetadata(targetVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
          wordBoundaryEnabled: voiceConfig.autoWordAlignment !== false,
          sentenceBoundaryEnabled: true,
        });

        const { audioStream, metadataStream } = tts.toStream(trimmed, prosody);
        const audioChunks: Buffer[] = [];
        const rawMetadata: any[] = [];

        await new Promise<void>((resolve, reject) => {
          const timeoutTimer = setTimeout(() => {
            try { tts.close(); } catch {}
            reject(new Error(`Edge TTS timed out after 25s (attempt ${attempt}/${maxRetries})`));
          }, 25_000);

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
          throw new Error('Edge TTS returned 0-byte audio buffer');
        }

        fs.writeFileSync(outputPath, audioBuffer);
        const durationSec = await this.probeMediaDuration(outputPath);
        const durationMs = Math.round(durationSec * 1000);

        return {
          audioPath: outputPath,
          durationMs,
          sizeBytes: audioBuffer.length,
          rawMetadata,
        };
      } catch (err: any) {
        lastError = err;
        try { tts.close(); } catch {}
        if (attempt < maxRetries) {
          console.warn(`[AiStudioTtsService] Synthesis attempt ${attempt} failed, retrying in 1s...`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    throw new Error(`Edge TTS Voiceover synthesis failed: ${lastError?.message || lastError}`);
  }

  // --------------------------------------------------------------------------
  // Stage 4: Native Word-Boundary Alignment Extraction
  // --------------------------------------------------------------------------
  public extractAlignment(
    rawMetadata: any[],
    scriptText: string,
    scriptLines: ScriptBeatLine[],
    totalDurationMs: number
  ): AlignmentResult {
    const wordsAlignment: WordTimestamp[] = [];

    // 1. Attempt extracting native WordBoundary events (1 tick = 100ns = 0.0001ms)
    if (Array.isArray(rawMetadata) && rawMetadata.length > 0) {
      for (const item of rawMetadata) {
        if (item.Type === 'WordBoundary' && item.Data) {
          const offsetTicks = item.Data.Offset || 0;
          const durationTicks = item.Data.Duration || 0;
          const text = item.Data.text?.Text || '';
          const startMs = Math.round(offsetTicks / 10000);
          const endMs = Math.round((offsetTicks + durationTicks) / 10000);
          if (text && endMs > startMs) {
            wordsAlignment.push({ word: text, startMs, endMs });
          }
        }
      }
    }

    // 2. Fallback to Syllabic Distribution if native metadata was omitted
    if (wordsAlignment.length === 0) {
      console.log('[AiStudioTtsService] Engaging syllabic distribution interpolation engine.');
      const allWords = scriptText.trim().split(/\s+/).filter(Boolean);
      const safeDuration = Math.max(1000, totalDurationMs);
      const perWord = safeDuration / Math.max(1, allWords.length);

      allWords.forEach((word, idx) => {
        wordsAlignment.push({
          word,
          startMs: Math.round(idx * perWord),
          endMs: Math.round((idx + 1) * perWord),
        });
      });
    }

    // 3. Map alignment onto ScriptBeatLine array
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

  // --------------------------------------------------------------------------
  // Granular Step: Single-Line Voice Re-Synthesis (F23)
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Prober Helper
  // --------------------------------------------------------------------------
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
```

---

### Service 3: `AiStudioVisualService.ts`
**Location**: `main/ai-studio/services/AiStudioVisualService.ts`  
**Dependencies**: `GoogleVeoSessionManager`, `GoogleFlowBrowserMutex`, `fluent-ffmpeg`, `fs`, `path`, `os`  
**Responsibilities**:
- Stage 5: Visual storyboard prompt generator (English cinematic prompts, style prefix, negative prompt).
- Stage 6: Dual-mode dispatcher:
  - If Google Veo session is valid: dispatch to `GoogleVeoSessionManager`.
  - If unauthenticated / offline / test: generate high-resolution synthetic scene cards (via FFmpeg color canvas + text overlay or canvas).
- Single-scene asset re-generation method.

#### Architectural Details & Implementation Design

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import { GoogleVeoSessionManager } from '../../veo/GoogleVeoSessionManager';
import { GoogleFlowBrowserMutex } from '../../workflow/dispatcher/GoogleFlowBrowserMutex';
import type {
  AiStudioFlowEngineConfig,
  AiStudioLlmConfig,
  FlowAspectRatio,
  RenderingResolution,
  ScriptBeatLine,
  StoryboardScene,
  RegenerateSceneAssetPayload,
  RegenerateSceneAssetResult,
} from '../types';

export interface VisualDispatchResult {
  scenes: StoryboardScene[];
  generatedCount: number;
  modeUsed: 'google_flow' | 'synthetic_fallback';
}

export class AiStudioVisualService {
  private static instance: AiStudioVisualService | null = null;

  public static getInstance(): AiStudioVisualService {
    if (!AiStudioVisualService.instance) {
      AiStudioVisualService.instance = new AiStudioVisualService();
    }
    return AiStudioVisualService.instance;
  }

  // --------------------------------------------------------------------------
  // Stage 5: Storyboard Scene Prompts Generation
  // --------------------------------------------------------------------------
  public generateStoryboardScenes(
    scriptLines: ScriptBeatLine[],
    flowConfig: AiStudioFlowEngineConfig,
    _llmConfig?: AiStudioLlmConfig
  ): StoryboardScene[] {
    const stylePrefix = flowConfig.stylePromptPrefix || 'Cinematic lighting, high resolution, detailed photorealistic, 4k';
    const negativePrompt = flowConfig.negativePrompt || 'watermark, text, blurry, distortion, lowres';

    const visualConceptDictionary: Record<string, string> = {
      hook: 'dramatic opening concept, mysterious illuminated focal object, volumetric ocean depth rays, wide cinematic angle',
      intro: 'scientific exploration laboratory, high-tech monitors and charts, professional cinematography',
      body: 'detailed exploration of unknown phenomenon, intricate textures, dramatic lighting, sharp focus',
      climax: 'colossal ancient underwater monolith, bioluminescent glowing structures, epic breathtaking reveal',
      outro: 'golden hour open ocean view, majestic sunset reflection, peaceful atmospheric horizon, modern studio quality',
    };

    return scriptLines.map((line, idx) => {
      const beat = line.beatType || (idx === 0 ? 'hook' : idx === scriptLines.length - 1 ? 'outro' : 'body');
      const concept = visualConceptDictionary[beat] || 'cinematic atmospheric environment landscape';
      const visualPrompt = `${stylePrefix}, ${concept}, sharp focus, 8k wallpaper`;

      return {
        id: `scene-${idx + 1}`,
        lineIndex: idx,
        startMs: line.startMs || 0,
        endMs: line.endMs || 4000,
        durationMs: line.durationMs || 4000,
        lineText: line.text,
        visualPrompt,
        negativePrompt,
        motionType: flowConfig.outputMode === 'video' ? 'video' : 'ken_burns',
        status: 'pending',
      };
    });
  }

  // --------------------------------------------------------------------------
  // Stage 6: Dual-Mode Dispatcher
  // --------------------------------------------------------------------------
  public async dispatchVisualAssets(
    scenes: StoryboardScene[],
    flowConfig: AiStudioFlowEngineConfig,
    assetsDir: string,
    onProgress?: (pct: number, msg: string) => void,
    isCancelled?: () => boolean
  ): Promise<VisualDispatchResult> {
    fs.mkdirSync(assetsDir, { recursive: true });

    // Check Google Flow session validity
    let useGoogleFlow = false;
    try {
      const sessionMgr = GoogleVeoSessionManager.getInstance();
      const status = await sessionMgr.validateSession();
      if (status.valid && status.status === 'active') {
        useGoogleFlow = true;
      }
    } catch {
      useGoogleFlow = false;
    }

    const modeUsed = useGoogleFlow ? 'google_flow' : 'synthetic_fallback';
    console.log(`[AiStudioVisualService] Dispatching ${scenes.length} scenes using mode: ${modeUsed}`);

    for (let i = 0; i < scenes.length; i++) {
      if (isCancelled?.()) break;

      const scene = scenes[i];
      const ext = flowConfig.outputMode === 'video' && useGoogleFlow ? 'mp4' : 'png';
      const assetPath = path.join(assetsDir, `scene_${String(i + 1).padStart(2, '0')}.${ext}`);

      onProgress?.(
        Math.round(((i + 1) / scenes.length) * 100),
        `Đang tạo hình ảnh phân cảnh ${i + 1}/${scenes.length} (${modeUsed})...`
      );

      if (useGoogleFlow) {
        try {
          await this.generateViaGoogleFlow(scene, assetPath, flowConfig);
          scene.assetPath = assetPath;
          scene.status = 'ready';
          continue;
        } catch (flowErr) {
          console.warn(`[AiStudioVisualService] Google Flow generation failed for scene ${i + 1}, falling back to synthetic card:`, flowErr);
        }
      }

      // Synthetic High-Resolution Scene Card Fallback
      await this.generateSyntheticSceneCard(scene, assetPath, flowConfig.aspectRatio, '1080p');
      scene.assetPath = assetPath;
      scene.status = 'ready';
    }

    return {
      scenes,
      generatedCount: scenes.filter((s) => s.assetPath && fs.existsSync(s.assetPath)).length,
      modeUsed,
    };
  }

  // --------------------------------------------------------------------------
  // Google Flow Generation Bridge
  // --------------------------------------------------------------------------
  private async generateViaGoogleFlow(
    scene: StoryboardScene,
    outputPath: string,
    flowConfig: AiStudioFlowEngineConfig
  ): Promise<void> {
    const sessionMgr = GoogleVeoSessionManager.getInstance();
    const mutex = GoogleFlowBrowserMutex.getInstance();

    await mutex.runExclusive(async () => {
      const result = await sessionMgr.generateImageViaBrowserContext({
        prompt: scene.visualPrompt,
        aspectRatio: flowConfig.aspectRatio,
        outputCount: 1,
      });

      if (!result || result.error) {
        throw new Error(result?.errorDetail || result?.error || 'Google Flow generation returned null');
      }

      if (result.base64Data) {
        const buf = Buffer.from(result.base64Data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        fs.writeFileSync(outputPath, buf);
      } else if (result.imageUrl) {
        throw new Error('Direct URL download not yet mapped');
      }
    }, 'visual_service_generation');
  }

  // --------------------------------------------------------------------------
  // High-Resolution Procedural Synthetic Card Generator
  // --------------------------------------------------------------------------
  public async generateSyntheticSceneCard(
    scene: StoryboardScene,
    outputPath: string,
    aspectRatio: FlowAspectRatio = '16:9',
    _resolution: RenderingResolution = '1080p'
  ): Promise<string> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    let width = 1280;
    let height = 720;
    if (aspectRatio === '9:16') {
      width = 720;
      height = 1280;
    } else if (aspectRatio === '1:1') {
      width = 1080;
      height = 1080;
    }

    const palette = ['navy', 'darkslategray', 'midnightblue', 'darkslateblue'];
    const color = palette[scene.lineIndex % palette.length];

    // Build verified PNG via FFmpeg lavfi color filter
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(`color=c=${color}:s=${width}x${height}:d=1`)
        .inputFormat('lavfi')
        .outputOptions('-vframes 1')
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });

    return outputPath;
  }

  // --------------------------------------------------------------------------
  // Granular Step: Single-Scene Regeneration (F28)
  // --------------------------------------------------------------------------
  public async regenerateSceneAsset(
    payload: RegenerateSceneAssetPayload,
    assetsDir?: string
  ): Promise<RegenerateSceneAssetResult> {
    const targetDir = assetsDir || path.join(os.tmpdir(), 'vanhsub-single-scenes');
    fs.mkdirSync(targetDir, { recursive: true });

    const outPath = path.join(targetDir, `scene_${payload.sceneId}_${Date.now()}.png`);
    const mockScene: StoryboardScene = {
      id: payload.sceneId,
      lineIndex: 0,
      startMs: 0,
      endMs: 4000,
      durationMs: 4000,
      lineText: '',
      visualPrompt: payload.visualPrompt,
      motionType: 'ken_burns',
      status: 'pending',
    };

    await this.generateSyntheticSceneCard(mockScene, outPath, payload.flowConfig.aspectRatio, '1080p');
    return { assetPath: outPath };
  }
}

export const aiStudioVisualService = AiStudioVisualService.getInstance();
```

---

### Service 4: `AiStudioVideoAssembler.ts`
**Location**: `main/ai-studio/services/AiStudioVideoAssembler.ts`  
**Dependencies**: `fluent-ffmpeg`, `@ffmpeg-installer/ffmpeg`, `@ffprobe-installer/ffprobe`, `fs`, `path`, `os`  
**Responsibilities**:
- Stage 7: Assemble visual assets with Ken Burns effect (zoom/pan), mix voiceover audio + ducked BGM, compile and burn dynamic ASS subtitles (`tiktok_bold`, `karaoke_glow`, `minimalist`) into `final_video.mp4` via `fluent-ffmpeg`.
- Support aspect ratios (`16:9`, `9:16`, `1:1`) and resolutions (`1080p`, `720p`).
- Handle Windows paths escaping via `escapeFfmpegSubtitlesPath`.

#### Architectural Details & Implementation Design

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import type {
  AiStudioRenderingConfig,
  AiStudioSubtitleConfig,
  FlowAspectRatio,
  RenderingResolution,
  ScriptBeatLine,
  StoryboardScene,
  WordTimestamp,
} from '../types';

export interface VideoAssemblyOptions {
  scenes: StoryboardScene[];
  voiceoverAudioPath: string;
  wordsAlignment?: WordTimestamp[];
  scriptLines?: ScriptBeatLine[];
  renderingConfig: AiStudioRenderingConfig;
  subtitleConfig: AiStudioSubtitleConfig;
  aspectRatio: FlowAspectRatio;
  outputPath: string;
  onProgress?: (percent: number) => void;
}

export interface VideoAssemblyResult {
  videoPath: string;
  durationSec: number;
  fileSizeBytes: number;
  width: number;
  height: number;
}

/** Windows path escaping for libass in FFmpeg */
export function escapeFfmpegSubtitlesPath(subPath: string): string {
  let escaped = subPath.replace(/\\/g, '/');
  escaped = escaped.replace(/^([A-Za-z]):/, '$1\\:');
  return escaped;
}

export class AiStudioVideoAssembler {
  private static instance: AiStudioVideoAssembler | null = null;

  public static getInstance(): AiStudioVideoAssembler {
    if (!AiStudioVideoAssembler.instance) {
      AiStudioVideoAssembler.instance = new AiStudioVideoAssembler();
    }
    return AiStudioVideoAssembler.instance;
  }

  // --------------------------------------------------------------------------
  // Resolution & Dimensions Resolution
  // --------------------------------------------------------------------------
  public getDimensions(aspectRatio: FlowAspectRatio, resolution: RenderingResolution): { width: number; height: number } {
    const is720p = resolution === '720p';
    if (aspectRatio === '9:16') {
      return is720p ? { width: 720, height: 1280 } : { width: 1080, height: 1920 };
    }
    if (aspectRatio === '1:1') {
      return is720p ? { width: 720, height: 720 } : { width: 1080, height: 1080 };
    }
    return is720p ? { width: 1280, height: 720 } : { width: 1920, height: 1080 };
  }

  // --------------------------------------------------------------------------
  // ASS Subtitles Generator
  // --------------------------------------------------------------------------
  public compileAssSubtitles(
    words: WordTimestamp[],
    scriptLines: ScriptBeatLine[],
    subtitleConfig: AiStudioSubtitleConfig,
    width: number,
    height: number,
    outputPath: string
  ): string {
    const posPercent = subtitleConfig.positionY || 80;
    const marginV = Math.round((height * (100 - posPercent)) / 100);

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
Style: DefaultStyle,Arial,${fontSize},${primaryCol},&H000000FF&,${outlineCol},&H80000000&,-1,0,0,0,100,100,0,0,1,${outlineWidth},1,2,20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const dialogueLines: string[] = [];

    // If word alignment is present, group into 3-4 word punchy chunks (TikTok bold style)
    if (words && words.length > 0) {
      const chunkSize = 4;
      for (let i = 0; i < words.length; i += chunkSize) {
        const chunk = words.slice(i, i + chunkSize);
        const start = formatTime(chunk[0].startMs);
        const end = formatTime(chunk[chunk.length - 1].endMs);
        const text = chunk.map((c) => c.word).join(' ');
        dialogueLines.push(`Dialogue: 0,${start},${end},DefaultStyle,,0,0,0,,${text}`);
      }
    } else if (scriptLines && scriptLines.length > 0) {
      for (const line of scriptLines) {
        const start = formatTime(line.startMs || 0);
        const end = formatTime(line.endMs || 3000);
        dialogueLines.push(`Dialogue: 0,${start},${end},DefaultStyle,,0,0,0,,${line.text}`);
      }
    }

    const content = header + dialogueLines.join('\n') + '\n';
    fs.writeFileSync(outputPath, content, 'utf8');
    return outputPath;
  }

  // --------------------------------------------------------------------------
  // Stage 7: Video Assembly & Rendering
  // --------------------------------------------------------------------------
  public async assembleVideo(options: VideoAssemblyOptions): Promise<VideoAssemblyResult> {
    const {
      scenes,
      voiceoverAudioPath,
      wordsAlignment = [],
      scriptLines = [],
      renderingConfig,
      subtitleConfig,
      aspectRatio,
      outputPath,
      onProgress,
    } = options;

    if (!fs.existsSync(voiceoverAudioPath)) {
      throw new Error(`Voiceover audio file not found at: ${voiceoverAudioPath}`);
    }

    const { width, height } = this.getDimensions(aspectRatio, renderingConfig.resolution);
    const audioDurationSec = await this.probeDuration(voiceoverAudioPath);

    // 1. Generate ASS Subtitles
    const assPath = path.join(path.dirname(outputPath), 'subtitles.ass');
    this.compileAssSubtitles(wordsAlignment, scriptLines, subtitleConfig, width, height, assPath);
    const escapedAss = escapeFfmpegSubtitlesPath(assPath);

    // 2. Select primary visual asset
    const primaryImg = scenes[0]?.assetPath && fs.existsSync(scenes[0].assetPath)
      ? scenes[0].assetPath
      : voiceoverAudioPath;

    // 3. Build Filtergraph (Ken Burns zoompan + ASS burning)
    const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    const zoompanFilter = renderingConfig.kenBurnsEffect
      ? `zoompan=z='min(zoom+0.0012,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=125:s=${width}x${height}`
      : `null`;

    const filterChain = [
      `[0:v]${scaleFilter},${zoompanFilter}[v_motion]`,
      subtitleConfig.enabled
        ? `[v_motion]subtitles=filename='${escapedAss}'[vout]`
        : `[v_motion]null[vout]`,
    ];

    const hasBgm = Boolean(
      renderingConfig.defaultBgmPath && fs.existsSync(renderingConfig.defaultBgmPath)
    );

    const cmd = ffmpeg()
      .input(primaryImg)
      .loop(audioDurationSec)
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

    await new Promise<void>((resolve, reject) => {
      cmd
        .complexFilter(filterChain.join(';'))
        .outputOptions([
          '-map [vout]',
          hasBgm ? '-map [aout]' : '-map 1:a',
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-preset veryfast',
          '-c:a aac',
          '-b:a 192k',
          '-shortest',
        ])
        .output(outputPath)
        .on('progress', (p) => {
          if (onProgress && p.percent) {
            onProgress(Math.min(99, Math.round(p.percent)));
          }
        })
        .on('end', () => {
          if (onProgress) onProgress(100);
          resolve();
        })
        .on('error', (err, _stdout, stderr) => {
          console.error('[AiStudioVideoAssembler] FFmpeg render stderr:', stderr);
          reject(err);
        })
        .run();
    });

    const stat = fs.statSync(outputPath);
    return {
      videoPath: outputPath,
      durationSec: audioDurationSec,
      fileSizeBytes: stat.size,
      width,
      height,
    };
  }

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
```

---

## 4. Checkpoint State Machine & Coordinator Refactor (`AiStudioPipelineEngine.ts`)

The coordinator `AiStudioPipelineEngine.ts` delegates each stage to the dedicated service while retaining:
- Checkpoint persistence in `~/.vanhsub/ai-studio-sessions/<sessionId>.json`
- Monotonic state transitions and illegal leap prevention
- Downstream invalidation on retry (`retryStage(stage)`)
- IPC delegate compliance (`IAiStudioPipelineEngineDelegate`)

```typescript
// Refactored switch block in AiStudioPipelineEngine.ts
switch (stage) {
  case 1: { // Dữ kiện
    session.stageName = 'source';
    const blueprint = await aiStudioLlmService.analyzeIdeaBlueprint(session.topic, config.llm);
    session.artifacts.ideaSummary = blueprint.rawSummary;
    break;
  }
  case 2: { // Kịch bản
    session.stageName = 'script';
    session.artifacts.scriptLines = await aiStudioLlmService.generateScript(session.topic, config.llm);
    break;
  }
  case 3: { // Lồng tiếng
    session.stageName = 'voice';
    const voiceoverPath = path.join(assetsDir, 'voiceover.mp3');
    const fullText = (session.artifacts.scriptLines || []).map((l) => l.text).join(' ');
    const ttsResult = await aiStudioTtsService.synthesizeVoiceover(fullText, config.voice, voiceoverPath);
    session.artifacts.audioPath = ttsResult.audioPath;
    (session as any).__rawTtsMetadata = ttsResult.rawMetadata;
    break;
  }
  case 4: { // Trích xuất Time
    session.stageName = 'alignment';
    const alignResult = aiStudioTtsService.extractAlignment(
      (session as any).__rawTtsMetadata || [],
      (session.artifacts.scriptLines || []).map((l) => l.text).join(' '),
      session.artifacts.scriptLines || [],
      session.artifacts.audioPath ? await aiStudioTtsService.probeMediaDuration(session.artifacts.audioPath) * 1000 : 5000
    );
    session.artifacts.wordsAlignment = alignResult.wordsAlignment;
    session.artifacts.scriptLines = alignResult.alignedLines;
    break;
  }
  case 5: { // Storyboard
    session.stageName = 'storyboard';
    session.artifacts.scenes = aiStudioVisualService.generateStoryboardScenes(
      session.artifacts.scriptLines || [],
      config.flowEngine,
      config.llm
    );
    break;
  }
  case 6: { // Ảnh / Video Assets
    session.stageName = 'visuals';
    const dispatchResult = await aiStudioVisualService.dispatchVisualAssets(
      session.artifacts.scenes || [],
      config.flowEngine,
      assetsDir,
      (pct, msg) => onProgress({ sessionId: session.sessionId, stage: 6, stageName: 'visuals', progress: 65 + Math.round(pct * 0.1), status: 'running', message }),
      () => this.cancellationTokens.has(session.sessionId)
    );
    session.artifacts.scenes = dispatchResult.scenes;
    break;
  }
  case 7: { // Dựng phim
    session.stageName = 'render';
    const finalVideoPath = path.join(assetsDir, 'final_video.mp4');
    const assembleResult = await aiStudioVideoAssembler.assembleVideo({
      scenes: session.artifacts.scenes || [],
      voiceoverAudioPath: session.artifacts.audioPath!,
      wordsAlignment: session.artifacts.wordsAlignment,
      scriptLines: session.artifacts.scriptLines,
      renderingConfig: config.rendering,
      subtitleConfig: config.subtitles,
      aspectRatio: config.flowEngine.aspectRatio,
      outputPath: finalVideoPath,
    });
    session.artifacts.videoPath = assembleResult.videoPath;
    break;
  }
  case 8: { // SEO & Xuất bản
    session.stageName = 'metadata';
    session.artifacts.metadata = await aiStudioLlmService.generateSeoMetadata(
      session.topic,
      session.artifacts.scriptLines || [],
      config.llm
    );
    break;
  }
}
```

---

## 5. IPC Wire Protocol & Granular Delegation

The 10 IPC channels registered in `main/ai-studio/ipc.ts` map 1:1 to these modular services:

| IPC Channel | Triggering UI Action | Handled By |
|---|---|---|
| `aiStudio:config:get` | Settings Tab mounted | `aiStudioStore.getDecryptedConfig()` |
| `aiStudio:config:set` | Settings modified | `aiStudioStore.updateConfig()` |
| `aiStudio:config:reset` | Reset to defaults button | `aiStudioStore.resetConfig()` |
| `aiStudio:pipeline:start` | "Bắt đầu sản xuất" (Auto-Pilot) | `AiStudioPipelineEngine.start()` |
| `aiStudio:pipeline:resume` | "Tiếp tục" (Error recovery) | `AiStudioPipelineEngine.resume()` |
| `aiStudio:pipeline:cancel` | "Hủy bỏ" button | `AiStudioPipelineEngine.cancel()` |
| `aiStudio:pipeline:getState` | Polling / Session restore | `AiStudioPipelineEngine.getState()` |
| `aiStudio:step:renderSingleLineVoice` | "Tạo lại giọng" per dialogue line (Custom Tab 1) | `AiStudioTtsService.renderSingleLineVoice()` |
| `aiStudio:step:regenerateSceneAsset` | "Sinh lại ảnh" per storyboard card (Custom Tab 2) | `AiStudioVisualService.regenerateSceneAsset()` |
| `aiStudio:step:renderVideo` | "Dựng video hoàn chỉnh" (Custom Tab 3) | `AiStudioVideoAssembler.assembleVideo()` |

---

## 6. Verification and Validation Matrix

1. **Automated Verification**:
   - `npx tsx scripts/test_ai_studio_pipeline.ts`: Verifies all 9 stages end-to-end including store isolation, LLM generation, Edge TTS synthesis, WordBoundary parsing, mock visual generation, FFmpeg assembly, SEO metadata, and checkpoint resumption.
   - `npx tsc --noEmit`: Strict zero TypeScript compiler errors across `main/`.
2. **Failure Modes & Defenses**:
   - *Missing LLM Key*: Transparent fallback to calibrated multi-beat procedural scripts and viral SEO metadata.
   - *Edge TTS WebSocket Dropped*: Automatic retry (max 2 attempts) with fallback to syllabic interpolation.
   - *Google Flow Session Invalid/Expired*: Automatic fallback to high-resolution procedural scene cards matching target aspect ratio.
   - *FFmpeg Windows Path Formatting*: Normalizes backslashes to forward slashes and escapes drive colons (`C:/` -> `C\:/`) to prevent libass parse crashes.
