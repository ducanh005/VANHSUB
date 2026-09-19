import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { IAiStudioPipelineEngineDelegate } from './ipc';
import type {
  PipelineSessionState,
  PipelineProgressEvent,
  StartPipelinePayload,
  StartPipelineResult,
  ResumePipelinePayload,
  ResumePipelineResult,
  CancelPipelinePayload,
  CancelPipelineResult,
  GetPipelineStatePayload,
  RenderSingleLineVoicePayload,
  RenderSingleLineVoiceResult,
  RegenerateSceneAssetPayload,
  RegenerateSceneAssetResult,
  ImportSceneMediaPayload,
  ImportSceneMediaResult,
  RenderVideoPayload,
  RenderVideoResult,
  AutoFillIdeaPayload,
  AutoFillIdeaResult,
  ApproveStagePayload,
  ApproveStageResult,
  AiStudioConfig,
  AiStudioVoiceConfig,
  AiStudioStageId,
  AiStudioStageName,
  StoryboardScene,
} from './types';
import { getDecryptedAiStudioConfig, resolveAiStudioCwd } from '../store/aiStudioStore';
import { aiStudioLlmService } from './services/AiStudioLlmService';
import { aiStudioTtsService } from './services/AiStudioTtsService';
import { aiStudioVisualService } from './services/AiStudioVisualService';
import { aiStudioVideoAssembler } from './services/AiStudioVideoAssembler';
import { AiStudioDiskStorageManager } from './storage/AiStudioDiskStorageManager';
import type {
  PipelineActionLogEntry,
  PipelineFactsData,
  PipelineScriptData,
  PipelineTimingData,
  PipelineStoryboardData,
  StoryboardSceneItem,
  StoryboardShotItem,
} from './types/storage';
import { aiStudioStoryboardService } from './services/AiStudioStoryboardService';
import { FlowMediaAutomationEngine } from '../workflow/flow-engine/FlowMediaAutomationEngine';
import { GoogleVeoSessionManager, OFFSCREEN_X, OFFSCREEN_Y } from '../veo/GoogleVeoSessionManager';
import { GoogleFlowBrowserMutex } from '../workflow/dispatcher/GoogleFlowBrowserMutex';
import { broadcastPipelineActionLog } from './ipc';

/**
 * Resolves the root directory where AI Studio pipeline sessions and checkpoints are persisted.
 * Uses the dedicated workspace directory if set, or app userData, or temp directory.
 */
export function resolveAiStudioSessionsRoot(): string {
  const customCwd = resolveAiStudioCwd();
  if (customCwd) {
    return path.join(customCwd, 'sessions');
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    const userData = electron?.app?.getPath?.('userData');
    if (userData) {
      return path.join(userData, 'sessions');
    }
  } catch {}
  return path.join(os.tmpdir(), 'vanhsub-ai-studio', 'sessions');
}

/** Stage metadata definitions for the 8-step pipeline */
const STAGE_CONFIG: Record<
  AiStudioStageId,
  { name: AiStudioStageName; label: string; baseProgress: number }
> = {
  1: { name: 'source', label: 'Dữ kiện (Idea Blueprint)', baseProgress: 10 },
  2: { name: 'script', label: 'Kịch bản (Script Generation)', baseProgress: 25 },
  3: { name: 'voice', label: 'Lồng tiếng (Edge-TTS Voice)', baseProgress: 40 },
  4: { name: 'alignment', label: 'Trích xuất Time (Alignment)', baseProgress: 55 },
  5: { name: 'storyboard', label: 'Storyboard (Visual Prompts)', baseProgress: 70 },
  6: { name: 'visuals', label: 'Ảnh / Video (Visual Assets)', baseProgress: 85 },
  7: { name: 'render', label: 'Dựng phim (FFmpeg Assembly)', baseProgress: 95 },
  8: { name: 'metadata', label: 'SEO & Xuất bản (Metadata)', baseProgress: 100 },
};

/**
 * AiStudioPipelineEngine: Central Orchestration Engine for AI Video Studio
 *
 * Implements the IAiStudioPipelineEngineDelegate contract:
 * - Coordinates the 8-stage automated video generation pipeline.
 * - Atomic checkpoint persistence (`session.json`) after each completed stage.
 * - Validated state transitions with IllegalStateTransitionError protection.
 * - Resumption from any stage with upstream preservation and downstream eviction.
 * - Granular operations (single-line voice, single-scene visual, custom video render).
 * - Graceful process management and AbortController cancellation.
 */
export class AiStudioPipelineEngine implements IAiStudioPipelineEngineDelegate {
  private activeSessions = new Map<string, PipelineSessionState>();
  private activeAbortControllers = new Map<string, AbortController>();
  private activeProcesses = new Map<string, Set<any>>();
  private memorySessions = new Map<string, any>();

  // ==========================================================================
  // Session Directory Helpers
  // ==========================================================================
  public getSessionDir(sessionId: string): string {
    return path.join(resolveAiStudioSessionsRoot(), sessionId);
  }

  public getSessionAssetsDir(sessionId: string): string {
    const dir = path.join(this.getSessionDir(sessionId), 'assets');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ==========================================================================
  // Disk Storage & Action Log Helper (spec §1.1, §1.2, §3)
  // ==========================================================================
  public getDiskStorageManager(sessionId: string, customMediaDir?: string): AiStudioDiskStorageManager {
    const sessionDir = this.getSessionDir(sessionId);
    const storage = AiStudioDiskStorageManager.forProject(sessionId, sessionDir, customMediaDir);
    storage.ensureDirectories();
    storage.ensureIndex();

    // Intercept appendActionLog to stream to renderer via IPC channel 'aiStudio:pipeline:actionLog'
    const originalAppend = storage.appendActionLog.bind(storage);
    storage.appendActionLog = (entry: PipelineActionLogEntry) => {
      originalAppend(entry);
      this.emitActionLog(entry);
    };

    return storage;
  }

  public emitActionLog(entry: PipelineActionLogEntry): void {
    broadcastPipelineActionLog(entry);
  }

  // ==========================================================================
  // Atomic State Persistence
  // ==========================================================================
  public persistSessionStateAtomic(state: PipelineSessionState): void {
    state.updatedAt = Date.now();
    this.activeSessions.set(state.sessionId, state);

    try {
      const sessionDir = this.getSessionDir(state.sessionId);
      fs.mkdirSync(sessionDir, { recursive: true });

      const finalPath = path.join(sessionDir, 'session.json');
      const tempPath = path.join(sessionDir, `session.json.tmp.${Date.now()}`);

      fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
      try {
        fs.renameSync(tempPath, finalPath);
      } catch {
        // Fallback for cross-device renames
        fs.copyFileSync(tempPath, finalPath);
        try { fs.unlinkSync(tempPath); } catch {}
      }

      // Also maintain backward-compatible root session file if needed
      const legacyPath = path.join(resolveAiStudioSessionsRoot(), `${state.sessionId}.json`);
      try {
        fs.writeFileSync(legacyPath, JSON.stringify(state, null, 2), 'utf8');
      } catch {}
    } catch (err) {
      console.error(`[AiStudioPipelineEngine] Failed to persist session ${state.sessionId}:`, err);
    }
  }

  public async getState(payload: GetPipelineStatePayload): Promise<PipelineSessionState | null> {
    const { sessionId } = payload;
    if (this.activeSessions.has(sessionId)) {
      return this.activeSessions.get(sessionId)!;
    }

    // Attempt loading from session folder
    const sessionDir = this.getSessionDir(sessionId);
    const sessionJsonPath = path.join(sessionDir, 'session.json');

    if (fs.existsSync(sessionJsonPath)) {
      try {
        const state: PipelineSessionState = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
        if (state && typeof state === 'object') {
          state.stages = state.stages || ({} as any);
          state.artifacts = state.artifacts || ({} as any);
        }
        this.activeSessions.set(sessionId, state);
        return state;
      } catch (err) {
        console.warn(`[AiStudioPipelineEngine] Corrupt session.json at ${sessionJsonPath}:`, err);
      }
    }

    // Fallback: Attempt loading from legacy flat file
    const legacyPath = path.join(resolveAiStudioSessionsRoot(), `${sessionId}.json`);
    if (fs.existsSync(legacyPath)) {
      try {
        const state: PipelineSessionState = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
        if (state && typeof state === 'object') {
          state.stages = state.stages || ({} as any);
          state.artifacts = state.artifacts || ({} as any);
        }
        this.activeSessions.set(sessionId, state);
        return state;
      } catch {}
    }

    return null;
  }

  // ==========================================================================
  // Pipeline Cancellation
  // ==========================================================================
  public async cancel(payload: CancelPipelinePayload): Promise<CancelPipelineResult> {
    const { sessionId } = payload;

    // 1. Trigger AbortController
    const controller = this.activeAbortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeAbortControllers.delete(sessionId);
    }

    // 2. Kill registered child processes / FFmpeg instances
    const procs = this.activeProcesses.get(sessionId);
    if (procs) {
      for (const proc of procs) {
        try {
          if (typeof proc?.kill === 'function') {
            proc.kill('SIGKILL');
          }
        } catch {}
      }
      this.activeProcesses.delete(sessionId);
    }

    // 3. Mark session as cancelled
    const session = await this.getState({ sessionId });
    if (session && (session.status === 'running' || session.status === 'idle')) {
      session.stages = session.stages || ({} as any);
      session.status = 'cancelled';
      if (session.stages[session.currentStage]) {
        session.stages[session.currentStage].status = 'error';
        session.stages[session.currentStage].error = 'Đã hủy bởi người dùng';
      }
      this.persistSessionStateAtomic(session);
    }

    return { success: true };
  }

