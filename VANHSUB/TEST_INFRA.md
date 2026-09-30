# E2E Test Infra: VanhSub Subtitle & TTS Pipeline (R1 - R3)

## Test Philosophy
- Opaque-box, requirement-driven. Derived from `ORIGINAL_REQUEST.md` and user-facing specifications.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial + Real-World Workload Testing.
- Executable via `npx tsx scripts/test_subtitle_tts_pipeline.ts`.

## Feature Inventory
| # | Feature | Source (Requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|----------------------|:------:|:------:|:------:|
| 1 | OCR Single-Char Garbage Filter | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| 2 | OCR Floating Symbols & Punctuation Filter | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| 3 | Short-Duration Block (<150ms) Filter | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| 4 | SubtitleEditor UI Cleanup Action | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| 5 | Smart Visual Wrapping (<=37 chars/line, \n, max 2 lines) | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ |
| 6 | TTS Sentence Grouping (Unfinished clauses) | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ |
| 7 | Seamless Audio Prosody & Gapless Timeline | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ |
| 8 | Exact Duplicates Deduplication | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |
| 9 | Incremental / Progressive Karaoke Overlap Dedup | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |
| 10 | Whisper-OCR Cross-Modal Deduplication | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |

## Test Architecture
- Test runner: `npx tsx scripts/test_subtitle_tts_pipeline.ts`
- Pass/Fail semantics: Exit code 0 on 100% pass, non-zero on failure. Node.js `assert` assertions.
- Location: `scripts/test_subtitle_tts_pipeline.ts`

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | TikTok / Shorts Livestream Selling with Karaoke Subtitles | F1, F2, F3, F5, F8, F9 | High |
| 2 | Long Complex Sentence with Multi-Clause Inquiries | F5, F6, F7, F8, F9 | High |
| 3 | Documentary Video with Dialogues & Static Graphic Banners | F1, F2, F3, F10 | Medium |
| 4 | Rapid Speech with Micro-pauses and Visual Subtitle Consolidation | F3, F5, F6, F7 | High |
| 5 | SubtitleEditor Interactive Batch Sanitization & Undo Flow | F1, F2, F3, F4 | Medium |

## Coverage Thresholds
- Tier 1: >= 5 test cases per feature (>= 50 test cases)
- Tier 2: >= 5 test cases per feature (>= 50 boundary/corner test cases)
- Tier 3: >= 10 pairwise cross-feature tests
- Tier 4: >= 5 realistic application workloads
- Total minimum: >= 115 test cases
