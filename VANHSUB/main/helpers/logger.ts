import { BrowserWindow } from 'electron';

/**
 * Chuyển tiếp log của main process tới renderer (terminal trong app).
 *
 * Ghi đè console.log/info/warn/error: vẫn in ra console gốc (để xem qua
 * terminal khi chạy `npm run dev`), đồng thời gửi entry qua IPC 'app:log'
 * cho mọi cửa sổ — TerminalPanel ở renderer hiển thị.
 */

export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  text: string;
  ts: number;
}

const originalConsole = { ...console };

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function emit(level: LogEntry['level'], args: unknown[]) {
  const entry: LogEntry = {
    level,
    text: args.map(formatArg).join(' '),
    ts: Date.now(),
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('app:log', entry);
    }
  }
}

export function installRendererLogger() {
  (['log', 'info', 'warn', 'error'] as const).forEach((method) => {
    const level: LogEntry['level'] = method === 'log' || method === 'info' ? 'info' : method;
    console[method] = (...args: unknown[]) => {
      originalConsole[method](...args);
      try {
        emit(level, args);
      } catch {
        // không bao giờ để logger làm hỏng app
      }
    };
  });
}
