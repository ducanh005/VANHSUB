import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Each run publishes its own manifest. Immutable MP3s can share disk blocks safely. */
export function createTtsRunDirectory(projectDir: string, previousDir?: string): string {
  const dir = path.join(projectDir, 'tts_audio', `run-${randomUUID().replace(/-/g, '').slice(0, 16)}`);
  fs.mkdirSync(dir, { recursive: true });
  if (previousDir && fs.existsSync(previousDir)) {
    for (const entry of fs.readdirSync(previousDir, { withFileTypes: true })) {
      if (!entry.isFile() || (!entry.name.endsWith('.mp3') && entry.name !== 'manifest.json')) continue;
      const source = path.join(previousDir, entry.name),
        target = path.join(dir, entry.name);
      try {
        fs.linkSync(source, target);
      } catch {
        fs.copyFileSync(source, target);
      }
    }
  }
  return dir;
}
