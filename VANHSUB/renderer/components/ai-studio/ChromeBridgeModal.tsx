import React, { useState, useEffect } from 'react';
import { X, ExternalLink, FolderOpen, CheckCircle2, AlertCircle, RefreshCw, Globe, Folder } from 'lucide-react';

interface ChromeBridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  isConnected: boolean;
  onRefresh?: () => void;
}

export default function ChromeBridgeModal({
  isOpen,
  onClose,
  isConnected,
  onRefresh,
}: ChromeBridgeModalProps) {
  const status = { bridgeConnected: isConnected };
  const isBridgeReady = status.bridgeConnected || isConnected;
  const [isOpeningFolder, setIsOpeningFolder] = useState(false);
  const [isOpeningChrome, setIsOpeningChrome] = useState(false);
  const [isOpeningExtPage, setIsOpeningExtPage] = useState(false);
  const [chromeTabInfo, setChromeTabInfo] = useState<{ url?: string; projectId?: string | null } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (typeof window !== 'undefined' && (window as any).vanhsub?.veo?.bridgeStatus) {
      (window as any).vanhsub.veo
        .bridgeStatus()
        .then((res: any) => {
          if (res?.chromeTab) {
            setChromeTabInfo(res.chromeTab);
          } else {
            setChromeTabInfo(null);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, isConnected]);

  if (!isOpen) return null;

  const handleOpenFolder = async () => {
    setIsOpeningFolder(true);
    try {
      if ((window as any).vanhsub?.veo?.openExtensionFolder) {
        await (window as any).vanhsub.veo.openExtensionFolder();
      }
    } catch (e) {
      console.error('Lỗi mở thư mục extension:', e);
    } finally {
      setIsOpeningFolder(false);
    }
  };

  const handleOpenChrome = async () => {
    setIsOpeningChrome(true);
    try {
      if ((window as any).vanhsub?.veo?.openChrome) {
        await (window as any).vanhsub.veo.openChrome('https://flow.google.com/');
      }
    } catch (e) {
      console.error('Lỗi mở Chrome:', e);
    } finally {
      setIsOpeningChrome(false);
    }
  };

  const handleOpenExtPage = async () => {
    setIsOpeningExtPage(true);
    try {
      if ((window as any).vanhsub?.veo?.openChromeExtensionsPage) {
        await (window as any).vanhsub.veo.openChromeExtensionsPage();
      }
    } catch (e) {
      console.error('Lỗi mở trang extensions:', e);
    } finally {
      setIsOpeningExtPage(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg rounded-lg border border-border bg-surface p-5 space-y-4 text-text">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2.5">
            <Globe className="h-5 w-5 text-accent" />
            <div>
              <h2 className="text-sm font-semibold text-text flex items-center gap-2">
                Kết Nối Google Chrome (Khuyên Dùng)
                {isConnected ? (
                  <span className="rounded-md bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success border border-success/30">
                    ĐÃ KẾT NỐI
                  </span>
                ) : (
                  <span className="rounded-md bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning border border-warning/30">
                    CHƯA KẾT NỐI
                  </span>
                )}
              </h2>
              <p className="text-xs text-text-muted">
                Sử dụng tab Google Chrome thật để loại bỏ 100% mã lỗi chặn bot <span className="font-mono text-danger">PUBLIC_ERROR_UNUSUAL_ACTIVITY</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Status Alert */}
        {isConnected ? (
          <div className="rounded-md border border-success/30 bg-success/10 p-3 flex items-start gap-3">
            <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-medium text-success">
                Cầu nối Chrome Extension đang hoạt động hoàn hảo!
              </p>
              <p className="text-text-muted">
                Mọi lệnh tạo ảnh (Imagen/Nano) và tạo video (Veo) trong AI Studio sẽ tự động chuyển qua tab Chrome của bạn với điểm uy tín tài khoản cao nhất.
              </p>
              {chromeTabInfo?.projectId ? (
                <p className="text-[11px] font-mono text-accent pt-1 flex items-center gap-1">
                  <Folder className="h-3 w-3 inline text-text-muted" />
                  <span>Dự án đang mở trên Chrome: {chromeTabInfo.projectId}</span>
                </p>
              ) : chromeTabInfo?.url ? (
                <p className="text-[11px] font-mono text-text-faint pt-1 truncate flex items-center gap-1" title={chromeTabInfo.url}>
                  <ExternalLink className="h-3 w-3 inline text-text-muted" />
                  <span>Tab hiện tại: {chromeTabInfo.url}</span>
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-3 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-medium text-warning">
                Tại sao nên dùng Google Chrome thay vì Electron?
              </p>
              <p className="text-text-muted">
                Google Flow có bộ lọc chống bot rất nghiêm ngặt đối với cửa sổ chạy ngầm của Electron. Khi chạy trên <strong className="text-text">Google Chrome thông thường</strong>, reCAPTCHA Enterprise cấp điểm 1.0 (người dùng thật), tạo ảnh và video mượt mà không bao giờ bị chặn.
              </p>
            </div>
          </div>
        )}

        {/* 3 Steps Guide */}
        <div className="space-y-2.5">
          <h3 className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Hướng Dẫn Cài Đặt 30 Giây (Chỉ làm 1 lần duy nhất)
          </h3>

          {/* Bước 1 */}
          <div className="flex items-start gap-3 rounded-md border border-border bg-surface-2 p-3">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-surface-3 text-[11px] font-semibold text-text border border-border shrink-0">
              1
            </span>
            <div className="flex-1 space-y-1 text-xs">
              <p className="font-medium text-text">Mở thư mục Extension trên máy tính</p>
              <p className="text-text-muted">
                Bấm nút bên dưới để mở thư mục chứa mã nguồn extension <span className="font-mono text-text">extension/</span> trong File Explorer.
              </p>
              <button
                type="button"
                onClick={handleOpenFolder}
                disabled={isOpeningFolder}
                className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-surface hover:bg-surface-3 border border-border px-3 py-1.5 text-xs font-medium text-text transition cursor-pointer"
              >
                <FolderOpen className="h-3.5 w-3.5 text-text-muted" />
                <span>Mở Thư Mục Extension</span>
              </button>
            </div>
          </div>

          {/* Bước 2 */}
          <div className="flex items-start gap-3 rounded-md border border-border bg-surface-2 p-3">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-surface-3 text-[11px] font-semibold text-text border border-border shrink-0">
              2
            </span>
            <div className="flex-1 space-y-1 text-xs">
              <p className="font-medium text-text">Nạp hoặc Tải lại (Reload) Extension vào Google Chrome</p>
              <p className="text-text-muted">
                Mở trang quản lý tiện ích: Bật <strong className="text-text">Chế độ cho nhà phát triển (Developer mode)</strong> ở góc trên bên phải → Bấm <strong className="text-text">Tải tiện ích đã giải nén (Load unpacked)</strong> → Chọn thư mục <span className="font-mono text-text">extension</span>. Nếu đã cài trước đó, hãy bấm nút <strong className="text-text">Tải lại (Reload)</strong> trên thẻ <em>VanhSub Flow Bridge</em>.
              </p>
              <button
                type="button"
                onClick={handleOpenExtPage}
                disabled={isOpeningExtPage}
                className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-surface hover:bg-surface-3 border border-border px-3 py-1.5 text-xs font-medium text-text transition cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5 text-text-muted" />
                <span>Mở Trang chrome://extensions</span>
              </button>
            </div>
          </div>

          {/* Bước 3 */}
          <div className="flex items-start gap-3 rounded-md border border-border bg-surface-2 p-3">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-surface-3 text-[11px] font-semibold text-text border border-border shrink-0">
              3
            </span>
            <div className="flex-1 space-y-1 text-xs">
              <p className="font-medium text-text">Mở trang Google Flow trên Chrome</p>
              <p className="text-text-muted">
                Bấm nút dưới để mở Chrome vào <strong className="text-text">flow.google.com</strong> (đăng nhập tài khoản Google của bạn). Extension sẽ tự động bắt tay với VanhSub!
              </p>
              <button
                type="button"
                onClick={handleOpenChrome}
                disabled={isOpeningChrome}
                className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-accent text-white hover:bg-accent-hover px-3.5 py-1.5 text-xs font-medium transition cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Mở Google Flow trên Chrome</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <button
            type="button"
            onClick={onRefresh}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Kiểm tra lại kết nối</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-surface-2 hover:bg-surface-3 px-3.5 py-1.5 text-xs font-medium text-text transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
