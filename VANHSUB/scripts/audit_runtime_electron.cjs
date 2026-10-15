const { _electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

async function main() {
  const evidence = path.resolve(process.env.VANHSUB_AUDIT_EVIDENCE_DIR || 'docs/audit-evidence/2026-10-15');
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
    page.on('console', message => {
      if (message.type() === 'error') {
        const text = message.text();
        if (result.testingCsp && /inline script|script-src|Content Security Policy/i.test(text)) {
          (result.expectedCspBlocks ||= []).push(text.slice(0, 300));
        } else result.errors.push(text.slice(0, 700));
      }
    });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.vanhsub?.tasks?.getAll), { timeout: 30000 });
    const tasks = await page.evaluate(() => window.vanhsub.tasks.getAll());
    if (tasks.length) throw new Error('Isolated profile unexpectedly contains tasks');
    result.passes.push('Production renderer loaded and preload IPC returned isolated empty task store');
    result.startupMs = Date.now() - start;
    if (process.env.VANHSUB_INTEGRATION_RUNTIME === '1') {
      result.testingCsp = true;
      const blocked = await page.evaluate(() => {
        const script = document.createElement('script');
        script.textContent = 'window.__vanhsubCspProbe = true;';
        document.head.appendChild(script); script.remove();
        return window.__vanhsubCspProbe !== true;
      });
      await page.waitForTimeout(100);
      result.testingCsp = false;
      if (!blocked || !result.expectedCspBlocks?.length) throw new Error('Production CSP did not block a foreign inline script');
      result.passes.push('Actual Chromium CSP blocked an injected inline script');
      const foreignDenied = await app.evaluate(async ({ app, BrowserWindow }) => {
        const path = process.getBuiltinModule('path');
        const window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(app.getAppPath(), 'app', 'preload.js'), contextIsolation: true, nodeIntegration: false } });
        try {
          await window.loadURL('about:blank');
          return await window.webContents.executeJavaScript("window.vanhsub.tasks.getAll().then(() => false, error => /IPC_FORBIDDEN/.test(error.message))");
        } finally { window.destroy(); }
      });
      if (!foreignDenied) throw new Error('Foreign BrowserWindow was able to invoke privileged tasks IPC');
      result.passes.push('Actual Electron IPC rejected an untrusted BrowserWindow using the same preload');
      const large = process.env.VANHSUB_AUDIT_LARGE_PROJECT === '1';
      const paths = await app.evaluate(({ app }, large) => {
        const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path');
        const root = app.getPath('userData');
        const subtitle = path.join(root, 'audit-input.srt');
        const time = seconds => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')},000`;
        const text = large ? Array.from({ length: 1000 }, (_, index) => `${index + 1}\n${time(index)} --> ${time(index + 1)}\nSynthetic line ${index}.\n`).join('\n') : '1\n00:00:00,000 --> 00:00:01,000\nAudit narration.\n';
        fs.writeFileSync(subtitle, text);
        return { root, subtitle, input: path.join(root, 'audit-input.mp4') };
      }, large);
      const binary = packaged
        ? path.join(build, 'dist/win-unpacked/resources/app.asar.unpacked/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe')
        : path.join(build, 'node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
      require('node:child_process').execFileSync(binary, ['-v', 'error', '-f', 'lavfi', '-i', `color=blue:s=128x72:r=25:d=${large ? 1000 : 1}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', paths.input], { windowsHide: true });
      const created = await page.evaluate(async (paths) => {
        const task = await window.vanhsub.tasks.create({ fileName: 'audit-input.mp4', filePath: paths.input, fileSize: 'test', status: 'queued' });
        await window.vanhsub.tasks.importSrt(task.id, paths.subtitle);
        const config = await window.vanhsub.aiStudio.getConfig();
        await window.vanhsub.aiStudio.updateConfig({ savedProjects: [{ id: 'integration-ui-project', name: 'Integration UI project', outputDir: paths.root + '/project', channelProfile: config.channelProfile, updatedAt: Date.now() }], activeProjectId: 'integration-ui-project' });
        await window.vanhsub.settings.set('geminiApiKey', 'synthetic-runtime-audit-key');
        return { taskId: task.id, taskCount: (await window.vanhsub.tasks.getAll()).length };
      }, paths);
      if (created.taskCount !== 1) throw new Error('Project/task persistence fixture did not save');
      result.createdTaskId = created.taskId;
      result.passes.push('Renderer IPC created a task, imported strict SRT and saved an AI Studio project');
      const protectedKey = await app.evaluate(({ app }) => {
        const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path');
        const dir = path.join(app.getPath('userData'), 'settings');
        const text = fs.readdirSync(dir).filter(name => name.endsWith('.json')).map(name => fs.readFileSync(path.join(dir, name), 'utf8')).join('');
        return text.includes('enc:v1:') && !text.includes('synthetic-runtime-audit-key') && !text.includes('enc:v1:headless:');
      });
      if (!protectedKey) throw new Error('Packaged runtime did not persist the synthetic key with platform encryption');
      result.passes.push('Actual Windows safeStorage persisted a synthetic secret without plaintext/headless fallback');
      if (large) {
        await page.evaluate(() => window.vanhsub.settings.set('onboardingCompleted', true));
        await page.reload(); await page.waitForLoadState('domcontentloaded');
        const opened = Date.now();
        await page.getByRole('button', { name: 'Hiệu đính phụ đề', exact: true }).click();
        const selection = page.locator('select:visible').filter({ has: page.locator(`option[value="${created.taskId}"]`) });
        await selection.waitFor({ state: 'visible', timeout: 30000 });
        if (await selection.count() !== 1) throw new Error('Cannot uniquely identify subtitle task selector');
        await selection.selectOption(created.taskId);
        await page.waitForFunction(() => Array.from(document.querySelectorAll('textarea')).some(node => node.value === 'Synthetic line 999.'), { timeout: 30000 });
        const videoDuration = await page.evaluate(() => Array.from(document.querySelectorAll('video')).map(node => node.duration).find(value => Number.isFinite(value) && value > 990));
        result.largeProject = { subtitleLines: 1000, editorLoadMs: Date.now() - opened, videoDurationSec: videoDuration ?? null };
        await page.screenshot({ path: path.join(evidence, 'runtime-large-editor.png'), fullPage: true });
        result.passes.push('Actual editor loaded 1000 subtitle lines through imported SRT');
      }
    }
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
    if (result.createdTaskId) {
      const recovered = await restarted.evaluate(async (id) => ({
        task: await window.vanhsub.tasks.get(id),
        project: (await window.vanhsub.aiStudio.getConfig()).savedProjects?.find(project => project.id === 'integration-ui-project')?.name,
        keyRetained: (await window.vanhsub.settings.get('geminiApiKey')) === 'synthetic-runtime-audit-key',
      }), result.createdTaskId);
      if (!recovered.task?.srtPath || recovered.project !== 'Integration UI project' || !recovered.keyRetained) throw new Error('Task/project/encrypted setting did not survive restart');
      result.passes.push('Restart reopened saved task/subtitle/project and decrypted the synthetic setting');
    }
    result.passes.push('Close/reopen retained isolated settings');
    result.status = result.pageErrors.length || result.errors.length ? 'FAIL' : 'PASS_WITH_LIMITS';
    if (result.status === 'FAIL') process.exitCode = 1;
  } catch (error) {
    result.status = 'FAIL'; result.errors.push(error.stack || String(error)); process.exitCode = 1;
    if (app) { const windows = app.windows(); if (windows[0]) await windows[0].screenshot({ path: path.join(evidence, 'runtime-failure.png') }).catch(() => {}); }
  } finally {
    if (app) await app.close().catch(() => {});
    result.elapsedMs = Date.now() - start;
    fs.writeFileSync(path.join(evidence, `${evidenceName}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ status: result.status, passes: result.passes, errors: result.errors, pageErrors: result.pageErrors, startupMs: result.startupMs, elapsedMs: result.elapsedMs }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
