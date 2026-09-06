import type { Task, CreateTaskInput } from './task';

export type SettingKey =
  | 'geminiApiKey'
  | 'geminiModel'
  | 'targetLanguage'
  | 'asrModel'
  | 'exportDir'
  | 'translateBatchSize'
  | 'translateConcurrency'
  | 'autoTranslateAfterAsr'
  | 'vietTtsEndpoint'
  | 'ttsVoice'
  | 'ttsSpeed'
  | 'ocrLanguage'
  | 'ocrFps'
  | 'ocrRegion'
  | 'glossary'
  | 'translationStyleGuide'
  | 'onboardingCompleted';

/** Giọng đọc clone từ file audio mẫu (đồng bộ với VoiceSample trong main/store) */
export interface VoiceSampleInfo {
  name: string;
  fileName: string;
  originalName: string;
  createdAt: string;
}

export interface SubMaskRegion {
  /** Vị trí dải che — phụ đề phim thường nằm ở đáy khung hình */
  position: 'bottom' | 'top';
  /** Chiều cao dải che theo % chiều cao khung hình (5-50) */
  heightPercent: number;
  /** solid = tô đen, blur = làm mờ vùng đó */
  mode: 'solid' | 'blur';
}

export interface VanhsubAPI {
  tasks: {
    getAll: () => Promise<Task[]>;
    get: (id: string) => Promise<Task | undefined>;
    create: (input: CreateTaskInput) => Promise<Task>;
    update: (id: string, updates: Partial<Task>) => Promise<Task | undefined>;
    delete: (id: string) => Promise<boolean>;
    start: (id: string) => Promise<boolean>;
    cancel: (id: string) => Promise<boolean>;
    readSrt: (srtPath: string) => Promise<string>;
    writeSrt: (srtPath: string, content: string) => Promise<boolean>;
    importSrt: (id: string, sourceSrtPath: string) => Promise<Task | undefined>;
    addFromUrl: (
      url: string
    ) => Promise<{ task?: Task; error?: string }>;
    runPipeline: (id: string, opts?: { replaceAudio?: boolean }) => Promise<boolean>;
    runPipelineBatch: (ids: string[]) => Promise<number>;

    onUpdate: (callback: (tasks: Task[]) => void) => () => void;
  };
  settings: {
    get: (key: SettingKey) => Promise<any>;
    set: (key: SettingKey, value: unknown) => Promise<boolean>;
  };
  ai: {
    polishLine: (payload: { text: string; prev?: string; next?: string }) => Promise<string>;
  };
  translate: {
    start: (id: string, targetLanguage?: string) => Promise<boolean>;
    cancel: (id: string) => Promise<boolean>;
  };
  tts: {
    start: (
      id: string,
      voice?: string,
      speed?: number,
      voiceOverrides?: Record<string, string>
    ) => Promise<boolean>;
    cancel: (id: string) => Promise<boolean>;
    regenerateLine: (id: string, lineIndex: number) => Promise<{ ok: boolean; error?: string }>;
    voices: () => Promise<string[]>;
    checkConnection: () => Promise<boolean>;
    preview: (
      text: string,
      voice?: string,
      speed?: number
    ) => Promise<{ audioBase64: string; mimeType: string }>;
    voiceSamples: () => Promise<VoiceSampleInfo[]>;
    addVoiceSample: (
      name: string
    ) => Promise<{ canceled?: boolean; sample?: VoiceSampleInfo; samples?: VoiceSampleInfo[]; error?: string }>;
    addVoiceSampleFromUrl: (
      name: string,
      url: string
    ) => Promise<{ sample?: VoiceSampleInfo; samples?: VoiceSampleInfo[]; error?: string }>;
    removeVoiceSample: (name: string) => Promise<VoiceSampleInfo[]>;
  };
  dubbing: {
    start: (
      id: string,
      replaceAudio?: boolean,
      options?: { syncMode?: 'strict' | 'flexible' | 'video-stretch'; mixOriginalAudio?: boolean }
    ) => Promise<boolean>;
  };
  export: {
    start: (id: string, mode: 'hardsub' | 'softsub', mask?: SubMaskRegion | null) => Promise<boolean>;
  };
  ocr: {
    start: (id: string) => Promise<boolean>;
    cancel: (id: string) => Promise<boolean>;
  };
  models: {
    list: () => Promise<Array<{ name: string; fileName: string; size: string; filePath: string }>>;
    delete: (modelName: string) => Promise<boolean>;
    /** Thư mục lưu model Whisper trên đĩa (để hiển thị vị trí ở Cài đặt) */
    directory: () => Promise<{ path: string; exists: boolean }>;
    getSystemInfo: () => Promise<{
      totalMemory: number;
      freeMemory: number;
      cpuCores: number;
      cpuModel: string;
      platform: string;
    }>;
  };
  dialog: {
    openMediaFile: () => Promise<string[] | null>;
    openSrtFile: () => Promise<string | null>;
    showInFolder: (filePath: string) => Promise<void>;
    chooseDirectory: () => Promise<string | null>;
  };
  files: {
    getPath: (file: File) => string;
  };
  logs: {
    onLog: (callback: (entry: { level: string; text: string; ts: number }) => void) => () => void;
  };
}

declare global {
  interface Window {
    vanhsub: VanhsubAPI;
    ipc: {
      send: (channel: string, value: any) => void;
      on: (channel: string, callback: (...args: any[]) => void) => () => void;
    };
  }
}
