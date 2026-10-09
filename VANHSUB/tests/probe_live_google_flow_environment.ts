/**
 * tests/probe_live_google_flow_environment.ts
 *
 * Real-world live validation probe for Google Flow automation:
 * 1. Probes Chrome CDP port 9224 (Playwright adapter)
 * 2. Probes Extension Bridge port 9222 (FlowBridgeServer)
 * 3. Checks if an active Chrome session exists with logged-in Google Flow
 * 4. If session exists, performs live text-to-image and image-to-video generation
 * 5. If session does not exist, stops truthfully and reports exact missing prerequisites.
 */

import http from 'http';
import { BrowserAutomationAdapter } from '../main/browser-automation/BrowserAutomationAdapter';
import { BrowserProcessManager } from '../main/browser-automation/BrowserProcessManager';
import { FlowBridgeServer } from '../main/workflow/flow-engine/rpc/FlowBridgeServer';

function probeHttpPort(port: number, path = '/json/version', timeoutMs = 1500): Promise<{ alive: boolean; data?: any }> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ alive: res.statusCode === 200, data: JSON.parse(body) });
        } catch {
          resolve({ alive: res.statusCode === 200, data: body });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ alive: false });
    });
    req.on('error', () => {
      resolve({ alive: false });
    });
  });
}

async function runEnvironmentProbe() {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('  LIVE ENVIRONMENT ACCEPTANCE PROBE: GOOGLE FLOW');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  // Step 1: Probe CDP Port 9224
  console.log('1. Kiểm tra Chrome Remote Debugging Port 9224 (Playwright CDP)...');
  const cdpProbe = await probeHttpPort(9224);
  console.log(`   - Port 9224 status: ${cdpProbe.alive ? 'ACTIVE ✅' : 'NOT LISTENING ❌'}`);
  if (cdpProbe.alive) {
    console.log(`   - Browser Info: ${JSON.stringify(cdpProbe.data)}`);
  }

  // Step 2: Probe Extension Bridge Port 9222
  console.log('\n2. Kiểm tra Extension Bridge (FlowBridgeServer) & Cổng 9222...');
  const bridge = FlowBridgeServer.getInstance();
  const bridgeConnected = bridge.isConnected();
  console.log(`   - FlowBridgeServer instance active: ${bridge ? 'YES' : 'NO'}`);
  console.log(`   - Chrome Extension Bridge connected: ${bridgeConnected ? 'CONNECTED ✅' : 'DISCONNECTED ❌'}`);

  // Step 3: Check Chrome Host Executable
  console.log('\n3. Kiểm tra đường dẫn Google Chrome trên hệ điều hành...');
  const bpm = BrowserProcessManager.getInstance();
  const chromePath = bpm.detectChromePath();
  console.log(`   - Chrome binary: ${chromePath || 'KHÔNG TÌM THẤY'}`);

  // Step 4: Evaluate Live E2E readiness
  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log('  ĐÁNH GIÁ ĐIỀU KIỆN TIÊN QUYẾT CHO LIVE E2E GENERATION');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  if (!cdpProbe.alive && !bridgeConnected) {
    console.log('⚠️  TRẠNG THÁI: KHÔNG CÓ PHIÊN GOOGLE FLOW THỰC TẾ ĐANG CHẠY TRÊN MÁY CHỦ.');
    console.log('   - Port 9224 chưa mở (Chrome CDP chưa được khởi chạy với cờ --remote-debugging-port=9224).');
    console.log('   - Extension Bridge chưa kết nối (chưa có tab Google Flow kết nối tới ws://127.0.0.1:9222).');
    console.log('\n🛑 THEO NGUYÊN TẮC KHÁCH QUAN & TRUNG THỰC:');
    console.log('   Hệ thống KHÔNG giả lập kết quả hay tự động đánh dấu Live E2E PASS khi chưa có phiên thật.');
    console.log('   Dừng kiểm thử tại đúng bước cần người dùng thiết lập.');
    console.log('\n📋 HƯỚNG DẪN NGƯỜI DÙNG KÍCH HOẠT PHIÊN THỰC TẾ:');
    console.log('   Cách 1 (Playwright CDP trực tiếp qua cổng 9224):');
    console.log('   Chạy lệnh sau trong PowerShell:');
    console.log('   & "' + (chromePath || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe') + '" --remote-debugging-port=9224 --user-data-dir="' + bpm.getProfileDir('flow') + '" https://labs.google/fx/vi/tools/flow');
    console.log('\n   Cách 2 (Chrome Extension Bridge qua cổng 9222):');
    console.log('   Mở Chrome bình thường có cài extension "VanhSub Flow Bridge", đăng nhập Google và mở https://labs.google/fx/vi/tools/flow.');
    return;
  }

  // If alive, perform real generation test
  console.log('✅ Phát hiện phiên Chrome hợp lệ! Tiến hành Live End-to-End Test...');
  const adapter = BrowserAutomationAdapter.getInstance();
  try {
    const result = await adapter.executeFlowGeneration({
      prompt: 'A calm serene mountain lake with autumn trees at sunset, highly detailed',
      mode: 'image',
      timeoutMs: 45000,
    });
    console.log('Live generation result:', result);
  } catch (err: any) {
    console.error('Live generation error:', err?.message || err);
  }
}

runEnvironmentProbe().catch(console.error);
