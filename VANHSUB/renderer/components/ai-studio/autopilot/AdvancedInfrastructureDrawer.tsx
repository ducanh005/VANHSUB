import React, { useState, useEffect } from 'react';
import {
  X,
  Sliders,
  Radio,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ShieldAlert,
  ShieldCheck,
  RotateCcw,
  ExternalLink,
  Activity,
  Terminal,
  Cpu,
  RefreshCw,
  FolderOpen,
} from 'lucide-react';

export interface AdvancedInfrastructureDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  bridgePort?: number;
  isLobbyDebugVisible: boolean;
  onToggleLobbyDebug: () => Promise<void> | void;
  onOpenChromeBridgeModal?: () => void;
  onOpenDiagnosticsModal?: () => void;
}

export const AdvancedInfrastructureDrawer: React.FC<AdvancedInfrastructureDrawerProps> = ({
  isOpen,
  onClose,
  bridgePort = 19890,
  isLobbyDebugVisible,
  onToggleLobbyDebug,
  onOpenChromeBridgeModal,
  onOpenDiagnosticsModal,
}) => {
  const [bridgeStatus, setBridgeStatus] = useState<{
    connected: boolean;
    port: number;
    clientsCount?: number;
  }>({
    connected: false,
    port: bridgePort,
  });

  const [antiSpamStatus, setAntiSpamStatus] = useState<{
    allowed: boolean;
    remainingCooldownSec: number;
    isLocked: boolean;
  }>({
    allowed: true,
    remainingCooldownSec: 0,
    isLocked: false,
  });

  const [sessionHealth, setSessionHealth] = useState<{
    status: 'active' | 'expired' | 'unauthenticated' | 'rate_limited' | 'captcha_required' | 'out_of_credits' | 'unknown';
    email?: string;
    hasSession: boolean;
    lastChecked?: number;
  }>({
    status: 'unknown',
    hasSession: false,
  });

  const [isLoadingStatus, setIsLoadingStatus] = useState(false);

  const fetchInfrastructureStatus = async () => {
    setIsLoadingStatus(true);
    try {
      if (typeof window !== 'undefined' && window.vanhsub?.veo) {
        // 1. Bridge Status
        if (window.vanhsub.veo.bridgeStatus) {
          const bStatus = await window.vanhsub.veo.bridgeStatus();
          if (bStatus) {
            setBridgeStatus({
              connected: Boolean(bStatus.connected || bStatus.running || bStatus.clientCount > 0),
              port: bStatus.port || bridgePort,
              clientsCount: bStatus.clientCount,
            });
          }
        }

        // 2. Anti-spam & Mutex Status
        if (window.vanhsub.veo.getAntiSpamStatus) {
          const asStatus = await window.vanhsub.veo.getAntiSpamStatus();
          if (asStatus && asStatus.status) {
            setAntiSpamStatus({
              allowed: asStatus.status.allowed ?? true,
              remainingCooldownSec: asStatus.status.remainingCooldownSec ?? 0,
              isLocked: asStatus.status.isLocked ?? false,
            });
          }
        }

        // 3. Session Health Status
        if (window.vanhsub.veo.status) {
          const vStatus = await window.vanhsub.veo.status();
          if (vStatus) {
            setSessionHealth({
              status: vStatus.sessionStatus || 'unknown',
              email: vStatus.email,
              hasSession: vStatus.hasSession ?? false,
              lastChecked: vStatus.lastChecked,
            });
            if (vStatus.antiSpam) {
              setAntiSpamStatus({
                allowed: vStatus.antiSpam.allowed ?? true,
                remainingCooldownSec: vStatus.antiSpam.remainingCooldownSec ?? 0,
                isLocked: vStatus.antiSpam.isLocked ?? false,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('Lỗi khi tải trạng thái hạ tầng:', err);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchInfrastructureStatus();
    }
  }, [isOpen]);

  const handleReauthViaLobby = async () => {
    try {
      if (window.vanhsub?.veo?.openLobby) {
        await window.vanhsub.veo.openLobby();
        await fetchInfrastructureStatus();
      }
    } catch (err) {
      console.error('Lỗi khi mở Sảnh Lobby để đăng nhập:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full bg-[#0A0F1D] border-l border-border flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-[#080D1A] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-accent">
              <Sliders className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Hạ tầng &amp; Kỹ thuật Nâng cao</h3>
              <p className="text-[11px] text-text-muted">Điều phối WebSocket, Lobby, Mutex &amp; Cookie</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={fetchInfrastructureStatus}
              disabled={isLoadingStatus}
              className="rounded-lg p-1.5 text-text-muted hover:text-white hover:bg-surface-2 transition cursor-pointer"
              title="Làm mới trạng thái"
            >
              <RefreshCw className={`h-4 w-4 ${isLoadingStatus ? 'animate-spin text-accent' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-text-muted hover:text-white hover:bg-surface-2 transition cursor-pointer"
              title="Đóng (ESC)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4 text-xs">
          {/* Section 1: Chrome Extension Bridge */}
          <div className="rounded-lg border border-border bg-[#0E1526] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-cyan-400" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Chrome Extension Bridge
                </h4>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold border flex items-center gap-1 ${
                  bridgeStatus.connected
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${bridgeStatus.connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span>{bridgeStatus.connected ? 'Đang kết nối' : 'Đang lắng nghe'}</span>
              </span>
            </div>

            <div className="space-y-1.5 text-[11px] text-text bg-bg p-3 rounded-md border border-border font-mono">
              <div className="flex justify-between">
                <span className="text-text-muted">Cổng WebSocket:</span>
                <span className="text-white font-bold">{bridgeStatus.port}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Địa chỉ cục bộ:</span>
                <span className="text-accent">ws://127.0.0.1:{bridgeStatus.port}</span>
              </div>
              {bridgeStatus.clientsCount !== undefined && (
                <div className="flex justify-between">
                  <span className="text-text-muted">Extension Clients:</span>
                  <span className="text-emerald-300">{bridgeStatus.clientsCount} tab active</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              {onOpenChromeBridgeModal && (
                <button
                  type="button"
                  onClick={onOpenChromeBridgeModal}
                  className="flex-1 rounded-lg border border-cyan-700/60 bg-surface-2 hover:bg-cyan-950/60 px-3 py-1.5 text-xs font-semibold text-accent transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Activity className="h-3.5 w-3.5" />
                  <span>Mở Cửa sổ Bridge Modal</span>
                </button>
              )}
            </div>
          </div>

          {/* Section 2: Electron Lobby (Google Flow Live / Debug Window) */}
          <div className="rounded-lg border border-border bg-[#0E1526] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-emerald-400" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Electron Lobby Window
                </h4>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold border flex items-center gap-1 ${
                  isLobbyDebugVisible
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                }`}
              >
                {isLobbyDebugVisible ? 'Hiện màn hình (Visible)' : 'Chạy ngầm (Offscreen)'}
              </span>
            </div>

            <p className="text-[11px] text-text-muted leading-relaxed">
              Cửa sổ Google Flow độc lập chạy nền để thực thi Web RPC và sinh media tự động. Bạn có thể bật cửa sổ lên để kiểm tra giao diện hoặc đăng nhập lại.
            </p>

            <div className="flex items-center justify-between p-3 bg-bg rounded-md border border-border">
              <span className="text-[11px] text-text font-medium">Chế độ hiển thị sảnh:</span>
              <button
                type="button"
                onClick={onToggleLobbyDebug}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 border ${
                  isLobbyDebugVisible
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                    : 'bg-surface text-text border-border hover:bg-surface-2 hover:text-white'
                }`}
              >
                {isLobbyDebugVisible ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" />
                    <span>Ẩn vào chạy ngầm</span>
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" />
                    <span>Bật lên màn hình</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Section 3: Mutex Lock & Anti-spam Rate Limiter */}
          <div className="rounded-lg border border-border bg-[#0E1526] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-purple-400" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Mutex Lock &amp; Rate Limiter
                </h4>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold border flex items-center gap-1 ${
                  antiSpamStatus.isLocked
                    ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                }`}
              >
                {antiSpamStatus.isLocked ? (
                  <>
                    <Lock className="h-3 w-3" />
                    <span>Khóa (Locked)</span>
                  </>
                ) : (
                  <>
                    <Unlock className="h-3 w-3" />
                    <span>Mở khóa (Unlocked)</span>
                  </>
                )}
              </span>
            </div>

            <div className="space-y-1.5 text-[11px] text-text bg-bg p-3 rounded-md border border-border">
              <div className="flex justify-between">
                <span className="text-text-muted">Trạng thái bảo vệ:</span>
                <span className={antiSpamStatus.allowed ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                  {antiSpamStatus.allowed ? 'An toàn (Cho phép gửi)' : 'Đang điều tiết tốc độ (Cooldown)'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Thời gian giãn cách:</span>
                <span className="font-mono text-white">
                  {antiSpamStatus.remainingCooldownSec > 0
                    ? `${antiSpamStatus.remainingCooldownSec}s còn lại`
                    : '0s (Sẵn sàng)'}
                </span>
              </div>
            </div>
          </div>

          {/* Section 4: Session Cookie Health & Re-authentication */}
          <div className="rounded-lg border border-border bg-[#0E1526] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-amber-400" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Google Flow Session
                </h4>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                  sessionHealth.status === 'active'
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                    : sessionHealth.status === 'expired'
                    ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                    : 'bg-surface-2 text-text-muted border-border'
                }`}
              >
                {sessionHealth.status.toUpperCase()}
              </span>
            </div>

            <div className="space-y-1.5 text-[11px] text-text bg-bg p-3 rounded-md border border-border">
              <div className="flex justify-between">
                <span className="text-text-muted">Tài khoản Google:</span>
                <span className="text-white font-medium truncate max-w-[200px]">
                  {sessionHealth.email || 'Chưa nhận diện'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Cookie Partition:</span>
                <span className={sessionHealth.hasSession ? 'text-emerald-300' : 'text-rose-300'}>
                  {sessionHealth.hasSession ? 'Đã lưu trữ an toàn' : 'Chưa có cookie'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleReauthViaLobby}
                className="flex-1 rounded-lg border border-amber-600/60 bg-amber-950/40 hover:bg-amber-900/60 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:text-white transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Đăng nhập lại qua Lobby</span>
              </button>

              {onOpenDiagnosticsModal && (
                <button
                  type="button"
                  onClick={onOpenDiagnosticsModal}
                  className="rounded-lg border border-border bg-surface hover:bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text hover:text-white transition cursor-pointer flex items-center gap-1"
                  title="Kiểm tra chẩn đoán toàn diện hệ thống"
                >
                  <Terminal className="h-3.5 w-3.5 text-accent" />
                  <span>Chẩn đoán</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="px-5 py-3 border-t border-border bg-[#080D1A] flex items-center justify-between text-[11px] text-text-muted shrink-0">
          <span>VANHSUB Flow Engine v2.0</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-surface hover:bg-surface-2 px-3 py-1 text-xs font-semibold text-white transition cursor-pointer"
          >
            Đóng khay
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdvancedInfrastructureDrawer;
