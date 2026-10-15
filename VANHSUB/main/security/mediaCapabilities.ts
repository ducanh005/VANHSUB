import fs from 'node:fs';
import path from 'node:path';

export interface MediaGrants { files: Iterable<string>; directories: Iterable<string> }
export const MEDIA_EXTENSIONS = new Set(['.mp4', '.m4v', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg', '.opus', '.jpg', '.jpeg', '.png', '.webp', '.gif']);
export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const inside = (root: string, file: string) => { const relative = path.relative(root, file); return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)); };

/** Resolve only known files or physically contained project/user-selected roots. No cwd/active-project guessing. */
export function resolveGrantedMedia(raw: unknown, grants: MediaGrants, extensions = MEDIA_EXTENSIONS): string {
  if (typeof raw !== 'string' || !raw || raw.length > 32768 || raw.includes('\0') || !extensions.has(path.extname(raw).toLowerCase())) throw new Error('MEDIA_FORBIDDEN');
  if (!path.isAbsolute(raw) && raw.split(/[\\/]/).includes('..')) throw new Error('MEDIA_FORBIDDEN');
  const roots = [...grants.directories].filter(value => typeof value === 'string' && path.isAbsolute(value) && fs.existsSync(value))
    .map(value => fs.realpathSync(value));
  const files = [...grants.files].filter(value => typeof value === 'string' && path.isAbsolute(value) && fs.existsSync(value))
    .map(value => fs.realpathSync(value));
  const candidates = path.isAbsolute(raw) ? [raw] : roots.map(root => path.resolve(root, raw)).filter(candidate => roots.some(root => inside(root, candidate)));
  const allowed = new Map<string, string>();
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
    const real = fs.realpathSync(candidate);
    if (!extensions.has(path.extname(real).toLowerCase())) continue;
    if (files.some(file => path.relative(file, real) === '') || roots.some(root => inside(root, real))) {
      allowed.set(process.platform === 'win32' ? real.toLowerCase() : real, real);
    }
  }
  if (allowed.size !== 1) throw new Error(allowed.size > 1 ? 'MEDIA_AMBIGUOUS' : 'MEDIA_FORBIDDEN');
  return [...allowed.values()][0];
}
