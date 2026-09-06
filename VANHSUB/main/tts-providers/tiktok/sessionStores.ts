// Store sessionid cho app Electron — MÃ HOÁ bằng safeStorage (DPAPI trên
// Windows), cùng pattern với geminiApiKey trong settingsStore.ts.
//
// Lưu ý bảo mật:
// - File store chứa CHỈ chuỗi đã mã hoá (prefix 'enc:v1:') — không plaintext
//   khi hệ điều hành hỗ trợ mã hoá
// - Không có method nào trả sessionid cho renderer — renderer chỉ biết
//   has/clear qua IPC
// - Fallback plaintext chỉ xảy ra khi safeStorage không khả dụng (hiếm),
//   giống hệt hành vi của Gemini API key hiện tại

import fs from 'fs';
import { safeStorage } from 'electron';
import Store from 'electron-store';
import type { TikTokSessionStore } from './types';

const ENC_PREFIX = 'enc:v1:';

interface TikTokSessionSchema {
  /** sessionid ĐÃ MÃ HOÁ (prefix enc:v1:) hoặc plaintext fallback */
  sessionId: string;
  savedAt?: string;
}

export class ElectronTikTokSessionStore implements TikTokSessionStore {
  private store: Store<TikTokSessionSchema> | null = null;

  private getStore(): Store<TikTokSessionSchema> {
    if (!this.store) {
      this.store = new Store<TikTokSessionSchema>({
        name: 'vanhsub-tiktok-session',
        defaults: { sessionId: '' },
      });
    }
    return this.store;
  }

  /** sessionid đã giải mã — CHỈ gọi nội bộ main process, không trả qua IPC */
  load(): string {
    const raw = this.getStore().get('sessionId');
    if (!raw) return '';
    if (!raw.startsWith(ENC_PREFIX)) return raw; // dữ liệu cũ chưa mã hoá
    try {
      return safeStorage.decryptString(Buffer.from(raw.slice(ENC_PREFIX.length), 'base64'));
    } catch {
      // giải mã lỗi (đổi user/máy) — coi như mất session, người dùng nhập lại
      return '';
    }
  }

  save(sessionId: string): void {
    let stored = sessionId;
    try {
      if (safeStorage.isEncryptionAvailable()) {
        stored = ENC_PREFIX + safeStorage.encryptString(sessionId).toString('base64');
      }
    } catch {
      // không mã hoá được — rơi xuống plaintext (giống settingsStore)
    }
    this.getStore().set('sessionId', stored);
    this.getStore().set('savedAt', new Date().toISOString());
  }

  clear(): void {
    try {
      this.getStore().set('sessionId', '');
      this.getStore().set('savedAt', '');
      // Xoá file store hẳn khi rỗng — không để lại tàn dư credential
      const file = (this.getStore() as unknown as { path?: string }).path;
      if (file && fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // bỏ qua — session đã được set rỗng là đủ
    }
  }
}
