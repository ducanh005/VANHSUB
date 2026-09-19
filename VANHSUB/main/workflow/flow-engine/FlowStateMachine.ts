import type {
  FlowAutomationState,
  FlowStateContext,
  FlowAutomationResult,
  ActionResult,
  StateExecutionRecord,
  RetryConfig,
} from './types';
import { FlowRecoveryManager, FlowRecoveryErrorType } from './FlowRecoveryManager';
import { FlowErrorClassifier } from './FlowErrorClassifier';
import { FlowRetryManager } from './FlowRetryManager';
import { FlowCheckpointManager } from './FlowCheckpointManager';

/**
 * FlowStateMachine: Máy trạng thái hữu hạn điều phối tự động hóa Google Flow
 * - Thực thi các State tuần tự theo đúng quy chuẩn: enter() -> execute() -> verify() -> exit()
 * - Đảm bảo nguyên tắc cốt lõi: Hành động không bao giờ được coi là thành công chỉ vì không throw lỗi;
 *   bắt buộc phải qua verify() để xác nhận UI DOM thực tế đã thay đổi như kỳ vọng.
 * - Hỗ trợ Idempotency Jump (skipToState) khi phát hiện generation đã bắt đầu từ trước.
 * - Tích hợp FlowRecoveryManager (DOM healing) và FlowRetryManager (Exponential Backoff + Jitter).
 * - Structured logging chuẩn cho từng mốc trạng thái với taskId và generationAttemptId.
 */
export class FlowStateMachine {
  private states: FlowAutomationState[];
  private retryManager: FlowRetryManager;

  constructor(states: FlowAutomationState[], retryConfig?: Partial<RetryConfig>) {
    this.states = states;
    this.retryManager = new FlowRetryManager(retryConfig);
  }

