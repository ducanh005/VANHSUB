/**
 * VanhSub Flow Bridge — background.js (Manifest V3 Service Worker)
 *
 * Kết nối WebSocket tới ứng dụng VanhSub Desktop (ws://127.0.0.1:9222).
 * Nhận lệnh RPC, mint reCAPTCHA trong tab flow.google.com thật, và thực thi batchexecute.
 */

const WS_URL = 'ws://127.0.0.1:9222';
const FLOW_URLS = [
  'https://flow.google.com/*',
  'https://labs.google/fx/tools/flow*',
  'https://labs.google/fx/*/tools/flow*',
];
const CAPTCHA_SLOT = '__CAPTCHA__';

let ws = null;
let reconnectTimer = null;

function log(...args) {
  console.log('[VanhSub:background]', ...args);
}

function warn(...args) {
  console.warn('[VanhSub:background]', ...args);
}

function error(...args) {
  console.error('[VanhSub:background]', ...args);
}

// ── WebSocket Connection ───────────────────────────────────────────────────────

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  log('Đang kết nối tới VanhSub Desktop tại', WS_URL);

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      log('✅ Đã kết nối thành công tới VanhSub Desktop!');
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
      // Gửi thông báo handshake
      send({
        type: 'HANDSHAKE',
        version: '1.0.0',
        timestamp: Date.now(),
      });
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await handleMessage(msg);
      } catch (err) {
        error('Lỗi phân tích cú pháp message từ WebSocket:', err);
      }
    };

    ws.onclose = () => {
      warn('🔌 Mất kết nối tới VanhSub Desktop. Sẽ tự kết nối lại sau 3s...');
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      warn('WebSocket gặp lỗi:', err.message || 'Connection refused');
      ws.close();
    };
  } catch (err) {
    warn('Không thể mở WebSocket:', err.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setInterval(() => {
      connectWebSocket();
    }, 3000);
  }
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// Giữ Service Worker tỉnh táo khi có tab flow.google.com mở
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'FLOW_KEEP_ALIVE') {
    connectWebSocket();
    port.onMessage.addListener(() => {
      // PING nhận định kỳ, đảm bảo kết nối WS luôn sống
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectWebSocket();
      }
    });
  }
});


// ── Tab Management ─────────────────────────────────────────────────────────────

async function getFlowTab() {
  const tabs = await chrome.tabs.query({ url: FLOW_URLS });
  if (!tabs || tabs.length === 0) return null;
  // Ưu tiên tab đang active hoặc tab không bị discarded
  const activeTab = tabs.find((t) => t.active);
  if (activeTab) return activeTab;
  const readyTab = tabs.find((t) => !t.discarded);
  return readyTab || tabs[0];
}

// ── Message Handlers ───────────────────────────────────────────────────────────

async function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === 'ping') {
    send({ id, result: { pong: true, timestamp: Date.now() } });
    return;
  }

  if (method === 'get_status') {
    const tab = await getFlowTab();
    let diag = null;
    let projectId = null;

    if (tab && tab.url) {
      const match = tab.url.match(/\/project\/([0-9a-f-]{36})/i);
      if (match) projectId = match[1];

      try {
        const [exec] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => {
            const wiz = globalThis.WIZ_global_data || {};
            const hasGrecaptcha = !!(globalThis.grecaptcha && globalThis.grecaptcha.enterprise);
            return {
              url: location.href,
              pathname: location.pathname,
              hasAtToken: !!wiz.SNlM0e,
              siteKey: wiz.xZbWve || null,
              hasGrecaptcha,
              snifferHistory: (globalThis.__VANHSUB_SNIFFER__ && globalThis.__VANHSUB_SNIFFER__.history) ? globalThis.__VANHSUB_SNIFFER__.history : [],
            };
          },
        });
        diag = exec?.result || null;
      } catch (e) {
        diag = { error: e.message };
      }
    }

    send({
      id,
      result: {
        connected: true,
        hasFlowTab: !!tab,
        tabUrl: tab ? tab.url : null,
        tabId: tab ? tab.id : null,
        projectId,
        inProject: !!projectId,
        diag,
      },
    });
    return;
  }

  if (method === 'reload_extension') {
    send({ id, result: { ok: true } });
    setTimeout(() => chrome.runtime.reload(), 200);
    return;
  }

  if (method === 'batch_rpc') {
    log(`🚀 Nhận lệnh batch_rpc cho rpcid=${params?.rpcid}, action=${params?.captchaAction || 'none'}`);
    const result = await runBatchRpc(params);
    if (result.error) {
      error(`❌ batch_rpc thất bại:`, result.error);
      send({ id, error: result.error, detail: result });
    } else {
      log(`✅ batch_rpc thành công (status=${result.status}, body length=${result.body ? result.body.length : 0})`);
      send({ id, result });
    }
    return;
  }

  warn('Không nhận dạng được method:', method);
  send({ id, error: `UNKNOWN_METHOD: ${method}` });
}

