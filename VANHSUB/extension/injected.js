/**
 * VanhSub Flow Bridge — injected.js
 * Chạy trong MAIN world của flow.google.com — truy cập trực tiếp window.grecaptcha
 */

const DEFAULT_SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

function getSiteKey() {
  try {
    if (window.WIZ_global_data && window.WIZ_global_data.xZbWve) {
      return window.WIZ_global_data.xZbWve;
    }
  } catch (e) {}
  return DEFAULT_SITE_KEY;
}

function waitForGrecaptcha(timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.grecaptcha && window.grecaptcha.enterprise && typeof window.grecaptcha.enterprise.execute === 'function') {
        if (typeof window.grecaptcha.enterprise.ready === 'function') {
          window.grecaptcha.enterprise.ready(() => resolve());
          return;
        }
        return resolve();
      }
      if (Date.now() - start > timeout) {
        return reject(new Error('grecaptcha.enterprise không khả dụng sau ' + timeout + 'ms'));
      }
      setTimeout(check, 300);
    };
    check();
  });
}

let captchaMintTail = Promise.resolve();

async function mintCaptcha(pageAction) {
  const previous = captchaMintTail.catch(() => {});
  let release;
  captchaMintTail = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    await waitForGrecaptcha();
    const siteKey = getSiteKey();
    console.log('[VanhSub:injected] 🔐 Đang mint CAPTCHA với action=' + pageAction + ', siteKey=' + siteKey);
    const token = await window.grecaptcha.enterprise.execute(siteKey, {
      action: pageAction,
    });
    console.log('[VanhSub:injected] ✅ Đã mint CAPTCHA token thành công, độ dài: ' + (token ? token.length : 0));
    return token;
  } finally {
    release();
  }
}

// Lắng nghe yêu cầu sinh CAPTCHA từ content.js
window.addEventListener('GET_CAPTCHA', async ({ detail }) => {
  const { requestId, pageAction } = detail;
  try {
    const token = await mintCaptcha(pageAction);
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

// ── Non-intrusive Sniffer for batchexecute ──────────────────────────────────
try {
  window.__VANHSUB_SNIFFER__ = {
    history: [],
  };

  // 1. Hook fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = String(args[0] || '');
    if (url.includes('batchexecute')) {
      const init = args[1] || {};
      const body = String(init.body || '');
      console.log('[VanhSub:sniffer:fetch] 📡 batchexecute detected:', url.slice(0, 100));
      const entry = { type: 'fetch', url, body, timestamp: Date.now() };
      window.__VANHSUB_SNIFFER__.history.push(entry);
      if (window.__VANHSUB_SNIFFER__.history.length > 30) window.__VANHSUB_SNIFFER__.history.shift();
      const res = await originalFetch.apply(this, args);
      try {
        const cloned = res.clone();
        cloned.text().then((text) => { entry.response = text; });
      } catch {}
      return res;
    }
    return originalFetch.apply(this, args);
  };

  // 2. Hook XMLHttpRequest (Google Closure XhrIo uses this)
  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._vanhsubUrl = String(url || '');
    this._vanhsubMethod = method;
    return origXhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this._vanhsubUrl && this._vanhsubUrl.includes('batchexecute')) {
      console.log('[VanhSub:sniffer:xhr] 📡 batchexecute detected:', this._vanhsubUrl.slice(0, 100));
      const entry = { type: 'xhr', url: this._vanhsubUrl, body: String(body || ''), timestamp: Date.now() };
      window.__VANHSUB_SNIFFER__.history.push(entry);
      if (window.__VANHSUB_SNIFFER__.history.length > 30) window.__VANHSUB_SNIFFER__.history.shift();
      this.addEventListener('load', function() {
        try {
          entry.status = this.status;
          entry.response = this.responseText;
        } catch {}
      });
    }
    return origXhrSend.call(this, body);
  };
} catch (e) {
  console.warn('[VanhSub:injected] Sniffer init error:', e.message);
}

console.log('[VanhSub Flow Bridge] injected.js đã sẵn sàng trong MAIN world.');
