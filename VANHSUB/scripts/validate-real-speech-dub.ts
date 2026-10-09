import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serializeSrt } from '../main/lib/srt';
import { getMediaDurationSec } from '../main/asr/audioExtractor';
import { generateTtsFromSrt } from '../main/render/ttsEngine';
import { mergeAudioFiles, runFfmpeg } from '../main/render/dubbingEngine';

async function audibleRangeMs(audioPath: string, dir: string, name: string): Promise<{ first: number; last: number }> {
  const pcmPath = path.join(dir, `${name}.f32`);
  await runFfmpeg(['-i', audioPath, '-f', 'f32le', '-ar', '8000', '-ac', '1', '-y', pcmPath]);
  const samples = fs.readFileSync(pcmPath);
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples.length / 4; i++) {
    if (Math.abs(samples.readFloatLE(i * 4)) > 0.01) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) throw new Error(`${name} has no audible samples`);
  return { first: Math.round(first / 8), last: Math.round(last / 8) };
}

async function main() {
  const source = path.join(process.cwd(), 'node_modules/nodejs-whisper/cpp/whisper.cpp/bindings/go/samples/jfk.wav');
  const slotMs = process.argv.includes('--stress') ? 6000 : 10520;
  if (!fs.existsSync(source)) throw new Error('Bundled JFK audio sample unavailable');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-real-speech-'));
  try {
    const srtPath = path.join(dir, 'jfk_vi.srt');
    fs.writeFileSync(srtPath, serializeSrt([{ id: 'jfk', startMs: 0, endMs: slotMs,
      text: 'Hỡi đồng bào Mỹ, đừng hỏi đất nước có thể làm gì cho bạn. Hãy hỏi bạn có thể làm gì cho đất nước.' }]), 'utf8');
    const ttsDir = path.join(dir, 'tts');
    await generateTtsFromSrt(srtPath, ttsDir,
      { engine: 'edge', voice: 'vi-VN-NamMinhNeural', speed: 1 });
    const output = path.join(dir, 'dub.mp3');
    const merged = await mergeAudioFiles(srtPath, ttsDir, output, undefined,
      { mode: 'strict', mediaDurationMs: 11000, maxTempo: 1.35 });
    const sourceRange = await audibleRangeMs(source, dir, 'source');
    const dubRange = await audibleRangeMs(output, dir, 'dub');
    const manifest = JSON.parse(fs.readFileSync(path.join(ttsDir, 'manifest.json'), 'utf8'));
    console.log(JSON.stringify({ sourceDurationMs: Math.round(await getMediaDurationSec(source) * 1000), slotMs,
      sourceOnsetMs: sourceRange.first, dubOnsetMs: dubRange.first,
      dubLastAudibleMs: dubRange.last, onsetDifferenceMs: dubRange.first - sourceRange.first,
      dubDurationMs: Math.round(await getMediaDurationSec(output) * 1000),
      overruns: merged.overruns, timing: manifest['1'] }, null, 2));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
