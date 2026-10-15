import { handleRendererIpc } from '../security/ipc';
import path from 'path';
import os from 'os';
import { WorkflowExecutionEngine, type WorkflowGraphData } from './executionEngine';
import type { WorkflowNodeEvent } from './types';
import { BibleStore, type CharacterProfile, type SceneProfile } from '../store/bibleStore';
import { QcEngine, type QcConfig } from './qcEngine';
import { VideoProcessor } from './videoProcessor';
import { WorkflowStorageManager } from './WorkflowStorageManager';

const engine = new WorkflowExecutionEngine();

export function registerWorkflowIpc(): void {
  // Workflow Engine Execution
  handleRendererIpc('workflow:run', async (event, graph: WorkflowGraphData) => {
    const webContents = event.sender;

    return engine.execute(graph, (nodeEvent: WorkflowNodeEvent) => {
      try {
        if (!webContents.isDestroyed()) {
          webContents.send('workflow:node-event', nodeEvent);
        }
      } catch (err) {
        console.error('Lỗi khi gửi sự kiện workflow:node-event:', err);
      }
    });
  });

  handleRendererIpc('workflow:runNode', async (event, graph: WorkflowGraphData, nodeId: string) => {
    const webContents = event.sender;

    return engine.executeNode(graph, nodeId, (nodeEvent: WorkflowNodeEvent) => {
      try {
        if (!webContents.isDestroyed()) {
          webContents.send('workflow:node-event', nodeEvent);
        }
      } catch (err) {
        console.error('Lỗi khi gửi sự kiện workflow:node-event:', err);
      }
    });
  });

  handleRendererIpc('workflow:cancel', async (_event, workflowId: string) => {
    engine.cancel(workflowId);
    return true;
  });

  // QC Frame Comparison
  handleRendererIpc(
    'workflow:compareFrames',
    async (_event, frameAPath: string, frameBPath: string, config?: QcConfig) => {
      return QcEngine.evaluate(frameAPath, frameBPath, config);
    }
  );

  // Timeline Video Processing
  handleRendererIpc(
    'workflow:concatClips',
    async (_event, clipPaths: string[], outPath?: string, options?: { effect?: string; duration?: number }) => {
      const dest = outPath || path.join(os.tmpdir(), `master_timeline_${Date.now()}.mp4`);
      return VideoProcessor.concatVideos(clipPaths, dest, undefined, options);
    }
  );

  handleRendererIpc('workflow:getVideoDuration', async (_event, videoPath: string) => {
    return VideoProcessor.getVideoDuration(videoPath);
  });

  // Character Bible
  handleRendererIpc('bible:getCharacters', async () => {
    return BibleStore.getCharacters();
  });

  handleRendererIpc(
    'bible:saveCharacter',
    async (_event, profile: Partial<CharacterProfile> & { name: string }) => {
      return BibleStore.saveCharacter(profile);
    }
  );

  handleRendererIpc('bible:deleteCharacter', async (_event, id: string) => {
    return BibleStore.deleteCharacter(id);
  });

  // Scene Bible
  handleRendererIpc('bible:getScenes', async () => {
    return BibleStore.getScenes();
  });

  handleRendererIpc(
    'bible:saveScene',
    async (_event, profile: Partial<SceneProfile> & { name: string }) => {
      return BibleStore.saveScene(profile);
    }
  );

  handleRendererIpc('bible:deleteScene', async (_event, id: string) => {
    return BibleStore.deleteScene(id);
  });

  // Storage Garbage Collector
  handleRendererIpc('workflow:getTempStorageStats', async () => {
    return WorkflowStorageManager.getInstance().getStorageStats();
  });

  handleRendererIpc('workflow:cleanTempCache', async (_event, maxAgeHours?: number) => {
    return WorkflowStorageManager.getInstance().cleanupOldTempFiles(maxAgeHours ?? 0);
  });

  // Khởi động dọn dẹp định kỳ
  WorkflowStorageManager.getInstance().startPeriodicCleanup();
}
