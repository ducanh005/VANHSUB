import fs from 'fs';
import path from 'path';
import { jsonrepair } from 'jsonrepair';
import { createGeminiClient, friendlyGeminiError } from '../ai/geminiClient';
import { SettingsStore } from '../store/settingsStore';
import { parseSrt, serializeSrt, SrtLine } from '../lib/srt';
import { CancelledError } from '../lib/cancel';

interface BatchItem {
  i: string;
  text: string;
}

interface TranslatedItem {
  i: string;
  text: string;
}

// =========================================================================
// CHECKPOINT — cache bản dịch theo từng batch, lưu xuống đĩa ngay sau mỗi
// batch thành công. Nếu API lỗi / huỷ / app đóng giữa chừng, lần chạy lại
// sẽ tái sử dụng các dòng đã dịch (đúng ngôn ngữ + text gốc không đổi) và
// chỉ dịch phần còn lại. Khi dịch hoàn tất thì xoá checkpoint.
// =========================================================================

interface CheckpointData {
  targetLanguage: string;
  /** key = id dòng phụ đề ('line-0'…); value = text gốc + bản dịch đã có */
  translations: Record<string, { source: string; target: string }>;
}

/** Đường dẫn file checkpoint đi kèm 1 file SRT */
export function getCheckpointPath(srtPath: string): string {
  return path.join(path.dirname(srtPath), `${path.basename(srtPath, '.srt')}.checkpoint.json`);
}

/** Đọc checkpoint (trả về Map rỗng nếu chưa có / sai ngôn ngữ / hỏng file) */
export function loadCheckpoint(srtPath: string, targetLanguage: string): Map<string, string> {
  const result = new Map<string, string>();
  const filePath = getCheckpointPath(srtPath);
  if (!fs.existsSync(filePath)) return result;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CheckpointData;
    if (data?.targetLanguage !== targetLanguage || typeof data.translations !== 'object') {
      return result;
    }
    for (const [id, entry] of Object.entries(data.translations)) {
      if (entry && typeof entry.source === 'string' && typeof entry.target === 'string') {
        result.set(id, JSON.stringify([entry.source, entry.target]));
      }
    }
  } catch {
    // checkpoint hỏng → bỏ qua, dịch lại từ đầu (an toàn hơn là dùng dữ liệu sai)
  }
  return result;
}

/** Ghi checkpoint xuống đĩa (đè file cũ) */
export function saveCheckpoint(
  srtPath: string,
  targetLanguage: string,
  translations: Record<string, { source: string; target: string }>,
): void {
  const data: CheckpointData = { targetLanguage, translations };
  fs.writeFileSync(getCheckpointPath(srtPath), JSON.stringify(data), 'utf-8');
}

// =========================================================================
// GLOSSARY & VĂN PHONG — cấu hình ở Cài đặt, đưa thẳng vào system prompt
// để giữ nhất quán thuật ngữ / xưng hô xuyên suốt bản dịch.
// =========================================================================

function buildGlossaryPrompt(): string {
  const raw = (SettingsStore.get('glossary') || '').trim();
  if (!raw) return '';
  const lines = raw
    .split('\n')
    .map((l) => l.trim().replace(/^[-•*]\s*/, ''))
    .filter(Boolean);
  if (lines.length === 0) return '';
  return `\nBẢNG THUẬT NGỮ BẮT BUỘC — phải dịch đúng và nhất quán theo bảng này cho TOÀN BỘ bản dịch (mỗi dòng có dạng "nguồn = cách dịch"):\n${lines
    .map((l) => `- ${l}`)
    .join('\n')}`;
}

function buildStyleGuidePrompt(): string {
  const raw = (SettingsStore.get('translationStyleGuide') || '').trim();
  if (!raw) return '';
  return `\nVĂN PHONG & QUY TẮC XƯNG HÔ — áp dụng nhất quán toàn bộ bản dịch:\n${raw}`;
}

/** Ghép prompt hệ thống: rules gốc + glossary + style guide */
export function buildSystemPrompt(targetLanguage: string): string {
  const base = `Bạn là biên dịch viên phụ đề chuyên nghiệp.
Nhiệm vụ: Dịch danh sách các câu phụ đề sang ngôn ngữ đích: "${targetLanguage}".
Quy tắc BẮT BUỘC:
1. Nhận đầu vào là JSON chứa mảng các phần tử {"i": "id", "text": "nội dung"}.
2. Trả về DUY NHẤT một chuỗi JSON mảng các phần tử {"i": "id", "text": "bản dịch"}. Không thêm markdown block (\`\`\`json), không giải thích thêm.
3. Dữ liệu ngữ cảnh 2 câu vừa dịch trước đó (nếu có) chỉ dùng để hiểu ngữ cảnh, KHÔNG dịch lại 2 câu ngữ cảnh đó.
4. Giữ đúng thứ tự và số lượng phần tử. Giữ nguyên định dạng ID.
5. Dịch tự nhiên, phù hợp với ngữ cảnh video.
6. Dịch nhất quán: cùng 1 từ/tên riêng/thuật ngữ thì dùng cùng 1 cách dịch ở mọi dòng.`;
  return base + buildGlossaryPrompt() + buildStyleGuidePrompt();
}

