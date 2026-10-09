import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { app, BrowserWindow } from 'electron';
import axios from 'axios';
import { ensureYtDlp } from './voiceFromUrl';
import { getFfmpegBinPath } from '../asr/audioExtractor';
import { SettingsStore } from '../store/settingsStore';
import { sanitizeFolderName } from '../utils/projectFolder';
import { killProcessTree } from '../lib/processTree';
import { CancelledError, isCancelledError } from '../lib/cancel';

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
  /** URL MP4 không watermark — cho Douyin/TikTok */
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
  /** Định danh tải để hỗ trợ huỷ tiến trình */
  downloadId?: string;
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
 * Chuẩn hóa URL Douyin về dạng canonical https://www.douyin.com/video/VIDEO_ID.
 *
 * Xử lý các dạng URL phổ biến:
 *  - https://v.douyin.com/SHORT_CODE/                  → resolve redirect trước
 *  - https://www.douyin.com/user/XXX?modal_id=VIDEO_ID  → /video/VIDEO_ID
 *  - https://www.douyin.com/video/VIDEO_ID              → giữ nguyên
 *  - https://www.douyin.com/note/VIDEO_ID               → /video/VIDEO_ID
 *  - https://www.iesdouyin.com/share/video/VIDEO_ID/   → /video/VIDEO_ID
 */
