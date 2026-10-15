import { nextAvailablePath } from '../lib/paths';
import fs from 'fs';
import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { translateSrtFile } from './translator';
import { CancelledError, isCancelledError } from '../lib/cancel';
import { getProjectArtifactPaths } from '../utils/projectFolder';
import { assertProjectIsolation } from '../lib/projectIsolation';

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

  static async runTranslate(
    taskId: string,
    targetLanguage?: string,
    onUpdate?: () => void
  ): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);
    assertProjectIsolation(task);

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
      TaskStore.update(taskId, {
        status: 'translating',
        progress: 0,
        targetLanguage: targetLang,
        stageDescription: 'Đang khởi tạo dịch thuật AI...',
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
        () => this.cancelledTasks.has(taskId)
      );

      if (this.cancelledTasks.has(taskId)) throw new CancelledError();
      const { translatedSrtPath: preferredPath, projectDir } = getProjectArtifactPaths(task);
      const expectedPath = nextAvailablePath(preferredPath);
      let finalTranslated = rawTranslatedPath;
      if (fs.existsSync(rawTranslatedPath) && rawTranslatedPath !== expectedPath) {
        try {
          fs.copyFileSync(rawTranslatedPath, expectedPath);
          fs.unlinkSync(rawTranslatedPath);
          finalTranslated = expectedPath;
          const rawTimeline = rawTranslatedPath.replace(/\.srt$/i, '.timeline.json');
          if (fs.existsSync(rawTimeline)) {
            try {
              fs.copyFileSync(rawTimeline, expectedPath.replace(/\.srt$/i, '.timeline.json'));
              fs.unlinkSync(rawTimeline);
            } catch (e) {
              console.warn('[TranslateRunner] Could not copy timeline evidence:', e);
            }
          }
        } catch {}
      }

      const updated = TaskStore.update(taskId, {
        status: 'done',
        progress: 100,
        ttsAudioDir: undefined, ttsMergedAudioPath: undefined, ttsOverruns: undefined, outputPath: undefined,
        errorMessage: undefined,
        projectDir,
        translatedSrtPath: finalTranslated,
        stageDescription: 'Đã hoàn tất dịch phụ đề vào thư mục dự án',
      });
      onUpdate?.();

      return updated;
    } catch (err: any) {
      if (isCancelledError(err)) {
        console.log(`Người dùng đã huỷ dịch task ${taskId}`);
        const updated = TaskStore.update(taskId, {
          status: 'cancelled',
          targetLanguage: task.targetLanguage,
          stageDescription: 'Đã huỷ dịch thuật',
        });
        onUpdate?.();
        return updated;
      }
      console.error(`Lỗi khi dịch thuật task ${taskId}:`, err);
      const updated = TaskStore.update(taskId, {
        status: 'error',
        targetLanguage: task.targetLanguage,
        errorMessage: err.message || 'Lỗi không xác định khi dịch thuật',
        stageDescription: 'Thất bại khi dịch thuật',
      });
      onUpdate?.();
      return updated;
    } finally {
      this.cancelledTasks.delete(taskId);
      this.runningTasks.delete(taskId);
    }
  }
}
