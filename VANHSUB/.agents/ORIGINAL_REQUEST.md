# Original User Request

## 2026-09-16T08:10:28Z

# NHIỆM VỤ: AUDIT VÀ REFACTOR HỆ THỐNG TỰ ĐỘNG HÓA GOOGLE FLOW (ELECTRON + TYPESCRIPT)

Working directory: d:/DEAN/DEAN/VANHSUB
Integrity mode: development (Read-Only Audit: Tuyệt đối KHÔNG sửa code, KHÔNG làm thay đổi git status).

## 1. PHÂN CÔNG ĐỘI NGŨ CHUYÊN TRÁCH (FULL TEAM SPECIALIZATION)
1. **UI & DOM Locator Specialist**:
   - Rà soát toàn bộ các chiến lược định vị phần tử trong `main/workflow/flow-engine/FlowElementFinder.ts`, `FlowElementSpecs.ts`, và các file dispatcher cũ.
   - Thống kê tỷ lệ phụ thuộc toạ độ tuyệt đối (`sendInputEvent`) vs DOM selector vs OCR/CDP.
   - Đánh giá container scoping, short-text protection, dynamic scoring và overlay detector.

2. **Session, Window & Concurrency Specialist**:
   - Rà soát cơ chế quản lý lifecycle của `lobbyWindow` và session trong `main/veo/GoogleVeoSessionManager.ts`.
   - Phân tích cơ chế khoá `GoogleFlowBrowserMutex`, canvas cleanup trước lượt sinh, và nguy cơ deadlock hoặc race condition giữa nhiều yêu cầu đồng thời.
   - Đánh giá xử lý cửa sổ offscreen vs onscreen và capturePage diagnostic.

3. **Error, Retry & Recovery Specialist**:
   - Rà soát phân loại lỗi `FlowErrorClassifier.ts`, chiến lược phục hồi `FlowRecoveryManager.ts`, và retry logic `FlowRetryManager.ts`.
   - Kiểm tra tính luỹ kế / triệt tiêu tác dụng phụ (Idempotency Jump) khi gặp lỗi mạng tạm thời hoặc timeout.
   - Đánh giá khả năng phát hiện unknown state và cơ chế chụp màn hình / dump HTML chẩn đoán.

4. **IPC & Architecture Lead Agent (Tổng Hợp Báo Cáo)**:
   - Rà soát tất cả các IPC entry point kết nối giữa Renderer Process và Main Process (`ipcMain.handle`, `ipcRenderer.invoke`).
   - Tổng hợp kết quả từ 3 specialist thành báo cáo kiểm toán hoàn chỉnh 9 mục (Mục A đến Mục I) theo đúng cấu trúc tiêu chuẩn.

## 2. YÊU CẦU ĐẦU RA (BÁO CÁO 9 MỤC TỪ A ĐẾN I)
Báo cáo kiểm toán cuối cùng phải chứa đầy đủ và chi tiết 9 mục:
- A. Sơ đồ kiến trúc hiện tại: Luồng dữ liệu, các lớp điều phối từ UI renderer xuống Chromium webContents.
- B. Danh sách entry point (file + function): Tất cả các điểm tiếp nhận yêu cầu tạo ảnh/video từ người dùng.
- C. Các phương pháp automation đang tồn tại: Tỷ lệ phối hợp giữa DOM query, Coordinate click, OCR, CDP.
- D. Danh sách các đoạn code trùng lặp: Các logic click, wait, poll, retry bị copy-paste qua nhiều file.
- E. Các đoạn code nguy hiểm: Hardcoded coordinates, race conditions trên browser window, nguy cơ infinite loops hoặc memory leak.
- F. Các thành phần đang hoạt động ổn định cần bảo tồn: Mutex, cookie injection, session auth, các module đã hoàn thiện từ Phase 1 - Phase 6 trong `main/workflow/flow-engine/`.
- G. Sơ đồ kiến trúc đề xuất: Mô hình hoàn thiện của State Machine + Verify-After-Action + Self-Healing + Task Queue cho các phase tiếp theo.
- H. Lộ trình migration theo từng bước nhỏ: Đánh giá lộ trình 10 Phase hiện tại, xác định vị trí hiện tại (sau Phase 6) và các điều chỉnh cần thiết cho Phase 7 - 10.
- I. Bước đầu tiên nhỏ nhất có giá trị cao nhất để tiếp tục: Định hình chính xác phạm vi và tiêu chí nghiệm thu cho Phase 7 (Task Queue & Checkpoint Resume).

TUYỆT ĐỐI KHÔNG SỬA ĐỔI SOURCE CODE.
Hãy tiến hành rà soát chuyên sâu và xuất báo cáo hoàn chỉnh!
