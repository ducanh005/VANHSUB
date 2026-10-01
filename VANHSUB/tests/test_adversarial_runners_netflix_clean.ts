import fs from 'fs';
import path from 'path';
import assert from 'assert';

function runNetflixCleanlinessAudit() {
  console.log('=== ADVERSARIAL AUDIT: VERIFY ZERO NETFLIX SLICING IN ASR RUNNERS ===\n');

  const taskRunnerPath = path.join(__dirname, '..', 'main', 'asr', 'taskRunner.ts');
  const hybridRunnerPath = path.join(__dirname, '..', 'main', 'asr', 'hybridRunner.ts');
  const enginePath = path.join(__dirname, '..', 'main', 'asr', 'fasterWhisperEngine.ts');
  const wordSegmenterPath = path.join(__dirname, '..', 'main', 'asr', 'wordSegmenter.ts');
  const pythonServerPath = path.join(__dirname, '..', 'main', 'asr', 'python', 'faster_whisper_server.py');

  const taskRunnerContent = fs.readFileSync(taskRunnerPath, 'utf-8');
  const hybridRunnerContent = fs.readFileSync(hybridRunnerPath, 'utf-8');
  const engineContent = fs.readFileSync(enginePath, 'utf-8');
  const wordSegmenterContent = fs.readFileSync(wordSegmenterPath, 'utf-8');
  const pythonServerContent = fs.readFileSync(pythonServerPath, 'utf-8');

  // Check 1: taskRunner.ts MUST NOT mention segmentSubtitlesNetflix
  console.log('[Audit 1] Checking main/asr/taskRunner.ts for segmentSubtitlesNetflix...');
  assert.ok(
    !taskRunnerContent.includes('segmentSubtitlesNetflix'),
    'CRITICAL VULNERABILITY: main/asr/taskRunner.ts contains segmentSubtitlesNetflix!'
  );
  console.log('  -> PASS: taskRunner.ts is clean of segmentSubtitlesNetflix.');

  // Check 2: hybridRunner.ts MUST NOT mention segmentSubtitlesNetflix
  console.log('[Audit 2] Checking main/asr/hybridRunner.ts for segmentSubtitlesNetflix...');
  assert.ok(
    !hybridRunnerContent.includes('segmentSubtitlesNetflix'),
    'CRITICAL VULNERABILITY: main/asr/hybridRunner.ts contains segmentSubtitlesNetflix!'
  );
  console.log('  -> PASS: hybridRunner.ts is clean of segmentSubtitlesNetflix.');

  // Check 3: fasterWhisperEngine.ts MUST NOT mention segmentSubtitlesNetflix
  console.log('[Audit 3] Checking main/asr/fasterWhisperEngine.ts for segmentSubtitlesNetflix...');
  assert.ok(
    !engineContent.includes('segmentSubtitlesNetflix'),
    'CRITICAL VULNERABILITY: main/asr/fasterWhisperEngine.ts contains segmentSubtitlesNetflix!'
  );
  console.log('  -> PASS: fasterWhisperEngine.ts is clean of segmentSubtitlesNetflix.');

  // Check 4: wordSegmenter.ts MUST NOT inject minGapMs or synthetic gaps
  console.log('[Audit 4] Checking main/asr/wordSegmenter.ts for artificial minGapMs / phonetic duration calculation...');
  assert.ok(
    !wordSegmenterContent.includes('minGapMs'),
    'CRITICAL VULNERABILITY: wordSegmenter.ts contains artificial minGapMs!'
  );
  assert.ok(
    !wordSegmenterContent.includes('calculatePhoneticDuration'),
    'CRITICAL VULNERABILITY: wordSegmenter.ts estimates phonetic durations instead of acoustic timestamps!'
  );
  console.log('  -> PASS: wordSegmenter.ts relies strictly on acoustic word timestamps.');

  // Check 5: faster_whisper_server.py MUST NOT inject minGapMs or synthetic gaps
  console.log('[Audit 5] Checking main/asr/python/faster_whisper_server.py for synthetic gap injection...');
  assert.ok(
    !pythonServerContent.includes('minGapMs'),
    'CRITICAL VULNERABILITY: faster_whisper_server.py contains minGapMs!'
  );
  console.log('  -> PASS: faster_whisper_server.py preserves 100% true acoustic timestamps.');

  console.log('\n=============================================================');
  console.log('=== AUDIT COMPLETE: ALL 5 ASR NETFLIX CLEAN CHECKS PASSED ===');
  console.log('=============================================================\n');
}

runNetflixCleanlinessAudit();
