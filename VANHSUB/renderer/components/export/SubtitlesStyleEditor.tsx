import React, { useState, useEffect } from 'react';
import {
  Palette,
  Search,
  RotateCcw,
  Sparkles,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Check,
  Trash2,
  Copy,
  ClipboardPaste,
  Bookmark,
  BookmarkPlus,
  CheckSquare,
  Square,
  X,
} from 'lucide-react';
import type { SrtLine } from '../../lib/srt';
import { formatMs } from '../../lib/srt';
import type { PerLineSubtitleStyle } from '../../types/electron';

interface SavedStylePreset {
  id: string;
  name: string;
  style: PerLineSubtitleStyle;
}

const DEFAULT_SAVED_PRESETS: SavedStylePreset[] = [
  {
    id: 'preset_yellow_tiktok',
    name: 'Vàng TikTok',
    style: {
      textColorHex: '#FFE135',
      outlineColorHex: '#000000',
      outlineWidth: 3,
      fontSize: 26,
      bold: true,
      italic: false,
      alignment: 2,
    },
  },
  {
    id: 'preset_red_alert',
    name: 'Đỏ nhấn mạnh',
    style: {
      textColorHex: '#FF3B30',
      outlineColorHex: '#000000',
      outlineWidth: 3,
      fontSize: 26,
      bold: true,
      italic: false,
      alignment: 2,
    },
  },
  {
    id: 'preset_cyan_neon',
    name: 'Xanh Neon',
    style: {
      textColorHex: '#00F5FF',
      outlineColorHex: '#001A26',
      outlineWidth: 3,
      fontSize: 24,
      bold: true,
      italic: false,
      alignment: 2,
    },
  },
  {
    id: 'preset_white_clean',
    name: 'Trắng viền đậm',
    style: {
      textColorHex: '#FFFFFF',
      outlineColorHex: '#101010',
      outlineWidth: 4,
      fontSize: 24,
      bold: true,
      italic: false,
      alignment: 2,
    },
  },
];

const PRESETS_STORAGE_KEY = 'vanhsub_saved_line_presets';

interface SubtitlesStyleEditorProps {
  lines: SrtLine[];
  perLineStyles: Record<number, PerLineSubtitleStyle>;
  onUpdateLineStyle: (lineIndex: number, style: PerLineSubtitleStyle | null) => void;
  onBatchApplyStyles: (style: PerLineSubtitleStyle) => void;
  onClearAllStyles: () => void;
  selectedIndex: number | null;
  onSelectLine: (index: number) => void;
}

