# Handoff Report: Milestone 1 IPC Bridge Architecture

**Agent**: IPC Bridge Explorer (`explorer_m1_ipc`)  
**Assigned Working Directory**: `d:\DEAN\DEAN\VANHSUB\.agents\explorer_m1_ipc`  
**Milestone**: Milestone 1 (Foundation, Dedicated Store & IPC Bridge)  
**Deliverable File**: `d:\DEAN\DEAN\VANHSUB\.agents\explorer_m1_ipc\m1_ipc_plan.md`  

---

## 1. Observation

1. **Existing IPC Pattern in Main Process**:
   - In `main/main.ts`, modular IPC registration is already implemented for the workflow engine:
     - Line 28: `import { registerWorkflowIpc } from './workflow/ipc'`
     - Line 231: `registerWorkflowIpc()`
   - In `main/workflow/ipc.ts` (lines 13–113), `export function registerWorkflowIpc(): void` registers all `workflow:*` and `bible:*` handlers using `ipcMain.handle` and pushes streaming events via `event.sender.send('workflow:node-event', nodeEvent)`.
   - In `main/main.ts` (lines 489–502), the legacy `settings:get` and `settings:set` handlers interact with `SettingsStore` (`vanhsub-settings.json`), validating against an array of known keys `SETTING_KEYS`.

2. **Existing Preload Structure**:
   - In `main/preload.ts` (lines 1–196), `vanhsub` is constructed as a flat object exposing categorized APIs (`tasks`, `settings`, `ai`, `translate`, `export`, `ocr`, `tts`, `dubbing`, `tiktokTts`, `veo`, `models`, `dialog`, `downloader`, `files`, `logs`, `workflow`, `bible`).
   - Line 177 is the end of the `bible` entry; line 178 closes the `vanhsub` object:
     ```typescript
     176:     deleteScene: (id: string) => ipcRenderer.invoke('bible:deleteScene', id),
     177:   },
     178: }
     ```
   - Line 194 exposes it to the browser context: `contextBridge.exposeInMainWorld('vanhsub', vanhsub)`.
   - `preload.ts` does not import domain types from `main/` or `renderer/` (uses `any` parameter annotations in the proxy bridge), avoiding bundler and sandbox module resolution issues.

3. **Existing Renderer Type Declarations**:
   - In `renderer/types/electron.d.ts` (lines 1–393):
     - Line 1: `import type { Task, CreateTaskInput } from './task';`
     - Line 155: `export interface VanhsubAPI {`
     - Lines 374–381 define `bible`.
     - Line 382 is the closing bracket of `VanhsubAPI`:
       ```typescript
       381:   };
       382: }
       ```
     - Line 385–392 declares `interface Window { vanhsub: VanhsubAPI; ... }`.

4. **Technical Specification Requirements**:
   - `AI_STUDIO_SPEC.md` (§5.1 & §5.2) specifies the exact schema for `AiStudioConfig` (5 sub-trees: `llm`, `voice`, `flowEngine`, `rendering`, `subtitles`).
   - `PROJECT.md` (§2) specifies 10 request-response IPC channels and 1 push event:
     - M1: `aiStudio:config:get`, `aiStudio:config:set`, `aiStudio:config:reset`.
     - M2: `aiStudio:pipeline:start`, `aiStudio:pipeline:resume`, `aiStudio:pipeline:cancel`, `aiStudio:pipeline:getState`, `aiStudio:step:renderSingleLineVoice`, `aiStudio:step:regenerateSceneAsset`, `aiStudio:step:renderVideo`.
     - Push Event: `aiStudio:pipeline:progress`.

---

## 2. Logic Chain

1. **Decoupling and Zero Side-Effect Architecture**:
   - By creating a dedicated router module `main/ai-studio/ipc.ts` exporting `registerAiStudioIpc()`, we follow the exact pattern of `main/workflow/ipc.ts` (Obs 1).
   - In `main/main.ts`, adding `import { registerAiStudioIpc } from './ai-studio/ipc'` at line 29 and `registerAiStudioIpc()` at line 232 encapsulates all AI Studio handlers without modifying any existing handlers (`settingsStore`, `tasks`, etc.) (Obs 1).

