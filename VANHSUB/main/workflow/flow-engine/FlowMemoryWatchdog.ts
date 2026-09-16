/**
 * FlowMemoryWatchdog: Bộ giám sát tài nguyên và kiểm soát rò rỉ bộ nhớ (Phase 10 - Step 1)
 * 
 * TIÊU CHUẨN KỸ THUẬT:
 * 1. Giám sát kép (Dual-Process Memory Tracking):
 *    - Main Process: Theo dõi heapUsed, heapTotal, RSS qua process.memoryUsage().
 *    - Renderer Process: Theo dõi privateBytes, sharedBytes qua webContents.getProcessMemoryInfo().
 * 2. Ngưỡng an toàn bộ nhớ (Threshold Enforcement):
 *    - Cảnh báo và tự động kích hoạt dọn dẹp khi Main Heap > 400MB hoặc Renderer Private > 1000MB.
 * 3. Giải phóng áp lực bộ nhớ (Memory Pressure Relief):
 *    - Gọi V8 Garbage Collection (Node.js & Chromium) khi khả dụng.
 *    - Thu hồi các Object URLs (URL.revokeObjectURL) và dọn dẹp các detached media DOM nodes.
 * 4. Phát hiện rò rỉ Event Listener (Listener Leak Auditor):
 *    - Quét các listener gắn trên webContents, ipcMain, process để phát hiện nguy cơ memory leak.
 * 5. Tự động hóa chu kỳ (Automated Batch Relief):
 *    - Tự động kiểm tra và giảm tải bộ nhớ định kỳ sau mỗi N task (mặc định 5 task) chạy liên tục.
 */

import { EventEmitter } from 'events';

export interface ProcessMemorySnapshot {
  timestamp: number;
  mainHeapUsedMb: number;
  mainHeapTotalMb: number;
  mainRssMb: number;
  mainExternalMb: number;
  rendererPrivateMb?: number;
  rendererSharedMb?: number;
  taskCount: number;
}

export interface MemoryThresholdConfig {
  mainHeapThresholdMb?: number;        // Ngưỡng cảnh báo Heap Node.js (mặc định 400 MB)
  rendererPrivateThresholdMb?: number; // Ngưỡng cảnh báo Chromium Renderer (mặc định 1000 MB)
  maxGrowthPerBatchMb?: number;         // Tăng trưởng tối đa cho phép mỗi batch (mặc định 250 MB)
  autoReliefIntervalTasks?: number;     // Tần suất tự động kích hoạt dọn dẹp sau N task (mặc định 5)
  warnListenerCountThreshold?: number;  // Ngưỡng cảnh báo số lượng listener trên 1 event (mặc định 15)
}

export interface MemoryReliefResult {
  triggered: boolean;
  reason?: string;
  before: ProcessMemorySnapshot;
  after: ProcessMemorySnapshot;
  freedMainHeapMb: number;
  freedRendererPrivateMb?: number;
  gcRun: boolean;
  domCleaned: boolean;
}

export interface ListenerAuditReport {
  eventName: string;
  count: number;
  warning: boolean;
}

export class FlowMemoryWatchdog {
  private static instance: FlowMemoryWatchdog | null = null;

  private config: Required<MemoryThresholdConfig>;
  private history: ProcessMemorySnapshot[] = [];
  private taskCounter = 0;
  private baselineSnapshot: ProcessMemorySnapshot | null = null;

  private constructor(config?: MemoryThresholdConfig) {
    this.config = {
      mainHeapThresholdMb: config?.mainHeapThresholdMb ?? 400,
      rendererPrivateThresholdMb: config?.rendererPrivateThresholdMb ?? 1000,
      maxGrowthPerBatchMb: config?.maxGrowthPerBatchMb ?? 250,
      autoReliefIntervalTasks: config?.autoReliefIntervalTasks ?? 5,
      warnListenerCountThreshold: config?.warnListenerCountThreshold ?? 15,
    };
  }

