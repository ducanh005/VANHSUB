import {
  ClassifiedError,
  FlowStateContext,
  RetryConfig,
} from './types';

export interface RetryDecision {
  shouldRetry: boolean;
  attempt: number;
  delayMs: number;
  reason: string;
  skipToState?: string;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 2000,
  maxDelayMs: 15000,
  backoffFactor: 2.0,
  jitterRatio: 0.2, // +-20% jitter
};

/**
 * FlowRetryManager: Quản lý chiến lược thử lại (Retry Policy) và Exponential Backoff có Jitter
 * Đảm bảo:
 * 1. Ngăn chặn thundering herd qua Full Jitter.
 * 2. Bảo vệ Idempotency: Không bao giờ retry bằng cách gửi lại click Generate nếu generation đã in-flight.
 * 3. Giới hạn số lần thử lại tối đa để không bao giờ treo vô hạn.
 */
export class FlowRetryManager {
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * Tính toán thời gian backoff có Jitter dựa trên số lần thử (attempt) và mã lỗi
   */
  public calculateBackoff(
    attempt: number,
    classified?: ClassifiedError,
    customConfig?: Partial<RetryConfig>
  ): number {
    const cfg = { ...this.config, ...customConfig };
    const safeAttempt = Math.max(1, attempt);

    // 1. Exponential delay: baseDelay * (backoffFactor ^ (attempt - 1))
    let expDelay = cfg.baseDelayMs * Math.pow(cfg.backoffFactor, safeAttempt - 1);

    // 2. Tôn trọng recommendedDelayMs từ Error Classifier (ví dụ rate limit 429 Retry-After)
    if (classified?.recommendedDelayMs && classified.recommendedDelayMs > expDelay) {
      expDelay = classified.recommendedDelayMs;
    }

    // 3. Giới hạn trần maxDelayMs
    const cappedDelay = Math.min(cfg.maxDelayMs, expDelay);

    // 4. Áp dụng Full Jitter (+- jitterRatio)
    // multiplier nằm trong khoảng [1 - jitterRatio, 1 + jitterRatio]
    const jitterMultiplier = 1 - cfg.jitterRatio + Math.random() * (2 * cfg.jitterRatio);
    const finalDelay = Math.round(cappedDelay * jitterMultiplier);

    return Math.max(500, finalDelay);
  }

  /**
   * Đưa ra quyết định có nên retry hay không dựa trên phân loại lỗi, attempt, và state hiện tại
   */
  public evaluate(
    classified: ClassifiedError,
    attempt: number,
    stateName: string,
    ctx: FlowStateContext,
    customConfig?: Partial<RetryConfig>
  ): RetryDecision {
    const cfg = { ...this.config, ...customConfig };

    // 1. Kiểm tra nếu tác vụ đã bị huỷ
    if (ctx.isCancelled?.()) {
      return {
        shouldRetry: false,
        attempt,
        delayMs: 0,
        reason: 'Tác vụ đã bị người dùng huỷ bỏ',
      };
    }

    // 2. Kiểm tra nhóm lỗi (chỉ RETRYABLE mới được thử lại)
    if (classified.category !== 'RETRYABLE') {
      return {
        shouldRetry: false,
        attempt,
        delayMs: 0,
        reason: `Lỗi thuộc nhóm không thể thử lại [${classified.category} - ${classified.code}]: ${classified.message}`,
      };
    }

    // 3. Kiểm tra số lần thử lại tối đa
    if (attempt >= cfg.maxRetries) {
      return {
        shouldRetry: false,
        attempt,
        delayMs: 0,
        reason: `Đã vượt quá số lần thử lại tối đa (${cfg.maxRetries}) cho state [${stateName}]`,
      };
    }

    // 4. KIỂM TRA BẢO VỆ IDEMPOTENCY CHO CÁC STATE SINH ẢNH
    // Nếu lỗi xảy ra tại CLICK_GENERATE hoặc VERIFY_GENERATION_STARTED,
    // phải kiểm tra xem có dấu hiệu prompt đã gửi đi chưa. Nếu prompt đã gửi hoặc đang có spinner,
    // TUYỆT ĐỐI KHÔNG CLICK LẠI, mà phải nhảy thẳng sang WAIT_FOR_GENERATION!
    if (stateName === 'CLICK_GENERATE' || stateName === 'VERIFY_GENERATION_STARTED') {
      if (ctx.generateClickedAt > 0 || ctx.generationState === 'STARTING' || ctx.generationState === 'GENERATING') {
        console.warn(
          `[FlowRetryManager] [${ctx.taskId}] ⚠️ IDEMPOTENCY GUARD TRONG RETRY: State [${stateName}] thất bại nhưng generation có thể đã khởi động (clickedAt=${ctx.generateClickedAt}, state=${ctx.generationState}). Chuyển hướng sang WAIT_FOR_GENERATION thay vì click lại!`
        );
        return {
          shouldRetry: true,
          attempt: attempt + 1,
          delayMs: 1500,
          skipToState: 'WAIT_FOR_GENERATION',
          reason: 'Bỏ qua click trùng lặp, chuyển sang chờ kết quả theo quy tắc Idempotency',
        };
      }
    }

    // 5. Chấp nhận retry với Exponential Backoff + Jitter
    const nextAttempt = attempt + 1;
    const delayMs = this.calculateBackoff(nextAttempt, classified, cfg);

    return {
      shouldRetry: true,
      attempt: nextAttempt,
      delayMs,
      reason: `Cho phép thử lại lần ${nextAttempt}/${cfg.maxRetries} cho [${stateName}] sau ${delayMs}ms do lỗi [${classified.code}]`,
    };
  }

  /**
   * Chờ delay với khả năng huỷ sớm nếu tác vụ bị cancel
   */
  public async waitDelay(delayMs: number, ctx: FlowStateContext): Promise<boolean> {
    const stepMs = 200;
    let waitedMs = 0;
    while (waitedMs < delayMs) {
      if (ctx.isCancelled?.()) return false;
      const sleepSlice = Math.min(stepMs, delayMs - waitedMs);
      await new Promise((r) => setTimeout(r, sleepSlice));
      waitedMs += sleepSlice;
    }
    return !ctx.isCancelled?.();
  }
}
