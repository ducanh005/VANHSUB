/**
 * Test Suite: End-to-End Upgrade Integration (Milestone 4)
 * Fully links:
 * - R1: Faster-Whisper ASR with Speaker Diarization ([SPEAKER_XX]:) & Graceful Fallback
 * - R2: Vietnamese Grammar NLP Subtitle Segmentation (Netflix <= 37 chars, <= 2 lines, 15-21 CPS)
 * - R3: Kinetic Subtitles Engine & Presets (Hormozi \k, MrBeast pop-in & emoji, Minimalist Glow progress bar)
 * 
 * Tests across 4 Progressive Tiers:
 * - Tier 1: Core E2E Pipeline Links (F1-F12 linking)
 * - Tier 2: Boundary & Edge Conditions
 * - Tier 3: Pairwise Cross-Feature Interactions
 * - Tier 4: Real-World Application Scenarios (1-4 from TEST_INFRA.md)
 * - Tier 5: Adversarial & System Integrity Audit
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { transcribeUnified, type AsrOptions, type AsrResult } from '../main/asr/asrRouter';
import {
  parseSrt,
  serializeSrt,
  formatMs,
  parseTimecode,
  type SrtLine,
  type SrtWord,
} from '../main/lib/srt';
import {
  breakVietnameseLines,
  segmentSubtitlesNetflix,
  splitLineSmart,
  calculateCps,
  type NlpSegmentOptions,
} from '../main/lib/nlpSegmenter';
import {
  compileKineticDialogue,
  calculateWordTimings,
  detectEmoji,
  EMOJI_RULES,
  type KineticConfig,
  type KineticPreset,
} from '../main/render/kineticEngine';
import {
  compileToAss,
  hexToAssColor,
  formatAssTime,
  type CompileSubtitleItem,
} from '../main/render/assCompiler';
import {
  probePythonEnv,
  checkFasterWhisperAvailable,
  resolvePythonExecutable,
} from '../main/lib/pythonEnv';

let passedCount = 0;
let totalCount = 0;

function assert(condition: boolean, message: string) {
  totalCount++;
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    process.exit(1);
  }
  passedCount++;
  console.log(`  ✅ PASS: ${message}`);
}

function createSyntheticWav(filePath: string, durationSec = 1.5): string {
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

function createSyntheticVideo(
  videoPath: string,
  durationSec = 2,
  width = 1280,
  height = 720,
  color = 'navy'
): void {
  const ffmpegPath = ffmpegInstaller.path;
  fs.mkdirSync(path.dirname(videoPath), { recursive: true });
  execFileSync(
    ffmpegPath,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:s=${width}x${height}:d=${durationSec}:r=24`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      videoPath,
    ],
    { stdio: 'pipe' }
  );
}

function burnInSubtitles(videoIn: string, assPath: string, videoOut: string): void {
  const ffmpegPath = ffmpegInstaller.path;
  const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  execFileSync(
    ffmpegPath,
    [
      '-y',
      '-i',
      videoIn,
      '-vf',
      `subtitles='${escapedAss}'`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      videoOut,
    ],
    { stdio: 'pipe' }
  );
}

async function runAllTests() {
  console.log('================================================================');
  console.log('🚀 TEST SUITE: COMPLETE E2E UPGRADE INTEGRATION (MILESTONE 4)');
  console.log('================================================================\n');

  const tempBaseDir = path.join(process.cwd(), 'temp', 'test_e2e_m4');
  fs.mkdirSync(tempBaseDir, { recursive: true });

  try {
    // ========================================================================
    // TIER 1: Core E2E Pipeline Links (F1-F12 End-to-End Linking)
    // ========================================================================
    console.log('--- TIER 1: Core E2E Pipeline Links (R1 -> R2 -> R3) ---');

    // 1.1 ASR & Speaker Diarization Output Parsing
    const rawAsrSrt = `1
00:00:01,000 --> 00:00:04,500
[SPEAKER_00]: Xin chào mừng các bạn đã đến với kênh chia sẻ kinh tế và đầu tư tài chính.

2
00:00:05,000 --> 00:00:08,200
[SPEAKER_01]: Cảm ơn bạn, tôi rất hào hứng thảo luận về thị trường công nghệ và trí tuệ nhân tạo.
`;

    const parsedLines = parseSrt(rawAsrSrt);
    assert(parsedLines.length === 2, 'Tier 1.1: Phân tích thành công 2 dòng phụ đề từ SRT thô');
    assert(parsedLines[0].speaker === 'SPEAKER_00', 'Tier 1.1: Nhận diện chính xác SPEAKER_00');
    assert(parsedLines[1].speaker === 'SPEAKER_01', 'Tier 1.1: Nhận diện chính xác SPEAKER_01');
    assert(!parsedLines[0].text.includes('[SPEAKER_00]:'), 'Tier 1.1: Text dòng 1 đã lọc sạch nhãn người nói');
    assert(!parsedLines[1].text.includes('[SPEAKER_01]:'), 'Tier 1.1: Text dòng 2 đã lọc sạch nhãn người nói');

    // 1.2 Pipeline Feed vào Vietnamese NLP Netflix Segmenter
    const segmentedLines = segmentSubtitlesNetflix(parsedLines, {
      maxCharsPerLine: 37,
      maxLinesPerBlock: 2,
      targetCps: 18,
    });

    assert(segmentedLines.length >= 2, 'Tier 1.2: NLP phân đoạn thành công danh sách phụ đề');
    for (const seg of segmentedLines) {
      const subLines = seg.text.split('\n');
      assert(subLines.length <= 2, `Tier 1.2: Số dòng <= 2 (thực tế: ${subLines.length})`);
      for (const sl of subLines) {
        assert(sl.length <= 37, `Tier 1.2: Dòng phụ đề tuân thủ <= 37 ký tự (${sl.length}: "${sl}")`);
      }
      assert(seg.speaker !== undefined, `Tier 1.2: Giữ nguyên nhãn speaker sau phân đoạn (${seg.speaker})`);
    }

    // 1.3 Pipeline Feed từ NLP sang Kinetic Hormozi Preset
    const hormoziAss = compileToAss(
      segmentedLines.map((l) => ({
        startMs: l.startMs,
        endMs: l.endMs,
        text: l.text,
        speaker: l.speaker,
      })),
      {
        videoWidth: 1080,
        videoHeight: 1920,
        kineticConfig: {
          preset: 'hormozi',
          activeColor: '#FFE500',
        },
      }
    );

    assert(hormoziAss.includes('[Script Info]'), 'Tier 1.3: ASS Hormozi có [Script Info]');
    assert(hormoziAss.includes('Style: Hormozi'), 'Tier 1.3: ASS Hormozi có Style: Hormozi');
    assert(hormoziAss.includes('Arial Black'), 'Tier 1.3: Font Arial Black cho phong cách Hormozi');
    assert(hormoziAss.includes('\\k'), 'Tier 1.3: Chứa thẻ karaoke \\k đồng bộ từng từ');
    assert(hormoziAss.includes('\\fscx112\\fscy112'), 'Tier 1.3: Chứa thẻ spotlight phóng to \\fscx112\\fscy112');

    // 1.4 Pipeline Feed từ NLP sang Kinetic MrBeast Preset
    const mrBeastAss = compileToAss(
      segmentedLines.map((l) => ({
        startMs: l.startMs,
        endMs: l.endMs,
        text: l.text,
        speaker: l.speaker,
      })),
      {
        videoWidth: 1080,
        videoHeight: 1920,
        kineticConfig: {
          preset: 'mrbeast',
          enableEmoji: true,
          emojiFrequency: 'high',
        },
      }
    );

    assert(mrBeastAss.includes('Style: MrBeast'), 'Tier 1.4: ASS MrBeast có Style: MrBeast');
    assert(mrBeastAss.includes('Impact'), 'Tier 1.4: Font Impact cho phong cách MrBeast');
    assert(mrBeastAss.includes('\\fscx130\\fscy130'), 'Tier 1.4: Chứa hiệu ứng pop-in nảy 130%');
    assert(mrBeastAss.includes('\\fscx95\\fscy95'), 'Tier 1.4: Chứa hiệu ứng co nén 95%');

    // 1.5 Pipeline Feed từ NLP sang Kinetic Minimalist Glow Preset
    const minimalAss = compileToAss(
      segmentedLines.map((l) => ({
        startMs: l.startMs,
        endMs: l.endMs,
        text: l.text,
        speaker: l.speaker,
      })),
      {
        videoWidth: 1920,
        videoHeight: 1080,
        kineticConfig: {
          preset: 'minimalist_glow',
          enableProgressBar: true,
          glowBlur: 5,
        },
      }
    );

    assert(minimalAss.includes('Style: MinimalGlow'), 'Tier 1.5: ASS Minimalist Glow có Style: MinimalGlow');
    assert(minimalAss.includes('\\blur5'), 'Tier 1.5: Chứa hiệu ứng aura \\blur5');
    assert(minimalAss.includes('\\p1'), 'Tier 1.5: Chứa lệnh vẽ hình học vector \\p1 cho thanh tiến trình');
    assert(minimalAss.includes('\\p0'), 'Tier 1.5: Đóng lệnh vẽ vector \\p0 an toàn');
    assert(minimalAss.includes('\\fscx0\\t(0,'), 'Tier 1.5: Animation thanh tiến trình quét từ 0% lên 100%');

    // ========================================================================
    // TIER 2: Boundary & Edge Conditions
    // ========================================================================
    console.log('\n--- TIER 2: Boundary & Edge Conditions ---');

    // 2.1 Single-word ultra-short subtitle duration padding
    const singleWordLine: SrtLine = {
      id: 'single-1',
      startMs: 1000,
      endMs: 1250, // 250ms duration (extremely short)
      text: 'Đúng!',
      speaker: 'SPEAKER_00',
    };
    const paddedSingle = segmentSubtitlesNetflix([singleWordLine], {
      minDurationMs: 1000,
      minGapMs: 80,
    });
    assert(paddedSingle[0].endMs - paddedSingle[0].startMs >= 1000, 'Tier 2.1: Phụ đề cực ngắn được pad lên >= 1000ms');
    const singleTimings = calculateWordTimings(paddedSingle[0]);
    assert(singleTimings.length === 1, 'Tier 2.1: Word timings có đúng 1 từ');
    assert(singleTimings[0].durationCs >= 100, `Tier 2.1: Duration centiseconds >= 100 (thực tế: ${singleTimings[0].durationCs})`);

    // 2.2 Extreme long sentence without punctuation (> 220 chars)
    const megaSentence: SrtLine = {
      id: 'mega-1',
      startMs: 2000,
      endMs: 15000,
      text: 'Chính phủ Việt Nam vừa ban hành một nghị quyết đặc biệt về phát triển khoa học công nghệ và đổi mới sáng tạo nhằm nâng cao năng lực cạnh tranh quốc gia trong kỷ nguyên trí tuệ nhân tạo và kinh tế số toàn cầu hiện nay.',
      speaker: 'SPEAKER_01',
    };
    const segmentedMega = segmentSubtitlesNetflix([megaSentence], { maxCharsPerLine: 37, maxLinesPerBlock: 2 });
    assert(segmentedMega.length >= 3, `Tier 2.2: Câu cực dài được phân rã thành >= 3 blocks (thực tế: ${segmentedMega.length})`);
    for (let i = 0; i < segmentedMega.length; i++) {
      const seg = segmentedMega[i];
      assert(seg.speaker === 'SPEAKER_01', 'Tier 2.2: Tất cả các sub-blocks đều giữ nguyên speaker SPEAKER_01');
      assert(seg.startMs < seg.endMs, 'Tier 2.2: Mọi sub-block đảm bảo startMs < endMs');
      if (i > 0) {
        assert(segmentedMega[i - 1].endMs <= seg.startMs, 'Tier 2.2: Không chồng chéo timecode giữa các sub-blocks');
      }
      for (const line of seg.text.split('\n')) {
        assert(line.length <= 37, `Tier 2.2: Từng dòng <= 37 ký tự (${line.length}: "${line}")`);
        assert(!line.endsWith('Chính') && !line.startsWith('phủ'), 'Tier 2.2: Không ngắt đôi "Chính phủ"');
        assert(!line.endsWith('kinh') && !line.startsWith('tế'), 'Tier 2.2: Không ngắt đôi "kinh tế"');
      }
    }

    // 2.3 Ultra-fast speech rate (> 30 CPS)
    const fastSpeechLine: SrtLine = {
      id: 'fast-1',
      startMs: 1000,
      endMs: 1800, // 800ms
      text: 'Chúng ta phải hành động thật nhanh chóng để nắm bắt thời cơ vàng này!', // 69 chars -> 86 CPS!
    };
    const nextLine: SrtLine = {
      id: 'fast-2',
      startMs: 6000,
      endMs: 8000,
      text: 'Đó là mục tiêu cốt lõi.',
    };
    const paddedFast = segmentSubtitlesNetflix([fastSpeechLine, nextLine], { targetCps: 18, minGapMs: 80 });
    const fastBlock = paddedFast[0];
    const fastCps = calculateCps(fastBlock);
    assert(fastCps <= 22, `Tier 2.3: Tốc độ đọc được hạ xuống ngưỡng tối ưu 15-22 CPS (thực tế: ${fastCps.toFixed(1)} CPS)`);
    assert(fastBlock.endMs <= nextLine.startMs - 80, 'Tier 2.3: Duration padding giữ khoảng đệm an toàn >= 80ms tới câu tiếp theo');

    // 2.4 Subtitle without word timestamps (proportional character-length interpolation)
    const lineNoWords: SrtLine = {
      id: 'nowords-1',
      startMs: 10000,
      endMs: 14000, // 4000ms
      text: 'Thành phố Hồ Chí Minh năng động',
    };
    const interpolatedTimings = calculateWordTimings(lineNoWords);
    assert(interpolatedTimings.length === 7, 'Tier 2.4: Phân rã 7 từ khi không có word timestamps');
    const totalInterpDuration = interpolatedTimings.reduce((sum, t) => sum + t.durationMs, 0);
    assert(
      Math.abs(totalInterpDuration - 4000) <= 20,
      `Tier 2.4: Tổng thời gian các từ xấp xỉ 4000ms (thực tế: ${totalInterpDuration}ms)`
    );
    assert(interpolatedTimings.every((t) => t.durationCs > 0), 'Tier 2.4: Mọi từ đều có durationCs > 0');

    // 2.5 Preservation of complex numeric & unit expressions
    const numericLine: SrtLine = {
      id: 'num-1',
      startMs: 15000,
      endMs: 19000,
      text: 'Doanh nghiệp đã đầu tư 25,5 tỷ USD và tuyển dụng hơn 1.200 kỹ sư chất lượng cao.',
    };
    const segmentedNum = segmentSubtitlesNetflix([numericLine]);
    for (const seg of segmentedNum) {
      for (const line of seg.text.split('\n')) {
        if (line.includes('25,5')) {
          assert(line.includes('25,5 tỷ USD'), 'Tier 2.5: Cụm "25,5 tỷ USD" không bị ngắt đôi');
        }
        if (line.includes('1.200')) {
          assert(line.includes('1.200 kỹ sư'), 'Tier 2.5: Cụm "1.200 kỹ sư" không bị ngắt đôi');
        }
      }
    }

    // 2.6 Rapid speaker switching
    const multiSpeakerLines: SrtLine[] = [
      { id: 's-1', startMs: 1000, endMs: 2000, text: 'Vâng, tôi đồng ý.', speaker: 'SPEAKER_00' },
      { id: 's-2', startMs: 2100, endMs: 3000, text: 'Bạn có chắc chắn không?', speaker: 'SPEAKER_01' },
      { id: 's-3', startMs: 3100, endMs: 4000, text: 'Hoàn toàn chắc chắn.', speaker: 'SPEAKER_00' },
      { id: 's-4', startMs: 4100, endMs: 5000, text: 'Tôi cũng tán thành.', speaker: 'SPEAKER_02' },
    ];
    const segmentedMulti = segmentSubtitlesNetflix(multiSpeakerLines);
    assert(segmentedMulti.length === 4, 'Tier 2.6: Giữ nguyên 4 lượt thoại khi nói ngắn');
    assert(segmentedMulti[0].speaker === 'SPEAKER_00', 'Tier 2.6: Lượt 1 là SPEAKER_00');
    assert(segmentedMulti[1].speaker === 'SPEAKER_01', 'Tier 2.6: Lượt 2 là SPEAKER_01');
    assert(segmentedMulti[2].speaker === 'SPEAKER_00', 'Tier 2.6: Lượt 3 là SPEAKER_00');
    assert(segmentedMulti[3].speaker === 'SPEAKER_02', 'Tier 2.6: Lượt 4 là SPEAKER_02');

    // ========================================================================
    // TIER 3: Pairwise Cross-Feature Interactions
    // ========================================================================
    console.log('\n--- TIER 3: Pairwise Cross-Feature Interactions ---');

    // 3.1 Speaker Diarization + Netflix NLP Segmentation + Serialization
    const srtSerialized = serializeSrt(segmentedMulti);
    assert(srtSerialized.includes('[SPEAKER_00]: Vâng, tôi đồng ý.'), 'Tier 3.1: Serialize SRT giữ đúng tiền tố SPEAKER_00');
    assert(srtSerialized.includes('[SPEAKER_01]: Bạn có chắc chắn không?'), 'Tier 3.1: Serialize SRT giữ đúng tiền tố SPEAKER_01');
    assert(srtSerialized.includes('[SPEAKER_02]: Tôi cũng tán thành.'), 'Tier 3.1: Serialize SRT giữ đúng tiền tố SPEAKER_02');

    // 3.2 NLP Syllable Weighting + Kinetic Word Timings
    const paddedLineWithWeights: SrtLine = {
      id: 'weight-1',
      startMs: 20000,
      endMs: 23000, // 3000ms
      text: 'Học máy và trí tuệ nhân tạo',
    };
    const weightTimings = calculateWordTimings(paddedLineWithWeights);
    const hocTiming = weightTimings.find((t) => t.word === 'Học')!;
    const triTiming = weightTimings.find((t) => t.word === 'trí')!;
    assert(hocTiming && triTiming, 'Tier 3.2: Tìm thấy các từ trong danh sách timings');
    assert(weightTimings[weightTimings.length - 1].endMs === 3000, 'Tier 3.2: Từ cuối cùng kết thúc đúng thời lượng dòng (3000ms)');

    // 3.3 MrBeast Multi-keyword Priority Throttling
    const textWithMultipleKeywords = 'Tôi đã kiếm được 50 triệu và cảm thấy rất bùng nổ, xin cảm ơn mọi người!';
    const detectedEmojiItem = detectEmoji(textWithMultipleKeywords);
    assert(detectedEmojiItem !== null, 'Tier 3.3: Phát hiện emoji từ text đa từ khóa');
    // 'tiền'/'triệu' (priority 10) phải thắng 'bùng nổ' (priority 9) và 'cảm ơn' (priority 5)
    assert(detectedEmojiItem?.emoji === '💰', `Tier 3.3: Emoji 💰 (priority 10) được ưu tiên thay vì emoji thấp hơn (thực tế: ${detectedEmojiItem?.emoji})`);
    assert(detectedEmojiItem?.highlightColor === '#00FF66', 'Tier 3.3: Màu highlight tiền tệ khớp #00FF66');

    // 3.4 Dynamic Video Dimensions with Kinetic Progress Bar
    const portraitAss = compileToAss(
      [{ startMs: 0, endMs: 2000, text: 'Video dọc TikTok' }],
      {
        videoWidth: 1080,
        videoHeight: 1920,
        kineticConfig: { preset: 'minimalist_glow', enableProgressBar: true },
      }
    );
    assert(portraitAss.includes('PlayResX: 1080'), 'Tier 3.4: PlayResX 1080 cho video 9:16');
    assert(portraitAss.includes('PlayResY: 1920'), 'Tier 3.4: PlayResY 1920 cho video 9:16');

    // Tọa độ căn giữa thanh tiến trình: barWidth = 1080 * 0.25 = 270 => barX = (1080 - 270)/2 = 405
    assert(portraitAss.includes('\\pos(405,'), 'Tier 3.4: Thanh tiến trình được căn giữa hoàn hảo tại X=405 trên video 1080x1920');

    // ========================================================================
    // TIER 4: Real-World Application Scenarios (1-4 from TEST_INFRA.md)
    // ========================================================================
    console.log('\n--- TIER 4: Real-World Application Scenarios ---');

    // ------------------------------------------------------------------------
    // SCENARIO 1: Podcast / Interview Dual-Speaker Video
    // ------------------------------------------------------------------------
    console.log('--- Scenario 1: Podcast / Interview Dual-Speaker Video ---');
    const s1AudioPath = path.join(tempBaseDir, 'scenario1_podcast.wav');
    createSyntheticWav(s1AudioPath, 3.0);

    // Giả lập pipeline ASR với Speaker Diarization và Word Timestamps
    const s1AsrResult = await transcribeUnified(s1AudioPath, {
      asrEngine: 'faster-whisper',
      enableDiarization: true,
      customFwChecker: async () => ({ available: true, useCuda: false }),
      customFwRunner: async () => ({
        srtPath: s1AudioPath.replace('.wav', '.srt'),
        speakers: ['SPEAKER_00', 'SPEAKER_01'],
        words: [
          { word: 'Xin', startMs: 0, endMs: 300, speaker: 'SPEAKER_00' },
          { word: 'chào', startMs: 300, endMs: 600, speaker: 'SPEAKER_00' },
          { word: 'khán', startMs: 600, endMs: 900, speaker: 'SPEAKER_00' },
          { word: 'giả', startMs: 900, endMs: 1200, speaker: 'SPEAKER_00' },
          { word: 'Rất', startMs: 1400, endMs: 1800, speaker: 'SPEAKER_01' },
          { word: 'vui', startMs: 1800, endMs: 2200, speaker: 'SPEAKER_01' },
          { word: 'được', startMs: 2200, endMs: 2600, speaker: 'SPEAKER_01' },
          { word: 'gặp', startMs: 2600, endMs: 3000, speaker: 'SPEAKER_01' },
        ],
      }),
    });

    assert(s1AsrResult.engineUsed === 'faster-whisper', 'Scenario 1: Faster-Whisper thực thi thành công');
    assert(s1AsrResult.speakers?.includes('SPEAKER_00'), 'Scenario 1: Diarization phát hiện SPEAKER_00');
    assert(s1AsrResult.speakers?.includes('SPEAKER_01'), 'Scenario 1: Diarization phát hiện SPEAKER_01');

    // Chuyển sang SrtLine và segment qua Vietnamese NLP
    const s1Lines: SrtLine[] = [
      {
        id: 's1-1',
        startMs: 0,
        endMs: 1300,
        text: 'Xin chào quý vị khán giả đã quay trở lại với chương trình tọa đàm hôm nay.',
        speaker: 'SPEAKER_00',
      },
      {
        id: 's1-2',
        startMs: 1400,
        endMs: 3000,
        text: 'Rất vui được gặp lại anh trong buổi thảo luận chuyên sâu này.',
        speaker: 'SPEAKER_01',
      },
    ];

    const s1Segmented = segmentSubtitlesNetflix(s1Lines);
    for (const item of s1Segmented) {
      assert(item.speaker !== undefined, `Scenario 1: Nhãn ${item.speaker} được giữ nguyên`);
      for (const line of item.text.split('\n')) {
        assert(line.length <= 37, `Scenario 1: Dòng <= 37 ký tự (${line.length})`);
      }
    }

    // Compile sang Hormozi ASS
    const s1AssContent = compileToAss(
      s1Segmented.map((l) => ({
        startMs: l.startMs,
        endMs: l.endMs,
        text: l.text,
        speaker: l.speaker,
      })),
      {
        videoWidth: 1280,
        videoHeight: 720,
        kineticConfig: { preset: 'hormozi', activeColor: '#FFE500' },
      }
    );

    const s1AssPath = path.join(tempBaseDir, 'scenario1.ass');
    fs.writeFileSync(s1AssPath, s1AssContent, 'utf-8');
    assert(fs.existsSync(s1AssPath), 'Scenario 1: File ASS được tạo thành công');

    // Render qua FFmpeg Libass
    const s1VideoIn = path.join(tempBaseDir, 'scenario1_in.mp4');
    const s1VideoOut = path.join(tempBaseDir, 'scenario1_out.mp4');
    createSyntheticVideo(s1VideoIn, 3, 1280, 720, 'darkgreen');
    burnInSubtitles(s1VideoIn, s1AssPath, s1VideoOut);

    assert(fs.existsSync(s1VideoOut) && fs.statSync(s1VideoOut).size > 1000, 'Scenario 1: FFmpeg burn-in video Podcast thành công (> 1KB)');

    // ------------------------------------------------------------------------
    // SCENARIO 2: Viral TikTok/Shorts High-Energy Promo
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 2: Viral TikTok/Shorts High-Energy Promo ---');
    const s2Lines: SrtLine[] = [
      {
        id: 's2-1',
        startMs: 0,
        endMs: 1500,
        text: 'Tôi vừa kiếm được 100 triệu chỉ trong 3 ngày, thật điên rồ và bùng nổ!',
      },
      {
        id: 's2-2',
        startMs: 1600,
        endMs: 3000,
        text: 'Hãy đăng ký ngay hôm nay để nhận giải thưởng vô địch cực phẩm!',
      },
    ];

    const s2Segmented = segmentSubtitlesNetflix(s2Lines, { maxCharsPerLine: 35 });
    const s2AssContent = compileToAss(
      s2Segmented.map((l) => ({
        startMs: l.startMs,
        endMs: l.endMs,
        text: l.text,
      })),
      {
        videoWidth: 1080,
        videoHeight: 1920,
        kineticConfig: {
          preset: 'mrbeast',
          enableEmoji: true,
          emojiFrequency: 'high',
        },
      }
    );

    assert(s2AssContent.includes('Style: MrBeast'), 'Scenario 2: Chứa Style MrBeast');
    assert(s2AssContent.includes('💰') || s2AssContent.includes('🔥') || s2AssContent.includes('🏆'), 'Scenario 2: Tự động chèn emoji cảm xúc (💰/🔥/🏆)');
    assert(s2AssContent.includes('\\fscx130\\fscy130'), 'Scenario 2: Chứa animation pop-in nảy chữ');

    const s2AssPath = path.join(tempBaseDir, 'scenario2.ass');
    fs.writeFileSync(s2AssPath, s2AssContent, 'utf-8');

    const s2VideoIn = path.join(tempBaseDir, 'scenario2_in.mp4');
    const s2VideoOut = path.join(tempBaseDir, 'scenario2_out.mp4');
    createSyntheticVideo(s2VideoIn, 3, 1080, 1920, 'darkred');
    burnInSubtitles(s2VideoIn, s2AssPath, s2VideoOut);

    assert(fs.existsSync(s2VideoOut) && fs.statSync(s2VideoOut).size > 1000, 'Scenario 2: FFmpeg burn-in video Viral TikTok 9:16 thành công (> 1KB)');

    // ------------------------------------------------------------------------
    // SCENARIO 3: Netflix Documentary Voiceover
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 3: Netflix Documentary Voiceover ---');
    const s3Lines: SrtLine[] = [
      {
        id: 's3-1',
        startMs: 0,
        endMs: 4000,
        text: 'Chính phủ vừa ban hành nghị quyết mới nhằm thúc đẩy phát triển kinh tế số.',
      },
      {
        id: 's3-2',
        startMs: 5000,
        endMs: 10000,
        text: 'Đồng thời cam kết hỗ trợ toàn diện các doanh nghiệp công nghệ trong nước.',
      },
    ];

    const s3Segmented = segmentSubtitlesNetflix(s3Lines, {
      maxCharsPerLine: 37,
      maxLinesPerBlock: 2,
      targetCps: 18,
    });

    for (const seg of s3Segmented) {
      assert(calculateCps(seg) <= 21, `Scenario 3: CPS tuân thủ ngưỡng chuẩn Netflix <= 21 CPS (${calculateCps(seg).toFixed(1)})`);
    }

    const s3AssContent = compileToAss(
      s3Segmented.map((l) => ({
        startMs: l.startMs,
        endMs: l.endMs,
        text: l.text,
      })),
      {
        videoWidth: 1920,
        videoHeight: 1080,
        kineticConfig: {
          preset: 'minimalist_glow',
          enableProgressBar: true,
          glowBlur: 4,
        },
      }
    );

    assert(s3AssContent.includes('Style: MinimalGlow'), 'Scenario 3: Chứa Style MinimalGlow');
    assert(s3AssContent.includes('\\blur4'), 'Scenario 3: Hiệu ứng phát sáng dịu viền chữ');
    assert(s3AssContent.includes('\\p1'), 'Scenario 3: Thanh tiến trình đọc vector vẽ mượt');

    const s3AssPath = path.join(tempBaseDir, 'scenario3.ass');
    fs.writeFileSync(s3AssPath, s3AssContent, 'utf-8');

    const s3VideoIn = path.join(tempBaseDir, 'scenario3_in.mp4');
    const s3VideoOut = path.join(tempBaseDir, 'scenario3_out.mp4');
    createSyntheticVideo(s3VideoIn, 11, 1920, 1080, 'midnightblue');
    burnInSubtitles(s3VideoIn, s3AssPath, s3VideoOut);

    assert(fs.existsSync(s3VideoOut) && fs.statSync(s3VideoOut).size > 1000, 'Scenario 3: FFmpeg burn-in video Netflix 16:9 với thanh tiến trình thành công (> 1KB)');

    // ------------------------------------------------------------------------
    // SCENARIO 4: Hardware Failure & Graceful Recovery Pipeline
    // ------------------------------------------------------------------------
    console.log('\n--- Scenario 4: Hardware Failure & Graceful Recovery Pipeline ---');
    const s4AudioPath = path.join(tempBaseDir, 'scenario4_fallback.wav');
    createSyntheticWav(s4AudioPath, 2.0);

    let s4FallbackNotified = false;
    const s4AsrResult = await transcribeUnified(s4AudioPath, {
      asrEngine: 'faster-whisper',
      model: 'tiny',
      customFwChecker: async () => ({
        available: false,
        useCuda: false,
        reason: 'Simulated missing faster-whisper package & missing CUDA GPU',
      }),
      onProgress: (_p, stage) => {
        if (stage && stage.includes('fallback')) {
          s4FallbackNotified = true;
        }
      },
    });

    assert(s4AsrResult.engineUsed === 'whisper-cpp', 'Scenario 4: Router tự động fallback sang whisper-cpp khi phần cứng/môi trường thiếu');
    assert(s4AsrResult.fallbackTriggered === true, 'Scenario 4: Cờ fallbackTriggered được bật true');
    assert(fs.existsSync(s4AsrResult.srtPath), 'Scenario 4: Whisper.cpp sinh file SRT thành công');
    assert(s4FallbackNotified === true, 'Scenario 4: Người dùng nhận được thông báo fallback trong onProgress');

    // Chuyển kết quả fallback qua NLP và Kinetic để kiểm tra tính toàn vẹn 100% của pipeline
    const s4SrtContent = fs.readFileSync(s4AsrResult.srtPath, 'utf-8');
    const s4Parsed = parseSrt(s4SrtContent);

    // Đưa câu mẫu tiếng Việt vào pipeline nếu file synthetic wav rỗng phụ đề thực tế
    const s4SampleLines: SrtLine[] = s4Parsed.length > 0 ? s4Parsed : [
      {
        id: 's4-mock-1',
        startMs: 500,
        endMs: 2000,
        text: 'Hệ thống tự động phục hồi sau lỗi phần cứng và duy trì liên tục tiến trình.',
      },
    ];

    const s4Segmented = segmentSubtitlesNetflix(s4SampleLines);
    assert(s4Segmented.length > 0, 'Scenario 4: Dữ liệu fallback được NLP phân đoạn thành công');

    const s4AssContent = compileToAss(
      s4Segmented.map((l) => ({ startMs: l.startMs, endMs: l.endMs, text: l.text })),
      {
        videoWidth: 1280,
        videoHeight: 720,
        kineticConfig: { preset: 'hormozi' },
      }
    );
    assert(s4AssContent.includes('[Events]'), 'Scenario 4: Hoàn thành biên dịch phụ đề Kinetic sau khi fallback');

    // ========================================================================
    // TIER 5: Adversarial & System Integrity Audit
    // ========================================================================
    console.log('\n--- TIER 5: Adversarial & System Integrity Audit ---');

    // 5.1 Token Sanity Audit (No NaN, undefined, or null in ASS outputs)
    const allAssOutputs = [hormoziAss, mrBeastAss, minimalAss, s1AssContent, s2AssContent, s3AssContent, s4AssContent];
    for (let i = 0; i < allAssOutputs.length; i++) {
      const ass = allAssOutputs[i];
      assert(!ass.includes('NaN'), `Tier 5.1: ASS output #${i + 1} không chứa token NaN`);
      assert(!ass.includes('undefined'), `Tier 5.1: ASS output #${i + 1} không chứa token undefined`);
      assert(!ass.includes('null'), `Tier 5.1: ASS output #${i + 1} không chứa token null`);
      assert(ass.includes('[V4+ Styles]'), `Tier 5.1: ASS output #${i + 1} có [V4+ Styles] chuẩn`);
      assert(ass.includes('[Events]'), `Tier 5.1: ASS output #${i + 1} có [Events] chuẩn`);
    }

    // 5.2 Timecode Monotonicity Strict Verification
    for (const line of [...segmentedLines, ...segmentedMega, ...s1Segmented, ...s2Segmented, ...s3Segmented]) {
      assert(line.startMs < line.endMs, `Tier 5.2: Đảm bảo startMs (${line.startMs}) < endMs (${line.endMs})`);
      assert(line.startMs >= 0, `Tier 5.2: startMs không âm (${line.startMs})`);
    }

    // 5.3 Backward Compatibility with Standard Subtitles (preset: 'none')
    const standardAss = compileToAss(
      [{ startMs: 1000, endMs: 3000, text: 'Phụ đề tiêu chuẩn không hiệu ứng kinetic.' }],
      {
        videoWidth: 1920,
        videoHeight: 1080,
        kineticConfig: { preset: 'none' },
      }
    );
    assert(standardAss.includes('Style: Default'), 'Tier 5.3: Chuẩn Default style được giữ nguyên khi preset: none');
    assert(!standardAss.includes('\\k'), 'Tier 5.3: Không sinh thẻ \\k khi dùng preset: none');
    assert(!standardAss.includes('Style: Hormozi'), 'Tier 5.3: Không chèn Style Hormozi khi preset: none');
    assert(!standardAss.includes('Style: MrBeast'), 'Tier 5.3: Không chèn Style MrBeast khi preset: none');
  } finally {
    // Dọn dẹp thư mục tạm
    try {
      if (fs.existsSync(tempBaseDir)) {
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
      }
    } catch {}
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n=======================================================');
  console.log('🎉 TẤT CẢ CÁC BÀI TEST E2E UPGRADE INTEGRATION ĐÃ ĐẠT 100%!');
  console.log(`📊 Kết quả: ${passedCount}/${totalCount} assertions ĐẠT (100% PASS)`);
  console.log('=======================================================');
}

runAllTests().catch((err) => {
  console.error('Lỗi khi chạy test suite E2E Integration:', err);
  process.exit(1);
});
