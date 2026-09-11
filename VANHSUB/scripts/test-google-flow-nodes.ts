import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { GoogleFlowAdapter } from '../main/workflow/adapters/GoogleFlowAdapter';
import { WorkflowExecutionEngine, type WorkflowGraphData } from '../main/workflow/executionEngine';
import type { ExecutionContext } from '../main/workflow/types';

async function runGoogleFlowPhase5Tests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ GOOGLE FLOW MODEL EXTENSIONS & LOGIC NODES (PHASE 5) ===\n');

  const testDir = path.join(os.tmpdir(), `vanhsub_p5_test_${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });

  const dummyCtx: ExecutionContext = {
    workflowId: 'test-p5-flow',
    nodeId: 'test-node',
    tempDir: testDir,
    exportDir: testDir,
    onProgress: () => {},
    isCancelled: () => false,
  };

  const adapter = new GoogleFlowAdapter();

  // -------------------------------------------------------------
  // TEST 1: Google Imagen 3 (Text-to-Image)
  // -------------------------------------------------------------
  console.log('Test 1: Kiểm tra sinh ảnh bằng Google Imagen 3...');
  const imgRes = await adapter.generateImage(
    {
      prompt: 'Cinematic portrait of Vietnamese agent under cyberpunk rain',
      aspectRatio: '16:9',
    },
    dummyCtx
  );

  assert.ok(imgRes.imageUrl, 'Google Imagen phải trả về đường dẫn ảnh');
  assert.ok(fs.existsSync(imgRes.imageUrl), 'File ảnh Imagen 3 trên đĩa phải tồn tại');
  console.log(`  -> PASS: Google Imagen 3 tạo ảnh thành công! File: ${imgRes.imageUrl}\n`);

  // -------------------------------------------------------------
  // TEST 2: Gemini AI Director (Prompt & Camera Expansion)
  // -------------------------------------------------------------
  console.log('Test 2: Kiểm tra mở rộng kịch bản bằng Gemini AI Director...');
  const dirRes = await adapter.directPrompt(
    {
      idea: 'Một điệp viên chạy qua chợ đêm mưa',
      tone: 'action_thriller',
      lighting: 'volumetric_neon',
      characterName: 'Điệp viên Vanh',
    },
    dummyCtx
  );

  assert.ok(dirRes.prompt, 'Director phải sinh ra câu lệnh mở rộng');
  assert.ok(dirRes.prompt.length > 30, 'Prompt mở rộng phải chi tiết và giàu yếu tố điện ảnh');
  assert.ok(dirRes.negativePrompt, 'Phải có negative prompt');
  assert.ok(dirRes.camera, 'Phải có gợi ý chuyển động camera');
  console.log(`  -> PASS: Gemini Director mở rộng kịch bản thành công:`);
  console.log(`     Prompt: "${dirRes.prompt.slice(0, 75)}..."`);
  console.log(`     Camera: ${dirRes.camera}\n`);

  // -------------------------------------------------------------
  // TEST 3: Full Workflow DAG thuần Google Flow & Logic
  // -------------------------------------------------------------
  console.log('Test 3: Kiểm thử DAG Pipeline tích hợp Gemini Director -> Imagen 3 -> Veo Video -> Conditional -> Export...');
  const engine = new WorkflowExecutionEngine();

  const googleFlowGraph: WorkflowGraphData = {
    id: 'test_google_flow_exclusive',
    name: 'Pure Google Flow & Logic Pipeline',
    nodes: [
      {
        id: 'node-director',
        data: {
          nodeType: 'gemini-director',
          category: 'model',
          label: 'Gemini Director Kịch bản',
          config: {
            idea: 'Người lính đặc nhiệm đứng canh trên vách núi Hoàng Liên Sơn lúc bình minh sương mù',
            directorTone: 'cinematic_epic',
            lightingStyle: 'golden_hour',
          },
        },
      },
      {
        id: 'node-imagen',
        data: {
          nodeType: 'google-imagen',
          category: 'model',
          label: 'Google Imagen 3 (Init Frame)',
          config: {
            aspectRatio: '16:9',
          },
        },
      },
      {
        id: 'node-veo',
        data: {
          nodeType: 'google-flow-video',
          category: 'model',
          label: 'Google Veo Video',
          config: {
            durationSeconds: 3,
            modelVariant: 'veo-3.1-generate-preview',
          },
        },
      },
      {
        id: 'node-cond',
        data: {
          nodeType: 'conditional',
          category: 'logic',
          label: 'Rẽ nhánh Điều kiện',
          config: {
            conditionType: 'qc_passed',
          },
        },
      },
      {
        id: 'node-export',
        data: {
          nodeType: 'export-video',
          category: 'output',
          label: 'Xuất Master Phim',
          config: {
            fileName: 'Google_Flow_Epic_Master.mp4',
          },
        },
      },
    ],
    edges: [
      // Director prompt -> Imagen 3
      { id: 'e1', source: 'node-director', target: 'node-imagen', sourceHandle: 'prompt_out', targetHandle: 'prompt' },
      // Imagen output image -> Veo Init Frame
      { id: 'e2', source: 'node-imagen', target: 'node-veo', sourceHandle: 'image', targetHandle: 'init_frame' },
      // Director prompt -> Veo prompt
      { id: 'e3', source: 'node-director', target: 'node-veo', sourceHandle: 'prompt_out', targetHandle: 'prompt' },
      // Veo video -> Conditional input
      { id: 'e4', source: 'node-veo', target: 'node-cond', sourceHandle: 'video', targetHandle: 'input_video' },
      // Conditional true_branch -> Export
      { id: 'e5', source: 'node-cond', target: 'node-export', sourceHandle: 'true_branch', targetHandle: 'video_in' },
    ],
  };

  const workflowRes = await engine.execute(googleFlowGraph, (ev) => {
    if (ev.status === 'success') {
      console.log(`    [Google Flow Event] Node #${ev.nodeId} -> SUCCESS`);
    }
  });

  assert.strictEqual(workflowRes.success, true, 'Workflow thuần Google Flow phải chạy thành công');

  const dirOut = workflowRes.outputs['node-director'];
  assert.ok(dirOut.prompt_out, 'Director phải có prompt_out');

  const imgOut = workflowRes.outputs['node-imagen'];
  assert.ok(imgOut.image && fs.existsSync(imgOut.image), 'Imagen 3 phải sinh file ảnh hợp lệ');

  const veoOut = workflowRes.outputs['node-veo'];
  assert.ok(veoOut.video && fs.existsSync(veoOut.video), 'Veo phải sinh video hoàn tất');

  const condOut = workflowRes.outputs['node-cond'];
  assert.ok(condOut.video, 'Conditional phải chuyển tiếp video');

  const expOut = workflowRes.outputs['node-export'];
  assert.ok(expOut.exportedPath && fs.existsSync(expOut.exportedPath), 'Export node phải lưu tệp master');

  console.log(`  -> PASS: Toàn bộ pipeline thuần Google Flow hoạt động xuất sắc! File Master: ${expOut.exportedPath}\n`);

  // Dọn dẹp
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}

  console.log('=== TẤT CẢ CÁC BÀI TEST GOOGLE FLOW & LOGIC NODES (PHASE 5) ĐỀU THÀNH CÔNG RỰC RỠ! ===\n');
}

runGoogleFlowPhase5Tests().catch((err) => {
  console.error('TEST PHASE 5 THẤT BẠI:', err);
  process.exit(1);
});
