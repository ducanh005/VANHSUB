/**
 * Adversarial Stress Testing Suite for Milestone 2 (R2)
 * Tests edge cases, boundary conditions, corrupt data, and potential failure modes.
 */
import assert from 'assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  consolidateSubtitleClauses,
  segmentSubtitlesNetflix,
  breakVietnameseLines,
} from '../main/lib/nlpSegmenter';
import {
  groupSubtitlesForTts,
  type SubtitleLine,
  type TTSOptions,
} from '../main/render/ttsEngine';
import {
  mergeAudioFiles,
  runFfmpeg,
} from '../main/render/dubbingEngine';
import type { SrtLine } from '../main/lib/srt';

let testsPassed = 0;
let testsFailed = 0;

function runAdversarialTest(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      return (res as Promise<void>)
        .then(() => {
          testsPassed++;
          console.log(`  ✅ [PASS] ${name}`);
        })
        .catch((err) => {
          testsFailed++;
          console.error(`  ❌ [FAIL] ${name}: ${err.message || err}`);
        });
    } else {
      testsPassed++;
      console.log(`  ✅ [PASS] ${name}`);
      return Promise.resolve();
    }
  } catch (err: any) {
    testsFailed++;
    console.error(`  ❌ [FAIL] ${name}: ${err.message || err}`);
    return Promise.resolve();
  }
}

