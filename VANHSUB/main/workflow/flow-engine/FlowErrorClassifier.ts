import {
  ClassifiedError,
  ErrorCategory,
  FlowErrorCode,
  FlowStateContext,
} from './types';
import { FlowPageStateDetector, PageStateResult } from './FlowPageStateDetector';

/**
 * FlowErrorClassifier: Bộ phân loại lỗi tập trung cho Google Flow State Machine
 * Đảm bảo:
 * 1. Phân định rạch ròi giữa RETRYABLE (lỗi tạm thời, mạng, rate-limit, tác nhân) và NON_RETRYABLE (hết hạn session, hết credit, vi phạm chính sách)
 * 2. Cung cấp mã lỗi chuẩn hoá và hành động đề xuất (suggestedAction)
 * 3. Hỗ trợ trích xuất thông tin chi tiết từ Exception, HTTP Status Code, DOM Text và Electron BrowserWindow
 */
export class FlowErrorClassifier {
  /**
   * Phân loại lỗi tập trung từ error object / string kết hợp context thực thi
   */
  public static classify(
    err: any,
    ctx?: FlowStateContext,
    pageState?: PageStateResult
  ): ClassifiedError {
    const rawMsg = (err?.message || (typeof err === 'string' ? err : JSON.stringify(err)) || '').trim();
    const lowerMsg = rawMsg.toLowerCase();
    const originalError = err;

    // 1. KIỂM TRA LỖI FATAL: CỬA SỔ ELECTRON BỊ HUỶ HOẶC CRASH
    if (
      (ctx?.win && ctx.win.isDestroyed()) ||
      lowerMsg.includes('object has been destroyed') ||
      lowerMsg.includes('window is destroyed') ||
      lowerMsg.includes('cửa sổ đã bị đóng') ||
      lowerMsg.includes('window_destroyed') ||
      lowerMsg.includes('render process gone')
    ) {
      return {
        category: 'FATAL',
        code: 'BROWSER_WINDOW_DESTROYED',
        message: 'Cửa sổ Electron Browser đã bị đóng hoặc tiến trình render bị sập.',
        originalError,
        canRetry: false,
        suggestedAction: 'ABORT_HALT',
        details: { rawMsg },
      };
    }

    // 2. KIỂM TRA NGƯỜI DÙNG CHỦ ĐỘNG HUỶ (USER_CANCELLED)
    if (
      ctx?.isCancelled?.() ||
      lowerMsg === 'cancelled' ||
      lowerMsg.includes('đã bị huỷ bởi người dùng') ||
      lowerMsg.includes('user_cancelled') ||
      lowerMsg.includes('abort controller')
    ) {
      return {
        category: 'NON_RETRYABLE',
        code: 'USER_CANCELLED',
        message: 'Tác vụ đã bị huỷ bởi người dùng.',
        originalError,
        canRetry: false,
        suggestedAction: 'ABORT_HALT',
        details: { rawMsg },
      };
    }

    // 3. KIỂM TRA HẾT HẠN PHIÊN / AUTH THẤT BẠI (SESSION_EXPIRED)
    const currentUrl = (ctx?.win && !ctx.win.isDestroyed() ? ctx.win.webContents?.getURL?.() : '') || pageState?.currentUrl || '';
    const isAboutLanding = currentUrl.toLowerCase().includes('flow.google.com/about');
    const isLoginUrl = currentUrl.toLowerCase().includes('accounts.google.com') || currentUrl.toLowerCase().includes('servicelogin');
    
    if (
      isAboutLanding ||
      isLoginUrl ||
      pageState?.state === 'LOGIN_PAGE' ||
      lowerMsg.includes('flow.google.com/about') ||
      lowerMsg.includes('session_expired') ||
      lowerMsg.includes('session expired') ||
      lowerMsg.includes('hết hạn phiên') ||
      lowerMsg.includes('chưa xác thực phiên') ||
      lowerMsg.includes('unauthorized') ||
      lowerMsg.includes('status: 401') ||
      lowerMsg.includes('status 401') ||
      lowerMsg.includes('status: 403') ||
      lowerMsg.includes('status 403') ||
      lowerMsg.includes('reauth_required')
    ) {
      return {
        category: 'NON_RETRYABLE',
        code: 'SESSION_EXPIRED',
        message: 'Phiên làm việc Google Flow đã hết hạn hoặc cần đăng nhập lại.',
        originalError,
        canRetry: false,
        suggestedAction: 'REAUTH_REQUIRED',
        details: { currentUrl, rawMsg },
      };
    }

    // 4. KIỂM TRA HẾT TÍN DỤNG (OUT_OF_CREDITS)
    if (
      lowerMsg.includes('out of credits') ||
      lowerMsg.includes('hết tín dụng') ||
      lowerMsg.includes('không đủ số dư') ||
      lowerMsg.includes('insufficient credits') ||
      lowerMsg.includes('quota exhausted') ||
      lowerMsg.includes('mua thêm tín dụng') ||
      lowerMsg.includes('zero balance')
    ) {
      return {
        category: 'NON_RETRYABLE',
        code: 'OUT_OF_CREDITS',
        message: 'Tài khoản Google Flow đã hết tín dụng sinh ảnh/video.',
        originalError,
        canRetry: false,
        suggestedAction: 'ABORT_HALT',
        details: { rawMsg },
      };
    }

    // 5. KIỂM TRA VI PHẠM CHÍNH SÁCH / NỘI DUNG NHẠY CẢM (PROMPT_POLICY_VIOLATION)
    if (
      lowerMsg.includes('policy violation') ||
      lowerMsg.includes('vi phạm chính sách') ||
      lowerMsg.includes('safety filter') ||
      lowerMsg.includes('safety_blocked') ||
      lowerMsg.includes('blocked by safety') ||
      lowerMsg.includes('sensitive content') ||
      lowerMsg.includes('harmful content') ||
      lowerMsg.includes('tiêu chuẩn cộng đồng') ||
      lowerMsg.includes('nội dung bị hạn chế') ||
      lowerMsg.includes('cannot generate this image') ||
      lowerMsg.includes('inappropriate content') ||
      lowerMsg.includes('policy warning')
    ) {
      return {
        category: 'NON_RETRYABLE',
        code: 'PROMPT_POLICY_VIOLATION',
        message: 'Nội dung prompt vi phạm bộ lọc an toàn hoặc chính sách sử dụng của Google.',
        originalError,
        canRetry: false,
        suggestedAction: 'ABORT_HALT',
        details: { rawMsg },
      };
    }

    // 6. KIỂM TRA TÀI KHOẢN BỊ TẠM KHOÁ (ACCOUNT_SUSPENDED)
    if (
      lowerMsg.includes('account suspended') ||
      lowerMsg.includes('tài khoản bị tạm khoá') ||
      lowerMsg.includes('tài khoản bị vô hiệu hoá') ||
      lowerMsg.includes('account disabled') ||
      lowerMsg.includes('account terminated')
    ) {
      return {
        category: 'NON_RETRYABLE',
        code: 'ACCOUNT_SUSPENDED',
        message: 'Tài khoản Google bị tạm khoá hoặc đình chỉ quyền sử dụng Flow.',
        originalError,
        canRetry: false,
        suggestedAction: 'ABORT_HALT',
        details: { rawMsg },
      };
    }

    // 7. KIỂM TRA THAM SỐ KHÔNG HỢP LỆ (INVALID_INPUT)
    if (
      lowerMsg.includes('prompt rỗng') ||
      lowerMsg.includes('prompt is empty') ||
      lowerMsg.includes('invalid prompt') ||
      lowerMsg.includes('invalid_input') ||
      lowerMsg.includes('malformed input')
    ) {
      return {
        category: 'NON_RETRYABLE',
        code: 'INVALID_INPUT',
        message: 'Tham số đầu vào không hợp lệ hoặc prompt rỗng.',
        originalError,
        canRetry: false,
        suggestedAction: 'ABORT_HALT',
        details: { rawMsg },
      };
    }

    // 8. KIỂM TRA GIỚI HẠN TẦN SUẤT / RATE LIMIT (RATE_LIMIT_429)
    if (
      lowerMsg.includes('429') ||
      lowerMsg.includes('too many requests') ||
      lowerMsg.includes('quá nhiều yêu cầu') ||
      lowerMsg.includes('rate limit') ||
      lowerMsg.includes('slow down') ||
      lowerMsg.includes('try again in') ||
      lowerMsg.includes('resource exhausted temporarily') ||
      lowerMsg.includes('vui lòng đợi giây lát')
    ) {
      // Trích xuất số giây retry-after nếu có trong message (e.g. "try again in 10s")
      const retryAfterMatch = lowerMsg.match(/try again in (\d+)\s*(s|sec|seconds)?/i);
      const recommendedDelayMs = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) * 1000 : 5000;
      return {
        category: 'RETRYABLE',
        code: 'RATE_LIMIT_429',
        message: 'Đã vượt giới hạn tần suất yêu cầu (HTTP 429 / Rate Limit). Cần giãn cách thời gian.',
        originalError,
        canRetry: true,
        suggestedAction: 'RETRY_WITH_BACKOFF',
        recommendedDelayMs,
        details: { rawMsg },
      };
    }

