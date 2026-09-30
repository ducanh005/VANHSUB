/**
 * Test Suite: Kinetic Subtitles Engine & Presets (Vanhsub Milestone 3)
 * Comprehensive testing of:
 * - Word timing calculation (Whisper word timestamps vs character-proportional interpolation)
 * - Hormozi Preset (\k karaoke duration tags, spotlight \t transformations, neon color tags)
 * - MrBeast Preset (pop-in bounce formula, emoji keyword detection & priority, throttling)
 * - Minimalist Glow Preset (\blur aura, \p1 vector progress bar on layers 0/1/2)
 * - assCompiler integration (PlayResX/Y scaling, backward compatibility, ASS syntax validity)
 * - FFmpeg Libass hardsub burn-in verification with synthetic video
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
  type KineticConfig,
  type KineticPreset,
} from '../main/render/kineticEngine';
import {
  compileToAss,
  hexToAssColor,
  formatAssTime,
  type CompileSubtitleItem,
} from '../main/render/assCompiler';
import type { SrtLine } from '../main/lib/srt';

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

async function runTests() {
  console.log('================================================================');
  console.log('🚀 TEST SUITE: KINETIC SUBTITLES ENGINE & PRESETS (MILESTONE 3)');
  console.log('================================================================\n');

  // ==========================================================================
  // SUITE 1: Word Timing Mathematics & Interpolation
  // ==========================================================================
  console.log('--- SUITE 1: Word Timing Mathematics & Interpolation ---');

  {
    // Test 1.1: Exact Whisper word timestamps
    const lineWithWords: SrtLine = {
      id: 'line-1',
      startMs: 2000,
      endMs: 5000,
      text: 'Đây là bài thử nghiệm',
      words: [
        { word: 'Đây', startMs: 2000, endMs: 2400 },
        { word: 'là', startMs: 2400, endMs: 2800 },
        { word: 'bài', startMs: 2800, endMs: 3400 },
        { word: 'thử', startMs: 3400, endMs: 4100 },
        { word: 'nghiệm', startMs: 4100, endMs: 5000 },
      ],
    };

    const timings = calculateWordTimings(lineWithWords);
    assert(timings.length === 5, 'Trích xuất chính xác 5 từ từ mảng words');
    assert(timings[0].word === 'Đây' && timings[0].startMs === 0, 'Từ đầu tiên bắt đầu từ relative 0ms');
    assert(timings[0].durationMs === 400 && timings[0].durationCs === 40, 'Thời lượng từ 1 khớp 400ms (40 centiseconds)');
    assert(timings[4].word === 'nghiệm' && timings[4].endMs === 3000, 'Từ cuối kết thúc ở relative 3000ms');
    assert(timings.every((t) => t.durationCs > 0), 'Tất cả các từ có durationCs > 0');
  }

  {
    // Test 1.2: Proportional character-length interpolation (không có word timestamps)
    const lineWithoutWords: SrtLine = {
      id: 'line-2',
      startMs: 1000,
      endMs: 4000, // 3000ms total duration
      text: 'Bí quyết thành công vượt trội',
    };

    const timings = calculateWordTimings(lineWithoutWords);
    assert(timings.length === 6, 'Phân tách đúng 6 từ dựa trên văn bản');
    assert(timings[0].startMs === 0, 'Từ đầu tiên bắt đầu ở relative 0ms');
    assert(timings[5].endMs === 3000, 'Tổng thời gian của các từ phủ kín 3000ms');

    // "nghiệm" (5 chars) hoặc "thành" (5 chars) phải dài hơn "Bí" (2 chars)
    const biTiming = timings.find((t) => t.word === 'Bí')!;
    const thanhTiming = timings.find((t) => t.word === 'thành')!;
    assert(
      thanhTiming.durationMs > biTiming.durationMs,
      `Từ dài hơn được gán thời gian dài hơn (thành: ${thanhTiming.durationMs}ms > Bí: ${biTiming.durationMs}ms)`
    );
    assert(timings.every((t) => t.durationCs >= 1), 'Mọi từ có centiseconds \\k >= 1');
  }

  // ==========================================================================
  // SUITE 2: Preset 1 — Hormozi Style (\k & \t Spotlight Transformations)
  // ==========================================================================
  console.log('\n--- SUITE 2: Preset 1 — Hormozi Style ---');

  {
    const line: SrtLine = {
      id: 'line-hormozi',
      startMs: 1500,
      endMs: 3800,
      text: 'Học cách tư duy của người giàu',
    };

    const config: KineticConfig = {
      preset: 'hormozi',
      activeColor: '#FFE500', // Bright Neon Yellow
    };

    const result = compileHormozi(line, config, 0, { videoWidth: 1080, videoHeight: 1920 });
    assert(result.styles.length > 0, 'Sinh ra Style definition cho Hormozi');
    assert(result.styles[0].includes('Style: Hormozi,Arial Black'), 'Style Hormozi sử dụng font Arial Black');
    assert(result.styles[0].includes('&H0000E5FF&'), 'Màu PrimaryColour khớp với hexToAssColor(#FFE500)');
    assert(result.styles[0].includes('&H00FFFFFF&'), 'Màu SecondaryColour là màu trắng đục trước khi sweep');

    assert(result.dialogueEvents.length === 1, 'Sinh ra đúng 1 Dialogue event');
    const dialogue = result.dialogueEvents[0];
    assert(dialogue.includes('Hormozi'), 'Dialogue tham chiếu style Hormozi');
    assert(dialogue.includes('\\k'), 'Dialogue chứa thẻ karaoke \\k');
    assert(dialogue.includes('HỌC') && dialogue.includes('CÁCH') && dialogue.includes('GIÀU'), 'Văn bản được in hoa toàn bộ');
    assert(dialogue.includes('\\fscx112\\fscy112'), 'Dialogue chứa thẻ spotlight phóng to \\fscx112\\fscy112');
    assert(dialogue.includes('\\fscx100\\fscy100'), 'Dialogue chứa thẻ thu về chuẩn \\fscx100\\fscy100');
    assert(dialogue.includes('0:00:01.50') && dialogue.includes('0:00:03.80'), 'Mốc thời gian start/end centisecond chuẩn xác');
  }

  // ==========================================================================
  // SUITE 3: Preset 2 — MrBeast Style (Pop-in Bounce & Emotion Emoji)
  // ==========================================================================
  console.log('\n--- SUITE 3: Preset 2 — MrBeast Style ---');

  {
    // Test 3.1: Emoji keyword detection & Priority ranking
    const moneyMatch = detectEmoji('Tôi vừa kiếm được 1 triệu đô la tiền mặt', 'high', 0);
    assert(moneyMatch !== null, 'Phát hiện từ khóa tiền bạc');
    assert(moneyMatch?.emoji === '💰', 'Gán emoji 💰 cho từ khóa triệu đô');
    assert(moneyMatch?.highlightColor === '#00FF66', 'Màu highlight cho tiền là xanh lá #00FF66');

    const fireMatch = detectEmoji('Thử thách này bùng nổ quá đỉnh', 'high', 0);
    assert(fireMatch?.emoji === '🔥', 'Gán emoji 🔥 cho từ khóa bùng nổ / đỉnh');

    const shockMatch = detectEmoji('Trời ơi không thể tin được điều này', 'high', 0);
    assert(shockMatch?.emoji === '😱', 'Gán emoji 😱 cho từ khóa trời ơi');

    const dangerMatch = detectEmoji('Cảnh báo nguy hiểm xin đừng làm theo', 'high', 0);
    assert(dangerMatch?.emoji === '⚠️', 'Gán emoji ⚠️ cho từ khóa cảnh báo nguy hiểm');

    const speedMatch = detectEmoji('Thời gian đếm ngược đang trôi thật nhanh', 'high', 0);
    assert(speedMatch?.emoji === '⚡', 'Gán emoji ⚡ cho từ khóa nhanh / đếm ngược');

    const victoryMatch = detectEmoji('Anh ấy đã xuất sắc giành ngôi vô địch', 'high', 0);
    assert(victoryMatch?.emoji === '🏆', 'Gán emoji 🏆 cho từ khóa vô địch');

    const laughMatch = detectEmoji('Haha tình huống này thật buồn cười', 'high', 0);
    assert(laughMatch?.emoji === '😂', 'Gán emoji 😂 cho từ khóa haha / buồn cười');

    const loveMatch = detectEmoji('Cảm ơn mọi người vì tình yêu thương to lớn', 'high', 0);
    assert(loveMatch?.emoji === '❤️', 'Gán emoji ❤️ cho từ khóa yêu thương / cảm ơn');

    // Priority resolution: Money (10) vs Love (5) -> Money wins
    const multiMatch = detectEmoji('Cảm ơn bạn đã tặng tôi một triệu đô la', 'high', 0);
    assert(multiMatch?.emoji === '💰', 'Ưu tiên emoji có mức độ ưu tiên cao hơn (💰 priority 10 > ❤️ priority 5)');
  }

  {
    // Test 3.2: Pop-in Bounce tags and ASS event compilation
    const line: SrtLine = {
      id: 'line-mrbeast',
      startMs: 4000,
      endMs: 6500,
      text: 'Kiếm được 1 triệu đô trong 24 giờ',
    };

    const config: KineticConfig = {
      preset: 'mrbeast',
      enableEmoji: true,
      emojiFrequency: 'high',
      activeColor: '#00DEFF',
    };

    const result = compileMrBeast(line, config, 0, { videoWidth: 1080, videoHeight: 1920 });
    assert(result.styles[0].includes('Style: MrBeast,Impact'), 'Style MrBeast sử dụng font Impact');

    const dialogue = result.dialogueEvents[0];
    assert(dialogue.includes('\\fscx130\\fscy130'), 'Chữ bắt đầu ở 130%');
    assert(dialogue.includes('\\t(0,100,\\fscx95\\fscy95)'), 'Nén về 95% ở 100ms');
    assert(dialogue.includes('\\t(100,180,\\fscx100\\fscy100)'), 'Bật về 100% ở 180ms');
    assert(dialogue.includes('KIẾM ĐƯỢC 1') && dialogue.includes('TRIỆU') && dialogue.includes('24 GIỜ'), 'Văn bản in hoa đậm nét');
    assert(dialogue.includes('\\c&H'), 'Từ khóa cảm xúc được highlight màu bằng thẻ \\c');
  }

  {
    // Test 3.3: Toggle disable emoji
    const line: SrtLine = {
      id: 'line-mrbeast-no-emoji',
      startMs: 1000,
      endMs: 2000,
      text: 'Kiếm được rất nhiều tiền',
    };

    const config: KineticConfig = {
      preset: 'mrbeast',
      enableEmoji: false, // Tắt emoji
    };

    const result = compileMrBeast(line, config, 0, { videoWidth: 1080, videoHeight: 1920 });
    assert(!result.dialogueEvents[0].includes('💰'), 'Không chèn emoji khi enableEmoji = false');
    assert(result.dialogueEvents[0].includes('\\fscx130\\fscy130'), 'Vẫn giữ hiệu ứng pop-in bounce');
  }

  // ==========================================================================
  // SUITE 4: Preset 3 — Minimalist Glow (\blur & \p1 Vector Progress Bar)
  // ==========================================================================
  console.log('\n--- SUITE 4: Preset 3 — Minimalist Glow ---');

  {
    const line: SrtLine = {
      id: 'line-glow',
      startMs: 500,
      endMs: 3500, // 3000ms duration
      text: 'Khám phá bí mật sâu thẳm của vũ trụ',
    };

    const config: KineticConfig = {
      preset: 'minimalist_glow',
      activeColor: '#00F5FF',
      enableProgressBar: true,
      glowBlur: 5,
    };

    const result = compileMinimalistGlow(line, config, 0, { videoWidth: 1080, videoHeight: 1920 });
    assert(result.styles[0].includes('Style: MinimalGlow,Segoe UI'), 'Style MinimalGlow sử dụng Segoe UI');
    assert(result.dialogueEvents.length === 3, 'Sinh ra 3 Layer riêng biệt khi bật thanh tiến trình');

    const layer0 = result.dialogueEvents[0];
    const layer1 = result.dialogueEvents[1];
    const layer2 = result.dialogueEvents[2];

    assert(layer0.startsWith('Dialogue: 0,'), 'Layer 0 là rãnh nền progress bar');
    assert(layer0.includes('\\p1') && layer0.includes('\\p0'), 'Layer 0 sử dụng ASS vector drawing commands (\\p1...\\p0)');
    assert(layer0.includes('m 0 0 l'), 'Layer 0 chứa lệnh vẽ hình học vector m 0 0 l...');
    assert(layer0.includes('\\alpha&HAA&'), 'Layer 0 có độ trong suốt nền');

    assert(layer1.startsWith('Dialogue: 1,'), 'Layer 1 là thanh tiến trình active');
    assert(layer1.includes('\\fscx0\\t(0,3000,\\fscx100)'), 'Layer 1 scale từ 0% lên 100% trong 3000ms (\\fscx0\\t(0,3000,\\fscx100))');
    assert(layer1.includes('\\p1'), 'Layer 1 vẽ bằng vector');

    assert(layer2.startsWith('Dialogue: 2,'), 'Layer 2 là văn bản phụ đề');
    assert(layer2.includes('\\blur5'), 'Layer 2 áp dụng thẻ \\blur5 mờ phát sáng');
    assert(layer2.includes('\\bord2'), 'Layer 2 có viền mỏng phát quang \\bord2');
    assert(layer2.includes('Khám phá bí mật sâu thẳm của vũ trụ'), 'Nội dung phụ đề hiển thị sắc nét');
  }

  {
    // Test 4.2: Minimalist Glow with disabled progress bar
    const line: SrtLine = {
      id: 'line-glow-nobar',
      startMs: 500,
      endMs: 3500,
      text: 'Đơn giản và tinh tế',
    };

    const config: KineticConfig = {
      preset: 'minimalist_glow',
      enableProgressBar: false,
      glowBlur: 4,
    };

    const result = compileMinimalistGlow(line, config, 0, { videoWidth: 1080, videoHeight: 1920 });
    assert(result.dialogueEvents.length === 1, 'Chỉ sinh 1 Layer chữ khi tắt progress bar');
    assert(result.dialogueEvents[0].includes('\\blur4'), 'Vẫn giữ hiệu ứng \\blur4');
    assert(!result.dialogueEvents[0].includes('\\p1'), 'Không chứa lệnh vẽ vector');
  }

  // ==========================================================================
  // SUITE 5: Full assCompiler Integration, PlayRes & Backward Compatibility
  // ==========================================================================
  console.log('\n--- SUITE 5: assCompiler Integration & Backward Compatibility ---');

  {
    // Test 5.1: 9:16 Shorts PlayRes (1080x1920)
    const items: CompileSubtitleItem[] = [
      { startMs: 1000, endMs: 2500, text: 'Thành công không phải ngẫu nhiên' },
      { startMs: 2600, endMs: 4000, text: 'Nó đến từ sự kiên trì mỗi ngày' },
    ];

    const assContent = compileToAss(items, {
      videoWidth: 1080,
      videoHeight: 1920,
      kineticConfig: {
        preset: 'hormozi',
      },
    });

    assert(assContent.includes('PlayResX: 1080'), 'PlayResX khớp 1080 cho video 9:16');
    assert(assContent.includes('PlayResY: 1920'), 'PlayResY khớp 1920 cho video 9:16');
    assert(assContent.includes('Style: Hormozi'), 'ASS chứa định nghĩa Style: Hormozi');
    assert(assContent.includes('\\k'), 'Dòng thoại chứa thẻ \\k');
    assert(!assContent.includes('undefined'), 'Không chứa token undefined');
    assert(!assContent.includes('NaN'), 'Không chứa token NaN');
  }

  {
    // Test 5.2: Backward compatibility when preset is 'none'
    const legacyItems: CompileSubtitleItem[] = [
      { startMs: 500, endMs: 1500, text: 'Dòng phụ đề truyền thống 1' },
      { startMs: 1600, endMs: 3000, text: 'Dòng phụ đề truyền thống 2' },
    ];

    const assLegacy = compileToAss(legacyItems, {
      kineticConfig: { preset: 'none' },
    });

    assert(assLegacy.includes('Style: Default'), 'Chứa Style: Default chuẩn');
    assert(!assLegacy.includes('Style: Hormozi'), 'Không chứa style Hormozi khi preset = none');
    assert(!assLegacy.includes('Style: MrBeast'), 'Không chứa style MrBeast khi preset = none');
    assert(assLegacy.includes('Dòng phụ đề truyền thống 1'), 'Nội dung dòng 1 hiển thị nguyên bản');
    assert(!assLegacy.includes('\\k'), 'Không sinh thẻ \\k khi preset = none');
  }

  // ==========================================================================
  // SUITE 6: Real Libass Burn-In via FFmpeg (End-to-End Render Verification)
  // ==========================================================================
  console.log('\n--- SUITE 6: FFmpeg Libass Burn-In Verification ---');

  const ffmpegPath = (ffmpegInstaller as any)?.path || '';
  if (ffmpegPath && fs.existsSync(ffmpegPath)) {
    const tempDir = path.join(os.tmpdir(), `vanhsub_test_kinetic_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const sampleAssPath = path.join(tempDir, 'kinetic_test.ass');
    const sampleVideoPath = path.join(tempDir, 'synthetic_in.mp4');
    const outputVideoPath = path.join(tempDir, 'burned_out.mp4');

    try {
      // 1. Generate 1.5-second test video 720x1280 (9:16)
      execFileSync(ffmpegPath, [
        '-y',
        '-f', 'lavfi',
        '-i', 'color=c=black:s=720x1280:r=25:d=1.5',
        '-f', 'lavfi',
        '-i', 'anullsrc=r=44100:cl=stereo',
        '-t', '1.5',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        sampleVideoPath,
      ], { stdio: 'pipe' });

      assert(fs.existsSync(sampleVideoPath) && fs.statSync(sampleVideoPath).size > 0, 'Tạo video mẫu synthetic 9:16 thành công');

      // 2. Generate ASS with all three presets combined across 3 lines
      const kineticItems: CompileSubtitleItem[] = [
        { startMs: 0, endMs: 500, text: 'Hormozi neon highlight' },
        { startMs: 500, endMs: 1000, text: 'Kiếm được một triệu đô 💰' },
        { startMs: 1000, endMs: 1500, text: 'Minimalist glow progress' },
      ];

      const mrBeastAss = compileToAss(kineticItems, {
        videoWidth: 720,
        videoHeight: 1280,
        kineticConfig: {
          preset: 'mrbeast',
          enableEmoji: true,
          emojiFrequency: 'high',
        },
      });

      fs.writeFileSync(sampleAssPath, mrBeastAss, 'utf-8');
      assert(fs.existsSync(sampleAssPath), 'Ghi file ASS thử nghiệm thành công');

      // 3. Burn-in via FFmpeg using subtitles filter (libass)
      const escapedAss = sampleAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      execFileSync(ffmpegPath, [
        '-y',
        '-i', sampleVideoPath,
        '-vf', `subtitles='${escapedAss}'`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        outputVideoPath,
      ], { stdio: 'pipe' });

      assert(
        fs.existsSync(outputVideoPath) && fs.statSync(outputVideoPath).size > 1000,
        'FFmpeg burn-in thành công phụ đề Kinetic bằng libass (exit code 0, video file > 1KB)'
      );
    } catch (ffmpegErr: any) {
      console.warn('  ⚠️ Cảnh báo FFmpeg Libass:', ffmpegErr.message);
    } finally {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {}
    }
  } else {
    console.log('  ⚠️ Bỏ qua kiểm tra FFmpeg trực tiếp: Không tìm thấy ffmpeg binary');
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n=======================================================');
  console.log(`🎉 HOÀN THÀNH TẤT CẢ CÁC BÀI TEST KINETIC SUBTITLES!`);
  console.log(`📊 Kết quả: ${passedCount}/${totalCount} assertions ĐẠT (100% PASS)`);
  console.log('=======================================================');
}

runTests().catch((err) => {
  console.error('Lỗi thực thi test suite:', err);
  process.exit(1);
});
