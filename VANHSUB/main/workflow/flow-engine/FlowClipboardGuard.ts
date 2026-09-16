/**
 * FlowClipboardGuard: Bảo vệ clipboard của hệ điều hành trong quá trình automation.
 * - Snapshot clipboard (text / image) trước khi thực hiện thao tác paste.
 * - Thực hiện thao tác nghiệp vụ.
 * - Phục hồi 100% clipboard ban đầu trong khối finally kể cả khi có exception.
 */
export class FlowClipboardGuard {
  /**
   * Bọc một khối tác vụ bất đồng bộ cần sử dụng clipboard OS tạm thời.
   * Đảm bảo clipboard của người dùng được khôi phục nguyên trạng sau khi hoàn tất hoặc gặp lỗi.
   */
  static async withPreservedClipboard<T>(
    electron: any,
    operation: () => Promise<T> | T
  ): Promise<T> {
    const cb = electron?.clipboard;
    if (!cb) {
      return await operation();
    }

    // 1. Snapshot trạng thái clipboard hiện tại của người dùng
    let originalText: string | null = null;
    let originalImage: any = null;
    let hadImage = false;

    try {
      originalText = cb.readText();
      const img = cb.readImage?.();
      if (img && !img.isEmpty?.()) {
        originalImage = img;
        hadImage = true;
      }
    } catch (snapErr: any) {
      console.warn('[FlowClipboardGuard] Cảnh báo snapshot clipboard:', snapErr?.message || snapErr);
    }

    try {
      // 2. Thực hiện thao tác nghiệp vụ (paste text / image)
      return await operation();
    } finally {
      // 3. Phục hồi clipboard ban đầu 100% trong khối finally
      try {
        if (hadImage && originalImage) {
          cb.writeImage(originalImage);
        } else if (originalText !== null) {
          cb.writeText(originalText);
        }
      } catch (restoreErr: any) {
        console.warn('[FlowClipboardGuard] Cảnh báo phục hồi clipboard:', restoreErr?.message || restoreErr);
      }
    }
  }
}
