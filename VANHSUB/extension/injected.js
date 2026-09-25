/**
 * VanhSub Flow Bridge — injected.js
 * Injected into the page's MAIN world on flow.google.com (and labs.google)
 * Direct access to window.grecaptcha and window.___grecaptcha_cfg
 *
 * FlowKit-standard invisible widget minting for reCAPTCHA Enterprise:
 * Resolves sitekey from window.___grecaptcha_cfg.clients (fallback SITE_KEY)
 * Renders invisible widget into #flowkit-recaptcha-host
 * Executes with widgetId returned by render
 * Synchronizes mint calls via Promise queue (captchaMintTail)
 */

const SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

// ─── reCAPTCHA mint (Chuẩn FlowKit — ported from FlowBridge2) ───
// Flow's current build rejects a token obtained by calling
// `grecaptcha.enterprise.execute(SITE_KEY, {action})` directly with
// PUBLIC_ERROR_UNUSUAL_ACTIVITY ("reCAPTCHA evaluation failed"), even though the
// site key and action match the UI byte for byte, while the same account's UI
// still generates. The working recipe is the one the page itself uses: ready() →
// render an invisible widget bound to the page's own site key → execute(widgetId).
// Prefer the site key the page is currently configured with; the constant is only
// a fallback for a page that has not configured one yet.
function resolveSitekey() {
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
      if (typeof c === 'object') {
        for (const prop of Object.keys(c)) {
          const val = c[prop];
          if (typeof val === 'string' && (val.length > 20 || val.startsWith('6L'))) return val;
          if (val && typeof val === 'object') {
            if (val.sitekey) return val.sitekey;
            if (val.siteKey) return val.siteKey;
            if (val.site_key) return val.site_key;
            for (const subProp of Object.keys(val)) {
              const subVal = val[subProp];
              if (typeof subVal === 'string' && (subVal.length > 20 || subVal.startsWith('6L'))) return subVal;
            }
          }
        }
      }
    }
  } catch (e) { /* fall through */ }
  try {
    if (window.WIZ_global_data && window.WIZ_global_data.xZbWve) {
      return window.WIZ_global_data.xZbWve;
    }
  } catch (e) { /* fall through */ }
  return SITE_KEY;
}

function waitReady(timeout = 5000) {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    try { window.grecaptcha?.enterprise?.ready?.(fin); } catch (e) { /* ignore */ }
    setTimeout(fin, timeout);
  });
}

let _widgetPromise = (window.__VANHSUB_WIDGET_PROMISE__ = window.__VANHSUB_WIDGET_PROMISE__ || null);
let _cachedSitekey = (window.__VANHSUB_CACHED_SITEKEY__ = window.__VANHSUB_CACHED_SITEKEY__ || null);

function ensureWidget(sitekey) {
  if (_widgetPromise && _cachedSitekey === sitekey) return _widgetPromise;
  _cachedSitekey = (window.__VANHSUB_CACHED_SITEKEY__ = sitekey);
  _widgetPromise = (async () => {
    await waitReady(5000);
    let host = document.getElementById('flowkit-recaptcha-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'flowkit-recaptcha-host';
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;';
      (document.documentElement || document.body).appendChild(host);
    } else if (typeof host.hasChildNodes === 'function' && host.hasChildNodes()) {
      // Làm sạch host nếu đã có child nodes từ lần render trước để tránh lỗi "placeholder element must be empty"
      host.remove();
      host = document.createElement('div');
      host.id = 'flowkit-recaptcha-host';
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;';
      (document.documentElement || document.body).appendChild(host);
    }
    return await new Promise((resolve, reject) => {
      try {
        const widgetId = window.grecaptcha.enterprise.render(host, {
          sitekey,
          size: 'invisible',
          callback: () => {},
          'error-callback': (m) => reject(new Error('render_error: ' + m)),
        });
        resolve(widgetId);
      } catch (e) {
        reject(new Error('render_threw: ' + (e && e.message || e)));
      }
    });
  })().catch((e) => {
    _widgetPromise = null;
    window.__VANHSUB_WIDGET_PROMISE__ = null;
    throw e;
  });
  window.__VANHSUB_WIDGET_PROMISE__ = _widgetPromise;
  return _widgetPromise;
}

