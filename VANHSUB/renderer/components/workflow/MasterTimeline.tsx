import React, { useState } from 'react';
import {
  Film,
  Play,
  ChevronUp,
  ChevronDown,
  Layers,
  ArrowRight,
  Clock,
  CheckCircle2,
  Trash2,
  MoveLeft,
  MoveRight,
  Sparkles,
  Subtitles,
  Download,
  X,
  Volume2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Node } from '@xyflow/react';
import type { WorkflowNodeData } from '../../types/workflow';

export interface TimelineShot {
  id: string;
  nodeId: string;
  label: string;
  nodeType: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  durationSeconds: number;
  status: 'idle' | 'running' | 'success' | 'failed';
}

interface MasterTimelineProps {
  nodes: Node<WorkflowNodeData>[];
  nodeRuntime: Record<string, any>;
  onSelectNode: (nodeId: string) => void;
  onSendToSubMode?: (videoPath: string, shotName: string) => void;
}

export default function MasterTimeline({
  nodes,
  nodeRuntime,
  onSelectNode,
  onSendToSubMode,
}: MasterTimelineProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [previewShotName, setPreviewShotName] = useState<string>('');
  const [isAssembling, setIsAssembling] = useState(false);
  const [masterVideoUrl, setMasterVideoUrl] = useState<string | null>(null);

  // Tìm tất cả các node liên quan tới video trong đồ thị
  const videoNodeTypes = [
    'google-flow-video',
    'kling-video',
    'trim',
    'concat',
    'transition',
    'color-match',
    'upscale',
    'export-video',
    'load-video',
  ];

  const videoNodes = nodes.filter((n) => videoNodeTypes.includes(n.data.nodeType));

  // Tạo danh sách shots dựa trên node và kết quả runtime
  const shots: TimelineShot[] = videoNodes.map((n, idx) => {
    const runtime = nodeRuntime[n.id];
    const outData = runtime?.outputData;
    const videoUrl = runtime?.outputUrl || outData?.video || outData?.video_out || n.data.config.videoUrl;
    const thumbnailUrl = runtime?.thumbnailUrl || outData?.last_frame || outData?.lastFrameUrl;
    const durationSeconds = Number(outData?.duration || n.data.config.durationSeconds || 5);

    return {
      id: `shot-${n.id}`,
      nodeId: n.id,
      label: n.data.label || `Shot ${idx + 1}: ${n.data.nodeType}`,
      nodeType: n.data.nodeType,
      videoUrl,
      thumbnailUrl,
      durationSeconds,
      status: runtime?.status || 'idle',
    };
  });

  const totalDuration = shots.reduce((sum, s) => sum + (s.videoUrl ? s.durationSeconds : 0), 0);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Ghép toàn bộ các shot đã có video thành 1 sequence hoàn chỉnh
  const handleAssembleSequence = async () => {
    const readyClips = shots.filter((s) => s.videoUrl).map((s) => s.videoUrl as string);
    if (readyClips.length === 0) {
      toast.error('Chưa có clip video nào được render xong để ghép!');
      return;
    }

    if (readyClips.length === 1) {
      setMasterVideoUrl(readyClips[0]);
      toast.success('Đã chọn clip hoàn chỉnh!');
      return;
    }

    setIsAssembling(true);
    toast.info(`Đang ghép nối ${readyClips.length} clips thành Master Sequence bằng FFmpeg...`);

    try {
      if (typeof window !== 'undefined' && window.vanhsub?.workflow?.concatClips) {
        const outPath = await window.vanhsub.workflow.concatClips(readyClips);
        setMasterVideoUrl(outPath);
        toast.success('Đã xuất Master Sequence thành công!');
      } else {
        toast.success(`Giả lập ghép ${readyClips.length} clips hoàn tất!`);
        setMasterVideoUrl(readyClips[0]);
      }
    } catch (err: any) {
      console.error('Lỗi ghép master sequence:', err);
      toast.error(`Lỗi khi ghép sequence: ${err?.message || err}`);
    } finally {
      setIsAssembling(false);
    }
  };

  // Chuyển video hoàn thiện sang Sub Mode
  const handleSendMasterToSubMode = async () => {
    const targetVideo = masterVideoUrl || shots.find((s) => s.videoUrl)?.videoUrl;
    if (!targetVideo) {
      toast.error('Chưa có video để chuyển sang Sub Mode!');
      return;
    }

    if (onSendToSubMode) {
      onSendToSubMode(targetVideo, `Master Sequence (${shots.length} shots)`);
    } else if (typeof window !== 'undefined' && window.vanhsub?.tasks?.create) {
      try {
        await window.vanhsub.tasks.create({
          fileName: `Master Sequence (${new Date().toLocaleTimeString()})`,
          filePath: targetVideo,
          workflow: 'full-dubbing',
        });
        toast.success('Đã chuyển Master Video sang Sub Mode! Bạn có thể chuyển tab để làm phụ đề.');
      } catch (err: any) {
        toast.error('Lỗi khi chuyển sang Sub Mode: ' + err?.message);
      }
    }
  };

  return (
    <>
      <div
        className={`fixed bottom-0 left-0 right-0 z-20 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800/80 transition-all duration-300 shadow-2xl ${
          isExpanded ? 'h-52' : 'h-11'
        }`}
      >
        {/* Header bar */}
        <div className="h-11 px-4 flex items-center justify-between border-b border-slate-800/60 select-none">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1.5 text-xs font-bold text-white hover:text-rose-400 transition-colors"
            >
              <Film className="w-4 h-4 text-rose-500" />
              <span>Master Timeline & Dựng Phim</span>
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
              )}
            </button>

            <span className="text-slate-600">|</span>

            {/* Badges overview */}
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 font-mono">
                {shots.length} shots
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-emerald-400 font-mono flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatTime(totalDuration)}
              </span>
            </div>
          </div>

          {/* Quick Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleAssembleSequence}
              disabled={isAssembling || shots.length === 0}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white flex items-center gap-1.5 shadow-sm transition-all"
              title="Ghép nối toàn bộ clips đã render thành một video liền mạch"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isAssembling ? 'Đang ghép...' : 'Ghép Sequence'}</span>
            </button>

            <button
              onClick={handleSendMasterToSubMode}
              disabled={!masterVideoUrl && !shots.some((s) => s.videoUrl)}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white flex items-center gap-1.5 shadow-sm transition-all"
              title="Gửi sang Sub Mode để làm phụ đề và thuyết minh"
            >
              <Subtitles className="w-3.5 h-3.5" />
              <span>Sang Sub Mode</span>
            </button>
          </div>
        </div>

        {/* Filmstrip content */}
        {isExpanded && (
          <div className="h-[calc(100%-44px)] p-3 overflow-x-auto overflow-y-hidden custom-scrollbar flex items-center gap-3">
            {shots.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs py-4">
                <Layers className="w-8 h-8 text-slate-600 mb-1.5" />
                <p>Chưa có node video nào trong workflow.</p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Kéo các node như Google Flow Video, Kling, Trim, Concat để lắp ráp sequence phim.
                </p>
              </div>
            ) : (
              shots.map((shot, index) => (
                <div
                  key={shot.id}
                  className={`group relative flex-shrink-0 w-48 h-32 rounded-xl border bg-slate-900/90 overflow-hidden flex flex-col transition-all hover:scale-[1.02] ${
                    shot.status === 'success'
                      ? 'border-emerald-700/60 shadow-lg shadow-emerald-950/20'
                      : shot.status === 'running'
                      ? 'border-amber-500 animate-pulse'
                      : 'border-slate-800'
                  }`}
                >
                  {/* Top Header */}
                  <div className="px-2 py-1 bg-slate-950/80 flex items-center justify-between border-b border-slate-800 text-[11px]">
                    <span className="font-mono font-bold text-slate-300">
                      #{index + 1}
                    </span>
                    <span className="text-[10px] text-slate-400 truncate max-w-[90px]">
                      {shot.nodeType}
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-1 rounded">
                      {shot.durationSeconds}s
                    </span>
                  </div>

                  {/* Thumbnail / Video Preview area */}
                  <div
                    onClick={() => onSelectNode(shot.nodeId)}
                    className="flex-1 relative bg-slate-950 cursor-pointer flex items-center justify-center overflow-hidden"
                  >
                    {shot.thumbnailUrl ? (
                      <img
                        src={shot.thumbnailUrl.startsWith('data:') ? shot.thumbnailUrl : `file://${shot.thumbnailUrl}`}
                        alt={shot.label}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // Fallback nếu không load được file://
                          (e.target as any).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-slate-600 text-[11px] p-2 text-center">
                        <Film className="w-5 h-5 mb-1" />
                        <span className="truncate max-w-[140px]">{shot.label}</span>
                      </div>
                    )}

                    {/* Play button overlay if video is available */}
                    {shot.videoUrl && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewVideoUrl(shot.videoUrl!);
                          setPreviewShotName(shot.label);
                        }}
                        className="absolute inset-0 bg-black/40 hover:bg-black/20 flex items-center justify-center transition-colors group-hover:opacity-100"
                        title="Xem trước clip này"
                      >
                        <div className="w-8 h-8 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-lg hover:scale-110 transition-transform">
                          <Play className="w-4 h-4 ml-0.5 fill-current" />
                        </div>
                      </button>
                    )}

                    {/* Status badge */}
                    <div className="absolute bottom-1 right-1">
                      {shot.status === 'success' && (
                        <span className="p-0.5 bg-emerald-950/90 text-emerald-400 rounded-full flex">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </span>
                      )}
                      {shot.status === 'running' && (
                        <span className="px-1.5 py-0.5 bg-amber-950/90 text-amber-400 text-[9px] rounded font-bold">
                          Đang render
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Footer label */}
                  <div
                    onClick={() => onSelectNode(shot.nodeId)}
                    className="px-2 py-1 bg-slate-950/90 text-[11px] text-slate-300 truncate cursor-pointer hover:text-white"
                    title={shot.label}
                  >
                    {shot.label}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Video Preview Modal */}
      {previewVideoUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
          <div className="relative w-full max-w-3xl bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="px-4 py-3 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 text-rose-500 fill-current" />
                <span className="text-sm font-bold text-white truncate max-w-md">
                  Xem trước: {previewShotName}
                </span>
              </div>
              <button
                onClick={() => setPreviewVideoUrl(null)}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Video Player */}
            <div className="relative aspect-video bg-black flex items-center justify-center">
              <video
                src={previewVideoUrl.startsWith('http') ? previewVideoUrl : `file://${previewVideoUrl}`}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 bg-slate-900/60 flex items-center justify-between text-xs text-slate-400">
              <span className="truncate font-mono text-[11px]">
                {previewVideoUrl}
              </span>
              <button
                onClick={() => {
                  if (onSendToSubMode) {
                    onSendToSubMode(previewVideoUrl, previewShotName);
                  }
                  setPreviewVideoUrl(null);
                }}
                className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-medium flex items-center gap-1.5 transition-colors"
              >
                <Subtitles className="w-3.5 h-3.5" />
                <span>Gửi clip này sang Sub Mode</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
