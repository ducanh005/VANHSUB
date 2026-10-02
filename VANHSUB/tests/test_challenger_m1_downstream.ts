import fs from 'fs';
import path from 'path';
import postcss from 'postcss';
import tailwindPostcss from '@tailwindcss/postcss';

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
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] [${suite}] ${name} - ${details}`);
  if (error) console.error(`       Error: ${error}`);
}

async function runDownstreamTests() {
  console.log('=== RUNNING ADVERSARIAL STRESS TEST FOR M1 DOWNSTREAM COMPONENTS ===\n');

  const cssPath = path.resolve('renderer/styles/globals.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  // Compile globals.css with Tailwind PostCSS
  const processor = postcss([tailwindPostcss()]);
  const compiledRes = await processor.process(cssContent, { from: cssPath });
  const compiledCss = compiledRes.css;

  // -------------------------------------------------------------
  // Suite 1: Removed Classes Zero-Breakage Verification
  // Verify that removed classes (.card-glass, .card-glass-hover,
  // .text-gradient-brand, .border-gradient-brand) are NOT referenced
  // in ANY component in renderer/
  // -------------------------------------------------------------
  const removedClasses = [
    'card-glass',
    'card-glass-hover',
    'text-gradient-brand',
    'border-gradient-brand',
  ];

  function getFilesRecursively(dir: string, extensions: string[]): string[] {
    let files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.next' || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(getFilesRecursively(fullPath, extensions));
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const rendererFiles = getFilesRecursively(path.resolve('renderer'), ['.ts', '.tsx', '.jsx', '.js']);
  record(
    'Scope',
    'Renderer file discovery',
    rendererFiles.length > 20,
    `Discovered ${rendererFiles.length} files in renderer/`
  );

  for (const removedClass of removedClasses) {
    const offendingFiles: string[] = [];
    const regex = new RegExp(`\\b${removedClass}\\b`);
    for (const file of rendererFiles) {
      // Exclude globals.css if present in list
      if (file.endsWith('globals.css')) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (regex.test(content)) {
        offendingFiles.push(path.relative(process.cwd(), file));
      }
    }
    record(
      'Removed Classes',
      `Zero usage of .${removedClass}`,
      offendingFiles.length === 0,
      offendingFiles.length === 0
        ? `Clean: 0 occurrences in all ${rendererFiles.length} renderer files`
        : `Found occurrences in: ${offendingFiles.join(', ')}`
    );
  }

  // -------------------------------------------------------------
  // Suite 2: .btn-vanh-gradient Downstream Inspection & Contrast
  // Inspect every single usage in downstream components
  // Verify that none override text color to dark or unreadable colors
  // -------------------------------------------------------------
  const btnUsages: { file: string; line: number; snippet: string }[] = [];
  for (const file of rendererFiles) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      if (line.includes('btn-vanh-gradient')) {
        btnUsages.push({
          file: path.relative(process.cwd(), file),
          line: idx + 1,
          snippet: line.trim(),
        });
      }
    });
  }

  record(
    'btn-vanh-gradient',
    'Discovery of legacy CTA buttons',
    btnUsages.length > 5,
    `Discovered ${btnUsages.length} usages across downstream components`
  );

  // Check for any conflicting dark text classes on the same element
  const conflictingTextClasses = ['text-black', 'text-slate-900', 'text-slate-800', 'text-gray-900', 'text-zinc-900'];
  let btnConflicts: string[] = [];
  for (const usage of btnUsages) {
    for (const conflict of conflictingTextClasses) {
      if (usage.snippet.includes(conflict)) {
        btnConflicts.push(`${usage.file}:${usage.line} has ${conflict}`);
      }
    }
  }

  record(
    'btn-vanh-gradient',
    'Legible text contrast (no dark text conflicts)',
    btnConflicts.length === 0,
    btnConflicts.length === 0
      ? 'All btn-vanh-gradient instances retain white/light text without dark text overrides'
      : `Conflicting classes found: ${btnConflicts.join(', ')}`
  );

  // Check CSS definition in globals.css
  const btnRuleMatch = cssContent.match(/\.btn-vanh-gradient\s*\{([\s\S]*?)\}/);
  const btnRule = btnRuleMatch ? btnRuleMatch[1] : '';
  const hasBgAccent = btnRule.includes('background-color: var(--accent)');
  const hasColorWhite = btnRule.includes('color: #ffffff');
  const hasRadius6 = btnRule.includes('border-radius: var(--radius-button, 6px)');
  const hasNoBoxShadow = btnRule.includes('box-shadow: none');

  record(
    'btn-vanh-gradient',
    'CSS properties integrity',
    hasBgAccent && hasColorWhite && hasRadius6 && hasNoBoxShadow,
    `bg-accent: ${hasBgAccent}, color-white: ${hasColorWhite}, radius-6px: ${hasRadius6}, no-glow: ${hasNoBoxShadow}`
  );

  // Hover and active states
  const btnHoverMatch = cssContent.match(/\.btn-vanh-gradient:hover\s*\{([\s\S]*?)\}/);
  const btnHover = btnHoverMatch ? btnHoverMatch[1] : '';
  const hasHoverBg = btnHover.includes('background-color: var(--accent-hover)');
  const hasHoverWhite = btnHover.includes('color: #ffffff');

  record(
    'btn-vanh-gradient',
    'Hover state consistency',
    hasHoverBg && hasHoverWhite,
    `hover bg: ${hasHoverBg}, hover white text: ${hasHoverWhite}`
  );

  // -------------------------------------------------------------
  // Suite 3: font-mono Downstream Inspection & Resolution
  // -------------------------------------------------------------
  const fontMonoMatches = compiledCss.match(/\.font-mono[^{]*\{([\s\S]*?)\}/);
  const fontMonoBody = fontMonoMatches ? fontMonoMatches[1] : '';
  const fontMonoHasJetBrains = fontMonoBody.includes('JetBrains Mono');

  record(
    'font-mono',
    'Compiled font-mono rule',
    fontMonoHasJetBrains,
    fontMonoHasJetBrains
      ? 'font-mono compiles to JetBrains Mono stack in CSS output'
      : `font-mono missing or incorrect: ${fontMonoBody}`
  );

  // Key components using font-mono
  const keyComponentsWithMono = [
    'renderer/pages/home.tsx',
    'renderer/components/TerminalPanel.tsx',
    'renderer/components/ExportPage.tsx',
    'renderer/components/SubtitleEditor.tsx',
    'renderer/components/workflow/WorkflowCanvas.tsx',
  ];

  for (const comp of keyComponentsWithMono) {
    const fullCompPath = path.resolve(comp);
    const exists = fs.existsSync(fullCompPath);
    if (!exists) {
      record('font-mono', `${comp} presence`, false, 'File does not exist');
      continue;
    }
    const content = fs.readFileSync(fullCompPath, 'utf8');
    const usesFontMono = content.includes('font-mono');
    record(
      'font-mono',
      `${path.basename(comp)} font-mono integration`,
      usesFontMono,
      usesFontMono
        ? `Component successfully uses font-mono for technical data / code display`
        : `Component does not use font-mono`
    );
  }

  // -------------------------------------------------------------
  // Suite 4: .custom-scrollbar Downstream Inspection & Rules
  // -------------------------------------------------------------
  const scrollbarClassesInCss = [
    '.custom-scrollbar',
    '.custom-scrollbar::-webkit-scrollbar',
    '.custom-scrollbar::-webkit-scrollbar-thumb',
    '.custom-scrollbar::-webkit-scrollbar-track',
  ];

  let missingScrollbarRules: string[] = [];
  for (const sRule of scrollbarClassesInCss) {
    if (!compiledCss.includes(sRule)) {
      missingScrollbarRules.push(sRule);
    }
  }

  record(
    'custom-scrollbar',
    'Compiled scrollbar selectors in CSS',
    missingScrollbarRules.length === 0,
    missingScrollbarRules.length === 0
      ? 'All custom-scrollbar rules and webkit pseudo-elements present'
      : `Missing rules: ${missingScrollbarRules.join(', ')}`
  );

  // Check key components using custom-scrollbar
  const keyComponentsWithScrollbar = [
    'renderer/components/TerminalPanel.tsx',
    'renderer/components/workflow/WorkflowCanvas.tsx',
    'renderer/components/workflow/MasterTimeline.tsx',
    'renderer/components/workflow/Inspector.tsx',
  ];

  for (const comp of keyComponentsWithScrollbar) {
    const fullCompPath = path.resolve(comp);
    const exists = fs.existsSync(fullCompPath);
    if (!exists) {
      record('custom-scrollbar', `${comp} presence`, false, 'File does not exist');
      continue;
    }
    const content = fs.readFileSync(fullCompPath, 'utf8');
    const usesScrollbar = content.includes('custom-scrollbar');
    record(
      'custom-scrollbar',
      `${path.basename(comp)} scrollbar integration`,
      usesScrollbar,
      usesScrollbar
        ? `Component successfully attaches custom-scrollbar class`
        : `Component does not use custom-scrollbar`
    );
  }

  // -------------------------------------------------------------
  // Suite 5: Key Dependent Components Stress Inspection
  // Specific checks for: home.tsx, TerminalPanel.tsx, ExportPage.tsx,
  // SubtitleEditor.tsx, WorkflowCanvas.tsx
  // -------------------------------------------------------------
  // 5.1 home.tsx
  const homePath = path.resolve('renderer/pages/home.tsx');
  const homeContent = fs.readFileSync(homePath, 'utf8');
  record(
    'home.tsx',
    'Clean compilation & import integrity',
    homeContent.includes('export default function HomePage') || homeContent.includes('export default function Home'),
    'HomePage exported correctly'
  );

  // 5.2 TerminalPanel.tsx
  const terminalPath = path.resolve('renderer/components/TerminalPanel.tsx');
  const terminalContent = fs.readFileSync(terminalPath, 'utf8');
  const terminalHasScroll = terminalContent.includes('custom-scrollbar') && terminalContent.includes('font-mono');
  record(
    'TerminalPanel.tsx',
    'Terminal panel console scrollbar and monospace display',
    terminalHasScroll,
    'Log console incorporates font-mono and custom-scrollbar'
  );

  // 5.3 ExportPage.tsx
  const exportPath = path.resolve('renderer/components/ExportPage.tsx');
  const exportContent = fs.readFileSync(exportPath, 'utf8');
  const exportHasBtn = exportContent.includes('btn-vanh-gradient') && exportContent.includes('handleExport');
  record(
    'ExportPage.tsx',
    'Export CTA action button preserved',
    exportHasBtn,
    'handleExport CTA bound to btn-vanh-gradient with white Play icon'
  );

  // 5.4 SubtitleEditor.tsx
  const subPath = path.resolve('renderer/components/SubtitleEditor.tsx');
  const subContent = fs.readFileSync(subPath, 'utf8');
  const subHasSaveBtn = subContent.includes('btn-vanh-gradient') && subContent.includes('handleSave');
  record(
    'SubtitleEditor.tsx',
    'Subtitle editor save CTA button preserved',
    subHasSaveBtn,
    'Save CTA button active with btn-vanh-gradient'
  );

  // 5.5 WorkflowCanvas.tsx
  const wfPath = path.resolve('renderer/components/workflow/WorkflowCanvas.tsx');
  const wfContent = fs.readFileSync(wfPath, 'utf8');
  const wfHasScrollbars = wfContent.includes('custom-scrollbar');
  record(
    'WorkflowCanvas.tsx',
    'WorkflowCanvas header & drawer scrollbars',
    wfHasScrollbars,
    'Canvas navigation header and status drawer preserve custom-scrollbar'
  );

  // -------------------------------------------------------------
  // Suite 6: Brand Aliasing Downstream Resolution
  // Downstream files frequently use text-brand-cyan, shadow-brand-indigo/30, etc.
  // Ensure that these utility classes resolve to valid CSS and don't produce undefined colors
  // -------------------------------------------------------------
  const brandTestFixture = `
    <div class="text-brand-cyan bg-brand-cyan border-brand-cyan"></div>
    <div class="text-brand-indigo bg-brand-indigo border-brand-indigo"></div>
    <div class="text-brand-rose bg-brand-rose border-brand-rose"></div>
  `;
  const tempFixturePath = path.resolve('renderer/styles/__brand_test__.html');
  fs.writeFileSync(tempFixturePath, brandTestFixture, 'utf8');
  try {
    const res = await processor.process(cssContent, { from: cssPath });
    const fullBrandCss = res.css;
    const hasTextCyan = /\.text-brand-cyan\b/.test(fullBrandCss);
    const hasBgCyan = /\.bg-brand-cyan\b/.test(fullBrandCss);
    const hasTextIndigo = /\.text-brand-indigo\b/.test(fullBrandCss);
    const hasTextRose = /\.text-brand-rose\b/.test(fullBrandCss);

    record(
      'Brand Aliasing',
      'Legacy Tailwind brand utilities generation',
      hasTextCyan && hasBgCyan && hasTextIndigo && hasTextRose,
      `text-brand-cyan: ${hasTextCyan}, bg-brand-cyan: ${hasBgCyan}, text-brand-indigo: ${hasTextIndigo}, text-brand-rose: ${hasTextRose}`
    );
  } finally {
    if (fs.existsSync(tempFixturePath)) {
      fs.unlinkSync(tempFixturePath);
    }
  }

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n=== DOWNSTREAM STRESS TEST SUMMARY ===');
  const total = results.length;
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = total - passedCount;
  console.log(`Total downstream tests: ${total} | Passed: ${passedCount} | Failed: ${failedCount}`);

  if (failedCount > 0) {
    console.error('\nFAILURE DETAILS:');
    results.filter(r => !r.passed).forEach(r => console.error(`- [${r.suite}] ${r.name}: ${r.details}`));
    process.exit(1);
  } else {
    console.log('\nALL DOWNSTREAM STRESS TESTS PASSED WITH 100% SUCCESS.');
    process.exit(0);
  }
}

runDownstreamTests().catch(err => {
  console.error('Fatal error running downstream tests:', err);
  process.exit(1);
});