  /**
   * Chạy máy trạng thái từ đầu tới cuối hoặc cho tới khi gặp lỗi/skip.
   */
  public async run(ctx: FlowStateContext, initialStateName?: string): Promise<FlowAutomationResult> {
    const overallStartTime = Date.now();
    ctx.stateHistory = ctx.stateHistory || [];
    console.log(
      `[FlowStateMachine] 🚀 Khởi chạy State Machine cho tác vụ ${ctx.mode.toUpperCase()}: taskId=${ctx.taskId}, attempt=${ctx.generationAttemptId}`
    );

    let currentIndex = 0;
    if (initialStateName) {
      const startIdx = this.states.findIndex((s) => s.name === initialStateName);
      if (startIdx > 0) {
        currentIndex = startIdx;
        console.log(
          `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🔀 RESUME: Bắt đầu từ state [${initialStateName}] (index ${currentIndex}/${this.states.length})`
        );
      }
    }

    let recoveryAttemptsForCurrentState = 0;
    let retryAttemptsForCurrentState = 0;

    try {
      while (currentIndex < this.states.length) {
        if (ctx.isCancelled?.()) {
          console.warn(`[FlowStateMachine] ⚠️ Tác vụ đã bị huỷ bởi người dùng tại state index ${currentIndex}.`);
          ctx.generationState = 'FAILED';
          return {
            ok: false,
            generationState: 'FAILED',
            error: 'cancelled',
            errorDetail: 'Tác vụ đã bị huỷ bởi người dùng.',
            stateHistory: ctx.stateHistory,
            durationMs: Date.now() - overallStartTime,
          };
        }

        const state = this.states[currentIndex];
        const stateRecord: StateExecutionRecord = {
          stateName: state.name,
          enteredAt: Date.now(),
          status: 'success',
        };

        console.log(
          `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] [STATE ${currentIndex + 1}/${this.states.length}] ──▶ ENTER [${state.name}] (timeout: ${state.timeoutMs}ms)`
        );

        try {
          // 1. ENTER
          await this.withTimeout(state.enter(ctx), state.timeoutMs, `${state.name} enter`);

          // 2. EXECUTE
          console.log(`[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ⚙️ EXECUTE [${state.name}]...`);
          const actionRes: ActionResult = await this.withTimeout(
            state.execute(ctx),
            state.timeoutMs,
            `${state.name} execute`
          );

          if (!actionRes.ok && !actionRes.skipToState) {
            throw new Error(
              actionRes.errorDetail || actionRes.error || `Thực thi thất bại tại state ${state.name}`
            );
          }

          // 3. VERIFY-AFTER-ACTION (BẮT BUỘC)
          console.log(`[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🔍 VERIFY [${state.name}]...`);
          const rawVerify = await this.withTimeout(
            state.verify(ctx, actionRes),
            state.timeoutMs,
            `${state.name} verify`
          );

          const isOk = typeof rawVerify === 'boolean' ? rawVerify : Boolean(rawVerify?.ok);
          const criteria = typeof rawVerify === 'object' && rawVerify ? rawVerify.criteria : undefined;

          if (!isOk) {
            const failReason =
              typeof rawVerify === 'object'
                ? rawVerify?.reason || rawVerify?.errorDetail || rawVerify?.error
                : undefined;
            throw new Error(
              `[VERIFY_FAILED] Kiểm tra trạng thái UI sau hành động tại [${state.name}] không đạt yêu cầu! ${failReason ? `Chi tiết: ${failReason}` : ''}`
            );
          }

          if (criteria) {
            console.log(
              `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ✅ VERIFY [${state.name}]: ĐẠT CHUẨN ->`,
              JSON.stringify(criteria)
            );
          } else {
            console.log(
              `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ✅ VERIFY [${state.name}]: ĐẠT CHUẨN`
            );
          }

          // 4. XỬ LÝ IDEMPOTENCY JUMP (NẾU ĐƯỢC YÊU CẦU)
          if (actionRes.skipToState) {
            const targetName = actionRes.skipToState;
            const targetIdx = this.states.findIndex((s) => s.name === targetName);
            if (targetIdx > currentIndex) {
              console.log(
                `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🔀 IDEMPOTENCY JUMP: Nhảy từ [${state.name}] thẳng sang [${targetName}] (bỏ qua ${targetIdx - currentIndex - 1} states trung gian)`
              );
              stateRecord.exitedAt = Date.now();
              stateRecord.durationMs = stateRecord.exitedAt - stateRecord.enteredAt;
              stateRecord.metadata = { skippedTo: targetName, criteria };
              ctx.stateHistory.push(stateRecord);

              // Đánh dấu các state bị bỏ qua trong lịch sử
              for (let skipped = currentIndex + 1; skipped < targetIdx; skipped++) {
                ctx.stateHistory.push({
                  stateName: this.states[skipped].name,
                  enteredAt: Date.now(),
                  exitedAt: Date.now(),
                  durationMs: 0,
                  status: 'skipped',
                  metadata: { reason: `Idempotency jump from ${state.name} to ${targetName}` },
                });
              }

              currentIndex = targetIdx;
              continue;
            }
          }

          // 5. EXIT
          await this.withTimeout(state.exit(ctx), state.timeoutMs, `${state.name} exit`);

          stateRecord.exitedAt = Date.now();
          stateRecord.durationMs = stateRecord.exitedAt - stateRecord.enteredAt;
          if (retryAttemptsForCurrentState > 0) {
            stateRecord.retryCount = retryAttemptsForCurrentState;
          }
          ctx.stateHistory.push(stateRecord);

          // 6. Ghi Checkpoint nếu có taskId và stage tương ứng
          if (ctx.taskId) {
            const stage = FlowCheckpointManager.mapStateToStage(state.name);
            if (stage) {
              try {
                const cp = FlowCheckpointManager.createFromContext(ctx, stage, state.name);
                await FlowCheckpointManager.getInstance().saveCheckpoint(cp);
              } catch (cpErr) {
                console.warn(`[FlowStateMachine] Cảnh báo lưu checkpoint cho state [${state.name}]:`, cpErr);
              }
            }
          }

          currentIndex++;
          recoveryAttemptsForCurrentState = 0;
          retryAttemptsForCurrentState = 0;
        } catch (stateErr: any) {
          const errMsg = (stateErr?.message || String(stateErr)).toLowerCase();
          let errType: FlowRecoveryErrorType = 'UNKNOWN_STATE';
          const isDomObscured =
            errMsg.includes('obscured') ||
            errMsg.includes('element_obscured') ||
            errMsg.includes('bị che') ||
            errMsg.includes('che phủ') ||
            errMsg.includes('backdrop') ||
            errMsg.includes('dialog') ||
            errMsg.includes('credit-cost') ||
            errMsg.includes('cost-label');

          if (isDomObscured) {
            errType = 'OVERLAY_BLOCKING';
          } else if (
            errMsg.includes('not found') ||
            errMsg.includes('không tìm thấy') ||
            errMsg.includes('element_not_found')
          ) {
            errType = 'ELEMENT_NOT_FOUND';
          } else if (
            // Tuyệt đối không match substring đơn lẻ như 'credit' hay 'about' (tránh bắt nhầm CSS class / debug text)
            // Chỉ coi là SESSION_EXPIRED khi có thông điệp thực sự về phiên đăng nhập hoặc hết credit từ Flow
            (
              errMsg.includes('session_expired') ||
              errMsg.includes('session expired') ||
              errMsg.includes('hết hạn phiên') ||
              errMsg.includes('chưa xác thực phiên') ||
              errMsg.includes('hết tín dụng') ||
              errMsg.includes('hết credit') ||
              errMsg.includes('không đủ credit') ||
              errMsg.includes('bạn đã hết credit') ||
              errMsg.includes('out of credits') ||
              errMsg.includes('insufficient credits') ||
              errMsg.includes('reauth_required')
            )
          ) {
            errType = 'SESSION_EXPIRED';
          }

          // 1. Cấp độ 1: Thử phục hồi DOM tại chỗ (FlowRecoveryManager) tối đa 1 lần/state
          if (recoveryAttemptsForCurrentState === 0 && ctx.win && !ctx.win.isDestroyed()) {
            console.log(
              `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🛠️ Kích hoạt FlowRecoveryManager cho lỗi [${errType}] tại state [${state.name}]...`
            );
            const recRes = await FlowRecoveryManager.handleRecovery(ctx.win, errType, ctx);
            if (recRes.recovered) {
              console.log(
                `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🔄 Phục hồi thành công (${recRes.actionTaken}). Thử lại state [${state.name}]...`
              );
              recoveryAttemptsForCurrentState++;
              continue;
            }
          }

          // 2. Cấp độ 2: Phân loại lỗi tập trung (FlowErrorClassifier)
          const classified = FlowErrorClassifier.classify(stateErr, ctx);
          console.warn(
            `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🏷️ Phân loại lỗi [${state.name}]: category=${classified.category}, code=${classified.code} (${classified.message})`
          );

          // 3. Cấp độ 3: Đánh giá và thực thi Retry (FlowRetryManager)
          const retryDecision = this.retryManager.evaluate(
            classified,
            retryAttemptsForCurrentState,
            state.name,
            ctx
          );

          // 3a. Xử lý Idempotency Jump trong Retry (nếu phát hiện generation đã chạy)
          if (retryDecision.skipToState) {
            const targetName = retryDecision.skipToState;
            const targetIdx = this.states.findIndex((s) => s.name === targetName);
            if (targetIdx > currentIndex) {
              console.log(
                `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🔀 IDEMPOTENCY JUMP (từ Retry Guard): Nhảy sang [${targetName}] để chống click Generate trùng lặp!`
              );
              stateRecord.exitedAt = Date.now();
              stateRecord.durationMs = stateRecord.exitedAt - stateRecord.enteredAt;
              stateRecord.metadata = { skippedTo: targetName, reason: retryDecision.reason };
              ctx.stateHistory.push(stateRecord);

              currentIndex = targetIdx;
              recoveryAttemptsForCurrentState = 0;
              retryAttemptsForCurrentState = 0;
              continue;
            }
          }

          // 3b. Thực hiện Retry với Exponential Backoff + Jitter
          if (retryDecision.shouldRetry) {
            retryAttemptsForCurrentState = retryDecision.attempt;
            console.log(
              `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🔄 RETRY [${state.name}] lần ${retryDecision.attempt} sau ${retryDecision.delayMs}ms. Lý do: ${retryDecision.reason}`
            );
            ctx.onProgress?.(
              undefined as any,
              `Sự cố tạm thời (${classified.code}). Đang thử lại lần ${retryDecision.attempt} sau ${Math.round(retryDecision.delayMs / 1000)}s...`
            );

            const notCancelled = await this.retryManager.waitDelay(retryDecision.delayMs, ctx);
            if (notCancelled) {
              recoveryAttemptsForCurrentState = 0;
              continue;
            }
          }

          // 4. Nếu không thể retry (NON_RETRYABLE, FATAL, hoặc đã hết lượt retry)
          stateRecord.exitedAt = Date.now();
          stateRecord.durationMs = stateRecord.exitedAt - stateRecord.enteredAt;
          stateRecord.status = 'failed';
          stateRecord.error = classified.code;
          stateRecord.retryCount = retryAttemptsForCurrentState;
          stateRecord.metadata = { classified, failReason: retryDecision.reason };
          ctx.stateHistory.push(stateRecord);
          ctx.generationState = 'FAILED';

          console.error(
            `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ❌ THẤT BẠI TẠI STATE [${state.name}] (Không thể retry): ${classified.code} - ${classified.message}`
          );

          return {
            ok: false,
            generationState: 'FAILED',
            error: classified.code,
            errorDetail: classified.message,
            classifiedErrorCode: classified.code,
            stateHistory: ctx.stateHistory,
            durationMs: Date.now() - overallStartTime,
          };
        }
      }

      ctx.generationState = 'COMPLETED';
      if (ctx.taskId) {
        try {
          const cp = FlowCheckpointManager.createFromContext(ctx, 'COMPLETED', 'COMPLETE');
          await FlowCheckpointManager.getInstance().saveCheckpoint(cp);
        } catch {}
      }

      console.log(
        `[FlowStateMachine] 🎉 Hoàn tất toàn bộ State Machine thành công sau ${Date.now() - overallStartTime}ms!`
      );

      return {
        ok: true,
        generationState: 'COMPLETED',
        imageUrl: ctx.result?.imageUrl,
        videoUrl: ctx.result?.videoUrl,
        base64Data: ctx.result?.base64Data,
        projectId: ctx.result?.projectId || ctx.activeProjectId,
        stateHistory: ctx.stateHistory,
        durationMs: Date.now() - overallStartTime,
      };
    } finally {
      // Dọn dẹp an toàn các tài nguyên tạm (network listener)
      this.cleanup(ctx);
    }
  }

  /**
   * Bọc Promise trong timeout để đảm bảo không một state nào có thể làm treo app
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Quá thời gian chờ (${timeoutMs}ms) tại bước: ${label}`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }

  /**
   * Dọn dẹp an toàn network listener sau khi xong hoặc khi crash
   */
  private cleanup(ctx: FlowStateContext): void {
    try {
      if (ctx.netFilterAttached && ctx.onResponseStartedHandler) {
        const electron = require('electron');
        const ses = electron.session?.fromPartition?.('persist:google_veo');
        if (ses?.webRequest?.onResponseStarted) {
          ses.webRequest.onResponseStarted({ urls: ['*://*/*'] }, null as any);
        }
        ctx.netFilterAttached = false;
      }
    } catch {}
  }
}
