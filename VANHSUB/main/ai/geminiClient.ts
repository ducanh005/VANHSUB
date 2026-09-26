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

export interface AiGroupedSubtitle {
  sourceIndices: number[];
  text: string;
}

export type AiGroupedOutput = AiGroupedSubtitle;

export const MAX_SUBTITLE_GAP_MS = 1500;

/**
 * Ghép nối và tính toán timestamp tất định (deterministic) từ kết quả gộp của AI:
 * 1. startMs = original[min(sourceIndices)].startMs
 * 2. endMs = original[max(sourceIndices)].endMs
 * 3. Max Gap Guard: Tách cụm nếu khoảng lặng giữa 2 dòng liên tiếp > maxGapMs (mặc định 1500ms)
 * 4. Missing Index Recovery: Tự động khôi phục các dòng bị AI bỏ sót để bảo toàn 100% dữ liệu
 */
export function resolveGroupedTimestamps(
  originalItems: CleanSubtitlesItem[],
  aiGroups: AiGroupedSubtitle[],
  maxGapMs: number = MAX_SUBTITLE_GAP_MS
): CleanSubtitlesItem[] {
  if (!originalItems || originalItems.length === 0) return [];
  if (originalItems.length === 1) {
    if (aiGroups && aiGroups.length > 0 && typeof aiGroups[0]?.text === 'string' && aiGroups[0].text.trim()) {
      return [
        {
          startMs: originalItems[0].startMs,
          endMs: originalItems[0].endMs,
          text: aiGroups[0].text.trim(),
        },
      ];
    }
    return [...originalItems];
  }

  // Chuẩn hóa phát hiện 1-based indexing từ AI (nếu model trả về 1..N thay vì 0..N-1)
  const allRawIndices: number[] = [];
  if (Array.isArray(aiGroups)) {
    for (const g of aiGroups) {
      if (Array.isArray(g?.sourceIndices)) {
        for (const idx of g.sourceIndices) {
          const n = typeof idx === 'number' ? idx : parseInt(String(idx), 10);
          if (!isNaN(n)) allRawIndices.push(n);
        }
      }
    }
  }
  const isOneBased =
    allRawIndices.length > 0 &&
    !allRawIndices.includes(0) &&
    allRawIndices.includes(originalItems.length) &&
    allRawIndices.every((idx) => idx >= 1 && idx <= originalItems.length);

  const result: CleanSubtitlesItem[] = [];
  const claimedIndices = new Set<number>();

  if (Array.isArray(aiGroups)) {
    for (const group of aiGroups) {
      if (!group || !Array.isArray(group.sourceIndices) || group.sourceIndices.length === 0) {
        continue;
      }

      // Chuẩn hóa và lọc chỉ số hợp lệ
      const normalizedIndices: number[] = [];
      for (const rawIdx of group.sourceIndices) {
        let idx = typeof rawIdx === 'number' ? rawIdx : parseInt(String(rawIdx), 10);
        if (isNaN(idx)) continue;
        if (isOneBased) idx -= 1;
        if (idx >= 0 && idx < originalItems.length) {
          normalizedIndices.push(idx);
        }
      }

      // Sắp xếp thứ tự tăng dần và loại bỏ trùng lặp trong nhóm
      const uniqueSorted = Array.from(new Set(normalizedIndices)).sort((a, b) => a - b);
      if (uniqueSorted.length === 0) continue;

      // Áp dụng Max Gap Guard: tách nhóm nếu khoảng lặng giữa 2 dòng liên tiếp > maxGapMs
      const clusters: number[][] = [[uniqueSorted[0]]];
      for (let k = 1; k < uniqueSorted.length; k++) {
        const prevIdx = uniqueSorted[k - 1];
        const curIdx = uniqueSorted[k];
        const gap = originalItems[curIdx].startMs - originalItems[prevIdx].endMs;

        if (gap > maxGapMs) {
          clusters.push([curIdx]);
        } else {
          clusters[clusters.length - 1].push(curIdx);
        }
      }

      // Đánh dấu các chỉ số đã được gộp (bao gồm toàn bộ dải trung gian trong từng cụm)
      clusters.forEach((c) => {
        for (let idx = c[0]; idx <= c[c.length - 1]; idx++) {
          claimedIndices.add(idx);
        }
      });

      const rawText = typeof group.text === 'string' ? group.text.trim() : '';

      // Sinh phụ đề cho từng cluster sau khi qua Max Gap Guard
      if (clusters.length === 1) {
        const c = clusters[0];
        const startMs = originalItems[c[0]].startMs;
        const endMs = Math.max(startMs + 100, originalItems[c[c.length - 1]].endMs);
        const text = rawText || c.map((i) => originalItems[i].text).join(' ').trim();
        result.push({ startMs, endMs, text });
      } else {
        // Trường hợp bị Max Gap Guard tách thành nhiều cụm độc lập
        const newlineParts = rawText.split('\n').map((s) => s.trim()).filter(Boolean);
        clusters.forEach((c, cIdx) => {
          const startMs = originalItems[c[0]].startMs;
          const endMs = Math.max(startMs + 100, originalItems[c[c.length - 1]].endMs);
          let text = rawText;
          if (newlineParts.length === clusters.length) {
            text = newlineParts[cIdx];
          } else if (!rawText) {
            text = c.map((i) => originalItems[i].text).join(' ').trim();
          }
          result.push({ startMs, endMs, text });
        });
      }
    }
  }

  // MISSING INDEX RECOVERY: Tự động khôi phục 100% các dòng bị AI bỏ sót
  for (let i = 0; i < originalItems.length; i++) {
    if (!claimedIndices.has(i)) {
      result.push({
        startMs: originalItems[i].startMs,
        endMs: Math.max(originalItems[i].startMs + 100, originalItems[i].endMs),
        text: originalItems[i].text,
      });
    }
  }

  // Sắp xếp lại theo trục thời gian startMs tăng dần
  result.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  // Chống chồng chéo timestamp (overlap clamping an toàn)
  for (let i = 0; i < result.length - 1; i++) {
    if (result[i].endMs > result[i + 1].startMs) {
      if (result[i + 1].startMs > result[i].startMs) {
        result[i].endMs = result[i + 1].startMs;
      } else {
        result[i + 1].startMs = result[i].endMs;
        if (result[i + 1].endMs <= result[i + 1].startMs) {
          result[i + 1].endMs = result[i + 1].startMs + 300;
        }
      }
    }
  }

  return result;
}

