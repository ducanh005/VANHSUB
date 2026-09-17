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
  FolderOpen,
  Volume2,
  Lightbulb,
  ShieldCheck,
  ArrowRight,
  Target,
  Zap,
  Settings,
} from 'lucide-react';
import { useAiStudioStore } from '../../lib/store/aiStudioStore';
import type {
  PipelineSessionState,
  PipelineProgressEvent,
  IdeaBlueprint,
} from '../../types/aiStudio';
import IdeaGenerationModal from './IdeaGenerationModal';
import ChannelConfigModal from './ChannelConfigModal';

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
  const [isApproving, setIsApproving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGatedMode, setIsGatedMode] = useState(true); // Chu trình từng bước có phê duyệt
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);

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
        if (event.status === 'awaiting_approval') {
          next.status = 'awaiting_approval';
          setIsRunning(false);
        } else if (event.status === 'error') {
          next.status = 'failed';
          setErrorMessage(event.error || 'Có lỗi xảy ra trong tiến trình');
          setIsRunning(false);
        } else if (event.status === 'running') {
          next.status = 'running';
          setIsRunning(true);
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

  const handleStartWithBlueprint = async (blueprint: IdeaBlueprint) => {
    setErrorMessage(null);
    setIsRunning(true);
    setTopic(blueprint.title || blueprint.topic);

    try {
      const result = await window.vanhsub.aiStudio.startPipeline({
        topic: (blueprint.title || blueprint.topic).trim(),
        blueprint,
        gatedMode: isGatedMode,
      });

      const initialSession: PipelineSessionState = {
        sessionId: result.sessionId,
        topic: (blueprint.title || blueprint.topic).trim(),
        currentStage: 1,
        stageName: 'source',
        status: 'running',
        progress: 5,
        gatedMode: isGatedMode,
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
        artifacts: {
          blueprint,
          ideaSummary: blueprint.rawSummary || blueprint.title,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setSession(initialSession);
    } catch (err: any) {
      setIsRunning(false);
      setErrorMessage(err?.message || 'Không thể khởi động pipeline');
    }
  };

  const handleStartQuick = async () => {
    if (!topic.trim()) return;
    setErrorMessage(null);
    setIsRunning(true);

    try {
      const result = await window.vanhsub.aiStudio.startPipeline({
        topic: topic.trim(),
        gatedMode: isGatedMode,
      });

      const initialSession: PipelineSessionState = {
        sessionId: result.sessionId,
        topic: topic.trim(),
        currentStage: 1,
        stageName: 'source',
        status: 'running',
        progress: 5,
        gatedMode: isGatedMode,
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

  const handleApproveStage = async () => {
    if (!session || !window.vanhsub?.aiStudio?.approveStage) return;
    setIsApproving(true);
    setErrorMessage(null);

    try {
      await window.vanhsub.aiStudio.approveStage({
        sessionId: session.sessionId,
        currentStage: session.currentStage,
      });
      setIsRunning(true);
      setSession((prev) => (prev ? { ...prev, status: 'running' } : null));
    } catch (err: any) {
      setErrorMessage(`Lỗi phê duyệt: ${err?.message || err}`);
    } finally {
      setIsApproving(false);
    }
  };

  const handleRetryCurrentStage = async () => {
    if (!session || !window.vanhsub?.aiStudio?.resumePipeline) return;
    setErrorMessage(null);
    setIsRunning(true);

    try {
      await window.vanhsub.aiStudio.resumePipeline({
        sessionId: session.sessionId,
        fromStage: session.currentStage,
      });
      setSession((prev) => (prev ? { ...prev, status: 'running' } : null));
    } catch (err: any) {
      setIsRunning(false);
      setErrorMessage(`Không thể chạy lại bước: ${err?.message || err}`);
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
      {/* Modal: Tạo & Sinh Ý Tưởng Video */}
      <IdeaGenerationModal
        isOpen={isModalOpen}
        initialTopic={topic}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleStartWithBlueprint}
      />

      {/* Modal: Cấu hình Kênh · Bộ não AI, Giọng đọc & Model */}
      <ChannelConfigModal
        isOpen={isChannelModalOpen}
        onClose={() => setIsChannelModalOpen(false)}
      />

      {/* Input Header Section */}
      <div className="rounded-3xl border border-slate-800 bg-gradient-to-b from-slate-900/80 to-slate-950/80 p-6 shadow-2xl backdrop-blur-md mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand-cyan/10 px-2.5 py-0.5 text-[11px] font-semibold text-brand-cyan border border-brand-cyan/20">
              ⚡ One-Click Auto Pilot
            </span>
            <span className="text-xs text-slate-400">
              Sản xuất video tự động từ Kịch bản, Giọng đọc, Storyboard đến Dựng phim hoàn chỉnh.
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Button mở Cấu hình kênh */}
            <button
              type="button"
              onClick={() => setIsChannelModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-brand-cyan/40 hover:text-white transition cursor-pointer"
              title="Cấu hình bộ não AI, giọng đọc và Master Prompt của kênh"
            >
              <Settings className="h-3.5 w-3.5 text-brand-cyan" />
              <span>⚙️ Cấu hình kênh</span>
              {config.channelProfile?.channelNiche && (
                <span className="max-w-[120px] truncate rounded bg-brand-cyan/10 px-1.5 py-0.2 text-[10px] font-bold text-brand-cyan border border-brand-cyan/20">
                  {config.channelProfile.channelNiche}
                </span>
              )}
            </button>

            {/* Gated Mode Toggle (Chu trình từng bước có phê duyệt) */}
            <label className="flex items-center gap-2 cursor-pointer select-none rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-1.5 hover:border-slate-700 transition">
              <input
                type="checkbox"
                checked={isGatedMode}
                onChange={(e) => setIsGatedMode(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-brand-cyan focus:ring-brand-cyan focus:ring-offset-0"
              />
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-brand-cyan" />
                <span>Chế độ từng bước (Cần duyệt)</span>
              </span>
            </label>
          </div>
        </div>

        {/* Active Channel Profile Banner (nếu có cấu hình) */}
        {config.channelProfile?.channelNiche && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-brand-cyan/25 bg-gradient-to-r from-brand-cyan/10 via-brand-indigo/10 to-transparent px-4 py-2.5 text-xs text-brand-cyan">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-brand-cyan animate-pulse" />
              <span className="font-bold text-white">📺 Kênh hoạt động:</span>
              <span className="font-semibold text-brand-cyan">{config.channelProfile.channelNiche}</span>
              {config.channelProfile.channelHook && (
                <span className="hidden md:inline text-slate-400">· Hook: "{config.channelProfile.channelHook}"</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsChannelModalOpen(true)}
              className="text-[11px] font-medium text-slate-400 hover:text-white underline cursor-pointer"
            >
              Chỉnh sửa cấu hình kênh ▸
            </button>
          </div>
        )}

        {config.llm.provider === 'chatgpt_web' && (
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-950/40 px-4 py-2.5 text-xs text-emerald-300">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-semibold text-emerald-200">⚡ Chế độ Tiết kiệm:</span>
              <span>Đang kết nối ChatGPT Web (0₫ API Token).</span>
            </div>
            <span className="rounded-md bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-mono text-emerald-300 border border-emerald-500/30">
              {config.llm.chatgptWebMode === 'visible' ? '🖥️ Cửa sổ trực tiếp' : '👻 Chạy ngầm'}
            </span>
          </div>
        )}

        {config.llm.provider === 'gemini_web' && (
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-blue-500/30 bg-blue-950/40 px-4 py-2.5 text-xs text-blue-300">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="font-semibold text-blue-200">⚡ Chế độ Tiết kiệm:</span>
              <span>Đang kết nối Gemini Web (0₫ API Token).</span>
            </div>
            <span className="rounded-md bg-blue-500/20 px-2.5 py-0.5 text-[11px] font-mono text-blue-300 border border-blue-500/30">
              {config.llm.geminiWebMode === 'visible' ? '🖥️ Cửa sổ trực tiếp' : '👻 Chạy ngầm'}
            </span>
          </div>
        )}

        <h2 className="text-base font-bold text-white mb-3">
          Nhập chủ đề hoặc mở cửa sổ Tạo &amp; Sinh Ý Tưởng Video:
        </h2>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isRunning && handleStartQuick()}
            placeholder="Ví dụ: Cú sốc tài chính toàn cầu 2026 - Sự thật chưa ai kể..."
            className="flex-1 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan focus:outline-none"
          />

          {/* Button: Mở Modal Lên Ý Tưởng Chi Tiết */}
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-500 to-rose-500 px-5 py-3 text-xs font-bold text-white shadow-lg shadow-amber-500/20 hover:brightness-110 active:scale-95 transition cursor-pointer"
          >
            <Lightbulb className="h-4 w-4 fill-white text-white" />
            <span>💡 Tạo &amp; Sinh Ý Tưởng (Chi tiết)</span>
          </button>

          {/* Quick Start Button */}
          <button
            type="button"
            onClick={handleStartQuick}
            disabled={isRunning || !topic.trim()}
            className="btn-vanh-gradient inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-xs font-bold text-white shadow-lg shadow-brand-cyan/25 hover:brightness-110 active:scale-95 disabled:opacity-50 cursor-pointer transition"
          >
            {isRunning ? (
              <>
                <RotateCcw className="h-4 w-4 animate-spin" />
                <span>Đang xử lý...</span>
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

      {/* Gated Stage Approval Banner (Chờ phê duyệt) */}
      {session?.status === 'awaiting_approval' && (
        <div className="mb-6 rounded-3xl border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-slate-900/90 to-slate-950/90 p-5 backdrop-blur-md shadow-2xl animate-in fade-in duration-300">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400 shadow-md">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/30">
                    BƯỚC {session.currentStage}/8 HOÀN TẤT
                  </span>
                  <h3 className="text-sm font-bold text-white">
                    {STAGES.find((s) => s.id === session.currentStage)?.name}: Đang chờ bạn phê duyệt!
                  </h3>
                </div>
                <p className="text-xs text-slate-400">
                  Vui lòng kiểm tra dữ liệu đầu ra bên dưới. Khi đã hài lòng, bấm nút phê duyệt để hệ thống sản xuất bước tiếp theo.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 self-end md:self-center">
              <button
                type="button"
                onClick={handleRetryCurrentStage}
                disabled={isApproving}
                className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Chạy lại bước này</span>
              </button>

              <button
                type="button"
                onClick={handleApproveStage}
                disabled={isApproving}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-500/25 active:scale-95 transition cursor-pointer disabled:opacity-50"
              >
                {isApproving ? (
                  <>
                    <RotateCcw className="h-3.5 w-3.5 animate-spin" />
                    <span>Đang kích hoạt...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>
                      Duyệt &amp; Sang Bước {session.currentStage + 1}:{' '}
                      {STAGES.find((s) => s.id === session.currentStage + 1)?.name || 'Kế tiếp'}
                    </span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Real Error Banner with Explicit Retry (No Fake Fallback) */}
      {(errorMessage || session?.status === 'failed') && (
        <div className="mb-6 rounded-3xl border border-rose-500/40 bg-gradient-to-r from-rose-950/40 via-slate-900/90 to-slate-950/90 p-5 backdrop-blur-md shadow-2xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-rose-300">
                  Lỗi thực tế tại Công đoạn {session?.currentStage || 1} (Không chạy giả lập)
                </h4>
                <p className="text-xs text-rose-200/90 mt-1 leading-relaxed">
                  {errorMessage || 'Tiến trình gặp lỗi kết nối hoặc xử lý dữ liệu.'}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Ứng dụng đã tạm dừng để bảo toàn dữ liệu. Bạn có thể kiểm tra lại cấu hình hoặc bấm nút &quot;Thử lại bước này&quot;.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleRetryCurrentStage}
              className="flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-500 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-rose-600/30 active:scale-95 transition cursor-pointer self-end sm:self-center"
            >
              <RotateCcw className="h-4 w-4" />
              <span>Thử lại bước này</span>
            </button>
          </div>
        </div>
      )}

      {/* Pipeline Status Tracker (8 Steps) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Pipeline Stepper & Artifact Previews */}
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
                const isCurrent = session?.currentStage === st.id;

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
                } else if (session?.status === 'awaiting_approval' && isCurrent) {
                  statusBadge = (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400 animate-pulse">
                      <ShieldCheck className="h-3 w-3" /> Chờ duyệt
                    </span>
                  );
                  borderColor = 'border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/40';
                } else if (stageStatus === 'running' || (isCurrent && session?.status === 'running')) {
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

          {/* Stage 1: Idea Blueprint Preview Card */}
          {session?.artifacts?.blueprint && (
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-sm space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-amber-400" />
                  Dữ kiện ý tưởng video (Khung hình: {session.artifacts.blueprint.aspectRatio || '16:9'})
                </h4>
                <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-mono text-amber-300 border border-amber-500/20">
                  {session.artifacts.blueprint.aspectRatio === '9:16' ? '📱 Video Ngắn (9:16)' : '🎬 Video Dài (16:9)'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3 space-y-1">
                  <span className="text-slate-400 font-semibold flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5 text-amber-400" /> Hook 3s mở đầu:
                  </span>
                  <p className="text-slate-200">{session.artifacts.blueprint.hookConcept}</p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3 space-y-1">
                  <span className="text-slate-400 font-semibold flex items-center gap-1">
                    <Target className="h-3.5 w-3.5 text-cyan-400" /> Góc nhìn / Đột phá (Angle):
                  </span>
                  <p className="text-slate-200">{session.artifacts.blueprint.narrativeAngle}</p>
                </div>
              </div>

              {session.artifacts.blueprint.outline && session.artifacts.blueprint.outline.length > 0 && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3 space-y-1 text-xs">
                  <span className="text-slate-400 font-semibold">Dàn ý phân đoạn:</span>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-300 text-[11px] font-mono">
                    {session.artifacts.blueprint.outline.map((o, idx) => (
                      <li key={idx}>{o}</li>
                    ))}
                  </ul>
                </div>
              )}

              {session.artifacts.blueprint.existingScript && (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs space-y-1">
                  <span className="font-semibold text-emerald-300">📜 Kịch bản có sẵn được nạp:</span>
                  <p className="text-[11px] text-slate-300 line-clamp-3 italic">
                    &quot;{session.artifacts.blueprint.existingScript}&quot;
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Script & Voice Preview Box */}
          {session?.artifacts?.scriptLines && session.artifacts.scriptLines.length > 0 && (
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-brand-cyan" />
                  Kịch bản sản xuất ({session.artifacts.scriptLines.length} phân cảnh)
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

              <div className="max-h-64 space-y-2 overflow-y-auto pr-2 text-xs custom-scrollbar">
                {session.artifacts.scriptLines.map((line, idx) => (
                  <div
                    key={line.id || idx}
                    className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-2.5 flex items-start gap-3"
                  >
                    <span className="font-mono text-[10px] text-brand-cyan bg-brand-cyan/10 px-1.5 py-0.5 rounded">
                      #{idx + 1}
                    </span>
                    <div className="flex-1">
                      <p className="text-slate-200 leading-relaxed">{line.text}</p>
                      {line.visualPromptEn && (
                        <p className="text-[10px] font-mono text-slate-500 mt-1 line-clamp-1">
                          🎨 {line.visualPromptEn}
                        </p>
                      )}
                    </div>
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
                <div
                  className={`w-full rounded-2xl overflow-hidden border border-slate-700 bg-black ${
                    session?.artifacts?.blueprint?.aspectRatio === '9:16'
                      ? 'aspect-[9/16] max-h-[420px] mx-auto'
                      : 'aspect-video'
                  }`}
                >
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
                <p className="text-xs">
                  Video sẽ tự động hiển thị tại đây sau khi hoàn tất công đoạn Dựng phim.
                </p>
              </div>
            )}
          </div>

          {/* SEO Metadata Box */}
          {session?.artifacts?.metadata && (
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-sm space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Share2 className="h-4 w-4 text-brand-cyan" />
                Gói SEO &amp; Xuất bản Viral
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
