import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { app } from 'electron';
import axios from 'axios';
import { ensureYtDlp, findYtDlp } from './voiceFromUrl';
import { getFfmpegBinPath } from '../asr/audioExtractor';
import { SettingsStore } from '../store/settingsStore';
import { sanitizeFolderName } from '../utils/projectFolder';

export type PlatformType = 'youtube' | 'douyin' | 'bilibili' | 'tiktok' | 'other';

export interface MediaMetadata {
  url: string;
  cleanUrl: string;
  platform: PlatformType;
  title: string;
  author?: string;
  duration?: number;
  durationFormatted?: string;
  thumbnail?: string;
  availableQualities: Array<{
    id: string;
    label: string;
  }>;
}

export interface DownloadProgress {
  percent: number;
  speed?: string;
  eta?: string;
  status: 'downloading' | 'processing' | 'completed' | 'error';
  stageDescription?: string;
}

export interface DownloadVideoOptions {
  url: string;
  quality?: '1080p' | '720p' | '480p' | 'audio_only' | 'best';
  onProgress?: (p: DownloadProgress) => void;
}

export interface DownloadResult {
  filePath: string;
  fileName: string;
  projectDir: string;
  title: string;
  duration?: string;
  fileSize?: string;
}

/**
 * Trích xuất link URL sạch từ văn bản dán vào.
 * Hỗ trợ lọc các chuỗi copy từ app Douyin / TikTok / Bilibili (vốn chứa cả text tiếng Trung / icon).
 */
export function extractCleanUrl(rawInput: string): string {
  if (!rawInput) return '';
  const trimmed = rawInput.trim();

  // Tìm URL http/https hợp lệ đầu tiên, loại trừ khoảng trắng và ký tự CJK (Hoa/Hàn/Nhật)
  const urlMatch = trimmed.match(/https?:\/\/[^\s\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af"<>`]+/i);
  if (urlMatch) {
    let clean = urlMatch[0].trim();
    // Bỏ dấu câu dính ở cuối nếu có
    clean = clean.replace(/[),;.]+$/, '');
    return clean;
  }
  return trimmed;
}

/**
 * Nhận diện nền tảng video dựa trên domain
 */
export function detectPlatform(url: string): PlatformType {
  const lower = url.toLowerCase();
  if (lower.includes('douyin.com')) return 'douyin';
  if (lower.includes('bilibili.com') || lower.includes('b23.tv')) return 'bilibili';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('tiktok.com')) return 'tiktok';
  return 'other';
}

/** Format giây thành chuỗi mm:ss hoặc hh:mm:ss */
function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '00:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Kill process tree */
function killTree(child: ReturnType<typeof spawn>): void {
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGKILL');
    }
  } catch {}
}

/**
 * Phân tích thông tin video từ liên kết (Title, Author, Thumbnail, Duration, Qualities)
 */
