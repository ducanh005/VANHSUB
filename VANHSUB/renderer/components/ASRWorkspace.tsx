import React, { useEffect, useMemo, useState } from 'react';
import {
  AudioLines,
  Copy,
  FileUp,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  ScanText,
  Square,
} from 'lucide-react';
import type { Task, TaskStatus } from '../types/task';
import type { OcrStartOptions } from '../types/electron';
import { parseSrt } from '../lib/srt';
import ASRModelSelector from './ASRModelSelector';
import OcrConfigModal from './OcrConfigModal';

/**
 * Workspace dành riêng cho giai đoạn Phụ đề & ASR:
 * - Phiên âm / phiên âm lại từng tác vụ với model Whisper tuỳ chọn
 * - Quét phụ đề cứng (hardsub) bằng OCR cho video
 * - Nhập file .srt có sẵn (bỏ qua phiên âm)
 * - Xem nhanh + copy phụ đề đã tạo
 */

const STATUS_STYLE: Record<TaskStatus, { label: string; cls: string }> = {
  queued: { label: 'Chờ xử lý', cls: 'border-slate-700 bg-slate-800 text-slate-400' },
  transcribing: { label: 'Đang phiên âm', cls: 'border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan' },
  ocr: { label: 'Đang quét OCR', cls: 'border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan' },
  translating: { label: 'Đang dịch', cls: 'border-brand-indigo/40 bg-brand-indigo/10 text-brand-indigo' },
  exporting: { label: 'Đang xuất', cls: 'border-brand-indigo/40 bg-brand-indigo/10 text-brand-indigo' },
  dubbing: { label: 'Đang lồng tiếng', cls: 'border-brand-indigo/40 bg-brand-indigo/10 text-brand-indigo' },
  done: { label: 'Hoàn tất', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' },
  error: { label: 'Lỗi', cls: 'border-rose-500/30 bg-rose-500/10 text-rose-400' },
  cancelled: { label: 'Đã huỷ', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-400' },
};

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'opus', 'wma'];

function isAudioFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return AUDIO_EXTENSIONS.includes(ext);
}

