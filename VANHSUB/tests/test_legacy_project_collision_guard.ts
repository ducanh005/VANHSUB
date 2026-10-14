import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-legacy-guard-'));
  process.env.VANHSUB_SETTINGS_DIR = path.join(dir, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(dir, 'tasks');
  try {
    const { TaskStore } = await import('../main/store/taskStore');
    const { assertProjectIsolation } = await import('../main/lib/projectIsolation');
    const { getOrCreateProjectDir } = await import('../main/utils/projectFolder');
    const { saveTaskSubtitle } = await import('../main/lib/subtitleArtifacts');
    const shared = path.join(dir, 'legacy_vanhsub');
    fs.mkdirSync(shared);
    const sub = path.join(shared, 'source.srt');
    const content = '1\n00:00:00,000 --> 00:00:01,000\nKeep legacy data.\n';
    fs.writeFileSync(sub, content);
    const first = TaskStore.create({ fileName: 'first.mp4', filePath: path.join(dir, 'first.mp4'), projectDir: shared, srtPath: sub });
    const second = TaskStore.create({ fileName: 'second.mp4', filePath: path.join(dir, 'second.mp4'), projectDir: shared });
    assert.throws(() => assertProjectIsolation(first), /second.mp4/);
    assert.throws(() => getOrCreateProjectDir(first), /dùng chung/);
    assert.throws(() => saveTaskSubtitle(sub, content.replace('Keep', 'Changed')), /dùng chung/);
    assert.equal(fs.readFileSync(sub, 'utf8'), content);
    TaskStore.delete(second.id);
    assert.doesNotThrow(() => assertProjectIsolation(first));
    assert.equal(getOrCreateProjectDir(first), shared);
    assert.equal(fs.readFileSync(sub, 'utf8'), content, 'Removing a duplicate task must not delete legacy artifacts');
    const third = TaskStore.create({ fileName: 'third.mp4', filePath: path.join(dir, 'third.mp4'), srtPath: sub });
    assert.throws(() => assertProjectIsolation(third), /dùng chung/, 'Shared SRT remains a conflict even with no projectDir');
    TaskStore.delete(third.id);
    const duplicateSource = TaskStore.create({ fileName: first.fileName, filePath: first.filePath });
    assert.doesNotThrow(() => assertProjectIsolation(duplicateSource), 'Sharing read-only source media is supported');
    assert.notEqual(getOrCreateProjectDir(duplicateSource), shared);
    console.log('PASS: legacy shared folder/SRT rejection, preserved artifacts and separate tasks using the same source media');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
