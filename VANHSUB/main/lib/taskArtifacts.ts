import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TaskStore, type Task } from '../store/taskStore';
import { isTaskBusy } from './taskExecution';
import { translationConfigHash } from './translationConfig';

export function getTaskSrtPath(task: Task): string | undefined {
  return isTranslationCurrent(task) ? task.translatedSrtPath : task.srtPath;
}
export function isTranslationCurrent(task: Task): boolean {
  return Boolean(
    !task.translationStale &&
    task.translatedSrtPath &&
    fs.existsSync(task.translatedSrtPath) &&
    (!task.translationConfigHash || task.translationConfigHash === translationConfigHash(task.targetLanguage)) &&
    (!task.translationSourceHash ||
      (task.srtPath && fs.existsSync(task.srtPath) && task.translationSourceHash === hashFile(task.srtPath)))
  );
}

export function invalidateTaskArtifacts(id: string, from: 'source' | 'translation' | 'tts'): void {
  TaskStore.update(id, {
    ...(from === 'source' ? { translationStale: true } : {}),
    ...(from !== 'tts' ? { ttsStale: true } : {}),
    dubbedStale: true,
    ttsMergedAudioPath: undefined,
    outputPath: undefined,
    hardsubPath: undefined,
    softsubPath: undefined,
    ttsOverruns: undefined,
  });
}

/** Settings change only invalidates stages that depend on the changed values. */
export function invalidateTaskConfiguration(task: Task, updates: Partial<Task>): void {
  const changed = (keys: (keyof Task)[]) =>
    keys.some((key) => key in updates && JSON.stringify(updates[key]) !== JSON.stringify(task[key]));
  if (changed(['filePath', 'sourceLanguage', 'asrModel', 'asrEngine', 'enableDiarization', 'speakerCount'])) {
    TaskStore.update(task.id, { srtStale: true });
    invalidateTaskArtifacts(task.id, 'source');
  } else if (changed(['targetLanguage'])) invalidateTaskArtifacts(task.id, 'source');
  else if (changed(['ttsVoice', 'ttsSpeed', 'ttsEngine', 'ttsVoiceOverrides']))
    invalidateTaskArtifacts(task.id, 'translation');
}

const canonicalPath = (file: string) => {
  const resolved = path.resolve(file);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

/** The editor and imports share this boundary so dependent artifacts cannot silently stay current. */
export function writeTaskSrt(srtPath: string, content: string): boolean {
  const related = TaskStore.getAll().filter((task) =>
    [task.srtPath, task.translatedSrtPath].some((file) => file && canonicalPath(file) === canonicalPath(srtPath))
  );
  if (related.some((task) => isTaskBusy(task.id)))
    throw new Error('Tác vụ đang xử lý. Hãy chờ hoặc huỷ trước khi lưu phụ đề.');
  if (fs.existsSync(srtPath) && fs.readFileSync(srtPath, 'utf8') === content) return true;
  const staging = `${srtPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(staging, content, 'utf8');
    fs.renameSync(staging, srtPath);
  } finally {
    if (fs.existsSync(staging)) fs.unlinkSync(staging);
  }
  for (const task of related)
    invalidateTaskArtifacts(
      task.id,
      task.srtPath && canonicalPath(task.srtPath) === canonicalPath(srtPath) ? 'source' : 'translation'
    );
  return true;
}

export function hashFile(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
