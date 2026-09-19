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
  retryCount?: number;
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
  referenceImagePath?: string;
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
  error?: string;
  errorDetail?: string;
}

export interface FlowAutomationState {
  readonly name: string;
  readonly timeoutMs: number;

  enter(ctx: FlowStateContext): Promise<void>;
  execute(ctx: FlowStateContext): Promise<ActionResult>;
  verify(ctx: FlowStateContext, actionRes: ActionResult): Promise<boolean | VerifyResult>;
  exit(ctx: FlowStateContext): Promise<void>;
}

export type ErrorCategory = 'RETRYABLE' | 'NON_RETRYABLE' | 'FATAL';

export type FlowErrorCode =
  | 'NETWORK_TRANSIENT'
  | 'RATE_LIMIT_429'
  | 'SERVER_ERROR_5XX'
  | 'AGENT_TRANSIENT_ERROR'
  | 'ELEMENT_TRANSIENT_BUSY'
  | 'SESSION_EXPIRED'
  | 'OUT_OF_CREDITS'
  | 'PROMPT_POLICY_VIOLATION'
  | 'ACCOUNT_SUSPENDED'
  | 'INVALID_INPUT'
  | 'USER_CANCELLED'
  | 'BROWSER_WINDOW_DESTROYED'
  | 'CLICK_GENERATE_NO_EFFECT'
  | 'CLICK_GENERATE_REJECTED'
  | 'PROMPT_NOT_RECOGNIZED_BY_APP'
  | 'IMAGE_REFERENCE_ATTACH_FAILED'
  | 'UNKNOWN_ERROR';

export interface ClassifiedError {
  category: ErrorCategory;
  code: FlowErrorCode;
  message: string;
  originalError?: any;
  canRetry: boolean;
  suggestedAction: 'RETRY_WITH_BACKOFF' | 'ABORT_HALT' | 'REAUTH_REQUIRED';
  recommendedDelayMs?: number;
  details?: Record<string, any>;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  jitterRatio: number;
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
  classifiedErrorCode?: FlowErrorCode;
  stateHistory: StateExecutionRecord[];
  durationMs: number;
}

export type FlowTaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type FlowTaskType = 'IMAGE' | 'VIDEO';

export interface FlowTask {
  id: string;
  type: FlowTaskType;
  prompt: string;
  options?: {
    model?: string;
    aspectRatio?: string;
    imageCount?: number;
    referenceImages?: string[];
    videoDuration?: number;
    quality?: string;
    [key: string]: any;
  };
  status: FlowTaskStatus;
  priority?: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  generationAttemptId: number;
  maxRetries?: number;
  retryCount?: number;
  error?: string;
  errorDetail?: string;
  resultUrls?: string[];
  localDownloadedFiles?: string[];
  checkpointId?: string;
  metadata?: Record<string, any>;
}

export type FlowCheckpointStage =
  | 'INIT'
  | 'PROJECT_CREATED'
  | 'CANVAS_CLEANED'
  | 'INPUTS_CONFIGURED'
  | 'GENERATE_CLICKED'
  | 'GENERATING'
  | 'COMPLETED'
  | 'FAILED';

export interface FlowCheckpoint {
  taskId: string;
  stage: FlowCheckpointStage;
  projectId?: string;
  projectUrl?: string;
  generationAttemptId: number;
  baselineUrls?: string[];
  timestamp: number;
  prompt: string;
  aspectRatio?: string;
  mode?: FlowMode;
  lastCompletedState?: string;
  metadata?: Record<string, any>;
}

export type FlowResumeStrategy =
  | 'FRESH_START'
  | 'REUSE_PROJECT'
  | 'RESUME_CONFIGURING'
  | 'JUMP_TO_WAIT'
  | 'ALREADY_COMPLETED';

export interface FlowResumePlan {
  taskId: string;
  strategy: FlowResumeStrategy;
  checkpoint: FlowCheckpoint | null;
  startStateName: string;
  projectId?: string;
  projectUrl?: string;
  baselineUrls: string[];
  reason: string;
}



