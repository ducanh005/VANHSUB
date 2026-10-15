import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-subtitle-state-'));
  process.env.VANHSUB_SETTINGS_DIR = path.join(dir, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(dir, 'tasks');
  try {
    const { TaskStore } = await import('../main/store/taskStore');
    const { saveTaskSubtitle, importTaskSubtitle } = await import('../main/lib/subtitleArtifacts');
    const { TTSRunner } = await import('../main/render/ttsRunner');
    const { DubbingRunner } = await import('../main/render/dubbingRunner');
    const text = (line: string) => `1\n00:00:00,000 --> 00:00:01,000\n${line}\n`;
    const raw = path.join(dir, 'original.srt');
    const translated = path.join(dir, 'translated.srt');
    const audioDir = path.join(dir, 'tts');
    fs.mkdirSync(audioDir);
    fs.writeFileSync(raw, text('Original.'));
    fs.writeFileSync(translated, text('Translation.'));
    fs.writeFileSync(path.join(audioDir, 'cache.mp3'), 'preserve-cache');
    const task = TaskStore.create({ fileName: 'clip.mp4', filePath: path.join(dir, 'clip.mp4'),
      srtPath: raw, translatedSrtPath: translated, ttsAudioDir: audioDir, projectDir: dir,
      outputPath: 'export.mp4', dubbedVideoPath: 'dub.mp4', dubbedVideoStretchFactor: 1.2,
      ttsMergedAudioPath: 'merged.mp3', status: 'done' });
    saveTaskSubtitle(translated, text('Translation.'));
    assert.equal(TaskStore.getById(task.id)?.subtitleRevision, undefined, 'Unchanged content retains artifacts');
    saveTaskSubtitle(translated, text('Edited translation.'));
    let updated = TaskStore.getById(task.id)!;
    assert.equal(updated.translatedSrtPath, translated);
    assert.equal(updated.ttsNeedsRegeneration, true);
    assert.equal(updated.ttsAudioDir, audioDir);
    assert.equal(updated.ttsMergedAudioPath, undefined);
    assert.equal(updated.dubbedVideoPath, undefined);
    assert.equal(updated.dubbedVideoStretchFactor, undefined);
    assert.equal(updated.outputPath, undefined);
    assert.equal(updated.subtitleRevision, 1);
    assert.equal((await TTSRunner.exportMergedAudio(task.id)).ok, false);
    const refused = await DubbingRunner.runDubbing(task.id);
    assert.equal(refused?.status, 'error');
    assert.match(refused?.errorMessage || '', /Phụ đề đã thay đổi/);
    saveTaskSubtitle(raw, text('Edited original.'));
    updated = TaskStore.getById(task.id)!;
    assert.equal(updated.translatedSrtPath, undefined);
    assert.equal(updated.subtitleRevision, 2);
    assert.equal(fs.readFileSync(path.join(audioDir, 'cache.mp3'), 'utf8'), 'preserve-cache');

    TaskStore.update(task.id, { status: 'dubbing' });
    assert.throws(() => saveTaskSubtitle(raw, text('Conflict.')), /đang xử lý/);
    assert.throws(() => importTaskSubtitle(task.id, translated), /đang xử lý/);
    assert.equal(fs.readFileSync(raw, 'utf8'), text('Edited original.'));
    TaskStore.update(task.id, { status: 'done' });
    assert.throws(() => saveTaskSubtitle(raw, 'invalid subtitle'), /không có dòng phụ đề hợp lệ/);
    assert.equal(fs.readFileSync(raw, 'utf8'), text('Edited original.'));
    const imported = importTaskSubtitle(task.id, translated)!;
    assert.equal(path.dirname(imported.srtPath!), dir);
    assert.notEqual(imported.srtPath, raw);
    assert.notEqual(imported.srtPath, translated);
    assert.equal(fs.readFileSync(imported.srtPath!, 'utf8'), text('Edited translation.'));
    assert.equal(imported.translatedSrtPath, undefined);
    assert.equal(imported.subtitleRevision, 3);
    assert.deepEqual(imported.ttsVoiceOverrides, {});
    const { reserveTaskOperation } = await import('../main/lib/taskOperations');
    const actual = path.join(dir, 'physical'), alias = path.join(dir, 'alias');
    fs.mkdirSync(actual); fs.symlinkSync(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const realSrt = path.join(actual, 'aliased.srt'); fs.writeFileSync(realSrt, text('Last good.'));
    const aliased = TaskStore.create({ fileName: 'alias.mp4', filePath: path.join(alias, 'alias.mp4'), projectDir: alias, srtPath: path.join(alias, 'aliased.srt') });
    const release = reserveTaskOperation(aliased.id);
    try { assert.throws(() => saveTaskSubtitle(realSrt, text('Busy edit.')), /đang xử lý/); }
    finally { release(); }
    assert.equal(fs.readFileSync(realSrt, 'utf8'), text('Last good.'));
    saveTaskSubtitle(realSrt, text('Idle edit.'));
    assert.equal(TaskStore.getById(aliased.id)?.subtitleRevision, 1, 'Physical and junction paths share ownership, lock and invalidation');
    fs.unlinkSync(alias);
    console.log('PASS: subtitle save/import invalidation, unchanged-content preservation, busy/invalid-input guards and audio cache retention');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
