const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '..');
const evidence = path.resolve(process.env.VANHSUB_AUDIT_EVIDENCE_DIR || path.join(source, 'docs/rc-evidence/2026-10-15'));
const manifestPath = path.join(evidence, 'build-workspace.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath));
const build = path.resolve(manifest.path);
if (path.dirname(build) !== 'D:\\DEAN\\DEAN\\VANHSUB\\temp' || !/^codex-rc-build-[a-f0-9]+$/.test(path.basename(build))) throw new Error('Expected owned RC build');
// Refuse before syncing or clearing artifacts if the previous EXE is under acceptance.
if (process.platform === 'win32') {
  const executable = path.join(build, 'dist/win-unpacked/VANHSUB.exe').replaceAll("'", "''");
  const active = require('node:child_process').execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `@(Get-CimInstance Win32_Process -Filter "Name = 'VANHSUB.exe'" | Where-Object ExecutablePath -eq '${executable}' | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true }).trim();
  if (active && active !== '[]') throw new Error('RC_BUILD_IN_USE: close the owned acceptance application before rebuilding');
}
const updated = [], removed = [];
for (const relative of Object.keys(manifest.files)) {
  const target = path.resolve(build, relative);
  if (!target.startsWith(build + path.sep)) throw new Error('Unsafe build target');
  if (!fs.existsSync(path.join(source, relative))) {
    if (fs.existsSync(target) && fs.lstatSync(target).isFile()) fs.unlinkSync(target);
    delete manifest.files[relative]; removed.push(relative);
  }
}
function sync(relative) {
  const file = path.join(source, relative), stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error('Unexpected source symlink');
  if (stat.isDirectory()) {
    if (['.next', 'node_modules', '.git', 'out', 'build'].includes(path.basename(relative))) return;
    for (const name of fs.readdirSync(file)) sync(path.join(relative, name));
  } else if (!relative.endsWith('.tsbuildinfo')) {
    const content = fs.readFileSync(file), hash = crypto.createHash('sha256').update(content).digest('hex');
    if (manifest.files[relative] !== hash) { fs.mkdirSync(path.dirname(path.join(build, relative)), { recursive: true }); fs.writeFileSync(path.join(build, relative), content); updated.push(relative); }
    manifest.files[relative] = hash;
  }
}
for (const relative of ['main', 'renderer', 'resources', 'extension', 'scripts', 'tests', 'package.json', 'package-lock.json', 'electron-builder.yml', 'tsconfig.json', 'nextron.config.js']) sync(relative);
manifest.refreshedAt = new Date().toISOString();
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const result = spawnSync(process.execPath, [npm, 'run', 'build'], { cwd: build, encoding: 'utf8', timeout: 600000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
fs.writeFileSync(path.join(evidence, 'production-build-final.log'), (result.stdout || '') + (result.stderr || ''));
fs.writeFileSync(path.join(evidence, 'build-final-result.json'), JSON.stringify({ exitCode: result.status, updated, removed, error: result.error?.message }, null, 2));
console.log(JSON.stringify({ exitCode: result.status, updated, removed }));
if (result.status !== 0) process.exitCode = 1;
