const status = document.getElementById('status');
let waitingUntil = 0;
async function refresh() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'BRIDGE_PAIRING_STATUS' });
    status.textContent = result?.connected ? 'Đã ghép đôi và xác thực với VANHSUB.'
      : Date.now() < waitingUntil ? 'Đang xác thực mã ghép đôi…' : 'Chưa xác thực. Mở VANHSUB và dùng mã còn hạn (2 phút).';
  } catch { status.textContent = 'Không kết nối được service worker. Hãy tải lại extension.'; }
}
document.getElementById('pair-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await chrome.runtime.sendMessage({ type: 'BRIDGE_PAIR', code: document.getElementById('code').value.trim() });
    document.getElementById('code').value = '';
    waitingUntil = Date.now() + 3000;
    status.textContent = result?.ok ? 'Đã gửi mã. Đang xác thực…' : result?.error || 'Không thể ghép đôi.';
  } catch { status.textContent = 'Không gửi được mã ghép đôi.'; }
});
refresh();
setInterval(refresh, 1000);
