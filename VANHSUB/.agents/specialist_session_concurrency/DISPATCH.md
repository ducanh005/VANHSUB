# Task Assignment: Track 2 — Session, Window & Concurrency Specialist

## Working Directory
`d:\DEAN\DEAN\VANHSUB\.agents\specialist_session_concurrency`

## Context & Authority
- Original Request: `d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md`
- Project Root: `d:\DEAN\DEAN\VANHSUB`
- Orchestrator Working Directory: `d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_1`

## Strict Constraints
- **READ-ONLY AUDIT**: Tuyệt đối KHÔNG sửa code, KHÔNG tạo/sửa file nguồn, KHÔNG làm thay đổi git status.
- Chỉ đọc mã nguồn, phân tích và ghi báo cáo vào thư mục làm việc của bạn (`.agents/specialist_session_concurrency/`).

## Detailed Investigation Scope
1. **GoogleVeoSessionManager.ts & lobbyWindow Lifecycle**:
   - Rà soát cơ chế quản lý lifecycle của `lobbyWindow` và session trong `main/veo/GoogleVeoSessionManager.ts` (hoặc các file liên quan trong `main/veo/`).
   - Phân tích cách khởi tạo cửa sổ, tái sử dụng cửa sổ (reuse), điều kiện đóng cửa sổ (close/destroy), và xử lý khi crash/unresponsive.
2. **GoogleFlowBrowserMutex & Concurrency Controls**:
   - Phân tích chi tiết cơ chế khoá `GoogleFlowBrowserMutex` (hoặc các mutex/lock liên quan): cơ chế lock/unlock, timeout, queueing.
   - Kiểm tra nguy cơ deadlock (ví dụ: lock không được giải phóng trong block catch/finally, hoặc gọi lồng nhau) hoặc race condition khi có nhiều request đồng thời gửi tới cùng 1 session hoặc nhiều profile.
3. **Canvas Cleanup & State Reset**:
   - Rà soát logic dọn dẹp canvas trước mỗi lượt sinh (prompt canvas, node canvas, file upload list).
   - Kiểm tra xem prompt cũ, ảnh tham chiếu cũ, hoặc node cũ có bị sót lại gây nhiễu cho lượt sinh tiếp theo không.
4. **Offscreen vs Onscreen & capturePage Diagnostics**:
   - Đánh giá cấu hình BrowserWindow: offscreen rendering vs onscreen (show: false, minimize, paint events).
   - Đánh giá cơ chế `capturePage` chẩn đoán: tần suất chụp, lưu ở đâu, có làm rò rỉ bộ nhớ (memory leak từ native Image) hoặc suy giảm hiệu năng không?
5. **Code nguy hiểm & Thành phần ổn định cần bảo tồn**:
   - Liệt kê các race conditions, memory leak, unhandled promise rejections.
   - Xác định rõ các thành phần mutex, auth, cookie injection đã chạy ổn định cần bảo tồn.

## Required Output
Viết báo cáo chuyên sâu và chi tiết vào `d:\DEAN\DEAN\VANHSUB\.agents\specialist_session_concurrency\handoff.md` (kèm trích dẫn file, số dòng cụ thể).
Khi hoàn thành, gửi tin nhắn báo cho Orchestrator với tóm tắt ngắn gọn và đường dẫn handoff.

## 2026-09-16T08:12:30Z
You are the Session, Window & Concurrency Specialist for the Google Flow automation audit.
Working directory: d:\DEAN\DEAN\VANHSUB\.agents\specialist_session_concurrency
Project root: d:\DEAN\DEAN\VANHSUB
Original Request: d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md
Your Dispatch Task: d:\DEAN\DEAN\VANHSUB\.agents\specialist_session_concurrency\DISPATCH.md
Parent Orchestrator: a5be9afe-bae5-4c77-9d8c-57596180e0cc

CRITICAL CONSTRAINTS:
- STRICT READ-ONLY AUDIT: DO NOT modify any source code files. DO NOT change git status. Write ONLY within your working directory d:\DEAN\DEAN\VANHSUB\.agents\specialist_session_concurrency.
- Read ORIGINAL_REQUEST.md and DISPATCH.md first.
- Scope: GoogleVeoSessionManager.ts, GoogleFlowBrowserMutex, lobbyWindow lifecycle, canvas cleanup before generation, race conditions / deadlocks under concurrent requests, offscreen vs onscreen window configuration, capturePage diagnostics.
- Provide concrete line numbers, lock/unlock tracing, canvas reset logic analysis, memory leak risks, and recommendations.
- Write your comprehensive, evidence-rich report to d:\DEAN\DEAN\VANHSUB\.agents\specialist_session_concurrency\handoff.md.
- Send a message to the orchestrator (a5be9afe-bae5-4c77-9d8c-57596180e0cc) with a summary and handoff path when finished.
