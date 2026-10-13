import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUniqueDirectory } from '../main/lib/paths';

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-project-isolation-'));
  // Isolate real stores before importing their lazy singletons. Never use app data.
  process.env.VANHSUB_SETTINGS_DIR = path.join(temp, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(temp, 'tasks');
  try {
    const { SettingsStore } = await import('../main/store/settingsStore');
    const { TaskStore } = await import('../main/store/taskStore');
    const { getOrCreateProjectDir, getProjectArtifactPaths } = await import('../main/utils/projectFolder');
    const { finalizeDownload } = await import('../main/helpers/videoDownloader');
    const exports = path.join(temp, 'exports');
    fs.mkdirSync(exports);
    SettingsStore.set('exportDir', exports);

    const first = TaskStore.create({ fileName: 'clip.mp4', filePath: path.join(temp, 'A', 'clip.mp4') });
    const second = TaskStore.create({ fileName: 'clip.mp4', filePath: path.join(temp, 'B', 'clip.mp4') });
    const duplicate = TaskStore.create({ fileName: first.fileName, filePath: first.filePath });
    const a = getProjectArtifactPaths(first);
    const b = getProjectArtifactPaths(second);
    const c = getProjectArtifactPaths(duplicate);
    assert.equal(new Set([a.projectDir, b.projectDir, c.projectDir]).size, 3);
    assert.equal(path.dirname(a.projectDir), exports);
    for (const artifacts of [a, b, c]) {
      for (const key of ['rawSrtPath', 'translatedSrtPath', 'audioWavPath', 'ttsAudioDir', 'ttsMergedAudioPath'] as const) {
        assert.equal(path.dirname(artifacts[key]), artifacts.projectDir);
      }
    }
    fs.mkdirSync(a.ttsAudioDir);
    fs.writeFileSync(path.join(a.ttsAudioDir, 'manifest.json'), 'first-task-audio');
    fs.writeFileSync(a.rawSrtPath, 'first-task-subtitles');
    fs.mkdirSync(b.ttsAudioDir);
    fs.writeFileSync(b.rawSrtPath, 'second-task-subtitles');
    // Simulate regenerating task B; task A's audio and subtitles must survive.
    fs.rmSync(b.ttsAudioDir, { recursive: true });
    assert.equal(fs.readFileSync(path.join(a.ttsAudioDir, 'manifest.json'), 'utf8'), 'first-task-audio');
    assert.equal(fs.readFileSync(a.rawSrtPath, 'utf8'), 'first-task-subtitles');

    // A stale runner snapshot has no projectDir; the saved association wins.
    assert.equal(first.projectDir, undefined);
    SettingsStore.set('exportDir', temp);
    assert.equal(getOrCreateProjectDir(first), a.projectDir);
    assert.equal(getProjectArtifactPaths(TaskStore.getById(first.id)!).projectDir, a.projectDir);

    const legacyDir = path.join(exports, 'legacy_vanhsub');
    fs.mkdirSync(legacyDir);
    fs.writeFileSync(path.join(legacyDir, 'old.srt'), 'legacy-data');
    const legacy = TaskStore.create({ fileName: 'legacy.mp4', filePath: path.join(temp, 'legacy.mp4'), projectDir: legacyDir });
    assert.equal(getOrCreateProjectDir(legacy), legacyDir);
    assert.equal(fs.readFileSync(path.join(legacyDir, 'old.srt'), 'utf8'), 'legacy-data');

    // With no export setting, allocate next to the source; pre-existing folders
    // and files with the preferred name are never adopted or overwritten.
    SettingsStore.set('exportDir', '');
    const preferred = path.join(temp, 'local_vanhsub');
    fs.writeFileSync(preferred, 'existing-file');
    const local = TaskStore.create({ fileName: 'local.mp4', filePath: path.join(temp, 'local.mp4') });
    const localDir = getOrCreateProjectDir(local);
    assert.equal(path.dirname(localDir), temp);
    assert.notEqual(localDir, preferred);
    assert.equal(fs.readFileSync(preferred, 'utf8'), 'existing-file');

    // Both direct-download and yt-dlp completion now use this same finalizer.
    const downloads = path.join(temp, 'downloads');
    fs.mkdirSync(downloads);
    const oldVideo = path.join(downloads, 'same.mp4');
    fs.writeFileSync(oldVideo, 'unrelated-original');
    const oldProject = path.join(downloads, 'same_vanhsub');
    fs.mkdirSync(oldProject);
    fs.writeFileSync(path.join(oldProject, 'same.mp4'), 'old-project-video');
    const results = ['new-video-one', 'new-video-two'].map((content, i) => {
      const temporaryDownload = path.join(downloads, `pending-${i}.mp4`);
      fs.writeFileSync(temporaryDownload, content);
      const progress: number[] = [];
      const result = finalizeDownload(temporaryDownload, 'same', downloads, (p) => progress.push(p.percent));
      assert.deepEqual(progress, [100]);
      assert.equal(fs.readFileSync(result.filePath, 'utf8'), content);
      assert.equal(result.fileName, 'same.mp4');
      assert.equal(result.title, 'same');
      assert.equal(fs.existsSync(temporaryDownload), false);
      return result;
    });
    assert.notEqual(results[0].projectDir, results[1].projectDir);
    assert.equal(fs.readFileSync(oldVideo, 'utf8'), 'unrelated-original');
    assert.equal(fs.readFileSync(path.join(oldProject, 'same.mp4'), 'utf8'), 'old-project-video');
    const downloadedTask = TaskStore.create(results[0]);
    assert.equal(getOrCreateProjectDir(downloadedTask), results[0].projectDir);

    const entriesBeforeFailure = fs.readdirSync(downloads).sort();
    assert.throws(() => finalizeDownload(path.join(downloads, 'missing.mp4'), 'same', downloads));
    assert.deepEqual(fs.readdirSync(downloads).sort(), entriesBeforeFailure, 'Failed move must release only its empty reservation');

    const reservations = Array.from({ length: 12 }, () => createUniqueDirectory(path.join(temp, 'reserved')));
    assert.equal(new Set(reservations).size, reservations.length);
    console.log('PASS: same-name/source task isolation, stable reuse, legacy preservation, download collisions and failed-move cleanup');
  } finally {
    // All test files and stores are confined to this test-created temp directory.
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
