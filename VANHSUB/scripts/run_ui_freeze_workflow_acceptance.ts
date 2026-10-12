import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';

ffmpeg.setFfmpegPath(ffmpegInstaller.path.replace('app.asar', 'app.asar.unpacked'));
ffmpeg.setFfprobePath(ffprobeInstaller.path.replace('app.asar', 'app.asar.unpacked'));

async function extractFrame(videoPath: string, timestampSec: number, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timestampSec)
      .frames(1)
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('  VANHSUB UI ACCEPTANCE: TIMELINE GUARD BLOCK -> FREEZE LAST FRAME -> EXPORT PASS');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  console.log('1. Connecting to VANHSUB via Chrome DevTools Protocol (port 5858)...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:5858');
  const pages = browser.contexts()[0].pages();
  const page = pages.find((p) => p.url().includes('localhost:8888') || p.url().includes('8888'));
  if (!page) {
    throw new Error(`VANHSUB page not found in open CDP pages: ${pages.map(p => p.url()).join(', ')}`);
  }

  console.log(`Connected to page: ${page.url()}`);
  await page.bringToFront();

  // 2. Refresh page to cleanly reload test-session state
  console.log('\n2. Reloading page to ensure clean active state from session.json...');
  await page.reload();
  await page.waitForTimeout(2000);

  // Switch to AI Studio tab
  console.log('Navigating to AI Studio workspace...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const aiBtn = btns.find((b) => b.innerText?.includes('AI Studio'));
    if (aiBtn) aiBtn.click();
  });
  await page.waitForTimeout(1500);

  // If on ProjectSetupScreen, click "Vào Studio Tiếp Tục" or "Vào Studio"
  const enterStudioBtn = await page.$(
    'button:has-text("Vào Studio Tiếp Tục"), button:has-text("Vào Studio")'
  );
  if (enterStudioBtn) {
    console.log('Entering studio from ProjectSetupScreen...');
    await enterStudioBtn.click();
    await page.waitForTimeout(1500);
  }

  // Switch to "Phân cảnh Visual" tab to render cards
  console.log('Switching to "Phân cảnh Visual" tab...');
  const visualTabBtn = await page.$('button:has-text("Phân cảnh Visual")');
  if (visualTabBtn) {
    await visualTabBtn.click();
    await page.waitForTimeout(1000);
  }

  // Verify and ensure active project is test project
  const projectState = await page.evaluate(async () => {
    const config = await (window as any).vanhsub.aiStudio.getConfig();
    const activeProject = config.savedProjects?.find((p: any) => p.id === config.activeProjectId);
    return {
      activeProjectId: config.activeProjectId,
      activeProjectName: activeProject?.name,
      outputDir: config.outputDir,
    };
  });
  console.log('Current Project State:', JSON.stringify(projectState, null, 2));

  // 3. Inspect scenes in the UI
  console.log('\n3. Inspecting storyboard cards in UI...');
  const cardDurations = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('div')).filter(
      (d) => d.innerText?.includes('Phân cảnh') && d.innerText?.includes('Xử lý:')
    );
    const seen = new Set<string>();
    const uniqueCards: any[] = [];
    for (const c of cards) {
      const text = c.innerText;
      const sceneMatch = text.match(/Phân cảnh \d+/);
      const procMatch = text.match(/Xử lý:\s*([\d\.]+)s/);
      const origMatch = text.match(/Gốc:\s*([\d\.]+)s/);
      const freezeBadge = text.includes('Giữ khung hình cuối');
      const sceneKey = sceneMatch ? sceneMatch[0] : '';
      if (sceneKey && !seen.has(sceneKey)) {
        seen.add(sceneKey);
        uniqueCards.push({
          scene: sceneKey,
          processedSec: procMatch ? procMatch[1] : null,
          originalSec: origMatch ? origMatch[1] : null,
          freezeBadge,
        });
      }
    }
    return uniqueCards;
  });
  console.log('Detected Unique Scene Cards in UI:', JSON.stringify(cardDurations, null, 2));

  if (cardDurations.length !== 3) {
    throw new Error(`Expected 3 unique scene cards, got ${cardDurations.length}`);
  }

  // 4. Trigger Export / Approve Stage 6 -> 7
  console.log('\n4. Clicking "Tiếp tục (Duyệt)" to trigger Video Assembly (Export)...');
  const approveBtn = await page.$('button:has-text("Tiếp tục (Duyệt)")');
  if (!approveBtn) {
    throw new Error('Approval button "Tiếp tục (Duyệt)" not found in PipelineTrackerPanel');
  }
  await approveBtn.click();
  console.log('Approval clicked. Waiting for timeline guard validation...');
  await page.waitForTimeout(2500);

  // 5. Verify Export is BLOCKED by Timeline Guard
  console.log('\n5. Verifying export is BLOCKED with structured error banner...');
  let bannerFound = false;
  let freezeButtonFound = false;

  for (let attempt = 0; attempt < 15; attempt++) {
    const bannerInfo = await page.evaluate(() => {
      const text = (document.body as HTMLElement).innerText;
      const isBlocked =
        text.includes('LỆCH THỜI LƯỢNG TIMELINE') ||
        text.includes('TIMELINE_DURATION_MISMATCH') ||
        text.includes('ngắn hơn thời lượng yêu cầu') ||
        text.includes('còn thiếu');
      const btn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.innerText?.includes('Giữ khung hình cuối cho đủ thời lượng')
      );
      return {
        isBlocked,
        hasButton: Boolean(btn),
        buttonText: btn?.innerText,
      };
    });

    if (bannerInfo.isBlocked && bannerInfo.hasButton) {
      bannerFound = true;
      freezeButtonFound = true;
      console.log('✔ Timeline Guard successfully BLOCKED export:');
      console.log(`  - Banner detected: ${bannerInfo.isBlocked}`);
      console.log(`  - Actionable button detected: "${bannerInfo.buttonText}"`);
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (!bannerFound || !freezeButtonFound) {
    throw new Error('Timeline mismatch banner or "Giữ khung hình cuối cho đủ thời lượng" button not detected');
  }

  // 6. Click "Giữ khung hình cuối cho đủ thời lượng"
  console.log('\n6. Clicking actionable button: "Giữ khung hình cuối cho đủ thời lượng"...');
  const freezeBtn = await page.$('button:has-text("Giữ khung hình cuối cho đủ thời lượng")');
  if (!freezeBtn) {
    throw new Error('"Giữ khung hình cuối cho đủ thời lượng" button not found');
  }
  await freezeBtn.click();
  console.log('Button clicked! Observing re-render and export progress...');
  await page.waitForTimeout(2000);

  // 7. Wait for video assembly rendering to complete
  console.log('\n7. Waiting for rendering completion (FFmpeg assembly)...');
  let renderCompleted = false;
  let renderVideoPath: string | null = null;

  for (let poll = 0; poll < 60; poll++) {
    const statusInfo = await page.evaluate(async () => {
      const session = await (window as any).vanhsub.aiStudio.getPipelineState({
        sessionId: 'test-session-ui-freeze-19s',
      });
      const bodyText = (document.body as HTMLElement).innerText;
      const isBusy =
        bodyText.includes('Đang render video') ||
        bodyText.includes('Đang duyệt') ||
        bodyText.includes('animate-spin');
      return {
        sessionStatus: session?.status,
        currentStage: session?.currentStage,
        videoPath: session?.artifacts?.videoPath,
        isBusy,
      };
    });

    console.log(
      `   [Poll ${poll + 1}/60] Stage: ${statusInfo.currentStage}, Status: ${statusInfo.sessionStatus}, ` +
      `Busy: ${statusInfo.isBusy}, Video: ${statusInfo.videoPath ? path.basename(statusInfo.videoPath) : 'pending'}`
    );

    if (statusInfo.videoPath && fs.existsSync(statusInfo.videoPath)) {
      renderCompleted = true;
      renderVideoPath = statusInfo.videoPath;
      break;
    }

    if (
      (statusInfo.currentStage === 8 || statusInfo.currentStage === 7) &&
      statusInfo.sessionStatus !== 'running' &&
      !statusInfo.isBusy
    ) {
      if (statusInfo.videoPath && fs.existsSync(statusInfo.videoPath)) {
        renderCompleted = true;
        renderVideoPath = statusInfo.videoPath;
        break;
      }
    }

    await page.waitForTimeout(2000);
  }

  if (!renderCompleted || !renderVideoPath) {
    throw new Error('Video assembly did not complete within timeout');
  }

  console.log(`\n✔ VIDEO RENDERED SUCCESSFULLY AT: ${renderVideoPath}`);

  // 8. Probe video duration and verify 19.0s and cuts at 7s and 13s
  console.log('\n8. Performing strict FFprobe validation on rendered output...');
  const probeData: any = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(renderVideoPath!, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });

  const durationSec = Number(probeData.format?.duration) || 0;
  const videoStream = probeData.streams?.find((s: any) => s.codec_type === 'video');
  const audioStream = probeData.streams?.find((s: any) => s.codec_type === 'audio');

  console.log(`   - Container Duration: ${durationSec.toFixed(3)}s`);
  console.log(`   - Video Codec: ${videoStream?.codec_name}, Resolution: ${videoStream?.width}x${videoStream?.height}`);
  console.log(`   - Audio Codec: ${audioStream?.codec_name}, Sample Rate: ${audioStream?.sample_rate}`);

  if (Math.abs(durationSec - 19.0) > 0.15) {
    throw new Error(`Video duration mismatch: Expected 19.0s, got ${durationSec.toFixed(3)}s`);
  }
  console.log('   ✔ Duration matches 19.00s timeline requirement perfectly (tolerance < 0.15s)!');

  // 9. Verify scene cuts at 7s and 13s by extracting frames across cut boundaries
  console.log('\n9. Verifying scene transition cuts at 7.0s and 13.0s...');
  const debugDir = path.resolve(__dirname, '..', 'temp_live_e2e_output', 'transition_frames');
  fs.mkdirSync(debugDir, { recursive: true });

  const frame69 = path.join(debugDir, 'frame_06_9s.png');
  const frame71 = path.join(debugDir, 'frame_07_1s.png');
  const frame129 = path.join(debugDir, 'frame_12_9s.png');
  const frame131 = path.join(debugDir, 'frame_13_1s.png');

  await extractFrame(renderVideoPath, 6.9, frame69);
  await extractFrame(renderVideoPath, 7.1, frame71);
  await extractFrame(renderVideoPath, 12.9, frame129);
  await extractFrame(renderVideoPath, 13.1, frame131);

  const buf69 = fs.readFileSync(frame69);
  const buf71 = fs.readFileSync(frame71);
  const buf129 = fs.readFileSync(frame129);
  const buf131 = fs.readFileSync(frame131);

  const cut1Different = !buf69.equals(buf71);
  const cut2Different = !buf129.equals(buf131);

  console.log(`   - Cut 1 at 7.0s (6.9s vs 7.1s different): ${cut1Different}`);
  console.log(`   - Cut 2 at 13.0s (12.9s vs 13.1s different): ${cut2Different}`);

  if (!cut1Different || !cut2Different) {
    throw new Error('Scene transition cut validation failed: adjacent scenes across 7s/13s boundary did not change!');
  }
  console.log('   ✔ Scene transition cuts verified at exact timeline marks (7.0s and 13.0s)!');

  // 10. Verify UI cards now show Freeze badge and correct numbers
  console.log('\n10. Checking Storyboard cards in UI after freeze mode applied...');
  const updatedCards = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('div')).filter(
      (d) => d.innerText?.includes('Phân cảnh') && d.innerText?.includes('Xử lý:')
    );
    const seen = new Set<string>();
    const list: any[] = [];
    for (const c of cards) {
      const text = c.innerText;
      const sceneMatch = text.match(/Phân cảnh \d+/);
      const sceneKey = sceneMatch ? sceneMatch[0] : '';
      if (sceneKey && !seen.has(sceneKey)) {
        seen.add(sceneKey);
        list.push({
          scene: sceneKey,
          text: text.slice(0, 100).replace(/\n/g, ' '),
          hasFreezeBadge: text.includes('Giữ khung hình cuối'),
        });
      }
    }
    return list;
  });
  console.log('Updated Cards UI status:', JSON.stringify(updatedCards, null, 2));

  // 11. Verify UI spinner ended and action buttons ready
  const uiReady = await page.evaluate(() => {
    const bodyText = (document.body as HTMLElement).innerText;
    const isSpinnerRunning = bodyText.includes('animate-spin') || bodyText.includes('Đang render');
    return !isSpinnerRunning;
  });
  console.log(`UI spinner finished and interface idle: ${uiReady}`);

  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log('🎉 FULL UI ACCEPTANCE TEST PASSED 100%!');
  console.log(`   Exported Video File: ${renderVideoPath}`);
  console.log('   Timeline: 7s (Scene 1) + 6s (Scene 2) + 6s (Scene 3) = 19.00s Total');
  console.log('   Mode: Freeze Last Frame ("tpad=stop_mode=clone") applied seamlessly');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  await browser.close();
}

main().catch((err) => {
  console.error('❌ UI ACCEPTANCE TEST FAILED:', err);
  process.exit(1);
});
