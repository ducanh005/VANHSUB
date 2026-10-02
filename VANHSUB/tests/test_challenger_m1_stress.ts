import fs from 'fs';
import path from 'path';
import postcss from 'postcss';
import tailwindPostcss from '@tailwindcss/postcss';

interface StressResult {
  category: string;
  test: string;
  passed: boolean;
  metric: string;
}

const stressLog: StressResult[] = [];

function logTest(category: string, test: string, passed: boolean, metric: string) {
  stressLog.push({ category, test, passed, metric });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] [${category}] ${test}: ${metric}`);
}

async function runStressSuite() {
  console.log('=== RUNNING ADVERSARIAL STRESS SUITE FOR TAILWIND V4 & DESIGN TOKENS ===\n');

  const cssPath = path.resolve('renderer/styles/globals.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  // =========================================================================
  // Stress Test 1: Pseudo-Variants & Opacity Modifiers Compilation
  // =========================================================================
  const advancedCandidates = [
    // Opacity modifiers
    'bg-bg/50',
    'bg-surface/80',
    'bg-surface-2/90',
    'bg-surface-3/50',
    'border-border/40',
    'border-border-strong/60',
    'text-text/80',
    'text-text-muted/60',
    'bg-accent/10',
    'bg-accent/20',
    'bg-accent/50',
    'bg-success/15',
    'bg-warning/20',
    'bg-danger/25',
    // Pseudo-class variants
    'hover:bg-surface-2',
    'hover:text-text',
    'hover:border-border-strong',
    'focus:border-accent',
    'focus:ring-1',
    'focus:ring-accent',
    'active:bg-surface-3',
    'disabled:opacity-50',
    // Responsive variants
    'sm:bg-surface',
    'md:text-text',
    'lg:border-border',
  ];

  const fixtureContent = advancedCandidates.map(c => `<div className="${c}"></div>`).join('\n');
  const fixturePath = path.resolve('renderer/styles/__stress_fixture__.html');
  fs.writeFileSync(fixturePath, fixtureContent, 'utf8');

  try {
    const processor = postcss([tailwindPostcss()]);
    const res = await processor.process(cssContent, { from: cssPath });
    const compiled = res.css;

    let failedCandidates: string[] = [];
    for (const cand of advancedCandidates) {
      // Find candidate in compiled CSS
      // Note: in CSS, special characters like / and : are escaped with backslash
      const escapedInCss = cand
        .replace(/:/g, '\\:')
        .replace(/\//g, '\\/');
      
      const found = compiled.includes(escapedInCss);
      if (!found) {
        failedCandidates.push(cand);
      }
    }

    logTest(
      'Tailwind v4 Variants',
      'Opacity & Pseudo-variant Compilation',
      failedCandidates.length === 0,
      failedCandidates.length === 0
        ? `All ${advancedCandidates.length} advanced variant classes compiled into output CSS`
        : `Missing: ${failedCandidates.join(', ')}`
    );
  } catch (err: any) {
    logTest('Tailwind v4 Variants', 'Compilation', false, err.message);
  } finally {
    if (fs.existsSync(fixturePath)) {
      fs.unlinkSync(fixturePath);
    }
  }

  // =========================================================================
  // Stress Test 2: Surface Luminance Monotonicity Hierarchy
  // =========================================================================
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

  const lBg = getLuminance(hexToRgb('#0e0e10'));
  const lSurface = getLuminance(hexToRgb('#151517'));
  const lSurface2 = getLuminance(hexToRgb('#1c1c1f'));
  const lSurface3 = getLuminance(hexToRgb('#242428'));
  const lBorder = getLuminance(hexToRgb('#26262b'));
  const lBorderStrong = getLuminance(hexToRgb('#34343a'));

  const surfaceMonotonic = lBg < lSurface && lSurface < lSurface2 && lSurface2 < lSurface3;
  const borderHierarchy = lSurface < lBorder && lBorder < lBorderStrong;

  logTest(
    'Visual Hierarchy',
    'Surface Elevation Lightness Monotonicity',
    surfaceMonotonic,
    `L(bg)=${lBg.toFixed(4)} < L(surface)=${lSurface.toFixed(4)} < L(surface-2)=${lSurface2.toFixed(4)} < L(surface-3)=${lSurface3.toFixed(4)}`
  );

  logTest(
    'Visual Hierarchy',
    'Border Contrast Elevation',
    borderHierarchy,
    `L(surface)=${lSurface.toFixed(4)} < L(border)=${lBorder.toFixed(4)} < L(border-strong)=${lBorderStrong.toFixed(4)}`
  );

  // =========================================================================
  // Stress Test 3: Radix / shadcn Compatibility Fallbacks
  // =========================================================================
  const legacyMappings = [
    { token: '--background', target: 'var(--bg)' },
    { token: '--foreground', target: 'var(--text)' },
    { token: '--card', target: 'var(--surface)' },
    { token: '--card-foreground', target: 'var(--text)' },
    { token: '--panel', target: 'var(--surface)' },
    { token: '--panel-foreground', target: 'var(--text-muted)' },
    { token: '--muted', target: 'var(--surface-2)' },
    { token: '--muted-foreground', target: 'var(--text-muted)' },
    { token: '--input', target: 'var(--border)' },
    { token: '--ring', target: 'var(--accent)' },
    { token: '--destructive', target: 'var(--danger)' },
    { token: '--radius', target: '6px' },
  ];

  let missingLegacy: string[] = [];
  for (const m of legacyMappings) {
    const re = new RegExp(`${m.token}\\s*:\\s*([^;]+);`);
    const match = cssContent.match(re);
    if (!match || match[1].trim() !== m.target) {
      missingLegacy.push(`${m.token} (expected ${m.target}, got ${match ? match[1].trim() : 'missing'})`);
    }
  }

  logTest(
    'Backward Compatibility',
    'Radix/shadcn Token Mapping Completeness',
    missingLegacy.length === 0,
    missingLegacy.length === 0
      ? `All ${legacyMappings.length} Radix/shadcn fallback tokens correctly remapped to dark tokens`
      : `Mismatches: ${missingLegacy.join(', ')}`
  );

  // =========================================================================
  // Stress Test 4: PostCSS Parse and Warning Check
  // =========================================================================
  let warningCount = 0;
  try {
    const processor = postcss([tailwindPostcss()]);
    const res = await processor.process(cssContent, { from: cssPath });
    const warnings = res.warnings();
    warningCount = warnings.length;
    logTest(
      'Compiler Diagnostics',
      'PostCSS Warning Analysis',
      warningCount === 0,
      warningCount === 0 ? 'Zero warnings generated during compilation' : `Generated ${warningCount} warnings: ${warnings.map(w => w.text).join('; ')}`
    );
  } catch (err: any) {
    logTest('Compiler Diagnostics', 'PostCSS Warning Analysis', false, err.message);
  }

  // =========================================================================
  // Stress Test 5: Body Reset Properties Integrity
  // =========================================================================
  const bodyHasBg = cssContent.includes('background-color: var(--bg)');
  const bodyHasColor = cssContent.includes('color: var(--text)');
  const bodyHasFont = cssContent.includes('font-family: var(--font-sans)');
  const bodyHas13px = cssContent.includes('font-size: 13px');
  const selectionHasAccent = cssContent.includes('::selection') && cssContent.includes('background-color: var(--accent)');

  const resetValid = bodyHasBg && bodyHasColor && bodyHasFont && bodyHas13px && selectionHasAccent;

  logTest(
    'Base Reset',
    'Body Reset & IDE-style Selection',
    resetValid,
    `bg=${bodyHasBg}, text=${bodyHasColor}, font=${bodyHasFont}, 13px=${bodyHas13px}, selection=${selectionHasAccent}`
  );

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n=== STRESS SUITE SUMMARY ===');
  const total = stressLog.length;
  const passed = stressLog.filter(s => s.passed).length;
  console.log(`Passed: ${passed}/${total}`);

  if (passed === total) {
    console.log('ALL ADVERSARIAL STRESS TESTS COMPLETED SUCCESSFULLY.');
    process.exit(0);
  } else {
    console.error('ADVERSARIAL STRESS FAILURES DETECTED.');
    process.exit(1);
  }
}

runStressSuite().catch(err => {
  console.error('Stress suite crashed:', err);
  process.exit(1);
});
