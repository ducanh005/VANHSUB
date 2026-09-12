import { SettingsStore } from '../store/settingsStore';
import type { AntiSpamStatus, AntiSpamWarningItem } from './types';

/**
 * Lớp bảo vệ chống Spam và phát hiện Bot của Google (Anti-Spam & Bot Guard).
 * Quản lý cooldown, độ trễ ngẫu nhiên mô phỏng người thật (human jitter),
 * và khóa thực thi tuần tự (concurrency = 1).
 */
export class GoogleVeoAntiSpamGuard {
  private static instance: GoogleVeoAntiSpamGuard | null = null;

  private lastRequestTimestamp = 0;
  private isGenerating = false;

  private constructor() {}

  static getInstance(): GoogleVeoAntiSpamGuard {
    if (!this.instance) {
      this.instance = new GoogleVeoAntiSpamGuard();
    }
    return this.instance;
  }

  /** Lấy thời gian hồi chiêu cấu hình (mặc định 45 giây) */
  private getCooldownMs(): number {
    try {
      const sec = Number(SettingsStore.get('veoCooldownSeconds')) || 45;
      return Math.max(15, Math.min(180, sec)) * 1000;
    } catch {
      return 45_000;
    }
  }

  /**
   * Lấy trạng thái hồi chiêu và kiểm tra xem có được phép gửi request tiếp theo không.
   */
  getStatus(): AntiSpamStatus {
    const cooldownMs = this.getCooldownMs();
    const now = Date.now();
    const elapsed = now - this.lastRequestTimestamp;
    const remainingCooldownSec = this.lastRequestTimestamp === 0
      ? 0
      : Math.max(0, Math.ceil((cooldownMs - elapsed) / 1000));

    let warningMessage: string | undefined;
    if (this.isGenerating) {
      warningMessage = 'Đang có một video Veo đang được tạo trên session này. Vui lòng chờ hoàn tất.';
    } else if (remainingCooldownSec > 0) {
      warningMessage = `Đang trong thời gian hồi chiêu an toàn chống Google gắn cờ spam (${remainingCooldownSec}s).`;
    }

    return {
      allowed: !this.isGenerating && remainingCooldownSec === 0,
      remainingCooldownSec,
      cooldownTotalSec: Math.round(cooldownMs / 1000),
      warningMessage,
      isLocked: this.isGenerating,
      lastRequestTimestamp: this.lastRequestTimestamp,
    };
  }

  /**
   * Kiểm tra trước khi bắt đầu tạo video. Ném lỗi hoặc trả về thời gian cần chờ.
   */
  canProceed(): { allowed: boolean; remainingSec: number; reason?: string } {
    const status = this.getStatus();
    if (status.isLocked) {
      return {
        allowed: false,
        remainingSec: 0,
        reason: 'Hệ thống đang bận sinh video trước đó. Vui lòng không spam nhiều tác vụ cùng lúc.',
      };
    }

    if (status.remainingCooldownSec > 0) {
      return {
        allowed: false,
        remainingSec: status.remainingCooldownSec,
        reason: `Vui lòng chờ thêm ${status.remainingCooldownSec} giây để đảm bảo an toàn, tránh Google chặn tài khoản do thao tác quá nhanh.`,
      };
    }

    return { allowed: true, remainingSec: 0 };
  }

  /** Đánh dấu bắt đầu một request sinh video (Khóa tuần tự) */
  acquireLock(): void {
    if (this.isGenerating) {
      throw new Error('Chỉ được phép tạo 1 video tại một thời điểm trên cùng một Session để tránh bị Google ban.');
    }
    this.isGenerating = true;
  }

  /** Đánh dấu kết thúc request và kích hoạt bộ đếm hồi chiêu */
  releaseLock(): void {
    this.isGenerating = false;
    this.lastRequestTimestamp = Date.now();
  }

  /**
   * Đệm thêm độ trễ ngẫu nhiên (Human Jitter) để phá tính chu kỳ máy móc của Bot.
   */
  async applyHumanJitter(minMs = 2500, maxMs = 6000): Promise<number> {
    const jitter = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await new Promise((resolve) => setTimeout(resolve, jitter));
    return jitter;
  }

  /**
   * Danh mục 5 cảnh báo cốt lõi người dùng cần biết khi dùng credit miễn phí của Google.
   */
  static getSafetyGuidelines(): AntiSpamWarningItem[] {
    return [
      {
        id: 'warn-burner-account',
        title: 'Sử dụng tài khoản Google phụ (Burner Account)',
        description:
          'Khuyến cáo TUYỆT ĐỐI không dùng tài khoản Google chính (chứa Gmail quan trọng, Google Drive, Google Pay). Hãy tạo một tài khoản phụ riêng để trải nghiệm miễn phí, tránh rủi ro khi Google thắt chặt chính sách.',
        severity: 'high',
        icon: 'ShieldAlert',
      },
      {
        id: 'warn-cooldown',
        title: 'Tuân thủ giãn cách an toàn (Cooldown 45s)',
        description:
          'Google theo dõi tần suất gửi lệnh. Việc bấm nút tạo liên tục trong vài giây sẽ kích hoạt hệ thống Botguard khiến tài khoản bị khóa tạm thời. App tự động khóa giãn cách 45s giữa các lần tạo video.',
        severity: 'medium',
        icon: 'Timer',
      },
      {
        id: 'warn-clean-network',
        title: 'Mạng Internet sạch & Tránh VPN/Proxy đen',
        description:
          'Các dải IP Datacenter, VPN miễn phí hoặc proxy công cộng đều nằm trong danh sách đen của Google Labs. Hãy sử dụng kết nối mạng gia đình bình thường để không bị yêu cầu giải reCAPTCHA.',
        severity: 'medium',
        icon: 'Wifi',
      },
      {
        id: 'warn-daily-quota',
        title: 'Hạn mức Credit hàng ngày (Daily Quota)',
        description:
          'Mỗi tài khoản Google Labs có hạn mức tạo video miễn phí theo ngày. Khi thấy thông báo hết credit, hãy dừng lại hoặc đổi sang tài khoản phụ khác, không spam tiếp.',
        severity: 'info',
        icon: 'Calendar',
      },
      {
        id: 'warn-captcha-resolve',
        title: 'Giải Captcha thủ công khi bị nghi ngờ',
        description:
          'Nếu Google nghi ngờ và yêu cầu xác minh Captcha, app sẽ phát hiện và có nút "Mở sảnh Google" ngay lập tức để bạn giải Captcha bằng tay, sau đó tiếp tục sử dụng bình thường.',
        severity: 'info',
        icon: 'CheckCircle2',
      },
    ];
  }
}
