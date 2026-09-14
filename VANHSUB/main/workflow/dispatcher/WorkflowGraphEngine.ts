import { randomUUID } from 'crypto';
import type {
  WorkflowGraphDefinition,
  WorkflowGraphNode,
  WorkflowGraphEdge,
  NodeResult,
  NodeExecutionContext,
  WorkflowEngineEvent,
  RunStatus,
} from './types';
import { SharedStateStore } from './SharedStateStore';
import { NodeAdapterRegistry } from './NodeAdapterRegistry';
import { GoogleFlowBrowserMutex } from './GoogleFlowBrowserMutex';

export interface WorkflowEngineOptions {
  sharedStateStore?: SharedStateStore;
  adapterRegistry?: NodeAdapterRegistry;
  maxConcurrency?: number;
  onEvent?: (event: WorkflowEngineEvent) => void;
  isCancelled?: () => boolean;
}

export interface WorkflowRunResult {
  runId: string;
  status: RunStatus;
  outputs: Record<string, any>;
  durationMs: number;
  error?: string;
}

/**
 * WorkflowGraphEngine: Lớp điều phối đồ thị workflow nâng cao
 * - Hỗ trợ 3 kiểu cạnh: Tuần tự (sequential), Rẽ nhánh (conditional), Vòng lặp (loop).
 * - Kiểm soát vòng lặp với maxIterations (mặc định: 20) để tránh treo vô hạn.
 * - Cô lập lỗi: Node lỗi chỉ chặn các node phụ thuộc trực tiếp; các nhánh độc lập vẫn chạy bình thường.
 * - Hỗ trợ Resume: Tiếp tục từ runId cũ, bỏ qua các node đã 'success' và dùng lại output đã cache.
 * - Độc lập với adapter: Chỉ giao tiếp qua NodeResult chuẩn hoá.
 */
export class WorkflowGraphEngine {
  private stateStore: SharedStateStore;
  private registry: NodeAdapterRegistry;
  private activeRuns = new Map<string, { cancel: () => void }>();

  constructor(options?: { stateStore?: SharedStateStore; registry?: NodeAdapterRegistry }) {
    this.stateStore = options?.stateStore || SharedStateStore.getInstance();
    this.registry = options?.registry || NodeAdapterRegistry.getInstance();
  }

  /**
   * Huỷ một phiên chạy workflow đang diễn ra
   */
  public cancel(runId: string): boolean {
    const handle = this.activeRuns.get(runId);
    if (handle) {
      handle.cancel();
      this.stateStore.setRunStatus(runId, 'cancelled');
      this.activeRuns.delete(runId);
      return true;
    }
    return false;
  }

