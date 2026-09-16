import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { FinderStrategy } from './FlowElementFinder';

export interface RememberedSelector {
  elementKey: string;
  selector: string;
  strategy: FinderStrategy;
  confidence: number;
  containerSelector?: string;
  hitCount: number;
  consecutiveFailures: number;
  lastSuccessAt: number;
  lastFailureAt?: number;
}

export interface SelectorMemoryStoreData {
  version: number;
  updatedAt: number;
  selectors: Record<string, RememberedSelector>;
}

/**
 * FlowSelectorMemory: Bộ nhớ đệm tự thích ứng lưu trữ các bộ chọn DOM thành công (Phase 9 - Step 1)
 * 
 * TIÊU CHUẨN KỸ THUẬT:
 * 1. Bền vững và Đúng chuẩn: Lưu tại app.getPath('userData')/flow_selector_memory.json.
 *    Tuyệt đối KHÔNG dùng process.cwd().
 * 2. Fast-Path Short Circuit: Cho phép truy xuất tức thì (<10ms) selector thành công gần nhất.
 * 3. Tự thích nghi & Tự học lại (Adaptive Re-Learning):
 *    - Reset cờ failure khi tìm thấy.
 *    - Tự động hạ điểm và xóa bỏ khi thất bại liên tiếp (>= 3 lần).
 * 4. Atomic Safety: Ghi đĩa nguyên tử thông qua file tạm + rename chống hỏng file.
 */
export class FlowSelectorMemory {
  private static instance: FlowSelectorMemory | null = null;
  private storagePath: string;
  private memoryCache: Map<string, RememberedSelector> = new Map();
  private isInitialized = false;
  private writeMutex: Promise<void> = Promise.resolve();
  private readonly maxFailures = 3;
  private readonly ttlMs = 14 * 24 * 60 * 60 * 1000; // 14 ngày

  static getInstance(customPath?: string): FlowSelectorMemory {
    if (!FlowSelectorMemory.instance || customPath) {
      FlowSelectorMemory.instance = new FlowSelectorMemory(customPath);
    }
    return FlowSelectorMemory.instance;
  }

  static resetInstance(): void {
    FlowSelectorMemory.instance = null;
  }

  /**
   * Xác định đường dẫn file lưu trữ an toàn:
   * 1. customPath nếu có.
   * 2. process.env.FLOW_SELECTOR_MEMORY_PATH nếu có.
   * 3. app.getPath('userData')/flow_selector_memory.json trong Electron runtime.
   * 4. os.tmpdir()/vanhsub_flow_storage/flow_selector_memory.json ngoài Electron.
   * Tuyệt đối KHÔNG dùng process.cwd().
   */
  static resolveStoragePath(customPath?: string): string {
    if (customPath) {
      return path.resolve(customPath);
    }
    if (process.env.FLOW_SELECTOR_MEMORY_PATH) {
      return path.resolve(process.env.FLOW_SELECTOR_MEMORY_PATH);
    }
    if (process.versions && (process.versions as any).electron) {
      try {
        const electron = require('electron');
        const app = electron.app || electron.remote?.app;
        if (app && typeof app.getPath === 'function') {
          return path.join(app.getPath('userData'), 'flow_selector_memory.json');
        }
      } catch {
        // Ngoài electron runtime
      }
    }

    return path.join(os.tmpdir(), 'vanhsub_flow_storage', 'flow_selector_memory.json');
  }

  constructor(customPath?: string) {
    this.storagePath = FlowSelectorMemory.resolveStoragePath(customPath);
    this.loadFromDiskSync();
  }

  public getStoragePath(): string {
    return this.storagePath;
  }

  private ensureDirectory(): void {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Đọc dữ liệu từ đĩa đồng bộ khi khởi tạo
   */
  private loadFromDiskSync(): void {
    try {
      this.ensureDirectory();
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf-8');
        const parsed: SelectorMemoryStoreData = JSON.parse(raw);
        if (parsed && parsed.selectors && typeof parsed.selectors === 'object') {
          const now = Date.now();
          for (const [k, v] of Object.entries(parsed.selectors)) {
            // Loại bỏ các selector quá hạn TTL
            if (v && v.lastSuccessAt && now - v.lastSuccessAt < this.ttlMs) {
              this.memoryCache.set(k, v);
            }
          }
        }
      }
      this.isInitialized = true;
    } catch (err: any) {
      console.warn('[FlowSelectorMemory] Khởi tạo bộ nhớ selector rỗng do lỗi đọc:', err?.message || err);
      this.memoryCache.clear();
      this.isInitialized = true;
    }
  }

