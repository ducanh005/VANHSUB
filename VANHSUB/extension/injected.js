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
    if (window.WIZ_global_data && typeof window.WIZ_global_data.xZbWve === 'string' && window.WIZ_global_data.xZbWve.length > 20) {
      return window.WIZ_global_data.xZbWve;
    }
  } catch (e) { /* fall through */ }
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

      // Ưu tiên 1: Thực thi trên existing widget ID đã có sẵn trên trang (mang đầy đủ telemetry người dùng)
      const existingId = getExistingWidgetId();
      if (existingId !== null && !isNaN(existingId)) {
        try {
          const token = await Promise.race([
            window.grecaptcha.enterprise.execute(existingId, { action: targetAction }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('execute_hang')), 8000)),
          ]);
          if (token && typeof token === 'string' && token.length > 50) {
            console.log(`[VanhSub:injected] ✅ Đã mint token thành công từ existing widgetId=${existingId} (${token.length} chars)`);
            return String(token);
          }
        } catch (existingErr) {
          console.warn('[VanhSub:injected] Thử existing widgetId thất bại:', existingErr?.message);
        }
      }

      // Ưu tiên 2: Gọi trực tiếp execute với sitekey (API chuẩn reCAPTCHA Enterprise)
      try {
        const token = await Promise.race([
          window.grecaptcha.enterprise.execute(sitekey, { action: targetAction }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('execute_hang')), 8000)),
        ]);
        if (token && typeof token === 'string' && token.length > 50) {
          console.log(`[VanhSub:injected] ✅ Đã mint token thành công từ sitekey trực tiếp (${token.length} chars)`);
          return String(token);
        }
      } catch (sitekeyErr) {
        console.warn('[VanhSub:injected] Thử execute sitekey trực tiếp thất bại:', sitekeyErr?.message);
      }

      // Ưu tiên 3: Fallback render invisible widget
      const widgetId = await ensureWidget(sitekey);
      const token = await Promise.race([
        window.grecaptcha.enterprise.execute(widgetId, { action: targetAction }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('execute_hang')), 8000)),
      ]);
      if (token && typeof token === 'string') return String(token);
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

