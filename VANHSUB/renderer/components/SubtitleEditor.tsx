import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Crosshair,
  FileVideo,
  Globe2,
  KeyRound,
  Languages,
  Loader2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
  XCircle,
} from 'lucide-react';
import type { Task } from '../types/task';
import { formatMs, parseSrt, parseTimecode, serializeSrt, type SrtLine } from '../lib/srt';

type Props = {
  tasks: Task[];
  selectedTaskId?: string | null;
  onSelectTaskId?: (id: string | null) => void;
  onNavigateTab?: (tab: string) => void;
  isActive?: boolean;
};

function makeLineId(): string {
  return `line-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/** Ô nhập thời gian: cho phép gõ tự do, chỉ commit giá trị hợp lệ khi blur/Enter. */
function TimeField({ valueMs, onChangeMs }: { valueMs: number; onChangeMs: (ms: number) => void }) {
  const [draft, setDraft] = useState(formatMs(valueMs));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(formatMs(valueMs));
  }, [valueMs, focused]);

  const commit = () => {
    const parsed = parseTimecode(draft);
    if (parsed !== null) onChangeMs(parsed);
  };

  return (
    <input
      type="text"
      value={focused ? draft : formatMs(valueMs)}
      onFocus={(e) => {
        setFocused(true);
        setDraft(formatMs(valueMs));
        requestAnimationFrame(() => e.target.select());
      }}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-[104px] rounded bg-slate-950 px-1.5 py-0.5 text-[11px] text-slate-300 border border-slate-800 font-mono focus:border-brand-indigo focus:outline-none"
    />
  );
}

function NudgeButton({ label, onClick, title }: { label: string; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex h-5 min-w-[26px] items-center justify-center rounded border border-slate-700 bg-slate-800 px-1 text-[9px] font-mono text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
    >
      {label}
    </button>
  );
}

function TimeRow({
  label,
  valueMs,
  onChangeMs,
  onSyncVideo,
}: {
  label: string;
  valueMs: number;
  onChangeMs: (ms: number) => void;
  onSyncVideo: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-10 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <TimeField valueMs={valueMs} onChangeMs={onChangeMs} />
      <NudgeButton label="-1s" title="Lùi 1 giây" onClick={() => onChangeMs(Math.max(0, valueMs - 1000))} />
      <NudgeButton label="-0.1" title="Lùi 0.1 giây" onClick={() => onChangeMs(Math.max(0, valueMs - 100))} />
      <NudgeButton label="+0.1" title="Thêm 0.1 giây" onClick={() => onChangeMs(valueMs + 100)} />
      <NudgeButton label="+1s" title="Thêm 1 giây" onClick={() => onChangeMs(valueMs + 1000)} />
      <button
        type="button"
        onClick={onSyncVideo}
        title="Gán bằng thời điểm phát hiện tại của video"
        className="inline-flex h-5 w-5 items-center justify-center rounded border border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/25 cursor-pointer"
      >
        <Crosshair className="h-3 w-3" />
      </button>
    </div>
  );
}

export default function SubtitleEditor({
  tasks,
  selectedTaskId: controlledTaskId,
  onSelectTaskId,
  onNavigateTab,
  isActive = true,
}: Props) {
  const [internalTaskId, setInternalTaskId] = useState<string | null>(null);
  const selectedTaskId = controlledTaskId !== undefined ? controlledTaskId : internalTaskId;

  const setSelectedTaskId = (id: string | null) => {
    if (onSelectTaskId) onSelectTaskId(id);
    else setInternalTaskId(id);
  };

  const [lines, setLines] = useState<SrtLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Trình xem trước video
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const activeRowRef = useRef<HTMLDivElement | null>(null);

  // AI (Gemini)
  const [aiBusyIndex, setAiBusyIndex] = useState<number | null>(null);
  const [aiActionType, setAiActionType] = useState<'polish' | 'translate' | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [geminiModelName, setGeminiModelName] = useState('gemini-2.5-flash');
  const [keyDraft, setKeyDraft] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [isCleaningSubtitles, setIsCleaningSubtitles] = useState(false);

  // Nguồn SRT đang hiệu đính
  const [srtSource, setSrtSource] = useState<'original' | 'translated'>('original');
  const prevTaskIdRef = useRef<string | null>(null);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const isTranslating = selectedTask?.status === 'translating';
  const hasTranslatedSrt = !!selectedTask?.translatedSrtPath;

  const mediaUrl = useMemo(() => {
    if (!selectedTask?.filePath) return '';
    return `vanhmedia://local/${encodeURIComponent(selectedTask.filePath)}`;
  }, [selectedTask]);

  const activeIndex = useMemo(
    () => lines.findIndex((l) => currentTimeMs >= l.startMs && currentTimeMs < l.endMs),
    [lines, currentTimeMs]
  );

  // File SRT đang mở: bản dịch nếu đang chọn và đã có, ngược lại bản gốc
  const activeSrtPath = useMemo(() => {
    if (!selectedTask) return '';
    return srtSource === 'translated' && selectedTask.translatedSrtPath
      ? selectedTask.translatedSrtPath
      : selectedTask.srtPath || '';
  }, [selectedTask, srtSource]);

  // Tự chọn task đầu tiên có SRT nếu chưa chọn task nào
  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) {
      const firstWithSrt = tasks.find((t) => t.srtPath);
      if (firstWithSrt) setSelectedTaskId(firstWithSrt.id);
    }
  }, [tasks, selectedTaskId]);

  // Khi tab được kích hoạt lại (chuyển sang tab Hiệu đính) và không có thay đổi dở: tự làm mới để nhận thay đổi từ tab khác
  useEffect(() => {
    if (isActive && !dirty) {
      setReloadKey((k) => k + 1);
    }
  }, [isActive]);

  // Chỉ khởi tạo srtSource mặc định khi ĐỔI sang một task khác (tránh ghi đè lựa chọn của người dùng)
  useEffect(() => {
    if (selectedTaskId !== prevTaskIdRef.current) {
      prevTaskIdRef.current = selectedTaskId;
      if (selectedTask?.translatedSrtPath) {
        setSrtSource('translated');
      } else {
        setSrtSource('original');
      }
    }
  }, [selectedTaskId, selectedTask?.translatedSrtPath]);

  const handleTaskChange = (newTaskId: string | null) => {
    if (newTaskId === selectedTaskId) return;
    if (dirty && !window.confirm('Có thay đổi phụ đề chưa lưu. Bạn có chắc muốn đổi tác vụ? Thay đổi chưa lưu sẽ mất.')) {
      return;
    }
    setSelectedTaskId(newTaskId);
  };

  const handleSourceChange = (src: 'original' | 'translated') => {
    if (src === srtSource) return;
    if (dirty && !window.confirm('Thay đổi chưa lưu của file đang mở sẽ mất khi đổi nguồn. Tiếp tục?')) {
      return;
    }
    setSrtSource(src);
  };

  // Kiểm tra Gemini API key & model đã lưu
  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.settings) return;
    Promise.all([
      window.vanhsub.settings.get('geminiApiKey'),
      window.vanhsub.settings.get('geminiModel'),
    ])
      .then(([keyVal, modelVal]) => {
        setHasApiKey(!!(keyVal && String(keyVal).trim()));
        setKeyDraft(keyVal ? String(keyVal) : '');
        if (modelVal) setGeminiModelName(String(modelVal));
      })
      .catch(() => setHasApiKey(false));
  }, []);

  // Tải SRT khi đổi tác vụ, đổi nguồn hoặc khi reloadKey tăng
  useEffect(() => {
    if (!selectedTaskId || !activeSrtPath) {
      setLines([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setStatusError(false);
    setStatusMessage('Đang tải file SRT...');
    window.vanhsub.tasks
      .readSrt(activeSrtPath)
      .then((content) => {
        if (cancelled) return;
        const parsed = parseSrt(content);
        setLines(parsed);
        setDirty(false);
        setLoading(false);
        setStatusMessage(`Đã nạp ${parsed.length} dòng phụ đề (${srtSource === 'translated' ? 'Bản dịch' : 'Bản gốc'})`);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setLoading(false);
        setStatusError(true);
        setStatusMessage('Không thể đọc file SRT: ' + (err?.message || err));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTaskId, activeSrtPath, srtSource, reloadKey]);

  // Tự cuộn tới dòng đang phát
  useEffect(() => {
    if (activeIndex >= 0 && isPlaying) {
      activeRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeIndex, isPlaying]);

  const updateLine = (index: number, patch: Partial<SrtLine>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
    setDirty(true);
  };

  const deleteLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const addLine = () => {
    const last = lines[lines.length - 1];
    const startMs = last ? last.endMs : 0;
    setLines((prev) => [
      ...prev,
      { id: makeLineId(), startMs, endMs: startMs + 3000, text: '' },
    ]);
    setDirty(true);
  };

  const setLineTimeFromVideo = (index: number, field: 'startMs' | 'endMs') => {
    const video = videoRef.current;
    if (!video) return;
    updateLine(index, { [field]: Math.round(video.currentTime * 1000) });
  };

  const seekTo = (ms: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(ms)) return;
    video.currentTime = Math.max(0, ms / 1000);
    setCurrentTimeMs(Math.max(0, ms));
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (durationMs <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seekTo(Math.round(ratio * durationMs));
  };

  const handleSave = async () => {
    if (!activeSrtPath) return;

    try {
      setLoading(true);
      setStatusError(false);
      setStatusMessage('Đang lưu file SRT...');
      await window.vanhsub.tasks.writeSrt(activeSrtPath, serializeSrt(lines));
      setDirty(false);
      setLoading(false);
      setStatusMessage(`Đã lưu thành công ${lines.length} dòng (${srtSource === 'translated' ? 'Bản dịch' : 'Bản gốc'})!`);
      setTimeout(() => setStatusMessage(''), 4000);
    } catch (err: any) {
      setLoading(false);
      setStatusError(true);
      setStatusMessage('Lỗi khi lưu SRT: ' + (err?.message || err));
    }
  };

  // Hiệu đính 1 câu (sửa lỗi chính tả, ngữ pháp, mượt văn)
  const handlePolishLine = async (index: number) => {
    if (aiBusyIndex !== null) return;
    setStatusError(false);
    setStatusMessage(`Đang gọi Gemini hiệu đính câu #${index + 1}...`);
    setAiBusyIndex(index);
    setAiActionType('polish');
    try {
      const polished = await window.vanhsub.ai.polishLine({
        text: lines[index].text,
        prev: lines[index - 1]?.text,
        next: lines[index + 1]?.text,
      });
      updateLine(index, { text: polished });
      setStatusMessage(`Đã hiệu đính câu #${index + 1} bằng Gemini — nhớ bấm "Lưu thay đổi".`);
    } catch (err: any) {
      const message: string = err?.message || String(err);
      setStatusError(true);
      setStatusMessage(message);
      if (message.includes('API key')) setShowKeyInput(true);
    } finally {
      setAiBusyIndex(null);
      setAiActionType(null);
    }
  };

  // Dịch nhanh 1 câu sang tiếng Việt (hoặc targetLanguage)
  const handleTranslateLine = async (index: number) => {
    if (aiBusyIndex !== null) return;
    setStatusError(false);
    setStatusMessage(`Đang gọi Gemini dịch câu #${index + 1}...`);
    setAiBusyIndex(index);
    setAiActionType('translate');
    try {
      const translated = await window.vanhsub.ai.translateLine({
        text: lines[index].text,
        prev: lines[index - 1]?.text,
        next: lines[index + 1]?.text,
      });
      updateLine(index, { text: translated });
      setStatusMessage(`Đã dịch câu #${index + 1} sang tiếng Việt — nhớ bấm "Lưu thay đổi".`);
    } catch (err: any) {
      const message: string = err?.message || String(err);
      setStatusError(true);
      setStatusMessage(message);
      if (message.includes('API key')) setShowKeyInput(true);
    } finally {
      setAiBusyIndex(null);
      setAiActionType(null);
    }
  };

  // Dọn dẹp, gộp câu lặp và sửa lỗi chính tả bằng Gemini AI
  const handleAiCleanSubtitles = async () => {
    if (lines.length === 0 || isCleaningSubtitles || loading) return;
    if (!hasApiKey) {
      setShowKeyInput(true);
      setStatusError(true);
      setStatusMessage('Cần có Gemini API Key để AI dọn dẹp phụ đề — vui lòng nhập key.');
      return;
    }

    const originalCount = lines.length;
    setIsCleaningSubtitles(true);
    setStatusError(false);
    setStatusMessage(`Đang gọi Gemini AI rà soát & gộp câu trùng lặp cho ${originalCount} dòng...`);

    try {
      const itemsToClean = lines.map((l) => ({
        startMs: l.startMs,
        endMs: l.endMs,
        text: l.text,
      }));

      const cleaned = await window.vanhsub.ai.cleanSubtitles(itemsToClean);
      if (cleaned && cleaned.length > 0) {
        const newLines: SrtLine[] = cleaned.map((c) => ({
          id: makeLineId(),
          startMs: c.startMs,
          endMs: c.endMs,
          text: c.text,
        }));

        setLines(newLines);
        setDirty(true);
        const savedCount = originalCount - newLines.length;
        const msg =
          savedCount > 0
            ? `AI đã gộp gọn: từ ${originalCount} dòng còn ${newLines.length} dòng (đã lọc ${savedCount} câu lặp/nhiễu). Nhớ bấm "Lưu thay đổi"!`
            : `AI đã chuẩn hoá chính tả & câu chữ cho ${newLines.length} dòng. Nhớ bấm "Lưu thay đổi"!`;
        setStatusMessage(msg);
      } else {
        setStatusMessage('AI không tìm thấy thay đổi cần gộp.');
      }
    } catch (err: any) {
      const message: string = err?.message || String(err);
      setStatusError(true);
      setStatusMessage('Lỗi khi AI dọn dẹp phụ đề: ' + message);
      if (message.includes('API key')) setShowKeyInput(true);
    } finally {
      setIsCleaningSubtitles(false);
    }
  };

  // Chạy dịch toàn bộ tác vụ bằng Gemini AI
  const handleStartFullTranslate = async () => {
    if (!selectedTaskId) return;
    if (dirty) {
      await handleSave();
    }
    setStatusError(false);
    setStatusMessage('Đã bắt đầu dịch toàn bộ bằng Gemini...');
    try {
      await window.vanhsub.translate.start(selectedTaskId, 'vi');
    } catch (err: any) {
      setStatusError(true);
      setStatusMessage(err?.message || String(err));
    }
  };

  const handleCancelTranslate = async () => {
    if (!selectedTaskId) return;
    try {
      await window.vanhsub.translate.cancel(selectedTaskId);
      setStatusMessage('Đã gửi yêu cầu dừng dịch.');
    } catch {
      // bỏ qua
    }
  };

  const handleSaveKey = async () => {
    setSavingKey(true);
    try {
      await window.vanhsub.settings.set('geminiApiKey', keyDraft.trim());
      setHasApiKey(keyDraft.trim().length > 0);
      setShowKeyInput(false);
      setStatusError(false);
      setStatusMessage('Đã lưu Gemini API key thành công');
    } catch (err: any) {
      setStatusError(true);
      setStatusMessage('Không lưu được key: ' + (err?.message || err));
    } finally {
      setSavingKey(false);
    }
  };

  const posPercent = (ms: number) =>
    durationMs > 0 ? Math.min(100, Math.max(0, (ms / durationMs) * 100)) : 0;

  const editorTasks = tasks.filter((t) => t.srtPath);

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden p-6">
      {/* Thanh công cụ trên */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-slate-300">Tác vụ:</label>
          <select
            value={selectedTaskId || ''}
            onChange={(e) => handleTaskChange(e.target.value || null)}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
          >
            <option value="">-- Chọn tác vụ đã có SRT --</option>
            {editorTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fileName}
              </option>
            ))}
          </select>

          {/* Nguồn phụ đề đang hiệu đính: bản gốc hay bản dịch */}
          {selectedTaskId && selectedTask?.srtPath && (
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-semibold text-slate-300">Đang sửa:</label>
              <div className="flex overflow-hidden rounded-xl border border-slate-700 bg-slate-950/50">
                <button
                  type="button"
                  onClick={() => handleSourceChange('original')}
                  className={[
                    'px-3 py-1.5 text-[11px] font-medium transition cursor-pointer',
                    srtSource === 'original'
                      ? 'bg-brand-cyan/20 text-brand-cyan font-semibold'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700',
                  ].join(' ')}
                >
                  Bản gốc (.srt)
                </button>
                <button
                  type="button"
                  onClick={() => handleSourceChange('translated')}
                  disabled={!hasTranslatedSrt}
                  title={
                    hasTranslatedSrt
                      ? 'Sửa bản dịch (file các bước TTS/Xuất video sẽ dùng)'
                      : 'Chưa có bản dịch — bấm "Dịch bằng Gemini" để tạo'
                  }
                  className={[
                    'border-l border-slate-700 px-3 py-1.5 text-[11px] font-medium transition',
                    srtSource === 'translated'
                      ? 'bg-brand-cyan/20 text-brand-cyan font-semibold cursor-pointer'
                      : hasTranslatedSrt
                        ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer'
                        : 'bg-slate-800/40 text-slate-500 cursor-not-allowed',
                  ].join(' ')}
                >
                  Bản dịch {hasTranslatedSrt ? '✓' : '(chưa có)'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (dirty && !window.confirm('Tải lại sẽ xoá các thay đổi chưa lưu. Tiếp tục?')) return;
                  setReloadKey((k) => k + 1);
                }}
                title="Tải lại file SRT từ đĩa để đồng bộ mới nhất"
                className="rounded-xl border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-brand-cyan' : ''}`} />
              </button>
            </div>
          )}

          {/* Nút dịch toàn bộ file trực tiếp trong Editor */}
          {selectedTaskId && (
            <div className="flex items-center gap-1.5">
              {isTranslating ? (
                <button
                  type="button"
                  onClick={handleCancelTranslate}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20 cursor-pointer"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  <span>Huỷ dịch</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartFullTranslate}
                  disabled={loading}
                  title={hasTranslatedSrt ? 'Dịch lại toàn bộ phụ đề bằng Gemini' : 'Dịch toàn bộ phụ đề sang tiếng Việt'}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-brand-indigo/40 bg-brand-indigo/10 px-3 py-1.5 text-xs font-semibold text-brand-cyan hover:bg-brand-indigo/25 cursor-pointer disabled:opacity-50 transition"
                >
                  <Globe2 className="h-3.5 w-3.5" />
                  <span>{hasTranslatedSrt ? 'Dịch lại (Gemini)' : 'Dịch bằng Gemini'}</span>
                </button>
              )}
            </div>
          )}

          {/* Nút AI Dọn Dẹp & Lọc Trùng Phụ Đề */}
          {lines.length > 0 && (
            <button
              type="button"
              onClick={handleAiCleanSubtitles}
              disabled={loading || isCleaningSubtitles || isTranslating}
              title="Dùng Gemini AI quét và gộp các câu phụ đề lặp lại do OCR, ghép câu ngắt vụn và sửa lỗi chính tả"
              className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-300 hover:bg-purple-500/25 cursor-pointer disabled:opacity-50 transition"
            >
              {isCleaningSubtitles ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" />
              ) : (
                <Wand2 className="h-3.5 w-3.5 text-purple-400" />
              )}
              <span>{isCleaningSubtitles ? 'Đang dọn dẹp...' : 'AI Gọn Phụ Đề'}</span>
            </button>
          )}

          {/* Gemini Key status badge */}
          <button
            type="button"
            onClick={() => setShowKeyInput((v) => !v)}
            title="Cấu hình Gemini API key & Model"
            className={[
              'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition cursor-pointer',
              hasApiKey
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700',
            ].join(' ')}
          >
            <KeyRound className="h-3 w-3" />
            <span>{hasApiKey ? `Gemini: ${geminiModelName}` : 'Chưa có Gemini Key'}</span>
          </button>

          {showKeyInput && (
            <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-1.5 shadow-lg">
              <input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="Dán Gemini API key (AIza...)"
                className="w-56 bg-transparent text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveKey}
                disabled={savingKey || !keyDraft.trim()}
                className="btn-vanh-gradient rounded-lg px-2.5 py-1 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
              >
                {savingKey ? '...' : 'Lưu'}
              </button>
            </div>
          )}

          {statusMessage && (
            <span className={`max-w-[280px] truncate text-xs font-mono ${statusError ? 'text-rose-400' : 'text-brand-cyan'}`} title={statusMessage}>
              {statusMessage}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {selectedTaskId && (
            <button
              type="button"
              onClick={handleSave}
              disabled={loading}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50 transition ${
                dirty
                  ? 'btn-vanh-gradient shadow-lg shadow-brand-indigo/30 animate-pulse'
                  : 'border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
              <span>{dirty ? 'Lưu thay đổi (*)' : 'Đã lưu (.srt)'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Tiến trình khi task đang dịch */}
      {selectedTask && isTranslating && (
        <div className="rounded-2xl border border-brand-indigo/40 bg-brand-indigo/10 p-3.5">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 font-medium text-brand-cyan">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{selectedTask.stageDescription || 'Đang dịch phụ đề bằng Gemini...'}</span>
            </span>
            <span className="font-mono font-bold text-white">{selectedTask.progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-indigo transition-all duration-300"
              style={{ width: `${selectedTask.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Nội dung chính */}
      {!selectedTaskId ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center text-slate-500 text-xs">
          <MessageSquareText className="h-10 w-10 text-slate-600 mb-3 animate-pulse" />
          <span>
            Chọn một tác vụ đã hoàn thành phiên âm (có file .srt) ở menu phía trên để bắt đầu hiệu đính.
          </span>
        </div>
      ) : !selectedTask?.srtPath ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center text-slate-500 text-xs">
          <MessageSquareText className="h-10 w-10 text-slate-600 mb-3" />
          <span>Tác vụ này chưa có file .srt — hãy chạy "Bắt đầu phiên âm" ở Trang chủ trước.</span>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-[1fr_380px] gap-5 overflow-hidden">
          {/* Cột trái: danh sách phụ đề */}
          <div className="flex flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="mb-3 flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  {srtSource === 'translated' ? 'Phụ đề bản dịch' : 'Phụ đề bản gốc'} ({lines.length} dòng)
                </h3>
                {dirty && (
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                    Chưa lưu
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 text-brand-cyan" />
                Thêm dòng
              </button>
            </div>

            {loading && lines.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-xs text-slate-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-brand-cyan" />
                Đang tải phụ đề...
              </div>
            ) : (
              <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
                {lines.map((item, index) => {
                  const isActiveLine = index === activeIndex;
                  const isBusyThis = aiBusyIndex === index;
                  return (
                    <div
                      key={item.id}
                      ref={isActiveLine ? activeRowRef : null}
                      onClick={() => seekTo(item.startMs)}
                      className={[
                        'group flex flex-col gap-2 rounded-2xl border bg-slate-900/90 p-3 text-xs transition',
                        isActiveLine
                          ? 'border-brand-cyan/70 ring-1 ring-brand-cyan/40 shadow-sm shadow-brand-cyan/10'
                          : 'border-slate-800/80 hover:border-brand-indigo/50',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-slate-800 px-2 py-0.5 font-bold text-brand-cyan">
                            #{index + 1}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {formatMs(item.startMs)} → {formatMs(item.endMs)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteLine(index);
                          }}
                          className="opacity-0 transition group-hover:opacity-100 text-rose-400 hover:text-rose-300 cursor-pointer"
                          title="Xoá dòng"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-1.5">
                        <TimeRow
                          label="Start"
                          valueMs={item.startMs}
                          onChangeMs={(ms) => updateLine(index, { startMs: ms })}
                          onSyncVideo={() => setLineTimeFromVideo(index, 'startMs')}
                        />
                        <TimeRow
                          label="End"
                          valueMs={item.endMs}
                          onChangeMs={(ms) => updateLine(index, { endMs: Math.max(item.startMs, ms) })}
                          onSyncVideo={() => setLineTimeFromVideo(index, 'endMs')}
                        />
                      </div>

                      <div onClick={(e) => e.stopPropagation()} className="flex items-start gap-2">
                        <textarea
                          rows={2}
                          value={item.text}
                          onChange={(e) => updateLine(index, { text: e.target.value })}
                          placeholder="Nội dung câu phụ đề..."
                          className="flex-1 rounded-xl border border-slate-800 bg-slate-950 p-2 text-xs text-white placeholder:text-slate-600 focus:border-brand-indigo focus:outline-none"
                        />
                        <div className="flex flex-col gap-1">
                          {/* Sửa câu bằng AI (Hiệu đính ngữ pháp/văn phong) */}
                          <button
                            type="button"
                            onClick={() => handlePolishLine(index)}
                            disabled={aiBusyIndex !== null || !item.text.trim()}
                            title="Hiệu đính câu này bằng Gemini — sửa chính tả, ngữ pháp, làm mượt câu"
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-brand-indigo/40 bg-brand-indigo/10 text-brand-cyan transition hover:bg-brand-indigo/25 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                          >
                            {isBusyThis && aiActionType === 'polish' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Wand2 className="h-3.5 w-3.5" />
                            )}
                          </button>

                          {/* Dịch câu này sang tiếng Việt */}
                          <button
                            type="button"
                            onClick={() => handleTranslateLine(index)}
                            disabled={aiBusyIndex !== null || !item.text.trim()}
                            title="Dịch câu này sang tiếng Việt bằng Gemini"
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                          >
                            {isBusyThis && aiActionType === 'translate' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Globe2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cột phải: xem trước video + timeline */}
          <div className="flex flex-col gap-3 overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900/60 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Xem trước &amp; Timeline
            </h3>

            {mediaUrl ? (
              <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-black">
                <video
                  ref={videoRef}
                  src={mediaUrl}
                  controls
                  onTimeUpdate={(e) => setCurrentTimeMs(e.currentTarget.currentTime * 1000)}
                  onLoadedMetadata={(e) =>
                    setDurationMs(
                      Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration * 1000 : 0
                    )
                  }
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  className="w-full max-h-[300px]"
                />
                {activeIndex >= 0 && lines[activeIndex]?.text && (
                  <div className="pointer-events-none absolute inset-x-3 bottom-12 flex justify-center">
                    <span className="max-w-full whitespace-pre-line rounded-lg bg-black/75 px-3 py-1.5 text-center text-xs leading-snug text-white shadow-lg">
                      {lines[activeIndex].text}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-[180px] flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-center">
                <FileVideo className="h-10 w-10 text-slate-700 mb-2" />
                <span className="text-xs text-slate-400">Không có file media để xem trước</span>
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
              <span>{formatMs(currentTimeMs)}</span>
              <span>{formatMs(durationMs)}</span>
            </div>

            {/* Timeline: mỗi khối = 1 dòng phụ đề, bấm để nhảy tới */}
            <div
              onClick={handleTimelineClick}
              className={[
                'relative h-12 w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950',
                durationMs > 0 ? 'cursor-pointer' : '',
              ].join(' ')}
              title="Bấm để nhảy tới vị trí này trên video"
            >
              {durationMs > 0 &&
                lines.map((line, index) => {
                  const left = posPercent(line.startMs);
                  const width = Math.max(0.4, posPercent(line.endMs) - left);
                  return (
                    <div
                      key={line.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        seekTo(line.startMs);
                      }}
                      title={`#${index + 1} · ${formatMs(line.startMs)} → ${formatMs(line.endMs)}\n${line.text}`}
                      className={[
                        'absolute bottom-5 top-1 min-w-[2px] rounded-[3px] cursor-pointer transition-colors',
                        index === activeIndex
                          ? 'bg-brand-cyan'
                          : 'bg-brand-indigo/50 hover:bg-brand-indigo',
                      ].join(' ')}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  );
                })}
              {durationMs > 0 && (
                <div
                  className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-rose-500/90"
                  style={{ left: `${posPercent(currentTimeMs)}%` }}
                />
              )}
              {durationMs <= 0 && (
                <div className="flex h-full items-center justify-center text-[11px] text-slate-600">
                  Timeline sẽ hiện khi video tải xong
                </div>
              )}
            </div>

            <div className="space-y-1.5 rounded-2xl border border-slate-800/60 bg-slate-900/70 p-3 text-[11px] leading-relaxed text-slate-400">
              <p>• Bấm vào một dòng hoặc khối trên timeline để video nhảy tới câu đó.</p>
              <p>• Nút ⊕ (Crosshair) gán thời điểm bắt đầu/kết thúc bằng vị trí phát hiện tại.</p>
              <p>• Nút đũa thần (🪄) hiệu đính ngữ pháp, nút địa cầu (🌐) dịch câu sang tiếng Việt.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
