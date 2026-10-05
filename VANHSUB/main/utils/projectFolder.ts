import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { SettingsStore } from '../store/settingsStore';
import { TaskStore, type Task } from '../store/taskStore';

/**
 * Loại bỏ các ký tự không hợp lệ trên Windows để làm tên thư mục an toàn: \ / : * ? " < > |
 */
export function sanitizeFolderName(rawName: string): string {
  return rawName
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lấy hoặc tạo mới thư mục dự án riêng cho một video.
 * Cấu trúc: [Tên video]_vanhsub/ nằm cạnh video gốc hoặc trong exportDir nếu đã cài đặt.
 */
const OWNER_FILE = '.vanhsub-project.json';

/** Atomically reserve a new directory. Existing folders are never overwritten by downloads. */
export function createDownloadProjectDir(parent: string, name: string): string {
  fs.mkdirSync(parent, { recursive: true });
  for (;;) {
    const dir = path.join(parent, `${sanitizeFolderName(name).slice(0, 60) || 'video'}_vanhsub_${randomUUID().slice(0, 12)}`);
    try { fs.mkdirSync(dir); return dir; }
    catch (error: any) { if (error.code !== 'EEXIST') throw error; }
  }
}

export function getOrCreateProjectDir(task: Task | { id: string; filePath: string; fileName: string; projectDir?: string }): string {
  const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  if (task.projectDir && fs.existsSync(task.projectDir)) {
    let owner: { taskId?: string } = {};
    try { owner = JSON.parse(fs.readFileSync(path.join(task.projectDir, OWNER_FILE), 'utf8')); } catch {}
    const shared = TaskStore.getAll().some((other) => other.id !== task.id && other.projectDir && samePath(other.projectDir, task.projectDir!));
    if (!shared && (!owner.taskId || owner.taskId === task.id)) {
      fs.writeFileSync(path.join(task.projectDir, OWNER_FILE), JSON.stringify({ taskId: task.id }));
      return task.projectDir;
    }
  }

  const videoPath = task.filePath;
  const videoExt = path.extname(videoPath);
  const rawBase = path.basename(videoPath, videoExt) || path.basename(task.fileName, videoExt) || 'video';
  const cleanBase = sanitizeFolderName(rawBase);

  // Xác định thư mục cha: ưu tiên exportDir nếu có, nếu không thì cạnh file video
  const exportDirSetting = SettingsStore.get('exportDir');
  let parentDir = path.dirname(videoPath);
  if (exportDirSetting && fs.existsSync(exportDirSetting)) {
    parentDir = exportDirSetting;
  }

  fs.mkdirSync(parentDir, { recursive: true });
  const suffix = createHash('sha256').update(task.id || path.resolve(videoPath)).digest('hex').slice(0, 12);
  let projectDir = path.join(parentDir, `${cleanBase.slice(0, 60)}_vanhsub_${suffix}`);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir);
  } else {
    let owner: { taskId?: string } = {};
    try { owner = JSON.parse(fs.readFileSync(path.join(projectDir, OWNER_FILE), 'utf8')); } catch {}
    if (owner.taskId !== task.id) projectDir = createDownloadProjectDir(parentDir, cleanBase);
  }
  fs.writeFileSync(path.join(projectDir, OWNER_FILE), JSON.stringify({ taskId: task.id }));

  // Cập nhật lại vào TaskStore nếu task đã tồn tại
  if (task.id) {
    TaskStore.update(task.id, { projectDir });
  }

  return projectDir;
}

export interface ProjectArtifactPaths {
  projectDir: string;
  cleanBase: string;
  audioWavPath: string;
  rawSrtPath: string;
  translatedSrtPath: string;
  compiledAssPath: string;
  hardsubPath: string;
  softsubPath: string;
  dubbedPath: string;
  ttsAudioDir: string;
  /** File audio MP3 lồng tiếng tổng hợp chuẩn xác theo timeline dự án */
  ttsMergedAudioPath: string;
}

/**
 * Tạo danh sách đường dẫn chuẩn hoá cho toàn bộ sản phẩm xuất ra của video trong projectDir.
 */
export function getProjectArtifactPaths(task: Task): ProjectArtifactPaths {
  const projectDir = getOrCreateProjectDir(task);
  const videoPath = task.filePath;
  const videoExt = path.extname(videoPath);
  const rawBase = path.basename(videoPath, videoExt) || path.basename(task.fileName, videoExt) || 'video';
  const cleanBase = sanitizeFolderName(rawBase);

  return {
    projectDir,
    cleanBase,
    audioWavPath: path.join(projectDir, `${cleanBase}_audio_16k.wav`),
    rawSrtPath: path.join(projectDir, `${cleanBase}.srt`),
    translatedSrtPath: path.join(projectDir, `${cleanBase}.vi.srt`),
    compiledAssPath: path.join(projectDir, `${cleanBase}.ass`),
    hardsubPath: path.join(projectDir, `${cleanBase}.hardsub.mp4`),
    softsubPath: path.join(projectDir, `${cleanBase}.softsub.mp4`),
    dubbedPath: path.join(projectDir, `${cleanBase}.dubbed.mp4`),
    ttsAudioDir: path.join(projectDir, 'tts_audio'),
    ttsMergedAudioPath: path.join(projectDir, `${cleanBase}_voice.mp3`),
  };
}