// ── Enhanced Sniffer for batchexecute & TRPC with Early Warning Signals ───────────
try {
  const MAX_HISTORY = 100;
  const MAX_TRPC_HISTORY = 50;
  const MAX_MEDIA_URLS = 50;
  const MAX_BODY_SNIPPET = 4096;
  const MAX_RESPONSE_SNIPPET = 32768;
  const SENSITIVE_HEADERS = ['cookie', 'set-cookie', 'authorization', 'proxy-authorization', 'x-goog-authuser', 'x-goog-api-key'];

  window.__VANHSUB_SNIFFER__ = window.__VANHSUB_SNIFFER__ || {
    history: [],
    trpcHistory: [],
    mediaUrls: [],
    lastError: null,
    lastWarning: null,
    botFlagged: false,
  };

  function sanitizeHeaders(rawHeaders) {
    if (!rawHeaders || typeof rawHeaders !== 'object') return {};
    const clean = {};
    for (const [k, v] of Object.entries(rawHeaders)) {
      const lower = k.toLowerCase();
      if (!SENSITIVE_HEADERS.includes(lower)) {
        clean[lower] = String(v);
      }
    }
    return clean;
  }

  function inspectAndNotifyError(entry, source) {
    const status = entry.status || 0;
    const url = entry.url || '';
    const text = entry.response || '';
    const lowerText = text.toLowerCase();

    let code = null;
    let message = null;

    // 1. Bot activity / Unusual activity / CAPTCHA flag
    if (
      text.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY') ||
      lowerText.includes('unusual_activity') ||
      lowerText.includes('bot_flagged') ||
      lowerText.includes('captcha_score_low')
    ) {
      code = 'PUBLIC_ERROR_UNUSUAL_ACTIVITY';
      message = 'Google Flow detected automated activity (PUBLIC_ERROR_UNUSUAL_ACTIVITY)';
    } else if (
      lowerText.includes('recaptcha evaluation failed') ||
      lowerText.includes('recaptcha challenge') ||
      lowerText.includes('captcha_required')
    ) {
      code = 'RECAPTCHA_REQUIRED';
      message = 'reCAPTCHA challenge or evaluation required';
    } else if (status === 429 || lowerText.includes('rate_limit_exceeded') || lowerText.includes('too many requests')) {
      code = 'RATE_LIMITED';
      message = `Rate limit exceeded (status ${status || 429})`;
    } else if (status === 403) {
      code = 'FORBIDDEN';
      message = 'HTTP 403: Access forbidden or bot challenge required';
    } else if (status === 401) {
      code = 'SESSION_EXPIRED';
      message = 'HTTP 401: Google session expired';
    } else if (status === 400 && (lowerText.includes('invalid_session') || lowerText.includes('auth'))) {
      code = 'SESSION_EXPIRED';
      message = 'HTTP 400: Session or authentication invalid';
    }

    // 2. TRPC JSON error evaluation
    if (!code && url.includes('/fx/api/trpc/')) {
      try {
        const parsed = JSON.parse(text);
        const trpcErr = parsed?.error || (Array.isArray(parsed) && parsed[0]?.error);
        if (trpcErr) {
          const errMsg = trpcErr.message || trpcErr.json?.message || '';
          const lowerErrMsg = errMsg.toLowerCase();
          if (lowerErrMsg.includes('unusual') || lowerErrMsg.includes('bot') || lowerErrMsg.includes('captcha')) {
            code = 'PUBLIC_ERROR_UNUSUAL_ACTIVITY';
            message = `TRPC Error: ${errMsg}`;
          } else if (lowerErrMsg.includes('rate') || trpcErr.json?.data?.httpStatus === 429) {
            code = 'RATE_LIMITED';
            message = `TRPC Rate Limited: ${errMsg}`;
          } else if (trpcErr.json?.data?.httpStatus === 401 || lowerErrMsg.includes('unauthorized')) {
            code = 'SESSION_EXPIRED';
            message = `TRPC Session Expired: ${errMsg}`;
          }
        }
      } catch {}
    }

    if (code) {
      const warning = {
        timestamp: Date.now(),
        code,
        status,
        url,
        message,
        source,
      };
      window.__VANHSUB_SNIFFER__.lastError = warning;
      window.__VANHSUB_SNIFFER__.lastWarning = warning;
      if (code === 'PUBLIC_ERROR_UNUSUAL_ACTIVITY' || code === 'RECAPTCHA_REQUIRED') {
        window.__VANHSUB_SNIFFER__.botFlagged = true;
      }

      try {
        window.dispatchEvent(new CustomEvent('VANHSUB_EARLY_WARNING', { detail: warning }));
      } catch {}
      console.warn(`[VanhSub:injected] 🚨 Early warning detected (${code}):`, message);
      return warning;
    }
    return null;
  }

  function inspectMediaUrls(url, text) {
    if (!text || typeof text !== 'string') return;
    const matches = [];
    const gcsRegex = /https:\/\/storage\.googleapis\.com\/ai-sandbox-[a-zA-Z0-9_\-\.\/]+/g;
    const flowContentRegex = /https:\/\/flow-content\.google\/[a-zA-Z0-9_\-\.\/]+/g;
    const googleUserContentRegex = /https:\/\/[a-zA-Z0-9_\-\.]*googleusercontent\.com\/[a-zA-Z0-9_\-\.\/]+/g;

    let m;
    while ((m = gcsRegex.exec(text)) !== null) matches.push(m[0]);
    while ((m = flowContentRegex.exec(text)) !== null) matches.push(m[0]);
    while ((m = googleUserContentRegex.exec(text)) !== null) matches.push(m[0]);

    if (matches.length > 0) {
      const list = window.__VANHSUB_SNIFFER__.mediaUrls;
      for (const mUrl of matches) {
        if (!list.includes(mUrl)) {
          list.push(mUrl);
          if (list.length > MAX_MEDIA_URLS) list.shift();
        }
      }

      if (text.includes('storage.googleapis.com/ai-sandbox-videofx/')) {
        try {
          window.dispatchEvent(new CustomEvent('TRPC_MEDIA_URLS', { detail: { url, body: text, mediaUrls: matches } }));
        } catch {}
      }

      try {
        window.dispatchEvent(new CustomEvent('VANHSUB_MEDIA_DETECTED', { detail: { url, mediaUrls: matches, firstMediaUrl: matches[0] } }));
      } catch {}
    }
  }

  function recordTrpcEntry(type, url, body, status, responseText, headers, error) {
    const trpcPath = (url.split('/fx/api/trpc/')[1] || '').split('?')[0];
    const trpcEntry = {
      type,
      trpcPath,
      url,
      body: body ? String(body).slice(0, MAX_BODY_SNIPPET) : '',
      status: status || 0,
      response: responseText ? String(responseText).slice(0, MAX_RESPONSE_SNIPPET) : undefined,
      headers: sanitizeHeaders(headers),
      error: error || undefined,
      timestamp: Date.now(),
    };

    const trpcHist = window.__VANHSUB_SNIFFER__.trpcHistory;
    trpcHist.push(trpcEntry);
    if (trpcHist.length > MAX_TRPC_HISTORY) trpcHist.shift();

    const hist = window.__VANHSUB_SNIFFER__.history;
    hist.push({
      type: 'trpc',
      url,
      body: trpcEntry.body,
      status: trpcEntry.status,
      response: trpcEntry.response,
      timestamp: trpcEntry.timestamp,
      error: trpcEntry.error,
    });
    if (hist.length > MAX_HISTORY) hist.shift();

    if (responseText) {
      inspectMediaUrls(url, responseText);
      inspectAndNotifyError(trpcEntry, 'trpc');
    } else if (status >= 400 || error) {
      inspectAndNotifyError(trpcEntry, 'trpc');
    }

    return trpcEntry;
  }

  if (!window.__VANHSUB_SNIFFER_HOOKS_INSTALLED__) {
    window.__VANHSUB_SNIFFER_HOOKS_INSTALLED__ = true;

    // 1. Hook fetch
    if (typeof window.fetch === 'function') {
      const originalFetch = window.fetch;
      window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || args[0]?.href || String(args[0] || ''));

        // Batchexecute RPC monitor
        if (url.includes('batchexecute')) {
          const body = String((args[1] && args[1].body) || (args[0] && args[0].body) || '');
          const entry = { type: 'fetch', url, body, timestamp: Date.now() };
          window.__VANHSUB_SNIFFER__.history.push(entry);
          if (window.__VANHSUB_SNIFFER__.history.length > MAX_HISTORY) window.__VANHSUB_SNIFFER__.history.shift();
          let res;
          try {
            res = await originalFetch.apply(this, args);
            entry.status = res.status;
          } catch (err) {
            entry.status = 0;
            entry.error = String(err?.message || err);
            inspectAndNotifyError(entry, 'batchexecute');
            throw err;
          }
          try {
            const cloned = res.clone();
            cloned.text().then((text) => {
              entry.response = text;
              inspectMediaUrls(url, text);
              inspectAndNotifyError(entry, 'batchexecute');
            }).catch((err) => {
              entry.error = String(err?.message || err);
              inspectAndNotifyError(entry, 'batchexecute');
            });
          } catch {}
          return res;
        }

        // TRPC Endpoint monitor
        if (url.includes('/fx/api/trpc/')) {
          const body = (args[1] && args[1].body) || (args[0] && args[0].body) || '';
          let res;
          try {
            res = await originalFetch.apply(this, args);
          } catch (err) {
            recordTrpcEntry('fetch', url, body, 0, undefined, args[1]?.headers || args[0]?.headers, String(err?.message || err));
            throw err;
          }
          try {
            const clone = res.clone();
            clone.text().then((text) => {
              recordTrpcEntry('fetch', url, body, res.status, text, args[1]?.headers || args[0]?.headers);
            }).catch((err) => {
              recordTrpcEntry('fetch', url, body, res.status, undefined, args[1]?.headers || args[0]?.headers, String(err?.message || err));
            });
          } catch {}
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
        const self = this;
        if (this._vanhsubUrl && this._vanhsubUrl.includes('batchexecute')) {
          const entry = {
            type: 'xhr',
            url: this._vanhsubUrl,
            body: String(body || ''),
            headers: sanitizeHeaders(this._vanhsubHeaders),
            timestamp: Date.now()
          };
          window.__VANHSUB_SNIFFER__.history.push(entry);
          if (window.__VANHSUB_SNIFFER__.history.length > MAX_HISTORY) window.__VANHSUB_SNIFFER__.history.shift();
          this.addEventListener('load', function() {
            try {
              entry.status = self.status;
              entry.response = self.responseText;
              inspectMediaUrls(self._vanhsubUrl, self.responseText);
              inspectAndNotifyError(entry, 'batchexecute');
            } catch {}
          });
          this.addEventListener('error', function() {
            entry.status = 0;
            entry.error = 'XHR_NETWORK_ERROR';
            inspectAndNotifyError(entry, 'batchexecute');
          });
          this.addEventListener('timeout', function() {
            entry.status = 0;
            entry.error = 'XHR_TIMEOUT';
            inspectAndNotifyError(entry, 'batchexecute');
          });
        }

        if (this._vanhsubUrl && this._vanhsubUrl.includes('/fx/api/trpc/')) {
          this.addEventListener('load', function() {
            try {
              recordTrpcEntry('xhr', self._vanhsubUrl, body, self.status, self.responseText, self._vanhsubHeaders);
            } catch {}
          });
          this.addEventListener('error', function() {
            try {
              recordTrpcEntry('xhr', self._vanhsubUrl, body, 0, undefined, self._vanhsubHeaders, 'XHR_NETWORK_ERROR');
            } catch {}
          });
          this.addEventListener('timeout', function() {
            try {
              recordTrpcEntry('xhr', self._vanhsubUrl, body, 0, undefined, self._vanhsubHeaders, 'XHR_TIMEOUT');
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
