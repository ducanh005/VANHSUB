// Quản lý sessionid TikTok — ĐỐI XỬ LÝ NHƯ CREDENTIAL:
// - Không log ra console/file log/error message
// - Không trả về renderer (IPC chỉ trả trạng thái has/clear)
// - Lưu qua TikTokSessionStore — app chính dùng safeStorage (DPAPI),
//   test script dùng biến môi trường (không persist)
// - Chỉ chấp nhận session do CHÍNH NGƯỜI DÙNG nhập, không có cơ chế nào
//   lấy session của tài khoản khác

import { TikTokTTSError } from './types';
import type { TikTokSessionStore } from './types';

/** sessionid TikTok là chuỗi alphanumeric ~32 ký tự — kiểm tra MỀM (format, không đoán nội dung) */
const SESSION_FORMAT_RE = /^[A-Za-z0-9_-]{16,64}$/;

export class TikTokSessionManager {
  constructor(private readonly store: TikTokSessionStore) {}

  /** Kiểm format không cần lưu — dùng bởi save() và script test */
  static isValidFormat(value: string): boolean {
    return SESSION_FORMAT_RE.test(value);
  }

  /** sessionid đã trim — CHỈ dùng nội bộ để đặt header Cookie. Không log giá trị này. */
  getSessionId(): string {
    return this.store.load().trim();
  }

  hasSession(): boolean {
    return this.getSessionId().length > 0;
  }

  /**
   * Lưu sessionid do người dùng nhập. Ném TikTokTTSError (SESSION_MISSING/BAD_REQUEST)
   * nếu rỗng hoặc sai format — message không bao giờ lặp lại giá trị đầu vào.
   */
  save(sessionId: string): void {
    const value = String(sessionId || '').trim();
    if (!value) {
      throw new TikTokTTSError(
        'SESSION_MISSING',
        'Chưa nhập sessionid — dán giá trị cookie "sessionid" từ trình duyệt của bạn.',
      );
    }
    if (!TikTokSessionManager.isValidFormat(value)) {
      throw new TikTokTTSError(
        'BAD_REQUEST',
        'sessionid không đúng định dạng (chuỗi alphanumeric ~32 ký tự). ' +
          'Hãy copy lại nguyên vẹn giá trị cookie "sessionid" từ tiktok.com.',
      );
    }
    this.store.save(value);
  }

  clear(): void {
    this.store.clear();
  }
}
