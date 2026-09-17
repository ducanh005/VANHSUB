## 2026-09-17T07:21:10Z

You are the Modular Services Explorer for Milestone 2 of the Vanhsub AI Video Studio project.

Your assigned working directory: d:\DEAN\DEAN\VANHSUB\.agents\explorer_m2_services
You MUST create your working directory files (e.g. progress.md, handoff.md, m2_services_plan.md) in this folder.

Mandatory input files to read:
1. d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md (MUST read first)
2. d:\DEAN\DEAN\VANHSUB\AI_STUDIO_SPEC.md
3. d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_2\PROJECT.md
4. d:\DEAN\DEAN\VANHSUB\scripts\test_ai_studio_pipeline.ts
5. d:\DEAN\DEAN\VANHSUB\main\tts-providers\edge\EdgeTTSClient.ts
6. d:\DEAN\DEAN\VANHSUB\main\render\assCompiler.ts
7. d:\DEAN\DEAN\VANHSUB\main\render\videoRenderer.ts
8. d:\DEAN\DEAN\VANHSUB\main\veo\GoogleVeoSessionManager.ts

Objectives:
- Design the 4 modular backend services under `main/ai-studio/services/`:
  1. `AiStudioLlmService.ts`:
     - Stage 1: Idea / blueprint analysis (hook, angle, pacing).
     - Stage 2: Script generation via OpenAI SDK or custom endpoint with `jsonrepair` and structured JSON extraction. Includes fallback generator when API key is unconfigured.
     - Stage 8: SEO metadata generation (viral title, description, hashtags, thumbnail prompt).
     - Script quality audit (retention score 0-100, hook analysis).
  2. `AiStudioTtsService.ts`:
     - Stage 3: Vietnamese voiceover synthesis using `msedge-tts` (`vi-VN-HoaiMyNeural` / `vi-VN-NamMinhNeural`).
     - Stage 4: Native `WordBoundary` timestamp extraction (with syllabic interpolation fallback).
     - Single-line voice re-synthesis method.
  3. `AiStudioVisualService.ts`:
     - Stage 5: Visual storyboard prompt generator (English cinematic prompts, style prefix, negative prompt).
     - Stage 6: Dual-mode dispatcher:
       - If Google Veo session is valid: dispatch to `GoogleVeoSessionManager`.
       - If unauthenticated / offline / test: generate high-resolution synthetic scene cards (via FFmpeg color canvas + text overlay or canvas).
     - Single-scene asset re-generation method.
  4. `AiStudioVideoAssembler.ts`:
     - Stage 7: Assemble visual assets with Ken Burns effect (zoom/pan), mix voiceover audio + ducked BGM, compile and burn dynamic ASS subtitles (`tiktok_bold`, `karaoke_glow`, `minimalist`) into `final_video.mp4` via `fluent-ffmpeg`.
     - Support aspect ratios (`16:9`, `9:16`, `1:1`) and resolutions (`1080p`, `720p`).
     - Handle Windows paths escaping via `escapeFfmpegSubtitlesPath`.
- Produce detailed report at `d:\DEAN\DEAN\VANHSUB\.agents\explorer_m2_services\m2_services_plan.md` and complete handoff.md.
