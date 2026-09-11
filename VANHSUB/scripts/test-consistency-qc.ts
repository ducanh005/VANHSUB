import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { BibleStore } from '../main/store/bibleStore';
import { QcEngine } from '../main/workflow/qcEngine';
import { WorkflowExecutionEngine, type WorkflowGraphData } from '../main/workflow/executionEngine';

async function runConsistencyTests() {
  console.log('=== BẮT ĐẦU KIỂM THỬ CONSISTENCY SYSTEM & QC ENGINE (PHASE 3) ===\n');

  // -------------------------------------------------------------
  // TEST 1: BibleStore Character CRUD
  // -------------------------------------------------------------
  console.log('Test 1: Kiểm tra Character Bible CRUD trong BibleStore...');
  const initialChars = BibleStore.getCharacters();
  assert.ok(initialChars.length >= 2, 'Phải có ít nhất 2 nhân vật mẫu ban đầu');

  const createdChar = BibleStore.saveCharacter({
    name: 'Chiến binh Sơn Tinh',
    description: 'Vị thần núi Tản Viên, vóc dáng uy nghi, giáp đồng cổ truyền.',
    gender: 'male',
    ageGroup: '30 tuổi',
    lockedSeed: 999111,
  });
  assert.ok(createdChar.id, 'Nhân vật mới phải được cấp ID');
  assert.strictEqual(createdChar.name, 'Chiến binh Sơn Tinh');

  const retrievedChar = BibleStore.getCharacterById(createdChar.id);
  assert.ok(retrievedChar, 'Phải tìm thấy nhân vật qua ID');
  assert.strictEqual(retrievedChar.lockedSeed, 999111);

  // Update
  const updatedChar = BibleStore.saveCharacter({
    id: createdChar.id,
    name: 'Sơn Tinh Đại Vương',
    gender: 'male',
  });
  assert.strictEqual(updatedChar.name, 'Sơn Tinh Đại Vương');

  // Delete
  BibleStore.deleteCharacter(createdChar.id);
  const deletedChar = BibleStore.getCharacterById(createdChar.id);
  assert.strictEqual(deletedChar, undefined, 'Nhân vật đã xóa không được tồn tại');
  console.log('  -> PASS: Character Bible CRUD hoạt động chính xác.\n');

  // -------------------------------------------------------------
  // TEST 2: BibleStore Scene CRUD
  // -------------------------------------------------------------
  console.log('Test 2: Kiểm tra Scene Bible CRUD trong BibleStore...');
  const initialScenes = BibleStore.getScenes();
  assert.ok(initialScenes.length >= 2, 'Phải có ít nhất 2 bối cảnh mẫu ban đầu');

  const createdScene = BibleStore.saveScene({
    name: 'Đỉnh núi Tản Viên sương mờ',
    description: 'Bối cảnh rừng núi cổ đại hùng vĩ, mây bồng bềnh phủ quanh các đỉnh đá nhọn.',
    environment: 'outdoor',
    lightingMood: 'Golden cinematic dawn mist',
    colorPalette: 'warm_golden',
  });
  assert.ok(createdScene.id, 'Bối cảnh mới phải được cấp ID');
  assert.strictEqual(createdScene.name, 'Đỉnh núi Tản Viên sương mờ');

  const retrievedScene = BibleStore.getSceneById(createdScene.id);
  assert.ok(retrievedScene, 'Phải tìm thấy cảnh qua ID');
  assert.strictEqual(retrievedScene.colorPalette, 'warm_golden');

  // Delete
  BibleStore.deleteScene(createdScene.id);
  const deletedScene = BibleStore.getSceneById(createdScene.id);
  assert.strictEqual(deletedScene, undefined, 'Bối cảnh đã xóa không được tồn tại');
  console.log('  -> PASS: Scene Bible CRUD hoạt động chính xác.\n');

  // -------------------------------------------------------------
  // TEST 3: QcEngine Image Analysis & Evaluation
  // -------------------------------------------------------------
  console.log('Test 3: Kiểm tra QcEngine so khớp frame và tính toán độ tương đồng...');
  const testDir = path.join(os.tmpdir(), `vanhsub_qc_test_${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });

  // Tạo 2 tệp ảnh giả lập bằng buffer
  const frame1Path = path.join(testDir, 'frame1.jpg');
  const frame2Path = path.join(testDir, 'frame2.jpg');
  const frameDiffPath = path.join(testDir, 'frame_diff.jpg');

  // Frame 1: Pattern RGB chủ đạo tone đỏ-ấm
  const buf1 = Buffer.alloc(12000);
  for (let i = 0; i < buf1.length; i += 3) {
    buf1[i] = 220; // R
    buf1[i + 1] = 100; // G
    buf1[i + 2] = 50; // B
  }
  fs.writeFileSync(frame1Path, buf1);

  // Frame 2: Bản sao giống hệt Frame 1
  fs.writeFileSync(frame2Path, buf1);

  // Frame Diff: Tone xanh dương lạnh hoàn toàn khác
  const bufDiff = Buffer.alloc(12000);
  for (let i = 0; i < bufDiff.length; i += 3) {
    bufDiff[i] = 20; // R
    bufDiff[i + 1] = 80; // G
    bufDiff[i + 2] = 230; // B
  }
  fs.writeFileSync(frameDiffPath, bufDiff);

  // 3a. So khớp giống hệt
  const exactResult = await QcEngine.evaluate(frame1Path, frame2Path);
  assert.strictEqual(exactResult.passed, true, 'Hai frame giống hệt nhau phải đạt QC');
  assert.strictEqual(exactResult.score, 100, 'Điểm số của 2 frame giống hệt phải là 100%');
  assert.strictEqual(exactResult.colorDelta, 0, 'Độ lệch màu giữa 2 frame giống hệt phải là 0%');
  assert.strictEqual(exactResult.status, 'pass');
  console.log('  -> 3a. So khớp 2 frame đồng nhất: Score 100%, Color Delta 0% (PASS)');

  // 3b. So khớp khác biệt màu sắc
  const diffResult = await QcEngine.evaluate(frame1Path, frameDiffPath, {
    faceSimilarityThreshold: 85,
    colorTolerance: 15,
    autoReject: true,
  });
  assert.strictEqual(diffResult.passed, false, 'Hai frame khác biệt lớn phải trượt QC khi autoReject: true');
  assert.ok(diffResult.colorDelta > 15, `Độ lệch màu phải vượt ngưỡng tolerance (nhận được: ${diffResult.colorDelta}%)`);
  assert.strictEqual(diffResult.status, 'fail');
  console.log(`  -> 3b. So khớp 2 frame lệch màu: Score ${diffResult.score}%, Color Delta ${diffResult.colorDelta}% (REJECTED/FAIL)`);

  // 3c. Fallback simulation khi đường dẫn không tồn tại
  const simResult = await QcEngine.evaluate('nonexistent_a.jpg', 'nonexistent_b.jpg');
  assert.strictEqual(simResult.passed, true, 'Simulation fallback phải trả về an toàn');
  console.log('  -> 3c. Fallback an toàn khi file vắng mặt: Hoạt động chính xác.\n');

  // -------------------------------------------------------------
  // TEST 4: Workflow Execution Engine với các node Phase 3
  // -------------------------------------------------------------
  console.log('Test 4: Kiểm tra Workflow DAG chứa character-lock, style-lock, scene-continuity, qc-check...');
  const engine = new WorkflowExecutionEngine();

  const phase3Graph: WorkflowGraphData = {
    id: 'test_phase3_graph',
    name: 'Phase 3 Consistency Pipeline',
    nodes: [
      {
        id: 'node-char',
        data: {
          nodeType: 'character-lock',
          category: 'consistency',
          label: 'Khóa Nhân Vật',
          config: {
            characterName: 'Điệp viên Vanh',
            faceWeight: 0.95,
            costumeLock: true,
          },
        },
      },
      {
        id: 'node-style',
        data: {
          nodeType: 'style-lock',
          category: 'consistency',
          label: 'Khóa Phong Cách',
          config: {
            colorPalette: 'cyberpunk',
            lensType: 'anamorphic_35mm',
          },
        },
      },
      {
        id: 'node-scene',
        data: {
          nodeType: 'scene-continuity',
          category: 'consistency',
          label: 'Liên Tục Bối Cảnh',
          config: {
            sceneName: 'Phố cổ Hà Nội',
            timeOfDay: 'night',
          },
        },
      },
      {
        id: 'node-video',
        data: {
          nodeType: 'google-flow-video',
          category: 'model',
          label: 'Sinh Video Veo Shot 1',
          config: {
            prompt: 'Agent walking through rain in Cyberpunk Hanoi',
            durationSeconds: 2,
          },
        },
      },
      {
        id: 'node-qc',
        data: {
          nodeType: 'qc-check',
          category: 'consistency',
          label: 'Kiểm Định QC Nhất Quán',
          config: {
            faceSimilarityThreshold: 80,
            colorTolerance: 20,
            autoReject: false,
          },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'node-char', target: 'node-video', sourceHandle: 'character_locked', targetHandle: 'prompt' },
      { id: 'e2', source: 'node-video', target: 'node-qc', sourceHandle: 'last_frame', targetHandle: 'shot_a' },
      { id: 'e3', source: 'node-video', target: 'node-qc', sourceHandle: 'last_frame', targetHandle: 'shot_b' },
    ],
  };

  const execRes = await engine.execute(phase3Graph, (ev) => {
    if (ev.status === 'success') {
      console.log(`    [Node Event] ${ev.nodeId} -> SUCCESS`);
    }
  });

  assert.strictEqual(execRes.success, true, 'Workflow Phase 3 phải thực thi thành công');

  const charOut = execRes.outputs['node-char'];
  assert.ok(charOut.character_locked, 'Node character-lock phải sinh character_locked');
  assert.strictEqual(charOut.character_locked.isLocked, true);

  const styleOut = execRes.outputs['node-style'];
  assert.ok(styleOut.style_out.includes('cyberpunk'), 'Node style-lock phải có style_out token');

  const sceneOut = execRes.outputs['node-scene'];
  assert.strictEqual(sceneOut.scene_out.timeOfDay, 'night');

  const qcOut = execRes.outputs['node-qc'];
  assert.ok(qcOut.qc_passed !== undefined, 'Node qc-check phải trả về qc_passed');
  assert.strictEqual(qcOut.qc_passed, true);
  console.log(`  -> PASS: Toàn bộ node Phase 3 đã thực thi và tạo output chuẩn xác. Điểm QC: ${qcOut.similarityScore}%\n`);

  // Dọn dẹp thư mục tạm
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}

  console.log('=== TẤT CẢ CÁC BÀI TEST PHASE 3 ĐỀU THÀNH CÔNG RỰC RỠ! ===\n');
}

runConsistencyTests().catch((err) => {
  console.error('TEST PHASE 3 THẤT BẠI:', err);
  process.exit(1);
});