  public static getInstance(config?: MemoryThresholdConfig): FlowMemoryWatchdog {
    if (!FlowMemoryWatchdog.instance) {
      FlowMemoryWatchdog.instance = new FlowMemoryWatchdog(config);
    }
    return FlowMemoryWatchdog.instance;
  }

  public static resetInstance(): void {
    FlowMemoryWatchdog.instance = null;
  }

  /**
   * Chụp ảnh nhanh (Snapshot) hiện trạng sử dụng bộ nhớ của hệ thống
   */
  public async takeSnapshot(win?: any): Promise<ProcessMemorySnapshot> {
    const mem = process.memoryUsage();
    const toMb = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 100) / 100;

    let rendererPrivateMb: number | undefined = undefined;
    let rendererSharedMb: number | undefined = undefined;

    if (win && !win.isDestroyed?.() && win.webContents?.getProcessMemoryInfo) {
      try {
        const pInfo = await win.webContents.getProcessMemoryInfo();
        if (pInfo) {
          // Chromium process memory info trả về đơn vị Kilobytes (KB)
          rendererPrivateMb = Math.round((pInfo.privateBytes / 1024) * 100) / 100;
          rendererSharedMb = Math.round((pInfo.sharedBytes / 1024) * 100) / 100;
        }
      } catch {
        // Cửa sổ có thể đang bận hoặc đang reload
      }
    }

    const snapshot: ProcessMemorySnapshot = {
      timestamp: Date.now(),
      mainHeapUsedMb: toMb(mem.heapUsed),
      mainHeapTotalMb: toMb(mem.heapTotal),
      mainRssMb: toMb(mem.rss),
      mainExternalMb: toMb(mem.external),
      rendererPrivateMb,
      rendererSharedMb,
      taskCount: this.taskCounter,
    };

    if (!this.baselineSnapshot) {
      this.baselineSnapshot = snapshot;
    }

    this.history.push(snapshot);
    if (this.history.length > 50) {
      this.history.shift();
    }

