// scripts/test-render.ts
//
// Script test videoRenderer.ts (burnHardsub + muxSoftsub) qua terminal,
// KHÔNG cần mở app Electron. Tự tạo video mẫu bằng lavfi (testsrc 10s).
// Cách chạy: npx tsx scripts/test-render.ts

import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { burnHardsub, muxSoftsub } from '../main/render/videoRenderer';

const ROOT = path.resolve(__dirname, '..');
const SAMPLES_DIR = path.join(ROOT, 'samples');

const rawFfmpegPath = (ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '';
ffmpeg.setFfmpegPath(rawFfmpegPath.replace('app.asar', 'app.asar.unpacked'));

function makeTestVideo(outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input('testsrc=duration=10:size=640x360:rate=25')
      .inputFormat('lavfi')
      .input('sine=frequency=440:duration=10')
      .inputFormat('lavfi')
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(['-pix_fmt yuv420p', '-shortest'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(new Error(`Tạo video test thất bại: ${err.message}`)))
      .run();
  });
}

async function main() {
  const srtPath = path.join(SAMPLES_DIR, 'test.wav.srt');
  if (!fs.existsSync(srtPath)) {
    console.error(`❌ Không tìm thấy ${srtPath}`);
    process.exit(1);
  }

  const videoPath = path.join(SAMPLES_DIR, 'test_render_video.mp4');
  if (!fs.existsSync(videoPath)) {
    console.log('Tạo video test 10s bằng lavfi...');
    await makeTestVideo(videoPath);
    console.log('✅ Video test:', videoPath);
  } else {
    console.log('Dùng lại video test có sẵn:', videoPath);
  }

  try {
    // 1) Hardsub
    const hardsubPath = path.join(SAMPLES_DIR, 'test_render_video.hardsub.mp4');
    console.log('\n[1/2] Burn hardsub...');
    await burnHardsub({
      videoPath,
      srtPath,
      outputPath: hardsubPath,
      onProgress: (p) => process.stdout.write(`  hardsub ${p}%\r`),
    });
    console.log(`\n✅ Hardsub xong: ${hardsubPath} (${(fs.statSync(hardsubPath).size / 1024).toFixed(0)} KB)`);

    // 2) Softsub
    const softsubPath = path.join(SAMPLES_DIR, 'test_render_video.softsub.mp4');
    console.log('\n[2/2] Mux softsub...');
    await muxSoftsub({ videoPath, srtPath, outputPath: softsubPath });
    console.log(`✅ Softsub xong: ${softsubPath} (${(fs.statSync(softsubPath).size / 1024).toFixed(0)} KB)`);

    console.log('\n🎉 Test render PASS — kiểm tra bằng trình phát bất kỳ.');
  } catch (err: any) {
    console.error('\n❌ Test render FAIL:', err?.message || err);
    process.exit(1);
  }
}

main();
