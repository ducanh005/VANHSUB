import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  FolderOpen,
  Headphones,
  Loader2,
  Mic,
  Play,
  RefreshCw,
  Trash2,
  UserPlus,
  Volume2,
  XCircle,
  Zap,
  Users,
  X,
} from 'lucide-react';
import type { Task } from '../types/task';
import type { VoiceSampleInfo } from '../types/electron';
import { VOICE_OPTIONS, SPEED_OPTIONS, voiceLabel, speedLabel } from '../lib/ttsOptions';
import { parseSrt, type SrtLine } from '../lib/srt';

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

  // Gán giọng riêng theo từng dòng phụ đề
  const [showVoicePanel, setShowVoicePanel] = useState(false);
  const [srtLines, setSrtLines] = useState<SrtLine[]>([]);
  const [voiceOverrides, setVoiceOverrides] = useState<Record<string, string>>({});
  const [linePreviewing, setLinePreviewing] = useState<number | null>(null);

  // Thêm giọng đọc từ file audio mẫu (voice clone)
  const [showAddVoice, setShowAddVoice] = useState(false);
  const [newVoiceName, setNewVoiceName] = useState('');
  const [addingVoice, setAddingVoice] = useState(false);
  const [voiceSamples, setVoiceSamples] = useState<VoiceSampleInfo[]>([]);

  // Nghe thử toàn bộ phụ đề 1 mạch (phát liên tiếp từng dòng theo giọng đã gán)
  const [fullPreviewing, setFullPreviewing] = useState(false);
  const [fullPreviewLine, setFullPreviewLine] = useState<number | null>(null);
  const fullPreviewAbortRef = useRef(false);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const isTtsRunning = selectedTask?.status === 'dubbing';
  const isDubbingRunning = selectedTask?.status === 'exporting';
  const hasSrtFile = !!selectedTask?.srtPath;
  const hasTtsAudio = !!selectedTask?.ttsAudioDir && !isTtsRunning;
  const dubbedOutput = selectedTask?.outputPath;
  const customVoiceCount = Object.keys(voiceOverrides).length;

  // Reset trạng thái gán giọng khi đổi tác vụ
  useEffect(() => {
    fullPreviewAbortRef.current = true;
    previewAudioRef.current?.pause();
    setShowVoicePanel(false);
    setSrtLines([]);
    setVoiceOverrides({});
    setLinePreviewing(null);
  }, [selectedTaskId]);

  // Dọn audio preview khi rời trang
  useEffect(() => {
    return () => {
      fullPreviewAbortRef.current = true;
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
        speed
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

  // ---- Nghe thử toàn bộ phụ đề 1 mạch: phát liên tiếp từng dòng theo giọng đã gán ----
  const handlePlayAllLines = async (startLine: number = 1) => {
    if (srtLines.length === 0 || fullPreviewing) return;
    setMessage('');
    setIsError(false);
    setFullPreviewing(true);
    setFullPreviewLine(startLine);
    fullPreviewAbortRef.current = false;

    previewAudioRef.current?.pause();
    const audio = previewAudioRef.current ?? (previewAudioRef.current = new Audio());

    // Tải audio của 1 dòng (dùng đúng giọng sẽ gán khi tạo lồng tiếng)
    const fetchAudio = (idx: number) => {
      const line = srtLines[idx - 1];
      if (!line) return null;
      const lineVoice = voiceOverrides[String(idx)] || voice;
      return window.vanhsub.tts.preview(line.text.slice(0, 300), lineVoice, speed);
    };

    try {
      let current = fetchAudio(startLine);
      for (let i = startLine; i <= srtLines.length; i++) {
        if (fullPreviewAbortRef.current) break;
        setFullPreviewLine(i);
        const res = await current;
        if (!res || fullPreviewAbortRef.current) break;

        // Tải trước câu kế tiếp trong lúc câu hiện tại đang phát để giảm khoảng lặng
        const next = i < srtLines.length ? fetchAudio(i + 1) : null;

        audio.src = `data:${res.mimeType};base64,${res.audioBase64}`;
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          audio.onended = done;
          audio.onerror = done;
          audio.onpause = done; // bấm Dừng cũng thoát khỏi vòng lặp
          audio.play().catch(done);
        });
        current = next;
      }
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || 'Không thể nghe thử toàn bộ. Kiểm tra kết nối VietTTS.');
    } finally {
      audio.pause();
      setFullPreviewing(false);
      setFullPreviewLine(null);
    }
  };

  const stopFullPreview = () => {
    fullPreviewAbortRef.current = true;
    previewAudioRef.current?.pause();
  };

  // Cuộn tới dòng đang phát trong bảng gán giọng
  useEffect(() => {
    if (fullPreviewLine == null) return;
    document
      .getElementById(`voice-line-${fullPreviewLine}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [fullPreviewLine]);

  // Nạp lại danh sách giọng (server + giọng mẫu) sau khi thêm/xoá
  const refreshVoices = useCallback(async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.tts?.voices) return;
    try {
      const list = await window.vanhsub.tts.voices();
      setAvailableVoices(Array.isArray(list) ? list : []);
    } catch {
      // giữ nguyên danh sách cũ
    }
  }, []);

  const loadVoiceSamples = useCallback(async () => {
    if (typeof window === 'undefined' || !window.vanhsub?.tts?.voiceSamples) return;
    try {
      const list = await window.vanhsub.tts.voiceSamples();
      setVoiceSamples(Array.isArray(list) ? list : []);
    } catch {
      // bỏ qua
    }
  }, []);

  const handleAddVoiceSample = async () => {
    const name = newVoiceName.trim();
    setMessage('');
    setIsError(false);
    if (!name) {
      setIsError(true);
      setMessage('Nhập tên cho giọng trước khi chọn file.');
      return;
    }
    setAddingVoice(true);
    try {
      const res = await window.vanhsub.tts.addVoiceSample(name);
      if (res?.error) {
        setIsError(true);
        setMessage(res.error);
        return;
      }
      if (res?.canceled) return;
      setNewVoiceName('');
      setShowAddVoice(false);
      await loadVoiceSamples();
      await refreshVoices();
      if (res?.sample) setVoice(res.sample.name);
      setMessage(`Đã thêm giọng "${res?.sample?.name}" — bấm Nghe thử để kiểm tra.`);
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || 'Không thể thêm giọng mẫu.');
    } finally {
      setAddingVoice(false);
    }
  };

  const handleRemoveVoiceSample = async (name: string) => {
    try {
      await window.vanhsub.tts.removeVoiceSample(name);
      await loadVoiceSamples();
      await refreshVoices();
      if (voice === name) {
        // Giọng đang chọn bị xoá → quay về giọng server đầu tiên (hoặc fallback)
        const list = await window.vanhsub.tts.voices().catch(() => []);
        setVoice(list.find((v) => v !== name) || VOICE_OPTIONS[0].value);
      }
    } catch (err: any) {
      setIsError(true);
      setMessage(err?.message || 'Không thể xoá giọng mẫu.');
    }
  };

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

    loadVoiceSamples();
  }, [checkConnection, loadVoiceSamples]);

  // Lưu giọng/tốc độ người dùng chọn làm mặc định cho lần sau
  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.settings) return;
    window.vanhsub.settings.set('ttsVoice', voice).catch(() => {});
  }, [voice]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.settings) return;
    window.vanhsub.settings.set('ttsSpeed', speed).catch(() => {});
  }, [speed]);

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
      await window.vanhsub.tts.start(selectedTaskId, voice, speed, voiceOverrides);
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
            onClick={() => setShowAddVoice((prev) => !prev)}
            disabled={isTtsRunning || isDubbingRunning}
            title="Thêm giọng đọc từ file audio mẫu (clone giọng)"
            className={[
              'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
              showAddVoice || voiceSamples.length > 0
                ? 'border-brand-indigo/50 bg-brand-indigo/10 text-brand-indigo hover:bg-brand-indigo/20'
                : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700',
            ].join(' ')}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Thêm giọng{voiceSamples.length > 0 ? ` (${voiceSamples.length})` : ''}</span>
          </button>

          <button
            type="button"
            onClick={handlePreview}
            disabled={!vietTtsConnected || previewing || isTtsRunning || isDubbingRunning || fullPreviewing}
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

      {/* Panel thêm giọng đọc từ file audio mẫu */}
      {showAddVoice && (
        <div className="rounded-2xl border border-brand-indigo/40 bg-slate-900/80 p-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <UserPlus className="h-3.5 w-3.5 text-brand-indigo" />
              <span>Thêm giọng từ file audio mẫu (clone giọng)</span>
            </div>
            <button
              type="button"
              onClick={() => setShowAddVoice(false)}
              title="Đóng"
              className="flex h-6 w-6 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newVoiceName}
              onChange={(e) => setNewVoiceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !addingVoice) handleAddVoiceSample();
              }}
              placeholder="Tên giọng, vd: Giọng cô Hằng"
              className="min-w-[200px] flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-brand-cyan focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAddVoiceSample}
              disabled={addingVoice}
              title="Chọn file audio giọng mẫu (5–15 giây, rõ tiếng, ít nhiễu) rồi lưu"
              className="inline-flex items-center gap-1.5 rounded-xl border border-brand-indigo/40 bg-brand-indigo/10 px-3 py-1.5 text-xs font-semibold text-brand-indigo hover:bg-brand-indigo/20 cursor-pointer disabled:opacity-50"
            >
              {addingVoice ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserPlus className="h-3.5 w-3.5" />
              )}
              <span>{addingVoice ? 'Đang lưu...' : 'Chọn file & Thêm'}</span>
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            File mẫu nên 5–15 giây, một người nói, ít nhạc/nhiễu. Giọng clone được lưu
            trong máy và dùng được cho giọng chung lẫn gán theo từng câu.
          </p>

          {voiceSamples.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[11px] font-semibold text-slate-400">Giọng đã lưu:</p>
              {voiceSamples.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/80 p-2 text-xs"
                >
                  <Mic className="h-3.5 w-3.5 shrink-0 text-brand-indigo" />
                  <span className="font-medium text-slate-200">{s.name}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-500" title={s.originalName}>
                    ({s.originalName})
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveVoiceSample(s.name)}
                    title={`Xoá giọng "${s.name}"`}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-400 hover:border-rose-500/50 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
                    Đang nghe: {fullPreviewLine}/{srtLines.length}
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
                  onClick={() => handlePlayAllLines(1)}
                  disabled={srtLines.length === 0 || vietTtsConnected === false || linePreviewing !== null}
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
                style={{ width: `${((fullPreviewLine || 0) / Math.max(srtLines.length, 1)) * 100}%` }}
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
                      <option value="">Mặc định ({voiceLabel(voice)})</option>
                      {voiceList.map((v) => (
                        <option key={v} value={v}>
                          {voiceLabel(v)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handlePreviewLine(lineNumber, line.text, lineVoice)}
                      disabled={linePreviewing !== null || vietTtsConnected === false || fullPreviewing}
                      title="Nghe thử dòng này với giọng đã chọn"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/25 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {linePreviewing === lineNumber ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                    </button>
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
