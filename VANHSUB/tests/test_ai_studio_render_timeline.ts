import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { AiStudioVideoAssembler } from '../main/ai-studio/services/AiStudioVideoAssembler';
import { DEFAULT_AI_STUDIO_CONFIG, type StoryboardScene } from '../main/ai-studio/types';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-studio-render-'));
  const ffmpegPath = (ffmpegInstaller as any).path;
  const ffprobePath = (ffprobeInstaller as any).path;
  const run = (args: string[]) => {
    const result = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    assert.equal(result.status, 0, result.stderr.toString());
    return result.stdout;
  };
  const probe = (file: string) => {
    const result = spawnSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
    assert.equal(result.status, 0, result.stderr.toString());
    return JSON.parse(result.stdout.toString());
  };
  try {
    const assembler = new AiStudioVideoAssembler();
    assert.deepEqual(assembler.getDimensions('16:9', '4k'), { width: 3840, height: 2160 });
    assert.deepEqual(assembler.getDimensions('9:16', '4k'), { width: 2160, height: 3840 });
    assert.deepEqual(assembler.getDimensions('1:1', '4k'), { width: 2160, height: 2160 });
    const voice = path.join(root, 'voice.mp3');
    run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'libmp3lame', voice]);
    const red = path.join(root, 'red.png'), green = path.join(root, 'green.png'), blue = path.join(root, 'blue.mp4');
    for (const [color, out] of [['red', red], ['lime', green]]) {
      run(['-f', 'lavfi', '-i', `color=c=${color}:s=320x180`, '-frames:v', '1', out]);
    }
    run(['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25:d=0.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', blue]);
    const makeScene = (asset: string, i: number, startMs: number, durationMs: number): StoryboardScene => ({
      id: `scene_${i}`, lineIndex: i, startMs, endMs: startMs + durationMs, durationMs,
      lineText: 'test', visualPrompt: 'test', motionType: asset.endsWith('.mp4') ? 'video' : 'ken_burns', assetPath: asset, status: 'ready',
      fillMode: asset.endsWith('.mp4') ? 'freeze_last_frame' : undefined,
    });
    const mixed = path.join(root, 'mixed.mp4');
    await assert.rejects(() => assembler.assembleVideo({
      scenes: [{ ...makeScene(blue, 0, 0, 4000), fillMode: 'none' }], voiceoverAudioPath: voice, outputPath: mixed,
      renderingConfig: DEFAULT_AI_STUDIO_CONFIG.rendering, subtitleConfig: DEFAULT_AI_STUDIO_CONFIG.subtitles,
    }), /TIMELINE|ngắn hơn/);
    await assembler.assembleVideo({
      scenes: [makeScene(red, 0, 0, 1000), makeScene(green, 1, 1000, 1000), makeScene(blue, 2, 2000, 2000)],
      voiceoverAudioPath: voice, outputPath: mixed,
      renderingConfig: { ...DEFAULT_AI_STUDIO_CONFIG.rendering, resolution: '720p', fps: 30, kenBurnsEffect: true },
      subtitleConfig: { ...DEFAULT_AI_STUDIO_CONFIG.subtitles, enabled: false }, aspectRatio: '16:9',
    });
    const video = probe(mixed);
    assert.equal(video.streams.find((s: any) => s.codec_type === 'video').r_frame_rate, '30/1');
    assert.ok(Math.abs(Number(video.format.duration) - Number(probe(voice).format.duration)) < 0.15);
    // Sampling the actual rendered sequence catches Ken Burns expanding every looped input frame.
    for (const [time, channel] of [[0.5, 0], [1.5, 1], [3.7, 2]]) {
      const pixel = run(['-ss', String(time), '-i', mixed, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
      assert.ok(pixel[channel] > 180 && pixel[(channel + 1) % 3] < 60 && pixel[(channel + 2) % 3] < 60, `Wrong scene at ${time}s: ${[...pixel]}`);
    }
    const tail = run(['-ss', '3.65', '-i', mixed, '-t', '0.2', '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1']);
    let peak = 0;
    for (let i = 0; i + 4 <= tail.length; i += 4) peak = Math.max(peak, Math.abs(tail.readFloatLE(i)));
    assert.ok(tail.length > 3000 && peak > 0.05, 'Narration near the end must remain audible');

    const portrait = path.join(root, 'portrait60.mp4');
    await assembler.assembleVideo({
      scenes: [makeScene(blue, 0, 0, 4000)], voiceoverAudioPath: voice, outputPath: portrait,
      renderingConfig: { ...DEFAULT_AI_STUDIO_CONFIG.rendering, resolution: '720p', fps: 60 },
      subtitleConfig: { ...DEFAULT_AI_STUDIO_CONFIG.subtitles, enabled: false }, aspectRatio: '9:16',
    });
    const portraitProbe = probe(portrait);
    const stream = portraitProbe.streams.find((s: any) => s.codec_type === 'video');
    assert.equal(stream.width, 720);
    assert.equal(stream.height, 1280);
    assert.equal(stream.r_frame_rate, '60/1');
    assert.ok(Number(portraitProbe.format.duration) > 4);
    assert.ok(Number(portraitProbe.streams.find((s: any) => s.codec_type === 'audio').duration) > 3.9);
    const stills = path.join(root, 'stills_without_motion.mp4');
    await assembler.assembleVideo({
      scenes: [makeScene(red, 0, 0, 1000), makeScene(green, 1, 1000, 3000)], voiceoverAudioPath: voice, outputPath: stills,
      renderingConfig: { ...DEFAULT_AI_STUDIO_CONFIG.rendering, resolution: '720p', fps: 30, kenBurnsEffect: false },
      subtitleConfig: { ...DEFAULT_AI_STUDIO_CONFIG.subtitles, enabled: false }, aspectRatio: '16:9',
    });
    const stillPixel = run(['-ss', '1.5', '-i', stills, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
    assert.ok(stillPixel[1] > 180 && stillPixel[0] < 60 && stillPixel[2] < 60);
    const shortVoice = path.join(root, 'short_voice.wav');
    run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.15', shortVoice]);
    const ultraHd = path.join(root, '4k.mp4');
    await assembler.assembleVideo({
      scenes: [makeScene(blue, 0, 0, 500)], voiceoverAudioPath: shortVoice, outputPath: ultraHd,
      renderingConfig: { ...DEFAULT_AI_STUDIO_CONFIG.rendering, resolution: '4k', fps: 30 },
      subtitleConfig: { ...DEFAULT_AI_STUDIO_CONFIG.subtitles, enabled: false }, aspectRatio: '16:9',
    });
    const ultraStream = probe(ultraHd).streams.find((s: any) => s.codec_type === 'video');
    assert.equal(ultraStream.width, 3840);
    assert.equal(ultraStream.height, 2160);
    run(['-i', mixed, '-f', 'null', '-']);
    run(['-i', portrait, '-f', 'null', '-']);
    console.log('PASS: real FFmpeg multi-scene timing, explicit frozen short clips, mismatch rejection, audible narration tail, 30/60fps, portrait and actual 4K export');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
