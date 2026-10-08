/**
 * VanhSub Flow Bridge — background.js (Manifest V3 Service Worker)
 *
 * Kết nối WebSocket tới ứng dụng VanhSub Desktop (ws://127.0.0.1:9222).
 * Nhận lệnh RPC, mint reCAPTCHA trong tab flow.google.com thật, và thực thi batchexecute.
 */

const WS_PORTS = [9222, 8765];
let currentPortIndex = 0;
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

function getExtensionVersion() {
  try {
    return chrome.runtime?.getManifest?.()?.version || '1.0.5';
  } catch {
    return '1.0.5';
  }
}

// ── WebSocket Connection ───────────────────────────────────────────────────────

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const port = WS_PORTS[currentPortIndex % WS_PORTS.length];
  const wsUrl = `ws://127.0.0.1:${port}`;
  log('Đang kết nối tới VanhSub Desktop tại', wsUrl);

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      const ver = getExtensionVersion();
      log(`✅ Đã kết nối thành công tới VanhSub Desktop (${wsUrl}, v${ver})!`);
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
      // Gửi thông báo handshake chuẩn version từ manifest.json
      send({
        type: 'HANDSHAKE',
        version: ver,
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
      warn(`WebSocket gặp lỗi tại cổng ${port}:`, err?.message || 'Connection refused');
      currentPortIndex = (currentPortIndex + 1) % WS_PORTS.length;
      try {
        ws.close();
      } catch {}
    };
  } catch (err) {
    warn('Không thể mở WebSocket:', err.message);
    currentPortIndex = (currentPortIndex + 1) % WS_PORTS.length;
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

function isValidProjectId(id) {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (!trimmed || trimmed === '__PROJECT_ID_SLOT__' || trimmed === '__PROJECT_ID__') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed) ||
    (/^[a-zA-Z0-9_-]{8,}$/.test(trimmed) && !trimmed.startsWith('__'));
}

function extractProjectIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/project\/([0-9a-f-]{36}|[a-zA-Z0-9_-]{8,})/i);
  if (match && isValidProjectId(match[1])) {
    return match[1];
  }
  return null;
}

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

