import fs from 'fs';
import type { StoryboardScene } from './types';

export type VisualRunMode = 'resume_missing' | 'regenerate_selected' | 'regenerate_all';
export function selectVisualJobs(scenes: StoryboardScene[], mode: VisualRunMode = 'resume_missing', selected: string[] = []): StoryboardScene[] {
  if (!['resume_missing', 'regenerate_selected', 'regenerate_all'].includes(mode)) throw new Error('Chế độ tạo media không hợp lệ.');
  if (mode === 'regenerate_all') return [...scenes];
  if (mode === 'regenerate_selected') {
    if (!selected.length || selected.some(id => !scenes.some(scene => scene.id === id || scene.shotId === id))) {
      throw new Error('Hãy chọn các shot tồn tại trong phiên để tạo lại.');
    }
    const ids = new Set(selected);
    return scenes.filter(scene => ids.has(scene.id) || Boolean(scene.shotId && ids.has(scene.shotId)));
  }
  return scenes.filter(scene => {
    const asset = scene.motionType === 'video' ? scene.videoPath : (scene.imagePath || scene.assetPath);
    try { return !asset || !fs.statSync(asset).isFile() || fs.statSync(asset).size === 0; }
    catch { return true; }
  });
}
