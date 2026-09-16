# Task Assignment: Track 4 — IPC & Architecture Lead Specialist

## Working Directory
`d:\DEAN\DEAN\VANHSUB\.agents\specialist_ipc_arch`

## Context & Authority
- Original Request: `d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md`
- Project Root: `d:\DEAN\DEAN\VANHSUB`
- Orchestrator Working Directory: `d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_1`

## Strict Constraints
- **READ-ONLY AUDIT**: Tuyệt đối KHÔNG sửa code, KHÔNG tạo/sửa file nguồn, KHÔNG làm thay đổi git status.
- Chỉ đọc mã nguồn, phân tích và ghi báo cáo vào thư mục làm việc của bạn (`.agents/specialist_ipc_arch/`).

## Detailed Investigation Scope
1. **Toàn bộ IPC Entry Points (Renderer -> Main)**:
   - Quét và lập danh mục toàn diện tất cả các IPC handlers liên quan đến Google Flow, Veo, Imagen, automation generation.
   - Tìm kiếm các `ipcMain.handle`, `ipcMain.on` trong `main/` (ví dụ `main/veo/`, `main/ipc/`, `main/index.ts`, `main/workflow/`).
   - Đối chiếu với các `ipcRenderer.invoke`, `ipcRenderer.send`, preload scripts (`preload/index.ts` hoặc tương tự), và UI components gọi IPC (`renderer/` hoặc tương đương).
   - Lập bảng: Channel Name | File & Line | Handler Function | Params | Return Type | Caller File & Line | Description.
2. **Sơ đồ kiến trúc hiện tại (End-to-End Data Flow)**:
   - Vẽ luồng dữ liệu chi tiết từ UI renderer (người dùng bấm nút tạo ảnh/video/flow) -> Preload bridge -> IPC Main listener -> Controller/Dispatcher/SessionManager -> FlowEngine -> Chromium webContents / DOM.
   - Phân tích các lớp trừu tượng (Layers of Abstraction): UI Layer, IPC Layer, Service/Orchestration Layer, Automation/Engine Layer, Browser/Driver Layer.
3. **Hiện trạng triển khai Phase 1 - Phase 6 vs Phase 7 - 10**:
   - Rà soát các tài liệu thiết kế hoặc codebase hiện tại trong `main/workflow/flow-engine/` để xác định chính xác những gì đã được xây dựng từ Phase 1 đến Phase 6.
   - Đánh giá kiến trúc hiện tại đã có những gì (ví dụ: Element Finder, Action Verifier, Error Classifier, Recovery Manager, Session Mutex...).
   - Xác định rõ vị trí ranh giới giữa Phase 6 và Phase 7, những khoảng trống kiến trúc (gaps) cần giải quyết ở Phase 7 (Task Queue & Checkpoint Resume), Phase 8, Phase 9, Phase 10.
4. **Sơ đồ kiến trúc đề xuất & Kế hoạch tổng hợp**:
   - Phác thảo mô hình kiến trúc chuẩn tương lai: State Machine + Verify-After-Action + Self-Healing + Task Queue.
   - Chuẩn bị khung cấu trúc tổng hợp cho Báo cáo kiểm toán 9 mục (A đến I) để phối hợp với Orchestrator và các track 1, 2, 3.

## Required Output
Viết báo cáo chuyên sâu và chi tiết vào `d:\DEAN\DEAN\VANHSUB\.agents\specialist_ipc_arch\handoff.md` (kèm trích dẫn file, số dòng cụ thể).
Khi hoàn thành, gửi tin nhắn báo cho Orchestrator với tóm tắt ngắn gọn và đường dẫn handoff.
