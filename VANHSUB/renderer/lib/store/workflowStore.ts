import { create } from 'zustand';
import {
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react';
import type { WorkflowNodeData, WorkflowGraph, NodeRuntimeState } from '../../types/workflow';
import { NODE_DEFINITIONS } from '../workflow/nodeRegistry';
import { WORKFLOW_PRESETS } from '../workflow/presets';

export interface SavedWorkflowItem {
  id: string;
  name: string;
  updatedAt: string;
  deletedAt?: string; // Soft delete timestamp (ISO 8601). Nếu có tức là đang ở trong thùng rác.
  nodesCount: number;
  graph: WorkflowGraph;
}

export interface HistorySnapshot {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
}

interface WorkflowState {
  // Graph Data
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;

  // Metadata
  graphId: string;
  graphName: string;
  version: number;

  // Runtime status for nodes (for execution visualization)
  runtimeMap: Record<string, NodeRuntimeState>;
  runningNodeId: string | null;

  // Saved Workflows
  savedWorkflows: SavedWorkflowItem[];

  // Undo / Redo History
  historyPast: HistorySnapshot[];
  historyFuture: HistorySnapshot[];
  canUndo: boolean;
  canRedo: boolean;

  // Actions
  onNodesChange: (changes: NodeChange<Node<WorkflowNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  setSelectedNodeId: (id: string | null) => void;

  takeSnapshot: () => void;
  undo: () => void;
  redo: () => void;

  addNode: (nodeType: string, position?: { x: number; y: number }) => string;
  removeNode: (id: string) => void;
  updateNodeConfig: (nodeId: string, key: string, value: any) => void;
  updateNodeRuntime: (nodeId: string, runtime: Partial<NodeRuntimeState>) => void;
  runSingleNode: (nodeId: string) => Promise<void>;

  setGraphName: (name: string) => void;
  loadGraph: (graph: WorkflowGraph) => void;
  loadPreset: (presetId: string) => void;
  clearCanvas: () => void;

  saveCurrentWorkflow: () => SavedWorkflowItem;
  loadSavedWorkflow: (id: string) => boolean;
  deleteSavedWorkflow: (id: string) => void;
  softDeleteWorkflow: (id: string) => void;
  restoreWorkflow: (id: string) => void;
  permanentDeleteWorkflow: (id: string) => void;
  emptyTrash: () => void;

  exportGraphJson: () => string;
  importGraphJson: (jsonStr: string) => boolean;
}

const defaultPreset = WORKFLOW_PRESETS[0];

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: defaultPreset.graph.nodes as Node<WorkflowNodeData>[],
  edges: defaultPreset.graph.edges,
  selectedNodeId: null,

  graphId: defaultPreset.graph.id,
  graphName: defaultPreset.graph.name,
  version: 1,

  runtimeMap: {},

  historyPast: [],
  historyFuture: [],
  canUndo: false,
  canRedo: false,

  takeSnapshot: () => {
    const { nodes, edges, historyPast } = get();
    // Tạo bản sao độc lập (deep clone) để không bị ảnh hưởng bởi các đột biến tiếp theo
    const snapshot: HistorySnapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
    const newPast = [...historyPast, snapshot].slice(-50);
    set({
      historyPast: newPast,
      historyFuture: [],
      canUndo: true,
      canRedo: false,
    });
  },

  undo: () => {
    const { historyPast, historyFuture, nodes, edges } = get();
    if (historyPast.length === 0) return;

    const previous = historyPast[historyPast.length - 1];
    const newPast = historyPast.slice(0, historyPast.length - 1);

    const currentSnapshot: HistorySnapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
    const newFuture = [currentSnapshot, ...historyFuture].slice(0, 50);

    set({
      nodes: previous.nodes,
      edges: previous.edges,
      historyPast: newPast,
      historyFuture: newFuture,
      canUndo: newPast.length > 0,
      canRedo: true,
      selectedNodeId: null,
    });
  },

  redo: () => {
    const { historyPast, historyFuture, nodes, edges } = get();
    if (historyFuture.length === 0) return;

    const next = historyFuture[0];
    const newFuture = historyFuture.slice(1);

    const currentSnapshot: HistorySnapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
    const newPast = [...historyPast, currentSnapshot].slice(-50);

    set({
      nodes: next.nodes,
      edges: next.edges,
      historyPast: newPast,
      historyFuture: newFuture,
      canUndo: true,
      canRedo: newFuture.length > 0,
      selectedNodeId: null,
    });
  },

  savedWorkflows: (() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem('vanhsub_saved_workflows');
      if (!raw) return [];
      const list = JSON.parse(raw) as SavedWorkflowItem[];
      const now = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      // Tự động dọn dẹp các workflow trong thùng rác đã quá hạn 30 ngày
      const valid = list.filter((item) => {
        if (!item.deletedAt) return true;
        const deletedTime = new Date(item.deletedAt).getTime();
        return now - deletedTime < thirtyDaysMs;
      });
      if (valid.length !== list.length) {
        localStorage.setItem('vanhsub_saved_workflows', JSON.stringify(valid));
      }
      return valid;
    } catch {
      return [];
    }
  })(),

  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },

  onEdgesChange: (changes) => {
    const hasRemoval = changes.some((c) => c.type === 'remove');
    if (hasRemoval) {
      get().takeSnapshot();
    }
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },

  onConnect: (connection) => {
    get().takeSnapshot();
    // Tự động thêm style animated cho edge mới
    set({
      edges: addEdge(
        {
          ...connection,
          animated: true,
          style: { strokeWidth: 2, stroke: '#818cf8' },
        },
        get().edges
      ),
    });
  },

  setSelectedNodeId: (id) => {
    set({ selectedNodeId: id });
  },

  addNode: (nodeType: string, position = { x: 300, y: 250 }) => {
    const def = NODE_DEFINITIONS[nodeType];
    if (!def) return '';

    get().takeSnapshot();

    const newId = `node-${nodeType}-${Date.now().toString(36)}`;
    const newNode: Node<WorkflowNodeData> = {
      id: newId,
      type: 'genericNode',
      position,
      data: {
        nodeType: def.type,
        category: def.category,
        label: def.label,
        config: { ...(def.defaultData || {}) },
      },
    };

    set({
      nodes: [...get().nodes, newNode],
      selectedNodeId: newId,
    });

    return newId;
  },

  removeNode: (id: string) => {
    get().takeSnapshot();
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
    });
  },

  runningNodeId: null,

  updateNodeConfig: (nodeId: string, key: string, value: any) => {
    get().takeSnapshot();
    set({
      nodes: get().nodes.map((node) => {
        if (node.id !== nodeId) return node;
        return {
          ...node,
          data: {
            ...node.data,
            config: {
              ...node.data.config,
              [key]: value,
            },
          },
        };
      }),
    });
  },

  updateNodeRuntime: (nodeId: string, runtime: Partial<NodeRuntimeState>) => {
    const prev = get().runtimeMap[nodeId] || { status: 'idle' };
    const next = { ...prev, ...runtime };

    set({
      runtimeMap: {
        ...get().runtimeMap,
        [nodeId]: next,
      },
      nodes: get().nodes.map((node) => {
        if (node.id !== nodeId) return node;
        return {
          ...node,
          data: {
            ...node.data,
            runtime: next,
          },
        };
      }),
    });
  },

  runSingleNode: async (nodeId: string) => {
    const { nodes, edges, graphId, graphName, updateNodeRuntime } = get();
    const targetNode = nodes.find((n) => n.id === nodeId);
    if (!targetNode) return;

    set({ runningNodeId: nodeId });
    updateNodeRuntime(nodeId, { status: 'running', progress: 10, error: undefined });

    if (typeof window !== 'undefined' && window.vanhsub?.workflow?.runNode) {
      try {
        const res = await window.vanhsub.workflow.runNode(
          {
            id: graphId,
            name: graphName,
            nodes,
            edges,
          },
          nodeId
        );
        if (!res.success) {
          updateNodeRuntime(nodeId, {
            status: 'failed',
            error: res.error || 'Thực thi node thất bại',
          });
        }
      } catch (err: any) {
        updateNodeRuntime(nodeId, {
          status: 'failed',
          error: err?.message || String(err),
        });
      } finally {
        set({ runningNodeId: null });
      }
    } else {
      // Fallback mô phỏng nếu không có backend Electron
      setTimeout(() => {
        updateNodeRuntime(nodeId, { status: 'running', progress: 50 });
        setTimeout(() => {
          updateNodeRuntime(nodeId, {
            status: 'success',
            progress: 100,
            thumbnailUrl:
              targetNode.data.category === 'model' || targetNode.data.category === 'output'
                ? 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=600&q=80'
                : undefined,
          });
          set({ runningNodeId: null });
        }, 800);
      }, 500);
    }
  },

  setGraphName: (name: string) => {
    set({ graphName: name });
  },

  loadGraph: (graph: WorkflowGraph) => {
    set({
      graphId: graph.id || `graph-${Date.now()}`,
      graphName: graph.name || 'Untitled Workflow',
      version: graph.version || 1,
      nodes: (graph.nodes || []) as Node<WorkflowNodeData>[],
      edges: graph.edges || [],
      selectedNodeId: null,
      runtimeMap: {},
      historyPast: [],
      historyFuture: [],
      canUndo: false,
      canRedo: false,
    });
  },

  loadPreset: (presetId: string) => {
    const preset = WORKFLOW_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      get().loadGraph(preset.graph);
    }
  },

  clearCanvas: () => {
    get().takeSnapshot();
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      runtimeMap: {},
    });
  },

  saveCurrentWorkflow: () => {
    const { graphId, graphName, version, nodes, edges, savedWorkflows } = get();
    const currentGraph: WorkflowGraph = {
      id: graphId,
      name: graphName,
      version,
      nodes,
      edges,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const item: SavedWorkflowItem = {
      id: graphId,
      name: graphName,
      updatedAt: new Date().toISOString(),
      nodesCount: nodes.length,
      graph: currentGraph,
    };

    const existingIndex = savedWorkflows.findIndex((w) => w.id === graphId || w.name === graphName);
    let updated: SavedWorkflowItem[];
    if (existingIndex >= 0) {
      updated = [...savedWorkflows];
      updated[existingIndex] = item;
    } else {
      updated = [item, ...savedWorkflows];
    }

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('vanhsub_saved_workflows', JSON.stringify(updated));
      } catch (e) {
        console.error('Lỗi khi lưu workflow vào localStorage:', e);
      }
    }

    set({ savedWorkflows: updated });
    return item;
  },

  loadSavedWorkflow: (id: string) => {
    const { savedWorkflows } = get();
    const found = savedWorkflows.find((w) => w.id === id);
    if (found?.graph) {
      get().loadGraph(found.graph);
      return true;
    }
    return false;
  },

  softDeleteWorkflow: (id: string) => {
    const { savedWorkflows, graphId } = get();
    const updated = savedWorkflows.map((w) => {
      if (w.id === id) {
        return {
          ...w,
          deletedAt: new Date().toISOString(),
        };
      }
      return w;
    });

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('vanhsub_saved_workflows', JSON.stringify(updated));
      } catch {}
    }

    set({ savedWorkflows: updated });

    // Nếu đang mở workflow vừa bị xóa mềm, tự động chuyển về workflow còn hoạt động hoặc preset mặc định
    if (graphId === id) {
      const activeOne = updated.find((w) => !w.deletedAt);
      if (activeOne?.graph) {
        get().loadGraph(activeOne.graph);
      } else {
        get().loadGraph(defaultPreset.graph);
      }
    }
  },

  restoreWorkflow: (id: string) => {
    const { savedWorkflows } = get();
    const updated = savedWorkflows.map((w) => {
      if (w.id === id) {
        const copy = { ...w };
        delete copy.deletedAt;
        return copy;
      }
      return w;
    });

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('vanhsub_saved_workflows', JSON.stringify(updated));
      } catch {}
    }

    set({ savedWorkflows: updated });
  },

  permanentDeleteWorkflow: (id: string) => {
    const { savedWorkflows } = get();
    const filtered = savedWorkflows.filter((w) => w.id !== id);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('vanhsub_saved_workflows', JSON.stringify(filtered));
      } catch {}
    }
    set({ savedWorkflows: filtered });
  },

  emptyTrash: () => {
    const { savedWorkflows } = get();
    const activeOnly = savedWorkflows.filter((w) => !w.deletedAt);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('vanhsub_saved_workflows', JSON.stringify(activeOnly));
      } catch {}
    }
    set({ savedWorkflows: activeOnly });
  },

  deleteSavedWorkflow: (id: string) => {
    get().softDeleteWorkflow(id);
  },

  exportGraphJson: () => {
    const { graphId, graphName, version, nodes, edges } = get();
    const graph: WorkflowGraph = {
      id: graphId,
      name: graphName,
      version,
      nodes,
      edges,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return JSON.stringify(graph, null, 2);
  },

  importGraphJson: (jsonStr: string) => {
    try {
      const graph = JSON.parse(jsonStr) as WorkflowGraph;
      if (!graph.nodes || !Array.isArray(graph.nodes)) {
        return false;
      }
      get().loadGraph(graph);
      return true;
    } catch (e) {
      console.error('Lỗi khi import graph JSON:', e);
      return false;
    }
  },
}));
