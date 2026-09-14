import type { NodeAdapter } from './types';
import { GoogleFlowImageAdapter } from './adapters/GoogleFlowImageAdapter';
import { GoogleFlowVideoAdapter } from './adapters/GoogleFlowVideoAdapter';

/**
 * NodeAdapterRegistry: Nơi đăng ký và quản lý các loại Adapter theo node.type.
 * - Cho phép cắm (plug-in) các adapter khác nhau (automation, official API, script, mock...).
 * - Engine chỉ cần gọi registry.get(node.type) mà không cần biết triển khai cụ thể bên dưới.
 */
export class NodeAdapterRegistry {
  private static instance: NodeAdapterRegistry | null = null;
  private adapters = new Map<string, NodeAdapter>();

  constructor() {
    this.registerDefaults();
  }

  public static getInstance(): NodeAdapterRegistry {
    if (!this.instance) {
      this.instance = new NodeAdapterRegistry();
    }
    return this.instance;
  }

  /**
   * Đăng ký các adapter mặc định có sẵn trong hệ thống
   */
  private registerDefaults(): void {
    // 1. Google Flow Browser Automation adapters
    this.register('google_flow_image', new GoogleFlowImageAdapter());
    this.register('google_flow_video', new GoogleFlowVideoAdapter());

    // 2. Chỗ sẵn cho Native API adapters (sẽ đăng ký khi cấu hình API key chính thức)
    // this.register('native_api_image', new GeminiNativeApiImageAdapter());
  }

  /**
   * Đăng ký một adapter cho một kiểu node
   */
  public register(type: string, adapter: NodeAdapter): void {
    this.adapters.set(type, adapter);
  }

  /**
   * Huỷ đăng ký một adapter
   */
  public unregister(type: string): void {
    this.adapters.delete(type);
  }

  /**
   * Lấy adapter tương ứng với node.type
   */
  public get(type: string): NodeAdapter | undefined {
    return this.adapters.get(type);
  }

  /**
   * Kiểm tra một kiểu node đã có adapter hỗ trợ chưa
   */
  public has(type: string): boolean {
    return this.adapters.has(type);
  }

  /**
   * Danh sách tất cả các loại node được hỗ trợ
   */
  public listTypes(): string[] {
    return Array.from(this.adapters.keys());
  }
}