  /**
   * Thực thi toàn bộ đồ thị workflow
   * @param graph Định nghĩa đồ thị gồm danh sách nodes và edges
   * @param runId ID duy nhất của lần chạy (nếu truyền runId cũ, engine sẽ tự động resume)
   * @param options Các tuỳ chọn mở rộng (concurrency, event callback, cancel)
   */
  public async run(
    graph: WorkflowGraphDefinition,
    runId: string = randomUUID(),
    options?: WorkflowEngineOptions
  ): Promise<WorkflowRunResult> {
    const startTime = Date.now();
    const defaultMaxIter = graph.defaultMaxIterations || 20;
    const maxConcurrency = Math.max(1, options?.maxConcurrency || 3);
    let isCancelledInternally = false;

    const isCancelled = () => isCancelledInternally || Boolean(options?.isCancelled?.());

    this.activeRuns.set(runId, {
      cancel: () => {
        isCancelledInternally = true;
      },
    });

    const emit = (
      type: WorkflowEngineEvent['type'],
      nodeId?: string,
      edge?: WorkflowGraphEdge,
      status?: string,
      data?: any
    ) => {
      options?.onEvent?.({
        type,
        runId,
        nodeId,
        edge,
        status,
        data,
        timestamp: Date.now(),
      });
    };

    // 1. Khởi tạo trạng thái run trong Store
    const completedNodesBefore = this.stateStore.getCompletedNodeIds(runId);
    const isResuming = this.stateStore.hasRun(runId);
    this.stateStore.setRunStatus(runId, 'running', { resumed: isResuming });
    emit('run_start', undefined, undefined, 'running', { isResuming });

    // 2. Map tra cứu nhanh các Node và Edge
    const nodeMap = new Map<string, WorkflowGraphNode>();
    for (const n of graph.nodes) {
      nodeMap.set(n.id, n);
    }

    const outgoingEdgesMap = new Map<string, WorkflowGraphEdge[]>();
    const incomingNonLoopEdgesMap = new Map<string, WorkflowGraphEdge[]>();

    for (const edge of graph.edges) {
      // Outgoing edges
      if (!outgoingEdgesMap.has(edge.from)) {
        outgoingEdgesMap.set(edge.from, []);
      }
      outgoingEdgesMap.get(edge.from)!.push(edge);

      // Incoming non-loop edges (dùng để tìm root nodes)
      if (edge.type !== 'loop') {
        if (!incomingNonLoopEdgesMap.has(edge.to)) {
          incomingNonLoopEdgesMap.set(edge.to, []);
        }
        incomingNonLoopEdgesMap.get(edge.to)!.push(edge);
      }
    }

    // 3. Tìm các root nodes (không có cạnh sequential/conditional nào trỏ vào)
    const rootNodes = graph.nodes.filter((n) => {
      const incoming = incomingNonLoopEdgesMap.get(n.id) || [];
      return incoming.length === 0;
    });

    // 4. Hàng đợi thực thi dạng Work Queue
    interface QueueItem {
      nodeId: string;
      iteration: number;
    }

    const queue: QueueItem[] = [];
    const enqueuedKeys = new Set<string>();

    const enqueue = (nodeId: string, iteration = 0) => {
      const key = `${nodeId}#${iteration}`;
      if (!enqueuedKeys.has(key)) {
        enqueuedKeys.add(key);
        queue.push({ nodeId, iteration });
      }
    };

    // Đưa các root nodes vào hàng đợi ban đầu
    for (const root of rootNodes) {
      if (isResuming) {
        // Nếu node đã thành công trước đó thì không chạy lại
        if (completedNodesBefore.has(root.id)) {
          continue;
        }

        // Kiểm tra xem node có đang trong vòng lặp trước khi crash không
        let maxLoopIterSoFar = 0;
        let hasExhaustedLoop = false;
        for (const edge of graph.edges) {
          if (edge.to === root.id && edge.type === 'loop') {
            const loopKey = `${edge.from}->${edge.to}`;
            const currentCount = this.stateStore.getIterationCount(runId, loopKey);
            const maxIter = edge.maxIterations || defaultMaxIter;
            if (currentCount >= maxIter) {
              hasExhaustedLoop = true;
            }
            if (currentCount > maxLoopIterSoFar) {
              maxLoopIterSoFar = currentCount;
            }
          }
        }

        if (hasExhaustedLoop) {
          console.log(`[WorkflowGraphEngine] ⚠️ Node [${root.id}] đã chạm giới hạn vòng lặp tối đa (${defaultMaxIter} lần) trước đó. Không khởi chạy lại.`);
          continue;
        }

        enqueue(root.id, maxLoopIterSoFar);
      } else {
        enqueue(root.id, 0);
      }
    }

    // Nếu đang resume, kích hoạt tiếp các cạnh xuất phát từ các node đã thành công
    if (isResuming) {
      console.log(`[WorkflowGraphEngine] 🔄 Resume runId="${runId}": Đã có ${completedNodesBefore.size} node hoàn thành.`);
      for (const completedNodeId of completedNodesBefore) {
        const cachedOutput = this.stateStore.getNodeOutput(runId, completedNodeId);
        const outEdges = outgoingEdgesMap.get(completedNodeId) || [];
        for (const edge of outEdges) {
          if (edge.type === 'loop') continue;
          const conditionPassed = this.evaluateCondition(edge.condition, cachedOutput, {
            runId,
            iteration: 0,
          });
          if (conditionPassed && !completedNodesBefore.has(edge.to)) {
            enqueue(edge.to, 0);
          }
        }
      }
    }

    // Các biến theo dõi tiến trình
    const inFlight = new Set<string>();
    let hasExecutionError = false;

    // 5. Vòng lặp điều phối chính (Event Loop với Concurrency Control)
    while ((queue.length > 0 || inFlight.size > 0) && !isCancelled()) {
      // Đẩy các task có thể chạy song song vào execution pool
      while (queue.length > 0 && inFlight.size < maxConcurrency && !isCancelled()) {
        const item = queue.shift()!;
        const node = nodeMap.get(item.nodeId);
        if (!node) continue;

        // Nếu node này đã thành công trước đó (trong kịch bản resume) -> bỏ qua không chạy lại
        if (this.stateStore.getNodeStatus(runId, node.id) === 'success' && item.iteration === 0) {
          emit('node_skipped', node.id, undefined, 'already_success', {
            output: this.stateStore.getNodeOutput(runId, node.id),
          });
          continue;
        }

        inFlight.add(`${node.id}#${item.iteration}`);

        // Chạy task node bất đồng bộ
        this.executeSingleNode(node, item.iteration, runId, emit, isCancelled)
          .then((result) => {
            inFlight.delete(`${node.id}#${item.iteration}`);
            this.handleNodeCompletion(
              node,
              item.iteration,
              result,
              runId,
              graph,
              outgoingEdgesMap,
              incomingNonLoopEdgesMap,
              enqueue,
              emit,
              defaultMaxIter
            );
          })
          .catch((err) => {
            inFlight.delete(`${node.id}#${item.iteration}`);
            hasExecutionError = true;
            console.error(`[WorkflowGraphEngine] Lỗi nghiêm trọng khi thực thi node ${node.id}:`, err);
            this.stateStore.markNodeStatus(runId, node.id, 'failed', {}, err?.message);
            emit('node_finish', node.id, undefined, 'failed', { error: err?.message });
            this.handleNodeCompletion(
              node,
              item.iteration,
              { status: 'failed', errorDetail: err?.message, output: { success: false, error: err?.message } },
              runId,
              graph,
              outgoingEdgesMap,
              incomingNonLoopEdgesMap,
              enqueue,
              emit,
              defaultMaxIter
            );
          });
      }

      // Nhường CPU cho I/O và chờ các task in-flight hoàn thành
      await new Promise((r) => setTimeout(r, 40));
    }

    // 6. Tổng kết kết quả chạy
    this.activeRuns.delete(runId);

    let finalStatus: RunStatus = 'completed';
    if (isCancelled()) {
      finalStatus = 'cancelled';
    } else if (hasExecutionError) {
      finalStatus = 'failed';
    }

    this.stateStore.setRunStatus(runId, finalStatus);
    const finalOutputs = this.stateStore.getAllOutputs(runId);
    const durationMs = Date.now() - startTime;

    emit('run_finish', undefined, undefined, finalStatus, {
      durationMs,
      totalOutputs: Object.keys(finalOutputs).length,
    });

    return {
      runId,
      status: finalStatus,
      outputs: finalOutputs,
      durationMs,
    };
  }

