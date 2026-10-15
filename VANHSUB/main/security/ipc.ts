import { ipcMain } from 'electron';
import { guardRendererInvoke } from './rendererTrust';

export function handleRendererIpc(channel: string, handler: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.handle(channel, guardRendererInvoke(handler));
}
