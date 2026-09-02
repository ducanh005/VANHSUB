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
  | 'ttsSpeed';

export interface VanhsubAPI {
  tasks: {
    getAll: () => Promise<Task[]>;
    get: (id: string) => Promise<Task | undefined>;
    create: (input: CreateTaskInput) => Promise<Task>;
    update: (id: string, updates: Partial<Task>) => Promise<Task | undefined>;
    delete: (id: string) => Promise<boolean>;
    start: (id: string) => Promise<boolean>;
    readSrt: (srtPath: string) => Promise<string>;
    writeSrt: (srtPath: string, content: string) => Promise<boolean>;

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
  };
  tts: {
    start: (id: string, voice?: string, speed?: number) => Promise<boolean>;
    voices: () => Promise<string[]>;
    checkConnection: () => Promise<boolean>;
    preview: (
      text: string,
      voice?: string,
      speed?: number
    ) => Promise<{ audioBase64: string; mimeType: string }>;
  };
  dubbing: {
    start: (id: string, replaceAudio?: boolean) => Promise<boolean>;
  };
  export: {
    start: (id: string, mode: 'hardsub' | 'softsub') => Promise<boolean>;
  };
  models: {
    list: () => Promise<Array<{ name: string; fileName: string; size: string }>>;
    delete: (modelName: string) => Promise<boolean>;
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
    showInFolder: (filePath: string) => Promise<void>;
    chooseDirectory: () => Promise<string | null>;
  };
  files: {
    getPath: (file: File) => string;
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
