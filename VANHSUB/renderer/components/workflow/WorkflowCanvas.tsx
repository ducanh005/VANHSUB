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
  Minimize2,
  FolderOpen,
  Film,
  Coins,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Users,
  Building,
  Key,
  Settings,
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
import ApiKeyConfigModal from './ApiKeyConfigModal';
import { WORKFLOW_PRESETS } from '../../lib/workflow/presets';
import { NODE_DEFINITIONS } from '../../lib/workflow/nodeRegistry';
import { calculateGraphCreditEstimate } from '../../lib/workflow/creditCalculator';

function GoogleIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.4 7.33 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.16 0 9.98 0 12s.45 3.84 1.24 5.42l4.04-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.6 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}

const nodeTypes: NodeTypes = {
  genericNode: GenericCategoryNode,
};

export interface WorkflowCanvasProps {
  onNavigateTab?: (tab: string) => void;
  isZenMode?: boolean;
  onToggleZenMode?: (zen: boolean) => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

function FlowCanvasInner({
  onNavigateTab,
  isZenMode = false,
  onToggleZenMode,
  isSidebarCollapsed,
  onToggleSidebar,
}: WorkflowCanvasProps) {
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
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const addNode = useWorkflowStore((s) => s.addNode);
  const loadPreset = useWorkflowStore((s) => s.loadPreset);
  const clearCanvas = useWorkflowStore((s) => s.clearCanvas);
  const exportGraphJson = useWorkflowStore((s) => s.exportGraphJson);
  const importGraphJson = useWorkflowStore((s) => s.importGraphJson);
  const updateNodeRuntime = useWorkflowStore((s) => s.updateNodeRuntime);
  const runtimeMap = useWorkflowStore((s) => s.runtimeMap);
  const savedWorkflows = useWorkflowStore((s) => s.savedWorkflows);
  const saveCurrentWorkflow = useWorkflowStore((s) => s.saveCurrentWorkflow);
  const loadSavedWorkflow = useWorkflowStore((s) => s.loadSavedWorkflow);

  const [showLibrary, setShowLibrary] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [showQueueDrawer, setShowQueueDrawer] = useState(false);
  const [queueHeight, setQueueHeight] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('vanhsub_workflow_queue_height');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 140 && parsed <= 650) return parsed;
      }
    }
    return 240;
  });
  const [isQueueMaximized, setIsQueueMaximized] = useState(false);
  const [isQueueDragging, setIsQueueDragging] = useState(false);
  const queueDragStartY = useRef(0);
  const queueDragStartHeight = useRef(240);

  const [activePresetId, setActivePresetId] = useState(WORKFLOW_PRESETS[0].id);
  const [showCharacterBible, setShowCharacterBible] = useState(false);
  const [showSceneBible, setShowSceneBible] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);
  const [showStudio, setShowStudio] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [veoMode, setVeoMode] = useState<'free_session' | 'api_key' | 'simulation'>('free_session');
  const [veoSessionStatus, setVeoSessionStatus] = useState<string>('unknown');
  const [veoEmail, setVeoEmail] = useState<string | null>(null);
  const [isOpeningGoogle, setIsOpeningGoogle] = useState(false);

  // Kiểm tra key & Veo status hiện tại
  const checkVeoStatus = useCallback(async () => {
    if (typeof window !== 'undefined' && window.vanhsub?.veo?.status) {
      try {
        const res = await window.vanhsub.veo.status();
        if (res.mode) setVeoMode(res.mode);
        if (res.sessionStatus) setVeoSessionStatus(res.sessionStatus);
        if (res.email) setVeoEmail(res.email);
      } catch {}
    }
    if (typeof window !== 'undefined' && window.vanhsub?.settings) {
      window.vanhsub.settings
        .get('geminiApiKey')
        .then((k) => setHasGeminiKey(Boolean(typeof k === 'string' && k.trim())))
        .catch(() => setHasGeminiKey(false));
    }
  }, []);

  const handleOpenGoogleLogin = async () => {
    setIsOpeningGoogle(true);
    try {
      if (typeof window !== 'undefined' && window.vanhsub?.veo?.openLobby) {
        await window.vanhsub.veo.openLobby();
        toast.info('Đang mở cửa sổ đăng nhập Google. Hãy hoàn tất đăng nhập tài khoản Google của bạn.');
        setTimeout(() => {
          checkVeoStatus();
        }, 3000);
      } else {
        setShowApiKeyModal(true);
      }
    } catch (err: any) {
      toast.error('Lỗi khi mở đăng nhập Google: ' + (err?.message || err));
    } finally {
      setIsOpeningGoogle(false);
    }
  };

  const handleQueueResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsQueueDragging(true);
    queueDragStartY.current = e.clientY;
    queueDragStartHeight.current = queueHeight;
  };

  useEffect(() => {
    if (!isQueueDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = queueDragStartY.current - e.clientY;
      const newHeight = Math.min(Math.max(queueDragStartHeight.current + deltaY, 140), 650);
      setQueueHeight(newHeight);
      if (isQueueMaximized) setIsQueueMaximized(false);
    };

    const handleMouseUp = () => {
      setIsQueueDragging(false);
      setQueueHeight((h) => {
        try {
          localStorage.setItem('vanhsub_workflow_queue_height', String(h));
        } catch {}
        return h;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isQueueDragging, isQueueMaximized]);

  useEffect(() => {
    checkVeoStatus();
  }, [checkVeoStatus]);

  // Thoát Zen Mode bằng phím Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isZenMode) {
        if (onToggleZenMode) onToggleZenMode(false);
        setShowLibrary(true);
        setShowInspector(true);
        setShowTimeline(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isZenMode, onToggleZenMode]);

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

  // Tính toán ước tính chi phí render sơ bộ & Credits (Mục 8 đặc tả & Credit Calculator)
  const estimatedStats = useMemo(() => {
    return calculateGraphCreditEstimate(nodes);
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

    // Thông báo trạng thái Google Flow / Veo
    const hasVeoNode = nodes.some((n) => n.data?.nodeType === 'google-flow-video');
    if (hasVeoNode && veoMode === 'free_session') {
      if (veoSessionStatus === 'expired' || veoSessionStatus === 'unauthenticated') {
        toast.warning(
          '⚠️ Chưa đăng nhập Session Google Flow: Sẽ tự động dùng bộ mô phỏng offline (FFmpeg) để workflow hoàn thành trọn vẹn. Bạn có thể bấm "Đăng nhập Google" trên thanh công cụ bất kỳ lúc nào để nhận video AI thật.',
          { duration: 6000 }
        );
      }
    }

    setIsRunning(true);
    if (estimatedStats.totalCredits > 0) {
      toast.info(
        `Bắt đầu chạy Workflow (${estimatedStats.modelCount} node AI). Dự kiến tiêu tốn: ~${estimatedStats.totalCredits} Credits (~$${estimatedStats.totalCostUsd} USD)`
      );
    } else {
      toast.info('Bắt đầu khởi chạy đồ thị DAG...');
    }

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
      <header className="h-14 shrink-0 border-b border-slate-800/80 bg-[#0d131f]/95 px-4 flex items-center justify-between gap-3 z-10 shadow-lg overflow-x-auto custom-scrollbar min-w-0">
        {/* Left: Workflow Title & Preset Picker */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-600/30 border border-indigo-500/40 text-indigo-400">
              <Layers className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={graphName}
              onChange={(e) => setGraphName(e.target.value)}
              className="bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 font-bold text-sm text-white px-1 py-0.5 focus:outline-none transition-colors w-44 lg:w-52 truncate"
              title="Nhấp để đổi tên Workflow"
            />
          </div>

          <div className="h-5 w-[1px] bg-slate-800" />

          {/* Template Presets Picker */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 hidden sm:inline">Mẫu:</span>
            <select
              value={activePresetId}
              onChange={(e) => {
                const id = e.target.value;
                setActivePresetId(id);
                if (id.startsWith('saved_')) {
                  const savedId = id.replace('saved_', '');
                  loadSavedWorkflow(savedId);
                  toast.success('Đã tải workflow đã lưu');
                } else {
                  loadPreset(id);
                  toast.success('Đã tải mẫu workflow mới');
                }
              }}
              className="text-xs rounded-lg bg-slate-900 border border-slate-800 px-2.5 py-1 text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              {savedWorkflows.length > 0 && (
                <optgroup label="Workflow đã lưu của bạn">
                  {savedWorkflows.map((sw) => (
                    <option key={sw.id} value={`saved_${sw.id}`}>
                      ⭐ {sw.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Mẫu tích hợp sẵn">
                {WORKFLOW_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id} className="bg-slate-900">
                    {preset.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="h-5 w-[1px] bg-slate-800 hidden sm:block" />

          {/* Consistency Bibles (Character & Scene) */}
          <button
            onClick={() => setShowCharacterBible(true)}
            title="Mở Character Bible (Hồ sơ Nhân vật)"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/50 text-xs font-semibold text-rose-300 hover:text-white transition-colors shrink-0 cursor-pointer"
          >
            <Users className="w-3.5 h-3.5 text-rose-400" />
            <span className="hidden lg:inline">Character Bible</span>
          </button>

          <button
            onClick={() => setShowSceneBible(true)}
            title="Mở Scene Bible (Bối cảnh Không gian)"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/40 hover:bg-indigo-900/60 border border-indigo-800/50 text-xs font-semibold text-indigo-300 hover:text-white transition-colors shrink-0 cursor-pointer"
          >
            <Building className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden lg:inline">Scene Bible</span>
          </button>

          <button
            onClick={() => setShowTimeline(!showTimeline)}
            title="Bật/Tắt Master Timeline (Thanh Dựng Phim)"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
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
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-xs font-bold text-white shadow-md shadow-rose-950/40 transition-all shrink-0 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Storyboard Studio</span>
          </button>
        </div>

        {/* Center: Estimated Render Cost & Credits (Mục 8 đặc tả & Credit Calculator) */}
        {estimatedStats.modelCount > 0 && (
          <div className="hidden xl:flex items-center gap-2.5 px-3.5 py-1 rounded-full bg-slate-900/90 border border-amber-800/60 text-xs text-slate-300 shrink-0 shadow-sm">
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-400">Dự tính tiêu tốn:</span>
            <span className="font-bold font-mono text-amber-300">~{estimatedStats.totalCredits} Credits</span>
            <span className="text-slate-500 font-mono">(~${estimatedStats.totalCostUsd} USD)</span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-400">{estimatedStats.videoSeconds}s video ({estimatedStats.modelCount} nodes)</span>
          </div>
        )}

        {/* Right: Actions (Save, Export, Import, Run) */}
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportJson}
            accept=".json"
            className="hidden"
          />

          <button
            onClick={() => {
              saveCurrentWorkflow();
              toast.success(`Đã lưu workflow "${graphName}" thành công!`);
            }}
            title="Lưu workflow hiện tại vào bộ nhớ máy"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-700/60 text-xs font-bold text-emerald-300 hover:text-white transition-colors cursor-pointer shadow-sm"
          >
            <Save className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Lưu Workflow</span>
          </button>

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

          {/* Google Login / Veo Session Integration */}
          <div className="flex items-center gap-1.5 bg-slate-900/80 p-0.5 rounded-lg border border-slate-800">
            {veoMode === 'free_session' ? (
              veoSessionStatus === 'active' ? (
                <button
                  onClick={() => setShowApiKeyModal(true)}
                  title={`Google Veo đã kết nối (${veoEmail || 'Tài khoản hoạt động'}). Nhấn để quản lý.`}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-700/60 text-emerald-300 text-xs font-semibold transition-all cursor-pointer"
                >
                  <GoogleIcon className="w-3.5 h-3.5" />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <span className="max-w-[120px] truncate text-[11px]">
                    {veoEmail ? veoEmail.split('@')[0] : 'Google Sẵn sàng'}
                  </span>
                </button>
              ) : (
                <button
                  onClick={handleOpenGoogleLogin}
                  disabled={isOpeningGoogle}
                  title="Đăng nhập tài khoản Google để kích hoạt Google Veo Free"
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-500/20 transition-all cursor-pointer active:scale-95"
                >
                  <GoogleIcon className="w-3.5 h-3.5 bg-white p-0.5 rounded-full shrink-0" />
                  <span>{isOpeningGoogle ? 'Đang mở...' : 'Đăng nhập Google'}</span>
                </button>
              )
            ) : veoMode === 'api_key' ? (
              <button
                onClick={() => setShowApiKeyModal(true)}
                title="Cấu hình Google Gemini API Key"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold transition-all cursor-pointer ${
                  hasGeminiKey
                    ? 'bg-indigo-950/60 hover:bg-indigo-900/80 border-indigo-700/60 text-indigo-300'
                    : 'bg-amber-950/60 hover:bg-amber-900/80 border-amber-700/60 text-amber-300'
                }`}
              >
                <Key className="w-3 h-3" />
                <span className="text-[11px]">
                  {hasGeminiKey ? 'Gemini Key: OK' : 'Cần Gemini Key'}
                </span>
              </button>
            ) : (
              <button
                onClick={() => setShowApiKeyModal(true)}
                title="Chế độ mô phỏng Veo không cần tài khoản"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                <span className="text-[11px]">Veo Mô phỏng</span>
              </button>
            )}

            {/* Quick Settings button to open modal & switch modes */}
            <button
              onClick={() => setShowApiKeyModal(true)}
              title="Cài đặt cấu hình AI (Google Session / API Key / Chế độ)"
              className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Toggle Sidebars */}
          <button
            onClick={() => setShowLibrary((prev) => !prev)}
            title="Ẩn/Hiện Thư viện Node"
            className={`px-2 py-1 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
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
            className={`px-2 py-1 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
              showInspector
                ? 'bg-indigo-950/70 border-indigo-700/60 text-indigo-300'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            Thuộc tính
          </button>

          {/* Zen Focus Mode Button */}
          <button
            onClick={() => {
              const nextZen = !isZenMode;
              if (onToggleZenMode) onToggleZenMode(nextZen);
              if (nextZen) {
                setShowLibrary(false);
                setShowInspector(false);
                setShowTimeline(false);
                setShowQueueDrawer(false);
                toast.info('Đã bật Focus Canvas (Bấm Esc hoặc nút góc phải để thoát)');
              } else {
                setShowLibrary(true);
                setShowInspector(true);
                setShowTimeline(true);
              }
            }}
            title={isZenMode ? 'Thoát Toàn Màn Hình Canvas (Esc)' : 'Toàn màn hình Canvas (Zen Mode)'}
            className={`p-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
              isZenMode
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            {isZenMode ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Primary Run / Cancel Button */}
          {isRunning ? (
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-amber-500/40 text-amber-300 text-xs font-semibold">
                <Clock className="w-3.5 h-3.5 animate-spin" />
                <span>Đang render...</span>
              </span>
              <button
                onClick={async () => {
                  if (typeof window !== 'undefined' && window.vanhsub?.workflow?.cancel) {
                    await window.vanhsub.workflow.cancel(graphId);
                    toast.info('Đã gửi yêu cầu hủy render workflow');
                  }
                  setIsRunning(false);
                  for (const node of nodes) {
                    const st = runtimeMap[node.id]?.status;
                    if (st === 'running' || st === 'queued') {
                      updateNodeRuntime(node.id, { status: 'idle', progress: 0, error: 'Đã hủy bởi người dùng' });
                    }
                  }
                }}
                className="px-2.5 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-bold transition-colors cursor-pointer active:scale-95"
                title="Hủy quá trình render hiện tại"
              >
                Hủy
              </button>
            </div>
          ) : (
            <button
              onClick={handleRunWorkflow}
              title={
                estimatedStats.totalCredits > 0
                  ? `Khởi chạy toàn bộ đồ thị DAG (${estimatedStats.modelCount} node AI). Dự kiến tiêu tốn: ~${estimatedStats.totalCredits} Credits (~$${estimatedStats.totalCostUsd} USD).`
                  : 'Khởi chạy toàn bộ đồ thị DAG'
              }
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-600 hover:from-amber-400 hover:to-indigo-500 text-white text-xs font-bold shadow-[0_0_15px_rgba(244,63,94,0.3)] transition-all active:scale-95 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Chạy Workflow</span>
              {estimatedStats.totalCredits > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-black/35 font-mono text-[10px] text-amber-200 border border-amber-400/30">
                  ~{estimatedStats.totalCredits} Cr
                </span>
              )}
            </button>
          )}
        </div>
      </header>

      {/* Main Work Area: Library | Canvas | Inspector */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar: Node Library with Edge Toggle Handle */}
        {showLibrary ? (
          <div className="relative flex shrink-0 h-full">
            <NodeLibrary onClose={() => setShowLibrary(false)} />
            <button
              onClick={() => setShowLibrary(false)}
              className="absolute -right-3 top-1/2 -translate-y-1/2 z-20 w-6 h-12 bg-slate-900 border border-slate-700 hover:border-indigo-500 rounded-r-lg flex items-center justify-center text-slate-400 hover:text-white shadow-xl transition-colors cursor-pointer"
              title="Thu gọn Thư viện Node (Ẩn panel)"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowLibrary(true)}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-20 px-1.5 py-3 bg-slate-900/90 hover:bg-indigo-950 border border-l-0 border-slate-700 hover:border-indigo-500 rounded-r-xl flex items-center gap-1 text-slate-300 hover:text-white shadow-2xl backdrop-blur-md text-xs font-semibold transition-all group cursor-pointer"
            title="Mở rộng Thư viện Node"
          >
            <ChevronRight className="w-3.5 h-3.5 text-indigo-400 group-hover:translate-x-0.5 transition-transform" />
            <span className="[writing-mode:vertical-lr] tracking-widest text-[10px] py-1 text-slate-400 group-hover:text-slate-200">
              THƯ VIỆN
            </span>
          </button>
        )}

        {/* Central Graph Canvas */}
        <div ref={reactFlowWrapper} className="flex-1 h-full relative">
          {/* Zen Mode Exit Floating Button */}
          {isZenMode && (
            <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
              <button
                onClick={() => {
                  if (onToggleZenMode) onToggleZenMode(false);
                  setShowLibrary(true);
                  setShowInspector(true);
                  setShowTimeline(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-2xl backdrop-blur-md transition-all border border-indigo-400/40 cursor-pointer"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Thoát Toàn màn hình (Esc)</span>
              </button>
            </div>
          )}

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
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={2.5}
            defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
            deleteKeyCode={['Backspace', 'Delete']}
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
              className="text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 cursor-pointer"
            >
              <span>Hàng đợi Render</span>
              {showQueueDrawer ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Right Sidebar: Inspector with Edge Toggle Handle */}
        {showInspector ? (
          <div className="relative flex shrink-0 h-full">
            <button
              onClick={() => setShowInspector(false)}
              className="absolute -left-3 top-1/2 -translate-y-1/2 z-20 w-6 h-12 bg-slate-900 border border-slate-700 hover:border-indigo-500 rounded-l-lg flex items-center justify-center text-slate-400 hover:text-white shadow-xl transition-colors cursor-pointer"
              title="Thu gọn Bảng Điều khiển (Ẩn panel)"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <Inspector onClose={() => setShowInspector(false)} />
          </div>
        ) : (
          <button
            onClick={() => setShowInspector(true)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-20 px-1.5 py-3 bg-slate-900/90 hover:bg-indigo-950 border border-r-0 border-slate-700 hover:border-indigo-500 rounded-l-xl flex items-center gap-1 text-slate-300 hover:text-white shadow-2xl backdrop-blur-md text-xs font-semibold transition-all group cursor-pointer"
            title="Mở rộng Bảng Điều khiển (Thuộc tính)"
          >
            <span className="[writing-mode:vertical-lr] tracking-widest text-[10px] py-1 text-slate-400 group-hover:text-slate-200">
              THUỘC TÍNH
            </span>
            <ChevronLeft className="w-3.5 h-3.5 text-indigo-400 group-hover:-translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>

      {/* Bottom Queue Panel (Mục 4.1 đặc tả: Job Queue status) */}
      {showQueueDrawer && (
        <div
          style={{ height: isQueueMaximized ? '65vh' : `${queueHeight}px` }}
          className="border-t border-slate-800 bg-[#0d131f]/95 p-3 flex flex-col shadow-2xl z-20 relative"
        >
          {/* Top Resize Handle */}
          <div
            onMouseDown={handleQueueResizeStart}
            className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-indigo-500/40 transition-colors flex items-center justify-center group z-30 select-none"
            title="Kéo chuột lên/xuống để chỉnh độ cao Hàng đợi & Lịch sử"
          >
            <div className="w-12 h-1 rounded-full bg-slate-700 group-hover:bg-indigo-400 transition-colors" />
          </div>

          <div className="flex items-center justify-between pb-2 pt-1 border-b border-slate-800 text-xs shrink-0">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-400" />
              <span className="font-bold text-white">Hàng đợi Render & Nhật ký Thực thi</span>
              <span className="px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-800/60 text-indigo-300 text-[10px] font-mono">
                BullMQ + Redis Ready
              </span>
              <span className="text-slate-500 text-[10px]">
                ({nodes.length} nodes)
              </span>
              {estimatedStats.totalCredits > 0 && (
                <span className="px-2 py-0.5 rounded bg-amber-950/80 border border-amber-800/60 text-amber-300 text-[10px] font-mono font-semibold">
                  Tổng dự tính: ~{estimatedStats.totalCredits} Credits (~${estimatedStats.totalCostUsd})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsQueueMaximized((prev) => !prev)}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                title={isQueueMaximized ? 'Thu nhỏ về độ cao mặc định' : 'Phóng to bảng hàng đợi'}
              >
                {isQueueMaximized ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() => setShowQueueDrawer(false)}
                className="text-slate-500 hover:text-slate-300 text-xs px-1.5 py-0.5 rounded hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Đóng ▼
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pt-2 space-y-1.5 font-mono text-[11px] custom-scrollbar">
            {nodes.length === 0 ? (
              <div className="py-8 text-center text-slate-500 italic text-xs">
                Chưa có node nào trên Canvas. Thêm node từ thư viện để bắt đầu.
              </div>
            ) : (
              nodes.map((node) => {
                const r = node.data.runtime || { status: 'idle' };
                return (
                  <div
                    key={node.id}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded bg-slate-900/60 border border-slate-800/50 text-slate-300 hover:border-slate-700/60 transition-colors"
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
                      {r.status === 'failed' && (
                        <span className="text-rose-400 flex items-center gap-1" title={r.error}>
                          ✗ Thất bại {r.error ? `(${r.error})` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Master Timeline & Dựng Phim (Phase 4) */}
      {showTimeline && (
        <MasterTimeline
          nodes={nodes}
          nodeRuntime={runtimeMap}
          onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
          onSendToSubMode={(videoPath, taskName) => {
            if (typeof window !== 'undefined' && window.vanhsub?.tasks?.create) {
              window.vanhsub.tasks.create({
                fileName: taskName || 'Master Sequence từ Workflow',
                filePath: videoPath,
                workflow: 'full-dubbing',
              }).then(() => {
                toast.success('Đã đưa video vào Sub Mode thành công!');
                if (onNavigateTab) onNavigateTab('home');
              });
            } else {
              toast.success('Đã chọn video cho Sub Mode: ' + videoPath);
              if (onNavigateTab) onNavigateTab('home');
            }
          }}
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
                if (onNavigateTab) onNavigateTab('home');
              });
            } else {
              toast.success('Đã chọn video cho Sub Mode: ' + videoPath);
              setShowStudio(false);
              if (onNavigateTab) onNavigateTab('home');
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
        onSelectCharacter={(char) => {
          if (selectedNodeId) {
            const node = nodes.find((n) => n.id === selectedNodeId);
            if (node && (node.data.nodeType === 'character-ref' || node.data.nodeType === 'character-lock')) {
              updateNodeConfig(node.id, 'characterName', char.name);
              updateNodeConfig(node.id, 'description', char.description);
              updateNodeConfig(node.id, 'gender', char.gender);
              if (char.ageGroup) updateNodeConfig(node.id, 'ageGroup', char.ageGroup);
              if (char.referenceImages?.[0]) updateNodeConfig(node.id, 'referenceImageUrl', char.referenceImages[0]);
              toast.success(`Đã đồng bộ nhân vật "${char.name}" vào node!`);
              return;
            }
          }
          const existingCharNode = nodes.find((n) => n.data.nodeType === 'character-ref');
          if (existingCharNode) {
            updateNodeConfig(existingCharNode.id, 'characterName', char.name);
            updateNodeConfig(existingCharNode.id, 'description', char.description);
            updateNodeConfig(existingCharNode.id, 'gender', char.gender);
            if (char.ageGroup) updateNodeConfig(existingCharNode.id, 'ageGroup', char.ageGroup);
            if (char.referenceImages?.[0]) updateNodeConfig(existingCharNode.id, 'referenceImageUrl', char.referenceImages[0]);
            setSelectedNodeId(existingCharNode.id);
            toast.success(`Đã cập nhật nhân vật "${char.name}" vào Node "${existingCharNode.data.label || 'Nhân vật'}"!`);
          } else {
            addNode('character-ref', { x: 100, y: 350 });
            toast.success(`Đã thêm Node Nhân vật "${char.name}" vào Canvas!`);
          }
        }}
      />
      <SceneBibleModal
        isOpen={showSceneBible}
        onClose={() => setShowSceneBible(false)}
        onSelectScene={(scene) => {
          if (selectedNodeId) {
            const node = nodes.find((n) => n.id === selectedNodeId);
            if (node && (node.data.nodeType === 'scene-ref' || node.data.nodeType === 'scene-continuity')) {
              updateNodeConfig(node.id, 'sceneName', scene.name);
              updateNodeConfig(node.id, 'description', scene.description);
              updateNodeConfig(node.id, 'environment', scene.environment);
              updateNodeConfig(node.id, 'lightingMood', scene.lightingMood);
              if (scene.colorPalette) updateNodeConfig(node.id, 'colorPalette', scene.colorPalette);
              toast.success(`Đã đồng bộ bối cảnh "${scene.name}" vào node!`);
              return;
            }
          }
          const existingSceneNode = nodes.find((n) => n.data.nodeType === 'scene-ref');
          if (existingSceneNode) {
            updateNodeConfig(existingSceneNode.id, 'sceneName', scene.name);
            updateNodeConfig(existingSceneNode.id, 'description', scene.description);
            updateNodeConfig(existingSceneNode.id, 'environment', scene.environment);
            updateNodeConfig(existingSceneNode.id, 'lightingMood', scene.lightingMood);
            if (scene.colorPalette) updateNodeConfig(existingSceneNode.id, 'colorPalette', scene.colorPalette);
            setSelectedNodeId(existingSceneNode.id);
            toast.success(`Đã cập nhật bối cảnh "${scene.name}" vào Node!`);
          } else {
            addNode('scene-ref', { x: 100, y: 550 });
            toast.success(`Đã thêm Node Bối cảnh "${scene.name}" vào Canvas!`);
          }
        }}
      />

      {/* Google Veo 3.1 & Gemini API Key Modal */}
      <ApiKeyConfigModal
        isOpen={showApiKeyModal}
        onClose={() => {
          setShowApiKeyModal(false);
          checkVeoStatus();
        }}
        onKeyUpdated={() => checkVeoStatus()}
      />
    </div>
  );
}

export default function WorkflowCanvas({
  onNavigateTab,
  isZenMode,
  onToggleZenMode,
  isSidebarCollapsed,
  onToggleSidebar,
}: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner
        onNavigateTab={onNavigateTab}
        isZenMode={isZenMode}
        onToggleZenMode={onToggleZenMode}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
      />
    </ReactFlowProvider>
  );
}
