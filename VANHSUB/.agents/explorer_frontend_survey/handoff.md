# Handoff Report: Frontend Architecture Survey for Vanhsub AI Video Studio

**Working Directory:** `d:\DEAN\DEAN\VANHSUB\.agents\explorer_frontend_survey`  
**Target File Generated:** `d:\DEAN\DEAN\VANHSUB\.agents\explorer_frontend_survey\frontend_survey.md`  
**Role:** Frontend Architecture Explorer  
**Recipient:** Orchestrator (`4178817f-9fd4-446c-af6c-ef59368c4a1e`)  
**Timestamp:** 2026-09-17T13:32:00+07:00  

---

## 1. Observation

1. **Routing & Single-Page Architecture**:
   - `renderer/pages/home.tsx` is the primary application container. It uses Next.js Pages router (`output: 'export'`, `trailingSlash: true` in `renderer/next.config.js`).
   - Line 82 in `renderer/pages/home.tsx`: `const [activeTab, setActiveTab] = useState('home');`.
   - Lines 613-656 in `renderer/pages/home.tsx`: All primary view components (`WorkflowCanvas`, `SubtitleEditor`, `TTSPage`, `ExportPage`, `SettingsPage`, `ASRWorkspace`, and home task list) are permanently mounted in the DOM and toggled via CSS `display`:
     ```tsx
     <div className={activeTab === 'workflow' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
       <WorkflowCanvas ... />
     </div>
     ```
   - Quoting comment at line 610-612 in `renderer/pages/home.tsx`:
     > "Các tab luôn mounted, chỉ ẩn bằng CSS — giữ nguyên trạng thái (audio đang nghe thử, panel mở, dữ liệu đã tải) khi chuyển tab"

2. **Sidebar & Navigation Structure**:
   - Lines 49-64 in `renderer/pages/home.tsx`: `getNavItems()` defines the sidebar array:
     ```typescript
     const getNavItems = (): NavItem[] => [
       { id: 'home', label: t('sidebar.home'), icon: Film },
       { id: 'workflow', label: 'Workflow AI', icon: Workflow, badge: 'MỚI' },
       { id: 'subtitles', label: t('sidebar.subtitles'), icon: Subtitles },
       { id: 'editor', label: t('sidebar.editor'), icon: MessageSquareText },
       { id: 'dubbing', label: t('sidebar.dubbing'), icon: Mic },
       { id: 'export', label: t('sidebar.export'), icon: Layers },
       { id: 'settings', label: t('sidebar.settings'), icon: Settings },
     ];
     ```
   - Lines 418-544 in `renderer/pages/home.tsx`: The `<aside>` sidebar supports collapse (`w-[68px]` vs `w-[240px]`), Zen Mode (`isZenMode && activeTab === 'workflow'`), badges (`MỚI`), and active styling `bg-gradient-to-r from-brand-indigo/25 to-brand-cyan/15`.

3. **State Management & Store Separation**:
   - `package.json` line 71: `"zustand": "^5.0.15"`.
   - `renderer/lib/store/workflowStore.ts` line 1: `import { create } from 'zustand';`.
   - `main/store/settingsStore.ts` line 3: `import Store from 'electron-store';` (persists settings into electron-store with `safeStorage` encryption for sensitive API keys).
   - In `main/preload.ts`: `window.vanhsub` provides IPC invocation via `ipcRenderer.invoke` and push listeners via `ipcRenderer.on`.

4. **UI Design System & Styling Tokens**:
   - `package.json`: `"tailwindcss": "^4.3.3"`, `"@tailwindcss/postcss": "^4.3.3"`, `"tailwindcss-animate": "^1.0.7"`, `"lucide-react": "^1.34.0"`, `"sonner": "^2.0.8"`.
   - `renderer/styles/globals.css` lines 1-142:
     - `@import "tailwindcss"; @plugin "tailwindcss-animate";`
     - CSS variables: `--background: 224 45% 6%`, `--card: 223 39% 10%`, `--brand-cyan: #0EA5E9`, `--brand-indigo: #6366F1`, `--brand-rose: #F43F5E`.
     - Utilities: `.btn-vanh-gradient`, `.text-gradient-brand`, `.card-glass`, `.card-glass-hover`.
     - Direct unstyled Radix primitives in components: `@radix-ui/react-dialog` in `DownloadModal.tsx` and `OnboardingModal.tsx`, styled with Tailwind `data-[state=open]:animate-in`.

5. **Existing Media Preview Components**:
   - `renderer/components/export/VideoPreviewCanvas.tsx` (lines 37-915):
     - Local video protocol: `vanhmedia://local/${encodeURIComponent(videoPath)}` (line 243).
     - Live aspect ratio handling (`16:9`, `9:16`, `1:1`, `original`).
     - Subtitle rendering overlay (lines 767-820): active line detection (`currentTime >= startMs / 1000 && currentTime <= endMs / 1000`), Numpad 1-9 alignment (`getSubContainerStyle`), 8-directional outline stroke (`textShadow`), drag-to-reposition coordinates.
   - `renderer/lib/fullPreviewPlayer.ts` (lines 1-122):
     - Singleton audio player living outside React lifecycle so switching tabs doesn't stop playback.
     - Prefetches next line audio to reduce gap between lines.
   - `renderer/components/workflow/StoryboardDirectorStudio.tsx` (lines 1-733):
     - Proven 3-step visual storyboard workflow (Script -> Keyframe Shotlist Cards -> Video Assembly).