function getExistingWidgetId() {
  try {
    const cfg = window.___grecaptcha_cfg || {};
    const clients = cfg.clients || {};
    const keys = Object.keys(clients);
    if (keys.length > 0) {
      for (const k of keys) {
        const c = clients[k];
        if (c && (c.sitekey || c.siteKey)) {
          return Number(k);
        }
      }
      return Number(keys[0]);
    }
  } catch (e) {}
  return null;
}

async function executeWithRetry(sitekey, action, attempts = 2) {
  const targetAction = action || 'IMAGE_GENERATION';
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await waitReady(2500);
      let widgetId = getExistingWidgetId();
      if (widgetId === null || isNaN(widgetId)) {
        widgetId = await ensureWidget(sitekey);
      }
      const token = await Promise.race([
        window.grecaptcha.enterprise.execute(widgetId, { action: targetAction }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('execute_hang')), 8000)),
      ]);
      if (token) return String(token);
      lastErr = new Error('empty_token');
    } catch (e) {
      lastErr = e;
      _widgetPromise = null;
      window.__VANHSUB_WIDGET_PROMISE__ = null; // Reset promise để lượt retry kế tiếp render lại widget sạch
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  _widgetPromise = null;
  window.__VANHSUB_WIDGET_PROMISE__ = null;
  throw lastErr || new Error('execute_failed');
}

function waitForGrecaptcha(timeout = 22000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const start = Date.now();
    const check = () => {
      if (done) return;
      if (window.grecaptcha?.enterprise?.execute && window.grecaptcha?.enterprise?.render) {
        done = true;
        return resolve();
      }
      if (Date.now() - start > timeout) {
        done = true;
        return reject(new Error('grecaptcha not available'));
      }
      setTimeout(check, 200);
    };
    try { window.grecaptcha?.enterprise?.ready?.(check); } catch (e) {}
    check();
  });
}

let captchaMintTail = (window.__VANHSUB_MINT_TAIL__ = window.__VANHSUB_MINT_TAIL__ || Promise.resolve());

async function mintCaptcha(pageAction = 'IMAGE_GENERATION') {
  const previous = captchaMintTail.catch(() => {});
  let release;
  captchaMintTail = (window.__VANHSUB_MINT_TAIL__ = new Promise((resolve) => { release = resolve; }));
  await previous;
  try {
    await waitForGrecaptcha();
    return await executeWithRetry(resolveSitekey(), pageAction || 'IMAGE_GENERATION');
  } finally {
    release();
  }
}

// Lắng nghe sự kiện GET_CAPTCHA từ content.js (Idempotent guard tránh nhân đôi listener khi reinject)
if (!window.__VANHSUB_CAPTCHA_LISTENER_REGISTERED__) {
  window.__VANHSUB_CAPTCHA_LISTENER_REGISTERED__ = true;
  window.addEventListener('GET_CAPTCHA', async ({ detail }) => {
    const { requestId, pageAction } = detail || {};
    if (!requestId) return;
    try {
      const token = await mintCaptcha(pageAction || 'IMAGE_GENERATION');
      window.dispatchEvent(new CustomEvent('CAPTCHA_RESULT', {
        detail: { requestId, token },
      }));
    } catch (e) {
      console.error('[VanhSub:injected] ❌ Lỗi mint CAPTCHA:', e.message);
      window.dispatchEvent(new CustomEvent('CAPTCHA_RESULT', {
        detail: { requestId, error: e.message },
      }));
    }
  });
}

