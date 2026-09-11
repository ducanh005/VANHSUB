import React, { useState } from 'react';
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
} from 'lucide-react';
import type { SrtLine } from '../../lib/srt';
import { formatMs } from '../../lib/srt';
import type { PerLineSubtitleStyle } from '../../types/electron';

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

  // Local draft state for the selected line
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

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Danh sách các câu thoại */}
        <div className="flex flex-col gap-2 lg:col-span-6">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Tìm kiếm nội dung phụ đề..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-800/90 pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-brand-cyan/60 focus:outline-none"
            />
          </div>

          <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 p-1 divide-y divide-slate-800/40">
            {filteredLines.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                {lines.length === 0 ? 'Chưa tải được câu thoại' : 'Không tìm thấy câu phù hợp'}
              </div>
            ) : (
              filteredLines.map((line) => {
                const isSelected = selectedIndex === line.originalIdx;
                const hasCustom = !!perLineStyles[line.originalIdx];
                return (
                  <button
                    key={line.originalIdx}
                    type="button"
                    onClick={() => onSelectLine(line.originalIdx)}
                    className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition cursor-pointer ${
                      isSelected
                        ? 'bg-brand-cyan/15 ring-1 ring-brand-cyan/50 text-white'
                        : 'hover:bg-slate-800/60 text-slate-300'
                    }`}
                  >
                    <span className="shrink-0 font-mono text-[10px] text-slate-500 mt-0.5">
                      #{line.originalIdx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-xs">{line.text}</p>
                      <span className="text-[10px] font-mono text-slate-500">
                        {formatMs(line.startMs).split(',')[0]} → {formatMs(line.endMs).split(',')[0]}
                      </span>
                    </div>
                    {hasCustom && (
                      <span
                        className="shrink-0 h-2 w-2 rounded-full bg-brand-cyan mt-1.5"
                        title="Dòng này có style riêng"
                      />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Bảng điều khiển style câu được chọn */}
        <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-800/40 p-3.5 lg:col-span-6">
          {selectedIndex === null ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-xs text-slate-500">
              <Sparkles className="h-6 w-6 text-slate-600 mb-2" />
              <span>Chọn một câu thoại bên trái để chỉnh màu sắc, cỡ chữ và vị trí riêng biệt.</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-slate-700/60 pb-2">
                <span className="text-xs font-semibold text-brand-cyan">
                  Chỉnh câu #{selectedIndex + 1}
                </span>
                {perLineStyles[selectedIndex] && (
                  <button
                    type="button"
                    onClick={() => onUpdateLineStyle(selectedIndex, null)}
                    className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 transition cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Xóa style riêng</span>
                  </button>
                )}
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

              {/* Controls */}
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

              {/* Định dạng & Vị trí */}
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

              {/* Nút áp dụng cho tất cả */}
              <div className="pt-2 border-t border-slate-700/60 flex justify-end">
                <button
                  type="button"
                  onClick={() => onBatchApplyStyles(activeStyle)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand-indigo/40 bg-brand-indigo/20 px-3 py-1.5 text-xs font-semibold text-brand-cyan hover:bg-brand-indigo/30 transition cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Áp dụng style này cho tất cả các câu</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
