/**
 * Helper để detect hệ thống và recommend model Whisper
 * Dựa trên RAM, CPU cores để chọn model phù hợp
 */

export interface ModelInfo {
  name: string;
  displayName: string;
  size: string;
  sizeBytes: number;
  accuracy: string;
  speedCPU: string;
  ramRequired: number; // in MB
  cpuCoresMin: number;
  useCase: string;
}

export interface SystemInfo {
  totalMemory: number; // in MB
  freeMemory: number;
  cpuCores: number;
  cpuModel: string;
  platform: string;
}

export const WHISPER_MODELS: Record<string, ModelInfo> = {
  'tiny': {
    name: 'tiny',
    displayName: 'Tiny (Siêu nhanh)',
    size: '39 MB',
    sizeBytes: 39 * 1024 * 1024,
    accuracy: '~60% (Thấp)',
    speedCPU: 'Rất nhanh (~10x real-time)',
    ramRequired: 512, // 512 MB
    cpuCoresMin: 2,
    useCase: 'Demo, streaming, máy yếu',
  },
  'base': {
    name: 'base',
    displayName: 'Base (Cân bằng)',
    size: '140 MB',
    sizeBytes: 140 * 1024 * 1024,
    accuracy: '~70% (Tốt)',
    speedCPU: 'Nhanh (~5x real-time)',
    ramRequired: 1024, // 1 GB
    cpuCoresMin: 2,
    useCase: 'Khuyên dùng cho hầu hết máy (i5/i7)',
  },
  'small': {
    name: 'small',
    displayName: 'Small (Chất lượng cao)',
    size: '461 MB',
    sizeBytes: 461 * 1024 * 1024,
    accuracy: '~75% (Rất tốt)',
    speedCPU: 'Bình thường (~2x real-time)',
    ramRequired: 2048, // 2 GB
    cpuCoresMin: 4,
    useCase: 'Máy mid-range, độ chính xác quan trọng',
  },
  'medium': {
    name: 'medium',
    displayName: 'Medium (Chuyên nghiệp)',
    size: '1.5 GB',
    sizeBytes: 1500 * 1024 * 1024,
    accuracy: '~80% (Xuất sắc)',
    speedCPU: 'Chậm (~0.5x real-time)',
    ramRequired: 4096, // 4 GB
    cpuCoresMin: 4,
    useCase: 'Máy mạnh, production, yêu cầu độ chính xác cao',
  },
  'large': {
    name: 'large',
    displayName: 'Large (Cực chính xác)',
    size: '2.9 GB',
    sizeBytes: 2900 * 1024 * 1024,
    accuracy: '~85% (Siêu chính xác)',
    speedCPU: 'Rất chậm (~0.2x real-time)',
    ramRequired: 8192, // 8 GB
    cpuCoresMin: 8,
    useCase: 'Máy cao cấp, GPU CUDA/Metal khuyến nghị',
  },
};

/**
 * Recommend model dựa trên hệ thống
 * Ưu tiên: speed/resource vs accuracy
 */
export function recommendModel(systemInfo: SystemInfo): string {
  const { totalMemory, cpuCores } = systemInfo;
  const ramGB = totalMemory / 1024; // Convert to GB
  
  // Priority: Nếu RAM < 1.5 GB, dùng Tiny
  if (ramGB < 1.5) {
    return 'tiny';
  }
  
  // Nếu RAM < 2 GB, dùng Base
  if (ramGB < 2) {
    return 'base';
  }
  
  // Nếu RAM < 4 GB, kiểm tra CPU cores
  if (ramGB < 4) {
    // Nếu < 4 cores, dùng Base
    if (cpuCores < 4) {
      return 'base';
    }
    // Nếu >= 4 cores, dùng Small
    return 'small';
  }
  
  // Nếu RAM >= 4 GB
  if (cpuCores >= 8) {
    // Máy mạnh, dùng Medium hoặc Large
    return ramGB >= 8 ? 'large' : 'medium';
  }
  
  // RAM >= 4 GB nhưng CPU cores < 8, dùng Medium
  if (ramGB >= 4 && cpuCores >= 4) {
    return 'medium';
  }
  
  // Default: Small nếu RAM >= 4 GB, Small cores < 8
  return 'small';
}

/**
 * Lấy thông tin model từ tên
 */
export function getModelInfo(modelName: string): ModelInfo | undefined {
  return WHISPER_MODELS[modelName];
}

/**
 * Kiểm tra xem máy có đủ resource cho model không
 */
export function canRunModel(modelName: string, systemInfo: SystemInfo): {
  canRun: boolean;
  warnings: string[];
} {
  const model = WHISPER_MODELS[modelName];
  if (!model) return { canRun: false, warnings: ['Model không tìm thấy'] };
  
  const warnings: string[] = [];
  const { totalMemory, freeMemory, cpuCores } = systemInfo;
  
  // Kiểm tra RAM
  if (freeMemory < model.ramRequired) {
    warnings.push(
      `⚠️  RAM tự do (${(freeMemory / 1024).toFixed(1)} GB) < yêu cầu (${(model.ramRequired / 1024).toFixed(1)} GB). ` +
      `App có thể chạy chậm, khó khăn hoặc crash.`
    );
  }
  
  // Kiểm tra CPU cores
  if (cpuCores < model.cpuCoresMin) {
    warnings.push(
      `⚠️  CPU cores (${cpuCores}) < khuyến nghị (${model.cpuCoresMin}). ` +
      `Transcribe sẽ rất chậm.`
    );
  }
  
  // Nếu Large, khuyến cáo GPU
  if (modelName === 'large' && warnings.length === 0) {
    warnings.push(
      `💡 Large model khuyến cáo dùng GPU (CUDA/Metal) để tăng tốc độ 5-10x.`
    );
  }
  
  const canRun = warnings.length === 0 || freeMemory >= model.ramRequired * 0.8;
  return { canRun, warnings };
}

/**
 * Format file size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 10) / 10 + ' ' + sizes[i];
}

/**
 * Format RAM size (show in GB)
 */
export function formatRAM(mb: number): string {
  return (mb / 1024).toFixed(1) + ' GB';
}
