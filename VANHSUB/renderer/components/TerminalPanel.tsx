import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Terminal, Trash2 } from 'lucide-react';

/**
 * Terminal mini hiển thị log xử lý của main process (ASR/dịch/TTS/export…).
 *
 * Buffer log nằm ở module scope nên nội dung giữ nguyên khi chuyển tab
 * (component unmount/remount). Panel mặc định thu gọn thành thanh cuối trang.
 */

interface LogEntry {
  level: string;
  text: string;
  ts: number;
}

// Buffer dùng chung mọi lần mount — tối đa 500 dòng
const logBuffer: LogEntry[] = [];
const bufferListeners = new Set<() => void>();

function pushEntry(entry: LogEntry) {
  logBuffer.push(entry);
  if (logBuffer.length > 500) logBuffer.splice(0, logBuffer.length - 500);
  bufferListeners.forEach((l) => l());
}

const LEVEL_STYLE: Record<string, string> = {
  info: 'text-slate-300',
  warn: 'text-amber-400',
  error: 'text-rose-400',
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour12: false });
}

export default function TerminalPanel() {
  const [expanded, setExpanded] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(logBuffer);
  const [unseen, setUnseen] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.logs?.onLog) return;
    const unsubscribe = window.vanhsub.logs.onLog((entry) => {
      pushEntry(entry);
      setLogs([...logBuffer]);
      if (!expanded) setUnseen((n) => n + 1);
    });
    return unsubscribe;
  }, [expanded]);

  // Auto-scroll xuống dòng mới nhất khi mở panel
  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, expanded]);

  const toggle = () => {
    setExpanded((prev) => !prev);
    setUnseen(0);
  };

  return (
    <div className="pointer-events-auto border-t border-slate-800 bg-slate-950/95">
      <div className="flex items-center justify-between px-4 py-1.5">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          <Terminal className="h-3.5 w-3.5 text-brand-cyan" />
          <span>Terminal</span>
          {!expanded && unseen > 0 && (
            <span className="rounded-full bg-brand-cyan/20 px-1.5 py-0.5 text-[10px] font-bold text-brand-cyan">
              {unseen}
            </span>
          )}
        </button>
        {expanded && (
          <button
            type="button"
            onClick={() => {
              logBuffer.length = 0;
              setLogs([]);
            }}
            title="Xoá log"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
          >
            <Trash2 className="h-3 w-3" />
            <span>Xoá</span>
          </button>
        )}
      </div>

      {expanded && (
        <div
          ref={scrollRef}
          className="h-56 overflow-y-auto border-t border-slate-800/80 bg-black/60 px-4 py-2 font-mono text-[11px] leading-relaxed"
        >
          {logs.length === 0 ? (
            <p className="text-slate-600">Chưa có log — bắt đầu phiên âm/dịch/lồng tiếng để xem tiến trình.</p>
          ) : (
            logs.map((entry, i) => (
              <p key={`${entry.ts}-${i}`} className={LEVEL_STYLE[entry.level] || 'text-slate-300'}>
                <span className="text-slate-600">[{formatTime(entry.ts)}]</span> {entry.text}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  );
}
