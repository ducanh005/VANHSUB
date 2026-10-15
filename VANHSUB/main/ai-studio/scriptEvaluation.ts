import type { AiStudioLlmConfig, ChannelProfileConfig, ScriptCriteriaScore, ScriptEvaluation } from './types';
import { parseStructuredReply } from './scriptRefinement';

export const SCRIPT_REVIEW_CRITERIA = [
  ['D1', 'Hook mở đầu'], ['D2', 'Dữ kiện cần kiểm chứng'], ['D3', 'Nhịp giữ chân'],
  ['D4', 'Văn phong lồng tiếng'], ['D5', 'Diễn biến và điểm nhấn'], ['D6', 'Cảm xúc phù hợp chủ đề'],
  ['D7', 'Nhận diện kênh'], ['D8', 'Cấu trúc câu chuyện'], ['D9', 'Sáng sủa, dễ hiểu'], ['D10', 'Lời kết & CTA'],
] as const;

export function resolveEvaluationConfig(config: AiStudioLlmConfig, channel?: Partial<ChannelProfileConfig>): AiStudioLlmConfig {
  const provider = channel?.evaluationLlm || config.provider;
  // There is one API credential slot. Never send its key/base URL to a different provider.
  if (provider !== config.provider && provider !== 'chatgpt_web' && provider !== 'gemini_web') {
    throw new Error(`Provider chấm điểm ${provider} chưa có cấu hình API riêng. Hãy chọn cùng provider LLM đã cấu hình hoặc chọn chế độ web.`);
  }
  return { ...config, provider };
}

export function parseScriptEvaluation(raw: string, provider: AiStudioLlmConfig['provider']): ScriptEvaluation {
  const parsed = parseStructuredReply(raw);
  if (!Array.isArray(parsed.criteria) || parsed.criteria.length !== SCRIPT_REVIEW_CRITERIA.length ||
      new Set(parsed.criteria.map((item: any) => item?.id)).size !== SCRIPT_REVIEW_CRITERIA.length ||
      typeof parsed.critique !== 'string' || !parsed.critique.trim()) {
    throw new Error('Phản hồi chấm điểm thiếu tiêu chí hoặc nhận xét.');
  }
  const criteria: ScriptCriteriaScore[] = SCRIPT_REVIEW_CRITERIA.map(([id, name]) => {
    const item = parsed.criteria.find((candidate: any) => candidate?.id === id);
    if (!item || typeof item.score !== 'number' || !Number.isFinite(item.score) || item.score < 0 || item.score > 10 ||
        typeof item.feedback !== 'string' || !item.feedback.trim()) {
      throw new Error(`Phản hồi chấm điểm không hợp lệ ở ${id}.`);
    }
    return { id, name, score: item.score, feedback: item.feedback.trim() };
  });
  return {
    overallScore: Math.round(criteria.reduce((sum, item) => sum + item.score, 0)),
    lowestScore: Math.min(...criteria.map(item => item.score)),
    criteria, failedCriteria: criteria.filter(item => item.score < 8).map(item => item.id),
    critique: parsed.critique.trim(), notice: `Nhận xét từ ${provider}. Dữ kiện chưa được đối chiếu nguồn độc lập; điểm AI không xác nhận tính đúng của thông tin.`,
    method: 'llm', provider, evaluatedAt: Date.now(),
  };
}
