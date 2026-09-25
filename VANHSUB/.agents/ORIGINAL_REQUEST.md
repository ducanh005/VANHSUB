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

## 2026-09-17T06:24:37Z

Triển khai toàn diện phân hệ AI Video Studio cho ứng dụng Vanhsub dựa trên tài liệu đặc tả d:\DEAN\DEAN\VANHSUB\AI_STUDIO_SPEC.md. Hệ thống bổ sung tính năng sản xuất video tự động từ A-Z với 2 chế độ độc lập: "AI Tự Sản Xuất" (Auto-Pilot One-Click Pipeline) và "Người Dùng Tự Workflow" (Custom Studio can thiệp từng bước), đi kèm hệ thống lưu trữ cấu hình riêng biệt và tách biệt hoàn toàn với Canvas Workflow để tích hợp sau.

Working directory: d:\DEAN\DEAN\VANHSUB
Integrity mode: development

## Requirements

### R1. Hệ thống Cấu hình & Store Độc lập (Dedicated Settings & Store)
- Xây dựng kho lưu trữ cấu hình độc lập `aiStudioStore` (hỗ trợ cả Electron Main process qua `electron-store` và Renderer process qua Zustand).
- Định nghĩa đầy đủ các trường cấu hình theo đúng schema trong `AI_STUDIO_SPEC.md`:
  - `llm`: Provider (DeepSeek, OpenAI, Custom), API Key, Model, Temperature, System Prompt Presets.
  - `voice`: Provider (`msedge-tts`), Voice ID, Tốc độ, Cao độ, Tự động trích xuất Word-boundary.
  - `flowEngine`: Tỷ lệ khung hình (16:9, 9:16, 1:1), Chế độ đầu ra, Style Prompt Prefix, Negative Prompt, Thư mục lưu trữ assets.
  - `rendering`: Độ phân giải (1080p, 720p, 4k), FPS, Hiệu ứng Ken Burns (Zoom/Pan), Âm lượng BGM, Tự động hạ nhạc nền (Audio Ducking).
  - `subtitles`: Kiểu hiển thị (TikTok bold, Minimalist, Karaoke glow), Font size, Màu sắc, Vị trí.
- Đảm bảo không làm thay đổi hoặc gây xung đột với `settingsStore` và `workflowStore` hiện hữu của Vanhsub.

### R2. Động cơ Điều phối Pipeline (AI Studio Pipeline Engine)
- Xây dựng backend service điều phối chuỗi 8 công đoạn liên hoàn:
  1. `Dữ kiện`: Phân tích chủ đề / tài liệu nguồn.
  2. `Kịch bản`: Gọi LLM (DeepSeek / OpenAI) sinh kịch bản cấu trúc theo từng câu / beat.
  3. `Lồng tiếng`: Dùng `msedge-tts` chuyển văn bản thành audio file tiếng Việt tự nhiên.
  4. `Trích xuất Time`: Lấy timestamp chi tiết (start/end) cho từng câu thoại / từ vựng.
  5. `Storyboard`: Sinh Visual Prompt tiếng Anh tối ưu cho từng phân cảnh dựa trên câu thoại tương ứng.
  6. `Ảnh/Video`: Kết nối điều phối task với Google Flow Engine (hỗ trợ chế độ thực tế hoặc fallback mock assets khi chưa đăng nhập).
  7. `Dựng phim`: Dùng `fluent-ffmpeg` ghép Audio + Visual assets (áp hiệu ứng Ken Burns) + Phụ đề động thành file MP4 hoàn chỉnh.
  8. `SEO & Xuất bản`: Sinh tiêu đề, mô tả, hashtag và siêu dữ liệu cho video.
- Tích hợp cơ chế Checkpoint / State Machine: Lưu trạng thái từng bước để cho phép bấm "Tiếp tục" hoặc "Chạy lại" từng công đoạn khi gặp lỗi mà không phải chạy lại từ đầu.

### R3. Giao diện Chế độ 1: AI Tự Sản Xuất (One-Click Auto-Pilot)
- Màn hình tiếp nhận ý tưởng / chủ đề với nút bấm "Bắt đầu sản xuất".
- Bảng hiển thị tiến độ 8 bước trực quan thời gian thực (Status Tracker) hiển thị trạng thái từng bước (`pending`, `running`, `success`, `error`).
- Trình xem trước kết quả nhanh (Audio Player nghe thử giọng đọc, Video Player xem sản phẩm hoàn tất, nút Tải về video).

