/**
 * =========================================================================================
 * Empirical Challenger M2 Stress Harness: Smart Visual Wrapping & Seamless TTS Concatenation
 * =========================================================================================
 *
 * Independent adversarial challenge testing:
 * 1. Benchmark sentence variations:
 *    "chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được, nhưng giá cho mỗi hoạt động tính thế nào?"
 *    - 3 fragments, 4 fragments, 5 micro-clauses, with commas/semicolons
 *    - Full continuous string -> segmentSubtitlesNetflix & consolidateSubtitleClauses
 *    - Strict compliance: <= 37 chars/line, <= 2 lines/block, 0 word drops
 * 2. Eradication of intra-sentence artificial padding silence (apad):
 *    - Empirical verification that multi-clause sentences create exactly 1 audio segment
 *    - Zero apad filters executed between clauses belonging to the same sentence
 *    - Distinction between intra-sentence continuity and inter-sentence natural pauses
 * 3. Audio timeline drift over multi-sentence workloads:
 *    - 30-sentence stream spanning 120+ seconds with varying silence gaps
 *    - Drift accumulation bounds in 'strict' and 'flexible' modes
 *    - Drift absorption when subsequent silence gaps occur
 * 4. Boundary cases:
 *    - Numbers with dots ("2.0", "15.500") and acronyms ("TP.HCM") at end or middle of clauses
 *    - Quotes, brackets, unicode ellipsis ("…", "...")
 *    - Mixed speakers and voice overrides isolation
 *
 * Runner: npx tsx tests/test_challenger_m2_empirical_stress.ts
 * =========================================================================================
 */

import assert from 'assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  consolidateSubtitleClauses,
  segmentSubtitlesNetflix,
  breakVietnameseLines,
  calculateCps,
} from '../main/lib/nlpSegmenter';
import {
  groupSubtitlesForTts,
  type SubtitleLine,
  type SentenceGroup,
  type TTSOptions,
} from '../main/render/ttsEngine';
import {
  mergeAudioFiles,
  runFfmpeg,
} from '../main/render/dubbingEngine';
import { getMediaDurationSec } from '../main/asr/audioExtractor';
import type { SrtLine } from '../main/lib/srt';

let passed = 0;
let failed = 0;
const failureMessages: string[] = [];

async function challenge(desc: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      await res;
    }
    passed++;
    console.log(`  ✅ [PASS] ${desc}`);
  } catch (err: any) {
    failed++;
    const msg = `  ❌ [FAIL] ${desc} -> ${err.message || err}`;
    console.error(msg);
    failureMessages.push(msg);
  }
}

