# Milestone 2 Challenger 2 Review Report: Modular Services & FFmpeg Assembly

## 1. Observation

### 1.1 Test Suite Execution
- **Command**: `npx tsx scripts/test_challenger_m2_services.ts`
- **Output Summary**:
  ```
  Total Tests Executed:  17
  Passed Checks:         15
  Defects Detected:      2
  Total Execution Time:  28.60s
  ```

### 1.2 Verification Results Across 5 Mandated Targets

1. **Target 1: TTS with Complex Vietnamese Characters, Numbers, and Emojis**
   - `[TTS-1.1]` Vietnamese Diacritics & Upper/Lower Tones: **PASS** (synthesized 99,792 bytes MP3, duration 16.63s, 46 word-boundary items).
   - `[TTS-1.2]` Numbers, Dates, Times, Percentages, Currencies: **PASS** (synthesized 80,496 bytes MP3, duration 13.42s with `vi-VN-NamMinhNeural`).
   - `[TTS-1.3]` Emoji & Symbol Pre-filtering: Short emojis passed (`🚀🔥🎉!`), but long or unpronounceable symbol sequences (e.g. `⭐⭐⭐⭐⭐` and `«"..."» —`) caused Edge TTS WebSocket stream to abort:
     ```
     Edge TTS Voiceover synthesis failed: Stream closed before the synthesis completed (no turn.end received). The audio is likely truncated.
     ```
   - `[TTS-1.4]` Voice ID Normalization: **FAIL (DEFECT-1)**. Observed in `main/ai-studio/services/AiStudioTtsService.ts:54-60`:
     ```typescript
     public normalizeVoiceId(voiceId?: string): string {
       const v = (voiceId || '').toLowerCase();
       if (v.includes('nam') || v.includes('male')) {
         return 'vi-VN-NamMinhNeural';
       }
       return 'vi-VN-HoaiMyNeural';
     }
     ```
     Execution observation:
     `aiStudioTtsService.normalizeVoiceId('female')` returned `'vi-VN-NamMinhNeural'` (Male voice).
     Verbatim check: `'female'.toLowerCase().includes('male') === true`.
   - `[TTS-1.5]` Empty Input Guard & Timestamp Monotonicity: **PASS** (whitespace rejected with `'Văn bản lồng tiếng không được để trống.'`; timestamps strictly monotonic).

2. **Target 2: Storyboard Prompt Generation with Empty or Short Lines**
   - `[STORYBOARD-2.1]` Empty, Whitespace, & Short Lines: **PASS** (tested with lines `""`, `"     \t\n  "`, `"A"`, `"Bí ẩn?"`, `"Hết."`; returned 5 valid scenes with valid visual prompts, duration estimates, and style prefixes).
   - `[STORYBOARD-2.2]` Empty Array & Unknown BeatType: **PASS** (`[]` returns `[]` without error; untyped beats default gracefully).
   - `[STORYBOARD-2.3]` Script Quality Audit Edge Cases: **PASS** (empty script returned retention score 62; single-line script returned 77 without NaN).

3. **Target 3: Visual Service Offline Fallback (16:9 and 9:16 Aspect Ratios)**
   - `[VISUAL-3.1]` Dimension Resolution: **PASS** (16:9 1080p -> 1920x1080, 16:9 720p -> 1280x720, 9:16 1080p -> 1080x1920, 9:16 720p -> 720x1280, 1:1 -> 1080x1080 / 720x720).
   - `[VISUAL-3.2]` 16:9 Synthetic Card Generation: **PASS** (verified PNG magic bytes `[0x89, 0x50, 0x4E, 0x47]`, ffprobe confirmed 1280x720 and 1920x1080).
   - `[VISUAL-3.3]` 9:16 Vertical Card Generation: **PASS** (ffprobe confirmed 720x1280 and 1080x1920 vertical format for TikTok/Shorts).
   - `[VISUAL-3.4]` Dual-Mode Dispatcher Accurate Mode Reporting: **FAIL (DEFECT-2)**.
     Observed in `main/ai-studio/services/AiStudioVisualService.ts:81-88, 106-130`:
     When a cookie is stored in `SettingsStore`, `status.valid === true && status.status === 'active'` is true, setting:
     `const modeUsed = useGoogleFlow ? 'google_flow' : 'synthetic_fallback';`
     During scene generation:
     `generateViaGoogleFlow` fails because `lobbyWindow` is null (`[Google Flow Browser] Sảnh Google Flow chưa sẵn sàng.`), falling back to `generateSyntheticSceneCard`.
     All scene cards are generated procedurally, yet `dispatchVisualAssets` returns `modeUsed: 'google_flow'`, which is false and misleading.

4. **Target 4: Video Assembler: Without BGM and with Spaces/Unicode Paths**
   - `[ASSEMBLER-4.1]` Video Assembly Without BGM: **PASS** (assembled MP4 without BGM, 19,029 bytes, duration 3.41s, verified H.264 video + AAC audio).
   - `[ASSEMBLER-4.2]` Windows Paths with Spaces and Vietnamese Unicode: **PASS** (tested directory `Thư Mục Video AI Đẹp Nhất 2026 (Bản Thử Nghiệm #1)`, input audio `giọng đọc lồng tiếng chuẩn.mp3`, input image `hình ảnh phân cảnh số 1.png`, and output `video thành phẩm cực nét.mp4`; FFmpeg executed cleanly and rendered 20,420 bytes MP4).