### R4. Giao diện Chế độ 2: Người Dùng Tự Workflow (Custom Studio)
- Cung cấp giao diện làm việc chi tiết với 3 Tab chức năng:
  - **Tab Kịch bản & Giọng:** Cho phép nhấp sửa trực tiếp nội dung từng câu thoại kèm mốc timeline, nghe thử audio, tạo lại giọng từng câu và nút chấm điểm kịch bản.
  - **Tab Phân cảnh Visual (Storyboard):** Hiển thị danh sách card phân cảnh theo timeline, cho phép sửa Visual Prompt, bấm sinh lại từng ảnh hoặc tải ảnh thủ công từ máy tính.
  - **Tab Dựng phim & Phụ đề:** Tùy biến kiểu chữ phụ đề, bật/tắt hiệu ứng Ken Burns, chọn nhạc nền BGM, thanh chỉnh âm lượng và trình phát xem trước trực tiếp.

### R5. Tích hợp Điều hướng Ứng dụng (App Navigation Integration)
- Bổ sung mục "AI Studio" trên thanh Sidebar của Vanhsub, cho phép chuyển đổi mượt mà giữa Chế độ Tự Sản Xuất, Tự Workflow và Màn hình Cấu hình.
- Đảm bảo thiết kế đồng bộ với Design System (TailwindCSS, Radix UI, Dark mode) của Vanhsub.

## Acceptance Criteria

### Automated Verification
- [ ] Type check toàn bộ dự án (`npm run build` hoặc `npx tsc --noEmit`) đạt 100% không có lỗi biên dịch TypeScript.
- [ ] Có script kiểm thử độc lập (ví dụ `scripts/test_ai_studio_pipeline.ts`) xác minh thành công luồng: Lưu/Đọc cấu hình $\rightarrow$ Sinh kịch bản mẫu $\rightarrow$ Tạo file âm thanh qua `msedge-tts` $\rightarrow$ Trích xuất time alignment $\rightarrow$ Dựng video demo qua FFmpeg.

### Functional Verification
- [ ] Giao diện AI Studio hiển thị đầy đủ trên Sidebar, chuyển đổi trơn tru giữa Auto-Pilot, Custom Studio và Settings.
- [ ] Cấu hình lưu trữ độc lập qua `electron-store`, giữ nguyên giá trị sau khi khởi động lại ứng dụng.
- [ ] Bảng trạng thái Auto-Pilot cập nhật đúng tiến trình 8 bước khi kích hoạt.
- [ ] Custom Studio cho phép người dùng sửa text câu thoại, cập nhật storyboard và thay đổi tham số dựng phim.

## 2026-09-17T09:05:25Z

Triển khai "Chế độ Tiết kiệm (ChatGPT Web Automation - Zero API Cost)" cho phân hệ AI Video Studio trên ứng dụng Vanhsub. Tính năng này cho phép người dùng sử dụng chính tài khoản ChatGPT Web miễn phí để sinh kịch bản video mà không tốn chi phí API token, tương tự tính năng Chế độ Tiết kiệm của Revo Studio, tận dụng nền tảng Electron Session và Browser Automation có sẵn trong Vanhsub.

Working directory: d:\DEAN\DEAN\VANHSUB
Integrity mode: demo

## Requirements

### R1. Quản lý Phiên Trình duyệt Độc lập (ChatGPT Web Session Manager)
- Xây dựng `ChatGptWebSessionManager` trên Electron Main process với partition vĩnh viễn `persist:chatgpt_session` để lưu trữ cookie và trạng thái đăng nhập lâu dài.
- Cung cấp cơ chế mở cửa sổ đăng nhập ChatGPT Web (`https://chatgpt.com`), hỗ trợ đầy đủ các hình thức đăng nhập (Google, Microsoft, Apple, Email/Password) và tự động ghi nhận khi người dùng đăng nhập thành công.
- Tự động phát hiện trạng thái đăng nhập (`isLoggedIn`). Nếu người dùng yêu cầu sinh kịch bản mà chưa đăng nhập, tự động kích hoạt cửa sổ nhắc đăng nhập.
- Hỗ trợ 2 chế độ hiển thị linh hoạt theo cài đặt của người dùng:
  - **Chạy ngầm (Offscreen / Background):** Cửa sổ đặt ngoài tầm nhìn, hoàn toàn không làm gián đoạn trải nghiệm người dùng.
  - **Xem trực tiếp (Live Window):** Cửa sổ hiển thị nổi trên màn hình để người dùng có thể trực tiếp theo dõi AI gõ chữ thời gian thực.

### R2. Động cơ Tự động hóa DOM & Trích xuất Kịch bản (ChatGPT Web Automation Engine)
- Triển khai cơ chế tương tác DOM chống gián đoạn (Self-Healing DOM Automation):
  - Tự động định vị ô nhập chat (`#prompt-textarea`, `div[contenteditable="true"]`).
  - Gửi nội dung prompt an toàn thông qua Dispatch Keyboard / InputEvent để kích hoạt React state nội bộ của ChatGPT.
  - Tự động kích hoạt nút gửi tin nhắn (`button[data-testid="send-button"]`).
  - Lắng nghe trạng thái sinh phản hồi: Chờ nút `data-testid="stop-button"` xuất hiện và biến mất khi hoàn thành sinh văn bản.
  - Trích xuất toàn bộ câu trả lời từ khối tin nhắn của trợ lý (`[data-message-author-role="assistant"]`).
