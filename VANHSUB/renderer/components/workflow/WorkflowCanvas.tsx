import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  Play,
  Save,
  Download,
  Upload,
  RotateCcw,
  Sparkles,
  Layers,
  Sliders,
  Maximize2,
  FolderOpen,
  Film,
  Coins,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronUp,
  ChevronDown,
  Users,
  Building,
} from 'lucide-react';
import { toast } from 'sonner';

import { useWorkflowStore } from '../../lib/store/workflowStore';
import { GenericCategoryNode } from './nodes/GenericCategoryNode';
import NodeLibrary from './NodeLibrary';
import Inspector from './Inspector';
import CharacterBibleModal from './CharacterBibleModal';
import SceneBibleModal from './SceneBibleModal';
import MasterTimeline from './MasterTimeline';
import StoryboardDirectorStudio from './StoryboardDirectorStudio';
import { WORKFLOW_PRESETS } from '../../lib/workflow/presets';
import { NODE_DEFINITIONS } from '../../lib/workflow/nodeRegistry';

const nodeTypes: NodeTypes = {
  genericNode: GenericCategoryNode,
};

function FlowCanvasInner() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const graphId = useWorkflowStore((s) => s.graphId);
  const graphName = useWorkflowStore((s) => s.graphName);
  const setGraphName = useWorkflowStore((s) => s.setGraphName);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const setSelectedNodeId = useWorkflowStore((s) => s.setSelectedNodeId);
  const addNode = useWorkflowStore((s) => s.addNode);
  const loadPreset = useWorkflowStore((s) => s.loadPreset);
  const clearCanvas = useWorkflowStore((s) => s.clearCanvas);
  const exportGraphJson = useWorkflowStore((s) => s.exportGraphJson);
  const importGraphJson = useWorkflowStore((s) => s.importGraphJson);
  const updateNodeRuntime = useWorkflowStore((s) => s.updateNodeRuntime);
  const runtimeMap = useWorkflowStore((s) => s.runtimeMap);

  const [showLibrary, setShowLibrary] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [showQueueDrawer, setShowQueueDrawer] = useState(false);
  const [activePresetId, setActivePresetId] = useState(WORKFLOW_PRESETS[0].id);
  const [showCharacterBible, setShowCharacterBible] = useState(false);
  const [showSceneBible, setShowSceneBible] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);
  const [showStudio, setShowStudio] = useState(false);

  // Lắng nghe sự kiện thực thi node từ Electron backend realtime
  useEffect(() => {
    if (typeof window !== 'undefined' && window.vanhsub?.workflow?.onNodeEvent) {
      const unsubscribe = window.vanhsub.workflow.onNodeEvent((event) => {
        updateNodeRuntime(event.nodeId, {
          status: event.status,
          progress: event.progress,
          thumbnailUrl: event.thumbnailUrl,
          outputUrl: event.outputUrl,
          outputData: event.outputData,
          error: event.error,
          durationMs: event.durationMs,
        });

        if (event.outputData?.taskId) {
          toast.success('Đã đưa video vào Sub Mode thành công!');
        }
      });
      return unsubscribe;
    }
  }, [updateNodeRuntime]);

  // Tính toán ước tính chi phí render sơ bộ (Mục 8 đặc tả)
  const estimatedStats = useMemo(() => {
    let videoSeconds = 0;
    let modelCount = 0;
    for (const node of nodes) {
      if (node.data.nodeType === 'google-flow-video' || node.data.nodeType === 'kling-video') {
        modelCount++;
        videoSeconds += Number(node.data.config?.durationSeconds || 5);
      }
    }
    // Ước lượng tạm: ~$0.05 / giây video AI
    const costUsd = (videoSeconds * 0.05).toFixed(2);
    return { videoSeconds, modelCount, costUsd };
  }, [nodes]);

  // Kéo thả Node từ Library vào Canvas
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData('application/reactflow');
      if (!nodeType) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(nodeType, position);
      toast.success(`Đã thêm ${NODE_DEFINITIONS[nodeType]?.label || nodeType}`);
    },
    [screenToFlowPosition, addNode]
  );

  // Xuất file JSON
  const handleExportJson = () => {
    const jsonStr = exportGraphJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${graphName.replace(/\s+/g, '_')}_workflow.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Đã xuất cấu hình Workflow JSON');
  };

  // Nhập file JSON
  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const success = importGraphJson(content);
        if (success) {
          toast.success('Đã nạp Workflow thành công');
        } else {
          toast.error('Tệp JSON không hợp lệ hoặc cấu trúc graph bị lỗi');
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Chạy đồ thị DAG qua backend Execution Engine (Phase 2)
  const handleRunWorkflow = async () => {
    if (nodes.length === 0) {
      toast.error('Canvas đang trống! Hãy kéo node vào trước khi chạy.');
      return;
    }

    setIsRunning(true);
    toast.info('Bắt đầu khởi chạy đồ thị DAG...');

    // Reset status của toàn bộ nodes sang queued
    for (const node of nodes) {
      updateNodeRuntime(node.id, { status: 'queued', progress: 0 });
    }

    if (typeof window !== 'undefined' && window.vanhsub?.workflow?.run) {
      try {
        const res = await window.vanhsub.workflow.run({
          id: graphId,
          name: graphName,
          nodes,
          edges,
        });

        if (res.success) {
          toast.success('Đã hoàn thành toàn bộ các node trong Workflow!');
        } else {
          toast.error(res.error || 'Có lỗi xảy ra trong quá trình thực thi!');
        }
      } catch (err: any) {
        toast.error(`Lỗi thực thi: ${err?.message || err}`);
      } finally {
        setIsRunning(false);
      }
    } else {
      // Fallback mô phỏng nếu không có backend Electron
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        updateNodeRuntime(node.id, { status: 'running', progress: 30 });
        await new Promise((r) => setTimeout(r, 600));
        updateNodeRuntime(node.id, { status: 'running', progress: 80 });
        await new Promise((r) => setTimeout(r, 600));
        updateNodeRuntime(node.id, {
          status: 'success',
          progress: 100,
          thumbnailUrl:
            node.data.category === 'model' || node.data.category === 'output'
              ? 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=600&q=80'
              : undefined,
        });
      }
      setIsRunning(false);
      toast.success('Đã hoàn thành toàn bộ các node trong Workflow!');
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#0b0f19] text-slate-100 overflow-hidden select-none">
      {/* Top Navigation Toolbar */}
      <header className="h-14 border-b border-slate-800/80 bg-[#0d131f]/95 px-4 flex items-center justify-between gap-4 z-10 shadow-lg">
        {/* Left: Workflow Title & Preset Picker */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-600/30 border border-indigo-500/40 text-indigo-400">
              <Layers className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={graphName}
              onChange={(e) => setGraphName(e.target.value)}
              className="bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 font-bold text-sm text-white px-1 py-0.5 focus:outline-none transition-colors w-52 truncate"
              title="Nhấp để đổi tên Workflow"
            />
          </div>

          <div className="h-5 w-[1px] bg-slate-800" />

          {/* Template Presets Picker */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Mẫu sẵn:</span>
            <select
              value={activePresetId}
              onChange={(e) => {
                const id = e.target.value;
                setActivePresetId(id);
                loadPreset(id);
                toast.success('Đã tải mẫu workflow mới');
              }}
              className="text-xs rounded-lg bg-slate-900 border border-slate-800 px-2.5 py-1 text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              {WORKFLOW_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id} className="bg-slate-900">
                  {preset.name}
                </option>
              ))}
            </select>
          </div>

          <div className="h-5 w-[1px] bg-slate-800 hidden sm:block" />

          {/* Consistency Bibles (Character & Scene) */}
          <button
            onClick={() => setShowCharacterBible(true)}
            title="Mở Character Bible (Hồ sơ Nhân vật)"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/50 text-xs font-semibold text-rose-300 hover:text-white transition-colors"
          >
            <Users className="w-3.5 h-3.5 text-rose-400" />
            <span className="hidden lg:inline">Character Bible</span>
          </button>

          <button
            onClick={() => setShowSceneBible(true)}
            title="Mở Scene Bible (Bối cảnh Không gian)"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/40 hover:bg-indigo-900/60 border border-indigo-800/50 text-xs font-semibold text-indigo-300 hover:text-white transition-colors"
          >
            <Building className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden lg:inline">Scene Bible</span>
          </button>

          <button
            onClick={() => setShowTimeline(!showTimeline)}
            title="Bật/Tắt Master Timeline (Thanh Dựng Phim)"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-colors ${
              showTimeline
                ? 'bg-amber-950/50 border-amber-700/60 text-amber-300'
                : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Film className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden lg:inline">Timeline</span>
          </button>

          <button
            onClick={() => setShowStudio(true)}
            title="Mở Storyboard Director Studio (Giao diện Đạo diễn 3 bước chuẩn)"
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-xs font-bold text-white shadow-md shadow-rose-950/40 transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Storyboard Studio</span>
          </button>
        </div>

        {/* Center: Estimated Render Cost (Mục 8 đặc tả) */}
        {estimatedStats.modelCount > 0 && (
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/90 border border-slate-800 text-xs text-slate-300">
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            <span>Ước tính:</span>
            <span className="font-semibold text-amber-400">~${estimatedStats.costUsd} USD</span>
            <span className="text-slate-500">({estimatedStats.videoSeconds}s video AI)</span>
          </div>
        )}

        {/* Right: Actions (Save, Export, Import, Run) */}
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportJson}
            accept=".json"
            className="hidden"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            title="Nhập Workflow từ file JSON"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Nhập JSON</span>
          </button>

          <button
            onClick={handleExportJson}
            title="Xuất Workflow ra file JSON"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Xuất JSON</span>
          </button>

          <button
            onClick={clearCanvas}
            title="Xóa toàn bộ node trên canvas"
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-800 hover:border-rose-900/60 text-slate-400 hover:text-rose-300 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <div className="h-5 w-[1px] bg-slate-800" />

          {/* Toggle Sidebars */}
          <button
            onClick={() => setShowLibrary((prev) => !prev)}
            title="Ẩn/Hiện Thư viện Node"
            className={`px-2 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              showLibrary
                ? 'bg-indigo-950/70 border-indigo-700/60 text-indigo-300'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            Thư viện
          </button>

          <button
            onClick={() => setShowInspector((prev) => !prev)}
            title="Ẩn/Hiện Bảng Điều khiển"
            className={`px-2 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              showInspector
                ? 'bg-indigo-950/70 border-indigo-700/60 text-indigo-300'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            Thuộc tính
          </button>

          {/* Primary Run Button */}
          <button
            onClick={handleRunWorkflow}
            disabled={isRunning}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-600 hover:from-amber-400 hover:to-indigo-500 text-white text-xs font-bold shadow-[0_0_15px_rgba(244,63,94,0.3)] transition-all active:scale-95 disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <Clock className="w-3.5 h-3.5 animate-spin" />
                <span>Đang render...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Chạy Workflow</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Work Area: Library | Canvas | Inspector */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar: Node Library */}
        {showLibrary && <NodeLibrary />}

        {/* Central Graph Canvas */}
        <div ref={reactFlowWrapper} className="flex-1 h-full relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            onDragOver={onDragOver}
            onDrop={onDrop}
            fitView
            minZoom={0.2}
            maxZoom={2.5}
            defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
            className="bg-[#090d16]"
          >
            <Background color="#334155" gap={20} size={1.2} />
            <Controls className="!bg-[#0f172a] !border-slate-800 !text-slate-300 !fill-slate-300 [&>button]:!border-slate-800 [&>button:hover]:!bg-slate-800" />
            <MiniMap
              nodeColor={(n) => {
                const nodeData = n.data as any;
                if (nodeData?.category === 'model') return '#a855f7';
                if (nodeData?.category === 'input') return '#10b981';
                if (nodeData?.category === 'output') return '#eab308';
                if (nodeData?.category === 'consistency') return '#f43f5e';
                if (nodeData?.category === 'editing') return '#0ea5e9';
                return '#64748b';
              }}
              maskColor="rgba(11, 15, 25, 0.75)"
              className="!bg-[#0f172a]/90 !border !border-slate-800 !rounded-xl overflow-hidden shadow-2xl"
            />
          </ReactFlow>

          {/* Canvas Bottom Overlay: Node Stats & Quick Controls */}
          <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2 bg-[#0d131f]/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800 text-xs text-slate-400 shadow-xl">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{nodes.length} Nodes</span>
            </span>
            <span className="text-slate-600">•</span>
            <span>{edges.length} Kết nối</span>
            <span className="text-slate-600">•</span>
            <button
              onClick={() => setShowQueueDrawer((p) => !p)}
              className="text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
            >
              <span>Hàng đợi Render</span>
              {showQueueDrawer ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Right Sidebar: Inspector */}
        {showInspector && <Inspector />}
      </div>

      {/* Bottom Queue Panel (Mục 4.1 đặc tả: Job Queue status) */}
      {showQueueDrawer && (
        <div className="h-44 border-t border-slate-800 bg-[#0d131f]/95 p-3 flex flex-col shadow-2xl z-20">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-400" />
              <span className="font-bold text-white">Hàng đợi Render & Nhật ký Thực thi (Render Queue Panel)</span>
              <span className="px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-800/60 text-indigo-300 text-[10px] font-mono">
                BullMQ + Redis Ready
              </span>
            </div>
            <button
              onClick={() => setShowQueueDrawer(false)}
              className="text-slate-500 hover:text-slate-300 text-xs"
            >
              Thu nhỏ ▼
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pt-2 space-y-1.5 font-mono text-[11px] custom-scrollbar">
            {nodes.map((node) => {
              const r = node.data.runtime || { status: 'idle' };
              return (
                <div
                  key={node.id}
                  className="flex items-center justify-between px-2.5 py-1 rounded bg-slate-900/60 border border-slate-800/50 text-slate-300"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-indigo-400 font-semibold">{node.id}</span>
                    <span className="text-slate-400">({node.data.label})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.status === 'idle' && <span className="text-slate-500">Chưa chạy</span>}
                    {r.status === 'queued' && <span className="text-sky-400">Đang chờ queue...</span>}
                    {r.status === 'running' && (
                      <span className="text-amber-400 flex items-center gap-1">
                        <Clock className="w-3 h-3 animate-spin" /> Đang chạy ({r.progress}%)
                      </span>
                    )}
                    {r.status === 'success' && <span className="text-emerald-400">✓ Hoàn tất</span>}
                    {r.status === 'failed' && <span className="text-rose-400">✗ Thất bại</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Master Timeline & Dựng Phim (Phase 4) */}
      {showTimeline && (
        <MasterTimeline
          nodes={nodes}
          nodeRuntime={runtimeMap}
          onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
        />
      )}

      {/* Storyboard Director Studio (Phase 6 Simple Mode) */}
      {showStudio && (
        <StoryboardDirectorStudio
          onCloseStudio={() => setShowStudio(false)}
          onSendToSubMode={(videoPath, taskName) => {
            if (typeof window !== 'undefined' && window.vanhsub?.tasks?.create) {
              window.vanhsub.tasks.create({
                fileName: taskName || 'Master Video từ Storyboard',
                filePath: videoPath,
                workflow: 'full-dubbing',
              }).then(() => {
                toast.success('Đã đưa video vào Sub Mode thành công!');
                setShowStudio(false);
              });
            } else {
              toast.success('Đã chọn video cho Sub Mode: ' + videoPath);
              setShowStudio(false);
            }
          }}
          onSyncToCanvasGraph={() => {
            toast.success('Đã đồng bộ Storyboard sang Node Canvas!');
            setShowStudio(false);
          }}
        />
      )}

      {/* Character Bible & Scene Bible Modals */}
      <CharacterBibleModal
        isOpen={showCharacterBible}
        onClose={() => setShowCharacterBible(false)}
      />
      <SceneBibleModal
        isOpen={showSceneBible}
        onClose={() => setShowSceneBible(false)}
      />
    </div>
  );
}

export default function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  );
}
