import path from 'path';
import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { generateTtsFromSrt } from '../render/ttsEngine';
import { isCancelledError } from '../lib/cancel';

export class TTSRunner {
  private static runningTasks = new Set<string>();
  private static cancelledTasks = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  /** Yêu cầu huỷ: hiệu lực sau khi câu hiện tại tạo audio xong */
  static cancel(taskId: string): boolean {
    if (!this.runningTasks.has(taskId)) return false;
    this.cancelledTasks.add(taskId);
    return true;
  }

  static async runTTS(
    taskId: string,
    voice?: string,
    speed?: number,
    onUpdate?: () => void,
    voiceOverrides?: Record<string, string>
  ): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    // Kiểm tra file phụ đề (ưu tiên dùng bản dịch, nếu không có thì dùng bản gốc)
    const srtPath = task.translatedSrtPath || task.srtPath;
    if (!srtPath) {
      throw new Error('Tác vụ chưa có file phụ đề SRT để tạo lồng tiếng.');
    }

    if (this.runningTasks.has(taskId)) {
      return task;
    }

    this.runningTasks.add(taskId);
    this.cancelledTasks.delete(taskId);

    const voiceToUse = voice || task.ttsVoice || SettingsStore.get('ttsVoice') || 'alloy';
    const speedToUse = speed || task.ttsSpeed || SettingsStore.get('ttsSpeed') || 1.0;

    try {
      // Chỉ ghi đè ttsVoiceOverrides khi caller truyền gán giọng mới —
      // nếu không sẽ xoá mất gán giọng cũ đã lưu trên task
      TaskStore.update(taskId, {
        status: 'dubbing',
        progress: 0,
        ttsVoice: voiceToUse,
        ttsSpeed: speedToUse,
        ...(voiceOverrides && Object.keys(voiceOverrides).length > 0
          ? { ttsVoiceOverrides: voiceOverrides }
          : {}),
        stageDescription: 'Đang khởi tạo tạo lồng tiếng AI...',
      });
      onUpdate?.();

      // Tạo thư mục tạm để lưu audio files từng dòng
      const ttsAudioDir = path.join(
        path.dirname(task.filePath),
        `.vanhsub_tts_${taskId.slice(0, 8)}`
      );

      const { audioFiles, totalDuration } = await generateTtsFromSrt(
        srtPath,
        ttsAudioDir,
        {
          voice: voiceToUse,
          speed: speedToUse,
          voiceOverrides: voiceOverrides || task.ttsVoiceOverrides,
          shouldStop: () => this.cancelledTasks.has(taskId),
        },
        (current, total) => {
          const progress = Math.round((current / total) * 100);
          TaskStore.update(taskId, {
            progress,
            stageDescription: `Đang tạo lồng tiếng (${current}/${total})...`,
          });
          onUpdate?.();
        }
      );

      const updated = TaskStore.update(taskId, {
        status: 'done',
        progress: 100,
        ttsAudioDir, // Lưu thư mục audio để dùng cho bước dubbing tiếp theo
        stageDescription: 'Đã hoàn tất tạo lồng tiếng',
      });
      onUpdate?.();

      return updated;
    } catch (err: any) {
      if (isCancelledError(err)) {
        console.log(`Người dùng đã huỷ tạo lồng tiếng task ${taskId}`);
        const updated = TaskStore.update(taskId, {
          status: 'cancelled',
          stageDescription: 'Đã huỷ tạo lồng tiếng',
        });
        onUpdate?.();
        return updated;
      }
      console.error(`Lỗi khi tạo lồng tiếng task ${taskId}:`, err);
      const updated = TaskStore.update(taskId, {
        status: 'error',
        errorMessage: err.message || 'Lỗi không xác định khi tạo lồng tiếng',
        stageDescription: 'Thất bại khi tạo lồng tiếng',
      });
      onUpdate?.();
      return updated;
    } finally {
      this.cancelledTasks.delete(taskId);
      this.runningTasks.delete(taskId);
    }
  }
}
