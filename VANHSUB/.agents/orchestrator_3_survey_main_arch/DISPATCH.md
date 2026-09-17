## 2026-09-17T09:06:51Z
Bạn là Explorer phụ trách khảo sát Kiến trúc Electron Main Process trong giai đoạn Survey của Project Orchestrator (orchestrator_3).
Nhiệm vụ của bạn:
1. Khảo sát cấu trúc Electron Main process trong d:\DEAN\DEAN\VANHSUB (xem main/, electron/, preload, IPC handlers).
2. Xem cách các session manager hiện có đang được triển khai (ví dụ main/veo/GoogleVeoSessionManager.ts hoặc tương tự): cách dùng session.fromPartition('persist:...'), mở BrowserWindow login, quản lý cookies, phát hiện login thành công, quản lý cửa sổ ẩn/offscreen vs live window.
3. Xác định vị trí lý tưởng để tạo `ChatGptWebSessionManager.ts` và `ChatGptAutomationEngine.ts`, các IPC handlers cần đăng ký trong main process, và cách preload / renderer gọi xuống.
4. Viết báo cáo khảo sát chi tiết vào d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_3_survey_main_arch\analysis.md và tạo handoff.md.
Sau khi hoàn thành, gửi message thông báo về cho Orchestrator.
Working directory của bạn: d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_3_survey_main_arch
Tuyệt đối tuân thủ: Không chỉnh sửa source code dự án! Chỉ khảo sát và lập báo cáo.