export default function ASRWorkspace({ tasks }: { tasks: Task[] }) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [model, setModel] = useState('base');
  const [srtContent, setSrtContent] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [isOcrModalOpen, setIsOcrModalOpen] = useState(false);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const isTranscribing = selectedTask?.status === 'transcribing';
  const isOcrRunning = selectedTask?.status === 'ocr';
  const isBusy = isTranscribing || isOcrRunning || starting;
  const isAudio = selectedTask ? isAudioFile(selectedTask.filePath) : false;
  const hasSrt = !!selectedTask?.srtPath;

  // Mặc định chọn task đầu tiên
  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) setSelectedTaskId(tasks[0].id);
  }, [tasks, selectedTaskId]);

  // Đồng bộ model khi đổi tác vụ
  useEffect(() => {
    if (selectedTask) setModel(selectedTask.asrModel || 'base');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTask?.id]);

  // Tải nội dung phụ đề khi đổi task / khi phiên âm xong (updatedAt đổi)
  useEffect(() => {
    const srtPath = selectedTask?.srtPath;
    if (!srtPath || typeof window === 'undefined' || !window.vanhsub?.tasks?.readSrt) {
      setSrtContent(null);
      return;
    }
    let cancelled = false;
    window.vanhsub.tasks
      .readSrt(srtPath)
      .then((content) => {
        if (!cancelled) setSrtContent(content);
      })
      .catch(() => {
        if (!cancelled) setSrtContent(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTask?.srtPath, selectedTask?.status, selectedTask?.updatedAt]);

  const lineCount = useMemo(() => (srtContent ? parseSrt(srtContent).length : 0), [srtContent]);

  const handleModelChange = (m: string) => {
    setModel(m);
    if (selectedTask && typeof window !== 'undefined' && window.vanhsub?.tasks?.update) {
      window.vanhsub.tasks.update(selectedTask.id, { asrModel: m }).catch(() => {});
    }
  };

  const handleStart = async (force: boolean) => {
    if (!selectedTask || isBusy) return;
    if (
      force &&
      !window.confirm('Phiên âm lại sẽ GHI ĐÈ phụ đề hiện có của tác vụ này. Tiếp tục?')
    ) {
      return;
    }
    setStarting(true);
    setMessage('');
    setIsError(false);
    try {
      await window.vanhsub.tasks.update(selectedTask.id, { asrModel: model });
      await window.vanhsub.tasks.start(selectedTask.id);
      setMessage('Đã bắt đầu phiên âm — theo dõi tiến trình bên dưới và ở Trang chủ.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    } finally {
      setStarting(false);
    }
  };

  // Mở modal cấu hình OCR cho video
  const handleStartOcr = () => {
    if (!selectedTask || isBusy || isAudio) return;
    if (
      hasSrt &&
      !window.confirm(
        'Tác vụ đã có phụ đề. Quét OCR sẽ tạo file .srt mới và trỏ tác vụ sang file đó (file cũ vẫn giữ trên đĩa). Tiếp tục?'
      )
    ) {
      return;
    }
    setIsOcrModalOpen(true);
  };

  // Thực thi OCR với cấu hình do người dùng lựa chọn từ modal
  const handleExecuteOcr = async (options: OcrStartOptions) => {
    if (!selectedTask) return;
    setMessage('');
    setIsError(false);
    try {
      await window.vanhsub.ocr.start(selectedTask.id, options);
      const modeLabel = options.mode ? options.mode.toUpperCase() : 'AUTO';
      setMessage(`Đã bắt đầu quét OCR (chế độ ${modeLabel}) — theo dõi tiến trình ở Trang chủ.`);
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    }
  };

  // Huỷ phiên âm đang chạy — dừng giữa các chunk audio
  const handleCancelTranscribe = async () => {
    if (!selectedTask || !isTranscribing) return;
    try {
      await window.vanhsub.tasks.cancel(selectedTask.id);
      setMessage('Đã gửi yêu cầu huỷ phiên âm — dừng sau chunk hiện tại.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    }
  };

  const handleCancelOcr = async () => {
    if (!selectedTask || !isOcrRunning) return;
    try {
      await window.vanhsub.ocr.cancel(selectedTask.id);
      setMessage('Đã gửi yêu cầu huỷ quét OCR — dừng sau khung hình hiện tại.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    }
  };

  const handleImportSrt = async () => {
    if (!selectedTask) return;
    if (typeof window === 'undefined' || !window.vanhsub?.dialog?.openSrtFile) return;
    try {
      const srtPath = await window.vanhsub.dialog.openSrtFile();
      if (!srtPath) return;
      await window.vanhsub.tasks.importSrt(selectedTask.id, srtPath);
      setMessage('Đã nhập file phụ đề .srt — có thể dịch hoặc tạo lồng tiếng luôn.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || 'Không thể nhập file SRT.');
    }
  };

  const handleCopy = async () => {
    if (!srtContent) return;
    try {
      await navigator.clipboard.writeText(srtContent);
      setMessage('Đã copy toàn bộ phụ đề vào clipboard.');
    } catch {
      setIsError(true);
      setMessage('Không copy được phụ đề.');
    }
  };

  const handleOpenFolder = async () => {
    if (!selectedTask) return;
    try {
      await window.vanhsub.dialog.showInFolder(selectedTask.srtPath || selectedTask.filePath);
    } catch {
      // bỏ qua
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden p-6">
      {/* Thanh tiêu đề */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
          <AudioLines className="h-4 w-4 text-brand-cyan" />
          <span>Phiên âm & Quản lý phụ đề</span>
          {selectedTask && (
            <span className="ml-2 max-w-[280px] truncate text-slate-400" title={selectedTask.fileName}>
              {selectedTask.fileName}
            </span>
          )}
        </div>
        {message && (
          <span
            className={`max-w-[420px] truncate text-xs font-mono ${isError ? 'text-rose-400' : 'text-brand-cyan'}`}
            title={message}
          >
            {message}
          </span>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)] gap-4 overflow-hidden">
        {/* Danh sách tác vụ */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
          <div className="border-b border-slate-800/80 px-4 py-2.5 text-xs font-semibold text-slate-200">
            Tác vụ ({tasks.length})
          </div>
          <div className="flex-1 space-y-1.5 overflow-y-auto p-2.5">
            {tasks.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-500">
                Chưa có tác vụ — thêm video ở Trang chủ.
              </p>
            )}
            {tasks.map((t) => {
              const st = STATUS_STYLE[t.status];
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTaskId(t.id)}
                  className={[
                    'w-full rounded-xl border p-2.5 text-left text-xs transition cursor-pointer',
                    t.id === selectedTaskId
                      ? 'border-brand-cyan/50 bg-brand-cyan/5'
                      : 'border-slate-800/80 bg-slate-900/60 hover:bg-slate-900',
                  ].join(' ')}
                >
                  <p className="truncate font-medium text-slate-200" title={t.fileName}>
                    {t.fileName}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${st.cls}`}
                    >
                      {st.label}
                    </span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                      {t.asrModel || 'base'}
                    </span>
                    {t.srtPath && (
                      <span className="font-mono text-[10px] text-emerald-500">✓ SRT</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Chi tiết tác vụ */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          {!selectedTask ? (
            <div className="flex flex-1 items-center justify-center text-xs text-slate-500">
              Chọn một tác vụ để phiên âm hoặc xem phụ đề.
            </div>
          ) : (
            <>
              {/* Hành động */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleStart(hasSrt)}
                  disabled={isBusy}
                  className="btn-vanh-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {isTranscribing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : hasSrt ? (
                    <RefreshCw className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  <span>
                    {isTranscribing
                      ? 'Đang phiên âm...'
                      : hasSrt
                        ? 'Phiên âm lại'
                        : 'Bắt đầu phiên âm'}
                  </span>
                </button>
                {isTranscribing && (
                  <button
                    type="button"
                    onClick={handleCancelTranscribe}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/20 cursor-pointer"
                  >
                    <Square className="h-3 w-3 fill-amber-400" />
                    <span>Huỷ phiên âm</span>
                  </button>
                )}
                {isAudio ? (
                  <button
                    type="button"
                    disabled
                    title="OCR chỉ hỗ trợ file video có phụ đề ghẽ trong khung hình"
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-500 disabled:opacity-60"
                  >
                    <ScanText className="h-3.5 w-3.5" />
                    <span>Quét OCR</span>
                  </button>
                ) : isOcrRunning ? (
                  <button
                    type="button"
                    onClick={handleCancelOcr}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/20 cursor-pointer"
                  >
                    <Square className="h-3 w-3 fill-amber-400" />
                    <span>Huỷ quét OCR</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartOcr}
                    disabled={isBusy}
                    title="Video có phụ đề ghẽ sẵn trong khung hình? Quét bằng OCR để tạo phụ đề — không cần phiên âm"
                    className="inline-flex items-center gap-2 rounded-xl border border-brand-cyan/40 bg-brand-cyan/10 px-3.5 py-2 text-xs font-semibold text-brand-cyan hover:bg-brand-cyan/20 cursor-pointer disabled:opacity-50"
                  >
                    <ScanText className="h-3.5 w-3.5" />
                    <span>Quét OCR</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleImportSrt}
                  disabled={isBusy}
                  title="Video đã có sẵn phụ đề .srt? Nhập vào để bỏ qua phiên âm"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer disabled:opacity-50"
                >
                  <FileUp className="h-3.5 w-3.5" />
                  <span>Nhập SRT</span>
                </button>
                {hasSrt && (
                  <>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy phụ đề</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenFolder}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      <span>Mở thư mục</span>
                    </button>
                  </>
                )}
              </div>

              {/* Chọn model */}
              <ASRModelSelector currentModel={model} onModelChange={handleModelChange} />

              {/* Xem nhanh phụ đề */}
              <div className="flex min-h-[200px] flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
                <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-2.5 text-xs font-semibold text-slate-200">
                  <span>
                    Phụ đề{' '}
                    {hasSrt && <span className="font-mono text-[11px] text-slate-500">({lineCount} dòng)</span>}
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed">
                  {!hasSrt ? (
                    <p className="py-8 text-center text-slate-500">
                      {isOcrRunning
                        ? 'Đang quét phụ đề bằng OCR — kết quả sẽ hiện ở đây khi xong...'
                        : 'Tác vụ chưa có phụ đề — bấm "Bắt đầu phiên âm", "Quét OCR" hoặc "Nhập SRT".'}
                    </p>
                  ) : srtContent === null ? (
                    <p className="py-8 text-center text-slate-500">Đang tải phụ đề...</p>
                  ) : (
                    <pre className="whitespace-pre-wrap text-slate-300">{srtContent}</pre>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal Cấu hình OCR đa chế độ */}
      <OcrConfigModal
        isOpen={isOcrModalOpen}
        onClose={() => setIsOcrModalOpen(false)}
        task={selectedTask}
        onStartOcr={handleExecuteOcr}
      />
    </div>
  );
}
