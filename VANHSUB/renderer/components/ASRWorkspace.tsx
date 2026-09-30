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
  Sparkles,
  Square,
  Cpu,
  Users,
  Zap,
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

type ASRWorkspaceProps = {
  tasks: Task[];
  selectedTaskId?: string | null;
  onSelectTaskId?: (id: string | null) => void;
};

export default function ASRWorkspace({ tasks, selectedTaskId: propSelectedTaskId, onSelectTaskId }: ASRWorkspaceProps) {
  const [internalTaskId, setInternalTaskId] = useState<string | null>(null);
  const selectedTaskId = propSelectedTaskId !== undefined ? propSelectedTaskId : internalTaskId;
  const setSelectedTaskId = (id: string | null) => {
    if (onSelectTaskId) onSelectTaskId(id);
    else setInternalTaskId(id);
  };
  const [model, setModel] = useState('base');
  const [asrEngine, setAsrEngine] = useState<'faster-whisper' | 'whisper-cpp'>('faster-whisper');
  const [enableDiarization, setEnableDiarization] = useState(false);
  const [speakerCount, setSpeakerCount] = useState<number>(2);
  const [fwStatus, setFwStatus] = useState<{ available: boolean; useCuda: boolean; reason?: string } | null>(null);
  const [srtContent, setSrtContent] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [isOcrModalOpen, setIsOcrModalOpen] = useState(false);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const isTranscribing = selectedTask?.status === 'transcribing';
  const isOcrRunning = selectedTask?.status === 'ocr';
  const isHybridRunning =
    (selectedTask?.status as string) === 'hybrid' ||
    Boolean(selectedTask?.stageDescription?.includes('[Hybrid]') && (isTranscribing || isOcrRunning));
  const isBusy = isTranscribing || isOcrRunning || isHybridRunning || starting;
  const isAudio = selectedTask ? isAudioFile(selectedTask.filePath) : false;
  const hasSrt = !!selectedTask?.srtPath;

  // Thăm dò khả dụng Faster-Whisper & CUDA khi nạp component
  useEffect(() => {
    if (typeof window !== 'undefined' && window.vanhsub?.asr?.checkFasterWhisper) {
      window.vanhsub.asr.checkFasterWhisper().then(setFwStatus).catch(() => {});
    }
  }, []);

  // Mặc định chọn task đầu tiên hoặc fallback nếu task hiện tại bị xoá
  useEffect(() => {
    if (tasks.length === 0) {
      if (selectedTaskId !== null) setSelectedTaskId(null);
      return;
    }
    const exists = tasks.some((t) => t.id === selectedTaskId);
    if (!exists) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [tasks, selectedTaskId]);

  // Đồng bộ model, engine và diarization khi đổi tác vụ
  useEffect(() => {
    if (selectedTask) {
      setModel(selectedTask.asrModel || 'base');
      setAsrEngine(selectedTask.asrEngine || 'faster-whisper');
      setEnableDiarization(Boolean(selectedTask.enableDiarization));
      if (selectedTask.speakerCount) setSpeakerCount(selectedTask.speakerCount);
    }
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

  const handleEngineChange = (engine: 'faster-whisper' | 'whisper-cpp') => {
    setAsrEngine(engine);
    if (selectedTask && typeof window !== 'undefined' && window.vanhsub?.tasks?.update) {
      window.vanhsub.tasks.update(selectedTask.id, { asrEngine: engine }).catch(() => {});
    }
  };

  const handleDiarizationToggle = (enabled: boolean) => {
    setEnableDiarization(enabled);
    if (selectedTask && typeof window !== 'undefined' && window.vanhsub?.tasks?.update) {
      window.vanhsub.tasks.update(selectedTask.id, { enableDiarization: enabled }).catch(() => {});
    }
  };

  const handleSpeakerCountChange = (count: number) => {
    setSpeakerCount(count);
    if (selectedTask && typeof window !== 'undefined' && window.vanhsub?.tasks?.update) {
      window.vanhsub.tasks.update(selectedTask.id, { speakerCount: count }).catch(() => {});
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
      await window.vanhsub.tasks.update(selectedTask.id, {
        asrModel: model,
        asrEngine,
        enableDiarization,
        speakerCount: enableDiarization ? speakerCount : undefined,
      });
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

  const handleStartHybrid = async () => {
    if (!selectedTask || isBusy) return;
    if (isAudio) {
      setIsError(true);
      setMessage('Chế độ Kết hợp Whisper + OCR chỉ hỗ trợ file video (cần hình ảnh để quét chữ).');
      return;
    }
    setStarting(true);
    setIsError(false);
    setMessage('Đang khởi chạy Kết hợp Whisper + OCR (Độ chính xác tuyệt đối)...');
    try {
      if (!window.vanhsub?.tasks?.startHybrid) {
        throw new Error('Chức năng startHybrid chưa sẵn sàng trên hệ thống.');
      }
      await window.vanhsub.tasks.startHybrid(selectedTask.id, {
        asrModel: model,
      });
      setMessage('Đang chạy Kết hợp Whisper + OCR: Neo thời gian theo OCR và sửa lỗi câu chữ bằng Whisper.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    } finally {
      setStarting(false);
    }
  };

  const handleCancelHybrid = async () => {
    if (!selectedTask || !isHybridRunning) return;
    try {
      if (window.vanhsub?.tasks?.cancelHybrid) {
        await window.vanhsub.tasks.cancelHybrid(selectedTask.id);
      }
      setMessage('Đã gửi yêu cầu huỷ tác vụ kết hợp Whisper + OCR.');
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
              const isTaskHybrid =
                (t.status as string) === 'hybrid' ||
                Boolean(t.stageDescription?.includes('[Hybrid]') && (t.status === 'transcribing' || t.status === 'ocr'));
              const st = isTaskHybrid
                ? { label: 'Đang kết hợp', cls: 'border-purple-500/40 bg-purple-500/10 text-purple-300' }
                : STATUS_STYLE[t.status] || { label: t.status, cls: 'border-slate-700 bg-slate-800 text-slate-400' };
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
                {/* Nút Kết hợp Whisper + OCR (R2 - Độ chính xác tuyệt đối) */}
                {isAudio ? (
                  <button
                    type="button"
                    disabled
                    title="Chế độ Kết hợp Whisper + OCR yêu cầu file video (cần hình ảnh để quét chữ)"
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-500 disabled:opacity-60"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Kết hợp Whisper + OCR</span>
                  </button>
                ) : isHybridRunning ? (
                  <button
                    type="button"
                    onClick={handleCancelHybrid}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/20 cursor-pointer"
                  >
                    <Square className="h-3 w-3 fill-amber-400" />
                    <span>Huỷ kết hợp</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartHybrid}
                    disabled={isBusy}
                    title="Chạy đồng thời Whisper ASR và Quét OCR: Neo mốc thời gian theo khung hình video và dùng giọng nói để sửa lỗi chữ"
                    className="inline-flex items-center gap-2 rounded-xl border border-purple-500/50 bg-gradient-to-r from-purple-500/20 to-brand-cyan/20 px-3.5 py-2 text-xs font-semibold text-purple-200 hover:from-purple-500/30 hover:to-brand-cyan/30 cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                    <span>Kết hợp Whisper + OCR</span>
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

              {/* Hiển thị tiến trình chi tiết khi tác vụ đang chạy */}
              {selectedTask && isBusy && (
                <div className="flex flex-col gap-1.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
                  <div className="flex items-center justify-between text-slate-300">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" />
                      <span className="font-medium">{selectedTask.stageDescription || 'Đang xử lý tác vụ...'}</span>
                    </div>
                    <span className="font-mono text-[11px] text-brand-cyan">{selectedTask.progress || 0}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-brand-cyan transition-all duration-300"
                      style={{ width: `${selectedTask.progress || 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Cấu hình Động cơ ASR & Phân tách người nói */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-brand-cyan" />
                    <span className="text-xs font-semibold text-slate-200">Động cơ nhận diện giọng nói (ASR Engine)</span>
                  </div>
                  {fwStatus && asrEngine === 'faster-whisper' && (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        fwStatus.available
                          ? fwStatus.useCuda
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                            : 'border-blue-500/30 bg-blue-500/10 text-blue-400'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                      }`}
                      title={fwStatus.reason || ''}
                    >
                      {fwStatus.available
                        ? fwStatus.useCuda
                          ? 'CUDA GPU'
                          : 'CPU int8'
                        : 'Sẽ tự động fallback về whisper.cpp'}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleEngineChange('faster-whisper')}
                    className={`flex flex-col text-left p-2.5 rounded-xl border transition cursor-pointer ${
                      asrEngine === 'faster-whisper'
                        ? 'border-brand-cyan/60 bg-brand-cyan/10 text-white'
                        : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-medium text-xs">
                      <Zap className="h-3.5 w-3.5 text-brand-cyan" />
                      <span>Faster-Whisper</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-brand-cyan/20 text-brand-cyan font-mono">Nhanh 3-4x</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      CTranslate2, timestamps theo từ, hỗ trợ phân tách người nói. Tự fallback nếu thiếu module.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleEngineChange('whisper-cpp')}
                    className={`flex flex-col text-left p-2.5 rounded-xl border transition cursor-pointer ${
                      asrEngine === 'whisper-cpp'
                        ? 'border-brand-indigo/60 bg-brand-indigo/10 text-white'
                        : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-medium text-xs">
                      <Cpu className="h-3.5 w-3.5 text-brand-indigo" />
                      <span>Whisper.cpp</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">Native C++</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Chạy trực tiếp binary C++, không phụ thuộc môi trường Python. Ổn định và độc lập.
                    </p>
                  </button>
                </div>

                {/* Speaker Diarization Controls */}
                <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={enableDiarization}
                      onChange={(e) => handleDiarizationToggle(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-brand-cyan focus:ring-brand-cyan/20"
                    />
                    <div className="flex items-center gap-1.5 text-xs text-slate-200">
                      <Users className="h-3.5 w-3.5 text-purple-400" />
                      <span>Phân tách người nói (Speaker Diarization)</span>
                    </div>
                  </label>

                  {enableDiarization && (
                    <div className="flex items-center gap-2 text-xs text-slate-300">
                      <span className="text-[11px] text-slate-400">Số người nói dự kiến:</span>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={speakerCount}
                        onChange={(e) => handleSpeakerCountChange(Math.max(1, parseInt(e.target.value) || 2))}
                        className="w-14 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-center font-mono text-xs text-white focus:border-brand-cyan focus:outline-none"
                      />
                    </div>
                  )}
                </div>
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
                  {selectedTask?.speakers && selectedTask.speakers.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] font-normal text-purple-300">
                      <Users className="h-3.5 w-3.5" />
                      <span>{selectedTask.speakers.length} người nói ({selectedTask.speakers.join(', ')})</span>
                    </div>
                  )}
                </div>
                {selectedTask?.ocrStats && (
                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-800/80 bg-slate-950/60 px-4 py-1.5 text-[11px] text-slate-300">
                    <Sparkles className="h-3.5 w-3.5 text-brand-cyan" />
                    <span>OCR detected: <strong className="text-white">{selectedTask.ocrStats.finalEvents}</strong> events</span>
                    <span className="text-slate-600">•</span>
                    <span>High conf: <strong className="text-emerald-400">{selectedTask.ocrStats.highConfidence}</strong></span>
                    <span className="text-slate-600">•</span>
                    <span>Review: <strong className="text-amber-400">{selectedTask.ocrStats.needsReview}</strong></span>
                    <span className="text-slate-600">•</span>
                    <span>Deduped: <strong className="text-purple-300">{selectedTask.ocrStats.duplicatesRemoved}</strong></span>
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed">
                  {!hasSrt ? (
                    <p className="py-8 text-center text-slate-500">
                      {isHybridRunning
                        ? 'Đang kết hợp Whisper + OCR — phụ đề sẽ xuất hiện ở đây khi xong...'
                        : isOcrRunning
                          ? 'Đang quét phụ đề bằng OCR — kết quả sẽ hiện ở đây khi xong...'
                          : isTranscribing
                            ? 'Đang phiên âm Whisper — kết quả sẽ hiện ở đây khi xong...'
                            : 'Tác vụ chưa có phụ đề — bấm "Bắt đầu phiên âm", "Quét OCR", "Kết hợp Whisper + OCR" hoặc "Nhập SRT".'}
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