export async function inspectMediaUrl(rawUrl: string): Promise<MediaMetadata> {
  const cleanUrl = extractCleanUrl(rawUrl);
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
    throw new Error('Liên kết không hợp lệ. Vui lòng kiểm tra lại URL.');
  }

  const platform = detectPlatform(cleanUrl);

  // Thử nghiệm dự phòng cho Douyin / TikTok thông qua TikWM nếu yt-dlp chậm hoặc Douyin chặn
  if (platform === 'douyin' || platform === 'tiktok') {
    try {
      const res = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`, {
        timeout: 10_000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      });
      if (res.data && res.data.code === 0 && res.data.data) {
        const d = res.data.data;
        const dur = Number(d.duration || 0);
        return {
          url: rawUrl,
          cleanUrl,
          platform,
          title: d.title || 'Video Douyin/TikTok',
          author: d.author?.nickname || d.author?.unique_id || 'Tác giả',
          duration: dur,
          durationFormatted: formatDuration(dur),
          thumbnail: d.cover || d.origin_cover || '',
          availableQualities: [
            { id: '1080p', label: 'Chất lượng cao nhất (HD)' },
            { id: '720p', label: 'Tiêu chuẩn (720p)' },
            { id: 'audio_only', label: 'Chỉ tải âm thanh (MP3)' },
          ],
        };
      }
    } catch {
      // Fallback lại yt-dlp bên dưới
    }
  }

  // Sử dụng yt-dlp --dump-single-json
  const ytDlp = await ensureYtDlp();
  const args = [
    '--dump-single-json',
    '--no-warnings',
    '--no-playlist',
  ];
  const ffmpegBin = getFfmpegBinPath();
  if (ffmpegBin) {
    args.push('--ffmpeg-location', ffmpegBin);
  }
  args.push(cleanUrl);

  const jsonStr = await new Promise<string>((resolve, reject) => {
    const child = spawn(ytDlp, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error('Quá thời gian phân tích liên kết (timeout).'));
    }, 45_000);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else {
        const msg = stderr.trim().split('\n').slice(-2).join(' ') || `Lỗi phân tích video (code ${code})`;
        reject(new Error(msg));
      }
    });
  });

  const info = JSON.parse(jsonStr);
  const dur = Number(info.duration || 0);

  const availableQualities = [
    { id: '1080p', label: 'Cao nhất (1080p/HD)' },
    { id: '720p', label: 'Tiêu chuẩn (720p)' },
    { id: '480p', label: 'Tiết kiệm (480p)' },
    { id: 'audio_only', label: 'Chỉ lấy âm thanh (MP3)' },
  ];

  return {
    url: rawUrl,
    cleanUrl,
    platform,
    title: info.title || 'Video từ liên kết',
    author: info.uploader || info.channel || info.uploader_id || '',
    duration: dur,
    durationFormatted: formatDuration(dur),
    thumbnail: info.thumbnail || '',
    availableQualities,
  };
}

/**
 * Tải video MP4 hoặc audio MP3 trực tiếp từ liên kết
 */
export async function downloadVideoFromUrl(options: DownloadVideoOptions): Promise<DownloadResult> {
  const cleanUrl = extractCleanUrl(options.url);
  if (!cleanUrl) throw new Error('Liên kết không hợp lệ.');

  const quality = options.quality || '1080p';
  const ytDlp = await ensureYtDlp();
  const ffmpegBin = getFfmpegBinPath();

  // Xác định thư mục lưu trữ: ưu tiên exportDir nếu có, hoặc Downloads/VANHSUB
  const exportDirSetting = SettingsStore.get('exportDir');
  let baseFolder = exportDirSetting && fs.existsSync(exportDirSetting)
    ? exportDirSetting
    : (app?.getPath ? path.join(app.getPath('downloads'), 'VANHSUB') : path.join(os.homedir(), 'Downloads', 'VANHSUB'));

  fs.mkdirSync(baseFolder, { recursive: true });

  const tempDownloadId = `dl_${Date.now()}`;
  const outTemplate = path.join(baseFolder, `${tempDownloadId}_%(title).90B.%(ext)s`);

  const args: string[] = [
    '--no-playlist',
    '--no-warnings',
    '--newline',
  ];

  if (ffmpegBin) {
    args.push('--ffmpeg-location', ffmpegBin);
  }

  if (quality === 'audio_only') {
    args.push('-x', '--audio-format', 'mp3');
  } else {
    // Tải video và mux thành mp4 hoàn chỉnh
    let formatFilter = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
    if (quality === '720p') {
      formatFilter = 'bestvideo[height<=720]+bestaudio/best[height<=720]/best';
    } else if (quality === '480p') {
      formatFilter = 'bestvideo[height<=480]+bestaudio/best[height<=480]/best';
    } else if (quality === 'best') {
      formatFilter = 'bestvideo+bestaudio/best';
    }
    args.push('-f', formatFilter, '--merge-output-format', 'mp4');
  }

  args.push('-o', outTemplate);
  args.push(cleanUrl);

  options.onProgress?.({
    percent: 5,
    status: 'downloading',
    stageDescription: 'Đang kết nối tới máy chủ video...',
  });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ytDlp, args, { windowsHide: true });
    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error('Thời gian tải quá lâu (timeout). Vui lòng thử lại.'));
    }, 1800_000); // 30 phút tối đa

    let lastPercent = 5;

    const parseLine = (line: string) => {
      const matchPercent = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
      if (matchPercent) {
        const percent = Math.min(98, Math.max(lastPercent, parseFloat(matchPercent[1])));
        lastPercent = percent;

        // Trích xuất speed và ETA
        const speedMatch = line.match(/at\s+([^\s]+)/);
        const etaMatch = line.match(/ETA\s+([^\s]+)/);

        options.onProgress?.({
          percent,
          speed: speedMatch ? speedMatch[1] : undefined,
          eta: etaMatch ? etaMatch[1] : undefined,
          status: 'downloading',
          stageDescription: `Đang tải video (${percent.toFixed(1)}%)...`,
        });
      } else if (line.includes('[Merger]') || line.includes('[ffmpeg]')) {
        options.onProgress?.({
          percent: 99,
          status: 'processing',
          stageDescription: 'Đang ghép âm thanh và hình ảnh...',
        });
      }
    };

    child.stdout.on('data', (d) => {
      const lines = d.toString().split(/[\r\n]+/);
      for (const line of lines) {
        if (line.trim()) parseLine(line.trim());
      }
    });

    child.stderr.on('data', (d) => {
      const line = d.toString().trim();
      if (line) parseLine(line);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Tải video không thành công (mã thoát: ${code})`));
    });
  });

  // Tìm file đã tải về theo tiền tố tempDownloadId
  const files = fs.readdirSync(baseFolder);
  const matchedFile = files.find((f) => f.startsWith(tempDownloadId));
  if (!matchedFile) {
    throw new Error('Không tìm thấy file video sau khi tải về.');
  }

  const downloadedFilePath = path.join(baseFolder, matchedFile);

  // Đổi tên bỏ tiền tố tempDownloadId
  const cleanFileName = matchedFile.replace(new RegExp(`^${tempDownloadId}_`), '');
  const finalFilePath = path.join(baseFolder, cleanFileName);

  if (fs.existsSync(finalFilePath) && finalFilePath !== downloadedFilePath) {
    fs.unlinkSync(finalFilePath);
  }
  fs.renameSync(downloadedFilePath, finalFilePath);

  // Tự động tạo thư mục dự án riêng cho video này
  const ext = path.extname(finalFilePath);
  const videoBase = path.basename(finalFilePath, ext);
  const cleanBase = sanitizeFolderName(videoBase);
  const projectDir = path.join(baseFolder, `${cleanBase}_vanhsub`);
  fs.mkdirSync(projectDir, { recursive: true });

  // Di chuyển video vào thư mục dự án để gom tất cả lại một chỗ
  const projectVideoPath = path.join(projectDir, path.basename(finalFilePath));
  if (fs.existsSync(projectVideoPath) && projectVideoPath !== finalFilePath) {
    fs.unlinkSync(projectVideoPath);
  }
  fs.renameSync(finalFilePath, projectVideoPath);

  const stats = fs.statSync(projectVideoPath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(1) + ' MB';

  options.onProgress?.({
    percent: 100,
    status: 'completed',
    stageDescription: 'Đã hoàn tất tải video!',
  });

  return {
    filePath: projectVideoPath,
    fileName: path.basename(projectVideoPath),
    projectDir,
    title: videoBase,
    fileSize: sizeMb,
  };
}
