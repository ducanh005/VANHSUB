import React, { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Check,
  Crop,
  Layers,
  Loader2,
  Maximize2,
  Play,
  Pause,
  RotateCcw,
  ScanText,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import type { Task } from '../types/task';
import type { OcrCustomRegion, OcrMode, OcrStartOptions } from '../types/electron';

interface OcrConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  onStartOcr: (options: OcrStartOptions) => Promise<void>;
}

const OCR_MODES: Array<{
  id: OcrMode;
  label: string;
  desc: string;
  badge?: string;
  badgeColor?: string;
}> = [
  {
    id: 'auto',
    label: 'Auto',
    desc: 'Tự tìm subtitle trên toàn màn hình (AI tracking & tự lọc bỏ logo/watermark)',
    badge: 'Khuyên dùng',
    badgeColor: 'bg-brand-cyan/20 text-brand-cyan border-brand-cyan/40',
  },
  {
    id: 'bottom',
    label: 'Bottom',
    desc: 'Chỉ tìm vùng dưới (Dải đáy màn hình ~35%)',
  },
  {
    id: 'full',
    label: 'Full Screen',
    desc: 'Nhận diện tất cả text trên toàn khung hình (không lọc)',
  },
  {
    id: 'custom',
    label: 'Custom',
    desc: 'Người dùng kéo vùng cần OCR trực tiếp trên video',
    badge: 'Tuỳ chỉnh',
    badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  },
];

const DEFAULT_CUSTOM_REGION: OcrCustomRegion = {
  x: 0.05,
  y: 0.68,
  w: 0.90,
  h: 0.28,
};

