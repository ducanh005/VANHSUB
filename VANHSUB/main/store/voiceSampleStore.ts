import fs from 'fs';
import path from 'path';
import Store from 'electron-store';
import { app } from 'electron';

/**
 * Quản lý giọng đọc clone từ file audio mẫu (zero-shot voice cloning).
 *
 * Server VietTTS không lưu voice tự tạo — mỗi lần tạo audio bằng giọng clone
 * phải gửi kèm file giọng mẫu qua POST /v1/tts. Vì vậy app lưu file mẫu
 * (copy vào userData) + metadata để tái sử dụng trong các lần tạo sau.
 */

export interface VoiceSample {
  /** Tên giọng người dùng đặt — dùng làm voice id trong UI và voiceOverrides */
  name: string;
  /** Tên file audio đã lưu trong thư mục voice-samples */
  fileName: string;
  /** Tên file gốc khi người dùng chọn */
  originalName: string;
  createdAt: string;
}

interface VoiceSampleSchema {
  samples: VoiceSample[];
}

// Lazy singleton — cùng pattern với settingsStore.ts
let _store: Store<VoiceSampleSchema> | null = null;

function getStore(): Store<VoiceSampleSchema> {
  if (!_store) {
    _store = new Store<VoiceSampleSchema>({
      name: 'vanhsub-voice-samples',
      defaults: { samples: [] },
    });
  }
  return _store;
}

function getSamplesDir(): string {
  // Cho phép script test trỏ sang thư mục tạm thay vì userData của app
  if (process.env.VANHSUB_VOICE_SAMPLES_DIR) {
    return process.env.VANHSUB_VOICE_SAMPLES_DIR;
  }
  return path.join(app.getPath('userData'), 'voice-samples');
}

/** Tên file hợp lệ: chữ/số/khoảng cách/dấu tiếng Việt, tối đa 40 ký tự */
function validateName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Tên giọng không được để trống.');
  if (trimmed.length > 40) throw new Error('Tên giọng tối đa 40 ký tự.');
  if (/[/\\:*?"<>|]/.test(trimmed)) throw new Error('Tên giọng không được chứa ký tự đặc biệt.');
}

export const VoiceSampleStore = {
  list(): VoiceSample[] {
    return getStore().get('samples');
  },

  exists(name: string): boolean {
    const target = name.trim().toLowerCase();
    return this.list().some((s) => s.name.toLowerCase() === target);
  },

  /** Đường dẫn file audio mẫu của 1 giọng, hoặc null nếu tên không tồn tại */
  getPath(name: string): string | null {
    const target = name.trim().toLowerCase();
    const sample = this.list().find((s) => s.name.toLowerCase() === target);
    if (!sample) return null;
    const filePath = path.join(getSamplesDir(), sample.fileName);
    return fs.existsSync(filePath) ? filePath : null;
  },

  /**
   * Thêm giọng mới: copy file audio mẫu vào thư mục lưu trữ rồi ghi metadata.
   * Tên giọng không phân biệt hoa/thường khi kiểm tra trùng.
   */
  add({ name, sourcePath }: { name: string; sourcePath: string }): VoiceSample {
    validateName(name);
    const trimmed = name.trim();
    if (this.exists(trimmed)) {
      throw new Error(`Đã tồn tại giọng tên "${trimmed}". Hãy chọn tên khác.`);
    }
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Không tìm thấy file audio: ${sourcePath}`);
    }

    const dir = getSamplesDir();
    fs.mkdirSync(dir, { recursive: true });

    const ext = path.extname(sourcePath).toLowerCase() || '.wav';
    const fileName = `${Date.now()}-${trimmed.replace(/[^\p{L}\p{N}]+/gu, '-')}${ext}`;
    fs.copyFileSync(sourcePath, path.join(dir, fileName));

    const sample: VoiceSample = {
      name: trimmed,
      fileName,
      originalName: path.basename(sourcePath),
      createdAt: new Date().toISOString(),
    };
    getStore().set('samples', [...this.list(), sample]);
    return sample;
  },

  /** Xoá giọng + file audio mẫu tương ứng (nếu còn) */
  remove(name: string): void {
    const target = name.trim().toLowerCase();
    const samples = this.list();
    const sample = samples.find((s) => s.name.toLowerCase() === target);
    if (!sample) return;

    const filePath = path.join(getSamplesDir(), sample.fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    getStore().set('samples', samples.filter((s) => s.name.toLowerCase() !== target));
  },
};
