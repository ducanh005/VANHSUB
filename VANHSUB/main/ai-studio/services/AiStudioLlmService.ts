import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import crypto from 'crypto';
import type {
  AiStudioLlmConfig,
  ScriptBeatLine,
  StoryboardScene,
  AiStudioFlowEngineConfig,
  IdeaBlueprint,
  SeoMetadata,
  ScriptQualityAuditResult,
} from '../types';

/**
 * AiStudioLlmService: LLM coordination service for AI Video Studio
 *
 * Implements:
 * - Stage 1: Idea Blueprint Analysis
 * - Stage 2: Structured Dialogue Script Generation (with jsonrepair & offline fallback)
 * - Stage 5: Storyboard Scene Visual Prompts (English cinematic prompt formatting)
 * - Stage 8: Viral SEO Metadata (Title, Description, Hashtags, Thumbnail Prompt)
 * - Script Quality Audit (Audience retention evaluation 0-100)
 */
export class AiStudioLlmService {
  private static instance: AiStudioLlmService | null = null;

  public static getInstance(): AiStudioLlmService {
    if (!AiStudioLlmService.instance) {
      AiStudioLlmService.instance = new AiStudioLlmService();
    }
    return AiStudioLlmService.instance;
  }

  // ==========================================================================
  // Client Factory
  // ==========================================================================
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

