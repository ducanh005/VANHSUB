# Tiến độ sửa AI Studio

Phạm vi: báo cáo kiểm tra AI Studio ngày 14/10/2026. Sửa theo từng đợt nhỏ, kiểm chứng và push từng commit lên main.

## Đợt 1 — Cách ly dữ liệu từng tập (AS-01)

- Tập mới lưu tại `<output>/sessions/<sessionId>`; media ở thư mục riêng của tập, kể cả khi nhiều kênh dùng chung output hoặc thư mục media ngoài.
- Session giữ `ownerProjectId`, `workspaceDir` và `mediaDir`; đọc/ghi/import/render không chuyển theo kênh đang active.
- Catalog checkpoint riêng theo ID giúp tìm lại tập sau restart. Checkpoint chỉ được nạp khi ID trong file khớp ID yêu cầu.
- Giữ đường dẫn legacy đã xác minh. Chặn ghi/render/regenerate nếu checkpoint/index thuộc session khác hoặc catalog chỉ ra tài nguyên dùng chung. Không tự di chuyển/xóa tài nguyên legacy.
- Ghi checkpoint thất bại được trả thành lỗi; không tiếp tục báo lưu thành công. File tạm có UUID và được dọn khi thất bại.

Kiểm chứng:

- `tests/test_ai_studio_session_isolation.ts`: pass; real start/storage/import, không gọi provider. Bao gồm hai tập cùng output/media root, switch/restart, lookup sai ID, bảo toàn legacy, chặn conflict trước fallback DOM, và lỗi ghi đĩa.
- TypeScript main và renderer: pass.
- `git diff --check`: pass.
- Bộ `scripts/test_google_flow_rpc_visual_service.ts` chưa pass và dừng trước các case engine: mock video/regenerate rơi vào endpoint kế thừa và yêu cầu cookies; fallback kỳ vọng cũ; test file rỗng dùng `assert.throws` cho `validateMediaFile` async, tạo rejection không được xử lý. Các lỗi đầu ra nằm trong service/RPC/test chưa sửa ở đợt này. Không coi bộ này là bằng chứng regression đã pass.

Giới hạn: chưa xác nhận provider live hay UI Electron. Chưa xử lý snapshot cấu hình, khóa job, invalidation, alignment hoặc render timeline; các mục này thuộc đợt sau. Legacy đã bị ghi đè vẫn không thể tự phục hồi.