export async function translateSrtFile(
  srtPath: string,
  targetLanguage: string = 'vi',
  onProgress?: (percent: number) => void,
  shouldStop?: () => boolean
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
  const systemPrompt = buildSystemPrompt(targetLanguage);

  // Nạp cache từ checkpoint của lần chạy trước (nếu có)
  const cachedRaw = loadCheckpoint(srtPath, targetLanguage);
  // Map id -> bản dịch; chỉ dùng khi text gốc KHÔNG đổi (nếu đổi sẽ dịch lại)
  const cachedTarget = new Map<string, string>();
  const checkpointData: Record<string, { source: string; target: string }> = {};
  for (const [id, packed] of cachedRaw) {
    const [source, target] = JSON.parse(packed) as [string, string];
    const line = lines.find((l) => l.id === id);
    if (line && line.text === source) {
      cachedTarget.set(id, target);
      checkpointData[id] = { source, target };
    }
  }
  const totalCached = cachedTarget.size;
  if (totalCached > 0) {
    console.log(
      `[Translate] Tái sử dụng ${totalCached}/${lines.length} dòng đã dịch từ checkpoint (${targetLanguage})`
    );
  }

  const totalBatches = Math.ceil(lines.length / batchSize);
  const translatedLines: SrtLine[] = [];
  let previousContext: { original: string; translated: string }[] = [];

  for (let b = 0; b < totalBatches; b++) {
    if (shouldStop?.()) {
      throw new CancelledError();
    }
    const batchLines = lines.slice(b * batchSize, (b + 1) * batchSize);

    // Dòng nào đã có trong cache (text gốc trùng khớp) thì dùng lại, không gọi API
    const itemsToTranslate: BatchItem[] = batchLines
      .filter((l) => !cachedTarget.has(l.id))
      .map((l) => ({ i: l.id, text: l.text }));

    let batchResult: TranslatedItem[] = [];
    if (itemsToTranslate.length > 0) {
      const userPayload = { context: previousContext, items: itemsToTranslate };

      let attempts = 0;
      let success = false;
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
          // Rate limit (429) cần backoff dài hơn lỗi thường
          const isRateLimit = err?.status === 429 || err?.response?.status === 429;
          if (attempts < 3) {
            const delay = isRateLimit ? attempts * 8000 : attempts * 1500;
            console.warn(
              `[Translate] Batch ${b + 1} lỗi (lần ${attempts}/3): ${err?.message || err} — thử lại sau ${delay}ms`
            );
            await new Promise((res) => setTimeout(res, delay));
          }
        }
      }

      if (!success) {
        // Checkpoint vẫn còn trên đĩa — lần chạy lại sẽ tiếp tục từ đây
        throw new Error(
          `Dịch thất bại ở batch ${b + 1}/${totalBatches}: ${friendlyGeminiError(lastError)}. ` +
            `Các batch đã dịch được lưu tạm — chạy lại sẽ tiếp tục từ chỗ dừng.`
        );
      }
    }

    // Ghép kết quả: ưu tiên bản dịch vừa nhận, fallback sang cache, cuối cùng là text gốc
    const resultMap = new Map<string, string>();
    for (const item of batchResult) {
      if (item && item.i && typeof item.text === 'string') {
        resultMap.set(item.i, item.text);
      }
    }

    const translatedBatch: SrtLine[] = batchLines.map((line) => {
      const transText = resultMap.get(line.id) ?? cachedTarget.get(line.id) ?? line.text;
      return { ...line, text: transText };
    });

    // Lưu vào cache + ghi checkpoint NGAY sau mỗi batch (chỉ các dòng mới dịch)
    for (const line of batchLines) {
      const target = resultMap.get(line.id) ?? cachedTarget.get(line.id);
      if (target !== undefined) {
        checkpointData[line.id] = { source: line.text, target };
      }
    }
    saveCheckpoint(srtPath, targetLanguage, checkpointData);

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

  // Dịch hoàn tất — xoá checkpoint (bản dịch đã nằm trong .translated.srt)
  const checkpointFile = getCheckpointPath(srtPath);
  if (fs.existsSync(checkpointFile)) fs.unlinkSync(checkpointFile);

  return { translatedSrtPath };
}
