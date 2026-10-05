import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { CancelledError } from './cancel';

type Stage =
  'pipeline' | 'asr' | 'ocr' | 'hybrid' | 'translate' | 'tts' | 'regenerate' | 'merge' | 'dub' | 'export' | 'stems';
interface Run {
  id: string;
  token: string;
  stage: Stage;
  cancelled: boolean;
}
const runs = new Map<string, Run>();
const context = new AsyncLocalStorage<Run>();

export function isTaskBusy(id: string): boolean {
  return runs.has(id);
}
export function cancelTaskRun(id: string): boolean {
  const run = runs.get(id);
  if (!run) return false;
  run.cancelled = true;
  return true;
}
export function isTaskRunCancelled(id: string): boolean {
  return runs.get(id)?.cancelled === true;
}
export function throwIfTaskCancelled(id: string): void {
  if (isTaskRunCancelled(id)) throw new CancelledError();
}
export function withTaskContext<T>(id: string, fn: () => T): T {
  const run = runs.get(id);
  return run ? context.run(run, fn) : fn();
}

/** One root execution per task. Only explicitly supported child stages may share its run. */
export async function runTaskStage<T>(id: string, stage: Stage, fn: () => Promise<T>): Promise<T> {
  const existing = runs.get(id);
  const parent = context.getStore();
  if (existing) {
    const nested =
      parent?.token === existing.token &&
      (existing.stage === 'pipeline' ||
        (existing.stage === 'hybrid' && stage === 'ocr') ||
        (['asr', 'ocr', 'hybrid'].includes(existing.stage) && stage === 'translate'));
    if (!nested) throw new Error('Tác vụ đang chạy. Hãy chờ hoàn tất hoặc huỷ trước khi chạy bước khác.');
    throwIfTaskCancelled(id);
    return fn();
  }
  const run: Run = { id, token: randomUUID(), stage, cancelled: false };
  runs.set(id, run);
  try {
    return await context.run(run, fn);
  } finally {
    if (runs.get(id)?.token === run.token) runs.delete(id);
  }
}
