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
  /** Engine phiên âm: 'faster-whisper' (mặc định) hoặc 'whisper-cpp' */
  asrEngine?: 'faster-whisper' | 'whisper-cpp';
  /** Bật phân tách người nói (Speaker Diarization) */
  enableDiarization?: boolean;
  /** Số lượng người nói dự kiến (tuỳ chọn) */
  speakerCount?: number;
  /** Danh sách nhãn người nói tìm được (SPEAKER_00, SPEAKER_01...) */
  speakers?: string[];
  srtPath?: string;
  srtStale?: boolean;
  translatedSrtPath?: string;
  audioPath?: string;
  outputPath?: string;
  dubbedPath?: string;
  dubbedStretchFactor?: number;
  hardsubPath?: string;
  softsubPath?: string;
  translationStale?: boolean;
  translationSourceHash?: string;
  translationConfigHash?: string;
  ttsStale?: boolean;
  dubbedStale?: boolean;
  ttsSourceHash?: string;
  /** Thư mục dự án gom toàn bộ file liên quan đến video này (sub, audio, export) */
  projectDir?: string;
  errorMessage?: string;
  // TTS / Dubbing fields
  ttsVoice?: string;
  ttsSpeed?: number;
  /** Engine tạo audio: 'viettts' (server local), 'tiktok' (TikTok TTS), hoặc 'edge' (Edge TTS miễn phí) */
  ttsEngine?: 'viettts' | 'tiktok' | 'edge';
  ttsAudioDir?: string;
  /** File audio MP3 lồng tiếng tổng hợp chuẩn xác theo timeline dự án */
  ttsMergedAudioPath?: string;
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

let cachedTasks: Task[] | undefined;
let taskIndex = new Map<string, Task>();
let flushTimer: NodeJS.Timeout | undefined;
function readTasks(): Task[] {
  if (!cachedTasks) {
    cachedTasks = getStore().get('tasks', []);
    taskIndex = new Map(cachedTasks.map((task) => [task.id, task]));
  }
  return cachedTasks;
}
export function flushTaskStore(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  if (cachedTasks) getStore().set('tasks', cachedTasks);
}
function persistTasks(progressOnly = false): void {
  if (!progressOnly) { flushTaskStore(); return; }
  if (!flushTimer) {
    flushTimer = setTimeout(flushTaskStore, 250);
    flushTimer.unref();
  }
}
process.once('exit', () => { if (flushTimer) flushTaskStore(); });

export const TaskStore = {
  getAll(): Task[] {
    return structuredClone(readTasks());
  },

  getById(id: string): Task | undefined {
    readTasks();
    const task = taskIndex.get(id);
    return task ? structuredClone(task) : undefined;
  },

  create(input: CreateTaskInput): Task {
    const tasks = readTasks();
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
      asrEngine: input.asrEngine,
      enableDiarization: input.enableDiarization,
      speakerCount: input.speakerCount,
      speakers: input.speakers,
      srtPath: input.srtPath,
      srtStale: input.srtStale,
      translatedSrtPath: input.translatedSrtPath,
      audioPath: input.audioPath,
      outputPath: input.outputPath,
      dubbedPath: input.dubbedPath,
      dubbedStretchFactor: input.dubbedStretchFactor,
      hardsubPath: input.hardsubPath,
      softsubPath: input.softsubPath,
      translationStale: input.translationStale,
      translationSourceHash: input.translationSourceHash,
      translationConfigHash: input.translationConfigHash,
      ttsStale: input.ttsStale,
      dubbedStale: input.dubbedStale,
      ttsSourceHash: input.ttsSourceHash,
      projectDir: input.projectDir,
      errorMessage: input.errorMessage,
      ttsVoice: input.ttsVoice,
      ttsSpeed: input.ttsSpeed,
      ttsEngine: input.ttsEngine,
      ttsAudioDir: input.ttsAudioDir,
      ttsMergedAudioPath: input.ttsMergedAudioPath,
      ttsVoiceOverrides: input.ttsVoiceOverrides,
      createdAt: now,
      updatedAt: now,
    };

    tasks.unshift(newTask);
    taskIndex.set(newTask.id, newTask);
    persistTasks();
    return structuredClone(newTask);
  },

  update(id: string, updates: Partial<Task>): Task | undefined {
    readTasks();
    const task = taskIndex.get(id);
    if (!task) return undefined;
    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    persistTasks(Object.keys(updates).every((key) => key === 'progress' || key === 'stageDescription'));
    return structuredClone(task);
  },

  delete(id: string): boolean {
    const tasks = readTasks();
    const filtered = tasks.filter((t) => t.id !== id);
    if (filtered.length === tasks.length) return false;
    cachedTasks = filtered;
    taskIndex.delete(id);
    persistTasks();
    return true;
  },

  clear(): void {
    cachedTasks = [];
    taskIndex.clear();
    persistTasks();
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
    const tasks = readTasks();
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
    if (fixedIds.size > 0) {
      cachedTasks = fixed;
      taskIndex = new Map(fixed.map((task) => [task.id, task]));
      persistTasks();
    }
    return fixed.filter((t) => fixedIds.has(t.id));
  },
};
