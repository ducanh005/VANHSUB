# Báo Cáo Khảo Sát Đặc Tả Phân Hệ AI Video Studio (Vanhsub)
> **Tài liệu chuẩn hóa Feature Inventory, Schema TypeScript, State Machine Checkpoint và Chiến Lược Phục Hồi Lỗi.**  
> **Author**: Specification Miner Agent  
> **Target Path**: `d:\DEAN\DEAN\VANHSUB\.agents\spec_miner_survey\spec_inventory.md`  
> **Tham chiếu gốc**: `d:\DEAN\DEAN\VANHSUB\AI_STUDIO_SPEC.md` và `d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md` (Phiên bản `2026-09-17T06:24:37Z`).

---

## 1. TỔNG QUAN KIẾN TRÚC & PHẠM VI (ARCHITECTURAL SCOPE)

Phân hệ **AI Video Studio** mở rộng ứng dụng desktop Vanhsub (Electron + Next.js / Nextron + TailwindCSS) thành một hệ sinh thái sản xuất video khép kín từ ý tưởng thô đến video thành phẩm MP4 có lồng tiếng, phụ đề động, hiệu ứng chuyển động và nhạc nền.

### 1.1. Bốn Công Nghệ Lõi Tích Hợp
1. **LLM Engine (OpenAI SDK / DeepSeek / Custom BaseURL)**: Tiếp nhận chủ đề/tài liệu, phân tích ý tưởng, lập kịch bản 8-beat/70 câu, chấm điểm giữ chân người xem (Hook/Retention), và sinh prompt phân cảnh tiếng Anh.
2. **TTS & Alignment Engine (`msedge-tts` / `nodejs-whisper`)**: Tổng hợp giọng đọc tiếng Việt chất lượng cao (Hoài My, Nam Minh), khai thác luồng dữ liệu metadata word-boundary từ WebSocket để đồng bộ thời gian từng từ/câu.
3. **Google Flow Automation Engine (`main/workflow/flow-engine`)**: Kết nối điều phối task với Google Flow thông qua browser session/mutex sẵn có của Vanhsub, đồng thời tích hợp lớp fallback Mock Assets khi chưa đăng nhập hoặc gặp captcha.
4. **Video Assembly Engine (`fluent-ffmpeg`)**: Tự động ghép nối ảnh/video phân cảnh, áp dụng hiệu ứng Ken Burns (Zoom/Pan), trộn âm thanh lồng tiếng + BGM (tự động Audio Ducking), và render phụ đề động kiểu ASS (TikTok Bold, Karaoke Glow, Minimalist).

### 1.2. Nguyên Tắc Cách Ly Độc Lập
- **Store riêng biệt**: Toàn bộ cấu hình AI Studio nằm trong kho dữ liệu độc lập `aiStudioStore` (Main: `electron-store` với file `vanhsub-ai-studio.json`; Renderer: Zustand store `useAiStudioStore`), tuyệt đối không sửa đổi hay gây xung đột với `settingsStore` (`vanhsub-settings.json`) và `workflowStore`.
- **Độc lập với Workflow Canvas**: Tách rời hoàn toàn khỏi Canvas kéo thả node (`@xyflow/react`) trong giai đoạn này; thiết kế các stage dưới dạng modular execution handler để dễ dàng gói thành Node ở giai đoạn sau.

---