async function getFlowTab(autoCreate = false, preferredProjectId = null) {
  const tabs = await chrome.tabs.query({ url: FLOW_URLS });
  if (!tabs || tabs.length === 0) {
    if (!autoCreate) return null;
    const validPid = isValidProjectId(preferredProjectId) ? preferredProjectId.trim() : null;
    const targetUrl = validPid
      ? `https://labs.google/fx/vi/tools/flow/project/${validPid}`
      : 'https://labs.google/fx/vi/tools/flow';
    log(`🌐 Tự động mở tab Google Flow mới: ${targetUrl}`);
    const created = await chrome.tabs.create({ url: targetUrl, active: true });
    await waitForTabReady(created.id, 15000);
    return await chrome.tabs.get(created.id);
  }
  // Ưu tiên 1: Tab khớp chính xác preferredProjectId (khi người dùng mở nhiều tab Flow khác project)
  const validPid = isValidProjectId(preferredProjectId) ? preferredProjectId.trim() : null;
  if (validPid) {
    const matchingTab = tabs.find((t) => t.url && t.url.includes(`/project/${validPid}`));
    if (matchingTab) {
      return await reviveTabIfNeeded(matchingTab);
    }
  }

  // Ưu tiên 2: tab đang active hoặc tab không bị discarded
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

  if (method === 'ensure_project') {
    try {
      const tab = await getFlowTab(true, params?.projectId);
      const ensured = await ensureTabInProject(tab, params?.projectId, params?.createNew === true);
      send({ id, result: { projectId: ensured.projectId, url: ensured.tab.url } });
    } catch (err) { send({ id, error: err.message }); }
    return;
  }

  if (method === 'get_status') {
    const tab = await getFlowTab(false);
    let diag = null;
    let projectId = null;
    const includeFullDiag = Boolean(params?.fullDiag || params?.includeSniffer);

    if (tab && tab.url) {
      projectId = extractProjectIdFromUrl(tab.url);

      try {
        const [exec] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          args: [includeFullDiag],
          func: (fullDiag) => {
            const wiz = globalThis.WIZ_global_data || {};
            const hasGrecaptcha = !!(globalThis.grecaptcha && globalThis.grecaptcha.enterprise);
            const base = {
              url: location.href,
              pathname: location.pathname,
              hasAtToken: !!wiz.SNlM0e,
              siteKey: wiz.xZbWve || null,
              hasGrecaptcha,
              domInfo: {
                hasProseMirror: !!document.querySelector('.ProseMirror'),
              },
            };
            if (!fullDiag) return base;
            return {
              ...base,
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
        warn('⚠️ __TRIGGER_GEN__ đã bị deprecated, vui lòng chuyển sang Pure batch_rpc');
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

  if (method === 'recover_unusual_activity') {
    log('🛡️ Kích hoạt recover_unusual_activity: Mô phỏng tương tác người dùng tự nhiên (CDP Trusted Click isTrusted=true)...');
    const tab = await getFlowTab(false, params?.projectId);
    if (!tab) {
      send({ id, error: 'NO_FLOW_TAB' });
      return;
    }
    try {
      let cdpAttached = false;
      try {
        await chrome.debugger.attach({ tabId: tab.id }, '1.3');
        cdpAttached = true;
      } catch (e) {
        if (e && e.message && e.message.includes('already attached')) {
          cdpAttached = true;
        } else {
          warn('Debugger attach warn:', e && e.message);
        }
      }

      if (cdpAttached) {
        try {
          const jitterMoves = [
            { x: 450, y: 350 },
            { x: 520, y: 380 },
            { x: 480, y: 420 },
            { x: 400, y: 300 },
          ];
          for (const m of jitterMoves) {
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
              type: 'mouseMoved',
              x: m.x,
              y: m.y,
            });
            await new Promise((r) => setTimeout(r, 60));
          }
          await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: 480,
            y: 420,
            button: 'left',
            clickCount: 1,
            modifiers: 0,
          });
          await new Promise((r) => setTimeout(r, 80));
          await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: 480,
            y: 420,
            button: 'left',
            clickCount: 1,
            modifiers: 0,
          });
          log('🖱️ Đã phát CDP trusted mouse interaction trên tab Flow');
        } catch (dbgErr) {
          warn('CDP mouse simulation error:', dbgErr && dbgErr.message);
        } finally {
          try { await chrome.debugger.detach({ tabId: tab.id }); } catch {}
        }
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => {
            window.scrollBy({ top: 50, behavior: 'smooth' });
            setTimeout(() => window.scrollBy({ top: -50, behavior: 'smooth' }), 300);
          },
        });
      } catch {}

      send({ id, result: { ok: true } });
    } catch (err) {
      send({ id, error: err.message });
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

  // @deprecated: trigger_ui_gen đã bị bãi bỏ, ưu tiên batch_rpc Pure RPC
  if (method === 'trigger_ui_gen') {
    warn('⚠️ trigger_ui_gen fallback CDP Trusted Click được kích hoạt');
    let tab = await getFlowTab(true, params?.projectId);
    if (!tab) {
      send({ id, error: 'NO_FLOW_TAB' });
      return;
    }
    try {
      const ensured = await ensureTabInProject(tab, params?.projectId);
      tab = ensured.tab;
      const promptText = params.prompt || 'a drone shot over ocean waves';
      const targetMode = (params.mode || 'IMAGE').toUpperCase();
      const clickTimestamp = Date.now();

      // Bước 1: Chuyển chế độ (Image vs Video nếu cần), điền prompt vào ô ProseMirror và lấy tọa độ nút tạo
      const [phase1] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [{ promptText, targetMode }],
        func: async (cfg) => {
          const reqMode = (cfg.targetMode || 'IMAGE').toUpperCase();
          const text = cfg.promptText || '';

          // 1a. Xác định container chứa prompt box
          const promptBox =
            document.querySelector(
              'flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, .prompt-box-container, .base-prompt-box'
            ) || document.body;

          // 1b. Chuyển chế độ (Image vs Video) nếu cần thiết
          let trigger =
            promptBox.querySelector('button.settings-trigger-button, flow-settings-button button, [aria-haspopup="true"]') ||
            document.querySelector('button.settings-trigger-button, flow-settings-button button');

          if (trigger) {
            const curText = ((trigger.innerText || '') + ' ' + (trigger.getAttribute('aria-label') || '')).toLowerCase();
            const isVideo =
              curText.includes('video') ||
              curText.includes('veo') ||
              curText.includes('giây') ||
              curText.includes('giay') ||
              curText.includes('720p') ||
              curText.includes('1080p') ||
              curText.includes('360p');
            const isImage =
              curText.includes('hình ảnh') ||
              curText.includes('hinh anh') ||
              curText.includes('image') ||
              curText.includes('imagen') ||
              curText.includes('ảnh') ||
              curText.includes('anh');
            const needsSwitch = (reqMode === 'IMAGE' && (isVideo || !isImage)) || (reqMode === 'VIDEO' && (isImage || !isVideo));
            if (needsSwitch) {
              console.log(`[VanhSub:UI] 🔄 Đang chuyển chế độ: hiện tại="${curText.slice(0, 40)}" → mục tiêu=${reqMode}...`);
              let pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
              if (!pane) {
                trigger.click();
                await new Promise((r) => setTimeout(r, 600));
                pane = document.querySelector('.cdk-overlay-pane, flow-settings-popover');
              }
              const container = document.querySelector('.cdk-overlay-container') || pane || document.body;
              if (container) {
                const modeBtns = Array.from(
                  container.querySelectorAll('mat-button-toggle, button, [role="radio"], [role="menuitem"], [role="tab"]')
                );
                const kw = reqMode === 'IMAGE' ? ['hình ảnh', 'hinh anh', 'image', 'imagen', 'ảnh', 'anh'] : ['video', 'videocam', 'veo'];
                const t = modeBtns.find((b) => kw.some((k) => (b.innerText || b.getAttribute('aria-label') || '').toLowerCase().includes(k)));
                if (t) {
                  const clickTarget = t.querySelector('button') || t;
                  clickTarget.click();
                  await new Promise((r) => setTimeout(r, 400));
                }
              }
              const bd = document.querySelector('.cdk-overlay-backdrop');
              if (bd) bd.click();
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              await new Promise((r) => setTimeout(r, 400));
            }
          }

          // 1c. Tìm ô nhập prompt bên trong promptBox
          let pm = promptBox.querySelector('.ProseMirror, [contenteditable="true"], textarea:not(.g-recaptcha-response)');
          if (!pm) {
            pm = document.querySelector(
              'flow-prompt-box .ProseMirror, .prosemirror-editor .ProseMirror, .ProseMirror, flow-prompt-box [contenteditable="true"], [contenteditable="true"]:not([contenteditable="false"]), textarea:not(.g-recaptcha-response)'
            );
          }
          if (!pm) {
            const editables = Array.from(promptBox.querySelectorAll('[contenteditable="true"], textarea, div[role="textbox"]'));
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

          // 1d. Tìm nút Generate CHÍNH XÁC bên trong promptBox và chờ Angular validate enable nút
          let btn = null;
          const waitBtnStart = Date.now();
          while (Date.now() - waitBtnStart < 3500) {
            btn = promptBox.querySelector(
              'flow-generate-icon-button button, button.generate-icon-button, button.submit-button, flow-prompt-box button[type="submit"]'
            );

            if (!btn) {
              const boxBtns = Array.from(promptBox.querySelectorAll('button')).filter((b) => {
                if (b.classList.contains('settings-trigger-button') || b.closest('flow-settings-button')) return false;
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                if (aria.includes('cài đặt') || aria.includes('settings') || aria.includes('chế độ') || aria.includes('tùy chọn')) return false;
                return true;
              });

              btn = boxBtns.find((b) => {
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
                return (
                  aria.includes('bắt đầu tạo') ||
                  aria.includes('bat dau tao') ||
                  aria.includes('tạo') ||
                  aria.includes('generate') ||
                  aria.includes('create') ||
                  aria.includes('submit') ||
                  aria.includes('start') ||
                  txt === 'arrow_forward' ||
                  txt === 'arrow_upward' ||
                  txt === 'send' ||
                  txt === 'spark' ||
                  b.querySelector('mat-icon')
                );
              });

              if (!btn && boxBtns.length > 0) {
                btn = boxBtns[boxBtns.length - 1]; // Nút action cuối cùng ở góc phải promptBox
              }
            }

            if (btn && !btn.disabled && !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true') {
              break; // Đã tìm thấy nút enabled!
            }
            await new Promise((r) => setTimeout(r, 100));
          }

          if (!btn) {
            return { ok: false, error: 'NO_GEN_BUTTON' };
          }

          // Kích hoạt DOM click tức thời
          try {
            btn.click();
          } catch (e) {}

          btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          await new Promise((r) => setTimeout(r, 80));
          const rect = btn.getBoundingClientRect();
          const cx = Math.round(rect.left + rect.width / 2);
          const cy = Math.round(rect.top + rect.height / 2);

          return { ok: true, cx, cy, disabled: btn.disabled, targetMode: reqMode };
        },
      });

      const p1 = phase1?.result;
      if (!p1?.ok) {
        send({ id, result: p1 || { ok: false, error: 'PHASE1_FAILED' } });
        return;
      }

      // Bước 2: Bấm nút bằng CDP Trusted Click (phần cứng mô phỏng isTrusted=true)
      let cdpSuccess = false;
      let actualClickTimestamp = clickTimestamp;
      try {
        try {
          await chrome.debugger.attach({ tabId: tab.id }, '1.3');
        } catch (attErr) {
          if (!attErr?.message?.includes('already attached')) {
            throw attErr;
          }
        }
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: p1.cx,
          y: p1.cy,
        });
        await new Promise((r) => setTimeout(r, 40));
        actualClickTimestamp = Date.now();
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: p1.cx,
          y: p1.cy,
          button: 'left',
          clickCount: 1,
          modifiers: 0,
        });
        await new Promise((r) => setTimeout(r, 60));
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: p1.cx,
          y: p1.cy,
          button: 'left',
          clickCount: 1,
          modifiers: 0,
        });

        cdpSuccess = true;
        log(`🖱️ Đã phát CDP trusted click tại (${p1.cx}, ${p1.cy}) cho mode=${targetMode}`);
      } catch (cdpErr) {
        warn('CDP click gặp sự cố, fallback sang DOM click:', cdpErr.message);
      } finally {
        try { await chrome.debugger.detach({ tabId: tab.id }); } catch {}
      }

      if (!cdpSuccess) {
        // Fallback DOM click & Enter event
        actualClickTimestamp = Date.now();
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => {
            const promptBox =
              document.querySelector('flow-prompt-box, flow-base-prompt-box, .prompt-box-container') || document;
            const b =
              promptBox.querySelector('flow-generate-icon-button button, button.generate-icon-button, button.submit-button, button[type="submit"]') ||
              Array.from(promptBox.querySelectorAll('button')).pop();
            if (b) b.click();
          },
        });
      }

      const clientTimeout = typeof params?.timeoutMs === 'number' && params.timeoutMs > 0 ? params.timeoutMs : 90000;

      // Bước 3: Đợi gói tin RPC phản hồi từ Google Flow
      const [phase3] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [{ clickTimestamp: Math.max(0, actualClickTimestamp - 200), targetMode, timeoutMs: clientTimeout - 5000 }],
        func: async (args) => {
          const ts = args.clickTimestamp;
          const mode = (args.targetMode || 'IMAGE').toUpperCase();
          const deadline = Date.now() + (args.timeoutMs || 85000);
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 350));
            const hist = (window.__VANHSUB_SNIFFER__?.history || []).filter((h) => (h.timestamp || 0) >= ts);
            // Ưu tiên RPC khớp chính xác với mode được yêu cầu, ngăn chặn bắt nhầm gói tin chéo mode
            const genRpc = hist.find((h) => {
              if (!h.url || h.status !== 200 || !h.response) return false;
              if (mode === 'IMAGE') {
                return h.url.includes('ogiZ0b');
              } else {
                return h.url.includes('as29s') || h.url.includes('MZZa6b') || h.url.includes('YhhmEf') || h.url.includes('eb1hJf');
              }
            });
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

            // Fallback cross-mode: nếu sau 10s không có genRpc theo mode mong muốn,
            // nhưng đã có RPC media thành công (ví dụ giao diện sinh video kèm thumbnail),
            // bắt lấy ngay lập tức để trích xuất media thay vì chờ lâu
            if (Date.now() - ts > 10000) {
              const fallbackRpc = hist.find((h) => {
                if (!h.url || h.status !== 200 || !h.response) return false;
                return (
                  h.url.includes('as29s') ||
                  h.url.includes('ogiZ0b') ||
                  h.url.includes('MZZa6b') ||
                  h.url.includes('YhhmEf')
                );
              });
              if (fallbackRpc) {
                console.warn('[VanhSub:UI] ⚠️ Bắt được fallback cross-mode RPC:', fallbackRpc.url);
                return {
                  ok: true,
                  crossMode: true,
                  capturedRpc: {
                    url: fallbackRpc.url,
                    rpcid: (fallbackRpc.url.match(/rpcids=([^&]+)/) || [])[1],
                    status: fallbackRpc.status,
                    response: fallbackRpc.response,
                  },
                };
              }

              // Fallback DOM inspect: nếu RPC sniffer không đón được (do cache/stream),
              // tìm kiếm asset card mới nhất xuất hiện trên gallery của Flow
              const mediaImgs = Array.from(
                document.querySelectorAll('flow-asset-card img, flow-media-tile img, mat-card img, [data-asset-id] img')
              );
              const targetImg = mediaImgs.find((im) => {
                const s = im.src || '';
                return s.includes('googleusercontent.com') || s.includes('ai-sandbox');
              });
              if (targetImg) {
                const src = targetImg.src;
                console.log('[VanhSub:UI] 🖼️ Phát hiện ảnh mới trực tiếp trên DOM của Flow:', src.slice(0, 80));
                const rpcid = mode === 'IMAGE' ? 'ogiZ0b' : 'as29s';
                return {
                  ok: true,
                  domFallback: true,
                  firstImageUrl: src,
                  capturedRpc: {
                    url: 'DOM_EXTRACTED',
                    rpcid,
                    status: 200,
                    response: `)]}'\n\n100\n[["wrb.fr","${rpcid}",${JSON.stringify(JSON.stringify([null, [[null, null, null, null, null, null, null, null, null, null, null, null, null, null, src]]]))},"generic"]]\n`,
                  },
                };
              }
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

async function ensureTabInProject(tab, preferredProjectId, createNew = false) {
  let currentTab = tab;
  let tabProjectId = extractProjectIdFromUrl(currentTab?.url);
  const validPreferredId = isValidProjectId(preferredProjectId) ? preferredProjectId.trim() : null;

  const oldProjectId = tabProjectId;
  if (!validPreferredId && !createNew) {
    throw new Error('FLOW_PROJECT_REQUIRED: Chưa liên kết project Flow cho tác vụ. Không sử dụng project đang mở.');
  }
  if (createNew) {
    await chrome.tabs.update(currentTab.id, { url: 'https://labs.google/fx/vi/tools/flow' });
    await waitForTabReady(currentTab.id, 15000);
    currentTab = await chrome.tabs.get(currentTab.id);
    tabProjectId = extractProjectIdFromUrl(currentTab.url);
    if (tabProjectId) throw new Error('FLOW_PROJECT_CREATE_FAILED: Không mở được trang tạo project mới.');
  }

  // Nếu VanhSub chỉ định projectId hợp lệ cụ thể và tab hiện tại chưa ở đúng project đó:
  if (validPreferredId && validPreferredId !== tabProjectId) {
    tabProjectId = validPreferredId;
    const baseOrigin = currentTab.url && currentTab.url.includes('labs.google')
      ? 'https://labs.google/fx/vi/tools/flow/project/'
      : 'https://flow.google.com/project/';
    log(`🎯 Điều hướng tab tới project được chỉ định: "${tabProjectId}"...`);
    await chrome.tabs.update(currentTab.id, { url: `${baseOrigin}${tabProjectId}` });
    await waitForTabReady(currentTab.id, 10000);
    currentTab = await chrome.tabs.get(currentTab.id);
    tabProjectId = extractProjectIdFromUrl(currentTab?.url);
    if (tabProjectId !== validPreferredId) throw new Error('FLOW_PROJECT_MISMATCH: Không mở được đúng project đã liên kết.');
  }

  // Nếu tab đang ở trang sảnh (chưa vào /project/<uuid>), thử tự động click mở hoặc tạo dự án mới
  if (!tabProjectId && currentTab?.id) {
    try {
      log('🔄 Tab đang ở trang chủ Flow, thử tự động vào dự án hoặc bấm "+ Dự án mới"...');
      await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        world: 'MAIN',
        func: () => {
          const elements = Array.from(
            document.querySelectorAll(
              'button, a, [role="button"], [data-testid*="new-project"], [data-testid*="create-project"], .new-project-button, mat-button'
            )
          );
          const newProjBtn = elements.find((b) => {
            const t = (
              b.innerText ||
              b.getAttribute('aria-label') ||
              b.getAttribute('title') ||
              b.getAttribute('data-testid') ||
              ''
            ).toLowerCase();
            return (
              t.includes('new project') ||
              t.includes('dự án mới') ||
              t.includes('du an moi') ||
              t.includes('tạo dự án') ||
              t.includes('create project') ||
              t.includes('new-project') ||
              t.includes('start a new project')
            );
          });
          if (newProjBtn) {
            newProjBtn.click();
            return true;
          }
          return false;
        },
      });
      // Chờ tối đa 8s để URL chuyển sang /project/<id>
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 500));
        currentTab = await chrome.tabs.get(currentTab.id);
        tabProjectId = extractProjectIdFromUrl(currentTab?.url);
        if (tabProjectId) {
          await waitForTabReady(currentTab.id, 6000);
          break;
        }
      }
    } catch (e) {
      warn('Không thể tự động click vào project từ trang chủ:', e?.message);
    }
  }

  if (!tabProjectId || (createNew && tabProjectId === oldProjectId)) {
    throw new Error('FLOW_PROJECT_CREATE_FAILED: Chưa xác nhận được project mới. Vui lòng kiểm tra trang Flow.');
  }
  return { tab: currentTab, projectId: tabProjectId };
}

