/**
 * tests/run_all_automation_tests.ts
 *
 * Direct, robust batch runner for all 16 automated browser & workflow suites.
 * Uses direct Node invocation without npx wrapper issues on Windows.
 */

import { spawnSync } from 'child_process';
import path from 'path';

const SUITES = [
  'tests/test_browser_tab_isolation_and_correlation.ts',
  'tests/test_browser_automation_adapter.ts',
  'tests/test_adversarial_m1_process_manager_challenger.ts',
  'tests/test_adversarial_m1_challenger2_adapter.ts',
  'tests/test_ui_fallback_timeout_decoupling.ts',
  'tests/test_antibot_state_machine_idempotency.ts',
  'tests/test_visual_provider_router_integrity.ts',
  'tests/test_final_integration_and_real_world_validation.ts',
  'tests/test_live_aistudio_visual_pipeline.ts',
  'tests/test_real_browser_hardening_and_safeguards.ts',
  'tests/test_adversarial_reviewer_r1_unusual_activity.ts',
  'tests/test_adversarial_reviewer_r2_dual_engine.ts',
  'tests/test_adversarial_reviewer_r3_stress.ts',
  'tests/test_flow_response_observer.ts',
  'tests/test_flow_project_isolation.ts',
  'tests/test_direct_ui_adaptive_mode.ts',
];

const tsxCli = path.resolve(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

console.log('\n================================================================');
console.log(`🚀 RUNNING FULL AUTOMATED REGRESSION BATTERY (${SUITES.length} SUITES)`);
console.log('================================================================\n');

let suitesPassed = 0;
let suitesFailed = 0;
let totalTestsCount = 0;

for (const suite of SUITES) {
  const suitePath = path.resolve(__dirname, '..', suite);
  const res = spawnSync(process.execPath, [tsxCli, suitePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  if (res.status === 0) {
    suitesPassed++;
    const out = res.stdout || '';
    const match =
      out.match(/(\d+)\/(\d+)\s+TESTS?\s+PASSED/i) ||
      out.match(/Passed:\s*(\d+)/i) ||
      out.match(/(\d+)\s+tests passed/i);
    const count = match ? parseInt(match[1]) : 1;
    totalTestsCount += count;
    console.log(`  ✅ [PASS] ${suite.padEnd(55)} (${count} tests)`);
  } else {
    suitesFailed++;
    console.error(`  ❌ [FAIL] ${suite}`);
    if (res.stderr) console.error(res.stderr.slice(0, 500));
    if (res.stdout) console.error(res.stdout.slice(0, 500));
  }
}

console.log('\n================================================================');
console.log(`📊 FINAL REGRESSION SUMMARY:`);
console.log(`   Suites: ${suitesPassed}/${SUITES.length} PASSED`);
console.log(`   Individual Tests: ${totalTestsCount} PASSED`);
console.log('================================================================\n');

if (suitesFailed > 0) {
  process.exit(1);
}
