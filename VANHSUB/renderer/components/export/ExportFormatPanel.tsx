import React from 'react';
import { Film, Smartphone, Square, Monitor, Sparkles, Cpu, Gauge, HardDrive, FlipHorizontal } from 'lucide-react';
import type { ExportFormatOptions } from '../../types/electron';

interface ExportFormatPanelProps {
  formatOptions: ExportFormatOptions;
  onChangeFormat: (partial: Partial<ExportFormatOptions>) => void;
  videoDurationSec?: number;
}

export const ExportFormatPanel: React.FC<ExportFormatPanelProps> = ({
  formatOptions,
  onChangeFormat,
  videoDurationSec = 60,
}) => {
  const currentRatio = formatOptions.aspectRatio || 'original';
  const currentFps = formatOptions.fps || 0; // 0 = auto
  const currentBitrate = formatOptions.bitrateKbps || 0; // 0 = auto
  const currentResolution = formatOptions.resolution || 'original';
  const currentCodec = formatOptions.videoCodec || 'libx264';
  const currentSpeed = formatOptions.speed && formatOptions.speed >= 1.0 ? formatOptions.speed : 1.0;

  // Ước tính dung lượng file: (bitrate_kbps * duration_s) / 8 / 1024 (MB)
  // Tính đến tốc độ tua nhanh: effectiveDuration = duration / speed
  const effectiveDuration = (videoDurationSec || 60) / currentSpeed;
  const estBitrate = currentBitrate > 0 ? currentBitrate : 4500;
  const estimatedSizeMb = Math.max(1, Math.round((estBitrate * effectiveDuration) / 8 / 1024));

  const ASPECT_RATIOS = [
    {
      id: 'original',
      label: 'Gốc (Original)',
      desc: 'Giữ nguyên video nguồn',
      icon: Monitor,
    },
    {
      id: '16:9',
      label: '16:9 (Ngang)',
      desc: 'YouTube, TV, Laptop',
      icon: Film,
    },
    {
      id: '9:16',
      label: '9:16 (Dọc TikTok)',
      desc: 'TikTok, Shorts, Reels',
      icon: Smartphone,
    },
    {
      id: '1:1',
      label: '1:1 (Vuông)',
      desc: 'Facebook, Instagram',
      icon: Square,
    },
  ];

  const SPEED_PRESETS = [1.00, 1.05, 1.10, 1.25, 1.50, 2.00];

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-brand-cyan" />
          <h3 className="text-xs font-semibold text-slate-200">
            Tùy chọn Định dạng & Tỉ lệ Khung hình (Export Presets)
          </h3>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-0.5 text-[11px] font-mono text-slate-300">
          <HardDrive className="h-3 w-3 text-brand-cyan" />
          <span>Ước tính: ~{estimatedSizeMb} MB</span>
        </div>
      </div>

      {/* 1. Chọn tỉ lệ khung hình (Aspect Ratio) */}
      <div>
        <label className="mb-2 block text-xs font-medium text-slate-300">
          Tỉ lệ khung hình (Aspect Ratio):
        </label>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {ASPECT_RATIOS.map((item) => {
            const Icon = item.icon;
            const active = currentRatio === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeFormat({ aspectRatio: item.id as any })}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition cursor-pointer ${
                  active
                    ? 'border-brand-cyan/80 bg-brand-cyan/15 ring-1 ring-brand-cyan/50 text-white'
                    : 'border-slate-800 bg-slate-800/50 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? 'text-brand-cyan' : 'text-slate-400'}`} />
                <span className="text-xs font-semibold">{item.label}</span>
                <span className="text-[10px] text-slate-500 leading-tight">{item.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Cài đặt chi tiết: Độ phân giải, FPS, Bitrate, Codec */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 pt-1">
        {/* Độ phân giải */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-400">
            Độ phân giải:
          </label>
          <select
            value={currentResolution}
            onChange={(e) => onChangeFormat({ resolution: e.target.value as any })}
            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
          >
            <option value="original">Gốc (Auto)</option>
            <option value="1080p">1080p Full HD</option>
            <option value="720p">720p HD</option>
            <option value="480p">480p SD</option>
          </select>
        </div>

        {/* FPS */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-400">
            Khung hình (FPS):
          </label>
          <select
            value={currentFps}
            onChange={(e) => onChangeFormat({ fps: Number(e.target.value) || undefined })}
            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
          >
            <option value={0}>Tự động (Theo video gốc)</option>
            <option value={24}>24 fps (Điện ảnh Cinematic)</option>
            <option value={30}>30 fps (Tiêu chuẩn Video)</option>
            <option value={60}>60 fps (Mượt mà TikTok/Reels)</option>
          </select>
        </div>

        {/* Bitrate */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-400">
            Bitrate (Chất lượng):
          </label>
          <select
            value={currentBitrate}
            onChange={(e) => onChangeFormat({ bitrateKbps: Number(e.target.value) || undefined })}
            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
          >
            <option value={0}>Tự động (CRF 23)</option>
            <option value={4000}>4,000 kbps (1080p chuẩn)</option>
            <option value={8000}>8,000 kbps (1080p sắc nét)</option>
            <option value={16000}>16,000 kbps (Cực nét 2K/4K)</option>
          </select>
        </div>

        {/* Video Codec */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-400">
            Bộ mã hóa (Codec):
          </label>
          <select
            value={currentCodec}
            onChange={(e) => onChangeFormat({ videoCodec: e.target.value as any })}
            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
          >
            <option value="libx264">H.264 (libx264 — Tương thích cao)</option>
            <option value="libx265">H.265 / HEVC (libx265 — Nén sâu)</option>
          </select>
        </div>
      </div>

      {/* 3. Bộ công cụ CapCut Mini (Mirror & Speed) */}
      <div className="flex flex-col gap-3 rounded-xl border border-cyan-500/20 bg-slate-950/40 p-3.5">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-brand-cyan" />
            <span className="text-xs font-semibold text-slate-200">
              Bộ công cụ CapCut Mini (Lật gương & Tua nhanh)
            </span>
          </div>
          <span className="rounded bg-brand-cyan/10 px-2 py-0.5 text-[10px] font-mono text-brand-cyan border border-brand-cyan/20">
            Chống quét bản quyền & Tăng tốc
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {/* A. Phản chiếu gương ngang (Horizontal Mirror) */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div
                  className={`p-2 rounded-lg border transition ${
                    formatOptions.mirrorHorizontal
                      ? 'border-brand-cyan/60 bg-brand-cyan/20 text-brand-cyan shadow-sm shadow-cyan-500/20'
                      : 'border-slate-800 bg-slate-800 text-slate-400'
                  }`}
                >
                  <FlipHorizontal className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    Phản chiếu gương / Lật ngang video
                  </div>
                  <div className="text-[10px] text-slate-400 leading-tight mt-0.5">
                    Lật ngang video gốc; phụ đề mới và watermark giữ nguyên chiều xuôi
                  </div>
                </div>
              </div>

              {/* Toggle Switch */}
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(formatOptions.mirrorHorizontal)}
                onClick={() =>
                  onChangeFormat({ mirrorHorizontal: !formatOptions.mirrorHorizontal })
                }
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  formatOptions.mirrorHorizontal ? 'bg-brand-cyan' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    formatOptions.mirrorHorizontal ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="mt-2 text-[10px] text-slate-500 flex items-center gap-1.5">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  formatOptions.mirrorHorizontal
                    ? 'bg-brand-cyan animate-pulse'
                    : 'bg-slate-600'
                }`}
              />
              <span>
                Trạng thái:{' '}
                {formatOptions.mirrorHorizontal
                  ? 'Đang bật lật gương ngang'
                  : 'Tắt (Video gốc)'}
              </span>
            </div>
          </div>

          {/* B. Tua nhanh video (Speedup 1.00x - 2.00x) */}
          <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Gauge className="h-4 w-4 text-brand-cyan" />
                <span className="text-xs font-semibold text-slate-200">
                  Tốc độ phát (Speed):
                </span>
              </div>

              {/* Direct number input (step 0.01, supporting 1.02, 1.03, etc.) */}
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1.00}
                  max={2.00}
                  step={0.01}
                  value={Number((formatOptions.speed || 1.00).toFixed(2))}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      const clamped = Math.max(1.00, Math.min(2.00, Math.round(val * 100) / 100));
                      onChangeFormat({ speed: clamped });
                    }
                  }}
                  className="w-16 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-center font-mono text-xs font-bold text-brand-cyan focus:outline-none focus:border-brand-cyan"
                />
                <span className="text-xs font-mono text-slate-400">x</span>
              </div>
            </div>

            {/* Speed Slider */}
            <div className="flex items-center gap-2 pt-0.5">
              <input
                type="range"
                min={1.00}
                max={2.00}
                step={0.01}
                value={formatOptions.speed || 1.00}
                onChange={(e) =>
                  onChangeFormat({ speed: parseFloat(e.target.value) })
                }
                className="flex-1 accent-cyan-400 cursor-pointer h-1.5 bg-slate-700 rounded-lg"
              />
            </div>

            {/* Quick Select Buttons */}
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <span className="text-[10px] text-slate-400 mr-0.5">Mốc:</span>
              {SPEED_PRESETS.map((presetSpeed) => {
                const current = formatOptions.speed || 1.00;
                const isActive = Math.abs(current - presetSpeed) < 0.005;
                return (
                  <button
                    key={presetSpeed}
                    type="button"
                    onClick={() => onChangeFormat({ speed: presetSpeed })}
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition cursor-pointer ${
                      isActive
                        ? 'border border-brand-cyan bg-brand-cyan/25 text-brand-cyan font-bold ring-1 ring-brand-cyan/40'
                        : 'border border-slate-800 bg-slate-800/80 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    {presetSpeed.toFixed(2)}x
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
