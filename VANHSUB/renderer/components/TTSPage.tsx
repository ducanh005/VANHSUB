import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Headphones,
  Loader2,
  Mic,
  Play,
  RefreshCw,
  Volume2,
  XCircle,
  Users,
  X,
} from 'lucide-react';
import type { Task } from '../types/task';
import { SPEED_OPTIONS, speedLabel } from '../lib/ttsOptions';
import { fullPreviewPlayer, type FullPreviewState } from '../lib/fullPreviewPlayer';
import { parseSrt, type SrtLine } from '../lib/srt';

type Props = {
  tasks: Task[];
};


function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('vi-VN');
  } catch {
    return '';
  }
}

/** Câu nghe thử cố định — bấm nghe ngay, không cần đọc file SRT */
const SAMPLE_TEXT = 'Xin chào, bạn đang nghe thử giọng đọc tại Vanh sub.';

export default function TTSPage({ tasks }: Props) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [voice, setVoice] = useState<string>('BV074_streaming');
  const [speed, setSpeed] = useState<number>(1.0);
  // Tab lồng tiếng dùng engine TikTok (~80 giọng); VietTTS cấu hình riêng ở Cài đặt
  const [tiktokVoices, setTiktokVoices] = useState<Array<{ id: string; label: string; language: string }>>([]);
  const [tiktokHasSession, setTiktokHasSession] = useState(false);
  const [voiceSearch, setVoiceSearch] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [replaceAudio, setReplaceAudio] = useState(true);
  const [syncMode, setSyncMode] = useState<'strict' | 'flexible' | 'video-stretch'>('strict');
  const [mixOriginalAudio, setMixOriginalAudio] = useState(false);
  const [startingDubbing, setStartingDubbing] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Gán giọng riêng theo từng dòng phụ đề
  const [showVoicePanel, setShowVoicePanel] = useState(false);
  const [srtLines, setSrtLines] = useState<SrtLine[]>([]);
  const [voiceOverrides, setVoiceOverrides] = useState<Record<string, string>>({});
  const [linePreviewing, setLinePreviewing] = useState<number | null>(null);
  const [regeneratingLine, setRegeneratingLine] = useState<number | null>(null);

  // Nghe thử toàn bộ phụ đề 1 mạch — playback sống trong fullPreviewPlayer
  // (singleton ngoài React) nên chuyển tab rồi quay lại vẫn thấy tiến trình chạy.
  // Tham số thứ 3 (getServerSnapshot) bắt buộc khi Next.js pre-render trang.
  const fullPreview: FullPreviewState = React.useSyncExternalStore(
    fullPreviewPlayer.subscribe,
    fullPreviewPlayer.getState,
    fullPreviewPlayer.getState
  );
  const fullPreviewing = fullPreview.playing;
  const fullPreviewLine = fullPreview.currentLine;

  const startFullPreview = (startLine: number = 1) => {
    if (srtLines.length === 0) return;
    setMessage('');
    setIsError(false);
    // Chụp giọng/speed tại thời điểm bấm — đổi gán giọng trong lúc phát
    // không ảnh hưởng phiên đang chạy (bấm lại để nghe bản mới)
    const lines = srtLines.map((line, i) => ({
      lineNumber: i + 1,
      text: line.text,
      voice: voiceOverrides[String(i + 1)] || voice,
    }));
    fullPreviewPlayer.start(
      {
        lines,
        fetchAudio: (l) => window.vanhsub.tts.preview(l.text.slice(0, 300), l.voice, speed, 'tiktok'),
      },
      startLine
    );
  };

  const stopFullPreview = () => fullPreviewPlayer.stop();

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const isTtsRunning = selectedTask?.status === 'dubbing';
  const isDubbingRunning = selectedTask?.status === 'exporting';
  const hasSrtFile = !!selectedTask?.srtPath;
  const hasTtsAudio = !!selectedTask?.ttsAudioDir && !isTtsRunning;
  const dubbedOutput = selectedTask?.outputPath;
  const customVoiceCount = Object.keys(voiceOverrides).length;

  // Reset trạng thái gán giọng khi đổi tác vụ (playback 1 mạch vẫn chạy tiếp)
  useEffect(() => {
    previewAudioRef.current?.pause();
    setShowVoicePanel(false);
    setSrtLines([]);
    setVoiceOverrides({});
    setLinePreviewing(null);
    setRegeneratingLine(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId]);

  // Nạp trạng thái session + catalog giọng TikTok (1 lần)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.tiktokTts) return;
    window.vanhsub.tiktokTts
      .status()
      .then((s) => setTiktokHasSession(Boolean(s?.hasSession)))
      .catch(() => {});
    window.vanhsub.tiktokTts
      .voices()
      .then((res) => {
        if (res?.ok) {
          // Giọng tiếng Việt lên đầu danh sách
          const sorted = [...res.voices].sort(
            (a, b) => (a.language === 'vi' ? 0 : 1) - (b.language === 'vi' ? 0 : 1),
          );
          setTiktokVoices(sorted);
        }
      })
      .catch(() => {});
  }, []);

  // Dọn audio preview đơn lẻ khi rời trang (playback 1 mạch vẫn tiếp tục)
  useEffect(() => {
    return () => {
      previewAudioRef.current?.pause();
    };
  }, []);

  // Mở/đóng bảng gán giọng; lần đầu mở sẽ tải danh sách dòng phụ đề
  // (dùng đúng file TTS sẽ đọc: bản dịch nếu có, không thì bản gốc)
  const toggleVoicePanel = async () => {
    const next = !showVoicePanel;
    setShowVoicePanel(next);
    if (next && srtLines.length === 0) {
      const srtPath = selectedTask?.translatedSrtPath || selectedTask?.srtPath;
      if (!srtPath || typeof window === 'undefined' || !window.vanhsub?.tasks?.readSrt) return;
      try {
        const content = await window.vanhsub.tasks.readSrt(srtPath);
        setSrtLines(parseSrt(content));
        // Khôi phục gán giọng đã lưu trên task (nếu có)
        setVoiceOverrides(selectedTask?.ttsVoiceOverrides || {});
      } catch {
        // bỏ qua — panel sẽ hiện trạng thái rỗng
      }
    }
  };

  // Quay lại trang khi đang nghe 1 mạch → mở lại bảng gán giọng để thấy tiến trình
  const restoredPanelForTask = useRef<number | null>(null);
  useEffect(() => {
    if (
      fullPreview.playing &&
      selectedTaskId &&
      restoredPanelForTask.current !== fullPreview.session
    ) {
      restoredPanelForTask.current = fullPreview.session;
      if (!showVoicePanel) void toggleVoicePanel();
    }
    // chỉ chạy khi phiên phát mới bắt đầu hoặc lần đầu mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullPreview.playing, fullPreview.session]);

  // Đặt/xoá giọng của 1 dòng. Key là số dòng SRT (1-based) — trùng với
  // sub.index mà ttsEngine dùng khi tạo file audio.
  const setLineVoice = (lineNumber: number, voice: string) => {
    setVoiceOverrides((prev) => {
      const next = { ...prev };
      if (voice) {
        next[String(lineNumber)] = voice;
      } else {
        delete next[String(lineNumber)];
      }
      return next;
    });
  };

  // Nghe thử 1 dòng với giọng sẽ gán (hoặc giọng chung nếu để mặc định)
  const handlePreviewLine = async (lineNumber: number, text: string, lineVoice: string) => {
    if (fullPreviewing) stopFullPreview();
    setMessage('');
    setIsError(false);
    setLinePreviewing(lineNumber);
    try {
      const res = await window.vanhsub.tts.preview(
        text.slice(0, 300),
        lineVoice || voice,
        speed,
        'tiktok'
      );
      previewAudioRef.current?.pause();
      if (!previewAudioRef.current) previewAudioRef.current = new Audio();
      previewAudioRef.current.src = `data:${res.mimeType};base64,${res.audioBase64}`;
      await previewAudioRef.current.play();
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || 'Không thể nghe thử dòng này. Kiểm tra kết nối VietTTS.');
    } finally {
      setLinePreviewing(null);
    }
  };

  // Cuộn tới dòng đang phát trong bảng gán giọng
  useEffect(() => {
    if (fullPreviewLine == null) return;
    document
      .getElementById(`voice-line-${fullPreviewLine}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [fullPreviewLine]);

  // Nạp tốc độ đã lưu (engine TikTok hiện bỏ qua tốc độ nhưng giữ tuỳ chọn cho tương lai)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.settings) return;
    window.vanhsub.settings
      .get('ttsSpeed')
      .then((s) => {
        if (s) setSpeed(Number(s) || 1.0);
      })
      .catch(() => {});
  }, []);

  // Tạo lại audio cho 1 dòng đã có audio TTS (dùng khi sửa text ở Hiệu đính
  // hoặc muốn đổi giọng riêng dòng đó mà không chạy lại toàn bộ)
  const handleRegenerateLine = async (lineNumber: number) => {
    if (!selectedTaskId || regeneratingLine !== null) return;
    setMessage('');
    setIsError(false);
    setRegeneratingLine(lineNumber);
    try {
      const res = await window.vanhsub.tts.regenerateLine(selectedTaskId, lineNumber);
      if (!res?.ok) {
        setIsError(true);
        setMessage(res?.error || 'Không thể tạo lại audio cho dòng này.');
        return;
      }
      setMessage(
        `Đã tạo lại audio dòng ${lineNumber} — bấm "Ghép audio vào video" để áp dụng vào video.`
      );
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || 'Không thể tạo lại audio cho dòng này.');
    } finally {
      setRegeneratingLine(null);
    }
  };

  const handleCancelTTS = async () => {
    if (!selectedTaskId) return;
    try {
      await window.vanhsub.tts.cancel(selectedTaskId);
      setMessage('Đã gửi yêu cầu huỷ — dừng sau câu hiện tại.');
    } catch {
      // bỏ qua
    }
  };

  const handleStartTTS = async () => {
    if (!selectedTaskId) return;
    setMessage('');
    setIsError(false);

    if (!tiktokHasSession) {
      setIsError(true);
      setMessage('Chưa có session TikTok — vào Cài đặt → TikTok TTS để lưu sessionid trước.');
      return;
    }

    try {
      await window.vanhsub.tts.start(selectedTaskId, voice, speed, voiceOverrides, 'tiktok');
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
      const res = await window.vanhsub.tts.preview(SAMPLE_TEXT, voice, speed, 'tiktok');
      previewAudioRef.current?.pause();
      if (!previewAudioRef.current) previewAudioRef.current = new Audio();
      previewAudioRef.current.src = `data:${res.mimeType};base64,${res.audioBase64}`;
      await previewAudioRef.current.play();
      setMessage('Đang phát bản nghe thử...');
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || 'Không thể tạo bản nghe thử. Nếu lỗi session, vào Cài đặt lưu lại sessionid TikTok.');
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
      await window.vanhsub.dubbing.start(selectedTaskId, replaceAudio, {
        syncMode,
        mixOriginalAudio: replaceAudio && mixOriginalAudio,
      });
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

  // Tìm kiếm giọng TikTok: lọc theo tên/mã không dấu, giọng đang chọn luôn được giữ
  const normalizedSearch = voiceSearch.trim().toLowerCase().replace(/[\s_]+/g, '');
  const voiceChoices: Array<{ value: string; label: string }> = tiktokVoices
    .filter((v) => {
      if (!normalizedSearch) return true;
      const hay = `${v.label} ${v.id}`.toLowerCase().replace(/[\s_]+/g, '');
      return hay.includes(normalizedSearch);
    })
    .map((v) => ({ value: v.id, label: `${v.label} · ${v.id}` }));
  if (voice && !voiceChoices.some((v) => v.value === voice)) {
    const current = tiktokVoices.find((v) => v.id === voice);
    if (current) {
      voiceChoices.unshift({ value: current.id, label: `${current.label} · ${current.id}` });
    }
  }
  const currentVoiceLabel = (v: string) => tiktokVoices.find((t) => t.id === v)?.label || v;

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

          <label className="text-xs font-semibold text-slate-300">Giọng TikTok:</label>
          <input
            type="text"
            value={voiceSearch}
            onChange={(e) => setVoiceSearch(e.target.value)}
            placeholder="Tìm giọng (vd: việt, nữ, en_us, BV074...)"
            className="w-44 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-brand-cyan focus:outline-none"
          />
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={isTtsRunning || isDubbingRunning}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 focus:outline-none disabled:opacity-50 max-w-[240px]"
          >
            {voiceChoices.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-slate-500">
            {voiceChoices.length}/{tiktokVoices.length} giọng
          </span>

          <label className="text-xs font-semibold text-slate-300">Tốc độ:</label>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            disabled={isTtsRunning || isDubbingRunning}
            title="TikTok TTS chưa hỗ trợ chỉnh tốc độ"
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
            disabled={previewing || isTtsRunning || isDubbingRunning || fullPreviewing}
            title="Nghe thử giọng đang chọn"
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-cyan/40 bg-brand-cyan/10 px-3 py-1.5 text-xs font-semibold text-brand-cyan transition hover:bg-brand-cyan/20 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            {previewing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            <span>{previewing ? 'Đang tạo...' : 'Nghe thử'}</span>
          </button>

          <button
            type="button"
            onClick={toggleVoicePanel}
            disabled={!selectedTaskId || !hasSrtFile || isTtsRunning || isDubbingRunning}
            title="Gán giọng đọc riêng cho từng dòng phụ đề"
            className={[
              'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
              showVoicePanel || customVoiceCount > 0
                ? 'border-brand-rose/50 bg-brand-rose/10 text-brand-rose hover:bg-brand-rose/20'
                : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700',
            ].join(' ')}
          >
            <Users className="h-3.5 w-3.5" />
            <span>
              Gán giọng theo câu{customVoiceCount > 0 ? ` (${customVoiceCount})` : ''}
            </span>
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

        <div className="flex items-center gap-2">
          {isTtsRunning && (
            <button
              type="button"
              onClick={handleCancelTTS}
              title="Huỷ tạo lồng tiếng — dừng sau câu hiện tại"
              className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 cursor-pointer"
            >
              <XCircle className="h-4 w-4" />
              <span>Huỷ</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleStartTTS}
            disabled={!selectedTaskId || !hasSrtFile || isTtsRunning || isDubbingRunning}
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
      </div>

      {/* Bảng gán giọng theo từng dòng phụ đề */}
      {showVoicePanel && selectedTaskId && (
        <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
          <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <Users className="h-3.5 w-3.5 text-brand-rose" />
              <span>
                Gán giọng theo câu ({srtLines.length} dòng
                {customVoiceCount > 0 ? ` · ${customVoiceCount} dòng giọng riêng` : ''})
              </span>
            </div>
            <div className="flex items-center gap-2">
              {fullPreviewing ? (
                <>
                  <span className="font-mono text-[11px] text-brand-cyan">
                    Đang nghe: {fullPreviewLine}/{fullPreview.total || srtLines.length}
                  </span>
                  <button
                    type="button"
                    onClick={stopFullPreview}
                    title="Dừng nghe thử toàn bộ"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-400 hover:bg-rose-500/20 cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                    <span>Dừng</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => startFullPreview(1)}
                  disabled={srtLines.length === 0 || linePreviewing !== null}
                  title="Phát liên tiếp toàn bộ phụ đề để nghe 1 mạch giọng đọc của video"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-brand-cyan/40 bg-brand-cyan/10 px-2.5 py-1 text-[11px] font-semibold text-brand-cyan hover:bg-brand-cyan/20 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Headphones className="h-3 w-3" />
                  <span>Nghe toàn bộ (1 mạch)</span>
                </button>
              )}
              {customVoiceCount > 0 && (
                <button
                  type="button"
                  onClick={() => setVoiceOverrides({})}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  Về giọng chung tất cả
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowVoicePanel(false)}
                title="Đóng bảng gán giọng"
                className="flex h-6 w-6 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {fullPreviewing && (
            <div className="h-1 w-full overflow-hidden bg-slate-800">
              <div
                className="h-full bg-gradient-to-r from-brand-cyan to-brand-indigo transition-all duration-300"
                style={{ width: `${((fullPreviewLine || 0) / Math.max(fullPreview.total || srtLines.length, 1)) * 100}%` }}
              />
            </div>
          )}

          <div className="max-h-[320px] flex-1 space-y-1.5 overflow-y-auto p-3">
            {srtLines.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                Đang tải danh sách dòng phụ đề...
              </div>
            ) : (
              srtLines.map((line, i) => {
                const lineNumber = i + 1; // trùng số dòng SRT mà ttsEngine dùng
                const lineVoice = voiceOverrides[String(lineNumber)] || '';
                return (
                  <div
                    key={line.id}
                    id={`voice-line-${lineNumber}`}
                    className={[
                      'flex items-center gap-2 rounded-xl border p-2 text-xs',
                      fullPreviewLine === lineNumber
                        ? 'border-brand-cyan bg-brand-cyan/10'
                        : lineVoice
                          ? 'border-brand-rose/40 bg-brand-rose/5'
                          : 'border-slate-800/80 bg-slate-900/80',
                    ].join(' ')}
                  >
                    <span className="w-8 shrink-0 rounded-md bg-slate-800 px-1.5 py-0.5 text-center font-mono text-[10px] font-bold text-brand-cyan">
                      {lineNumber}
                    </span>
                    <p
                      className="min-w-0 flex-1 truncate text-slate-300"
                      title={line.text}
                    >
                      {line.text}
                    </p>
                    <select
                      value={lineVoice}
                      onChange={(e) => setLineVoice(lineNumber, e.target.value)}
                      disabled={isTtsRunning || isDubbingRunning}
                      className={[
                        'w-36 shrink-0 rounded-lg border px-2 py-1 text-[11px] focus:outline-none disabled:opacity-50',
                        lineVoice
                          ? 'border-brand-rose/50 bg-slate-800 text-brand-rose'
                          : 'border-slate-700 bg-slate-800 text-slate-300',
                      ].join(' ')}
                    >
                      <option value="">Mặc định ({currentVoiceLabel(voice)})</option>
                      {voiceChoices.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handlePreviewLine(lineNumber, line.text, lineVoice)}
                      disabled={linePreviewing !== null || fullPreviewing}
                      title="Nghe thử dòng này với giọng đã chọn"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/25 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {linePreviewing === lineNumber ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                    </button>
                    {selectedTask?.ttsAudioDir && (
                      <button
                        type="button"
                        onClick={() => handleRegenerateLine(lineNumber)}
                        disabled={regeneratingLine !== null || isTtsRunning || isDubbingRunning}
                        title="Tạo lại audio dòng này với text hiện tại (sau khi sửa text ở Hiệu đính)"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:border-brand-indigo/50 hover:text-brand-indigo cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {regeneratingLine === lineNumber ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <p className="border-t border-slate-800/80 px-4 py-2 text-[11px] text-slate-500">
            Dòng để "Mặc định" sẽ dùng giọng chung đã chọn ở thanh công cụ. Bấm
            "Tạo audio lồng tiếng" để áp dụng.
          </p>
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
                <span className="text-slate-200">{currentVoiceLabel(voice)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tốc độ:</span>
                <span className="text-slate-200">{speedLabel(speed)}</span>
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

                  {replaceAudio && (
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={mixOriginalAudio}
                        onChange={(e) => setMixOriginalAudio(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-brand-cyan focus:ring-0"
                      />
                      <span>
                        Giữ nhạc nền / hiệu ứng âm thanh gốc, mix nhỏ (22%) dưới lời thoại lồng tiếng
                      </span>
                    </label>
                  )}

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-300">
                      Chế độ đồng bộ khi câu thoại dài hơn khung phụ đề:
                    </label>
                    <select
                      value={syncMode}
                      onChange={(e) =>
                        setSyncMode(
                          e.target.value === 'flexible'
                            ? 'flexible'
                            : e.target.value === 'video-stretch'
                              ? 'video-stretch'
                              : 'strict'
                        )
                      }
                      disabled={isTtsRunning || isDubbingRunning}
                      className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none disabled:opacity-50"
                    >
                      <option value="strict">Chặt — nén audio theo timeline phụ đề (mặc định)</option>
                      <option value="flexible">Linh hoạt — cho câu dài tràn vào khoảng lặng (tối đa ~3s)</option>
                      <option value="video-stretch">Kéo giãn video — giãn video tối đa 1.25x để vừa audio</option>
                    </select>
                  </div>

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
                    câu tràn thời lượng xử lý theo chế độ đồng bộ đã chọn ở trên.
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

          {/* Báo cáo câu tràn thời lượng (cập nhật sau mỗi lần dubbing) */}
          {(selectedTask?.ttsOverruns?.length ?? 0) > 0 && !isDubbingRunning && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-amber-300">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span>
                  {selectedTask!.ttsOverruns!.length} câu tràn thời lượng đã được tăng tốc để vừa khung
                </span>
              </div>
              <div className="max-h-28 space-y-1 overflow-y-auto">
                {selectedTask!.ttsOverruns!.map((o) => (
                  <div key={o.index} className="flex items-center gap-2 text-[11px] text-slate-300">
                    <span className="w-8 shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-center font-mono text-brand-cyan">
                      {o.index}
                    </span>
                    <span>tăng tốc {o.tempo.toFixed(2)}x</span>
                    {o.truncated && (
                      <span className="font-medium text-rose-400">
                        — tràn quá 1.5x, phần cuối bị cắt: nên rút gọn text rồi tạo lại audio
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Sửa text ở tab Hiệu đính, dùng nút "Tạo lại" trên dòng tương ứng ở bảng gán giọng,
                rồi ghép lại video.
              </p>
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
