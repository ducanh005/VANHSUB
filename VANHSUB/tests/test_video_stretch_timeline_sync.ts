import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseSrt, scaleSrtLines } from '../main/lib/srt';

const execFileAsync = promisify(execFile);

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-stretch-sync-'));
  process.env.VANHSUB_SETTINGS_DIR = path.join(dir, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(dir, 'tasks');
  try {
    const { runFfmpeg, computeVideoStretchFactor } = await import('../main/render/dubbingEngine');
    const { getMediaDurationSec, getFfmpegBinPath } = await import('../main/asr/audioExtractor');
    const { TaskStore } = await import('../main/store/taskStore');
    const { DubbingRunner } = await import('../main/render/dubbingRunner');
    const { ExportRunner } = await import('../main/render/exportRunner');
    const source = path.join(dir, 'source.mp4');
    const srt = path.join(dir, 'source.srt');
    const tts = path.join(dir, 'tts');
    fs.mkdirSync(tts);
    const content = '1\n00:00:01,000 --> 00:00:02,000\nLong\n\n2\n00:00:02,000 --> 00:00:03,000\nsentence.\n';
    fs.writeFileSync(srt, content);
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=25:d=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-af', "volume='if(between(t,1,1.5),1,0)':eval=frame",
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', source]);
    const leader = path.join(tts, 'subtitle_0001.mp3');
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=2.35',
      '-c:a', 'libmp3lame', '-y', leader]);
    // A member copy contains the whole sentence, not one subtitle's duration.
    fs.copyFileSync(leader, path.join(tts, 'subtitle_0002.mp3'));
    fs.writeFileSync(path.join(tts, 'manifest.json'), JSON.stringify({
      '1': { isGroupLeader: true, groupIndices: [1, 2], text: 'Long sentence.', sourceTextVerified: true },
      '2': { isGroupMember: true, leaderIndex: 1 },
    }));
    const audioDuration = await getMediaDurationSec(leader);
    const factor = await computeVideoStretchFactor(srt, tts);
    assert.equal(factor, Math.ceil(audioDuration / 2 * 100) / 100);
    assert.ok(factor > 1.1 && factor < 1.25, 'Do not calculate stretch using duplicated member audio');

    async function pcm(file: string, track: number) {
      const { stdout } = await execFileAsync(getFfmpegBinPath(), ['-v', 'error', '-i', file,
        '-map', `0:a:${track}`, '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'], { encoding: 'buffer' });
      return stdout;
    }
    function onset(samples: Buffer, threshold: number) {
      for (let i = 0; i < samples.length / 4; i++) {
        if (Math.abs(samples.readFloatLE(i * 4)) > threshold) return i / 8000;
      }
      return Number.NaN;
    }
    function toneAmplitude(samples: Buffer, frequency: number, from: number, to: number) {
      let real = 0;
      let imaginary = 0;
      const first = Math.round(from * 8000);
      const last = Math.round(to * 8000);
      for (let i = first; i < last; i++) {
        const value = samples.readFloatLE(i * 4);
        real += value * Math.cos(2 * Math.PI * frequency * i / 8000);
        imaginary += value * Math.sin(2 * Math.PI * frequency * i / 8000);
      }
      return 2 * Math.hypot(real, imaginary) / (last - first);
    }
    const sourceOnset = onset(await pcm(source, 0), 0.01);
    const task = TaskStore.create({ fileName: 'source.mp4', filePath: source, srtPath: srt,
      ttsAudioDir: tts, projectDir: dir, status: 'done' });
    for (const mode of ['mono', 'bilingual', 'mix'] as const) {
      const result = await DubbingRunner.runDubbing(task.id, mode !== 'bilingual', undefined,
        { syncMode: 'video-stretch', mixOriginalAudio: mode === 'mix' });
      assert.equal(result?.status, 'done', result?.errorMessage);
      assert.equal(result?.dubbedVideoStretchFactor, factor);
      assert.ok(Math.abs(await getMediaDurationSec(result!.outputPath!) - 4 * factor) < 0.15);
      const voiceTrack = mode === 'bilingual' ? 1 : 0;
      assert.ok(Math.abs(onset(await pcm(result!.outputPath!, voiceTrack), 0.01) - factor) < 0.08,
        `${mode}: TTS must begin at the scaled dialogue time`);
      if (mode === 'bilingual') {
        assert.ok(Math.abs(onset(await pcm(result!.outputPath!, 0), 0.01) - sourceOnset * factor) < 0.1,
          'The original audio track must stretch with its source video');
      }
      if (mode === 'mix') {
        const audio = await pcm(result!.outputPath!, 0);
        assert.ok(toneAmplitude(audio, 440, factor + 0.15, factor + 0.35) > 0.01, 'The stretched background must remain audible');
        assert.ok(toneAmplitude(audio, 880, factor + 0.15, factor + 0.35) > 0.05, 'Mixing must retain voice level');
        assert.ok(toneAmplitude(audio, 440, 1.05, 1.1) < 0.002, 'Background must not start on the unscaled timeline');
      }
    }

    // Test subtitle exports against the stretched video, and original source override.
    const soft = await ExportRunner.runExport(task.id, 'softsub');
    assert.equal(soft?.status, 'done', soft?.errorMessage);
    const { stdout: softText } = await execFileAsync(getFfmpegBinPath(), ['-v', 'error', '-i', soft!.outputPath!,
      '-map', '0:s:0', '-f', 'srt', 'pipe:1']);
    assert.deepEqual(parseSrt(softText).map((l) => [l.startMs, l.endMs]),
      [[1000 * factor, 2000 * factor], [2000 * factor, 3000 * factor]].map((pair) => pair.map(Math.round)));
    const original = await ExportRunner.runExport(task.id, 'softsub', null, undefined, null, { videoSource: 'original' });
    const { stdout: originalText } = await execFileAsync(getFfmpegBinPath(), ['-v', 'error', '-i', original!.outputPath!,
      '-map', '0:s:0', '-f', 'srt', 'pipe:1']);
    assert.deepEqual(parseSrt(originalText).map((l) => [l.startMs, l.endMs]), [[1000, 2000], [2000, 3000]]);

    for (const compileAss of [false, true]) {
      const hard = await ExportRunner.runExport(task.id, 'hardsub', null, undefined, null,
        compileAss ? { perLineStyles: { 0: { fontSize: 24 } } } : undefined);
      assert.equal(hard?.status, 'done', hard?.errorMessage);
      async function hasVisibleSubtitle(time: number) {
        const { stdout } = await execFileAsync(getFfmpegBinPath(), ['-v', 'error', '-ss', String(time),
          '-i', hard!.outputPath!, '-frames:v', '1', '-vf', 'format=gray', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer' });
        return stdout.some((value) => value > 100);
      }
      assert.equal(await hasVisibleSubtitle((1 + factor) / 2), false, 'Subtitle must not appear at the unscaled time');
      assert.equal(await hasVisibleSubtitle(factor + 0.12), true, 'Subtitle must appear with scaled TTS');
    }
    assert.equal(fs.readFileSync(srt, 'utf8'), content, 'Do not rewrite the source subtitle timeline');
    const strictMix = await DubbingRunner.runDubbing(task.id, true, undefined, { syncMode: 'strict', mixOriginalAudio: true });
    assert.equal(strictMix?.status, 'done', strictMix?.errorMessage);
    assert.equal(strictMix?.dubbedVideoStretchFactor, 1);
    assert.ok(Math.abs(await getMediaDurationSec(strictMix!.outputPath!) - 4) < 0.1);
    assert.ok(Math.abs(onset(await pcm(strictMix!.outputPath!, 0), 0.01) - 1) < 0.08);
    TaskStore.update(task.id, { dubbedVideoPath: undefined });
    assert.equal(TaskStore.getById(task.id)?.dubbedVideoStretchFactor, undefined);
    const wordTiming = scaleSrtLines([{ id: 'word', startMs: 100, endMs: 200,
      text: 'Word', words: [{ word: 'Word', startMs: 100, endMs: 200 }] }], 1.25);
    assert.deepEqual(wordTiming[0].words?.map((w) => [w.startMs, w.endMs]), [[125, 250]]);
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=4', '-c:a', 'libmp3lame', '-y', leader]);
    assert.equal(await computeVideoStretchFactor(srt, tts), 1.25, 'Enforce the maximum stretch');
    const conflict = await DubbingRunner.runDubbing(task.id, true, undefined, { syncMode: 'video-stretch' });
    assert.equal(conflict?.status, 'error');
    assert.match(conflict?.errorMessage || '', /Dubbing timing conflict/, 'Reject audio that still cannot fit rather than cutting it');
    console.log('PASS: grouped TTS stretch, audio onsets/duration, mono/bilingual/mix, softsub and SRT/ASS hardsub timing, original-source override');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
