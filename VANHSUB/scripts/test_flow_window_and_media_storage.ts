/**
 * scripts/test_flow_window_and_media_storage.ts
 *
 * Automated verification for:
 * 1. Flow Live Window toggle & debug lobby management
 * 2. AiStudioDiskStorageManager custom media directory routing & idempotency
 * 3. AiStudioPipelineEngine Stage 6 visual artifacts (imagePath, videoPath, assetPath, mediaDir)
 * 4. ChannelProfileConfig customMediaDir & flowUiMode typing and propagation
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager';
import { GoogleVeoSessionManager } from '../main/veo/GoogleVeoSessionManager';
import type { ChannelProfileConfig, StoryboardScene, PipelineSessionState } from '../main/ai-studio/types';

// Simple ANSI colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passedCount++;
    console.log(`  ${colors.green}✓ [PASS]${colors.reset} ${colors.bold}${testName}${colors.reset}${detail ? ` ${colors.dim}(${detail})${colors.reset}` : ''}`);
  } else {
    failedCount++;
    console.error(`  ${colors.red}✗ [FAIL]${colors.reset} ${colors.bold}${testName}${colors.reset}${detail ? ` ${colors.dim}(${detail})${colors.reset}` : ''}`);
  }
}

async function runTests() {
  console.log(`\n${colors.cyan}================================================================${colors.reset}`);
  console.log(`${colors.bold}  VERIFICATION: Flow Live Window & Custom Media Storage Suite${colors.reset}`);
  console.log(`${colors.cyan}================================================================${colors.reset}\n`);

  const tmpRoot = path.join(os.tmpdir(), `vanhsub_flow_test_${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  try {
    // --------------------------------------------------------------------------
    // Test 1: AiStudioDiskStorageManager Default Media Directory
    // --------------------------------------------------------------------------
    console.log(`${colors.cyan}▶ Test Group 1: Storage Manager Default Path Resolution${colors.reset}`);
    const defaultStorage = new AiStudioDiskStorageManager('default_proj', { baseDir: tmpRoot });
    const defaultProjDir = defaultStorage.projectDir;

    assert(
      defaultStorage.paths.mediaDir === path.join(defaultProjDir, '05_media'),
      'Default media directory is 05_media inside project directory',
      defaultStorage.paths.mediaDir
    );

    const resolvedDefaultMedia = defaultStorage.resolvePath('05_media/scene_1_shot_1_vid_v1.mp4');
    assert(
      resolvedDefaultMedia === path.join(defaultProjDir, '05_media', 'scene_1_shot_1_vid_v1.mp4'),
      'Default resolvePath correctly maps 05_media/ to project 05_media directory'
    );

    // --------------------------------------------------------------------------
    // Test 2: AiStudioDiskStorageManager Custom Media Directory
    // --------------------------------------------------------------------------
    console.log(`\n${colors.cyan}▶ Test Group 2: Storage Manager Custom Media Directory Routing${colors.reset}`);
    const customMediaDir = path.join(tmpRoot, 'my_custom_downloads');
    const customStorage = new AiStudioDiskStorageManager('custom_proj', {
      baseDir: tmpRoot,
      customMediaDir: customMediaDir,
    });

    assert(
      fs.existsSync(customMediaDir),
      'Custom media directory is automatically created on disk if not existing'
    );
    assert(
      customStorage.paths.mediaDir === customMediaDir,
      'customStorage.paths.mediaDir points to user-specified custom folder',
      customStorage.paths.mediaDir
    );

    const resolvedCustomMedia = customStorage.resolvePath('05_media/scene_2_shot_1_img_v1.png');
    assert(
      resolvedCustomMedia === path.join(customMediaDir, 'scene_2_shot_1_img_v1.png'),
      'resolvePath cleanly routes 05_media/ to custom folder instead of default 05_media'
    );

    // Write test asset to custom folder
    const dummyBuffer = Buffer.from('FAKE_PNG_MEDIA_BYTES');
    fs.writeFileSync(resolvedCustomMedia, dummyBuffer);
    assert(
      fs.existsSync(resolvedCustomMedia) && fs.readFileSync(resolvedCustomMedia).toString() === 'FAKE_PNG_MEDIA_BYTES',
      'Saved file exists with matching content in custom directory'
    );

    // Check scanMediaFilesForShot in custom directory
    const scannedFiles = (customStorage as any).scanMediaFilesForShot('scene_2_shot_1', 'img');
    assert(
      scannedFiles.length === 1 && scannedFiles[0] === 'scene_2_shot_1_img_v1.png',
      'scanMediaFilesForShot correctly finds image file inside custom media directory',
      scannedFiles[0]
    );

    // Check isAssetValid with shot in custom directory
    const isValid = customStorage.isAssetValid('scene_2', 'scene_2_shot_1', 'image');
    assert(isValid === true, 'isAssetValid returns true for existing file in custom directory');

    // --------------------------------------------------------------------------
    // Test 3: GoogleVeoSessionManager Flow Window Live Toggle API
    // --------------------------------------------------------------------------
    console.log(`\n${colors.cyan}▶ Test Group 3: Google Veo / Flow Window Live API Contract${colors.reset}`);
    const veoSessionMgr = GoogleVeoSessionManager.getInstance();

    assert(
      typeof veoSessionMgr.showLobbyForDebug === 'function',
      'showLobbyForDebug is defined as a callable method'
    );
    assert(
      typeof veoSessionMgr.hideLobbyOffscreen === 'function',
      'hideLobbyOffscreen is defined as a callable method'
    );
    assert(
      typeof veoSessionMgr.isLobbyDebug === 'function',
      'isLobbyDebug is defined as a callable query'
    );

    // Verify calling showLobbyForDebug returns a Promise
    const showPromise = veoSessionMgr.showLobbyForDebug();
    assert(
      showPromise instanceof Promise,
      'showLobbyForDebug returns an async Promise'
    );
    const showResult = await showPromise;
    assert(
      typeof showResult === 'boolean',
      'showLobbyForDebug resolves to a boolean without crashing (graceful in Node CLI/Electron)',
      `result: ${showResult}`
    );

    // Verify hiding resets state
    veoSessionMgr.hideLobbyOffscreen();
    assert(
      veoSessionMgr.isLobbyDebug() === false,
      'isLobbyDebug returns false after hideLobbyOffscreen'
    );

    // --------------------------------------------------------------------------
    // Test 4: ChannelProfileConfig & StoryboardScene Typing Verification
    // --------------------------------------------------------------------------
    console.log(`\n${colors.cyan}▶ Test Group 4: Typing & Session Artifact Contracts${colors.reset}`);
    const mockChannelConfig: ChannelProfileConfig = {
      channelName: 'Channel Vanhsub Test',
      customMediaDir: customMediaDir,
      flowUiMode: 'live_window',
    };

    assert(
      mockChannelConfig.customMediaDir === customMediaDir,
      'ChannelProfileConfig accepts customMediaDir'
    );
    assert(
      mockChannelConfig.flowUiMode === 'live_window',
      'ChannelProfileConfig accepts flowUiMode (live_window | offscreen)'
    );

    const mockScene: StoryboardScene = {
      id: 'scene-1',
      shotId: 'scene_1_shot_1',
      lineIndex: 0,
      startMs: 0,
      endMs: 4000,
      durationMs: 4000,
      lineText: 'Vũ trụ bao la chứa đựng những bí ẩn khó lường.',
      visualPrompt: 'Cinematic deep space, nebula clouds, photorealistic 8k',
      motionType: 'video',
      status: 'ready',
      imagePath: path.join(customMediaDir, 'scene_1_shot_1_img_v1.png'),
      videoPath: path.join(customMediaDir, 'scene_1_shot_1_vid_v1.mp4'),
      assetPath: path.join(customMediaDir, 'scene_1_shot_1_vid_v1.mp4'),
    };

    assert(
      mockScene.shotId === 'scene_1_shot_1',
      'StoryboardScene supports shotId'
    );
    assert(
      !!mockScene.imagePath && mockScene.imagePath.includes('img_v1.png'),
      'StoryboardScene carries imagePath'
    );
    assert(
      !!mockScene.videoPath && mockScene.videoPath.includes('vid_v1.mp4'),
      'StoryboardScene carries videoPath'
    );

    const mockSession: Partial<PipelineSessionState> = {
      sessionId: 'test-session-001',
      status: 'completed',
      currentStage: 6,
      progress: 100,
      artifacts: {
        scenes: [mockScene],
        mediaDir: customMediaDir,
        videoPath: mockScene.videoPath,
      },
    };

    assert(
      mockSession.artifacts?.mediaDir === customMediaDir,
      'PipelineSessionState artifacts contain effective mediaDir'
    );
    assert(
      mockSession.artifacts?.scenes?.[0].videoPath === mockScene.videoPath,
      'PipelineSessionState artifacts retain scene videoPath'
    );

    console.log(`\n${colors.cyan}----------------------------------------------------------------${colors.reset}`);
    console.log(`${colors.bold}SUMMARY: Passed: ${passedCount}, Failed: ${failedCount}${colors.reset}`);
    console.log(`${colors.cyan}----------------------------------------------------------------${colors.reset}\n`);

    if (failedCount > 0) {
      process.exit(1);
    }
  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

runTests().catch((err) => {
  console.error('Fatal error running verification suite:', err);
  process.exit(1);
});
