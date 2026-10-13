import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { getDecryptedAiStudioConfig, updateAiStudioConfig } from '../main/store/aiStudioStore';

ffmpeg.setFfmpegPath(ffmpegInstaller.path.replace('app.asar', 'app.asar.unpacked'));
ffmpeg.setFfprobePath(ffprobeInstaller.path.replace('app.asar', 'app.asar.unpacked'));

async function main() {
  console.log('--- PREPARING DEDICATED TEST PROJECT FOR FREEZE LAST FRAME ACCEPTANCE ---');

  const testProjectDir = path.resolve(__dirname, '..', 'temp_ui_test_project');
  const fixtureVid = path.resolve(__dirname, '..', 'temp_live_e2e_output', 'live_scene_2_1791646454362.mp4');

  if (!fs.existsSync(fixtureVid)) {
    throw new Error(`Fixture video not found at ${fixtureVid}`);
  }

  // Ensure directories exist
  const voiceDir = path.join(testProjectDir, '02_voice');
  const mediaDir = path.join(testProjectDir, '05_media');
  const scriptDir = path.join(testProjectDir, '01_script');
  const timingDir = path.join(testProjectDir, '03_timing');
  const storyboardDir = path.join(testProjectDir, '04_storyboard');

  fs.mkdirSync(voiceDir, { recursive: true });
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(timingDir, { recursive: true });
  fs.mkdirSync(storyboardDir, { recursive: true });

  // 1. Generate 19.0s voiceover audio using sine/lavfi
  const voiceoverPath = path.join(voiceDir, 'voiceover_19s.mp3');
  console.log('Generating 19.0s voiceover audio at:', voiceoverPath);
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input('sine=frequency=440:beep_factor=4:sample_rate=44100')
      .inputFormat('lavfi')
      .duration(19.0)
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .output(voiceoverPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });

  const duration: number = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(voiceoverPath, (err, data) => {
      if (err) return reject(err);
      resolve(Number(data?.format?.duration) || 0);
    });
  });
  console.log(`Voiceover audio generated: ${duration.toFixed(3)}s`);

  // 2. Prepare script lines (7s, 6s, 6s -> Total 19s)
  const scriptLines = [
    {
      id: 'line_1',
      index: 0,
      text: 'Khám phá chiều không gian thứ tư và bí ẩn thời gian.',
      visualPromptEn: 'Futuristic physics lab with glowing holographic multidimensional cube',
      startMs: 0,
      endMs: 7000,
      durationMs: 7000,
      audioPath: voiceoverPath,
    },
    {
      id: 'line_2',
      index: 1,
      text: 'Các nhà khoa học quan sát biến dạng không gian dưới kính hiển vi.',
      visualPromptEn: 'Macro scientific perspective of shimmering quantum ripples warping crystal matrix',
      startMs: 7000,
      endMs: 13000,
      durationMs: 6000,
      audioPath: voiceoverPath,
    },
    {
      id: 'line_3',
      index: 2,
      text: 'Bức tranh toàn cảnh mở ra cánh cổng dẫn đến những chân trời tri thức mới.',
      visualPromptEn: 'Wide cinematic vista of deep observatory dome opening up to cosmic galaxy',
      startMs: 13000,
      endMs: 19000,
      durationMs: 6000,
      audioPath: voiceoverPath,
    },
  ];

  // 3. Word alignments across 19s
  const wordsAlignment = [
    { word: 'Khám', startMs: 500, endMs: 1200 },
    { word: 'phá', startMs: 1200, endMs: 2000 },
    { word: 'chiều', startMs: 2000, endMs: 2800 },
    { word: 'không', startMs: 2800, endMs: 3600 },
    { word: 'gian', startMs: 3600, endMs: 4400 },
    { word: 'thứ', startMs: 4400, endMs: 5200 },
    { word: 'tư', startMs: 5200, endMs: 6500 },

    { word: 'Các', startMs: 7500, endMs: 8200 },
    { word: 'nhà', startMs: 8200, endMs: 9000 },
    { word: 'khoa', startMs: 9000, endMs: 9800 },
    { word: 'học', startMs: 9800, endMs: 10600 },
    { word: 'quan', startMs: 10600, endMs: 11400 },
    { word: 'sát', startMs: 11400, endMs: 12500 },

    { word: 'Bức', startMs: 13500, endMs: 14200 },
    { word: 'tranh', startMs: 14200, endMs: 15000 },
    { word: 'toàn', startMs: 15000, endMs: 15800 },
    { word: 'cảnh', startMs: 15800, endMs: 16600 },
    { word: 'mở', startMs: 16600, endMs: 17400 },
    { word: 'ra', startMs: 17400, endMs: 18500 },
  ];

  // 4. Scenes: 3 scenes with 4s video clips, timeline 7s/6s/6s, fillMode NOT SET yet!
  const scenes = [
    {
      id: 'scene_01_shot_1',
      shotId: 'scene_01_shot_1',
      lineIndex: 0,
      startMs: 0,
      endMs: 7000,
      durationMs: 7000,
      lineText: scriptLines[0].text,
      visualPrompt: scriptLines[0].visualPromptEn,
      motionType: 'video',
      videoPath: fixtureVid,
      assetPath: fixtureVid,
      status: 'ready',
      originalMediaDurationSec: 4.01,
      // fillMode is deliberately NOT set to test the guard blocking!
    },
    {
      id: 'scene_02_shot_1',
      shotId: 'scene_02_shot_1',
      lineIndex: 1,
      startMs: 7000,
      endMs: 13000,
      durationMs: 6000,
      lineText: scriptLines[1].text,
      visualPrompt: scriptLines[1].visualPromptEn,
      motionType: 'video',
      videoPath: fixtureVid,
      assetPath: fixtureVid,
      status: 'ready',
      originalMediaDurationSec: 4.01,
    },
    {
      id: 'scene_03_shot_1',
      shotId: 'scene_03_shot_1',
      lineIndex: 2,
      startMs: 13000,
      endMs: 19000,
      durationMs: 6000,
      lineText: scriptLines[2].text,
      visualPrompt: scriptLines[2].visualPromptEn,
      motionType: 'video',
      videoPath: fixtureVid,
      assetPath: fixtureVid,
      status: 'ready',
      originalMediaDurationSec: 4.01,
    },
  ];

  const projectId = 'proj_1791817054791_m2t5w';
  const sessionId = 'test-session-ui-freeze-19s';

  const sessionData = {
    sessionId,
    projectId,
    topic: 'Kiểm thử bù thời lượng Freeze Last Frame 19s',
    currentStage: 6,
    stageName: 'visuals',
    status: 'awaiting_approval',
    progress: 75,
    gatedMode: true,
    stages: {
      1: { status: 'success', stageName: 'Dữ kiện', stage: 1 },
      2: { status: 'success', stageName: 'Kịch bản', stage: 2 },
      3: { status: 'success', stageName: 'Lồng tiếng', stage: 3 },
      4: { status: 'success', stageName: 'Trích xuất Time', stage: 4 },
      5: { status: 'success', stageName: 'Storyboard', stage: 5 },
      6: { status: 'success', stageName: 'Ảnh / Video', stage: 6 },
      7: { status: 'pending', stageName: 'Dựng phim', stage: 7 },
      8: { status: 'pending', stageName: 'SEO & Xuất bản', stage: 8 },
    },
    artifacts: {
      blueprint: {
        id: 'bp_freeze_test',
        title: 'Kiểm thử bù thời lượng Freeze Last Frame 19s',
        topic: 'Kiểm thử bù thời lượng Freeze Last Frame 19s',
        aspectRatio: '16:9',
      },
      scriptLines,
      audioPath: voiceoverPath,
      wordsAlignment,
      scenes,
      mediaDir: testProjectDir,
    },
    updatedAt: Date.now(),
  };

  const sessionJsonPath = path.join(testProjectDir, 'session.json');
  fs.writeFileSync(sessionJsonPath, JSON.stringify(sessionData, null, 2), 'utf-8');
  console.log('Saved session.json to:', sessionJsonPath);

  const indexData = {
    project_id: projectId,
    title: 'Kiểm thử bù thời lượng Freeze Last Frame 19s',
    shots: {
      scene_01_shot_1: { video_path: fixtureVid, current_video_version: 1 },
      scene_02_shot_1: { video_path: fixtureVid, current_video_version: 1 },
      scene_03_shot_1: { video_path: fixtureVid, current_video_version: 1 },
    },
  };
  fs.writeFileSync(path.join(testProjectDir, 'index.json'), JSON.stringify(indexData, null, 2), 'utf-8');

  // Update active project in config
  updateAiStudioConfig({
    activeProjectId: projectId,
    outputDir: testProjectDir,
    savedProjects: [
      {
        id: projectId,
        name: 'TEST_FREEZE_19S_PROJECT',
        outputDir: testProjectDir,
        flowProjectUrl: 'https://flow.google.com/project/24f0ba0a-9803-4c7a-8610-761a02cd5f38',
        savedSession: sessionData as any,
        lastSessionId: sessionId,
      },
    ],
  });

  console.log('Config updated with active project:', projectId);
  console.log('--- TEST PROJECT SETUP COMPLETE ---');
}

main().catch(console.error);