async function run() {
  console.log('================================================================');
  console.log('⚔️ ADVERSARIAL STRESS TESTS: MILESTONE 2 (R2)');
  console.log('================================================================\n');

  // --- Category 1: consolidateSubtitleClauses Edge Cases ---
  console.log('--- Category 1: consolidateSubtitleClauses Boundary & Robustness ---');

  await runAdversarialTest('ADV-1.1: Empty and nullish inputs', () => {
    assert.deepStrictEqual(consolidateSubtitleClauses([]), []);
    assert.deepStrictEqual(consolidateSubtitleClauses(null as any), []);
    assert.deepStrictEqual(consolidateSubtitleClauses(undefined as any), []);
  });

  await runAdversarialTest('ADV-1.2: Lines with empty, whitespace, or undefined text', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2000, text: '' },
      { id: '2', startMs: 2100, endMs: 3000, text: '   ' },
      { id: '3', startMs: 3100, endMs: 4000, text: undefined as any },
    ];
    const res = consolidateSubtitleClauses(lines);
    assert.ok(Array.isArray(res));
  });

  await runAdversarialTest('ADV-1.3: Non-spaced continuous string exceeding maxCharsPerLine', () => {
    const longToken = 'A'.repeat(80);
    const lines: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 3000, text: longToken }];
    const res = consolidateSubtitleClauses(lines);
    assert.ok(res.length >= 1);
  });

  await runAdversarialTest('ADV-1.4: Inverted timecode (startMs > endMs) in input line', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 3000, endMs: 2000, text: 'Vế trước,' },
      { id: '2', startMs: 2500, endMs: 4000, text: 'vế sau.' },
    ];
    const res = consolidateSubtitleClauses(lines);
    assert.ok(Array.isArray(res));
  });

  await runAdversarialTest('ADV-1.5: 50 consecutive unfinished short clauses (< 37 chars each)', () => {
    const lines: SrtLine[] = [];
    for (let i = 0; i < 50; i++) {
      lines.push({
        id: `line-${i}`,
        startMs: i * 1000,
        endMs: i * 1000 + 800,
        text: `vế thứ ${i},`,
      });
    }
    const res = consolidateSubtitleClauses(lines);
    // Should group pairs or triplets without exceeding 2 lines <= 37 chars
    for (const b of res) {
      const subLines = b.text.split('\n');
      assert.ok(subLines.length <= 2, `Block has >2 lines: ${subLines.length}`);
      for (const l of subLines) {
        assert.ok(l.length <= 37, `Line exceeds 37 chars: ${l.length}`);
      }
    }
  });

  await runAdversarialTest('ADV-1.6: Short duration (<100ms) with text requiring decomposition', () => {
    const longText = 'Đây là một câu rất dài nhằm kiểm tra xem khi thời lượng tổng thể quá ngắn thì hàm có sinh ra timecode đơn điệu hay không.';
    const lines: SrtLine[] = [{ id: '1', startMs: 1000, endMs: 1050, text: longText }];
    const res = consolidateSubtitleClauses(lines);
    assert.ok(res.length >= 1);
    for (const b of res) {
      // Check startMs vs endMs
      console.log(`       [Chunk]: startMs=${b.startMs}, endMs=${b.endMs}`);
      assert.ok(b.startMs <= b.endMs, `startMs (${b.startMs}) must be <= endMs (${b.endMs})`);
    }
  });

  // --- Category 2: groupSubtitlesForTts Edge Cases ---
  console.log('\n--- Category 2: groupSubtitlesForTts Adversarial Attacks ---');

  await runAdversarialTest('ADV-2.1: Empty and null inputs', () => {
    assert.deepStrictEqual(groupSubtitlesForTts([]), []);
    assert.deepStrictEqual(groupSubtitlesForTts(null as any), []);
  });

  await runAdversarialTest('ADV-2.2: Terminal punctuation followed by closing quotation marks / brackets', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '0', endTime: '1', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Anh ấy nói: "Tôi đồng ý!"' },
      { index: 2, startTime: '1', endTime: '2', startMs: 2050, endMs: 3000, durationMs: 950, text: 'Rồi anh ấy rời đi.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2, 'Closing quote after exclamation mark must be recognized as terminal');
  });

  await runAdversarialTest('ADV-2.3: Terminal punctuation with ellipsis ... and unicode …', () => {
    const subs1: SubtitleLine[] = [
      { index: 1, startTime: '0', endTime: '1', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Chuyện này thật là...' },
      { index: 2, startTime: '1', endTime: '2', startMs: 2050, endMs: 3000, durationMs: 950, text: 'không thể tin được.' },
    ];
    const groups1 = groupSubtitlesForTts(subs1);
    assert.strictEqual(groups1.length, 2, 'Three dots ... must terminate sentence group');

    const subs2: SubtitleLine[] = [
      { index: 1, startTime: '0', endTime: '1', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Chuyện này thật là…' },
      { index: 2, startTime: '1', endTime: '2', startMs: 2050, endMs: 3000, durationMs: 950, text: 'không thể tin được.' },
    ];
    const groups2 = groupSubtitlesForTts(subs2);
    assert.strictEqual(groups2.length, 2, 'Single unicode ellipsis … must terminate sentence group');
  });

  await runAdversarialTest('ADV-2.4: Speaker diarization boundaries', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '0', endTime: '1', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Xin chào,', speaker: 'SPEAKER_00' },
      { index: 2, startTime: '1', endTime: '2', startMs: 2050, endMs: 3000, durationMs: 950, text: 'chào bạn!', speaker: 'SPEAKER_01' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2, 'Different speaker must terminate group');
  });

  await runAdversarialTest('ADV-2.5: Zero and negative gap between clauses (overlapping timecodes)', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '0', endTime: '2', startMs: 1000, endMs: 2500, durationMs: 1500, text: 'Đoạn đầu,' },
      { index: 2, startTime: '1', endTime: '3', startMs: 2400, endMs: 4000, durationMs: 1600, text: 'đoạn sau.' }, // gap = -100ms
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1, 'Overlapping clauses without terminal punctuation should merge into 1 group');
  });

  // --- Category 3: Audio Muxing & Dubbing Engine Adversarial Attacks ---
  console.log('\n--- Category 3: dubbingEngine Adversarial Attacks ---');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_adv_critic_'));

  try {
    const ttsDir = path.join(tempDir, 'tts');
    fs.mkdirSync(ttsDir, { recursive: true });

    await runAdversarialTest('ADV-3.1: Corrupted / invalid JSON in manifest.json triggers graceful fallback', async () => {
      const srtPath = path.join(tempDir, 'corrupt_manifest.srt');
      fs.writeFileSync(srtPath, `1\n00:00:01,000 --> 00:00:02,000\ncâu một,\n\n2\n00:00:02,050 --> 00:00:03,500\ncâu hai.\n`, 'utf-8');

      // Write corrupt manifest
      fs.writeFileSync(path.join(ttsDir, 'manifest.json'), '{ invalid json text !!!', 'utf-8');

      // Create audio for 1
      await runFfmpeg([
        '-f', 'lavfi', '-i', 'sine=frequency=400:duration=2.0',
        '-c:a', 'libmp3lame', '-y', path.join(ttsDir, 'subtitle_0001.mp3'),
      ]);

      const outMp3 = path.join(tempDir, 'corrupt_manifest_out.mp3');
      const res = await mergeAudioFiles(srtPath, ttsDir, outMp3, undefined, { mode: 'flexible' });
      assert.ok(fs.existsSync(res.audioPath));
    });

    await runAdversarialTest('ADV-3.2: Manifest has orphan member whose leader does not exist', async () => {
      const srtPath = path.join(tempDir, 'orphan_member.srt');
      fs.writeFileSync(srtPath, `1\n00:00:01,000 --> 00:00:02,000\ncâu một\n\n2\n00:00:02,050 --> 00:00:03,500\ncâu hai\n`, 'utf-8');

      const orphanManifest = {
        '2': {
          voice: 'BV074_streaming',
          speed: 1.0,
          text: 'câu hai',
          engine: 'tiktok',
          isGroupMember: true,
          leaderIndex: 999, // Leader does not exist!
        },
      };
      fs.writeFileSync(path.join(ttsDir, 'manifest.json'), JSON.stringify(orphanManifest), 'utf-8');

      // Keep the audio inside its one-second source turn so this test isolates
      // malformed manifest recovery from the independent duration guard.
      await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=400:duration=0.8',
        '-c:a', 'libmp3lame', '-y', path.join(ttsDir, 'subtitle_0001.mp3')]);

      const outMp3 = path.join(tempDir, 'orphan_out.mp3');
      const res = await mergeAudioFiles(srtPath, ttsDir, outMp3, undefined, { mode: 'flexible' });
      assert.ok(fs.existsSync(res.audioPath));
    });

    await runAdversarialTest('ADV-3.3: Missing audio file for group leader fails explicitly', async () => {
      const srtPath = path.join(tempDir, 'missing_audio.srt');
      fs.writeFileSync(srtPath, `1\n00:00:01,000 --> 00:00:03,000\ncâu không có audio\n`, 'utf-8');

      const emptyTtsDir = path.join(tempDir, 'tts_empty');
      fs.mkdirSync(emptyTtsDir, { recursive: true });

      const outMp3 = path.join(tempDir, 'missing_audio_out.mp3');
      await assert.rejects(() => mergeAudioFiles(srtPath, emptyTtsDir, outMp3, undefined,
        { mode: 'flexible' }), /Dubbing missing audio at subtitle 1/);
      assert.ok(!fs.existsSync(outMp3));
    });

  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  }

  console.log('\n================================================================');
  console.log(`📊 ADVERSARIAL STRESS TESTS SUMMARY:`);
  console.log(`   Passed: ${testsPassed} ✅`);
  console.log(`   Failed: ${testsFailed} ❌`);
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal adversarial error:', err);
  process.exit(1);
});
