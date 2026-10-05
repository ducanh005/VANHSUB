import { invalidateTaskArtifacts, hashFile } from '../lib/taskArtifacts';
import { nextAvailablePath } from '../lib/paths';
import { createGeminiClient } from '../ai/geminiClient';
import { translationConfigHash } from '../lib/translationConfig';
import { runTaskStage, isTaskRunCancelled, throwIfTaskCancelled } from '../lib/taskExecution';
import fs from 'fs';
import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { translateSrtFile } from './translator';
import { CancelledError, isCancelledError } from '../lib/cancel';
import { getProjectArtifactPaths } from '../utils/projectFolder';

export class TranslateRunner {
  private static runningTasks = new Set<string>();
  private static cancelledTasks = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  /** Yêu cầu huỷ: hiệu lực sau khi batch dịch hiện tại chạy xong */
  static cancel(taskId: string): boolean {
    if (!this.runningTasks.has(taskId)) return false;
    this.cancelledTasks.add(taskId);
    return true;
  }

  static async runTranslate(taskId: string, targetLanguage?: string, onUpdate?: () => void): Promise<Task | undefined> {
    return runTaskStage(taskId, 'translate', async () => {
      const task = TaskStore.getById(taskId);
      if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

      if (!task.srtPath) {
        throw new Error('Tác vụ chưa có file phụ đề SRT để dịch.');
      }

      if (this.runningTasks.has(taskId)) {
        return task;
      }

      this.runningTasks.add(taskId);
      this.cancelledTasks.delete(taskId);

      const targetLang = targetLanguage || task.targetLanguage || SettingsStore.get('targetLanguage') || 'vi';

      try {
        createGeminiClient();
        const sourceHash = hashFile(task.srtPath);
        const configHash = translationConfigHash(targetLang);
        TaskStore.update(taskId, {
          status: 'translating',
          progress: 0,
          stageDescription: 'Đang khởi tạo dịch thuật AI...',
          errorMessage: undefined,
        });
        onUpdate?.();

        const { translatedSrtPath: rawTranslatedPath } = await translateSrtFile(
          task.srtPath,
          targetLang,
          (percent) => {
            TaskStore.update(taskId, {
              progress: percent,
              stageDescription: `Đang dịch phụ đề bằng Gemini (${percent}%)...`,
            });
            onUpdate?.();
          },
          () => this.cancelledTasks.has(taskId) || isTaskRunCancelled(taskId)
        );

        const { translatedSrtPath: expectedPath, projectDir } = getProjectArtifactPaths(task);
        throwIfTaskCancelled(taskId);
        if (hashFile(task.srtPath) !== sourceHash)
          throw new Error('Phụ đề nguồn đã thay đổi trong khi dịch. Hãy chạy lại.');
        if (translationConfigHash(targetLang) !== configHash)
          throw new Error('Cấu hình dịch đã thay đổi trong khi xử lý. Hãy chạy lại.');
        if (this.cancelledTasks.has(taskId)) throw new CancelledError();
        const destination = nextAvailablePath(expectedPath);
        let finalTranslated = rawTranslatedPath;
        if (fs.existsSync(rawTranslatedPath) && rawTranslatedPath !== destination) {
          try {
            fs.copyFileSync(rawTranslatedPath, destination);
            fs.unlinkSync(rawTranslatedPath);
            finalTranslated = destination;
          } catch {}
        }

        invalidateTaskArtifacts(taskId, 'translation');
        const updated = TaskStore.update(taskId, {
          status: 'done',
          progress: 100,
          projectDir,
          translatedSrtPath: finalTranslated,
          targetLanguage: targetLang,
          translationStale: false,
          translationSourceHash: sourceHash,
          translationConfigHash: configHash,
          stageDescription: 'Đã hoàn tất dịch phụ đề vào thư mục dự án',
        });
        onUpdate?.();

        return updated;
      } catch (err: any) {
        if (isCancelledError(err)) {
          console.log(`Người dùng đã huỷ dịch task ${taskId}`);
          const updated = TaskStore.update(taskId, {
            status: 'cancelled',
            stageDescription: 'Đã huỷ dịch thuật',
          });
          onUpdate?.();
          return updated;
        }
        console.error(`Lỗi khi dịch thuật task ${taskId}:`, err);
        const updated = TaskStore.update(taskId, {
          status: 'error',
          errorMessage: err.message || 'Lỗi không xác định khi dịch thuật',
          stageDescription: 'Thất bại khi dịch thuật',
        });
        onUpdate?.();
        return updated;
      } finally {
        this.cancelledTasks.delete(taskId);
        this.runningTasks.delete(taskId);
      }
    });
  }
}
