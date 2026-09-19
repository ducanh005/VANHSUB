import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FileText,
  Copy,
  Edit3,
  Sparkles,
  RotateCcw,
  Check,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Clock,
  Mic,
  ArrowLeft,
  Trash2,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  MessageSquare,
  Send,
  Loader2,
  Minimize2,
  Maximize2,
  MoveVertical,
  Image as ImageIcon,
  User,
  XCircle,
  Square,
} from 'lucide-react';
import type {
  PipelineSessionState,
  ScriptBeatLine,
  ScriptEvaluation,
  IdeaBlueprint,
} from '../../types/aiStudio';
import { useAiStudioStore } from '../../lib/store/aiStudioStore';

interface ScriptWorkspaceViewProps {
  session: PipelineSessionState;
  blueprint?: IdeaBlueprint | null;
  isRunning?: boolean;
  onProceedToVoice: () => void;
  onRegenerateScript: () => void;
  onBackToIdeas: () => void;
  onDeleteVideo?: () => void;
  onCancelProcess?: () => void;
  onSwitchTab?: (tab: 'script' | 'visual' | 'character') => void;
  activeCenterTab?: 'script' | 'visual' | 'character';
  onSessionUpdate?: (updatedSession: PipelineSessionState) => void;
}

export default function ScriptWorkspaceView({
  session,
  blueprint: propBlueprint,
  isRunning = false,
  onProceedToVoice,
  onRegenerateScript,
  onBackToIdeas,
  onDeleteVideo,
  onCancelProcess,
  onSwitchTab,
  activeCenterTab = 'script',
  onSessionUpdate,
}: ScriptWorkspaceViewProps) {
  const { config } = useAiStudioStore();

  const blueprint = propBlueprint || session.artifacts?.blueprint || null;
  const initialLines = session.artifacts?.scriptLines || [];

  const [lines, setLines] = useState<ScriptBeatLine[]>(initialLines);
  const [evaluation, setEvaluation] = useState<ScriptEvaluation | null>(
    session.artifacts?.scriptEvaluation || null
  );
  const [isIdeaAccordionOpen, setIsIdeaAccordionOpen] = useState(false);
  const [editingLineIndex, setEditingLineIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [copyToast, setCopyToast] = useState<string | null>(null);

  // Script height controls (kéo dài hoặc thu ngắn kịch bản)
  const [scriptHeight, setScriptHeight] = useState<number>(320);
  const [isScriptExpanded, setIsScriptExpanded] = useState<boolean>(false);
  const [isResizingScript, setIsResizingScript] = useState<boolean>(false);
  const [copiedThumbPrompt, setCopiedThumbPrompt] = useState<boolean>(false);
  const ideaSectionRef = useRef<HTMLDivElement>(null);

  const handleMouseDownResizer = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingScript(true);
    setIsScriptExpanded(false);
    const startY = e.clientY;
    const startHeight = scriptHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(160, Math.min(850, startHeight + deltaY));
      setScriptHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizingScript(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleFocusIdeaSection = () => {
    setIsIdeaAccordionOpen(true);
    setIsScriptExpanded(false);
    setScriptHeight(200);
    setTimeout(() => {
      ideaSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  };

  const handleCopyThumbPrompt = (promptText: string) => {
    if (!promptText) return;
    navigator.clipboard.writeText(promptText);
    setCopiedThumbPrompt(true);
    setTimeout(() => setCopiedThumbPrompt(false), 2500);
  };

  // AI Action Loading states
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [customPromptModalOpen, setCustomPromptModalOpen] = useState(false);
  const [customPromptText, setCustomPromptText] = useState('');

  // History for Undo
  const [history, setHistory] = useState<
    { lines: ScriptBeatLine[]; evaluation: ScriptEvaluation | null }[]
  >([]);

  // Sync state when session changes
  useEffect(() => {
    if (session.artifacts?.scriptLines && session.artifacts.scriptLines.length > 0) {
      setLines(session.artifacts.scriptLines);
    }
    if (session.artifacts?.scriptEvaluation) {
      setEvaluation(session.artifacts.scriptEvaluation);
    }
  }, [session.artifacts?.scriptLines, session.artifacts?.scriptEvaluation]);

  // If no evaluation exists yet, automatically evaluate on mount
  useEffect(() => {
    if (!evaluation && lines.length > 0 && typeof window.vanhsub?.aiStudio?.evaluateScript === 'function') {
      void handleEvaluate();
    }
  }, [lines.length]);

  // Calculate statistics (word count & estimated duration)
  const stats = useMemo(() => {
    const totalWords = lines.reduce((acc, l) => acc + (l.text || '').split(/\s+/).filter(Boolean).length, 0);
    const totalSeconds = Math.round(totalWords / 3.3); // ~200 words per minute
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const formattedDuration = `~${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    return {
      count: lines.length,
      words: totalWords,
      duration: formattedDuration,
    };
  }, [lines]);

  // Timestamps calculation for narration beat lines
  const timestamps = useMemo(() => {
    let runningSec = 0;
    return lines.map((l) => {
      const mins = Math.floor(runningSec / 60);
      const secs = Math.floor(runningSec % 60);
      const timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      const lineWords = (l.text || '').split(/\s+/).filter(Boolean).length;
      const duration = (l.durationMs ? Math.round(l.durationMs / 1000) : 0) || Math.max(3, Math.round(lineWords / 3.3));
      runningSec += duration;
      return timeStr;
    });
  }, [lines]);

  const notifySessionUpdate = (newLines: ScriptBeatLine[], newEval: ScriptEvaluation | null) => {
    if (!onSessionUpdate) return;
    const updatedSession: PipelineSessionState = {
      ...session,
      artifacts: {
        ...session.artifacts,
        scriptLines: newLines,
        scriptEvaluation: newEval || undefined,
      },
      updatedAt: Date.now(),
    };
    onSessionUpdate(updatedSession);
  };

  // Trigger AI evaluation
  const handleEvaluate = async () => {
    if (isEvaluating || lines.length === 0 || !window.vanhsub?.aiStudio?.evaluateScript) return;
    setIsEvaluating(true);
    try {
      const result = await window.vanhsub.aiStudio.evaluateScript({
        sessionId: session.sessionId,
        lines,
        blueprint: blueprint || undefined,
        channelProfile: config.channelProfile,
      });
      if (result?.evaluation) {
        setEvaluation(result.evaluation);
        notifySessionUpdate(lines, result.evaluation);
      }
    } catch (err) {
      console.error('[ScriptWorkspaceView] Evaluate error:', err);
    } finally {
      setIsEvaluating(false);
    }
  };

  // Trigger AI improvement (Cải thiện điểm)
  const handleImproveScore = async () => {
    if (isRefining || lines.length === 0 || !window.vanhsub?.aiStudio?.refineScript) return;
    setIsRefining(true);
    // Push current version to history
    setHistory((prev) => [{ lines: [...lines], evaluation }, ...prev]);

    try {
      const result = await window.vanhsub.aiStudio.refineScript({
        sessionId: session.sessionId,
        lines,
        mode: 'improve_weaknesses',
        blueprint: blueprint || undefined,
        channelProfile: config.channelProfile,
      });

      if (result?.lines && result.lines.length > 0) {
        setLines(result.lines);
        if (result.evaluation) {
          setEvaluation(result.evaluation);
          notifySessionUpdate(result.lines, result.evaluation);
        } else {
          notifySessionUpdate(result.lines, evaluation);
          void handleEvaluate();
        }
      }
    } catch (err) {
      console.error('[ScriptWorkspaceView] Improve error:', err);
    } finally {
      setIsRefining(false);
    }
  };

  // Submit custom refinement prompt (Yêu cầu của tôi)
  const handleCustomPromptSubmit = async () => {
    if (!customPromptText.trim() || !window.vanhsub?.aiStudio?.refineScript) return;
    setCustomPromptModalOpen(false);
    setIsRefining(true);
    setHistory((prev) => [{ lines: [...lines], evaluation }, ...prev]);

    try {
      const result = await window.vanhsub.aiStudio.refineScript({
        sessionId: session.sessionId,
        lines,
        instructions: customPromptText.trim(),
        mode: 'custom_prompt',
        blueprint: blueprint || undefined,
        channelProfile: config.channelProfile,
      });

      if (result?.lines && result.lines.length > 0) {
        setLines(result.lines);
        if (result.evaluation) {
          setEvaluation(result.evaluation);
          notifySessionUpdate(result.lines, result.evaluation);
        } else {
          notifySessionUpdate(result.lines, evaluation);
          void handleEvaluate();
        }
      }
    } catch (err) {
      console.error('[ScriptWorkspaceView] Custom refine error:', err);
    } finally {
      setIsRefining(false);
      setCustomPromptText('');
    }
  };

  // Undo last edit
  const handleUndo = () => {
    if (history.length === 0) return;
    const [previous, ...rest] = history;
    setLines(previous.lines);
    setEvaluation(previous.evaluation);
    setHistory(rest);
    notifySessionUpdate(previous.lines, previous.evaluation);

    if (window.vanhsub?.aiStudio?.updateScriptLines) {
      void window.vanhsub.aiStudio.updateScriptLines({
        sessionId: session.sessionId,
        lines: previous.lines,
      });
    }
  };

  // Start editing a specific line
  const handleStartEditLine = (index: number) => {
    setEditingLineIndex(index);
    setEditingText(lines[index]?.text || '');
  };

  // Save inline edited line
  const handleSaveInlineEdit = async (index: number) => {
    if (editingText.trim() && lines[index]) {
      const updated = lines.map((line, idx) =>
        idx === index ? { ...line, text: editingText.trim() } : line
      );
      setLines(updated);
      setEditingLineIndex(null);
      notifySessionUpdate(updated, evaluation);

      // Persist to session
      if (window.vanhsub?.aiStudio?.updateScriptLines) {
        await window.vanhsub.aiStudio.updateScriptLines({
          sessionId: session.sessionId,
          lines: updated,
        });
      }
    } else {
      setEditingLineIndex(null);
    }
  };

  // Copy full script to clipboard
  const handleCopyScript = () => {
    const fullText = lines.map((l) => l.text).join('\n\n');
    navigator.clipboard.writeText(fullText);
    setCopyToast('Đã sao chép toàn bộ kịch bản vào clipboard!');
    setTimeout(() => setCopyToast(null), 3000);
  };

  const title = blueprint?.title || session.topic || 'Kịch bản Video';
  const hookQuote =
    blueprint?.hookConcept ||
    lines[0]?.text ||
    'Một câu chuyện kỳ bí mở ra những bí mật chấn động chưa từng được tiết lộ.';

  return (
    <div className="flex flex-col h-full bg-[#070B14] text-slate-200 overflow-hidden">
      
      {/* 1. Top Sub-Navigation Tabs matching Revo Studio */}
      <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b border-slate-800/80 bg-[#090E1A] shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSwitchTab?.('script')}
            className={`rounded-xl px-4 py-1.5 text-xs font-bold transition cursor-pointer ${
              activeCenterTab === 'script'
                ? 'bg-[#1C263A] text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Kịch bản &amp; Giọng
          </button>
          <button
            type="button"
            onClick={() => onSwitchTab?.('visual')}
            className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition cursor-pointer ${
              activeCenterTab === 'visual'
                ? 'bg-[#1C263A] text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Phân cảnh Visual
          </button>
          <button
            type="button"
            onClick={() => onSwitchTab?.('character')}
            className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition cursor-pointer ${
              activeCenterTab === 'character'
                ? 'bg-[#1C263A] text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Nhân vật
          </button>
        </div>

        <span className="rounded-full bg-orange-500/20 px-3 py-0.5 text-[11px] font-bold text-orange-400 border border-orange-500/30 uppercase tracking-wider">
          {session.status === 'awaiting_approval' ? 'paused' : session.status}
        </span>
      </div>

      {/* Main Scrollable Viewport */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
        
        {/* Status Line */}
        <div className="text-xs text-slate-400">
          Trạng thái:{' '}
          <span className="text-amber-400 font-mono font-bold">
            {session.status === 'awaiting_approval' ? 'paused' : session.status}
          </span>
        </div>

        {/* Video Big Title & Hook Quote */}
        <div className="space-y-1.5">
          <h2 className="text-lg md:text-xl font-bold text-white tracking-tight">
            {title}
          </h2>
          <p className="text-xs text-amber-300/90 italic font-medium leading-relaxed">
            &ldquo;{hookQuote.replace(/^["“]+|["”]+$/g, '')}&rdquo;
          </p>
        </div>

        {/* 2. Box: Điểm Kịch Bản (Script Evaluation Box) */}
        <div className="rounded-2xl border border-slate-800/90 bg-[#0B101E] p-4 space-y-3.5 shadow-md">
          {/* Header row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs font-bold text-slate-300 uppercase tracking-wider">
                <span className="text-rose-400">🎯</span> Điểm kịch bản
                <HelpCircle className="h-3.5 w-3.5 text-slate-500 cursor-help" />
              </span>

              {evaluation && (
                <div className="flex items-center gap-2">
                  <span className="text-base font-extrabold text-white">
                    {evaluation.overallScore}/100
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Thấp nhất {evaluation.lowestScore}/10
                  </span>
                  {evaluation.failedCriteria.length > 0 && (
                    <span className="rounded bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      Chưa đạt ở {evaluation.failedCriteria.join(', ')}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Actions: Undo / Re-evaluate */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleEvaluate}
                disabled={isEvaluating}
                className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#0F1626] px-2.5 py-1 text-[11px] text-slate-300 hover:text-white transition cursor-pointer"
                title="Chấm lại điểm bằng AI"
              >
                <RotateCcw className={`h-3 w-3 ${isEvaluating ? 'animate-spin text-brand-cyan' : ''}`} />
                <span>{isEvaluating ? 'Đang chấm...' : 'Chấm lại điểm'}</span>
              </button>

              {history.length > 0 && (
                <button
                  type="button"
                  onClick={handleUndo}
                  className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#0F1626] px-2.5 py-1 text-[11px] text-slate-300 hover:text-white transition cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Hoàn tác lượt sửa</span>
                </button>
              )}
            </div>
          </div>

          {/* 10 Dimension Badges D1 to D10 */}
          {evaluation?.criteria && evaluation.criteria.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {evaluation.criteria.map((c) => {
                  const isFail = c.score <= 5;
                  const isModerate = c.score === 6 || c.score === 7;
                  return (
                    <span
                      key={c.id}
                      title={`${c.name}: ${c.score}/10 — ${c.feedback || ''}`}
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-mono font-bold border transition cursor-default ${
                        isFail
                          ? 'bg-rose-500/25 border-rose-500/40 text-rose-200'
                          : isModerate
                          ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                          : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                      }`}
                    >
                      <span>{c.id}</span>
                      <span>{c.score}</span>
                    </span>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500 italic">
                Thang 0-10 mỗi tiêu chí — Đạt = MỌI tiêu chí &ge; 8
              </p>
            </div>
          )}

          {/* Critique text */}
          {evaluation?.critique && (
            <p className="text-xs text-slate-300 leading-relaxed">
              {evaluation.critique}
            </p>
          )}

          {/* Notice banner for Web Automation mode */}
          {evaluation?.notice && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200/90 leading-relaxed flex items-start gap-2">
              <span className="text-amber-400 shrink-0">💡</span>
              <span>{evaluation.notice}</span>
            </div>
          )}

          {/* Action buttons: Cải thiện điểm & Yêu cầu của tôi */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleImproveScore}
              disabled={isRefining}
              className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600/90 hover:bg-teal-500 px-3.5 py-1.5 text-xs font-bold text-white shadow transition active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {isRefining ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Đang sửa kịch bản...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Cải thiện điểm</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setCustomPromptModalOpen(true)}
              disabled={isRefining}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/80 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-slate-200 transition active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <span>✍️ Yêu cầu của tôi</span>
            </button>
          </div>
        </div>

        {/* 3. Box: Kịch Bản (Script Lines & Direct Inline Editing) */}
        <div className="rounded-2xl border border-slate-800/90 bg-[#0B101E] p-4 space-y-3 shadow-md">
          {/* Header row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-brand-cyan" />
                Kịch bản
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {stats.count} câu &bull; {stats.words} từ &bull; {stats.duration}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Quick height buttons */}
              <div className="flex items-center rounded-lg border border-slate-800 bg-[#090E1A] p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => {
                    setIsScriptExpanded(false);
                    setScriptHeight(200);
                  }}
                  className={`px-2 py-0.5 rounded transition cursor-pointer ${
                    !isScriptExpanded && scriptHeight <= 220
                      ? 'bg-brand-cyan/20 text-brand-cyan font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Thu ngắn danh sách câu kịch bản còn 200px để dễ nhìn thông tin ý tưởng"
                >
                  📐 Thu ngắn (200px)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsScriptExpanded(false);
                    setScriptHeight(360);
                  }}
                  className={`px-2 py-0.5 rounded transition cursor-pointer ${
                    !isScriptExpanded && scriptHeight > 220 && scriptHeight <= 450
                      ? 'bg-brand-cyan/20 text-brand-cyan font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Độ cao vừa phải (360px)"
                >
                  📏 Vừa (360px)
                </button>
                <button
                  type="button"
                  onClick={() => setIsScriptExpanded((prev) => !prev)}
                  className={`px-2 py-0.5 rounded transition cursor-pointer ${
                    isScriptExpanded
                      ? 'bg-brand-cyan/20 text-brand-cyan font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title={isScriptExpanded ? 'Thu lại độ cao mặc định' : 'Mở rộng hiển thị toàn bộ kịch bản'}
                >
                  {isScriptExpanded ? '↕ Thu lại' : '↕ Kéo dài hết'}
                </button>
              </div>

              {blueprint && (
                <button
                  type="button"
                  onClick={handleFocusIdeaSection}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-950/25 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-900/40 hover:text-amber-100 transition cursor-pointer shadow-sm"
                  title="Thu gọn kịch bản và cuộn tới Thông tin ý tưởng & nhân vật"
                >
                  <Lightbulb className="h-3 w-3 text-amber-400" />
                  <span>💡 Xem thông tin ý tưởng</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleCopyScript}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-[#0F1626] px-2.5 py-1 text-[11px] text-slate-300 hover:text-white transition cursor-pointer"
              >
                <Copy className="h-3 w-3" />
                <span>Sao chép</span>
              </button>

              <button
                type="button"
                onClick={() => handleStartEditLine(0)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-[#0F1626] px-2.5 py-1 text-[11px] text-slate-300 hover:text-white transition cursor-pointer"
              >
                <Edit3 className="h-3 w-3" />
                <span>Sửa kịch bản</span>
              </button>
            </div>
          </div>

          <p className="text-[11px] text-amber-400/90 italic">
            Nhấp vào câu bất kỳ để sửa trực tiếp (tự động lưu) &bull; Kéo thanh bên dưới để chỉnh chiều dài khung kịch bản
          </p>

          {copyToast && (
            <div className="rounded-lg bg-emerald-950/60 border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 animate-in fade-in">
              {copyToast}
            </div>
          )}

          {/* Script lines list with resizable height */}
          <div
            style={{
              maxHeight: isScriptExpanded ? 'none' : `${scriptHeight}px`,
            }}
            className="space-y-2 divide-y divide-slate-800/50 overflow-y-auto custom-scrollbar pr-1.5 transition-[max-height] duration-150"
          >
            {lines.map((line, idx) => {
              const isEditing = editingLineIndex === idx;
              const timeLabel = timestamps[idx] || '0:00';

              return (
                <div
                  key={line.id || idx}
                  className={`pt-2.5 flex items-start gap-3 rounded-lg p-2 transition ${
                    isEditing
                      ? 'bg-slate-900/90 ring-1 ring-brand-cyan/50'
                      : 'hover:bg-slate-900/40 cursor-text'
                  }`}
                  onClick={() => {
                    if (!isEditing) handleStartEditLine(idx);
                  }}
                >
                  {/* Timestamp */}
                  <span className="font-mono text-xs text-slate-500 shrink-0 select-none pt-0.5 w-10">
                    {timeLabel}
                  </span>

                  {/* Narration Text or Editor */}
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          rows={3}
                          autoFocus
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-brand-cyan focus:outline-none"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                              handleSaveInlineEdit(idx);
                            } else if (e.key === 'Escape') {
                              setEditingLineIndex(null);
                            }
                          }}
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingLineIndex(null)}
                            className="rounded px-2.5 py-1 text-[11px] text-slate-400 hover:text-white"
                          >
                            Hủy
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveInlineEdit(idx)}
                            className="inline-flex items-center gap-1 rounded bg-brand-cyan hover:bg-cyan-400 px-3 py-1 text-[11px] font-bold text-slate-950"
                          >
                            <Check className="h-3 w-3" />
                            <span>Lưu câu thoại</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-200 leading-relaxed font-normal">
                        {line.text}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Draggable Resizer Bar */}
          <div
            onMouseDown={handleMouseDownResizer}
            onDoubleClick={() => setIsScriptExpanded((prev) => !prev)}
            className={`w-full py-1.5 flex items-center justify-center gap-2 rounded-lg border border-dashed transition select-none cursor-row-resize ${
              isResizingScript
                ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan'
                : 'border-slate-800/80 bg-slate-900/40 text-slate-500 hover:border-slate-700 hover:bg-slate-900/80 hover:text-slate-300'
            }`}
            title="Kéo lên/xuống để chỉnh độ dài kịch bản • Nhấp đúp để mở rộng toàn bộ"
          >
            <MoveVertical className="h-3.5 w-3.5" />
            <span className="text-[10px] font-mono tracking-wider">
              {isScriptExpanded
                ? 'Đang mở rộng toàn bộ kịch bản • Nhấp đúp để thu lại'
                : `↕ Kéo để kéo dài/thu ngắn (${scriptHeight}px) • Nhấp đúp để bung hết`}
            </span>
          </div>
        </div>

        {/* 4. Box: Thông Tin Ý Tưởng & Nhân Vật (Collapsible Accordion) */}
        {blueprint && (
          <div
            ref={ideaSectionRef}
            className="rounded-2xl border border-amber-500/40 bg-[#0B101E] overflow-hidden shadow-md"
          >
            <button
              type="button"
              onClick={() => setIsIdeaAccordionOpen((prev) => !prev)}
              className="w-full flex items-center justify-between p-3.5 text-xs font-bold text-white hover:bg-slate-900/60 transition cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-400" />
                <span>Thông tin ý tưởng &amp; Thiết lập nhân vật</span>
                {blueprint.thumbnailPrompt && (
                  <span className="rounded bg-brand-cyan/10 border border-brand-cyan/30 px-2 py-0.5 text-[10px] font-mono text-brand-cyan">
                    Có Thumbnail AI Prompt
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-amber-300/80 font-normal">
                  {isIdeaAccordionOpen ? 'Thu gọn' : 'Xem chi tiết'}
                </span>
                {isIdeaAccordionOpen ? (
                  <ChevronUp className="h-4 w-4 text-amber-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-amber-400" />
                )}
              </div>
            </button>

            {isIdeaAccordionOpen && (
              <div className="p-4 pt-2 border-t border-slate-800/80 space-y-4 text-xs">
                
                {/* 1. Host / Character details card */}
                {(config.channelProfile?.hostName || config.channelProfile?.hostDescription || (config.channelProfile?.channelCharacters && config.channelProfile.channelCharacters.length > 0)) && (
                  <div className="rounded-xl border border-pink-500/30 bg-pink-950/15 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 font-bold text-pink-300 text-xs">
                        <User className="h-3.5 w-3.5 text-pink-400" />
                        Nhân vật đại diện kênh (Character Consistency)
                      </span>
                      <span className="text-[10px] text-pink-400/80 bg-pink-900/30 border border-pink-700/40 px-2 py-0.5 rounded-full font-mono">
                        Đã khóa diện mạo
                      </span>
                    </div>

                    <div className="flex items-start gap-3 pt-1">
                      {config.channelProfile?.hostAvatarUrl ? (
                        <img
                          src={config.channelProfile.hostAvatarUrl}
                          alt="Host Avatar"
                          className="h-10 w-10 rounded-full object-cover border border-pink-500/50 shrink-0"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-pink-500/20 border border-pink-500/40 flex items-center justify-center text-pink-300 font-bold shrink-0">
                          {config.channelProfile?.hostName?.slice(0, 1)?.toUpperCase() || 'NV'}
                        </div>
                      )}

                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-xs">
                            {config.channelProfile?.hostName || 'Nhân vật chính'}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            (Host đại diện)
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300 leading-relaxed">
                          {config.channelProfile?.hostDescription || 'Chưa thiết lập mô tả diện mạo chi tiết.'}
                        </p>
                      </div>
                    </div>

                    {/* Additional characters if any */}
                    {config.channelProfile?.channelCharacters && config.channelProfile.channelCharacters.length > 0 && (
                      <div className="pt-2 border-t border-pink-500/20 space-y-1.5">
                        <span className="text-[11px] font-semibold text-pink-200">
                          Nhân vật khác trong kênh:
                        </span>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {config.channelProfile.channelCharacters.map((char) => (
                            <div
                              key={char.id}
                              className="rounded-lg bg-black/30 border border-pink-500/20 p-2 text-[11px] space-y-0.5"
                            >
                              <span className="font-bold text-white">{char.name}</span>
                              <p className="text-slate-400 text-[10px] line-clamp-2">{char.descriptionEn}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Thumbnail Concept & Prompt card */}
                <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-bold text-indigo-300 text-xs">
                      <ImageIcon className="h-3.5 w-3.5 text-indigo-400" />
                      Thumbnail &amp; Ảnh Bìa Video
                    </span>
                    {blueprint.thumbnailPrompt && (
                      <button
                        type="button"
                        onClick={() => handleCopyThumbPrompt(blueprint.thumbnailPrompt || '')}
                        className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-900/40 px-2.5 py-1 text-[10px] font-bold text-indigo-200 hover:bg-indigo-800 transition cursor-pointer shadow-sm"
                      >
                        <Copy className="h-3 w-3" />
                        <span>{copiedThumbPrompt ? '✓ Đã sao chép prompt!' : 'Sao chép Prompt AI'}</span>
                      </button>
                    )}
                  </div>

                  {blueprint.thumbnailConcept && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium text-slate-400">
                        Ý tưởng thị giác (Thumbnail Concept):
                      </span>
                      <p className="text-slate-200 text-xs leading-relaxed bg-black/30 p-2.5 rounded-lg border border-indigo-500/20">
                        {blueprint.thumbnailConcept}
                      </p>
                    </div>
                  )}

                  {blueprint.thumbnailPrompt ? (
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium text-indigo-300 flex items-center justify-between">
                        <span>Prompt tạo ảnh AI (Tiếng Anh - chuẩn Midjourney / Flux / DALL-E 3):</span>
                      </span>
                      <div className="relative group">
                        <pre className="font-mono text-[11px] text-slate-300 leading-relaxed bg-[#060913] p-2.5 rounded-lg border border-slate-800 whitespace-pre-wrap break-words max-h-36 overflow-y-auto custom-scrollbar">
                          {blueprint.thumbnailPrompt}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500 italic">
                      Chưa có prompt ảnh tiếng Anh.
                    </p>
                  )}
                </div>

                {/* 3. Narrative, Format & Outline */}
                <div className="space-y-2.5 pt-1">
                  <div className="grid grid-cols-12 gap-3">
                    <span className="col-span-3 text-slate-400 font-medium">Góc nhìn</span>
                    <span className="col-span-9 text-slate-200 leading-relaxed">
                      {blueprint.narrativeAngle || 'Chưa có thông tin'}
                    </span>
                  </div>

                  <div className="grid grid-cols-12 gap-3">
                    <span className="col-span-3 text-slate-400 font-medium">Định dạng</span>
                    <span className="col-span-9 text-slate-200 font-mono">
                      {blueprint.aspectRatio === '9:16' ? 'Shorts (9:16)' : 'Video dài (16:9)'}
                    </span>
                  </div>

                  {blueprint.outline && blueprint.outline.length > 0 && (
                    <div className="grid grid-cols-12 gap-3">
                      <span className="col-span-3 text-slate-400 font-medium">Dàn ý phân đoạn</span>
                      <div className="col-span-9 space-y-1 text-slate-300">
                        {blueprint.outline.map((beat, bIdx) => (
                          <div key={bIdx} className="leading-relaxed">
                            &bull; {beat}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-12 gap-3">
                    <span className="col-span-3 text-slate-400 font-medium">Thời lượng ước tính</span>
                    <span className="col-span-9 text-slate-200 font-mono">
                      {blueprint.estimatedDurationSec || 600} giây ({Math.round((blueprint.estimatedDurationSec || 600) / 60)} phút)
                    </span>
                  </div>

                  {blueprint.targetAudience && (
                    <div className="grid grid-cols-12 gap-3">
                      <span className="col-span-3 text-slate-400 font-medium">Khán giả mục tiêu</span>
                      <span className="col-span-9 text-slate-200">
                        {blueprint.targetAudience}
                      </span>
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        )}

      </div>

      {/* 5. Bottom Action Bar matching Revo Studio */}
      <div className="p-3.5 border-t border-slate-800/80 bg-[#080C14] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          {/* Nút Tiếp tục: Duyệt kịch bản & Lồng tiếng */}
          <button
            type="button"
            onClick={onProceedToVoice}
            disabled={isRunning}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:brightness-110 px-4 py-2 text-xs font-bold text-white shadow-md active:scale-95 transition cursor-pointer disabled:opacity-50"
            title="Duyệt kịch bản hiện tại và tiếp tục sang bước Lồng tiếng"
          >
            <Mic className="h-3.5 w-3.5" />
            <span>Tiếp tục: Duyệt &amp; Lồng tiếng ▸</span>
          </button>

          {/* Nút Hủy tiến trình đang chạy (chỉ hiện khi đang chạy) */}
          {isRunning && onCancelProcess && (
            <button
              type="button"
              onClick={onCancelProcess}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-800/80 bg-rose-950/60 hover:bg-rose-900/80 px-3.5 py-2 text-xs font-bold text-rose-200 transition active:scale-95 cursor-pointer shadow-sm shadow-rose-950/40"
              title="Dừng / Hủy tiến trình đang chạy (giữ nguyên dữ liệu kịch bản)"
            >
              <Square className="h-3 w-3 fill-rose-400 text-rose-400" />
              <span>Hủy tiến trình đang chạy</span>
            </button>
          )}

          {/* Nút Tạo lại kịch bản */}
          <button
            type="button"
            onClick={onRegenerateScript}
            disabled={isRunning}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/90 hover:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition active:scale-95 cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5 text-brand-cyan" />
            <span>Tạo lại kịch bản</span>
          </button>

          {/* Nút Quay lại Ý Tưởng */}
          <button
            type="button"
            onClick={onBackToIdeas}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/50 hover:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white transition active:scale-95 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Quay lại Ý Tưởng</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {onDeleteVideo && (
            <button
              type="button"
              onClick={onDeleteVideo}
              className="inline-flex items-center gap-1 text-slate-500 hover:text-rose-400 text-xs transition cursor-pointer px-2 py-1"
              title="Xoá video khỏi phiên làm việc"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Xoá video</span>
            </button>
          )}

          <span className="text-[11px] font-mono text-slate-500 bg-slate-900/80 px-2 py-1 rounded">
            video {session.sessionId ? session.sessionId.slice(0, 8) : '00000000'}
          </span>
        </div>
      </div>

      {/* Modal Yêu cầu của tôi (Custom Refinement Prompt) */}
      {customPromptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0B1120] p-5 space-y-4 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>✍️</span> Yêu cầu chỉnh sửa kịch bản
              </h3>
              <button
                type="button"
                onClick={() => setCustomPromptModalOpen(false)}
                className="text-slate-500 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Nhập chỉ dẫn cho AI (VD: &ldquo;Viết đoạn mở đầu giật gân hơn&rdquo;, &ldquo;Rút ngắn câu từ dưới 800 từ&rdquo;, &ldquo;Thêm số liệu khảo cổ&rdquo;):
            </p>

            <textarea
              value={customPromptText}
              onChange={(e) => setCustomPromptText(e.target.value)}
              placeholder="VD: Hãy làm cho câu Hook 6 giây đầu dồn dập hơn và bổ sung mốc thời gian cụ thể..."
              rows={4}
              autoFocus
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:border-brand-cyan focus:outline-none"
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCustomPromptModalOpen(false)}
                className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleCustomPromptSubmit}
                disabled={!customPromptText.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan hover:bg-cyan-400 px-4 py-1.5 text-xs font-bold text-slate-950 transition disabled:opacity-50"
              >
                <Send className="h-3 w-3" />
                <span>Gửi yêu cầu</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
