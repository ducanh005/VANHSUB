const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const evidence = path.resolve(__dirname, '../docs/audit-evidence/2026-10-15');
const manifestPath = path.join(evidence, 'build-workspace.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const build = path.resolve(manifest.path);
if (path.dirname(build) !== 'D:\\DEAN\\DEAN\\VANHSUB\\temp' || !/^codex-audit-build-[a-f0-9]+$/.test(path.basename(build))) throw new Error('Unexpected source snapshot');
const target = path.join(path.dirname(build), `codex-audit-package-${crypto.randomUUID().replaceAll('-', '')}`);
fs.mkdirSync(target);
for (const name of ['app', 'main', 'resources', 'package.json', 'package-lock.json', 'electron-builder.yml']) fs.cpSync(path.join(build, name), path.join(target, name), { recursive: true });
manifest.packagingPath = target;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Isolated clean packaging workspace: ${target}`);
const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const install = spawnSync(process.execPath, [npmCli, 'ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], { cwd: target, encoding: 'utf8', timeout: 300000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
fs.writeFileSync(path.join(evidence, 'package-clean-install.log'), (install.stdout || '') + (install.stderr || ''));
if (install.status !== 0) { console.log('Clean dependency install failed', install.status, install.error?.message); process.exit(1); }
// The lockfile install deliberately skips lifecycle scripts. Reuse the already compiled
// native whisper binary only inside this owned package workspace.
const nativeSource = path.join(build, 'node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/Release');
fs.cpSync(nativeSource, path.join(target, 'node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/Release'), { recursive: true });
const builder = path.join(build, 'node_modules/electron-builder/out/cli/cli.js');
const electronVersion = require(path.join(build, 'node_modules/electron/package.json')).version;
const packed = spawnSync(process.execPath, [builder, '--dir', '--win', '--config.npmRebuild=false', `--config.electronVersion=${electronVersion}`], { cwd: target, encoding: 'utf8', timeout: 300000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
fs.writeFileSync(path.join(evidence, 'package-clean-build.log'), (packed.stdout || '') + (packed.stderr || ''));
const result = { target, installExitCode: install.status, packageExitCode: packed.status, error: packed.error?.message };
fs.writeFileSync(path.join(evidence, 'package-clean-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (packed.status !== 0) process.exitCode = 1;
