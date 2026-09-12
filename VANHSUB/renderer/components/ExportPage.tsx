import React, { useState, useEffect } from 'react';
import {
  AudioLines,
  CheckCircle2,
  Film,
  FolderOpen,
  Layers,
  Loader2,
  Mic,
  Play,
  Palette,
  ShieldAlert,
  Sparkles,
  Sliders,
} from 'lucide-react';
import type { Task } from '../types/task';
import type {
  SubMaskRegion,
  SubStyle,
  PerLineSubtitleStyle,
  CustomMaskRegion,
  WatermarkOptions,
  ExportFormatOptions,
  AdvancedExportOptions,
} from '../types/electron';
import { parseSrt, type SrtLine } from '../lib/srt';
import { SubtitlesStyleEditor } from './export/SubtitlesStyleEditor';
import { OverlayMaskEditor } from './export/OverlayMaskEditor';
import { VideoPreviewCanvas } from './export/VideoPreviewCanvas';
import { ExportFormatPanel } from './export/ExportFormatPanel';

type Props = {
  tasks: Task[];
};

type ExportMode = 'hardsub' | 'softsub' | 'dub' | 'stems';

const MODES: Array<{
  id: ExportMode;
  title: string;
  description: string;
  tag: string;
}> = [
  {
    id: 'hardsub',
    title: 'Hardsub — Ghi cứng phụ đề',
    description: 'Phụ đề được "đốt" thẳng vào khung hình. Xem được ở mọi trình phát, mọi thiết bị. Render chậm hơn vì phải encode lại video.',
    tag: 'Tương thích tối đa',
  },
  {
    id: 'softsub',
    title: 'Softsub — Phụ đề mềm',
    description: 'Phụ đề được đóng gói thành track riêng trong file MP4. Render gần như tức thì, có thể bật/tắt phụ đề. Một số trình phát cũ có thể không hiện track.',
    tag: 'Tốc độ cao',
  },
  {
    id: 'dub',
    title: 'Lồng tiếng — Chèn voice tiếng Việt',
    description: 'Ghép audio lồng tiếng (đã tạo ở tab Lồng tiếng) vào video: thay giọng gốc hoặc song ngữ 2 track. Hỗ trợ AI tách lời thoại để giữ nhạc nền.',
    tag: 'Cần audio TTS',
  },
  {
    id: 'stems',
    title: 'Tách nhạc nền — AI Demucs',
    description: 'Tách video/audio thành 2 file MP3: nhạc nền không lời (làm BGM) và giọng hát đã tách riêng. Cần Python + demucs.',
    tag: 'Xuất audio',
  },
];

const DEFAULT_STYLE: SubStyle = {
  fontName: 'Arial',
  fontSize: 18,
  primaryColour: '#FFFFFF',
  outlineColour: '#000000',
  opacity: 100,
  outline: 2,
  shadow: 1,
  bold: false,
  borderStyle: 1,
  alignment: 2,
  marginV: 25,
  marginH: 20,
  isVertical: false,
};

const POSITION_PRESETS: Array<{
  name: string;
  alignment: SubStyle['alignment'];
  marginV: number;
  marginH: number;
  isVertical: boolean;
}> = [
  { name: '⬇️ Đáy chuẩn', alignment: 2, marginV: 25, marginH: 20, isVertical: false },
  { name: '⬅️ Nhạc dọc mép trái', alignment: 4, marginV: 25, marginH: 35, isVertical: true },
  { name: '➡️ Nhạc dọc mép phải', alignment: 6, marginV: 25, marginH: 35, isVertical: true },
  { name: '⬆️ Đỉnh giữa', alignment: 8, marginV: 30, marginH: 20, isVertical: false },
  { name: '⏺ Chính giữa tâm', alignment: 5, marginV: 25, marginH: 20, isVertical: false },
];

const STYLE_PRESETS: Array<{ name: string; style: SubStyle }> = [
  { name: 'Chuẩn', style: DEFAULT_STYLE },
  {
    name: 'TikTok nổi',
    style: { ...DEFAULT_STYLE, fontName: 'Arial', fontSize: 30, primaryColour: '#FFE135', outline: 3, shadow: 0, bold: true, marginV: 30 },
  },
  {
    name: 'Nhạc Douyin (Dọc)',
    style: {
      ...DEFAULT_STYLE,
      fontName: 'Arial',
      fontSize: 20,
      primaryColour: '#FFE135',
      outline: 2,
      alignment: 4,
      marginH: 35,
      marginV: 25,
      isVertical: true,
    },
  },
  {
    name: 'Nền box',
    style: { ...DEFAULT_STYLE, borderStyle: 3, outline: 3, shadow: 0, outlineColour: '#000000' },
  },
  {
    name: 'Chiếu rạp',
    style: { ...DEFAULT_STYLE, fontName: 'Georgia', fontSize: 20, outlineColour: '#101010', shadow: 2, marginV: 20 },
  },
];

const FONT_OPTIONS = ['Arial', 'Segoe UI', 'Verdana', 'Tahoma', 'Times New Roman', 'Georgia', 'Impact', 'Courier New'];

const DEFAULT_MASK: SubMaskRegion = {
  position: 'bottom',
  heightPercent: 22,
  mode: 'blur',
};