    return snapshot;
  }

  /**
   * Kiểm tra xem hiện trạng bộ nhớ có vượt ngưỡng an toàn hay không
   */
  public checkThresholds(snapshot: ProcessMemorySnapshot): { exceeded: boolean; reason?: string } {
    if (snapshot.mainHeapUsedMb > this.config.mainHeapThresholdMb) {
      return {
        exceeded: true,
        reason: `Main Process Heap (${snapshot.mainHeapUsedMb}MB) vượt ngưỡng an toàn (${this.config.mainHeapThresholdMb}MB).`,
      };
    }

    if (
      snapshot.rendererPrivateMb !== undefined &&
      snapshot.rendererPrivateMb > this.config.rendererPrivateThresholdMb
    ) {
      return {
        exceeded: true,
        reason: `Renderer Process Memory (${snapshot.rendererPrivateMb}MB) vượt ngưỡng an toàn (${this.config.rendererPrivateThresholdMb}MB).`,
      };
    }

    if (this.baselineSnapshot) {
      const growth = snapshot.mainHeapUsedMb - this.baselineSnapshot.mainHeapUsedMb;
      if (growth > this.config.maxGrowthPerBatchMb) {
        return {
          exceeded: true,
          reason: `Tăng trưởng Heap (+${Math.round(growth)}MB) vượt ngưỡng cho phép (+${this.config.maxGrowthPerBatchMb}MB).`,
        };
      }
    }

    return { exceeded: false };
  }

  /**
   * Kích hoạt quy trình giảm áp lực bộ nhớ (Memory Pressure Relief & GC)
   */
  public async performRelief(win?: any, reason = 'manual_trigger'): Promise<MemoryReliefResult> {
    const before = await this.takeSnapshot(win);
    let gcRun = false;
    let domCleaned = false;

    // 1. Dọn dẹp tài nguyên detached DOM, revoked blob URLs trong Renderer
    if (win && !win.isDestroyed?.() && win.webContents) {
      const cleanupJs = `
        (function() {
          let revokedCount = 0;
          try {
            // Thu hồi các Object URLs mồ côi
            const mediaList = Array.from(document.querySelectorAll('video, img, audio'));
            for (const el of mediaList) {
              const src = el.src || '';
              if (src.startsWith('blob:') && !el.isConnected) {
                try { URL.revokeObjectURL(src); } catch {}
                revokedCount++;
              }
            }
            // Kích hoạt Chromium V8 GC nếu cờ --js-flags="--expose-gc" được bật
            if (typeof window.gc === 'function') {
              window.gc();
            }
          } catch {}
          return { revokedCount };
        })()
      `;
      try {
        await win.webContents.executeJavaScript(cleanupJs, true);
        domCleaned = true;
      } catch {
        // Bỏ qua nếu trang không thể thực thi script lúc này
      }
    }

    // 2. Kích hoạt Node.js V8 GC nếu cờ --expose-gc được bật
    if (typeof (global as any).gc === 'function') {
      try {
        (global as any).gc();
        gcRun = true;
      } catch {}
    }

    const after = await this.takeSnapshot(win);
    const freedMainHeapMb = Math.round((before.mainHeapUsedMb - after.mainHeapUsedMb) * 100) / 100;
    let freedRendererPrivateMb: number | undefined = undefined;
    if (before.rendererPrivateMb !== undefined && after.rendererPrivateMb !== undefined) {
      freedRendererPrivateMb =
        Math.round((before.rendererPrivateMb - after.rendererPrivateMb) * 100) / 100;
    }

    return {
      triggered: true,
      reason,
      before,
      after,
      freedMainHeapMb,
      freedRendererPrivateMb,
      gcRun,
      domCleaned,
    };
  }

  /**
   * Hook ghi nhận khi một tác vụ kết thúc
   * Tự động kiểm tra ngưỡng và kích hoạt relief nếu đến chu kỳ hoặc bộ nhớ căng thẳng
   */
  public async recordTaskCompletion(
    win?: any,
    _taskId?: string
  ): Promise<MemoryReliefResult | null> {
    this.taskCounter++;
    const current = await this.takeSnapshot(win);
    const check = this.checkThresholds(current);

    // Kích hoạt nếu vượt ngưỡng hoặc đến chu kỳ định kỳ (ví dụ mỗi 5 tasks)
    const isIntervalBatch = this.taskCounter % this.config.autoReliefIntervalTasks === 0;

    if (check.exceeded) {
      return await this.performRelief(win, `threshold_exceeded: ${check.reason}`);
    } else if (isIntervalBatch) {
      return await this.performRelief(win, `periodic_interval: task #${this.taskCounter}`);
    }

    return null;
  }

  /**
   * Quét và kiểm toán các Event Listener trên EventEmitter (webContents, process, ipcMain)
   * Giúp phát hiện sớm các listener bị đăng ký lặp lại không được tháo gỡ
   */
  public auditListeners(emitter: any, threshold?: number): ListenerAuditReport[] {
    if (!emitter || typeof emitter.eventNames !== 'function') {
      return [];
    }

    const warnThreshold = threshold ?? this.config.warnListenerCountThreshold;
    const names = emitter.eventNames();
    const reports: ListenerAuditReport[] = [];

    for (const name of names) {
      const count = typeof emitter.listenerCount === 'function' ? emitter.listenerCount(name) : 0;
      const strName = typeof name === 'symbol' ? name.toString() : String(name);
      reports.push({
        eventName: strName,
        count,
        warning: count > warnThreshold,
      });
    }

    return reports.sort((a, b) => b.count - a.count);
  }

  public getHistory(): ProcessMemorySnapshot[] {
    return [...this.history];
  }

  public getTaskCount(): number {
    return this.taskCounter;
  }

  public getBaseline(): ProcessMemorySnapshot | null {
    return this.baselineSnapshot;
  }

  public resetHistory(): void {
    this.history = [];
    this.taskCounter = 0;
    this.baselineSnapshot = null;
  }
}
