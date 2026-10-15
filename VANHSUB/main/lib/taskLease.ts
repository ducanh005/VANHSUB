const active = new Set<string>();

export function isTaskOperationActive(id: string): boolean { return active.has(id); }
export function reserveTaskOperation(id: string): () => void {
  if (typeof id !== 'string' || !id) throw new Error('Thiếu ID tác vụ.');
  if (active.has(id)) throw new Error('Tác vụ đang xử lý. Hãy đợi tác vụ dừng hẳn trước khi chạy hoặc chỉnh sửa.');
  active.add(id);
  let released = false;
  return () => { if (!released) { released = true; active.delete(id); } };
}

export function launchTaskOperation(id: string, operation: () => Promise<unknown>, onError: (error: unknown) => void): Promise<void> {
  const release = reserveTaskOperation(id);
  return Promise.resolve().then(operation).then(() => {}, error => {
    try { onError(error); } catch (reportError) { console.error('Không thể ghi trạng thái lỗi tác vụ:', reportError); }
  }).finally(release);
}

export async function withTaskOperation<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const release = reserveTaskOperation(id);
  try { return await operation(); } finally { release(); }
}
