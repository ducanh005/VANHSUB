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
  const rc = process.env.VANHSUB_RC_ACCEPTANCE === '1';
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-ui-audit-'));
  const profile = rc ? path.join(profileRoot, 'Hồ sơ nghiệm thu RC') : profileRoot;
  fs.mkdirSync(profile, { recursive: true });
  if (rc) {
    fs.mkdirSync(path.join(profile, 'settings')); fs.mkdirSync(path.join(profile, 'studio'));
    fs.writeFileSync(path.join(profile, 'settings/vanhsub-settings.json'), JSON.stringify({ onboardingCompleted: true, geminiApiKey: 'synthetic-legacy-settings', hfToken: 'enc:v1:headless:' + Buffer.from('synthetic-legacy-hf').toString('base64') }));
    fs.writeFileSync(path.join(profile, 'studio/vanhsub-ai-studio.json'), JSON.stringify({ llm: { apiKey: 'synthetic-legacy-studio' }, flowEngine: { apiKey: 'enc:v1:headless:' + Buffer.from('synthetic-legacy-flow').toString('base64') } }));
  }
  const result = { classification: packaged ? 'WINDOWS_UNPACKED_UI_E2E_LOCAL_OFFLINE' : 'UI_E2E_LOCAL_OFFLINE', generationCount: 0, profile, build, passes: [], errors: [], pageErrors: [], metrics: [] };
  const launch = () => {
    const env = { ...process.env, NODE_ENV: 'production', VANHSUB_AUDIT_USER_DATA_DIR: profile,
      VANHSUB_TASKS_DIR: path.join(profile, 'tasks'), VANHSUB_SETTINGS_DIR: path.join(profile, 'settings'),
      VANHSUB_AI_STUDIO_DIR: path.join(profile, 'studio'), VANHSUB_BIBLE_DIR: path.join(profile, 'bible'),
      VANHSUB_DISABLE_FLOW_BRIDGE: rc ? '0' : '1', VANHSUB_AUDIT_BRIDGE_EPHEMERAL: rc ? '1' : '0' };
    delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
    return _electron.launch({ executablePath: packaged ? path.join(build, 'dist/win-unpacked/VANHSUB.exe') : require('electron'), args: packaged ? [] : [build], ...(rc ? { cwd: profile } : {}), env, timeout: 60000 });
  };
  let app;
  let bridgeToken, bridgeSocket;
  const connectBridge = async (page, auth) => {
    const { WebSocket } = require('ws');
    const status = await page.evaluate(() => window.vanhsub.veo.bridgeStatus());
    const socket = new WebSocket(`ws://127.0.0.1:${status.port}`, { origin: 'chrome-extension://' + 'a'.repeat(32) });
    socket.on('error', () => {});
    const challengeEvent = require('node:events').once(socket, 'message');
    await require('node:events').once(socket, 'open');
    const challenge = JSON.parse(String((await challengeEvent)[0]));
    if (challenge.type !== 'AUTH_CHALLENGE' || challenge.protocol !== 2 || challenge.port !== status.port) throw new Error('Invalid bridge challenge');
    const context = 'chrome-extension://' + 'a'.repeat(32) + '|' + status.port + '|' + challenge.nonce;
    const crypto = require('node:crypto');
    const sha = value => crypto.createHash('sha256').update(value).digest('hex');
    const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest('hex');
    const key = auth.code || auth.token ? sha(auth.code || auth.token) : null;
    socket.on('message', data => {
      const message = JSON.parse(String(data));
      if (message.id) socket.send(JSON.stringify({ id: message.id, result: { tabId: 999, url: 'https://labs.google/fx/vi/tools/flow/project/rc-fixture', projectId: 'rc-fixture' } }));
    });
    const response = require('node:events').once(socket, 'message');
    socket.send(JSON.stringify({ type: auth.type, protocol: 2, version: '1.0.8', ...(key ? { proof: hmac(key, 'client|' + context) } : {}) }));
    const reply = JSON.parse(String((await response)[0]));
    if (reply.type === 'AUTH_OK' && (!key || reply.serverProof !== hmac(key, 'server|' + context + (auth.code ? '|' + sha(reply.token) : '')))) throw new Error('Invalid server proof');
    return { socket, response: reply };
  };
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
    if (rc) {
      const migration = await page.evaluate(async () => ({ setting: await window.vanhsub.settings.get('geminiApiKey'), hf: await window.vanhsub.settings.get('hfToken'), config: await window.vanhsub.aiStudio.getConfig() }));
      const settings = JSON.parse(fs.readFileSync(path.join(profile, 'settings/vanhsub-settings.json')));
      const studio = JSON.parse(fs.readFileSync(path.join(profile, 'studio/vanhsub-ai-studio.json')));
      for (const value of [settings.geminiApiKey, settings.hfToken, studio.llm.apiKey, studio.flowEngine.apiKey]) {
        if (!value?.startsWith('enc:v1:') || value.startsWith('enc:v1:headless:')) throw new Error('Legacy secret was not migrated to platform ciphertext');
      }
      if (migration.setting !== 'synthetic-legacy-settings' || migration.hf !== 'synthetic-legacy-hf' || migration.config.llm.apiKey !== 'synthetic-legacy-studio' || migration.config.flowEngine.apiKey !== 'synthetic-legacy-flow') throw new Error('Migration lost legacy secret value');
      result.passes.push('Actual Windows startup migrated synthetic plaintext/headless settings, Studio LLM and Flow keys without losing values');
      result.electron = await app.evaluate(() => process.versions.electron);
      const extension = path.join(build, 'dist/win-unpacked/resources/extension');
      if (JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'))).version !== '1.0.8') throw new Error('Packaged extension missing/current manifest differs');
      for (const file of ['background.js', 'content.js', 'injected.js', 'pairing.html', 'pairing.js', 'pairing.css']) if (!fs.existsSync(path.join(extension, file))) throw new Error('Packaged extension file missing');
      await app.evaluate(({ shell }) => { shell.openPath = async () => ''; });
      const folder = await page.evaluate(() => window.vanhsub.veo.openExtensionFolder());
      if (!folder.ok || path.resolve(folder.path) !== path.resolve(extension)) throw new Error('Packaged extension path depends on working directory');
      result.passes.push('Packaged extension1.0.8 and popup assets resolve from resources with Unicode working directory');
    }
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
        await page.waitForFunction(() => Array.from(document.querySelectorAll('textarea')).some(node => node.value === 'Synthetic line 0.'), { timeout: 30000 });
        const firstPageMs = Date.now() - opened;
        const editorTextareas = page.locator('textarea:visible');
        if (await editorTextareas.count() > 100) throw new Error('Editor still mounts more than100 rows');
        const firstInput = page.locator('textarea:visible').filter({ hasText: 'Synthetic line 0.' });
        await firstInput.fill('RC first-page edit.');
        await page.getByRole('spinbutton', { name: 'Trang phụ đề' }).fill('10');
        await page.waitForFunction(() => Array.from(document.querySelectorAll('textarea')).some(node => node.value === 'Synthetic line 999.'), { timeout: 30000 });
        await page.locator('textarea:visible').filter({ hasText: 'Synthetic line 999.' }).fill('RC last-page edit.');
        await page.getByRole('button', { name: 'Lưu thay đổi (*)', exact: true }).click();
        await page.getByRole('button', { name: 'Đã lưu (.srt)', exact: true }).waitFor();
        const task = await page.evaluate(id => window.vanhsub.tasks.get(id), created.taskId);
        const saved = fs.readFileSync(task.srtPath, 'utf8');
        if (!saved.includes('RC first-page edit.') || !saved.includes('RC last-page edit.') || !saved.includes('Synthetic line 500.')) throw new Error('Pagination lost edited or off-page subtitle data');
        const videoDuration = await page.evaluate(() => Array.from(document.querySelectorAll('video')).map(node => node.duration).find(value => Number.isFinite(value) && value > 990));
        result.largeProject = { subtitleLines: 1000, firstPageMs, editSaveAcrossPagesMs: Date.now() - opened, mountedTextareas: await editorTextareas.count(), videoDurationSec: videoDuration ?? null };
        await page.screenshot({ path: path.join(evidence, 'runtime-large-editor.png'), fullPage: true });
        result.passes.push('Actual editor loaded 1000 subtitle lines through imported SRT');
        result.passes.push('Paginated editor saved first/last-page edits while preserving off-page subtitles');
      }
      if (rc) {
        const unauthorized = await connectBridge(page, { type: 'HANDSHAKE', version: '1.0.6' });
        if (unauthorized.response.type !== 'AUTH_REQUIRED') throw new Error('Unpaired client accepted');
        unauthorized.socket.terminate();
        await page.getByRole('button', { name: /AI Studio/ }).click();
        await page.getByRole('button', { name: '🌐 Kết Nối Chrome (Khuyên Dùng)', exact: true }).click();
        await page.getByRole('button', { name: 'Tạo mã ghép đôi', exact: true }).click();
        const code = await page.getByRole('textbox', { name: 'Mã ghép đôi Chrome' }).inputValue();
        const paired = await connectBridge(page, { type: 'PAIR', code });
        if (paired.response.type !== 'AUTH_OK') throw new Error('Pairing code rejected');
        bridgeToken = paired.response.token; bridgeSocket = paired.socket;
        const pairingFile = path.join(profile, 'flow-bridge-pairing.json');
        const persistedPairing = fs.readFileSync(pairingFile, 'utf8');
        const device = JSON.parse(persistedPairing);
        if (device.version !== 2 || !device.encryptedKey?.startsWith('enc:v1:') || device.encryptedKey.startsWith('enc:v1:headless:') || persistedPairing.includes(bridgeToken) || persistedPairing.includes(code)) throw new Error('Pairing key is not platform-encrypted');
        await page.getByRole('button', { name: 'Đóng', exact: true }).click();
        result.passes.push('Actual packaged bridge rejects unpaired socket and accepts a one-use code created through UI; peer is a synthetic extension client');
        const denied = await page.evaluate(async root => {
          const checks = [() => window.vanhsub.tasks.readSrt(root + '/settings/vanhsub-settings.json'),
            () => window.vanhsub.tasks.update('synthetic-id', { id: 'changed-id' }),
            () => window.vanhsub.export.start('synthetic-id', 'hardsub', null, null, { formatOptions: { resolution: '4k' } })];
          return Promise.all(checks.map(check => check().then(() => false, error => /IPC_PAYLOAD_INVALID/.test(error.message))));
        }, profile);
        if (denied.some(value => !value)) throw new Error('Invalid critical IPC payload accepted');
        const outside = path.join(profileRoot, 'outside grant.mp4'); fs.copyFileSync(paths.input, outside);
        const media = await app.evaluate(async ({ net }, { known, outside, config }) => {
          const get = async file => (await net.fetch('vanhmedia://local/' + encodeURIComponent(file), { headers: { Range: 'bytes=0-63' } })).status;
          return { known: await get(known), outside: await get(outside), config: await get(config) };
        }, { known: paths.input, outside, config: path.join(profile, 'settings/vanhsub-settings.json') });
        if (media.known !== 206 || media.outside !== 403 || media.config !== 403) throw new Error('Packaged media grants/type boundary failed');
        result.media = media;
        result.passes.push('Actual IPC schemas reject malformed calls; media protocol serves granted range and denies outside/config files');
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
    if (rc && bridgeToken) {
      bridgeSocket?.terminate();
      const reconnected = await connectBridge(restarted, { type: 'HANDSHAKE', token: bridgeToken, version: '1.0.8' });
      bridgeSocket = reconnected.socket;
      if (reconnected.response.type !== 'AUTH_OK') throw new Error('Persisted bridge token failed after app restart');
      await restarted.evaluate(() => window.vanhsub.veo.revokePairing());
      const rejected = await connectBridge(restarted, { type: 'HANDSHAKE', token: bridgeToken });
      if (rejected.response.type !== 'AUTH_REQUIRED') throw new Error('Revoked token still accepted');
      rejected.socket.terminate();
      result.passes.push('Actual bridge token reconnect survives app restart and is rejected after revocation');
    }
    result.passes.push('Close/reopen retained isolated settings');
    result.status = result.pageErrors.length || result.errors.length ? 'FAIL' : 'PASS_WITH_LIMITS';
    if (result.status === 'FAIL') process.exitCode = 1;
  } catch (error) {
    result.status = 'FAIL'; result.errors.push(error.stack || String(error)); process.exitCode = 1;
    if (app) { const windows = app.windows(); if (windows[0]) await windows[0].screenshot({ path: path.join(evidence, 'runtime-failure.png') }).catch(() => {}); }
  } finally {
    bridgeSocket?.terminate();
    if (app) await app.close().catch(() => {});
    result.elapsedMs = Date.now() - start;
    fs.writeFileSync(path.join(evidence, `${evidenceName}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ status: result.status, passes: result.passes, errors: result.errors, pageErrors: result.pageErrors, startupMs: result.startupMs, elapsedMs: result.elapsedMs }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
