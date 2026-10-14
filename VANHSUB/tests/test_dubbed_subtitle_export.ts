import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'fluent-ffmpeg';

const execFileAsync = promisify(execFile);
function probe(file: string): Promise<ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => ffmpeg.ffprobe(file, (err, data) => err ? reject(err) : resolve(data)));
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-dub-export-'));
  process.env.VANHSUB_SETTINGS_DIR = path.join(dir, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(dir, 'tasks');
  try {
    const { TaskStore } = await import('../main/store/taskStore');
    const { DubbingRunner } = await import('../main/render/dubbingRunner');
    const { ExportRunner } = await import('../main/render/exportRunner');
    const { runFfmpeg } = await import('../main/render/dubbingEngine');
    const { getFfmpegBinPath } = await import('../main/asr/audioExtractor');
    const source = path.join(dir, 'original.mp4');
    const srt = path.join(dir, 'subtitle.srt');
    const ttsDir = path.join(dir, 'tts');
    fs.mkdirSync(ttsDir);
    fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:00,800\nTest voice.\n');
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25:d=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', source]);
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.6',
      '-c:a', 'libmp3lame', '-y', path.join(ttsDir, 'subtitle_0001.mp3')]);

    // Decode output audio to distinguish the original 440Hz track from 880Hz TTS.
    async function expectTone(file: string, track: number, frequency: number) {
      const { stdout } = await execFileAsync(getFfmpegBinPath(), [
        '-v', 'error', '-i', file, '-ss', '0.1', '-t', '0.25',
        '-map', `0:a:${track}`, '-ac', '1', '-ar', '24000', '-f', 'f32le', 'pipe:1',
      ], { encoding: 'buffer' });
      const samples = stdout.length / 4;
      let crossings = 0;
      let energy = 0;
      let previous = 0;
      for (let index = 0; index < samples; index++) {
        const current = stdout.readFloatLE(index * 4);
        if (previous <= 0 && current > 0) crossings++;
        energy += current * current;
        previous = current;
      }
      assert.ok(Math.sqrt(energy / samples) > 0.02, 'Expected audible output');
      assert.ok(Math.abs(crossings / (samples / 24000) - frequency) < 20,
        `Expected ${frequency}Hz in audio track ${track} of ${path.basename(file)}`);
    }

    const task = TaskStore.create({ fileName: 'original.mp4', filePath: source,
      srtPath: srt, ttsAudioDir: ttsDir, projectDir: dir, status: 'done' });
    const mono = await DubbingRunner.runDubbing(task.id, true);
    assert.equal(mono?.status, 'done', mono?.errorMessage);
    const monoPath = mono!.dubbedVideoPath!;
    assert.equal(monoPath, mono!.outputPath);
    await expectTone(monoPath, 0, 880);

    // Repeated exports must keep referring to the dub rather than the last export.
    for (const mode of ['hardsub', 'softsub', 'hardsub'] as const) {
      const result = await ExportRunner.runExport(task.id, mode);
      assert.equal(result?.status, 'done', result?.errorMessage);
      assert.equal(result?.dubbedVideoPath, monoPath);
      assert.notEqual(result?.outputPath, monoPath);
      await expectTone(result!.outputPath!, 0, 880);
      if (mode === 'softsub') {
        assert.ok((await probe(result!.outputPath!)).streams.some((s) => s.codec_name === 'mov_text'));
      }
    }
    const originalExport = await ExportRunner.runExport(task.id, 'softsub', null, undefined, null, { videoSource: 'original' });
    assert.equal(originalExport?.status, 'done', originalExport?.errorMessage);
    assert.equal(originalExport?.dubbedVideoPath, monoPath);
    await expectTone(originalExport!.outputPath!, 0, 440);

    const bilingual = await DubbingRunner.runDubbing(task.id, false);
    assert.equal(bilingual?.status, 'done', bilingual?.errorMessage);
    const bilingualPath = bilingual!.dubbedVideoPath!;
    assert.notEqual(bilingualPath, monoPath);
    for (const [mode, speed] of [['softsub', 1], ['hardsub', 1], ['hardsub', 1.25]] as const) {
      const result = await ExportRunner.runExport(task.id, mode, null, undefined, null, { formatOptions: { speed } });
      assert.equal(result?.status, 'done', result?.errorMessage);
      const data = await probe(result!.outputPath!);
      assert.equal(data.streams.filter((s) => s.codec_type === 'audio').length, 2);
      await expectTone(result!.outputPath!, 0, 440);
      await expectTone(result!.outputPath!, 1, 880);
      assert.ok(Math.abs(Number(data.format.duration) - 2 / speed) < 0.25);
      assert.equal(result?.dubbedVideoPath, bilingualPath);
    }

    TaskStore.update(task.id, { dubbedVideoPath: path.join(dir, 'missing-dub.mp4') });
    const failed = await ExportRunner.runExport(task.id, 'softsub');
    assert.equal(failed?.status, 'error');
    assert.match(failed?.errorMessage || '', /Không tìm thấy video đã lồng tiếng/);
    assert.equal(ExportRunner.isRunning(task.id), false);
    const recovery = await ExportRunner.runExport(task.id, 'softsub', null, undefined, null, { videoSource: 'original' });
    assert.equal(recovery?.status, 'done', recovery?.errorMessage);
    await expectTone(recovery!.outputPath!, 0, 440);

    // Existing pipeline invalidation must also invalidate the saved dub.
    TaskStore.update(task.id, { outputPath: undefined });
    assert.equal(TaskStore.getById(task.id)?.dubbedVideoPath, undefined);
    const fresh = await ExportRunner.runExport(task.id, 'softsub');
    assert.equal(fresh?.status, 'done', fresh?.errorMessage);
    await expectTone(fresh!.outputPath!, 0, 440);
    console.log('PASS: dub -> repeated subtitle exports, source override, both bilingual tracks with speed, missing-source recovery and invalidation');
  } finally {
    // All generated media and stores belong to this unique test directory.
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
