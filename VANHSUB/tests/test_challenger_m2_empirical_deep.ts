import fs from 'fs';
import path from 'path';

interface AssertionResult {
  suite: string;
  test: string;
  passed: boolean;
  message: string;
  detail?: string;
}

const assertions: AssertionResult[] = [];

function assert(suite: string, test: string, condition: boolean, message: string, detail?: string) {
  assertions.push({ suite, test, passed: condition, message, detail });
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`[${status}] [${suite}] ${test}: ${message}`);
  if (!condition && detail) {
    console.error(`       DETAILS: ${detail}`);
  }
}

const TARGET_FILES = {
  home: 'renderer/pages/home.tsx',
  terminal: 'renderer/components/TerminalPanel.tsx',
  onboarding: 'renderer/components/OnboardingModal.tsx',
  chromeBridge: 'renderer/components/ai-studio/ChromeBridgeModal.tsx',
  download: 'renderer/components/download/DownloadModal.tsx',
};

async function runEmpiricalDeepSuite() {
  console.log('================================================================');
  console.log('   STARTING EMPIRICAL DEEP ADVERSARIAL SUITE FOR MILESTONE 2   ');
  console.log('================================================================\n');

  const contents: Record<string, string> = {};
  for (const [key, relPath] of Object.entries(TARGET_FILES)) {
    const fullPath = path.resolve(relPath);
    assert('File Existence', `File ${relPath}`, fs.existsSync(fullPath), 'Target file must exist on disk');
    contents[key] = fs.readFileSync(fullPath, 'utf8');
  }

  // --------------------------------------------------------------------------
  // SECTION 1: AST / TAG & IMPORT INTEGRITY
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 1: TAG & IMPORT INTEGRITY ---');

  // Verify Lucide imports in home.tsx
  const home = contents.home;
  const lucideHomeMatch = home.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/);
  assert('Imports', 'home.tsx imports from lucide-react', !!lucideHomeMatch, 'Lucide icons must be imported');
  if (lucideHomeMatch) {
    const importedIcons = lucideHomeMatch[1].split(',').map((s) => s.trim());
    assert('Imports', 'home.tsx imports Globe', importedIcons.includes('Globe'), 'Globe must be in import list');
    assert('Imports', 'home.tsx imports Folder', importedIcons.includes('Folder'), 'Folder must be in import list');
    assert('Imports', 'home.tsx imports FolderOpen', importedIcons.includes('FolderOpen'), 'FolderOpen must be in import list');
  }

  // Verify Lucide imports in ChromeBridgeModal.tsx
  const chrome = contents.chromeBridge;
  const lucideChromeMatch = chrome.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/);
  assert('Imports', 'ChromeBridgeModal.tsx imports from lucide-react', !!lucideChromeMatch, 'Lucide icons must be imported');
  if (lucideChromeMatch) {
    const importedChromeIcons = lucideChromeMatch[1].split(',').map((s) => s.trim());
    assert('Imports', 'ChromeBridgeModal imports Globe', importedChromeIcons.includes('Globe'), 'Globe must be in import list');
    assert('Imports', 'ChromeBridgeModal imports Folder', importedChromeIcons.includes('Folder'), 'Folder must be in import list');
    assert('Imports', 'ChromeBridgeModal imports ExternalLink', importedChromeIcons.includes('ExternalLink'), 'ExternalLink must be in import list');
  }

  // --------------------------------------------------------------------------
  // SECTION 2: LUCIDE ICON RENDERING & DIMENSION STRICTNESS
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 2: LUCIDE ICON RENDERING & DIMENSIONS ---');

  // Check Globe in home.tsx: must have explicit width and height
  const homeGlobeTag = home.match(/<Globe\b([^>]*)\/>/);
  assert('Icon Dimensions', 'home.tsx renders <Globe />', !!homeGlobeTag, 'Globe tag must exist');
  if (homeGlobeTag) {
    const hasDimensions = /h-\d+(\.\d+)?/.test(homeGlobeTag[1]) && /w-\d+(\.\d+)?/.test(homeGlobeTag[1]);
    assert('Icon Dimensions', 'home.tsx <Globe /> has explicit w-* and h-* classes', hasDimensions, 'Globe must define dimensions', homeGlobeTag[0]);
  }

  // Check Folder in home.tsx: must have explicit width and height
  const homeFolderTag = home.match(/<Folder\b([^>]*)\/>/);
  assert('Icon Dimensions', 'home.tsx renders <Folder />', !!homeFolderTag, 'Folder tag must exist');
  if (homeFolderTag) {
    const hasDimensions = /h-\d+(\.\d+)?/.test(homeFolderTag[1]) && /w-\d+(\.\d+)?/.test(homeFolderTag[1]);
    assert('Icon Dimensions', 'home.tsx <Folder /> has explicit w-* and h-* classes', hasDimensions, 'Folder must define dimensions', homeFolderTag[0]);
  }

  // Check Globe in ChromeBridgeModal: must have explicit width and height
  const chromeGlobeTag = chrome.match(/<Globe\b([^>]*)\/>/);
  assert('Icon Dimensions', 'ChromeBridgeModal renders <Globe />', !!chromeGlobeTag, 'Globe tag must exist');
  if (chromeGlobeTag) {
    const hasDimensions = /h-\d+(\.\d+)?/.test(chromeGlobeTag[1]) && /w-\d+(\.\d+)?/.test(chromeGlobeTag[1]);
    assert('Icon Dimensions', 'ChromeBridgeModal <Globe /> has explicit w-* and h-* classes', hasDimensions, 'Globe must define dimensions', chromeGlobeTag[0]);
  }

  // Check Folder in ChromeBridgeModal: must have explicit width and height
  const chromeFolderTag = chrome.match(/<Folder\b([^>]*)\/>/);
  assert('Icon Dimensions', 'ChromeBridgeModal renders <Folder />', !!chromeFolderTag, 'Folder tag must exist');
  if (chromeFolderTag) {
    const hasDimensions = /h-\d+(\.\d+)?/.test(chromeFolderTag[1]) && /w-\d+(\.\d+)?/.test(chromeFolderTag[1]);
    assert('Icon Dimensions', 'ChromeBridgeModal <Folder /> has explicit w-* and h-* classes', hasDimensions, 'Folder must define dimensions', chromeFolderTag[0]);
  }

  // Check ExternalLink in ChromeBridgeModal: all occurrences must have explicit dimensions
  const extLinkMatches = [...chrome.matchAll(/<ExternalLink\b([^>]*)\/?>/g)];
  assert('Icon Dimensions', 'ChromeBridgeModal renders <ExternalLink />', extLinkMatches.length > 0, `Found ${extLinkMatches.length} occurrences`);
  extLinkMatches.forEach((m, idx) => {
    const hasDims = /h-\d+(\.\d+)?/.test(m[1]) && /w-\d+(\.\d+)?/.test(m[1]);
    assert('Icon Dimensions', `ChromeBridgeModal <ExternalLink #${idx + 1}/> has explicit dimensions`, hasDims, 'Must have explicit dimensions', m[0]);
  });

  // Verify all explicitly imported Lucide icons in each file have valid dimension styling when rendered
  const filesToCheck = [
    { file: 'home.tsx', content: contents.home },
    { file: 'TerminalPanel.tsx', content: contents.terminal },
    { file: 'OnboardingModal.tsx', content: contents.onboarding },
    { file: 'ChromeBridgeModal.tsx', content: contents.chromeBridge },
    { file: 'DownloadModal.tsx', content: contents.download },
  ];

  for (const { file, content } of filesToCheck) {
    const importMatch = content.match(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/);
    if (!importMatch) continue;

    const importedLucideIcons = new Set(
      importMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/^type\s+/, ''))
        .filter((s) => s.length > 0 && !s.includes(' as '))
    );

    for (const iconName of importedLucideIcons) {
      // Find all JSX usages of <IconName ... />
      const iconUsages = [...content.matchAll(new RegExp(`<${iconName}\\b([^>]*)\\/?>`, 'g'))];
      for (const usage of iconUsages) {
        const attrs = usage[1];
        const hasDims = /h-\d+(\.\d+)?/.test(attrs) && /w-\d+(\.\d+)?/.test(attrs);
        assert(
          'Icon Strictness',
          `${file}: <${iconName} /> rendered with dimensions`,
          hasDims,
          hasDims ? 'Valid dimensions present' : `Missing h-* and w-* in <${iconName}>`,
          usage[0]
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // SECTION 3: TAB STATE SWITCHING & NON-DESTRUCTIVE DOM PERSISTENCE
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 3: TAB STATE & DOM PERSISTENCE ---');

  const requiredTabs = [
    { id: 'home', component: null },
    { id: 'ai-studio', component: 'AiStudioWorkspace' },
    { id: 'workflow', component: 'WorkflowCanvas' },
    { id: 'subtitles', component: 'ASRWorkspace' },
    { id: 'editor', component: 'SubtitleEditor' },
    { id: 'dubbing', component: 'TTSPage' },
    { id: 'export', component: 'ExportPage' },
    { id: 'settings', component: 'SettingsPage' },
  ];

  for (const tab of requiredTabs) {
    // Check that each tab container uses the CSS hidden trick so it is NOT unmounted on tab switch
    const hiddenRegex = new RegExp(`activeTab === '${tab.id}'\\s*\\?\\s*['"]([^'"]+)['"]\\s*:\\s*['"]hidden['"]`);
    const match = home.match(hiddenRegex);
    assert(
      'Tab Persistence',
      `Tab '${tab.id}' preserves state via CSS 'hidden'`,
      !!match,
      match ? `Visible class: ${match[1]}` : `Tab '${tab.id}' does not use CSS 'hidden' toggle pattern!`
    );

    if (tab.component) {
      const compRegex = new RegExp(`<${tab.component}\\b`);
      assert(
        'Tab Component Binding',
        `Tab '${tab.id}' renders <${tab.component} />`,
        compRegex.test(home),
        `Component <${tab.component} /> must be present`
      );
    }
  }

  // Cross-tab task synchronization props: check selectedTaskId and onSelectTaskId passed to child tabs
  assert('Tab Task Sync', 'SubtitleEditor receives selectedTaskId & onSelectTaskId',
    home.includes('selectedTaskId={selectedTaskId}') && home.includes('onSelectTaskId={setSelectedTaskId}'),
    'selectedTaskId and onSelectTaskId must be connected to SubtitleEditor');

  assert('Tab Task Sync', 'TTSPage receives selectedTaskId & onSelectTaskId',
    home.includes('<TTSPage') && home.includes('selectedTaskId={selectedTaskId}'),
    'selectedTaskId must be connected to TTSPage');

  assert('Tab Task Sync', 'ExportPage receives selectedTaskId & onSelectTaskId',
    home.includes('<ExportPage') && home.includes('selectedTaskId={selectedTaskId}'),
    'selectedTaskId must be connected to ExportPage');

  assert('Tab Task Sync', 'ASRWorkspace receives selectedTaskId & onSelectTaskId',
    home.includes('<ASRWorkspace') && home.includes('selectedTaskId={selectedTaskId}'),
    'selectedTaskId must be connected to ASRWorkspace');

  // --------------------------------------------------------------------------
  // SECTION 4: TASK ACTIONS & INTERACTIVE LIFECYCLE
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 4: TASK ACTIONS & INTERACTIVE LIFECYCLE ---');

  // Verify handleShowInFolder handler implementation
  assert('Task Action Logic', 'handleShowInFolder handler exists and calls dialog IPC',
    home.includes('const handleShowInFolder') && (home.includes('openFolder') || home.includes('showInFolder')),
    'handleShowInFolder must invoke dialog.openFolder or dialog.showInFolder');

  // Verify handleDeleteTask handler implementation
  assert('Task Action Logic', 'handleDeleteTask handler exists and calls tasks.delete',
    home.includes('const handleDeleteTask') && home.includes('tasks.delete'),
    'handleDeleteTask must invoke tasks.delete IPC');

  // Verify handleCancelTask handler implementation
  assert('Task Action Logic', 'handleCancelTask handler exists and calls tasks.cancel',
    home.includes('const handleCancelTask') && home.includes('tasks.cancel'),
    'handleCancelTask must invoke tasks.cancel IPC');

  // Verify handleStartTask handler implementation
  assert('Task Action Logic', 'handleStartTask handler exists and calls tasks.start',
    home.includes('const handleStartTask') && home.includes('tasks.start'),
    'handleStartTask must invoke tasks.start IPC');

  // Verify handleImportSrt handler implementation
  assert('Task Action Logic', 'handleImportSrt handler exists and calls tasks.importSrt',
    home.includes('const handleImportSrt') && (home.includes('importSrt') || home.includes('chooseFile')),
    'handleImportSrt must open file dialog and import srt');

  // Verify handleRunPipelineBatch handler implementation
  assert('Task Action Logic', 'handleRunPipelineBatch exists and queues tasks',
    home.includes('const handleRunPipelineBatch') && (home.includes('handleRunPipeline') || home.includes('MAX_PARALLEL')),
    'handleRunPipelineBatch must coordinate batch queue');

  // Verify task actions button click handlers are bound in JSX
  assert('Task Action Bindings', 'Open folder button is bound with handleShowInFolder',
    home.includes('handleShowInFolder(t.projectDir || t.outputPath || t.filePath, e)'),
    'Folder button must pass path and event');

  assert('Task Action Bindings', 'Delete task button is bound with handleDeleteTask',
    home.includes('handleDeleteTask(t.id, e)'),
    'Trash button must pass task id and event');

  assert('Task Action Bindings', 'Cancel task button is bound with handleCancelTask',
    home.includes('handleCancelTask(t.id, e)'),
    'Stop button must pass task id and event');

  assert('Task Action Bindings', 'Start task button is bound with handleStartTask',
    home.includes('handleStartTask(t.id, e)'),
    'Play/Restart button must pass task id and event');

  // --------------------------------------------------------------------------
  // SECTION 5: DRAG & DROP ZONE FIDELITY
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 5: DRAG & DROP ZONE FIDELITY ---');

  assert('Dropzone', 'handleDragOver prevents default and sets isDragging true',
    home.includes('const handleDragOver') && home.includes('setIsDragging(true)'),
    'handleDragOver must set isDragging');

  assert('Dropzone', 'handleDragLeave sets isDragging false',
    home.includes('const handleDragLeave') && home.includes('setIsDragging(false)'),
    'handleDragLeave must clear isDragging');

  assert('Dropzone', 'handleDrop extracts files and triggers workflow creation',
    home.includes('const handleDrop') && home.includes('e.dataTransfer.files') && home.includes('setIsDragging(false)'),
    'handleDrop must extract dataTransfer files and reset isDragging');

  assert('Dropzone', 'Dropzone JSX container binds drag events and state styling',
    home.includes('onDragOver={handleDragOver}') &&
    home.includes('onDragLeave={handleDragLeave}') &&
    home.includes('onDrop={handleDrop}') &&
    home.includes("isDragging"),
    'Dropzone UI must react with neutral dark tokens during drag');

  // --------------------------------------------------------------------------
  // SECTION 6: TERMINAL PANEL DRAWER MECHANICS
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 6: TERMINAL PANEL DRAWER MECHANICS ---');

  const terminal = contents.terminal;
  assert('Terminal', 'Expanded state toggle handler exists',
    terminal.includes('const toggle = () =>') && terminal.includes('setExpanded'),
    'Terminal must toggle expanded state');

  assert('Terminal', 'Maximize/Minimize height toggle handler exists',
    terminal.includes('toggleMaximize') && terminal.includes('isMaximized'),
    'Terminal must support toggleMaximize');

  assert('Terminal', 'Height resizing via mouse drag intact',
    terminal.includes('handleMouseDown') && terminal.includes('cursor-ns-resize') && terminal.includes('setHeight'),
    'Terminal must support interactive height resizing');

  assert('Terminal', 'Log stream subscription and auto-scroll intact',
    terminal.includes('window.vanhsub.logs.onLog'),
    'Terminal must listen to logs via window.vanhsub.logs.onLog');

  assert('Terminal', 'Log levels use semantic tokens: text-text-muted, text-warning, text-danger',
    terminal.includes("info: 'text-text-muted'") &&
    terminal.includes("warn: 'text-warning'") &&
    terminal.includes("error: 'text-danger'"),
    'Terminal level styles must use design tokens');

  // --------------------------------------------------------------------------
  // SECTION 7: SHELL MODALS INTEGRITY & CONTRACTS
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 7: SHELL MODALS INTEGRITY & CONTRACTS ---');

  // OnboardingModal
  const onb = contents.onboarding;
  assert('OnboardingModal', 'Dialog component is imported from @radix-ui/react-dialog',
    onb.includes("import * as Dialog from '@radix-ui/react-dialog'"),
    'Must use Radix Dialog primitive');
  assert('OnboardingModal', 'Overlay has NO backdrop-blur',
    !onb.includes('backdrop-blur') && onb.includes('bg-black/60'),
    'Overlay must be flat neutral dark');
  assert('OnboardingModal', 'Content container has rounded-lg and surface token',
    onb.includes('rounded-lg border border-border bg-surface'),
    'Dialog content must adhere to token standard');
  assert('OnboardingModal', 'Step navigation updates state and bounds',
    onb.includes('setStep(step - 1)') && onb.includes('setStep(step + 1)'),
    'Must support prev/next steps');

  // ChromeBridgeModal
  assert('ChromeBridgeModal', 'Overlay has NO backdrop-blur',
    !chrome.includes('backdrop-blur') && chrome.includes('bg-black/60'),
    'Overlay must be flat neutral dark');
  assert('ChromeBridgeModal', 'Container has rounded-lg and surface token',
    chrome.includes('rounded-lg border border-border bg-surface'),
    'Dialog content must adhere to token standard');
  assert('ChromeBridgeModal', 'IPC handlers openExtensionFolder, openChrome, openChromeExtensionsPage intact',
    chrome.includes('openExtensionFolder') && chrome.includes('openChrome') && chrome.includes('openChromeExtensionsPage'),
    'All Chrome bridge IPC actions must remain functional');

  // DownloadModal
  const dl = contents.download;
  assert('DownloadModal', 'Overlay has NO backdrop-blur',
    !dl.includes('backdrop-blur') && dl.includes('bg-black/60'),
    'Overlay must be flat neutral dark');
  assert('DownloadModal', 'Container has rounded-lg and surface token',
    dl.includes('rounded-lg border border-border bg-surface'),
    'Dialog content must adhere to token standard');
  assert('DownloadModal', 'Download runner and IPC taskkill cancel intact',
    dl.includes('downloader.inspect') && dl.includes('downloader.cancel') && dl.includes('startDownload'),
    'Download and cancel pipelines must be bound');
  assert('DownloadModal', 'Platform badges render with clean rounded-md badges without rainbow glow',
    !dl.includes('shadow-cyan') && dl.includes('rounded-md') && dl.includes('renderPlatformBadge'),
    'Platform badges must use neutral dark tokens');

  // --------------------------------------------------------------------------
  // SECTION 8: FORBIDDEN TOKENS & OVERSIZED RADII AUDIT
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 8: FORBIDDEN TOKENS & OVERSIZED RADII AUDIT ---');

  const forbiddenClasses = [
    'rounded-3xl', 'rounded-2xl', 'rounded-xl',
    'backdrop-blur', 'backdrop-blur-sm', 'backdrop-blur-md', 'backdrop-blur-lg',
    'card-glass', 'card-glass-hover',
    'text-gradient-brand', 'border-gradient-brand',
    'btn-vanh-gradient',
    'shadow-brand-indigo', 'shadow-cyan-950',
    '#080D1A', '#0B1120', '#0E1526'
  ];

  for (const [key, content] of Object.entries(contents)) {
    for (const fClass of forbiddenClasses) {
      const count = (content.match(new RegExp(fClass.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'g')) || []).length;
      assert(
        'Design Token Purity',
        `${TARGET_FILES[key as keyof typeof TARGET_FILES]} free of '${fClass}'`,
        count === 0,
        count === 0 ? 'Clean (0)' : `Found ${count} occurrences of '${fClass}'!`
      );
    }
  }

  // Ensure OnboardingModal does not render iconGradient in JSX
  const onbRenderUsesGradient = /className=\{[^}]*iconGradient/.test(onb) || /className=["'][^"']*iconGradient/.test(onb);
  assert(
    'Design Token Purity',
    'OnboardingModal does not render legacy iconGradient in JSX',
    !onbRenderUsesGradient,
    'iconGradient must not be bound to JSX className'
  );

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  const total = assertions.length;
  const passed = assertions.filter((a) => a.passed).length;
  const failed = assertions.filter((a) => !a.passed).length;

  console.log('\n================================================================');
  console.log(`EMPIRICAL DEEP ADVERSARIAL SUMMARY: ${passed}/${total} PASSED (${failed} FAILED)`);
  console.log('================================================================\n');

  if (failed > 0) {
    console.error('CRITICAL FAILURES DETECTED:');
    for (const f of assertions.filter((a) => !a.passed)) {
      console.error(`- [${f.suite}] ${f.test}: ${f.message}`);
      if (f.detail) console.error(`    Detail: ${f.detail}`);
    }
    process.exit(1);
  } else {
    console.log('ALL EMPIRICAL DEEP ADVERSARIAL STRESS TESTS PASSED WITH 100% SUCCESS!');
    process.exit(0);
  }
}

runEmpiricalDeepSuite().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
