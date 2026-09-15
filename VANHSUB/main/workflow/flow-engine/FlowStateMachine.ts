import type {
  FlowAutomationState,
  FlowStateContext,
  FlowAutomationResult,
  ActionResult,
  StateExecutionRecord,
} from './types';

/**
 * FlowStateMachine: Máy trạng thái hữu hạn điều phối tự động hóa Google Flow
 * - Thực thi các State tuần tự theo đúng quy chuẩn: enter() -> execute() -> verify() -> exit()
 * - Đảm bảo nguyên tắc cốt lõi: Hành động không bao giờ được coi là thành công chỉ vì không throw lỗi;
 *   bắt buộc phải qua verify() để xác nhận UI DOM thực tế đã thay đổi như kỳ vọng.
 * - Hỗ trợ Idempotency Jump (skipToState) khi phát hiện generation đã bắt đầu từ trước.
 * - Structured logging chuẩn cho từng mốc trạng thái với taskId và generationAttemptId.
 */
export class FlowStateMachine {
  private states: FlowAutomationState[];

  constructor(states: FlowAutomationState[]) {
    this.states = states;
  }

  /**
   * Chạy máy trạng thái từ đầu tới cuối hoặc cho tới khi gặp lỗi/skip.
   */
  public async run(ctx: FlowStateContext): Promise<FlowAutomationResult> {
    const overallStartTime = Date.now();
    console.log(
      `[FlowStateMachine] 🚀 Khởi chạy State Machine cho tác vụ ${ctx.mode.toUpperCase()}: taskId=${ctx.taskId}, attempt=${ctx.generationAttemptId}`
    );

    let currentIndex = 0;

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

          // 3. XỬ LÝ IDEMPOTENCY JUMP (NẾU ĐƯỢC YÊU CẦU)
          if (actionRes.skipToState) {
            const targetName = actionRes.skipToState;
            const targetIdx = this.states.findIndex((s) => s.name === targetName);
            if (targetIdx > currentIndex) {
              console.log(
                `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🔀 IDEMPOTENCY JUMP: Nhảy từ [${state.name}] thẳng sang [${targetName}] (bỏ qua ${targetIdx - currentIndex - 1} states trung gian)`
              );
              stateRecord.exitedAt = Date.now();
              stateRecord.durationMs = stateRecord.exitedAt - stateRecord.enteredAt;
              stateRecord.metadata = { skippedTo: targetName };
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

          // 4. VERIFY-AFTER-ACTION (BẮT BUỘC)
          console.log(`[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] 🔍 VERIFY [${state.name}]...`);
          const verified = await this.withTimeout(
            state.verify(ctx, actionRes),
            state.timeoutMs,
            `${state.name} verify`
          );

          if (!verified) {
            throw new Error(
              `[VERIFY_FAILED] Kiểm tra trạng thái UI sau hành động tại [${state.name}] không đạt yêu cầu!`
            );
          }
          console.log(
            `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ✅ VERIFY [${state.name}]: ĐẠT CHUẨN`
          );

          // 5. EXIT
          await this.withTimeout(state.exit(ctx), state.timeoutMs, `${state.name} exit`);

          stateRecord.exitedAt = Date.now();
          stateRecord.durationMs = stateRecord.exitedAt - stateRecord.enteredAt;
          ctx.stateHistory.push(stateRecord);

          currentIndex++;
        } catch (stateErr: any) {
          stateRecord.exitedAt = Date.now();
          stateRecord.durationMs = stateRecord.exitedAt - stateRecord.enteredAt;
          stateRecord.status = 'failed';
          stateRecord.error = stateErr?.message || String(stateErr);
          ctx.stateHistory.push(stateRecord);
          ctx.generationState = 'FAILED';

          console.error(
            `[FlowStateMachine] [${ctx.taskId}#${ctx.generationAttemptId}] ❌ THẤT BẠI TẠI STATE [${state.name}]:`,
            stateErr?.message || stateErr
          );

          return {
            ok: false,
            generationState: 'FAILED',
            error: stateRecord.error,
            errorDetail: stateErr?.message,
            stateHistory: ctx.stateHistory,
            durationMs: Date.now() - overallStartTime,
          };
        }
      }

      ctx.generationState = 'COMPLETED';
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