- Triển khai thuật toán **Gửi nhiều đoạn theo một hội thoại (Multi-turn Chunking)** giống Revo Studio: Chia kịch bản dài thành các đoạn nhỏ và gửi nối tiếp trong cùng một phiên chat để tránh bị cắt cụt do giới hạn token của bản web miễn phí.

### R3. Tích hợp Pipeline & Cấu hình AI Studio (Settings & Pipeline Integration)
- Mở rộng cấu hình `AiStudioConfig.llm`:
  - Bổ sung tùy chọn `provider: 'chatgpt_web'` bên cạnh `deepseek`, `openai`, `custom`.
  - Thêm cấu hình hiển thị: `chatgptWebMode: 'offscreen' | 'visible'`.
- Tích hợp `ChatGptWebSessionManager` vào `AiStudioPipelineEngine`: Khi pipeline bước vào công đoạn 2 (Kịch bản) và cấu hình là `chatgpt_web`, hệ thống sẽ tự động ủy quyền sinh kịch bản qua trình duyệt thay vì gọi HTTP API.

### R4. Giao diện Cài đặt & Trạng thái Người dùng (UI Enhancements)
- **Trong Tab Cài đặt AI Studio (`AiStudioSettingsTab`):**
  - Thêm tùy chọn "ChatGPT Web (Chế độ tiết kiệm - Miễn phí 100%)" vào danh sách Provider.
  - Nút bấm *"Đăng nhập ChatGPT"* kèm đèn báo trạng thái (Xanh: Đã đăng nhập, Xám: Chưa đăng nhập).
  - Checkbox tùy chọn: *"Xem trực tiếp AI gõ chữ (Live Window)"*.
- **Trong Giao diện Kịch bản (`AutoPilotView` & `CustomStudioView`):**
  - Hiển thị huy hiệu thông báo: *"⚡ Chế độ tiết kiệm: Đang chạy kịch bản qua ChatGPT Web miễn phí"* tương tự Revo Studio.

## Acceptance Criteria

### Automated Verification
- [ ] Type check toàn bộ dự án (`npx tsc --noEmit`) đạt 100% không có lỗi biên dịch.
- [ ] Có script kiểm thử (`scripts/test_chatgpt_web_automation.ts`) xác minh:
  - Khởi tạo session partition `persist:chatgpt_session` thành công.
  - Mô phỏng/thực thi luồng nhập prompt, đợi stop-button và trích xuất text phản hồi đúng định dạng JSON kịch bản.

### Functional Verification
- [ ] Nút "Đăng nhập ChatGPT" trong Cài đặt mở đúng trang đăng nhập và ghi nhớ session sau khi tắt/bật lại app.
- [ ] Khi chọn provider `chatgpt_web`, pipeline bước 2 (Kịch bản) tự động điều hướng sang ChatGPT Web và trích xuất kịch bản thành công vào danh sách phân cảnh.
- [ ] Tùy chọn chuyển đổi giữa Chạy ngầm (Offscreen) và Xem trực tiếp (Live Window) hoạt động chính xác.

## 2026-09-18T15:26:02Z

Triển khai hệ thống tự động hóa công đoạn Storyboard (Giai đoạn 5) và Sinh Ảnh/Video AI (Giai đoạn 6) cho phân hệ AI Video Studio của Vanhsub dựa trên Browser Automation qua Google Flow, tuân thủ nghiêm ngặt kiến trúc lưu trữ đĩa cục bộ làm nguồn sự thật (Local Disk Source of Truth), cơ chế tương tác an toàn (Visual Settle & Highlight), và quy trình Image-to-Video trực tiếp bằng đường dẫn tệp theo tài liệu `spec-pipeline-video-automation.md`.

Working directory: d:\DEAN\DEAN\VANHSUB
Integrity mode: development

## Requirements

### R1. Lưu Trữ Đĩa Cục Bộ Là Nguồn Sự Thật (Local Disk Source of Truth & Directory Structure)
- Khởi tạo và đồng bộ trạng thái pipeline vào thư mục phiên làm việc theo cấu trúc chuẩn trong `spec-pipeline-video-automation.md`:
  ```
  /project/{project_id}/ (hoặc sessions/{session_id}/)
    00_facts/facts.json
    01_script/script.json
    02_voice/{scene_id}.mp3
    03_timing/timing.json (thời lượng âm thanh thực tế qua ffprobe)
    04_storyboard/storyboard.json
    05_media/
      {shot_id}_img_v1.png
      {shot_id}_vid_v1.mp4
    index.json (metadata bản đồ trạng thái tổng hợp)
  ```
