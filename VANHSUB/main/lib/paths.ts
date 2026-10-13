import fs from 'fs';
import path from 'path';

/** Reserve a new directory atomically; never adopt an existing project's data. */
export function createUniqueDirectory(targetPath: string): string {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  for (let suffix = 0; ; suffix++) {
    const candidate = suffix === 0 ? targetPath : `${targetPath}_${suffix}`;
    try {
      fs.mkdirSync(candidate);
      return candidate;
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err;
    }
  }
}

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
