const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '..');
const evidence = path.resolve(process.env.VANHSUB_AUDIT_EVIDENCE_DIR || path.join(source, 'docs/integration-evidence/2026-10-15'));
fs.mkdirSync(evidence, { recursive: true });
const target = path.join('D:/DEAN/DEAN/VANHSUB/temp', `codex-${process.env.VANHSUB_RC_BUILD === '1' ? 'rc' : 'integration'}-build-${crypto.randomUUID().replaceAll('-', '')}`);
if (path.dirname(path.resolve(target)) !== path.resolve('D:/DEAN/DEAN/VANHSUB/temp')) throw new Error('Unsafe build destination');
fs.mkdirSync(target);
const hashes = {};
function copy(relative) {
  const original = path.join(source, relative);
  const stat = fs.lstatSync(original);
  if (stat.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${relative}`);
  if (stat.isDirectory()) {
    if (relative === path.join('main', 'native', 'build')) return;
    if (['.next', 'node_modules', '.git', 'out'].includes(path.basename(relative))) return;
    for (const name of fs.readdirSync(original)) copy(path.join(relative, name));
  } else if (!relative.endsWith('.tsbuildinfo')) {
    const content = fs.readFileSync(original);
    fs.mkdirSync(path.dirname(path.join(target, relative)), { recursive: true });
    fs.writeFileSync(path.join(target, relative), content);
    hashes[relative] = crypto.createHash('sha256').update(content).digest('hex');
  }
}
for (const item of ['main', 'renderer', 'resources', 'extension', 'tests', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json', 'nextron.config.js', 'electron-builder.yml']) copy(item);
fs.writeFileSync(path.join(evidence, 'build-workspace.json'), JSON.stringify({ path: target, source, files: hashes, dependencies: 'own npm ci; no junction', startedAt: new Date().toISOString() }, null, 2));
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const results = [];
for (const [name, args, timeout] of [
  ['clean-install', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], 300000],
  ['production-build', ['run', 'build'], 600000],
]) {
  console.log(`Starting ${name} in owned build workspace`);
  const result = spawnSync(process.execPath, [npm, ...args], { cwd: target, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  fs.writeFileSync(path.join(evidence, `${name}.log`), (result.stdout || '') + (result.stderr || ''));
  results.push({ phase: name, exitCode: result.status, error: result.error?.message });
  fs.writeFileSync(path.join(evidence, 'build-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.at(-1)));
  if (result.status !== 0) { process.exitCode = 1; break; }
}
