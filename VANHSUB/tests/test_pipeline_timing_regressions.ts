import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fuseOcrAndWhisper } from '../main/asr/hybridFusionEngine';
import { normalizeSrtLines } from '../main/lib/srtNormalizer';
import { validateSubtitleTimeline } from '../main/lib/timelineDiagnostics';
import { parseSrt, parseSrtStrict, serializeSrt, type SrtLine } from '../main/lib/srt';
import { buildSubtitleSegmentsWithStats } from '../main/ocr/subtitleBuilder';
import { dubVideo, mergeAudioFiles, runFfmpeg } from '../main/render/dubbingEngine';
import { segmentWordsToSubtitles } from '../main/asr/wordSegmenter';

const line = (id: string, startMs: number, endMs: number, text: string): SrtLine =>
  ({ id, startMs, endMs, text });

async function main() {
  const shortWords = segmentWordsToSubtitles([
    { word: 'Go.', startMs: 100, endMs: 250 },
    { word: 'Now.', startMs: 270, endMs: 430 },
  ]);
  assert.deepEqual(shortWords.map((s) => s.text), ['Go.', 'Now.']);

  const asr = [line('speech-1', 1000, 1800, 'First sentence.'),
    line('speech-2', 1850, 2500, 'Second sentence.')];
  const ocr = [line('visual-1', 800, 2200, 'First sentence.'),
    line('visual-2', 1700, 2700, 'Second sentence.')];
  const fused = fuseOcrAndWhisper(ocr, asr, { timingSource: 'speech', preserveSpeechOnlyWhisper: true });
  assert.equal(fused.segments.length, 2);
  assert.deepEqual(fused.segments.map((s) => [s.startMs, s.endMs]), [[1000, 1800], [1850, 2500]]);
  assert.deepEqual(fused.segments.map((s) => s.text), ['First sentence.', 'Second sentence.']);
  assert.deepEqual(fused.segments.map((s) => [s.displayStartMs, s.displayEndMs]), [[800, 2200], [1700, 2700]]);

  const phraseFusion = fuseOcrAndWhisper([
    line('visual-a', 800, 1550, 'Hello world'),
    line('visual-b', 1550, 2600, 'How are you'),
  ], [{ ...line('speech-all', 1000, 2400, 'Hello world How are you'), words: [
    { word: 'Hello', startMs: 1000, endMs: 1200 },
    { word: 'world', startMs: 1210, endMs: 1450 },
    { word: 'How', startMs: 1600, endMs: 1780 },
    { word: 'are', startMs: 1790, endMs: 1950 },
    { word: 'you', startMs: 1960, endMs: 2400 },
  ] }], { timingSource: 'speech' });
  assert.deepEqual(phraseFusion.segments.map((s) => [s.startMs, s.endMs]),
    [[1000, 1450], [1600, 2400]]);

  const visualOnly = fuseOcrAndWhisper([line('banner', 0, 900, 'Opening title')], [],
    { timingSource: 'speech' });
  assert.deepEqual(visualOnly.segments.map((s) => [s.startMs, s.endMs]), [[0, 900]]);

  const adjacent = [line('a', 1000, 1500, 'I think'), line('b', 1550, 2000, 'we should go.')];
  const preserved = normalizeSrtLines(adjacent, { preserveEvidenceTiming: true });
  assert.deepEqual(preserved.lines.map((s) => s.id), ['a', 'b']);
  assert.deepEqual(preserved.lines.map((s) => [s.startMs, s.endMs]), [[1000, 1500], [1550, 2000]]);

  const frames = Array.from({ length: 301 }, (_, i) => ({
    text: i >= 297 ? 'Another event' : 'Persistent subtitle', confidence: 95,
    lines: [{ text: i >= 297 ? 'Another event' : 'Persistent subtitle', confidence: 95, y0: 800 }],
  }));
  const ocrBuilt = buildSubtitleSegmentsWithStats(frames, 1000 / 3).segments;
  assert.equal(ocrBuilt.length, 2);
  assert.equal(ocrBuilt[0].startMs, 0);
  assert.equal(ocrBuilt[1].startMs, 99000);
  assert.ok(Math.abs(ocrBuilt[0].endMs - 99000) <= 1);

  const roundTrip = parseSrt(serializeSrt([line('x', 3600123, 3602456, 'One'),
    line('y', 3602457, 3603999, 'Two')]));
  assert.deepEqual(roundTrip.map((s) => [s.startMs, s.endMs]),
    [[3600123, 3602456], [3602457, 3603999]]);
  assert.throws(() => parseSrtStrict('1\n00:00:01,000 --> bad\nBroken\n'), /Malformed SRT/);
  assert.throws(() => parseSrtStrict('1\n00:00:02,000 --> 00:00:01,000\nBackward\n'), /Malformed SRT timestamp/);
  assert.equal(validateSubtitleTimeline([line('bad', Number.NaN, 0, 'Bad')])[0].code, 'invalid_time');
  assert.ok(validateSubtitleTimeline([line('same', 0, 100, 'A'), line('same', 200, 300, 'B')])
    .some((issue) => issue.code === 'duplicate_id'));
  assert.ok(validateSubtitleTimeline([{ ...line('merged', 0, 1000, 'Two voices'), words: [
    { word: 'One', startMs: 0, endMs: 200, speaker: 'A' },
    { word: 'Two', startMs: 300, endMs: 500, speaker: 'B' },
  ] }]).some((issue) => issue.code === 'merged_speakers'));
  assert.ok(validateSubtitleTimeline([
    { ...line('h1', 0, 1000, 'One'), source: 'hybrid', speechStartMs: 0, displayStartMs: 0 },
    { ...line('h2', 3000, 4000, 'Two'), source: 'hybrid', speechStartMs: 3800, displayStartMs: 3000 },
  ]).some((issue) => issue.code === 'offset_drift'));
  assert.equal(validateSubtitleTimeline([line('a', 0, 1000, 'A'), line('b', 0, 1000, 'A')])
    .some((issue) => issue.code === 'duplicate'), true);
  assert.equal(validateSubtitleTimeline([line('a', 0, 1000, 'A'), line('b', 500, 1500, 'B')])[0].code, 'overlap');
  assert.equal(validateSubtitleTimeline([
    { ...line('a', 0, 1000, 'A'), speaker: 'SPEAKER_00' },
    { ...line('b', 500, 1500, 'B'), speaker: 'SPEAKER_01' },
  ]).length, 0, 'Intentional simultaneous speakers are preserved as evidence');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-timing-'));
  try {
    const ttsDir = path.join(dir, 'tts');
    fs.mkdirSync(ttsDir);
    const srt = path.join(dir, 'source.srt');
    fs.writeFileSync(srt, serializeSrt([line('one', 1000, 1800, 'One.'),
      line('two', 2500, 3300, 'Two.')]), 'utf8');
    for (const [n, duration] of [[1, 0.6], [2, 0.6]] as const) {
      await runFfmpeg(['-f', 'lavfi', '-i', `sine=frequency=${n === 1 ? 440 : 660}:duration=${duration}`,
        '-c:a', 'libmp3lame', '-y', path.join(ttsDir, `subtitle_${String(n).padStart(4, '0')}.mp3`)]);
    }
    const output = path.join(dir, 'dub.mp3');
    await mergeAudioFiles(srt, ttsDir, output, undefined, { mode: 'flexible' });
    assert.ok(fs.existsSync(output));
    const pcm = path.join(dir, 'decoded.f32');
    await runFfmpeg(['-i', output, '-f', 'f32le', '-ar', '8000', '-ac', '1', '-y', pcm]);
    const samples = fs.readFileSync(pcm);
    const active = (fromMs: number, toMs: number) => {
      let peak = 0;
      for (let i = Math.round(fromMs * 8); i < Math.round(toMs * 8); i++) {
        peak = Math.max(peak, Math.abs(samples.readFloatLE(i * 4)));
      }
      return peak;
    };
    assert.ok(active(0, 900) < 0.002, 'No early voice before 1.0 s');
    assert.ok(active(1050, 1500) > 0.01, 'First voice starts in its source slot');
    assert.ok(active(2000, 2400) < 0.002, 'No carried over voice before second turn');
    assert.ok(active(2550, 3000) > 0.01, 'Second voice starts in its source slot');
    const manifestPath = path.join(ttsDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      '1': { text: 'Stale translation.', sourceTextVerified: true },
    }));
    await assert.rejects(() => mergeAudioFiles(srt, ttsDir, path.join(dir, 'stale.mp3')),
      /TTS manifest text differs/);
    fs.unlinkSync(manifestPath);

    const sourceVideo = path.join(dir, 'synthetic.mp4');
    const dubbedVideo = path.join(dir, 'dubbed.mp4');
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=25:d=4.5',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '4.5',
      '-c:v', 'mpeg4', '-c:a', 'aac', '-y', sourceVideo]);
    await dubVideo(sourceVideo, srt, ttsDir, dubbedVideo, { syncMode: 'strict' });
    assert.ok(fs.statSync(dubbedVideo).size > 0, 'Synthetic video dub rendered');
    const dubbedPcm = path.join(dir, 'dubbed.f32');
    await runFfmpeg(['-i', dubbedVideo, '-map', '0:a:0', '-f', 'f32le',
      '-ar', '8000', '-ac', '1', '-y', dubbedPcm]);
    const renderedSamples = fs.readFileSync(dubbedPcm);
    const renderedPeak = (fromMs: number, toMs: number) => {
      let peak = 0;
      for (let i = Math.round(fromMs * 8); i < Math.round(toMs * 8); i++) {
        peak = Math.max(peak, Math.abs(renderedSamples.readFloatLE(i * 4)));
      }
      return peak;
    };
    assert.ok(renderedPeak(0, 900) < 0.002);
    assert.ok(renderedPeak(1050, 1500) > 0.01);
    assert.ok(renderedPeak(2000, 2400) < 0.002);
    assert.ok(renderedPeak(2550, 3000) > 0.01);
    const firstOnset = (fromMs: number, toMs: number) => {
      for (let i = Math.round(fromMs * 8); i < Math.round(toMs * 8); i++) {
        if (Math.abs(renderedSamples.readFloatLE(i * 4)) > 0.01) return Math.round(i / 8);
      }
      return Number.NaN;
    };
    const measured = [firstOnset(900, 1800), firstOnset(2400, 3400)];
    assert.ok(Math.abs(measured[0] - 1000) <= 100);
    assert.ok(Math.abs(measured[1] - 2500) <= 100);
    console.log(`Synthetic rendered onset error: ${measured[0] - 1000} ms, ${measured[1] - 2500} ms`);

    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-c:a', 'libmp3lame', '-y', path.join(ttsDir, 'subtitle_0001.mp3')]);
    await assert.rejects(() => mergeAudioFiles(srt, ttsDir, path.join(dir, 'conflict.mp3')),
      /Dubbing timing conflict at subtitle 1/);
    const slightSrt = path.join(dir, 'slight.srt');
    fs.writeFileSync(slightSrt, serializeSrt([line('one', 0, 1000, 'One.'),
      line('two', 1000, 2000, 'Two.')]), 'utf8');
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.04',
      '-c:a', 'libmp3lame', '-y', path.join(ttsDir, 'subtitle_0001.mp3')]);
    const slight = await mergeAudioFiles(slightSrt, ttsDir, path.join(dir, 'slight.mp3'));
    assert.ok(slight.overruns.some((item) => item.index === 1 && item.tempo > 1),
      'Even a small overrun is stretched instead of cut by the fixed output segment');
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=660:duration=1.4',
      '-c:a', 'libmp3lame', '-y', path.join(ttsDir, 'subtitle_0002.mp3')]);
    await assert.rejects(() => mergeAudioFiles(slightSrt, ttsDir, path.join(dir, 'last-conflict.mp3'),
      undefined, { mediaDurationMs: 5000, maxTempo: 1.35 }),
    /Dubbing timing conflict at subtitle 2/,
    'The final utterance cannot borrow unused media after its source dialogue end');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('PASS pipeline timing regressions (deterministic fixtures and generated audio)');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
