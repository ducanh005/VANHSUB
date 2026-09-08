import OpenAI from 'openai';
import { SettingsStore } from '../store/settingsStore';

// Gemini tương thích endpoint OpenAI — dùng lại SDK openai theo quyết định kỹ thuật đã chốt.
const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

export function friendlyGeminiError(err: any): string {
  const status = err?.status ?? err?.response?.status;
  if (status === 401 || status === 403) {
    return 'Gemini API key không hợp lệ hoặc không có quyền — kiểm tra lại key đã nhập.';
  }
  if (status === 429) {
    return 'Vượt giới hạn tốc độ của Gemini (rate limit). Đợi vài giây rồi thử lại.';
  }
  if (status === 404) {
    return `Model "${SettingsStore.get('geminiModel')}" không khả dụng với key này.`;
  }
  if (err?.code === 'ETIMEDOUT' || err?.name === 'TimeoutError' || err?.code === 'ECONNABORTED') {
    return 'Gemini phản hồi quá chậm (timeout) — kiểm tra kết nối mạng rồi thử lại.';
  }
  return `Lỗi gọi Gemini: ${err?.message || 'không xác định'}`;
}

/** Tạo client OpenAI trỏ tới Gemini. Ném lỗi thân thiện nếu chưa có API key. */
export function createGeminiClient(): { client: OpenAI; model: string } {
  const apiKey = SettingsStore.get('geminiApiKey').trim();
  if (!apiKey) {
    throw new Error(
      'Chưa cấu hình Gemini API key. Vào Cài đặt (hoặc bấm nút "Gemini API" ở màn hình hiệu đính) để nhập key — lấy miễn phí tại aistudio.google.com.'
    );
  }
  const model = SettingsStore.get('geminiModel') || 'gemini-flash-latest';
  const client = new OpenAI({
    apiKey,
    baseURL: GEMINI_OPENAI_BASE_URL,
    timeout: 60_000,
    maxRetries: 0, // retry tự quản lý ở từng module (translator cần kiểm soát backoff riêng)
  });
  return { client, model };
}

const POLISH_SYSTEM_PROMPT = `Bạn là biên tập viên phụ đề phim chuyên nghiệp.
Nhiệm vụ: hiệu đính câu người dùng cung cấp — sửa lỗi chính tả, ngữ pháp, dấu câu và làm câu tự nhiên hơn theo văn nói, giữ NGUYÊN nghĩa và đủ các ý của bản gốc.
Yêu cầu:
- Luôn giữ NGUYÊN ngôn ngữ của câu gốc: câu nào tiếng Việt thì chỉnh tiếng Việt, câu tiếng Anh thì chỉnh tiếng Anh... tuyệt đối không dịch sang ngôn ngữ khác.
- Không lược bỏ hoặc thêm ý mới.
- Giữ độ dài gần tương đương bản gốc để phụ đề không tràn màn hình.
- Nếu bản gốc đã tốt thì chỉ tinh chỉnh nhẹ.
- Chỉ trả về DUY NHẤT câu đã chỉnh, không giải thích, không bọc ngoặc kép.`;

export interface PolishLinePayload {
  text: string;
  prev?: string;
  next?: string;
}

export async function polishSubtitleLine(payload: PolishLinePayload): Promise<string> {
  const { client, model } = createGeminiClient();

  const contextParts: string[] = [];
  if (payload.prev?.trim()) contextParts.push(`Câu trước đó (chỉ để tham khảo ngữ cảnh): "${payload.prev.trim()}"`);
  if (payload.next?.trim()) contextParts.push(`Câu sau đó (chỉ để tham khảo ngữ cảnh): "${payload.next.trim()}"`);

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: POLISH_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [contextParts.join('\n'), `Câu cần hiệu đính: "${payload.text}"`]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    });

    const result = completion.choices[0]?.message?.content?.trim();
    if (!result) throw new Error('Gemini trả về kết quả rỗng, thử lại nhé.');

    // Bỏ ngoặc kép bọc ngoài nếu model có thêm vào
    return result.replace(/^["“']+|["”']+$/g, '').trim();
  } catch (err: any) {
    throw new Error(friendlyGeminiError(err));
  }
}

export interface TranslateLinePayload {
  text: string;
  targetLanguage?: string;
  prev?: string;
  next?: string;
}

export async function translateSubtitleLine(payload: TranslateLinePayload): Promise<string> {
  const { client, model } = createGeminiClient();
  const targetLang = payload.targetLanguage || SettingsStore.get('targetLanguage') || 'vi';

  const contextParts: string[] = [];
  if (payload.prev?.trim()) contextParts.push(`Ngữ cảnh câu trước: "${payload.prev.trim()}"`);
  if (payload.next?.trim()) contextParts.push(`Ngữ cảnh câu sau: "${payload.next.trim()}"`);

  const prompt = `Bạn là biên dịch viên phụ đề phim chuyên nghiệp.
Nhiệm vụ: Dịch DUY NHẤT câu sau sang ngôn ngữ: "${targetLang}".
Yêu cầu:
- Giữ nguyên ngữ nghĩa, dịch tự nhiên theo văn nói phụ đề phim, ngắn gọn súc tích.
- Chỉ trả về DUY NHẤT câu đã dịch, không giải thích, không bọc ngoặc kép.`;

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [contextParts.join('\n'), `Câu cần dịch: "${payload.text}"`]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    });

    const result = completion.choices[0]?.message?.content?.trim();
    if (!result) throw new Error('Gemini trả về kết quả rỗng, thử lại nhé.');

    return result.replace(/^["“']+|["”']+$/g, '').trim();
  } catch (err: any) {
    throw new Error(friendlyGeminiError(err));
  }
}

