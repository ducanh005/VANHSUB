const { _electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

async function main() {
  const evidence = path.resolve('docs/audit-evidence/2026-10-15');
  const manifest = JSON.parse(fs.readFileSync(path.join(evidence, 'build-workspace.json'), 'utf8'));
  const packaged = process.env.VANHSUB_AUDIT_PACKAGED === '1';
  const build = packaged ? manifest.packagingPath || manifest.path : manifest.path;
  const evidenceName = packaged ? 'runtime-packaged' : 'runtime-ui';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-ui-audit-'));
  const result = { classification: packaged ? 'WINDOWS_UNPACKED_UI_E2E_LOCAL_OFFLINE' : 'UI_E2E_LOCAL_OFFLINE', generationCount: 0, profile, build, passes: [], errors: [], pageErrors: [], metrics: [] };
  const launch = () => {
    const env = { ...process.env, NODE_ENV: 'production', VANHSUB_AUDIT_USER_DATA_DIR: profile,
      VANHSUB_TASKS_DIR: path.join(profile, 'tasks'), VANHSUB_SETTINGS_DIR: path.join(profile, 'settings'),
      VANHSUB_AI_STUDIO_DIR: path.join(profile, 'studio'), VANHSUB_BIBLE_DIR: path.join(profile, 'bible'),
      VANHSUB_DISABLE_FLOW_BRIDGE: '1' };
    delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
    return _electron.launch({ executablePath: packaged ? path.join(build, 'dist/win-unpacked/VANHSUB.exe') : require('electron'), args: packaged ? [] : [build], env, timeout: 60000 });
  };
  let app;
  const start = Date.now();
  try {
    app = await launch();
    const page = await app.firstWindow();
    page.on('pageerror', error => result.pageErrors.push(String(error).slice(0, 700)));
    page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text().slice(0, 700)); });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.vanhsub?.tasks?.getAll), { timeout: 30000 });
    const tasks = await page.evaluate(() => window.vanhsub.tasks.getAll());
    if (tasks.length) throw new Error('Isolated profile unexpectedly contains tasks');
    result.passes.push('Production renderer loaded and preload IPC returned isolated empty task store');
    result.startupMs = Date.now() - start;
    await page.evaluate(() => window.vanhsub.settings.set('onboardingCompleted', true));
    await page.reload(); await page.waitForLoadState('domcontentloaded');
    result.buttons = await page.getByRole('button').allTextContents();
    for (const label of ['AI Studio', 'Workflow AI', 'Phụ đề', 'Lồng tiếng', 'Xuất video', 'Cài đặt']) {
      const candidate = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
      if (!(await candidate.count()) || !(await candidate.isVisible())) { result.errors.push(`Navigation label not found: ${label}`); continue; }
      await candidate.click(); await page.waitForTimeout(300);
      result.passes.push(`UI navigation: ${label}`);
    }
    await page.screenshot({ path: path.join(evidence, packaged ? 'runtime-packaged-settings.png' : 'runtime-settings.png'), fullPage: true });
    const soakSeconds = Number(process.env.VANHSUB_AUDIT_SOAK_SECONDS || 5);
    result.soakSeconds = soakSeconds;
    for (let index = 0; index < Math.ceil(soakSeconds / 5); index++) {
      await page.waitForTimeout(5000);
      result.metrics.push(await app.evaluate(({ app }) => app.getAppMetrics().map(item => ({ type: item.type, pid: item.pid, cpu: item.cpu.percentCPUUsage, workingSetKiB: item.memory.workingSetSize }))));
    }
    await app.close(); app = null;
    app = await launch();
    const restarted = await app.firstWindow();
    await restarted.waitForLoadState('domcontentloaded');
    const retained = await restarted.evaluate(() => window.vanhsub.settings.get('onboardingCompleted'));
    if (!retained) throw new Error('Isolated settings did not survive restart');
    result.passes.push('Close/reopen retained isolated settings');
    result.status = result.pageErrors.length || result.errors.length ? 'FAIL' : 'PASS_WITH_LIMITS';
    if (result.status === 'FAIL') process.exitCode = 1;
  } catch (error) {
    result.status = 'FAIL'; result.errors.push(error.stack || String(error)); process.exitCode = 1;
  } finally {
    if (app) await app.close().catch(() => {});
    result.elapsedMs = Date.now() - start;
    fs.writeFileSync(path.join(evidence, `${evidenceName}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ status: result.status, passes: result.passes, errors: result.errors, pageErrors: result.pageErrors, startupMs: result.startupMs, elapsedMs: result.elapsedMs }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
