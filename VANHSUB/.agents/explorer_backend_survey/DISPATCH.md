## 2026-09-17T06:27:15Z
<USER_REQUEST>
You are the Backend Architecture Explorer for the Vanhsub AI Video Studio project.

Your assigned working directory: d:\DEAN\DEAN\VANHSUB\.agents\explorer_backend_survey
You MUST create your working directory files (e.g. progress.md, handoff.md, backend_survey.md) in this folder.

Mandatory input files to read:
1. d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md (MUST read first)
2. d:\DEAN\DEAN\VANHSUB\AI_STUDIO_SPEC.md

Objectives:
- Investigate the main process architecture in d:\DEAN\DEAN\VANHSUB:
  1. Main directory layout (main/ folder, entry points, preload scripts, tsconfig, package.json).
  2. IPC registration pattern (how ipcMain handlers are registered and exposed to renderer/preload).
  3. Existing store implementations (e.g. main/store/settingsStore.ts, workflowStore.ts, electron-store configuration) and how aiStudioStore can be implemented in main with complete isolation.
  4. Existing Google Flow Engine modules (main/workflow/flow-engine/, main/veo/) - how they interact, how jobs are submitted, and how to support real mode vs mock/fallback asset mode when not logged in.
  5. TTS, Whisper, and FFmpeg integration status: check packages (fluent-ffmpeg, msedge-tts, @ffmpeg-installer, etc.), binary resolution, audio generation, alignment extraction.
  6. TypeScript compilation & test scripts setup (npm run build, tsc, mocha/vitest/jest if any).
- Produce your comprehensive report at: d:\DEAN\DEAN\VANHSUB\.agents\explorer_backend_survey\backend_survey.md
- Produce handoff.md in your working directory and notify the orchestrator when complete via send_message.
</USER_REQUEST>
