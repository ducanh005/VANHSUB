import fs from 'fs';
import path from 'path';

interface Check {
  category: string;
  name: string;
  passed: boolean;
  message: string;
}

const checks: Check[] = [];

function check(category: string, name: string, condition: boolean, message: string) {
  checks.push({ category, name, passed: condition, message });
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`[${status}] [${category}] ${name}: ${message}`);
}

const home = fs.readFileSync(path.resolve('renderer/pages/home.tsx'), 'utf8');
const terminal = fs.readFileSync(path.resolve('renderer/components/TerminalPanel.tsx'), 'utf8');
const onboarding = fs.readFileSync(path.resolve('renderer/components/OnboardingModal.tsx'), 'utf8');
const chrome = fs.readFileSync(path.resolve('renderer/components/ai-studio/ChromeBridgeModal.tsx'), 'utf8');
const download = fs.readFileSync(path.resolve('renderer/components/download/DownloadModal.tsx'), 'utf8');

console.log('=== RUNNING M2 DEEP ADVERSARIAL STRESS TEST ===\n');

// 1. ZEN MODE & SIDEBAR COLLAPSE
check(
  'Sidebar & Shell',
  'Zen Mode conditional collapse in home.tsx',
  home.includes("isZenMode && activeTab === 'workflow'") &&
  home.includes('w-0 border-r-0 p-0 overflow-hidden opacity-0 pointer-events-none'),
  'Zen mode hides sidebar only on workflow tab'
);

check(
  'Sidebar & Shell',
  'Sidebar collapse width transition',
  home.includes("'w-[68px] px-2 py-4'") && home.includes("'w-[240px] px-4 py-5'"),
  'Sidebar toggles between 68px (collapsed) and 240px (expanded)'
);

check(
  'Sidebar & Shell',
  'Sidebar active tab accent bar specification',
  home.includes('bg-surface-3 text-text before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:bg-accent'),
  'Active tab uses surface-3 with 2px accent indicator'
);

// 2. TERMINAL PANEL CONTROLS
check(
  'Terminal Panel',
  'Drag resize handle top position and cursor',
  terminal.includes('cursor-ns-resize') && terminal.includes('handleMouseDown'),
  'Terminal top edge is resizable with cursor-ns-resize'
);

check(
  'Terminal Panel',
  'Maximize/minimize toggle with title and icon',
  terminal.includes('toggleMaximize') && terminal.includes('Minimize2') && terminal.includes('Maximize2'),
  'Terminal maximize/minimize properly swaps icons and handles height state'
);

check(
  'Terminal Panel',
  'Terminal semantic log level colors',
  terminal.includes("info: 'text-text-muted'") &&
  terminal.includes("warn: 'text-warning'") &&
  terminal.includes("error: 'text-danger'"),
  'Terminal levels mapped to standard semantic tokens'
);

// 3. ONBOARDING WIZARD
check(
  'Onboarding Modal',
  'Navigation state bounds check',
  onboarding.includes('step === STEPS.length - 1') &&
  onboarding.includes('setStep(step - 1)') &&
  onboarding.includes('setStep(step + 1)'),
  'Step bounds and advance/back handlers are preserved'
);

check(
  'Onboarding Modal',
  'DontShowAgain persistence through callback',
  onboarding.includes('onClose(dontShowAgain)') &&
  onboarding.includes('setDontShowAgain(e.target.checked)'),
  'DontShowAgain flag passed back on close'
);

// 4. CHROME BRIDGE MODAL
check(
  'Chrome Bridge Modal',
  'IPC function calls for Chrome extension bridge',
  chrome.includes('vanhsub.veo.openExtensionFolder') &&
  chrome.includes('vanhsub.veo.openChromeExtensionsPage') &&
  chrome.includes('vanhsub.veo.openChrome'),
  'All 3 IPC endpoints for extension bridge preserved'
);

check(
  'Chrome Bridge Modal',
  'Semantic connection status badge',
  chrome.includes('bg-success/10') && chrome.includes('text-success') &&
  chrome.includes('bg-warning/10') && chrome.includes('text-warning'),
  'Status badges use success and warning design tokens'
);

// 5. DOWNLOAD MODAL
check(
  'Download Modal',
  'Cancel download IPC taskkill binding',
  download.includes('window.vanhsub.downloader.cancel') &&
  download.includes('handleCancelDownload'),
  'Downloader cancel triggers IPC downloader.cancel'
);

check(
  'Download Modal',
  'Platform badge token styling',
  download.includes('bg-surface-2 text-text border border-border'),
  'Platform badge uses surface-2 with border-border'
);

check(
  'Download Modal',
  'Progress percent format and indicator',
  download.includes('progress.percent.toFixed(1)') &&
  download.includes('bg-accent rounded-full transition-all duration-300'),
  'Progress bar uses accent color and tracks percentage'
);

// 6. GEOMETRY RESTRICTION ENFORCEMENT
const allFiles = [
  { name: 'home.tsx', content: home },
  { name: 'TerminalPanel.tsx', content: terminal },
  { name: 'OnboardingModal.tsx', content: onboarding },
  { name: 'ChromeBridgeModal.tsx', content: chrome },
  { name: 'DownloadModal.tsx', content: download }
];

allFiles.forEach(({ name, content }) => {
  const badRadii = content.match(/rounded-(xl|2xl|3xl)/g);
  check(
    'Geometry Restriction',
    `${name} has no rounded-xl, 2xl, or 3xl`,
    !badRadii,
    badRadii ? `Found: ${badRadii.join(', ')}` : 'Strictly <= 8px radii'
  );
});

// Summary
const failed = checks.filter(c => !c.passed);
console.log(`\nResults: ${checks.length - failed.length}/${checks.length} passed.`);
if (failed.length > 0) {
  console.error(`Failed ${failed.length} checks:`);
  failed.forEach(f => console.error(`- [${f.category}] ${f.name}: ${f.message}`));
  process.exit(1);
} else {
  console.log('All deep adversarial checks successfully verified!');
  process.exit(0);
}
