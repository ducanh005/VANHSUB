import React from 'react';
import {
  ShieldAlert,
  Image as ImageIcon,
  Type,
  FolderOpen,
  Clock,
  Layers,
  Sparkles,
  Eye,
} from 'lucide-react';
import type { CustomMaskRegion, WatermarkOptions } from '../../types/electron';

interface OverlayMaskEditorProps {
  customMask: CustomMaskRegion;
  customMaskEnabled: boolean;
  onToggleMask: (enabled: boolean) => void;
  onChangeMask: (partial: Partial<CustomMaskRegion>) => void;

  watermark: WatermarkOptions;
  watermarkEnabled: boolean;
  onToggleWatermark: (enabled: boolean) => void;
  onChangeWatermark: (partial: Partial<WatermarkOptions>) => void;

  currentVideoTime?: number;
}

export const OverlayMaskEditor: React.FC<OverlayMaskEditorProps> = ({
  customMask,
  customMaskEnabled,
  onToggleMask,
  onChangeMask,
  watermark,
  watermarkEnabled,
  onToggleWatermark,
  onChangeWatermark,
  currentVideoTime = 0,
}) => {
  const handleSelectImage = async () => {
    if (!window.vanhsub?.dialog?.openImageFile) return;
    const selected = await window.vanhsub.dialog.openImageFile();
    if (selected) {
      onChangeWatermark({ content: selected, type: 'image' });
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* 1. Vùng che mờ tự do (Bounding Box Mask) */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-brand-cyan" />
            <span className="text-xs font-semibold text-slate-200">
              Vùng che mờ tự do (Bounding Box Mask)
            </span>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={customMaskEnabled}
              onChange={(e) => onToggleMask(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-cyan"></div>
          </label>
        </div>

        {customMaskEnabled ? (
          <div className="flex flex-col gap-3">
            {/* Kiểu che */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Kiểu che:</span>
              <div className="flex rounded-lg border border-slate-700 bg-slate-800/80 p-0.5">
                {(['blur', 'pixelate', 'solid'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onChangeMask({ mode })}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                      customMask.mode === mode
                        ? 'bg-brand-cyan/20 text-brand-cyan shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {mode === 'blur'
                      ? 'Làm mờ (Blur)'
                      : mode === 'pixelate'
                      ? 'Điểm ảnh (Pixelate)'
                      : 'Tô đen (Solid)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Tọa độ X, Y (%) */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Vị trí X (Trái):</span>
                  <span className="font-mono text-brand-cyan">{customMask.xPercent}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={90}
                  value={customMask.xPercent}
                  onChange={(e) => onChangeMask({ xPercent: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Vị trí Y (Đỉnh):</span>
                  <span className="font-mono text-brand-cyan">{customMask.yPercent}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={90}
                  value={customMask.yPercent}
                  onChange={(e) => onChangeMask({ yPercent: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
              </div>
            </div>

            {/* Chiều rộng W, Chiều cao H (%) */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Chiều rộng (W):</span>
                  <span className="font-mono text-brand-cyan">{customMask.widthPercent}%</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={customMask.widthPercent}
                  onChange={(e) => onChangeMask({ widthPercent: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Chiều cao (H):</span>
                  <span className="font-mono text-brand-cyan">{customMask.heightPercent}%</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={customMask.heightPercent}
                  onChange={(e) => onChangeMask({ heightPercent: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
              </div>
            </div>

            {/* Cường độ che (Intensity) */}
            {customMask.mode !== 'solid' && (
              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Cường độ hiệu ứng:</span>
                  <span className="font-mono text-brand-cyan">{customMask.intensity ?? 40}</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={customMask.intensity ?? 40}
                  onChange={(e) => onChangeMask({ intensity: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
              </div>
            )}

            {/* Khung thời gian hiệu lực */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-slate-300">
                  Thời gian áp dụng (giây):
                </span>
                <span className="text-[10px] text-slate-500">
                  (Bỏ trống / 0 để áp dụng toàn video)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-400">Từ:</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder="0s"
                    value={customMask.startSec ?? ''}
                    onChange={(e) =>
                      onChangeMask({
                        startSec: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                  />
                  <button
                    type="button"
                    onClick={() => onChangeMask({ startSec: Math.round(currentVideoTime * 10) / 10 })}
                    className="p-1 rounded bg-slate-800 text-slate-400 hover:text-brand-cyan transition"
                    title="Lấy thời gian hiện tại của video"
                  >
                    <Clock className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-400">Đến:</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder="Hết"
                    value={customMask.endSec ?? ''}
                    onChange={(e) =>
                      onChangeMask({
                        endSec: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                  />
                  <button
                    type="button"
                    onClick={() => onChangeMask({ endSec: Math.round(currentVideoTime * 10) / 10 })}
                    className="p-1 rounded bg-slate-800 text-slate-400 hover:text-brand-cyan transition"
                    title="Lấy thời gian hiện tại của video"
                  >
                    <Clock className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-slate-500 py-2">
            Bật tính năng này nếu video có logo, chữ quảng cáo hoặc phụ đề cũ cần che mờ tại tọa độ cụ thể.
          </p>
        )}
      </div>

      {/* 2. Watermark / Logo thương hiệu */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-brand-cyan" />
            <span className="text-xs font-semibold text-slate-200">
              Watermark / Logo thương hiệu
            </span>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={watermarkEnabled}
              onChange={(e) => onToggleWatermark(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-cyan"></div>
          </label>
        </div>

        {watermarkEnabled ? (
          <div className="flex flex-col gap-3">
            {/* Loại watermark: Text vs Image */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Loại:</span>
              <div className="flex rounded-lg border border-slate-700 bg-slate-800/80 p-0.5">
                <button
                  type="button"
                  onClick={() => onChangeWatermark({ type: 'text' })}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                    watermark.type === 'text'
                      ? 'bg-brand-cyan/20 text-brand-cyan shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Type className="h-3 w-3" />
                  <span>Văn bản</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeWatermark({ type: 'image' })}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                    watermark.type === 'image'
                      ? 'bg-brand-cyan/20 text-brand-cyan shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <ImageIcon className="h-3 w-3" />
                  <span>Hình ảnh / Logo</span>
                </button>
              </div>
            </div>

            {/* Nội dung text hoặc chọn ảnh */}
            {watermark.type === 'text' ? (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-400">
                  Nội dung chữ:
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: @vanhsub_official"
                  value={watermark.content || ''}
                  onChange={(e) => onChangeWatermark({ content: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-brand-cyan/60 focus:outline-none"
                />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-400">
                  File ảnh logo (PNG, JPG, WebP):
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectImage}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition cursor-pointer shrink-0"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-brand-cyan" />
                    <span>Chọn ảnh...</span>
                  </button>
                  <span
                    className="flex-1 truncate font-mono text-[11px] text-slate-400"
                    title={watermark.content}
                  >
                    {watermark.content
                      ? watermark.content.split(/[/\\]/).pop()
                      : 'Chưa chọn file'}
                  </span>
                </div>
              </div>
            )}

            {/* Vị trí watermark (5 góc) */}
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-slate-400">Vị trí:</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'top_left', label: 'Trên Trái' },
                  { id: 'center', label: 'Chính Giữa' },
                  { id: 'top_right', label: 'Trên Phải' },
                  { id: 'bottom_left', label: 'Dưới Trái' },
                  { id: 'bottom_right', label: 'Dưới Phải' },
                ].map((pos) => (
                  <button
                    key={pos.id}
                    type="button"
                    onClick={() => onChangeWatermark({ position: pos.id as any })}
                    className={`rounded-lg border px-2 py-1.5 text-center text-[11px] font-medium transition cursor-pointer ${
                      watermark.position === pos.id
                        ? 'border-brand-cyan/70 bg-brand-cyan/15 text-brand-cyan'
                        : 'border-slate-800 bg-slate-800/60 text-slate-400 hover:text-white'
                    }`}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Độ mờ (Opacity) & Tỉ lệ kích thước (Scale) */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Độ mờ (Opacity):</span>
                  <span className="font-mono text-brand-cyan">
                    {Math.round((watermark.opacity ?? 0.8) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round((watermark.opacity ?? 0.8) * 100)}
                  onChange={(e) => onChangeWatermark({ opacity: Number(e.target.value) / 100 })}
                  className="w-full accent-cyan-400"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                  <span>Kích thước tỉ lệ:</span>
                  <span className="font-mono text-brand-cyan">
                    {watermark.scalePercent ?? 18}%
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={45}
                  value={watermark.scalePercent ?? 18}
                  onChange={(e) => onChangeWatermark({ scalePercent: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-slate-500 py-2">
            Bật tính năng này để chèn logo công ty, kênh TikTok, YouTube hoặc watermark bản quyền lên video.
          </p>
        )}
      </div>
    </div>
  );
};
