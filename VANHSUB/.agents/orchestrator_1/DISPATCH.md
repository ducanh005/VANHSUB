# Dispatch Instructions

## 2026-09-16T08:11:01Z

You are the Project Orchestrator for the Google Flow automation audit and refactor task.

Working directory: d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_1
Project root: d:\DEAN\DEAN\VANHSUB
Original user request: d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md

CRITICAL CONSTRAINTS:
- Integrity mode: development (Read-Only Audit: Tuyệt đối KHÔNG sửa code, KHÔNG làm thay đổi git status).
- Maintain progress.md and BRIEFING.md in your working directory d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_1.
- You must organize and dispatch tasks to specialists according to the 4 tracks requested:
  1. UI & DOM Locator Specialist: FlowElementFinder.ts, FlowElementSpecs.ts, dispatcher files, absolute coordinates vs DOM vs OCR/CDP stats, scoping, short-text, scoring, overlay detector.
  2. Session, Window & Concurrency Specialist: GoogleVeoSessionManager.ts lobbyWindow lifecycle, GoogleFlowBrowserMutex, canvas cleanup, race condition/deadlock, offscreen vs onscreen, capturePage diagnostic.
  3. Error, Retry & Recovery Specialist: FlowErrorClassifier.ts, FlowRecoveryManager.ts, FlowRetryManager.ts, Idempotency Jump, unknown state, screenshot / HTML dump.
  4. IPC & Architecture Lead Agent: IPC entry points (ipcMain.handle, ipcRenderer.invoke), synthesis of findings into final 9-section report (A through I).
- Final deliverable: A complete, rigorous, professional 9-section report (A to I) matching all specifications in d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md.
- When all work is done and verified, report completion back to the Sentinel.
