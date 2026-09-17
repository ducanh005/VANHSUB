# BRIEFING — 2026-09-17T06:27:30Z

## Mission
Investigate the Electron main process architecture of Vanhsub to inform isolated AI Video Studio backend implementation.

## 🔒 My Identity
- Archetype: explorer
- Roles: Backend Architecture Explorer
- Working directory: d:\DEAN\DEAN\VANHSUB\.agents\explorer_backend_survey
- Original parent: 4178817f-9fd4-446c-af6c-ef59368c4a1e
- Milestone: Backend Architecture Survey & Isolation Plan

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Produce backend_survey.md and handoff.md in working directory
- Survey main layout, IPC patterns, stores, flow engine, TTS/Whisper/FFmpeg, compilation/tests

## Current Parent
- Conversation ID: 4178817f-9fd4-446c-af6c-ef59368c4a1e
- Updated: 2026-09-17T06:34:00Z

## Investigation State
- **Explored paths**: `main/main.ts`, `main/preload.ts`, `nextron.config.js`, `tsconfig.json`, `package.json`, `main/store/settingsStore.ts`, `taskStore.ts`, `bibleStore.ts`, `renderer/lib/store/workflowStore.ts`, `main/workflow/flow-engine/*`, `main/veo/*`, `main/tts-providers/edge/*`, `main/asr/*`, `main/render/*`, `scripts/*`.
- **Key findings**:
  1. Main Process bundled via Webpack (Nextron) with native externals. Protocol `vanhmedia` supports range streaming for media preview.
  2. IPC registration is clean and modular (`main/workflow/ipc.ts` router pattern can be replicated for `main/ai-studio/ipc.ts`).
  3. Store isolation can be achieved 100% via `main/store/aiStudioStore.ts` storing to `vanhsub-ai-studio.json` with DPAPI `safeStorage` encryption and lazy fallback for test scripts.
  4. Google Flow requires active Google session in `lobbyWindow`; dual mode with FFmpeg synthetic asset fallback is essential so Step 6 never breaks when unauthenticated or during automated testing.
  5. `msedge-tts` natively supports word-boundary/sentence-boundary metadata, allowing Step 3 & 4 to execute together with zero Whisper overhead.
  6. FFmpeg binary resolution with `.replace('app.asar', 'app.asar.unpacked')` and Windows path escaping are established in `videoRenderer.ts`.
  7. `npx tsc --noEmit` passes with 0 errors. Standalone tests run via `npx tsx scripts/*.ts`.
- **Unexplored areas**: None within backend survey scope.

## Key Decisions Made
- Architecture blueprint finalized in `backend_survey.md`.
- Handoff report finalized in `handoff.md`.

## Artifact Index
- d:\DEAN\DEAN\VANHSUB\.agents\explorer_backend_survey\progress.md — Liveness & progress tracker
- d:\DEAN\DEAN\VANHSUB\.agents\explorer_backend_survey\backend_survey.md — Comprehensive backend survey report
- d:\DEAN\DEAN\VANHSUB\.agents\explorer_backend_survey\handoff.md — Handoff report
