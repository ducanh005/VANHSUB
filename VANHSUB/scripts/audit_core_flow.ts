/** Reproduce current core-flow defects. These are audit probes, not passing regression tests.
 * Run: node node_modules/tsx/dist/cli.mjs scripts/audit_core_flow.ts
 * Network services are stubbed; timeline assembly and softsub export use real FFmpeg.
 * Stores and all generated media live in a new temporary directory.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-core-audit-'));
  process.env.VANHSUB_SETTINGS_DIR = path.join(root, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(root, 'tasks');
  const { SettingsStore } = await import('../main/store/settingsStore');
  const { TaskStore } = await import('../main/store/taskStore');
  const { getOrCreateProjectDir } = await import('../main/utils/projectFolder');
  const { EdgeTTSClient } = await import('../main/tts-providers/edge/EdgeTTSClient');
  const { generateTtsFromSrt, regenerateTtsLine } = await import('../main/render/ttsEngine');
  const { mergeAudioFiles, runFfmpeg } = await import('../main/render/dubbingEngine');
  const { getFfmpegBinPath } = await import('../main/asr/audioExtractor');
  const { TTSRunner } = await import('../main/render/ttsRunner');
  const { ExportRunner } = await import('../main/render/exportRunner');
  const { mergeChunkTranscripts } = await import('../main/asr/whisperEngine');
  const { TranslateRunner } = await import('../main/translate/translateRunner');
  const findings: Record<string, unknown> = {};
  const hashAudio = (file: string) => createHash('sha256').update(execFileSync(
    getFfmpegBinPath(), ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'],
    { maxBuffer: 16 * 1024 * 1024, windowsHide: true }
  )).digest('hex');
  const edge = EdgeTTSClient.getInstance();
  const originalSynthesize = edge.synthesize;
  try {
    SettingsStore.set('exportDir', root);
    const a = getOrCreateProjectDir({ id: 'a', filePath: path.join(root, 'source-a', 'clip.mp4'), fileName: 'clip.mp4' });
    const b = getOrCreateProjectDir({ id: 'b', filePath: path.join(root, 'source-b', 'clip.mp4'), fileName: 'clip.mp4' });
    assert.equal(a, b);
    findings.projectFolderCollision = { reproduced: true, independentSourcesShareDirectory: true };

    const chunkMerge = mergeChunkTranscripts([
      { offsetMs: 0, lines: [{ id: 'before', startMs: 598000, endMs: 602000, text: 'Previous recognized phrase.' }] },
      { offsetMs: 598000, lines: [{ id: 'new', startMs: 3000, endMs: 6000, text: 'Different new phrase beyond the boundary.' }] },
    ], 2000);
    assert.equal(chunkMerge.length, 1);
    assert.equal(chunkMerge[0].text, 'Previous recognized phrase.');
    findings.chunkBoundaryDropsDifferentText = { reproduced: true, inputSegments: 2, outputSegments: 1, absentTextEndedAfterPreviousChunk: true };

    const srt = path.join(root, 'clauses.srt');
    fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nFirst clause\n\n2\n00:00:01,000 --> 00:00:02,000\nSecond clause.\n');
    const originalTone = path.join(root, 'tone440.mp3');
    const replacementTone = path.join(root, 'tone880.mp3');
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', originalTone]);
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.7', replacementTone]);
    let tone = fs.readFileSync(originalTone);
    edge.synthesize = async () => ({ audio: tone });
    const audioDir = path.join(root, 'grouped-audio');
    await generateTtsFromSrt(srt, audioDir, { voice: 'vi-VN-HoaiMyNeural', engine: 'edge', speed: 1 });
    const before = path.join(root, 'before.mp3');
    const after = path.join(root, 'after-member.mp3');
    await mergeAudioFiles(srt, audioDir, before);
    tone = fs.readFileSync(replacementTone);
    await regenerateTtsLine(srt, audioDir, 2, 'vi-VN-HoaiMyNeural', 1, 'edge');
    assert.equal(fs.readFileSync(path.join(audioDir, 'subtitle_0002.mp3')).equals(tone), true);
    await mergeAudioFiles(srt, audioDir, after);
    assert.equal(hashAudio(before), hashAudio(after));
    findings.regeneratedMemberIgnored = { reproduced: true, replacementFileWritten: true, mergedPcmUnchanged: true };

    await regenerateTtsLine(srt, audioDir, 1, 'vi-VN-HoaiMyNeural', 1, 'edge');
    // Restore grouped metadata, then regenerate only its leader to observe orphaned members.
    tone = fs.readFileSync(originalTone);
    await generateTtsFromSrt(srt, audioDir, { voice: 'vi-VN-HoaiMyNeural', engine: 'edge', speed: 1 });
    tone = fs.readFileSync(replacementTone);
    await regenerateTtsLine(srt, audioDir, 1, 'vi-VN-HoaiMyNeural', 1, 'edge');
    const manifest = JSON.parse(fs.readFileSync(path.join(audioDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest['1'].isGroupLeader, undefined);
    assert.equal(manifest['2'].isGroupMember, true);
    await mergeAudioFiles(srt, audioDir, path.join(root, 'after-leader.mp3'));
    findings.regeneratedLeaderOrphansMember = { reproduced: true, memberStillPointsToUngroupedLeader: true };

    const task = TaskStore.create({ fileName: 'cancel.mp4', filePath: path.join(root, 'cancel.mp4'), srtPath: srt, ttsEngine: 'edge' });
    let cancelledAtMerge = false;
    const cancelledTask = await TTSRunner.runTTS(task.id, 'vi-VN-HoaiMyNeural', 1, () => {
      if (!cancelledAtMerge && TaskStore.getById(task.id)?.stageDescription?.startsWith('Đang ghép file MP3')) {
        cancelledAtMerge = TTSRunner.cancel(task.id);
        TaskStore.update(task.id, { status: 'cancelled' });
      }
    }, undefined, 'edge');
    assert.equal(cancelledAtMerge, true);
    assert.equal(cancelledTask?.status, 'done');
    findings.ttsCancelDuringMergeOverwritten = { reproduced: true, cancellationAccepted: true, finalStatus: cancelledTask?.status };

    const sourceVideo = path.join(root, 'source.mp4');
    const dubbedVideo = path.join(root, 'dubbed.mp4');
    for (const [file, freq] of [[sourceVideo, 220], [dubbedVideo, 880]] as const) {
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:d=3:r=10', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=3`, '-c:v', 'libx264', '-c:a', 'aac', '-shortest', file]);
    }
    const exportTask = TaskStore.create({ fileName: 'source.mp4', filePath: sourceVideo, srtPath: srt, outputPath: dubbedVideo });
    const exported = await ExportRunner.runExport(exportTask.id, 'softsub');
    assert.equal(exported?.status, 'done');
    assert.ok(exported?.outputPath);
    assert.equal(hashAudio(exported.outputPath), hashAudio(sourceVideo));
    assert.notEqual(hashAudio(exported.outputPath), hashAudio(dubbedVideo));
    findings.exportAfterDubbingUsesOriginalAudio = { reproduced: true, exportedPcmMatchesOriginal: true, exportedPcmDiffersFromDubbed: true };

    const silentVideo = path.join(root, 'silent.mp4');
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:d=3:r=10', '-c:v', 'libx264', '-an', silentVideo]);
    const silentTask = TaskStore.create({ fileName: 'silent.mp4', filePath: silentVideo, srtPath: srt });
    const silentExport = await ExportRunner.runExport(silentTask.id, 'softsub');
    assert.equal(silentExport?.status, 'error');
    assert.match(silentExport?.errorMessage || '', /0:a/);
    findings.softsubFailsWithoutAudioStream = { reproduced: true, finalStatus: silentExport?.status, mandatoryAudioMap: true };

    const speakerSrt = path.join(root, 'speakers.srt');
    fs.writeFileSync(speakerSrt, '1\n00:00:00,000 --> 00:00:01,000\n[SPEAKER_00]: Hello\n\n2\n00:00:01,000 --> 00:00:02,000\n[SPEAKER_01]: Goodbye.\n');
    const submittedTexts: string[] = [];
    edge.synthesize = async (text) => { submittedTexts.push(text); return { audio: tone }; };
    await generateTtsFromSrt(speakerSrt, path.join(root, 'speaker-audio'), { engine: 'edge', voice: 'vi-VN-HoaiMyNeural', speed: 1 });
    assert.equal(submittedTexts.length, 1);
    assert.match(submittedTexts[0], /SPEAKER_00.*SPEAKER_01/);
    findings.speakerMetadataReadAsTextAndGrouped = { reproduced: true, synthesizeCalls: 1, submittedTextIncludesBothSpeakerTags: true };

    const previousAudioDir = path.join(root, 'previous-successful-audio');
    fs.mkdirSync(previousAudioDir);
    fs.copyFileSync(originalTone, path.join(previousAudioDir, 'subtitle_0001.mp3'));
    const previousMerged = path.join(root, 'previous-merged.mp3');
    fs.copyFileSync(originalTone, previousMerged);
    const previousTranslation = path.join(root, 'previous-translation.srt');
    fs.copyFileSync(srt, previousTranslation);
    const retryTask = TaskStore.create({ fileName: 'retry.mp4', filePath: sourceVideo, srtPath: srt, translatedSrtPath: previousTranslation, ttsAudioDir: previousAudioDir });
    TaskStore.update(retryTask.id, { ttsMergedAudioPath: previousMerged });
    const retryResult = await TranslateRunner.runTranslate(retryTask.id);
    assert.equal(retryResult?.status, 'error');
    assert.match(retryResult?.errorMessage || '', /Chưa cấu hình Gemini/);
    assert.equal(fs.existsSync(previousAudioDir), false);
    assert.equal(fs.existsSync(previousMerged), false);
    assert.equal(retryResult?.translatedSrtPath, undefined);
    findings.failedTranslationDeletesPreviousAudio = { reproduced: true, noNetworkRequest: true, previousTtsAudioDeletedBeforeKeyValidation: true };

    // Evaluate the actual production pipeline/IPC bodies without Electron bootstrap.
    const mainSource = fs.readFileSync(path.join(process.cwd(), 'main/main.ts'), 'utf8');
    const pipelineSource = mainSource.slice(mainSource.indexOf('const MAX_PARALLEL_PIPELINES'), mainSource.indexOf("ipcMain.handle('tasks:create'"));
    assert.ok(pipelineSource.includes('async function executePipeline'));
    const writeStart = mainSource.indexOf("ipcMain.handle('tasks:writeSrt'");
    const writeSource = mainSource.slice(writeStart, mainSource.indexOf('// Nhập file SRT', writeStart));
    const handlers = new Map<string, Function>();
    let state: any = { id: 'probe', status: 'done', srtPath: srt, translatedSrtPath: path.join(root, 'old-translation.srt'), ttsAudioDir: audioDir, outputPath: dubbedVideo };
    const calls: string[] = [];
    const sandbox: any = {
      fs, console: { log() {}, error() {} }, broadcastTasksUpdate() {},
      ipcMain: { handle: (name: string, fn: Function) => handlers.set(name, fn) },
      TaskStore: { getById: () => ({ ...state }) }, SettingsStore: { hasGeminiKey: () => false },
      TaskRunner: { runTask: async () => { calls.push('asr'); return state; } },
      TranslateRunner: { runTranslate: async () => { calls.push('translate'); return state; } },
      TTSRunner: { runTTS: async () => { calls.push('tts'); state.ttsAudioDir = audioDir; return state; } },
      DubbingRunner: { runDubbing: async (_id: string, replace: boolean) => { calls.push(`dubbing:${replace}`); return state; } },
    };
    vm.createContext(sandbox);
    vm.runInContext(ts.transpileModule(pipelineSource + '\n' + writeSource + '\nglobalThis.audit = { executePipeline, enqueuePipeline };', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
    await handlers.get('tasks:writeSrt')!(null, srt, fs.readFileSync(srt, 'utf8').replace('First clause', 'Edited clause'));
    await sandbox.audit.executePipeline('probe');
    assert.deepEqual(calls, ['dubbing:true']);
    findings.subtitleEditLeavesStaleArtifacts = { reproduced: true, pipelineReusedExistingTranslationAndTts: true, calls: [...calls] };
    state = { id: 'probe', status: 'ocr', srtPath: srt };
    assert.equal(sandbox.audit.enqueuePipeline('probe'), true);
    findings.pipelineCanEnterDuringOcr = { reproduced: true, acceptedWhileStatusOcr: true };
    state = { id: 'probe', status: 'done', srtPath: srt, targetLanguage: 'vi', sourceLanguage: 'en' };
    calls.length = 0;
    await sandbox.audit.executePipeline('probe');
    assert.deepEqual(calls, ['tts', 'dubbing:true']);
    findings.pipelineWithoutTranslationKeyContinues = { reproduced: true, calls: [...calls] };
    console.log('\nAUDIT_FINDINGS=' + JSON.stringify(findings, null, 2));
  } finally {
    edge.synthesize = originalSynthesize;
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('vanhsub-core-audit-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
