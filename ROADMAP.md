# Roadmap dự án: [Tên app của bạn] — app phụ đề/lồng tiếng tiếng Việt

> File này dùng để theo dõi tiến độ. Mỗi khi làm xong 1 phần, cập nhật checklist +
> viết note ngắn ở mục "Nhật ký tiến độ" bên dưới. Khi cần AI hỗ trợ tiếp,
> upload file này để AI nắm ngữ cảnh ngay, không cần giải thích lại từ đầu.

## Bối cảnh dự án

- Mục tiêu: xây app desktop chuyển giọng nói → phụ đề → dịch → lồng tiếng, tối ưu cho tiếng Việt.
- Được xây từ đầu (không fork), có tham khảo luồng nghiệp vụ từ project mã nguồn mở
  [SmartSub](https://github.com/buxuku/SmartSub) (MIT License) — không copy code.
- Stack: Electron + Next.js (nextron) + TypeScript.
- Dùng cho: đồ án/đề án tốt nghiệp.

## Quyết định kỹ thuật đã chốt

- [ ] Ngôn ngữ dịch thuật: chỉ dùng **Gemini API** (không dùng provider TQ khác)
- [ ] Ngôn ngữ ASR: **whisper.cpp** / `nodejs-whisper`, ưu tiên model **PhoWhisper** cho tiếng Việt
- [ ] TTS: tích hợp **VietTTS** (qua endpoint tương thích OpenAI)
- [ ] Giao diện: chỉ tiếng Việt, không cần đa ngôn ngữ
- [ ] Ghi chú trong báo cáo: có trích dẫn tham khảo SmartSub (MIT), tự triển khai code

## Checklist tiến độ theo Phase

### Phase 0 — Khởi tạo project

- [x] `npx create-nextron-app` + cấu hình TypeScript
- [x] Setup git repo riêng, README ban đầu
- Commit: `chore: khoi tao project voi nextron`

### Phase 1 — UI khung + quản lý task

- [ ] Data model `Task` (types/task.ts)
- [ ] Store lưu task (electron-store)
- [ ] Màn hình danh sách task
- [ ] Kéo thả video vào app
- Commit: `feat: xay dung UI danh sach task va them video`

### Phase 2 — ASR (Speech-to-Text)

- [ ] Tích hợp whisper.cpp / nodejs-whisper
- [ ] Tải & quản lý model (base/small/PhoWhisper)
- [ ] Convert kết quả → file .srt
- [ ] UI chọn model + progress bar
- Commit: `feat(asr): tich hop whisper.cpp`

### Phase 3 — Editor hiệu đính phụ đề

- [ ] Parser/serializer file .srt
- [ ] Timeline chỉnh thời gian
- [ ] Preview video đồng bộ phụ đề
- Commit: `feat: them man hinh hieu dinh phu de`

### Phase 4 — Dịch thuật (Gemini)

- [ ] Gọi Gemini API dịch phụ đề
- [ ] Prompt template
- [ ] UI nhập API key, chọn ngôn ngữ đích
- Commit: `feat(translate): tich hop Gemini API`

### Phase 5 — TTS / Lồng tiếng

- [ ] Tích hợp VietTTS server
- [ ] Canh timing audio với timeline
- [ ] UI chọn giọng đọc, preview
- Commit: `feat(tts): tich hop VietTTS`

### Phase 6 — Render / xuất video

- [ ] Wrapper gọi ffmpeg
- [ ] Burn hardsub
- [ ] Mux audio lồng tiếng vào video
- Commit: `feat(render): xuat video hoan chinh`

### Phase 7 — Settings

- [ ] Trang cài đặt chung
- [ ] Quản lý API key
- [ ] Quản lý model đã tải
- Commit: `feat: them trang cai dat`

### Phase 8 — i18n tiếng Việt

- [ ] Chuẩn hóa toàn bộ text qua helper `t()`
- [ ] File locale `vi.json`
- Commit: `feat(i18n): chuan hoa text tieng Viet`

### Phase 9 — Đóng gói & release

- [ ] Cấu hình electron-builder (tên app, icon riêng)
- [ ] Build thử installer Windows
- [ ] Viết README hoàn chỉnh + phần ghi công tham khảo
- Commit: `chore: cau hinh dong goi installer`

## Vấn đề / lỗi đang gặp (cập nhật khi cần hỏi AI)

## <!-- Ghi lỗi cụ thể, log, hoặc câu hỏi đang vướng ở đây trước khi hỏi AI -->

## Nhật ký tiến độ

<!-- Mỗi lần làm xong 1 việc, thêm 1 dòng ở đây. Format: ngày - việc đã làm - vướng mắc (nếu có) -->

- 2026-08-25: Khởi tạo project VANHSUB bằng Nextron, bổ sung cấu hình TypeScript và README ban đầu.
