# BRIEFING — 2026-09-17T14:40:00+07:00

## Mission
Adversarial challenge & stress-test verification for Milestone 2 (Modular Services & FFmpeg Assembly) of Vanhsub AI Video Studio.

## 🔒 My Identity
- Archetype: empirical-challenger
- Roles: critic, specialist
- Working directory: d:\DEAN\DEAN\VANHSUB\.agents\challenger_m2_2
- Original parent: 4178817f-9fd4-446c-af6c-ef59368c4a1e
- Milestone: milestone_2
- Instance: 2 of 2

## 🔒 Key Constraints
- Review-only — do NOT modify implementation code (only scripts/test_challenger_m2_services.ts and .agents metadata)
- Write and run verification script ourselves: generators, oracles, stress harnesses
- Empirical validation: reproducible bugs or pass/fail evidence

## Current Parent
- Conversation ID: 4178817f-9fd4-446c-af6c-ef59368c4a1e
- Updated: 2026-09-17T14:40:00+07:00

## Review Scope
- **Files to review**: Modular services in `main/ai-studio/services/` (TTS, LLM, Visual, Video Assembler) and `AiStudioPipelineEngine.ts`
- **Interface contracts**: PROJECT.md, AI_STUDIO_SPEC.md, worker_m2/handoff.md
- **Review criteria**: Vietnamese unicode/diacritics/emojis in TTS, empty/short storyboard lines, offline visual generation (16:9 & 9:16), video assembly without BGM and with spaces/unicode paths, granular step handlers.

## Attack Surface
- **Hypotheses tested**:
  1. Edge TTS handling of complex Vietnamese tones, currencies, emojis, and voice normalization.
  2. Storyboard prompt generation with empty, whitespace, and single-char lines.
  3. Visual service dimension resolution and synthetic generation for 16:9 and 9:16 aspect ratios.
  4. Video Assembler handling of assembly without BGM and Windows paths containing spaces and Unicode.
  5. Granular step handlers (`renderSingleLineVoice`, `regenerateSceneAsset`, `renderVideo`).
- **Vulnerabilities found**:
  1. `AiStudioTtsService.normalizeVoiceId('female')` collision: `'female'.includes('male')` maps female voice to `vi-VN-NamMinhNeural` (Male voice).
  2. `AiStudioVisualService.dispatchVisualAssets` false mode reporting: reports `modeUsed: 'google_flow'` even when all scenes failed Google Flow and used `synthetic_fallback`.
  3. `AiStudioTtsService` lack of symbol pre-filtering: raw unicode sequences (e.g. `⭐⭐⭐⭐⭐`) cause Edge TTS stream to close early.
- **Untested angles**:
  - Live authenticated Google Flow browser rendering (requires interactive desktop session).

## Loaded Skills
- None

## Key Decisions Made
- Authored test suite in `scripts/test_challenger_m2_services.ts`.
- Verdict issued: `REQUEST_CHANGES` due to voice normalization bug and misleading dispatch mode reporting.

## Artifact Index
- scripts/test_challenger_m2_services.ts — Challenger stress test suite
- .agents/challenger_m2_2/handoff.md — Final handoff report
- .agents/challenger_m2_2/progress.md — Liveness & progress tracking