  /**
   * Thực thi một Node đơn lẻ qua Adapter tương ứng
   */
  private async executeSingleNode(
    node: WorkflowGraphNode,
    iteration: number,
    runId: string,
    emit: Function,
    isCancelled: () => boolean
  ): Promise<NodeResult> {
    const adapter = this.registry.get(node.type);
    if (!adapter) {
      throw new Error(`Không tìm thấy Adapter đăng ký cho loại node "${node.type}".`);
    }

    this.stateStore.markNodeStatus(runId, node.id, 'running', { iteration });
    emit('node_start', node.id, undefined, 'running', { iteration });

    // 1. Thu thập inputs từ SharedStateStore theo inputMapping
    const resolvedInputs = this.resolveNodeInputs(node, runId, iteration);

    // 2. Tạo context thực thi
    const context: NodeExecutionContext = {
      runId,
      nodeId: node.id,
      iteration,
      inputs: resolvedInputs,
      sharedState: this.stateStore,
      onProgress: (percent, message) => {
        emit('node_progress', node.id, undefined, 'running', { percent, message });
      },
      isCancelled,
    };

    // 3. Gọi Adapter (Nếu adapter đánh dấu usesSharedBrowser, bảo vệ qua GoogleFlowBrowserMutex)
    const executeTask = () => adapter.execute(node.config, context);
    const result = adapter.usesSharedBrowser
      ? await GoogleFlowBrowserMutex.getInstance().runExclusive(executeTask, `${node.id}#${iteration}`)
      : await executeTask();

    // 4. Ghi nhận kết quả vào store
    if (result.status === 'success') {
      this.stateStore.setNodeOutput(runId, node.id, result.output, {
        ...(result.metadata || {}),
        iteration,
      });
      emit('node_finish', node.id, undefined, 'success', { output: result.output });
    } else {
      this.stateStore.markNodeStatus(
        runId,
        node.id,
        'failed',
        { ...(result.metadata || {}), iteration },
        result.errorDetail || result.errorType
      );
      emit('node_finish', node.id, undefined, 'failed', {
        errorType: result.errorType,
        errorDetail: result.errorDetail,
      });
    }

    return result;
  }

