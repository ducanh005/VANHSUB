import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DiagnosticFileInfo {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface QuotaEnforcementResult {
  deletedFiles: string[];
  remainingFilesCount: number;
  totalBytesAfter: number;
}

/**
 * FlowDiagnosticManager: Quản lý lưu trữ và vòng đời các file chẩn đoán (DOM & Screenshot).
 * 
 * TIÊU CHUẨN KỸ THUẬT (AC-6):
 * 1. Bền vững và Đúng chuẩn: Lưu tại app.getPath('userData')/diagnostics.
 *    Tuyệt đối KHÔNG dùng process.cwd().
 * 2. Giới hạn lưu trữ nghiêm ngặt (Strict Quota Enforcement):
 *    - Tối đa 20 file gần nhất.
 *    - Tổng dung lượng không vượt quá 50MB (52,428,800 bytes).
 *    - TTL: Tự động dọn dẹp các file cũ hơn 7 ngày.
 * 3. Atomic Safety: Ghi đĩa an toàn, tự động dọn dẹp file cũ nhất (FIFO pruning) khi vượt ngưỡng.
 */
export class FlowDiagnosticManager {
  private static instance: FlowDiagnosticManager | null = null;
  private diagnosticsDir: string;
  private maxFiles: number = 20;
  private maxTotalBytes: number = 50 * 1024 * 1024; // 50MB
  private maxAgeMs: number = 7 * 24 * 60 * 60 * 1000; // 7 ngày

  static getInstance(customDir?: string): FlowDiagnosticManager {
    if (!FlowDiagnosticManager.instance || customDir) {
      FlowDiagnosticManager.instance = new FlowDiagnosticManager(customDir);
    }
    return FlowDiagnosticManager.instance;
  }

  static resetInstance(): void {
    FlowDiagnosticManager.instance = null;
  }

  /**
   * Xác định thư mục lưu trữ diagnostics an toàn:
   * 1. customDir nếu có.
   * 2. process.env.FLOW_DIAGNOSTICS_DIR nếu có.
   * 3. app.getPath('userData')/diagnostics trong Electron runtime.
   * 4. os.tmpdir()/vanhsub_flow_storage/diagnostics ngoài Electron.
   * Tuyệt đối KHÔNG dùng process.cwd().
   */
  static resolveDiagnosticsDir(customDir?: string): string {
    if (customDir) {
      return path.resolve(customDir);
    }
    if (process.env.FLOW_DIAGNOSTICS_DIR) {
      return path.resolve(process.env.FLOW_DIAGNOSTICS_DIR);
    }
    if (process.versions && (process.versions as any).electron) {
      try {
        const electron = require('electron');
        const app = electron.app || electron.remote?.app;
        if (app && typeof app.getPath === 'function') {
          return path.join(app.getPath('userData'), 'diagnostics');
        }
      } catch {
        // ngoài electron runtime
      }
    }

    return path.join(os.tmpdir(), 'vanhsub_flow_storage', 'diagnostics');
  }

  constructor(customDir?: string) {
    this.diagnosticsDir = FlowDiagnosticManager.resolveDiagnosticsDir(customDir);
    this.ensureDirectory();
  }

  public getDiagnosticsDir(): string {
    return this.diagnosticsDir;
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.diagnosticsDir)) {
      fs.mkdirSync(this.diagnosticsDir, { recursive: true });
    }
  }

  /**
   * Lưu chuỗi DOM HTML snapshot xuống đĩa và thực thi quota enforcement.
   */
  async saveDOMSnapshot(taskId: string, htmlContent: string): Promise<string> {
    this.ensureDirectory();
    const safeTaskId = (taskId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `dom_${safeTaskId}_${Date.now()}.html`;
    const targetPath = path.join(this.diagnosticsDir, fileName);

    fs.writeFileSync(targetPath, htmlContent || '', 'utf-8');
    await this.enforceQuota();

    return targetPath;
  }

  /**
   * Lưu ảnh chụp màn hình (PNG Buffer) xuống đĩa và thực thi quota enforcement.
   */
  async saveScreenshot(taskId: string, imageBuffer: Buffer): Promise<string> {
    this.ensureDirectory();
    const safeTaskId = (taskId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `screenshot_${safeTaskId}_${Date.now()}.png`;
    const targetPath = path.join(this.diagnosticsDir, fileName);

    fs.writeFileSync(targetPath, imageBuffer);
    await this.enforceQuota();

    return targetPath;
  }

  /**
   * Liệt kê tất cả các file diagnostics hiện có kèm metadata dung lượng và thời gian.
   */
  listDiagnostics(): DiagnosticFileInfo[] {
    this.ensureDirectory();
    const results: DiagnosticFileInfo[] = [];

    try {
      const files = fs.readdirSync(this.diagnosticsDir);
      for (const f of files) {
        if (f.startsWith('.')) continue; // bỏ qua file ẩn hoặc temp
        const fullPath = path.join(this.diagnosticsDir, f);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            results.push({
              filePath: fullPath,
              fileName: f,
              sizeBytes: stat.size,
              mtimeMs: stat.mtimeMs,
            });
          }
        } catch {
          // ignore
        }
      }
    } catch (err: any) {
      console.warn('[FlowDiagnosticManager] Cảnh báo đọc danh sách diagnostics:', err?.message || err);
    }

    // Sắp xếp theo mtime tăng dần (cũ nhất đứng trước)
    return results.sort((a, b) => a.mtimeMs - b.mtimeMs);
  }

  /**
   * Thực thi giới hạn lưu trữ nghiêm ngặt (AC-6):
   * 1. Xóa các file quá hạn TTL (7 ngày).
   * 2. Giới hạn số lượng file tối đa (20 file).
   * 3. Giới hạn tổng dung lượng tối đa (50MB).
   */
  async enforceQuota(customLimits?: {
    maxFiles?: number;
    maxTotalBytes?: number;
    maxAgeMs?: number;
  }): Promise<QuotaEnforcementResult> {
    const limits = {
      maxFiles: customLimits?.maxFiles ?? this.maxFiles,
      maxTotalBytes: customLimits?.maxTotalBytes ?? this.maxTotalBytes,
      maxAgeMs: customLimits?.maxAgeMs ?? this.maxAgeMs,
    };

    const now = Date.now();
    const deletedFiles: string[] = [];

    let files = this.listDiagnostics();

    // 1. Quét xóa theo TTL (Quá hạn 7 ngày)
    const activeFiles: DiagnosticFileInfo[] = [];
    for (const file of files) {
      if (now - file.mtimeMs > limits.maxAgeMs) {
        try {
          fs.unlinkSync(file.filePath);
          deletedFiles.push(file.filePath);
        } catch {
          // ignore
        }
      } else {
        activeFiles.push(file);
      }
    }

    // 2. Giới hạn số lượng file tối đa (maxFiles) - Xóa từ file cũ nhất (FIFO)
    while (activeFiles.length > limits.maxFiles) {
      const oldest = activeFiles.shift();
      if (oldest) {
        try {
          fs.unlinkSync(oldest.filePath);
          deletedFiles.push(oldest.filePath);
        } catch {
          // ignore
        }
      }
    }

    // 3. Giới hạn tổng dung lượng tối đa (maxTotalBytes) - Tiếp tục xóa file cũ nhất nếu vẫn vượt
    let totalBytes = activeFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
    while (totalBytes > limits.maxTotalBytes && activeFiles.length > 0) {
      const oldest = activeFiles.shift();
      if (oldest) {
        try {
          fs.unlinkSync(oldest.filePath);
          deletedFiles.push(oldest.filePath);
          totalBytes -= oldest.sizeBytes;
        } catch {
          // ignore
        }
      }
    }

    return {
      deletedFiles,
      remainingFilesCount: activeFiles.length,
      totalBytesAfter: totalBytes,
    };
  }

  /**
   * Xóa sạch toàn bộ diagnostics (phục vụ test).
   */
  async clearAll(): Promise<void> {
    this.ensureDirectory();
    try {
      const files = fs.readdirSync(this.diagnosticsDir);
      for (const f of files) {
        try {
          fs.unlinkSync(path.join(this.diagnosticsDir, f));
        } catch {}
      }
    } catch {}
  }
}
