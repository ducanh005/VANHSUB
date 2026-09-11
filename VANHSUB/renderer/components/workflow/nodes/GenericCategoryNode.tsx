import React, { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import {
  Sparkles,
  FileVideo,
  Image as ImageIcon,
  Type,
  Volume2,
  Sliders,
  Scissors,
  CheckCircle2,
  AlertCircle,
  Clock,
  Play,
  Share2,
  X,
  Layers,
  Camera,
  ShieldCheck,
  Film,
} from 'lucide-react';
import type { WorkflowNodeData, NodeCategory, PortDataType } from '../../../types/workflow';
import { NODE_DEFINITIONS } from '../../../lib/workflow/nodeRegistry';
import { PORT_STYLES, CATEGORY_STYLES } from '../../../lib/workflow/portColors';
import { useWorkflowStore } from '../../../lib/store/workflowStore';

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

function GenericCategoryNodeComponent({ id, data, selected }: NodeProps<WorkflowNodeType>) {
  const nodeData = data as WorkflowNodeData;
  const def = NODE_DEFINITIONS[nodeData.nodeType];
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const runtime = nodeData.runtime || { status: 'idle' };

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

        <div className="flex items-center gap-1 shrink-0">
          {statusBadge}
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
          {config.prompt && (
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800/60 font-mono text-[10px] text-slate-300 line-clamp-2 leading-relaxed">
              "{config.prompt}"
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
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

        {/* Thumbnail Preview Area for Video/Image outputs */}
        {(category === 'model' || category === 'output') && (
          <div className="w-full h-24 rounded-lg bg-black/50 border border-slate-800/80 flex flex-col items-center justify-center text-slate-500 relative overflow-hidden group">
            {runtime.thumbnailUrl ? (
              <img
                src={runtime.thumbnailUrl}
                alt="Preview"
                className="w-full h-full object-cover rounded-lg"
              />
            ) : runtime.status === 'running' ? (
              <div className="flex flex-col items-center gap-1.5 text-amber-400">
                <Clock className="w-5 h-5 animate-spin" />
                <span className="text-[10px] font-medium tracking-wide">Đang render khung hình...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 text-slate-600">
                <Film className="w-5 h-5" />
                <span className="text-[10px]">Preview sẵn sàng khi chạy</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const GenericCategoryNode = memo(GenericCategoryNodeComponent);
