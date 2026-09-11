import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { GoogleFlowAdapter } from '../main/workflow/adapters/GoogleFlowAdapter';
import { VideoProcessor } from '../main/workflow/videoProcessor';
import { WorkflowExecutionEngine, type WorkflowGraphData } from '../main/workflow/executionEngine';
import type { ExecutionContext } from '../main/workflow/types';

async function runPhase6DirectorStudioTests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ STORYBOARD DIRECTOR STUDIO & SIMPLE MODE (PHASE 6) ===\n');

  const testDir = path.join(os.tmpdir(), `vanhsub_p6_test_${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });

  const dummyCtx: ExecutionContext = {
    workflowId: 'test-p6-studio',
    nodeId: 'test-node',
    tempDir: testDir,
    exportDir: testDir,
    onProgress: () => {},
    isCancelled: () => false,
  };

  const adapter = new GoogleFlowAdapter();

  // -------------------------------------------------------------
  // TEST 1: Bước 1 - Phân rã Kịch bản thành Shotlist bằng AI Director
  // -------------------------------------------------------------
  console.log('Test 1: Kiểm tra phân rã kịch bản thành Shotlist điện ảnh...');
  const scriptText = 'Đêm mưa tại Hà Nội. Một điệp viên phát hiện kẻ theo dõi và chuẩn bị phản công.';
  const directorResult = await adapter.directPrompt(
    {
      idea: scriptText,
      tone: 'action_thriller',
      lighting: 'volumetric_neon',
      characterName: 'Điệp viên Vanh',
    },
    dummyCtx
  );

  assert.ok(directorResult.prompt, 'Phải có prompt mở rộng');
  assert.ok(directorResult.camera, 'Phải có chỉ đạo camera');
  console.log(`  -> PASS: Phân rã kịch bản thành công: ${directorResult.prompt.slice(0, 60)}...\n`);

  // -------------------------------------------------------------
  // TEST 2: Bước 2 - Dựng bộ ảnh Keyframe tĩnh bằng Google Imagen 3
  // -------------------------------------------------------------
  console.log('Test 2: Kiểm tra dựng ảnh Keyframe tĩnh (Init Frame cho video)...');
  const keyframe1 = await adapter.generateImage(
    { prompt: `${directorResult.prompt} (Wide Establishing Shot)`, aspectRatio: '16:9' },
    dummyCtx
  );
  const keyframe2 = await adapter.generateImage(
    { prompt: `${directorResult.prompt} (Close-up Intense Shot)`, aspectRatio: '16:9' },
    dummyCtx
  );

  assert.ok(fs.existsSync(keyframe1.imageUrl), 'Keyframe 1 phải tồn tại trên đĩa');
  assert.ok(fs.existsSync(keyframe2.imageUrl), 'Keyframe 2 phải tồn tại trên đĩa');
  console.log('  -> PASS: Đã chuẩn bị xong 2 Keyframe tĩnh đạt chuẩn kiểm duyệt.\n');

  // -------------------------------------------------------------
  // TEST 3: Bước 4 - Chuyển động hóa Image-to-Video với Google Veo 3.1
  // -------------------------------------------------------------
  console.log('Test 3: Kiểm tra chuyển động hóa I2V bằng Veo 3.1 từ các Keyframe tĩnh...');
  const video1 = await adapter.generateVideo(
    {
      prompt: 'Camera pan right, rain falling on neon asphalt',
      initFrameUrl: keyframe1.imageUrl,
      durationSeconds: 3,
    },
    dummyCtx
  );

  const video2 = await adapter.generateVideo(
    {
      prompt: 'Camera slow push-in on face, character looks sideways',
      initFrameUrl: keyframe2.imageUrl,
      durationSeconds: 3,
    },
    dummyCtx
  );

  assert.ok(fs.existsSync(video1.videoUrl), 'Video Shot 1 phải render thành công');
  assert.ok(fs.existsSync(video2.videoUrl), 'Video Shot 2 phải render thành công');
  console.log('  -> PASS: Đã render thành công 2 video clips từ ảnh tĩnh.\n');

  // -------------------------------------------------------------
  // TEST 4: Bước 5 - Hậu kỳ & Ghép Master Movie
  // -------------------------------------------------------------
  console.log('Test 4: Kiểm tra ghép nối chuỗi shot thành Master Sequence...');
  const masterMoviePath = path.join(testDir, 'Storyboard_Master_Movie.mp4');
  await VideoProcessor.concatVideos([video1.videoUrl, video2.videoUrl], masterMoviePath, dummyCtx);

  assert.ok(fs.existsSync(masterMoviePath), 'Master Movie phải tồn tại');
  const totalDur = await VideoProcessor.getVideoDuration(masterMoviePath);
  assert.ok(totalDur >= 5.5, `Tổng thời lượng phim phải >= 5.5s (nhận được: ${totalDur}s)`);
  console.log(`  -> PASS: Xuất Master Movie thành công! Tổng thời lượng: ${totalDur.toFixed(2)}s\n`);

  // Dọn dẹp
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}

  console.log('=== TOÀN BỘ QUY TRÌNH ĐẠO DIỄN STORYBOARD STUDIO (PHASE 6) ĐỀU PASS 100%! ===\n');
}

runPhase6DirectorStudioTests().catch((err) => {
  console.error('TEST PHASE 6 THẤT BẠI:', err);
  process.exit(1);
});