  /**
   * Xử lý kết quả sau khi một Node hoàn thành (Rẽ nhánh, Lặp, hoặc Tiếp tục tuần tự)
   */
  private handleNodeCompletion(
    node: WorkflowGraphNode,
    iteration: number,
    result: NodeResult,
    runId: string,
    graph: WorkflowGraphDefinition,
    outgoingEdgesMap: Map<string, WorkflowGraphEdge[]>,
    incomingNonLoopEdgesMap: Map<string, WorkflowGraphEdge[]>,
    enqueue: (nodeId: string, iter: number) => void,
    emit: Function,
    defaultMaxIter: number
  ): void {
    const edges = outgoingEdgesMap.get(node.id) || [];
    const sourceOutput = result.output || { success: result.status === 'success' };
    const candidateJoinNodes = new Set<string>();

    for (const edge of edges) {
      // TRƯỜNG HỢP 1: CẠNH VÒNG LẶP (LOOP)
      if (edge.type === 'loop') {
        const loopKey = `${edge.from}->${edge.to}`;
        const maxIter = edge.maxIterations || defaultMaxIter;
        const currentIterCount = this.stateStore.getIterationCount(runId, loopKey);

        const conditionPassed = this.evaluateCondition(edge.condition, sourceOutput, {
          runId,
          iteration: currentIterCount,
        });

        if (conditionPassed) {
          if (currentIterCount < maxIter) {
            const nextCount = this.stateStore.incrementIterationCount(runId, loopKey);
            emit('loop_iteration', edge.to, edge, 'loop_retriggered', {
              loopKey,
              iteration: nextCount,
              maxIterations: maxIter,
            });
            console.log(
              `[WorkflowGraphEngine] 🔁 Vòng lặp [${loopKey}]: kích hoạt lần lặp ${nextCount}/${maxIter}`
            );
            enqueue(edge.to, nextCount);
          } else {
            console.warn(
              `[WorkflowGraphEngine] ⚠️ Vòng lặp [${loopKey}] đã đạt giới hạn tối đa (${maxIter} lần). Dừng lặp để tránh treo.`
            );
          }
        }
        continue;
      }

      // Kiểm tra xem node đích có phải là Join Node (nhiều hơn 1 cạnh incoming non-loop) hay không
      const incomingEdges = incomingNonLoopEdgesMap.get(edge.to) || [];
      if (incomingEdges.length > 1) {
        candidateJoinNodes.add(edge.to);
        continue;
      }

      // TRƯỜNG HỢP 2: CẠNH CÓ ĐIỀU KIỆN ĐƠN LẺ (CONDITIONAL)
      if (edge.type === 'conditional') {
        const conditionPassed = this.evaluateCondition(edge.condition, sourceOutput, {
          runId,
          iteration,
        });

        if (conditionPassed) {
          emit('branch_selected', edge.to, edge, 'branch_taken', { from: edge.from, to: edge.to });
          console.log(`[WorkflowGraphEngine] 🌿 Rẽ nhánh [${edge.from} ➔ ${edge.to}]: Điều kiện thoả mãn.`);
          enqueue(edge.to, iteration);
        } else {
          console.log(`[WorkflowGraphEngine] 🚫 Rẽ nhánh [${edge.from} ➔ ${edge.to}]: Bỏ qua do điều kiện sai.`);
          this.stateStore.markNodeStatus(
            runId,
            edge.to,
            'skipped',
            {},
            `Bỏ qua do điều kiện rẽ nhánh từ ${edge.from} không thoả mãn.`
          );
          emit('node_skipped', edge.to, edge, 'condition_not_met', { from: edge.from });
        }
        continue;
      }

      // TRƯỜNG HỢP 3: CẠNH TUẦN TỰ ĐƠN LẺ (SEQUENTIAL)
      if (edge.type === 'sequential') {
        if (result.status === 'success') {
          enqueue(edge.to, iteration);
        } else {
          // Khi node nguồn thất bại, cô lập nhánh con phụ thuộc trực tiếp vào nó
          console.log(
            `[WorkflowGraphEngine] ⛔ Node [${edge.to}] bị chặn vì node nguồn [${node.id}] thất bại. (Cô lập lỗi nhánh).`
          );
          this.stateStore.markNodeStatus(
            runId,
            edge.to,
            'skipped',
            {},
            `Bị chặn do node cha ${node.id} thất bại.`
          );
          emit('node_skipped', edge.to, edge, 'blocked_by_parent', { parentId: node.id });
        }
      }
    }

    // XỬ LÝ CÁC JOIN NODES (Đồng bộ hoá hội tụ DAG: Chỉ kích hoạt khi TẤT CẢ các nhánh cha đã hoàn thành)
    for (const targetId of candidateJoinNodes) {
      const incoming = incomingNonLoopEdgesMap.get(targetId) || [];
      const allParentsDone = incoming.every((inEdge) => {
        const s = this.stateStore.getNodeStatus(runId, inEdge.from);
        return s === 'success' || s === 'failed' || s === 'skipped';
      });

      if (!allParentsDone) {
        console.log(
          `[WorkflowGraphEngine] ⏳ Join Node [${targetId}]: Nhánh [${node.id}] đã xong, chờ các nhánh cha khác trước khi kích hoạt...`
        );
        continue;
      }

      // Đã hoàn thành tất cả các nhánh cha! Kiểm tra điều kiện kích hoạt Join Node
      let canRun = true;
      let rejectReason = '';

      for (const inEdge of incoming) {
        const parentStatus = this.stateStore.getNodeStatus(runId, inEdge.from);
        const parentOutput = this.stateStore.getNodeOutput(runId, inEdge.from) || {
          success: parentStatus === 'success',
        };

        if (inEdge.type === 'sequential') {
          if (parentStatus !== 'success') {
            canRun = false;
            rejectReason = `Nhánh cha [${inEdge.from}] không thành công (trạng thái: ${parentStatus})`;
            break;
          }
        } else if (inEdge.type === 'conditional') {
          const condOk = this.evaluateCondition(inEdge.condition, parentOutput, {
            runId,
            iteration,
          });
          if (!condOk) {
            canRun = false;
            rejectReason = `Điều kiện trên cạnh [${inEdge.from} ➔ ${targetId}] không thoả mãn`;
            break;
          }
        }
      }

      if (canRun) {
        console.log(
          `[WorkflowGraphEngine] 🎯 Join Node [${targetId}]: Tất cả ${incoming.length} nhánh cha đã hoàn tất thoả mãn điều kiện. Kích hoạt thực thi!`
        );
        enqueue(targetId, iteration);
      } else {
        console.log(
          `[WorkflowGraphEngine] ⛔ Join Node [${targetId}] bị bỏ qua: ${rejectReason}.`
        );
        this.stateStore.markNodeStatus(runId, targetId, 'skipped', {}, rejectReason);
        emit('node_skipped', targetId, undefined, 'join_condition_failed', { reason: rejectReason });
      }
    }
  }

