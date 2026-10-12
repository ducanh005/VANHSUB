import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import { VideoProcessor } from '../main/workflow/videoProcessor';

async function generateSampleVideo(outputPath: string, durationSec: number, color: string, timeBase?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg()
      .input(`color=c=${color}:s=640x360:d=${durationSec}:r=24`)
      .inputOption('-f lavfi')
      .input(`sine=frequency=440:duration=${durationSec}`)
      .inputOption('-f lavfi')
      .outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-preset ultrafast',
        '-c:a aac',
        '-b:a 128k',
      ]);
    if (timeBase) {
      cmd = cmd.outputOptions([`-video_track_timescale ${timeBase}`]);
    }
    cmd
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

async function run() {
  console.log('--- 🎬 TEST: VideoProcessor Concat Normalization & Guardrails ---');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_concat_test_'));

  try {
    // Test 1: Missing file throws MISSING_SCENE_VIDEO_INPUT
    console.log('  1. Testing missing input validation...');
    let threwMissing = false;
    try {
      await VideoProcessor.concatVideos(
        [path.join(tempDir, 'nonexistent_1.mp4'), path.join(tempDir, 'nonexistent_2.mp4')],
        path.join(tempDir, 'out.mp4')
      );
    } catch (err: any) {
      threwMissing = true;
      assert.ok(err.message.includes('MISSING_SCENE_VIDEO_INPUT'), `Expected MISSING_SCENE_VIDEO_INPUT, got: ${err.message}`);
    }
    assert.strictEqual(threwMissing, true, 'Must throw on missing file');
    console.log('     ✅ Missing input properly rejected with MISSING_SCENE_VIDEO_INPUT.');

    // Test 2: 0-byte empty file throws MISSING_SCENE_VIDEO_INPUT
    console.log('  2. Testing 0-byte empty input validation...');
    const emptyFile = path.join(tempDir, 'empty.mp4');
    fs.writeFileSync(emptyFile, Buffer.alloc(0));
    let threwEmpty = false;
    try {
      await VideoProcessor.concatVideos([emptyFile], path.join(tempDir, 'out.mp4'));
    } catch (err: any) {
      threwEmpty = true;
      assert.ok(err.message.includes('MISSING_SCENE_VIDEO_INPUT'), `Expected MISSING_SCENE_VIDEO_INPUT, got: ${err.message}`);
    }
    assert.strictEqual(threwEmpty, true, 'Must throw on empty file');
    console.log('     ✅ 0-byte file properly rejected with MISSING_SCENE_VIDEO_INPUT.');

    // Test 3: Concat 3 videos with different timescales (12288 vs 90000 vs 12288)
    console.log('  3. Testing multi-timescale concatenation (12288 vs 90000 vs 12288)...');
    const vid1 = path.join(tempDir, 'v1.mp4');
    const vid2 = path.join(tempDir, 'v2.mp4');
    const vid3 = path.join(tempDir, 'v3.mp4');

    await generateSampleVideo(vid1, 4.0, 'blue', '12288');
    await generateSampleVideo(vid2, 4.0, 'green', '90000');
    await generateSampleVideo(vid3, 4.0, 'red', '12288');

    const concatOut = path.join(tempDir, 'concat_normalized.mp4');
    await VideoProcessor.concatVideos([vid1, vid2, vid3], concatOut);

    const dur = await VideoProcessor.getVideoDuration(concatOut);
    console.log(`     Output duration: ${dur.toFixed(2)}s (Expected: ~12.0s)`);
    assert.ok(
      Math.abs(dur - 12.0) <= 0.5,
      `Duration must be close to 12.0s (not 58s!). Actual: ${dur}`
    );
    console.log('     ✅ Timebase normalization verified: 3x4s outputs exact ~12.0s without timeline inflation.');

    console.log('\n✅ All VideoProcessor Concat Guardrail Tests PASSED!');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

run().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
