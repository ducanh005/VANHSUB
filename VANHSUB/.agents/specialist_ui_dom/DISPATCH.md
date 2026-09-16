# Task Assignment: Track 1 — UI & DOM Locator Specialist

## Working Directory
`d:\DEAN\DEAN\VANHSUB\.agents\specialist_ui_dom`

## Context & Authority
- Original Request: `d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md`
- Project Root: `d:\DEAN\DEAN\VANHSUB`
- Orchestrator Working Directory: `d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_1`

## Strict Constraints
- **READ-ONLY AUDIT**: Tuyệt đối KHÔNG sửa code, KHÔNG tạo/sửa file nguồn, KHÔNG làm thay đổi git status.
- Chỉ đọc mã nguồn, phân tích và ghi báo cáo vào thư mục làm việc của bạn (`.agents/specialist_ui_dom/`).

## Detailed Investigation Scope
1. **FlowElementFinder.ts & FlowElementSpecs.ts & Dispatcher Files**:
   - Rà soát toàn bộ các chiến lược định vị phần tử trong `main/workflow/flow-engine/FlowElementFinder.ts`, `FlowElementSpecs.ts`, và các file dispatcher cũ (`main/veo/VeoAutomationDispatcher.ts`, `main/veo/VeoAutomationDispatcher_old.ts` hoặc các file tương tự trong `main/veo/`, `main/workflow/`).
2. **Thống kê tỷ lệ phương pháp automation**:
   - Thống kê chi tiết số lượng và tỷ lệ % phụ thuộc:
     * Toạ độ tuyệt đối (`sendInputEvent`, click by x, y)
     * DOM selector (CSS selector, XPath, evaluate, getElementById, querySelector, attribute match)
     * OCR / Visual match
     * CDP (Chrome DevTools Protocol) direct calls.
   - Cung cấp danh sách cụ thể từng vị trí dùng toạ độ hardcoded (file, dòng code, mục đích).
3. **Đánh giá các cơ chế định vị nâng cao**:
   - Container scoping: Có cô lập tìm kiếm trong modal/dialog/canvas không?
   - Short-text protection: Xử lý thế nào khi tìm text ngắn (như "Create", "Gen", "1", "OK") để tránh match nhầm element khác?
   - Dynamic scoring: Thuật toán chấm điểm ứng viên element hoạt động ra sao?
   - Overlay detector: Phát hiện modal che khuất, backdrop, toast message, tooltip, popup consent chặn thao tác click.
4. **Trùng lặp code và Code nguy hiểm**:
   - Các logic selector/click/wait lặp đi lặp lại.
   - Các toạ độ cứng dễ vỡ khi thay đổi độ phân giải màn hình hoặc UI Google thay đổi.
   - Các thành phần finder đã hoàn thiện tốt cần bảo tồn.

## Required Output
Viết báo cáo chuyên sâu và chi tiết vào `d:\DEAN\DEAN\VANHSUB\.agents\specialist_ui_dom\handoff.md` (kèm trích dẫn file, số dòng cụ thể).
Khi hoàn thành, gửi tin nhắn báo cho Orchestrator với tóm tắt ngắn gọn và đường dẫn handoff.
