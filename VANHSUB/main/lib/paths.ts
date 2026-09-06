import fs from 'fs';
import path from 'path';

/**
 * Trả về đường dẫn chưa tồn tại — nếu `targetPath` đã có file thì thêm
 * _1, _2… trước phần mở rộng. Dùng cho mọi output sinh ra cạnh video gốc
 * (.srt, .mp4) để chạy lại không ghi đè mất kết quả của lần trước.
 */
export function nextAvailablePath(targetPath: string): string {
  if (!fs.existsSync(targetPath)) return targetPath;

  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);

  let n = 1;
  let candidate = path.join(dir, `${base}_${n}${ext}`);
  while (fs.existsSync(candidate)) {
    n += 1;
    candidate = path.join(dir, `${base}_${n}${ext}`);
  }
  return candidate;
}