async function runBatchRpc(cmd) {
  let tab = await getFlowTab(true, cmd?.projectId);
  if (!tab) {
    return {
      error: 'NO_FLOW_TAB: Vui lòng mở 1 tab https://flow.google.com/ trên Google Chrome để thực hiện request.',
    };
  }

  const ensured = await ensureTabInProject(tab, cmd?.projectId);
  tab = ensured.tab;
  const tabProjectId = ensured.projectId;

  // Nếu vẫn chưa có project (tab đang ở trang chủ hoặc trang đăng nhập):
  if (!tabProjectId) {
    return {
      error: 'TAB_NOT_IN_PROJECT: Tab Google Chrome hiện chưa ở trong trang dự án (https://flow.google.com/). Vui lòng đăng nhập và bấm mở một Dự án (Project) hoặc "+ New project" trên Google Chrome!',
    };
  }

  const effectiveProjectId = tabProjectId;
  let freqStr = cmd.freq;

  // 1. Luôn thay thế placeholder __PROJECT_ID_SLOT__ hoặc __PROJECT_ID__ bằng project thật đang mở
  freqStr = freqStr.split('__PROJECT_ID_SLOT__').join(effectiveProjectId);
  freqStr = freqStr.split('__PROJECT_ID__').join(effectiveProjectId);

  // 2. Nếu cmd.projectId hợp lệ được cung cấp và khác effectiveProjectId, thay thế nó
  if (isValidProjectId(cmd.projectId) && cmd.projectId !== effectiveProjectId) {
    log(`🎯 Thay thế projectId "${cmd.projectId}" → project thật "${effectiveProjectId}"`);
    freqStr = freqStr.split(cmd.projectId).join(effectiveProjectId);
  }

  // 3. Fallback an toàn: Nếu trong securityBlock vị trí projectId bị rỗng
  freqStr = freqStr.replace(/null,22,null,null,null,"",/g, `null,22,null,null,null,"${effectiveProjectId}",`);
  freqStr = freqStr.replace(/null,22,null,null,null,\\"\\",/g, `null,22,null,null,null,\\"${effectiveProjectId}\\",`);
  freqStr = freqStr.replace(/null,22,null,null,null,\\\\\\"\\\\\\",/g, `null,22,null,null,null,\\\\\\"${effectiveProjectId}\\\\\\",`);
  // 2. Đảm bảo injected.js đã sẵn sàng trong MAIN world của tab trước khi thực thi RPC
  try {
    const [check] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => typeof window.mintCaptcha === 'function',
    });
    if (!check?.result) {
      log('🔄 Tab chưa nạp injected.js trong MAIN world, đang tự động nạp...');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        files: ['injected.js'],
      });
      await new Promise((r) => setTimeout(r, 200));
    }
  } catch (injectErr) {
    warn('Không thể tự động nạp injected.js vào tab:', injectErr.message);
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
          try {
            const scripts = Array.from(document.querySelectorAll('script'));
            for (const s of scripts) {
              const text = s.textContent || '';
              const patterns = [
                /"SNlM0e"\s*:\s*"([^"]{20,}?)"/,
                /"at"\s*:\s*"(AIQ-[^"]+?)"/,
                /"at"\s*:\s*"(AF[^"]+?)"/,
                /"csrfToken"\s*:\s*"([^"]+?)"/,
              ];
              for (const pattern of patterns) {
                const m = text.match(pattern);
                if (m && m[1]) {
                  at = m[1];
                  break;
                }
              }
              if (at) break;
            }
          } catch (e) {}
        }

        if (!at) {
          try {
            const meta = document.querySelector('meta[name="at"], meta[name="_at"]');
            if (meta) {
              const content = meta.getAttribute('content');
              if (content) at = content;
            }
          } catch (e) {}
        }

        if (!at) {
          return { error: 'NO_AT_TOKEN: Không tìm thấy CSRF at token (WIZ_global_data.SNlM0e) trong trang Flow' };
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
                  if (window.WIZ_global_data && typeof window.WIZ_global_data.xZbWve === 'string' && window.WIZ_global_data.xZbWve.length > 20) {
                    return window.WIZ_global_data.xZbWve;
                  }
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

              // Ưu tiên 1: Tận dụng existing widget của Flow để lấy trọn vẹn behavioral signals của người dùng
              const existingWidgetId = (function() {
                try {
                  const cfg = window.___grecaptcha_cfg || {};
                  const clients = cfg.clients || {};
                  const keys = Object.keys(clients);
                  if (keys.length > 0) return Number(keys[0]);
                } catch (e) {}
                return null;
              })();

              if (existingWidgetId !== null && !isNaN(existingWidgetId)) {
                try {
                  token = await Promise.race([
                    window.grecaptcha.enterprise.execute(existingWidgetId, { action: captchaAction }),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('execute_hang')), 8000)),
                  ]);
                  if (token && typeof token === 'string' && token.length > 50) {
                    console.log(`[VanhSub:exec] ✅ Đã mint CAPTCHA token từ existing widgetId=${existingWidgetId} (${token.length} chars)`);
                  }
                } catch (e) {}
              }

              // Ưu tiên 2: Gọi execute trực tiếp với siteKey
              if (!token) {
                try {
                  token = await Promise.race([
                    window.grecaptcha.enterprise.execute(siteKey, { action: captchaAction }),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('execute_hang')), 8000)),
                  ]);
                  if (token && typeof token === 'string' && token.length > 50) {
                    console.log(`[VanhSub:exec] ✅ Đã mint CAPTCHA token trực tiếp qua siteKey (${token.length} chars)`);
                  }
                } catch (e) {}
              }

              // Ưu tiên 3: Fallback render invisible widget nếu cần
              if (!token) {
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

        window.__vanhsub_reqseq = ((window.__vanhsub_reqseq || 0) + 1);
        const now = new Date();
        const secondsSinceMidnight = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        const reqid = (window.__vanhsub_reqseq * 100000) + secondsSinceMidnight;
        const sourcePath = projectId ? `/project/${projectId}` : (location.pathname || '/');
        const hl = (document.documentElement.lang || navigator.language || 'vi').split('-')[0];

        // Chuẩn hoá URL dạng relative cùng origin theo chuẩn FlowKit
        const url =
          `/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=${encodeURIComponent(rpcid)}` +
          `&source-path=${encodeURIComponent(sourcePath)}` +
          `&bl=${encodeURIComponent(bl || '')}&f.sid=${encodeURIComponent(sid || '')}` +
          `&hl=${encodeURIComponent(hl)}&_reqid=${reqid}&rt=c`;

        // Chuẩn hoá POST body với trailing & chuẩn Google batchexecute theo phân tích HAR
        const body = `f.req=${encodeURIComponent(finalFreq)}&at=${encodeURIComponent(at)}&`;

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
