export interface WorkflowNodeEvent {
  workflowId: string;
  nodeId: string;
  status: 'idle' | 'queued' | 'running' | 'success' | 'failed' | 'blocked';
  progress?: number;
  thumbnailUrl?: string;
  outputUrl?: string;
  outputData?: any;
  error?: string;
  durationMs?: number;
}

export type ResolvedInputs = Record<string, any>;
export type NodeExecutionOutput = Record<string, any>;

export interface ExecutionContext {
  workflowId: string;
  nodeId: string;
  tempDir: string;
  exportDir: string;
  onProgress: (percent: number) => void;
  isCancelled: () => boolean;
}

export interface NodeExecutionHandler {
  execute: (inputs: ResolvedInputs, config: any, ctx: ExecutionContext) => Promise<NodeExecutionOutput>;
}
