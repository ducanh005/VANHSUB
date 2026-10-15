import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { PipelineSessionState } from './types';

export function validateSessionIdentity(id: string): void {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error('ID session không hợp lệ.');
}
export function readOwnedSession(file: string, id: string): PipelineSessionState | null {
  validateSessionIdentity(id);
  if (!fs.existsSync(file)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    return state?.sessionId === id ? { ...state, stages: state.stages || {}, artifacts: state.artifacts || {} } : null;
  } catch { return null; }
}
export function assertSessionDirectoryOwner(dir: string, id: string): void {
  validateSessionIdentity(id);
  for (const filename of ['index.json', 'session.json']) {
    const file = path.join(dir, filename);
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const owner = filename === 'index.json' ? data.project_id : data.sessionId;
    if (owner && owner !== id) throw new Error('SESSION_DIRECTORY_CONFLICT: Thư mục thuộc phiên khác; dữ liệu cũ được giữ nguyên.');
  }
}
export function writeSessionCheckpoint(file: string, state: PipelineSessionState): void {
  validateSessionIdentity(state.sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp.${crypto.randomUUID()}`;
  const { jobActive: _runtime, ...checkpoint } = state;
  try { fs.writeFileSync(temporary, JSON.stringify(checkpoint, null, 2), 'utf8'); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
