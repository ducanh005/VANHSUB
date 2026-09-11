import type { ModelAdapter } from './types';
import { GoogleFlowAdapter } from './GoogleFlowAdapter';

export class AdapterRegistry {
  private static instance: AdapterRegistry;
  private adapters = new Map<string, ModelAdapter>();

  private constructor() {
    this.register(new GoogleFlowAdapter());
  }

  public static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }

  public register(adapter: ModelAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  public get(provider: string): ModelAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      // Fallback về GoogleFlowAdapter nếu chưa hỗ trợ
      return this.adapters.get('google-flow')!;
    }
    return adapter;
  }
}
