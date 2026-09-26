import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Download,
  Link2,
  Loader2,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  User,
  Sparkles,
  Clipboard,
  X,
  Layers,
  FolderOpen,
  RotateCcw,
  Edit3,
  Minimize2,
} from 'lucide-react';
import { toast } from 'sonner';
import { backgroundDownloadManager } from '../../lib/downloadManager';

interface MediaInfo {
  url: string;
  cleanUrl: string;
  platform: 'youtube' | 'douyin' | 'bilibili' | 'tiktok' | 'other';
  title: string;
  author?: string;
  duration?: number;
  durationFormatted?: string;
  thumbnail?: string;
  availableQualities: Array<{
    id: string;
    label: string;
  }>;
  /** URL MP4 không watermark — từ amemv API cho Douyin/TikTok */
  noWatermarkUrl?: string;
}

interface DownloadProgress {
  percent: number;
  speed?: string;
  eta?: string;
  status: 'downloading' | 'processing' | 'completed' | 'error';
  stageDescription?: string;
}

interface DownloadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (task: any) => void;
  initialUrl?: string;
}

export const DownloadModal: React.FC<DownloadModalProps> = ({
  open,
  onOpenChange,
  onSuccess,
  initialUrl,
}) => {
  const downloadState = React.useSyncExternalStore(
    backgroundDownloadManager.subscribe,
    backgroundDownloadManager.getState,
    backgroundDownloadManager.getState
  );
  const activeDownload = downloadState.active;

  const [urlInput, setUrlInput] = useState('');
  const [isInspecting, setIsInspecting] = useState(false);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<string>('1080p');
  const [error, setError] = useState<string | null>(null);
  const [saveDir, setSaveDir] = useState<string>('');
  const [defaultDir, setDefaultDir] = useState<string>('');
  const [customTitle, setCustomTitle] = useState<string>('');

  const isDownloading = Boolean(activeDownload?.isDownloading);
  const progress = activeDownload?.progress || null;

  // Đồng bộ thông tin khi mở modal trong lúc đang có tải ngầm
  useEffect(() => {
    if (activeDownload && open) {
      if (!urlInput) setUrlInput(activeDownload.url);
      if (!customTitle) setCustomTitle(activeDownload.title);
      if (!mediaInfo) {
        setMediaInfo({
          url: activeDownload.url,
          cleanUrl: activeDownload.cleanUrl,
          platform: activeDownload.platform,
          title: activeDownload.title,
          author: activeDownload.author,
          duration: activeDownload.duration,
          durationFormatted: activeDownload.durationFormatted,
          thumbnail: activeDownload.thumbnail,
          availableQualities: [{ id: activeDownload.quality || '1080p', label: activeDownload.quality || '1080p' }],
          noWatermarkUrl: activeDownload.noWatermarkUrl,
        });
      }
    }
  }, [activeDownload, open]);

  // Lấy thư mục lưu trữ mặc định và tùy chọn đã lưu
  useEffect(() => {
    if (!open) return;

    let isMounted = true;
    const initDirs = async () => {
      try {
        let def = '';
        if (window.vanhsub?.downloader?.getDefaultDir) {
          def = await window.vanhsub.downloader.getDefaultDir();
        } else if (window.vanhsub?.settings?.get) {
          const exportDir = await window.vanhsub.settings.get('exportDir');
          if (exportDir) def = exportDir;
        }
        if (!isMounted) return;
        setDefaultDir(def);

        const saved = typeof window !== 'undefined' ? localStorage.getItem('vanhsub_download_dir') : null;
        if (saved) {
          setSaveDir(saved);
        } else if (def) {
          setSaveDir(def);
        }
      } catch (err) {
        console.error('Lỗi lấy thư mục mặc định:', err);
      }
    };

    initDirs();

    return () => {
      isMounted = false;
    };
  }, [open]);

  // Cập nhật initialUrl nếu được truyền vào
  useEffect(() => {
    if (open && initialUrl) {
      setUrlInput(initialUrl);
    }
  }, [open, initialUrl]);

  // Reset state khi mở/đóng modal (không reset nếu đang có video tải chạy nền)
  useEffect(() => {
    if (!open && !activeDownload?.isDownloading) {
      setUrlInput('');
      setMediaInfo(null);
      setCustomTitle('');
      setError(null);
      setIsInspecting(false);
    }
  }, [open, activeDownload?.isDownloading]);

  // Chọn thư mục lưu trữ mới qua hộp thoại hệ thống
  const handleChooseDirectory = async () => {
    try {
      if (!window.vanhsub?.dialog?.chooseDirectory) {
        toast.error('Tính năng chọn thư mục chưa sẵn sàng');
        return;
      }
      const dir = await window.vanhsub.dialog.chooseDirectory();
      if (dir) {
        setSaveDir(dir);
        localStorage.setItem('vanhsub_download_dir', dir);
        toast.success('Đã chọn thư mục lưu trữ mới');
      }
    } catch (err) {
      console.error('Lỗi khi chọn thư mục:', err);
      toast.error('Không thể chọn thư mục');
    }
  };

  // Đặt lại thư mục lưu về mặc định
  const handleResetDefaultDir = () => {
    localStorage.removeItem('vanhsub_download_dir');
    setSaveDir(defaultDir);
    toast.info('Đã khôi phục về thư mục lưu mặc định');
  };

  // Dán từ clipboard
  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrlInput(text);
        setError(null);
      }
    } catch {
      toast.error('Không thể đọc từ khay nhớ tạm');
    }
  };

  // Phân tích link
  const handleInspect = async () => {
    if (!urlInput.trim()) {
      setError('Vui lòng nhập hoặc dán liên kết video');
      return;
    }

    setIsInspecting(true);
    setError(null);
    setMediaInfo(null);
    setCustomTitle('');

    try {
      if (!window.vanhsub?.downloader?.inspect) {
        throw new Error('Tính năng tải video chưa sẵn sàng trong môi trường này');
      }

      const info = await window.vanhsub.downloader.inspect(urlInput.trim());
      setMediaInfo(info);
      setCustomTitle(info.title || '');
      if (info.availableQualities && info.availableQualities.length > 0) {
        setSelectedQuality(info.availableQualities[0].id);
      }
      toast.success('Đã phân tích thông tin video thành công!');
    } catch (err: any) {
      console.error('Lỗi phân tích URL:', err);
      setError(err.message || 'Không thể phân tích video từ liên kết này. Vui lòng kiểm tra lại URL.');
      toast.error('Phân tích liên kết thất bại');
    } finally {
      setIsInspecting(false);
    }
  };

  // Tải video (quản lý qua backgroundDownloadManager để tải xuyên suốt các tab)
  const handleDownload = async () => {
    const targetUrl = mediaInfo?.cleanUrl || urlInput.trim();
    if (!targetUrl || !mediaInfo) return;

    setError(null);
    try {
      const result = await backgroundDownloadManager.startDownload({
        url: urlInput.trim(),
        cleanUrl: targetUrl,
        platform: mediaInfo.platform,
        title: customTitle.trim() || mediaInfo.title,
        author: mediaInfo.author,
        duration: mediaInfo.duration,
        durationFormatted: mediaInfo.durationFormatted,
        thumbnail: mediaInfo.thumbnail,
        quality: selectedQuality,
        noWatermarkUrl: mediaInfo.noWatermarkUrl,
        outputDir: saveDir.trim() || undefined,
        customFileName: customTitle.trim() || undefined,
      });

      onSuccess?.(result.task);
      onOpenChange(false);
    } catch (err: any) {
      console.error('Lỗi tải video:', err);
      setError(err?.message || 'Tải video thất bại');
    }
  };


  // Huy hiệu nền tảng
  const renderPlatformBadge = (platform?: string) => {
    switch (platform) {
      case 'douyin':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
            Douyin (TikTok Trung Quốc)
          </span>
        );
      case 'bilibili':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/40">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            Bilibili Video
          </span>
        );
      case 'youtube':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-600/20 text-red-300 border border-red-500/40">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            YouTube / Shorts
          </span>
        );
      case 'tiktok':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            TikTok Quốc Tế
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
            <Link2 className="h-3 w-3" />
            Liên kết trực tuyến
          </span>
        );
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[100] w-[640px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl border border-slate-800 bg-[#0B1120] p-6 shadow-2xl shadow-cyan-950/40 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 text-white">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-teal-600 text-slate-950 shadow-md">
                <Download className="h-5 w-5" />
              </div>
              <div>
                <Dialog.Title className="text-base font-bold text-white">
                  Tải video từ liên kết (Douyin, YouTube, Bilibili...)
                </Dialog.Title>
                <Dialog.Description className="text-xs text-slate-400">
                  Dán đường link, hệ thống sẽ tự động bóc tách thông tin và gom vào thư mục dự án riêng.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-400 transition hover:bg-slate-700 hover:text-white cursor-pointer"
                title={isDownloading ? 'Thu nhỏ cửa sổ tải (video vẫn tiếp tục tải ngầm)' : 'Đóng'}
              >
                {isDownloading ? (
                  <Minimize2 className="h-3.5 w-3.5 text-cyan-400" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
              </button>
            </Dialog.Close>
          </div>

        <div className="space-y-4 mt-2">
          {/* Ô nhập liên kết */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Đường dẫn video (URL):</span>
              <button
                type="button"
                onClick={handlePasteClipboard}
                disabled={isInspecting || isDownloading}
                className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 cursor-pointer disabled:opacity-50"
              >
                <Clipboard className="h-3 w-3" />
                Dán từ khay nhớ tạm
              </button>
            </div>
            <div className="relative flex items-center">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isInspecting && !isDownloading) {
                    handleInspect();
                  }
                }}
                disabled={isInspecting || isDownloading}
                placeholder="Dán link Douyin, YouTube, Bilibili, TikTok..."
                className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 pr-24 font-mono text-xs text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />
              <div className="absolute right-1.5 flex items-center gap-1">
                {urlInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setUrlInput('');
                      setMediaInfo(null);
                      setError(null);
                    }}
                    disabled={isInspecting || isDownloading}
                    className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleInspect}
                  disabled={isInspecting || isDownloading || !urlInput.trim()}
                  className="inline-flex items-center gap-1 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 cursor-pointer transition"
                >
                  {isInspecting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Kiểm tra...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Phân tích</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Mẹo: Với Douyin, bạn có thể dán nguyên văn bản chia sẻ từ app điện thoại (hệ thống sẽ tự lọc link).
            </p>
          </div>

          {/* Chọn thư mục lưu trữ */}
          <div className="space-y-1.5 rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium text-slate-300">
                <FolderOpen className="h-3.5 w-3.5 text-cyan-400" />
                <span>Thư mục lưu video & dự án:</span>
              </span>
              {saveDir && defaultDir && saveDir !== defaultDir && (
                <button
                  type="button"
                  onClick={handleResetDefaultDir}
                  disabled={isDownloading}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-300 transition cursor-pointer disabled:opacity-50"
                  title="Khôi phục về thư mục mặc định của hệ thống"
                >
                  <RotateCcw className="h-3 w-3" />
                  Mặc định
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={saveDir || defaultDir || ''}
                onChange={(e) => {
                  setSaveDir(e.target.value);
                  if (e.target.value.trim()) {
                    localStorage.setItem('vanhsub_download_dir', e.target.value.trim());
                  }
                }}
                disabled={isDownloading}
                placeholder="Đang tải thư mục mặc định..."
                title={saveDir || defaultDir}
                className="flex-1 truncate rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 font-mono text-[11px] text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleChooseDirectory}
                disabled={isDownloading}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition cursor-pointer disabled:opacity-50 shadow-sm"
              >
                <FolderOpen className="h-3.5 w-3.5 text-cyan-400" />
                <span>Chọn thư mục</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Hệ thống sẽ tự động tạo thư mục dự án riêng bên trong thư mục này chứa video và toàn bộ tệp xử lý.
            </p>
          </div>

          {/* Lỗi nếu có */}
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
          )}

          {/* Khung xem trước thông tin video đã phân tích */}
          {mediaInfo && (
            <div className="rounded-2xl border border-slate-700/80 bg-slate-800/60 p-4 space-y-4">
              <div className="flex items-center justify-between">
                {renderPlatformBadge(mediaInfo.platform)}
                {mediaInfo.durationFormatted && (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                    <Clock className="h-3 w-3 text-slate-500" />
                    {mediaInfo.durationFormatted}
                  </span>
                )}
              </div>

              <div className="flex gap-4">
                {/* Thumbnail */}
                <div className="relative h-24 w-36 shrink-0 rounded-xl overflow-hidden bg-slate-900 border border-slate-700/60 flex items-center justify-center">
                  {mediaInfo.thumbnail ? (
                    <img
                      src={mediaInfo.thumbnail}
                      alt={mediaInfo.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Play className="h-8 w-8 text-slate-600" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 space-y-2">
                  {/* Tên file / Tiêu đề có thể chỉnh sửa */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium text-slate-300 flex items-center gap-1.5">
                        <Edit3 className="h-3 w-3 text-cyan-400" />
                        <span>Tên file lưu trữ:</span>
                      </span>
                      {customTitle && mediaInfo.title && customTitle !== mediaInfo.title && (
                        <button
                          type="button"
                          onClick={() => setCustomTitle(mediaInfo.title)}
                          disabled={isDownloading}
                          className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-cyan-300 transition cursor-pointer disabled:opacity-50"
                          title="Đặt lại tên theo tiêu đề gốc của video"
                        >
                          <RotateCcw className="h-2.5 w-2.5" />
                          Tiêu đề gốc
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      disabled={isDownloading}
                      placeholder="Nhập tên file bạn muốn lưu..."
                      className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 font-medium"
                    />
                  </div>

                  {mediaInfo.author && (
                    <p className="inline-flex items-center gap-1 text-xs text-slate-400">
                      <User className="h-3 w-3 text-slate-500" />
                      {mediaInfo.author}
                    </p>
                  )}

                  {/* Lựa chọn chất lượng */}
                  <div className="pt-1 flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 shrink-0">Chất lượng:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {mediaInfo.availableQualities.map((q) => (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => setSelectedQuality(q.id)}
                          disabled={isDownloading}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                            selectedQuality === q.id
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400'
                              : 'bg-slate-700/50 text-slate-300 border border-slate-600 hover:bg-slate-700'
                          }`}
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Badge không watermark cho Douyin/TikTok */}
              {(mediaInfo.platform === 'douyin' || mediaInfo.platform === 'tiktok') && mediaInfo.noWatermarkUrl && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-[11px] text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
                  <span>Video sẽ được tải <strong>không có watermark / logo Douyin</strong> — giống Cốc Cốc, chất lượng gốc.</span>
                </div>
              )}

              {/* Thông báo thư mục lưu trữ & tên file */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-700/50 text-[11px] text-slate-300">
                <Layers className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                <span className="truncate">
                  Dự án & video sẽ được lưu tại:{' '}
                  <strong className="font-mono text-cyan-300" title={saveDir || defaultDir}>
                    {saveDir || defaultDir || 'Thư mục mặc định'}
                  </strong>
                  {' → '}
                  <span className="font-mono text-emerald-300 font-medium">
                    {(customTitle.trim() || mediaInfo.title || 'video').replace(/[\\/:*?"<>|]/g, '_')}_vanhsub/
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* Thanh tiến trình tải */}
          {isDownloading && progress && (
            <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-cyan-300 flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                  {progress.stageDescription || 'Đang tải video...'}
                </span>
                <span className="font-mono font-bold text-cyan-400">
                  {progress.percent.toFixed(1)}%
                </span>
              </div>

              {/* Progress track */}
              <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span>{progress.speed ? `Tốc độ: ${progress.speed}` : ''}</span>
                <span>{progress.eta ? `Còn lại: ${progress.eta}` : ''}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-4 flex items-center justify-between gap-2.5 pt-3 border-t border-slate-800">
          <div>
            {isDownloading && (
              <span className="text-[11px] text-cyan-300 flex items-center gap-1.5 font-medium">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                </span>
                Đang tải chạy nền — bạn có thể thu nhỏ hoặc chuyển tab khác
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              {isDownloading ? (
                <>
                  <Minimize2 className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Thu nhỏ & Chạy nền</span>
                </>
              ) : (
                <span>Đóng</span>
              )}
            </button>

            {mediaInfo && !isDownloading && (
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-400 px-5 py-2 text-xs font-bold text-slate-950 hover:opacity-90 transition cursor-pointer shadow-lg shadow-cyan-500/20"
              >
                <Download className="h-4 w-4" />
                <span>Tải video & Bắt đầu làm việc</span>
              </button>
            )}

            {isDownloading && (
              <div className="inline-flex items-center gap-2 rounded-xl bg-cyan-500/20 border border-cyan-500/40 px-4 py-2 text-xs font-semibold text-cyan-300">
                <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                <span>Đang tải xuống ({progress?.percent ?? 0}%)...</span>
              </div>
            )}
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
  );
};
