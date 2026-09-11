import os from 'os';
import path from 'path';
import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';

export type TaskStatus =
  | 'queued'
  | 'transcribing'
  | 'ocr'
  | 'translating'
  | 'exporting'
  | 'dubbing'
  | 'done'
  | 'error'
  | 'cancelled';
export type WorkflowType = 'full-dubbing' | 'bilingual-sub' | 'fast-transcribe' | 'custom';

export interface Task {
  id: string;
  fileName: string;
  filePath: string;
  fileSize?: string;
  duration?: string;
  workflow: WorkflowType;
  status: TaskStatus;
  progress: number;
  stageDescription?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  asrModel?: string;
  srtPath?: string;
  translatedSrtPath?: string;
  audioPath?: string;
  outputPath?: string;
  errorMessage?: string;
  // TTS / Dubbing fields
  ttsVoice?: string;
  ttsSpeed?: number;
  /** Engine tạo audio: 'viettts' (server local) hoặc 'tiktok' (TikTok TTS — cần session) */
  ttsEngine?: 'viettts' | 'tiktok';
  ttsAudioDir?: string;
  /** Gán giọng riêng theo dòng phụ đề: key = số dòng SRT (chuỗi), value = tên giọng */
  ttsVoiceOverrides?: Record<string, string>;
  /** Các câu TTS tràn thời lượng khung của nó (cập nhật sau mỗi lần dubbing) */
  ttsOverruns?: { index: number; tempo: number; truncated: boolean }[];
  /** Thống kê OCR (frames, detections, duplicates merged, confidence scoring) */
  ocrStats?: {
    framesScanned: number;
    detections: number;
    trackedGroups: number;
    duplicatesRemoved: number;
    finalEvents: number;
    highConfidence: number;
    needsReview: number;
    aiCorrected?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export type CreateTaskInput = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>> & {
  fileName: string;
  filePath: string;
};

interface StoreSchema {
  tasks: Task[];
}

// Lazy singleton — chỉ tạo instance khi lần đầu được gọi,
// tránh lỗi "Please specify the projectName option" khi app chưa ready.
let _store: Store<StoreSchema> | null = null;

function getStore(): Store<StoreSchema> {
  if (!_store) {
    let cwd: string | undefined = process.env.VANHSUB_TASKS_DIR;
    if (!cwd) {
      try {
        const electron = require('electron');
        const electronApp = electron.app;
        if (!electronApp?.name && !electronApp?.getPath) {
          cwd = path.join(os.tmpdir(), 'vanhsub-tasks');
        }
      } catch {
        cwd = path.join(os.tmpdir(), 'vanhsub-tasks');
      }
    }

    _store = new Store<StoreSchema>({
      name: 'vanhsub-tasks',
      ...(cwd ? { cwd } : {}),
      defaults: {
        tasks: [],
      },
    });
  }
  return _store;
}

export const TaskStore = {
  getAll(): Task[] {
    return getStore().get('tasks', []);
  },

  getById(id: string): Task | undefined {
    const tasks = getStore().get('tasks', []);
    return tasks.find((t) => t.id === id);
  },

  create(input: CreateTaskInput): Task {
    const tasks = getStore().get('tasks', []);
    const now = new Date().toISOString();
    const newTask: Task = {
      id: uuidv4(),
      fileName: input.fileName,
      filePath: input.filePath,
      fileSize: input.fileSize || '0 MB',
      duration: input.duration || '00:00',
      workflow: input.workflow || 'fast-transcribe',
      status: input.status || 'queued',
      progress: input.progress ?? 0,
      stageDescription: input.stageDescription || 'Đang chờ xử lý',
      sourceLanguage: input.sourceLanguage || 'vi',
      targetLanguage: input.targetLanguage,
      asrModel: input.asrModel || 'base',
      srtPath: input.srtPath,
      translatedSrtPath: input.translatedSrtPath,
      audioPath: input.audioPath,
      outputPath: input.outputPath,
      errorMessage: input.errorMessage,
      ttsVoice: input.ttsVoice,
      ttsSpeed: input.ttsSpeed,
      ttsEngine: input.ttsEngine,
      ttsAudioDir: input.ttsAudioDir,
      ttsVoiceOverrides: input.ttsVoiceOverrides,
      createdAt: now,
      updatedAt: now,
    };

    tasks.unshift(newTask);
    getStore().set('tasks', tasks);
    return newTask;
  },

  update(id: string, updates: Partial<Task>): Task | undefined {
    const tasks = getStore().get('tasks', []);
    const index = tasks.findIndex((t) => t.id === id);
    if (index === -1) return undefined;

    const updatedTask: Task = {
      ...tasks[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    tasks[index] = updatedTask;
    getStore().set('tasks', tasks);
    return updatedTask;
  },

  delete(id: string): boolean {
    const tasks = getStore().get('tasks', []);
    const filtered = tasks.filter((t) => t.id !== id);
    if (filtered.length === tasks.length) return false;
    getStore().set('tasks', filtered);
    return true;
  },

  clear(): void {
    getStore().set('tasks', []);
  },

  /**
   * Gỡ kẹt các task còn dính trạng thái "đang chạy" của phiên trước
   * (app bị crash/đóng giữa chừng — runner không còn tồn tại nên không bao giờ
   * tự kết thúc). Đánh dấu error để người dùng chạy lại được; pipeline vẫn
   * bỏ qua các bước đã có kết quả (srtPath/translatedSrtPath/ttsAudioDir).
   * Trả về danh sách task đã được sửa.
   */
  resetStaleRunning(): Task[] {
    const RUNNING_STATUSES: TaskStatus[] = ['transcribing', 'ocr', 'translating', 'exporting', 'dubbing'];
    const tasks = getStore().get('tasks', []);
    const now = new Date().toISOString();
    const fixedIds = new Set<string>();
    const fixed = tasks.map((t) => {
      if (!RUNNING_STATUSES.includes(t.status)) return t;
      fixedIds.add(t.id);
      return {
        ...t,
        status: 'error' as TaskStatus,
        errorMessage:
          'Job bị gián đoạn do app đóng giữa chừng — bấm "Chạy cả quy trình" để tiếp tục (các bước đã xong sẽ được giữ).',
        stageDescription: 'Bị gián đoạn ở phiên trước',
        updatedAt: now,
      };
    });
    if (fixedIds.size > 0) getStore().set('tasks', fixed);
    return fixed.filter((t) => fixedIds.has(t.id));
  },
};
