import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { FlowDiagnosticManager } from './FlowDiagnosticManager';
import { FlowCheckpointManager } from './FlowCheckpointManager';
import { FlowTaskQueue } from './FlowTaskQueue';
import { FlowMediaVerifier } from './FlowMediaVerifier';

export interface BundleManifestFileEntry {
  name: string;
  sizeBytes: number;
  sha256: string;
}

export interface BundleManifest {
  bundleId: string;
  createdAt: string;
  triggerReason: string;
  taskId?: string;
  environment: {
    platform: string;
    arch: string;
    nodeVersion: string;
    electronVersion: string;
    pid: number;
    uptimeSeconds: number;
    memoryUsage: NodeJS.MemoryUsage;
  };
  sessionSummary?: {
    currentProjectId?: string | null;
    status?: string;
  };
  files: BundleManifestFileEntry[];
}

export interface ExportBundleOptions {
  taskId?: string;
  triggerReason?: string;
  includeDiagnostics?: boolean;
  includeCheckpoints?: boolean;
  includeQueue?: boolean;
  includeSession?: boolean;
  maxDiagnosticsFiles?: number;
  customDir?: string;
  additionalFiles?: Array<{ name: string; content: string | Buffer }>;
}

export interface DebugBundleResult {
  bundleId: string;
  zipFilePath: string;
  sizeBytes: number;
  sha256: string;
  fileCount: number;
  manifest: BundleManifest;
}

export interface BundleFileInfo {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface BundleQuotaEnforcementResult {
  deletedFiles: string[];
  remainingBundlesCount: number;
  totalBytesAfter: number;
}

/**
 * Thuật toán đóng gói ZIP chuẩn PKWARE không phụ thuộc thư viện ngoài (Zero Dependency)
 */
class NativeZipBuilder {
  private entries: Array<{ name: string; content: Buffer }> = [];

  addFile(name: string, content: string | Buffer): void {
    const cleanName = name.replace(/\\/g, '/').replace(/^\/+/, '');
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
    this.entries.push({ name: cleanName, content: buf });
  }

