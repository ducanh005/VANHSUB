/**
 * Utility tính toán và ước tính trước số lượng Credit & Chi phí USD
 * cho các tác vụ sinh Video (Google Veo 3.1 Quality, Veo 3.1 Lite, Veo 2.0, Kling) và Image AI
 */

export interface CreditEstimation {
  credits: number;
  costUsd: string;
  detail: string;
  modelLabel: string;
}

export function calculateNodeCreditEstimate(nodeType?: string, config?: any): CreditEstimation {
  if (!nodeType || !config) {
    return { credits: 0, costUsd: '0.00', detail: '', modelLabel: '' };
  }

  if (nodeType === 'google-flow-video') {
    const duration = Math.max(1, Number(config?.durationSeconds || 5));
    const variant = String(config?.modelVariant || 'veo-3.1-quality');
    const qualityPreset = config?.qualityPreset || 'quality';

    let baseCreditsPerSec = 3;
    let costPerSec = 0.03;
    let modelLabel = 'Google Veo 3.1 Quality';

    if (variant.includes('3.1-lite') || variant === 'veo-3.1-lite') {
      baseCreditsPerSec = 1;
      costPerSec = 0.01;
      modelLabel = 'Google Veo 3.1 Lite';
    } else if (variant.includes('3.1-quality') || variant === 'veo-3.1-quality') {
      baseCreditsPerSec = 3;
      costPerSec = 0.03;
      modelLabel = 'Google Veo 3.1 Quality';
    } else if (variant.includes('2.0')) {
      baseCreditsPerSec = 2;
      costPerSec = 0.02;
      modelLabel = 'Google Veo 2.0';
    } else if (variant.includes('fast')) {
      baseCreditsPerSec = 1;
      costPerSec = 0.01;
      modelLabel = 'Google Veo Fast';
    } else if (variant.includes('omni-flash')) {
      baseCreditsPerSec = 0.8;
      costPerSec = 0.008;
      modelLabel = 'Gemini Omni Flash';
    }

    const isQualityMode = qualityPreset === 'quality';
    const multiplier = isQualityMode && !variant.includes('quality') ? 1.25 : 1.0;

    const credits = Math.round(duration * baseCreditsPerSec * multiplier);
    const costUsd = (duration * costPerSec * multiplier).toFixed(2);

    return {
      credits,
      costUsd,
      detail: `${duration}s x ${modelLabel} (${isQualityMode ? 'Quality' : 'Lite'})`,
      modelLabel,
    };
  }

  if (nodeType === 'kling-video') {
    const duration = Math.max(1, Number(config?.durationSeconds || 5));
    const credits = Math.round(duration * 2);
    return {
      credits,
      costUsd: (duration * 0.02).toFixed(2),
      detail: `${duration}s Kling AI Video`,
      modelLabel: 'Kling AI Video',
    };
  }

  if (nodeType === 'google-imagen') {
    return {
      credits: 0,
      costUsd: '0.00',
      detail: 'Tạo ảnh Keyframe Imagen 3 (Miễn phí 100% qua Google Labs)',
      modelLabel: 'Google Imagen 3 (Free)',
    };
  }

  return { credits: 0, costUsd: '0.00', detail: '', modelLabel: '' };
}

export function calculateGraphCreditEstimate(nodes: Array<{ data: { nodeType?: string; config?: any } }>) {
  let totalCredits = 0;
  let totalCostNumber = 0;
  let videoSeconds = 0;
  let modelCount = 0;

  for (const node of nodes) {
    const nodeType = node.data?.nodeType;
    const config = node.data?.config;
    if (nodeType === 'google-flow-video' || nodeType === 'kling-video') {
      modelCount++;
      videoSeconds += Number(config?.durationSeconds || 5);
    } else if (nodeType === 'google-imagen') {
      modelCount++;
    }

    const est = calculateNodeCreditEstimate(nodeType, config);
    totalCredits += est.credits;
    totalCostNumber += parseFloat(est.costUsd) || 0;
  }

  return {
    totalCredits,
    totalCostUsd: totalCostNumber.toFixed(2),
    videoSeconds,
    modelCount,
  };
}
