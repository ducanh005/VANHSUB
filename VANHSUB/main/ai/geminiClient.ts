import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
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

export interface CleanSubtitlesItem {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Dùng Gemini AI để rà soát toàn bộ file phụ đề:
 * 1. Gom các dòng bị lặp lại do OCR flickering hoặc hiệu ứng karaoke.
 * 2. Nối các mảnh câu bị ngắt vụn thành câu hoàn chỉnh.
 * 3. Sửa lỗi chính tả OCR (dấu thanh tiếng Việt, nhầm chữ cái).
 * 4. Tính toán và giữ timestamp chuẩn xác.
 */
export async function cleanAndDeduplicateSubtitles(
  items: CleanSubtitlesItem[],
  onProgress?: (percent: number) => void
): Promise<CleanSubtitlesItem[]> {
  if (!items || items.length === 0) return [];
  if (items.length === 1) return items;

  const { client, model } = createGeminiClient();

  const CHUNK_SIZE = 50;
  const cleanedAll: CleanSubtitlesItem[] = [];
  const totalChunks = Math.ceil(items.length / CHUNK_SIZE);

  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    const startIdx = chunkIdx * CHUNK_SIZE;
    const chunk = items.slice(startIdx, startIdx + CHUNK_SIZE);

    const inputJson = JSON.stringify(
      chunk.map((item, i) => ({
        i: i + 1,
        startMs: item.startMs,
        endMs: item.endMs,
        text: item.text,
      }))
    );

    const prompt = `Bạn là chuyên gia biên tập phụ đề video chuyên nghiệp.
Danh sách phụ đề dưới đây được trích xuất bằng OCR nên thường có các lỗi:
1. LẶP PHỤ ĐỀ (RẤT QUAN TRỌNG):
   - Một câu nói hiển thị nhiều frame liên tiếp hoặc chữ hiện dần theo kiểu karaoke dẫn đến bị tách thành 2-4 dòng lặp nhau hoặc sai khác nhỏ 1-2 ký tự mờ.
   -> BẮT BUỘC: GỘP thành MỘT câu duy nhất với startMs của câu đầu tiên và endMs của câu cuối cùng!
2. CÂU BỊ NGẮT VỤN:
   - Nếu 2-3 câu liên tiếp là các vế ngắt của cùng một câu trọn vẹn, hãy ghép lại thành câu hoàn chỉnh tự nhiên.
3. SỬA LỖI CHÍNH TẢ OCR:
   - Sửa các lỗi nhận diện quang học (nhầm lẫn l/1, 0/O, rn/m, sai dấu thanh tiếng Việt).
4. GIỮ NGUYÊN Ý NGHĨA VÀ NGÔN NGỮ:
   - Tuyệt đối không bịa thêm nội dung, không dịch sang ngôn ngữ khác.

ĐẦU VÀO JSON:
${inputJson}

ĐẦU RA BẮT BUỘC:
Trả về DUY NHẤT một chuỗi JSON mảng chứa các câu sau khi đã gộp và làm sạch (gồm các trường: startMs, endMs, text).
Ví dụ:
[{"startMs": 1000, "endMs": 4500, "text": "Hôm nay tôi đi làm rất vui"}]
Không giải thích thêm, không bọc trong markdown.`;

    try {
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'Bạn là chuyên gia biên tập phụ đề video. Luôn trả về định dạng JSON thuần.' },
          { role: 'user', content: prompt },
        ],
      });

      const raw = completion.choices[0]?.message?.content?.trim() || '[]';
      const cleanJson = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();

      let parsed: any[];
      try {
        parsed = JSON.parse(cleanJson);
      } catch {
        parsed = JSON.parse(jsonrepair(cleanJson));
      }

      if (Array.isArray(parsed) && parsed.length > 0) {
        for (const it of parsed) {
          if (it && typeof it.text === 'string' && it.text.trim()) {
            cleanedAll.push({
              startMs: Math.max(0, Number(it.startMs) || 0),
              endMs: Math.max(0, Number(it.endMs) || 0),
              text: String(it.text).trim(),
            });
          }
        }
      } else {
        cleanedAll.push(...chunk);
      }
    } catch (err: any) {
      console.warn(`[AI Clean] Lỗi chunk ${chunkIdx + 1}/${totalChunks}:`, err?.message || err);
      cleanedAll.push(...chunk);
    }

    onProgress?.(Math.round(((chunkIdx + 1) / totalChunks) * 100));
  }

  // Sắp xếp lại theo startMs và tránh chồng đè timestamp
  cleanedAll.sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < cleanedAll.length - 1; i++) {
    if (cleanedAll[i].endMs > cleanedAll[i + 1].startMs) {
      cleanedAll[i].endMs = cleanedAll[i + 1].startMs;
    }
  }

  return cleanedAll;
}