- **Idempotency & Khả năng tiếp tục (Resumable):** Trước khi tạo bất kỳ asset nào, kiểm tra `index.json`. Nếu tệp cục bộ tương ứng đã tồn tại và hợp lệ (size > 0), bỏ qua việc tạo lại. Khi người dùng chủ động yêu cầu tạo lại, tự động đánh version mới (`_v2`, `_v3`) để bảo toàn lịch sử.
- Đảm bảo `scene_id` và `shot_id` (`{scene_id}_shot_{n}`) là định danh duy nhất xuyên suốt mọi giai đoạn.

### R2. Cơ Chế Tương Tác Trình Duyệt An Toàn (Visual Settle & Highlight Before Click)
- Áp dụng nguyên tắc **Confirm-Before-Act** cho mọi tương tác click trên giao diện Google Flow:
  1. Xác định bounding box của phần tử đích.
  2. Hiển thị khung highlight/overlay đè lên phần tử trong khoảng 200–400ms.
  3. Đo lại bounding box lần thứ hai. Nếu có sự xê dịch do trang đang re-render hoặc animation, hủy lệnh click và đợi ổn định.
  4. Chỉ dispatch click thật khi vị trí ổn định qua hai lần đo liên tiếp.
- Thay thế hoàn toàn `sleep` cố định bằng cơ chế **Polling thông minh** dựa trên DOM (theo dõi spinner, trạng thái nút tải xuống, trạng thái thẻ ảnh) hoặc lắng nghe mạng, kèm timeout tối đa (90s cho ảnh, 300s cho video) và số lần retry có giới hạn (tối đa 2 lần).

### R3. Giai Đoạn 5: Storyboard Đồng Bộ Với Thời Lượng Âm Thanh Thực Tế
- Nhận dữ liệu đầu vào từ `script.json` và `timing.json` (được trích xuất từ các file âm thanh `.mp3` thực tế bằng ffprobe/probed duration, không dùng ước lượng số ký tự).
- Sinh danh sách phân cảnh và các shots chi tiết: `shot_id`, `image_prompt`, `motion_note`, thời lượng dự kiến cho từng shot phù hợp với độ dài narration của scene.
- Ghi kết quả ra `04_storyboard/storyboard.json` và cập nhật `index.json`.

### R4. Giai Đoạn 6: Tự Động Hóa Tạo Ảnh & Video Từ Ảnh (Image-to-Video Engine)
- **Tạo ảnh (Text-to-Image):**
  - Điều hướng tới khu vực tạo ảnh trên Flow với cơ chế Confirm-Before-Act.
  - Nhập prompt an toàn, đọc lại giá trị ô nhập để xác thực đúng nội dung trước khi bấm Generate.
  - Poll đến khi ảnh hoàn tất, tải ngay về đĩa cục bộ: `05_media/{shot_id}_img_v1.png`, cập nhật `index.json`. Không dựa vào DOM của ảnh trên trình duyệt cho các bước sau.
- **Tạo video từ ảnh (Image-to-Video):**
  - Điều hướng tới khu vực tạo video từ ảnh trên Flow.
  - Tải ảnh lên bằng cách **truyền trực tiếp đường dẫn file cục bộ** (`05_media/{shot_id}_img_v1.png`) vào file input của trình duyệt, tuyệt đối không click chọn qua thumbnail trên trang web để tránh nhầm lẫn do thứ tự DOM/phân trang thay đổi.
  - Xác thực tên và kích thước file sau khi upload.
  - Áp dụng `motion_note` (nếu có), kích hoạt Generate video, poll trạng thái và tải video về `05_media/{shot_id}_vid_v1.mp4`.
  - Kiểm tra độ lệch thời lượng video so với storyboard (sai số > ±15% thì đánh dấu cờ `needs_review: true`, không tự ý cắt xén).

### R5. Tích Hợp Pipeline & Giao Diện Điều Khiển (Integration & UI Modes)
- Tận dụng và mở rộng `GoogleVeoSessionManager` và `flow-engine` có sẵn để tận dụng phiên đăng nhập, cookie và cơ chế rate limit.
- Tích hợp liền mạch vào `AiStudioPipelineEngine`: Công đoạn 5 (Storyboard) và Công đoạn 6 (Sinh ảnh/video) gọi engine mới với luồng lưu trữ đĩa cục bộ.
- Hỗ trợ linh hoạt 2 chế độ hiển thị:
  - **Chạy ngầm (Offscreen / Headless):** Hoạt động êm ái dưới nền.
  - **Xem trực tiếp (Live Window):** Cửa sổ nổi hiển thị rõ nét từng thao tác highlight, nhập prompt và sinh video thời gian thực.
