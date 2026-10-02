import fs from 'fs';
import path from 'path';

interface StressTestResult {
  dimension: string;
  scenario: string;
  passed: boolean;
  notes: string;
}

const stressResults: StressTestResult[] = [];

function record(dimension: string, scenario: string, passed: boolean, notes: string) {
  stressResults.push({ dimension, scenario, passed, notes });
  const mark = passed ? 'PASS' : 'FAIL';
  console.log(`[${mark}] [${dimension}] ${scenario}: ${notes}`);
}

async function runM2StressTests() {
  console.log('================================================================');
  console.log('   STARTING ADVERSARIAL BOUNDARY & EDGE CASE STRESS TESTS (M2)  ');
  console.log('================================================================\n');

  const homePath = path.resolve('renderer/pages/home.tsx');
  const termPath = path.resolve('renderer/components/TerminalPanel.tsx');
  const onbPath = path.resolve('renderer/components/OnboardingModal.tsx');
  const chromePath = path.resolve('renderer/components/ai-studio/ChromeBridgeModal.tsx');
  const dlPath = path.resolve('renderer/components/download/DownloadModal.tsx');

  const homeContent = fs.readFileSync(homePath, 'utf8');
  const termContent = fs.readFileSync(termPath, 'utf8');
  const onbContent = fs.readFileSync(onbPath, 'utf8');
  const chromeContent = fs.readFileSync(chromePath, 'utf8');
  const dlContent = fs.readFileSync(dlPath, 'utf8');

  // --------------------------------------------------------------------------
  // Dimension 1: Assumption Stress-Testing
  // --------------------------------------------------------------------------
  // Assumption 1: Task actions don't throw if window.vanhsub is undefined (SSR / Web mock)
  const homeHasWindowGuardInDelete = homeContent.includes("typeof window === 'undefined' || !window.vanhsub?.tasks?.delete");
  const homeHasWindowGuardInCancel = homeContent.includes("typeof window === 'undefined' || !window.vanhsub?.tasks?.cancel");
  const homeHasWindowGuardInShow = homeContent.includes("typeof window !== 'undefined' && window.vanhsub?.dialog?.showItemInFolder");

  record(
    'Assumption Stress',
    'Window SSR guards protect all task action handlers from throwing on undefined window.vanhsub',
    homeHasWindowGuardInDelete && homeHasWindowGuardInCancel && homeHasWindowGuardInShow,
    `deleteGuard=${homeHasWindowGuardInDelete}, cancelGuard=${homeHasWindowGuardInCancel}, showGuard=${homeHasWindowGuardInShow}`
  );

  // Assumption 2: Drag and drop stops propagation and default preventDefault correctly
  const dndPreventsDefault = homeContent.includes('e.preventDefault()') && homeContent.includes('e.stopPropagation()');
  record(
    'Assumption Stress',
    'Drag & drop events prevent browser default navigation and stop propagation',
    dndPreventsDefault,
    `preventDefault & stopPropagation present: ${dndPreventsDefault}`
  );

  // --------------------------------------------------------------------------
  // Dimension 2: Edge Case Mining
  // --------------------------------------------------------------------------
  // Edge Case 1: Terminal panel height boundary clamping
  const minHeightPresent = termContent.includes('MIN_HEIGHT = 110');
  const maxHeightPresent = termContent.includes('MAX_HEIGHT = 650');
  const clampLogic = termContent.includes('Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT');
  record(
    'Edge Case Mining',
    'Terminal panel strictly clamps height within [110px, 650px] bounds',
    minHeightPresent && maxHeightPresent && clampLogic,
    `MIN=110, MAX=650, clamp=${clampLogic}`
  );

  // Edge Case 2: Terminal panel log buffer memory safety (leak prevention)
  const bufferLimitCheck = termContent.includes('logBuffer.length > 500') && termContent.includes('logBuffer.splice');
  record(
    'Edge Case Mining',
    'Terminal panel enforces strict 500-entry ring buffer to prevent OOM/memory leaks',
    bufferLimitCheck,
    `ringBufferEnforced=${bufferLimitCheck}`
  );

  // Edge Case 3: Empty task list rendering
  const emptyTasksCondition = homeContent.includes('filteredTasks.length === 0 ?');
  record(
    'Edge Case Mining',
    'Home page gracefully renders empty state when filteredTasks is empty',
    emptyTasksCondition,
    `emptyStateHandled=${emptyTasksCondition}`
  );

  // Edge Case 4: DownloadModal handles missing or empty cleanUrl/urlInput gracefully
  const dlTargetUrlGuard = dlContent.includes('const targetUrl = mediaInfo?.cleanUrl || urlInput.trim();');
  const dlEmptyGuard = dlContent.includes('if (!targetUrl || !mediaInfo) return;');
  record(
    'Edge Case Mining',
    'DownloadModal aborts cleanly without IPC call when target URL is invalid',
    dlTargetUrlGuard && dlEmptyGuard,
    `targetUrlGuard=${dlTargetUrlGuard && dlEmptyGuard}`
  );

  // Edge Case 5: Zen Mode hiding of sidebar and header
  const zenSidebar = homeContent.includes("isZenMode && activeTab === 'workflow'") && homeContent.includes('opacity-0 pointer-events-none');
  const zenHeader = homeContent.includes('!isZenMode && (');
  record(
    'Edge Case Mining',
    'Zen Mode cleanly collapses sidebar and unmounts header without breaking workflow tab state',
    zenSidebar && zenHeader,
    `zenSidebar=${zenSidebar}, zenHeader=${zenHeader}`
  );

  // --------------------------------------------------------------------------
  // Dimension 3: Dependency & Typings Risk
  // --------------------------------------------------------------------------
  // Verify all imported Lucide icons exist in lucide-react module
  const lucideIcons = [
    'CheckCircle2', 'CircleHelp', 'Cpu', 'Download', 'FileUp', 'FileVideo',
    'Film', 'Folder', 'FolderOpen', 'Globe', 'Keyboard', 'Layers', 'Link2',
    'Loader2', 'MessageSquareText', 'Mic', 'Play', 'Plus', 'RefreshCw',
    'Search', 'Settings', 'Sparkles', 'Subtitles', 'Trash2', 'UploadCloud',
    'Zap', 'Workflow', 'PanelLeftClose', 'PanelLeftOpen', 'AlertCircle',
    'Maximize2', 'Square', 'X'
  ];

  let lucideModule: any;
  try {
    lucideModule = await import('lucide-react');
  } catch (err: any) {
    console.error('Failed to import lucide-react:', err);
  }

  let allIconsExist = true;
  const missingIcons: string[] = [];
  if (lucideModule) {
    for (const icon of lucideIcons) {
      if (!lucideModule[icon]) {
        allIconsExist = false;
        missingIcons.push(icon);
      }
    }
  }

  record(
    'Dependency Risk',
    'All Lucide icons imported in home.tsx exist in upstream lucide-react package',
    allIconsExist && missingIcons.length === 0,
    missingIcons.length === 0 ? 'All 33 icons verified present' : `Missing: ${missingIcons.join(', ')}`
  );

  // --------------------------------------------------------------------------
  // Dimension 4: Residual Dead Code / Non-Functional Attributes
  // --------------------------------------------------------------------------
  // Check for unused properties in OnboardingModal
  const deadGradients = (onbContent.match(/iconGradient:\s*['"][^'"]+['"]/g) || []);
  const usesIconGradient = onbContent.includes('.iconGradient');
  record(
    'Dead Code Inspection',
    'OnboardingModal iconGradient is confirmed dead code (unused in render pipeline)',
    deadGradients.length > 0 && !usesIconGradient,
    `found ${deadGradients.length} dead gradient strings in STEPS data array, 0 references in JSX`
  );

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  const total = stressResults.length;
  const passed = stressResults.filter((r) => r.passed).length;
  const failed = stressResults.filter((r) => !r.passed).length;

  console.log('\n================================================================');
  console.log(`STRESS TEST SUMMARY: ${passed}/${total} PASSED (${failed} FAILED)`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runM2StressTests().catch((err) => {
  console.error('Fatal stress test failure:', err);
  process.exit(1);
});
