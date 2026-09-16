# BRIEFING — 2026-09-16T08:17:15Z

## Mission
Investigate UI & DOM Locator mechanisms, hardcoded coordinates, automation methods, and scoring/protection systems in Google Flow automation engine.

## 🔒 My Identity
- Archetype: explorer
- Roles: UI & DOM Locator Specialist
- Working directory: d:\DEAN\DEAN\VANHSUB\.agents\specialist_ui_dom
- Original parent: a5be9afe-bae5-4c77-9d8c-57596180e0cc
- Milestone: Audit & Assessment Track 1

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Strictly NO modifying source code files or git status
- Write ONLY within d:\DEAN\DEAN\VANHSUB\.agents\specialist_ui_dom

## Current Parent
- Conversation ID: a5be9afe-bae5-4c77-9d8c-57596180e0cc
- Updated: 2026-09-16T08:17:15Z

## Investigation State
- **Explored paths**:
  - main/workflow/flow-engine/FlowElementFinder.ts (1019 lines)
  - main/workflow/flow-engine/FlowSmartWait.ts (378 lines)
  - main/workflow/flow-engine/FlowOverlayDetector.ts (229 lines)
  - main/workflow/flow-engine/FlowPageStateDetector.ts (148 lines)
  - main/workflow/flow-engine/FlowRecoveryManager.ts (215 lines)
  - main/workflow/flow-engine/FlowRetryManager.ts & FlowErrorClassifier.ts
  - main/workflow/flow-engine/states/FlowImageGenerationStates.ts (1537 lines, 18 states)
  - main/workflow/flow-engine/types.ts
  - main/veo/GoogleVeoSessionManager.ts (2691 lines)
  - main/workflow/adapters/GoogleFlowAdapter.ts (1031 lines)
  - main/workflow/dispatcher/adapters/GoogleFlowImageAdapter.ts
  - scratch/ verification tests (Phase 3, 4, 5, 6 suites)
- **Key findings**:
  - FlowElementSpecs is embedded directly within FlowElementFinder.ts as static factory methods.
  - Zero hardcoded click coordinates exist in active production paths; 100% of mouse clicks use dynamic bounding boxes via getBoundingClientRect().
  - Window positioning uses hardcoded offscreen coordinates (-3000, -3000).
  - 0% OCR and 0% CDP used in automation locator engine.
  - Asymmetric architecture: Image generation is fully refactored into the 18-state FSM; Video generation in GoogleVeoSessionManager.ts remains 760 lines of legacy monolithic automation.
  - Container scoping leaks document-wide in State 14 fresh coordinate recalculation and generateVideoViaBrowserContext.
  - Short-text protection caps confidence at 48-55 (< 65 threshold), successfully preventing false clicks.
- **Unexplored areas**: None within Track 1 scope.

## Key Decisions Made
- Audit synthesized into 5-component handoff report with exact line citations, comparative tables, and verification methods.

## Artifact Index
- DISPATCH.md — Assignment instructions
- BRIEFING.md — Persistent context
- progress.md — Heartbeat and step tracking
- handoff.md — Comprehensive audit report
