import React, { useEffect, useMemo, useState } from 'react';
import { Globe2, Languages, Loader2, MessageSquareText, RefreshCw } from 'lucide-react';
import type { Task } from '../types/task';
import { parseSrt, type SrtLine } from '../lib/srt';

type Props = {
  tasks: Task[];
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

export default function TranslatePage({ tasks }: Props) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState('vi');
  const [originalLines, setOriginalLines] = useState<SrtLine[]>([]);
  const [translatedLines, setTranslatedLines] = useState<SrtLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

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

  // Tải SRT gốc + bản dịch (nếu có) khi đổi task
  useEffect(() => {
    if (!selectedTask?.srtPath) {
      setOriginalLines([]);
      setTranslatedLines(null);
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
        setLoading(false);
        setMessage(translated ? 'Đã có bản dịch — xem đối chiếu bên dưới.' : 'Chưa dịch: bấm "Dịch bằng Gemini" để bắt đầu.');
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
  }, [selectedTask?.srtPath, selectedTask?.translatedSrtPath]);

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

  // Tự xoá thông báo lỗi khi task chuyển trạng thái
  useEffect(() => {
    if (selectedTask && selectedTask.status !== 'error') return;
    if (selectedTask?.status === 'error' && selectedTask.errorMessage) {
      setIsError(true);
      setMessage(selectedTask.errorMessage);
    }
  }, [selectedTask?.status, selectedTask?.errorMessage]);

  const comparisonRows = useMemo(() => {
    if (!translatedLines) return null;
    const max = Math.max(originalLines.length, translatedLines.length);
    const rows: Array<{ index: number; original: SrtLine | undefined; translated: SrtLine | undefined }> = [];
    for (let i = 0; i < max; i++) {
      rows.push({ index: i, original: originalLines[i], translated: translatedLines[i] });
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
            onChange={(e) => setSelectedTaskId(e.target.value || null)}
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

          {message && (
            <span className={`max-w-[340px] truncate text-xs font-mono ${isError ? 'text-rose-400' : 'text-brand-cyan'}`} title={message}>
              {message}
            </span>
          )}
        </div>

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

      {/* Nội dung chính */}
      {!selectedTaskId ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center text-slate-500 text-xs">
          <Globe2 className="h-10 w-10 text-slate-600 mb-3 animate-pulse" />
          <span>Chọn một tác vụ đã có phụ đề .srt ở menu phía trên để dịch bằng Gemini AI.</span>
        </div>
      ) : comparisonRows ? (
        <div className="flex flex-1 flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="mb-3 flex items-center justify-between border-b border-slate-800/80 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Đối chiếu gốc ↔ bản dịch ({comparisonRows.length} dòng)
            </h3>
            {hasTranslatedSrt && (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                Đã dịch · lưu tại {selectedTask?.translatedSrtPath?.split(/[/\\]/).pop()}
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
                  </div>
                  <p className="whitespace-pre-line text-slate-400">{original?.text || '—'}</p>
                </div>
                <div className="min-w-0 border-l border-slate-800 pl-3">
                  <div className="mb-1 text-[10px] font-mono text-brand-cyan">Bản dịch</div>
                  <p className={`whitespace-pre-line ${translated ? 'text-white' : 'text-slate-600'}`}>
                    {translated?.text || 'Chưa dịch'}
                  </p>
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
