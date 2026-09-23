# E2E Test Infra: Vanhsub AI Video Studio Core Fixes (R1 - R4)

## Test Philosophy
- Opaque-box, requirement-driven verification derived from `ORIGINAL_REQUEST.md` (## 2026-09-21T16:07:56Z).
- Progressive testability: verification covers R1, R2, R3, R4 systematically across 4 tiers.
- Non-mocked verification where possible, with strict mocking contracts for external browser windows and FFmpeg rendering.

## Feature Inventory & Test Mapping
| # | Feature | Requirement | Tier 1 (Unit) | Tier 2 (Boundary) | Tier 3 (Cross-Feature) | Tier 4 (E2E Workflow) |
|---|---------|-------------|:-------------:|:-----------------:|:----------------------:|:---------------------:|
| F1 | Offscreen Stealth & Focus Eradication | R1 | 5 tests | 5 tests | 2 tests | 1 test |
| F2 | Smart Storyboard Clustering (4s-10s) | R2 | 5 tests | 5 tests | 3 tests | 1 test |
| F3 | Reference Image & Canonical Anchor | R3 | 5 tests | 5 tests | 2 tests | 1 test |
| F4 | Fault Isolation & Multi-Shot Ken Burns | R4 | 5 tests | 5 tests | 3 tests | 2 tests |

## Test Architecture
- Primary test script: `scripts/test_spec_pipeline_automation.ts` (expanded to include R1, R2, R3, R4 test suites).
- Test runner invocation: `npx tsx scripts/test_spec_pipeline_automation.ts`
- Type checking: `npx tsc --noEmit`
- Pass criteria: Exit code 0, 100% assertions pass, 0 TypeScript compilation errors.

## Test Tiers Breakdown
### Tier 1 - Feature Coverage
1. R1: Verify `openLobbyWindow({ uiMode: 'offscreen' })` does NOT call `win.show()`, `win.focus()`, `win.restore()`, and keeps coordinates at `(OFFSCREEN_X, OFFSCREEN_Y)`.
2. R1: Verify `applyFlowSettings` does not steal OS focus in offscreen mode.
3. R1: Verify Flow state machines (`OPEN_FLOW_VIDEO`, input states) do not call `ctx.win.focus()` or `ctx.win.show()` when offscreen.
4. R1: Verify `FlowRecoveryManager` does not move window to onscreen `(100, 100)` during offscreen diagnostics.
5. R1: Verify default configuration has `uiMode === 'offscreen'`.
6. R2: Verify `StoryboardShotItem` data model contains `start_sec`, `duration_sec`, `assigned_sentences`, `assigned_scene_ids`.
7. R2: Verify greedy clustering groups consecutive dialogue lines into shots >= 4.0s.
8. R2: Verify shot duration does not exceed 10.0s unless a single sentence exceeds 10s.
9. R2: Verify combined dialogue text is correctly preserved across clustered shots.
10. R2: Verify visual prompt generation encapsulates the clustered scene context.
11. R3: Verify project creates `character_ref.png` and `background_ref.png` as Canonical Style Anchors.
12. R3: Verify shots without explicit continuity use Canonical Anchor.
13. R3: Verify shot with `previous_shot_id` uses the exact asset of that specific shot.
14. R3: Verify `previous_shot_id` resolves correctly even when shot count is less than sentence count (no `idx - 1` off-by-one).
15. R3: Verify invalid or missing `previous_shot_id` cleanly falls back to Canonical Anchor.
16. R4: Verify shot failure in Stage 6 does NOT throw uncaught error, but records `status: 'failed'` in metadata.
17. R4: Verify shot failure activates fallback asset (`character_ref.png` or adjacent valid asset) and marks `fallback_used: true`.
18. R4: Verify subsequent shots continue processing without delay after a failed shot.
19. R4: Verify Stage 7 FFmpeg assembler iterates through ALL shots in `scenes` rather than only `scenes[0]`.
20. R4: Verify image-only or failed-video shots receive Ken Burns animation with exact audio duration.

### Tier 2 - Boundary & Corner Cases
- R1: Window creation when display is disconnected or secondary monitor exists.
- R2: Script with only 1 very short sentence (< 2s) -> handled gracefully without crash, duration clamped.
- R2: Script with 1 very long sentence (> 15s) -> handled without splitting corruption.
- R2: Audio timing with zero duration or missing timestamps -> robust fallback timing.
- R3: First shot requesting `previous_shot_id` (invalid reference) -> falls back to Canonical Anchor.
- R3: Circular or nonexistent `previous_shot_id` -> falls back to Canonical Anchor.
- R4: All shots fail -> pipeline completes with all fallback assets, assembler renders complete Ken Burns video.
- R4: Intermittent failures (e.g. shot 1 pass, shot 2 fail, shot 3 pass) -> shot 3 remains intact and does not inherit failure.

### Tier 3 - Cross-Feature Interactions
- R1 + R4: Offscreen execution with simulated recovery/error -> window never pops up even during failure recovery.
- R2 + R3: Clustered shots (5 sentences into 2 shots) with continuity referencing -> `previous_shot_id` correctly points to shot 1 without array index mismatch.
- R2 + R4: Clustered shots where shot 1 fails -> shot 2 falls back to Canonical Anchor, assembler produces multi-shot Ken Burns video.

### Tier 4 - Real-World Application Scenarios
- Scenario 1: "Lịch sử dòng điện tại Nhật Bản" full simulation:
  - 10 sentences clustered into 3-4 visual shots (5-8s each).
  - One shot experiences simulated failure -> fallback asset activated.
  - FFmpeg assembly generates video with audio sync and Ken Burns effect.
  - Zero focus stealing throughout entire run.

## Coverage Goals
- 100% of features F1.1 - F4.6 tested.
- `npx tsc --noEmit` passes with 0 errors.
