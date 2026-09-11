import { ipcMain, BrowserWindow } from 'electron';
import { WorkflowExecutionEngine, type WorkflowGraphData } from './executionEngine';
import type { WorkflowNodeEvent } from './types';

const engine = new WorkflowExecutionEngine();

export function registerWorkflowIpc(): void {
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
}
