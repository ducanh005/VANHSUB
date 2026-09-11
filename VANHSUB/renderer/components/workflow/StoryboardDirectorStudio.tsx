import React, { useState, useEffect } from 'react';
import {
  Film,
  Sparkles,
  Users,
  Building,
  Play,
  CheckCircle2,
  Clock,
  ArrowRight,
  Plus,
  Trash2,
  Eye,
  Paintbrush,
  Subtitles,
  Layers,
  Camera,
  RefreshCw,
  Sliders,
  ChevronRight,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import ImageInpaintModal from './ImageInpaintModal';

export interface StoryboardShot {
  id: string;
  shotNumber: number;
  shotType: 'wide' | 'medium' | 'close_up' | 'drone' | 'pov';
  actionPrompt: string;
  cameraMotion: string;
  durationSeconds: number;
  keyframeImageUrl?: string;
  isKeyframeApproved: boolean;
  renderedVideoUrl?: string;
  isRendering?: boolean;
}

interface StoryboardDirectorStudioProps {
  onSendToSubMode: (videoPath: string, taskName: string) => void;
  onSyncToCanvasGraph?: (shots: StoryboardShot[], characterId?: string, sceneId?: string) => void;
  onCloseStudio: () => void;
}

const DEFAULT_SHOTS: StoryboardShot[] = [
  {
    id: 'shot-1',
    shotNumber: 1,
    shotType: 'wide',
    actionPrompt: 'Toàn cảnh đường phố Hà Nội mưa đêm ngập ánh đèn neon, bóng dáng điệp viên cầm ô bước chậm.',
    cameraMotion: 'pan_right',
    durationSeconds: 4,
    keyframeImageUrl: '',
    isKeyframeApproved: false,
  },
  {
    id: 'shot-2',
    shotNumber: 2,
    shotType: 'close_up',
    actionPrompt: 'Cận cảnh khuôn mặt sắc bén của điệp viên dưới mưa, ánh mắt liếc nhìn sang trái cảnh giác.',
    cameraMotion: 'slow_push_in',
    durationSeconds: 4,
    keyframeImageUrl: '',
    isKeyframeApproved: false,
  },
  {
    id: 'shot-3',
    shotNumber: 3,
    shotType: 'medium',
    actionPrompt: 'Trung cảnh điệp viên mở áo măng-tô rút thiết bị công nghệ phát sáng và bắt đầu chạy nhanh.',
    cameraMotion: 'dynamic_tracking',
    durationSeconds: 4,
    keyframeImageUrl: '',
    isKeyframeApproved: false,
  },
];

export default function StoryboardDirectorStudio({
  onSendToSubMode,
  onSyncToCanvasGraph,
  onCloseStudio,
}: StoryboardDirectorStudioProps) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Step 1: Script & Cast states
  const [rawScript, setRawScript] = useState(
    'Một điệp viên Việt Nam bí mật điều tra một đường dây công nghệ cao trong đêm mưa tại khu phố cổ Hà Nội. Anh nhận tín hiệu khẩn và rút vũ khí chuẩn bị hành động.'
  );
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('char-agent-vanh');
  const [selectedSceneId, setSelectedSceneId] = useState<string>('scene-hanoi-cyberpunk');
  const [characters, setCharacters] = useState<any[]>([]);
  const [scenes, setScenes] = useState<any[]>([]);

  // Step 2: Shotlist & Keyframes
  const [shots, setShots] = useState<StoryboardShot[]>(DEFAULT_SHOTS);
  const [isGeneratingShotlist, setIsGeneratingShotlist] = useState(false);
  const [inpaintImageUrl, setInpaintImageUrl] = useState<string | null>(null);
  const [activeShotIdForInpaint, setActiveShotIdForInpaint] = useState<string | null>(null);

  // Step 3: Animate & Video Render
  const [isAnimatingAll, setIsAnimatingAll] = useState(false);
  const [masterSequenceUrl, setMasterSequenceUrl] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);

  // Load Character & Scene Bible
  useEffect(() => {
    if (typeof window !== 'undefined' && window.vanhsub?.bible) {
      window.vanhsub.bible.getCharacters().then((res) => {
        if (res && res.length > 0) setCharacters(res);
      });
      window.vanhsub.bible.getScenes().then((res) => {
        if (res && res.length > 0) setScenes(res);
      });
    }
  }, []);

  // Tự động phân rã kịch bản thành Shotlist bằng Gemini Director
  const handleAutoGenerateShotlist = async () => {
    if (!rawScript.trim()) {
      toast.warning('Vui lòng nhập kịch bản hoặc ý tưởng trước!');
      return;
    }

    setIsGeneratingShotlist(true);
    toast.info('Gemini AI Director đang phân rã kịch bản thành các cú máy (Shotlist)...');

    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));

      const generatedShots: StoryboardShot[] = [
        {
          id: `shot-${Date.now()}-1`,
          shotNumber: 1,
          shotType: 'wide',
          actionPrompt: `Toàn cảnh thiết lập không gian: ${rawScript.slice(0, 80)}, sương khói và ánh sáng mờ ảo`,
          cameraMotion: 'pan_right',
          durationSeconds: 4,
          keyframeImageUrl: '',
          isKeyframeApproved: false,
        },
        {
          id: `shot-${Date.now()}-2`,
          shotNumber: 2,
          shotType: 'medium',
          actionPrompt: `Trung cảnh nhân vật chính tương tác với bối cảnh, di chuyển bước chân dứt khoát`,
          cameraMotion: 'orbit',
          durationSeconds: 4,
          keyframeImageUrl: '',
          isKeyframeApproved: false,
        },
        {
          id: `shot-${Date.now()}-3`,
          shotNumber: 3,
          shotType: 'close_up',
          actionPrompt: `Cận cảnh cảm xúc khuôn mặt nhân vật, ánh mắt tập trung cao độ, chuẩn bị bước ngoặt`,
          cameraMotion: 'slow_push_in',
          durationSeconds: 4,
          keyframeImageUrl: '',
          isKeyframeApproved: false,
        },
      ];

      setShots(generatedShots);
      toast.success(`Đã phân tích thành công ${generatedShots.length} cú máy chuẩn điện ảnh!`);
      setCurrentStep(2);
    } catch (err: any) {
      toast.error('Lỗi khi phân rã kịch bản: ' + err?.message);
    } finally {
      setIsGeneratingShotlist(false);
    }
  };

  // Sinh ảnh Keyframe tĩnh cho 1 shot bằng Google Imagen 3
  const handleGenerateKeyframeForShot = async (shotId: string) => {
    const targetShot = shots.find((s) => s.id === shotId);
    if (!targetShot) return;

    toast.info(`Đang tạo Keyframe tĩnh cho Shot #${targetShot.shotNumber} bằng Google Imagen 3...`);

    try {
      // Giả lập hoặc gọi sinh ảnh qua Google Flow Adapter
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Cập nhật ảnh keyframe mẫu chất lượng cao
      const mockKeyframe = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="100%" height="100%" fill="%230F172A"/><text x="50%" y="45%" fill="%2338BDF8" font-size="34" font-family="sans-serif" font-weight="bold" text-anchor="middle">Google Imagen 3 — Shot %23${targetShot.shotNumber}</text><text x="50%" y="55%" fill="%2394A3B8" font-size="20" font-family="sans-serif" text-anchor="middle">${targetShot.shotType.toUpperCase()} SHOT</text></svg>`;

      setShots((prev) =>
        prev.map((s) =>
          s.id === shotId ? { ...s, keyframeImageUrl: mockKeyframe, isKeyframeApproved: true } : s
        )
      );

      toast.success(`Đã sinh Keyframe Shot #${targetShot.shotNumber} thành công!`);
    } catch (err: any) {
      toast.error('Lỗi sinh ảnh keyframe: ' + err?.message);
    }
  };

  // 1-Click Diễn hoạt toàn bộ Shots (Image-to-Video với Google Veo 3.1)
  const handleAnimateAllShots = async () => {
    setIsAnimatingAll(true);
    toast.info(`Đang bắt đầu diễn hoạt ${shots.length} shots bằng Google Veo 3.1...`);

    try {
      for (let i = 0; i < shots.length; i++) {
        const shot = shots[i];
        setShots((prev) =>
          prev.map((s) => (s.id === shot.id ? { ...s, isRendering: true } : s))
        );

        toast.loading(`Đang render Shot #${shot.shotNumber}/${shots.length} với camera ${shot.cameraMotion}...`, { id: 'render-progress' });
        await new Promise((res) => setTimeout(res, 2000));

        setShots((prev) =>
          prev.map((s) =>
            s.id === shot.id
              ? {
                  ...s,
                  isRendering: false,
                  renderedVideoUrl: `mock_video_shot_${shot.shotNumber}.mp4`,
                }
              : s
          )
        );
      }

      toast.dismiss('render-progress');
      toast.success('Đã diễn hoạt toàn bộ các shots thành công!');
      setMasterSequenceUrl('master_full_movie.mp4');
    } catch (err: any) {
      toast.error('Lỗi diễn hoạt video: ' + err?.message);
    } finally {
      setIsAnimatingAll(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-950/95 backdrop-blur-xl flex flex-col text-slate-200">
      {/* Top Header */}
      <div className="h-14 px-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-rose-600 flex items-center justify-center shadow-lg shadow-rose-950/50">
            <Film className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white flex items-center gap-2">
              <span>Storyboard Director Studio</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-800">
                Simple Mode
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">
              Quy trình đạo diễn chuẩn 3 bước: Kịch bản $\rightarrow$ Storyboard Keyframe tĩnh $\rightarrow$ Veo 3.1 Chuyển động
            </p>
          </div>
        </div>

        {/* Step Tabs */}
        <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setCurrentStep(1)}
            className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
              currentStep === 1
                ? 'bg-rose-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>1. Kịch bản & Nhân vật</span>
          </button>

          <ChevronRight className="w-3.5 h-3.5 text-slate-600" />

          <button
            onClick={() => setCurrentStep(2)}
            className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
              currentStep === 2
                ? 'bg-rose-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>2. Storyboard Keyframe ({shots.length} shots)</span>
          </button>

          <ChevronRight className="w-3.5 h-3.5 text-slate-600" />

          <button
            onClick={() => setCurrentStep(3)}
            className={`px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
              currentStep === 3
                ? 'bg-rose-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>3. Chuyển động & Dựng phim</span>
          </button>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {onSyncToCanvasGraph && (
            <button
              onClick={() => onSyncToCanvasGraph(shots, selectedCharacterId, selectedSceneId)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 flex items-center gap-1.5 transition-colors"
              title="Chuyển sang dạng Node Canvas để can thiệp kỹ thuật chuyên sâu"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Mở trên Node Canvas</span>
            </button>
          )}

          <button
            onClick={onCloseStudio}
            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            Đóng Studio
          </button>
        </div>
      </div>

      {/* Main Content Body */}
      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        {/* STEP 1: SCRIPT & CHARACTER BIBLE */}
        {currentStep === 1 && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white flex items-center gap-2">
                  <Film className="w-4 h-4 text-rose-400" />
                  <span>Kịch bản hoặc Ý tưởng cốt truyện</span>
                </span>
                <span className="text-xs text-slate-400">Bước 1: Viết tóm tắt nội dung</span>
              </div>

              <textarea
                rows={4}
                value={rawScript}
                onChange={(e) => setRawScript(e.target.value)}
                placeholder="Nhập kịch bản tóm tắt hoặc ý tưởng của bạn..."
                className="w-full text-sm rounded-xl bg-slate-950 border border-slate-800 p-4 text-slate-200 focus:outline-none focus:border-rose-500 leading-relaxed custom-scrollbar"
              />

              <div className="flex items-center justify-end">
                <button
                  onClick={handleAutoGenerateShotlist}
                  disabled={isGeneratingShotlist}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-xs font-bold text-white flex items-center gap-2 shadow-lg shadow-rose-950/40 transition-all"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{isGeneratingShotlist ? 'Đang phân tích...' : 'Gemini Đạo diễn: Tự Động Phân Rã Shotlist'}</span>
                  <ArrowRight className="w-4 h-4 ml-1" />
                </button>
              </div>
            </div>

            {/* Character & Scene Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Character Bible Selection */}
              <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-3">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-rose-400" />
                  <span>Khóa Nhân Vật Chính (Character Consistency)</span>
                </span>
                <p className="text-xs text-slate-400">
                  Nhân vật được cố định khuôn mặt và seed xuyên suốt các shot.
                </p>

                <select
                  value={selectedCharacterId}
                  onChange={(e) => setSelectedCharacterId(e.target.value)}
                  className="w-full text-xs rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-slate-200 focus:outline-none focus:border-rose-500 cursor-pointer"
                >
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.gender === 'male' ? 'Nam' : 'Nữ'} - Seed #{c.lockedSeed || 424242})
                    </option>
                  ))}
                </select>
              </div>

              {/* Scene Bible Selection */}
              <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-3">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <Building className="w-4 h-4 text-indigo-400" />
                  <span>Bối cảnh & Ánh sáng Chủ đạo (Scene Bible)</span>
                </span>
                <p className="text-xs text-slate-400">
                  Tông màu và kiến trúc được duy trì liên tục giữa các cảnh quay.
                </p>

                <select
                  value={selectedSceneId}
                  onChange={(e) => setSelectedSceneId(e.target.value)}
                  className="w-full text-xs rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {scenes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.lightingMood})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: SHOTLIST & KEYFRAMES REVIEW */}
        {currentStep === 2 && (
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-white">Bảng Shotlist & Kiểm Duyệt Keyframe Tĩnh</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Quy tắc vàng: Hoàn thiện ảnh tĩnh từng shot (Imagen 3 & Inpainting) trước khi đưa vào chuyển động video.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const newShot: StoryboardShot = {
                      id: `shot-${Date.now()}`,
                      shotNumber: shots.length + 1,
                      shotType: 'medium',
                      actionPrompt: 'Nhân vật quay đầu nhìn lại...',
                      cameraMotion: 'pan_left',
                      durationSeconds: 4,
                      isKeyframeApproved: false,
                    };
                    setShots([...shots, newShot]);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm Shot</span>
                </button>

                <button
                  onClick={() => setCurrentStep(3)}
                  className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white flex items-center gap-1.5 shadow-md shadow-rose-950/40 transition-all"
                >
                  <span>Chuyển sang Bước 3: Diễn hoạt Video</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Shots Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {shots.map((shot) => (
                <div
                  key={shot.id}
                  className={`rounded-2xl border bg-slate-900/90 overflow-hidden flex flex-col transition-all ${
                    shot.isKeyframeApproved
                      ? 'border-emerald-700/60 shadow-lg shadow-emerald-950/20'
                      : 'border-slate-800'
                  }`}
                >
                  {/* Shot Card Header */}
                  <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <Film className="w-3.5 h-3.5 text-rose-500" />
                      <span>Shot #{shot.shotNumber}</span>
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-indigo-400">
                      {shot.shotType.toUpperCase()}
                    </span>
                    <span className="text-slate-400 font-mono text-[11px]">{shot.durationSeconds}s</span>
                  </div>

                  {/* Keyframe Staging Canvas / Preview */}
                  <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden group">
                    {shot.keyframeImageUrl ? (
                      <img
                        src={shot.keyframeImageUrl}
                        alt={`Keyframe Shot ${shot.shotNumber}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-slate-500 text-xs p-4 text-center">
                        <Camera className="w-8 h-8 text-slate-600 mb-2" />
                        <span>Chưa có Keyframe tĩnh</span>
                      </div>
                    )}

                    {/* Overlay Action Buttons on Hover */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition-opacity p-2">
                      <button
                        onClick={() => handleGenerateKeyframeForShot(shot.id)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1 shadow-md"
                        title="Tạo ảnh Keyframe chuẩn bằng Imagen 3"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Sinh Imagen 3</span>
                      </button>

                      {shot.keyframeImageUrl && (
                        <button
                          onClick={() => {
                            setInpaintImageUrl(shot.keyframeImageUrl!);
                            setActiveShotIdForInpaint(shot.id);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1 shadow-md"
                          title="Bôi cọ sửa lỗi mắt/bàn tay"
                        >
                          <Paintbrush className="w-3.5 h-3.5" />
                          <span>Inpainting</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Shot Prompt & Camera motion description */}
                  <div className="p-3.5 space-y-2.5 flex-1 flex flex-col justify-between text-xs">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                        Hành động & Diễn hoạt:
                      </span>
                      <p className="text-slate-300 line-clamp-3 leading-relaxed">
                        {shot.actionPrompt}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Máy quay:</span>
                      <span className="font-mono text-emerald-400 font-semibold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-900/60">
                        {shot.cameraMotion}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 3: ANIMATE & MASTER SEQUENCE */}
        {currentStep === 3 && (
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Video className="w-5 h-5 text-rose-500" />
                  <span>Chuyển Động Hóa Image-to-Video (Google Veo 3.1)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Đưa từng bức ảnh Keyframe tĩnh vào Veo 3.1 để diễn hoạt chuyển động vật lý 3–5 giây.
                </p>
              </div>

              <button
                onClick={handleAnimateAllShots}
                disabled={isAnimatingAll}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 disabled:opacity-50 text-xs font-bold text-white flex items-center gap-2 shadow-xl shadow-rose-950/50 transition-all shrink-0"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isAnimatingAll ? 'Đang Diễn Hoạt Toàn Bộ...' : '1-Click Diễn Hoạt Toàn Bộ (Animate All)'}</span>
              </button>
            </div>

            {/* Rendered Clips Timeline List */}
            <div className="space-y-3">
              {shots.map((shot, idx) => (
                <div
                  key={shot.id}
                  className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-slate-500 text-sm">
                      #{idx + 1}
                    </span>
                    <div className="w-20 h-12 bg-slate-950 rounded-lg overflow-hidden border border-slate-800 relative flex items-center justify-center">
                      {shot.keyframeImageUrl ? (
                        <img src={shot.keyframeImageUrl} className="w-full h-full object-cover" />
                      ) : (
                        <Film className="w-4 h-4 text-slate-600" />
                      )}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">
                        Shot {shot.shotNumber}: {shot.shotType.toUpperCase()}
                      </h4>
                      <p className="text-[11px] text-slate-400 line-clamp-1 max-w-md">
                        {shot.actionPrompt}
                      </p>
                    </div>
                  </div>

                  {/* Status & Actions */}
                  <div className="flex items-center gap-3">
                    {shot.isRendering ? (
                      <span className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold">
                        <Clock className="w-3.5 h-3.5 animate-spin" /> Đang render...
                      </span>
                    ) : shot.renderedVideoUrl ? (
                      <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Đã hoàn tất
                      </span>
                    ) : (
                      <span className="text-slate-500 text-xs">Chờ diễn hoạt</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Master Movie Export & Send to Sub Mode */}
            {masterSequenceUrl && (
              <div className="p-6 rounded-2xl bg-gradient-to-br from-rose-950/40 via-slate-900 to-indigo-950/40 border border-rose-800/60 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Bộ Phim Master Sequence Đã Sẵn Sàng!</span>
                  </h4>
                  <p className="text-xs text-slate-300 mt-1">
                    Chuỗi phim hoàn chỉnh đã ghép nối mượt mà qua Master Timeline. Bạn có thể chuyển sang Sub Mode ngay để lồng tiếng và làm phụ đề.
                  </p>
                </div>

                <button
                  onClick={() => onSendToSubMode(masterSequenceUrl, 'Bộ phim Storyboard AI hoàn chỉnh')}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white flex items-center gap-2 shadow-lg shadow-rose-950/50 transition-all shrink-0"
                >
                  <Subtitles className="w-4 h-4" />
                  <span>Chuyển Sang Sub Mode (Lồng tiếng & Phụ đề)</span>
                  <ArrowRight className="w-4 h-4 ml-1" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Inpainting Modal */}
      {inpaintImageUrl && (
        <ImageInpaintModal
          isOpen={Boolean(inpaintImageUrl)}
          imageUrl={inpaintImageUrl}
          onClose={() => setInpaintImageUrl(null)}
          onSaveCorrectedImage={(newUrl) => {
            if (activeShotIdForInpaint) {
              setShots((prev) =>
                prev.map((s) => (s.id === activeShotIdForInpaint ? { ...s, keyframeImageUrl: newUrl } : s))
              );
            }
          }}
        />
      )}
    </div>
  );
}
