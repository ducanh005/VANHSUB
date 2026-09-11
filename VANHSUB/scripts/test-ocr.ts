/**
 * Test OCR phụ đề cứng end-to-end (pipeline PaddleOCR + Tesseract):
 * tạo video test có 2 dòng chữ đổi nhau theo thời gian, chạy pipeline
 * trích khung → PaddleOCR PP-OCRv5 (sidecar Python) → Tesseract đọc lại từng
 * crop → so sánh 2 engine → ghép dòng phụ đề → so với nội dung gốc.
 * Chạy: npx tsx scripts/test-ocr.ts
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync, spawn } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { extractFrames, cleanupFrames } from '../main/ocr/frameExtractor';
import { OcrPool } from '../main/ocr/ocrEngine';
import { mergeOcrResults, mergedToFrameResults, similarityOf } from '../main/ocr/resultMerge';
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

/** Chạy sidecar Python PaddleOCR cho danh sách khung — parse JSONL output */
function runPaddleSidecar(job: Record<string, unknown>): Promise<Array<{ lines: Array<Record<string, any>> }>> {
  return new Promise((resolve, reject) => {
    const jobPath = path.join(TMP, 'paddle.job.json');
    fs.writeFileSync(jobPath, JSON.stringify(job), 'utf-8');
    const child = spawn('python', [
      path.join(__dirname, '..', 'main', 'ocr', 'paddle', 'paddle_server.py'),
      '--job', jobPath,
    ], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 2) return reject(new Error(`Thiếu gói python: ${stderr}`));
      if (code !== 0) return reject(new Error(`Sidecar exit ${code}: ${stderr}`));
      // Kết quả từng khung nằm trong file JSONL (outPath) — stdout chỉ có progress
      const raw = fs.readFileSync(String(job.outPath), 'utf-8');
      const frames = raw
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
      resolve({ frames, msgs: [] } as any);
    });
  });
}

async function main() {
  console.log('2. Trích khung (2 fps, vùng đáy, giữ màu)...');
  const { framesDir, framePaths, frameIntervalMs, width, height } = await extractFrames(VIDEO, 2, 'bottom');
  console.log(`   → ${framePaths.length} khung, interval ${frameIntervalMs}ms, video ${width}x${height}`);

  console.log('3. PaddleOCR PP-OCRv5 (sidecar Python): detect → crop → enhance → rec...');
  const { frames: paddleFrames, msgs } = (await runPaddleSidecar({
    frames: framePaths,
    cropsDir: path.join(framesDir, 'crops'),
    outPath: path.join(TMP, 'paddle_out.jsonl'),
    recLangNames: ['LATIN'],
    detVersion: 'PPOCRV5',
    recVersion: 'PPOCRV5',
    modelType: 'MOBILE',
    textScore: 0.25,
    videoWidth: width,
    videoHeight: height,
    regionOffsetRatio: 0.7,
  })) as any;
  const cropCount = paddleFrames.reduce((s: number, f: any) => s + f.lines.length, 0);
  if (cropCount === 0) {
    console.error('   Sidecar messages:', JSON.stringify(msgs, null, 1));
    console.error('   Frame records:', JSON.stringify(paddleFrames.slice(0, 3)));
    console.error('   Frame files exist:', framePaths.slice(0, 3).map((p) => fs.existsSync(p)));
    console.error('   First frame size:', fs.statSync(framePaths[0]).size);
    throw new Error('PaddleOCR không detect được vùng chữ nào!');
  }
  console.log(`   → ${cropCount} crop chữ`);

  console.log('4. Tesseract đọc lại từng crop (PSM 7)...');
  const cropFiles = paddleFrames.flatMap((f) => f.lines.map((l: any) => l.crop));
  const pool = await OcrPool.create('vie', path.join(TMP, 'tessdata'), 2, 'line');
  let cropResults;
  try {
    cropResults = await pool.recognizeCrops(cropFiles, (done, total) => {
      if (done % 4 === 0 || done === total) console.log(`   → ${done}/${total}`);
    });
  } finally {
    await pool.terminate();
  }
  const cropMap = new Map(cropFiles.map((file, i) => [file, cropResults[i]]));

  console.log('5. So sánh 2 engine + ghép dòng phụ đề...');
  const merged = mergeOcrResults(paddleFrames as any, cropMap, 40);
  const segments = buildSubtitleSegments(mergedToFrameResults(merged), frameIntervalMs);
  const srt = segmentsToSrt(segments);
  if (!srt) throw new Error('Không tạo được SRT!');
  console.log('--- SRT kết quả ---');
  console.log(srt);
  console.log('--- Chi tiết từng dòng (pad/tess/sim) ---');
  merged.forEach((f, i) => {
    for (const l of f.lines) {
      console.log(`   #${i} ${l.chosen} conf=${l.confidence} sim=${(l.similarity ?? 0).toFixed(2)} "${l.text}" (tess: "${l.altText}")`);
    }
  });

  console.log('6. Kiểm tra nội dung...');
  const texts = segments.map((s) => s.text.replace(/\s+/g, ' ').trim());
  const hasA = texts.some((t) => similarityOf(t, 'Xin chao cac ban') >= 0.75);
  const hasB = texts.some((t) => similarityOf(t, 'Tam biet nha') >= 0.75);
  const twoLines = segments.length === 2;
  const timingOk = segments.every((s) => s.endMs > s.startMs);

  cleanupFrames(framesDir);
  fs.rmSync(TMP, { recursive: true, force: true });

  const pass = hasA && hasB && twoLines && timingOk;
  console.log(pass ? '✅ PASS — OCR 2 engine trích đúng 2 dòng phụ đề' : '❌ FAIL', { hasA, hasB, twoLines, timingOk });
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('❌ FAIL:', e);
  process.exit(1);
});
