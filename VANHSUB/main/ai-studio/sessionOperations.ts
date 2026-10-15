import { validateSessionIdentity } from './sessionPersistence';

const active = new Map<string, symbol>();
export function isSessionOperationActive(id: string): boolean { return active.has(id); }
export function reserveSessionOperation(id: string): () => void {
  validateSessionIdentity(id);
  if (active.has(id)) throw new Error('Phiên đang có tác vụ chạy hoặc chưa dừng hẳn.');
  const lease = Symbol(id); active.set(id, lease);
  return () => { if (active.get(id) === lease) active.delete(id); };
}
export async function withSessionOperation<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const release = reserveSessionOperation(id);
  try { return await operation(); } finally { release(); }
}