  /**
   * Đánh giá điều kiện trên output (an toàn và hỗ trợ cả string expression lẫn function)
   */
  private evaluateCondition(
    condition: string | ((output: any, ctx: any) => boolean) | undefined,
    sourceOutput: any,
    context: { runId: string; iteration: number }
  ): boolean {
    if (condition === undefined || condition === null) return true;

    // Function predicate
    if (typeof condition === 'function') {
      try {
        return Boolean(condition(sourceOutput, context));
      } catch (e) {
        console.warn('[WorkflowGraphEngine] Lỗi khi thực thi hàm điều kiện:', e);
        return false;
      }
    }

    // String expression (ví dụ: 'output.success === true' hoặc '!output.success')
    if (typeof condition === 'string') {
      const trimmed = condition.trim();
      if (!trimmed) return true;
      try {
        const fn = new Function('output', 'context', `"use strict"; return Boolean(${trimmed});`);
        return Boolean(fn(sourceOutput, context));
      } catch (e) {
        console.warn(`[WorkflowGraphEngine] Lỗi đánh giá biểu thức "${trimmed}":`, e);
        return false;
      }
    }

    return false;
  }

  /**
   * Resolve input cho node dựa theo cấu hình inputMapping hoặc lấy output từ các node trước
   */
  private resolveNodeInputs(node: WorkflowGraphNode, runId: string, iteration = 0): Record<string, any> {
    const inputs: Record<string, any> = {};

    if (node.inputMapping) {
      for (const [targetKey, sourcePath] of Object.entries(node.inputMapping)) {
        if (!sourcePath || typeof sourcePath !== 'string') continue;

        // Hỗ trợ cú pháp: 'nodeId.output.property' hoặc 'nodeId.property'
        const parts = sourcePath.split('.');
        const sourceNodeId = parts[0];
        const sourceOutput = this.stateStore.getNodeOutput(runId, sourceNodeId);

        if (sourceOutput === undefined) continue;

        if (parts.length === 1) {
          inputs[targetKey] = sourceOutput;
        } else {
          let current = sourceOutput;
          const subParts = parts[1] === 'output' ? parts.slice(2) : parts.slice(1);
          for (const p of subParts) {
            if (current === undefined || current === null) break;
            current = current[p];
          }
          inputs[targetKey] = current;
        }
      }
    }

    // Quy tắc Loop / Retry: Nếu node đang lặp lại (iteration > 0) và chưa có projectId từ inputs,
    // tự động dùng lại projectId của chính node này ở lần lặp trước đó trong cùng runId!
    if (!inputs.projectId && iteration > 0) {
      const prevSelfOutput = this.stateStore.getNodeOutput(runId, node.id);
      if (prevSelfOutput?.projectId) {
        inputs.projectId = prevSelfOutput.projectId;
        console.log(`[WorkflowGraphEngine] 🔁 Node [${node.id}] lần lặp ${iteration}: Tái sử dụng projectId từ lần lặp trước (${prevSelfOutput.projectId})`);
      }
    }

    return inputs;
  }