export default function OcrConfigModal({
  isOpen,
  onClose,
  task,
  onStartOcr,
}: OcrConfigModalProps) {
  const [mode, setMode] = useState<OcrMode>('auto');
  const [language, setLanguage] = useState('vie');
  const [fps, setFps] = useState(2);
  const [dualEngine, setDualEngine] = useState(true);
  const [customRegion, setCustomRegion] = useState<OcrCustomRegion>(DEFAULT_CUSTOM_REGION);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Video preview & drawing state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);

  // Nạp cấu hình đã lưu từ SettingsStore khi mở modal
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined' || !window.vanhsub?.settings) return;

    Promise.all([
      window.vanhsub.settings.get('ocrMode'),
      window.vanhsub.settings.get('ocrLanguage'),
      window.vanhsub.settings.get('ocrFps'),
      window.vanhsub.settings.get('ocrDualEngine'),
      window.vanhsub.settings.get('ocrCustomRegion'),
    ])
      .then(([savedMode, savedLang, savedFps, savedDual, savedRegion]) => {
        if (savedMode && ['auto', 'bottom', 'full', 'custom'].includes(String(savedMode))) {
          setMode(savedMode as OcrMode);
        }
        if (savedLang) setLanguage(String(savedLang));
        if (savedFps) setFps(Number(savedFps) || 2);
        if (savedDual !== undefined) setDualEngine(Boolean(savedDual));
        if (savedRegion && typeof savedRegion === 'object') {
          setCustomRegion(savedRegion as OcrCustomRegion);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  const videoSrc = task?.filePath
    ? `vanhmedia://local/${encodeURIComponent(task.filePath)}`
    : '';

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 0);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setCurrentTime(val);
    if (videoRef.current) {
      videoRef.current.currentTime = val;
    }
  };

  // Vẽ vùng custom trên video preview
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== 'custom' || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    setIsDrawing(true);
    setDrawStart({ x, y });
    setCustomRegion({ x, y, w: 0.01, h: 0.01 });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !drawStart || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const currentY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    const x = Math.min(drawStart.x, currentX);
    const y = Math.min(drawStart.y, currentY);
    const w = Math.max(0.02, Math.abs(currentX - drawStart.x));
    const h = Math.max(0.02, Math.abs(currentY - drawStart.y));

    setCustomRegion({
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
      w: Number(w.toFixed(4)),
      h: Number(h.toFixed(4)),
    });
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    setDrawStart(null);
  };

  // Thiết lập vùng mẫu nhanh
  const setPresetRegion = (preset: 'bottom30' | 'bottom50' | 'full') => {
    if (preset === 'bottom30') {
      setCustomRegion({ x: 0.05, y: 0.68, w: 0.90, h: 0.28 });
    } else if (preset === 'bottom50') {
      setCustomRegion({ x: 0.05, y: 0.48, w: 0.90, h: 0.48 });
    } else if (preset === 'full') {
      setCustomRegion({ x: 0.01, y: 0.01, w: 0.98, h: 0.98 });
    }
  };

  const handleSubmit = async () => {
    if (!task) return;
    setIsSubmitting(true);
    try {
      // Lưu lại cài đặt vừa chọn để lần sau dùng tiếp
      if (typeof window !== 'undefined' && window.vanhsub?.settings) {
        await Promise.all([
          window.vanhsub.settings.set('ocrMode', mode),
          window.vanhsub.settings.set('ocrLanguage', language),
          window.vanhsub.settings.set('ocrFps', fps),
          window.vanhsub.settings.set('ocrDualEngine', dualEngine),
          window.vanhsub.settings.set('ocrCustomRegion', customRegion),
        ]).catch(() => {});
      }

      await onStartOcr({
        mode,
        customRegion: mode === 'custom' ? customRegion : null,
        language,
        fps,
        dualEngine,
      });

      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[94vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/95 p-6 text-xs text-slate-300 shadow-2xl backdrop-blur-xl animate-scale-in max-h-[92vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-cyan/10 border border-brand-cyan/30 text-brand-cyan shadow-sm">
                <ScanText className="h-5 w-5" />
              </div>
              <div>
                <Dialog.Title className="text-sm font-bold text-white">
                  Cấu hình Quét Phụ Đề Cứng (OCR)
                </Dialog.Title>
                <Dialog.Description className="text-xs text-slate-400 mt-0.5">
                  Chọn chế độ quét phụ đề hardsub từ video bằng AI
                  {task && <span className="text-slate-300 font-medium"> — {task.fileName}</span>}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={isSubmitting}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition cursor-pointer disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Content Body */}
          <div className="flex-1 overflow-y-auto py-4 space-y-5 pr-1">
            {/* Lựa chọn 4 chế độ OCR */}
            <div>
              <label className="mb-2 block font-semibold text-slate-200">
                OCR Mode (Chế độ quét)
              </label>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {OCR_MODES.map((item) => {
                  const isSelected = mode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setMode(item.id)}
                      className={`relative flex items-start gap-3 rounded-2xl border p-3.5 text-left transition cursor-pointer ${
                        isSelected
                          ? 'border-brand-cyan bg-brand-cyan/10 shadow-sm shadow-brand-cyan/20'
                          : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-600 bg-slate-800">
                        {isSelected && <div className="h-2 w-2 rounded-full bg-brand-cyan" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{item.label}</span>
                          {item.badge && (
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${
                                item.badgeColor || 'border-slate-700 text-slate-300'
                              }`}
                            >
                              {item.badge}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                          {item.desc}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Khung video preview khi chọn Custom */}
            {mode === 'custom' && (
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium text-slate-200">
                    <Crop className="h-4 w-4 text-purple-400" />
                    <span>Kéo thả chuột trên khung hình để chọn vùng quét</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-slate-400">Vùng mẫu:</span>
                    <button
                      type="button"
                      onClick={() => setPresetRegion('bottom30')}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer"
                    >
                      30% Đáy
                    </button>
                    <button
                      type="button"
                      onClick={() => setPresetRegion('bottom50')}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer"
                    >
                      50% Dưới
                    </button>
                    <button
                      type="button"
                      onClick={() => setPresetRegion('full')}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer"
                    >
                      Toàn khung
                    </button>
                  </div>
                </div>

                {/* Video và Bounding Box Canvas */}
                <div
                  ref={overlayRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-800 bg-black cursor-crosshair select-none flex items-center justify-center"
                >
                  {videoSrc ? (
                    <video
                      ref={videoRef}
                      src={videoSrc}
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedMetadata={handleLoadedMetadata}
                      className="h-full w-full object-contain pointer-events-none"
                    />
                  ) : (
                    <div className="text-slate-600">Không thể xem trước video</div>
                  )}

                  {/* Vùng chọn Bounding Box */}
                  <div
                    className="absolute pointer-events-none rounded border-2 border-brand-cyan bg-brand-cyan/20 shadow-lg shadow-brand-cyan/30 transition-all duration-75"
                    style={{
                      left: `${customRegion.x * 100}%`,
                      top: `${customRegion.y * 100}%`,
                      width: `${customRegion.w * 100}%`,
                      height: `${customRegion.h * 100}%`,
                    }}
                  >
                    <div className="absolute -top-5 left-0 rounded bg-brand-cyan px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-950 shadow">
                      Vùng quét OCR ({(customRegion.w * 100).toFixed(0)}% × {(customRegion.h * 100).toFixed(0)}%)
                    </div>
                  </div>
                </div>

                {/* Thanh điều khiển phát video để chọn frame có phụ đề */}
                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 cursor-pointer"
                  >
                    {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </button>

                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    step={0.1}
                    value={currentTime}
                    onChange={handleSeek}
                    className="flex-1 accent-brand-cyan h-1 bg-slate-800 rounded-lg cursor-pointer"
                  />

                  <span className="font-mono text-[11px] text-slate-400 shrink-0">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                {/* Toạ độ vùng chọn */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2 font-mono text-[11px] text-slate-400">
                  <span>
                    Toạ độ:{' '}
                    <strong className="text-white">
                      X: {(customRegion.x * 100).toFixed(1)}%, Y: {(customRegion.y * 100).toFixed(1)}%
                    </strong>{' '}
                    | Kích thước:{' '}
                    <strong className="text-brand-cyan">
                      W: {(customRegion.w * 100).toFixed(1)}%, H: {(customRegion.h * 100).toFixed(1)}%
                    </strong>
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Kéo chuột trên video bất kỳ lúc nào để vẽ lại
                  </span>
                </div>
              </div>
            )}

            {/* Các tuỳ chọn nâng cao */}
            <div className="grid gap-4 sm:grid-cols-2 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <div>
                <label className="mb-1.5 block font-medium text-slate-200">Ngôn ngữ quét (OCR)</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <option value="vie">Tiếng Việt</option>
                  <option value="eng">English</option>
                  <option value="vie+eng">Việt + Anh (song ngữ)</option>
                  <option value="chi_sim">Chinese (Giản thể)</option>
                  <option value="chi_tra">Chinese (Phồn thể)</option>
                  <option value="jpn">Japanese</option>
                  <option value="kor">Korean</option>
                  <option value="tha">Thai</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block font-medium text-slate-200">Tốc độ quét (FPS)</label>
                <select
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <option value={1}>1 khung / giây (Nhanh nhất)</option>
                  <option value={2}>2 khung / giây (Chuẩn — khuyên dùng)</option>
                  <option value={3}>3 khung / giây (Chính xác cao, chậm hơn)</option>
                </select>
              </div>

              <div className="sm:col-span-2 pt-1">
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-900/60 p-2.5">
                  <input
                    type="checkbox"
                    checked={dualEngine}
                    onChange={(e) => setDualEngine(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500 rounded"
                  />
                  <div>
                    <span className="font-semibold text-slate-200 block">
                      Đối chiếu 2 engine (PaddleOCR + Tesseract)
                    </span>
                    <span className="text-[11px] text-slate-400 block mt-0.5">
                      So sánh kết quả của cả 2 engine trên cùng vùng chữ để tăng độ chính xác (khuyên dùng khi nền phim bận rộn).
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition cursor-pointer disabled:opacity-50"
            >
              Huỷ
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleSubmit}
              className="btn-vanh-gradient inline-flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-semibold cursor-pointer shadow-lg shadow-brand-indigo/20 hover:opacity-95 transition disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ScanText className="h-4 w-4" />
              )}
              <span>{isSubmitting ? 'Đang khởi động...' : 'Bắt đầu quét OCR'}</span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
