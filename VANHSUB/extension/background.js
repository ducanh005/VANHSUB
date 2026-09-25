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
        version: '1.0.4',
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

async function reviveTabIfNeeded(tab) {
  if (!tab || !tab.discarded) return tab;
  try {
    await chrome.tabs.reload(tab.id);
    await new Promise((r) => setTimeout(r, 2500));
    return await chrome.tabs.get(tab.id);
  } catch {
    return tab;
  }
}

async function getFlowTab() {
  const tabs = await chrome.tabs.query({ url: FLOW_URLS });
  if (!tabs || tabs.length === 0) return null;
  // Ưu tiên tab đang active hoặc tab không bị discarded
  const activeTab = tabs.find((t) => t.active);
  const readyTab = tabs.find((t) => !t.discarded);
  const target = activeTab || readyTab || tabs[0];
  return await reviveTabIfNeeded(target);
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
            const allInitialBtns = Array.from(document.querySelectorAll('button'));
            const trigger = allInitialBtns.find((b) => {
              const aria = (b.getAttribute('aria-label') || '').toLowerCase();
              return (
                aria.includes('kích hoạt') ||
                aria.includes('kich hoat') ||
                aria.includes('cài đặt') ||
                aria.includes('cai dat') ||
                aria.includes('settings')
              );
            }) || document.querySelector('button.settings-trigger-button, flow-settings-button button');

            if (trigger) {
              const curText = (trigger.innerText || '').toLowerCase();
              const isVideo = curText.includes('video') || curText.includes('veo') || curText.includes('giây') || curText.includes('giay') || curText.includes('720p') || curText.includes('1080p');
              const needsSwitch = (targetMode === 'IMAGE' && isVideo) || (targetMode === 'VIDEO' && !isVideo);
              if (needsSwitch) {
                console.log(`[VanhSub:UI] 🔄 Đang chuyển chế độ: hiện tại="${curText.slice(0, 30)}" → mục tiêu=${targetMode}...`);
                let pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
                if (!pane) {
                  trigger.click();
                  await new Promise((r) => setTimeout(r, 700));
                  pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
                }
                const container = document.querySelector('.cdk-overlay-container') || pane;
                if (container) {
                  const modeBtns = Array.from(container.querySelectorAll('mat-button-toggle, button, [role="radio"]'));
                  const kw = targetMode === 'IMAGE' ? ['hình ảnh', 'hinh anh', 'image', 'ảnh', 'anh'] : ['video', 'videocam'];
                  const t = modeBtns.find((b) => kw.some((k) => (b.innerText || '').toLowerCase().includes(k)));
                  if (t) {
                    const clickTarget = t.querySelector('button') || t;
                    clickTarget.click();
                    await new Promise((r) => setTimeout(r, 500));
                  }
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
            pm.dispatchEvent(new Event('input', { bubbles: true }));
            pm.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
            await new Promise((r) => setTimeout(r, 800));

            // 1c. Tim nut Generate - tra ve toa do man hinh
            const currentBtns = Array.from(document.querySelectorAll('button'));
            const btn = currentBtns.find((b) => {
              if (b.disabled) return false;
              const aria = (b.getAttribute('aria-label') || '').toLowerCase();
              const text = (b.innerText || '').trim().toLowerCase();
              return (
                aria.includes('bắt đầu tạo') ||
                aria.includes('bat dau tao') ||
                aria.includes('tạo') ||
                aria.includes('tao') ||
                aria.includes('generate') ||
                aria.includes('create') ||
                aria.includes('submit') ||
                text === 'arrow_forward' ||
                text === 'send'
              );
            });

            if (!btn) {
              return {
                ok: false,
                error: 'NO_GEN_BUTTON',
                allButtons: currentBtns.map((b) => ({
                  text: b.innerText?.slice(0, 30),
                  aria: b.getAttribute('aria-label'),
                  disabled: b.disabled
                }))
              };
            }

            btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            await new Promise((r) => setTimeout(r, 100));
            const rect = btn.getBoundingClientRect();
            const cx = Math.round(rect.left + rect.width / 2);
            const cy = Math.round(rect.top + rect.height / 2);
            console.log(`[VanhSub:UI] 📍 Nút Generate: (${cx}, ${cy}) | aria="${btn.getAttribute('aria-label')}" | text="${btn.innerText?.trim()}" | mode=${targetMode}`);
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
        try {
          await chrome.debugger.attach({ tabId: tab.id }, '1.3');
        } catch (e) {
          console.warn('[VanhSub] debugger attach warn:', e && e.message);
        }

        try {
          // Move chuột đến nút
          await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: p1.cx,
            y: p1.cy,
          });
          await new Promise((r) => setTimeout(r, 60));

          // Bấm chuột xuống
          await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: p1.cx,
            y: p1.cy,
            button: 'left',
            clickCount: 1,
            modifiers: 0,
          });
          await new Promise((r) => setTimeout(r, 100));

          // Nhả chuột
          await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: p1.cx,
            y: p1.cy,
            button: 'left',
            clickCount: 1,
            modifiers: 0,
          });
          console.log(`[VanhSub] 🖱️ Đã phát CDP trusted click tại (${p1.cx}, ${p1.cy}) lúc ${clickTimestamp}`);
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
                if (hit) {
                  console.log('[VanhSub] ✅ Bắt được ogiZ0b response!');
                  return { ok: true, mode: 'IMAGE', rpcid: 'ogiZ0b', url: hit.url, response: hit.response };
                }
                const pend = hist.find((h) => h.url && h.url.includes('ogiZ0b'));
                if (pend) {
                  console.log('[VanhSub] ⏳ ogiZ0b pending status=' + pend.status + ' hasResp=' + !!pend.response);
                }
              } else {
                const hit = hist.find((h) => h.url && h.url.includes('as29s') && h.status === 200 && h.response);
                if (hit) {
                  console.log('[VanhSub] ✅ Bắt được as29s response!');
                  return { ok: true, mode: 'VIDEO', rpcid: 'as29s', url: hit.url, response: hit.response };
                }
              }
            }
            const d = (window.__VANHSUB_SNIFFER__?.history || []).filter((h) => (h.timestamp || 0) >= ctx.clickTimestamp);
            return {
              ok: false,
              error: 'TIMEOUT_WAITING_RESULT',
              targetMode: ctx.targetMode,
              recentRpc: d.map((h) => ({
                rpcid: h.url && h.url.match(/rpcids=([^&]+)/) && h.url.match(/rpcids=([^&]+)/)[1],
                status: h.status,
                hasResp: !!h.response
              }))
            };
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

  if (method === 'solve_captcha' || method === 'get_captcha') {
    const pageAction = params?.captchaAction || params?.pageAction || 'IMAGE_GENERATION';
    const tab = await getFlowTab();
    if (!tab) {
      send({ id, error: 'NO_FLOW_TAB' });
      return;
    }
    try {
      let resp;
      try {
        resp = await chrome.tabs.sendMessage(tab.id, {
          type: 'GET_CAPTCHA',
          requestId: id,
          pageAction,
        });
      } catch (sendErr) {
        const msg = sendErr?.message || '';
        if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
          log('🔄 Content script chưa sẵn sàng trong tab, tự động nạp content.js và thử lại...');
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js'],
          });
          await new Promise((r) => setTimeout(r, 300));
          resp = await chrome.tabs.sendMessage(tab.id, {
            type: 'GET_CAPTCHA',
            requestId: id,
            pageAction,
          });
        } else {
          throw sendErr;
        }
      }

      if (resp && resp.token) {
        send({ id, result: { token: resp.token } });
      } else {
        send({ id, error: resp?.error || 'NO_TOKEN' });
      }
    } catch (e) {
      send({ id, error: e.message });
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
      const promptText = params.prompt || 'a drone shot over ocean waves';
      const clickTimestamp = Date.now();

      // Bước 1: Điền prompt vào ô ProseMirror và lấy tọa độ nút tạo
      const [phase1] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [promptText],
        func: async (text) => {
          let pm = document.querySelector(
            'flow-prompt-box .ProseMirror, .prosemirror-editor .ProseMirror, .ProseMirror, flow-prompt-box [contenteditable="true"], [contenteditable="true"]:not([contenteditable="false"]), textarea:not(.g-recaptcha-response)'
          );
          if (!pm) {
            const editables = Array.from(document.querySelectorAll('[contenteditable="true"], textarea, flow-prompt-box *'));
            pm = editables.find((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 50 && rect.height > 20;
            });
          }
          if (!pm) {
            console.error('[VanhSub:UI] ❌ Không tìm thấy ô nhập prompt!');
            return { ok: false, error: 'NO_PROSEMIRROR' };
          }

          pm.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          await new Promise((r) => setTimeout(r, 100));

          try {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            pm.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
          } catch (e) {}

          document.execCommand('insertText', false, text);
          pm.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
          pm.dispatchEvent(new Event('input', { bubbles: true }));
          pm.dispatchEvent(new Event('change', { bubbles: true }));
          pm.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));

          await new Promise((r) => setTimeout(r, 600));

          // Tìm nút Generate
          const allBtns = Array.from(document.querySelectorAll('button'));
          let btn = allBtns.find((b) => {
            if (b.disabled) return false;
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
            return (
              aria.includes('bắt đầu tạo') ||
              aria.includes('bat dau tao') ||
              aria.includes('tạo') ||
              aria.includes('tao') ||
              aria.includes('generate') ||
              aria.includes('create') ||
              aria.includes('submit') ||
              txt === 'arrow_forward' ||
              txt === 'send' ||
              txt.includes('tạo') ||
              txt.includes('generate')
            );
          });

          if (!btn) {
            btn = document.querySelector('button[aria-label*="tạo" i], button[aria-label*="generate" i], flow-prompt-box button');
          }

          if (!btn) {
            return { ok: false, error: 'NO_GEN_BUTTON' };
          }

          btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          await new Promise((r) => setTimeout(r, 100));
          const rect = btn.getBoundingClientRect();
          const cx = Math.round(rect.left + rect.width / 2);
          const cy = Math.round(rect.top + rect.height / 2);

          return { ok: true, cx, cy, disabled: btn.disabled };
        },
      });

      const p1 = phase1?.result;
      if (!p1?.ok) {
        send({ id, result: p1 || { ok: false, error: 'PHASE1_FAILED' } });
        return;
      }

      // Bước 2: Bấm nút bằng CDP Trusted Click (phần cứng mô phỏng isTrusted=true)
      let cdpSuccess = false;
      try {
        await chrome.debugger.attach({ tabId: tab.id }, '1.3');
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: p1.cx,
          y: p1.cy,
        });
        await new Promise((r) => setTimeout(r, 50));
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: p1.cx,
          y: p1.cy,
          button: 'left',
          clickCount: 1,
          modifiers: 0,
        });
        await new Promise((r) => setTimeout(r, 80));
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: p1.cx,
          y: p1.cy,
          button: 'left',
          clickCount: 1,
          modifiers: 0,
        });
        cdpSuccess = true;
        log(`🖱️ Đã phát CDP trusted click tại (${p1.cx}, ${p1.cy})`);
      } catch (cdpErr) {
        warn('CDP click gặp sự cố, fallback sang DOM click:', cdpErr.message);
      } finally {
        try { await chrome.debugger.detach({ tabId: tab.id }); } catch {}
      }

      if (!cdpSuccess) {
        // Fallback DOM click
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => {
            const allBtns = Array.from(document.querySelectorAll('button'));
            const b = allBtns.find((btn) => {
              const a = (btn.getAttribute('aria-label') || '').toLowerCase();
              return a.includes('tạo') || a.includes('generate');
            });
            if (b) b.click();
          },
        });
      }

      // Bước 3: Đợi gói tin RPC phản hồi từ Google Flow (tối đa 45s)
      const [phase3] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [clickTimestamp],
        func: async (ts) => {
          const deadline = Date.now() + 45000;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 600));
            const hist = (window.__VANHSUB_SNIFFER__?.history || []).filter((h) => (h.timestamp || 0) >= ts);
            const genRpc = hist.find(
              (h) => h.url && (h.url.includes('ogiZ0b') || h.url.includes('YhhmEf') || h.url.includes('eb1hJf') || h.url.includes('MZZa6b')) && h.status === 200 && h.response
            );
            if (genRpc) {
              return {
                ok: true,
                capturedRpc: {
                  url: genRpc.url,
                  rpcid: (genRpc.url.match(/rpcids=([^&]+)/) || [])[1],
                  status: genRpc.status,
                  response: genRpc.response,
                },
              };
            }
          }
          return { ok: false, error: 'TIMEOUT_WAITING_RPC' };
        },
      });

      send({ id, result: phase3?.result || { ok: false, error: 'NO_PHASE3_RESULT' } });
    } catch (err) {
      send({ id, error: err.message });
    }
    return;
  }
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

  // 1. Luôn thay thế placeholder __PROJECT_ID_SLOT__ hoặc __PROJECT_ID__ bằng project thật đang mở
  freqStr = freqStr.split('__PROJECT_ID_SLOT__').join(effectiveProjectId);
  freqStr = freqStr.split('__PROJECT_ID__').join(effectiveProjectId);

  // 2. Nếu cmd.projectId được cung cấp và khác effectiveProjectId, thay thế nó
  if (cmd.projectId && cmd.projectId !== effectiveProjectId) {
    log(`🎯 Thay thế projectId "${cmd.projectId}" → project thật "${effectiveProjectId}"`);
    freqStr = freqStr.split(cmd.projectId).join(effectiveProjectId);
  }

  // 3. Fallback an toàn: Nếu trong securityBlock vị trí projectId bị rỗng
  freqStr = freqStr.replace(/null,22,null,null,null,"",/g, `null,22,null,null,null,"${effectiveProjectId}",`);
  freqStr = freqStr.replace(/null,22,null,null,null,\\"\\",/g, `null,22,null,null,null,\\"${effectiveProjectId}\\",`);
  freqStr = freqStr.replace(/null,22,null,null,null,\\\\\\"\\\\\\",/g, `null,22,null,null,null,\\\\\\"${effectiveProjectId}\\\\\\",`);
  // 2. Đảm bảo content script và injected.js đã sẵn sàng trong tab trước khi thực thi RPC
  try {
    const [check] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => typeof window.mintCaptcha === 'function',
    });
    if (!check?.result) {
      log('🔄 Tab chưa nạp injected.js / content.js, đang tự động nạp content.js...');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      // Đợi nạp injected.js vào MAIN world (tối đa 3s)
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const [recheck] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => typeof window.mintCaptcha === 'function',
        });
        if (recheck?.result) break;
      }
    }
  } catch (injectErr) {
    warn('Không thể tự động nạp content.js vào tab:', injectErr.message);
  }

  // 3. Thực thi trong MAIN world của trang Flow
  try {
    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [cmd.rpcid, freqStr, effectiveProjectId, cmd.captchaAction],
      func: async (rpcid, freq, projectId, captchaAction) => {
        let wiz = globalThis.WIZ_global_data || {};
        let at = wiz.SNlM0e;
        let sid = wiz.FdrFJe;
        let bl = wiz.cfb2h;

        // Chờ WIZ_global_data hydrate nếu trang vừa nạp
        if (!at) {
          for (let i = 0; i < 6 && !at; i++) {
            await new Promise((r) => setTimeout(r, 500));
            wiz = globalThis.WIZ_global_data || {};
            at = wiz.SNlM0e;
            sid = wiz.FdrFJe;
            bl = wiz.cfb2h;
          }
        }

        if (!at) {
          return { error: 'NO_AT_TOKEN: Không tìm thấy WIZ_global_data.SNlM0e trong trang Flow' };
        }

        let finalFreq = freq;
        if (projectId) {
          finalFreq = finalFreq.split('__PROJECT_ID_SLOT__').join(projectId).split('__PROJECT_ID__').join(projectId);
          finalFreq = finalFreq.replace(/null,22,null,null,null,"",/g, `null,22,null,null,null,"${projectId}",`);
          finalFreq = finalFreq.replace(/null,22,null,null,null,\\"\\",/g, `null,22,null,null,null,\\"${projectId}\\",`);
          finalFreq = finalFreq.replace(/null,22,null,null,null,\\\\\\"\\\\\\",/g, `null,22,null,null,null,\\\\\\"${projectId}\\\\\\",`);
          finalFreq = finalFreq.replace(/(null,22,null,null,null,)(?:\\*["']){2},/g, `$1\\"${projectId}\\",`);
        }

        // Nếu RPC yêu cầu CAPTCHA, mint fresh reCAPTCHA token qua invisible widget (chuẩn FlowKit)
        if (captchaAction && (finalFreq.includes('__CAPTCHA__') || finalFreq.includes('__CAPTCHA_TOKEN_SLOT__'))) {
          try {
            console.log(`[VanhSub:exec] 🔐 Đang mint CAPTCHA token trong MAIN world (action=${captchaAction})...`);
            let token = null;

            // Đợi window.mintCaptcha sẵn sàng (tối đa 15s) nếu injected.js đang nạp
            let waitMint = 0;
            while (typeof window.mintCaptcha !== 'function' && waitMint < 30) {
              await new Promise((r) => setTimeout(r, 500));
              waitMint++;
            }

            if (typeof window.mintCaptcha === 'function') {
              token = await window.mintCaptcha(captchaAction);
            } else if (typeof window.executeWithRetry === 'function') {
              const sk = typeof window.resolveSitekey === 'function' ? window.resolveSitekey() : '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
              token = await window.executeWithRetry(sk, captchaAction);
            } else if (window.grecaptcha?.enterprise) {
              await new Promise((res) => {
                try { window.grecaptcha.enterprise.ready(res); } catch (e) { res(); }
                setTimeout(res, 5000);
              });
              const siteKey = (function() {
                try {
                  const cfg = window.___grecaptcha_cfg || {};
                  const clients = cfg.clients || {};
                  for (const k of Object.keys(clients)) {
                    const c = clients[k];
                    if (!c) continue;
                    if (typeof c === 'string' && (c.length > 20 || c.startsWith('6L'))) return c;
                    if (c.sitekey) return c.sitekey;
                    if (c.siteKey) return c.siteKey;
                    if (c.site_key) return c.site_key;
                  }
                } catch (e) {}
                return window.WIZ_global_data?.xZbWve || '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
              })();
              for (let att = 0; att < 2 && !token; att++) {
                try {
                  let host = document.getElementById('flowkit-recaptcha-host');
                  if (!host) {
                    host = document.createElement('div');
                    host.id = 'flowkit-recaptcha-host';
                    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;';
                    (document.documentElement || document.body).appendChild(host);
                  } else if (typeof host.hasChildNodes === 'function' && host.hasChildNodes()) {
                    host.remove();
                    host = document.createElement('div');
                    host.id = 'flowkit-recaptcha-host';
                    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;';
                    (document.documentElement || document.body).appendChild(host);
                  }
                  const widgetId = await new Promise((res, rej) => {
                    try {
                      const wid = window.grecaptcha.enterprise.render(host, {
                        sitekey: siteKey,
                        size: 'invisible',
                        callback: () => {},
                        'error-callback': (m) => rej(new Error('render_error: ' + m)),
                      });
                      res(wid);
                    } catch (e) { rej(e); }
                  });
                  token = await Promise.race([
                    window.grecaptcha.enterprise.execute(widgetId, { action: captchaAction }),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('execute_hang')), 8000)),
                  ]);
                } catch (fallbackErr) {
                  if (att === 1) throw fallbackErr;
                  await new Promise((r) => setTimeout(r, 600));
                }
              }
            }
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

        // Chuẩn hoá URL dạng relative cùng origin theo chuẩn FlowKit
        const url =
          `/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=${encodeURIComponent(rpcid)}` +
          `&source-path=${encodeURIComponent(sourcePath)}` +
          `&bl=${encodeURIComponent(bl || '')}&f.sid=${encodeURIComponent(sid || '')}` +
          `&hl=${encodeURIComponent(hl)}&_reqid=${reqid}&rt=c`;

        // Chuẩn hoá URLSearchParams envelope và headers tối giản theo chuẩn FlowKit (loại bỏ artificial headers bị Google WAF flag)
        const body = new URLSearchParams({ 'f.req': finalFreq, at });

        const headers = {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'x-same-domain': '1',
        };

        try {
          console.log(`[VanhSub:exec] 📡 Đang fetch thuần RPC rpcid=${rpcid}...`);
          const res = await window.fetch(url, {
            method: 'POST',
            credentials: 'include',
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
