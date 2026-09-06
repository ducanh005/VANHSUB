/**
 * Test OCR phụ đề cứng: tạo video test có 2 dòng chữ đổi nhau theo thời gian,
 * chạy pipeline trích khung → OCR → ghép dòng phụ đề → so sánh file .srt.
 * Chạy: npx tsx scripts/test-ocr.ts
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { extractFrames, cleanupFrames } from '../main/ocr/frameExtractor';
import { OcrPool } from '../main/ocr/ocrEngine';
import { buildSubtitleSegments, segmentsToSrt } from '../main/ocr/subtitleBuilder';

const FFMPEG = (ffmpegInstaller as any).path.replace('app.asar', 'app.asar.unpacked');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-ocr-e2e-'));
const VIDEO = path.join(TMP, 'sample.mp4');

const FONT = 'C\\:/Windows/Fonts/arial.ttf';
// 2 dòng phụ đề, mỗi dòng hiển thị 3 giây trên video 6 giây
const draw = (text: string, from: number, to: number) =>
  `drawtext=fontfile='${FONT}':text='${text}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=h-60:enable='between(t,${from},${to})'`;

console.log('1. Tạo video test 6s (2 câu phụ đề)...');
execFileSync(FFMPEG, [
  '-y', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=6:r=30',
  '-vf', `${draw('Xin chao cac ban', 0, 3)},${draw('Tam biet nha', 3, 6)}`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', VIDEO,
], { stdio: 'pipe' });

async function main() {
  console.log('2. Trích khung (2 fps, vùng đáy)...');
  const { framesDir, framePaths, frameIntervalMs } = await extractFrames(VIDEO, 2, 'bottom');
  console.log(`   → ${framePaths.length} khung, interval ${frameIntervalMs}ms`);

  console.log('3. OCR các khung...');
  const pool = await OcrPool.create('vie', path.join(TMP, 'tessdata'), 2);
  let results;
  try {
    results = await pool.recognizeFiles(framePaths, (done, total) =>
      console.log(`   → ${done}/${total}`));
  } finally {
    await pool.terminate();
  }

  console.log('4. Ghép dòng phụ đề...');
  const segments = buildSubtitleSegments(results, frameIntervalMs);
  const srt = segmentsToSrt(segments);
  if (!srt) throw new Error('Không tạo được SRT!');
  console.log('--- SRT kết quả ---');
  console.log(srt);

  console.log('5. Kiểm tra nội dung...');
  const texts = segments.map((s) => s.text.replace(/\s+/g, ' ').trim());
  const hasA = texts.some((t) => /xin\s*chao/i.test(t));
  const hasB = texts.some((t) => /tam\s*biet/i.test(t));
  const twoLines = segments.length === 2;
  const timingOk = segments.every((s) => s.endMs > s.startMs);

  cleanupFrames(framesDir);
  fs.rmSync(TMP, { recursive: true, force: true });

  const pass = hasA && hasB && twoLines && timingOk;
  console.log(pass ? '✅ PASS — OCR trích đúng 2 dòng phụ đề' : '❌ FAIL', { hasA, hasB, twoLines, timingOk });
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('❌ FAIL:', e);
  process.exit(1);
});
