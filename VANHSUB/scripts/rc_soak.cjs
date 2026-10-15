const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), cp = require('node:child_process');
const { _electron } = require('playwright-core');
async function main() {
  const evidence = path.resolve('docs/rc-evidence/2026-10-15');
  const build = JSON.parse(fs.readFileSync(path.join(evidence, 'build-workspace.json'))).path;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-rc-idle-'));
  const artifact = path.join(profile, 'Bản chạy cố định');
  fs.cpSync(path.join(build, 'dist/win-unpacked'), artifact, { recursive: true });
  fs.mkdirSync(path.join(profile, 'settings'));
  fs.writeFileSync(path.join(profile, 'settings/vanhsub-settings.json'), JSON.stringify({ onboardingCompleted: true }));
  const env = { ...process.env, NODE_ENV: 'production', VANHSUB_AUDIT_USER_DATA_DIR: profile, VANHSUB_DISABLE_FLOW_BRIDGE: '1',
    VANHSUB_TASKS_DIR: path.join(profile, 'tasks'), VANHSUB_SETTINGS_DIR: path.join(profile, 'settings'), VANHSUB_AI_STUDIO_DIR: path.join(profile, 'studio'), VANHSUB_BIBLE_DIR: path.join(profile, 'bible') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  const result = { classification: 'REAL_PACKAGED_IDLE_SOAK_DEVELOPMENT_HOST', generationCount: 0, requestedSeconds: 600, profile, samples: [] };
  const started = Date.now(); let app;
  try {
    app = await _electron.launch({ executablePath: path.join(artifact, 'VANHSUB.exe'), cwd: profile, env, timeout: 60000 });
    const page = await app.firstWindow(); await page.waitForFunction(() => Boolean(window.vanhsub?.tasks));
    const pid = await app.evaluate(() => process.pid);
    const handles = () => JSON.parse(cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-Process -Id ${pid} | Select-Object Id,HandleCount,@{Name='Threads';Expression={$_.Threads.Count}} | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true }));
    result.handlesBefore = handles();
    const from = Date.now();
    for (let sample = 0; sample <= 120; sample++) {
      if (sample) await page.waitForTimeout(5000);
      const value = await app.evaluate(({ app, ipcMain }) => ({ processes: app.getAppMetrics().map(p => ({ pid: p.pid, type: p.type, cpu: p.cpu.percentCPUUsage, workingSetKiB: p.memory.workingSetSize })), ipcEvents: ipcMain.eventNames().length, beforeQuitListeners: app.listenerCount('before-quit'), resources: process.getActiveResourcesInfo() }));
      result.samples.push({ elapsedMs: Date.now() - from, ...value });
      const ram = value.processes.reduce((sum,p) => sum + p.workingSetKiB, 0) / 1024;
      if (ram > 2500) throw new Error('Idle working set exceeded test resource limit2500MiB');
      if (sample % 12 === 0) console.log(JSON.stringify({ elapsedSec: Math.round((Date.now()-from)/1000), totalWorkingSetMiB: +ram.toFixed(2), processes: value.processes.length }));
    }
    result.handlesAfter = handles(); result.measuredMs = Date.now() - from;
    result.status = 'PASS_WITH_LIMITS';
  } catch (error) { result.status = 'FAIL'; result.error = error.message; process.exitCode = 1; }
  finally {
    if (app) await app.close().catch(() => {});
    result.elapsedMs = Date.now() - started;
    fs.writeFileSync(path.join(evidence, 'idle-soak600.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ status: result.status, error: result.error, samples: result.samples.length, measuredMs: result.measuredMs }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
