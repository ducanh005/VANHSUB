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
import { FlowDiagnosticManager } from './FlowDiagnosticManager';
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
        const diagMgr = FlowDiagnosticManager.getInstance();

        // 1. Chụp DOM snapshot (luôn đảm bảo có dữ liệu cấu trúc DOM)
        let domPath = '';
        try {
          const domHtml = await win.webContents.executeJavaScript('document.documentElement.outerHTML', true).catch(() => '');
          if (domHtml) {
            domPath = await diagMgr.saveDOMSnapshot(ctx.taskId, domHtml);
            console.log(`[FlowRecoveryManager] 📄 Đã lưu DOM snapshot tại: ${domPath}`);
          }
        } catch (e) {
          console.warn('[FlowRecoveryManager] Không thể lưu DOM snapshot:', e);
        }

        // 2. Chụp ảnh màn hình (hỗ trợ cả cửa sổ offscreen thông qua cơ chế flip onscreen tức thời)
        let screenshotPath = '';
        let origPosition: [number, number] | null = null;
        let wasOffscreen = false;

        try {
          if (win && !win.isDestroyed()) {
            origPosition = win.getPosition();
            wasOffscreen = Boolean(origPosition && (origPosition[0] < -1000 || origPosition[1] < -1000));

            if (wasOffscreen) {
              console.log(`[FlowRecoveryManager] [${ctx.taskId}] 🔄 Tạm thời flip cửa sổ về màn hình chính (100, 100) để cấp GPU paint buffer cho capturePage...`);
              win.setPosition(100, 100);
              win.showInactive();
              await new Promise((r) => setTimeout(r, 100));
            }

            const image = await win.webContents.capturePage();
            if (image && !image.isEmpty()) {
              screenshotPath = await diagMgr.saveScreenshot(ctx.taskId, image.toPNG());
              console.log(`[FlowRecoveryManager] 📸 ĐÃ LƯU ẢNH CHỤP MÀN HÌNH CHẨN ĐOÁN THÀNH CÔNG (${image.toPNG().length} bytes) tại: ${screenshotPath}`);
            } else {
              console.warn(`[FlowRecoveryManager] ⚠️ capturePage trả về ảnh rỗng (empty buffer). Không thể tạo ảnh chẩn đoán.`);
            }
          }
        } catch (e: any) {
          console.error(`[FlowRecoveryManager] ❌ KHÔNG THỂ CHỤP ẢNH MÀN HÌNH CHẨN ĐOÁN: ${e?.message || e}. Đã có DOM snapshot dự phòng tại: ${domPath}`);
        } finally {
          // Luôn đảm bảo đưa cửa sổ trở lại vị trí ẩn ban đầu nếu đã flip
          if (wasOffscreen && origPosition && win && !win.isDestroyed()) {
            win.setPosition(origPosition[0], origPosition[1]);
            console.log(`[FlowRecoveryManager] [${ctx.taskId}] 🔒 Đã đưa cửa sổ trở lại toạ độ offscreen ẩn: (${origPosition[0]}, ${origPosition[1]})`);
          }
        }

        artifactPath = screenshotPath || domPath;

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