- Ghi log chi tiết dạng JSON cho từng action theo chuẩn `spec-pipeline-video-automation.md`.

## Acceptance Criteria

### Automated Verification
- [ ] Kiểm tra toàn bộ mã nguồn (`npx tsc --noEmit`) đạt 100% không có lỗi Type.
- [ ] Có bộ kiểm thử tự động (`scripts/test_spec_pipeline_automation.ts`) xác minh:
  - Khởi tạo thư mục dự án chuẩn (`00_facts` đến `05_media`) và ghi nhận file `index.json` chuẩn xác.
  - Cơ chế Visual Settle đo lường 2 lần bounding box phát hiện chính xác trạng thái dịch chuyển và click an toàn.
  - Giai đoạn 5 tạo `storyboard.json` với `shot_id` phân cấp duy nhất và đồng bộ thời lượng từ file audio thật.
  - Luồng tạo ảnh và tạo video từ ảnh qua đường dẫn file cục bộ (local path injection) hoạt động thành công.
  - Cơ chế Idempotency: Khi asset đã tồn tại, tự động skip; khi regenerate, tạo phiên bản `_v2`.

### Functional Verification
- [ ] Chế độ Offscreen và Live Window chuyển đổi linh hoạt theo cấu hình người dùng.
- [ ] Quá trình chạy trong AI Studio cập nhật tiến độ phần trăm và ghi log action theo thời gian thực.

## 2026-09-21T16:07:56Z

Khắc phục triệt để 4 vấn đề cốt lõi trong phân hệ AI Video Studio của Vanhsub: (1) Ngăn chặn hoàn toàn việc cửa sổ Google Flow tự ý nhảy lên cướp focus khi người dùng đang làm việc khác; (2) Tối ưu hóa phân cảnh Storyboard: AI tự động phân tích và gom cụm nhiều câu thoại chung ngữ cảnh/bối cảnh vào 1 visual scene/shot thay vì cắt vụn 1 thoại = 1 ảnh; (3) Sửa dứt điểm lỗi lệch phân cảnh (off-by-one) khi gán reference images giữa các shot; (4) Xây dựng cơ chế cô lập lỗi (fault tolerance) và fallback an toàn chống sập dây chuyền (domino effect) khi Google Flow gặp sự cố ở bất kỳ shot nào.

Working directory: d:\DEAN\DEAN\VANHSUB
Integrity mode: development

## Requirements

### R1. Triệt Tiêu Hoàn Toàn Hành Vi Cướp Focus & Bật Cửa Sổ Google Flow (True Stealth & Offscreen Background Execution)
- Khi chế độ hiển thị được cấu hình là `offscreen` (mặc định trong pipeline tự động):
  - Tuyệt đối không gọi `win.show()`, `win.focus()`, `win.restore()`, hoặc bất kỳ API nào làm giật focus, đưa cửa sổ Flow đè lên trên màn hình người dùng.
  - Cửa sổ Google Flow phải luôn duy trì ở tọa độ ngoài màn hình (`OFFSCREEN_X, OFFSCREEN_Y`) hoặc ở trạng thái chạy ngầm không cướp tiêu điểm hệ điều hành.
  - Mọi thao tác click chuột, nhập prompt, gửi phím tắt (qua `sendInputEvent` và `executeJavaScript` trên WebContents) phải vận hành trơn tru ở chế độ nền mà không đòi hỏi cửa sổ phải hiển thị trên Desktop chính.
  - Chỉ hiển thị cửa sổ trực tiếp (`visible`) khi người dùng chủ động cấu hình chế độ xem trực tiếp hoặc bấm mở Sảnh thủ công để đăng nhập.

### R2. Storyboard Thông Minh Theo Ngữ Cảnh: Gom Cụm Lời Thoại (Semantic Scene Clustering & Pacing)
- Cải tiến Giai đoạn 5 (Storyboard Generation): Thay vì gán máy móc mỗi 1 câu thoại = 1 ảnh/vid (khiến video bị cắt vụn và spam quá nhiều ảnh không cần thiết), hệ thống LLM phải phân tích toàn diện kịch bản và dòng thời gian âm thanh thực tế (`03_timing/timing.json`):
  - Nhận diện các câu thoại có cùng không gian, bối cảnh, nhân vật hoặc mạch ý nghĩa để gom thành **1 Visual Scene / Shot duy nhất** kéo dài từ 4s đến 10s (khớp với thời lượng video hoặc ảnh tĩnh + Ken Burns).
  - Nội dung câu lệnh tạo ảnh (`image_prompt`) và ghi chú chuyển động (`motion_note`) của shot đó phải bao quát và liên quan mật thiết đến toàn bộ cụm câu thoại được gán cho nó.
  - Phân bố và ghi nhận chính xác thời điểm bắt đầu (`start_sec`), thời lượng (`duration_sec`), và danh sách các câu thoại thuộc phạm vi của từng shot trong `04_storyboard/storyboard.json` và `index.json`.

