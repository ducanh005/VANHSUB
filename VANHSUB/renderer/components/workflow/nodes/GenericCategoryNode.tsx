import React, { memo, useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import {
  Sparkles,
  FileVideo,
  Image as ImageIcon,
  Type,
  Volume2,
  VolumeX,
  Sliders,
  Scissors,
  CheckCircle2,
  AlertCircle,
  Clock,
  Play,
  Pause,
  Maximize2,
  FolderOpen,
  Share2,
  X,
  Layers,
  Camera,
  ShieldCheck,
  Film,
  Coins,
  ExternalLink,
} from 'lucide-react';
import type { WorkflowNodeData, NodeCategory, PortDataType } from '../../../types/workflow';
import { NODE_DEFINITIONS } from '../../../lib/workflow/nodeRegistry';
import { PORT_STYLES, CATEGORY_STYLES } from '../../../lib/workflow/portColors';
import { useWorkflowStore } from '../../../lib/store/workflowStore';
import { calculateNodeCreditEstimate } from '../../../lib/workflow/creditCalculator';

export type WorkflowNodeType = Node<WorkflowNodeData, 'genericNode'>;

const CATEGORY_ICONS: Record<NodeCategory, React.ComponentType<{ className?: string }>> = {
  input: Type,
  model: Sparkles,
  control: Sliders,
  consistency: ShieldCheck,
  editing: Scissors,
  output: Share2,
  logic: Layers,
};

function formatMediaUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('vanhmedia://')) {
    return url;
  }
  return `vanhmedia://local/${encodeURIComponent(url)}`;
}

