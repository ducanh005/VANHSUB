# VANHSUB — Ứng dụng Phụ đề & Lồng tiếng Tiếng Việt

**VANHSUB** là ứng dụng desktop trên Windows dành cho việc tự động tạo phụ đề từ giọng nói (ASR), hiệu đính thời gian real-time, dịch thuật AI (Gemini) và xuất video với phụ đề (Hardsub / Softsub). Dự án được thiết kế & phát triển tối ưu cho tiếng Việt, phục vụ cho đồ án tốt nghiệp / đề án nghiên cứu.

---

## 🚀 Tính năng chính

1. **Nhận dạng giọng nói (ASR)**
   - Sử dụng `nodejs-whisper` (Whisper.cpp) chạy hoàn toàn offline trên thiết bị local.
   - Hỗ trợ chọn các model Whisper khác nhau (base, small, medium, PhoWhisper...).
   - Tự động tách âm thanh (ffmpeg → WAV 16kHz) và tạo file phụ đề `.srt` chuẩn.

2. **Quét phụ đề cứng bằng OCR**
   - Trích phụ đề đã ghẽ sẵn trong khung hình video thành file `.srt` bằng Tesseract OCR (`tesseract.js`).
   - Chỉ quét vùng đáy khung hình (cấu hình được: đáy/toàn khung), lấy mẫu thưa 2 khung/giây, chuyển xám — nhanh và chính xác.
   - Hỗ trợ đa ngôn ngữ (Việt, Anh, Nhật, Hàn, Trung...) — gói ngôn ngữ tự tải lần đầu rồi lưu offline.
   - Nhiều worker OCR chạy song song, có nút huỷ giữa chừng; kết quả đưa thẳng vào luồng dịch / lồng tiếng như phiên âm thường.

3. **Màn hình hiệu đính phụ đề (Subtitle Editor)**
   - Đọc & xem trước video với protocol tùy chỉnh `vanhmedia://` (hỗ trợ HTTP Range request & seek mượt mà).
   - Chỉnh sửa văn bản và mốc thời gian (start/end) trực tiếp từng dòng câu.
   - Các phím bấm tinh chỉnh mốc thời gian nhanh (`±0.1s`, `±1s`, gán theo thời điểm playback video).
   - **Tích hợp Gemini AI**: Đánh bóng câu văn, chỉnh sửa lỗi chính tả/ngữ pháp tự động bằng AI.

4. **Dịch thuật AI với Gemini (Google AI)**
   - Dịch toàn bộ file phụ đề sang tiếng Việt hoặc các ngôn ngữ khác qua Gemini API (tương thích OpenAI SDK).
   - Cơ chế xử lý theo batch kết hợp ngữ cảnh câu trước, đảm bảo tính mạch lạc và nhất quán giữa các đoạn thoại.
   - Giao diện đối chiếu song song giữa bản gốc và bản dịch.

5. **Xuất Video (Video Render & Muxing)**
   - **Hardsub**: Burn ghi cứng phụ đề vào khung hình video bằng ffmpeg (`libx264`, mã hóa an toàn mốc ký tự Unicode và đường dẫn tạm Windows).
   - **Softsub**: Đóng gói phụ đề mềm vào container MP4 (`mov_text`) với tốc độ siêu nhanh (stream copy).

6. **Trang Cài đặt & Quản lý**
   - Lưu trữ API Key Gemini an toàn qua `electron-store`.
   - Quản lý danh sách các model Whisper đã nạp, hiển thị dung lượng đĩa và cho phép xoá bớt model không sử dụng.
   - Tùy chỉnh thư mục xuất video mặc định.

---

## 🛠 Cấu trúc công nghệ (Tech Stack)

- **Framework**: [Electron](https://www.electronjs.org/) + [Next.js](https://nextjs.org/) (thông qua [nextron](https://github.com/saltyshiomix/nextron))
- **Language**: TypeScript
- **UI**: Tailwind CSS, Lucide Icons, Radix UI (shadcn)
- **Audio/Video Processing**: `fluent-ffmpeg`, `@ffmpeg-installer/ffmpeg`, `nodejs-whisper` (Whisper.cpp)
- **AI Translation & Polish**: OpenAI Node SDK kết nối Google Gemini API
- **Data Persistence**: `electron-store`

---

## 📦 Hướng dẫn cài đặt & Khởi chạy

### Yêu cầu môi trường
- **Node.js**: `>= 18.x`
- **Hệ điều hành**: Windows 10 / 11 (64-bit)

### Các bước khởi chạy môi trường Dev:

```bash
# 1. Di chuyển vào thư mục VANHSUB
cd VANHSUB

# 2. Cài đặt các thư viện phụ thuộc
npm install

# 3. Chạy ứng dụng ở chế độ phát triển (Development)
npm run dev
```

### Đóng gói ứng dụng (Production Build):

```bash
cd VANHSUB
npm run build
```
Bộ cài đặt Windows (`.exe`) sẽ được sinh ra tại thư mục `VANHSUB/dist/VANHSUB Setup 1.0.0.exe`.

---

## 📜 Nguồn tham khảo & Bản quyền

- Dự án được xây dựng mới hoàn toàn (không fork trực tiếp) dựa trên kiến trúc tham khảo luồng nghiệp vụ từ dự án mã nguồn mở **[SmartSub](https://github.com/buxuku/SmartSub)** (phát hành dưới giấy phép **MIT License**).
- VANHSUB tự triển khai độc lập toàn bộ các module xử lý data model, giao diện UI/UX riêng (nền mực `#0E1A1B`, accent sơn mài & vàng đồng), bộ xử lý parser/serializer SRT, protocol handler custom `vanhmedia://` và tích hợp Gemini API.
