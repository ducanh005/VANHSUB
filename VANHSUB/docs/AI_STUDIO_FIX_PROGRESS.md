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

Commit đợt 2: `7d2d583` (đã push main).

## Đợt 3 — Lưu đúng cấu hình kênh và kết quả lưu (AS-10, một phần AS-11)

- Backend lưu chỉnh sửa channelProfile vào savedProjects của project active; đổi kênh hoặc mở lại store không mất avatar/mô tả/voice/master prompt. Checkpoint mang bản sao profile cũ không được ghi đè profile hiện hành.
- Settings chỉ gửi các section người dùng sửa, không gửi cả project list/profile cũ. Form giữ section đang chỉnh khi có cập nhật tiến độ; các section chưa sửa vẫn nhận cấu hình mới. Edit phát sinh trong lúc save không bị đánh dấu đã lưu nhầm.
- Settings/reset/modal kênh/setup/chuyển/xóa project kiểm tra boolean lưu thành công; lỗi giữ nguyên màn hình và hiển thị thông báo lỗi. Setup dùng một lần saveProject thay vì nhiều lần ghi cùng dữ liệu.
- Modal kênh không reset draft chỉ vì response checkpoint tạo object profile mới có cùng nội dung.
- `tests/test_ai_studio_channel_settings.ts`: pass; kiểm chứng qua renderer store nối backend thật trên thư mục tạm, A→B→A, restart, checkpoint profile cũ, bảo toàn draft và rollback lỗi ghi.
- TypeScript main/renderer và diff whitespace: kiểm tra trước commit. Chưa nghiệm thu UI Electron trực quan.

AS-11 còn việc tuần tự/version hóa toàn bộ request store và cập nhật checkpoint/project data đồng thời; đợt này không coi tất cả race condition đã xử lý. Snapshot cấu hình của tập (AS-02) vẫn thuộc đợt riêng.

Commit đợt 3: `1c9c422` (đã push main).

## Đợt 4 — Cấu hình cố định theo từng tập (AS-02)

- Tập mới chụp riêng các section sản xuất, áp dụng options và tỷ lệ của blueprint khi start. Không chụp cả danh sách project. API key LLM/visual dùng cùng codec bảo vệ secret của settings store trước khi ghi checkpoint.
- Duyệt/resume, tạo lại scene, dựng lại video và IPC chấm/sửa script lấy cấu hình của session. Chuyển kênh/đổi model/giọng/thông số chung không đổi cấu hình của tập đang làm.
- Lựa chọn provider/voice tường minh trong options không bị profile kênh ghi đè; thông tin dự án Flow vẫn gắn với owner/session.
- Đổi shotMode/granularity của tập là override tường minh khi chạy lại từ bước 5, có kiểm tra enum và bước. Không sửa defaults của kênh khác. UI hiển thị tỷ lệ/resolution/FPS đã chụp và đọc mức phân cảnh/provider từ snapshot.
- Legacy có owner xác minh được sẽ chụp profile owner cùng cấu hình chung hiện tại vào lần sử dụng đầu. Không thể phục hồi cấu hình chung lịch sử đã bị thay đổi; session không xác định được owner khi đang có project active được chặn, thay vì lấy cấu hình kênh khác.
- `tests/test_ai_studio_session_config.ts`: pass trên store/checkpoint thật; các provider giả lập. Kiểm tra options, credential không có plaintext trong checkpoint, A→B/restart, đường gọi script/voice/render/regeneration và override storyboard. Không coi đây là nghiệm thu provider live.
- Regression cách ly session và TypeScript main/renderer được kiểm tra. Chưa xử lý AS-03 (khóa job), AS-04 (revision/invalidation) hoặc nội dung AI/refiner ở đợt này.
