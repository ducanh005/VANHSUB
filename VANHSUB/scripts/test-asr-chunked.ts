/**
 * Smoke-test đường chunked ASR: tạo audio 16 phút (sine tone) → transcribe()
 * phải tự chia 2 chunk, báo progress, gộp SRT và dọn file tạm.
 * Chạy: npx tsx scripts/test-asr-chunked.ts
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { transcribe } from '../main/asr/whisperEngine';

const FFMPEG = (ffmpegInstaller as any).path.replace('app.asar', 'app.asar.unpacked');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-asr-chunk-'));
const WAV = path.join(TMP, 'long_audio.wav');

console.log('1. Tạo audio 16 phút (16kHz mono sine)...');
execFileSync(FFMPEG, [
  '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=960',
  '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', WAV,
], { stdio: 'pipe' });
console.log(`   ${WAV} (${(fs.statSync(WAV).size / 1024 / 1024).toFixed(1)} MB)`);

async function main() {
  console.log('2. transcribe() với model tiny — kỳ vọng 2 chunk, progress 50% → 100%...');
  const progressLog: number[] = [];
  const result = await transcribe(WAV, {
    modelName: 'tiny',
    onProgress: (p) => {
      progressLog.push(p);
      console.log(`   progress: ${p}%`);
    },
    shouldStop: () => false,
  });

  const srtOk = fs.existsSync(result.srtPath);
  const chunksDir = `${WAV}.chunks`;
  const chunksCleaned = !fs.existsSync(chunksDir);

  console.log(`3. Kết quả:`);
  console.log(`   srtPath: ${result.srtPath} (tồn tại: ${srtOk})`);
  console.log(`   chunks dir đã dọn: ${chunksCleaned}`);
  console.log(`   progress log: ${progressLog.join(', ')}`);

  const pass = srtOk && chunksCleaned && progressLog.length >= 2 && progressLog[progressLog.length - 1] === 100;
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(pass ? '\n🎉 PASS — chunked ASR hoạt động' : '\n💥 FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 FAIL:', e);
  process.exit(1);
});