// Expose on window for direct access / diagnostic calls
window.SITE_KEY = SITE_KEY;
window.resolveSitekey = resolveSitekey;
window.waitReady = waitReady;
window.ensureWidget = ensureWidget;
window.executeWithRetry = executeWithRetry;
window.mintCaptcha = mintCaptcha;
window.waitForGrecaptcha = waitForGrecaptcha;

// ── Non-intrusive Sniffer for batchexecute & TRPC ──────────────────────────────────
try {
  window.__VANHSUB_SNIFFER__ = window.__VANHSUB_SNIFFER__ || {
    history: [],
  };

  if (!window.__VANHSUB_SNIFFER_HOOKS_INSTALLED__) {
    window.__VANHSUB_SNIFFER_HOOKS_INSTALLED__ = true;

    // 1. Hook fetch
    if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || args[0]?.href || String(args[0] || ''));
      if (url.includes('batchexecute')) {
        const body = String((args[1] && args[1].body) || (args[0] && args[0].body) || '');
        const entry = { type: 'fetch', url, body, timestamp: Date.now() };
        window.__VANHSUB_SNIFFER__.history.push(entry);
        if (window.__VANHSUB_SNIFFER__.history.length > 100) window.__VANHSUB_SNIFFER__.history.shift();
        const res = await originalFetch.apply(this, args);
        try {
          const cloned = res.clone();
          cloned.text().then((text) => { entry.response = text; });
        } catch {}
        return res;
      }
      // TRPC Media URL Monitor
      if (url.includes('/fx/api/trpc/')) {
        const res = await originalFetch.apply(this, args);
        if (res.ok) {
          try {
            const clone = res.clone();
            clone.text().then((text) => {
              if (text.includes('storage.googleapis.com/ai-sandbox-videofx/')) {
                window.dispatchEvent(new CustomEvent('TRPC_MEDIA_URLS', {
                  detail: { url, body: text },
                }));
              }
            }).catch(() => {});
          } catch {}
        }
        return res;
      }
      return originalFetch.apply(this, args);
    };
  }

  // 2. Hook XMLHttpRequest (Google Closure XhrIo uses this)
  if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) {
    const origXhrOpen = XMLHttpRequest.prototype.open;
    const origXhrSend = XMLHttpRequest.prototype.send;
    const origXhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._vanhsubUrl = String(url || '');
    this._vanhsubMethod = method;
    this._vanhsubHeaders = {};
    return origXhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
    if (!this._vanhsubHeaders) this._vanhsubHeaders = {};
    const key = String(header || '').toLowerCase();
    this._vanhsubHeaders[key] = value;
    return origXhrSetHeader.call(this, header, value);
  };

  XMLHttpRequest.prototype.send = function(body) {
    if (this._vanhsubUrl && this._vanhsubUrl.includes('batchexecute')) {
      const entry = {
        type: 'xhr',
        url: this._vanhsubUrl,
        body: String(body || ''),
        headers: this._vanhsubHeaders || {},
        timestamp: Date.now()
      };
      window.__VANHSUB_SNIFFER__.history.push(entry);
      if (window.__VANHSUB_SNIFFER__.history.length > 100) window.__VANHSUB_SNIFFER__.history.shift();
      this.addEventListener('load', function() {
        try {
          entry.status = this.status;
          entry.response = this.responseText;
        } catch {}
      });
    }
    return origXhrSend.call(this, body);
    };
  }
  }
} catch (e) {
  console.warn('[VanhSub:injected] Sniffer init error:', e.message);
}

if (typeof module !== 'undefined' && module.exports && typeof process !== 'undefined' && process.versions && process.versions.node) {
  module.exports = {
    SITE_KEY,
    resolveSitekey,
    waitReady,
    ensureWidget,
    executeWithRetry,
    mintCaptcha,
    waitForGrecaptcha,
  };
}

console.log('[VanhSub Flow Bridge] injected.js (FlowKit Standard) đã sẵn sàng trong MAIN world.');
