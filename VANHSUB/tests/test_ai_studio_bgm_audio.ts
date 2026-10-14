import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { AiStudioVideoAssembler } from '../main/ai-studio/services/AiStudioVideoAssembler';
import { DEFAULT_AI_STUDIO_CONFIG } from '../main/ai-studio/types';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bgm-audio-'));
  const run = (args: string[]) => {
    const result = spawnSync(ffmpegInstaller.path, ['-v', 'error', '-y', ...args], { windowsHide: true });
    assert.equal(result.status, 0, result.stderr.toString()); return result.stdout;
  };
  try {
    const image = path.join(root, 'image.png'), voice = path.join(root, 'voice.wav'), bgm = path.join(root, 'music.wav'), sfx = path.join(root, 'sfx.wav');
    run(['-f', 'lavfi', '-i', 'color=blue:s=64x64', '-frames:v', '1', image]);
    run(['-f', 'lavfi', '-i', 'sine=frequency=400:sample_rate=16000:duration=2', voice]);
    run(['-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=16000:duration=0.3', bgm]);
    run(['-f', 'lavfi', '-i', 'sine=frequency=1600:sample_rate=16000:duration=0.1', sfx]);
    const assembler = new AiStudioVideoAssembler();
    // Keep this audio regression cheap while running the real assembly graph.
    assembler.getDimensions = () => ({ width: 64, height: 64 });
    const render = async (name: string, volume: number, music?: string, ducking = false, effect?: string) => {
      const output = path.join(root, `${name}.mp4`);
      await assembler.assembleVideo({ scenes: [{ id: 'scene', lineIndex: 0, startMs: 0, endMs: 2000, durationMs: effect ? 1000 : 2000, lineText: 'Test', visualPrompt: 'Test', motionType: 'ken_burns', status: 'ready', assetPath: image }, ...(effect ? [{ id: 'scene2', lineIndex: 1, startMs: 1000, endMs: 2000, durationMs: 1000, lineText: 'Test', visualPrompt: 'Test', motionType: 'ken_burns' as const, status: 'ready' as const, assetPath: image }] : [])],
        voiceoverAudioPath: voice, outputPath: output, transitionSfxPath: effect, enableTransitionSfx: Boolean(effect),
        renderingConfig: { ...DEFAULT_AI_STUDIO_CONFIG.rendering, kenBurnsEffect: false, bgmVolume: volume, defaultBgmPath: music, autoAudioDucking: ducking },
        subtitleConfig: { ...DEFAULT_AI_STUDIO_CONFIG.subtitles, enabled: false } });
      return output;
    };
    const baseline = await render('baseline', 0);
    const muted = await render('muted', 0, bgm);
    const mixed = await render('mixed', 0.3, bgm);
    const ducked = await render('ducked', 0.3, bgm, true);
    const withEffect = await render('sfx', 0.3, bgm, true, sfx);
    const strength = (file: string, frequency: number, at = 1.5) => {
      const pcm = run(['-ss', String(at), '-i', file, '-t', '0.2', '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1']);
      let real = 0, imaginary = 0, count = 0;
      for (let index = 0; index + 4 <= pcm.length; index += 4) {
        const sample = pcm.readFloatLE(index), angle = 2 * Math.PI * frequency * count / 16000;
        real += sample * Math.cos(angle); imaginary += sample * Math.sin(angle); count++;
      }
      return Math.hypot(real, imaginary) * 2 / count;
    };
    const baselineVoice = strength(baseline, 400), mutedVoice = strength(muted, 400);
    assert.ok(Math.abs(baselineVoice - mutedVoice) < 0.005, '0% BGM must preserve voice level');
    assert.ok(strength(muted, 1000) < 0.003, '0% must not become 12%');
    assert.ok(strength(mixed, 1000) > 0.02, 'A 0.3s BGM must remain audible at 1.5s via loop');
    assert.ok(Math.abs(strength(mixed, 400) - baselineVoice) < 0.01, 'amix must not halve narration');
    assert.ok(strength(ducked, 1000) < strength(mixed, 1000), 'Ducking lowers BGM during narration');
    assert.ok(Math.abs(strength(withEffect, 400) - baselineVoice) < 0.01, 'Short SFX must not double voice level after it ends');
    await assert.rejects(() => render('missing', 0.2, path.join(root, 'missing.mp3')), /Không tìm thấy/);
    await assert.rejects(() => render('invalid', -1, bgm), /Âm lượng/);
    console.log('PASS: real rendered audio spectrum verifies muted BGM, looped short track, narration level, ducking and config errors');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
