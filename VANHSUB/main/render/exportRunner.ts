import fs from 'fs';
import path from 'path';
import os from 'os';
import type ffmpeg from 'fluent-ffmpeg';
import { parseSrt } from '../lib/srt';
import { TaskStore, type Task } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';
import { nextAvailablePath } from '../lib/paths';
import { getOrCreateProjectDir } from '../utils/projectFolder';
import { compileToAss, type SubtitleEntryStyle, type GlobalAssStyle } from './assCompiler';
import { killProcessTreeByPid } from '../lib/processTree';
import { isCancelledError } from '../lib/cancel';
import {
  burnHardsub,
  muxSoftsub,
  type MaskRegion,
  type CustomMaskRegion,
  type WatermarkOptions,
  type ExportFormatOptions,
  type SubtitleStyle,
} from './videoRenderer';

export interface DualSubtitleOption {
  enabled: boolean;
  layoutPreset?: 'douyin_music_left' | 'top_bottom_bilingual' | 'custom';
  secondaryStyle?: Partial<GlobalAssStyle>;
}

export interface AdvancedExportOptions {
  customMask?: CustomMaskRegion | null;
  customMasks?: CustomMaskRegion[] | null;
  watermark?: WatermarkOptions | null;
  formatOptions?: ExportFormatOptions | null;
  perLineStyles?: Record<number, SubtitleEntryStyle>;
  dualSubtitles?: DualSubtitleOption | null;
}

export class ExportRunner {
  private static MAX_PARALLEL_EXPORT = 1;
  private static runningExports = new Set<string>();
  private static runningCommands = new Map<string, ffmpeg.FfmpegCommand>();
  private static cancelledTasks = new Set<string>();
  private static queue: Array<{
    taskId: string;
    mode: 'hardsub' | 'softsub';
    mask?: MaskRegion | null;
    onUpdate?: () => void;
    style?: SubtitleStyle | null;
    advancedOptions?: AdvancedExportOptions | null;
    resolve: (t: Task | undefined) => void;
    reject: (err: any) => void;
  }> = [];

  static isRunning(taskId: string): boolean {
    return this.runningExports.has(taskId);
  }

  static isQueued(taskId: string): boolean {
    return this.queue.some((item) => item.taskId === taskId);
  }

