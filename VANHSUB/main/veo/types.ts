/**
 * Kiểu dữ liệu cho hệ thống Google Veo Session (Sảnh miễn phí),
 * Anti-Spam Guard và Quản lý Trạng thái Xác thực.
 */

export type VeoMode = 'free_session' | 'api_key' | 'simulation';

export type VeoSessionStatus =
  | 'active'
  | 'expired'
  | 'unauthenticated'
  | 'rate_limited'
  | 'captcha_required'
  | 'unknown';

export interface VeoSessionValidationResult {
  valid: boolean;
  status: VeoSessionStatus;
  detail: string;
  email?: string;
  quotaRemaining?: string;
  lastChecked: number;
}

export interface AntiSpamStatus {
  allowed: boolean;
  remainingCooldownSec: number;
  cooldownTotalSec: number;
  warningMessage?: string;
  isLocked: boolean;
  lastRequestTimestamp: number;
}

export interface VeoStatusPayload {
  mode: VeoMode;
  hasSession: boolean;
  sessionStatus: VeoSessionStatus;
  email?: string;
  lastChecked?: number;
  antiSpam: AntiSpamStatus;
}

export interface AntiSpamWarningItem {
  id: string;
  title: string;
  description: string;
  severity: 'high' | 'medium' | 'info';
  icon: string;
}
