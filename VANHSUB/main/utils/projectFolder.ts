import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { SettingsStore } from '../store/settingsStore';
import { TaskStore, type Task } from '../store/taskStore';

/**
 * Loại bỏ các ký tự không hợp lệ trên Windows để làm tên thư mục an toàn: \ / : * ? " < > |
 */
export function sanitizeFolderName(rawName: string): string {
  return rawName
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim().replace(/[. ]+$/g, '').slice(0, 140);
}

/**
 * Lấy hoặc tạo mới thư mục dự án riêng cho một video.
 * Cấu trúc: [Tên video]_vanhsub/ nằm cạnh video gốc hoặc trong exportDir nếu đã cài đặt.
 */
export function getOrCreateProjectDir(task: Task | { id: string; filePath: string; fileName: string; projectDir?: string }): string {
  if (task.projectDir && fs.existsSync(task.projectDir)) {
    const target = fs.realpathSync(task.projectDir).toLowerCase();
    if (!fs.statSync(task.projectDir).isDirectory()) throw new Error('Đường dẫn dự án không phải thư mục.');
    const conflict = TaskStore.getAll().some(other => other.id !== task.id && other.projectDir && fs.existsSync(other.projectDir) && fs.realpathSync(other.projectDir).toLowerCase() === target);
    if (conflict) throw new Error('Hai tác vụ đang dùng chung thư mục dự án cũ. Hãy tạo dự án mới để giữ nguyên dữ liệu.');
    return task.projectDir;
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

  const identity = crypto.createHash('sha256').update(task.id || path.resolve(task.filePath)).digest('hex').slice(0, 12);
  const projectDir = path.join(parentDir, `${cleanBase || 'video'}_${identity}_vanhsub`);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

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
