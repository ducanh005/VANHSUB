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
  createdAt: string;
  updatedAt: string;
}

export type CreateTaskInput = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>> & {
  fileName: string;
  filePath: string;
};
