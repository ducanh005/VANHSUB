## 2026-09-17T07:41:26Z
You are the Remediation Worker for Milestone 2 of the Vanhsub AI Video Studio project.

Your assigned working directory: d:\DEAN\DEAN\VANHSUB\.agents\worker_m2_fix
You MUST create your working directory files (e.g. progress.md, handoff.md) in this folder.

Mandatory input files to read:
1. d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md (MUST read first, specifically header ## 2026-09-17T06:24:37Z)
2. d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_2\PROJECT.md
3. d:\DEAN\DEAN\VANHSUB\.agents\challenger_m2_1\handoff.md
4. d:\DEAN\DEAN\VANHSUB\.agents\challenger_m2_2\handoff.md
5. d:\DEAN\DEAN\VANHSUB\.agents\auditor_m2_1\handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Files owned for modification:
- `main/ai-studio/AiStudioPipelineEngine.ts`
- `main/ai-studio/services/AiStudioTtsService.ts`
- `main/ai-studio/services/AiStudioVisualService.ts`
- `main/ai-studio/services/AiStudioVideoAssembler.ts`

Tasks:
1. In `main/ai-studio/AiStudioPipelineEngine.ts`:
   - Cancellation race condition: in `runPipelineLoop`, inside the catch block (`catch (err)`), check if `session.status === 'cancelled'`. If so, DO NOT overwrite `session.status` with `'failed'` and do not emit an error progress event; preserve `session.status = 'cancelled'`.
   - Eviction on retry: when retrying Stage 3 or earlier, explicitly evict `session.artifacts.srtPath` alongside other downstream artifacts (`audioPath`, `wordsAlignment`, `scenes`, `videoPath`, `metadata`).
   - Incomplete session schema guard: ensure `session.stages = session.stages || {}` is guarded so accessing `session.stages[i]` never throws `TypeError` if `stages` is missing.
2. In `main/ai-studio/services/AiStudioTtsService.ts`:
   - Fix `normalizeVoiceId`: test for `'female'` before checking `'male'` so that `'female'` correctly returns `'vi-VN-HoaiMyNeural'` instead of `'vi-VN-NamMinhNeural'`.
   - Add lightweight regex sanitization to strip unpronounceable symbol/star sequences (e.g. `⭐⭐⭐⭐⭐`, decorative quote blocks) before feeding into Edge TTS.
3. In `main/ai-studio/services/AiStudioVisualService.ts`:
   - Fix `dispatchVisualAssets`: ensure `modeUsed` correctly reports `'synthetic_fallback'` when Google Flow was not used or when falling back to synthetic cards.
4. In `main/ai-studio/services/AiStudioVideoAssembler.ts`:
   - Fix line 241 `.loop(1)`: replace with `.loop(Math.ceil(audioDurationSec) || 5)` or `.loop()` so the background/visual loops for the entire duration of the audio instead of being truncated to 1.0 second.
5. Verification:
   - Run `npx tsc --noEmit` (confirm 0 errors).
   - Run `npx tsx scripts/test_ai_studio_pipeline.ts` (confirm 9/9 passed).
   - Run `npx tsx scripts/test_challenger_m2_engine.ts` (confirm all passed).
   - Run `npx tsx scripts/test_challenger_m2_services.ts` (confirm all passed).
6. Author `handoff.md` and report completion to parent orchestrator.
