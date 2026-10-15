# VANHSUB RC evidence —2026-10-15/16

Latest release decision:[acceptance](../../CODEX_RELEASE_CANDIDATE_ACCEPTANCE.md). Evidence folder retains the phase start date; local acceptance continued on2026-10-16. No provider-live or clean-install success is inferred from this folder.

## Final acceptance files

- `build-workspace.json`: own clean-dependency snapshot source hashes. Final source is compared by `source-and-package-integrity.json`; copied harnesses may change after the application build, so application/config scope is explicit.
- `clean-install.log`, `build-results.json`: own npm ci and first full production build. These are not Windows installer execution. First build temporarily included a guardian prototype; that prototype is absent from final code/package.
- `production-build-final.log`, `build-final-result.json`: authoritative final complete build. Intermediate failure/build artifacts are not final PASS evidence.
- `release-artifact.json`: final installer size/SHA256/Authenticode. NotSigned, not installed on dev host as a clean-host substitute.
- `typecheck-final.json`: final standalone main/renderer typecheck result.
- `source-and-package-integrity.json`, `package-module-presence-clean.json`: source/config match, seven runtime module presence, native CLI smoke, excluded JS wrapper/build packages and excluded guardian prototype.
- `regression-final.json`:45offline/loopback suites, child120s limit. Per-suite logs include expected negative-case messages. Actual local HTTP/native tests are still not provider live.
- `runtime-packaged.json`: final scoped20checks on actual EXE. Uses synthetic keys/extension peer and actual Electron APIs, protocol2 mutual proofs and DPAPI-encrypted pairing key. No unexpected page/console error; expected injected-script CSP violation is retained separately.
- `runtime-security-editor180.json`:180s/36samples after editor/security workflow, before final TTS/canonical-alias source changes. Editor code is unchanged; do not call it a final all-source runtime certification. Final30s smoke is separate.
- `runtime-large-editor.png`, `runtime-packaged-settings.png`: final screenshots. Editor shows full1,000line project,100mounted rows/page, persisted edits. One window size does not certify every UI state.
- `job-runtime.json`: actual packaged Whisper with isolated LOCALAPPDATA/cache/existing model; no model download. Local HTTP synthetic TTS/translation provider, controlled timeout/reset, close/restart/checkpoint/concurrency/Unicode export and main kernel/resource/listener samples. Translation fetch is redirected to loopback and outside endpoints are disabled by the test adapter. Audio is a synthetic tone, not voice-quality evidence.
- `hard-crash-render.json`: SIGKILL of **actual main PID** during active1080pFFmpeg, observed worker lifetime, last-good output hash/pointer/restart and native render CPU/RAM sample. CPU is normalized to machine logical processors over the measured interval, not full-job peak/average.
- `tts-cancel-before.log`, `tts-cancel-after.log`: actual HTTP reset cancellation regression. Before: retries/error; after: one cancelled request, old audio retained, rerun succeeds. Voice-sample metadata is an empty headless fixture; HTTP/client/native audio processing are real.
- `performance-summary.json`, `idle-soak600.json`: distinct editor/final-smoke/job/idle measurements with limits. Process HandleCount is not a per-file handle inventory; counters do not prove no leaks. The soak uses a private fixed artifact copy through0052135, with bridge disabled before auth-only protocol2 changes; later rebuilds cannot mutate it. It does not certify protocol2 bridge idle lifecycle.
- `dependency-production.json` vs `dependency-full.json`: separate runtime graph and full build-toolchain scans. Electron's devDependency classification does not make its shipped runtime risk disappear: its version is independently recorded and patched. `dependency-full-before-tooling-patch.json` retains the earlier Critical finding.
- `dependency-reclassification.json`: nodejs-whisper moved to build-only with no version change. `targeted-dependency-changes.json`: direct Electron/Next and corresponding platform/Sharp patch changes, not a blanket upgrade.
- `clean-windows-environment.json`, `flow-live-status.json`: explicit BLOCKED/NOT TESTED gates.
- `process-after-close.json`: observed final app/native process exit check; no claim about every process type after every possible crash.

- `extension-auth-race.json`: source/VM reproduction on b9efaab and fix a3082e3; commands arriving during proof verification are retained, while cancellation is not blocked behind a pending handler.
- `git-status-verified.json`: re-fetched integration ancestry/main preservation and original untracked data preserved.

Signature finalization initially hit inherited PowerShell module lookup; explicit loading of the built-in Windows security module succeeded. Final installer status is NotSigned; this was a harness module-resolution issue.

## Preserved failures and corrections

- `runtime-harness-selector-failure.json`: two Chrome buttons matched a broad regex. Fixed by exact accessible name, not `.first()`.
- `job-runtime-initial-fixture-failure.json`: TaskStore.create omits the requested MP3 pointer. Corrected fixture establishes/checks the pointer through update before testing app close. Not classified as an application data-loss finding.
- `hard-crash-launcher-harness-failure.json`: Playwright launcher PID was killed while Electron main remained alive. Corrected harness queries process.pid inside Electron. `hard-crash-correct-main-baseline.json` also passes, disproving the earlier orphan conclusion. Guardian prototype was discarded and does not ship.
- `build-active-artifact-failure.log`, `idle-soak-invalidated.json`: attempted rebuild of an active artifact failed Windows DLL unlink. This run is not soak PASS. Rebuild now refuses an active owned EXE, and final soak runs from an artifact copy.

Logs have trailing whitespace/blank EOF normalized for Git; diagnostic text/result codes are retained. Security values are explicit synthetic fixtures; no personal cookies/API keys, models, installers, node_modules or HAR are committed. Test profiles/build folders remain separate for review. Windows VM/NSIS install-uninstall, true host internet loss, live Flow/cloud providers and multi-hour/all-job acceptance are not claimed.
