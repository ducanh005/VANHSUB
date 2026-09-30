/**
 * Adversarial Stress Test Suite: Kinetic Subtitles Engine & Presets (Milestone 3)
 * Author: Challenger M3 (Teamwork Adversarial Stress Challenger)
 *
 * Rigorous empirical testing under hostile, boundary, and adversarial conditions:
 * - SUITE 1: Extreme Word Counts & Subtitle Durations (0 dur, inverted dur, 1 word, 50-120 words, empty text, whitespace, corrupt timestamps)
 * - SUITE 2: Special Characters & ASS Injection Attacks (\, {, }, ", ', \N, raw newlines, \b1 tags, diacritics, HTML/XML)
 * - SUITE 3: MrBeast Emoji Placement, Throttling & Priority Stress (multi-keyword, same-category, 8-tier priority ladder, line throttling, false-positive boundaries)
 * - SUITE 4: Non-Standard Video Dimensions & Geometry Math (720x1280, 2160x3840, 1080x1080, 1080x1350, 21:9 ultrawide, tiny, 0x0 fallback)
 * - SUITE 5: Full Libass Burn-In via FFmpeg (End-to-End Hardsub Render under Stress)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import {
  calculateWordTimings,
  detectEmoji,
  compileHormozi,
  compileMrBeast,
  compileMinimalistGlow,
  compileKineticDialogue,
  EMOJI_RULES,
  type KineticConfig,
  type WordTiming,
} from '../main/render/kineticEngine';
import {
  compileToAss,
  hexToAssColor,
  formatAssTime,
  type CompileSubtitleItem,
} from '../main/render/assCompiler';
import type { SrtLine } from '../main/lib/srt';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures: string[] = [];

function check(cond: boolean, desc: string, details?: string) {
  totalTests++;
  if (cond) {
    passedTests++;
    console.log(`  ✅ PASS: ${desc}`);
  } else {
    failedTests++;
    const msg = `  ❌ FAIL: ${desc}${details ? ` -> ${details}` : ''}`;
    console.error(msg);
    failures.push(msg);
  }
}

async function runAdversarialTests() {
  console.log('================================================================');
  console.log('🔥 CHALLENGER M3: ADVERSARIAL STRESS TEST SUITE (KINETIC SUBTITLES)');
  console.log('================================================================\n');

  // ==========================================================================
  // SUITE 1: EXTREME WORD COUNTS & SUBTITLE DURATIONS
  // ==========================================================================
  console.log('--- SUITE 1: Extreme Word Counts & Subtitle Durations ---');

  // 1.1: Empty text line
  {
    const emptyLine: SrtLine = {
      id: 'adv-empty',
      startMs: 1000,
      endMs: 3000,
      text: '',
    };
    const timings = calculateWordTimings(emptyLine);
    check(Array.isArray(timings) && timings.length === 0, 'Dòng trống: calculateWordTimings trả về mảng rỗng [] không lỗi');

    const hormozi = compileHormozi(emptyLine, { preset: 'hormozi' }, 0, { videoWidth: 1080, videoHeight: 1920 });
    check(hormozi.dialogueEvents.length === 1, 'Dòng trống: Hormozi sinh đúng 1 Dialogue event');
    check(!hormozi.dialogueEvents[0].includes('NaN'), 'Dòng trống: Hormozi không chứa NaN');

    const mrbeast = compileMrBeast(emptyLine, { preset: 'mrbeast' }, 0, { videoWidth: 1080, videoHeight: 1920 });
    check(mrbeast.dialogueEvents.length === 1, 'Dòng trống: MrBeast sinh đúng 1 Dialogue event');

    const glow = compileMinimalistGlow(emptyLine, { preset: 'minimalist_glow', enableProgressBar: true }, 0, { videoWidth: 1080, videoHeight: 1920 });
    check(glow.dialogueEvents.length === 3, 'Dòng trống: Minimalist Glow sinh đủ 3 layers');
  }

  // 1.2: Whitespace-only line with tabs, newlines
  {
    const wsLine: SrtLine = {
      id: 'adv-whitespace',
      startMs: 2000,
      endMs: 4000,
      text: '   \t  \r\n   \n   ',
    };
    const timings = calculateWordTimings(wsLine);
    check(timings.length === 0, 'Dòng toàn whitespace/tabs/newlines: timings rỗng');
    const compiled = compileToAss([{ startMs: wsLine.startMs, endMs: wsLine.endMs, text: wsLine.text }], {
      kineticConfig: { preset: 'hormozi' },
      videoWidth: 1080,
      videoHeight: 1920,
    });
    check(!compiled.includes('undefined') && !compiled.includes('NaN'), 'Dòng toàn whitespace: ASS compile không có undefined/NaN');
  }

  // 1.3: Single word line
  {
    const singleWordLine: SrtLine = {
      id: 'adv-single',
      startMs: 1000,
      endMs: 2500,
      text: 'VanhSub',
    };
    const timings = calculateWordTimings(singleWordLine);
    check(timings.length === 1, 'Dòng 1 từ: timings trả về đúng 1 phần tử');
    check(timings[0].word === 'VanhSub' && timings[0].startMs === 0 && timings[0].endMs === 1500, 'Dòng 1 từ: bao trọn toàn bộ thời lượng 1500ms');
    check(timings[0].durationCs === 150, 'Dòng 1 từ: durationCs = 150 (1500ms / 10)');

    const hormozi = compileHormozi(singleWordLine, { preset: 'hormozi' }, 0, { videoWidth: 1080, videoHeight: 1920 });
    check(hormozi.dialogueEvents[0].includes('{\\k150'), 'Dòng 1 từ: thẻ \\k150 được tạo chuẩn xác');
  }

  // 1.4: Massive word count (60 words and 120 words)
  {
    const words60 = Array.from({ length: 60 }, (_, i) => `Từ${i + 1}`).join(' ');
    const line60: SrtLine = {
      id: 'adv-60words',
      startMs: 0,
      endMs: 6000, // 6s duration
      text: words60,
    };
    const timings60 = calculateWordTimings(line60);
    check(timings60.length === 60, 'Dòng 60 từ: phân tách đủ 60 từ');
    check(timings60.every((w) => w.durationCs >= 1), 'Dòng 60 từ: mọi từ có durationCs >= 1');
    check(timings60.every((w) => Number.isFinite(w.startMs) && Number.isFinite(w.durationMs)), 'Dòng 60 từ: mọi mốc thời gian là số hữu hạn');

    // Kiểm tra tính đơn điệu không giảm của startMs
    let isMonotonic = true;
    for (let i = 1; i < timings60.length; i++) {
      if (timings60[i].startMs < timings60[i - 1].startMs) isMonotonic = false;
    }
    check(isMonotonic, 'Dòng 60 từ: startMs tăng dần đơn điệu qua từng từ');

    // 120 words
    const words120 = Array.from({ length: 120 }, (_, i) => `Word${i + 1}`).join(' ');
    const line120: SrtLine = {
      id: 'adv-120words',
      startMs: 0,
      endMs: 5000,
      text: words120,
    };
    const timings120 = calculateWordTimings(line120);
    check(timings120.length === 120, 'Dòng 120 từ: phân tách đủ 120 từ');
    const hormozi120 = compileHormozi(line120, { preset: 'hormozi' }, 0, { videoWidth: 1080, videoHeight: 1920 });
    check(hormozi120.dialogueEvents[0].length > 1000, 'Dòng 120 từ: Hormozi biên dịch thành công chuỗi dài');
  }

  // 1.5: Zero duration line (startMs === endMs)
  {
    const zeroDurLine: SrtLine = {
      id: 'adv-zero-dur',
      startMs: 3000,
      endMs: 3000,
      text: 'Câu thoại thời lượng bằng không',
    };
    const timings = calculateWordTimings(zeroDurLine);
    check(timings.length === 6, 'Dòng 0ms duration: timings vẫn phân tách đủ từ');
    check(timings.every((t) => t.durationMs >= 50 && t.durationCs >= 1), 'Dòng 0ms duration: tự động clamp duration tối thiểu >= 50ms (>=1 cs)');

    const glow = compileMinimalistGlow(zeroDurLine, { preset: 'minimalist_glow', enableProgressBar: true }, 0, { videoWidth: 1080, videoHeight: 1920 });
    check(glow.dialogueEvents[1].includes('\\t(0,150,\\fscx100)'), 'Dòng 0ms duration: Glow clamp durationMs tối thiểu 150ms để tránh animation chia cho 0');
  }

  // 1.6: Inverted duration line (startMs > endMs)
  {
    const invertedLine: SrtLine = {
      id: 'adv-inverted',
      startMs: 5000,
      endMs: 2000, // endMs < startMs
      text: 'Thời gian bị đảo ngược',
    };
    const timings = calculateWordTimings(invertedLine);
    check(timings.length === 5, 'Dòng đảo ngược thời gian: calculateWordTimings xử lý an toàn không sập');
    check(timings.every((t) => Number.isFinite(t.durationCs) && t.durationCs > 0), 'Dòng đảo ngược: durationCs luôn dương và hữu hạn');
  }

  // 1.7: Corrupt / Malformed Whisper word timestamps
  {
    const malformedWordsLine: SrtLine = {
      id: 'adv-malformed-words',
      startMs: 1000,
      endMs: 4000,
      text: 'Từ một từ hai từ ba',
      words: [
        { word: 'Từ', startMs: 500, endMs: 200 }, // endMs < startMs & startMs < line.startMs
        { word: '   ', startMs: 1200, endMs: 1500 }, // Empty whitespace word
        { word: 'một', startMs: -999, endMs: -500 }, // Negative timestamps
        { word: 'hai', startMs: 2000, endMs: 2000 }, // 0ms duration
        { word: 'ba', startMs: 99999, endMs: 100500 }, // Way past line end
      ],
    };
    const timings = calculateWordTimings(malformedWordsLine);
    check(timings.length > 0, 'Malformed Whisper timestamps: timings trích xuất thành công');
    check(!timings.some((t) => t.word === ''), 'Malformed Whisper timestamps: loại bỏ từ rỗng whitespace');
    check(timings.every((t) => t.startMs >= 0), 'Malformed Whisper timestamps: mọi startMs >= 0 (được clamp không âm)');
    check(timings.every((t) => t.durationMs >= 50 && t.durationCs >= 1), 'Malformed Whisper timestamps: mọi durationMs >= 50ms');
  }

  // ==========================================================================
  // SUITE 2: SPECIAL CHARACTERS & ASS INJECTION ATTACKS
  // ==========================================================================
  console.log('\n--- SUITE 2: Special Characters & ASS Injection Attacks ---');

  // 2.1: Quotes and apostrophes
  {
    const quoteText = 'Anh ấy nói: "Tôi yêu \'VanhSub\' rất nhiều!"';
    const line: SrtLine = { id: 'adv-quotes', startMs: 0, endMs: 2000, text: quoteText };

    const hormozi = compileHormozi(line, { preset: 'hormozi' }, 0, { videoWidth: 1080, videoHeight: 1920 });
    check(hormozi.dialogueEvents[0].includes('"') && hormozi.dialogueEvents[0].includes("'"), 'Quotes: Ký tự nháy kép và nháy đơn được giữ nguyên vẹn');

    const mrbeast = compileMrBeast(line, { preset: 'mrbeast' }, 0, { videoWidth: 1080, videoHeight: 1920 });
    check(mrbeast.dialogueEvents[0].includes('"'), 'Quotes: MrBeast không làm mất nháy kép');
  }

  // 2.2: Backslashes & Windows Paths
  {
    const pathText = 'Đường dẫn tệp: C:\\Windows\\System32\\drivers\\etc\\hosts';
    const line: SrtLine = { id: 'adv-backslash', startMs: 0, endMs: 2000, text: pathText };

    const glow = compileMinimalistGlow(line, { preset: 'minimalist_glow' }, 0, { videoWidth: 1080, videoHeight: 1920 });
    check(glow.dialogueEvents[glow.dialogueEvents.length - 1].includes('C:\\Windows'), 'Backslashes: Dòng chứa backslash Windows path không làm hỏng cú pháp ASS');
  }

  // 2.3: ASS Override tags injection attempt (e.g. {\b1}, {\c&H0000FF&}, {\p1})
  {
    const injectionText = 'Thử nghiệm {\\b1}{\\c&H0000FF&}Màu Xanh{\\r} và {\\p1}m 0 0 l 10 10{\\p0} vector';
    const line: SrtLine = { id: 'adv-inject', startMs: 1000, endMs: 3000, text: injectionText };

    const ass = compileToAss([{ startMs: line.startMs, endMs: line.endMs, text: line.text }], {
      kineticConfig: { preset: 'mrbeast' },
      videoWidth: 1080,
      videoHeight: 1920,
    });

    check(ass.includes('[V4+ Styles]'), 'ASS Injection: Section [V4+ Styles] vẫn nguyên vẹn');
    check(ass.includes('[Events]'), 'ASS Injection: Section [Events] không bị phá vỡ');
    check(ass.includes('Dialogue: 0,'), 'ASS Injection: Dòng Dialogue được định dạng hợp lệ');
  }

  // 2.4: Raw newlines and carriage returns in text
  {
    const multilineText = 'Dòng 1\r\nDòng 2\nDòng 3\rDòng 4';
    const line: SrtLine = { id: 'adv-newlines', startMs: 0, endMs: 2000, text: multilineText };

    const hormozi = compileHormozi(line, { preset: 'hormozi' }, 0, { videoWidth: 1080, videoHeight: 1920 });
    const dialogueLine = hormozi.dialogueEvents[0];
    check(!dialogueLine.includes('\r') && !dialogueLine.includes('\n'), 'Raw Newlines: Toàn bộ ký tự xuống dòng thô được chuyển thành ký hiệu ASS hợp lệ, không có literal newline');

    const mrbeast = compileMrBeast(line, { preset: 'mrbeast' }, 0, { videoWidth: 1080, videoHeight: 1920 });
    check(!mrbeast.dialogueEvents[0].includes('\r') && !mrbeast.dialogueEvents[0].includes('\n'), 'Raw Newlines: MrBeast loại bỏ hoàn toàn raw newline');
  }

  // 2.5: Complex symbols, XML/HTML tags and Vietnamese diacritics
  {
    const symbolText = '<font color="#FF0000">100% #1 @VanhSub & "Đỉnh Cao"?!</font> (Cực Phẩm)';
    const line: SrtLine = { id: 'adv-symbols', startMs: 0, endMs: 2000, text: symbolText };

    const ass = compileToAss([{ startMs: line.startMs, endMs: line.endMs, text: line.text }], {
      kineticConfig: { preset: 'hormozi' },
      videoWidth: 1080,
      videoHeight: 1920,
    });
    check(!ass.includes('NaN') && !ass.includes('undefined'), 'HTML/XML + Symbols: Biên dịch ASS an toàn không sinh NaN/undefined');
  }

  // ==========================================================================
  // SUITE 3: MRBEAST EMOJI PLACEMENT, THROTTLING & PRIORITY STRESS
  // ==========================================================================
  console.log('\n--- SUITE 3: MrBeast Emoji Placement, Throttling & Priority Stress ---');

  // 3.1: Mega-Emotional Sentence with ALL 8 categories present simultaneously
  {
    // Money(10), Energy(9), Shock(8), Danger(8), Speed(7), Champion(7), Humor(6), Love(5)
    const megaText = 'Tôi vừa kiếm một triệu đô tiền mặt và cảm thấy đỉnh cao bùng nổ, trời ơi cảnh báo nguy hiểm thời gian trôi nhanh vô địch haha yêu bạn';
    const match = detectEmoji(megaText, 'high', 0);
    check(match !== null, 'Tất cả 8 danh mục cùng xuất hiện: phát hiện emoji');
    check(match?.emoji === '💰', 'Tất cả 8 danh mục cùng xuất hiện: Ưu tiên tuyệt đối danh mục Money 💰 (Priority 10)');
    check(match?.priority === 10, 'Priority nhận được là 10');

    // Compile MrBeast for this line
    const line: SrtLine = { id: 'adv-mega-emoji', startMs: 0, endMs: 3000, text: megaText };
    const mrbeast = compileMrBeast(line, { preset: 'mrbeast', enableEmoji: true, emojiFrequency: 'high' }, 0, {
      videoWidth: 1080,
      videoHeight: 1920,
    });
    const dialogue = mrbeast.dialogueEvents[0];

    // Throttling guarantee: Count total occurrences of emojis in dialogue
    const emojis = ['💰', '🔥', '😱', '⚠️', '⚡', '🏆', '😂', '❤️'];
    let emojiCount = 0;
    for (const em of emojis) {
      const occurrences = dialogue.split(em).length - 1;
      emojiCount += occurrences;
    }
    check(emojiCount === 1, `Throttling nghiêm ngặt: Dù có hàng chục từ khóa, chỉ duy nhất 1 emoji được chèn (thực tế: ${emojiCount})`);
    check(dialogue.endsWith('💰'), 'Emoji duy nhất được chèn ở cuối câu là 💰');
  }

  // 3.2: Multiple keywords from the EXACT SAME CATEGORY
  {
    const sameCatText = 'tiền đô triệu tỷ giàu thưởng mua cash dollar rich prize jackpot';
    const line: SrtLine = { id: 'adv-same-cat', startMs: 0, endMs: 2000, text: sameCatText };
    const mrbeast = compileMrBeast(line, { preset: 'mrbeast', enableEmoji: true, emojiFrequency: 'high' }, 0, {
      videoWidth: 1080,
      videoHeight: 1920,
    });
    const dialogue = mrbeast.dialogueEvents[0];
    const moneyCount = dialogue.split('💰').length - 1;
    check(moneyCount === 1, 'Nhiều từ khóa cùng category (11 từ khóa tiền bạc): Vẫn chỉ chèn chính xác 1 emoji 💰');
  }

  // 3.3: Priority Ladder Rigorous Verification (Head-to-head pairs)
  {
    // Money (10) vs Energy (9)
    check(detectEmoji('tiền và cháy', 'high', 0)?.emoji === '💰', 'Priority: Money (10) > Energy (9)');
    // Energy (9) vs Shock (8)
    check(detectEmoji('cháy trời ơi', 'high', 0)?.emoji === '🔥', 'Priority: Energy (9) > Shock (8)');
    // Energy (9) vs Warning (8)
    check(detectEmoji('cháy cảnh báo', 'high', 0)?.emoji === '🔥', 'Priority: Energy (9) > Warning (8)');
    // Shock (8) vs Speed (7)
    check(detectEmoji('sốc nhanh', 'high', 0)?.emoji === '😱', 'Priority: Shock (8) > Speed (7)');
    // Speed (7) vs Humor (6)
    check(detectEmoji('nhanh haha', 'high', 0)?.emoji === '⚡', 'Priority: Speed (7) > Humor (6)');
    // Champion (7) vs Humor (6)
    check(detectEmoji('vô địch haha', 'high', 0)?.emoji === '🏆', 'Priority: Champion (7) > Humor (6)');
    // Humor (6) vs Love (5)
    check(detectEmoji('haha yêu', 'high', 0)?.emoji === '😂', 'Priority: Humor (6) > Love (5)');
    // Money (10) vs Love (5)
    check(detectEmoji('triệu đô tình yêu', 'high', 0)?.emoji === '💰', 'Priority: Money (10) > Love (5)');
  }

  // 3.4: Emoji Frequency Throttling across sequence of 12 lines
  {
    const emotionalLines = Array.from({ length: 12 }, (_, i) => ({
      startMs: i * 1000,
      endMs: (i + 1) * 1000,
      text: `Dòng thứ ${i}: Kiếm được một triệu đô la cực khủng`,
    }));

    // Test Medium frequency: lineIndex % 2 === 0 gets emoji (0, 2, 4, 6, 8, 10)
    const mediumMatches = emotionalLines.map((l, idx) => detectEmoji(l.text, 'medium', idx));
    const mediumEmojiIndices = mediumMatches.map((m, idx) => (m !== null ? idx : -1)).filter((idx) => idx !== -1);
    check(
      JSON.stringify(mediumEmojiIndices) === JSON.stringify([0, 2, 4, 6, 8, 10]),
      'Emoji Throttling Medium: Chỉ kích hoạt ở các dòng chẵn (0, 2, 4, 6, 8, 10)'
    );

    // Test Low frequency: lineIndex % 3 === 0 gets emoji (0, 3, 6, 9)
    const lowMatches = emotionalLines.map((l, idx) => detectEmoji(l.text, 'low', idx));
    const lowEmojiIndices = lowMatches.map((m, idx) => (m !== null ? idx : -1)).filter((idx) => idx !== -1);
    check(
      JSON.stringify(lowEmojiIndices) === JSON.stringify([0, 3, 6, 9]),
      'Emoji Throttling Low: Chỉ kích hoạt ở các dòng chia hết cho 3 (0, 3, 6, 9)'
    );

    // Test High frequency: every line gets emoji
    const highMatches = emotionalLines.map((l, idx) => detectEmoji(l.text, 'high', idx));
    check(highMatches.every((m) => m !== null && m.emoji === '💰'), 'Emoji Throttling High: Mọi dòng đều có emoji khi thỏa mãn từ khóa');

    // Test Disabled emoji: enableEmoji = false
    const disabledItems: CompileSubtitleItem[] = emotionalLines.map((l) => ({ ...l }));
    const assDisabled = compileToAss(disabledItems, {
      kineticConfig: { preset: 'mrbeast', enableEmoji: false, emojiFrequency: 'high' },
      videoWidth: 1080,
      videoHeight: 1920,
    });
    check(!assDisabled.includes('💰'), 'Emoji Disabled: Không có bất kỳ emoji nào khi enableEmoji = false');
  }

  // 3.5: False-Positive Boundary Stress & Casing
  {
    // Words containing keyword substrings should NOT trigger match (word boundaries)
    // "đồng hồ" contains "đồng" (not in rules), should not match "đô"
    const noMatchDong = detectEmoji('Chiếc đồng hồ cổ này rất đẹp', 'high', 0);
    check(noMatchDong === null, 'Boundary false-positive: "đồng hồ" không bị match nhầm từ khóa "đô"');

    // "yếu đuối" contains "yếu" (not in rules), should not match "yêu"
    const noMatchYeu = detectEmoji('Anh ấy không hề yếu đuối', 'high', 0);
    check(noMatchYeu === null, 'Boundary false-positive: "yếu đuối" không bị match nhầm từ khóa "yêu"');

    // Mixed case & uppercase: "TIỀN", "TrIệU Đô", "bÙnG nỔ"
    const upperMatch = detectEmoji('NHẬN NGAY TIỀN THƯỞNG 10 TRIỆU ĐÔ', 'high', 0);
    check(upperMatch?.emoji === '💰', 'Casing stress: Khớp chính xác chữ IN HOA hoàn toàn');

    const mixedMatch = detectEmoji('TrIệU Đô bÙnG nỔ', 'high', 0);
    check(mixedMatch?.emoji === '💰', 'Casing stress: Khớp chính xác chữ hoa thường xen kẽ');
  }

  // ==========================================================================
  // SUITE 4: NON-STANDARD VIDEO DIMENSIONS & GEOMETRY MATH
  // ==========================================================================
  console.log('\n--- SUITE 4: Non-Standard Video Dimensions & Geometry Math ---');

  const RESOLUTIONS = [
    { label: '9:16 Shorts/Reels Standard', w: 720, h: 1280 },
    { label: '9:16 Shorts 4K Ultra HD', w: 2160, h: 3840 },
    { label: '1:1 Square Standard', w: 1080, h: 1080 },
    { label: '4:5 Instagram Portrait', w: 1080, h: 1350 },
    { label: '21:9 Ultrawide Cinema', w: 2560, h: 1080 },
    { label: '32:9 Super Ultrawide', w: 5120, h: 1440 },
    { label: 'Non-standard Low-Res', w: 480, h: 854 },
    { label: 'Tiny Dimensions', w: 200, h: 200 },
  ];

  for (const res of RESOLUTIONS) {
    const dummyLine: SrtLine = {
      id: `adv-res-${res.w}x${res.h}`,
      startMs: 1000,
      endMs: 3500,
      text: `Độ phân giải thử nghiệm ${res.w}x${res.h}`,
    };

    // Minimalist Glow geometry verification
    const glow = compileMinimalistGlow(dummyLine, { preset: 'minimalist_glow', enableProgressBar: true }, 0, {
      videoWidth: res.w,
      videoHeight: res.h,
    });

    check(glow.styles[0].includes('Style: MinimalGlow'), `${res.label} (${res.w}x${res.h}): Sinh Style MinimalGlow`);

    // Parse vector progress bar coordinates
    const layer0 = glow.dialogueEvents[0];
    const posMatch = layer0.match(/\\pos\((\d+),(\d+)\)/);
    const vectorMatch = layer0.match(/m 0 0 l (\d+) 0 l (\d+) (\d+) l 0 (\d+)/);

    check(posMatch !== null, `${res.label}: Tọa độ \\pos(...) hợp lệ`);
    check(vectorMatch !== null, `${res.label}: Lệnh vẽ vector m 0 0 l W 0... hợp lệ`);

    if (posMatch && vectorMatch) {
      const posX = parseInt(posMatch[1], 10);
      const posY = parseInt(posMatch[2], 10);
      const barW = parseInt(vectorMatch[1], 10);
      const barH = parseInt(vectorMatch[3], 10);

      check(barW > 0 && barW <= res.w, `${res.label}: barWidth (${barW}) > 0 và <= videoWidth (${res.w})`);
      check(barH > 0 && barH < res.h, `${res.label}: barHeight (${barH}) > 0 và < videoHeight (${res.h})`);
      check(posX >= 0 && posX + barW <= res.w, `${res.label}: Vị trí X (${posX}) nằm trong khung hình (X+W=${posX + barW} <= ${res.w})`);
      check(posY >= 0 && posY <= res.h, `${res.label}: Vị trí Y (${posY}) nằm trong khung hình (Y <= ${res.h})`);
      // Verification of horizontal centering: posX should be approximately (res.w - barW) / 2
      const expectedX = Math.round((res.w - barW) / 2);
      check(Math.abs(posX - expectedX) <= 1, `${res.label}: Thanh tiến trình được căn giữa hoàn hảo theo trục ngang`);
    }

    // Full compileToAss PlayRes verification
    const ass = compileToAss([{ startMs: dummyLine.startMs, endMs: dummyLine.endMs, text: dummyLine.text }], {
      kineticConfig: { preset: 'hormozi' },
      videoWidth: res.w,
      videoHeight: res.h,
    });
    check(ass.includes(`PlayResX: ${res.w}`), `${res.label}: PlayResX khớp chính xác ${res.w}`);
    check(ass.includes(`PlayResY: ${res.h}`), `${res.label}: PlayResY khớp chính xác ${res.h}`);
    check(!ass.includes('NaN'), `${res.label}: ASS không có token NaN`);
  }

  // 4.2: Fallback when video dimensions are 0 or undefined
  {
    const dummyItems: CompileSubtitleItem[] = [{ startMs: 500, endMs: 2000, text: 'Thử nghiệm kích thước mặc định' }];
    const assUndef = compileToAss(dummyItems, {
      kineticConfig: { preset: 'hormozi' },
      // videoWidth & videoHeight omitted
    });
    check(assUndef.includes('PlayResX: 1920'), 'Dimensions undefined: Fallback PlayResX: 1920 khi dùng Kinetic');
    check(assUndef.includes('PlayResY: 1080'), 'Dimensions undefined: Fallback PlayResY: 1080 khi dùng Kinetic');
  }

  // ==========================================================================
  // SUITE 5: BOUNDARY MATH, COLOR PARSING & DUAL-SUBTITLE COMPATIBILITY
  // ==========================================================================
  console.log('\n--- SUITE 5: Boundary Math, Color Parsing & Dual-Subtitle Compatibility ---');

  // 5.1: Hex color parser robustness
  {
    check(hexToAssColor('') === '&H00FFFFFF&', 'Color: Empty string fallback to white (&H00FFFFFF&)');
    check(hexToAssColor('#123') === '&H00FFFFFF&', 'Color: Short hex #123 fallback to white');
    check(hexToAssColor('invalid_color') === '&H00FFFFFF&', 'Color: Non-hex string fallback to white');
    check(hexToAssColor('#FF4500') === '&H000045FF&', 'Color: #FF4500 converts to ASS BGR format &H000045FF&');
    check(hexToAssColor('#00FF00', 0) === '&HFF00FF00&', 'Color: Opacity 0% converts to alpha 255 (&HFF...)');
    check(hexToAssColor('#00FF00', 100) === '&H0000FF00&', 'Color: Opacity 100% converts to alpha 0 (&H00...)');
    check(hexToAssColor('#00FF00', -50) === '&HFF00FF00&', 'Color: Negative opacity clamped to 0% (transparent)');
    check(hexToAssColor('#00FF00', 200) === '&H0000FF00&', 'Color: Excessive opacity clamped to 100% (opaque)');
  }

  // 5.2: ASS Timecode formatting boundaries
  {
    check(formatAssTime(-1000) === '0:00:00.00', 'Timecode: Negative ms clamped to 0:00:00.00');
    check(formatAssTime(0) === '0:00:00.00', 'Timecode: 0 ms formatted as 0:00:00.00');
    check(formatAssTime(1000) === '0:00:01.00', 'Timecode: 1000 ms formatted as 0:00:01.00');
    check(formatAssTime(59990) === '0:00:59.99', 'Timecode: 59990 ms formatted as 0:00:59.99');
    check(formatAssTime(60000) === '0:01:00.00', 'Timecode: 60000 ms formatted as 0:01:00.00');
    check(formatAssTime(3600000) === '1:00:00.00', 'Timecode: 1 hour formatted as 1:00:00.00');
    check(formatAssTime(36000000) === '10:00:00.00', 'Timecode: 10 hours formatted as 10:00:00.00');
  }

  // 5.3: 8K Ultra HD Dimension Geometry (7680x4320)
  {
    const dummy8k: SrtLine = { id: '8k', startMs: 0, endMs: 2000, text: '8K Ultra HD Subtitle' };
    const glow8k = compileMinimalistGlow(dummy8k, { preset: 'minimalist_glow', enableProgressBar: true }, 0, {
      videoWidth: 7680,
      videoHeight: 4320,
    });
    const layer0 = glow8k.dialogueEvents[0];
    const posMatch = layer0.match(/\\pos\((\d+),(\d+)\)/);
    const vectorMatch = layer0.match(/m 0 0 l (\d+) 0 l (\d+) (\d+) l 0 (\d+)/);
    check(posMatch !== null && vectorMatch !== null, '8K UHD (7680x4320): Regex tọa độ và vector khớp');
    if (posMatch && vectorMatch) {
      const px = parseInt(posMatch[1], 10);
      const py = parseInt(posMatch[2], 10);
      const bw = parseInt(vectorMatch[1], 10);
      const bh = parseInt(vectorMatch[3], 10);
      check(bw === 1920, '8K UHD: barWidth = 1920 (480 * 4)');
      check(px === 2880, '8K UHD: barX = (7680 - 1920) / 2 = 2880 (căn giữa hoàn hảo)');
      check(bh === 16, '8K UHD: barHeight = 16 ((4320/1080)*4)');
      check(py === 4215, '8K UHD: barY = 4320 - 120 + 15 = 4215 (cách đáy 105px)');
    }
  }

  // 5.4: Dual Subtitles Coexistence with Kinetic Presets
  {
    const mainItems: CompileSubtitleItem[] = [{ startMs: 0, endMs: 1500, text: 'Main Kinetic Subtitle' }];
    const secondaryItems: CompileSubtitleItem[] = [{ startMs: 0, endMs: 1500, text: 'Secondary Subtitle Track' }];

    const dualAss = compileToAss(mainItems, {
      videoWidth: 1080,
      videoHeight: 1920,
      kineticConfig: { preset: 'mrbeast', enableEmoji: false },
      secondaryItems,
      secondaryStyle: {
        fontName: 'Arial',
        fontSize: 16,
        primaryColour: '#FFE135',
      },
    });

    check(dualAss.includes('Style: MrBeast'), 'Dual + Kinetic: Chứa style MrBeast cho track chính');
    check(dualAss.includes('Style: Secondary'), 'Dual + Kinetic: Chứa style Secondary cho track phụ');
    check(dualAss.includes(',MrBeast,,0,0,0,,'), 'Dual + Kinetic: Dialogue track chính gắn style MrBeast');
    check(dualAss.includes(',Secondary,,0,0,0,,'), 'Dual + Kinetic: Dialogue track phụ gắn style Secondary');
  }

  // ==========================================================================
  // SUITE 6: FULL LIBASS BURN-IN VIA FFMPEG UNDER STRESS
  // ==========================================================================
  console.log('\n--- SUITE 6: Full Libass Burn-In via FFmpeg Under Stress ---');

  const ffmpegPath = (ffmpegInstaller as any)?.path || '';
  if (ffmpegPath && fs.existsSync(ffmpegPath)) {
    const tempDir = path.join(os.tmpdir(), `vanhsub_challenger_m3_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // 5.1: Stress test FFmpeg with 9:16 video (720x1280) containing:
    // - 50+ words Hormozi
    // - Special characters and emoji MrBeast
    // - Minimalist Glow progress bar
    // - 0 duration line
    const stressAssPath = path.join(tempDir, 'stress_portrait.ass');
    const inVideoPortrait = path.join(tempDir, 'synthetic_portrait.mp4');
    const outVideoPortrait = path.join(tempDir, 'out_portrait.mp4');

    const stressItems: CompileSubtitleItem[] = [
      // Line 1: Hormozi with 50 words
      {
        startMs: 0,
        endMs: 800,
        text: 'Chiến thắng không dành cho kẻ lười biếng hãy hành động ngay bây giờ để đạt được mục tiêu lớn lao trong cuộc sống và sự nghiệp đỉnh cao.',
      },
      // Line 2: MrBeast with special chars and multiple keywords
      {
        startMs: 800,
        endMs: 1400,
        text: 'Kiếm được $1,000,000 "tiền mặt" & quà khủng {\\b1}cực đỉnh{\\b0}!',
      },
      // Line 3: Minimalist Glow with vector progress bar
      {
        startMs: 1400,
        endMs: 2000,
        text: 'Khám phá bí mật vũ trụ bao la và huyền bí',
      },
      // Line 4: Edge case 0 duration line
      {
        startMs: 2000,
        endMs: 2000,
        text: 'Dòng chớp nhoáng 0ms',
      },
    ];

    try {
      // Create 2.0s 720x1280 video
      execFileSync(
        ffmpegPath,
        [
          '-y',
          '-f', 'lavfi',
          '-i', 'color=c=navy:s=720x1280:r=25:d=2.0',
          '-f', 'lavfi',
          '-i', 'anullsrc=r=44100:cl=stereo',
          '-t', '2.0',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-pix_fmt', 'yuv420p',
          inVideoPortrait,
        ],
        { stdio: 'pipe' }
      );
      check(fs.existsSync(inVideoPortrait), 'FFmpeg: Tạo video chân dung synthetic 720x1280 thành công');

      // Compile ASS with MrBeast preset
      const assContentPortrait = compileToAss(stressItems, {
        videoWidth: 720,
        videoHeight: 1280,
        kineticConfig: {
          preset: 'mrbeast',
          enableEmoji: true,
          emojiFrequency: 'high',
        },
      });
      fs.writeFileSync(stressAssPath, assContentPortrait, 'utf-8');

      // Burn-in via FFmpeg libass subtitles filter
      const escapedAssPortrait = stressAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      execFileSync(
        ffmpegPath,
        [
          '-y',
          '-i', inVideoPortrait,
          '-vf', `subtitles='${escapedAssPortrait}'`,
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-pix_fmt', 'yuv420p',
          outVideoPortrait,
        ],
        { stdio: 'pipe' }
      );

      check(
        fs.existsSync(outVideoPortrait) && fs.statSync(outVideoPortrait).size > 2000,
        'FFmpeg Hardsub Stress 1 (720x1280): Burn-in hoàn tất thành công, không crash libass, video > 2KB'
      );

      // 5.2: Stress test FFmpeg with 1:1 Square video (1080x1080) with Minimalist Glow vector progress bar
      const inVideoSquare = path.join(tempDir, 'synthetic_square.mp4');
      const outVideoSquare = path.join(tempDir, 'out_square.mp4');
      const squareAssPath = path.join(tempDir, 'stress_square.ass');

      execFileSync(
        ffmpegPath,
        [
          '-y',
          '-f', 'lavfi',
          '-i', 'color=c=darkgreen:s=1080x1080:r=25:d=1.5',
          '-f', 'lavfi',
          '-i', 'anullsrc=r=44100:cl=stereo',
          '-t', '1.5',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-pix_fmt', 'yuv420p',
          inVideoSquare,
        ],
        { stdio: 'pipe' }
      );
      check(fs.existsSync(inVideoSquare), 'FFmpeg: Tạo video vuông synthetic 1080x1080 thành công');

      const squareItems: CompileSubtitleItem[] = [
        { startMs: 0, endMs: 750, text: 'Square 1:1 Kinetic Glow Subtitle 1' },
        { startMs: 750, endMs: 1500, text: 'Square 1:1 Kinetic Glow Subtitle 2' },
      ];

      const squareAssContent = compileToAss(squareItems, {
        videoWidth: 1080,
        videoHeight: 1080,
        kineticConfig: {
          preset: 'minimalist_glow',
          enableProgressBar: true,
          glowBlur: 6,
        },
      });
      fs.writeFileSync(squareAssPath, squareAssContent, 'utf-8');

      const escapedSquareAss = squareAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      execFileSync(
        ffmpegPath,
        [
          '-y',
          '-i', inVideoSquare,
          '-vf', `subtitles='${escapedSquareAss}'`,
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-pix_fmt', 'yuv420p',
          outVideoSquare,
        ],
        { stdio: 'pipe' }
      );

      check(
        fs.existsSync(outVideoSquare) && fs.statSync(outVideoSquare).size > 2000,
        'FFmpeg Hardsub Stress 2 (1080x1080 Square): Burn-in Minimalist Glow vector progress bar thành công'
      );
    } catch (ffmpegErr: any) {
      check(false, `FFmpeg Stress Render Error: ${ffmpegErr.message}`);
    } finally {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {}
    }
  } else {
    console.log('  ⚠️ Bỏ qua Suite 5: Không tìm thấy ffmpeg binary');
  }

  // ==========================================================================
  // FINAL SUMMARY
  // ==========================================================================
  console.log('\n=======================================================');
  console.log('📊 TỔNG KẾT ADVERSARIAL STRESS TEST (CHALLENGER M3)');
  console.log(`   Tổng số assertions: ${totalTests}`);
  console.log(`   Số test ĐẠT:       ${passedTests} (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log(`   Số test THẤT BẠI:  ${failedTests}`);
  console.log('=======================================================');

  if (failedTests > 0) {
    console.error(`\n🚨 PHÁT HIỆN ${failedTests} ĐIỂM THẤT BẠI:`);
    failures.forEach((f) => console.error(f));
    process.exit(1);
  } else {
    console.log('\n🏆 TẤT CẢ CÁC BÀI TEST ADVERSARIAL ĐỀU ĐẠT CHUẨN XUẤT SẮC!');
  }
}

runAdversarialTests().catch((err) => {
  console.error('Lỗi ngoại lệ khi chạy test suite:', err);
  process.exit(1);
});
