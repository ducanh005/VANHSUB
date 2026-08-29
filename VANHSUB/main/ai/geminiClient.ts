import OpenAI from 'openai';
import { SettingsStore } from '../store/settingsStore';

// Gemini tương thích endpoint OpenAI — dùng lại SDK openai theo quyết định kỹ thuật đã chốt.
const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

const POLISH_SYSTEM_PROMPT = `Bạn là biên tập viên phụ đề phim tiếng Việt.
Nhiệm vụ: hiệu đính câu người dùng cung cấp — sửa lỗi chính tả, ngữ pháp, dấu câu và làm câu tự nhiên hơn theo văn nói tiếng Việt, giữ NGUYÊN nghĩa và đủ các ý của bản gốc.
Yêu cầu:
- Không dịch sang tiếng khác, không lược bỏ hoặc thêm ý mới.
- Giữ độ dài gần tương đương bản gốc để phụ đề không tràn màn hình.
- Nếu bản gốc đã tốt thì chỉ tinh chỉnh nhẹ.
- Chỉ trả về DUY NHẤT câu đã chỉnh, không giải thích, không bọc ngoặc kép.`;

export interface PolishLinePayload {
  text: string;
  prev?: string;
  next?: string;
}

export async function polishSubtitleLine(payload: PolishLinePayload): Promise<string> {
  const apiKey = SettingsStore.get('geminiApiKey').trim();
  if (!apiKey) {
    throw new Error(
      'Chưa cấu hình Gemini API key. Bấm nút "Gemini API" ở màn hình hiệu đính để nhập key (lấy miễn phí tại aistudio.google.com).'
    );
  }
  const model = SettingsStore.get('geminiModel') || 'gemini-2.0-flash';

  const client = new OpenAI({
    apiKey,
    baseURL: GEMINI_OPENAI_BASE_URL,
    timeout: 30_000,
    maxRetries: 1,
  });

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

function friendlyGeminiError(err: any): string {
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
  return `Lỗi gọi Gemini: ${err?.message || 'không xác định'}`;
}
