import fs from 'fs';
import path from 'path';
import os from 'os';
import { AiStudioStyleRefsService } from '../main/ai-studio/services/AiStudioStyleRefsService';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager';
import { FlowElementFinder } from '../main/workflow/flow-engine/FlowElementFinder';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  ❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✅ PASS: ${msg}`);
}

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Nhánh user_provided và phân tách nút Flow...\n');

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-test-'));

  try {
    // --------------------------------------------------------------------------
    // Test 1: User cung cấp ảnh qua đường dẫn file cục bộ
    // --------------------------------------------------------------------------
    console.log('--- Case 1: Người dùng cung cấp đường dẫn file cục bộ ---');
    const dummyUserChar = path.join(tmpBase, 'user_char.png');
    const dummyUserBg = path.join(tmpBase, 'user_bg.png');
    fs.writeFileSync(dummyUserChar, Buffer.from('FAKE_PNG_CHARACTER_DATA'));
    fs.writeFileSync(dummyUserBg, Buffer.from('FAKE_PNG_BACKGROUND_DATA'));

    const storage1 = new AiStudioDiskStorageManager('proj1', { baseDir: tmpBase });
    const service = AiStudioStyleRefsService.getInstance();

    const res1 = await service.ensureStyleRefs({
      storage: storage1,
      userCharacterImagePath: dummyUserChar,
      userBackgroundImagePath: dummyUserBg,
    });

    assert(res1.manifest.source === 'user_provided', 'Manifest source phải là "user_provided"');
    assert(fs.existsSync(res1.characterRefPath), 'character_ref.png phải tồn tại trên đĩa');
    assert(fs.readFileSync(res1.characterRefPath, 'utf-8') === 'FAKE_PNG_CHARACTER_DATA', 'Nội dung character_ref.png phải khớp với file user');
    assert(fs.existsSync(res1.backgroundRefPath), 'background_ref.png phải tồn tại trên đĩa');
    assert(fs.readFileSync(res1.backgroundRefPath, 'utf-8') === 'FAKE_PNG_BACKGROUND_DATA', 'Nội dung background_ref.png phải khớp với file user');

    // --------------------------------------------------------------------------
    // Test 2: User cung cấp ảnh qua Base64 Data URL (từ AutoPilotView upload)
    // --------------------------------------------------------------------------
    console.log('\n--- Case 2: Người dùng cung cấp qua Base64 Data URL ---');
    const storage2 = new AiStudioDiskStorageManager('proj2', { baseDir: tmpBase });

    const base64Data = 'data:image/png;base64,' + Buffer.from('BASE64_AVATAR_CONTENT').toString('base64');

    const res2 = await service.ensureStyleRefs({
      storage: storage2,
      userCharacterImagePath: base64Data,
      userBackgroundImagePath: dummyUserBg,
    });

    assert(res2.manifest.source === 'user_provided', 'Manifest source với Base64 phải là "user_provided"');
    assert(fs.existsSync(res2.characterRefPath), 'character_ref.png giải mã từ Base64 phải tồn tại');
    assert(fs.readFileSync(res2.characterRefPath, 'utf-8') === 'BASE64_AVATAR_CONTENT', 'Nội dung character_ref.png giải mã phải chính xác');

    // --------------------------------------------------------------------------
    // Test 3: Project đã có sẵn character_ref.png trong style_refs/
    // --------------------------------------------------------------------------
    console.log('\n--- Case 3: Project đã có sẵn ảnh trong style_refs/ ---');
    const storage3 = new AiStudioDiskStorageManager('proj3', { baseDir: tmpBase });
    fs.writeFileSync(storage3.getStyleRefPath('character'), Buffer.from('PRE_EXISTING_CHARACTER'));

    const res3 = await service.ensureStyleRefs({
      storage: storage3,
      userBackgroundImagePath: dummyUserBg,
    });

    assert(res3.manifest.source === 'user_provided', 'Manifest source khi có sẵn ảnh phải là "user_provided"');
    assert(fs.readFileSync(res3.characterRefPath, 'utf-8') === 'PRE_EXISTING_CHARACTER', 'Ảnh có sẵn trong style_refs/ không bị ghi đè');

    // --------------------------------------------------------------------------
    // Test 4: Phân biệt nút Settings Trigger và Nút Thêm (+)
    // --------------------------------------------------------------------------
    console.log('\n--- Case 4: Phân biệt getSettingsTriggerSpec và getAddMediaButtonSpec ---');
    const settingsSpec = FlowElementFinder.getSettingsTriggerSpec();
    const addMediaSpec = FlowElementFinder.getAddMediaButtonSpec();

    assert(settingsSpec.name === 'SETTINGS_TRIGGER_BUTTON', 'Settings spec có name đúng');
    assert(addMediaSpec.name === 'ADD_MEDIA_BUTTON', 'Add media spec có name đúng');

    // Đảm bảo không có selector generic button:has(mat-icon) trong settingsSpec
    const allSettingsSelectors = settingsSpec.rules.flatMap(r => r.selectors);
    const hasLooseMatIcon = allSettingsSelectors.some(s => s === 'button:has(mat-icon)');
    assert(!hasLooseMatIcon, 'Settings Trigger TUYỆT ĐỐI KHÔNG chứa selector lỏng lẻo "button:has(mat-icon)"');

    // Đảm bảo getAddMediaButtonSpec có selector cho nút + / add-menu-trigger
    const allAddSelectors = addMediaSpec.rules.flatMap(r => r.selectors);
    const hasAddMenuTrigger = allAddSelectors.some(s => s.includes('add-menu-trigger') || s.includes('thêm'));
    assert(hasAddMenuTrigger, 'Add Media Spec phải chứa selector add-menu-trigger hoặc "thêm"');

    console.log('\n📊 KẾT QUẢ: TẤT CẢ TEST CASES ĐỀU ĐẠT CHUẨN (PASS)!');
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('Lỗi khi chạy kiểm thử:', err);
  process.exit(1);
});
