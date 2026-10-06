import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Each run publishes its own manifest. Immutable MP3s can share disk blocks safely. */
export function createTtsRunDirectory(projectDir: string, previousDir?: string): string {
  const dir = path.join(projectDir, 'tts_audio', `run-${randomUUID().replace(/-/g, '').slice(0, 16)}`);
  fs.mkdirSync(dir, { recursive: true });
  if (previousDir && fs.existsSync(previousDir)) {
    let manifest: Record<string, { audioFile?: string; leaderIndex?: number }>;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(previousDir, 'manifest.json'), 'utf8'));
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return dir;
    } catch {
      return dir;
    }
    // Only seed files referenced by the current manifest, not the accumulated history.
    const names = new Set<string>();
    for (const [index, entry] of Object.entries(manifest)) {
      if (!entry || typeof entry !== 'object') continue;
      const name = entry.audioFile || `subtitle_${String(entry.leaderIndex ?? index).padStart(4, '0')}.mp3`;
      if (typeof name === 'string' && path.basename(name) === name && name.endsWith('.mp3')) names.add(name);
    }
    for (const name of names) {
      const source = path.join(previousDir, name),
        target = path.join(dir, name);
      if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) continue;
      try {
        fs.linkSync(source, target);
      } catch {
        fs.copyFileSync(source, target);
      }
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  }
  return dir;
}
