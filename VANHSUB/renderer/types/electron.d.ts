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
  | 'ocrMode'
  | 'ocrCustomRegion'
  | 'ocrDualEngine'
  | 'glossary'
  | 'translationStyleGuide'
  | 'onboardingCompleted';

export type OcrMode = 'auto' | 'bottom' | 'full' | 'custom';

export interface OcrCustomRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrStartOptions {
  mode?: OcrMode;
  customRegion?: OcrCustomRegion | null;
  language?: string;
  fps?: number;
  dualEngine?: boolean;
}

/** Giọng đọc clone từ file audio mẫu (đồng bộ với VoiceSample trong main/store) */
export interface VoiceSampleInfo {
  name: string;
  fileName: string;
  originalName: string;
  createdAt: string;
}

/**
 * Style phụ đề hardsub (đồng bộ với SubtitleStyle ở main/render/videoRenderer)
 */
export interface SubStyle {
  fontName: string;
  fontSize: number;
  primaryColour: string;
  outlineColour: string;
  opacity: number;
  outline: number;
  shadow: number;
  bold: boolean;
  borderStyle: 1 | 3;
  alignment: 2 | 5 | 8;
  marginV: number;
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
    translateLine: (payload: { text: string; targetLanguage?: string; prev?: string; next?: string }) => Promise<string>;
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
      voiceOverrides?: Record<string, string>,
      engine?: 'viettts' | 'tiktok'
    ) => Promise<boolean>;
    cancel: (id: string) => Promise<boolean>;
    regenerateLine: (id: string, lineIndex: number) => Promise<{ ok: boolean; error?: string }>;
    voices: () => Promise<string[]>;
    checkConnection: () => Promise<boolean>;
    preview: (
      text: string,
      voice?: string,
      speed?: number,
      engine?: 'viettts' | 'tiktok'
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
      options?: { syncMode?: 'strict' | 'flexible' | 'video-stretch'; mixOriginalAudio?: boolean; vocalSeparation?: boolean }
    ) => Promise<boolean>;
  };
  tiktokTts: {
    status: () => Promise<{ hasSession: boolean }>;
    saveSession: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
    removeSession: () => Promise<{ ok: boolean; error?: string }>;
    validate: () => Promise<{ valid: boolean; detail: string }>;
    voices: () => Promise<
      { ok: true; voices: Array<{ id: string; label: string; language: string; gender?: string }> }
      | { ok: false; error: string }
    >;
    synthesize: (text: string, voice: string) => Promise<{ ok: true; filePath: string } | { ok: false; error: string }>;
  };
  export: {
    start: (
      id: string,
      mode: 'hardsub' | 'softsub',
      mask?: SubMaskRegion | null,
      style?: SubStyle | null
    ) => Promise<boolean>;
    separateStems: (id: string) => Promise<boolean>;
  };
  ocr: {
    start: (id: string, options?: OcrStartOptions) => Promise<boolean>;
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
