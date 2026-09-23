/**
 * VanhSub Flow Bridge — content.js
 * Cầu nối giữa background service worker và injected.js trong MAIN world
 */

function injectScript(filePath) {
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL(filePath);
    s.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(s);
  } catch (err) {
    console.warn('[VanhSub:content] Lỗi inject script:', err);
  }
}

// Nhúng injected.js vào trang
injectScript('injected.js');

// Xử lý thông điệp từ background service worker
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'PING') {
    sendResponse({ ok: true, url: window.location.href });
    return true;
  }

  if (msg.action === 'SOLVE_CAPTCHA') {
    const { requestId, pageAction } = msg;

    const onResult = (event) => {
      const detail = event.detail;
      if (detail && detail.requestId === requestId) {
        window.removeEventListener('CAPTCHA_RESULT', onResult);
        sendResponse(detail);
      }
    };

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

