import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { sanitizeProjectName, GoogleVeoSessionManager } from '../main/veo/GoogleVeoSessionManager';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager';

console.log('--- BẮT ĐẦU KIỂM THỬ SANITIZE PROJECT NAME, VERIFY RENAME & FALLBACK LOGIC ---');

// Test Case 1: Chuỗi tên đề tài bình thường
const name1 = 'Lịch Sử Việt Nam - Triều Lý';
assert.strictEqual(sanitizeProjectName(name1), 'Lịch Sử Việt Nam - Triều Lý', 'TC1 thất bại');
console.log('✅ TC1: Tên tiếng Việt thông thường được bảo toàn.');

// Test Case 2: Chuỗi chứa ký tự đặc biệt nguy hiểm cho file/DOM
const name2 = 'Dự Án: <Full HD> "Lý Thường Kiệt" / Trận Như Nguyệt? *Vip*';
const sanitized2 = sanitizeProjectName(name2);
assert.strictEqual(sanitized2.includes('<'), false, 'TC2: Còn chứa dấu <');
assert.strictEqual(sanitized2.includes('>'), false, 'TC2: Còn chứa dấu >');
assert.strictEqual(sanitized2.includes(':'), false, 'TC2: Còn chứa dấu :');
assert.strictEqual(sanitized2.includes('"'), false, 'TC2: Còn chứa dấu "');
assert.strictEqual(sanitized2.includes('?'), false, 'TC2: Còn chứa dấu ?');
assert.strictEqual(sanitized2.includes('*'), false, 'TC2: Còn chứa dấu *');
console.log(`✅ TC2: Sanitize ký tự đặc biệt thành công: "${sanitized2}"`);

// Test Case 3: Chuỗi quá dài (> 60 ký tự)
const name3 = 'Dự Án Video Rất Dài Về Lịch Sử Kháng Chiến Chống Ngoại Xâm Của Dân Tộc Việt Nam Qua Các Thời Kỳ Lịch Sử';
const sanitized3 = sanitizeProjectName(name3);
assert.ok(sanitized3.length <= 60, `TC3 thất bại: độ dài ${sanitized3.length} > 60`);
console.log(`✅ TC3: Cắt ngắn chuỗi dài an toàn (độ dài: ${sanitized3.length}): "${sanitized3}"`);

// Test Case 4: Chuỗi rỗng hoặc undefined
assert.strictEqual(sanitizeProjectName(''), 'Video Project', 'TC4.1 thất bại');
assert.strictEqual(sanitizeProjectName(undefined), 'Video Project', 'TC4.2 thất bại');
assert.strictEqual(sanitizeProjectName('   '), 'Video Project', 'TC4.3 thất bại');
console.log('✅ TC4: Fallback về "Video Project" khi tên rỗng hoặc undefined.');

// Test Case 5: Chuỗi có nhiều khoảng trắng thừa và dòng mới
const name5 = '   Đại   Việt   \n\r   Sử   Ký   \t   Toàn Thư   ';
const sanitized5 = sanitizeProjectName(name5);
assert.strictEqual(sanitized5, 'Đại Việt Sử Ký Toàn Thư', 'TC5 thất bại');
console.log(`✅ TC5: Chuẩn hóa khoảng trắng và newline thành công: "${sanitized5}"`);

// Test Case 6: Lưu và đọc flow_asset_url vào index.json của DiskStorageManager
const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-asset-test-'));
try {
  const storage = new AiStudioDiskStorageManager('test-session-asset', { baseDir: testTempDir });
  assert.strictEqual(storage.getFlowAssetUrl(), undefined, 'Ban đầu chưa có flowAssetUrl');
  
  const sampleAssetUrl = 'https://flow-content.google/image/d61a20dc-635e-4770-b568-1155c8c9b5a2?v=1';
  storage.setFlowAssetUrl(sampleAssetUrl);
  
  assert.strictEqual(storage.getFlowAssetUrl(), sampleAssetUrl, 'Phải đọc lại đúng flowAssetUrl đã lưu');
  console.log('✅ TC6: AiStudioDiskStorageManager lưu và đọc flow_asset_url bền vững vào index.json thành công.');
} finally {
  try { fs.rmSync(testTempDir, { recursive: true, force: true }); } catch {}
}

