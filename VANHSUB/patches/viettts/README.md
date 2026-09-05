# Patch cho image `bootforge/viettts:latest`

## `common.py` — chống lỗi "Inplace update to inference tensor"

Image dùng PyTorch 2.5.1, trong đó tensor tạo bên trong `torch.inference_mode`
không cho phép ghi đè (inplace) bên ngoài context đó. Hàm `fade_in_out_audio`
và `fade_in_out` trong `viettts/utils/common.py` của upstream vi phạm điều này
khi ghép các đoạn audio → lỗi runtime khi gọi API tạo giọng:

```
RuntimeError: Inplace update to inference tensor outside InferenceMode is not allowed.
```

Fix: thêm `.clone()` trước khi ghi inplace. File đã sửa được mount đè lên
`/app/viettts/utils/common.py` khi chạy container (xem script khởi động).

Nếu upstream phát hành image mới đã chứa fix, có thể bỏ mount này.

## Khởi động container

```cmd
scripts\start-viettts-docker.cmd
```

Script sẽ: tải model vào volume `viettts-models` nếu chưa có, rồi chạy server
ở `http://localhost:6006` (endpoint mặc định của app) với GPU, mount patch trên.
