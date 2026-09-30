// Re-export từ main/lib/subtitleDeduplication.ts — nguồn thật duy nhất để cả main process
// (hybridRunner, fusionEngine) và renderer (SubtitleEditor) dùng chung thuật toán khử trùng lặp.
export * from '../../main/lib/subtitleDeduplication';
