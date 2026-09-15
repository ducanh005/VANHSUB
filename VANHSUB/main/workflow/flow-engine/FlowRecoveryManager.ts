/**
 * FlowRecoveryManager: Bộ quản lý phục hồi và xử lý lỗi tự động cho Google Flow State Machine
 * Xử lý lỗi theo bảng quy tắc chuẩn Phase 5:
 * - ELEMENT_NOT_FOUND -> Quét overlay che phủ hoặc rescan thích ứng
 * - OVERLAY_BLOCKING  -> Phát hiện overlay/popup/panel và tự động dismiss (Escape / Close click)
 * - SESSION_EXPIRED   -> Dừng ngay lập tức, báo cáo người dùng, tuyệt đối KHÔNG reload mù quáng
 * - UNKNOWN_STATE     -> Chụp ảnh màn hình + DOM snapshot phục vụ chẩn đoán và tạm dừng
 */

import { FlowOverlayDetector, OverlayDetectionResult } from './FlowOverlayDetector';
import { FlowPageStateDetector, PageStateResult } from './FlowPageStateDetector';
import { FlowStateContext } from './types';
import fs from 'fs';
import path from 'path';

export type FlowRecoveryErrorType =
  | 'ELEMENT_NOT_FOUND'
  | 'OVERLAY_BLOCKING'
  | 'SESSION_EXPIRED'
  | 'UNKNOWN_STATE';

export interface RecoveryResult {
  recovered: boolean;
  actionTaken: string;
  shouldAbort: boolean;
  pageState?: PageStateResult;
  overlayResult?: OverlayDetectionResult;
  diagnosticsArtifact?: string;
  reason?: string;
}

