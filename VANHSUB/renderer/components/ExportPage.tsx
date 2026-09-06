import React, { useState } from 'react';
import { CheckCircle2, Film, FolderOpen, Layers, Loader2, Mic, Play } from 'lucide-react';
import type { Task } from '../types/task';
import type { SubMaskRegion } from '../types/electron';

type Props = {
  tasks: Task[];
};

type ExportMode = 'hardsub' | 'softsub' | 'dub';

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
];

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

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const isExporting = selectedTask?.status === 'exporting';
  const outputPath = selectedTask?.outputPath;
  const hasTtsAudio = !!selectedTask?.ttsAudioDir;

  const handleExport = async () => {
    if (!selectedTaskId) return;
    setMessage('');
    setIsError(false);
    try {
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
      await window.vanhsub.export.start(selectedTaskId, mode, maskParam);
      setMessage(`Đã bắt đầu xuất video (${mode === 'hardsub' ? 'Hardsub' : 'Softsub'})...`);
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    } finally {
      setStartingDub(false);
    }
  };

  const handleShowOutput = () => {
    if (outputPath && window.vanhsub?.dialog) {
      window.vanhsub.dialog.showInFolder(outputPath);
    }
  };

  const editorTasks = tasks.filter((t) => t.srtPath || t.translatedSrtPath);
  const dubSuffix = replaceAudio ? 'mono' : 'bilingual';
  const resultFileName =
    mode === 'dub'
      ? `${selectedTask?.fileName.replace(/\.[^.]+$/, '') || ''}_dubbed_${dubSuffix}.mp4`
      : `${selectedTask?.fileName.replace(/\.[^.]+$/, '') || ''}.${mode}.mp4`;

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
          <span>Chọn một tác vụ đã có phụ đề để xuất video (Hardsub, Softsub hoặc Lồng tiếng).</span>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
          {/* Chọn chế độ xuất */}
          <div className="grid gap-4 lg:grid-cols-3">
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

          {/* Tùy chọn che vùng phụ đề cũ (chỉ dùng cho Hardsub) */}
          {mode === 'hardsub' && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={maskEnabled}
                  onChange={(e) => setMaskEnabled(e.target.checked)}
                  disabled={isExporting}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-brand-cyan focus:ring-0"
                />
                <span>Che vùng phụ đề cũ trong video (phụ đề nước ngoài in sẵn)</span>
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

                  <p className="w-full text-[11px] leading-relaxed text-slate-500">
                    Vùng che được áp trước khi ghi phụ đề mới, nhờ đó sub tiếng Việt không đè chồng lên
                    chữ cũ. Nếu chưa đúng vị trí, thử tăng/giảm độ cao dải che.
                  </p>
                </div>
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
                disabled={isExporting || startingDub || (mode === 'dub' && !hasTtsAudio)}
                className="btn-vanh-gradient inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {isExporting || startingDub ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 fill-white" />
                )}
                <span>
                  {isExporting || startingDub
                    ? 'Đang xuất...'
                    : mode === 'dub'
                      ? 'Ghép lồng tiếng vào video'
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
