const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'docs/audit-evidence/2026-10-15');
const manifestPath = path.join(evidence, 'build-workspace.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const build = path.resolve(manifest.path);
if (path.dirname(build) !== 'D:\\DEAN\\DEAN\\VANHSUB\\temp' || !/^codex-audit-build-[a-f0-9]+$/.test(path.basename(build))) throw new Error('Unexpected audit build destination');
const hashes = {};
function copyTree(relative) {
  const source = path.join(root, relative);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${relative}`);
  if (stat.isDirectory()) {
    if (['node_modules', '.next', 'out', '.git'].includes(path.basename(relative))) return;
    for (const name of fs.readdirSync(source)) copyTree(path.join(relative, name));
  } else if (!relative.endsWith('.tsbuildinfo')) {
    const buffer = fs.readFileSync(source);
    fs.mkdirSync(path.dirname(path.join(build, relative)), { recursive: true });
    fs.writeFileSync(path.join(build, relative), buffer);
    hashes[relative] = crypto.createHash('sha256').update(buffer).digest('hex');
  }
}
for (const directory of ['main', 'renderer']) copyTree(directory);
for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'nextron.config.js', 'electron-builder.yml']) copyTree(file);
manifest.files = hashes; manifest.updatedAt = new Date().toISOString();
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const result = spawnSync(process.execPath, [path.join(build, 'node_modules/nextron/bin/webpack.config.cjs')], { cwd: build, encoding: 'utf8', timeout: 120000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
const log = (result.stdout || '') + (result.stderr || '');
fs.writeFileSync(path.join(evidence, 'build-same-drive-main.log'), log);
const ok = result.status === 0 && !/ERROR in|compiled with \d+ errors|TypeScriptLoader failed/.test(log);
console.log(JSON.stringify({ copiedFiles: Object.keys(hashes).length, build, mainBundle: ok ? 'PASS' : 'FAIL', exitCode: result.status }));
if (!ok) process.exitCode = 1;
