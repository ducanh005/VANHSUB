import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Play, Settings, ChevronDown, Folder, Plus, Check } from 'lucide-react';
import AutoPilotView from './AutoPilotView';
import AiStudioSettingsTab from './AiStudioSettingsTab';
import ProjectSetupScreen from './ProjectSetupScreen';
import ChannelConfigModal from './ChannelConfigModal';
import { useAiStudioStore } from '../../lib/store/aiStudioStore';

export type AiStudioMode = 'auto' | 'settings';

export default function AiStudioWorkspace() {
  const [activeMode, setActiveMode] = useState<AiStudioMode>('auto');
  const [isChannelModalOpen, setIsChannelModalOpen] = useState<boolean>(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const {
    config,
    loadConfig,
    isLoading,
    hasLoaded,
    isProjectEntered,
    setProjectEntered,
    switchProject,
  } = useAiStudioStore();

  // Nạp cấu hình từ Electron Main / disk ngay khi Workspace mount
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsProjectDropdownOpen(false);
      }
    };
    if (isProjectDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProjectDropdownOpen]);

  const currentProjectName = config.channelProfile?.projectName?.trim();
  const savedProjects = config.savedProjects || [];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#080D1A]">
      {/* Top Studio Control Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800/80 bg-[#0B1120]/90 px-6 backdrop-blur-md z-20">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-cyan/20 to-brand-indigo/30 border border-brand-cyan/30 text-brand-cyan shadow-sm">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              AI Video Studio
              <span className="rounded-full bg-gradient-to-r from-brand-cyan/20 to-brand-rose/20 px-2 py-0.5 text-[10px] font-bold text-brand-cyan border border-brand-cyan/30">
                PRO STUDIO
              </span>
            </h1>
          </div>
        </div>

        {/* Center: Current Project Badge & Switcher Dropdown (when entered) */}
        {isProjectEntered && currentProjectName && (
          <div className="relative hidden sm:block" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsProjectDropdownOpen((prev) => !prev)}
              className="flex items-center gap-2 rounded-xl border border-slate-800 bg-[#0E1526] hover:bg-[#131C30] hover:border-slate-700 px-3.5 py-1.5 text-xs transition cursor-pointer shadow-sm"
              title="Bấm để chuyển nhanh dự án hoặc tạo dự án mới"
            >
              <span className="text-slate-400">Project:</span>
              <span className="font-bold text-white truncate max-w-[200px]" title={currentProjectName}>
                📁 {currentProjectName}
              </span>
              <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ${isProjectDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu */}
            {isProjectDropdownOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-64 rounded-2xl border border-slate-800 bg-[#0E1526] shadow-2xl p-2 space-y-1 z-50 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-md">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Dự án đã lưu ({savedProjects.length})
                </div>

                <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-0.5">
                  {savedProjects.map((p) => {
                    const isActive = config.activeProjectId === p.id || currentProjectName === p.name;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={async () => {
                          setIsProjectDropdownOpen(false);
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
                  <button
                    type="button"
                    onClick={() => {
                      setIsProjectDropdownOpen(false);
                      setProjectEntered(false);
                    }}
                    className="w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs text-slate-300 hover:bg-slate-800/80 hover:text-white transition cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    <span>Tạo dự án mới...</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsProjectDropdownOpen(false);
                      setProjectEntered(false);
                    }}
                    className="w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs text-slate-400 hover:bg-slate-800/80 hover:text-slate-200 transition cursor-pointer"
                  >
                    <Folder className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                    <span>Quản lý danh sách dự án</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Mode Switcher Buttons */}
        <div className="flex items-center rounded-2xl border border-slate-800 bg-slate-950/80 p-1">
          <button
            type="button"
            onClick={() => setActiveMode('auto')}
            className={`flex items-center gap-2 rounded-xl px-4 py-1.5 text-xs font-semibold transition cursor-pointer ${
              activeMode === 'auto'
                ? 'bg-gradient-to-r from-brand-cyan to-brand-indigo text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>AI Tự Sản Xuất (Auto)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMode('settings')}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
              activeMode === 'settings'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Cấu hình AI Studio"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>Cấu hình</span>
          </button>
        </div>
      </header>

      {/* Main Studio Viewport */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {isLoading && !hasLoaded ? (
          <div className="flex h-full w-full items-center justify-center bg-[#080D1A] text-slate-400">
            <div className="flex flex-col items-center gap-3">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-brand-cyan border-t-transparent" />
              <span className="text-xs font-medium">Đang tải cấu hình AI Studio...</span>
            </div>
          </div>
        ) : (
          <>
            {activeMode === 'auto' && (
              !isProjectEntered ? (
                <ProjectSetupScreen
                  onEnterStudio={() => setProjectEntered(true)}
                  onOpenDetailedConfig={() => setIsChannelModalOpen(true)}
                />
              ) : (
                <AutoPilotView
                  onSwitchProject={() => setProjectEntered(false)}
                />
              )
            )}
            {activeMode === 'settings' && <AiStudioSettingsTab />}
          </>
        )}
      </div>

      {/* Modal Cấu hình kênh chi tiết */}
      <ChannelConfigModal
        isOpen={isChannelModalOpen}
        onClose={() => setIsChannelModalOpen(false)}
      />
    </div>
  );
}
