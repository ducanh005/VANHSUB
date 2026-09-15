export type GenerationState =
  | 'IDLE'
  | 'READY'
  | 'STARTING'
  | 'GENERATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'UNKNOWN';

export type FlowMode = 'image' | 'video';

export interface ActionResult<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  errorDetail?: string;
  /**
   * Cho phép state nhảy cóc tới một state khác (dùng trong Idempotency Guard:
   * nếu phát hiện generation đã bắt đầu từ trước, nhảy thẳng tới WAIT_FOR_GENERATION).
   */
  skipToState?: string;
}

export interface StateExecutionRecord {
  stateName: string;
  enteredAt: number;
  exitedAt?: number;
  durationMs?: number;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  metadata?: any;
}

export interface FlowStateContext {
  taskId: string;
  generationAttemptId: string;
  mode: FlowMode;
  win: any; // Electron BrowserWindow
  sessionMgr: any; // GoogleVeoSessionManager

  // Tham số sinh
  prompt: string;
  aspectRatio: string;
  outputCount: number;
  imageEngine?: string;
  durationSeconds?: number;
  modelVariant?: string;
  initFrameUrl?: string;
  targetProjectId?: string;

  // Callbacks
  onProgress?: (percent: number, msg?: string) => void;
  isCancelled?: () => boolean;

  // Runtime Tracking
  generationState: GenerationState;
  activeProjectId?: string;
  baselineUrls: Set<string>;
  capturedMediaUrl: string | null;
  capturedBase64: string | null;
  generateClickedAt: number;
  idempotencyDetectedAt?: number;
  foundButton?: any;
  nativeClicksCount?: number;
  netFilterAttached: boolean;
  onResponseStartedHandler?: (details: any) => void;

  // Lịch sử state machine
  stateHistory: StateExecutionRecord[];

  // Kết quả cuối cùng
  result?: {
    imageUrl?: string;
    videoUrl?: string;
    base64Data?: string;
    projectId?: string;
    error?: string;
    errorDetail?: string;
  };
}

export interface VerifyResult {
  ok: boolean;
  criteria?: Record<string, any>;
  reason?: string;
}

export interface FlowAutomationState {
  readonly name: string;
  readonly timeoutMs: number;

  enter(ctx: FlowStateContext): Promise<void>;
  execute(ctx: FlowStateContext): Promise<ActionResult>;
  verify(ctx: FlowStateContext, actionRes: ActionResult): Promise<boolean | VerifyResult>;
  exit(ctx: FlowStateContext): Promise<void>;
}

export interface FlowAutomationResult {
  ok: boolean;
  generationState: GenerationState;
  imageUrl?: string;
  videoUrl?: string;
  base64Data?: string;
  projectId?: string;
  error?: string;
  errorDetail?: string;
  stateHistory: StateExecutionRecord[];
  durationMs: number;
}
