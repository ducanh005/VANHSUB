import React, { useEffect, useState } from 'react';
import { Headphones, Loader2, Volume2, Zap } from 'lucide-react';
import type { Task } from '../types/task';

type Props = {
  tasks: Task[];
};

const VOICE_OPTIONS = [
  { value: 'alloy', label: 'Alloy (Trung tính)' },
  { value: 'echo', label: 'Echo (Nam)' },
  { value: 'fable', label: 'Fable (Kể chuyện)' },
  { value: 'onyx', label: 'Onyx (Sâu, lịch sự)' },
  { value: 'nova', label: 'Nova (Nữ, tươi sáng)' },
  { value: 'shimmer', label: 'Shimmer (Nữ, mềm mại)' },
];

const SPEED_OPTIONS = [
  { value: 0.5, label: '0.5x (Rất chậm)' },
  { value: 0.75, label: '0.75x (Chậm)' },
  { value: 1.0, label: '1.0x (Bình thường)' },
  { value: 1.25, label: '1.25x (Nhanh)' },
  { value: 1.5, label: '1.5x (Rất nhanh)' },
  { value: 2.0, label: '2.0x (Siêu nhanh)' },
];

function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('vi-VN');
  } catch {
    return '';
  }
}

export default function TTSPage({ tasks }: Props) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [voice, setVoice] = useState<string>('alloy');
  const [speed, setSpeed] = useState<number>(1.0);
  const [vietTtsConnected, setVietTtsConnected] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const isDubbing = selectedTask?.status === 'dubbing';
  const hasSrtFile = !!selectedTask?.srtPath;

  // Kiểm tra kết nối VietTTS lần đầu
  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.tts) return;
    window.vanhsub.tts
      .checkConnection()
      .then((connected: boolean) => {
        setVietTtsConnected(connected);
        if (!connected) {
          setIsError(true);
          setMessage('⚠️ VietTTS không kết nối. Hãy chắc chắn Docker đã chạy: docker run -p 6006:6006 vanhsub/viettts');
        }
      })
      .catch(() => {
        setVietTtsConnected(false);
        setIsError(true);
        setMessage('Không thể kết nối VietTTS. Kiểm tra cài đặt.');
      });
  }, []);

  // Nạp cài đặt mặc định từ settings
  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.settings) return;
    Promise.all([
      window.vanhsub.settings.get('ttsVoice').catch(() => 'alloy'),
      window.vanhsub.settings.get('ttsSpeed').catch(() => 1.0),
    ])
      .then(([v, s]) => {
        if (v) setVoice(v);
        if (s) setSpeed(s);
      })
      .catch(() => {});
  }, []);

  const handleStartTTS = async () => {
    if (!selectedTaskId) return;
    setMessage('');
    setIsError(false);

    if (!vietTtsConnected) {
      setIsError(true);
      setMessage('VietTTS không kết nối. Kiểm tra Docker container.');
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

  // Cập nhật message nếu task có lỗi
  useEffect(() => {
    if (selectedTask?.status === 'error' && selectedTask.errorMessage) {
      setIsError(true);
      setMessage(selectedTask.errorMessage);
    }
  }, [selectedTask?.status, selectedTask?.errorMessage]);

  const ttsEligibleTasks = tasks.filter((t) => t.srtPath);

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
            disabled={isDubbing}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none disabled:opacity-50"
          >
            {VOICE_OPTIONS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>

          <label className="text-xs font-semibold text-slate-300">Tốc độ:</label>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            disabled={isDubbing}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none disabled:opacity-50"
          >
            {SPEED_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
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
          onClick={handleStartTTS}
          disabled={!selectedTaskId || isDubbing || !hasSrtFile || !vietTtsConnected}
          className="btn-vanh-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50"
        >
          {isDubbing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
          <span>{isDubbing ? 'Đang tạo lồng tiếng...' : 'Tạo lồng tiếng'}</span>
        </button>
      </div>

      {/* Thông báo kết nối */}
      {vietTtsConnected === false && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3">
          <div className="flex items-start gap-2">
            <Zap className="h-4 w-4 text-rose-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-rose-300">
              <p className="font-semibold mb-1">⚠️ VietTTS chưa sẵn sàng</p>
              <p>Cần chạy Docker container:</p>
              <code className="block mt-1 bg-slate-900 px-2 py-1 rounded text-[10px] font-mono text-slate-200">
                docker run -p 6006:6006 vanhsub/viettts
              </code>
            </div>
          </div>
        </div>
      )}

      {/* Tiến trình khi đang tạo lồng tiếng */}
      {selectedTask && isDubbing && (
        <div className="rounded-2xl border border-brand-indigo/40 bg-brand-indigo/10 p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-brand-cyan">{selectedTask.stageDescription || 'Đang tạo lồng tiếng...'}</span>
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
          <Headphones className="h-10 w-10 text-slate-600 mb-3 animate-pulse" />
          <span>Chọn một tác vụ đã có phụ đề .srt ở menu phía trên để tạo lồng tiếng bằng VietTTS AI.</span>
        </div>
      ) : !hasSrtFile ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center text-slate-500 text-xs">
          <Headphones className="h-10 w-10 text-slate-600 mb-3" />
          <span>Tác vụ này chưa có file .srt — hãy chạy phiên âm ở Trang chủ trước.</span>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">Thông tin lồng tiếng</h3>
            <div className="space-y-2 text-xs text-slate-400">
              <div className="flex justify-between">
                <span>Tác vụ:</span>
                <span className="text-slate-200">{selectedTask?.fileName}</span>
              </div>
              <div className="flex justify-between">
                <span>Phụ đề:</span>
                <span className="text-slate-200">
                  {selectedTask?.translatedSrtPath ? 'Bản dịch' : 'Bản gốc'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Giọng nói:</span>
                <span className="text-slate-200">
                  {VOICE_OPTIONS.find((v) => v.value === voice)?.label || voice}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Tốc độ:</span>
                <span className="text-slate-200">
                  {SPEED_OPTIONS.find((s) => s.value === speed)?.label || `${speed}x`}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Trạng thái VietTTS:</span>
                <span className={vietTtsConnected ? 'text-emerald-400' : 'text-rose-400'}>
                  {vietTtsConnected ? '✓ Sẵn sàng' : '✗ Không kết nối'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex-1 rounded-2xl border border-slate-800/50 bg-slate-900/40 p-4 flex items-center justify-center text-slate-500 text-xs">
            <p>Bấm nút "Tạo lồng tiếng" ở trên để bắt đầu xử lý...</p>
          </div>
        </div>
      )}
    </div>
  );
}
