/**
 * VanhSub Flow Bridge — content.js
 * Cầu nối giữa background service worker và injected.js trong MAIN world
 *
 * reCAPTCHA preload (chuẩn FlowKit): flow.google.com áp dụng
 * `require-trusted-types-for 'script'` chặn dynamic external scripts từ google.com.
 * Nạp trực tiếp injected.js, recaptcha_enterprise.js và recaptcha__en.js
 * từ chrome-extension:// URL để bypass hoàn toàn CSP của trang.
 */

(function () {
  if (window.__VANHSUB_SCRIPTS_PRELOADED__) return;
  window.__VANHSUB_SCRIPTS_PRELOADED__ = true;

  function addExtScript(name) {
    try {
      const s = document.createElement('script');
      const ver = chrome.runtime?.getManifest?.()?.version || '1.0.4';
      s.src = chrome.runtime.getURL(name) + '?v=' + ver;
      s.onload = () => s.remove();
      s.setAttribute('data-flowkit', name);
      const target = document.head || document.documentElement || document.body;
      if (target) {
        target.appendChild(s);
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          (document.head || document.documentElement || document.body)?.appendChild(s);
        }, { once: true });
      }
    } catch (err) {
      console.warn('[VanhSub:content] Lỗi inject script ' + name + ':', err);
    }
  }

  addExtScript('injected.js');
})();

// Xử lý thông điệp từ background service worker
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'PING' || msg.type === 'PING') {
    try {
      sendResponse({ ok: true, url: window.location.href });
    } catch {}
    return true;
  }

  if (msg.type === 'GET_CAPTCHA' || msg.action === 'SOLVE_CAPTCHA') {
    const requestId = msg.requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const pageAction = msg.pageAction || msg.captchaAction || 'IMAGE_GENERATION';

    let replied = false;
    const onResult = (event) => {
      const detail = event.detail;
      if (detail && detail.requestId === requestId) {
        if (!replied) {
          replied = true;
          window.removeEventListener('CAPTCHA_RESULT', onResult);
          clearTimeout(timer);
          try {
            sendResponse({
              token: detail.token,
              error: detail.error,
              requestId: detail.requestId,
            });
          } catch {}
        }
      }
    };

    const timer = setTimeout(() => {
      if (!replied) {
        replied = true;
        window.removeEventListener('CAPTCHA_RESULT', onResult);
        try {
          sendResponse({ error: 'CONTENT_TIMEOUT', requestId });
        } catch {}
      }
    }, 25000);

    window.addEventListener('CAPTCHA_RESULT', onResult);
    window.dispatchEvent(new CustomEvent('GET_CAPTCHA', {
      detail: { requestId, pageAction },
    }));

    return true; // Keep channel open for async response
  }
});

// Giữ Background Service Worker luôn hoạt động (Keep-Alive Port)
let keepAlivePort = null;
function maintainKeepAlive() {
  try {
    keepAlivePort = chrome.runtime.connect({ name: 'FLOW_KEEP_ALIVE' });
    keepAlivePort.onDisconnect.addListener(() => {
      keepAlivePort = null;
      setTimeout(maintainKeepAlive, 2000);
    });
  } catch (err) {
    setTimeout(maintainKeepAlive, 2000);
  }
}
maintainKeepAlive();

// Gửi PING định kỳ mỗi 20s qua port để chặn Chrome MV3 idle timer
setInterval(() => {
  if (keepAlivePort) {
    try {
      keepAlivePort.postMessage({ type: 'PING' });
    } catch (e) {
      maintainKeepAlive();
    }
  } else {
    maintainKeepAlive();
  }
}, 20000);

// TRPC Media URL Monitor
window.addEventListener('TRPC_MEDIA_URLS', (e) => {
  const { url, body } = e.detail || {};
  if (!body) return;
  chrome.runtime.sendMessage({
    type: 'TRPC_MEDIA_URLS',
    trpcUrl: url,
    body,
  }).catch(() => {});
});
