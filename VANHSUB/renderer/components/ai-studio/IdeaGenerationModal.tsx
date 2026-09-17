import React, { useState } from 'react';
import {
  Lightbulb,
  X,
  Sparkles,
  Bot,
  RotateCcw,
  Film,
  Smartphone,
  AlertCircle,
  CheckCircle2,
  Info,
} from 'lucide-react';
import { useAiStudioStore } from '../../lib/store/aiStudioStore';
import type { IdeaBlueprint } from '../../types/aiStudio';

export interface IdeaGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (blueprint: IdeaBlueprint) => void;
  initialTopic?: string;
}

export default function IdeaGenerationModal({
  isOpen,
  onClose,
  onSubmit,
  initialTopic = '',
}: IdeaGenerationModalProps) {
  const { config } = useAiStudioStore();

  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>(
    config.flowEngine.aspectRatio === '9:16' ? '9:16' : '16:9'
  );
  const [topic, setTopic] = useState(initialTopic);
  const [hookConcept, setHookConcept] = useState('');
  const [narrativeAngle, setNarrativeAngle] = useState('');
  const [outline, setOutline] = useState('');
  const [existingScript, setExistingScript] = useState('');
  const [thumbnailConcept, setThumbnailConcept] = useState('');
  const [thumbnailPrompt, setThumbnailPrompt] = useState('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAutoFill = async () => {
    if (!topic.trim()) {
      setErrorMessage('Vui lòng nhập Tiêu đề video / Ý tưởng ban đầu để AI có dữ kiện sinh mẫu.');
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsGenerating(true);

    try {
      if (!window.vanhsub?.aiStudio?.autoFillIdea) {
        throw new Error('Tính năng autoFillIdea chưa sẵn sàng trên ứng dụng.');
      }

      const result = await window.vanhsub.aiStudio.autoFillIdea({
        topic: topic.trim(),
        aspectRatio,
      });

      if (result.title) setTopic(result.title);
      if (result.hookConcept) setHookConcept(result.hookConcept);
      if (result.narrativeAngle) setNarrativeAngle(result.narrativeAngle);
      if (Array.isArray(result.outline) && result.outline.length > 0) {
        setOutline(result.outline.join('\n'));
      }
      if (result.thumbnailConcept) setThumbnailConcept(result.thumbnailConcept);
      if (result.thumbnailPrompt) setThumbnailPrompt(result.thumbnailPrompt);

      setSuccessMessage(
        `AI (${config.llm.provider === 'chatgpt_web' ? 'ChatGPT Web' : config.llm.provider === 'gemini_web' ? 'Gemini Web' : config.llm.provider.toUpperCase()}) đã sinh mẫu ý tưởng thành công!`
      );
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      console.error('[IdeaGenerationModal] AutoFill error:', err);
      setErrorMessage(
        err?.message ||
          'Không thể kết nối AI để sinh mẫu. Vui lòng kiểm tra trạng thái đăng nhập hoặc API Key trong Cài Đặt.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) {
      setErrorMessage('Tiêu đề video / Ý tưởng là trường bắt buộc.');
      return;
    }

    const outlineArray = outline
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const blueprint: IdeaBlueprint = {
      topic: topic.trim(),
      title: topic.trim(),
      aspectRatio,
      hookConcept: hookConcept.trim() || `Bạn có tin vào sự thật đằng sau ${topic.trim()}?`,
      narrativeAngle: narrativeAngle.trim() || 'Góc tiếp cận độc đáo, đột phá của kênh',
      outline: outlineArray.length > 0 ? outlineArray : [
        'Phân đoạn 1: Mở đầu sự cố / bối cảnh bất ngờ...',
        'Phân đoạn 2: Diễn biến kịch tính / xung đột cao trào...',
        'Phân đoạn 3: Bước ngoặt / giải mã sự thật...',
        'Phân đoạn 4: Bài học & Lối thoát...',
      ],
      existingScript: existingScript.trim() || undefined,
      thumbnailConcept: thumbnailConcept.trim() || undefined,
      thumbnailPrompt: thumbnailPrompt.trim() || undefined,
      pacing: aspectRatio === '9:16' ? 'fast' : 'moderate',
      estimatedDurationSec: aspectRatio === '9:16' ? 45 : 90,
      rawSummary: `Video "${topic.trim()}" định dạng ${aspectRatio}. ${narrativeAngle.trim()}`,
    };

    onSubmit(blueprint);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-3xl border border-slate-800 bg-[#0B101E] shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <Lightbulb className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">
                Tạo &amp; Sinh Ý Tưởng Video
              </h2>
              <p className="text-xs text-slate-400">
                Nhập thủ công hoặc bấm &quot;🤖 AI Tự Động Sinh Mẫu&quot; để AI gợi ý điền mẫu
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-800/60 hover:text-white transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-slate-200 custom-scrollbar">
          {/* Top Bar: Khung hình & Nút AI Sinh Mẫu */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3">
            {/* Aspect Ratio Switcher */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">Khung hình:</span>
              <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/90 p-1">
                <button
                  type="button"
                  onClick={() => setAspectRatio('16:9')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                    aspectRatio === '16:9'
                      ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Film className="h-3.5 w-3.5" />
                  <span>🎬 Video Dài (16:9)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAspectRatio('9:16')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                    aspectRatio === '9:16'
                      ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Smartphone className="h-3.5 w-3.5" />
                  <span>📱 Video Ngắn (9:16)</span>
                </button>
              </div>
            </div>

            {/* AI Auto-Fill Button */}
            <button
              type="button"
              onClick={handleAutoFill}
              disabled={isGenerating}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-violet-600/30 hover:brightness-110 active:scale-95 disabled:opacity-50 transition cursor-pointer"
            >
              {isGenerating ? (
                <>
                  <RotateCcw className="h-3.5 w-3.5 animate-spin" />
                  <span>Đang nhờ AI sinh mẫu...</span>
                </>
              ) : (
                <>
                  <Bot className="h-4 w-4" />
                  <span>🤖 AI Tự Động Sinh Mẫu</span>
                </>
              )}
            </button>
          </div>

          {/* Feedback & Error Banners */}
          {errorMessage && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
              <div>
                <span className="font-bold">Lỗi: </span>
                <span>{errorMessage}</span>
              </div>
            </div>
          )}

          {successMessage && (
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Field 1: Tiêu đề video / Ý tưởng * */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <span>📌 Tiêu đề video / Ý tưởng</span>
              <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Ví dụ: Cú sốc tài chính toàn cầu 2026 - Sự thật chưa ai kể"
              className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan focus:outline-none transition"
            />
          </div>

          {/* Field 2 & 3: 2 Columns (Hook 3s & Góc nhìn/Angle) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <span>⚡ Hook 3s mở đầu</span>
              </label>
              <input
                type="text"
                value={hookConcept}
                onChange={(e) => setHookConcept(e.target.value)}
                placeholder="Mở đầu gây tò mò / câu hỏi giữ chân"
                className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan focus:outline-none transition"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <span>🎯 Góc nhìn / Đột phá (Angle)</span>
              </label>
              <input
                type="text"
                value={narrativeAngle}
                onChange={(e) => setNarrativeAngle(e.target.value)}
                placeholder="Góc tiếp cận độc đáo của kênh"
                className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan focus:outline-none transition"
              />
            </div>
          </div>

          {/* Field 4: Dàn ý / Các phân đoạn (Outline - mỗi dòng 1 ý) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <span>📝 Dàn ý / Các phân đoạn (Outline - mỗi dòng 1 ý)</span>
            </label>
            <textarea
              rows={4}
              value={outline}
              onChange={(e) => setOutline(e.target.value)}
              placeholder={`Phân đoạn 1: Mở đầu sự cố...\nPhân đoạn 2: Diễn biến bất ngờ...\nPhân đoạn 3: Bài học & Lối thoát...`}
              className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-xs font-mono text-white placeholder:text-slate-600 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan focus:outline-none transition leading-relaxed"
            />
          </div>

          {/* Field 5: Kịch bản có sẵn (tuỳ chọn) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <span>📜 Kịch bản có sẵn (tuỳ chọn)</span>
            </label>
            <textarea
              rows={4}
              value={existingScript}
              onChange={(e) => setExistingScript(e.target.value)}
              placeholder={`Dán kịch bản vào đây...\n\nMỗi câu nên nằm trên 1 dòng — hệ thống tự tách câu nếu bạn dán cả đoạn văn.\nKhông cần nhập thời gian: AI đọc giọng rồi tự trích timing.`}
              className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-xs text-white placeholder:text-slate-600 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan focus:outline-none transition leading-relaxed"
            />
            <div className="flex items-start gap-1.5 text-[11px] text-slate-400 mt-1">
              <Info className="h-3.5 w-3.5 shrink-0 text-brand-cyan mt-0.5" />
              <span>
                <span className="font-semibold text-slate-300">ℹ Có kịch bản ở bước này:</span> AI rút nhân vật từ chính kịch bản (đúng tên, đúng vai) rồi mới vẽ chân dung — thay vì bịa nhân vật từ dàn ý. Bỏ trống = AI tự viết kịch bản sau khi bạn duyệt sản xuất.
              </span>
            </div>
          </div>

          {/* Field 6: Concept ảnh bìa (Thumbnail Concept) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <span>🎨 Concept ảnh bìa (Thumbnail Concept)</span>
            </label>
            <input
              type="text"
              value={thumbnailConcept}
              onChange={(e) => setThumbnailConcept(e.target.value)}
              placeholder="Mô tả ý tưởng hình ảnh bìa"
              className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan focus:outline-none transition"
            />
          </div>

          {/* Field 7: Prompt ảnh bìa cho AI (Thumbnail Prompt tiếng Anh) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <span>🖼️ Prompt ảnh bìa cho AI (Thumbnail Prompt tiếng Anh)</span>
            </label>
            <textarea
              rows={2}
              value={thumbnailPrompt}
              onChange={(e) => setThumbnailPrompt(e.target.value)}
              placeholder="Detailed English image prompt for thumbnail generation..."
              className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-2.5 text-xs font-mono text-white placeholder:text-slate-600 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan focus:outline-none transition"
            />
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-800/80 bg-slate-950/90 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition cursor-pointer"
          >
            Hủy
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!topic.trim() || isGenerating}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-pink-500 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-orange-500/25 hover:brightness-110 active:scale-95 disabled:opacity-50 transition cursor-pointer"
          >
            <Sparkles className="h-4 w-4" />
            <span>✨ Tạo Ý Tưởng Mới</span>
          </button>
        </div>
      </div>
    </div>
  );
}
