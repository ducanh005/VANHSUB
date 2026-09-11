export type PortDataType =
  | 'image'
  | 'video'
  | 'text'
  | 'audio'
  | 'character_ref'
  | 'scene_ref'
  | 'any';

export type NodeCategory =
  | 'input'
  | 'model'
  | 'control'
  | 'consistency'
  | 'editing'
  | 'output'
  | 'logic';

export interface PortDefinition {
  id: string;
  label: string;
  dataType: PortDataType;
  description?: string;
}

export type ConfigFieldType =
  | 'string'
  | 'textarea'
  | 'number'
  | 'slider'
  | 'select'
  | 'boolean'
  | 'color'
  | 'file';

export interface ConfigFieldOption {
  label: string;
  value: string | number;
}

export interface ConfigFieldSchema {
  type: ConfigFieldType;
  label: string;
  description?: string;
  defaultValue?: any;
  placeholder?: string;
  options?: ConfigFieldOption[];
  min?: number;
  max?: number;
  step?: number;
}

export interface NodeDefinition {
  type: string;
  category: NodeCategory;
  label: string;
  description: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  configSchema: Record<string, ConfigFieldSchema>;
  defaultData?: Record<string, any>;
}

export type NodeExecutionStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'blocked';

export interface NodeRuntimeState {
  status: NodeExecutionStatus;
  progress?: number; // 0 - 100
  thumbnailUrl?: string;
  outputUrl?: string;
  outputData?: any;
  error?: string;
  durationMs?: number;
}

export interface WorkflowNodeData extends Record<string, unknown> {
  nodeType: string;
  category: NodeCategory;
  label: string;
  config: Record<string, any>;
  runtime?: NodeRuntimeState;
}

export interface WorkflowGraph {
  id: string;
  name: string;
  description?: string;
  version: number;
  nodes: any[];
  edges: any[];
  viewport?: { x: number; y: number; zoom: number };
  createdAt: string;
  updatedAt: string;
}
