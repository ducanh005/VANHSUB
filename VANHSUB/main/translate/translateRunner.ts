import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { translateSrtFile } from './translator';

export class TranslateRunner {
  private static runningTasks = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  static async runTranslate(
    taskId: string,
    targetLanguage?: string,
    onUpdate?: () => void
  ): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    if (!task.srtPath) {
      throw new Error('Tác vụ chưa có file phụ đề SRT để dịch.');
    }

    if (this.runningTasks.has(taskId)) {
      return task;
    }

    this.runningTasks.add(taskId);

    const targetLang = targetLanguage || task.targetLanguage || SettingsStore.get('targetLanguage') || 'vi';

    try {
      TaskStore.update(taskId, {
        status: 'translating',
        progress: 0,
        targetLanguage: targetLang,
        stageDescription: 'Đang khởi tạo dịch thuật AI...',
      });
      onUpdate?.();

      const { translatedSrtPath } = await translateSrtFile(task.srtPath, targetLang, (percent) => {
        TaskStore.update(taskId, {
          progress: percent,
          stageDescription: `Đang dịch phụ đề bằng Gemini (${percent}%)...`,
        });
        onUpdate?.();
      });

      const updated = TaskStore.update(taskId, {
        status: 'done',
        progress: 100,
        translatedSrtPath,
        stageDescription: 'Đã hoàn tất dịch phụ đề',
      });
      onUpdate?.();

      return updated;
    } catch (err: any) {
      console.error(`Lỗi khi dịch thuật task ${taskId}:`, err);
      const updated = TaskStore.update(taskId, {
        status: 'error',
        errorMessage: err.message || 'Lỗi không xác định khi dịch thuật',
        stageDescription: 'Thất bại khi dịch thuật',
      });
      onUpdate?.();
      return updated;
    } finally {
      this.runningTasks.delete(taskId);
    }
  }
}
