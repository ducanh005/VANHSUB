import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { PipelineSessionState } from '../types';

export function validateSessionId(sessionId: string): void {
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error('ID phiên AI Studio không hợp lệ.');
  }
}

export function readSessionCheckpoint(filePath: string, sessionId: string): PipelineSessionState | null {
  try {
    const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!state || state.sessionId !== sessionId || typeof state !== 'object') return null;
    state.stages ||= {};
    state.artifacts ||= {};
    return state;
  } catch {
    return null;
  }
}

/** New episodes always get their own directory, even if channels share an output root. */
export function newSessionWorkspace(outputRoot: string, sessionId: string): string {
  validateSessionId(sessionId);
  return path.join(path.resolve(outputRoot), 'sessions', sessionId);
}

function canonicalPath(dir: string): string {
  const resolved = path.resolve(dir);
  return (fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved).toLowerCase();
}

/** Preserve legacy locations, but refuse writes when ownership is ambiguous. */
export function assertSessionWorkspaceOwner(
  state: PipelineSessionState,
  workspaceDir: string,
  catalogRoot: string
): void {
  validateSessionId(state.sessionId);
  for (const file of ['session.json', 'index.json']) {
    const filePath = path.join(workspaceDir, file);
    if (!fs.existsSync(filePath)) continue;
    let record: any;
    try { record = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { throw new Error(`Checkpoint AI Studio bị hỏng: ${filePath}. Hãy tạo tập mới để giữ nguyên dữ liệu cũ.`); }
    const owner = file === 'session.json' ? record?.sessionId : record?.project_id;
    if (owner && owner !== state.sessionId) {
      throw new Error(`Thư mục AI Studio đang thuộc phiên ${owner}. Hãy tạo tập mới để tránh ghi đè dữ liệu.`);
    }
  }
  // Old flat checkpoints can refer to the same voice/storyboard/media files.
  if (fs.existsSync(catalogRoot)) {
    const resources = [workspaceDir, state.mediaDir || state.artifacts?.mediaDir || path.join(workspaceDir, '05_media')]
      .filter((p): p is string => Boolean(p)).map(canonicalPath);
    for (const name of fs.readdirSync(catalogRoot)) {
      if (!name.endsWith('.json')) continue;
      const other = readSessionCheckpoint(path.join(catalogRoot, name), name.slice(0, -5));
      if (!other || other.sessionId === state.sessionId) continue;
      const otherResources = [other.workspaceDir || other.outputDir, other.mediaDir || other.artifacts.mediaDir]
        .filter((p): p is string => Boolean(p)).map(canonicalPath);
      if (otherResources.some((p) => resources.includes(p))) {
        throw new Error(`Hai phiên AI Studio ${state.sessionId} và ${other.sessionId} dùng chung dữ liệu. Hãy tạo tập mới; dữ liệu cũ được giữ nguyên.`);
      }
    }
  }
}

export function writeSessionCheckpoint(filePath: string, state: PipelineSessionState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp.${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}
