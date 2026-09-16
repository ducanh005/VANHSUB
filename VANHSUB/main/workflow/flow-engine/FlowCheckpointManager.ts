import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { FlowCheckpoint, FlowCheckpointStage, FlowStateContext } from './types';

/**
 * FlowCheckpointManager: Quản lý điểm kiểm tra trung gian (Intermediate Checkpoint Manager)
 * cho pipeline tự động hóa Google Flow.
 * 
 * NGUYÊN TẮC THIẾT KẾ VÀ TIÊU CHUẨN KỸ THUẬT:
 * 1. Bền vững (Persistence): Lưu trữ tại app.getPath('userData')/flow_checkpoints/<taskId>.json.
 *    Tuyệt đối KHÔNG dùng process.cwd().
 * 2. Ghi đĩa nguyên tử (Atomic Disk Write): Sử dụng file tạm (*.tmp) và rename/replace để đảm bảo
 *    dữ liệu checkpoint không bao giờ bị hỏng (corrupted) khi máy tính bị sập nguồn hay app bị tắt đột ngột.
 * 3. Cache & Tuần tự hóa: Giữ in-memory cache phục vụ truy vấn tốc độ cao và dùng Promise serialization
 *    để ngăn chặn Race Condition khi ghi file.
 * 4. Hỗ trợ Crash Resume: Cung cấp đầy đủ thông tin về project URL, state hoàn tất cuối cùng và baseline URLs
 *    giúp khôi phục chính xác pipeline từ mốc gián đoạn.
 */
export class FlowCheckpointManager {
  private static instance: FlowCheckpointManager | null = null;
  private checkpointsDir: string;
  private cache: Map<string, FlowCheckpoint> = new Map();
  private writeMutex: Promise<void> = Promise.resolve();

  /**
   * Lấy hoặc tạo Singleton instance.
   */
  static getInstance(customDir?: string): FlowCheckpointManager {
    if (!FlowCheckpointManager.instance || customDir) {
      FlowCheckpointManager.instance = new FlowCheckpointManager(customDir);
    }
    return FlowCheckpointManager.instance;
  }

  /**
   * Xóa Singleton instance (phục vụ test).
   */
  static resetInstance(): void {
    FlowCheckpointManager.instance = null;
  }

  /**
   * Xác định thư mục lưu trữ checkpoints an toàn:
   * 1. customDir nếu được chỉ định.
   * 2. process.env.FLOW_CHECKPOINTS_DIR nếu có.
   * 3. app.getPath('userData')/flow_checkpoints trong môi trường Electron.
   * 4. os.tmpdir()/vanhsub_flow_storage/flow_checkpoints làm fallback chuẩn cho test ngoài Electron.
   * Tuyệt đối KHÔNG dùng process.cwd().
   */
  static resolveCheckpointsDir(customDir?: string): string {
    if (customDir) {
      return path.resolve(customDir);
    }
    if (process.env.FLOW_CHECKPOINTS_DIR) {
      return path.resolve(process.env.FLOW_CHECKPOINTS_DIR);
    }
    if (process.versions && (process.versions as any).electron) {
      try {
        const electron = require('electron');
        const app = electron.app || electron.remote?.app;
        if (app && typeof app.getPath === 'function') {
          return path.join(app.getPath('userData'), 'flow_checkpoints');
        }
      } catch {
        // Ngoài Electron runtime
      }
    }

    return path.join(os.tmpdir(), 'vanhsub_flow_storage', 'flow_checkpoints');
  }

  constructor(customDir?: string) {
    this.checkpointsDir = FlowCheckpointManager.resolveCheckpointsDir(customDir);
    this.ensureDirectoryExists();
  }

