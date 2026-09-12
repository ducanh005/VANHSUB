export type TaskStatus = 'queued' | 'transcribing' | 'ocr' | 'translating' | 'exporting' | 'dubbing' | 'done' | 'error' | 'cancelled';

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
  /** Thư mục dự án gom toàn bộ file liên quan đến video này */
  projectDir?: string;
  errorMessage?: string;
  // TTS / Dubbing fields
  ttsVoice?: string;
  ttsSpeed?: number;
  /** Engine tạo audio: 'viettts' hoặc 'tiktok' */
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
