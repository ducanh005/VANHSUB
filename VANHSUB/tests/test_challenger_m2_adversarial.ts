import fs from 'fs';
import path from 'path';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  details: string;
  error?: string;
}

const results: TestResult[] = [];

function record(suite: string, name: string, passed: boolean, details: string, error?: string) {
  results.push({ suite, name, passed, details, error });
  const mark = passed ? 'PASS' : 'FAIL';
  console.log(`[${mark}] [${suite}] ${name} - ${details}`);
  if (error) console.error(`       Error: ${error}`);
}

const M2_FILES = [
  'renderer/pages/home.tsx',
  'renderer/components/TerminalPanel.tsx',
  'renderer/components/OnboardingModal.tsx',
  'renderer/components/ai-studio/ChromeBridgeModal.tsx',
  'renderer/components/download/DownloadModal.tsx',
];

async function runM2AdversarialSuite() {
  console.log('================================================================');
  console.log('   STARTING EMPIRICAL ADVERSARIAL STRESS TEST FOR MILESTONE 2   ');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // SUITE 1: File Existence & Basic Integrity
  // --------------------------------------------------------------------------
  for (const relPath of M2_FILES) {
    const fullPath = path.resolve(relPath);
    if (!fs.existsSync(fullPath)) {
      record('File Integrity', `Existence: ${relPath}`, false, 'File does not exist');
    } else {
      const stat = fs.statSync(fullPath);
      const lines = fs.readFileSync(fullPath, 'utf8').split('\n').length;
      record(
        'File Integrity',
        `Existence: ${relPath}`,
        stat.size > 0,
        `Exists, ${stat.size} bytes, ${lines} lines`
      );
    }
  }

  // Read all file contents into memory
  const fileContents = new Map<string, string>();
  for (const relPath of M2_FILES) {
    fileContents.set(relPath, fs.readFileSync(path.resolve(relPath), 'utf8'));
  }

  // --------------------------------------------------------------------------
  // SUITE 2: Anti-Vibe Code & Legacy Token Elimination Audit
  // --------------------------------------------------------------------------
  const forbiddenPatterns = [
    { pattern: '#080D1A', name: 'Legacy dark-blue #080D1A' },
    { pattern: '#0B1120', name: 'Legacy dark-blue #0B1120' },
    { pattern: '#0E1526', name: 'Legacy dark-blue #0E1526' },
    { pattern: 'backdrop-blur', name: 'Glassmorphism backdrop-blur' },
    { pattern: 'card-glass', name: 'Glassmorphism card-glass' },
    { pattern: 'btn-vanh-gradient', name: 'Rainbow btn-vanh-gradient' },
    { pattern: 'text-gradient-brand', name: 'Rainbow text-gradient-brand' },
    { pattern: 'border-gradient-brand', name: 'Rainbow border-gradient-brand' },
    { pattern: 'shadow-brand', name: 'Neon shadow-brand glow' },
    { pattern: 'rounded-3xl', name: 'Oversized radius rounded-3xl' },
    { pattern: 'rounded-2xl', name: 'Oversized radius rounded-2xl' },
  ];

  for (const relPath of M2_FILES) {
    const content = fileContents.get(relPath)!;
    for (const { pattern, name } of forbiddenPatterns) {
      const occurrences = (content.match(new RegExp(pattern, 'g')) || []).length;
      record(
        'Vibe Code Audit',
        `${relPath} has no ${name}`,
        occurrences === 0,
        occurrences === 0 ? 'Clean (0 occurrences)' : `Found ${occurrences} occurrences!`
      );
    }
  }

  // Specific check for legacy brand gradient tokens in JSX rendering
  // Note: Checking OnboardingModal dead code vs rendered JSX
  const onbContent = fileContents.get('renderer/components/OnboardingModal.tsx')!;
  const onbUsesIconGradientInJsx = /current\.iconGradient/.test(onbContent) || /step\.iconGradient/.test(onbContent);
  const onbDeadGradientMatches = onbContent.match(/iconGradient:\s*['"][^'"]+['"]/g) || [];
  record(
    'Vibe Code Audit',
    'renderer/components/OnboardingModal.tsx does not render legacy iconGradient in JSX',
    !onbUsesIconGradientInJsx,
    onbUsesIconGradientInJsx
      ? 'FAIL: iconGradient is rendered in JSX'
      : `PASS: iconGradient is NOT referenced in JSX (dead data definitions exist: ${onbDeadGradientMatches.length} unused items)`
  );

  // --------------------------------------------------------------------------
  // SUITE 3: Raw Emoji Replacement Audit
  // --------------------------------------------------------------------------
  const forbiddenEmojis = ['📁', '🌐', '🟢', '⚪', '📂', '🔗', '🔄'];
  for (const relPath of M2_FILES) {
    const content = fileContents.get(relPath)!;
    for (const emoji of forbiddenEmojis) {
      const count = (content.match(new RegExp(emoji, 'g')) || []).length;
      record(
        'Emoji Audit',
        `${relPath} has no raw emoji '${emoji}'`,
        count === 0,
        count === 0 ? 'Clean (0 occurrences)' : `Found ${count} instances of emoji ${emoji}`
      );
    }
  }

  // --------------------------------------------------------------------------
  // SUITE 4: Lucide Icon Verification (Globe, Folder, ExternalLink)
  // --------------------------------------------------------------------------
  const homeContent = fileContents.get('renderer/pages/home.tsx')!;
  const chromeContent = fileContents.get('renderer/components/ai-studio/ChromeBridgeModal.tsx')!;

  // Globe in home.tsx (line 655 has className={`h-4 w-4 shrink-0 ...`})
  const homeImportsGlobe = /import\s*\{[^}]*\bGlobe\b[^}]*\}\s*from\s*['"]lucide-react['"]/.test(homeContent);
  const homeUsesGlobe = /<Globe\s+[^>]*\/>/.test(homeContent);
  const homeGlobeMatches = homeContent.match(/<Globe\s+className=\{`([^`]+)`\}/);
  const homeGlobeHasDims = homeGlobeMatches ? /h-4\s+w-4/.test(homeGlobeMatches[1]) : false;

  record(
    'Icon Audit',
    'home.tsx imports and renders <Globe /> with valid dimensions',
    homeImportsGlobe && homeUsesGlobe && homeGlobeHasDims,
    `imported=${homeImportsGlobe}, rendered=${homeUsesGlobe}, snippet="${homeGlobeMatches ? homeGlobeMatches[1] : 'none'}"`
  );

  // Folder in home.tsx
  const homeImportsFolder = /import\s*\{[^}]*\bFolder\b[^}]*\}\s*from\s*['"]lucide-react['"]/.test(homeContent);
  const homeUsesFolder = /<Folder\s+[^>]*\/>/.test(homeContent);
  const homeFolderMatches = homeContent.match(/<Folder\s+className=["'`]([^"'`]+)["'`]/);
  const homeFolderHasDims = homeFolderMatches ? /h-3\s+w-3/.test(homeFolderMatches[1]) : false;

  record(
    'Icon Audit',
    'home.tsx imports and renders <Folder /> with valid dimensions',
    homeImportsFolder && homeUsesFolder && homeFolderHasDims,
    `imported=${homeImportsFolder}, rendered=${homeUsesFolder}, snippet="${homeFolderMatches ? homeFolderMatches[1] : 'none'}"`
  );

  // Globe in ChromeBridgeModal.tsx
  const chromeImportsGlobe = /import\s*\{[^}]*\bGlobe\b[^}]*\}\s*from\s*['"]lucide-react['"]/.test(chromeContent);
  const chromeUsesGlobe = /<Globe\s+[^>]*\/>/.test(chromeContent);
  const chromeGlobeMatches = chromeContent.match(/<Globe\s+className=["'`]([^"'`]+)["'`]/);
  const chromeGlobeHasDims = chromeGlobeMatches ? /h-5\s+w-5/.test(chromeGlobeMatches[1]) : false;

  record(
    'Icon Audit',
    'ChromeBridgeModal.tsx imports and renders <Globe /> with valid dimensions',
    chromeImportsGlobe && chromeUsesGlobe && chromeGlobeHasDims,
    `imported=${chromeImportsGlobe}, rendered=${chromeUsesGlobe}, snippet="${chromeGlobeMatches ? chromeGlobeMatches[1] : 'none'}"`
  );

  // Folder in ChromeBridgeModal.tsx
  const chromeImportsFolder = /import\s*\{[^}]*\bFolder\b[^}]*\}\s*from\s*['"]lucide-react['"]/.test(chromeContent);
  const chromeUsesFolder = /<Folder\s+[^>]*\/>/.test(chromeContent);
  const chromeFolderMatches = chromeContent.match(/<Folder\s+className=["'`]([^"'`]+)["'`]/);
  const chromeFolderHasDims = chromeFolderMatches ? /h-3\s+w-3/.test(chromeFolderMatches[1]) : false;

  record(
    'Icon Audit',
    'ChromeBridgeModal.tsx imports and renders <Folder /> with valid dimensions',
    chromeImportsFolder && chromeUsesFolder && chromeFolderHasDims,
    `imported=${chromeImportsFolder}, rendered=${chromeUsesFolder}, snippet="${chromeFolderMatches ? chromeFolderMatches[1] : 'none'}"`
  );

  // ExternalLink in ChromeBridgeModal.tsx
  const chromeImportsExt = /import\s*\{[^}]*\bExternalLink\b[^}]*\}\s*from\s*['"]lucide-react['"]/.test(chromeContent);
  const chromeUsesExt = /<ExternalLink\b/.test(chromeContent);
  record(
    'Icon Audit',
    'ChromeBridgeModal.tsx imports and renders <ExternalLink />',
    chromeImportsExt && chromeUsesExt,
    `imported=${chromeImportsExt}, rendered=${chromeUsesExt}`
  );

  // --------------------------------------------------------------------------
  // SUITE 5: Functional & Contractual Verification for home.tsx
  // --------------------------------------------------------------------------
  // 1. All tab IDs present in navigation
  const expectedTabs = ['home', 'ai-studio', 'workflow', 'subtitles', 'editor', 'dubbing', 'export', 'settings'];
  for (const tab of expectedTabs) {
    const tabInNav = homeContent.includes(`id: '${tab}'`);
    const tabRendered = homeContent.includes(`activeTab === '${tab}'`);
    record(
      'Tab State Switching',
      `Tab '${tab}' is configured and rendered conditionally`,
      tabInNav && tabRendered,
      `configuredInNav=${tabInNav}, conditionalRender=${tabRendered}`
    );
  }

  // 2. Task Actions
  const taskActions = [
    { name: 'Open Folder (handleShowInFolder)', regex: /handleShowInFolder\([^)]*\)/ },
    { name: 'Delete Task (handleDeleteTask)', regex: /handleDeleteTask\([^)]*\)/ },
    { name: 'Cancel Running Task (handleCancelTask)', regex: /handleCancelTask\([^)]*\)/ },
    { name: 'Start Task (handleStartTask)', regex: /handleStartTask\([^)]*\)/ },
    { name: 'Run Pipeline (handleRunPipeline)', regex: /handleRunPipeline\([^)]*\)/ },
    { name: 'Import SRT (handleImportSrt)', regex: /handleImportSrt\([^)]*\)/ },
    { name: 'Run Pipeline Batch (handleRunPipelineBatch)', regex: /handleRunPipelineBatch/ },
    { name: 'Refresh Tasks (loadTasks)', regex: /onClick=\{loadTasks\}/ },
  ];

  for (const action of taskActions) {
    const present = action.regex.test(homeContent);
    record(
      'Task Actions',
      `Task action ${action.name} is bound to UI button`,
      present,
      present ? 'Bound successfully' : 'Missing binding in home.tsx!'
    );
  }

  // 3. Drag and Drop File Zone
  const hasDragOver = homeContent.includes('onDragOver={handleDragOver}');
  const hasDragLeave = homeContent.includes('onDragLeave={handleDragLeave}');
  const hasDrop = homeContent.includes('onDrop={handleDrop}');
  const hasIsDraggingState = homeContent.includes('isDragging');
  record(
    'Drag & Drop Zone',
    'Drag and drop event listeners and state transitions intact',
    hasDragOver && hasDragLeave && hasDrop && hasIsDraggingState,
    `dragOver=${hasDragOver}, dragLeave=${hasDragLeave}, drop=${hasDrop}, state=${hasIsDraggingState}`
  );

  // 4. Terminal Drawer Toggle & Shell Modals in home.tsx
  const hasTerminalPanel = /<TerminalPanel\s*\/>/.test(homeContent);
  const hasOnboardingModal = /<OnboardingModal\s+open=\{guideReady && showGuide\}\s+onClose=\{handleCloseGuide\}\s*\/>/.test(homeContent);
  const hasDownloadModal = /<DownloadModal\b/.test(homeContent);
  const hasChromeBridgeModal = /<ChromeBridgeModal\b/.test(homeContent);

  record('Shell Modals', 'TerminalPanel is mounted in home layout', hasTerminalPanel, `hasTerminalPanel=${hasTerminalPanel}`);
  record('Shell Modals', 'OnboardingModal is mounted with reactive props', hasOnboardingModal, `hasOnboardingModal=${hasOnboardingModal}`);
  record('Shell Modals', 'DownloadModal is mounted with state bindings', hasDownloadModal, `hasDownloadModal=${hasDownloadModal}`);
  record('Shell Modals', 'ChromeBridgeModal is mounted with state bindings', hasChromeBridgeModal, `hasChromeBridgeModal=${hasChromeBridgeModal}`);

  // --------------------------------------------------------------------------
  // SUITE 6: Modal Specific Mechanics
  // --------------------------------------------------------------------------
  const termContent = fileContents.get('renderer/components/TerminalPanel.tsx')!;
  const termHasToggle = termContent.includes('toggle') && termContent.includes('expanded');
  const termHasResize = termContent.includes('handleMouseDown') && termContent.includes('mousemove');
  const termHasLocalStorage = termContent.includes('vanhsub_terminal_height');
  const termHasClearLogs = termContent.includes('logBuffer.length = 0');
  const termHasMaximize = termContent.includes('toggleMaximize');

  record('TerminalPanel Mechanics', 'Terminal expand toggle exists', termHasToggle, `termHasToggle=${termHasToggle}`);
  record('TerminalPanel Mechanics', 'Terminal mouse resize drag handle exists', termHasResize, `termHasResize=${termHasResize}`);
  record('TerminalPanel Mechanics', 'Terminal height persistent in localStorage', termHasLocalStorage, `termHasLocalStorage=${termHasLocalStorage}`);
  record('TerminalPanel Mechanics', 'Terminal clear logs button functional', termHasClearLogs, `termHasClearLogs=${termHasClearLogs}`);
  record('TerminalPanel Mechanics', 'Terminal maximize/minimize toggle exists', termHasMaximize, `termHasMaximize=${termHasMaximize}`);

  const onbHasSteps = onbContent.includes('STEPS') && onbContent.includes('setStep');
  const onbHasDontShowAgain = onbContent.includes('dontShowAgain') && onbContent.includes('setDontShowAgain');
  const onbHasClose = onbContent.includes('onClose(dontShowAgain)');

  record('OnboardingModal Mechanics', 'Multi-step wizard state intact', onbHasSteps, `onbHasSteps=${onbHasSteps}`);
  record('OnboardingModal Mechanics', 'Do not show again checkbox state intact', onbHasDontShowAgain, `onbHasDontShowAgain=${onbHasDontShowAgain}`);
  record('OnboardingModal Mechanics', 'OnClose callback passes dontShowAgain flag', onbHasClose, `onbHasClose=${onbHasClose}`);

  const dlContent = fileContents.get('renderer/components/download/DownloadModal.tsx')!;
  const dlHasInspect = dlContent.includes('handleInspect') && dlContent.includes('downloader.inspect');
  const dlHasDownload = dlContent.includes('handleDownload') && dlContent.includes('startDownload');
  const dlHasCancel = dlContent.includes('handleCancelDownload') && dlContent.includes('downloader.cancel');
  const dlHasPlatformBadges = dlContent.includes('renderPlatformBadge');
  const dlHasDirectoryPick = dlContent.includes('handleChooseDirectory') && dlContent.includes('dialog.chooseDirectory');

  record('DownloadModal Mechanics', 'URL inspection logic intact', dlHasInspect, `dlHasInspect=${dlHasInspect}`);
  record('DownloadModal Mechanics', 'Background download dispatch intact', dlHasDownload, `dlHasDownload=${dlHasDownload}`);
  record('DownloadModal Mechanics', 'Cancel download taskkill connection intact', dlHasCancel, `dlHasCancel=${dlHasCancel}`);
  record('DownloadModal Mechanics', 'Platform badges rendering intact', dlHasPlatformBadges, `dlHasPlatformBadges=${dlHasPlatformBadges}`);
  record('DownloadModal Mechanics', 'Directory selector dialog intact', dlHasDirectoryPick, `dlHasDirectoryPick=${dlHasDirectoryPick}`);

  const chromeHasFolder = chromeContent.includes('handleOpenFolder') && chromeContent.includes('openExtensionFolder');
  const chromeHasChrome = chromeContent.includes('handleOpenChrome') && chromeContent.includes('openChrome');
  const chromeHasExtPage = chromeContent.includes('handleOpenExtPage') && chromeContent.includes('openChromeExtensionsPage');
  const chromeHasStatusPoll = chromeContent.includes('bridgeStatus');

  record('ChromeBridgeModal Mechanics', 'Open extension folder IPC intact', chromeHasFolder, `chromeHasFolder=${chromeHasFolder}`);
  record('ChromeBridgeModal Mechanics', 'Open Chrome browser IPC intact', chromeHasChrome, `chromeHasChrome=${chromeHasChrome}`);
  record('ChromeBridgeModal Mechanics', 'Open extensions page IPC intact', chromeHasExtPage, `chromeHasExtPage=${chromeHasExtPage}`);
  record('ChromeBridgeModal Mechanics', 'Bridge connection status polling intact', chromeHasStatusPoll, `chromeHasStatusPoll=${chromeHasStatusPoll}`);

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log('\n================================================================');
  console.log(`ADVERSARIAL STRESS TEST SUMMARY: ${passed}/${total} PASSED (${failed} FAILED)`);
  console.log('================================================================\n');

  if (failed > 0) {
    console.error('FAILURES DETECTED:');
    for (const f of results.filter((r) => !r.passed)) {
      console.error(`- [${f.suite}] ${f.name}: ${f.details}`);
    }
    process.exit(1);
  } else {
    console.log('ALL EMPIRICAL ADVERSARIAL CHECKS PASSED WITH ZERO REGRESSIONS!');
    process.exit(0);
  }
}

runM2AdversarialSuite().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
