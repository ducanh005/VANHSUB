import React, { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import {
  CheckCircle2,
  CircleHelp,
  Cpu,
  FileUp,
  FileVideo,
  Film,
  FolderOpen,
  Keyboard,
  Layers,
  Link2,
  Loader2,
  MessageSquareText,
  Mic,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Subtitles,
  Trash2,
  UploadCloud,
  Zap,
  Workflow,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import type { Task, WorkflowType } from '../types/task';
import { t, formatTimeAgo as formatTimeAgoHelper } from '../lib/i18n';
import SubtitleEditor from '../components/SubtitleEditor';
import ASRWorkspace from '../components/ASRWorkspace';
import TTSPage from '../components/TTSPage';
import ExportPage from '../components/ExportPage';
import SettingsPage from '../components/SettingsPage';
import TerminalPanel from '../components/TerminalPanel';
import OnboardingModal from '../components/OnboardingModal';

const WorkflowCanvas = dynamic(
  () => import('../components/workflow/WorkflowCanvas'),
  { ssr: false }
);

type NavItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
};

const getNavItems = (): NavItem[] => [
  { id: 'home', label: t('sidebar.home'), icon: Film },
  { id: 'workflow', label: 'Workflow AI', icon: Workflow, badge: 'MỚI' },
  { id: 'subtitles', label: t('sidebar.subtitles'), icon: Subtitles },
  { id: 'editor', label: t('sidebar.editor'), icon: MessageSquareText },
  { id: 'dubbing', label: t('sidebar.dubbing'), icon: Mic },
  { id: 'export', label: t('sidebar.export'), icon: Layers },
  { id: 'settings', label: t('sidebar.settings'), icon: Settings },
];

type ShortcutItem = {
  id: string;
  label: string;
  shortcut: string;
};

const SHORTCUTS: ShortcutItem[] = [
  { id: 'search', label: 'Tìm kiếm nhanh', shortcut: 'Ctrl + K' },
  { id: 'new', label: 'Tạo phụ đề mới', shortcut: 'Ctrl + N' },
  { id: 'editor', label: 'Mở trang hiệu đính', shortcut: 'Ctrl + E' },
  { id: 'settings', label: t('sidebar.settings'), shortcut: 'Ctrl + ,' },
];

// Dùng i18n helper thay vì function riêng

export default function HomePage() {
  const [activeTab, setActiveTab] = useState('home');
  const [greeting, setGreeting] = useState(t('home.greeting_evening'));
  const [currentDateStr, setCurrentDateStr] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [downloadingLink, setDownloadingLink] = useState(false);
  const [linkMessage, setLinkMessage] = useState('');
  const [linkError, setLinkError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [asrModel, setAsrModel] = useState('base');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);
  // Popup hướng dẫn người dùng mới: hiện lần đầu mở app, mở lại được bằng nút (?)
  const [showGuide, setShowGuide] = useState(false);
  const [guideReady, setGuideReady] = useState(false);

  const handleCloseGuide = (dontShowAgain: boolean) => {
    setShowGuide(false);
    if (dontShowAgain && typeof window !== 'undefined' && window.vanhsub?.settings) {
      window.vanhsub.settings.set('onboardingCompleted', true).catch(() => {});
    }
  };

  const loadTasks = useCallback(async () => {
    if (typeof window !== 'undefined' && window.vanhsub?.tasks) {
      try {
        const loadedTasks = await window.vanhsub.tasks.getAll();
        setTasks(loadedTasks || []);
      } catch (err) {
        console.error('Lỗi khi tải danh sách task:', err);
      }
    }
  }, []);

  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    if (hour >= 5 && hour < 12) {
      setGreeting(t('home.greeting_morning'));
    } else if (hour >= 12 && hour < 18) {
      setGreeting(t('home.greeting_afternoon'));
    } else {
      setGreeting(t('home.greeting_evening'));
    }

    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };
    setCurrentDateStr(now.toLocaleDateString('vi-VN', options));

    loadTasks();

    // Model ASR đang đặt trong Cài đặt (hiển thị ở widget AI Engine + Cấu hình mô hình)
    if (typeof window !== 'undefined' && window.vanhsub?.settings) {
      window.vanhsub.settings
        .get('asrModel')
        .then((v: string) => {
          if (v) setAsrModel(String(v));
        })
        .catch(() => {});

      // Popup hướng dẫn: chỉ hiện nếu người dùng chưa xem lần nào
      window.vanhsub.settings
        .get('onboardingCompleted')
        .then((v: boolean) => {
          setShowGuide(!v);
          setGuideReady(true);
        })
        .catch((err) => {
          console.log('Không đọc được onboardingCompleted, hiện hướng dẫn:', err);
          setShowGuide(true);
          setGuideReady(true);
        });
    }

    if (typeof window !== 'undefined' && window.vanhsub?.tasks?.onUpdate) {
      const unsubscribe = window.vanhsub.tasks.onUpdate((updatedTasks) => {
        setTasks(updatedTasks || []);
      });
      return () => unsubscribe();
    }
  }, [loadTasks]);

  const handleSelectFiles = useCallback(async (workflow: WorkflowType = 'fast-transcribe') => {
    if (typeof window === 'undefined' || !window.vanhsub?.dialog) return;

    try {
      const filePaths = await window.vanhsub.dialog.openMediaFile();
      if (!filePaths || filePaths.length === 0) return;

      for (const filePath of filePaths) {
        const fileName = filePath.split(/[/\\]/).pop() || 'media_file';
        await window.vanhsub.tasks.create({
          fileName,
          filePath,
          workflow,
          status: 'queued',
          progress: 0,
          stageDescription: 'Đã sẵn sàng phiên âm',
        });
      }
    } catch (err) {
      console.error('Lỗi khi chọn file:', err);
    }
  }, []);

  const handleShortcutAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'search':
          setActiveTab('home');
          setTimeout(() => {
            searchInputRef.current?.focus();
            searchInputRef.current?.select();
          }, 50);
          break;
        case 'new':
          handleSelectFiles('fast-transcribe');
          break;
        case 'editor':
          setActiveTab('editor');
          break;
        case 'settings':
          setActiveTab('settings');
          break;
      }
    },
    [handleSelectFiles]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (!isCtrlOrMeta) return;

      const key = e.key?.toLowerCase();
      const code = e.code;

      // Ctrl + K: Tìm kiếm nhanh
      if (key === 'k' || code === 'KeyK') {
        e.preventDefault();
        handleShortcutAction('search');
        return;
      }

      // Ctrl + N: Tạo tác vụ mới
      if (key === 'n' || code === 'KeyN') {
        e.preventDefault();
        handleShortcutAction('new');
        return;
      }

      // Ctrl + E: Mở trang hiệu đính
      if (key === 'e' || code === 'KeyE') {
        e.preventDefault();
        handleShortcutAction('editor');
        return;
      }

      // Ctrl + ,: Mở cài đặt
      if (key === ',' || code === 'Comma') {
        e.preventDefault();
        handleShortcutAction('settings');
        return;
      }

      // Ctrl + B: Thu gọn / Mở rộng Sidebar điều hướng
      if (key === 'b' || code === 'KeyB') {
        e.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleShortcutAction]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        // Electron >=32 đã bỏ File.path — lấy đường dẫn qua webUtils ở preload
        const filePath =
          window.vanhsub?.files?.getPath?.(file) || (file as any).path || '';
        if (!filePath || (!filePath.includes('/') && !filePath.includes('\\'))) {
          console.warn('Bỏ qua file không lấy được đường dẫn:', file.name);
          continue;
        }
        const fileName = file.name;
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1) + ' MB';

        if (window.vanhsub?.tasks) {
          await window.vanhsub.tasks.create({
            fileName,
            filePath,
            fileSize: sizeMb,
            workflow: 'fast-transcribe',
            status: 'queued',
            progress: 0,
            stageDescription: 'Đã thêm từ kéo thả',
          });
        }
      }
    }
  };

  const handleDeleteTask = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.vanhsub?.tasks) {
      await window.vanhsub.tasks.delete(id);
    }
  };
  const handleStartTask = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.vanhsub?.tasks) {
      await window.vanhsub.tasks.start(id);
    }
  };

  const handleShowInFolder = (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.vanhsub?.dialog) {
      window.vanhsub.dialog.showInFolder(filePath);
    }
  };

  // Nhập file .srt có sẵn cho task (video đã có phụ đề nước ngoài — bỏ qua phiên âm)
  // Tải audio từ link video công khai (TikTok/YouTube) và tạo tác vụ mới
  const handleAddFromUrl = async () => {
    const url = linkUrl.trim();
    if (!url || downloadingLink) return;
    if (typeof window === 'undefined' || !window.vanhsub?.tasks?.addFromUrl) return;

    setDownloadingLink(true);
    setLinkMessage('');
    setLinkError(false);
    try {
      const res = await window.vanhsub.tasks.addFromUrl(url);
      if (res?.error) {
        setLinkError(true);
        setLinkMessage(res.error);
        return;
      }
      setLinkUrl('');
      setLinkMessage('Đã tải xong và tạo tác vụ — bấm "Bắt đầu phiên âm" trên thẻ tác vụ.');
      await loadTasks();
    } catch (err: any) {
      setLinkError(true);
      setLinkMessage(err?.message || 'Không thể tải audio từ link.');
    } finally {
      setDownloadingLink(false);
    }
  };

  // Chạy cả quy trình còn thiếu (phiên âm → dịch → giọng → ghép)
  const handleRunPipeline = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof window === 'undefined' || !window.vanhsub?.tasks?.runPipeline) return;
    try {
      await window.vanhsub.tasks.runPipeline(id);
    } catch (err) {
      console.error('Lỗi khi chạy quy trình:', err);
    }
  };

  // Các task còn việc để chạy pipeline: chưa chạy dở, và chưa có video output
  const tasksNeedingPipeline = tasks.filter(
    (t) =>
      !['transcribing', 'ocr', 'translating', 'dubbing', 'exporting'].includes(t.status) &&
      !(t.status === 'done' && t.outputPath)
  );

  // Batch: enqueue tất cả task còn việc — main process tự điều phối tối đa
  // 2 pipeline song song qua hàng đợi
  const handleRunPipelineBatch = async () => {
    if (tasksNeedingPipeline.length === 0) return;
    if (typeof window === 'undefined' || !window.vanhsub?.tasks?.runPipelineBatch) return;
    try {
      await window.vanhsub.tasks.runPipelineBatch(tasksNeedingPipeline.map((t) => t.id));
    } catch (err) {
      console.error('Lỗi khi chạy batch:', err);
    }
  };

  const handleImportSrt = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof window === 'undefined' || !window.vanhsub?.dialog?.openSrtFile) return;
    try {
      const srtPath = await window.vanhsub.dialog.openSrtFile();
      if (!srtPath) return;
      await window.vanhsub.tasks.importSrt(id, srtPath);
    } catch (err) {
      console.error('Lỗi khi nhập SRT:', err);
    }
  };

  const filteredTasks = tasks.filter((t) =>
    t.fileName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const completedCount = tasks.filter((t) => t.status === 'done').length;

  return (
    <>
      <Head>
        <title>VANHSUB — Studio Phụ Đề & Lồng Tiếng AI</title>
      </Head>

      <div className="flex h-screen overflow-hidden bg-[#080D1A] text-slate-100 antialiased select-none">
        {/* =========================================================================
            SIDEBAR ĐIỀU HƯỚNG
            ========================================================================= */}
        <aside
          className={`flex flex-col justify-between border-r border-slate-800/80 bg-[#0B1120] transition-all duration-300 ease-in-out select-none ${
            isZenMode && activeTab === 'workflow'
              ? 'w-0 border-r-0 p-0 overflow-hidden opacity-0 pointer-events-none'
              : isSidebarCollapsed
              ? 'w-[68px] px-2 py-4'
              : 'w-[240px] px-4 py-5'
          }`}
        >
          <div>
            {/* Logo & Collapse Toggle */}
            <div className={`mb-6 flex items-center ${isSidebarCollapsed ? 'flex-col gap-3 justify-center' : 'justify-between px-1'}`}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-cyan via-brand-indigo to-brand-rose p-0.5 shadow-lg shadow-brand-indigo/30">
                  <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-[#0B1120]">
                    <Sparkles className="h-5 w-5 text-brand-cyan" />
                  </div>
                </div>
                {!isSidebarCollapsed && (
                  <div className="min-w-0">
                    <div className="text-base font-bold tracking-tight text-white flex items-center gap-1.5 truncate">
                      VANHSUB
                      <span className="rounded-full bg-brand-indigo/20 px-1.5 py-0.5 text-[9px] font-semibold text-brand-cyan border border-brand-cyan/30">
                        AI PRO
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">Studio Phụ đề & Voice</div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
                title={isSidebarCollapsed ? 'Mở rộng thanh điều hướng (Ctrl + B)' : 'Thu gọn thanh điều hướng (Ctrl + B)'}
              >
                {isSidebarCollapsed ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </button>
            </div>

            {/* Menu chính */}
            <nav className="space-y-1">
              {getNavItems().map(({ id, label, icon: Icon, badge }) => {
                const active = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    title={isSidebarCollapsed ? label : undefined}
                    className={[
                      'group flex w-full items-center rounded-xl transition-all duration-200 relative cursor-pointer',
                      isSidebarCollapsed
                        ? 'justify-center p-2.5'
                        : 'justify-between px-3.5 py-2.5 text-left text-sm font-medium',
                      active
                        ? 'bg-gradient-to-r from-brand-indigo/25 to-brand-cyan/15 text-white border border-brand-indigo/40 shadow-sm'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
                    ].join(' ')}
                  >
                    <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-3'}`}>
                      <Icon
                        className={[
                          'h-4 w-4 transition-colors shrink-0',
                          active ? 'text-brand-cyan' : 'text-slate-400 group-hover:text-slate-200',
                        ].join(' ')}
                      />
                      {!isSidebarCollapsed && <span>{label}</span>}
                    </div>
                    {badge && (
                      isSidebarCollapsed ? (
                        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand-rose animate-pulse" />
                      ) : (
                        <span className="rounded-full bg-brand-rose/20 px-1.5 py-0.5 text-[10px] font-semibold text-brand-rose">
                          {badge}
                        </span>
                      )
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Widget Trạng thái AI Engine ở góc dưới */}
          {isSidebarCollapsed ? (
            <div
              className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-slate-800 bg-slate-900/60 text-slate-400 hover:text-brand-cyan transition-colors cursor-pointer"
              title={`AI Core Engine: Hoạt động\nASR: Whisper ${asrModel}\nTranslate: Gemini Flash\nTTS: VietTTS Local`}
            >
              <Cpu className="h-4 w-4 text-brand-cyan" />
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3.5 backdrop-blur-sm">
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="h-3.5 w-3.5 text-brand-cyan" />
                  <span className="text-xs font-semibold text-slate-200">AI Core Engine</span>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Hoạt động
                </span>
              </div>
              <div className="space-y-1.5 text-[11px] text-slate-400">
                <div className="flex items-center justify-between">
                  <span>ASR Model</span>
                  <span className="font-mono text-slate-300">Whisper {asrModel}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Translate</span>
                  <span className="font-mono text-brand-cyan">Gemini Flash API</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>TTS Voice</span>
                  <span className="font-mono text-slate-300">VietTTS Local</span>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* =========================================================================
            MAIN CONTENT AREA
            ========================================================================= */}
        <main className="flex flex-1 flex-col overflow-hidden bg-[#080D1A]">
          {/* Header (Ẩn khi ở Workflow Mode để Canvas chiếm trọn không gian màn hình) */}
          {activeTab !== 'workflow' && (
            <header className="flex h-16 items-center justify-between border-b border-slate-800/80 bg-[#0B1120]/80 px-6 backdrop-blur-md">
              <div className="flex flex-1 items-center gap-4">
                <h2 className="text-lg font-semibold text-white tracking-tight">Studio Trang chủ</h2>

                {/* Universal Search bar */}
                <div className="flex flex-1 items-center justify-center px-4">
                  <div className="flex w-full max-w-lg items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/80 px-3.5 py-2 text-slate-400 transition focus-within:border-brand-indigo/60 focus-within:ring-1 focus-within:ring-brand-indigo/60">
                    <Search className="h-4 w-4 text-slate-400" />
                    <input
                      ref={searchInputRef}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Tìm kiếm tác vụ, phụ đề, tên video..."
                      className="w-full bg-transparent text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
                    />
                    <kbd className="rounded-md border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                      Ctrl K
                    </kbd>
                  </div>
                </div>
              </div>

              {/* Header Right Actions */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowGuide(true)}
                  title="Hướng dẫn sử dụng — quy trình 5 bước cho người mới"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/80 text-slate-400 transition hover:border-brand-cyan/50 hover:text-brand-cyan cursor-pointer"
                >
                  <CircleHelp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectFiles('fast-transcribe')}
                  className="btn-vanh-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>Thêm tác vụ mới</span>
                </button>
              </div>
            </header>
          )}

          {/* Body Dashboard (2 Columns)
              Các tab luôn mounted, chỉ ẩn bằng CSS — giữ nguyên trạng thái
              (audio đang nghe thử, panel mở, dữ liệu đã tải) khi chuyển tab */}
          <div className={activeTab === 'workflow' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
            <WorkflowCanvas
              onNavigateTab={setActiveTab}
              isZenMode={isZenMode}
              onToggleZenMode={setIsZenMode}
              isSidebarCollapsed={isSidebarCollapsed}
              onToggleSidebar={() => setIsSidebarCollapsed((p) => !p)}
            />
          </div>
          <div className={activeTab === 'editor' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
            <SubtitleEditor
              tasks={tasks}
              selectedTaskId={selectedTaskId}
              onSelectTaskId={setSelectedTaskId}
              onNavigateTab={setActiveTab}
              isActive={activeTab === 'editor'}
            />
          </div>
          <div className={activeTab === 'dubbing' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
            <TTSPage tasks={tasks} />
          </div>
          <div className={activeTab === 'export' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
            <ExportPage tasks={tasks} />
          </div>
          <div className={activeTab === 'settings' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
            <SettingsPage />
          </div>
          <div
            className={
              activeTab === 'subtitles'
                ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
                : 'hidden'
            }
          >
            <ASRWorkspace tasks={tasks} />
          </div>

          <div
            className={
              activeTab === 'home'
                ? 'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_330px] gap-5 overflow-hidden p-6'
                : 'hidden'
            }
          >
            {/* Cột Trái: Drag & Drop & Recent Tasks */}
            <section className="flex flex-col gap-5 overflow-y-auto pr-1">
              {/* Lời chào Hero */}
              <div className="flex items-end justify-between rounded-3xl border border-slate-800/80 bg-gradient-to-r from-slate-900/80 via-[#0F172A]/90 to-slate-900/80 p-5 backdrop-blur-sm">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-brand-indigo/30 bg-brand-indigo/10 px-3 py-1 text-[11px] font-medium text-brand-cyan">
                    <Sparkles className="h-3 w-3" />
                    <span>VANHSUB Studio 2026</span>
                  </div>
                  <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">
                    {greeting}, bắt đầu dự án mới nào!
                  </h1>
                  <p className="mt-1 text-xs text-slate-400">
                    {currentDateStr} · Sẵn sàng tự động hoá quy trình phụ đề và lồng tiếng tiếng Việt
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-300">
                    <strong className="text-brand-cyan font-bold">{tasks.length}</strong> Tác vụ
                  </span>
                  <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400">
                    <strong className="font-bold">{completedCount}</strong> Đã hoàn thành
                  </span>
                </div>
              </div>

              {/* Drag & Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={[
                  'relative flex flex-col items-center justify-center rounded-3xl border-2 border-dashed p-7 text-center transition-all duration-300',
                  isDragging
                    ? 'border-brand-cyan bg-brand-cyan/10 scale-[1.01]'
                    : 'border-slate-800/90 bg-slate-900/40 hover:border-brand-indigo/50 hover:bg-slate-900/60',
                ].join(' ')}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-cyan/20 via-brand-indigo/20 to-brand-rose/20 text-brand-cyan border border-brand-indigo/30 shadow-inner">
                  <UploadCloud className="h-7 w-7 animate-bounce" />
                </div>
                <h3 className="mt-3.5 text-sm font-semibold text-white">
                  Kéo thả file Video hoặc Audio vào đây
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Hỗ trợ MP4, MKV, AVI, MOV, MP3, WAV (Tối đa 2GB) · Tự động phát hiện ngôn ngữ & ASR
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleSelectFiles('fast-transcribe')}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-700 hover:text-white cursor-pointer"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-brand-cyan" />
                    <span>Duyệt file từ máy tính</span>
                  </button>
                </div>

                {/* Thêm tác vụ từ link video công khai (TikTok/YouTube…) */}
                <div className="mt-3 flex w-full max-w-md items-center gap-2">
                  <input
                    type="text"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !downloadingLink) handleAddFromUrl();
                    }}
                    placeholder="Hoặc dán link TikTok/YouTube…"
                    className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-white placeholder:text-slate-500 focus:border-brand-cyan focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddFromUrl}
                    disabled={downloadingLink || !linkUrl.trim()}
                    title="Tải audio từ link bằng yt-dlp (lần đầu tự tải yt-dlp ~18MB) rồi tạo tác vụ"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-brand-cyan/40 bg-brand-cyan/10 px-3 py-2 text-xs font-semibold text-brand-cyan hover:bg-brand-cyan/20 cursor-pointer disabled:opacity-50"
                  >
                    {downloadingLink ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5" />
                    )}
                    <span>{downloadingLink ? 'Đang tải...' : 'Tải & Tạo task'}</span>
                  </button>
                </div>
                {linkMessage && (
                  <p className={`mt-2 text-[11px] ${linkError ? 'text-rose-400' : 'text-brand-cyan'}`}>
                    {linkMessage}
                  </p>
                )}
              </div>

              {/* Recent Tasks List */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="mb-3.5 flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">Tác vụ gần đây</h3>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                      {filteredTasks.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {tasksNeedingPipeline.length > 0 && (
                      <button
                        type="button"
                        onClick={handleRunPipelineBatch}
                        title="Đưa tất cả tác vụ còn việc vào hàng đợi — chạy tối đa 2 tác vụ song song"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-brand-indigo/40 bg-brand-indigo/10 px-2.5 py-1 text-[11px] font-semibold text-brand-indigo hover:bg-brand-indigo/20 cursor-pointer"
                      >
                        <Zap className="h-3 w-3" />
                        <span>Chạy batch ({tasksNeedingPipeline.length})</span>
                      </button>
                    )}
                    {tasks.length > 0 && (
                    <button
                      type="button"
                      onClick={loadTasks}
                      className="text-xs font-medium text-brand-cyan hover:text-brand-cyan/80 transition flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Làm mới</span>
                    </button>
                    )}
                  </div>
                </div>

                {filteredTasks.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-800/80 p-8 text-center text-slate-500 text-xs">
                    Chưa có tác vụ nào. Hãy kéo thả video hoặc bấm nút thêm tác vụ để bắt đầu!
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredTasks.map((t) => (
                      <div
                        key={t.id}
                        className="group flex items-center justify-between rounded-2xl border border-slate-800/80 bg-slate-900/80 p-3 text-xs transition hover:border-slate-700 hover:bg-slate-850"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-brand-cyan">
                            <FileVideo className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-slate-200 group-hover:text-white">
                              {t.fileName}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                              <span>{t.fileSize || 'Media file'}</span>
                              <span>•</span>
                              <span>{formatTimeAgoHelper(t.createdAt)}</span>
                              <span>•</span>
                              <span className="text-slate-300 font-mono">{t.workflow}</span>
                            </div>
                          </div>
                        </div>

                        {/* Trạng thái / Tiến trình */}
                        <div className="flex items-center gap-3 shrink-0 pl-3">
                          {t.status === 'done' && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" />
                              Đã hoàn thành
                            </span>
                          )}
                          {t.status === 'queued' && !t.srtPath && (
                            <button
                              type="button"
                              onClick={(e) => handleImportSrt(t.id, e)}
                              title="Video đã có phụ đề .srt? Nhập vào để bỏ qua bước phiên âm"
                              className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer"
                            >
                              <FileUp className="h-3 w-3" />
                              Nhập SRT
                            </button>
                          )}
                          {t.status === 'queued' && (
                            <button
                              type="button"
                              onClick={(e) => handleStartTask(t.id, e)}
                              className="inline-flex items-center gap-1.5 rounded-full border border-brand-cyan/30 bg-brand-cyan/10 px-2.5 py-1 text-[11px] font-medium text-brand-cyan hover:bg-brand-cyan/20 transition cursor-pointer"
                            >
                              <Play className="h-3 w-3 fill-brand-cyan" />
                              Bắt đầu phiên âm
                            </button>
                          )}
                          {t.status === 'error' && (
                            <button
                              type="button"
                              onClick={(e) => handleStartTask(t.id, e)}
                              className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-400 hover:bg-rose-500/20 transition cursor-pointer"
                              title={t.errorMessage || 'Lỗi xử lý'}
                            >
                              <RefreshCw className="h-3 w-3" />
                              Thử lại
                            </button>
                          )}
                          {t.status === 'cancelled' && (
                            <button
                              type="button"
                              onClick={(e) => handleStartTask(t.id, e)}
                              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-400 hover:bg-amber-500/20 transition cursor-pointer"
                              title="Tác vụ đã bị huỷ — bấm để chạy lại"
                            >
                              <Play className="h-3 w-3 fill-amber-400" />
                              Chạy lại
                            </button>
                          )}
                          {(t.status === 'queued' || t.status === 'done' || t.status === 'error' || t.status === 'cancelled') && (
                            <button
                              type="button"
                              onClick={(e) => handleRunPipeline(t.id, e)}
                              title="Tự động chạy các bước còn thiếu: phiên âm → dịch → tạo giọng → ghép video (bỏ qua bước đã có kết quả)"
                              className="inline-flex items-center gap-1.5 rounded-full border border-brand-indigo/40 bg-brand-indigo/10 px-2.5 py-1 text-[11px] font-medium text-brand-indigo hover:bg-brand-indigo/20 transition cursor-pointer"
                            >
                              <Zap className="h-3 w-3" />
                              Chạy cả quy trình
                            </button>
                          )}
                          {(t.status === 'transcribing' || t.status === 'ocr' || t.status === 'translating' || t.status === 'exporting' || t.status === 'dubbing') && (
                            <div className="flex items-center gap-2">
                              <div className="w-20 rounded-full bg-slate-800 h-1.5 overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-brand-cyan to-brand-indigo rounded-full transition-all duration-300"
                                  style={{ width: `${t.progress}%` }}
                                />
                              </div>
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-cyan">
                                <RefreshCw className="h-3 w-3 animate-spin" />
                                {t.progress}%
                              </span>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={(e) => handleShowInFolder(t.filePath, e)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition cursor-pointer"
                            title="Mở thư mục chứa file"
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => handleDeleteTask(t.id, e)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 hover:border-rose-500/40 transition cursor-pointer"
                            title="Xoá tác vụ"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Cột Phải: Tool Matrix & Quick Utilities */}
            <aside className="flex flex-col gap-4 overflow-y-auto">
              {/* AI Engine Matrix Box */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Cấu hình mô hình
                  </span>
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                    Sẵn sàng
                  </span>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between rounded-xl border border-slate-800/60 bg-slate-900/80 p-2.5">
                    <span className="text-slate-300">Nhận diện ASR</span>
                    <span className="font-medium text-white">Whisper {asrModel}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-slate-800/60 bg-slate-900/80 p-2.5">
                    <span className="text-slate-300">Dịch thuật</span>
                    <span className="font-medium text-brand-cyan">Gemini Flash API</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-slate-800/60 bg-slate-900/80 p-2.5">
                    <span className="text-slate-300">Lồng tiếng TTS</span>
                    <span className="font-medium text-brand-rose">VietTTS Studio</span>
                  </div>
                </div>
              </div>

              {/* Quick Shortcuts */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                    <Keyboard className="h-3.5 w-3.5 text-brand-indigo" />
                    <span>Phím tắt tiện ích</span>
                  </div>
                  <span className="text-[10px] text-slate-500">Bấm hoặc gõ phím</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  {SHORTCUTS.map(({ id, label, shortcut }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleShortcutAction(id)}
                      className="group flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-slate-300 transition hover:bg-slate-800/80 hover:text-white cursor-pointer"
                      title={`Bấm để kích hoạt (${shortcut})`}
                    >
                      <span className="text-[11px] transition-colors group-hover:text-brand-cyan">
                        {label}
                      </span>
                      <kbd className="rounded-md border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] font-mono text-slate-400 transition group-hover:border-brand-indigo/50 group-hover:text-slate-200">
                        {shortcut}
                      </kbd>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </div>

          {/* Terminal mini: log tiến trình ASR/dịch/TTS/export — nằm ngoài các tab
              nên luôn hiển thị và giữ nguyên nội dung khi chuyển tab */}
          <TerminalPanel />

          {/* Popup hướng dẫn người dùng mới (portal, hiện lần đầu mở app) */}
          <OnboardingModal open={guideReady && showGuide} onClose={handleCloseGuide} />
        </main>
      </div>
    </>
  );
}



