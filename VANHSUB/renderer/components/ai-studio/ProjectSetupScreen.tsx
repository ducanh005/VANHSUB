import React, { useState, useEffect, useRef } from 'react';
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
  FolderOpen,
  Link2,
  Upload,
  User,
  Palette,
  X,
  Image as ImageIcon,
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

const STYLE_PRESETS = [
  {
    id: 'cinematic',
    name: 'Điện ảnh Chân thực',
    badge: 'Phổ biến',
    desc: 'Cinematic 35mm, ánh sáng kịch tính, chân thực chuẩn phim điện ảnh',
    sampleBg: 'Modern cinematic studio environment, atmospheric warm backlight, depth of field',
  },
  {
    id: 'anime_ghibli',
    name: 'Anime Ghibli',
    badge: 'Nghệ thuật',
    desc: 'Họa phong vẽ tay Miyazaki mộng mơ, màu sắc tươi sáng êm dịu',
    sampleBg: 'Idyllic countryside hillside with lush rolling green grass, vibrant wild flowers, blue sky with watercolor clouds',
  },
  {
    id: 'dark_fantasy',
    name: 'Dark Fantasy',
    badge: 'Huyền bí',
    desc: 'Kỳ ảo u tối, kiến trúc cổ gothic, sương mù ma mị huyền bí',
    sampleBg: 'Ancient ruined gothic cathedral cloaked in misty moonlight, weathered stone pillars, eerie floating embers',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk Sci-Fi',
    badge: 'Khoa học',
    desc: 'Thành phố tương lai rực rỡ đèn neon, công nghệ viễn tưởng',
    sampleBg: 'Rain-slicked futuristic Neo-Tokyo street at midnight, glowing neon signs in violet and cyan',
  },
  {
    id: 'history_doc',
    name: 'Tài liệu Lịch sử',
    badge: 'Chân thực',
    desc: 'Phong cách phóng sự National Geographic, bối cảnh lịch sử chuẩn xác',
    sampleBg: 'Authentic historical ancient workshop with rustic wooden workbenches, parchment scrolls, soft sunlight',
  },
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
    updateConfig,
    updateChannelProfileConfig,
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

  // Form Fields - Step 1: Project name
  const [projectName, setProjectName] = useState(activeProj?.name || config.channelProfile?.projectName || '');
  
  // Form Fields - Step 2: Output Folder
  const [outputDir, setOutputDir] = useState(activeProj?.outputDir || config.outputDir || '');

  // Form Fields - Step 3: Channel profile & AI config & Google Flow URL
  const [channelNiche, setChannelNiche] = useState(activeProj?.channelProfile.channelNiche || config.channelProfile?.channelNiche || '');
  const [channelOrientation, setChannelOrientation] = useState(activeProj?.channelProfile.channelOrientation || config.channelProfile?.channelOrientation || '');
  const [flowProjectUrl, setFlowProjectUrl] = useState(activeProj?.flowProjectUrl || config.flowProjectUrl || '');
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

  // Form Fields - Step 4: Character avatar & background style
  const [hostAvatarUrl, setHostAvatarUrl] = useState<string>(
    activeProj?.channelProfile.hostAvatarUrl || config.channelProfile?.hostAvatarUrl || ''
  );
  const [hostDescription, setHostDescription] = useState<string>(
    activeProj?.channelProfile.hostDescription || config.channelProfile?.hostDescription || ''
  );
  const [selectedStyleId, setSelectedStyleId] = useState<string>(
    activeProj?.channelProfile.videoStyleId ||
      activeProj?.channelProfile.visualArtStylePreset ||
      config.channelProfile?.videoStyleId ||
      config.channelProfile?.visualArtStylePreset ||
      'cinematic'
  );
  const [projectBackgroundPrompt, setProjectBackgroundPrompt] = useState<string>(
    activeProj?.channelProfile.projectBackgroundPrompt ||
      config.channelProfile?.projectBackgroundPrompt ||
      STYLE_PRESETS[0].sampleBg
  );
  const [bgPromptToast, setBgPromptToast] = useState<string | null>(null);

  const [validationError, setValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Đồng bộ form khi chọn sửa project hoặc chuyển đổi
  const hasInitializedRef = React.useRef<boolean>(false);
  useEffect(() => {
    if (hasInitializedRef.current) return;
    if (savedProjects.length > 0 && !isCreatingNew) {
      const target =
        (config.activeProjectId && savedProjects.find((p) => p.id === config.activeProjectId)) ||
        savedProjects[0];
      if (target) {
        handleLoadProjectIntoForm(target);
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
    setOutputDir(p.outputDir || '');
    setChannelNiche(p.channelProfile.channelNiche || '');
    setChannelOrientation(p.channelProfile.channelOrientation || '');
    setFlowProjectUrl(p.flowProjectUrl || '');
    setHostAvatarUrl(p.channelProfile.hostAvatarUrl || '');
    setHostDescription(p.channelProfile.hostDescription || '');
    const loadedStyleId = p.channelProfile.videoStyleId || p.channelProfile.visualArtStylePreset || 'cinematic';
    setSelectedStyleId(loadedStyleId);
    const styleObj = STYLE_PRESETS.find((s) => s.id === loadedStyleId) || STYLE_PRESETS[0];
    setProjectBackgroundPrompt(p.channelProfile.projectBackgroundPrompt || styleObj.sampleBg);
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
    setOutputDir('');
    setChannelNiche('');
    setChannelOrientation('');
    setFlowProjectUrl('');
    setHostAvatarUrl('');
    setHostDescription('');
    setSelectedStyleId('cinematic');
    setProjectBackgroundPrompt(STYLE_PRESETS[0].sampleBg);
    setValidationError(null);
  };

  const handleSelectStylePreset = (st: (typeof STYLE_PRESETS)[0]) => {
    setSelectedStyleId(st.id);
    const isDefaultOrEmpty =
      !projectBackgroundPrompt.trim() ||
      STYLE_PRESETS.some((p) => p.sampleBg.trim().toLowerCase() === projectBackgroundPrompt.trim().toLowerCase());
    if (isDefaultOrEmpty) {
      setProjectBackgroundPrompt(st.sampleBg);
    }
  };

  const handleAiSuggestBackground = () => {
    const pName = projectName.trim();
    const niche = channelNiche.trim();
    const orient = channelOrientation.trim();
    const styleObj = STYLE_PRESETS.find((s) => s.id === selectedStyleId) || STYLE_PRESETS[0];

    const combined = `${pName} ${niche} ${orient}`.toLowerCase();
    let specificScene = '';

    if (combined.includes('sinh tồn') || combined.includes('tiền sử') || combined.includes('khủng long') || combined.includes('rừng') || combined.includes('survival')) {
      specificScene = 'Primeval prehistoric wilderness, towering ancient giant ferns, misty humid jungle canopy, mossy stone monoliths, atmospheric volumetric god rays, hyper-detailed 8k';
    } else if (combined.includes('khoa học') || combined.includes('bí ẩn') || combined.includes('vũ trụ') || combined.includes('thiên văn') || combined.includes('space')) {
      specificScene = 'Cutting-edge astrophysics observatory or futuristic orbital space station, panoramic glass cupola overlooking glowing nebula and distant galaxies, deep volumetric blue lighting';
    } else if (combined.includes('đại dương') || combined.includes('biển') || combined.includes('ocean') || combined.includes('thủy quái')) {
      specificScene = 'Abyssal deep sea research station or bioluminescent underwater oceanic trench, shimmering crystal dark waters, ethereal light beams piercing the aquatic gloom, 8k resolution';
    } else if (combined.includes('tài chính') || combined.includes('kinh tế') || combined.includes('tiền') || combined.includes('chứng khoán') || combined.includes('finance')) {
      specificScene = 'Ultra-modern high-end executive boardroom overlooking sprawling illuminated city skyline, polished dark marble and glass, sophisticated ambient lighting, cinematic depth of field';
    } else if (combined.includes('công nghệ') || combined.includes('ai') || combined.includes('cyber') || combined.includes('robot') || combined.includes('viễn tưởng')) {
      specificScene = 'Advanced cybernetic laboratory with holographic translucent interfaces, gleaming dark chrome surfaces, neon violet and cyan accent lighting, cinematic photorealistic';
    } else if (combined.includes('lịch sử') || combined.includes('chiến tranh') || combined.includes('cổ trang') || combined.includes('vương triều') || combined.includes('history')) {
      specificScene = 'Authentic ancient imperial stone courtyard and grand palace hall, weathered traditional wooden architecture, ceremonial bronze braziers with flickering flame, misty mountain backdrop';
    } else if (combined.includes('vụ án') || combined.includes('trinh thám') || combined.includes('tội phạm') || combined.includes('crime') || combined.includes('bí ẩn')) {
      specificScene = 'Atmospheric moody detective investigation office at night, venetian blinds casting sharp dramatic shadows, vintage evidence boards, amber desk lamp glow, cinematic noir aesthetics';
    } else if (combined.includes('tâm lý') || combined.includes('phát triển bản thân') || combined.includes('triết lý')) {
      specificScene = 'Serene minimalist zen architectural interior, large geometric window with tranquil morning natural sunlight, warm wooden textures, elegant soft shadows, inspiring ambiance';
    } else {
      specificScene = styleObj.sampleBg;
    }

    let finalPrompt = specificScene;
    if (selectedStyleId === 'anime_ghibli' && !finalPrompt.toLowerCase().includes('ghibli')) {
      finalPrompt = `Ghibli anime art style aesthetic, ${finalPrompt}`;
    } else if (selectedStyleId === 'dark_fantasy' && !finalPrompt.toLowerCase().includes('gothic')) {
      finalPrompt = `Dark fantasy gothic aesthetic, ${finalPrompt}`;
    } else if (selectedStyleId === 'cyberpunk' && !finalPrompt.toLowerCase().includes('neon')) {
      finalPrompt = `Cyberpunk sci-fi aesthetic, ${finalPrompt}`;
    }

    setProjectBackgroundPrompt(finalPrompt);
    setBgPromptToast('✨ Đã tự động sinh Prompt bối cảnh chuẩn điện ảnh theo Đề tài & Phong cách!');
    setTimeout(() => setBgPromptToast(null), 3500);
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

  // Chọn Output Folder qua native OS dialog
  const handleChooseOutputDir = async () => {
    try {
      if (window.vanhsub?.dialog?.chooseDirectory) {
        const selected = await window.vanhsub.dialog.chooseDirectory();
        if (selected) {
          setOutputDir(selected);
          setValidationError(null);
        }
      }
    } catch (err) {
      console.error('[ProjectSetupScreen] Error choosing directory:', err);
    }
  };

  // Chọn ảnh avatar nhân vật đại diện qua native OS dialog
  const handleSelectAvatarFile = async () => {
    try {
      if (window.vanhsub?.dialog?.openImageFile) {
        const filePath = await window.vanhsub.dialog.openImageFile();
        if (filePath) {
          if (window.vanhsub?.files?.readImageAsDataUrl) {
            const dataUrl = await window.vanhsub.files.readImageAsDataUrl(filePath);
            setHostAvatarUrl(dataUrl || filePath);
          } else {
            setHostAvatarUrl(filePath);
          }
          setValidationError(null);
          return;
        }
      }
    } catch (err) {
      console.warn('[ProjectSetupScreen] Native openImageFile fallback to file input:', err);
    }
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setHostAvatarUrl(reader.result);
        setValidationError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  // Lưu và chuyển sang studio
  const handleSaveAndEnter = async () => {
    const trimmedName = projectName.trim();
    if (!trimmedName) {
      setValidationError('⚠️ Bước 1: Vui lòng nhập Tên Đề tài / Tên Kênh.');
      return;
    }

    const trimmedOutputDir = outputDir.trim();
    if (!trimmedOutputDir) {
      setValidationError('⚠️ Bước 2: Vui lòng chọn Thư mục xuất ra đĩa (Output Folder) để lưu trữ tài nguyên video.');
      return;
    }

    const trimmedNiche = channelNiche.trim();
    if (!trimmedNiche) {
      setValidationError('⚠️ Bước 3: Vui lòng chọn hoặc nhập Chủ đề Kênh (Niche) để AI có cơ sở định hướng kịch bản.');
      return;
    }

    setValidationError(null);

    if (isCreatingNew || !editingProjectId) {
      // 1. TẠO DỰ ÁN MỚI 100%
      const newProjId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newChannelProfile: ChannelProfileConfig = {
        ...DEFAULT_CHANNEL_PROFILE_CONFIG,
        projectName: trimmedName,
        channelNiche: trimmedNiche,
        channelOrientation: channelOrientation.trim(),
        aiProvider: selectedProvider,
        targetLongDuration: duration,
        hostAvatarUrl: hostAvatarUrl.trim(),
        hostDescription: hostDescription.trim(),
        videoStyleId: selectedStyleId,
        projectBackgroundPrompt: projectBackgroundPrompt.trim(),
        visualArtStylePreset: selectedStyleId,
      };

      await saveProject({
        id: newProjId,
        name: trimmedName,
        channelProfile: newChannelProfile,
        flowConfig: { aspectRatio },
        outputDir: trimmedOutputDir,
        flowProjectUrl: flowProjectUrl.trim(),
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
      await updateChannelProfileConfig({
        projectBackgroundPrompt: projectBackgroundPrompt.trim(),
        visualArtStylePreset: selectedStyleId,
        videoStyleId: selectedStyleId,
      });
      await updateConfig({
        outputDir: trimmedOutputDir,
        flowProjectUrl: flowProjectUrl.trim(),
      });

      setIsCreatingNew(false);
      setEditingProjectId(newProjId);
      onEnterStudio();
      return;
    }

    // 2. CẬP NHẬT DỰ ÁN CŨ ĐANG CHỌN
    const existing = savedProjects.find((p) => p.id === editingProjectId);
    const updatedChannelProfile: ChannelProfileConfig = {
      ...(existing?.channelProfile || DEFAULT_CHANNEL_PROFILE_CONFIG),
      projectName: trimmedName,
      channelNiche: trimmedNiche,
      channelOrientation: channelOrientation.trim(),
      aiProvider: selectedProvider,
      targetLongDuration: duration,
      hostAvatarUrl: hostAvatarUrl.trim(),
      hostDescription: hostDescription.trim(),
      videoStyleId: selectedStyleId,
      projectBackgroundPrompt: projectBackgroundPrompt.trim(),
      visualArtStylePreset: selectedStyleId,
    };

    await saveProject({
      id: editingProjectId,
      name: trimmedName,
      channelProfile: updatedChannelProfile,
      flowConfig: { aspectRatio },
      outputDir: trimmedOutputDir,
      flowProjectUrl: flowProjectUrl.trim(),
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
    await updateChannelProfileConfig({
      projectBackgroundPrompt: projectBackgroundPrompt.trim(),
      visualArtStylePreset: selectedStyleId,
      videoStyleId: selectedStyleId,
    });
    await updateConfig({
      outputDir: trimmedOutputDir,
      flowProjectUrl: flowProjectUrl.trim(),
    });

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
                <span>QUY TRÌNH THIẾT LẬP DỰ ÁN 5 BƯỚC</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                Chào mừng bạn đến với <span className="bg-gradient-to-r from-brand-cyan via-blue-400 to-brand-indigo bg-clip-text text-transparent">AI Video Studio</span>
              </h1>
              <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
                Hoàn thành 5 bước chuẩn hóa để hệ thống đồng bộ toàn bộ pipeline: Tên đề tài → Output Folder → 
                Cấu hình kênh & AI → Nhân vật đại diện & Bối cảnh → Lưu để mở khóa sinh ý tưởng.
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
          <div className="rounded-2xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-xs text-rose-300 flex items-center gap-2.5 animate-in shake shadow-lg">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <span className="font-semibold">{validationError}</span>
          </div>
        )}

        {/* Section: Danh Sách Dự Án Đã Lưu */}
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

                      {p.outputDir && (
                        <p className="text-[11px] text-slate-400 truncate flex items-center gap-1" title={p.outputDir}>
                          <FolderOpen className="h-3 w-3 text-slate-500 shrink-0" />
                          <span className="truncate">{p.outputDir}</span>
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

                        {p.channelProfile.hostAvatarUrl ? (
                          <span className="rounded bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-[10px] text-purple-300 font-medium">
                            👤 Có Avatar MC
                          </span>
                        ) : null}

                        {p.flowProjectUrl ? (
                          <span className="rounded bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-[10px] text-blue-300 font-medium truncate max-w-[120px]" title={p.flowProjectUrl}>
                            🔗 Flow Linked
                          </span>
                        ) : null}

                        {p.channelProfile.targetLongDuration && (
                          <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400 font-mono">
                            ⏱ {DURATION_OPTIONS.find(d => d.id === p.channelProfile.targetLongDuration)?.label.split(' ')[0] || p.channelProfile.targetLongDuration}
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

        {/* Main Setup Card Form - 5 STEPS SEQUENTIAL WORKFLOW */}
        <div className="rounded-3xl border border-slate-800 bg-[#0B1120]/90 p-6 md:p-8 space-y-8 shadow-xl backdrop-blur-sm">
          
          {/* Header indicator when editing a project */}
          {editingProjectId && !isCreatingNew ? (
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                <Edit3 className="h-4 w-4" />
                <span>Đang chỉnh sửa dự án: "{projectName || 'Dự án'}"</span>
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
                <span>✨ Tạo mới & cấu hình dự án video</span>
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

          {/* BƯỚC 1: TÊN ĐỀ TÀI / TÊN KÊNH */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold border border-cyan-500/40">
                1
              </span>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Tên Đề Tài / Tên Kênh <span className="text-rose-400">*</span>
              </label>
            </div>
            <div className="relative">
              <input
                type="text"
                value={projectName}
                onChange={(e) => {
                  setProjectName(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                placeholder="VD: Kênh Lịch Sử Chiến Tranh, Bí Ẩn Vũ Trụ, Khám Phá Sinh Tồn..."
                className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan focus:outline-none transition"
              />
            </div>
            <p className="text-[11px] text-slate-500 pl-8">
              Tên đề tài sẽ là linh hồn định danh cho kịch bản, thư mục dự án và các video sản xuất sau này.
            </p>
          </div>

          {/* BƯỚC 2: OUTPUT FOLDER (THƯ MỤC XUẤT RA ĐĨA) */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold border border-amber-500/40">
                2
              </span>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Thư Mục Xuất Ra Đĩa (Output Folder) <span className="text-rose-400">*</span>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={outputDir}
                  onChange={(e) => {
                    setOutputDir(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  placeholder="VD: D:\VideoProjects\Chien_Tranh_The_Gioi_1 hoặc C:\ContentCreation..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan focus:outline-none transition font-mono"
                />
              </div>
              <button
                type="button"
                onClick={handleChooseOutputDir}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-4 py-3 text-xs font-bold text-slate-200 hover:text-white transition cursor-pointer shadow-md shrink-0 active:scale-95"
              >
                <FolderOpen className="h-4 w-4 text-amber-400" />
                <span>Chọn Thư Mục...</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500 pl-8">
              Nơi lưu trữ toàn bộ dữ liệu vật lý của dự án: Kịch bản (01_script), giọng đọc (02_voice), ảnh/video tạo ra (05_media), và ảnh tham chiếu (style_refs).
            </p>
          </div>

          {/* BƯỚC 3: CẤU HÌNH KÊNH & AI BIÊN KỊCH & LINK GOOGLE FLOW */}
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold border border-indigo-500/40">
                  3
                </span>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Cấu Hình Kênh, Mô Hình AI & Dự Án Google Flow <span className="text-rose-400">*</span>
                </label>
              </div>
              <span className="text-[11px] text-slate-400 hidden sm:inline">Chọn mẫu nhanh bên dưới hoặc tự nhập</span>
            </div>

            {/* Quick Presets for Niche */}
            <div className="flex flex-wrap gap-2 pl-8">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-8">
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
                <span className="text-xs text-slate-400">Định hướng nội dung (Tone & Mood):</span>
                <input
                  type="text"
                  value={channelOrientation}
                  onChange={(e) => setChannelOrientation(e.target.value)}
                  placeholder="VD: Kịch tính, điều tra điện ảnh, nhịp điệu dồn dập..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:border-brand-cyan focus:outline-none"
                />
              </div>
            </div>

            {/* Google Flow Project URL Input */}
            <div className="space-y-1.5 pl-8">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300 font-semibold flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5 text-blue-400" />
                  Mã / Link Dự Án Google Flow (Tùy chọn):
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        if ((window as any).vanhsub?.veo?.showLobbyDebug) {
                          await (window as any).vanhsub.veo.showLobbyDebug();
                        } else if ((window as any).vanhsub?.veo?.openLobby) {
                          await (window as any).vanhsub.veo.openLobby();
                        }
                      } catch (e) {
                        console.error('Lỗi mở sảnh Flow:', e);
                      }
                    }}
                    className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 transition cursor-pointer bg-emerald-950/40 border border-emerald-500/30 px-2.5 py-1 rounded-lg"
                    title="Mở sảnh Google Flow để đăng nhập, kiểm tra credit hoặc lấy URL dự án"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>🌐 Mở Sảnh Google Flow</span>
                  </button>
                  <span className="text-[10px] text-slate-500">Mở đúng project Canvas</span>
                </div>
              </div>
              <input
                type="text"
                value={flowProjectUrl}
                onChange={(e) => setFlowProjectUrl(e.target.value)}
                placeholder="VD: https://flow.google.com/project/d61a20dc-635e-4770-b568-1155c8c9b5a2 hoặc UUID..."
                className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:border-blue-400 focus:outline-none font-mono"
              />
            </div>

            {/* AI Provider Cards */}
            <div className="space-y-2.5 pl-8">
              <span className="text-xs text-slate-400">Mô Hình AI Biên Kịch (LLM Provider):</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Gemini Web */}
                <div
                  onClick={() => setSelectedProvider('gemini_web')}
                  className={`rounded-2xl border p-3.5 cursor-pointer transition flex flex-col justify-between ${
                    selectedProvider === 'gemini_web'
                      ? 'border-brand-cyan bg-brand-cyan/10 shadow-md shadow-brand-cyan/10'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                        Gemini Web
                      </span>
                      <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300">
                        FREE
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-snug">
                      Tự động hóa trình duyệt Gemini. Không tốn chi phí API.
                    </p>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-cyan-400 font-medium">
                    <span>Zero-API</span>
                    {selectedProvider === 'gemini_web' && <CheckCircle2 className="h-3.5 w-3.5" />}
                  </div>
                </div>

                {/* ChatGPT Web */}
                <div
                  onClick={() => setSelectedProvider('chatgpt_web')}
                  className={`rounded-2xl border p-3.5 cursor-pointer transition flex flex-col justify-between ${
                    selectedProvider === 'chatgpt_web'
                      ? 'border-emerald-500 bg-emerald-500/10 shadow-md shadow-emerald-500/10'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Zap className="h-3.5 w-3.5 text-emerald-400" />
                        ChatGPT Web
                      </span>
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                        FREE
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-snug">
                      Tự động hóa tài khoản ChatGPT cá nhân.
                    </p>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-emerald-400 font-medium">
                    <span>Zero-API</span>
                    {selectedProvider === 'chatgpt_web' && <CheckCircle2 className="h-3.5 w-3.5" />}
                  </div>
                </div>

                {/* DeepSeek */}
                <div
                  onClick={() => setSelectedProvider('deepseek')}
                  className={`rounded-2xl border p-3.5 cursor-pointer transition flex flex-col justify-between ${
                    selectedProvider === 'deepseek'
                      ? 'border-indigo-500 bg-indigo-500/10 shadow-md shadow-indigo-500/10'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Cpu className="h-3.5 w-3.5 text-indigo-400" />
                        DeepSeek
                      </span>
                      <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-bold text-indigo-300">
                        API
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-snug">
                      Văn phong sắc bén, suy luận logic sâu với chi phí tối ưu.
                    </p>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-indigo-400 font-medium">
                    <span>deepseek-chat</span>
                    {selectedProvider === 'deepseek' && <CheckCircle2 className="h-3.5 w-3.5" />}
                  </div>
                </div>

                {/* OpenAI GPT-4o */}
                <div
                  onClick={() => setSelectedProvider('openai')}
                  className={`rounded-2xl border p-3.5 cursor-pointer transition flex flex-col justify-between ${
                    selectedProvider === 'openai'
                      ? 'border-purple-500 bg-purple-500/10 shadow-md shadow-purple-500/10'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Flame className="h-3.5 w-3.5 text-purple-400" />
                        OpenAI GPT-4o
                      </span>
                      <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[9px] font-bold text-purple-300">
                        API
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-snug">
                      Sáng tạo câu chuyện mượt mà, cảm xúc điện ảnh.
                    </p>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-purple-400 font-medium">
                    <span>gpt-4o</span>
                    {selectedProvider === 'openai' && <CheckCircle2 className="h-3.5 w-3.5" />}
                  </div>
                </div>
              </div>
            </div>

            {/* Format & Duration */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-8">
              <div className="space-y-1.5">
                <span className="text-xs text-slate-400">Định dạng Video:</span>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setAspectRatio('16:9')}
                    className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-xs font-bold transition cursor-pointer ${
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
                    className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-xs font-bold transition cursor-pointer ${
                      aspectRatio === '9:16'
                        ? 'border-brand-cyan bg-brand-cyan/15 text-white shadow'
                        : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Smartphone className="h-4 w-4 text-brand-cyan" />
                    <span>9:16 Shorts</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-slate-400">Thời lượng mục tiêu:</span>
                <select
                  value={duration}
                  onChange={(e) => setDuration(e.target.value as ChannelLongDuration)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 py-2.5 text-xs text-white focus:border-brand-cyan focus:outline-none cursor-pointer"
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

          {/* BƯỚC 4: THIẾT LẬP NHÂN VẬT ĐẠI DIỆN & STYLE BỐI CẢNH */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-500/20 text-purple-400 text-xs font-bold border border-purple-500/40">
                4
              </span>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Thiết Lập Nhân Vật Đại Diện & Phong Cách Bối Cảnh
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pl-8">
              {/* Cột trái: Nhân vật đại diện (Host Avatar) */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <User className="h-4 w-4 text-purple-400" />
                    Ảnh Đại Diện MC / Nhân Vật (Host Avatar)
                  </span>
                  {hostAvatarUrl ? (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                      Đã đính kèm
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                      Tùy chọn
                    </span>
                  )}
                </div>

                {/* Khu vực xem trước & upload avatar */}
                <div className="flex items-center gap-4">
                  {hostAvatarUrl ? (
                    <div className="relative group shrink-0">
                      <img
                        src={hostAvatarUrl}
                        alt="Host Avatar"
                        className="h-16 w-16 rounded-2xl object-cover border-2 border-purple-500/50 shadow-md"
                      />
                      <button
                        type="button"
                        onClick={() => setHostAvatarUrl('')}
                        className="absolute -top-1.5 -right-1.5 rounded-full bg-rose-600 text-white p-0.5 hover:bg-rose-500 transition shadow"
                        title="Xóa ảnh này"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="h-16 w-16 rounded-2xl border-2 border-dashed border-slate-700 flex flex-col items-center justify-center text-slate-500 shrink-0 bg-slate-900/60">
                      <ImageIcon className="h-6 w-6 stroke-[1.5]" />
                    </div>
                  )}

                  <div className="space-y-1.5 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={handleSelectAvatarFile}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-950/30 hover:bg-purple-900/40 px-3 py-1.5 text-xs font-bold text-purple-300 transition cursor-pointer shadow active:scale-95"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>{hostAvatarUrl ? 'Đổi Ảnh Khác...' : 'Tải Ảnh Nhân Vật...'}</span>
                    </button>
                    <p className="text-[10px] text-slate-500 leading-snug">
                      Đính kèm ảnh mẫu nhân vật cố định để Google Flow tái hiện đồng nhất xuyên suốt video.
                    </p>
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileInputChange}
                  className="hidden"
                />

                {/* Mô tả nhân vật */}
                <div className="space-y-1 pt-1">
                  <span className="text-[11px] text-slate-400">Mô tả đặc điểm nhân vật (nếu muốn AI bổ trợ):</span>
                  <input
                    type="text"
                    value={hostDescription}
                    onChange={(e) => setHostDescription(e.target.value)}
                    placeholder="VD: Nam 30 tuổi, áo khoác dã chiến màu rêu, tóc ngắn, mắt sắc bén..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-purple-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Cột phải: Phong cách bối cảnh (Style Preset & Tự Prompt Bối Cảnh) */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Palette className="h-4 w-4 text-brand-cyan" />
                      Phong Cách Bối Cảnh (Visual Style)
                    </span>
                    <span className="text-[10px] text-slate-400">Chọn 1 mẫu</span>
                  </div>

                  {/* Danh sách preset phong cách */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto custom-scrollbar pr-1">
                    {STYLE_PRESETS.map((st) => {
                      const isSelected = selectedStyleId === st.id;
                      return (
                        <div
                          key={st.id}
                          onClick={() => handleSelectStylePreset(st)}
                          className={`rounded-xl border p-2 cursor-pointer transition flex items-start justify-between gap-1.5 ${
                            isSelected
                              ? 'border-brand-cyan bg-brand-cyan/15 shadow-sm'
                              : 'border-slate-800/80 bg-slate-900/60 hover:border-slate-700'
                          }`}
                        >
                          <div className="space-y-0.5 min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-bold text-white truncate">{st.name}</span>
                              <span className="text-[8px] rounded bg-slate-800 px-1 py-0.2 text-slate-400 shrink-0">
                                {st.badge}
                              </span>
                            </div>
                            <p className="text-[9px] text-slate-400 leading-snug line-clamp-1">
                              {st.desc}
                            </p>
                          </div>
                          {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-brand-cyan shrink-0 mt-0.5" />}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Khu vực Tự Prompt Bối Cảnh Visual & AI Gợi Ý */}
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-brand-cyan flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5" />
                      Mô Tả Bối Cảnh Thị Giác (Visual Prompt)
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleAiSuggestBackground}
                        className="inline-flex items-center gap-1 rounded-lg border border-brand-cyan/40 bg-brand-cyan/10 hover:bg-brand-cyan/20 px-2 py-1 text-[10px] font-bold text-brand-cyan transition cursor-pointer active:scale-95 shadow-sm"
                        title="Tự động phân tích Đề tài, Ngách kênh và Phong cách để sinh prompt bối cảnh chuẩn điện ảnh"
                      >
                        <Sparkles className="h-3 w-3" />
                        <span>AI Tự Sinh Prompt</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const st = STYLE_PRESETS.find((s) => s.id === selectedStyleId) || STYLE_PRESETS[0];
                          setProjectBackgroundPrompt(st.sampleBg);
                          setBgPromptToast(`🎨 Đã khôi phục prompt mẫu của phong cách ${st.name}`);
                          setTimeout(() => setBgPromptToast(null), 2500);
                        }}
                        className="text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded transition cursor-pointer"
                        title="Điền lại prompt mẫu của phong cách đang chọn"
                      >
                        Mẫu gốc
                      </button>
                    </div>
                  </div>

                  {/* Toast thông báo */}
                  {bgPromptToast && (
                    <div className="text-[10px] text-brand-cyan bg-brand-cyan/10 border border-brand-cyan/30 rounded-lg px-2.5 py-1 animate-in fade-in">
                      {bgPromptToast}
                    </div>
                  )}

                  <textarea
                    rows={3}
                    value={projectBackgroundPrompt}
                    onChange={(e) => setProjectBackgroundPrompt(e.target.value)}
                    placeholder="Nhập mô tả bối cảnh không gian, ánh sáng, kiến trúc để AI cố định cho mọi khung hình (vd: Modern cinematic studio environment, atmospheric warm backlight...)"
                    className="w-full rounded-xl border border-slate-700 bg-slate-900/90 p-2.5 text-xs text-white placeholder:text-slate-500 focus:border-brand-cyan focus:outline-none leading-relaxed resize-y custom-scrollbar"
                  />

                  <p className="text-[10px] text-slate-500 leading-snug">
                    💡 <strong className="text-slate-400">Đồng bộ Storyboard & Flow:</strong> Bối cảnh này sẽ được áp dụng cố định xuyên suốt tất cả các phân cảnh để giữ tính nhất quán thị giác.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* BƯỚC 5: LƯU CẤU HÌNH & VÀO STUDIO (ACTION BUTTONS) */}
          <div className="pt-6 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4">
            {onOpenDetailedConfig ? (
              <button
                type="button"
                onClick={onOpenDetailedConfig}
                className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:text-white hover:border-slate-700 transition cursor-pointer"
              >
                <Settings className="h-4 w-4 text-slate-400" />
                <span>⚙ Cấu hình chuyên sâu & Master Prompt</span>
              </button>
            ) : <div />}

            <button
              type="button"
              onClick={handleSaveAndEnter}
              disabled={isSaving}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#FA5252] via-orange-500 to-amber-500 hover:brightness-110 px-8 py-3.5 text-sm font-extrabold text-white shadow-xl shadow-orange-500/20 active:scale-95 transition disabled:opacity-50 cursor-pointer"
            >
              <span>{isCreatingNew ? 'Hoàn Tất Lưu & Vào Studio' : 'Lưu Thay Đổi & Vào Studio'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

        </div>

      </div>
    </div>
  );
}