### R3. Sửa Dứt Điểm Lỗi Lệch Phân Cảnh Khi Gán Reference Images (Eliminate Off-by-one Chain Drift)
- Rà soát và chuẩn hóa toàn bộ luồng truyền `referenceImagePath` trong Giai đoạn 6 (`AiStudioPipelineEngine.ts`, `FlowMediaAutomationEngine.ts`, `AiStudioStyleRefsService.ts`):
  - Xóa bỏ triệt để hiện tượng phân cảnh 1 lấy ảnh nhân vật, phân cảnh 2 lấy ảnh của phân cảnh 1, phân cảnh 3 lấy của phân cảnh 2 (lệch một nhịp giữa visual prompt và reference).
  - Thiết lập cơ chế neo tham chiếu chuẩn mực (Canonical Style Anchor): Mọi shot đều sử dụng bộ ảnh tham chiếu chuẩn từ `style_refs` (`character_ref.png` cho nhân vật và `background_ref.png` cho bối cảnh).
  - Nếu một shot cần tham chiếu đến ảnh của shot trước đó (continuity shot), việc định danh shot trước phải dựa trên metadata định danh chính xác (`previous_shot_id`), tuyệt đối không dùng chỉ số mảng lệch (`idx - 1`) khi số lượng shots và scenes không đồng nhất.

### R4. Cơ Chế Cô Lập Lỗi & Chống Sập Dây Chuyền (Fault Isolation, Graceful Fallback & Domino Prevention)
- Thiết kế cơ chế xử lý lỗi kiên cố cho quy trình tạo ảnh/video trên Flow:
  - Nếu một shot bị lỗi sau tối đa số lần retry quy định (do rate limit, network, hoặc Flow từ chối prompt):
    - **Không làm sập toàn bộ pipeline**: Hệ thống ghi nhận trạng thái lỗi cục bộ của shot đó vào `index.json` và `session.json`, tự động kích hoạt asset dự phòng (fallback asset: sử dụng ảnh tham chiếu chuẩn hoặc duplicate từ shot liền kề hợp lệ), sau đó tiếp tục xử lý các shot còn lại.
    - **Không ảnh hưởng dây chuyền**: Các shot tiếp theo không bị đình trệ hay sai lệch reference vì lỗi của shot trước.
  - Tại Giai đoạn 7 (Dựng phim FFmpeg Assembly):
    - Tự động nhận diện những shot thiếu video (do lỗi sinh video hoặc chỉ có ảnh) để tự động áp dụng hiệu ứng chuyển động Ken Burns với thời lượng chuẩn xác theo audio, đảm bảo video đầu ra cuối cùng luôn hoàn chỉnh và đồng bộ 100% tiếng - hình.

## Acceptance Criteria

### Automated Verification
- [ ] Kiểm tra toàn bộ mã nguồn (`npx tsc --noEmit`) đạt 100% không có lỗi Type.
- [ ] Bộ kiểm thử tự động (`scripts/test_spec_pipeline_automation.ts` hoặc script test mới) xác minh:
  - Cửa sổ Flow ở chế độ `offscreen` không kích hoạt `win.show()` hay `win.focus()`.
  - Giai đoạn 5 Storyboard sinh ra số lượng shots tối ưu (gom cụm câu thoại, trung bình 5-8s/shot) thay vì 1 thoại = 1 shot.
  - Phân cảnh 1, 2, 3... nhận đúng prompt và reference image tương ứng, không bị trễ/lệch phân cảnh.
  - Mô phỏng 1 shot bị lỗi sinh ảnh/video $\rightarrow$ pipeline vẫn tiếp tục hoàn thành các shot còn lại và video dựng FFmpeg vẫn xuất thành công với fallback asset.

### Functional Verification
- [ ] Chạy pipeline thực tế trong AI Studio: cửa sổ Flow không tự ý nhảy lên cướp focus của người dùng trên Desktop.
- [ ] Dự án "Lịch sử của dòng điện tại nhật bản" tạo ra storyboard gọn gàng, visual bám sát cụm thoại, hình ảnh khớp đúng từng phân cảnh.

## 2026-09-21T17:00:45Z

Báo cáo tiến độ: Bạn đã hoàn thành những gì trong 4 nhiệm vụ sau chưa? Liệt kê cụ thể:

1. R1: Triệt tiêu win.show()/win.focus() trong offscreen mode (AiStudioPipelineEngine.ts, GoogleVeoSessionManager.ts, FlowVideoGenerationStates.ts)
2. R2: Semantic clustering — nhiều câu thoại → 1 shot (Stage 5 storyboard)
3. R3: Fix off-by-one reference image drift trong Stage 6
4. R4: Fault isolation — không throw/crash khi 1 shot lỗi, dùng fallback asset thay thế

