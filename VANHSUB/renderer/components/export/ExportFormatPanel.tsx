import React from 'react';
import { Film, Smartphone, Square, Monitor, Sparkles, Cpu, Gauge, HardDrive } from 'lucide-react';
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

  // Ước tính dung lượng file: (bitrate_kbps * duration_s) / 8 / 1024 (MB)
  const estBitrate = currentBitrate > 0 ? currentBitrate : 4500;
  const estimatedSizeMb = Math.max(1, Math.round((estBitrate * (videoDurationSec || 60)) / 8 / 1024));

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
    </div>
  );
};
