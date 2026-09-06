import fs from 'fs';
import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { extract16kHzWav } from './audioExtractor';
import { transcribe } from './whisperEngine';
import { TranslateRunner } from '../translate/translateRunner';
import { CancelledError, isCancelledError } from '../lib/cancel';

export class TaskRunner {
  private static runningTasks = new Set<string>();
  private static cancelledTasks = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  /** Yêu cầu huỷ phiên âm — có hiệu lực giữa các chunk audio (hợp tác) */
  static cancel(taskId: string): boolean {
    if (!this.runningTasks.has(taskId)) return false;
    this.cancelledTasks.add(taskId);
    return true;
  }

  static async runTask(taskId: string, onUpdate?: () => void): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    if (this.runningTasks.has(taskId)) {
      return task;
    }

    this.runningTasks.add(taskId);
    this.cancelledTasks.delete(taskId);

    try {
      // Giai đoạn 1: Chuẩn bị & trích xuất audio 16kHz
      TaskStore.update(taskId, {
        status: 'transcribing',
        progress: 10,
        stageDescription: 'Đang trích xuất audio 16kHz chuẩn...',
      });
      onUpdate?.();

      const { wavPath } = await extract16kHzWav(task.filePath, undefined, (percent) => {
        TaskStore.update(taskId, {
          progress: 10 + Math.round(percent * 0.2), // 10% -> 30%
        });
        onUpdate?.();
      });

      // Giai đoạn 2: Nhận diện giọng nói bằng Whisper ASR
      // Audio dài sẽ được chia chunk trong whisperEngine — progress theo từng chunk
      TaskStore.update(taskId, {
        progress: 35,
        audioPath: wavPath,
        stageDescription: `Đang nhận diện giọng nói (${task.asrModel || SettingsStore.get('asrModel') || 'base'})...`,
      });
      onUpdate?.();

      const result = await transcribe(wavPath, {
        modelName: task.asrModel || SettingsStore.get('asrModel') || 'base',
        onProgress: (percent) => {
          TaskStore.update(taskId, {
            progress: 35 + Math.round(percent * 0.55), // 35% -> 90%
            stageDescription:
              percent < 100
                ? `Đang phiên âm (${percent}%)...`
                : 'Đang hoàn tất file phụ đề...',
          });
          onUpdate?.();
        },
        shouldStop: () => this.cancelledTasks.has(taskId),
      });

      // Giai đoạn 3: Hoàn thành tạo phụ đề .srt
      TaskStore.update(taskId, {
        status: 'done',
        progress: 100,
        srtPath: result.srtPath,
        stageDescription: 'Đã tạo xong phụ đề .srt',
      });
      onUpdate?.();

      // Tự động dịch nếu bật option autoTranslateAfterAsr và đã có Gemini Key
      if (SettingsStore.get('autoTranslateAfterAsr') && SettingsStore.hasGeminiKey()) {
        await TranslateRunner.runTranslate(taskId, undefined, onUpdate);
      }

      return TaskStore.getById(taskId);
    } catch (err: any) {
      if (isCancelledError(err)) {
        console.log(`Người dùng đã huỷ phiên âm task ${taskId}`);
        const updated = TaskStore.update(taskId, {
          status: 'cancelled',
          stageDescription: 'Đã huỷ phiên âm',
        });
        onUpdate?.();
        return updated;
      }
      console.error(`Lỗi khi xử lý task ${taskId}:`, err);
      const updated = TaskStore.update(taskId, {
        status: 'error',
        errorMessage: err.message || 'Lỗi không xác định khi phiên âm',
        stageDescription: 'Thất bại khi xử lý',
      });
      onUpdate?.();
      return updated;
    } finally {
      this.runningTasks.delete(taskId);
      this.cancelledTasks.delete(taskId);
    }
  }
}
