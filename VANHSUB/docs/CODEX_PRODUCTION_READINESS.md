# VANHSUB — Production readiness after integration, 2026-10-15

## Verdict: NOT READY

Mã đã được hợp nhất an toàn trên **`codex/integration-stabilization-20261015`** từ `origin/main=899088f`; main chưa thay đổi.38 suite offline PASS, full production build/NSIS PASS với dependencies cài riêng, executable thật và local Whisper/FFmpeg chạy được trên máy dev. Không dùng kết quả đó để chứng nhận provider live, installer Windows sạch hoặc chạy nhiều giờ.

| Gate | Kết quả | Phạm vi / việc còn lại |
|---|---|---|
| Git reconciliation | PASS ON INTEGRATION BRANCH | Giữ27 remote commits bằng ancestry; selectively replay local/audit, giữ snapshots/revisions/leases; không force/reset/main merge. Review mapping trước khi xét merge |
| F01–F16 | SOURCE + SCOPED REGRESSION VERIFIED | Bảng từng F trong full report; offline/FS/negative cases PASS; F16 mới verified source/VM, chưa extension live |
| Main/renderer TypeScript | PASS | Typecheck riêng và full build; không đồng nghĩa runtime mọi đường |
| Full production build | PASS IN ISOLATED BUILD WORKSPACE | npm ci riêng → CMake Whisper → Next Turbopack → main/preload → NSIS exit0;248source/config hashes khớp. C/D junction checkout cũ còn giới hạn |
| Windows distribution | PARTIAL | Final installer172.510.930 bytes, SHA256 trong evidence; unpacked EXE thật PASS cùng host; **NotSigned**. Clean Windows/VM installation **NOT TESTED** |
| Native runtime | PARTIAL PASS | FFmpeg/FFprobe/Whisper help/version exit0; Whisper tiny public speech inference + cancel thật PASS, FFmpeg render/cancel thật PASS. Python/OCR/stems/model-download/font portability chưa đủ |
| Storage/config/recovery | PARTIAL PASS | Owner/episode/pinned snapshot/revision/shared lock/atomic last-good safety PASS; packaged task/SRT/project/settings restart PASS. Hai checkpoint file chưa transaction, OS crash giữa job chưa nghiệm thu |
| Security | PARTIAL PASS | Foreign-window IPC deny, Chromium CSP enforcement và DPAPI persist/restart PASS. New secret writes fail closed; legacy secret migration, pairing, media grants, full payload schemas còn mở |
| Dependency | OPEN | Scan9→5 High/0 Critical; còn chain nodejs-whisper/braces chưa giải quyết. Không downgrade hàng loạt |
| UI/core flows | PARTIAL PASS |6 routes, task/video fixture/SRT/project persistence,1.000 line editor PASS. Provider/OCR/full authoring/error/cancel UI/multi-resolution còn thiếu |
| Google Flow | BLOCKED / DEFERRED |0 generation; chưa dedicated safe test connection và patch extension đang nạp chưa xác minh. Handshake cũ không phải live generation PASS |
| Translation/TTS/providers | NOT TESTED LIVE | Offline contracts/timing/group regen và actual audio render fixtures PASS. Chưa đánh giá ngữ nghĩa, nghe thực, full8 stage hay live workflow DAG |
| Performance/lifecycle | PARTIAL, concern found | Final editor load3.412 ms, sampled RAM max1.483,13 MiB;180s idle trước final guard có số đo. Ordinary close và native cancel PASS; shutdown mọi active job/multi-hour soak chưa chạy |

## Điều kiện để đánh giá lại

1. Nghiệm thu installer trên Windows sạch/VM, native/model/Python/fonts và signature/distribution; không thay bằng lần chạy trên máy dev.
2. Nghiệm thu Flow trong dedicated project/tab/profile với extension đã vá; request/media ownership, bounded image/I2V/T2V, download/decode, duration, cancel/disconnect và export. Dừng khi challenge, không bypass CAPTCHA.
3. Chạy provider dịch/TTS/ASR và8 stage Studio/workflow có budget; nghe và đối chiếu timing/ý nghĩa, error/retry/cost thật.
4. Quit/kill giữa từng loại job và restart recovery; chứng minh app chỉ dừng process/browser do nó sở hữu; soak nhiều giờ/concurrent tasks, đo RAM/CPU/disk/process cleanup.
5. Xử lý remaining dependency chain theo reachability/compatibility; bridge pairing, media grants/IPC schemas, legacy secret migration và checkpoint reconciliation có test.
6. Profile và giảm bộ nhớ editor dự án lớn, đo lại latency/resource; hoàn thiện UI loading/error/cancel/settings conflict ở các kích thước hỗ trợ.
7. Review và merge integration branch theo kết quả acceptance; không tự merge main trong đợt này.

Không release/publish installer trong đợt này. Không thao tác dữ liệu/credentials/tab cá nhân; không tự migrate legacy projects hoặc secret cũ. Build/profile/test temp riêng được giữ để review.

Tham chiếu: [integration](CODEX_INTEGRATION_REPORT.md), [full report](CODEX_FULL_AUDIT_REPORT.md), [risks](CODEX_RISK_REGISTER.md), [test matrix](CODEX_TEST_MATRIX.md), [raw integration evidence](integration-evidence/2026-10-15/README.md).