export const SubtitlesStyleEditor: React.FC<SubtitlesStyleEditorProps> = ({
  lines,
  perLineStyles,
  onUpdateLineStyle,
  onBatchApplyStyles,
  onClearAllStyles,
  selectedIndex,
  onSelectLine,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  // Bộ nhớ tạm để sao chép / dán style riêng lẻ
  const [copiedStyle, setCopiedStyle] = useState<PerLineSubtitleStyle | null>(null);
  const [copiedFromIdx, setCopiedFromIdx] = useState<number | null>(null);

  // Danh sách mẫu style đã lưu
  const [savedPresets, setSavedPresets] = useState<SavedStylePreset[]>(DEFAULT_SAVED_PRESETS);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');

  // Danh sách các câu được tích chọn checkbox để áp dụng hàng loạt riêng lẻ
  const [selectedMultiIndices, setSelectedMultiIndices] = useState<Set<number>>(new Set());

  // Tải mẫu đã lưu từ localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PRESETS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSavedPresets(parsed);
        }
      }
    } catch {
      // bỏ qua lỗi parse
    }
  }, []);

  const savePresetsToStorage = (presets: SavedStylePreset[]) => {
    setSavedPresets(presets);
    try {
      localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
    } catch {}
  };

  // Local draft state cho câu đang được chọn
  const activeStyle: PerLineSubtitleStyle =
    selectedIndex !== null && perLineStyles[selectedIndex]
      ? perLineStyles[selectedIndex]
      : {
          textColorHex: '#FFFFFF',
          outlineColorHex: '#000000',
          outlineWidth: 2,
          fontSize: 24,
          bold: false,
          italic: false,
          alignment: 2,
        };

  const filteredLines = lines
    .map((l, idx) => ({ ...l, originalIdx: idx }))
    .filter((l) => l.text.toLowerCase().includes(searchTerm.toLowerCase()));

  const handleStyleChange = (partial: Partial<PerLineSubtitleStyle>) => {
    if (selectedIndex === null) return;
    const updated = {
      ...activeStyle,
      ...partial,
    };
    onUpdateLineStyle(selectedIndex, updated);
  };

  // Sao chép style từ câu hiện tại
  const handleCopyCurrentStyle = () => {
    if (selectedIndex === null) return;
    setCopiedStyle({ ...activeStyle });
    setCopiedFromIdx(selectedIndex);
  };

  // Dán style đã chép cho 1 câu cụ thể
  const handlePasteToLine = (targetIdx: number) => {
    if (!copiedStyle) return;
    onUpdateLineStyle(targetIdx, { ...copiedStyle });
  };

  // Lưu style hiện tại thành mẫu mới
  const handleSaveCurrentAsPreset = () => {
    if (!newPresetName.trim()) return;
    const newPreset: SavedStylePreset = {
      id: `preset_${Date.now()}`,
      name: newPresetName.trim(),
      style: { ...activeStyle },
    };
    const updated = [...savedPresets, newPreset];
    savePresetsToStorage(updated);
    setNewPresetName('');
    setIsSavingPreset(false);
  };

  // Xóa 1 mẫu đã lưu
  const handleDeletePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedPresets.filter((p) => p.id !== id);
    savePresetsToStorage(updated);
  };

  // Áp dụng mẫu đã lưu cho câu hiện tại (hoặc các câu đã tích checkbox)
  const handleApplyPreset = (presetStyle: PerLineSubtitleStyle) => {
    if (selectedMultiIndices.size > 0) {
      selectedMultiIndices.forEach((idx) => {
        onUpdateLineStyle(idx, { ...presetStyle });
      });
      return;
    }
    if (selectedIndex !== null) {
      onUpdateLineStyle(selectedIndex, { ...presetStyle });
    }
  };

  // Toggle tích chọn checkbox của 1 câu
  const handleToggleMultiSelect = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedMultiIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  // Áp dụng style câu hiện tại cho tất cả các câu đã tích checkbox
  const handleApplyToMultiChecked = () => {
    if (selectedMultiIndices.size === 0) return;
    selectedMultiIndices.forEach((idx) => {
      onUpdateLineStyle(idx, { ...activeStyle });
    });
  };

  // Dán style đã chép cho tất cả các câu đã tích checkbox
  const handlePasteToMultiChecked = () => {
    if (!copiedStyle || selectedMultiIndices.size === 0) return;
    selectedMultiIndices.forEach((idx) => {
      onUpdateLineStyle(idx, { ...copiedStyle });
    });
  };

  // Xóa style riêng của các câu đã tích checkbox
  const handleClearMultiCheckedStyles = () => {
    selectedMultiIndices.forEach((idx) => {
      onUpdateLineStyle(idx, null);
    });
  };

  const customCount = Object.keys(perLineStyles).length;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-brand-cyan" />
          <h3 className="text-xs font-semibold text-slate-200">
            Tùy biến Style từng câu thoại (Mini CapCut)
          </h3>
          {customCount > 0 && (
            <span className="rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2 py-0.5 text-[10px] font-semibold text-brand-cyan">
              {customCount} câu đã đổi style
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {customCount > 0 && (
            <button
              type="button"
              onClick={onClearAllStyles}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-400 hover:border-rose-500/50 hover:bg-rose-500/10 hover:text-rose-300 transition cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Khôi phục mặc định tất cả</span>
            </button>
          )}
        </div>
      </div>

      {/* Dải Mẫu Style Đã Lưu (Saved Style Presets Bar) */}
      <div className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
            <Bookmark className="h-3.5 w-3.5 text-amber-400" />
            <span>Mẫu style đã lưu (Click để áp nhanh cho câu đang chọn):</span>
          </div>

          {selectedIndex !== null && (
            <div>
              {isSavingPreset ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Tên mẫu..."
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveCurrentAsPreset()}
                    autoFocus
                    className="w-32 rounded-lg border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-white focus:outline-none focus:border-brand-cyan"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCurrentAsPreset}
                    className="rounded-lg bg-brand-cyan/20 px-2 py-0.5 text-xs font-semibold text-brand-cyan hover:bg-brand-cyan/30"
                  >
                    Lưu
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsSavingPreset(false)}
                    className="p-0.5 text-slate-400 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsSavingPreset(true);
                    setNewPresetName(`Mẫu style #${savedPresets.length + 1}`);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/90 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-slate-700 transition cursor-pointer"
                >
                  <BookmarkPlus className="h-3 w-3 text-amber-400" />
                  <span>Lưu style câu #{selectedIndex + 1} thành mẫu</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Danh sách các chip preset */}
        <div className="flex flex-wrap items-center gap-2">
          {savedPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleApplyPreset(preset.style)}
              className="group flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-300 hover:border-brand-cyan/60 hover:bg-slate-800 transition cursor-pointer"
              title="Nhấp để áp dụng style này cho câu đang chọn"
            >
              <div
                style={{
                  backgroundColor: preset.style.textColorHex || '#FFFFFF',
                  borderColor: preset.style.outlineColorHex || '#000000',
                }}
                className="h-3 w-3 rounded-full border shadow-sm shrink-0"
              />
              <span className="font-medium text-slate-200 group-hover:text-white">
                {preset.name}
              </span>
              <span
                style={{
                  color: preset.style.textColorHex || '#FFFFFF',
                  textShadow: `0 0 2px ${preset.style.outlineColorHex || '#000000'}`,
                  fontWeight: preset.style.bold ? 700 : 400,
                }}
                className="text-[11px] font-mono ml-0.5"
              >
                Aa
              </span>
              {preset.id.startsWith('preset_') && !DEFAULT_SAVED_PRESETS.some((d) => d.id === preset.id) && (
                <span
                  onClick={(e) => handleDeletePreset(preset.id, e)}
                  className="text-slate-500 hover:text-rose-400 p-0.5 ml-1"
                  title="Xóa mẫu này"
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* CỘT TRÁI: Danh sách các câu thoại */}
        <div className="flex flex-col gap-2 lg:col-span-6">
          <div className="flex items-center justify-between gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Tìm kiếm nội dung câu thoại..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-800/90 pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-brand-cyan/60 focus:outline-none"
              />
            </div>

            {copiedStyle && (
              <div className="flex items-center gap-1 rounded-lg border border-brand-cyan/40 bg-brand-cyan/10 px-2 py-1 text-[11px] text-brand-cyan font-mono shrink-0">
                <Copy className="h-3 w-3" />
                <span>Đã chép #{copiedFromIdx !== null ? copiedFromIdx + 1 : ''}</span>
              </div>
            )}
          </div>

          {/* Thanh tác vụ khi tích chọn nhiều checkbox câu */}
          {selectedMultiIndices.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-indigo/40 bg-brand-indigo/15 p-2 px-3">
              <span className="text-xs font-semibold text-brand-cyan">
                Đã tích chọn {selectedMultiIndices.size} câu
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {selectedIndex !== null && (
                  <button
                    type="button"
                    onClick={handleApplyToMultiChecked}
                    className="rounded-lg bg-brand-cyan/20 px-2.5 py-1 text-[11px] font-medium text-brand-cyan hover:bg-brand-cyan/30 transition cursor-pointer"
                  >
                    Áp style câu #{selectedIndex + 1}
                  </button>
                )}
                {copiedStyle && (
                  <button
                    type="button"
                    onClick={handlePasteToMultiChecked}
                    className="flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/30 transition cursor-pointer"
                  >
                    <ClipboardPaste className="h-3 w-3" />
                    <span>Dán style đã chép</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClearMultiCheckedStyles}
                  className="rounded-lg bg-slate-800 px-2 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-500/20 transition cursor-pointer"
                  title="Xóa style riêng của các câu này"
                >
                  Xóa style
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMultiIndices(new Set())}
                  className="p-1 text-slate-400 hover:text-white"
                  title="Bỏ chọn"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Danh sách các câu */}
          <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 p-1 divide-y divide-slate-800/40">
            {filteredLines.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                {lines.length === 0 ? 'Chưa tải được câu thoại' : 'Không tìm thấy câu phù hợp'}
              </div>
            ) : (
              filteredLines.map((line) => {
                const isSelected = selectedIndex === line.originalIdx;
                const hasCustom = !!perLineStyles[line.originalIdx];
                const isChecked = selectedMultiIndices.has(line.originalIdx);
                const lineCustomStyle = perLineStyles[line.originalIdx];

                return (
                  <div
                    key={line.originalIdx}
                    onClick={() => onSelectLine(line.originalIdx)}
                    className={`group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition cursor-pointer ${
                      isSelected
                        ? 'bg-brand-cyan/15 ring-1 ring-brand-cyan/50 text-white'
                        : 'hover:bg-slate-800/60 text-slate-300'
                    }`}
                  >
                    {/* Checkbox multi-select */}
                    <button
                      type="button"
                      onClick={(e) => handleToggleMultiSelect(line.originalIdx, e)}
                      className="shrink-0 mt-0.5 text-slate-500 hover:text-brand-cyan transition"
                      title="Tích chọn câu này để áp dụng hàng loạt"
                    >
                      {isChecked ? (
                        <CheckSquare className="h-3.5 w-3.5 text-brand-cyan" />
                      ) : (
                        <Square className="h-3.5 w-3.5" />
                      )}
                    </button>

                    <span className="shrink-0 font-mono text-[10px] text-slate-500 mt-0.5">
                      #{line.originalIdx + 1}
                    </span>

                    <div className="flex-1 min-w-0">
                      <p
                        style={
                          hasCustom && lineCustomStyle
                            ? {
                                color: lineCustomStyle.textColorHex,
                                fontWeight: lineCustomStyle.bold ? 700 : 400,
                              }
                            : {}
                        }
                        className="truncate text-xs"
                      >
                        {line.text}
                      </p>
                      <span className="text-[10px] font-mono text-slate-500">
                        {formatMs(line.startMs).split(',')[0]} → {formatMs(line.endMs).split(',')[0]}
                      </span>
                    </div>

                    {/* Quick 1-click Paste Button on row */}
                    {copiedStyle && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePasteToLine(line.originalIdx);
                        }}
                        className="opacity-0 group-hover:opacity-100 flex items-center gap-1 rounded bg-slate-800/90 border border-slate-700 px-1.5 py-0.5 text-[10px] text-brand-cyan hover:bg-brand-cyan hover:text-black transition"
                        title={`Áp dụng style đã chép (từ câu #${copiedFromIdx !== null ? copiedFromIdx + 1 : ''}) cho câu này`}
                      >
                        <ClipboardPaste className="h-3 w-3" />
                        <span>Dán</span>
                      </button>
                    )}

                    {hasCustom && (
                      <span
                        className="shrink-0 h-2 w-2 rounded-full bg-brand-cyan mt-1.5"
                        title="Dòng này có style riêng"
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* CỘT PHẢI: Bảng điều khiển style câu được chọn */}
        <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-800/40 p-3.5 lg:col-span-6">
          {selectedIndex === null ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-xs text-slate-500">
              <Sparkles className="h-6 w-6 text-slate-600 mb-2" />
              <span>Chọn một câu thoại bên trái để chỉnh màu sắc, cỡ chữ và sao chép áp dụng riêng lẻ.</span>
            </div>
          ) : (
            <>
              {/* Header câu chọn + Action Buttons (Sao chép, Dán, Xóa) */}
              <div className="flex items-center justify-between border-b border-slate-700/60 pb-2">
                <span className="text-xs font-semibold text-brand-cyan">
                  Chỉnh câu #{selectedIndex + 1}
                </span>

                <div className="flex items-center gap-1.5">
                  {/* Nút Sao Chép Style */}
                  <button
                    type="button"
                    onClick={handleCopyCurrentStyle}
                    className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-300 hover:border-brand-cyan/60 hover:text-brand-cyan transition cursor-pointer"
                    title="Sao chép toàn bộ màu chữ, cỡ chữ, viền của câu này"
                  >
                    <Copy className="h-3 w-3 text-brand-cyan" />
                    <span>Sao chép</span>
                  </button>

                  {/* Nút Dán Style */}
                  {copiedStyle && (
                    <button
                      type="button"
                      onClick={() => handlePasteToLine(selectedIndex)}
                      className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 transition cursor-pointer"
                      title={`Dán style đã sao chép từ câu #${copiedFromIdx !== null ? copiedFromIdx + 1 : ''}`}
                    >
                      <ClipboardPaste className="h-3 w-3" />
                      <span>Dán</span>
                    </button>
                  )}

                  {/* Nút Xóa Style riêng */}
                  {perLineStyles[selectedIndex] && (
                    <button
                      type="button"
                      onClick={() => onUpdateLineStyle(selectedIndex, null)}
                      className="flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/20 transition cursor-pointer"
                      title="Xóa style riêng, dùng style chung"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Xóa</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Preview câu được chọn */}
              <div className="flex items-center justify-center rounded-lg border border-slate-700 bg-slate-950 p-3 min-h-[50px] text-center">
                <span
                  style={{
                    color: activeStyle.textColorHex || '#FFFFFF',
                    fontSize: `${(activeStyle.fontSize || 24) * 0.75}px`,
                    fontWeight: activeStyle.bold ? 700 : 400,
                    fontStyle: activeStyle.italic ? 'italic' : 'normal',
                    textShadow:
                      (activeStyle.outlineWidth || 0) > 0
                        ? `0 0 ${activeStyle.outlineWidth || 2}px ${
                            activeStyle.outlineColorHex || '#000000'
                          }`
                        : 'none',
                  }}
                  className="max-w-full break-words leading-tight"
                >
                  {lines[selectedIndex]?.text || 'Xem trước câu thoại'}
                </span>
              </div>

              {/* Controls Màu Sắc */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                {/* Màu chữ */}
                <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5">
                  <span className="text-slate-400 text-[11px]">Màu chữ:</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={activeStyle.textColorHex || '#FFFFFF'}
                      onChange={(e) => handleStyleChange({ textColorHex: e.target.value })}
                      className="h-6 w-7 cursor-pointer rounded border border-slate-700 bg-transparent"
                    />
                    <span className="font-mono text-[10px] text-slate-300">
                      {activeStyle.textColorHex || '#FFFFFF'}
                    </span>
                  </div>
                </div>

                {/* Màu viền */}
                <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5">
                  <span className="text-slate-400 text-[11px]">Màu viền:</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={activeStyle.outlineColorHex || '#000000'}
                      onChange={(e) => handleStyleChange({ outlineColorHex: e.target.value })}
                      className="h-6 w-7 cursor-pointer rounded border border-slate-700 bg-transparent"
                    />
                    <span className="font-mono text-[10px] text-slate-300">
                      {activeStyle.outlineColorHex || '#000000'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Cỡ chữ & độ dày viền */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                    <span>Cỡ chữ:</span>
                    <span className="font-mono text-brand-cyan">{activeStyle.fontSize || 24}px</span>
                  </div>
                  <input
                    type="range"
                    min={14}
                    max={60}
                    value={activeStyle.fontSize || 24}
                    onChange={(e) => handleStyleChange({ fontSize: Number(e.target.value) })}
                    className="w-full accent-cyan-400"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                    <span>Độ dày viền:</span>
                    <span className="font-mono text-brand-cyan">{activeStyle.outlineWidth || 2}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={8}
                    value={activeStyle.outlineWidth || 2}
                    onChange={(e) => handleStyleChange({ outlineWidth: Number(e.target.value) })}
                    className="w-full accent-cyan-400"
                  />
                </div>
              </div>

              {/* Định dạng In đậm/nghiêng & Vị trí căn lề */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-700/60 pt-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleStyleChange({ bold: !activeStyle.bold })}
                    className={`rounded-lg p-1.5 transition cursor-pointer ${
                      activeStyle.bold
                        ? 'bg-brand-cyan/20 text-brand-cyan ring-1 ring-brand-cyan/50'
                        : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                    }`}
                    title="In đậm"
                  >
                    <Bold className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStyleChange({ italic: !activeStyle.italic })}
                    className={`rounded-lg p-1.5 transition cursor-pointer ${
                      activeStyle.italic
                        ? 'bg-brand-cyan/20 text-brand-cyan ring-1 ring-brand-cyan/50'
                        : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                    }`}
                    title="In nghiêng"
                  >
                    <Italic className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Alignment */}
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-slate-400 mr-1">Căn:</span>
                  <button
                    type="button"
                    onClick={() => handleStyleChange({ alignment: 1 })}
                    className={`rounded-lg p-1.5 transition cursor-pointer ${
                      activeStyle.alignment === 1
                        ? 'bg-brand-cyan/20 text-brand-cyan ring-1 ring-brand-cyan/50'
                        : 'text-slate-400 hover:bg-slate-700'
                    }`}
                    title="Trái"
                  >
                    <AlignLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStyleChange({ alignment: 2 })}
                    className={`rounded-lg p-1.5 transition cursor-pointer ${
                      activeStyle.alignment === 2
                        ? 'bg-brand-cyan/20 text-brand-cyan ring-1 ring-brand-cyan/50'
                        : 'text-slate-400 hover:bg-slate-700'
                    }`}
                    title="Giữa đáy"
                  >
                    <AlignCenter className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStyleChange({ alignment: 3 })}
                    className={`rounded-lg p-1.5 transition cursor-pointer ${
                      activeStyle.alignment === 3
                        ? 'bg-brand-cyan/20 text-brand-cyan ring-1 ring-brand-cyan/50'
                        : 'text-slate-400 hover:bg-slate-700'
                    }`}
                    title="Phải"
                  >
                    <AlignRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Hàng nút mở rộng phía dưới */}
              <div className="pt-2 border-t border-slate-700/60 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-slate-400">
                  Tip: Bạn có thể sao chép rồi bấm nút 📋 Dán trực tiếp trên bất kỳ câu nào bên trái.
                </span>
                <button
                  type="button"
                  onClick={() => onBatchApplyStyles(activeStyle)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand-indigo/40 bg-brand-indigo/20 px-3 py-1.5 text-xs font-semibold text-brand-cyan hover:bg-brand-indigo/30 transition cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Áp dụng cho tất cả câu</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
