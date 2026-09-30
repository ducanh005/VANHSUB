import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseSrt, serializeSrt, formatMs, parseTimecode, type SrtLine } from '../main/lib/srt';
import {
  resolvePythonExecutable,
  checkPythonExecutable,
  probePythonEnv,
  checkFasterWhisperAvailable,
} from '../main/lib/pythonEnv';
import { transcribeUnified } from '../main/asr/asrRouter';
import { CancelledError, isCancelledError } from '../main/lib/cancel';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  finding?: string;
  error?: string;
}

const results: TestResult[] = [];

function recordPass(suite: string, name: string) {
  console.log(`  [PASS] ${name}`);
  results.push({ suite, name, passed: true });
}

function recordFail(suite: string, name: string, finding: string, error?: any) {
  console.error(`  [FAIL] ${name}: ${finding}`);
  results.push({
    suite,
    name,
    passed: false,
    finding,
    error: error?.message || String(error),
  });
}

function createSyntheticWav(filePath: string, durationSec = 1.0): string {
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);

  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.round(Math.sin(2 * Math.PI * 440 * t) * 8000);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function runAdversarialSuite() {
  console.log('================================================================');
  console.log('ADVERSARIAL STRESS TEST SUITE: MILESTONE 1 (CHALLENGER 1)');
  console.log('================================================================\n');

  const tempDir = path.join(os.tmpdir(), `challenger_m1_test_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  // =========================================================================
  // SUITE 1: SRT PARSER & SERIALIZER ADVERSARIAL STRESS
  // =========================================================================
  console.log('--- SUITE 1: SRT Parsing & Serializing Adversarial Tests ---');

  // Test 1.1: Malformed and boundary SRT input
  try {
    const malformedSrt = `
\r\n\r\n
1
bad-timecode-here
Invalid timecode line

2
00:00:01,000 --> 00:00:03,000
Line with valid time

3
00:00:04,000 -->
Missing end time

4
--> 00:00:06,000
Missing start time

5
00:00:07,000 --> 00:00:09,000

`;
    const parsed = parseSrt(malformedSrt);
    // Should parse block 2 (Line with valid time) and block 5 (empty text) without throwing
    if (parsed.length >= 1 && parsed[0].text === 'Line with valid time') {
      recordPass('SRT', '1.1 Malformed timecode recovery (skips bad blocks without throwing)');
    } else {
      recordFail('SRT', '1.1 Malformed timecode recovery', `Expected 1+ valid block, got ${parsed.length}`);
    }
  } catch (err: any) {
    recordFail('SRT', '1.1 Malformed timecode recovery', 'Threw unhandled exception', err);
  }

  // Test 1.2: Multiple colons in text and speaker
  try {
    const multiColonSrt = `1
00:00:01,000 --> 00:00:03,000
[SPEAKER_01]: Title: Subtitle: Detail: Key: Value

2
00:00:04,000 --> 00:00:06,000
[SPEAKER_02]: 10:30:45 AM - Ratio 16:9 - Score: 10:10
`;
    const parsed = parseSrt(multiColonSrt);
    const roundtrip = serializeSrt(parsed);
    const reParsed = parseSrt(roundtrip);

    const match1 =
      parsed[0]?.speaker === 'SPEAKER_01' &&
      parsed[0]?.text === 'Title: Subtitle: Detail: Key: Value' &&
      reParsed[0]?.speaker === 'SPEAKER_01' &&
      reParsed[0]?.text === 'Title: Subtitle: Detail: Key: Value';

    const match2 =
      parsed[1]?.speaker === 'SPEAKER_02' &&
      parsed[1]?.text === '10:30:45 AM - Ratio 16:9 - Score: 10:10' &&
      reParsed[1]?.speaker === 'SPEAKER_02' &&
      reParsed[1]?.text === '10:30:45 AM - Ratio 16:9 - Score: 10:10';

    if (match1 && match2) {
      recordPass('SRT', '1.2 Multiple colons in text content (preserved accurately through roundtrip)');
    } else {
      recordFail('SRT', '1.2 Multiple colons in text content', `Text corrupted: "${parsed[0]?.text}"`);
    }
  } catch (err: any) {
    recordFail('SRT', '1.2 Multiple colons in text content', 'Threw unhandled exception', err);
  }

  // Test 1.3: Nested brackets and bracket corruption
  try {
    const nestedBracketSrt = `1
00:00:01,000 --> 00:00:02,000
[[SPEAKER_00]]: Double bracketed speaker

2
00:00:02,500 --> 00:00:04,000
[SPEAKER_01]: [SOUND EFFECT]: Loud thunder

3
00:00:04,500 --> 00:00:06,000
[SPEAKER_02 [NESTED]]: Bracket inside bracket

4
00:00:06,500 --> 00:00:08,000
[   ]: Whitespace speaker tag
`;
    const parsed = parseSrt(nestedBracketSrt);

    // 1: [[SPEAKER_00]] has inner '[' so regex does not treat it as speaker tag; text preserved
    const case1Ok = parsed[0]?.text.includes('[[SPEAKER_00]]') && parsed[0]?.speaker === undefined;
    // 2: Outer [SPEAKER_01] is speaker, [SOUND EFFECT]: Loud thunder is text
    const case2Ok = parsed[1]?.speaker === 'SPEAKER_01' && parsed[1]?.text === '[SOUND EFFECT]: Loud thunder';
    // 3: [SPEAKER_02 [NESTED]] has '[' inside so does not crash, text preserved
    const case3Ok = parsed[2]?.text.includes('[NESTED]') && parsed[2]?.speaker === undefined;
    // 4: [   ] trimmed speaker is empty -> treated as no speaker
    const case4Ok = parsed[3]?.speaker === undefined && parsed[3]?.text === 'Whitespace speaker tag';

    if (case1Ok && case2Ok && case3Ok && case4Ok) {
      recordPass('SRT', '1.3 Nested brackets and corrupted bracket handling (safe fallback)');
    } else {
      recordFail('SRT', '1.3 Nested brackets and corrupted bracket handling', `Cases: 1=${case1Ok}, 2=${case2Ok}, 3=${case3Ok}, 4=${case4Ok}`);
    }
  } catch (err: any) {
    recordFail('SRT', '1.3 Nested brackets and corrupted bracket handling', 'Threw unhandled exception', err);
  }

  // Test 1.4: Special characters and Unicode speaker tags
  try {
    const unicodeSrt = `1
00:00:01,000 --> 00:00:02,000
[Người nói 1]: Xin chào tiếng Việt có dấu

2
00:00:03,000 --> 00:00:04,000
[SPEAKER_01]: Text with symbols #@!$%^&*()_+ and emoji 🇻🇳 🎉
`;
    const parsed = parseSrt(unicodeSrt);

    // Note: [Người nói 1] contains unicode chars not in [A-Za-z0-9_ -]
    // Verify that it doesn't crash, text is preserved
    const case1Ok = parsed[0]?.text.includes('Người nói 1') && parsed[0]?.text.includes('Xin chào');
    const case2Ok = parsed[1]?.speaker === 'SPEAKER_01' && parsed[1]?.text.includes('🇻🇳 🎉');

    if (case1Ok && case2Ok) {
      recordPass('SRT', '1.4 Special characters and Unicode text handling (preserved without crash)');
    } else {
      recordFail('SRT', '1.4 Special characters and Unicode text handling', `Case1=${case1Ok}, Case2=${case2Ok}`);
    }
  } catch (err: any) {
    recordFail('SRT', '1.4 Special characters and Unicode text handling', 'Threw unhandled exception', err);
  }

  // Test 1.5: 150+ Speakers Scalability & Roundtrip
  try {
    const speakerCount = 150;
    const blocks: string[] = [];
    for (let i = 0; i < speakerCount; i++) {
      const spk = `SPEAKER_${String(i).padStart(3, '0')}`;
      const startMs = i * 2000;
      const endMs = startMs + 1800;
      blocks.push(`${i + 1}\n${formatMs(startMs)} --> ${formatMs(endMs)}\n[${spk}]: Subtitle line from speaker ${i}`);
    }
    const hugeSrt = blocks.join('\n\n') + '\n';
    const parsed = parseSrt(hugeSrt);
    const serialized = serializeSrt(parsed);
    const reParsed = parseSrt(serialized);

    const allMatched =
      parsed.length === speakerCount &&
      reParsed.length === speakerCount &&
      parsed.every((p, idx) => p.speaker === `SPEAKER_${String(idx).padStart(3, '0')}`) &&
      reParsed.every((p, idx) => p.speaker === `SPEAKER_${String(idx).padStart(3, '0')}`);

    if (allMatched) {
      recordPass('SRT', `1.5 High-volume speaker scalability (${speakerCount} distinct speakers roundtrip verified)`);
    } else {
      recordFail('SRT', '1.5 High-volume speaker scalability', `Mismatch in parsed ${parsed.length} vs reParsed ${reParsed.length}`);
    }
  } catch (err: any) {
    recordFail('SRT', '1.5 High-volume speaker scalability', 'Threw unhandled exception', err);
  }

  // Test 1.6: Empty lines, whitespace-only content, empty speaker content
  try {
    const emptySrt = '';
    const wsSrt = '   \n\n\t\n  \r\n';
    const emptyParsed = parseSrt(emptySrt);
    const wsParsed = parseSrt(wsSrt);

    const emptyTextSrt = `1\n00:00:01,000 --> 00:00:02,000\n[SPEAKER_00]: \n\n2\n00:00:03,000 --> 00:00:04,000\n\n`;
    const emptyTextParsed = parseSrt(emptyTextSrt);

    const pass =
      emptyParsed.length === 0 &&
      wsParsed.length === 0 &&
      emptyTextParsed.length === 2 &&
      emptyTextParsed[0].speaker === 'SPEAKER_00' &&
      emptyTextParsed[0].text === '' &&
      emptyTextParsed[1].text === '';

    if (pass) {
      recordPass('SRT', '1.6 Empty file, whitespace, and blank subtitle blocks handling');
    } else {
      recordFail('SRT', '1.6 Empty file and blank blocks', `Unexpected length: empty=${emptyParsed.length}, ws=${wsParsed.length}, blocks=${emptyTextParsed.length}`);
    }
  } catch (err: any) {
    recordFail('SRT', '1.6 Empty file, whitespace, and blank subtitle blocks handling', 'Threw unhandled exception', err);
  }

  // Test 1.7: Millisecond Leading Zero Bug Investigation (padMs)
  try {
    // Input with milliseconds < 100: "005" (5ms) and "050" (50ms)
    const testSrt = `1\n00:00:01,005 --> 00:00:02,050\nTesting millisecond precision\n`;
    const parsed = parseSrt(testSrt);
    const actualStart = parsed[0]?.startMs;
    const actualEnd = parsed[0]?.endMs;

    const expectedStart = 1005;
    const expectedEnd = 2050;

    if (actualStart === expectedStart && actualEnd === expectedEnd) {
      recordPass('SRT', '1.7 Millisecond precision under leading zeros');
    } else {
      // Document empirical flaw
      recordFail(
        'SRT',
        '1.7 Millisecond precision bug (padMs corruption)',
        `padMs corrupted leading zero ms: "00:00:01,005" parsed as ${actualStart}ms (expected ${expectedStart}ms, error +${actualStart - expectedStart}ms), "00:00:02,050" parsed as ${actualEnd}ms (expected ${expectedEnd}ms, error +${actualEnd - expectedEnd}ms)`
      );
    }
  } catch (err: any) {
    recordFail('SRT', '1.7 Millisecond precision', 'Threw unhandled exception', err);
  }

  // =========================================================================
  // SUITE 2: PYTHON ENVIRONMENT PROBING ADVERSARIAL STRESS
  // =========================================================================
  console.log('\n--- SUITE 2: Python Environment Probing Adversarial Tests ---');

  // Test 2.1: checkPythonExecutable with non-existent executable
  try {
    const nonExistent = path.join(tempDir, 'does_not_exist_python.exe');
    const ok = await checkPythonExecutable(nonExistent);
    if (!ok) {
      recordPass('PythonEnv', '2.1 checkPythonExecutable with non-existent binary returns false');
    } else {
      recordFail('PythonEnv', '2.1 checkPythonExecutable with non-existent binary', 'Returned true for non-existent path');
    }
  } catch (err: any) {
    recordFail('PythonEnv', '2.1 checkPythonExecutable with non-existent binary', 'Threw unhandled exception', err);
  }

  // Test 2.2: checkPythonExecutable with directory path
  try {
    const dirPath = tempDir;
    const ok = await checkPythonExecutable(dirPath);
    if (!ok) {
      recordPass('PythonEnv', '2.2 checkPythonExecutable with directory path returns false');
    } else {
      recordFail('PythonEnv', '2.2 checkPythonExecutable with directory path', 'Returned true for directory path');
    }
  } catch (err: any) {
    recordFail('PythonEnv', '2.2 checkPythonExecutable with directory path', 'Threw unhandled exception', err);
  }

  // Test 2.3: checkPythonExecutable with 0-byte fake binary
  try {
    const fakeBin = path.join(tempDir, 'fake_python.exe');
    fs.writeFileSync(fakeBin, Buffer.alloc(0));
    const ok = await checkPythonExecutable(fakeBin);
    if (!ok) {
      recordPass('PythonEnv', '2.3 checkPythonExecutable with 0-byte corrupted binary returns false');
    } else {
      recordFail('PythonEnv', '2.3 checkPythonExecutable with 0-byte binary', 'Returned true for 0-byte binary');
    }
  } catch (err: any) {
    recordFail('PythonEnv', '2.3 checkPythonExecutable with 0-byte binary', 'Threw unhandled exception', err);
  }

  // Test 2.4: checkPythonExecutable with non-Python binary (cmd.exe)
  try {
    const cmdBin = 'cmd.exe';
    const ok = await checkPythonExecutable(cmdBin);
    // cmd.exe --version exits with error / doesn't output python version
    if (!ok) {
      recordPass('PythonEnv', '2.4 checkPythonExecutable with non-Python executable (cmd.exe) returns false');
    } else {
      recordFail('PythonEnv', '2.4 checkPythonExecutable with non-Python executable', 'Returned true for cmd.exe');
    }
  } catch (err: any) {
    recordFail('PythonEnv', '2.4 checkPythonExecutable with non-Python executable', 'Threw unhandled exception', err);
  }

  // Test 2.5: checkPythonExecutable timeout resilience on hanging executable
  try {
    // On Windows, 'ping 127.0.0.1 -n 10' hangs for ~10 seconds.
    // checkPythonExecutable has a 3000ms timer and should terminate it and return false.
    const startT = Date.now();
    const ok = await checkPythonExecutable('ping');
    const elapsed = Date.now() - startT;

    // Must return false within ~4500ms
    if (!ok && elapsed <= 5000) {
      recordPass('PythonEnv', `2.5 checkPythonExecutable timeout kill mechanism works (${elapsed}ms <= 5000ms, returned false)`);
    } else {
      recordFail('PythonEnv', '2.5 checkPythonExecutable timeout kill', `Returned ${ok}, elapsed: ${elapsed}ms`);
    }
  } catch (err: any) {
    recordFail('PythonEnv', '2.5 checkPythonExecutable timeout kill', 'Threw unhandled exception', err);
  }

  // Test 2.6: probePythonEnv robustness under invalid python path
  try {
    // Test 2.6A: Non-existent PYTHON_PATH falls back safely to system python
    const nonExistent = path.join(tempDir, 'does_not_exist_python.exe');
    const oldEnv = process.env.PYTHON_PATH;
    process.env.PYTHON_PATH = nonExistent;
    const resolvedFallback = resolvePythonExecutable();
    process.env.PYTHON_PATH = oldEnv;

    const fallbackSafe = resolvedFallback !== nonExistent;

    // Test 2.6B: Existing corrupted script (exiting with code 1) returns defaultInfo safely
    const fakeCorrupt = path.join(tempDir, 'fake_corrupt_python.bat');
    fs.writeFileSync(fakeCorrupt, '@echo off\nexit /b 1');
    process.env.PYTHON_PATH = fakeCorrupt;
    const infoCorrupt = await probePythonEnv();
    process.env.PYTHON_PATH = oldEnv;

    const defaultInfoSafe =
      infoCorrupt.hasTorch === false &&
      infoCorrupt.hasCuda === false &&
      infoCorrupt.hasFasterWhisper === false &&
      infoCorrupt.hasCtranslate2 === false;

    if (fallbackSafe && defaultInfoSafe) {
      recordPass(
        'PythonEnv',
        '2.6 probePythonEnv returns defaultInfo safely when Python executable is corrupted, and falls back when non-existent'
      );
    } else {
      recordFail(
        'PythonEnv',
        '2.6 probePythonEnv invalid executable handling',
        `fallbackSafe=${fallbackSafe}, defaultInfoSafe=${defaultInfoSafe}`
      );
    }
  } catch (err: any) {
    recordFail('PythonEnv', '2.6 probePythonEnv invalid executable', 'Threw unhandled exception', err);
  }

  // Test 2.7: checkFasterWhisperAvailable returns clean reason when modules are missing
  try {
    const avail = await checkFasterWhisperAvailable();
    if (typeof avail.available === 'boolean' && typeof avail.useCuda === 'boolean') {
      if (!avail.available) {
        const hasReason = Boolean(avail.reason && avail.reason.includes('pip install faster-whisper'));
        if (hasReason) {
          recordPass('PythonEnv', '2.7 checkFasterWhisperAvailable returns actionable guidance message');
        } else {
          recordFail('PythonEnv', '2.7 checkFasterWhisperAvailable guidance', `Missing guidance: "${avail.reason}"`);
        }
      } else {
        recordPass('PythonEnv', '2.7 checkFasterWhisperAvailable passed (faster-whisper is installed)');
      }
    } else {
      recordFail('PythonEnv', '2.7 checkFasterWhisperAvailable type check', 'Returned non-boolean properties');
    }
  } catch (err: any) {
    recordFail('PythonEnv', '2.7 checkFasterWhisperAvailable', 'Threw unhandled exception', err);
  }

  // =========================================================================
  // SUITE 3: ASR ROUTER & 2-TIER FALLBACK ADVERSARIAL STRESS
  // =========================================================================
  console.log('\n--- SUITE 3: ASR Router & 2-Tier Fallback Adversarial Tests ---');

  const validWav = path.join(tempDir, 'valid_audio.wav');
  createSyntheticWav(validWav, 1.0);

  // Test 3.1: Missing audio file rejects immediately without fallback
  try {
    const missingAudio = path.join(tempDir, 'non_existent_file.wav');
    let fallbackHit = false;
    let threw = false;
    try {
      await transcribeUnified(missingAudio, {
        asrEngine: 'faster-whisper',
        customFwChecker: async () => ({ available: true, useCuda: false }),
        onProgress: (_p, stage) => {
          if (stage && stage.includes('fallback')) fallbackHit = true;
        },
      });
    } catch (err: any) {
      threw = true;
      if (err.message.includes('Không tìm thấy file audio cần phiên âm')) {
        // Correct
      } else {
        throw err;
      }
    }

    if (threw && !fallbackHit) {
      recordPass('ASRRouter', '3.1 Missing audio throws Error immediately without executing fallback');
    } else {
      recordFail('ASRRouter', '3.1 Missing audio handling', `threw=${threw}, fallbackHit=${fallbackHit}`);
    }
  } catch (err: any) {
    recordFail('ASRRouter', '3.1 Missing audio handling', 'Unexpected error', err);
  }

  // Test 3.2: Corrupted/0-byte audio file handling
  try {
    const corruptWav = path.join(tempDir, 'corrupted_zero_byte.wav');
    fs.writeFileSync(corruptWav, Buffer.alloc(0));

    let threw = false;
    let errMsg = '';
    try {
      await transcribeUnified(corruptWav, {
        asrEngine: 'faster-whisper',
        customFwChecker: async () => ({ available: true, useCuda: false }),
        customFwRunner: async () => {
          throw new Error('CTranslate2 failed to read audio stream');
        },
      });
    } catch (err: any) {
      threw = true;
      errMsg = err.message;
    }

    // Faster-Whisper fails -> falls back to whisper-cpp -> whisper-cpp fails because file is 0-byte
    // The entire call should reject cleanly with an Error rather than an unhandled crash
    if (threw) {
      recordPass('ASRRouter', '3.2 Corrupted 0-byte audio cleanly rejects with error after fallback attempt');
    } else {
      recordFail('ASRRouter', '3.2 Corrupted audio handling', 'Did not reject on 0-byte file');
    }
  } catch (err: any) {
    recordFail('ASRRouter', '3.2 Corrupted audio handling', 'Threw unexpected exception', err);
  }

  // Test 3.3: Mid-stream cancellation during Faster-Whisper MUST NOT trigger fallback
  try {
    let fallbackTriggered = false;
    let receivedCancelledError = false;

    try {
      await transcribeUnified(validWav, {
        asrEngine: 'faster-whisper',
        customFwChecker: async () => ({ available: true, useCuda: false }),
        customFwRunner: async (_audio, opts) => {
          // Simulate user clicking cancel mid-flight
          if (opts.shouldStop?.()) {
            throw new CancelledError();
          }
          throw new CancelledError();
        },
        shouldStop: () => true,
        onProgress: (_p, stage) => {
          if (stage && (stage.includes('fallback') || stage.includes('whisper.cpp'))) {
            fallbackTriggered = true;
          }
        },
      });
    } catch (err: any) {
      if (isCancelledError(err)) {
        receivedCancelledError = true;
      }
    }

    if (receivedCancelledError && !fallbackTriggered) {
      recordPass('ASRRouter', '3.3 Mid-stream cancellation strictly re-throws CancelledError and PREVENTS fallback');
    } else {
      recordFail(
        'ASRRouter',
        '3.3 Mid-stream cancellation anti-fallback guard',
        `receivedCancelledError=${receivedCancelledError}, fallbackTriggered=${fallbackTriggered}`
      );
    }
  } catch (err: any) {
    recordFail('ASRRouter', '3.3 Mid-stream cancellation', 'Threw unhandled exception', err);
  }

  // Test 3.4: Mid-stream cancellation during whisper-cpp fallback execution
  try {
    let cancelled = false;
    let stopped = false;
    try {
      await transcribeUnified(validWav, {
        asrEngine: 'whisper-cpp',
        shouldStop: () => {
          stopped = true;
          return true;
        },
      });
    } catch (err: any) {
      if (isCancelledError(err)) {
        cancelled = true;
      }
    }

    if (cancelled) {
      recordPass('ASRRouter', '3.4 Direct whisper-cpp cancellation terminates and re-throws CancelledError cleanly');
    } else {
      recordFail('ASRRouter', '3.4 Direct whisper-cpp cancellation', `cancelled=${cancelled}, stopped=${stopped}`);
    }
  } catch (err: any) {
    recordFail('ASRRouter', '3.4 Direct whisper-cpp cancellation', 'Threw unhandled exception', err);
  }

  // Test 3.5: Sudden Python crash mid-stream triggers Tier 2 fallback to whisper-cpp
  try {
    let fallbackStageReported = false;
    const res = await transcribeUnified(validWav, {
      asrEngine: 'faster-whisper',
      customFwChecker: async () => ({ available: true, useCuda: false }),
      customFwRunner: async () => {
        // Simulate sidecar crash (SIGSEGV / exit code 139)
        throw new Error('Process terminated unexpectedly with exit code 139 (Segmentation fault)');
      },
      onProgress: (_p, stage) => {
        if (stage && stage.includes('fallback')) {
          fallbackStageReported = true;
        }
      },
    });

    const pass =
      res.engineUsed === 'whisper-cpp' &&
      res.fallbackTriggered === true &&
      fallbackStageReported === true &&
      fs.existsSync(res.srtPath);

    if (pass) {
      recordPass('ASRRouter', '3.5 Sudden sidecar crash triggers Tier 2 fallback to whisper.cpp successfully');
    } else {
      recordFail('ASRRouter', '3.5 Sudden sidecar crash fallback', `res=${JSON.stringify(res)}, reported=${fallbackStageReported}`);
    }
  } catch (err: any) {
    recordFail('ASRRouter', '3.5 Sudden sidecar crash fallback', 'Threw unhandled exception', err);
  }

  // Test 3.6: Pre-flight missing module triggers Tier 1 fallback to whisper-cpp
  try {
    let preflightFallbackReported = false;
    const res = await transcribeUnified(validWav, {
      asrEngine: 'faster-whisper',
      customFwChecker: async () => ({
        available: false,
        useCuda: false,
        reason: 'Package faster-whisper not installed',
      }),
      onProgress: (_p, stage) => {
        if (stage && stage.includes('Faster-Whisper không khả dụng')) {
          preflightFallbackReported = true;
        }
      },
    });

    const pass =
      res.engineUsed === 'whisper-cpp' &&
      res.fallbackTriggered === true &&
      preflightFallbackReported === true &&
      fs.existsSync(res.srtPath);

    if (pass) {
      recordPass('ASRRouter', '3.6 Pre-flight check failure triggers Tier 1 fallback to whisper.cpp successfully');
    } else {
      recordFail('ASRRouter', '3.6 Pre-flight check fallback', `res=${JSON.stringify(res)}, reported=${preflightFallbackReported}`);
    }
  } catch (err: any) {
    recordFail('ASRRouter', '3.6 Pre-flight check fallback', 'Threw unhandled exception', err);
  }

  // Cleanup temp files
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  // =========================================================================
  // SUMMARY REPORT
  // =========================================================================
  console.log('\n================================================================');
  console.log('ADVERSARIAL STRESS TEST SUMMARY:');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`TOTAL: ${total} | PASSED: ${passed} | FAILED: ${failed}`);
  if (failed > 0) {
    console.log('\nFAILED TESTS & VULNERABILITIES FOUND:');
    for (const f of results.filter((r) => !r.passed)) {
      console.log(`- [${f.suite}] ${f.name}`);
      console.log(`  Reason: ${f.finding}`);
      if (f.error) console.log(`  Error: ${f.error}`);
    }
  }
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAdversarialSuite().catch((err) => {
  console.error('[UNCAUGHT TEST RUNNER ERROR]', err);
  process.exit(2);
});