  public getCheckpointsDir(): string {
    return this.checkpointsDir;
  }

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.checkpointsDir)) {
      fs.mkdirSync(this.checkpointsDir, { recursive: true });
    }
  }

  /**
   * Chuẩn hóa tên file an toàn dựa trên taskId.
   */
  private getFilePath(taskId: string): string {
    const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.checkpointsDir, `${safeTaskId}.json`);
  }

  /**
   * Lưu checkpoint của một task xuống đĩa bằng cơ chế Atomic Write.
   */
  async saveCheckpoint(checkpoint: FlowCheckpoint): Promise<void> {
    if (!checkpoint || !checkpoint.taskId) {
      throw new Error('[FlowCheckpointManager] Checkpoint hợp lệ bắt buộc phải có taskId');
    }

    this.ensureDirectoryExists();

    // 1. Cập nhật In-Memory Cache
    const normalizedCheckpoint: FlowCheckpoint = {
      ...checkpoint,
      timestamp: checkpoint.timestamp || Date.now(),
    };
    this.cache.set(normalizedCheckpoint.taskId, { ...normalizedCheckpoint });

    // 2. Tuần tự hóa ghi đĩa nguyên tử (Atomic Write Mutex)
    this.writeMutex = this.writeMutex.then(async () => {
      const targetFile = this.getFilePath(normalizedCheckpoint.taskId);
      const dataString = JSON.stringify(normalizedCheckpoint, null, 2);

      const tempFile = path.join(
        this.checkpointsDir,
        `.cp_${normalizedCheckpoint.taskId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.tmp`
      );

      fs.writeFileSync(tempFile, dataString, 'utf-8');

      let renameSuccess = false;
      let attempts = 0;
      const maxAttempts = 5;

      while (!renameSuccess && attempts < maxAttempts) {
        try {
          attempts++;
          fs.renameSync(tempFile, targetFile);
          renameSuccess = true;
        } catch (renameErr: any) {
          if (attempts >= maxAttempts) {
            try {
              if (fs.existsSync(targetFile)) {
                fs.unlinkSync(targetFile);
              }
              fs.renameSync(tempFile, targetFile);
              renameSuccess = true;
            } catch (finalErr) {
              try {
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
              } catch {}
              throw finalErr;
            }
          } else {
            await new Promise((resolve) => setTimeout(resolve, 25 * attempts));
          }
        }
      }
    });

    return this.writeMutex;
  }

  /**
   * Lấy checkpoint gần nhất của task (truy vấn từ cache hoặc đĩa).
   */
  getLatestCheckpoint(taskId: string): FlowCheckpoint | null {
    if (!taskId) return null;

    // 1. Kiểm tra cache
    const cached = this.cache.get(taskId);
    if (cached) {
      return { ...cached };
    }

    // 2. Nếu chưa có trong cache, đọc từ đĩa
    const filePath = this.getFilePath(taskId);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed: FlowCheckpoint = JSON.parse(content);
        if (parsed && parsed.taskId === taskId) {
          this.cache.set(taskId, parsed);
          return { ...parsed };
        }
      } catch (err: any) {
        console.warn(`[FlowCheckpointManager] ⚠️ Không thể đọc checkpoint [${taskId}]:`, err?.message || err);
      }
    }

    return null;
  }

  /**
   * Xóa checkpoint của một task sau khi task đã hoàn thành hoặc bị xóa vĩnh viễn.
   */
  async clearCheckpoint(taskId: string): Promise<boolean> {
    if (!taskId) return false;

    this.cache.delete(taskId);

    return new Promise((resolve) => {
      this.writeMutex = this.writeMutex.then(async () => {
        const filePath = this.getFilePath(taskId);
        let deleted = false;
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            deleted = true;
          } catch (err: any) {
            console.warn(`[FlowCheckpointManager] ⚠️ Không thể xóa file checkpoint [${filePath}]:`, err?.message || err);
          }
        }
        resolve(deleted);
      });
    });
  }

  /**
   * Liệt kê tất cả các checkpoint hiện có trên đĩa.
   */
  listCheckpoints(): FlowCheckpoint[] {
    this.ensureDirectoryExists();

    const results: FlowCheckpoint[] = [];
    try {
      const files = fs.readdirSync(this.checkpointsDir);
      for (const file of files) {
        if (file.endsWith('.json') && !file.startsWith('.')) {
          const fullPath = path.join(this.checkpointsDir, file);
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const cp: FlowCheckpoint = JSON.parse(content);
            if (cp && cp.taskId) {
              results.push(cp);
              this.cache.set(cp.taskId, cp);
            }
          } catch {
            // bỏ qua file lỗi format
          }
        }
      }
    } catch (err: any) {
      console.warn('[FlowCheckpointManager] Lỗi đọc danh sách checkpoints:', err?.message || err);
    }

    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Dọn dẹp các checkpoint cũ hơn thời gian quy định (mặc định: 7 ngày).
   */
  async cleanupOldCheckpoints(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const now = Date.now();
    let cleanedCount = 0;

    const all = this.listCheckpoints();
    for (const cp of all) {
      if (now - cp.timestamp > olderThanMs) {
        const deleted = await this.clearCheckpoint(cp.taskId);
        if (deleted) cleanedCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * Ánh xạ từ State trong State Machine sang Stage Checkpoint chuẩn.
   */
  static mapStateToStage(stateName: string): FlowCheckpointStage | null {
    const upper = (stateName || '').toUpperCase();

    if (upper === 'NAVIGATE_TO_URL' || upper === 'CHECK_LOBBY_READY') {
      return 'INIT';
    }
    if (upper === 'CLICK_NEW_PROJECT' || upper === 'WAIT_FOR_PROJECT_INIT') {
      return 'PROJECT_CREATED';
    }
    if (upper === 'CLEAN_CANVAS') {
      return 'CANVAS_CLEANED';
    }
    if (
      upper.startsWith('SELECT_') ||
      upper === 'ENTER_PROMPT' ||
      upper === 'PASTE_PROMPT' ||
      upper === 'SET_INPUT_PARAMS'
    ) {
      return 'INPUTS_CONFIGURED';
    }
    if (upper === 'CLICK_GENERATE') {
      return 'GENERATE_CLICKED';
    }
    if (
      upper === 'WAIT_FOR_GENERATION' ||
      upper === 'CAPTURE_GENERATED_IMAGE' ||
      upper === 'VERIFY_GENERATED_IMAGE' ||
      upper === 'WAIT_FOR_VIDEO_PROGRESS'
    ) {
      return 'GENERATING';
    }
    if (upper === 'DOWNLOAD_RESULT' || upper === 'COMPLETE' || upper === 'FINAL_VERIFY') {
      return 'COMPLETED';
    }

    return null;
  }

  /**
   * Trích xuất thông tin từ FlowStateContext để tạo FlowCheckpoint hoàn chỉnh.
   */
  static createFromContext(
    ctx: FlowStateContext,
    stage: FlowCheckpointStage,
    stateName?: string
  ): FlowCheckpoint {
    const baselineArr = ctx.baselineUrls ? Array.from(ctx.baselineUrls) : [];

    let projectUrl: string | undefined = undefined;
    try {
      if (ctx.win && !ctx.win.isDestroyed?.()) {
        const url = ctx.win.webContents?.getURL?.();
        if (url && typeof url === 'string') {
          projectUrl = url;
        }
      }
    } catch {
      // ignore
    }

    return {
      taskId: ctx.taskId,
      stage,
      projectId: ctx.activeProjectId || ctx.targetProjectId,
      projectUrl,
      generationAttemptId: Number(ctx.generationAttemptId) || 0,
      baselineUrls: baselineArr,
      timestamp: Date.now(),
      prompt: ctx.prompt,
      aspectRatio: ctx.aspectRatio,
      mode: ctx.mode,
      lastCompletedState: stateName,
      metadata: {
        capturedMediaUrl: ctx.capturedMediaUrl,
        generationState: ctx.generationState,
      },
    };
  }
}