// ── Core RPC Execution ─────────────────────────────────────────────────────────

function waitForTabReady(tabId, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          const [res] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => !!(globalThis.WIZ_global_data && globalThis.WIZ_global_data.SNlM0e),
          });
          if (res?.result) {
            clearInterval(interval);
            setTimeout(resolve, 1500);
            return;
          }
        }
      } catch (e) {}

      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        resolve();
      }
    }, 500);
  });
}

async function runBatchRpc(cmd) {
  let tab = await getFlowTab();
  if (!tab) {
    return {
      error: 'NO_FLOW_TAB: Vui lòng mở 1 tab https://flow.google.com/ trên Google Chrome để thực hiện request.',
    };
  }

  // 1. Kiểm tra xem tab có đang ở trong project cụ thể nào không
  let tabProjectId = null;
  if (tab.url) {
    const m = tab.url.match(/\/project\/([0-9a-f-]{36})/i);
    if (m) tabProjectId = m[1];
  }

  // Nếu tab chưa vào project cụ thể nào:
  if (!tabProjectId) {
    if (cmd.projectId) {
      tabProjectId = cmd.projectId;
      log(`🎯 Điều hướng tab tới project được chỉ định: "${tabProjectId}"...`);
      await chrome.tabs.update(tab.id, { url: `https://flow.google.com/project/${tabProjectId}` });
      await waitForTabReady(tab.id, 10000);
      tab = await chrome.tabs.get(tab.id);
    } else {
      // Thử tìm project link có sẵn trên trang https://flow.google.com/
      try {
        const [scan] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => {
            const links = Array.from(document.querySelectorAll('a[href*="/project/"]'));
            for (const a of links) {
              const m = (a.getAttribute('href') || '').match(/\/project\/([0-9a-f-]{36})/i);
              if (m) return m[1];
            }
            return null;
          },
        });
        if (scan?.result) {
          tabProjectId = scan.result;
          log(`🎯 Tìm thấy dự án có sẵn: "${tabProjectId}". Đang tự động mở dự án này trên Chrome...`);
          await chrome.tabs.update(tab.id, { url: `https://flow.google.com/project/${tabProjectId}` });
          await waitForTabReady(tab.id, 10000);
          // Lấy lại tab sau khi điều hướng
          tab = await chrome.tabs.get(tab.id);
        }
      } catch (e) {
        warn('Không thể quét project link trên trang:', e.message);
      }
    }
  }

  // Nếu vẫn chưa có project:
  if (!tabProjectId) {
    return {
      error: 'TAB_NOT_IN_PROJECT: Tab Google Chrome hiện đang ở trang chủ (https://flow.google.com/). Vui lòng click mở một Dự án (Project) bất kỳ trên Google Chrome (hoặc bấm "+ New project") để vào trang làm việc của dự án trước khi tạo ảnh/video!',
    };
  }

  const effectiveProjectId = tabProjectId;
  let freqStr = cmd.freq;

  // Thay thế dummy projectId bất kỳ trong payload bằng project thật đang mở
  if (cmd.projectId && cmd.projectId !== effectiveProjectId) {
    log(`🎯 Thay thế projectId "${cmd.projectId}" → project thật "${effectiveProjectId}"`);
    freqStr = freqStr.split(cmd.projectId).join(effectiveProjectId);
  }

  // 2. Mint reCAPTCHA nếu cần
  if (cmd.captchaAction) {
    log(`🔐 Đang mint CAPTCHA [${cmd.captchaAction}] trong tab ${tab.id} (project ${effectiveProjectId})...`);
    let captchaRes = null;
    try {
      captchaRes = await chrome.tabs.sendMessage(tab.id, {
        action: 'SOLVE_CAPTCHA',
        requestId: 'req_' + Date.now(),
        pageAction: cmd.captchaAction,
      });
    } catch (err) {
      log('⚠️ sendMessage tới tab thất bại, đang reinject content script...', err.message);
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });
        await new Promise((r) => setTimeout(r, 600));
        captchaRes = await chrome.tabs.sendMessage(tab.id, {
          action: 'SOLVE_CAPTCHA',
          requestId: 'req_' + Date.now(),
          pageAction: cmd.captchaAction,
        });
      } catch (reinjectErr) {
        return { error: `CAPTCHA_DISPATCH_ERROR: ${reinjectErr.message}. Vui lòng reload tab flow.google.com trên Chrome.` };
      }
    }

    if (!captchaRes || !captchaRes.token) {
      return { error: `CAPTCHA_MINT_FAILED: ${captchaRes?.error || 'Không nhận được token từ tab'}` };
    }

    log(`✅ Đã mint CAPTCHA token (${captchaRes.token.length} chars). Thay thế vào payload...`);
    freqStr = freqStr.split(CAPTCHA_SLOT).join(captchaRes.token);
  }

  // 3. Thực thi fetch trong MAIN world của trang Flow
  try {
    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [cmd.rpcid, freqStr, effectiveProjectId],
      func: async (rpcid, freq, projectId) => {
        const wiz = globalThis.WIZ_global_data || {};
        const at = wiz.SNlM0e;
        const sid = wiz.FdrFJe;
        const bl = wiz.cfb2h;

        if (!at) {
          return { error: 'NO_AT_TOKEN: Không tìm thấy WIZ_global_data.SNlM0e trong trang Flow' };
        }

        const reqid = Math.floor(Math.random() * 900000) + 100000;
        const sourcePath = projectId ? `/project/${projectId}` : (location.pathname || '/');
        const hl = (document.documentElement.lang || navigator.language || 'vi').split('-')[0];

        const url =
          `/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=${encodeURIComponent(rpcid)}` +
          `&source-path=${encodeURIComponent(sourcePath)}` +
          `&bl=${encodeURIComponent(bl || '')}&f.sid=${encodeURIComponent(sid || '')}` +
          `&hl=${encodeURIComponent(hl)}&_reqid=${reqid}&rt=c`;

        return new Promise((resolve) => {
          try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.withCredentials = true;
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded;charset=utf-8');

            xhr.onload = function() {
              resolve({
                status: xhr.status,
                ok: xhr.status >= 200 && xhr.status < 300,
                body: xhr.responseText,
              });
            };

            xhr.onerror = function() {
              resolve({ error: `XHR_NETWORK_ERROR: status=${xhr.status}` });
            };

            const body = `f.req=${freq}&at=${encodeURIComponent(at)}&`;
            xhr.send(body);
          } catch (xhrErr) {
            resolve({ error: 'XHR_EXCEPTION: ' + (xhrErr.message || String(xhrErr)) });
          }
        });
      },
    });

    return execResult?.result || { error: 'SCRIPT_EXECUTION_EMPTY' };
  } catch (err) {
    return { error: `EXECUTE_SCRIPT_ERROR: ${err.message}` };
  }
}

// Khởi chạy khi service worker bật
connectWebSocket();

chrome.runtime.onStartup.addListener(() => {
  connectWebSocket();
});

chrome.alarms.create('reconnect_alarm', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'reconnect_alarm') {
    connectWebSocket();
  }
});
