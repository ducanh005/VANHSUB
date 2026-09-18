import React, { useState } from 'react';
import { Sparkles, Play, Settings } from 'lucide-react';
import AutoPilotView from './AutoPilotView';
import AiStudioSettingsTab from './AiStudioSettingsTab';

export type AiStudioMode = 'auto' | 'settings';

export default function AiStudioWorkspace() {
  const [activeMode, setActiveMode] = useState<AiStudioMode>('auto');

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#080D1A]">
      {/* Top Studio Control Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800/80 bg-[#0B1120]/90 px-6 backdrop-blur-md z-10">
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
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeMode === 'auto' && <AutoPilotView />}
        {activeMode === 'settings' && <AiStudioSettingsTab />}
      </div>
    </div>
  );
}
