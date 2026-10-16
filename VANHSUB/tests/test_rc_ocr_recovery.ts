import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-ocr-regression-'));
  const tmpdir = os.tmpdir; os.tmpdir = () => root;
  process.env.VANHSUB_TASKS_DIR = path.join(root, 'tasks'); process.env.VANHSUB_SETTINGS_DIR = path.join(root, 'settings');
  const { TaskStore } = await import('../main/store/taskStore');
  const { SettingsStore } = await import('../main/store/settingsStore');
  const { OcrRunner } = await import('../main/ocr/ocrRunner');
  const { extractFrames, cleanupFrames } = await import('../main/ocr/frameExtractor');
  try {
    const video = path.join(root, 'Video kiểm thử.mp4');
    execFileSync(ffmpeg.path, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=5:d=180', '-c:v', 'libx264', '-preset', 'ultrafast', video], { windowsHide: true });
    const invalid = path.join(root, 'Video hỏng.mp4'); fs.writeFileSync(invalid, 'invalid video');
    const python = path.join(root, 'Missing Python.exe'); fs.writeFileSync(python, 'controlled non-executable dependency fixture'); SettingsStore.set('pythonPath', python);
    const paths = (label: string) => {
      const folder = path.join(root, label); fs.mkdirSync(folder);
      const cache = path.join(folder, 'tts'); fs.mkdirSync(cache); fs.writeFileSync(path.join(cache, '1.mp3'), 'completed line bytes');
      const values = { srtPath: path.join(folder, 'old.srt'), translatedSrtPath: path.join(folder, 'translated.srt'), ttsAudioDir: cache, ttsMergedAudioPath: path.join(folder, 'merged.mp3'), outputPath: path.join(folder, 'old.mp4'), dubbedVideoPath: path.join(folder, 'dubbed.mp4') };
      for (const [key, file] of Object.entries(values)) if (key !== 'ttsAudioDir') fs.writeFileSync(file, key.endsWith('SrtPath') || key === 'srtPath' ? '1\n00:00:00,000 --> 00:00:01,000\nHELLO\n' : 'completed output bytes');
      return { folder, values };
    };
    for (const [label, input] of [['missing-python', video], ['invalid-video', invalid]]) {
      const { folder, values } = paths(label);
      const task = TaskStore.create({ fileName: path.basename(input), filePath: input, projectDir: folder });
      TaskStore.update(task.id, { ...values, subtitleRevision: 3, ttsNeedsRegeneration: false });
      // Stop frame extraction early in the missing-runtime case by using the 2s fixture below.
      const fixture = path.join(root, label + '-short.mp4');
      if (label === 'missing-python') { execFileSync(ffmpeg.path, ['-v', 'error', '-i', video, '-t', '2', '-c', 'copy', fixture], { windowsHide: true }); TaskStore.update(task.id, { filePath: fixture }); }
      const result = await OcrRunner.runOcr(task.id, { dualEngine: false, fps: 0.5 });
      assert.equal(result?.status, 'error');
      for (const [key, file] of Object.entries(values)) { assert.equal((result as any)[key], file, key + ' survives failed OCR'); assert.ok(fs.existsSync(file)); }
      assert.equal(fs.readFileSync(path.join(values.ttsAudioDir, '1.mp3'), 'utf8'), 'completed line bytes');
      assert.equal(result?.subtitleRevision, 3); assert.equal(result?.ttsNeedsRegeneration, false); assert.equal(OcrRunner.isRunning(task.id), false);
      assert.equal(fs.readdirSync(root).filter(name => name.startsWith('vanhsub-ocr-')).length, 0, 'Failed extraction cleans its own directory');
    }
    await assert.rejects(() => extractFrames(video, 5, 'full', null, undefined, () => true), /Đã huỷ/);
    let cancelled = false, sawNativeProgress = false;
    await assert.rejects(() => extractFrames(video, 5, 'full', null, () => { sawNativeProgress = true; cancelled = true; }, () => cancelled), /Đã huỷ/);
    assert.ok(sawNativeProgress, 'Cancellation follows real FFmpeg progress');
    assert.equal(fs.readdirSync(root).filter(name => name.startsWith('vanhsub-ocr-')).length, 0, 'Cancelled extraction cleans partial PNGs');
    const rerun = await extractFrames(path.join(root, 'missing-python-short.mp4'), 3, 'full');
    assert.equal(rerun.frameIntervalMs, 1000 / 3); assert.ok(rerun.framePaths.length > 0); cleanupFrames(rerun.framesDir);
    console.log('PASS: actual FFmpeg/Python-launch failures retain all last-good OCR/TTS/video artifacts; cancelled extraction cleans partial frames and permits rerun');
  } finally { os.tmpdir = tmpdir; fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