export default function ExportPage({ tasks }: Props) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [mode, setMode] = useState<ExportMode>('hardsub');
  const [maskEnabled, setMaskEnabled] = useState(false);
  const [mask, setMask] = useState<SubMaskRegion>(DEFAULT_MASK);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  // Tùy chọn chế độ Lồng tiếng
  const [replaceAudio, setReplaceAudio] = useState(true);
  const [syncMode, setSyncMode] = useState<'strict' | 'flexible' | 'video-stretch'>('strict');
  const [mixOriginalAudio, setMixOriginalAudio] = useState(false);
  const [vocalSeparation, setVocalSeparation] = useState(false);
  const [startingDub, setStartingDub] = useState(false);

  // Style phụ đề hardsub
  const [style, setStyle] = useState<SubStyle>(DEFAULT_STYLE);
  const [separatingStems, setSeparatingStems] = useState(false);

  // Phase 3: Per-line styles & Subtitle Lines
  const [srtLines, setSrtLines] = useState<SrtLine[]>([]);
  const [selectedLineIdx, setSelectedLineIdx] = useState<number | null>(null);
  const [perLineStyles, setPerLineStyles] = useState<Record<number, PerLineSubtitleStyle>>({});

  // Phase 3: Custom Mask Regions (Multi-mask Bounding Boxes)
  const [customMaskEnabled, setCustomMaskEnabled] = useState(false);
  const [customMasks, setCustomMasks] = useState<CustomMaskRegion[]>([
    {
      id: 'mask_1',
      name: 'Vùng che #1',
      xPercent: 10,
      yPercent: 75,
      widthPercent: 80,
      heightPercent: 20,
      mode: 'blur',
      intensity: 40,
      enabled: true,
    },
  ]);
  const [activeMaskIndex, setActiveMaskIndex] = useState(0);

  const handleAddMask = () => {
    const nextIdx = customMasks.length + 1;
    const newMask: CustomMaskRegion = {
      id: `mask_${Date.now()}`,
      name: `Vùng che #${nextIdx}`,
      xPercent: 10,
      yPercent: 10,
      widthPercent: 75,
      heightPercent: 18,
      mode: 'gaussian',
      intensity: 40,
      enabled: true,
    };
    setCustomMasks((prev) => [...prev, newMask]);
    setActiveMaskIndex(customMasks.length);
  };

  const handleDuplicateMask = (index: number) => {
    const source = customMasks[index] || customMasks[0];
    if (!source) return;
    const newMask: CustomMaskRegion = {
      ...source,
      id: `mask_${Date.now()}`,
      name: `${source.name || 'Vùng che'} (Bản sao)`,
      xPercent: Math.min(85, source.xPercent + 3),
      yPercent: Math.min(85, source.yPercent + 3),
      enabled: true,
    };
    setCustomMasks((prev) => [...prev, newMask]);
    setActiveMaskIndex(customMasks.length);
  };

  const handleRemoveMask = (index: number) => {
    if (customMasks.length <= 1) return;
    setCustomMasks((prev) => prev.filter((_, i) => i !== index));
    setActiveMaskIndex((prev) => Math.max(0, Math.min(prev, customMasks.length - 2)));
  };

  const handleToggleMaskItem = (index: number, enabled: boolean) => {
    setCustomMasks((prev) =>
      prev.map((m, i) => (i === index ? { ...m, enabled } : m))
    );
  };

  const handleChangeMask = (partial: Partial<CustomMaskRegion>, index?: number) => {
    const targetIdx = index !== undefined ? index : activeMaskIndex;
    setCustomMasks((prev) =>
      prev.map((m, i) => {
        if (i !== targetIdx) return m;
        const updated = { ...m, ...partial };
        if (partial.mode === 'solid' && (m.mode !== 'solid' || updated.intensity === undefined || updated.intensity <= 40)) {
          updated.intensity = 100;
        }
        return updated;
      })
    );
  };

  // Phase 3: Watermark / Logo Layer
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermark, setWatermark] = useState<WatermarkOptions>({
    type: 'text',
    content: '',
    position: 'top_right',
    opacity: 0.8,
    scalePercent: 18,
  });

  // Phase 4: Tùy chọn tỉ lệ & định dạng xuất video (16:9, 9:16 TikTok, FPS, Bitrate)
  const [formatOptions, setFormatOptions] = useState<ExportFormatOptions>({
    aspectRatio: 'original',
    resolution: 'original',
    fps: 0,
    bitrateKbps: 0,
    videoCodec: 'libx264',
  });
  const [currentVideoTime, setCurrentVideoTime] = useState(0);

  // Bố cục Song ngữ / Lời nhạc kép
  const [dualSubtitlesEnabled, setDualSubtitlesEnabled] = useState(false);
  const [dualLayoutPreset, setDualLayoutPreset] = useState<'douyin_music_left' | 'top_bottom_bilingual' | 'custom'>('douyin_music_left');
  const [secondarySrtLines, setSecondarySrtLines] = useState<SrtLine[]>([]);

  // Tab điều hướng trong Hardsub
  const [hardsubTab, setHardsubTab] = useState<'global' | 'lines' | 'layers' | 'format'>('global');

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const isExporting = selectedTask?.status === 'exporting';
  const outputPath = selectedTask?.outputPath;
  const hasTtsAudio = !!selectedTask?.ttsAudioDir;
  const hasBothSrt = !!(selectedTask?.srtPath && selectedTask?.translatedSrtPath);

  // Tải danh sách phụ đề mỗi khi chọn task
  useEffect(() => {
    if (!selectedTask) {
      setSrtLines([]);
      setSecondarySrtLines([]);
      setPerLineStyles({});
      setSelectedLineIdx(null);
      return;
    }
    const mainSrtPath = selectedTask.translatedSrtPath || selectedTask.srtPath;
    if (!mainSrtPath || !window.vanhsub?.tasks?.readSrt) {
      setSrtLines([]);
      setSecondarySrtLines([]);
      return;
    }
    let canceled = false;
    window.vanhsub.tasks
      .readSrt(mainSrtPath)
      .then((content) => {
        if (!canceled && content) {
          setSrtLines(parseSrt(content));
        }
      })
      .catch(() => {
        if (!canceled) setSrtLines([]);
      });

    const secSrtPath = selectedTask.translatedSrtPath && selectedTask.srtPath
      ? (mainSrtPath === selectedTask.translatedSrtPath ? selectedTask.srtPath : selectedTask.translatedSrtPath)
      : null;

    if (secSrtPath && window.vanhsub?.tasks?.readSrt) {
      window.vanhsub.tasks
        .readSrt(secSrtPath)
        .then((content) => {
          if (!canceled && content) {
            setSecondarySrtLines(parseSrt(content));
          }
        })
        .catch(() => {
          if (!canceled) setSecondarySrtLines([]);
        });
    } else {
      setSecondarySrtLines([]);
    }

    return () => {
      canceled = true;
    };
  }, [selectedTaskId, selectedTask?.translatedSrtPath, selectedTask?.srtPath]);

  const handleUpdateLineStyle = (lineIndex: number, lineStyle: PerLineSubtitleStyle | null) => {
    setPerLineStyles((prev) => {
      const next = { ...prev };
      if (!lineStyle) {
        delete next[lineIndex];
      } else {
        next[lineIndex] = lineStyle;
      }
      return next;
    });
  };

  const handleBatchApplyStyles = (batchStyle: PerLineSubtitleStyle) => {
    const next: Record<number, PerLineSubtitleStyle> = {};
    srtLines.forEach((_, idx) => {
      next[idx] = { ...batchStyle };
    });
    setPerLineStyles(next);
  };

  const handleClearAllStyles = () => {
    setPerLineStyles({});
  };

  const handleUpdateSubtitlePosition = (pos: {
    alignment?: SubStyle['alignment'];
    marginV?: number;
    marginH?: number;
    posPercent?: { x: number; y: number };
  }) => {
    setStyle((s) => ({
      ...s,
      ...pos,
    }));
  };

  const handleExport = async () => {
    if (!selectedTaskId) return;
    setMessage('');
    setIsError(false);
    try {
      if (mode === 'stems') {
        setSeparatingStems(true);
        await window.vanhsub.export.separateStems(selectedTaskId);
        setMessage('Đã bắt đầu tách nhạc nền bằng AI — theo dõi tiến trình bên dưới...');
        return;
      }
      if (mode === 'dub') {
        setStartingDub(true);
        await window.vanhsub.dubbing.start(selectedTaskId, replaceAudio, {
          syncMode,
          mixOriginalAudio: replaceAudio && mixOriginalAudio && !vocalSeparation,
          vocalSeparation: replaceAudio && vocalSeparation,
        });
        setMessage('Đã bắt đầu ghép audio lồng tiếng vào video...');
        return;
      }
      const maskParam = mode === 'hardsub' && maskEnabled ? mask : null;
      const styleParam = mode === 'hardsub' ? style : null;

      const hasCustomFormat =
        (formatOptions.aspectRatio && formatOptions.aspectRatio !== 'original') ||
        (formatOptions.fps && formatOptions.fps > 0) ||
        (formatOptions.bitrateKbps && formatOptions.bitrateKbps > 0) ||
        (formatOptions.resolution && formatOptions.resolution !== 'original') ||
        formatOptions.videoCodec === 'libx265';

      const advancedOptions: AdvancedExportOptions | null =
        mode === 'hardsub'
          ? {
              perLineStyles: Object.keys(perLineStyles).length > 0 ? perLineStyles : undefined,
              customMask: customMaskEnabled && customMasks.length > 0 ? customMasks[0] : null,
              customMasks: customMaskEnabled ? customMasks.filter((m) => m.enabled !== false) : [],
              watermark: watermarkEnabled && watermark.content ? watermark : null,
              formatOptions: hasCustomFormat ? formatOptions : null,
              dualSubtitles: dualSubtitlesEnabled && hasBothSrt
                ? {
                    enabled: true,
                    layoutPreset: dualLayoutPreset,
                  }
                : null,
            }
          : null;

      await window.vanhsub.export.start(selectedTaskId, mode, maskParam, styleParam, advancedOptions);
      setMessage(`Đã bắt đầu xuất video (${mode === 'hardsub' ? 'Hardsub' : 'Softsub'})...`);
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    } finally {
      setStartingDub(false);
      setSeparatingStems(false);
    }
  };

  const handleShowOutput = () => {
    const target = selectedTask?.projectDir || outputPath;
    if (target && window.vanhsub?.dialog) {
      if (window.vanhsub.dialog.openFolder) {
        window.vanhsub.dialog.openFolder(target);
      } else {
        window.vanhsub.dialog.showInFolder(target);
      }
    }
  };

  const editorTasks = tasks.filter((t) => t.srtPath || t.translatedSrtPath || t.filePath);
  const dubSuffix = replaceAudio ? 'mono' : 'bilingual';
  const ratioSuffix =
    mode === 'hardsub' && formatOptions.aspectRatio && formatOptions.aspectRatio !== 'original'
      ? `_${formatOptions.aspectRatio.replace(':', '-')}`
      : '';
  const resultFileName =
    mode === 'dub'
      ? `${selectedTask?.fileName.replace(/\.[^.]+$/, '') || ''}_dubbed_${dubSuffix}.mp4`
      : mode === 'stems'
        ? `${selectedTask?.fileName.replace(/\.[^.]+$/, '') || ''}.nhacnen.mp3 + .giong.mp3`
        : `${selectedTask?.fileName.replace(/\.[^.]+$/, '') || ''}.${mode}${ratioSuffix}.mp4`;

  // Outline preview bằng text-shadow 4 hướng (xấp xỉ viền ASS của libass)
  const outlineShadow =
    style.outline > 0 && style.borderStyle === 1
      ? [
          `${style.outline}px 0 0 ${style.outlineColour}`,
          `0 ${style.outline}px 0 ${style.outlineColour}`,
          `-${style.outline}px 0 0 ${style.outlineColour}`,
          `0 -${style.outline}px 0 ${style.outlineColour}`,
          `${style.outline}px ${style.outline}px 0 ${style.outlineColour}`,
          `-${style.outline}px -${style.outline}px 0 ${style.outlineColour}`,
        ].join(', ')
      : '';
  const dropShadow = style.shadow > 0 && style.borderStyle === 1 ? `, ${style.shadow * 2}px ${style.shadow * 2}px 3px rgba(0,0,0,0.65)` : '';

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden p-6">
      {/* Thanh công cụ */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-slate-300">Tác vụ:</label>
          <select
            value={selectedTaskId || ''}
            onChange={(e) => {
              setSelectedTaskId(e.target.value || null);
              setMessage('');
              setIsError(false);
            }}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
          >
            <option value="">-- Chọn tác vụ --</option>
            {editorTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fileName}
              </option>
            ))}
          </select>

          {message && (
            <span className={`max-w-[380px] truncate text-xs font-mono ${isError ? 'text-rose-400' : 'text-brand-cyan'}`} title={message}>
              {message}
            </span>
          )}
        </div>
      </div>

      {/* Nội dung chính */}
      {!selectedTask ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center text-slate-500 text-xs">
          <Layers className="h-10 w-10 text-slate-600 mb-3 animate-pulse" />
          <span>Chọn một tác vụ đã có phụ đề để xuất video (Hardsub, Softsub, Lồng tiếng hoặc Tách nhạc nền).</span>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
          {/* Chọn chế độ xuất */}
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
            {MODES.map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  disabled={isExporting}
                  className={[
                    'flex flex-col gap-2 rounded-2xl border p-4 text-left transition',
                    active
                      ? 'border-brand-cyan/70 bg-brand-cyan/10 ring-1 ring-brand-cyan/40'
                      : 'border-slate-800 bg-slate-900/70 hover:border-brand-indigo/50',
                    isExporting ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      {m.id === 'dub' ? (
                        <Mic className={`h-4 w-4 ${active ? 'text-brand-cyan' : 'text-slate-400'}`} />
                      ) : m.id === 'stems' ? (
                        <AudioLines className={`h-4 w-4 ${active ? 'text-brand-cyan' : 'text-slate-400'}`} />
                      ) : (
                        <Film className={`h-4 w-4 ${active ? 'text-brand-cyan' : 'text-slate-400'}`} />
                      )}
                      {m.title}
                    </div>
                    <span className="rounded-full border border-slate-700/80 bg-slate-800/80 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                      {m.tag}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-400">{m.description}</p>
                </button>
              );
            })}
          </div>

          {/* Tùy chọn nâng cao chế độ Hardsub */}
          {mode === 'hardsub' && (
            <div className="flex flex-col gap-3">
              {/* Mini CapCut Live Video Studio Preview */}
              {selectedTask.filePath && (
                <VideoPreviewCanvas
                  videoPath={selectedTask.filePath}
                  aspectRatio={formatOptions.aspectRatio || 'original'}
                  customMaskEnabled={customMaskEnabled}
                  customMasks={customMasks}
                  classicMask={mask}
                  classicMaskEnabled={maskEnabled}
                  activeMaskIndex={activeMaskIndex}
                  onSelectMask={setActiveMaskIndex}
                  onUpdateMask={(idx, partial) => handleChangeMask(partial, idx)}
                  watermarkEnabled={watermarkEnabled}
                  watermark={watermark}
                  globalStyle={style}
                  perLineStyles={perLineStyles}
                  srtLines={srtLines}
                  currentTime={currentVideoTime}
                  onTimeUpdate={setCurrentVideoTime}
                  secondarySrtLines={secondarySrtLines}
                  dualSubtitlesEnabled={dualSubtitlesEnabled && hasBothSrt}
                  onUpdateSubtitlePosition={handleUpdateSubtitlePosition}
                />
              )}

              {/* Tab navigation */}
              <div className="flex flex-wrap border-b border-slate-800 bg-slate-900/50 p-1.5 rounded-xl gap-2">
                <button
                  type="button"
                  onClick={() => setHardsubTab('global')}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
                    hardsubTab === 'global'
                      ? 'bg-brand-cyan/20 text-brand-cyan shadow-sm ring-1 ring-brand-cyan/40'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Sliders className="h-4 w-4" />
                  <span>1. Style & Vị trí phụ đề</span>
                </button>
                <button
                  type="button"
                  onClick={() => setHardsubTab('lines')}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
                    hardsubTab === 'lines'
                      ? 'bg-brand-cyan/20 text-brand-cyan shadow-sm ring-1 ring-brand-cyan/40'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Palette className="h-4 w-4" />
                  <span>2. Style từng câu thoại</span>
                  {Object.keys(perLineStyles).length > 0 && (
                    <span className="rounded-full bg-brand-cyan/30 px-1.5 py-0.5 text-[10px] text-brand-cyan">
                      {Object.keys(perLineStyles).length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setHardsubTab('layers')}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
                    hardsubTab === 'layers'
                      ? 'bg-brand-cyan/20 text-brand-cyan shadow-sm ring-1 ring-brand-cyan/40'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <ShieldAlert className="h-4 w-4" />
                  <span>3. Che mờ & Watermark</span>
                  {(customMaskEnabled || watermarkEnabled || maskEnabled) && (
                    <span className="h-2 w-2 rounded-full bg-brand-cyan" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setHardsubTab('format')}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition cursor-pointer ${
                    hardsubTab === 'format'
                      ? 'bg-brand-cyan/20 text-brand-cyan shadow-sm ring-1 ring-brand-cyan/40'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Film className="h-4 w-4" />
                  <span>4. Tỉ lệ & Định dạng xuất</span>
                  {formatOptions.aspectRatio && formatOptions.aspectRatio !== 'original' && (
                    <span className="rounded-full bg-brand-cyan/30 px-1.5 py-0.5 text-[10px] text-brand-cyan">
                      {formatOptions.aspectRatio}
                    </span>
                  )}
                </button>
              </div>

              {/* 1. Style phụ đề chung & Bố cục vị trí */}
              {hardsubTab === 'global' && (
                <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  {/* Preset Vị trí & Bố cục */}
                  <div className="flex flex-col gap-2 rounded-xl border border-slate-800/90 bg-slate-950/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                        <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                        <span>Mẫu vị trí nhanh (1-Click Presets):</span>
                      </div>
                      {style.posPercent && (
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-brand-cyan/10 px-2 py-0.5 text-[10px] font-mono text-brand-cyan border border-brand-cyan/30">
                            📍 Đang dùng tọa độ tự do Canvas (X: {style.posPercent.x}%, Y: {style.posPercent.y}%)
                          </span>
                          <button
                            type="button"
                            onClick={() => setStyle((s) => ({ ...s, posPercent: undefined }))}
                            className="text-[10px] text-rose-300 hover:underline cursor-pointer"
                            title="Xóa tọa độ kéo thả, quay lại căn lề chuẩn"
                          >
                            ↺ Đặt lại vị trí
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {POSITION_PRESETS.map((p) => (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() =>
                            setStyle((s) => ({
                              ...s,
                              alignment: p.alignment,
                              marginV: p.marginV,
                              marginH: p.marginH,
                              isVertical: p.isVertical,
                              posPercent: undefined,
                            }))
                          }
                          disabled={isExporting}
                          className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition cursor-pointer disabled:opacity-50 ${
                            !style.posPercent &&
                            style.alignment === p.alignment &&
                            style.isVertical === p.isVertical
                              ? 'border-brand-cyan/60 bg-brand-cyan/15 text-brand-cyan font-semibold shadow-sm'
                              : 'border-slate-800 bg-slate-900/90 text-slate-300 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Lưới 9 Vị trí & Căn lề */}
                  <div className="grid gap-4 lg:grid-cols-12 rounded-xl border border-slate-800 bg-slate-950/40 p-3.5">
                    {/* Lưới 3x3 căn lề Numpad */}
                    <div className="flex flex-col gap-2 lg:col-span-5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-300">
                          Bộ chọn vị trí 9 điểm:
                        </span>
                        <span className="font-mono text-brand-cyan text-[11px]">
                          {style.alignment === 7 ? 'Đỉnh trái' :
                           style.alignment === 8 ? 'Đỉnh giữa' :
                           style.alignment === 9 ? 'Đỉnh phải' :
                           style.alignment === 4 ? 'Giữa trái (Cạnh trái)' :
                           style.alignment === 5 ? 'Chính giữa tâm' :
                           style.alignment === 6 ? 'Giữa phải (Cạnh phải)' :
                           style.alignment === 1 ? 'Đáy trái' :
                           style.alignment === 3 ? 'Đáy phải' : 'Đáy giữa'}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-700 bg-slate-900 p-2 shrink-0">
                          {[
                            { id: 7, label: '↖', title: 'Đỉnh - Trái' },
                            { id: 8, label: '⬆', title: 'Đỉnh - Giữa' },
                            { id: 9, label: '↗', title: 'Đỉnh - Phải' },
                            { id: 4, label: '⬅', title: 'Giữa - Trái (Nhạc mép trái)' },
                            { id: 5, label: '⏺', title: 'Chính giữa tâm' },
                            { id: 6, label: '➡', title: 'Giữa - Phải (Nhạc mép phải)' },
                            { id: 1, label: '↙', title: 'Đáy - Trái' },
                            { id: 2, label: '⬇', title: 'Đáy - Giữa (Mặc định)' },
                            { id: 3, label: '↘', title: 'Đáy - Phải' },
                          ].map((btn) => {
                            const isCurrent = !style.posPercent && (style.alignment || 2) === btn.id;
                            return (
                              <button
                                key={btn.id}
                                type="button"
                                onClick={() =>
                                  setStyle((s) => ({
                                    ...s,
                                    alignment: btn.id as any,
                                    posPercent: undefined,
                                  }))
                                }
                                className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-mono transition cursor-pointer ${
                                  isCurrent
                                    ? 'bg-brand-cyan text-black font-bold shadow-md shadow-brand-cyan/40'
                                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                                }`}
                                title={btn.title}
                              >
                                {btn.label}
                              </button>
                            );
                          })}
                        </div>

                        {/* Nút bật xếp dọc */}
                        <div className="flex flex-col gap-2 flex-1">
                          <button
                            type="button"
                            onClick={() => setStyle((s) => ({ ...s, isVertical: !s.isVertical }))}
                            className={`flex flex-col items-start gap-1 rounded-xl border p-2.5 transition cursor-pointer text-left ${
                              style.isVertical
                                ? 'border-purple-500/60 bg-purple-500/15 text-purple-200 ring-1 ring-purple-500/40'
                                : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                            }`}
                          >
                            <span className="text-xs font-semibold flex items-center gap-1.5 text-purple-300">
                              <span>🔤 Chữ xếp dọc</span>
                              <span className="rounded bg-purple-500/30 px-1 py-0.2 text-[9px] font-mono">
                                {style.isVertical ? 'BẬT' : 'TẮT'}
                              </span>
                            </span>
                            <span className="text-[10px] leading-tight text-slate-400">
                              Ngắt ký tự rơi thẳng đứng dọc mép video (chuẩn Douyin / TikTok Lyric).
                            </span>
                          </button>
                          <span className="text-[10px] text-slate-500 italic">
                            💡 Gợi ý: Bạn cũng có thể click trực tiếp vào phụ đề trên khung xem trước phía trên để kéo rê vị trí tự do.
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Điều khiển Khoảng cách lề */}
                    <div className="flex flex-col justify-center gap-3 lg:col-span-7 border-l border-slate-800/80 pl-4">
                      <div>
                        <div className="flex justify-between text-xs text-slate-300 mb-1">
                          <span className="font-medium">Khoảng cách mép dọc (Margin V):</span>
                          <span className="font-mono text-brand-cyan">{style.marginV ?? 25}px</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={120}
                          value={style.marginV ?? 25}
                          onChange={(e) => setStyle((s) => ({ ...s, marginV: Number(e.target.value) }))}
                          disabled={isExporting}
                          className="w-full accent-cyan-400"
                        />
                        <span className="text-[10px] text-slate-500">
                          Khoảng cách từ mép dưới (hoặc mép trên) vào trong màn hình.
                        </span>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs text-slate-300 mb-1">
                          <span className="font-medium">Khoảng cách mép ngang (Margin H):</span>
                          <span className="font-mono text-brand-cyan">{style.marginH ?? 20}px</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={150}
                          value={style.marginH ?? 20}
                          onChange={(e) => setStyle((s) => ({ ...s, marginH: Number(e.target.value) }))}
                          disabled={isExporting}
                          className="w-full accent-cyan-400"
                        />
                        <span className="text-[10px] text-slate-500">
                          Khoảng cách từ mép trái (hoặc mép phải) vào trong màn hình.
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Cấu hình Bố cục Song ngữ (Dual Subtitles / Lời bài hát kép) */}
                  {hasBothSrt && (
                    <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-3.5 flex flex-col gap-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-2 w-2 rounded-full bg-indigo-400 animate-pulse" />
                          <span className="text-xs font-bold text-indigo-200">
                            Bố cục Song ngữ / Lời nhạc kép (Dual Tracks)
                          </span>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-indigo-300 font-semibold cursor-pointer">
                          <input
                            type="checkbox"
                            checked={dualSubtitlesEnabled}
                            onChange={(e) => setDualSubtitlesEnabled(e.target.checked)}
                            className="h-4 w-4 rounded border-indigo-500/50 bg-slate-900 text-brand-cyan focus:ring-0 cursor-pointer"
                          />
                          <span>Bật hiển thị đồng thời cả 2 bản phụ đề</span>
                        </label>
                      </div>

                      {dualSubtitlesEnabled && (
                        <div className="flex flex-col gap-2 pt-2 border-t border-indigo-500/20 text-xs">
                          <span className="text-[11px] text-slate-300">
                            Chọn kiểu kết hợp 2 vị trí:
                          </span>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              onClick={() => setDualLayoutPreset('douyin_music_left')}
                              className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition cursor-pointer ${
                                dualLayoutPreset === 'douyin_music_left'
                                  ? 'border-brand-cyan/80 bg-brand-cyan/15 ring-1 ring-brand-cyan/50 text-white'
                                  : 'border-slate-800 bg-slate-900/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                              }`}
                            >
                              <span className="font-semibold text-brand-cyan flex items-center gap-1.5">
                                <span>🎵 Douyin Music Layout (Khuyên dùng)</span>
                              </span>
                              <span className="text-[11px] text-slate-300 leading-relaxed">
                                • <strong>Lời bài hát gốc</strong>: Xếp dọc chạy dài ở mép bên trái màn hình.
                                <br />• <strong>Lời dịch tiếng Việt</strong>: Hiển thị ngang ở dưới đáy.
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setDualLayoutPreset('top_bottom_bilingual')}
                              className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition cursor-pointer ${
                                dualLayoutPreset === 'top_bottom_bilingual'
                                  ? 'border-brand-cyan/80 bg-brand-cyan/15 ring-1 ring-brand-cyan/50 text-white'
                                  : 'border-slate-800 bg-slate-900/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                              }`}
                            >
                              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                                <span>🎬 Song ngữ Trên - Dưới (Chiếu rạp)</span>
                              </span>
                              <span className="text-[11px] text-slate-300 leading-relaxed">
                                • <strong>Lời gốc</strong>: Hiển thị ngang ở đỉnh màn hình.
                                <br />• <strong>Lời dịch</strong>: Hiển thị ngang ở đáy màn hình.
                              </span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Kiểu chữ, Màu sắc & Cỡ chữ */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 pt-2 border-t border-slate-800/80">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-400">Font chữ</label>
                      <select
                        value={style.fontName}
                        onChange={(e) => setStyle((s) => ({ ...s, fontName: e.target.value }))}
                        disabled={isExporting}
                        className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
                      >
                        {FONT_OPTIONS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-400">
                        Cỡ chữ: <span className="font-mono text-brand-cyan">{style.fontSize}px</span>
                      </label>
                      <input
                        type="range"
                        min={12}
                        max={60}
                        value={style.fontSize}
                        onChange={(e) => setStyle((s) => ({ ...s, fontSize: Number(e.target.value) }))}
                        disabled={isExporting}
                        className="w-full accent-cyan-400"
                      />
                    </div>

                    <div className="flex items-center gap-2 pt-4">
                      <label className="text-[11px] font-medium text-slate-400">Màu chữ:</label>
                      <input
                        type="color"
                        value={style.primaryColour}
                        onChange={(e) => setStyle((s) => ({ ...s, primaryColour: e.target.value }))}
                        disabled={isExporting}
                        className="h-7 w-10 cursor-pointer rounded border border-slate-700 bg-slate-800"
                      />
                      <label className="ml-2 text-[11px] font-medium text-slate-400">
                        {style.borderStyle === 3 ? 'Nền box:' : 'Viền:'}
                      </label>
                      <input
                        type="color"
                        value={style.outlineColour}
                        onChange={(e) => setStyle((s) => ({ ...s, outlineColour: e.target.value }))}
                        disabled={isExporting}
                        className="h-7 w-10 cursor-pointer rounded border border-slate-700 bg-slate-800"
                      />
                      <label className="ml-2 flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={style.bold}
                          onChange={(e) => setStyle((s) => ({ ...s, bold: e.target.checked }))}
                          disabled={isExporting}
                          className="h-3.5 w-3.5 border-slate-700 bg-slate-800 text-brand-cyan focus:ring-0"
                        />
                        Đậm
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
                        Độ mờ chữ:
                        <input
                          type="range"
                          min={40}
                          max={100}
                          value={style.opacity}
                          onChange={(e) => setStyle((s) => ({ ...s, opacity: Number(e.target.value) }))}
                          disabled={isExporting}
                          className="w-24 accent-cyan-400"
                        />
                        <span className="w-8 font-mono text-brand-cyan">{style.opacity}%</span>
                      </label>
                      <label className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
                        {style.borderStyle === 3 ? 'Lề box:' : 'Độ dày viền:'}
                        <input
                          type="range"
                          min={style.borderStyle === 3 ? 1 : 0}
                          max={8}
                          value={style.outline}
                          onChange={(e) => setStyle((s) => ({ ...s, outline: Number(e.target.value) }))}
                          disabled={isExporting}
                          className="w-20 accent-cyan-400"
                        />
                        <span className="w-4 font-mono text-brand-cyan">{style.outline}</span>
                      </label>
                      <label className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
                        Bóng đổ:
                        <input
                          type="range"
                          min={0}
                          max={6}
                          value={style.shadow}
                          onChange={(e) => setStyle((s) => ({ ...s, shadow: Number(e.target.value) }))}
                          disabled={isExporting}
                          className="w-20 accent-cyan-400"
                        />
                        <span className="w-4 font-mono text-brand-cyan">{style.shadow}</span>
                      </label>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-slate-400">Kiểu hiển thị:</span>
                      <select
                        value={style.borderStyle}
                        onChange={(e) => {
                          const val = Number(e.target.value) as SubStyle['borderStyle'];
                          setStyle((s) => ({
                            ...s,
                            borderStyle: val,
                            outline: val === 3 && s.outline === 0 ? 3 : s.outline,
                            shadow: val === 3 ? 0 : s.shadow || 1,
                          }));
                        }}
                        disabled={isExporting}
                        className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
                      >
                        <option value={1}>Viền nét + bóng đổ (Chuẩn)</option>
                        <option value={3}>Nền hộp màu đặc (Box)</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* 2. Tùy biến Style từng câu thoại */}
              {hardsubTab === 'lines' && (
                <SubtitlesStyleEditor
                  lines={srtLines}
                  perLineStyles={perLineStyles}
                  onUpdateLineStyle={handleUpdateLineStyle}
                  onBatchApplyStyles={handleBatchApplyStyles}
                  onClearAllStyles={handleClearAllStyles}
                  selectedIndex={selectedLineIdx}
                  onSelectLine={setSelectedLineIdx}
                />
              )}

              {/* 3. Che mờ & Watermark */}
              {hardsubTab === 'layers' && (
                <div className="flex flex-col gap-4">
                  {/* Che mờ tự do & Watermark */}
                  <OverlayMaskEditor
                    customMasks={customMasks}
                    activeMaskIndex={activeMaskIndex}
                    onSelectMask={setActiveMaskIndex}
                    onAddMask={handleAddMask}
                    onRemoveMask={handleRemoveMask}
                    onToggleMaskItem={handleToggleMaskItem}
                    onDuplicateMask={handleDuplicateMask}
                    customMaskEnabled={customMaskEnabled}
                    onToggleMask={setCustomMaskEnabled}
                    onChangeMask={handleChangeMask}
                    watermark={watermark}
                    watermarkEnabled={watermarkEnabled}
                    onToggleWatermark={setWatermarkEnabled}
                    onChangeWatermark={(partial) => setWatermark((prev) => ({ ...prev, ...partial }))}
                    currentVideoTime={currentVideoTime}
                  />

                  {/* Che dải phụ đề cố định (Classic Bar Mask) */}
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={maskEnabled}
                        onChange={(e) => setMaskEnabled(e.target.checked)}
                        disabled={isExporting}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-brand-cyan focus:ring-0"
                      />
                      <span>Dải che phụ đề cũ kiểu đơn giản (ngang toàn màn hình ở đáy / đỉnh)</span>
                    </label>

                    {maskEnabled && (
                      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-slate-800/80 pt-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">Vị trí:</span>
                          <select
                            value={mask.position}
                            onChange={(e) =>
                              setMask((m) => ({ ...m, position: e.target.value as 'bottom' | 'top' }))
                            }
                            disabled={isExporting}
                            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
                          >
                            <option value="bottom">Đáy khung hình</option>
                            <option value="top">Đầu khung hình</option>
                          </select>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">Độ cao dải che:</span>
                          <input
                            type="range"
                            min={5}
                            max={50}
                            step={1}
                            value={mask.heightPercent}
                            onChange={(e) => setMask((m) => ({ ...m, heightPercent: Number(e.target.value) }))}
                            disabled={isExporting}
                            className="w-36 accent-cyan-400"
                          />
                          <span className="w-10 font-mono text-xs text-brand-cyan">{mask.heightPercent}%</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">Kiểu che:</span>
                          <select
                            value={mask.mode}
                            onChange={(e) => setMask((m) => ({ ...m, mode: e.target.value as 'solid' | 'blur' }))}
                            disabled={isExporting}
                            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
                          >
                            <option value="blur">Làm mờ (giữ mờ khung hình)</option>
                            <option value="solid">Tô đen hoàn toàn</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 4. Tỉ lệ & Định dạng xuất */}
              {hardsubTab === 'format' && (
                <ExportFormatPanel
                  formatOptions={formatOptions}
                  onChangeFormat={(partial) =>
                    setFormatOptions((prev) => ({ ...prev, ...partial }))
                  }
                  videoDurationSec={60}
                />
              )}
            </div>
          )}

          {/* Tùy chọn lồng tiếng (chỉ dùng cho chế độ Dub) */}
          {mode === 'dub' && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              {!hasTtsAudio ? (
                <p className="text-xs leading-relaxed text-amber-400">
                  Tác vụ này chưa có audio lồng tiếng. Hãy vào tab{' '}
                  <strong>Lồng tiếng</strong> chọn giọng rồi bấm "Tạo audio lồng tiếng" trước, sau đó
                  quay lại đây để ghép vào video.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-semibold text-slate-200">Audio:</span>
                    <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="radio"
                        checked={replaceAudio}
                        onChange={() => setReplaceAudio(true)}
                        disabled={isExporting}
                        className="h-3.5 w-3.5 border-slate-700 bg-slate-800 text-brand-cyan focus:ring-0"
                      />
                      Thay giọng gốc (mono)
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="radio"
                        checked={!replaceAudio}
                        onChange={() => setReplaceAudio(false)}
                        disabled={isExporting}
                        className="h-3.5 w-3.5 border-slate-700 bg-slate-800 text-brand-cyan focus:ring-0"
                      />
                      Song ngữ (giữ track gốc)
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-semibold text-slate-200">Đồng bộ:</span>
                    <select
                      value={syncMode}
                      onChange={(e) =>
                        setSyncMode(e.target.value as 'strict' | 'flexible' | 'video-stretch')
                      }
                      disabled={isExporting}
                      className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
                    >
                      <option value="strict">Strict — nén theo timeline SRT</option>
                      <option value="flexible">Flexible — tràn vào khoảng lặng (tối đa 3s)</option>
                      <option value="video-stretch">Video-stretch — giãn video tối đa 1.25x</option>
                    </select>
                  </div>

                  {replaceAudio && (
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={vocalSeparation}
                        onChange={(e) => setVocalSeparation(e.target.checked)}
                        disabled={isExporting}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-brand-cyan focus:ring-0"
                      />
                      <span>
                        Tách lời thoại bằng AI (kiểu CapCut) —{' '}
                        <span className="text-slate-400">
                          loại giọng người gốc, giữ nguyên nhạc nền/SFX thay vì mix nhỏ 0.22
                        </span>
                      </span>
                    </label>
                  )}
                  {!replaceAudio && (
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={mixOriginalAudio}
                        onChange={(e) => setMixOriginalAudio(e.target.checked)}
                        disabled={isExporting}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-brand-cyan focus:ring-0"
                      />
                      <span className="text-slate-400">
                        Mix nhỏ nhạc nền gốc (0.22) dưới lời thoại
                      </span>
                    </label>
                  )}

                  {vocalSeparation && (
                    <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
                      AI tách lời (Demucs) chạy trên CPU — thời gian xử lý xấp xỉ thời lượng video.
                      Lần đầu cần <code className="font-mono">python -m pip install demucs</code> và
                      tải model ~80MB (đã kiểm tra: máy này sẵn sàng).
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tùy chọn tách nhạc nền (chỉ dùng cho chế độ Stems) */}
          {mode === 'stems' && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <p className="text-xs leading-relaxed text-slate-400">
                AI Demucs sẽ tách âm thanh của{' '}
                <span className="font-mono text-slate-200">{selectedTask.fileName}</span> thành 2 file MP3
                (320kbps) lưu cạnh video gốc:
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-brand-cyan/30 bg-brand-cyan/5 p-2.5">
                  <p className="font-mono text-[11px] text-brand-cyan">
                    {selectedTask.fileName.replace(/\.[^.]+$/, '')}.nhacnen.mp3
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Nhạc nền/SFX <strong className="text-slate-300">không lời</strong> — dùng làm BGM
                  </p>
                </div>
                <div className="rounded-xl border border-brand-rose/30 bg-brand-rose/5 p-2.5">
                  <p className="font-mono text-[11px] text-brand-rose">
                    {selectedTask.fileName.replace(/\.[^.]+$/, '')}.giong.mp3
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Giọng hát/thoại <strong className="text-slate-300">đã tách riêng</strong>
                  </p>
                </div>
              </div>
              <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
                Demucs chạy trên CPU — thời gian xử lý xấp xỉ thời lượng video. Lần đầu cần{' '}
                <code className="font-mono">python -m pip install demucs</code> và tải model ~80MB
                (máy này đã kiểm tra sẵn sàng). File video/audio mono cho kết quả tách kém hơn stereo.
              </p>
            </div>
          )}

          {/* Thông tin xuất + nút */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="mb-3 space-y-1.5 text-xs text-slate-400">
              <p>
                • Nguồn phụ đề:{' '}
                {mode === 'stems' ? (
                  <span className="text-slate-500">không cần (chế độ tách audio)</span>
                ) : (
                  <>
                    <span className="font-mono text-slate-200">
                      {(selectedTask.translatedSrtPath || selectedTask.srtPath || '').split(/[/\\]/).pop()}
                    </span>
                    {selectedTask.translatedSrtPath && (
                      <span className="ml-1.5 rounded-full border border-brand-indigo/30 bg-brand-indigo/10 px-2 py-0.5 text-[10px] font-semibold text-brand-cyan">
                        dùng bản đã dịch
                      </span>
                    )}
                  </>
                )}
              </p>
              {mode !== 'stems' && mode !== 'dub' && (
                <p className="text-slate-500">
                  (Chế độ này cần phụ đề — vào tab Hiệu đính hoặc Lồng tiếng nếu chưa có.)
                </p>
              )}
              {mode === 'dub' && (
                <p>
                  • Giọng lồng: <span className="font-mono text-slate-200">{selectedTask.ttsVoice || 'mặc định'}</span>
                  {selectedTask.ttsEngine === 'tiktok' && (
                    <span className="ml-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                      TikTok TTS
                    </span>
                  )}
                </p>
              )}
              <p>
                • Video gốc: <span className="font-mono text-slate-200">{selectedTask.filePath}</span>
              </p>
              <p>• File kết quả lưu cạnh video gốc (hoặc thư mục đã đặt trong Cài đặt):</p>
              <p className="rounded-lg bg-slate-950 px-2.5 py-1.5 font-mono text-[11px] text-brand-cyan">
                {resultFileName}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleExport}
                disabled={isExporting || startingDub || separatingStems || (mode === 'dub' && !hasTtsAudio)}
                className="btn-vanh-gradient inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {isExporting || startingDub || separatingStems ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 fill-white" />
                )}
                <span>
                  {isExporting || startingDub || separatingStems
                    ? 'Đang xuất...'
                    : mode === 'dub'
                      ? 'Ghép lồng tiếng vào video'
                      : mode === 'stems'
                        ? 'Bắt đầu tách nhạc nền (AI)'
                        : 'Bắt đầu xuất video'}
                </span>
              </button>

              {(outputPath || selectedTask.projectDir) && !isExporting && !startingDub && (
                <>
                  <button
                    type="button"
                    onClick={handleShowOutput}
                    className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/20 cursor-pointer shadow-sm"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Mở thư mục dự án</span>
                  </button>
                  {outputPath && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Đã xuất: {outputPath.split(/[/\\]/).pop()}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Tiến trình */}
          {(isExporting || (selectedTask.progress > 0 && selectedTask.progress < 100 && selectedTask.status !== 'done')) && (
            <div className="rounded-2xl border border-brand-indigo/40 bg-brand-indigo/10 p-4">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium text-brand-cyan">{selectedTask.stageDescription || 'Đang xử lý...'}</span>
                <span className="font-mono text-slate-300">{selectedTask.progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-indigo transition-all duration-300"
                  style={{ width: `${selectedTask.progress}%` }}
                />
              </div>
            </div>
          )}

          {selectedTask.status === 'error' && selectedTask.errorMessage && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-300">
              <strong className="font-semibold">Lỗi xuất video:</strong> {selectedTask.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
