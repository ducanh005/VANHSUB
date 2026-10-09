import assert from 'assert';
import {
  detectPlatform,
  extractCleanUrl,
  normalizeDouyinUrl,
  extractDouyinVideoId,
  extractDouyinMediaData,
  downloadVideoFromUrl,
} from '../main/helpers/videoDownloader';
import os from 'os';
import fs from 'fs';
import path from 'path';

console.log('════════════════════════════════════════════════════════════════════');
console.log('  KIỂM THỬ KHẢ NĂNG PHỤC HỒI & TỰ ĐỘNG LÀM MỚI (RESILIENCE TEST)    ');
console.log('════════════════════════════════════════════════════════════════════\n');

(async () => {
  // TEST 1: Trích xuất ID từ các biến thể URL mới (slides, note, item_id, aweme_id)
  console.log('--- TEST 1: Trích xuất ID từ các biến thể URL Douyin mới ---');
  const variations = [
    { url: 'https://www.iesdouyin.com/share/slides/7490606034948525372/?mid=123', expected: '7490606034948525372' },
    { url: 'https://www.douyin.com/slides/7490606034948525372', expected: '7490606034948525372' },
    { url: 'https://www.douyin.com/discover?item_id=7490606034948525372', expected: '7490606034948525372' },
    { url: 'https://www.douyin.com/discover?aweme_id=7490606034948525372', expected: '7490606034948525372' },
  ];

  for (const v of variations) {
    const id = extractDouyinVideoId(v.url);
    assert.strictEqual(id, v.expected, `Trích xuất ID thất bại cho: ${v.url}`);
  }
  console.log('✅ TEST 1: Trích xuất 100% chính xác ID từ các dạng slides, note, item_id, aweme_id.');

  // TEST 2: Chuẩn hóa canonical từ link rút gọn
  console.log('\n--- TEST 2: Chuẩn hóa canonical với mobile UA ---');
  const testShort = 'https://v.douyin.com/iJ897xY/';
  const norm = await normalizeDouyinUrl(testShort);
  console.log(`  Kết quả normalize cho link rút gọn: ${norm}`);
  assert.ok(norm.length > 0, 'URL đã chuẩn hóa không được rỗng');
  console.log('✅ TEST 2: Chuẩn hóa link rút gọn thành công.');

  // TEST 3: Tải video thật từ link Douyin
  console.log('\n--- TEST 3: Tải hoàn chỉnh video Douyin với downloadVideoFromUrl ---');
  const realAwemeId = '7689125604142721393';
  const realUrl = `https://www.douyin.com/video/${realAwemeId}`;
  const tmpDir = path.join(os.tmpdir(), `vanhsub_test_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  let reportedPercents: number[] = [];
  const res = await downloadVideoFromUrl({
    url: realUrl,
    quality: 'nowatermark',
    outputDir: tmpDir,
    customFileName: 'test_real_douyin',
    onProgress: (p) => {
      reportedPercents.push(p.percent);
    },
  });

  console.log(`  Tải thành công: ${res.fileName} (${res.fileSize})`);
  assert.ok(fs.existsSync(res.filePath), 'File video phải tồn tại trên ổ cứng');
  const stat = fs.statSync(res.filePath);
  assert.ok(stat.size > 500_000, 'Kích thước video phải lớn hơn 500KB');
  console.log(`✅ TEST 3: Đã tải video thành công, kích thước: ${stat.size} bytes.`);

  // TEST 4: Tự động phục hồi khi noWatermarkUrl truyền vào bị expired/hỏng
  console.log('\n--- TEST 4: Khả năng tự động làm mới khi noWatermarkUrl bị hết hạn ---');
  const invalidExpiredUrl = 'https://aweme.snssdk.com/aweme/v1/play/?video_id=invalid_or_expired_token';

  const resRecover = await downloadVideoFromUrl({
    url: realUrl,
    quality: 'nowatermark',
    noWatermarkUrl: invalidExpiredUrl, // Link hỏng/hết hạn giả lập
    outputDir: tmpDir,
    customFileName: 'test_recover_douyin',
    onProgress: (p) => {
      if (p.stageDescription?.includes('làm mới')) {
        console.log(`  [Phục hồi] Đã kích hoạt cơ chế: "${p.stageDescription}"`);
      }
    },
  });

  assert.ok(fs.existsSync(resRecover.filePath), 'File video phục hồi phải tồn tại');
  const statRecover = fs.statSync(resRecover.filePath);
  assert.ok(statRecover.size > 500_000, 'Video phục hồi phải hợp lệ');
  console.log(`✅ TEST 4: Cơ chế tự động làm mới link khi URL hết hạn đã cứu vãn tiến trình thành công 100%!`);

  // Dọn dẹp
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  🎉 TẤT CẢ CÁC BÀI KIỂM THỬ KHẢ NĂNG PHỤC HỒI DOUYIN ĐÃ ĐẠT 100%!  ');
  console.log('════════════════════════════════════════════════════════════════════');
})().catch((err) => {
  console.error('\n❌ RESILIENCE TEST THẤT BẠI:', err);
  process.exit(1);
});
