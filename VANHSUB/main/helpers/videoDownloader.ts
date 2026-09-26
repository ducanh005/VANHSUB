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
  quality?: '1080p' | '720p' | '480p' | 'audio_only' | 'best' | 'nowatermark' | 'watermark' | string;
  onProgress?: (p: DownloadProgress) => void;
  /** URL MP4 không watermark đã lấy từ inspect, nếu có sẽ ưu tiên dùng */
  noWatermarkUrl?: string;
  /** Thư mục lưu trữ tùy chọn do người dùng chỉ định */
  outputDir?: string;
  /** Tên file/tiêu đề tùy chọn do người dùng đặt */
  customFileName?: string;
}

/**
 * Chuẩn hóa tên file do người dùng nhập (loại bỏ extension thừa nếu có, loại bỏ ký tự không hợp lệ).
 */
export function cleanCustomFileName(customFileName?: string): string {
  if (!customFileName || typeof customFileName !== 'string') return '';
  let trimmed = customFileName.trim();
  const ext = path.extname(trimmed);
  if (ext && ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.mp3', '.wav', '.m4a', '.flv'].includes(ext.toLowerCase())) {
    trimmed = path.basename(trimmed, ext);
  }
  return sanitizeFolderName(trimmed);
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
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('tiktok.com')) return 'tiktok';
    if (host.includes('douyin.com') || host.includes('iesdouyin.com')) return 'douyin';
    if (host.includes('bilibili.com') || host.includes('b23.tv')) return 'bilibili';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
  } catch {
    const lower = url.toLowerCase();
    if (lower.includes('tiktok.com')) return 'tiktok';
    if (lower.includes('douyin.com') || lower.includes('iesdouyin.com')) return 'douyin';
    if (lower.includes('bilibili.com') || lower.includes('b23.tv')) return 'bilibili';
    if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  }
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
 * Trích xuất video ID từ Douyin URL đã chuẩn hóa.
 */
function extractDouyinVideoId(url: string): string | null {
  // Douyin: /video/VIDEO_ID
  const douyinMatch = url.match(/douyin\.com\/video\/(\d+)/i);
  if (douyinMatch) return douyinMatch[1];

  // Fallback pattern nếu có
  const tiktokMatch = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
  if (tiktokMatch) return tiktokMatch[1];

  return null;
}

/**
 * Nhận diện các liên kết rút gọn của TikTok:
 *  - https://vt.tiktok.com/ZSxxxxxx/
 *  - https://vm.tiktok.com/ZMJxxxxxx/
 *  - https://www.tiktok.com/t/ZTxxxxxx/
 */
export function isTikTokShortUrl(url: string): boolean {
  if (!url) return false;
  return /(?:vt|vm)\.tiktok\.com\/[A-Za-z0-9_-]+/i.test(url) ||
         /tiktok\.com\/t\/[A-Za-z0-9_-]+/i.test(url);
}

/**
 * Trích xuất video ID từ nhiều định dạng URL TikTok quốc tế:
 *  - /@username/video/VIDEO_ID
 *  - /@username/photo/VIDEO_ID
 *  - /video/VIDEO_ID
 *  - /v/VIDEO_ID
 *  - ?modal_id=VIDEO_ID
 *  - /share/video/VIDEO_ID
 */
