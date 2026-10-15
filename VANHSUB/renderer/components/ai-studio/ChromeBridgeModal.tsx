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
  const [pairingCode, setPairingCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [pairingError, setPairingError] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);

  useEffect(() => {
    if (!isOpen || isConnected) { setPairingCode(null); setPairingError(''); }
  }, [isOpen, isConnected]);
  useEffect(() => {
    if (!pairingCode) return;
    const timer = setTimeout(() => setPairingCode(null), Math.max(0, pairingCode.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pairingCode]);

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
      <div className="relative max-h-[90vh] overflow-y-auto w-full max-w-lg rounded-lg border border-border bg-surface p-5 space-y-4 text-text">
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
                Kết nối extension đã ghép đôi trong Chrome. Khi Google yêu cầu xác minh, hãy hoàn tất trực tiếp trên phiên test của bạn.
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
                Chrome Extension đã kết nối và xác thực ghép đôi.
              </p>
              <p className="text-text-muted">
                Kết nối bridge đã sẵn sàng. Việc tạo media vẫn phụ thuộc phiên đăng nhập, quyền truy cập và hạn mức Google Flow.
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
                Dùng một Chrome profile test riêng đã đăng nhập Google Flow. Ghép đôi extension để ứng dụng nhận đúng kết nối được bạn cho phép; không dùng kết nối này để vượt CAPTCHA hoặc cảnh báo của Google.
              </p>
            </div>
          </div>
        )}

        {/* 3 Steps Guide */}
        <div className="space-y-2.5">
          <h3 className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Cài đặt và ghép đôi extension
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
                Mở <strong className="text-text">flow.google.com</strong> trên profile test riêng và đăng nhập tài khoản của bạn. Sau đó ghép đôi extension ở bước dưới.
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

        <div className="space-y-2 rounded-md border border-border bg-surface-2 p-3 text-xs">
          <p className="font-medium">4. Ghép đôi Chrome Extension v1.0.8 trở lên</p>
          <p className="text-text-muted">Tạo mã rồi mở biểu tượng VANHSUB trên thanh extension của Chrome để dán mã. Mã dùng một lần, hết hạn sau 2 phút. Ghép đôi mới thay thế kết nối cũ.</p>
          <button type="button" disabled={pairingBusy} className="rounded border border-border px-3 py-1.5 disabled:opacity-50"
            onClick={async () => {
              setPairingBusy(true); setPairingError('');
              try { setPairingCode(await window.vanhsub.veo.createPairingCode()); }
              catch { setPairingError('Chưa tạo được mã. Hãy mở lại ứng dụng và kiểm tra bridge.'); }
              finally { setPairingBusy(false); }
            }}>Tạo mã ghép đôi</button>
          {pairingCode && <input aria-label="Mã ghép đôi Chrome" readOnly value={pairingCode.code} onFocus={event => event.target.select()}
            className="w-full rounded border border-border bg-surface p-2 font-mono select-all" />}
          {isConnected && <button type="button" disabled={pairingBusy} className="ml-2 rounded border border-border px-3 py-1.5 disabled:opacity-50"
            onClick={async () => {
              setPairingBusy(true); setPairingError('');
              try { await window.vanhsub.veo.revokePairing(); setPairingCode(null); onRefresh?.(); }
              catch { setPairingError('Không thu hồi được kết nối. Hãy thử lại.'); }
              finally { setPairingBusy(false); }
            }}>Thu hồi ghép đôi</button>}
          {pairingError && <p role="alert" className="text-danger">{pairingError}</p>}
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
