# VANHSUB — Rà soát tiếp luồng TTS và xuất video, 20/10/2026

Tiếp nối worktree audit ở `3d0948e`, trên nhánh local `codex/worktree-merge-audit-20261020`. Bản sửa mã nguồn: **`80d19c0`**. Không audit lại toàn bộ ứng dụng, không retry Flow RPC, không gọi provider trả phí, không push/merge main hoặc thay bản Beta đang chạy.

## Hai lỗi P1 đã tái hiện và sửa

### 1. Tạo lại TTS thất bại sau nhóm đầu có thể sửa kết quả đã hoàn thành

`TTSRunner.regenerateLine` trước đây chạy ngay trong `task.ttsAudioDir`. Nếu nhóm đầu tạo lại thành công nhưng nhóm sau không đạt timing, tác vụ báo lỗi trong khi MP3 master và manifest của lần hoàn thành trước đã bị ghi lại. Test trước sửa xác nhận hash thay đổi; đây không chỉ là nhận định từ source. Các bài cũ chỉ làm lỗi ở nhóm đầu nên chưa phát hiện trường hợp này.

Đã đổi sang run riêng, seed cache bằng bản sao độc lập, lưu snapshot SRT rồi tạo lại và ghép MP3 trong run mới. Chỉ một lần cập nhật task sau thành công mới chuyển audio directory, MP3, cấu hình giọng/tốc độ và timing report sang kết quả mới. Hủy/lỗi giữ nguyên pointer và bytes của run hoàn thành trước; `ttsNeedsRegeneration=true` tiếp tục chặn dùng audio cũ cho nội dung mới. Nếu SRT nguồn bị sửa bên ngoài giữa lúc chạy, từ chối publish kết quả của snapshot cũ.

Sau thành công, downstream video/inspection bị vô hiệu hóa đúng cách nhưng file cũ không bị xóa. Lần tạo lại thành công có MP3 nằm trong thư mục run riêng dưới project. Candidate của lần thất bại không được gắn vào task và được giữ local; chưa thêm cơ chế tự dọn lịch sử/cache.

### 2. Export có thể dùng dub cũ khi TTS đang stale

Export Auto hoặc chọn Video đã lồng tiếng trước đây không kiểm tra `ttsNeedsRegeneration`. Negative control chạy code baseline với media fixture hợp lệ xác nhận Auto vẫn tới `done` dù audio cần tạo lại. Dubbing runner đã có guard tương ứng, nhưng export chưa có.

Đã chặn nguồn dubbed khi flag này còn bật, với lỗi hướng dẫn tạo lại TTS/ghép dub hoặc chọn Video gốc. Guard này cần thiết khi giữ output hoàn thành trước để phục hồi. Chọn Video gốc vẫn xuất được phụ đề; file video cũ giữ nguyên.

## Kiểm chứng đợt này

| Bài kiểm tra | Kết quả / phân loại |
|---|---|
| Baseline nhiều nhóm TTS | **FAIL tái hiện được**: nhóm đầu đã tạo candidate hợp lệ, nhóm sau thất bại; hash audio/manifest cũ thay đổi |
| Transaction sau sửa | **Automated PASS**: lỗi ở nhóm sau, hủy sau candidate trước, SRT sửa ngoài app; toàn bộ bytes/pointer của run hoàn thành trước được giữ; chạy lại thành công nhận directory/MP3 mới |
| Tạo lại → dubbing | **Real native processing PASS với fixture**: run mới được DubbingRunner sử dụng, FFmpeg ghép video và inspection decode PASS. Tone tổng hợp chỉ làm fixture, không được tính TTS giọng thật/provider live |
| Baseline export stale | **FAIL tái hiện được**: nguồn Auto với stale audio vẫn hoàn thành export |
| Export sau sửa | **Automated/native fixture PASS**: Auto và explicit dubbed bị từ chối; explicit original softsub thành công; video cũ không đổi bytes |
| Hồi quy | **6/6 entrypoint PASS**: transaction mới, group regeneration, RC TTS cancel/retry, stale-dub export mới, dubbed subtitle export, timing adaptation. Test transaction được bổ sung bước dubbing thật rồi chạy lại PASS |
| Main TypeScript | **PASS**, khoảng 6,018 s |
| Main/preload production build | **PASS**, khoảng 14,757 s; staging riêng, dependencies đọc từ bộ Beta đã chuẩn bị |
| Renderer/full suite/NSIS | Không chạy lại: không sửa frontend/dependency; không có packaging hoặc installer mới |
| UI Electron / live speech | **NOT TESTED cho bản sửa này**; không dùng fixture để nâng thành Live Provider hoặc UI E2E PASS |

Test group-regeneration cũ được cập nhật theo contract mới: đọc directory đang được task chọn, giữ pointer MP3 trước khi lỗi và kiểm tra stale guard. Không xóa assertion bảo toàn bytes, timing, giọng/speed, concurrency hay lỗi. Negative control trên baseline độc lập xác nhận lỗi thực trước khi sửa.

Evidence thô giữ local trong `temp/worktree-audit/`: `regeneration-before.log`, `regeneration-after.log`, `regeneration-with-real-dubbing.log`, `stale-export-before.log`, `followup-results.json`, `main-followup-build.json`. Staging main riêng ở `D:/DEAN/DEAN/VANHSUB/temp/vanhsub-main-followup-VoaNzo`; không ghi đè executable/app.asar đang chạy. Không commit các log hoặc runtime metadata này.

## Phạm vi và việc chưa đóng

Đây là sửa và nghiệm thu giới hạn cho vòng đời artifact TTS/export, không phải chứng nhận toàn app. Các gate cũ còn mở: UAT Electron của nhánh review; shutdown/crash giữa job và soak dài; stem cancellation trong bước extraction; provider dịch/official visual API thiếu key/quota; Google Flow unusual activity/CDP target cũ; Windows sạch/NSIS. Không thay kiến trúc để khép các gate này bằng suy đoán.

Bản Beta local đã nghiệm thu trước vẫn giữ nguyên. Trạng thái giới hạn của Internal Beta trước đây không đồng nghĩa nhánh mới đã có UAT; Public Release vẫn NOT READY theo báo cáo RC. Nhánh review tiếp tục giữ local để người dùng review/UAT trước khi yêu cầu push hoặc merge.
