# BRIEFING — 2026-09-17T16:10:00+07:00

## Mission
Khảo sát Kiến trúc Electron Main Process: cấu trúc main/electron/preload/IPC handlers, các session manager hiện có (GoogleVeoSessionManager), đề xuất kiến trúc và vị trí cho ChatGptWebSessionManager & ChatGptAutomationEngine, IPC handlers, preload/renderer bridge.

## 🔒 My Identity
- Archetype: explorer
- Roles: survey, architectural investigation, read-only analysis
- Working directory: d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_3_survey_main_arch
- Original parent: da011580-7822-4f08-aabc-fa08fc8ef25d
- Milestone: Survey Phase - Electron Main Process Architecture

## 🔒 Key Constraints
- Read-only investigation — do NOT implement or modify project source code
- Strictly survey, analyze, produce analysis.md and handoff.md
- Communicate results via send_message to parent

## Current Parent
- Conversation ID: da011580-7822-4f08-aabc-fa08fc8ef25d
- Updated: 2026-09-17T16:10:00+07:00

## Investigation State
- **Explored paths**:
  - `main/main.ts` (Application lifecycle, window initialization, IPC registration)
  - `main/preload.ts` (ContextBridge exposure & window.vanhsub)
  - `main/veo/GoogleVeoSessionManager.ts` (Partition persistence, offscreen coordinate positioning, anti-detection, cookies, health probe, watchdog)
  - `main/ai-studio/` (`AiStudioPipelineEngine.ts`, `ipc.ts`, `types.ts`, `services/AiStudioLlmService.ts`)
  - `main/store/` (`settingsStore.ts`, `aiStudioStore.ts` - safeStorage DPAPI encryption)
  - `renderer/types/electron.d.ts` (TypeScript definitions for window.vanhsub API)
- **Key findings**:
  - `GoogleVeoSessionManager` uses `persist:google_veo` with two-tier persistence (partition cookies + DPAPI encrypted SettingsStore).
  - Offscreen window is implemented via coordinate positioning (`x: -3000, y: -3000`) with `backgroundThrottling: false` rather than `show: false`, preserving full Chromium DOM layout and timer execution.
  - Live Window toggle is done via `setPosition(100, 100); show(); focus();`.
  - Anti-bot: strip `sec-ch-ua` headers and remove `navigator.webdriver` on `dom-ready`.
  - Recommended file layout: `main/chatgpt/` (`ChatGptWebSessionManager.ts`, `ChatGptAutomationEngine.ts`, `ipc.ts`, `types.ts`).
  - Preload bridge: add `vanhsub.chatgptWeb` in `preload.ts` and `ChatGptWebAPI` in `electron.d.ts`.
  - AI Studio integration: extend `AiStudioLlmConfig` with `provider: 'chatgpt_web'`, `chatgptWebMode: 'offscreen' | 'visible'`, and route Stage 2 to `ChatGptAutomationEngine`.
- **Unexplored areas**: None. All survey objectives met.

## Key Decisions Made
- Confirmed dedicated `main/chatgpt/` module directory structure.
- Documented complete findings in `analysis.md` and `handoff.md`.

## Artifact Index
- DISPATCH.md — Incoming prompt and requirements
- BRIEFING.md — Persistent situational awareness
- progress.md — Heartbeat and task tracking
- analysis.md — Detailed survey analysis report
- handoff.md — 5-component handoff report for orchestrator