  // ==========================================================================
  // Pipeline Start (Auto-Pilot One-Click Mode)
  // ==========================================================================
  public async start(
    payload: StartPipelinePayload,
    onProgress: (event: PipelineProgressEvent) => void
  ): Promise<StartPipelineResult> {
    const sessionId = `ai-studio-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const topic = payload.blueprint?.title || payload.topic;
    const gatedMode = payload.gatedMode !== false;

    const session: PipelineSessionState = {
      sessionId,
      topic,
      currentStage: 1,
      stageName: 'source',
      status: 'running',
      progress: 5,
      gatedMode,
      stages: {
        1: { status: 'pending', stageName: STAGE_CONFIG[1].label },
        2: { status: 'pending', stageName: STAGE_CONFIG[2].label },
        3: { status: 'pending', stageName: STAGE_CONFIG[3].label },
        4: { status: 'pending', stageName: STAGE_CONFIG[4].label },
        5: { status: 'pending', stageName: STAGE_CONFIG[5].label },
        6: { status: 'pending', stageName: STAGE_CONFIG[6].label },
        7: { status: 'pending', stageName: STAGE_CONFIG[7].label },
        8: { status: 'pending', stageName: STAGE_CONFIG[8].label },
      },
      artifacts: {
        blueprint: payload.blueprint,
        ideaSummary: payload.blueprint?.rawSummary || payload.blueprint?.title || topic,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.persistSessionStateAtomic(session);

    const abortController = new AbortController();
    this.activeAbortControllers.set(sessionId, abortController);
    this.activeProcesses.set(sessionId, new Set());

    // Execute pipeline in background loop
    setTimeout(() => {
      this.runPipelineLoop(session, 1, onProgress, abortController.signal).catch((err) => {
        if (session.status === 'cancelled' || abortController.signal.aborted) {
          session.status = 'cancelled';
          if (session.stages && session.stages[session.currentStage]) {
            session.stages[session.currentStage].status = 'error';
            session.stages[session.currentStage].error = 'Đã hủy bởi người dùng';
          }
          this.persistSessionStateAtomic(session);
          return;
        }
        console.error(`[AiStudioPipelineEngine] Error on session ${sessionId}:`, err);
        session.status = 'failed';
        if (session.stages && session.stages[session.currentStage]) {
          session.stages[session.currentStage].status = 'error';
          session.stages[session.currentStage].error = err?.message || String(err);
        }
        this.persistSessionStateAtomic(session);
        onProgress({
          sessionId,
          stage: session.currentStage,
          stageName: session.stageName,
          progress: session.progress,
          status: 'error',
          error: err?.message || String(err),
        });
      });
    }, 20);

    return { sessionId };
  }

  public async autoFillIdea(payload: AutoFillIdeaPayload): Promise<AutoFillIdeaResult> {
    const config = getDecryptedAiStudioConfig();
    const effectiveChannelProfile = {
      ...(config.channelProfile || {}),
      ...(payload.channelProfile || {}),
    };
    const blueprint = await aiStudioLlmService.analyzeIdeaBlueprint(
      payload.topic,
      config.llm,
      payload.aspectRatio || '16:9',
      undefined,
      effectiveChannelProfile
    );
    return {
      title: blueprint.title || blueprint.topic,
      hookConcept: blueprint.hookConcept,
      narrativeAngle: blueprint.narrativeAngle,
      outline: blueprint.outline || blueprint.keyBeats || [],
      thumbnailConcept: blueprint.thumbnailConcept || '',
      thumbnailPrompt: blueprint.thumbnailPrompt || '',
    };
  }

  public async approveStage(
    payload: ApproveStagePayload,
    onProgress: (event: PipelineProgressEvent) => void
  ): Promise<ApproveStageResult> {
    const session = await this.getState({ sessionId: payload.sessionId });
    if (!session) {
      throw new Error(`Session không tồn tại: ${payload.sessionId}`);
    }

    if (payload.updatedArtifacts) {
      session.artifacts = {
        ...session.artifacts,
        ...payload.updatedArtifacts,
      };
    }

    const nextStage = (payload.currentStage + 1) as AiStudioStageId;
    if (nextStage > 8) {
      session.status = 'completed';
      session.progress = 100;
      this.persistSessionStateAtomic(session);
      onProgress({
        sessionId: session.sessionId,
        stage: 8,
        stageName: 'Hoàn thành',
        progress: 100,
        status: 'success',
        message: 'Đã hoàn thành toàn bộ quy trình sản xuất video AI Studio!',
        artifacts: session.artifacts,
      });
      return { success: true };
    }

    session.status = 'running';
    session.currentStage = nextStage;
    session.stageName = STAGE_CONFIG[nextStage].name;
    this.persistSessionStateAtomic(session);

    let abortController = this.activeAbortControllers.get(session.sessionId);
    if (!abortController || abortController.signal.aborted) {
      abortController = new AbortController();
      this.activeAbortControllers.set(session.sessionId, abortController);
    }

    setTimeout(() => {
      this.runPipelineLoop(session, nextStage, onProgress, abortController!.signal).catch((err) => {
        if (session.status === 'cancelled' || abortController!.signal.aborted) {
          session.status = 'cancelled';
          if (session.stages && session.stages[session.currentStage]) {
            session.stages[session.currentStage].status = 'error';
            session.stages[session.currentStage].error = 'Đã hủy bởi người dùng';
          }
          this.persistSessionStateAtomic(session);
          return;
        }
        console.error(`[AiStudioPipelineEngine] Error on stage ${nextStage}:`, err);
        session.status = 'failed';
        if (session.stages && session.stages[session.currentStage]) {
          session.stages[session.currentStage].status = 'error';
          session.stages[session.currentStage].error = err?.message || String(err);
        }
        this.persistSessionStateAtomic(session);
        onProgress({
          sessionId: session.sessionId,
          stage: session.currentStage,
          stageName: session.stageName,
          progress: session.progress,
          status: 'error',
          error: err?.message || String(err),
        });
      });
    }, 20);

    return { success: true, nextStage };
  }

  // ==========================================================================
  // Pipeline Resume (Checkpoint Restoration & Error Recovery)
  // ==========================================================================
  public async resume(
    payload: ResumePipelinePayload,
    onProgress: (event: PipelineProgressEvent) => void
  ): Promise<ResumePipelineResult> {
    const session = await this.getState({ sessionId: payload.sessionId });
    if (!session) {
      throw new Error(`Session không tồn tại: ${payload.sessionId}`);
    }

    session.stages = session.stages || ({} as any);
    session.artifacts = session.artifacts || ({} as any);

    const targetStage = (payload.fromStage || session.currentStage) as AiStudioStageId;

    // Validate state transition integrity: cannot resume stage N without completed stage N-1
    if (targetStage > 1) {
      const prevStage = (targetStage - 1) as AiStudioStageId;
      const prevStageCompleted = session.stages[prevStage]?.status === 'success';
      if (!prevStageCompleted) {
        throw new Error(
          `IllegalStateTransitionError: Không thể chuyển tới bước ${targetStage} (${STAGE_CONFIG[targetStage]?.label}) khi bước ${prevStage} chưa hoàn tất thành công.`
        );
      }
    }

    // Upstream Preservation & Downstream Eviction:
    // Reset downstream stages from targetStage to 8
    for (let s = targetStage; s <= 8; s++) {
      session.stages[s] = {
        status: 'pending',
        stageName: STAGE_CONFIG[s as AiStudioStageId]?.label || `Bước ${s}`,
      };
    }

    // Evict downstream artifacts
    if (targetStage <= 2) session.artifacts.scriptLines = undefined;
    if (targetStage <= 3) session.artifacts.audioPath = undefined;
    if (targetStage <= 4) session.artifacts.wordsAlignment = undefined;
    if (targetStage <= 5) session.artifacts.scenes = undefined;
    if (targetStage <= 7) {
      session.artifacts.videoPath = undefined;
      session.artifacts.srtPath = undefined;
    }
    if (targetStage <= 8) session.artifacts.metadata = undefined;

    session.status = 'running';
    session.currentStage = targetStage;
    session.stageName = STAGE_CONFIG[targetStage].name;
    this.persistSessionStateAtomic(session);

    const abortController = new AbortController();
    this.activeAbortControllers.set(session.sessionId, abortController);
    this.activeProcesses.set(session.sessionId, new Set());

    setTimeout(() => {
      this.runPipelineLoop(session, targetStage, onProgress, abortController.signal).catch((err) => {
        if (session.status === 'cancelled' || abortController.signal.aborted) {
          session.status = 'cancelled';
          if (session.stages && session.stages[session.currentStage]) {
            session.stages[session.currentStage].status = 'error';
            session.stages[session.currentStage].error = 'Đã hủy bởi người dùng';
          }
          this.persistSessionStateAtomic(session);
          return;
        }
        console.error(`[AiStudioPipelineEngine] Resume error on session ${session.sessionId}:`, err);
        session.status = 'failed';
        if (session.stages && session.stages[session.currentStage]) {
          session.stages[session.currentStage].status = 'error';
          session.stages[session.currentStage].error = err?.message || String(err);
        }
        this.persistSessionStateAtomic(session);
        onProgress({
          sessionId: session.sessionId,
          stage: session.currentStage,
          stageName: session.stageName,
          progress: session.progress,
          status: 'error',
          error: err?.message || String(err),
        });
      });
    }, 20);

    return { success: true };
  }

  // ==========================================================================
  // Core 8-Stage Execution Loop
  // ==========================================================================
  private async runPipelineLoop(
    session: PipelineSessionState,
    startStage: AiStudioStageId,
    onProgress: (event: PipelineProgressEvent) => void,
    signal: AbortSignal
  ): Promise<void> {
    const config: AiStudioConfig = getDecryptedAiStudioConfig();
    const assetsDir = this.getSessionAssetsDir(session.sessionId);
    const effectiveMediaDir = config.channelProfile?.customMediaDir || config.flowEngine.downloadDir || undefined;
    const storage = this.getDiskStorageManager(session.sessionId, effectiveMediaDir);

    session.stages = session.stages || ({} as any);
    session.artifacts = session.artifacts || ({} as any);

    try {
      for (let stageNum = startStage; stageNum <= 8; stageNum++) {
        if (signal.aborted || session.status === 'cancelled') {
          session.status = 'cancelled';
          if (session.stages && session.stages[session.currentStage]) {
            session.stages[session.currentStage].status = 'error';
            session.stages[session.currentStage].error = 'Đã hủy bởi người dùng';
          }
          this.persistSessionStateAtomic(session);
          return;
        }

        const stage = stageNum as AiStudioStageId;
        const stageMeta = STAGE_CONFIG[stage];

        session.currentStage = stage;
        session.stageName = stageMeta.name;
        session.stages[stage] = session.stages[stage] || { status: 'pending', stageName: stageMeta.label };
        session.stages[stage].status = 'running';
        session.stages[stage].startedAt = Date.now();
        session.progress = stageMeta.baseProgress - 5;
        this.persistSessionStateAtomic(session);

        onProgress({
          sessionId: session.sessionId,
          stage,
          stageName: stageMeta.label,
          progress: session.progress,
          status: 'running',
          message: `Đang thực hiện công đoạn ${stage}/8: ${stageMeta.label}...`,
        });

        // Execute stage
        switch (stage) {
          case 1: {
            // Stage 1: Dữ kiện (Source / Idea Blueprint)
            if (session.artifacts.blueprint && (session.artifacts.blueprint.title || session.artifacts.blueprint.topic)) {
              session.artifacts.ideaSummary =
                session.artifacts.blueprint.rawSummary ||
                session.artifacts.blueprint.title ||
                session.artifacts.blueprint.topic;
            } else {
              const blueprint = await aiStudioLlmService.analyzeIdeaBlueprint(
                session.topic,
                config.llm,
                config.flowEngine.aspectRatio === '9:16' ? '9:16' : '16:9',
                (msg: string) => {
                  onProgress({
                    sessionId: session.sessionId,
                    stage: 1,
                    stageName: stageMeta.label,
                    progress: session.progress,
                    status: 'running',
                    message: msg,
                  });
                },
                config.channelProfile
              );
              session.artifacts.blueprint = blueprint;
              session.artifacts.ideaSummary = blueprint.rawSummary;
            }

            // Task 1: Save facts (Stage 1) into storage (00_facts/facts.json)
            const blueprint = session.artifacts.blueprint;
            const outlineBeats = blueprint?.outline || blueprint?.keyBeats || [];
            const factsList = outlineBeats.map((content: string, idx: number) => ({
              id: `f${idx + 1}`,
              content,
            }));
            if (factsList.length === 0 && session.topic) {
              factsList.push({ id: 'f1', content: session.topic });
            }
            const factsData: PipelineFactsData = {
              project_id: session.sessionId,
              topic: session.topic,
              facts: factsList,
            };
            storage.saveFacts(factsData);
            storage.appendActionLog({
              ts: new Date().toISOString(),
              action: 'input',
              target: '00_facts/facts.json',
              retry: 0,
              status: 'ok',
              details: { factCount: factsList.length, topic: session.topic },
            });
            break;
          }

          case 2: {
            // Stage 2: Kịch bản (Script Generation)
            const scriptLines = await aiStudioLlmService.generateScript(
              session.topic,
              config.llm,
              (msg: string) => {
                onProgress({
                  sessionId: session.sessionId,
                  stage: 2,
                  stageName: stageMeta.label,
                  progress: session.progress,
                  status: 'running',
                  message: msg,
                });
              },
              session.artifacts.blueprint,
              config.channelProfile
            );
            session.artifacts.scriptLines = scriptLines;
            try {
              const evaluation = await aiStudioLlmService.evaluateScript(
                scriptLines,
                session.artifacts.blueprint,
                config.channelProfile,
                config.llm
              );
              session.artifacts.scriptEvaluation = evaluation;
            } catch (evalErr) {
              console.warn('[AiStudioPipelineEngine] Script auto-evaluation error (non-fatal):', evalErr);
            }

            // Task 1: Save script (Stage 2) into storage (01_script/script.json)
            const scriptScenes = (scriptLines || []).map((line, idx) => ({
              scene_id: `scene_${String(idx + 1).padStart(2, '0')}`,
              narration: line.text,
              visual_note: line.visualPromptEn || line.text,
            }));
            const scriptData: PipelineScriptData = {
              scenes: scriptScenes,
            };
            storage.saveScript(scriptData);
            storage.appendActionLog({
              ts: new Date().toISOString(),
              action: 'input',
              target: '01_script/script.json',
              retry: 0,
              status: 'ok',
              details: { sceneCount: scriptScenes.length },
            });
            break;
          }

          case 3: {
            // Stage 3: Lồng tiếng (Edge-TTS Voiceover)
            const voiceoverPath = path.join(assetsDir, 'voiceover.mp3');
            const scriptLines = session.artifacts.scriptLines || [];

            // Ưu tiên giọng đọc cụ thể và provider trong ChannelProfile nếu đã cấu hình
            const isTikTok =
              config.channelProfile?.ttsEngine === 'tiktok_tts' ||
              config.voice.provider === 'tiktok_tts' ||
              Boolean(config.channelProfile?.specificVoice?.startsWith('BV0'));
            const defaultVoice = isTikTok ? 'BV074_streaming' : 'vi-VN-HoaiMyNeural';

            const voiceConfig: AiStudioVoiceConfig = {
              ...config.voice,
              provider: isTikTok ? 'tiktok_tts' : (config.voice.provider || 'edge_tts'),
              voiceId: config.channelProfile?.specificVoice || config.voice.voiceId || defaultVoice,
            };

            const ttsResult = await aiStudioTtsService.synthesizeVoiceover(
              scriptLines,
              voiceConfig,
              voiceoverPath,
              signal
            );
            session.artifacts.audioPath = ttsResult.audioPath;
            session.artifacts.scriptLines = scriptLines;
            if (ttsResult.wordTimestamps && ttsResult.wordTimestamps.length > 0) {
              session.artifacts.wordsAlignment = ttsResult.wordTimestamps;
            }
            // Cache raw metadata in memory for stage 4
            this.memorySessions.set(`${session.sessionId}:ttsMetadata`, ttsResult.rawMetadata);

            // Sync per-line audio into 02_voice/{scene_id}.mp3
            for (let i = 0; i < scriptLines.length; i++) {
              const line = scriptLines[i];
              const sceneId = `scene_${String(i + 1).padStart(2, '0')}`;
              const destVoicePath = storage.getVoiceAudioPath(sceneId);
              if (line.audioPath && fs.existsSync(line.audioPath)) {
                try {
                  fs.copyFileSync(line.audioPath, destVoicePath);
                  const durSec = line.durationMs ? Math.round((line.durationMs / 1000) * 100) / 100 : 4.0;
                  storage.updateSceneMetadata(sceneId, {
                    voice_path: storage.getVoiceAudioRelativePath(sceneId),
                    voice_duration_sec: durSec,
                  });
                } catch (copyErr) {
                  console.warn(`[AiStudioPipelineEngine] Failed to copy voice file for ${sceneId}:`, copyErr);
                }
              }
            }

            storage.appendActionLog({
              ts: new Date().toISOString(),
              action: 'download',
              target: '02_voice',
              retry: 0,
              status: 'ok',
              details: { voiceoverPath, lineCount: scriptLines.length },
            });
            break;
          }

          case 4: {
            // Stage 4: Trích xuất Time (Alignment)
            const rawMetadata = this.memorySessions.get(`${session.sessionId}:ttsMetadata`) || [];
            const fullText = (session.artifacts.scriptLines || []).map((l) => l.text).join(' ');
            const audioPath = session.artifacts.audioPath!;
            const audioDurationSec = await aiStudioTtsService.probeMediaDuration(audioPath);
            const totalDurationMs = Math.round(audioDurationSec * 1000);

            const alignResult = aiStudioTtsService.extractAlignment(
              rawMetadata,
              fullText,
              session.artifacts.scriptLines || [],
              totalDurationMs
            );
            session.artifacts.wordsAlignment = alignResult.wordsAlignment;
            session.artifacts.scriptLines = alignResult.alignedLines;

            // Probe timing if 02_voice exists
            const scriptScenes = (session.artifacts.scriptLines || []).map((_, idx) => `scene_${String(idx + 1).padStart(2, '0')}`);
            const hasVoiceFiles = fs.existsSync(storage.paths.voiceDir) &&
              fs.readdirSync(storage.paths.voiceDir).some(f => f.endsWith('.mp3'));

            if (hasVoiceFiles) {
              try {
                await aiStudioStoryboardService.extractTiming(storage, scriptScenes);
              } catch (probeErr) {
                console.warn('[AiStudioPipelineEngine] extractTiming probing warning in Stage 4:', probeErr);
              }
            }

            storage.appendActionLog({
              ts: new Date().toISOString(),
              action: 'probe',
              target: '03_timing/timing.json',
              retry: 0,
              status: 'ok',
              details: { totalDurationMs, alignedLineCount: alignResult.alignedLines.length },
            });
            break;
          }

          case 5: {
            // Stage 5: Storyboard (Visual Prompts & Dynamic Probed Audio Timing)
            const scriptLines = session.artifacts.scriptLines || [];
            const scriptScenes = scriptLines.map((line, idx) => ({
              scene_id: `scene_${String(idx + 1).padStart(2, '0')}`,
              narration: line.text,
              visual_note: line.visualPromptEn || line.text,
            }));
            const scriptData: PipelineScriptData = { scenes: scriptScenes };
            storage.saveScript(scriptData);

            // Probing real audio timing (via 02_voice/ or audio clips) and writing 03_timing/timing.json
            let timingData = storage.readTiming();
            const voiceFilesExist = fs.existsSync(storage.paths.voiceDir) &&
              fs.readdirSync(storage.paths.voiceDir).some(f => f.endsWith('.mp3'));

            if (!timingData || !timingData.scenes || timingData.scenes.length === 0) {
              if (voiceFilesExist) {
                try {
                  timingData = await aiStudioStoryboardService.extractTiming(
                    storage,
                    scriptScenes.map(s => s.scene_id)
                  );
                } catch (probeErr) {
                  console.warn('[AiStudioPipelineEngine] Audio probing encountered warning, using fallback timeline:', probeErr);
                }
              }

              if (!timingData || !timingData.scenes || timingData.scenes.length === 0) {
                let timelineSec = 0;
                const timingScenes = scriptScenes.map((sc, idx) => {
                  const line = scriptLines[idx];
                  const durationSec = line?.durationMs ? Math.round((line.durationMs / 1000) * 100) / 100 : 4.0;
                  const startSec = Math.round(timelineSec * 100) / 100;
                  const endSec = Math.round((timelineSec + durationSec) * 100) / 100;
                  timelineSec += durationSec;
                  return {
                    scene_id: sc.scene_id,
                    audio_file: storage.getVoiceAudioRelativePath(sc.scene_id),
                    start_sec: startSec,
                    end_sec: endSec,
                    duration_sec: durationSec,
                  };
                });
                timingData = {
                  project_id: session.sessionId,
                  probed_engine: 'ffprobe',
                  scenes: timingScenes,
                  total_duration_sec: Math.round(timelineSec * 100) / 100,
                };
                storage.saveTiming(timingData);
              }
            }

            // Smooth progress updates from 55% to 70%
            const numScenes = scriptScenes.length || 1;
            for (let i = 0; i < numScenes; i++) {
              const sc = scriptScenes[i];
              const pct = 55 + Math.round(((i + 1) / numScenes) * 14);
              onProgress({
                sessionId: session.sessionId,
                stage: 5,
                stageName: STAGE_CONFIG[5].label,
                progress: pct,
                status: 'running',
                message: `Đang sinh kịch bản hình ảnh phân cảnh ${i + 1}/${numScenes} (${sc?.scene_id || ''})...`,
                lastAction: {
                  ts: new Date().toISOString(),
                  scene_id: sc?.scene_id,
                  action: 'input',
                  target: '04_storyboard',
                  retry: 0,
                  status: 'ok',
                },
              });
            }

            // Generate dynamic multi-shot storyboard via AiStudioStoryboardService.generateStoryboard()
            const storyboardData = await aiStudioStoryboardService.generateStoryboard({
              storage,
              script: scriptData,
              timing: timingData,
              stylePromptPrefix: config.flowEngine.stylePromptPrefix,
              negativePrompt: config.flowEngine.negativePrompt,
              channelProfile: config.channelProfile,
              backgroundPrompt: config.channelProfile?.projectBackgroundPrompt,
            });

            // Adapt storyboard shots to session.artifacts.scenes for backwards compatibility with Stage 7
            const legacyScenes: StoryboardScene[] = [];
            const timingScenes = timingData.scenes || [];
            let accumulatedMs = 0;

            storyboardData.scenes.forEach((sc, scIdx) => {
              const tItem = timingScenes.find((t) => t.scene_id === sc.scene_id);
              const sceneStartMs = tItem ? Math.round(tItem.start_sec * 1000) : accumulatedMs;
              let shotCurrentMs = sceneStartMs;

              sc.shots.forEach((shot) => {
                const shotDurMs = Math.round((shot.expected_duration_sec || 4.0) * 1000);
                legacyScenes.push({
                  id: shot.shot_id,
                  lineIndex: scIdx,
                  startMs: shotCurrentMs,
                  endMs: shotCurrentMs + shotDurMs,
                  durationMs: shotDurMs,
                  lineText: sc.narration || '',
                  visualPrompt: shot.image_prompt,
                  negativePrompt: config.flowEngine.negativePrompt,
                  motionType: config.flowEngine.outputMode === 'video' ? 'video' : 'ken_burns',
                  status: 'pending',
                });
                shotCurrentMs += shotDurMs;
                accumulatedMs = Math.max(accumulatedMs, shotCurrentMs);
              });
            });

            session.artifacts.scenes = legacyScenes;
            session.progress = 70;

            onProgress({
              sessionId: session.sessionId,
              stage: 5,
              stageName: STAGE_CONFIG[5].label,
              progress: 70,
              status: 'running',
              message: `Hoàn tất Storyboard (${legacyScenes.length} phân cảnh con).`,
              artifacts: session.artifacts,
            });
            break;
          }

          case 6: {
            // Stage 6: Ảnh / Video (Visual Assets via FlowMediaAutomationEngine)
            const isFlowEngine = !config.flowEngine.engine || config.flowEngine.engine === 'flow';
            if (!isFlowEngine) {
              const scenes = session.artifacts.scenes || [];
              const dispatchResult = await aiStudioVisualService.dispatchVisualAssets(
                scenes,
                config.flowEngine,
                assetsDir,
                (pct, msg) => {
                  onProgress({
                    sessionId: session.sessionId,
                    stage: 6,
                    stageName: STAGE_CONFIG[6].label,
                    progress: 70 + Math.round(pct * 0.15),
                    status: 'running',
                    message: msg,
                  });
                },
                signal
              );
              session.artifacts.scenes = dispatchResult.scenes;
              break;
            }

            // Resolve storyboard from storage
            let storyboard = storage.readStoryboard();
            if (!storyboard || !storyboard.scenes || storyboard.scenes.length === 0) {
              const scenes = session.artifacts.scenes || [];
              if (scenes.length === 0) {
                throw new Error('Không tìm thấy dữ liệu Storyboard trong thư mục dự án.');
              }
              storyboard = {
                project_id: session.sessionId,
                scenes: scenes.map((s) => ({
                  scene_id: s.id.includes('_shot_') ? s.id.split('_shot_')[0] : s.id,
                  narration: s.lineText,
                  duration_sec: s.durationMs / 1000,
                  shots: [{
                    shot_id: s.id,
                    image_prompt: s.visualPrompt,
                    motion_note: 'subtle camera motion',
                    expected_duration_sec: s.durationMs / 1000,
                  }],
                })),
              };
              storage.saveStoryboard(storyboard);
            }

            // Dual UI Modes (Offscreen vs Live Window)
            const sessionMgr = GoogleVeoSessionManager.getInstance();
            const mutex = GoogleFlowBrowserMutex.getInstance();
            const uiMode = config.channelProfile?.flowUiMode || config.flowEngine.uiMode || 'live_window';
            let lobbyWin = sessionMgr.getLobbyWindow();

            if (uiMode === 'live_window') {
              await sessionMgr.showLobbyForDebug();
              lobbyWin = sessionMgr.getLobbyWindow();
              if (lobbyWin && !lobbyWin.isDestroyed()) {
                lobbyWin.setSize(1440, 900);
                lobbyWin.setPosition(100, 60);
                try {
                  lobbyWin.webContents?.setZoomFactor(1.0);
                } catch {}
                lobbyWin.show();
                lobbyWin.focus();
              }
            } else {
              sessionMgr.hideLobbyOffscreen();
              lobbyWin = sessionMgr.getLobbyWindow();
              if (!lobbyWin || lobbyWin.isDestroyed()) {
                await sessionMgr.openLobbyWindow();
                lobbyWin = sessionMgr.getLobbyWindow();
              }
              if (lobbyWin && !lobbyWin.isDestroyed()) {
                lobbyWin.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
              }
            }

            // Flatten all shots
            interface ShotWorkItem {
              sceneId: string;
              shot: StoryboardShotItem;
            }
            const allShots: ShotWorkItem[] = [];
            for (const sc of storyboard.scenes) {
              for (const shot of sc.shots) {
                allShots.push({ sceneId: sc.scene_id, shot });
              }
            }

            const totalShots = allShots.length;
            const isVideoMode = config.flowEngine.outputMode === 'video';
            const stepsPerShot = isVideoMode ? 2 : 1;
            const totalSteps = totalShots * stepsPerShot;
            let completedSteps = 0;

            // Resolve primary reference image from local disk (character avatar or project reference image)
            let primaryReferenceImagePath: string | undefined;
            const charAvatar = config.channelProfile?.channelCharacters?.[0]?.avatarUrl;
            if (charAvatar && fs.existsSync(charAvatar) && fs.statSync(charAvatar).size > 0) {
              primaryReferenceImagePath = charAvatar;
            }
            if (!primaryReferenceImagePath && config.flowEngine?.referenceImagePath && fs.existsSync(config.flowEngine.referenceImagePath)) {
              primaryReferenceImagePath = config.flowEngine.referenceImagePath;
            }

            let firstGeneratedImagePath: string | undefined;

            for (let idx = 0; idx < allShots.length; idx++) {
              const { sceneId, shot } = allShots[idx];

              if (signal.aborted || (session.status as string) === 'cancelled') {
                throw new Error('Quá trình tạo visual media đã bị hủy bởi người dùng.');
              }

              // Determine reference image for this shot:
              // If character/custom reference exists, use it.
              // Otherwise, from shot 1 onwards, use the first generated shot's image on disk as reference!
              const effectiveRefImage = primaryReferenceImagePath || (idx > 0 && firstGeneratedImagePath ? firstGeneratedImagePath : undefined);

              // Step A: Text-to-Image (T2I)
              const t2iProgress = 70 + Math.round((completedSteps / totalSteps) * 15);
              onProgress({
                sessionId: session.sessionId,
                stage: 6,
                stageName: STAGE_CONFIG[6].label,
                progress: Math.min(84, t2iProgress),
                status: 'running',
                message: `[T2I] Đang tạo ảnh cho shot ${shot.shot_id} (${completedSteps + 1}/${totalSteps})...`,
                lastAction: {
                  ts: new Date().toISOString(),
                  scene_id: sceneId,
                  shot_id: shot.shot_id,
                  action: 'input',
                  target: 'prompt_input',
                  retry: 0,
                  status: 'ok',
                },
              });

              const imgResult = await mutex.runExclusive(async () => {
                return FlowMediaAutomationEngine.generateImageForShot({
                  storage,
                  win: lobbyWin,
                  sceneId,
                  shotId: shot.shot_id,
                  prompt: shot.image_prompt,
                  aspectRatio: config.flowEngine.aspectRatio,
                  referenceImagePath: effectiveRefImage,
                });
              }, `ai_studio_t2i_${shot.shot_id}`);

              if (!imgResult.success) {
                throw new Error(`Tạo ảnh thất bại cho ${shot.shot_id}: ${imgResult.error || 'Unknown error'}`);
              }
              if (imgResult.imagePath && !firstGeneratedImagePath) {
                firstGeneratedImagePath = imgResult.imagePath;
              }
              completedSteps++;

              // Step B: Image-to-Video (I2V) if video mode
              if (isVideoMode) {
                if (signal.aborted || (session.status as string) === 'cancelled') {
                  throw new Error('Quá trình tạo visual media đã bị hủy bởi người dùng.');
                }

                const i2vProgress = 70 + Math.round((completedSteps / totalSteps) * 15);
                onProgress({
                  sessionId: session.sessionId,
                  stage: 6,
                  stageName: STAGE_CONFIG[6].label,
                  progress: Math.min(84, i2vProgress),
                  status: 'running',
                  message: `[I2V] Đang tạo video từ ảnh cho shot ${shot.shot_id} (${completedSteps + 1}/${totalSteps})...`,
                  lastAction: {
                    ts: new Date().toISOString(),
                    scene_id: sceneId,
                    shot_id: shot.shot_id,
                    action: 'upload',
                    target: 'file_input',
                    retry: 0,
                    status: 'ok',
                  },
                });

                const vidResult = await mutex.runExclusive(async () => {
                  return FlowMediaAutomationEngine.generateVideoForShot({
                    storage,
                    win: lobbyWin,
                    sceneId,
                    shotId: shot.shot_id,
                    sourceImagePath: imgResult.imagePath,
                    motionNote: shot.motion_note,
                    expectedDurationSec: shot.expected_duration_sec || 4.0,
                    tolerancePct: 15.0,
                  });
                }, `ai_studio_i2v_${shot.shot_id}`);

                if (!vidResult.success) {
                  console.warn(`[AiStudioPipelineEngine] I2V failed for ${shot.shot_id}, falling back to static image:`, vidResult.error);
                } else if (vidResult.needsReview) {
                  console.info(`[AiStudioPipelineEngine] Shot ${shot.shot_id} duration deviation flagged needs_review: true (actual: ${vidResult.actualDurationSec}s, expected: ${vidResult.expectedDurationSec}s, dev: ${vidResult.deviationPct}%)`);
                }
                completedSteps++;
              }
            }

            // Refresh index.json and sync final local asset paths into session.artifacts.scenes
            const finalIndex = storage.readIndex();
            const updatedScenes = (session.artifacts.scenes || []).map((scene) => {
              for (const sc of Object.values(finalIndex.scenes)) {
                const shotMeta = sc.shots?.[scene.id];
                if (shotMeta) {
                  if (shotMeta.image_path) {
                    scene.imagePath = storage.resolvePath(shotMeta.image_path);
                  }
                  if (shotMeta.video_path) {
                    scene.videoPath = storage.resolvePath(shotMeta.video_path);
                  }
                  const relativeAsset = shotMeta.video_path || shotMeta.image_path;
                  if (relativeAsset) {
                    scene.assetPath = storage.resolvePath(relativeAsset);
                    scene.status = 'ready';
                  }
                }
              }
              return scene;
            });

            session.artifacts.scenes = updatedScenes;
            session.artifacts.mediaDir = storage.paths.mediaDir;
            session.progress = 85;

            onProgress({
              sessionId: session.sessionId,
              stage: 6,
              stageName: STAGE_CONFIG[6].label,
              progress: 85,
              status: 'running',
              message: `Đã hoàn tất toàn bộ media assets (${totalShots} shots).`,
              artifacts: session.artifacts,
            });
            break;
          }

          case 7: {
            // Stage 7: Dựng phim (FFmpeg Assembly)
            const finalVideoPath = path.join(assetsDir, 'final_video.mp4');
            const scenes = session.artifacts.scenes || [];
            const audioPath = session.artifacts.audioPath!;

            const assemblyResult = await aiStudioVideoAssembler.assembleVideo({
              scenes,
              voiceoverAudioPath: audioPath,
              outputPath: finalVideoPath,
              renderingConfig: config.rendering,
              subtitleConfig: config.subtitles,
              aspectRatio: config.flowEngine.aspectRatio,
              wordsAlignment: session.artifacts.wordsAlignment,
              scriptLines: session.artifacts.scriptLines,
              signal,
              onRegisterProcess: (cmd) => {
                const procs = this.activeProcesses.get(session.sessionId);
                if (procs) procs.add(cmd);
              },
              onProgress: (pct) => {
                onProgress({
                  sessionId: session.sessionId,
                  stage: 7,
                  stageName: STAGE_CONFIG[7].label,
                  progress: 85 + Math.round(pct * 0.1),
                  status: 'running',
                  message: `Đang render video FFmpeg: ${pct}%...`,
                });
              },
            });

            session.artifacts.videoPath = assemblyResult.videoPath;
            session.artifacts.srtPath = path.join(assetsDir, 'subtitles.ass');
            break;
          }

          case 8: {
            // Stage 8: SEO & Xuất bản (Metadata)
            const metadata = await aiStudioLlmService.generateSeoMetadata(
              session.topic,
              session.artifacts.scriptLines || [],
              config.llm
            );
            session.artifacts.metadata = metadata;
            break;
          }
        }

        // Mark stage as completed
        session.stages[stage].status = 'success';
        session.stages[stage].completedAt = Date.now();
        session.progress = stageMeta.baseProgress;
        this.persistSessionStateAtomic(session);

        // Gated Approval Check: Pause and wait for explicit user approval before next stage
        if (session.gatedMode && stage < 8) {
          session.status = 'awaiting_approval';
          this.persistSessionStateAtomic(session);

          onProgress({
            sessionId: session.sessionId,
            stage,
            stageName: stageMeta.label,
            progress: session.progress,
            status: 'awaiting_approval',
            message: `Công đoạn ${stage}/8 (${stageMeta.label}) đã hoàn thành. Đang chờ phê duyệt từ bạn để tiếp tục...`,
            artifacts: session.artifacts,
          });

          return; // Pause loop until user calls approveStage
        }

        onProgress({
          sessionId: session.sessionId,
          stage,
          stageName: stageMeta.label,
          progress: session.progress,
          status: 'success',
          artifacts: session.artifacts,
        });
      }

      // All 8 stages finished successfully
      session.status = 'completed';
      session.progress = 100;
      this.persistSessionStateAtomic(session);

      this.activeAbortControllers.delete(session.sessionId);
      this.activeProcesses.delete(session.sessionId);

      onProgress({
        sessionId: session.sessionId,
        stage: 8,
        stageName: 'Hoàn thành',
        progress: 100,
        status: 'success',
        message: 'Đã hoàn thành toàn bộ quy trình sản xuất video AI Studio!',
        artifacts: session.artifacts,
      });
    } catch (err: any) {
      if (signal.aborted || session.status === 'cancelled') {
        session.status = 'cancelled';
        if (session.stages && session.stages[session.currentStage]) {
          session.stages[session.currentStage].status = 'error';
          session.stages[session.currentStage].error = 'Đã hủy bởi người dùng';
        }
        this.persistSessionStateAtomic(session);
        return;
      }
      throw err;
    }
  }

  // ==========================================================================
  // Granular Step Handlers
  // ==========================================================================
  public async renderSingleLineVoice(
    payload: RenderSingleLineVoicePayload
  ): Promise<RenderSingleLineVoiceResult> {
    return aiStudioTtsService.renderSingleLineVoice(payload);
  }

  public async regenerateSceneAsset(
    payload: RegenerateSceneAssetPayload
  ): Promise<RegenerateSceneAssetResult> {
    if (payload.sessionId) {
      try {
        const config = getDecryptedAiStudioConfig();
        const customMediaDir = config.channelProfile?.customMediaDir;
        const storage = this.getDiskStorageManager(payload.sessionId, customMediaDir);
        const shotId = payload.sceneId;
        const sceneId = shotId.includes('_shot_') ? shotId.split('_shot_')[0] : shotId;
        const sessionMgr = GoogleVeoSessionManager.getInstance();
        const mutex = GoogleFlowBrowserMutex.getInstance();

        // Đảm bảo cửa sổ Flow sẵn sàng
        const flowUiMode = config.channelProfile?.flowUiMode || config.flowEngine?.uiMode || 'live_window';
        let lobbyWin = sessionMgr.getLobbyWindow();
        if (flowUiMode === 'live_window') {
          await sessionMgr.showLobbyForDebug();
          lobbyWin = sessionMgr.getLobbyWindow();
          if (lobbyWin && !lobbyWin.isDestroyed()) {
            lobbyWin.setSize(1440, 900);
            lobbyWin.setPosition(100, 60);
            try {
              lobbyWin.webContents?.setZoomFactor(1.0);
            } catch {}
            lobbyWin.show();
            lobbyWin.focus();
          }
        } else {
          sessionMgr.hideLobbyOffscreen();
          lobbyWin = sessionMgr.getLobbyWindow();
          if (!lobbyWin || lobbyWin.isDestroyed()) {
            await sessionMgr.openLobbyWindow();
            lobbyWin = sessionMgr.getLobbyWindow();
          }
          if (lobbyWin && !lobbyWin.isDestroyed()) {
            lobbyWin.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
          }
        }

        const mode = payload.mode || (payload.flowConfig?.outputMode === 'video' ? 'video' : 'both');

        if (mode === 'video') {
          const session = await this.getState({ sessionId: payload.sessionId });
          const sc = session?.artifacts.scenes?.find((s) => s.id === shotId || s.shotId === shotId);
          const expectedDurationSec = sc ? sc.durationMs / 1000 : 4.0;

          const vidResult = await mutex.runExclusive(async () => {
            return FlowMediaAutomationEngine.generateVideoForShot({
              storage,
              win: lobbyWin,
              sceneId,
              shotId,
              expectedDurationSec,
              forceRegenerate: true,
            });
          }, `regenerate_vid_${shotId}`);

          if (vidResult.success && vidResult.videoPath) {
            if (session && session.artifacts.scenes) {
              const targetScene = session.artifacts.scenes.find((s) => s.id === shotId || s.shotId === shotId);
              if (targetScene) {
                targetScene.videoPath = vidResult.videoPath;
                targetScene.assetPath = vidResult.videoPath;
                targetScene.status = 'ready';
                this.persistSessionStateAtomic(session);
              }
            }
            return { assetPath: vidResult.videoPath, videoPath: vidResult.videoPath };
          }
        } else if (mode === 'image') {
          const effectiveRef = payload.referenceImagePath || config.channelProfile?.channelCharacters?.[0]?.avatarUrl || config.flowEngine?.referenceImagePath;
          const imgResult = await mutex.runExclusive(async () => {
            return FlowMediaAutomationEngine.generateImageForShot({
              storage,
              win: lobbyWin,
              sceneId,
              shotId,
              prompt: payload.visualPrompt,
              aspectRatio: payload.flowConfig?.aspectRatio || config.flowEngine.aspectRatio,
              referenceImagePath: effectiveRef,
              forceRegenerate: true,
            });
          }, `regenerate_img_${shotId}`);

          if (imgResult.success && imgResult.imagePath) {
            const session = await this.getState({ sessionId: payload.sessionId });
            if (session && session.artifacts.scenes) {
              const sc = session.artifacts.scenes.find((s) => s.id === shotId || s.shotId === shotId);
              if (sc) {
                sc.imagePath = imgResult.imagePath;
                sc.assetPath = sc.videoPath || imgResult.imagePath;
                sc.visualPrompt = payload.visualPrompt;
                sc.status = 'ready';
                this.persistSessionStateAtomic(session);
              }
            }
            return { assetPath: imgResult.imagePath, imagePath: imgResult.imagePath };
          }
        } else {
          // mode === 'both': Tạo ảnh mới trước, sau đó tạo video từ ảnh mới
          const imgResult = await mutex.runExclusive(async () => {
            return FlowMediaAutomationEngine.generateImageForShot({
              storage,
              win: lobbyWin,
              sceneId,
              shotId,
              prompt: payload.visualPrompt,
              aspectRatio: payload.flowConfig?.aspectRatio || config.flowEngine.aspectRatio,
              forceRegenerate: true,
            });
          }, `regenerate_both_img_${shotId}`);

          let imagePath = imgResult.imagePath;
          let videoPath: string | undefined;

          if (imgResult.success && imgResult.imagePath) {
            const session = await this.getState({ sessionId: payload.sessionId });
            const sc = session?.artifacts.scenes?.find((s) => s.id === shotId || s.shotId === shotId);
            const expectedDurationSec = sc ? sc.durationMs / 1000 : 4.0;

            const vidResult = await mutex.runExclusive(async () => {
              return FlowMediaAutomationEngine.generateVideoForShot({
                storage,
                win: lobbyWin,
                sceneId,
                shotId,
                expectedDurationSec,
                forceRegenerate: true,
              });
            }, `regenerate_both_vid_${shotId}`);

            if (vidResult.success && vidResult.videoPath) {
              videoPath = vidResult.videoPath;
            }

            if (session && session.artifacts.scenes) {
              const targetScene = session.artifacts.scenes.find((s) => s.id === shotId || s.shotId === shotId);
              if (targetScene) {
                targetScene.imagePath = imgResult.imagePath;
                if (videoPath) {
                  targetScene.videoPath = videoPath;
                  targetScene.assetPath = videoPath;
                } else {
                  targetScene.assetPath = imgResult.imagePath;
                }
                targetScene.visualPrompt = payload.visualPrompt;
                targetScene.status = 'ready';
                this.persistSessionStateAtomic(session);
              }
            }
            return {
              assetPath: videoPath || imgResult.imagePath,
              imagePath: imgResult.imagePath,
              videoPath,
            };
          }
        }
      } catch (regErr) {
        console.warn('[AiStudioPipelineEngine] Storage-backed regenerateSceneAsset error, falling back to visual service:', regErr);
      }
    }
    return aiStudioVisualService.regenerateSceneAsset(payload);
  }

  public async importSceneMedia(
    payload: ImportSceneMediaPayload
  ): Promise<ImportSceneMediaResult> {
    const { sessionId, sceneId, filePath, mediaType } = payload;
    if (!sessionId || !sceneId || !filePath) {
      return { success: false, assetPath: '', error: 'Thiếu thông tin phiên, phân cảnh hoặc đường dẫn tệp' };
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, assetPath: '', error: `Tệp không tồn tại: ${filePath}` };
    }

    try {
      const config = getDecryptedAiStudioConfig();
      const storage = this.getDiskStorageManager(sessionId, config.channelProfile?.customMediaDir);
      const shotId = sceneId;
      const actualSceneId = shotId.includes('_shot_') ? shotId.split('_shot_')[0] : shotId;

      const ext = path.extname(filePath).toLowerCase();
      const isVideo = mediaType === 'video' || ['.mp4', '.mkv', '.mov', '.avi', '.webm'].includes(ext);
      const targetKind = isVideo ? 'vid' : 'img';

      // Tạo đường dẫn phiên bản mới trong thư mục media
      const nextVer = storage.getNextMediaVersion(shotId, targetKind);
      const destPath = nextVer.absolutePath;

      // Copy tệp vào thư mục media của session
      fs.copyFileSync(filePath, destPath);

      // Cập nhật index.json
      if (isVideo) {
        storage.updateShotMetadata(actualSceneId, shotId, {
          video_path: nextVer.relativePath,
          current_video_version: nextVer.version,
        });
      } else {
        storage.updateShotMetadata(actualSceneId, shotId, {
          image_path: nextVer.relativePath,
          current_image_version: nextVer.version,
        });
      }

      storage.appendActionLog({
        ts: new Date().toISOString(),
        scene_id: actualSceneId,
        shot_id: shotId,
        action: 'upload',
        target: isVideo ? 'manual_video_import' : 'manual_image_import',
        retry: 0,
        status: 'ok',
        details: { message: 'Người dùng nạp tệp thủ công', source: filePath, destination: destPath },
      });

      // Cập nhật session state
      const session = await this.getState({ sessionId });
      if (session && session.artifacts.scenes) {
        const targetScene = session.artifacts.scenes.find((s) => s.id === shotId || s.shotId === shotId);
        if (targetScene) {
          if (isVideo) {
            targetScene.videoPath = destPath;
            targetScene.assetPath = destPath;
          } else {
            targetScene.imagePath = destPath;
            if (!targetScene.videoPath) {
              targetScene.assetPath = destPath;
            }
          }
          targetScene.status = 'ready';
          this.persistSessionStateAtomic(session);
        }
      }

      return {
        success: true,
        assetPath: destPath,
        imagePath: !isVideo ? destPath : undefined,
        videoPath: isVideo ? destPath : undefined,
      };
    } catch (err: any) {
      console.error('[AiStudioPipelineEngine] Lỗi importSceneMedia:', err);
      return { success: false, assetPath: '', error: err?.message || String(err) };
    }
  }

  public async renderVideo(payload: RenderVideoPayload): Promise<RenderVideoResult> {
    const session = await this.getState({ sessionId: payload.sessionId });
    if (!session || !session.artifacts.audioPath || !session.artifacts.scenes) {
      throw new Error(`Session assets không tìm thấy cho việc dựng lại video: ${payload.sessionId}`);
    }

    const config = getDecryptedAiStudioConfig();
    const assetsDir = this.getSessionAssetsDir(session.sessionId);
    const outputPath = path.join(assetsDir, `final_video_${Date.now()}.mp4`);

    // Merge custom rendering/subtitle settings if provided
    const mergedRendering: AiStudioConfig['rendering'] = {
      ...config.rendering,
      ...(payload.customSettings as any),
    };
    const mergedSubtitles: AiStudioConfig['subtitles'] = {
      ...config.subtitles,
      ...(payload.customSettings as any),
    };

    const assemblyResult = await aiStudioVideoAssembler.assembleVideo({
      scenes: session.artifacts.scenes,
      voiceoverAudioPath: session.artifacts.audioPath,
      outputPath,
      renderingConfig: mergedRendering,
      subtitleConfig: mergedSubtitles,
      aspectRatio: config.flowEngine.aspectRatio,
      wordsAlignment: session.artifacts.wordsAlignment,
      scriptLines: session.artifacts.scriptLines,
    });

    session.artifacts.videoPath = assemblyResult.videoPath;
    this.persistSessionStateAtomic(session);

    return { videoPath: assemblyResult.videoPath };
  }
}

export const aiStudioPipelineEngine = new AiStudioPipelineEngine();
