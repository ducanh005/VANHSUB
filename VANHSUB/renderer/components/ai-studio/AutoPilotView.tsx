import React, { useState, useEffect, useRef } from 'react';
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
  Lock,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAiStudioStore } from '../../lib/store/aiStudioStore';
import type {
  PipelineSessionState,
  PipelineProgressEvent,
  IdeaBlueprint,
} from '../../types/aiStudio';
import IdeaGenerationModal from './IdeaGenerationModal';
import ChannelConfigModal from './ChannelConfigModal';
import ScriptWorkspaceView from './ScriptWorkspaceView';

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

interface AutoPilotViewProps {
  onSwitchProject?: () => void;
}

export default function AutoPilotView({ onSwitchProject }: AutoPilotViewProps = {}) {
  const { config, updateChannelProfileConfig } = useAiStudioStore();
  const [topic, setTopic] = useState('');
  const [session, setSession] = useState<PipelineSessionState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGatedMode, setIsGatedMode] = useState(true); // Chu trình từng bước có phê duyệt
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);

  // 3-Column Studio States (Matching Revo Studio UI)
  const [activeTab, setActiveTab] = useState<'video' | 'facebook'>('video');
  const [selectedFormat, setSelectedFormat] = useState<'16:9' | '9:16'>('16:9');
  const [ideas, setIdeas] = useState<IdeaBlueprint[]>([]);
  const [selectedIdea, setSelectedIdea] = useState<IdeaBlueprint | null>(null);
  const [centerTab, setCenterTab] = useState<'script' | 'visual' | 'character'>('script');

  // Host & Character States
  const [newCharName, setNewCharName] = useState('');
  const [newCharDesc, setNewCharDesc] = useState('');
  const [hostToast, setHostToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setCenterTab('script');
    setTopic(blueprint.title || blueprint.topic);
    setSelectedIdea(blueprint);

    // Lưu vào danh sách ý tưởng
    setIdeas((prev) => {
      const exists = prev.some((i) => i.title === blueprint.title && i.aspectRatio === blueprint.aspectRatio);
      return exists ? prev : [blueprint, ...prev];
    });

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

  const handleHostAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        updateChannelProfileConfig({ hostAvatarUrl: reader.result });
        setHostToast('Đã tải ảnh đại diện host thành công!');
        setTimeout(() => setHostToast(null), 3000);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAiGenerateHost = () => {
    const desc = config.channelProfile?.hostDescription?.trim();
    if (!desc) {
      setHostToast('⚠️ Vui lòng nhập mô tả host để AI có căn cứ sinh hình ảnh.');
      setTimeout(() => setHostToast(null), 3500);
      return;
    }
    setHostToast(`✨ Đã nạp mô tả host vào bộ sinh Visual của kênh! Khi sản xuất, Flow sẽ tự động render ảnh host.`);
    setTimeout(() => setHostToast(null), 4000);
  };

  const handleAddCharacter = async () => {
    if (!newCharName.trim()) return;
    const currentChars = config.channelProfile?.channelCharacters || [];
    const updated = [
      ...currentChars,
      {
        id: `char_${Date.now()}`,
        name: newCharName.trim(),
        descriptionEn: newCharDesc.trim(),
      },
    ];
    await updateChannelProfileConfig({ channelCharacters: updated });
    setNewCharName('');
    setNewCharDesc('');
  };

  const handleRemoveCharacter = async (index: number) => {
    const currentChars = config.channelProfile?.channelCharacters || [];
    const updated = currentChars.filter((_, idx) => idx !== index);
    await updateChannelProfileConfig({ channelCharacters: updated });
  };

  const projectName = config.channelProfile?.projectName || 'Chưa đặt tên';
  const aiProviderName =
    config.llm.provider === 'chatgpt_web'
      ? 'ChatGPT Web'
      : config.llm.provider === 'gemini_web'
      ? 'Gemini Web'
      : config.llm.provider.toUpperCase();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#070B13] text-slate-200 select-none">
      {/* Modal: Tạo & Sinh Ý Tưởng Video */}
      <IdeaGenerationModal
        isOpen={isModalOpen}
        initialTopic={selectedIdea?.title || topic}
        onClose={() => setIsModalOpen(false)}
        onSubmit={(blueprint) => {
          setIsModalOpen(false);
          handleStartWithBlueprint(blueprint);
        }}
      />

      {/* Modal: Cấu hình Kênh · Bộ não AI, Giọng đọc & Model */}
      <ChannelConfigModal
        isOpen={isChannelModalOpen}
        onClose={() => setIsChannelModalOpen(false)}
      />

      {/* ==================================================================== */}
      {/* TOP HEADER BAR (Revo Studio Style: media_1789652444948.png)           */}
      {/* ==================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-[#090E18] px-5 py-2.5 shrink-0">
        <div className="flex items-center gap-3">
          {/* Tên Project / Kênh với icon lấp lánh và nút đổi project */}
          <div className="flex items-center rounded-lg border border-slate-800 bg-[#0F1626] overflow-hidden shadow-sm">
            <button
              type="button"
              onClick={() => setIsChannelModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800/60 transition cursor-pointer"
              title="Bấm để mở Cấu hình kênh & Master Prompt"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span>{projectName}</span>
            </button>
            {onSwitchProject && (
              <button
                type="button"
                onClick={onSwitchProject}
                className="border-l border-slate-800/80 px-2 py-1.5 text-[11px] font-semibold text-brand-cyan hover:bg-slate-800 hover:text-white transition cursor-pointer"
                title="Quay lại màn hình thiết lập project"
              >
                Đổi
              </button>
            )}
          </div>

          {/* AI STUDIO Badge */}
          <span className="rounded-md bg-[#131C2E] px-2 py-1 text-[11px] font-bold text-slate-300 border border-slate-700/50">
            AI STUDIO
          </span>

          {/* Pill Toggle Switch: 🎥 Video vs 📄 Bài viết FB */}
          <div className="flex items-center rounded-lg bg-[#0F1626] p-0.5 border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('video')}
              className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-bold transition cursor-pointer ${
                activeTab === 'video'
                  ? 'bg-[#FA5252] text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>🎥 Video</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('facebook')}
              className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold transition cursor-pointer ${
                activeTab === 'facebook'
                  ? 'bg-[#FA5252] text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>📄 Bài viết FB</span>
            </button>
          </div>

          {/* AI Model Badge */}
          <span className="rounded-md bg-[#121E36] px-2.5 py-0.5 text-[11px] font-mono font-bold text-blue-400 border border-blue-500/20">
            AI 3/5 · {aiProviderName}
          </span>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {/* Flow status */}
          <span className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0F1626] px-2.5 py-1 text-xs font-mono text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Flow 1/1 •</span>
          </span>

          {/* Telegram shortcut button */}
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0F1626] px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-700 transition cursor-pointer"
          >
            <span>Telegram 💬</span>
          </button>

          {/* Thống kê button */}
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0F1626] px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-700 transition cursor-pointer"
          >
            <span>📊 Thống kê</span>
          </button>

          {/* Cấu hình kênh button */}
          <button
            type="button"
            onClick={() => setIsChannelModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0F1626] px-3 py-1 text-xs font-semibold text-slate-300 hover:text-white hover:border-slate-700 transition cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5 text-brand-cyan" />
            <span>⚙ Cấu hình</span>
          </button>
        </div>
      </div>

      {/* Subtitle / Status Line */}
      <div className="border-b border-slate-800/60 bg-[#080C14] px-5 py-1.5 text-xs text-slate-400 flex items-center justify-between shrink-0">
        <p className="truncate">
          Dây chuyền:{' '}
          {session ? (
            <span className="text-amber-400 font-medium">đang xử lý: {session.topic}</span>
          ) : (
            'chưa có tập'
          )}{' '}
          ·{' '}
          {ideas.length > 0 ? (
            <span className="text-slate-300 font-medium">{ideas.length} ý tưởng chờ</span>
          ) : (
            'chưa có ý tưởng chờ'
          )}{' '}
          — bấm <strong className="text-white font-semibold">Sinh ý tưởng</strong>
        </p>

        <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-400 hover:text-slate-200">
          <input
            type="checkbox"
            checked={isGatedMode}
            onChange={(e) => setIsGatedMode(e.target.checked)}
            className="rounded border-slate-700 bg-slate-900 text-brand-cyan focus:ring-0 h-3.5 w-3.5 cursor-pointer"
          />
          <span>Phê duyệt từng bước (Gated)</span>
        </label>
      </div>

      {/* ==================================================================== */}
      {/* 3-COLUMN REVO WORKSPACE LAYOUT                                        */}
      {/* ==================================================================== */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* ------------------------------------------------------------------ */}
        {/* CỘT 1 (LEFT - 3 COLS): Ý TƯỞNG VIDEO                              */}
        {/* ------------------------------------------------------------------ */}
        <div className="lg:col-span-3 flex flex-col h-full border-r border-slate-800/80 bg-[#070B13] overflow-hidden">
          {/* Header Cột 1 */}
          <div className="p-3.5 border-b border-slate-800/80 flex items-center justify-between gap-2 shrink-0">
            <h3 className="text-sm font-bold text-white tracking-wide">Ý tưởng</h3>
            <div className="flex items-center gap-2">
              <select
                value={selectedFormat}
                onChange={(e) => setSelectedFormat(e.target.value as '16:9' | '9:16')}
                className="rounded-lg border border-slate-800 bg-[#0E1526] px-2 py-1 text-xs text-slate-300 focus:outline-none cursor-pointer"
              >
                <option value="16:9">🎬 Video dài</option>
                <option value="9:16">📱 Shorts</option>
              </select>

              {/* Nút ✨ Sinh (Mở modal tạo & sinh ý tưởng) */}
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-1 rounded-lg bg-[#FA5252] hover:bg-[#e04545] px-3 py-1 text-xs font-bold text-white shadow transition active:scale-95 cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Sinh</span>
              </button>
            </div>
          </div>

          {/* Nội dung danh sách ý tưởng / Trạng thái trống */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
            {ideas.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-500 text-xs leading-relaxed">
                <Lightbulb className="h-8 w-8 text-slate-600 mb-3 stroke-[1.5]" />
                <p>Chưa có ý tưởng.</p>
                <p className="mt-1">
                  Bấm &quot;✨ Sinh&quot; (cần đã chọn engine + cấu hình AI provider ở Settings).
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {ideas.map((idea, idx) => {
                  const isSelected = selectedIdea === idea;
                  return (
                    <div
                      key={idx}
                      onClick={() => setSelectedIdea(idea)}
                      className={`rounded-xl border p-3 cursor-pointer transition ${
                        isSelected
                          ? 'border-orange-500/80 bg-[#141B29] shadow-md shadow-orange-500/10'
                          : 'border-slate-800 bg-[#0B101E] hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                          {idea.aspectRatio === '9:16' ? '📱 9:16 Shorts' : '🎬 16:9 Dài'}
                        </span>
                        <span className="text-[10px] text-slate-500">#{idx + 1}</span>
                      </div>
                      <h4 className="text-xs font-bold text-slate-200 line-clamp-2 leading-snug">
                        {idea.title}
                      </h4>
                      <p className="text-[11px] text-slate-400 line-clamp-2 mt-1">
                        {idea.hookConcept}
                      </p>
                      <div className="mt-2.5 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartWithBlueprint(idea);
                          }}
                          disabled={isRunning}
                          className="rounded-lg bg-orange-600/90 hover:bg-orange-500 px-3 py-1 text-[11px] font-bold text-white transition active:scale-95 disabled:opacity-50 cursor-pointer"
                        >
                          Sản xuất ▸
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* CỘT 2 (CENTER - 5 COLS): KỊCH BẢN & GIỌNG / NHÂN VẬT / VISUAL       */}
        {/* ------------------------------------------------------------------ */}
        <div className="lg:col-span-5 flex flex-col h-full border-r border-slate-800/80 bg-[#080D17] overflow-hidden">
          {session && centerTab === 'script' ? (
            <ScriptWorkspaceView
              session={session}
              blueprint={selectedIdea}
              activeCenterTab={centerTab}
              onSwitchTab={setCenterTab}
              onProceedToVoice={handleApproveStage}
              onRegenerateScript={handleRetryCurrentStage}
              onBackToIdeas={() => {
                setSelectedIdea(null);
              }}
              onDeleteVideo={() => {
                if (session) {
                  if (window.vanhsub?.aiStudio?.cancelPipeline) {
                    window.vanhsub.aiStudio.cancelPipeline({ sessionId: session.sessionId });
                  }
                  setSession(null);
                }
              }}
            />
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Top Sub-Navigation Tabs */}
              <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b border-slate-800/80 bg-[#090E1A] shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCenterTab('script')}
                    className={`rounded-xl px-4 py-1.5 text-xs font-bold transition cursor-pointer ${
                      centerTab === 'script'
                        ? 'bg-[#1C263A] text-white border border-slate-700 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Kịch bản &amp; Giọng
                  </button>
                  <button
                    type="button"
                    onClick={() => setCenterTab('visual')}
                    className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition cursor-pointer ${
                      centerTab === 'visual'
                        ? 'bg-[#1C263A] text-white border border-slate-700 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Phân cảnh Visual
                  </button>
                  <button
                    type="button"
                    onClick={() => setCenterTab('character')}
                    className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition cursor-pointer ${
                      centerTab === 'character'
                        ? 'bg-[#1C263A] text-white border border-slate-700 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Nhân vật
                  </button>
                </div>

                <span className="rounded-full bg-slate-800/80 px-3 py-0.5 text-[11px] font-mono text-slate-400 border border-slate-700">
                  {session ? session.status : 'ready'}
                </span>
              </div>

              {/* Viewport for CenterTab */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
                {centerTab === 'script' && (
                  <div className="space-y-4">
                    {selectedIdea ? (
                      <div className="rounded-2xl border border-orange-500/30 bg-[#121826] p-5 space-y-3 animate-in fade-in duration-200 shadow-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-orange-400 flex items-center gap-1.5">
                            <Lightbulb className="h-3.5 w-3.5" />
                            Ý tưởng đang chọn:
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded">
                            {selectedIdea.aspectRatio}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-white leading-snug">
                          {selectedIdea.title}
                        </h4>
                        <p className="text-xs text-slate-300">
                          <strong className="text-amber-400">Hook 3s:</strong> {selectedIdea.hookConcept}
                        </p>
                        <p className="text-xs text-slate-400">
                          <strong className="text-cyan-400">Góc nhìn:</strong> {selectedIdea.narrativeAngle}
                        </p>
                        <div className="pt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleStartWithBlueprint(selectedIdea)}
                            disabled={isRunning}
                            className="rounded-xl bg-gradient-to-r from-[#FA5252] via-orange-500 to-amber-500 hover:brightness-110 px-5 py-2.5 text-xs font-bold text-white shadow-md transition active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-2"
                          >
                            <Play className="h-3.5 w-3.5 fill-white" />
                            <span>Sản xuất ý tưởng này (Tạo Kịch Bản)</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-xs text-slate-500 py-12 space-y-2">
                        <Lightbulb className="h-8 w-8 mx-auto text-slate-600 stroke-[1.5]" />
                        <p>Chọn một ý tưởng bên trái hoặc bấm &quot;✨ Sinh&quot; để bắt đầu kịch bản.</p>
                      </div>
                    )}
                  </div>
                )}

                {centerTab === 'character' && (
                  <>
                    {/* Toast thông báo host */}
                    {hostToast && (
                      <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 px-3.5 py-2 text-xs text-amber-200 animate-in fade-in duration-200 flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span>{hostToast}</span>
                      </div>
                    )}

                    {/* Box 1: Nhân vật đại diện kênh (Exact UI: media_1789652444948.png) */}
                    <div className="rounded-2xl border border-slate-800/80 bg-[#0B101E] p-4 space-y-3 shadow-md">
                      <div className="flex items-center justify-between">
                        <span className="text-amber-400 font-bold text-xs flex items-center gap-1.5">
                          <span>⭐</span> Nhân vật đại diện kênh
                        </span>
                        <span className="text-[11px] text-slate-500 flex items-center gap-1">
                          <Lock className="h-3 w-3" /> Cố định — không tự sinh lại
                        </span>
                      </div>

                      <p className="text-xs text-slate-400 leading-relaxed">
                        Xuất hiện LỚN ở thumbnail và trong video, giúp kênh dễ nhận diện. Kênh không cần thì bỏ trống.
                      </p>

                      {/* Avatar thumbnail preview if available */}
                      {config.channelProfile?.hostAvatarUrl ? (
                        <div className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-800 bg-[#070B14]">
                          <img
                            src={config.channelProfile.hostAvatarUrl}
                            alt="Host Avatar"
                            className="h-12 w-12 rounded-xl object-cover border border-amber-500/40"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-white truncate">
                              {config.channelProfile.hostName || 'Host đại diện kênh'}
                            </p>
                            <p className="text-[11px] text-slate-400 line-clamp-1">
                              {config.channelProfile.hostDescription || 'Chưa có mô tả ngoại hình'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => updateChannelProfileConfig({ hostAvatarUrl: '' })}
                            className="text-[11px] text-rose-400 hover:underline px-2 cursor-pointer"
                          >
                            Gỡ ảnh
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 italic">
                          Chưa có nhân vật đại diện. Import ảnh của bạn hoặc để AI tạo.
                        </p>
                      )}

                      {/* Inputs: Tên host & Mô tả host để AI tạo */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <div className="sm:col-span-4">
                          <input
                            type="text"
                            placeholder="Tên host"
                            value={config.channelProfile?.hostName || ''}
                            onChange={(e) => updateChannelProfileConfig({ hostName: e.target.value })}
                            className="w-full rounded-lg border border-slate-800 bg-[#070B14] px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                        <div className="sm:col-span-8">
                          <input
                            type="text"
                            placeholder="Mô tả host để AI tạo (vd: một chú sói đội mũ, mặc vest, phong cách điện ảnh)"
                            value={config.channelProfile?.hostDescription || ''}
                            onChange={(e) => updateChannelProfileConfig({ hostDescription: e.target.value })}
                            className="w-full rounded-lg border border-slate-800 bg-[#070B14] px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Action Buttons: Tải ảnh lên & AI tạo host */}
                      <div className="flex items-center gap-2">
                        <input
                          type="file"
                          ref={fileInputRef}
                          accept="image/*"
                          className="hidden"
                          onChange={handleHostAvatarUpload}
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="rounded-lg border border-slate-700/60 bg-[#162032] hover:bg-[#1E2B43] px-4 py-2 text-xs font-semibold text-slate-200 transition cursor-pointer"
                        >
                          Tải ảnh lên
                        </button>
                        <button
                          type="button"
                          onClick={handleAiGenerateHost}
                          className="rounded-lg bg-[#FA5252] hover:bg-[#e04545] px-4 py-2 text-xs font-bold text-white transition shadow cursor-pointer"
                        >
                          AI tạo host
                        </button>
                      </div>
                    </div>

                    {/* Box 2: Đồng bộ Nhân vật ↔ Cảnh (Exact copy: media_1789652444948.png) */}
                    <div className="rounded-2xl border border-amber-950/40 bg-[#151312]/70 p-4 text-xs text-slate-300 leading-relaxed shadow-sm">
                      <span className="font-bold text-amber-300">Đồng bộ Nhân vật ↔ Cảnh:</span>{' '}
                      tạo/khoá ảnh nhân vật một lần ở đây (upload ảnh thật{' '}
                      <span className="font-semibold text-white">hoặc</span> để Flow tự sinh khi sản xuất) —
                      mọi cảnh có nhân vật đó sẽ dùng đúng ảnh này làm <i>ingredient</i> nên khuôn mặt/trang
                      phục nhất quán. AI cũng tự thêm nhân vật mới khi đọc kịch bản.
                    </div>

                    {/* Box 3: + Thêm nhân vật cho kênh (Exact copy: media_1789652444948.png) */}
                    <div className="rounded-2xl border border-slate-800/80 bg-[#0B101E] p-4 space-y-3 shadow-md">
                      <h4 className="text-xs font-bold text-slate-300">+ Thêm nhân vật cho kênh</h4>

                      <div className="flex flex-col sm:flex-row items-center gap-2">
                        <input
                          type="text"
                          placeholder="Tên (vd: Host)"
                          value={newCharName}
                          onChange={(e) => setNewCharName(e.target.value)}
                          className="w-full sm:w-1/3 rounded-lg border border-slate-800 bg-[#070B14] px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
                        />
                        <input
                          type="text"
                          placeholder="Mô tả ngoại hình (tiếng Anh tốt hơn cho sinh ảnh)"
                          value={newCharDesc}
                          onChange={(e) => setNewCharDesc(e.target.value)}
                          className="w-full sm:flex-1 rounded-lg border border-slate-800 bg-[#070B14] px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleAddCharacter}
                          className="w-full sm:w-auto rounded-lg bg-[#FA5252] hover:bg-[#e04545] px-4 py-2 text-xs font-bold text-white shadow transition cursor-pointer"
                        >
                          Thêm
                        </button>
                      </div>

                      {/* Character List / Empty state */}
                      {!config.channelProfile?.channelCharacters ||
                      config.channelProfile.channelCharacters.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-800/80 bg-[#080C14] p-4 text-center text-xs text-slate-500">
                          Chưa có nhân vật. Thêm ở trên (vd người dẫn cố định), hoặc cứ sản xuất — AI sẽ tự rút
                          nhân vật từ kịch bản.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {config.channelProfile.channelCharacters.map((char, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between rounded-xl border border-slate-800 bg-[#070B14] p-2.5 text-xs"
                            >
                              <div>
                                <span className="font-bold text-white">{char.name}</span>
                                {char.descriptionEn && (
                                  <span className="text-slate-400 ml-2 text-[11px]">
                                    ({char.descriptionEn})
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveCharacter(idx)}
                                className="text-slate-500 hover:text-rose-400 p-1 text-xs transition cursor-pointer"
                                title="Xoá nhân vật"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {centerTab === 'visual' && (
                  <div className="space-y-4">
                    {session?.artifacts?.scenes && session.artifacts.scenes.length > 0 ? (
                      <div className="space-y-3">
                        {session.artifacts.scenes.map((scene, sIdx) => (
                          <div key={scene.id || sIdx} className="rounded-xl border border-slate-800 bg-[#0B101E] p-3 space-y-2 text-xs">
                            <div className="flex items-center justify-between font-mono text-slate-400 text-[11px]">
                              <span>Phân cảnh #{sIdx + 1}</span>
                              <span>{Math.round((scene.durationMs || 4000) / 1000)}s</span>
                            </div>
                            <p className="text-white font-medium">{scene.lineText}</p>
                            <p className="text-slate-400 text-[11px] italic bg-slate-900/60 p-2 rounded border border-slate-800/60">
                              {scene.visualPrompt}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center text-xs text-slate-500 py-12 space-y-2">
                        <Film className="h-8 w-8 mx-auto text-slate-600 stroke-[1.5]" />
                        <p>Chưa có phân cảnh visual. Visual sẽ được sinh sau khi duyệt kịch bản và lồng tiếng.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* CỘT 3 (RIGHT - 4 COLS): TIẾN ĐỘ SẢN XUẤT                          */}
        {/* ------------------------------------------------------------------ */}
        <div className="lg:col-span-4 flex flex-col h-full bg-[#070A12] overflow-hidden">
          {/* Header Cột 3 */}
          <div className="p-3.5 border-b border-slate-800/80 flex items-center justify-between shrink-0">
            <h3 className="text-sm font-bold text-white tracking-wide">Tiến độ sản xuất</h3>
            {session && (
              <span className="text-xs font-mono font-bold text-brand-cyan">
                {session.progress}%
              </span>
            )}
          </div>

          {/* Nội dung Tiến độ sản xuất */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
            {!session ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-500 text-xs">
                <p>Duyệt một ý tưởng để bắt đầu sản xuất.</p>
              </div>
            ) : (
              <>
                {/* Gated Stage Approval Banner (Chờ phê duyệt) */}
                {session.status === 'awaiting_approval' && (
                  <div className="rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-slate-900/90 to-slate-950/90 p-4 shadow-xl animate-in fade-in duration-300">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400">
                        <ShieldCheck className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/30">
                          BƯỚC {session.currentStage}/8 HOÀN TẤT
                        </span>
                        <h4 className="text-xs font-bold text-white mt-1">
                          {STAGES.find((s) => s.id === session.currentStage)?.name}: Đang chờ duyệt
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Kiểm tra dữ liệu bên dưới và bấm duyệt để sang bước tiếp theo.
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleRetryCurrentStage}
                        disabled={isApproving}
                        className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Chạy lại</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleApproveStage}
                        disabled={isApproving}
                        className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 px-4 py-1.5 text-xs font-bold text-white shadow-md transition active:scale-95 cursor-pointer disabled:opacity-50"
                      >
                        {isApproving ? (
                          <>
                            <RotateCcw className="h-3 w-3 animate-spin" />
                            <span>Đang duyệt...</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Duyệt &amp; Tiếp</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Real Error Banner with Explicit Retry (No Fake Fallback) */}
                {(errorMessage || session.status === 'failed') && (
                  <div className="rounded-2xl border border-rose-500/40 bg-gradient-to-r from-rose-950/40 via-slate-900/90 to-slate-950/90 p-4 shadow-xl">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-rose-300">
                          Lỗi tại Công đoạn {session.currentStage} (Không chạy giả lập)
                        </h4>
                        <p className="text-xs text-rose-200/90 mt-1">
                          {errorMessage || 'Tiến trình gặp lỗi kết nối hoặc xử lý dữ liệu.'}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={handleRetryCurrentStage}
                        className="flex items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 px-4 py-1.5 text-xs font-bold text-white shadow-md active:scale-95 transition cursor-pointer"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>Thử lại bước này</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Overall Progress Bar */}
                <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full transition-all duration-500"
                    style={{ width: `${session.progress || 0}%` }}
                  />
                </div>

                {/* 8-Stage Progress List */}
                <div className="grid grid-cols-2 gap-2">
                  {STAGES.map((st) => {
                    const Icon = st.icon;
                    const stagesMap = (session?.stages || {}) as Record<number, any>;
                    const stageStatus = stagesMap[st.id]?.status || 'pending';
                    const isCurrent = session?.currentStage === st.id;

                    let statusBadge = (
                      <span className="text-[10px] text-slate-500 font-medium">Chờ</span>
                    );
                    let borderColor = 'border-slate-800 bg-[#0B101E]';

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
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-400 animate-pulse">
                          <RotateCcw className="h-3 w-3 animate-spin" /> Đang chạy
                        </span>
                      );
                      borderColor = 'border-orange-500/50 bg-orange-500/10 ring-1 ring-orange-500/50';
                    } else if (stageStatus === 'error') {
                      statusBadge = (
                        <span className="text-[10px] font-semibold text-rose-400">Lỗi</span>
                      );
                      borderColor = 'border-rose-500/40 bg-rose-500/10';
                    }

                    return (
                      <div
                        key={st.id}
                        className={`flex flex-col justify-between rounded-xl border p-2.5 transition-all ${borderColor}`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-mono text-slate-500">#{st.id}</span>
                          <Icon className="h-3.5 w-3.5 text-slate-400" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white">{st.name}</div>
                          <div className="mt-0.5">{statusBadge}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Script & Voice Preview Box */}
                {session.artifacts?.scriptLines && session.artifacts.scriptLines.length > 0 && (
                  <div className="rounded-2xl border border-slate-800 bg-[#0B101E] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-brand-cyan" />
                        Kịch bản ({session.artifacts.scriptLines.length} câu)
                      </h4>
                      {session.artifacts.audioPath && (
                        <button
                          type="button"
                          onClick={() => handleOpenFolder(session.artifacts?.audioPath)}
                          className="flex items-center gap-1 text-[11px] text-brand-cyan hover:underline cursor-pointer"
                        >
                          <FolderOpen className="h-3 w-3" /> Mở Audio
                        </button>
                      )}
                    </div>

                    {/* Audio Player if available */}
                    {session.artifacts.audioPath && (
                      <div className="rounded-xl border border-slate-800 bg-slate-950 p-2.5 flex items-center gap-2.5">
                        <Volume2 className="h-4 w-4 text-brand-cyan shrink-0" />
                        <audio
                          controls
                          src={`vanhmedia://local/${encodeURIComponent(session.artifacts.audioPath)}`}
                          className="w-full h-7"
                        />
                      </div>
                    )}

                    <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1 text-xs custom-scrollbar">
                      {session.artifacts.scriptLines.map((line, idx) => (
                        <div
                          key={line.id || idx}
                          className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-2 flex items-start gap-2"
                        >
                          <span className="font-mono text-[9px] text-brand-cyan bg-brand-cyan/10 px-1 py-0.5 rounded">
                            #{idx + 1}
                          </span>
                          <div className="flex-1">
                            <p className="text-slate-200 leading-relaxed text-[11px]">{line.text}</p>
                            {line.visualPromptEn && (
                              <p className="text-[10px] font-mono text-slate-500 mt-0.5 line-clamp-1">
                                🎨 {line.visualPromptEn}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Video Preview Box */}
                <div className="rounded-2xl border border-slate-800 bg-[#0B101E] p-4 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Video className="h-3.5 w-3.5 text-brand-cyan" />
                    Video Hoàn Chỉnh
                  </h4>

                  {session.artifacts?.videoPath ? (
                    <div className="space-y-2.5">
                      <div
                        className={`w-full rounded-xl overflow-hidden border border-slate-700 bg-black ${
                          session.artifacts?.blueprint?.aspectRatio === '9:16'
                            ? 'aspect-[9/16] max-h-[380px] mx-auto'
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
                      <button
                        type="button"
                        onClick={() => handleOpenFolder(session.artifacts?.videoPath)}
                        className="w-full btn-vanh-gradient flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold text-white shadow cursor-pointer"
                      >
                        <FolderOpen className="h-3.5 w-3.5" /> Mở File Video
                      </button>
                    </div>
                  ) : (
                    <div className="aspect-video w-full rounded-xl border border-dashed border-slate-800 bg-slate-950/40 flex flex-col items-center justify-center text-slate-500 p-4 text-center">
                      <Film className="h-6 w-6 mb-1 text-slate-600 animate-pulse" />
                      <p className="text-[11px]">
                        Video hoàn chỉnh sẽ hiển thị tại đây sau khi hoàn tất công đoạn Dựng phim.
                      </p>
                    </div>
                  )}
                </div>

                {/* SEO Metadata Box */}
                {session.artifacts?.metadata && (
                  <div className="rounded-2xl border border-slate-800 bg-[#0B101E] p-4 space-y-2.5 text-xs">
                    <h4 className="font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5 text-xs">
                      <Share2 className="h-3.5 w-3.5 text-brand-cyan" />
                      Gói SEO &amp; Viral
                    </h4>
                    <div>
                      <span className="text-slate-400 font-medium">Tiêu đề:</span>
                      <p className="font-bold text-white mt-0.5">{session.artifacts.metadata.title}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 font-medium">Hashtags:</span>
                      <p className="font-mono text-brand-cyan mt-0.5">
                        {session.artifacts.metadata.hashtags.join(' ')}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
