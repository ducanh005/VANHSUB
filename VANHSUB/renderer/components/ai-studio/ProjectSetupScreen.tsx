import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Play,
  Settings,
  ArrowRight,
  Tv,
  Smartphone,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Zap,
  Flame,
  Folder,
  Plus,
  Trash2,
  Edit3,
} from 'lucide-react';
import { useAiStudioStore } from '../../lib/store/aiStudioStore';
import {
  DEFAULT_CHANNEL_PROFILE_CONFIG,
  type ChannelEvaluationLlm,
  type ChannelLongDuration,
  type SavedProjectProfile,
  type ChannelProfileConfig,
} from '../../types/aiStudio';

interface ProjectSetupScreenProps {
  onEnterStudio: () => void;
  onOpenDetailedConfig?: () => void;
}

const NICHE_PRESETS = [
  { label: '🦖 Sinh tồn & Tiền sử', niche: 'Sinh tồn & Lịch sử tiền sử', orient: 'Kịch tính, chân thực về đời sống và sinh tồn thời cổ xưa' },
  { label: '🔭 Khoa học & Bí ẩn', niche: 'Khoa học & Bí ẩn tự nhiên', orient: 'Phóng sự khám phá, logic chặt chẽ, kích thích tò mò và thán phục' },
  { label: '💰 Tài chính & Kinh tế', niche: 'Tài chính & Kinh tế vĩ mô', orient: 'Chuyên gia tài chính sắc bén, góc nhìn thực chiến, ngôn từ cuốn hút' },
  { label: '📜 Lịch sử thế giới', niche: 'Lịch sử thế giới & Chiến tranh', orient: 'Hùng tráng, điện ảnh, bóc tách diễn biến từng giai đoạn lịch sử' },
  { label: '🕵️ Vụ án & Trinh thám', niche: 'Hồ sơ vụ án & Trinh thám', orient: 'Hồi hộp, giải mã tâm lý tội phạm, dẫn dắt kịch tính từng manh mối' },
  { label: '🧠 Phát triển bản thân', niche: 'Tâm lý học & Phát triển bản thân', orient: 'Gần gũi, khoa học, truyền động lực và cung cấp giải pháp hành động' },
];

const DURATION_OPTIONS: { id: ChannelLongDuration; label: string }[] = [
  { id: '1_3_min', label: '1 – 3 phút (Ngắn gọn)' },
  { id: '3_5_min', label: '3 – 5 phút (Khuyên dùng)' },
  { id: '5_8_min', label: '5 – 8 phút (Chi tiết)' },
  { id: '8_12_min', label: '8 – 12 phút (Chuyên sâu)' },
  { id: '12_18_min', label: '12 – 18 phút (Tài liệu)' },
  { id: '18_28_min', label: '18 – 28 phút (Phim tư liệu)' },
];

