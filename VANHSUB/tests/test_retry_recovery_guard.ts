import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  ❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✅ PASS: ${msg}`);
}

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Cơ Chế Retry Recovery Guard & 3 Chế Độ Regenerate...\n');

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-guard-test-'));

  try {
    // --------------------------------------------------------------------------
    // Test 1: Kiểm tra logic nhận diện isRetryAttempt không bị lừa bởi dấu "_"
    // --------------------------------------------------------------------------
    console.log('--- Test 1: Logic nhận diện isRetryAttempt chuẩn xác ---');

    function checkIsRetry(attemptStr: string, retryIndex?: number): boolean {
      const lastToken = attemptStr.split('_').pop() || '0';
      const retryFromId = parseInt(lastToken, 10);
      const retryCount = retryIndex !== undefined ? retryIndex : (!isNaN(retryFromId) ? retryFromId : 0);
      return retryCount > 0;
    }

    assert(!checkIsRetry('scene_1_shot_1_v1_0'), 'Attempt 0 (scene_1_shot_1_v1_0) KHÔNG ĐƯỢC coi là retry dù có nhiều dấu "_"');
    assert(!checkIsRetry('scene_2_shot_3_v2_0'), 'Attempt 0 (scene_2_shot_3_v2_0) KHÔNG ĐƯỢC coi là retry');
    assert(checkIsRetry('scene_1_shot_1_v1_1'), 'Attempt 1 (scene_1_shot_1_v1_1) PHẢI là retry');
    assert(checkIsRetry('scene_2_shot_3_v2_2'), 'Attempt 2 (scene_2_shot_3_v2_2) PHẢI là retry');
    assert(!checkIsRetry('custom_id', 0), 'retryIndex = 0 ghi đè explicit -> không phải retry');
    assert(checkIsRetry('custom_id', 1), 'retryIndex = 1 ghi đè explicit -> là retry');

    // --------------------------------------------------------------------------
    // Test 2: Khóa chặn Canvas Baseline Snapshot (chống nhận nhầm ảnh cũ)
    // --------------------------------------------------------------------------
    console.log('\n--- Test 2: Bộ lọc Canvas Baseline Snapshot ---');

    // Giả lập Shot 1 đã tạo ảnh trước đó
    const preExistingTiles = [
      { src: 'https://flow-content.google/img_shot_1.png', alt: 'shot 1 illustration' }
    ];

    // Khi Shot 2 bắt đầu: chụp baseline
    const shot2Baseline = new Set(preExistingTiles.map(t => t.src));

    // Giả lập tình huống retry ở Shot 2: trên canvas chỉ có ảnh cũ của Shot 1
    const currentTilesAttempt1 = [
      { src: 'https://flow-content.google/img_shot_1.png', alt: 'shot 1 illustration' }
    ];
    const newItemsAttempt1 = currentTilesAttempt1.filter(t => !shot2Baseline.has(t.src));
    assert(newItemsAttempt1.length === 0, 'Ảnh cũ của Shot 1 nằm trong baseline -> BỊ TỪ CHỐI, không lấy làm kết quả Shot 2');

    // Giả lập Shot 2 thực sự sinh ra ảnh mới trên Flow
    const currentTilesAttempt2 = [
      { src: 'https://flow-content.google/img_shot_1.png', alt: 'shot 1 illustration' },
      { src: 'https://flow-content.google/img_shot_2_new.png', alt: 'shot 2 visual' }
    ];
    const newItemsAttempt2 = currentTilesAttempt2.filter(t => !shot2Baseline.has(t.src));
    assert(newItemsAttempt2.length === 1, 'Chỉ có ảnh mới xuất hiện sau baseline được chấp nhận');
    assert(newItemsAttempt2[0].src === 'https://flow-content.google/img_shot_2_new.png', 'Đúng URL ảnh mới của Shot 2');

    // --------------------------------------------------------------------------
    // Test 3: SHA-256 Checksum Deduplication Guard trước khi lưu index.json
    // --------------------------------------------------------------------------
    console.log('\n--- Test 3: SHA-256 Checksum Deduplication Guard ---');

    const storage = new AiStudioDiskStorageManager('proj_test', { baseDir: tmpBase });
    storage.ensureIndex();

    // Lưu Shot 1 hợp lệ
    const shot1File = path.join(tmpBase, 'shot_1_img_v1.png');
    fs.writeFileSync(shot1File, Buffer.from('UNIQUE_PIXEL_DATA_FOR_SHOT_1'));
    storage.updateShotMetadata('scene_1', 'shot_1', {
      current_image_version: 1,
      image_path: shot1File,
      status: 'image_ready',
    });

    function verifyChecksumGuard(
      newShotId: string,
      newFilePath: string,
      fileContent: Buffer
    ): { success: boolean; duplicateOf?: string } {
      fs.writeFileSync(newFilePath, fileContent);
      const currentChecksum = crypto.createHash('sha256').update(fileContent).digest('hex');

      const indexData = storage.readIndex();
      let duplicateShotId: string | null = null;

      for (const [sId, sc] of Object.entries(indexData.scenes || {})) {
        for (const [otherShotId, shotMeta] of Object.entries(sc.shots || {})) {
          if (otherShotId === newShotId) continue;
          if (shotMeta.image_path) {
            const otherAbs = storage.resolvePath(shotMeta.image_path);
            if (fs.existsSync(otherAbs)) {
              const otherBuf = fs.readFileSync(otherAbs);
              const otherChecksum = crypto.createHash('sha256').update(otherBuf).digest('hex');
              if (otherChecksum === currentChecksum) {
                duplicateShotId = otherShotId;
                break;
              }
            }
          }
        }
        if (duplicateShotId) break;
      }

      if (duplicateShotId) {
        // Tự xóa file trùng lặp
        if (fs.existsSync(newFilePath)) fs.unlinkSync(newFilePath);
        return { success: false, duplicateOf: duplicateShotId };
      }

      return { success: true };
    }

    // Case 3a: Shot 2 vô tình bị gán cùng nội dung của Shot 1 -> PHẢI BỊ BẮT
    const shot2DuplicateFile = path.join(tmpBase, 'shot_2_img_v1.png');
    const duplicateResult = verifyChecksumGuard(
      'shot_2',
      shot2DuplicateFile,
      Buffer.from('UNIQUE_PIXEL_DATA_FOR_SHOT_1') // trùng 100% với Shot 1
    );

    assert(!duplicateResult.success, 'Checksum guard PHẢI phát hiện file trùng lặp 100%');
    assert(duplicateResult.duplicateOf === 'shot_1', 'Phát hiện chính xác trùng với shot_1');
    assert(!fs.existsSync(shot2DuplicateFile), 'File trùng lặp phải bị xóa khỏi đĩa ngay lập tức');

    // Case 3b: Shot 2 có nội dung độc lập -> HỢP LỆ
    const shot2UniqueFile = path.join(tmpBase, 'shot_2_img_v1.png');
    const uniqueResult = verifyChecksumGuard(
      'shot_2',
      shot2UniqueFile,
      Buffer.from('COMPLETELY_DIFFERENT_PIXEL_DATA_FOR_SHOT_2')
    );
    assert(uniqueResult.success, 'Nội dung ảnh khác biệt -> Checksum guard cho phép lưu');
    assert(fs.existsSync(shot2UniqueFile), 'File hợp lệ được bảo toàn trên đĩa');

    // --------------------------------------------------------------------------
    // Test 4: Logic 3 chế độ chạy lại (resume_missing, regenerate_selected, regenerate_all)
    // --------------------------------------------------------------------------
    console.log('\n--- Test 4: Logic phân định 3 chế độ chạy lại ---');

    const allShots = [
      { id: 'shot_1', hasAsset: true },
      { id: 'shot_2', hasAsset: true },
      { id: 'shot_3', hasAsset: false },
      { id: 'shot_4', hasAsset: false },
    ];

    function filterShotsForRun(
      mode: 'resume_missing' | 'regenerate_selected' | 'regenerate_all',
      selectedIds?: string[]
    ) {
      const selectedSet = new Set(selectedIds || []);
      return allShots.map(s => {
        let shouldRun = false;
        let forceRegenerate = false;

        if (mode === 'regenerate_all') {
          shouldRun = true;
          forceRegenerate = true;
        } else if (mode === 'regenerate_selected') {
          shouldRun = selectedSet.has(s.id);
          forceRegenerate = selectedSet.has(s.id);
        } else {
          // resume_missing
          shouldRun = !s.hasAsset;
          forceRegenerate = false;
        }

        return { id: s.id, shouldRun, forceRegenerate };
      });
    }

    // Chế độ 1: resume_missing
    const resumeMissingResult = filterShotsForRun('resume_missing');
    assert(resumeMissingResult.filter(r => r.shouldRun).length === 2, 'resume_missing chỉ chạy 2 shot chưa có asset');
    assert(!resumeMissingResult.some(r => r.forceRegenerate), 'resume_missing không dùng forceRegenerate');

    // Chế độ 2: regenerate_all
    const regenerateAllResult = filterShotsForRun('regenerate_all');
    assert(regenerateAllResult.filter(r => r.shouldRun).length === 4, 'regenerate_all chạy toàn bộ 4 shots');
    assert(regenerateAllResult.every(r => r.forceRegenerate), 'regenerate_all bật forceRegenerate cho tất cả');

    // Chế độ 3: regenerate_selected (chọn shot_1 và shot_2)
    const regenerateSelectedResult = filterShotsForRun('regenerate_selected', ['shot_1', 'shot_2']);
    assert(regenerateSelectedResult.filter(r => r.shouldRun).length === 2, 'regenerate_selected chỉ chạy 2 shot được tick');
    assert(regenerateSelectedResult.find(r => r.id === 'shot_1')?.forceRegenerate === true, 'shot_1 được forceRegenerate');
    assert(regenerateSelectedResult.find(r => r.id === 'shot_3')?.shouldRun === false, 'shot_3 không được tick thì không chạy');

    console.log('\n📊 KẾT QUẢ: TẤT CẢ 4 TEST CASES ĐỀU ĐẠT CHUẨN (PASS)!');
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('Lỗi kiểm thử:', err);
  process.exit(1);
});
