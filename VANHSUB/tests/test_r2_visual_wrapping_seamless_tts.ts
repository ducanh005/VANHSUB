/**
 * =========================================================================================
 * Test Suite: Milestone 2 (R2) Smart Visual Wrapping & Seamless TTS Concatenation
 * =========================================================================================
 *
 * Verifies:
 * 1. Benchmark sentence: "chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được, nhưng giá cho mỗi hoạt động tính thế nào?"
 * 2. Visual wrapping: <= 37 chars/line with \n and max 2 lines per block without fragmentation.
 * 3. Compound words, proper nouns, and unit numbers protected from breaking.
 * 4. Sentence grouping for TTS (unfinished clauses, same voice, gap <= 1200ms).
 * 5. Gapless audio timeline alignment: mergeAudioFiles continuous playback without artificial padding gaps between clauses.
 * 6. Manifest structure (isGroupLeader, isGroupMember, leaderIndex, groupIndices) and audio linking.
 *
 * Runner: npx tsx tests/test_r2_visual_wrapping_seamless_tts.ts
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

let passedCount = 0;
let totalCount = 0;

function runTest(testName: string, fn: () => void | Promise<void>) {
  totalCount++;
  try {
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      return (res as Promise<void>)
        .then(() => {
          passedCount++;
          console.log(`  ✅ [PASS] ${testName}`);
        })
        .catch((err) => {
          console.error(`  ❌ [FAIL] ${testName}`);
          console.error(`     Error: ${err.message || err}`);
          process.exitCode = 1;
        });
    } else {
      passedCount++;
      console.log(`  ✅ [PASS] ${testName}`);
      return Promise.resolve();
    }
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${testName}`);
    console.error(`     Error: ${err.message || err}`);
    process.exitCode = 1;
    return Promise.resolve();
  }
}

async function runTestSuite() {
  console.log('================================================================================');
  console.log('🧪 TEST SUITE: R2 SMART VISUAL WRAPPING & SEAMLESS TTS CONCATENATION');
  console.log('================================================================================\n');

  // ==========================================================================
  // Suite 1: Authoritative Benchmark Sentence Verification (ORIGINAL_REQUEST R2)
  // ==========================================================================
  console.log('--- Suite 1: Authoritative Benchmark Sentence Verification ---');

  // Benchmark sentence:
  // "chụp ảnh được, livestream được, tái hiện lại các cảnh kinh điển cũng được, nhưng giá cho mỗi hoạt động tính thế nào?"
  const benchmarkBlocks: SrtLine[] = [
    { id: 'b1', startMs: 1000, endMs: 2200, text: 'chụp ảnh được, livestream được' },
    { id: 'b2', startMs: 2300, endMs: 4500, text: 'tái hiện lại các cảnh kinh điển cũng được' },
    { id: 'b3', startMs: 4600, endMs: 7800, text: 'nhưng giá cho mỗi hoạt động tính thế nào?' },
  ];

  await runTest('1.1 Benchmark Sentence: consolidateSubtitleClauses consolidates 3 fragments into <= 2 blocks', () => {
    const consolidated = consolidateSubtitleClauses(benchmarkBlocks);
    assert.ok(consolidated.length <= 2, `Kỳ vọng tối đa 2 khối nhưng nhận được: ${consolidated.length}`);
    assert.strictEqual(consolidated[0].startMs, 1000);
    assert.strictEqual(consolidated[consolidated.length - 1].endMs, 7800);
  });

  await runTest('1.2 Benchmark Sentence: Each consolidated block has <= 2 lines and each line <= 37 chars', () => {
    const consolidated = consolidateSubtitleClauses(benchmarkBlocks);
    for (const block of consolidated) {
      const subLines = block.text.split('\n');
      assert.ok(subLines.length <= 2, `Khối vượt quá 2 dòng (${subLines.length} dòng): "${block.text}"`);
      for (const line of subLines) {
        assert.ok(
          line.trim().length <= 37,
          `Dòng vượt quá 37 ký tự (${line.trim().length} ký tự): "${line}"`
        );
      }
    }
  });

  await runTest('1.3 Benchmark Sentence: groupSubtitlesForTts clusters all 3 unfinished fragments into 1 SentenceGroup', () => {
    const subs: SubtitleLine[] = benchmarkBlocks.map((b, idx) => ({
      index: idx + 1,
      startTime: `00:00:0${idx + 1},000`,
      endTime: `00:00:0${idx + 2},000`,
      startMs: b.startMs,
      endMs: b.endMs,
      durationMs: b.endMs - b.startMs,
      text: b.text,
    }));

    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1, `Phải gom đúng 1 SentenceGroup nhưng có ${groups.length}`);
    assert.strictEqual(groups[0].startIndex, 1);
    assert.strictEqual(groups[0].endIndex, 3);
    assert.strictEqual(groups[0].startMs, 1000);
    assert.strictEqual(groups[0].endMs, 7800);
    assert.ok(groups[0].text.includes('chụp ảnh được'));
    assert.ok(groups[0].text.includes('tái hiện lại các cảnh kinh điển'));
    assert.ok(groups[0].text.includes('tính thế nào?'));
  });

  await runTest('1.4 Benchmark Sentence: segmentSubtitlesNetflix integrates pre-consolidation without timecode drift', () => {
    const netflixBlocks = segmentSubtitlesNetflix(benchmarkBlocks);
    assert.ok(netflixBlocks.length <= 2, `Netflix standard gom thành <= 2 khối (thực tế: ${netflixBlocks.length})`);
    assert.strictEqual(netflixBlocks[0].startMs, 1000);
    for (const b of netflixBlocks) {
      const subLines = b.text.split('\n');
      assert.ok(subLines.length <= 2);
      for (const l of subLines) {
        assert.ok(l.trim().length <= 37);
      }
    }
  });

  // ==========================================================================
  // Suite 2: Smart Visual Wrapping & Grammar Rules (F2.1)
  // ==========================================================================
  console.log('\n--- Suite 2: Smart Visual Wrapping & Grammar Rules ---');

  await runTest('2.1 Single short line <= 37 chars remains 1 line without newline', () => {
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 3000, text: 'Chào mừng các bạn đến với VanhSub' }; // 34 chars
    const res = consolidateSubtitleClauses([line]);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].text.includes('\n'), false);
    assert.strictEqual(res[0].text, 'Chào mừng các bạn đến với VanhSub');
  });

  await runTest('2.2 Line 38-74 chars wraps into 2 lines with \\n without splitting timecode', () => {
    const text = 'Hôm nay chúng ta sẽ cùng nhau tìm hiểu về trí tuệ nhân tạo'; // 57 chars
    const line: SrtLine = { id: '1', startMs: 1000, endMs: 4000, text };
    const res = consolidateSubtitleClauses([line]);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].startMs, 1000);
    assert.strictEqual(res[0].endMs, 4000);
    assert.strictEqual(res[0].text.includes('\n'), true);
    const subLines = res[0].text.split('\n');
    assert.strictEqual(subLines.length, 2);
    assert.ok(subLines[0].length <= 37);
    assert.ok(subLines[1].length <= 37);
  });

  await runTest('2.3 Protection of Vietnamese Compound Words ("Chính phủ", "kinh tế số", "phát triển")', () => {
    const text = 'Chính phủ vừa ban hành nghị định mới nhằm thúc đẩy phát triển kinh tế số.';
    const broken = breakVietnameseLines(text, 37);
    const lines = broken.split('\n');
    assert.strictEqual(lines.length, 2);
    assert.ok(!lines[0].endsWith('Chính') && !lines[1].startsWith('phủ'), 'Không ngắt đôi "Chính phủ"');
    assert.ok(!lines[0].endsWith('nghị') && !lines[1].startsWith('định'), 'Không ngắt đôi "nghị định"');
    assert.ok(!lines[0].endsWith('phát') && !lines[1].startsWith('triển'), 'Không ngắt đôi "phát triển"');
    assert.ok(!lines[0].endsWith('kinh') && !lines[1].startsWith('tế'), 'Không ngắt đôi "kinh tế"');
  });

  await runTest('2.4 Protection of Numeric and Unit Binding ("500 triệu USD", "120 km/h")', () => {
    const text = 'Dự án thu hút tổng vốn đầu tư 500 triệu USD và chạy tốc độ 120 km/h';
    const broken = breakVietnameseLines(text, 37);
    const lines = broken.split('\n');
    assert.strictEqual(lines.length, 2);
    assert.ok(!lines[0].endsWith('500') || !lines[1].startsWith('triệu'));
    assert.ok(!lines[0].endsWith('120') || !lines[1].startsWith('km/h'));
  });

  await runTest('2.5 Prevention of Dangling Prepositions at end of line 1 ("của", "và", "nhằm")', () => {
    const text = 'Sự phát triển vượt bậc của nền kinh tế số và trí tuệ nhân tạo';
    const broken = breakVietnameseLines(text, 37);
    const [l1] = broken.split('\n');
    const lastWord = l1.trim().split(' ').pop()?.toLowerCase();
    assert.notStrictEqual(lastWord, 'của');
    assert.notStrictEqual(lastWord, 'và');
  });

  await runTest('2.6 Multi-clause consolidation: 3 short micro-clauses (<74 chars total) merge into 1 block with \\n', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 1800, text: 'xin chào quý vị,' }, // 16 chars
      { id: '2', startMs: 1850, endMs: 2600, text: 'tôi là trợ lý ảo,' }, // 18 chars
      { id: '3', startMs: 2650, endMs: 3800, text: 'rất hân hạnh được hỗ trợ' }, // 24 chars -> total 60 chars
    ];
    const res = consolidateSubtitleClauses(lines);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].startMs, 1000);
    assert.strictEqual(res[0].endMs, 3800);
    assert.strictEqual(res[0].text.includes('\n'), true);
  });

  await runTest('2.7 Clauses ending in terminal punctuation (. ? ! …) do NOT merge with next clause', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2500, text: 'Tôi là kỹ sư công nghệ.' },
      { id: '2', startMs: 2600, endMs: 4000, text: 'Rất vui được gặp bạn.' },
    ];
    const res = consolidateSubtitleClauses(lines);
    assert.strictEqual(res.length, 2, 'Câu đã kết thúc bằng dấu chấm không được gộp vào câu sau');
  });

  await runTest('2.8 Clauses belonging to different speakers do NOT merge', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2500, text: 'Xin chào,', speaker: 'SPEAKER_00' },
      { id: '2', startMs: 2600, endMs: 4000, text: 'tôi cũng xin chào', speaker: 'SPEAKER_01' },
    ];
    const res = consolidateSubtitleClauses(lines);
    assert.strictEqual(res.length, 2, 'Khác speaker không được gộp');
  });

  await runTest('2.9 Gap > maxGapMs (1000ms) prevents consolidation of clauses', () => {
    const lines: SrtLine[] = [
      { id: '1', startMs: 1000, endMs: 2500, text: 'Vế thứ nhất' },
      { id: '2', startMs: 4000, endMs: 5500, text: 'vế thứ hai' }, // gap 1500ms > 1000ms
    ];
    const res = consolidateSubtitleClauses(lines);
    assert.strictEqual(res.length, 2, 'Khoảng lặng quá lớn (>1000ms) không được gom hiển thị');
  });

  // ==========================================================================
  // Suite 3: TTS Sentence Grouping Engine (F2.2)
  // ==========================================================================
  console.log('\n--- Suite 3: TTS Sentence Grouping Engine ---');

  await runTest('3.1 Consecutive incomplete clauses ending with comma or no punctuation cluster into 1 SentenceGroup', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Nếu bạn kiên trì,' },
      { index: 2, startTime: '00:00:02,050', endTime: '00:00:03,200', startMs: 2050, endMs: 3200, durationMs: 1150, text: 'chắc chắn bạn sẽ thành công.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].startIndex, 1);
    assert.strictEqual(groups[0].endIndex, 2);
    assert.strictEqual(groups[0].text, 'Nếu bạn kiên trì, chắc chắn bạn sẽ thành công.');
  });

  await runTest('3.2 Question mark ? and exclamation mark ! properly terminate SentenceGroup', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,500', startMs: 1000, endMs: 2500, durationMs: 1500, text: 'Bạn có muốn đi không?' },
      { index: 2, startTime: '00:00:02,600', endTime: '00:00:04,000', startMs: 2600, endMs: 4000, durationMs: 1400, text: 'Đi ngay thôi nào!' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[0].text, 'Bạn có muốn đi không?');
    assert.strictEqual(groups[1].text, 'Đi ngay thôi nào!');
  });

  await runTest('3.3 Silence gap threshold: gap <= 1200ms groups; gap > 1200ms splits', () => {
    const mergeSubs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'đoạn một' },
      { index: 2, startTime: '00:00:03,199', endTime: '00:00:04,500', startMs: 3199, endMs: 4500, durationMs: 1301, text: 'đoạn hai.' }, // gap 1199ms
    ];
    assert.strictEqual(groupSubtitlesForTts(mergeSubs).length, 1);

    const splitSubs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'đoạn một' },
      { index: 2, startTime: '00:00:03,205', endTime: '00:00:04,500', startMs: 3205, endMs: 4500, durationMs: 1295, text: 'đoạn hai.' }, // gap 1205ms
    ];
    assert.strictEqual(groupSubtitlesForTts(splitSubs).length, 2);
  });

  await runTest('3.4 Voice overrides isolation: different voices in voiceOverrides prevent grouping', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'giọng nam' },
      { index: 2, startTime: '00:00:02,050', endTime: '00:00:03,500', startMs: 2050, endMs: 3500, durationMs: 1450, text: 'giọng nữ.' },
    ];
    const opts: TTSOptions = {
      voice: 'voice_default',
      voiceOverrides: {
        '1': 'voice_male',
        '2': 'voice_female',
      },
    };
    const groups = groupSubtitlesForTts(subs, opts);
    assert.strictEqual(groups.length, 2, 'Hai giọng khác nhau không được gom vào cùng một lượt gọi TTS');
    assert.strictEqual(groups[0].voice, 'voice_male');
    assert.strictEqual(groups[1].voice, 'voice_female');
  });

  await runTest('3.5 Text joining cleans whitespace and converts internal \\n to spaces', () => {
    const subs: SubtitleLine[] = [
      { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', startMs: 1000, endMs: 2000, durationMs: 1000, text: 'Câu có dòng 1,\n dòng 2' },
      { index: 2, startTime: '00:00:02,100', endTime: '00:00:03,500', startMs: 2100, endMs: 3500, durationMs: 1400, text: 'kết thúc ở dòng 3.' },
    ];
    const groups = groupSubtitlesForTts(subs);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].text, 'Câu có dòng 1, dòng 2 kết thúc ở dòng 3.');
  });

  // ==========================================================================
  // Suite 4: Gapless Audio Timeline Alignment & Dubbing (F2.3)
  // ==========================================================================
  console.log('\n--- Suite 4: Gapless Audio Timeline Alignment & Dubbing ---');

  const tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub_r2_test_'));

  try {
    const ttsAudioDir = path.join(tempTestDir, 'tts_audio');
    fs.mkdirSync(ttsAudioDir, { recursive: true });

    // Tạo file SRT 3 block thuộc cùng 1 câu
    const srtContent = `1
00:00:01,000 --> 00:00:02,200
chụp ảnh được, livestream được

2
00:00:02,300 --> 00:00:04,500
tái hiện lại các cảnh kinh điển cũng được

3
00:00:04,600 --> 00:00:07,800
nhưng giá cho mỗi hoạt động tính thế nào?
`;
    const srtPath = path.join(tempTestDir, 'benchmark.srt');
    fs.writeFileSync(srtPath, srtContent, 'utf-8');

    // Tạo master audio file subtitle_0001.mp3 có độ dài 5.5s (toàn bộ câu) bằng FFmpeg sine
    const masterAudio = path.join(ttsAudioDir, 'subtitle_0001.mp3');
    await runFfmpeg([
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=5.5',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      '-y', masterAudio,
    ]);

    // Tạo manifest.json ghi nhận SentenceGroup
    const manifest = {
      '1': {
        voice: 'BV074_streaming',
        speed: 1.0,
        text: 'chụp ảnh được, livestream được tái hiện lại các cảnh kinh điển cũng được nhưng giá cho mỗi hoạt động tính thế nào?',
        engine: 'tiktok',
        isGroupLeader: true,
        groupIndices: [1, 2, 3],
      },
      '2': {
        voice: 'BV074_streaming',
        speed: 1.0,
        text: 'tái hiện lại các cảnh kinh điển cũng được',
        engine: 'tiktok',
        isGroupMember: true,
        leaderIndex: 1,
      },
      '3': {
        voice: 'BV074_streaming',
        speed: 1.0,
        text: 'nhưng giá cho mỗi hoạt động tính thế nào?',
        engine: 'tiktok',
        isGroupMember: true,
        leaderIndex: 1,
      },
    };
    fs.writeFileSync(path.join(ttsAudioDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');

    await runTest('4.1 mergeAudioFiles with manifest: recognizes SentenceGroup and produces continuous MP3', async () => {
      const mergedMp3 = path.join(tempTestDir, 'merged_manifest.mp3');
      const res = await mergeAudioFiles(srtPath, ttsAudioDir, mergedMp3, undefined, { mode: 'flexible' });
      assert.strictEqual(res.audioPath, mergedMp3);
      assert.ok(fs.existsSync(mergedMp3));

      const dur = await getMediaDurationSec(mergedMp3);
      // Timeline starts at 1.0s, master audio is 5.5s + tail -> total ~6.8s - 8.3s
      assert.ok(dur >= 6.5 && dur <= 9.0, `Thời lượng MP3 ghép phải khớp tổng câu (~6.8s - 8.3s, thực tế: ${dur.toFixed(2)}s)`);
    });

    await runTest('4.2 mergeAudioFiles without manifest: groupSubtitlesForTts fallback groups clauses gaplessly', async () => {
      const noManifestDir = path.join(tempTestDir, 'tts_no_manifest');
      fs.mkdirSync(noManifestDir, { recursive: true });
      // Copy master audio to subtitle_0001.mp3
      fs.copyFileSync(masterAudio, path.join(noManifestDir, 'subtitle_0001.mp3'));

      const mergedNoManifestMp3 = path.join(tempTestDir, 'merged_no_manifest.mp3');
      const res = await mergeAudioFiles(srtPath, noManifestDir, mergedNoManifestMp3, undefined, { mode: 'flexible' });
      assert.strictEqual(res.audioPath, mergedNoManifestMp3);
      assert.ok(fs.existsSync(mergedNoManifestMp3));

      const dur = await getMediaDurationSec(mergedNoManifestMp3);
      assert.ok(dur >= 6.5 && dur <= 9.0, `Fallback grouping duration hợp lệ (${dur.toFixed(2)}s)`);
    });

    await runTest('4.3 Two distinct finished sentences retain appropriate inter-sentence padding gap', async () => {
      const twoSentencesSrt = `1
00:00:01,000 --> 00:00:03,000
Câu thứ nhất đã xong.

2
00:00:05,000 --> 00:00:07,000
Câu thứ hai bắt đầu.
`;
      const twoSrtPath = path.join(tempTestDir, 'two_sentences.srt');
      fs.writeFileSync(twoSrtPath, twoSentencesSrt, 'utf-8');

      const twoAudioDir = path.join(tempTestDir, 'tts_two_sentences');
      fs.mkdirSync(twoAudioDir, { recursive: true });

      // Create 1.5s audio for each
      await runFfmpeg([
        '-f', 'lavfi',
        '-i', 'sine=frequency=500:duration=1.5',
        '-c:a', 'libmp3lame',
        '-y', path.join(twoAudioDir, 'subtitle_0001.mp3'),
      ]);
      await runFfmpeg([
        '-f', 'lavfi',
        '-i', 'sine=frequency=700:duration=1.5',
        '-c:a', 'libmp3lame',
        '-y', path.join(twoAudioDir, 'subtitle_0002.mp3'),
      ]);

      const twoMergedMp3 = path.join(tempTestDir, 'merged_two.mp3');
      const res = await mergeAudioFiles(twoSrtPath, twoAudioDir, twoMergedMp3, undefined, { mode: 'strict' });
      assert.ok(fs.existsSync(res.audioPath));

      const dur = await getMediaDurationSec(twoMergedMp3);
      // Timeline spans from 0 to 7.5s (endMs of sentence 2 + 500ms)
      assert.ok(dur >= 6.5 && dur <= 8.5, `Thời lượng hai câu độc lập phải đủ khoảng lặng (~7.5s, thực tế: ${dur.toFixed(2)}s)`);
    });

  } finally {
    try {
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    } catch {}
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n================================================================================');
  console.log(`📊 KẾT QUẢ TEST SUITE R2:`);
  console.log(`   Đã thực thi: ${totalCount}`);
  console.log(`   Thành công:  ${passedCount} ✅`);
  console.log(`   Thất bại:    ${totalCount - passedCount} ❌`);
  console.log('================================================================================\n');

  if (passedCount !== totalCount) {
    console.error('❌ CÓ BÀI TEST BỊ THẤT BẠI!');
    process.exit(1);
  } else {
    console.log('🎉 TOÀN BỘ CÁC BÀI TEST R2 ĐÃ VƯỢT QUA 100% THÀNH CÔNG!');
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
