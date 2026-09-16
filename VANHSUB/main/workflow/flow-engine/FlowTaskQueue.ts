import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { FlowTask, FlowTaskStatus, FlowTaskType } from './types';

/**
 * FlowTaskQueue: Hàng đợi tác vụ bền vững (Persistent Task Queue) cho Google Flow Engine.
 * 
 * ĐẶC TÍNH BẢO ĐẢM KỸ THUẬT:
 * 1. Bền vững (Persistence): Lưu trữ tại app.getPath('userData')/flow_task_queue.json.
 *    Tuyệt đối KHÔNG sử dụng process.cwd() để tránh mất dữ liệu khi đóng gói hoặc thay đổi thư mục làm việc.
 * 2. Ghi đĩa nguyên tử (Atomic Disk Write): Ghi qua file tạm (*.tmp) và rename/replace để chống file corruption khi crash.
 * 3. Tuần tự hóa ghi đĩa (Disk Serialization Mutex): Tránh race condition khi nhiều async handler cùng gọi enqueue/update.
 * 4. Phục hồi sau sự cố (Crash Recovery): Tự động phát hiện và chuyển các tác vụ treo ở trạng thái 'RUNNING' về 'PENDING'
 *    khi ứng dụng khởi động lại.
 * 5. Độ ưu tiên (Priority Scheduling): Hỗ trợ lập lịch theo priority DESC và FIFO (createdAt ASC).
 */
export class FlowTaskQueue {
  private static instance: FlowTaskQueue | null = null;
  private storagePath: string;
  private tasks: Map<string, FlowTask> = new Map();
  private writeMutex: Promise<void> = Promise.resolve();
  private initialized: boolean = false;

  /**
   * Khởi tạo hoặc lấy Singleton instance của FlowTaskQueue.
   */
  static getInstance(customStoragePath?: string): FlowTaskQueue {
    if (!FlowTaskQueue.instance || customStoragePath) {
      FlowTaskQueue.instance = new FlowTaskQueue(customStoragePath);
    }
    return FlowTaskQueue.instance;
  }

  /**
   * Xóa singleton (phục vụ test).
   */
  static resetInstance(): void {
    FlowTaskQueue.instance = null;
  }

  /**
   * Xác định đường dẫn lưu trữ hợp lệ:
   * 1. customPath nếu được truyền vào.
   * 2. process.env.FLOW_TASK_QUEUE_PATH nếu có.
   * 3. process.env.FLOW_TASK_QUEUE_DIR / flow_task_queue.json nếu có.
   * 4. app.getPath('userData') / flow_task_queue.json trong Electron runtime.
   * 5. os.tmpdir() / vanhsub_flow_storage / flow_task_queue.json làm fallback an toàn.
   * Tuyệt đối KHÔNG dùng process.cwd().
   */
  static resolveStoragePath(customPath?: string): string {
    if (customPath) {
      return path.resolve(customPath);
    }
    if (process.env.FLOW_TASK_QUEUE_PATH) {
      return path.resolve(process.env.FLOW_TASK_QUEUE_PATH);
    }
    if (process.env.FLOW_TASK_QUEUE_DIR) {
      return path.resolve(path.join(process.env.FLOW_TASK_QUEUE_DIR, 'flow_task_queue.json'));
    }
    if (process.versions && (process.versions as any).electron) {
      try {
        const electron = require('electron');
        const app = electron.app || electron.remote?.app;
        if (app && typeof app.getPath === 'function') {
          return path.join(app.getPath('userData'), 'flow_task_queue.json');
        }
      } catch {
        // Ngoài Electron runtime
      }
    }

    // Fallback chuẩn: Thư mục tạm của OS, tuyệt đối không dùng process.cwd()
    return path.join(os.tmpdir(), 'vanhsub_flow_storage', 'flow_task_queue.json');
  }

