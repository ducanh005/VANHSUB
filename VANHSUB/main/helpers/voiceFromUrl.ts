import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

/**
 * Tải audio từ link video (TikTok, YouTube, …) để dùng làm giọng mẫu clone.
 *
 * Dùng yt-dlp: hỗ trợ trực tiếp link công khai của TikTok (không cần session id),
 * YouTube và hàng trăm site khác. Binary tự tải về <userData>/bin/ lần đầu tiên.
 */

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

/** Thư mục chứa yt-dlp binary — override bằng env cho script test */
function getBinDir(): string {
  if (process.env.VANHSUB_BIN_DIR) return process.env.VANHSUB_BIN_DIR;
  return path.join(app.getPath('userData'), 'bin');
}

/** Đường dẫn ffmpeg của @ffmpeg-installer (yt-dlp cần để extract audio) */
function getFfmpegPath(): string | null {
  const p = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
  return p ? p.replace('app.asar', 'app.asar.unpacked') : null;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Quá thời gian chạy yt-dlp.'));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim().split('\n').slice(-3).join(' ') || `yt-dlp thoát với mã ${code}`));
    });
  });
}

/**
 * Tìm yt-dlp: ưu tiên bản đã cài trong PATH, sau đó đến bản tự tải trong binDir.
 * Trả về đường dẫn dùng được, hoặc null nếu chưa có (caller sẽ tải).
 */
export async function findYtDlp(): Promise<string | null> {
  const binDir = getBinDir();
  const localPath = path.join(binDir, 'yt-dlp.exe');
  if (fs.existsSync(localPath)) return localPath;

  try {
    await run('yt-dlp', ['--version'], 10_000);
    return 'yt-dlp'; // có sẵn trong PATH
  } catch {
    return null;
  }
}

/** Tải yt-dlp.exe mới nhất từ GitHub về binDir (khoảng 18MB, chỉ làm 1 lần) */
export async function downloadYtDlp(): Promise<string> {
  const binDir = getBinDir();
  fs.mkdirSync(binDir, { recursive: true });
  const target = path.join(binDir, 'yt-dlp.exe');

  const response = await fetch(YTDLP_URL, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Không tải được yt-dlp từ GitHub (HTTP ${response.status}).`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(target, buffer);
  return target;
}

/** Đảm bảo có yt-dlp dùng được, trả về đường dẫn */
export async function ensureYtDlp(): Promise<string> {
  return (await findYtDlp()) ?? (await downloadYtDlp());
}

/**
 * Tải audio (mp3) từ link video ra file output — chỉ lấy tối đa maxDurationSec
 * giây đầu nếu truyền vào (giọng mẫu chỉ cần đoạn ngắn, tác vụ dịch/lồng tiếng
 * cần cả file → truyền 0 để lấy toàn bộ).
 * Trả về đường dẫn file mp3 đã tạo.
 */
const MAX_SAMPLE_SEC = 120;

export async function extractAudioFromUrl(
  url: string,
  outputMp3Path: string,
  timeoutMs: number = 180_000,
  maxDurationSec: number = MAX_SAMPLE_SEC
): Promise<string> {
  const ytDlp = await ensureYtDlp();
  fs.mkdirSync(path.dirname(outputMp3Path), { recursive: true });

  const args = [
    '-x', // chỉ lấy audio
    '--audio-format', 'mp3',
    ...(maxDurationSec > 0 ? ['--download-sections', `*0-${maxDurationSec}`] : []),
    '--no-playlist',
    '--no-warnings',
    '-o', outputMp3Path.replace(/\.mp3$/, '.%(ext)s'),
  ];
  const ffmpegPath = getFfmpegPath();
  if (ffmpegPath) args.push('--ffmpeg-location', ffmpegPath);
  args.push(url);

  await run(ytDlp, args, timeoutMs);

  // yt-dlp có thể đổi đuôi file — tìm lại file output thực tế
  const base = outputMp3Path.replace(/\.mp3$/, '');
  const produced =
    fs.existsSync(outputMp3Path)
      ? outputMp3Path
      : fs.readdirSync(path.dirname(outputMp3Path)).find((f) => f.startsWith(path.basename(base)));

  if (!produced) {
    throw new Error('yt-dlp không tạo được file audio — kiểm tra lại link.');
  }
  const finalPath = path.join(path.dirname(outputMp3Path), produced);
  // Chuẩn hoá về .mp3 nếu yt-dlp xuất đuôi khác (m4a/webm…)
  if (finalPath !== outputMp3Path && fs.existsSync(finalPath)) {
    fs.renameSync(finalPath, outputMp3Path);
  }
  return outputMp3Path;
}