  /**
   * Lưu dữ liệu xuống đĩa nguyên tử (Atomic Write)
   */
  private async persist(): Promise<void> {
    this.writeMutex = this.writeMutex.then(async () => {
      try {
        this.ensureDirectory();
        const data: SelectorMemoryStoreData = {
          version: 1,
          updatedAt: Date.now(),
          selectors: Object.fromEntries(this.memoryCache.entries()),
        };
        const tempPath = `${this.storagePath}.tmp_${Date.now()}`;
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tempPath, this.storagePath);
      } catch (err: any) {
        console.warn('[FlowSelectorMemory] Lỗi ghi đĩa bộ nhớ selector:', err?.message || err);
      }
    });

    return this.writeMutex;
  }

  /**
   * Lấy selector đã ghi nhớ cho một phần tử giao diện
   * Trả về null nếu chưa có hoặc đã thất bại liên tiếp >= maxFailures
   */
  getRemembered(elementKey: string): RememberedSelector | null {
    if (!elementKey) return null;
    const entry = this.memoryCache.get(elementKey);
    if (!entry) return null;

    if (entry.consecutiveFailures >= this.maxFailures) {
      return null;
    }

    return { ...entry };
  }

  /**
   * Ghi nhận thành công: cập nhật hitCount, reset failures, tăng độ tin cậy
   */
  async recordSuccess(
    elementKey: string,
    selector: string,
    strategy: FinderStrategy,
    confidence: number,
    containerSelector?: string
  ): Promise<void> {
    if (!elementKey || !selector) return;

    const existing = this.memoryCache.get(elementKey);
    const now = Date.now();

    const updated: RememberedSelector = {
      elementKey,
      selector,
      strategy,
      confidence,
      containerSelector,
      hitCount: (existing?.selector === selector ? existing.hitCount : 0) + 1,
      consecutiveFailures: 0,
      lastSuccessAt: now,
    };

    this.memoryCache.set(elementKey, updated);
    await this.persist();
  }

  /**
   * Ghi nhận thất bại: tăng consecutiveFailures, tự động invalidate nếu vượt quá ngưỡng
   */
  async recordFailure(elementKey: string): Promise<void> {
    if (!elementKey) return;

    const existing = this.memoryCache.get(elementKey);
    if (!existing) return;

    const now = Date.now();
    existing.consecutiveFailures = (existing.consecutiveFailures || 0) + 1;
    existing.lastFailureAt = now;

    if (existing.consecutiveFailures >= this.maxFailures) {
      console.log(
        `[FlowSelectorMemory] 🔄 Selector cho [${elementKey}] đã thất bại liên tiếp ${existing.consecutiveFailures} lần. Tự động chuyển sang chế độ Re-Learn.`
      );
    }

    this.memoryCache.set(elementKey, existing);
    await this.persist();
  }

  /**
   * Hủy bỏ bộ nhớ cho một phần tử cụ thể
   */
  async invalidate(elementKey: string): Promise<boolean> {
    if (this.memoryCache.has(elementKey)) {
      this.memoryCache.delete(elementKey);
      await this.persist();
      return true;
    }
    return false;
  }

  /**
   * Xóa toàn bộ bộ nhớ selector
   */
  async clearAll(): Promise<void> {
    this.memoryCache.clear();
    await this.persist();
  }

  /**
   * Lấy toàn bộ bộ nhớ hiện tại
   */
  getAll(): Record<string, RememberedSelector> {
    return Object.fromEntries(this.memoryCache.entries());
  }

  /**
   * Thống kê bộ nhớ selector
   */
  getStats(): { totalKeys: number; totalHits: number; activeKeys: number } {
    let totalHits = 0;
    let activeKeys = 0;
    for (const v of this.memoryCache.values()) {
      totalHits += v.hitCount;
      if (v.consecutiveFailures < this.maxFailures) {
        activeKeys++;
      }
    }
    return {
      totalKeys: this.memoryCache.size,
      totalHits,
      activeKeys,
    };
  }
}
