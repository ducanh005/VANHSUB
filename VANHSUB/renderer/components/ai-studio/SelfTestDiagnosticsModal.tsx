import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Cpu,
  ExternalLink,
  FolderOpen,
  Globe,
  HardDrive,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import type { SelfTestDiagnosticsResult } from '../../types/aiStudio';

export interface SelfTestDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenChromeBridge?: () => void;
  onOpenSettings?: () => void;
}

export default function SelfTestDiagnosticsModal({
  isOpen,
  onClose,
  onOpenChromeBridge,
  onOpenSettings,
}: SelfTestDiagnosticsModalProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<SelfTestDiagnosticsResult | null>(null);
  const [executionTimeMs, setExecutionTimeMs] = useState<number | null>(null);

  const runDiagnostics = useCallback(async () => {
    setIsRunning(true);
    const start = Date.now();
    try {
      if (typeof window !== 'undefined' && window.vanhsub?.aiStudio?.selfTestDiagnostics) {
        const diag = await window.vanhsub.aiStudio.selfTestDiagnostics();
        setResult(diag);
      } else {
        // Fallback simulation nếu chạy ngoài Electron môi trường web thuần
        await new Promise((r) => setTimeout(r, 600));
        setResult({
          bridge: { ok: false, message: 'Môi trường Browser không có Electron IPC bridge', port: 8765 },
          session: { ok: false, message: 'Chưa có session Electron', status: 'unauthenticated' },
          disk: { ok: true, message: 'Thư mục cục bộ sẵn sàng' },
          llm: { ok: true, message: 'Cấu hình AI mặc định sẵn sàng', provider: 'gemini_web' },
          overallReady: false,
          timestamp: Date.now(),
        });
      }
    } catch (err: any) {
      console.error('Lỗi khi chạy tự chẩn đoán:', err);
    } finally {
      setExecutionTimeMs(Date.now() - start);
      setIsRunning(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      runDiagnostics();
    }
  }, [isOpen, runDiagnostics]);

  if (!isOpen) return null;

  const handleOpenLobby = async () => {
    try {
      if (typeof window !== 'undefined' && (window as any).vanhsub?.veo?.showLobbyDebug) {
        await (window as any).vanhsub.veo.showLobbyDebug();
      } else if (typeof window !== 'undefined' && (window as any).vanhsub?.veo?.openLobby) {
        await (window as any).vanhsub.veo.openLobby();
      }
    } catch {}
  };

  const handleSelectFolder = async () => {
    try {
      if (typeof window !== 'undefined' && (window as any).vanhsub?.dialog?.chooseDirectory) {
        await (window as any).vanhsub.dialog.chooseDirectory();
        runDiagnostics();
      }
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl rounded-lg border border-border bg-[#0E1526] p-6 space-y-5 text-text">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Tự Chẩn Đoán Hệ Thống 1-Click
                {result && (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
                      result.overallReady
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    }`}
                  >
                    {result.overallReady ? '✓ HỆ THỐNG SẴN SÀNG' : '⚠️ CẦN THIẾT LẬP THÊM'}
                  </span>
                )}
              </h2>
              <p className="text-xs text-text-muted">
                Kiểm tra toàn diện 4 mắt xích cốt lõi trong thời gian tối đa 3 giây
                {executionTimeMs !== null && ` (phản hồi trong ${executionTimeMs}ms)`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-white transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 4 Diagnostic Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* 1. Chrome Extension Bridge */}
          <div
            className={`rounded-lg border p-4 transition flex flex-col justify-between ${
              result?.bridge.ok
                ? 'border-emerald-500/40 bg-emerald-950/20'
                : 'border-border bg-[#0B101D]'
            }`}
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-text">
                  <Globe className="h-4 w-4 text-blue-400" />
                  <span>Chrome Extension Bridge</span>
                </div>
                {result?.bridge.ok ? (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Đã Kết Nối
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-text-muted">
                    <XCircle className="h-3.5 w-3.5" /> Chưa Bật
                  </span>
                )}
              </div>
              <p className="text-xs text-text-muted leading-relaxed">
                {result?.bridge.message || 'Đang kiểm tra kết nối WebSocket Port 8765...'}
              </p>
            </div>

            {!result?.bridge.ok && onOpenChromeBridge && (
              <div className="pt-3">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenChromeBridge();
                  }}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md border border-blue-500/40 bg-blue-950/40 hover:bg-blue-900/50 px-3 py-1.5 text-xs font-semibold text-blue-300 transition cursor-pointer"
                >
                  <Globe className="h-3.5 w-3.5 text-blue-400" />
                  <span>Mở Hướng Dẫn Kết Nối (30s)</span>
                </button>
              </div>
            )}
          </div>

          {/* 2. Google Flow Session (Electron Lobby) */}
          <div
            className={`rounded-lg border p-4 transition flex flex-col justify-between ${
              result?.session.ok
                ? 'border-emerald-500/40 bg-emerald-950/20'
                : 'border-border bg-[#0B101D]'
            }`}
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-text">
                  <Sparkles className="h-4 w-4 text-amber-400" />
                  <span>Sảnh Google Flow (Electron)</span>
                </div>
                {result?.session.ok ? (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Sẵn Sàng
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-amber-400">
                    <AlertCircle className="h-3.5 w-3.5" /> Chưa Đăng Nhập
                  </span>
                )}
              </div>
              <p className="text-xs text-text-muted leading-relaxed">
                {result?.session.message || 'Đang kiểm tra phiên lưu trữ trong persist:google_veo...'}
              </p>
            </div>

            {!result?.session.ok && (
              <div className="pt-3">
                <button
                  type="button"
                  onClick={handleOpenLobby}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md bg-amber-600 hover:bg-amber-500 px-3 py-1.5 text-xs font-bold text-white transition cursor-pointer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Mở Sảnh Đăng Nhập Ngay</span>
                </button>
              </div>
            )}
          </div>

          {/* 3. Disk Output Directory */}
          <div
            className={`rounded-lg border p-4 transition flex flex-col justify-between ${
              result?.disk.ok
                ? 'border-emerald-500/40 bg-emerald-950/20'
                : 'border-rose-500/40 bg-rose-950/20'
            }`}
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-text">
                  <HardDrive className="h-4 w-4 text-accent" />
                  <span>Quyền Ghi Ổ Đĩa (Output)</span>
                </div>
                {result?.disk.ok ? (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Toàn Quyền
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-rose-400">
                    <XCircle className="h-3.5 w-3.5" /> Bị Chặn
                  </span>
                )}
              </div>
              <p className="text-xs text-text-muted leading-relaxed truncate" title={result?.disk.path}>
                {result?.disk.message || 'Đang thử ghi file kiểm tra...'}
              </p>
            </div>

            {!result?.disk.ok && (
              <div className="pt-3">
                <button
                  type="button"
                  onClick={handleSelectFolder}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-950/40 hover:bg-rose-900/50 px-3 py-1.5 text-xs font-semibold text-rose-300 transition cursor-pointer"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>Chọn Lại Thư Mục Khác</span>
                </button>
              </div>
            )}
          </div>

          {/* 4. AI Provider (LLM / API) */}
          <div
            className={`rounded-lg border p-4 transition flex flex-col justify-between ${
              result?.llm.ok
                ? 'border-emerald-500/40 bg-emerald-950/20'
                : 'border-amber-500/40 bg-amber-950/20'
            }`}
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-text">
                  <Sparkles className="h-4 w-4 text-accent" />
                  <span>Trí Tuệ Nhân Tạo (AI LLM)</span>
                </div>
                {result?.llm.ok ? (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Đã Cấu Hình
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-amber-400">
                    <AlertCircle className="h-3.5 w-3.5" /> Thiếu API Key
                  </span>
                )}
              </div>
              <p className="text-xs text-text-muted leading-relaxed">
                {result?.llm.message || 'Đang kiểm tra nhà cung cấp AI...'}
              </p>
            </div>

            {!result?.llm.ok && onOpenSettings && (
              <div className="pt-3">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md border border-accent/40 bg-purple-950/40 hover:bg-purple-900/50 px-3 py-1.5 text-xs font-semibold text-accent transition cursor-pointer"
                >
                  <Settings className="h-3.5 w-3.5" />
                  <span>Mở Cài Đặt Khóa API</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer info & re-check */}
        <div className="flex items-center justify-between border-t border-border pt-4 text-xs">
          <span className="text-text-muted">
            {result?.overallReady
              ? '✓ Bạn đã sẵn sàng để tạo ảnh và sinh video tự động!'
              : '💡 Chỉ cần tối thiểu 1 trong 2 kênh (Chrome Extension hoặc Sảnh Flow) hoạt động.'}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runDiagnostics}
              disabled={isRunning}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 hover:bg-surface-3 px-3.5 py-1.5 font-medium text-text hover:text-white transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? 'animate-spin' : ''}`} />
              <span>{isRunning ? 'Đang kiểm tra...' : 'Chẩn Đoán Lại'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-accent-tint border border-accent/40 hover:bg-accent/30 px-4 py-1.5 font-bold text-accent transition cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
