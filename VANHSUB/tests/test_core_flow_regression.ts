import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createTimeWindowIndex } from '../main/lib/timeWindowIndex';

/** Core integration fixtures use real FFmpeg, isolated stores and stub synthesis. No network/key required. */
export async function runCoreFlowRegression() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-core-regression-'));
  process.env.VANHSUB_SETTINGS_DIR = path.join(root, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(root, 'tasks');
  const { SettingsStore } = await import('../main/store/settingsStore');
  const { TaskStore, flushTaskStore } = await import('../main/store/taskStore');
  const { getOrCreateProjectDir } = await import('../main/utils/projectFolder');
  const { finalizeDownload } = await import('../main/helpers/videoDownloader');
  const { EdgeTTSClient } = await import('../main/tts-providers/edge/EdgeTTSClient');
  const { generateTtsFromSrt, regenerateTtsLine } = await import('../main/render/ttsEngine');
  const { mergeAudioFiles, runFfmpeg, computeVideoStretchFactor } = await import('../main/render/dubbingEngine');
  const { getFfmpegBinPath } = await import('../main/asr/audioExtractor');
  const { TTSRunner } = await import('../main/render/ttsRunner');
  const { ExportRunner } = await import('../main/render/exportRunner');
  const { TranslateRunner } = await import('../main/translate/translateRunner');
  const { createTtsRunDirectory } = await import('../main/render/ttsCache');
  const { separateVocalsFastFfmpeg } = await import('../main/audio/vocalSeparation');
  const { DubbingRunner } = await import('../main/render/dubbingRunner');
  const { saveCheckpoint, loadCheckpoint } = await import('../main/translate/translator');
  const { parseSrt } = await import('../main/lib/srt');
  const { mergeChunkTranscripts } = await import('../main/asr/whisperEngine');
  const { writeTaskSrt, getTaskSrtPath, hashFile, invalidateTaskConfiguration, isTranslationCurrent } =
    await import('../main/lib/taskArtifacts');
  const { translationConfigHash } = await import('../main/lib/translationConfig');
  const { runCorePipeline, PipelineRunner } = await import('../main/core/pipelineRunner');
  const { runTaskStage, isTaskBusy, cancelTaskRun } = await import('../main/lib/taskExecution');
  const edge = EdgeTTSClient.getInstance(),
    originalSynthesize = edge.synthesize;
  const originalTTS = TTSRunner.runTTS;
  const pcmHash = (file: string) =>
    createHash('sha256')
      .update(
        execFileSync(
          getFfmpegBinPath(),
          ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'],
          { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
        )
      )
      .digest('hex');
  const manifest = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  let passed = 0;
  const test = async (name: string, fn: () => unknown | Promise<unknown>) => {
    await fn();
    passed++;
    console.log(`PASS ${passed}: ${name}`);
  };
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  try {
    SettingsStore.set('exportDir', root);
    const srt = path.join(root, 'clauses.srt');
    const sourceText =
      '1\n00:00:00,000 --> 00:00:01,000\nFirst clause\n\n2\n00:00:01,000 --> 00:00:02,000\nSecond clause.\n';
    fs.writeFileSync(srt, sourceText);
    const tone440 = path.join(root, '440.mp3'),
      tone880 = path.join(root, '880.mp3');
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', tone440]);
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.7', tone880]);
    let tone = fs.readFileSync(tone440);
    edge.synthesize = async () => ({ audio: tone });
    await test('Independent videos with the same name receive separate project folders', () => {
      const a = getOrCreateProjectDir({ id: 'a', fileName: 'clip.mp4', filePath: path.join(root, 'a', 'clip.mp4') });
      const b = getOrCreateProjectDir({ id: 'b', fileName: 'clip.mp4', filePath: path.join(root, 'b', 'clip.mp4') });
      assert.notEqual(a, b);
      assert.equal(
        getOrCreateProjectDir({ id: 'a', fileName: 'clip.mp4', filePath: path.join(root, 'a', 'clip.mp4') }),
        a
      );
    });
    await test('Legacy shared project directory is not claimed by both tasks', () => {
      const shared = path.join(root, 'legacy');
      fs.mkdirSync(shared);
      const a = TaskStore.create({ fileName: 'clip.mp4', filePath: path.join(root, 'a.mp4'), projectDir: shared });
      const b = TaskStore.create({ fileName: 'clip.mp4', filePath: path.join(root, 'b.mp4'), projectDir: shared });
      assert.notEqual(getOrCreateProjectDir(a), getOrCreateProjectDir(b));
    });
    await test('Repeated downloads preserve existing files and each completed download', () => {
      const old = path.join(root, 'clip.mp4');
      fs.writeFileSync(old, 'existing');
      const one = path.join(root, 'download-one.mp4'),
        two = path.join(root, 'download-two.mp4');
      fs.writeFileSync(one, 'one');
      fs.writeFileSync(two, 'two');
      const a = finalizeDownload(one, 'clip', root),
        b = finalizeDownload(two, 'clip', root);
      assert.notEqual(a.filePath, b.filePath);
      assert.equal(fs.readFileSync(old, 'utf8'), 'existing');
      assert.equal(fs.readFileSync(a.filePath, 'utf8'), 'one');
      assert.equal(fs.readFileSync(b.filePath, 'utf8'), 'two');
    });
    await test('Chunk overlap retains different speech and extends a true duplicate', () => {
      const first = { id: '1', startMs: 598000, endMs: 602000, text: 'First phrase.', speaker: 'SPEAKER_00' };
      const second = { id: '2', startMs: 3000, endMs: 6000, text: 'Different phrase.', speaker: 'SPEAKER_01' };
      const merged = mergeChunkTranscripts(
        [
          { offsetMs: 0, lines: [first] },
          { offsetMs: 598000, lines: [second] },
        ],
        2000
      );
      assert.equal(merged.length, 2);
      assert.equal(merged[1].endMs, 604000);
      assert.equal(merged[1].speaker, 'SPEAKER_01');
      const duplicate = mergeChunkTranscripts(
        [
          { offsetMs: 0, lines: [first] },
          { offsetMs: 598000, lines: [{ ...second, text: first.text, speaker: first.speaker }] },
        ],
        2000
      );
      assert.equal(duplicate.length, 1);
      assert.equal(duplicate[0].endMs, 604000);
      const speakers = mergeChunkTranscripts(
        [
          { offsetMs: 0, lines: [first] },
          { offsetMs: 598000, lines: [{ ...second, text: first.text }] },
        ],
        2000
      );
      assert.equal(speakers.length, 2);
    });
    const dir = path.join(root, 'tts');
    await generateTtsFromSrt(srt, dir, { engine: 'edge', voice: 'vi-VN-HoaiMyNeural', speed: 1 });
    await test('A sentence group stores one audio file instead of duplicated member files', () => {
      assert.equal(fs.readdirSync(dir).filter((file) => file.endsWith('.mp3')).length, 1);
      assert.equal(manifest(dir)['1'].audioFile, manifest(dir)['2'].audioFile);
    });
    const before = path.join(root, 'before.mp3');
    await mergeAudioFiles(srt, dir, before);
    await test('Regenerating a member changes the actual merged audio and preserves grouping', async () => {
      tone = fs.readFileSync(tone880);
      await regenerateTtsLine(srt, dir, 2, 'vi-VN-HoaiMyNeural', 1, 'edge');
      const after = path.join(root, 'after-member.mp3');
      await mergeAudioFiles(srt, dir, after);
      assert.notEqual(pcmHash(before), pcmHash(after));
      assert.equal(manifest(dir)['1'].isGroupLeader, true);
      assert.equal(manifest(dir)['2'].leaderIndex, 1);
    });
    await test('Regenerating a leader does not orphan or omit member speech', async () => {
      tone = fs.readFileSync(tone440);
      await regenerateTtsLine(srt, dir, 1, 'vi-VN-HoaiMyNeural', 1, 'edge');
      assert.deepEqual(manifest(dir)['1'].groupIndices, [1, 2]);
      assert.equal(manifest(dir)['1'].audioFile, manifest(dir)['2'].audioFile);
      const after = path.join(root, 'after-leader.mp3');
      await mergeAudioFiles(srt, dir, after);
      assert.equal(pcmHash(before), pcmHash(after));
    });
    await test('The same timeline cache is reused for MP3 and M4A, while sync modes stay separate', async () => {
      const count = () =>
        fs.readdirSync(dir).filter((file) => file.startsWith('.timeline-') && file.endsWith('.wav')).length;
      const initial = count();
      await mergeAudioFiles(srt, dir, path.join(root, 'again.m4a'));
      assert.equal(count(), initial);
      await mergeAudioFiles(srt, dir, path.join(root, 'flexible.mp3'), undefined, { mode: 'flexible' });
      assert.equal(count(), initial + 1);
    });
    await test('A new TTS run seeds only referenced masters and preserves history in the old run', () => {
      const oldFiles = fs.readdirSync(dir).filter((file) => file.endsWith('.mp3'));
      const active = [...new Set(Object.values(manifest(dir)).map((entry: any) => entry.audioFile))].sort();
      assert.ok(oldFiles.length > active.length);
      const next = createTtsRunDirectory(path.join(root, 'cache-seed'), dir);
      assert.deepEqual(
        fs
          .readdirSync(next)
          .filter((file) => file.endsWith('.mp3'))
          .sort(),
        active
      );
      assert.deepEqual(manifest(next), manifest(dir));
      assert.deepEqual(
        fs.readdirSync(dir).filter((file) => file.endsWith('.mp3')),
        oldFiles
      );
    });
    await test('Regeneration applies the selected voice and persists it without altering the old manifest', async () => {
      const task = TaskStore.create({
        fileName: 'voice.mp4',
        filePath: path.join(root, 'voice.mp4'),
        srtPath: srt,
        ttsAudioDir: dir,
        ttsEngine: 'edge',
      });
      const previous = fs.readFileSync(path.join(dir, 'manifest.json'));
      const voices: string[] = [];
      edge.synthesize = async (_text, voice) => {
        voices.push(voice!);
        return { audio: tone };
      };
      try {
        assert.equal((await TTSRunner.regenerateLine(task.id, 2, 'vi-VN-NamMinhNeural', 1.2, 'edge')).ok, true);
        const result = TaskStore.getById(task.id)!;
        assert.ok(voices.includes('vi-VN-NamMinhNeural'));
        assert.equal(result.ttsVoiceOverrides?.['2'], 'vi-VN-NamMinhNeural');
        assert.equal(result.ttsEngine, 'edge'); assert.equal(result.ttsSpeed, 1.2);
        assert.equal(manifest(result.ttsAudioDir!)['2'].voice, 'vi-VN-NamMinhNeural');
        assert.deepEqual(fs.readFileSync(path.join(dir, 'manifest.json')), previous);
      } finally {
        edge.synthesize = async () => ({ audio: tone });
      }
    });
    await test('Single-pass DSP produces the same stereo background and voice as the separate filters', async () => {
      const stereo = path.join(root, 'stereo.wav');
      await runFfmpeg([
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=220:duration=1',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-filter_complex',
        '[0:a][1:a]amerge=inputs=2[a]',
        '-map',
        '[a]',
        stereo,
      ]);
      const background = path.join(root, 'reference-bg.wav'),
        vocals = path.join(root, 'reference-voice.wav');
      await runFfmpeg(['-y', '-i', stereo, '-af', 'pan=stereo|c0=c0-c1|c1=c1-c0,volume=1.25', background]);
      await runFfmpeg([
        '-y',
        '-i',
        stereo,
        '-af',
        'pan=mono|c0=0.5*c0+0.5*c1,bandpass=f=1200:width_type=h:w=2000',
        vocals,
      ]);
      const actual = await separateVocalsFastFfmpeg(stereo, path.join(root, 'stems'));
      assert.deepEqual(fs.readFileSync(actual.noVocals), fs.readFileSync(background));
      assert.deepEqual(fs.readFileSync(actual.vocals), fs.readFileSync(vocals));
      const mono = await separateVocalsFastFfmpeg(tone440, path.join(root, 'mono-stems'));
      assert.ok(fs.statSync(mono.noVocals).size > 44);
      assert.ok(fs.statSync(mono.vocals).size > 44);
    });
    await test('Speaker metadata is stripped from synthesis and keeps speakers in separate groups', async () => {
      const speakers = path.join(root, 'speakers.srt');
      fs.writeFileSync(
        speakers,
        sourceText
          .replace('First clause', '[SPEAKER_00]: First\nclause')
          .replace('Second clause.', '[SPEAKER_01]: Second clause.')
      );
      const submitted: string[] = [];
      edge.synthesize = async (text) => {
        submitted.push(text);
        return { audio: tone };
      };
      const speakerDir = path.join(root, 'speaker-tts');
      await generateTtsFromSrt(speakers, speakerDir, { engine: 'edge' });
      assert.equal(submitted.length, 2);
      assert.ok(submitted.every((text) => !text.includes('SPEAKER')));
      await mergeAudioFiles(speakers, speakerDir, path.join(root, 'speaker-audio.mp3'));
      assert.ok((await computeVideoStretchFactor(speakers, speakerDir)) > 1);
      edge.synthesize = async () => ({ audio: tone });
    });
    await test('Cancelling generation preserves the previously published manifest and audio', async () => {
      const previous = fs.readFileSync(path.join(dir, 'manifest.json'));
      let stopped = false;
      edge.synthesize = async () => {
        stopped = true;
        return { audio: tone };
      };
      await assert.rejects(
        generateTtsFromSrt(srt, dir, { engine: 'edge', forceLineIndices: [1], shouldStop: () => stopped }),
        /Đã huỷ/
      );
      assert.deepEqual(fs.readFileSync(path.join(dir, 'manifest.json')), previous);
      edge.synthesize = async () => ({ audio: tone });
    });
    await test('TTS cancellation during MP3 merge stays cancelled and preserves old task audio', async () => {
      const task = TaskStore.create({
        fileName: 'cancel.mp4',
        filePath: path.join(root, 'cancel.mp4'),
        srtPath: srt,
        ttsAudioDir: dir,
      });
      let accepted = false;
      const result = await TTSRunner.runTTS(
        task.id,
        'vi-VN-HoaiMyNeural',
        1,
        () => {
          if (!accepted && TaskStore.getById(task.id)?.stageDescription?.startsWith('Đang ghép file MP3'))
            accepted = TTSRunner.cancel(task.id);
        },
        undefined,
        'edge'
      );
      assert.equal(accepted, true);
      assert.equal(result?.status, 'cancelled');
      assert.equal(result?.ttsAudioDir, dir);
    });
    await test('Failed translation preflight leaves previous translation and audio intact', async () => {
      const previousMerged = path.join(root, 'previous.mp3');
      fs.copyFileSync(tone440, previousMerged);
      const task = TaskStore.create({
        fileName: 'retry.mp4',
        filePath: path.join(root, 'retry.mp4'),
        srtPath: srt,
        translatedSrtPath: srt,
        ttsAudioDir: dir,
        ttsMergedAudioPath: previousMerged,
      });
      const result = await TranslateRunner.runTranslate(task.id);
      assert.equal(result?.status, 'error');
      assert.equal(result?.translatedSrtPath, srt);
      assert.equal(result?.ttsAudioDir, dir);
      assert.ok(fs.existsSync(previousMerged));
      assert.ok(fs.existsSync(dir));
    });
    await test('Saving changed source invalidates downstream results without deleting them', () => {
      const editSrt = path.join(root, 'edit.srt'),
        translated = path.join(root, 'edit.vi.srt');
      fs.writeFileSync(editSrt, sourceText);
      fs.writeFileSync(translated, sourceText);
      const task = TaskStore.create({
        fileName: 'edit.mp4',
        filePath: path.join(root, 'edit.mp4'),
        srtPath: editSrt,
        translatedSrtPath: translated,
        ttsAudioDir: dir,
      });
      writeTaskSrt(editSrt, sourceText);
      assert.equal(TaskStore.getById(task.id)?.ttsStale, undefined);
      writeTaskSrt(editSrt, sourceText.replace('First', 'Edited'));
      const updated = TaskStore.getById(task.id)!;
      assert.equal(updated.translationStale, true);
      assert.equal(updated.ttsStale, true);
      assert.equal(updated.dubbedStale, true);
      assert.equal(getTaskSrtPath(updated), editSrt);
      assert.ok(fs.existsSync(translated));
      assert.ok(fs.existsSync(dir));
    });
    await test('A task lease rejects concurrent work and survives cancellation until cleanup', async () => {
      let finish!: () => void;
      const pending = runTaskStage(
        'lease',
        'tts',
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );
      await assert.rejects(
        runTaskStage('lease', 'export', async () => {}),
        /đang chạy/
      );
      assert.equal(cancelTaskRun('lease'), true);
      assert.equal(isTaskBusy('lease'), true);
      finish();
      await pending;
      assert.equal(isTaskBusy('lease'), false);
    });
    await test('Interval queries match brute-force overlap even with unsorted and nested intervals', () => {
      let seed = 12345;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 2 ** 32;
      };
      const intervals = Array.from({ length: 500 }, (_, id) => {
        const startMs = Math.floor(random() * 100000);
        return { id, startMs, endMs: startMs + Math.floor(random() * 10000) };
      });
      const query = createTimeWindowIndex(intervals);
      for (let i = 0; i < 100; i++) {
        const start = random() * 100000,
          end = start + random() * 20000;
        assert.deepEqual(
          query(start, end),
          intervals.filter((item) => item.endMs >= start && item.startMs <= end)
        );
      }
    });
    await test('Pipeline fails clearly without a required translation key and honors replaceAudio=false', async () => {
      let task: any = {
        id: 'pipeline-probe',
        status: 'done',
        srtPath: srt,
        sourceLanguage: 'en',
        targetLanguage: 'vi',
      };
      const calls: string[] = [];
      const dependencies = {
        getTask: () => ({ ...task }),
        updateTask: (_id: string, patch: any) => (task = { ...task, ...patch }),
        hasKey: () => false,
        targetLanguage: () => 'vi',
        asr: async () => {
          calls.push('asr');
          return task;
        },
        translate: async () => {
          calls.push('translate');
          return task;
        },
        tts: async () => {
          calls.push('tts');
          task.ttsAudioDir = dir;
          return task;
        },
        dub: async (_id: string, replace: boolean) => {
          calls.push(`dub:${replace}`);
          return task;
        },
      };
      await runCorePipeline(task.id, {}, undefined, dependencies);
      assert.equal(task.status, 'error');
      assert.match(task.errorMessage, /Gemini API key/);
      assert.deepEqual(calls, []);
      task = { ...task, status: 'done', sourceLanguage: 'vi', ttsAudioDir: dir };
      await runCorePipeline(task.id, { replaceAudio: false }, undefined, dependencies);
      assert.deepEqual(calls, ['dub:false']);
    });
    await test('Pipeline rejects OCR tasks and keeps two slots reserved until cancelled workers settle', async () => {
      const blocked = TaskStore.create({ fileName: 'ocr.mp4', filePath: 'ocr.mp4', status: 'ocr' });
      assert.equal(PipelineRunner.enqueue(blocked.id), false);
      const pending: (() => void)[] = [],
        started: string[] = [];
      TTSRunner.runTTS = async (id) => {
        started.push(id);
        await new Promise<void>((resolve) => pending.push(resolve));
        return TaskStore.update(id, { ttsAudioDir: dir, status: 'done' });
      };
      const tasks = Array.from({ length: 3 }, (_, i) =>
        TaskStore.create({
          fileName: `batch-${i}.mp4`,
          filePath: path.join(root, `batch-${i}.mp4`),
          srtPath: srt,
          sourceLanguage: 'vi',
          targetLanguage: 'vi',
        })
      );
      for (const task of tasks) assert.equal(PipelineRunner.enqueue(task.id), true);
      await tick();
      assert.equal(started.length, 2);
      for (const task of tasks) PipelineRunner.cancel(task.id);
      await tick();
      assert.equal(started.length, 2);
      assert.equal(PipelineRunner.isReserved(tasks[0].id), true);
      pending.forEach((resolve) => resolve());
      for (let i = 0; i < 5; i++) await tick();
      assert.equal(PipelineRunner.isReserved(tasks[0].id), false);
      assert.equal(TaskStore.getById(tasks[0].id)?.status, 'cancelled');
      TTSRunner.runTTS = originalTTS;
    });
    const originalVideo = path.join(root, 'original.mp4'),
      dubbedVideo = path.join(root, 'dubbed.mp4'),
      silent = path.join(root, 'silent.mp4');
    for (const [file, frequency] of [
      [originalVideo, 220],
      [dubbedVideo, 880],
    ] as const)
      await runFfmpeg([
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=160x90:d=3:r=10',
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${frequency}:duration=3`,
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        '-shortest',
        file,
      ]);
    await test('Export uses dub audio automatically, retains it for re-export, and permits original audio', async () => {
      const task = TaskStore.create({
        fileName: 'original.mp4',
        filePath: originalVideo,
        srtPath: srt,
        dubbedPath: dubbedVideo,
      });
      const one = await ExportRunner.runExport(task.id, 'softsub');
      assert.equal(one?.status, 'done');
      assert.equal(pcmHash(one!.outputPath!), pcmHash(dubbedVideo));
      const two = await ExportRunner.runExport(task.id, 'softsub');
      assert.equal(pcmHash(two!.outputPath!), pcmHash(dubbedVideo));
      const original = await ExportRunner.runExport(task.id, 'softsub', null, undefined, null, {
        videoSource: 'original',
      });
      assert.equal(pcmHash(original!.outputPath!), pcmHash(originalVideo));
      assert.equal(original?.dubbedPath, dubbedVideo);
    });
    await test('Softsub export accepts a video with no audio stream', async () => {
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:d=3:r=10', '-c:v', 'libx264', '-an', silent]);
      const task = TaskStore.create({ fileName: 'silent.mp4', filePath: silent, srtPath: srt });
      const result = await ExportRunner.runExport(task.id, 'softsub');
      assert.equal(result?.status, 'done');
      assert.ok(fs.existsSync(result!.outputPath!));
    });
    await test('The complete SRT → TTS → dub → softsub chain uses fresh audio after regeneration', async () => {
      tone = fs.readFileSync(tone440);
      const task = TaskStore.create({
        fileName: 'chain.mp4',
        filePath: originalVideo,
        srtPath: srt,
        sourceLanguage: 'vi',
        targetLanguage: 'vi',
        ttsEngine: 'edge',
        ttsVoice: 'vi-VN-HoaiMyNeural',
      });
      await runCorePipeline(task.id);
      const first = TaskStore.getById(task.id)!;
      assert.equal(first.status, 'done', first.errorMessage);
      assert.ok(first.dubbedPath);
      assert.ok(first.ttsMergedAudioPath);
      assert.notEqual(pcmHash(first.dubbedPath!), pcmHash(originalVideo));
      const exportOne = await ExportRunner.runExport(task.id, 'softsub');
      assert.equal(exportOne?.status, 'done', exportOne?.errorMessage);
      assert.equal(pcmHash(exportOne!.outputPath!), pcmHash(first.dubbedPath!));
      tone = fs.readFileSync(tone880);
      assert.equal((await TTSRunner.regenerateLine(task.id, 2)).ok, true);
      const changed = TaskStore.getById(task.id)!;
      assert.notEqual(changed.ttsAudioDir, first.ttsAudioDir);
      assert.equal(changed.ttsMergedAudioPath, undefined);
      assert.equal(changed.dubbedStale, true);
      assert.ok(fs.existsSync(first.ttsAudioDir!));
      assert.ok(fs.existsSync(first.dubbedPath!));
      await runCorePipeline(task.id);
      const second = TaskStore.getById(task.id)!;
      assert.equal(second.status, 'done', second.errorMessage);
      assert.notEqual(pcmHash(first.dubbedPath!), pcmHash(second.dubbedPath!));
      const exportTwo = await ExportRunner.runExport(task.id, 'softsub');
      assert.equal(pcmHash(exportTwo!.outputPath!), pcmHash(second.dubbedPath!));
    });
    await test('Stretched dub exports scale caption times and original-source exports retain original times', async () => {
      tone = fs.readFileSync(tone440);
      const single = path.join(root, 'stretch.srt');
      fs.writeFileSync(single, '1\n00:00:00,000 --> 00:00:01,000\nLong spoken sentence.\n');
      const task = TaskStore.create({
        fileName: 'stretch.mp4',
        filePath: originalVideo,
        srtPath: single,
        ttsEngine: 'edge',
        ttsVoice: 'vi-VN-HoaiMyNeural',
      });
      await TTSRunner.runTTS(task.id);
      const dub = await DubbingRunner.runDubbing(task.id, true, undefined, { syncMode: 'video-stretch' });
      assert.equal(dub?.status, 'done', dub?.errorMessage);
      assert.ok(dub!.dubbedStretchFactor! > 1.05);
      const subtitles = (file: string) =>
        parseSrt(
          execFileSync(getFfmpegBinPath(), ['-v', 'error', '-i', file, '-map', '0:s:0', '-f', 'srt', 'pipe:1'], {
            windowsHide: true,
            encoding: 'utf8',
          })
        );
      const scaled = await ExportRunner.runExport(task.id, 'softsub');
      assert.equal(scaled?.status, 'done', scaled?.errorMessage);
      assert.ok(Math.abs(subtitles(scaled!.outputPath!)[0].endMs - Math.round(1000 * dub!.dubbedStretchFactor!)) <= 10);
      const original = await ExportRunner.runExport(task.id, 'softsub', null, undefined, null, {
        videoSource: 'original',
      });
      assert.equal(subtitles(original!.outputPath!)[0].endMs, 1000);
    });
    await test('Cancelling a live FFmpeg child ends processing promptly', async () => {
      const start = Date.now();
      await assert.rejects(
        runFfmpeg(['-re', '-f', 'lavfi', '-i', 'sine=duration=30', '-f', 'null', '-'], {
          shouldStop: () => Date.now() - start > 250,
        }),
        /Đã huỷ/
      );
      assert.ok(Date.now() - start < 5000);
    });
    await test('Export cancellation through the shared token preserves the previous output', async () => {
      const task = TaskStore.create({
        fileName: 'cancel-export.mp4',
        filePath: originalVideo,
        srtPath: srt,
        outputPath: dubbedVideo,
      });
      let accepted = false;
      const result = await ExportRunner.runExport(task.id, 'softsub', null, () => {
        if (!accepted && TaskStore.getById(task.id)?.progress === 20) accepted = cancelTaskRun(task.id);
      });
      assert.equal(accepted, true);
      assert.equal(result?.status, 'cancelled');
      assert.equal(result?.outputPath, dubbedVideo);
      assert.ok(fs.existsSync(dubbedVideo));
    });
    await test('ASR configuration changes trigger fresh upstream work while TTS changes preserve the translation', () => {
      const task = TaskStore.create({
        fileName: 'config.mp4',
        filePath: originalVideo,
        srtPath: srt,
        translatedSrtPath: srt,
      });
      invalidateTaskConfiguration(task, { ttsSpeed: 1.2 });
      assert.equal(TaskStore.getById(task.id)?.translationStale, undefined);
      assert.equal(TaskStore.getById(task.id)?.ttsStale, true);
      invalidateTaskConfiguration(task, { sourceLanguage: 'en' });
      assert.equal(TaskStore.getById(task.id)?.srtStale, true);
      assert.equal(TaskStore.getById(task.id)?.translationStale, true);
    });
    await test('Translation checkpoints stop reusing results after model, glossary or style changes', () => {
      saveCheckpoint(srt, 'vi', { 'line-0': { source: 'Hello friend', target: 'Xin chào bạn' } }, 1);
      assert.equal(loadCheckpoint(srt, 'vi', 1).size, 1);
      const task = TaskStore.create({
        fileName: 'translation-config.mp4',
        filePath: originalVideo,
        srtPath: srt,
        translatedSrtPath: srt,
        targetLanguage: 'vi',
        translationConfigHash: translationConfigHash('vi'),
      });
      assert.equal(isTranslationCurrent(task), true);
      const old = SettingsStore.get('translationStyleGuide');
      SettingsStore.set('translationStyleGuide', 'Use formal speech.');
      assert.equal(loadCheckpoint(srt, 'vi', 1).size, 0);
      assert.equal(isTranslationCurrent(task), false);
      SettingsStore.set('translationStyleGuide', old);
    });
    await test('TaskStore isolates snapshots and persists terminal transitions immediately', () => {
      const task = TaskStore.create({
        fileName: 'store.mp4',
        filePath: 'store.mp4',
        asrEngine: 'whisper-cpp',
        enableDiarization: true,
        speakerCount: 2,
      });
      const copy = TaskStore.getById(task.id)!;
      copy.fileName = 'mutated';
      assert.equal(TaskStore.getById(task.id)?.fileName, 'store.mp4');
      TaskStore.update(task.id, { progress: 42 });
      TaskStore.update(task.id, { status: 'done', progress: 100 });
      const persisted = JSON.parse(
        fs.readFileSync(path.join(process.env.VANHSUB_TASKS_DIR!, 'vanhsub-tasks.json'), 'utf8')
      ).tasks.find((entry: any) => entry.id === task.id);
      assert.equal(persisted.progress, 100);
      assert.equal(persisted.asrEngine, 'whisper-cpp');
      assert.equal(persisted.speakerCount, 2);
    });
    await test('Production build verification returns a failure code for webpack compilation errors', () => {
      const script = `const path = require('node:path'); require('webpack')({mode:'production', entry:path.join(process.argv[1], 'missing.ts'), output:{path:process.argv[1]}}).run((error, stats) => console.log('COMPILER_ERRORS=' + Boolean(error || stats.hasErrors())));`;
      assert.throws(
        () =>
          execFileSync(
            process.execPath,
            ['--require', path.resolve('scripts/webpack-check.cjs'), '-e', script, path.join(root, 'webpack-failure')],
            { windowsHide: true, encoding: 'utf8', stdio: 'pipe' }
          ),
        (error: any) => error.status === 1 && String(error.stdout).includes('COMPILER_ERRORS=true')
      );
    });
    console.log(`CORE FLOW REGRESSION: ${passed}/${passed} passed`);
  } finally {
    edge.synthesize = originalSynthesize;
    TTSRunner.runTTS = originalTTS;
    flushTaskStore();
    assert.ok(
      path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(root).startsWith('vanhsub-core-regression-')
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
}
if (process.argv[1]?.endsWith('test_core_flow_regression.ts'))
  runCoreFlowRegression().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
