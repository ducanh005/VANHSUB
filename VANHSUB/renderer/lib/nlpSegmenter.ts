// Re-export từ main/lib/nlpSegmenter.ts — nguồn thật duy nhất để cả main process
// (taskRunner, translator) và renderer (SubtitleEditor) dùng chung NLP segmenter.
export * from '../../main/lib/nlpSegmenter';
