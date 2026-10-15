# VANHSUB — Test matrix, 2026-10-15

Source baseline `df9d768` + audit patches. Bằng chứng máy đọc: [regression.json](audit-evidence/2026-10-15/regression.json). Mỗi PASS chỉ có ý nghĩa trong phạm vi dưới đây.

| Test / command | Phân loại | Trạng thái | Xác minh / giới hạn |
|---|---|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` | Static | PASS | Main types; không chứng minh runtime |
| `.../tsc --noEmit -p renderer/tsconfig.json` | Static | PASS | Renderer types |
| `test_srt_ocr_normalizer_and_translation` / `npm test` | Unit / mock integration | PASS38/38 | SRT/OCR cleanup/order/timestamp, translation response/error mocked; không live Gemini |
| `test_video_processor_concat` | FFmpeg integration/regression | PASS | Tự tạo3clip4s, khác timebase→12.00s; reject invalid inputs |
| `test_media_validator_ffmpeg_decoding` | FFmpeg integration | PASS10case | Ảnh/video tự tạo, decode thật và timeout/negative; không silent skip fixtures |
| `test_timeline_export_duration_guard` | Render regression | PASS | Timeline mismatch reject; static/matching cases; freeze last frame→19.000s |
| `test_project_media_isolation_regression` | FS integration / provider mocked | PASS | Owner routing/storage; dummy media không chứng minh decode hoặc Flow |
| `test_tts_timing_adaptation` | Unit | PASS | Shorten/rate/conflict policy qua mock durations; không audio synthesis thật |
| `test_full_audit_security` | Security unit + socket integration | PASS | Foreign/missing/subframe IPC rejects; URL/path/model validation; WebSocket Origin handshake thật; synthetic secret redaction |
| `test_full_audit_data_integrity` | FS/store integration / regression | PASS | Task same-name, shared old dir reject; deferred node cleanup/cancel; background errors;1000leasecycles; failed ASR/translate giữ data |
| `test_full_audit_episode_storage` | FS/store integration / regression | PASS | Hai episode một project không đè voice; load/restart đúngID; legacy conflict; invalid path; IO failure; locked atomic destination giữ bản tốt; orphan running báo failed |
| `test_full_audit_session_jobs` | State-machine integration / provider stub | PASS | Invalidapprove không mutate; stage0reject; duplicateapprove; Cancel chưa cho job mới đến provider settle |
| `test_ai_studio_script_evaluation` | Provider contract unit/mock | PASS | D1–D10 schema/routing/credential mismatch; không fixed ratings; provider lỗi không fabricated fallback |
| `test_ai_studio_script_refinement` | Provider contract unit/mock | PASS | Custom instructions/schema/IDs/order/errors; không gọi API trả phí |
| `test_full_audit_script_artifacts` | Unit / mock probe regression | PASS | Script edit clear stale pointers, history giữ bản cũ, invalid input không mutate; invalid TTS duration rejects |
| `test_flow_project_isolation` | VM/provider mock regression | PASS | Project create/resume/mismatch + unusual activity dừng sau một attempt, không live browser |
| `test_full_audit_flow_tabs` | VM security/regression | PASS | Tạo project và đổi project không điều hướng active hoặc background unowned tab |
| `scripts/audit_runtime_electron.cjs` | Actual Electron UI smoke | PASS WITH LIMITS | Preload/tasks/settings IPC,6sidebar routes, screenshot, restart; profile riêng, bridge tắt, zero generation |
| UI60s idle metrics | Performance smoke | PASS WITH LIMITS |4process,609.12→502.76MiB, CPU0–0.19%, startup1035ms; không chứng minh multi-hour stability |
| `npm run build` tại C worktree | Native/build | FAIL môi trường | whisper-cli build PASS; Next Turbopack không hỗ trợ junctionoutside root. Log giữ lại |
| Next `build renderer --webpack` tại worktree | Build | FAIL môi trường | Resolve C/D client-entry qua junction |
| Next static build trong snapshotD cùng ổ | Build | PASS | Logs + SHA256 manifest;3staticpages |
| Nextron main/preload webpack snapshotD | Build | PASS có5warnings | bufferutil/utf-8-validate và Mac temperature optional modules; compiler transpileOnly nên vẫn cần riêng tsc |
| electron-builder qua junction | Packaging/runtime | FAIL | Builder exit0 nhưng archive thiếu conf/platform binaries; EXE launch timeout60s; giữ failure JSON |
| electron-builder với own `npm ci --omit=dev --ignore-scripts`, exact Electron43.4.1 | Packaging | PASS WITH LIMITS | Lockfile unchanged, package exit0; copy nativewhisper build riêng. Chưa installer/Windows sạch; EXE chưa ký |
| `audit_package_inventory.cjs` | Packaged binary smoke | PASS | Archive đủ7module kiểm tra; FFmpeg/FFprobe version và whisper help exit0; chưa speech recognition/encoding mọi codec |
| Actual clean-dependency `VANHSUB.exe` | Windows unpacked UI E2E smoke | PASS WITH LIMITS |6routes, preloadIPC, restart giữsettings, không console/page errors; startup1302ms cùng host |
| `npm audit --omit=dev --json` | Security scanner | FAIL gate |9high,0critical; exit1 đúng vì advisories, không phải test harness crash |
| `audit_flow_connection.ts` | Live transport readiness | PASS TRANSPORT ONLY | MV3v1.0.6 handshake thật qua Origin guard, CDP9224 không có; không gửi lệnh tab/auth/generation |
| Real Flow image/T2V/I2V/project/cancel | Live E2E | DEFERRED BY USER | Người dùng chọn ghi nhận live chưa hoàn tất; ownership patch1.0.7 chưa nạp;0generation/0credits từ audit |
| Real Gemini/OpenAI/DeepSeek/VietTTS/TikTok/Edge TTS | Provider live | NOT TESTED | Không gọi provider ngoài phạm vi Google Flow cho phép |
| Whisper/Paddle/Demucs trên media sản xuất | Local E2E | NOT TESTED | Build native không thay suy luận thật/quality check |
| Hardsub/softsub/mix/stems/CapCut full UI | UI/local E2E | NOT TESTED | FFmpeg fixture coverage chỉ là một phần |
| Shutdown giữa job / disconnect Internet/browser | Failure E2E | NOT TESTED | Có deferred/mock cancel và recovery checkpoint; chưa fault-injection toàn app |
| Multi-hour soak / large project / peak CPU-RAM/disk | Performance | NOT TESTED | Chỉ idle60s + lease loop; chưa optimization theo suy đoán |
| Clean Windows installer/signing/update/uninstall | Release E2E | NOT TESTED | Không có VM sạch; unpacked build không đủ |

## Test quality corrections

1. Media decoding suite trước phụ thuộc ignored file cũ, thiếu file thì âm thầm bỏ positive tests. Nay tự tạo JPEG/MP4 và chạy10case. Timeline export tương tự, nay tự tạo clip4s/image, không đọc output sản xuất.
2. `test_live_aistudio_visual_pipeline` inject `mockRpcClient`, không tính live. “Real browser” closed-port test stub `adapter.connect`, không chứng minh Chrome thật.
3. Runner cũ không timeout và tự đếm1 khi parse thất bại. `scripts/audit_regression.cjs` dùng allowlist15suite offline, timeout120s, exitcode+log từngsuite, không cộng assertion suy đoán.
4. `--offline` là guard ý định thêm cho runner; sự an toàn chính là allowlist/source inspection, không giả định mọi script thực sự đọc cờ này.
5. Một test recovery ban đầu fail vì auto-write vào legacy conflict directory; sửa load thành recovery read-only và chạy lại suite PASS. Kết quả cuối nằm trong JSON, không giấu failure bằng skip.

## Reproduction

Tại repository đã có dependencies: `node scripts/audit_regression.cjs`. Script dùng store tạm, không gọi provider hay điều khiển Chrome. `scripts/audit_build_snapshot.cjs` chỉ phục vụ môi trường audit này, kiểm tra đích thư mục tạm bằng allowlist; không phải build script portable cho CI. `scripts/audit_runtime_electron.cjs` dùng manifest snapshot và profile riêng. Không chạy live runner cũ trước khi xử lý R13.
