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
  Copy,
  Image as ImageIcon,
  User,
  XCircle,
  AlertTriangle,
  Square,
  PauseCircle,
  Palette,
  Eye,
  EyeOff,
  ExternalLink,
  HardDrive,
  Maximize2,
  X,
  ChevronDown,
  Check,
  Folder,
} from 'lucide-react';
import { useAiStudioStore } from '../../lib/store/aiStudioStore';
import type {
  PipelineSessionState,
  PipelineProgressEvent,
  IdeaBlueprint,
  StoryboardScene,
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
    sampleBg: 'Idyllic countryside hillside with lush rolling green grass, vibrant wild flowers, blue sky with fluffy watercolor clouds',
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
    sampleBg: 'Rain-slicked futuristic Neo-Tokyo street at midnight, glowing neon signs in violet and cyan, towering holographic billboards',
  },
  {
    id: 'history_doc',
    name: 'Tài liệu Lịch sử',
    badge: 'Chân thực',
    desc: 'Phong cách phóng sự National Geographic, trang phục bối cảnh lịch sử chuẩn xác',
    sampleBg: 'Authentic historical ancient workshop with rustic wooden workbenches, parchment scrolls, dust motes in soft light',
  },
  {
    id: '3d_pixar',
    name: '3D Pixar CGI',
    badge: '3D Vui nhộn',
    desc: 'Hoạt hình 3D phong cách Disney/Pixar, tươi sáng, biểu cảm sống động',
    sampleBg: 'Cozy whimsical studio room with colorful wooden furniture, warm ambient lighting, cute stylized props',
  },
];

