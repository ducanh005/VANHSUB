# Roadmap dự án: VANHSUB — app phụ đề & lồng tiếng tiếng Việt

> File này dùng để theo dõi tiến độ. Mỗi khi làm xong 1 việc, tick checkbox +
> ghi 1 dòng ở mục "Nhật ký tiến độ" cuối file. Khi cần AI hỗ trợ tiếp,
> upload file này để AI nắm ngữ cảnh ngay, không cần giải thích lại từ đầu.

## Bối cảnh dự án

- Mục tiêu: app desktop (Windows) chuyển giọng nói → phụ đề → dịch → lồng tiếng,
  tối ưu cho tiếng Việt, dùng làm đồ án/đề án tốt nghiệp.
- Xây từ đầu (không fork), có tham khảo luồng nghiệp vụ từ project mã nguồn mở
  [SmartSub](https://github.com/buxuku/SmartSub) (MIT License) — không copy code,
  tự triển khai độc lập. Ghi rõ điều này trong báo cáo/README.
- Stack: Electron + Next.js (nextron) + TypeScript + Tailwind + shadcn/ui (Radix).

## Quyết định kỹ thuật đã chốt

- [x] Dịch thuật: chỉ dùng **Gemini API** (qua SDK `openai`, endpoint tương thích OpenAI)
- [x] ASR: **whisper.cpp** qua package `nodejs-whisper`, ưu tiên model **PhoWhisper** (VinAI) cho tiếng Việt
- [x] TTS: tích hợp **VietTTS** (endpoint tương thích OpenAI)
- [x] Giao diện: chỉ tiếng Việt, không cần đa ngôn ngữ — tự viết helper `t()` đơn giản, không dùng next-i18next
- [x] Không dùng `"type": "module"` trong package.json — giữ CommonJS để tránh xung đột native addon (node-loader, whisper binding)
- [x] `"main"` trỏ đúng theo output thật của nextron (mặc định `app/background.js`)
- [x] Visual identity riêng: nền mực đậm `#0E1A1B`, accent đỏ sơn mài `#C1432E` + vàng đồng `#C9A227`,
      font Fraunces (tiêu đề) + IBM Plex Sans (UI) + IBM Plex Mono (timecode) — không dùng theme navy/đen của SmartSub
- [ ] Ghi chú báo cáo đồ án: trích dẫn tham khảo SmartSub (MIT), nêu rõ phần tự triển khai

## Tính năng tham khảo từ SmartSub (để đối chiếu khi thiết kế, KHÔNG copy code)

<details>
<summary>Danh sách đầy đủ (bấm để xem)</summary>

**ASR:** whisper.cpp, faster-whisper, FunASR, Qwen3-ASR, FireRedASR, Parakeet (sherpa-onnx),
3 dịch vụ ASR cloud, tự tải/quản lý model, chunking audio dài, auto-detect ngôn ngữ,
speaker diarization (tách người nói).

**Dịch thuật:** 20 provider, glossary (từ điển thuật ngữ), ngôn ngữ tùy chỉnh, fallback/retry.

**Hiệu đính:** sửa từng câu + AI đánh bóng, đối chiếu bản thảo gốc (manuscript matching),
gắn nhãn người nói.

**TTS/Dubbing:** Kokoro, VITS, Edge TTS, Azure, ElevenLabs, Volcano; voice cloning qua ZipVoice;
canh timing audio-video, xử lý khoảng lặng dài.

**Video/File:** tải video từ link (batch), ghép nhiều file phụ đề, burn hardsub, mux audio,
nhiều định dạng phụ đề (srt/ass/vtt), phát hiện phụ đề nhúng sẵn.

**Hạ tầng:** tăng tốc CUDA/Vulkan, quản lý addon native theo OS/kiến trúc, quản lý version model.

**Quản lý hệ thống:** task queue + log, export/import config, migration config cũ,
Command Palette (Ctrl+K), phím tắt, onboarding, FAQ.

**UI:** dark/light theme, đa ngôn ngữ (zh/en), Activity Center, update checker.

</details>

---

## NHÓM 1 — LÕI (ưu tiên cao nhất, làm trước)

### 1.1 Khởi tạo project

- [x] `npx create-nextron-app` + cấu hình TypeScript
- [x] Dọn package.json theo bản đã chuẩn hoá (bỏ `type: module`, sửa `main`)
- [x] Setup git repo riêng (không fork), commit đầu tiên
- [x] Đưa `ROADMAP.md` này vào gốc repo, commit luôn
- **Commit:** `chore: khoi tao project voi nextron`

### 1.2 UI khung + quản lý task

- [x] Áp dụng mockup trang chủ đã thiết kế (theme Gemini-inspired: Cyan/Indigo/Rose, Glassmorphism, bo góc mềm)
- [x] Data model `Task` riêng (types/task.ts) — tự thiết kế field, không copy struct SmartSub
- [x] Store lưu task (electron-store)
- [x] Sidebar điều hướng: Trang chủ, Tải video, Phụ đề, Hiệu đính, Dịch thuật, Lồng tiếng, Xuất video, Cài đặt
- [x] Kéo thả video vào app (drag & drop)
- **Commit:** `feat: xay dung UI trang chu va quan ly task`

### 1.3 ASR cơ bản

- [x] Tích hợp `nodejs-whisper`
- [x] Tải & quản lý model (base/small — auto-download khi chạy lần đầu)
- [x] Convert kết quả ASR → file `.srt`
- [x] Kích hoạt ASR từ giao diện: nút "Bắt đầu phiên âm" → TaskRunner → ffmpeg extract WAV → Whisper → .srt
- [x] UI chọn model + thanh tiến trình transcribe (đã có ở Settings & Task status progress)
- **Commit:** `feat(asr): ket noi task manager voi whisper ASR qua TaskRunner`

### 1.4 Editor hiệu đính phụ đề

- [x] Parser/serializer file `.srt` tự viết (`renderer/lib/srt.ts`)
- [x] Timeline chỉnh thời gian từng dòng (timeline strip bấm để nhảy + nút ±0.1s/±1s + gán thời điểm theo video)
- [x] Preview video đồng bộ phụ đề (protocol `vanhmedia://` stream local + overlay phụ đề theo thời gian phát)
- [x] Sửa text trực tiếp trên từng dòng
- [x] thêm mục "Sửa câu bằng AI" — gọi Gemini để đánh bóng/sửa lỗi ngữ pháp câu đã dịch, riêng biệt với sửa tay
- **Commit:** `feat: them man hinh hieu dinh phu de voi timeline`

> ✅ Mốc kiểm tra: sau Nhóm 1, app phải chạy được luồng **video → transcribe → xem/sửa phụ đề**,
> đủ để demo tiến độ giữa kỳ.

---

## NHÓM 2 — HOÀN CHỈNH (biến thành sản phẩm dùng được)

### 2.1 Dịch thuật (Gemini)

- [x] Gọi Gemini API qua SDK `openai` (baseURL trỏ Gemini endpoint)
- [x] Prompt template dịch phụ đề (tự thiết kế, giữ context giữa các câu)
- [x] UI nhập/lưu API key (lưu an toàn vào electron-store)
- [x] Chọn ngôn ngữ đích, xử lý lỗi timeout/rate limit
- **Commit:** `feat(translate): tich hop Gemini API`

### 2.2 Xuất video

- [x] Wrapper gọi ffmpeg (`fluent-ffmpeg` + `@ffmpeg-installer/ffmpeg`)
- [x] Burn hardsub (ghi cứng phụ đề vào khung hình, xử lý unicode/path temp Windows)
- [x] Xuất file kèm phụ đề rời (soft-sub) làm phương án thay thế
- **Commit:** `feat(render): xuat video voi phu de`

### 2.3 Settings

- [x] Trang cài đặt chung (đường dẫn lưu file, số luồng xử lý...)
- [x] Quản lý model đã tải (xem dung lượng, xoá bớt)
- [x] Quản lý API key các dịch vụ
- **Commit:** `feat: them trang cai dat`

> ✅ Mốc kiểm tra: sau Nhóm 2, luồng đầy đủ **video → phụ đề → dịch → xuất video có hardsub** đã chạy được —
> đây là bản MVP hoàn chỉnh, đủ nộp báo cáo tiến độ chính.

---

## NHÓM 3 — NÂNG CAO (đúng định hướng "sản phẩm Việt")

### 3.1 TTS / Lồng tiếng

- [x] Setup server VietTTS (Docker) chạy local
- [x] Gọi VietTTS qua endpoint tương thích OpenAI (dùng lại SDK `openai`, đổi baseURL)
- [x] UI chọn giọng đọc, preview trước khi render
- [x] làm rõ TTS chọn giọng theo từng dòng phụ đề, không phải 1 giọng chung cho cả file
- **Commit:** `feat(tts): tich hop VietTTS`

### 3.2 Đồng bộ audio-video (dubbing)

- [x] Canh timing audio TTS khớp với timeline phụ đề gốc
- [x] Xử lý trường hợp khoảng lặng dài / câu quá dài so với thời lượng gốc (time-stretch nhẹ hoặc cắt bớt)
- [x] Mux track audio lồng tiếng vào video (thay hoặc chèn thêm track)
- **Commit:** `feat(dubbing): dong bo va ghep audio long tieng vao video`

### 3.3 i18n tiếng Việt

- [ ] Chuẩn hoá toàn bộ text hiển thị qua helper `t()` tự viết
- [ ] File `locales/vi.json` duy nhất
- **Commit:** `feat(i18n): chuan hoa text qua helper t()`

### 3.4 Whisper model hỗ trợ đa ngôn ngữ

- [x] Dùng Whisper base model (140 MB) - hỗ trợ 99 ngôn ngữ + tiếng Việt
- [x] Không cần convert, nodejs-whisper đã hỗ trợ sẵn định dạng ggml của Whisper
- [x] Tối ưu cho app desktop: CPU-friendly, offline, tốc độ nhanh
- [x] App UI tự động detect model từ thư mục models/ và cho user chọn
- **Lựa chọn:** Whisper base (140 MB, general purpose, đa ngôn ngữ) thay vì PhoWhisper (tiếng Việt only)
- **Commit:** `refactor(asr): dung Whisper base model cho da ngon ngu thay vi PhoWhisper`

### 3.5 Model selection với phát hiện thông số máy

- [x] Detect system info: RAM tổng/còn trống, CPU cores, model CPU, OS
- [x] Recommend model auto dựa trên resource: tiny (<1.5GB RAM), base (2-4GB), small (4-8GB), medium/large (8GB+)
- [x] Component `ASRModelSelector` hiển thị system info, recommend model, model details (size, accuracy, tốc độ, RAM yêu cầu)
- [x] Validation warnings nếu resource không đủ (e.g., "RAM tự do < yêu cầu")
- [x] IPC handler `system:info` lấy realtime system stats
- [x] Settings UI tích hợp model selector trước grid settings chính
- **Mục tiêu:** User chọn model phù hợp với máy mà không cần tìm hiểu kỹ thuật
- **Commit:** `feat(asr): add model selector with machine spec detection`

---

## NHÓM 4 — TÙY CHỌN (làm nếu còn thời gian, không bắt buộc)

- [ ] **Glossary** — từ điển thuật ngữ riêng, đảm bảo dịch nhất quán tên riêng/thuật ngữ chuyên ngành
- [ ] **Subtitle merge** — ghép nhiều file phụ đề lại với nhau
- [ ] **Speaker diarization** — tách nhiều giọng nói trong 1 video (phức tạp, cân nhắc kỹ trước khi làm)
- [ ] **Tăng tốc phần cứng** — detect GPU, dùng CUDA (NVIDIA) hoặc Vulkan nếu máy hỗ trợ
- [ ] **Tải video từ link** — hỗ trợ tải hàng loạt từ URL thay vì chỉ file local
- [ ] **Command Palette (Ctrl+K)** — điều hướng nhanh bằng bàn phím

> ⚠️ Không để Nhóm 4 chặn tiến độ Nhóm 1-3. Nếu deadline gấp, bỏ qua toàn bộ nhóm này vẫn có sản phẩm hoàn chỉnh.

---

## NHÓM 5 — ĐÓNG GÓI & NỘP ĐỒ ÁN

- [x] Cấu hình `electron-builder.yml`: appId, productName, icon riêng của VANHSUB
- [x] Build thử installer Windows (`yarn build` / `npm run build`), đã kiểm tra đóng gói tạo file `dist/VANHSUB Setup 1.0.0.exe` thành công.
- [ ] Viết README hoàn chỉnh: hướng dẫn cài đặt, screenshot, mục "Nguồn tham khảo" ghi rõ SmartSub (MIT)
- [ ] Viết phần báo cáo: kiến trúc hệ thống, sơ đồ luồng xử lý, phần tự đóng góp cụ thể
- **Commit:** `chore: cau hinh dong goi va hoan thien tai lieu`

---

## Vấn đề / lỗi đang gặp (cập nhật khi cần hỏi AI)

## <!-- Ghi lỗi cụ thể, log, hoặc câu hỏi đang vướng ở đây trước khi hỏi AI -->

## Nhật ký tiến độ

<!-- Mỗi lần làm xong 1 việc, thêm 1 dòng. Format: ngày - việc đã làm - vướng mắc (nếu có) -->

- 2026-08-27: Cập nhật roadmap chi tiết theo 5 nhóm ưu tiên, đã có mockup trang chủ.
- 2026-08-27: Hoàn thành Bước 1 — Thiết lập Data Model Task, hệ thống lưu trữ electron-store, IPC bridge và kết nối tương tác kéo thả / chọn file thật trên trang chủ.
- 2026-08-27: Hoàn thành Bước 2 — Kết nối ASR thật: `audioExtractor.ts` (ffmpeg → WAV 16kHz), `taskRunner.ts` (pipeline tự động), nút "Bắt đầu phiên âm" trên giao diện kích hoạt Whisper và cập nhật tiến trình realtime.
- 2026-08-29: Hoàn thành mục 1.4 — Editor hiệu đính phụ đề: tách parser/serializer SRT ra `renderer/lib/srt.ts`; component `SubtitleEditor` với preview video đồng bộ (protocol `vanhmedia://` tự stream local có hỗ trợ Range, dùng `<video>` native thay react-player vì Electron không cần wrapper), timeline strip bấm để nhảy câu, chỉnh thời gian từng dòng (±0.1s/±1s, gán theo thời điểm video), sửa text trực tiếp, thêm/xoá dòng; "Sửa câu bằng AI" gọi Gemini qua SDK `openai` (endpoint tương thích OpenAI) với API key lưu qua `settingsStore` (electron-store), nhập key ngay trong màn hình hiệu đính.
- 2026-08-31: Kiểm tra & cập nhật roadmap. Hoàn thành toàn bộ Nhóm 2 (Dịch thuật Gemini API, Xuất video Hardsub & Softsub qua ffmpeg, Trang Cài đặt & Quản lý model Whisper offline). Kiểm tra build thành công bộ cài Windows Installer (`dist/VANHSUB Setup 1.0.0.exe`).
- 2026-09-01: Hoàn thành Nhóm 3.1 — Tích hợp TTS/Lồng tiếng VietTTS: cập nhật SettingsStore thêm vietTtsEndpoint, ttsVoice, ttsSpeed; tạo `main/render/ttsEngine.ts` (generate audio từ SRT qua OpenAI SDK với baseURL VietTTS), tạo `main/render/ttsRunner.ts` (TaskRunner pattern), cập nhật Task type, tạo UI `renderer/components/TTSPage.tsx`, thêm IPC handlers (tts:start, tts:voices, tts:check-connection), tích hợp vào navigation sidebar.
- 2026-09-01: Hoàn thành Nhóm 3.2 — Dubbing (Audio-Video Sync): `main/render/dubbingEngine.ts` ghép audio files từ TTS theo SRT timing qua ffmpeg concat demuxer, mux vào video (replace hoặc add track), `main/render/dubbingRunner.ts` với TaskRunner pattern, IPC handler dubbing:start.
- 2026-09-01: Hoàn thành Nhóm 3.3 — i18n tiếng Việt: tạo `renderer/locales/vi.json` (toàn bộ strings UI), `renderer/lib/i18n.ts` (helper t() đơn giản với dot notation + formatTimeAgo, formatFileSize, formatTime), cập nhật home.tsx sử dụng t() + getNavItems, getWorkflows, getTools, getShortcuts functions.
- 2026-09-01: Hoàn thành Nhóm 3.4 — Quyết định dùng Whisper base model (99 ngôn ngữ + tiếng Việt) thay vì PhoWhisper (tiếng Việt only), vì hướng tới support video nước ngoài. Whisper base đã tích hợp sẵn trong nodejs-whisper (ggml format), không cần convert thêm. App tự động detect model từ thư mục models/ và cho user chọn ở Settings.
- 2026-09-01: Hoàn thành Nhóm 3.5 — Model selection với phát hiện thông số máy: tạo `renderer/lib/modelSelector.ts` (WHISPER_MODELS metadata, recommendModel algo, canRunModel validation), thêm IPC handler `system:info` (return RAM/CPU/OS info via systeminformation), tạo component `renderer/components/ASRModelSelector.tsx` (hiển thị system specs, auto-recommend model, model details, warnings nếu resource không đủ), tích hợp vào SettingsPage.
- 2026-09-04: Kiểm toán toàn bộ workflow theo kịch bản "video nước ngoài → bóc băng → dịch → hiệu đính → lồng tiếng → xuất video". Sửa 2 lỗi lớn: (1) màn hiệu đính trước đây chỉ đọc/ghi SRT gốc, giờ cho chọn sửa bản dịch (mặc định ưu tiên `translatedSrtPath`); (2) kéo-thả file hỏng trên Electron >=32 do `File.path` bị bỏ — thay bằng `webUtils.getPathForFile` qua preload. Prompt "Sửa câu bằng AI" chuyển sang trung lập ngôn ngữ (giữ nguyên ngôn ngữ của câu gốc).
- 2026-09-04: Hoàn thành tính năng che vùng phụ đề cũ khi xuất Hardsub (video có sub in sẵn): `MaskRegion` (vị trí đáy/đầu, cao 5-50% khung hình, tô đen hoặc làm mờ) áp bằng filter ffmpeg TRƯỚC filter subtitles nên sub mới không đè chữ cũ. Lưu ý kỹ thuật: filter `overlay` của ffmpeg không có biến `ih` — phải dùng `main_h`. Đã test 3 chế độ bằng ffmpeg bundled, kiểm tra frame đầu ra.
- 2026-09-04: Hoàn thành TTS gán giọng riêng theo từng dòng phụ đề: task lưu `ttsVoiceOverrides` (số dòng → tên giọng), engine đọc map khi tạo audio (dòng không gán dùng giọng chung), UI TTSPage thêm bảng gán giọng theo câu với nghe thử từng dòng, gán giọng được khôi phục khi mở lại.
- 2026-09-04: Thêm nhập file SRT có sẵn cho task (video đã có phụ đề, bỏ qua phiên âm): IPC `tasks:importSrt` copy SRT vào thư mục video rồi gán `task.srtPath`, nút "Nhập SRT" trên thẻ task ở Trang chủ.
- 2026-09-04: Dọn text sót "PhoWhisper" ở UI (workflow cards, widget AI Engine) — hiển thị model ASR thật người dùng chọn trong Cài đặt; bổ sung TTS preview (nghe thử giọng) và viết lại dubbing engine ghép audio theo segment timeline chuẩn xác (pad/cắt từng dòng, lấp im lặng khi thiếu file).
- 2026-09-06: Hoàn thành tính năng Quét phụ đề cứng bằng OCR (video hardsub → file .srt, thay thế phiên âm): thêm `tesseract.js` (external trong nextron.config.js + asarUnpack cho electron-builder); tạo `main/ocr/` gồm `frameExtractor.ts` (ffmpeg lấy mẫu thưa theo fps, crop vùng đáy khung, scale-up video hẹp, chuyển xám), `ocrEngine.ts` (pool worker Tesseract chạy song song, nạp ngôn ngữ 1 lần, cache tessdata trong userData), `subtitleBuilder.ts` (gộp khung trùng nội dung thành dòng phụ đề, vá khung đọc hụt, lọc theo confidence), `ocrRunner.ts` (TaskRunner pattern, status `ocr` mới, huỷ hợp tác, ghi `<video>_ocr.srt`, tự dịch sau quét nếu bật autoTranslateAfterAsr). IPC `ocr:start`/`ocr:cancel`, preload `vanhsub.ocr`, settings `ocrLanguage`/`ocrFps`/`ocrRegion` + khối cài đặt OCR ở SettingsPage, nút "Quét OCR" + "Huỷ quét" trong tab Phụ đề & ASR. Test end-to-end qua `scripts/test-ocr.ts` (video 2 câu → đúng 2 dòng SRT, timestamp chuẩn) và smoke-test nextron dev (main bundle + renderer + IPC boot OK). Lưu ý: lần quét đầu cần internet tải gói ngôn ngữ tessdata (~15MB) rồi lưu offline.
- 2026-09-06: Triển khai 7 mục ưu tiên từ audit: (1) `TaskStore.resetStaleRunning()` gỡ kẹt task dính trạng thái running khi app boot sau crash — đã xác nhận hoạt động thật (log Boot gỡ 1 task kẹt); (2) checkpoint dịch thuật `*.checkpoint.json` ghi sau mỗi batch, chạy lại tự tiếp tục + chỉ dịch dòng text gốc chưa đổi, backoff riêng cho 429, xoá checkpoint khi xong; (3) whisperEngine chia chunk 10 phút (chồng lấp 2s, ngưỡng >15 phút) cho audio dài, progress theo chunk, `mergeChunkTranscripts` gộp + dedupe vùng chồng lấp 2×overlap, thêm huỷ phiên âm (tasks:cancel + nút Huỷ trong tab Phụ đề & ASR); (4) TTS cache manifest.json theo (voice,speed,text) — chạy lại chỉ tạo câu thiếu/đổi, retry 3 lần mỗi câu; (5) Glossary + Văn phong/xưng hô (settings `glossary`, `translationStyleGuide`) inject vào system prompt dịch + khối cài đặt mới; (6) bundle @ffprobe-installer/ffprobe (máy sạch không còn kẹt progress hardsub), log main process ghi ra userData/logs (giữ 14 ngày); (7) 3 chế độ đồng bộ dubbing: strict (nén audio), flexible (câu dài tràn khoảng lặng tối đa 3s, dịch lùi tự nhiên), video-stretch (giãn video ≤1.25x qua setpts) + tùy chọn mix nhạc nền gốc 22% dưới lời thoại. Test: `scripts/test-pipeline-fixes.ts` (13 asserts), `scripts/test-asr-chunked.ts` (audio 16 phút → 2 chunk, progress 50→100%, dọn tạm OK), test-ocr vẫn pass, tsc 0 lỗi.
- 2026-09-11: Hoàn thành Phase 1 — Canvas Khung sườn & Hệ thống Node Registry cho Workflow Mode (phong cách ComfyUI): tích hợp `@xyflow/react` v12 và `zustand` quản lý graph state; xây dựng Node Registry với đầy đủ 26 node types thuộc 7 nhóm (Input, Model, Control, Consistency, Editing, Output, Logic); tạo màu socket phân loại dữ liệu (image, video, text, audio, character_ref, scene_ref, any); generic category custom node renderer có viền trạng thái (idle, running, success, failed); Inspector panel tự động sinh form từ configSchema; Node Library kéo-thả tìm kiếm; presets mẫu (Google Veo cơ bản, Character Consistency & Last-frame Chaining); ước tính chi phí render sơ bộ; xuất/nhập đồ thị JSON; tích hợp tab Workflow AI vào sidebar chính của VANHSUB. Đã verify qua `tsc --noEmit` và `next build renderer` 0 lỗi.
- 2026-09-11: Hoàn thành Phase 2 — Execution Engine & Model Orchestration Layer (Google Flow / Veo Adapter): hiện thực hóa thuật toán Kahn sắp xếp tô-pô đồ thị DAG; phát hiện và chặn chu trình khép kín; phân giải dữ liệu giữa các cổng kết nối; điều khiển concurrency và tự động cô lập lỗi (fault isolation - đánh dấu blocked các node con phụ thuộc); tích hợp GoogleFlowAdapter hỗ trợ Google Veo qua Gemini API endpoint tương thích OpenAI (`/v1beta/openai/videos`), tự động trích xuất last-frame bằng ffmpeg phục vụ chaining; chế độ fallback giả lập an toàn khi chưa có API key; hiện thực hóa node `export-video` ghi ra ổ cứng và node `send-to-sub-mode` tự động đăng ký task vào TaskStore của Sub Mode; kết nối kênh IPC realtime `workflow:run` và `workflow:node-event` cập nhật viền và tiến trình cho từng node trên canvas. Test suite tự động `scripts/test-dag-engine.ts` pass 3/3 bài kiểm tra.