    // 9. KIỂM TRA LỖI SERVER GOOGLE (SERVER_ERROR_5XX)
    if (
      lowerMsg.includes('500 internal server') ||
      lowerMsg.includes('status: 500') ||
      lowerMsg.includes('status 500') ||
      lowerMsg.includes('502 bad gateway') ||
      lowerMsg.includes('status: 502') ||
      lowerMsg.includes('status 502') ||
      lowerMsg.includes('503 service unavailable') ||
      lowerMsg.includes('status: 503') ||
      lowerMsg.includes('status 503') ||
      lowerMsg.includes('504 gateway timeout') ||
      lowerMsg.includes('status: 504') ||
      lowerMsg.includes('status 504') ||
      lowerMsg.includes('backend error') ||
      lowerMsg.includes('server error')
    ) {
      return {
        category: 'RETRYABLE',
        code: 'SERVER_ERROR_5XX',
        message: 'Máy chủ Google Flow gặp sự cố tạm thời (5xx Server Error).',
        originalError,
        canRetry: true,
        suggestedAction: 'RETRY_WITH_BACKOFF',
        recommendedDelayMs: 4000,
        details: { rawMsg },
      };
    }

    // 10. KIỂM TRA LỖI MẠNG TẠM THỜI (NETWORK_TRANSIENT)
    if (
      lowerMsg.includes('econnreset') ||
      lowerMsg.includes('etimedout') ||
      lowerMsg.includes('enotfound') ||
      lowerMsg.includes('econnrefused') ||
      lowerMsg.includes('fetch failed') ||
      lowerMsg.includes('network error') ||
      lowerMsg.includes('socket hang up') ||
      lowerMsg.includes('err_internet_disconnected') ||
      lowerMsg.includes('err_connection_reset') ||
      lowerMsg.includes('err_name_not_resolved') ||
      lowerMsg.includes('err_connection_timed_out') ||
      lowerMsg.includes('err_network_changed') ||
      lowerMsg.includes('net::err')
    ) {
      return {
        category: 'RETRYABLE',
        code: 'NETWORK_TRANSIENT',
        message: 'Kết nối mạng bị gián đoạn hoặc quá thời gian phản hồi.',
        originalError,
        canRetry: true,
        suggestedAction: 'RETRY_WITH_BACKOFF',
        recommendedDelayMs: 3000,
        details: { rawMsg },
      };
    }

