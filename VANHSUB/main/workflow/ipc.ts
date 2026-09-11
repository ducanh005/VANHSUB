import path from 'path';
import os from 'os';
import { ipcMain } from 'electron';
import { WorkflowExecutionEngine, type WorkflowGraphData } from './executionEngine';
import type { WorkflowNodeEvent } from './types';
import { BibleStore, type CharacterProfile, type SceneProfile } from '../store/bibleStore';
import { QcEngine, type QcConfig } from './qcEngine';
import { VideoProcessor } from './videoProcessor';

const engine = new WorkflowExecutionEngine();

export function registerWorkflowIpc(): void {
  // Workflow Engine Execution
  ipcMain.handle('workflow:run', async (event, graph: WorkflowGraphData) => {
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

  ipcMain.handle('workflow:cancel', async (_event, workflowId: string) => {
    engine.cancel(workflowId);
    return true;
  });

  // QC Frame Comparison
  ipcMain.handle(
    'workflow:compareFrames',
    async (_event, frameAPath: string, frameBPath: string, config?: QcConfig) => {
      return QcEngine.evaluate(frameAPath, frameBPath, config);
    }
  );

  // Timeline Video Processing
  ipcMain.handle('workflow:concatClips', async (_event, clipPaths: string[], outPath?: string) => {
    const dest = outPath || path.join(os.tmpdir(), `master_timeline_${Date.now()}.mp4`);
    return VideoProcessor.concatVideos(clipPaths, dest);
  });

  ipcMain.handle('workflow:getVideoDuration', async (_event, videoPath: string) => {
    return VideoProcessor.getVideoDuration(videoPath);
  });

  // Character Bible
  ipcMain.handle('bible:getCharacters', async () => {
    return BibleStore.getCharacters();
  });

  ipcMain.handle(
    'bible:saveCharacter',
    async (_event, profile: Partial<CharacterProfile> & { name: string }) => {
      return BibleStore.saveCharacter(profile);
    }
  );

  ipcMain.handle('bible:deleteCharacter', async (_event, id: string) => {
    return BibleStore.deleteCharacter(id);
  });

  // Scene Bible
  ipcMain.handle('bible:getScenes', async () => {
    return BibleStore.getScenes();
  });

  ipcMain.handle(
    'bible:saveScene',
    async (_event, profile: Partial<SceneProfile> & { name: string }) => {
      return BibleStore.saveScene(profile);
    }
  );

  ipcMain.handle('bible:deleteScene', async (_event, id: string) => {
    return BibleStore.deleteScene(id);
  });
}