---

## 2. Logic Chain

1. From **Observation 1 & 2**:
   Because `home.tsx` governs the application layout with permanent DOM mounting for tabs, adding an AI Video Studio module does not require a router migration. We simply:
   - Add `{ id: 'ai_studio', label: 'AI Video Studio', icon: Bot, badge: 'HOT' }` to `getNavItems()`.
   - Add the title handling to the header ternary in `home.tsx`.
   - Add `<div className={activeTab === 'ai_studio' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}><AiStudioContainer ... /></div>`.
   This ensures zero regression to other tabs and maintains component state when users switch between AI Studio and other tools.

2. From **Observation 3**:
   Because `settingsStore` in `main/store/settingsStore.ts` and `workflowStore` in `renderer/lib/store/workflowStore.ts` are separate, implementing `main/store/aiStudioStore.ts` (via `electron-store`) and `renderer/lib/store/aiStudioStore.ts` (via `zustand`) satisfies Requirement R1 from `ORIGINAL_REQUEST.md`. It guarantees that AI Studio configuration is 100% isolated, prevents key pollution, and supports hot updates via IPC without touching existing stores.

3. From **Observation 4**:
   Because Tailwind v4 with `@theme inline` and Radix primitives are already in use, all AI Studio components can use standard utility classes (`bg-[#080D1A]`, `bg-[#0B1120]`, `bg-slate-900/60`, `border-slate-800/80`, `.btn-vanh-gradient`, `.card-glass`), Radix UI (`Tabs`, `Slider`, `Select`, `Switch`, `Dialog`), and `lucide-react` icons to achieve a 100% native look and feel.

4. From **Observation 5**:
   Because `VideoPreviewCanvas.tsx` already handles multi-aspect ratio preview, custom `vanhmedia://local/` streaming, and real-time subtitle styling/overlays, and `fullPreviewPlayer.ts` handles seamless voiceover playback, the AI Studio Custom Studio (Tab 1, Tab 2, Tab 3) and Auto-Pilot preview can directly reuse these existing, battle-tested components without reinventing media rendering.

5. From **Observation 5 (StoryboardDirectorStudio)**:
   The visual card layout and prompt editing pattern in `StoryboardDirectorStudio.tsx` directly satisfies the Tab 2 requirements (Visual Storyboard Cards) of `AI_STUDIO_SPEC.md`, allowing a clean extraction into `renderer/components/ai-studio/custom/StoryboardTab.tsx`.

---

## 3. Caveats

1. **Playwright/Veo Session Offscreen**: While the frontend handles the session status and trigger events, actual Google Flow session cookies and CAPTCHA handling reside in the main process (`main/veo/`). The frontend should gracefully display status badges (`ready`, `captcha_required`, `unauthenticated`) without attempting direct DOM automation itself.
2. **FFmpeg Compilation**: The frontend triggers assembly via IPC and listens for progress events (`0-100%`); actual FFmpeg child processes run in the main process.
3. **No Code Modified**: In accordance with the Explorer role, no source code was altered during this investigation. All findings and proposed structures are documented in `frontend_survey.md`.

---

## 4. Conclusion

The Vanhsub frontend architecture is modern, clean, and perfectly suited for integrating the AI Video Studio.
- The entry point in `renderer/pages/home.tsx` provides a seamless non-destructive integration hook.
- A new dedicated component folder `renderer/components/ai-studio/` with 4 top-level views (`AiStudioContainer.tsx`, `AutoPilotView.tsx`, `CustomStudioView.tsx`, `AiStudioSettingsTab.tsx`) and sub-components will satisfy all functional requirements (R1, R3, R4, R5) of `AI_STUDIO_SPEC.md`.
- State management will be isolated in `renderer/lib/store/aiStudioStore.ts` with typed contracts in `renderer/types/aiStudio.ts`.
- Full survey report has been authored at: `d:\DEAN\DEAN\VANHSUB\.agents\explorer_frontend_survey\frontend_survey.md`.

---

## 5. Verification Method

To verify the findings and integrity of this survey:
1. **Inspect Survey Report**:
   Read `d:\DEAN\DEAN\VANHSUB\.agents\explorer_frontend_survey\frontend_survey.md` to verify all 8 sections and line-by-line references.
2. **Inspect Existing Code Locations**:
   - `renderer/pages/home.tsx` lines 49-64 (`getNavItems`), lines 82 (`activeTab`), lines 418-544 (Sidebar), lines 613-656 (Tab containers).
   - `renderer/styles/globals.css` lines 1-65 (`@theme inline`, Obsidian dark theme, brand tokens).
   - `renderer/components/export/VideoPreviewCanvas.tsx` lines 37-915 (`vanhmedia://local/`, aspect ratio, subtitle overlay).
   - `renderer/lib/fullPreviewPlayer.ts` lines 1-122 (external store audio player).
   - `renderer/components/workflow/StoryboardDirectorStudio.tsx` lines 1-733 (storyboard card pattern).
3. **TypeScript Typecheck Command**:
   Run `npm run build` or `npx tsc --noEmit` from project root to ensure existing codebase compiles cleanly without errors.
