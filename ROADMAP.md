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
- [ ] Tải & quản lý model (base/small trước, thêm PhoWhisper sau khi convert ggml xong)
- [x] Convert kết quả ASR → file `.srt`
- [ ] UI chọn model + thanh tiến trình transcribe
- **Commit:** `feat(asr): tich hop whisper qua nodejs-whisper`

### 1.4 Editor hiệu đính phụ đề

- [ ] Parser/serializer file `.srt` tự viết
- [ ] Timeline chỉnh thời gian từng dòng
- [ ] Preview video đồng bộ phụ đề (dùng `react-player`)
- [ ] Sửa text trực tiếp trên từng dòng
- [ ] thêm mục "Sửa câu bằng AI" — gọi Gemini để đánh bóng/sửa lỗi ngữ pháp câu đã dịch, riêng biệt với sửa tay
- **Commit:** `feat: them man hinh hieu dinh phu de voi timeline`

> ✅ Mốc kiểm tra: sau Nhóm 1, app phải chạy được luồng **video → transcribe → xem/sửa phụ đề**,
> đủ để demo tiến độ giữa kỳ.

---

## NHÓM 2 — HOÀN CHỈNH (biến thành sản phẩm dùng được)

### 2.1 Dịch thuật (Gemini)

- [ ] Gọi Gemini API qua SDK `openai` (baseURL trỏ Gemini endpoint)
- [ ] Prompt template dịch phụ đề (tự thiết kế, giữ context giữa các câu)
- [ ] UI nhập/lưu API key (mã hoá trước khi lưu vào electron-store)
- [ ] Chọn ngôn ngữ đích, xử lý lỗi timeout/rate limit
- **Commit:** `feat(translate): tich hop Gemini API`

### 2.2 Xuất video

- [ ] Wrapper gọi ffmpeg (`fluent-ffmpeg` + `@ffmpeg-installer/ffmpeg`)
- [ ] Burn hardsub (ghi cứng phụ đề vào khung hình, dùng `jassub` cho phụ đề .ass mượt)
- [ ] Xuất file kèm phụ đề rời (soft-sub) làm phương án thay thế
- **Commit:** `feat(render): xuat video voi phu de`

### 2.3 Settings

- [ ] Trang cài đặt chung (đường dẫn lưu file, số luồng xử lý...)
- [ ] Quản lý model đã tải (xem dung lượng, xoá bớt)
- [ ] Quản lý API key các dịch vụ
- **Commit:** `feat: them trang cai dat`

> ✅ Mốc kiểm tra: sau Nhóm 2, luồng đầy đủ **video → phụ đề → dịch → xuất video có hardsub** đã chạy được —
> đây là bản MVP hoàn chỉnh, đủ nộp báo cáo tiến độ chính.

---

## NHÓM 3 — NÂNG CAO (đúng định hướng "sản phẩm Việt")

### 3.1 TTS / Lồng tiếng

- [ ] Setup server VietTTS (Docker) chạy local
- [ ] Gọi VietTTS qua endpoint tương thích OpenAI (dùng lại SDK `openai`, đổi baseURL)
- [ ] UI chọn giọng đọc, preview trước khi render
- [ ] làm rõ TTS chọn giọng theo từng dòng phụ đề, không phải 1 giọng chung cho cả file
- **Commit:** `feat(tts): tich hop VietTTS`

### 3.2 Đồng bộ audio-video (dubbing)

- [ ] Canh timing audio TTS khớp với timeline phụ đề gốc
- [ ] Xử lý trường hợp khoảng lặng dài / câu quá dài so với thời lượng gốc (time-stretch nhẹ hoặc cắt bớt)
- [ ] Mux track audio lồng tiếng vào video (thay hoặc chèn thêm track)
- **Commit:** `feat(dubbing): dong bo va ghep audio long tieng vao video`

### 3.3 i18n tiếng Việt

- [ ] Chuẩn hoá toàn bộ text hiển thị qua helper `t()` tự viết
- [ ] File `locales/vi.json` duy nhất
- **Commit:** `feat(i18n): chuan hoa text qua helper t()`

### 3.4 Convert PhoWhisper sang ggml (nếu chưa làm ở 1.3)

- [ ] Convert checkpoint PhoWhisper (HuggingFace) sang định dạng ggml bằng script của whisper.cpp
- [ ] Kiểm tra tương thích version whisper.cpp đang dùng qua `nodejs-whisper`
- [ ] Thêm vào danh sách model tải trong app
- **Commit:** `feat(asr): them PhoWhisper cho tieng Viet`

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

- [ ] Cấu hình `electron-builder.yml`: appId, productName, icon riêng của VANHSUB
- [ ] Build thử installer Windows (`yarn build:local`), test trên máy sạch (không có sẵn Node/VS Build Tools)
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
