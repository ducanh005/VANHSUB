# -*- coding: utf-8 -*-
"""Sidecar OCR chạy PaddleOCR PP-OCRv5 qua gói rapidocr (ONNX Runtime).

Pipeline cho từng khung hình (được Node gọi qua file job JSON):
  1. Text Detection  — model det PP-OCRv5 mobile tìm hộp chữ trong khung
  2. Crop            — cắt từng hộp chữ bằng phép biến đổi phối cảnh 4 điểm
  3. Enhance         — upscale chữ nhỏ, khử nhiễu (bilateral), deblur (unsharp
                       mask), tăng tương phản (CLAHE) khi nền sáng
  4. Recognition     — model rec PP-OCRv5 theo ngôn ngữ đọc từng crop đã enhance

Kết quả ghi ra file JSONL (1 dòng / khung) kèm đường dẫn crop PNG để Node chạy
lượt OCR thứ hai bằng Tesseract trên CÙNG crop đó rồi so sánh.

Protocol stdout (mỗi dòng 1 JSON, flush ngay):
  {"type": "ready"}                          — model đã nạp xong
  {"type": "progress", "done": n, "total": m}
  {"type": "warning", "msg": "..."}          — cảnh báo không chết
  {"type": "error", "msg": "..."}            — lỗi rồi exit 3

Exit code: 0 = xong, 2 = thiếu gói python (rapidocr/cv2), 3 = lỗi runtime.

Chạy tay: python paddle_server.py --job job.json
"""

import argparse
import json
import logging
import sys
import warnings
from pathlib import Path

warnings.simplefilter("ignore")
logging.getLogger("rapidocr").setLevel(logging.ERROR)


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


try:
    import cv2
    import numpy as np
    from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR
except ImportError as exc:
    print(f"Thiếu gói python: {exc.name}", file=sys.stderr, flush=True)
    sys.exit(2)


# ---------------------------------------------------------------------------
# Crop + enhance vùng chữ
# ---------------------------------------------------------------------------

def get_rotate_crop_image(img, points):
    """Cắt vùng chữ từ 4 điểm hộp (theo thứ tự của DB postprocess)."""
    points = np.asarray(points, dtype=np.float32)
    w = int(max(np.linalg.norm(points[0] - points[1]), np.linalg.norm(points[2] - points[3])))
    h = int(max(np.linalg.norm(points[0] - points[3]), np.linalg.norm(points[1] - points[2])))
    if w < 2 or h < 2:
        return None
    dst = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    m = cv2.getPerspectiveTransform(points, dst)
    return cv2.warpPerspective(img, m, (w, h))


def enhance(crop):
    """Nâng chất ảnh crop trước khi nhận diện.

    Video hardsub thực tế: chữ nhỏ do video độ phân giải thấp, nhiễu nén,
    chữ hơi mờ. Ba bước đều là thao tác OpenCV nhẹ (vài ms / crop) — không
    dùng fastNlMeansDenoising vì quá chậm khi nhân với hàng nghìn crop.
    """
    h, w = crop.shape[:2]

    # Chữ nhỏ hơn ngưỡng vào của model rec (48px) → phóng to, tối đa 3x
    if h < 48:
        scale = min(3.0, 48.0 / max(h, 1))
        crop = cv2.resize(crop, (max(1, int(w * scale + 0.5)), max(1, int(h * scale + 0.5))),
                          interpolation=cv2.INTER_CUBIC)

    # Khử nhiễu núng nhẹ nhưng giữ cạnh chữ (bilateral nhanh hơn nhiều so với NL-means)
    crop = cv2.bilateralFilter(crop, 5, 40, 40)

    # Deblur: unsharp mask làm nét lại biên chữ bị mờ do nén/motion
    blur = cv2.GaussianBlur(crop, (0, 0), 3)
    crop = cv2.addWeighted(crop, 1.6, blur, -0.6, 0)

    # Nền sáng làm chữ tương phản kém → CLAHE kênh Y (chỉ khi thật sự cần)
    y = cv2.cvtColor(crop, cv2.COLOR_BGR2YUV)[:, :, 0]
    if float(y.std()) < 45:
        yuv = cv2.cvtColor(crop, cv2.COLOR_BGR2YUV)
        yuv[:, :, 0] = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4)).apply(y)
        crop = cv2.cvtColor(yuv, cv2.COLOR_YUV2BGR)

    return crop


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

def sort_reading_order(boxes):
    """Sắp box theo thứ tự đọc: nhóm thành hàng (các box dọc chồng nhau) rồi
    trái → phải trong từng hàng.

    Cần thiết vì: (a) det model hay tách 1 dòng chữ thành nhiều box TỪNG TỪ
    với tâm y lệch nhẹ vài px — sort thô theo min-y làm trộn thứ tự từ;
    (b) phụ đề nhiều dòng phải đọc dòng trên trước dòng dưới.
    """
    items = []
    for b in boxes:
        xs = [p[0] for p in b]
        ys = [p[1] for p in b]
        items.append({"y0": min(ys), "y1": max(ys), "x0": min(xs), "box": b})

    items.sort(key=lambda it: (it["y0"], it["x0"]))
    rows: list[list[dict]] = []
    for it in items:
        placed = False
        for row in rows:
            ref = row[-1]
            # Cùng hàng nếu vùng chữ dọc chồng nhau >= 30% chiều cao thấp hơn
            overlap = min(it["y1"], ref["y1"]) - max(it["y0"], ref["y0"])
            min_h = max(1.0, min(it["y1"] - it["y0"], ref["y1"] - ref["y0"]))
            if overlap >= 0.3 * min_h:
                row.append(it)
                placed = True
                break
        if not placed:
            rows.append([it])

    ordered = []
    for row in rows:
        row.sort(key=lambda it: it["x0"])
        ordered.extend(it["box"] for it in row)
    return ordered


