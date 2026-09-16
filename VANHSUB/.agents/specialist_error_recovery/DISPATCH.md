# Task Assignment: Track 3 — Error, Retry & Recovery Specialist

## Working Directory
`d:\DEAN\DEAN\VANHSUB\.agents\specialist_error_recovery`

## Context & Authority
- Original Request: `d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md`
- Project Root: `d:\DEAN\DEAN\VANHSUB`
- Orchestrator Working Directory: `d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_1`

## Strict Constraints
- **READ-ONLY AUDIT**: Tuyệt đối KHÔNG sửa code, KHÔNG tạo/sửa file nguồn, KHÔNG làm thay đổi git status.
- Chỉ đọc mã nguồn, phân tích và ghi báo cáo vào thư mục làm việc của bạn (`.agents/specialist_error_recovery/`).

## Detailed Investigation Scope
1. **FlowErrorClassifier.ts**:
   - Rà soát taxonomy phân loại lỗi trong `main/workflow/flow-engine/FlowErrorClassifier.ts` (và các file lỗi liên quan).
   - Kiểm tra các loại lỗi: mạng (network timeout, disconnect), authentication (cookie expired, captcha, relogin required), quota/rate limit, DOM element not found, server generation error (Veo/Imagen error status), unknown errors.
   - Đánh giá độ phủ (coverage) và độ chính xác của regex/pattern phân loại.
2. **FlowRecoveryManager.ts & Self-Healing Actions**:
   - Rà soát các chiến lược tự phục hồi: refresh page, re-navigate, re-authenticate, click dismiss modal, clear input, reload session.
   - Đánh giá cơ chế khôi phục có an toàn không, có làm mất context hay trạng thái công việc hiện tại không.
3. **FlowRetryManager.ts & Idempotency Jump**:
   - Rà soát logic retry: backoff (exponential vs constant), jitter, max retry attempts, retryable vs non-retryable errors.
   - Phân tích kỹ lưỡng **Idempotency Jump**: Khi gặp lỗi mạng tạm thời hoặc timeout sau khi đã click nút Generate/Create, hệ thống xử lý thế nào? Có click lại gây duplicate generation (tốn quota/tạo 2 video) không? Hay có bước kiểm tra xem task đã được submit thành công trên UI chưa trước khi quyết định retry/jump?
4. **Unknown State Detection & Diagnostic Artifacts**:
   - Khi UI rơi vào trạng thái không mong muốn (unrecognized DOM state), hệ thống phát hiện ra sao?
   - Cơ chế chẩn đoán: chụp screenshot (`capturePage`), dump DOM HTML (`webContents.executeJavaScript('document.documentElement.outerHTML')`), lưu log file. Kiểm tra dung lượng lưu trữ, đường dẫn lưu, dọn dẹp file tạm.
5. **Code trùng lặp & Code nguy hiểm**:
   - Các khối try-catch, sleep, poll bị duplicate qua nhiều file.
   - Các nguy cơ infinite loop retry hoặc nuốt lỗi (swallowing errors).
   - Các thành phần recovery đã hoàn thiện tốt cần bảo tồn.

## Required Output
Viết báo cáo chuyên sâu và chi tiết vào `d:\DEAN\DEAN\VANHSUB\.agents\specialist_error_recovery\handoff.md` (kèm trích dẫn file, số dòng cụ thể).
Khi hoàn thành, gửi tin nhắn báo cho Orchestrator với tóm tắt ngắn gọn và đường dẫn handoff.
