import fs from 'fs';
import path from 'path';
import { jsonrepair } from 'jsonrepair';
import { createGeminiClient, friendlyGeminiError } from '../ai/geminiClient';
import { SettingsStore } from '../store/settingsStore';
import { parseSrt, serializeSrt, SrtLine } from '../lib/srt';

interface BatchItem {
  i: string;
  text: string;
}

interface TranslatedItem {
  i: string;
  text: string;
}

export async function translateSrtFile(
  srtPath: string,
  targetLanguage: string = 'vi',
  onProgress?: (percent: number) => void
): Promise<{ translatedSrtPath: string }> {
  if (!fs.existsSync(srtPath)) {
    throw new Error(`File SRT không tồn tại: ${srtPath}`);
  }

  const srtContent = fs.readFileSync(srtPath, 'utf-8');
  const lines = parseSrt(srtContent);
  if (lines.length === 0) {
    throw new Error('File SRT rỗng hoặc không có dòng phụ đề hợp lệ.');
  }

  const batchSize = SettingsStore.get('translateBatchSize') || 15;
  const { client, model } = createGeminiClient();

  const totalBatches = Math.ceil(lines.length / batchSize);
  const translatedLines: SrtLine[] = [];
  let previousContext: { original: string; translated: string }[] = [];

  for (let b = 0; b < totalBatches; b++) {
    const batchLines = lines.slice(b * batchSize, (b + 1) * batchSize);
    const itemsToTranslate: BatchItem[] = batchLines.map((l) => ({
      i: l.id,
      text: l.text,
    }));

    const systemPrompt = `Bạn là biên dịch viên phụ đề chuyên nghiệp.
Nhiệm vụ: Dịch danh sách các câu phụ đề sang ngôn ngữ đích: "${targetLanguage}".
Quy tắc BẮT BUỘC:
1. Nhận đầu vào là JSON chứa mảng các phần tử {"i": "id", "text": "nội dung"}.
2. Trả về DUY NHẤT một chuỗi JSON mảng các phần tử {"i": "id", "text": "bản dịch"}. Không thêm markdown block (\`\`\`json), không giải thích thêm.
3. Dữ liệu ngữ cảnh 2 câu vừa dịch trước đó (nếu có) chỉ dùng để hiểu ngữ cảnh, KHÔNG dịch lại 2 câu ngữ cảnh đó.
4. Giữ đúng thứ tự và số lượng phần tử. Giữ nguyên định dạng ID.
5. Dịch tự nhiên, phù hợp với ngữ cảnh video.`;

    const userPayload = {
      context: previousContext,
      items: itemsToTranslate,
    };

    let attempts = 0;
    let success = false;
    let batchResult: TranslatedItem[] = [];
    let lastError: any = null;

    while (attempts < 3 && !success) {
      try {
        attempts++;
        const response = await client.chat.completions.create({
          model,
          temperature: 0.3,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(userPayload) },
          ],
        });

        const rawContent = response.choices[0]?.message?.content?.trim() || '';
        if (!rawContent) {
          throw new Error('Mô hình trả về phản hồi rỗng.');
        }

        let cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

        let parsed: any;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          const repaired = jsonrepair(cleaned);
          parsed = JSON.parse(repaired);
        }

        if (Array.isArray(parsed)) {
          batchResult = parsed;
        } else if (parsed && Array.isArray(parsed.items)) {
          batchResult = parsed.items;
        } else {
          throw new Error('Kết quả JSON trả về không đúng định dạng mảng.');
        }

        success = true;
      } catch (err: any) {
        lastError = err;
        if (attempts < 3) {
          await new Promise((res) => setTimeout(res, attempts * 1500));
        }
      }
    }

    if (!success) {
      throw new Error(`Dịch thất bại ở batch ${b + 1}/${totalBatches}: ${friendlyGeminiError(lastError)}`);
    }

    const resultMap = new Map<string, string>();
    for (const item of batchResult) {
      if (item && item.i && typeof item.text === 'string') {
        resultMap.set(item.i, item.text);
      }
    }

    const translatedBatch: SrtLine[] = batchLines.map((line) => {
      const transText = resultMap.get(line.id) || line.text;
      return {
        ...line,
        text: transText,
      };
    });

    translatedLines.push(...translatedBatch);

    const lastTwoOriginal = batchLines.slice(-2);
    const lastTwoTranslated = translatedBatch.slice(-2);
    previousContext = lastTwoOriginal.map((orig, idx) => ({
      original: orig.text,
      translated: lastTwoTranslated[idx]?.text || orig.text,
    }));

    if (onProgress) {
      onProgress(Math.round(((b + 1) / totalBatches) * 100));
    }
  }

  const srtDir = path.dirname(srtPath);
  const srtBasename = path.basename(srtPath, '.srt');
  const translatedSrtPath = path.join(srtDir, `${srtBasename}.translated.srt`);

  fs.writeFileSync(translatedSrtPath, serializeSrt(translatedLines), 'utf-8');

  return { translatedSrtPath };
}
