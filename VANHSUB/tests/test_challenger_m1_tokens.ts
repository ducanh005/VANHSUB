import fs from 'fs';
import path from 'path';
import postcss from 'postcss';
import tailwindPostcss from '@tailwindcss/postcss';

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

async function runTests() {
  console.log('=== STARTING EMPIRICAL CHALLENGER VERIFICATION FOR MILESTONE 1 ===\n');

  const cssPath = path.resolve('renderer/styles/globals.css');
  const appPath = path.resolve('renderer/pages/_app.tsx');

  // -------------------------------------------------------------
  // Test 1: File Existence & Basic Structure
  // -------------------------------------------------------------
  if (!fs.existsSync(cssPath)) {
    record('globals.css existence', false, 'File does not exist');
    return;
  }
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  record('globals.css existence', true, `File exists (${cssContent.length} bytes, ${cssContent.split('\n').length} lines)`);

  // -------------------------------------------------------------
  // Test 2: PostCSS Compilation of globals.css
  // -------------------------------------------------------------
  let compiledCss = '';
  try {
    const processor = postcss([tailwindPostcss()]);
    const res = await processor.process(cssContent, { from: cssPath });
    compiledCss = res.css;
    record(
      'PostCSS compilation of globals.css',
      compiledCss.length > 50000,
      `Compiled cleanly without error. Output size: ${compiledCss.length} bytes`
    );
  } catch (err: any) {
    record('PostCSS compilation of globals.css', false, 'Compilation threw error', err.message);
  }

  // -------------------------------------------------------------
  // Test 3: AST and Syntax Validation (No unclosed blocks, parse errors)
  // -------------------------------------------------------------
  try {
    const parsed = postcss.parse(compiledCss);
    let ruleCount = 0;
    let declCount = 0;
    parsed.walkRules(() => { ruleCount++; });
    parsed.walkDecls(() => { declCount++; });
    record(
      'PostCSS AST validation',
      ruleCount > 100 && declCount > 200,
      `AST parsed valid CSS: ${ruleCount} rules, ${declCount} declarations`
    );
  } catch (err: any) {
    record('PostCSS AST validation', false, 'Failed to parse compiled CSS', err.message);
  }

  // -------------------------------------------------------------
  // Test 4: Design Token Definitions in :root and .dark
  // -------------------------------------------------------------
  const expectedTokens: Record<string, string> = {
    '--bg': '#0e0e10',
    '--surface': '#151517',
    '--surface-2': '#1c1c1f',
    '--surface-3': '#242428',
    '--border': '#26262b',
    '--border-strong': '#34343a',
    '--text': '#e8e8ea',
    '--text-muted': '#8e8e96',
    '--text-faint': '#5c5c64',
    '--accent': '#4f8cff',
    '--accent-hover': '#6aa0ff',
    '--accent-tint': 'rgba(79, 140, 255, 0.12)',
    '--success': '#3fb950',
    '--warning': '#d29922',
    '--danger': '#f85149',
    '--radius-button': '6px',
    '--radius-card': '8px',
  };

  let tokenMissing: string[] = [];
  let tokenMismatch: string[] = [];
  for (const [token, expectedVal] of Object.entries(expectedTokens)) {
    const re = new RegExp(`${token}\\s*:\\s*([^;]+);`);
    const match = cssContent.match(re);
    if (!match) {
      tokenMissing.push(token);
    } else {
      const val = match[1].trim();
      if (val !== expectedVal) {
        tokenMismatch.push(`${token}: expected ${expectedVal}, got ${val}`);
      }
    }
  }

  record(
    'Design token specifications',
    tokenMissing.length === 0 && tokenMismatch.length === 0,
    tokenMissing.length === 0 && tokenMismatch.length === 0
      ? `All ${Object.keys(expectedTokens).length} tokens declared with exact values`
      : `Missing: [${tokenMissing.join(', ')}], Mismatches: [${tokenMismatch.join(', ')}]`
  );

  // -------------------------------------------------------------
  // Test 5: Radius tokens capping (<= 8px)
  // -------------------------------------------------------------
  const radiusChecks = [
    { token: '--radius-sm', max: 4 },
    { token: '--radius-md', max: 6 },
    { token: '--radius-lg', max: 8 },
    { token: '--radius-xl', max: 8 },
    { token: '--radius-2xl', max: 8 },
    { token: '--radius-3xl', max: 8 },
    { token: '--radius-button', max: 6 },
    { token: '--radius-card', max: 8 },
  ];

  let radiusViolations: string[] = [];
  for (const check of radiusChecks) {
    const re = new RegExp(`${check.token}\\s*:\\s*(\\d+)px`);
    const match = cssContent.match(re);
    if (!match) {
      radiusViolations.push(`${check.token} not found`);
    } else {
      const px = parseInt(match[1], 10);
      if (px > check.max) {
        radiusViolations.push(`${check.token}: ${px}px > max ${check.max}px`);
      }
    }
  }

  record(
    'Radius capping (<= 8px)',
    radiusViolations.length === 0,
    radiusViolations.length === 0
      ? 'All radius tokens strictly <= 8px (buttons <= 6px)'
      : `Violations: ${radiusViolations.join(', ')}`
  );

  // -------------------------------------------------------------
  // Test 6: Legacy Vibe Code Elimination
  // -------------------------------------------------------------
  const forbiddenPatterns = [
    { name: '.card-glass class', regex: /\.card-glass\b/ },
    { name: '.card-glass-hover class', regex: /\.card-glass-hover\b/ },
    { name: '.text-gradient-brand class', regex: /\.text-gradient-brand\b/ },
    { name: '.border-gradient-brand class', regex: /\.border-gradient-brand\b/ },
    { name: 'backdrop-filter blur in globals.css', regex: /backdrop-filter:\s*blur/ },
  ];

  let vibeViolations: string[] = [];
  for (const p of forbiddenPatterns) {
    if (p.regex.test(cssContent)) {
      vibeViolations.push(p.name);
    }
  }

  record(
    'Vibe code elimination in globals.css',
    vibeViolations.length === 0,
    vibeViolations.length === 0
      ? 'No glassmorphism, brand gradients, or blur rules present'
      : `Forbidden patterns found: ${vibeViolations.join(', ')}`
  );

  // -------------------------------------------------------------
  // Test 7: Legacy Brand Token Neutralization
  // -------------------------------------------------------------
  const brandCyanMatch = cssContent.match(/--brand-cyan\s*:\s*([^;]+);/);
  const brandIndigoMatch = cssContent.match(/--brand-indigo\s*:\s*([^;]+);/);
  const brandRoseMatch = cssContent.match(/--brand-rose\s*:\s*([^;]+);/);
  const brandGlowMatch = cssContent.match(/--brand-glow\s*:\s*([^;]+);/);

  const brandAliasingValid =
    brandCyanMatch?.[1].trim() === 'var(--accent)' &&
    brandIndigoMatch?.[1].trim() === 'var(--accent)' &&
    brandRoseMatch?.[1].trim() === 'var(--accent)' &&
    brandGlowMatch?.[1].trim() === 'none';

  record(
    'Legacy brand tokens neutralization',
    brandAliasingValid,
    brandAliasingValid
      ? '--brand-cyan/indigo/rose redirect to var(--accent), --brand-glow is none'
      : `Brand tokens not redirected cleanly: cyan=${brandCyanMatch?.[1]}, glow=${brandGlowMatch?.[1]}`
  );

  // -------------------------------------------------------------
  // Test 8: Legacy .btn-vanh-gradient Neutralization
  // -------------------------------------------------------------
  const btnGradientMatch = cssContent.match(/\.btn-vanh-gradient\s*\{([^}]+)\}/);
  const btnContent = btnGradientMatch ? btnGradientMatch[1] : '';
  const btnHasAccentBg = btnContent.includes('background-color: var(--accent)');
  const btnHasWhiteText = btnContent.includes('color: #ffffff');
  const btnHasNoGlow = btnContent.includes('box-shadow: none');
  const btnHasRadius = btnContent.includes('border-radius: var(--radius-button, 6px)');

  const btnValid = btnHasAccentBg && btnHasWhiteText && btnHasNoGlow && btnHasRadius;

  record(
    'Legacy .btn-vanh-gradient neutralization',
    btnValid,
    btnValid
      ? '.btn-vanh-gradient rendered as solid accent (#4f8cff), white text, 0 glow, 6px radius'
      : `btn-vanh-gradient invalid: bg=${btnHasAccentBg}, white=${btnHasWhiteText}, noGlow=${btnHasNoGlow}, radius=${btnHasRadius}`
  );

  // -------------------------------------------------------------
  // Test 9: Tailwind v4 Candidate Utility Resolution Harness
  // Stress-test whether Tailwind v4 generates utility classes for our tokens
  // -------------------------------------------------------------
  const candidateClasses = [
    'bg-bg',
    'bg-surface',
    'bg-surface-2',
    'bg-surface-3',
    'border-border',
    'border-border-strong',
    'text-text',
    'text-text-muted',
    'text-text-faint',
    'bg-accent',
    'bg-accent-hover',
    'bg-accent-tint',
    'bg-success',
    'bg-warning',
    'bg-danger',
    'rounded-sm',
    'rounded-md',
    'rounded-lg',
    'rounded-xl',
    'rounded-2xl',
    'rounded-3xl',
    'bg-brand-cyan',
    'text-brand-indigo',
    'border-brand-rose',
    'font-sans',
    'font-mono',
  ];

  // We create a synthetic component string containing all candidates
  const syntheticHtml = candidateClasses.map(c => `<div className="${c}"></div>`).join('\n');
  const tempFixturePath = path.resolve('renderer/styles/__test_candidate_fixture__.html');
  fs.writeFileSync(tempFixturePath, syntheticHtml, 'utf8');

  let candidateFailures: string[] = [];
  try {
    // Process globals.css while the candidate fixture exists in the renderer directory
    const processor = postcss([tailwindPostcss()]);
    const res = await processor.process(cssContent, { from: cssPath });
    const fullCss = res.css;

    for (const cls of candidateClasses) {
      // Escape for regex selector (e.g. .bg-bg, .border-border, etc.)
      const escapedCls = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const selectorRegex = new RegExp(`\\.${escapedCls}\\b`);
      if (!selectorRegex.test(fullCss)) {
        candidateFailures.push(cls);
      }
    }

    record(
      'Tailwind v4 candidate utility compilation',
      candidateFailures.length === 0,
      candidateFailures.length === 0
        ? `All ${candidateClasses.length} candidate utility classes compiled successfully into CSS rules`
        : `Failed candidates: [${candidateFailures.join(', ')}]`
    );
  } catch (err: any) {
    record('Tailwind v4 candidate utility compilation', false, 'Failed to compile candidates', err.message);
  } finally {
    if (fs.existsSync(tempFixturePath)) {
      fs.unlinkSync(tempFixturePath);
    }
  }

  // -------------------------------------------------------------
  // Test 10: Standard Component Utilities Existence
  // -------------------------------------------------------------
  const utilityClasses = [
    '.btn-primary',
    '.btn-secondary',
    '.btn-ghost',
    '.btn-danger',
    '.input-base',
    '.card-base',
    '.card-interactive',
    '.panel-base',
    '.badge-base',
    '.badge-accent',
    '.badge-success',
    '.badge-warning',
    '.badge-danger',
    '.badge-neutral',
    '.nav-item-active',
    '.row-hover',
    '.custom-scrollbar',
  ];

  let missingUtilities: string[] = [];
  for (const util of utilityClasses) {
    const escaped = util.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escaped}\\b`);
    if (!regex.test(compiledCss)) {
      missingUtilities.push(util);
    }
  }

  record(
    'Standard component utility classes in globals.css',
    missingUtilities.length === 0,
    missingUtilities.length === 0
      ? `All ${utilityClasses.length} utility classes defined and present in compiled CSS`
      : `Missing utilities: [${missingUtilities.join(', ')}]`
  );

  // -------------------------------------------------------------
  // Test 11: renderer/pages/_app.tsx Structure & Meta Tag
  // -------------------------------------------------------------
  const appContent = fs.readFileSync(appPath, 'utf8');
  const hasColorScheme = appContent.includes('<meta name="color-scheme" content="dark" />');
  const hasViewport = appContent.includes('<meta name="viewport" content="width=device-width, initial-scale=1" />');
  const hasRootWrapper = appContent.includes('className="min-h-screen bg-bg text-text font-sans antialiased"');
  const hasHead = appContent.includes('<Head>') && appContent.includes('</Head>');

  const appValid = hasColorScheme && hasViewport && hasRootWrapper && hasHead;

  record(
    'renderer/pages/_app.tsx structure & meta tags',
    appValid,
    appValid
      ? 'Contains dark color-scheme meta, viewport meta, Head block, and bg-bg root wrapper'
      : `Missing attributes in _app.tsx: colorScheme=${hasColorScheme}, viewport=${hasViewport}, wrapper=${hasRootWrapper}, head=${hasHead}`
  );

  // -------------------------------------------------------------
  // Test 12: WCAG 2.1 AA Contrast Ratio Calculations
  // -------------------------------------------------------------
  function hexToRgb(hex: string): [number, number, number] {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function getLuminance([r, g, b]: [number, number, number]): number {
    const a = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  }

  function getContrast(hex1: string, hex2: string): number {
    const lum1 = getLuminance(hexToRgb(hex1));
    const lum2 = getLuminance(hexToRgb(hex2));
    const brightest = Math.max(lum1, lum2);
    const darkest = Math.min(lum1, lum2);
    return (brightest + 0.05) / (darkest + 0.05);
  }

  const contrastBgText = getContrast('#0e0e10', '#e8e8ea');
  const contrastSurfaceText = getContrast('#151517', '#e8e8ea');
  const contrastSurface2Text = getContrast('#1c1c1f', '#e8e8ea');
  const contrastBgMuted = getContrast('#0e0e10', '#8e8e96');
  const contrastAccentWhite = getContrast('#4f8cff', '#ffffff');

  const wcagPass =
    contrastBgText >= 4.5 &&
    contrastSurfaceText >= 4.5 &&
    contrastSurface2Text >= 4.5 &&
    contrastBgMuted >= 4.5 &&
    contrastAccentWhite >= 3.0;

  record(
    'WCAG 2.1 AA contrast ratio verification',
    wcagPass,
    `bg vs text: ${contrastBgText.toFixed(2)}:1 (>=4.5), surface vs text: ${contrastSurfaceText.toFixed(2)}:1 (>=4.5), surface2 vs text: ${contrastSurface2Text.toFixed(2)}:1 (>=4.5), bg vs text-muted: ${contrastBgMuted.toFixed(2)}:1 (>=4.5), accent vs white: ${contrastAccentWhite.toFixed(2)}:1 (>=3.0)`
  );

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n=== EMPIRICAL VERIFICATION SUMMARY ===');
  const total = results.length;
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = total - passedCount;
  console.log(`Total tests: ${total} | Passed: ${passedCount} | Failed: ${failedCount}`);

  if (failedCount > 0) {
    console.error('\nFAILURE DETAILS:');
    results.filter(r => !r.passed).forEach(r => console.error(`- ${r.name}: ${r.details}`));
    process.exit(1);
  } else {
    console.log('\nALL EMPIRICAL TESTS PASSED WITH 100% SUCCESS.');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
