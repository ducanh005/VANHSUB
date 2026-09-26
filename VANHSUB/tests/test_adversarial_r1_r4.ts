/**
 * ADVERSARIAL STRESS TEST SUITE: Requirements R1 & R4
 * Challenger 1 (critic, specialist)
 *
 * Requirements:
 * R1 (TikTok Downloader):
 *  - Weird TikTok URLs (tracking query params, mobile links, malformed links, non-existent links).
 *  - yt-dlp fallback resilience when API errors.
 *  - Verify Douyin/YouTube regexes don't falsely match TikTok links and vice versa.
 *
 * R4 (CapCut Mini Export Tools):
 *  - Stress-test speed boundary conditions: speed = 1.00, 1.01, 1.02, 1.50, 1.99, 2.00, speed > 2.00 (clamping), speed < 1.00.
 *  - Test videos without audio tracks to confirm atempo is safely omitted without crashing FFmpeg.
 *  - Test combination of horizontal mirror + speedup + subtitle burn.
 *  - Verify effective duration arithmetic and progress tracking accuracy.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import {
  detectPlatform,
  extractCleanUrl,
  isTikTokShortUrl,
  extractTikTokVideoId,
  normalizeTikTokUrl,
  fetchTikwmVideoData,
  inspectMediaUrl,
  downloadVideoFromUrl,
  inspectViaYtDlp,
  extractTikTokTitle,
  type PlatformType,
} from '../main/helpers/videoDownloader';
import {
  calculateEffectiveDuration,
  calculateRenderProgress,
  buildHardsubFilterGraph,
  burnHardsub,
  getVideoMetadata,
  timemarkToSeconds,
  type ExportFormatOptions,
} from '../main/render/videoRenderer';

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  error?: string;
  details?: string;
}

const results: TestResult[] = [];

function recordTest(name: string, category: string, passed: boolean, details?: string, error?: string) {
  results.push({ name, category, passed, details, error });
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} [${category}] ${name}${details ? ` -> ${details}` : ''}${error ? ` (ERROR: ${error})` : ''}`);
}

function expect(condition: boolean, name: string, category: string, details?: string) {
  if (condition) {
    recordTest(name, category, true, details);
  } else {
    recordTest(name, category, false, details, 'Assertion failed');
  }
}

async function createSyntheticVideo(outputPath: string, durationSec: number, withAudio: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()
      .input(`testsrc=duration=${durationSec}:size=320x240:rate=25`)
      .inputFormat('lavfi');

    if (withAudio) {
      cmd
        .input(`sine=frequency=1000:duration=${durationSec}`)
        .inputFormat('lavfi')
        .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-c:a aac',
          '-shortest',
        ]);
    } else {
      cmd.outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-an',
      ]);
    }

    cmd
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

function createDummySrt(filePath: string): void {
  const content = `1
00:00:00,500 --> 00:00:02,500
VANHSUB Adversarial Subtitle Line 1

2
00:00:02,600 --> 00:00:03,800
VANHSUB Adversarial Subtitle Line 2
`;
  fs.writeFileSync(filePath, content, 'utf-8');
}

async function runAdversarialSuite() {
  console.log('\n' + '═'.repeat(70));
  console.log('   BẮT ĐẦU CHẠY ADVERSARIAL STRESS TEST HARNESS — R1 & R4');
  console.log('═'.repeat(70) + '\n');

  const testTempDir = path.join(os.tmpdir(), `vanhsub_challenger1_${Date.now()}`);
  fs.mkdirSync(testTempDir, { recursive: true });

  try {
    // ════════════════════════════════════════════════════════════════════════
    // 1. R1: WEIRD TIKTOK URLS STRESS TESTING
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- 1. R1: Weird TikTok URLs Stress Testing ---');

    // 1.1 Tracking parameters & complex query strings
    const urlWithTracking = 'https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1&sender_device=pc&_r=1&utm_source=tt_share&fbclid=IwAR999#comments';
    const idWithTracking = extractTikTokVideoId(urlWithTracking);
    expect(idWithTracking === '6718335390845095173', 'Extract Video ID from URL with tracking parameters and hash fragment', 'R1-URL-Tracking', `Extracted: ${idWithTracking}`);

    const normTracking = await normalizeTikTokUrl(urlWithTracking);
    expect(normTracking.cleanUrl === 'https://www.tiktok.com/@scout2015/video/6718335390845095173', 'Normalize URL strips tracking params and fragments cleanly', 'R1-URL-Tracking', `Normalized: ${normTracking.cleanUrl}`);
    expect(normTracking.videoId === '6718335390845095173', 'Normalize URL preserves video ID', 'R1-URL-Tracking');

    // 1.2 Mobile and polymorphic links
    const mobileLinks = [
      { url: 'https://m.tiktok.com/v/7234567890123456789.html', expectedId: '7234567890123456789' },
      { url: 'https://m.tiktok.com/@creator/video/7234567890123456789', expectedId: '7234567890123456789' },
      { url: 'https://www.tiktok.com/video/7234567890123456789', expectedId: '7234567890123456789' },
      { url: 'https://www.tiktok.com/v/7234567890123456789', expectedId: '7234567890123456789' },
      { url: 'https://www.tiktok.com/share/video/7234567890123456789', expectedId: '7234567890123456789' },
      { url: 'https://www.tiktok.com/?modal_id=7234567890123456789', expectedId: '7234567890123456789' },
      { url: 'https://www.tiktok.com/@creator/photo/7234567890123456789', expectedId: '7234567890123456789' },
    ];

    for (const item of mobileLinks) {
      const extracted = extractTikTokVideoId(item.url);
      expect(extracted === item.expectedId, `extractTikTokVideoId on ${item.url}`, 'R1-URL-Mobile', `Got: ${extracted}`);
    }

    // Short links
    const shortVariants = [
      'https://vt.tiktok.com/ZS2QvHjXk/',
      'http://vt.tiktok.com/ZS2QvHjXk',
      'https://vm.tiktok.com/ZMJ999999/',
      'https://www.tiktok.com/t/ZT8R12345/',
      'https://tiktok.com/t/ZT8R12345',
    ];
    for (const sv of shortVariants) {
      expect(isTikTokShortUrl(sv) === true, `isTikTokShortUrl recognises ${sv}`, 'R1-URL-Short');
    }

    // 1.3 Malformed links & edge cases
    expect(extractTikTokVideoId('') === null, 'extractTikTokVideoId empty string returns null', 'R1-URL-Malformed');
    expect(extractTikTokVideoId('   ') === null, 'extractTikTokVideoId whitespace returns null', 'R1-URL-Malformed');
    expect(extractTikTokVideoId('https://tiktok.com/@user/video/notanumber') === null, 'extractTikTokVideoId non-numeric ID returns null', 'R1-URL-Malformed');
    expect(extractTikTokVideoId('https://tiktok.com/') === null, 'extractTikTokVideoId root domain returns null', 'R1-URL-Malformed');

    const cleanSurrounded = extractCleanUrl('Xem video tiktok nay https://vt.tiktok.com/ZS2QvHjXk/ hay lam');
    expect(cleanSurrounded === 'https://vt.tiktok.com/ZS2QvHjXk/', 'extractCleanUrl isolates TikTok URL from Vietnamese chat text', 'R1-URL-Extraction', `Clean: ${cleanSurrounded}`);

    const trailingPunctuation = extractCleanUrl('https://www.tiktok.com/@scout2015/video/6718335390845095173).,; ');
    expect(trailingPunctuation === 'https://www.tiktok.com/@scout2015/video/6718335390845095173', 'extractCleanUrl strips trailing punctuation ).,; ', 'R1-URL-Extraction', `Clean: ${trailingPunctuation}`);

    // ════════════════════════════════════════════════════════════════════════
    // 2. R1: CROSS-PLATFORM REGEX ISOLATION & COLLISION STRESS TESTING
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- 2. R1: Cross-Platform Regex Isolation & Collision Testing ---');

    // Case A: Douyin link containing 'tiktok' in query parameter
    const douyinWithTikTokParam = 'https://www.douyin.com/video/7123456789012345678?from=tiktok.com&ref=tiktok';
    const platDouyin = detectPlatform(douyinWithTikTokParam);
    expect(platDouyin === 'douyin', 'Douyin link with tiktok in query param is detected as douyin', 'R1-Regex-CrossPlatform', `Detected: ${platDouyin}`);

    // Case B: YouTube link containing 'tiktok' in query parameter
    const youtubeWithTikTokParam = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&referrer=tiktok.com';
    const platYoutube = detectPlatform(youtubeWithTikTokParam);
    expect(platYoutube === 'youtube', 'YouTube link with tiktok in query param is detected as youtube', 'R1-Regex-CrossPlatform', `Detected: ${platYoutube}`);

    // Case C: Bilibili link containing 'tiktok' in query parameter
    const bilibiliWithTikTokParam = 'https://www.bilibili.com/video/BV1xx411c7mD?share_source=tiktok.com';
    const platBili = detectPlatform(bilibiliWithTikTokParam);
    expect(platBili === 'bilibili', 'Bilibili link with tiktok in query param is detected as bilibili', 'R1-Regex-CrossPlatform', `Detected: ${platBili}`);

    // Case D: TikTok link with clean URL
    const standardTikTok = 'https://www.tiktok.com/@user/video/7234567890123456789';
    expect(detectPlatform(standardTikTok) === 'tiktok', 'Standard TikTok link is detected as tiktok', 'R1-Regex-CrossPlatform');

    // Case E: ADVERSARIAL CHALLENGE — TikTok link with other platforms in query params!
    const tiktokWithDouyinParam = 'https://www.tiktok.com/@user/video/7234567890123456789?ref=douyin.com';
    const platTiktokDouyin = detectPlatform(tiktokWithDouyinParam);
    // If detectPlatform uses lower.includes('douyin.com'), it will mistakenly return 'douyin' instead of 'tiktok'!
    const isTiktokCorrect1 = platTiktokDouyin === 'tiktok';
    expect(isTiktokCorrect1, 'TikTok link with douyin.com in query param MUST be detected as tiktok', 'R1-Regex-CrossPlatform', `Detected: ${platTiktokDouyin}`);
    if (!isTiktokCorrect1) {
      console.warn('  ⚠️ VULNERABILITY FOUND: detectPlatform falsely categorizes TikTok URL with ?ref=douyin.com as "douyin" because lower.includes("douyin.com") runs first!');
    }

    const tiktokWithYoutubeParam = 'https://www.tiktok.com/@user/video/7234567890123456789?utm_source=youtube.com';
    const platTiktokYoutube = detectPlatform(tiktokWithYoutubeParam);
    const isTiktokCorrect2 = platTiktokYoutube === 'tiktok';
    expect(isTiktokCorrect2, 'TikTok link with youtube.com in query param MUST be detected as tiktok', 'R1-Regex-CrossPlatform', `Detected: ${platTiktokYoutube}`);
    if (!isTiktokCorrect2) {
      console.warn('  ⚠️ VULNERABILITY FOUND: detectPlatform falsely categorizes TikTok URL with ?utm_source=youtube.com as "youtube" because lower.includes("youtube.com") runs before tiktok!');
    }

    // ════════════════════════════════════════════════════════════════════════
    // 3. R1: YT-DLP FALLBACK RESILIENCE & API ERROR HANDLING
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- 3. R1: yt-dlp Fallback Resilience & Error Handling ---');

    // 3.1 Non-existent TikTok video ID
    console.log('  Testing non-existent TikTok link inspectMediaUrl...');
    try {
      await inspectMediaUrl('https://www.tiktok.com/@vanhsub_nonexistent_user_9999/video/9999999999999999999');
      recordTest('Non-existent TikTok URL should reject', 'R1-Fallback-Resilience', false, 'Unexpectedly resolved');
    } catch (err: any) {
      recordTest('Non-existent TikTok URL rejects gracefully with error message', 'R1-Fallback-Resilience', true, `Caught handled error: ${err.message?.slice(0, 80)}...`);
    }

    // 3.2 Direct inspectViaYtDlp verification on valid public media
    console.log('  Testing inspectViaYtDlp resilience directly...');
    try {
      const ytDlpMeta = await inspectViaYtDlp(
        'https://www.tiktok.com/@scout2015/video/6718335390845095173',
        'https://www.tiktok.com/@scout2015/video/6718335390845095173',
        'tiktok'
      );
      expect(ytDlpMeta.platform === 'tiktok', 'inspectViaYtDlp preserves tiktok platform', 'R1-Fallback-Resilience');
      expect(Boolean(ytDlpMeta.title), 'inspectViaYtDlp returns valid title', 'R1-Fallback-Resilience', ytDlpMeta.title);
      expect(Array.isArray(ytDlpMeta.availableQualities) && ytDlpMeta.availableQualities.length > 0, 'inspectViaYtDlp provides qualities', 'R1-Fallback-Resilience');
    } catch (err: any) {
      recordTest('inspectViaYtDlp fallback execution', 'R1-Fallback-Resilience', false, undefined, err.message);
    }

    // ════════════════════════════════════════════════════════════════════════
    // 4. R4: SPEED BOUNDARY CONDITIONS & CLAMPING STRESS TESTING
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- 4. R4: Speed Boundary Conditions & Clamping ---');

    const testSpeeds = [
      { input: 1.00, expectedSpeed: 1.00, expectFilter: false, label: 'Boundary: 1.00x exactly' },
      { input: 1.01, expectedSpeed: 1.01, expectFilter: true, label: 'Boundary: 1.01x (min step)' },
      { input: 1.02, expectedSpeed: 1.02, expectFilter: true, label: 'Fine step: 1.02x' },
      { input: 1.50, expectedSpeed: 1.50, expectFilter: true, label: 'Standard: 1.50x' },
      { input: 1.99, expectedSpeed: 1.99, expectFilter: true, label: 'Boundary: 1.99x (max step)' },
      { input: 2.00, expectedSpeed: 2.00, expectFilter: true, label: 'Boundary: 2.00x exactly' },
      { input: 2.01, expectedSpeed: 2.00, expectFilter: true, label: 'Overshoot: 2.01x clamped to 2.00x' },
      { input: 3.50, expectedSpeed: 2.00, expectFilter: true, label: 'Overshoot: 3.50x clamped to 2.00x' },
      { input: 99.0, expectedSpeed: 2.00, expectFilter: true, label: 'Extreme high: 99.0x clamped to 2.00x' },
      { input: 0.99, expectedSpeed: 1.00, expectFilter: false, label: 'Undershoot: 0.99x clamped to 1.00x' },
      { input: 0.50, expectedSpeed: 1.00, expectFilter: false, label: 'Undershoot: 0.50x clamped to 1.00x' },
      { input: 0.00, expectedSpeed: 1.00, expectFilter: false, label: 'Zero: 0.00x clamped to 1.00x' },
      { input: -1.5, expectedSpeed: 1.00, expectFilter: false, label: 'Negative: -1.50x clamped to 1.00x' },
      { input: NaN, expectedSpeed: 1.00, expectFilter: false, label: 'Invalid: NaN clamped to 1.00x' },
      { input: undefined as any, expectedSpeed: 1.00, expectFilter: false, label: 'Undefined clamped to 1.00x' },
    ];

    for (const tc of testSpeeds) {
      const graph = buildHardsubFilterGraph({
        formatOptions: { speed: tc.input },
        escapedSubPath: 'dummy.srt',
        hasAudio: true,
      });

      expect(graph.effectiveSpeed === tc.expectedSpeed, `${tc.label} -> effectiveSpeed is ${tc.expectedSpeed}`, 'R4-Speed-Boundary', `Actual: ${graph.effectiveSpeed}`);

      const hasSetpts = graph.filterChains.some((c) => c.includes('setpts=PTS/'));
      const hasAtempo = graph.filterChains.some((c) => c.includes('atempo='));

      expect(hasSetpts === tc.expectFilter, `${tc.label} -> setpts filter presence`, 'R4-Speed-Boundary', `hasSetpts: ${hasSetpts}`);
      expect(hasAtempo === tc.expectFilter, `${tc.label} -> atempo filter presence`, 'R4-Speed-Boundary', `hasAtempo: ${hasAtempo}`);

      if (tc.expectFilter) {
        expect(graph.hasAudioFilter === true, `${tc.label} -> hasAudioFilter is true`, 'R4-Speed-Boundary');
      } else {
        expect(graph.hasAudioFilter === false, `${tc.label} -> hasAudioFilter is false`, 'R4-Speed-Boundary');
      }
    }

    // Floating-point precision verification
    const precisionGraph = buildHardsubFilterGraph({
      formatOptions: { speed: 1.0200000000000002 },
      escapedSubPath: 'dummy.srt',
      hasAudio: true,
    });
    expect(precisionGraph.effectiveSpeed === 1.02, 'Floating-point speed 1.0200000000000002 rounds to 1.02', 'R4-Speed-Precision');

    // ════════════════════════════════════════════════════════════════════════
    // 5. R4: VIDEOS WITHOUT AUDIO TRACKS SAFETY
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- 5. R4: Audio-less Video Safety ---');

    for (const testSpeed of [1.00, 1.01, 1.25, 1.50, 2.00, 2.50]) {
      const graphAudioLess = buildHardsubFilterGraph({
        formatOptions: { speed: testSpeed },
        escapedSubPath: 'dummy.srt',
        hasAudio: false, // NO AUDIO STREAM
      });

      expect(graphAudioLess.hasAudioFilter === false, `hasAudio: false with speed ${testSpeed} hasAudioFilter is FALSE`, 'R4-Audio-less');
      const hasAtempoInAudioLess = graphAudioLess.filterChains.some((c) => c.includes('atempo'));
      expect(hasAtempoInAudioLess === false, `hasAudio: false with speed ${testSpeed} MUST NOT contain atempo filter`, 'R4-Audio-less');

      if (testSpeed > 1.0) {
        const hasSetptsInAudioLess = graphAudioLess.filterChains.some((c) => c.includes('setpts=PTS/'));
        expect(hasSetptsInAudioLess === true, `hasAudio: false with speed ${testSpeed} retains video setpts filter`, 'R4-Audio-less');
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 6. R4: END-TO-END FFMPEG RENDER COMBINATION: MIRROR + SPEEDUP + SUBTITLES
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- 6. R4: FFmpeg Render Combination: Mirror + Speedup + Subtitles ---');

    const srtPath = path.join(testTempDir, 'adversarial_sub.srt');
    createDummySrt(srtPath);

    // 6.1 Video WITH Audio: Mirror + Speedup 1.5x + Subtitles
    const inputWithAudio = path.join(testTempDir, 'input_with_audio_4s.mp4');
    const outputWithAudio = path.join(testTempDir, 'output_mirror_speed_with_audio.mp4');
    console.log('  Generating synthetic 4.0s video with audio...');
    await createSyntheticVideo(inputWithAudio, 4.0, true);

    const metaInAudio = await getVideoMetadata(inputWithAudio);
    expect(metaInAudio.hasAudio === true, 'Synthetic video has audio stream confirmed', 'R4-FFmpeg-Render');

    let reportedProgressWithAudio = 0;
    console.log('  Executing burnHardsub (mirrorHorizontal: true, speed: 1.50)...');
    await burnHardsub({
      videoPath: inputWithAudio,
      srtPath,
      outputPath: outputWithAudio,
      formatOptions: {
        mirrorHorizontal: true,
        speed: 1.50,
      },
      onProgress: (p) => {
        reportedProgressWithAudio = p;
      },
    });

    expect(fs.existsSync(outputWithAudio), 'Output MP4 with audio exists after burnHardsub', 'R4-FFmpeg-Render');
    const outAudioStats = fs.statSync(outputWithAudio);
    expect(outAudioStats.size > 1000, `Output MP4 size is valid (${outAudioStats.size} bytes)`, 'R4-FFmpeg-Render');

    const metaOutAudio = await getVideoMetadata(outputWithAudio);
    expect(metaOutAudio.hasAudio === true, 'Output MP4 preserves audio stream', 'R4-FFmpeg-Render');
    // Target duration: 4.0s / 1.5 = 2.66s (allow ±0.15s tolerance due to container headers)
    const expectedDurAudio = 4.0 / 1.5;
    const durDiffAudio = Math.abs(metaOutAudio.duration - expectedDurAudio);
    expect(durDiffAudio < 0.25, `Output duration compressed accurately: ${metaOutAudio.duration.toFixed(2)}s (Target: ${expectedDurAudio.toFixed(2)}s, diff: ${durDiffAudio.toFixed(2)}s)`, 'R4-FFmpeg-Render');
    expect(reportedProgressWithAudio === 100, `Progress reaches 100% (reported: ${reportedProgressWithAudio}%)`, 'R4-FFmpeg-Render');

    // 6.2 Video WITHOUT Audio: Mirror + Speedup 1.75x + Subtitles
    const inputNoAudio = path.join(testTempDir, 'input_no_audio_4s.mp4');
    const outputNoAudio = path.join(testTempDir, 'output_mirror_speed_no_audio.mp4');
    console.log('  Generating synthetic 4.0s video without audio...');
    await createSyntheticVideo(inputNoAudio, 4.0, false);

    const metaInNoAudio = await getVideoMetadata(inputNoAudio);
    expect(metaInNoAudio.hasAudio === false, 'Synthetic video has NO audio confirmed', 'R4-FFmpeg-Render');

    let reportedProgressNoAudio = 0;
    console.log('  Executing burnHardsub on audio-less video (mirrorHorizontal: true, speed: 1.75)...');
    await burnHardsub({
      videoPath: inputNoAudio,
      srtPath,
      outputPath: outputNoAudio,
      formatOptions: {
        mirrorHorizontal: true,
        speed: 1.75,
      },
      onProgress: (p) => {
        reportedProgressNoAudio = p;
      },
    });

    expect(fs.existsSync(outputNoAudio), 'Output MP4 without audio exists after burnHardsub', 'R4-FFmpeg-Render');
    const outNoAudioStats = fs.statSync(outputNoAudio);
    expect(outNoAudioStats.size > 1000, `Output MP4 size is valid (${outNoAudioStats.size} bytes)`, 'R4-FFmpeg-Render');

    const metaOutNoAudio = await getVideoMetadata(outputNoAudio);
    expect(metaOutNoAudio.hasAudio === false, 'Output MP4 safely maintains noAudio()', 'R4-FFmpeg-Render');
    const expectedDurNoAudio = 4.0 / 1.75;
    const durDiffNoAudio = Math.abs(metaOutNoAudio.duration - expectedDurNoAudio);
    expect(durDiffNoAudio < 0.25, `Output duration compressed accurately: ${metaOutNoAudio.duration.toFixed(2)}s (Target: ${expectedDurNoAudio.toFixed(2)}s, diff: ${durDiffNoAudio.toFixed(2)}s)`, 'R4-FFmpeg-Render');
    expect(reportedProgressNoAudio === 100, `Progress reaches 100% for audio-less video (reported: ${reportedProgressNoAudio}%)`, 'R4-FFmpeg-Render');

    // 6.3 Verification of Filtergraph sequence: mirror -> subtitles -> setpts
    const fullGraph = buildHardsubFilterGraph({
      formatOptions: {
        mirrorHorizontal: true,
        speed: 1.35,
      },
      escapedSubPath: 'dummy.srt',
      hasAudio: true,
    });

    const hflipIdx = fullGraph.filterChains.findIndex((c) => c.includes('hflip'));
    const subIdx = fullGraph.filterChains.findIndex((c) => c.includes('subtitles='));
    const speedIdx = fullGraph.filterChains.findIndex((c) => c.includes('setpts=PTS/'));

    expect(hflipIdx !== -1, 'hflip filter is present', 'R4-Filter-Sequence');
    expect(subIdx !== -1, 'subtitles filter is present', 'R4-Filter-Sequence');
    expect(speedIdx !== -1, 'setpts filter is present', 'R4-Filter-Sequence');
    expect(hflipIdx < subIdx, 'CRITICAL: hflip filter is placed BEFORE subtitles (subtitles will NOT be mirrored)', 'R4-Filter-Sequence');
    expect(subIdx < speedIdx, 'CRITICAL: subtitles filter is placed BEFORE setpts (subtitles sync exactly with video speedup)', 'R4-Filter-Sequence');

    // ════════════════════════════════════════════════════════════════════════
    // 7. R4: EFFECTIVE DURATION & PROGRESS TRACKING ACCURACY
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n--- 7. R4: Effective Duration & Progress Tracking Arithmetic ---');

    expect(calculateEffectiveDuration(100, 1.00) === 100, 'Effective duration at 1.00x', 'R4-Arithmetic');
    expect(calculateEffectiveDuration(100, 2.00) === 50, 'Effective duration at 2.00x', 'R4-Arithmetic');
    expect(Math.abs(calculateEffectiveDuration(100, 1.01) - (100 / 1.01)) < 1e-6, 'Effective duration at 1.01x', 'R4-Arithmetic');
    expect(calculateEffectiveDuration(100, 3.00) === 50, 'Effective duration at 3.00x clamped to 2.00x', 'R4-Arithmetic');
    expect(calculateEffectiveDuration(100, 0.50) === 100, 'Effective duration at 0.50x clamped to 1.00x', 'R4-Arithmetic');
    expect(calculateEffectiveDuration(0, 1.50) === 0, 'Effective duration with rawDuration = 0 is 0', 'R4-Arithmetic');
    expect(calculateEffectiveDuration(-10, 1.50) === -10, 'Effective duration with negative rawDuration', 'R4-Arithmetic');
    expect(calculateEffectiveDuration(100, NaN) === 100, 'Effective duration with NaN speed', 'R4-Arithmetic');

    // calculateRenderProgress
    expect(calculateRenderProgress(0, 50) === 0, 'Progress at 0s / 50s is 0%', 'R4-Progress');
    expect(calculateRenderProgress(25, 50) === 50, 'Progress at 25s / 50s is 50.0%', 'R4-Progress');
    expect(calculateRenderProgress(50, 50) === 99.9, 'Progress at 50s / 50s is capped at 99.9% before completion', 'R4-Progress');
    expect(calculateRenderProgress(55, 50) === 99.9, 'Progress exceeding duration is capped at 99.9%', 'R4-Progress');
    expect(calculateRenderProgress(10, 0) === 0, 'Progress with duration 0 returns 0 (no Div/0)', 'R4-Progress');
    expect(calculateRenderProgress(10, -5) === 0, 'Progress with negative duration returns 0', 'R4-Progress');

    // timemarkToSeconds
    expect(timemarkToSeconds('00:00:10.50') === 10.5, 'timemark 00:00:10.50 -> 10.5s', 'R4-Progress');
    expect(timemarkToSeconds('00:02:15.00') === 135, 'timemark 00:02:15.00 -> 135s', 'R4-Progress');
    expect(timemarkToSeconds('01:10:05.00') === 4205, 'timemark 01:10:05.00 -> 4205s', 'R4-Progress');
    expect(timemarkToSeconds('05:30') === 330, 'timemark 05:30 -> 330s', 'R4-Progress');
    expect(timemarkToSeconds('') === 0, 'timemark empty string -> 0s', 'R4-Progress');

  } finally {
    // Dọn dẹp temp
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY REPORT
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(70));
  console.log('   TỔNG KẾT KẾT QUẢ ADVERSARIAL STRESS TEST');
  console.log('═'.repeat(70));

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`\nTổng số kiểm thử: ${total}`);
  console.log(`Thành công (PASS): ${passed}`);
  console.log(`Thất bại (FAIL):   ${failed}`);

  if (failed > 0) {
    console.log('\nDanh sách các bài test thất bại:');
    for (const f of results.filter((r) => !r.passed)) {
      console.log(`  ❌ [${f.category}] ${f.name} - ${f.error || f.details}`);
    }
  }

  console.log('\n' + '═'.repeat(70) + '\n');
}

runAdversarialSuite().catch((err) => {
  console.error('Lỗi nghiêm trọng khi chạy Adversarial Suite:', err);
  process.exit(1);
});
