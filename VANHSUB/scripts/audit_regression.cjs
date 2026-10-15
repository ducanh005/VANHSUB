// Offline suites only. A successful mocked provider is never a live E2E result.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'docs/audit-evidence/2026-10-15');
// Explicit allowlist: no browser launch/attachment, provider generation or production runner.
const suites = ['tests/test_media_validator_ffmpeg_decoding.ts', 'tests/test_video_processor_concat.ts', 'tests/test_timeline_export_duration_guard.ts', 'tests/test_project_media_isolation_regression.ts', 'tests/test_tts_timing_adaptation.ts', 'tests/test_flow_project_isolation.ts', 'tests/test_full_audit_flow_tabs.ts'];
suites.push('tests/test_srt_ocr_normalizer_and_translation.ts', 'tests/test_full_audit_security.ts', 'tests/test_full_audit_data_integrity.ts', 'tests/test_full_audit_episode_storage.ts', 'tests/test_full_audit_session_jobs.ts', 'tests/test_ai_studio_script_evaluation.ts', 'tests/test_ai_studio_script_refinement.ts', 'tests/test_full_audit_script_artifacts.ts');
const results = [];
for (const suite of suites) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-regression-'));
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, suite), '--offline'], {
    cwd: root, encoding: 'utf8', timeout: 120000, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, VANHSUB_AI_STUDIO_DIR: path.join(temporary, 'studio'), VANHSUB_TASKS_DIR: path.join(temporary, 'tasks'), VANHSUB_SETTINGS_DIR: path.join(temporary, 'settings') },
  });
  const name = path.basename(suite, '.ts');
  fs.writeFileSync(path.join(evidence, `${name}.log`), (result.stdout || '') + (result.stderr || ''));
  const record = { suite, status: result.status === 0 ? 'PASS' : 'FAIL', exitCode: result.status, error: result.error?.message, elapsedMs: Date.now() - started, classification: 'OFFLINE_UNIT_OR_INTEGRATION' };
  results.push(record); console.log(JSON.stringify(record));
  fs.writeFileSync(path.join(evidence, 'regression.json'), JSON.stringify(results, null, 2));
  // Preserve test profiles for diagnosis; never remove an unverified shared path.
}
if (results.some(result => result.status !== 'PASS')) process.exitCode = 1;