function GenericCategoryNodeComponent({ id, data, selected }: NodeProps<WorkflowNodeType>) {
  const nodeData = data as WorkflowNodeData;
  const def = NODE_DEFINITIONS[nodeData.nodeType];
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode);
  const runtime = nodeData.runtime || { status: 'idle' };

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [base64Thumb, setBase64Thumb] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const handleNodeFilePick = async (mediaType: 'image' | 'video') => {
    try {
      if (typeof window !== 'undefined' && window.vanhsub?.dialog) {
        if (mediaType === 'image') {
          const filePath = await window.vanhsub.dialog.openImageFile();
          if (filePath) {
            updateNodeConfig(id, 'sourceUrl', filePath);
            updateNodeConfig(id, 'referenceImageUrl', filePath);
            updateNodeConfig(id, 'imageUrl', filePath);
          }
        } else {
          let filePath: string | null = null;
          if (window.vanhsub.dialog.openVideoFile) {
            filePath = await window.vanhsub.dialog.openVideoFile();
          } else {
            const files = await window.vanhsub.dialog.openMediaFile();
            if (files && files.length > 0) filePath = files[0];
          }
          if (filePath) {
            updateNodeConfig(id, 'videoUrl', filePath);
          }
        }
      } else {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = mediaType === 'image' ? 'image/*' : 'video/*';
        input.onchange = (e: any) => {
          const file = e.target.files?.[0];
          if (file) {
            const path = (file as any).path || URL.createObjectURL(file);
            if (mediaType === 'image') {
              updateNodeConfig(id, 'sourceUrl', path);
              updateNodeConfig(id, 'referenceImageUrl', path);
            } else {
              updateNodeConfig(id, 'videoUrl', path);
            }
          }
        };
        input.click();
      }
    } catch (err) {
      console.warn('[GenericCategoryNode] Lỗi chọn file:', err);
    }
  };

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {});
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const category = (def?.category || nodeData.category || 'logic') as NodeCategory;
  const catStyle = CATEGORY_STYLES[category] || CATEGORY_STYLES.logic;
  const IconComponent = CATEGORY_ICONS[category] || Layers;

  // Trạng thái viền node (theo mục 4.2 đặc tả: xám -> vàng nhấp nháy -> xanh -> đỏ)
  let borderStatusClass = 'border-slate-800 hover:border-slate-600';
  let statusBadge = null;

  if (runtime.status === 'running') {
    borderStatusClass = 'border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.35)] animate-pulse';
    statusBadge = (
      <span className="flex items-center gap-1 text-[11px] font-medium text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded-full border border-amber-500/40">
        <Clock className="w-3 h-3 animate-spin" /> Đang chạy {runtime.progress ? `(${runtime.progress}%)` : '...'}
      </span>
    );
  } else if (runtime.status === 'queued') {
    borderStatusClass = 'border-sky-400/80 shadow-[0_0_15px_rgba(56,189,248,0.25)]';
    statusBadge = (
      <span className="flex items-center gap-1 text-[11px] font-medium text-sky-300 bg-sky-950/80 px-2 py-0.5 rounded-full border border-sky-500/40">
        <Clock className="w-3 h-3" /> Đang chờ
      </span>
    );
  } else if (runtime.status === 'success') {
    borderStatusClass = 'border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.3)]';
    statusBadge = (
      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-500/40">
        <CheckCircle2 className="w-3 h-3" /> Xong
      </span>
    );
  } else if (runtime.status === 'failed') {
    borderStatusClass = 'border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.4)]';
    statusBadge = (
      <span className="flex items-center gap-1 text-[11px] font-medium text-rose-300 bg-rose-950/80 px-2 py-0.5 rounded-full border border-rose-500/40">
        <AlertCircle className="w-3 h-3" /> Thất bại
      </span>
    );
  } else if (selected) {
    borderStatusClass = 'border-indigo-400 shadow-[0_0_25px_rgba(99,102,241,0.4)]';
  }

  const inputs = def?.inputs || [];
  const outputs = def?.outputs || [];
  const config = nodeData.config || {};
  const creditEst = calculateNodeCreditEstimate(nodeData.nodeType, config);

  const rawVideo =
    runtime?.outputUrl ||
    (typeof runtime?.outputData?.video === 'string' ? runtime.outputData.video : '') ||
    (typeof runtime?.outputData?.video_out === 'string' ? runtime.outputData.video_out : '') ||
    (nodeData.nodeType === 'load-video' && typeof config.videoUrl === 'string' ? config.videoUrl : '');

  const rawImage =
    runtime?.thumbnailUrl ||
    (typeof runtime?.outputData?.image === 'string' ? runtime.outputData.image : '') ||
    (typeof runtime?.outputData?.last_frame === 'string' ? runtime.outputData.last_frame : '') ||
    (typeof runtime?.outputData?.thumbnailUrl === 'string' ? runtime.outputData.thumbnailUrl : '') ||
    (typeof config.initFrameUrl === 'string' ? config.initFrameUrl : '') ||
    (typeof config.imageUrl === 'string' ? config.imageUrl : '') ||
    (typeof config.sourceUrl === 'string' ? config.sourceUrl : '') ||
    (typeof config.referenceImageUrl === 'string' ? config.referenceImageUrl : '');

  useEffect(() => {
    let active = true;
    if (!rawImage) {
      setBase64Thumb(null);
      return;
    }
    if (rawImage.startsWith('data:') || rawImage.startsWith('http://') || rawImage.startsWith('https://')) {
      setBase64Thumb(rawImage);
      return;
    }
    if (typeof window !== 'undefined' && window?.vanhsub?.files?.readImageAsDataUrl) {
      window.vanhsub.files.readImageAsDataUrl(rawImage).then((res) => {
        if (active && res) {
          setBase64Thumb(res);
        }
      }).catch((err) => {
        console.warn('[GenericCategoryNode] readImageAsDataUrl error:', err);
      });
    }
    return () => {
      active = false;
    };
  }, [rawImage]);

  return (
    <div
      className={`min-w-[260px] max-w-[340px] rounded-xl bg-[#111827]/95 backdrop-blur-md border-2 transition-all duration-200 text-slate-100 shadow-2xl relative ${borderStatusClass}`}
      style={{
        boxShadow: selected ? `0 0 25px ${catStyle.glowColor}` : undefined,
      }}
    >
      {/* Node Header */}
      <div
        className={`px-3 py-2.5 rounded-t-[10px] bg-gradient-to-r ${catStyle.headerBg} border-b border-slate-800/80 flex items-center justify-between gap-2`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="p-1 rounded-md bg-black/40 border border-white/10 text-white">
            <IconComponent className="w-3.5 h-3.5" />
          </div>
          <div className="leading-tight truncate">
            <div className="text-xs font-semibold text-white tracking-wide truncate">
              {nodeData.label || def?.label || nodeData.nodeType}
            </div>
            <div className="text-[10px] text-slate-400 flex items-center gap-1.5 font-mono">
              <span className={`px-1.5 py-0.2 rounded ${catStyle.badgeBg} ${catStyle.badgeText} text-[9px] font-sans font-medium`}>
                {catStyle.label.split(' ')[0]}
              </span>
              <span>#{id.slice(-5)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {statusBadge}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              runSingleNode(id);
            }}
            disabled={runtime.status === 'running'}
            title="Chạy riêng node này (Run node)"
            className={`p-1 rounded-md transition-all flex items-center justify-center cursor-pointer shadow-sm ${
              runtime.status === 'running'
                ? 'text-amber-400 bg-amber-950/80 border border-amber-500/40 animate-pulse'
                : 'text-indigo-200 hover:text-white hover:bg-indigo-600/80 bg-slate-900/80 border border-indigo-500/30 hover:border-indigo-400'
            }`}
          >
            {runtime.status === 'running' ? (
              <Clock className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeNode(id);
            }}
            title="Xóa Node"
            className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Node Ports & Content Area */}
      <div className="p-3 space-y-3">
        {/* Ports Row */}
        {(inputs.length > 0 || outputs.length > 0) && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            {/* Input Ports (Left) */}
            <div className="space-y-2">
              {inputs.map((port) => {
                const pStyle = PORT_STYLES[port.dataType as PortDataType] || PORT_STYLES.any;
                return (
                  <div key={port.id} className="relative flex items-center gap-2 group">
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={port.id}
                      className="!w-3 !h-3 !-left-[19px] !border-2 !rounded-full transition-transform hover:scale-125"
                      style={{
                        backgroundColor: pStyle.color,
                        borderColor: '#0f172a',
                        boxShadow: `0 0 8px ${pStyle.glow}`,
                      }}
                    />
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: pStyle.color }}
                    />
                    <span className="text-[11px] text-slate-300 font-medium truncate" title={port.description || port.label}>
                      {port.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Output Ports (Right) */}
            <div className="space-y-2 text-right flex flex-col items-end">
              {outputs.map((port) => {
                const pStyle = PORT_STYLES[port.dataType as PortDataType] || PORT_STYLES.any;
                return (
                  <div key={port.id} className="relative flex items-center justify-end gap-2 w-full group">
                    <span className="text-[11px] text-slate-300 font-medium truncate" title={port.description || port.label}>
                      {port.label}
                    </span>
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: pStyle.color }}
                    />
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={port.id}
                      className="!w-3 !h-3 !-right-[19px] !border-2 !rounded-full transition-transform hover:scale-125"
                      style={{
                        backgroundColor: pStyle.color,
                        borderColor: '#0f172a',
                        boxShadow: `0 0 8px ${pStyle.glow}`,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Quick Preview of Parameters */}
        <div className="pt-2 border-t border-slate-800/80 space-y-1.5 text-[11px] text-slate-400">
          {(config.prompt || config.stylePrompt || config.description) && (
            <div
              className="bg-slate-900/80 p-2 rounded border border-slate-800/60 font-mono text-[10px] text-slate-300 line-clamp-3 leading-relaxed"
              title={config.prompt || config.stylePrompt || config.description}
            >
              "{config.prompt || config.stylePrompt || config.description}"
            </div>
          )}

          {runtime.error && (
            <div className="p-2 rounded bg-rose-950/70 border border-rose-800/80 text-[10px] text-rose-300 flex items-start gap-1.5 leading-tight" title={runtime.error}>
              <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
              <span className="line-clamp-2">{runtime.error}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {creditEst.credits > 0 ? (
              <span
                title={`Ước tính tiêu tốn: ~${creditEst.credits} Credits (~$${creditEst.costUsd} USD) cho ${creditEst.detail}`}
                className="px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-700/70 text-[10px] text-amber-300 font-mono font-bold flex items-center gap-1 shadow-sm"
              >
                <Coins className="w-2.5 h-2.5 text-amber-400" />
                <span>~{creditEst.credits} Cr</span>
              </span>
            ) : nodeData.nodeType === 'google-imagen' ? (
              <span
                title="Tạo ảnh Keyframe bằng Google Imagen 3 hoàn toàn miễn phí (0 Credit)"
                className="px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-700/70 text-[10px] text-emerald-300 font-mono font-bold flex items-center gap-1 shadow-sm"
              >
                <span>✨ 0 Cr (Free)</span>
              </span>
            ) : null}
            {config.colorPalette && (
              <span className="px-1.5 py-0.5 rounded bg-pink-950/60 border border-pink-800/50 text-[10px] text-pink-300 truncate max-w-[140px]">
                🎨 {config.colorPalette}
              </span>
            )}
            {config.lensType && (
              <span className="px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/50 text-[10px] text-cyan-300 truncate max-w-[140px]">
                🔍 {config.lensType}
              </span>
            )}
            {config.qualityPreset && (
              <span
                className={`px-1.5 py-0.5 rounded border text-[10px] uppercase font-mono font-semibold ${
                  config.qualityPreset === 'quality'
                    ? 'bg-purple-950/60 border-purple-800/50 text-purple-300'
                    : 'bg-emerald-950/60 border-emerald-800/50 text-emerald-300'
                }`}
              >
                {config.qualityPreset === 'quality' ? '★ Quality' : '⚡ Lite'}
              </span>
            )}
            {config.durationSeconds && (
              <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-300">
                ⏱ {config.durationSeconds}s
              </span>
            )}
            {config.aspectRatio && (
              <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-300">
                📐 {config.aspectRatio}
              </span>
            )}
            {config.fps && (
              <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-300">
                🎬 {config.fps} fps
              </span>
            )}
            {config.modelVariant && (
              <span className="px-1.5 py-0.5 rounded bg-indigo-950/60 border border-indigo-800/50 text-[10px] text-indigo-300 truncate max-w-[140px]">
                ⚡ {config.modelVariant}
              </span>
            )}
            {config.characterName && (
              <span className="px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-800/50 text-[10px] text-rose-300 truncate max-w-[140px]">
                👤 {config.characterName}
              </span>
            )}
            {config.fileName && (
              <span className="px-1.5 py-0.5 rounded bg-yellow-950/60 border border-yellow-800/50 text-[10px] text-yellow-300 truncate max-w-[140px]">
                💾 {config.fileName}
              </span>
            )}
          </div>
        </div>

        {/* Interactive Media Preview on Node (Video / Image) */}
        {(() => {
          const hasVideo = Boolean(rawVideo);
          const hasImage = Boolean(rawImage);
          const isMediaCapableNode =
            ['model', 'output', 'editing'].includes(category) ||
            ['load-image', 'load-video', 'character-ref', 'qc-check'].includes(nodeData.nodeType) ||
            hasVideo ||
            hasImage;

          if (!isMediaCapableNode) return null;

          const videoUrl = formatMediaUrl(rawVideo);
          const displayImageUrl = base64Thumb || formatMediaUrl(rawImage);

          return (
            <div className="pt-2 border-t border-slate-800/80">
              <div className="relative w-full h-36 rounded-lg bg-black/70 border border-slate-800/90 overflow-hidden group nodrag">
                {hasVideo ? (
                  <div className="relative w-full h-full flex items-center justify-center bg-black">
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      poster={displayImageUrl || undefined}
                      muted={isMuted}
                      loop
                      playsInline
                      onEnded={() => setIsPlaying(false)}
                      className="w-full h-full object-contain cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePlay();
                      }}
                    />

                    {/* Play/Pause Overlay Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePlay();
                      }}
                      className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity cursor-pointer ${
                        isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100'
                      }`}
                    >
                      <div className="p-2.5 rounded-full bg-indigo-600/90 hover:bg-indigo-500 text-white shadow-xl backdrop-blur-sm transform group-hover:scale-110 transition-transform">
                        {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
                      </div>
                    </button>

                    {/* Video Top Badges */}
                    <div className="absolute top-1.5 left-1.5 flex items-center gap-1 z-10 pointer-events-none">
                      <span className="px-1.5 py-0.5 rounded bg-black/75 border border-white/10 text-[9px] font-mono font-semibold text-purple-300 flex items-center gap-1 backdrop-blur-sm shadow">
                        <Film className="w-2.5 h-2.5 text-purple-400" />
                        <span>Video</span>
                      </span>
                    </div>

                    {/* Video Action Controls Bar */}
                    <div className="absolute top-1.5 right-1.5 flex items-center gap-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsMuted(!isMuted);
                        }}
                        title={isMuted ? 'Bật âm thanh' : 'Tắt tiếng'}
                        className="p-1 rounded bg-black/75 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
                      >
                        {isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowModal(true);
                        }}
                        title="Phóng to video"
                        className="p-1 rounded bg-black/75 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
                      >
                        <Maximize2 className="w-3 h-3" />
                      </button>
                      {nodeData.nodeType === 'load-video' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleNodeFilePick('video');
                          }}
                          title="Đổi video khác từ máy tính"
                          className="p-1 rounded bg-black/75 hover:bg-purple-900/80 text-purple-300 hover:text-white border border-purple-500/30 transition-colors cursor-pointer"
                        >
                          <FileVideo className="w-3 h-3" />
                        </button>
                      )}
                      {rawVideo && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window?.vanhsub?.dialog?.showInFolder) {
                              window.vanhsub.dialog.showInFolder(rawVideo);
                            }
                          }}
                          title="Mở thư mục chứa video"
                          className="p-1 rounded bg-black/75 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
                        >
                          <FolderOpen className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ) : hasImage ? (
                  <div
                    className="relative w-full h-full cursor-pointer group/img"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowModal(true);
                    }}
                  >
                    <img
                      src={displayImageUrl}
                      alt="Preview"
                      onError={async () => {
                        if (rawImage && window?.vanhsub?.files?.readImageAsDataUrl) {
                          try {
                            const res = await window.vanhsub.files.readImageAsDataUrl(rawImage);
                            if (res) setBase64Thumb(res);
                          } catch (err) {
                            console.warn('[GenericCategoryNode] onError fallback failed:', err);
                          }
                        }
                      }}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover/img:scale-105"
                    />
                    {/* Image Top Badges */}
                    <div className="absolute top-1.5 left-1.5 flex items-center gap-1 z-10 pointer-events-none">
                      <span className="px-1.5 py-0.5 rounded bg-black/75 border border-white/10 text-[9px] font-mono font-semibold text-emerald-300 flex items-center gap-1 backdrop-blur-sm shadow">
                        <ImageIcon className="w-2.5 h-2.5 text-emerald-400" />
                        <span>Ảnh</span>
                      </span>
                    </div>

                    {/* Image Action Controls */}
                    <div className="absolute top-1.5 right-1.5 flex items-center gap-1 z-10 opacity-0 group-hover/img:opacity-100 transition-opacity">
                      {(nodeData.nodeType === 'load-image' || nodeData.nodeType === 'character-ref') && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleNodeFilePick('image');
                          }}
                          title="Đổi ảnh khác từ máy tính"
                          className="p-1 rounded bg-black/75 hover:bg-emerald-900/80 text-emerald-300 hover:text-white border border-emerald-500/30 transition-colors cursor-pointer"
                        >
                          <FolderOpen className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowModal(true);
                        }}
                        title="Phóng to ảnh"
                        className="p-1 rounded bg-black/75 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
                      >
                        <Maximize2 className="w-3 h-3" />
                      </button>
                      {rawImage && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window?.vanhsub?.dialog?.showInFolder) {
                              window.vanhsub.dialog.showInFolder(rawImage);
                            }
                          }}
                          title="Mở thư mục chứa ảnh"
                          className="p-1 rounded bg-black/75 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
                        >
                          <FolderOpen className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    <div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 group-hover/img:opacity-100 transition-opacity pointer-events-none">
                      <span className="text-[10px] font-medium text-white px-2 py-1 rounded bg-black/70 backdrop-blur-sm border border-white/10 flex items-center gap-1">
                        <Maximize2 className="w-2.5 h-2.5" />
                        <span>Click phóng to</span>
                      </span>
                    </div>
                  </div>
                ) : runtime.status === 'running' ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-amber-400 bg-amber-950/20 px-3">
                    <Clock className="w-6 h-6 animate-spin text-amber-400" />
                    <div className="text-center">
                      <div className="text-[11px] font-semibold text-amber-300">Đang render media...</div>
                      <div className="text-[9px] text-amber-400/80 font-mono mt-0.5">{runtime.progress || 0}% hoàn thành</div>
                    </div>
                    <div className="w-32 h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all duration-300"
                        style={{ width: `${Math.max(5, runtime.progress || 0)}%` }}
                      />
                    </div>
                  </div>
                ) : nodeData.nodeType === 'character-ref' ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-gradient-to-b from-rose-950/30 to-slate-950 p-3 text-center">
                    <div className="w-10 h-10 rounded-full bg-rose-950/80 border-2 border-rose-500/50 flex items-center justify-center text-rose-300 font-bold text-sm shadow-md shadow-rose-950/50">
                      {config.characterName ? config.characterName.charAt(0).toUpperCase() : '👤'}
                    </div>
                    <div className="leading-tight">
                      <div className="text-xs font-bold text-rose-200 truncate max-w-[200px]">
                        {config.characterName || 'Chưa đặt tên'}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {config.gender === 'female' ? 'Nữ' : config.gender === 'other' ? 'Khác' : 'Nam'}
                        {config.ageGroup ? ` • ${config.ageGroup}` : ''}
                      </div>
                    </div>
                    <div className="text-[10px] text-rose-400/80 bg-rose-950/50 px-2 py-0.5 rounded-full border border-rose-800/40 flex items-center gap-1">
                      <ShieldCheck className="w-2.5 h-2.5 text-rose-400" />
                      <span>Định danh nhân vật đã khóa</span>
                    </div>
                  </div>
                ) : nodeData.nodeType === 'scene-ref' ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-gradient-to-b from-indigo-950/30 to-slate-950 p-3 text-center">
                    <div className="w-10 h-10 rounded-full bg-indigo-950/80 border-2 border-indigo-500/50 flex items-center justify-center text-indigo-300 font-bold text-sm shadow-md shadow-indigo-950/50">
                      🏛️
                    </div>
                    <div className="leading-tight">
                      <div className="text-xs font-bold text-indigo-200 truncate max-w-[200px]">
                        {config.sceneName || 'Bối cảnh'}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {config.environment === 'indoor' ? 'Trong nhà' : 'Ngoài trời'}
                        {config.lightingMood ? ` • ${config.lightingMood}` : ''}
                      </div>
                    </div>
                  </div>
                ) : (nodeData.nodeType === 'load-image' || nodeData.nodeType === 'character-ref') ? (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNodeFilePick('image');
                    }}
                    className="w-full h-full flex flex-col items-center justify-center gap-1.5 p-3 text-center cursor-pointer hover:bg-slate-900/90 transition-all border-2 border-dashed border-slate-700 hover:border-emerald-500/80 rounded-lg group/picker"
                  >
                    <div className="p-2 rounded-full bg-emerald-950/80 text-emerald-400 group-hover/picker:scale-110 group-hover/picker:bg-emerald-600 group-hover/picker:text-white transition-all shadow-md">
                      <FolderOpen className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-slate-200 block group-hover/picker:text-emerald-300">
                        Chọn ảnh từ máy tính
                      </span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        PNG, JPG, WEBP hoặc dán URL
                      </span>
                    </div>
                  </div>
                ) : nodeData.nodeType === 'load-video' ? (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNodeFilePick('video');
                    }}
                    className="w-full h-full flex flex-col items-center justify-center gap-1.5 p-3 text-center cursor-pointer hover:bg-slate-900/90 transition-all border-2 border-dashed border-slate-700 hover:border-purple-500/80 rounded-lg group/picker"
                  >
                    <div className="p-2 rounded-full bg-purple-950/80 text-purple-400 group-hover/picker:scale-110 group-hover/picker:bg-purple-600 group-hover/picker:text-white transition-all shadow-md">
                      <FileVideo className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-slate-200 block group-hover/picker:text-purple-300">
                        Chọn video từ máy tính
                      </span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        MP4, MKV, MOV, WEBM
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-600 px-3">
                    <Film className="w-5 h-5 text-slate-600" />
                    <span className="text-[10px] text-slate-500 text-center">Chờ chạy workflow để xem preview</span>
                  </div>
                )}
              </div>

              {/* Lightbox / Fullscreen Modal (Portaled) */}
              {showModal && typeof document !== 'undefined' && createPortal(
                <div
                  className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-150 nodrag nopan"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowModal(false);
                  }}
                >
                  <div
                    className="relative max-w-4xl max-h-[90vh] w-full bg-[#111827] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Modal Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/90">
                      <div className="flex items-center gap-2.5 overflow-hidden mr-4">
                        <div className="p-1.5 rounded-lg bg-black/40 text-purple-400 border border-white/10 shrink-0">
                          {hasVideo ? <Film className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                        </div>
                        <div className="truncate">
                          <div className="text-sm font-semibold text-white truncate">
                            {nodeData.label || def?.label || 'Chi tiết Media'}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono truncate">
                            {rawVideo || rawImage}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {(rawVideo || rawImage) && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window?.vanhsub?.dialog?.showInFolder) {
                                window.vanhsub.dialog.showInFolder(rawVideo || rawImage);
                              }
                            }}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 border border-slate-700 transition cursor-pointer"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            <span>Mở thư mục</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowModal(false)}
                          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    {/* Modal Media Body */}
                    <div className="flex-1 min-h-0 bg-black/95 flex items-center justify-center p-3">
                      {hasVideo ? (
                        <video
                          src={videoUrl}
                          controls
                          autoPlay
                          loop
                          className="max-w-full max-h-[75vh] rounded-lg shadow-2xl object-contain"
                        />
                      ) : (
                        <img
                          src={displayImageUrl}
                          alt="Full Preview"
                          className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl"
                        />
                      )}
                    </div>
                  </div>
                </div>,
                document.body
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export const GenericCategoryNode = memo(GenericCategoryNodeComponent);
