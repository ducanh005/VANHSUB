import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { app } from 'electron';
import axios from 'axios';
import { ensureYtDlp } from './voiceFromUrl';
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
  /** URL MP4 không watermark — chỉ có cho Douyin/TikTok từ amemv API */
  noWatermarkUrl?: string;
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
  /** URL MP4 không watermark đã lấy từ inspect, nếu có sẽ ưu tiên dùng */
  noWatermarkUrl?: string;
}

export interface DownloadResult {
  filePath: string;
  fileName: string;
  projectDir: string;
  title: string;
  duration?: string;
  fileSize?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — URL & Platform
// ─────────────────────────────────────────────────────────────────────────────

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
  if (lower.includes('douyin.com') || lower.includes('iesdouyin.com')) return 'douyin';
  if (lower.includes('bilibili.com') || lower.includes('b23.tv')) return 'bilibili';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('tiktok.com')) return 'tiktok';
  return 'other';
}

/**
 * Chuẩn hóa URL Douyin về dạng /video/VIDEO_ID mà amemv API có thể xử lý.
 *
 * Xử lý các dạng URL phổ biến:
 *  - https://www.douyin.com/user/XXX?modal_id=VIDEO_ID  → /video/VIDEO_ID
 *  - https://www.douyin.com/video/VIDEO_ID              → giữ nguyên
 *  - https://v.douyin.com/SHORT_CODE/                  → resolve redirect trước
 *  - https://www.iesdouyin.com/share/video/VIDEO_ID/   → /video/VIDEO_ID
 */