  build(): Buffer {
    const localHeaders: Buffer[] = [];
    const centralHeaders: Buffer[] = [];
    let offset = 0;

    for (const entry of this.entries) {
      const nameBuf = Buffer.from(entry.name, 'utf-8');
      const uncompressedSize = entry.content.length;
      const crc = (zlib as any).crc32 ? (zlib as any).crc32(entry.content) : 0;
      const compressed = zlib.deflateRawSync(entry.content);
      const compressedSize = compressed.length;

      // 1. Local file header (30 bytes + filename)
      const lh = Buffer.alloc(30 + nameBuf.length);
      lh.writeUInt32LE(0x04034b50, 0); // Signature
      lh.writeUInt16LE(20, 4); // Version needed to extract (2.0)
      lh.writeUInt16LE(0, 6); // General purpose bit flag
      lh.writeUInt16LE(8, 8); // Compression method: Deflate
      lh.writeUInt32LE(0, 10); // Last mod file time & date
      lh.writeUInt32LE(crc, 14); // CRC-32
      lh.writeUInt32LE(compressedSize, 18); // Compressed size
      lh.writeUInt32LE(uncompressedSize, 22); // Uncompressed size
      lh.writeUInt16LE(nameBuf.length, 26); // File name length
      lh.writeUInt16LE(0, 28); // Extra field length
      nameBuf.copy(lh, 30);

      localHeaders.push(lh, compressed);

      // 2. Central directory header (46 bytes + filename)
      const ch = Buffer.alloc(46 + nameBuf.length);
      ch.writeUInt32LE(0x02014b50, 0); // Central directory signature
      ch.writeUInt16LE(20, 4); // Version made by
      ch.writeUInt16LE(20, 6); // Version needed to extract
      ch.writeUInt16LE(0, 8); // Bit flag
      ch.writeUInt16LE(8, 10); // Compression: Deflate
      ch.writeUInt32LE(0, 12); // Mod time
      ch.writeUInt32LE(crc, 16); // CRC-32
      ch.writeUInt32LE(compressedSize, 20); // Compressed size
      ch.writeUInt32LE(uncompressedSize, 24); // Uncompressed size
      ch.writeUInt16LE(nameBuf.length, 28); // File name length
      ch.writeUInt16LE(0, 30); // Extra field length
      ch.writeUInt16LE(0, 32); // File comment length
      ch.writeUInt16LE(0, 34); // Disk number start
      ch.writeUInt16LE(0, 36); // Internal file attributes
      ch.writeUInt32LE(0, 38); // External file attributes
      ch.writeUInt32LE(offset, 42); // Relative offset of local header
      nameBuf.copy(ch, 46);

      centralHeaders.push(ch);
      offset += lh.length + compressed.length;
    }

    const centralDirSize = centralHeaders.reduce((acc, h) => acc + h.length, 0);

    // 3. End of central directory record (EOCD - 22 bytes)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
    eocd.writeUInt16LE(0, 4); // Disk number
    eocd.writeUInt16LE(0, 6); // Disk where central dir starts
    eocd.writeUInt16LE(this.entries.length, 8); // Number of records on this disk
    eocd.writeUInt16LE(this.entries.length, 10); // Total number of records
    eocd.writeUInt32LE(centralDirSize, 12); // Size of central directory
    eocd.writeUInt32LE(offset, 16); // Offset of start of central directory
    eocd.writeUInt16LE(0, 20); // ZIP file comment length

    return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
  }
}

/**
 * FlowDebugBundleExporter: Bộ tổng hợp và đóng gói chẩn đoán lỗi (Phase 8 - Step 4)
 * 
 * TIÊU CHUẨN KỸ THUẬT:
 * 1. Bền vững và Đúng chuẩn: Lưu tại app.getPath('userData')/debug_bundles. Tuyệt đối KHÔNG dùng process.cwd().
 * 2. Tự động đóng gói ZIP: Không phụ thuộc vào thư viện ngoài, chuẩn PKWARE.
 * 3. Tẩy rửa dữ liệu nhạy cảm (Sanitization): Loại trừ triệt để Cookie, Token, Password trước khi export.
 * 4. Giới hạn lưu trữ nghiêm ngặt (Strict Quota): Tối đa 5 bundles gần nhất, 100MB, TTL 7 ngày.
 */
export class FlowDebugBundleExporter {
  private static instance: FlowDebugBundleExporter | null = null;
  private bundlesDir: string;
  private maxBundles: number = 5;
  private maxTotalBytes: number = 100 * 1024 * 1024; // 100MB
  private maxAgeMs: number = 7 * 24 * 60 * 60 * 1000; // 7 ngày

  static getInstance(customDir?: string): FlowDebugBundleExporter {
    if (!FlowDebugBundleExporter.instance || customDir) {
      FlowDebugBundleExporter.instance = new FlowDebugBundleExporter(customDir);
    }
    return FlowDebugBundleExporter.instance;
  }

  static resetInstance(): void {
    FlowDebugBundleExporter.instance = null;
  }

  /**
   * Xác định thư mục lưu trữ debug bundles an toàn:
   * 1. customDir nếu có.
   * 2. process.env.FLOW_DEBUG_BUNDLES_DIR nếu có.
   * 3. app.getPath('userData')/debug_bundles trong Electron runtime.
   * 4. os.tmpdir()/vanhsub_flow_storage/debug_bundles ngoài Electron.
   * Tuyệt đối KHÔNG dùng process.cwd().
   */
  static resolveBundlesDir(customDir?: string): string {
    if (customDir) {
      return path.resolve(customDir);
    }
    if (process.env.FLOW_DEBUG_BUNDLES_DIR) {
      return path.resolve(process.env.FLOW_DEBUG_BUNDLES_DIR);
    }
    if (process.versions && (process.versions as any).electron) {
      try {
        const electron = require('electron');
        const app = electron.app || electron.remote?.app;
        if (app && typeof app.getPath === 'function') {
          return path.join(app.getPath('userData'), 'debug_bundles');
        }
      } catch {
        // Ngoài electron runtime
      }
    }

    return path.join(os.tmpdir(), 'vanhsub_flow_storage', 'debug_bundles');
  }

