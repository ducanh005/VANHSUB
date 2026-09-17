## 2026-09-17T09:06:12Z
Bạn là Project Orchestrator (orchestrator_3) chịu trách nhiệm chỉ đạo và điều phối triển khai tính năng "Chế độ Tiết kiệm (ChatGPT Web Automation - Zero API Cost)" cho phân hệ AI Video Studio trên ứng dụng Vanhsub.

Thư mục làm việc của bạn: d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_3
Mã nguồn dự án: d:\DEAN\DEAN\VANHSUB

Yêu cầu chi tiết được ghi nhận tại file: d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md (phần "## 2026-09-17T09:05:25Z").
Tóm tắt các yêu cầu chính:
1. R1. Quản lý Phiên Trình duyệt Độc lập (ChatGPT Web Session Manager): ChatGptWebSessionManager trên Electron Main process với partition vĩnh viễn 'persist:chatgpt_session', cơ chế mở cửa sổ đăng nhập ChatGPT Web (https://chatgpt.com), kiểm tra isLoggedIn, hỗ trợ 2 chế độ (Offscreen / Live Window).
2. R2. Động cơ Tự động hóa DOM & Trích xuất Kịch bản (ChatGPT Web Automation Engine): Self-Healing DOM Automation (#prompt-textarea, button[data-testid="send-button"], data-testid="stop-button", [data-message-author-role="assistant"]), thuật toán Multi-turn Chunking cho kịch bản dài.
3. R3. Tích hợp Pipeline & Cấu hình AI Studio (Settings & Pipeline Integration): Mở rộng AiStudioConfig.llm (provider: 'chatgpt_web', chatgptWebMode: 'offscreen' | 'visible'), tích hợp ChatGptWebSessionManager vào AiStudioPipelineEngine bước 2 (Kịch bản).
4. R4. Giao diện Cài đặt & Trạng thái Người dùng (UI Enhancements): Tab Cài đặt (AiStudioSettingsTab) bổ sung provider ChatGPT Web, nút Đăng nhập + trạng thái, checkbox Live Window; Giao diện AutoPilotView & CustomStudioView hiển thị badge "⚡ Chế độ tiết kiệm: Đang chạy kịch bản qua ChatGPT Web miễn phí".
5. Tiêu chí nghiệm thu:
   - Automated Verification: Type check toàn bộ dự án (`npx tsc --noEmit`) đạt 100% không có lỗi.
   - Script kiểm thử (`scripts/test_chatgpt_web_automation.ts`) xác minh khởi tạo session partition và mô phỏng luồng prompt/stop-button/extract.
   - Functional Verification: Đăng nhập ghi nhớ session, tích hợp pipeline, chuyển đổi Offscreen / Live window.
