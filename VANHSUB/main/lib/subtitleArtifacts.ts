import fs from 'fs';
import path from 'path';
import { TaskStore, type Task } from '../store/taskStore';
import { parseSrtStrict } from './srt';
import { nextAvailablePath } from './paths';
import { getProjectArtifactPaths } from '../utils/projectFolder';
import { assertTaskAvailable } from './taskOperations';

function assertIdle(task: Task) {
  assertTaskAvailable(task.id);
  if (['transcribing', 'ocr', 'translating', 'dubbing', 'exporting'].includes(task.status)) {
    throw new Error('Tác vụ đang xử lý. Hãy chờ hoặc huỷ trước khi thay phụ đề.');
  }
}

function validate(content: string) {
  if (parseSrtStrict(content).length === 0) throw new Error('File SRT không có dòng phụ đề hợp lệ.');
}

function invalidate(task: Task, original: boolean) {
  return TaskStore.update(task.id, {
    ...(original ? { translatedSrtPath: undefined } : {}),
    subtitleRevision: (task.subtitleRevision || 0) + 1,
    ttsNeedsRegeneration: !!task.ttsAudioDir,
    ttsMergedAudioPath: undefined, ttsOverruns: undefined, outputPath: undefined,
    stageDescription: 'Phụ đề đã thay đổi — cần tạo lại audio trước khi lồng tiếng',
  });
}

export function saveTaskSubtitle(srtPath: string, content: string): void {
  validate(content);
  const normalize = (file: string) => path.resolve(file).toLowerCase();
  const tasks = TaskStore.getAll().filter((task) => [task.srtPath, task.translatedSrtPath]
    .some((file) => file && normalize(file) === normalize(srtPath)));
  tasks.forEach(assertIdle);
  if (fs.existsSync(srtPath) && fs.readFileSync(srtPath, 'utf-8') === content) return;
  fs.writeFileSync(srtPath, content, 'utf-8');
  for (const task of tasks) invalidate(task, !!task.srtPath && normalize(task.srtPath) === normalize(srtPath));
}

export function importTaskSubtitle(id: string, source: string): Task | undefined {
  const task = TaskStore.getById(id);
  if (!task) throw new Error('Không tìm thấy tác vụ.');
  assertIdle(task);
  if (path.extname(source).toLowerCase() !== '.srt') throw new Error('Chỉ hỗ trợ file .srt');
  validate(fs.readFileSync(source, 'utf-8'));
  const target = nextAvailablePath(getProjectArtifactPaths(task).rawSrtPath);
  fs.copyFileSync(source, target);
  invalidate(task, true);
  return TaskStore.update(id, { srtPath: target, ttsVoiceOverrides: {},
    stageDescription: 'Đã nhập phụ đề — cần tạo lại bản dịch và audio nếu có' });
}
