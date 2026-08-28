const fs = require('fs');
const names = [
  'electron_browser_app',
  'electron_browser_browser_window',
  'electron_browser_ipc_main',
  'electron_browser_dialog',
  'electron_common_shell',
  'electron_common_protocol',
  'electron_common_native_image'
];
const result = {};
for (const name of names) {
  try {
    const mod = process._linkedBinding(name);
    result[name] = mod ? Object.keys(mod) : null;
  } catch (e) {
    result[name] = 'error: ' + e.message;
  }
}
fs.writeFileSync('D:/DEAN/DEAN/VANHSUB/bindings_out.json', JSON.stringify(result, null, 2));
