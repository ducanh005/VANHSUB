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

  // Actions
  onNodesChange: (changes: NodeChange<Node<WorkflowNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  setSelectedNodeId: (id: string | null) => void;

  addNode: (nodeType: string, position?: { x: number; y: number }) => string;
  removeNode: (id: string) => void;
  updateNodeConfig: (nodeId: string, key: string, value: any) => void;
  updateNodeRuntime: (nodeId: string, runtime: Partial<NodeRuntimeState>) => void;

  setGraphName: (name: string) => void;
  loadGraph: (graph: WorkflowGraph) => void;
  loadPreset: (presetId: string) => void;
  clearCanvas: () => void;

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

  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },

  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },

  onConnect: (connection) => {
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
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
    });
  },

  updateNodeConfig: (nodeId: string, key: string, value: any) => {
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
    });
  },

  loadPreset: (presetId: string) => {
    const preset = WORKFLOW_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      get().loadGraph(preset.graph);
    }
  },

  clearCanvas: () => {
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      runtimeMap: {},
    });
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
