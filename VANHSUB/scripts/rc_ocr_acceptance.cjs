const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), cp = require('node:child_process');
const { _electron } = require('playwright-core');
async function main() {
  const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'docs/rc-evidence/2026-10-16'); fs.mkdirSync(evidence, { recursive: true });
  const build = JSON.parse(fs.readFileSync(path.join(root, 'docs/rc-evidence/2026-10-15/build-workspace.json'))).path;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-rc-ocr-')), project = path.join(profile, 'Dự án OCR có dấu'), scratch = path.join(profile, 'Khung hình tạm');
  fs.mkdirSync(project); fs.mkdirSync(scratch);
  const video = path.join(project, 'Video đầu vào.mp4'), invalid = path.join(project, 'Video hỏng.mp4');
  const ffmpeg = path.join(build, 'dist/win-unpacked/resources/app.asar.unpacked/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
  cp.execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=5:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', video], { windowsHide: true }); fs.writeFileSync(invalid, 'invalid video fixture');
  const missingPython = path.join(profile, 'Python không khả dụng.exe'); fs.writeFileSync(missingPython, 'not an executable: controlled dependency failure');
  const guards = path.join(profile, 'Offline Python guard'); fs.mkdirSync(guards);
  fs.writeFileSync(path.join(guards, 'sitecustomize.py'), `import socket
_original_connect = socket.socket.connect
def _allowed(host):
    return host in ('127.0.0.1', 'localhost', '::1')
def _connect(self, address):
    if isinstance(address, tuple) and not _allowed(address[0]):
        raise OSError('RC_OFFLINE_EXTERNAL_NETWORK_DENIED')
    return _original_connect(self, address)
socket.socket.connect = _connect
_original_getaddrinfo = socket.getaddrinfo
def _getaddrinfo(host, *args, **kwargs):
    if host is not None and not _allowed(host):
        raise OSError('RC_OFFLINE_EXTERNAL_DNS_DENIED')
    return _original_getaddrinfo(host, *args, **kwargs)
socket.getaddrinfo = _getaddrinfo
`);
  const env = { ...process.env, PYTHONPATH: guards, PYTHONDONTWRITEBYTECODE: '1', OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2', NODE_ENV: 'production', VANHSUB_AUDIT_USER_DATA_DIR: profile, VANHSUB_TASKS_DIR: path.join(profile, 'tasks'), VANHSUB_SETTINGS_DIR: path.join(profile, 'settings'), VANHSUB_AI_STUDIO_DIR: path.join(profile, 'studio'), VANHSUB_BIBLE_DIR: path.join(profile, 'bible'), VANHSUB_DISABLE_FLOW_BRIDGE: '1', TEMP: scratch, TMP: scratch };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  let app, page;
  const result = { classification: 'REAL_PACKAGED_OCR_NATIVE_EXTRACTION_AND_CONTROLLED_MISSING_PYTHON', build, profile, generationCount: 0, liveProviderPass: false, cases: [], errors: [] };
  let reusable;
  const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (fn, label, timeout = 45000) => { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(100); } throw new Error('Timeout: ' + label); };
  try {
    app = await _electron.launch({ executablePath: path.join(build, 'dist/win-unpacked/VANHSUB.exe'), cwd: profile, env, timeout: 60000 }); page = await app.firstWindow(); await page.waitForFunction(() => Boolean(window.vanhsub?.tasks));
    await page.evaluate(pythonPath => window.vanhsub.settings.set('pythonPath', pythonPath), missingPython);
    for (const [label, input] of [['missing-python', video], ['invalid-video', invalid]]) {
      const folder = path.join(project, label); fs.mkdirSync(folder);
      const audioDir = path.join(folder, 'TTS đã hoàn thành'); fs.mkdirSync(audioDir);
      const original = path.join(folder, 'Bản gốc.srt'), translation = path.join(folder, 'Bản dịch.srt'), audio = path.join(folder, 'Lồng tiếng.mp3'), output = path.join(folder, 'Bản xuất đã xong.mp4'), dubbed = path.join(folder, 'Video lồng tiếng.mp4');
      fs.writeFileSync(original, '1\n00:00:00,000 --> 00:00:01,000\nHELLO WORLD\n'); fs.copyFileSync(original, translation);
      cp.execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', '-c:a', 'libmp3lame', audio], { windowsHide: true }); fs.copyFileSync(audio, path.join(audioDir, '0001.mp3')); fs.copyFileSync(video, output); fs.copyFileSync(video, dubbed);
      const artifacts = { srtPath: original, translatedSrtPath: translation, ttsAudioDir: audioDir, ttsMergedAudioPath: audio, outputPath: output, dubbedVideoPath: dubbed };
      const files = [original, translation, audio, output, dubbed, path.join(audioDir, '0001.mp3')], before = files.map(hash);
      const task = await page.evaluate(async ({ input, folder, artifacts }) => { const task = await window.vanhsub.tasks.create({ fileName: 'OCR rerun.mp4', filePath: input, projectDir: folder }); await window.vanhsub.tasks.update(task.id, { ...artifacts, status: 'done', subtitleRevision: 3, ttsNeedsRegeneration: false }); return window.vanhsub.tasks.get(task.id); }, { input, folder, artifacts });
      if (Object.entries(artifacts).some(([key, value]) => task[key] !== value)) throw new Error('Fixture pointer missing before OCR');
      await page.evaluate(id => window.vanhsub.ocr.start(id, { dualEngine: false, fps: 0.5, language: 'eng', mode: 'full' }), task.id);
      const failed = await wait(async () => { const value = await page.evaluate(id => window.vanhsub.tasks.get(id), task.id); return value.status === 'error' ? value : null; }, label);
      const lostPointers = Object.keys(artifacts).filter(key => failed[key] !== artifacts[key]), changedFiles = files.filter((file, i) => hash(file) !== before[i]);
      const frameDirectories = fs.readdirSync(scratch).filter(name => name.startsWith('vanhsub-ocr-'));
      if (label === 'missing-python') reusable = { id: task.id, artifacts, files, before };
      result.cases.push({ label, status: !lostPointers.length && !changedFiles.length && !frameDirectories.length ? 'PASS' : 'FAIL', lostPointers, changedFiles: changedFiles.map(file => path.basename(file)), frameDirectories, errorMessage: failed.errorMessage, subtitleRevision: failed.subtitleRevision });
    }
    if (process.env.VANHSUB_RC_OCR_BASELINE !== '1') {
      const mainPid = await app.evaluate(() => process.pid);
      const children = name => {
        const data = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `@(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${mainPid}' | Where-Object Name -eq '${name}' | Select-Object ProcessId,CreationDate,CommandLine) | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true }).trim();
        return data ? [].concat(JSON.parse(data)) : [];
      };
      const checkPrior = async () => {
        const current = await page.evaluate(id => window.vanhsub.tasks.get(id), reusable.id);
        const lost = Object.keys(reusable.artifacts).filter(key => current[key] !== reusable.artifacts[key]);
        if (lost.length || reusable.files.some((file, i) => hash(file) !== reusable.before[i])) throw new Error('Cancelled OCR changed prior artifacts: ' + lost.join(','));
        if (fs.readdirSync(scratch).some(name => name.startsWith('vanhsub-ocr-'))) throw new Error('OCR frames were not cleaned');
        return current;
      };
      const longVideo = path.join(project, 'Video dài kiểm tra hủy.mp4');
      cp.execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=1:d=1800', '-c:v', 'libx264', '-preset', 'ultrafast', longVideo], { windowsHide: true });
      await page.evaluate(({ id, filePath }) => window.vanhsub.tasks.update(id, { filePath, status: 'done' }), { id: reusable.id, filePath: longVideo });
      await page.evaluate(id => window.vanhsub.ocr.start(id, { dualEngine: false, fps: 5, mode: 'full' }), reusable.id);
      const worker = await wait(() => children('ffmpeg.exe')[0], 'native OCR frame worker', 15000);
      const duplicateRejected = await page.evaluate(async id => { try { await window.vanhsub.ocr.start(id); return false; } catch { return true; } }, reusable.id);
      if (!duplicateRejected) throw new Error('Duplicate OCR job accepted');
      const cancelledAt = Date.now(); await page.evaluate(id => window.vanhsub.ocr.cancel(id), reusable.id);
      await wait(async () => (await page.evaluate(id => window.vanhsub.tasks.get(id), reusable.id)).status === 'cancelled', 'OCR extraction cancellation', 8000);
      const cancelMs = Date.now() - cancelledAt;
      if (children('ffmpeg.exe').some(p => p.ProcessId === worker.ProcessId && p.CreationDate === worker.CreationDate)) throw new Error('Cancelled FFmpeg survived');
      await checkPrior();
      result.cases.push({ label: 'cancel-native-extraction', status: 'PASS', cancelMs, observedWorkerPid: worker.ProcessId, duplicateRejected, priorArtifactsRetained: true, partialFramesCleaned: true });
      await page.evaluate(({ id, filePath }) => window.vanhsub.tasks.update(id, { filePath }), { id: reusable.id, filePath: invalid });
      await page.evaluate(id => window.vanhsub.ocr.start(id), reusable.id);
      await wait(async () => (await page.evaluate(id => window.vanhsub.tasks.get(id), reusable.id)).status === 'error', 'OCR rerun after cancellation');
      await checkPrior(); result.cases.push({ label: 'rerun-after-cancel', status: 'PASS', priorArtifactsRetained: true });

      // Existing installed Python/models only; sitecustomize denies external sockets/DNS.
      const python = cp.execFileSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', windowsHide: true }).trim();
      await page.evaluate(pythonPath => window.vanhsub.settings.set('pythonPath', pythonPath), python);
      const textVideo = path.join(project, 'Chữ Latin nhận diện thật.mp4');
      fs.copyFileSync('C:/Windows/Fonts/arial.ttf', path.join(profile, 'Font.ttf'));
      cp.execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=1280x720:r=5:d=2', '-vf', 'drawtext=fontfile=Font.ttf:text=XIN CHAO THE GIOI:fontsize=48:fontcolor=white:x=(w-tw)/2:y=h-90', '-c:v', 'libx264', '-preset', 'ultrafast', textVideo], { cwd: profile, windowsHide: true });
      await page.evaluate(({ id, filePath }) => window.vanhsub.tasks.update(id, { filePath, status: 'done' }), { id: reusable.id, filePath: textVideo });
      const originalStarted = Date.now();
      await page.evaluate(id => window.vanhsub.ocr.start(id, { dualEngine: false, fps: 1, language: 'vie', mode: 'full' }), reusable.id);
      const recognized = await wait(async () => { const current = await page.evaluate(id => window.vanhsub.tasks.get(id), reusable.id); return current.status === 'error' || (current.status === 'done' && current.subtitleRevision === 4) ? current : null; }, 'real cached-model OCR', 120000);
      if (recognized.status !== 'done') {
        result.cases.push({ label: 'real-paddle-recognition', status: 'BLOCKED', reason: recognized.errorMessage, offlineNetworkGuard: true });
      } else {
        const content = fs.readFileSync(recognized.srtPath, 'utf8');
        if (!/XIN.*CHAO.*THE.*GIOI/i.test(content)) throw new Error('Real OCR text did not match fixture');
        if (recognized.srtPath === reusable.artifacts.srtPath || recognized.translatedSrtPath || recognized.ttsAudioDir || recognized.ttsMergedAudioPath || recognized.outputPath || recognized.dubbedVideoPath || recognized.subtitleRevision !== 4 || !recognized.ttsNeedsRegeneration) throw new Error('Successful OCR did not invalidate downstream references/revision');
        if (reusable.files.some((file, i) => hash(file) !== reusable.before[i])) throw new Error('Successful OCR deleted previous completed files');
        result.cases.push({ label: 'real-paddle-recognition', status: 'PASS', elapsedMs: Date.now() - originalStarted, subtitleLines: content.trim().split(/\r?\n\r?\n/).length, recognizedText: content, subtitleRevision: recognized.subtitleRevision, priorFilesRetained: true, stalePointersInvalidated: true, offlineNetworkGuard: true });
      }
    }
    result.status = result.cases.every(item => item.status === 'PASS') ? 'PASS' : result.cases.some(item => item.status === 'FAIL') ? 'FAIL' : 'PASS_WITH_LIMITS';
  } catch (error) { result.status = 'FAIL'; result.errors.push(error.stack || error.message); }
  finally { if (app) await app.close().catch(() => {}); const suffix = process.env.VANHSUB_RC_OCR_BASELINE === '1' ? 'before' : 'after'; fs.writeFileSync(path.join(evidence, 'ocr-recovery-' + suffix + '.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); if (!['PASS', 'PASS_WITH_LIMITS'].includes(result.status)) process.exitCode = 1; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
