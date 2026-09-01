import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  FileVideo,
  Film,
  FolderOpen,
  Globe2,
  Keyboard,
  Layers,
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
  Volume2,
  Wand2,
  Zap,
} from 'lucide-react';
import type { Task, WorkflowType } from '../types/task';
import SubtitleEditor from '../components/SubtitleEditor';
import TranslatePage from '../components/TranslatePage';
import TTSPage from '../components/TTSPage';
import ExportPage from '../components/ExportPage';
import SettingsPage from '../components/SettingsPage';

type NavItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
};

const navItems: NavItem[] = [
  { id: 'home', label: 'Trang chủ', icon: Film },
  { id: 'subtitles', label: 'Phụ đề & ASR', icon: Subtitles },
  { id: 'editor', label: 'Hiệu đính phụ đề', icon: MessageSquareText },
  { id: 'translate', label: 'Dịch thuật AI', icon: Globe2 },
  { id: 'dubbing', label: 'Lồng tiếng TTS', icon: Mic },
  { id: 'export', label: 'Xuất video', icon: Layers },
  { id: 'settings', label: 'Cài đặt', icon: Settings },
];

const workflows = [
  {
    id: 'full-dubbing' as WorkflowType,
    title: 'Video → Lồng tiếng AI trọn gói',
    description: 'Phiên âm tiếng Việt, dịch thuật ngữ cảnh và lồng tiếng tự nhiên đồng bộ',
    tag: 'Quy trình đầy đủ',
    icon: Sparkles,
    gradient: 'from-brand-cyan/15 via-brand-indigo/15 to-brand-rose/15',
    borderGlow: 'hover:border-brand-indigo/50',
    models: ['PhoWhisper', 'Gemini 2.0', 'VietTTS'],
  },
  {
    id: 'bilingual-sub' as WorkflowType,
    title: 'Video → Phụ đề song ngữ',
    description: 'Tạo phụ đề gốc chuẩn xác và bản dịch song ngữ mượt mà với Gemini',
    tag: 'Phổ biến nhất',
    icon: Wand2,
    gradient: 'from-brand-cyan/20 to-brand-indigo/10',
    borderGlow: 'hover:border-brand-cyan/50',
    models: ['Whisper ASR', 'Gemini AI'],
  },
  {
    id: 'fast-transcribe' as WorkflowType,
    title: 'Video → Phụ đề gốc siêu tốc',
    description: 'Tách giọng nói thành phụ đề SRT/VTT độ chính xác cao cho tiếng Việt',
    tag: 'Tốc độ cao',
    icon: Zap,
    gradient: 'from-emerald-500/15 to-brand-cyan/10',
    borderGlow: 'hover:border-emerald-500/50',
    models: ['PhoWhisper Base'],
  },
];

const tools = [
  {
    label: 'Hiệu đính phụ đề',
    icon: MessageSquareText,
    detail: 'Xem trước video và chỉnh sửa timeline từng câu',
  },
  {
    label: 'Dịch thuật Gemini AI',
    icon: Globe2,
    detail: 'Dịch đa ngôn ngữ giữ nguyên context và thuật ngữ',
  },
  {
    label: 'Lồng tiếng VietTTS',
    icon: Volume2,
    detail: 'Tạo giọng đọc tiếng Việt truyền cảm, chuẩn ngữ điệu',
  },
  {
    label: 'Gắn phụ đề cứng (Burn Sub)',
    icon: Layers,
    detail: 'Render phụ đề ASS/SRT trực tiếp vào khung hình video',
  },
];

const shortcuts = [
  { label: 'Tìm kiếm nhanh', shortcut: 'Ctrl + K' },
  { label: 'Tạo phụ đề mới', shortcut: 'Ctrl + N' },
  { label: 'Mở trang hiệu đính', shortcut: 'Ctrl + E' },
  { label: 'Cài đặt hệ thống', shortcut: 'Ctrl + ,' },
];

