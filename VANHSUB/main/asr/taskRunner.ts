import fs from 'fs';
import { TaskStore, type Task } from '../store/taskStore';
import { extract16kHzWav } from './audioExtractor';
import { transcribe } from './whisperEngine';

export class TaskRunner {
  private static runningTasks = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  static async runTask(taskId: string, onUpdate?: () => void): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    if (this.runningTasks.has(taskId)) {
      return task;
    }

    this.runningTasks.add(taskId);

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
      TaskStore.update(taskId, {
        progress: 35,
        audioPath: wavPath,
        stageDescription: `Đang nhận diện giọng nói (${task.asrModel || 'base'})...`,
      });
      onUpdate?.();

      const result = await transcribe(wavPath, {
        modelName: task.asrModel || 'base',
      });

      // Giai đoạn 3: Hoàn thành tạo phụ đề .srt
      const updated = TaskStore.update(taskId, {
        status: 'done',
        progress: 100,
        srtPath: result.srtPath,
        stageDescription: 'Đã tạo xong phụ đề .srt',
      });
      onUpdate?.();

      return updated;
    } catch (err: any) {
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
    }
  }
}
