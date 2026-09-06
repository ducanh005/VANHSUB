import path from 'path';
import fs from 'fs';
import os from 'os';
import { extractFrames, cleanupFrames } from '../main/ocr/frameExtractor';
import { createWorker } from 'tesseract.js';

const video = path.resolve('samples/ocr_cn_busy.mp4');
const appCache = 'C:/Users/MTLS/AppData/Roaming/vanhsub (development)/tessdata';

async function main() {
  const { framesDir, framePaths } = await extractFrames(video, 2, 'full');
  // Lấy 3 khung đại diện: giữa mỗi scene (khung 3, 9, 15)
  const probes = [framePaths[3], framePaths[9], framePaths[15]];
  for (const psm of ['3', '6'] as const) {
    const worker = await createWorker('chi_sim', 1, { cachePath: appCache, logger: () => {} });
    await worker.setParameters({ tessedit_pageseg_mode: psm as never });
    for (const f of probes) {
      const { data } = await worker.recognize(f, {}, { text: true, blocks: true });
      const lines: string[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs ?? []) {
          for (const line of para.lines ?? []) {
            const t = (line.text || '').trim();
            if (t) lines.push(`"${t}" conf=${Math.round(line.confidence ?? 0)} y=${line.bbox?.y0 ?? '?'}`);
          }
        }
      }
      console.log(`[psm${psm} ${path.basename(f)}] ${lines.length} dòng:`);
      lines.forEach((l) => console.log('   ' + l));
    }
    await worker.terminate();
  }
  cleanupFrames(framesDir);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
