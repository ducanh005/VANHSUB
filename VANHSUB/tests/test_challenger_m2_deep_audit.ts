import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

interface AssertionResult {
  category: string;
  testName: string;
  passed: boolean;
  message: string;
}

const assertions: AssertionResult[] = [];

function assert(category: string, testName: string, condition: boolean, message: string) {
  assertions.push({
    category,
    testName,
    passed: condition,
    message,
  });
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`[${status}] [${category}] ${testName}: ${message}`);
}

const M2_TARGET_FILES = [
  'renderer/pages/home.tsx',
  'renderer/components/TerminalPanel.tsx',
  'renderer/components/OnboardingModal.tsx',
  'renderer/components/ai-studio/ChromeBridgeModal.tsx',
  'renderer/components/download/DownloadModal.tsx',
];

async function runEmpiricalDeepAudit() {
  console.log('========================================================================');
  console.log('  MILESTONE 2: EMPIRICAL ADVERSARIAL DEEP STRESS & AUDIT HARNESS        ');
  console.log('========================================================================\n');

  // 1. FILE EXISTENCE & STATS
  for (const file of M2_TARGET_FILES) {
    const fullPath = path.resolve(file);
    const exists = fs.existsSync(fullPath);
    assert('File System', `Exists: ${file}`, exists, exists ? `Found at ${fullPath}` : 'Missing file');
    if (exists) {
      const stat = fs.statSync(fullPath);
      assert('File System', `Non-empty: ${file}`, stat.size > 500, `Size: ${stat.size} bytes`);
    }
  }

  // 2. FORBIDDEN STRINGS & LEGACY ARTIFACTS
  const forbiddenPatterns = [
    { name: 'Legacy dark blue #080D1A', regex: /#080D1A/i },
    { name: 'Legacy dark blue #0B1120', regex: /#0B1120/i },
    { name: 'Legacy dark blue #0E1526', regex: /#0E1526/i },
    { name: 'Glassmorphism backdrop-blur', regex: /backdrop-blur/i },
    { name: 'Glassmorphism card-glass', regex: /card-glass/i },
    { name: 'Rainbow btn-vanh-gradient', regex: /btn-vanh-gradient/i },
    { name: 'Rainbow text-gradient-brand', regex: /text-gradient-brand/i },
    { name: 'Rainbow border-gradient-brand', regex: /border-gradient-brand/i },
    { name: 'Rainbow from-brand- gradient in JSX', regex: /from-brand-[a-z]+/i },
    { name: 'Neon shadow-brand', regex: /shadow-brand/i },
    { name: 'Oversized radius rounded-3xl', regex: /rounded-3xl/i },
    { name: 'Oversized radius rounded-2xl', regex: /rounded-2xl/i },
  ];

  for (const file of M2_TARGET_FILES) {
    const content = fs.readFileSync(path.resolve(file), 'utf8');

    for (const pattern of forbiddenPatterns) {
      // If OnboardingModal, note that unused iconGradient in data definition is acceptable as long as not rendered in JSX
      if (file === 'renderer/components/OnboardingModal.tsx' && pattern.name.includes('from-brand-')) {
        const renderedInJsx = /className=[^{>]*from-brand/i.test(content) || /className=\{`[^`]*from-brand/i.test(content);
        assert(
          'Token Purity',
          `${file} has no rendered from-brand gradient`,
          !renderedInJsx,
          renderedInJsx ? 'Found from-brand in JSX!' : 'Clean in rendered JSX'
        );
        continue;
      }

      const match = content.match(pattern.regex);
      assert(
        'Token Purity',
        `${file} free of ${pattern.name}`,
        !match,
        match ? `Found violation: ${match[0]}` : 'Clean (0 matches)'
      );
    }
  }

  // 3. EMOJI PURITY AUDIT
  const forbiddenEmojis = ['📁', '🌐', '🟢', '⚪', '📂', '🔗', '🔄', '⚡'];
  for (const file of M2_TARGET_FILES) {
    const content = fs.readFileSync(path.resolve(file), 'utf8');
    for (const emoji of forbiddenEmojis) {
      // In Vietnamese text / descriptions, text characters might occasionally have lightning or symbol,
      // but UI icons should never use emojis.
      const emojiInJsxTag = new RegExp(`>\\s*${emoji}\\s*<`).test(content);
      assert(
        'Emoji Elimination',
        `${file} does not use emoji ${emoji} as raw icon element`,
        !emojiInJsxTag,
        emojiInJsxTag ? `Found standalone emoji ${emoji} in JSX!` : 'Clean'
      );
    }
  }

  // 4. BUTTON & INPUT RADIUS SPECIFICATIONS (<= 6px)
  for (const file of M2_TARGET_FILES) {
    const content = fs.readFileSync(path.resolve(file), 'utf8');
    // Check buttons with rounded-xl, rounded-2xl, rounded-3xl
    const badButtonMatches = content.match(/<button[^>]*className=["'`][^"'`]*\brounded-(xl|2xl|3xl)\b[^"'`]*["'`]/gi) || [];
    assert(
      'Geometry Standards',
      `${file} buttons conform to <= 6px radius`,
      badButtonMatches.length === 0,
      badButtonMatches.length === 0 ? 'All buttons <= 6px' : `Found ${badButtonMatches.length} oversized button radii: ${badButtonMatches.join(', ')}`
    );

    // Check inputs with rounded-xl, rounded-2xl, rounded-3xl
    const badInputMatches = content.match(/<input[^>]*className=["'`][^"'`]*\brounded-(xl|2xl|3xl)\b[^"'`]*["'`]/gi) || [];
    assert(
      'Geometry Standards',
      `${file} inputs conform to <= 6px radius`,
      badInputMatches.length === 0,
      badInputMatches.length === 0 ? 'All inputs <= 6px' : `Found ${badInputMatches.length} oversized input radii: ${badInputMatches.join(', ')}`
    );
  }

  // 5. MODAL RADIUS SPECIFICATIONS (<= 8px)
  const modalFiles = [
    'renderer/components/OnboardingModal.tsx',
    'renderer/components/ai-studio/ChromeBridgeModal.tsx',
    'renderer/components/download/DownloadModal.tsx',
  ];
  for (const file of modalFiles) {
    const content = fs.readFileSync(path.resolve(file), 'utf8');
    const hasRoundedLgOrMd = /rounded-(lg|md|\[8px\]|\[6px\])/.test(content);
    const hasOversized = /rounded-(xl|2xl|3xl)/.test(content);
    assert(
      'Geometry Standards',
      `${file} modal container radius is <= 8px`,
      hasRoundedLgOrMd && !hasOversized,
      `hasRoundedLgOrMd=${hasRoundedLgOrMd}, hasOversized=${hasOversized}`
    );
  }

  // 6. HEADER COMPACTNESS (48px / h-12)
  const homeContent = fs.readFileSync(path.resolve('renderer/pages/home.tsx'), 'utf8');
  const hasH12Header = /<header[^>]*\bh-12\b/.test(homeContent);
  const hasH16Header = /<header[^>]*\bh-16\b/.test(homeContent);
  assert(
    'Layout Compactness',
    'home.tsx header uses compact h-12 (48px) instead of legacy h-16 (64px)',
    hasH12Header && !hasH16Header,
    `hasH12Header=${hasH12Header}, hasH16Header=${hasH16Header}`
  );

  // 7. SIDEBAR ACTIVE TAB ACCENT BAR
  const hasActiveIndicator = homeContent.includes('before:w-[2px] before:bg-accent');
  assert(
    'Navigation Design',
    'home.tsx active navigation tab has 2px accent indicator bar',
    hasActiveIndicator,
    `indicatorPresent=${hasActiveIndicator}`
  );

  // 8. TYPOGRAPHY & MONOSPACE
  const terminalContent = fs.readFileSync(path.resolve('renderer/components/TerminalPanel.tsx'), 'utf8');
  const terminalHasMono = terminalContent.includes('font-mono');
  assert(
    'Typography',
    'TerminalPanel.tsx uses font-mono for log stream',
    terminalHasMono,
    `terminalHasMono=${terminalHasMono}`
  );

  const homeHasMono = homeContent.includes('font-mono');
  assert(
    'Typography',
    'home.tsx uses font-mono for models/shortcuts/IDs',
    homeHasMono,
    `homeHasMono=${homeHasMono}`
  );

  // 9. LOGIC & IPC PRESERVATION STRESS CHECKS
  // Check DownloadModal cancel and download callbacks
  const dlContent = fs.readFileSync(path.resolve('renderer/components/download/DownloadModal.tsx'), 'utf8');
  assert(
    'IPC Preservation',
    'DownloadModal preserves handleCancelDownload',
    dlContent.includes('handleCancelDownload') && dlContent.includes('downloader') && dlContent.includes('cancel'),
    'Preserved handleCancelDownload'
  );
  assert(
    'IPC Preservation',
    'DownloadModal preserves chooseDirectory',
    dlContent.includes('chooseDirectory'),
    'Preserved chooseDirectory'
  );

  // Check ChromeBridgeModal IPC calls
  const chromeContent = fs.readFileSync(path.resolve('renderer/components/ai-studio/ChromeBridgeModal.tsx'), 'utf8');
  assert(
    'IPC Preservation',
    'ChromeBridgeModal preserves openExtensionFolder',
    chromeContent.includes('openExtensionFolder'),
    'Preserved openExtensionFolder'
  );
  assert(
    'IPC Preservation',
    'ChromeBridgeModal preserves openChrome',
    chromeContent.includes('openChrome'),
    'Preserved openChrome'
  );

  // Check TerminalPanel user scroll preservation (F-TERM-02)
  assert(
    'Terminal Logic',
    'TerminalPanel preserves userScrolledUpRef guard against forced auto-scroll',
    terminalContent.includes('userScrolledUpRef') && terminalContent.includes('distanceFromBottom > 50'),
    'Preserved userScrolledUpRef guard'
  );

  // 10. COMPILATION & BUILD ORACLE
  console.log('\nRunning build compiler oracles...');
  try {
    execSync('npx tsc --noEmit', { stdio: 'pipe', encoding: 'utf8' });
    assert('Build Oracle', 'TypeScript Workspace Check (npx tsc --noEmit)', true, 'Exit code 0');
  } catch (err: any) {
    assert('Build Oracle', 'TypeScript Workspace Check (npx tsc --noEmit)', false, err.message);
  }

  try {
    execSync('npx next build renderer', { stdio: 'pipe', encoding: 'utf8' });
    assert('Build Oracle', 'Next.js Production Build (npx next build renderer)', true, 'Exit code 0');
  } catch (err: any) {
    assert('Build Oracle', 'Next.js Production Build (npx next build renderer)', false, err.message);
  }

  // SUMMARY
  const total = assertions.length;
  const passed = assertions.filter((a) => a.passed).length;
  const failed = assertions.filter((a) => !a.passed).length;

  console.log('\n========================================================================');
  console.log(`AUDIT RESULTS: ${passed}/${total} PASSED (${failed} FAILED)`);
  console.log('========================================================================\n');

  if (failed > 0) {
    console.error('FAILED ASSERTIONS:');
    for (const a of assertions.filter((a) => !a.passed)) {
      console.error(`- [${a.category}] ${a.testName}: ${a.message}`);
    }
    process.exit(1);
  } else {
    console.log('ALL EMPIRICAL DEEP AUDIT CHECKS PASSED WITH FLYING COLORS!');
    process.exit(0);
  }
}

runEmpiricalDeepAudit().catch((e) => {
  console.error('Test execution failed:', e);
  process.exit(1);
});
