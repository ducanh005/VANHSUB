import fs from 'node:fs';
import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { TaskRunner } from '../asr/taskRunner';
import { TranslateRunner } from '../translate/translateRunner';
import { TTSRunner } from '../render/ttsRunner';
import { DubbingRunner } from '../render/dubbingRunner';
import { runTaskStage, isTaskBusy, cancelTaskRun, throwIfTaskCancelled } from '../lib/taskExecution';
import { isCancelledError } from '../lib/cancel';
import { hashFile, isTranslationCurrent } from '../lib/taskArtifacts';

export interface CorePipelineOptions {
  replaceAudio?: boolean;
}
export interface CorePipelineServices {
  getTask: (id: string) => Task | undefined;
  updateTask: (id: string, updates: Partial<Task>) => Task | undefined;
  hasKey: () => boolean;
  targetLanguage: () => string;
  asr: (id: string, update?: () => void) => Promise<Task | undefined>;
  translate: (id: string, update?: () => void) => Promise<Task | undefined>;
  tts: (id: string, update?: () => void) => Promise<Task | undefined>;
  dub: (id: string, replace: boolean, update?: () => void) => Promise<Task | undefined>;
}
const services: CorePipelineServices = {
  getTask: TaskStore.getById,
  updateTask: TaskStore.update,
  hasKey: () => SettingsStore.hasGeminiKey(),
  targetLanguage: () => SettingsStore.get('targetLanguage') || 'vi',
  asr: (id, update) => TaskRunner.runTask(id, update),
  translate: (id, update) => TranslateRunner.runTranslate(id, undefined, update),
  tts: (id, update) => TTSRunner.runTTS(id, undefined, undefined, update),
  dub: (id, replace, update) => DubbingRunner.runDubbing(id, replace, update),
};
const exists = (file?: string) => Boolean(file && fs.existsSync(file));

/** A pipeline holds its task lease through every stage and cancellation cleanup. */
export async function runCorePipeline(
  id: string,
  options: CorePipelineOptions = {},
  onUpdate?: () => void,
  dependencies = services
): Promise<void> {
  return runTaskStage(id, 'pipeline', async () => {
    const current = () => {
      throwIfTaskCancelled(id);
      const task = dependencies.getTask(id);
      if (!task || task.status === 'cancelled') throw new Error('Đã huỷ bởi người dùng');
      if (task.status === 'error') throw new Error(task.errorMessage || 'Bước xử lý trước thất bại.');
      return task;
    };
    try {
      dependencies.updateTask(id, { status: 'queued', errorMessage: undefined });
      let task = current();
      if (!exists(task.srtPath) || task.srtStale) {
        await dependencies.asr(id, onUpdate);
        task = current();
      }
      const target = (task.targetLanguage || dependencies.targetLanguage()).toLowerCase();
      const translationRequired = target !== (task.sourceLanguage || 'auto').toLowerCase();
      if (translationRequired && !isTranslationCurrent(task)) {
        if (!dependencies.hasKey())
          throw new Error(`Cần Gemini API key để dịch sang ${target}. Hãy cấu hình key trước khi chạy cả quy trình.`);
        await dependencies.translate(id, onUpdate);
        task = current();
      }
      const srt = isTranslationCurrent(task) ? task.translatedSrtPath : task.srtPath;
      if (
        !exists(task.ttsAudioDir) ||
        task.ttsStale ||
        (task.ttsSourceHash && srt && hashFile(srt) !== task.ttsSourceHash)
      ) {
        await dependencies.tts(id, onUpdate);
        task = current();
      }
      if (!exists(task.ttsAudioDir)) throw new Error('TTS chưa tạo được audio để ghép video.');
      await dependencies.dub(id, options.replaceAudio ?? true, onUpdate);
      current();
    } catch (error: any) {
      dependencies.updateTask(id, {
        status: isCancelledError(error) ? 'cancelled' : 'error',
        errorMessage: isCancelledError(error) ? undefined : error.message,
        stageDescription: isCancelledError(error) ? 'Đã huỷ quy trình' : 'Quy trình dừng do lỗi',
      });
    } finally {
      onUpdate?.();
    }
  });
}

export class PipelineRunner {
  private static active = new Set<string>();
  private static queue: { id: string; options: CorePipelineOptions; onUpdate?: () => void }[] = [];
  static isReserved(id: string): boolean {
    return this.active.has(id) || this.queue.some((job) => job.id === id);
  }
  static enqueue(id: string, options: CorePipelineOptions = {}, onUpdate?: () => void): boolean {
    const task = TaskStore.getById(id);
    if (
      !task ||
      isTaskBusy(id) ||
      this.isReserved(id) ||
      ['transcribing', 'ocr', 'translating', 'dubbing', 'exporting'].includes(task.status)
    )
      return false;
    this.queue.push({ id, options, onUpdate });
    TaskStore.update(id, {
      status: 'queued',
      stageDescription: 'Đang xếp hàng chạy quy trình',
      errorMessage: undefined,
    });
    onUpdate?.();
    this.drain();
    return true;
  }
  static cancel(id: string): boolean {
    const index = this.queue.findIndex((job) => job.id === id);
    if (index >= 0) {
      const [job] = this.queue.splice(index, 1);
      TaskStore.update(id, { status: 'cancelled', stageDescription: 'Đã huỷ quy trình trong hàng đợi' });
      job.onUpdate?.();
      return true;
    }
    return this.active.has(id) && cancelTaskRun(id);
  }
  private static drain(): void {
    while (this.active.size < 2 && this.queue.length) {
      const job = this.queue.shift()!;
      this.active.add(job.id);
      void runCorePipeline(job.id, job.options, job.onUpdate)
        .catch((error) => {
          TaskStore.update(job.id, { status: 'error', errorMessage: error.message });
        })
        .finally(() => {
          this.active.delete(job.id);
          job.onUpdate?.();
          this.drain();
        });
    }
  }
}