  constructor(customDir?: string) {
    this.bundlesDir = FlowDebugBundleExporter.resolveBundlesDir(customDir);
    this.ensureDirectory();
  }

  public getBundlesDir(): string {
    return this.bundlesDir;
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.bundlesDir)) {
      fs.mkdirSync(this.bundlesDir, { recursive: true });
    }
  }

  /**
   * Làm sạch dữ liệu nhạy cảm (Cookie, Token, Secret, Password)
   */
  public static sanitizeData(input: any): any {
    if (input === null || input === undefined) return input;
    if (typeof input === 'string') {
      return input
        .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED_TOKEN]')
        .replace(/ya29\.[a-zA-Z0-9_-]+/g, '[REDACTED_OAUTH_TOKEN]')
        .replace(/(SID|HSID|SSID|__Secure-[^=]+)=[^;]+/gi, '$1=[REDACTED_COOKIE]');
    }

    if (Array.isArray(input)) {
      return input.map((item) => FlowDebugBundleExporter.sanitizeData(item));
    }

    if (typeof input === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(input)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('cookie') ||
          lowerKey.includes('token') ||
          lowerKey.includes('auth') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('password') ||
          lowerKey.includes('apikey') ||
          lowerKey.includes('api_key')
        ) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = FlowDebugBundleExporter.sanitizeData(value);
        }
      }
      return sanitized;
    }

    return input;
  }

  /**
   * Xuất toàn bộ gói chẩn đoán (Debug Bundle ZIP)
   */
  async exportBundle(options: ExportBundleOptions = {}): Promise<DebugBundleResult> {
    this.ensureDirectory();

    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const bundleId = `bundle_${options.taskId ? `${options.taskId}_` : ''}${timestamp}_${randomSuffix}`;
    const zipFileName = `${bundleId}.zip`;
    const zipFilePath = path.join(this.bundlesDir, zipFileName);

    const zipBuilder = new NativeZipBuilder();
    const manifestFiles: BundleManifestFileEntry[] = [];

    // Helper nạp file vào ZIP builder và ghi log manifest
    const addZipFile = (relativePath: string, content: string | Buffer) => {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
      const sha256 = FlowMediaVerifier.calculateBufferSha256(buf);
      zipBuilder.addFile(relativePath, buf);
      manifestFiles.push({
        name: relativePath,
        sizeBytes: buf.length,
        sha256,
      });
    };

    // 1. Thu thập Task Queue Snapshot (nếu được kích hoạt)
    if (options.includeQueue !== false) {
      try {
        const queue = FlowTaskQueue.getInstance();
        const allTasks = queue.getAll();
        const sanitizedTasks = FlowDebugBundleExporter.sanitizeData(allTasks);
        addZipFile('queue/tasks_snapshot.json', JSON.stringify(sanitizedTasks, null, 2));
      } catch (err: any) {
        addZipFile('queue/error.txt', `Không thể trích xuất hàng đợi: ${err.message}`);
      }
    }

    // 2. Thu thập Checkpoints
    if (options.includeCheckpoints !== false) {
      try {
        const cpMgr = FlowCheckpointManager.getInstance();
        if (options.taskId) {
          const cp = cpMgr.getLatestCheckpoint(options.taskId);
          if (cp) {
            addZipFile(`checkpoints/${options.taskId}.json`, JSON.stringify(FlowDebugBundleExporter.sanitizeData(cp), null, 2));
          }
        }

        // Đọc danh sách file checkpoint hiện có trên đĩa
        const cpDir = cpMgr.getCheckpointsDir();
        if (fs.existsSync(cpDir)) {
          const cpFiles = fs.readdirSync(cpDir).filter((f) => f.endsWith('.json')).slice(0, 10);
          for (const f of cpFiles) {
            if (options.taskId && f.startsWith(options.taskId)) continue; // Đã thêm ở trên
            try {
              const fullPath = path.join(cpDir, f);
              const data = fs.readFileSync(fullPath, 'utf-8');
              const parsed = JSON.parse(data);
              addZipFile(`checkpoints/${f}`, JSON.stringify(FlowDebugBundleExporter.sanitizeData(parsed), null, 2));
            } catch {}
          }
        }
      } catch (err: any) {
        addZipFile('checkpoints/error.txt', `Không thể trích xuất checkpoint: ${err.message}`);
      }
    }

    // 3. Thu thập Diagnostics (DOM Snapshot & Screenshots)
    if (options.includeDiagnostics !== false) {
      try {
        const diagMgr = FlowDiagnosticManager.getInstance();
        const allDiags = diagMgr.listDiagnostics();
        const maxFiles = options.maxDiagnosticsFiles ?? 10;

        // Nếu có taskId, ưu tiên lấy file của taskId
        let selectedDiags = allDiags;
        if (options.taskId) {
          const taskDiags = allDiags.filter((d) => d.fileName.includes(options.taskId!));
          const otherDiags = allDiags.filter((d) => !d.fileName.includes(options.taskId!));
          selectedDiags = [...taskDiags, ...otherDiags];
        }

        // Lấy tối đa maxFiles file gần nhất
        selectedDiags = selectedDiags.slice(-maxFiles);

        for (const diag of selectedDiags) {
          try {
            if (fs.existsSync(diag.filePath)) {
              const fileBuf = fs.readFileSync(diag.filePath);
              addZipFile(`diagnostics/${diag.fileName}`, fileBuf);
            }
          } catch {}
        }
      } catch (err: any) {
        addZipFile('diagnostics/error.txt', `Không thể trích xuất chẩn đoán: ${err.message}`);
      }
    }

    // 4. Bổ sung các file tùy biến nếu có
    if (options.additionalFiles && Array.isArray(options.additionalFiles)) {
      for (const addFile of options.additionalFiles) {
        if (addFile.name && addFile.content !== undefined) {
          addZipFile(addFile.name, addFile.content);
        }
      }
    }

    // 5. Tạo Manifest Metadata
    const manifest: BundleManifest = {
      bundleId,
      createdAt: new Date().toISOString(),
      triggerReason: options.triggerReason || 'MANUAL_EXPORT',
      taskId: options.taskId,
      environment: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: (process.versions as any)?.electron || 'standalone',
        pid: process.pid,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsage: process.memoryUsage(),
      },
      files: manifestFiles,
    };

    // Đưa manifest.json vào đầu gói ZIP
    addZipFile('manifest.json', JSON.stringify(manifest, null, 2));

    // 6. Đóng gói ZIP Buffer và ghi đĩa nguyên tử (Atomic Write)
    const zipBuffer = zipBuilder.build();
    const tempZipPath = `${zipFilePath}.tmp_${Date.now()}`;

    fs.writeFileSync(tempZipPath, zipBuffer);
    fs.renameSync(tempZipPath, zipFilePath);

    const finalSha256 = FlowMediaVerifier.calculateBufferSha256(zipBuffer);

    // 7. Thực thi Quota Enforcement trên thư mục debug_bundles
    await this.enforceQuota();

    console.log(
      `[FlowDebugBundleExporter] 📦 ĐÃ XUẤT DEBUG BUNDLE THÀNH CÔNG (${zipBuffer.length} bytes, ${manifestFiles.length} files) tại: ${zipFilePath}`
    );

    return {
      bundleId,
      zipFilePath,
      sizeBytes: zipBuffer.length,
      sha256: finalSha256,
      fileCount: manifestFiles.length,
      manifest,
    };
  }

  /**
   * Liệt kê các bundle hiện có trong thư mục lưu trữ
   */
  listBundles(): BundleFileInfo[] {
    this.ensureDirectory();
    const results: BundleFileInfo[] = [];

    try {
      const files = fs.readdirSync(this.bundlesDir);
      for (const f of files) {
        if (!f.endsWith('.zip') || f.startsWith('.')) continue;
        const fullPath = path.join(this.bundlesDir, f);
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
        } catch {}
      }
    } catch (err: any) {
      console.warn('[FlowDebugBundleExporter] Cảnh báo đọc danh sách bundles:', err?.message || err);
    }

    return results.sort((a, b) => a.mtimeMs - b.mtimeMs);
  }

  /**
   * Xóa một bundle theo ID hoặc tên file
   */
  deleteBundle(bundleIdentifier: string): boolean {
    this.ensureDirectory();
    const fileName = bundleIdentifier.endsWith('.zip') ? bundleIdentifier : `${bundleIdentifier}.zip`;
    const targetPath = path.join(this.bundlesDir, fileName);

    if (fs.existsSync(targetPath)) {
      try {
        fs.unlinkSync(targetPath);
        return true;
      } catch (err: any) {
        console.warn(`[FlowDebugBundleExporter] Không thể xóa bundle ${targetPath}:`, err?.message || err);
        return false;
      }
    }
    return false;
  }

  /**
   * Thực thi giới hạn quota:
   * 1. Xóa bundles quá hạn TTL 7 ngày.
   * 2. Giới hạn số lượng bundle tối đa (5).
   * 3. Giới hạn tổng dung lượng tối đa (100MB).
   */
  async enforceQuota(customLimits?: {
    maxBundles?: number;
    maxTotalBytes?: number;
    maxAgeMs?: number;
  }): Promise<BundleQuotaEnforcementResult> {
    const limits = {
      maxBundles: customLimits?.maxBundles ?? this.maxBundles,
      maxTotalBytes: customLimits?.maxTotalBytes ?? this.maxTotalBytes,
      maxAgeMs: customLimits?.maxAgeMs ?? this.maxAgeMs,
    };

    const now = Date.now();
    const deletedFiles: string[] = [];
    let bundles = this.listBundles();

    // 1. Quét xóa theo TTL (7 ngày)
    const activeBundles: BundleFileInfo[] = [];
    for (const b of bundles) {
      if (now - b.mtimeMs > limits.maxAgeMs) {
        try {
          fs.unlinkSync(b.filePath);
          deletedFiles.push(b.fileName);
        } catch {}
      } else {
        activeBundles.push(b);
      }
    }
    bundles = activeBundles;

    // 2. Giới hạn số lượng tối đa (FIFO pruning: xóa cũ nhất)
    while (bundles.length > limits.maxBundles) {
      const oldest = bundles.shift();
      if (oldest) {
        try {
          fs.unlinkSync(oldest.filePath);
          deletedFiles.push(oldest.fileName);
        } catch {}
      }
    }

    // 3. Giới hạn tổng dung lượng tối đa
    let totalBytes = bundles.reduce((acc, b) => acc + b.sizeBytes, 0);
    while (totalBytes > limits.maxTotalBytes && bundles.length > 0) {
      const oldest = bundles.shift();
      if (oldest) {
        try {
          fs.unlinkSync(oldest.filePath);
          deletedFiles.push(oldest.fileName);
          totalBytes -= oldest.sizeBytes;
        } catch {}
      }
    }

    return {
      deletedFiles,
      remainingBundlesCount: bundles.length,
      totalBytesAfter: totalBytes,
    };
  }
}
