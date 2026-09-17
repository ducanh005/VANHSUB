import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Play,
  RotateCcw,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  Mic,
  Film,
  Video,
  Share2,
  Download,
  FolderOpen,
  Volume2,
} from 'lucide-react';
import { useAiStudioStore } from '../../lib/store/aiStudioStore';
import type { PipelineSessionState, PipelineProgressEvent } from '../../types/aiStudio';

const STAGES = [
  { id: 1, name: 'Dữ kiện', icon: FileText },
  { id: 2, name: 'Kịch bản', icon: Sparkles },
  { id: 3, name: 'Lồng tiếng', icon: Mic },
  { id: 4, name: 'Trích xuất Time', icon: Clock },
  { id: 5, name: 'Storyboard', icon: Film },
  { id: 6, name: 'Ảnh / Video', icon: Film },
  { id: 7, name: 'Dựng phim', icon: Video },
  { id: 8, name: 'SEO & Xuất bản', icon: Share2 },
];

const PRESETS = [
  '5 Bí Ẩn Rùng Mình Dưới Đáy Biển Sâu Chưa Từng Được Tiết Lộ',
  'Tại Sao Đầu Tư Trí Tuệ Nhân Tạo Năm 2026 Không Bao Giờ Lỗ',
  '3 Thói Quen Của Người Giàu Khiến Tiền Tự Chảy Vào Túi',
  'Hành Trình Khám Phá Hố Đen Vũ Trụ Và Giới Hạn Vật Lý',
];

