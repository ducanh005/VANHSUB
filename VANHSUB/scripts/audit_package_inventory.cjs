const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');
const evidence = path.resolve(process.env.VANHSUB_AUDIT_EVIDENCE_DIR || path.resolve(__dirname, '../docs/audit-evidence/2026-10-15'));
const manifest = JSON.parse(fs.readFileSync(path.join(evidence, 'build-workspace.json'), 'utf8'));
const build = path.resolve(manifest.packagingPath || manifest.path);
if (path.dirname(build) !== 'D:\\DEAN\\DEAN\\VANHSUB\\temp' || !/^codex-(?:audit-package|integration-build)-[a-f0-9]+$/.test(path.basename(build))) throw new Error('Unexpected package directory');
const resources = path.join(build, 'dist/win-unpacked/resources');
const archive = path.join(resources, 'app.asar');
const files = asar.listPackage(archive);
const modules = {};
for (const name of ['conf', 'electron-store', 'fluent-ffmpeg', '@ffmpeg-installer/win32-x64', '@ffprobe-installer/win32-x64', 'playwright-core', 'uuid']) modules[name] = files.some(file => file.endsWith(path.join('node_modules', name, 'package.json')));
const binaries = [];
for (const [name, relative, args] of [
  ['ffmpeg', 'app.asar.unpacked/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe', ['-version']],
  ['ffprobe', 'app.asar.unpacked/node_modules/@ffprobe-installer/win32-x64/ffprobe.exe', ['-version']],
  ['whisper', 'whisper/whisper-cli.exe', ['--help']],
]) {
  const binary = path.join(resources, relative);
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 15000, windowsHide: true });
  binaries.push({ name, exists: fs.existsSync(binary), exitCode: result.status, error: result.error?.message, firstLine: ((result.stdout || '') + (result.stderr || '')).split(/\r?\n/).find(line => line.trim()) });
}
const result = { build, modules, binaries, asarBytes: fs.statSync(archive).size };
fs.writeFileSync(path.join(evidence, 'package-module-presence-clean.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (Object.values(modules).some(value => !value) || binaries.some(binary => binary.exitCode !== 0)) process.exitCode = 1;
