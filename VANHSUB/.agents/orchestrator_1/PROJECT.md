# Project: Google Flow Automation Audit and Refactor Plan

## Mission Scope
Comprehensive, read-only architectural and code-level audit of the Google Flow (Veo/Imagen/Flow) automation system in Electron + TypeScript.
Produce a standard 9-section master report (Mục A đến Mục I) with actionable insights for Phase 7-10 migration.

## Working Rule & Constraints
- Read-Only Audit: Strict constraint — KHÔNG sửa code, KHÔNG làm thay đổi git status.
- Evidence-based: Every finding must include concrete file paths, line numbers, function signatures, and data statistics.

## Track Breakdown
| Track | Role | Target Scope | Output File |
|---|---|---|---|
| Track 1 | UI & DOM Locator Specialist | `main/workflow/flow-engine/FlowElementFinder.ts`, `FlowElementSpecs.ts`, dispatcher files; coordinate clicks vs DOM selectors vs OCR/CDP stats; container scoping, short-text protection, dynamic scoring, overlay detector | `.agents/specialist_ui_dom/handoff.md` |
| Track 2 | Session, Window & Concurrency Specialist | `main/veo/GoogleVeoSessionManager.ts`, `GoogleFlowBrowserMutex`, `lobbyWindow` lifecycle, canvas cleanup, race conditions/deadlocks, offscreen vs onscreen, capturePage diagnostics | `.agents/specialist_session_concurrency/handoff.md` |
| Track 3 | Error, Retry & Recovery Specialist | `FlowErrorClassifier.ts`, `FlowRecoveryManager.ts`, `FlowRetryManager.ts`, Idempotency Jump, unknown state detection, screenshot/HTML dump chẩn đoán | `.agents/specialist_error_recovery/handoff.md` |
| Track 4 | IPC & Architecture Lead Specialist | IPC entry points (`ipcMain.handle`, `ipcRenderer.invoke`), UI renderer -> Main -> Chromium webContents data flow, architecture layers, synthesis into 9-section report | `.agents/specialist_ipc_arch/handoff.md` & `.agents/orchestrator_1/AUDIT_REPORT.md` |

## Master Report Structure (9 Sections A-I)
- **A. Sơ đồ kiến trúc hiện tại**: Luồng dữ liệu, các lớp điều phối từ UI renderer xuống Chromium webContents.
- **B. Danh sách entry point (file + function)**: Tất cả các điểm tiếp nhận yêu cầu tạo ảnh/video từ người dùng.
- **C. Các phương pháp automation đang tồn tại**: Tỷ lệ phối hợp giữa DOM query, Coordinate click, OCR, CDP.
- **D. Danh sách các đoạn code trùng lặp**: Các logic click, wait, poll, retry bị copy-paste qua nhiều file.
- **E. Các đoạn code nguy hiểm**: Hardcoded coordinates, race conditions trên browser window, nguy cơ infinite loops hoặc memory leak.
- **F. Các thành phần đang hoạt động ổn định cần bảo tồn**: Mutex, cookie injection, session auth, các module đã hoàn thiện từ Phase 1 - Phase 6 trong `main/workflow/flow-engine/`.
- **G. Sơ đồ kiến trúc đề xuất**: Mô hình hoàn thiện của State Machine + Verify-After-Action + Self-Healing + Task Queue cho các phase tiếp theo.
- **H. Lộ trình migration theo từng bước nhỏ**: Đánh giá lộ trình 10 Phase hiện tại, xác định vị trí hiện tại (sau Phase 6) và các điều chỉnh cần thiết cho Phase 7 - 10.
- **I. Bước đầu tiên nhỏ nhất có giá trị cao nhất để tiếp tục**: Định hình chính xác phạm vi và tiêu chí nghiệm thu cho Phase 7 (Task Queue & Checkpoint Resume).
