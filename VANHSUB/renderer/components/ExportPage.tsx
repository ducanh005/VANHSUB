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
};

const STYLE_PRESETS: Array<{ name: string; style: SubStyle }> = [
  { name: 'Chuẩn', style: DEFAULT_STYLE },
  {
    name: 'TikTok nổi',
    style: { ...DEFAULT_STYLE, fontName: 'Arial', fontSize: 30, primaryColour: '#FFE135', outline: 3, shadow: 0, bold: true, marginV: 30 },
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

  // Phase 3: Custom Mask Region (Bounding Box)
  const [customMaskEnabled, setCustomMaskEnabled] = useState(false);
  const [customMask, setCustomMask] = useState<CustomMaskRegion>({
    xPercent: 10,
    yPercent: 75,
    widthPercent: 80,
    heightPercent: 20,
    mode: 'blur',
    intensity: 40,
  });

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

  // Tab điều hướng trong Hardsub
  const [hardsubTab, setHardsubTab] = useState<'global' | 'lines' | 'layers' | 'format'>('global');

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const isExporting = selectedTask?.status === 'exporting';
  const outputPath = selectedTask?.outputPath;
  const hasTtsAudio = !!selectedTask?.ttsAudioDir;

  // Tải danh sách phụ đề mỗi khi chọn task
  useEffect(() => {
    if (!selectedTask) {
      setSrtLines([]);
      setPerLineStyles({});
      setSelectedLineIdx(null);
      return;
    }
    const srtPath = selectedTask.translatedSrtPath || selectedTask.srtPath;
    if (!srtPath || !window.vanhsub?.tasks?.readSrt) {
      setSrtLines([]);
      return;
    }
    let canceled = false;
    window.vanhsub.tasks
      .readSrt(srtPath)
      .then((content) => {
        if (!canceled && content) {
          setSrtLines(parseSrt(content));
        }
      })
      .catch(() => {
        if (!canceled) setSrtLines([]);
      });
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
              customMask: customMaskEnabled ? customMask : null,
              watermark: watermarkEnabled && watermark.content ? watermark : null,
              formatOptions: hasCustomFormat ? formatOptions : null,
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
    if (outputPath && window.vanhsub?.dialog) {
      window.vanhsub.dialog.showInFolder(outputPath);
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
                  customMask={customMask}
                  watermarkEnabled={watermarkEnabled}
                  watermark={watermark}
                  globalStyle={style}
                  perLineStyles={perLineStyles}
                  srtLines={srtLines}
                  currentTime={currentVideoTime}
                  onTimeUpdate={setCurrentVideoTime}
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
                  <span>1. Style phụ đề chung</span>
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

              {/* 1. Style phụ đề chung */}
              {hardsubTab === 'global' && (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-200">Style phụ đề toàn bài</span>
                    <div className="flex flex-wrap gap-1.5">
                      {STYLE_PRESETS.map((p) => (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() => setStyle(p.style)}
                          disabled={isExporting}
                          className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer disabled:opacity-50"
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Xem trước xấp xỉ */}
                  <div className="relative mb-4 h-24 overflow-hidden rounded-xl border border-slate-700 bg-gradient-to-br from-slate-700 via-slate-600 to-slate-800">
                    <div
                      className="absolute inset-x-0 flex justify-center px-4"
                      style={
                        style.alignment === 8
                          ? { top: 8 }
                          : style.alignment === 5
                            ? { top: '50%', transform: 'translateY(-50%)' }
                            : { bottom: Math.max(6, style.marginV / 2) }
                      }
                    >
                      <span
                        style={{
                          fontFamily: `"${style.fontName}", Arial, sans-serif`,
                          fontSize: style.fontSize * 1.5,
                          lineHeight: 1.25,
                          color: style.primaryColour,
                          fontWeight: style.bold ? 800 : 500,
                          opacity: style.opacity / 100,
                          ...(style.borderStyle === 3
                            ? { background: style.outlineColour, padding: '2px 10px' }
                            : { textShadow: `${outlineShadow}${dropShadow}` }),
                        }}
                      >
                        Phụ đề mẫu — Xin chào VANHSUB
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-400">Font</label>
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
                        Cỡ chữ: <span className="font-mono text-brand-cyan">{style.fontSize}</span>
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

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-400">Vị trí</label>
                      <select
                        value={style.alignment}
                        onChange={(e) =>
                          setStyle((s) => ({ ...s, alignment: Number(e.target.value) as SubStyle['alignment'] }))
                        }
                        disabled={isExporting}
                        className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
                      >
                        <option value={2}>Đáy khung hình</option>
                        <option value={5}>Giữa khung hình</option>
                        <option value={8}>Đỉnh khung hình</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-medium text-slate-400">Chữ:</label>
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
                        Độ mờ:
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
                        {style.borderStyle === 3 ? 'Lề box:' : 'Viền:'}
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
                        Bóng:
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

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-slate-400">Kiểu:</span>
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
                          <option value={1}>Viền + bóng</option>
                          <option value={3}>Nền box đặc</option>
                        </select>
                      </div>
                      <label className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
                        Cách mép:
                        <input
                          type="range"
                          min={0}
                          max={120}
                          value={style.marginV}
                          onChange={(e) => setStyle((s) => ({ ...s, marginV: Number(e.target.value) }))}
                          disabled={isExporting}
                          className="w-24 accent-cyan-400"
                        />
                        <span className="w-8 font-mono text-brand-cyan">{style.marginV}</span>
                      </label>
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
                    customMask={customMask}
                    customMaskEnabled={customMaskEnabled}
                    onToggleMask={setCustomMaskEnabled}
                    onChangeMask={(partial) => setCustomMask((prev) => ({ ...prev, ...partial }))}
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

              {outputPath && !isExporting && !startingDub && (
                <>
                  <button
                    type="button"
                    onClick={handleShowOutput}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-700 cursor-pointer"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-brand-cyan" />
                    <span>Mở thư mục chứa file</span>
                  </button>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Đã xuất: {outputPath.split(/[/\\]/).pop()}
                  </span>
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
