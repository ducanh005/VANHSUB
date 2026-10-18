export interface MediaInspection {
  version: 1;
  checkedAt: string;
  originalPath: string;
  filePath: string;
  reportPath: string;
  duration: number;
  width: number;
  height: number;
  decode: 'passed';
  metadata: {
    status: 'cleaned' | 'unchanged' | 'not_requested';
    removedFields: string[];
    remainingSourceFields: string[];
    before: Record<string, string>;
    after: Record<string, string>;
  };
  visual: {
    status: 'review_needed' | 'no_text_detected_in_samples' | 'unavailable' | 'not_applicable' | 'partial';
    method: 'sampled_ocr_and_manual_review';
    language?: string;
    frames: Array<{ time: number; imagePath: string; text: string; suspectedMark: boolean; scanned: boolean }>;
    scannedFrames: number;
    message: string;
  };
  warnings: string[];
  source?: { url: string; platform: string };
}
