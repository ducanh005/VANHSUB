import fs from 'fs';
const app = process._linkedBinding('electron_browser_app');
const bw = process._linkedBinding('electron_browser_browser_window');
const ipc = process._linkedBinding('electron_browser_ipc_main');
fs.writeFileSync('esm_test.txt', JSON.stringify({
  appKeys: Object.keys(app || {}),
  bwKeys: Object.keys(bw || {}),
  ipcKeys: Object.keys(ipc || {})
}, null, 2));
