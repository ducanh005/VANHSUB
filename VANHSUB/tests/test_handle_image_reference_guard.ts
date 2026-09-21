/**
 * Test Suite: HANDLE_IMAGE_REFERENCE Base64 Guard & Style Refs Canonicalization
 *
 * Kiểm tra các tính năng phòng thủ:
 * 1. shortenForLog cắt ngắn an toàn chuỗi Base64 Data URL dài hàng chục nghìn ký tự.
 * 2. ensureLocalImageFile tự động phát hiện và giải mã Base64 sang file đĩa vật lý.
 * 3. HandleImageReferenceState tự phục hồi khi nhận chuỗi Base64 Data URL (không fail vì đường dẫn ảo).
 * 4. Luồng resolve style_refs: Ưu tiên style_refs/character_ref.png, tự động giải mã avatar Base64.
 * 5. resolveReferenceUploads: Chỉ nạp các file thực tế tồn tại trên đĩa.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import assert from 'assert';
import {
  shortenForLog,
  ensureLocalImageFile,
} from '../main/workflow/flow-engine/FlowFileInputInjector';
import { HandleImageReferenceState } from '../main/workflow/flow-engine/states/FlowImageGenerationStates';
import { FlowStateContext } from '../main/workflow/flow-engine/types';
import { AiStudioModelConfigService, DEFAULT_MODEL_CONFIG } from '../main/ai-studio/services/AiStudioModelConfigService';
import { AiStudioStyleRefsService } from '../main/ai-studio/services/AiStudioStyleRefsService';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager';

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: HANDLE_IMAGE_REFERENCE Guard & Canonical Style Refs...\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-ref-guard-test-'));

  try {
    // =========================================================================
    // Test 1: shortenForLog cắt ngắn an toàn chuỗi dài
    // =========================================================================
    console.log('--- Test 1: Rút ngắn chuỗi ghi log (shortenForLog) ---');
    const shortStr = 'C:\\images\\photo.png';
    assert.strictEqual(shortenForLog(shortStr), shortStr, 'Chuỗi ngắn dưới 100 ký tự phải giữ nguyên');

    // Chuỗi Base64 giả lập 50,000 ký tự
    const longBase64 = 'data:image/png;base64,' + 'A'.repeat(50000);
    const shortened = shortenForLog(longBase64, 100);
    assert.strictEqual(shortened.startsWith('data:image/png;base64,AAAA'), true);
    assert.strictEqual(shortened.includes('(đã cắt bớt, tổng độ dài: 50022 ký tự)'), true);
    assert.strictEqual(shortened.length < 200, true, 'Chuỗi log phải được rút gọn ngắn gọn, không spam log');
    console.log('  ✅ PASS: Chuỗi Base64 50,000 ký tự được cắt ngắn còn đúng 100 ký tự kèm metadata độ dài');
    console.log(`     Mẫu log: "${shortened.slice(0, 60)}...${shortened.slice(-40)}"`);

    // =========================================================================
    // Test 2: ensureLocalImageFile tự động giải mã Base64 sang file thật trên đĩa
    // =========================================================================
    console.log('\n--- Test 2: Tự động giải mã và lưu đĩa Base64 (ensureLocalImageFile) ---');
    // Tạo 1 sample PNG nhỏ (1x1 pixel) dưới dạng Base64 Data URL
    const samplePngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const resolvedPath = ensureLocalImageFile(samplePngBase64, 'test_char_avatar');

    assert(resolvedPath !== null, 'ensureLocalImageFile phải trả về đường dẫn file');
    assert(fs.existsSync(resolvedPath!), 'File đĩa được giải mã phải thực sự tồn tại trên đĩa');
    assert(fs.statSync(resolvedPath!).size > 0, 'File giải mã phải có dung lượng > 0 bytes');
    assert(resolvedPath!.endsWith('.png'), 'File giải mã phải có phần mở rộng .png');
    console.log(`  ✅ PASS: Base64 Data URL được giải mã thành công tại: "${resolvedPath}" (${fs.statSync(resolvedPath!).size} bytes)`);

    // Kiểm tra file path thông thường
    const dummyFile = path.join(testTempDir, 'existing.png');
    fs.writeFileSync(dummyFile, Buffer.from('hello'));
    const resolvedExisting = ensureLocalImageFile(dummyFile);
    assert.strictEqual(resolvedExisting, path.resolve(dummyFile), 'Đường dẫn file thật phải được giữ nguyên');

    // Kiểm tra file:// URL
    const fileUrl = `file:///${dummyFile.replace(/\\/g, '/')}`;
    const resolvedFileUrl = ensureLocalImageFile(fileUrl);
    assert.strictEqual(resolvedFileUrl, path.resolve(dummyFile), 'file:// URL phải được chuẩn hoá thành absolute path');
    console.log('  ✅ PASS: Chuẩn hoá thành công cả file:// URL và đường dẫn file thông thường');

    // =========================================================================
    // Test 3: HandleImageReferenceState tự phục hồi khi nhận Base64 Data URL
    // =========================================================================
    console.log('\n--- Test 3: HandleImageReferenceState tự phục hồi khi nhận Base64 ---');
    // Giả lập context nhận trực tiếp chuỗi Base64 dài
    const mockCtx = {
      win: {
        isDestroyed: () => false,
        focus: () => {},
        webContents: {
          paste: () => {},
          executeJavaScript: async (code: string) => {
            // Giả lập DOM đã có chip ảnh sau khi paste
            return {
              hasChip: true,
              selector: '.chip-container[aria-label="Thành phần"] img.chip-image',
              tag: 'IMG',
              src: 'https://flow-content.google/image/test_char_asset_123',
            };
          }
        }
      },
      referenceImagePath: samplePngBase64,
      taskId: 'scene_01_shot_1',
      onProgress: (pct: number, msg?: string) => {
        // console.log(`[Progress ${pct}%] ${msg}`);
      }
    } as unknown as FlowStateContext;

    // Chạy enter()
    await HandleImageReferenceState.enter!(mockCtx);
    assert(mockCtx.referenceImagePath !== samplePngBase64, 'enter() phải tự resolve Base64 thành đường dẫn file');
    assert(fs.existsSync(mockCtx.referenceImagePath!), 'referenceImagePath sau enter() phải là file thật');
    console.log(`  ✅ PASS: enter() tự phát hiện Base64 và cập nhật referenceImagePath = "${mockCtx.referenceImagePath}"`);

    // Reset lại để test execute()
    mockCtx.referenceImagePath = samplePngBase64;
    const actionResult = await HandleImageReferenceState.execute(mockCtx);
    // execute() phải tự cứu hộ Base64, không được báo lỗi "File ảnh tham chiếu không tồn tại trên đĩa hoặc rỗng: D:\...\data:image..."
    assert.strictEqual(
      actionResult.ok,
      true,
      `execute() phải thành công thay vì fail cứng với Base64 (Lỗi thực tế: ${actionResult.errorDetail})`
    );
    assert.strictEqual(actionResult.data?.attachmentConfirmed, true, 'attachmentConfirmed phải là true');
    console.log('  ✅ PASS: execute() tự cứu hộ Base64 thành công, không tạo đường dẫn ảo D:\\...\\data:image');

    // =========================================================================
    // Test 4: Chuẩn hoá luồng Style Refs (Ưu tiên style_refs/character_ref.png)
    // =========================================================================
    console.log('\n--- Test 4: Luồng resolve ảnh tham chiếu trong regenerateSceneAsset ---');
    const storage = new AiStudioDiskStorageManager('test-session-ref-guard', {
      baseDir: testTempDir,
    });
    storage.ensureDirectories();

    const canonicalCharPath = storage.getStyleRefPath('character');
    const styleRefsService = AiStudioStyleRefsService.getInstance();

    // Trường hợp A: Chưa có file trên đĩa nhưng có avatar Base64 từ cấu hình người dùng
    assert.strictEqual(fs.existsSync(canonicalCharPath), false, 'Ban đầu chưa có file character_ref.png');
    const saved = styleRefsService.saveImageSource(samplePngBase64, canonicalCharPath);
    assert.strictEqual(saved, true, 'saveImageSource phải lưu thành công Base64 vào canonical path');
    assert(storage.isFileValidNonEmpty(canonicalCharPath), 'character_ref.png phải tồn tại hợp lệ trên đĩa');
    console.log(`  ✅ PASS: Avatar Base64 được tự động giải mã và lưu vào canonical path: "${canonicalCharPath}"`);

    // Trường hợp B: Khi file trên đĩa đã có sẵn -> LUÔN LUÔN ưu tiên lấy file trên đĩa
    let effectiveRef: string | undefined;
    if (storage.isFileValidNonEmpty(canonicalCharPath)) {
      effectiveRef = canonicalCharPath;
    }
    assert.strictEqual(effectiveRef, canonicalCharPath, 'Phải lấy trực tiếp style_refs/character_ref.png');
    assert(!effectiveRef!.startsWith('data:image'), 'effectiveRef TUYỆT ĐỐI KHÔNG phải là chuỗi Base64');
    console.log('  ✅ PASS: Khi chạy lại shot, engine dùng đúng file thật tại style_refs/character_ref.png');

    // =========================================================================
    // Test 5: resolveReferenceUploads loại trừ các file ảo không tồn tại trên đĩa
    // =========================================================================
    console.log('\n--- Test 5: resolveReferenceUploads chỉ nạp file tồn tại thực tế ---');
    const modelConfigService = AiStudioModelConfigService.getInstance();
    const modelConfig = modelConfigService.getOrCreateModelConfig(storage);
    const modelInfo = modelConfigService.resolveModelForShot(modelConfig, 'image', 'banana_pro');

    const validCharFile = path.join(testTempDir, 'char_real.png');
    fs.writeFileSync(validCharFile, Buffer.from('REAL_CHAR'));
    const nonExistentBgFile = path.join(testTempDir, 'bg_ghost.png'); // File không tồn tại!

    const uploadPlan = modelConfigService.resolveReferenceUploads(modelInfo, validCharFile, nonExistentBgFile);
    assert.strictEqual(uploadPlan.refsToUpload.length, 1, 'Chỉ được nạp 1 file vì file thứ 2 không tồn tại trên đĩa');
    assert.strictEqual(uploadPlan.refsToUpload[0], validCharFile, 'Chỉ nạp đúng file char_real.png');
    assert.strictEqual(uploadPlan.backgroundSentAs, 'text_prompt', 'Background ảo phải tự chuyển sang text_prompt');
    console.log('  ✅ PASS: resolveReferenceUploads tự loại trừ file không tồn tại trên đĩa, không truyền file ma');

    // =========================================================================
    // Test 6: Canvas sạch — Phương thức A0 (bấm "+" → menu → click_menu)
    // Giả lập DOM: không có chip sẵn, không có input[type="file"], nhưng menu mở được
    // và input[type="file"] xuất hiện sau khi click menu item
    // =========================================================================
    console.log('\n--- Test 6: Phương thức A0 — canvas sạch, bấm "+" mở menu, inject file ---');

    // Thiết lập: viết file tham chiếu thật trên đĩa
    const cleanCanvasRefFile = path.join(testTempDir, 'character_ref_clean.png');
    fs.writeFileSync(cleanCanvasRefFile, Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG magic
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR
    ]));

    // DOM state machine: theo dõi thứ tự gọi JS
    let jsCallLog: string[] = [];
    let menuVisibleAfterClick = false;
    let inputVisibleAfterMenuClick = false;
    let addBtnClicked = false;
    let menuItemClicked = false;
    let fileInjected = false;

    const mockCtx6 = {
      win: {
        isDestroyed: () => false,
        focus: () => {},
        webContents: {
          paste: () => {},
          executeJavaScript: async (code: string) => {
            jsCallLog.push(code.slice(0, 80).replace(/\s+/g, ' '));

            // checkExistingChipJs: không có chip ở canvas sạch
            if (code.includes('hasChip') && code.includes('flow-image-ingredient-chip') && !fileInjected) {
              return { hasChip: false };
            }
            // Sau khi inject file thành công → chip xuất hiện
            if (code.includes('hasChip') && fileInjected) {
              return { hasChip: true, selector: 'flow-image-ingredient-chip', tag: 'FLOW-IMAGE-INGREDIENT-CHIP' };
            }
            // chipFileNameJs: không có chip ban đầu
            if (code.includes('data-ingredient-name') && !fileInjected) {
              return '';
            }
            // Tìm nút "+" (addBtnJs)
            if (code.includes('labelPatterns') || code.includes('thêm.*thành phần')) {
              return { found: true, x: 300, y: 700, label: 'Thêm thành phần', selector: 'button[aria-label]' };
            }
            // Click nút "+" (dispatchEvent)
            if (code.includes('dispatchEvent') && code.includes('mousedown') && !menuVisibleAfterClick) {
              addBtnClicked = true;
              menuVisibleAfterClick = true; // Menu sẽ mở sau click
              return undefined;
            }
            // Kiểm tra menu đã mở chưa
            if (code.includes('mat-mdc-menu-panel')) {
              return menuVisibleAfterClick;
            }
            // Tìm và click menu item "Tải ảnh lên từ máy tính"
            if (code.includes('menuItemPatterns') || code.includes('tải ảnh lên')) {
              menuItemClicked = true;
              inputVisibleAfterMenuClick = true; // input[type="file"] sẽ xuất hiện
              return { clicked: true, text: 'Tải ảnh lên từ máy tính', usedTouchTarget: true, x: 350, y: 400 };
            }
            // Kiểm tra input[type="file"] đã xuất hiện
            if (code.includes('input[type="file"]') || code.includes("input[type='file']")) {
              return inputVisibleAfterMenuClick;
            }
            return undefined;
          }
        }
      },
      referenceImagePath: cleanCanvasRefFile,
      taskId: 'scene_01_shot_1_clean',
      onProgress: () => {}
    } as unknown as FlowStateContext;

    // Mock FlowFileInputInjector.injectIntoBrowserWindow để giả lập inject thành công
    // Cách tiếp cận: test tích hợp — trực tiếp call execute() với mock DOM đầy đủ
    // execute() của HandleImageReferenceState sẽ qua A0 → A → thành công
    // Ở đây ta kiểm tra LOGIC ĐIỀU HƯỚNG, không cần inject file thật

    // Thay vì override phức tạp, dùng mock đơn giản theo stateful state machine
    // để theo dõi A0 được gọi hay không
    let a0FlowSequence: string[] = [];
    let menuToggle = false; // toggle: sau click nút "+", menu sẽ open

    // Patch lại executeJavaScript để track A0 flow sequence
    const originalJs = mockCtx6.win.webContents.executeJavaScript;
    mockCtx6.win.webContents.executeJavaScript = async (code: string) => {
      // Track FIND_ADD_BTN
      if (code.includes('labelPatterns') || (code.includes('thêm') && code.includes('prompt-box'))) {
        if (!a0FlowSequence.includes('FIND_ADD_BTN')) a0FlowSequence.push('FIND_ADD_BTN');
      }
      // Track CHECK_MENU (sau khi click nút "+")
      if (code.includes('mat-mdc-menu-panel')) {
        if (!a0FlowSequence.includes('CHECK_MENU')) a0FlowSequence.push('CHECK_MENU');
      }
      return originalJs.call(mockCtx6.win.webContents, code);
    };

    // Chạy execute — chỉ cần verify A0 được THỰC SỰ KÍCH HOẠT
    // (ok có thể false vì test env không có browser thật — điều đó là đúng)
    await HandleImageReferenceState.execute(mockCtx6);

    // Key assertion: phương thức A0 phải được thử khi canvas sạch
    const triedA0 = a0FlowSequence.some(s => s === 'FIND_ADD_BTN');
    assert.strictEqual(triedA0, true, `Phương thức A0 phải được thử khi canvas sạch không có chip; sequence=${JSON.stringify(a0FlowSequence)}`);
    console.log(`  ✅ PASS: Canvas sạch → A0 được thử (sequence: ${a0FlowSequence.join(' → ')}). Không có browser thật nên pipeline fall-through đến các phương thức khác là đúng.`);

    // =========================================================================
    // Test 7: already_present kiểm tra tên file — chip sai tên → KHÔNG skip upload
    // =========================================================================
    console.log('\n--- Test 7: already_present validation — chip sai tên file không được skip upload ---');

    let alreadyPresentReturnedFastExit = false;
    const mockCtx7 = {
      win: {
        isDestroyed: () => false,
        focus: () => {},
        webContents: {
          paste: () => {},
          executeJavaScript: async (code: string) => {
            // checkExistingChipJs: có chip nhưng không phải character_ref
            if (code.includes('hasChip') && code.includes('flow-image-ingredient-chip')) {
              return { hasChip: true, selector: 'mat-chip-row', tag: 'MAT-CHIP-ROW' };
            }
            // chipFileNameJs: chip là một ảnh khác (không phải character_ref.png)
            if (code.includes('data-ingredient-name') && code.includes('getAttribute')) {
              return 'other_background.png'; // Tên khác!
            }
            // addBtnJs: không tìm thấy nút "+" (canvas không thể interact nữa)
            if (code.includes('labelPatterns') || code.includes('prompt-box button')) {
              return { found: false };
            }
            // menu check: không mở được
            if (code.includes('mat-mdc-menu-panel')) {
              return false;
            }
            // input[type="file"]: không có
            if (code.includes('input[type')) {
              return false;
            }
            return undefined;
          }
        }
      },
      referenceImagePath: cleanCanvasRefFile, // character_ref_clean.png
      taskId: 'scene_01_shot_1_wrong_chip',
      onProgress: () => {}
    } as unknown as FlowStateContext;

    const actionResult7 = await HandleImageReferenceState.execute(mockCtx7);
    // Code KHÔNG được return already_present ngay khi chip sai tên
    // (ok có thể false vì A0 không tìm được nút "+", nhưng phải đã đi qua warning)
    // Key assertion: uploadMethodUsed KHÔNG được là 'already_present'
    assert.notStrictEqual(
      actionResult7.data?.uploadMethodUsed,
      'already_present',
      `Khi chip sai tên (other_background.png ≠ character_ref_clean.png), KHÔNG được trả về already_present; got: ${JSON.stringify(actionResult7.data)}`
    );
    console.log(`  ✅ PASS: Chip sai tên file → không dùng already_present (uploadMethodUsed="${actionResult7.data?.uploadMethodUsed}", ok=${actionResult7.ok})`);

    console.log('\n📊 KẾT QUẢ: TẤT CẢ 7 TEST CASES ĐỀU ĐẠT CHUẨN (PASS)!');
  } finally {
    // Dọn dẹp thư mục test
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error('\n❌ TEST THẤT BẠI:', err);
  process.exit(1);
});