// Test Case 7: renameCurrentProject Verify thật sự (mock BrowserWindow)
async function testRenameVerify() {
  const sessionMgr = GoogleVeoSessionManager.getInstance();

  // 7a: Khi DOM trả về đúng tên mong muốn -> verified = true
  const mockWinPass = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: async (code: string) => {
        return { ok: true, verified: true, actualTitle: 'Lịch Sử Việt Nam', expectedTitle: 'Lịch Sử Việt Nam', method: 'existing_input' };
      }
    }
  };
  const passResult = await sessionMgr.renameCurrentProject(mockWinPass, 'Lịch Sử Việt Nam');
  assert.strictEqual(passResult, true, '7a: Rename khớp tên mong muốn phải trả về true');
  console.log('✅ TC7a: renameCurrentProject Verify PASS khi tiêu đề DOM thật sự cập nhật.');

  // 7b: Khi DOM trả về tên cũ hoặc không đổi -> verified = false (FAIL)
  const mockWinFail = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: async (code: string) => {
        return { ok: false, verified: false, actualTitle: 'Tháng 9 20 - Untitled', expectedTitle: 'Lịch Sử Việt Nam', reason: 'mismatch' };
      }
    }
  };
  const failResult = await sessionMgr.renameCurrentProject(mockWinFail, 'Lịch Sử Việt Nam');
  assert.strictEqual(failResult, false, '7b: Rename sai tên hoặc không cập nhật phải trả về false, không được nhận bừa');
  console.log('✅ TC7b: renameCurrentProject Verify FAIL chặn đứng tình trạng false-positive khi tên DOM không đổi.');
}

// Test Case 8: findAndOpenProjectByName xử lý trùng tên
async function testDuplicateProjectDetection() {
  const sessionMgr = GoogleVeoSessionManager.getInstance();

  // Giả lập phát hiện 2 project cùng tên trên Flow
  const mockWinMultiple = {
    isDestroyed: () => false,
    loadURL: async () => {},
    webContents: {
      getURL: () => 'https://flow.google.com/project/proj_newest_uuid',
      loadURL: async () => {},
      executeJavaScript: async (code: string) => {
        if (code.includes('matches.push')) {
          return {
            count: 2,
            matches: [
              { projectId: 'proj_newest_uuid', href: '/project/proj_newest_uuid', cardText: 'Lịch Sử Việt Nam' },
              { projectId: 'proj_older_uuid', href: '/project/proj_older_uuid', cardText: 'Lịch Sử Việt Nam' }
            ]
          };
        }
        if (code.includes('/project/')) {
          return true; // project đã tải xong
        }
        return false;
      }
    }
  };

  const findRes = await sessionMgr.findAndOpenProjectByName(mockWinMultiple, 'Lịch Sử Việt Nam');
  assert.strictEqual(findRes.found, true, '8a: Phải tìm thấy project');
  assert.strictEqual(findRes.projectId, 'proj_newest_uuid', '8b: Phải ưu tiên chọn project đầu tiên (mới nhất)');
  console.log('✅ TC8: findAndOpenProjectByName xử lý an toàn khi có nhiều dự án trùng tên (ưu tiên thẻ mới nhất kèm cảnh báo).');
}

(async () => {
  await testRenameVerify();
  await testDuplicateProjectDetection();
  console.log('\n🎉 TẤT CẢ 8 KIỂM THỬ ĐỀU ĐẠT CHUẨN (PASS)!');
})().catch(err => {
  console.error('❌ Lỗi kiểm thử:', err);
  process.exit(1);
});
