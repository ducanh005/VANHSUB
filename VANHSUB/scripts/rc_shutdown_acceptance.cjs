const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright-core');

async function main() {
  const evidence = path.resolve('docs/rc-evidence/2026-10-15');
  fs.mkdirSync(evidence, { recursive: true });
  const build = JSON.parse(fs.readFileSync(process.env.VANHSUB_RC_BUILD_MANIFEST || 'docs/integration-evidence/2026-10-15/build-workspace.json')).path;
  if (!/^codex-(?:integration|rc)-build-[a-f0-9]+$/.test(path.basename(build))) throw new Error('Expected owned audit build');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-rc-'));
  const profile = path.join(root, 'Hồ sơ RC kiểm thử');
  fs.mkdirSync(profile);
  const input = path.join(profile, 'Video mẫu có dấu.mp4');
  const subtitle = path.join(profile, 'Phụ đề đầu vào.srt');
  const previous = path.join(profile, 'Bản xuất đã xong.mp4');
  const binary = path.join(build, 'dist/win-unpacked/resources/app.asar.unpacked/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
  execFileSync(binary, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=30:d=300', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', input], { windowsHide: true });
  execFileSync(binary, ['-v', 'error', '-i', input, '-t', '1', '-c', 'copy', previous], { windowsHide: true });
  fs.writeFileSync(subtitle, '1\n00:00:00,000 --> 00:00:01,000\nKiểm thử đóng ứng dụng.\n');
  const previousHash = require('node:crypto').createHash('sha256').update(fs.readFileSync(previous)).digest('hex');
  const env = { ...process.env, NODE_ENV: 'production', VANHSUB_AUDIT_USER_DATA_DIR: profile,
    VANHSUB_TASKS_DIR: path.join(profile, 'tasks'), VANHSUB_SETTINGS_DIR: path.join(profile, 'settings'),
    VANHSUB_AI_STUDIO_DIR: path.join(profile, 'studio'), VANHSUB_BIBLE_DIR: path.join(profile, 'bible'), VANHSUB_DISABLE_FLOW_BRIDGE: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  const launch = () => _electron.launch({ executablePath: path.join(build, 'dist/win-unpacked/VANHSUB.exe'), env, timeout: 60000 });
  const query = filter => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `@(Get-CimInstance Win32_Process -Filter '${filter}' | Select-Object ProcessId,ParentProcessId,Name,CreationDate) | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true }).trim() || '[]');
  const asArray = value => Array.isArray(value) ? value : [value];
  let app, observed = [], taskId;
  const result = { classification: 'REAL_PACKAGED_APP_CLOSE_DURING_FFMPEG', profile, build, passes: [], errors: [] };
  try {
    app = await launch();
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.vanhsub?.tasks));
    taskId = await page.evaluate(async ({ input, subtitle, previous, profile }) => {
      await window.vanhsub.settings.set('onboardingCompleted', true);
      const task = await window.vanhsub.tasks.create({ fileName: 'Video mẫu có dấu.mp4', filePath: input, projectDir: profile });
      await window.vanhsub.tasks.update(task.id, { srtPath: subtitle });
      await window.vanhsub.tasks.update(task.id, { outputPath: previous });
      if ((await window.vanhsub.tasks.get(task.id)).outputPath !== previous) throw new Error('Fixture did not establish the completed output pointer');
      await window.vanhsub.export.start(task.id, 'hardsub', null, null, { formatOptions: { resolution: '1080p' } });
      return task.id;
    }, { input, subtitle, previous, profile });
    result.appPid = await app.evaluate(() => process.pid);
    result.launcherPid = app.process().pid;
    const deadline = Date.now() + 20000;
    while (!observed.length && Date.now() < deadline) {
      observed = asArray(query(`ParentProcessId = ${result.appPid}`)).filter(child => /ffmpeg/i.test(child.Name));
      if (!observed.length) await page.waitForTimeout(200);
    }
    if (!observed.length) {
      result.taskBeforeClose = await page.evaluate(id => window.vanhsub.tasks.get(id), taskId);
      throw new Error('No actual FFmpeg child observed; refusing a pre-start cancellation PASS');
    }
    result.observedWorkers = observed;
    result.taskAtClose = await page.evaluate(id => window.vanhsub.tasks.get(id), taskId);
    if (result.taskAtClose.status !== 'exporting') throw new Error('Export already settled before close; no active-job acceptance');
    result.electronMetricsDuringRender = await app.evaluate(({ app }) => app.getAppMetrics().map(item => ({ pid: item.pid, workingSetKiB: item.memory.workingSetSize, cpu: item.cpu.percentCPUUsage })));
    const workerPid = observed[0].ProcessId;
    result.nativeRenderSample = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$taskNative = Get-Process -Id ${workerPid}; $taskCpu = $taskNative.CPU; $taskTime = [DateTime]::UtcNow; Start-Sleep -Milliseconds 500; $taskNative.Refresh(); [pscustomobject]@{pid=${workerPid}; sampleMs=([DateTime]::UtcNow-$taskTime).TotalMilliseconds; workingSetKiB=$taskNative.WorkingSet64/1024; privateKiB=$taskNative.PrivateMemorySize64/1024; handles=$taskNative.HandleCount; cpuPercentOfMachine=(($taskNative.CPU-$taskCpu)/([DateTime]::UtcNow-$taskTime).TotalSeconds/[Environment]::ProcessorCount)*100; logicalProcessors=[Environment]::ProcessorCount} | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true }));
    const closeAt = Date.now();
    if (process.env.VANHSUB_RC_FORCE_CRASH === '1') {
      process.kill(result.appPid, 'SIGKILL');
      const deadline = Date.now() + 10000;
      while (asArray(query(`ProcessId = ${result.appPid}`)).length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      if (asArray(query(`ProcessId = ${result.appPid}`)).length) throw new Error('Actual Electron main did not exit');
    } else {
      const closed = app.waitForEvent('close', { timeout: 20000 });
      await page.evaluate(() => window.close());
      await closed;
    }
    app = null;
    result.closeMs = Date.now() - closeAt;
    await new Promise(resolve => setTimeout(resolve, 1000));
    const alive = observed.filter(child => asArray(query(`ProcessId = ${child.ProcessId}`)).some(current => current.CreationDate === child.CreationDate));
    result.orphanWorkers = alive.map(child => child.ProcessId);
    if (alive.length) throw new Error('FFmpeg survived the requested main-process interruption');
    result.passes.push(process.env.VANHSUB_RC_FORCE_CRASH === '1' ? 'SIGKILL of actual Electron main stopped the observed FFmpeg worker' : 'Ordinary last-window close stopped the actual FFmpeg worker');
    const afterHash = require('node:crypto').createHash('sha256').update(fs.readFileSync(previous)).digest('hex');
    if (afterHash !== previousHash) throw new Error('Completed output changed during close');
    app = await launch();
    const restarted = await app.firstWindow();
    await restarted.waitForFunction(() => Boolean(window.vanhsub?.tasks));
    const recovered = await restarted.evaluate(id => window.vanhsub.tasks.get(id), taskId);
    if (['exporting', 'transcribing', 'dubbing', 'translating', 'ocr'].includes(recovered.status)) throw new Error('Restart retained phantom running state');
    if (recovered.outputPath !== previous) throw new Error('Restart lost completed output pointer');
    result.recoveredStatus = recovered.status;
    result.passes.push('Unicode profile/task/subtitle and completed output survived restart without phantom running state');
    result.status = 'PASS';
  } catch (error) { result.status = 'FAIL'; result.errors.push(error.message); process.exitCode = 1; }
  finally {
    if (app) await app.close().catch(() => {});
    for (const child of observed) {
      const same = asArray(query(`ProcessId = ${child.ProcessId}`)).some(current => current.CreationDate === child.CreationDate);
      if (same) { try { process.kill(child.ProcessId, 'SIGKILL'); } catch {} }
    }
    const name = process.env.VANHSUB_RC_FORCE_CRASH === '1' ? 'hard-crash-render' : process.env.VANHSUB_RC_BASELINE === '1' ? 'shutdown-baseline' : 'shutdown-final';
    result.interruption = process.env.VANHSUB_RC_FORCE_CRASH === '1' ? 'SIGKILL of owned app main process' : 'ordinary last-window close';
    fs.writeFileSync(path.join(evidence, name + '.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  }
}
// An intentionally killed Electron debug transport may retain Playwright driver handles.
// All observed owned app/native PIDs are checked/cleaned above before this harness exits.
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => {
  if (process.env.VANHSUB_RC_FORCE_CRASH === '1') setTimeout(() => process.exit(process.exitCode || 0), 100);
});
