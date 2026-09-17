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

  autoFillIdea?(payload: AutoFillIdeaPayload): Promise<AutoFillIdeaResult>;

  approveStage?(
    payload: ApproveStagePayload,
    onProgress: (event: PipelineProgressEvent) => void
  ): Promise<ApproveStageResult>;

  renderSingleLineVoice(
    payload: RenderSingleLineVoicePayload
  ): Promise<RenderSingleLineVoiceResult>;

  regenerateSceneAsset(
    payload: RegenerateSceneAssetPayload
  ): Promise<RegenerateSceneAssetResult>;

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

  console.log('[AI Studio] Registered 16 IPC channels successfully (including ChatGPT & Gemini Web).');
}
