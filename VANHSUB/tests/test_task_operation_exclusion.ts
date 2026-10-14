import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertTaskAvailable, reserveTaskOperation, withTaskOperation, isTaskOperationActive } from '../main/lib/taskOperations';

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-task-lock-'));
  process.env.VANHSUB_SETTINGS_DIR = path.join(dir, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(dir, 'tasks');
  try {
    const { TaskStore } = await import('../main/store/taskStore');
    const { saveTaskSubtitle, importTaskSubtitle } = await import('../main/lib/subtitleArtifacts');
    const srt = path.join(dir, 'source.srt');
    const content = '1\n00:00:00,000 --> 00:00:01,000\nOriginal.\n';
    fs.writeFileSync(srt, content);
    const task = TaskStore.create({ fileName: 'source.mp4', filePath: path.join(dir, 'source.mp4'), srtPath: srt, status: 'done' });
    let finish!: () => void;
    const pending = withTaskOperation(task.id, () => new Promise<void>((resolve) => { finish = resolve; }));
    assert.equal(isTaskOperationActive(task.id), true, 'Reserve before yielding to a runner or queue');
    let secondStarted = false;
    await assert.rejects(() => withTaskOperation(task.id, async () => { secondStarted = true; }), /đang xử lý/);
    assert.equal(secondStarted, false);
    assert.throws(() => saveTaskSubtitle(srt, content.replace('Original', 'Changed')), /đang xử lý/);
    assert.throws(() => importTaskSubtitle(task.id, srt), /đang xử lý/);
    assert.equal(fs.readFileSync(srt, 'utf8'), content);
    await withTaskOperation('independent-task', async () => assert.equal(isTaskOperationActive(task.id), true));

    // A cancellation changes UI status before the underlying job finishes.
    TaskStore.update(task.id, { status: 'cancelled' });
    assert.throws(() => assertTaskAvailable(task.id), /đang xử lý/);
    finish();
    await pending;
    assert.equal(isTaskOperationActive(task.id), false);
    const oldRelease = reserveTaskOperation(task.id);
    oldRelease();
    const newRelease = reserveTaskOperation(task.id);
    oldRelease();
    assert.equal(isTaskOperationActive(task.id), true, 'An old completion cannot release a newer reservation');
    newRelease();
    await assert.rejects(() => withTaskOperation(task.id, async () => { throw new Error('test failure'); }), /test failure/);
    assert.equal(isTaskOperationActive(task.id), false, 'Failure releases the task');
    saveTaskSubtitle(srt, content.replace('Original', 'Changed'));
    assert.match(fs.readFileSync(srt, 'utf8'), /Changed/);
    console.log('PASS: queued/running operation exclusion, independent tasks, subtitle mutation guard, cancellation lifetime and stale/failure releases');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
