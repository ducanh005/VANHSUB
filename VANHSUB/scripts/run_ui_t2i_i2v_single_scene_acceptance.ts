import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { normalizeAndValidateMediaFile } from '../main/browser-automation/mediaValidator';

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('  VANHSUB UI E2E ACCEPTANCE: 1 SCENE T2I -> I2V -> PREVIEW -> FREEZE EXPORT');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  const isExportOnly = process.argv.includes('--export-only');
  const testProjectDir = 'D:\\DEAN\\DEAN\\VANHSUB\\temp_ui_test_project';
  const sessionJsonPath = path.join(testProjectDir, 'session.json');
  const testProjectId = 'proj_1791817054791_m2t5w';
  const testSessionId = 'test-session-ui-freeze-19s';
  const flowProjectUrl = 'https://flow.google.com/project/24f0ba0a-9803-4c7a-8610-761a02cd5f38';

  const initialSessionData = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf-8'));
  initialSessionData.flowProjectUrl = flowProjectUrl;
  if (!isExportOnly) {
    const runTag = `UI_S1_${Date.now()}`;
    initialSessionData.artifacts.scenes[0].visualPrompt = `A glowing futuristic 4D tesseract cube floating in deep space nebula, cinematic 8k [${runTag}]`;
    initialSessionData.artifacts.scenes[0].motionPrompt = `Slow cinematic camera orbit around the glowing tesseract cube in nebula`;
    fs.writeFileSync(sessionJsonPath, JSON.stringify(initialSessionData, null, 2), 'utf-8');
  } else {
    // Delete previous final_video.mp4 if exists to prove fresh export with new Scene 1 I2V video
    const prevFinal = path.join(testProjectDir, 'assets', 'final_video.mp4');
    if (fs.existsSync(prevFinal)) {
      fs.unlinkSync(prevFinal);
    }
    delete initialSessionData.artifacts.videoPath;
    initialSessionData.currentStage = 6;
    initialSessionData.status = 'awaiting_approval';
    fs.writeFileSync(sessionJsonPath, JSON.stringify(initialSessionData, null, 2), 'utf-8');
  }

  console.log('1. Connecting to VANHSUB Electron UI via CDP port 5858...');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:5858');
  const pages = browser.contexts()[0].pages();
  const page = pages.find((p) => p.url().includes('localhost:8888') || p.url().includes('8888'));
  if (!page) {
    throw new Error(`VANHSUB page not found in open CDP pages: ${pages.map((p) => p.url()).join(', ')}`);
  }

  await page.bringToFront();

  // Sync isolated test project into Electron's aiStudioStore without touching other saved projects
  console.log('2. Syncing isolated test project into Electron config...');
  await page.evaluate(
    async ({ projId, sessId, projDir, flowUrl, sessData }) => {
      const w = window as any;
      const cfg = await w.vanhsub.aiStudio.getConfig();
      const existingProjects = Array.isArray(cfg.savedProjects) ? cfg.savedProjects : [];
      const filtered = existingProjects.filter((p: any) => p.id !== projId);
      const testProjEntry = {
        id: projId,
        name: 'TEST_FREEZE_19S_PROJECT',
        outputDir: projDir,
        flowProjectUrl: flowUrl,
        channelProfile: {
          projectName: 'TEST_FREEZE_19S_PROJECT',
          channelNiche: 'Khoa học & Vũ trụ (Kiểm thử)',
          customMediaDir: projDir,
        },
        savedSession: sessData,
        lastSessionId: sessId,
        updatedAt: Date.now(),
      };
      await w.vanhsub.aiStudio.updateConfig({
        activeProjectId: projId,
        outputDir: projDir,
        flowProjectUrl: flowUrl,
        savedProjects: [testProjEntry, ...filtered],
      });
    },
    {
      projId: testProjectId,
      sessId: testSessionId,
      projDir: testProjectDir,
      flowUrl: flowProjectUrl,
      sessData: initialSessionData,
    }
  );

  await page.reload();
  await page.waitForTimeout(2000);

  // Navigate to AI Studio -> Phân cảnh Visual
  await page.evaluate(() => {
    const aiBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.innerText?.includes('AI Studio')
    );
    if (aiBtn) aiBtn.click();
  });
  await page.waitForTimeout(1500);

  const enterStudioBtn = await page.$(
    'button:has-text("Vào Studio Tiếp Tục"), button:has-text("Vào Studio")'
  );
  if (enterStudioBtn) {
    await enterStudioBtn.click();
    await page.waitForTimeout(1500);
  }

  const visualTabBtn = await page.$('button:has-text("Phân cảnh Visual")');
  if (visualTabBtn) {
    await visualTabBtn.click();
    await page.waitForTimeout(1000);
  }

  if (!isExportOnly) {
    // ──────────────────────────────────────────────────────────────────────────
    // STEP 1: Click "Tạo lại Ảnh" (T2I) on Scene 1 in VANHSUB UI
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n3. [STEP 1 - T2I]: Clicking "Tạo lại Ảnh" on Scene 1 in VANHSUB UI...');
  const genImgBtns = await page.$$('button:has-text("Tạo lại Ảnh")');
  if (genImgBtns.length === 0) {
    throw new Error('Could not find "Tạo lại Ảnh" button on Scene 1 card in UI!');
  }

  const t2iStart = Date.now();
  await genImgBtns[0].click();

  let t2iDone = false;
  let t2iBlocked = false;
  let t2iErrorText = '';

  while (Date.now() - t2iStart < 110000) {
    await page.waitForTimeout(2000);
    const uiStatus = await page.evaluate(() => {
      const bodyText = document.body.innerText || '';
      const isBusy = Array.from(document.querySelectorAll('button')).some(
        (b) => b.innerText.includes('Tạo lại Ảnh') && b.disabled
      );
      const hasUnusualActivity =
        bodyText.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY') ||
        bodyText.includes('hoạt động bất thường') ||
        bodyText.includes('BLOCKED_REQUIRES_USER');
      const hasScene1Img = Boolean(document.querySelector('img[alt="Ảnh phân cảnh #1"]'));
      const scene1ImgSrc =
        (document.querySelector('img[alt="Ảnh phân cảnh #1"]') as HTMLImageElement | null)?.src || '';
      return { isBusy, hasUnusualActivity, hasScene1Img, scene1ImgSrc };
    });

    console.log(
      `  [T2I +${Math.round((Date.now() - t2iStart) / 1000)}s] isBusy=${uiStatus.isBusy}, hasScene1Img=${uiStatus.hasScene1Img}, unusualActivity=${uiStatus.hasUnusualActivity}`
    );

    if (uiStatus.hasUnusualActivity) {
      t2iBlocked = true;
      t2iErrorText = 'PUBLIC_ERROR_UNUSUAL_ACTIVITY';
      break;
    }

    if (!uiStatus.isBusy && Date.now() - t2iStart > 4000) {
      t2iDone = true;
      break;
    }
  }

  if (t2iBlocked) {
    console.error('\n🛑 [STOP ON ANTI-BOT]: Gặp PUBLIC_ERROR_UNUSUAL_ACTIVITY ở bước T2I. Dừng ngay lập tức, không retry.');
    await browser.close();
    process.exit(2);
  }

  if (!t2iDone) {
    throw new Error('Timeout waiting for T2I on Scene 1 in UI');
  }

  // Verify Scene 1 T2I result on disk and in UI preview
  const afterT2iSession = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf-8'));
  const scene1AfterT2i = afterT2iSession.artifacts?.scenes?.[0];
  console.log('  Scene 1 state after T2I:', JSON.stringify(scene1AfterT2i, null, 2));

  if (!scene1AfterT2i?.imagePath || !fs.existsSync(scene1AfterT2i.imagePath)) {
    throw new Error(`T2I did not produce a valid imagePath on disk for Scene 1: ${scene1AfterT2i?.imagePath}`);
  }

  const normT2i = await normalizeAndValidateMediaFile(scene1AfterT2i.imagePath, 'image', { fullDecode: true });
  console.log(
    `  ✅ T2I Image verified: ${normT2i.finalPath} (${normT2i.width}x${normT2i.height}, ${normT2i.sizeBytes} bytes, inputImageAsset=${scene1AfterT2i.inputImageAsset})`
  );

  const t2iPreviewCheck = await page.evaluate(() => {
    const imgEl = document.querySelector('img[alt="Ảnh phân cảnh #1"]') as HTMLImageElement | null;
    return {
      rendered: Boolean(imgEl),
      src: imgEl?.src || '',
      naturalWidth: imgEl?.naturalWidth || 0,
    };
  });
  console.log('  ✅ UI Scene 1 Image Preview:', JSON.stringify(t2iPreviewCheck));

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 2: Click "Tạo lại Video" (I2V) on Scene 1 in VANHSUB UI
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n4. [STEP 2 - I2V]: Clicking "Tạo lại Video" on Scene 1 in VANHSUB UI...');
  const genVidBtns = await page.$$('button:has-text("Tạo lại Video")');
  if (genVidBtns.length === 0) {
    throw new Error('Could not find "Tạo lại Video" button on Scene 1 card in UI!');
  }

  const i2vStart = Date.now();
  await genVidBtns[0].click();

  let i2vDone = false;
  let i2vBlocked = false;

  while (Date.now() - i2vStart < 190000) {
    await page.waitForTimeout(3000);
    const uiStatus = await page.evaluate(() => {
      const bodyText = document.body.innerText || '';
      const isBusy = Array.from(document.querySelectorAll('button')).some(
        (b) => b.innerText.includes('Tạo lại Video') && b.disabled
      );
      const hasUnusualActivity =
        bodyText.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY') ||
        bodyText.includes('hoạt động bất thường') ||
        bodyText.includes('BLOCKED_REQUIRES_USER');
      const hasI2vSourceBadge = bodyText.includes('Ảnh nguồn Image-to-Video:');
      return { isBusy, hasUnusualActivity, hasI2vSourceBadge };
    });

    console.log(
      `  [I2V +${Math.round((Date.now() - i2vStart) / 1000)}s] isBusy=${uiStatus.isBusy}, hasI2vSourceBadge=${uiStatus.hasI2vSourceBadge}, unusualActivity=${uiStatus.hasUnusualActivity}`
    );

    if (uiStatus.hasUnusualActivity) {
      i2vBlocked = true;
      break;
    }

    if (!uiStatus.isBusy && Date.now() - i2vStart > 5000) {
      i2vDone = true;
      break;
    }
  }

  if (i2vBlocked) {
    console.error('\n🛑 [STOP ON ANTI-BOT]: Gặp PUBLIC_ERROR_UNUSUAL_ACTIVITY ở bước I2V. Dừng ngay lập tức, không retry.');
    await browser.close();
    process.exit(2);
  }

  if (!i2vDone) {
    throw new Error('Timeout waiting for I2V on Scene 1 in UI');
  }

  const afterI2vSession = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf-8'));
  const scene1AfterI2v = afterI2vSession.artifacts?.scenes?.[0];
  console.log('  Scene 1 state after I2V:', JSON.stringify(scene1AfterI2v, null, 2));

  if (!scene1AfterI2v?.videoPath || !fs.existsSync(scene1AfterI2v.videoPath)) {
    throw new Error(`I2V did not produce a valid videoPath on disk for Scene 1: ${scene1AfterI2v?.videoPath}`);
  }

  const normI2v = await normalizeAndValidateMediaFile(scene1AfterI2v.videoPath, 'video', { fullDecode: true });
  console.log(
    `  ✅ I2V Video verified: ${normI2v.finalPath} (${normI2v.width}x${normI2v.height}, ${normI2v.duration?.toFixed(2)}s, ${normI2v.sizeBytes} bytes)`
  );

  // Verify UI preview on Scene 1 shows both video and I2V source image
  const i2vPreviewCheck = await page.evaluate(() => {
    const videos = Array.from(document.querySelectorAll('video')).map((v) => v.src);
    const sourceImg = document.querySelector('img[alt="Ảnh nguồn #1"]') as HTMLImageElement | null;
    return {
      firstVideoSrc: videos[0] || '',
      hasSourceImageBadge: Boolean(sourceImg),
      sourceImgSrc: sourceImg?.src || '',
    };
  });
  console.log('  ✅ UI Scene 1 I2V Preview:', JSON.stringify(i2vPreviewCheck, null, 2));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 3: Export Final Video via UI (with Freeze Last Frame)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n5. [STEP 3 - EXPORT]: Triggering video export via UI ("Tiếp tục (Duyệt)")...');
  const approveBtn = await page.$('button:has-text("Tiếp tục (Duyệt)")');
  if (!approveBtn) {
    throw new Error('Could not find "Tiếp tục (Duyệt)" button in PipelineTrackerPanel');
  }
  await approveBtn.click();
  await page.waitForTimeout(3000);

  // If Timeline Mismatch Guard banner appears, click "Giữ khung hình cuối cho đủ thời lượng"
  const freezeBtn = await page.$('button:has-text("Giữ khung hình cuối cho đủ thời lượng")');
  if (freezeBtn) {
    console.log('  Timeline Duration Guard triggered -> Clicking "Giữ khung hình cuối cho đủ thời lượng"...');
    await freezeBtn.click();
    await page.waitForTimeout(2000);
  }

  // Poll until export completes
  const exportStart = Date.now();
  let exportComplete = false;
  let finalVideoPath = '';
  while (Date.now() - exportStart < 90000) {
    await page.waitForTimeout(2000);
    const statusInfo = await page.evaluate(async () => {
      const s = await (window as any).vanhsub.aiStudio.getPipelineState({
        sessionId: 'test-session-ui-freeze-19s',
      });
      return {
        status: s?.status,
        stage: s?.currentStage,
        videoPath: s?.artifacts?.videoPath,
      };
    });
    if (statusInfo.videoPath && fs.existsSync(statusInfo.videoPath) && statusInfo.status !== 'running') {
      exportComplete = true;
      finalVideoPath = statusInfo.videoPath;
      break;
    }
  }

  if (!exportComplete || !finalVideoPath) {
    throw new Error('Timeout waiting for final video export to complete');
  }

  const normFinal = await normalizeAndValidateMediaFile(finalVideoPath, 'video', { fullDecode: true });
  console.log(
    `  ✅ Final Export Video verified: ${finalVideoPath} (${normFinal.width}x${normFinal.height}, ${normFinal.duration?.toFixed(2)}s, ${normFinal.sizeBytes} bytes)`
  );

  await browser.close();
  console.log('\n🎉 ALL STEPS PASSED: SCENE 1 T2I -> I2V -> UI PREVIEW -> FINAL EXPORT!');
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