const toMediaUrl = (filePath?: string | null): string => {
  if (!filePath) return '';
  if (
    filePath.startsWith('http://') ||
    filePath.startsWith('https://') ||
    filePath.startsWith('data:') ||
    filePath.startsWith('blob:') ||
    filePath.startsWith('vanhmedia://')
  ) {
    return filePath;
  }
  let cleanPath = filePath;
  if (cleanPath.startsWith('file:///')) {
    cleanPath = cleanPath.replace(/^file:\/\/\//, '');
  } else if (cleanPath.startsWith('file://')) {
    cleanPath = cleanPath.replace(/^file:\/\//, '');
  }
  // Chuẩn hóa dấu gạch chéo Windows thành URL format
  cleanPath = cleanPath.replace(/\\/g, '/');
  return `vanhmedia://local/${encodeURIComponent(cleanPath)}`;
};

interface AutoPilotViewProps {
  onSwitchProject?: () => void;
}

export default function AutoPilotView({ onSwitchProject }: AutoPilotViewProps = {}) {
  const {
    config,
    updateChannelProfileConfig,
    updateFlowConfig,
    getActiveProject,
    saveActiveProjectData,
    switchProject,
    isProjectSetupComplete,
  } = useAiStudioStore();
  const [topic, setTopic] = useState('');
  const [session, setSession] = useState<PipelineSessionState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGatedMode, setIsGatedMode] = useState(true); // Chu trình từng bước có phê duyệt
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [isConfirmCancelOpen, setIsConfirmCancelOpen] = useState(false);
  const [conflictWarningModal, setConflictWarningModal] = useState<{
    pendingBlueprint: IdeaBlueprint;
  } | null>(null);
  const [setupWarningToast, setSetupWarningToast] = useState<string | null>(null);

  const activeProj = getActiveProject();
  const setupCheck = isProjectSetupComplete(activeProj);

  const handleOpenIdeaModal = () => {
    if (!setupCheck.isComplete) {
      const msg = `⚠️ Dự án chưa hoàn tất thiết lập cơ bản: Thiếu ${setupCheck.missing.join(', ')}. Vui lòng cập nhật thiết lập dự án trước khi sinh ý tưởng!`;
      setSetupWarningToast(msg);
      setTimeout(() => setSetupWarningToast(null), 6000);
      return;
    }
    setSetupWarningToast(null);
    setIsModalOpen(true);
  };

  // 3-Column Studio States (Matching Revo Studio UI)
  const [activeTab, setActiveTab] = useState<'video' | 'facebook'>('video');
  const [selectedFormat, setSelectedFormat] = useState<'16:9' | '9:16'>('16:9');
  const [ideas, setIdeas] = useState<IdeaBlueprint[]>([]);
  const [selectedIdea, setSelectedIdea] = useState<IdeaBlueprint | null>(null);
  const [centerTab, setCenterTab] = useState<'script' | 'visual' | 'character'>('script');

  // Preview Media Modal State (Phóng to / Xem trước ảnh & video chi tiết)
  const [previewMedia, setPreviewMedia] = useState<{
    type: 'image' | 'video';
    url: string;
    shotId?: string;
    narration?: string;
    prompt?: string;
    durationMs?: number;
  } | null>(null);

  // Quick Project Switcher Dropdown in Studio Header
  const [isHeaderDropdownOpen, setIsHeaderDropdownOpen] = useState(false);
  const headerDropdownRef = useRef<HTMLDivElement | null>(null);

  // Host & Character States
  const [newCharName, setNewCharName] = useState('');
  const [newCharDesc, setNewCharDesc] = useState('');
  const [hostToast, setHostToast] = useState<string | null>(null);
  const [copiedIdeaThumbPrompt, setCopiedIdeaThumbPrompt] = useState(false);
  const [isFlowWindowOpen, setIsFlowWindowOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadedProjectIdRef = useRef<string | null>(null);

  // Đóng Header Dropdown khi click ra ngoài
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (headerDropdownRef.current && !headerDropdownRef.current.contains(e.target as Node)) {
        setIsHeaderDropdownOpen(false);
      }
    };
    if (isHeaderDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isHeaderDropdownOpen]);

  // Phím tắt ESC để đóng Lightbox Preview
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewMedia) {
        setPreviewMedia(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [previewMedia]);

  // Kiểm tra trạng thái hiển thị cửa sổ Google Flow live
  useEffect(() => {
    if (typeof window !== 'undefined' && window.vanhsub?.veo?.isLobbyDebug) {
      window.vanhsub.veo
        .isLobbyDebug()
        .then((open) => setIsFlowWindowOpen(!!open))
        .catch(() => {});
    }
  }, []);

  const handleToggleFlowLive = async () => {
    try {
      if (isFlowWindowOpen) {
        if (window.vanhsub?.veo?.hideLobbyOffscreen) {
          await window.vanhsub.veo.hideLobbyOffscreen();
          setIsFlowWindowOpen(false);
        }
      } else {
        if (window.vanhsub?.veo?.openLobby) {
          await window.vanhsub.veo.openLobby();
          setIsFlowWindowOpen(true);
        } else if (window.vanhsub?.veo?.showLobbyDebug) {
          await window.vanhsub.veo.showLobbyDebug();
          setIsFlowWindowOpen(true);
        }
      }
    } catch (err: any) {
      console.error('Lỗi khi bật/tắt cửa sổ Flow live:', err);
    }
  };

  const handleSelectCustomMediaDir = async () => {
    try {
      if (window.vanhsub?.dialog?.chooseDirectory) {
        const chosen = await window.vanhsub.dialog.chooseDirectory();
        if (chosen) {
          updateChannelProfileConfig({ customMediaDir: chosen });
        }
      }
    } catch (err) {
      console.error('Lỗi khi chọn thư mục lưu media:', err);
    }
  };

  const [regeneratingSceneId, setRegeneratingSceneId] = useState<string | null>(null);
  const [importingSceneId, setImportingSceneId] = useState<string | null>(null);
  const [sceneActionNotice, setSceneActionNotice] = useState<string | null>(null);
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);

  const toggleSelectShot = (shotId: string) => {
    setSelectedShotIds((prev) =>
      prev.includes(shotId) ? prev.filter((id) => id !== shotId) : [...prev, shotId]
    );
  };

  const handleSelectAllShots = (allIds: string[]) => {
    if (selectedShotIds.length === allIds.length) {
      setSelectedShotIds([]);
    } else {
      setSelectedShotIds(allIds);
    }
  };

  const showSceneNotice = (msg: string) => {
    setSceneActionNotice(msg);
    setTimeout(() => setSceneActionNotice(null), 4000);
  };

  const handleRegenerateScene = async (
    scene: StoryboardScene,
    mode: 'image' | 'video' | 'both'
  ) => {
    if (!session?.sessionId || regeneratingSceneId) return;
    const targetId = scene.shotId || scene.id;
    setRegeneratingSceneId(targetId);
    showSceneNotice(`Đang tạo lại ${mode === 'image' ? 'Ảnh AI' : mode === 'video' ? 'Video AI' : 'Media'} cho phân cảnh ${targetId} qua Flow...`);

    try {
      if (window.vanhsub?.aiStudio?.regenerateSceneAsset) {
        const result = await window.vanhsub.aiStudio.regenerateSceneAsset({
          sessionId: session.sessionId,
          sceneId: targetId,
          visualPrompt: scene.visualPrompt,
          mode,
          flowConfig: {
            outputMode: mode === 'video' ? 'video' : 'image',
            aspectRatio: session.artifacts?.blueprint?.aspectRatio || '16:9',
          },
        });

        if (result && (result.assetPath || result.imagePath || result.videoPath)) {
          let sessionToSave: PipelineSessionState | null = null;
          setSession((prev) => {
            if (!prev || !prev.artifacts?.scenes) return prev;
            const updatedScenes = prev.artifacts.scenes.map((s) => {
              if (s.id === scene.id || s.shotId === targetId) {
                return {
                  ...s,
                  imagePath: result.imagePath || s.imagePath,
                  videoPath: result.videoPath || s.videoPath,
                  assetPath: result.assetPath || s.assetPath,
                  status: 'ready' as const,
                };
              }
              return s;
            });
            const updatedSession = {
              ...prev,
              artifacts: {
                ...prev.artifacts,
                scenes: updatedScenes,
              },
            };
            sessionToSave = updatedSession;
            return updatedSession;
          });
          if (sessionToSave) {
            const toSave: PipelineSessionState = sessionToSave;
            queueMicrotask(() => {
              void saveActiveProjectData(
                {
                  savedSession: toSave,
                  lastSessionId: toSave.sessionId,
                },
                loadedProjectIdRef.current || undefined
              );
            });
          }
          showSceneNotice(`✓ Đã tạo lại thành công media cho ${targetId}!`);
        } else if (result?.error) {
          showSceneNotice(`✗ Lỗi tạo lại: ${result.error}`);
        }
      }
    } catch (err: any) {
      console.error('Lỗi khi tạo lại media phân cảnh:', err);
      showSceneNotice(`✗ Lỗi: ${err?.message || err}`);
    } finally {
      setRegeneratingSceneId(null);
    }
  };

  const handleImportManualMedia = async (
    scene: StoryboardScene,
    mediaType: 'image' | 'video'
  ) => {
    if (!session?.sessionId || importingSceneId) return;
    const targetId = scene.shotId || scene.id;
    setImportingSceneId(targetId);

    try {
      let chosenFilePath: string | null = null;
      if (mediaType === 'image' && window.vanhsub?.dialog?.openImageFile) {
        chosenFilePath = await window.vanhsub.dialog.openImageFile();
      } else if (mediaType === 'video' && window.vanhsub?.dialog?.openVideoFile) {
        chosenFilePath = await window.vanhsub.dialog.openVideoFile();
      }

      if (!chosenFilePath) {
        setImportingSceneId(null);
        return;
      }

      showSceneNotice(`Đang nạp tệp ${mediaType === 'image' ? 'ảnh' : 'video'} vào dự án...`);

      if (window.vanhsub?.aiStudio?.importSceneMedia) {
        const importRes = await window.vanhsub.aiStudio.importSceneMedia({
          sessionId: session.sessionId,
          sceneId: targetId,
          filePath: chosenFilePath,
          mediaType,
        });

        if (importRes && importRes.success) {
          let sessionToSave: PipelineSessionState | null = null;
          setSession((prev) => {
            if (!prev || !prev.artifacts?.scenes) return prev;
            const updatedScenes = prev.artifacts.scenes.map((s) => {
              if (s.id === scene.id || s.shotId === targetId) {
                return {
                  ...s,
                  imagePath: importRes.imagePath || s.imagePath,
                  videoPath: importRes.videoPath || s.videoPath,
                  assetPath: importRes.assetPath || s.assetPath,
                  status: 'ready' as const,
                };
              }
              return s;
            });
            const updatedSession = {
              ...prev,
              artifacts: {
                ...prev.artifacts,
                scenes: updatedScenes,
              },
            };
            sessionToSave = updatedSession;
            return updatedSession;
          });
          if (sessionToSave) {
            const toSave: PipelineSessionState = sessionToSave;
            queueMicrotask(() => {
              void saveActiveProjectData(
                {
                  savedSession: toSave,
                  lastSessionId: toSave.sessionId,
                },
                loadedProjectIdRef.current || undefined
              );
            });
          }
          showSceneNotice(`✓ Đã nạp thành công tệp vào ${targetId}!`);
        } else {
          showSceneNotice(`✗ Lỗi nạp tệp: ${importRes?.error || 'Không rõ nguyên nhân'}`);
        }
      } else {
        // Fallback trực tiếp nếu IPC chưa khởi động
        let sessionToSave: PipelineSessionState | null = null;
        setSession((prev) => {
          if (!prev || !prev.artifacts?.scenes) return prev;
          const updatedScenes = prev.artifacts.scenes.map((s) => {
            if (s.id === scene.id || s.shotId === targetId) {
              return {
                ...s,
                imagePath: mediaType === 'image' ? chosenFilePath! : s.imagePath,
                videoPath: mediaType === 'video' ? chosenFilePath! : s.videoPath,
                assetPath: chosenFilePath!,
                status: 'ready' as const,
              };
            }
            return s;
          });
          const updatedSession = {
            ...prev,
            artifacts: {
              ...prev.artifacts,
              scenes: updatedScenes,
            },
          };
          sessionToSave = updatedSession;
          return updatedSession;
        });
        if (sessionToSave) {
          const toSave: PipelineSessionState = sessionToSave;
          queueMicrotask(() => {
            void saveActiveProjectData(
              {
                savedSession: toSave,
                lastSessionId: toSave.sessionId,
              },
              loadedProjectIdRef.current || undefined
            );
          });
        }
        showSceneNotice(`✓ Đã nạp đường dẫn tệp vào ${targetId}!`);
      }
    } catch (err: any) {
      console.error('Lỗi khi nạp tệp media thủ công:', err);
      showSceneNotice(`✗ Lỗi: ${err?.message || err}`);
    } finally {
      setImportingSceneId(null);
    }
  };

  const handleCopyIdeaThumbPrompt = (promptText: string) => {
    if (!promptText) return;
    navigator.clipboard.writeText(promptText);
    setCopiedIdeaThumbPrompt(true);
    setTimeout(() => setCopiedIdeaThumbPrompt(false), 2500);
  };

  // Nạp ý tưởng & kịch bản đã lưu của project khi mount hoặc khi chuyển project
  useEffect(() => {
    const activeProject = getActiveProject();
    if (!activeProject) return;

    if (loadedProjectIdRef.current !== activeProject.id) {
      loadedProjectIdRef.current = activeProject.id;

      // 0. Clean reset old session & states immediately to avoid stale render or cross-project pollution
      setSession(null);
      setIsRunning(false);
      setErrorMessage(null);
      setRegeneratingSceneId(null);
      setImportingSceneId(null);
      setSceneActionNotice(null);
      setConflictWarningModal(null);

      // 1. Phục hồi danh sách ý tưởng
      const projIdeas = activeProject.ideas || [];
      setIdeas(projIdeas);

      // 2. Phục hồi ý tưởng đang chọn
      const chosenIdea = activeProject.selectedIdea || projIdeas[0] || null;
      setSelectedIdea(chosenIdea);

      // 3. Phục hồi định dạng khung hình
      if (activeProject.flowConfig?.aspectRatio) {
        setSelectedFormat(activeProject.flowConfig.aspectRatio as '16:9' | '9:16');
      }

      // 4. Phục hồi trạng thái session (kịch bản, âm thanh, v.v.)
      const currentProjId = activeProject.id;
      if (activeProject.lastSessionId && window.vanhsub?.aiStudio?.getPipelineState) {
        window.vanhsub.aiStudio
          .getPipelineState({ sessionId: activeProject.lastSessionId })
          .then((persistedState) => {
            if (loadedProjectIdRef.current !== currentProjId) return;
            if (persistedState) {
              setSession(persistedState);
              if (persistedState.artifacts?.blueprint) {
                setSelectedIdea(persistedState.artifacts.blueprint);
              }
              if (persistedState.artifacts?.scriptLines && persistedState.artifacts.scriptLines.length > 0) {
                setCenterTab('script');
              }
            } else if (activeProject.savedSession) {
              setSession(activeProject.savedSession);
              if (activeProject.savedSession.artifacts?.scriptLines && activeProject.savedSession.artifacts.scriptLines.length > 0) {
                setCenterTab('script');
              }
            }
          })
          .catch(() => {
            if (loadedProjectIdRef.current !== currentProjId) return;
            if (activeProject.savedSession) {
              setSession(activeProject.savedSession);
              if (activeProject.savedSession.artifacts?.scriptLines && activeProject.savedSession.artifacts.scriptLines.length > 0) {
                setCenterTab('script');
              }
            }
          });
      } else if (activeProject.savedSession) {
        setSession(activeProject.savedSession);
        if (activeProject.savedSession.artifacts?.scriptLines && activeProject.savedSession.artifacts.scriptLines.length > 0) {
          setCenterTab('script');
        }
      } else {
        setSession(null);
      }
    }
  }, [config.activeProjectId, config.savedProjects, getActiveProject]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.aiStudio) return;

    const unsubscribe = window.vanhsub.aiStudio.onPipelineProgress((event: PipelineProgressEvent) => {
      let sessionToSave: PipelineSessionState | null = null;
      setSession((prev) => {
        if (!prev) return prev;
        // Chặn event từ các session khác để tránh ghi đè chéo khi chuyển project
        if (event.sessionId && prev.sessionId && event.sessionId !== prev.sessionId) {
          return prev;
        }

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

        // Tự động lưu tiến độ kịch bản vào project để không bị mất khi thoát ra vào lại
        if (
          event.status === 'awaiting_approval' ||
          event.status === 'success' ||
          event.status === 'error' ||
          event.stage >= 2
        ) {
          sessionToSave = next;
        }

        return next;
      });

      if (sessionToSave) {
        const toSave: PipelineSessionState = sessionToSave;
        queueMicrotask(() => {
          void saveActiveProjectData(
            {
              savedSession: toSave,
              lastSessionId: toSave.sessionId,
            },
            loadedProjectIdRef.current || undefined
          );
        });
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [saveActiveProjectData]);

  const isIdeaInActiveSession = (idea: IdeaBlueprint | null | undefined): boolean => {
    if (!session || !idea) return false;
    const sessionTopic = (session.topic || '').trim().toLowerCase();
    const ideaTitle = (idea.title || '').trim().toLowerCase();
    const ideaTopic = (idea.topic || '').trim().toLowerCase();
    const bpTitle = (session.artifacts?.blueprint?.title || '').trim().toLowerCase();
    const bpTopic = (session.artifacts?.blueprint?.topic || '').trim().toLowerCase();

    return (
      (ideaTitle !== '' && (ideaTitle === sessionTopic || ideaTitle === bpTitle)) ||
      (ideaTopic !== '' && (ideaTopic === sessionTopic || ideaTopic === bpTopic))
    );
  };

  const handleResumeSession = (idea?: IdeaBlueprint | null) => {
    const targetIdea = idea || session?.artifacts?.blueprint || selectedIdea;
    if (targetIdea) {
      setSelectedIdea(targetIdea);
      void saveActiveProjectData({ selectedIdea: targetIdea }, loadedProjectIdRef.current || undefined);
    }
    setCenterTab('script');
  };

  // HỦY / DỪNG TIẾN TRÌNH HIỆN TẠI ĐANG CHẠY (BẢO LƯU 100% DỮ LIỆU KỊCH BẢN & ASSETS)
  const handleCancelCurrentRun = async () => {
    if (!session?.sessionId) {
      setIsRunning(false);
      return;
    }
    try {
      if (window.vanhsub?.aiStudio?.cancelPipeline) {
        await window.vanhsub.aiStudio.cancelPipeline({ sessionId: session.sessionId });
      }
    } catch (err: any) {
      console.warn('Lỗi khi huỷ tiến trình đang chạy:', err);
    } finally {
      setIsRunning(false);
      setIsApproving(false);
      setIsConfirmCancelOpen(false);
      let sessionToSave: PipelineSessionState | null = null;
      setSession((prev) => {
        if (!prev) return null;
        const updated: PipelineSessionState = {
          ...prev,
          status: 'cancelled',
          stages: prev.stages
            ? {
                ...prev.stages,
                [prev.currentStage]: {
                  ...(prev.stages as any)[prev.currentStage],
                  status: 'error',
                  error: 'Tiến trình đã tạm dừng theo yêu cầu của bạn',
                },
              }
            : prev.stages,
          updatedAt: Date.now(),
        };
        sessionToSave = updated;
        return updated;
      });
      if (sessionToSave) {
        const toSave: PipelineSessionState = sessionToSave;
        queueMicrotask(() => {
          void saveActiveProjectData(
            {
              savedSession: toSave,
              lastSessionId: toSave.sessionId,
            },
            loadedProjectIdRef.current || undefined
          );
        });
      }
    }
  };

  // TIẾP TỤC TIẾN TRÌNH TỪ BƯỚC HIỆN TẠI
  const handleResumePipelineRun = async (
    idea?: IdeaBlueprint | null,
    mode: 'resume_missing' | 'regenerate_selected' | 'regenerate_all' = 'resume_missing'
  ) => {
    const targetIdea = idea || session?.artifacts?.blueprint || selectedIdea;
    if (targetIdea) {
      setSelectedIdea(targetIdea);
      void saveActiveProjectData({ selectedIdea: targetIdea }, loadedProjectIdRef.current || undefined);
    }
    setCenterTab('script');
    setErrorMessage(null);

    if (!session) return;

    // Nếu đang chờ duyệt ở bước này:
    if (session.status === 'awaiting_approval') {
      await handleApproveStage();
      return;
    }

    // Nếu đang bị dừng hoặc lỗi:
    setIsRunning(true);
    setSession((prev) => (prev ? { ...prev, status: 'running' } : null));

    try {
      if (window.vanhsub?.aiStudio?.resumePipeline) {
        await window.vanhsub.aiStudio.resumePipeline({
          sessionId: session.sessionId,
          fromStage: session.currentStage,
          mode,
          selectedShotIds: mode === 'regenerate_selected' ? selectedShotIds : undefined,
        });
      } else if (window.vanhsub?.aiStudio?.approveStage) {
        await window.vanhsub.aiStudio.approveStage({
          sessionId: session.sessionId,
          currentStage: session.currentStage,
        });
      }
    } catch (err: any) {
      setIsRunning(false);
      setErrorMessage(`Không thể tiếp tục tiến trình: ${err?.message || err}`);
    }
  };

  // TÁI TẠO STORYBOARD THEO CHUẨN 1:1 (1 CÂU KỊCH BẢN = 1 PHÂN CẢNH DUY NHẤT)
  const handleRegenerateStoryboardOneToOne = async () => {
    if (!session?.sessionId || isRunning) return;
    showSceneNotice('Đang cập nhật chế độ 1:1 và tạo lại Storyboard từ Bước 5...');
    setIsRunning(true);
    try {
      if (updateFlowConfig) {
        await updateFlowConfig({ shotMode: 'single' });
      }
      if (window.vanhsub?.aiStudio?.resumePipeline) {
        await window.vanhsub.aiStudio.resumePipeline({
          sessionId: session.sessionId,
          fromStage: 5,
        });
      }
    } catch (err: any) {
      setIsRunning(false);
      showSceneNotice(`✗ Lỗi tái tạo Storyboard: ${err?.message || err}`);
    }
  };

  // THAY ĐỔI MỨC GRANULARITY VÀ TÁI TẠO STORYBOARD
  const handleChangeGranularity = async (newGranularity: 'detailed' | 'balanced' | 'fast') => {
    if (!session?.sessionId || isRunning) return;
    const names = { detailed: 'Chi tiết', balanced: 'Cân bằng', fast: 'Nhanh' };
    showSceneNotice(`Đang cập nhật mức "${names[newGranularity]}" và tái tạo Storyboard từ Bước 5...`);
    setIsRunning(true);
    try {
      if (updateFlowConfig) {
        await updateFlowConfig({ granularity: newGranularity });
      }
      if (window.vanhsub?.aiStudio?.resumePipeline) {
        await window.vanhsub.aiStudio.resumePipeline({
          sessionId: session.sessionId,
          fromStage: 5,
        });
      }
    } catch (err: any) {
      setIsRunning(false);
      showSceneNotice(`✗ Lỗi tái tạo Storyboard: ${err?.message || err}`);
    }
  };

  // XOÁ TOÀN BỘ PHIÊN (CHỈ KHI NGƯỜI DÙNG CHỦ ĐỘNG XÓA VIDEO HOÀN TOÀN)
  const handleClearSession = async () => {
    try {
      if (session?.sessionId && window.vanhsub?.aiStudio?.cancelPipeline) {
        await window.vanhsub.aiStudio.cancelPipeline({ sessionId: session.sessionId });
      }
    } catch (err: any) {
      console.warn('Lỗi khi xoá pipeline:', err);
    } finally {
      setSession(null);
      setIsRunning(false);
      setIsApproving(false);
      setErrorMessage(null);
      setIsConfirmCancelOpen(false);
      setConflictWarningModal(null);
      void saveActiveProjectData(
        {
          savedSession: null,
          lastSessionId: undefined,
        },
        loadedProjectIdRef.current || undefined
      );
    }
  };

  const handleRequestStartProduction = (blueprint: IdeaBlueprint) => {
    // 1. Nếu ý tưởng này chính là ý tưởng đang có session -> Tiếp tục thay vì chạy lại từ đầu!
    if (isIdeaInActiveSession(blueprint)) {
      handleResumeSession(blueprint);
      return;
    }

    // 2. Nếu đang có session khác có dữ liệu kịch bản hoặc đang chạy -> Hiển thị cảnh báo xung đột
    const hasExistingWork =
      Boolean(session) &&
      (Boolean(session?.artifacts?.scriptLines && session.artifacts.scriptLines.length > 0) ||
        (session?.currentStage || 1) >= 2 ||
        isRunning);

    if (hasExistingWork) {
      setConflictWarningModal({ pendingBlueprint: blueprint });
      return;
    }

    // 3. Chưa có dữ liệu kịch bản cũ -> Bắt đầu an toàn
    void handleStartWithBlueprint(blueprint);
  };

  const handleStartWithBlueprint = async (blueprint: IdeaBlueprint) => {
    setErrorMessage(null);
    setIsRunning(true);
    setCenterTab('script');
    setTopic(blueprint.title || blueprint.topic);
    setSelectedIdea(blueprint);

    const currentOutputDir = activeProj?.outputDir?.trim();
    if (!currentOutputDir) {
      setErrorMessage('⚠️ Dự án hiện tại chưa cấu hình Thư mục xuất (Output Directory). Vui lòng vào Cấu hình Dự án để chọn thư mục lưu trữ trước khi bắt đầu!');
      return;
    }

    // Lưu vào danh sách ý tưởng
    const exists = ideas.some((i) => i.title === blueprint.title && i.aspectRatio === blueprint.aspectRatio);
    const nextIdeas = exists ? ideas : [blueprint, ...ideas];
    setIdeas(nextIdeas);

    try {
      const result = await window.vanhsub.aiStudio.startPipeline({
        topic: (blueprint.title || blueprint.topic).trim(),
        blueprint,
        gatedMode: isGatedMode,
        outputDir: currentOutputDir,
        flowProjectUrl: activeProj?.flowProjectUrl?.trim() || undefined,
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

      // Lưu vĩnh viễn vào profile của Project
      void saveActiveProjectData({
        ideas: nextIdeas,
        selectedIdea: blueprint,
        lastSessionId: result.sessionId,
        savedSession: initialSession,
      });
    } catch (err: any) {
      setIsRunning(false);
      setErrorMessage(err?.message || 'Không thể khởi động pipeline');
    }
  };

  const handleStartQuick = async () => {
    if (!topic.trim()) return;
    setErrorMessage(null);

    const currentOutputDir = activeProj?.outputDir?.trim();
    if (!currentOutputDir) {
      setErrorMessage('⚠️ Dự án hiện tại chưa cấu hình Thư mục xuất (Output Directory). Vui lòng vào Cấu hình Dự án để chọn thư mục lưu trữ trước khi bắt đầu!');
      return;
    }

    setIsRunning(true);

    try {
      const result = await window.vanhsub.aiStudio.startPipeline({
        topic: topic.trim(),
        gatedMode: isGatedMode,
        outputDir: currentOutputDir,
        flowProjectUrl: activeProj?.flowProjectUrl?.trim() || undefined,
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

  const handleSelectStylePreset = async (preset: (typeof STYLE_PRESETS)[0]) => {
    const currentBg = config.channelProfile?.projectBackgroundPrompt;
    if (!currentBg || currentBg.trim() === '') {
      await updateChannelProfileConfig({
        visualArtStylePreset: preset.id,
        projectBackgroundPrompt: preset.sampleBg,
      });
    } else {
      await updateChannelProfileConfig({
        visualArtStylePreset: preset.id,
      });
    }
    setHostToast(`🎨 Đã áp dụng preset phong cách: ${preset.name}`);
    setTimeout(() => setHostToast(null), 3500);
  };

  const handleAiSuggestBackground = async () => {
    const niche = config.channelProfile?.channelNiche || '';
    const desc = config.channelProfile?.channelDescription || '';
    const topicText = session?.topic || selectedIdea?.title || '';
    const styleId = config.channelProfile?.videoStyleId || '';

    let suggested = '';
    const combined = `${niche} ${topicText} ${desc} ${styleId}`.toLowerCase();

    if (combined.includes('sinh tồn') || combined.includes('tiền sử') || combined.includes('rừng') || combined.includes('survival')) {
      suggested = 'Primeval prehistoric wilderness, towering ancient ferns, misty jungle canopy, giant mossy boulders, dramatic natural lighting, 8k';
    } else if (combined.includes('khoa học') || combined.includes('đại dương') || combined.includes('biển') || combined.includes('ocean')) {
      suggested = 'Deep sea scientific research chamber or bioluminescent underwater reef abyss, volumetric light beams penetrating crystal dark waters';
    } else if (combined.includes('tài chính') || combined.includes('tiền') || combined.includes('kinh tế') || combined.includes('finance')) {
      suggested = 'Modern high-end financial boardroom overlooking bustling metropolitan skyline, sleek glass and marble architecture, sophisticated ambient lighting';
    } else if (combined.includes('công nghệ') || combined.includes('ai') || combined.includes('cyber') || combined.includes('tech')) {
      suggested = 'Futuristic high-tech research lab with glowing holographic displays, sleek obsidian surfaces, subtle teal and violet accent LEDs';
    } else if (combined.includes('lịch sử') || combined.includes('chiến tranh') || combined.includes('cổ trang') || combined.includes('history')) {
      suggested = 'Authentic ancient imperial stone courtyard, weathered flagstones, ceremonial bronze braziers with flickering fire, misty mountain backdrop';
    } else {
      suggested = 'Atmospheric cinematic studio interior with rich architectural depth, soft dramatic directional lighting, warm bokeh background';
    }

    await updateChannelProfileConfig({ projectBackgroundPrompt: suggested });
    setHostToast('✨ Đã nạp gợi ý bối cảnh thị giác phù hợp vào dự án!');
    setTimeout(() => setHostToast(null), 3500);
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
          handleRequestStartProduction(blueprint);
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
          {/* Tên Project / Kênh với icon lấp lánh và dropdown chuyển đổi nhanh */}
          <div className="relative flex items-center rounded-lg border border-slate-800 bg-[#0F1626] shadow-sm" ref={headerDropdownRef}>
            <button
              type="button"
              onClick={() => setIsHeaderDropdownOpen((prev) => !prev)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800/60 transition cursor-pointer"
              title="Bấm để chuyển nhanh dự án hoặc tạo dự án mới"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span className="truncate max-w-[160px]">{projectName}</span>
              <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform duration-200 ${isHeaderDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {onSwitchProject && (
              <button
                type="button"
                onClick={onSwitchProject}
                className="border-l border-slate-800/80 px-2 py-1.5 text-[11px] font-semibold text-brand-cyan hover:bg-slate-800 hover:text-white transition cursor-pointer"
                title="Quay lại màn hình thiết lập / quản lý project"
              >
                Đổi
              </button>
            )}

            {/* Dropdown Menu */}
            {isHeaderDropdownOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-64 rounded-2xl border border-slate-800 bg-[#0E1526] shadow-2xl p-2 space-y-1 z-50 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-md">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Dự án đã lưu ({(config.savedProjects || []).length})
                </div>

                <div className="max-h-52 overflow-y-auto custom-scrollbar space-y-0.5">
                  {(config.savedProjects || []).map((p) => {
                    const isActive = config.activeProjectId === p.id || projectName === p.name;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={async () => {
                          setIsHeaderDropdownOpen(false);
                          if (!isActive) {
                            await switchProject(p.id);
                          }
                        }}
                        className={`w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-xs text-left transition cursor-pointer ${
                          isActive
                            ? 'bg-brand-cyan/15 text-brand-cyan font-bold border border-brand-cyan/30'
                            : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Folder className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                          <span className="truncate">{p.name}</span>
                        </div>
                        {isActive && <Check className="h-3.5 w-3.5 text-brand-cyan shrink-0" />}
                      </button>
                    );
                  })}
                </div>

                <div className="border-t border-slate-800/80 pt-1 mt-1 space-y-0.5">
                  {onSwitchProject && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsHeaderDropdownOpen(false);
                        onSwitchProject();
                      }}
                      className="w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs text-slate-300 hover:bg-slate-800/80 hover:text-white transition cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <span>Tạo dự án mới...</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setIsHeaderDropdownOpen(false);
                      setIsChannelModalOpen(true);
                    }}
                    className="w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs text-slate-400 hover:bg-slate-800/80 hover:text-slate-200 transition cursor-pointer"
                  >
                    <Settings className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                    <span>Cấu hình kênh &amp; Master Prompt</span>
                  </button>
                </div>
              </div>
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
        <div className="flex items-center gap-2 truncate">
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

          {session && (
            <div className="flex items-center gap-1.5 shrink-0 ml-1">
              {isRunning ? (
                <button
                  type="button"
                  onClick={handleCancelCurrentRun}
                  className="inline-flex items-center gap-1 rounded bg-rose-600/90 hover:bg-rose-500 px-2.5 py-0.5 text-[10px] font-bold text-white transition cursor-pointer shadow-sm shadow-rose-950/40"
                  title="Hủy / Dừng tiến trình AI đang chạy mà không xóa dữ liệu"
                >
                  <Square className="h-2.5 w-2.5 fill-current" />
                  <span>Hủy tiến trình</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleResumeSession()}
                  className="inline-flex items-center gap-1 rounded bg-emerald-600/90 hover:bg-emerald-500 px-2.5 py-0.5 text-[10px] font-bold text-white transition cursor-pointer shadow-sm shadow-emerald-950/40"
                  title="Xem kịch bản & Tiếp tục phiên"
                >
                  <Play className="h-2.5 w-2.5 fill-current" />
                  <span>Tiếp tục</span>
                </button>
              )}
            </div>
          )}
        </div>

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

              {/* Nút ✨ Sinh (Mở modal tạo & sinh ý tưởng - có Guard kiểm tra hoàn tất thiết lập) */}
              <button
                type="button"
                onClick={handleOpenIdeaModal}
                className={`flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-bold text-white shadow transition active:scale-95 cursor-pointer ${
                  setupCheck.isComplete
                    ? 'bg-[#FA5252] hover:bg-[#e04545]'
                    : 'bg-amber-600/80 hover:bg-amber-500 text-amber-100'
                }`}
                title={
                  setupCheck.isComplete
                    ? 'Sinh ý tưởng kịch bản mới'
                    : `⚠️ Chưa hoàn tất thiết lập: Thiếu ${setupCheck.missing.join(', ')}`
                }
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Sinh</span>
              </button>
            </div>
          </div>

          {/* Setup Warning Alert Banner (nếu bấm Sinh khi chưa hoàn tất setup) */}
          {setupWarningToast && (
            <div className="mx-3 mt-2 rounded-xl border border-amber-500/40 bg-amber-950/40 p-2.5 text-[11px] text-amber-200 animate-in fade-in flex flex-col gap-1.5 shadow-md">
              <div className="flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>{setupWarningToast}</span>
              </div>
              {onSwitchProject && (
                <button
                  type="button"
                  onClick={onSwitchProject}
                  className="self-end rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-300 transition cursor-pointer"
                >
                  👉 Mở màn Thiết Lập ngay
                </button>
              )}
            </div>
          )}

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
                      onClick={() => {
                        setSelectedIdea(idea);
                        void saveActiveProjectData({ selectedIdea: idea });
                      }}
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
                        {isIdeaInActiveSession(idea) ? (
                          isRunning ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCancelCurrentRun();
                              }}
                              className="rounded-lg bg-rose-600/90 hover:bg-rose-500 px-3 py-1 text-[11px] font-bold text-white transition active:scale-95 cursor-pointer flex items-center gap-1 shadow-sm shadow-rose-950/40"
                              title="Hủy / Dừng tiến trình AI đang chạy (bảo lưu dữ liệu kịch bản)"
                            >
                              <Square className="h-2.5 w-2.5 fill-current" />
                              <span>Hủy tiến trình</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleResumeSession(idea);
                              }}
                              className="rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:brightness-110 px-3 py-1 text-[11px] font-bold text-white transition active:scale-95 cursor-pointer flex items-center gap-1 shadow-md shadow-emerald-950/40"
                              title="Xem kịch bản & Tiếp tục tiến trình"
                            >
                              <Play className="h-2.5 w-2.5 fill-current" />
                              <span>Tiếp tục ▸</span>
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRequestStartProduction(idea);
                            }}
                            disabled={isRunning}
                            className="rounded-lg bg-orange-600/90 hover:bg-orange-500 px-3 py-1 text-[11px] font-bold text-white transition active:scale-95 disabled:opacity-50 cursor-pointer"
                          >
                            Sản xuất ▸
                          </button>
                        )}
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
              isRunning={isRunning}
              activeCenterTab={centerTab}
              onSwitchTab={setCenterTab}
              onProceedToVoice={handleApproveStage}
              onRegenerateScript={handleRetryCurrentStage}
              onCancelProcess={handleCancelCurrentRun}
              onBackToIdeas={() => {
                setCenterTab('visual');
              }}
              onSessionUpdate={(updatedSession) => {
                setSession(updatedSession);
                void saveActiveProjectData({
                  savedSession: updatedSession,
                  lastSessionId: updatedSession.sessionId,
                });
              }}
              onDeleteVideo={handleClearSession}
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
                      <div className="rounded-2xl border border-orange-500/30 bg-[#121826] p-5 space-y-3.5 animate-in fade-in duration-200 shadow-lg">
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

                        {/* Character consistency indicator */}
                        {(config.channelProfile?.hostName || config.channelProfile?.hostDescription) && (
                          <div className="rounded-xl border border-pink-500/30 bg-pink-950/20 p-2.5 flex items-start gap-2.5 text-xs">
                            <User className="h-4 w-4 text-pink-400 shrink-0 mt-0.5" />
                            <div className="space-y-0.5 min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-pink-300">Nhân vật đại diện:</span>
                                <span className="text-white font-medium">{config.channelProfile?.hostName || 'Nhân vật chính'}</span>
                              </div>
                              {config.channelProfile?.hostDescription && (
                                <p className="text-[11px] text-slate-300 leading-relaxed">
                                  {config.channelProfile.hostDescription}
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Thumbnail details */}
                        {(selectedIdea.thumbnailConcept || selectedIdea.thumbnailPrompt) && (
                          <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-3 space-y-2 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                                <ImageIcon className="h-3.5 w-3.5 text-indigo-400" />
                                Thumbnail &amp; Ảnh Bìa Video
                              </span>
                              {selectedIdea.thumbnailPrompt && (
                                <button
                                  type="button"
                                  onClick={() => handleCopyIdeaThumbPrompt(selectedIdea.thumbnailPrompt || '')}
                                  className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-900/40 px-2 py-0.5 text-[10px] font-bold text-indigo-200 hover:bg-indigo-800 transition cursor-pointer"
                                >
                                  <Copy className="h-2.5 w-2.5" />
                                  <span>{copiedIdeaThumbPrompt ? '✓ Đã sao chép prompt' : 'Sao chép Prompt AI'}</span>
                                </button>
                              )}
                            </div>

                            {selectedIdea.thumbnailConcept && (
                              <p className="text-slate-300 text-[11px] leading-relaxed">
                                <strong className="text-indigo-200">Concept:</strong> {selectedIdea.thumbnailConcept}
                              </p>
                            )}

                            {selectedIdea.thumbnailPrompt && (
                              <pre className="font-mono text-[10px] text-slate-300 bg-black/40 p-2 rounded-lg border border-indigo-500/20 whitespace-pre-wrap break-words max-h-24 overflow-y-auto custom-scrollbar">
                                {selectedIdea.thumbnailPrompt}
                              </pre>
                            )}
                          </div>
                        )}

                        <div className="pt-2 flex items-center justify-end gap-2.5">
                          {selectedIdea && isIdeaInActiveSession(selectedIdea) ? (
                            isRunning ? (
                              <button
                                type="button"
                                onClick={handleCancelCurrentRun}
                                className="rounded-xl border border-rose-800/80 bg-rose-950/60 hover:bg-rose-900/80 px-4 py-2.5 text-xs font-bold text-rose-200 transition active:scale-95 cursor-pointer flex items-center gap-1.5 shadow-sm shadow-rose-950/40"
                                title="Hủy / Dừng tiến trình đang chạy (bảo lưu dữ liệu kịch bản)"
                              >
                                <Square className="h-3.5 w-3.5 fill-rose-400 text-rose-400" />
                                <span>Hủy tiến trình đang chạy</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleResumeSession(selectedIdea)}
                                className="rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:brightness-110 px-5 py-2.5 text-xs font-bold text-white shadow-md transition active:scale-95 cursor-pointer flex items-center gap-2"
                              >
                                <Play className="h-3.5 w-3.5 fill-white" />
                                <span>Tiếp tục sản xuất (Xem Kịch Bản)</span>
                              </button>
                            )
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRequestStartProduction(selectedIdea)}
                              disabled={isRunning}
                              className="rounded-xl bg-gradient-to-r from-[#FA5252] via-orange-500 to-amber-500 hover:brightness-110 px-5 py-2.5 text-xs font-bold text-white shadow-md transition active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-2"
                            >
                              <Play className="h-3.5 w-3.5 fill-white" />
                              <span>Sản xuất ý tưởng này (Tạo Kịch Bản)</span>
                            </button>
                          )}
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

                    {/* Box 4: Phong cách Bối cảnh & Không gian Thị giác Toàn Dự Án */}
                    <div className="rounded-2xl border border-indigo-900/50 bg-[#0B101E] p-4 space-y-3.5 shadow-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
                            <Palette className="h-3.5 w-3.5" />
                          </span>
                          <span className="text-xs font-bold text-indigo-300">
                            Phong cách Bối cảnh & Không gian Thị giác Toàn Dự Án
                          </span>
                        </div>
                        <span className="text-[11px] font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3" /> Cố định cho Storyboard & Video
                        </span>
                      </div>

                      <p className="text-xs text-slate-400 leading-relaxed">
                        AI sẽ tự động áp dụng bối cảnh và định hướng mỹ thuật này vào <span className="text-slate-200 font-semibold">TẤT CẢ</span> các phân cảnh Storyboard, kết hợp nhất quán với ngoại hình/trang phục của nhân vật đã thiết lập ở trên.
                      </p>

                      {/* Style Presets Grid */}
                      <div>
                        <label className="text-[11px] font-semibold text-slate-400 block mb-1.5">
                          Chọn phong cách mỹ thuật mẫu (Preset):
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {STYLE_PRESETS.map((preset) => {
                            const isSelected = config.channelProfile?.visualArtStylePreset === preset.id;
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() => handleSelectStylePreset(preset)}
                                className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition cursor-pointer ${
                                  isSelected
                                    ? 'border-indigo-500 bg-indigo-950/40 shadow-sm ring-1 ring-indigo-500/50'
                                    : 'border-slate-800 bg-[#070B14] hover:border-slate-700 hover:bg-[#0e1526]'
                                }`}
                              >
                                <div className="flex items-center justify-between w-full">
                                  <span className={`text-xs font-bold ${isSelected ? 'text-indigo-300' : 'text-slate-200'}`}>
                                    {preset.name}
                                  </span>
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-medium">
                                    {preset.badge}
                                  </span>
                                </div>
                                <span className="text-[10px] text-slate-500 mt-1 line-clamp-1">
                                  {preset.desc}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Custom Background Prompt Textarea */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-semibold text-slate-300">
                            Prompt bối cảnh & không gian mỹ thuật của toàn bộ dự án:
                          </label>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={handleAiSuggestBackground}
                              className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 hover:underline cursor-pointer"
                              title="Tự động gợi ý bối cảnh từ ngách và chủ đề video"
                            >
                              <Sparkles className="h-3 w-3" /> AI gợi ý theo Kịch bản / Kênh
                            </button>
                            {config.channelProfile?.projectBackgroundPrompt && (
                              <button
                                type="button"
                                onClick={() => updateChannelProfileConfig({ projectBackgroundPrompt: '' })}
                                className="text-[11px] text-rose-400 hover:underline cursor-pointer"
                              >
                                Xoá
                              </button>
                            )}
                          </div>
                        </div>
                        <textarea
                          rows={3}
                          placeholder="Nhập mô tả bối cảnh để AI cố định cho mọi khung hình (vd: Modern dark sci-fi control room with panoramic space view, volumetric cyan lighting, cinematic photorealistic 8k...)"
                          value={config.channelProfile?.projectBackgroundPrompt || ''}
                          onChange={(e) => updateChannelProfileConfig({ projectBackgroundPrompt: e.target.value })}
                          className="w-full rounded-xl border border-slate-800 bg-[#070B14] p-3 text-xs text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none leading-relaxed resize-y"
                        />
                      </div>

                      {/* Explanation of prompt composition */}
                      <div className="rounded-xl border border-indigo-950/40 bg-[#070B16] p-2.5 text-[11px] text-slate-400 flex items-start gap-2">
                        <Lightbulb className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <span>
                          <strong className="text-slate-300">Công thức ghép Prompt Storyboard:</strong>{' '}
                          <code className="text-indigo-300">[Phong cách nghệ thuật]</code> +{' '}
                          <code className="text-cyan-300">[Góc máy & Hành động]</code> +{' '}
                          <code className="text-amber-300">[Ngoại hình nhân vật]</code> +{' '}
                          <code className="text-emerald-300">in [Bối cảnh dự án]</code> +{' '}
                          <code className="text-slate-400">[8k, photorealistic]</code>
                        </span>
                      </div>
                    </div>
                  </>
                )}

                {centerTab === 'visual' && (
                  <div className="space-y-4">
                    {/* Header Toolbar: Thư mục lưu trữ & Trạng thái Media & Nút xem Flow */}
                    <div className="rounded-2xl border border-slate-800 bg-[#0B101E] p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                        <div className="flex items-center gap-2">
                          <Film className="h-4 w-4 text-cyan-400" />
                          <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                            Phân cảnh &amp; Media AI (Giai đoạn 5 &amp; 6)
                          </h4>
                          {session?.artifacts?.scenes && session.artifacts.scenes.length > 0 && (
                            <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300 border border-cyan-500/30">
                              {session.artifacts.scenes.filter((s) => s.videoPath || s.imagePath || s.assetPath).length} /{' '}
                              {session.artifacts.scenes.length} đã có media
                            </span>
                          )}
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                              (config.flowEngine?.shotMode || 'single') === 'single'
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                            }`}
                            title={
                              (config.flowEngine?.shotMode || 'single') === 'single'
                                ? 'Mỗi câu kịch bản tương ứng đúng 1 phân cảnh media (1:1)'
                                : 'Tự động chia các câu dài thành nhiều góc quay (Multi-shot)'
                            }
                          >
                            {(config.flowEngine?.shotMode || 'single') === 'single'
                              ? '🎯 Chuẩn 1:1 (1 Cảnh = 1 Media)'
                              : '🎬 Đa góc quay (Multi-shot)'}
                          </span>
                        </div>

                        {/* Nút xem Flow trực tiếp */}
                        <button
                          type="button"
                          onClick={handleToggleFlowLive}
                          className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 border shadow-sm ${
                            isFlowWindowOpen
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                              : 'bg-slate-900 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-800'
                          }`}
                          title="Bật hoặc ẩn cửa sổ Google Flow để theo dõi quá trình tự động sinh media"
                        >
                          {isFlowWindowOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          <span>{isFlowWindowOpen ? 'Ẩn cửa sổ Flow' : '👁️ Mở cửa sổ Flow Live'}</span>
                        </button>
                      </div>

                      {/* Lưu trữ media trên máy */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/70">
                        <div className="flex items-center gap-2 min-w-0">
                          <HardDrive className="h-4 w-4 text-indigo-400 shrink-0" />
                          <div className="min-w-0">
                            <span className="text-[11px] text-slate-400">Nơi lưu trữ ảnh &amp; video:</span>
                            <div
                              className="font-mono text-[11px] text-indigo-300 truncate max-w-md"
                              title={
                                session?.artifacts?.mediaDir ||
                                config.channelProfile?.customMediaDir ||
                                'Mặc định thư mục dự án (05_media)'
                              }
                            >
                              {session?.artifacts?.mediaDir ||
                                config.channelProfile?.customMediaDir ||
                                'Mặc định thư mục dự án (05_media)'}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={handleSelectCustomMediaDir}
                            className="rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:text-white transition cursor-pointer flex items-center gap-1"
                            title="Chọn thư mục riêng trên ổ cứng để lưu toàn bộ ảnh & video xuất ra"
                          >
                            <FolderOpen className="h-3 w-3" />
                            <span>Đổi thư mục lưu</span>
                          </button>

                          {(session?.artifacts?.mediaDir || config.channelProfile?.customMediaDir) && (
                            <button
                              type="button"
                              onClick={() =>
                                handleOpenFolder(
                                  session?.artifacts?.mediaDir || config.channelProfile?.customMediaDir
                                )
                              }
                              className="rounded-lg border border-indigo-700/50 bg-indigo-950/40 hover:bg-indigo-900/60 px-2.5 py-1 text-[11px] font-medium text-indigo-300 hover:text-indigo-200 transition cursor-pointer flex items-center gap-1"
                              title="Mở thư mục chứa ảnh và video trong File Explorer"
                            >
                              <ExternalLink className="h-3 w-3" />
                              <span>Mở thư mục</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Banner thông báo thao tác trên phân cảnh */}
                    {sceneActionNotice && (
                      <div className="rounded-xl border border-cyan-500/40 bg-cyan-950/80 p-3 text-xs text-cyan-200 shadow-lg flex items-center justify-between animate-in fade-in duration-200">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-cyan-400 shrink-0" />
                          <span>{sceneActionNotice}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSceneActionNotice(null)}
                          className="text-cyan-400 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-cyan-900/60 transition cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    {/* Danh sách phân cảnh và hiển thị Media */}
                    {session?.artifacts?.scenes && session.artifacts.scenes.length > 0 ? (
                      <div className="space-y-4">
                        {/* Thẻ Dự toán Sản xuất & Pacing */}
                        {(() => {
                          const syn = (session.artifacts as any)?.storyboardSynthesis;
                          const totalShots = syn?.total_shots || session.artifacts.scenes.length;
                          const videoShots = syn?.video_shots || session.artifacts.scenes.filter((s) => s.motionType === 'video').length;
                          const imageShots = syn?.image_shots || (totalShots - videoShots);
                          const totalDurationSec = syn?.total_duration_sec || (session.artifacts.scenes.reduce((acc, s) => acc + (s.durationMs || 0), 0) / 1000);
                          const avgDurationSec = syn?.avg_duration_per_shot_sec || (totalShots > 0 ? Math.round((totalDurationSec / totalShots) * 10) / 10 : 0);
                          const isFragmented = syn?.is_too_fragmented ?? (avgDurationSec > 0 && avgDurationSec < 2.5);
                          const estTimeSec = syn?.estimated_production_time_sec || (imageShots * 22 + videoShots * 65);
                          const estCredits = syn?.estimated_credits || (imageShots * 1 + videoShots * 5);
                          const estMin = Math.floor(estTimeSec / 60);
                          const estSec = estTimeSec % 60;
                          const currentGranularity = (config.flowEngine as any)?.granularity || 'balanced';

                          return (
                            <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-[#0F172A] to-[#0B101E] p-4 space-y-3 shadow-lg">
                              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                                <div className="flex items-center gap-2">
                                  <Sparkles className="h-4 w-4 text-amber-400" />
                                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                                    Dự toán Sản xuất &amp; Pacing Phân cảnh
                                  </span>
                                </div>

                                {/* Bộ chuyển Granularity nhanh */}
                                <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px]">
                                  <span className="text-slate-400 px-1.5 font-medium">Độ chi tiết:</span>
                                  {(['detailed', 'balanced', 'fast'] as const).map((g) => {
                                    const labels = { detailed: '🎯 Chi tiết', balanced: '⚖️ Cân bằng', fast: '⚡ Nhanh' };
                                    const isSel = currentGranularity === g;
                                    return (
                                      <button
                                        key={g}
                                        type="button"
                                        onClick={() => handleChangeGranularity(g)}
                                        disabled={isRunning}
                                        className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer disabled:opacity-50 ${
                                          isSel
                                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow'
                                            : 'text-slate-400 hover:text-white hover:bg-slate-900'
                                        }`}
                                        title={
                                          g === 'detailed'
                                            ? '1 shot/câu, bám sát nội dung nhất'
                                            : g === 'balanced'
                                            ? 'Tự động gộp các đoạn mô tả tĩnh kéo dài'
                                            : 'Gộp nhiều câu ngắn (~8-15s) để sinh nhanh nhất'
                                        }
                                      >
                                        {labels[g]}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* 4 Cards Chỉ số Dự toán */}
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-2.5">
                                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">Tổng phân cảnh</span>
                                  <div className="text-sm font-bold text-white mt-0.5">
                                    {totalShots} <span className="text-[11px] font-normal text-slate-400">({imageShots} ảnh / {videoShots} clip)</span>
                                  </div>
                                </div>

                                <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-2.5">
                                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">Pacing Trung bình</span>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <span className={`text-sm font-bold ${isFragmented ? 'text-amber-400' : 'text-emerald-400'}`}>
                                      {avgDurationSec}s
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold border ${
                                      isFragmented
                                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                    }`}>
                                      {isFragmented ? '⚠️ Quá vụn' : 'Lý tưởng'}
                                    </span>
                                  </div>
                                </div>

                                <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-2.5">
                                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">Ước tính thời gian</span>
                                  <div className="text-sm font-bold text-indigo-300 mt-0.5">
                                    ~{estMin > 0 ? `${estMin}p ` : ''}{estSec}s
                                  </div>
                                </div>

                                <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-2.5">
                                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">Ước tính credit</span>
                                  <div className="text-sm font-bold text-amber-300 mt-0.5">
                                    ~{estCredits} <span className="text-[11px] font-normal text-slate-400">credits</span>
                                  </div>
                                </div>
                              </div>

                              {/* Ghi chú ước tính sơ bộ */}
                              <div className="text-[10px] text-slate-500 italic pt-1 border-t border-slate-800/40 flex items-center justify-between">
                                <span>* Ước tính sơ bộ dựa trên định mức trung bình của Flow (~22s/ảnh, ~65s/video; 1 cr/ảnh, 5 cr/video).</span>
                              </div>

                              {/* Cảnh báo nếu phân cảnh quá vụn */}
                              {isFragmented && (
                                <div className="rounded-xl border border-amber-500/30 bg-amber-950/40 p-2.5 text-xs text-amber-200 flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                                    <span>
                                      {syn?.warning || `Phân cảnh đang quá vụn (trung bình ${avgDurationSec}s/shot < 2.5s). Nên chuyển sang mức "Cân bằng" hoặc "Nhanh" để gộp các câu thoại liền kề.`}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleChangeGranularity('balanced')}
                                    disabled={isRunning}
                                    className="shrink-0 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-semibold text-[11px] transition cursor-pointer disabled:opacity-50"
                                  >
                                    Tự động gộp (Cân bằng)
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Batch Control Toolbar for Scenes */}
                        <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 rounded-xl border border-slate-800 bg-slate-900/70 text-xs">
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white font-medium select-none">
                              <input
                                type="checkbox"
                                checked={
                                  selectedShotIds.length === session.artifacts.scenes.length &&
                                  session.artifacts.scenes.length > 0
                                }
                                onChange={() =>
                                  handleSelectAllShots(
                                    session.artifacts!.scenes!.map((s) => s.shotId || s.id)
                                  )
                                }
                                className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500/30 cursor-pointer"
                              />
                              <span>
                                Chọn tất cả ({selectedShotIds.length}/{session.artifacts.scenes.length})
                              </span>
                            </label>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            {selectedShotIds.length > 0 && (
                              <button
                                type="button"
                                onClick={() => handleResumePipelineRun(null, 'regenerate_selected')}
                                disabled={isRunning}
                                className="flex items-center gap-1 rounded-lg border border-amber-600/60 bg-amber-950/60 hover:bg-amber-900/80 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:text-white transition cursor-pointer disabled:opacity-50"
                                title={`Chạy lại tạo mới phiên bản cho ${selectedShotIds.length} shot đã chọn`}
                              >
                                <RotateCcw className="h-3 w-3" />
                                <span>Chạy lại đã chọn ({selectedShotIds.length})</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={handleRegenerateStoryboardOneToOne}
                              disabled={isRunning}
                              className="flex items-center gap-1 rounded-lg border border-cyan-700/60 bg-cyan-950/60 hover:bg-cyan-900/80 px-2.5 py-1 text-[11px] font-medium text-cyan-300 hover:text-white transition cursor-pointer disabled:opacity-50"
                              title="Tái tạo lại Storyboard theo chuẩn 1 câu thoại = 1 phân cảnh (1:1), loại bỏ các phân cảnh con bị lặp lại"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>Tái tạo Storyboard (1:1)</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleResumePipelineRun(null, 'regenerate_all')}
                              disabled={isRunning}
                              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:text-white transition cursor-pointer disabled:opacity-50"
                              title="Tạo phiên bản mới cho toàn bộ storyboard qua Flow (bảo toàn file cũ)"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>Chạy lại toàn bộ</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleResumePipelineRun(null, 'resume_missing')}
                              disabled={isRunning}
                              className="flex items-center gap-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 px-3 py-1 text-[11px] font-bold text-white shadow transition cursor-pointer disabled:opacity-50"
                              title="Chỉ tạo các phân cảnh chưa có file trên đĩa"
                            >
                              <Play className="h-3 w-3 fill-current" />
                              <span>Tiếp tục (chỉ phần thiếu)</span>
                            </button>
                          </div>
                        </div>

                        {session.artifacts.scenes.map((scene, sIdx) => {
                          const targetSceneId = scene.shotId || scene.id;
                          const isRegenerating = regeneratingSceneId === targetSceneId;
                          const isImporting = importingSceneId === targetSceneId;
                          const isSceneBusy = isRegenerating || isImporting;

                          const hasVideo =
                            !!scene.videoPath ||
                            (!!scene.assetPath && scene.assetPath.toLowerCase().endsWith('.mp4'));
                          const videoUrl = scene.videoPath || (hasVideo ? scene.assetPath : undefined);
                          const hasImage = !!scene.imagePath || (!!scene.assetPath && !hasVideo);
                          const imageUrl = scene.imagePath || (!hasVideo ? scene.assetPath : undefined);

                          // Phân cấp Phân cảnh (Scene) và Góc quay (Shot)
                          const currentLineIndex = scene.lineIndex !== undefined ? scene.lineIndex : sIdx;
                          const shotsForSameScene = (session.artifacts?.scenes || []).filter(
                            (s) => (s.lineIndex !== undefined ? s.lineIndex : -1) === currentLineIndex
                          );
                          const isMultiShot = shotsForSameScene.length > 1;
                          const shotIndexInScene = isMultiShot
                            ? shotsForSameScene.findIndex((s) => (s.shotId || s.id) === targetSceneId) + 1
                            : 1;
                          const totalShotsInScene = shotsForSameScene.length;
                          const sceneDisplayNum = currentLineIndex + 1;

                          return (
                            <div
                              key={scene.id || sIdx}
                              className="rounded-2xl border border-slate-800 bg-[#0B101E] p-4 space-y-3 text-xs shadow-md"
                            >
                              {/* Header phân cảnh */}
                              <div className="flex items-center justify-between font-mono text-[11px] border-b border-slate-800/80 pb-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <input
                                    type="checkbox"
                                    checked={selectedShotIds.includes(targetSceneId)}
                                    onChange={() => toggleSelectShot(targetSceneId)}
                                    className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500/30 cursor-pointer"
                                    title={`Chọn phân cảnh ${targetSceneId} để chạy lại`}
                                  />
                                  {isMultiShot ? (
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-bold text-white bg-slate-800 px-2.5 py-0.5 rounded flex items-center gap-1">
                                        <span>Phân cảnh {sceneDisplayNum}</span>
                                        <span className="text-cyan-400 font-semibold">• Góc {shotIndexInScene}/{totalShotsInScene}</span>
                                      </span>
                                      <span className="rounded bg-indigo-950/80 text-indigo-300 border border-indigo-700/40 px-1.5 py-0.5 text-[9px] font-semibold">
                                        Đa góc quay
                                      </span>
                                      <span className="text-[10px] text-slate-500 font-mono">
                                        [{targetSceneId}]
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-bold text-white bg-slate-800 px-2.5 py-0.5 rounded">
                                        Phân cảnh {sceneDisplayNum}
                                      </span>
                                      <span className="text-[10px] text-slate-500 font-mono">
                                        [{targetSceneId}]
                                      </span>
                                    </div>
                                  )}
                                  <span className="text-slate-400">
                                    Thời lượng: {Math.round((scene.durationMs || 4000) / 1000)}s
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {hasVideo ? (
                                    <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                                      <CheckCircle2 className="h-2.5 w-2.5" /> Video sẵn sàng
                                    </span>
                                  ) : hasImage ? (
                                    <span className="rounded-full bg-cyan-500/20 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
                                      <CheckCircle2 className="h-2.5 w-2.5" /> Đã có Ảnh
                                    </span>
                                  ) : (
                                    <span className="rounded-full bg-slate-800/80 px-2.5 py-0.5 text-[10px] text-slate-400 border border-slate-700 flex items-center gap-1">
                                      <Clock className="h-2.5 w-2.5" /> Chờ tạo media
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Lời thoại / Narration */}
                              <div>
                                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                                  {isMultiShot ? (
                                    <span className="flex items-center gap-1">
                                      <span>Lời thoại</span>
                                      <span className="text-cyan-400 normal-case font-medium">
                                        (Góc {shotIndexInScene}/{totalShotsInScene} - Cảnh {sceneDisplayNum}):
                                      </span>
                                    </span>
                                  ) : (
                                    'Lời thoại:'
                                  )}
                                </span>
                                <p className="text-white font-medium text-[13px] leading-relaxed mt-0.5">
                                  {scene.lineText}
                                </p>
                              </div>

                              {/* Prompt sinh ảnh / video */}
                              <div className="text-[11px] bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80 space-y-1">
                                <div className="flex items-center justify-between text-slate-400 text-[10px]">
                                  <span className="font-semibold text-slate-300 flex items-center gap-1">
                                    <Sparkles className="h-3 w-3 text-amber-400" /> Prompt Visual Flow:
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => navigator.clipboard.writeText(scene.visualPrompt || '')}
                                    className="hover:text-white transition flex items-center gap-1 text-[10px]"
                                    title="Copy prompt"
                                  >
                                    <Copy className="h-2.5 w-2.5" /> Copy
                                  </button>
                                </div>
                                <p className="text-slate-300 italic font-mono text-[11px] leading-relaxed break-words">
                                  {scene.visualPrompt}
                                </p>
                              </div>

                              {/* Hiển thị Media Thực Tế */}
                              {hasVideo ? (
                                <div className="space-y-2 pt-1">
                                  <div
                                    onClick={() =>
                                      setPreviewMedia({
                                        type: 'video',
                                        url: videoUrl!,
                                        shotId: scene.shotId || `Phân cảnh #${sIdx + 1}`,
                                        narration: scene.lineText,
                                        prompt: scene.visualPrompt,
                                        durationMs: scene.durationMs,
                                      })
                                    }
                                    className="group relative rounded-2xl overflow-hidden border border-slate-700/80 bg-black aspect-video max-h-72 flex items-center justify-center cursor-pointer shadow-lg hover:border-brand-cyan/60 transition duration-300"
                                    title="Bấm để xem video phóng to toàn màn hình"
                                  >
                                    <video
                                      src={toMediaUrl(videoUrl)}
                                      controls
                                      preload="metadata"
                                      className="w-full h-full object-contain transition-transform duration-300 ease-out group-hover:scale-105"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none flex flex-col justify-between p-3">
                                      <div className="flex items-center justify-end">
                                        <span className="rounded-lg bg-black/80 backdrop-blur-md px-2.5 py-1 text-[10px] font-bold text-white border border-white/20 flex items-center gap-1 shadow-md">
                                          <Maximize2 className="h-3 w-3 text-cyan-400" /> Bấm để xem lớn
                                        </span>
                                      </div>
                                      <div className="text-[11px] text-slate-200 font-medium truncate">
                                        🎬 {scene.shotId || `Phân cảnh #${sIdx + 1}`}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 px-1">
                                    <span className="truncate max-w-sm font-mono text-[10px]" title={videoUrl}>
                                      📹 {videoUrl}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenFolder(videoUrl)}
                                      className="text-brand-cyan hover:underline flex items-center gap-1 shrink-0 font-medium cursor-pointer"
                                    >
                                      <FolderOpen className="h-3 w-3" /> Mở tệp video
                                    </button>
                                  </div>

                                  {/* Hiển thị kèm ảnh nguồn nếu có */}
                                  {scene.imagePath && (
                                    <div className="flex items-center gap-2 p-2 bg-slate-950/60 rounded-xl border border-slate-800/80 text-[11px]">
                                      <div
                                        onClick={() =>
                                          setPreviewMedia({
                                            type: 'image',
                                            url: scene.imagePath!,
                                            shotId: `${scene.shotId || `Cảnh #${sIdx + 1}`} (Ảnh nguồn Image-to-Video)`,
                                            narration: scene.lineText,
                                            prompt: scene.visualPrompt,
                                          })
                                        }
                                        className="group relative h-12 w-20 overflow-hidden rounded-lg border border-slate-700 shrink-0 cursor-pointer hover:border-cyan-400 transition"
                                        title="Bấm để xem ảnh nguồn phóng to"
                                      >
                                        <img
                                          src={toMediaUrl(scene.imagePath)}
                                          alt={`Ảnh nguồn #${sIdx + 1}`}
                                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                                        />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                          <Maximize2 className="h-3.5 w-3.5 text-white drop-shadow" />
                                        </div>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <span className="text-[10px] text-slate-400 block font-semibold">
                                          Ảnh nguồn Image-to-Video:
                                        </span>
                                        <p className="text-slate-300 truncate font-mono text-[10px]">{scene.imagePath}</p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenFolder(scene.imagePath)}
                                        className="text-cyan-400 hover:underline shrink-0 text-[11px] cursor-pointer"
                                      >
                                        Mở ảnh
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ) : hasImage ? (
                                <div className="space-y-2 pt-1">
                                  <div
                                    onClick={() =>
                                      setPreviewMedia({
                                        type: 'image',
                                        url: imageUrl!,
                                        shotId: scene.shotId || `Phân cảnh #${sIdx + 1}`,
                                        narration: scene.lineText,
                                        prompt: scene.visualPrompt,
                                        durationMs: scene.durationMs,
                                      })
                                    }
                                    className="group relative rounded-2xl overflow-hidden border border-slate-700/80 bg-black max-h-72 flex items-center justify-center cursor-pointer shadow-lg hover:border-brand-cyan/60 transition duration-300"
                                    title="Bấm để xem ảnh phóng to chi tiết"
                                  >
                                    <img
                                      src={toMediaUrl(imageUrl)}
                                      alt={`Ảnh phân cảnh #${sIdx + 1}`}
                                      className="max-h-72 w-full object-contain rounded-lg transition-transform duration-300 ease-out group-hover:scale-105"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none flex flex-col justify-between p-3">
                                      <div className="flex items-center justify-end">
                                        <span className="rounded-lg bg-black/80 backdrop-blur-md px-2.5 py-1 text-[10px] font-bold text-white border border-white/20 flex items-center gap-1 shadow-md">
                                          <Maximize2 className="h-3 w-3 text-cyan-400" /> Bấm để xem lớn
                                        </span>
                                      </div>
                                      <div className="text-[11px] text-slate-200 font-medium truncate">
                                        🖼️ {scene.shotId || `Phân cảnh #${sIdx + 1}`}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 px-1">
                                    <span className="truncate max-w-sm font-mono text-[10px]" title={imageUrl}>
                                      🖼️ {imageUrl}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenFolder(imageUrl)}
                                      className="text-brand-cyan hover:underline flex items-center gap-1 shrink-0 font-medium cursor-pointer"
                                    >
                                      <FolderOpen className="h-3 w-3" /> Mở tệp ảnh
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-3 text-center text-slate-500 text-[11px] flex items-center justify-center gap-2">
                                  <Clock className="h-3.5 w-3.5 text-slate-600" />
                                  <span>Media chưa được sinh. Bấm Tiếp tục sang Bước 6 để Flow tự động tạo.</span>
                                </div>
                              )}

                              {/* Loading / Progress indicator khi đang thao tác */}
                              {isSceneBusy && (
                                <div className="rounded-xl bg-cyan-950/40 border border-cyan-700/50 p-2.5 flex items-center gap-2.5 text-cyan-200 text-[11px] animate-pulse">
                                  <RotateCcw className="h-3.5 w-3.5 animate-spin text-cyan-400 shrink-0" />
                                  <span>
                                    {isRegenerating
                                      ? `Đang kết nối Google Flow để tạo lại media cho ${targetSceneId}...`
                                      : `Đang sao chép và nạp tệp media vào thư mục dự án...`}
                                  </span>
                                </div>
                              )}

                              {/* Thanh công cụ thao tác tay: Tạo lại AI & Chọn từ máy */}
                              <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-800/80 text-[11px]">
                                {/* Nhóm 1: Tạo lại qua Flow */}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-slate-400 font-semibold text-[10px] uppercase tracking-wider">
                                    Tạo lại AI:
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleRegenerateScene(scene, 'image')}
                                    disabled={isSceneBusy}
                                    className="rounded-lg border border-cyan-800/60 bg-cyan-950/40 hover:bg-cyan-900/70 px-2.5 py-1 text-[11px] font-semibold text-cyan-300 hover:text-cyan-100 transition cursor-pointer flex items-center gap-1 disabled:opacity-50"
                                    title="Sinh lại ảnh AI mới từ visual prompt của phân cảnh này qua Flow"
                                  >
                                    <RotateCcw className={`h-3 w-3 ${isRegenerating ? 'animate-spin' : ''}`} />
                                    <span>Tạo lại Ảnh</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleRegenerateScene(scene, 'video')}
                                    disabled={isSceneBusy}
                                    className="rounded-lg border border-emerald-800/60 bg-emerald-950/40 hover:bg-emerald-900/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:text-emerald-100 transition cursor-pointer flex items-center gap-1 disabled:opacity-50"
                                    title="Sinh lại video Veo từ ảnh hiện tại của phân cảnh này qua Flow"
                                  >
                                    <Film className={`h-3 w-3 ${isRegenerating ? 'animate-pulse' : ''}`} />
                                    <span>Tạo lại Video</span>
                                  </button>
                                </div>

                                {/* Nhóm 2: Chọn từ máy tính */}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-slate-400 font-semibold text-[10px] uppercase tracking-wider">
                                    Nạp từ máy:
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleImportManualMedia(scene, 'image')}
                                    disabled={isSceneBusy}
                                    className="rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:text-white transition cursor-pointer flex items-center gap-1 disabled:opacity-50"
                                    title="Chọn tệp ảnh từ máy tính (PNG, JPG, WEBP) để gán cho phân cảnh này"
                                  >
                                    <ImageIcon className="h-3 w-3 text-cyan-400" />
                                    <span>Chọn ảnh</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleImportManualMedia(scene, 'video')}
                                    disabled={isSceneBusy}
                                    className="rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:text-white transition cursor-pointer flex items-center gap-1 disabled:opacity-50"
                                    title="Chọn tệp video từ máy tính (MP4, WEBM, MOV) để gán cho phân cảnh này"
                                  >
                                    <Video className="h-3 w-3 text-emerald-400" />
                                    <span>Chọn video</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center text-xs text-slate-500 py-12 space-y-2 border border-dashed border-slate-800 rounded-2xl bg-slate-950/20">
                        <Film className="h-8 w-8 mx-auto text-slate-600 stroke-[1.5]" />
                        <p>Chưa có phân cảnh visual. Visual sẽ được sinh sau khi duyệt kịch bản và lồng tiếng (Bước 5 &amp; 6).</p>
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
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-wide">Tiến độ sản xuất</h3>
              <button
                type="button"
                onClick={handleToggleFlowLive}
                className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition cursor-pointer flex items-center gap-1 border ${
                  isFlowWindowOpen
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30 shadow-sm'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white hover:bg-slate-800'
                }`}
                title="Bật/Tắt cửa sổ Google Flow để quan sát AI tạo ảnh & video trực tiếp"
              >
                {isFlowWindowOpen ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                <span>{isFlowWindowOpen ? 'Ẩn Flow' : 'Xem Flow Live'}</span>
              </button>
            </div>
            {session && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-brand-cyan">
                  {session.progress}%
                </span>
                {isRunning ? (
                  <button
                    type="button"
                    onClick={handleCancelCurrentRun}
                    className="rounded px-2.5 py-1 text-[11px] font-bold text-rose-300 bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800/60 transition cursor-pointer flex items-center gap-1 shadow-sm shadow-rose-950/40"
                    title="Hủy / Dừng tiến trình AI đang chạy mà không xóa dữ liệu"
                  >
                    <Square className="h-2.5 w-2.5 fill-current" />
                    <span>Hủy tiến trình</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleResumePipelineRun()}
                    className="rounded px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition cursor-pointer flex items-center gap-1 shadow-sm shadow-emerald-950/40"
                    title="Tiếp tục tiến trình từ bước này"
                  >
                    <Play className="h-2.5 w-2.5 fill-current" />
                    <span>Tiếp tục</span>
                  </button>
                )}
              </div>
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
                        onClick={handleCancelCurrentRun}
                        disabled={isApproving}
                        className="flex items-center gap-1 rounded-lg border border-rose-900/50 bg-rose-950/30 hover:bg-rose-900/50 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:text-rose-200 transition cursor-pointer"
                        title="Tạm dừng tiến trình"
                      >
                        <Square className="h-3 w-3 fill-current" />
                        <span>Tạm dừng</span>
                      </button>

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
                            <span>Tiếp tục (Duyệt)</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Banner khi tiến trình đã tạm dừng / hủy tiến trình */}
                {session.status === 'cancelled' && (
                  <div className="rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-slate-900/90 to-slate-950/90 p-4 shadow-xl animate-in fade-in duration-300">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400">
                        <PauseCircle className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/30">
                          ĐÃ TẠM DỪNG TIẾN TRÌNH
                        </span>
                        <h4 className="text-xs font-bold text-white mt-1">
                          Bước {session.currentStage}/8: {STAGES.find((s) => s.id === session.currentStage)?.name}
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Tiến trình đã dừng lại. Toàn bộ kịch bản và dữ liệu đã tạo được bảo lưu 100%. Bấm &quot;Tiếp tục&quot; để chạy tiếp.
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-end gap-2 flex-wrap">
                      {session.currentStage === 6 ? (
                        <>
                          {selectedShotIds.length > 0 && (
                            <button
                              type="button"
                              onClick={() => handleResumePipelineRun(null, 'regenerate_selected')}
                              className="flex items-center gap-1 rounded-lg border border-amber-600/60 bg-amber-950/60 hover:bg-amber-900/80 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:text-white transition cursor-pointer"
                              title={`Chạy lại tạo mới phiên bản cho ${selectedShotIds.length} shot đã chọn`}
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>Chạy lại đã chọn ({selectedShotIds.length})</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleResumePipelineRun(null, 'regenerate_all')}
                            className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
                            title="Tạo phiên bản mới cho toàn bộ storyboard qua Flow (bảo toàn file cũ)"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>Chạy lại toàn bộ</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleResumePipelineRun(null, 'resume_missing')}
                            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 px-4 py-1.5 text-xs font-bold text-white shadow-md transition active:scale-95 cursor-pointer"
                            title="Chỉ tạo các phân cảnh còn thiếu, giữ nguyên phân cảnh đã có"
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>Tiếp tục (chỉ phần thiếu) ▸</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={handleRetryCurrentStage}
                            className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>Chạy lại bước này</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleResumePipelineRun()}
                            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 px-4 py-1.5 text-xs font-bold text-white shadow-md transition active:scale-95 cursor-pointer"
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>Tiếp tục chạy ▸</span>
                          </button>
                        </>
                      )}
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
                          src={toMediaUrl(session.artifacts.audioPath)}
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
                          src={toMediaUrl(session.artifacts.videoPath)}
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

      {/* Modal Xác nhận Xoá Video / Đặt lại Phiên */}
      {isConfirmCancelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0B1120] p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Xác nhận xoá video khỏi phiên</h3>
                <p className="text-xs text-slate-400">Thao tác này sẽ đặt lại tiến trình của tập này</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/60 p-3 rounded-xl border border-slate-800/80">
              Bạn có chắc chắn muốn xoá video của ý tưởng{' '}
              <strong className="text-white">&ldquo;{session?.topic || 'này'}&rdquo;</strong> không?
              Kịch bản và các tài nguyên của video này sẽ được xóa để làm lại từ đầu.
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsConfirmCancelOpen(false)}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                Không, giữ lại
              </button>
              <button
                type="button"
                onClick={handleClearSession}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-rose-900/40 transition active:scale-95 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Xác nhận Xoá</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Cảnh báo Xung Đột Phiên Làm Việc (Tránh vô tình bấm đè mất kịch bản cũ) */}
      {conflictWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl border border-amber-500/40 bg-[#0B1120] p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Đang có phiên làm việc dở dang</h3>
                <p className="text-xs text-amber-300/80">Kịch bản trước đó đã được tạo hoặc đang xử lý</p>
              </div>
            </div>

            <div className="text-xs text-slate-300 space-y-2 leading-relaxed bg-slate-900/80 p-3.5 rounded-xl border border-slate-800">
              <p>
                Phiên làm việc hiện tại: <strong className="text-amber-300">&ldquo;{session?.topic}&rdquo;</strong>
                {session?.artifacts?.scriptLines && session.artifacts.scriptLines.length > 0 && (
                  <span className="block text-[11px] text-slate-400 mt-0.5">
                    (Đã có {session.artifacts.scriptLines.length} phân cảnh kịch bản)
                  </span>
                )}
              </p>
              <p className="text-slate-400">
                Bạn vừa bấm sản xuất ý tưởng mới: <strong className="text-white">&ldquo;{conflictWarningModal.pendingBlueprint.title}&rdquo;</strong>.
                Nếu bắt đầu mới, toàn bộ kịch bản và tiến trình của phiên cũ sẽ bị thay thế.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConflictWarningModal(null)}
                className="rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                Đóng
              </button>

              <button
                type="button"
                onClick={async () => {
                  const pending = conflictWarningModal.pendingBlueprint;
                  await handleClearSession();
                  await handleStartWithBlueprint(pending);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-900/60 bg-rose-950/40 hover:bg-rose-900/60 px-3.5 py-2 text-xs font-bold text-rose-300 hover:text-rose-100 transition active:scale-95 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Xoá phiên cũ &amp; Bắt đầu mới</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setConflictWarningModal(null);
                  handleResumeSession();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:brightness-110 px-4 py-2 text-xs font-bold text-white shadow-md active:scale-95 transition cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 fill-white" />
                <span>Tiếp tục phiên hiện tại</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL LIGHTBOX XEM TRƯỚC MEDIA (ẢNH / VIDEO PHÓNG TO CHI TIẾT)         */}
      {/* ==================================================================== */}
      {previewMedia && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 md:p-8 animate-in fade-in duration-200"
          onClick={() => setPreviewMedia(null)}
        >
          <div
            className="relative w-full max-w-5xl max-h-[92vh] flex flex-col rounded-3xl border border-slate-700/80 bg-[#0B1120] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800 bg-[#080D1A]/90 shrink-0">
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-cyan-500/20 px-3 py-1 text-xs font-bold text-cyan-300 border border-cyan-500/30">
                  {previewMedia.type === 'video' ? '📹 Video Preview' : '🖼️ Image Preview'}
                </span>
                {previewMedia.shotId && (
                  <span className="font-mono text-xs font-bold text-white">
                    {previewMedia.shotId}
                  </span>
                )}
                {previewMedia.durationMs && (
                  <span className="text-xs text-slate-400">
                    Thời lượng: {Math.round(previewMedia.durationMs / 1000)}s
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenFolder(previewMedia.url)}
                  className="rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:text-white transition cursor-pointer flex items-center gap-1.5"
                  title="Mở thư mục chứa tệp trong File Explorer"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>Mở tệp</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMedia(null)}
                  className="rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-rose-950/60 hover:border-rose-700/60 p-1.5 text-slate-400 hover:text-rose-300 transition cursor-pointer"
                  title="Đóng (ESC)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Modal Media Body */}
            <div className="flex-1 min-h-0 bg-black flex items-center justify-center p-4 overflow-hidden relative">
              {previewMedia.type === 'video' ? (
                <video
                  src={toMediaUrl(previewMedia.url)}
                  controls
                  autoPlay
                  className="max-h-[60vh] max-w-full rounded-xl object-contain shadow-2xl"
                />
              ) : (
                <img
                  src={toMediaUrl(previewMedia.url)}
                  alt="Media Preview"
                  className="max-h-[60vh] max-w-full rounded-xl object-contain shadow-2xl transition-transform duration-300 hover:scale-102"
                />
              )}
            </div>

            {/* Modal Footer Info */}
            <div className="px-6 py-4 border-t border-slate-800 bg-[#080D1A]/95 space-y-2 shrink-0 max-h-48 overflow-y-auto custom-scrollbar">
              {previewMedia.narration && (
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Lời thoại:
                  </span>
                  <p className="text-white font-medium text-xs leading-relaxed mt-0.5">
                    {previewMedia.narration}
                  </p>
                </div>
              )}

              {previewMedia.prompt && (
                <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-semibold text-slate-300 flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-amber-400" /> Prompt Flow:
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(previewMedia.prompt || '');
                      }}
                      className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 text-[10px] cursor-pointer"
                    >
                      <Copy className="h-2.5 w-2.5" /> Sao chép prompt
                    </button>
                  </div>
                  <p className="text-slate-300 italic font-mono text-[11px] leading-relaxed break-words max-h-20 overflow-y-auto custom-scrollbar">
                    {previewMedia.prompt}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
