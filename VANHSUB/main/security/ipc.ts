import { ipcMain } from 'electron';
import { guardRendererInvoke } from './rendererTrust';
import { validateIpcPayload } from './ipcPayload';

export function handleRendererIpc(channel: string, handler: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.handle(channel, guardRendererInvoke((event, ...args) => {
    validateIpcPayload(channel, args);
    return handler(event, ...args);
  }));
}
