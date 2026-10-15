# VANHSUB — Risk register after integration, 2026-10-15

Source: `codex/integration-stabilization-20261015`, descendant `origin/main=899088f`. FIXED = source fix + scoped regression evidence; PARTIAL = còn acceptance/risk; NOT TESTED không có nghĩa chức năng đã lỗi. [F01–F16 source verification](CODEX_FULL_AUDIT_REPORT.md), [evidence](integration-evidence/2026-10-15/README.md).

| ID | Mức | Trạng thái hiện tại | Bằng chứng và việc còn lại |
|---|---|---|---|
| F01–F04 | P0 | FIXED, verified after integration | Unique project allocation/legacy collision/active node cleanup/pinned episodes/atomic rename regression PASS. Không tự migrate legacy conflict; R14 còn mở |
| F05–F08 | P1 | FIXED trong phạm vi đã kiểm tra | IPC trust/shell-free Chrome/path/WS Origin/shared leases PASS; real foreign-window IPC deny PASS. Chưa có full payload schemas/pairing/media grants |
| F09–F12 | P1 | FIXED trong phạm vi đã kiểm tra | Giữ outputs khi fail, UUID TTS/cache/groups, abort-aware session leases, strict script provider contracts, productionRevision invalidation PASS; live provider chưa nghiệm thu |
| F13 | P2 | FIXED, fixture verified | Orphan running checkpoint thành recoverable. Restart packaged task/project/settings PASS; crash giữa job chưa chạy |
| F14–F15 | P1 | FIXED trong phạm vi đã kiểm tra | Reject fake duration; giữ word alignment; synthetic secret redaction và trusted log sink PASS; không bảo đảm phát hiện mọi secret không nhãn |
| F16 | P1 | FIXED IN SOURCE / LIVE NOT VERIFIED | Extension1.0.7 fresh owned tab, background user tab protection; VM tests PASS. Chưa xác nhận extension đang chạy đã nạp patch |
| R01 | P1 | BLOCKED / DEFERRED BY USER | Chưa có Flow live an toàn trên dedicated CDP9224/extension đã vá. Audit trước chỉ handshake1.0.6, user chọn tạm ghi nhận.0 generation. Cần bounded I2V/T2V/provenance/download/cancel/export |
| R02 | P1 | PARTIAL | Clean-dependency full production/NSIS build PASS, unpacked EXE/UI/restart PASS,3 native binaries smoke và Whisper inference PASS cùng host. Installer Windows sạch/VM, Python/OCR/stems/fonts, signing chưa nghiệm thu; final installer NotSigned |
| R03 | P1 | FIXED IN SOURCE / PARTIAL ACCEPTANCE | Giữ remote config snapshot/owner/revision và script IPC getSessionConfig; thêm stale project start guard. Session config/isolation/project-switch tests PASS. Chưa nghiệm thu mọi provider credential/profile route live và legacy owner migration |
| R04 | P1 | PARTIAL / ESSENTIAL OPEN GATE | Real Whisper/FFmpeg cancel cho child thoát, partial dọn, bản tốt giữ; ordinary close4 PID thoát;180s idle không chứng minh leak. Chưa có shutdown coordinator phủ mọi job; quit/kill giữa OCR/TTS/browser/workflow và multi-hour soak NOT TESTED |
| R05 | P1 | NEW SECRET WRITES FIXED / LEGACY OPEN | Default fail closed khi DPAPI unavailable/encrypt lỗi; packaged Windows ciphertext/restart decrypt PASS bằng synthetic key. Legacy plaintext/base64 vẫn đọc được; migration/rotation/backup/error UX cần acceptance, không xóa key cũ |
| R06 | P1 | PARTIAL,5HIGH REMAIN | Bốn bounded version updates, clean npm ci/full native build/axios regression PASS; audit9→5 High/0 Critical. Còn braces→micromatch→fast-glob→shelljs→nodejs-whisper; chưa có upstream braces patch theo advisory ngày kiểm tra. Main ASR spawn CLI trực tiếp, không tìm thấy import JS wrapper; chưa đóng toàn bộ reachability/supply-chain risk. Không downgrade Whisper mù |
| R07 | P2 | OPEN | WS loopback/Origin/maxPayload có; native local client giả Origin được, chưa pairing/extension identity/replay binding. Cần pairing token lifecycle và reconnect compatibility với extension thật |
| R08 | P2 | PARTIAL | CSP production hash scripts, no unsafe-eval/inline script, Chromium enforcement PASS. vanhmedia path grant còn rộng/relative fallback theo activeProject; HTTPS/style/loopback còn cho phép. Cần capability/owner manifest và per-channel IPC payload validation |
| R09 | P2 | PARTIAL | Giữ remote productionRevision/revision directories và invalidation; script/media/group-regeneration/export failure preservation PASS. Chưa chứng nhận mọi provider write/retry/crash path có rollback đúng |
| R10 | P2 | PARTIAL / LIVE NOT TESTED | Group TTS regen, cache, timing adaptation, word-boundary mocks, FFmpeg audio/subtitle fixtures PASS. Cần nhiều speaker/language và nghe đối chiếu provider thật; policy PASS không chứng minh semantic/audio quality |
| R11 | P2 | PARTIAL | Packaged6 route navigation, settings persistence, editor1.000 dòng/task/project restart PASS; screenshot kiểm tra. Error/loading/cancel/modal/multi-window/multiple screen sizes chưa đủ |
| R12 | P2 | NOT TESTED | Model/provider lifecycle, rate-limit/retry/cost và quota thật chưa chạy. Diagnostics/mock contracts không chứng minh live readiness |
| R13 | P2 | OPEN | Legacy live harness có `.first()`/gallery/page fallback. Không dùng để nghiệm thu Flow. Cần owned test tab + request/media/project correlation, không điều khiển tab cá nhân |
| R14 | P2 | OPEN | Workspace checkpoint và catalog là2 atomic files, chưa chung transaction. Cần interrupted-write reconciliation/version tie-break/disk-full/crash tests; không đánh đồng rename safety F04 với cross-file transaction |
| R15 | P3 | OPEN | Engine/IPC lớn, cycles, abstraction trùng và UI badges. Refactor nhỏ theo callgraph sau acceptance; không xóa module/feature theo tên hay thiếu inbound import |
| R16 | P1 | RECONCILED ON INTEGRATION BRANCH | Tất cả27 remote commits giữ bằng ancestry;5 local+5 audit được selective replay, tránh duplicate registry/snapshot regressions. Test/build tích hợp PASS; chưa merge main, chờ review theo yêu cầu. Exact mapping trong integration report |
| R17 | P2 | CONFIRMED PERFORMANCE CONCERN | Final editor1.000 lines load3.412 ms;4 process total working set sample max1.483,13 MiB,30s sau còn838,47 MiB. Không gọi là leak; cần profile render/store/DOM, giới hạn bộ nhớ/virtualization thích hợp và đo input latency/large media nhiều giờ |

Các P0 xác nhận của audit có bản vá và regression trong source tích hợp; không tuyên bố không còn P0 chưa phát hiện. Release vẫn NOT READY do essential gates. Không lưu secret thật trong report/evidence.
