import { AsyncLocalStorage } from 'async_hooks';

interface MutexContext {
  ownerId: string;
}

/**
 * GoogleFlowBrowserMutex: Mutex toàn cục (Singleton) bảo vệ tài nguyên duy nhất `lobbyWindow`.
 * - Đảm bảo chỉ duy nhất 1 tác vụ được phép tương tác với cửa sổ Google Flow tại một thời điểm.
 * - Các tác vụ khác tự động xếp hàng (FIFO queue) và được giải phóng tuần tự theo thứ tự đến trước.
 * - Sử dụng AsyncLocalStorage để hỗ trợ re-entrant (nếu một hàm đã giữ lock gọi hàm con cũng yêu cầu lock,
 *   hàm con sẽ thực thi ngay lập tức mà không bị deadlock).
 * - Đảm bảo giải phóng lock 100% trong khối finally kể cả khi task gặp lỗi ngoại lệ.
 */
export class GoogleFlowBrowserMutex {
  private static instance: GoogleFlowBrowserMutex | null = null;
  private queue: Promise<any> = Promise.resolve();
  private storage = new AsyncLocalStorage<MutexContext>();
  private locked = false;
  private currentOwner: string | null = null;

  private constructor() {}

  public static getInstance(): GoogleFlowBrowserMutex {
    if (!this.instance) {
      this.instance = new GoogleFlowBrowserMutex();
    }
    return this.instance;
  }

  /**
   * Chạy một task bên trong mutex lock độc quyền.
   * @param task Hàm bất đồng bộ cần thực thi
   * @param ownerId Tên hoặc ID của node/task để ghi log theo dõi
   */
  public async runExclusive<T>(task: () => Promise<T>, ownerId: string = 'anonymous'): Promise<T> {
    const existingStore = this.storage.getStore();

    // 1. Kiểm tra Re-entrant: Nếu cùng một chuỗi async call đã giữ lock này, cho phép chạy tiếp ngay
    if (existingStore) {
      return await task();
    }

    // 2. Xếp hàng đợi Promise (FIFO queue)
    const prev = this.queue;
    let release: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    try {
      // Đợi task phía trước trong hàng đợi giải phóng lock
      await prev.catch(() => {});
      this.locked = true;
      this.currentOwner = ownerId;

      // Thực thi task bên trong ngữ cảnh AsyncLocalStorage
      return await this.storage.run({ ownerId }, async () => {
        return await task();
      });
    } finally {
      this.locked = false;
      this.currentOwner = null;
      release!();
    }
  }

  /**
   * Kiểm tra mutex hiện có đang bị chiếm giữ bởi tác vụ nào không
   */
  public isLocked(): boolean {
    return this.locked;
  }

  /**
   * Lấy ID/tên của tác vụ hiện đang nắm giữ mutex
   */
  public getCurrentOwner(): string | null {
    return this.currentOwner;
  }
}
