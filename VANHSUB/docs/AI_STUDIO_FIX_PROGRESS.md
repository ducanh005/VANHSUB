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

Commit đợt 4: `f642fb2` (đã push main).

## Đợt 5 — Khóa tác vụ và kiểm soát chuyển bước (AS-03)

- Reservation đồng bộ theo session bảo vệ approve/resume, render/regenerate/import và IPC sửa/chấm kịch bản. Tác vụ của session khác vẫn chạy độc lập.
- Approve phải khớp bước hiện tại, bước đã success và session đang awaiting_approval. Từ chối stage ngoài 1–8 trước khi xóa/reset artifacts. Hai lệnh duyệt đồng thời chỉ có một lệnh được chấp nhận.
- Cancel abort/kill process nhưng giữ khóa tới khi promise thật kết thúc. Chặn nhận kết quả script/TTS/metadata muộn sau cancel, và kiểm tra signal trước lưu media/render.
- Cancel ở cổng duyệt giữ success của bước đã hoàn tất; resume mặc định sang bước kế tiếp. Shared error handler luôn nhả khóa và vẫn gửi lỗi khi không lưu được failure checkpoint.
- Lookup phân biệt job đang chạy thật với checkpoint running đã gián đoạn. `jobActive` là dữ liệu runtime, không lưu xuống checkpoint. UI khôi phục trạng thái chạy và lấy kết quả hủy từ backend, không tự giả lập thành công khi hủy lỗi.
- `tests/test_ai_studio_session_operations.ts`: pass; kiểm chứng duyệt sai bước, payload không làm đổi dữ liệu khi bị từ chối, duyệt trùng, khóa mutator, provider bỏ qua abort, cancel tại gate, kết quả muộn và phục hồi job gián đoạn.
- Snapshot/cách ly regression và TypeScript được kiểm tra. Provider live và UI Electron trực quan vẫn chưa được nghiệm thu.

Commit đợt 5: `5d6e81e` (đã push main).

## Đợt 6 — Vô hiệu hóa sản phẩm sau khi sửa kịch bản (AS-04)

- Sửa lời đọc/speaker/voiceDirection hoặc thứ tự dòng làm mất hiệu lực audio, alignment, storyboard, sub, video và metadata; quay về cổng duyệt kịch bản. Chỉ đổi chỉ dẫn hình ảnh giữ audio/timing và quay về cổng duyệt alignment nếu đã hoàn tất.
- Mỗi lần sửa lời hoặc chạy lại bước 1–3 dùng thư mục production revision mới. Checkpoint giữ vị trí ổn định; voice/timing/media cũ không bị xóa và không được dùng làm cache cho bản lời mới. Undo cũng tạo revision mới, không khôi phục pointer audio cũ.
- Chặn kịch bản rỗng/ID trùng; no-op giữ sản phẩm. Lưu history trước thay đổi; bỏ điểm đánh giá cũ.
- IPC trả lại session đã invalidation. Inline edit/undo chỉ cập nhật UI khi lưu thành công; lỗi giữ form. Refinement không tự chấm lại bằng closure chứa lời cũ. Bỏ auto-evaluation trùng với backend. Callback lưu checkpoint đúng owner và chặn response từ project đã rời.
- `tests/test_ai_studio_script_invalidation.ts`: pass trên checkpoint/storage thật, kiểm tra visual-only, narration, undo, no-op, input lỗi, cache mới, giữ file cũ và chặn render stale.
- Regression session operations/config và TypeScript main/renderer: pass. Chưa nghiệm thu provider live hoặc UI Electron trực quan. Cơ chế regenerate/cache media theo từng shot (AS-09) vẫn cần đợt riêng.
