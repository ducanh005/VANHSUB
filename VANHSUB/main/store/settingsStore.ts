import os from 'os';
import path from 'path';
import Store from 'electron-store';
import { safeStorage } from 'electron';

/**
 * Chiến lược tìm phụ đề khi quét OCR:
 * - auto:    quét TOÀN khung, tự phân loại band nào là phụ đề (bỏ watermark,
 *            logo, chữ trên cảnh) — không phụ thuộc vị trí phụ đề
 * - bottom:  chỉ quét dải 30% đáy khung (nhanh nhất)
 * - full:    quét toàn khung, giữ TẤT CẢ text tìm được
 * - custom:  quét vùng người dùng kéo chọn (ocrCustomRegion)
 */
export type OcrMode = 'auto' | 'bottom' | 'full' | 'custom';

/** Vùng quét custom — toạ độ theo tỷ lệ 0-1 của khung hình (x,y = đỉnh trái) */
export interface OcrCustomRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
  /** Chiến lược tìm phụ đề khi quét OCR (xem OcrMode) */
  ocrMode: OcrMode;
  /** Vùng quét khi ocrMode = custom (tỷ lệ 0-1); null = chưa chọn */
  ocrCustomRegion: OcrCustomRegion | null;
  /** Tương thích ngược với ocrRegion cũ */
  ocrRegion?: string;
  /**
   * Chạy lượt OCR thứ hai bằng Tesseract trên cùng crop đã enhance để đối
   * chiếu kết quả với PaddleOCR (chính xác hơn nhưng chậm hơn ~30-40%).
   */
  ocrDualEngine: boolean;
  /** Bảng thuật ngữ dịch nhất quán — mỗi dòng "gốc = bản dịch" */
  glossary: string;
  /** Hướng dẫn văn phong/xưng hô đưa vào prompt dịch (tự do) */
  translationStyleGuide: string;
  /** Đã xem popup hướng dẫn cho người dùng mới (không hiện lại) */
  onboardingCompleted: boolean;
  /** Chế độ tạo video Google Veo: 'free_session' | 'api_key' | 'simulation' */
  veoMode: 'free_session' | 'api_key' | 'simulation';
  /** Chuỗi Cookie phiên đăng nhập Google Labs (đã mã hóa an toàn) */
  veoSessionCookie: string;
  /** Auth / Bearer token Google Labs (đã mã hóa an toàn) */
  veoSessionAuthToken: string;
  /** Email tài khoản Google đăng nhập hiển thị */
  veoAccountEmail: string;
  /** Trạng thái session: active | expired | unauthenticated | rate_limited | captcha_required | unknown */
  veoSessionStatus: 'active' | 'expired' | 'unauthenticated' | 'rate_limited' | 'captcha_required' | 'unknown';
  /** Thời điểm kiểm tra trạng thái session lần cuối (timestamp ms) */
  veoLastChecked: number;
  /** Thời gian hồi chiêu chống spam (giây, mặc định 45) */
  veoCooldownSeconds: number;
}

// Lazy singleton — cùng pattern với taskStore.ts để tránh lỗi
// "Please specify the projectName option" khi app chưa ready.
let _store: Store<AppSettings> | null = null;

function getStore(): Store<AppSettings> {
  if (!_store) {
    let cwd: string | undefined = process.env.VANHSUB_SETTINGS_DIR;
    if (!cwd) {
      try {
        const electron = require('electron');
        const electronApp = electron.app;
        if (!electronApp?.name && !electronApp?.getPath) {
          cwd = path.join(os.tmpdir(), 'vanhsub-settings');
        }
      } catch {
        cwd = path.join(os.tmpdir(), 'vanhsub-settings');
      }
    }

    _store = new Store<AppSettings>({
      name: 'vanhsub-settings',
      // Cho phép script test (tsx ngoài Electron) trỏ đúng vào thư mục settings
      // của app — khi có cwd, electron-store không cần tự dò projectName nữa.
      ...(cwd ? { cwd } : {}),
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
        ocrMode: 'auto',
        ocrCustomRegion: null,
        ocrDualEngine: true,
        glossary: '',
        translationStyleGuide: '',
        onboardingCompleted: false,
        veoMode: 'free_session',
        veoSessionCookie: '',
        veoSessionAuthToken: '',
        veoAccountEmail: '',
        veoSessionStatus: 'unauthenticated',
        veoLastChecked: 0,
        veoCooldownSeconds: 45,
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
const ENCRYPTED_KEYS = new Set(['geminiApiKey', 'veoSessionCookie', 'veoSessionAuthToken']);

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
  /** get() tự động giải mã các secret (geminiApiKey, veoSessionCookie, veoSessionAuthToken) */
  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    const raw = getStore().get(key);
    if (ENCRYPTED_KEYS.has(key)) {
      return decryptSecret(String(raw ?? '')) as AppSettings[K];
    }
    return raw;
  },

  /** set() tự động mã hoá các secret trước khi lưu */
  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    if (ENCRYPTED_KEYS.has(key)) {
      getStore().set(key, encryptSecret(String(value ?? '')) as AppSettings[K]);
      return;
    }
    getStore().set(key, value);
  },

  hasGeminiKey(): boolean {
    return getStore().get('geminiApiKey').trim().length > 0;
  },

  hasVeoSession(): boolean {
    const cookie = decryptSecret(String(getStore().get('veoSessionCookie') ?? '')).trim();
    const token = decryptSecret(String(getStore().get('veoSessionAuthToken') ?? '')).trim();
    return cookie.length > 0 || token.length > 0;
  },
};
