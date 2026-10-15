# Hướng Dẫn Cài Đặt VanhSub Flow Bridge trên Google Chrome

Cầu nối extension giúp ứng dụng **VanhSub Desktop** gọi trực tiếp vào Google Flow với độ tin cậy của tài khoản thật trên Google Chrome, loại bỏ hoàn toàn các lỗi chặn bot `PUBLIC_ERROR_UNUSUAL_ACTIVITY`.

---

### Bước 1: Nạp Extension vào Google Chrome (Làm 1 lần duy nhất)
1. Mở trình duyệt Google Chrome thông thường của bạn.
2. Nhập vào thanh địa chỉ: `chrome://extensions/` và nhấn Enter.
3. Bật công tắc **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải màn hình.
4. Bấm vào nút **Tải tiện ích đã giải nén (Load unpacked)** ở góc trên bên trái.
5. Chọn thư mục `extension` này (đường dẫn: `d:\DEAN\DEAN\VANHSUB\extension`).

---

### Bước 2: Sử dụng
1. Mở 1 tab trên Google Chrome vào: [https://flow.google.com/](https://flow.google.com/) (đăng nhập tài khoản Google của bạn).
2. Khi mở ứng dụng VanhSub Desktop, extension sẽ tự động kết nối qua WebSocket nội bộ (`127.0.0.1:9222`).
3. Mọi thao tác Tạo Ảnh và Tạo Video từ VanhSub sẽ được xử lý siêu tốc qua tab Chrome này!
# Ghép đôi từ phiên bản 1.0.8

Trong VANHSUB, mở **Kết nối Chrome → Tạo mã ghép đôi**. Mở popup extension VANHSUB trên Chrome, dán mã còn hạn và chọn **Ghép đôi**. Mã dùng một lần, hết hạn sau hai phút. Kết nối lại dùng token đã lưu trong extension; app chỉ lưu hash token, gắn với Origin extension. Ghép đôi mới thay thế kết nối cũ. **Thu hồi ghép đôi** trong app ngắt kết nối và vô hiệu token cũ.

Extension cũ không có xác thực sẽ không nhận lệnh. Sau khi cập nhật thư mục extension, tải lại extension trong `chrome://extensions` rồi ghép đôi. Bản app đóng gói chứa extension trong `resources/extension`; nút mở thư mục không phụ thuộc working directory của shortcut.

Ghép đôi không chứng minh phiên Google Flow đã đăng nhập, còn quota hoặc có thể tạo media. Dùng profile test riêng và hoàn tất xác minh trực tiếp khi Google yêu cầu; không vượt CAPTCHA/anti-bot.
