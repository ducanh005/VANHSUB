import { runTaskStage, isTaskRunCancelled, throwIfTaskCancelled } from '../lib/taskExecution';
import fs from 'fs';
import path from 'path';
import type ffmpeg from 'fluent-ffmpeg';
import { TaskStore, type Task } from '../store/taskStore';
import { nextAvailablePath } from '../lib/paths';
import { getOrCreateProjectDir } from '../utils/projectFolder';
import { dubVideo, type SyncMode } from './dubbingEngine';
import { killProcessTreeByPid } from '../lib/processTree';
import { isCancelledError } from '../lib/cancel';
import { getTaskSrtPath, hashFile } from '../lib/taskArtifacts';

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
  private static runningCommands = new Map<string, ffmpeg.FfmpegCommand>();
  private static cancelledTasks = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }

  /**
   * Huỷ tác vụ dubbing đang chạy và tiêu diệt sạch tiến trình FFmpeg trên OS.
   */
  static cancel(taskId: string): boolean {
    if (!this.runningTasks.has(taskId)) {
      return false;
    }
    this.cancelledTasks.add(taskId);

    TaskStore.update(taskId, {
      status: 'cancelled',
      stageDescription: 'Tác vụ đã bị huỷ bởi người dùng',
    });

    const cmd = this.runningCommands.get(taskId);
    if (cmd) {
      try {
        const proc = (cmd as any).ffmpegProc;
        if (proc && proc.pid) {
          killProcessTreeByPid(proc.pid);
        }
      } catch (err) {
        console.warn(`[DubbingRunner] Lỗi khi taskkill FFmpeg cho task ${taskId}:`, err);
      }

      try {
        (cmd as any).kill?.('SIGKILL');
      } catch (err) {
        console.warn(`[DubbingRunner] Lỗi khi kill command cho task ${taskId}:`, err);
      }
      this.runningCommands.delete(taskId);
    }
    return true;
  }

  static async runDubbing(
    taskId: string,
    replaceAudio: boolean = true,
    onUpdate?: () => void,
    options?: Omit<DubbingOptions, 'replaceAudio'>
  ): Promise<Task | undefined> {
    return runTaskStage(taskId, 'dub', async () => {
      const task = TaskStore.getById(taskId);
      if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

      // Kiểm tra các file cần thiết
      if (!task.srtPath) {
        throw new Error('Tác vụ chưa có file phụ đề SRT.');
      }

      if (!task.ttsAudioDir) {
        throw new Error('Tác vụ chưa tạo audio lồng tiếng. Hãy chạy TTS trước.');
      }
      const srtPath = getTaskSrtPath(task);
      if (!srtPath || task.ttsStale || (task.ttsSourceHash && task.ttsSourceHash !== hashFile(srtPath))) {
        throw new Error('Phụ đề đã thay đổi. Hãy tạo lại TTS trước khi ghép video.');
      }

      if (this.runningTasks.has(taskId)) {
        return task;
      }

      this.runningTasks.add(taskId);
      this.cancelledTasks.delete(taskId);

      // Xác định đường dẫn output trong thư mục dự án — thêm _1, _2… nếu đã có bản dubbed trước đó
      const projectDir = getOrCreateProjectDir(task);
      const videoName = path.parse(task.fileName).name;
      const outputPath = nextAvailablePath(
        path.join(projectDir, `${videoName}_dubbed_${replaceAudio ? 'mono' : 'bilingual'}.mp4`)
      );

      try {
        if (this.cancelledTasks.has(taskId) || TaskStore.getById(taskId)?.status === 'cancelled') {
          if (TaskStore.getById(taskId)?.status !== 'cancelled') {
            TaskStore.update(taskId, {
              status: 'cancelled',
              stageDescription: 'Tác vụ đã bị huỷ bởi người dùng',
            });
            onUpdate?.();
          }
          return TaskStore.getById(taskId);
        }

        TaskStore.update(taskId, {
          status: 'exporting', // Reuse exporting status cho dubbing
          progress: 0,
          stageDescription: 'Đang ghép audio lồng tiếng vào video...',
        });
        onUpdate?.();

        // Chạy full dubbing pipeline
        const {
          outputPath: finalPath,
          overruns,
          stretchFactor,
        } = await dubVideo(
          task.filePath,
          srtPath,
          task.ttsAudioDir,
          outputPath,
          {
            replaceAudio,
            syncMode: options?.syncMode,
            mixOriginalAudio: options?.mixOriginalAudio,
            vocalSeparation: options?.vocalSeparation,
            onCommandCreated: (command) => {
              this.runningCommands.set(taskId, command);
            },
            shouldStop: () =>
              this.cancelledTasks.has(taskId) ||
              isTaskRunCancelled(taskId) ||
              TaskStore.getById(taskId)?.status === 'cancelled',
          },
          (percent) => {
            if (this.cancelledTasks.has(taskId) || TaskStore.getById(taskId)?.status === 'cancelled') {
              return;
            }
            TaskStore.update(taskId, {
              progress: percent,
              stageDescription: `Đang xử lý dubbing (${percent}%)...`,
            });
            onUpdate?.();
          }
        );

        // F-EXP-02 Guard: Ngăn chặn lỗi hồi sinh tác vụ khi task đã bị huỷ
        throwIfTaskCancelled(taskId);
        const currentTask = TaskStore.getById(taskId);
        if (this.cancelledTasks.has(taskId) || currentTask?.status === 'cancelled') {
          console.log(
            `[DubbingRunner] Tác vụ ${taskId} đã bị huỷ trước đó. Bỏ qua cập nhật 'done' và dọn dẹp file dở dang.`
          );
          if (outputPath && fs.existsSync(outputPath)) {
            try {
              fs.unlinkSync(outputPath);
            } catch (e) {
              console.warn(`[DubbingRunner] Không thể xoá file output dở dang: ${outputPath}`, e);
            }
          }
          if (TaskStore.getById(taskId)?.status !== 'cancelled') {
            TaskStore.update(taskId, {
              status: 'cancelled',
              stageDescription: 'Tác vụ đã bị huỷ bởi người dùng',
            });
            onUpdate?.();
          }
          return TaskStore.getById(taskId);
        }

        const truncatedCount = overruns.filter((o) => o.truncated).length;
        const updated = TaskStore.update(taskId, {
          status: 'done',
          progress: 100,
          outputPath: finalPath,
          dubbedPath: finalPath,
          dubbedStretchFactor: stretchFactor,
          dubbedStale: false,
          projectDir,
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
        const currentTask = TaskStore.getById(taskId);
        const wasCancelled =
          this.cancelledTasks.has(taskId) || currentTask?.status === 'cancelled' || isCancelledError(err);

        if (outputPath && fs.existsSync(outputPath)) {
          try {
            fs.unlinkSync(outputPath);
          } catch (e) {
            console.warn(`[DubbingRunner] Không thể xoá file output dở dang: ${outputPath}`, e);
          }
        }

        if (wasCancelled) {
          console.log(`[DubbingRunner] Tác vụ ${taskId} đã bị huỷ bởi người dùng.`);
          const updated = TaskStore.update(taskId, {
            status: 'cancelled',
            stageDescription: 'Đã huỷ ghép audio vào video',
          });
          onUpdate?.();
          return updated;
        }

        console.error(`Lỗi khi dubbing task ${taskId}:`, err);
        const updated = TaskStore.update(taskId, {
          status: 'error',
          errorMessage: err.message || 'Lỗi không xác định khi dubbing',
          stageDescription: 'Thất bại khi dubbing',
        });
        onUpdate?.();
        return updated;
      } finally {
        this.runningCommands.delete(taskId);
        this.runningTasks.delete(taskId);
        this.cancelledTasks.delete(taskId);
      }
    });
  }
}
