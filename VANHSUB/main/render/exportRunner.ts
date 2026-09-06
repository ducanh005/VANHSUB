import fs from 'fs';
import path from 'path';
import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { nextAvailablePath } from '../lib/paths';
import { burnHardsub, muxSoftsub, type MaskRegion } from './videoRenderer';

export class ExportRunner {
  private static runningExports = new Set<string>();

  static isRunning(taskId: string): boolean {
    return this.runningExports.has(taskId);
  }

  static async runExport(
    taskId: string,
    mode: 'hardsub' | 'softsub',
    mask?: MaskRegion | null,
    onUpdate?: () => void
  ): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    const srtPath = task.translatedSrtPath || task.srtPath;
    if (!srtPath) {
      throw new Error('Tác vụ chưa có file phụ đề để xuất video.');
    }

    if (this.runningExports.has(taskId)) {
      return task;
    }

    this.runningExports.add(taskId);

    // Xác định đường dẫn xuất
    const videoPath = task.filePath;
    const videoDir = path.dirname(videoPath);
    const videoExt = path.extname(videoPath);
    const videoBase = path.basename(videoPath, videoExt);

    const exportDirSetting = SettingsStore.get('exportDir');
    const targetDir = (exportDirSetting && fs.existsSync(exportDirSetting)) ? exportDirSetting : videoDir;

    const suffix = mode === 'hardsub' ? 'hardsub' : 'softsub';
    const outputName = `${videoBase}.${suffix}.mp4`;
    // Không ghi đè bản xuất trước đó — thêm _1, _2… nếu file đã tồn tại
    const outputPath = nextAvailablePath(path.join(targetDir, outputName));

    try {
      TaskStore.update(taskId, {
        status: 'exporting',
        progress: 0,
        stageDescription: `Đang khởi tạo xuất video (${mode === 'hardsub' ? 'Hardsub' : 'Softsub'})...`,
      });
      onUpdate?.();

      if (mode === 'hardsub') {
        await burnHardsub({
          videoPath,
          srtPath,
          outputPath,
          mask: mask || null,
          onProgress: (percent) => {
            TaskStore.update(taskId, {
              progress: percent,
              stageDescription: `Đang xuất video Hardsub (${percent}%)...`,
            });
            onUpdate?.();
          },
        });
      } else {
        // Softsub muxing rất nhanh (thường dưới vài giây vì chỉ copy stream), nên giả lập progress
        TaskStore.update(taskId, {
          progress: 20,
          stageDescription: 'Đang ghép phụ đề mềm (Softsub)...',
        });
        onUpdate?.();

        await muxSoftsub({
          videoPath,
          srtPath,
          outputPath,
        });

        TaskStore.update(taskId, {
          progress: 100,
          stageDescription: 'Ghép phụ đề mềm thành công!',
        });
        onUpdate?.();
      }

      const updated = TaskStore.update(taskId, {
        status: 'done',
        progress: 100,
        outputPath,
        stageDescription: `Xuất video thành công: ${outputName}`,
      });
      onUpdate?.();

      return updated;
    } catch (err: any) {
      console.error(`Lỗi khi xuất video cho task ${taskId}:`, err);
      const updated = TaskStore.update(taskId, {
        status: 'error',
        errorMessage: err.message || 'Lỗi không xác định khi xuất video',
        stageDescription: 'Thất bại khi xuất video',
      });
      onUpdate?.();
      return updated;
    } finally {
      this.runningExports.delete(taskId);
    }
  }
}
