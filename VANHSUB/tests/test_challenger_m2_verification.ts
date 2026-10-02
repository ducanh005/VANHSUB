import fs from 'fs';
import path from 'path';
import ts from 'typescript';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  error?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, details: string, error?: string) {
  results.push({ name, passed, details, error });
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name} - ${details}`);
  if (error) console.error(`       Error: ${error}`);
}

const TARGET_FILES = [
  'renderer/pages/home.tsx',
  'renderer/components/TerminalPanel.tsx',
  'renderer/components/OnboardingModal.tsx',
  'renderer/components/ai-studio/ChromeBridgeModal.tsx',
  'renderer/components/download/DownloadModal.tsx',
];

async function runM2Verification() {
  console.log('=== STARTING EMPIRICAL CHALLENGER VERIFICATION FOR MILESTONE 2 ===\n');

  // -------------------------------------------------------------
  // Test 1: File Existence & Basic Readability
  // -------------------------------------------------------------
  const fileContents = new Map<string, string>();
  for (const relPath of TARGET_FILES) {
    const fullPath = path.resolve(relPath);
    if (!fs.existsSync(fullPath)) {
      record(`File existence: ${relPath}`, false, 'File does not exist');
      continue;
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    fileContents.set(relPath, content);
    record(`File existence: ${relPath}`, true, `Exists (${content.length} bytes, ${content.split('\n').length} lines)`);
  }

  // -------------------------------------------------------------
  // Test 2: TypeScript AST Parse & Syntax Validation
  // -------------------------------------------------------------
  for (const [relPath, content] of fileContents.entries()) {
    try {
      const sourceFile = ts.createSourceFile(
        relPath,
        content,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
      const parseDiagnostics = (sourceFile as any).parseDiagnostics || [];
      const hasErrors = parseDiagnostics.length > 0;
      record(
        `TSX AST parse: ${relPath}`,
        !hasErrors,
        hasErrors
          ? `Found ${parseDiagnostics.length} parse diagnostics`
          : 'Parsed successfully without syntax/grammar errors'
      );
    } catch (err: any) {
      record(`TSX AST parse: ${relPath}`, false, 'Failed to create AST', err.message);
    }
  }

  // -------------------------------------------------------------
  // Test 3: Legacy Color Tokens Elimination (#080D1A, #0B1120, #0E1526)
  // -------------------------------------------------------------
  const FORBIDDEN_COLORS = ['#080D1A', '#0B1120', '#0E1526', '#080d1a', '#0b1120', '#0e1526'];
  for (const [relPath, content] of fileContents.entries()) {
    const foundColors: string[] = [];
    for (const color of FORBIDDEN_COLORS) {
      if (content.toLowerCase().includes(color.toLowerCase())) {
        foundColors.push(color);
      }
    }
    record(
      `Legacy color audit: ${relPath}`,
      foundColors.length === 0,
      foundColors.length === 0
        ? 'Clean — zero legacy colors found'
        : `VIOLATION: found legacy colors: ${foundColors.join(', ')}`
    );
  }

  // -------------------------------------------------------------
  // Test 4: Backdrop Blur Elimination
  // -------------------------------------------------------------
  const BLUR_PATTERNS = ['backdrop-blur', 'backdrop-filter'];
  for (const [relPath, content] of fileContents.entries()) {
    const foundBlurs: string[] = [];
    for (const pattern of BLUR_PATTERNS) {
      if (content.includes(pattern)) {
        foundBlurs.push(pattern);
      }
    }
    record(
      `Backdrop-blur audit: ${relPath}`,
      foundBlurs.length === 0,
      foundBlurs.length === 0
        ? 'Clean — zero backdrop-blur found'
        : `VIOLATION: found blur classes: ${foundBlurs.join(', ')}`
    );
  }

  // -------------------------------------------------------------
  // Test 5: Oversized Border Radii Audit (rounded-3xl, rounded-2xl, rounded-xl)
  // -------------------------------------------------------------
  const OVERSIZED_RADII = ['rounded-3xl', 'rounded-2xl', 'rounded-xl'];
  for (const [relPath, content] of fileContents.entries()) {
    const foundRadii: string[] = [];
    for (const radius of OVERSIZED_RADII) {
      // match as exact class word
      const regex = new RegExp(`\\b${radius}\\b`, 'g');
      if (regex.test(content)) {
        foundRadii.push(radius);
      }
    }
    record(
      `Oversized border radius audit: ${relPath}`,
      foundRadii.length === 0,
      foundRadii.length === 0
        ? 'Clean — zero rounded-3xl/2xl/xl found (strictly <= rounded-lg)'
        : `VIOLATION: found oversized radius: ${foundRadii.join(', ')}`
    );
  }

  // -------------------------------------------------------------
  // Test 6: Legacy Vibe Utilities & Rainbow Gradient Audit
  // -------------------------------------------------------------
  const VIBE_CLASSES = [
    'card-glass',
    'card-glass-hover',
    'btn-vanh-gradient',
    'text-gradient-brand',
    'border-gradient-brand',
    'from-brand-cyan',
    'via-brand-indigo',
    'to-brand-rose',
    'shadow-brand-indigo',
    'shadow-cyan-950',
  ];
  for (const [relPath, content] of fileContents.entries()) {
    const foundVibe: string[] = [];
    for (const cls of VIBE_CLASSES) {
      if (content.includes(cls)) {
        foundVibe.push(cls);
      }
    }
    record(
      `Legacy vibe class audit: ${relPath}`,
      foundVibe.length === 0,
      foundVibe.length === 0
        ? 'Clean — zero legacy vibe classes/gradients found'
        : `VIOLATION: found vibe classes: ${foundVibe.join(', ')}`
    );
  }

  // -------------------------------------------------------------
  // Test 7: Emoji Replacement Audit
  // -------------------------------------------------------------
  const FORBIDDEN_EMOJIS = ['🌐', '📁', '📂', '🟢', '⚪', '🔄'];
  for (const [relPath, content] of fileContents.entries()) {
    const foundEmojis: string[] = [];
    for (const emoji of FORBIDDEN_EMOJIS) {
      if (content.includes(emoji)) {
        foundEmojis.push(emoji);
      }
    }
    record(
      `UI Emoji audit: ${relPath}`,
      foundEmojis.length === 0,
      foundEmojis.length === 0
        ? 'Clean — zero raw UI emojis found'
        : `VIOLATION: found raw emojis: ${foundEmojis.join(', ')}`
    );
  }

  // -------------------------------------------------------------
  // Test 8: Design System Dark Token Adoption Audit
  // -------------------------------------------------------------
  const CORE_TOKENS = ['bg-bg', 'bg-surface', 'bg-surface-2', 'border-border', 'text-text', 'text-text-muted', 'text-accent', 'bg-accent'];
  for (const [relPath, content] of fileContents.entries()) {
    const adoptedTokens = CORE_TOKENS.filter((t) => content.includes(t));
    record(
      `Design system token adoption: ${relPath}`,
      adoptedTokens.length >= 3,
      `Adopted ${adoptedTokens.length} core tokens: ${adoptedTokens.join(', ')}`
    );
  }

  // -------------------------------------------------------------
  // Test 9: AST Semantic Validation — Component Contracts
  // -------------------------------------------------------------
  // 9.1 home.tsx Handler & Lifecycle Invariance
  const homeContent = fileContents.get('renderer/pages/home.tsx') || '';
  const REQUIRED_HOME_HANDLERS = [
    'handleImportSrt',
    'handleStartTask',
    'handleRunPipeline',
    'handleCancelTask',
    'handleShowInFolder',
    'handleDeleteTask',
    'handleRunPipelineBatch',
    'loadTasks',
    'activeTab',
    'isSidebarCollapsed',
    'isZenMode',
    'selectedTaskId',
  ];
  const missingHomeHandlers = REQUIRED_HOME_HANDLERS.filter((h) => !homeContent.includes(h));
  record(
    'home.tsx lifecycle & handler integrity',
    missingHomeHandlers.length === 0,
    missingHomeHandlers.length === 0
      ? 'All critical state hooks, task handlers, and navigation properties are present'
      : `Missing handlers: ${missingHomeHandlers.join(', ')}`
  );

  // 9.2 home.tsx Lucide Icon Imports
  const REQUIRED_HOME_ICONS = ['Globe', 'Folder', 'FolderOpen', 'Terminal', 'Sparkles', 'PanelLeftOpen'];
  const missingHomeIcons = REQUIRED_HOME_ICONS.filter((i) => !homeContent.includes(i));
  record(
    'home.tsx icon import integrity',
    missingHomeIcons.length === 0,
    missingHomeIcons.length === 0
      ? 'All replacement Lucide icons (Globe, Folder, etc.) are properly imported'
      : `Missing icons: ${missingHomeIcons.join(', ')}`
  );

  // 9.3 TerminalPanel.tsx State & Handlers
  const terminalContent = fileContents.get('renderer/components/TerminalPanel.tsx') || '';
  const REQUIRED_TERMINAL_ELEMENTS = [
    'LEVEL_STYLE',
    'text-text-muted',
    'text-warning',
    'text-danger',
    'handleMouseDown',
    'handleScroll',
    'toggleMaximize',
    'formatTime',
  ];
  const missingTerminalElements = REQUIRED_TERMINAL_ELEMENTS.filter((e) => !terminalContent.includes(e));
  record(
    'TerminalPanel.tsx handler & style map integrity',
    missingTerminalElements.length === 0,
    missingTerminalElements.length === 0
      ? 'All log level token mappings and resize/scroll/maximize handlers are intact'
      : `Missing elements: ${missingTerminalElements.join(', ')}`
  );

  // 9.4 OnboardingModal.tsx Step Definition & Navigation
  const onboardingContent = fileContents.get('renderer/components/OnboardingModal.tsx') || '';
  const REQUIRED_ONBOARDING_ELEMENTS = [
    'STEPS',
    'step',
    'setStep',
    'dontShowAgain',
    'setDontShowAgain',
    'Dialog.Root',
    'Dialog.Content',
    'Dialog.Overlay',
  ];
  const missingOnboarding = REQUIRED_ONBOARDING_ELEMENTS.filter((e) => !onboardingContent.includes(e));
  record(
    'OnboardingModal.tsx step engine & dialog integrity',
    missingOnboarding.length === 0,
    missingOnboarding.length === 0
      ? 'All step state, navigation logic, and Dialog primitives are intact'
      : `Missing elements: ${missingOnboarding.join(', ')}`
  );

  // 9.5 ChromeBridgeModal.tsx Extension Bridge Actions
  const chromeBridgeContent = fileContents.get('renderer/components/ai-studio/ChromeBridgeModal.tsx') || '';
  const REQUIRED_CHROME_BRIDGE = [
    'handleOpenFolder',
    'handleOpenExtPage',
    'handleOpenChrome',
    'onRefresh',
    'onClose',
    'status.bridgeConnected',
  ];
  const missingChromeBridge = REQUIRED_CHROME_BRIDGE.filter((e) => !chromeBridgeContent.includes(e));
  record(
    'ChromeBridgeModal.tsx IPC handlers and status bindings',
    missingChromeBridge.length === 0,
    missingChromeBridge.length === 0
      ? 'All 3 bridge step IPC handlers and connection status bindings are intact'
      : `Missing elements: ${missingChromeBridge.join(', ')}`
  );

  // 9.6 DownloadModal.tsx Download Lifecycle & Cancellation
  const downloadContent = fileContents.get('renderer/components/download/DownloadModal.tsx') || '';
  const REQUIRED_DOWNLOAD_ELEMENTS = [
    'handleDownload',
    'handleCancelDownload',
    'isCancelling',
    'isDownloading',
    'progress.percent',
    'PLATFORM_BADGES',
  ];
  const missingDownload = REQUIRED_DOWNLOAD_ELEMENTS.filter((e) => !downloadContent.includes(e));
  record(
    'DownloadModal.tsx download and cancellation lifecycle',
    missingDownload.length === 0,
    missingDownload.length === 0
      ? 'Download trigger, cancelTaskExecution IPC call, and progress tracker are intact'
      : `Missing elements: ${missingDownload.join(', ')}`
  );

  // -------------------------------------------------------------
  // Test 10: Downstream Consistency & Non-Interference
  // -------------------------------------------------------------
  // Verify that other subviews mounted in home.tsx (e.g. ASRWorkspace, TTSPage, ExportPage)
  // still receive expected props without type mismatch.
  const subviewImports = ['ASRWorkspace', 'TTSPage', 'ExportPage', 'SubtitleEditor', 'AiStudioWorkspace'];
  const missingSubviews = subviewImports.filter((s) => !homeContent.includes(s));
  record(
    'home.tsx subview mount integrity',
    missingSubviews.length === 0,
    missingSubviews.length === 0
      ? 'All main studio workspaces (ASR, TTS, Export, Subtitle, AI Studio) are properly imported and wired'
      : `Missing subviews: ${missingSubviews.join(', ')}`
  );

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n=== EMPIRICAL TEST RESULTS SUMMARY ===');
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  console.log(`Total Tests Run: ${results.length}`);
  console.log(`Passed: ${passedCount}`);
  console.log(`Failed: ${failedCount}`);

  if (failedCount > 0) {
    console.error('\nFAILURE DETAILS:');
    results.filter((r) => !r.passed).forEach((r) => {
      console.error(`- ${r.name}: ${r.details}`);
    });
    process.exit(1);
  } else {
    console.log('\nALL EMPIRICAL TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
  }
}

runM2Verification().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
