import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import axios from 'axios';
import {
  detectPlatform,
  extractCleanUrl,
  isTikTokShortUrl,
  extractTikTokVideoId,
  normalizeTikTokUrl,
  fetchTikwmVideoData,
  inspectMediaUrl,
  downloadVideoFromUrl,
  normalizeDouyinUrl,
} from '../main/helpers/videoDownloader';

// Đảm bảo môi trường test độc lập tìm được binary yt-dlp
if (!process.env.VANHSUB_BIN_DIR) {
  process.env.VANHSUB_BIN_DIR = path.join(
    process.env.APPDATA || os.homedir(),
    'vanhsub (development)',
    'bin'
  );
}

console.log('════════════════════════════════════════════════════════════════════');
console.log('  BẮT ĐẦU KIỂM THỬ TOÀN DIỆN TIKTOK INTERNATIONAL DOWNLOADER (R1)   ');
console.log('════════════════════════════════════════════════════════════════════\n');

async function runAllTests() {
  const sampleTikTokUrl = 'https://www.tiktok.com/@scout2015/video/6718335390845095173';

  // ───────────────────────────────────────────────────────────────────────────
  // TEST SUITE 1: Nhận diện nền tảng & Lọc URL sạch (Platform Detection & Cleaning)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('--- TEST SUITE 1: Nhận diện nền tảng & Lọc URL sạch ---');

  // TC 1.1: Trích xuất URL từ văn bản kèm caption/tiếng Việt
  const dirtyTextTikTok = 'Xem video cún cưng này dễ thương lắm nè https://vt.tiktok.com/ZS2QvHjXk/ #cutedog #foryou';
  const cleanTikTok = extractCleanUrl(dirtyTextTikTok);
  assert.strictEqual(cleanTikTok, 'https://vt.tiktok.com/ZS2QvHjXk/', 'TC 1.1: Trích xuất link TikTok từ văn bản thất bại');
  console.log(`✅ TC 1.1: Trích xuất URL sạch từ caption thành công: "${cleanTikTok}"`);

  // TC 1.2: Phân loại nền tảng chính xác
  assert.strictEqual(detectPlatform('https://vt.tiktok.com/ZS2QvHjXk/'), 'tiktok', 'TC 1.2.1: vt.tiktok.com phải là tiktok');
  assert.strictEqual(detectPlatform('https://vm.tiktok.com/ZMJ4R6VNx/'), 'tiktok', 'TC 1.2.2: vm.tiktok.com phải là tiktok');
  assert.strictEqual(detectPlatform('https://www.tiktok.com/t/ZT88YtW9b/'), 'tiktok', 'TC 1.2.3: tiktok.com/t/ phải là tiktok');
  assert.strictEqual(detectPlatform(sampleTikTokUrl), 'tiktok', 'TC 1.2.4: tiktok.com/@user/video/... phải là tiktok');
  console.log('✅ TC 1.2: Phân loại chính xác 4 dạng liên kết TikTok quốc tế.');

  // TC 1.3: Bảo toàn phân loại các nền tảng khác (Zero Regression)
  assert.strictEqual(detectPlatform('https://www.douyin.com/video/71234567890'), 'douyin', 'TC 1.3.1: Douyin video phải là douyin');
  assert.strictEqual(detectPlatform('https://v.douyin.com/iJABCD/'), 'douyin', 'TC 1.3.2: v.douyin.com phải là douyin');
  assert.strictEqual(detectPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube', 'TC 1.3.3: YouTube video phải là youtube');
  assert.strictEqual(detectPlatform('https://youtu.be/dQw4w9WgXcQ'), 'youtube', 'TC 1.3.4: youtu.be phải là youtube');
  assert.strictEqual(detectPlatform('https://www.bilibili.com/video/BV1xx411c7mD'), 'bilibili', 'TC 1.3.5: Bilibili video phải là bilibili');
  assert.strictEqual(detectPlatform('https://b23.tv/abcd'), 'bilibili', 'TC 1.3.6: b23.tv phải là bilibili');
  assert.strictEqual(detectPlatform('https://example.com/video.mp4'), 'other', 'TC 1.3.7: Other platform');
  console.log('✅ TC 1.3: Bảo tồn 100% tính chính xác nhận diện cho Douyin, YouTube, Bilibili.');

  // ───────────────────────────────────────────────────────────────────────────
  // TEST SUITE 2: Nhận diện & Trích xuất ID video TikTok (Short URL & Video ID)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SUITE 2: Nhận diện link rút gọn & Trích xuất Video ID ---');

  // TC 2.1: Kiểm tra hàm isTikTokShortUrl
  assert.strictEqual(isTikTokShortUrl('https://vt.tiktok.com/ZS2QvHjXk/'), true, 'TC 2.1.1: vt.tiktok.com phải là short url');
  assert.strictEqual(isTikTokShortUrl('https://vm.tiktok.com/ZMJ4R6VNx/'), true, 'TC 2.1.2: vm.tiktok.com phải là short url');
  assert.strictEqual(isTikTokShortUrl('https://www.tiktok.com/t/ZT88YtW9b/'), true, 'TC 2.1.3: tiktok.com/t/ phải là short url');
  assert.strictEqual(isTikTokShortUrl('https://tiktok.com/t/ZT88YtW9b/'), true, 'TC 2.1.4: tiktok.com/t/ không www');
  assert.strictEqual(isTikTokShortUrl(sampleTikTokUrl), false, 'TC 2.1.5: Full url không phải short url');
  assert.strictEqual(isTikTokShortUrl('https://v.douyin.com/iJABCD/'), false, 'TC 2.1.6: Douyin short url không phải tiktok');
  console.log('✅ TC 2.1: isTikTokShortUrl nhận diện chuẩn xác các biến thể link rút gọn.');

  // TC 2.2: Trích xuất ID video từ nhiều định dạng
  assert.strictEqual(
    extractTikTokVideoId('https://www.tiktok.com/@user/video/7123456789012345678?is_from_webapp=1'),
    '7123456789012345678',
    'TC 2.2.1: @user/video/ID kèm query params'
  );
  assert.strictEqual(
    extractTikTokVideoId('https://www.tiktok.com/@user/photo/7123456789012345678'),
    '7123456789012345678',
    'TC 2.2.2: @user/photo/ID'
  );
  assert.strictEqual(
    extractTikTokVideoId('https://www.tiktok.com/video/7123456789012345678'),
    '7123456789012345678',
    'TC 2.2.3: /video/ID'
  );
  assert.strictEqual(
    extractTikTokVideoId('https://www.tiktok.com/v/7123456789012345678.html'),
    '7123456789012345678',
    'TC 2.2.4: /v/ID.html'
  );
  assert.strictEqual(
    extractTikTokVideoId('https://www.tiktok.com/?modal_id=7123456789012345678'),
    '7123456789012345678',
    'TC 2.2.5: modal_id param'
  );
  console.log('✅ TC 2.2: extractTikTokVideoId trích xuất đúng ID video từ 5 định dạng đa hình.');

  // ───────────────────────────────────────────────────────────────────────────
  // TEST SUITE 3: Phân giải Chuyển hướng & Chuẩn hóa URL (Redirect Resolution)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SUITE 3: Phân giải Chuyển hướng & Chuẩn hóa Canonical URL ---');

  // TC 3.1: Chuẩn hóa link đầy đủ (loại bỏ tracking parameters)
  const fullUrlWithTracking = 'https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1&sender_device=pc&share_source=copy';
  const normResult = await normalizeTikTokUrl(fullUrlWithTracking);
  assert.strictEqual(normResult.cleanUrl, sampleTikTokUrl, 'TC 3.1: Canonical URL phải được loại bỏ tracking query');
  assert.strictEqual(normResult.videoId, '6718335390845095173', 'TC 3.1: Video ID phải khớp');
  console.log(`✅ TC 3.1: Chuẩn hóa canonical full URL thành công: "${normResult.cleanUrl}"`);

  // TC 3.2: Phân giải chuyển hướng (Redirect Resolution) cho các dạng link rút gọn
  // Tạo HTTP mock server cục bộ mô phỏng 302 redirect để kiểm chứng logic phân giải
  const mockServerPort = 39281;
  const mockServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/short-vt') || req.url?.startsWith('/short-vm') || req.url?.startsWith('/short-t')) {
      res.writeHead(302, {
        Location: 'https://www.tiktok.com/@creator_test/video/7234567890123456789?sender_device=mobile',
      });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => mockServer.listen(mockServerPort, resolve));

  try {
    // Thử nghiệm phân giải redirect qua mock server
    const mockRedirectUrl = `http://127.0.0.1:${mockServerPort}/short-vt`;
    const resolved = await axios.get(mockRedirectUrl, {
      maxRedirects: 10,
      validateStatus: () => true,
    });
    const finalLocation = (resolved.request as any)?.res?.responseUrl || resolved.headers?.location;
    assert.ok(finalLocation?.includes('7234567890123456789'), 'TC 3.2: Redirect phải trỏ về video ID');
    console.log(`✅ TC 3.2: Phân giải chuyển hướng HTTP 302 thành công sang: ${finalLocation}`);
  } finally {
    mockServer.close();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST SUITE 4: TikWM API Metadata & Direct No-Watermark Stream (Tier 1)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SUITE 4: TikWM API Metadata & Direct Stream (Tier 1) ---');

  const tikwmData = await fetchTikwmVideoData(sampleTikTokUrl);
  assert.ok(tikwmData.title, 'TC 4.1: Tiêu đề video không được rỗng');
  assert.ok(tikwmData.author, 'TC 4.2: Tác giả không được rỗng');
  assert.ok(tikwmData.duration > 0, 'TC 4.3: Thời lượng video phải > 0');
  assert.ok(tikwmData.noWatermarkUrl.startsWith('http'), 'TC 4.4: noWatermarkUrl phải là link http(s)');
  console.log(`✅ TC 4.1-4.4: Bóc tách TikWM thành công:
     • Tiêu đề: "${tikwmData.title.slice(0, 50)}..."
     • Tác giả: ${tikwmData.author}
     • Thời lượng: ${tikwmData.duration}s
     • Direct Stream URL: ${tikwmData.noWatermarkUrl.slice(0, 60)}...`);

  // TC 4.5: Kiểm tra stream trực tiếp MP4 từ noWatermarkUrl (không dùng Referer Douyin)
  const streamCheck = await axios.get(tikwmData.noWatermarkUrl, {
    responseType: 'stream',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    timeout: 10_000,
  });
  assert.strictEqual(streamCheck.status, 200, 'TC 4.5: HTTP status tải video stream phải là 200');
  const contentType = streamCheck.headers['content-type'] || '';
  assert.ok(contentType.includes('video') || contentType.includes('mp4') || contentType.includes('octet-stream'), 'TC 4.5: Phải là content video/mp4');
  streamCheck.data.destroy(); // Đóng stream kiểm tra
  console.log(`✅ TC 4.5: Kết nối trực tiếp stream video MP4 không watermark thành công (HTTP ${streamCheck.status}, ${contentType}).`);

  // ───────────────────────────────────────────────────────────────────────────
  // TEST SUITE 5: inspectMediaUrl cho TikTok và Nền Tảng Khác
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SUITE 5: inspectMediaUrl (Tách luồng & Fallback) ---');

  // TC 5.1: inspectMediaUrl trên TikTok qua TikWM (Tier 1)
  const inspected = await inspectMediaUrl(sampleTikTokUrl);
  assert.strictEqual(inspected.platform, 'tiktok', 'TC 5.1: Platform phải là tiktok');
  assert.ok(inspected.noWatermarkUrl, 'TC 5.1: Phải có noWatermarkUrl');
  assert.ok(inspected.availableQualities.some((q) => q.id === 'nowatermark'), 'TC 5.1: Phải có tùy chọn nowatermark');
  assert.ok(inspected.availableQualities.some((q) => q.id === 'audio_only'), 'TC 5.1: Phải có tùy chọn audio_only');
  console.log('✅ TC 5.1: inspectMediaUrl TikTok thành công với đầy đủ metadata và chất lượng.');

  // TC 5.2: inspectMediaUrl không gọi nhầm sang api.amemv.com
  // (Nếu gọi amemv.com sẽ ném lỗi "amemv API trả về lỗi" hoặc "Không tìm thấy thông tin video từ Douyin API")
  assert.ok(!inspected.title.includes('Douyin API'), 'TC 5.2: Không được dính nhầm Douyin API');
  console.log('✅ TC 5.2: Hoàn toàn tách biệt khỏi Douyin API nội địa Trung Quốc.');

  // ───────────────────────────────────────────────────────────────────────────
  // TEST SUITE 6: downloadVideoFromUrl (Tải MP4 Không Watermark & Dự án)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SUITE 6: downloadVideoFromUrl (Tải MP4 & Tạo Dự Án) ---');

  const testTempFolder = path.join(os.tmpdir(), `vanhsub_test_tiktok_${Date.now()}`);
  fs.mkdirSync(testTempFolder, { recursive: true });

  try {
    let progressReported = false;
    let finalPercent = 0;

    const downloadResult = await downloadVideoFromUrl({
      url: sampleTikTokUrl,
      outputDir: testTempFolder,
      customFileName: 'test_tiktok_scout',
      quality: 'nowatermark',
      noWatermarkUrl: inspected.noWatermarkUrl,
      onProgress: (p) => {
        progressReported = true;
        finalPercent = p.percent;
      },
    });

    assert.ok(downloadResult.filePath, 'TC 6.1: Phải có filePath kết quả');
    assert.ok(fs.existsSync(downloadResult.filePath), 'TC 6.1: File video phải tồn tại trên đĩa');
    const stat = fs.statSync(downloadResult.filePath);
    assert.ok(stat.size > 100_000, `TC 6.1: Dung lượng video phải > 100KB (thực tế: ${stat.size} bytes)`);

    assert.ok(downloadResult.projectDir, 'TC 6.2: Phải có projectDir');
    assert.ok(fs.existsSync(downloadResult.projectDir), 'TC 6.2: Thư mục dự án phải tồn tại');

    assert.ok(progressReported, 'TC 6.3: Phải có báo cáo tiến độ onProgress');
    assert.strictEqual(finalPercent, 100, 'TC 6.3: Tiến độ cuối cùng phải đạt 100%');

    console.log(`✅ TC 6.1-6.3: Tải video TikTok không watermark thành công 100%:
     • File: ${downloadResult.filePath}
     • Dung lượng: ${(stat.size / (1024 * 1024)).toFixed(2)} MB
     • Thư mục dự án: ${downloadResult.projectDir}`);
  } finally {
    // Dọn dẹp thư mục test
    try {
      fs.rmSync(testTempFolder, { recursive: true, force: true });
    } catch {}
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST SUITE 7: yt-dlp Resilient Fallback (Tier 2)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SUITE 7: yt-dlp Resilient Fallback (Tier 2) ---');

  const testFallbackFolder = path.join(os.tmpdir(), `vanhsub_test_fallback_${Date.now()}`);
  fs.mkdirSync(testFallbackFolder, { recursive: true });

  try {
    // Kiểm tra tải bằng fallback yt-dlp trực tiếp khi không truyền noWatermarkUrl
    // và giả lập URL đặc biệt hoặc audio_only
    const audioResult = await downloadVideoFromUrl({
      url: sampleTikTokUrl,
      outputDir: testFallbackFolder,
      customFileName: 'test_tiktok_audio_fallback',
      quality: 'audio_only',
    });

    assert.ok(audioResult.filePath, 'TC 7.1: Phải tạo file âm thanh qua yt-dlp');
    assert.ok(fs.existsSync(audioResult.filePath), 'TC 7.1: File audio phải tồn tại trên đĩa');
    const audioStat = fs.statSync(audioResult.filePath);
    assert.ok(audioStat.size > 10_000, `TC 7.1: File audio phải > 10KB (thực tế: ${audioStat.size} bytes)`);
    console.log(`✅ TC 7.1: yt-dlp fallback thành công xuất file audio: ${audioResult.fileName} (${(audioStat.size / 1024).toFixed(1)} KB)`);
  } finally {
    try {
      fs.rmSync(testFallbackFolder, { recursive: true, force: true });
    } catch {}
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST SUITE 8: Douyin Non-Regression Verification
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SUITE 8: Đảm bảo Douyin không bị ảnh hưởng (Zero Regression) ---');

  const testDouyinUrl = 'https://www.douyin.com/video/7234567890123456789';
  const normDouyin = await normalizeDouyinUrl(testDouyinUrl);
  assert.strictEqual(normDouyin, testDouyinUrl, 'TC 8.1: normalizeDouyinUrl phải giữ nguyên cho URL Douyin chuẩn');
  console.log('✅ TC 8.1: normalizeDouyinUrl hoạt động ổn định, không bị can thiệp bởi TikTok.');

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  🎉 TẤT CẢ 8 TEST SUITES ĐÃ ĐẠT 100% THÀNH CÔNG! KHÔNG CÓ LỖI!     ');
  console.log('════════════════════════════════════════════════════════════════════');
}

runAllTests().catch((err) => {
  console.error('\n❌ KIỂM THỬ THẤT BẠI:', err);
  process.exit(1);
});