    // 11. KIỂM TRA LỖI TẠM THỜI CỦA CREATIVE AGENT (AGENT_TRANSIENT_ERROR)
    if (
      lowerMsg.includes('tác nhân đã gặp lỗi') ||
      lowerMsg.includes('tác nhân đã gặp sự cố') ||
      lowerMsg.includes('agent encountered an error') ||
      lowerMsg.includes('creative agent encountered an error') ||
      lowerMsg.includes('agent_error') ||
      lowerMsg.includes('failed to generate')
    ) {
      return {
        category: 'RETRYABLE',
        code: 'AGENT_TRANSIENT_ERROR',
        message: 'Tác nhân Google Creative Agent gặp sự cố tạm thời trong chu trình xử lý.',
        originalError,
        canRetry: true,
        suggestedAction: 'RETRY_WITH_BACKOFF',
        recommendedDelayMs: 3500,
        details: { rawMsg },
      };
    }

    // 12. KIỂM TRA LỖI TỪ CHỐI TẠO ẢNH (CLICK_GENERATE_REJECTED) — NON_RETRYABLE
    if (
      lowerMsg.includes('click_generate_rejected') ||
      lowerMsg.includes('từ chối yêu cầu tạo ảnh') ||
      lowerMsg.includes('generate_rejected')
    ) {
      return {
        category: 'NON_RETRYABLE',
        code: 'CLICK_GENERATE_REJECTED',
        message: `Yêu cầu tạo ảnh đã bị Google Flow từ chối (báo lỗi toast/snackbar/chính sách): ${rawMsg}`,
        originalError,
        canRetry: false,
        suggestedAction: 'ABORT_HALT',
        details: { rawMsg },
      };
    }

