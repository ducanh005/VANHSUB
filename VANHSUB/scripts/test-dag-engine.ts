import assert from 'assert';
import { WorkflowExecutionEngine, type WorkflowGraphData } from '../main/workflow/executionEngine';
import type { WorkflowNodeEvent } from '../main/workflow/types';

async function runTests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ WORKFLOW EXECUTION ENGINE (PHASE 2) ===\n');

  const engine = new WorkflowExecutionEngine();

  // -------------------------------------------------------------
  // TEST 1: Phát hiện chu trình (Cycle Detection)
  // -------------------------------------------------------------
  console.log('Test 1: Kiểm tra phát hiện chu trình (Cycle Loop)...');
  const cycleGraph: WorkflowGraphData = {
    id: 'test_cycle',
    name: 'Cycle Graph',
    nodes: [
      { id: 'node-a', data: { nodeType: 'text-prompt', category: 'input', label: 'Node A', config: {} } },
      { id: 'node-b', data: { nodeType: 'google-flow-video', category: 'model', label: 'Node B', config: {} } },
    ],
    edges: [
      { id: 'e1', source: 'node-a', target: 'node-b' },
      { id: 'e2', source: 'node-b', target: 'node-a' }, // Chu trình A -> B -> A
    ],
  };

  const cycleResult = await engine.execute(cycleGraph, () => {});
  assert.strictEqual(cycleResult.success, false, 'Đồ thị có chu trình phải trả về success: false');
  assert.ok(
    cycleResult.error?.includes('chu trình'),
    `Thông báo lỗi phải cảnh báo về chu trình (nhận được: ${cycleResult.error})`
  );
  console.log('  -> PASS: Đã phát hiện và chặn đồ thị chu trình thành công.\n');

  // -------------------------------------------------------------
  // TEST 2: Luồng tuần tự Text Prompt -> Veo Video -> Export Video -> Send to Sub Mode
  // -------------------------------------------------------------
  console.log('Test 2: Luồng chuẩn Text Prompt -> Veo Video -> Export Video -> Send to Sub Mode...');
  const events: WorkflowNodeEvent[] = [];

  const linearGraph: WorkflowGraphData = {
    id: 'test_linear',
    name: 'Linear Pipeline',
    nodes: [
      {
        id: 'node-p',
        data: {
          nodeType: 'text-prompt',
          category: 'input',
          label: 'Prompt',
          config: { prompt: 'Hanoi autumn sunset cinematic' },
        },
      },
      {
        id: 'node-v',
        data: {
          nodeType: 'google-flow-video',
          category: 'model',
          label: 'Veo Video',
          config: { durationSeconds: 3 },
        },
      },
      {
        id: 'node-exp',
        data: {
          nodeType: 'export-video',
          category: 'output',
          label: 'Export',
          config: { fileName: 'test_linear_export.mp4' },
        },
      },
      {
        id: 'node-sub',
        data: {
          nodeType: 'send-to-sub-mode',
          category: 'output',
          label: 'Send to Sub Mode',
          config: { taskName: 'Linear Test Video' },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'node-p', target: 'node-v', sourceHandle: 'text', targetHandle: 'prompt' },
      { id: 'e2', source: 'node-v', target: 'node-exp', sourceHandle: 'video', targetHandle: 'video_in' },
      { id: 'e3', source: 'node-v', target: 'node-sub', sourceHandle: 'video', targetHandle: 'video_in' },
    ],
  };

  const linearResult = await engine.execute(linearGraph, (ev) => {
    events.push(ev);
    if (ev.status === 'running' || ev.status === 'success') {
      console.log(`  [Event] Node #${ev.nodeId} -> ${ev.status} (${ev.progress || 0}%)`);
    }
  });

  assert.strictEqual(linearResult.success, true, `Workflow phải thành công (lỗi: ${linearResult.error})`);

  // Kiểm tra video đầu ra
  const videoOut = linearResult.outputs['node-v']?.video;
  assert.ok(videoOut, 'Node video phải sinh ra đường dẫn video');
  console.log(`  -> Video tạo ra: ${videoOut}`);

  // Kiểm tra Last-frame
  const lastFrame = linearResult.outputs['node-v']?.last_frame;
  assert.ok(lastFrame, 'Node video phải trích xuất được last_frame');
  console.log(`  -> Last-frame trích xuất: ${lastFrame}`);

  // Kiểm tra Task Sub Mode được tạo
  const subTaskId = linearResult.outputs['node-sub']?.taskId;
  assert.ok(subTaskId, 'Node send-to-sub-mode phải sinh ra task ID trong TaskStore');
  console.log(`  -> Task ID sinh trong Sub Mode: ${subTaskId}`);

  console.log('  -> PASS: Luồng tuần tự chạy hoàn hảo.\n');

  // -------------------------------------------------------------
  // TEST 3: Cô lập lỗi (Fault Isolation)
  // -------------------------------------------------------------
  console.log('Test 3: Kiểm tra cô lập lỗi (Fault Isolation & Blocked Branch)...');
  const faultEvents: WorkflowNodeEvent[] = [];

  const faultGraph: WorkflowGraphData = {
    id: 'test_fault',
    name: 'Fault Graph',
    nodes: [
      // Nhánh A lỗi: export video nhưng không có input video
      {
        id: 'node-fault-export',
        data: {
          nodeType: 'export-video',
          category: 'output',
          label: 'Faulty Export',
          config: {},
        },
      },
      // Nhánh con của A: phụ thuộc node lỗi
      {
        id: 'node-child-of-fault',
        data: {
          nodeType: 'send-to-sub-mode',
          category: 'output',
          label: 'Dependent Child',
          config: {},
        },
      },
      // Nhánh B độc lập: Prompt văn bản độc lập
      {
        id: 'node-independent',
        data: {
          nodeType: 'text-prompt',
          category: 'input',
          label: 'Independent Prompt',
          config: { prompt: 'Independent text' },
        },
      },
    ],
    edges: [
      { id: 'ef1', source: 'node-fault-export', target: 'node-child-of-fault', sourceHandle: 'video', targetHandle: 'video_in' },
    ],
  };

  await engine.execute(faultGraph, (ev) => {
    faultEvents.push(ev);
  });

  const faultyNodeEv = faultEvents.find((e) => e.nodeId === 'node-fault-export' && e.status === 'failed');
  assert.ok(faultyNodeEv, 'Node lỗi phải nhận trạng thái failed');

  const blockedChildEv = faultEvents.find((e) => e.nodeId === 'node-child-of-fault' && e.status === 'blocked');
  assert.ok(blockedChildEv, 'Node con phụ thuộc nhánh lỗi phải bị đánh dấu blocked');

  const independentEv = faultEvents.find((e) => e.nodeId === 'node-independent' && e.status === 'success');
  assert.ok(independentEv, 'Nhánh độc lập không phụ thuộc vẫn phải hoàn thành (success)');

  console.log('  -> PASS: Cô lập lỗi chính xác, nhánh con bị blocked còn nhánh độc lập vẫn hoàn tất.\n');

  console.log('=== TOÀN BỘ CÁC BÀI TEST EXECUTION ENGINE ĐỀU PASS (3/3) ===');
}

runTests().catch((err) => {
  console.error('TEST THẤT BẠI:', err);
  process.exit(1);
});
