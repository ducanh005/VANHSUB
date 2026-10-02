import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Clock,
  ExternalLink,
  Globe,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
  Cpu,
} from 'lucide-react';

export interface ActionableErrorBannerProps {
  error: string | null;
  errorCode?: string | null;
  onDismiss?: () => void;
  onRetry?: () => void;
  onOpenLobby?: () => void;
  onOpenChromeBridge?: () => void;
  onOpenDiagnostics?: () => void;
  countdownSeconds?: number | null;
}

export default function ActionableErrorBanner({
  error,
  errorCode,
  onDismiss,
  onRetry,
  onOpenLobby,
  onOpenChromeBridge,
  onOpenDiagnostics,
  countdownSeconds,
}: ActionableErrorBannerProps) {
  if (!error) return null;

  const lowerErr = (error || '').toLowerCase();
  const code = (errorCode || '').toUpperCase();

  const isSessionExpired =
    code === 'SESSION_EXPIRED' ||
    lowerErr.includes('chưa đăng nhập google flow') ||
    lowerErr.includes('phiên làm việc đã hết hạn') ||
    lowerErr.includes('unauthenticated') ||
    lowerErr.includes('reauth_required');

  const isUnusualActivity =
    code === 'PUBLIC_ERROR_UNUSUAL_ACTIVITY' ||
    code === 'CONTENT_REJECTED' ||
    lowerErr.includes('unusual_activity') ||
    lowerErr.includes('recaptcha') ||
    lowerErr.includes('bảo mật') ||
    lowerErr.includes('chặn');

  const isBridgeDisconnected =
    code === 'BRIDGE_DISCONNECTED' ||
    lowerErr.includes('chrome bridge') ||
    lowerErr.includes('extension bridge') ||
    lowerErr.includes('8765');

  const isTimeout =
    code === 'TIMEOUT' ||
    lowerErr.includes('timeout') ||
    lowerErr.includes('quá thời gian') ||
    lowerErr.includes('quá hạn');

  const isRateLimited =
    code === 'RATE_LIMITED' ||
    lowerErr.includes('rate limit') ||
    lowerErr.includes('lùi bước') ||
    lowerErr.includes('429');

  const handleOpenLobbyDefault = async () => {
    if (onOpenLobby) {
      onOpenLobby();
      return;
    }
    if (typeof window !== 'undefined' && (window as any).vanhsub?.veo?.showLobbyDebug) {
      await (window as any).vanhsub.veo.showLobbyDebug();
    } else if (typeof window !== 'undefined' && (window as any).vanhsub?.veo?.openLobby) {
      await (window as any).vanhsub.veo.openLobby();
    }
  };

  return (
    <div className="w-full rounded-lg border p-4 transition-all duration-200 animate-in fade-in slide-in-from-top-2 z-30 mb-4 border-rose-500/40 bg-gradient-to-r from-rose-950/80 via-slate-900/90 to-[#0F172A]/90">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/30">
            {isUnusualActivity ? (
              <ShieldAlert className="h-5 w-5 text-amber-400" />
            ) : isTimeout || isRateLimited ? (
              <Clock className="h-5 w-5 text-amber-400 animate-pulse" />
            ) : (
              <AlertCircle className="h-5 w-5 text-rose-400" />
            )}
          </div>

          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs font-bold uppercase tracking-wider text-rose-300">
                {isSessionExpired
                  ? 'YÊU CẦU ĐĂNG NHẬP GOOGLE FLOW'
                  : isUnusualActivity
                  ? 'GOOGLE YÊU CẦU XÁC MINH BẢO MẬT'
                  : isBridgeDisconnected
                  ? 'CHROME EXTENSION CHƯA KẾT NỐI'
                  : isTimeout
                  ? 'QUÁ THỜI HẠN PHẢN HỒI (TIMEOUT)'
                  : isRateLimited
                  ? 'GIỚI HẠN TẦN SUẤT GỬI LỆNH (RATE LIMIT)'
                  : 'LỖI PHÁT SINH TRONG TIẾN TRÌNH'}
              </h3>
              {code && (
                <span className="rounded-md bg-rose-500/20 px-2 py-0.5 text-[10px] font-mono font-bold text-rose-300 border border-rose-500/30">
                  {code}
                </span>
              )}
              {typeof countdownSeconds === 'number' && countdownSeconds > 0 && (
                <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-[10px] font-mono font-bold text-amber-300 border border-amber-500/30 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Đang giãn cách: còn {countdownSeconds}s
                </span>
              )}
            </div>

            <p className="text-xs text-text leading-relaxed break-words">
              {error}
            </p>

            {/* Khối gợi ý hành động cụ thể (Actionable Buttons) */}
            <div className="flex items-center gap-2 pt-2 flex-wrap">
              {isSessionExpired && (
                <>
                  <button
                    type="button"
                    onClick={handleOpenLobbyDefault}
                    className="flex items-center gap-1.5 rounded-md bg-danger px-3.5 py-1.5 text-xs font-bold text-white hover:from-rose-500 hover:to-amber-500 transition cursor-pointer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Mở Sảnh Đăng Nhập Ngay</span>
                  </button>
                  {onOpenChromeBridge && (
                    <button
                      type="button"
                      onClick={onOpenChromeBridge}
                      className="flex items-center gap-1.5 rounded-md border border-blue-500/40 bg-blue-950/40 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-900/50 hover:text-white transition cursor-pointer"
                    >
                      <Globe className="h-3.5 w-3.5 text-blue-400" />
                      <span>Kết Nối Chrome Extension (Tránh Lỗi)</span>
                    </button>
                  )}
                </>
              )}

              {isUnusualActivity && (
                <>
                  <button
                    type="button"
                    onClick={handleOpenLobbyDefault}
                    className="flex items-center gap-1.5 rounded-md bg-amber-600 hover:bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-white transition cursor-pointer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Mở Sảnh Thực Tế Giải Captcha</span>
                  </button>
                  {onOpenChromeBridge && (
                    <button
                      type="button"
                      onClick={onOpenChromeBridge}
                      className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/50 hover:text-white transition cursor-pointer"
                    >
                      <Globe className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Dùng Chrome Extension Thay Thế</span>
                    </button>
                  )}
                </>
              )}

              {isBridgeDisconnected && onOpenChromeBridge && (
                <button
                  type="button"
                  onClick={onOpenChromeBridge}
                  className="flex items-center gap-1.5 rounded-md bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 text-xs font-bold text-white transition cursor-pointer"
                >
                  <Globe className="h-3.5 w-3.5" />
                  <span>Hướng Dẫn Mở Chrome Extension (30s)</span>
                </button>
              )}

              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 hover:bg-surface-3 px-3 py-1.5 text-xs font-medium text-text hover:text-white transition cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Thử Lại Ngay</span>
                </button>
              )}

              {onOpenDiagnostics && (
                <button
                  type="button"
                  onClick={onOpenDiagnostics}
                  className="flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-950/40 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-900/50 hover:text-white transition cursor-pointer"
                >
                  <Cpu className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Tự Chẩn Đoán 1-Click</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg p-1 text-text-muted hover:bg-surface-2 hover:text-text transition cursor-pointer"
            title="Đóng thông báo"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