2. **Elimination of Reload / Multiple Registration Crashes**:
   - Electron's `ipcMain.handle` throws a fatal error if called more than once for the same channel.
   - Introducing a `safeHandle(channel, handler)` helper function inside `main/ai-studio/ipc.ts` that executes `ipcMain.removeHandler(channel)` before `ipcMain.handle(channel, handler)` guarantees idempotent registration across developer hot-reloads and test suites.

3. **Milestone 2 Delegate Pattern**:
   - Milestone 1 only implements store persistence and config management. Pipeline execution (Milestone 2) is not yet active.
   - However, frontend components and IPC typings require that the channel names and signatures exist.
   - By implementing an `IAiStudioPipelineEngineDelegate` interface and setter `setAiStudioPipelineEngine(delegate)`, all Milestone 2 handlers (`pipeline:*`, `step:*`) can be registered in M1. If called without a delegate, they cleanly throw `[M2-STUB]` errors or return `null`. When Milestone 2 implements `AiStudioPipelineEngine`, it attaches itself via this setter without touching `ipc.ts` or `main.ts`.

4. **Renderer Typings and Preload Interoperability**:
   - In `main/preload.ts` (Obs 2), `aiStudio` is appended to `vanhsub` exposing:
     - `getConfig()`, `updateConfig(updates)`, `resetConfig()`
     - Convenient aliases: `get()`, `set(updates)`, `reset()`
     - Pipeline stubs: `startPipeline`, `resumePipeline`, `cancelPipeline`, `getPipelineState`, `renderSingleLineVoice`, `regenerateSceneAsset`, `renderVideo`
     - Push listener: `onPipelineProgress(callback)` returning an unsubscribe callback.
   - In `renderer/types/electron.d.ts` (Obs 3), `VanhsubAPI` is extended with typed signatures matching `AiStudioConfig` and pipeline types, giving the frontend 100% strict type safety.

---

## 3. Caveats

1. **Milestone 2 Pipeline Execution**:
   - The pipeline channels (`aiStudio:pipeline:*` and `aiStudio:step:*`) are registered as forward-compatible stubs. They will throw descriptive runtime errors (`[M2-STUB] ... is scheduled for Milestone 2`) until `setAiStudioPipelineEngine()` is called by Milestone 2.
2. **Type Import Ordering in Renderer**:
   - `renderer/types/electron.d.ts` imports types from `./aiStudio`. The companion file `renderer/types/aiStudio.ts` (assigned to `explorer_m1_renderer`) must be created before running `npx tsc --noEmit` to ensure TypeScript compilation passes.

---

## 4. Conclusion

A complete, line-by-line implementation blueprint has been generated and validated in `d:\DEAN\DEAN\VANHSUB\.agents\explorer_m1_ipc\m1_ipc_plan.md`.

### Core Deliverables Summary:
1. `main/ai-studio/ipc.ts`: Complete IPC router with 10 channels, safe re-registration, payload validation, and the Milestone 2 Delegate pattern.
2. `main/main.ts`: Exact insertion points at line 29 (`import { registerAiStudioIpc }`) and line 232 (`registerAiStudioIpc()`). Zero touches to existing code.
3. `main/preload.ts`: Exact extension of `vanhsub.aiStudio` with both canonical methods and aliases, plus unsubscribe lifecycle for `onPipelineProgress`.
4. `renderer/types/electron.d.ts`: Exact type extension of `VanhsubAPI` with 100% TypeScript type safety.

---

## 5. Verification Method

1. **File Integrity Verification**:
   Inspect the blueprint file:
   - `d:\DEAN\DEAN\VANHSUB\.agents\explorer_m1_ipc\m1_ipc_plan.md`
2. **TypeScript Compilation Check (Post-Implementation)**:
   Once the files are created by the implementation agents:
   ```powershell
   npx tsc --noEmit
   ```
   *Expected result*: Exit code 0 with 0 errors across both `main/` and `renderer/`.
3. **IPC Invocation Test (Automated Headless Simulation)**:
   In test scripts (e.g. `scripts/test_ai_studio_pipeline.ts`), verify:
   - Calling handler `aiStudio:config:get` returns `AiStudioConfig` with default `llm.provider === 'deepseek'`.
   - Calling handler `aiStudio:config:set` with `{ rendering: { resolution: '720p' } }` returns updated config with `resolution === '720p'`.
   - Calling handler `aiStudio:config:reset` resets `rendering.resolution` back to `'1080p'`.
   - Calling handler `aiStudio:pipeline:start` throws `[M2-STUB]`.