  /**
   * Huỷ tác vụ xuất video (ngay trong hàng đợi hoặc dừng tiến trình FFmpeg đang chạy).
   */
  static cancel(taskId: string): boolean {
    // 1. Kiểm tra trong hàng đợi
    const qIndex = this.queue.findIndex((item) => item.taskId === taskId);
    if (qIndex !== -1) {
      const [queuedItem] = this.queue.splice(qIndex, 1);
      TaskStore.update(taskId, {
        status: 'cancelled',
        stageDescription: 'Đã huỷ khỏi hàng đợi xuất video',
      });
      queuedItem.onUpdate?.();
      queuedItem.resolve(TaskStore.getById(taskId));
      this.drainQueue();
      return true;
    }

    // 2. Đang thực thi
    if (!this.runningExports.has(taskId)) {
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
        console.warn(`[ExportRunner] Lỗi khi taskkill FFmpeg cho task ${taskId}:`, err);
      }

      try {
        (cmd as any).kill?.('SIGKILL');
      } catch (err) {
        console.warn(`[ExportRunner] Lỗi khi kill command cho task ${taskId}:`, err);
      }
      this.runningCommands.delete(taskId);
    }
    return true;
  }

  private static drainQueue() {
    if (this.runningExports.size >= this.MAX_PARALLEL_EXPORT) return;
    const nextItem = this.queue.shift();
    if (!nextItem) return;

    this.executeExport(
      nextItem.taskId,
      nextItem.mode,
      nextItem.mask,
      nextItem.onUpdate,
      nextItem.style,
      nextItem.advancedOptions,
    )
      .then(nextItem.resolve)
      .catch(nextItem.reject);
  }

  static async runExport(
    taskId: string,
    mode: 'hardsub' | 'softsub',
    mask?: MaskRegion | null,
    onUpdate?: () => void,
    style?: SubtitleStyle | null,
    advancedOptions?: AdvancedExportOptions | null
  ): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    const rawSrtPath = task.translatedSrtPath || task.srtPath;
    if (!rawSrtPath) {
      throw new Error('Tác vụ chưa có file phụ đề để xuất video.');
    }

    if (this.runningExports.has(taskId)) {
      return task;
    }

    if (this.isQueued(taskId)) {
      return task;
    }

    if (this.runningExports.size >= this.MAX_PARALLEL_EXPORT) {
      return new Promise<Task | undefined>((resolve, reject) => {
        this.queue.push({
          taskId,
          mode,
          mask,
          onUpdate,
          style,
          advancedOptions,
          resolve,
          reject,
        });
        TaskStore.update(taskId, {
          status: 'exporting',
          stageDescription: 'Đang xếp hàng chờ tài nguyên xuất video...',
        });
        onUpdate?.();
      });
    }

    return this.executeExport(taskId, mode, mask, onUpdate, style, advancedOptions);
  }

  private static async executeExport(
    taskId: string,
    mode: 'hardsub' | 'softsub',
    mask?: MaskRegion | null,
    onUpdate?: () => void,
    style?: SubtitleStyle | null,
    advancedOptions?: AdvancedExportOptions | null
  ): Promise<Task | undefined> {
    const task = TaskStore.getById(taskId);
    if (!task) throw new Error(`Không tìm thấy tác vụ ID: ${taskId}`);

    const rawSrtPath = task.translatedSrtPath || task.srtPath;
    if (!rawSrtPath) {
      throw new Error('Tác vụ chưa có file phụ đề để xuất video.');
    }

    this.runningExports.add(taskId);
    this.cancelledTasks.delete(taskId);

    // Xác định đường dẫn xuất
    const videoPath = task.filePath;
    const videoDir = path.dirname(videoPath);
    const videoExt = path.extname(videoPath);
    const videoBase = path.basename(videoPath, videoExt);

    const exportDirSetting = SettingsStore.get('exportDir');
    // Lưu vào thư mục dự án riêng của video
    const projectDir = getOrCreateProjectDir(task);
    const targetDir = projectDir;

    const suffix = mode === 'hardsub' ? 'hardsub' : 'softsub';
    const outputName = `${videoBase}.${suffix}.mp4`;
    // Không ghi đè bản xuất trước đó — thêm _1, _2… nếu file đã tồn tại
    const outputPath = nextAvailablePath(path.join(targetDir, outputName));

    let finalSubPath = rawSrtPath;
    let tempAssFile: string | null = null;

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
        status: 'exporting',
        progress: 0,
        stageDescription: `Đang khởi tạo xuất video (${mode === 'hardsub' ? 'Hardsub' : 'Softsub'})...`,
      });
      onUpdate?.();

      if (mode === 'hardsub') {
        const hasPerLine = advancedOptions?.perLineStyles && Object.keys(advancedOptions.perLineStyles).length > 0;
        const hasDual = !!(advancedOptions?.dualSubtitles?.enabled && task.translatedSrtPath && task.srtPath);
        const hasVertical = !!style?.isVertical;
        const hasCustomPos = !!(style?.posPercent || (style?.marginH !== undefined && style.marginH !== 20));
        const needsAssCompilation = hasPerLine || hasDual || hasVertical || hasCustomPos;

        // Nếu có perLineStyles, song ngữ hoặc style vị trí/chữ dọc: biên dịch ra file .ass trước khi burn
        if (needsAssCompilation) {
          const srtContent = fs.readFileSync(rawSrtPath, 'utf-8');
          const parsedLines = parseSrt(srtContent);
          const items = parsedLines.map((line, idx) => ({
            startMs: line.startMs,
            endMs: line.endMs,
            text: line.text,
            style: advancedOptions?.perLineStyles?.[idx] || null,
          }));

          const globalAss: Partial<GlobalAssStyle> = style
            ? {
                fontName: style.fontName,
                fontSize: style.fontSize,
                primaryColour: style.primaryColour,
                outlineColour: style.outlineColour,
                opacity: style.opacity,
                outline: style.outline,
                shadow: style.shadow,
                bold: style.bold,
                borderStyle: style.borderStyle,
                alignment: style.alignment as any,
                marginV: style.marginV,
                marginH: style.marginH,
                isVertical: style.isVertical,
                posPercent: style.posPercent,
              }
            : {};

          let secondaryItems: any[] | undefined = undefined;
          let secondaryStyle: Partial<GlobalAssStyle> | undefined = undefined;

          if (hasDual) {
            // Xác định file phụ: nếu file chính là translated thì file phụ là original (lời nhạc/gốc)
            const secSrtPath = rawSrtPath === task.translatedSrtPath ? task.srtPath! : task.translatedSrtPath!;
            if (fs.existsSync(secSrtPath)) {
              const secContent = fs.readFileSync(secSrtPath, 'utf-8');
              const secParsed = parseSrt(secContent);
              secondaryItems = secParsed.map((line) => ({
                startMs: line.startMs,
                endMs: line.endMs,
                text: line.text,
              }));

              const preset = advancedOptions?.dualSubtitles?.layoutPreset || 'douyin_music_left';
              if (preset === 'douyin_music_left') {
                secondaryStyle = {
                  fontName: style?.fontName || 'Arial',
                  fontSize: Math.max(14, Math.round((style?.fontSize || 22) * 0.85)),
                  primaryColour: '#FFE135',
                  outlineColour: '#000000',
                  alignment: 4, // Giữa mép trái
                  marginH: 35,
                  marginV: 25,
                  isVertical: true, // Xếp dọc
                  bold: true,
                  borderStyle: 1,
                  outline: 2,
                  shadow: 1,
                  ...advancedOptions?.dualSubtitles?.secondaryStyle,
                };
              } else if (preset === 'top_bottom_bilingual') {
                secondaryStyle = {
                  fontName: style?.fontName || 'Arial',
                  fontSize: Math.max(14, Math.round((style?.fontSize || 22) * 0.85)),
                  primaryColour: '#E0E0E0',
                  outlineColour: '#000000',
                  alignment: 8, // Đỉnh giữa
                  marginV: 30,
                  marginH: 20,
                  isVertical: false,
                  bold: false,
                  borderStyle: 1,
                  outline: 2,
                  shadow: 1,
                  ...advancedOptions?.dualSubtitles?.secondaryStyle,
                };
              } else {
                secondaryStyle = advancedOptions?.dualSubtitles?.secondaryStyle;
              }
            }
          }

          const assContent = compileToAss(items, {
            globalStyle: globalAss,
            title: videoBase,
            secondaryItems,
            secondaryStyle,
          });

          tempAssFile = path.join(os.tmpdir(), `vanhsub_ass_${Date.now()}_compiled.ass`);
          fs.writeFileSync(tempAssFile, assContent, 'utf-8');
          finalSubPath = tempAssFile;
        }

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

        await burnHardsub({
          videoPath,
          srtPath: finalSubPath,
          outputPath,
          mask: mask || null,
          customMask: advancedOptions?.customMask || null,
          customMasks: advancedOptions?.customMasks || null,
          watermark: advancedOptions?.watermark || null,
          formatOptions: advancedOptions?.formatOptions || null,
          style: style || null,
          onCommandCreated: (command) => {
            this.runningCommands.set(taskId, command);
          },
          onProgress: (percent) => {
            if (this.cancelledTasks.has(taskId) || TaskStore.getById(taskId)?.status === 'cancelled') {
              return;
            }
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

        await muxSoftsub({
          videoPath,
          srtPath: rawSrtPath,
          outputPath,
          onCommandCreated: (command) => {
            this.runningCommands.set(taskId, command);
          },
        });

        if (this.cancelledTasks.has(taskId) || TaskStore.getById(taskId)?.status === 'cancelled') {
          if (outputPath && fs.existsSync(outputPath)) {
            try {
              fs.unlinkSync(outputPath);
            } catch (e) {
              console.warn(`[ExportRunner] Không thể xoá file output dở dang: ${outputPath}`, e);
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

        TaskStore.update(taskId, {
          progress: 100,
          stageDescription: 'Ghép phụ đề mềm thành công!',
        });
        onUpdate?.();
      }

      // F-EXP-02 Guard: Ngăn chặn lỗi hồi sinh tác vụ khi task đã bị huỷ
      const currentTask = TaskStore.getById(taskId);
      if (this.cancelledTasks.has(taskId) || currentTask?.status === 'cancelled') {
        console.log(`[ExportRunner] Tác vụ ${taskId} đã bị huỷ trước đó. Bỏ qua cập nhật 'done' và dọn dẹp file dở dang.`);
        if (outputPath && fs.existsSync(outputPath)) {
          try {
            fs.unlinkSync(outputPath);
          } catch (e) {
            console.warn(`[ExportRunner] Không thể xoá file output dở dang: ${outputPath}`, e);
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

      const updated = TaskStore.update(taskId, {
        status: 'done',
        progress: 100,
        outputPath,
        projectDir,
        stageDescription: `Xuất video thành công: ${outputName}`,
      });
      onUpdate?.();

      return updated;
    } catch (err: any) {
      const currentTask = TaskStore.getById(taskId);
      const wasCancelled = this.cancelledTasks.has(taskId) || currentTask?.status === 'cancelled' || isCancelledError(err);

      // Dọn dẹp file output dang dở trên đĩa
      if (outputPath && fs.existsSync(outputPath)) {
        try {
          fs.unlinkSync(outputPath);
        } catch (e) {
          console.warn(`[ExportRunner] Không thể xoá file output dở dang: ${outputPath}`, e);
        }
      }

      if (wasCancelled) {
        console.log(`[ExportRunner] Tác vụ ${taskId} đã bị huỷ bởi người dùng.`);
        const updated = TaskStore.update(taskId, {
          status: 'cancelled',
          stageDescription: 'Đã huỷ xuất video',
        });
        onUpdate?.();
        return updated;
      }

      console.error(`Lỗi khi xuất video cho task ${taskId}:`, err);
      const updated = TaskStore.update(taskId, {
        status: 'error',
        errorMessage: err.message || 'Lỗi không xác định khi xuất video',
        stageDescription: 'Thất bại khi xuất video',
      });
      onUpdate?.();
      return updated;
    } finally {
      if (tempAssFile && fs.existsSync(tempAssFile)) {
        try {
          fs.unlinkSync(tempAssFile);
        } catch {}
      }
      this.runningCommands.delete(taskId);
      this.runningExports.delete(taskId);
      this.cancelledTasks.delete(taskId);
      this.drainQueue();
    }
  }
}
