import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Crosshair,
  FileVideo,
  KeyRound,
  Loader2,
  MessageSquareText,
  Plus,
  Trash2,
  Wand2,
} from 'lucide-react';
import type { Task } from '../types/task';
import { formatMs, parseSrt, parseTimecode, serializeSrt, type SrtLine } from '../lib/srt';

type Props = {
  tasks: Task[];
};

const TIME_NUDGES = [-1000, -100, 100, 1000];

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

export default function SubtitleEditor({ tasks }: Props) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [lines, setLines] = useState<SrtLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [statusError, setStatusError] = useState(false);

  // Trình xem trước video
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const activeRowRef = useRef<HTMLDivElement | null>(null);

  // AI (Gemini)
  const [aiBusyIndex, setAiBusyIndex] = useState<number | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [savingKey, setSavingKey] = useState(false);

  // tasks thay đổi liên tục (broadcast) — dùng ref để effect tải SRT không phụ thuộc vào nó
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const mediaUrl = useMemo(() => {
    if (!selectedTask?.filePath) return '';
    return `vanhmedia://local/${encodeURIComponent(selectedTask.filePath)}`;
  }, [selectedTask]);

  const activeIndex = useMemo(
    () => lines.findIndex((l) => currentTimeMs >= l.startMs && currentTimeMs < l.endMs),
    [lines, currentTimeMs]
  );

  // Kiểm tra Gemini API key đã lưu
  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.settings) return;
    window.vanhsub.settings
      .get('geminiApiKey')
      .then((value: string) => {
        setHasApiKey(!!(value && value.trim()));
        setKeyDraft(value || '');
      })
      .catch(() => setHasApiKey(false));
  }, []);

  // Tải SRT khi đổi tác vụ (chỉ phụ thuộc selectedTaskId để không mất thay đổi chưa lưu)
  useEffect(() => {
    if (!selectedTaskId) {
      setLines([]);
      return;
    }
    const task = tasksRef.current.find((t) => t.id === selectedTaskId);
    if (!task?.srtPath) {
      setLines([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setStatusError(false);
    setStatusMessage('Đang tải file SRT...');
    window.vanhsub.tasks
      .readSrt(task.srtPath)
      .then((content) => {
        if (cancelled) return;
        const parsed = parseSrt(content);
        setLines(parsed);
        setDirty(false);
        setLoading(false);
        setStatusMessage(`Đã tải ${parsed.length} dòng phụ đề`);
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
  }, [selectedTaskId]);

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
    const task = tasksRef.current.find((t) => t.id === selectedTaskId);
    if (!task?.srtPath) return;

    try {
      setLoading(true);
      setStatusError(false);
      setStatusMessage('Đang lưu file SRT...');
      await window.vanhsub.tasks.writeSrt(task.srtPath, serializeSrt(lines));
      setDirty(false);
      setLoading(false);
      setStatusMessage('Đã lưu thành công!');
    } catch (err: any) {
      setLoading(false);
      setStatusError(true);
      setStatusMessage('Lỗi khi lưu SRT: ' + (err?.message || err));
    }
  };

  const handlePolishLine = async (index: number) => {
    if (aiBusyIndex !== null) return;
    setStatusError(false);
    setStatusMessage(`Đang gọi Gemini hiệu đính câu #${index + 1}...`);
    setAiBusyIndex(index);
    try {
      const polished = await window.vanhsub.ai.polishLine({
        text: lines[index].text,
        prev: lines[index - 1]?.text,
        next: lines[index + 1]?.text,
      });
      updateLine(index, { text: polished });
      setStatusMessage(`Đã chỉnh câu #${index + 1} bằng AI — nhớ bấm "Lưu thay đổi" để ghi xuống file.`);
    } catch (err: any) {
      const message: string = err?.message || String(err);
      setStatusError(true);
      setStatusMessage(message);
      if (message.includes('API key')) setShowKeyInput(true);
    } finally {
      setAiBusyIndex(null);
    }
  };

  const handleSaveKey = async () => {
    setSavingKey(true);
    try {
      await window.vanhsub.settings.set('geminiApiKey', keyDraft.trim());
      setHasApiKey(keyDraft.trim().length > 0);
      setShowKeyInput(false);
      setStatusError(false);
      setStatusMessage('Đã lưu Gemini API key');
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
          <label className="text-xs font-semibold text-slate-300">Chọn tác vụ cần hiệu đính:</label>
          <select
            value={selectedTaskId || ''}
            onChange={(e) => setSelectedTaskId(e.target.value || null)}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
          >
            <option value="">-- Chọn tác vụ đã có SRT --</option>
            {editorTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fileName}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setShowKeyInput((v) => !v)}
            title="Cấu hình Gemini API key (dùng cho Sửa câu bằng AI)"
            className={[
              'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition cursor-pointer',
              hasApiKey
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700',
            ].join(' ')}
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>{hasApiKey ? 'Gemini: đã có key' : 'Gemini: chưa có key'}</span>
          </button>

          {showKeyInput && (
            <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-1.5">
              <input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="Dán Gemini API key (AIza...)"
                className="w-64 bg-transparent text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveKey}
                disabled={savingKey || !keyDraft.trim()}
                className="btn-vanh-gradient rounded-lg px-2.5 py-1 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
              >
                {savingKey ? 'Đang lưu...' : 'Lưu key'}
              </button>
            </div>
          )}

          {statusMessage && (
            <span className={`text-xs font-mono ${statusError ? 'text-rose-400' : 'text-brand-cyan'}`}>
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
              className="btn-vanh-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              <span>Lưu thay đổi (.srt){dirty ? ' •' : ''}</span>
            </button>
          )}
        </div>
      </div>

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
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Danh sách phụ đề ({lines.length} dòng){dirty ? ' — chưa lưu' : ''}
              </h3>
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
                  const isActive = index === activeIndex;
                  return (
                    <div
                      key={item.id}
                      ref={isActive ? activeRowRef : null}
                      onClick={() => seekTo(item.startMs)}
                      className={[
                        'group flex flex-col gap-2 rounded-2xl border bg-slate-900/90 p-3 text-xs transition',
                        isActive
                          ? 'border-brand-cyan/70 ring-1 ring-brand-cyan/40'
                          : 'border-slate-800/80 hover:border-brand-indigo/50',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span className="rounded-md bg-slate-800 px-2 py-0.5 font-bold text-brand-cyan">
                          #{index + 1}
                        </span>
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
                        <button
                          type="button"
                          onClick={() => handlePolishLine(index)}
                          disabled={aiBusyIndex !== null || !item.text.trim()}
                          title="Sửa câu này bằng AI (Gemini) — sửa lỗi chính tả, ngữ pháp, làm mượt câu"
                          className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-indigo/40 bg-brand-indigo/10 text-brand-cyan transition hover:bg-brand-indigo/25 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                        >
                          {aiBusyIndex === index ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Wand2 className="h-4 w-4" />
                          )}
                        </button>
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
              Xem trước & Timeline
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
              <p>• Nút đũa thần (Wand2) gọi Gemini hiệu đính từng câu, giữ ngữ cảnh câu liền trước/sau.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
