/**
 * Test Suite: Milestone 4 Challenger 2 - Backward Compatibility & Store Verification
 *
 * Scope & Verifications:
 * 1. TaskStore backward compatibility:
 *    - Direct JSON disk hydration from pre-R1 schema file (missing asrEngine, enableDiarization, speakers, ttsOverruns, ocrStats, etc.).
 *    - Field access safety and safe fallback expressions.
 *    - Retrieval (getAll, getById), updating with R1 fields, resetStaleRunning(), creating new tasks, deletion.
 * 2. SettingsStore backward compatibility:
 *    - Direct JSON disk hydration from legacy settings file.
 *    - Automatic fallback to default values for new R1 fields (asrEngine, asrDevice, enableDiarization, hfToken, pythonPath).
 *    - Safe unencrypted plaintext secret reading without DPAPI crashes.
 *    - Safe handling of legacy deprecated fields (ocrRegion).
 * 3. SRT parsing and serialization round-tripping:
 *    - Standard legacy SRT without speaker tags (CRLF, LF, BOM, comma/dot ms, short ms, seconds format).
 *    - Diarized SRT with [SPEAKER_XX]: syntax.
 *    - Multi-cycle roundtrip idempotency without spurious prefixes or prefix duplication.
 *    - Mixed and edge-case SRT parsing.
 * 4. ASS non-kinetic export & legacy parser compliance:
 *    - ASS v4.00+ header and structure compliance (ScriptType: v4.00+, PlayResX/Y, [V4+ Styles], [Events]).
 *    - Complete absence of kinetic tags (\k, \fscx, \p1) in non-kinetic mode.
 *    - Dialogue timecode centisecond format (H:MM:SS.cs).
 *    - Dual subtitle (secondary track) support.
 *    - AST parser validation matching legacy ASS engine rules.
 * 5. Empirical FFmpeg libass hardsub burn-in:
 *    - Real video synthesis with FFmpeg.
 *    - Burning non-kinetic ASS subtitles with libass subtitles filter.
 *    - Burning legacy SRT with force_style via burnHardsub.
 * 6. Downstream NLP & CPS safety on legacy SrtLine payloads:
 *    - segmentSubtitlesNetflix and calculateCps on bare SrtLine objects lacking all optional fields.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

// Step 0: Prepare isolated test directories for stores BEFORE importing stores
const tempTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_test_tasks_compat_'));
const tempSettingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_test_settings_compat_'));

process.env.VANHSUB_TASKS_DIR = tempTasksDir;
process.env.VANHSUB_SETTINGS_DIR = tempSettingsDir;

// Seed legacy taskStore JSON file (simulating v1.0 schema prior to R1/R2/R3)
const legacyTasksSeed = {
  tasks: [
    {
      id: 'task-legacy-001',
      fileName: 'video_v1_legacy.mp4',
      filePath: 'C:\\Videos\\video_v1_legacy.mp4',
      fileSize: '45 MB',
      duration: '02:30',
      workflow: 'fast-transcribe',
      status: 'done',
      progress: 100,
      stageDescription: 'Hoàn thành phiên âm',
      sourceLanguage: 'vi',
      asrModel: 'base',
      srtPath: 'C:\\Videos\\video_v1_legacy.srt',
      createdAt: '2025-12-01T10:00:00.000Z',
      updatedAt: '2025-12-01T10:02:30.000Z',
      // Explicitly NO asrEngine, enableDiarization, speakers, speakerCount, ttsOverruns, ocrStats
    },
    {
      id: 'task-legacy-002-sparse',
      fileName: 'sparse_v1.mp4',
      filePath: 'C:\\Videos\\sparse_v1.mp4',
      workflow: 'bilingual-sub',
      status: 'queued',
      progress: 0,
      createdAt: '2025-12-02T08:00:00.000Z',
      updatedAt: '2025-12-02T08:00:00.000Z',
      // Missing fileSize, duration, stageDescription, languages
    },
    {
      id: 'task-legacy-003-extra-fields',
      fileName: 'extra_props_v1.mp4',
      filePath: 'C:\\Videos\\extra_props_v1.mp4',
      workflow: 'custom',
      status: 'done',
      progress: 100,
      createdAt: '2025-12-03T11:00:00.000Z',
      updatedAt: '2025-12-03T11:05:00.000Z',
      nlpSegmented: true,
      kineticConfig: null,
      legacyCustomTag: 'test-v1-tag',
      ocrRegion: '0,0,100,30',
    },
    {
      id: 'task-legacy-004-stale-transcribing',
      fileName: 'interrupted_asr.mp4',
      filePath: 'C:\\Videos\\interrupted_asr.mp4',
      workflow: 'fast-transcribe',
      status: 'transcribing',
      progress: 45,
      stageDescription: 'Đang phiên âm (45%)...',
      createdAt: '2025-12-04T12:00:00.000Z',
      updatedAt: '2025-12-04T12:01:00.000Z',
    },
    {
      id: 'task-legacy-005-stale-ocr',
      fileName: 'interrupted_ocr.mp4',
      filePath: 'C:\\Videos\\interrupted_ocr.mp4',
      workflow: 'full-dubbing',
      status: 'ocr',
      progress: 60,
      stageDescription: 'Đang quét OCR...',
      createdAt: '2025-12-04T13:00:00.000Z',
      updatedAt: '2025-12-04T13:02:00.000Z',
    },
    {
      id: 'task-legacy-006-stale-dubbing',
      fileName: 'interrupted_dub.mp4',
      filePath: 'C:\\Videos\\interrupted_dub.mp4',
      workflow: 'full-dubbing',
      status: 'dubbing',
      progress: 80,
      stageDescription: 'Đang tạo giọng lồng tiếng...',
      createdAt: '2025-12-04T14:00:00.000Z',
      updatedAt: '2025-12-04T14:03:00.000Z',
    },
  ],
};

fs.writeFileSync(
  path.join(tempTasksDir, 'vanhsub-tasks.json'),
  JSON.stringify(legacyTasksSeed, null, 2),
  'utf-8'
);

// Seed legacy settingsStore JSON file (simulating v1.0 settings prior to R1/R2/R3)
const legacySettingsSeed = {
  geminiApiKey: 'AIzaSyLegacyPlaintextKey123',
  geminiModel: 'gemini-1.5-flash',
  targetLanguage: 'vi',
  exportDir: 'C:\\Exports',
  translateBatchSize: 20,
  translateConcurrency: 2,
  autoTranslateAfterAsr: true,
  vietTtsEndpoint: 'http://localhost:6006',
  ttsVoice: 'BV074_streaming',
  ttsSpeed: 1.1,
  ocrLanguage: 'vie',
  ocrFps: 2,
  ocrMode: 'bottom',
  ocrCustomRegion: null,
  ocrRegion: '0,0,100,30', // Deprecated field from early builds
  ocrDualEngine: false,
  glossary: 'AI = Trí tuệ nhân tạo',
  translationStyleGuide: 'Văn phong tự nhiên',
  onboardingCompleted: true,
  veoMode: 'free_session',
  veoSessionCookie: 'session_cookie_plaintext_xyz_legacy',
  veoSessionAuthToken: 'bearer_token_plaintext_abc_legacy',
  veoAccountEmail: 'legacy_user@gmail.com',
  veoSessionStatus: 'active',
  veoLastChecked: 1733000000000,
  veoCooldownSeconds: 10,
  veoFlowCredits: 50,
  veoFlowCreditsCheckedAt: 1733000000000,
  // Note: NO asrEngine, asrDevice, enableDiarization, hfToken, pythonPath
};

fs.writeFileSync(
  path.join(tempSettingsDir, 'vanhsub-settings.json'),
  JSON.stringify(legacySettingsSeed, null, 2),
  'utf-8'
);

// Now import the stores and target modules
import { TaskStore, type Task } from '../main/store/taskStore';
import { SettingsStore } from '../main/store/settingsStore';
import {
  parseSrt,
  serializeSrt,
  formatMs,
  parseMsString,
  parseTimecode,
  type SrtLine,
} from '../main/lib/srt';
import {
  compileToAss,
  buildEntryOverrideTags,
  hexToAssColor,
  formatAssTime,
  type CompileSubtitleItem,
} from '../main/render/assCompiler';
import {
  burnHardsub,
  type SubtitleStyle,
} from '../main/render/videoRenderer';
import {
  segmentSubtitlesNetflix,
  calculateCps,
  splitLineSmart,
} from '../main/lib/nlpSegmenter';

// Test harness state
let totalAssertions = 0;
let passedAssertions = 0;
const failureList: string[] = [];

function assert(condition: boolean, testName: string, detail?: string) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    const msg = `  ✗ FAIL: ${testName}${detail ? ` -> ${detail}` : ''}`;
    failureList.push(msg);
    console.error(msg);
  }
}

async function runEmpiricalSuite() {
  console.log('========================================================================');
  console.log('CHALLENGER 2: BACKWARD COMPATIBILITY & DATA INTEGRITY VERIFICATION SUITE');
  console.log('========================================================================\n');

  // =========================================================================
  // SUITE 1: TaskStore Backward Compatibility & Fallback Verification
  // =========================================================================
  console.log('--- SUITE 1: TaskStore Backward Compatibility & Fallback Verification ---');

  const allInitial = TaskStore.getAll();
  assert(allInitial.length === 6, '1.1 TaskStore.getAll() loads 6 legacy tasks from disk');

  // Check Task 1 (pre-R1 fully done task)
  const task1 = TaskStore.getById('task-legacy-001');
  assert(task1 !== undefined, '1.2 TaskStore.getById finds legacy task 1');
  assert(task1?.fileName === 'video_v1_legacy.mp4', '1.3 Legacy task fileName matches');
  assert(task1?.asrEngine === undefined, '1.4 Legacy task asrEngine is undefined initially');
  assert(task1?.enableDiarization === undefined, '1.5 Legacy task enableDiarization is undefined initially');
  assert(task1?.speakers === undefined, '1.6 Legacy task speakers is undefined initially');
  assert(task1?.speakerCount === undefined, '1.7 Legacy task speakerCount is undefined initially');

  // Verify safe fallback evaluations as performed in taskRunner.ts
  const resolvedAsrEngine = task1?.asrEngine || SettingsStore.get('asrEngine') || 'faster-whisper';
  assert(resolvedAsrEngine === 'faster-whisper', '1.8 Resolved asrEngine defaults to "faster-whisper"');

  const resolvedDiarization = task1?.enableDiarization ?? (SettingsStore.get('enableDiarization') as boolean);
  assert(resolvedDiarization === false, '1.9 Resolved enableDiarization defaults to false');

  const resolvedSpeakers = task1?.speakers ?? [];
  assert(Array.isArray(resolvedSpeakers) && resolvedSpeakers.length === 0, '1.10 Resolved speakers defaults to empty array');

  // Check Task 2 (sparse task with missing optional values)
  const task2 = TaskStore.getById('task-legacy-002-sparse');
  assert(task2 !== undefined, '1.11 TaskStore.getById finds sparse legacy task 2');
  assert(task2?.fileSize === undefined, '1.12 Sparse task fileSize is undefined');
  assert(task2?.duration === undefined, '1.13 Sparse task duration is undefined');

  // Check Task 3 (task with extra legacy keys)
  const task3 = TaskStore.getById('task-legacy-003-extra-fields');
  assert(task3 !== undefined, '1.14 TaskStore.getById finds legacy task with extra keys');
  assert((task3 as any)?.nlpSegmented === true, '1.15 Extra key nlpSegmented preserved without schema error');
  assert((task3 as any)?.kineticConfig === null, '1.16 Extra key kineticConfig: null preserved without schema error');

  // Test updating legacy task with R1/R2 fields
  const updatedTask1 = TaskStore.update('task-legacy-001', {
    asrEngine: 'faster-whisper',
    enableDiarization: true,
    speakerCount: 2,
    speakers: ['SPEAKER_00', 'SPEAKER_01'],
  });
  assert(updatedTask1?.asrEngine === 'faster-whisper', '1.17 Legacy task successfully updated with asrEngine');
  assert(updatedTask1?.enableDiarization === true, '1.18 Legacy task successfully updated with enableDiarization');
  assert(updatedTask1?.speakers?.length === 2, '1.19 Legacy task successfully updated with speakers list');
  assert(updatedTask1?.fileName === 'video_v1_legacy.mp4', '1.20 Legacy task original fileName preserved across update');

  // Test resetStaleRunning() on legacy tasks
  const fixedStale = TaskStore.resetStaleRunning();
  assert(fixedStale.length === 3, '1.21 resetStaleRunning() caught exactly 3 stale legacy tasks');
  const fixedIds = new Set(fixedStale.map((t) => t.id));
  assert(fixedIds.has('task-legacy-004-stale-transcribing'), '1.22 Interrupted transcribing task reset');
  assert(fixedIds.has('task-legacy-005-stale-ocr'), '1.23 Interrupted ocr task reset');
  assert(fixedIds.has('task-legacy-006-stale-dubbing'), '1.24 Interrupted dubbing task reset');

  const task4 = TaskStore.getById('task-legacy-004-stale-transcribing');
  assert(task4?.status === 'error', '1.25 Stale task status safely transitioned to "error"');
  assert(task4?.stageDescription === 'Bị gián đoạn ở phiên trước', '1.26 Stale task stageDescription updated');
  assert(task4?.errorMessage?.includes('bấm "Chạy cả quy trình"'), '1.27 Stale task informative errorMessage populated');

  // Verify non-stale tasks were NOT touched by resetStaleRunning
  const task1AfterReset = TaskStore.getById('task-legacy-001');
  assert(task1AfterReset?.status === 'done', '1.28 Completed legacy task status remained "done"');
  const task2AfterReset = TaskStore.getById('task-legacy-002-sparse');
  assert(task2AfterReset?.status === 'queued', '1.29 Queued legacy task status remained "queued"');

  // Test creating new task alongside legacy tasks
  const newTask = TaskStore.create({
    fileName: 'brand_new_v2.mp4',
    filePath: 'C:\\Videos\\brand_new_v2.mp4',
  });
  assert(newTask.id !== undefined, '1.30 New task generated unique UUID');
  assert(newTask.fileSize === '0 MB', '1.31 New task default fileSize applied');
  assert(newTask.duration === '00:00', '1.32 New task default duration applied');
  assert(newTask.workflow === 'fast-transcribe', '1.33 New task default workflow applied');
  assert(newTask.status === 'queued', '1.34 New task default status applied');
  assert(newTask.progress === 0, '1.35 New task default progress applied');
  assert(newTask.sourceLanguage === 'vi', '1.36 New task default sourceLanguage applied');
  assert(newTask.asrModel === 'base', '1.37 New task default asrModel applied');

  // Test deletion of legacy task
  const deleteResult = TaskStore.delete('task-legacy-002-sparse');
  assert(deleteResult === true, '1.38 Legacy task deleted successfully');
  assert(TaskStore.getById('task-legacy-002-sparse') === undefined, '1.39 Deleted legacy task no longer returned');

  // Verify disk persistence of TaskStore
  const diskTasksRaw = fs.readFileSync(path.join(tempTasksDir, 'vanhsub-tasks.json'), 'utf-8');
  const diskTasksJson = JSON.parse(diskTasksRaw);
  assert(Array.isArray(diskTasksJson.tasks), '1.40 TaskStore disk file contains valid tasks array');
  assert(diskTasksJson.tasks.some((t: Task) => t.id === 'task-legacy-001' && t.enableDiarization === true), '1.41 Updated R1 fields persisted to disk JSON');

  // =========================================================================
  // SUITE 2: SettingsStore Backward Compatibility & Fallback Verification
  // =========================================================================
  console.log('\n--- SUITE 2: SettingsStore Backward Compatibility & Fallback Verification ---');

  // Verify safe defaults for newly introduced R1/R2 properties on legacy store
  assert(SettingsStore.get('asrEngine') === 'faster-whisper', '2.1 SettingsStore.get("asrEngine") defaults to "faster-whisper"');
  assert(SettingsStore.get('asrDevice') === 'auto', '2.2 SettingsStore.get("asrDevice") defaults to "auto"');
  assert(SettingsStore.get('enableDiarization') === false, '2.3 SettingsStore.get("enableDiarization") defaults to false');
  assert(SettingsStore.get('hfToken') === '', '2.4 SettingsStore.get("hfToken") defaults to ""');
  assert(SettingsStore.get('pythonPath') === '', '2.5 SettingsStore.get("pythonPath") defaults to ""');

  // Verify unencrypted plaintext secret compatibility (data stored prior to encryption)
  assert(SettingsStore.get('geminiApiKey') === 'AIzaSyLegacyPlaintextKey123', '2.6 Unencrypted legacy geminiApiKey read successfully without DPAPI crash');
  assert(SettingsStore.hasGeminiKey() === true, '2.7 SettingsStore.hasGeminiKey() returns true for legacy plaintext key');
  assert(SettingsStore.get('veoSessionCookie') === 'session_cookie_plaintext_xyz_legacy', '2.8 Unencrypted legacy veoSessionCookie read successfully');
  assert(SettingsStore.get('veoSessionAuthToken') === 'bearer_token_plaintext_abc_legacy', '2.9 Unencrypted legacy veoSessionAuthToken read successfully');
  assert(SettingsStore.hasVeoSession() === true, '2.10 SettingsStore.hasVeoSession() returns true for legacy session');

  // Verify existing legacy settings preserved
  assert(SettingsStore.get('translateBatchSize') === 20, '2.11 Existing setting translateBatchSize preserved');
  assert(SettingsStore.get('ttsSpeed') === 1.1, '2.12 Existing setting ttsSpeed preserved');
  assert(SettingsStore.get('ocrRegion') === '0,0,100,30', '2.13 Deprecated ocrRegion safely accessible');

  // Test updating R1 settings
  SettingsStore.set('asrEngine', 'whisper-cpp');
  assert(SettingsStore.get('asrEngine') === 'whisper-cpp', '2.14 SettingsStore.set("asrEngine") updates value');
  SettingsStore.set('enableDiarization', true);
  assert(SettingsStore.get('enableDiarization') === true, '2.15 SettingsStore.set("enableDiarization") updates value');

  // Verify settings written to disk
  const diskSettingsRaw = fs.readFileSync(path.join(tempSettingsDir, 'vanhsub-settings.json'), 'utf-8');
  const diskSettingsJson = JSON.parse(diskSettingsRaw);
  assert(diskSettingsJson.asrEngine === 'whisper-cpp', '2.16 New asrEngine setting persisted to disk');
  assert(diskSettingsJson.enableDiarization === true, '2.17 New enableDiarization setting persisted to disk');

  // =========================================================================
  // SUITE 3: SRT Parsing & Serialization Round-Tripping (Standard & Diarized)
  // =========================================================================
  console.log('\n--- SUITE 3: SRT Parsing & Serialization Round-Tripping ---');

  // 3.1: Parsing Standard Non-Diarized Legacy SRT with various line breaks & formatting
  const standardLegacySrt = [
    '1',
    '00:00:01,000 --> 00:00:04,500',
    'Chào mừng các bạn đến với video hôm nay.',
    '',
    '2',
    '00:00:04,800 --> 00:00:08,250',
    'Chúng ta sẽ cùng tìm hiểu về trí tuệ nhân tạo.',
    '',
    '3',
    '00:00:08,500 --> 00:00:12,000',
    'Công nghệ này đang thay đổi thế giới rất nhanh.',
  ].join('\n');

  const parsedStandard = parseSrt(standardLegacySrt);
  assert(parsedStandard.length === 3, '3.1 parseSrt parses 3 standard subtitle blocks');
  assert(parsedStandard[0].speaker === undefined, '3.2 Standard SRT line 1 speaker is undefined');
  assert(parsedStandard[1].speaker === undefined, '3.3 Standard SRT line 2 speaker is undefined');
  assert(parsedStandard[2].speaker === undefined, '3.4 Standard SRT line 3 speaker is undefined');
  assert(parsedStandard[0].startMs === 1000 && parsedStandard[0].endMs === 4500, '3.5 Standard timecodes accurately parsed');
  assert(parsedStandard[0].text === 'Chào mừng các bạn đến với video hôm nay.', '3.6 Standard dialogue text preserved');

  // Roundtrip Standard SRT
  const serializedStandard = serializeSrt(parsedStandard);
  assert(!serializedStandard.includes('[]:'), '3.7 serializeSrt does NOT introduce empty brackets []:');
  assert(!serializedStandard.includes('[undefined]:'), '3.8 serializeSrt does NOT introduce [undefined]:');
  assert(!serializedStandard.includes('[null]:'), '3.9 serializeSrt does NOT introduce [null]:');

  const reparsedStandard = parseSrt(serializedStandard);
  assert(reparsedStandard.length === 3, '3.10 reparsed standard SRT has matching length');
  assert(reparsedStandard[0].text === parsedStandard[0].text, '3.11 reparsed text matches exactly');
  assert(reparsedStandard[0].startMs === parsedStandard[0].startMs, '3.12 reparsed startMs matches exactly');
  assert(reparsedStandard[0].endMs === parsedStandard[0].endMs, '3.13 reparsed endMs matches exactly');
  assert(reparsedStandard[0].speaker === undefined, '3.14 reparsed speaker remains undefined');

  // Idempotency: multiple serialize/parse iterations
  let currentSrtStr = serializedStandard;
  for (let i = 0; i < 5; i++) {
    currentSrtStr = serializeSrt(parseSrt(currentSrtStr));
  }
  assert(currentSrtStr === serializedStandard, '3.15 Standard SRT serialization is strictly idempotent across 5 cycles');

  // 3.2: Format edge cases: CRLF, BOM, dot ms
  const crlfSrt = '\uFEFF1\r\n00:00:01.500 --> 00:00:03.750\r\nĐoạn phụ đề có BOM và dấu chấm.\r\n\r\n2\r\n00:01:05,500 --> 00:01:10,250\r\nĐoạn phụ đề thứ hai chuẩn CRLF.\r\n';
  const parsedCrlf = parseSrt(crlfSrt);
  assert(parsedCrlf.length === 2, '3.16 parseSrt handles UTF-8 BOM, CRLF, and dot ms');
  assert(parsedCrlf[0].startMs === 1500 && parsedCrlf[0].endMs === 3750, '3.17 Dot ms parsed correctly');
  assert(parsedCrlf[1].startMs === 65500 && parsedCrlf[1].endMs === 70250, '3.18 Standard timecode 00:01:05,500 parsed to 65500ms');

  // Short timecode resilience via parseTimecode
  assert(parseTimecode('01:05,500') === 65500, '3.18b parseTimecode short format "01:05,500" === 65500ms');
  assert(parseTimecode('01:05,5') === 65500, '3.18c parseTimecode short format "01:05,5" === 65500ms');

  // Timecode parsing unit tests
  assert(parseMsString('5') === 500, '3.19 parseMsString("5") === 500ms');
  assert(parseMsString('50') === 500, '3.20 parseMsString("50") === 500ms');
  assert(parseMsString('500') === 500, '3.21 parseMsString("500") === 500ms');
  assert(parseMsString('050') === 50, '3.22 parseMsString("050") === 50ms');
  assert(parseMsString('005') === 5, '3.23 parseMsString("005") === 5ms');
  assert(parseTimecode('65.5') === 65500, '3.24 parseTimecode seconds format "65.5" === 65500ms');

  // 3.3: Diarized SRT Parsing & Extraction
  const diarizedSrt = [
    '1',
    '00:00:00,500 --> 00:00:03,200',
    '[SPEAKER_00]: Xin chào, tôi là người dẫn chương trình.',
    '',
    '2',
    '00:00:03,500 --> 00:00:07,000',
    '[SPEAKER_01]: Chào bạn, tôi là khách mời hôm nay.',
    '',
    '3',
    '00:00:07,200 --> 00:00:10,500',
    '[SPEAKER-02]: Rất vui được gặp cả hai bạn.',
    '',
    '4',
    '00:00:11,000 --> 00:00:14,000',
    'Phần thuyết minh không có người nói cụ thể.',
  ].join('\n');

  const parsedDiarized = parseSrt(diarizedSrt);
  assert(parsedDiarized.length === 4, '3.25 Diarized SRT parsed 4 blocks');
  assert(parsedDiarized[0].speaker === 'SPEAKER_00', '3.26 Block 1 speaker extracted as "SPEAKER_00"');
  assert(parsedDiarized[0].text === 'Xin chào, tôi là người dẫn chương trình.', '3.27 Block 1 prefix stripped from text');
  assert(parsedDiarized[1].speaker === 'SPEAKER_01', '3.28 Block 2 speaker extracted as "SPEAKER_01"');
  assert(parsedDiarized[2].speaker === 'SPEAKER-02', '3.29 Block 3 hyphenated speaker "SPEAKER-02" extracted');
  assert(parsedDiarized[3].speaker === undefined, '3.30 Block 4 without speaker tag leaves speaker undefined');

  // 3.4: Diarized SRT Round-Trip
  const serializedDiarized = serializeSrt(parsedDiarized);
  assert(serializedDiarized.includes('[SPEAKER_00]: Xin chào, tôi là người dẫn chương trình.'), '3.31 Diarized line 1 re-serialized with speaker tag');
  assert(serializedDiarized.includes('[SPEAKER_01]: Chào bạn, tôi là khách mời hôm nay.'), '3.32 Diarized line 2 re-serialized with speaker tag');
  assert(serializedDiarized.includes('[SPEAKER-02]: Rất vui được gặp cả hai bạn.'), '3.33 Diarized line 3 re-serialized with speaker tag');
  assert(!serializedDiarized.includes('[]: Phần thuyết minh'), '3.34 Non-speaker line does NOT receive brackets');

  const reparsedDiarized = parseSrt(serializedDiarized);
  assert(reparsedDiarized[0].speaker === 'SPEAKER_00', '3.35 Reparsed diarized speaker preserved');
  assert(reparsedDiarized[0].text === 'Xin chào, tôi là người dẫn chương trình.', '3.36 Reparsed diarized text preserved without duplicate prefix');

  // Verify NO prefix accumulation across multiple serializations
  let currentDiarized = serializedDiarized;
  for (let i = 0; i < 5; i++) {
    currentDiarized = serializeSrt(parseSrt(currentDiarized));
  }
  assert(!currentDiarized.includes('[SPEAKER_00]: [SPEAKER_00]:'), '3.37 Speaker prefixes NEVER accumulate or duplicate');
  assert(currentDiarized === serializedDiarized, '3.38 Diarized SRT serialization is strictly idempotent across 5 cycles');

  // 3.5: Edge Cases: Sound effects in brackets, colons in text, mixed syntax
  const edgeCaseSrt = [
    '1',
    '00:00:01,000 --> 00:00:04,000',
    '[Tiếng vỗ tay] Cảm ơn tất cả mọi người.', // Bracketed SFX without colon -> NOT speaker
    '',
    '2',
    '00:00:04,500 --> 00:00:07,000',
    'Tỉ số trận đấu: 2-1 nghiêng về đội nhà.', // Colon in text -> NOT speaker
    '',
    '3',
    '00:00:07,500 --> 00:00:10,000',
    '[SPEAKER_00]: Cuộc họp bắt đầu lúc 10:30 sáng.', // Speaker tag AND colon in dialogue
  ].join('\n');

  const parsedEdge = parseSrt(edgeCaseSrt);
  assert(parsedEdge[0].speaker === undefined, '3.39 Bracketed sound effect [Tiếng vỗ tay] is NOT misclassified as speaker');
  assert(parsedEdge[0].text === '[Tiếng vỗ tay] Cảm ơn tất cả mọi người.', '3.40 Bracketed sound effect text preserved intact');
  assert(parsedEdge[1].speaker === undefined, '3.41 Colon in dialogue "Tỉ số trận đấu: 2-1" is NOT misclassified as speaker');
  assert(parsedEdge[2].speaker === 'SPEAKER_00', '3.42 Real speaker with dialogue colon correctly extracted');
  assert(parsedEdge[2].text === 'Cuộc họp bắt đầu lúc 10:30 sáng.', '3.43 Dialogue colon preserved after speaker prefix stripped');

  // =========================================================================
  // SUITE 4: ASS Non-Kinetic Export & Legacy Parser Conformance
  // =========================================================================
  console.log('\n--- SUITE 4: ASS Non-Kinetic Export & Legacy Parser Conformance ---');

  const testItems: CompileSubtitleItem[] = [
    {
      id: 'sub-1',
      startMs: 1000,
      endMs: 4500,
      text: 'Chào mừng các bạn đến với VANHSUB.',
    },
    {
      id: 'sub-2',
      startMs: 5000,
      endMs: 8200,
      text: 'Dòng phụ đề thứ hai\nCó ngắt dòng tự nhiên.',
    },
    {
      id: 'sub-3',
      startMs: 8500,
      endMs: 12000,
      text: 'Dòng phụ đề thứ ba với màu tuỳ chỉnh.',
      style: {
        textColorHex: '#FFE500',
        bold: true,
        fontSize: 26,
      },
    },
  ];

  // 4.1: Non-kinetic export configurations
  // Config A: No options passed
  const assNoOptions = compileToAss(testItems);
  // Config B: kineticConfig is undefined
  const assUndefinedKinetic = compileToAss(testItems, { kineticConfig: undefined });
  // Config C: kineticConfig preset is 'none'
  const assPresetNone = compileToAss(testItems, { kineticConfig: { preset: 'none' } });

  for (const [name, assText] of [
    ['NoOptions', assNoOptions],
    ['UndefinedKinetic', assUndefinedKinetic],
    ['PresetNone', assPresetNone],
  ]) {
    // 4.2: ASS v4.00+ Specification Compliance
    assert(assText.includes('[Script Info]'), `4.1 [${name}] contains [Script Info] header`);
    assert(assText.includes('ScriptType: v4.00+'), `4.2 [${name}] ScriptType is v4.00+`);
    assert(assText.includes('WrapStyle: 0'), `4.3 [${name}] WrapStyle is 0`);
    assert(assText.includes('ScaledBorderAndShadow: yes'), `4.4 [${name}] ScaledBorderAndShadow is yes`);
    assert(assText.includes('PlayResX: 384'), `4.5 [${name}] default PlayResX is 384`);
    assert(assText.includes('PlayResY: 288'), `4.6 [${name}] default PlayResY is 288`);

    assert(assText.includes('[V4+ Styles]'), `4.7 [${name}] contains [V4+ Styles] header`);
    assert(
      assText.includes('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'),
      `4.8 [${name}] contains standard Styles Format line`
    );
    assert(assText.includes('Style: Default,'), `4.9 [${name}] contains Default style definition`);

    assert(assText.includes('[Events]'), `4.10 [${name}] contains [Events] header`);
    assert(
      assText.includes('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'),
      `4.11 [${name}] contains standard Events Format line`
    );

    // 4.3: Absence of Kinetic Artifacts
    assert(!assText.includes('\\k'), `4.12 [${name}] does NOT contain karaoke \\k tags`);
    assert(!assText.includes('\\fscx1'), `4.13 [${name}] does NOT contain \\fscx kinetic scale tags`);
    assert(!assText.includes('\\p1'), `4.14 [${name}] does NOT contain \\p1 vector drawings`);
    assert(!assText.includes('HormoziWord'), `4.15 [${name}] does NOT contain Hormozi style`);
    assert(!assText.includes('MrBeastWord'), `4.16 [${name}] does NOT contain MrBeast style`);
    assert(!assText.includes('MinimalGlowWord'), `4.17 [${name}] does NOT contain Minimalist Glow style`);
    assert(!assText.includes('MinimalBar'), `4.18 [${name}] does NOT contain progress bar style`);

    // Verify timecodes and newline conversion
    assert(assText.includes('Dialogue: 0,0:00:01.00,0:00:04.50,Default,,0,0,0,,Chào mừng các bạn đến với VANHSUB.'), `4.19 [${name}] Line 1 dialogue timecode and text match`);
    assert(assText.includes('Dòng phụ đề thứ hai\\N'), `4.20 [${name}] Newlines converted to ASS \\N`);
  }

  // Verify custom video dimensions when specified in non-kinetic mode
  const assCustomDims = compileToAss(testItems, {
    videoWidth: 1920,
    videoHeight: 1080,
    kineticConfig: { preset: 'none' },
  });
  assert(assCustomDims.includes('PlayResX: 1920'), '4.21 Custom videoWidth 1920 passed to PlayResX');
  assert(assCustomDims.includes('PlayResY: 1080'), '4.22 Custom videoHeight 1080 passed to PlayResY');

  // Verify per-line overrides in non-kinetic mode
  assert(assNoOptions.includes('{\\c&H0000E5FF&\\fs26\\b1}Dòng phụ đề thứ ba với màu tuỳ chỉnh.'), '4.23 Style override tags generated correctly in non-kinetic mode');

  // 4.4: Dual Subtitle (Secondary Track) Conformance
  const secondaryItems: CompileSubtitleItem[] = [
    {
      startMs: 1000,
      endMs: 4500,
      text: 'Welcome everyone to VANHSUB.',
    },
  ];

  const assDualTrack = compileToAss(testItems, {
    secondaryItems,
    kineticConfig: undefined,
  });
  assert(assDualTrack.includes('Style: Secondary,'), '4.24 Dual subtitle defines Style: Secondary');
  assert(assDualTrack.includes('Dialogue: 0,0:00:01.00,0:00:04.50,Secondary,,0,0,0,,'), '4.25 Secondary dialogue line generated with Secondary style');

  // 4.5: Strict Legacy ASS Parser AST Validation
  function parseAndValidateAss(assContent: string): { valid: boolean; errors: string[] } {
    const lines = assContent.split(/\r?\n/);
    const errors: string[] = [];
    let currentSection = '';
    let hasScriptInfo = false;
    let hasStyles = false;
    let hasEvents = false;
    let dialogueCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith(';')) continue;

      if (line.startsWith('[') && line.endsWith(']')) {
        currentSection = line;
        if (line === '[Script Info]') hasScriptInfo = true;
        if (line === '[V4+ Styles]') hasStyles = true;
        if (line === '[Events]') hasEvents = true;
        continue;
      }

      if (currentSection === '[Events]' && line.startsWith('Dialogue:')) {
        dialogueCount++;
        const parts = line.replace('Dialogue:', '').trim().split(',');
        if (parts.length < 10) {
          errors.push(`Line ${i + 1}: Dialogue has fewer than 10 format fields (${parts.length})`);
        }
        const start = parts[1]?.trim();
        const end = parts[2]?.trim();
        const timeRe = /^\d+:\d{2}:\d{2}\.\d{2}$/;
        if (!timeRe.test(start)) errors.push(`Line ${i + 1}: Invalid start timecode "${start}"`);
        if (!timeRe.test(end)) errors.push(`Line ${i + 1}: Invalid end timecode "${end}"`);
      }
    }

    if (!hasScriptInfo) errors.push('Missing [Script Info] section');
    if (!hasStyles) errors.push('Missing [V4+ Styles] section');
    if (!hasEvents) errors.push('Missing [Events] section');
    if (dialogueCount === 0) errors.push('No dialogue lines found');

    return { valid: errors.length === 0, errors };
  }

  const astValidation = parseAndValidateAss(assPresetNone);
  assert(astValidation.valid, '4.26 Strict legacy ASS parser validates non-kinetic ASS with 0 errors', astValidation.errors.join('; '));

  // =========================================================================
  // SUITE 5: Empirical FFmpeg Libass Hardsub Burn-In Test
  // =========================================================================
  console.log('\n--- SUITE 5: Empirical FFmpeg Libass Hardsub Burn-In Test ---');

  const ffmpegPath = ((ffmpegInstaller as any)?.path || (ffmpegInstaller as any)?.default?.path || '').replace('app.asar', 'app.asar.unpacked');
  assert(fs.existsSync(ffmpegPath), '5.1 FFmpeg executable exists at installer path');

  const testMediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_ffmpeg_compat_'));
  const synthVideoPath = path.join(testMediaDir, 'synth_input.mp4');
  const assFilePath = path.join(testMediaDir, 'legacy_compat.ass');
  const srtFilePath = path.join(testMediaDir, 'legacy_compat.srt');
  const outAssBurnVideo = path.join(testMediaDir, 'out_ass_burned.mp4');
  const outSrtBurnVideo = path.join(testMediaDir, 'out_srt_burned.mp4');

  // Write the compiled non-kinetic ASS to file
  fs.writeFileSync(assFilePath, assCustomDims, 'utf-8');
  // Write legacy SRT to file
  fs.writeFileSync(srtFilePath, standardLegacySrt, 'utf-8');

  // Step 5.1: Create 1.5s synthetic MP4 video
  try {
    execFileSync(
      ffmpegPath,
      [
        '-y',
        '-f', 'lavfi', '-i', 'color=c=0x112233:s=640x360:d=1.5:r=25',
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-t', '1.5',
        '-pix_fmt', 'yuv420p',
        synthVideoPath,
      ],
      { stdio: 'pipe' }
    );
    assert(fs.existsSync(synthVideoPath) && fs.statSync(synthVideoPath).size > 1000, '5.2 Synthetic test video created successfully');
  } catch (err: any) {
    assert(false, '5.2 Synthetic test video created successfully', err.message);
  }

  // Step 5.2: Burn non-kinetic ASS subtitle using FFmpeg libass filter
  try {
    // Windows path escaping for ffmpeg subtitles filter: C:/path/file.ass with C\:
    const escapedAss = assFilePath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
    execFileSync(
      ffmpegPath,
      [
        '-y',
        '-i', synthVideoPath,
        '-vf', `subtitles=filename='${escapedAss}'`,
        '-c:v', 'libx264',
        '-c:a', 'copy',
        '-pix_fmt', 'yuv420p',
        outAssBurnVideo,
      ],
      { stdio: 'pipe' }
    );
    assert(
      fs.existsSync(outAssBurnVideo) && fs.statSync(outAssBurnVideo).size > 1000,
      '5.3 FFmpeg libass burned non-kinetic ASS into video with exit code 0'
    );
  } catch (err: any) {
    assert(false, '5.3 FFmpeg libass burned non-kinetic ASS into video with exit code 0', err.message);
  }

  // Step 5.3: Burn legacy SRT with SubtitleStyle via burnHardsub()
  try {
    let burnProgressReported = false;
    const testStyle: SubtitleStyle = {
      fontName: 'Arial',
      fontSize: 20,
      primaryColour: '#00FFFF',
      outlineColour: '#000000',
      opacity: 100,
      outline: 2,
      shadow: 1,
      bold: true,
      borderStyle: 1,
      alignment: 2,
      marginV: 20,
    };

    await burnHardsub({
      videoPath: synthVideoPath,
      srtPath: srtFilePath,
      outputPath: outSrtBurnVideo,
      style: testStyle,
      onProgress: (p) => {
        if (p > 0) burnProgressReported = true;
      },
    });

    assert(
      fs.existsSync(outSrtBurnVideo) && fs.statSync(outSrtBurnVideo).size > 1000,
      '5.4 burnHardsub burned legacy SRT with custom style into video with exit code 0'
    );
    assert(burnProgressReported, '5.5 burnHardsub progress callback fired during render');
  } catch (err: any) {
    assert(false, '5.4 burnHardsub burned legacy SRT with custom style', err.message);
  }

  // Clean up media files
  try {
    fs.rmSync(testMediaDir, { recursive: true, force: true });
  } catch {}

  // =========================================================================
  // SUITE 6: Downstream NLP & CPS Safety on Legacy SrtLine Payloads
  // =========================================================================
  console.log('\n--- SUITE 6: Downstream NLP & CPS Safety on Legacy SrtLine Payloads ---');

  // Create bare SrtLine objects lacking all optional fields
  const bareLines: SrtLine[] = [
    {
      id: 'bare-1',
      startMs: 0,
      endMs: 2500,
      text: 'Chính phủ vừa ban hành nghị định mới về phát triển kinh tế số và trí tuệ nhân tạo.',
    },
    {
      id: 'bare-2',
      startMs: 2600,
      endMs: 4000,
      text: 'Mục tiêu là đào tạo hơn 50.000 kỹ sư công nghệ cao vào năm 2030.',
    },
    {
      id: 'bare-3',
      startMs: 4100,
      endMs: 5000,
      text: 'Rất ngắn.',
    },
  ];

  // 6.1: Run segmentSubtitlesNetflix on bare legacy lines
  let segmentedBare: SrtLine[] = [];
  try {
    segmentedBare = segmentSubtitlesNetflix(bareLines);
    assert(segmentedBare.length > 0, '6.1 segmentSubtitlesNetflix processes bare legacy lines without error');
  } catch (err: any) {
    assert(false, '6.1 segmentSubtitlesNetflix processes bare legacy lines without error', err.message);
  }

  // Verify Netflix constraints hold on the segmented output
  let allLinesUnder37 = true;
  let allBlocksUnder2Lines = true;
  for (const block of segmentedBare) {
    const lines = block.text.split('\n');
    if (lines.length > 2) allBlocksUnder2Lines = false;
    for (const l of lines) {
      if (l.length > 37) allLinesUnder37 = false;
    }
  }
  assert(allLinesUnder37, '6.2 All segmented lines adhere to Netflix <= 37 char limit');
  assert(allBlocksUnder2Lines, '6.3 All segmented blocks adhere to Netflix <= 2 lines limit');

  // 6.2: calculateCps safety on bare lines
  let cpsValid = true;
  for (const line of segmentedBare) {
    const cps = calculateCps(line);
    if (!Number.isFinite(cps) || cps < 0) cpsValid = false;
  }
  assert(cpsValid, '6.4 calculateCps returns valid finite numbers for all bare lines');

  // 6.3: splitLineSmart safety on bare lines
  try {
    const splitRes = splitLineSmart(bareLines[0]);
    assert(splitRes.line1.text.length > 0 && splitRes.line2.text.length > 0, '6.5 splitLineSmart splits bare legacy line safely');
    assert(splitRes.line1.speaker === undefined && splitRes.line2.speaker === undefined, '6.6 splitLineSmart preserves undefined speaker safely');
  } catch (err: any) {
    assert(false, '6.5 splitLineSmart splits bare legacy line safely', err.message);
  }

  // =========================================================================
  // Clean up store temp directories
  // =========================================================================
  try {
    fs.rmSync(tempTasksDir, { recursive: true, force: true });
    fs.rmSync(tempSettingsDir, { recursive: true, force: true });
  } catch {}

  // =========================================================================
  // SUMMARY REPORT
  // =========================================================================
  console.log('\n========================================================================');
  console.log('CHALLENGER 2 EMPIRICAL VERIFICATION SUMMARY:');
  console.log(`  Total Assertions Checked: ${totalAssertions}`);
  console.log(`  Passed:                   ${passedAssertions}`);
  console.log(`  Failed:                   ${failureList.length}`);
  console.log('========================================================================\n');

  if (failureList.length > 0) {
    console.error('FAILURES DETECTED:');
    failureList.forEach((f) => console.error(f));
    process.exit(1);
  } else {
    console.log('🎉 ALL BACKWARD COMPATIBILITY & DATA INTEGRITY ASSERTIONS PASSED (100%)!');
    process.exit(0);
  }
}

runEmpiricalSuite().catch((err) => {
  console.error('Unhandled suite exception:', err);
  process.exit(1);
});