  // ==========================================================================
  // Stage 1: Idea Blueprint Analysis
  // ==========================================================================
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
Preset phong cách: "${config.systemPromptPreset || 'youtube_story'}"

Trả về định dạng JSON DUY NHẤT (không giải thích, không bọc markdown):
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
        temperature: config.temperature ?? 0.6,
      });

      const rawText = response.choices[0]?.message?.content || '';
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const repaired = jsonrepair(cleaned);
      const parsed = JSON.parse(repaired);

      return {
        topic,
        targetAudience: parsed.targetAudience || 'Khán giả đại chúng yêu thích khám phá thông tin mới',
        narrativeAngle: parsed.narrativeAngle || 'Bật mí những góc nhìn bất ngờ ít người biết',
        hookConcept: parsed.hookConcept || `Bạn có tin vào điều kỳ lạ nhất về ${topic}?`,
        pacing: parsed.pacing || (config.systemPromptPreset === 'tiktok_short' ? 'fast' : 'moderate'),
        estimatedDurationSec: Number(parsed.estimatedDurationSec) || 60,
        keyBeats: Array.isArray(parsed.keyBeats) && parsed.keyBeats.length > 0
          ? parsed.keyBeats
          : ['Đặt câu hỏi gợi tò mò', 'Cung cấp dữ kiện bất ngờ', 'Phân tích cao trào', 'Kêu gọi hành động'],
        rawSummary: parsed.rawSummary || `Phân tích chủ đề "${topic}". Định hướng video hấp dẫn, giữ chân người xem.`,
      };
    } catch (err) {
      console.warn('[AiStudioLlmService] LLM blueprint analysis failed, engaging fallback:', err);
      return this.generateFallbackBlueprint(topic, config.systemPromptPreset);
    }
  }

  // ==========================================================================
  // Stage 2: Script Generation
  // ==========================================================================
  public async generateScript(
    topic: string,
    config: AiStudioLlmConfig,
    onProgress?: (msg: string) => void
  ): Promise<ScriptBeatLine[]> {
    // ------------------------------------------------------------------------
    // Zero-API-Cost Mode: ChatGPT Web Automation
    // ------------------------------------------------------------------------
    if (config.provider === 'chatgpt_web') {
      try {
        const { ChatGptWebSessionManager, parseChatGptScriptResponse } = await import(
          '../chatgpt/ChatGptWebSessionManager'
        );
        const mgr = ChatGptWebSessionManager.getInstance();
        const mode = config.chatgptWebMode || 'offscreen';
        const rawText = await mgr.generateScriptWeb(
          topic,
          config.systemPromptPreset || 'youtube_story',
          mode,
          onProgress
        );
        const parsedLines = parseChatGptScriptResponse(rawText, topic);
        if (parsedLines.length >= 3) {
          return parsedLines;
        }
        console.warn('[AiStudioLlmService] ChatGPT Web returned text but parsed fewer than 3 lines, falling back');
      } catch (err) {
        console.warn('[AiStudioLlmService] ChatGPT Web automation failed, falling back to offline generator:', err);
      }
      return this.generateFallbackScript(topic, config.systemPromptPreset);
    }

    const clientBundle = this.createClient(config);
    if (!clientBundle) {
      return this.generateFallbackScript(topic, config.systemPromptPreset);
    }

    try {
      const prompt = `Bạn là nhà biên kịch video ngắn chuyên nghiệp.
Nhiệm vụ: Viết kịch bản lồng tiếng tiếng Việt hoàn chỉnh cho chủ đề: "${topic}".
Phong cách preset: "${config.systemPromptPreset || 'youtube_story'}".

Yêu cầu nghiêm ngặt:
1. Chia kịch bản thành từng câu ngắn (4 - 8 câu), mỗi câu là 1 phân cảnh độc lập có ít nhất 15 từ.
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
        temperature: config.temperature ?? 0.6,
      });

      const rawText = response.choices[0]?.message?.content || '';
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const repaired = jsonrepair(cleaned);
      const parsed = JSON.parse(repaired);

      const rawLines = Array.isArray(parsed) ? parsed : parsed.lines;
      if (!Array.isArray(rawLines) || rawLines.length < 3) {
        throw new Error('LLM did not return an array with at least 3 script lines');
      }

      return rawLines.map((item: any, idx: number) => {
        const text = String(item.text || item.content || '').trim();
        const fallbackText = `Chào mừng bạn đến với phần ${idx + 1} của chủ đề ${topic}.`;
        const finalText = text.length >= 10 ? text : fallbackText;

        const beatType: ScriptBeatLine['beatType'] =
          item.beatType || (idx === 0 ? 'hook' : idx === rawLines.length - 1 ? 'outro' : 'body');

        return {
          id: `line-${idx + 1}-${crypto.randomBytes(3).toString('hex')}`,
          index: idx + 1,
          text: finalText,
          estimatedDurationSec: Number(item.estimatedDurationSec) > 0 ? Number(item.estimatedDurationSec) : 4.5,
          beatType,
        };
      });
    } catch (err) {
      console.warn('[AiStudioLlmService] Remote LLM script generation failed, falling back:', err);
      return this.generateFallbackScript(topic, config.systemPromptPreset);
    }
  }

  // ==========================================================================
  // Stage 5: Storyboard Scene Prompts Generation
  // ==========================================================================
  public generateStoryboardScenes(
    scriptLines: ScriptBeatLine[],
    flowConfig: AiStudioFlowEngineConfig,
    _llmConfig?: AiStudioLlmConfig
  ): StoryboardScene[] {
    const stylePrefix = flowConfig.stylePromptPrefix || 'Cinematic lighting, high resolution, detailed photorealistic, 4k';
    const negativePrompt = flowConfig.negativePrompt || 'watermark, text, blurry, distortion, lowres';

    const visualConceptDictionary: Record<string, string> = {
      hook: 'underwater abyss, giant glowing creature silhouette, dramatic ocean depth, volumetric light rays',
      intro: 'scientific deep sea submarine descending into dark trench, high-tech sonar display, floating particles',
      body: 'detailed exploration of unknown deep sea phenomenon, intricate textures, dramatic lighting',
      climax: 'colossal ancient underwater monolith, bioluminescent coral reefs, mysterious eerie glow',
      outro: 'cinematic sunset over calm open ocean waves, golden hour reflection, modern studio branding watermark free',
    };

    return scriptLines.map((line, idx) => {
      const beat = line.beatType || (idx === 0 ? 'hook' : idx === scriptLines.length - 1 ? 'outro' : 'body');
      const concept = visualConceptDictionary[beat] || 'cinematic atmospheric environment landscape';
      const visualPrompt = `${stylePrefix}, ${concept}, highly detailed, sharp focus, 8k wallpaper`;

      const durationSec = line.estimatedDurationSec || (line.durationMs ? line.durationMs / 1000 : 4.5);

      return {
        id: `scene-${idx + 1}`,
        lineIndex: idx,
        startMs: line.startMs || 0,
        endMs: line.endMs || Math.round(durationSec * 1000),
        durationMs: line.durationMs || Math.round(durationSec * 1000),
        lineText: line.text,
        visualPrompt,
        negativePrompt,
        motionType: flowConfig.outputMode === 'video' ? 'video' : 'ken_burns',
        status: 'pending',
      };
    });
  }

  // ==========================================================================
  // Stage 8: Viral SEO Metadata Generation
  // ==========================================================================
  public async generateSeoMetadata(
    topic: string,
    scriptLines: ScriptBeatLine[],
    config?: AiStudioLlmConfig
  ): Promise<SeoMetadata> {
    const clientBundle = config ? this.createClient(config) : null;
    if (!clientBundle) {
      return this.generateFallbackSeo(topic, scriptLines);
    }

    try {
      const summaryText = scriptLines.map((l) => l.text).join(' ');
      const prompt = `Bạn là chuyên gia tối ưu hóa video YouTube & TikTok (SEO Specialist).
Dựa trên kịch bản video sau về chủ đề "${topic}":
"${summaryText.slice(0, 1000)}"

Hãy tạo bộ siêu dữ liệu SEO lan truyền (viral metadata):
Trả về JSON DUY NHẤT:
{
  "title": "Tiêu đề giật tít chuẩn CTR cao (10-100 ký tự)",
  "description": "Mô tả video chi tiết hấp dẫn có kêu gọi hành động (ít nhất 50 ký tự)",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"],
  "thumbnailPrompt": "Cinematic visual prompt tiếng Anh để sinh ảnh thumbnail ấn tượng (ít nhất 20 ký tự)"
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

      const title = String(parsed.title || '').trim();
      const validTitle = title.length >= 10 && title.length <= 100
        ? title
        : `${topic} — Những Bí Ẩn Rùng Mình Chưa Ai Giải Mã Được`;

      const description = String(parsed.description || '').trim();
      const validDesc = description.length >= 50
        ? description
        : `Khám phá chi tiết về chủ đề: ${topic}. Video được sản xuất tự động hoàn chỉnh từ Kịch bản, Giọng đọc AI đến Hình ảnh bởi Vanhsub AI Video Studio. Đừng quên bấm Like và Đăng Ký kênh!`;

      let hashtags: string[] = [];
      if (Array.isArray(parsed.hashtags) && parsed.hashtags.length >= 3) {
        hashtags = parsed.hashtags.map((h: string) => {
          const clean = String(h).replace(/\s+/g, '');
          return clean.startsWith('#') ? clean : `#${clean}`;
        });
      }
      if (hashtags.length < 3) {
        hashtags = ['#vanhsub', '#bian', '#daiduong', '#khampha', '#khoahoc', '#aivideo'];
      }

      const thumbnailPrompt = String(parsed.thumbnailPrompt || '').trim();
      const validThumb = thumbnailPrompt.length >= 20
        ? thumbnailPrompt
        : `Cinematic eye-level shot of a colossal glowing eye in oceanic abyss, submarine searchlight beam, 8k YouTube thumbnail style`;

      return {
        title: validTitle,
        description: validDesc,
        hashtags,
        thumbnailPrompt: validThumb,
      };
    } catch (err) {
      console.warn('[AiStudioLlmService] Remote LLM SEO generation failed, falling back:', err);
      return this.generateFallbackSeo(topic, scriptLines);
    }
  }

  // ==========================================================================
  // Script Quality Audit (Audience Retention Score 0-100)
  // ==========================================================================
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
        retentionScore: Math.max(0, Math.min(100, Math.round(Number(parsed.retentionScore) || 82))),
        hookScore: Math.max(0, Math.min(100, Math.round(Number(parsed.hookScore) || 85))),
        pacingScore: Math.max(0, Math.min(100, Math.round(Number(parsed.pacingScore) || 80))),
        hookAnalysis: parsed.hookAnalysis || 'Mở đầu ấn tượng, kích thích sự tò mò của khán giả.',
        retentionLoopSuggestions: Array.isArray(parsed.retentionLoopSuggestions) && parsed.retentionLoopSuggestions.length > 0
          ? parsed.retentionLoopSuggestions
          : ['Duy trì nhịp đọc vừa phải (15 - 25 từ/câu)', 'Bổ sung âm thanh hiệu ứng ở điểm cao trào'],
        ctaEvaluation: parsed.ctaEvaluation || 'Kêu gọi hành động rõ ràng và tự nhiên.',
        overallFeedback: parsed.overallFeedback || 'Kịch bản có cấu trúc tốt, sẵn sàng cho công đoạn sản xuất video.',
      };
    } catch {
      return this.auditScriptHeuristically(scriptLines);
    }
  }

  // ==========================================================================
  // Procedural Fallback Generators
  // ==========================================================================
  public generateFallbackBlueprint(topic: string, preset = 'youtube_story'): IdeaBlueprint {
    return {
      topic,
      targetAudience: 'Khán giả đại chúng yêu thích video thông tin nhanh, kịch tính và giàu hình ảnh',
      narrativeAngle: 'Khám phá những bí ẩn chưa từng được giải đáp',
      hookConcept: `Bạn có tin vào những bí ẩn lớn nhất về ${topic}?`,
      pacing: preset === 'tiktok_short' ? 'fast' : 'moderate',
      estimatedDurationSec: 20,
      keyBeats: [
        'Đặt câu hỏi kích thích tò mò',
        'Cung cấp dữ kiện bất ngờ',
        'Phân tích chi tiết cao trào',
        'Kêu gọi hành động và theo dõi kênh',
      ],
      rawSummary: `Video 4 nhịp tập trung vào yếu tố giật gân và giá trị thực tế của "${topic}".`,
    };
  }

  public generateFallbackScript(topic: string, _preset = 'youtube_story'): ScriptBeatLine[] {
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

  public generateFallbackSeo(topic: string, _scriptLines: ScriptBeatLine[]): SeoMetadata {
    return {
      title: `${topic} — 5 Bí Ẩn Rùng Mình Chưa Ai Giải Mã Được`,
      description: `Khám phá chi tiết về chủ đề: ${topic}. Video được sản xuất tự động hoàn chỉnh từ Kịch bản, Giọng đọc AI đến Hình ảnh bởi Vanhsub AI Video Studio. Đừng quên bấm Like và Đăng Ký kênh!`,
      hashtags: ['#vanhsub', '#bian', '#daiduong', '#khampha', '#khoahoc', '#aivideo'],
      thumbnailPrompt: `Cinematic eye-level shot of a colossal glowing eye opening in the pitch black oceanic abyss, submarine searchlight beam revealing ancient ruins, high CTR YouTube thumbnail style, vivid contrast, 8k resolution`,
    };
  }

  public auditScriptHeuristically(scriptLines: ScriptBeatLine[]): ScriptQualityAuditResult {
    const totalLines = scriptLines.length;
    const firstLine = scriptLines[0]?.text || '';
    const lastLine = scriptLines[totalLines - 1]?.text || '';

    const hasQuestion = /[?？]/.test(firstLine);
    const hasCuriosityWords = /(bí ẩn|sự thật|kinh ngạc|chưa từng|tại sao|liệu|bạn có biết|khám phá)/i.test(firstLine);
    const hookScore = Math.min(95, 60 + (hasQuestion ? 20 : 0) + (hasCuriosityWords ? 15 : 0));

    const hasCta = /(đăng ký|theo dõi|like|share|bình luận|comment|kênh)/i.test(lastLine);
    const pacingScore = totalLines >= 4 && totalLines <= 12 ? 85 : 70;
    const retentionScore = Math.round(hookScore * 0.45 + pacingScore * 0.35 + (hasCta ? 20 : 10));

    return {
      retentionScore,
      hookScore,
      pacingScore,
      hookAnalysis: hasCuriosityWords
        ? 'Hook mở đầu rất tốt, kích thích mạnh mẽ trí tò mò của khán giả.'
        : 'Hook mở đầu ổn định; có thể bổ sung thêm câu hỏi hoặc từ khóa tạo sự bất ngờ.',
      retentionLoopSuggestions: [
        'Giữ độ dài các câu thoại đồng đều trong khoảng 15 - 25 từ để duy trì nhịp lôi cuốn',
        'Bổ sung hiệu ứng chuyển cảnh Ken Burns để tăng tính sinh động thị giác',
      ],
      ctaEvaluation: hasCta
        ? 'Kêu gọi hành động rõ ràng và tự nhiên ở cuối video.'
        : 'Nên bổ sung lời nhắc đăng ký kênh hoặc bấm like ở câu cuối.',
      overallFeedback: `Kịch bản đạt ${retentionScore}/100 điểm giữ chân khán giả, tối ưu cho video dạng ngắn và trung bình.`,
    };
  }
}

// Module-level exported helpers for direct test harness imports
export const aiStudioLlmService = AiStudioLlmService.getInstance();
export const generateScript = (
  topic: string,
  cfg: AiStudioLlmConfig,
  onProgress?: (msg: string) => void
) => aiStudioLlmService.generateScript(topic, cfg, onProgress);
export const analyzeIdeaBlueprint = (topic: string, cfg: AiStudioLlmConfig) =>
  aiStudioLlmService.analyzeIdeaBlueprint(topic, cfg);
export const generateStoryboardScenes = (
  lines: ScriptBeatLine[],
  flowCfg: AiStudioFlowEngineConfig,
  llmCfg?: AiStudioLlmConfig
) => aiStudioLlmService.generateStoryboardScenes(lines, flowCfg, llmCfg);
export const generateSeoMetadata = (
  topic: string,
  lines: ScriptBeatLine[],
  cfg?: AiStudioLlmConfig
) => aiStudioLlmService.generateSeoMetadata(topic, lines, cfg);
export const auditScriptQuality = (lines: ScriptBeatLine[], cfg?: AiStudioLlmConfig) =>
  aiStudioLlmService.auditScriptQuality(lines, cfg);
