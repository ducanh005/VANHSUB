/**
 * AI Video Studio - IPC Communication Router
 *
 * Encapsulates all Electron IPC handlers for the AI Video Studio subsystem:
 * - Milestone 1: Configuration management (get, set, reset) via aiStudioStore
 * - Milestone 2: Pipeline execution & granular step operations via Engine Delegate
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { AiStudioPipelineEngine } from './AiStudioPipelineEngine';
import {
  getDecryptedAiStudioConfig,
  updateAiStudioConfig,
  resetAiStudioConfig,
} from '../store/aiStudioStore';
import { ChatGptWebSessionManager } from './chatgpt/ChatGptWebSessionManager';
import { GeminiWebSessionManager } from './gemini/GeminiWebSessionManager';
import { aiStudioLlmService } from './services/AiStudioLlmService';
import type {
  AiStudioConfig,
  PartialAiStudioConfig,
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
  GenerateMasterPromptPayload,
  GenerateMasterPromptResult,
  EvaluateScriptPayload,
  EvaluateScriptResult,
  RefineScriptPayload,
  RefineScriptResult,
  UpdateScriptLinesPayload,
  UpdateScriptLinesResult,
  ImportSceneMediaPayload,
  ImportSceneMediaResult,
} from './types';

// ============================================================================
// Milestone 2 Engine Delegate Contract
// ============================================================================

export interface IAiStudioPipelineEngineDelegate {
  start(
    payload: StartPipelinePayload,
    onProgress: (event: PipelineProgressEvent) => void
  ): Promise<StartPipelineResult>;

  resume(
    payload: ResumePipelinePayload,
    onProgress: (event: PipelineProgressEvent) => void
  ): Promise<ResumePipelineResult>;

  cancel(payload: CancelPipelinePayload): Promise<CancelPipelineResult>;

  getState(payload: GetPipelineStatePayload): Promise<PipelineSessionState | null>;

  persistSessionStateAtomic?(state: PipelineSessionState): void;

  autoFillIdea?(payload: AutoFillIdeaPayload): Promise<AutoFillIdeaResult>;

  approveStage?(
    payload: ApproveStagePayload,
    onProgress: (event: PipelineProgressEvent) => void
  ): Promise<ApproveStageResult>;

  renderSingleLineVoice(
    payload: RenderSingleLineVoicePayload
  ): Promise<RenderSingleLineVoiceResult>;

  regenerateSceneAsset(
    payload: RegenerateSceneAssetPayload,
    onProgress?: (pct: number, msg: string) => void,
    signal?: AbortSignal
  ): Promise<RegenerateSceneAssetResult>;

  importSceneMedia?(
    payload: ImportSceneMediaPayload
  ): Promise<ImportSceneMediaResult>;

  renderVideo(payload: RenderVideoPayload): Promise<RenderVideoResult>;
}

let pipelineEngineDelegate: IAiStudioPipelineEngineDelegate | null = null;

/**
 * Registers the Milestone 2 Pipeline Engine delegate.
 * In Milestone 2, AiStudioPipelineEngine attaches here without modifying this router.
 */
export function setAiStudioPipelineEngine(
  delegate: IAiStudioPipelineEngineDelegate | null
): void {
  pipelineEngineDelegate = delegate;
}

/**
 * Returns the currently active delegate (useful for tests or diagnostics).
 */
export function getAiStudioPipelineEngine(): IAiStudioPipelineEngineDelegate | null {
  return pipelineEngineDelegate;
}

/**
 * Broadcasts a structured action log entry to all open Electron windows.
 * Channel: 'aiStudio:pipeline:actionLog'
 * Format: { ts, scene_id, shot_id, action, target, retry, status, details }
 */
export function broadcastPipelineActionLog(entry: any): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    const BrowserWindow = electron?.BrowserWindow;
    if (BrowserWindow && typeof BrowserWindow.getAllWindows === 'function') {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.send('aiStudio:pipeline:actionLog', entry);
        }
      }
    }
  } catch (err) {
    // Non-fatal if running outside Electron or in unit tests
  }
}

