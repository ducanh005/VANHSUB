import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  FolderOpen,
  Headphones,
  Loader2,
  Mic,
  Play,
  RefreshCw,
  Volume2,
  XCircle,
  Zap,
} from 'lucide-react';
import type { Task } from '../types/task';
import { VOICE_OPTIONS, SPEED_OPTIONS, voiceLabel, speedLabel } from '../lib/ttsOptions';

type Props = {
  tasks: Task[];
};

const SAMPLE_TEXT = 'Xin chào! Đây là giọng đọc thử nghiệm cho tính năng lồng tiếng của VANHSUB.';

function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('vi-VN');
  } catch {
    return '';
  }
}

/** Lấy 1 câu mẫu từ SRT của task để nghe thử đúng nội dung thật (fallback: câu mặc định) */
async function loadPreviewText(task: Task | null): Promise<string> {
  const srtPath = task?.translatedSrtPath || task?.srtPath;
  if (!srtPath || typeof window === 'undefined' || !window.vanhsub?.tasks?.readSrt) {
    return SAMPLE_TEXT;
  }
  try {
    const content = await window.vanhsub.tasks.readSrt(srtPath);
    const firstText = content
      .split(/\n\s*\n/)
      .map((block) => block.trim().split('\n').slice(2).join(' ').trim())
      .find((line) => line.length > 0);
    return firstText ? firstText.slice(0, 200) : SAMPLE_TEXT;
  } catch {
    return SAMPLE_TEXT;
  }
}

