import type { NodeAdapter, NodeExecutionContext, NodeResult } from '../types';
import { GoogleVeoSessionManager } from '../../../veo/GoogleVeoSessionManager';
import { GoogleFlowBrowserMutex } from '../GoogleFlowBrowserMutex';

/**
 * Adapter mỏng (translation layer) cho tác vụ sinh ảnh qua Google Flow Browser Automation.
 * - Gọi GoogleVeoSessionManager để tạo ảnh.
 * - Tự quản lý retry nội bộ với backoff khi gặp lỗi tạm thời (DOM/nút bấm).
 * - Dừng ngay lập tức, không retry khi phát hiện hết credit ('out_of_credits').
 * - Bắt buộc acquire GoogleFlowBrowserMutex trước khi thao tác lên cửa sổ Google Flow dùng chung.
 * - Wrap kết quả về NodeResult chuẩn hoá.
 */
export class GoogleFlowImageAdapter implements NodeAdapter {
  readonly usesSharedBrowser = true;
  private readonly maxInternalRetries: number;
  private readonly initialBackoffMs: number;

  constructor(maxInternalRetries = 2, initialBackoffMs = 1500) {
    this.maxInternalRetries = maxInternalRetries;
    this.initialBackoffMs = initialBackoffMs;
  }

  async execute(nodeConfig: any, context: NodeExecutionContext): Promise<NodeResult> {
    const sessionMgr = GoogleVeoSessionManager.getInstance();
    const sessionStatus = sessionMgr.getStatus();
    const accountEmail = sessionStatus.email || 'unknown';

    // 1. Kiểm tra sớm nếu session đã biết là hết credit
    if (sessionStatus.sessionStatus === 'out_of_credits') {
      return {
        status: 'failed',
        output: { success: false, error: 'out_of_credits' },
        errorType: 'out_of_credits',
        errorDetail: 'Tài khoản Google Flow đã hết tín dụng.',
        metadata: {
          accountEmail,
          iteration: context.iteration,
        },
      };
    }

    // 2. Resolve prompt từ nodeConfig hoặc inputs truyền từ node trước
    const prompt = nodeConfig.prompt || context.inputs?.prompt || context.inputs?.text || '';
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return {
        status: 'failed',
        output: { success: false, error: 'empty_prompt' },
        errorType: 'empty_prompt',
        errorDetail: 'Node tạo ảnh không có nội dung prompt hợp lệ.',
        metadata: { accountEmail, iteration: context.iteration },
      };
    }

    const aspectRatio = nodeConfig.aspectRatio || context.inputs?.aspectRatio || '16:9';
    const outputCount = nodeConfig.outputCount || 1;

    let retryCount = 0;
    const startTime = Date.now();

    while (retryCount <= this.maxInternalRetries) {
      if (context.isCancelled?.()) {
        return {
          status: 'failed',
          output: { success: false, cancelled: true },
          errorType: 'cancelled',
          errorDetail: 'Tác vụ đã bị người dùng huỷ bỏ.',
          metadata: { accountEmail, retryCount },
        };
      }

      try {
        const targetProjectId = nodeConfig.projectId || context.inputs?.projectId;

        const result = await GoogleFlowBrowserMutex.getInstance().runExclusive(
          async () => {
            return await sessionMgr.generateImageViaBrowserContext(
              {
                prompt: prompt.trim(),
                aspectRatio,
                outputCount,
                projectId: targetProjectId,
              },
              (percent, msg) => {
                context.onProgress?.(percent, msg);
              },
              context.isCancelled
            );
          },
          `${context.nodeId}#${context.iteration}`
        );

        // Trường hợp thành công
        if (result && (result.imageUrl || result.base64Data)) {
          return {
            status: 'success',
            output: {
              success: true,
              imageUrl: result.imageUrl,
              base64Data: result.base64Data,
              prompt: prompt.trim(),
              aspectRatio,
              projectId: result.projectId || targetProjectId,
            },
            metadata: {
              accountEmail,
              durationMs: Date.now() - startTime,
              retryCount,
              iteration: context.iteration,
            },
          };
        }

        // Trường hợp lỗi Tác nhân (Agent Error): Dừng ngay lập tức, không retry dồn dập
        if (result?.error === 'agent_error') {
          return {
            status: 'failed',
            output: { success: false, error: 'agent_error', errorDetail: result.errorDetail },
            errorType: 'agent_error',
            errorDetail: result.errorDetail || 'Tác nhân Google Flow đã gặp sự cố (Creative Agent Error).',
            metadata: { accountEmail, durationMs: Date.now() - startTime, retryCount },
          };
        }

        // Trường hợp hết credit: Dừng ngay lập tức, tuyệt đối KHÔNG retry
        if (result?.error === 'out_of_credits') {
          return {
            status: 'failed',
            output: { success: false, error: 'out_of_credits' },
            errorType: 'out_of_credits',
            errorDetail: 'Tài khoản Google Flow đã hết tín dụng (out of credits).',
            metadata: { accountEmail, durationMs: Date.now() - startTime, retryCount },
          };
        }

        // Trường hợp lỗi có thể thử lại (DOM chưa sẵn sàng, nút chưa hiển thị)
        const errorType = result?.error || 'generation_timeout';
        if (retryCount < this.maxInternalRetries) {
          retryCount++;
          const waitTime = this.initialBackoffMs * Math.pow(2, retryCount - 1);
          console.log(
            `[GoogleFlowImageAdapter] Gặp lỗi tạm thời (${errorType}). Thử lại lần ${retryCount}/${this.maxInternalRetries} sau ${waitTime}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }

        return {
          status: 'failed',
          output: { success: false, error: errorType },
          errorType,
          errorDetail: `Tạo ảnh thất bại sau ${retryCount} lần thử lại trên trình duyệt.`,
          metadata: { accountEmail, durationMs: Date.now() - startTime, retryCount },
        };
      } catch (err: any) {
        if (context.isCancelled?.()) {
          return {
            status: 'failed',
            output: { success: false, cancelled: true },
            errorType: 'cancelled',
            errorDetail: 'Tác vụ đã bị huỷ bỏ.',
          };
        }

        if (retryCount < this.maxInternalRetries) {
          retryCount++;
          const waitTime = this.initialBackoffMs * Math.pow(2, retryCount - 1);
          console.warn(`[GoogleFlowImageAdapter] Ngoại lệ: ${err?.message}. Đang thử lại...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }

        return {
          status: 'failed',
          output: { success: false, error: 'adapter_exception' },
          errorType: 'adapter_exception',
          errorDetail: err?.message || 'Lỗi ngoại lệ trong adapter sinh ảnh.',
          metadata: { accountEmail, durationMs: Date.now() - startTime, retryCount },
        };
      }
    }

    return {
      status: 'failed',
      output: { success: false },
      errorType: 'unknown_failure',
      errorDetail: 'Không thể sinh ảnh từ Google Flow.',
      metadata: { accountEmail, durationMs: Date.now() - startTime },
    };
  }
}
