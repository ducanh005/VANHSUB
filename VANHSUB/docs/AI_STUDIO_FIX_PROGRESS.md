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

Commit đợt 1: `e27fd6a` (đã push main).

## Đợt 2 — Giữ đủ lời đọc và áp dụng thông số dựng phim (AS-08, một phần AS-12)

- Clip ngắn được loop để bao phủ đúng thời lượng cảnh; xuất video giới hạn theo thời lượng giọng thay vì cắt theo stream visual ngắn nhất.
- Ken Burns nhận một frame nguồn rồi mở thành đúng số frame của cảnh, tránh nhân thời lượng khi ảnh input đang loop. Kiểm tra actual output duration trước báo dựng thành công.
- FPS 30/60 được dùng cho input, zoompan, filter và output; 4K thật theo tỷ lệ ngang/dọc/vuông.
- `tests/test_ai_studio_render_timeline.ts`: FFmpeg thật, pixel sampling xác nhận thứ tự/cắt cảnh, mẫu audio cuối xác nhận còn lời đọc, video dọc 60fps, ảnh có/không Ken Burns và một bản dựng 4K thật.
- TypeScript main/renderer và diff whitespace được kiểm tra trước commit.

AS-12 còn phần preset phụ đề và các thông số transition/zoom; chưa coi toàn bộ AS-12 đã hoàn tất. Chưa nghiệm thu footage/giọng thật hoặc bản đóng gói.
