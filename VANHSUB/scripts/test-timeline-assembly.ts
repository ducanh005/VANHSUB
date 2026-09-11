import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { VideoProcessor } from '../main/workflow/videoProcessor';
import { GoogleFlowAdapter } from '../main/workflow/adapters/GoogleFlowAdapter';
import { WorkflowExecutionEngine, type WorkflowGraphData } from '../main/workflow/executionEngine';
import type { ExecutionContext } from '../main/workflow/types';

async function runTimelineAssemblyTests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ MASTER TIMELINE & VIDEO ASSEMBLY (PHASE 4) ===\n');

  const testDir = path.join(os.tmpdir(), `vanhsub_timeline_test_${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });

  const dummyCtx: ExecutionContext = {
    workflowId: 'test-timeline',
    nodeId: 'test-node',
    tempDir: testDir,
    exportDir: testDir,
    onProgress: () => {},
    isCancelled: () => false,
  };

  const adapter = new GoogleFlowAdapter();

  // Tạo 2 clip video giả lập 3 giây mỗi clip
  console.log('Tạo 2 clip video mẫu bằng GoogleFlowAdapter...');
  const clip1Res = await adapter.generateVideo(
    { prompt: 'Shot 1 - Cyberpunk Street', durationSeconds: 3 },
    dummyCtx
  );
  const clip2Res = await adapter.generateVideo(
    { prompt: 'Shot 2 - Agent Running', durationSeconds: 3 },
    dummyCtx
  );

  assert.ok(fs.existsSync(clip1Res.videoUrl), 'Clip 1 phải được tạo thành công');
  assert.ok(fs.existsSync(clip2Res.videoUrl), 'Clip 2 phải được tạo thành công');
  console.log('  -> Đã tạo Clip 1 và Clip 2 thành công.\n');

  // -------------------------------------------------------------
  // TEST 1: VideoProcessor.trimVideo
  // -------------------------------------------------------------
  console.log('Test 1: Kiểm tra cắt gọt video (Trim)...');
  const trimOut = path.join(testDir, 'trimmed_clip1.mp4');
  await VideoProcessor.trimVideo(clip1Res.videoUrl, trimOut, 0.5, 2.5, dummyCtx);

  assert.ok(fs.existsSync(trimOut), 'Video sau khi trim phải tồn tại');
  const trimDur = await VideoProcessor.getVideoDuration(trimOut);
  assert.ok(trimDur >= 1.8 && trimDur <= 2.2, `Thời lượng sau khi trim phải xấp xỉ 2.0s (nhận được: ${trimDur}s)`);
  console.log(`  -> PASS: Trim video thành công. Thời lượng: ${trimDur.toFixed(2)}s.\n`);

  // -------------------------------------------------------------
  // TEST 2: VideoProcessor.concatVideos
  // -------------------------------------------------------------
  console.log('Test 2: Kiểm tra ghép nối video (Concat Demuxer)...');
  const concatOut = path.join(testDir, 'concatenated_master.mp4');
  await VideoProcessor.concatVideos([clip1Res.videoUrl, clip2Res.videoUrl], concatOut, dummyCtx);

  assert.ok(fs.existsSync(concatOut), 'Video ghép concat phải tồn tại');
  const concatDur = await VideoProcessor.getVideoDuration(concatOut);
  assert.ok(concatDur >= 5.5 && concatDur <= 6.5, `Thời lượng video sau khi ghép phải xấp xỉ 6.0s (nhận được: ${concatDur}s)`);
  console.log(`  -> PASS: Concat 2 clips thành công. Tổng thời lượng: ${concatDur.toFixed(2)}s.\n`);

  // -------------------------------------------------------------
  // TEST 3: VideoProcessor.applyTransition
  // -------------------------------------------------------------
  console.log('Test 3: Kiểm tra hiệu ứng chuyển cảnh (Transition - Fade to Black)...');
  const transOut = path.join(testDir, 'transition_fade.mp4');
  await VideoProcessor.applyTransition(
    clip1Res.videoUrl,
    clip2Res.videoUrl,
    transOut,
    { effect: 'fade_black', duration: 0.5 },
    dummyCtx
  );

  assert.ok(fs.existsSync(transOut), 'Video chuyển cảnh phải tồn tại');
  const transDur = await VideoProcessor.getVideoDuration(transOut);
  assert.ok(transDur > 4, `Thời lượng video transition phải hợp lệ (nhận được: ${transDur}s)`);
  console.log(`  -> PASS: Tạo chuyển cảnh fade to black thành công. Thời lượng: ${transDur.toFixed(2)}s.\n`);

  // -------------------------------------------------------------
  // TEST 4: VideoProcessor.colorMatchVideo
  // -------------------------------------------------------------
  console.log('Test 4: Kiểm tra cân bằng màu sắc (Color Match)...');
  const colorOut = path.join(testDir, 'colormatched.mp4');
  await VideoProcessor.colorMatchVideo(clip1Res.videoUrl, '', colorOut, 0.8, dummyCtx);

  assert.ok(fs.existsSync(colorOut), 'Video đã cân màu phải tồn tại');
  console.log('  -> PASS: Cân bằng màu Color Match hoạt động trơn tru.\n');

  // -------------------------------------------------------------
  // TEST 5: Full Workflow Pipeline (Veo Shot 1 + Shot 2 -> Transition -> Trim -> Export)
  // -------------------------------------------------------------
  console.log('Test 5: Kiểm thử đồ thị DAG hoàn chỉnh với các node Phase 4...');
  const engine = new WorkflowExecutionEngine();

  const phase4Graph: WorkflowGraphData = {
    id: 'test_phase4_assembly',
    name: 'Phase 4 Video Assembly Sequence',
    nodes: [
      {
        id: 'node-shot1',
        data: {
          nodeType: 'google-flow-video',
          category: 'model',
          label: 'Shot 1: Flyover',
          config: { prompt: 'Cinematic drone flyover', durationSeconds: 2 },
        },
      },
      {
        id: 'node-shot2',
        data: {
          nodeType: 'google-flow-video',
          category: 'model',
          label: 'Shot 2: Close-up',
          config: { prompt: 'Agent close-up look', durationSeconds: 2 },
        },
      },
      {
        id: 'node-trans',
        data: {
          nodeType: 'transition',
          category: 'editing',
          label: 'Chuyển cảnh Hòa tan',
          config: { effect: 'fade_black', duration: 0.5 },
        },
      },
      {
        id: 'node-trim',
        data: {
          nodeType: 'trim',
          category: 'editing',
          label: 'Cắt gọt Sequence',
          config: { startTime: 0, endTime: 3 },
        },
      },
      {
        id: 'node-export',
        data: {
          nodeType: 'export-video',
          category: 'output',
          label: 'Xuất Master Phim',
          config: { fileName: 'Phase4_Master_Movie.mp4' },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'node-shot1', target: 'node-trans', sourceHandle: 'video', targetHandle: 'video_a' },
      { id: 'e2', source: 'node-shot2', target: 'node-trans', sourceHandle: 'video', targetHandle: 'video_b' },
      { id: 'e3', source: 'node-trans', target: 'node-trim', sourceHandle: 'video_out', targetHandle: 'video_in' },
      { id: 'e4', source: 'node-trim', target: 'node-export', sourceHandle: 'video_out', targetHandle: 'video_in' },
    ],
  };

  const workflowRes = await engine.execute(phase4Graph, (ev) => {
    if (ev.status === 'success') {
      console.log(`    [DAG Event] Node #${ev.nodeId} -> SUCCESS`);
    }
  });

  assert.strictEqual(workflowRes.success, true, 'Workflow Phase 4 phải chạy thành công');
  const exportOut = workflowRes.outputs['node-export'];
  assert.ok(exportOut.exportedPath, 'Phải có file export master');
  assert.ok(fs.existsSync(exportOut.exportedPath), 'File master trên đĩa phải tồn tại');
  console.log(`  -> PASS: Workflow Phase 4 hoàn tất mỹ mãn! File: ${exportOut.exportedPath}\n`);

  // Dọn dẹp thư mục tạm
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}

  console.log('=== TẤT CẢ CÁC BÀI TEST PHASE 4 ĐỀU THÀNH CÔNG RỰC RỠ! ===\n');
}

runTimelineAssemblyTests().catch((err) => {
  console.error('TEST PHASE 4 THẤT BẠI:', err);
  process.exit(1);
});
