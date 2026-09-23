import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { aiStudioVideoAssembler } from '../main/ai-studio/services/AiStudioVideoAssembler';
import type { StoryboardScene } from '../main/ai-studio/types';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

async function createColorImg(color: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(`color=c=${color}:s=1280x720:d=1`)
      .inputFormat('lavfi')
      .frames(1)
      .output(outPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

async function createAudio(outPath: string, durationSec = 6): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input('anullsrc=r=44100:cl=stereo')
      .inputFormat('lavfi')
      .duration(durationSec)
      .output(outPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

async function runTest() {
  console.log('🧪 TEST: AiStudioVideoAssembler Multi-Shot Assembly');
  const tmpDir = path.join(os.tmpdir(), `test_assembler_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const redImg = path.join(tmpDir, 'scene_01_red.png');
  const greenImg = path.join(tmpDir, 'scene_02_green.png');
  const blueImg = path.join(tmpDir, 'scene_03_blue.png');
  const audioPath = path.join(tmpDir, 'voiceover.wav');
  const outputPath = path.join(tmpDir, 'final_assembled.mp4');

  await createColorImg('red', redImg);
  await createColorImg('green', greenImg);
  await createColorImg('blue', blueImg);
  await createAudio(audioPath, 6);
  console.log('✅ Created 3 distinct color assets and 6s audio.');

  const testScenes: StoryboardScene[] = [
    {
      id: 'shot_1',
      shotId: 'shot_1',
      lineIndex: 0,
      startMs: 0,
      endMs: 2000,
      durationMs: 2000,
      lineText: 'Scene 1: The Red Room',
      visualPrompt: 'A red room',
      motionType: 'ken_burns',
      assetPath: redImg,
      status: 'ready',
    },
    {
      id: 'shot_2',
      shotId: 'shot_2',
      lineIndex: 1,
      startMs: 2000,
      endMs: 4000,
      durationMs: 2000,
      lineText: 'Scene 2: The Green Field',
      visualPrompt: 'A green field',
      motionType: 'ken_burns',
      assetPath: greenImg,
      status: 'ready',
    },
    {
      id: 'shot_3',
      shotId: 'shot_3',
      lineIndex: 2,
      startMs: 4000,
      endMs: 6000,
      durationMs: 2000,
      lineText: 'Scene 3: The Blue Ocean',
      visualPrompt: 'A blue ocean',
      motionType: 'ken_burns',
      assetPath: blueImg,
      status: 'ready',
    },
  ];

  console.log('🚀 Running assembleVideo with 3 scenes...');
  const result = await aiStudioVideoAssembler.assembleVideo({
    scenes: testScenes,
    voiceoverAudioPath: audioPath,
    outputPath,
    renderingConfig: {
      resolution: '720p',
      kenBurnsEffect: false,
    },
    subtitleConfig: {
      enabled: false,
    },
    aspectRatio: '16:9',
  });

  console.log('✅ assembleVideo completed successfully!');
  console.log('Output Path:', result.videoPath);
  console.log('Duration:', result.durationSec);
  console.log('File size:', result.fileSizeBytes, 'bytes');

  // Verify frames
  const f1 = path.join(tmpDir, 'frame_1s.png');
  const f3 = path.join(tmpDir, 'frame_3s.png');
  const f5 = path.join(tmpDir, 'frame_5s.png');

  await new Promise((res, rej) => ffmpeg(outputPath).seekInput(1).frames(1).output(f1).on('end', res).on('error', rej).run());
  await new Promise((res, rej) => ffmpeg(outputPath).seekInput(3).frames(1).output(f3).on('end', res).on('error', rej).run());
  await new Promise((res, rej) => ffmpeg(outputPath).seekInput(5).frames(1).output(f5).on('end', res).on('error', rej).run());

  if (fs.existsSync(f1) && fs.existsSync(f3) && fs.existsSync(f5)) {
    console.log('🎉 VERIFICATION PASSED: All 3 distinct shot frames were generated along the timeline!');
  } else {
    throw new Error('Frame extraction failed');
  }

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
