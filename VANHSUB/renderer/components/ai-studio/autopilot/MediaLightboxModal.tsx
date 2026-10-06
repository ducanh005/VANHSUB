import React, { useEffect } from 'react';
import {
  FolderOpen,
  X,
  Sparkles,
  Copy,
} from 'lucide-react';
import { toMediaUrl } from './PipelineTrackerPanel';

export interface MediaLightboxModalProps {
  media: {
    type: 'image' | 'video';
    url: string;
    shotId?: string;
    narration?: string;
    prompt?: string;
    durationMs?: number;
  } | null;
  onClose: () => void;
  onOpenFolder: (path?: string) => void;
}

export const MediaLightboxModal: React.FC<MediaLightboxModalProps> = ({
  media,
  onClose,
  onOpenFolder,
}) => {
  // Phím tắt ESC để đóng Lightbox Preview
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && media) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [media, onClose]);

  if (!media) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4 md:p-8 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl max-h-[92vh] flex flex-col rounded-lg border border-border bg-[#0B1120] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-border bg-[#080D1A]/90 shrink-0">
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-accent/20 px-3 py-1 text-xs font-bold text-accent border border-accent/40">
              {media.type === 'video' ? '📹 Video Preview' : '🖼️ Image Preview'}
            </span>
            {media.shotId && (
              <span className="font-mono text-xs font-bold text-white">
                {media.shotId}
              </span>
            )}
            {media.durationMs && (
              <span className="text-xs text-text-muted">
                Thời lượng: {Math.round(media.durationMs / 1000)}s
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenFolder(media.url)}
              className="rounded-md border border-border bg-surface-2 hover:bg-surface-3 px-3 py-1.5 text-xs font-medium text-text hover:text-white transition cursor-pointer flex items-center gap-1.5"
              title="Mở thư mục chứa tệp trong File Explorer"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>Mở tệp</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-surface-2 hover:bg-rose-950/60 hover:border-rose-700/60 p-1.5 text-text-muted hover:text-rose-300 transition cursor-pointer"
              title="Đóng (ESC)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Media Body */}
        <div className="flex-1 min-h-0 bg-black flex items-center justify-center p-4 overflow-hidden relative">
          {media.type === 'video' ? (
            <video
              src={toMediaUrl(media.url)}
              controls
              autoPlay
              className="max-h-[60vh] max-w-full rounded-md object-contain"
            />
          ) : (
            <img
              src={toMediaUrl(media.url)}
              alt="Media Preview"
              className="max-h-[60vh] max-w-full rounded-md object-contain transition-transform duration-300 hover:scale-102"
            />
          )}
        </div>

        {/* Modal Footer Info */}
        <div className="px-6 py-4 border-t border-border bg-[#080D1A]/95 space-y-2 shrink-0 max-h-48 overflow-y-auto custom-scrollbar">
          {media.narration && (
            <div>
              <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider">
                Lời thoại:
              </span>
              <p className="text-white font-medium text-xs leading-relaxed mt-0.5">
                {media.narration}
              </p>
            </div>
          )}

          {media.prompt && (
            <div className="bg-bg p-2.5 rounded-md border border-border space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-semibold text-text flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-amber-400" /> Prompt Flow:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(media.prompt || '');
                  }}
                  className="text-accent hover:text-accent flex items-center gap-1 text-[10px] cursor-pointer"
                >
                  <Copy className="h-2.5 w-2.5" /> Sao chép prompt
                </button>
              </div>
              <p className="text-text italic font-mono text-[11px] leading-relaxed break-words max-h-20 overflow-y-auto custom-scrollbar">
                {media.prompt}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MediaLightboxModal;
