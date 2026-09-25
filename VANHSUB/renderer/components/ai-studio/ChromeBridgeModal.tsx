import React, { useState, useEffect } from 'react';
import { X, ExternalLink, FolderOpen, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

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
  const [isOpeningFolder, setIsOpeningFolder] = useState(false);
  const [isOpeningChrome, setIsOpeningChrome] = useState(false);
  const [isOpeningExtPage, setIsOpeningExtPage] = useState(false);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-700/80 bg-[#0E1526] p-6 shadow-2xl space-y-5 text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🌐</span>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Kết Nối Google Chrome (Khuyên Dùng)
                {isConnected ? (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                    🟢 ĐÃ KẾT NỐI
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/30">
                    ⚪ CHƯA KẾT NỐI
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                Sử dụng tab Google Chrome thật để loại bỏ 100% mã lỗi chặn bot <span className="font-mono text-rose-400">PUBLIC_ERROR_UNUSUAL_ACTIVITY</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Status Alert */}
        {isConnected ? (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3.5 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-semibold text-emerald-300">
                Cầu nối Chrome Extension đang hoạt động hoàn hảo!
              </p>
              <p className="text-slate-300">
                Mọi lệnh tạo ảnh (Imagen/Nano) và tạo video (Veo) trong AI Studio sẽ tự động chuyển qua tab Chrome của bạn với điểm uy tín tài khoản cao nhất.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-3.5 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-semibold text-amber-300">
                Tại sao nên dùng Google Chrome thay vì Electron?
              </p>
              <p className="text-slate-300">
                Google Flow có bộ lọc chống bot rất nghiêm ngặt đối với cửa sổ chạy ngầm của Electron. Khi chạy trên <strong>Google Chrome thông thường</strong>, reCAPTCHA Enterprise cấp điểm 1.0 (người dùng thật), tạo ảnh và video mượt mà không bao giờ bị chặn.
              </p>
            </div>
          </div>
        )}

        {/* 3 Steps Guide */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Hướng Dẫn Cài Đặt 30 Giây (Chỉ làm 1 lần duy nhất)
          </h3>

          {/* Bước 1 */}
          <div className="flex items-start gap-3 rounded-xl border border-slate-800/80 bg-slate-900/60 p-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-400 border border-blue-500/30 shrink-0">
              1
            </span>
            <div className="flex-1 space-y-1 text-xs">
              <p className="font-semibold text-white">Mở thư mục Extension trên máy tính</p>
              <p className="text-slate-400">
                Bấm nút bên dưới để mở thư mục chứa mã nguồn extension <span className="font-mono text-slate-300">extension/</span> trong File Explorer.
              </p>
              <button
                type="button"
                onClick={handleOpenFolder}
                disabled={isOpeningFolder}
                className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition cursor-pointer border border-slate-700"
              >
                <FolderOpen className="h-3.5 w-3.5 text-amber-400" />
                <span>Mở Thư Mục Extension</span>
              </button>
            </div>
          </div>

          {/* Bước 2 */}
          <div className="flex items-start gap-3 rounded-xl border border-slate-800/80 bg-slate-900/60 p-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-400 border border-blue-500/30 shrink-0">
              2
            </span>
            <div className="flex-1 space-y-1 text-xs">
              <p className="font-semibold text-white">Nạp Extension vào Google Chrome</p>
              <p className="text-slate-400">
                Mở trang quản lý tiện ích: Bật <strong>Chế độ cho nhà phát triển (Developer mode)</strong> ở góc trên bên phải → Bấm <strong>Tải tiện ích đã giải nén (Load unpacked)</strong> → Chọn thư mục extension vừa mở ở Bước 1.
              </p>
              <button
                type="button"
                onClick={handleOpenExtPage}
                disabled={isOpeningExtPage}
                className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition cursor-pointer border border-slate-700"
              >
                <ExternalLink className="h-3.5 w-3.5 text-blue-400" />
                <span>Mở Trang chrome://extensions</span>
              </button>
            </div>
          </div>

          {/* Bước 3 */}
          <div className="flex items-start gap-3 rounded-xl border border-slate-800/80 bg-slate-900/60 p-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-400 border border-blue-500/30 shrink-0">
              3
            </span>
            <div className="flex-1 space-y-1 text-xs">
              <p className="font-semibold text-white">Mở trang Google Flow trên Chrome</p>
              <p className="text-slate-400">
                Bấm nút dưới để mở Chrome vào <strong>flow.google.com</strong> (đăng nhập tài khoản Google của bạn). Extension sẽ tự động bắt tay với VanhSub!
              </p>
              <button
                type="button"
                onClick={handleOpenChrome}
                disabled={isOpeningChrome}
                className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan/20 hover:bg-brand-cyan/30 text-brand-cyan px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer border border-brand-cyan/40"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>🌐 Mở Google Flow trên Chrome</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 pt-3">
          <button
            type="button"
            onClick={onRefresh}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Kiểm tra lại kết nối</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2 text-xs font-semibold text-white transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