export class FlowRecoveryManager {
  /**
   * Xử lý phục hồi tự động khi gặp lỗi trong chu trình State Machine
   */
  static async handleRecovery(
    win: any,
    errorType: FlowRecoveryErrorType,
    ctx: FlowStateContext,
    extraContext?: Record<string, any>
  ): Promise<RecoveryResult> {
    const pageState = await FlowPageStateDetector.detect(win);

    switch (errorType) {
      // -------------------------------------------------------------
      // 1. OVERLAY_BLOCKING: Phát hiện và dọn dẹp các lớp che phủ
      // -------------------------------------------------------------
      case 'OVERLAY_BLOCKING': {
        const overlayRes = await FlowOverlayDetector.detect(win);
        if (overlayRes.hasOverlay) {
          console.warn(`[FlowRecoveryManager] [${ctx.taskId}] ⚠️ Phát hiện overlay che phủ: ${overlayRes.summary}. Đang tự động giải phóng...`);
          const dismissed = await FlowOverlayDetector.dismiss(win);
          if (dismissed) {
            console.log(`[FlowRecoveryManager] [${ctx.taskId}] ✅ Đã giải phóng thành công overlay che phủ.`);
            return {
              recovered: true,
              actionTaken: 'DISMISS_OVERLAY_SUCCESS',
              shouldAbort: false,
              pageState,
              overlayResult: overlayRes,
            };
          } else {
            console.warn(`[FlowRecoveryManager] [${ctx.taskId}] ❌ Không thể tự động giải phóng overlay.`);
            return {
              recovered: false,
              actionTaken: 'DISMISS_OVERLAY_FAILED',
              shouldAbort: true,
              reason: 'Overlay không thể đóng tự động',
              pageState,
              overlayResult: overlayRes,
            };
          }
        }
        return {
          recovered: false,
          actionTaken: 'NO_OVERLAY_FOUND',
          shouldAbort: false,
          pageState,
          overlayResult: overlayRes,
        };
      }

      // -------------------------------------------------------------
      // 2. ELEMENT_NOT_FOUND: Kiểm tra xem có bị overlay che không, nếu có thì gỡ, nếu không thì rescan
      // -------------------------------------------------------------
      case 'ELEMENT_NOT_FOUND': {
        const overlayRes = await FlowOverlayDetector.detect(win);
        if (overlayRes.hasOverlay) {
          console.warn(`[FlowRecoveryManager] [${ctx.taskId}] ⚠️ Phần tử bị thiếu có thể do overlay che phủ. Đang thử đóng overlay...`);
          const dismissed = await FlowOverlayDetector.dismiss(win);
          if (dismissed) {
            return {
              recovered: true,
              actionTaken: 'DISMISS_BLOCKING_OVERLAY_FOR_ELEMENT',
              shouldAbort: false,
              pageState,
              overlayResult: overlayRes,
            };
          }
        }

        // Nếu đang ở sai trang (ví dụ LOGIN_PAGE hoặc ERROR_PAGE)
        if (pageState.state === 'LOGIN_PAGE' || pageState.state === 'ERROR_PAGE') {
          return {
            recovered: false,
            actionTaken: `ABORT_DUE_TO_WRONG_PAGE_STATE_${pageState.state}`,
            shouldAbort: true,
            reason: `Trang đang ở trạng thái ${pageState.state}, không thể tìm phần tử editor.`,
            pageState,
          };
        }

        return {
          recovered: false,
          actionTaken: 'RESCAN_REQUIRED',
          shouldAbort: false,
          pageState,
          reason: 'Cần quét lại phần tử sau chu kỳ chờ thích ứng',
        };
      }

      // -------------------------------------------------------------
      // 3. SESSION_EXPIRED: Dừng ngay, báo người dùng, tuyệt đối KHÔNG reload vô tận
      // -------------------------------------------------------------
      case 'SESSION_EXPIRED': {
        console.error(`[FlowRecoveryManager] [${ctx.taskId}] 🛑 PHIÊN LÀM VIỆC HẾT HẠN HOẶC HẾT TÍN DỤNG. Dừng chu trình ngay lập tức.`);
        ctx.onProgress?.(0, 'Phiên đăng nhập Google Flow đã hết hạn hoặc hết tín dụng. Vui lòng mở sảnh để kiểm tra.');
        return {
          recovered: false,
          actionTaken: 'HALT_SESSION_EXPIRED',
          shouldAbort: true,
          reason: 'Phiên Google Flow hết hạn hoặc hết tín dụng. Yêu cầu người dùng kiểm tra.',
          pageState,
        };
      }

      // -------------------------------------------------------------
      // 4. UNKNOWN_STATE: Chụp ảnh màn hình + DOM snapshot + tạm dừng
      // -------------------------------------------------------------
      case 'UNKNOWN_STATE':
      default: {
        console.error(`[FlowRecoveryManager] [${ctx.taskId}] 🚨 TRẠNG THÁI KHÔNG XÁC ĐỊNH TRÊN GOOGLE FLOW. Đang ghi nhận diagnostics...`);
        let artifactPath = '';
        try {
          // 1. Chụp ảnh màn hình
          const image = await win.webContents.capturePage();
          const scratchDir = path.join(process.cwd(), 'scratch');
          if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
          
          const filenameBase = `diagnostics_${ctx.taskId}_${Date.now()}`;
          const screenshotPath = path.join(scratchDir, `${filenameBase}.png`);
          fs.writeFileSync(screenshotPath, image.toPNG());

          // 2. Chụp DOM snapshot
          const domHtml = await win.webContents.executeJavaScript('document.documentElement.outerHTML', true).catch(() => '');
          const domPath = path.join(scratchDir, `${filenameBase}.html`);
          fs.writeFileSync(domPath, domHtml, 'utf-8');

          artifactPath = screenshotPath;
          console.log(`[FlowRecoveryManager] 📸 Đã lưu ảnh chụp lỗi tại: ${screenshotPath}`);
        } catch (e) {
          console.warn('[FlowRecoveryManager] Không thể lưu diagnostics screenshot:', e);
        }

        return {
          recovered: false,
          actionTaken: 'CAPTURE_DIAGNOSTICS_AND_PAUSE',
          shouldAbort: true,
          diagnosticsArtifact: artifactPath,
          reason: 'Trang rơi vào trạng thái không xác định, đã lưu chẩn đoán và tạm dừng.',
          pageState,
        };
      }
    }
  }
}
