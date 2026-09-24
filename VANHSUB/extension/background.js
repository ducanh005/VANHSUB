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
              wizKeys: Object.keys(wiz),
              wizValues: Object.fromEntries(
                Object.entries(wiz).filter(([k, v]) => typeof v === 'string' && v.length < 100)
              ),
              vanhsubHeaders: globalThis.__VANHSUB_HEADERS__ || {},
              captchaCalls: globalThis.__VANHSUB_CAPTCHA_CALLS__ || [],
              promptSettings: (() => {
                try {
                  return JSON.parse(localStorage.getItem('flow-prompt-box-settings') || '{}');
                } catch (e) {
                  return null;
                }
              })(),
              domInfo: {
                hasProseMirror: !!document.querySelector('.ProseMirror'),
                proseMirrorText: document.querySelector('.ProseMirror')?.innerText?.slice(0, 50) || null,
                buttons: Array.from(document.querySelectorAll('button'))
                  .map((b) => ({
                    text: (b.innerText || '').trim().slice(0, 40),
                    aria: b.getAttribute('aria-label'),
                    visible: b.getBoundingClientRect().width > 0,
                  }))
                  .filter((b) => b.visible && (b.text || b.aria))
                  .slice(0, 25),
              },
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

  if (method === 'reload_tab') {
    const tab = await getFlowTab();
    if (!tab) {
      send({ id, error: 'NO_FLOW_TAB' });
      return;
    }
    log(`🔄 Đang reload tab Flow (tab ${tab.id})...`);
    await chrome.tabs.reload(tab.id);
    await waitForTabReady(tab.id, 15000);
    log(`✅ Tab Flow đã reload và sẵn sàng!`);
    send({ id, result: { ok: true } });
    return;
  }

  if (method === 'tab_eval') {
    const tab = await getFlowTab();
    if (!tab) {
      send({ id, error: 'NO_FLOW_TAB' });
      return;
    }
    try {
      const codeStr = String(params.code || '');
      if (codeStr === '__INSPECT_SETTINGS__') {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: async () => {
            const trigger = document.querySelector('button[aria-label*="Điều kiện kích hoạt" i], button.settings-trigger-button, flow-settings-button button');
            if (trigger) trigger.click();
            await new Promise((r) => setTimeout(r, 800));
            const container = document.querySelector('.cdk-overlay-container');
            const items = container
              ? Array.from(container.querySelectorAll('button, [role="tab"], [role="radio"], [role="button"], mat-button-toggle')).map((b) => ({
                  text: (b.innerText || '').trim().slice(0, 40),
                  aria: b.getAttribute('aria-label'),
                }))
              : [];
            // Click backdrop to close
            const bd = document.querySelector('.cdk-overlay-backdrop');
            if (bd) bd.click();
            return {
              triggerText: trigger ? trigger.innerText : null,
              hasContainer: !!container,
              items,
            };
          },
        });
        send({ id, result: res?.result });
        return;
      }

      if (codeStr === '__TEST_SWITCH_MODE__') {
        const [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: async () => {
            const trigger = document.querySelector('button[aria-label*="Điều kiện kích hoạt" i], button.settings-trigger-button, flow-settings-button button');
            if (!trigger) return { ok: false, error: 'NO_TRIGGER' };
            const beforeText = trigger.innerText;
            let pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
            if (!pane) {
              trigger.click();
              await new Promise((r) => setTimeout(r, 700));
              pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
            }

            const container = document.querySelector('.cdk-overlay-container') || pane;
            const btns = container ? Array.from(container.querySelectorAll('mat-button-toggle, button, [role="radio"]')) : [];
            const allBtnTexts = btns.map(b => (b.innerText || '').trim());
            const imgBtn = btns.find((b) => {
              const t = (b.innerText || '').toLowerCase();
              return t.includes('hình ảnh') || t.includes('image');
            });

            let clicked = false;
            let clickedTag = null;
            if (imgBtn) {
              const target = imgBtn.querySelector('button') || imgBtn;
              clickedTag = target.tagName + '.' + target.className;
              target.click();
              clicked = true;
              await new Promise((r) => setTimeout(r, 400));
            }

            const bd = document.querySelector('.cdk-overlay-backdrop');
            if (bd) bd.click();
            await new Promise((r) => setTimeout(r, 500));

            const afterText = trigger.innerText;
            return { ok: true, beforeText, afterText, clicked, clickedTag, allBtnTexts };
          },
        });
        send({ id, result: res?.result });
        return;
      }

      if (codeStr.startsWith('__TRIGGER_GEN__:')) {
        let cfg;
        try {
          cfg = JSON.parse(codeStr.slice('__TRIGGER_GEN__:'.length));
        } catch {
          cfg = { mode: 'VIDEO', prompt: codeStr.slice('__TRIGGER_GEN__:'.length) };
        }

        // Phase 1: Mode-switch + type prompt + get button screen coords
        const [phase1] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          args: [cfg],
          func: async (config) => {
            const targetMode = (config.mode || 'IMAGE').toUpperCase();
            const promptText = config.prompt || '';

            // 1a. Chuyen che do neu can
            const trigger = document.querySelector(
              'button[aria-label*="Dieu kien kich hoat" i], button.settings-trigger-button, flow-settings-button button'
            );
            if (trigger) {
              const curText = (trigger.innerText || '').toLowerCase();
              const isVideo = curText.includes('video') || curText.includes('veo') || curText.includes('giay');
              const needsSwitch = (targetMode === 'IMAGE' && isVideo) || (targetMode === 'VIDEO' && !isVideo);
              if (needsSwitch) {
                let pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
                if (!pane) { trigger.click(); await new Promise((r) => setTimeout(r, 700)); pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover'); }
                const container = document.querySelector('.cdk-overlay-container') || pane;
                if (container) {
                  const btns = Array.from(container.querySelectorAll('mat-button-toggle, button, [role="radio"]'));
                  const kw = targetMode === 'IMAGE' ? ['hinh anh', 'image'] : ['video', 'videocam'];
                  const t = btns.find((b) => kw.some((k) => (b.innerText || '').toLowerCase().includes(k)));
                  if (t) { (t.querySelector('button') || t).click(); await new Promise((r) => setTimeout(r, 400)); }
                }
                const bd = document.querySelector('.cdk-overlay-backdrop');
                if (bd) bd.click();
                await new Promise((r) => setTimeout(r, 500));
              }
            }

            // 1b. Nhap prompt
            const pm = document.querySelector('.ProseMirror');
            if (!pm) return { ok: false, error: 'NO_PROSEMIRROR' };
            pm.focus();
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);
            await new Promise((r) => setTimeout(r, 100));
            document.execCommand('insertText', false, promptText);
            pm.dispatchEvent(new InputEvent('input', { bubbles: true, data: promptText, inputType: 'insertText' }));
            await new Promise((r) => setTimeout(r, 1000));

            // 1c. Tim nut Generate - tra ve toa do man hinh
            const btn = document.querySelector('button[aria-label*="Bat dau tao" i]')
              || document.querySelector('button[aria-label*="tao" i]')
              || document.querySelector('button[aria-label*="generate" i]');
            if (!btn || btn.disabled) {
              return { ok: false, error: 'NO_GEN_BUTTON', allButtons: Array.from(document.querySelectorAll('button')).map((b) => ({ aria: b.getAttribute('aria-label'), disabled: b.disabled })) };
            }
            const rect = btn.getBoundingClientRect();
            const cx = Math.round(rect.left + rect.width / 2);
            const cy = Math.round(rect.top + rect.height / 2);
            console.log('[VanhSub:UI] Generate btn at (' + cx + ',' + cy + ') mode=' + targetMode);
            return { ok: true, cx, cy, targetMode };
          },
        });

        const p1 = phase1?.result;
        if (!p1?.ok) {
          if (p1?.allButtons) console.error('[VanhSub] NO_GEN_BUTTON:', JSON.stringify(p1.allButtons));
          send({ id, result: p1 || { ok: false, error: 'PHASE1_FAILED' } });
          return;
        }

        // Phase 2: CDP trusted click (isTrusted=true)
        const clickTimestamp = Date.now();
        try { await chrome.debugger.attach({ tabId: tab.id }, '1.3'); } catch {}
        try {
          await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: p1.cx, y: p1.cy, button: 'left', clickCount: 1, modifiers: 0 });
          await new Promise((r) => setTimeout(r, 80));
          await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: p1.cx, y: p1.cy, button: 'left', clickCount: 1, modifiers: 0 });
          console.log('[VanhSub] CDP trusted click at (' + p1.cx + ',' + p1.cy + ') ts=' + clickTimestamp);
        } catch (e) {
          try { await chrome.debugger.detach({ tabId: tab.id }); } catch {}
          send({ id, result: { ok: false, error: 'CDP_CLICK_FAILED: ' + (e && e.message) } });
          return;
        }
        try { await chrome.debugger.detach({ tabId: tab.id }); } catch {}

        // Phase 3: Poll sniffer for RPC result
        const [phase3] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          args: [{ targetMode: p1.targetMode, clickTimestamp }],
          func: async (ctx) => {
            const deadline = ctx.clickTimestamp + 120000;
            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 800));
              const hist = (window.__VANHSUB_SNIFFER__?.history || []).filter((h) => (h.timestamp || 0) >= ctx.clickTimestamp);
              if (ctx.targetMode === 'IMAGE') {
                const hit = hist.find((h) => h.url && h.url.includes('ogiZ0b') && h.status === 200 && h.response);
                if (hit) { console.log('[VanhSub] ogiZ0b captured!'); return { ok: true, mode: 'IMAGE', rpcid: 'ogiZ0b', url: hit.url, response: hit.response }; }
                const pend = hist.find((h) => h.url && h.url.includes('ogiZ0b'));
                if (pend) console.log('[VanhSub] ogiZ0b pending status=' + pend.status + ' hasResp=' + !!pend.response);
              } else {
                const hit = hist.find((h) => h.url && h.url.includes('as29s') && h.status === 200 && h.response);
                if (hit) { console.log('[VanhSub] as29s captured!'); return { ok: true, mode: 'VIDEO', rpcid: 'as29s', url: hit.url, response: hit.response }; }
              }
            }
            const d = (window.__VANHSUB_SNIFFER__?.history || []).filter((h) => (h.timestamp || 0) >= ctx.clickTimestamp);
            return { ok: false, error: 'TIMEOUT_WAITING_RESULT', targetMode: ctx.targetMode, recentRpc: d.map((h) => ({ rpcid: h.url && h.url.match(/rpcids=([^&]+)/) && h.url.match(/rpcids=([^&]+)/)[1], status: h.status, hasResp: !!h.response })) };
          },
        });
        send({ id, result: phase3?.result });
        return;
      }
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: (code) => {
          try {
            return { ok: true, val: eval(code) };
          } catch (e) {
            return { ok: false, err: e.message };
          }
        },
        args: [params.code],
      });
      send({ id, result: res?.result });
    } catch (err) {
      send({ id, error: err.message });
    }
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

  if (method === 'dom_inspect') {
    const tab = await getFlowTab();
    if (!tab) {
      send({ id, error: 'NO_FLOW_TAB' });
      return;
    }
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
          const promptBoxes = Array.from(document.querySelectorAll('.ProseMirror, textarea, [contenteditable="true"]')).map((el) => ({
            tag: el.tagName,
            cls: el.className,
            placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder'),
            text: el.innerText?.slice(0, 50),
            visible: el.getBoundingClientRect().width > 0,
          }));

          const buttons = Array.from(document.querySelectorAll('button')).map((b) => ({
            text: b.innerText?.trim().slice(0, 40),
            aria: b.getAttribute('aria-label'),
            cls: b.className,
            disabled: b.disabled,
            visible: b.getBoundingClientRect().width > 0,
          })).filter((b) => b.visible && (b.text || b.aria));

          return { promptBoxes, buttons: buttons.slice(0, 30) };
        },
      });
      send({ id, result: res?.result });
    } catch (err) {
      send({ id, error: err.message });
    }
    return;
  }

  if (method === 'trigger_ui_gen') {
    const tab = await getFlowTab();
    if (!tab) {
      send({ id, error: 'NO_FLOW_TAB' });
      return;
    }
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [params.prompt || 'a drone shot over ocean waves'],
        func: async (promptText) => {
          const pm = document.querySelector('.ProseMirror');
          if (!pm) return { ok: false, error: 'NO_PROSEMIRROR' };

          pm.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, promptText);
          pm.dispatchEvent(new Event('input', { bubbles: true }));

          await new Promise((r) => setTimeout(r, 600));

          const btn = document.querySelector(
            'button[aria-label*="tạo" i], button[aria-label*="generate" i], button[aria-label*="Bắt đầu tạo" i]'
          );
          if (!btn) return { ok: false, error: 'NO_GEN_BUTTON' };

          const prevCaptchaCount = (window.__VANHSUB_CAPTCHA_CALLS__ || []).length;
          const prevHistoryCount = (window.__VANHSUB_SNIFFER__?.history || []).length;

          btn.click();

          const start = Date.now();
          while (Date.now() - start < 15000) {
            await new Promise((r) => setTimeout(r, 500));
            const newHistory = (window.__VANHSUB_SNIFFER__?.history || []).slice(prevHistoryCount);
            const genRpc = newHistory.find(
              (h) => h.url && (h.url.includes('ogiZ0b') || h.url.includes('YhhmEf') || h.url.includes('MZZa6b'))
            );
            if (genRpc) {
              const newCaptcha = (window.__VANHSUB_CAPTCHA_CALLS__ || []).slice(prevCaptchaCount);
              return {
                ok: true,
                capturedRpc: {
                  url: genRpc.url,
                  rpcid: (genRpc.url.match(/rpcids=([^&]+)/) || [])[1],
                  status: genRpc.status,
                  response: genRpc.response,
                },
                captchaCalls: newCaptcha,
              };
            }
          }

          return {
            ok: false,
            error: 'TIMEOUT_WAITING_RPC',
            captchaCalls: (window.__VANHSUB_CAPTCHA_CALLS__ || []).slice(prevCaptchaCount),
            recentHistory: (window.__VANHSUB_SNIFFER__?.history || []).slice(prevHistoryCount).map((h) => ({
              url: h.url,
              status: h.status,
              response: h.response ? h.response.slice(0, 100) : '',
            })),
          };
        },
      });
      send({ id, result: res?.result });
    } catch (err) {
      send({ id, error: err.message });
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

  // 2. Thực thi trong MAIN world của trang Flow
  try {
    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [cmd.rpcid, freqStr, effectiveProjectId, cmd.captchaAction],
      func: async (rpcid, freq, projectId, captchaAction) => {
        const wiz = globalThis.WIZ_global_data || {};
        const at = wiz.SNlM0e;
        const sid = wiz.FdrFJe;
        const bl = wiz.cfb2h;
        const siteKey = wiz.xZbWve || '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

        if (!at) {
          return { error: 'NO_AT_TOKEN: Không tìm thấy WIZ_global_data.SNlM0e trong trang Flow' };
        }

        let finalFreq = freq;

        // Nếu RPC yêu cầu CAPTCHA, mint fresh reCAPTCHA token trực tiếp trong MAIN world ngay trước khi gửi request
        if (captchaAction && (finalFreq.includes('__CAPTCHA__') || finalFreq.includes('__CAPTCHA_TOKEN_SLOT__'))) {
          if (!window.grecaptcha || !window.grecaptcha.enterprise || typeof window.grecaptcha.enterprise.execute !== 'function') {
            return { error: 'NO_GRECAPTCHA: grecaptcha.enterprise chưa sẵn sàng trên trang Flow' };
          }
          try {
            console.log(`[VanhSub:exec] 🔐 Đang mint CAPTCHA token trong MAIN world (action=${captchaAction}, siteKey=${siteKey})...`);
            try {
              const x = Math.floor(Math.random() * 300) + 100;
              const y = Math.floor(Math.random() * 300) + 100;
              window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
              window.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
              window.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }));
            } catch {}
            const token = await window.grecaptcha.enterprise.execute(siteKey, { action: captchaAction });
            if (!token) {
              return { error: 'EMPTY_CAPTCHA_TOKEN: grecaptcha trả về token rỗng' };
            }
            console.log(`[VanhSub:exec] ✅ Đã mint CAPTCHA token thành công (${token.length} chars)`);
            finalFreq = finalFreq.split('__CAPTCHA__').join(token).split('__CAPTCHA_TOKEN_SLOT__').join(token);
          } catch (captchaErr) {
            return { error: 'CAPTCHA_EXECUTE_ERROR: ' + (captchaErr.message || String(captchaErr)) };
          }
        }

        const reqid = Math.floor(Math.random() * 900000) + 100000;
        const sourcePath = projectId ? `/project/${projectId}` : (location.pathname || '/');
        const hl = (document.documentElement.lang || navigator.language || 'vi').split('-')[0];

        const url =
          `https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=${encodeURIComponent(rpcid)}` +
          `&source-path=${encodeURIComponent(sourcePath)}` +
          `&bl=${encodeURIComponent(bl || '')}&f.sid=${encodeURIComponent(sid || '')}` +
          `&hl=${encodeURIComponent(hl)}&_reqid=${reqid}&rt=c`;

        const body = `f.req=${encodeURIComponent(finalFreq)}&at=${encodeURIComponent(at)}&`;

        // Chuẩn hoá headers khớp 100% với DevTool Chrome thật
        const headers = {
          'accept': '*/*',
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'priority': 'u=1, i',
          'x-browser-channel': 'stable',
          'x-browser-copyright': 'Copyright 2026 Google LLC. All Rights Reserved.',
          'x-browser-year': '2026',
          'x-same-domain': '1',
          ...(window.__VANHSUB_HEADERS__ || {}),
        };

        try {
          console.log(`[VanhSub:exec] 📡 Đang fetch thuần RPC rpcid=${rpcid}...`);
          const res = await window.fetch(url, {
            method: 'POST',
            credentials: 'include',
            mode: 'cors',
            referrer: 'https://flow.google.com/',
            headers,
            body,
          });
          const text = await res.text();
          return {
            status: res.status,
            ok: res.ok,
            body: text,
          };
        } catch (fetchErr) {
          return { error: 'FETCH_EXCEPTION: ' + (fetchErr.message || String(fetchErr)) };
        }
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
