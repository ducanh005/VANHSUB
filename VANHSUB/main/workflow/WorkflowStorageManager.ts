import fs from 'fs';
import path from 'path';
import os from 'os';
import { app } from 'electron';

export interface StorageStats {
  tempDir: string;
  folderCount: number;
  fileCount: number;
  totalSizeBytes: number;
  totalSizeMb: number;
}

export interface CleanupResult {
  freedBytes: number;
  freedMb: number;
  deletedFolders: number;
  deletedFiles: number;
  errors: string[];
}

/**
 * WorkflowStorageManager: Quản lý và tự động dọn dẹp bộ nhớ đĩa tạm (Disk Garbage Collector)
 * - Quét thư mục tạm `%TEMP%\vanhsub_workflow`
 * - Tự động xóa an toàn các thư mục workflow cũ hơn 24 giờ
 * - Ngăn chặn xóa nhầm các workflow đang thực thi
 * - Cung cấp API kiểm tra dung lượng và dọn dẹp tức thời
 */
export class WorkflowStorageManager {
  private static instance: WorkflowStorageManager | null = null;
  private cleanupIntervalTimer: NodeJS.Timeout | null = null;
  private readonly tempBaseDir: string;

  private constructor() {
    this.tempBaseDir = path.join(
      app?.getPath?.('temp') || os.tmpdir(),
      'vanhsub_workflow'
    );
  }

  public static getInstance(): WorkflowStorageManager {
    if (!WorkflowStorageManager.instance) {
      WorkflowStorageManager.instance = new WorkflowStorageManager();
    }
    return WorkflowStorageManager.instance;
  }

  public getBaseTempDir(): string {
    return this.tempBaseDir;
  }

  /**
   * Tính toán thống kê dung lượng hiện tại của thư mục tạm workflow
   */
  public async getStorageStats(): Promise<StorageStats> {
    if (!fs.existsSync(this.tempBaseDir)) {
      return {
        tempDir: this.tempBaseDir,
        folderCount: 0,
        fileCount: 0,
        totalSizeBytes: 0,
        totalSizeMb: 0,
      };
    }

    let folderCount = 0;
    let fileCount = 0;
    let totalSizeBytes = 0;

    const traverse = (dirPath: string) => {
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            folderCount++;
            traverse(fullPath);
          } else if (entry.isFile()) {
            fileCount++;
            try {
              const stat = fs.statSync(fullPath);
              totalSizeBytes += stat.size;
            } catch {}
          }
        }
      } catch {}
    };

    traverse(this.tempBaseDir);

    return {
      tempDir: this.tempBaseDir,
      folderCount,
      fileCount,
      totalSizeBytes,
      totalSizeMb: Math.round((totalSizeBytes / (1024 * 1024)) * 10) / 10,
    };
  }

  /**
   * Dọn dẹp các thư mục workflow tạm có mtime cũ hơn maxAgeHours (mặc định 24h)
   * Loại trừ danh sách các workflowId đang hoạt động
   */
  public async cleanupOldTempFiles(
    maxAgeHours = 24,
    activeWorkflowIds: string[] = []
  ): Promise<CleanupResult> {
    const result: CleanupResult = {
      freedBytes: 0,
      freedMb: 0,
      deletedFolders: 0,
      deletedFiles: 0,
      errors: [],
    };

    if (!fs.existsSync(this.tempBaseDir)) {
      return result;
    }

    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const activeSet = new Set(activeWorkflowIds);

    try {
      const items = fs.readdirSync(this.tempBaseDir, { withFileTypes: true });

      for (const item of items) {
        const itemPath = path.join(this.tempBaseDir, item.name);

        // Bỏ qua workflow đang chạy
        if (activeSet.has(item.name)) {
          continue;
        }

        try {
          const stat = fs.statSync(itemPath);
          const ageMs = now - stat.mtimeMs;

          if (ageMs >= maxAgeMs) {
            if (item.isDirectory()) {
              const size = this.calcDirectorySize(itemPath);
              fs.rmSync(itemPath, { recursive: true, force: true });
              result.freedBytes += size;
              result.deletedFolders++;
            } else if (item.isFile()) {
              const size = stat.size;
              fs.unlinkSync(itemPath);
              result.freedBytes += size;
              result.deletedFiles++;
            }
          }
        } catch (err: any) {
          result.errors.push(`Không thể xóa ${item.name}: ${err?.message || err}`);
        }
      }
    } catch (err: any) {
      result.errors.push(`Lỗi đọc thư mục tạm: ${err?.message || err}`);
    }

    result.freedMb = Math.round((result.freedBytes / (1024 * 1024)) * 10) / 10;
    console.log(
      `[WorkflowStorageManager] 🧹 Đã dọn dẹp: ${result.deletedFolders} thư mục, ${result.deletedFiles} files, giải phóng ${result.freedMb} MB.`
    );
    return result;
  }

  /**
   * Xóa toàn bộ file và thư mục tạm (ngoại trừ workflow đang chạy)
   */
  public async clearAllTempFiles(activeWorkflowIds: string[] = []): Promise<CleanupResult> {
    return this.cleanupOldTempFiles(0, activeWorkflowIds);
  }

  /**
   * Bắt đầu vòng lặp dọn dẹp định kỳ chạy ngầm (mặc định mỗi 6 giờ)
   */
  public startPeriodicCleanup(intervalHours = 6): void {
    if (this.cleanupIntervalTimer) return;

    const intervalMs = intervalHours * 60 * 60 * 1000;
    // Chạy một lần dọn dẹp khởi động (delay 1 phút sau khi app boot để tránh giật lag)
    setTimeout(() => {
      this.cleanupOldTempFiles(24).catch((err) =>
        console.warn('[WorkflowStorageManager] Lỗi dọn dẹp khởi động:', err)
      );
    }, 60_000);

    this.cleanupIntervalTimer = setInterval(() => {
      this.cleanupOldTempFiles(24).catch((err) =>
        console.warn('[WorkflowStorageManager] Lỗi dọn dẹp định kỳ:', err)
      );
    }, intervalMs);

    if (this.cleanupIntervalTimer.unref) {
      this.cleanupIntervalTimer.unref();
    }
  }

  public stopPeriodicCleanup(): void {
    if (this.cleanupIntervalTimer) {
      clearInterval(this.cleanupIntervalTimer);
      this.cleanupIntervalTimer = null;
    }
  }

  private calcDirectorySize(dirPath: string): number {
    let size = 0;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          size += this.calcDirectorySize(fullPath);
        } else if (entry.isFile()) {
          try {
            size += fs.statSync(fullPath).size;
          } catch {}
        }
      }
    } catch {}
    return size;
  }
}
