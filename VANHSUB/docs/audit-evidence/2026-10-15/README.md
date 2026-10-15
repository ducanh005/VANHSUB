# Audit evidence — 2026-10-15

Audit baseline: local `df9d768`. Source fix commits: `9efb10b`, `31204ba`, `b12aaa0`, `97479c0`.

| Files | Meaning |
|---|---|
| `regression.json`, `test_*.log` | Final offline allowlist15suites, all exit0. Mock providers are not live acceptance. Negative-case error messages in logs are expected assertions. |
| `build-package.log`, `build-webpack.log` | Failed standard build in C worktree with D dependency junction. Preserve failures. |
| `build-same-drive-*.log`, `build-workspace.json` | Successful static renderer / main bundles in owned same-drive snapshot; SHA256 copied source/config files. |
| `runtime-ui.json`, `runtime-settings.png` | Actual Electron/static production renderer smoke, isolated profile,6routes, IPC/restart,60s idle metrics. |
| `package-module-presence.json`, `runtime-packaged-junction-failure.json` | Initial junction-based package missing conf/platform binaries, launch timeout; do not count builder exit0 as runnable package. |
| `package-clean-install.log`, `package-clean-build.log`, `package-clean-result.json` | Production dependencies installed into separate owned folder using unchanged lockfile; ignore lifecycle scripts, explicit Electron43.4.1; reuse compiled whisper only in that folder. Packaging exit0. |
| `package-module-presence-clean.json` | Modules present in clean archive; FFmpeg/FFprobe version and whisper help exit0. |
| `runtime-packaged.json`, `runtime-packaged-settings.png` | Actual clean-dependency Windows executable,6routes, IPC/restart smoke, no provider calls. |
| `dependency-audit.json` | npm production audit:9high/0critical; exit1 is vulnerability result. No dependency upgrades performed. |
| `flow-connection.json` | Real extension1.0.6 handshake successful; no CDP9224; zero tab/auth/generation commands. User subsequently chose to leave live generation uncompleted. |

Main and renderer `tsc --noEmit` both exited0 in terminal after application patches. `git diff --check` passed. These terminal checks did not emit log files. Actual executable Authenticode inspection returned `NotSigned`; signing-related builder log lines are not proof of a trusted signature.

No full installer/clean-machine validation, multi-hour soak or paid-provider E2E was performed. Audit-owned build/package/profile folders are retained for review, outside versioned source. Paths in JSON identify this host and are not portable build configuration. Never use raw prior HAR or personal credentials as committed evidence.

Committed text logs have trailing whitespace and extra blank EOF lines normalized; result messages are retained.