def resolve_enum(enum_cls, names, fallback):
    for name in names:
        member = getattr(enum_cls, name, None)
        if member is not None:
            return member
    return fallback


def build_engine(rec_lang, det_version, rec_version, model_type, text_score):
    params = {
        "Det.ocr_version": getattr(OCRVersion, det_version, OCRVersion.PPOCRV5),
        "Det.model_type": ModelType.MOBILE,
        "Rec.ocr_version": getattr(OCRVersion, rec_version, OCRVersion.PPOCRV5),
        "Rec.lang_type": rec_lang,
        "Rec.model_type": resolve_enum(ModelType, [model_type], ModelType.MOBILE),
        # Ngưỡng thấp hơn mặc định (0.5): hardsub trên nền bận hay bị chấm điểm
        # thấp — để lượt so sánh 2 engine phía Node quyết định giữ/bỏ
        "Global.text_score": text_score,
    }
    return RapidOCR(params=params)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True, help="Đường dẫn file job JSON")
    args = ap.parse_args()

    job = json.loads(Path(args.job).read_text(encoding="utf-8"))
    frames = job["frames"]
    out_path = Path(job["outPath"])
    crops_dir = Path(job["cropsDir"])
    crops_dir.mkdir(parents=True, exist_ok=True)

    # Lang rec: nhận TÊN member enum (CH/EN/KOREAN/LATIN/THAI) từ Node
    lang_names = job.get("recLangNames", ["CH"])
    rec_lang = resolve_enum(LangRec, lang_names, LangRec.CH)

    try:
        engine = build_engine(
            rec_lang,
            job.get("detVersion", "PPOCRV5"),
            job.get("recVersion", "PPOCRV5"),
            job.get("modelType", "MOBILE"),
            float(job.get("textScore", 0.25)),
        )
    except Exception as exc:  # noqa: BLE001 — báo lỗi mặc định rồi exit
        emit({"type": "error", "msg": f"Không khởi tạo được RapidOCR: {exc}"})
        sys.exit(3)
    emit({"type": "ready"})

    video_w = int(job.get("videoWidth") or 0)
    video_h = int(job.get("videoHeight") or 0)
    offset_ratio = float(job.get("regionOffsetRatio") or 0.0)

    total = len(frames)
    with out_path.open("w", encoding="utf-8") as out:
        for i, frame_path in enumerate(frames):
            try:
                lines = process_frame(engine, frame_path, crops_dir, i,
                                      video_w, video_h, offset_ratio)
                out.write(json.dumps({"i": i, "lines": lines}, ensure_ascii=False) + "\n")
                out.flush()
            except Exception as exc:  # noqa: BLE001 — 1 khung lỗi không giết cả quét
                emit({"type": "warning", "msg": f"Khung {i} ({frame_path}): {exc}"})
                out.write(json.dumps({"i": i, "lines": []}, ensure_ascii=False) + "\n")
                out.flush()
            emit({"type": "progress", "done": i + 1, "total": total})

    sys.exit(0)


def process_frame(engine, frame_path, crops_dir, index, video_w, video_h, offset_ratio):
    img = cv2.imread(str(frame_path))
    if img is None:
        raise RuntimeError(f"không đọc được ảnh: {frame_path}")

    # Map tọa độ y từ hệ (khung đã crop vùng + scale) về hệ toạ độ video gốc
    # để lớp lọc watermark so sánh với ngưỡng 25% chiều cao video thật
    fh, fw = img.shape[:2]
    scale = (fw / video_w) if video_w > 0 else 1.0
    offset_px = offset_ratio * video_h if video_h > 0 else 0.0

    result = engine(img, use_det=True, use_cls=False, use_rec=False)
    boxes = getattr(result, "boxes", None) if result is not None else None
    if boxes is None or len(boxes) == 0:
        return []

    # Thứ tự đọc: nhóm theo hàng dọc rồi trái → phải (xem sort_reading_order)
    boxes = sort_reading_order(np.asarray(boxes).tolist())

    lines = []
    for li, box in enumerate(boxes):
        crop = get_rotate_crop_image(img, box)
        if crop is None:
            continue
        crop = enhance(crop)

        crop_path = crops_dir / f"f{index:06d}_l{li:02d}.png"
        cv2.imwrite(str(crop_path), crop)

        rec = engine(crop, use_det=False, use_cls=True, use_rec=True)
        txts = getattr(rec, "txts", None) if rec is not None else None
        if not txts:
            continue
        text = str(txts[0]).strip()
        if not text:
            continue
        scores = getattr(rec, "scores", None)
        conf = float(scores[0]) if scores else 0.0

        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        lines.append({
            "text": text,
            "conf": round(conf, 4),
            # y0/x0 theo toạ độ video gốc (0 = đỉnh khung)
            "y0": int(round(min(ys) / scale + offset_px)),
            "x0": int(round(min(xs) / scale)),
            "w": int(round((max(xs) - min(xs)) / scale)),
            "h": int(round((max(ys) - min(ys)) / scale)),
            "crop": str(crop_path),
        })
    return lines


if __name__ == "__main__":
    main()
