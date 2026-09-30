// Re-export từ main/lib/subtitleSanitizer.ts — nguồn thật duy nhất để cả main process
// (hybridRunner, fusionEngine) và renderer (SubtitleEditor) dùng chung bộ lọc rác OCR.
export * from '../../main/lib/subtitleSanitizer';
