import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';

/**
 * Chuyển tiếp log của main process tới renderer (terminal trong app) VÀ ghi ra
 * file trong userData/logs (mỗi ngày 1 file, giữ tối đa 14 ngày) để debug lỗi
 * sau khi nó đã xảy ra — buffer trong renderer chỉ là in-memory.
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
const LOG_RETENTION_DAYS = 14;

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

// ---------- File sink (lazy init, không bao giờ làm hỏng app) ----------

let logDate = '';
let logStream: fs.WriteStream | null = null;

function getLogsDir(): string {
  return path.join(app.getPath('userData'), 'logs');
}

function openLogFile(date: string): void {
  try {
    if (logStream) logStream.end();
    const dir = getLogsDir();
    fs.mkdirSync(dir, { recursive: true });
    logDate = date;
    logStream = fs.createWriteStream(path.join(dir, `vanhsub-${date}.log`), { flags: 'a' });
    logStream.on('error', () => {
      logStream = null;
    });
    pruneOldLogs(dir, date);
  } catch {
    logStream = null;
  }
}

function pruneOldLogs(dir: string, today: string): void {
  try {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 3600 * 1000;
    for (const file of fs.readdirSync(dir)) {
      const m = /vanhsub-(\d{4}-\d{2}-\d{2})\.log$/.exec(file);
      if (m && new Date(`${m[1]}T00:00:00Z`).getTime() < cutoff && file !== `vanhsub-${today}.log`) {
        fs.unlinkSync(path.join(dir, file));
      }
    }
  } catch {
    // dọn log thất bại không đáng để báo lỗi
  }
}

function appendFileLog(level: LogEntry['level'], text: string, ts: number): void {
  try {
    const date = new Date(ts).toISOString().slice(0, 10);
    if (date !== logDate || !logStream) openLogFile(date);
    logStream?.write(`[${new Date(ts).toISOString()}] [${level}] ${text}\n`);
  } catch {
    // không bao giờ để logger làm hỏng app
  }
}

function emit(level: LogEntry['level'], args: unknown[]) {
  const entry: LogEntry = {
    level,
    text: args.map(formatArg).join(' '),
    ts: Date.now(),
  };
  appendFileLog(level, entry.text, entry.ts);
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
