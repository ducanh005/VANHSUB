import Store from 'electron-store';
import { safeStorage } from 'electron';

export interface AppSettings {
  /** Lưu dưới dạng đã mã hoá (prefix 'enc:v1:' + base64) hoặc plaintext fallback */
  geminiApiKey: string;
  geminiModel: string;
  targetLanguage: string;
  /** Model ASR mặc định cho task mới (fallback của task.asrModel) */
  asrModel: string;
  /** Thư mục xuất video mặc định; rỗng = lưu cạnh file gốc */
  exportDir: string;
  /** Số dòng phụ đề mỗi request dịch */
  translateBatchSize: number;
  /** Số request dịch chạy song song */
  translateConcurrency: number;
  /** Tự động dịch ngay sau khi phiên âm xong */
  autoTranslateAfterAsr: boolean;
  /** VietTTS endpoint URL (mặc định: http://localhost:6006 cho Docker local) */
  vietTtsEndpoint: string;
  /** Giọng nói mặc định cho TTS */
  ttsVoice: string;
  /** Tốc độ TTS (0.5 - 2.0) */
  ttsSpeed: number;
  /** Ngôn ngữ quét OCR phụ đề cứng (mã tessdata: vie, eng, …) */
  ocrLanguage: string;
  /** Số khung hình quét mỗi giây khi OCR (0.5 - 5) */
  ocrFps: number;
  /** Vùng quét phụ đề trong khung hình: đáy khung hoặc toàn khung */
  ocrRegion: 'bottom' | 'full';
}

// Lazy singleton — cùng pattern với taskStore.ts để tránh lỗi
// "Please specify the projectName option" khi app chưa ready.
let _store: Store<AppSettings> | null = null;

function getStore(): Store<AppSettings> {
  if (!_store) {
    _store = new Store<AppSettings>({
      name: 'vanhsub-settings',
      // Cho phép script test (tsx ngoài Electron) trỏ đúng vào thư mục settings
      // của app — khi có cwd, electron-store không cần tự dò projectName nữa.
      ...(process.env.VANHSUB_SETTINGS_DIR ? { cwd: process.env.VANHSUB_SETTINGS_DIR } : {}),
      defaults: {
        geminiApiKey: '',
        geminiModel: 'gemini-flash-latest',
        targetLanguage: 'vi',
        asrModel: 'base',
        exportDir: '',
        translateBatchSize: 15,
        translateConcurrency: 1,
        autoTranslateAfterAsr: false,
        vietTtsEndpoint: 'http://localhost:6006',
        ttsVoice: 'default',
        ttsSpeed: 1.0,
        ocrLanguage: 'vie',
        ocrFps: 2,
        ocrRegion: 'bottom',
      },
    });
  }
  return _store;
}

// =========================================================================
// MÃ HOÁ SECRET — dùng safeStorage (DPAPI trên Windows).
// Chỉ gọi sau khi app ready (tất cả IPC handler đều post-ready).
// =========================================================================

const ENC_PREFIX = 'enc:v1:';

function encryptSecret(plain: string): string {
  if (!plain) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
    }
  } catch {
    // rơi xuống plaintext fallback bên dưới
  }
  return plain;
}

function decryptSecret(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith(ENC_PREFIX)) return stored; // dữ liệu cũ chưa mã hoá
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'));
  } catch {
    return '';
  }
}

export const SettingsStore = {
  /** get('geminiApiKey') trả về giá trị ĐÃ GIẢI MÃ; các key khác trả nguyên bản */
  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    const raw = getStore().get(key);
    if (key === 'geminiApiKey') {
      return decryptSecret(String(raw ?? '')) as AppSettings[K];
    }
    return raw;
  },

  /** set('geminiApiKey', plain) sẽ tự mã hoá trước khi lưu; các key khác lưu nguyên bản */
  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    if (key === 'geminiApiKey') {
      getStore().set(key, encryptSecret(String(value ?? '')) as AppSettings[K]);
      return;
    }
    getStore().set(key, value);
  },

  hasGeminiKey(): boolean {
    return getStore().get('geminiApiKey').trim().length > 0;
  },
};
