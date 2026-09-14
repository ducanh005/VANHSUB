import type { NodeExecutionStatus, RunStatus } from './types';

export interface NodeStateRecord {
  nodeId: string;
  status: NodeExecutionStatus;
  output?: any;
  error?: string;
  iteration: number;
  updatedAt: number;
  metadata?: {
    accountEmail?: string;
    sessionId?: string;
    durationMs?: number;
    retryCount?: number;
    [key: string]: any;
  };
}

export interface WorkflowRunRecord {
  runId: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  nodeStates: Map<string, NodeStateRecord>;
  /** Bộ đếm số lần lặp cho từng cạnh loop (key = `${from}->${to}`) */
  loopIterations: Map<string, number>;
  /** Metadata chung cho cả run (ví dụ tên workflow, tham số khởi tạo) */
  metadata?: Record<string, any>;
}

/**
 * SharedStateStore: Quản lý trạng thái chia sẻ giữa các node theo `runId`.
 * - Lưu trữ output, trạng thái và metadata của từng node.
 * - Hỗ trợ Resume: ghi nhận các node đã hoàn thành (`success`) để khi chạy lại runId cũ thì bỏ qua.
 * - Hỗ trợ Đa tài khoản / Đa session: lưu trữ rõ ràng node nào dùng email/session nào để dễ debug.
 */
export class SharedStateStore {
  private static instance: SharedStateStore | null = null;
  private runs = new Map<string, WorkflowRunRecord>();

  constructor() {}

  public static getInstance(): SharedStateStore {
    if (!this.instance) {
      this.instance = new SharedStateStore();
    }
    return this.instance;
  }

  /**
   * Đảm bảo run record tồn tại trong store
   */
  private ensureRun(runId: string): WorkflowRunRecord {
    let run = this.runs.get(runId);
    if (!run) {
      run = {
        runId,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        nodeStates: new Map(),
        loopIterations: new Map(),
      };
      this.runs.set(runId, run);
    }
    return run;
  }

  /**
   * Kiểm tra runId đã từng tồn tại trong store chưa (phục vụ nhận diện Resume)
   */
  public hasRun(runId: string): boolean {
    return this.runs.has(runId);
  }

  /**
   * Lấy toàn bộ record chi tiết của run
   */
  public getRunRecord(runId: string): WorkflowRunRecord | undefined {
    return this.runs.get(runId);
  }

  /**
   * Lưu output của một node
   */
  public setNodeOutput(runId: string, nodeId: string, output: any, metadata?: Record<string, any>): void {
    const run = this.ensureRun(runId);
    const existing = run.nodeStates.get(nodeId);
    const currentIteration = existing?.iteration ?? 0;

    run.nodeStates.set(nodeId, {
      nodeId,
      status: 'success',
      output,
      iteration: currentIteration,
      updatedAt: Date.now(),
      metadata: {
        ...(existing?.metadata || {}),
        ...(metadata || {}),
      },
    });
    run.updatedAt = Date.now();
  }

  /**
   * Lấy output của một node đã thực thi
   */
  public getNodeOutput(runId: string, nodeId: string): any {
    const run = this.runs.get(runId);
    return run?.nodeStates.get(nodeId)?.output;
  }

  /**
   * Lấy toàn bộ record trạng thái của một node
   */
  public getNodeRecord(runId: string, nodeId: string): NodeStateRecord | undefined {
    const run = this.runs.get(runId);
    return run?.nodeStates.get(nodeId);
  }

  /**
   * Cập nhật trạng thái thực thi của một node
   */
  public markNodeStatus(
    runId: string,
    nodeId: string,
    status: NodeExecutionStatus,
    metadata?: Record<string, any>,
    error?: string
  ): void {
    const run = this.ensureRun(runId);
    const existing = run.nodeStates.get(nodeId);

    run.nodeStates.set(nodeId, {
      nodeId,
      status,
      output: existing?.output,
      error: error || existing?.error,
      iteration: existing?.iteration ?? 0,
      updatedAt: Date.now(),
      metadata: {
        ...(existing?.metadata || {}),
        ...(metadata || {}),
      },
    });
    run.updatedAt = Date.now();
  }

  /**
   * Lấy trạng thái của một node
   */
  public getNodeStatus(runId: string, nodeId: string): NodeExecutionStatus | undefined {
    const run = this.runs.get(runId);
    return run?.nodeStates.get(nodeId)?.status;
  }

  /**
   * Lấy trạng thái tổng thể của run
   */
  public getRunStatus(runId: string): RunStatus {
    const run = this.runs.get(runId);
    return run?.status || 'pending';
  }

  /**
   * Cập nhật trạng thái tổng thể của run
   */
  public setRunStatus(runId: string, status: RunStatus, metadata?: Record<string, any>): void {
    const run = this.ensureRun(runId);
    run.status = status;
    run.updatedAt = Date.now();
    if (metadata) {
      run.metadata = { ...(run.metadata || {}), ...metadata };
    }
  }

  /**
   * Lấy danh sách ID các node đã chạy thành công (phục vụ Resume workflow)
   */
  public getCompletedNodeIds(runId: string): Set<string> {
    const run = this.runs.get(runId);
    const completed = new Set<string>();
    if (!run) return completed;

    for (const [nodeId, record] of run.nodeStates.entries()) {
      if (record.status === 'success') {
        completed.add(nodeId);
      }
    }
    return completed;
  }

  /**
   * Lấy số lần lặp hiện tại của một cạnh lặp hoặc node
   */
  public getIterationCount(runId: string, loopKey: string): number {
    const run = this.ensureRun(runId);
    return run.loopIterations.get(loopKey) || 0;
  }

  /**
   * Tăng số lần lặp lên 1 và trả về giá trị mới
   */
  public incrementIterationCount(runId: string, loopKey: string): number {
    const run = this.ensureRun(runId);
    const current = run.loopIterations.get(loopKey) || 0;
    const next = current + 1;
    run.loopIterations.set(loopKey, next);
    run.updatedAt = Date.now();
    return next;
  }

  /**
   * Lấy tất cả outputs của toàn bộ run thành object key-value
   */
  public getAllOutputs(runId: string): Record<string, any> {
    const run = this.runs.get(runId);
    const result: Record<string, any> = {};
    if (!run) return result;

    for (const [nodeId, record] of run.nodeStates.entries()) {
      if (record.output !== undefined) {
        result[nodeId] = record.output;
      }
    }
    return result;
  }

  /**
   * Xoá sạch dữ liệu của 1 run (khi muốn chạy mới hoàn toàn từ đầu)
   */
  public clearRun(runId: string): void {
    this.runs.delete(runId);
  }
}
