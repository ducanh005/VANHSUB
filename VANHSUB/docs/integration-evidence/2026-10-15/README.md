# Integration evidence —2026-10-15

Current application source: branch `codex/integration-stabilization-20261015`, based on `origin/main=899088f`. These are development-host integration results, not clean Windows or provider-live certification. See [integration report](../../CODEX_INTEGRATION_REPORT.md) and [test matrix](../../CODEX_TEST_MATRIX.md).

## Authoritative final evidence

- `source-branch-graph.txt`, `retained-origin-commits.txt`: original divergent histories and27 remote commits retained by ancestry. Agent attribution is not inferred from author names.
- `build-workspace.json`: copied source/config SHA256 manifest; clean dependencies belong to an isolated build directory, not the shared node_modules junction. Extension fixture files were also synchronized.
- `source-integrity.json`:248 application source/config files matched final working source. Test harnesses/evidence are outside the packaged app manifest.
- `clean-install.log`, `build-results.json`, `production-build.log`: own npm ci + full standard production build (Whisper CMake/Next Turbopack/main/preload/NSIS).
- `build-final-result.json`, `production-build-final.log`: full rebuild after the final project-start guard source edit.
- `typecheck-final.json`: final main and renderer typechecks exit0 against own installed dependencies.
- `release-artifact.json`: final installer size/SHA256/NotSigned. Installer was built; it was not installed on a clean Windows/VM.
- `package-module-presence-clean.json`: final archive7 module presence and3 native CLI help/version checks.
- `regression-final.json`:38offline suites PASS; includes explicit retry metadata for fixture synchronization and final project-guard tests. Per-suite `.log` files retain negative-case messages. A logged expected error is not a suite failure when assertions verify it.
- `runtime-packaged.json`: final actual unpacked Electron EXE, isolated profile/bridge disabled,14scoped reported checks, no errors/pageErrors. Includes real IPC foreign-window deny, CSP enforcement, DPAPI synthetic key encryption, task/video fixture/SRT/project save/restart, visible editor1.000 lines and6 routes.
- `runtime-large-editor.png`, `runtime-packaged-settings.png`: final UI screenshots. Editor screenshot was visually inspected. One window size is not full responsive/UI acceptance.
- `real-asr.json`: actual TaskRunner and packaged Whisper CLI used an already existing tiny model/public JFK sample; no model download or provider request. Synthetic long audio exercises actual native cancellation. Test records1 subtitle block and2 native children exited. Model copy existed only in owned build dependencies and was removed before final packaging; original cached model remains untouched.
- `real-export-cancel.json`: actual FFmpeg child starts before cancellation; exit/partial cleanup/last-good artifact preservation verified.
- `performance-summary.json`: sampled totals across app processes. Final large editor30s/6 samples versus pre-final-guard idle180s/36 samples are separate measurements. Values are sampled working sets/CPU, not lifetime peaks/throughput/soak certification.
- `process-after-close.json`:4sampled final runtime PIDs absent after ordinary close. No claim about every active-job app quit path.
- `dependency-audit.json`: npm audit production5 High/0 Critical after bounded updates,5 affected packages in one remaining braces chain. No blanket dependency upgrades/downgrades.

## Preserved intermediate failures

`regression.json` and `regression-before-fixture-sync.json` preserve the initial snapshot run with2failures because extension/background.js had not been copied. Fixture synchronization and targeted reruns are reflected in the final result; tests were not removed.

`runtime-harness-first-failure.json` records a harness use of require inside Electron43 app.evaluate; changed to process.getBuiltinModule. `runtime-large-selector-harness-failure.json` records hidden select ambiguity; changed to visible selector and a real wait for the last subtitle, not a fallback `.first()`.

The180s run was before the last project-start guard; final full build/runtime was rerun afterward with the large-editor check. Prior audit/junction-build failures remain in `../../audit-evidence/2026-10-15` and are not relabeled PASS.

Build logs have trailing spaces normalized for Git whitespace checks; diagnostic text and result codes are retained. Local machine paths identify test-owned folders, not portable installation prerequisites. Credentials used by security fixtures are explicit synthetic strings. No personal cookies/API keys, HAR, models, node_modules, binaries or generated installers are committed here.

## Reproduction scope

`scripts/integration_build.cjs` creates a new isolated same-drive directory and runs a clean install/full build; its local audit destination is machine-specific. `scripts/audit_regression.cjs` accepts `VANHSUB_AUDIT_EVIDENCE_DIR` and an offline allowlist. `scripts/audit_runtime_electron.cjs` accepts the owned build/evidence paths and dedicated audit profile; do not point it at personal userData. Real ASR requires an existing test model/sample and a built CLI; it does not auto-download. Do not run old live-generation runners as part of this allowlist.

Live Provider PASS: **none**. Flow generation sent by this audit: **0**. Clean Windows install, multi-hour soak, all-job quit/kill/recovery and full provider pipelines: **NOT TESTED/BLOCKED**, as detailed in the reports.
