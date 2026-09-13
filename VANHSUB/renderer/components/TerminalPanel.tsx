import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, Terminal, Trash2, Maximize2, Minimize2, GripHorizontal } from 'lucide-react';

/**
 * Terminal mini hiển thị log xử lý của main process (ASR/dịch/TTS/export…).
 *
 * Hỗ trợ kéo giãn chiều cao linh hoạt (resizable), lưu chiều cao vào localStorage.
 * Buffer log nằm ở module scope nên nội dung giữ nguyên khi chuyển tab.
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

const DEFAULT_HEIGHT = 224;
const MIN_HEIGHT = 110;
const MAX_HEIGHT = 650;

export default function TerminalPanel() {
  const [expanded, setExpanded] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(logBuffer);
  const [unseen, setUnseen] = useState(0);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragStartYRef = useRef<number>(0);
  const dragStartHeightRef = useRef<number>(DEFAULT_HEIGHT);

  // Khôi phục chiều cao đã lưu
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('vanhsub_terminal_height');
      if (saved) {
        const val = Number(saved);
        if (val >= MIN_HEIGHT && val <= MAX_HEIGHT) {
          setHeight(val);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vanhsub?.logs?.onLog) return;
    const unsubscribe = window.vanhsub.logs.onLog((entry) => {
      pushEntry(entry);
      setLogs([...logBuffer]);
      if (!expanded) setUnseen((n) => n + 1);
    });
    return unsubscribe;
  }, [expanded]);

  // Auto-scroll xuống dòng mới nhất khi mở panel hoặc có log mới
  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, expanded]);

  const toggle = () => {
    setExpanded((prev) => !prev);
    setUnseen(0);
  };

  // Kéo giãn độ cao chuột
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setIsMaximized(false);
    dragStartYRef.current = e.clientY;
    dragStartHeightRef.current = height;
  }, [height]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = dragStartYRef.current - e.clientY;
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragStartHeightRef.current + deltaY));
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      try {
        localStorage.setItem('vanhsub_terminal_height', String(height));
      } catch {}
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, height]);

  const toggleMaximize = () => {
    if (isMaximized) {
      setIsMaximized(false);
      setHeight(dragStartHeightRef.current || DEFAULT_HEIGHT);
    } else {
      dragStartHeightRef.current = height;
      setIsMaximized(true);
      setHeight(Math.min(window.innerHeight * 0.75, 560));
    }
  };

  return (
    <div className={`pointer-events-auto border-t border-slate-800 bg-slate-950/95 transition-all duration-75 relative select-none ${isDragging ? 'cursor-ns-resize select-none' : ''}`}>
      {/* Resizable Drag Handle Bar ở mép trên cùng */}
      {expanded && (
        <div
          onMouseDown={handleMouseDown}
          title="Kéo chuột lên/xuống để chỉnh độ cao Terminal"
          className="group absolute -top-1 left-0 right-0 h-2.5 flex items-center justify-center cursor-ns-resize z-30 hover:bg-brand-cyan/20 transition-colors"
        >
          <div className="w-16 h-1 rounded-full bg-slate-700/60 group-hover:bg-brand-cyan group-hover:w-24 transition-all" />
        </div>
      )}

      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-slate-800/60">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          <Terminal className="h-3.5 w-3.5 text-brand-cyan" />
          <span>Terminal Log</span>
          {!expanded && unseen > 0 && (
            <span className="rounded-full bg-brand-cyan/20 px-1.5 py-0.5 text-[10px] font-bold text-brand-cyan">
              {unseen}
            </span>
          )}
        </button>

        {expanded && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">
              {height}px (kéo mép trên để chỉnh)
            </span>

            {/* Nút phóng to / thu nhỏ chiều cao */}
            <button
              type="button"
              onClick={toggleMaximize}
              title={isMaximized ? 'Thu nhỏ chiều cao Terminal' : 'Phóng to chiều cao Terminal'}
              className="p-1 rounded text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition cursor-pointer"
            >
              {isMaximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            </button>

            {/* Nút xoá log */}
            <button
              type="button"
              onClick={() => {
                logBuffer.length = 0;
                setLogs([]);
              }}
              title="Xoá toàn bộ log"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
              <span>Xoá</span>
            </button>
          </div>
        )}
      </div>

      {/* Log Console Body */}
      {expanded && (
        <div
          ref={scrollRef}
          style={{ height: `${height}px` }}
          className="overflow-y-auto bg-black/75 px-4 py-2 font-mono text-[11px] leading-relaxed custom-scrollbar"
        >
          {logs.length === 0 ? (
            <p className="text-slate-600 italic">Chưa có log — bắt đầu phiên âm/dịch/lồng tiếng để xem tiến trình thời gian thực.</p>
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
