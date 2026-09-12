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
  | 'onboardingCompleted'
  | 'veoMode'
  | 'veoSessionCookie'
  | 'veoSessionAuthToken'
  | 'veoAccountEmail'
  | 'veoSessionStatus'
  | 'veoLastChecked'
  | 'veoCooldownSeconds';

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
  /** 1..9 theo Numpad: 1=BL, 2=BC, 3=BR, 4=ML, 5=C, 6=MR, 7=TL, 8=TC, 9=TR */
  alignment: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  marginV: number;
  marginH?: number;
  isVertical?: boolean;
  posPercent?: { x: number; y: number };
}

export interface SubMaskRegion {
  /** Vị trí dải che — phụ đề phim thường nằm ở đáy khung hình */
  position: 'bottom' | 'top';
  /** Chiều cao dải che theo % chiều cao khung hình (5-50) */
  heightPercent: number;
  /** solid = tô đen, blur = làm mờ vùng đó */
  mode: 'solid' | 'blur';
}

export interface PerLineSubtitleStyle {
  textColorHex?: string;
  outlineColorHex?: string;
  outlineWidth?: number;
  shadowDepth?: number;
  fontSize?: number;
  fontName?: string;
  bold?: boolean;
  italic?: boolean;
  alignment?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  marginV?: number;
  marginH?: number;
  isVertical?: boolean;
  posPercent?: { x: number; y: number };
}

export type MaskMode = 'blur' | 'gaussian' | 'glass' | 'pixelate' | 'solid';

export interface CustomMaskRegion {
  id?: string;
  name?: string;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  mode: MaskMode;
  intensity?: number;
  colorHex?: string;
  startSec?: number;
  endSec?: number;
  enabled?: boolean;
}

export interface WatermarkOptions {
  type: 'text' | 'image';
  content: string;
  opacity?: number;
  scalePercent?: number;
  fontSize?: number;
  position: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' | 'center' | 'custom' | 'floating' | 'bounce';
  customPos?: { xPercent: number; yPercent: number };
  speed?: 'slow' | 'medium' | 'fast';
}

export interface ExportFormatOptions {
  aspectRatio?: 'original' | '16:9' | '9:16' | '1:1';
  resolution?: 'original' | '1080p' | '720p' | '480p';
  fps?: number;
  bitrateKbps?: number;
  videoCodec?: 'libx264' | 'libx265';
  preset?: 'ultrafast' | 'veryfast' | 'fast' | 'medium';
}

export interface DualSubtitleOption {
  enabled: boolean;
  layoutPreset?: 'douyin_music_left' | 'top_bottom_bilingual' | 'custom';
  secondaryStyle?: Partial<SubStyle>;
}

export interface AdvancedExportOptions {
  perLineStyles?: Record<number, PerLineSubtitleStyle>;
  customMask?: CustomMaskRegion | null;
  customMasks?: CustomMaskRegion[] | null;
  watermark?: WatermarkOptions | null;
  formatOptions?: ExportFormatOptions | null;
  dualSubtitles?: DualSubtitleOption | null;
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
    cleanSubtitles: (items: Array<{ startMs: number; endMs: number; text: string }>) => Promise<Array<{ startMs: number; endMs: number; text: string }>>;
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
  veo: {
    openLobby: () => Promise<{ ok: boolean; error?: string }>;
    status: () => Promise<{
      mode: 'free_session' | 'api_key' | 'simulation';
      hasSession: boolean;
      sessionStatus: 'active' | 'expired' | 'unauthenticated' | 'rate_limited' | 'captcha_required' | 'unknown';
      email?: string;
      lastChecked?: number;
      antiSpam: {
        allowed: boolean;
        remainingCooldownSec: number;
        cooldownTotalSec: number;
        warningMessage?: string;
        isLocked: boolean;
        lastRequestTimestamp: number;
      };
    }>;
    validate: () => Promise<{
      valid: boolean;
      status: 'active' | 'expired' | 'unauthenticated' | 'rate_limited' | 'captcha_required' | 'unknown';
      detail: string;
      email?: string;
      quotaRemaining?: string;
      lastChecked: number;
    }>;
    saveSession: (rawInput: string) => Promise<{ ok: boolean; result?: any; error?: string }>;
    clearSession: () => Promise<{ ok: boolean; error?: string }>;
    getAntiSpamStatus: () => Promise<{
      status: {
        allowed: boolean;
        remainingCooldownSec: number;
        cooldownTotalSec: number;
        warningMessage?: string;
        isLocked: boolean;
        lastRequestTimestamp: number;
      };
      guidelines: Array<{
        id: string;
        title: string;
        description: string;
        severity: 'high' | 'medium' | 'info';
        icon: string;
      }>;
    }>;
    setMode: (mode: 'free_session' | 'api_key' | 'simulation') => Promise<{ ok: boolean }>;
  };
  export: {
    start: (
      id: string,
      mode: 'hardsub' | 'softsub',
      mask?: SubMaskRegion | null,
      style?: SubStyle | null,
      advancedOptions?: AdvancedExportOptions | null
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
    openImageFile: () => Promise<string | null>;
    showInFolder: (filePath: string) => Promise<void>;
    openFolder: (folderPath: string) => Promise<void>;
    chooseDirectory: () => Promise<string | null>;
  };
  downloader: {
    inspect: (url: string) => Promise<{
      url: string;
      cleanUrl: string;
      platform: 'youtube' | 'douyin' | 'bilibili' | 'tiktok' | 'other';
      title: string;
      author?: string;
      duration?: number;
      durationFormatted?: string;
      thumbnail?: string;
      availableQualities: Array<{
        id: string;
        label: string;
      }>;
    }>;
    download: (options: { url: string; quality?: string }) => Promise<{
      task: Task;
      result: any;
    }>;
    onProgress: (callback: (progress: {
      percent: number;
      speed?: string;
      eta?: string;
      status: 'downloading' | 'processing' | 'completed' | 'error';
      stageDescription?: string;
    }) => void) => () => void;
  };
  files: {
    getPath: (file: File) => string;
  };
  logs: {
    onLog: (callback: (entry: { level: string; text: string; ts: number }) => void) => () => void;
  };
  workflow: {
    run: (graph: any) => Promise<{ success: boolean; outputs: Record<string, any>; error?: string }>;
    cancel: (workflowId: string) => Promise<boolean>;
    compareFrames: (frameA: string, frameB: string, config?: any) => Promise<{
      passed: boolean;
      score: number;
      colorDelta: number;
      status: 'pass' | 'warn' | 'fail';
      details: string;
    }>;
    concatClips: (clipPaths: string[], outPath?: string) => Promise<string>;
    getVideoDuration: (videoPath: string) => Promise<number>;
    onNodeEvent: (callback: (event: any) => void) => () => void;
  };
  bible: {
    getCharacters: () => Promise<any[]>;
    saveCharacter: (profile: any) => Promise<any>;
    deleteCharacter: (id: string) => Promise<boolean>;
    getScenes: () => Promise<any[]>;
    saveScene: (profile: any) => Promise<any>;
    deleteScene: (id: string) => Promise<boolean>;
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
