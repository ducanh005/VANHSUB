import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveGrantedMedia } from '../main/security/mediaCapabilities';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-media-grants-'));
try {
  const projectA = path.join(root, 'Dự án A'), projectB = path.join(root, 'Dự án B'), outside = path.join(root, 'outside');
  for (const dir of [projectA, projectB, outside]) fs.mkdirSync(dir);
  for (const dir of [projectA, projectB, outside]) fs.writeFileSync(path.join(dir, 'cảnh 1.mp4'), 'synthetic media fixture');
  const json = path.join(projectA, 'settings.json'); fs.writeFileSync(json, 'synthetic sensitive fixture');
  const grants = { files: [], directories: [projectA] };
  assert.equal(resolveGrantedMedia('cảnh 1.mp4', grants), fs.realpathSync(path.join(projectA, 'cảnh 1.mp4')));
  assert.throws(() => resolveGrantedMedia(path.join(outside, 'cảnh 1.mp4'), grants), /FORBIDDEN/);
  assert.throws(() => resolveGrantedMedia('../outside/cảnh 1.mp4', grants), /FORBIDDEN/);
  assert.throws(() => resolveGrantedMedia(json, grants), /FORBIDDEN/);
  assert.throws(() => resolveGrantedMedia('cảnh 1.mp4', { files: [], directories: [projectA, projectB] }), /AMBIGUOUS/);
  assert.equal(resolveGrantedMedia(path.join(projectB, 'cảnh 1.mp4'), { files: [path.join(projectB, 'cảnh 1.mp4')], directories: [] }), fs.realpathSync(path.join(projectB, 'cảnh 1.mp4')));
  // Directory junctions are available on Windows without symlink developer privileges.
  const link = path.join(projectA, 'external');
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => resolveGrantedMedia(path.join(link, 'cảnh 1.mp4'), grants), /FORBIDDEN/);
  fs.unlinkSync(link);
  console.log('PASS: explicit file/project grants, Unicode paths, ambiguous relative names, traversal/nonmedia/junction escape denial');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