5. **Target 5: Granular Step Handlers**
   - `[GRANULAR-5.1]` `renderSingleLineVoice`: **PASS** (line 3 re-synthesized to MP3, 4,152ms duration, valid audio stream).
   - `[GRANULAR-5.2]` `regenerateSceneAsset`: **PASS** (single scene regenerated to 720x1280 9:16 PNG).
   - `[GRANULAR-5.3]` `renderVideo`: **PASS** (custom re-render with `karaoke_glow` preset and resolution `720p` from existing session generated verified MP4).

---

## 2. Logic Chain

1. **Target 1 TTS Defect**:
   - `AiStudioTtsService.ts:56` checks `if (v.includes('nam') || v.includes('male'))`.
   - In English, the substring `'male'` is a strict substring of `'female'` (`'fe-male'`).
   - When a user selects a female voice option (e.g. from `EDGE_TTS_VOICES` where `gender: 'female'`, or passes `'female'`), `v.includes('male')` evaluates to `true`.
   - As a direct result, `normalizeVoiceId('female')` returns `'vi-VN-NamMinhNeural'` (the male voice) instead of `'vi-VN-HoaiMyNeural'`.
   - This directly breaks the user requirement to select female Vietnamese narration.

2. **Target 3 Visual Dispatcher Defect**:
   - In `AiStudioVisualService.ts:88`, `modeUsed` is fixed to `'google_flow'` before any generation attempts.
   - When `GoogleVeoSessionManager.lobbyWindow` is null (e.g. in test, background task, or when user has not yet clicked "Mở sảnh"), `validateSession()` may report `'active'` based on cached cookie, but `generateImageViaBrowserContext` throws `'Sảnh Google Flow chưa sẵn sàng'`.
   - The catch block correctly engages `generateSyntheticSceneCard(scene, assetPath, ...)` for all scenes.
   - However, the final return object reports `modeUsed: 'google_flow'`, disguising the fact that 100% of images were synthetic placeholders.
   - Downstream UI tracking and session checkpoints therefore record misleading metadata.

3. **Target 4 & Target 5 Stability**:
   - The Video Assembler filtergraph properly handles Windows path formatting via `escapeFfmpegSubtitlesPath` (escaping drive letter colons `D\:/` and converting backslashes to forward slashes).
   - Paths with spaces and Unicode characters (e.g. `Thư Mục Video AI Đẹp Nhất 2026`) are supported inside FFmpeg complex filter single quotes.
   - Video assembly cleanly handles omission of BGM by adjusting `-map 1:a` and avoiding `amix`.
   - Granular step handlers (`renderSingleLineVoice`, `regenerateSceneAsset`, `renderVideo`) are fully wired and functional.

---

## 3. Caveats

- In headless CLI test environments, live browser generation with Google Flow cannot be completed because Electron browser windows are not created. The synthetic fallback path was thoroughly exercised and validated.
- Edge TTS emoji drop was observed on complex sequences (e.g. `⭐⭐⭐⭐⭐`, `«"..."»`); standard emojis such as `🚀🔥🎉` may pass intermittently depending on Azure TTS server updates. Defensive sanitization is nonetheless strongly recommended.

---

## 4. Conclusion

**Verdict: REQUEST_CHANGES**

While the modular services and FFmpeg video assembly architecture are predominantly well-crafted (15 of 17 tests passed, FFmpeg assembly and granular handlers are rock-solid), two concrete defects must be addressed by the worker:

1. **[CRITICAL/HIGH] Fix Voice ID Normalization (`AiStudioTtsService.ts:54-60`)**:
   - Fix substring collision so `'female'` does not match `'male'`.
   - Recommended fix:
     ```typescript
     public normalizeVoiceId(voiceId?: string): string {
       const v = (voiceId || '').toLowerCase();
       if (v.includes('female') || v.includes('hoaimy') || v.includes('nu') || v.includes('nữ')) {
         return 'vi-VN-HoaiMyNeural';
       }
       if (v.includes('nam') || v.includes('male')) {
         return 'vi-VN-NamMinhNeural';
       }
       return 'vi-VN-HoaiMyNeural';
     }
     ```

2. **[MEDIUM] Fix Accurate Fallback Mode Reporting (`AiStudioVisualService.ts:126-130`)**:
   - Track whether Google Flow actually succeeded for at least one scene.
   - If Google Flow failed or `lobbyWindow` was not open and all scenes were generated via `generateSyntheticSceneCard`, return `modeUsed: 'synthetic_fallback'`.

3. **[LOW/DEFENSIVE] Sanitize Emojis & Unpronounceable Glyphs Before TTS (`AiStudioTtsService.ts:71`)**:
   - Strip non-verbal emojis and unpronounceable symbol sequences (e.g. `⭐`, `«"..."»`) prior to passing text to `msedge-tts` to prevent WebSocket disconnection.

---

## 5. Verification Method

To independently reproduce and verify these findings:

1. Run the challenger stress-test suite:
   ```bash
   npx tsx scripts/test_challenger_m2_services.ts
   ```
   *Expected Output*: Displays 15 PASS, 2 DEFECTS DETECTED (`TTS-1.4` and `VISUAL-3.4`).

2. Verify Voice Normalization Bug directly in Node/tsx:
   ```bash
   npx tsx -e "import { aiStudioTtsService } from './main/ai-studio/services/AiStudioTtsService'; console.log('normalize female:', aiStudioTtsService.normalizeVoiceId('female'));"
   ```
   *Actual Output*: `normalize female: vi-VN-NamMinhNeural` (MALE voice).
   *Expected Output*: `vi-VN-HoaiMyNeural` (FEMALE voice).

3. Invalidation Conditions:
   - When `normalizeVoiceId('female')` returns `'vi-VN-HoaiMyNeural'`.
   - When `dispatchVisualAssets` returns `modeUsed: 'synthetic_fallback'` when Google Flow browser context fails.
