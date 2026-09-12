import path from 'path';
import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { generateTtsFromSrt, regenerateTtsLine, type TTSEngine } from '../render/ttsEngine';
import { getSharedTikTokProvider } from '../tts-providers/tiktok/sessionStores';
import { isCancelledError } from '../lib/cancel';
import { getOrCreateProjectDir } from '../utils/projectFolder';

export class TTSRunner {
  private static runningTasks = new Set<string>();
  private static cancelledTasks = new Set<string>();
  private static regeneratingLines = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  /**
   * Giải quyết engine cho 1 lần chạy: caller > session TikTok > task đã lưu.
   * Session TikTok luôn thắng khi tồn tại — tab Lồng tiếng hiện là TikTok-only,
   * và các task bị ghi nhầm 'viettts' bởi heuristic cũ (dựa vào ttsVoice) cần
   * tự phục hồi mà không phải mở lại tab từng task. Không có session → dùng
   * engine đã lưu, mặc định VietTTS (đã cấu hình ở Cài đặt).
   */
  private static resolveEngine(task: Task, engine?: TTSEngine): TTSEngine {
    if (engine) return engine;
    if (getSharedTikTokProvider().hasSession()) return 'tiktok';
    if (task.ttsEngine) return task.ttsEngine;
    return 'viettts';
  }

  /** Yêu cầu huỷ: hiệu lực sau khi câu hiện tại tạo audio xong */
  static cancel(taskId: string): boolean {
    if (!this.runningTasks.has(taskId)) return false;
    this.cancelledTasks.add(taskId);
    return true;
  }

  /**
   * Tạo lại audio cho 1 dòng phụ đề (sau khi sửa text/đổi giọng) — ghi đè file
   * audio cũ. Trả về { ok, error? } thay vì throw để UI hiển thị trực tiếp.
   */
  static async regenerateLine(
    taskId: string,
    lineIndex: number,
    voice?: string,
    speed?: number,
    engine?: TTSEngine
  ): Promise<{ ok: boolean; error?: string }> {
    const task = TaskStore.getById(taskId);
    if (!task) return { ok: false, error: 'Không tìm thấy tác vụ.' };
    if (!task.ttsAudioDir) {
      return { ok: false, error: 'Tác vụ chưa tạo audio lồng tiếng — hãy chạy TTS trước.' };
    }

    const key = `${taskId}:${lineIndex}`;
    if (this.regeneratingLines.has(key)) {
      return { ok: false, error: `Dòng ${lineIndex} đang được tạo lại.` };
    }
    this.regeneratingLines.add(key);

    try {
      const srtPath = task.translatedSrtPath || task.srtPath;
      if (!srtPath) return { ok: false, error: 'Tác vụ không có file phụ đề.' };

      // Giọng của dòng: gán riêng trên task (ttsVoiceOverrides) ưu tiên trước
      // giọng chung — trước đây bỏ qua nên "Tạo lại audio dòng" luôn ra giọng mặc định
      const voiceForLine =
        voice || task.ttsVoiceOverrides?.[String(lineIndex)] || task.ttsVoice;
      const engineForLine: TTSEngine = this.resolveEngine(task, engine);

      await regenerateTtsLine(
        srtPath,
        task.ttsAudioDir,
        lineIndex,
        voiceForLine,
        speed || task.ttsSpeed,
        engineForLine
      );
      return { ok: true };
    } catch (err: any) {
      console.error(`Lỗi khi tạo lại audio dòng ${lineIndex} task ${taskId}:`, err);
      return { ok: false, error: err?.message || 'Không thể tạo lại audio cho dòng này.' };
    } finally {
      this.regeneratingLines.delete(key);
    }
  }

  static async runTTS(
    taskId: string,
    voice?: string,
    speed?: number,
    onUpdate?: () => void,
    voiceOverrides?: Record<string, string>,
    engine?: TTSEngine
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
    // Engine: tham số caller > engine đã lưu trên task > mặc định theo session —
    // có session TikTok thì dùng TikTok; KHÔNG dùng ttsVoice làm dấu hiệu chọn
    // engine (task cũ mang ttsVoice từ thời VietTTS khiến TikTok bị bỏ qua —
    // đúng lỗi "chọn giọng TikTok mà log toàn ra VietTTS")
    const engineToUse = this.resolveEngine(task, engine);
    console.log(`[TTS] Engine: ${engineToUse} · giọng: ${voiceToUse}`);

    try {
      // Ghi đè gán giọng khi caller truyền vào (kể cả object rỗng = xoá hết gán
      // cũ — trước đây object rỗng bị bỏ qua nên gán cũ còn dính); undefined
      // (pipeline) thì giữ nguyên gán đã lưu
      TaskStore.update(taskId, {
        status: 'dubbing',
        progress: 0,
        ttsVoice: voiceToUse,
        ttsSpeed: speedToUse,
        ttsEngine: engineToUse,
        ...(voiceOverrides !== undefined ? { ttsVoiceOverrides: voiceOverrides } : {}),
        stageDescription: `Đang khởi tạo lồng tiếng (${engineToUse})...`,
      });
      onUpdate?.();

      // Lưu audio files từng dòng vào thư mục dự án của video
      const projectDir = getOrCreateProjectDir(task);
      const ttsAudioDir = path.join(projectDir, 'tts_audio');

      const { audioFiles, totalDuration } = await generateTtsFromSrt(
        srtPath,
        ttsAudioDir,
        {
          voice: voiceToUse,
          speed: speedToUse,
          engine: engineToUse,
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
        projectDir,
        ttsAudioDir, // Lưu thư mục audio để dùng cho bước dubbing tiếp theo
        stageDescription: 'Đã hoàn tất tạo lồng tiếng vào thư mục dự án',
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
