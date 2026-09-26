import fs from 'fs';
import path from 'path';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';
import {
  buildHardsubFilterGraph,
  calculateEffectiveDuration,
  calculateRenderProgress,
  timemarkToSeconds,
  getVideoMetadata,
  burnHardsub,
  type ExportFormatOptions,
  type CustomMaskRegion,
} from '../main/render/videoRenderer';

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

function createSyntheticVideoWithAudio(outputPath: string, durationSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(`testsrc=duration=${durationSec}:size=320x240:rate=25`)
      .inputFormat('lavfi')
      .input(`sine=frequency=1000:duration=${durationSec}`)
      .inputFormat('lavfi')
      .outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-shortest',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

function createSyntheticVideoWithoutAudio(outputPath: string, durationSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(`testsrc=duration=${durationSec}:size=320x240:rate=25`)
      .inputFormat('lavfi')
      .outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-an',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

async function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: CapCut Mini Export Tools (Requirement R4)\n');

  // ==========================================================================
  // Section 1: Filtergraph Construction (hflip, setpts, atempo ordering)
  // ==========================================================================
  console.log('--- Section 1: Filtergraph Construction & Ordering ---');

  // Case 1.1: Default options (No mirror, normal speed 1.0, with audio)
  {
    const result = buildHardsubFilterGraph({
      formatOptions: { aspectRatio: 'original', speed: 1.0, mirrorHorizontal: false },
      escapedSubPath: 'dummy_sub.srt',
      hasAudio: true,
    });

    const fullGraph = result.filterChains.join(';');
    assert(!fullGraph.includes('hflip'), 'Mặc định: không chứa filter hflip');
    assert(!fullGraph.includes('setpts='), 'Mặc định: không chứa filter setpts');
    assert(!fullGraph.includes('atempo='), 'Mặc định: không chứa filter atempo');
    assert(fullGraph.includes("subtitles=filename='dummy_sub.srt'"), 'Chứa filter subtitles');
    assert(fullGraph.endsWith('[vout]'), 'Luồng video cuối cùng kết thúc bằng [vout]');
    assert(result.hasAudioFilter === false, 'hasAudioFilter là false khi speed = 1.0');
    assert(result.effectiveSpeed === 1.0, 'effectiveSpeed là 1.0');
  }

  // Case 1.2: Horizontal Mirror only
  {
    const result = buildHardsubFilterGraph({
      formatOptions: { mirrorHorizontal: true, speed: 1.0 },
      escapedSubPath: 'dummy_sub.srt',
      hasAudio: true,
    });

    const fullGraph = result.filterChains.join(';');
    assert(fullGraph.includes('hflip'), 'Có chứa filter hflip khi mirrorHorizontal: true');

    const hflipIdx = fullGraph.indexOf('hflip');
    const subIdx = fullGraph.indexOf('subtitles=');
    assert(hflipIdx !== -1 && subIdx !== -1, 'Cả hflip và subtitles đều tồn tại');
    assert(hflipIdx < subIdx, 'Filter hflip nằm TRƯỚC filter subtitles= (bảo đảm phụ đề không bị lật ngược)');

    const mirrorChain = result.filterChains.find((c) => c.includes('hflip'));
    assert(mirrorChain?.includes('[0:v]hflip[v_mirror]') === true, 'hflip nhận stream gốc [0:v] và xuất ra [v_mirror]');

    const subChain = result.filterChains.find((c) => c.includes('subtitles='));
    assert(subChain?.includes('[v_mirror]subtitles=') === true, 'subtitles nhận trực tiếp luồng [v_mirror]');
  }

  // Case 1.3: Speedup only (1.25x with audio)
  {
    const result = buildHardsubFilterGraph({
      formatOptions: { mirrorHorizontal: false, speed: 1.25 },
      escapedSubPath: 'dummy_sub.srt',
      hasAudio: true,
    });

    const fullGraph = result.filterChains.join(';');
    assert(fullGraph.includes('setpts=PTS/1.25'), 'Video filter chứa setpts=PTS/1.25');
    assert(fullGraph.includes('[0:a:0]atempo=1.25[aout]'), 'Audio filter chứa [0:a:0]atempo=1.25[aout]');
    assert(result.hasAudioFilter === true, 'hasAudioFilter là true khi có audio và speed > 1.0');
    assert(result.effectiveSpeed === 1.25, 'effectiveSpeed ghi nhận chuẩn xác 1.25');

    const subIdx = fullGraph.indexOf('subtitles=');
    const setptsIdx = fullGraph.indexOf('setpts=PTS/1.25');
    assert(subIdx < setptsIdx, 'Filter subtitles= nằm TRƯỚC setpts (đồng bộ thời gian phụ đề theo PTS)');
  }

  // Case 1.4: Speedup on video with NO audio stream
  {
    const result = buildHardsubFilterGraph({
      formatOptions: { speed: 1.50 },
      escapedSubPath: 'dummy_sub.srt',
      hasAudio: false,
    });

    const fullGraph = result.filterChains.join(';');
    assert(fullGraph.includes('setpts=PTS/1.5'), 'Video vẫn áp dụng setpts khi không có audio');
    assert(!fullGraph.includes('atempo='), 'TUYỆT ĐỐI không chèn filter atempo khi video không có audio stream');
    assert(result.hasAudioFilter === false, 'hasAudioFilter là false để tránh FFmpeg báo lỗi missing audio stream');
  }

  // Case 1.5: Combined Mirror + Speedup (1.05x, step 0.01 precision) + Custom Mask + Watermark
  {
    const mask: CustomMaskRegion = {
      xPercent: 10,
      yPercent: 75,
      widthPercent: 80,
      heightPercent: 15,
      mode: 'blur',
      enabled: true,
    };

    const result = buildHardsubFilterGraph({
      formatOptions: {
        aspectRatio: '16:9',
        mirrorHorizontal: true,
        speed: 1.05,
      },
      customMasks: [mask],
      watermark: {
        type: 'text',
        content: 'VANHSUB STUDIO',
        position: 'top_right',
      },
      escapedSubPath: 'dummy_sub.srt',
      hasAudio: true,
    });

    const fullGraph = result.filterChains.join(';');
    const aspectIdx = fullGraph.indexOf('scale=1920:1080');
    const mirrorIdx = fullGraph.indexOf('hflip');
    const maskIdx = fullGraph.indexOf('boxblur=');
    const subIdx = fullGraph.indexOf('subtitles=');
    const wmIdx = fullGraph.indexOf("text='VANHSUB STUDIO'");
    const speedIdx = fullGraph.indexOf('setpts=PTS/1.05');
    const audioSpeedIdx = fullGraph.indexOf('atempo=1.05');

    assert(aspectIdx !== -1, '1. Aspect Ratio scale tồn tại');
    assert(mirrorIdx !== -1, '2. Mirror hflip tồn tại');
    assert(maskIdx !== -1, '3. Mask tồn tại');
    assert(subIdx !== -1, '4. Subtitles tồn tại');
    assert(wmIdx !== -1, '5. Watermark tồn tại');
    assert(speedIdx !== -1, '6. Speed setpts tồn tại');
    assert(audioSpeedIdx !== -1, '7. Audio speed atempo tồn tại');

    assert(
      aspectIdx < mirrorIdx &&
      mirrorIdx < maskIdx &&
      maskIdx < subIdx &&
      subIdx < wmIdx &&
      wmIdx < speedIdx,
      'Thứ tự chuỗi video chuẩn: Aspect -> Mirror -> Mask -> Subtitles -> Watermark -> Speed (setpts)'
    );
  }

  // Case 1.6: Arbitrary Speed Presets & Boundary Clamping
  {
    const testCases = [
      { input: 1.00, expectedSpeed: 1.0, hasFilter: false },
      { input: 1.02, expectedSpeed: 1.02, hasFilter: true },
      { input: 1.03, expectedSpeed: 1.03, hasFilter: true },
      { input: 1.10, expectedSpeed: 1.10, hasFilter: true },
      { input: 1.25, expectedSpeed: 1.25, hasFilter: true },
      { input: 2.00, expectedSpeed: 2.00, hasFilter: true },
      { input: 0.50, expectedSpeed: 1.00, hasFilter: false }, // Clamped to min 1.0
      { input: 2.80, expectedSpeed: 2.00, hasFilter: true },  // Clamped to max 2.0
    ];

    for (const tc of testCases) {
      const res = buildHardsubFilterGraph({
        formatOptions: { speed: tc.input },
        escapedSubPath: 'dummy.srt',
        hasAudio: true,
      });

      assert(
        Math.abs(res.effectiveSpeed - tc.expectedSpeed) < 0.001,
        `Tốc độ ${tc.input}x được xử lý thành ${tc.expectedSpeed}x`
      );

      const graph = res.filterChains.join(';');
      if (tc.hasFilter) {
        assert(graph.includes(`setpts=PTS/${tc.expectedSpeed}`), `Chứa setpts=PTS/${tc.expectedSpeed}`);
        assert(graph.includes(`atempo=${tc.expectedSpeed}`), `Chứa atempo=${tc.expectedSpeed}`);
      } else {
        assert(!graph.includes('setpts='), `Không có setpts khi tốc độ = 1.00`);
      }
    }
  }

  // ==========================================================================
  // Section 2: Duration Recalculation & Smooth Progress Math
  // ==========================================================================
  console.log('\n--- Section 2: Duration Recalculation & Render Progress ---');

  {
    // 10s video at 1.25x speed -> 8s effective
    const rawDuration = 10.0;
    const effective125 = calculateEffectiveDuration(rawDuration, 1.25);
    assert(Math.abs(effective125 - 8.0) < 0.001, '10s video ở 1.25x có thời lượng hiệu dụng = 8.0s');

    // 10s video at 2.00x speed -> 5s effective
    const effective200 = calculateEffectiveDuration(rawDuration, 2.00);
    assert(Math.abs(effective200 - 5.0) < 0.001, '10s video ở 2.00x có thời lượng hiệu dụng = 5.0s');

    // 60s video at 1.00x speed -> 60s effective
    const effective100 = calculateEffectiveDuration(60.0, 1.00);
    assert(Math.abs(effective100 - 60.0) < 0.001, '60s video ở 1.00x giữ nguyên 60.0s');

    // Progress calculation checks
    // At currentSec = 4s out of 8s effective -> 50%
    const p50 = calculateRenderProgress(4.0, 8.0);
    assert(p50 === 50, 'Tiến trình tại 4.0s / 8.0s đạt đúng 50.0%');

    // At currentSec = 8s out of 8s effective -> 99.9% (capped before onEnd gives 100%)
    const pEnd = calculateRenderProgress(8.0, 8.0);
    assert(pEnd === 99.9, 'Tiến trình tại 8.0s / 8.0s đạt mượt mà 99.9%');

    // Timemark converter
    assert(timemarkToSeconds('00:00:08.50') === 8.5, 'timemark 00:00:08.50 -> 8.5s');
    assert(timemarkToSeconds('00:01:20.00') === 80.0, 'timemark 00:01:20.00 -> 80s');
  }

  // ==========================================================================
  // Section 3: Direct FFmpeg Render on Synthetic Media
  // ==========================================================================
  console.log('\n--- Section 3: Direct FFmpeg Render on Synthetic Video ---');

  const tmpDir = path.join(os.tmpdir(), `vanhsub_test_r4_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const syntheticVideoWithAudio = path.join(tmpDir, 'synth_input_with_audio.mp4');
  const syntheticVideoNoAudio = path.join(tmpDir, 'synth_input_no_audio.mp4');
  const dummySrtPath = path.join(tmpDir, 'test_subtitles.srt');
  const outputRender1 = path.join(tmpDir, 'synth_output_mirror_speed.mp4');
  const outputRender2 = path.join(tmpDir, 'synth_output_no_audio_speed.mp4');

  try {
    // Tạo file SRT mẫu
    fs.writeFileSync(
      dummySrtPath,
      '1\n00:00:01,000 --> 00:00:03,000\nVANHSUB R4 CAPCUT MINI TEST\n',
      'utf-8'
    );

    console.log('  Generating synthetic test video with audio (4.0s)...');
    await createSyntheticVideoWithAudio(syntheticVideoWithAudio, 4);
    const metaIn = await getVideoMetadata(syntheticVideoWithAudio);
    assert(metaIn.duration >= 3.8 && metaIn.duration <= 4.2, `Video gốc có audio được tạo (duration: ${metaIn.duration.toFixed(2)}s)`);
    assert(metaIn.hasAudio === true, 'Video gốc phát hiện có audio stream');

    console.log('  Executing direct burnHardsub with mirrorHorizontal: true and speed: 1.25...');
    let reportedProgress: number[] = [];
    await burnHardsub({
      videoPath: syntheticVideoWithAudio,
      srtPath: dummySrtPath,
      outputPath: outputRender1,
      formatOptions: {
        mirrorHorizontal: true,
        speed: 1.25,
      },
      onProgress: (p) => {
        reportedProgress.push(p);
      },
    });

    assert(fs.existsSync(outputRender1), 'File video render hoàn tất và tồn tại trên đĩa');
    const outStats = fs.statSync(outputRender1);
    assert(outStats.size > 1000, `Kích thước file xuất hợp lệ (${outStats.size} bytes)`);

    const metaOut = await getVideoMetadata(outputRender1);
    // 4.0s / 1.25 = 3.2s
    console.log(`  Rendered duration: ${metaOut.duration.toFixed(2)}s (Target: 3.20s)`);
    assert(
      Math.abs(metaOut.duration - 3.2) <= 0.25,
      `Thời lượng video sau khi tua 1.25x là ${metaOut.duration.toFixed(2)}s (khớp 4.0s / 1.25 = 3.20s)`
    );
    assert(metaOut.hasAudio === true, 'Video đầu ra bảo toàn audio stream đã được atempo 1.25x');
    assert(reportedProgress.includes(100), 'Tiến trình render đạt 100%');

    // Test 3.2: Direct Render on Video WITHOUT Audio
    console.log('\n  Generating synthetic video without audio (3.0s)...');
    await createSyntheticVideoWithoutAudio(syntheticVideoNoAudio, 3);
    const metaNoAudIn = await getVideoMetadata(syntheticVideoNoAudio);
    assert(metaNoAudIn.hasAudio === false, 'Video không có audio stream được nhận diện chính xác');

    console.log('  Executing direct burnHardsub on audio-less video with speed: 1.50...');
    let noAudioProgress: number[] = [];
    await burnHardsub({
      videoPath: syntheticVideoNoAudio,
      srtPath: dummySrtPath,
      outputPath: outputRender2,
      formatOptions: {
        mirrorHorizontal: true,
        speed: 1.50,
      },
      onProgress: (p) => {
        noAudioProgress.push(p);
      },
    });

    assert(fs.existsSync(outputRender2), 'Video không có tiếng xuất thành công mà không gây lỗi FFmpeg');
    const metaNoAudOut = await getVideoMetadata(outputRender2);
    // 3.0s / 1.5 = 2.0s
    console.log(`  Rendered duration: ${metaNoAudOut.duration.toFixed(2)}s (Target: 2.00s)`);
    assert(
      Math.abs(metaNoAudOut.duration - 2.0) <= 0.25,
      `Thời lượng video sau khi tua 1.50x là ${metaNoAudOut.duration.toFixed(2)}s (khớp 3.0s / 1.5 = 2.00s)`
    );
    assert(noAudioProgress.includes(100), 'Tiến trình render video không tiếng đạt 100%');

  } finally {
    // Cleanup temporary test files
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (e) {
      // ignore
    }
  }

  console.log(`\n🎉 KẾT QUẢ: ${passedCount}/${totalCount} tests PASSED (100% thành công)!\n`);
}

runTests().catch((err) => {
  console.error('Fatal test failure:', err);
  process.exit(1);
});
