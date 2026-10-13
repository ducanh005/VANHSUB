import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'fluent-ffmpeg';
import { burnHardsub, muxSoftsub, type ExportFormatOptions } from '../main/render/videoRenderer';

function probe(file: string): Promise<ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => ffmpeg.ffprobe(file, (err, data) => err ? reject(err) : resolve(data)));
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-export-regression-'));
  try {
    const subtitle = path.join(dir, 'subtitle.srt');
    fs.writeFileSync(subtitle, '1\n00:00:00,000 --> 00:00:00,800\nExport regression.\n');
    for (const withAudio of [false, true]) {
      const source = path.join(dir, `source-${withAudio}.mp4`);
      await new Promise<void>((resolve, reject) => {
        const command = ffmpeg().input('color=c=blue:s=320x180:r=10:d=1').inputFormat('lavfi');
        if (withAudio) command.input('sine=frequency=440:duration=1').inputFormat('lavfi').audioCodec('aac');
        else command.noAudio();
        command.videoCodec('libx264').outputOptions('-pix_fmt yuv420p')
          .output(source).on('end', () => resolve()).on('error', reject).run();
      });

      const softsub = path.join(dir, `softsub-${withAudio}.mp4`);
      await muxSoftsub({ videoPath: source, srtPath: subtitle, outputPath: softsub });
      const streams = (await probe(softsub)).streams;
      assert.equal(streams.filter((s) => s.codec_type === 'video').length, 1);
      assert.equal(streams.filter((s) => s.codec_type === 'audio').length, withAudio ? 1 : 0);
      assert.equal(streams.find((s) => s.codec_type === 'subtitle')?.codec_name, 'mov_text');

      if (!withAudio) continue;
      const cases: Array<{ options: ExportFormatOptions; size: [number, number] }> = [
        { options: { resolution: 'original' }, size: [320, 180] },
        { options: { resolution: '480p' }, size: [854, 480] },
        { options: { aspectRatio: '9:16', resolution: '720p' }, size: [720, 1280] },
        { options: { aspectRatio: '1:1', resolution: '480p' }, size: [480, 480] },
        { options: { aspectRatio: '16:9', resolution: '1080p', speed: 1.25, mirrorHorizontal: true }, size: [1920, 1080] },
      ];
      for (const [index, test] of cases.entries()) {
        const output = path.join(dir, `hardsub-${index}.mp4`);
        await burnHardsub({ videoPath: source, srtPath: subtitle, outputPath: output, formatOptions: test.options });
        const data = await probe(output);
        const video = data.streams.find((s) => s.codec_type === 'video')!;
        assert.deepEqual([video.width, video.height], test.size, JSON.stringify(test.options));
        assert.ok(data.streams.some((s) => s.codec_type === 'audio'));
        assert.ok(Math.abs(Number(data.format.duration) - 1 / (test.options.speed || 1)) < 0.3);
      }
    }
    console.log('PASS: real FFmpeg exports — 5 resolution/aspect/speed cases and softsub with/without audio');
  } finally {
    // dir is a unique directory created by this test beneath the OS temp folder.
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
