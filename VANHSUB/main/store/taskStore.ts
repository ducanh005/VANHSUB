import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';

export type TaskStatus =
  | 'queued'
  | 'transcribing'
  | 'translating'
  | 'exporting'
  | 'dubbing'
  | 'done'
  | 'error';
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
  ttsAudioDir?: string;
  /** Gán giọng riêng theo dòng phụ đề: key = số dòng SRT (chuỗi), value = tên giọng */
  ttsVoiceOverrides?: Record<string, string>;
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
    _store = new Store<StoreSchema>({
      name: 'vanhsub-tasks',
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
};