export default function TTSPage({ tasks }: Props) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [voice, setVoice] = useState<string>('alloy');
  const [speed, setSpeed] = useState<number>(1.0);
  const [availableVoices, setAvailableVoices] = useState<string[]>([]);
  const [vietTtsConnected, setVietTtsConnected] = useState<boolean | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [vietTtsEndpoint, setVietTtsEndpoint] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [replaceAudio, setReplaceAudio] = useState(true);
  const [startingDubbing, setStartingDubbing] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const isTtsRunning = selectedTask?.status === 'dubbing';
  const isDubbingRunning = selectedTask?.status === 'exporting';
  const hasSrtFile = !!selectedTask?.srtPath;
  const hasTtsAudio = !!selectedTask?.ttsAudioDir && !isTtsRunning;
  const dubbedOutput = selectedTask?.outputPath;

  const checkConnection = useCallback(async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.tts?.checkConnection) return;
    setCheckingConnection(true);
    try {
      const connected = await window.vanhsub.tts.checkConnection();
      setVietTtsConnected(connected);
      if (!connected) {
        setIsError(true);
        setMessage('VietTTS chưa kết nối — xem hướng dẫn chạy Docker bên dưới.');
      }
    } catch {
      setVietTtsConnected(false);
    } finally {
      setCheckingConnection(false);
    }
  }, []);

  // Kiểm tra kết nối VietTTS + nạp cài đặt + danh sách voice lần đầu
  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub) return;
    checkConnection();

    if (window.vanhsub.settings) {
      Promise.all([
        window.vanhsub.settings.get('ttsVoice').catch(() => 'alloy'),
        window.vanhsub.settings.get('ttsSpeed').catch(() => 1.0),
        window.vanhsub.settings.get('vietTtsEndpoint').catch(() => ''),
      ])
        .then(([v, s, endpoint]) => {
          if (v) setVoice(String(v));
          if (s) setSpeed(Number(s) || 1.0);
          if (endpoint) setVietTtsEndpoint(String(endpoint));
        })
        .catch(() => {});
    }

    if (window.vanhsub.tts?.voices) {
      window.vanhsub.tts
        .voices()
        .then((list) => setAvailableVoices(Array.isArray(list) ? list : []))
        .catch(() => {});
    }
  }, [checkConnection]);

  // Lưu giọng/tốc độ người dùng chọn làm mặc định cho lần sau
  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.settings) return;
    window.vanhsub.settings.set('ttsVoice', voice).catch(() => {});
  }, [voice]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.settings) return;
    window.vanhsub.settings.set('ttsSpeed', speed).catch(() => {});
  }, [speed]);

  // Dọn audio preview khi rời trang
  useEffect(() => {
    return () => {
      previewAudioRef.current?.pause();
    };
  }, []);

  const handleStartTTS = async () => {
    if (!selectedTaskId) return;
    setMessage('');
    setIsError(false);

    if (vietTtsConnected === false) {
      setIsError(true);
      setMessage('VietTTS không kết nối. Kiểm tra Docker container rồi bấm "Kiểm tra lại".');
      return;
    }

    try {
      await window.vanhsub.tts.start(selectedTaskId, voice, speed);
      setMessage('Đã gửi yêu cầu tạo lồng tiếng — theo dõi tiến trình bên dưới.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    }
  };

  const handlePreview = async () => {
    setMessage('');
    setIsError(false);
    setPreviewing(true);
    try {
      const text = await loadPreviewText(selectedTask);
      const res = await window.vanhsub.tts.preview(text, voice, speed);
      previewAudioRef.current?.pause();
      if (!previewAudioRef.current) previewAudioRef.current = new Audio();
      previewAudioRef.current.src = `data:${res.mimeType};base64,${res.audioBase64}`;
      await previewAudioRef.current.play();
      setMessage('Đang phát bản nghe thử...');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || 'Không thể tạo bản nghe thử. Kiểm tra kết nối VietTTS.');
    } finally {
      setPreviewing(false);
    }
  };

  const handleStartDubbing = async () => {
    if (!selectedTaskId || !hasTtsAudio) return;
    setMessage('');
    setIsError(false);
    setStartingDubbing(true);
    try {
      await window.vanhsub.dubbing.start(selectedTaskId, replaceAudio);
      setMessage('Đã bắt đầu ghép audio lồng tiếng vào video.');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || String(err));
    } finally {
      setStartingDubbing(false);
    }
  };

  const handleOpenOutputFolder = async () => {
    if (!dubbedOutput) return;
    try {
      await window.vanhsub.dialog.showInFolder(dubbedOutput);
    } catch (err) {
      console.error('Không mở được thư mục:', err);
    }
  };

  // Hiển thị lỗi từ pipeline (task chuyển sang trạng thái error)
  useEffect(() => {
    if (selectedTask?.status === 'error' && selectedTask.errorMessage) {
      setIsError(true);
      setMessage(selectedTask.errorMessage);
    }
  }, [selectedTask?.status, selectedTask?.errorMessage]);

  const ttsEligibleTasks = tasks.filter((t) => t.srtPath);
  const voiceList = availableVoices.length > 0 ? availableVoices : VOICE_OPTIONS.map((v) => v.value);
  const activeProgress = isTtsRunning || isDubbingRunning ? selectedTask : null;
  const stageText =
    selectedTask?.stageDescription ||
    (isDubbingRunning ? 'Đang ghép audio vào video...' : 'Đang tạo lồng tiếng...');

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
            {ttsEligibleTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fileName} ({formatTimeAgo(t.createdAt)})
              </option>
            ))}
          </select>

          <label className="text-xs font-semibold text-slate-300">Giọng nói:</label>
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={isTtsRunning || isDubbingRunning}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none disabled:opacity-50"
          >
            {voiceList.map((v) => (
              <option key={v} value={v}>
                {voiceLabel(v)}
              </option>
            ))}
          </select>

          <label className="text-xs font-semibold text-slate-300">Tốc độ:</label>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            disabled={isTtsRunning || isDubbingRunning}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none disabled:opacity-50"
          >
            {SPEED_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handlePreview}
            disabled={!vietTtsConnected || previewing || isTtsRunning || isDubbingRunning}
            title="Nghe thử giọng đọc với câu đầu tiên trong phụ đề"
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-cyan/40 bg-brand-cyan/10 px-3 py-1.5 text-xs font-semibold text-brand-cyan transition hover:bg-brand-cyan/20 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            {previewing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            <span>{previewing ? 'Đang tạo...' : 'Nghe thử'}</span>
          </button>

          {message && (
            <span
              className={`max-w-[340px] truncate text-xs font-mono ${isError ? 'text-rose-400' : 'text-brand-cyan'}`}
              title={message}
            >
              {message}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleStartTTS}
          disabled={!selectedTaskId || !hasSrtFile || isTtsRunning || isDubbingRunning || vietTtsConnected === false}
          className="btn-vanh-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50"
        >
          {isTtsRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
          <span>{isTtsRunning ? 'Đang tạo audio...' : 'Tạo audio lồng tiếng'}</span>
        </button>
      </div>

      {/* Thông báo kết nối */}
      {vietTtsConnected === false && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Zap className="h-4 w-4 text-rose-400 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-rose-300">
                <p className="font-semibold mb-1">⚠️ VietTTS chưa sẵn sàng</p>
                <p>
                  Endpoint đang dùng: <code className="font-mono text-rose-200">{vietTtsEndpoint || 'http://localhost:6006'}</code>{' '}
                  (đổi được trong Cài đặt)
                </p>
                <p className="mt-1">Chạy Docker container:</p>
                <code className="block mt-1 bg-slate-900 px-2 py-1 rounded text-[10px] font-mono text-slate-200">
                  docker run -p 6006:6006 vanhsub/viettts
                </code>
              </div>
            </div>
            <button
              type="button"
              onClick={checkConnection}
              disabled={checkingConnection}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checkingConnection ? 'animate-spin' : ''}`} />
              <span>Kiểm tra lại</span>
            </button>
          </div>
        </div>
      )}

      {/* Tiến trình khi đang xử lý */}
      {activeProgress && (
        <div className="rounded-2xl border border-brand-indigo/40 bg-brand-indigo/10 p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-brand-cyan">{stageText}</span>
            <span className="font-mono text-slate-300">{selectedTask?.progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-indigo transition-all duration-300"
              style={{ width: `${selectedTask?.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Nội dung chính */}
      {!selectedTaskId ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center text-slate-500 text-xs">
          <Headphones className="h-10 w-10 text-slate-600 mb-3 animate-pulse" />
          <span>Chọn một tác vụ đã có phụ đề .srt ở menu phía trên để tạo lồng tiếng bằng VietTTS AI.</span>
        </div>
      ) : !hasSrtFile ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center text-slate-500 text-xs">
          <Headphones className="h-10 w-10 text-slate-600 mb-3" />
          <span>Tác vụ này chưa có file .srt — hãy chạy phiên âm ở Trang chủ trước.</span>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">Thông tin lồng tiếng</h3>
            <div className="space-y-2 text-xs text-slate-400">
              <div className="flex justify-between">
                <span>Tác vụ:</span>
                <span className="text-slate-200">{selectedTask?.fileName}</span>
              </div>
              <div className="flex justify-between">
                <span>Phụ đề dùng để đọc:</span>
                <span className="text-slate-200">
                  {selectedTask?.translatedSrtPath ? 'Bản dịch' : 'Bản gốc'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Giọng nói:</span>
                <span className="text-slate-200">{voiceLabel(voice)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tốc độ:</span>
                <span className="text-slate-200">{speedLabel(speed)}</span>
              </div>
              <div className="flex justify-between">
                <span>Trạng thái VietTTS:</span>
                <span className={vietTtsConnected ? 'text-emerald-400' : 'text-rose-400'}>
                  {vietTtsConnected ? '✓ Sẵn sàng' : '✗ Không kết nối'}
                </span>
              </div>
            </div>
          </div>

          {/* Bước 2: sau khi TTS xong → ghép vào video */}
          {hasTtsAudio && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>Đã tạo xong audio lồng tiếng cho từng dòng phụ đề.</span>
              </div>

              {!dubbedOutput && !isDubbingRunning && (
                <div className="mt-3 space-y-3">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={replaceAudio}
                      onChange={(e) => setReplaceAudio(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-brand-cyan focus:ring-0"
                    />
                    <span>
                      Thay thế toàn bộ âm thanh gốc (bỏ tick để giữ audio gốc thành track song ngữ)
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={handleStartDubbing}
                    disabled={startingDubbing}
                    className="btn-vanh-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {startingDubbing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                    <span>Ghép audio vào video (Dubbing)</span>
                  </button>
                  <p className="text-[11px] text-slate-400">
                    Audio được ghép đúng theo timeline phụ đề: câu ngắn hơn sẽ được lấp im lặng,
                    câu tràn thời lượng sẽ được cắt bớt.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Kết quả dubbing */}
          {dubbedOutput && !isDubbingRunning && (
            <div className="rounded-2xl border border-brand-cyan/30 bg-brand-cyan/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs">
                  <div className="flex items-center gap-2 font-semibold text-brand-cyan">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Video lồng tiếng đã sẵn sàng</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-300">
                    {dubbedOutput.split(/[/\\]/).pop()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleOpenOutputFolder}
                  className="inline-flex items-center gap-2 rounded-xl border border-brand-cyan/40 bg-slate-900 px-3 py-2 text-xs font-medium text-brand-cyan hover:bg-slate-800 cursor-pointer"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>Mở thư mục chứa file</span>
                </button>
              </div>
            </div>
          )}

          {/* Trạng thái lỗi của pipeline */}
          {selectedTask?.status === 'error' && selectedTask.errorMessage && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
              <div className="flex items-start gap-2 text-xs text-rose-300">
                <XCircle className="h-4 w-4 text-rose-400 mt-0.5 flex-shrink-0" />
                <span>{selectedTask.errorMessage}</span>
              </div>
            </div>
          )}

          {/* Gợi ý khi chưa làm gì */}
          {!hasTtsAudio && !isTtsRunning && (
            <div className="flex-1 rounded-2xl border border-slate-800/50 bg-slate-900/40 p-4 flex items-center justify-center text-slate-500 text-xs">
              <p>
                Bấm <strong className="text-slate-300">"Nghe thử"</strong> để chọn giọng ưng ý, rồi bấm{' '}
                <strong className="text-slate-300">"Tạo audio lồng tiếng"</strong> để bắt đầu xử lý...
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
