/**
 * tests/test_auditor_m6_forensic_integrity.ts
 *
 * Independent Forensic Integrity Test Suite for Milestone 6 (M6)
 * Authored by: auditor_m6 (Forensic Auditor)
 * Enforcing Contract 6, ORIGINAL_REQUEST.md, and PROJECT.md § Milestone 6
 *
 * Runner: .\node_modules\.bin\tsx.cmd tests/test_auditor_m6_forensic_integrity.ts
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

function auditCheck(name: string, fn: () => void | Promise<void>) {
  totalChecks++;
  try {
    fn();
    passedChecks++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err: any) {
    failedChecks++;
    console.error(`  ❌ [FAIL] ${name}: ${err?.message || err}`);
    throw err;
  }
}

async function runAuditorSuite() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   INDEPENDENT FORENSIC INTEGRITY AUDIT: MILESTONE 6 (M6)                 ║');
  console.log('║   Auditor: auditor_m6 | Integrity Mode: development                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  const autopilotDir = path.join(__dirname, '..', 'renderer', 'components', 'ai-studio', 'autopilot');
  const autopilotViewPath = path.join(__dirname, '..', 'renderer', 'components', 'ai-studio', 'AutoPilotView.tsx');

  // =========================================================================
  // Section 1: Non-Trivial Component Structure & Anti-Stub Analysis
  // =========================================================================
  console.log('--- Section 1: Non-Trivial Component Structure & Anti-Stub Analysis ---');

  const subcomponents = [
    { file: 'AutoPilotHeader.tsx', minLines: 200, requiredTokens: ['Sparkles', 'savedProjects', 'onOpenAdvancedDrawer', 'isGatedMode'] },
    { file: 'PipelineTrackerPanel.tsx', minLines: 300, requiredTokens: ['STAGES', 'toMediaUrl', 'ActionableErrorBanner', 'onApproveStage', 'resume_missing'] },
    { file: 'IdeaListPanel.tsx', minLines: 150, requiredTokens: ['IdeaBlueprint', 'selectedFormat', 'onRequestStartProduction', 'setupComplete'] },
    { file: 'CharacterStudioPanel.tsx', minLines: 250, requiredTokens: ['STYLE_PRESETS', 'channelCharacters', 'hostAvatarUrl', 'onAiGenerateHost'] },
    { file: 'StoryboardGridPanel.tsx', minLines: 250, requiredTokens: ['StoryboardSceneCard', 'selectedShotIds', 'mediaDir', 'onRegenerateStoryboardOneToOne'] },
    { file: 'StoryboardSceneCard.tsx', minLines: 250, requiredTokens: ['cameraAngle', 'cameraMotion', 'kenBurnsProfile', 'toMediaUrl', 'onRegenerate'] },
    { file: 'MediaLightboxModal.tsx', minLines: 100, requiredTokens: ['toMediaUrl', 'Escape', 'narration', 'prompt'] },
    { file: 'AdvancedInfrastructureDrawer.tsx', minLines: 250, requiredTokens: ['bridgePort', 'bridgeStatus', 'antiSpamStatus', 'sessionHealth', 'openLobby'] },
    { file: 'index.ts', minLines: 20, requiredTokens: ['AutoPilotHeader', 'PipelineTrackerPanel', 'AdvancedInfrastructureDrawer', 'STYLE_PRESETS', 'toMediaUrl'] },
  ];

  for (const comp of subcomponents) {
    auditCheck(`Integrity: ${comp.file} exists, is non-trivial (> ${comp.minLines} lines), and contains authentic logic`, () => {
      const fullPath = path.join(autopilotDir, comp.file);
      assert.strictEqual(fs.existsSync(fullPath), true, `${comp.file} must exist`);
      const rawContent = fs.readFileSync(fullPath, 'utf8');
      const lines = rawContent.split('\n').length;
      assert(lines >= comp.minLines, `${comp.file} has ${lines} lines, expected at least ${comp.minLines}`);
      for (const token of comp.requiredTokens) {
        assert(rawContent.includes(token), `${comp.file} must contain real domain logic token: '${token}'`);
      }
    });
  }

  // =========================================================================
  // Section 2: Anti-Facade Composition in AutoPilotView.tsx
  // =========================================================================
  console.log('\n--- Section 2: Anti-Facade Composition in AutoPilotView.tsx ---');

  auditCheck('Composition: AutoPilotView.tsx imports and renders all modular components without facades', () => {
    assert.strictEqual(fs.existsSync(autopilotViewPath), true, 'AutoPilotView.tsx must exist');
    const content = fs.readFileSync(autopilotViewPath, 'utf8');
    const lines = content.split('\n').length;

    // Verify significant reduction from original 3,348 lines
    assert(lines < 2000, `AutoPilotView.tsx must be refactored down (current lines: ${lines})`);

    // Verify imports
    assert(content.includes("from './autopilot'"), 'Must import from ./autopilot');

    // Verify actual JSX compositions with genuine props
    assert(content.includes('<AutoPilotHeader'), 'Must render <AutoPilotHeader');
    assert(content.includes('projectName={projectName}'), 'AutoPilotHeader receives projectName');
    assert(content.includes('onOpenAdvancedDrawer={() => setIsAdvancedDrawerOpen(true)}'), 'AutoPilotHeader triggers drawer');

    assert(content.includes('<IdeaListPanel'), 'Must render <IdeaListPanel');
    assert(content.includes('ideas={ideas}'), 'IdeaListPanel receives ideas array');

    assert(content.includes('<CharacterStudioPanel'), 'Must render <CharacterStudioPanel');
    assert(content.includes('channelCharacters={config.channelProfile?.channelCharacters || []}'), 'CharacterStudioPanel wired to store');

    assert(content.includes('<StoryboardGridPanel'), 'Must render <StoryboardGridPanel');
    assert(content.includes('selectedShotIds={selectedShotIds}'), 'StoryboardGridPanel receives selection state');

    assert(content.includes('<PipelineTrackerPanel'), 'Must render <PipelineTrackerPanel');
    assert(content.includes('onApproveStage={handleApproveStage}'), 'PipelineTrackerPanel wired to approval handler');

    assert(content.includes('<MediaLightboxModal'), 'Must render <MediaLightboxModal');
    assert(content.includes('media={previewMedia}'), 'MediaLightboxModal receives previewMedia');

    assert(content.includes('<AdvancedInfrastructureDrawer'), 'Must render <AdvancedInfrastructureDrawer');
    assert(content.includes('isOpen={isAdvancedDrawerOpen}'), 'AdvancedInfrastructureDrawer wired to open state');
  });

  // =========================================================================
  // Section 3: Technical Isolation Verification (Advanced Drawer)
  // =========================================================================
  console.log('\n--- Section 3: Technical Isolation Verification (Advanced Drawer) ---');

  auditCheck('Technical Isolation: Infrastructure controls are properly encapsulated in Advanced Drawer', () => {
    const drawerPath = path.join(autopilotDir, 'AdvancedInfrastructureDrawer.tsx');
    const content = fs.readFileSync(drawerPath, 'utf8');

    // Bridge details
    assert(content.includes('bridgeStatus'), 'Drawer monitors Bridge status');
    assert(content.includes('19890'), 'Drawer defaults to port 19890');

    // Anti-spam & Mutex
    assert(content.includes('antiSpamStatus'), 'Drawer monitors Anti-Spam status');
    assert(content.includes('remainingCooldownSec'), 'Drawer displays cooldown time');
    assert(content.includes('isLocked'), 'Drawer displays Mutex lock indicator');

    // Session health & Lobby
    assert(content.includes('sessionHealth'), 'Drawer monitors Session health');
    assert(content.includes('openLobby') || content.includes('handleReauthViaLobby'), 'Drawer provides re-authentication mechanism');
  });

  // =========================================================================
  // Section 4: Live Component Loading & Function Integrity
  // =========================================================================
  console.log('\n--- Section 4: Live Component Loading & Function Integrity ---');

  auditCheck('Component Callable Types: All subcomponents load and export valid React functional components', async () => {
    const autopilotModule = await import('../renderer/components/ai-studio/autopilot');

    assert.strictEqual(typeof autopilotModule.AutoPilotHeader, 'function', 'AutoPilotHeader is function');
    assert.strictEqual(typeof autopilotModule.PipelineTrackerPanel, 'function', 'PipelineTrackerPanel is function');
    assert.strictEqual(typeof autopilotModule.IdeaListPanel, 'function', 'IdeaListPanel is function');
    assert.strictEqual(typeof autopilotModule.CharacterStudioPanel, 'function', 'CharacterStudioPanel is function');
    assert.strictEqual(typeof autopilotModule.StoryboardGridPanel, 'function', 'StoryboardGridPanel is function');
    assert.strictEqual(typeof autopilotModule.StoryboardSceneCard, 'function', 'StoryboardSceneCard is function');
    assert.strictEqual(typeof autopilotModule.MediaLightboxModal, 'function', 'MediaLightboxModal is function');
    assert.strictEqual(typeof autopilotModule.AdvancedInfrastructureDrawer, 'function', 'AdvancedInfrastructureDrawer is function');

    assert.strictEqual(Array.isArray(autopilotModule.STAGES), true, 'STAGES is an array');
    assert.strictEqual(autopilotModule.STAGES.length, 8, 'STAGES has 8 items');

    assert.strictEqual(Array.isArray(autopilotModule.STYLE_PRESETS), true, 'STYLE_PRESETS is an array');
    assert(autopilotModule.STYLE_PRESETS.length >= 5, 'STYLE_PRESETS has >= 5 presets');

    assert.strictEqual(typeof autopilotModule.toMediaUrl, 'function', 'toMediaUrl is function');
    assert.strictEqual(autopilotModule.toMediaUrl(''), '');
    assert(autopilotModule.toMediaUrl('test.mp4').startsWith('vanhmedia://local/'));
  });

  console.log('\n================================================================================');
  console.log(`📊 FORENSIC AUDIT SUMMARY:`);
  console.log(`   Total Checks:  ${totalChecks}`);
  console.log(`   Passed:        ${passedChecks} ✅`);
  console.log(`   Failed:        ${failedChecks} ❌`);
  console.log(`   Verdict:       ${failedChecks === 0 ? 'CLEAN (NO INTEGRITY VIOLATIONS)' : 'INTEGRITY VIOLATION'}`);
  console.log('================================================================================\n');

  if (failedChecks > 0) {
    process.exit(1);
  }
}

void runAuditorSuite();