export async function normalizeDouyinUrl(url: string): Promise<string> {
  // 1. Resolve short URL (v.douyin.com)
  if (/v\.douyin\.com/i.test(url)) {
    try {
      const res = await axios.get(url, {
        timeout: 10_000,
        maxRedirects: 10,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      // axios theo redirect → lấy URL cuối
      const finalUrl: string = (res.request as any)?.res?.responseUrl || (res.request as any)?.responseURL || url;
      url = finalUrl;
    } catch {
      // giữ nguyên URL ban đầu
    }
  }

  // 2. URL dạng /user/...?modal_id=VIDEO_ID → /video/VIDEO_ID
  const modalIdMatch = url.match(/[?&]modal_id=(\d+)/);
  if (modalIdMatch) {
    return `https://www.douyin.com/video/${modalIdMatch[1]}`;
  }

  // 3. iesdouyin.com/share/video/VIDEO_ID → douyin.com/video/VIDEO_ID
  const iesMatch = url.match(/iesdouyin\.com\/share\/video\/(\d+)/i);
  if (iesMatch) {
    return `https://www.douyin.com/video/${iesMatch[1]}`;
  }

  // 4. /video/VIDEO_ID đã đúng → trả về
  return url;
}

/**
 * Trích xuất video ID từ Douyin/TikTok URL đã chuẩn hóa.
 */
function extractDouyinVideoId(url: string): string | null {
  // Douyin: /video/VIDEO_ID
  const douyinMatch = url.match(/douyin\.com\/video\/(\d+)/i);
  if (douyinMatch) return douyinMatch[1];

  // TikTok: /video/VIDEO_ID
  const tiktokMatch = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
  if (tiktokMatch) return tiktokMatch[1];

  return null;
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

// ─────────────────────────────────────────────────────────────────────────────
// Amemv (Douyin/TikTok) API — lấy URL không watermark
// ─────────────────────────────────────────────────────────────────────────────

interface AmemvVideoData {
  title: string;
  authorNickname: string;
  durationMs: number;
  thumbnail: string;
  noWatermarkUrl: string;
}

/**
 * Gọi api.amemv.com/aweme/v1/feed/ để lấy thông tin video Douyin/TikTok.
 * Trả về URL MP4 không watermark từ `play_addr`.
 *
 * Lưu ý: API này là public endpoint của Douyin (dành cho client Android),
 * không yêu cầu đăng nhập cho các video công khai.
 */
async function fetchAmemvVideoData(awemeId: string): Promise<AmemvVideoData> {
  const res = await axios.get('https://api.amemv.com/aweme/v1/feed/', {
    params: {
      aweme_id: awemeId,
      aid: '1128',
      version_name: '14.2.2',
      device_platform: 'android',
      os_version: '2333',
    },
    timeout: 20_000,
    headers: {
      'User-Agent': 'okhttp/3.10.0.1',
      'Accept': 'application/json',
    },
  });

  const data = res.data;
  if (!data || data.status_code !== 0) {
    throw new Error(`amemv API trả về lỗi: status_code=${data?.status_code ?? 'unknown'}`);
  }

  const aweme = data.aweme_list?.[0];
  if (!aweme) {
    throw new Error('Không tìm thấy thông tin video từ Douyin API.');
  }

  // play_addr = URL MP4 không watermark
  const playUrls: string[] = aweme.video?.play_addr?.url_list ?? [];
  if (!playUrls.length) {
    throw new Error('Douyin API không trả về URL video.');
  }

  // Ưu tiên URL zjcdn/douyinvod (trực tiếp nhất), tránh amemv play proxy
  const directUrl = playUrls.find(
    (u) => u.includes('zjcdn.com') || u.includes('douyinvod.com') || u.includes('douyinpic.com')
  ) ?? playUrls[0];

  const coverUrls: string[] = aweme.video?.cover?.url_list ?? [];
  const thumbnail = coverUrls.find((u) => u.includes('http')) ?? '';
  const durationMs = Number(aweme.video?.duration ?? 0);

  return {
    title: aweme.desc || 'Video Douyin',
    authorNickname: aweme.author?.nickname || aweme.author?.unique_id || '',
    durationMs,
    thumbnail,
    noWatermarkUrl: directUrl,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Inspect
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phân tích thông tin video từ liên kết (Title, Author, Thumbnail, Duration, Qualities).
 * Douyin/TikTok → dùng amemv API (không watermark, không cần login).
 * Các nền tảng khác → dùng yt-dlp.
 */
export async function inspectMediaUrl(rawUrl: string): Promise<MediaMetadata> {
  let cleanUrl = extractCleanUrl(rawUrl);
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
    throw new Error('Liên kết không hợp lệ. Vui lòng kiểm tra lại URL.');
  }

  const platform = detectPlatform(cleanUrl);

  // ── Douyin / TikTok ──────────────────────────────────────────────────────
  if (platform === 'douyin' || platform === 'tiktok') {
    // Chuẩn hóa URL (xử lý modal_id, short URL, v.douyin.com, ...)
    const normalizedUrl = await normalizeDouyinUrl(cleanUrl);
    const awemeId = extractDouyinVideoId(normalizedUrl);

    if (!awemeId) {
      throw new Error(
        'Không thể trích xuất ID video từ liên kết Douyin này.\n' +
        'Hãy thử mở video trực tiếp và copy link từ nút "Chia sẻ → Sao chép liên kết".'
      );
    }

    try {
      const info = await fetchAmemvVideoData(awemeId);
      const durSec = Math.round(info.durationMs / 1000);
      return {
        url: rawUrl,
        cleanUrl: normalizedUrl,
        platform,
        title: info.title,
        author: info.authorNickname,
        duration: durSec,
        durationFormatted: formatDuration(durSec),
        thumbnail: info.thumbnail,
        noWatermarkUrl: info.noWatermarkUrl,
        availableQualities: [
          { id: 'nowatermark', label: 'Không watermark (HD) ✓' },
          { id: 'audio_only', label: 'Chỉ tải âm thanh (MP3)' },
        ],
      };
    } catch (err: any) {
      throw new Error(
        `Không thể phân tích video Douyin: ${err.message}\n` +
        'Đảm bảo video là công khai và liên kết hợp lệ.'
      );
    }
  }

  // ── Các nền tảng khác (YouTube, Bilibili, ...) — dùng yt-dlp ─────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Download helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Xác định thư mục lưu base (ưu tiên exportDir từ Settings).
 */
function resolveBaseFolder(): string {
  const exportDirSetting = SettingsStore.get('exportDir');
  return exportDirSetting && fs.existsSync(exportDirSetting)
    ? exportDirSetting
    : (app?.getPath
        ? path.join(app.getPath('downloads'), 'VANHSUB')
        : path.join(os.homedir(), 'Downloads', 'VANHSUB'));
}

/**
 * Tổng hợp bước cuối: đổi tên file, tạo thư mục dự án, di chuyển video vào.
 * Dùng chung cho cả download Douyin (axios) và yt-dlp.
 */
function finalizeDownload(
  tempFilePath: string,
  suggestedTitle: string,
  baseFolder: string,
  onProgress?: (p: DownloadProgress) => void
): DownloadResult {
  const ext = path.extname(tempFilePath);
  const cleanBase = sanitizeFolderName(suggestedTitle || path.basename(tempFilePath, ext));
  const finalFileName = `${cleanBase}${ext}`;
  const finalFilePath = path.join(baseFolder, finalFileName);

  if (fs.existsSync(finalFilePath) && finalFilePath !== tempFilePath) {
    fs.unlinkSync(finalFilePath);
  }
  fs.renameSync(tempFilePath, finalFilePath);

  // Tạo thư mục dự án riêng, di chuyển video vào
  const projectDir = path.join(baseFolder, `${cleanBase}_vanhsub`);
  fs.mkdirSync(projectDir, { recursive: true });

  const projectVideoPath = path.join(projectDir, finalFileName);
  if (fs.existsSync(projectVideoPath) && projectVideoPath !== finalFilePath) {
    fs.unlinkSync(projectVideoPath);
  }
  fs.renameSync(finalFilePath, projectVideoPath);

  const stats = fs.statSync(projectVideoPath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(1) + ' MB';

  onProgress?.({
    percent: 100,
    status: 'completed',
    stageDescription: 'Đã hoàn tất tải video!',
  });

  return {
    filePath: projectVideoPath,
    fileName: finalFileName,
    projectDir,
    title: cleanBase,
    fileSize: sizeMb,
  };
}

/**
 * Tải Douyin/TikTok không watermark bằng cách stream MP4 trực tiếp qua axios.
 * Không cần yt-dlp, không cần ffmpeg — video API đã là MP4 hoàn chỉnh.
 */
async function downloadDouyinNoWatermark(
  noWatermarkUrl: string,
  title: string,
  baseFolder: string,
  onProgress?: (p: DownloadProgress) => void
): Promise<string> {
  onProgress?.({
    percent: 5,
    status: 'downloading',
    stageDescription: 'Đang kết nối tới máy chủ Douyin...',
  });

  const tempFileName = `dl_${Date.now()}_nowm.mp4`;
  const tempFilePath = path.join(baseFolder, tempFileName);

  const res = await axios.get(noWatermarkUrl, {
    responseType: 'stream',
    timeout: 1800_000, // 30 phút tối đa
    maxRedirects: 10,
    headers: {
      'User-Agent': 'okhttp/3.10.0.1',
      'Referer': 'https://www.douyin.com/',
    },
  });

  const totalBytes = parseInt(String(res.headers['content-length'] ?? '0'), 10);
  let downloadedBytes = 0;
  let lastReportedPercent = 5;

  const writer = fs.createWriteStream(tempFilePath);

  await new Promise<void>((resolve, reject) => {
    res.data.on('data', (chunk: Buffer) => {
      downloadedBytes += chunk.length;
      if (totalBytes > 0) {
        const rawPercent = (downloadedBytes / totalBytes) * 95 + 5; // 5% → 100%
        const percent = Math.min(98, Math.round(rawPercent));
        if (percent > lastReportedPercent) {
          lastReportedPercent = percent;
          const speedKb = Math.round(downloadedBytes / 1024);
          onProgress?.({
            percent,
            status: 'downloading',
            stageDescription: `Đang tải video (${percent}%)...`,
          });
        }
      }
    });
    res.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    res.data.on('error', reject);
  });

  return tempFilePath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main download entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tải video MP4 hoặc audio MP3 trực tiếp từ liên kết.
 *
 * - Douyin/TikTok → dùng amemv API (MP4 không watermark, stream axios)
 * - YouTube / Bilibili / khác → yt-dlp + ffmpeg merge
 */
export async function downloadVideoFromUrl(options: DownloadVideoOptions): Promise<DownloadResult> {
  const cleanUrl = extractCleanUrl(options.url);
  if (!cleanUrl) throw new Error('Liên kết không hợp lệ.');

  const platform = detectPlatform(cleanUrl);
  const baseFolder = resolveBaseFolder();
  fs.mkdirSync(baseFolder, { recursive: true });

  // ── Douyin / TikTok — stream MP4 không watermark ──────────────────────────
  if (platform === 'douyin' || platform === 'tiktok') {
    const quality = options.quality;

    // ─ Audio only: vẫn dùng yt-dlp để extract mp3
    if (quality === 'audio_only') {
      return downloadViaYtDlp({ ...options, url: cleanUrl }, baseFolder);
    }

    // ─ Lấy URL không watermark (từ inspect nếu đã có, hoặc gọi lại API)
    let noWmUrl = options.noWatermarkUrl;
    if (!noWmUrl) {
      const normalizedUrl = await normalizeDouyinUrl(cleanUrl);
      const awemeId = extractDouyinVideoId(normalizedUrl);
      if (!awemeId) {
        throw new Error('Không thể trích xuất ID video Douyin từ liên kết này.');
      }
      const info = await fetchAmemvVideoData(awemeId);
      noWmUrl = info.noWatermarkUrl;
    }

    const tempFilePath = await downloadDouyinNoWatermark(
      noWmUrl,
      extractDouyinTitle(cleanUrl),
      baseFolder,
      options.onProgress
    );

    return finalizeDownload(tempFilePath, extractDouyinTitle(cleanUrl), baseFolder, options.onProgress);
  }

  // ── Các nền tảng khác — yt-dlp ────────────────────────────────────────────
  return downloadViaYtDlp({ ...options, url: cleanUrl }, baseFolder);
}

/**
 * Lấy title fallback từ URL Douyin (trước khi có API response).
 * Dùng làm tên file tạm.
 */
function extractDouyinTitle(url: string): string {
  const idMatch = url.match(/\/video\/(\d+)/);
  return idMatch ? `douyin_${idMatch[1]}` : `douyin_${Date.now()}`;
}

/**
 * Tải video qua yt-dlp + ffmpeg (YouTube, Bilibili, TikTok audio, ...).
 */
async function downloadViaYtDlp(
  options: DownloadVideoOptions & { url: string },
  baseFolder: string
): Promise<DownloadResult> {
  const quality = options.quality || '1080p';
  const ytDlp = await ensureYtDlp();
  const ffmpegBin = getFfmpegBinPath();

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
  args.push(options.url);

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
