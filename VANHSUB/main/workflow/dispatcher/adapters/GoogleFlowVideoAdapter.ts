import type { NodeAdapter, NodeExecutionContext, NodeResult } from '../types';
import { GoogleVeoSessionManager } from '../../../veo/GoogleVeoSessionManager';
import { GoogleFlowBrowserMutex } from '../GoogleFlowBrowserMutex';

/**
 * Adapter cho tác vụ sinh video qua Google Flow Browser Automation.
 * - Wrap GoogleVeoSessionManager.generateVideoViaBrowserContext
 * - Quản lý retry nội bộ, dừng ngay khi hết credit ('out_of_credits').
 * - Bắt buộc acquire GoogleFlowBrowserMutex trước khi thao tác lên cửa sổ Google Flow dùng chung.
 */
export class GoogleFlowVideoAdapter implements NodeAdapter {
  readonly usesSharedBrowser = true;
  private readonly maxInternalRetries: number;
  private readonly initialBackoffMs: number;

  constructor(maxInternalRetries = 1, initialBackoffMs = 2000) {
    this.maxInternalRetries = maxInternalRetries;
    this.initialBackoffMs = initialBackoffMs;
  }

  async execute(nodeConfig: any, context: NodeExecutionContext): Promise<NodeResult> {
    const sessionMgr = GoogleVeoSessionManager.getInstance();
    const sessionStatus = sessionMgr.getStatus();
    const accountEmail = sessionStatus.email || 'unknown';

    if (sessionStatus.sessionStatus === 'out_of_credits') {
      return {
        status: 'failed',
        output: { success: false, error: 'out_of_credits' },
        errorType: 'out_of_credits',
        errorDetail: 'Tài khoản Google Flow đã hết tín dụng.',
        metadata: { accountEmail, iteration: context.iteration },
      };
    }

    const prompt = nodeConfig.prompt || context.inputs?.prompt || context.inputs?.text || '';
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return {
        status: 'failed',
        output: { success: false, error: 'empty_prompt' },
        errorType: 'empty_prompt',
        errorDetail: 'Node tạo video không có nội dung prompt hợp lệ.',
        metadata: { accountEmail, iteration: context.iteration },
      };
    }

    const aspectRatio = nodeConfig.aspectRatio || context.inputs?.aspectRatio || '16:9';
    const durationSeconds = nodeConfig.durationSeconds || context.inputs?.durationSeconds || 5;
    const modelVariant = nodeConfig.modelVariant || context.inputs?.modelVariant || 'veo-3.1-quality';
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
            return await sessionMgr.generateVideoViaBrowserContext(
              {
                prompt: prompt.trim(),
                aspectRatio,
                durationSeconds,
                modelVariant,
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

        if (result && (result.videoUrl || result.base64Data)) {
          return {
            status: 'success',
            output: {
              success: true,
              videoUrl: result.videoUrl,
              base64Data: result.base64Data,
              prompt: prompt.trim(),
              aspectRatio,
              durationSeconds,
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

        if (result?.error === 'out_of_credits') {
          return {
            status: 'failed',
            output: { success: false, error: 'out_of_credits' },
            errorType: 'out_of_credits',
            errorDetail: 'Tài khoản Google Flow đã hết tín dụng tạo video.',
            metadata: { accountEmail, durationMs: Date.now() - startTime, retryCount },
          };
        }

        const errorType = result?.error || 'video_generation_timeout';
        if (retryCount < this.maxInternalRetries) {
          retryCount++;
          const waitTime = this.initialBackoffMs * Math.pow(2, retryCount - 1);
          console.log(
            `[GoogleFlowVideoAdapter] Gặp lỗi (${errorType}). Thử lại lần ${retryCount}/${this.maxInternalRetries} sau ${waitTime}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }

        return {
          status: 'failed',
          output: { success: false, error: errorType },
          errorType,
          errorDetail: `Tạo video thất bại sau ${retryCount} lần thử lại.`,
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
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }

        return {
          status: 'failed',
          output: { success: false, error: 'adapter_exception' },
          errorType: 'adapter_exception',
          errorDetail: err?.message || 'Lỗi ngoại lệ trong adapter sinh video.',
          metadata: { accountEmail, durationMs: Date.now() - startTime, retryCount },
        };
      }
    }

    return {
      status: 'failed',
      output: { success: false },
      errorType: 'unknown_failure',
      errorDetail: 'Không thể sinh video từ Google Flow.',
      metadata: { accountEmail, durationMs: Date.now() - startTime },
    };
  }
}
