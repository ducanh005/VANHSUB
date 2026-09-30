/**
 * Adversarial Stress Test Suite - Milestone 4 (Full Chained Pipeline Stress)
 * Agent: challenger_m4_1 (Empirical Challenger)
 * 
 * Tests the chained pipeline R1 -> R2 -> R3 under extreme boundaries:
 * 1. Monolithic 500+ char unpunctuated continuous sentences.
 * 2. Sub-100ms rapid dialogue (<100ms duration, multi-word bursts, tight gaps).
 * 3. Multi-speaker rapid switching ([SPEAKER_00] .. [SPEAKER_03] high velocity).
 * 4. Rare Vietnamese typography & diacritics (NFD combining, archaic syllables, mixed jargon).
 * 5. Extreme kinetic aspect ratios (1:1, 9:16, 16:9, 21:9, 9:21, 4:3, 320x180, 4K UHD).
 * 6. Combined multi-vector adversarial torture test.
 * 
 * Verifies all layers end-to-end with real FFmpeg libass burn-in rendering.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
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

let passedCount = 0;
let failedCount = 0;
let totalCount = 0;
const failureDetails: string[] = [];

function assert(condition: boolean, description: string, details?: string) {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  ✅ PASS: ${description}`);
  } else {
    failedCount++;
    const msg = `  ❌ FAIL: ${description}${details ? ` -> ${details}` : ''}`;
    console.error(msg);
    failureDetails.push(msg);
  }
}

function createSyntheticVideo(
  videoPath: string,
  durationSec = 2,
  width = 1280,
  height = 720,
  color = 'black'
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

async function runAdversarialStressSuite() {
  const startTime = Date.now();
  console.log('================================================================');
  console.log('⚔️ CHALLENGER M4: ADVERSARIAL SYSTEM STRESS TEST (R1 -> R2 -> R3)');
  console.log('================================================================\n');

  const tempBaseDir = path.join(process.cwd(), 'temp', 'test_challenger_m4_stress');
  fs.mkdirSync(tempBaseDir, { recursive: true });

  try {
    // ========================================================================
    // SUITE 1: MONOLITHIC 500+ CHAR SENTENCE WITHOUT PUNCTUATION
    // ========================================================================
    console.log('--- SUITE 1: Monolithic 500+ Char Sentence Without Punctuation ---');

    // 615 characters, 88 words, ZERO punctuation marks
    const monolithicSentence =
      'Chính phủ Việt Nam cùng các cơ quan ban ngành trung ương và địa phương đang chủ động phối hợp chặt chẽ triển khai đồng bộ các giải pháp chiến lược nhằm thúc đẩy chuyển đổi số toàn diện và phát triển kinh tế số nâng cao năng lực cạnh tranh quốc gia thu hút nguồn vốn đầu tư trực tiếp nước ngoài từ các tập đoàn công nghệ đa quốc gia hàng đầu thế giới tạo điều kiện thuận lợi tối đa cho cộng đồng doanh nghiệp khởi nghiệp đổi mới sáng tạo nghiên cứu ứng dụng trí tuệ nhân tạo bán dẫn và vi mạch điện tử góp phần thực hiện thắng lợi các mục tiêu phát triển kinh tế xã hội bền vững và thịnh vượng lâu dài';

    assert(monolithicSentence.length >= 500, `Suite 1: Câu thử nghiệm có độ dài >= 500 ký tự (thực tế: ${monolithicSentence.length} chars)`);
    assert(!/[,.!?:;—–\-]/.test(monolithicSentence), 'Suite 1: Câu thử nghiệm hoàn toàn không chứa dấu câu');

    // R1: Giả lập ASR Diarization output
    const rawSrt1 = `1\n00:00:01,000 --> 00:00:35,000\n[SPEAKER_00]: ${monolithicSentence}\n`;
    const parsedSrt1 = parseSrt(rawSrt1);
    assert(parsedSrt1.length === 1, 'Suite 1 (R1): Phân tích thành công 1 dòng SRT từ output ASR');
    assert(parsedSrt1[0].speaker === 'SPEAKER_00', 'Suite 1 (R1): Trích xuất chính xác nhãn SPEAKER_00');
    assert(!parsedSrt1[0].text.includes('[SPEAKER_00]:'), 'Suite 1 (R1): Lọc sạch tiền tố speaker khỏi nội dung thoại');

    // R2: Feed vào Vietnamese NLP Netflix Segmenter
    const segmented1 = segmentSubtitlesNetflix(parsedSrt1, {
      maxCharsPerLine: 37,
      maxLinesPerBlock: 2,
      targetCps: 18,
    });

    assert(segmented1.length >= 8, `Suite 1 (R2): Phân rã câu 615 ký tự thành >= 8 blocks (thực tế: ${segmented1.length} blocks)`);

    let s1AllMax2Lines = true;
    let s1AllMax37Chars = true;
    let s1MaxLenSeen = 0;
    let s1WorstLine = '';
    let s1AllSpeakerPreserved = true;
    let s1TimeMonotonic = true;

    for (let i = 0; i < segmented1.length; i++) {
      const block = segmented1[i];
      if (block.speaker !== 'SPEAKER_00') s1AllSpeakerPreserved = false;
      if (block.startMs >= block.endMs) s1TimeMonotonic = false;
      if (i > 0 && segmented1[i - 1].endMs > block.startMs) s1TimeMonotonic = false;

      const lines = block.text.split('\n');
      if (lines.length > 2) s1AllMax2Lines = false;
      for (const l of lines) {
        const len = l.trim().length;
        if (len > s1MaxLenSeen) s1MaxLenSeen = len;
        if (len > 37) {
          s1AllMax37Chars = false;
          s1WorstLine = l.trim();
        }
      }
    }

    assert(s1AllMax2Lines, 'Suite 1 (R2): 100% blocks có số dòng <= 2');
    assert(s1AllMax37Chars, `Suite 1 (R2): 100% dòng tuân thủ <= 37 ký tự (dài nhất: ${s1MaxLenSeen} chars: "${s1WorstLine}")`);
    assert(s1AllSpeakerPreserved, 'Suite 1 (R2): 100% blocks giữ nguyên nhãn SPEAKER_00 qua phép phân rã');
    assert(s1TimeMonotonic, 'Suite 1 (R2): Timecodes đảm bảo tính đơn điệu nghiêm ngặt không chồng lấn');

    // R3: Kinetic ASS Compilation cho 615 chars
    const s1HormoziAss = compileToAss(
      segmented1.map((b) => ({ startMs: b.startMs, endMs: b.endMs, text: b.text, speaker: b.speaker })),
      {
        videoWidth: 1920,
        videoHeight: 1080,
        kineticConfig: { preset: 'hormozi', activeColor: '#FFE500' },
      }
    );
    assert(s1HormoziAss.includes('Style: Hormozi'), 'Suite 1 (R3): Hormozi ASS chứa Style: Hormozi');
    assert(s1HormoziAss.includes('\\k'), 'Suite 1 (R3): Hormozi ASS chứa karaoke tags \\k');
    assert(!s1HormoziAss.includes('NaN'), 'Suite 1 (R3): Hormozi ASS không chứa token NaN');

    const s1MinimalAss = compileToAss(
      segmented1.map((b) => ({ startMs: b.startMs, endMs: b.endMs, text: b.text })),
      {
        videoWidth: 1920,
        videoHeight: 1080,
        kineticConfig: { preset: 'minimalist_glow', enableProgressBar: true },
      }
    );
    assert(s1MinimalAss.includes('\\p1'), 'Suite 1 (R3): Minimalist Glow chứa vector progress bar \\p1');
    assert(!s1MinimalAss.includes('NaN'), 'Suite 1 (R3): Minimalist Glow không chứa NaN');

    // FFmpeg Burn-in test
    const s1AssPath = path.join(tempBaseDir, 'suite1_monolithic.ass');
    fs.writeFileSync(s1AssPath, s1MinimalAss, 'utf-8');
    const s1VideoIn = path.join(tempBaseDir, 'suite1_in.mp4');
    const s1VideoOut = path.join(tempBaseDir, 'suite1_out.mp4');
    createSyntheticVideo(s1VideoIn, 6, 1920, 1080, 'darkblue');
    burnInSubtitles(s1VideoIn, s1AssPath, s1VideoOut);
    assert(fs.existsSync(s1VideoOut) && fs.statSync(s1VideoOut).size > 1000, 'Suite 1 (FFmpeg): Burn-in câu monolithic 615 chars thành công qua libass');

    // ========================================================================
    // SUITE 2: SUB-100MS RAPID DIALOGUE & EXTREME TIME BOUNDARIES
    // ========================================================================
    console.log('\n--- SUITE 2: Sub-100ms Rapid Dialogue & Extreme Time Boundaries ---');

    const rapidSubLines: SrtLine[] = [
      { id: 'sub-1', startMs: 1000, endMs: 1030, text: 'Có!', speaker: 'SPEAKER_00' }, // 30ms single word
      { id: 'sub-2', startMs: 1040, endMs: 1090, text: 'Đi mau!', speaker: 'SPEAKER_01' }, // 50ms 2 words
      { id: 'sub-3', startMs: 1100, endMs: 1180, text: 'Không thể tin được!', speaker: 'SPEAKER_00' }, // 80ms 4 words
      {
        id: 'sub-4',
        startMs: 1200,
        endMs: 1295, // 95ms
        text: 'Bắn ngay!',
        speaker: 'SPEAKER_02',
        words: [
          { word: 'Bắn', startMs: 1200, endMs: 1245 },
          { word: 'ngay', startMs: 1245, endMs: 1295 },
        ],
      },
      // Tight sequential burst
      { id: 'burst-1', startMs: 2000, endMs: 2060, text: 'Này' }, // 60ms
      { id: 'burst-2', startMs: 2080, endMs: 2150, text: 'Gì' }, // 70ms
      { id: 'burst-3', startMs: 2170, endMs: 2250, text: 'Đó' }, // 80ms
    ];

    // R2: Segment with autoPadDuration: true vs minGapMs preservation
    const segmentedRapid = segmentSubtitlesNetflix(rapidSubLines, {
      minDurationMs: 500,
      minGapMs: 50,
      autoPadDuration: true,
    });

    assert(segmentedRapid.length === rapidSubLines.length, `Suite 2 (R2): Giữ đủ ${rapidSubLines.length} dòng phụ đề ngắn`);
    for (let i = 0; i < segmentedRapid.length; i++) {
      const line = segmentedRapid[i];
      assert(line.startMs < line.endMs, `Suite 2 (R2): Line #${i + 1} (${line.text}) đảm bảo startMs < endMs (${line.startMs} < ${line.endMs})`);
      if (i < segmentedRapid.length - 1) {
        assert(line.endMs <= segmentedRapid[i + 1].startMs, `Suite 2 (R2): Line #${i + 1} không chồng lên line #${i + 2} (${line.endMs} <= ${segmentedRapid[i + 1].startMs})`);
      }
    }

    // R3: Calculate word timings for sub-100ms lines
    const sub1Timings = calculateWordTimings(rapidSubLines[0]);
    assert(sub1Timings.length === 1, 'Suite 2 (R3): Line 30ms sinh đúng 1 timing');
    assert(sub1Timings[0].durationCs >= 1, `Suite 2 (R3): durationCs >= 1 centisecond (thực tế: ${sub1Timings[0].durationCs})`);

    const sub3Timings = calculateWordTimings(rapidSubLines[2]);
    assert(sub3Timings.length === 4, 'Suite 2 (R3): Line 80ms 4 từ phân rã đủ 4 timings');
    for (const t of sub3Timings) {
      assert(t.durationCs >= 1, `Suite 2 (R3): Từ "${t.word}" có durationCs >= 1 (thực tế: ${t.durationCs})`);
      assert(t.durationMs >= 50, `Suite 2 (R3): Từ "${t.word}" có durationMs >= 50ms (thực tế: ${t.durationMs})`);
    }

    // Compile into Hormozi, MrBeast, Minimalist Glow
    const rapidHormozi = compileToAss(
      segmentedRapid.map((l) => ({ startMs: l.startMs, endMs: l.endMs, text: l.text })),
      {
        videoWidth: 1280,
        videoHeight: 720,
        kineticConfig: { preset: 'hormozi' },
      }
    );
    assert(!rapidHormozi.includes('NaN'), 'Suite 2 (R3): Hormozi sub-100ms không chứa NaN');
    assert(rapidHormozi.includes('\\k'), 'Suite 2 (R3): Hormozi sub-100ms chứa \\k tags');

    const rapidMrBeast = compileToAss(
      segmentedRapid.map((l) => ({ startMs: l.startMs, endMs: l.endMs, text: l.text })),
      {
        videoWidth: 1280,
        videoHeight: 720,
        kineticConfig: { preset: 'mrbeast' },
      }
    );
    assert(!rapidMrBeast.includes('NaN'), 'Suite 2 (R3): MrBeast sub-100ms không chứa NaN');
    assert(rapidMrBeast.includes('\\fscx130\\fscy130'), 'Suite 2 (R3): MrBeast sub-100ms chứa animation bounce');

    // Libass burn-in test with sub-100ms subtitles
    const s2AssPath = path.join(tempBaseDir, 'suite2_rapid.ass');
    fs.writeFileSync(s2AssPath, rapidHormozi, 'utf-8');
    const s2VideoIn = path.join(tempBaseDir, 'suite2_in.mp4');
    const s2VideoOut = path.join(tempBaseDir, 'suite2_out.mp4');
    createSyntheticVideo(s2VideoIn, 4, 1280, 720, 'darkgreen');
    burnInSubtitles(s2VideoIn, s2AssPath, s2VideoOut);
    assert(fs.existsSync(s2VideoOut) && fs.statSync(s2VideoOut).size > 1000, 'Suite 2 (FFmpeg): Burn-in phụ đề sub-100ms thành công qua libass');

    // ========================================================================
    // SUITE 3: RAPID MULTI-SPEAKER SWITCHING
    // ========================================================================
    console.log('\n--- SUITE 3: Rapid Multi-Speaker Switching ---');

    // 8 rapid exchanges across 4 speakers in under 2.8 seconds
    const multiSpeakerSrtRaw = `1
00:00:00,100 --> 00:00:00,450
[SPEAKER_00]: Nhanh lên, chúng ta sắp muộn rồi!

2
00:00:00,550 --> 00:00:00,900
[SPEAKER_01]: Chờ tôi lấy tài liệu quan trọng đã!

3
00:00:01,000 --> 00:00:01,350
[SPEAKER_02]: Xe đón đã tới cổng chính!

4
00:00:01,450 --> 00:00:01,800
[SPEAKER_03]: Mọi người đã sẵn sàng chưa?

5
00:00:01,900 --> 00:00:02,150
[SPEAKER_00]: Xuất phát ngay thôi!

6
00:00:02,250 --> 00:00:02,450
[SPEAKER_01]: Đi nào!

7
00:00:02,520 --> 00:00:02,680
[SPEAKER_02]: Tiến lên!

8
00:00:02,720 --> 00:00:02,900
[SPEAKER_03]: Rõ rồi!
`;

    const parsedMulti = parseSrt(multiSpeakerSrtRaw);
    assert(parsedMulti.length === 8, 'Suite 3 (R1): Phân tích đủ 8 lượt thoại');
    const speakerSet = new Set(parsedMulti.map((l) => l.speaker));
    assert(speakerSet.size === 4, `Suite 3 (R1): Nhận diện đủ 4 diễn giả riêng biệt (${Array.from(speakerSet).join(', ')})`);
    assert(speakerSet.has('SPEAKER_00') && speakerSet.has('SPEAKER_01') && speakerSet.has('SPEAKER_02') && speakerSet.has('SPEAKER_03'), 'Suite 3 (R1): Nhận diện đúng danh sách SPEAKER_00 .. SPEAKER_03');

    // R2: Netflix NLP Segmentation
    const segmentedMulti = segmentSubtitlesNetflix(parsedMulti, { minGapMs: 40 });
    assert(segmentedMulti.length === 8, 'Suite 3 (R2): Phân đoạn giữ nguyên 8 lượt thoại');

    for (let i = 0; i < segmentedMulti.length; i++) {
      assert(segmentedMulti[i].speaker === parsedMulti[i].speaker, `Suite 3 (R2): Lượt #${i + 1} giữ đúng diễn giả ${parsedMulti[i].speaker}`);
      assert(segmentedMulti[i].startMs < segmentedMulti[i].endMs, `Suite 3 (R2): Lượt #${i + 1} có startMs < endMs`);
      if (i > 0) {
        assert(segmentedMulti[i - 1].endMs <= segmentedMulti[i].startMs, `Suite 3 (R2): Lượt #${i} và #${i + 1} không chồng lấn`);
      }
    }

    // Round-trip SRT serialization
    const reSerializedSrt = serializeSrt(segmentedMulti);
    assert(reSerializedSrt.includes('[SPEAKER_00]: Nhanh lên'), 'Suite 3 (R2): Serialize giữ nhãn SPEAKER_00');
    assert(reSerializedSrt.includes('[SPEAKER_01]: Chờ tôi lấy'), 'Suite 3 (R2): Serialize giữ nhãn SPEAKER_01');
    assert(reSerializedSrt.includes('[SPEAKER_02]: Xe đón đã'), 'Suite 3 (R2): Serialize giữ nhãn SPEAKER_02');
    assert(reSerializedSrt.includes('[SPEAKER_03]: Mọi người đã'), 'Suite 3 (R2): Serialize giữ nhãn SPEAKER_03');

    const reParsed = parseSrt(reSerializedSrt);
    assert(reParsed.length === 8, 'Suite 3 (R2): Re-parse SRT đạt 8 lượt thoại hoàn hảo');

    // R3: Kinetic ASS Compilation
    const multiAssContent = compileToAss(
      segmentedMulti.map((l) => ({ startMs: l.startMs, endMs: l.endMs, text: l.text, speaker: l.speaker })),
      {
        videoWidth: 1920,
        videoHeight: 1080,
        kineticConfig: { preset: 'hormozi', activeColor: '#00F0FF' },
      }
    );
    assert(!multiAssContent.includes('NaN'), 'Suite 3 (R3): Multi-speaker ASS không chứa NaN');
    assert(multiAssContent.includes('Style: Hormozi'), 'Suite 3 (R3): Multi-speaker ASS có Style Hormozi');

    // FFmpeg Burn-in test
    const s3AssPath = path.join(tempBaseDir, 'suite3_multispeaker.ass');
    fs.writeFileSync(s3AssPath, multiAssContent, 'utf-8');
    const s3VideoIn = path.join(tempBaseDir, 'suite3_in.mp4');
    const s3VideoOut = path.join(tempBaseDir, 'suite3_out.mp4');
    createSyntheticVideo(s3VideoIn, 4, 1920, 1080, 'purple');
    burnInSubtitles(s3VideoIn, s3AssPath, s3VideoOut);
    assert(fs.existsSync(s3VideoOut) && fs.statSync(s3VideoOut).size > 1000, 'Suite 3 (FFmpeg): Burn-in video multi-speaker 4 diễn giả thành công qua libass');

    // ========================================================================
    // SUITE 4: RARE VIETNAMESE DIACRITICS & EXTREME TYPOGRAPHY
    // ========================================================================
    console.log('\n--- SUITE 4: Rare Vietnamese Diacritics & Extreme Typography ---');

    // 4.1 NFD combining accents vs NFC precomposed
    const baseText = 'Việt Nam đang phát triển vượt bậc về công nghệ.';
    const nfdText = baseText.normalize('NFD');
    const nfcText = baseText.normalize('NFC');
    assert(nfdText !== nfcText, 'Suite 4.1: Chuỗi NFD và NFC khác biệt về biểu diễn byte mã Unicode');
    assert(nfdText.length > nfcText.length, 'Suite 4.1: Chuỗi NFD dài hơn chuỗi NFC do tách riêng combining marks');

    const nfdLine: SrtLine = { id: 'nfd-1', startMs: 1000, endMs: 4000, text: nfdText, speaker: 'SPEAKER_00' };
    const segmentedNfd = segmentSubtitlesNetflix([nfdLine]);
    assert(segmentedNfd.length >= 1, 'Suite 4.1 (R2): NLP xử lý thành công chuỗi NFD combining accents');
    const nfdAss = compileToAss(
      segmentedNfd.map((l) => ({ startMs: l.startMs, endMs: l.endMs, text: l.text })),
      { videoWidth: 1280, videoHeight: 720, kineticConfig: { preset: 'hormozi' } }
    );
    assert(!nfdAss.includes('NaN'), 'Suite 4.1 (R3): NFD ASS không chứa NaN');
    assert(nfdAss.includes('VIỆT') || nfdAss.includes('VIỆT'.normalize('NFD')), 'Suite 4.1 (R3): Chuyển đổi chữ hoa bảo toàn ký tự');

    // 4.2 Archaic, rare, complex tone-mark Vietnamese syllables
    const rarePhonetics =
      'Ngẫm thuở quởn quanh, nghễu nghện nghểnh cổ qua khuỷu tay ngoẵng quỷnh chân rớt xoãng chậu nước sũng nhẫy thoảng trĩu nặng.';
    const rareLine: SrtLine = { id: 'rare-1', startMs: 5000, endMs: 9000, text: rarePhonetics };
    const segmentedRare = segmentSubtitlesNetflix([rareLine]);
    for (const b of segmentedRare) {
      for (const line of b.text.split('\n')) {
        assert(line.length <= 37, `Suite 4.2 (R2): Dòng từ hiếm <= 37 ký tự (${line.length}: "${line}")`);
      }
    }
    const rareAss = compileToAss(
      segmentedRare.map((l) => ({ startMs: l.startMs, endMs: l.endMs, text: l.text })),
      { videoWidth: 1280, videoHeight: 720, kineticConfig: { preset: 'mrbeast', enableEmoji: false } }
    );
    assert(rareAss.includes('Style: MrBeast'), 'Suite 4.2 (R3): Chứa Style MrBeast');
    assert(rareAss.includes('QUỞN') || rareAss.includes('NGHỄU'), 'Suite 4.2 (R3): Viết hoa chuẩn xác các âm tiết cổ/hiếm');

    // 4.3 High-density technical jargon, mixed symbols, numbers, currencies & emojis
    const techJargonText =
      'Cụm 64x GPU NVIDIA H100 SXM5 80GB xử lý 2.500.000 token/giây với độ trễ p99 < 1,8ms, tiết kiệm 120,5 tỷ VND và 5,2 triệu USD chi phí!';
    const techLine: SrtLine = { id: 'tech-1', startMs: 10000, endMs: 15000, text: techJargonText };
    const segmentedTech = segmentSubtitlesNetflix([techLine]);
    for (const b of segmentedTech) {
      for (const line of b.text.split('\n')) {
        if (line.includes('120,5')) {
          assert(line.includes('120,5 tỷ VND'), 'Suite 4.3 (R2): Bảo toàn cụm số tiền "120,5 tỷ VND" trên cùng 1 dòng');
        }
        if (line.includes('5,2')) {
          assert(line.includes('5,2 triệu USD'), 'Suite 4.3 (R2): Bảo toàn cụm số tiền "5,2 triệu USD" trên cùng 1 dòng');
        }
      }
    }

    const techMrBeastAss = compileToAss(
      segmentedTech.map((l) => ({ startMs: l.startMs, endMs: l.endMs, text: l.text })),
      {
        videoWidth: 1080,
        videoHeight: 1920,
        kineticConfig: { preset: 'mrbeast', enableEmoji: true, emojiFrequency: 'high' },
      }
    );
    assert(techMrBeastAss.includes('💰'), 'Suite 4.3 (R3): Tự động phát hiện từ khóa tiền tệ và chèn emoji 💰');
    assert(techMrBeastAss.includes('\\c&H0066FF00&'), 'Suite 4.3 (R3): Chèn mã màu highlight tiền tệ ASS tương ứng (#00FF66)');

    // 4.4 Mixed special quotes, guillemets, em-dashes
    const quoteText =
      '«"Trí tuệ nhân tạo (AI)"—theo Báo cáo Q3/2026—sẽ tự động hoá 99,8% tác vụ và bùng nổ tăng 250% ROI!»';
    const quoteLine: SrtLine = { id: 'quote-1', startMs: 16000, endMs: 20000, text: quoteText };
    const segmentedQuote = segmentSubtitlesNetflix([quoteLine]);
    const quoteAss = compileToAss(
      segmentedQuote.map((l) => ({ startMs: l.startMs, endMs: l.endMs, text: l.text })),
      { videoWidth: 1920, videoHeight: 1080, kineticConfig: { preset: 'minimalist_glow', enableProgressBar: true } }
    );
    assert(!quoteAss.includes('NaN'), 'Suite 4.4 (R3): ASS trích dẫn ký tự đặc biệt không chứa NaN');
    assert(quoteAss.includes('«') && quoteAss.includes('»'), 'Suite 4.4 (R3): Giữ nguyên dấu ngoặc kép kiểu Pháp (« »)');

    // Libass burn-in test for rare Vietnamese diacritics
    const s4AssPath = path.join(tempBaseDir, 'suite4_typography.ass');
    fs.writeFileSync(s4AssPath, quoteAss, 'utf-8');
    const s4VideoIn = path.join(tempBaseDir, 'suite4_in.mp4');
    const s4VideoOut = path.join(tempBaseDir, 'suite4_out.mp4');
    createSyntheticVideo(s4VideoIn, 5, 1920, 1080, 'darkslategray');
    burnInSubtitles(s4VideoIn, s4AssPath, s4VideoOut);
    assert(fs.existsSync(s4VideoOut) && fs.statSync(s4VideoOut).size > 1000, 'Suite 4 (FFmpeg): Burn-in typography tiếng Việt phức tạp thành công qua libass');

    // ========================================================================
    // SUITE 5: EXTREME KINETIC ASPECT RATIOS & DYNAMIC RESOLUTIONS
    // ========================================================================
    console.log('\n--- SUITE 5: Extreme Kinetic Aspect Ratios & Dynamic Resolutions ---');

    const ASPECT_RATIO_TARGETS = [
      { name: '1:1 Square (Instagram)', width: 1080, height: 1080 },
      { name: '9:16 Vertical (TikTok/Shorts)', width: 1080, height: 1920 },
      { name: '16:9 Landscape (HD Standard)', width: 1920, height: 1080 },
      { name: '21:9 Ultra-Wide (Cinematic)', width: 2560, height: 1080 },
      { name: '9:21 Ultra-Tall (Smartphone)', width: 1080, height: 2520 },
      { name: '4:3 Retro SD', width: 800, height: 600 },
      { name: 'Tiny Proxy (Extreme Low)', width: 320, height: 180 },
      { name: '4K UHD (Extreme High)', width: 3840, height: 2160 },
    ];

    const testSubtitleItem: CompileSubtitleItem = {
      startMs: 1000,
      endMs: 3000,
      text: 'Thử nghiệm tỷ lệ khung hình động',
    };

    for (const target of ASPECT_RATIO_TARGETS) {
      const { name, width, height } = target;

      // 1. Test Minimalist Glow (Progress Bar Geometry Verification)
      const glowAss = compileToAss([testSubtitleItem], {
        videoWidth: width,
        videoHeight: height,
        kineticConfig: { preset: 'minimalist_glow', enableProgressBar: true },
      });

      assert(glowAss.includes(`PlayResX: ${width}`), `Suite 5 [${name}]: PlayResX đúng ${width}`);
      assert(glowAss.includes(`PlayResY: ${height}`), `Suite 5 [${name}]: PlayResY đúng ${height}`);
      assert(!glowAss.includes('NaN'), `Suite 5 [${name}]: Không chứa NaN trong ASS`);

      // Trích xuất tọa độ thanh tiến trình \pos(X, Y)
      const posMatch = glowAss.match(/\\pos\((\d+),(\d+)\)/);
      assert(posMatch !== null, `Suite 5 [${name}]: Tìm thấy thẻ \\pos cho vector progress bar`);
      if (posMatch) {
        const posX = parseInt(posMatch[1], 10);
        const posY = parseInt(posMatch[2], 10);
        assert(posX >= 0 && posX < width, `Suite 5 [${name}]: Tọa độ posX=${posX} nằm trong màn hình (0..${width})`);
        assert(posY > 0 && posY <= height, `Suite 5 [${name}]: Tọa độ posY=${posY} nằm trong màn hình (0..${height})`);
      }

      // 2. Test Hormozi
      const hormoziAss = compileToAss([testSubtitleItem], {
        videoWidth: width,
        videoHeight: height,
        kineticConfig: { preset: 'hormozi' },
      });
      assert(hormoziAss.includes('Style: Hormozi'), `Suite 5 [${name}]: Hormozi style được khởi tạo`);
      assert(!hormoziAss.includes('NaN'), `Suite 5 [${name}]: Hormozi không chứa NaN`);

      // 3. Test MrBeast
      const mrbeastAss = compileToAss([testSubtitleItem], {
        videoWidth: width,
        videoHeight: height,
        kineticConfig: { preset: 'mrbeast' },
      });
      assert(mrbeastAss.includes('Style: MrBeast'), `Suite 5 [${name}]: MrBeast style được khởi tạo`);
      assert(!mrbeastAss.includes('NaN'), `Suite 5 [${name}]: MrBeast không chứa NaN`);
    }

    // Libass Burn-in across Extreme Aspect Ratios:
    // A) 1:1 Square (1080x1080)
    console.log('--- Suite 5 Burn-In: 1:1 Square (1080x1080) ---');
    const s5AssPathSquare = path.join(tempBaseDir, 'suite5_square.ass');
    const s5SquareAss = compileToAss([testSubtitleItem], {
      videoWidth: 1080,
      videoHeight: 1080,
      kineticConfig: { preset: 'minimalist_glow', enableProgressBar: true },
    });
    fs.writeFileSync(s5AssPathSquare, s5SquareAss, 'utf-8');
    const s5VideoInSquare = path.join(tempBaseDir, 'suite5_square_in.mp4');
    const s5VideoOutSquare = path.join(tempBaseDir, 'suite5_square_out.mp4');
    createSyntheticVideo(s5VideoInSquare, 2, 1080, 1080, 'darkmagenta');
    burnInSubtitles(s5VideoInSquare, s5AssPathSquare, s5VideoOutSquare);
    assert(fs.existsSync(s5VideoOutSquare) && fs.statSync(s5VideoOutSquare).size > 1000, 'Suite 5 (FFmpeg): Burn-in 1:1 Square 1080x1080 thành công');

    // B) 21:9 Ultra-Wide (2560x1080)
    console.log('--- Suite 5 Burn-In: 21:9 Ultra-Wide (2560x1080) ---');
    const s5AssPathUltrawide = path.join(tempBaseDir, 'suite5_ultrawide.ass');
    const s5UltrawideAss = compileToAss([testSubtitleItem], {
      videoWidth: 2560,
      videoHeight: 1080,
      kineticConfig: { preset: 'hormozi', activeColor: '#FFE500' },
    });
    fs.writeFileSync(s5AssPathUltrawide, s5UltrawideAss, 'utf-8');
    const s5VideoInUltrawide = path.join(tempBaseDir, 'suite5_ultrawide_in.mp4');
    const s5VideoOutUltrawide = path.join(tempBaseDir, 'suite5_ultrawide_out.mp4');
    createSyntheticVideo(s5VideoInUltrawide, 2, 2560, 1080, 'black');
    burnInSubtitles(s5VideoInUltrawide, s5AssPathUltrawide, s5VideoOutUltrawide);
    assert(fs.existsSync(s5VideoOutUltrawide) && fs.statSync(s5VideoOutUltrawide).size > 1000, 'Suite 5 (FFmpeg): Burn-in 21:9 Ultra-Wide 2560x1080 thành công');

    // C) 9:21 Ultra-Tall (1080x2520)
    console.log('--- Suite 5 Burn-In: 9:21 Ultra-Tall (1080x2520) ---');
    const s5AssPathTall = path.join(tempBaseDir, 'suite5_tall.ass');
    const s5TallAss = compileToAss([testSubtitleItem], {
      videoWidth: 1080,
      videoHeight: 2520,
      kineticConfig: { preset: 'mrbeast', enableEmoji: true },
    });
    fs.writeFileSync(s5AssPathTall, s5TallAss, 'utf-8');
    const s5VideoInTall = path.join(tempBaseDir, 'suite5_tall_in.mp4');
    const s5VideoOutTall = path.join(tempBaseDir, 'suite5_tall_out.mp4');
    createSyntheticVideo(s5VideoInTall, 2, 1080, 2520, 'darkred');
    burnInSubtitles(s5VideoInTall, s5AssPathTall, s5VideoOutTall);
    assert(fs.existsSync(s5VideoOutTall) && fs.statSync(s5VideoOutTall).size > 1000, 'Suite 5 (FFmpeg): Burn-in 9:21 Ultra-Tall 1080x2520 thành công');

    // ========================================================================
    // SUITE 6: COMBINED MULTI-VECTOR ADVERSARIAL TORTURE TEST
    // ========================================================================
    console.log('\n--- SUITE 6: Combined Multi-Vector Adversarial Torture Test ---');

    // Kết hợp đồng thời:
    // - 4 alternating speakers
    // - Monolithic 500+ unpunctuated sentence
    // - Rapid sub-100ms dialogue bursts
    // - Rare Vietnamese typography & diacritics
    // - Tested end-to-end on 21:9 Ultra-Wide and 9:16 Vertical resolutions
    const tortureSrtRaw = `1
00:00:01,000 --> 00:00:01,050
[SPEAKER_00]: Có!

2
00:00:01,100 --> 00:00:01,180
[SPEAKER_01]: Đi ngay bây giờ!

3
00:00:01,250 --> 00:00:20,000
[SPEAKER_02]: ${monolithicSentence}

4
00:00:20,100 --> 00:00:23,500
[SPEAKER_03]: ${techJargonText}

5
00:00:23,600 --> 00:00:27,000
[SPEAKER_00]: ${rarePhonetics}

6
00:00:27,050 --> 00:00:27,099
[SPEAKER_01]: Nhanh!
`;

    const parsedTorture = parseSrt(tortureSrtRaw);
    assert(parsedTorture.length === 6, 'Suite 6 (R1): Parse được 6 mốc thoại torture');

    const segmentedTorture = segmentSubtitlesNetflix(parsedTorture, {
      maxCharsPerLine: 37,
      maxLinesPerBlock: 2,
      targetCps: 18,
      minGapMs: 50,
    });

    assert(segmentedTorture.length >= 13, `Suite 6 (R2): Torture test rã thành >= 13 blocks (thực tế: ${segmentedTorture.length})`);

    let tortureCompliant = true;
    for (let i = 0; i < segmentedTorture.length; i++) {
      const b = segmentedTorture[i];
      if (b.startMs >= b.endMs) tortureCompliant = false;
      if (i > 0 && segmentedTorture[i - 1].endMs > b.startMs) tortureCompliant = false;
      const bLines = b.text.split('\n');
      if (bLines.length > 2) tortureCompliant = false;
      for (const l of bLines) {
        if (l.trim().length > 37) tortureCompliant = false;
      }
    }
    assert(tortureCompliant, 'Suite 6 (R2): 100% blocks trong kịch bản torture tuân thủ nghiêm ngặt <= 2 dòng, <= 37 ký tự và timecode đơn điệu');

    // Chained compilation to Hormozi & Minimalist Glow
    const tortureAss = compileToAss(
      segmentedTorture.map((b) => ({ startMs: b.startMs, endMs: b.endMs, text: b.text, speaker: b.speaker })),
      {
        videoWidth: 2560,
        videoHeight: 1080,
        kineticConfig: { preset: 'minimalist_glow', enableProgressBar: true },
      }
    );
    assert(!tortureAss.includes('NaN'), 'Suite 6 (R3): Torture ASS không chứa token NaN');
    assert(tortureAss.includes('PlayResX: 2560'), 'Suite 6 (R3): PlayResX đúng 2560');

    // Video burn-in for torture scenario
    const s6AssPath = path.join(tempBaseDir, 'suite6_torture.ass');
    fs.writeFileSync(s6AssPath, tortureAss, 'utf-8');
    const s6VideoIn = path.join(tempBaseDir, 'suite6_in.mp4');
    const s6VideoOut = path.join(tempBaseDir, 'suite6_out.mp4');
    createSyntheticVideo(s6VideoIn, 6, 2560, 1080, 'darkblue');
    burnInSubtitles(s6VideoIn, s6AssPath, s6VideoOut);
    assert(fs.existsSync(s6VideoOut) && fs.statSync(s6VideoOut).size > 1000, 'Suite 6 (FFmpeg): Burn-in kịch bản torture đa vector thành công qua libass');
  } finally {
    // Dọn dẹp thư mục tạm
    try {
      if (fs.existsSync(tempBaseDir)) {
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
      }
    } catch {}
  }

  const elapsedMs = Date.now() - startTime;
  console.log('\n=======================================================');
  console.log('📊 KẾT QUẢ ĐÁNH GIÁ ADVERSARIAL STRESS TEST (CHALLENGER 1)');
  console.log(`⏱️ Thời gian thực thi: ${(elapsedMs / 1000).toFixed(2)}s`);
  console.log(`🎯 Tổng assertions: ${totalCount}`);
  console.log(`✅ Passed: ${passedCount}`);
  console.log(`❌ Failed: ${failedCount}`);
  console.log('=======================================================');

  if (failedCount > 0) {
    console.error('\nChi tiết các assertions thất bại:');
    failureDetails.forEach((f) => console.error(f));
    process.exit(1);
  } else {
    console.log('🎉 100% CÁC BÀI TEST ADVERSARIAL STRESS ĐÃ VƯỢT QUA XUẤT SẮC!');
    process.exit(0);
  }
}

runAdversarialStressSuite().catch((err) => {
  console.error('Unhandled error in Challenger M4 stress suite:', err);
  process.exit(1);
});
