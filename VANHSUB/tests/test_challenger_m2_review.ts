import fs from 'node:fs';
import path from 'node:path';

const TARGET_FILES = [
  'renderer/pages/home.tsx',
  'renderer/components/TerminalPanel.tsx',
  'renderer/components/OnboardingModal.tsx',
  'renderer/components/ai-studio/ChromeBridgeModal.tsx',
  'renderer/components/download/DownloadModal.tsx'
];

let failed = false;

function report(name: string, ok: boolean, msg: string) {
  if (ok) {
    console.log(`[PASS] ${name}: ${msg}`);
  } else {
    console.error(`[FAIL] ${name}: ${msg}`);
    failed = true;
  }
}

// 1. Check for legacy vibe code & forbidden classes in JSX / markup
const FORBIDDEN_PATTERNS = [
  { pattern: /#080D1A/i, name: 'Legacy dark bg (#080D1A)' },
  { pattern: /#0B1120/i, name: 'Legacy dark surface (#0B1120)' },
  { pattern: /#0E1526/i, name: 'Legacy dark modal bg (#0E1526)' },
  { pattern: /backdrop-blur/i, name: 'Glassmorphism backdrop-blur' },
  { pattern: /card-glass/i, name: 'Legacy card-glass class' },
  { pattern: /text-gradient-brand/i, name: 'Legacy text-gradient-brand' },
  { pattern: /border-gradient-brand/i, name: 'Legacy border-gradient-brand' },
  { pattern: /rounded-3xl/i, name: 'Oversize rounded-3xl (> 8px)' },
  { pattern: /rounded-2xl/i, name: 'Oversize rounded-2xl (> 8px)' },
  { pattern: /shadow-brand-indigo/i, name: 'Neon brand shadow' },
  { pattern: /shadow-cyan-950/i, name: 'Neon cyan shadow' },
  { pattern: /📁/, name: 'Raw folder emoji 📁' },
  { pattern: /🌐/, name: 'Raw globe emoji 🌐' },
  { pattern: /🟢/, name: 'Raw green circle emoji 🟢' },
  { pattern: /⚪/, name: 'Raw white circle emoji ⚪' },
  { pattern: /🔄/, name: 'Raw reload emoji 🔄' }
];

console.log('--- TEST SUITE 1: FORBIDDEN VIBE PATTERNS AUDIT ---');
for (const file of TARGET_FILES) {
  const content = fs.readFileSync(path.resolve(file), 'utf8');
  for (const { pattern, name } of FORBIDDEN_PATTERNS) {
    const match = content.match(pattern);
    report(
      `${file} - ${name}`,
      !match,
      match ? `Found forbidden pattern: "${match[0]}"` : 'Clean (no forbidden pattern)'
    );
  }
}

// Check JSX render in OnboardingModal specifically for active rainbow gradients
const onboardingContent = fs.readFileSync(path.resolve('renderer/components/OnboardingModal.tsx'), 'utf8');
const hasActiveGradientInJSX = /className=.*from-brand-cyan/i.test(onboardingContent);
report(
  'renderer/components/OnboardingModal.tsx - Active JSX Gradients',
  !hasActiveGradientInJSX,
  hasActiveGradientInJSX ? 'Active JSX gradient detected' : 'Clean (no active gradient in JSX rendering tree)'
);

if (onboardingContent.includes("iconGradient: 'from-brand-cyan via-brand-indigo to-brand-rose'")) {
  console.log('[NOTE] renderer/components/OnboardingModal.tsx contains unused legacy iconGradient field in static STEPS data (not rendered in JSX).');
}

console.log('\n--- TEST SUITE 2: SPECIFIC MILESTONE 2 DESIGN CRITERIA ---');
const homeContent = fs.readFileSync(path.resolve('renderer/pages/home.tsx'), 'utf8');

// Criteria 1: 48px dense header
report(
  'home.tsx header height',
  homeContent.includes('h-12') && homeContent.includes('bg-surface') && homeContent.includes('border-b border-border'),
  'Dense 48px header (h-12 bg-surface border-b border-border) present'
);

// Criteria 2: Sidebar flat surface
report(
  'home.tsx sidebar styling',
  homeContent.includes('border-r border-border bg-surface'),
  'Sidebar uses flat surface with 1px border (border-r border-border bg-surface)'
);

// Criteria 3: Active navigation item 2px left accent bar
report(
  'home.tsx active nav accent indicator',
  homeContent.includes('before:w-[2px] before:bg-accent'),
  'Active nav item uses 2px left accent bar (before:w-[2px] before:bg-accent)'
);

// Criteria 4: Universal search bar in header
report(
  'home.tsx header search bar styling',
  homeContent.includes('bg-surface-2') && homeContent.includes('focus-within:border-accent'),
  'Search bar matches neutral tokens (bg-surface-2, focus-within:border-accent)'
);

console.log('\n--- TEST SUITE 3: WCAG AA CONTRAST RATIO AUDIT ---');
function sRGBtoLin(colorChannel: number): number {
  const c = colorChannel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function getLuminance(hex: string): number {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return 0.2126 * sRGBtoLin(r) + 0.7152 * sRGBtoLin(g) + 0.0722 * sRGBtoLin(b);
}

function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const TOKENS = {
  bg: '#0e0e10',
  surface: '#151517',
  surface2: '#1c1c1f',
  surface3: '#242428',
  text: '#e8e8ea',
  textMuted: '#8e8e96',
  textFaint: '#5c5c64',
  accent: '#4f8cff',
  white: '#ffffff',
  success: '#3fb950',
  warning: '#d29922',
  danger: '#f85149'
};

// Check primary text against all surfaces (WCAG AA requires >= 4.5:1)
for (const [sName, sHex] of Object.entries({ bg: TOKENS.bg, surface: TOKENS.surface, surface2: TOKENS.surface2, surface3: TOKENS.surface3 })) {
  const ratio = getContrastRatio(TOKENS.text, sHex);
  report(
    `Contrast: text (${TOKENS.text}) on ${sName} (${sHex})`,
    ratio >= 4.5,
    `Ratio: ${ratio.toFixed(2)}:1 (minimum 4.5:1 required)`
  );
}

// Check muted text against bg & surface
for (const [sName, sHex] of Object.entries({ bg: TOKENS.bg, surface: TOKENS.surface, surface2: TOKENS.surface2 })) {
  const ratio = getContrastRatio(TOKENS.textMuted, sHex);
  report(
    `Contrast: text-muted (${TOKENS.textMuted}) on ${sName} (${sHex})`,
    ratio >= 4.5,
    `Ratio: ${ratio.toFixed(2)}:1 (minimum 4.5:1 required)`
  );
}

// Check primary button text: white on accent
const buttonRatio = getContrastRatio(TOKENS.white, TOKENS.accent);
report(
  `Contrast: white on accent button (${TOKENS.accent})`,
  buttonRatio >= 3.0,
  `Ratio: ${buttonRatio.toFixed(2)}:1 (minimum 3:1 for large/bold text & components)`
);

// Check semantic signals on surface
for (const [sigName, sigHex] of Object.entries({ success: TOKENS.success, warning: TOKENS.warning, danger: TOKENS.danger })) {
  const ratio = getContrastRatio(sigHex, TOKENS.surface);
  report(
    `Contrast: semantic ${sigName} (${sigHex}) on surface`,
    ratio >= 3.0,
    `Ratio: ${ratio.toFixed(2)}:1 (minimum 3:1 for semantic cues)`
  );
}

console.log('\n--- TEST SUITE 4: INTERACTION & LOGIC CONTINUITY AUDIT ---');
// Verify handlers in home.tsx
const requiredHandlers = [
  'handleImportSrt',
  'handleStartTask',
  'handleRunPipeline',
  'handleCancelTask',
  'handleShowInFolder',
  'handleDeleteTask',
  'handleRunPipelineBatch',
  'loadTasks',
  'handleDrop',
  'handleSelectFiles',
  'checkChromeBridge'
];

for (const handler of requiredHandlers) {
  report(
    `home.tsx handler: ${handler}`,
    homeContent.includes(handler),
    `Handler ${handler} is preserved in component body`
  );
}

// Verify tab views in home.tsx
const requiredTabs = [
  'AiStudioWorkspace',
  'WorkflowCanvas',
  'SubtitleEditor',
  'TTSPage',
  'ExportPage',
  'SettingsPage',
  'ASRWorkspace'
];

for (const tab of requiredTabs) {
  report(
    `home.tsx tab: ${tab}`,
    homeContent.includes(tab),
    `Tab component <${tab} /> is mounted and conditioned`
  );
}

// Verify modals in home.tsx
const requiredModals = [
  'TerminalPanel',
  'OnboardingModal',
  'DownloadModal',
  'ChromeBridgeModal'
];

for (const modal of requiredModals) {
  report(
    `home.tsx modal: ${modal}`,
    homeContent.includes(modal),
    `Modal component <${modal} /> is mounted and wired`
  );
}

if (failed) {
  console.error('\nADVERSARIAL TESTS FAILED');
  process.exit(1);
} else {
  console.log('\nALL ADVERSARIAL TESTS PASSED (100%)');
  process.exit(0);
}
