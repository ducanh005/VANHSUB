# E2E Test Infra: Vanhsub AI Video Studio

## Test Philosophy
- **Opaque-Box & Requirement-Driven**: Tests are derived strictly from `AI_STUDIO_SPEC.md` and user requirements, exercising the AI Studio through its public APIs, store interfaces, and pipeline stages without coupling to private internal details.
- **Progressive Testability**: Verification does not require external authenticated services; unauthenticated or headless runs seamlessly engage verified fallbacks (e.g. synthetic image generation, mock LLM scripts).
- **Execution Engine**: Executed via `npx tsx scripts/test_ai_studio_pipeline.ts`.

---

## Test Architecture
- **Test Runner Script**: `scripts/test_ai_studio_pipeline.ts`
- **Invocation**: `npx tsx scripts/test_ai_studio_pipeline.ts`
- **Pass/Fail Semantics**: Process exits with code 0 on 100% test pass; non-zero on any failure.
- **Output Artifact Verification**:
  - Store config file created in isolated path (`vanhsub-ai-studio.json`)
  - Audio file created (`voiceover.mp3`) with non-zero byte length
  - Time alignment array containing valid `startMs` and `endMs`
  - Scene cards with valid visual prompts
  - Scene image/video assets saved to disk
  - Final video output (`final_video.mp4`) verifiable via FFprobe (valid video & audio streams, correct resolution)
  - SEO JSON containing title, description, and hashtags

---

## Feature Inventory Test Coverage Matrix
| # | Feature | Tier 1 (Isolation) | Tier 2 (Boundary) | Tier 3 (Cross-Feature) | Tier 4 (Real-World) |
|---|---------|:------------------:|:-----------------:|:----------------------:|:-------------------:|
| F01 | Dedicated Main Store | ✓ (Read/Write) | ✓ (Corrupt/Empty fallback) | ✓ (Sync with Renderer) | ✓ (Restart app persistence) |
| F02 | Zustand Renderer Store | ✓ (State updates) | ✓ (Invalid payload) | ✓ (IPC roundtrip) | ✓ (Tab switch retention) |
| F03-F08 | Config Categories & Reset | ✓ (All fields) | ✓ (Out-of-bound values) | ✓ (Reset cascade) | ✓ (Default production config) |
| F09 | Stage 1: Idea Blueprint | ✓ (Standard topic) | ✓ (Empty/Long prompt) | ✓ (Feed to Stage 2) | ✓ (Tech News Blueprint) |
| F10 | Stage 2: LLM Script | ✓ (Beat generation) | ✓ (Malformed JSON recovery) | ✓ (Feed to Stage 3 & 5) | ✓ (2-min YouTube Story) |
| F11 | Stage 3: Edge TTS Voice | ✓ (Hoài My synthesis) | ✓ (Special chars/Emoji) | ✓ (Paired with Alignment) | ✓ (Natural Vietnamese speech) |
| F12 | Stage 4: Word-Boundary Time | ✓ (Millisecond timestamps) | ✓ (Missing boundary fallback) | ✓ (Sync with Storyboard) | ✓ (Per-sentence subtitle sync) |
| F13 | Stage 5: Visual Storyboard | ✓ (Prompt generation) | ✓ (Short line expansion) | ✓ (Feed to Flow) | ✓ (Cinematic scene prompts) |
| F14 | Stage 6: Visual Assets | ✓ (Asset generation) | ✓ (Unauth / Mock fallback) | ✓ (Feed to FFmpeg) | ✓ (Multi-scene visual reel) |
| F15 | Stage 7: FFmpeg Assembly | ✓ (MP4 creation) | ✓ (Odd aspect ratio/Missing BGM) | ✓ (Ken Burns + Subtitles) | ✓ (Full 1080p rendered video) |
| F16 | Stage 8: SEO & Metadata | ✓ (Title/Hashtags) | ✓ (Empty response fallback) | ✓ (Export package) | ✓ (Ready-to-publish metadata) |
| F17 | Checkpoint State Machine | ✓ (Save stage state) | ✓ (Crash mid-stage) | ✓ (Resume from stage 6) | ✓ (Complete recovery workflow) |

---

## 4-Tier Test Cases

### Tier 1: Feature Coverage (Isolated Stage Verification)
1. `T1.1`: `aiStudioStore` CRUD operations and encryption verification.
2. `T1.2`: Edge TTS synthesis of a single Vietnamese test sentence into an MP3 file.
3. `T1.3`: Word-boundary extraction verifying non-empty timestamps array.
4. `T1.4`: Visual prompt generation formatting and negative prompt appending.
5. `T1.5`: Synthetic image generation verifying valid PNG/JPEG dimensions.
6. `T1.6`: Minimal FFmpeg video assembly from 1 image + 1 audio file.
7. `T1.7`: SEO metadata generator producing title and hashtags.

### Tier 2: Boundary & Corner Cases
1. `T2.1`: Store initialization when store file does not exist (default schema population).
2. `T2.2`: Edge TTS input with Vietnamese diacritics, punctuation, numbers, and emojis.
3. `T2.3`: Alignment fallback when TTS word-boundary stream is empty (syllable distribution).
4. `T2.4`: Google Flow unauthenticated session graceful fallback to synthetic cards.
5. `T2.5`: FFmpeg assembly when BGM file path is undefined or missing on disk.
6. `T2.6`: FFmpeg assembly with Windows paths containing spaces and non-ASCII characters.

### Tier 3: Cross-Feature Combinations
1. `T3.1`: End-to-end Stage 1 -> 8 execution without interruption.
2. `T3.2`: Checkpoint save at Stage 5, process halt, and resume at Stage 6 without re-executing Stages 1-5.
3. `T3.3`: Voice change in Config propagating to Stage 3 audio generation.
4. `T3.4`: Subtitle preset change (`tiktok_bold` vs `karaoke_glow`) propagating to ASS compilation in Stage 7.

### Tier 4: Real-World Workload Scenarios
1. `T4.1`: "Khám phá vũ trụ sâu thẳm" (Documentary story, 16:9, Ken Burns zoom, Hoài My voice, TikTok bold subtitles).
2. `T4.2`: "Top 5 mẹo công nghệ 2026" (Short-form video, 9:16 vertical, Nam Minh voice, fast pace).
