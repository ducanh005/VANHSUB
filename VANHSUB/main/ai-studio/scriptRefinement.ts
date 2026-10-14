import { jsonrepair } from 'jsonrepair';
import type { ScriptBeatLine } from './types';

export function parseStructuredReply(raw: string): any {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced || raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  if (!candidate.trim()) throw new Error('Provider không trả về JSON hợp lệ.');
  return JSON.parse(jsonrepair(candidate));
}

/** Accept script content only; never let a model return disk pointers or fabricated timing. */
export function parseRefinedScript(raw: string, original: ScriptBeatLine[]): ScriptBeatLine[] {
  const parsed = parseStructuredReply(raw);
  if (!Array.isArray(parsed.lines) || parsed.lines.length !== original.length) {
    throw new Error('Bản sửa phải giữ đủ số dòng và thứ tự kịch bản.');
  }
  return parsed.lines.map((line: any, index: number) => {
    if (!line || line.id !== original[index].id || typeof line.text !== 'string' || !line.text.trim()) {
      throw new Error(`Bản sửa có ID/lời thoại không hợp lệ ở dòng ${index + 1}.`);
    }
    const { audioPath, startMs, endMs, durationMs, assetPath, assetType, ...source } = original[index];
    const result: ScriptBeatLine = { ...source, text: line.text.trim() };
    for (const field of ['voiceDirection', 'visualAction', 'visualNote', 'cameraAngle', 'cameraMovement', 'visualPromptEn'] as const) {
      if (line[field] !== undefined) {
        if (typeof line[field] !== 'string') throw new Error(`Chỉ dẫn ${field} không hợp lệ.`);
        result[field] = line[field].trim() || undefined;
      }
    }
    if (line.suggestedMediaType !== undefined) {
      if (!['image', 'video'].includes(line.suggestedMediaType)) throw new Error('Loại media không hợp lệ.');
      result.suggestedMediaType = line.suggestedMediaType;
    }
    result.estimatedDurationSec = Math.max(1, result.text.split(/\s+/).length / 3.2);
    return result;
  });
}
