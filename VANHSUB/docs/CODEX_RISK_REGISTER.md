# VANHSUB — Risk register, 2026-10-15

Baseline `df9d768`, branch `codex/full-audit-20261015`. Mức P0/P1 của lỗi đã sửa không có nghĩa audit đã chứng minh không còn lỗi cùng lớp. FIXED = bản vá và kiểm thử ghi rõ trong report; OPEN = chưa xử lý/kiểm chứng đủ; BLOCKED = cần điều kiện ngoài hiện tại.

| ID | Mức | Trạng thái | Rủi ro / nguồn | Hành động và điều kiện đóng |
|---|---|---|---|---|
| F01–F04 | P0 | FIXED | Collision project/episode, cleanup đang chạy, destructive atomic fallback | Test FS/identity/deferred node/EPERM PASS; legacy conflict chủ động chặn, không migrate tự động |
| F05–F08 | P1 | FIXED có giới hạn | IPC trust, shell URL, path validation, website WebSocket, job overlap | Security handshake/guard tests và task leases PASS; còn R05/R07 |
| F09–F12 | P1 | FIXED có giới hạn | Rerun mất output; session approve/cancel; fabricated script scores; stale script media | Offline regression PASS; chưa chứng nhận full provider paths và mọi edit path |
| F13 | P2 | FIXED | Orphan running checkpoint sau restart | Load báo failed, không tự chạy lại provider; true OS crash vẫn R04 |
| F14–F15 | P1 | FIXED có giới hạn | Duration giả5s; logger raw secrets/broadcast | Invalid probe reject; redaction synthetic keys/Bearer/query + trusted app log sink; arbitrary unlabelled secret vẫn có thể lọt |
| F16 | P1 | FIXED IN SOURCE | CreateNew chọn tab nền thủ công do chỉ bảo vệ active | Manifest1.0.7 + VM regression PASS; extension đang chạy1.0.6 chưa có patch |
| R01 | P1 | BLOCKED / DEFERRED BY USER | Flow production path chưa live | Origin handshake với MV3 v1.0.6 PASS; CDP9224 chưa có. Người dùng chọn tạm ghi live chưa hoàn tất. Cần nạp1.0.7/dedicated CDP rồi test bounded I2V/T2V/provenance/cancel |
| R02 | P1 | PARTIAL | Native/download/package/installer portability | Clean-dependency unpacked package + actual EXE UI/restart và3binary smoke PASS cùng host; junction package FAIL. Installer/Windows sạch, inference/Python/fonts và signing vẫn chưa đạt |
| R03 | P1 | OPEN | Engine resume và script IPC đọc global config thay snapshot; owner profile chưa dùng nhất quán | `AiStudioPipelineEngine.runPipelineLoop`, `ipc.ts` script handlers; pin nonsecret config per session, credential routing độc lập; test đổi active project/provider khi pause |
| R04 | P1 | OPEN / NOT TESTED | Không có shutdown coordinator rõ trong `main.ts`; FFmpeg/Python/browser/WS/timer có vòng đời riêng | Quit giữa từng job; chứng minh chỉ terminate process app sở hữu, settle/cancel, không zombie; soak nhiều giờ |
| R05 | P1 | OPEN | Secret encryption fail-open/plaintext/base64 | `settingsStore.encryptSecret`, `aiStudioStore.encryptSecret`; fail closed khi production không có DPAPI, migration/backup/error UX; không làm mất key cũ |
| R06 | P1 | OPEN | npm production audit9high | JSON evidence; triage reachability từng advisory, cập nhật nhỏ với lock/native/provider regression; không audit-fix blanket |
| R07 | P2 | OPEN | WebSocket chỉ lọc dạng Origin extension, chưa pairing; native attacker giả được Origin | Pairing/extension identity + replay/request binding; real MV3 v1.0.6 reconnect/handshake PASS; loopback/maxPayload đã có |
| R08 | P2 | OPEN | `vanhmedia` resolve path rộng, relative fallback theo activeProject, CSP chưa rõ | Capability/owner-based media lookup; test same-name cross-project media, deny nonmedia/outside grant; CSP static Next tương thích |
| R09 | P2 | OPEN | Một số output AI Studio vẫn dùng tên cố định trong một episode; revision và rollback chưa phủ mọi stage | Version toàn bộ voice/timeline/export writes hoặc staged commit; lỗi/cancel phải giữ bản usable cũ; F03 chỉ cách ly giữa episodes |
| R10 | P2 | NOT TESTED | TTS grouped regeneration, thuật toán alignment và audio sync nghe thực | Test đổi một dòng trong sentence group, nhiều speakers, silence, speech dài, slot overlap; waveform và nghe đối chiếu, không chỉ tồn tại file |
| R11 | P2 | NOT TESTED | UI loading/cancel/error có thể chưa phản ánh jobActive mới | Smoke navigation PASS không thay full user flows; stress click, modal, settings conflict, empty/error states ở nhiều kích thước |
| R12 | P2 | NOT TESTED | Model/provider lifecycle và cost tracking | 0live generations; diagnostics hiện readiness không chứng minh quota/LLM output; kiểm thử rate limit/retry/cost thật có budget |
| R13 | P2 | OPEN | Legacy live runner chọn page/gallery `.first()` có thể nhầm tab/media | Không dùng mù. New owned page/project, snapshot tab IDs before/after, exact request/media IDs, không thao tác tab cá nhân |
| R14 | P2 | OPEN | Checkpoint workspace và catalog là hai atomic file, không phải transaction chung | Crash ở giữa2writes: reconcile theo ID/version/updatedAt; test hỏng một bản, write failure và disk full; không mất bản tốt |
| R15 | P3 | OPEN | Cycles, engine/IPC lớn, duplicate abstraction, model options/UI badges | Xác minh runtime/type cycles và callgraph; không xóa file chỉ thiếu inboundimport. Refactor nhỏ sau acceptance |
| R16 | P1 | OPEN | Local main và GitHub main phân kỳ27/5 | Review/hợp nhất cả hai lịch sử trong thay đổi riêng; không push đè main, không coi branch audit là descendant remote main |

Không ghi secrets trong register. Các mục chưa tái hiện bằng runtime được ghi là risk/NOT TESTED, không gọi là confirmed exploit hoặc memory leak.