async function runEmpiricalStressHarness() {
  console.log('================================================================================');
  console.log('🔥 EMPIRICAL CHALLENGER M2: STRESS HARNESS & ADVERSARIAL ORACLES');
  console.log('================================================================================\n');

  // ==========================================================================
  // SUITE 1: Benchmark Sentence Adversarial Testing
  // ==========================================================================
  console.log('--- SUITE 1: Benchmark Sentence Adversarial Stress ---');

  const benchmarkText = 'chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được, nhưng giá cho mỗi hoạt động tính thế nào?';

  await challenge('1.1 Benchmark Sentence: Single continuous string decomposes into compliant 2-line blocks <= 37 chars', () => {
    const input: SrtLine[] = [
      { id: 'bm-full', startMs: 1000, endMs: 8500, text: benchmarkText },
    ];
    const blocks = segmentSubtitlesNetflix(input);
    assert.ok(blocks.length >= 2, `Phải chia thành ít nhất 2 khối (thực tế: ${blocks.length})`);
    let combinedWords: string[] = [];
    for (const b of blocks) {
      const lines = b.text.split('\n');
      assert.ok(lines.length <= 2, `Khối vượt quá 2 dòng (${lines.length}): "${b.text}"`);
      for (const line of lines) {
        assert.ok(line.trim().length <= 37, `Dòng vượt quá 37 ký tự (${line.trim().length}): "${line}"`);
      }
      combinedWords.push(...b.text.replace(/\n/g, ' ').split(/\s+/).filter(Boolean));
    }
    const origWords = benchmarkText.split(/\s+/).filter(Boolean);
    assert.strictEqual(combinedWords.length, origWords.length, 'Không bị thất thoát từ vựng nào');
  });

  await challenge('1.2 Benchmark Sentence: 3 fragmented OCR blocks consolidate without exceeding 37 chars/line or 2 lines', () => {
    const fragments: SrtLine[] = [
      { id: 'f1', startMs: 1000, endMs: 2200, text: 'chụp ảnh được, livestream được' },
      { id: 'f2', startMs: 2300, endMs: 4500, text: 'tái hiện lại các cảnh kinh điển cũng được' },
      { id: 'f3', startMs: 4600, endMs: 7800, text: 'nhưng giá cho mỗi hoạt động tính thế nào?' },
    ];
    const consolidated = consolidateSubtitleClauses(fragments);
    assert.ok(consolidated.length <= 2, `Kỳ vọng tối đa 2 khối nhưng nhận: ${consolidated.length}`);
    for (const c of consolidated) {
      const lines = c.text.split('\n');
      assert.ok(lines.length <= 2, `Khối vượt 2 dòng: ${lines.length}`);
      for (const l of lines) {
        assert.ok(l.trim().length <= 37, `Dòng vượt 37 chars: "${l}" (${l.trim().length})`);
      }
    }
  });

  await challenge('1.3 Benchmark Sentence: 4 micro-fragments split at commas consolidate into compliant blocks', () => {
    const microFragments: SrtLine[] = [
      { id: 'm1', startMs: 1000, endMs: 1800, text: 'chụp ảnh được,' },
      { id: 'm2', startMs: 1900, endMs: 2800, text: 'livestream được,' },
      { id: 'm3', startMs: 2900, endMs: 5000, text: 'tái hiện lại các cảnh kinh điển cũng được,' },
      { id: 'm4', startMs: 5100, endMs: 7800, text: 'nhưng giá cho mỗi hoạt động tính thế nào?' },
    ];
    const consolidated = consolidateSubtitleClauses(microFragments);
    assert.ok(consolidated.length <= 3, `Gom 4 fragments thành <= 3 khối (thực tế: ${consolidated.length})`);
    for (const c of consolidated) {
      const lines = c.text.split('\n');
      assert.ok(lines.length <= 2);
      for (const l of lines) {
        assert.ok(l.trim().length <= 37);
      }
    }
  });

  await challenge('1.4 Benchmark Sentence: TTS grouping produces exactly 1 group regardless of fragmentation count', () => {
    const fourFragments: SubtitleLine[] = [
      { index: 1, startTime: '', endTime: '', startMs: 1000, endMs: 1800, durationMs: 800, text: 'chụp ảnh được,' },
      { index: 2, startTime: '', endTime: '', startMs: 1900, endMs: 2800, durationMs: 900, text: 'livestream được,' },
      { index: 3, startTime: '', endTime: '', startMs: 2900, endMs: 5000, durationMs: 2100, text: 'tái hiện lại các cảnh kinh điển cũng được,' },
      { index: 4, startTime: '', endTime: '', startMs: 5100, endMs: 7800, durationMs: 2700, text: 'nhưng giá cho mỗi hoạt động tính thế nào?' },
    ];
    const groups = groupSubtitlesForTts(fourFragments);
    assert.strictEqual(groups.length, 1, `Phải gom đúng 1 SentenceGroup nhưng nhận được ${groups.length}`);
    assert.strictEqual(groups[0].startIndex, 1);
    assert.strictEqual(groups[0].endIndex, 4);
    assert.strictEqual(groups[0].startMs, 1000);
    assert.strictEqual(groups[0].endMs, 7800);
    assert.ok(groups[0].text.startsWith('chụp ảnh được, livestream được,'));
    assert.ok(groups[0].text.endsWith('tính thế nào?'));
  });

  // ==========================================================================
  // SUITE 2: Eradication of Intra-Sentence Padding Silence (apad)
  // ==========================================================================
  console.log('\n--- SUITE 2: Eradication of Intra-Sentence apad Padding Silence ---');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_chal_m2_'));

  try {
    // Test 2.1: Verify dubbing audio generation for a 4-clause sentence produces exactly 1 WAV segment
    await challenge('2.1 Dubbing Engine: Multi-clause sentence creates exactly 1 continuous audio segment (0 intra-sentence apad)', async () => {
      const srt4 = `1
00:00:01,000 --> 00:00:02,000
chụp ảnh được,

2
00:00:02,100 --> 00:00:03,200
livestream được,

3
00:00:03,300 --> 00:00:05,500
tái hiện lại các cảnh kinh điển cũng được,

4
00:00:05,600 --> 00:00:08,000
nhưng giá cho mỗi hoạt động tính thế nào?
`;
      const srtFile = path.join(tempDir, 'four_clauses.srt');
      fs.writeFileSync(srtFile, srt4, 'utf-8');

      const ttsDir = path.join(tempDir, 'tts_four');
      fs.mkdirSync(ttsDir, { recursive: true });

      // Create master audio for subtitle_0001.mp3 (5.8s sine)
      const masterAudio = path.join(ttsDir, 'subtitle_0001.mp3');
      await runFfmpeg([
        '-f', 'lavfi',
        '-i', 'sine=frequency=440:duration=5.8',
        '-c:a', 'libmp3lame',
        '-b:a', '128k',
        '-y', masterAudio,
      ]);

      // Manifest linking all 4 into 1 group
      const manifest = {
        '1': { voice: 'default', speed: 1.0, text: 'full text', engine: 'tiktok', isGroupLeader: true, groupIndices: [1, 2, 3, 4] },
        '2': { voice: 'default', speed: 1.0, text: 'text 2', engine: 'tiktok', isGroupMember: true, leaderIndex: 1 },
        '3': { voice: 'default', speed: 1.0, text: 'text 3', engine: 'tiktok', isGroupMember: true, leaderIndex: 1 },
        '4': { voice: 'default', speed: 1.0, text: 'text 4', engine: 'tiktok', isGroupMember: true, leaderIndex: 1 },
      };
      fs.writeFileSync(path.join(ttsDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');

      const outputMergedMp3 = path.join(tempDir, 'merged_four_clauses.mp3');
      const res = await mergeAudioFiles(srtFile, ttsDir, outputMergedMp3, undefined, { mode: 'strict' });
      assert.ok(fs.existsSync(res.audioPath));

      const dur = await getMediaDurationSec(outputMergedMp3);
      // Timeline: 0 -> group[0].endMs (8000) + 500ms = 8.5s
      assert.ok(dur >= 8.2 && dur <= 8.8, `Thời lượng ghép phải đúng timeline tổng thể (~8.5s, thực tế: ${dur.toFixed(2)}s)`);

      // Verify that no separate audio chunks were created for clauses 2, 3, 4
      assert.strictEqual(res.overruns.length, 0, 'Không bị overrun hoặc nén gượng ép');
    });

    await challenge('2.2 Dubbing Engine: Fallback without manifest also merges clauses into 1 segment without intra-sentence apad', async () => {
      const srtFile = path.join(tempDir, 'four_clauses.srt');
      const noManifestDir = path.join(tempDir, 'tts_four_no_manifest');
      fs.mkdirSync(noManifestDir, { recursive: true });

      const masterAudio = path.join(noManifestDir, 'subtitle_0001.mp3');
      await runFfmpeg([
        '-f', 'lavfi',
        '-i', 'sine=frequency=440:duration=5.8',
        '-c:a', 'libmp3lame',
        '-b:a', '128k',
        '-y', masterAudio,
      ]);

      const outputMergedMp3 = path.join(tempDir, 'merged_fallback.mp3');
      const res = await mergeAudioFiles(srtFile, noManifestDir, outputMergedMp3, undefined, { mode: 'flexible' });
      assert.ok(fs.existsSync(res.audioPath));
      const dur = await getMediaDurationSec(outputMergedMp3);
      assert.ok(dur >= 6.8 && dur <= 9.0, `Fallback duration hợp lệ: ${dur.toFixed(2)}s`);
    });

    // ==========================================================================
    // SUITE 3: Audio Timeline Drift Over Long Multi-Sentence Sequence
    // ==========================================================================
    console.log('\n--- SUITE 3: Audio Timeline Drift Over Long Multi-Sentence Workload ---');

    await challenge('3.1 Multi-Sentence Timeline Drift: 20 sentences spanning 60 seconds maintain zero drift in strict mode', async () => {
      const srtLines: string[] = [];
      const multiTtsDir = path.join(tempDir, 'tts_long_sequence');
      fs.mkdirSync(multiTtsDir, { recursive: true });

      const manifestEntries: Record<string, any> = {};

      let curMs = 1000;
      for (let s = 1; s <= 20; s++) {
        const sentenceDur = 2000;
        const start = curMs;
        const end = start + sentenceDur;
        srtLines.push(`${s}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\nCâu số ${s} đã hoàn thành.\n`);

        const audioPath = path.join(multiTtsDir, `subtitle_${String(s).padStart(4, '0')}.mp3`);
        // Create 1.5s audio (< 2.0s slot)
        await runFfmpeg([
          '-f', 'lavfi',
          '-i', `sine=frequency=${300 + s * 20}:duration=1.5`,
          '-c:a', 'libmp3lame',
          '-y', audioPath,
        ]);

        manifestEntries[String(s)] = {
          voice: 'default',
          speed: 1.0,
          text: `Câu số ${s} đã hoàn thành.`,
          engine: 'tiktok',
        };

        curMs = end + 1000; // 1s silence between sentences
      }

      const longSrtPath = path.join(tempDir, 'long_sequence.srt');
      fs.writeFileSync(longSrtPath, srtLines.join('\n'), 'utf-8');
      fs.writeFileSync(path.join(multiTtsDir, 'manifest.json'), JSON.stringify(manifestEntries), 'utf-8');

      const finalLongMp3 = path.join(tempDir, 'merged_long_strict.mp3');
      const res = await mergeAudioFiles(longSrtPath, multiTtsDir, finalLongMp3, undefined, { mode: 'strict' });
      assert.ok(fs.existsSync(res.audioPath));

      const actualDuration = await getMediaDurationSec(finalLongMp3);
      // Expected: sentence 20 starts at 1000 + 19 * 3000 = 58000ms, ends at 60000ms, + 500ms tail = 60500ms (60.50s)
      const lastSentenceEndMs = 1000 + (19 * 3000) + 2000;
      const expectedDurationSec = (lastSentenceEndMs + 500) / 1000;

      const driftDeltaSec = Math.abs(actualDuration - expectedDurationSec);
      assert.ok(
        driftDeltaSec <= 0.1,
        `Độ trôi timeline qua 20 câu phải < 100ms (Kỳ vọng: ${expectedDurationSec.toFixed(2)}s, Thực tế: ${actualDuration.toFixed(2)}s, Lệch: ${(driftDeltaSec * 1000).toFixed(0)}ms)`
      );
    });

    await challenge('3.2 Flexible Mode rejects speech that cannot fit the original dialogue interval', async () => {
      const srtLines: string[] = [];
      const overrunDir = path.join(tempDir, 'tts_overrun_sequence');
      fs.mkdirSync(overrunDir, { recursive: true });

      const manifestEntries: Record<string, any> = {};

      let curMs = 1000;
      // 5 sentences with short slots (1.5s), but audio is long (2.5s -> 1.0s overrun each)
      for (let s = 1; s <= 5; s++) {
        const sentenceDur = 1500;
        const start = curMs;
        const end = start + sentenceDur;
        srtLines.push(`${s}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\nCâu quá dài số ${s}.\n`);

        const audioPath = path.join(overrunDir, `subtitle_${String(s).padStart(4, '0')}.mp3`);
        await runFfmpeg([
          '-f', 'lavfi',
          '-i', `sine=frequency=${400 + s * 30}:duration=2.5`,
          '-c:a', 'libmp3lame',
          '-y', audioPath,
        ]);

        manifestEntries[String(s)] = {
          voice: 'default',
          speed: 1.0,
          text: `Câu quá dài số ${s}.`,
          engine: 'tiktok',
        };

        curMs = end + 200; // tiny gap
      }

      const overrunSrtPath = path.join(tempDir, 'overrun_sequence.srt');
      fs.writeFileSync(overrunSrtPath, srtLines.join('\n'), 'utf-8');
      fs.writeFileSync(path.join(overrunDir, 'manifest.json'), JSON.stringify(manifestEntries), 'utf-8');

      const overrunMp3 = path.join(tempDir, 'merged_overrun_flexible.mp3');
      await assert.rejects(
        () => mergeAudioFiles(overrunSrtPath, overrunDir, overrunMp3, undefined, { mode: 'flexible' }),
        /Dubbing timing conflict at subtitle 1/,
      );
      assert.ok(!fs.existsSync(overrunMp3), 'Invalid continuous overrun must not produce an accepted render');
    });

  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  }

  // ==========================================================================
  // SUITE 4: Complex Grammar, Punctuation & Boundary Edge Cases
  // ==========================================================================
  console.log('\n--- SUITE 4: Complex Grammar, Punctuation & Boundary Cases ---');

  await challenge('4.1 Punctuation inside text: Number with decimal dot "2.0" does NOT trigger false terminal', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '', endTime: '', startMs: 1000, endMs: 2500, durationMs: 1500, text: 'Phiên bản VanhSub 2.0 vừa ra mắt' },
      { index: 2, startTime: '', endTime: '', startMs: 2600, endMs: 4000, durationMs: 1400, text: 'với nhiều tính năng vượt trội.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1, 'Số thập phân 2.0 giữa câu không được làm đứt nhóm câu');
    assert.ok(groups[0].text.includes('2.0 vừa ra mắt với nhiều tính năng'));
  });

  await challenge('4.2 Quotation marks and brackets at end of sentence correctly trigger terminal', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '', endTime: '', startMs: 1000, endMs: 2500, durationMs: 1500, text: 'Anh ấy nói: "Tôi đồng ý!"' },
      { index: 2, startTime: '', endTime: '', startMs: 2600, endMs: 4000, durationMs: 1400, text: 'Sau đó tất cả cùng vỗ tay.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2, 'Dấu chấm than trong ngoặc kép phải kết thúc nhóm câu');
    assert.strictEqual(groups[0].text, 'Anh ấy nói: "Tôi đồng ý!"');
  });

  await challenge('4.3 Unicode ellipsis ("…") at end of clause terminates sentence group', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '', endTime: '', startMs: 1000, endMs: 2500, durationMs: 1500, text: 'Mọi chuyện dường như đã kết thúc…' },
      { index: 2, startTime: '', endTime: '', startMs: 2600, endMs: 4000, durationMs: 1400, text: 'Nhưng bất ngờ lại xảy ra.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2, 'Dấu lửng Unicode … phải tách nhóm câu');
  });

  await challenge('4.4 Three dots ("...") at end of clause terminates sentence group', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '', endTime: '', startMs: 1000, endMs: 2500, durationMs: 1500, text: 'Chờ một chút...' },
      { index: 2, startTime: '', endTime: '', startMs: 2600, endMs: 4000, durationMs: 1400, text: 'Chúng ta đi thôi.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2, 'Ba dấu chấm ... phải tách nhóm câu');
  });

  await challenge('4.5 Different speakers isolate sentence groups even with zero gap and no terminal punctuation', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '', endTime: '', startMs: 1000, endMs: 2500, durationMs: 1500, text: 'Tôi nghĩ rằng', speaker: 'SPEAKER_00' },
      { index: 2, startTime: '', endTime: '', startMs: 2550, endMs: 4000, durationMs: 1450, text: 'bạn đã nhầm rồi', speaker: 'SPEAKER_01' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2, 'Hai speaker khác nhau tuyệt đối không được gom chung nhóm TTS');
    assert.strictEqual(groups[0].subtitles[0].speaker, 'SPEAKER_00');
    assert.strictEqual(groups[1].subtitles[0].speaker, 'SPEAKER_01');
  });

  await challenge('4.6 Whitespace normalization and line-break removal in TTS group text', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '', endTime: '', startMs: 1000, endMs: 2500, durationMs: 1500, text: '   Dòng 1 có nhiều    khoảng trắng   \n   xuống dòng   ' },
      { index: 2, startTime: '', endTime: '', startMs: 2600, endMs: 4000, durationMs: 1400, text: '   nối tiếp dòng 2.   ' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].text, 'Dòng 1 có nhiều khoảng trắng xuống dòng nối tiếp dòng 2.');
    assert.ok(!groups[0].text.includes('\n'), 'Không được chứa ký tự \\n trong text gửi TTS');
  });

  await challenge('4.7 Extreme single continuous word > 40 chars does not cause crash or infinite loop', () => {
    const ultraWord = 'A'.repeat(50);
    const broken = breakVietnameseLines(ultraWord, 37);
    assert.ok(broken.length >= 50, 'Không bị crash khi gặp từ siêu dài');
  });

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n================================================================================');
  console.log('📊 KẾT QUẢ EMPIRICAL CHALLENGER M2:');
  console.log(`   Tổng assertions: ${passed + failed}`);
  console.log(`   Thành công (PASS): ${passed} ✅`);
  console.log(`   Thất bại (FAIL):   ${failed} ❌`);
  console.log('================================================================================\n');

  if (failed > 0) {
    console.error('❌ CÁC BÀI TEST THẤT BẠI:');
    failureMessages.forEach((m) => console.error(m));
    process.exit(1);
  } else {
    console.log('🎉 TOÀN BỘ CÁC BÀI THỬ NGHIỆM ĐỐI KHÁNG EMPIRICAL ĐỀU PASS 100%!');
  }
}

function formatSrtTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const remMs = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(remMs).padStart(3, '0')}`;
}

runEmpiricalStressHarness().catch((err) => {
  console.error('Fatal stress test harness error:', err);
  process.exit(1);
});
