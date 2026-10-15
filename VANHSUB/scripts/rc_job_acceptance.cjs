const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const cp = require('node:child_process'), { once } = require('node:events'), { _electron } = require('playwright-core');
async function main() {
  const evidence = path.resolve('docs/rc-evidence/2026-10-15');
  const build = JSON.parse(fs.readFileSync(path.join(evidence, 'build-workspace.json'))).path;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-rc-jobs-'));
  const profile = path.join(root, 'Dự án và hồ sơ có dấu'); fs.mkdirSync(profile);
  const localData = path.join(root, 'Local AppData');
  const model = path.join(localData, 'VANHSUB/whisper-models'); fs.mkdirSync(model, { recursive: true });
  fs.copyFileSync(path.resolve('node_modules/nodejs-whisper/cpp/whisper.cpp/models/ggml-tiny.bin'), path.join(model, 'ggml-tiny.bin'));
  const ffmpeg = path.join(build, 'dist/win-unpacked/resources/app.asar.unpacked/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
  const longAudio = path.join(profile, 'Giọng nói dài.wav'), shortAudio = path.join(profile, 'Âm thanh tổng hợp.mp3');
  cp.execFileSync(ffmpeg, ['-v', 'error', '-stream_loop', '-1', '-i', path.resolve('node_modules/nodejs-whisper/cpp/whisper.cpp/bindings/go/samples/jfk.wav'), '-t', '360', '-ar', '16000', '-ac', '1', longAudio], { windowsHide: true });
  cp.execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=0.7', '-c:a', 'libmp3lame', shortAudio], { windowsHide: true });
  const audio = fs.readFileSync(shortAudio), pending = new Set();
  let mode = 'audio-hold', speech = 0, chat = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/v1/voices') { response.setHeader('Content-Type', 'application/json'); response.end('["alloy"]'); return; }
    pending.add(response); response.on('close', () => pending.delete(response));
    let body = ''; request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      if (request.url === '/translation') {
        chat++;
        if (mode === 'chat-reset') { request.socket.destroy(); return; }
        if (mode === 'chat-timeout' || (mode === 'chat-hold-second' && chat === 2)) return;
        const payload = JSON.parse(JSON.parse(body).messages.at(-1).content);
        const items = payload.items.map(item => ({ i: item.i, text: item.text.includes('你好') ? 'Xin chào thế giới.' : 'Đây là câu kiểm thử thứ hai.' }));
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ id: 'synthetic-chat', choices: [{ message: { role: 'assistant', content: JSON.stringify(items) }, finish_reason: 'stop', index: 0 }] }));
      } else {
        speech++;
        if (mode === 'audio-hold') return;
        if (mode === 'audio-reset') { request.socket.destroy(); return; }
        setTimeout(() => { response.setHeader('Content-Type', 'audio/mpeg'); response.end(audio); }, 100);
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, NODE_ENV: 'production', LOCALAPPDATA: localData, VANHSUB_AUDIT_USER_DATA_DIR: profile,
    VANHSUB_TASKS_DIR: path.join(profile, 'tasks'), VANHSUB_SETTINGS_DIR: path.join(profile, 'settings'),
    VANHSUB_AI_STUDIO_DIR: path.join(profile, 'studio'), VANHSUB_BIBLE_DIR: path.join(profile, 'bible'), VANHSUB_DISABLE_FLOW_BRIDGE: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  let app, page;
  const result = { classification: 'REAL_PACKAGED_LOCAL_ASR_AND_SYNTHETIC_HTTP_PROVIDER_FAULTS', generationCount: 0, liveProviderPass: false, profile, passes: [], samples: [] };
  const wait = async (check, label, limit = 45000) => {
    const deadline = Date.now() + limit;
    while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Timeout: ' + label);
  };
  const pass = message => { result.passes.push(message); console.log(message); };
  const launch = async () => {
    app = await _electron.launch({ executablePath: path.join(build, 'dist/win-unpacked/VANHSUB.exe'), cwd: profile, env, timeout: 60000 });
    page = await app.firstWindow(); await page.waitForFunction(() => Boolean(window.vanhsub?.tasks));
    await page.evaluate(async endpoint => {
      await window.vanhsub.settings.set('onboardingCompleted', true);
      await window.vanhsub.settings.set('vietTtsEndpoint', endpoint);
      await window.vanhsub.settings.set('geminiApiKey', 'synthetic-local-transport-key');
      await window.vanhsub.settings.set('geminiModel', 'fixture-local');
      await window.vanhsub.settings.set('translateBatchSize', 1);
      await window.vanhsub.settings.set('translateConcurrency', 1);
      await window.vanhsub.settings.set('autoTranslateAfterAsr', false);
    }, endpoint);
    await app.evaluate((_electron, endpoint) => {
      const original = globalThis.fetch;
      globalThis.fetch = async (input, options) => {
        const request = new Request(input, options);
        if (request.url.startsWith('https://generativelanguage.googleapis.com/')) {
          return original(endpoint + '/translation', { method: request.method, headers: request.headers, body: await request.text(), signal: AbortSignal.any([request.signal, AbortSignal.timeout(globalThis.__rcTimeout || 15000)]) });
        }
        if (!request.url.startsWith(endpoint)) throw new Error('External provider network disabled in RC fixture');
        return original(input, options);
      };
    }, endpoint);
  };
  const close = async () => { const closed = app.waitForEvent('close', { timeout: 20000 }); await page.evaluate(() => window.close()); await closed; app = null; };
  const task = id => page.evaluate(id => window.vanhsub.tasks.get(id), id);
  const create = async (label, text, extras = {}) => {
    const folder = path.join(profile, label); fs.mkdirSync(folder, { recursive: true });
    const subtitle = path.join(folder, 'Phụ đề.srt'); fs.writeFileSync(subtitle, text);
    return page.evaluate(input => window.vanhsub.tasks.create(input), { fileName: label + '.wav', filePath: longAudio, projectDir: folder, srtPath: subtitle, ...extras });
  };
  const voices = id => page.evaluate(id => window.vanhsub.tts.start(id, 'alloy', 1, undefined, 'viettts'), id);
  const metrics = async label => {
    const info = await app.evaluate(({ app, ipcMain }) => ({ pid: process.pid, processes: app.getAppMetrics().map(item => ({ pid: item.pid, type: item.type, workingSetKiB: item.memory.workingSetSize, cpu: item.cpu.percentCPUUsage })), appQuitListeners: app.listenerCount('before-quit'), ipcEvents: ipcMain.eventNames().length, resources: process.getActiveResourcesInfo() }));
    const handles = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-Process -Id ${info.pid} | Select-Object Id,HandleCount,@{Name='Threads';Expression={$_.Threads.Count}} | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true });
    info.kernel = JSON.parse(handles);
    result.samples.push({ label, ...info });
  };
  try {
    await launch();
    const one = '1\n00:00:00,000 --> 00:00:02,000\nXin chào.\n';
    const asr = await create('Phiên âm', one, { asrEngine: 'whisper-cpp', asrModel: 'tiny' });
    const mainPid = await app.evaluate(() => process.pid);
    await page.evaluate(id => window.vanhsub.tasks.start(id), asr.id);
    let native = [];
    await wait(() => {
      const data = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `@(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${mainPid}' | Where-Object Name -eq 'whisper-cli.exe' | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true }).trim();
      native = data ? [].concat(JSON.parse(data)) : []; return native.length > 0;
    }, 'real packaged Whisper child', 30000);
    await close();
    await wait(() => native.every(pid => { try { process.kill(pid, 0); return false; } catch { return true; } }), 'Whisper exited after app close', 5000);
    await launch();
    const recoveredAsr = await task(asr.id);
    if (recoveredAsr.srtPath !== asr.srtPath || recoveredAsr.status === 'transcribing') throw new Error('ASR restart lost last-good SRT or kept phantom running');
    pass('Actual packaged Whisper starts without JS wrapper; close/restart keeps prior SRT and leaves no observed native child');
    const shortSpeech = path.join(profile, 'Public JFK có dấu.wav');
    fs.copyFileSync(path.resolve('node_modules/nodejs-whisper/cpp/whisper.cpp/bindings/go/samples/jfk.wav'), shortSpeech);
    const completedAsr = await create('Phiên âm hoàn tất', one, { filePath: shortSpeech, fileName: 'Public JFK có dấu.wav', asrEngine: 'whisper-cpp', asrModel: 'tiny' });
    await page.evaluate(id => window.vanhsub.tasks.start(id), completedAsr.id);
    await wait(async () => ['done', 'error'].includes((await task(completedAsr.id)).status), 'packaged Whisper completion');
    const recognized = await task(completedAsr.id);
    if (recognized.status !== 'done' || !/country/i.test(fs.readFileSync(recognized.srtPath, 'utf8'))) throw new Error('Actual packaged Whisper did not complete the public speech sample');
    pass('Actual packaged TaskRunner completes public JFK speech inference and saves recognized SRT in Unicode project path');

    const tts = await create('Lồng tiếng', one, { ttsMergedAudioPath: shortAudio });
    await page.evaluate(({ id, audio }) => window.vanhsub.tasks.update(id, { ttsMergedAudioPath: audio }), { id: tts.id, audio: shortAudio });
    if ((await task(tts.id)).ttsMergedAudioPath !== shortAudio) throw new Error('Fixture did not establish completed TTS pointer');
    mode = 'audio-hold'; const beforeTts = speech;
    await voices(tts.id); await wait(() => speech > beforeTts, 'pending local TTS request');
    await close(); await wait(() => pending.size === 0, 'TTS socket disconnect after app close', 5000);
    await launch();
    if ((await task(tts.id)).ttsMergedAudioPath !== shortAudio) throw new Error('TTS close lost completed audio pointer');
    pass('Close during actual pending HTTP TTS request disconnects socket and restart preserves completed audio');
    mode = 'audio-success';
    await metrics('before repeated TTS');
    const concurrent = [await create('Đồng thời A', one), await create('Đồng thời B', one)];
    await Promise.all(concurrent.map(item => voices(item.id)));
    const duplicate = await voices(concurrent[0].id).then(() => false, () => true);
    if (!duplicate) throw new Error('Duplicate active TTS job accepted');
    for (const item of concurrent) await wait(async () => (await task(item.id)).status === 'done', 'concurrent TTS success');
    for (let i = 0; i < 3; i++) { const item = await create('Lặp ' + i, one); await voices(item.id); await wait(async () => (await task(item.id)).status === 'done', 'repeated local TTS'); }
    await metrics('after5 TTS jobs');
    pass('Two distinct TTS tasks complete concurrently, duplicate same-task start is rejected, five synthetic-audio jobs complete');

    const chinese = '1\n00:00:00,000 --> 00:00:01,000\n你好，世界。\n\n2\n00:00:01,200 --> 00:00:02,000\n第二句测试。\n';
    const translated = await create('Dịch phụ đề', chinese);
    mode = 'chat-hold-second';
    await page.evaluate(id => window.vanhsub.translate.start(id, 'vi'), translated.id);
    await wait(() => chat === 2, 'second translation HTTP request after checkpoint');
    const checkpoint = translated.srtPath.replace(/\.srt$/i, '.checkpoint.json');
    if (!fs.existsSync(checkpoint)) throw new Error('Translation first batch checkpoint missing');
    await close(); await wait(() => pending.size === 0, 'translation socket closed', 5000);
    await launch(); mode = 'chat-success'; const beforeResume = chat;
    await page.evaluate(id => window.vanhsub.translate.start(id, 'vi'), translated.id);
    await wait(async () => (await task(translated.id)).status === 'done', 'translation resume');
    if (chat - beforeResume !== 1) throw new Error('Translation resumed duplicate completed batch');
    const good = (await task(translated.id)).translatedSrtPath, bytes = fs.readFileSync(good);
    pass('Close during controlled translation HTTP request; restart reuses completed checkpoint batch and sends only missing batch');
    for (const failure of ['chat-reset', 'chat-timeout']) {
      mode = failure; await app.evaluate(() => { globalThis.__rcTimeout = 500; });
      await page.evaluate(id => window.vanhsub.translate.start(id, 'vi'), translated.id);
      await wait(async () => ['error', 'cancelled'].includes((await task(translated.id)).status), failure, 45000);
      if ((await task(translated.id)).translatedSrtPath !== good || !fs.readFileSync(good).equals(bytes)) throw new Error('HTTP failure damaged completed translation');
      for (const response of pending) response.destroy();
    }
    await metrics('after network faults');
    pass('Actual local socket reset and controlled500ms timeout preserve completed translation; no live-provider success inferred');
    const video = path.join(profile, 'Mẫu xuất có dấu.mp4');
    cp.execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=128x72:r=25:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { windowsHide: true });
    const exported = await create('Xuất có dấu', one, { fileName: 'Mẫu xuất có dấu.mp4', filePath: video });
    await page.evaluate(id => window.vanhsub.export.start(id, 'hardsub', null, null, { formatOptions: { resolution: '480p' } }), exported.id);
    await wait(async () => ['done', 'error'].includes((await task(exported.id)).status), 'Unicode subtitle export');
    const output = await task(exported.id);
    if (output.status !== 'done' || !fs.existsSync(output.outputPath)) throw new Error('Unicode video export failed: ' + output.errorMessage);
    const probe = path.join(build, 'dist/win-unpacked/resources/app.asar.unpacked/node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');
    const duration = Number(cp.execFileSync(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output.outputPath], { encoding: 'utf8', windowsHide: true }).trim());
    if (!(duration >= 1.9 && duration <= 2.2)) throw new Error('Unicode export duration mismatch');
    result.unicodeExportDuration = duration;
    await metrics('after successful export');
    pass('Actual packaged import/task/subtitle export succeeds through Unicode and space paths, FFprobe confirms2s output');
    result.status = 'PASS';
  } catch (error) { result.status = 'FAIL'; result.error = error.message; process.exitCode = 1; }
  finally {
    if (app) await app.close().catch(() => {});
    server.closeAllConnections(); await new Promise(resolve => server.close(() => resolve()));
    result.speechRequests = speech; result.translationRequests = chat;
    fs.writeFileSync(path.join(evidence, 'job-runtime.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ status: result.status, error: result.error, passes: result.passes }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