Nếu đã hoàn thành, cho tôi biết:
- Những file nào đã được sửa
- `npx tsc --noEmit` kết quả ra sao
- Bất kỳ vấn đề còn tồn đọng không

Nếu chưa bắt đầu hoặc còn dang dở, hãy tiếp tục ngay và báo cáo khi xong.

## 2026-09-24T04:13:43Z

This is a single self-contained feature; keep it small and focused.

Thiết kế và xây dựng module lõi GoogleFlowRpcClient.ts hoạt động trực tiếp trong ngữ cảnh Electron Session của ứng dụng Vanhsub, thực hiện việc upload asset, gửi yêu cầu sinh ảnh/video và polling trạng thái generation thông qua Web RPC nội bộ của Google Flow thay thế cho việc click DOM giả lập.

Working directory: d:/DEAN/DEAN/VANHSUB
Integrity mode: development

## Requirements

### R1. In-Session Google Flow RPC Client
Xây dựng module GoogleFlowRpcClient.ts tương tác trực tiếp với phiên duyệt web của Google Flow trong Electron (thông qua webContents.executeJavaScript hoặc session.net.fetch). Client tự động kế thừa phiên đăng nhập Google hiện hữu, cookie xác thực và CSRF token từ trang flow.google.com mà không cần phụ thuộc vào tọa độ click hay selector DOM.

### R2. Asset Upload & Generation RPC Methods
Triển khai các phương thức RPC tiêu chuẩn để:
- Upload tệp cục bộ lên dịch vụ lưu trữ của Google Flow và nhận diện asset_id hợp lệ.
- Gửi lệnh tạo ảnh (generate_image) với các tham số: prompt, aspect ratio, seed, reference assets.
- Gửi lệnh tạo video (generate_video) với các tham số: prompt, aspect ratio, duration, input image asset và tùy chọn audio.

### R3. Async Polling State Machine & Structured Error Handling
Triển khai cơ chế polling bất đồng bộ theo dõi vòng đời tác vụ từ queued -> processing -> completed/failed. Trả về URL kết quả khi thành công, và phân loại lỗi rõ ràng (SESSION_EXPIRED, RATE_LIMITED, CONTENT_REJECTED, TIMEOUT, UPSTREAM_ERROR) với thông tin retryable cụ thể thay vì lỗi chung chung.

## Acceptance Criteria

### RPC Dispatch & Contract
- [ ] Module GoogleFlowRpcClient được khởi tạo thành công và kết nối an toàn với context phiên https://flow.google.com trong Electron.
- [ ] Tạo đúng payload RPC cho tạo ảnh (Imagen/Nano) và tạo video (Veo) phù hợp với giao thức web của Flow.
- [ ] Luồng upload asset trả về định danh asset hợp lệ để gắn vào payload generation.

### Lifecycle & Reliability
- [ ] Vòng đời Polling theo dõi trạng thái tác vụ qua các pha và dừng chính xác khi có kết quả hoặc khi gặp lỗi terminal.
- [ ] Cơ chế xử lý lỗi bóc tách được các mã trạng thái quan trọng (SESSION_EXPIRED, RATE_LIMITED, CONTENT_POLICY_VIOLATION) kèm chỉ thị retry.

### Verification
- [ ] Có kịch bản kiểm thử tự động (test script chạy qua Electron/Node runner) thực thi kiểm tra tính hợp lệ của RPC client, payload contracts và state machine chuyển trạng thái thành công.
## 2026-09-24T08:07:11Z

This is a single self-contained feature; keep it small and focused.

Đấu nối module GoogleFlowRpcClient vào phân hệ AI Studio (AiStudioVisualService.ts và AiStudioPipelineEngine.ts) để trực tiếp sinh ảnh (Imagen/Nano) và sinh video (Veo) cho từng phân cảnh bằng Pure Web RPC thay thế cho cơ chế click DOM giả lập và synthetic fallback.

Working directory: d:/DEAN/DEAN/VANHSUB
Integrity mode: development

## Requirements

### R1. Tích hợp GoogleFlowRpcClient vào AiStudioVisualService
Trong main/ai-studio/services/AiStudioVisualService.ts, thay thế lệnh gọi generateImageViaBrowserContext bằng getGoogleFlowRpcClient(). Hỗ trợ cả sinh ảnh (generateImage - Imagen/Nano) và sinh video (generateVideo - Veo) tương ứng theo flowConfig.outputMode ('image' | 'video') và flowConfig.aspectRatio.

