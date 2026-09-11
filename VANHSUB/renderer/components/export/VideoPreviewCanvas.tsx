import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, ShieldAlert, Layers } from 'lucide-react';
import type { SrtLine } from '../../lib/srt';
import { formatMs } from '../../lib/srt';
import type {
  SubStyle,
  PerLineSubtitleStyle,
  CustomMaskRegion,
  WatermarkOptions,
} from '../../types/electron';

interface VideoPreviewCanvasProps {
  videoPath?: string;
  aspectRatio: 'original' | '16:9' | '9:16' | '1:1';
  customMaskEnabled: boolean;
  customMask: CustomMaskRegion;
  watermarkEnabled: boolean;
  watermark: WatermarkOptions;
  globalStyle: SubStyle;
  perLineStyles: Record<number, PerLineSubtitleStyle>;
  srtLines: SrtLine[];
  currentTime: number;
  onTimeUpdate: (timeSec: number) => void;
}

export const VideoPreviewCanvas: React.FC<VideoPreviewCanvasProps> = ({
  videoPath,
  aspectRatio,
  customMaskEnabled,
  customMask,
  watermarkEnabled,
  watermark,
  globalStyle,
  perLineStyles,
  srtLines,
  currentTime,
  onTimeUpdate,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  const videoSrc = videoPath ? `vanhmedia://local/${encodeURIComponent(videoPath)}` : '';

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = Number(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
      onTimeUpdate(targetTime);
    }
  };

  const currentTimeMs = Math.round(currentTime * 1000);

  // Tìm câu thoại đang hiển thị tại thời điểm hiện tại
  const activeLineIndex = srtLines.findIndex(
    (l) => currentTimeMs >= l.startMs && currentTimeMs <= l.endMs
  );
  const activeLine = activeLineIndex !== -1 ? srtLines[activeLineIndex] : null;

  // Lấy style áp dụng: style riêng từng câu hoặc style chung
  const lineOverride = activeLineIndex !== -1 ? perLineStyles[activeLineIndex] : null;

  const fontName = lineOverride?.fontName || globalStyle.fontName;
  const fontSize = lineOverride?.fontSize || globalStyle.fontSize;
  const textColor = lineOverride?.textColorHex || globalStyle.primaryColour;
  const outlineColor = lineOverride?.outlineColorHex || globalStyle.outlineColour;
  const outlineWidth = lineOverride?.outlineWidth ?? globalStyle.outline;
  const isBold = lineOverride?.bold ?? globalStyle.bold;
  const isItalic = lineOverride?.italic ?? false;
  const alignment = lineOverride?.alignment ?? globalStyle.alignment;

  // Watermark position classes
  const getWatermarkPositionClass = (pos: WatermarkOptions['position']) => {
    switch (pos) {
      case 'top_left':
        return 'top-4 left-4';
      case 'top_right':
        return 'top-4 right-4';
      case 'bottom_left':
        return 'bottom-8 left-4';
      case 'bottom_right':
        return 'bottom-8 right-4';
      case 'center':
        return 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2';
      default:
        return 'top-4 right-4';
    }
  };

  // Khung chứa tỉ lệ (Letterbox / Container styling)
  const getContainerAspectClass = () => {
    switch (aspectRatio) {
      case '9:16':
        return 'aspect-[9/16] max-h-[460px] w-auto mx-auto';
      case '1:1':
        return 'aspect-square max-h-[440px] w-auto mx-auto';
      case '16:9':
        return 'aspect-video w-full max-h-[440px] mx-auto';
      default:
        return 'aspect-video w-full max-h-[440px] mx-auto';
    }
  };

  const outlineShadow =
    outlineWidth > 0
      ? [
          `${outlineWidth}px 0 0 ${outlineColor}`,
          `0 ${outlineWidth}px 0 ${outlineColor}`,
          `-${outlineWidth}px 0 0 ${outlineColor}`,
          `0 -${outlineWidth}px 0 ${outlineColor}`,
        ].join(', ')
      : 'none';

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-semibold text-slate-200">
            Xem trước Video trực tiếp (Live Preview Mini CapCut)
          </span>
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-800/90 px-2 py-0.5 text-[10px] font-mono text-brand-cyan">
          Tỉ lệ: {aspectRatio}
        </span>
      </div>

      {/* Video Container with Aspect Ratio */}
      <div className="flex items-center justify-center overflow-hidden rounded-xl bg-black p-1 relative min-h-[260px]">
        <div className={`relative overflow-hidden rounded-lg bg-black ${getContainerAspectClass()}`}>
          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              muted={isMuted}
              playsInline
              onTimeUpdate={() => {
                if (videoRef.current) {
                  onTimeUpdate(videoRef.current.currentTime);
                }
              }}
              onLoadedMetadata={() => {
                if (videoRef.current) {
                  setDuration(videoRef.current.duration);
                }
              }}
              onEnded={() => setIsPlaying(false)}
              className="h-full w-full object-contain pointer-events-none"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
              Không có video nguồn
            </div>
          )}

          {/* 1. Custom Mask Overlay Preview */}
          {customMaskEnabled && (
            <div
              style={{
                left: `${customMask.xPercent}%`,
                top: `${customMask.yPercent}%`,
                width: `${customMask.widthPercent}%`,
                height: `${customMask.heightPercent}%`,
              }}
              className={`absolute border border-dashed border-cyan-400/80 flex items-center justify-center transition-all ${
                customMask.mode === 'blur'
                  ? 'backdrop-blur-md bg-slate-900/30'
                  : customMask.mode === 'pixelate'
                  ? 'bg-slate-950/70 backdrop-grayscale'
                  : 'bg-black'
              }`}
            >
              <div className="flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-mono text-cyan-300 pointer-events-none">
                <ShieldAlert className="h-2.5 w-2.5" />
                <span>Mask ({customMask.mode})</span>
              </div>
            </div>
          )}

          {/* 2. Watermark Overlay Preview */}
          {watermarkEnabled && watermark.content && (
            <div
              style={{
                opacity: watermark.opacity ?? 0.8,
                maxWidth: `${watermark.scalePercent ?? 20}%`,
              }}
              className={`absolute z-10 pointer-events-none ${getWatermarkPositionClass(
                watermark.position
              )}`}
            >
              {watermark.type === 'image' ? (
                <img
                  src={`vanhmedia://local/${encodeURIComponent(watermark.content)}`}
                  alt="Watermark"
                  className="max-h-12 w-auto object-contain drop-shadow-md"
                />
              ) : (
                <span className="font-semibold text-white drop-shadow-md text-xs px-2 py-0.5 rounded bg-black/40">
                  {watermark.content}
                </span>
              )}
            </div>
          )}

          {/* 3. Subtitle Overlay Preview */}
          {activeLine && (
            <div
              className="absolute inset-x-0 z-20 flex justify-center px-4 pointer-events-none"
              style={
                alignment === 8
                  ? { top: 12 }
                  : alignment === 5
                  ? { top: '50%', transform: 'translateY(-50%)' }
                  : { bottom: Math.max(8, (globalStyle.marginV || 25) / 2) }
              }
            >
              <span
                style={{
                  fontFamily: `"${fontName}", Arial, sans-serif`,
                  fontSize: `${fontSize * 0.9}px`,
                  lineHeight: 1.25,
                  color: textColor,
                  fontWeight: isBold ? 800 : 500,
                  fontStyle: isItalic ? 'italic' : 'normal',
                  ...(globalStyle.borderStyle === 3
                    ? {
                        backgroundColor: outlineColor || '#000000',
                        padding: '3px 10px',
                        borderRadius: '3px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                      }
                    : {
                        textShadow: outlineShadow,
                      }),
                }}
                className="text-center max-w-[92%] break-words"
              >
                {activeLine.text}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Video Scrubber & Playback Controls */}
      <div className="flex flex-col gap-2 pt-1">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="flex-1 accent-cyan-400 cursor-pointer h-1.5 rounded-lg bg-slate-800"
          />
        </div>

        <div className="flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition cursor-pointer"
            >
              {isPlaying ? (
                <Pause className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.currentTime = 0;
                  onTimeUpdate(0);
                }
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition cursor-pointer"
              title="Về đầu video"
            >
              <RotateCcw className="h-3 w-3" />
            </button>

            <button
              type="button"
              onClick={() => setIsMuted(!isMuted)}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition cursor-pointer"
              title={isMuted ? 'Bật âm thanh' : 'Tắt tiếng'}
            >
              {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="font-mono text-[11px] text-slate-300">
            <span>{formatMs(currentTime * 1000).split(',')[0]}</span>
            <span className="text-slate-500 mx-1">/</span>
            <span>{formatMs(duration * 1000).split(',')[0]}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
