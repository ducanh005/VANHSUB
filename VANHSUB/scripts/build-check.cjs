/** Verify the complete production bundle without packaging or changing the working app.
 * Stage beside the real dependencies: Next's Windows entry paths cannot cross drives.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sourceRoot = path.resolve(__dirname, '..');
const dependencies = fs.realpathSync(path.join(sourceRoot, 'node_modules'));
const stagingParent = path.dirname(dependencies);
const stage = fs.mkdtempSync(path.join(stagingParent, '.vanhsub-build-check-'));
function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: stage,
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
    windowsHide: true,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build failed (${result.status ?? result.signal}).`);
}
try {
  // Explicit source allowlist avoids copying secrets, previous builds or caches.
  for (const name of ['main', 'renderer', 'resources', 'package.json', 'tsconfig.json', 'nextron.config.js']) {
    const source = path.join(sourceRoot, name);
    if (!fs.existsSync(source)) continue;
    fs.cpSync(source, path.join(stage, name), {
      recursive: true,
      filter: (file) =>
        !['node_modules', '.next', '.git'].includes(path.basename(file)) && !path.basename(file).startsWith('.env'),
    });
  }
  fs.symlinkSync(dependencies, path.join(stage, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  run([require.resolve('next/dist/bin/next'), 'build', path.join(stage, 'renderer'), '--webpack']);
  run([
    '--require',
    path.join(__dirname, 'webpack-check.cjs'),
    path.join(dependencies, 'nextron', 'bin', 'webpack.config.cjs'),
  ]);
  for (const file of ['main.js', 'preload.js', 'home/index.html']) {
    if (!fs.existsSync(path.join(stage, 'app', file))) throw new Error(`Missing production artifact: ${file}`);
  }
  console.log('BUILD CHECK PASSED: renderer, main and preload. No installer generated.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  const resolved = fs.realpathSync(stage);
  if (
    path.dirname(resolved).toLowerCase() !== stagingParent.toLowerCase() ||
    !path.basename(resolved).startsWith('.vanhsub-build-check-')
  ) {
    throw new Error(`Refusing to remove unexpected staging directory: ${resolved}`);
  }
  // Unlink the junction explicitly before removing this run's own temporary files.
  const link = path.join(stage, 'node_modules');
  if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
  fs.rmSync(resolved, { recursive: true, force: true });
}
