# Setup PhoWhisper cho VANHSUB

## Giới thiệu

PhoWhisper là mô hình ASR (Automatic Speech Recognition) được huấn luyện đặc biệt cho tiếng Việt bởi VinAI. Nó dựa trên kiến trúc Whisper của OpenAI nhưng tối ưu hóa cho ngôn ngữ Việt Nam.

**Lợi ích:**
- Độ chính xác cao cho tiếng Việt (tốt hơn Whisper base trên tiếng Việt)
- Hỗ trợ các phương ngữ Việt
- Tốc độ xử lý nhanh với model size nhỏ (base: ~140 MB)

## Yêu cầu

### Hệ thống
- **CPU:** Intel i5/i7 hoặc tương đương (khuyến nghị quad-core trở lên)
- **RAM:** Tối thiểu 8 GB (16 GB khuyến nghị)
- **Disk:** 5 GB cho model + temporary space
- **OS:** Windows 10/11, macOS 10.15+, Linux (Ubuntu 18.04+)

### Phần mềm
- Python 3.8+
- pip (Python package manager)
- Git (để clone repository nếu cần)

## Cài đặt

### Bước 1: Chuẩn bị môi trường Python

```bash
# Windows
python --version
pip --version

# macOS/Linux
python3 --version
pip3 --version
```

Nếu chưa có Python, tải từ https://www.python.org/downloads/

### Bước 2: Cài đặt dependencies

```bash
# Windows
pip install torch transformers huggingface-hub numpy safetensors

# macOS/Linux
pip3 install torch transformers huggingface-hub numpy safetensors
```

### Bước 3: Chạy script conversion

Mở terminal/Command Prompt ở thư mục project VANHSUB:

```bash
# Windows (PowerShell hoặc Command Prompt)
cd VANHSUB\scripts
bash convert-phowhisper.sh

# macOS/Linux
cd VANHSUB/scripts
chmod +x convert-phowhisper.sh
./convert-phowhisper.sh
```

**Quá trình sẽ:**
1. Download PhoWhisper model từ HuggingFace (~500 MB)
2. Convert sang định dạng ggml (~400 MB)
3. Copy vào thư mục models của app
4. Cleanup temporary files

**Thời gian:** 10-30 phút tùy tốc độ internet

### Bước 4: Kiểm tra cài đặt

Mở VANHSUB app:
1. Vào **Cài đặt** → **Quản lý Model**
2. Kiểm tra xem `ggml-phowhisper-base.bin` có xuất hiện không

## Sử dụng

### Trong ứng dụng

1. **Trang chủ → Tải video**
   - Chọn file video hoặc kéo thả vào app
   - Chọn workflow (ví dụ: "Phụ đề gốc siêu tốc")

2. **Bước Phiên âm**
   - Ở **Cài đặt**, chọn ASR Model: `phowhisper-base`
   - Bấm nút "Bắt đầu phiên âm"
   - App sẽ xử lý video và tạo file `.srt`

### Thủ công (Command line)

```bash
# Test PhoWhisper từ command line
# (Sau khi cài xong model ggml)

cd VANHSUB
npm run dev

# Hoặc dùng nodejs-whisper trực tiếp:
node -e "
const { transcribe } = require('nodejs-whisper');
transcribe('input.wav', { modelName: 'phowhisper-base' })
  .then(result => console.log(result))
  .catch(err => console.error(err));
"
```

## Thông tin mô hình

### Danh sách PhoWhisper versions

| Phiên bản | Kích thước | Tốc độ | Độ chính xác | Khuyến dùng |
|----------|-----------|-------|------------|-----------|
| tiny    | ~39 MB    | Rất nhanh | Thấp | Streaming, demo |
| base    | ~140 MB   | Nhanh | Tốt | **Khuyến nghị** |
| small   | ~461 MB   | Bình thường | Rất tốt | Production |
| medium  | ~1.5 GB   | Chậm | Xuất sắc | Research |

### Tải thêm phiên bản khác

Để cài các phiên bản khác, chỉnh sửa script:

```bash
# Mở convert-phowhisper.sh
# Tìm dòng: model_id = "vinai/PhoWhisper-base"
# Thay thành:
#   - "vinai/PhoWhisper-tiny"
#   - "vinai/PhoWhisper-small"
#   - "vinai/PhoWhisper-medium"

# Rồi chạy lại script
```

## Troubleshooting

### Lỗi: "Model file not found"

**Giải pháp:**
1. Kiểm tra kết nối internet
2. Thử cài lại huggingface-hub: `pip install --upgrade huggingface-hub`
3. Clear cache: `rm -rf ~/.cache/huggingface`

### Lỗi: "Conversion failed"

**Giải pháp:**
1. Kiểm tra PyTorch cài đúng: `pip install --upgrade torch`
2. Kiểm tra RAM: Process conversion cần ít nhất 4 GB
3. Thử Python version cũ hơn (3.8 hoặc 3.9)

### Lỗi: "Module not found" (transformers, torch, etc)

**Giải pháp:**
```bash
pip install --upgrade torch transformers huggingface-hub
```

### App không nhận model

**Giải pháp:**
1. Restart app hoàn toàn
2. Kiểm tra file model có quyền đọc: `ls -la VANHSUB/node_modules/nodejs-whisper/cpp/whisper.cpp/models/`
3. Xoá cache settings: `~/.config/VANHSUB-settings/` (Linux) hoặc `%APPDATA%/VANHSUB-settings/` (Windows)

## Tối ưu hóa

### Sử dụng GPU

PhoWhisper có thể dùng GPU NVIDIA (CUDA) hoặc Apple Silicon (Metal) để tăng tốc độ:

```bash
# CUDA (NVIDIA GPU)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# Metal (Apple Silicon - tự động nếu dùng Mac)
# Không cần cài gì thêm, PyTorch tự detect
```

Sau đó, nodejs-whisper sẽ tự dùng GPU nếu khả dụng.

### Batch processing

Để xử lý nhiều file cùng lúc:

```bash
# Tạo task cho nhiều video trong app
# Mỗi task sẽ queue và xử lý tuần tự
# ASR sẽ dùng PhoWhisper cho tất cả
```

## Tham khảo

- **PhoWhisper Repository:** https://github.com/vinai/PhoWhisper
- **Whisper.cpp:** https://github.com/ggerganov/whisper.cpp
- **nodejs-whisper:** https://www.npmjs.com/package/nodejs-whisper
- **HuggingFace Model Card:** https://huggingface.co/vinai/PhoWhisper-base

## Ghi chú

- **Phiên bản hiện tại:** PhoWhisper được cập nhật định kỳ trên HuggingFace
- **Cấp phép:** PhoWhisper sử dụng cấp phép MIT, miễn phí cho sử dụng thương mại
- **Hỗ trợ:** Nếu gặp vấn đề, báo cáo trên GitHub của dự án VANHSUB
