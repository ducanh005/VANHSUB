import React from 'react';
import {
  Sparkles,
  Lightbulb,
  AlertCircle,
  Play,
  Square,
} from 'lucide-react';
import type { IdeaBlueprint, PipelineSessionState } from '../../../types/aiStudio';

export interface IdeaListPanelProps {
  ideas?: IdeaBlueprint[];
  selectedIdea?: IdeaBlueprint | null;
  onSelectIdea?: (idea: IdeaBlueprint) => void;
  selectedFormat?: '16:9' | '9:16';
  onFormatChange?: (format: '16:9' | '9:16') => void;
  setupComplete?: boolean;
  setupMissing?: string[];
  setupWarningToast?: string | null;
  onOpenIdeaModal?: () => void;
  onOpenProjectSetup?: () => void;
  isRunning?: boolean;
  session?: PipelineSessionState | null;
  onCancelRun?: () => void;
  onResumeSession?: (idea?: IdeaBlueprint) => void;
  onRequestStartProduction?: (idea: IdeaBlueprint) => void;
}

export const IdeaListPanel: React.FC<IdeaListPanelProps> = ({
  ideas = [],
  selectedIdea = null,
  onSelectIdea = () => {},
  selectedFormat = '16:9',
  onFormatChange = () => {},
  setupComplete = false,
  setupMissing = [],
  setupWarningToast = null,
  onOpenIdeaModal = () => {},
  onOpenProjectSetup,
  isRunning = false,
  session = null,
  onCancelRun = () => {},
  onResumeSession = () => {},
  onRequestStartProduction = () => {},
}) => {
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

  return (
    <div className="flex flex-col h-full border-r border-border bg-[#070B13] overflow-hidden">
      {/* Header Cột 1 */}
      <div className="p-3.5 border-b border-border flex items-center justify-between gap-2 shrink-0">
        <h3 className="text-sm font-bold text-white tracking-wide">Ý tưởng</h3>
        <div className="flex items-center gap-2">
          <select
            value={selectedFormat}
            onChange={(e) => onFormatChange(e.target.value as '16:9' | '9:16')}
            className="rounded-lg border border-border bg-[#0E1526] px-2 py-1 text-xs text-text focus:outline-none cursor-pointer"
          >
            <option value="16:9">🎬 Video dài</option>
            <option value="9:16">📱 Shorts</option>
          </select>

          {/* Nút ✨ Sinh (Mở modal tạo & sinh ý tưởng - có Guard kiểm tra hoàn tất thiết lập) */}
          <button
            type="button"
            onClick={onOpenIdeaModal}
            className={`flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-bold text-white shadow transition active:scale-95 cursor-pointer ${
              setupComplete
                ? 'bg-[#FA5252] hover:bg-[#e04545]'
                : 'bg-amber-600/80 hover:bg-amber-500 text-amber-100'
            }`}
            title={
              setupComplete
                ? 'Sinh ý tưởng kịch bản mới'
                : `⚠️ Chưa hoàn tất thiết lập: Thiếu ${setupMissing.join(', ')}`
            }
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Sinh</span>
          </button>
        </div>
      </div>

      {/* Setup Warning Alert Banner (nếu bấm Sinh khi chưa hoàn tất setup) */}
      {setupWarningToast && (
        <div className="mx-3 mt-2 rounded-md border border-amber-500/40 bg-amber-950/40 p-2.5 text-[11px] text-amber-200 animate-in fade-in flex flex-col gap-1.5">
          <div className="flex items-start gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
            <span>{setupWarningToast}</span>
          </div>
          {onOpenProjectSetup && (
            <button
              type="button"
              onClick={onOpenProjectSetup}
              className="self-end rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-300 transition cursor-pointer"
            >
              👉 Mở màn Thiết Lập ngay
            </button>
          )}
        </div>
      )}

      {/* Nội dung danh sách ý tưởng / Trạng thái trống */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
        {(ideas || []).length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center text-text-muted text-xs leading-relaxed">
            <Lightbulb className="h-8 w-8 text-text-faint mb-3 stroke-[1.5]" />
            <p>Chưa có ý tưởng.</p>
            <p className="mt-1">
              Bấm &quot;✨ Sinh&quot; (cần đã chọn engine + cấu hình AI provider ở Settings).
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {(ideas || []).map((idea, idx) => {
              const isSelected = selectedIdea === idea;
              const inSession = isIdeaInActiveSession(idea);
              return (
                <div
                  key={idx}
                  onClick={() => onSelectIdea(idea)}
                  className={`rounded-md border p-3 cursor-pointer transition ${
                    isSelected
                      ? 'border-orange-500/80 bg-[#141B29]'
                      : 'border-border bg-[#0B101E] hover:border-border'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
                      {idea.aspectRatio === '9:16' ? '📱 9:16 Shorts' : '🎬 16:9 Dài'}
                    </span>
                    <span className="text-[10px] text-text-muted">#{idx + 1}</span>
                  </div>
                  <h4 className="text-xs font-bold text-text line-clamp-2 leading-snug">
                    {idea.title}
                  </h4>
                  <p className="text-[11px] text-text-muted line-clamp-2 mt-1">
                    {idea.hookConcept}
                  </p>
                  <div className="mt-2.5 flex items-center justify-end">
                    {inSession ? (
                      isRunning ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onCancelRun();
                          }}
                          className="rounded-lg bg-rose-600/90 hover:bg-rose-500 px-3 py-1 text-[11px] font-bold text-white transition active:scale-95 cursor-pointer flex items-center gap-1"
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
                            onResumeSession(idea);
                          }}
                          className="rounded-lg bg-success hover:brightness-110 px-3 py-1 text-[11px] font-bold text-white transition active:scale-95 cursor-pointer flex items-center gap-1"
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
                          onRequestStartProduction(idea);
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
  );
};

export default IdeaListPanel;
