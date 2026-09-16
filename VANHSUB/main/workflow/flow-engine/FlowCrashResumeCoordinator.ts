import { FlowCheckpointManager } from './FlowCheckpointManager';
import { FlowStateMachine } from './FlowStateMachine';
import type {
  FlowTask,
  FlowCheckpoint,
  FlowResumePlan,
  FlowResumeStrategy,
  FlowStateContext,
  FlowAutomationState,
  FlowAutomationResult,
} from './types';

/**
 * FlowCrashResumeCoordinator: Điều phối phục hồi sau sự cố (Crash Resume) cho Google Flow Engine.
 * 
 * NGUYÊN TẮC THIẾT KẾ VÀ TIÊU CHUẨN KỸ THUẬT:
 * 1. Lá chắn Lũy đẳng (Idempotency Shield):
 *    Nếu checkpoint ghi nhận đã bấm nút Generate ('GENERATE_CLICKED' hoặc 'GENERATING'),
 *    bộ điều phối lập tức chỉ định chiến lược 'JUMP_TO_WAIT', nhảy cóc qua toàn bộ 14 bước trước
 *    và cấm tiệt việc click lại nút Generate, tránh lãng phí credit và sinh trùng lặp.
 * 2. Tái sử dụng ngữ cảnh (Context Reuse):
 *    Nếu project đã được tạo ở phiên trước ('PROJECT_CREATED', 'CANVAS_CLEANED'...),
 *    bộ điều phối tái sử dụng trực tiếp projectId và projectUrl, tránh tạo thêm project rác.
 * 3. Đồng bộ Baseline URLs:
 *    Phục hồi danh sách baseline URLs từ checkpoint để thuật toán phát hiện ảnh/video mới
 *    so sánh chuẩn xác 100%.
 */
export class FlowCrashResumeCoordinator {
  /**
   * Phân tích trạng thái và checkpoint để lập kế hoạch phục hồi tối ưu.
   */
  static evaluateResumePlan(
    task: FlowTask,
    customCheckpoint?: FlowCheckpoint | null
  ): FlowResumePlan {
    const cpManager = FlowCheckpointManager.getInstance();
    const checkpoint = customCheckpoint !== undefined
      ? customCheckpoint
      : cpManager.getLatestCheckpoint(task.id);

    // 1. Trường hợp không có checkpoint hoặc stage là INIT
    if (!checkpoint || checkpoint.stage === 'INIT') {
      return {
        taskId: task.id,
        strategy: 'FRESH_START',
        checkpoint: null,
        startStateName: 'OPEN_FLOW',
        baselineUrls: [],
        reason: 'Không có checkpoint hợp lệ hoặc tác vụ mới ở mốc khởi tạo ban đầu. Chạy lại từ đầu.',
      };
    }

    const baselineUrls = checkpoint.baselineUrls || [];
    const projectId = checkpoint.projectId;
    const projectUrl = checkpoint.projectUrl;

    // 2. Trường hợp đã hoàn tất (COMPLETED)
    if (checkpoint.stage === 'COMPLETED') {
      return {
        taskId: task.id,
        strategy: 'ALREADY_COMPLETED',
        checkpoint,
        startStateName: 'EXTRACT_OUTPUT',
        projectId,
        projectUrl,
        baselineUrls,
        reason: 'Tác vụ đã sinh thành công ở phiên trước. Bỏ qua pipeline và thu hoạch kết quả.',
      };
    }

    // 3. Trường hợp ĐÃ BẤM GENERATE HOẶC ĐANG RENDER (GENERATE_CLICKED / GENERATING)
    // ĐÂY LÀ ĐIỂM QUAN TRỌNG NHẤT: BẢO VỆ TÍNH LŨY ĐẲNG TUYỆT ĐỐI
    if (checkpoint.stage === 'GENERATE_CLICKED' || checkpoint.stage === 'GENERATING') {
      return {
        taskId: task.id,
        strategy: 'JUMP_TO_WAIT',
        checkpoint,
        startStateName: 'WAIT_FOR_GENERATION',
        projectId,
        projectUrl,
        baselineUrls,
        reason:
          'LÁ CHẮN LŨY ĐẲNG (Idempotency Shield): Nút Generate đã được click ở phiên trước! Tuyệt đối KHÔNG click lại. Nhảy cóc thẳng vào WAIT_FOR_GENERATION để thu hoạch kết quả.',
      };
    }

    // 4. Trường hợp đã dọn sạch canvas hoặc đã cấu hình tham số
    if (checkpoint.stage === 'INPUTS_CONFIGURED') {
      return {
        taskId: task.id,
        strategy: 'RESUME_CONFIGURING',
        checkpoint,
        startStateName: 'CAPTURE_BASELINE',
        projectId,
        projectUrl,
        baselineUrls,
        reason: 'Prompt và tùy chọn đã được điền ở phiên trước. Tiến hành lấy baseline và sinh.',
      };
    }

    if (checkpoint.stage === 'CANVAS_CLEANED') {
      return {
        taskId: task.id,
        strategy: 'RESUME_CONFIGURING',
        checkpoint,
        startStateName: 'ENTER_PROMPT',
        projectId,
        projectUrl,
        baselineUrls,
        reason: 'Canvas đã được dọn sạch ở phiên trước. Tiếp tục từ bước nạp prompt.',
      };
    }

    // 5. Trường hợp mới tạo project
    if (checkpoint.stage === 'PROJECT_CREATED') {
      return {
        taskId: task.id,
        strategy: 'REUSE_PROJECT',
        checkpoint,
        startStateName: 'CLEAN_CANVAS',
        projectId,
        projectUrl,
        baselineUrls,
        reason: 'Project đã được tạo thành công ở phiên trước. Tái sử dụng project và làm sạch canvas.',
      };
    }

    // Fallback mặc định
    return {
      taskId: task.id,
      strategy: 'FRESH_START',
      checkpoint,
      startStateName: 'OPEN_FLOW',
      projectId,
      projectUrl,
      baselineUrls,
      reason: 'Trạng thái checkpoint không xác định. Bắt đầu lại an toàn từ đầu.',
    };
  }

