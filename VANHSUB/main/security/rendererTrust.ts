import type { IpcMainInvokeEvent, WebContents } from 'electron';
import path from 'path';

const renderers = new Map<number, { contents: WebContents; origin: string }>();
function originOf(value: string): string {
  const url = new URL(value);
  if (url.username || url.password) throw new Error('URL không hợp lệ.');
  return `${url.protocol}//${url.host}`;
}

export function trustRenderer(contents: WebContents, entryUrl: string): void {
  renderers.set(contents.id, { contents, origin: originOf(entryUrl) });
  contents.once('destroyed', () => renderers.delete(contents.id));
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, destination) => {
    try { if (originOf(destination) === originOf(entryUrl)) return; } catch {}
    event.preventDefault();
  });
}

export function isTrustedRendererEvent(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>): boolean {
  const trusted = renderers.get(event.sender?.id);
  if (!trusted || trusted.contents !== event.sender || event.sender.isDestroyed() ||
      !event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  try { return originOf(event.senderFrame.url) === trusted.origin; } catch { return false; }
}

export function isTrustedRendererContents(contents: WebContents): boolean {
  const trusted = renderers.get(contents.id);
  if (!trusted || trusted.contents !== contents || contents.isDestroyed()) return false;
  try { return originOf(contents.mainFrame.url) === trusted.origin; } catch { return false; }
}

export function guardRendererInvoke<T extends (event: IpcMainInvokeEvent, ...args: any[]) => any>(handler: T): T {
  return ((event: IpcMainInvokeEvent, ...args: any[]) => {
    if (!isTrustedRendererEvent(event)) throw new Error('IPC_FORBIDDEN: Nguồn gọi không phải cửa sổ ứng dụng được cấp quyền.');
    return handler(event, ...args);
  }) as T;
}

export function validateFlowBrowserUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('URL Flow không hợp lệ.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['flow.google.com', 'labs.google'].includes(url.hostname) || url.username || url.password || url.port) {
    throw new Error('Chỉ mở URL HTTPS của Google Flow.');
  }
  return url.href;
}

export function validateModelName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(value) || value.includes('..')) {
    throw new Error('Tên model không hợp lệ.');
  }
  return value;
}

export function resolveBundledPath(root: string, pathname: string): string {
  const candidate = path.resolve(root, pathname.replace(/^\/+/, ''));
  const relative = path.relative(path.resolve(root), candidate);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('PATH_FORBIDDEN');
  return candidate;
}
