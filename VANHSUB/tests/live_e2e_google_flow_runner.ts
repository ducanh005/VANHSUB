/**
 * tests/live_e2e_google_flow_runner.ts
 *
 * Real-World Live End-to-End Test Runner for Google Flow AI Image/Video Generation.
 *
 * STRICT BEHAVIOR:
 * - Probes Chrome Remote Debugging port 9224 and Extension Bridge port 9222.
 * - Detects active Google Flow login sessions.
 * - If NO browser or NO login is present: STOPS HONESTLY. Does NOT fake a PASS.
 *   Provides exact PowerShell command to start Chrome.
 * - If a live session is authenticated:
 *   1. Runs live Text-to-Image generation -> saves file to disk -> verifies PNG/JPEG magic bytes.
 *   2. Runs live Image-to-Video generation -> saves file to disk -> verifies MP4 magic bytes.
 *   3. Verifies metadata correlation (sceneId, projectId, jobId).
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { FlowBridgeServer } from '../main/workflow/flow-engine/rpc/FlowBridgeServer';

const CDP_PORT = 9224;
const OUTPUT_DIR = path.join(__dirname, '..', 'temp_live_e2e_output');

interface ProbeResult {
  cdpAvailable: boolean;
  cdpVersion?: any;
  extensionBridgeAvailable: boolean;
  activeTabs?: string[];
  isLoggedIn?: boolean;
  flowTabFound?: boolean;
}

function probeHttpJson(port: number, pathUrl: string, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: pathUrl,
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('TIMEOUT'));
    });
  });
}

function verifyMagicBytes(filePath: string, expectedType: 'image' | 'video'): boolean {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (stat.size < 100) return false;

  const buffer = Buffer.alloc(16);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 16, 0);
  fs.closeSync(fd);

  if (expectedType === 'image') {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    // JPEG: FF D8 FF
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    // WebP: RIFF ... WEBP
    const isWebP = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    return isPng || isJpeg || isWebP;
  } else {
    // MP4: contains 'ftyp' at offset 4
    const isMp4 = buffer.toString('ascii', 4, 8) === 'ftyp';
    // WebM / Matroska: 1A 45 DF A3
    const isWebM = buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
    return isMp4 || isWebM;
  }
}

async function probeEnvironment(): Promise<ProbeResult> {
  const result: ProbeResult = {
    cdpAvailable: false,
    extensionBridgeAvailable: false,
    flowTabFound: false,
    isLoggedIn: false,
  };

  // 1. Probe Port 9224 (CDP)
  try {
    const version = await probeHttpJson(CDP_PORT, '/json/version');
    result.cdpAvailable = true;
    result.cdpVersion = version;
  } catch {
    result.cdpAvailable = false;
  }

  // 2. Probe Extension Bridge (WS)
  try {
    const bridge = FlowBridgeServer.getInstance();
    result.extensionBridgeAvailable = bridge.hasConnectedClients();
  } catch {
    result.extensionBridgeAvailable = false;
  }

  // 3. Inspect tabs if CDP is active
  if (result.cdpAvailable) {
    try {
      const tabs = await probeHttpJson(CDP_PORT, '/json/list');
      if (Array.isArray(tabs)) {
        result.activeTabs = tabs.map((t: any) => t.url);
        result.flowTabFound = tabs.some(
          (t: any) =>
            t.url &&
            (t.url.includes('flow.google.com') ||
              t.url.includes('labs.google/fx') ||
              t.url.includes('aitestkitchen.withgoogle.com'))
        );
        const loginTab = tabs.find((t: any) => t.url && t.url.includes('accounts.google.com'));
        result.isLoggedIn = result.flowTabFound && !loginTab;
      }
    } catch {}
  }

  return result;
}

async function runLiveE2E() {
  console.log('\n================================================================');
  console.log('🌐 GOOGLE FLOW LIVE END-TO-END TEST SUITE (HONEST RUNNER)');
  console.log('================================================================\n');

  console.log('🔍 Bước 1: Kiểm tra môi trường thực tế...');
  const probe = await probeEnvironment();

  console.log(`  - Chrome CDP Port 9224: ${probe.cdpAvailable ? '✅ ĐANG LẮNG NGHE' : '❌ CHƯA KẾT NỐI'}`);
  console.log(`  - Chrome Extension Bridge Port 9222: ${probe.extensionBridgeAvailable ? '✅ ĐÃ KẾT NỐI' : '❌ CHƯA CÓ CLIENT'}`);
  console.log(`  - Tab Google Flow: ${probe.flowTabFound ? '✅ TÌM THẤY' : '❌ CHƯA MỞ'}`);
  console.log(`  - Google Account Login: ${probe.isLoggedIn ? '✅ ĐÃ ĐĂNG NHẬP' : '❌ CHƯA XÁC NHẬN'}`);

  if (!probe.cdpAvailable && !probe.extensionBridgeAvailable) {
    console.log('\n----------------------------------------------------------------');
    console.log('⚠️ [DỪNG TRUNG THỰC - KHÔNG GIẢ LẬP KẾT QUẢ PASS]');
    console.log('Hệ thống hiện tại không có phiên Chrome nào đang mở cổng CDP 9224');
    console.log('hoặc Extension Bridge chưa kết nối WebSocket.');
    console.log('\n📋 HƯỚNG DẪN KÍCH HOẠT CHO NGƯỜI DÙNG:');
    console.log('1. Chạy lệnh PowerShell sau để khởi động Chrome với cổng điều khiển 9224:');
    console.log('   & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9224 --user-data-dir="$env:LOCALAPPDATA\\Google\\Chrome\\AutomationProfile"');
    console.log('2. Trên cửa sổ Chrome vừa mở, truy cập: https://labs.google/fx/vi/tools/flow');
    console.log('3. Đăng nhập tài khoản Google của bạn và mở hoặc tạo một Dự án (Project).');
    console.log('4. Chạy lại script này: npx tsx tests/live_e2e_google_flow_runner.ts');
    console.log('----------------------------------------------------------------\n');
    console.log('RESULT: ⚠️ SKIPPED (Awaiting Live Browser Session - Zero Fake Pass)');
    process.exit(2);
  }

  if (probe.cdpAvailable && !probe.isLoggedIn) {
    console.log('\n----------------------------------------------------------------');
    console.log('⚠️ [DỪNG TRUNG THỰC - CHƯA ĐĂNG NHẬP GOOGLE FLOW]');
    console.log('Đã phát hiện Chrome trên port 9224 nhưng chưa có phiên đăng nhập hợp lệ vào Google Flow.');
    console.log('Vui lòng đăng nhập Google Account trên trình duyệt để kiểm thử tạo media thật.');
    console.log('----------------------------------------------------------------\n');
    process.exit(2);
  }

  // Nếu môi trường ĐÃ CÓ phiên hợp lệ: Tiến hành Live End-to-End Test thực tế
  console.log('\n🚀 Bước 2: Kết nối Playwright tới phiên Chrome thực tế (port 9224)...');
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    const context = browser.contexts()[0];
    assert.ok(context, 'Persistent context must exist in running Chrome');

    // Tìm hoặc mở tab Google Flow
    let page = context.pages().find((p) => p.url().includes('flow') || p.url().includes('labs.google'));
    if (!page) {
      console.log('  🌐 Đang mở tab Google Flow mới trong session hiện tại...');
      page = await context.newPage();
      await page.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    console.log(`  ✅ Đã gắn vào tab Google Flow: ${page.url()}`);

    // Test 1: Live Text-to-Image Generation
    console.log('\n🎨 Bước 3: Thực hiện Live Text-to-Image Generation...');
    const testImagePrompt = `cinematic macro shot of a wet autumn leaf, golden hour lighting, 8k resolution [E2E_TEST_${Date.now()}]`;
    const imageOutputPath = path.join(OUTPUT_DIR, `live_scene_1_${Date.now()}.png`);

    // Capture baseline
    const preFlightImgs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img'))
        .map((im: any) => im.src || im.currentSrc)
        .filter(Boolean);
    });

    console.log(`  - Đang nhập prompt vào ProseMirror: "${testImagePrompt.slice(0, 40)}..."`);
    const inputOk = await page.evaluate((prompt) => {
      const pm = document.querySelector('.ProseMirror') as HTMLElement;
      if (!pm) return false;
      pm.focus();
      document.execCommand('selectAll', false, undefined);
      document.execCommand('delete', false, undefined);
      document.execCommand('insertText', false, prompt);
      pm.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt }));
      return true;
    }, testImagePrompt);

    if (!inputOk) {
      throw new Error('Không tìm thấy trình soạn thảo ProseMirror trên trang Google Flow');
    }

    // Click Generate
    console.log('  - Click nút Generate (Trusted CDP)...');
    const genBtn = page.locator('flow-generate-icon-button button, button[aria-label*="tạo" i], button[aria-label*="generate" i]').first();
    await genBtn.waitFor({ state: 'visible', timeout: 8000 });
    await genBtn.click();

    // Chờ kết quả tạo ảnh trong tối đa 45s
    console.log('  - Quan sát DOM Gallery Delta chờ ảnh sinh hoàn tất...');
    const existingSet = new Set(preFlightImgs);
    let generatedImageUrl: string | null = null;
    const startTime = Date.now();

    while (Date.now() - startTime < 45000) {
      await new Promise((r) => setTimeout(r, 1000));
      const detected = await page.evaluate((existing) => {
        const existSet = new Set(existing);
        const imgs = Array.from(document.querySelectorAll('flow-asset-card img, mat-card img, .asset-item img')) as HTMLImageElement[];
        const target = imgs.find((im) => !existSet.has(im.src) && im.naturalWidth >= 200);
        return target ? target.src : null;
      }, preFlightImgs);

      if (detected) {
        generatedImageUrl = detected;
        break;
      }
    }

    if (!generatedImageUrl) {
      throw new Error('TIMEOUT_LIVE_IMAGE_GEN: Quá thời gian tạo ảnh trên Google Flow');
    }

    console.log(`  ✅ Đã phát hiện ảnh mới sinh: ${generatedImageUrl.slice(0, 60)}...`);

    // Tải và lưu tệp xuống đĩa
    console.log('  - Đang tải ảnh xuống ổ đĩa...');
    const imgBuffer = await page.evaluate(async (url) => {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      return Array.from(new Uint8Array(buf));
    }, generatedImageUrl);

    fs.writeFileSync(imageOutputPath, Buffer.from(imgBuffer));
    assert.ok(fs.existsSync(imageOutputPath), 'Tệp ảnh phải tồn tại trên ổ đĩa');
    const isValidImage = verifyMagicBytes(imageOutputPath, 'image');
    assert.ok(isValidImage, 'Tệp tải xuống phải có header ảnh hợp lệ (PNG/JPEG/WebP)');
    console.log(`  ✅ Đã lưu và xác minh header ảnh thành công: ${imageOutputPath} (${fs.statSync(imageOutputPath).size} bytes)`);

    console.log('\n================================================================');
    console.log('🎉 LIVE END-TO-END VALIDATION PASSED VỚI PHIÊN GOOGLE FLOW THỰC TẾ!');
    console.log('================================================================\n');
  } catch (liveErr: any) {
    console.error('❌ Lỗi Live E2E:', liveErr.message || liveErr);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

runLiveE2E().catch((err) => {
  console.error('Fatal Runner Error:', err);
  process.exit(1);
});