  constructor(customStoragePath?: string) {
    this.storagePath = FlowTaskQueue.resolveStoragePath(customStoragePath);
  }

  public getStoragePath(): string {
    return this.storagePath;
  }

  /**
   * Nạp dữ liệu từ đĩa vào bộ nhớ.
   * Tự động khởi tạo thư mục và file nếu chưa tồn tại.
   * Xử lý an toàn nếu file JSON bị hỏng bằng cách tạo backup và khởi tạo mới.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.storagePath)) {
      try {
        const raw = fs.readFileSync(this.storagePath, 'utf-8');
        if (raw.trim().length > 0) {
          const parsed: FlowTask[] = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            this.tasks.clear();
            for (const task of parsed) {
              if (task && task.id) {
                this.tasks.set(task.id, task);
              }
            }
          }
        }
      } catch (err: any) {
        console.error(`[FlowTaskQueue] ⚠️ File lưu trữ bị lỗi (${this.storagePath}):`, err?.message || err);
        // Backup file hỏng để bảo toàn dữ liệu điều tra
        const backupPath = `${this.storagePath}.corrupted.${Date.now()}`;
        try {
          fs.renameSync(this.storagePath, backupPath);
          console.warn(`[FlowTaskQueue] 📦 Đã sao lưu file lỗi sang: ${backupPath}`);
        } catch {
          // ignore
        }
        this.tasks.clear();
        fs.writeFileSync(this.storagePath, JSON.stringify([], null, 2), 'utf-8');
      }
    } else {
      // Khởi tạo file rỗng ban đầu trên đĩa
      fs.writeFileSync(this.storagePath, JSON.stringify([], null, 2), 'utf-8');
    }

    this.initialized = true;
  }

  /**
   * Đảm bảo queue đã nạp trước khi thao tác.
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * Ghi dữ liệu hiện tại ra đĩa bằng cơ chế Atomic Write được tuần tự hóa (Mutex).
   */
  private async persist(): Promise<void> {
    this.writeMutex = this.writeMutex.then(async () => {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tasksArray = Array.from(this.tasks.values());
      const dataString = JSON.stringify(tasksArray, null, 2);

      // 1. Tạo file tạm ngẫu nhiên cùng thư mục
      const tempPath = path.join(
        dir,
        `.flow_task_queue_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.tmp`
      );

      fs.writeFileSync(tempPath, dataString, 'utf-8');

      // 2. Ghi đè file chính thức bằng rename nguyên tử (Atomic replace)
      let renameSuccess = false;
      let attempts = 0;
      const maxAttempts = 5;

      while (!renameSuccess && attempts < maxAttempts) {
        try {
          attempts++;
          fs.renameSync(tempPath, this.storagePath);
          renameSuccess = true;
        } catch (renameErr: any) {
          // Trên Windows, renameSync có thể gặp EBUSY/EPERM tạm thời nếu file bị anti-virus hoặc process khác đọc
          if (attempts >= maxAttempts) {
            try {
              if (fs.existsSync(this.storagePath)) {
                fs.unlinkSync(this.storagePath);
              }
              fs.renameSync(tempPath, this.storagePath);
              renameSuccess = true;
            } catch (finalErr) {
              try {
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
              } catch {}
              throw finalErr;
            }
          } else {
            await new Promise((resolve) => setTimeout(resolve, 30 * attempts));
          }
        }
      }
    });

    return this.writeMutex;
  }