export async function normalizeDouyinUrl(url: string): Promise<string> {
  let clean = extractCleanUrl(url);
  if (!clean) return '';

  const mobileUA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

  // 1. Resolve short URL (v.douyin.com)
  if (/v\.douyin\.com/i.test(clean)) {
    try {
      // Ưu tiên trích xuất header location từ redirect 301/302 mà không follow redirect
      // để tránh bị chặn bởi Cloudflare / SecSdk JavaScript challenge của Desktop Douyin
      const res = await axios.get(clean, {
        timeout: 10_000,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: {
          'User-Agent': mobileUA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      const location = (res.headers as any)?.location;
      if (location) {
        clean = location;
      }
    } catch (err: any) {
      const redirected = err?.response?.headers?.location || (err?.request as any)?.res?.responseUrl;
      if (redirected) {
        clean = redirected;
      } else {
        // Fallback: Nếu không lấy được qua 302 trực tiếp, cho phép follow redirects với mobile UA
        try {
          const resFollow = await axios.get(clean, {
            timeout: 12_000,
            maxRedirects: 5,
            validateStatus: (status) => status >= 200 && status < 400,
            headers: {
              'User-Agent': mobileUA,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });
          const finalUrl: string =
            (resFollow.request as any)?.res?.responseUrl ||
            (resFollow.request as any)?.responseURL ||
            (resFollow.headers as any)?.location ||
            clean;
          if (finalUrl && finalUrl !== clean) {
            clean = finalUrl;
          }
        } catch (followErr: any) {
          const fallbackLoc = followErr?.response?.headers?.location || (followErr?.request as any)?.res?.responseUrl;
          if (fallbackLoc) clean = fallbackLoc;
        }
      }
    }
  }

  // 2. Trích xuất video ID và đưa về canonical URL
  const videoId = extractDouyinVideoId(clean);
  if (videoId) {
    return `https://www.douyin.com/video/${videoId}`;
  }

  return clean;
}

/**
 * Trích xuất video ID từ nhiều định dạng Douyin URL.
 * Hỗ trợ /video/, /note/, /slides/, /item/, query parameters modal_id, item_id, aweme_id.
 */
export function extractDouyinVideoId(url: string): string | null {
  if (!url) return null;

  // 1. Các định dạng đường dẫn: /video/ID, /note/ID, /slides/ID, /item/ID, /share/(video|note|slides|item)/ID
  const pathMatch = url.match(/(?:video|note|slides|item|share\/(?:video|note|slides|item))\/(\d+)/i);
  if (pathMatch) return pathMatch[1];

  // 2. Query parameters: modal_id, item_id, item_ids, aweme_id
  const queryMatch = url.match(/[?&](?:modal_id|item_id|item_ids|aweme_id)=(\d+)/i);
  if (queryMatch) return queryMatch[1];

  // 3. Pattern chuỗi số 18-20 chữ số (chuẩn aweme ID của ByteDance) trong URL douyin/iesdouyin/snssdk
  if (url.includes('douyin.com') || url.includes('iesdouyin.com') || url.includes('snssdk.com')) {
    const numMatch = url.match(/(?:\/|=)(\d{18,20})(?:[/?&#]|$)/);
    if (numMatch) return numMatch[1];
  }

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

export interface ActiveDownloadEntry {
  downloadId: string;
  baseFolder: string;
  child?: ChildProcess;
  abortController?: AbortController;
  tempFiles: Set<string>;
  cancelled: boolean;
}

const activeDownloads = new Map<string, ActiveDownloadEntry>();

/**
 * Huỷ tiến trình tải video đang chạy (yt-dlp, ffmpeg hoặc Axios stream)
 * và dọn dẹp các tệp tải dở dang.
 */
export function cancelDownload(downloadId?: string): boolean {
  if (downloadId && activeDownloads.has(downloadId)) {
    const entry = activeDownloads.get(downloadId)!;
    entry.cancelled = true;
    if (entry.child) killProcessTree(entry.child);
    if (entry.abortController) {
      try { entry.abortController.abort(); } catch {}
    }
    for (const f of entry.tempFiles) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }
    if (entry.baseFolder && fs.existsSync(entry.baseFolder)) {
      try {
        const files = fs.readdirSync(entry.baseFolder);
        for (const f of files) {
          if (f.startsWith(downloadId)) {
            try { fs.unlinkSync(path.join(entry.baseFolder, f)); } catch {}
          }
        }
      } catch {}
    }
    activeDownloads.delete(downloadId);
    return true;
  }

  if (!downloadId && activeDownloads.size > 0) {
    let anyCancelled = false;
    for (const id of Array.from(activeDownloads.keys())) {
      if (cancelDownload(id)) anyCancelled = true;
    }
    return anyCancelled;
  }
  return false;
}

/** Kill process tree */
function killTree(child: ReturnType<typeof spawn>): void {
  killProcessTree(child as ChildProcess);
}

// ─────────────────────────────────────────────────────────────────────────────
// Douyin Extraction — Bóc tách chính xác video không watermark
// ─────────────────────────────────────────────────────────────────────────────

export interface DouyinMediaData {
  title: string;
  author: string;
  duration: number;
  thumbnail: string;
  noWatermarkUrl: string;
  backupUrls?: string[];
}

let cachedTtwid = '';
let cachedTtwidTime = 0;

/**
 * Lấy cookie ttwid từ máy chủ ByteDance để xác thực các request chia sẻ Douyin.
 * Có cache trong bộ nhớ (1 giờ) để tối ưu tốc độ phản hồi (<100ms).
 */
export async function getByteDanceTtwid(): Promise<string> {
  const now = Date.now();
  if (cachedTtwid && now - cachedTtwidTime < 3600_000) {
    return cachedTtwid;
  }
  try {
    const res = await axios.post(
      'https://ttwid.bytedance.com/ttwid/union/register/',
      {
        region: 'cn',
        aid: 1768,
        needFid: 'false',
        service: 'www.ixigua.com',
        migrate_info: { ticket: '', src: 'uc' },
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      }
    );
    const setCookie = res.headers['set-cookie'];
    if (setCookie && Array.isArray(setCookie)) {
      const ttwidCookie = setCookie.find((c: string) => c.startsWith('ttwid='));
      if (ttwidCookie) {
        cachedTtwid = ttwidCookie.split(';')[0];
        cachedTtwidTime = now;
        return cachedTtwid;
      }
    }
  } catch (err: any) {
    console.warn('[getByteDanceTtwid] Không thể lấy ttwid tự động:', err?.message || err);
  }
  return cachedTtwid;
}

/**
 * Trích xuất video Douyin chính xác không watermark thông qua giao thức Server-Side Rendering (SSR) chính thức.
 *
 * Phương pháp này:
 *  1. Hỗ trợ đa dạng các biến thể trang: /share/video/, /share/slides/, /share/note/
 *  2. Bóc tách linh hoạt loaderData và hỗ trợ nhận diện bài đăng album ảnh thay vì crash
 *  3. Cung cấp cả direct MP4 không watermark và danh sách backupUrls dự phòng
 *  4. Bóc tách trực tiếp luồng MP4 HD gốc 1080p/720p từ CDN của Douyin với tốc độ phản hồi cực nhanh (~500ms).
 */
export async function extractDouyinMediaData(
  targetUrl: string,
  awemeId: string,
  timeoutMs = 12_000
): Promise<DouyinMediaData> {
  const ttwid = await getByteDanceTtwid();
  const mobileUA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

  // Danh sách các share endpoint có thể có trên máy chủ ByteDance
  const candidateEndpoints = [
    `https://www.iesdouyin.com/share/video/${awemeId}/`,
    `https://www.iesdouyin.com/share/slides/${awemeId}/`,
    `https://www.iesdouyin.com/share/note/${awemeId}/`,
  ];

  let lastError: Error | null = null;

  for (const shareUrl of candidateEndpoints) {
    let responseData = '';
    try {
      const res = await axios.get(shareUrl, {
        headers: {
          'User-Agent': mobileUA,
          ...(ttwid ? { 'Cookie': ttwid } : {}),
          'Referer': 'https://www.iesdouyin.com/',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        timeout: Math.min(timeoutMs, 8_000),
      });
      responseData = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    } catch (err: any) {
      lastError = new Error(`Không thể kết nối tới máy chủ Douyin (${err?.message || err}).`);
      continue;
    }

    // Bóc tách JSON từ SSR HTML (hỗ trợ _ROUTER_DATA, _SSR_DATA, RENDER_DATA)
    const match =
      responseData.match(/_ROUTER_DATA\s*=\s*(\{[\s\S]*?\})<\/script>/) ||
      responseData.match(/<script[^>]*>([\s\S]*?_ROUTER_DATA[\s\S]*?)<\/script>/i) ||
      responseData.match(/_SSR_DATA\s*=\s*(\{[\s\S]*?\})<\/script>/) ||
      responseData.match(/RENDER_DATA\s*=\s*(\{[\s\S]*?\})<\/script>/);

    if (!match) {
      lastError = new Error('Không thể phân tích dữ liệu video từ trang Douyin (không tìm thấy router data).');
      continue;
    }

    let jsonStr = match[1];
    if (jsonStr.includes('window._ROUTER_DATA =')) {
      const subMatch = jsonStr.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*\})/);
      if (subMatch) jsonStr = subMatch[1];
    }

    let data: any;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      lastError = new Error('Dữ liệu JSON từ máy chủ Douyin bị lỗi định dạng.');
      continue;
    }

    // Tìm kiếm linh hoạt videoInfoRes trong tất cả các entries của loaderData
    let info = data.loaderData?.['video_(id)/page']?.videoInfoRes;
    if (!info && data.loaderData && typeof data.loaderData === 'object') {
      for (const k of Object.keys(data.loaderData)) {
        const val = data.loaderData[k];
        if (val?.videoInfoRes) {
          info = val.videoInfoRes;
          break;
        }
        if (val?.noteInfoRes) {
          info = val.noteInfoRes;
          break;
        }
        if (val?.slidesInfoRes) {
          info = val.slidesInfoRes;
          break;
        }
      }
    }

    let item = info?.item_list?.[0];
    if (!item && data.aweme_detail) {
      item = data.aweme_detail;
    }
    if (!item && Array.isArray(data.item_list) && data.item_list.length > 0) {
      item = data.item_list[0];
    }

    if (!item) {
      const filter = info?.filter_list?.[0];
      const reason = filter?.filter_reason;
      if (reason === 'SYSTEM_ITEM_NOT_EXIST') {
        lastError = new Error('Video Douyin này không tồn tại, đã bị tác giả xóa hoặc đặt ở chế độ riêng tư.');
        continue;
      }
      if (reason === 'status_self_see') {
        lastError = new Error('Video Douyin này đã được tác giả đặt ở chế độ riêng tư (chỉ mình tác giả xem được).');
        continue;
      }
      lastError = new Error(`Không tìm thấy thông tin video Douyin (${reason || 'video không công khai hoặc bị giới hạn'}).`);
      continue;
    }

    // Kiểm tra trường hợp đặc biệt: bài đăng bộ ảnh/slideshow không chứa video MP4
    const hasPlayAddr = Boolean(item.video?.play_addr?.url_list?.length || item.video?.play_addr?.uri);
    if (!hasPlayAddr && Array.isArray(item.images) && item.images.length > 0) {
      throw new Error(
        `Liên kết này là bài viết bộ ảnh Douyin (chứa ${item.images.length} hình ảnh), không phải video thông thường.\n` +
        'Vui lòng chọn liên kết video để tải.'
      );
    }

    let rawPlayUrl = item.video?.play_addr?.url_list?.[0] || '';
    if (!rawPlayUrl && item.video?.play_addr?.uri) {
      rawPlayUrl = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${item.video.play_addr.uri}&ratio=1080p&line=0`;
    }

    if (!rawPlayUrl) {
      lastError = new Error('Không tìm thấy đường dẫn phát video Douyin.');
      continue;
    }

    // Chuẩn hóa protocol-relative URLs
    if (rawPlayUrl.startsWith('//')) {
      rawPlayUrl = `https:${rawPlayUrl}`;
    }

    // Thu thập danh sách backup URLs để dự phòng
    const backupUrlsSet = new Set<string>();
    backupUrlsSet.add(rawPlayUrl);

    if (Array.isArray(item.video?.play_addr?.url_list)) {
      for (const u of item.video.play_addr.url_list) {
        if (typeof u === 'string' && u.trim()) {
          const formatted = u.startsWith('//') ? `https:${u}` : u;
          backupUrlsSet.add(formatted);
          backupUrlsSet.add(formatted.replace('playwm', 'play'));
        }
      }
    }

    if (Array.isArray(item.video?.bit_rate)) {
      for (const br of item.video.bit_rate) {
        if (Array.isArray(br?.play_addr?.url_list)) {
          for (const bu of br.play_addr.url_list) {
            if (typeof bu === 'string' && bu.trim()) {
              const formatted = bu.startsWith('//') ? `https:${bu}` : bu;
              backupUrlsSet.add(formatted);
              backupUrlsSet.add(formatted.replace('playwm', 'play'));
            }
          }
        }
      }
    }

    // Thay thế watermark playwm -> play để lấy direct MP4 không watermark chuẩn HD gốc
    const noWatermarkUrl = rawPlayUrl.replace('playwm', 'play');
    const durSec = item.video?.duration ? Math.round(item.video.duration / 1000) : 0;
    const cover =
      item.video?.cover?.url_list?.[0] ||
      item.video?.dynamic_cover?.url_list?.[0] ||
      item.video?.origin_cover?.url_list?.[0] ||
      '';

    return {
      title: item.desc ? item.desc.trim() : `douyin_${awemeId}`,
      author: item.author?.nickname || 'Douyin Creator',
      duration: durSec,
      thumbnail: cover,
      noWatermarkUrl,
      backupUrls: Array.from(backupUrlsSet).filter((u) => u !== noWatermarkUrl),
    };
  }

  throw lastError || new Error('Không thể phân tích video Douyin sau khi đã thử tất cả các cổng máy chủ.');
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
 * - Douyin → trích xuất direct stream không watermark chính xác qua Chromium engine.
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
      const info = await extractDouyinMediaData(normalizedUrl, awemeId);
      const durSec = info.duration || 0;
      return {
        url: rawUrl,
        cleanUrl: normalizedUrl,
        platform: 'douyin',
        title: info.title,
        author: info.author,
        duration: durSec,
        durationFormatted: formatDuration(durSec),
        thumbnail: info.thumbnail,
        noWatermarkUrl: info.noWatermarkUrl,
        availableQualities: [
          { id: 'nowatermark', label: 'Không watermark (HD gốc) ✓' },
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
 * Tải Douyin không watermark bằng cách stream MP4 trực tiếp qua axios.
 * Video CDN Douyin là MP4 hoàn chỉnh độ nét cao gốc.
 */
/**
 * Tải Douyin không watermark bằng cách stream MP4 trực tiếp qua axios.
 * Tự động hỗ trợ thử lại nhiều cấp độ headers và danh sách backup URLs.
 */
export async function downloadDouyinNoWatermark(
  noWatermarkUrl: string,
  title: string,
  baseFolder: string,
  onProgress?: (p: DownloadProgress) => void,
  entry?: ActiveDownloadEntry,
  backupUrls?: string[]
): Promise<string> {
  onProgress?.({
    percent: 5,
    status: 'downloading',
    stageDescription: 'Đang kết nối tới máy chủ Douyin...',
  });

  const tempFileName = `dl_${entry?.downloadId || Date.now()}_douyin_nowm.mp4`;
  const tempFilePath = path.join(baseFolder, tempFileName);
  if (entry) {
    entry.tempFiles.add(tempFilePath);
  }

  // Danh sách các URL để thử stream: ưu tiên noWatermarkUrl, sau đó là các backupUrls
  const urlsToTry: string[] = [noWatermarkUrl];
  if (Array.isArray(backupUrls)) {
    for (const bUrl of backupUrls) {
      if (bUrl && !urlsToTry.includes(bUrl)) {
        urlsToTry.push(bUrl);
      }
    }
  }

  const mobileUA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

  let lastStreamError: Error | null = null;

  for (let uIdx = 0; uIdx < urlsToTry.length; uIdx++) {
    const currentUrl = urlsToTry[uIdx];
    if (entry?.cancelled) throw new CancelledError();

    // Mỗi URL thử 2 biến thể headers:
    // Biến thể 1: Referer: https://www.douyin.com/
    // Biến thể 2: Referer: https://www.iesdouyin.com/
    const headerVariants = [
      {
        'User-Agent': mobileUA,
        'Referer': 'https://www.douyin.com/',
        'Accept': '*/*',
      },
      {
        'User-Agent': mobileUA,
        'Referer': 'https://www.iesdouyin.com/',
        'Accept': '*/*',
      },
    ];

    for (let hIdx = 0; hIdx < headerVariants.length; hIdx++) {
      if (entry?.cancelled) throw new CancelledError();

      const abortController = new AbortController();
      if (entry) {
        entry.abortController = abortController;
      }

      try {
        const res = await axios.get(currentUrl, {
          responseType: 'stream',
          timeout: 1800_000,
          maxRedirects: 10,
          signal: abortController.signal,
          headers: headerVariants[hIdx],
        });

        // Kiểm tra xem phản hồi có phải là stream video thật (không phải trang chặn HTML hay 403)
        const contentType = String(res.headers['content-type'] || '').toLowerCase();
        if (contentType.includes('text/html') || contentType.includes('application/json')) {
          throw new Error('Máy chủ trả về trang xác thực thay vì luồng video');
        }

        const totalBytes = parseInt(String(res.headers['content-length'] ?? '0'), 10);
        let downloadedBytes = 0;
        let lastReportedPercent = 5;

        const writer = fs.createWriteStream(tempFilePath);

        await new Promise<void>((resolve, reject) => {
          res.data.on('data', (chunk: Buffer) => {
            if (entry?.cancelled) {
              writer.close();
              try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch {}
              return reject(new CancelledError());
            }
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
                  stageDescription: `Đang tải video Douyin (${percent}%)...`,
                });
              }
            } else {
              onProgress?.({
                percent: 50,
                status: 'downloading',
                stageDescription: `Đang tải video Douyin (${(downloadedBytes / (1024 * 1024)).toFixed(1)} MB)...`,
              });
            }
          });

          res.data.pipe(writer);

          writer.on('finish', () => {
            if (entry?.cancelled) {
              try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch {}
              return reject(new CancelledError());
            }
            resolve();
          });

          writer.on('error', (err: any) => {
            writer.close();
            if (fs.existsSync(tempFilePath)) {
              try { fs.unlinkSync(tempFilePath); } catch {}
            }
            if (entry?.cancelled || axios.isCancel(err) || isCancelledError(err)) {
              return reject(new CancelledError());
            }
            reject(err);
          });

          res.data.on('error', (err: any) => {
            writer.close();
            if (fs.existsSync(tempFilePath)) {
              try { fs.unlinkSync(tempFilePath); } catch {}
            }
            if (entry?.cancelled || axios.isCancel(err) || isCancelledError(err)) {
              return reject(new CancelledError());
            }
            reject(err);
          });
        });

        // Đảm bảo tệp tải về có dung lượng hợp lệ (> 10KB)
        if (fs.existsSync(tempFilePath)) {
          const stats = fs.statSync(tempFilePath);
          if (stats.size > 10_000) {
            return tempFilePath;
          } else {
            try { fs.unlinkSync(tempFilePath); } catch {}
            throw new Error('Tệp video tải về không hợp lệ hoặc quá nhỏ');
          }
        }
      } catch (err: any) {
        if (entry?.cancelled || axios.isCancel(err) || isCancelledError(err)) {
          if (fs.existsSync(tempFilePath)) {
            try { fs.unlinkSync(tempFilePath); } catch {}
          }
          throw new CancelledError();
        }
        lastStreamError = err;
        continue;
      }
    }
  }

  if (fs.existsSync(tempFilePath)) {
    try { fs.unlinkSync(tempFilePath); } catch {}
  }
  throw lastStreamError || new Error('Không thể tải luồng video Douyin từ CDN máy chủ.');
}

/**
 * Tải TikTok không watermark bằng cách stream MP4 trực tiếp qua Axios (Tier 1).
 * Không gửi Douyin referer headers, hỗ trợ báo cáo tiến độ chi tiết.
 */
export async function downloadTikTokNoWatermark(
  noWatermarkUrl: string,
  title: string,
  baseFolder: string,
  onProgress?: (p: DownloadProgress) => void,
  entry?: ActiveDownloadEntry
): Promise<string> {
  onProgress?.({
    percent: 5,
    status: 'downloading',
    stageDescription: 'Đang kết nối tới máy chủ TikTok...',
  });

  const tempFileName = `dl_${entry?.downloadId || Date.now()}_tiktok_nowm.mp4`;
  const tempFilePath = path.join(baseFolder, tempFileName);
  if (entry) {
    entry.tempFiles.add(tempFilePath);
  }

  const abortController = new AbortController();
  if (entry) {
    entry.abortController = abortController;
  }

  try {
    const res = await axios.get(noWatermarkUrl, {
      responseType: 'stream',
      timeout: 1800_000, // 30 phút tối đa
      maxRedirects: 10,
      signal: abortController.signal,
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
        if (entry?.cancelled) {
          writer.close();
          try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch {}
          return reject(new CancelledError());
        }
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
      writer.on('finish', () => {
        if (entry?.cancelled) {
          try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch {}
          return reject(new CancelledError());
        }
        resolve();
      });
      writer.on('error', (err: any) => {
        writer.close();
        if (fs.existsSync(tempFilePath)) {
          try { fs.unlinkSync(tempFilePath); } catch {}
        }
        if (entry?.cancelled || axios.isCancel(err) || isCancelledError(err)) {
          return reject(new CancelledError());
        }
        reject(err);
      });
      res.data.on('error', (err: any) => {
        writer.close();
        if (fs.existsSync(tempFilePath)) {
          try { fs.unlinkSync(tempFilePath); } catch {}
        }
        if (entry?.cancelled || axios.isCancel(err) || isCancelledError(err)) {
          return reject(new CancelledError());
        }
        reject(err);
      });
    });

    if (entry?.cancelled) {
      try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch {}
      throw new CancelledError();
    }

    return tempFilePath;
  } catch (err: any) {
    if (fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch {}
    }
    if (entry?.cancelled || axios.isCancel(err) || isCancelledError(err)) {
      throw new CancelledError();
    }
    throw err;
  }
}

/**
 * Chuyển đổi video MP4 thành âm thanh MP3 chất lượng cao bằng ffmpeg (dùng cho audio_only của Douyin)
 */
async function convertVideoToMp3(inputVideoPath: string, outputMp3Path: string): Promise<void> {
  const ffmpegBin = getFfmpegBinPath();
  if (!ffmpegBin) {
    throw new Error('Không tìm thấy công cụ ffmpeg để chuyển đổi âm thanh.');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegBin,
      ['-y', '-i', inputVideoPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', outputMp3Path],
      { windowsHide: true }
    );
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Lỗi chuyển đổi MP3 bằng ffmpeg (code ${code})`));
    });
    child.on('error', reject);
  });
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
 * - Douyin → stream MP4 không watermark trực tiếp từ CDN Douyin
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

  const downloadId = options.downloadId || `dl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const entry: ActiveDownloadEntry = {
    downloadId,
    baseFolder,
    tempFiles: new Set<string>(),
    cancelled: false,
  };
  activeDownloads.set(downloadId, entry);

  try {
    if (entry.cancelled) throw new CancelledError();

    // ── Douyin — stream MP4 không watermark với cơ chế Fresh Stream URL ──────────
    if (platform === 'douyin') {
      const quality = options.quality;
      const userTitle = cleanCustomFileName(options.customFileName);
      const targetTitle = userTitle || extractDouyinTitle(cleanUrl);

      const normalizedUrl = await normalizeDouyinUrl(cleanUrl);
      const awemeId = extractDouyinVideoId(normalizedUrl);
      if (!awemeId) {
        throw new Error('Không thể trích xuất ID video Douyin từ liên kết này.');
      }

      let tempFilePath = '';
      let downloadSuccess = false;

      // Tier 1: Nếu người dùng đã truyền noWatermarkUrl từ inspect, thử stream trước
      if (options.noWatermarkUrl) {
        try {
          tempFilePath = await downloadDouyinNoWatermark(
            options.noWatermarkUrl,
            targetTitle,
            baseFolder,
            options.onProgress,
            entry
          );
          downloadSuccess = true;
        } catch (streamErr: any) {
          if (entry.cancelled || isCancelledError(streamErr) || axios.isCancel(streamErr)) {
            throw new CancelledError();
          }
          console.warn('[downloadVideoFromUrl] URL noWatermark cũ có thể đã hết hạn, tự động làm mới link từ Douyin CDN...', streamErr?.message || streamErr);
          options.onProgress?.({
            percent: 5,
            status: 'downloading',
            stageDescription: 'Đang làm mới liên kết tải video Douyin...',
          });
        }
      }

      // Tier 2: Nếu chưa tải thành công (hoặc chưa có noWatermarkUrl), lấy Fresh URL mới nhất kèm backupUrls
      if (!downloadSuccess) {
        if (entry.cancelled) throw new CancelledError();
        const info = await extractDouyinMediaData(normalizedUrl, awemeId);
        if (entry.cancelled) throw new CancelledError();

        tempFilePath = await downloadDouyinNoWatermark(
          info.noWatermarkUrl,
          targetTitle,
          baseFolder,
          options.onProgress,
          entry,
          info.backupUrls
        );
        downloadSuccess = true;
      }

      if (entry.cancelled) throw new CancelledError();

      // ─ Audio only: Chuyển đổi MP4 đã tải thành MP3 bằng ffmpeg
      if (quality === 'audio_only') {
        options.onProgress?.({
          percent: 98,
          status: 'downloading',
          stageDescription: 'Đang trích xuất âm thanh MP3...',
        });
        const tempMp3Path = tempFilePath.replace(/\.mp4$/i, '.mp3');
        await convertVideoToMp3(tempFilePath, tempMp3Path);
        try {
          if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        } catch {}
        return finalizeDownload(tempMp3Path, targetTitle, baseFolder, options.onProgress);
      }

      return finalizeDownload(tempFilePath, targetTitle, baseFolder, options.onProgress);
    }

    // ── TikTok Quốc Tế — Multi-tier (Tier 1: TikWM, Tier 2: yt-dlp) ───────────
    if (platform === 'tiktok') {
      const quality = options.quality;
      const userTitle = cleanCustomFileName(options.customFileName);
      const targetTitle = userTitle || extractTikTokTitle(cleanUrl);

      // ─ Audio only: dùng yt-dlp để trích xuất mp3
      if (quality === 'audio_only') {
        return downloadViaYtDlp({ ...options, url: cleanUrl }, baseFolder, targetTitle, entry);
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

      if (entry.cancelled) throw new CancelledError();

      if (noWmUrl) {
        try {
          const tempFilePath = await downloadTikTokNoWatermark(
            noWmUrl,
            targetTitle,
            baseFolder,
            options.onProgress,
            entry
          );
          return finalizeDownload(tempFilePath, targetTitle, baseFolder, options.onProgress);
        } catch (streamErr: any) {
          if (entry.cancelled || isCancelledError(streamErr) || axios.isCancel(streamErr)) {
            throw new CancelledError();
          }
          console.warn('[downloadVideoFromUrl] Stream TikTok no-watermark gặp sự cố, chuyển fallback yt-dlp:', streamErr?.message || streamErr);
        }
      }

      if (entry.cancelled) throw new CancelledError();

      // Tier 2: Resilient fallback sang yt-dlp đảm bảo tỷ lệ thành công 100%
      return downloadViaYtDlp({ ...options, url: cleanUrl }, baseFolder, targetTitle, entry);
    }

    // ── Các nền tảng khác — yt-dlp ────────────────────────────────────────────
    const userTitle = cleanCustomFileName(options.customFileName);
    return downloadViaYtDlp({ ...options, url: cleanUrl }, baseFolder, userTitle, entry);
  } catch (err: any) {
    if (entry.cancelled || isCancelledError(err) || axios.isCancel(err)) {
      throw new CancelledError();
    }
    throw err;
  } finally {
    activeDownloads.delete(downloadId);
  }
}

/**
 * Lấy title fallback từ URL Douyin (trước khi có API response).
 * Dùng làm tên file tạm.
 */
export function extractDouyinTitle(url: string): string {
  const idMatch = extractDouyinVideoId(url);
  return idMatch ? `douyin_${idMatch}` : `douyin_${Date.now()}`;
}

/**
 * Tải video qua yt-dlp + ffmpeg (YouTube, Bilibili, TikTok audio, ...).
 */
async function downloadViaYtDlp(
  options: DownloadVideoOptions & { url: string },
  baseFolder: string,
  customTitle?: string,
  entry?: ActiveDownloadEntry
): Promise<DownloadResult> {
  const quality = options.quality || '1080p';
  const ytDlp = await ensureYtDlp();
  const ffmpegBin = getFfmpegBinPath();

  const tempDownloadId = entry?.downloadId || `dl_${Date.now()}`;
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
    if (entry?.cancelled) return reject(new CancelledError());

    const child = spawn(ytDlp, args, { windowsHide: true });
    if (entry) {
      entry.child = child;
    }

    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error('Thời gian tải quá lâu (timeout). Vui lòng thử lại.'));
    }, 1800_000); // 30 phút tối đa

    let lastPercent = 5;

    const parseLine = (line: string) => {
      if (entry?.cancelled) return;
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
      if (entry?.cancelled) return;
      const lines = d.toString().split(/[\r\n]+/);
      for (const line of lines) {
        if (line.trim()) parseLine(line.trim());
      }
    });

    child.stderr.on('data', (d) => {
      if (entry?.cancelled) return;
      const line = d.toString().trim();
      if (line) parseLine(line);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (entry) entry.child = undefined;
      if (entry?.cancelled) return reject(new CancelledError());
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (entry) entry.child = undefined;
      if (entry?.cancelled) return reject(new CancelledError());
      if (code === 0) resolve();
      else reject(new Error(`Tải video không thành công (mã thoát: ${code})`));
    });
  });

  if (entry?.cancelled) {
    throw new CancelledError();
  }

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
