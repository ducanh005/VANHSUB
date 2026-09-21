import assert from 'assert';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { AiStudioStoryboardService } from '../main/ai-studio/services/AiStudioStoryboardService.js';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager.js';

async function runShotModeTests() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  TEST: Storyboard Shot Mode Verification (1:1 vs Multi-shot)');
  console.log('════════════════════════════════════════════════════════════════\n');

  const projectId = `test_shot_mode_${Date.now()}`;
  const tempDir = path.join(os.tmpdir(), projectId);
  const storage = new AiStudioDiskStorageManager(projectId, { baseDir: tempDir, autoInitialize: true });

  const script = {
    project_id: projectId,
    scenes: [
      {
        scene_id: 'scene_01',
        narration: 'Chào mừng các bạn đến với video phân tích kiến trúc AI thế hệ mới với nhiều tính năng vượt trội.',
        visual_note: 'Toàn cảnh phòng lab công nghệ tương lai với ánh sáng neon xanh lam',
      },
      {
        scene_id: 'scene_02',
        narration: 'Hôm nay chúng ta sẽ đi sâu vào mô hình hoạt động của hệ thống xử lý song song.',
        visual_note: 'Cận cảnh chip xử lý bán dẫn phát sáng',
      },
      {
        scene_id: 'scene_03',
        narration: 'Cuối cùng là phần kết luận và các bước triển khai thực tế trên hạ tầng đám mây.',
        visual_note: 'Góc máy quay lướt qua trung tâm dữ liệu khổng lồ',
      },
    ],
  };

  const timing = {
    project_id: projectId,
    scenes: [
      { scene_id: 'scene_01', audio_file: '02_voice/scene_01.mp3', start_sec: 0, end_sec: 12.0, duration_sec: 12.0 },
      { scene_id: 'scene_02', audio_file: '02_voice/scene_02.mp3', start_sec: 12.0, end_sec: 20.0, duration_sec: 8.0 },
      { scene_id: 'scene_03', audio_file: '02_voice/scene_03.mp3', start_sec: 20.0, end_sec: 35.0, duration_sec: 15.0 },
    ],
    total_duration_sec: 35.0,
  };

  storage.saveScript(script);
  storage.saveTiming(timing);

  const service = AiStudioStoryboardService.getInstance();

  // --------------------------------------------------------------------------
  // TEST 1: Single-shot Mode (1:1 per scene)
  // --------------------------------------------------------------------------
  console.log('▶ Test 1: Single-shot mode (shotMode: "single") - 1:1 per sentence');
  const singleSb = await service.generateStoryboard({
    storage,
    script,
    timing,
    shotMode: 'single',
  });

  assert.strictEqual(singleSb.scenes.length, 3, 'Phải có đúng 3 phân cảnh');
  assert.strictEqual(singleSb.scenes[0].shots.length, 1, 'Scene 1 (12s) phải có đúng 1 shot');
  assert.strictEqual(singleSb.scenes[0].shots[0].shot_id, 'scene_01_shot_1');
  assert.strictEqual(singleSb.scenes[0].shots[0].expected_duration_sec, 12.0);

  assert.strictEqual(singleSb.scenes[1].shots.length, 1, 'Scene 2 (8s) phải có đúng 1 shot');
  assert.strictEqual(singleSb.scenes[1].shots[0].shot_id, 'scene_02_shot_1');
  assert.strictEqual(singleSb.scenes[1].shots[0].expected_duration_sec, 8.0);

  assert.strictEqual(singleSb.scenes[2].shots.length, 1, 'Scene 3 (15s) phải có đúng 1 shot');
  assert.strictEqual(singleSb.scenes[2].shots[0].shot_id, 'scene_03_shot_1');
  assert.strictEqual(singleSb.scenes[2].shots[0].expected_duration_sec, 15.0);

  const totalSingleShots = singleSb.scenes.reduce((acc, sc) => acc + sc.shots.length, 0);
  assert.strictEqual(totalSingleShots, 3, 'Tổng số shot trong single mode phải bằng chính xác 3 (1:1)');
  console.log('  ✓ [PASS] Single-shot mode thành công: 3 câu kịch bản -> chính xác 3 phân cảnh visual (1:1)\n');

  // --------------------------------------------------------------------------
  // TEST 2: Multi-shot Mode (shotMode: "multi")
  // --------------------------------------------------------------------------
  console.log('▶ Test 2: Multi-shot mode (shotMode: "multi") - Cinematic decomposition');
  const multiSb = await service.generateStoryboard({
    storage,
    script,
    timing,
    shotMode: 'multi',
  });

  assert.strictEqual(multiSb.scenes.length, 3, 'Phải có 3 phân cảnh cha');
  assert.strictEqual(multiSb.scenes[0].shots.length, 3, 'Scene 1 (12s) trong multi mode phải chia thành 3 shots');
  assert.strictEqual(multiSb.scenes[1].shots.length, 2, 'Scene 2 (8s) trong multi mode phải chia thành 2 shots');
  assert.strictEqual(multiSb.scenes[2].shots.length, 4, 'Scene 3 (15s) trong multi mode phải chia thành 4 shots');

  // Kiểm tra tính toàn vẹn thời lượng
  for (const sc of multiSb.scenes) {
    const sumDur = sc.shots.reduce((acc, s) => acc + s.expected_duration_sec, 0);
    assert(Math.abs(sumDur - sc.duration_sec) <= 0.1, `Tổng thời lượng shots (${sumDur}) phải khớp thời lượng cảnh (${sc.duration_sec})`);
  }
  console.log('  ✓ [PASS] Multi-shot mode thành công: 3 câu thoại dài chia thành 3 + 2 + 4 = 9 shots chuẩn xác\n');

  // Dọn dẹp temp dir
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  console.log('════════════════════════════════════════════════════════════════');
  console.log('  TẤT CẢ CÁC BÀI TEST CHẾ ĐỘ PHÂN CẢNH ĐỀU ĐẠT 100%!');
  console.log('════════════════════════════════════════════════════════════════');
}

runShotModeTests().catch((err) => {
  console.error('Test thất bại:', err);
  process.exit(1);
});
