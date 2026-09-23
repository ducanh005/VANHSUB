# BRIEFING — 2026-09-21T16:07:56Z

## Mission
Khắc phục triệt để 4 vấn đề cốt lõi trong phân hệ AI Video Studio của Vanhsub: (1) Ngăn chặn hoàn toàn việc cửa sổ Google Flow cướp focus ở chế độ offscreen; (2) Tối ưu hóa Storyboard: tự động gom cụm câu thoại chung ngữ cảnh vào 1 shot (4-10s); (3) Sửa dứt điểm lỗi lệch phân cảnh khi gán reference images; (4) Xây dựng cơ chế cô lập lỗi và fallback an toàn chống sập dây chuyền khi Flow gặp sự cố.

## 🔒 My Identity
- Archetype: sentinel
- Working directory: d:\DEAN\DEAN\VANHSUB\.agents\sentinel
- Orchestrator: a5be9afe-bae5-4c77-9d8c-57596180e0cc (retired)
- Victory Auditor: 7c1cb01b-e4e8-40cc-aab5-c286387c7706 (retired)
- Orchestrator 2: 4178817f-9fd4-446c-af6c-ef59368c4a1e (retired)
- Orchestrator 3: da011580-7822-4f08-aabc-fa08fc8ef25d (retired)
- Orchestrator 4: 21b076e0-7535-4fd4-8b08-fa6b95dfc5e1 (errored / died)
- Orchestrator 5: cff1b883-a490-484a-9ce3-a7243b4a3ebf (retired)
- Victory Auditor 1: 25c05823-5ab4-487d-bee0-f51fcf684b0c (retired)
- Orchestrator 6: 69cadcf9-da63-48fe-8147-e643dc3d7c4e (server restart)
- Active Orchestrator: 2c251f15-7b27-4e6f-852b-1823f9457b37 (orchestrator_7)
- Victory Auditor: [to be spawned on victory claim]

## 🔒 Key Constraints
- No technical decisions — relay only
- Victory Audit is MANDATORY before reporting completion
- Read-Only Audit: Tuyệt đối KHÔNG sửa code, KHÔNG làm thay đổi git status
- 9-section report (A to I) required
- Full implementation of AI Video Studio per AI_STUDIO_SPEC.md
- Dedicated independent store (aiStudioStore) without touching existing settingsStore / workflowStore
- Automated verification: full type check (npm run build / npx tsc --noEmit) 100% clean
- Independent test script (scripts/test_ai_studio_pipeline.ts) verifying end-to-end pipeline
- ChatGPT Web Session Manager with partition 'persist:chatgpt_session'
- Offscreen / Live window modes for ChatGPT Web automation
- Multi-turn chunking for long script generation
- Verification: npx tsc --noEmit and scripts/test_chatgpt_web_automation.ts
- Local Disk Source of Truth: /project/{project_id}/ or sessions/{session_id}/ with 00_facts to 05_media & index.json
- Confirm-Before-Act Visual Settle & Highlight (200-400ms overlay, measure bounding box twice before click)
- Smart polling replacing sleep (spinner, download button, max timeout 90s image / 300s video, max 2 retries)
- Phase 5 Storyboard synchronized with real audio probed duration from ffprobe
- Phase 6 Text-to-Image and Image-to-Video via direct local file path injection
- Idempotency & Resumable with versioning (_v2, _v3)
- Offscreen / Headless vs Live Window modes
- Verification: npx tsc --noEmit 100% clean & scripts/test_spec_pipeline_automation.ts
- R1: Prevent Google Flow from stealing focus / popping up in offscreen mode (no win.show(), win.focus(), win.restore())
- R2: Semantic scene clustering in Stage 5 Storyboard (group lines into 4-10s shots)
- R3: Eliminate off-by-one reference image chain drift (canonical style anchor & explicit previous_shot_id)
- R4: Fault isolation, fallback asset & Ken Burns fallback for missing video in Stage 7

## User Context
- **Last user request**: Khắc phục triệt để 4 vấn đề cốt lõi trong phân hệ AI Video Studio của Vanhsub: (1) Ngăn chặn hoàn toàn việc cửa sổ Google Flow tự ý nhảy lên cướp focus; (2) Tối ưu hóa phân cảnh Storyboard: gom cụm thoại; (3) Sửa dứt điểm lỗi lệch phân cảnh gán reference images; (4) Xây dựng cơ chế cô lập lỗi và fallback an toàn chống sập dây chuyền.
- **Pending clarifications**: none
- **Delivered results**: previous milestones delivered. New task in progress.

## Project Status
- **Phase**: in progress
- **Route**: General -> teamwork_preview_orchestrator (orchestrator_6)

## Victory Audit Status
- **Triggered**: no
- **Verdict**: pending
- **Retry count**: 0

## Artifact Index
- d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md — Verbatim user request record
- d:\DEAN\DEAN\VANHSUB\AI_STUDIO_SPEC.md — AI Studio specification document
- d:\DEAN\DEAN\VANHSUB\spec-pipeline-video-automation.md — Pipeline Video Automation specification document
- d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_5\handoff.md — Orchestrator 5 final handover report
- d:\DEAN\DEAN\VANHSUB\.agents\victory_auditor_1\audit_report.md — Independent Victory Audit Report (Milestone 1)
