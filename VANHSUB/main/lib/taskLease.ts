import { reserveTaskOperation } from './taskOperations';
export { reserveTaskOperation, isTaskOperationActive, withTaskOperation } from './taskOperations';

export function launchTaskOperation(id: string, operation: () => Promise<unknown>, onError: (error: unknown) => void): Promise<void> {
  const release = reserveTaskOperation(id);
  return Promise.resolve().then(operation).then(() => {}, error => {
    try { onError(error); } catch (reportError) { console.error('Không thể ghi trạng thái lỗi tác vụ:', reportError); }
  }).finally(release);
}

