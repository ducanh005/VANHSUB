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
  ChannelProfileConfig,
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
  // Split Existing Script to Beat Lines
  // ==========================================================================
  public splitScriptToBeatLines(rawScript: string): ScriptBeatLine[] {
    if (!rawScript || typeof rawScript !== 'string') return [];

    const rawChunks = rawScript
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const sentences: string[] = [];

    for (const chunk of rawChunks) {
      // Split on sentence boundaries (. ! ? …) when followed by whitespace and a capital/number
      const parts = chunk
        .split(/(?<=[.!?…])\s+(?=[A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ0-9"“'\[])/u)
        .map((p) => p.trim())
        .filter(Boolean);

      if (parts.length > 0) {
        sentences.push(...parts);
      } else if (chunk.length > 0) {
        sentences.push(chunk);
      }
    }

    const filtered = sentences.filter((s) => s.length >= 2);

    return filtered.map((text, idx) => {
      const cleanText = text.replace(/^[\*_"“”'`]+|[\*_"“”'`]+$/g, '').trim();
      const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
      const estimatedDurationSec = Math.max(3.0, Math.round((wordCount / 3.2) * 10) / 10);

      const beatType: ScriptBeatLine['beatType'] =
        idx === 0
          ? 'hook'
          : idx === 1
          ? 'intro'
          : idx === filtered.length - 1
          ? 'outro'
          : idx === filtered.length - 2
          ? 'climax'
          : 'body';

      return {
        id: `line-${idx + 1}-${crypto.randomBytes(3).toString('hex')}`,
        index: idx + 1,
        text: cleanText,
        estimatedDurationSec,
        beatType,
      };
    });
  }

  // ==========================================================================
  // Parse Blueprint JSON Helper
  // ==========================================================================
  public parseBlueprintJson(
    rawText: string,
    topic: string,
    aspectRatio: '16:9' | '9:16' = '16:9',
    channelProfile?: Partial<ChannelProfileConfig>
  ): IdeaBlueprint {
    // 1. Loại bỏ các ký tự template placeholder như {{CHANNEL_NAME}}
    // để tránh làm sai lệch bộ bắt dấu ngoặc nhọn hoặc lỗi cú pháp JSON
    let sanitizedText = (rawText || '')
      .replace(/\{\{\s*CHANNEL_NAME\s*\}\}/gi, channelProfile?.projectName || channelProfile?.channelNiche || 'Kênh')
      .replace(/\{\{\s*SOURCE_MATERIAL\s*\}\}/gi, topic || 'Chủ đề')
      .replace(/\{\{\s*[^}]*\s*\}\}/g, ''); // Loại bỏ các cụm {{...}} tự do khác

    // 2. Tìm khối markdown ```json ... ``` hoặc ``` ... ``` trước
    let candidate = '';
    const codeBlockMatch = sanitizedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch && codeBlockMatch[1].includes('{')) {
      candidate = codeBlockMatch[1].trim();
    }

    // 3. Nếu không có code block hoặc candidate không bắt đầu bằng '{',
    // tìm vị trí chứa từ khóa JSON đặc trưng ("title", "hookConcept", "outline")
    // và dò ngược lại dấu '{' mở khối chính xác
    if (!candidate || !candidate.startsWith('{')) {
      const keyIndex = sanitizedText.search(/"(?:title|hookConcept|narrativeAngle|outline|keyBeats)"/i);
      if (keyIndex !== -1) {
        const startBrace = sanitizedText.lastIndexOf('{', keyIndex);
        if (startBrace !== -1) {
          const sub = sanitizedText.slice(startBrace);
          const endBrace = sub.lastIndexOf('}');
          if (endBrace !== -1) {
            candidate = sub.slice(0, endBrace + 1).trim();
          }
        }
      }
    }

    // 4. Dự phòng: tìm khối ngoặc nhọn ngoài cùng
    if (!candidate) {
      const generalMatch = sanitizedText.match(/\{[\s\S]*\}/);
      if (generalMatch) {
        candidate = generalMatch[0].trim();
      }
    }

    let parsed: any = {};
    try {
      if (candidate) {
        const repaired = jsonrepair(candidate);
        parsed = JSON.parse(repaired);
      } else {
        throw new Error('Không tìm thấy khối JSON trong văn bản phản hồi');
      }
    } catch (parseErr) {
      console.warn('[AiStudioLlmService] parseBlueprintJson: jsonrepair failed, recovering via regex field extraction:', parseErr);

      const extractField = (pattern: RegExp): string => {
        const match = sanitizedText.match(pattern);
        return match ? match[1].trim() : '';
      };

      const title =
        extractField(/"title"\s*:\s*"([^"]+)"/i) ||
        extractField(/(?:^|\n)(?:Tiêu đề|Title)[:\-]\s*(.+)/i) ||
        topic;

      const hookConcept =
        extractField(/"hookConcept"\s*:\s*"([^"]+)"/i) ||
        extractField(/(?:^|\n)(?:Hook|Câu mở đầu)[:\-]\s*(.+)/i);

      const narrativeAngle =
        extractField(/"narrativeAngle"\s*:\s*"([^"]+)"/i) ||
        extractField(/(?:^|\n)(?:Góc nhìn|Angle)[:\-]\s*(.+)/i);

      const thumbnailConcept =
        extractField(/"thumbnailConcept"\s*:\s*"([^"]+)"/i) ||
        extractField(/(?:^|\n)(?:Thumbnail|Ảnh bìa)[:\-]\s*(.+)/i);

      const thumbnailPrompt =
        extractField(/"thumbnailPrompt"\s*:\s*"([^"]+)"/i) ||
        extractField(/(?:^|\n)(?:Thumbnail prompt|Prompt ảnh)[:\-]\s*(.+)/i);

      const outlineMatches = sanitizedText
        .split('\n')
        .map((l) => l.trim())
        .filter(
          (l) =>
            /^\[?\d+[\.:\-\]]/i.test(l) ||
            /^Phân đoạn\s*\d+/i.test(l) ||
            /^Beat\s*\d+/i.test(l) ||
            /^[•\-\*]\s+/i.test(l)
        );

      parsed = {
        title: title || topic,
        hookConcept: hookConcept || `Bạn có tin vào sự thật đằng sau ${topic}?`,
        narrativeAngle: narrativeAngle || 'Góc tiếp cận độc đáo, đột phá của kênh',
        outline: outlineMatches.length >= 2 ? outlineMatches : undefined,
        thumbnailConcept,
        thumbnailPrompt,
      };
    }

    const outlineArray: string[] = Array.isArray(parsed.outline)
      ? parsed.outline
      : Array.isArray(parsed.keyBeats)
      ? parsed.keyBeats
      : [
          'Phân đoạn 1 [00:00 - 00:45]: Mở đầu sự cố / bối cảnh bất ngờ...',
          'Phân đoạn 2 [00:45 - 01:30]: Diễn biến kịch tính / xung đột cao trào...',
          'Phân đoạn 3 [01:30 - 02:15]: Bước ngoặt / giải mã sự thật...',
          'Phân đoạn 4 [02:15 - 03:00]: Bài học & Lối thoát...',
        ];

    // Tính toán thời lượng mục tiêu từ Cấu hình kênh
    let targetDurationSec = aspectRatio === '9:16' ? 45 : 240;
    if (channelProfile) {
      if (aspectRatio === '9:16') {
        if (channelProfile.targetShortDuration === '30_60_sec') targetDurationSec = 45;
        else if (channelProfile.targetShortDuration === '60_90_sec') targetDurationSec = 75;
        else if (channelProfile.targetShortDuration === '90_120_sec') targetDurationSec = 105;
        else if (channelProfile.targetShortDuration === '120_180_sec') targetDurationSec = 150;
      } else {
        if (channelProfile.targetLongDuration === '1_3_min') targetDurationSec = 120;
        else if (channelProfile.targetLongDuration === '3_5_min') targetDurationSec = 240;
        else if (channelProfile.targetLongDuration === '5_8_min') targetDurationSec = 390;
        else if (channelProfile.targetLongDuration === '8_12_min') targetDurationSec = 600;
        else if (channelProfile.targetLongDuration === '12_18_min') targetDurationSec = 900;
        else if (channelProfile.targetLongDuration === '18_28_min') targetDurationSec = 1400;
      }
    }

    const estimatedDurationSec =
      Number(parsed.estimatedDurationSec) > 0
        ? Number(parsed.estimatedDurationSec)
        : targetDurationSec;

    // Thiết lập thumbnailPrompt dự phòng chuẩn theo Nhân vật và Model của Kênh
    const hostName =
      channelProfile?.hostName?.trim() ||
      channelProfile?.channelCharacters?.[0]?.name?.trim();
    const hostDesc =
      channelProfile?.hostDescription?.trim() ||
      channelProfile?.channelCharacters?.[0]?.descriptionEn?.trim();
    const imageModel = channelProfile?.imageModel?.trim() || 'Nano Banana 2';

    let defaultThumbnailPrompt = `Cinematic high resolution photography for video thumbnail of ${parsed.title || topic}, dramatic lighting, 8k, photorealistic, optimized for ${imageModel}`;
    if (hostName && hostDesc) {
      defaultThumbnailPrompt = `Cinematic high resolution photography featuring character ${hostName} (${hostDesc}), dramatic lighting, 8k, photorealistic, optimized for ${imageModel}`;
    }

    return {
      topic,
      title: parsed.title || topic,
      aspectRatio,
      targetAudience: parsed.targetAudience || 'Khán giả đại chúng yêu thích video thông tin nhanh',
      narrativeAngle: parsed.narrativeAngle || 'Góc tiếp cận độc đáo, đột phá của kênh',
      hookConcept: parsed.hookConcept || `Bạn có tin vào sự thật đằng sau ${topic}?`,
      pacing: parsed.pacing || (aspectRatio === '9:16' ? 'fast' : 'moderate'),
      estimatedDurationSec,
      keyBeats: outlineArray,
      outline: outlineArray,
      thumbnailConcept: parsed.thumbnailConcept || `Ý tưởng thumbnail ấn tượng về ${topic}`,
      thumbnailPrompt: parsed.thumbnailPrompt || defaultThumbnailPrompt,
      rawSummary:
        parsed.rawSummary ||
        `Chiến lược sản xuất video "${parsed.title || topic}" với tỷ lệ ${aspectRatio}, thời lượng dự kiến ${Math.round((estimatedDurationSec / 60) * 10) / 10} phút.`,
    };
  }

  // ==========================================================================
  // Stage 1: Idea Blueprint Analysis
  // ==========================================================================
  public async analyzeIdeaBlueprint(
    topic: string,
    config: AiStudioLlmConfig,
    aspectRatio: '16:9' | '9:16' = '16:9',
    onProgress?: (msg: string) => void,
    channelProfile?: Partial<ChannelProfileConfig>
  ): Promise<IdeaBlueprint> {
    const projectName = channelProfile?.projectName?.trim() || '';
    const channelNiche = channelProfile?.channelNiche?.trim() || '';
    const channelOrientation = channelProfile?.channelOrientation?.trim() || '';
    const channelHook = channelProfile?.channelHook?.trim() || '';
    const masterPrompt = channelProfile?.masterPrompt?.trim() || '';
    const imageModel = channelProfile?.imageModel?.trim() || 'Nano Banana 2';
    const videoModel = channelProfile?.videoModel?.trim() || 'Omni 1.1 Flash';

    const hostName =
      channelProfile?.hostName?.trim() ||
      channelProfile?.channelCharacters?.[0]?.name?.trim() ||
      '';
    const hostDescription =
      channelProfile?.hostDescription?.trim() ||
      channelProfile?.channelCharacters?.[0]?.descriptionEn?.trim() ||
      '';
    const characterRole = channelProfile?.characterRole?.trim() || 'Nhân vật dẫn dắt / tâm điểm';

    // Tính toán mục tiêu thời lượng và số lượng phân đoạn dàn ý
    let durationLabel = '3 - 5 phút';
    let targetSec = 240;
    let minBeats = 6;
    let maxBeats = 8;

    if (aspectRatio === '9:16') {
      const shortDur = channelProfile?.targetShortDuration || '30_60_sec';
      if (shortDur === '30_60_sec') {
        durationLabel = '30 - 60 giây (~45 giây)';
        targetSec = 45;
        minBeats = 4;
        maxBeats = 6;
      } else if (shortDur === '60_90_sec') {
        durationLabel = '60 - 90 giây (~75 giây)';
        targetSec = 75;
        minBeats = 6;
        maxBeats = 8;
      } else if (shortDur === '90_120_sec') {
        durationLabel = '90 - 120 giây (~105 giây)';
        targetSec = 105;
        minBeats = 8;
        maxBeats = 10;
      } else if (shortDur === '120_180_sec') {
        durationLabel = '2 - 3 phút (~150 giây)';
        targetSec = 150;
        minBeats = 10;
        maxBeats = 12;
      }
    } else {
      const longDur = channelProfile?.targetLongDuration || '3_5_min';
      if (longDur === '1_3_min') {
        durationLabel = '1 - 3 phút (~250 - 500 từ)';
        targetSec = 120;
        minBeats = 4;
        maxBeats = 6;
      } else if (longDur === '3_5_min') {
        durationLabel = '3 - 5 phút (~600 - 900 từ)';
        targetSec = 240;
        minBeats = 6;
        maxBeats = 8;
      } else if (longDur === '5_8_min') {
        durationLabel = '5 - 8 phút (~1000 - 1500 từ)';
        targetSec = 390;
        minBeats = 8;
        maxBeats = 10;
      } else if (longDur === '8_12_min') {
        durationLabel = '8 - 12 phút (~1500 - 2200 từ)';
        targetSec = 600;
        minBeats = 10;
        maxBeats = 14;
      } else if (longDur === '12_18_min') {
        durationLabel = '12 - 18 phút (~2200 - 3200 từ)';
        targetSec = 900;
        minBeats = 14;
        maxBeats = 18;
      } else if (longDur === '18_28_min') {
        durationLabel = '18 - 28 phút (~3200 - 5000 từ)';
        targetSec = 1400;
        minBeats = 18;
        maxBeats = 24;
      }
    }

    const channelContextParts: string[] = [];

    if (projectName || channelNiche) {
      channelContextParts.push(
        `=== 1. ĐỊNH DANH DỰ ÁN & KÊNH ===\n- Tên Dự Án/Kênh: "${projectName || 'Chưa đặt tên'}"\n- Ngách nội dung (Niche): "${channelNiche || 'Nội dung đại chúng'}"\n- Định hướng phong cách: "${channelOrientation || 'Kịch tính, sâu sắc, cuốn hút'}"`
      );
    }

    channelContextParts.push(
      `=== 2. THỜI LƯỢNG MỤC TIÊU & QUY CHUẨN DÀN Ý ===\n- Định dạng: ${aspectRatio === '9:16' ? 'Video Ngắn dọc (9:16 Shorts/TikTok/Reels)' : 'Video Dài ngang (16:9 YouTube)'}\n- Thời lượng mục tiêu: ${durationLabel} (ước tính ~${targetSec} giây)\n- Yêu cầu số lượng phân đoạn trong dàn ý: BẮT BUỘC có ĐỦ từ ${minBeats} đến ${maxBeats} phân đoạn cụ thể để bao quát toàn bộ thời lượng yêu cầu.`
    );

    if (channelHook) {
      channelContextParts.push(
        `- Hook thương hiệu của kênh: "${channelHook}" (hãy lồng ghép hoặc sáng tạo dựa trên hook này).`
      );
    }

    if (masterPrompt && masterPrompt.trim().length >= 40) {
      const sanitizedMasterPrompt = masterPrompt
        .replace(/\{\{\s*CHANNEL_NAME\s*\}\}/gi, projectName || channelNiche || 'Kênh Vanhsub Studio')
        .replace(/\{\{\s*SOURCE_MATERIAL\s*\}\}/gi, topic || 'Chủ đề video')
        .replace(/\{\{\s*[^}]*\s*\}\}/g, '');
      channelContextParts.push(
        `=== 3. MASTER PROMPT & NGUYÊN TẮC KÊNH ===\nKịch bản và dàn ý phải tuyệt đối tuân thủ tinh thần và phong cách chỉ đạo từ Master Prompt của kênh:\n"""\n${sanitizedMasterPrompt.slice(0, 1200)}\n"""`
      );
    }

    channelContextParts.push(
      `=== 4. MODEL HÌNH ẢNH & VIDEO ===\n- Model hình ảnh: "${imageModel}"\n- Model video: "${videoModel}"\n- Prompt tạo ảnh bìa (thumbnailPrompt) PHẢI được viết bằng tiếng Anh chi tiết, tối ưu hóa các từ khóa ánh sáng cinematic, framing, camera angle, 8k photorealistic phù hợp với model [${imageModel}].`
    );

    if (hostName || hostDescription) {
      channelContextParts.push(
        `=== 5. KHÓA NHÂN VẬT ĐẠI DIỆN (CHARACTER CONSISTENCY) ===\n- Tên nhân vật: ${hostName || 'Nhân vật chính'}\n- Mô tả ngoại hình & phong cách: "${hostDescription}"\n- Vai trò: "${characterRole}"\n=> BẮT BUỘC: Cả "thumbnailConcept" (tiếng Việt) và "thumbnailPrompt" (tiếng Anh) PHẢI đặt nhân vật ${hostName} làm tâm điểm thị giác với đúng đặc điểm diện mạo, trang phục và phong cách vẽ/chụp đã thiết lập để đảm bảo tính nhất quán (Character Consistency)!`
      );
    }

    const channelContextText = channelContextParts.join('\n\n');

    const prompt = `Bạn là Giám đốc Sáng tạo & Biên kịch trưởng cho kênh YouTube/TikTok triệu view.
Nhiệm vụ: Dựa trên chủ đề/ý tưởng đầu vào: "${topic || channelNiche || projectName || 'Ý tưởng mới'}" và toàn bộ CẤU HÌNH KÊNH dưới đây, hãy lập kế hoạch chi tiết và sinh mẫu ý tưởng sản xuất video hoàn chỉnh.

${channelContextText}

Preset phong cách: "${config.systemPromptPreset || 'youtube_story'}".

QUY TẮC BẮT BUỘC:
1. TIÊU ĐỀ (title): Phải liên quan trực tiếp đến Tên Dự Án "${projectName || channelNiche}", lôi cuốn, giật gân, chuẩn SEO click-through-rate cao.
2. DÀN Ý (outline): BẮT BUỘC trả về mảng có ĐÚNG từ ${minBeats} đến ${maxBeats} phân đoạn (mỗi phần tử là một phân đoạn có mốc thời gian rõ ràng, ví dụ "[00:00 - 00:45] Phân đoạn 1: Mở đầu...").
3. HÌNH ẢNH THUMBNAIL (thumbnailConcept & thumbnailPrompt): ${
  hostName || hostDescription
    ? `BẮT BUỘC xuất hiện nhân vật ${hostName || 'đại diện'} (${hostDescription}) với phong cách hình ảnh chuẩn model ${imageModel}.`
    : `Bắt mắt, ánh sáng cinematic, tối ưu cho model ${imageModel}.`
}

Yêu cầu nghiêm ngặt: Trả về DUY NHẤT một khối JSON hợp lệ theo đúng cấu trúc sau (không kèm lời chào, không markdown thừa):
{
  "title": "Tiêu đề video cuốn hút, gắn với dự án và chủ đề",
  "hookConcept": "Câu mở đầu 3 giây gây tò mò, giật gân, giữ chân khán giả",
  "narrativeAngle": "Góc nhìn/tiếp cận độc đáo của kênh",
  "outline": [
    "Phân đoạn 1 [00:00 - 00:45]: Mở đầu sự cố / bối cảnh bất ngờ...",
    "Phân đoạn 2 [00:45 - 01:30]: Diễn biến kịch tính / xung đột cao trào..."
  ],
  "estimatedDurationSec": ${targetSec},
  "thumbnailConcept": "Mô tả ý tưởng hình ảnh bìa thumbnail cực kỳ bắt mắt${hostName ? ` có sự xuất hiện của ${hostName}` : ''}",
  "thumbnailPrompt": "Detailed English image prompt for thumbnail generation, cinematic lighting, 8k, photorealistic${hostName && hostDescription ? `, featuring ${hostName}: ${hostDescription}` : ''}, optimized for ${imageModel}"
}`;

    // 1. ChatGPT Web Automation
    if (config.provider === 'chatgpt_web') {
      try {
        const { ChatGptWebSessionManager } = await import('../chatgpt/ChatGptWebSessionManager');
        const mgr = ChatGptWebSessionManager.getInstance();
        const mode = config.chatgptWebMode || 'offscreen';
        onProgress?.('Đang gửi yêu cầu sinh ý tưởng tới ChatGPT Web...');
        const rawText = await mgr.executePromptTurn(prompt, mode, onProgress);
        return this.parseBlueprintJson(rawText, topic, aspectRatio, channelProfile);
      } catch (err: any) {
        console.error('[AiStudioLlmService] ChatGPT Web blueprint error:', err);
        throw new Error(`Lỗi sinh ý tưởng qua ChatGPT Web: ${err?.message || err}`);
      }
    }

    // 2. Gemini Web Automation
    if (config.provider === 'gemini_web') {
      try {
        const { GeminiWebSessionManager } = await import('../gemini/GeminiWebSessionManager');
        const mgr = GeminiWebSessionManager.getInstance();
        const mode = config.geminiWebMode || 'offscreen';
        onProgress?.('Đang gửi yêu cầu sinh ý tưởng tới Gemini Web...');
        const rawText = await mgr.executePromptTurn(prompt, mode, onProgress);
        return this.parseBlueprintJson(rawText, topic, aspectRatio, channelProfile);
      } catch (err: any) {
        console.error('[AiStudioLlmService] Gemini Web blueprint error:', err);
        throw new Error(`Lỗi sinh ý tưởng qua Gemini Web: ${err?.message || err}`);
      }
    }

    // 3. API Client (OpenAI, DeepSeek, Custom)
    const clientBundle = this.createClient(config);
    if (!clientBundle) {
      throw new Error(`Chưa cấu hình API Key cho nhà cung cấp LLM "${config.provider}". Vui lòng kiểm tra lại tab Cài Đặt hoặc chọn Chế độ Tiết kiệm.`);
    }

    try {
      const response = await clientBundle.client.chat.completions.create({
        model: clientBundle.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: config.temperature ?? 0.6,
      });

      const rawText = response.choices[0]?.message?.content || '';
      return this.parseBlueprintJson(rawText, topic, aspectRatio, channelProfile);
    } catch (err: any) {
      console.error(`[AiStudioLlmService] Remote LLM error (${config.provider}):`, err);
      throw new Error(`Lỗi kết nối API ${config.provider}: ${err?.message || err}`);
    }
  }

  // ==========================================================================
  // Stage 2: Script Generation
  // ==========================================================================
  public async generateScript(
    topic: string,
    config: AiStudioLlmConfig,
    onProgress?: (msg: string) => void,
    blueprint?: IdeaBlueprint,
    channelProfile?: ChannelProfileConfig
  ): Promise<ScriptBeatLine[]> {
    // 0. Nếu người dùng đã cung cấp sẵn kịch bản (Existing Script), tự động tách câu
    if (blueprint?.existingScript && blueprint.existingScript.trim().length >= 10) {
      onProgress?.('Đang phân tách kịch bản có sẵn thành các câu độc lập...');
      const beatLines = this.splitScriptToBeatLines(blueprint.existingScript);
      if (beatLines.length > 0) {
        return beatLines;
      }
    }

    // 1. Zero-API-Cost Mode: ChatGPT Web Automation
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
          return this.applyChannelHook(parsedLines, channelProfile);
        }
        throw new Error('ChatGPT Web không trả về đủ số câu kịch bản hợp lệ.');
      } catch (err: any) {
        console.error('[AiStudioLlmService] ChatGPT Web script generation error:', err);
        throw new Error(`Lỗi tạo kịch bản qua ChatGPT Web: ${err?.message || err}`);
      }
    }

    // 2. Zero-API-Cost Mode: Gemini Web Automation
    if (config.provider === 'gemini_web') {
      try {
        const { GeminiWebSessionManager } = await import('../gemini/GeminiWebSessionManager');
        const { parseChatGptScriptResponse } = await import('../chatgpt/ChatGptWebSessionManager');
        const mgr = GeminiWebSessionManager.getInstance();
        const mode = config.geminiWebMode || 'offscreen';
        const rawText = await mgr.generateScriptWeb(
          topic,
          config.systemPromptPreset || 'youtube_story',
          mode,
          onProgress
        );
        const parsedLines = parseChatGptScriptResponse(rawText, topic);
        if (parsedLines.length >= 3) {
          return this.applyChannelHook(parsedLines, channelProfile);
        }
        throw new Error('Gemini Web không trả về đủ số câu kịch bản hợp lệ.');
      } catch (err: any) {
        console.error('[AiStudioLlmService] Gemini Web script generation error:', err);
        throw new Error(`Lỗi tạo kịch bản qua Gemini Web: ${err?.message || err}`);
      }
    }

    // 3. API Client (OpenAI, DeepSeek, Custom)
    const clientBundle = this.createClient(config);
    if (!clientBundle) {
      throw new Error(`Chưa cấu hình API Key cho nhà cung cấp LLM "${config.provider}". Vui lòng kiểm tra lại cấu hình.`);
    }

    try {
      const masterPrompt = (channelProfile?.masterPrompt || '').trim();
      const prompt = (masterPrompt && masterPrompt.length >= 40)
        ? masterPrompt
            .replace(/\{\{CHANNEL_NAME\}\}/g, channelProfile?.channelNiche || 'Kênh Vanhsub AI Studio')
            .replace(/\{\{SOURCE_MATERIAL\}\}/g, topic)
        : `Bạn là nhà biên kịch video ngắn chuyên nghiệp.
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
      let lines: ScriptBeatLine[] = [];

      try {
        const cleaned = rawText.replace(/```json|```/g, '').trim();
        const repaired = jsonrepair(cleaned);
        const parsed = JSON.parse(repaired);
        const rawLines = Array.isArray(parsed) ? parsed : parsed.lines;
        if (Array.isArray(rawLines) && rawLines.length >= 3) {
          lines = rawLines.map((item: any, idx: number) => {
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
        }
      } catch {
        // Không phải JSON: Xử lý định dạng văn bản Strict Output (SCRIPT: ... --- END OF SCRIPT ---)
        let scriptBody = rawText;
        const scriptMatch = rawText.match(/SCRIPT:\s*([\s\S]*?)(?:---\s*END OF SCRIPT\s*---|NARRATION DIRECTION:|$)/i);
        if (scriptMatch && scriptMatch[1].trim().length >= 20) {
          scriptBody = scriptMatch[1].trim();
        }
        lines = this.splitScriptToBeatLines(scriptBody);
      }

      if (!lines || lines.length < 3) {
        lines = this.splitScriptToBeatLines(rawText);
      }

      if (!lines || lines.length < 3) {
        throw new Error('LLM không trả về danh sách phân cảnh hoặc kịch bản hợp lệ.');
      }

      return this.applyChannelHook(lines, channelProfile);
    } catch (err: any) {
      console.error('[AiStudioLlmService] Script generation API error:', err);
      throw new Error(`Lỗi gọi API sinh kịch bản (${config.provider}): ${err?.message || err}`);
    }
  }

  /**
   * Helper: Tự động lồng câu chốt thương hiệu (Brand Hook) của kênh vào kịch bản sau câu Hook đầu
   */
  private applyChannelHook(
    lines: ScriptBeatLine[],
    channelProfile?: ChannelProfileConfig
  ): ScriptBeatLine[] {
    if (!channelProfile?.channelHook || !channelProfile.channelHook.trim()) {
      return lines;
    }
    const hookText = channelProfile.channelHook.trim();
    const alreadyHasHook = lines.some((l) => l.text.includes(hookText));
    if (alreadyHasHook || lines.length < 2) {
      return lines;
    }

    const words = hookText.split(/\s+/).filter(Boolean).length;
    const duration = Math.max(2.0, Math.round((words / 3.0) * 10) / 10);
    const result = [...lines];
    result.splice(1, 0, {
      id: `line-hook-${crypto.randomBytes(3).toString('hex')}`,
      index: 2,
      text: hookText,
      estimatedDurationSec: duration,
      beatType: 'intro',
    });
    result.forEach((l, idx) => {
      l.index = idx + 1;
    });
    return result;
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

  // ==========================================================================
  // Channel Master Prompt Generation
  // ==========================================================================
  public async generateMasterPromptForChannel(
    channelProfile: Partial<ChannelProfileConfig>,
    config?: AiStudioLlmConfig,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    const projectName = (channelProfile.projectName || channelProfile.channelNiche || 'kênh test').trim();
    const niche = channelProfile.channelNiche || projectName || 'Nội dung khám phá & kiến thức chuyên sâu';
    const desc = channelProfile.channelDescription || 'Kênh chia sẻ những câu chuyện và góc nhìn độc đáo, hấp dẫn.';
    const orient = channelProfile.channelOrientation || 'Kịch tính, lôi cuốn, tạo sự đồng cảm và kích thích trí tò mò.';
    const hook = channelProfile.channelHook || 'Hãy cùng chúng tôi khám phá ngay bây giờ.';
    const durationLong = channelProfile.targetLongDuration || '3_5_min';
    const targetMinutes = durationLong.replace('_', '–').replace('min', 'phút');

    const aiModelName = config?.model || (
      config?.provider === 'chatgpt_web' ? 'ChatGPT Web (Zero-API Cost)' :
      config?.provider === 'gemini_web' ? 'Gemini Web (Zero-API Cost)' :
      config?.provider || 'AI Studio LLM'
    );

    // 10-Section Fallback Template complying 100% with the user's Master Prompt Standard
    const promptTemplate = `1. SYSTEM ROLE
Bạn là nhà biên kịch lồng tiếng cao cấp chạy trên mô hình AI "${aiModelName}" cho project / kênh YouTube "${projectName}".
Khán giả của kênh là những người yêu thích tìm hiểu sâu, khao khát những góc nhìn chân thực, sắc sảo và kịch tính.
Lời hứa của kênh với người xem: mỗi câu chuyện đều được bóc tách đến tận cùng sự thật, cuốn hút từng giây và không bao giờ lãng phí thời gian của bạn.

2. INPUT

CHANNEL NAME:

{{CHANNEL_NAME}}

=== SOURCE START ===

{{SOURCE_MATERIAL}}

=== SOURCE END ===

Everything inside the markers is the universe of established fact. You may add general, verifiable context about how a system or process works, because that context is the transformation. You may never add facts about these specific people or events.

3. PRIMARY OBJECTIVE
- Độ dài mục tiêu: ${targetMinutes} (khoảng 600–1.200 từ lồng tiếng).
- Phải giống: một bộ phim tài liệu điều tra điện ảnh thu nhỏ, kể chuyện với nhịp điệu dồn dập, sắc bén và giàu sức gợi cảm giác thực tế.
- Tuyệt đối KHÔNG giống: một bài báo đọc to đều đều; một bài tóm tắt sách khô khan; một câu chuyện phiếm mạng xã hội nhạt nhòa; một bài giảng đạo đức.

4. CHANNEL DNA
- Ngách trọng tâm: ${niche}.
- Bản sắc kênh: ${desc}
- Định hướng góc nhìn: ${orient}
- Tôn chỉ văn phong: Trực diện, không vòng vo, cụ thể thắng trừu tượng, mỗi câu nói đều mang sức nặng thông tin.

4B. BRAND IDENTITY
- BRAND COMPASS: Kênh ${projectName} luôn đi thẳng vào bản chất vấn đề trước khi người khác kịp thanh minh.
- KHÔNG nhắc tên kênh trong 40 giây đầu của video.
- Giới thiệu thương hiệu trong khoảng 0:40–1:30 (8–12 giây). Câu mẫu:
  + "Chào mừng quý vị quay trở lại với {{CHANNEL_NAME}}, nơi chúng tôi cùng bạn bóc tách những bí ẩn chấn động nhất của câu chuyện hôm nay."
  + "Bạn đang theo dõi {{CHANNEL_NAME}}, và những gì sắp diễn ra sẽ làm thay đổi hoàn toàn cách bạn nhìn nhận sự việc này."
- Ký tên thương hiệu ở 30 giây cuối:
  + "Cảm ơn bạn đã đồng hành cùng {{CHANNEL_NAME}}. Câu trả lời cuối cùng nằm ở góc nhìn của bạn."
  + "{{CHANNEL_NAME}} xin chào và hẹn gặp lại trong hồ sơ tiếp theo."
- Tối đa hai lần nhắc tên trong cả tập. Cấm nhắc tên trong đoạn cao trào hoặc đoạn chứng cứ.

5. SIGNATURE BEAT
- Khoảng phút 2:30 hoặc trước bước ngoặt lớn: "Đoạn đóng băng sự việc" — người dẫn dừng nhịp 1.5 giây, đặt một câu hỏi cốt tử về động cơ của nhân vật trước khi lật mở bằng chứng quyết định.

6. NGUỒN & SỰ THẬT
- Nhóm A (Trong nguồn): Sự kiện, tên người, mốc thời gian, số liệu có trong nguồn là bất khả xâm phạm.
- Nhóm B (Bối cảnh chung): Được phép bổ sung kiến thức lịch sử, địa lý, cơ chế hoạt động để làm rõ câu chuyện.
- Nhóm C (Suy diễn - CẤM): Cấm bịa đặt lời thoại trực tiếp, cấm gán ghép động cơ cá nhân khi nguồn không khẳng định.

7. CẤU TRÚC TẬP
- 00:00 - 00:40: Hook búa bổ mở đầu bằng danh từ riêng hoặc con số chấn động. Đặt ngay mâu thuẫn lớn nhất.
- 00:40 - 01:30: Lời hứa tập này, giới thiệu kênh ngắn gọn và bắt đầu dòng thời gian.
- 01:30 - Cao trào: Diễn biến leo thang, các nỗ lực bất thành và sự đổ vỡ.
- Cao trào: Điểm bùng nổ, câu văn ngắn nhất, cảm xúc dồn nén.
- Kết thúc: Đúc kết sắc sảo, câu hỏi mở cho khán giả và chữ ký kênh.

8. NARRATION & DELIVERY
- Spell every number as spoken: "two hundred and eleven thousand dollars", "nine days", "nineteen eighty-three". Never emit raw digits.
- No symbols at all: no dollar sign, percent sign, ampersand, slash, or arrow.
- The SCRIPT section contains narration and nothing else: no headings, no timestamps, no stage directions, no speaker labels, no bracketed cues.
- Mở bằng danh từ riêng hoặc con số cụ thể. Cấm mở bằng câu hỏi tu từ hay "trong video này".
- Cấm nói trước cấu trúc. Đi thẳng vào sự việc.
- Tối đa 2 câu giải thích liên tiếp; câu thứ ba phải là cảnh, người, con số hoặc hành động.
- Xen kẽ câu dài với các câu cực ngắn (3–5 từ) để tạo nhịp thở hồi hộp.
- Cao trào cảm xúc phải là câu văn đơn giản nhất, không dùng từ ngữ sáo rỗng.

9. STRICT OUTPUT FORMAT

IF REJECTED:

STATUS: REJECTED
REASON: [one concise line]

IF ACCEPTED:

TITLE: [final title]

SCRIPT:

[complete narration script, plain text, no headings, no timestamps, no stage directions]

--- END OF SCRIPT ---

NARRATION DIRECTION:
[3 to 6 lines: register, target words per minute, the two places to slow down, phonetic notes for any name or place]

Output NOTHING else. No analysis, no planning, no alternative titles, no word counts, no visual or music instructions, no commentary.`;

    // Nếu người dùng có LLM provider sẵn sàng, chạy prompt meta chuyên gia để sinh prompt tối ưu
    if (config && (config.apiKey || config.provider === 'chatgpt_web' || config.provider === 'gemini_web')) {
      try {
        onProgress?.('Đang kết nối AI Provider để tạo Production Master Prompt...');
        const userPrompt = `Bạn là chuyên gia viết PRODUCTION MASTER PROMPT cho kênh YouTube kể chuyện dài.

Nhiệm vụ: từ mô tả kênh dưới đây, viết ra MỘT master prompt hoàn chỉnh — loại prompt mà người ta dán
vào AI cùng với một nguồn (bài báo, hồ sơ, chủ đề) và nhận về kịch bản lồng tiếng hoàn chỉnh.

Bạn KHÔNG viết kịch bản. Bạn viết cái prompt sinh ra kịch bản đó.

==================================================
PHẦN A — KHUÔN BẮT BUỘC
==================================================

Master prompt bạn viết phải có đủ 10 mục, đúng thứ tự này:

1. SYSTEM ROLE — model đóng vai ai, viết cho kênh nào (GỌI ĐÚNG TÊN KÊNH), khán giả nào, hứa hẹn gì
   với người xem.
2. INPUT — vùng nhận nguồn, bọc bằng marker (xem PHẦN B).
3. PRIMARY OBJECTIVE — độ dài mục tiêu theo phút và theo số từ; phải giống cái gì, và phải KHÔNG
   giống cái gì (nêu 3-5 thứ cụ thể như "một bài báo đọc to", "truyện Reddit đổi tên").
4. CHANNEL DNA — 3-4 dòng ngắn định nghĩa kênh này khác kênh cùng ngách ở chỗ nào.
4B. BRAND IDENTITY — nhận diện thương hiệu, xem PHẦN B4.
5. SIGNATURE BEAT — MỘT đoạn đặc trưng mà người xem quen chờ đợi ở mỗi tập. Đây là tài sản nhận diện
   mạnh nhất của kênh; mô tả rõ nó nằm ở đâu trong tập và làm gì.
6. NGUỒN & SỰ THẬT — phân loại dữ kiện (A = có trong nguồn, B = bối cảnh chung có thể kiểm chứng,
   C = suy diễn, cấm). Nêu rõ được thêm gì và tuyệt đối không được thêm gì.
7. CẤU TRÚC TẬP — chia theo mốc thời gian hoặc theo beat, nói rõ mỗi phần làm gì.
8. NARRATION & DELIVERY — viết cho TAI, không cho mắt (xem PHẦN B).
9. STRICT OUTPUT FORMAT — chép nguyên văn từ PHẦN B, không sửa một ký tự.

==================================================
PHẦN B — VÙNG CẤM SỬA
==================================================

Ba khối dưới đây là hợp đồng kỹ thuật với phần mềm chạy master prompt này. Chép NGUYÊN VĂN vào master
prompt bạn viết. Không diễn đạt lại, không rút gọn, không dịch, không gộp vào mục khác.

--- B1. VÙNG NHẬN NGUỒN (đặt ở mục 2 INPUT) ---

CHANNEL NAME:

{{CHANNEL_NAME}}

=== SOURCE START ===

{{SOURCE_MATERIAL}}

=== SOURCE END ===

Everything inside the markers is the universe of established fact. You may add general, verifiable
context about how a system or process works, because that context is the transformation. You may never
add facts about these specific people or events.

--- B2. LUẬT ĐỌC THÀNH TIẾNG (đặt trong mục 8 NARRATION) ---

- Spell every number as spoken: "two hundred and eleven thousand dollars", "nine days", "nineteen
  eighty-three". Never emit raw digits.
- No symbols at all: no dollar sign, percent sign, ampersand, slash, or arrow.
- The SCRIPT section contains narration and nothing else: no headings, no timestamps, no stage
  directions, no speaker labels, no bracketed cues.

--- B4. NHẬN DIỆN THƯƠNG HIỆU (mục 4B) ---

Viết mục 4B theo đúng bộ luật này, thay [[CHANNEL_NAME]] bằng tên kênh thật ở phần mô tả, nhưng giữ
{{CHANNEL_NAME}} ở mọi CÂU MẪU mà người dẫn sẽ đọc trên sóng:

- BRAND COMPASS: một câu nội bộ tóm gọn kênh này đứng ở đâu. Không bao giờ đọc nguyên văn trên sóng.
  Người xem phải nhận ra kênh qua CÁCH LÀM trước, qua cái tên sau.
- KHÔNG nhắc tên kênh trong 40 giây đầu. Đó là đoạn tụt người xem mạnh nhất; đặt tên ở đó là mất
  người xem có thể đo được.
- MỘT câu giới thiệu thương hiệu trong khoảng 0:40–1:30, dài 8–12 giây khi đọc. Ba việc rồi thôi:
  tên kênh + lời hứa của kênh diễn đạt riêng cho tập này + quay lại câu chuyện ngay. Mỗi tập viết
  một câu khác nhau, không lặp lại câu của tập trước. Cho 2–3 câu MẪU dùng {{CHANNEL_NAME}}.
- MỘT câu ký tên ở 30 giây cuối. Cho 2–3 câu mẫu, cũng dùng {{CHANNEL_NAME}}.
- Tối đa HAI lần nhắc tên trong cả tập, tuyệt đối không quá ba.
- CẤM nhắc tên bên trong: đoạn dẫn chứng, signature beat, và cao trào cảm xúc.
- Tối đa MỘT lời kêu gọi, gắn vào câu hỏi kết. Không xếp chồng like–đăng ký–chuông.
- PHÉP THỬ ĐỘ SÂU: bỏ hẳn tên kênh đi, người xem quen có nhận ra kênh này qua hai phút bất kỳ không?
  Nếu không thì nhận diện đang là trang trí — sửa giọng và signature beat, ĐỪNG thêm lần nhắc tên.

--- B3. HỢP ĐỒNG OUTPUT (mục 9, luôn là mục CUỐI CÙNG) ---

STRICT OUTPUT FORMAT

IF REJECTED:

STATUS: REJECTED
REASON: [one concise line]

IF ACCEPTED:

TITLE: [final title]

SCRIPT:

[complete narration script, plain text, no headings, no timestamps, no stage directions]

--- END OF SCRIPT ---

NARRATION DIRECTION:
[3 to 6 lines: register, target words per minute, the two places to slow down, phonetic notes for any
name or place]

Output NOTHING else. No analysis, no planning, no alternative titles, no word counts, no visual or
music instructions, no commentary.

==================================================
PHẦN C — CỔNG NGUỒN: ĐỂ NHẸ
==================================================

Master prompt được phép trả \`STATUS: REJECTED\`, nhưng bạn phải đặt ngưỡng NHẸ:

- Reject KHI: vùng nguồn trống, hoặc nội dung không liên quan gì tới ngách của kênh.
- KHÔNG reject vì: nguồn ngắn, nguồn thiếu chi tiết, nguồn chỉ có vài đoạn.

Lý do: người dùng chạy kênh hằng ngày. Ngưỡng khắt khe làm video dừng liên tục và họ tưởng phần mềm
hỏng. Khi nguồn mỏng, hãy dặn model thu hẹp phạm vi và viết ngắn hơn mục tiêu — đừng từ chối, và cũng
đừng bịa cho đủ thời lượng.

==================================================
PHẦN D — CHẤT LƯỢNG VĂN
==================================================

Nhét các luật này vào mục 8, diễn đạt theo giọng của kênh:

- Mở bằng một danh từ riêng hoặc một con số cụ thể. Cấm mở bằng câu hỏi tu từ, cấm chào, cấm "trong
  video này".
- Cấm nói trước cấu trúc ("đầu tiên chúng ta sẽ…", "tóm lại…"). Nói thẳng vào việc.
- Tối đa 2 câu giải thích liên tiếp. Câu thứ ba phải là một cảnh, một người, một con số, một đồ vật.
- Cụ thể thắng trừu tượng: "ông ấy đếm ba lần rồi mới ký" thay vì "ông ấy rất cẩn thận".
- Nhịp câu phải đổi. Xen câu dài với câu rất ngắn.
- Cấm nhắc lại một ý đã nói bằng cách diễn đạt khác.
- Cao trào cảm xúc phải là câu văn ĐƠN GIẢN nhất trong tập, không phải câu hoa mỹ nhất.
- Kết bằng chi tiết riêng của câu chuyện này. Nếu đoạn kết có thể gắn vào mười tập khác thì viết lại.

==================================================
PHẦN E — ĐẦU VÀO
==================================================

Thông tin kênh:
- Tên kênh / Project: ${projectName}
- Mô hình AI sử dụng: ${aiModelName}
- Kiểu video (engine): Google Flow (Veo & Imagen)
- Ngách: ${niche}
- Mô tả kênh: ${desc}
- Định hướng / nhấn mạnh: ${orient}
- Ngôn ngữ kịch bản: Tiếng Việt
- Độ dài mục tiêu: ${targetMinutes}
- Loại nguồn thường dùng: Bài báo, tư liệu lịch sử, hồ sơ sự kiện, kịch bản phác thảo

Tên kênh ở trên là TÊN THẬT. Viết nó thẳng vào mục 1 (SYSTEM ROLE), mục 4 (CHANNEL DNA) và mục 4B
(BRAND IDENTITY) của master prompt bạn tạo ra, để prompt đọc lên là ra ngay kênh nào.

Nhưng ở mục 2 (INPUT) và ở CÁC CÂU MẪU mà người dẫn sẽ đọc trên sóng thì phải giữ nguyên chuỗi
{{CHANNEL_NAME}} — đó là chỗ phần mềm tự điền lúc chạy. Đổi tên kênh sau này thì mọi câu đọc tự cập
nhật, không phải viết lại master prompt.

==================================================
PHẦN F — CÁCH TRẢ LỜI
==================================================

Viết master prompt bằng ngôn ngữ Tiếng Việt (vì kịch bản nó sinh ra sẽ ở ngôn ngữ đó), TRỪ ba khối
ở PHẦN B — chép nguyên văn tiếng Anh.

Độ dài master prompt: 150–250 dòng. Đủ chặt để chạy được, không dài tới mức không ai đọc nổi.

Trả về DUY NHẤT nội dung master prompt. Không lời dẫn, không giải thích, không bọc trong khối code.
Bắt đầu ngay bằng mục 1 SYSTEM ROLE.`;

        if (config.provider === 'chatgpt_web') {
          const { ChatGptWebSessionManager } = await import('../chatgpt/ChatGptWebSessionManager');
          const mgr = ChatGptWebSessionManager.getInstance();
          const mode = config.chatgptWebMode || 'offscreen';
          const res = await mgr.executePromptTurn(userPrompt, mode, onProgress);
          if (res && res.length >= 100) return res.trim();
        } else if (config.provider === 'gemini_web') {
          const { GeminiWebSessionManager } = await import('../gemini/GeminiWebSessionManager');
          const mgr = GeminiWebSessionManager.getInstance();
          const mode = config.geminiWebMode || 'offscreen';
          const res = await mgr.executePromptTurn(userPrompt, mode, onProgress);
          if (res && res.length >= 100) return res.trim();
        } else {
          const clientBundle = this.createClient(config);
          if (clientBundle) {
            const resp = await clientBundle.client.chat.completions.create({
              model: clientBundle.model,
              messages: [{ role: 'user', content: userPrompt }],
              temperature: 0.7,
            });
            const text = resp.choices[0]?.message?.content;
            if (text && text.length >= 100) return text.trim();
          }
        }
      } catch (err) {
        console.warn('[AiStudioLlmService] Remote master prompt generation error, using modular template:', err);
      }
    }

    return promptTemplate;
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