  /**
   * Áp dụng kế hoạch phục hồi vào FlowStateContext trước khi khởi chạy State Machine.
   */
  static applyResumeToContext(ctx: FlowStateContext, plan: FlowResumePlan): void {
    if (plan.projectId) {
      ctx.activeProjectId = plan.projectId;
      ctx.targetProjectId = plan.projectId;
    }

    if (plan.baselineUrls && plan.baselineUrls.length > 0) {
      ctx.baselineUrls = new Set(plan.baselineUrls);
    }

    if (plan.strategy === 'JUMP_TO_WAIT') {
      ctx.generationState = 'GENERATING';
      (ctx as any).generateClickedAt = plan.checkpoint?.timestamp || Date.now();
    }

    (ctx as any).resumePlan = plan;

    console.log(
      `[FlowCrashResumeCoordinator] [${ctx.taskId}] 🛠️ Đã áp dụng Resume Plan: strategy=${plan.strategy}, startState=${plan.startStateName}`
    );
    console.log(`[FlowCrashResumeCoordinator] [${ctx.taskId}] 💡 Lý do: ${plan.reason}`);
  }

  /**
   * Xác định chỉ mục state bắt đầu trong danh sách pipeline.
   */
  static determineInitialStateIndex(
    pipeline: FlowAutomationState[],
    plan: FlowResumePlan
  ): number {
    if (!plan.startStateName || plan.strategy === 'FRESH_START') {
      return 0;
    }

    const idx = pipeline.findIndex((s) => s.name === plan.startStateName);
    if (idx >= 0) {
      return idx;
    }

    console.warn(
      `[FlowCrashResumeCoordinator] ⚠️ Không tìm thấy state [${plan.startStateName}] trong pipeline. Bắt đầu từ 0.`
    );
    return 0;
  }

  /**
   * Thực thi trọn gói quy trình Crash Resume cho một task.
   */
  static async resumeTask(
    task: FlowTask,
    ctx: FlowStateContext,
    pipeline: FlowAutomationState[],
    checkpoint?: FlowCheckpoint | null
  ): Promise<FlowAutomationResult> {
    // 1. Phân tích kế hoạch
    const plan = FlowCrashResumeCoordinator.evaluateResumePlan(task, checkpoint);

    // 2. Cấu hình context
    FlowCrashResumeCoordinator.applyResumeToContext(ctx, plan);

    // 3. Khởi chạy State Machine từ state đã chỉ định
    const fsm = new FlowStateMachine(pipeline);
    return await fsm.run(ctx, plan.startStateName);
  }
}