  /**
   * Thêm một task mới vào hàng đợi với trạng thái 'PENDING'.
   */
  async enqueue(
    taskInput: {
      type: FlowTaskType;
      prompt: string;
      options?: Record<string, any>;
      priority?: number;
      maxRetries?: number;
      metadata?: Record<string, any>;
      id?: string;
    }
  ): Promise<FlowTask> {
    await this.ensureInitialized();

    const now = Date.now();
    const id = taskInput.id || `task_${now}_${crypto.randomBytes(4).toString('hex')}`;

    const task: FlowTask = {
      id,
      type: taskInput.type,
      prompt: taskInput.prompt,
      options: taskInput.options || {},
      status: 'PENDING',
      priority: taskInput.priority ?? 0,
      createdAt: now,
      updatedAt: now,
      generationAttemptId: 0,
      retryCount: 0,
      maxRetries: taskInput.maxRetries ?? 3,
      metadata: taskInput.metadata || {},
    };

    this.tasks.set(task.id, task);
    await this.persist();

    return { ...task };
  }

  /**
   * Lấy task tiếp theo có trạng thái 'PENDING' ra xử lý.
   * Tiêu chí sắp xếp: Priority giảm dần, nếu bằng nhau thì createdAt tăng dần (FIFO).
   * Tự động chuyển trạng thái task sang 'RUNNING', cập nhật startedAt và generationAttemptId.
   */
  async dequeue(): Promise<FlowTask | null> {
    await this.ensureInitialized();

    const pendingTasks = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'PENDING'
    );

    if (pendingTasks.length === 0) {
      return null;
    }

    // Sắp xếp: Priority DESC -> createdAt ASC
    pendingTasks.sort((a, b) => {
      const prioDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (prioDiff !== 0) return prioDiff;
      return a.createdAt - b.createdAt;
    });

    const selected = pendingTasks[0];
    const now = Date.now();

    selected.status = 'RUNNING';
    selected.startedAt = now;
    selected.updatedAt = now;
    selected.generationAttemptId = (selected.generationAttemptId || 0) + 1;

    this.tasks.set(selected.id, selected);
    await this.persist();

