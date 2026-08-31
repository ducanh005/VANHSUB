import React, { useState } from 'react';
import { CheckCircle2, Film, FolderOpen, Layers, Loader2, Play } from 'lucide-react';
import type { Task } from '../types/task';

type Props = {
  tasks: Task[];
};

type ExportMode = 'hardsub' | 'softsub';

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
];

export default function ExportPage({ tasks }: Props) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [mode, setMode] = useState<ExportMode>('hardsub');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const isExporting = selectedTask?.status === 'exporting';
  const outputPath = selectedTask?.outputPath;

  const handleExport = async () => {
    if (!selectedTaskId) return;
    setMessage('');
    setIsError(false);
    try {
      await window.vanhsub.export.start(selectedTaskId, mode);
      setMessage(`Đã bắt đầu xuất video (${mode === 'hardsub' ? 'Hardsub' : 'Softsub'})...`);
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    }
  };

  const handleShowOutput = () => {
    if (outputPath && window.vanhsub?.dialog) {
      window.vanhsub.dialog.showInFolder(outputPath);
    }
  };

  const editorTasks = tasks.filter((t) => t.srtPath || t.translatedSrtPath);

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
            <option value="">-- Chọn tác vụ đã có SRT --</option>
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
          <span>Chọn một tác vụ đã có phụ đề để xuất video (Hardsub hoặc Softsub).</span>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
          {/* Chọn chế độ xuất */}
          <div className="grid gap-4 lg:grid-cols-2">
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
                      <Film className={`h-4 w-4 ${active ? 'text-brand-cyan' : 'text-slate-400'}`} />
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

          {/* Thông tin xuất + nút */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="mb-3 space-y-1.5 text-xs text-slate-400">
              <p>
                • Nguồn phụ đề:{' '}
                <span className="font-mono text-slate-200">
                  {(selectedTask.translatedSrtPath || selectedTask.srtPath || '').split(/[/\\]/).pop()}
                </span>
                {selectedTask.translatedSrtPath && (
                  <span className="ml-1.5 rounded-full border border-brand-indigo/30 bg-brand-indigo/10 px-2 py-0.5 text-[10px] font-semibold text-brand-cyan">
                    dùng bản đã dịch
                  </span>
                )}
              </p>
              <p>
                • Video gốc: <span className="font-mono text-slate-200">{selectedTask.filePath}</span>
              </p>
              <p>• File kết quả lưu cạnh video gốc (hoặc thư mục đã đặt trong Cài đặt):</p>
              <p className="rounded-lg bg-slate-950 px-2.5 py-1.5 font-mono text-[11px] text-brand-cyan">
                {selectedTask.fileName.replace(/\.[^.]+$/, '')}.{mode}.mp4
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleExport}
                disabled={isExporting}
                className="btn-vanh-gradient inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-white" />}
                <span>{isExporting ? 'Đang xuất...' : 'Bắt đầu xuất video'}</span>
              </button>

              {outputPath && !isExporting && (
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
