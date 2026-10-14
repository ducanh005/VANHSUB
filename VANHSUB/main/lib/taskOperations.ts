const operations = new Map<string, symbol>();

export function isTaskOperationActive(id: string): boolean { return operations.has(id); }

export function assertTaskAvailable(id: string): void {
  if (operations.has(id)) throw new Error('Tác vụ đang xử lý hoặc chờ trong hàng đợi. Hãy chờ hoàn tất hoặc huỷ tác vụ.');
}

/** Reserve at IPC entry, before any await or runner queue can yield control. */
export function reserveTaskOperation(id: string): () => void {
  assertTaskAvailable(id);
  const token = Symbol(id);
  operations.set(id, token);
  return () => { if (operations.get(id) === token) operations.delete(id); };
}

export async function withTaskOperation<T>(id: string, work: () => Promise<T>): Promise<T> {
  const release = reserveTaskOperation(id);
  try { return await work(); } finally { release(); }
}
