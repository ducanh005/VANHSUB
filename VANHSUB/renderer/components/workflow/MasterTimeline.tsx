import React, { useState } from 'react';
import {
  Film,
  Play,
  ChevronUp,
  ChevronDown,
  Layers,
  Clock,
  CheckCircle2,
  Sparkles,
  Subtitles,
  X,
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
        className={`fixed bottom-0 left-0 right-0 z-20 bg-surface border-t border-border transition-all duration-200 shadow-none ${
          isExpanded ? 'h-52' : 'h-11'
        }`}
      >
        {/* Header bar */}
        <div className="h-11 px-4 flex items-center justify-between border-b border-border select-none bg-surface">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1.5 text-xs font-medium text-text hover:text-accent transition-colors"
            >
              <Film className="w-4 h-4 text-accent" />
              <span className="font-semibold">Master Timeline & Dựng Phim</span>
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
              )}
            </button>

            <span className="text-text-faint">|</span>

            {/* Badges overview */}
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded-md bg-surface-2 border border-border text-text font-mono text-[11px]">
                {shots.length} shots
              </span>
              <span className="px-2 py-0.5 rounded-md bg-surface-2 border border-border text-success font-mono text-[11px] flex items-center gap-1">
                <Clock className="w-3 h-3 text-success" />
                {formatTime(totalDuration)}
              </span>
            </div>
          </div>

          {/* Quick Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleAssembleSequence}
              disabled={isAssembling || shots.length === 0}
              className="px-2.5 py-1 text-xs font-medium rounded-md bg-surface-2 hover:bg-surface-3 text-text border border-border disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors duration-150"
              title="Ghép nối toàn bộ clips đã render thành một video liền mạch"
            >
              <Sparkles className="w-3.5 h-3.5 text-text-muted" />
              <span>{isAssembling ? 'Đang ghép...' : 'Ghép Sequence'}</span>
            </button>

            <button
              onClick={handleSendMasterToSubMode}
              disabled={!masterVideoUrl && !shots.some((s) => s.videoUrl)}
              className="px-2.5 py-1 text-xs font-medium rounded-md bg-accent hover:bg-accent-hover active:scale-[0.98] text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors duration-150"
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
              <div className="flex-1 flex flex-col items-center justify-center text-text-muted text-xs py-4">
                <Layers className="w-8 h-8 text-text-faint mb-1.5" />
                <p>Chưa có node video nào trong workflow.</p>
                <p className="text-[11px] text-text-faint mt-0.5">
                  Kéo các node như Google Flow Video, Kling, Trim, Concat để lắp ráp sequence phim.
                </p>
              </div>
            ) : (
              shots.map((shot, index) => (
                <div
                  key={shot.id}
                  className={`group relative flex-shrink-0 w-48 h-32 rounded-md border bg-surface-2 overflow-hidden flex flex-col transition-all hover:scale-[1.02] ${
                    shot.status === 'success'
                      ? 'border-success/60'
                      : shot.status === 'running'
                      ? 'border-warning animate-pulse'
                      : 'border-border hover:border-border-strong'
                  }`}
                >
                  {/* Top Header */}
                  <div className="px-2 py-1 bg-surface-3 flex items-center justify-between border-b border-border text-[11px]">
                    <span className="font-mono font-semibold text-text">
                      #{index + 1}
                    </span>
                    <span className="text-[10px] text-text-muted truncate max-w-[90px]">
                      {shot.nodeType}
                    </span>
                    <span className="text-[10px] font-mono text-success bg-success/15 px-1.5 py-0.5 rounded-sm">
                      {shot.durationSeconds}s
                    </span>
                  </div>

                  {/* Thumbnail / Video Preview area */}
                  <div
                    onClick={() => onSelectNode(shot.nodeId)}
                    className="flex-1 relative bg-bg cursor-pointer flex items-center justify-center overflow-hidden"
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
                      <div className="flex flex-col items-center justify-center text-text-faint text-[11px] p-2 text-center">
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
                        <div className="w-8 h-8 rounded-full bg-accent hover:bg-accent-hover text-white flex items-center justify-center hover:scale-110 transition-transform">
                          <Play className="w-4 h-4 ml-0.5 fill-current" />
                        </div>
                      </button>
                    )}

                    {/* Status badge */}
                    <div className="absolute bottom-1 right-1">
                      {shot.status === 'success' && (
                        <span className="p-0.5 bg-surface-3/90 text-success border border-success/30 rounded-full flex">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </span>
                      )}
                      {shot.status === 'running' && (
                        <span className="px-1.5 py-0.5 bg-surface-3/90 text-warning border border-warning/30 text-[9px] rounded-sm font-medium">
                          Đang render
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Footer label */}
                  <div
                    onClick={() => onSelectNode(shot.nodeId)}
                    className="px-2 py-1 bg-surface-3/60 border-t border-border text-[11px] text-text-muted hover:text-text truncate cursor-pointer transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6">
          <div className="relative w-full max-w-3xl bg-surface border border-border rounded-lg shadow-none overflow-hidden">
            {/* Modal Header */}
            <div className="px-4 py-3 flex items-center justify-between border-b border-border bg-surface">
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 text-accent fill-current" />
                <span className="text-sm font-semibold text-text truncate max-w-md">
                  Xem trước: {previewShotName}
                </span>
              </div>
              <button
                onClick={() => setPreviewVideoUrl(null)}
                className="p-1 text-text-muted hover:text-text hover:bg-surface-2 rounded-md transition-colors"
                title="Đóng xem trước"
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
            <div className="px-4 py-3 bg-surface-2 border-t border-border flex items-center justify-between text-xs text-text-muted">
              <span className="truncate font-mono text-[11px] text-text-muted">
                {previewVideoUrl}
              </span>
              <button
                onClick={() => {
                  if (onSendToSubMode) {
                    onSendToSubMode(previewVideoUrl, previewShotName);
                  }
                  setPreviewVideoUrl(null);
                }}
                className="px-3 py-1.5 rounded-md bg-accent hover:bg-accent-hover active:scale-[0.98] text-white font-medium flex items-center gap-1.5 transition-colors duration-150"
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
