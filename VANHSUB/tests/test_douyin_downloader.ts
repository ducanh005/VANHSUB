/**
 * Test Suite: Kiểm thử chuyên sâu Douyin Downloader (Fix lỗi tải sai/random video + triệt để timeout/memory leak)
 */
import assert from 'assert';
import {
  detectPlatform,
  extractCleanUrl,
  normalizeDouyinUrl,
  extractDouyinVideoId,
  extractDouyinTitle,
  extractDouyinMediaData,
} from '../main/helpers/videoDownloader';
import fs from 'fs';
import path from 'path';

console.log('════════════════════════════════════════════════════════════════════');
console.log('  BẮT ĐẦU KIỂM THỬ TOÀN DIỆN DOUYIN DOWNLOADER (FIX TRIỆT ĐỂ)      ');
console.log('════════════════════════════════════════════════════════════════════\n');

(async () => {
  // TEST SUITE 1: Nhận diện nền tảng Douyin
  console.log('--- TEST SUITE 1: Nhận diện nền tảng Douyin ---');
  const testCasesPlatform = [
    { url: 'https://www.douyin.com/video/7688188998119918902', expected: 'douyin' },
    { url: 'https://v.douyin.com/iJ897xY/', expected: 'douyin' },
    { url: 'https://www.iesdouyin.com/share/video/7688188998119918902/', expected: 'douyin' },
    { url: 'https://www.douyin.com/note/7688188998119918902', expected: 'douyin' },
    { url: 'https://www.douyin.com/user/MS4wLjAAAA?modal_id=7688188998119918902', expected: 'douyin' },
  ];

  for (const tc of testCasesPlatform) {
    const result = detectPlatform(tc.url);
    assert.strictEqual(result, tc.expected, `detectPlatform thất bại với: ${tc.url}`);
  }
  console.log('✅ TC 1.1: Nhận diện chính xác tất cả các biến thể URL Douyin.');

  // TEST SUITE 2: Trích xuất link sạch từ văn bản copy từ app Douyin
  console.log('\n--- TEST SUITE 2: Lọc văn bản chia sẻ từ app Douyin ---');
  const sampleShareText =
    '7.12 04/28 B@s.cm 100% 赶个末班车！ #王子系 #lolita #变装 https://v.douyin.com/iJ897xY/ 复制此链接，打开DouYin搜索，直接观看视频！';
  const cleanUrl = extractCleanUrl(sampleShareText);
  assert.strictEqual(cleanUrl, 'https://v.douyin.com/iJ897xY/', 'extractCleanUrl phải lọc đúng link từ text tiếng Trung');
  console.log(`✅ TC 2.1: Lọc link sạch thành công từ chuỗi caption tiếng Trung: "${cleanUrl}"`);

  // TEST SUITE 3: Trích xuất Video ID chính xác (ngăn chặn tình trạng sai ID)
  console.log('\n--- TEST SUITE 3: Trích xuất Video ID Douyin đa hình dạng ---');
  const testCasesId = [
    { url: 'https://www.douyin.com/video/7688188998119918902', expectedId: '7688188998119918902' },
    { url: 'https://www.douyin.com/video/7688188998119918902?previous_page=app_code&params=1', expectedId: '7688188998119918902' },
    { url: 'https://www.douyin.com/note/7689617367950021248', expectedId: '7689617367950021248' },
    { url: 'https://www.douyin.com/user/MS4wLjAAAA?modal_id=7688188998119918902', expectedId: '7688188998119918902' },
    { url: 'https://www.iesdouyin.com/share/video/7688188998119918902/', expectedId: '7688188998119918902' },
    { url: 'https://www.iesdouyin.com/video/7688188998119918902?extra=123', expectedId: '7688188998119918902' },
  ];

  for (const tc of testCasesId) {
    const extracted = extractDouyinVideoId(tc.url);
    assert.strictEqual(extracted, tc.expectedId, `extractDouyinVideoId thất bại với URL: ${tc.url}`);
  }
  console.log('✅ TC 3.1: extractDouyinVideoId trích xuất 100% chính xác ID video từ 6 biến thể.');

  // TEST SUITE 4: Chuẩn hóa Canonical URL
  console.log('\n--- TEST SUITE 4: Chuẩn hóa Canonical URL Douyin ---');
  const testUrl = 'https://www.douyin.com/note/7688188998119918902?from=tab_search';
  const canonical = await normalizeDouyinUrl(testUrl);
  assert.strictEqual(canonical, 'https://www.douyin.com/video/7688188998119918902', 'Phải canonicalize về dạng video');
  console.log(`✅ TC 4.1: Chuẩn hóa canonical thành công: "${canonical}"`);

  // TEST SUITE 5: extractDouyinTitle
  console.log('\n--- TEST SUITE 5: Tiêu đề fallback Douyin ---');
  const title = extractDouyinTitle('https://www.douyin.com/video/7688188998119918902');
  assert.strictEqual(title, 'douyin_7688188998119918902', 'Title fallback phải chứa ID video');
  console.log(`✅ TC 5.1: Tiêu đề fallback chính xác: "${title}"`);

  // TEST SUITE 6: Đảm bảo loại bỏ hoàn toàn endpoint feed ngẫu nhiên (Zero Randomness)
  console.log('\n--- TEST SUITE 6: Kiểm tra loại bỏ mã nguồn feed ngẫu nhiên & memory leak ---');
  const codeContent = fs.readFileSync(path.join(__dirname, '../main/helpers/videoDownloader.ts'), 'utf-8');
  assert.strictEqual(
    codeContent.includes('api.amemv.com/aweme/v1/feed'),
    false,
    'Mã nguồn TUYỆT ĐỐI KHÔNG ĐƯỢC chứa endpoint api.amemv.com/aweme/v1/feed (gây random video)'
  );
  assert.strictEqual(
    codeContent.includes('fetchAmemvVideoData'),
    false,
    'Mã nguồn TUYỆT ĐỐI KHÔNG ĐƯỢC chứa fetchAmemvVideoData'
  );
  assert.strictEqual(
    codeContent.includes('session.webRequest.onBeforeRequest'),
    false,
    'Mã nguồn TUYỆT ĐỐI KHÔNG ĐƯỢC rò rỉ webRequest.onBeforeRequest trên BrowserWindow (gây MaxListenersExceededWarning)'
  );
  console.log('✅ TC 6.1: Đã loại bỏ hoàn toàn endpoint feed ngẫu nhiên và rò rỉ EventEmitter khỏi mã nguồn.');

  // TEST SUITE 7: Kiểm thử bóc tách trực tiếp video thật từ Douyin CDN (High-speed SSR)
  console.log('\n--- TEST SUITE 7: Bóc tách trực tiếp video thật từ Douyin qua SSR ---');
  const realAwemeId = '7689125604142721393';
  const targetDouyinUrl = `https://www.douyin.com/video/${realAwemeId}`;
  const t0 = Date.now();
  const mediaData = await extractDouyinMediaData(targetDouyinUrl, realAwemeId, 10_000);
  const elapsed = Date.now() - t0;

  assert.ok(mediaData.title && mediaData.title.length > 0, 'Phải có tiêu đề video');
  assert.ok(mediaData.author && mediaData.author.length > 0, 'Phải có tên tác giả');
  assert.ok(mediaData.noWatermarkUrl && mediaData.noWatermarkUrl.includes('play'), 'Link noWatermarkUrl phải hợp lệ');
  assert.strictEqual(
    mediaData.noWatermarkUrl.includes('playwm'),
    false,
    'Link noWatermarkUrl TUYỆT ĐỐI KHÔNG ĐƯỢC chứa watermark (playwm)'
  );

  console.log(`✅ TC 7.1: Bóc tách thành công video Douyin trong ${elapsed}ms:`);
  console.log(`   - Tiêu đề: "${mediaData.title}"`);
  console.log(`   - Tác giả: "${mediaData.author}"`);
  console.log(`   - Thời lượng: ${mediaData.duration}s`);
  console.log(`   - Link không watermark: ${mediaData.noWatermarkUrl.substring(0, 75)}...`);

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  🎉 TẤT CẢ 7 TEST SUITES CHO DOUYIN ĐÃ ĐẠT 100% THÀNH CÔNG!        ');
  console.log('════════════════════════════════════════════════════════════════════');
})().catch((err) => {
  console.error('\n❌ TEST THẤT BẠI:', err);
  process.exit(1);
});