## 2. BẢNG DANH MỤC TÍNH NĂNG (FEATURES DISCOVERED)

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| **F01** | R1: Store | **Dedicated Main Store (`aiStudioStore`)** | Lưu trữ cấu hình độc lập trên đĩa qua `electron-store` với lazy singleton pattern và mã hoá an toàn qua `safeStorage`. | Khóa/Giá trị cấu hình `AiStudioConfig` | Dữ liệu cấu hình đã lưu | Fallback về giá trị mặc định nếu tệp cấu hình lỗi hoặc thiếu | `AI_STUDIO_SPEC.md` §5.1, `main/store/settingsStore.ts` |
| **F02** | R1: Store | **Zustand Renderer Store (`useAiStudioStore`)** | Quản lý state cấu hình và session hiện hành ở phía giao diện Next.js, đồng bộ 2 chiều với Main process qua IPC. | Action updates từ UI components | Reactive React state | Giữ trạng thái local gần nhất nếu IPC invoke thất bại | `AI_STUDIO_SPEC.md` §5.1, `renderer/lib/store/` |
| **F03** | R1: Store | **Cấu hình LLM Đa Nhà Cung Cấp** | Cho phép lựa chọn provider (DeepSeek, OpenAI, Custom), cấu hình apiKey, model, baseUrl, temperature (0.2-0.7), systemPromptPreset. | API Key, Provider, BaseURL, Model Name | `AiStudioConfig.llm` | Thông báo lỗi khi API Key trống hoặc model không tồn tại | `AI_STUDIO_SPEC.md` §5.1, `ORIGINAL_REQUEST.md` R1 |
| **F04** | R1: Store | **Cấu hình Giọng Đọc Edge TTS** | Lựa chọn giọng đọc (`vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`), tốc độ (`rate`), cao độ (`pitch`), âm lượng (`volume`), cờ `autoWordAlignment`. | Voice ID, rate/pitch strings, boolean flag | `AiStudioConfig.voice` | Fallback về giọng mặc định `vi-VN-HoaiMyNeural` nếu voiceId lạ | `AI_STUDIO_SPEC.md` §5.1, `EdgeTTSClient.ts` |
| **F05** | R1: Store | **Cấu hình Google Flow Engine** | Tùy biến tỷ lệ khung hình (16:9, 9:16, 1:1), chế độ sinh (ảnh/video), style prompt prefix, negative prompt, outputsPerScene, downloadDir, concurrency. | Tỷ lệ, mode, prompt templates, đường dẫn lưu | `AiStudioConfig.flowEngine` | Sử dụng thư mục tạm hệ thống nếu `downloadDir` không hợp lệ | `AI_STUDIO_SPEC.md` §5.1, `ORIGINAL_REQUEST.md` R1 |
| **F06** | R1: Store | **Cấu hình Dựng Phim FFmpeg** | Thiết lập độ phân giải (1080p, 720p, 4k), FPS (30/60), Ken Burns effect & scale, transition duration, nhạc nền mặc định, bgmVolume, autoAudioDucking. | Độ phân giải, FPS, cờ Ken Burns, âm lượng BGM | `AiStudioConfig.rendering` | Giới hạn ngưỡng âm lượng 0.0 - 1.0; fallback tắt transition nếu lỗi | `AI_STUDIO_SPEC.md` §5.1, `ORIGINAL_REQUEST.md` R1 |
| **F07** | R1: Store | **Cấu hình Kiểu Phụ Đề Động** | Thiết lập preset phụ đề (`tiktok_bold`, `minimalist`, `classic_bar`, `karaoke_glow`), fontSize, primaryColor, outlineColor, outlineWidth, positionY. | Preset style, màu hex, kích thước, vị trí Y% | `AiStudioConfig.subtitles` | Chuẩn hóa mã màu hex sang ASS format `&HAABBGGRR` an toàn | `AI_STUDIO_SPEC.md` §5.1, `assCompiler.ts` |
| **F08** | R1: Store | **Khôi phục Cấu hình Mặc định (Reset Defaults)** | Nút bấm và API hoàn trả cấu hình AI Studio về các giá trị chuẩn kỹ thuật ban đầu. | Trigger reset | Default `AiStudioConfig` | Ghi đè an toàn tệp cấu hình không làm mất session đang chạy | `AI_STUDIO_SPEC.md` §5.2 |
| **F09** | R2: Pipeline | **Stage 1: Phân Tích Dữ Kiện (Source/Idea)** | Phân tích đề tài/tài liệu nguồn của người dùng, xác định góc tiếp cận (Angle), điểm thắt nút (Hook) và thời lượng dự kiến. | `topic` / `sourceText`, options | `IdeaBlueprint` JSON | Báo lỗi nếu đề tài rỗng; fallback sang phân tích từ khóa cơ bản | `AI_STUDIO_SPEC.md` §3.2, `ORIGINAL_REQUEST.md` R2 |
| **F10** | R2: Pipeline | **Stage 2: Lập Kịch Bản Cấu Trúc (Script)** | Gọi LLM (DeepSeek / OpenAI) sinh kịch bản chia theo từng câu thoại/nhịp kèm ước tính thời lượng và tóm tắt phân cảnh. | `IdeaBlueprint`, LLM Config | `ScriptDocument` (mảng các `ScriptLine`) | Tự động sửa cú pháp JSON bị vỡ qua `jsonrepair`, retry nếu rate limit | `AI_STUDIO_SPEC.md` §3.2, `geminiClient.ts` |
| **F11** | R2: Pipeline | **Stage 3: Tổng Hợp Lồng Tiếng (Edge TTS)** | Dùng `msedge-tts` chuyển toàn bộ kịch bản thành tệp âm thanh tiếng Việt `voiceover.mp3` chuẩn Azure Neural. | `ScriptDocument`, Voice Config | `VoiceoverArtifact` (`voiceover.mp3`, duration) | Retry 2 lần khi ngắt kết nối WebSocket; fallback ngắt nhỏ từng câu | `AI_STUDIO_SPEC.md` §3.2, `EdgeTTSClient.ts` |
| **F12** | R2: Pipeline | **Stage 4: Trích Xuất Mốc Thời Gian (Alignment)** | Thu thập metadata `WordBoundary` từ Edge TTS hoặc dùng thuật toán nội suy thời lượng để xác định `startMs`/`endMs` cho từng câu/từ. | `ScriptDocument`, `VoiceoverArtifact` | `TimeAlignmentArtifact` (danh sách câu kèm mốc ms) | Tự động phân bổ đều theo số âm tiết nếu mất stream boundary | `AI_STUDIO_SPEC.md` §3.2, `MsEdgeTTS.d.ts` |
| **F13** | R2: Pipeline | **Stage 5: Sinh Visual Storyboard (Visual Prompts)** | Dùng LLM dịch ngữ cảnh từng câu thoại tiếng Việt sang Prompt tiếng Anh chuẩn điện ảnh, kết hợp với Style Prefix và Negative Prompt. | `ScriptDocument`, `TimeAlignmentArtifact`, Flow Config | `StoryboardArtifact` (mảng `SceneCard`) | Bổ sung fallback prompt mặc định nếu LLM không trả về prompt hợp lệ | `AI_STUDIO_SPEC.md` §3.2, `ORIGINAL_REQUEST.md` R2 |
| **F14** | R2: Pipeline | **Stage 6: Điều Phối Sinh Ảnh/Video Phân Cảnh** | Điều phối task tạo ảnh qua Google Flow Engine; hỗ trợ chế độ Live hoặc Fallback Mock Assets khi session chưa sẵn sàng. | `StoryboardArtifact`, Flow Engine Session | `VisualAssetsArtifact` (danh sách tệp media trên đĩa) | Dừng checkpoint an toàn nếu gặp captcha/hết credit; chuyển sang mock assets | `AI_STUDIO_SPEC.md` §3.2, §3.3, `flow-engine/` |
| **F15** | R2: Pipeline | **Stage 7: Dựng Phim & Render Hoàn Chỉnh (FFmpeg)** | Dùng `fluent-ffmpeg` kết hợp ảnh tĩnh/clip với hiệu ứng Ken Burns, ghép audio lồng tiếng, nhạc nền BGM (Audio Ducking) và phụ đề ASS. | `VisualAssetsArtifact`, `VoiceoverArtifact`, Rendering Config | `RenderOutputArtifact` (`final_video.mp4`) | Tự hạ cấp bỏ Ken Burns hoặc bỏ BGM nếu phát sinh lỗi codec ffmpeg | `AI_STUDIO_SPEC.md` §3.2, `videoProcessor.ts` |
| **F16** | R2: Pipeline | **Stage 8: Sinh Siêu Dữ Liệu SEO & Xuất Bản** | Gọi LLM sinh tiêu đề giật tít, mô tả video, bộ hashtag viral (#shorts, #trending) và prompt gợi ý ảnh thumbnail. | `ScriptDocument`, `IdeaBlueprint` | `SeoPublishingArtifact` JSON | Trả về template SEO mặc định dựa trên chủ đề nếu LLM timeout | `AI_STUDIO_SPEC.md` §3.2, `ORIGINAL_REQUEST.md` R2 |
| **F17** | R2: Pipeline | **Cơ Chế Checkpoint & State Machine** | Lưu trạng thái chi tiết sau mỗi stage vào disk/memory. Cho phép "Tiếp tục" (Resume) hoặc "Chạy lại" (Retry) từng bước mà không chạy lại từ đầu. | `sessionId`, `targetStage` | `PipelineSessionState` cập nhật | Bảo toàn 100% artifacts đã sinh của các công đoạn trước khi retry | `AI_STUDIO_SPEC.md` §3.3, `ORIGINAL_REQUEST.md` R2 |
| **F18** | R3: Auto-Pilot | **Giao Diện Tiếp Nhận Đề Tài (Idea Input Panel)** | Hộp nhập liệu chủ đề, dán tài liệu nguồn, chọn định dạng nhanh (YouTube 16:9, TikTok 9:16) và nút bấm lớn "Bắt đầu sản xuất". | User text input, tùy chọn nhanh | Kích hoạt Auto-Pilot Pipeline | Disable nút khi pipeline đang chạy hoặc đề tài trống | `AI_STUDIO_SPEC.md` §3.1, `ORIGINAL_REQUEST.md` R3 |
| **F19** | R3: Auto-Pilot | **Bảng Theo Dõi Tiến Độ 8 Bước Thời Gian Thực** | Status Tracker hiển thị từng bước 1-8 với nhãn trạng thái trực quan (`pending`, `running`, `success`, `error`), thanh progress và spinner. | Sự kiện IPC `aiStudio:pipeline:progress` | Hiển thị giao diện trạng thái động | Hiện badge đỏ kèm thông báo lỗi cụ thể và nút "Thử lại bước này" | `AI_STUDIO_SPEC.md` §3.2, `ORIGINAL_REQUEST.md` R3 |
| **F20** | R3: Auto-Pilot | **Trình Xem Trước Nhanh (Quick Preview Panel)** | Tích hợp Audio Player nghe thử `voiceover.mp3` và Video Player xem trước `final_video.mp4` ngay sau khi render xong. | File path từ kết quả pipeline | UI Audio / Video Controls | Ẩn trình phát khi chưa có file tương ứng hoặc file không tồn tại | `AI_STUDIO_SPEC.md` §3.1, `ORIGINAL_REQUEST.md` R3 |
| **F21** | R3: Auto-Pilot | **Nút Tải Về & Mở Thư Mục Chứa Video** | Cho phép người dùng lưu file video sang vị trí khác hoặc mở nhanh thư mục chứa tệp trong Windows Explorer qua Electron shell. | Đường dẫn video hoàn chỉnh | Mở Windows Explorer / hộp thoại lưu file | Thông báo lỗi nếu file thành phẩm đã bị xóa khỏi đĩa | `AI_STUDIO_SPEC.md` §3.1, `preload.ts` dialog |
| **F22** | R4: Custom Tab 1 | **Trình Biên Tập Kịch Bản Theo Dòng Thời Gian** | Danh sách các câu thoại kèm timeline `0:00`, `0:03`... Cho phép nhấp sửa trực tiếp nội dung văn bản từng câu (inline editing). | Chỉnh sửa văn bản câu thoại | Cập nhật `ScriptDocument` | Kiểm tra độ dài câu thoại để tránh tràn thời gian phân cảnh | `AI_STUDIO_SPEC.md` §4.2, `ORIGINAL_REQUEST.md` R4 |
| **F23** | R4: Custom Tab 1 | **Bộ Điều Khiển & Tạo Lại Giọng Từng Câu** | Cho phép nghe thử âm thanh của câu đang chọn, bấm nút "Tạo lại giọng câu này" (re-synthesize) hoặc tạo lại toàn bộ bài đọc. | Trigger tạo giọng, line index | Tệp âm thanh câu cập nhật | Nối mượt mà đoạn âm thanh mới vào timeline master audio | `AI_STUDIO_SPEC.md` §4.2, `ORIGINAL_REQUEST.md` R4 |
| **F24** | R4: Custom Tab 1 | **Nút "Trích Xuất Lại Time"** | Cập nhật lại alignment mốc thời gian sau khi người dùng sửa nội dung văn bản của một hoặc nhiều câu. | Nội dung câu đã sửa, audio | Mốc `startMs`/`endMs` cập nhật | Tự động tính toán lại tỷ lệ thời lượng tương ứng với độ dài từ mới | `AI_STUDIO_SPEC.md` §4.2, `ORIGINAL_REQUEST.md` R4 |
| **F25** | R4: Custom Tab 1 | **Tính Năng Chấm Điểm Kịch Bản (Script Audit)** | Nút "Chấm điểm kịch bản" gọi LLM phân tích tỷ lệ giữ chân (Hook 5 giây đầu, Retention loop, Call to Action) kèm góp ý sửa đổi. | Toàn bộ nội dung kịch bản | Điểm số (0-100), nhận xét chi tiết | Fallback trả về heuristic checklist nếu LLM gặp sự cố mạng | `AI_STUDIO_SPEC.md` §4.2, `ORIGINAL_REQUEST.md` R4 |
| **F26** | R4: Custom Tab 2 | **Danh Sách Card Phân Cảnh (Storyboard Cards)** | Hiển thị các card phân cảnh theo trình tự thời gian, hiển thị thời điểm bắt đầu - kết thúc và nội dung câu thoại tương ứng. | `StoryboardArtifact` | Giao diện Card trực quan | Cuộn mượt và highlight card tương ứng khi phát audio | `AI_STUDIO_SPEC.md` §4.2, `ORIGINAL_REQUEST.md` R4 |
| **F27** | R4: Custom Tab 2 | **Chỉnh Sửa Visual Prompt Tiếng Anh** | Ô soạn thảo textarea cho phép sửa trực tiếp câu prompt sinh ảnh của từng phân cảnh riêng biệt. | Prompt text từ người dùng | Cập nhật thuộc tính `visualPrompt` | Tự động loại bỏ ký tự điều khiển lạ trước khi gửi vào Flow | `AI_STUDIO_SPEC.md` §4.2, `ORIGINAL_REQUEST.md` R4 |
| **F28** | R4: Custom Tab 2 | **Nút "Sinh Lại Ảnh" (Per-Scene Regenerate)** | Cho phép kích hoạt riêng Google Flow Engine để sinh lại duy nhất phân cảnh được chỉ định mà không ảnh hưởng các cảnh khác. | Scene ID, Visual Prompt | Tệp ảnh/clip mới thay thế | Giữ lại ảnh cũ nếu lần sinh mới bị lỗi hoặc người dùng hủy | `AI_STUDIO_SPEC.md` §4.2, `ORIGINAL_REQUEST.md` R4 |
| **F29** | R4: Custom Tab 2 | **Nút "Tải Ảnh Thủ Công" (Upload Local Asset)** | Hộp thoại chọn tệp hình ảnh từ máy tính (PNG/JPG/WEBP) để thay thế visual của phân cảnh đó. | File path từ dialog người dùng | Sao chép asset vào project directory | Kiểm tra định dạng tệp hợp lệ trước khi gán vào storyboard | `AI_STUDIO_SPEC.md` §4.2, `preload.ts` dialog |
| **F30** | R4: Custom Tab 2 | **Chọn Loại Chuyển Động Phân Cảnh** | Cho phép chọn giữa `Ảnh tĩnh + Ken Burns (Zoom/Pan)` hoặc `Video chuyển động`, kèm hướng chuyển động (Zoom In/Out/Pan). | Lựa chọn hiệu ứng chuyển động | Cập nhật cấu hình phân cảnh | Validate tương thích với tham số của FFmpeg `zoompan` | `AI_STUDIO_SPEC.md` §4.2, `ORIGINAL_REQUEST.md` R4 |
| **F31** | R4: Custom Tab 3 | **Tùy Biến Giao Diện Phụ Đề Động** | Bộ điều khiển chọn preset (`tiktok_bold`, `karaoke_glow`, `minimalist`), font chữ, kích cỡ, màu chữ, màu viền, độ dày viền và vị trí dọc Y%. | Subtitle styling controls | Cập nhật cấu hình render phụ đề | Xem trước tức thì trên màn hình preview | `AI_STUDIO_SPEC.md` §4.2, `assCompiler.ts` |
| **F32** | R4: Custom Tab 3 | **Bộ Điều Khiển Chuyển Cảnh & Nhạc Nền (BGM)** | Nút bật/tắt Ken Burns, chọn file nhạc nền, thanh kéo âm lượng BGM (0.05-0.20) và công tắc "Tự động hạ nhạc nền khi có tiếng nói" (Audio Ducking). | BGM file path, volume slider, ducking switch | Cập nhật tham số render FFmpeg | Cảnh báo nếu file nhạc nền không đọc được hoặc sai định dạng | `AI_STUDIO_SPEC.md` §4.2, `videoProcessor.ts` |
| **F33** | R4: Custom Tab 3 | **Trình Phát Xem Trước Trực Tiếp (Live Studio Preview)** | Tích hợp `react-player` kết hợp lớp phụ đề mô phỏng hoặc `jassub` để người dùng xem trước phân cảnh, audio và sub trước khi xuất file. | Visual assets, Audio, Subtitle styles | Trình phát video live trực tiếp | Fallback hiển thị timeline audio + slide ảnh tĩnh nếu chưa render | `AI_STUDIO_SPEC.md` §4.2, `package.json` |
| **F34** | R4: Custom Tab 3 | **Nút "Xuất Video Hoàn Chỉnh" (Render Final Video)** | Kích hoạt công đoạn Render FFmpeg từ các tùy chỉnh hiện tại của người dùng trong cả 3 Tab, hiển thị thanh tiến độ render. | Cấu hình Custom Studio hiện hành | Tệp video `final_video.mp4` | Báo lỗi chi tiết từ FFmpeg stderr nếu xảy ra trục trặc | `AI_STUDIO_SPEC.md` §4.2, `videoRenderer.ts` |
| **F35** | R5: Điều Hướng | **Mục "AI Studio" Trên Thanh Sidebar** | Thêm mục điều hướng "AI Studio" (icon Sparkles/Bot, badge "MỚI") vào Sidebar chính của Vanhsub trong `home.tsx`. | Click sidebar item | Chuyển `activeTab` sang `ai-studio` | Đồng bộ với trạng thái thu gọn/mở rộng của Sidebar (`isSidebarCollapsed`) | `AI_STUDIO_SPEC.md` §2, `home.tsx` `getNavItems` |
| **F36** | R5: Điều Hướng | **Thanh Chuyển Đổi Phân Hệ Con (Sub-Header Tabs)** | Cho phép chuyển đổi qua lại mượt mà giữa: ⚡ "AI Tự Sản Xuất" (Auto-Pilot), 🎛️ "Tự Workflow" (Custom Studio) và ⚙️ "Cấu Hình AI Studio". | Tab click | Active Sub-View | Lưu giữ phiên làm việc và dữ liệu đã nhập khi chuyển đổi tab | `AI_STUDIO_SPEC.md` §2, `ORIGINAL_REQUEST.md` R5 |
| **F37** | R5: Điều Hướng | **Đồng Bộ Hệ Thống Giao Diện (Design System)** | Đảm bảo 100% giao diện mới tuân thủ giao diện tối (Dark mode), màu nhấn TailwindCSS (`brand-cyan`), Radix UI và Lucide icons. | CSS theme classes | Nhất quán thẩm mỹ UI | Không phá vỡ CSS và layout của các trang hiện hữu | `ORIGINAL_REQUEST.md` R5, `package.json` |
| **F38** | IPC Bridge | **Hệ Thống IPC Contract AI Studio** | Bộ kênh IPC 2 chiều (`aiStudio:*`) trong Main và Preload để thực thi cấu hình, điều khiển pipeline, và push tiến độ thời gian thực. | IPC payload dữ liệu | Dữ liệu trả về Promise / IPC event stream | Quản lý hủy bỏ listener an toàn khi component unmount | `main/preload.ts`, `main/main.ts` |

---

## 3. DANH SÁCH CÁC TRƯỜNG HỢP BIÊN (EDGE CASES)

| # | Feature | Input / Kịch Bản | Hành Vi Đặc Tả / Xử Lý Phòng Vệ |
|---|---------|-------------------|----------------------------------|
| **E01** | Stage 1 (Dữ kiện) | Người dùng nhập chuỗi rỗng hoặc toàn dấu cách (`"   "`) rồi bấm Bắt đầu. | Giao diện hiển thị cảnh báo đỏ `"Vui lòng nhập chủ đề hoặc dán dữ liệu nguồn"`, không kích hoạt pipeline. |
| **E02** | Stage 1 (Dữ kiện) | Người dùng nhập một liên kết URL bài viết hoặc tệp văn bản cực dài (> 20.000 từ). | Pipeline tự động trích xuất nội dung văn bản thuần, cắt gọt tóm tắt ngữ cảnh chính không vượt quá context window của LLM. |
| **E03** | Stage 2 (Kịch bản) | LLM trả về phản hồi chứa markdown code fences hoặc JSON bị cắt đứt giữa chừng do chạm giới hạn token. | Pipeline áp dụng bộ phân tích `jsonrepair` và regex bóc tách khối JSON. Nếu vẫn hỏng, kích hoạt retry với prompt thu gọn. |
| **E04** | Stage 2 (Kịch bản) | Chưa cấu hình LLM API Key hoặc Key sai (Lỗi HTTP 401 / 403). | Pipeline chuyển trạng thái Stage 2 sang `error`, hiển thị thông báo thân thiện và nút chuyển nhanh đến tab "Cấu hình AI Studio". |
| **E05** | Stage 3 (Lồng tiếng) | Kịch bản chứa các ký tự đặc biệt, emoji hoặc ngoại ngữ pha trộn (ví dụ: `AI Video Studio 🚀 cực đỉnh`). | `EdgeTTSClient` tự động làm sạch ký tự điều khiển lạ, giữ nguyên câu và tổng hợp mượt mà qua giọng Azure Neural. |
| **E06** | Stage 3 (Lồng tiếng) | Kết nối mạng bị gián đoạn giữa chừng khi đang tải stream âm thanh từ Microsoft Edge TTS. | Client bắt sự kiện timeout (sau 25 giây), tự động thử kết nối lại tối đa 2 lần trước khi báo lỗi và lưu checkpoint. |
| **E07** | Stage 4 (Alignment) | Edge TTS không trả về sự kiện `WordBoundary` (do mạng lag hoặc cấu hình không kích hoạt được). | Bộ trích xuất kích hoạt thuật toán fallback: Tính thời lượng tổng của file MP4/WAV, phân bổ mốc `startMs`/`endMs` theo số âm tiết của từng câu. |
| **E08** | Stage 5 (Storyboard) | Câu thoại kịch bản chỉ có 1-2 từ (ví dụ: `"Tuyệt vời!"`, `"Xem tiếp..."`). | Prompt Generator tự động bổ sung ngữ cảnh từ câu trước và sau để tạo ra Visual Prompt hoàn chỉnh mô tả không gian điện ảnh. |
| **E09** | Stage 6 (Google Flow) | Người dùng chưa đăng nhập tài khoản Google trên ứng dụng (Session unauthenticated / expired). | Hệ thống tạm dừng ở Stage 6, hiển thị hộp thoại: Người dùng có thể chọn **"Mở sảnh Google để đăng nhập"** hoặc **"Sử dụng Mock Assets để tiếp tục"**. |
| **E10** | Stage 6 (Google Flow) | Google Flow gặp Captcha hoặc hết credit giữa chừng khi đang sinh ảnh đến cảnh thứ 5/10. | Lưu lại toàn bộ 4 ảnh đã tải về thành công, đánh dấu Stage 6 tạm dừng tại cảnh thứ 5. Cho phép bấm **"Tiếp tục"** để chạy tiếp các cảnh còn lại sau khi giải captcha. |
| **E11** | Stage 6 (Google Flow) | Chế độ Fallback Mock Assets được kích hoạt. | Engine tự động tạo ra các tệp ảnh phân cảnh tỷ lệ chuẩn (16:9 hoặc 9:16) chứa nền gradient màu sắc cao cấp kèm tiêu đề phân cảnh và số thứ tự cảnh. |
| **E12** | Stage 7 (Render) | Không có tệp nhạc nền BGM hoặc tệp BGM bị xóa khỏi đĩa trước khi dựng. | FFmpeg bỏ qua đường dẫn BGM và thực hiện dựng video chỉ với giọng đọc `voiceover.mp3` mà không làm crash tiến trình render. |
| **E13** | Stage 7 (Render) | Kích thước ảnh của các phân cảnh tải lên thủ công không đồng đều (ví dụ cảnh thì 1920x1080, cảnh thì 800x600 hoặc 1080x1920). | Bộ lọc FFmpeg tự động scale và chèn viền đen (letterbox/pad) để đưa tất cả phân cảnh về kích thước chuẩn đã chọn (`1080p` hoặc `720p`) trước khi ghép. |
| **E14** | Stage 7 (Render) | Đường dẫn tệp chứa dấu cách, ký tự tiếng Việt có dấu hoặc ký tự đặc biệt trên Windows (ví dụ `D:\Dự Án Video\test.mp4`). | Module render tự động chuẩn hóa dấu gạch xuôi `/` và escape dấu hai chấm ổ đĩa `C\:/` theo hàm `escapeFfmpegSubtitlesPath`. |
| **E15** | Custom Studio (Tab 1) | Người dùng chỉnh sửa nội dung câu thoại trong kịch bản từ 5 từ thành 50 từ mà không tạo lại giọng đọc. | Giao diện hiển thị icon cảnh báo lệch thời gian (time desync) và khuyến nghị bấm nút "Tạo lại giọng câu này" hoặc "Trích xuất lại Time". |
| **E16** | Checkpoint Recovery | Ứng dụng Electron bị tắt đột ngột (crash hoặc người dùng bấm tắt app) khi đang ở Stage 6 hoặc 7. | Khi mở lại ứng dụng, session state được nạp lại từ disk (`aiStudioStore`), các stage đã hoàn thành được giữ nguyên với đầy đủ artifacts, cho phép bấm "Tiếp tục". |

---

## 4. CHI TIẾT ĐẶC TẢ SCHEMA TYPESCRIPT

### 4.1. Cấu Hình Riêng Biệt (`AiStudioConfig`)

```typescript
/**
 * aiStudioConfig: Toàn bộ cấu hình độc lập của phân hệ AI Studio
 * Lưu trữ độc lập tại vanhsub-ai-studio.json (không ảnh hưởng AppSettings của Vanhsub)
 */
export interface AiStudioLlmConfig {
  provider: 'deepseek' | 'openai' | 'custom';
  apiKey: string;
  model: string;              // vd: 'deepseek-chat', 'gpt-4o'
  baseUrl?: string;           // Hỗ trợ custom endpoint / proxy
  temperature: number;        // 0.2 (chính xác) - 0.7 (sáng tạo)
  systemPromptPreset: string; // 'youtube_story' | 'tiktok_short' | 'affiliate_sales'
}

export interface AiStudioVoiceConfig {
  provider: 'edge_tts' | 'local_onnx';
  voiceId: string;            // vd: 'vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural'
  rate: string;               // Tốc độ: '-10%', '+0%', '+15%'
  pitch: string;              // Cao độ: '+0Hz', '-2Hz'
  volume: string;             // '+0%'
  autoWordAlignment: boolean; // Tự động trích xuất timestamp từng từ
}

export interface AiStudioFlowEngineConfig {
  aspectRatio: '16:9' | '9:16' | '1:1';
  outputMode: 'image' | 'video';
  stylePromptPrefix: string;  // vd: "Cinematic lighting, high resolution, detailed photorealistic, 4k"
  negativePrompt: string;     // vd: "watermark, text, blurry, distortion, lowres"
  outputsPerScene: 1 | 2 | 4; // Số lượng biến thể sinh mỗi cảnh
  downloadDir: string;        // Thư mục lưu trữ assets sinh ra
  concurrency: number;        // Số task sinh song song (khuyến nghị: 1)
}

export interface AiStudioRenderingConfig {
  resolution: '1080p' | '720p' | '4k';
  fps: 30 | 60;
  kenBurnsEffect: boolean;    // Bật/tắt hiệu ứng chuyển động ảnh tĩnh
  kenBurnsScale: number;      // Tỷ lệ zoom (vd: 1.15)
  transitionDuration: number; // Thời gian chuyển cảnh (giây, vd: 0.5)
  defaultBgmPath?: string;    // Đường dẫn nhạc nền mặc định
  bgmVolume: number;          // 0.05 - 0.20 (âm lượng nhạc nền)
  autoAudioDucking: boolean;  // Tự động hạ âm lượng nhạc nền khi có tiếng nói
}

export interface AiStudioSubtitleConfig {
  enabled: boolean;
  preset: 'tiktok_bold' | 'minimalist' | 'classic_bar' | 'karaoke_glow';
  fontSize: number;
  primaryColor: string;       // Hex #RRGGBB
  outlineColor: string;       // Hex #RRGGBB
  outlineWidth: number;
  positionY: number;          // Vị trí theo % chiều cao màn hình (vd: 80%)
}

export interface AiStudioConfig {
  llm: AiStudioLlmConfig;
  voice: AiStudioVoiceConfig;
  flowEngine: AiStudioFlowEngineConfig;
  rendering: AiStudioRenderingConfig;
  subtitles: AiStudioSubtitleConfig;
}

export const DEFAULT_AI_STUDIO_CONFIG: AiStudioConfig = {
  llm: {
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    temperature: 0.6,
    systemPromptPreset: 'youtube_story',
  },
  voice: {
    provider: 'edge_tts',
    voiceId: 'vi-VN-HoaiMyNeural',
    rate: '+0%',
    pitch: '+0Hz',
    volume: '+0%',
    autoWordAlignment: true,
  },
  flowEngine: {
    aspectRatio: '16:9',
    outputMode: 'image',
    stylePromptPrefix: 'Cinematic lighting, high resolution, detailed photorealistic, 4k',
    negativePrompt: 'watermark, text, blurry, distortion, lowres',
    outputsPerScene: 1,
    downloadDir: '',
    concurrency: 1,
  },
  rendering: {
    resolution: '1080p',
    fps: 30,
    kenBurnsEffect: true,
    kenBurnsScale: 1.15,
    transitionDuration: 0.5,
    bgmVolume: 0.12,
    autoAudioDucking: true,
  },
  subtitles: {
    enabled: true,
    preset: 'tiktok_bold',
    fontSize: 24,
    primaryColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 3,
    positionY: 80,
  },
};
```

---

### 4.2. Schema Đầu Vào / Đầu Ra & Artifacts 8 Công Đoạn

```typescript
export type PipelineStageId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type StageStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

// -------------------------------------------------------------------------
// Stage 1: Dữ kiện (Source/Idea)
// -------------------------------------------------------------------------
export interface Stage1Input {
  topic: string;
  sourceText?: string;
  options?: {
    targetDurationSec?: number;
    targetAudience?: string;
    style?: string;
  };
}

export interface IdeaBlueprint {
  topic: string;
  coreHook: string;
  angle: string;
  estimatedDurationSec: number;
  outlinePoints: string[];
}

// -------------------------------------------------------------------------
// Stage 2: Kịch bản (Script)
// -------------------------------------------------------------------------
export interface ScriptLine {
  id: string;
  index: number;
  speaker?: string;
  text: string;               // Câu thoại tiếng Việt
  suggestedDurationSec?: number;
  sceneSummary?: string;
}

export interface ScriptDocument {
  title: string;
  blueprint: IdeaBlueprint;
  lines: ScriptLine[];
  totalLines: number;
  estimatedDurationSec: number;
}

// -------------------------------------------------------------------------
// Stage 3: Lồng tiếng (Voiceover)
// -------------------------------------------------------------------------
export interface LineAudioItem {
  lineIndex: number;
  lineId: string;
  audioPath: string;
  durationSec: number;
}

export interface VoiceoverArtifact {
  audioPath: string;          // Đường dẫn voiceover.mp3 tổng
  totalDurationSec: number;
  lineAudios?: LineAudioItem[];
}

// -------------------------------------------------------------------------
// Stage 4: Trích xuất Time (Time Alignment)
// -------------------------------------------------------------------------
export interface WordBoundary {
  word: string;
  startMs: number;
  endMs: number;
}

export interface AlignedLine {
  lineIndex: number;
  lineId: string;
  text: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  words?: WordBoundary[];
}

export interface TimeAlignmentArtifact {
  lines: AlignedLine[];
  totalDurationMs: number;
}

// -------------------------------------------------------------------------
// Stage 5: Phân cảnh Visual (Storyboard)
// -------------------------------------------------------------------------
export interface SceneCard {
  sceneId: string;
  lineIndex: number;
  startMs: number;
  endMs: number;
  text: string;               // Câu thoại tiếng Việt tương ứng
  visualPrompt: string;       // Prompt tiếng Anh cho Flow Engine
  negativePrompt?: string;
  type: 'image' | 'video';
  kenBurnsEffect?: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right';
  assetPath?: string;         // Đường dẫn ảnh/clip khi đã sinh hoặc upload
}

export interface StoryboardArtifact {
  scenes: SceneCard[];
  totalScenes: number;
}

// -------------------------------------------------------------------------
// Stage 6: Ảnh / Video Assets
// -------------------------------------------------------------------------
export interface SceneVisualAsset {
  sceneId: string;
  assetPath: string;
  assetType: 'image' | 'video';
  resolution: string;
  isFallback: boolean;        // true nếu dùng mock placeholder
}

export interface VisualAssetsArtifact {
  assets: SceneVisualAsset[];
  downloadDir: string;
}

// -------------------------------------------------------------------------
// Stage 7: Dựng phim (Video Assembly & Render)
// -------------------------------------------------------------------------
export interface RenderOutputArtifact {
  outputPath: string;         // Đường dẫn file final_video.mp4
  durationSec: number;
  resolution: string;
  fileSizeBytes: number;
  subtitlesPath?: string;
}

// -------------------------------------------------------------------------
// Stage 8: SEO & Xuất bản (Publishing Metadata)
// -------------------------------------------------------------------------
export interface SeoPublishingArtifact {
  title: string;
  description: string;
  hashtags: string[];
  tags: string[];
  thumbnailPrompt: string;
  thumbnailPath?: string;
}
```

---

### 4.3. Pipeline State & Checkpoint State Machine

```typescript
export type PipelineStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';

export interface StageExecutionRecord {
  stageId: PipelineStageId;
  name: string;
  status: StageStatus;
  progress: number;           // 0 - 100
  startedAt?: number;
  completedAt?: number;
  error?: string;
  artifact?: any;             // IdeaBlueprint | ScriptDocument | VoiceoverArtifact | ...
}

export interface PipelineSessionState {
  sessionId: string;
  topic: string;
  status: PipelineStatus;
  currentStage: PipelineStageId;
  stages: Record<PipelineStageId, StageExecutionRecord>;
  configSnapshot: AiStudioConfig;
  createdAt: number;
  updatedAt: number;
  errorSummary?: string;
}

export interface CheckpointSnapshot {
  sessionId: string;
  timestamp: number;
  completedStages: PipelineStageId[];
  artifacts: {
    blueprint?: IdeaBlueprint;
    script?: ScriptDocument;
    voiceover?: VoiceoverArtifact;
    alignment?: TimeAlignmentArtifact;
    storyboard?: StoryboardArtifact;
    visuals?: VisualAssetsArtifact;
    render?: RenderOutputArtifact;
    seo?: SeoPublishingArtifact;
  };
}
```

---

### 4.4. IPC Contracts (Main & Renderer Interface)

```typescript
/**
 * Định nghĩa kênh IPC giao tiếp giữa Renderer và Main process
 */
export interface AiStudioIpcChannels {
  // Cấu hình (Settings)
  'aiStudio:config:get': () => Promise<AiStudioConfig>;
  'aiStudio:config:set': (updates: Partial<AiStudioConfig>) => Promise<AiStudioConfig>;
  'aiStudio:config:reset': () => Promise<AiStudioConfig>;

  // Điều phối Pipeline (Auto-Pilot & Checkpoint)
  'aiStudio:pipeline:start': (input: { topic: string; sourceText?: string }) => Promise<PipelineSessionState>;
  'aiStudio:pipeline:pause': () => Promise<boolean>;
  'aiStudio:pipeline:resume': (fromStage?: PipelineStageId) => Promise<PipelineSessionState>;
  'aiStudio:pipeline:retryStage': (stageId: PipelineStageId) => Promise<PipelineSessionState>;
  'aiStudio:pipeline:cancel': () => Promise<boolean>;
  'aiStudio:pipeline:getState': () => Promise<PipelineSessionState | null>;

  // Can thiệp Custom Studio (Mode 2)
  'aiStudio:custom:saveScript': (script: ScriptDocument) => Promise<boolean>;
  'aiStudio:custom:scoreScript': (scriptText: string) => Promise<{ score: number; feedback: string[] }>;
  'aiStudio:custom:synthesizeLineVoice': (lineIndex: number, text: string) => Promise<LineAudioItem>;
  'aiStudio:custom:regenerateSceneVisual': (sceneId: string, prompt: string) => Promise<SceneVisualAsset>;
  'aiStudio:custom:replaceSceneAsset': (sceneId: string, filePath: string) => Promise<SceneVisualAsset>;
  'aiStudio:custom:renderVideo': (overrideConfig?: Partial<AiStudioRenderingConfig>) => Promise<RenderOutputArtifact>;
}

/**
 * Các sự kiện Main process gửi (push) xuống Renderer qua webContents.send
 */
export interface AiStudioPushEvents {
  'aiStudio:pipeline:progress': (event: {
    sessionId: string;
    stageId: PipelineStageId;
    status: StageStatus;
    progress: number;
    message?: string;
  }) => void;

  'aiStudio:pipeline:checkpoint': (snapshot: CheckpointSnapshot) => void;
}
```

---

## 5. ĐẶC TẢ CHI TIẾT CÁC MÀN HÌNH VÀ TABS GIAO DIỆN

### 5.1. App Navigation & Sub-Header Tabs (R5)
- **Sidebar Navigation**: Bổ sung `ai-studio` với nhãn `AI Studio` hoặc `Xưởng Video AI`, biểu tượng `Sparkles` hoặc `Bot`, huy hiệu `MỚI`.
- **Sub-Header Navigation Bar**: Đặt trên đầu trang `AiStudioPage.tsx`, cho phép chuyển đổi 3 góc nhìn:
  1. ⚡ **AI Tự Sản Xuất (Auto-Pilot)**: Phù hợp người dùng cần tạo video nhanh trong 1 lần bấm.
  2. 🎛️ **Người Dùng Tự Workflow (Custom Studio)**: Dành cho nhà sáng tạo can thiệp chi tiết 3 Tab.
  3. ⚙️ **Cấu Hình AI Studio (Dedicated Settings)**: Quản lý API Key, Giọng đọc, Flow engine và Tham số Render.

### 5.2. Chế Độ 1: Giao Diện AI Tự Sản Xuất (R3)
- **Khu vực nhập đề tài**:
  - Ô nhập liệu chính Textarea: "Nhập ý tưởng video hoặc dán văn bản bài viết..."
  - Thanh chọn định dạng nhanh (YouTube 16:9 / TikTok 9:16).
  - Nút bấm chính "Bắt đầu sản xuất" (Disabled khi đang chạy hoặc ô nhập rỗng).
- **Thanh Trạng Thái Tiến Độ (8-Step Tracker)**:
  - Bảng hiển thị ngang hoặc dọc chia 8 bước rõ ràng:
    1. Dữ kiện $\rightarrow$ 2. Kịch bản $\rightarrow$ 3. Lồng tiếng $\rightarrow$ 4. Trích xuất Time $\rightarrow$ 5. Storyboard $\rightarrow$ 6. Ảnh/Video $\rightarrow$ 7. Dựng phim $\rightarrow$ 8. SEO.
  - Mỗi bước có Icon trạng thái: Xám (`pending`), Xanh lá xoay tròn (`running`), Xanh lá tích (`success`), Đỏ dấu nhân (`error`).
  - Khi một bước gặp lỗi: Hiển thị thông báo nguyên nhân và nút "Thử lại bước này".
- **Khu Vực Xem Trước Nhanh (Quick Preview Panel)**:
  - Trình phát `Audio Player` nghe trước giọng đọc ngay sau Stage 3/4.
  - Trình phát `Video Player` xem video thành phẩm ngay sau Stage 7.
  - Các nút hành động: "Mở thư mục chứa file" và "Tải về máy".

### 5.3. Chế Độ 2: Giao Diện Custom Workflow Studio (R4)
Bao gồm 3 Tabs chuyên trách:

#### Tab 1: Kịch bản & Giọng Đọc (Script & Voiceover)
- **Bên trái / Khu vực chính (Timeline Script List)**:
  - Danh sách từng câu thoại được chia thành Card dòng thời gian (`0:00`, `0:03`...).
  - Nhấp chuột trực tiếp vào dòng chữ để sửa nội dung văn bản.
  - Nút loa nghe thử âm thanh câu riêng biệt.
  - Nút "Tạo lại giọng câu này" để tổng hợp lại âm thanh riêng cho câu vừa sửa.
- **Bên phải / Thanh công cụ (Voice & Audit Toolbar)**:
  - Trình phát Audio nghe toàn bộ bài đọc kèm thanh tua timeline.
  - Nút "Tạo lại toàn bộ bài đọc".
  - Nút "Trích xuất lại Time" (cập nhật lại căn chỉnh mốc thời gian sau khi người dùng sửa văn bản).
  - Nút "Chấm điểm kịch bản": Phân tích Hook 5 giây đầu, Retention loop và CTA, hiển thị điểm số cùng đề xuất hoàn thiện.

#### Tab 2: Phân Cảnh Trực Quan (Visual Storyboard)
- **Lưới Card Phân Cảnh (Storyboard Grid/List)**:
  - Mỗi card đại diện cho một phân cảnh theo dòng thời gian.
  - Hiển thị mốc thời gian: `0:00 - 0:04 (4.2s)` và câu thoại tiếng Việt liên kết.
  - Khung Textarea cho phép xem và chỉnh sửa Visual Prompt tiếng Anh.
  - Thumbnail hiển thị ảnh/video của cảnh.
  - Nút "Sinh lại ảnh" (kích hoạt Google Flow sinh lại riêng cảnh đó).
  - Nút "Tải ảnh thủ công" (mở file dialog chọn ảnh cá nhân từ máy).
  - Bộ chọn loại cảnh: `Ảnh tĩnh + Ken Burns` (chọn hướng Zoom In, Zoom Out, Pan) hoặc `Video chuyển động`.

#### Tab 3: Dựng Phim & Studio Editor
- **Bộ Điều Khiển Phụ Đề**:
  - Chọn preset phụ đề: `tiktok_bold`, `karaoke_glow`, `minimalist`, `classic_bar`.
  - Bộ chọn Font chữ, Slider kích thước chữ, Picker màu chữ chính và màu viền.
  - Slider vị trí dọc Y% (50% - 95%).
- **Bộ Điều Khiển Chuyển Động & Nhạc Nền (BGM)**:
  - Công tắc bật/tắt hiệu ứng Ken Burns, thanh chỉnh tỷ lệ zoom (1.05 - 1.30).
  - Nút chọn tệp nhạc nền BGM từ máy tính, thanh trượt âm lượng BGM (0% - 25%).
  - Công tắc "Tự động hạ nhạc nền khi có tiếng nói" (Auto Audio Ducking).
- **Trình Phát Xem Trước Trực Tiếp (Live Player)**:
  - Tích hợp phát video kết hợp overlay phụ đề theo thời gian thực để người dùng thẩm định trước khi render xuất xưởng.
- **Nút "Bắt Đầu Xuất Video" (Export Video)**:
  - Kích hoạt tiến trình render FFmpeg từ cấu hình hiện hành của 3 tab.
  - Hiển thị thanh tiến độ phần trăm và thời gian ước tính còn lại.

---

## 6. QUY TRÌNH PHÒNG VỆ & PHỤC HỒI LỖI (ERROR RECOVERY & FAIL-SAFE RULES)

### 6.1. Phòng Vệ Gián Đoạn Google Flow (Google Flow Interruption)
- **Vấn đề**: Google Flow yêu cầu đăng nhập tài khoản Google sảnh, có thể phát sinh Captcha, bị rate limit, hết Flow credits hoặc mất kết nối mạng.
- **Chiến lược xử lý**:
  1. **Pre-flight Check**: Trước khi bắt đầu Stage 6, kiểm tra session qua `GoogleVeoSessionManager.getStatus()`.
  2. **Khi gặp sự cố**: Chuyển trạng thái Stage 6 sang `paused` / `error`, lưu checkpoint an toàn. **Tuyệt đối không xóa hay chạy lại kịch bản (Stage 2) và audio (Stage 3)**.
  3. **Cơ chế Fallback Mock Assets**: Cung cấp nút chuyển đổi 1-click sang chế độ "Sinh Mock Assets". Tự động tạo ảnh canvas gradient chuẩn tỷ lệ (16:9 / 9:16) kèm nhãn cảnh và visual prompt để tiếp tục sang Stage 7 dựng phim demo mà không bị nghẽn toàn bộ luồng.
  4. **Resume thông minh**: Khi người dùng đã giải xong Captcha hoặc đăng nhập lại Google, bấm "Tiếp tục", hệ thống kiểm tra danh sách `scenes` trong `StoryboardArtifact`, chỉ kích hoạt sinh ảnh cho các cảnh chưa có tệp asset trên đĩa (`!fs.existsSync(assetPath)`).

### 6.2. Phòng Vệ Lỗi LLM (DeepSeek / OpenAI)
- **Vấn đề**: Lỗi quá tải (Rate limit HTTP 429), timeout mạng, hoặc trả về cú pháp JSON không hợp lệ.
- **Chiến lược xử lý**:
  1. Áp dụng Exponential Backoff với Jitter cho HTTP 429/503 (thử lại sau 1s, 2s, 4s).
  2. Bọc kết quả đầu ra qua thư viện `jsonrepair` để khắc phục lỗi JSON bị thiếu dấu đóng ngoặc hoặc phẩy thừa.
  3. Nếu chưa nhập API Key, hiển thị thông báo hướng dẫn rõ ràng kèm link chuyển sang tab Cài Đặt.

### 6.3. Phòng Vệ Lỗi Edge TTS
- **Vấn đề**: Kết nối WebSocket tới Microsoft Azure Speech bị ngắt giữa chừng hoặc timeout.
- **Chiến lược xử lý**:
  1. Giới hạn timeout 25 giây mỗi lượt gọi stream, tự động tái tạo kết nối tối đa 2 lần.
  2. Chuẩn hóa tốc độ (`rate`) và cao độ (`pitch`) trong khoảng an toàn (-50% đến +100%).
  3. Nếu luồng metadata word boundary bị thiếu, tự động kích hoạt tính toán mốc thời gian fallback theo tỷ lệ độ dài âm tiết của từng từ.

### 6.4. Phòng Vệ Lỗi Render FFmpeg
- **Vấn đề**: Lỗi filter Ken Burns do ảnh đầu vào có kích thước bất thường hoặc tệp BGM bị mất.
- **Chiến lược xử lý**:
  1. Luôn escape an toàn đường dẫn phụ đề trên Windows qua `escapeFfmpegSubtitlesPath`.
  2. Nếu filter `zoompan` gặp lỗi codec, tự động chuyển về filter `scale` và ghép crossfade tiêu chuẩn.
  3. Nếu tệp BGM không tồn tại, tự động loại bỏ input audio thứ hai và tiếp tục xuất video chỉ có voiceover.

---

## 7. TIÊU CHÍ NGHIỆM THU & PHƯƠNG PHÁP XÁC MINH (ACCEPTANCE CRITERIA)

### 7.1. Tiêu Chí Tự Động Hóa (Automated Verification)
- [x] **Type Check 100%**: Lệnh `npx tsc --noEmit` chạy thành công không có bất kỳ lỗi biên dịch nào liên quan đến các schema và module mới của AI Studio.
- [x] **Script Kiểm Thử Độc Lập**: Tồn tại script độc lập `scripts/test_ai_studio_pipeline.ts` có thể chạy ngoài Electron qua `npx tsx scripts/test_ai_studio_pipeline.ts`, xác minh thành công luồng:
  1. Khởi tạo và đọc/ghi cấu hình `aiStudioStore`.
  2. Sinh kịch bản cấu trúc mẫu (hoặc mock script).
  3. Tạo tệp âm thanh tiếng Việt thực tế qua `msedge-tts` (hoặc mock audio).
  4. Trích xuất mốc thời gian alignment cho từng câu thoại.
  5. Tạo visual storyboard scenes và dựng tệp MP4 demo hoàn chỉnh có lồng tiếng + phụ đề bằng FFmpeg.

### 7.2. Tiêu Chí Chức Năng (Functional Verification)
- [x] Giao diện AI Studio hiển thị trên Sidebar của Vanhsub, hỗ trợ chuyển đổi mượt mà giữa Auto-Pilot, Custom Studio và Settings.
- [x] Cấu hình AI Studio lưu trữ độc lập tại `vanhsub-ai-studio.json`, giữ nguyên toàn bộ giá trị sau khi tắt và khởi động lại ứng dụng.
- [x] Bảng theo dõi tiến độ Auto-Pilot cập nhật đúng 8 bước thời gian thực khi bấm "Bắt đầu sản xuất".
- [x] Custom Studio hỗ trợ chỉnh sửa trực tiếp câu thoại, thay đổi visual prompt và xuất video theo các tham số tùy biến.
- [x] Cơ chế Checkpoint cho phép tạm dừng và tiếp tục khi gặp sự cố mà không làm mất dữ liệu kịch bản và âm thanh đã sinh.