    return { ...selected };
  }

  /**
   * Xem task PENDING tiếp theo trong hàng đợi mà không thay đổi trạng thái.
   */
  peek(): FlowTask | null {
    const pendingTasks = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'PENDING'
    );

    if (pendingTasks.length === 0) return null;

    pendingTasks.sort((a, b) => {
      const prioDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (prioDiff !== 0) return prioDiff;
      return a.createdAt - b.createdAt;
    });

    return { ...pendingTasks[0] };
  }

  /**
   * Lấy thông tin task theo ID.
   */
  getById(id: string): FlowTask | null {
    const task = this.tasks.get(id);
    return task ? { ...task } : null;
  }

  /**
   * Lấy toàn bộ danh sách task, hỗ trợ lọc theo trạng thái và loại task.
   */
  getAll(filter?: {
    status?: FlowTaskStatus | FlowTaskStatus[];
    type?: FlowTaskType;
  }): FlowTask[] {
    let result = Array.from(this.tasks.values());

    if (filter?.status) {
      const allowedStatuses = Array.isArray(filter.status)
        ? filter.status
        : [filter.status];
      result = result.filter((t) => allowedStatuses.includes(t.status));
    }

    if (filter?.type) {
      result = result.filter((t) => t.type === filter.type);
    }

    // Sắp xếp theo createdAt DESC
    return result.sort((a, b) => b.createdAt - a.createdAt).map((t) => ({ ...t }));
  }

  /**
   * Cập nhật trạng thái và thông tin của task.
   */
  async updateStatus(
    id: string,
    status: FlowTaskStatus,
    updates?: Partial<FlowTask>
  ): Promise<FlowTask | null> {
    await this.ensureInitialized();

    const task = this.tasks.get(id);
    if (!task) return null;

    const now = Date.now();
    task.status = status;
    task.updatedAt = now;

    if (status === 'COMPLETED') {
      task.completedAt = now;
    } else if (status === 'FAILED') {
      task.failedAt = now;
    }

    if (updates) {
      if (updates.error !== undefined) task.error = updates.error;
      if (updates.errorDetail !== undefined) task.errorDetail = updates.errorDetail;
      if (updates.resultUrls !== undefined) task.resultUrls = updates.resultUrls;
      if (updates.localDownloadedFiles !== undefined) task.localDownloadedFiles = updates.localDownloadedFiles;
      if (updates.checkpointId !== undefined) task.checkpointId = updates.checkpointId;
      if (updates.metadata !== undefined) {
        task.metadata = { ...task.metadata, ...updates.metadata };
      }
      if (updates.retryCount !== undefined) task.retryCount = updates.retryCount;
    }

    this.tasks.set(id, task);
    await this.persist();

    return { ...task };
  }

  /**
   * Xóa một task khỏi hàng đợi.
   */
  async remove(id: string): Promise<boolean> {
    await this.ensureInitialized();

    const existed = this.tasks.delete(id);
    if (existed) {
      await this.persist();
    }
    return existed;
  }

  /**
   * Xóa các task đã hoàn thành hoặc đã hủy cũ hơn mốc thời gian chỉ định (mặc định: 7 ngày).
   */
  async clearCompleted(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    await this.ensureInitialized();

    const now = Date.now();
    let removedCount = 0;

    for (const [id, task] of Array.from(this.tasks.entries())) {
      if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
        const finishedTime = task.completedAt || task.updatedAt;
        if (now - finishedTime > olderThanMs) {
          this.tasks.delete(id);
          removedCount++;
        }
      }
    }

    if (removedCount > 0) {
      await this.persist();
    }

    return removedCount;
  }

  /**
   * Phục hồi các task bị gián đoạn (Crash Recovery):
   * Phát hiện các task đang ở trạng thái 'RUNNING' khi khởi động lại hệ thống (do app bị crash/tắt đột ngột).
   * - Nếu task chưa vượt quá maxRetries: Đổi về 'PENDING' để chạy lại, tăng retryCount.
   * - Nếu đã vượt quá maxRetries: Đánh dấu 'FAILED'.
   */
  async recoverInterruptedTasks(): Promise<{ recoveredCount: number; tasks: FlowTask[] }> {
    await this.ensureInitialized();

    const runningTasks = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'RUNNING'
    );

    const recoveredTasks: FlowTask[] = [];

    for (const task of runningTasks) {
      const now = Date.now();
      const currentRetries = task.retryCount || 0;
      const maxRetries = task.maxRetries ?? 3;

      if (currentRetries < maxRetries) {
        task.status = 'PENDING';
        task.retryCount = currentRetries + 1;
        task.updatedAt = now;
        task.metadata = {
          ...task.metadata,
          interruptedAt: now,
          interruptedReason: 'CRASH_OR_UNEXPECTED_TERMINATION',
        };
        recoveredTasks.push({ ...task });
        console.warn(
          `[FlowTaskQueue] 🔄 [CRASH RECOVERY] Phục hồi task [${task.id}] từ RUNNING về PENDING (Lần thử lại: ${task.retryCount}/${maxRetries})`
        );
      } else {
        task.status = 'FAILED';
        task.failedAt = now;
        task.updatedAt = now;
        task.error = 'TASK_INTERRUPTED_MAX_RETRIES_EXCEEDED';
        task.errorDetail = 'Tác vụ bị gián đoạn do ứng dụng khởi động lại và đã vượt quá số lần thử lại tối đa.';
        console.error(
          `[FlowTaskQueue] ❌ [CRASH RECOVERY] Task [${task.id}] đã vượt quá số lần thử lại (${maxRetries}), đánh dấu FAILED`
        );
      }

      this.tasks.set(task.id, task);
    }

    if (runningTasks.length > 0) {
      await this.persist();
    }

    return {
      recoveredCount: recoveredTasks.length,
      tasks: recoveredTasks,
    };
  }

  /**
   * Xóa sạch toàn bộ dữ liệu (phục vụ test).
   */
  async clearAllForTesting(): Promise<void> {
    await this.ensureInitialized();
    this.tasks.clear();
    await this.persist();
  }
}
