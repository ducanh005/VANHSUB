import type { Task, CreateTaskInput } from './task';

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
    get: (key: 'geminiApiKey' | 'geminiModel' | 'targetLanguage') => Promise<any>;
    set: (key: 'geminiApiKey' | 'geminiModel' | 'targetLanguage', value: unknown) => Promise<boolean>;
  };
  ai: {
    polishLine: (payload: { text: string; prev?: string; next?: string }) => Promise<string>;
  };
  dialog: {
    openMediaFile: () => Promise<string[] | null>;
    showInFolder: (filePath: string) => Promise<void>;
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
