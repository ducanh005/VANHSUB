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
  RenderVideoPayload,
  RenderVideoResult,
  AutoFillIdeaPayload,
  AutoFillIdeaResult,
  ApproveStagePayload,
  ApproveStageResult,
  AiStudioConfig,
  AiStudioStageId,
  AiStudioStageName,
} from './types';
import { getDecryptedAiStudioConfig, resolveAiStudioCwd } from '../store/aiStudioStore';
import { aiStudioLlmService } from './services/AiStudioLlmService';
import { aiStudioTtsService } from './services/AiStudioTtsService';
import { aiStudioVisualService } from './services/AiStudioVisualService';
import { aiStudioVideoAssembler } from './services/AiStudioVideoAssembler';

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
    const blueprint = await aiStudioLlmService.analyzeIdeaBlueprint(
      payload.topic,
      config.llm,
      payload.aspectRatio || '16:9'
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
                }
              );
              session.artifacts.blueprint = blueprint;
              session.artifacts.ideaSummary = blueprint.rawSummary;
            }
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
              session.artifacts.blueprint
            );
            session.artifacts.scriptLines = scriptLines;
            break;
          }

          case 3: {
            // Stage 3: Lồng tiếng (Edge-TTS Voiceover)
            const voiceoverPath = path.join(assetsDir, 'voiceover.mp3');
            const scriptLines = session.artifacts.scriptLines || [];
            const ttsResult = await aiStudioTtsService.synthesizeVoiceover(
              scriptLines,
              config.voice,
              voiceoverPath,
              signal
            );
            session.artifacts.audioPath = ttsResult.audioPath;
            // Cache raw metadata in memory for stage 4
            this.memorySessions.set(`${session.sessionId}:ttsMetadata`, ttsResult.rawMetadata);
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
            break;
          }

          case 5: {
            // Stage 5: Storyboard (Visual Prompts)
            const scenes = aiStudioLlmService.generateStoryboardScenes(
              session.artifacts.scriptLines || [],
              config.flowEngine,
              config.llm
            );
            session.artifacts.scenes = scenes;
            break;
          }

          case 6: {
            // Stage 6: Ảnh / Video (Visual Assets)
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
    return aiStudioVisualService.regenerateSceneAsset(payload);
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
