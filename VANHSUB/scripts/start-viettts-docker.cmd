@echo off
REM Khởi động server VietTTS cho VANHSUB (endpoint http://localhost:6006)
REM - Model nằm trong volume `viettts-models` (tự tải lần đầu, ~2.3GB)
REM - common.py được mount đè để vá lỗi inplace tensor của PyTorch 2.5.1
REM Yêu cầu: Docker Desktop đang chạy, NVIDIA driver mới (để dùng GPU)

set SCRIPT_DIR=%~dp0
set PATCH_FILE=%SCRIPT_DIR%..\patches\viettts\common.py

docker volume inspect viettts-models >nul 2>&1 || docker volume create viettts-models

REM Tải model nếu volume còn trống (server sẽ lỗi nếu thiếu config.yaml)
docker run --rm -v viettts-models:/app/pretrained-models bootforge/viettts:latest ^
  python -c "import os; from viettts.utils.file_utils import download_model; d='/app/pretrained-models'; os.path.exists(d+'/config.yaml') or download_model(d)"

docker rm -f viet-tts-service >nul 2>&1
docker run -d --name viet-tts-service --gpus all -p 6006:6006 ^
  -v viettts-models:/app/pretrained-models ^
  -v "%PATCH_FILE%:/app/viettts/utils/common.py" ^
  bootforge/viettts:latest viettts server --host 0.0.0.0 --port 6006

echo.
echo VietTTS dang khoi dong tai http://localhost:6006
echo Xem log: docker logs -f viet-tts-service
