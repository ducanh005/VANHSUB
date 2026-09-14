/**
 * Hệ thống điều phối Workflow Graph Engine (Node Dispatcher)
 * Hỗ trợ nhánh (conditional), vòng lặp (loop với maxIterations) và cô lập lỗi.
 */

export type NodeExecutionStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped';

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Kết quả chuẩn hoá trả về từ mọi NodeAdapter.
 * WorkflowGraphEngine chỉ giao tiếp qua format thống nhất này.
 */
export interface NodeResult {
  /** Trạng thái thực thi của node */
  status: 'success' | 'failed' | 'retryable_error';
  /** Dữ liệu đầu ra do adapter sinh ra (URL, Blob, Text, Object...) */
  output?: any;
  /** Loại lỗi chuẩn hoá (ví dụ 'out_of_credits', 'button_not_found', 'timeout') */
  errorType?: string;
  /** Chi tiết thông báo lỗi */
  errorDetail?: string;
  /** Metadata theo dõi thực thi (tài khoản dùng, session, thời gian chạy...) */
  metadata?: {
    accountEmail?: string;
    sessionId?: string;
    durationMs?: number;
    retryCount?: number;
    iteration?: number;
    [key: string]: any;
  };
}

/**
 * Ngữ cảnh thực thi truyền cho từng NodeAdapter khi được điều phối.
 */
export interface NodeExecutionContext {
  runId: string;
  nodeId: string;
  iteration: number;
  /** Dữ liệu input đã được engine resolve từ các node cha */
  inputs: Record<string, any>;
  /** Quyền truy cập vào store trạng thái dùng chung */
  sharedState: any;
  /** Callback thông báo tiến độ về engine */
  onProgress?: (percent: number, message?: string) => void;
  /** Kiểm tra tác vụ đã bị huỷ chưa */
  isCancelled?: () => boolean;
}

/**
 * Interface chung bắt buộc cho mọi loại Adapter thực thi node.
 * Adapter tự chịu trách nhiệm retry nội bộ và wrap kết quả về NodeResult.
 */
export interface NodeAdapter {
  /** Đánh dấu adapter có sử dụng chung trình duyệt BrowserWindow (Google Flow) hay không */
  readonly usesSharedBrowser?: boolean;
  execute(nodeConfig: any, context: NodeExecutionContext): Promise<NodeResult>;
}

/** 3 kiểu cạnh nối trong đồ thị workflow */
export type EdgeType = 'sequential' | 'conditional' | 'loop';

/**
 * Định nghĩa một cạnh nối giữa 2 node trong đồ thị.
 */
export interface WorkflowGraphEdge {
  id?: string;
  from: string;
  to: string;
  type: EdgeType;
  /**
   * Điều kiện rẽ nhánh (dành cho conditional hoặc loop).
   * Có thể là biểu thức chuỗi JS (ví dụ: 'output.success === true' hoặc '!output.success')
   * hoặc function kiểm tra nhận (sourceOutput, context).
   */
  condition?: string | ((sourceOutput: any, context: { runId: string; iteration: number }) => boolean);
  /**
   * Giới hạn số lần lặp lại tối đa trên cạnh này (áp dụng khi type === 'loop').
   * Mặc định: 20 lần nếu không cấu hình.
   */
  maxIterations?: number;
}

/**
 * Định nghĩa một Node trong đồ thị workflow.
 */
export interface WorkflowGraphNode {
  id: string;
  type: string;
  config: Record<string, any>;
  /**
   * Ánh xạ input từ output của node khác hoặc biểu thức context.
   * Ví dụ: { prompt: 'node_image.output.prompt', imageUrl: 'node_image.output.imageUrl' }
   */
  inputMapping?: Record<string, string>;
  /** Nhãn hiển thị hoặc metadata tuỳ chọn */
  label?: string;
  metadata?: Record<string, any>;
}

/**
 * Cấu trúc hoàn chỉnh của một Đồ thị Workflow.
 */
export interface WorkflowGraphDefinition {
  id?: string;
  name?: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  /** Giới hạn số lần lặp tối đa mặc định cho toàn đồ thị (mặc định: 20) */
  defaultMaxIterations?: number;
}

/**
 * Sự kiện phát ra trong suốt chu kỳ chạy của Engine.
 */
export interface WorkflowEngineEvent {
  type:
    | 'run_start'
    | 'run_finish'
    | 'node_start'
    | 'node_progress'
    | 'node_finish'
    | 'node_skipped'
    | 'loop_iteration'
    | 'branch_selected';
  runId: string;
  nodeId?: string;
  edge?: WorkflowGraphEdge;
  status?: string;
  data?: any;
  timestamp: number;
}