function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return 'Vừa xong';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} giờ trước`;
    return date.toLocaleDateString('vi-VN');
  } catch {
    return 'Vừa xong';
  }
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState('home');
  const [greeting, setGreeting] = useState('Chào buổi tối');
  const [currentDateStr, setCurrentDateStr] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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
      setGreeting('Chào buổi sáng');
    } else if (hour >= 12 && hour < 18) {
      setGreeting('Chào buổi chiều');
    } else {
      setGreeting('Chào buổi tối');
    }

    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };
    setCurrentDateStr(now.toLocaleDateString('vi-VN', options));

    loadTasks();

    if (typeof window !== 'undefined' && window.vanhsub?.tasks?.onUpdate) {
      const unsubscribe = window.vanhsub.tasks.onUpdate((updatedTasks) => {
        setTasks(updatedTasks || []);
      });
      return () => unsubscribe();
    }
  }, [loadTasks]);

  const handleSelectFiles = async (workflow: WorkflowType = 'fast-transcribe') => {
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
  };

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
        const filePath = (file as any).path || file.name;
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
        <aside className="flex w-[240px] flex-col justify-between border-r border-slate-800/80 bg-[#0B1120] px-4 py-5">
          <div>
            {/* Logo */}
            <div className="mb-6 flex items-center gap-3 px-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-cyan via-brand-indigo to-brand-rose p-0.5 shadow-lg shadow-brand-indigo/30">
                <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-[#0B1120]">
                  <Sparkles className="h-5 w-5 text-brand-cyan" />
                </div>
              </div>
              <div>
                <div className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
                  VANHSUB
                  <span className="rounded-full bg-brand-indigo/20 px-1.5 py-0.5 text-[9px] font-semibold text-brand-cyan border border-brand-cyan/30">
                    AI PRO
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">Studio Phụ đề & Voice</div>
              </div>
            </div>

            {/* Menu chính */}
            <nav className="space-y-1">
              {navItems.map(({ id, label, icon: Icon, badge }) => {
                const active = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={[
                      'group flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-medium transition-all duration-200',
                      active
                        ? 'bg-gradient-to-r from-brand-indigo/25 to-brand-cyan/15 text-white border border-brand-indigo/40 shadow-sm'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
                    ].join(' ')}
                  >
                    <div className="flex items-center gap-3">
                      <Icon
                        className={[
                          'h-4 w-4 transition-colors',
                          active ? 'text-brand-cyan' : 'text-slate-400 group-hover:text-slate-200',
                        ].join(' ')}
                      />
                      <span>{label}</span>
                    </div>
                    {badge && (
                      <span className="rounded-full bg-brand-rose/20 px-1.5 py-0.5 text-[10px] font-semibold text-brand-rose">
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Widget Trạng thái AI Engine ở góc dưới */}
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
                <span className="font-mono text-slate-300">PhoWhisper v1</span>
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
        </aside>

        {/* =========================================================================
            MAIN CONTENT AREA
            ========================================================================= */}
        <main className="flex flex-1 flex-col overflow-hidden bg-[#080D1A]">
          {/* Header */}
          <header className="flex h-16 items-center justify-between border-b border-slate-800/80 bg-[#0B1120]/80 px-6 backdrop-blur-md">
            <div className="flex flex-1 items-center gap-4">
              <h2 className="text-lg font-semibold text-white tracking-tight">Studio Trang chủ</h2>

              {/* Universal Search bar */}
              <div className="flex flex-1 items-center justify-center px-4">
                <div className="flex w-full max-w-lg items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/80 px-3.5 py-2 text-slate-400 transition focus-within:border-brand-indigo/60 focus-within:ring-1 focus-within:ring-brand-indigo/60">
                  <Search className="h-4 w-4 text-slate-400" />
                  <input
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
                onClick={() => handleSelectFiles('fast-transcribe')}
                className="btn-vanh-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Thêm tác vụ mới</span>
              </button>
            </div>
          </header>

          {/* Body Dashboard (2 Columns) */}
          {activeTab === 'editor' ? (
            <SubtitleEditor tasks={tasks} />
          ) : activeTab === 'translate' ? (
            <TranslatePage tasks={tasks} />
          ) : activeTab === 'dubbing' ? (
            <TTSPage tasks={tasks} />
          ) : activeTab === 'export' ? (
            <ExportPage tasks={tasks} />
          ) : activeTab === 'settings' ? (
            <SettingsPage />
          ) : activeTab === 'subtitles' ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/70 text-brand-indigo">
                <Subtitles className="h-7 w-7" />
              </div>
              <h3 className="text-base font-semibold text-white">
                Phụ đề & ASR
              </h3>
              <p className="max-w-sm text-xs leading-relaxed text-slate-400">
                Tính năng đang được gộp vào Trang chủ và màn hình Hiệu đính. Màn hình riêng sẽ ra mắt ở Nhóm 3.
              </p>
              <span className="rounded-full border border-brand-indigo/30 bg-brand-indigo/10 px-3 py-1 text-[11px] font-medium text-brand-cyan">
                Sắp ra mắt
              </span>
            </div>
          ) : (

          <div className="grid flex-1 grid-cols-[minmax(0,1fr)_330px] gap-5 overflow-hidden p-6">
            {/* Cột Trái: Workflows & Recent Tasks */}
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

              {/* 3 Workflow Bento Cards */}
              <div className="grid gap-3.5 lg:grid-cols-3">
                {workflows.map((wf) => {
                  const Icon = wf.icon;
                  return (
                    <div
                      key={wf.id}
                      onClick={() => handleSelectFiles(wf.id)}
                      className={[
                        'group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 p-4 transition-all duration-300 card-glass-hover cursor-pointer',
                        wf.borderGlow,
                      ].join(' ')}
                    >
                      <div
                        className={`absolute -right-6 -top-6 h-28 w-28 rounded-full bg-gradient-to-br ${wf.gradient} blur-2xl transition-all group-hover:scale-125`}
                      />
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 text-brand-cyan border border-slate-700 shadow-md">
                            <Icon className="h-5 w-5" />
                          </div>
                          <span className="rounded-full border border-slate-700/80 bg-slate-800/80 px-2.5 py-0.5 text-[10px] font-medium text-slate-300">
                            {wf.tag}
                          </span>
                        </div>
                        <h3 className="mt-4 text-sm font-semibold text-white group-hover:text-brand-cyan transition-colors">
                          {wf.title}
                        </h3>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                          {wf.description}
                        </p>
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-3">
                        <div className="flex gap-1">
                          {wf.models.map((m) => (
                            <span
                              key={m}
                              className="rounded bg-slate-800/80 px-1.5 py-0.5 text-[9px] font-mono text-slate-400"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-300 transition group-hover:bg-brand-indigo group-hover:text-white"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
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
                              <span>{formatTimeAgo(t.createdAt)}</span>
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
                          {(t.status === 'transcribing' || t.status === 'translating' || t.status === 'exporting' || t.status === 'dubbing') && (
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
                    <span className="font-medium text-white">PhoWhisper (VinAI)</span>
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

              {/* Toolbox */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-4">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
                  Hộp công cụ
                </h3>
                <div className="space-y-1.5">
                  {tools.map(({ label, icon: Icon, detail }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => handleSelectFiles('fast-transcribe')}
                      className="group flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition hover:bg-slate-800/80 cursor-pointer"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-brand-cyan group-hover:bg-brand-indigo group-hover:text-white transition">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-slate-200 group-hover:text-white">
                          {label}
                        </div>
                        <div className="truncate text-[11px] text-slate-400">{detail}</div>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-500 group-hover:text-brand-cyan transition" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Shortcuts */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <Keyboard className="h-3.5 w-3.5 text-brand-indigo" />
                  <span>Phím tắt tiện ích</span>
                </div>
                <div className="space-y-2 text-xs">
                  {shortcuts.map(({ label, shortcut }) => (
                    <div key={label} className="flex items-center justify-between text-slate-300">
                      <span className="text-[11px]">{label}</span>
                      <kbd className="rounded-md border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] font-mono text-slate-400">
                        {shortcut}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
          )}
        </main>
      </div>
    </>
  );
}