  /**
   * Thực thi một Node đơn lẻ trong đồ thị (phục vụ tính năng Run Node độc lập)
   * Tự động tra cứu và kế thừa output/projectId của các node cha đã lưu trong SharedStateStore
   */
  public async runSingleNode(
    graph: WorkflowGraphDefinition,
    nodeId: string,
    runId: string = randomUUID(),
    options?: WorkflowEngineOptions
  ): Promise<NodeResult> {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new Error(`Không tìm thấy node "${nodeId}" trong đồ thị.`);
    }

    const isCancelled = () => Boolean(options?.isCancelled?.());
    const emit = (
      type: WorkflowEngineEvent['type'],
      eNodeId?: string,
      edge?: WorkflowGraphEdge,
      status?: string,
      data?: any
    ) => {
      options?.onEvent?.({
        type,
        runId,
        nodeId: eNodeId,
        edge,
        status,
        data,
        timestamp: Date.now(),
      });
    };

    // Nếu có cạnh nối tới nodeId, tự động suy diễn inputMapping từ cạnh nối nếu chưa có
    if (!node.inputMapping) {
      node.inputMapping = {};
    }
    const incomingEdges = graph.edges.filter((e) => e.to === nodeId && e.type !== 'loop');
    for (const edge of incomingEdges) {
      // Tự động tìm projectId từ node nguồn nếu node đích chưa map projectId
      if (!node.inputMapping['projectId']) {
        const sourceOut = this.stateStore.getNodeOutput(runId, edge.from);
        if (sourceOut?.projectId) {
          node.inputMapping['projectId'] = `${edge.from}.projectId`;
        }
      }
    }

    return await this.executeSingleNode(node, 0, runId, emit, isCancelled);
  }
}
