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
