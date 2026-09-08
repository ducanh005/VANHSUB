import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Globe2,
  Languages,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Save,
  XCircle,
} from 'lucide-react';
import type { Task } from '../types/task';
import { formatMs, parseSrt, serializeSrt, type SrtLine } from '../lib/srt';

type Props = {
  tasks: Task[];
  selectedTaskId?: string | null;
  onSelectTaskId?: (id: string | null) => void;
  onNavigateTab?: (tab: string) => void;
  isActive?: boolean;
};

const TARGET_LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語 (Nhật)' },
  { code: 'ko', label: '한국어 (Hàn)' },
  { code: 'zh', label: '中文 (Trung)' },
];

function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('vi-VN');
  } catch {
    return '';
  }
}

export default function TranslatePage({
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

  const [targetLanguage, setTargetLanguage] = useState('vi');
  const [originalLines, setOriginalLines] = useState<SrtLine[]>([]);
  const [translatedLines, setTranslatedLines] = useState<SrtLine[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savingTranslation, setSavingTranslation] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const isTranslating = selectedTask?.status === 'translating';
  const hasTranslatedSrt = !!selectedTask?.translatedSrtPath;

  // Nạp ngôn ngữ đích mặc định từ settings
  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.settings) return;
    window.vanhsub.settings
      .get('targetLanguage')
      .then((v: string) => {
        if (v) setTargetLanguage(v);
      })
      .catch(() => {});
  }, []);

  // Tự chọn task đầu tiên có SRT nếu chưa chọn
  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) {
      const firstWithSrt = tasks.find((t) => t.srtPath);
      if (firstWithSrt) setSelectedTaskId(firstWithSrt.id);
    }
  }, [tasks, selectedTaskId]);

  // Khi tab được kích hoạt lại (chuyển sang tab Dịch thuật) và không có sửa đổi dở: tự làm mới từ đĩa
  useEffect(() => {
    if (isActive && !dirty) {
      setReloadKey((k) => k + 1);
    }
  }, [isActive]);

  // Tải SRT gốc + bản dịch (nếu có) khi đổi task hoặc reloadKey tăng
  useEffect(() => {
    if (!selectedTask?.srtPath) {
      setOriginalLines([]);
      setTranslatedLines(null);
      setDirty(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setMessage('Đang tải phụ đề...');
    setIsError(false);

    const loadOriginal = window.vanhsub.tasks.readSrt(selectedTask.srtPath);
    const loadTranslated = selectedTask.translatedSrtPath
      ? window.vanhsub.tasks.readSrt(selectedTask.translatedSrtPath)
      : Promise.resolve(null);

    Promise.all([loadOriginal, loadTranslated])
      .then(([original, translated]) => {
        if (cancelled) return;
        setOriginalLines(parseSrt(original));
        setTranslatedLines(translated ? parseSrt(translated) : null);
        setDirty(false);
        setLoading(false);
        setMessage(translated ? 'Đã nạp bản dịch mới nhất từ đĩa.' : 'Chưa dịch: bấm "Dịch bằng Gemini" để bắt đầu.');
      })
      .catch((err: any) => {
        if (cancelled) return;
        setLoading(false);
        setIsError(true);
        setMessage('Không thể đọc file SRT: ' + (err?.message || err));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTask?.srtPath, selectedTask?.translatedSrtPath, reloadKey]);

  const handleTranslate = async () => {
    if (!selectedTaskId) return;
    setMessage('');
    setIsError(false);
    try {
      await window.vanhsub.translate.start(selectedTaskId, targetLanguage);
      setMessage('Đã gửi yêu cầu dịch — theo dõi tiến trình bên dưới.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    }
  };

  const handleCancelTranslate = async () => {
    if (!selectedTaskId) return;
    try {
      await window.vanhsub.translate.cancel(selectedTaskId);
      setMessage('Đã gửi yêu cầu huỷ — dừng sau batch hiện tại.');
    } catch {
      // bỏ qua
    }
  };

  const handleSaveTranslatedSrt = async () => {
    if (!selectedTask?.translatedSrtPath || !translatedLines) return;
    setSavingTranslation(true);
    try {
      await window.vanhsub.tasks.writeSrt(selectedTask.translatedSrtPath, serializeSrt(translatedLines));
      setDirty(false);
      setMessage('Đã lưu các chỉnh sửa của bản dịch thành công!');
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setIsError(true);
      setMessage('Lỗi khi lưu bản dịch: ' + (err?.message || err));
    } finally {
      setSavingTranslation(false);
    }
  };

  const updateTranslatedLine = (index: number, text: string) => {
    if (!translatedLines) return;
    setTranslatedLines((prev) => {
      if (!prev) return prev;
      return prev.map((line, i) => (i === index ? { ...line, text } : line));
    });
    setDirty(true);
  };

  // Tự xoá thông báo lỗi khi task chuyển trạng thái
  useEffect(() => {
    if (selectedTask && selectedTask.status !== 'error') return;
    if (selectedTask?.status === 'error' && selectedTask.errorMessage) {
      setIsError(true);
      setMessage(selectedTask.errorMessage);
    }
  }, [selectedTask?.status, selectedTask?.errorMessage]);

  const lineCountMismatch = useMemo(() => {
    if (!translatedLines || !originalLines.length) return false;
    return translatedLines.length !== originalLines.length;
  }, [originalLines, translatedLines]);

  const comparisonRows = useMemo(() => {
    if (!translatedLines && originalLines.length === 0) return null;
    const max = Math.max(originalLines.length, translatedLines?.length || 0);
    const rows: Array<{ index: number; original: SrtLine | undefined; translated: SrtLine | undefined }> = [];
    for (let i = 0; i < max; i++) {
      rows.push({ index: i, original: originalLines[i], translated: translatedLines?.[i] });
    }
    return rows;
  }, [originalLines, translatedLines]);

  const editorTasks = tasks.filter((t) => t.srtPath);

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden p-6">
      {/* Thanh công cụ */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-slate-300">Tác vụ:</label>
          <select
            value={selectedTaskId || ''}
            onChange={(e) => {
              if (dirty && !window.confirm('Bản dịch có chỉnh sửa chưa lưu. Đổi tác vụ sẽ mất thay đổi?')) return;
              setSelectedTaskId(e.target.value || null);
            }}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
          >
            <option value="">-- Chọn tác vụ đã có SRT --</option>
            {editorTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fileName} ({formatTimeAgo(t.createdAt)})
              </option>
            ))}
          </select>

          <label className="text-xs font-semibold text-slate-300">Dịch sang:</label>
          <select
            value={targetLanguage}
            onChange={(e) => setTargetLanguage(e.target.value)}
            disabled={isTranslating}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none disabled:opacity-50"
          >
            {TARGET_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>

          {/* Nút làm mới */}
          <button
            type="button"
            onClick={() => {
              if (dirty && !window.confirm('Tải lại sẽ xoá các chỉnh sửa chưa lưu. Tiếp tục?')) return;
              setReloadKey((k) => k + 1);
            }}
            title="Tải lại nội dung phụ đề và bản dịch mới nhất từ đĩa"
            className="rounded-xl border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-brand-cyan' : ''}`} />
          </button>

          {message && (
            <span className={`max-w-[340px] truncate text-xs font-mono ${isError ? 'text-rose-400' : 'text-brand-cyan'}`} title={message}>
              {message}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Nút mở trong Hiệu đính */}
          {onNavigateTab && selectedTaskId && (
            <button
              type="button"
              onClick={() => onNavigateTab('editor')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 cursor-pointer transition"
              title="Mở video & timeline câu trong tab Hiệu đính phụ đề"
            >
              <Edit3 className="h-3.5 w-3.5 text-brand-cyan" />
              <span>Mở Hiệu đính</span>
            </button>
          )}

          {isTranslating && (
            <button
              type="button"
              onClick={handleCancelTranslate}
              title="Huỷ dịch — dừng sau batch hiện tại"
              className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 cursor-pointer"
            >
              <XCircle className="h-4 w-4" />
              <span>Huỷ dịch</span>
            </button>
          )}

          {dirty && hasTranslatedSrt && (
            <button
              type="button"
              onClick={handleSaveTranslatedSrt}
              disabled={savingTranslation}
              className="btn-vanh-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              {savingTranslation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              <span>Lưu bản dịch (*)</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleTranslate}
            disabled={!selectedTaskId || isTranslating || loading}
            className="btn-vanh-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {isTranslating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : hasTranslatedSrt ? (
              <RefreshCw className="h-4 w-4" />
            ) : (
              <Languages className="h-4 w-4" />
            )}
            <span>{isTranslating ? 'Đang dịch...' : hasTranslatedSrt ? 'Dịch lại' : 'Dịch bằng Gemini'}</span>
          </button>
        </div>
      </div>

      {/* Tiến trình khi đang dịch */}
      {selectedTask && isTranslating && (
        <div className="rounded-2xl border border-brand-indigo/40 bg-brand-indigo/10 p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-brand-cyan">{selectedTask.stageDescription || 'Đang dịch...'}</span>
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

      {/* Cảnh báo không khớp dòng */}
      {lineCountMismatch && hasTranslatedSrt && (
        <div className="flex items-center justify-between rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              Số dòng bản dịch ({translatedLines?.length} dòng) khác với bản gốc ({originalLines.length} dòng) do có chỉnh sửa thêm/bớt dòng ở tab Hiệu đính.
            </span>
          </div>
          <button
            type="button"
            onClick={handleTranslate}
            className="rounded-lg border border-amber-500/40 bg-amber-500/20 px-2.5 py-1 font-semibold text-amber-200 hover:bg-amber-500/30 cursor-pointer"
          >
            Dịch lại để đồng bộ
          </button>
        </div>
      )}

      {/* Nội dung chính */}
      {!selectedTaskId ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center text-slate-500 text-xs">
          <Globe2 className="h-10 w-10 text-slate-600 mb-3 animate-pulse" />
          <span>Chọn một tác vụ đã có phụ đề .srt ở menu phía trên để dịch bằng Gemini AI.</span>
        </div>
      ) : comparisonRows ? (
        <div className="flex flex-1 flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="mb-3 flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Đối chiếu gốc ↔ bản dịch ({comparisonRows.length} dòng)
              </h3>
              {dirty && (
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                  Có sửa đổi chưa lưu
                </span>
              )}
            </div>
            {hasTranslatedSrt && (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                Đã dịch · {selectedTask?.translatedSrtPath?.split(/[/\\]/).pop()}
              </span>
            )}
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto pr-1">
            {comparisonRows.map(({ index, original, translated }) => (
              <div
                key={index}
                className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2 text-[10px] font-mono text-slate-500">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 font-bold text-slate-400">#{index + 1}</span>
                    <span>Bản gốc</span>
                    {original && <span className="text-[9px] text-slate-600">({formatMs(original.startMs)} → {formatMs(original.endMs)})</span>}
                  </div>
                  <p className="whitespace-pre-line text-slate-400">{original?.text || '—'}</p>
                </div>
                <div className="min-w-0 border-l border-slate-800 pl-3">
                  <div className="mb-1 flex items-center justify-between text-[10px] font-mono text-brand-cyan">
                    <span>Bản dịch</span>
                    {translated && <span className="text-[9px] text-slate-600">({formatMs(translated.startMs)} → {formatMs(translated.endMs)})</span>}
                  </div>
                  {translated ? (
                    <textarea
                      rows={2}
                      value={translated.text}
                      onChange={(e) => updateTranslatedLine(index, e.target.value)}
                      placeholder="Nội dung bản dịch..."
                      className="w-full rounded-xl border border-slate-800 bg-slate-950/80 p-2 text-xs text-white placeholder:text-slate-600 focus:border-brand-cyan focus:outline-none"
                    />
                  ) : (
                    <p className="text-slate-600 italic">Chưa dịch — bấm "Dịch bằng Gemini" ở trên</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : loading ? (
        <div className="flex flex-1 items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/60 text-xs text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin text-brand-cyan" />
          Đang tải phụ đề...
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center text-slate-500 text-xs">
          <MessageSquareText className="h-10 w-10 text-slate-600 mb-3" />
          <span>Tác vụ này chưa có file .srt — hãy chạy phiên âm ở Trang chủ trước.</span>
        </div>
      )}
    </div>
  );
}
