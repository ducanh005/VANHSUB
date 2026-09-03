export type TaskStatus = 'queued' | 'transcribing' | 'translating' | 'exporting' | 'dubbing' | 'done' | 'error';

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
