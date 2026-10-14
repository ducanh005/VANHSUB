import { validateSessionId } from './storage/sessionWorkspace';

interface SessionLease {
  controller: AbortController;
  processes: Set<{ kill(signal?: string): unknown }>;
  release(): void;
}
const operations = new Map<string, SessionLease>();

export function isSessionOperationActive(sessionId: string): boolean {
  return operations.has(sessionId);
}

export function reserveSessionOperation(sessionId: string): SessionLease {
  validateSessionId(sessionId);
  if (operations.has(sessionId)) throw new Error('Phiên AI Studio đang có tác vụ chạy. Hãy đợi tác vụ dừng hẳn trước khi chạy lại hoặc chỉnh sửa.');
  const lease: SessionLease = {
    controller: new AbortController(), processes: new Set(),
    release: () => { if (operations.get(sessionId) === lease) operations.delete(sessionId); },
  };
  operations.set(sessionId, lease);
  return lease;
}

export function cancelSessionOperation(sessionId: string): void {
  const lease = operations.get(sessionId);
  lease?.controller.abort();
  for (const process of lease?.processes || []) {
    try { process.kill('SIGKILL'); } catch {}
  }
  // Keep the reservation until the actual promise settles, including providers ignoring abort.
}

export function registerSessionProcess(sessionId: string, process: { kill(signal?: string): unknown }): void {
  operations.get(sessionId)?.processes.add(process);
}

export async function withSessionOperation<T>(sessionId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const lease = reserveSessionOperation(sessionId);
  try {
    const result = await operation(lease.controller.signal);
    lease.controller.signal.throwIfAborted();
    return result;
  } finally { lease.release(); }
}
