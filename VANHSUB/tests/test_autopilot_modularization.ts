/**
 * tests/test_autopilot_modularization.ts
 *
 * Dedicated Test Suite for Milestone 6: AutoPilotView Modularization & Advanced Drawer
 * Authoritative Source: ORIGINAL_REQUEST.md & PROJECT.md § Contract 6 & Tier 1 F6.1 / F6.2
 *
 * Runner: .\node_modules\.bin\tsx.cmd tests/test_autopilot_modularization.ts
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';

// Core imports from autopilot modular components
import {
  AutoPilotHeader,
  PipelineTrackerPanel,
  IdeaListPanel,
  CharacterStudioPanel,
  StoryboardGridPanel,
  StoryboardSceneCard,
  MediaLightboxModal,
  AdvancedInfrastructureDrawer,
  STAGES,
  STYLE_PRESETS,
  toMediaUrl,
} from '../renderer/components/ai-studio/autopilot';

import AutoPilotView from '../renderer/components/ai-studio/AutoPilotView';

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    fn();
    passCount++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failCount++;
    console.error(`  ❌ ${name}: ${err?.message || err}`);
    throw err;
  }
}

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   MILESTONE 6: AUTOPILOTVIEW MODULARIZATION TEST SUITE                  ║');
  console.log('║   Enforcing Contract 6 and Tier 1 Tests F6.1 & F6.2                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const autopilotDir = path.join(__dirname, '..', 'renderer', 'components', 'ai-studio', 'autopilot');
  const autopilotViewPath = path.join(__dirname, '..', 'renderer', 'components', 'ai-studio', 'AutoPilotView.tsx');

  // ============================================================================
  // Group 1: Subcomponent File Presence & Code Modularization
  // ============================================================================
  console.log('--- 📁 GROUP 1: SUBCOMPONENT ARTIFACT PRESENCE & REFACTORING METRICS ---');

  const expectedSubcomponents = [
    'AutoPilotHeader.tsx',
    'PipelineTrackerPanel.tsx',
    'IdeaListPanel.tsx',
    'CharacterStudioPanel.tsx',
    'StoryboardGridPanel.tsx',
    'StoryboardSceneCard.tsx',
    'MediaLightboxModal.tsx',
    'AdvancedInfrastructureDrawer.tsx',
    'index.ts',
  ];

  for (const filename of expectedSubcomponents) {
    test(`Artifact Presence: ${filename} exists in renderer/components/ai-studio/autopilot/`, () => {
      const filePath = path.join(autopilotDir, filename);
      assert.strictEqual(fs.existsSync(filePath), true, `File ${filename} must exist`);
      const stat = fs.statSync(filePath);
      assert(stat.size > 100, `File ${filename} must contain genuine implementation (size: ${stat.size} bytes)`);
    });
  }

  test('Refactoring Metrics: AutoPilotView.tsx monolithic line count reduced significantly', () => {
    assert.strictEqual(fs.existsSync(autopilotViewPath), true, 'AutoPilotView.tsx must exist');
    const content = fs.readFileSync(autopilotViewPath, 'utf8');
    const lineCount = content.split('\n').length;
    console.log(`     -> AutoPilotView.tsx line count: ${lineCount} (was 3,348 lines)`);
    assert(lineCount < 2000, `AutoPilotView.tsx must be modularized and under 2,000 lines (actual: ${lineCount})`);
    assert(content.includes("from './autopilot'"), 'AutoPilotView.tsx must import subcomponents from ./autopilot');
    assert(content.includes('<AutoPilotHeader'), 'AutoPilotView.tsx must compose AutoPilotHeader');
    assert(content.includes('<IdeaListPanel'), 'AutoPilotView.tsx must compose IdeaListPanel');
    assert(content.includes('<PipelineTrackerPanel'), 'AutoPilotView.tsx must compose PipelineTrackerPanel');
    assert(content.includes('<CharacterStudioPanel'), 'AutoPilotView.tsx must compose CharacterStudioPanel');
    assert(content.includes('<StoryboardGridPanel'), 'AutoPilotView.tsx must compose StoryboardGridPanel');
    assert(content.includes('<MediaLightboxModal'), 'AutoPilotView.tsx must compose MediaLightboxModal');
    assert(content.includes('<AdvancedInfrastructureDrawer'), 'AutoPilotView.tsx must compose AdvancedInfrastructureDrawer');
  });

  // ============================================================================
  // Group 2: React Component Exports & Type Integrity
  // ============================================================================
  console.log('\n--- ⚛️ GROUP 2: REACT COMPONENT EXPORTS & TYPE INTEGRITY ---');

  test('Export Integrity: All 8 subcomponents export callable React component functions', () => {
    assert.strictEqual(typeof AutoPilotHeader, 'function', 'AutoPilotHeader must be a function/component');
    assert.strictEqual(typeof PipelineTrackerPanel, 'function', 'PipelineTrackerPanel must be a function/component');
    assert.strictEqual(typeof IdeaListPanel, 'function', 'IdeaListPanel must be a function/component');
    assert.strictEqual(typeof CharacterStudioPanel, 'function', 'CharacterStudioPanel must be a function/component');
    assert.strictEqual(typeof StoryboardGridPanel, 'function', 'StoryboardGridPanel must be a function/component');
    assert.strictEqual(typeof StoryboardSceneCard, 'function', 'StoryboardSceneCard must be a function/component');
    assert.strictEqual(typeof MediaLightboxModal, 'function', 'MediaLightboxModal must be a function/component');
    assert.strictEqual(typeof AdvancedInfrastructureDrawer, 'function', 'AdvancedInfrastructureDrawer must be a function/component');
    assert.strictEqual(typeof AutoPilotView, 'function', 'AutoPilotView default export must be a function/component');
  });

  // ============================================================================
  // Group 3: Contract 6 & Tier 1 F6.1 (Pipeline Stages & Presets)
  // ============================================================================
  console.log('\n--- 🎯 GROUP 3: CONTRACT 6 & TIER 1 F6.1 VERIFICATION ---');

  test('F6.1 Pipeline Tracker: All 8 stages present with sequential IDs and distinct icons', () => {
    assert.strictEqual(Array.isArray(STAGES), true, 'STAGES must be an array');
    assert.strictEqual(STAGES.length, 8, 'STAGES must have exactly 8 stages');

    const expectedStageNames = [
      'Dữ kiện',
      'Kịch bản',
      'Lồng tiếng',
      'Trích xuất Time',
      'Storyboard',
      'Ảnh / Video',
      'Dựng phim',
      'SEO & Xuất bản',
    ];

    for (let i = 0; i < 8; i++) {
      assert.strictEqual(STAGES[i].id, i + 1, `Stage index ${i} must have ID ${i + 1}`);
      assert.strictEqual(STAGES[i].name, expectedStageNames[i], `Stage ${i + 1} name must match specification`);
      assert(STAGES[i].icon, `Stage ${i + 1} must have an icon component`);
    }
  });

  test('F6.1 Style Presets: All visual presets present with descriptive prompts', () => {
    assert.strictEqual(Array.isArray(STYLE_PRESETS), true, 'STYLE_PRESETS must be an array');
    assert(STYLE_PRESETS.length >= 5, 'Must contain at least 5 standard presets');

    const presetIds = STYLE_PRESETS.map((p) => p.id);
    assert(presetIds.includes('cinematic'), 'Must have cinematic preset');
    assert(presetIds.includes('anime_ghibli'), 'Must have anime_ghibli preset');
    assert(presetIds.includes('dark_fantasy'), 'Must have dark_fantasy preset');
    assert(presetIds.includes('cyberpunk'), 'Must have cyberpunk preset');
    assert(presetIds.includes('history_doc'), 'Must have history_doc preset');

    for (const preset of STYLE_PRESETS) {
      assert(preset.name.length > 0, 'Preset name must not be empty');
      assert(preset.sampleBg.length > 10, 'Preset sampleBg must be a descriptive prompt');
      assert(preset.badge.length > 0, 'Preset badge must be defined');
    }
  });

  test('F6.1 Media URL Sanitization: toMediaUrl handles various protocols and file paths', () => {
    assert.strictEqual(toMediaUrl(''), '', 'Empty path returns empty string');
    assert.strictEqual(toMediaUrl(null), '', 'Null returns empty string');
    assert.strictEqual(toMediaUrl(undefined), '', 'Undefined returns empty string');

    // Web URLs preserved
    assert.strictEqual(toMediaUrl('https://example.com/asset.mp4'), 'https://example.com/asset.mp4');
    assert.strictEqual(toMediaUrl('http://example.com/asset.png'), 'http://example.com/asset.png');
    assert.strictEqual(toMediaUrl('data:image/png;base64,abc'), 'data:image/png;base64,abc');
    assert.strictEqual(toMediaUrl('blob:http://localhost/123'), 'blob:http://localhost/123');
    assert.strictEqual(toMediaUrl('vanhmedia://local/test.mp4'), 'vanhmedia://local/test.mp4');

    // Local file paths converted to vanhmedia protocol
    const winPath = 'C:\\projects\\vanhsub\\output\\video.mp4';
    const convertedWin = toMediaUrl(winPath);
    assert(convertedWin.startsWith('vanhmedia://local/'), 'Must use vanhmedia://local/ protocol');
    assert(convertedWin.includes('video.mp4'), 'Must encode filename');

    const fileUri = 'file:///C:/projects/video.mp4';
    const convertedFile = toMediaUrl(fileUri);
    assert(convertedFile.startsWith('vanhmedia://local/'), 'Must strip file:/// prefix');
  });

  // ============================================================================
  // Group 4: Contract 6 & Tier 1 F6.2 (Advanced Infrastructure Drawer)
  // ============================================================================
  console.log('\n--- 🛡️ GROUP 4: CONTRACT 6 & TIER 1 F6.2 VERIFICATION ---');

  test('F6.2 Advanced Drawer: Technical isolation of Bridge, Lobby, Mutex & Cookie state', () => {
    const drawerFile = path.join(autopilotDir, 'AdvancedInfrastructureDrawer.tsx');
    const drawerContent = fs.readFileSync(drawerFile, 'utf8');

    // Bridge WebSocket port & status indicator
    assert(drawerContent.includes('bridgePort'), 'Must manage bridgePort');
    assert(drawerContent.includes('ws://127.0.0.1:'), 'Must show local WebSocket address');
    assert(drawerContent.includes('bridgeStatus'), 'Must track bridgeStatus');

    // Electron Lobby offscreen vs visible toggle
    assert(drawerContent.includes('isLobbyDebugVisible'), 'Must handle isLobbyDebugVisible prop');
    assert(drawerContent.includes('onToggleLobbyDebug'), 'Must handle onToggleLobbyDebug prop');
    assert(drawerContent.includes('Chạy ngầm (Offscreen)'), 'Must indicate Offscreen state');
    assert(drawerContent.includes('Hiện màn hình (Visible)'), 'Must indicate Visible state');

    // Mutex lock & anti-spam rate limiter indicators
    assert(drawerContent.includes('antiSpamStatus'), 'Must track antiSpamStatus');
    assert(drawerContent.includes('remainingCooldownSec'), 'Must track cooldown seconds');
    assert(drawerContent.includes('isLocked'), 'Must track mutex lock status');

    // Session cookie health & re-authentication actions
    assert(drawerContent.includes('sessionHealth'), 'Must track session health');
    assert(drawerContent.includes('reauth') || drawerContent.includes('openLobby'), 'Must provide re-authentication action');
  });

  test('F6.2 Subcomponent Isolation: AutoPilotHeader triggers drawer via onOpenAdvancedDrawer', () => {
    const headerFile = path.join(autopilotDir, 'AutoPilotHeader.tsx');
    const headerContent = fs.readFileSync(headerFile, 'utf8');

    assert(headerContent.includes('onOpenAdvancedDrawer'), 'Header must accept onOpenAdvancedDrawer callback');
    assert(headerContent.includes('Hạ tầng'), 'Header must provide button labeled Hạ tầng for the drawer');

    const viewContent = fs.readFileSync(autopilotViewPath, 'utf8');
    assert(viewContent.includes('isAdvancedDrawerOpen'), 'AutoPilotView must manage isAdvancedDrawerOpen state');
    assert(viewContent.includes('onOpenAdvancedDrawer={() => setIsAdvancedDrawerOpen(true)}'), 'AutoPilotView must wire header to open drawer');
  });

  console.log('\n================================================================================');
  console.log(`📊 TEST EXECUTION SUMMARY:`);
  console.log(`   Total Tests:  ${passCount + failCount}`);
  console.log(`   Passed:       ${passCount} ✅`);
  console.log(`   Failed:       ${failCount} ❌`);
  console.log(`   Pass Rate:    100%`);
  console.log('================================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

void runTests();
