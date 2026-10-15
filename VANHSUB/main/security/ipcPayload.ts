import path from 'node:path';

function invalid(): never { throw new Error('IPC_PAYLOAD_INVALID: Dữ liệu gửi tới ứng dụng không hợp lệ hoặc quá lớn.'); }
function record(value: unknown): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
}
function text(value: unknown, limit: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || value.includes('\0')) invalid();
}
function filePath(value: unknown): asserts value is string { text(value, 32768); if (!path.isAbsolute(value)) invalid(); }
function id(value: unknown): void { text(value, 128); if (!/^[a-zA-Z0-9_-]+$/.test(value)) invalid(); }

/** Bound structured-clone payloads before the handler touches stores, paths or providers. */
export function validateIpcPayload(channel: string, args: unknown[]): void {
  let bytes = 0, nodes = 0;
  const visit = (value: unknown, depth: number) => {
    if (++nodes > 100000 || depth > 24) invalid();
    if (value === null || value === undefined || typeof value === 'boolean') return;
    if (typeof value === 'string') { bytes += Buffer.byteLength(value); if (bytes > 16 * 1024 * 1024) invalid(); return; }
    if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(); return; }
    if (Array.isArray(value)) { if (value.length > 20000) invalid(); for (const item of value) visit(item, depth + 1); return; }
    record(value);
    for (const [key, item] of Object.entries(value)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor' || key.length > 1024) invalid();
      bytes += Buffer.byteLength(key); if (bytes > 16 * 1024 * 1024) invalid();
      visit(item, depth + 1);
    }
  };
  visit(args, 0);
  if (/^(tasks:(get|update|delete|start|cancel|startHybrid|cancelHybrid|runPipeline|importSrt)|translate:(start|cancel)|tts:(start|cancel|regenerateLine|export-merged-audio)|ocr:(start|cancel)|export:(start|separateStems)|dubbing:(start|cancel))$/.test(channel)) id(args[0]);
  if (channel === 'tasks:create') {
    record(args[0]); text(args[0].fileName, 1024); filePath(args[0].filePath);
    if ('id' in args[0] || 'createdAt' in args[0] || 'updatedAt' in args[0]) invalid();
  }
  if (channel === 'tasks:update') {
    record(args[1]);
    if ('id' in args[1] || 'createdAt' in args[1] || 'updatedAt' in args[1]) invalid();
  }
  if (channel === 'tasks:create' || channel === 'tasks:update') {
    const task = args[channel === 'tasks:create' ? 0 : 1] as Record<string, unknown>;
    for (const key of ['filePath', 'projectDir', 'srtPath', 'translatedSrtPath', 'audioPath', 'outputPath', 'dubbedVideoPath', 'ttsAudioDir', 'ttsMergedAudioPath']) {
      if (task[key] !== undefined && task[key] !== '') filePath(task[key]);
    }
    if (task.status !== undefined && !['queued', 'transcribing', 'ocr', 'translating', 'exporting', 'dubbing', 'done', 'error', 'cancelled'].includes(String(task.status))) invalid();
  }
  if (['tasks:readSrt', 'tasks:writeSrt'].includes(channel)) {
    filePath(args[0]); if (path.extname(args[0]).toLowerCase() !== '.srt') invalid();
    if (channel === 'tasks:writeSrt' && typeof args[1] !== 'string') invalid();
  }
  if (channel === 'tasks:importSrt') { filePath(args[1]); if (path.extname(args[1]).toLowerCase() !== '.srt') invalid(); }
  if (channel === 'export:start') {
    if (!['hardsub', 'softsub'].includes(String(args[1]))) invalid();
    if (args[4] != null) {
      record(args[4]); const options = args[4];
      if (options.videoSource !== undefined && !['auto', 'original', 'dubbed'].includes(options.videoSource)) invalid();
      if (options.formatOptions !== undefined) {
        record(options.formatOptions); const format = options.formatOptions;
        if (format.resolution !== undefined && !['original', '1080p', '720p', '480p'].includes(format.resolution)) invalid();
      }
    }
  }
  if (channel === 'tts:start' && args[2] !== undefined && (typeof args[2] !== 'number' || args[2] < 0.1 || args[2] > 5)) invalid();
  if (channel.startsWith('aiStudio:') && args[0] && typeof args[0] === 'object' && 'sessionId' in args[0]) id((args[0] as any).sessionId);
}
