import path from 'path';
import { TaskStore, type Task } from '../store/taskStore';
import { nextAvailablePath } from '../lib/paths';
import { dubVideo, type SyncMode } from './dubbingEngine';

export interface DubbingOptions {
  replaceAudio?: boolean;
  /** Chế độ đồng bộ audio-video */
  syncMode?: SyncMode;
  /** Giữ nhạc nền/SFX gốc, mix nhỏ dưới lời thoại (chỉ khi replaceAudio) */
  mixOriginalAudio?: boolean;
  /** AI tách lời thoại gốc (demucs): nhạc nền giữ nguyên, giọng người gốc bị loại */
  vocalSeparation?: boolean;
}

export class DubbingRunner {
  private static runningTasks = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  static async runDubbing(
    taskId: string,
    replaceAudio: boolean = true,
    onUpdate?: () => void,
    options?: Omit<DubbingOptions, 'replaceAudio'>
  ): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    // Kiểm tra các file cần thiết
    if (!task.srtPath) {
      throw new Error('Tác vụ chưa có file phụ đề SRT.');
    }

    if (!task.ttsAudioDir) {
      throw new Error('Tác vụ chưa tạo audio lồng tiếng. Hãy chạy TTS trước.');
    }

    if (this.runningTasks.has(taskId)) {
      return task;
    }

    this.runningTasks.add(taskId);

    try {
      TaskStore.update(taskId, {
        status: 'exporting', // Reuse exporting status cho dubbing
        progress: 0,
        stageDescription: 'Đang ghép audio lồng tiếng vào video...',
      });
      onUpdate?.();

      // Xác định đường dẫn output — thêm _1, _2… nếu đã có bản dubbed trước đó
      const videoDir = path.dirname(task.filePath);
      const videoName = path.parse(task.fileName).name;
      const outputPath = nextAvailablePath(
        path.join(videoDir, `${videoName}_dubbed_${replaceAudio ? 'mono' : 'bilingual'}.mp4`)
      );

      // Chạy full dubbing pipeline
      const { outputPath: finalPath, overruns, stretchFactor } = await dubVideo(
        task.filePath,
        task.translatedSrtPath || task.srtPath, // Ưu tiên dùng bản dịch
        task.ttsAudioDir,
        outputPath,
        {
          replaceAudio,
          syncMode: options?.syncMode,
          mixOriginalAudio: options?.mixOriginalAudio,
          vocalSeparation: options?.vocalSeparation,
        },
        (percent) => {
          TaskStore.update(taskId, {
            progress: percent,
            stageDescription: `Đang xử lý dubbing (${percent}%)...`,
          });
          onUpdate?.();
        }
      );

      const truncatedCount = overruns.filter((o) => o.truncated).length;
      const updated = TaskStore.update(taskId, {
        status: 'done',
        progress: 100,
        outputPath: finalPath,
        // Ghi đè báo cáo câu tràn của lần dubbing này (rỗng = không có câu nào tràn)
        ttsOverruns: overruns,
        stageDescription:
          truncatedCount > 0
            ? `Đã hoàn tất dubbing — ${truncatedCount} câu tràn quá 1.5x bị cắt phần cuối`
            : stretchFactor > 1.01
              ? `Đã hoàn tất dubbing (video giãn ${stretchFactor}x)`
              : 'Đã hoàn tất dubbing video',
      });
      onUpdate?.();

      return updated;
    } catch (err: any) {
      console.error(`Lỗi khi dubbing task ${taskId}:`, err);
      const updated = TaskStore.update(taskId, {
        status: 'error',
        errorMessage: err.message || 'Lỗi không xác định khi dubbing',
        stageDescription: 'Thất bại khi dubbing',
      });
      onUpdate?.();
      return updated;
    } finally {
      this.runningTasks.delete(taskId);
    }
  }
}
