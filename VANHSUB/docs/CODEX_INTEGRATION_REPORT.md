# VANHSUB — Integration and stabilization, 2026-10-15

Status: integration verification in progress. This file records decisions before subsequent security changes; final acceptance results are appended below.

## Baselines and branch safety

- Common ancestor: `f03de1c`.
- Fetched `origin/main`: `899088f`,27 commits after ancestor, all retained as ancestors of the integration branch.
- Local `main`: `df9d768`,5 different commits after ancestor.
- Audit branch: `codex/full-audit-20261015`, tip `f164e0f`,5 audit commits above local main.
- Integration branch: **`codex/integration-stabilization-20261015`**, created directly from fetched `origin/main`.
- No main reset/merge, no force push, no user uncommitted files overwritten. Work takes place in the existing isolated worktree; the original D checkout is not switched.
- Git author names do not establish which agent wrote a commit. Attribution follows historical handoff descriptions; inclusion decisions use code and tests.

## Commit reconciliation

| Original | Decision / integrated revision | Reason |
|---|---|---|
| All27 remote commits `de1fce8`…`899088f` | Retained by ancestry | Keep export resolution/audio, unique project allocation/download preservation, subtitle invalidation, queued leases, TTS sentence groups/opt-in shortening, shared preferences, episode workspaces, config snapshots, session cancellation, rendering/voice/storyboard/media/BGM fixes |
| `39beaa6` | Selectively integrated as `78fc559` | Add fill-mode UI/types/IPC and renderer guard/freeze support. Reject older engine ownership/storage implementation which would replace pinned workspaces, revisions, snapshots and session leases. Import keeps existing `applySceneMedia` invalidation plus duration evidence. Ownership regression retained and upgraded to decoded media/persisted states |
| `070c919` | Selectively integrated as `2f2bcdd` | Keep I2V keyframe identity and CDP routing. Preserve backend artifact invalidation and UI refresh/session guards; reject stale frontend savedSession overwrite hunk. Add assetId contract field required by actual result |
| `ea1b716` | Selectively integrated as `f1fd533` | Keep20–30s duration, collector/pacing improvements and single-shot scene timing. Reject loading state by highest stage, replacing snapshot/lease logic, forcing global outputMode over explicit shot mode, and auto-adopting the active Flow project |
| `5402ea6` | Integrated as `0024011` | Scoped ChatGPT composer and duplicate-send protection; collector unit regression included |
| `df9d768` | Integrated as `6f08080` | Prevent extension auto-reload loop |
| `9efb10b` | Selectively integrated as `aec87c6` | Keep security, workflow cleanup/node leases, ASR/translation failure preservation, fresh TTS outputs. Preserve remote task/subtitle/queue/preferences behavior. `taskLease` now shares canonical `taskOperations`; no second lock registry. Keep atomic unique directory allocator instead of parallel hash allocator |
| `31204ba` | Not replayed wholesale; atomic-write hunk applied separately | Remote already has stronger workspace catalog checks, revision paths, config snapshot, AbortController/process-aware session leases and recovery. Replaying the whole commit would regress these. Atomic file safety remains necessary |
| `b12aaa0` | Not replayed wholesale; invalid TTS-duration hunk and regression retained separately | Provider review/refinement parsers already on remote. Preserve remote alignment/word boundary implementation; reject fictitious5s duration |
| `97479c0` | Integrated as `73c0b1e` | Fresh owned Flow tab on create; protect background user tabs; extension1.0.7 and VM tests |
| `f164e0f` | Integrated as `b60cf89` | Keep original audit evidence as historical evidence, not new integration PASS; new output uses `docs/integration-evidence/2026-10-15` |

Conflicts were reviewed by behavior. No global ours/theirs strategy was used. The incoming feature commit messages retain their historical wording; their prior E2E claims are not accepted as current evidence.

## Integration-specific corrections

- New fill-mode IPC is guarded by trusted renderer and canonical session lease, validates enum/scene list and invalidates rendered output.
- Main IPC added on the remote is also guarded; old subtitle mutation helpers, TTS regeneration options and dubbing preferences remain in use.
- Queued task leases remain reserved from enqueue until real completion; no double-reservation wrapper. Final-state persistence failure cannot prevent releasing the task lock.
- TTS rerun keeps a new directory while copying compatible audio/manifest cache from the previous run. This preserves data without spending synthesis calls on unchanged groups.
- Timeline test now explicitly requests freeze for short clips and verifies missing consent is rejected; still checks rendered colors, audible narration tail, dimensions,30/60FPS and4K.
- Legacy ownership fixture now contains an actual scene so the ambiguous-workspace assertion reaches the intended safety check. Test is retained, not deleted.

## Verification status

See final update below and the integration test matrix. No live-provider success or clean Windows installation is inferred from offline tests or execution on this development host.