export function extractTikTokVideoId(url: string): string | null {
  if (!url) return null;
  const p1 = url.match(/tiktok\.com\/@[^/?#]+\/video\/(\d+)/i);
  if (p1) return p1[1];

  const p1Photo = url.match(/tiktok\.com\/@[^/?#]+\/photo\/(\d+)/i);
  if (p1Photo) return p1Photo[1];

  const p2 = url.match(/tiktok\.com\/video\/(\d+)/i);
  if (p2) return p2[1];

  const p3 = url.match(/tiktok\.com\/v\/(\d+)/i);
  if (p3) return p3[1];

  const p4 = url.match(/[?&]modal_id=(\d+)/i);
  if (p4) return p4[1];

  const p5 = url.match(/\/share\/video\/(\d+)/i);
  if (p5) return p5[1];

  const p6 = url.match(/\/(\d{18,20})(?:[/?#]|$)/);
  if (p6) return p6[1];

  return null;
}

export interface NormalizedTikTokUrl {
  cleanUrl: string;
  videoId: string | null;
}

/**
 * Chuẩn hóa URL TikTok quốc tế:
 * 1. Nếu là short URL (vt.tiktok.com, vm.tiktok.com, tiktok.com/t/), phân giải redirect để lấy canonical target URL.
 * 2. Trích xuất video ID và canonicalize thành URL sạch không chứa tracking query parameters.
 */
export async function normalizeTikTokUrl(url: string): Promise<NormalizedTikTokUrl> {
  let clean = extractCleanUrl(url);
  if (!clean) {
    return {
      cleanUrl: '',
      videoId: null,
    };
  }

  // 1. Phân giải link rút gọn nếu có
  if (isTikTokShortUrl(clean)) {
    try {
      const res = await axios.get(clean, {
        timeout: 12_000,
        maxRedirects: 10,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      const finalUrl: string =
        (res.request as any)?.res?.responseUrl ||
        (res.request as any)?.responseURL ||
        (res.headers as any)?.location ||
        clean;
      if (finalUrl && finalUrl !== clean) {
        clean = finalUrl;
      }
    } catch (err: any) {
      const redirected = err?.response?.headers?.location || (err?.request as any)?.res?.responseUrl;
      if (redirected) {
        clean = redirected;
      }
    }
  }

  // 2. Trích xuất video ID
  const videoId = extractTikTokVideoId(clean);

  // 3. Chuẩn hóa canonical clean URL (loại bỏ tracking parameters)
  if (clean.includes('tiktok.com')) {
    try {
      const parsed = new URL(clean);
      const userMatch = clean.match(/tiktok\.com\/(@[^/?#]+)\/video\/(\d+)/i);
      if (userMatch) {
        clean = `https://www.tiktok.com/${userMatch[1]}/video/${userMatch[2]}`;
      } else if (videoId) {
        clean = `https://www.tiktok.com/video/${videoId}`;
      } else {
        clean = `${parsed.origin}${parsed.pathname}`;
      }
    } catch {
      // Giữ nguyên clean
    }
  }

  return {
    cleanUrl: clean,
    videoId,
  };
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

export interface TikwmVideoData {
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
  noWatermarkUrl: string;
  wmUrl?: string;
  musicUrl?: string;
}

/**
 * Gọi TikWM API (https://www.tikwm.com/api/) để bóc tách metadata và lấy link direct MP4 không watermark.
 */
export async function fetchTikwmVideoData(tiktokUrl: string): Promise<TikwmVideoData> {
  const params = new URLSearchParams({
    url: tiktokUrl,
    hd: '1',
  });

  const res = await axios.post('https://www.tikwm.com/api/', params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
    },
    timeout: 15_000,
  });

  const body = res.data;
  if (!body || body.code !== 0 || !body.data) {
    throw new Error(`TikWM API lỗi: ${body?.msg || `code ${body?.code ?? 'unknown'}`}`);
  }

  const d = body.data;
  let play = d.hdplay || d.play;
  if (!play) {
    throw new Error('TikWM API không trả về URL phát video.');
  }
  if (play.startsWith('/')) {
    play = `https://www.tikwm.com${play}`;
  }

  let wmPlay = d.wmplay || d.wm_play;
  if (wmPlay && wmPlay.startsWith('/')) {
    wmPlay = `https://www.tikwm.com${wmPlay}`;
  }

  let cover = d.cover || d.origin_cover || '';
  if (cover.startsWith('/')) {
    cover = `https://www.tikwm.com${cover}`;
  }

  let music = d.music || d.music_info?.play;
  if (music && music.startsWith('/')) {
    music = `https://www.tikwm.com${music}`;
  }

  const authorName = d.author?.nickname || d.author?.unique_id || '';
  const durSec = Number(d.duration || 0);

  return {
    title: d.title || d.content_desc || 'Video TikTok',
    author: authorName,
    duration: durSec,
    thumbnail: cover,
    noWatermarkUrl: play,
    wmUrl: wmPlay,
    musicUrl: music,
  };
}

/**
 * Trích xuất metadata bằng yt-dlp cho YouTube, Bilibili hoặc fallback TikTok.
 */
export async function inspectViaYtDlp(
  rawUrl: string,
  cleanUrl: string,
  platform: PlatformType
): Promise<MediaMetadata> {
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

  const availableQualities = platform === 'tiktok'
    ? [
        { id: 'nowatermark', label: 'Tự động tải chất lượng cao (yt-dlp) ✓' },
        { id: '1080p', label: 'Cao nhất (1080p/HD)' },
        { id: '720p', label: 'Tiêu chuẩn (720p)' },
        { id: 'audio_only', label: 'Chỉ lấy âm thanh (MP3)' },
      ]
    : [
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
// Inspect
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phân tích thông tin video từ liên kết (Title, Author, Thumbnail, Duration, Qualities).
 * - Douyin → dùng amemv API (không watermark, không cần login).
 * - TikTok → Tier 1: TikWM API không watermark; Tier 2: yt-dlp fallback.
 * - Các nền tảng khác (YouTube, Bilibili, ...) → dùng yt-dlp.
 */
export async function inspectMediaUrl(rawUrl: string): Promise<MediaMetadata> {
  let cleanUrl = extractCleanUrl(rawUrl);
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
    throw new Error('Liên kết không hợp lệ. Vui lòng kiểm tra lại URL.');
  }

  const platform = detectPlatform(cleanUrl);

  // ── Douyin ───────────────────────────────────────────────────────────────
  if (platform === 'douyin') {
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
        platform: 'douyin',
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

  // ── TikTok Quốc Tế — Multi-tier (Tier 1: TikWM, Tier 2: yt-dlp) ───────────
  if (platform === 'tiktok') {
    const { cleanUrl: normalizedUrl } = await normalizeTikTokUrl(cleanUrl);

    // Tier 1: TikWM API không watermark
    try {
      const tikwmData = await fetchTikwmVideoData(normalizedUrl);
      return {
        url: rawUrl,
        cleanUrl: normalizedUrl,
        platform: 'tiktok',
        title: tikwmData.title,
        author: tikwmData.author,
        duration: tikwmData.duration,
        durationFormatted: formatDuration(tikwmData.duration),
        thumbnail: tikwmData.thumbnail,
        noWatermarkUrl: tikwmData.noWatermarkUrl,
        availableQualities: [
          { id: 'nowatermark', label: 'Không watermark (HD) ✓' },
          ...(tikwmData.wmUrl ? [{ id: 'watermark', label: 'Bản gốc có watermark' }] : []),
          { id: 'audio_only', label: 'Chỉ tải âm thanh (MP3)' },
        ],
      };
    } catch (apiErr: any) {
      console.warn('[inspectMediaUrl] TikWM API không khả dụng, fallback sang yt-dlp:', apiErr?.message || apiErr);
      // Tier 2: Dự phòng yt-dlp
      return await inspectViaYtDlp(rawUrl, normalizedUrl, 'tiktok');
    }
  }

  // ── Các nền tảng khác (YouTube, Bilibili, ...) — dùng yt-dlp ─────────────
  return await inspectViaYtDlp(rawUrl, cleanUrl, platform);
}

// ─────────────────────────────────────────────────────────────────────────────
// Download helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Xác định thư mục lưu base (ưu tiên customDir, sau đó exportDir từ Settings, cuối cùng là ~/Downloads/VANHSUB).
 */
export function resolveBaseFolder(customDir?: string): string {
  if (customDir && typeof customDir === 'string' && customDir.trim() !== '') {
    return path.resolve(customDir.trim());
  }
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

/**
 * Tải TikTok không watermark bằng cách stream MP4 trực tiếp qua Axios (Tier 1).
 * Không gửi Douyin referer headers, hỗ trợ báo cáo tiến độ chi tiết.
 */
export async function downloadTikTokNoWatermark(
  noWatermarkUrl: string,
  title: string,
  baseFolder: string,
  onProgress?: (p: DownloadProgress) => void
): Promise<string> {
  onProgress?.({
    percent: 5,
    status: 'downloading',
    stageDescription: 'Đang kết nối tới máy chủ TikTok...',
  });

  const tempFileName = `dl_${Date.now()}_tiktok_nowm.mp4`;
  const tempFilePath = path.join(baseFolder, tempFileName);

  const res = await axios.get(noWatermarkUrl, {
    responseType: 'stream',
    timeout: 1800_000, // 30 phút tối đa
    maxRedirects: 10,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
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
        const rawPercent = (downloadedBytes / totalBytes) * 93 + 5; // 5% → 98%
        const percent = Math.min(98, Math.round(rawPercent));
        if (percent > lastReportedPercent) {
          lastReportedPercent = percent;
          const speedKb = Math.round(downloadedBytes / 1024);
          onProgress?.({
            percent,
            speed: speedKb > 0 ? `${speedKb} KB/s` : undefined,
            status: 'downloading',
            stageDescription: `Đang tải video TikTok (${percent}%)...`,
          });
        }
      } else {
        onProgress?.({
          percent: 50,
          status: 'downloading',
          stageDescription: `Đang tải video TikTok (${(downloadedBytes / (1024 * 1024)).toFixed(1)} MB)...`,
        });
      }
    });
    res.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', (err: any) => {
      writer.close();
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch {}
      }
      reject(err);
    });
    res.data.on('error', (err: any) => {
      writer.close();
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch {}
      }
      reject(err);
    });
  });

  return tempFilePath;
}

/**
 * Lấy title fallback từ URL TikTok (trước khi có API response).
 */
export function extractTikTokTitle(url: string): string {
  const id = extractTikTokVideoId(url);
  return id ? `tiktok_${id}` : `tiktok_${Date.now()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main download entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tải video MP4 hoặc audio MP3 trực tiếp từ liên kết.
 *
 * - Douyin → dùng amemv API (MP4 không watermark, stream axios)
 * - TikTok → Tier 1: TikWM stream MP4 không watermark; Tier 2: yt-dlp fallback
 * - YouTube / Bilibili / khác → yt-dlp + ffmpeg merge
 */
export async function downloadVideoFromUrl(options: DownloadVideoOptions): Promise<DownloadResult> {
  const cleanUrl = extractCleanUrl(options.url);
  if (!cleanUrl) throw new Error('Liên kết không hợp lệ.');

  const platform = detectPlatform(cleanUrl);
  const baseFolder = resolveBaseFolder(options.outputDir);
  try {
    fs.mkdirSync(baseFolder, { recursive: true });
  } catch (err: any) {
    throw new Error(`Không thể tạo thư mục lưu trữ "${baseFolder}": ${err?.message || err}`);
  }

  // ── Douyin — stream MP4 không watermark từ amemv API ────────────────────
  if (platform === 'douyin') {
    const quality = options.quality;
    const userTitle = cleanCustomFileName(options.customFileName);
    const targetTitle = userTitle || extractDouyinTitle(cleanUrl);

    // ─ Audio only: vẫn dùng yt-dlp để extract mp3
    if (quality === 'audio_only') {
      return downloadViaYtDlp({ ...options, url: cleanUrl }, baseFolder, targetTitle);
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
      targetTitle,
      baseFolder,
      options.onProgress
    );

    return finalizeDownload(tempFilePath, targetTitle, baseFolder, options.onProgress);
  }

  // ── TikTok Quốc Tế — Multi-tier (Tier 1: TikWM, Tier 2: yt-dlp) ───────────
  if (platform === 'tiktok') {
    const quality = options.quality;
    const userTitle = cleanCustomFileName(options.customFileName);
    const targetTitle = userTitle || extractTikTokTitle(cleanUrl);

    // ─ Audio only: dùng yt-dlp để trích xuất mp3
    if (quality === 'audio_only') {
      return downloadViaYtDlp({ ...options, url: cleanUrl }, baseFolder, targetTitle);
    }

    // Tier 1: Thử tải direct MP4 không watermark từ TikWM API
    let noWmUrl = options.noWatermarkUrl;
    if (!noWmUrl) {
      try {
        const { cleanUrl: normalizedUrl } = await normalizeTikTokUrl(cleanUrl);
        const tikwmData = await fetchTikwmVideoData(normalizedUrl);
        noWmUrl = tikwmData.noWatermarkUrl;
      } catch (err: any) {
        console.warn('[downloadVideoFromUrl] Không lấy được noWatermarkUrl từ TikWM, chuyển fallback yt-dlp:', err?.message || err);
      }
    }

    if (noWmUrl) {
      try {
        const tempFilePath = await downloadTikTokNoWatermark(
          noWmUrl,
          targetTitle,
          baseFolder,
          options.onProgress
        );
        return finalizeDownload(tempFilePath, targetTitle, baseFolder, options.onProgress);
      } catch (streamErr: any) {
        console.warn('[downloadVideoFromUrl] Stream TikTok no-watermark gặp sự cố, chuyển fallback yt-dlp:', streamErr?.message || streamErr);
      }
    }

    // Tier 2: Resilient fallback sang yt-dlp đảm bảo tỷ lệ thành công 100%
    return downloadViaYtDlp({ ...options, url: cleanUrl }, baseFolder, targetTitle);
  }

  // ── Các nền tảng khác — yt-dlp ────────────────────────────────────────────
  const userTitle = cleanCustomFileName(options.customFileName);
  return downloadViaYtDlp({ ...options, url: cleanUrl }, baseFolder, userTitle);
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
  baseFolder: string,
  customTitle?: string
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
    } else if (quality === 'best' || (quality as string) === 'nowatermark') {
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
  const originalBase = path.basename(finalFilePath, ext);
  const userTitle = cleanCustomFileName(options.customFileName) || cleanCustomFileName(customTitle);
  const videoBase = userTitle || originalBase;
  const cleanBase = sanitizeFolderName(videoBase);
  const finalRenamedFileName = `${cleanBase}${ext}`;

  const projectDir = path.join(baseFolder, `${cleanBase}_vanhsub`);
  fs.mkdirSync(projectDir, { recursive: true });

  // Di chuyển video vào thư mục dự án để gom tất cả lại một chỗ
  const projectVideoPath = path.join(projectDir, finalRenamedFileName);
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
    fileName: finalRenamedFileName,
    projectDir,
    title: cleanBase,
    fileSize: sizeMb,
  };
}