export default function ProjectSetupScreen({
  onEnterStudio,
  onOpenDetailedConfig,
}: ProjectSetupScreenProps) {
  const {
    config,
    updateLlmConfig,
    updateFlowConfig,
    saveProject,
    deleteProject,
    switchProject,
    isSaving,
  } = useAiStudioStore();

  const savedProjects = config.savedProjects || [];
  const activeProj = config.activeProjectId
    ? savedProjects.find((p) => p.id === config.activeProjectId) || null
    : savedProjects[0] || null;

  const [editingProjectId, setEditingProjectId] = useState<string | null>(activeProj?.id || null);
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(savedProjects.length === 0);

  const [projectName, setProjectName] = useState(activeProj?.name || config.channelProfile?.projectName || '');
  const [channelNiche, setChannelNiche] = useState(activeProj?.channelProfile.channelNiche || config.channelProfile?.channelNiche || '');
  const [channelOrientation, setChannelOrientation] = useState(activeProj?.channelProfile.channelOrientation || config.channelProfile?.channelOrientation || '');
  const [selectedProvider, setSelectedProvider] = useState<ChannelEvaluationLlm>(
    (activeProj?.channelProfile.aiProvider && activeProj.channelProfile.aiProvider !== 'default'
      ? activeProj.channelProfile.aiProvider
      : (config.channelProfile?.aiProvider && config.channelProfile.aiProvider !== 'default'
        ? config.channelProfile.aiProvider
        : (config.llm?.provider as ChannelEvaluationLlm))) || 'gemini_web'
  );
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>(
    (activeProj?.flowConfig?.aspectRatio as '16:9' | '9:16') ||
      (config.flowEngine?.aspectRatio as '16:9' | '9:16') ||
      '16:9'
  );
  const [duration, setDuration] = useState<ChannelLongDuration>(
    activeProj?.channelProfile.targetLongDuration || config.channelProfile?.targetLongDuration || '3_5_min'
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  // Chỉ đồng bộ dữ liệu vào form ở lần mount đầu tiên nếu không ở chế độ tạo mới
  const hasInitializedRef = React.useRef<boolean>(false);
  useEffect(() => {
    if (hasInitializedRef.current) return;
    if (savedProjects.length > 0 && !isCreatingNew) {
      const target =
        (config.activeProjectId && savedProjects.find((p) => p.id === config.activeProjectId)) ||
        savedProjects[0];
      if (target) {
        setEditingProjectId(target.id);
        setProjectName(target.name);
        setChannelNiche(target.channelProfile.channelNiche || '');
        setChannelOrientation(target.channelProfile.channelOrientation || '');
        if (target.channelProfile.targetLongDuration) setDuration(target.channelProfile.targetLongDuration);
        if (target.flowConfig?.aspectRatio) setAspectRatio(target.flowConfig.aspectRatio as '16:9' | '9:16');
        if (target.channelProfile.aiProvider && target.channelProfile.aiProvider !== 'default') {
          setSelectedProvider(target.channelProfile.aiProvider);
        }
        hasInitializedRef.current = true;
      }
    }
  }, [config.activeProjectId, savedProjects, isCreatingNew]);

  const handleApplyPreset = (preset: typeof NICHE_PRESETS[0]) => {
    setChannelNiche(preset.niche);
    setChannelOrientation(preset.orient);
    if (!projectName.trim()) {
      setProjectName(preset.niche);
    }
    setValidationError(null);
  };

  const handleLoadProjectIntoForm = (p: SavedProjectProfile) => {
    setIsCreatingNew(false);
    setEditingProjectId(p.id);
    setProjectName(p.name);
    setChannelNiche(p.channelProfile.channelNiche || '');
    setChannelOrientation(p.channelProfile.channelOrientation || '');
    if (p.channelProfile.targetLongDuration) {
      setDuration(p.channelProfile.targetLongDuration);
    }
    if (p.flowConfig?.aspectRatio) {
      setAspectRatio(p.flowConfig.aspectRatio as '16:9' | '9:16');
    }
    if (p.channelProfile.aiProvider && p.channelProfile.aiProvider !== 'default') {
      setSelectedProvider(p.channelProfile.aiProvider);
    }
    setValidationError(null);
  };

  const handleCreateNewProject = () => {
    setIsCreatingNew(true);
    setEditingProjectId(null);
    setProjectName('');
    setChannelNiche('');
    setChannelOrientation('');
    setValidationError(null);
  };

  const handleQuickEnterProject = async (p: SavedProjectProfile) => {
    await switchProject(p.id);
    onEnterStudio();
  };

  const handleDeleteProject = async (id: string, name: string) => {
    if (window.confirm(`Bạn có chắc muốn xóa dự án "${name}"?`)) {
      await deleteProject(id);
      if (editingProjectId === id) {
        handleCreateNewProject();
      }
    }
  };

  const handleSaveAndEnter = async () => {
    const trimmedName = projectName.trim();
    if (!trimmedName) {
      setValidationError('⚠️ Vui lòng nhập Tên Project / Kênh trước khi vào Studio.');
      return;
    }

    setValidationError(null);

    if (isCreatingNew || !editingProjectId) {
      // 1. TẠO DỰ ÁN MỚI 100% (ID MỚI, KHÔNG KẾ THỪA Ý TƯỞNG CŨ)
      const newProjId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newChannelProfile: ChannelProfileConfig = {
        ...DEFAULT_CHANNEL_PROFILE_CONFIG,
        projectName: trimmedName,
        channelNiche: channelNiche.trim(),
        channelOrientation: channelOrientation.trim(),
        aiProvider: selectedProvider,
        targetLongDuration: duration,
      };

      await saveProject({
        id: newProjId,
        name: trimmedName,
        channelProfile: newChannelProfile,
        flowConfig: { aspectRatio },
        ideas: [],
        selectedIdea: null,
        lastSessionId: undefined,
        savedSession: null,
        updatedAt: Date.now(),
      });

      if (selectedProvider) {
        await updateLlmConfig({ provider: selectedProvider as any });
      }
      if (aspectRatio) {
        await updateFlowConfig({ aspectRatio });
      }

      setIsCreatingNew(false);
      setEditingProjectId(newProjId);
      onEnterStudio();
      return;
    }

    // 2. CẬP NHẬT DỰ ÁN CŨ ĐANG CHỌN (BẢO LƯU Ý TƯỞNG & PHIÊN LÀM VIỆC)
    const existing = savedProjects.find((p) => p.id === editingProjectId);
    const updatedChannelProfile: ChannelProfileConfig = {
      ...(existing?.channelProfile || DEFAULT_CHANNEL_PROFILE_CONFIG),
      projectName: trimmedName,
      channelNiche: channelNiche.trim(),
      channelOrientation: channelOrientation.trim(),
      aiProvider: selectedProvider,
      targetLongDuration: duration,
    };

    await saveProject({
      id: editingProjectId,
      name: trimmedName,
      channelProfile: updatedChannelProfile,
      flowConfig: { aspectRatio },
      ideas: existing?.ideas || [],
      selectedIdea: existing?.selectedIdea || null,
      lastSessionId: existing?.lastSessionId,
      savedSession: existing?.savedSession,
      updatedAt: Date.now(),
    });

    if (selectedProvider) {
      await updateLlmConfig({ provider: selectedProvider as any });
    }
    if (aspectRatio) {
      await updateFlowConfig({ aspectRatio });
    }

    onEnterStudio();
  };

  const hasSavedProject = Boolean(config.channelProfile?.projectName?.trim());

  return (
    <div className="h-full w-full overflow-y-auto bg-[#080D1A] custom-scrollbar text-slate-200 p-4 md:p-8 flex flex-col items-center">
      <div className="w-full max-w-4xl space-y-6 animate-in fade-in duration-300">
        
        {/* Header Hero Banner */}
        <div className="rounded-3xl border border-slate-800/80 bg-gradient-to-br from-[#0D1527] via-[#0B1120] to-[#080D1A] p-6 md:p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-brand-cyan/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-1/3 -mb-12 w-64 h-64 bg-brand-indigo/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-cyan/30 bg-brand-cyan/10 px-3 py-1 text-xs font-bold text-brand-cyan">
                <Sparkles className="h-3.5 w-3.5" />
                <span>BƯỚC 1: THIẾT LẬP DỰ ÁN & KÊNH</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                Chào mừng bạn đến với <span className="bg-gradient-to-r from-brand-cyan via-blue-400 to-brand-indigo bg-clip-text text-transparent">AI Video Studio</span>
              </h1>
              <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
                Thiết lập tên Project, định hướng nội dung và mô hình AI để hệ thống đồng bộ kịch bản, 
                giọng đọc, nhân vật và phong cách hình ảnh xuyên suốt.
              </p>
            </div>

            {/* Quick Resume Button if project exists */}
            {hasSavedProject && (
              <div className="shrink-0 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4 flex flex-col gap-2 min-w-[220px]">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Dự án đang mở</span>
                </div>
                <div className="text-sm font-bold text-white truncate max-w-[200px]" title={config.channelProfile?.projectName}>
                  📁 {config.channelProfile?.projectName}
                </div>
                <button
                  type="button"
                  onClick={onEnterStudio}
                  className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2 text-xs font-bold text-white shadow-lg hover:brightness-110 active:scale-95 transition cursor-pointer"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Vào Studio Tiếp Tục</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Validation Alert */}
        {validationError && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-xs text-rose-300 flex items-center gap-2.5 animate-in shake">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <span className="font-semibold">{validationError}</span>
          </div>
        )}

        {/* Section: Danh Sách Dự Án Đã Lưu (Nếu có) */}
        {savedProjects.length > 0 && (
          <div className="rounded-3xl border border-slate-800/90 bg-[#0B1120]/90 p-5 md:p-6 space-y-4 shadow-xl backdrop-blur-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Folder className="h-5 w-5 text-amber-400" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                  Dự Án Đã Lưu ({savedProjects.length})
                </h2>
              </div>
              <button
                type="button"
                onClick={handleCreateNewProject}
                className="inline-flex items-center gap-1.5 rounded-xl border border-brand-cyan/40 bg-brand-cyan/10 px-3 py-1.5 text-xs font-bold text-brand-cyan hover:bg-brand-cyan/20 transition cursor-pointer active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Tạo Dự Án Mới</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {savedProjects.map((p) => {
                const isActive = config.activeProjectId === p.id || config.channelProfile?.projectName === p.name;
                const isCurrentEditing = editingProjectId === p.id;
                return (
                  <div
                    key={p.id}
                    className={`rounded-2xl border p-4 flex flex-col justify-between gap-3 transition ${
                      isCurrentEditing
                        ? 'border-brand-cyan/80 bg-brand-cyan/10 shadow-md shadow-brand-cyan/10 ring-1 ring-brand-cyan/50'
                        : isActive
                        ? 'border-emerald-500/50 bg-emerald-950/20 shadow-md'
                        : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-bold text-sm text-white truncate flex items-center gap-1.5" title={p.name}>
                          <Folder className="h-4 w-4 text-amber-400 shrink-0" />
                          <span className="truncate">{p.name}</span>
                        </div>
                        {isCurrentEditing ? (
                          <span className="shrink-0 rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-extrabold text-cyan-300">
                            Đang sửa
                          </span>
                        ) : isActive ? (
                          <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-extrabold text-emerald-400">
                            Đang chọn
                          </span>
                        ) : null}
                      </div>

                      {p.channelProfile.channelNiche && (
                        <p className="text-xs text-slate-300 font-medium truncate">
                          🏷️ {p.channelProfile.channelNiche}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {p.ideas && p.ideas.length > 0 ? (
                          <span className="rounded bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] text-amber-300 font-medium">
                            💡 {p.ideas.length} ý tưởng
                          </span>
                        ) : (
                          <span className="rounded bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-500">
                            💡 Chưa có ý tưởng
                          </span>
                        )}

                        {p.savedSession?.artifacts?.scriptLines && p.savedSession.artifacts.scriptLines.length > 0 ? (
                          <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] text-emerald-300 font-medium">
                            📜 Kịch bản ({p.savedSession.artifacts.scriptLines.length} câu)
                          </span>
                        ) : null}

                        {p.channelProfile.targetLongDuration && (
                          <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400 font-mono">
                            ⏱ {DURATION_OPTIONS.find(d => d.id === p.channelProfile.targetLongDuration)?.label.split(' ')[0] || p.channelProfile.targetLongDuration}
                          </span>
                        )}
                        {p.channelProfile.aiProvider && (
                          <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400 font-mono">
                            🤖 {p.channelProfile.aiProvider}
                          </span>
                        )}
                        {p.flowConfig?.aspectRatio && (
                          <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400 font-mono">
                            📐 {p.flowConfig.aspectRatio}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/60">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleLoadProjectIntoForm(p)}
                          className="rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:text-white hover:bg-slate-700 transition cursor-pointer"
                          title="Nạp thông tin vào form để chỉnh sửa"
                        >
                          ✏️ Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteProject(p.id, p.name)}
                          className="rounded-lg border border-slate-800 bg-slate-800/40 p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition cursor-pointer"
                          title="Xoá dự án này"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleQuickEnterProject(p)}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-xs font-bold text-white shadow transition cursor-pointer active:scale-95"
                      >
                        <Play className="h-3 w-3 fill-current" />
                        <span>Vào Studio</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Main Setup Card Form */}
        <div className="rounded-3xl border border-slate-800 bg-[#0B1120]/90 p-6 md:p-8 space-y-6 shadow-xl backdrop-blur-sm">
          
          {/* Header indicator when editing a project */}
          {editingProjectId && !isCreatingNew ? (
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                <Edit3 className="h-4 w-4" />
                <span>Đang chỉnh sửa thông tin dự án: "{projectName || 'Dự án'}"</span>
              </div>
              <button
                type="button"
                onClick={handleCreateNewProject}
                className="text-xs font-semibold text-brand-cyan hover:underline cursor-pointer flex items-center gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Chuyển sang tạo dự án mới</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                <Plus className="h-4 w-4 text-emerald-400" />
                <span>✨ Thiết lập dự án mới</span>
              </div>
              {savedProjects.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const target = activeProj || savedProjects[0];
                    if (target) handleLoadProjectIntoForm(target);
                  }}
                  className="text-xs font-semibold text-slate-400 hover:text-white cursor-pointer flex items-center gap-1"
                >
                  <span>Huỷ tạo mới, sửa dự án đã có</span>
                </button>
              )}
            </div>
          )}

          {/* Section 1: Tên Project / Kênh */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
              Tên Project / Tên Kênh <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={projectName}
                onChange={(e) => {
                  setProjectName(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder="VD: Kênh Lịch Sử Chiến Tranh, Bí Ẩn Vũ Trụ, Tài Chính Thông Minh..."
                className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan focus:outline-none transition"
              />
            </div>
            <p className="text-[11px] text-slate-500">
              Tên project này sẽ xuất hiện trong Master Prompt, gắn liền với các kịch bản và bản dựng video.
            </p>
          </div>

          {/* Section 2: Chủ đề (Niche) & Định hướng */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                Chủ đề Kênh (Niche) & Phong cách Kể Chuyện
              </label>
              <span className="text-[11px] text-slate-400">Chọn mẫu nhanh bên dưới hoặc tự nhập</span>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap gap-2">
              {NICHE_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleApplyPreset(preset)}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300 hover:border-brand-cyan/60 hover:text-white hover:bg-slate-800/80 transition cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <span className="text-xs text-slate-400">Chủ đề chính (Niche):</span>
                <input
                  type="text"
                  value={channelNiche}
                  onChange={(e) => setChannelNiche(e.target.value)}
                  placeholder="VD: Sinh tồn tiền sử, Khảo cổ học..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:border-brand-cyan focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-slate-400">Định hướng nội dung (Tone):</span>
                <input
                  type="text"
                  value={channelOrientation}
                  onChange={(e) => setChannelOrientation(e.target.value)}
                  placeholder="VD: Kịch tính, điều tra điện ảnh, nhịp điệu dồn dập..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:border-brand-cyan focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Section 3: AI Provider Selection */}
          <div className="space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
              Mô Hình AI Biên Kịch (LLM Provider)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              
              {/* Gemini Web */}
              <div
                onClick={() => setSelectedProvider('gemini_web')}
                className={`rounded-2xl border p-4 cursor-pointer transition flex flex-col justify-between ${
                  selectedProvider === 'gemini_web'
                    ? 'border-brand-cyan bg-brand-cyan/10 shadow-md shadow-brand-cyan/10'
                    : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-cyan-400" />
                      Gemini Web
                    </span>
                    <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300">
                      MIỄN PHÍ
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Tự động hóa trình duyệt Gemini. Không tốn chi phí API token.
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between text-[10px] text-cyan-400 font-medium">
                  <span>Zero-API Cost</span>
                  {selectedProvider === 'gemini_web' && <CheckCircle2 className="h-3.5 w-3.5" />}
                </div>
              </div>

              {/* ChatGPT Web */}
              <div
                onClick={() => setSelectedProvider('chatgpt_web')}
                className={`rounded-2xl border p-4 cursor-pointer transition flex flex-col justify-between ${
                  selectedProvider === 'chatgpt_web'
                    ? 'border-emerald-500 bg-emerald-500/10 shadow-md shadow-emerald-500/10'
                    : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Zap className="h-4 w-4 text-emerald-400" />
                      ChatGPT Web
                    </span>
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                      MIỄN PHÍ
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Chế độ tiết kiệm Revo Studio. Sinh qua tài khoản ChatGPT cá nhân.
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between text-[10px] text-emerald-400 font-medium">
                  <span>Zero-API Cost</span>
                  {selectedProvider === 'chatgpt_web' && <CheckCircle2 className="h-3.5 w-3.5" />}
                </div>
              </div>

              {/* DeepSeek */}
              <div
                onClick={() => setSelectedProvider('deepseek')}
                className={`rounded-2xl border p-4 cursor-pointer transition flex flex-col justify-between ${
                  selectedProvider === 'deepseek'
                    ? 'border-indigo-500 bg-indigo-500/10 shadow-md shadow-indigo-500/10'
                    : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Cpu className="h-4 w-4 text-indigo-400" />
                      DeepSeek
                    </span>
                    <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-bold text-indigo-300">
                      API
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Văn phong sắc bén, suy luận logic sâu, tốc độ cao với chi phí tối ưu.
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between text-[10px] text-indigo-400 font-medium">
                  <span>deepseek-chat</span>
                  {selectedProvider === 'deepseek' && <CheckCircle2 className="h-3.5 w-3.5" />}
                </div>
              </div>

              {/* OpenAI GPT-4o */}
              <div
                onClick={() => setSelectedProvider('openai')}
                className={`rounded-2xl border p-4 cursor-pointer transition flex flex-col justify-between ${
                  selectedProvider === 'openai'
                    ? 'border-purple-500 bg-purple-500/10 shadow-md shadow-purple-500/10'
                    : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Flame className="h-4 w-4 text-purple-400" />
                      OpenAI GPT-4o
                    </span>
                    <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[9px] font-bold text-purple-300">
                      API
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Khả năng tạo câu chuyện sáng tạo, giàu cảm xúc và văn phong mượt mà.
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between text-[10px] text-purple-400 font-medium">
                  <span>gpt-4o</span>
                  {selectedProvider === 'openai' && <CheckCircle2 className="h-3.5 w-3.5" />}
                </div>
              </div>

            </div>
          </div>

          {/* Section 4: Format & Duration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            {/* Tỉ lệ khung hình */}
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                Định Dạng Video Ưu Tiên
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setAspectRatio('16:9')}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-bold transition cursor-pointer ${
                    aspectRatio === '16:9'
                      ? 'border-brand-cyan bg-brand-cyan/15 text-white shadow'
                      : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:text-white'
                  }`}
                >
                  <Tv className="h-4 w-4 text-brand-cyan" />
                  <span>16:9 Video Dài</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAspectRatio('9:16')}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-bold transition cursor-pointer ${
                    aspectRatio === '9:16'
                      ? 'border-brand-cyan bg-brand-cyan/15 text-white shadow'
                      : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:text-white'
                  }`}
                >
                  <Smartphone className="h-4 w-4 text-brand-cyan" />
                  <span>9:16 Shorts / Reels</span>
                </button>
              </div>
            </div>

            {/* Thời lượng mục tiêu */}
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                Thời Lượng Mục Tiêu Mỗi Tập
              </label>
              <div className="relative">
                <select
                  value={duration}
                  onChange={(e) => setDuration(e.target.value as ChannelLongDuration)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 py-3 text-xs text-white focus:border-brand-cyan focus:outline-none cursor-pointer"
                >
                  {DURATION_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4">
            {onOpenDetailedConfig ? (
              <button
                type="button"
                onClick={onOpenDetailedConfig}
                className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:text-white hover:border-slate-700 transition cursor-pointer"
              >
                <Settings className="h-4 w-4 text-slate-400" />
                <span>⚙ Cấu hình nâng cao & Master Prompt</span>
              </button>
            ) : <div />}

            <button
              type="button"
              onClick={handleSaveAndEnter}
              disabled={isSaving}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#FA5252] via-orange-500 to-amber-500 hover:brightness-110 px-6 py-3 text-sm font-bold text-white shadow-xl shadow-orange-500/20 active:scale-95 transition disabled:opacity-50 cursor-pointer"
            >
              <span>{isCreatingNew ? 'Tạo Dự Án & Vào Studio' : 'Lưu Thay Đổi & Vào Studio'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

        </div>

      </div>
    </div>
  );
}