// ============================================================================
// Safe IPC Registration Helper
// ============================================================================

/**
 * Safely registers an IPC invoke handler by unregistering any existing handler
 * for the same channel. Prevents "Attempted to register a second handler" errors.
 */
function safeHandle(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => any
): void {
  try {
    ipcMain.removeHandler(channel);
  } catch {
    // Ignore error if channel was not previously registered
  }
  ipcMain.handle(channel, handler);
}

// ============================================================================
// IPC Handler Registration Entry Point
// ============================================================================

export function registerAiStudioIpc(): void {
  // Automatically wire Milestone 2 Pipeline Engine delegate if not yet registered
  if (!pipelineEngineDelegate) {
    const engine = new AiStudioPipelineEngine();
    setAiStudioPipelineEngine(engine);
  }
  // --------------------------------------------------------------------------
  // Milestone 1 Channels: Dedicated Configuration Store
  // --------------------------------------------------------------------------

  /**
   * Channel: aiStudio:config:get
   * Retrieves the current AI Studio configuration with decrypted secrets for UI.
   */
  safeHandle('aiStudio:config:get', async (): Promise<AiStudioConfig> => {
    try {
      return getDecryptedAiStudioConfig();
    } catch (err: any) {
      console.error('[AI-Studio-IPC] Error fetching configuration:', err);
      throw new Error(`Failed to retrieve AI Studio config: ${err?.message || err}`);
    }
  });

  /**
   * Channel: aiStudio:config:set
   * Updates partial AI Studio configuration and returns the merged result with decrypted secrets.
   */
  safeHandle(
    'aiStudio:config:set',
    async (_event, updates: PartialAiStudioConfig): Promise<AiStudioConfig> => {
      try {
        if (!updates || typeof updates !== 'object') {
          throw new Error('Invalid config updates payload: expected an object');
        }
        return updateAiStudioConfig(updates, { decrypted: true });
      } catch (err: any) {
        console.error('[AI-Studio-IPC] Error updating configuration:', err);
        throw new Error(`Failed to update AI Studio config: ${err?.message || err}`);
      }
    }
  );

  /**
   * Channel: aiStudio:config:reset
   * Resets configuration back to technical specification default values.
   */
  safeHandle('aiStudio:config:reset', async (): Promise<AiStudioConfig> => {
    try {
      return resetAiStudioConfig();
    } catch (err: any) {
      console.error('[AI-Studio-IPC] Error resetting configuration:', err);
      throw new Error(`Failed to reset AI Studio config: ${err?.message || err}`);
    }
  });

  // --------------------------------------------------------------------------
  // Milestone 2 Channels: Pipeline Control & Granular Step Operations
  // --------------------------------------------------------------------------

  /**
   * Channel: aiStudio:pipeline:start
   * Starts a new automated 8-stage video generation pipeline.
   */
  safeHandle(
    'aiStudio:pipeline:start',
    async (event, payload: StartPipelinePayload): Promise<StartPipelineResult> => {
      if (pipelineEngineDelegate?.start) {
        return pipelineEngineDelegate.start(payload, (progressEvent: PipelineProgressEvent) => {
          try {
            if (!event.sender.isDestroyed()) {
              event.sender.send('aiStudio:pipeline:progress', progressEvent);
            }
          } catch (emitErr) {
            console.error('[AI-Studio-IPC] Failed to emit pipeline progress event:', emitErr);
          }
        });
      }
      throw new Error(
        '[M2-STUB] aiStudio:pipeline:start is scheduled for Milestone 2 (Pipeline Engine).'
      );
    }
  );

  /**
   * Channel: aiStudio:pipeline:resume
   * Resumes a paused/failed pipeline from a specific checkpoint stage.
   */
  safeHandle(
    'aiStudio:pipeline:resume',
    async (event, payload: ResumePipelinePayload): Promise<ResumePipelineResult> => {
      if (pipelineEngineDelegate?.resume) {
        return pipelineEngineDelegate.resume(payload, (progressEvent: PipelineProgressEvent) => {
          try {
            if (!event.sender.isDestroyed()) {
              event.sender.send('aiStudio:pipeline:progress', progressEvent);
            }
          } catch (emitErr) {
            console.error('[AI-Studio-IPC] Failed to emit pipeline progress event:', emitErr);
          }
        });
      }
      throw new Error(
        '[M2-STUB] aiStudio:pipeline:resume is scheduled for Milestone 2 (Pipeline Engine).'
      );
    }
  );

  /**
   * Channel: aiStudio:pipeline:cancel
   * Cancels a currently executing pipeline session.
   */
  safeHandle(
    'aiStudio:pipeline:cancel',
    async (_event, payload: CancelPipelinePayload): Promise<CancelPipelineResult> => {
      if (pipelineEngineDelegate?.cancel) {
        return pipelineEngineDelegate.cancel(payload);
      }
      throw new Error(
        '[M2-STUB] aiStudio:pipeline:cancel is scheduled for Milestone 2 (Pipeline Engine).'
      );
    }
  );

  /**
   * Channel: aiStudio:pipeline:getState
   * Retrieves the persisted state of a pipeline session.
   */
  safeHandle(
    'aiStudio:pipeline:getState',
    async (_event, payload: GetPipelineStatePayload): Promise<PipelineSessionState | null> => {
      if (pipelineEngineDelegate?.getState) {
        return pipelineEngineDelegate.getState(payload);
      }
      return null;
    }
  );

  /**
   * Channel: aiStudio:idea:autoFill
   * Automatically generates and fills out idea blueprint fields using the active LLM provider.
   */
  safeHandle(
    'aiStudio:idea:autoFill',
    async (_event, payload: AutoFillIdeaPayload): Promise<AutoFillIdeaResult> => {
      if (pipelineEngineDelegate?.autoFillIdea) {
        return pipelineEngineDelegate.autoFillIdea(payload);
      }
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
  );

  /**
   * Channel: aiStudio:pipeline:approveStage
   * Approves current completed stage in gated pipeline and triggers the next stage.
   */
  safeHandle(
    'aiStudio:pipeline:approveStage',
    async (event, payload: ApproveStagePayload): Promise<ApproveStageResult> => {
      if (pipelineEngineDelegate?.approveStage) {
        return pipelineEngineDelegate.approveStage(payload, (progressEvent: PipelineProgressEvent) => {
          try {
            if (!event.sender.isDestroyed()) {
              event.sender.send('aiStudio:pipeline:progress', progressEvent);
            }
          } catch (emitErr) {
            console.error('[AI-Studio-IPC] Failed to emit pipeline progress event on approve:', emitErr);
          }
        });
      }
      throw new Error('Pipeline engine delegate does not support approveStage.');
    }
  );

  /**
   * Channel: aiStudio:channel:generateMasterPrompt
   * Generates a tailored Master Prompt for the channel based on niche, description & orientation.
   */
  safeHandle(
    'aiStudio:channel:generateMasterPrompt',
    async (
      _event,
      payload: GenerateMasterPromptPayload
    ): Promise<GenerateMasterPromptResult> => {
      try {
        const config = getDecryptedAiStudioConfig();
        const effectiveLlmConfig = {
          ...config.llm,
          ...(payload.channelProfile?.aiProvider && payload.channelProfile.aiProvider !== 'default'
            ? { provider: payload.channelProfile.aiProvider }
            : {}),
        };
        const masterPrompt = await aiStudioLlmService.generateMasterPromptForChannel(
          payload.channelProfile,
          effectiveLlmConfig
        );
        return { masterPrompt };
      } catch (err: any) {
        console.error('[AI-Studio-IPC] Error generating master prompt:', err);
        throw new Error(`Lỗi tạo Master Prompt cho kênh: ${err?.message || err}`);
      }
    }
  );

  /**
   * Channel: aiStudio:script:evaluate
   * Evaluates dialogue script lines across 10 dimensions D1 - D10.
   */
  safeHandle(
    'aiStudio:script:evaluate',
    async (
      _event,
      payload: EvaluateScriptPayload
    ): Promise<EvaluateScriptResult> => {
      try {
        const config = getDecryptedAiStudioConfig();
        const evaluation = await aiStudioLlmService.evaluateScript(
          payload.lines || [],
          payload.blueprint,
          payload.channelProfile || config.channelProfile,
          config.llm
        );

        if (payload.sessionId && pipelineEngineDelegate) {
          const session = await pipelineEngineDelegate.getState({ sessionId: payload.sessionId });
          if (session) {
            session.artifacts = session.artifacts || {};
            session.artifacts.scriptEvaluation = evaluation;
            if (typeof pipelineEngineDelegate.persistSessionStateAtomic === 'function') {
              pipelineEngineDelegate.persistSessionStateAtomic(session);
            }
          }
        }

        return { evaluation };
      } catch (err: any) {
        console.error('[AI-Studio-IPC] Error evaluating script:', err);
        throw new Error(`Lỗi chấm điểm kịch bản: ${err?.message || err}`);
      }
    }
  );

  /**
   * Channel: aiStudio:script:refine
   * Refines script lines to improve weak criteria or follow custom instructions.
   */
  safeHandle(
    'aiStudio:script:refine',
    async (
      _event,
      payload: RefineScriptPayload
    ): Promise<RefineScriptResult> => {
      try {
        const config = getDecryptedAiStudioConfig();
        const refined = await aiStudioLlmService.refineScript(
          payload.lines || [],
          payload.instructions,
          payload.mode || 'improve_weaknesses',
          payload.blueprint,
          payload.channelProfile || config.channelProfile,
          config.llm
        );

        if (payload.sessionId && pipelineEngineDelegate) {
          const session = await pipelineEngineDelegate.getState({ sessionId: payload.sessionId });
          if (session) {
            session.artifacts = session.artifacts || {};
            if (session.artifacts.scriptLines) {
              session.artifacts.scriptHistory = session.artifacts.scriptHistory || [];
              session.artifacts.scriptHistory.push({
                lines: session.artifacts.scriptLines,
                evaluation: session.artifacts.scriptEvaluation,
                timestamp: Date.now(),
              });
            }
            session.artifacts.scriptLines = refined.lines;
            session.artifacts.scriptEvaluation = refined.evaluation;
            if (typeof pipelineEngineDelegate.persistSessionStateAtomic === 'function') {
              pipelineEngineDelegate.persistSessionStateAtomic(session);
            }
          }
        }

        return refined;
      } catch (err: any) {
        console.error('[AI-Studio-IPC] Error refining script:', err);
        throw new Error(`Lỗi cải thiện kịch bản: ${err?.message || err}`);
      }
    }
  );

  /**
   * Channel: aiStudio:script:updateLines
   * Updates dialogue script lines directly (inline editing) and persists to session.
   */
  safeHandle(
    'aiStudio:script:updateLines',
    async (
      _event,
      payload: UpdateScriptLinesPayload
    ): Promise<UpdateScriptLinesResult> => {
      try {
        if (!payload.sessionId) {
          throw new Error('Thiếu sessionId khi cập nhật câu thoại kịch bản.');
        }

        if (pipelineEngineDelegate) {
          const session = await pipelineEngineDelegate.getState({ sessionId: payload.sessionId });
          if (session) {
            session.artifacts = session.artifacts || {};
            session.artifacts.scriptLines = payload.lines || [];
            if (typeof pipelineEngineDelegate.persistSessionStateAtomic === 'function') {
              pipelineEngineDelegate.persistSessionStateAtomic(session);
            }
          }
        }

        return { success: true, scriptLines: payload.lines };
      } catch (err: any) {
        console.error('[AI-Studio-IPC] Error updating script lines:', err);
        throw new Error(`Lỗi cập nhật câu thoại kịch bản: ${err?.message || err}`);
      }
    }
  );

  /**
   * Channel: aiStudio:step:renderSingleLineVoice
   * Synthesizes audio for a single dialogue line via Edge TTS.
   */
  safeHandle(
    'aiStudio:step:renderSingleLineVoice',
    async (
      _event,
      payload: RenderSingleLineVoicePayload
    ): Promise<RenderSingleLineVoiceResult> => {
      if (pipelineEngineDelegate?.renderSingleLineVoice) {
        return pipelineEngineDelegate.renderSingleLineVoice(payload);
      }
      throw new Error(
        '[M2-STUB] aiStudio:step:renderSingleLineVoice is scheduled for Milestone 2 (TTS Service).'
      );
    }
  );

  /**
   * Channel: aiStudio:step:regenerateSceneAsset
   * Regenerates a single visual asset via Google Flow Engine (or synthetic fallback).
   */
  safeHandle(
    'aiStudio:step:regenerateSceneAsset',
    async (
      _event,
      payload: RegenerateSceneAssetPayload
    ): Promise<RegenerateSceneAssetResult> => {
      if (pipelineEngineDelegate?.regenerateSceneAsset) {
        return pipelineEngineDelegate.regenerateSceneAsset(payload);
      }
      throw new Error(
        '[M2-STUB] aiStudio:step:regenerateSceneAsset is scheduled for Milestone 2 (Visual Service).'
      );
    }
  );

  /**
   * Channel: aiStudio:step:importSceneMedia
   * Imports an external image or video file into the project's media storage for a scene.
   */
  safeHandle(
    'aiStudio:step:importSceneMedia',
    async (
      _event,
      payload: ImportSceneMediaPayload
    ): Promise<ImportSceneMediaResult> => {
      if (pipelineEngineDelegate?.importSceneMedia) {
        return pipelineEngineDelegate.importSceneMedia(payload);
      }
      throw new Error(
        'aiStudio:step:importSceneMedia is not supported by current delegate.'
      );
    }
  );

  /**
   * Channel: aiStudio:step:renderVideo
   * Triggers FFmpeg video assembly for a session.
   */
  safeHandle(
    'aiStudio:step:renderVideo',
    async (_event, payload: RenderVideoPayload): Promise<RenderVideoResult> => {
      if (pipelineEngineDelegate?.renderVideo) {
        return pipelineEngineDelegate.renderVideo(payload);
      }
      throw new Error(
        '[M2-STUB] aiStudio:step:renderVideo is scheduled for Milestone 2 (Video Assembler).'
      );
    }
  );

  // --------------------------------------------------------------------------
  // ChatGPT Web Automation Channels (Zero API Cost Mode)
  // --------------------------------------------------------------------------
  safeHandle('aiStudio:chatgpt:checkLogin', async () => {
    return ChatGptWebSessionManager.getInstance().checkLoginStatus();
  });

  safeHandle('aiStudio:chatgpt:openLogin', async () => {
    return ChatGptWebSessionManager.getInstance().openLoginWindow();
  });

  safeHandle('aiStudio:chatgpt:closeLogin', async () => {
    ChatGptWebSessionManager.getInstance().closeWindow();
    return { success: true };
  });

  safeHandle('aiStudio:chatgpt:logout', async () => {
    await ChatGptWebSessionManager.getInstance().logout();
    return { success: true };
  });

  // --------------------------------------------------------------------------
  // Gemini Web Automation Channels (Zero API Cost Mode)
  // --------------------------------------------------------------------------
  safeHandle('aiStudio:gemini:checkLogin', async () => {
    return GeminiWebSessionManager.getInstance().checkLoginStatus();
  });

  safeHandle('aiStudio:gemini:openLogin', async () => {
    return GeminiWebSessionManager.getInstance().openLoginWindow();
  });

  safeHandle('aiStudio:gemini:closeLogin', async () => {
    GeminiWebSessionManager.getInstance().closeWindow();
    return { success: true };
  });

  safeHandle('aiStudio:gemini:logout', async () => {
    await GeminiWebSessionManager.getInstance().logout();
    return { success: true };
  });

  console.log('[AI Studio] Registered 18 IPC channels successfully (including ChatGPT & Gemini Web).');
}