### R2. Tự động tải Asset kết quả về thư mục dự án cục bộ
Khi RPC Poller hoàn tất (completed), tự động tải tệp ảnh/video từ CDN về lưu đúng đường dẫn assetPath (scene_01.png hoặc scene_01.mp4) để các công đoạn tiếp theo (FFmpeg render) sử dụng. Kiểm tra tệp tải về tồn tại và kích thước > 0.

### R3. Quản lý trạng thái lỗi và tiến độ thời gian thực
- Lắng nghe onProgress từ RPC Poller để cập nhật tiến độ phần trăm thời gian thực lên callback onProgress của scene (queued -> processing -> completed).
- Bóc tách mã lỗi rõ ràng (SESSION_EXPIRED, RATE_LIMITED, CONTENT_POLICY_VIOLATION), chỉ fallback sang synthetic card khi có cấu hình explicit fallback, tránh âm thầm nuốt lỗi sinh ảnh/video thật.

## Acceptance Criteria

### [Integration & Execution]
- [ ] AiStudioVisualService.generateViaGoogleFlow gọi trực tiếp GoogleFlowRpcClient sinh ảnh hoặc video thành công.
- [ ] Tệp media được tải về đĩa cứng cục bộ với kích thước > 0 byte và đúng định dạng (.png hoặc .mp4).
- [ ] Giao diện tiến độ nhận được thông báo thời gian thực từ Polling State Machine.
- [ ] Có kịch bản kiểm thử tự động xác minh luồng tích hợp AiStudioVisualService với GoogleFlowRpcClient chạy thành công (exit code 0).
- [ ] npx tsc --noEmit hoàn toàn không có lỗi compilation.

## 2026-09-25T04:50:45Z

This is a single self-contained fix; keep it small and focused.

Chuẩn hóa toàn diện module Chrome Extension Bridge của VanhSub theo chuẩn mã nguồn mở `crisng95/flowkit` để giải quyết dứt điểm lỗi `PUBLIC_ERROR_UNUSUAL_ACTIVITY` (reCAPTCHA bot flag) khi gọi Web RPC lên Google Flow backend (`flow.google.com`).

Working directory: d:/DEAN/DEAN/VANHSUB
Integrity mode: development

## Requirements

### R1. Cập nhật cơ chế Minting reCAPTCHA Enterprise theo Invisible Widget (Chuẩn FlowKit)
- Thay thế hoàn toàn lệnh gọi trực tiếp `window.grecaptcha.enterprise.execute(siteKey, { action })` bằng quy trình 3 bước chuẩn của FlowKit:
  1. `resolveSitekey()`: Trích xuất sitekey động từ `window.___grecaptcha_cfg.clients` (fallback `6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV`).
  2. `ensureWidget(sitekey)`: Render invisible widget vào thẻ host `#flowkit-recaptcha-host` bằng `grecaptcha.enterprise.render(host, { sitekey, size: 'invisible' })`.
  3. `executeWithRetry(sitekey, action)`: Thực thi `grecaptcha.enterprise.execute(widgetId, { action })` với `widgetId` trả về từ render thay vì truyền `sitekey`.
- Đồng bộ hóa các lượt mint qua Promise queue (`captchaMintTail`) để ngăn xung đột race condition.

### R2. Đóng gói và Preload Bundle reCAPTCHA trong Extension
- Bổ sung `recaptcha_enterprise.js` và `recaptcha__en.js` (đã được tải sẵn tại d:/DEAN/DEAN/VANHSUB/extension/) vào khai báo `web_accessible_resources` của `manifest.json`. Nâng version extension lên 1.0.3.
- Trong `extension/content.js`, tự động chèn `recaptcha_enterprise.js` và `recaptcha__en.js` vào DOM để vượt qua chính sách CSP `require-trusted-types-for 'script'` của `flow.google.com` đúng như thiết kế của FlowKit.

### R3. Chuẩn hóa Batch RPC Fetch Headers & Body Envelope
- Trong `extension/background.js`, chuẩn hóa `runBatchRpc`:
  - Body đóng gói bằng `new URLSearchParams({ 'f.req': freqStr, at })` (loại bỏ dấu `&` thừa và lỗi encoding).
  - Headers tối giản và chuẩn xác: `'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'`, `'x-same-domain': '1'`. Loại bỏ các header giả lập bị Google WAF flag.

## Acceptance Criteria

### [FlowKit Compliance & Verification]
- [ ] `extension/injected.js` áp dụng đúng 100% hàm `ensureWidget` và `executeWithRetry` dùng `widgetId`.
- [ ] `extension/manifest.json` và `extension/content.js` nạp đầy đủ bundle `recaptcha_enterprise.js` và `recaptcha__en.js`.
- [ ] Kịch bản test kiểm thử token minting và batch RPC chạy pass 100%.
- [ ] Build lại ứng dụng VanhSub thành công (`node node_modules/nextron/bin/webpack.config.cjs`).