/**
 * Dùng Gemini AI để rà soát toàn bộ file phụ đề bằng cơ chế Structured Indexing:
 * 1. Gắn chỉ số index: 0, 1, 2... cho từng dòng đầu vào.
 * 2. Yêu cầu AI trả về mảng sourceIndices: number[] cùng text đã làm sạch (không tự tính startMs/endMs).
 * 3. TypeScript tự động liên kết startMs = original[min].startMs, endMs = original[max].endMs.
 * 4. Max Gap Guard: Tách nhóm nếu khoảng trống giữa 2 dòng liên tiếp > 1500ms.
 * 5. Missing Index Recovery: Tự động bảo toàn các dòng bị bỏ quên.
 */
export async function cleanAndDeduplicateSubtitles(
  items: CleanSubtitlesItem[],
  onProgress?: (percent: number) => void
): Promise<CleanSubtitlesItem[]> {
  if (!items || items.length === 0) return [];
  if (items.length === 1) return [...items];

  const { client, model } = createGeminiClient();

  const CHUNK_SIZE = 50;
  const cleanedAll: CleanSubtitlesItem[] = [];
  const totalChunks = Math.ceil(items.length / CHUNK_SIZE);

  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    const startIdx = chunkIdx * CHUNK_SIZE;
    const chunk = items.slice(startIdx, startIdx + CHUNK_SIZE);

    const inputPayload = chunk.map((item, i) => ({
      index: i,
      text: item.text,
    }));

    const prompt = `Bạn là chuyên gia biên tập phụ đề video chuyên nghiệp.
Dưới đây là danh sách các dòng phụ đề OCR được đánh số thứ tự index từ 0 đến ${chunk.length - 1}.

Nhiệm vụ:
1. GỘP CÂU TRÙNG LẶP / KARAOKE / CHỮ HIỆN DẦN (RẤT QUAN TRỌNG):
   - Một câu nói hiển thị nhiều frame liên tiếp hoặc chữ hiện dần theo kiểu karaoke dẫn đến bị tách thành 2-4 dòng lặp nhau hoặc sai khác nhỏ 1-2 ký tự mờ.
   -> GỘP lại thành MỘT câu duy nhất, liệt kê tất cả các index của dòng gốc trong mảng sourceIndices.
2. CÂU BỊ NGẮT VỤN:
   - Nếu 2-3 câu liên tiếp là các vế ngắt của cùng một câu trọn vẹn, hãy ghép lại thành câu hoàn chỉnh tự nhiên.
3. SỬA LỖI CHÍNH TẢ OCR:
   - Sửa các lỗi nhận diện quang học (nhầm lẫn l/1, 0/O, rn/m, sai dấu thanh tiếng Việt).
4. GIỮ NGUYÊN Ý NGHĨA VÀ NGÔN NGỮ:
   - Tuyệt đối không bịa thêm nội dung, không dịch sang ngôn ngữ khác.
5. QUY TẮC BẮT BUỘC VỀ CHỈ SỐ:
   - Trả về mảng sourceIndices: number[] chứa danh sách index dòng gốc được gộp vào câu đó (ví dụ: [0, 1] hoặc [2]).
   - TUYỆT ĐỐI KHÔNG sinh trường startMs hay endMs.
   - Không được bỏ sót các câu độc lập có ý nghĩa (câu đơn lẻ thì sourceIndices có 1 phần tử, ví dụ [3]).

ĐẦU VÀO JSON:
${JSON.stringify(inputPayload, null, 2)}

ĐẦU RA BẮT BUỘC:
Trả về DUY NHẤT một chuỗi JSON mảng các đối tượng:
[
  { "sourceIndices": [0, 1], "text": "Hôm nay tôi đi làm rất vui" },
  { "sourceIndices": [2], "text": "Thời tiết hôm nay rất đẹp" }
]
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
        const resolved = resolveGroupedTimestamps(chunk, parsed, MAX_SUBTITLE_GAP_MS);
        cleanedAll.push(...resolved);
      } else {
        cleanedAll.push(...chunk);
      }
    } catch (err: any) {
      console.warn(`[AI Clean] Lỗi chunk ${chunkIdx + 1}/${totalChunks}:`, err?.message || err);
      cleanedAll.push(...chunk);
    }

    onProgress?.(Math.round(((chunkIdx + 1) / totalChunks) * 100));
  }

  // Sắp xếp lại theo startMs và tránh chồng đè timestamp giữa các chunk
  cleanedAll.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  for (let i = 0; i < cleanedAll.length - 1; i++) {
    if (cleanedAll[i].endMs > cleanedAll[i + 1].startMs) {
      if (cleanedAll[i + 1].startMs > cleanedAll[i].startMs) {
        cleanedAll[i].endMs = cleanedAll[i + 1].startMs;
      }
    }
  }

  return cleanedAll;
}