export default function AutoPilotView() {
  const { config } = useAiStudioStore();
  const [topic, setTopic] = useState('');
  const [session, setSession] = useState<PipelineSessionState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.aiStudio) return;

    const unsubscribe = window.vanhsub.aiStudio.onPipelineProgress((event: PipelineProgressEvent) => {
      setSession((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        next.currentStage = event.stage as any;
        next.progress = event.progress;
        if (event.artifacts) {
          next.artifacts = { ...next.artifacts, ...event.artifacts };
        }
        if (!next.stages || Array.isArray(next.stages)) {
          next.stages = {};
        }
        const stageMap = next.stages as Record<number, any>;
        if (stageMap[event.stage]) {
          stageMap[event.stage].status = event.status;
        }
        if (event.status === 'error') {
          setErrorMessage(event.error || 'Có lỗi xảy ra trong tiến trình');
          setIsRunning(false);
        }
        if (event.progress >= 100) {
          next.status = 'completed';
          setIsRunning(false);
        }
        return next;
      });
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const handleStart = async () => {
    if (!topic.trim()) return;
    setErrorMessage(null);
    setIsRunning(true);

    try {
      const result = await window.vanhsub.aiStudio.startPipeline({ topic: topic.trim() });
      const initialSession: PipelineSessionState = {
        sessionId: result.sessionId,
        topic: topic.trim(),
        currentStage: 1,
        stageName: 'source',
        status: 'running',
        progress: 5,
        stages: {
          1: { status: 'running', stageName: 'Dữ kiện', stage: 1 },
          2: { status: 'pending', stageName: 'Kịch bản', stage: 2 },
          3: { status: 'pending', stageName: 'Lồng tiếng', stage: 3 },
          4: { status: 'pending', stageName: 'Trích xuất Time', stage: 4 },
          5: { status: 'pending', stageName: 'Storyboard', stage: 5 },
          6: { status: 'pending', stageName: 'Ảnh / Video', stage: 6 },
          7: { status: 'pending', stageName: 'Dựng phim', stage: 7 },
          8: { status: 'pending', stageName: 'SEO & Xuất bản', stage: 8 },
        },
        artifacts: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setSession(initialSession);
    } catch (err: any) {
      setIsRunning(false);
      setErrorMessage(err?.message || 'Không thể khởi động pipeline');
    }
  };

  const handleOpenFolder = (pathStr?: string) => {
    if (pathStr && window.vanhsub?.dialog) {
      if (window.vanhsub.dialog.showInFolder) {
        window.vanhsub.dialog.showInFolder(pathStr);
      } else if (window.vanhsub.dialog.openFolder) {
        window.vanhsub.dialog.openFolder(pathStr);
      }
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6 text-slate-200">
      {/* Input Header Section */}
      <div className="rounded-3xl border border-slate-800 bg-gradient-to-b from-slate-900/80 to-slate-950/80 p-6 shadow-2xl backdrop-blur-md mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="rounded-full bg-brand-cyan/10 px-2.5 py-0.5 text-[11px] font-semibold text-brand-cyan border border-brand-cyan/20">
            ⚡ One-Click Auto Pilot
          </span>
          <span className="text-xs text-slate-400">
            Tự động sinh trọn gói từ Kịch bản, Giọng đọc, Storyboard đến Dựng phim hoàn chỉnh.
          </span>
        </div>

        {config.llm.provider === 'chatgpt_web' && (
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-950/40 px-4 py-2.5 text-xs text-emerald-300">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-semibold text-emerald-200">⚡ Chế độ Tiết kiệm:</span>
              <span>Đang chạy kịch bản qua ChatGPT Web miễn phí (0₫ API Token).</span>
            </div>
            <span className="rounded-md bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-mono text-emerald-300 border border-emerald-500/30">
              {config.llm.chatgptWebMode === 'visible' ? '🖥️ Cửa sổ trực tiếp' : '👻 Chạy ngầm'}
            </span>
          </div>
        )}

        <h2 className="text-lg font-bold text-white mb-4">
          Nhập chủ đề hoặc ý tưởng video bạn muốn AI sản xuất:
        </h2>

        <div className="flex flex-col md:flex-row gap-3">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isRunning && handleStart()}
            placeholder="Ví dụ: Tại sao đầu tư AI vào YouTube bây giờ chưa bao giờ là lỗ..."
            className="flex-1 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan focus:outline-none"
          />
          <button
            type="button"
            onClick={handleStart}
            disabled={isRunning || !topic.trim()}
            className="btn-vanh-gradient inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white shadow-lg shadow-brand-cyan/25 hover:brightness-110 disabled:opacity-50 cursor-pointer"
          >
            {isRunning ? (
              <>
                <RotateCcw className="h-4 w-4 animate-spin" />
                <span>Đang sản xuất...</span>
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-white" />
                <span>Bắt đầu sản xuất</span>
              </>
            )}
          </button>
        </div>

        {/* Quick Suggestion Chips */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500 font-medium">Gợi ý nhanh:</span>
          {PRESETS.map((p, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setTopic(p)}
              className="rounded-xl border border-slate-800 bg-slate-900/60 px-2.5 py-1 text-[11px] text-slate-400 hover:border-brand-cyan/40 hover:text-brand-cyan transition cursor-pointer"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="mb-6 flex items-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Pipeline Status Tracker (8 Steps) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Pipeline Stepper & Progress */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand-cyan" />
                Tiến độ sản xuất video (8 công đoạn)
              </h3>
              <span className="text-xs font-mono font-bold text-brand-cyan">
                {session?.progress || 0}%
              </span>
            </div>

            {/* Overall Progress Bar */}
            <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden mb-6">
              <div
                className="h-full bg-gradient-to-r from-brand-cyan to-brand-indigo rounded-full transition-all duration-500"
                style={{ width: `${session?.progress || 0}%` }}
              />
            </div>

            {/* 8 Steps List */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {STAGES.map((st) => {
                const Icon = st.icon;
                const stagesMap = (session?.stages || {}) as Record<number, any>;
                const stageStatus = stagesMap[st.id]?.status || 'pending';
                const isCurrent = session?.currentStage === st.id && session?.status === 'running';

                let statusBadge = (
                  <span className="text-[10px] text-slate-500 font-medium">Chờ</span>
                );
                let borderColor = 'border-slate-800 bg-slate-950/40';

                if (stageStatus === 'success') {
                  statusBadge = (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> Xong
                    </span>
                  );
                  borderColor = 'border-emerald-500/30 bg-emerald-500/5';
                } else if (stageStatus === 'running' || isCurrent) {
                  statusBadge = (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand-cyan animate-pulse">
                      <RotateCcw className="h-3 w-3 animate-spin" /> Đang chạy
                    </span>
                  );
                  borderColor = 'border-brand-cyan/50 bg-brand-cyan/10 ring-1 ring-brand-cyan/50';
                } else if (stageStatus === 'error') {
                  statusBadge = (
                    <span className="text-[10px] font-semibold text-rose-400">Lỗi</span>
                  );
                  borderColor = 'border-rose-500/40 bg-rose-500/10';
                }

                return (
                  <div
                    key={st.id}
                    className={`flex flex-col justify-between rounded-2xl border p-3 transition-all ${borderColor}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-mono text-slate-400">#{st.id}</span>
                      <Icon className="h-4 w-4 text-slate-400" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white mb-1">{st.name}</div>
                      {statusBadge}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Script & Voice Preview Box */}
          {session?.artifacts?.scriptLines && session.artifacts.scriptLines.length > 0 && (
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-brand-cyan" />
                  Kịch bản sản xuất ({session.artifacts.scriptLines.length} câu)
                </h4>
                {session.artifacts.audioPath && (
                  <button
                    type="button"
                    onClick={() => handleOpenFolder(session.artifacts.audioPath)}
                    className="flex items-center gap-1 text-xs text-brand-cyan hover:underline cursor-pointer"
                  >
                    <FolderOpen className="h-3.5 w-3.5" /> Mở thư mục Audio
                  </button>
                )}
              </div>

              {/* Audio Player if available */}
              {session.artifacts.audioPath && (
                <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-3 flex items-center gap-3">
                  <Volume2 className="h-5 w-5 text-brand-cyan shrink-0" />
                  <audio
                    controls
                    src={`vanhmedia://local/${encodeURIComponent(session.artifacts.audioPath)}`}
                    className="w-full h-8"
                  />
                </div>
              )}

              <div className="max-h-60 space-y-2 overflow-y-auto pr-2 text-xs">
                {session.artifacts.scriptLines.map((line, idx) => (
                  <div
                    key={line.id || idx}
                    className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-2.5 flex items-start gap-3"
                  >
                    <span className="font-mono text-[10px] text-brand-cyan bg-brand-cyan/10 px-1.5 py-0.5 rounded">
                      {idx + 1}
                    </span>
                    <p className="text-slate-200 leading-relaxed">{line.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Col: Video Preview & SEO Box */}
        <div className="space-y-6">
          {/* Video Preview Box */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-sm flex flex-col justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-2">
              <Video className="h-4 w-4 text-brand-cyan" />
              Video Hoàn Chỉnh
            </h3>

            {session?.artifacts?.videoPath ? (
              <div className="space-y-3">
                <div className="aspect-video w-full rounded-2xl overflow-hidden border border-slate-700 bg-black">
                  <video
                    controls
                    autoPlay
                    src={`vanhmedia://local/${encodeURIComponent(session.artifacts.videoPath)}`}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenFolder(session.artifacts.videoPath)}
                    className="flex-1 btn-vanh-gradient flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold text-white shadow-lg cursor-pointer"
                  >
                    <FolderOpen className="h-4 w-4" /> Mở File Video
                  </button>
                </div>
              </div>
            ) : (
              <div className="aspect-video w-full rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 flex flex-col items-center justify-center text-slate-500 p-6 text-center">
                <Film className="h-8 w-8 mb-2 text-slate-600 animate-pulse" />
                <p className="text-xs">Video sẽ tự động hiển thị tại đây sau khi hoàn tất công đoạn Dựng phim.</p>
              </div>
            )}
          </div>

          {/* SEO Metadata Box */}
          {session?.artifacts?.metadata && (
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-sm space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Share2 className="h-4 w-4 text-brand-cyan" />
                Gói SEO & Xuất bản Viral
              </h3>
              <div className="text-xs space-y-2">
                <div>
                  <span className="text-slate-400 font-medium">Tiêu đề đề xuất:</span>
                  <p className="font-bold text-white mt-0.5">{session.artifacts.metadata.title}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Hashtags:</span>
                  <p className="font-mono text-brand-cyan mt-0.5">
                    {session.artifacts.metadata.hashtags.join(' ')}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Mô tả video:</span>
                  <p className="text-slate-300 mt-0.5 whitespace-pre-line text-[11px] bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                    {session.artifacts.metadata.description}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