    // 13. KIỂM TRA LỖI CLICK KHÔNG CÓ TÁC DỤNG (CLICK_GENERATE_NO_EFFECT) — RETRYABLE (lỗi kỹ thuật giao diện)
    if (
      lowerMsg.includes('click_generate_no_effect')
    ) {
      return {
        category: 'RETRYABLE',
        code: 'CLICK_GENERATE_NO_EFFECT',
        message: 'Click Generate không có phản hồi trên giao diện (lỗi kỹ thuật DOM/nút bấm).',
        originalError,
        canRetry: true,
        suggestedAction: 'RETRY_WITH_BACKOFF',
        recommendedDelayMs: 2500,
        details: { rawMsg },
      };
    }

    // 14. KIỂM TRA LỖI PHẦN TỬ DOM BẬN / QUÁ THỜI GIAN CHỜ TẠM THỜI (ELEMENT_TRANSIENT_BUSY)
    if (
      lowerMsg.includes('quá thời gian chờ') ||
      lowerMsg.includes('timeout') ||
      lowerMsg.includes('wait_timeout') ||
      lowerMsg.includes('element_not_found') ||
      lowerMsg.includes('button_not_ready') ||
      lowerMsg.includes('click_prep_failed') ||
      lowerMsg.includes('obscured') ||
      lowerMsg.includes('che phủ') ||
      lowerMsg.includes('không tìm thấy') ||
      lowerMsg.includes('rescan_required')
    ) {
      return {
        category: 'RETRYABLE',
        code: 'ELEMENT_TRANSIENT_BUSY',
        message: 'Giao diện DOM chưa phản hồi kịp hoặc phần tử tạm thời bị che phủ.',
        originalError,
        canRetry: true,
        suggestedAction: 'RETRY_WITH_BACKOFF',
        recommendedDelayMs: 2000,
        details: { rawMsg },
      };
    }

    // 15. MẶC ĐỊNH: LỖI CHƯA XÁC ĐỊNH (UNKNOWN_ERROR)
    return {
      category: 'RETRYABLE',
      code: 'UNKNOWN_ERROR',
      message: `Đã xảy ra lỗi không xác định: ${rawMsg || 'Lỗi không có thông điệp'}`,
      originalError,
      canRetry: true,
      suggestedAction: 'RETRY_WITH_BACKOFF',
      recommendedDelayMs: 2500,
      details: { rawMsg },
    };
  }
}
